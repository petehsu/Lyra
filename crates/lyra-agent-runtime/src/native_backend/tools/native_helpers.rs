use super::*;

const DEFAULT_TOOL_RAW_CHARS: usize = 32_000;

pub(crate) fn budgeted_tool_output(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    content: String,
    raw: Value,
    recommended_next_action: Option<String>,
) -> Value {
    let content_char_count = content.chars().count();
    let (content, truncated, artifact_ref, truncated_reason) =
        if content_char_count > DEFAULT_TOOL_CONTENT_CHARS {
            let artifact_ref = write_tool_artifact(session_id, turn_id, tool_call_id, &content);
            (
                truncate_chars(&content, DEFAULT_TOOL_CONTENT_CHARS),
                true,
                artifact_ref,
                Some(format!(
                    "tool output exceeded {DEFAULT_TOOL_CONTENT_CHARS} characters"
                )),
            )
        } else {
            (content, false, None, None)
        };
    let (raw, raw_artifact_ref, raw_truncated_reason) =
        budgeted_raw_output(session_id, turn_id, tool_call_id, raw);
    json!({
        "content": content,
        "raw": raw,
        "truncated": truncated,
        "artifactRef": artifact_ref,
        "rawArtifactRef": raw_artifact_ref,
        "truncatedReason": truncated_reason,
        "rawTruncatedReason": raw_truncated_reason,
        "recommendedNextAction": recommended_next_action,
    })
}

fn budgeted_raw_output(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    raw: Value,
) -> (Value, Option<Value>, Option<String>) {
    let raw_text = serde_json::to_string_pretty(&raw)
        .or_else(|_| serde_json::to_string(&raw))
        .unwrap_or_else(|_| "null".to_string());
    let raw_chars = raw_text.chars().count();
    if raw_chars <= DEFAULT_TOOL_RAW_CHARS {
        return (raw, None, None);
    }

    let artifact_ref = write_tool_artifact_with_kind(
        session_id,
        turn_id,
        tool_call_id,
        ToolArtifactKind::RawData,
        &raw_text,
    );
    let policy_decision = raw.get("policyDecision").cloned();
    let envelope = json!({
        "kind": "tool_raw_ref",
        "retention": {
            "policy": "artifact_only_raw",
            "reason": "full raw tool output exceeded the model/session raw budget and was stored as an artifact",
            "originalChars": raw_chars,
        },
        "artifactRef": artifact_ref.clone(),
        "policyDecision": policy_decision,
    });
    (
        envelope,
        artifact_ref,
        Some(format!(
            "tool raw output exceeded {DEFAULT_TOOL_RAW_CHARS} characters"
        )),
    )
}

pub(crate) fn tool_failure_output(
    code: &str,
    message: &str,
    recommended_next_action: &str,
    detail: Option<Value>,
) -> Value {
    json!({
        "content": format!("Lyra tool failed: {message}"),
        "error": {
            "code": code,
            "message": message,
            "detail": detail,
        },
        "truncated": false,
        "artifactRef": Value::Null,
        "recommendedNextAction": recommended_next_action,
    })
}

pub(crate) fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut output = value.chars().take(max_chars).collect::<String>();
    output.push_str("\n\n[truncated]");
    output
}

pub(crate) fn value_string(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn required_value_string(input: &Value, key: &str) -> Result<String, NativeToolFailure> {
    value_string(input, key).ok_or_else(|| {
        NativeToolFailure::new(
            "bad_request",
            format!("{key} is required"),
            "Retry the tool call with the required input field.",
        )
    })
}

pub(crate) fn value_bool(input: &Value, key: &str, default: bool) -> bool {
    input.get(key).and_then(Value::as_bool).unwrap_or(default)
}

pub(crate) fn value_usize(input: &Value, key: &str, default: usize, max: usize) -> usize {
    input
        .get(key)
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(default)
        .max(1)
        .min(max)
}

pub(crate) fn value_u64(input: &Value, key: &str, default: u64, max: u64) -> u64 {
    input
        .get(key)
        .and_then(Value::as_u64)
        .unwrap_or(default)
        .max(1)
        .min(max)
}

pub(crate) fn session_workspace_root(session_id: &str) -> Result<PathBuf, NativeToolFailure> {
    let (project_bound, working_dir) = state()
        .lock()
        .map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the tool call.",
            )
        })?
        .sessions
        .get(session_id)
        .map(|session| {
            let project_bound = session
                .snapshot
                .get("projectBound")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let working_dir = session
                .snapshot
                .get("workingDir")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            (project_bound, working_dir)
        })
        .unwrap_or((false, String::new()));
    if !project_bound || working_dir.is_empty() {
        return Err(NativeToolFailure::new(
            "workspace_unbound",
            "session is not bound to a project",
            "Bind the session to an existing project root and retry.",
        ));
    }
    let root = PathBuf::from(working_dir);
    let root = if root.exists() {
        root.canonicalize().map_err(|error| {
            NativeToolFailure::new(
                "workspace_root_unavailable",
                format!("failed to canonicalize workspace root: {error}"),
                "Bind the session to an existing project root and retry.",
            )
        })?
    } else {
        return Err(NativeToolFailure::new(
            "workspace_root_unavailable",
            format!("workspace root does not exist: {}", root.display()),
            "Bind the session to an existing project root and retry.",
        ));
    };
    Ok(root)
}

pub(crate) fn resolve_workspace_path(
    session_id: &str,
    raw_path: &str,
    allow_missing_leaf: bool,
) -> Result<WorkspacePath, NativeToolFailure> {
    if raw_path.contains('\0') {
        return Err(NativeToolFailure::new(
            "permission_denied",
            "path contains a NUL byte",
            "Retry with a normal workspace-relative path.",
        ));
    }
    let root = session_workspace_root(session_id)?;
    let candidate = PathBuf::from(raw_path);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        root.join(candidate)
    };
    let absolute = if candidate.exists() {
        candidate.canonicalize().map_err(|error| {
            NativeToolFailure::new(
                "path_unavailable",
                format!("failed to canonicalize path: {error}"),
                "Retry with a readable workspace path.",
            )
        })?
    } else if allow_missing_leaf {
        let parent = candidate.parent().ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "path has no parent directory",
                "Retry with a file path inside the workspace.",
            )
        })?;
        let parent = parent.canonicalize().map_err(|error| {
            NativeToolFailure::new(
                "path_unavailable",
                format!("failed to canonicalize parent directory: {error}"),
                "Create the parent directory first or choose an existing parent.",
            )
        })?;
        let file_name = candidate.file_name().ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "path has no file name",
                "Retry with a file path inside the workspace.",
            )
        })?;
        parent.join(file_name)
    } else {
        return Err(NativeToolFailure::new(
            "path_not_found",
            format!("path does not exist: {}", candidate.display()),
            "Retry with an existing workspace path.",
        ));
    };
    if !absolute.starts_with(&root) {
        return Err(NativeToolFailure::new(
            "permission_denied",
            format!(
                "path is outside the session workspace: {}",
                absolute.display()
            ),
            "Use a path inside the bound project workspace.",
        )
        .with_detail(json!({
            "workspaceRoot": root.display().to_string(),
            "path": absolute.display().to_string(),
        })));
    }
    let relative = absolute
        .strip_prefix(&root)
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| absolute.display().to_string());
    Ok(WorkspacePath {
        root,
        absolute,
        relative: if relative.is_empty() {
            ".".to_string()
        } else {
            relative
        },
    })
}
