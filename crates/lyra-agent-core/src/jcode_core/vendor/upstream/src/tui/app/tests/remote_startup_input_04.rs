#[test]
fn test_handle_server_event_updates_status_detail() {
    let mut app = create_test_app();
    let rt = tokio::runtime::Runtime::new().unwrap();
    let _guard = rt.enter();
    let mut remote = crate::tui::backend::RemoteConnection::dummy();

    app.handle_server_event(
        crate::protocol::ServerEvent::StatusDetail {
            detail: "reusing websocket".to_string(),
        },
        &mut remote,
    );

    assert_eq!(app.status_detail.as_deref(), Some("reusing websocket"));
}

#[test]
fn test_handle_server_event_transcript_replace_updates_input() {
    let mut app = create_test_app();
    let rt = tokio::runtime::Runtime::new().unwrap();
    let _guard = rt.enter();
    let mut remote = crate::tui::backend::RemoteConnection::dummy();

    app.input = "old draft".to_string();
    app.cursor_pos = app.input.len();

    app.handle_server_event(
        crate::protocol::ServerEvent::Transcript {
            text: "new transcript text".to_string(),
            mode: crate::protocol::TranscriptMode::Replace,
        },
        &mut remote,
    );

    assert_eq!(app.input, "new transcript text");
    assert_eq!(app.cursor_pos, app.input.len());
    assert_eq!(
        app.status_notice(),
        Some("Transcript replaced input".to_string())
    );
}
