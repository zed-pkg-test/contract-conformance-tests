use axum::{routing::get, Router};
use tower_http::{limit::RequestBodyLimitLayer, trace::TraceLayer};

async fn health() -> &'static str {
    "ok"
}

fn main() {
    let _app = Router::<()>::new()
        .route("/healthz", get(health))
        .layer(RequestBodyLimitLayer::new(512 * 1024))
        .layer(TraceLayer::new_for_http());
}
