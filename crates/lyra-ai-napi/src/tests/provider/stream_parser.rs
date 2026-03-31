use crate::provider::stream_parser::{parse_stream_event, StreamEvent};

#[test]
fn parses_streaming_delta_chunks() {
    let event = parse_stream_event("data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}")
        .expect("parse chunk")
        .expect("delta event");

    assert_eq!(event, StreamEvent::Delta("hello".to_string()));
}

#[test]
fn parses_done_sentinel() {
    let event = parse_stream_event("data: [DONE]")
        .expect("parse done")
        .expect("done event");

    assert_eq!(event, StreamEvent::Done);
}

#[test]
fn ignores_comments_and_empty_deltas() {
    assert!(parse_stream_event(": keep-alive")
        .expect("parse comment")
        .is_none());
    assert!(parse_stream_event("data: {\"choices\":[{\"delta\":{}}]}")
        .expect("parse empty chunk")
        .is_none());
}
