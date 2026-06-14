use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::blocking::{Client, RequestBuilder};
use sha2::{Digest, Sha256};
use url::Url;

use crate::{
    AgentRuntimeError, AgentRuntimeResult,
    native_backend::{NativeProviderProfile, providers::transport},
};

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug)]
pub(crate) struct AwsCredentials {
    pub(crate) access_key_id: String,
    pub(crate) secret_access_key: String,
    pub(crate) session_token: Option<String>,
}

pub(crate) fn credentials_for_provider(
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<AwsCredentials> {
    let access_key_id = transport::auth::resolve_api_key(provider)
        .or_else(|| std::env::var("AWS_ACCESS_KEY_ID").ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core(
                "AWS access key id is not configured; set AWS_ACCESS_KEY_ID".to_string(),
            )
        })?;
    let secret_access_key = std::env::var("AWS_SECRET_ACCESS_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core(
                "AWS secret access key is not configured; set AWS_SECRET_ACCESS_KEY".to_string(),
            )
        })?;
    let session_token = std::env::var("AWS_SESSION_TOKEN")
        .ok()
        .filter(|value| !value.trim().is_empty());
    Ok(AwsCredentials {
        access_key_id,
        secret_access_key,
        session_token,
    })
}

pub(crate) fn signed_json_request(
    client: &Client,
    method: &str,
    url: &str,
    body: &str,
    credentials: &AwsCredentials,
    region: &str,
    service: &str,
) -> AgentRuntimeResult<RequestBuilder> {
    let parsed = Url::parse(url).map_err(|error| {
        AgentRuntimeError::Core(format!("failed to parse AWS request URL `{url}`: {error}"))
    })?;
    let host = parsed
        .host_str()
        .ok_or_else(|| AgentRuntimeError::Core(format!("AWS request URL has no host: `{url}`")))?;
    let host = match parsed.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    };
    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();
    let payload_hash = sha256_hex(body.as_bytes());

    let mut canonical_headers = vec![
        ("content-type".to_string(), "application/json".to_string()),
        ("host".to_string(), host.clone()),
        ("x-amz-content-sha256".to_string(), payload_hash.clone()),
        ("x-amz-date".to_string(), amz_date.clone()),
    ];
    if let Some(session_token) = credentials.session_token.as_ref() {
        canonical_headers.push(("x-amz-security-token".to_string(), session_token.clone()));
    }
    canonical_headers.sort_by(|left, right| left.0.cmp(&right.0));
    let signed_headers = canonical_headers
        .iter()
        .map(|(name, _)| name.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_headers_text = canonical_headers
        .iter()
        .map(|(name, value)| format!("{name}:{}\n", normalize_header_value(value)))
        .collect::<String>();
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        method.to_ascii_uppercase(),
        canonical_uri(&parsed),
        canonical_query(&parsed),
        canonical_headers_text,
        signed_headers,
        payload_hash
    );
    let credential_scope = format!("{date}/{region}/{service}/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );
    let signing_key = signing_key(&credentials.secret_access_key, &date, region, service)?;
    let signature = hmac_sha256_hex(&signing_key, string_to_sign.as_bytes())?;
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        credentials.access_key_id, credential_scope, signed_headers, signature
    );

    let mut request = client
        .post(url)
        .header("content-type", "application/json")
        .header("host", host)
        .header("x-amz-date", amz_date)
        .header("x-amz-content-sha256", payload_hash)
        .header("authorization", authorization);
    if let Some(session_token) = credentials.session_token.as_ref() {
        request = request.header("x-amz-security-token", session_token);
    }
    Ok(request.body(body.to_string()))
}

fn canonical_uri(url: &Url) -> String {
    let path = url.path();
    if path.is_empty() {
        "/".to_string()
    } else {
        path.to_string()
    }
}

fn canonical_query(url: &Url) -> String {
    let mut pairs = url.query_pairs().collect::<Vec<_>>();
    pairs.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    pairs
        .into_iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                aws_percent_encode(&key),
                aws_percent_encode(&value)
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn aws_percent_encode(value: &str) -> String {
    urlencoding::encode(value)
        .replace('+', "%20")
        .replace("%7E", "~")
}

fn normalize_header_value(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex_lower(&Sha256::digest(bytes))
}

fn signing_key(
    secret_access_key: &str,
    date: &str,
    region: &str,
    service: &str,
) -> AgentRuntimeResult<Vec<u8>> {
    let k_date = hmac_sha256(
        format!("AWS4{secret_access_key}").as_bytes(),
        date.as_bytes(),
    )?;
    let k_region = hmac_sha256(&k_date, region.as_bytes())?;
    let k_service = hmac_sha256(&k_region, service.as_bytes())?;
    hmac_sha256(&k_service, b"aws4_request")
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> AgentRuntimeResult<Vec<u8>> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    mac.update(message);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn hmac_sha256_hex(key: &[u8], message: &[u8]) -> AgentRuntimeResult<String> {
    Ok(hex_lower(&hmac_sha256(key, message)?))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_request_uses_bedrock_credential_scope_and_required_headers() {
        let credentials = AwsCredentials {
            access_key_id: "AKIATEST".to_string(),
            secret_access_key: "SECRET".to_string(),
            session_token: Some("TOKEN".to_string()),
        };
        let request = signed_json_request(
            &Client::new(),
            "POST",
            "https://bedrock-runtime.us-west-2.amazonaws.com/model/anthropic.claude-3%3A0/converse",
            r#"{"messages":[]}"#,
            &credentials,
            "us-west-2",
            "bedrock",
        )
        .expect("signed request")
        .build()
        .expect("request");
        let authorization = request
            .headers()
            .get("authorization")
            .and_then(|value| value.to_str().ok())
            .expect("authorization");

        assert!(authorization.contains("Credential=AKIATEST/"));
        assert!(authorization.contains("/us-west-2/bedrock/aws4_request"));
        assert!(authorization.contains(
            "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token"
        ));
        assert!(request.headers().get("x-amz-content-sha256").is_some());
        assert_eq!(
            request
                .headers()
                .get("x-amz-security-token")
                .and_then(|value| value.to_str().ok()),
            Some("TOKEN")
        );
    }
}
