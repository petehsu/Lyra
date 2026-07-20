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
    EDIT_FILE_MODEL_TOOL, WRITE_FILE_MODEL_TOOL, apply_fuzzy_replacement, budgeted_tool_output,
    diff_text, resolve_missing_ok_workspace_path, resolve_workspace_path,
};

// 150ms ≈ smooth-enough live diff for a human eye. The throttle gates parse +
// file read + diff + two NAPI events per frame, all paid on the provider
// stream thread — 32ms made the preview path dominate stream consumption.
const PREVIEW_THROTTLE: Duration = Duration::from_millis(150);

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

/// ponytail: 超过此大小的已有文件跳过 streaming diff preview。
/// 升级路径：分块 diff 或只 diff 变更窗口。
const MAX_PREVIEW_FILE_SIZE: u64 = 256 * 1024;

fn file_size_within_preview_limit(path: &std::path::Path) -> bool {
    match std::fs::metadata(path) {
        Ok(m) => m.len() <= MAX_PREVIEW_FILE_SIZE,
        Err(_) => false,
    }
}

fn hash_diff(diff: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    diff.hash(&mut hasher);
    hasher.finish()
}

fn extract_json_string_field(haystack: &str, key: &str) -> Option<String> {
    // JSON-aware scanner: tracks string boundaries so that `"key":"` patterns
    // appearing *inside* a string value (e.g. when writing a JSON file whose
    // content itself contains `"path":"bar"`) are never mistaken for real keys.
    //
    // State machine:
    //   Normal  — outside strings; watch for `"key":"`
    //   InStr   — inside a string; skip everything except `"` and `\`
    //   Escape  — inside a string, previous char was `\`; skip next char
    let bytes = haystack.as_bytes();
    let mut pos = 0usize;
    let mut in_string = false;
    let mut in_escape = false;

    while pos < bytes.len() {
        if in_escape {
            in_escape = false;
            pos += 1;
            continue;
        }

        let byte = bytes[pos];

        if in_string {
            match byte {
                b'\\' => in_escape = true,
                b'"' => in_string = false,
                _ => {}
            }
            pos += 1;
            continue;
        }

        // Normal state — not inside a string.
        if byte == b'"' {
            let rest = &haystack[pos..];
            let needle_a = format!("\"{key}\":\"");
            let needle_b = format!("\"{key}\": \"");
            if rest.starts_with(&needle_a) {
                return Some(read_json_string_at(haystack, pos + needle_a.len()));
            }
            if rest.starts_with(&needle_b) {
                return Some(read_json_string_at(haystack, pos + needle_b.len()));
            }
            // Not our key — enter string-skip mode until the closing `"`.
            in_string = true;
        }
        pos += 1;
    }
    None
}

fn read_json_string_at(input: &str, mut pos: usize) -> String {
    // Accumulate raw bytes and decode as UTF-8 at the end. A multi-byte UTF-8
    // sequence (e.g. 记 = E8 AE B0) is pushed one byte at a time into `out` and
    // reassembled by `from_utf8_lossy`; the previous `byte as char` decoded each
    // byte as Latin-1, splitting 记 into è ® ° (the è®°å¿æ¶æ mojibake seen in
    // streaming previews). Escapes are decoded to their UTF-8 encoding so a
    // `中` surrogate/code point also round-trips correctly.
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::new();
    while pos < bytes.len() {
        match bytes[pos] {
            b'"' => break,
            b'\\' if pos + 1 < bytes.len() => {
                pos += 1;
                match bytes[pos] {
                    b'"' => out.push(b'"'),
                    b'\\' => out.push(b'\\'),
                    b'n' => out.push(b'\n'),
                    b'r' => out.push(b'\r'),
                    b't' => out.push(b'\t'),
                    b'/' => out.push(b'/'),
                    b'b' => out.push(0x08),
                    b'f' => out.push(0x0c),
                    b'u' if pos + 4 < bytes.len() => {
                        let hex = &input[pos + 1..pos + 5];
                        if let Ok(code) = u32::from_str_radix(hex, 16)
                            && let Some(ch) = char::from_u32(code)
                        {
                            let mut buf = [0u8; 4];
                            out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                        }
                        pos += 4;
                    }
                    other => out.push(other),
                }
                pos += 1;
            }
            byte => {
                out.push(byte);
                pos += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
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
    let workspace_path = match resolve_workspace_path(session_id, file_path, allow_missing) {
        Ok(p) => p,
        Err(e) => {
            eprintln!(
                "[lyra-agent-runtime] streaming preview: resolve_workspace_path failed for {file_path}: {e:?}"
            );
            return None;
        }
    };
    if workspace_path.absolute.exists() {
        // ponytail: 超过 MAX_PREVIEW_FILE_SIZE 的文件跳过 preview。
        if let Ok(metadata) = std::fs::metadata(&workspace_path.absolute) {
            if metadata.len() > MAX_PREVIEW_FILE_SIZE {
                return None;
            }
        }
        match std::fs::read_to_string(&workspace_path.absolute) {
            Ok(text) => Some(text),
            Err(e) => {
                eprintln!(
                    "[lyra-agent-runtime] streaming preview: read_to_string failed for {}: {e}",
                    workspace_path.absolute.display()
                );
                None
            }
        }
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
                    let old = if workspace_path.absolute.exists()
                        && file_size_within_preview_limit(&workspace_path.absolute)
                    {
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
            let old = if workspace_path.absolute.exists()
                && file_size_within_preview_limit(&workspace_path.absolute)
            {
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

/// Cap what a single preview frame puts on the wire. Frames repeat every
/// PREVIEW_THROTTLE, so an unbounded diff multiplies serialization, event and
/// snapshot cost by the frame count. Keeps the diff header plus the newest
/// tail — the tail is where the model is currently "typing", which is exactly
/// what a live preview needs to show.
const MAX_PREVIEW_TRANSPORT_BYTES: usize = 16 * 1024;

fn truncate_preview_diff(diff: &str) -> String {
    if diff.len() <= MAX_PREVIEW_TRANSPORT_BYTES {
        return diff.to_string();
    }
    let mut start = diff.len() - MAX_PREVIEW_TRANSPORT_BYTES;
    while !diff.is_char_boundary(start) {
        start += 1;
    }
    // Resync to a line boundary so the frame never shows a torn diff line.
    if let Some(offset) = diff[start..].find('\n') {
        start += offset + 1;
    }
    let header = diff.lines().take(2).collect::<Vec<_>>().join("\n");
    format!(
        "{header}\n… (streaming preview truncated) …\n{}",
        &diff[start..]
    )
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
    // Preview frames are transient and re-emitted every PREVIEW_THROTTLE while
    // the model streams arguments. Routing them through budgeted_tool_output
    // wrote a fresh artifact file to disk for every oversized frame; truncate
    // inline instead and let the final (real) tool output carry the full diff
    // and artifacts once.
    let truncated = diff.len() > MAX_PREVIEW_TRANSPORT_BYTES;
    let display_diff = truncate_preview_diff(diff);
    let raw = json!({
        "changedFiles": [{
            "path": relative_path,
            "operation": operation,
            "beforeExists": true,
            "afterExists": true,
        }],
        "diff": display_diff,
        "activityKind": "edit",
        "rendererHint": "edit",
        "preview": true,
    });
    let output = json!({
        "content": format!("Editing {relative_path}\n{display_diff}"),
        "raw": raw,
        "truncated": truncated,
        "artifactRef": Value::Null,
        "rawArtifactRef": Value::Null,
        "truncatedReason": if truncated {
            json!("streaming preview diff truncated for transport")
        } else {
            Value::Null
        },
        "rawTruncatedReason": Value::Null,
        "recommendedNextAction": Value::Null,
        "activityKind": "edit",
        "rendererHint": "edit",
    });
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
) -> bool {
    let normalized_name = tool_name.trim().to_ascii_lowercase();
    // Map each code-mutation tool to its target. The preview activity
    // intentionally reuses the model tool name and the live tool_call_id so
    // the front-end renders one card that transitions running→done — not a
    // separate preview card alongside the real execution.
    let target = if normalized_name == "apply_patch" {
        MutationToolTarget {
            tool_path: "/tools/runtime/apply_patch".to_string(),
            operation: "apply_patch".to_string(),
        }
    } else if normalized_name == WRITE_FILE_MODEL_TOOL {
        MutationToolTarget {
            tool_path: "/tools/runtime/write_file".to_string(),
            operation: "write".to_string(),
        }
    } else if normalized_name == EDIT_FILE_MODEL_TOOL {
        MutationToolTarget {
            tool_path: "/tools/runtime/edit_file".to_string(),
            operation: "multiedit".to_string(),
        }
    } else {
        return false;
    };

    // ponytail: throttle check BEFORE parse + file-read + diff.
    // Previously the hash was computed on the diff output (after file read +
    // Myers diff), making every SSE chunk pay O(file_size) I/O + O(N·D) CPU
    // even when the 32ms throttle would skip the emit — an O(N²) death loop
    // on large file writes that saturated CPU and triggered the 90s streaming
    // idle timeout. Hashing the raw partial_arguments is a cheap proxy:
    // the input grows monotonically, so the hash always changes (dedup is a
    // no-op in practice); the time-based throttle is what actually gates
    // the expensive work below.
    let input_hash = hash_diff(partial_arguments);
    let key = streaming_preview_state::preview_key(session_id, turn_id, tool_call_id);
    let now_instant = Instant::now();
    let mut should_emit = false;
    let mut first_emit = false;
    let mut started_at = now();
    streaming_preview_state::with_preview_entry(
        &key,
        |entry| {
            first_emit = !entry.started;
            if !first_emit {
                if entry.last_diff_hash == input_hash {
                    return;
                }
                if now_instant.duration_since(entry.last_emitted_at) < PREVIEW_THROTTLE {
                    return;
                }
            }
            entry.last_emitted_at = now_instant;
            entry.last_diff_hash = input_hash;
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
        return false;
    }

    // Expensive work: parse + file read + diff — only after throttle passes.
    let preview_input = if normalized_name == "apply_patch" {
        parse_direct_apply_patch_preview_input(partial_arguments)
    } else if normalized_name == WRITE_FILE_MODEL_TOOL {
        parse_write_file_preview_input(partial_arguments)
    } else {
        parse_edit_file_preview_input(partial_arguments)
    };
    let Some(preview_input) = preview_input else {
        return false;
    };
    let Some((relative_path, diff)) = preview_diff_for_input(session_id, &target, &preview_input)
    else {
        return false;
    };
    if diff.trim().is_empty() || diff.contains("No textual diff") {
        return false;
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
    true
}

pub(crate) fn maybe_emit_streaming_diff_previews_from_accumulators(
    session_id: &str,
    turn_id: &str,
    tool_calls: &HashMap<
        usize,
        crate::native_backend::providers::protocol::openai_common::StreamingToolCallAccumulator,
    >,
) -> bool {
    let mut any_emitted = false;
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
        any_emitted |= maybe_emit_streaming_diff_preview(
            session_id,
            turn_id,
            tool_call_id,
            tool_name,
            &accumulator.arguments,
        );
    }
    any_emitted
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
    fn truncate_preview_diff_keeps_header_and_newest_tail() {
        let small = "--- a\n+++ b\n+line";
        assert_eq!(truncate_preview_diff(small), small);

        let body = (0..4000)
            .map(|index| format!("+line {index} 有中文内容"))
            .collect::<Vec<_>>()
            .join("\n");
        let big = format!("--- index.html\n+++ index.html\n{body}");
        let truncated = truncate_preview_diff(&big);
        assert!(truncated.len() <= MAX_PREVIEW_TRANSPORT_BYTES + 256);
        assert!(truncated.starts_with("--- index.html\n+++ index.html\n"));
        assert!(truncated.contains("… (streaming preview truncated) …"));
        // The newest (tail) content survives — that is what a live preview shows.
        assert!(truncated.contains("+line 3999 有中文内容"));
        // Resynced to a line boundary: no torn line right after the marker.
        let after_marker = truncated
            .split("… (streaming preview truncated) …\n")
            .nth(1)
            .expect("tail");
        assert!(after_marker.starts_with("+line "));
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
    fn extract_json_string_field_ignores_key_patterns_inside_string_values() {
        // Writing a JSON file whose content itself contains `"path":"inner.txt"`
        // must not confuse the scanner into returning `inner.txt` as the path.
        let complete = r#"{"path":"output.json","content":"{\"path\":\"inner.txt\"}"}"#;
        let path = extract_json_string_field(complete, "path").expect("path");
        assert_eq!(path, "output.json");

        let content = extract_json_string_field(complete, "content").expect("content");
        assert_eq!(content, r#"{"path":"inner.txt"}"#);
    }

    #[test]
    fn extract_json_string_field_works_on_truncated_streaming_content() {
        // Same scenario but content is still streaming (unterminated JSON).
        let partial = r#"{"path":"output.json","content":"{\"path\":\"inn"#;
        let path = extract_json_string_field(partial, "path").expect("path");
        assert_eq!(path, "output.json");

        let content = extract_json_string_field(partial, "content").expect("content");
        assert_eq!(content, r#"{"path":"inn"#);
    }

    #[test]
    fn read_json_string_preserves_multibyte_utf8() {
        // Streaming (unterminated) JSON whose content is mid-flight CJK bytes.
        // The byte-level scanner used to decode each byte as Latin-1, splitting
        // 记忆架构 into è®°å¿æ¶æ. It must now round-trip UTF-8 intact.
        let partial = r#"{"path":"记忆架构.md","content":"正在写记忆架构"#;
        match parse_write_file_preview_input(partial).expect("write preview") {
            MutationPreviewInput::Write { path, content } => {
                assert_eq!(path, "记忆架构.md");
                assert!(content.contains("正在写记忆架构"));
                assert!(!content.contains('è'));
            }
            other => panic!("expected Write, got {other:?}"),
        }
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
