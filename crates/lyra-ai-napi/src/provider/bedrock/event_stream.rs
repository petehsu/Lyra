use std::collections::BTreeMap;
use std::io::{ErrorKind, Read};
use std::sync::atomic::{AtomicBool, Ordering};

use crc32fast::Hasher;
use napi::Result;
use serde_json::Value;

use crate::error::to_error;

fn crc32(value: &[u8]) -> u32 {
    let mut hasher = Hasher::new();
    hasher.update(value);
    hasher.finalize()
}

fn read_optional_exact(reader: &mut impl Read, buffer: &mut [u8]) -> Result<bool> {
    let mut offset = 0;
    while offset < buffer.len() {
        match reader.read(&mut buffer[offset..]) {
            Ok(0) if offset == 0 => return Ok(false),
            Ok(0) => return Err(to_error("Bedrock stream ended unexpectedly")),
            Ok(read) => offset += read,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(to_error(format!("failed to read Bedrock stream: {error}"))),
        }
    }
    Ok(true)
}

fn parse_headers(mut bytes: &[u8]) -> Result<BTreeMap<String, String>> {
    let mut headers = BTreeMap::new();
    while bytes.is_empty() == false {
        if bytes.len() < 2 {
            return Err(to_error("invalid Bedrock event stream headers"));
        }
        let name_len = bytes[0] as usize;
        bytes = &bytes[1..];
        if bytes.len() < name_len + 1 {
            return Err(to_error("invalid Bedrock event stream header name"));
        }
        let name = String::from_utf8(bytes[..name_len].to_vec()).map_err(|error| {
            to_error(format!("invalid Bedrock event stream header name: {error}"))
        })?;
        bytes = &bytes[name_len..];
        let value_type = bytes[0];
        bytes = &bytes[1..];

        let value = match value_type {
            0 => "true".to_string(),
            1 => "false".to_string(),
            2 => {
                if bytes.is_empty() {
                    return Err(to_error("invalid Bedrock byte header"));
                }
                let value = bytes[0].to_string();
                bytes = &bytes[1..];
                value
            }
            3 => {
                if bytes.len() < 2 {
                    return Err(to_error("invalid Bedrock short header"));
                }
                let value = i16::from_be_bytes([bytes[0], bytes[1]]).to_string();
                bytes = &bytes[2..];
                value
            }
            4 => {
                if bytes.len() < 4 {
                    return Err(to_error("invalid Bedrock integer header"));
                }
                let value =
                    i32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]).to_string();
                bytes = &bytes[4..];
                value
            }
            5 | 8 => {
                if bytes.len() < 8 {
                    return Err(to_error("invalid Bedrock long header"));
                }
                let value = i64::from_be_bytes([
                    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                ])
                .to_string();
                bytes = &bytes[8..];
                value
            }
            6 | 7 => {
                if bytes.len() < 2 {
                    return Err(to_error("invalid Bedrock string header"));
                }
                let len = u16::from_be_bytes([bytes[0], bytes[1]]) as usize;
                bytes = &bytes[2..];
                if bytes.len() < len {
                    return Err(to_error("invalid Bedrock string header length"));
                }
                let value = String::from_utf8(bytes[..len].to_vec())
                    .map_err(|error| to_error(format!("invalid Bedrock string header: {error}")))?;
                bytes = &bytes[len..];
                value
            }
            9 => {
                if bytes.len() < 16 {
                    return Err(to_error("invalid Bedrock uuid header"));
                }
                let value = hex::encode(&bytes[..16]);
                bytes = &bytes[16..];
                value
            }
            _ => return Err(to_error("unsupported Bedrock event stream header type")),
        };
        headers.insert(name, value);
    }
    Ok(headers)
}

fn extract_error(payload: &Value) -> Option<String> {
    let error_keys = [
        "accessDeniedException",
        "internalServerException",
        "modelErrorException",
        "modelNotReadyException",
        "modelStreamErrorException",
        "serviceUnavailableException",
        "throttlingException",
        "validationException",
    ];

    error_keys.iter().find_map(|key| {
        payload.get(key).map(|value| {
            let message = value.get("message").and_then(Value::as_str).unwrap_or(key);
            format!("Amazon Bedrock {key}: {message}")
        })
    })
}

fn parse_payload(payload: &[u8], headers: &BTreeMap<String, String>) -> Result<Option<String>> {
    if payload.is_empty() {
        return Ok(None);
    }
    let value = serde_json::from_slice::<Value>(payload)
        .map_err(|error| to_error(format!("failed to parse Bedrock stream event: {error}")))?;
    if let Some(message) = extract_error(&value) {
        return Err(to_error(message));
    }
    if let Some(exception_type) = headers.get(":exception-type") {
        let message = value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or(exception_type);
        return Err(to_error(format!(
            "Amazon Bedrock {exception_type}: {message}"
        )));
    }
    if value.get("messageStop").is_some() {
        return Ok(Some(String::new()));
    }
    Ok(value
        .get("contentBlockDelta")
        .and_then(|entry| entry.get("delta"))
        .and_then(|entry| entry.get("text"))
        .and_then(Value::as_str)
        .map(str::to_string))
}

pub fn consume_event_stream(
    mut reader: impl Read,
    cancel_flag: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<String> {
    let mut full_response = String::new();

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(to_error("chat turn cancelled"));
        }

        let mut prelude = [0_u8; 12];
        if read_optional_exact(&mut reader, &mut prelude)? == false {
            break;
        }
        let total_len =
            u32::from_be_bytes([prelude[0], prelude[1], prelude[2], prelude[3]]) as usize;
        let headers_len =
            u32::from_be_bytes([prelude[4], prelude[5], prelude[6], prelude[7]]) as usize;
        let prelude_crc = u32::from_be_bytes([prelude[8], prelude[9], prelude[10], prelude[11]]);
        if total_len < 16 || headers_len > total_len.saturating_sub(16) {
            return Err(to_error("invalid Bedrock event stream prelude"));
        }
        if crc32(&prelude[..8]) != prelude_crc {
            return Err(to_error("invalid Bedrock event stream prelude checksum"));
        }

        let mut rest = vec![0_u8; total_len - 12];
        read_optional_exact(&mut reader, &mut rest)?;
        let message_crc = u32::from_be_bytes([
            rest[rest.len() - 4],
            rest[rest.len() - 3],
            rest[rest.len() - 2],
            rest[rest.len() - 1],
        ]);
        let mut message_bytes = prelude.to_vec();
        message_bytes.extend_from_slice(&rest[..rest.len() - 4]);
        if crc32(&message_bytes) != message_crc {
            return Err(to_error("invalid Bedrock event stream checksum"));
        }

        let headers = parse_headers(&rest[..headers_len])?;
        let payload = &rest[headers_len..rest.len() - 4];
        match parse_payload(payload, &headers)? {
            Some(delta) if delta.is_empty() => break,
            Some(delta) => {
                full_response.push_str(&delta);
                on_delta(&delta)?;
            }
            None => {}
        }
    }

    Ok(full_response)
}
