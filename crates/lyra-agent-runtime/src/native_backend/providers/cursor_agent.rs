//! Cursor AgentService connect frames.
//!
//! The first frame is the same `AgentRunRequest` shape used by the Cursor CLI:
//! prompt, model, and tool names travel in one protobuf message. Lyra owns the
//! tools; this only puts their names on the wire so the turn is not a bare prompt.

use serde_json::Value;

use crate::{AgentRuntimeError, AgentRuntimeResult};

pub(crate) fn connect_frame(payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 5);
    out.push(0);
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    out
}

fn split_fast(model: &str) -> (&str, bool) {
    model
        .strip_suffix("-fast")
        .map(|base| (base, true))
        .unwrap_or((model, false))
}

fn encode_model_meta(name: &str, fast: bool) -> Vec<u8> {
    let mut out = field_str(1, name);
    let mut fast_entry = field_str(1, "fast");
    fast_entry.extend(field_str(2, if fast { "true" } else { "false" }));
    out.extend(field_ld(3, &fast_entry));
    out
}

pub(crate) fn build_run_frame(prompt: &str, model: &str, tools: &[Value]) -> Vec<u8> {
    let mut message = field_str(1, prompt);
    message.extend(field_str(2, "lyra-msg"));
    message.extend(field_str(3, ""));
    message.extend(field_varint(4, 1));
    let messages = field_ld(2, &field_ld(1, &field_ld(1, &message)));
    let mut request = field_str(1, "");
    request.extend(messages);
    if tools.is_empty() {
        request.extend(field_str(4, ""));
    } else {
        let mut encoded = Vec::new();
        for tool in tools {
            let name = tool
                .get("function")
                .and_then(|function| function.get("name"))
                .or_else(|| tool.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("tool");
            encoded.extend(field_ld(1, &field_str(1, name)));
        }
        request.extend(field_ld(4, &encoded));
    }
    request.extend(field_str(5, "lyra-conv"));
    let (model_id, fast) = split_fast(model);
    let mut model_details = field_str(1, model_id);
    model_details.extend(field_str(3, model_id));
    model_details.extend(field_str(4, model_id));
    request.extend(field_ld(3, &model_details));
    // Field 9 and the catalog entries must carry the fast flag. Without it the
    // agent service can answer HTTP 200 and then only send heartbeats.
    request.extend(field_ld(9, &encode_model_meta(model_id, fast)));
    request.extend(field_varint(12, 0));
    request.extend(field_ld(14, &encode_model_meta("default", false)));
    request.extend(field_ld(14, &encode_model_meta(model_id, fast)));
    request.extend(field_str(16, "lyra-conv"));
    request.extend(field_str(25, "lyra-request"));
    connect_frame(&field_ld(1, &request))
}

pub(crate) fn assistant_text(frame_payload: &[u8]) -> String {
    let mut text = String::new();
    for field in iter_fields(frame_payload) {
        if field.field == 1 && field.wire == 2 {
            for inner in iter_fields(field.data) {
                if inner.field == 1 && inner.wire == 2 {
                    for leaf in iter_fields(inner.data) {
                        if leaf.field == 1 && leaf.wire == 2 {
                            text.push_str(&String::from_utf8_lossy(leaf.data));
                        }
                    }
                }
            }
        }
    }
    text
}

pub(crate) fn prompt_from_messages(messages: &[Value]) -> String {
    let mut out = String::new();
    for message in messages {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("user");
        let text = message
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if text.is_empty() {
            continue;
        }
        out.push_str(role);
        out.push_str(":\n");
        out.push_str(text);
        out.push_str("\n\n");
    }
    out
}

pub(crate) fn fetch_model_ids(
    access_token: &str,
) -> AgentRuntimeResult<Vec<(String, Option<String>)>> {
    let url = format!(
        "https://{}/agent.v1.AgentService/GetUsableModels",
        agent_host()
    );
    let response = cursor_client()?
        .post(url)
        .headers(cursor_headers(access_token))
        .header("content-type", "application/proto")
        .body(Vec::<u8>::new())
        .send()
        .map_err(|error| transport_error("Cursor model list", error))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "Cursor model list failed: {status} {}",
            String::from_utf8_lossy(&bytes)
        )));
    }
    decode_usable_models(&bytes)
}

pub(crate) fn send_run(
    access_token: &str,
    model: &str,
    messages: &[Value],
    tools: &[Value],
) -> AgentRuntimeResult<String> {
    let frame = build_run_frame(&prompt_from_messages(messages), model, tools);
    let response = cursor_client()?
        .post(format!(
            "https://{}/agent.v1.AgentService/Run",
            agent_host()
        ))
        .headers(cursor_headers(access_token))
        .header("content-type", "application/connect+proto")
        .body(frame)
        .send()
        .map_err(|error| transport_error("Cursor agent request", error))?;
    let status = response.status();
    let bytes = response
        .bytes()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "Cursor agent request failed: {status} {}",
            String::from_utf8_lossy(&bytes)
        )));
    }
    if let Some(error) = connect_trailer_error(&bytes) {
        return Err(AgentRuntimeError::Core(format!(
            "Cursor agent request failed: {error}"
        )));
    }
    let text = assistant_text_from_frames(&bytes);
    if text.trim().is_empty() {
        return Err(AgentRuntimeError::Core(format!(
            "Cursor returned no assistant text for {model}"
        )));
    }
    Ok(text)
}

fn cursor_client() -> AgentRuntimeResult<reqwest::blocking::Client> {
    // The http2 feature negotiates HTTP/2 with ALPN. Prior-knowledge mode skips
    // that handshake and can stall the request with no status.
    reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))
}

fn transport_error(prefix: &str, error: reqwest::Error) -> AgentRuntimeError {
    use std::error::Error;
    let mut detail = error.to_string();
    let mut source = error.source();
    while let Some(next) = source {
        detail.push_str(": ");
        detail.push_str(&next.to_string());
        source = next.source();
    }
    AgentRuntimeError::Core(format!("{prefix}: {detail}"))
}

fn cursor_headers(access_token: &str) -> reqwest::header::HeaderMap {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(&format!("Bearer {access_token}"))
            .unwrap_or(reqwest::header::HeaderValue::from_static("Bearer")),
    );
    headers.insert(
        "connect-protocol-version",
        reqwest::header::HeaderValue::from_static("1"),
    );
    headers.insert(
        "x-ghost-mode",
        reqwest::header::HeaderValue::from_static("true"),
    );
    headers.insert(
        "x-cursor-client-type",
        reqwest::header::HeaderValue::from_static("cli"),
    );
    if let Ok(version) = reqwest::header::HeaderValue::from_str(&client_version()) {
        headers.insert("x-cursor-client-version", version);
    }
    if let Ok(session) = reqwest::header::HeaderValue::from_str(&session_id(access_token)) {
        headers.insert("x-session-id", session);
    }
    headers
}

fn client_version() -> String {
    if let Some(version) = std::env::var("LYRA_CURSOR_CLIENT_VERSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return version;
    }
    installed_cli_build()
        .map(|version| format!("cli-{version}"))
        .unwrap_or_else(|| "cli-2026.08.25-3e8eec8".to_string())
}

fn installed_cli_build() -> Option<String> {
    let home = dirs::home_dir()?;
    let resolved = std::fs::canonicalize(home.join(".local/bin/cursor-agent")).ok()?;
    let mut components = resolved.components();
    while let Some(component) = components.next() {
        if component.as_os_str() == "versions" {
            let version = components.next()?.as_os_str().to_str()?.to_string();
            return Some(version);
        }
    }
    None
}

fn agent_host() -> String {
    if let Some(host) = std::env::var("LYRA_CURSOR_AGENT_HOST")
        .ok()
        .map(|value| {
            value
                .trim()
                .trim_start_matches("https://")
                .trim_start_matches("http://")
                .trim_end_matches('/')
                .to_string()
        })
        .filter(|value| !value.is_empty())
    {
        return host;
    }
    if let Some(home) = dirs::home_dir() {
        if let Ok(text) = std::fs::read_to_string(home.join(".cursor/cli-config.json")) {
            if let Ok(value) = serde_json::from_str::<Value>(&text) {
                if let Some(host) = value
                    .pointer("/serverConfigCache/agentUrlConfig/agentnUrl")
                    .or_else(|| value.pointer("/serverConfigCache/agentUrlConfig/agentUrl"))
                    .and_then(Value::as_str)
                    .and_then(bare_host)
                {
                    return host;
                }
            }
        }
    }
    "agentn.global.api5.cursor.sh".to_string()
}

fn bare_host(raw: &str) -> Option<String> {
    let raw = raw
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = raw.split(['/', ':']).next()?.trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}

fn session_id(access_token: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(access_token.as_bytes());
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        digest[0],
        digest[1],
        digest[2],
        digest[3],
        digest[4],
        digest[5],
        digest[6],
        digest[7],
        digest[8],
        digest[9],
        digest[10],
        digest[11],
        digest[12],
        digest[13],
        digest[14],
        digest[15]
    )
}

pub(crate) fn decode_usable_models(
    mut payload: &[u8],
) -> AgentRuntimeResult<Vec<(String, Option<String>)>> {
    if payload.len() >= 5 && (payload[0] == 0 || payload[0] == 1) {
        let framed_len =
            u32::from_be_bytes([payload[1], payload[2], payload[3], payload[4]]) as usize;
        if framed_len == payload.len().saturating_sub(5) {
            payload = &payload[5..];
        }
    }
    let mut models = Vec::new();
    for field in iter_fields(payload) {
        if field.field != 1 || field.wire != 2 {
            continue;
        }
        let model_id = iter_fields(field.data)
            .find(|nested| nested.field == 1 && nested.wire == 2)
            .and_then(|nested| std::str::from_utf8(nested.data).ok())
            .map(str::trim)
            .filter(|model| !model.is_empty());
        if let Some(model) = model_id {
            if !models.iter().any(|(known, _)| known == model) {
                models.push((model.to_string(), None));
            }
        }
    }
    if models.is_empty() {
        return Err(AgentRuntimeError::Core(
            "Cursor returned no usable models for this account".to_string(),
        ));
    }
    Ok(models)
}

fn assistant_text_from_frames(bytes: &[u8]) -> String {
    let mut text = String::new();
    let mut rest = bytes;
    let mut saw_frame = false;
    while rest.len() >= 5 {
        let flag = rest[0];
        let len = u32::from_be_bytes([rest[1], rest[2], rest[3], rest[4]]) as usize;
        if rest.len() < 5 + len {
            break;
        }
        let payload = &rest[5..5 + len];
        rest = &rest[5 + len..];
        saw_frame = true;
        if flag & 0x01 != 0 || flag & 0x02 != 0 {
            continue;
        }
        text.push_str(&assistant_text(payload));
    }
    if saw_frame {
        text
    } else {
        assistant_text(bytes)
    }
}

fn connect_trailer_error(bytes: &[u8]) -> Option<String> {
    let mut rest = bytes;
    while rest.len() >= 5 {
        let flag = rest[0];
        let len = u32::from_be_bytes([rest[1], rest[2], rest[3], rest[4]]) as usize;
        if rest.len() < 5 + len {
            return None;
        }
        let payload = &rest[5..5 + len];
        rest = &rest[5 + len..];
        if flag & 0x02 == 0 {
            continue;
        }
        let Ok(value) = serde_json::from_slice::<Value>(payload) else {
            continue;
        };
        let error = value.get("error")?;
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .filter(|message| !message.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| error.to_string());
        return Some(message);
    }
    None
}

struct PbField<'a> {
    field: u64,
    wire: u8,
    data: &'a [u8],
}

fn iter_fields(mut buf: &[u8]) -> impl Iterator<Item = PbField<'_>> {
    std::iter::from_fn(move || {
        if buf.is_empty() {
            return None;
        }
        let (tag, rest) = read_varint(buf)?;
        let field = tag >> 3;
        let wire = (tag & 7) as u8;
        buf = rest;
        match wire {
            0 => {
                let (_value, rest) = read_varint(buf)?;
                buf = rest;
                Some(PbField {
                    field,
                    wire,
                    data: &[],
                })
            }
            1 => {
                if buf.len() < 8 {
                    return None;
                }
                buf = &buf[8..];
                Some(PbField {
                    field,
                    wire,
                    data: &[],
                })
            }
            5 => {
                if buf.len() < 4 {
                    return None;
                }
                buf = &buf[4..];
                Some(PbField {
                    field,
                    wire,
                    data: &[],
                })
            }
            2 => {
                let (len, rest) = read_varint(buf)?;
                let len = len as usize;
                if rest.len() < len {
                    return None;
                }
                let (data, rest) = rest.split_at(len);
                buf = rest;
                Some(PbField { field, wire, data })
            }
            _ => None,
        }
    })
}

fn field_str(field: u64, value: &str) -> Vec<u8> {
    field_ld(field, value.as_bytes())
}

fn field_varint(field: u64, value: u64) -> Vec<u8> {
    let mut out = Vec::new();
    write_varint((field << 3) | 0, &mut out);
    write_varint(value, &mut out);
    out
}

fn field_ld(field: u64, data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    write_varint((field << 3) | 2, &mut out);
    write_varint(data.len() as u64, &mut out);
    out.extend_from_slice(data);
    out
}

fn write_varint(mut value: u64, out: &mut Vec<u8>) {
    loop {
        let mut byte = (value & 0x7f) as u8;
        value >>= 7;
        if value != 0 {
            byte |= 0x80;
        }
        out.push(byte);
        if value == 0 {
            break;
        }
    }
}

fn read_varint(buf: &[u8]) -> Option<(u64, &[u8])> {
    let mut value = 0_u64;
    let mut shift = 0;
    for (index, byte) in buf.iter().enumerate() {
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Some((value, &buf[index + 1..]));
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn run_frame_carries_the_prompt_model_and_tool_name() {
        let frame = build_run_frame(
            "hello cursor",
            "composer-1.5",
            &[json!({"function": {"name": "web_search"}})],
        );
        assert_eq!(frame[0], 0);
        let len = u32::from_be_bytes([frame[1], frame[2], frame[3], frame[4]]) as usize;
        assert_eq!(frame.len(), len + 5);
        let payload = &frame[5..];
        let text = String::from_utf8_lossy(payload);
        assert!(text.contains("hello cursor"));
        assert!(text.contains("composer-1.5"));
        assert!(text.contains("web_search"));
    }

    #[test]
    fn usable_models_decode_reads_model_ids_and_rejects_an_empty_catalog() {
        let payload = field_ld(1, &field_str(1, "gpt-5.4"));
        let models = decode_usable_models(&payload).expect("models");
        assert_eq!(models, vec![("gpt-5.4".to_string(), None)]);
        let error = decode_usable_models(&[]).expect_err("empty catalog");
        assert!(error.to_string().contains("no usable models"));
    }

    #[test]
    fn live_catalog_negotiates_http2_when_requested() {
        if std::env::var("LYRA_CURSOR_LIVE").ok().as_deref() != Some("1") {
            return;
        }
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let path = home.join(".config/Cursor/User/globalStorage/state.vscdb");
        let connection = rusqlite::Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .expect("cursor state");
        let token: String = connection
            .query_row(
                "SELECT value FROM ItemTable WHERE key = ?1",
                ["cursorAuth/accessToken"],
                |row| row.get(0),
            )
            .expect("access token");
        let models = fetch_model_ids(&token).expect("usable models");
        assert!(models.len() > 10);
        assert!(models.iter().all(|(id, _)| id != "composer-1.5"));
    }
}
