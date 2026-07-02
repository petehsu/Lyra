use super::*;
use std::borrow::Cow;
use std::path::Component;

const DEFAULT_TOOL_RAW_CHARS: usize = 32_000;
const BROWSER_MAP_TOOL_CONTENT_CHARS: usize = 8_000;

pub(crate) fn tool_content_char_budget(display_name: &str, action: &str) -> usize {
    if display_name == "lyra_lumen" && matches!(action, "map" | "see" | "read") {
        BROWSER_MAP_TOOL_CONTENT_CHARS
    } else {
        DEFAULT_TOOL_CONTENT_CHARS
    }
}

pub(crate) fn budgeted_tool_output(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    content: String,
    raw: Value,
    recommended_next_action: Option<String>,
) -> Value {
    budgeted_tool_output_with_budget(
        session_id,
        turn_id,
        tool_call_id,
        content,
        raw,
        recommended_next_action,
        DEFAULT_TOOL_CONTENT_CHARS,
    )
}

pub(crate) fn budgeted_browser_tool_output(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    content: String,
    raw: Value,
    recommended_next_action: Option<String>,
) -> Value {
    budgeted_tool_output_with_budget(
        session_id,
        turn_id,
        tool_call_id,
        content,
        raw,
        recommended_next_action,
        tool_content_char_budget(display_name, action),
    )
}

fn budgeted_tool_output_with_budget(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    content: String,
    raw: Value,
    recommended_next_action: Option<String>,
    content_budget: usize,
) -> Value {
    let content_char_count = content.chars().count();
    let (content, truncated, artifact_ref, truncated_reason) =
        if content_char_count > content_budget {
            let artifact_ref = write_tool_artifact(session_id, turn_id, tool_call_id, &content);
            (
                truncate_chars(&content, content_budget),
                true,
                artifact_ref,
                Some(format!("tool output exceeded {content_budget} characters")),
            )
        } else {
            (content, false, None, None)
        };
    let (raw, raw_artifact_ref, raw_truncated_reason) =
        budgeted_raw_output(session_id, turn_id, tool_call_id, raw);
    let activity_kind = raw
        .get("activityKind")
        .and_then(Value::as_str)
        .map(str::to_string);
    let renderer_hint = raw
        .get("rendererHint")
        .and_then(Value::as_str)
        .map(str::to_string);
    json!({
        "content": content,
        "raw": raw,
        "truncated": truncated,
        "artifactRef": artifact_ref,
        "rawArtifactRef": raw_artifact_ref,
        "truncatedReason": truncated_reason,
        "rawTruncatedReason": raw_truncated_reason,
        "recommendedNextAction": recommended_next_action,
        "activityKind": activity_kind,
        "rendererHint": renderer_hint,
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
    let mut envelope = json!({
        "kind": "tool_raw_ref",
        "retention": {
            "policy": "artifact_only_raw",
            "reason": "full raw tool output exceeded the model/session raw budget and was stored as an artifact",
            "originalChars": raw_chars,
        },
        "artifactRef": artifact_ref.clone(),
        "policyDecision": policy_decision,
    });
    preserve_raw_timeline_facts(&raw, &mut envelope);
    (
        envelope,
        artifact_ref,
        Some(format!(
            "tool raw output exceeded {DEFAULT_TOOL_RAW_CHARS} characters"
        )),
    )
}

fn preserve_raw_timeline_facts(raw: &Value, envelope: &mut Value) {
    let Some(object) = envelope.as_object_mut() else {
        return;
    };
    for key in [
        "activityKind",
        "rendererHint",
        "changedFiles",
        "diffArtifactRef",
        "beforeRef",
        "afterRef",
        "artifactRefs",
        "policyDecision",
    ] {
        if let Some(value) = raw.get(key) {
            object.insert(key.to_string(), value.clone());
        }
    }
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
    // A session that is not bound to a project (the user sent a message without
    // choosing a directory) defaults to the user's home directory, mirroring the
    // shell tool's `shell_base_dir` fallback. This keeps shell and filesystem
    // tools operating in the same place instead of rejecting fs work outright.
    if !project_bound || working_dir.is_empty() {
        let home = dirs::home_dir().ok_or_else(|| {
            NativeToolFailure::new(
                "workspace_unbound",
                "session is not bound to a project and the home directory is unavailable",
                "Bind the session to an existing project root and retry.",
            )
        })?;
        return home.canonicalize().map_err(|error| {
            NativeToolFailure::new(
                "workspace_root_unavailable",
                format!("failed to canonicalize home workspace root: {error}"),
                "Bind the session to an existing project root and retry.",
            )
        });
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

/// Expand a leading `~` / `~/` (POSIX) or `~\` (Windows) prefix to the user's
/// home directory. Other tilde variants (`~user`, `~+`, `~-`, `~1`, ...) are
/// rejected because Rust's `Path` treats `~` as a normal component name, so
/// they would otherwise be silently joined onto the workspace root and create
/// a literal `~` directory under it (see the "files written to ~/Documents
/// then reported missing" regression). Mirrors Claude Code's `expandPath` /
/// `expandTilde` pair: expand the two safe forms, reject everything else.
fn expand_tilde_prefix(raw: &str) -> Result<Cow<'_, str>, NativeToolFailure> {
    let trimmed = raw.trim();
    if !trimmed.starts_with('~') {
        return Ok(Cow::Borrowed(raw));
    }
    let is_bare_home = trimmed == "~";
    let is_slash_prefixed =
        trimmed.starts_with("~/") || (cfg!(windows) && trimmed.starts_with("~\\"));
    if !is_bare_home && !is_slash_prefixed {
        // `~root`, `~+`, `~-`, `~1`, ... are not expandable by us and must not
        // fall through to the workspace-relative branch where they would create
        // a literal `~...` directory.
        return Err(NativeToolFailure::new(
            "bad_request",
            format!("unsupported tilde expansion in path: {trimmed}"),
            "Use an absolute path, a workspace-relative path, or a ~/ home-relative path. Variants like ~user, ~+, ~- are rejected.",
        ));
    }
    let home = dirs::home_dir().ok_or_else(|| {
        NativeToolFailure::new(
            "workspace_unbound",
            "home directory is unavailable for tilde expansion",
            "Use an absolute path or bind the session to a project root and retry.",
        )
    })?;
    let home = home.display().to_string();
    if is_bare_home {
        Ok(Cow::Owned(home))
    } else {
        // Keep the separator and the rest of the path intact.
        Ok(Cow::Owned(format!("{home}{}", &trimmed[1..])))
    }
}

fn resolve_session_absolute_path(
    session_id: &str,
    raw_path: &str,
    allow_missing_leaf: bool,
) -> Result<(PathBuf, PathBuf), NativeToolFailure> {
    if raw_path.contains('\0') {
        return Err(NativeToolFailure::new(
            "bad_request",
            "path contains a NUL byte",
            "Retry with a normal filesystem path.",
        ));
    }
    // Expand `~`/`~/` to the home directory before any Path handling so that
    // `~/Documents/x` resolves to `<home>/Documents/x` instead of being joined
    // onto the workspace root as a literal `~` component.
    let raw_path = expand_tilde_prefix(raw_path)?;
    let root = session_workspace_root(session_id)?;
    let candidate = PathBuf::from(raw_path.as_ref());
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        root.join(normalize_workspace_relative_path(&root, &candidate))
    };
    let absolute = if candidate.exists() {
        candidate.canonicalize().map_err(|error| {
            NativeToolFailure::new(
                "path_unavailable",
                format!("failed to canonicalize path: {error}"),
                "Retry with a readable path.",
            )
        })?
    } else if allow_missing_leaf {
        resolve_missing_candidate_path(&candidate)?
    } else {
        return Err(NativeToolFailure::new(
            "path_not_found",
            format!("path does not exist: {}", candidate.display()),
            "Retry with an existing path.",
        ));
    };
    Ok((root, absolute))
}

fn normalize_workspace_relative_path(root: &Path, path: &Path) -> PathBuf {
    let mut components = path.components();
    let Some(Component::Normal(first)) = components.next() else {
        return path.to_path_buf();
    };
    let Some(root_name) = root.file_name() else {
        return path.to_path_buf();
    };
    if first != root_name {
        return path.to_path_buf();
    }
    let rest = components.collect::<PathBuf>();
    if rest.as_os_str().is_empty() {
        path.to_path_buf()
    } else {
        rest
    }
}

fn resolve_missing_candidate_path(candidate: &Path) -> Result<PathBuf, NativeToolFailure> {
    let mut ancestor = candidate;
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "path has no existing ancestor",
                "Retry with a path whose drive or root directory exists.",
            )
        })?;
    }
    let suffix = candidate.strip_prefix(ancestor).map_err(|error| {
        NativeToolFailure::new(
            "path_unavailable",
            format!("failed to resolve missing path suffix: {error}"),
            "Retry with a normal filesystem path.",
        )
    })?;
    let mut absolute = ancestor.canonicalize().map_err(|error| {
        NativeToolFailure::new(
            "path_unavailable",
            format!("failed to canonicalize path ancestor: {error}"),
            "Retry with a path whose existing ancestor is readable.",
        )
    })?;
    for component in suffix.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => {
                return Err(NativeToolFailure::new(
                    "bad_request",
                    "missing path suffix unexpectedly contains an absolute prefix",
                    "Retry with a normal filesystem path.",
                ));
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if !absolute.pop() {
                    return Err(NativeToolFailure::new(
                        "path_unavailable",
                        "path escapes above the filesystem root",
                        "Retry with a normal filesystem path.",
                    ));
                }
            }
            Component::Normal(value) => absolute.push(value),
        }
    }
    Ok(absolute)
}

pub(crate) fn path_escapes_session_workspace(
    session_id: &str,
    raw_path: &str,
    allow_missing_leaf: bool,
) -> Result<Option<(PathBuf, PathBuf)>, NativeToolFailure> {
    let (root, absolute) = resolve_session_absolute_path(session_id, raw_path, allow_missing_leaf)?;
    if absolute.starts_with(&root) {
        return Ok(None);
    }
    Ok(Some((root, absolute)))
}

pub(crate) fn resolve_workspace_path(
    session_id: &str,
    raw_path: &str,
    allow_missing_leaf: bool,
) -> Result<WorkspacePath, NativeToolFailure> {
    let (root, absolute) = resolve_session_absolute_path(session_id, raw_path, allow_missing_leaf)?;
    let outside_workspace = !absolute.starts_with(&root);
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
        outside_workspace,
    })
}

pub(crate) fn filesystem_path_permission_candidates(
    display_name: &str,
    action: &str,
    input: &Value,
) -> Vec<(String, bool)> {
    match (display_name, action) {
        ("file", "glob") => vec![(
            value_string(input, "root").unwrap_or_else(|| ".".to_string()),
            false,
        )],
        ("file", "list") => vec![(
            value_string(input, "path").unwrap_or_else(|| ".".to_string()),
            false,
        )],
        ("file", "multiedit") => {
            let mut paths = Vec::new();
            if let Some(path) = value_string(input, "path") {
                paths.push((path, false));
            }
            if let Some(edits) = input.get("edits").and_then(Value::as_array) {
                for edit in edits {
                    if let Some(path) = value_string(edit, "path") {
                        paths.push((path, false));
                    }
                }
            }
            paths
        }
        ("file", "apply_patch") => {
            let mut paths = Vec::new();
            if let Some(operations) = input.get("operations").and_then(Value::as_array) {
                for operation in operations {
                    if let Some(path) = value_string(operation, "path") {
                        let allow_missing = operation
                            .get("op")
                            .and_then(Value::as_str)
                            .is_some_and(|op| op == "add");
                        paths.push((path, allow_missing));
                    }
                    if let Some(new_path) = value_string(operation, "newPath") {
                        paths.push((new_path, true));
                    }
                }
            }
            paths
        }
        ("file", "write" | "read" | "edit" | "strict_edit") => value_string(input, "path")
            .map(|path| vec![(path, matches!(action, "write"))])
            .unwrap_or_default(),
        ("search", "project")
        | ("code", "search_text" | "grep_text" | "search_symbol" | "graph_expand") => {
            if let Some(path) = value_string(input, "root").or_else(|| value_string(input, "path"))
            {
                vec![(path, false)]
            } else {
                Vec::new()
            }
        }
        ("lsp", "query") => value_string(input, "filePath")
            .or_else(|| value_string(input, "path"))
            .map(|path| vec![(path, false)])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}
