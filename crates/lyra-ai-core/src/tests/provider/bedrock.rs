use std::collections::BTreeMap;

use crate::provider::bedrock::credentials::AwsCredentials;
use crate::provider::bedrock::sigv4::sign_headers;

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
