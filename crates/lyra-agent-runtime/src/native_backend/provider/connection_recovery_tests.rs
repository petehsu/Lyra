use super::*;
#[test]
fn connection_failures_do_not_gain_retries_by_switching_stream_mode() {
    let error = AgentRuntimeError::ProviderTransport {
        kind: ProviderTransportKind::Connect,
        detail: "connection refused".into(),
    };
    assert!(connection_establishment_failed(&error));
    assert_eq!(transport_retry_limit(&error), 1);
    let interrupted = AgentRuntimeError::ProviderTransport {
        kind: ProviderTransportKind::StreamInterrupted,
        detail: "body interrupted".into(),
    };
    assert!(!connection_establishment_failed(&interrupted));
    assert_eq!(
        transport_retry_limit(&interrupted),
        MAX_STREAM_TRANSPORT_RETRIES
    );
}
#[tokio::test]
async fn connect_diagnostic_preserves_the_cause_and_removes_url_secrets() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    let error = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(format!(
            "http://127.0.0.1:{port}/?key=not-a-real-test-secret"
        ))
        .send()
        .await
        .unwrap_err();
    let mapped = reqwest_transport_error(error);
    assert!(connection_establishment_failed(&mapped));
    let message = mapped.to_string();
    assert!(!message.contains("not-a-real-test-secret"));
    assert!(
        message.contains("connect") && message.contains(": "),
        "{message}"
    );
}
