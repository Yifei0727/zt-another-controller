use axum::{
    body::{Body, Bytes},
    extract::State,
    http::{header, HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use crate::{extract_token, AppState};

/// Reverse proxy for the ZeroTier controller's local JSON API.
/// Forwards `/api/controller/<path>` -> `<ZT_CONTROLLER_URL>/<path>` and injects
/// the `X-ZT1-Auth` token. Gated behind a valid admin session.
pub async fn proxy_handler(
    State(st): State<AppState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let token = extract_token(&headers);
    if !token.as_ref().map(|t| st.auth.authenticate(t)).unwrap_or(false) {
        let mut r = Json(json!({ "error": "unauthorized" })).into_response();
        *r.status_mut() = StatusCode::UNAUTHORIZED;
        return r;
    }

    let path = uri.path().trim_start_matches("/api/controller");
    let query = uri.query().map(|q| format!("?{q}")).unwrap_or_default();
    // ZeroTier 控制器本地 API 中,大部分资源在 /controller 根下;
    // 但 /peer(节点在线列表)是根级端点,不在 /controller 下,需单独处理。
    let prefix = if path == "/peer" { "" } else { "/controller" };
    let url = format!("{}{}{}{}", st.controller_url, prefix, path, query);

    let client = reqwest::Client::new();
    let mut rb = client
        .request(method.clone(), &url)
        .header("X-ZT1-Auth", &st.controller_token);
    if let Some(ct) = headers.get(header::CONTENT_TYPE) {
        rb = rb.header(header::CONTENT_TYPE, ct);
    }

    match rb.body(body.to_vec()).send().await {
        Ok(r) => {
            let status = r.status();
            let ct = r
                .headers()
                .get(header::CONTENT_TYPE)
                .cloned()
                .unwrap_or_else(|| header::HeaderValue::from_static("application/json"));
            let bytes = r.bytes().await.unwrap_or_default();
            let mut resp = Response::new(Body::from(bytes));
            *resp.status_mut() = status;
            resp.headers_mut().insert(header::CONTENT_TYPE, ct);
            resp
        }
        Err(e) => {
            let mut r = Json(json!({ "error": format!("controller unreachable: {e}") })).into_response();
            *r.status_mut() = StatusCode::BAD_GATEWAY;
            r
        }
    }
}
