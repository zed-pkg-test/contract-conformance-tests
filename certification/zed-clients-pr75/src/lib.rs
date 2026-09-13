#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;
    use zed_client_async::{AsyncClient, Error};

    async fn server_once(
        response: Option<Vec<u8>>,
        delay: Duration,
    ) -> (String, oneshot::Receiver<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let address = listener.local_addr().expect("address");
        let (seen_tx, seen_rx) = oneshot::channel();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.expect("accept");
            let mut request = Vec::new();
            let mut chunk = [0_u8; 1024];
            loop {
                let read = socket.read(&mut chunk).await.expect("read request");
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                if request.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let _ = seen_tx.send(());
            tokio::time::sleep(delay).await;
            if let Some(response) = response {
                let _ = socket.write_all(&response).await;
                let _ = socket.shutdown().await;
            }
        });
        (format!("http://{address}"), seen_rx)
    }

    fn response(status: &str, body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
        .into_bytes()
    }

    #[tokio::test]
    async fn request_times_out_before_response_headers() {
        let (base, seen) = server_once(None, Duration::from_secs(2)).await;
        let client = AsyncClient::new(base)
            .expect("client")
            .with_timeout(Duration::from_millis(80));
        let result = client.get_package("acme", "slow").await;
        seen.await.expect("request reached server");
        assert!(matches!(result, Err(Error::Timeout)), "result={result:?}");
    }

    #[tokio::test]
    async fn oversized_success_body_fails_before_json_decode() {
        let body = r#"{"versions":["1.0.0"],"padding":"abcdefghijklmnopqrstuvwxyz"}"#;
        let (base, seen) = server_once(
            Some(response("200 OK", body)),
            Duration::from_millis(0),
        )
        .await;
        let client = AsyncClient::new(base)
            .expect("client")
            .with_max_response_bytes(16);
        let result = client.get_package("acme", "large").await;
        seen.await.expect("request reached server");
        assert!(
            matches!(result, Err(Error::ResponseTooLarge { limit: 16, .. })),
            "result={result:?}"
        );
    }

    #[tokio::test]
    async fn non_success_status_is_preserved_as_api_error() {
        let body = r#"{"code":"missing","message":"not found"}"#;
        let (base, seen) = server_once(
            Some(response("404 Not Found", body)),
            Duration::from_millis(0),
        )
        .await;
        let client = AsyncClient::new(base).expect("client");
        let result = client.get_package("acme", "missing").await;
        seen.await.expect("request reached server");
        match result {
            Err(Error::Api { status, code, .. }) => {
                assert_eq!(status, 404);
                assert!(!code.trim().is_empty());
            }
            other => panic!("expected API error, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn caller_can_abort_an_inflight_request_future() {
        let (base, seen) = server_once(None, Duration::from_secs(5)).await;
        let client = AsyncClient::new(base)
            .expect("client")
            .with_timeout(Duration::from_secs(30));
        let task = tokio::spawn(async move { client.get_package("acme", "cancel").await });
        seen.await.expect("request reached server");
        task.abort();
        let join = tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .expect("aborted task must resolve promptly")
            .expect_err("aborted task must not produce a value");
        assert!(join.is_cancelled());
    }
}
