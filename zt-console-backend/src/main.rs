mod auth;
mod proxy;
mod static_files;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, delete, get, post},
    Json, Router,
};
use serde_json::json;

#[derive(Clone)]
pub struct AppState {
    pub auth: Arc<auth::AuthState>,
    pub controller_url: String,
    pub controller_token: String,
}

/// Extract the auth token from either the `zt_session` cookie or an
/// `Authorization: Bearer <token>` header (used for API-key auth).
pub(crate) fn extract_token(headers: &HeaderMap) -> Option<String> {
    if let Some(c) = headers.get(header::COOKIE) {
        if let Ok(c) = c.to_str() {
            for part in c.split(';') {
                let part = part.trim();
                if let Some(v) = part.strip_prefix("zt_session=") {
                    return Some(v.to_string());
                }
            }
        }
    }
    if let Some(a) = headers.get(header::AUTHORIZATION) {
        if let Ok(a) = a.to_str() {
            if let Some(tok) = a.strip_prefix("Bearer ") {
                return Some(tok.trim().to_string());
            }
        }
    }
    None
}

/// Standard 401 JSON response.
fn unauthorized() -> Response {
    let mut r = Json(json!({ "error": "unauthorized" })).into_response();
    *r.status_mut() = StatusCode::UNAUTHORIZED;
    r
}

/// Resolve the ZeroTier controller auth token.
///
/// Priority: `ZT_TOKEN` env var > contents of `ZT_TOKEN_FILE`
/// (default `/var/lib/zerotier-one/authtoken.secret`).
/// The secret-file path lets the host's authtoken.secret be mounted into the
/// container (read-only) without placing the token in any env / compose file.
fn resolve_controller_token() -> String {
    if let Ok(t) = std::env::var("ZT_TOKEN") {
        let t = t.trim();
        if !t.is_empty() {
            println!("zt-console: controller token loaded from ZT_TOKEN env");
            return t.to_string();
        }
    }
    let file = std::env::var("ZT_TOKEN_FILE")
        .unwrap_or_else(|_| "/var/lib/zerotier-one/authtoken.secret".into());
    match std::fs::read_to_string(&file) {
        Ok(s) => {
            let t = s.trim().to_string();
            if !t.is_empty() {
                println!("zt-console: controller token loaded from file {file}");
                return t;
            }
            println!("zt-console: ZT_TOKEN_FILE ({file}) is empty");
        }
        Err(e) => {
            println!("zt-console: could not read ZT_TOKEN_FILE ({file}): {e}");
        }
    }
    println!("zt-console: no controller token configured (set ZT_TOKEN or ZT_TOKEN_FILE)");
    String::new()
}

#[tokio::main]
async fn main() {
    let controller_url = std::env::var("ZT_CONTROLLER_URL")
        .unwrap_or_else(|_| "http://host.docker.internal:9993".into());
    let controller_token = resolve_controller_token();
    let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| "data".into());
    let auth = Arc::new(auth::AuthState::new(&data_dir));
    let state = AppState {
        auth,
        controller_url,
        controller_token,
    };

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3000);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    let app = Router::new()
        .route("/", get(static_files::serve))
        .route("/{*path}", get(static_files::serve))
        .route("/api/auth/login", post(login_handler))
        .route("/api/auth/change-password", post(change_password_handler))
        .route("/api/auth/logout", post(logout_handler))
        .route("/api/auth/me", get(me_handler))
        .route("/api/auth/api-keys", get(list_api_keys_handler).post(issue_api_key_handler))
        .route("/api/auth/api-keys/{id}", delete(revoke_api_key_handler))
        .route("/api/controller", any(proxy::proxy_handler))
        .route("/api/controller/{*rest}", any(proxy::proxy_handler))
        .with_state(state);

    println!("zt-console listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

#[derive(serde::Deserialize)]
struct LoginReq {
    user: String,
    pass: String,
}

async fn login_handler(State(st): State<AppState>, Json(req): Json<LoginReq>) -> Response {
    match st.auth.login(&req.user, &req.pass) {
        Some((token, must_change)) => {
            let cookie = format!(
                "zt_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
                token,
                60 * 60 * 24 * 7
            );
            let mut r = Json(json!({ "ok": true, "must_change": must_change })).into_response();
            r.headers_mut().insert(
                header::SET_COOKIE,
                header::HeaderValue::from_str(&cookie).unwrap(),
            );
            r
        }
        None => {
            let mut r = Json(json!({ "error": "invalid credentials" })).into_response();
            *r.status_mut() = StatusCode::UNAUTHORIZED;
            r
        }
    }
}

#[derive(serde::Deserialize)]
struct ChangeReq {
    current: String,
    #[serde(rename = "new")]
    new: String,
}

async fn change_password_handler(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ChangeReq>,
) -> Response {
    let token = extract_token(&headers);
    if token.as_ref().map(|t| st.auth.valid(t)).unwrap_or(false) {
        if st.auth.change_password(token.as_ref().unwrap(), &req.current, &req.new) {
            return Json(json!({ "ok": true })).into_response();
        }
        let mut r = Json(json!({ "error": "current password incorrect" })).into_response();
        *r.status_mut() = StatusCode::BAD_REQUEST;
        return r;
    }
    let mut r = Json(json!({ "error": "unauthorized" })).into_response();
    *r.status_mut() = StatusCode::UNAUTHORIZED;
    r
}

async fn logout_handler(State(st): State<AppState>, headers: HeaderMap) -> Response {
    if let Some(t) = extract_token(&headers) {
        st.auth.logout(&t);
    }
    let cookie = "zt_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    let mut r = Json(json!({ "ok": true })).into_response();
    r.headers_mut().insert(
        header::SET_COOKIE,
        header::HeaderValue::from_str(cookie).unwrap(),
    );
    r
}

async fn me_handler(State(st): State<AppState>, headers: HeaderMap) -> Response {
    // /me is a session-only endpoint (the web UI checks login state).
    // API keys must NOT be usable here — they are scoped to ZeroTier
    // management only (/api/controller/*), not to system/admin endpoints.
    match extract_token(&headers) {
        Some(t) if st.auth.valid(&t) => {
            let u = st.auth.user_by_token(&t);
            Json(json!({
                "user": u.as_ref().map(|x| x.username.clone()).unwrap_or_else(|| "admin".into()),
                "authed": true,
                "must_change": u.map(|x| x.must_change).unwrap_or(false)
            }))
            .into_response()
        }
        _ => {
            let mut r = Json(json!({ "authed": false })).into_response();
            *r.status_mut() = StatusCode::UNAUTHORIZED;
            r
        }
    }
}

#[derive(serde::Deserialize)]
struct ApiKeyCreateReq {
    name: String,
}

async fn list_api_keys_handler(State(st): State<AppState>, headers: HeaderMap) -> Response {
    // Listing keys is a session-only operation. API keys themselves must not
    // be able to enumerate/manage keys (no self-replication, and they are
    // scoped strictly to ZeroTier management endpoints).
    let t = match extract_token(&headers) {
        Some(t) if st.auth.valid(&t) => t,
        _ => return unauthorized(),
    };
    let _ = t;
    Json(st.auth.list_api_keys()).into_response()
}

async fn issue_api_key_handler(
    State(st): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ApiKeyCreateReq>,
) -> Response {
    // Issuing keys requires an interactive session (not an API key).
    let t = match extract_token(&headers) {
        Some(t) if st.auth.valid(&t) => t,
        _ => return unauthorized(),
    };
    let created_by = st
        .auth
        .user_by_token(&t)
        .map(|u| u.username)
        .unwrap_or_else(|| "admin".to_string());
    match st.auth.issue_api_key(&req.name, &created_by) {
        Some(k) => Json(json!({
            "id": k.id,
            "name": k.name,
            "prefix": k.prefix,
            "key": k.key,
            "created_at": k.created_at,
        }))
        .into_response(),
        None => {
            let mut r = Json(json!({ "error": "failed to issue key" })).into_response();
            *r.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
            r
        }
    }
}

async fn revoke_api_key_handler(
    State(st): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Response {
    // Revoking requires an interactive session (not an API key).
    let t = match extract_token(&headers) {
        Some(t) if st.auth.valid(&t) => t,
        _ => return unauthorized(),
    };
    let _ = t;
    if st.auth.revoke_api_key(&id) {
        Json(json!({ "ok": true })).into_response()
    } else {
        let mut r = Json(json!({ "error": "key not found" })).into_response();
        *r.status_mut() = StatusCode::NOT_FOUND;
        r
    }
}
