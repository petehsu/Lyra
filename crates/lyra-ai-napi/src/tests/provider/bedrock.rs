use std::collections::BTreeMap;
use std::io::Cursor;
use std::sync::atomic::AtomicBool;

use crate::provider::bedrock::credentials::AwsCredentials;
use crate::provider::bedrock::event_stream::consume_event_stream;
use crate::provider::bedrock::sigv4::sign_headers;

fn encode_string_header(name: &str, value: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.push(name.len() as u8);
    bytes.extend_from_slice(name.as_bytes());
    bytes.push(7);
    bytes.extend_from_slice(&(value.len() as u16).to_be_bytes());
    bytes.extend_from_slice(value.as_bytes());
    bytes
}

fn encode_message(payload: &str) -> Vec<u8> {
    let mut headers = Vec::new();
    headers.extend_from_slice(&encode_string_header(":message-type", "event"));
    headers.extend_from_slice(&encode_string_header(":event-type", "chunk"));

    let total_len = 12 + headers.len() + payload.len() + 4;
    let mut message = Vec::new();
    message.extend_from_slice(&(total_len as u32).to_be_bytes());
    message.extend_from_slice(&(headers.len() as u32).to_be_bytes());
    let prelude_crc = crc32fast::hash(&message);
    message.extend_from_slice(&prelude_crc.to_be_bytes());
    message.extend_from_slice(&headers);
    message.extend_from_slice(payload.as_bytes());
    let message_crc = crc32fast::hash(&message);
    message.extend_from_slice(&message_crc.to_be_bytes());
    message
}

#[test]
fn consumes_bedrock_text_delta_stream() {
    let payload = [
        encode_message(r#"{"contentBlockDelta":{"contentBlockIndex":0,"delta":{"text":"Hello"}}}"#),
        encode_message(r#"{"messageStop":{"stopReason":"end_turn"}}"#),
    ]
    .concat();
    let cancel_flag = AtomicBool::new(false);
    let mut deltas = String::new();

    let response = consume_event_stream(Cursor::new(payload), &cancel_flag, |delta| {
        deltas.push_str(delta);
        Ok(())
    })
    .expect("consume bedrock stream");

    assert_eq!(response, "Hello");
    assert_eq!(deltas, "Hello");
}

#[test]
fn signs_bedrock_requests_with_sigv4_headers() {
    let headers = sign_headers(
        "POST",
        "https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-20241022-v2%3A0/converse-stream",
        "us-east-1",
        br#"{"messages":[]}"#,
        &AwsCredentials {
            access_key_id: "AKIAEXAMPLE".to_string(),
            secret_access_key: "very-secret".to_string(),
            session_token: Some("session-token".to_string()),
        },
    )
    .expect("sign bedrock headers");

    let map = headers.into_iter().collect::<BTreeMap<_, _>>();
    assert!(map["Authorization"].starts_with("AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/"));
    assert!(map.contains_key("X-Amz-Date"));
    assert_eq!(map["X-Amz-Security-Token"], "session-token");
}
