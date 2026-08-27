use axum::{
    body::Body,
    extract::OriginalUri,
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "frontend-dist"]
pub struct Assets;

/// Serve embedded SPA assets with an `index.html` fallback for client routing.
pub async fn serve(uri: OriginalUri) -> Response {
    let p = uri.0.path().trim_start_matches('/').to_string();
    let p = if p.is_empty() {
        "index.html".to_string()
    } else {
        p
    };
    if let Some(c) = Assets::get(&p) {
        return response_with(&p, c.data.into_owned());
    }
    if let Some(c) = Assets::get("index.html") {
        return response_with("index.html", c.data.into_owned());
    }
    (StatusCode::NOT_FOUND, "not found").into_response()
}

fn response_with(path: &str, data: Vec<u8>) -> Response {
    let mut r = Response::new(Body::from(data));
    r.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(mime_for(path)),
    );
    r
}

fn mime_for(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") || path.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".json") {
        "application/json"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
        "image/jpeg"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else if path.ends_with(".woff2") {
        "font/woff2"
    } else {
        "application/octet-stream"
    }
}
