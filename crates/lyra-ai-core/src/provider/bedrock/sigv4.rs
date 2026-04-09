use hmac::{Hmac, Mac};
use napi::Result;
use percent_encoding::{utf8_percent_encode, AsciiSet, CONTROLS};
use reqwest::Url;
use sha2::{Digest, Sha256};
use time::format_description::FormatItem;
use time::macros::format_description;
use time::OffsetDateTime;

use crate::error::to_error;
use crate::provider::bedrock::credentials::AwsCredentials;

const PATH_SET: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'"')
    .add(b'#')
    .add(b'%')
    .add(b'<')
    .add(b'>')
    .add(b'?')
    .add(b'[')
    .add(b'\\')
    .add(b']')
    .add(b'^')
    .add(b'`')
    .add(b'{')
    .add(b'|')
    .add(b'}');
const QUERY_SET: &AsciiSet = &PATH_SET.add(b'&').add(b'=').add(b'+');
const AMZ_DATE_FORMAT: &[FormatItem<'static>] =
    format_description!("[year][month][day]T[hour][minute][second]Z");
const DATE_STAMP_FORMAT: &[FormatItem<'static>] = format_description!("[year][month][day]");

type HmacSha256 = Hmac<Sha256>;

fn hex_sha256(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn hmac_sha256(key: &[u8], value: &[u8]) -> Result<Vec<u8>> {
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|error| to_error(format!("failed to initialize AWS signer: {error}")))?;
    mac.update(value);
    Ok(mac.finalize().into_bytes().to_vec())
}

fn canonical_query_string(url: &Url) -> String {
    let mut entries = url
        .query_pairs()
        .map(|(key, value)| {
            (
                utf8_percent_encode(key.as_ref(), QUERY_SET).to_string(),
                utf8_percent_encode(value.as_ref(), QUERY_SET).to_string(),
            )
        })
        .collect::<Vec<_>>();
    entries.sort();
    entries
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

pub fn encode_model_id(model_id: &str) -> String {
    utf8_percent_encode(model_id, PATH_SET).to_string()
}

pub fn sign_headers(
    method: &str,
    url: &str,
    region: &str,
    body: &[u8],
    credentials: &AwsCredentials,
) -> Result<Vec<(String, String)>> {
    let url = Url::parse(url).map_err(|error| to_error(format!("invalid Bedrock URL: {error}")))?;
    let host = url
        .host_str()
        .ok_or_else(|| to_error("Bedrock URL is missing a host"))?;
    let now = OffsetDateTime::now_utc();
    let amz_date = now
        .format(AMZ_DATE_FORMAT)
        .map_err(|error| to_error(format!("failed to format AWS date: {error}")))?;
    let date_stamp = now
        .format(DATE_STAMP_FORMAT)
        .map_err(|error| to_error(format!("failed to format AWS date stamp: {error}")))?;
    let payload_hash = hex_sha256(body);

    let mut canonical_headers = vec![
        ("content-type".to_string(), "application/json".to_string()),
        ("host".to_string(), host.to_string()),
        ("x-amz-date".to_string(), amz_date.clone()),
    ];
    if let Some(session_token) = credentials.session_token.as_ref() {
        canonical_headers.push(("x-amz-security-token".to_string(), session_token.clone()));
    }
    canonical_headers.sort_by(|left, right| left.0.cmp(&right.0));

    let canonical_headers_text = canonical_headers
        .iter()
        .map(|(key, value)| format!("{key}:{}\n", value.trim()))
        .collect::<String>();
    let signed_headers = canonical_headers
        .iter()
        .map(|(key, _)| key.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        method.to_uppercase(),
        if url.path().is_empty() {
            "/"
        } else {
            url.path()
        },
        canonical_query_string(&url),
        canonical_headers_text,
        signed_headers,
        payload_hash,
    );
    let credential_scope = format!("{date_stamp}/{region}/bedrock/aws4_request");
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
        hex_sha256(canonical_request.as_bytes())
    );

    let k_date = hmac_sha256(
        format!("AWS4{}", credentials.secret_access_key).as_bytes(),
        date_stamp.as_bytes(),
    )?;
    let k_region = hmac_sha256(&k_date, region.as_bytes())?;
    let k_service = hmac_sha256(&k_region, b"bedrock")?;
    let signing_key = hmac_sha256(&k_service, b"aws4_request")?;
    let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes())?);
    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        credentials.access_key_id, credential_scope, signed_headers, signature,
    );

    let mut headers = vec![
        ("Authorization".to_string(), authorization),
        ("Content-Type".to_string(), "application/json".to_string()),
        ("X-Amz-Date".to_string(), amz_date),
    ];
    if let Some(session_token) = credentials.session_token.as_ref() {
        headers.push(("X-Amz-Security-Token".to_string(), session_token.clone()));
    }
    Ok(headers)
}
