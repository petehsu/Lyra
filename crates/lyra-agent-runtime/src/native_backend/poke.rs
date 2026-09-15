use super::*;
use std::collections::VecDeque;

static PENDING_TERMINAL_POKES: OnceLock<Mutex<HashMap<String, VecDeque<String>>>> = OnceLock::new();

fn pending_terminal_pokes() -> &'static Mutex<HashMap<String, VecDeque<String>>> {
    PENDING_TERMINAL_POKES.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn enqueue_idle_session_poke(session_id: &str, prompt: String) {
    enqueue_terminal_poke(session_id, prompt);
}

fn enqueue_terminal_poke(session_id: &str, prompt: String) {
    if let Ok(mut pending) = pending_terminal_pokes().lock() {
        let queue = pending.entry(session_id.to_string()).or_default();
        if prompt == super::subagent::SUBAGENT_ROSTER_POKE_MARKER
            && queue
                .iter()
                .any(|item| item == super::subagent::SUBAGENT_ROSTER_POKE_MARKER)
        {
            return;
        }
        queue.push_back(prompt);
    }
}

fn take_terminal_pokes(session_id: &str) -> Vec<String> {
    pending_terminal_pokes()
        .lock()
        .ok()
        .and_then(|mut pending| pending.remove(session_id))
        .map(|queued| queued.into_iter().collect())
        .unwrap_or_default()
}

fn terminal_exit_prompt(payload: &Value) -> String {
    let terminal = payload.get("terminal").cloned().unwrap_or(Value::Null);
    let session = terminal
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let command_id = terminal
        .get("commandId")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let status = terminal
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let exit_code = terminal
        .get("exitCode")
        .and_then(Value::as_i64)
        .map(|code| code.to_string())
        .unwrap_or_else(|| "null".to_string());
    let command_text = terminal
        .get("commandText")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(200)
        .collect::<String>();
    let mut lines = vec![
        "A background terminal command has exited.".to_string(),
        format!("terminalSessionId={session}"),
        format!("commandId={command_id}"),
        format!("status={status}"),
        format!("exitCode={exit_code}"),
    ];
    if !command_text.is_empty() {
        lines.push(format!("command={command_text}"));
    }
    if let Some(path) = terminal
        .get("commandSummaryPath")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
    {
        lines.push(format!("commandSummaryPath={path}"));
    }
    if let Some(path) = terminal
        .get("commandOutputTextPath")
        .and_then(Value::as_str)
        .filter(|path| !path.is_empty())
    {
        lines.push(format!("commandOutputTextPath={path}"));
    }
    lines.push(
        "Inspect with terminal_read if you need output, then continue or stop as appropriate."
            .to_string(),
    );
    lines.join("\n")
}

fn exec_command_exit_prompt(payload: &Value) -> String {
    let command = payload.get("command").cloned().unwrap_or(Value::Null);
    let command_text = command
        .get("commandText")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(200)
        .collect::<String>();
    let pid = command
        .get("pid")
        .and_then(Value::as_u64)
        .map(|pid| pid.to_string())
        .unwrap_or_else(|| "unknown".to_string());
    let status = command
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let exit_code = command
        .get("exitCode")
        .and_then(Value::as_i64)
        .map(|code| code.to_string())
        .unwrap_or_else(|| "null".to_string());
    let stdout = command
        .get("stdout")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(1500)
        .collect::<String>();
    let stderr = command
        .get("stderr")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(1500)
        .collect::<String>();
    let mut lines = vec![
        "A command whose predicted wait had already elapsed has now exited.".to_string(),
        format!("pid={pid}"),
        format!("status={status}"),
        format!("exitCode={exit_code}"),
    ];
    if !command_text.is_empty() {
        lines.push(format!("command={command_text}"));
    }
    if !stdout.is_empty() {
        lines.push(format!("stdout:\n{stdout}"));
    }
    if !stderr.is_empty() {
        lines.push(format!("stderr:\n{stderr}"));
    }
    lines.push("Inspect if needed, then continue or stop. Do not poll on a timer.".to_string());
    lines.join("\n")
}

fn command_exit_prompt(payload: &Value) -> String {
    if string_opt(payload, "reason").as_deref() == Some("exec_command_exited") {
        exec_command_exit_prompt(payload)
    } else {
        terminal_exit_prompt(payload)
    }
}

fn start_terminal_exit_turn(session_id: &str, prompt: &str) -> AgentRuntimeResult<Value> {
    let mut result = send_turn(json!({
        "sessionId": session_id,
        "text": prompt,
        "uiHidden": true,
        "terminalExit": true,
        "onlyIfIdle": true
    }))?;
    if result.get("sent") == Some(&Value::Bool(false)) {
        enqueue_terminal_poke(session_id, prompt.to_string());
        return Ok(result);
    }
    if let Some(object) = result.as_object_mut() {
        object.entry("sent".to_string()).or_insert(json!(true));
    }
    Ok(result)
}

pub(crate) fn coalesce_terminal_poke_prompts(session_id: &str, prompts: Vec<String>) -> String {
    let has_roster = prompts
        .iter()
        .any(|prompt| prompt == super::subagent::SUBAGENT_ROSTER_POKE_MARKER);
    let mut parts = prompts
        .into_iter()
        .filter(|prompt| prompt != super::subagent::SUBAGENT_ROSTER_POKE_MARKER)
        .collect::<Vec<_>>();
    if has_roster {
        parts.insert(
            0,
            background_workers_roster_prompt(&worker_roster_buckets(session_id)),
        );
    }
    parts.join("\n\n")
}

pub(crate) fn flush_pending_terminal_pokes(session_id: &str) {
    let prompts = take_terminal_pokes(session_id);
    if prompts.is_empty() {
        return;
    }
    let prompt = coalesce_terminal_poke_prompts(session_id, prompts);
    if prompt.trim().is_empty() {
        return;
    }
    let _ = start_terminal_exit_turn(session_id, &prompt);
}

pub(crate) fn notify_exec_command_exit(payload: Value) {
    let _ = poke_session(payload);
}

#[cfg(test)]
pub(crate) fn queued_command_exit_notice_count(session_id: &str) -> usize {
    pending_terminal_pokes()
        .lock()
        .map(|pending| pending.get(session_id).map(VecDeque::len).unwrap_or(0))
        .unwrap_or(0)
}

pub(crate) fn poke_session(payload: Value) -> AgentRuntimeResult<Value> {
    let reason = string_opt(&payload, "reason").unwrap_or_default();
    if reason != "terminal_command_completed" && reason != "exec_command_exited" {
        return Ok(json!({
            "sent": false,
            "reason": "unsupported_poke"
        }));
    }
    let prompt = command_exit_prompt(&payload);
    let mut state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let session_id = state.resolve_session_id(string_opt(&payload, "sessionId"))?;
    let session = state
        .sessions
        .get(&session_id)
        .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
    let turn_status = session
        .snapshot
        .get("turnStatus")
        .and_then(Value::as_str)
        .unwrap_or("idle");
    if turn_status != "idle" {
        enqueue_terminal_poke(&session_id, prompt);
        return Ok(json!({
            "sessionId": session_id,
            "sent": false,
            "queued": true,
            "reason": "session_not_idle"
        }));
    }
    drop(state);
    start_terminal_exit_turn(&session_id, &prompt)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unsupported_poke_is_ignored() {
        let result = poke_session(json!({ "reason": "unknown" })).expect("poke");
        assert_eq!(result["sent"], false);
        assert_eq!(result["reason"], "unsupported_poke");
    }

    #[test]
    fn terminal_exit_prompt_includes_exit_metadata() {
        let prompt = terminal_exit_prompt(&json!({
            "terminal": {
                "sessionId": "terminal-1",
                "commandId": "command-1",
                "status": "completed",
                "exitCode": 0,
                "commandText": "npm test",
                "commandSummaryPath": "/tmp/summary.json",
                "commandOutputTextPath": "/tmp/output.txt"
            }
        }));
        assert!(prompt.contains("A background terminal command has exited."));
        assert!(prompt.contains("terminalSessionId=terminal-1"));
        assert!(prompt.contains("commandId=command-1"));
        assert!(prompt.contains("exitCode=0"));
        assert!(prompt.contains("command=npm test"));
        assert!(prompt.contains("terminal_read"));
    }

    #[test]
    fn exec_exit_prompt_includes_process_metadata() {
        let prompt = exec_command_exit_prompt(&json!({
            "command": {
                "commandText": "git clone https://example.com/repo.git",
                "pid": 4242,
                "status": "completed",
                "exitCode": 128,
                "stderr": "fatal: unable to access"
            }
        }));
        assert!(prompt.contains("predicted wait had already elapsed"));
        assert!(prompt.contains("pid=4242"));
        assert!(prompt.contains("exitCode=128"));
        assert!(prompt.contains("git clone"));
        assert!(prompt.contains("fatal: unable to access"));
    }

    #[test]
    fn roster_markers_dedupe_in_the_idle_queue() {
        let session_id = "session-roster-dedupe";
        for _ in 0..8 {
            enqueue_idle_session_poke(session_id, SUBAGENT_ROSTER_POKE_MARKER.to_string());
        }
        assert_eq!(queued_command_exit_notice_count(session_id), 1);
        let _ = take_terminal_pokes(session_id);
    }

    #[test]
    fn coalesce_replaces_eight_markers_with_one_roster() {
        let prompt = coalesce_terminal_poke_prompts(
            "session-missing",
            vec![
                SUBAGENT_ROSTER_POKE_MARKER.to_string(),
                SUBAGENT_ROSTER_POKE_MARKER.to_string(),
                "A background terminal command has exited.".to_string(),
            ],
        );
        assert_eq!(
            prompt
                .matches("This notice is not the member request")
                .count(),
            1
        );
        assert!(prompt.contains("A background terminal command has exited."));
        assert!(prompt.contains("Background workers updated"));
    }
}
