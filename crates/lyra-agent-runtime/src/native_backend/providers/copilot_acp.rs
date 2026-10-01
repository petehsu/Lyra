//! GitHub Copilot through the installed `copilot --acp` process.
//!
//! This is the second Copilot path. The direct API route stays the default.
//! The CLI path is used only when this route is selected and `copilot` is on PATH.

use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use crate::{AgentRuntimeError, AgentRuntimeResult};

pub(crate) fn command_line() -> (String, Vec<String>) {
    let command = std::env::var("LYRA_COPILOT_ACP_COMMAND")
        .or_else(|_| std::env::var("COPILOT_CLI_PATH"))
        .unwrap_or_else(|_| "copilot".to_string());
    let args = std::env::var("LYRA_COPILOT_ACP_ARGS")
        .ok()
        .map(|value| {
            value
                .split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .filter(|args| !args.is_empty())
        .unwrap_or_else(|| vec!["--acp".to_string(), "--stdio".to_string()]);
    (command, args)
}

pub(crate) fn initialize_request() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": 1,
            "clientInfo": {"name": "lyra", "title": "Lyra", "version": "0.0.0"}
        }
    })
}

pub(crate) fn prompt_request(session_id: &str, text: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 2,
        "method": "session/prompt",
        "params": {
            "sessionId": session_id,
            "prompt": [{"type": "text", "text": text}]
        }
    })
}

pub(crate) fn run_prompt(text: &str) -> AgentRuntimeResult<String> {
    let (command, args) = command_line();
    let mut child = Command::new(&command)
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            AgentRuntimeError::Core(format!(
                "GitHub Copilot CLI is not installed ({command}): {error}. Use the direct Copilot account instead."
            ))
        })?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AgentRuntimeError::Core("copilot stdin was not available".to_string()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AgentRuntimeError::Core("copilot stdout was not available".to_string()))?;
    let mut reader = BufReader::new(stdout);
    write_line(&mut stdin, &initialize_request())?;
    let _ = read_until_id(&mut reader, 1)?;
    let cwd = std::env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| ".".to_string());
    write_line(
        &mut stdin,
        &json!({"jsonrpc":"2.0","id":3,"method":"session/new","params":{"cwd": cwd, "mcpServers": []}}),
    )?;
    let created = read_until_id(&mut reader, 3)?;
    let session_id = created
        .pointer("/result/sessionId")
        .and_then(Value::as_str)
        .unwrap_or("session")
        .to_string();
    write_line(&mut stdin, &prompt_request(&session_id, text))?;
    let mut collected = String::new();
    for _ in 0..40 {
        let mut line = String::new();
        if reader
            .read_line(&mut line)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
            == 0
        {
            break;
        }
        let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
            continue;
        };
        if value
            .pointer("/params/update/sessionUpdate")
            .and_then(Value::as_str)
            == Some("agent_message_chunk")
        {
            if let Some(chunk) = value
                .pointer("/params/content/text")
                .and_then(Value::as_str)
            {
                collected.push_str(chunk);
            }
        }
        if value.get("id").and_then(Value::as_u64) == Some(2) {
            break;
        }
    }
    let _ = child.kill();
    Ok(collected)
}

fn write_line(stdin: &mut impl Write, value: &Value) -> AgentRuntimeResult<()> {
    writeln!(stdin, "{value}").map_err(|error| AgentRuntimeError::Core(error.to_string()))
}

fn read_until_id(reader: &mut impl BufRead, id: u64) -> AgentRuntimeResult<Value> {
    for _ in 0..20 {
        let mut line = String::new();
        if reader
            .read_line(&mut line)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
            == 0
        {
            break;
        }
        if let Ok(value) = serde_json::from_str::<Value>(line.trim()) {
            if value.get("id").and_then(Value::as_u64) == Some(id) {
                return Ok(value);
            }
        }
    }
    Err(AgentRuntimeError::Core(format!(
        "copilot ACP did not answer request {id}"
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acp_command_defaults_to_copilot_stdio() {
        let (command, args) = command_line();
        if std::env::var("LYRA_COPILOT_ACP_COMMAND").is_err()
            && std::env::var("COPILOT_CLI_PATH").is_err()
        {
            assert_eq!(command, "copilot");
        }
        if std::env::var("LYRA_COPILOT_ACP_ARGS").is_err() {
            assert_eq!(args, vec!["--acp".to_string(), "--stdio".to_string()]);
        }
    }

    #[test]
    fn acp_requests_name_the_methods() {
        assert_eq!(initialize_request()["method"], "initialize");
        assert_eq!(prompt_request("s1", "hi")["method"], "session/prompt");
        assert_eq!(
            prompt_request("s1", "hi")["params"]["prompt"][0]["text"],
            "hi"
        );
    }
}
