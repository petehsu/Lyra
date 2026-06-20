use std::{
    collections::HashMap,
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    time::{Duration, Instant},
};

use lyra_tool_fs_core::{TOOL_FS_RUN, normalize_tool_path};
use serde_json::{Value, json};

use crate::native_backend::{
    activity::{
        record_tool_activity, record_tool_progress, tool_activity, tool_label,
        tool_started_at_for_call,
    },
    helpers::now,
    streaming_preview_state::{self, PreviewEntry},
};

use super::{apply_exact_replacement, budgeted_tool_output, diff_text, resolve_workspace_path};

const PREVIEW_THROTTLE: Duration = Duration::from_millis(32);

#[derive(Clone, Debug)]
struct MutationToolTarget {
    tool_path: String,
    operation: String,
}

#[derive(Clone, Debug)]
enum MutationPreviewInput {
    Write {
        file_path: String,
        partial_content: String,
    },
    Edit {
        file_path: String,
        old_string: String,
        partial_new_string: String,
        replace_all: bool,
    },
    Patch {
        partial_patch: String,
    },
}

fn hash_diff(diff: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    diff.hash(&mut hasher);
    hasher.finish()
}

fn mutation_target_for_tool_path(tool_path: &str) -> Option<MutationToolTarget> {
    let normalized = normalize_tool_path(tool_path);
    match normalized.as_str() {
        "/tools/filesystem/write_file" => Some(MutationToolTarget {
            tool_path: normalized,
            operation: "write".to_string(),
        }),
        "/tools/filesystem/edit_file" => Some(MutationToolTarget {
            tool_path: normalized,
            operation: "edit".to_string(),
        }),
        "/tools/filesystem/strict_edit" => Some(MutationToolTarget {
            tool_path: normalized,
            operation: "strict_edit".to_string(),
        }),
        "/tools/filesystem/multi_edit" => Some(MutationToolTarget {
            tool_path: normalized,
            operation: "multiedit".to_string(),
        }),
        "/tools/filesystem/apply_patch" => Some(MutationToolTarget {
            tool_path: normalized,
            operation: "apply_patch".to_string(),
        }),
        _ => None,
    }
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

fn extract_args_section(partial: &str) -> Option<&str> {
    for needle in ["\"args\":{", "\"args\": {"] {
        let Some(start) = partial.find(needle) else {
            continue;
        };
        let section_start = start + needle.len() - 1;
        return partial.get(section_start..);
    }
    None
}

fn parse_mutation_preview_input(
    target: &MutationToolTarget,
    partial_arguments: &str,
) -> Option<MutationPreviewInput> {
    let args_section = extract_args_section(partial_arguments).unwrap_or(partial_arguments);
    let file_path = extract_json_string_field(args_section, "path")?;
    if file_path.starts_with("/tools/") || file_path.trim().is_empty() {
        return None;
    }
    match target.operation.as_str() {
        "write" => {
            let partial_content = extract_json_string_field(args_section, "content")?;
            if partial_content.is_empty() {
                return None;
            }
            Some(MutationPreviewInput::Write {
                file_path,
                partial_content,
            })
        }
        "edit" | "strict_edit" => {
            let old_string = extract_json_string_field(args_section, "oldString")?;
            if old_string.is_empty() {
                return None;
            }
            let partial_new_string = extract_json_string_field(args_section, "newString")?;
            let replace_all = args_section.contains("\"replaceAll\":true")
                || args_section.contains("\"replaceAll\": true");
            Some(MutationPreviewInput::Edit {
                file_path,
                old_string,
                partial_new_string,
                replace_all,
            })
        }
        "apply_patch" => {
            let partial_patch = extract_json_string_field(args_section, "patch")?;
            if partial_patch.is_empty() {
                return None;
            }
            Some(MutationPreviewInput::Patch { partial_patch })
        }
        _ => None,
    }
}

fn read_workspace_text(session_id: &str, file_path: &str, allow_missing: bool) -> Option<String> {
    let workspace_path = resolve_workspace_path(session_id, file_path, allow_missing).ok()?;
    if workspace_path.absolute.exists() {
        std::fs::read_to_string(&workspace_path.absolute).ok()
    } else {
        Some(String::new())
    }
}

fn preview_diff_for_input(
    session_id: &str,
    target: &MutationToolTarget,
    preview_input: &MutationPreviewInput,
) -> Option<(String, String)> {
    match preview_input {
        MutationPreviewInput::Write {
            file_path,
            partial_content,
        } => {
            let old = read_workspace_text(session_id, file_path, true)?;
            let workspace_path = resolve_workspace_path(session_id, file_path, true).ok()?;
            let diff = diff_text(&workspace_path.relative, &old, partial_content);
            Some((workspace_path.relative, diff))
        }
        MutationPreviewInput::Edit {
            file_path,
            old_string,
            partial_new_string,
            replace_all,
        } => {
            let old = read_workspace_text(session_id, file_path, false)?;
            let updated =
                apply_exact_replacement(&old, old_string, partial_new_string, *replace_all).ok()?;
            let workspace_path = resolve_workspace_path(session_id, file_path, false).ok()?;
            let diff = diff_text(&workspace_path.relative, &old, &updated);
            Some((workspace_path.relative, diff))
        }
        MutationPreviewInput::Patch { partial_patch } if target.operation == "apply_patch" => {
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
    tool_path: &str,
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
    if normalized_name != TOOL_FS_RUN {
        return;
    }
    let tool_path = extract_json_string_field(partial_arguments, "path").unwrap_or_default();
    let Some(target) = mutation_target_for_tool_path(&tool_path) else {
        return;
    };
    let Some(preview_input) = parse_mutation_preview_input(&target, partial_arguments) else {
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
            if entry.last_diff_hash == diff_hash {
                return;
            }
            if now_instant.duration_since(entry.last_emitted_at) < PREVIEW_THROTTLE {
                return;
            }
            entry.last_emitted_at = now_instant;
            entry.last_diff_hash = diff_hash;
            first_emit = !entry.started;
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

    #[test]
    fn extracts_partial_write_content_from_unclosed_json() {
        let partial = r#"{"path":"/tools/filesystem/write_file","args":{"path":"src/a.ts","content":"fn main() {\n  println!("#;
        let target = mutation_target_for_tool_path("/tools/filesystem/write_file").expect("target");
        let preview = parse_mutation_preview_input(&target, partial).expect("preview");
        match preview {
            MutationPreviewInput::Write {
                file_path,
                partial_content,
            } => {
                assert_eq!(file_path, "src/a.ts");
                assert!(partial_content.starts_with("fn main()"));
            }
            _ => panic!("expected write preview"),
        }
    }

    #[test]
    fn recognizes_mutation_tool_paths() {
        assert_eq!(
            mutation_target_for_tool_path("/tools/filesystem/strict_edit")
                .expect("strict edit")
                .operation,
            "strict_edit"
        );
    }
}
