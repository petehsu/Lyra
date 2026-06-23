use std::{
    collections::HashMap,
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    time::{Duration, Instant},
};

use serde_json::{Value, json};

use crate::native_backend::{
    activity::{
        record_tool_activity, record_tool_progress, tool_activity, tool_label,
        tool_started_at_for_call,
    },
    helpers::now,
    streaming_preview_state::{self, PreviewEntry},
};

use super::{
    APPLY_PATCH_MODEL_TOOL, EDIT_FILE_MODEL_TOOL, WRITE_FILE_MODEL_TOOL, apply_fuzzy_replacement,
    budgeted_tool_output, diff_text, resolve_missing_ok_workspace_path, resolve_workspace_path,
};

const PREVIEW_THROTTLE: Duration = Duration::from_millis(32);

#[derive(Clone, Debug)]
struct MutationToolTarget {
    tool_path: String,
    operation: String,
}

#[derive(Clone, Debug)]
enum MutationPreviewInput {
    Patch {
        partial_patch: String,
    },
    Write {
        path: String,
        content: String,
    },
    Edit {
        path: String,
        edits: Vec<(String, String)>,
    },
}

/// Beyond this many bytes of file content we stop streaming a line-by-line diff
/// and emit a lightweight placeholder instead. This caps the per-delta parse +
/// diff cost (which runs every PREVIEW_THROTTLE while args stream in) so a large
/// write_file does not turn the preview path into an O(n²) CPU hotspot. The real
/// atomic write is unaffected — there is no size limit on what actually lands.
const MAX_PREVIEW_DIFF_CONTENT_BYTES: usize = 48 * 1024;

fn hash_diff(diff: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    diff.hash(&mut hasher);
    hasher.finish()
}

fn extract_json_string_field(haystack: &str, key: &str) -> Option<String> {
    for needle in [format!("\"{key}\":\""), format!("\"{key}\": \"")] {
        let Some(start) = haystack.find(&needle) else {
            continue;
        };
        let value_start = start + needle.len();
        return Some(read_json_string_at(haystack, value_start));
    }
    None
}

fn read_json_string_at(input: &str, mut pos: usize) -> String {
    let bytes = input.as_bytes();
    let mut out = String::new();
    while pos < bytes.len() {
        match bytes[pos] {
            b'"' => break,
            b'\\' if pos + 1 < bytes.len() => {
                pos += 1;
                match bytes[pos] {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'/' => out.push('/'),
                    b'b' => out.push('\x08'),
                    b'f' => out.push('\x12'),
                    b'u' if pos + 4 < bytes.len() => {
                        let hex = &input[pos + 1..pos + 5];
                        if let Ok(code) = u32::from_str_radix(hex, 16)
                            && let Some(ch) = char::from_u32(code)
                        {
                            out.push(ch);
                        }
                        pos += 4;
                    }
                    other => out.push(other as char),
                }
                pos += 1;
            }
            byte => {
                out.push(byte as char);
                pos += 1;
            }
        }
    }
    out
}

fn parse_direct_apply_patch_preview_input(partial_arguments: &str) -> Option<MutationPreviewInput> {
    let partial_patch = serde_json::from_str::<Value>(partial_arguments)
        .ok()
        .and_then(|value| {
            value
                .get("patch")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| extract_json_string_field(partial_arguments, "patch"))?;
    (!partial_patch.trim().is_empty()).then_some(MutationPreviewInput::Patch { partial_patch })
}

fn parse_write_file_preview_input(partial_arguments: &str) -> Option<MutationPreviewInput> {
    // `path` arrives complete before `content`, so prefer a strict parse and fall
    // back to lenient field extraction while `content` is still streaming.
    let parsed = serde_json::from_str::<Value>(partial_arguments).ok();
    let path = parsed
        .as_ref()
        .and_then(|value| {
            value
                .get("path")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| extract_json_string_field(partial_arguments, "path"))?;
    if path.trim().is_empty() {
        return None;
    }
    let content = parsed
        .as_ref()
        .and_then(|value| {
            value
                .get("content")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .or_else(|| extract_json_string_field(partial_arguments, "content"))
        .unwrap_or_default();
    Some(MutationPreviewInput::Write { path, content })
}

fn parse_edit_file_preview_input(partial_arguments: &str) -> Option<MutationPreviewInput> {
    // Only emit an edit preview once the JSON is structurally complete: a partial
    // edits array would yield a misleading half-applied diff. The args payload is
    // small (just the changed regions), so waiting for a clean parse is cheap.
    let value = serde_json::from_str::<Value>(partial_arguments).ok()?;
    let path = value.get("path").and_then(Value::as_str)?.to_string();
    if path.trim().is_empty() {
        return None;
    }
    let edits = value
        .get("edits")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|edit| {
            let old = edit.get("old_text").and_then(Value::as_str)?.to_string();
            let new = edit
                .get("new_text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            Some((old, new))
        })
        .collect::<Vec<_>>();
    (!edits.is_empty()).then_some(MutationPreviewInput::Edit { path, edits })
}

fn read_workspace_text(session_id: &str, file_path: &str, allow_missing: bool) -> Option<String> {
    let workspace_path = resolve_workspace_path(session_id, file_path, allow_missing).ok()?;
    if workspace_path.absolute.exists() {
        std::fs::read_to_string(&workspace_path.absolute).ok()
    } else {
        Some(String::new())
    }
}

fn codex_patch_preview_target(partial_patch: &str) -> Option<(String, String)> {
    let mut lines = partial_patch.replace("\r\n", "\n").replace('\r', "\n");
    if !lines.ends_with('\n') {
        lines.push('\n');
    }
    let lines = lines.lines().collect::<Vec<_>>();
    for (index, line) in lines.iter().enumerate() {
        if let Some(path) = line.strip_prefix("*** Add File: ") {
            // Mirror parse_codex_patch: accept both '+'-prefixed (Lyra-extended)
            // and bare (standard Codex) add-file lines so the live preview matches
            // what will actually be written.
            let content = lines[index + 1..]
                .iter()
                .take_while(|line| !line.starts_with("*** "))
                .map(|line| line.strip_prefix('+').unwrap_or(line))
                .collect::<Vec<_>>()
                .join("\n");
            let content = if content.is_empty() {
                String::new()
            } else {
                format!("{content}\n")
            };
            return Some((path.trim().to_string(), content));
        }
        if let Some(path) = line.strip_prefix("*** Update File: ") {
            return Some((path.trim().to_string(), String::new()));
        }
        if let Some(path) = line.strip_prefix("*** Delete File: ") {
            return Some((path.trim().to_string(), String::new()));
        }
    }
    None
}

fn codex_update_preview_diff(
    session_id: &str,
    file_path: &str,
    partial_patch: &str,
) -> Option<(String, String)> {
    let old = read_workspace_text(session_id, file_path, false)?;
    let workspace_path = resolve_workspace_path(session_id, file_path, false).ok()?;
    let mut old_lines = Vec::<String>::new();
    let mut new_lines = Vec::<String>::new();
    let mut in_target = false;
    for line in partial_patch
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .lines()
    {
        if let Some(path) = line.strip_prefix("*** Update File: ") {
            in_target = path.trim() == file_path.trim();
            continue;
        }
        if in_target && line.starts_with("*** ") {
            break;
        }
        if !in_target || line == "@@" || line.starts_with("@@ ") {
            continue;
        }
        let mut chars = line.chars();
        let Some(prefix) = chars.next() else {
            continue;
        };
        let text = chars.as_str().to_string();
        match prefix {
            ' ' => {
                old_lines.push(text.clone());
                new_lines.push(text);
            }
            '-' => old_lines.push(text),
            '+' => new_lines.push(text),
            _ => {}
        }
    }
    if old_lines.is_empty() && new_lines.is_empty() {
        return None;
    }
    let old_block = if old_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", old_lines.join("\n"))
    };
    let new_block = if new_lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", new_lines.join("\n"))
    };
    let updated = if old_block.is_empty() {
        return None;
    } else if let Some(next) = replace_once_for_preview(&old, &old_block, &new_block) {
        next
    } else {
        return Some((
            workspace_path.relative.clone(),
            format!(
                "--- {}\n+++ {}\n@@ -1,1 +1,1 @@\n{}",
                workspace_path.relative,
                workspace_path.relative,
                partial_patch
                    .lines()
                    .filter(|line| line.starts_with(' ')
                        || line.starts_with('+')
                        || line.starts_with('-'))
                    .collect::<Vec<_>>()
                    .join("\n")
            ),
        ));
    };
    Some((
        workspace_path.relative.clone(),
        diff_text(&workspace_path.relative, &old, &updated),
    ))
}

fn replace_once_for_preview(current: &str, old_block: &str, new_block: &str) -> Option<String> {
    for (old_candidate, new_candidate) in [
        (old_block.to_string(), new_block.to_string()),
        (
            old_block
                .strip_suffix('\n')
                .unwrap_or(old_block)
                .to_string(),
            new_block
                .strip_suffix('\n')
                .unwrap_or(new_block)
                .to_string(),
        ),
    ] {
        if old_candidate.is_empty() {
            continue;
        }
        if current.matches(&old_candidate).count() == 1 {
            return Some(current.replacen(&old_candidate, &new_candidate, 1));
        }
    }
    None
}

fn preview_diff_for_input(
    session_id: &str,
    target: &MutationToolTarget,
    preview_input: &MutationPreviewInput,
) -> Option<(String, String)> {
    match preview_input {
        MutationPreviewInput::Patch { partial_patch } if target.operation == "apply_patch" => {
            if let Some((file_path, partial_content)) = codex_patch_preview_target(partial_patch) {
                if partial_patch.contains("*** Add File: ") {
                    let workspace_path =
                        resolve_missing_ok_workspace_path(session_id, &file_path).ok()?;
                    let old = if workspace_path.absolute.exists() {
                        std::fs::read_to_string(&workspace_path.absolute).ok()?
                    } else {
                        String::new()
                    };
                    let diff = diff_text(&workspace_path.relative, &old, &partial_content);
                    return Some((workspace_path.relative, diff));
                }
                if partial_patch.contains("*** Delete File: ") {
                    let old = read_workspace_text(session_id, &file_path, false)?;
                    let workspace_path =
                        resolve_workspace_path(session_id, &file_path, false).ok()?;
                    let diff = diff_text(&workspace_path.relative, &old, "");
                    return Some((workspace_path.relative, diff));
                }
                if partial_patch.contains("*** Update File: ") {
                    return codex_update_preview_diff(session_id, &file_path, partial_patch);
                }
            }
            let file_path = partial_patch
                .lines()
                .find_map(|line| {
                    let trimmed = line.trim();
                    if let Some(path) = trimmed.strip_prefix("+++ ") {
                        let path = path.trim();
                        if path != "/dev/null" && !path.is_empty() {
                            return Some(path.to_string());
                        }
                    }
                    None
                })
                .or_else(|| {
                    partial_patch.lines().find_map(|line| {
                        line.strip_prefix("--- ").map(str::trim).map(str::to_string)
                    })
                })?;
            let old = read_workspace_text(session_id, &file_path, true)?;
            let workspace_path = resolve_workspace_path(session_id, &file_path, true).ok()?;
            let diff = if partial_patch.contains("@@") {
                format!(
                    "--- {}\n+++ {}\n{}",
                    workspace_path.relative, workspace_path.relative, partial_patch
                )
            } else {
                diff_text(&workspace_path.relative, &old, partial_patch)
            };
            Some((workspace_path.relative, diff))
        }
        MutationPreviewInput::Write { path, content } if target.operation == "write" => {
            let workspace_path = resolve_missing_ok_workspace_path(session_id, path).ok()?;
            let old = if workspace_path.absolute.exists() {
                std::fs::read_to_string(&workspace_path.absolute).ok()?
            } else {
                String::new()
            };
            if old.len() + content.len() > MAX_PREVIEW_DIFF_CONTENT_BYTES {
                let diff = format!(
                    "--- {}\n+++ {}\nwriting {} bytes…",
                    workspace_path.relative,
                    workspace_path.relative,
                    content.len()
                );
                return Some((workspace_path.relative, diff));
            }
            let diff = diff_text(&workspace_path.relative, &old, content);
            Some((workspace_path.relative, diff))
        }
        MutationPreviewInput::Edit { path, edits } if target.operation == "multiedit" => {
            let old = read_workspace_text(session_id, path, false)?;
            let workspace_path = resolve_workspace_path(session_id, path, false).ok()?;
            if old.len() > MAX_PREVIEW_DIFF_CONTENT_BYTES {
                let diff = format!(
                    "--- {}\n+++ {}\nediting {} region(s)…",
                    workspace_path.relative,
                    workspace_path.relative,
                    edits.len()
                );
                return Some((workspace_path.relative, diff));
            }
            // Apply edits to a scratch copy to preview the result. A region that
            // can't be located yet (model still streaming context) is skipped, so
            // the preview shows progressively more of the change.
            let mut updated = old.clone();
            for (old_text, new_text) in edits {
                if let Ok(next) = apply_fuzzy_replacement(&updated, old_text, new_text, false) {
                    updated = next;
                }
            }
            let diff = diff_text(&workspace_path.relative, &old, &updated);
            Some((workspace_path.relative, diff))
        }
        _ => None,
    }
}

fn build_tool_input(partial_arguments: &str, tool_path: &str) -> Value {
    if let Ok(parsed) = serde_json::from_str::<Value>(partial_arguments) {
        return parsed;
    }
    json!({ "path": tool_path, "args": {} })
}

fn emit_preview_tool_activity(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    _tool_path: &str,
    operation: &str,
    input: Value,
    relative_path: &str,
    diff: &str,
    started_at: &str,
    first_emit: bool,
) {
    let raw = json!({
        "changedFiles": [{
            "path": relative_path,
            "operation": operation,
            "beforeExists": true,
            "afterExists": true,
        }],
        "diff": diff,
        "activityKind": "edit",
        "rendererHint": "edit",
        "preview": true,
    });
    let output = budgeted_tool_output(
        session_id,
        turn_id,
        tool_call_id,
        format!("Editing {relative_path}\n{diff}"),
        raw,
        None,
    );
    let activity = tool_activity(
        tool_call_id,
        tool_name,
        &tool_label("file", operation),
        "running",
        input,
        Some(output),
        started_at,
        None,
    );
    if first_emit {
        record_tool_activity(session_id, turn_id, activity, "toolStarted");
    } else {
        record_tool_progress(session_id, turn_id, activity);
    }
}

pub(crate) fn maybe_emit_streaming_diff_preview(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    partial_arguments: &str,
) {
    let normalized_name = tool_name.trim().to_ascii_lowercase();
    // Map each code-mutation tool to its preview parser + target. The preview
    // activity intentionally reuses the model tool name and the live tool_call_id
    // so the front-end renders one card that transitions running→done — not a
    // separate preview card alongside the real execution.
    let (preview_input, target) = if normalized_name == APPLY_PATCH_MODEL_TOOL {
        (
            parse_direct_apply_patch_preview_input(partial_arguments),
            MutationToolTarget {
                tool_path: "/tools/runtime/apply_patch".to_string(),
                operation: "apply_patch".to_string(),
            },
        )
    } else if normalized_name == WRITE_FILE_MODEL_TOOL {
        (
            parse_write_file_preview_input(partial_arguments),
            MutationToolTarget {
                tool_path: "/tools/runtime/write_file".to_string(),
                operation: "write".to_string(),
            },
        )
    } else if normalized_name == EDIT_FILE_MODEL_TOOL {
        (
            parse_edit_file_preview_input(partial_arguments),
            MutationToolTarget {
                tool_path: "/tools/runtime/edit_file".to_string(),
                operation: "multiedit".to_string(),
            },
        )
    } else {
        return;
    };
    let Some(preview_input) = preview_input else {
        return;
    };
    let Some((relative_path, diff)) = preview_diff_for_input(session_id, &target, &preview_input)
    else {
        return;
    };
    if diff.trim().is_empty() || diff.contains("No textual diff") {
        return;
    }

    let key = streaming_preview_state::preview_key(session_id, turn_id, tool_call_id);
    let diff_hash = hash_diff(&diff);
    let now_instant = Instant::now();
    let mut should_emit = false;
    let mut first_emit = false;
    let mut started_at = now();
    streaming_preview_state::with_preview_entry(
        &key,
        |entry| {
            first_emit = !entry.started;
            if !first_emit {
                if entry.last_diff_hash == diff_hash {
                    return;
                }
                if now_instant.duration_since(entry.last_emitted_at) < PREVIEW_THROTTLE {
                    return;
                }
            }
            entry.last_emitted_at = now_instant;
            entry.last_diff_hash = diff_hash;
            if first_emit {
                entry.started = true;
                entry.started_at = now();
            }
            started_at = entry.started_at.clone();
            should_emit = true;
        },
        || PreviewEntry {
            started: false,
            started_at: now(),
            last_emitted_at: Instant::now() - PREVIEW_THROTTLE,
            last_diff_hash: 0,
        },
    );
    if !should_emit {
        return;
    }

    let input = build_tool_input(partial_arguments, &target.tool_path);
    emit_preview_tool_activity(
        session_id,
        turn_id,
        tool_call_id,
        tool_name,
        &target.tool_path,
        &target.operation,
        input,
        &relative_path,
        &diff,
        &started_at,
        first_emit,
    );
}

pub(crate) fn maybe_emit_streaming_diff_previews_from_accumulators(
    session_id: &str,
    turn_id: &str,
    tool_calls: &HashMap<
        usize,
        crate::native_backend::providers::protocol::openai_common::StreamingToolCallAccumulator,
    >,
) {
    for accumulator in tool_calls.values() {
        let Some(tool_call_id) = accumulator.id.as_deref().filter(|id| !id.trim().is_empty())
        else {
            continue;
        };
        let Some(tool_name) = accumulator.name.as_deref() else {
            continue;
        };
        if accumulator.arguments.trim().is_empty() {
            continue;
        }
        maybe_emit_streaming_diff_preview(
            session_id,
            turn_id,
            tool_call_id,
            tool_name,
            &accumulator.arguments,
        );
    }
}

pub(crate) fn emit_running_mutation_diff(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
    relative_path: &str,
    diff: &str,
) {
    if diff.trim().is_empty() {
        return;
    }
    let started_at = tool_started_at_for_call(session_id, tool_call_id);
    let raw = json!({
        "changedFiles": [{
            "path": relative_path,
            "operation": action,
            "beforeExists": true,
            "afterExists": true,
        }],
        "diff": diff,
        "activityKind": "edit",
        "rendererHint": "edit",
        "preview": true,
    });
    let output = budgeted_tool_output(
        session_id,
        turn_id,
        tool_call_id,
        format!("Editing {relative_path}\n{diff}"),
        raw,
        None,
    );
    record_tool_progress(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            display_name,
            &tool_label(display_name, action),
            "running",
            input.clone(),
            Some(output),
            &started_at,
            None,
        ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn insert_preview_test_session(workspace: &std::path::Path) -> (String, String) {
        let mut session = crate::native_backend::sessions::new_session(
            Some(format!("Streaming preview {}", uuid::Uuid::new_v4())),
            Some(workspace.display().to_string()),
            "normal",
        );
        let session_id = session.id.clone();
        let turn_id = format!("turn-streaming-preview-{}", uuid::Uuid::new_v4());
        session.snapshot["turnStatus"] = Value::String("running".to_string());
        session.snapshot["activeTurnId"] = Value::String(turn_id.clone());
        session.snapshot["follow"] = json!({ "running": true, "activity": "calling_model" });
        session
            .runtime_turns
            .push(crate::native_backend::projections::runtime_turn(
                &turn_id,
                &session_id,
                "calling_model",
                None,
                None,
            ));
        let mut state = crate::native_backend::state::state()
            .lock()
            .expect("state lock");
        session.dirty = true;
        state.sessions.insert(session_id.clone(), session);
        state.save_state().expect("save state");
        (session_id, turn_id)
    }

    #[test]
    fn extracts_partial_patch_content_from_unclosed_json() {
        let partial =
            r#"{"patch":"*** Begin Patch\n*** Add File: src/a.ts\n+fn main() {\n+  println!("#;
        let preview = parse_direct_apply_patch_preview_input(partial).expect("preview");
        match preview {
            MutationPreviewInput::Patch { partial_patch } => {
                assert!(partial_patch.contains("*** Add File: src/a.ts"));
                assert!(partial_patch.contains("fn main()"));
            }
            other => panic!("expected Patch, got {other:?}"),
        }
    }

    #[test]
    fn ignores_legacy_tool_fs_mutation_arguments() {
        let partial = r#"{"path":"/tools/filesystem/write_file","args":{"path":"src/a.ts","content":"fn main()"}}"#;
        assert!(parse_direct_apply_patch_preview_input(partial).is_none());
    }

    #[test]
    fn parses_write_file_with_streaming_content() {
        // `path` is complete but `content` is still streaming (unterminated JSON).
        let partial = r#"{"path":"index.html","content":"<!DOCTYPE html>\n<html>"#;
        match parse_write_file_preview_input(partial).expect("write preview") {
            MutationPreviewInput::Write { path, content } => {
                assert_eq!(path, "index.html");
                assert!(content.contains("<!DOCTYPE html>"));
            }
            other => panic!("expected Write, got {other:?}"),
        }
    }

    #[test]
    fn emits_write_file_preview_as_running_edit_activity() {
        let workspace = tempfile::tempdir().expect("workspace");
        let (session_id, turn_id) = insert_preview_test_session(workspace.path());
        maybe_emit_streaming_diff_preview(
            &session_id,
            &turn_id,
            "call-write-preview",
            WRITE_FILE_MODEL_TOOL,
            r#"{"path":"index.html","content":"<!DOCTYPE html>\n<html>"}"#,
        );
        let state = crate::native_backend::state::state()
            .lock()
            .expect("state lock");
        let session = state.sessions.get(&session_id).expect("session");
        let tool = session
            .snapshot
            .get("tools")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|tool| tool.get("id").and_then(Value::as_str) == Some("call-write-preview"))
            .expect("preview tool");
        assert_eq!(tool["status"].as_str(), Some("running"));
        assert_eq!(tool["activityKind"].as_str(), Some("edit"));
        assert_eq!(
            tool.pointer("/output/raw/changedFiles/0/path")
                .and_then(Value::as_str),
            Some("index.html")
        );
    }

    #[test]
    fn parses_edit_file_edits_array() {
        let complete =
            r#"{"path":"a.rs","edits":[{"old_text":"let x = 1;","new_text":"let x = 2;"}]}"#;
        match parse_edit_file_preview_input(complete).expect("edit preview") {
            MutationPreviewInput::Edit { path, edits } => {
                assert_eq!(path, "a.rs");
                assert_eq!(
                    edits,
                    vec![("let x = 1;".to_string(), "let x = 2;".to_string())]
                );
            }
            other => panic!("expected Edit, got {other:?}"),
        }
    }
}
