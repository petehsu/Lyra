use super::*;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::Component,
    time::SystemTime,
};

const MAX_ARTIFACT_READ_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) fn execute_filesystem_tool_adapter(
    session_id: &str,
    turn_id: &str,
    cancellation: &Arc<AtomicBool>,
    runtime: ToolExecutionRuntime,
    tool_call_id: &str,
    tool_name: &str,
    display_name: &str,
    action: &str,
    arguments: Value,
    started_at: &str,
) -> Value {
    execute_native_tool_adapter_with_runtime(
        session_id,
        turn_id,
        cancellation,
        tool_call_id,
        tool_name,
        display_name,
        action,
        arguments,
        started_at,
        None,
        runtime,
    )
}

#[derive(Clone, Debug)]
pub(crate) struct LyraArtifactPath {
    pub(crate) absolute: PathBuf,
    pub(crate) artifact_id: String,
    pub(crate) kind: String,
    pub(crate) media_type: String,
}

pub(crate) fn tool_file_read(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    let path = required_value_string(input, "path")?;
    if resolve_lyra_artifact_path(&path)?.is_some() {
        return tool_artifact_read(session_id, turn_id, tool_call_id, input);
    }
    let workspace_path = resolve_workspace_path(session_id, &path, false)?;
    let metadata = fs::metadata(&workspace_path.absolute).map_err(|error| {
        NativeToolFailure::new(
            "read_failed",
            format!("failed to read file metadata: {error}"),
            "Retry with a readable file path.",
        )
    })?;
    if !metadata.is_file() {
        return Err(NativeToolFailure::new(
            "not_a_file",
            format!("path is not a file: {}", workspace_path.relative),
            "Use file_list for directories or retry with a file path.",
        ));
    }
    let bytes = fs::read(&workspace_path.absolute).map_err(|error| {
        NativeToolFailure::new(
            "read_failed",
            format!("failed to read file: {error}"),
            "Retry with a readable file path.",
        )
    })?;
    if bytes.contains(&0) {
        return Err(NativeToolFailure::new(
            "unsupported_encoding",
            "binary files are not inlined into model context",
            "Use a text file path or inspect the file through a binary-aware viewer.",
        ));
    }
    let requested_max = value_usize(
        input,
        "maxBytes",
        DEFAULT_FILE_READ_BYTES,
        MAX_FILE_READ_BYTES,
    );
    let over_requested_budget = bytes.len() > requested_max;
    let slice = &bytes[..bytes.len().min(requested_max)];
    let encoding = value_string(input, "encoding").unwrap_or_else(|| "utf-8".to_string());
    let mut text = if encoding == "lossy-utf8" {
        String::from_utf8_lossy(slice).to_string()
    } else {
        String::from_utf8(slice.to_vec()).map_err(|error| {
            NativeToolFailure::new(
                "unsupported_encoding",
                format!("file is not valid UTF-8: {error}"),
                "Retry with encoding=lossy-utf8 or use another file viewer.",
            )
        })?
    };
    let start_line = input
        .get("startLine")
        .and_then(Value::as_u64)
        .map(|value| value as usize);
    let end_line = input
        .get("endLine")
        .and_then(Value::as_u64)
        .map(|value| value as usize);
    if start_line.is_some() || end_line.is_some() {
        text = apply_line_range(&text, start_line, end_line);
    }
    let read_version = record_file_read_state(
        session_id,
        &workspace_path.relative,
        &workspace_path.absolute,
        &bytes,
        metadata.len(),
        metadata_mtime_ms(&metadata),
        start_line,
        end_line,
    )?;
    let content = format!(
        "{}\n---\n{}",
        workspace_path.relative,
        text.trim_end_matches('\n')
    );
    let artifact_ref = if over_requested_budget {
        write_tool_artifact_with_kind(
            session_id,
            turn_id,
            tool_call_id,
            ToolArtifactKind::RawData,
            &String::from_utf8_lossy(&bytes),
        )
    } else {
        None
    };
    Ok(NativeToolSuccess {
        content,
        raw: json!({
            "path": workspace_path.relative,
            "absolutePath": workspace_path.absolute.display().to_string(),
            "bytes": metadata.len(),
            "bytesReturned": slice.len(),
            "truncated": over_requested_budget,
            "artifactRef": artifact_ref,
            "startLine": start_line,
            "endLine": end_line,
            "readVersion": read_version,
            "contentHash": stable_text_hash(&bytes),
            "mtimeMs": metadata_mtime_ms(&metadata),
            "range": {
                "startLine": start_line,
                "endLine": end_line,
            },
        }),
        recommended_next_action: over_requested_budget.then_some(
            "Use a narrower line range or read the artifact reference if more context is needed."
                .to_string(),
        ),
    })
}

pub(crate) fn tool_artifact_read(
    _session_id: &str,
    _turn_id: &str,
    _tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    let artifact = if let Some(path) = value_string(input, "path") {
        resolve_lyra_artifact_path(&path)?.ok_or_else(|| {
            NativeToolFailure::new(
                "permission_denied",
                format!("path is not a readable Lyra artifact: {path}"),
                "Use artifact_read only with a Lyra artifact path, artifact id, or openTarget from tool output.",
            )
        })?
    } else if let Some(source) = value_string(input, "source") {
        resolve_lyra_artifact_path(&source)?.ok_or_else(|| {
            NativeToolFailure::new(
                "permission_denied",
                format!("source is not a readable Lyra artifact: {source}"),
                "Use artifact_read only with a Lyra artifact path, artifact id, or openTarget from tool output.",
            )
        })?
    } else if let Some(id) = value_string(input, "artifactId").or_else(|| value_string(input, "id"))
    {
        find_lyra_artifact_by_id(&id)?
    } else {
        return Err(NativeToolFailure::new(
            "bad_request",
            "artifact_read requires path, source, artifactId, or id",
            "Pass the imageArtifact.id/path/openTarget returned by Lyra Lumen or another Lyra tool.",
        ));
    };

    let metadata = fs::metadata(&artifact.absolute).map_err(|error| {
        NativeToolFailure::new(
            "read_failed",
            format!("failed to read artifact metadata: {error}"),
            "Retry with a readable Lyra artifact path.",
        )
    })?;
    if metadata.len() == 0 || metadata.len() > MAX_ARTIFACT_READ_BYTES {
        return Err(NativeToolFailure::new(
            "artifact_size_invalid",
            format!(
                "artifact size is outside the readable range: {} bytes",
                metadata.len()
            ),
            "Open the artifact in Workbench or capture a smaller evidence artifact.",
        ));
    }
    let is_image = artifact.media_type.starts_with("image/");
    if is_image {
        return Ok(NativeToolSuccess {
            content: format!(
                "Lyra artifact image {} is readable.\n- kind: {}\n- mediaType: {}\n- bytes: {}\n- path: {}\nThe image will be attached to the next provider request as model vision input when the active model supports image input. Do not call file_read for this artifact path again.",
                artifact.artifact_id,
                artifact.kind,
                artifact.media_type,
                metadata.len(),
                artifact.absolute.display()
            ),
            raw: json!({
                "kind": "lyra_artifact_read",
                "artifactId": artifact.artifact_id,
                "artifactKind": artifact.kind,
                "path": artifact.absolute.display().to_string(),
                "mediaType": artifact.media_type,
                "bytes": metadata.len(),
                "providerImage": {
                    "path": artifact.absolute.display().to_string(),
                    "mediaType": artifact.media_type,
                    "bytes": metadata.len(),
                },
                "imageArtifact": {
                    "id": artifact.artifact_id,
                    "kind": "image",
                    "mediaType": artifact.media_type,
                    "path": artifact.absolute.display().to_string(),
                    "openTarget": {
                        "kind": "file",
                        "path": artifact.absolute.display().to_string(),
                        "mediaType": artifact.media_type,
                    }
                }
            }),
            recommended_next_action: Some(
                "Use the attached model vision evidence in the next reasoning step.".to_string(),
            ),
        });
    }

    let bytes = fs::read(&artifact.absolute).map_err(|error| {
        NativeToolFailure::new(
            "read_failed",
            format!("failed to read artifact: {error}"),
            "Retry with a readable Lyra artifact path.",
        )
    })?;
    if bytes.contains(&0) {
        return Err(NativeToolFailure::new(
            "unsupported_encoding",
            "binary Lyra artifact cannot be inlined as text",
            "Open it in Workbench, or use image artifacts through model vision.",
        ));
    }
    let requested_max = value_usize(
        input,
        "maxBytes",
        DEFAULT_FILE_READ_BYTES,
        MAX_FILE_READ_BYTES,
    );
    let over_requested_budget = bytes.len() > requested_max;
    let slice = &bytes[..bytes.len().min(requested_max)];
    let text = String::from_utf8_lossy(slice).to_string();
    Ok(NativeToolSuccess {
        content: format!(
            "Lyra artifact {}\n---\n{}",
            artifact.artifact_id,
            text.trim_end_matches('\n')
        ),
        raw: json!({
            "kind": "lyra_artifact_read",
            "artifactId": artifact.artifact_id,
            "artifactKind": artifact.kind,
            "path": artifact.absolute.display().to_string(),
            "mediaType": artifact.media_type,
            "bytes": metadata.len(),
            "bytesReturned": slice.len(),
            "truncated": over_requested_budget,
        }),
        recommended_next_action: over_requested_budget
            .then_some("Retry artifact_read with a narrower byte budget if needed.".to_string()),
    })
}

pub(crate) fn apply_line_range(
    text: &str,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> String {
    let start = start_line.unwrap_or(1).max(1);
    let end = end_line.unwrap_or(usize::MAX).max(start);
    text.lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let line_number = index + 1;
            (line_number >= start && line_number <= end).then(|| line.to_string())
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn tool_file_list(session_id: &str, input: &Value) -> NativeToolResult {
    let path = value_string(input, "path").unwrap_or_else(|| ".".to_string());
    let workspace_path = resolve_workspace_path(session_id, &path, false)?;
    let metadata = fs::metadata(&workspace_path.absolute).map_err(|error| {
        NativeToolFailure::new(
            "read_failed",
            format!("failed to read directory metadata: {error}"),
            "Retry with a readable directory path.",
        )
    })?;
    if !metadata.is_dir() {
        return Err(NativeToolFailure::new(
            "not_a_directory",
            format!("path is not a directory: {}", workspace_path.relative),
            "Use file_read for files or retry with a directory path.",
        ));
    }
    let include_hidden = value_bool(input, "includeHidden", false);
    let recursive = value_bool(input, "recursive", false);
    let depth = value_usize(input, "depth", if recursive { 4 } else { 1 }, 16);
    let limit = value_usize(input, "limit", DEFAULT_LIST_LIMIT, 1000);
    let mut entries = Vec::new();
    collect_directory_entries(
        &workspace_path.root,
        &workspace_path.absolute,
        include_hidden,
        if recursive { depth } else { 1 },
        limit,
        &mut entries,
    )?;
    let truncated = entries.len() >= limit;
    let content = entries
        .iter()
        .map(|entry| {
            let kind = entry.get("kind").and_then(Value::as_str).unwrap_or("entry");
            let path = entry.get("path").and_then(Value::as_str).unwrap_or("");
            format!("{kind}\t{path}")
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok(NativeToolSuccess {
        content: if content.is_empty() {
            "Directory is empty.".to_string()
        } else {
            content
        },
        raw: json!({
            "path": workspace_path.relative,
            "entries": entries,
            "truncated": truncated,
            "limit": limit,
        }),
        recommended_next_action: truncated.then_some(
            "Narrow the directory path or increase depth in a follow-up call.".to_string(),
        ),
    })
}

pub(crate) fn collect_directory_entries(
    workspace_root: &Path,
    dir: &Path,
    include_hidden: bool,
    remaining_depth: usize,
    limit: usize,
    entries: &mut Vec<Value>,
) -> Result<(), NativeToolFailure> {
    if entries.len() >= limit || remaining_depth == 0 {
        return Ok(());
    }
    let mut children = fs::read_dir(dir)
        .map_err(|error| {
            NativeToolFailure::new(
                "read_failed",
                format!("failed to list directory {}: {error}", dir.display()),
                "Retry with a readable directory path.",
            )
        })?
        .flatten()
        .collect::<Vec<_>>();
    children.sort_by_key(|entry| entry.path());
    for entry in children {
        if entries.len() >= limit {
            break;
        }
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !include_hidden && file_name.starts_with('.') {
            continue;
        }
        let metadata = entry.metadata().ok();
        let kind = if metadata.as_ref().is_some_and(|metadata| metadata.is_dir()) {
            "directory"
        } else if metadata.as_ref().is_some_and(|metadata| metadata.is_file()) {
            "file"
        } else {
            "other"
        };
        let relative = path
            .strip_prefix(workspace_root)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.display().to_string());
        entries.push(json!({
            "path": relative,
            "kind": kind,
            "bytes": metadata.as_ref().map(|metadata| metadata.len()),
        }));
        if kind == "directory" {
            collect_directory_entries(
                workspace_root,
                &path,
                include_hidden,
                remaining_depth.saturating_sub(1),
                limit,
                entries,
            )?;
        }
    }
    Ok(())
}

pub(crate) fn tool_file_glob(session_id: &str, input: &Value) -> NativeToolResult {
    let pattern = required_value_string(input, "pattern")?;
    let root = value_string(input, "root").unwrap_or_else(|| ".".to_string());
    let workspace_path = resolve_workspace_path(session_id, &root, false)?;
    let compiled = Pattern::new(&pattern).map_err(|error| {
        NativeToolFailure::new(
            "bad_glob",
            format!("invalid glob pattern: {error}"),
            "Retry with a valid glob pattern such as **/*.rs.",
        )
    })?;
    let include_hidden = value_bool(input, "includeHidden", false);
    let limit = value_usize(input, "limit", DEFAULT_LIST_LIMIT, 2000);
    let mut files = Vec::new();
    collect_workspace_files(
        &workspace_path.root,
        &workspace_path.absolute,
        include_hidden,
        MAX_SEARCH_FILES,
        &mut files,
    )?;
    let mut matches = Vec::new();
    for path in files {
        if matches.len() >= limit {
            break;
        }
        let relative = path
            .strip_prefix(&workspace_path.root)
            .map(|path| path.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.display().to_string());
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if compiled.matches(&relative) || (!pattern.contains('/') && compiled.matches(file_name)) {
            matches.push(json!({ "path": relative }));
        }
    }
    Ok(NativeToolSuccess {
        content: matches
            .iter()
            .filter_map(|item| item.get("path").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        raw: json!({
            "pattern": pattern,
            "root": workspace_path.relative,
            "matches": matches,
            "truncated": matches.len() >= limit,
        }),
        recommended_next_action: None,
    })
}

pub(crate) fn tool_file_grep(session_id: &str, input: &Value) -> NativeToolResult {
    let pattern = required_value_string(input, "pattern")?;
    let root = value_string(input, "path").unwrap_or_else(|| ".".to_string());
    let workspace_path = resolve_workspace_path(session_id, &root, false)?;
    let glob = value_string(input, "glob");
    let case_insensitive = value_bool(input, "caseInsensitive", false);
    let context_lines = value_usize(input, "contextLines", 0, 10);
    let max_results = value_usize(input, "maxResults", 200, 2000);

    let mut cmd = std::process::Command::new("rg");
    cmd.arg("--line-number")
        .arg("--no-heading")
        .arg("--color=never")
        .arg("-m")
        .arg(max_results.to_string())
        .current_dir(&workspace_path.absolute);

    if case_insensitive {
        cmd.arg("-i");
    }
    if context_lines > 0 {
        cmd.arg("-C").arg(context_lines.to_string());
    }
    if let Some(ref g) = glob {
        cmd.arg("-g").arg(g);
    }
    cmd.arg(&pattern);

    let output = cmd.output().map_err(|error| {
        NativeToolFailure::new(
            "grep_failed",
            format!("failed to run rg: {error}"),
            "Ensure ripgrep (rg) is installed and in PATH.",
        )
    })?;

    // ponytail: rg exit code 1 = no matches (not an error). Only treat code != 0 && != 1 as failure.
    if !output.status.success() && !output.status.code().is_some_and(|c| c == 1) {
        return Err(NativeToolFailure::new(
            "grep_failed",
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
            "Check the regex pattern and try again.",
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let lines: Vec<&str> = stdout.lines().collect();
    let truncated = lines.len() >= max_results;
    let display: &[&str] = if truncated {
        &lines[..max_results]
    } else {
        &lines
    };

    Ok(NativeToolSuccess {
        content: if display.is_empty() {
            "No matches found.".to_string()
        } else {
            display.join("\n")
        },
        raw: json!({
            "pattern": pattern,
            "path": workspace_path.relative,
            "matches": display.len(),
            "truncated": truncated,
        }),
        recommended_next_action: truncated
            .then_some("Narrow the pattern or path to reduce results.".to_string()),
    })
}

pub(crate) fn collect_workspace_files(
    workspace_root: &Path,
    dir: &Path,
    include_hidden: bool,
    max_files: usize,
    files: &mut Vec<PathBuf>,
) -> Result<(), NativeToolFailure> {
    if files.len() >= max_files {
        return Ok(());
    }
    let mut children = fs::read_dir(dir)
        .map_err(|error| {
            NativeToolFailure::new(
                "read_failed",
                format!("failed to walk directory {}: {error}", dir.display()),
                "Retry with a readable workspace path.",
            )
        })?
        .flatten()
        .collect::<Vec<_>>();
    children.sort_by_key(|entry| entry.path());
    for entry in children {
        if files.len() >= max_files {
            break;
        }
        let path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !include_hidden && file_name.starts_with('.') {
            continue;
        }
        if !include_hidden && matches!(file_name.as_str(), "target" | "node_modules" | ".git") {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.is_dir() {
            collect_workspace_files(workspace_root, &path, include_hidden, max_files, files)?;
        } else if metadata.is_file() {
            files.push(path);
        }
    }
    Ok(())
}

pub(crate) fn tool_file_write(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    let path = required_value_string(input, "path")?;
    let content = input
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "content is required",
                "Retry with the content field set to the full file contents.",
            )
        })?
        .to_string();
    let overwrite = value_bool(input, "overwrite", false);
    let workspace_path = resolve_workspace_path(session_id, &path, true)?;
    if workspace_path.absolute.exists() && !overwrite {
        return Err(NativeToolFailure::new(
            "file_exists",
            format!(
                "file already exists and overwrite=false: {}",
                workspace_path.relative
            ),
            "Set overwrite=true or use file_edit for an exact replacement.",
        ));
    }
    let before_exists = workspace_path.absolute.exists();
    let old = fs::read_to_string(&workspace_path.absolute).unwrap_or_default();
    validate_design_style_change(session_id, &workspace_path.relative, &old, &content)?;
    if let Some(parent) = workspace_path.absolute.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            NativeToolFailure::new(
                "write_failed",
                format!("failed to create parent directory: {error}"),
                "Retry after creating a writable parent directory.",
            )
        })?;
    }
    let preview_diff = diff_text(&workspace_path.relative, &old, &content);
    emit_running_mutation_diff(
        session_id,
        turn_id,
        tool_call_id,
        "file",
        "write",
        input,
        &workspace_path.relative,
        &preview_diff,
    );
    fs::write(&workspace_path.absolute, &content).map_err(|error| {
        NativeToolFailure::new(
            "write_failed",
            format!("failed to write file: {error}"),
            "Retry with a writable workspace path.",
        )
    })?;
    let diff = diff_text(&workspace_path.relative, &old, &content);
    let (additions, deletions) = diff_line_stats(&diff);
    let diff_artifact_ref = write_diff_artifact(session_id, turn_id, tool_call_id, &diff);
    let before_ref = write_file_snapshot_artifact(
        session_id,
        turn_id,
        tool_call_id,
        &workspace_path.relative,
        "before",
        if before_exists { &old } else { "" },
    );
    let after_ref = write_file_snapshot_artifact(
        session_id,
        turn_id,
        tool_call_id,
        &workspace_path.relative,
        "after",
        &content,
    );
    Ok(NativeToolSuccess {
        content: format!("Wrote {}\n{}", workspace_path.relative, diff),
        raw: json!({
            "changedFiles": [{
                "path": workspace_path.relative,
                "operation": if before_exists { "write" } else { "add" },
                "bytes": content.len(),
                "additions": additions,
                "deletions": deletions,
                "beforeExists": before_exists,
                "afterExists": true,
                "beforeRef": before_ref,
                "afterRef": after_ref,
                "diffRef": diff_artifact_ref,
            }],
            "diff": diff,
            "diffArtifactRef": diff_artifact_ref,
            // Render as a colored diff edit card (icon + path + +/- stats), not a
            // raw text blob. The activity layer lifts these hints to the top level.
            "activityKind": "edit",
            "rendererHint": "edit",
        }),
        recommended_next_action: Some(
            "Run the relevant validation command for the changed file.".to_string(),
        ),
    })
}

pub(crate) fn tool_file_edit(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    tool_file_strict_edit(session_id, turn_id, tool_call_id, input)
}

pub(crate) fn tool_file_strict_edit(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    let path = required_value_string(input, "path")?;
    let old_string = required_value_string(input, "oldString")?;
    let new_string = input
        .get("newString")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "newString is required",
                "Retry with the replacement string.",
            )
        })?
        .to_string();
    let replace_all = value_bool(input, "replaceAll", false);
    let workspace_path = resolve_workspace_path(session_id, &path, false)?;
    let old_bytes = fs::read(&workspace_path.absolute).map_err(|error| {
        NativeToolFailure::new(
            "read_failed",
            format!("failed to read file before edit: {error}"),
            "Retry with a readable UTF-8 workspace file.",
        )
    })?;
    if old_bytes.contains(&0) {
        return Err(NativeToolFailure::new(
            "encoding_unsupported",
            "strict_edit only supports text files",
            "Use a text source file or a binary-aware tool.",
        ));
    }
    let metadata = fs::metadata(&workspace_path.absolute).map_err(|error| {
        NativeToolFailure::new(
            "read_failed",
            format!("failed to read file metadata before edit: {error}"),
            "Retry with a readable workspace file.",
        )
    })?;
    validate_file_read_state(
        session_id,
        &workspace_path.relative,
        &workspace_path.absolute,
        &old_bytes,
        metadata.len(),
        metadata_mtime_ms(&metadata),
        value_string(input, "expectedReadVersion").as_deref(),
    )?;
    let old = String::from_utf8(old_bytes).map_err(|error| {
        NativeToolFailure::new(
            "encoding_unsupported",
            format!("file is not valid UTF-8: {error}"),
            "Retry with a UTF-8 text file.",
        )
    })?;
    let updated = apply_fuzzy_replacement(&old, &old_string, &new_string, replace_all)?;
    validate_design_style_change(session_id, &workspace_path.relative, &old, &updated)?;
    let preview_diff = diff_text(&workspace_path.relative, &old, &updated);
    emit_running_mutation_diff(
        session_id,
        turn_id,
        tool_call_id,
        "file",
        "strict_edit",
        input,
        &workspace_path.relative,
        &preview_diff,
    );
    fs::write(&workspace_path.absolute, &updated).map_err(|error| {
        NativeToolFailure::new(
            "write_failed",
            format!("failed to write edited file: {error}"),
            "Retry with a writable workspace file.",
        )
    })?;
    let diff = preview_diff;
    let diff_artifact_ref = write_diff_artifact(session_id, turn_id, tool_call_id, &diff);
    let before_ref = write_file_snapshot_artifact(
        session_id,
        turn_id,
        tool_call_id,
        &workspace_path.relative,
        "before",
        &old,
    );
    let after_ref = write_file_snapshot_artifact(
        session_id,
        turn_id,
        tool_call_id,
        &workspace_path.relative,
        "after",
        &updated,
    );
    let (additions, deletions) = diff_line_stats(&diff);
    Ok(NativeToolSuccess {
        content: format!("Strict edited {}\n{}", workspace_path.relative, diff),
        raw: json!({
            "changedFiles": [{
                "path": workspace_path.relative,
                "operation": "strict_edit",
                "additions": additions,
                "deletions": deletions,
                "beforeExists": true,
                "afterExists": true,
                "beforeRef": before_ref,
                "afterRef": after_ref,
                "diffRef": diff_artifact_ref,
            }],
            "diff": diff,
            "diffArtifactRef": diff_artifact_ref,
            "activityKind": "edit",
            "rendererHint": "edit",
        }),
        recommended_next_action: Some(
            "Review git_diff and run the relevant validation command.".to_string(),
        ),
    })
}

pub(crate) fn apply_exact_replacement(
    original: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Result<String, NativeToolFailure> {
    if old_string.is_empty() {
        return Err(NativeToolFailure::new(
            "bad_request",
            "oldString must not be empty",
            "Retry with a non-empty exact oldString.",
        ));
    }
    let count = original.matches(old_string).count();
    if count == 0 {
        return Err(NativeToolFailure::new(
            "edit_not_found",
            "oldString was not found in the target file",
            "Read the current file contents and retry with an exact oldString.",
        ));
    }
    if count > 1 && !replace_all {
        return Err(NativeToolFailure::new(
            "edit_not_unique",
            format!("oldString matched {count} times"),
            "Use a more specific oldString or set replaceAll=true.",
        ));
    }
    Ok(if replace_all {
        original.replace(old_string, new_string)
    } else {
        original.replacen(old_string, new_string, 1)
    })
}

/// Exact replacement first; on `edit_not_found`, fall back to a whitespace-
/// tolerant line-based match. The fuzzy pass ignores per-line leading/trailing
/// whitespace differences and inserts `new_string` **verbatim** at the matched
/// block — no reindent. This is the same approach as Claude Code, Cline, and
/// Codex: match loosely, insert verbatim. Reindenting was removed because it
/// silently corrupted indentation when `new_string` lines had different
/// relative depths than `old_string`'s first line.
///
/// Safety: the fuzzy pass NEVER silently picks one of several candidates — more
/// than one whitespace-insensitive match without `replaceAll` is reported as
/// `edit_not_unique`, exactly like the exact path. Only whitespace is tolerated;
/// no token-level or similarity fuzzing, so it cannot drift to the wrong code.
pub(crate) fn apply_fuzzy_replacement(
    original: &str,
    old_string: &str,
    new_string: &str,
    replace_all: bool,
) -> Result<String, NativeToolFailure> {
    match apply_exact_replacement(original, old_string, new_string, replace_all) {
        Ok(updated) => return Ok(updated),
        // Only an outright miss is eligible for the fuzzy fallback. Empty input
        // and genuine ambiguity (edit_not_unique) must surface unchanged.
        Err(failure) if failure.code == "edit_not_found" => {}
        Err(failure) => return Err(failure),
    }

    let original_lines: Vec<&str> = original.split('\n').collect();
    let old_lines: Vec<&str> = old_string.split('\n').collect();
    let old_trimmed: Vec<&str> = old_lines.iter().map(|line| line.trim()).collect();
    let window = old_trimmed.len();
    if window == 0 || old_trimmed.iter().all(|line| line.is_empty()) {
        return Err(NativeToolFailure::new(
            "edit_not_found",
            "oldString was not found in the target file",
            "Read the current file contents and retry with an exact oldString.",
        ));
    }

    let mut match_starts = Vec::new();
    if window <= original_lines.len() {
        for start in 0..=(original_lines.len() - window) {
            if (0..window)
                .all(|offset| original_lines[start + offset].trim() == old_trimmed[offset])
            {
                match_starts.push(start);
            }
        }
    }
    if match_starts.is_empty() {
        return Err(NativeToolFailure::new(
            "edit_not_found",
            "oldString was not found in the target file (even ignoring whitespace)",
            "Read the current file contents and retry with an exact oldString.",
        ));
    }
    if match_starts.len() > 1 && !replace_all {
        return Err(NativeToolFailure::new(
            "edit_not_unique",
            format!(
                "oldString matched {} times ignoring whitespace",
                match_starts.len()
            ),
            "Use a more specific oldString or set replaceAll=true.",
        ));
    }

    // ponytail: insert verbatim — no reindent. The fuzzy match only locates
    // where to splice; new_string is inserted as-is so the model's intended
    // indentation is preserved without silent corruption.
    let new_lines: Vec<String> = new_string.split('\n').map(|s| s.to_string()).collect();
    let mut result_lines: Vec<String> =
        original_lines.iter().map(|line| line.to_string()).collect();
    let targets: Vec<usize> = if replace_all {
        match_starts.clone()
    } else {
        vec![match_starts[0]]
    };
    // Splice from the bottom up so earlier indices stay valid.
    for &start in targets.iter().rev() {
        result_lines.splice(start..start + window, new_lines.clone());
    }
    Ok(result_lines.join("\n"))
}

fn record_file_read_state(
    session_id: &str,
    relative_path: &str,
    absolute_path: &Path,
    bytes: &[u8],
    size: u64,
    mtime_ms: u64,
    start_line: Option<usize>,
    end_line: Option<usize>,
) -> Result<String, NativeToolFailure> {
    let content_hash = stable_text_hash(bytes);
    let read_version = format!("{mtime_ms}-{size}-{content_hash}");
    let mut state = state().lock().map_err(|_| {
        NativeToolFailure::new(
            "runtime_state_unavailable",
            "agent runtime state lock failed while recording file read state",
            "Retry the tool call.",
        )
    })?;
    let session = state.sessions.get_mut(session_id).ok_or_else(|| {
        NativeToolFailure::new(
            "session_not_found",
            format!("session not found: {session_id}"),
            "Start a valid Lyra runtime session and retry.",
        )
    })?;
    session.file_read_state.insert(
        relative_path.to_string(),
        FileReadStateEntry {
            path: relative_path.to_string(),
            absolute_path: absolute_path.display().to_string(),
            read_version: read_version.clone(),
            content_hash,
            mtime_ms,
            size,
            start_line,
            end_line,
            read_at: now(),
        },
    );
    session.dirty = true;
    state.save_state().map_err(|error| {
        NativeToolFailure::new(
            "runtime_state_unavailable",
            format!("failed to save file read state: {error}"),
            "Retry the tool call.",
        )
    })?;
    Ok(read_version)
}

fn validate_file_read_state(
    session_id: &str,
    relative_path: &str,
    absolute_path: &Path,
    current_bytes: &[u8],
    current_size: u64,
    current_mtime_ms: u64,
    expected_read_version: Option<&str>,
) -> Result<(), NativeToolFailure> {
    let current_hash = stable_text_hash(current_bytes);
    let entry = state()
        .lock()
        .map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed while checking file read state",
                "Retry the tool call.",
            )
        })?
        .sessions
        .get(session_id)
        .and_then(|session| session.file_read_state.get(relative_path).cloned())
        .ok_or_else(|| {
            NativeToolFailure::new(
                "must_read_first",
                format!("file must be read before strict editing: {relative_path}"),
                "Inspect the file with exec_command (for example sed or cat) and use apply_patch for edits.",
            )
        })?;
    if let Some(expected) = expected_read_version
        && expected != entry.read_version
    {
        return Err(NativeToolFailure::new(
            "file_modified_since_read",
            "expectedReadVersion does not match the latest recorded readVersion",
            "Read the file again and retry with the new readVersion.",
        ));
    }
    if entry.absolute_path != absolute_path.display().to_string()
        || entry.size != current_size
        || entry.mtime_ms != current_mtime_ms
        || entry.content_hash != current_hash
    {
        return Err(NativeToolFailure::new(
            "file_modified_since_read",
            format!("file changed since it was last read: {relative_path}"),
            "Read the current file contents again before editing.",
        ));
    }
    Ok(())
}

fn stable_text_hash(bytes: &[u8]) -> String {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn metadata_mtime_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

pub(crate) fn tool_file_multiedit(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    let edits = input
        .get("edits")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "edits array is required",
                "Retry with edits containing oldString and newString entries.",
            )
        })?;
    let default_path = value_string(input, "path");
    let mut staged: HashMap<PathBuf, (String, String, String)> = HashMap::new();
    for edit in edits {
        let path = value_string(edit, "path")
            .or_else(|| default_path.clone())
            .ok_or_else(|| {
                NativeToolFailure::new(
                    "bad_request",
                    "each edit needs path or top-level path",
                    "Retry with a path for every edit or a top-level path.",
                )
            })?;
        let old_string = required_value_string(edit, "oldString")?;
        let new_string = edit
            .get("newString")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                NativeToolFailure::new(
                    "bad_request",
                    "newString is required for every edit",
                    "Retry with all edit replacement strings.",
                )
            })?
            .to_string();
        let replace_all = value_bool(edit, "replaceAll", false);
        let workspace_path = resolve_workspace_path(session_id, &path, false)?;
        let entry = staged
            .entry(workspace_path.absolute.clone())
            .or_insert_with(|| {
                let old = fs::read_to_string(&workspace_path.absolute).unwrap_or_default();
                (workspace_path.relative.clone(), old.clone(), old)
            });
        entry.2 = apply_fuzzy_replacement(&entry.2, &old_string, &new_string, replace_all)?;
    }
    let mut diffs = Vec::new();
    let mut changed_files = Vec::new();
    for (relative, old, updated) in staged.values() {
        validate_design_style_change(session_id, relative, old, updated)?;
    }
    for (relative, old, updated) in staged.values() {
        diffs.push(diff_text(relative, old, updated));
    }
    if let Some((relative, _, _)) = staged.values().next() {
        emit_running_mutation_diff(
            session_id,
            turn_id,
            tool_call_id,
            "file",
            "multiedit",
            input,
            relative,
            &diffs.join("\n"),
        );
    }
    for (path, (relative, old, updated)) in staged {
        fs::write(&path, &updated).map_err(|error| {
            NativeToolFailure::new(
                "write_failed",
                format!("failed to write edited file {relative}: {error}"),
                "Retry after checking file permissions.",
            )
        })?;
        let diff = diff_text(&relative, &old, &updated);
        let (additions, deletions) = diff_line_stats(&diff);
        diffs.push(diff.clone());
        changed_files.push(json!({
            "path": relative,
            "operation": "multiedit",
            "additions": additions,
            "deletions": deletions,
            "beforeExists": true,
            "afterExists": true,
            "beforeRef": write_file_snapshot_artifact(session_id, turn_id, tool_call_id, &relative, "before", &old),
            "afterRef": write_file_snapshot_artifact(session_id, turn_id, tool_call_id, &relative, "after", &updated),
        }));
    }
    let diff = diffs.join("\n");
    let diff_artifact_ref = write_diff_artifact(session_id, turn_id, tool_call_id, &diff);
    attach_diff_ref_to_changed_files(&mut changed_files, &diff_artifact_ref);
    Ok(NativeToolSuccess {
        content: format!("Applied {} staged edits.\n{}", changed_files.len(), diff),
        raw: json!({
            "changedFiles": changed_files,
            "diff": diff,
            "diffArtifactRef": diff_artifact_ref,
            "activityKind": "edit",
            "rendererHint": "edit",
        }),
        recommended_next_action: Some(
            "Review the diff and run the relevant validation command.".to_string(),
        ),
    })
}

pub(crate) fn diff_text(path: &str, old: &str, new: &str) -> String {
    let patch = diffy::create_patch(old, new).to_string();
    if patch.trim().is_empty() {
        return format!("No textual diff for {path}.");
    }
    // diffy emits its own `--- original` / `+++ modified` header lines. Drop them
    // and substitute path-based headers so the unified diff has a single, correct
    // file header instead of a doubled `--- path / +++ path / --- original /
    // +++ modified` block.
    let body = patch
        .split_inclusive('\n')
        .skip_while(|line| {
            let trimmed = line.trim_end();
            trimmed.starts_with("--- ") || trimmed.starts_with("+++ ")
        })
        .collect::<String>();
    format!("--- {path}\n+++ {path}\n{body}")
}

pub(crate) fn diff_line_stats(diff: &str) -> (usize, usize) {
    diff.lines()
        .filter(|line| !line.starts_with("+++") && !line.starts_with("---"))
        .fold((0, 0), |(additions, deletions), line| {
            if line.starts_with('+') {
                (additions + 1, deletions)
            } else if line.starts_with('-') {
                (additions, deletions + 1)
            } else {
                (additions, deletions)
            }
        })
}

pub(crate) fn path_qualifies_for_lyra_artifact_access(
    raw_path: &str,
) -> Result<bool, NativeToolFailure> {
    let Some(path) = normalize_lyra_artifact_path_input(raw_path) else {
        return Ok(false);
    };
    let candidate = PathBuf::from(path);
    if !candidate.is_absolute() {
        return Ok(false);
    }
    let allowed_roots = lyra_artifact_roots()?;
    if allowed_roots.is_empty() {
        return Ok(false);
    }
    let absolute = if candidate.exists() {
        candidate.canonicalize().map_err(|error| {
            NativeToolFailure::new(
                "path_unavailable",
                format!("failed to canonicalize Lyra artifact path: {error}"),
                "Retry with a readable Lyra artifact path.",
            )
        })?
    } else {
        candidate
    };
    Ok(allowed_roots
        .iter()
        .any(|(root, _)| absolute.starts_with(root)))
}

pub(crate) fn resolve_lyra_artifact_path(
    raw_path: &str,
) -> Result<Option<LyraArtifactPath>, NativeToolFailure> {
    let Some(path) = normalize_lyra_artifact_path_input(raw_path) else {
        return Ok(None);
    };
    let candidate = PathBuf::from(&path);
    if !candidate.is_absolute() {
        return Ok(None);
    }
    let allowed_roots = lyra_artifact_roots()?;
    if allowed_roots.is_empty() {
        return Ok(None);
    }
    if !candidate.exists() {
        let allowed = allowed_roots
            .iter()
            .any(|(root, _)| candidate.starts_with(root));
        if allowed {
            return Err(NativeToolFailure::new(
                "path_not_found",
                format!("Lyra artifact path does not exist: {}", candidate.display()),
                "Retry with an existing artifact path from the latest tool output.",
            ));
        }
        return Ok(None);
    }
    let absolute = candidate.canonicalize().map_err(|error| {
        NativeToolFailure::new(
            "path_unavailable",
            format!("failed to canonicalize Lyra artifact path: {error}"),
            "Retry with a readable Lyra artifact path.",
        )
    })?;
    if !absolute.is_file() {
        return Err(NativeToolFailure::new(
            "not_a_file",
            format!("Lyra artifact path is not a file: {}", absolute.display()),
            "Retry with a file artifact path.",
        ));
    }
    let Some((_, kind)) = allowed_roots
        .iter()
        .find(|(root, _)| absolute.starts_with(root))
    else {
        return Ok(None);
    };
    Ok(Some(LyraArtifactPath {
        artifact_id: artifact_id_from_path(&absolute),
        media_type: media_type_for_artifact_path(&absolute),
        kind: (*kind).to_string(),
        absolute,
    }))
}

fn normalize_lyra_artifact_path_input(raw_path: &str) -> Option<String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("lyra-file://") {
        return Url::parse(trimmed).ok().and_then(|url| {
            url.query_pairs()
                .find(|(key, _)| key == "path")
                .map(|(_, value)| value.into_owned())
        });
    }
    Some(trimmed.to_string())
}

fn lyra_artifact_roots() -> Result<Vec<(PathBuf, &'static str)>, NativeToolFailure> {
    let root = state()
        .lock()
        .map_err(|_| {
            NativeToolFailure::new(
                "runtime_state_unavailable",
                "agent runtime state lock failed",
                "Retry the tool call.",
            )
        })?
        .root
        .clone();
    let agent_root = root.parent().map(Path::to_path_buf);
    let mut candidates = vec![(root.join("artifacts"), "tool_output")];
    if let Some(agent_root) = agent_root {
        let modules_root = agent_root.parent().map(Path::to_path_buf);
        candidates.extend([
            (agent_root.join("lumen-evidence"), "lumen_evidence"),
            (agent_root.join("message-images"), "message_image"),
        ]);
        if let Some(modules_root) = modules_root {
            candidates.extend([
                (
                    modules_root.join("terminal").join("terminal-memory"),
                    "terminal_memory",
                ),
                (
                    modules_root
                        .join("terminal")
                        .join("terminal-memory")
                        .join("sessions"),
                    "terminal_memory",
                ),
            ]);
        }
    }
    Ok(candidates
        .into_iter()
        .filter_map(|(path, kind)| {
            path.exists()
                .then(|| path.canonicalize().ok().map(|root| (root, kind)))
                .flatten()
        })
        .collect())
}

fn find_lyra_artifact_by_id(id: &str) -> Result<LyraArtifactPath, NativeToolFailure> {
    let id = id.trim();
    if id.starts_with("dropped-image-") {
        return Err(NativeToolFailure::new(
            "bad_request",
            format!("{id} is a session inline image attachment id, not a Lyra artifact id"),
            "Use the source path on <lyra-image-attach> from the user message, or answer from the vision input already in context.",
        ));
    }
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains('\0') {
        return Err(NativeToolFailure::new(
            "bad_request",
            "artifact id is invalid",
            "Pass the exact imageArtifact.id returned by a Lyra tool.",
        ));
    }
    let mut stack = lyra_artifact_roots()?
        .into_iter()
        .map(|(root, _)| root)
        .collect::<Vec<_>>();
    let mut visited = 0_usize;
    while let Some(dir) = stack.pop() {
        visited = visited.saturating_add(1);
        if visited > 20_000 {
            break;
        }
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or(name);
            if stem == id || stem.starts_with(&format!("{id}-")) || name.starts_with(id) {
                let path = path.display().to_string();
                if let Some(artifact) = resolve_lyra_artifact_path(&path)? {
                    return Ok(artifact);
                }
            }
        }
    }
    Err(NativeToolFailure::new(
        "artifact_not_found",
        format!("Lyra artifact not found: {id}"),
        "Use an artifact id/path from the latest Lyra tool output.",
    ))
}

fn artifact_id_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("lyra-artifact")
        .to_string()
}

fn media_type_for_artifact_path(path: &Path) -> String {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "txt" | "log" | "md" => "text/plain; charset=utf-8",
        "json" => "application/json",
        "jsonl" | "ndjson" => "application/x-ndjson",
        _ => "application/octet-stream",
    }
    .to_string()
}

pub(crate) fn write_diff_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    diff: &str,
) -> Option<Value> {
    if diff.trim().is_empty() {
        return None;
    }
    write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-diff"),
        ToolArtifactKind::Diff,
        diff,
    )
}

fn write_file_snapshot_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    path: &str,
    phase: &str,
    content: &str,
) -> Option<Value> {
    write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-{phase}-{path}"),
        ToolArtifactKind::Snapshot,
        content,
    )
}

fn attach_diff_ref_to_changed_files(changed_files: &mut [Value], diff_ref: &Option<Value>) {
    for file in changed_files {
        if let Some(object) = file.as_object_mut() {
            object
                .entry("diffRef".to_string())
                .or_insert_with(|| diff_ref.clone().unwrap_or(Value::Null));
        }
    }
}

#[derive(Clone)]
enum StagedPatchOperation {
    Write {
        absolute: PathBuf,
        relative: String,
        before: Option<String>,
        after: String,
        operation: &'static str,
    },
    Delete {
        absolute: PathBuf,
        relative: String,
        before: String,
    },
    Move {
        from_absolute: PathBuf,
        from_relative: String,
        to_absolute: PathBuf,
        to_relative: String,
        content: String,
    },
}

#[derive(Clone, Debug)]
enum CodexPatchOperation {
    Add {
        path: String,
        content: String,
    },
    Update {
        path: String,
        new_path: Option<String>,
        hunks: Vec<Vec<CodexPatchLine>>,
    },
    Delete {
        path: String,
    },
}

#[derive(Clone, Debug)]
enum CodexPatchLine {
    Context(String),
    Remove(String),
    Add(String),
}

pub(crate) fn tool_apply_patch(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
) -> NativeToolResult {
    let staged = if let Some(patch) = input.get("patch").and_then(Value::as_str) {
        stage_codex_patch(session_id, patch)?
    } else {
        stage_structured_patch(session_id, input)?
    };
    execute_staged_patch(session_id, turn_id, tool_call_id, input, staged)
}

fn stage_structured_patch(
    session_id: &str,
    input: &Value,
) -> Result<Vec<StagedPatchOperation>, NativeToolFailure> {
    let operations = input
        .get("operations")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_request",
                "patch string or operations array is required",
                "Retry with a Codex patch string using the provider-visible apply_patch tool.",
            )
        })?;
    let mut staged = Vec::new();
    let mut touched = HashSet::new();
    for operation in operations {
        let op = required_value_string(operation, "op")?;
        let path = required_value_string(operation, "path")?;
        match op.as_str() {
            "add" => {
                let workspace_path = resolve_new_patch_path(session_id, &path)?;
                if workspace_path.absolute.exists() {
                    return Err(NativeToolFailure::new(
                        "file_exists",
                        format!("cannot add existing file: {}", workspace_path.relative),
                        "Use update for existing files.",
                    ));
                }
                let content = operation
                    .get("content")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if !touched.insert(workspace_path.absolute.clone()) {
                    return Err(NativeToolFailure::new(
                        "conflicting_patch",
                        format!(
                            "patch touches the same path more than once: {}",
                            workspace_path.relative
                        ),
                        "Combine edits for the same path into one update operation.",
                    ));
                }
                staged.push(StagedPatchOperation::Write {
                    absolute: workspace_path.absolute,
                    relative: workspace_path.relative,
                    before: None,
                    after: content,
                    operation: "add",
                });
            }
            "update" => {
                let workspace_path = resolve_existing_patch_path(session_id, &path)?;
                let old_bytes = fs::read(&workspace_path.absolute).map_err(|error| {
                    NativeToolFailure::new(
                        "read_failed",
                        format!("failed to read file before patch: {error}"),
                        "Retry with a readable UTF-8 workspace file.",
                    )
                })?;
                if old_bytes.contains(&0) {
                    return Err(NativeToolFailure::new(
                        "encoding_unsupported",
                        "apply_patch update only supports text files",
                        "Use a text source file or a binary-aware tool.",
                    ));
                }
                let metadata = fs::metadata(&workspace_path.absolute).map_err(|error| {
                    NativeToolFailure::new(
                        "read_failed",
                        format!("failed to read file metadata before patch: {error}"),
                        "Retry with a readable workspace file.",
                    )
                })?;
                if operation.get("oldString").is_some() {
                    validate_file_read_state(
                        session_id,
                        &workspace_path.relative,
                        &workspace_path.absolute,
                        &old_bytes,
                        metadata.len(),
                        metadata_mtime_ms(&metadata),
                        operation.get("expectedReadVersion").and_then(Value::as_str),
                    )?;
                }
                let old = String::from_utf8(old_bytes).map_err(|error| {
                    NativeToolFailure::new(
                        "encoding_unsupported",
                        format!("file is not valid UTF-8: {error}"),
                        "Retry with a UTF-8 text file.",
                    )
                })?;
                let updated = if operation.get("oldString").is_some() {
                    let old_string = required_value_string(operation, "oldString")?;
                    let new_string = operation
                        .get("newString")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            NativeToolFailure::new(
                                "bad_request",
                                "newString is required when oldString is provided",
                                "Retry with oldString and newString.",
                            )
                        })?;
                    apply_fuzzy_replacement(
                        &old,
                        &old_string,
                        new_string,
                        value_bool(operation, "replaceAll", false),
                    )?
                } else {
                    operation
                        .get("content")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            NativeToolFailure::new(
                                "bad_request",
                                "update requires content or oldString/newString",
                                "Retry with a full content replacement or exact edit strings.",
                            )
                        })?
                        .to_string()
                };
                if !touched.insert(workspace_path.absolute.clone()) {
                    return Err(NativeToolFailure::new(
                        "conflicting_patch",
                        format!(
                            "patch touches the same path more than once: {}",
                            workspace_path.relative
                        ),
                        "Combine edits for the same path into one update operation.",
                    ));
                }
                staged.push(StagedPatchOperation::Write {
                    absolute: workspace_path.absolute,
                    relative: workspace_path.relative,
                    before: Some(old),
                    after: updated,
                    operation: "update",
                });
            }
            "delete" => {
                let workspace_path = resolve_existing_patch_path(session_id, &path)?;
                let old = fs::read_to_string(&workspace_path.absolute).map_err(|error| {
                    NativeToolFailure::new(
                        "read_failed",
                        format!("failed to read file before delete: {error}"),
                        "Retry with a readable UTF-8 workspace file.",
                    )
                })?;
                if !touched.insert(workspace_path.absolute.clone()) {
                    return Err(NativeToolFailure::new(
                        "conflicting_patch",
                        format!(
                            "patch touches the same path more than once: {}",
                            workspace_path.relative
                        ),
                        "Combine edits for the same path into one operation.",
                    ));
                }
                staged.push(StagedPatchOperation::Delete {
                    absolute: workspace_path.absolute,
                    relative: workspace_path.relative,
                    before: old,
                });
            }
            "move" => {
                let workspace_path = resolve_existing_patch_path(session_id, &path)?;
                let new_path = required_value_string(operation, "newPath")?;
                let next_workspace_path = resolve_new_patch_path(session_id, &new_path)?;
                if next_workspace_path.absolute.exists() {
                    return Err(NativeToolFailure::new(
                        "file_exists",
                        format!(
                            "move target already exists: {}",
                            next_workspace_path.relative
                        ),
                        "Choose a new target path or update the existing file explicitly.",
                    ));
                }
                let old = fs::read_to_string(&workspace_path.absolute).map_err(|error| {
                    NativeToolFailure::new(
                        "read_failed",
                        format!("failed to read file before move: {error}"),
                        "Retry with a readable UTF-8 workspace file.",
                    )
                })?;
                if !touched.insert(workspace_path.absolute.clone())
                    || !touched.insert(next_workspace_path.absolute.clone())
                {
                    return Err(NativeToolFailure::new(
                        "conflicting_patch",
                        "patch move conflicts with another operation",
                        "Use one operation per source/target path.",
                    ));
                }
                staged.push(StagedPatchOperation::Move {
                    from_absolute: workspace_path.absolute,
                    from_relative: workspace_path.relative,
                    to_absolute: next_workspace_path.absolute,
                    to_relative: next_workspace_path.relative,
                    content: old,
                });
            }
            _ => {
                return Err(NativeToolFailure::new(
                    "bad_request",
                    format!("unsupported patch operation: {op}"),
                    "Use add, update, delete, or move.",
                ));
            }
        }
    }
    Ok(staged)
}

fn stage_codex_patch(
    session_id: &str,
    patch: &str,
) -> Result<Vec<StagedPatchOperation>, NativeToolFailure> {
    let operations = parse_codex_patch(patch)?;
    let mut staged = Vec::new();
    let mut touched = HashSet::new();
    for operation in operations {
        match operation {
            CodexPatchOperation::Add { path, content } => {
                let workspace_path = resolve_new_patch_path(session_id, &path)?;
                if workspace_path.absolute.exists() {
                    return Err(NativeToolFailure::new(
                        "file_exists",
                        format!("cannot add existing file: {}", workspace_path.relative),
                        "Use an update hunk for existing files.",
                    ));
                }
                touch_patch_path(
                    &mut touched,
                    &workspace_path.absolute,
                    &workspace_path.relative,
                )?;
                staged.push(StagedPatchOperation::Write {
                    absolute: workspace_path.absolute,
                    relative: workspace_path.relative,
                    before: None,
                    after: content,
                    operation: "add",
                });
            }
            CodexPatchOperation::Delete { path } => {
                let workspace_path = resolve_existing_patch_path(session_id, &path)?;
                let old = fs::read_to_string(&workspace_path.absolute).map_err(|error| {
                    NativeToolFailure::new(
                        "read_failed",
                        format!("failed to read file before delete: {error}"),
                        "Retry with a readable UTF-8 workspace file.",
                    )
                })?;
                touch_patch_path(
                    &mut touched,
                    &workspace_path.absolute,
                    &workspace_path.relative,
                )?;
                staged.push(StagedPatchOperation::Delete {
                    absolute: workspace_path.absolute,
                    relative: workspace_path.relative,
                    before: old,
                });
            }
            CodexPatchOperation::Update {
                path,
                new_path,
                hunks,
            } => {
                let workspace_path = resolve_existing_patch_path(session_id, &path)?;
                let old_bytes = fs::read(&workspace_path.absolute).map_err(|error| {
                    NativeToolFailure::new(
                        "read_failed",
                        format!("failed to read file before patch: {error}"),
                        "Retry with a readable UTF-8 workspace file.",
                    )
                })?;
                if old_bytes.contains(&0) {
                    return Err(NativeToolFailure::new(
                        "encoding_unsupported",
                        "apply_patch update only supports text files",
                        "Use a text source file or a binary-aware tool.",
                    ));
                }
                let old = String::from_utf8(old_bytes).map_err(|error| {
                    NativeToolFailure::new(
                        "encoding_unsupported",
                        format!("file is not valid UTF-8: {error}"),
                        "Retry with a UTF-8 text file.",
                    )
                })?;
                let updated = if hunks.is_empty() {
                    old.clone()
                } else {
                    apply_codex_update_hunks(&old, &hunks)?
                };
                if let Some(new_path) = new_path {
                    let next_workspace_path = resolve_new_patch_path(session_id, &new_path)?;
                    if next_workspace_path.absolute.exists() {
                        return Err(NativeToolFailure::new(
                            "file_exists",
                            format!(
                                "move target already exists: {}",
                                next_workspace_path.relative
                            ),
                            "Choose a new target path or update the existing file explicitly.",
                        ));
                    }
                    touch_patch_path(
                        &mut touched,
                        &workspace_path.absolute,
                        &workspace_path.relative,
                    )?;
                    touch_patch_path(
                        &mut touched,
                        &next_workspace_path.absolute,
                        &next_workspace_path.relative,
                    )?;
                    if updated == old {
                        staged.push(StagedPatchOperation::Move {
                            from_absolute: workspace_path.absolute,
                            from_relative: workspace_path.relative,
                            to_absolute: next_workspace_path.absolute,
                            to_relative: next_workspace_path.relative,
                            content: old,
                        });
                    } else {
                        staged.push(StagedPatchOperation::Delete {
                            absolute: workspace_path.absolute,
                            relative: workspace_path.relative,
                            before: old,
                        });
                        staged.push(StagedPatchOperation::Write {
                            absolute: next_workspace_path.absolute,
                            relative: next_workspace_path.relative,
                            before: None,
                            after: updated,
                            operation: "move_update",
                        });
                    }
                } else {
                    if hunks.is_empty() {
                        return Err(NativeToolFailure::new(
                            "empty_patch",
                            format!("update hunk for {} has no changes", workspace_path.relative),
                            "Retry with at least one context, removal, or addition line.",
                        ));
                    }
                    touch_patch_path(
                        &mut touched,
                        &workspace_path.absolute,
                        &workspace_path.relative,
                    )?;
                    staged.push(StagedPatchOperation::Write {
                        absolute: workspace_path.absolute,
                        relative: workspace_path.relative,
                        before: Some(old),
                        after: updated,
                        operation: "update",
                    });
                }
            }
        }
    }
    if staged.is_empty() {
        return Err(NativeToolFailure::new(
            "empty_patch",
            "patch did not contain any file operations",
            "Retry with at least one Add File, Update File, Delete File, or Move to operation.",
        ));
    }
    Ok(staged)
}

fn execute_staged_patch(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    staged: Vec<StagedPatchOperation>,
) -> NativeToolResult {
    for operation in &staged {
        if let StagedPatchOperation::Write {
            relative,
            before,
            after,
            ..
        } = operation
        {
            validate_design_style_change(
                session_id,
                relative,
                before.as_deref().unwrap_or(""),
                after,
            )?;
        }
    }
    let mut changed_files = Vec::new();
    let mut diffs = Vec::new();
    let mut applied = Vec::new();
    let mut preview_diffs = Vec::new();
    let mut preview_path = None::<String>;
    for operation in &staged {
        match operation {
            StagedPatchOperation::Write {
                relative,
                before,
                after,
                ..
            } => {
                preview_diffs.push(diff_text(relative, before.as_deref().unwrap_or(""), after));
                if preview_path.is_none() {
                    preview_path = Some(relative.clone());
                }
            }
            StagedPatchOperation::Delete {
                relative, before, ..
            } => {
                preview_diffs.push(diff_text(relative, before, ""));
                if preview_path.is_none() {
                    preview_path = Some(relative.clone());
                }
            }
            StagedPatchOperation::Move { from_relative, .. } => {
                if preview_path.is_none() {
                    preview_path = Some(from_relative.clone());
                }
            }
        }
    }
    if let Some(relative) = preview_path.as_deref()
        && !preview_diffs.is_empty()
    {
        emit_running_mutation_diff(
            session_id,
            turn_id,
            tool_call_id,
            "file",
            "apply_patch",
            input,
            relative,
            &preview_diffs.join("\n"),
        );
    }
    for operation in &staged {
        if let Err(error) = apply_staged_patch_operation(operation) {
            rollback_staged_patch_operations(&applied);
            return Err(error);
        }
        applied.push(operation.clone());
    }
    for operation in staged {
        match operation {
            StagedPatchOperation::Write {
                relative,
                before,
                after,
                operation,
                ..
            } => {
                let diff = diff_text(&relative, before.as_deref().unwrap_or(""), &after);
                let (additions, deletions) = diff_line_stats(&diff);
                diffs.push(diff);
                changed_files.push(json!({
                    "path": relative,
                    "operation": operation,
                    "additions": additions,
                    "deletions": deletions,
                    "beforeExists": before.is_some(),
                    "afterExists": true,
                    "beforeRef": write_file_snapshot_artifact(session_id, turn_id, tool_call_id, &relative, "before", before.as_deref().unwrap_or("")),
                    "afterRef": write_file_snapshot_artifact(session_id, turn_id, tool_call_id, &relative, "after", &after),
                }));
            }
            StagedPatchOperation::Delete {
                relative, before, ..
            } => {
                let diff = diff_text(&relative, &before, "");
                let (additions, deletions) = diff_line_stats(&diff);
                diffs.push(diff);
                changed_files.push(json!({
                    "path": relative,
                    "operation": "delete",
                    "additions": additions,
                    "deletions": deletions,
                    "beforeExists": true,
                    "afterExists": false,
                    "beforeRef": write_file_snapshot_artifact(session_id, turn_id, tool_call_id, &relative, "before", &before),
                    "afterRef": write_file_snapshot_artifact(session_id, turn_id, tool_call_id, &relative, "after", ""),
                }));
            }
            StagedPatchOperation::Move {
                from_relative,
                to_relative,
                content,
                ..
            } => {
                changed_files.push(json!({
                    "path": from_relative,
                    "newPath": to_relative,
                    "operation": "move",
                    "additions": 0,
                    "deletions": 0,
                    "beforeExists": true,
                    "afterExists": true,
                    "beforeRef": write_file_snapshot_artifact(session_id, turn_id, tool_call_id, &from_relative, "before", &content),
                    "afterRef": write_file_snapshot_artifact(session_id, turn_id, tool_call_id, &to_relative, "after", &content),
                }));
            }
        }
    }
    let diff = diffs.join("\n");
    let diff_artifact_ref = write_diff_artifact(session_id, turn_id, tool_call_id, &diff);
    attach_diff_ref_to_changed_files(&mut changed_files, &diff_artifact_ref);
    Ok(NativeToolSuccess {
        content: format!(
            "Applied {} patch operations.\n{}",
            changed_files.len(),
            diff
        ),
        raw: json!({
            "changedFiles": changed_files,
            "diff": diff,
            "diffArtifactRef": diff_artifact_ref,
            "activityKind": "edit",
            "rendererHint": "edit",
        }),
        recommended_next_action: Some(
            "Review changed files and run the relevant validation command.".to_string(),
        ),
    })
}

fn touch_patch_path(
    touched: &mut HashSet<PathBuf>,
    absolute: &Path,
    relative: &str,
) -> Result<(), NativeToolFailure> {
    if !touched.insert(absolute.to_path_buf()) {
        return Err(NativeToolFailure::new(
            "conflicting_patch",
            format!("patch touches the same path more than once: {relative}"),
            "Combine edits for the same path into one update operation.",
        ));
    }
    Ok(())
}

fn resolve_existing_patch_path(
    session_id: &str,
    path: &str,
) -> Result<WorkspacePath, NativeToolFailure> {
    reject_workspace_escape(resolve_workspace_path(session_id, path, false)?)
}

fn resolve_new_patch_path(
    session_id: &str,
    path: &str,
) -> Result<WorkspacePath, NativeToolFailure> {
    reject_workspace_escape(resolve_missing_ok_workspace_path(session_id, path)?)
}

fn reject_workspace_escape(path: WorkspacePath) -> Result<WorkspacePath, NativeToolFailure> {
    if path.outside_workspace {
        return Err(NativeToolFailure::new(
            "permission_denied",
            format!("patch path is outside the workspace: {}", path.relative),
            "Retry with a workspace-relative path inside the bound project.",
        ));
    }
    Ok(path)
}

pub(crate) fn resolve_missing_ok_workspace_path(
    session_id: &str,
    raw_path: &str,
) -> Result<WorkspacePath, NativeToolFailure> {
    resolve_workspace_path(session_id, raw_path, true)
}

fn parse_codex_patch(patch: &str) -> Result<Vec<CodexPatchOperation>, NativeToolFailure> {
    let normalized = patch.replace("\r\n", "\n").replace('\r', "\n");
    let lines = normalized.lines().collect::<Vec<_>>();
    let begin = lines
        .iter()
        .position(|line| line.trim() == "*** Begin Patch")
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_patch",
                "patch is missing *** Begin Patch",
                "Retry with a complete Codex patch.",
            )
        })?;
    let end = lines
        .iter()
        .rposition(|line| line.trim() == "*** End Patch")
        .ok_or_else(|| {
            NativeToolFailure::new(
                "bad_patch",
                "patch is missing *** End Patch",
                "Retry with a complete Codex patch.",
            )
        })?;
    if end <= begin {
        return Err(NativeToolFailure::new(
            "bad_patch",
            "patch end appears before patch begin",
            "Retry with a complete Codex patch.",
        ));
    }
    let mut i = begin + 1;
    let mut operations = Vec::new();
    while i < end {
        let line = lines[i];
        if line.trim().is_empty() {
            i += 1;
            continue;
        }
        if let Some(path) = line.strip_prefix("*** Add File: ") {
            i += 1;
            let mut content_lines = Vec::new();
            while i < end && !is_codex_file_header(lines[i]) {
                // Accept both the Lyra-extended form (each line prefixed with '+')
                // and the standard Codex form (bare add-file lines). Models emit
                // the bare form by default; rejecting it forced a wasted retry on
                // every new file. A line that is exactly "+" is an empty added line.
                let content = lines[i].strip_prefix('+').unwrap_or(lines[i]);
                content_lines.push(content.to_string());
                i += 1;
            }
            operations.push(CodexPatchOperation::Add {
                path: clean_codex_patch_path(path)?,
                content: codex_lines_to_text(&content_lines),
            });
            continue;
        }
        if let Some(path) = line.strip_prefix("*** Delete File: ") {
            operations.push(CodexPatchOperation::Delete {
                path: clean_codex_patch_path(path)?,
            });
            i += 1;
            continue;
        }
        if let Some(path) = line.strip_prefix("*** Update File: ") {
            i += 1;
            let mut new_path = None;
            if i < end
                && let Some(target) = lines[i].strip_prefix("*** Move to: ")
            {
                new_path = Some(clean_codex_patch_path(target)?);
                i += 1;
            }
            let mut hunks = Vec::<Vec<CodexPatchLine>>::new();
            let mut current_hunk = Vec::<CodexPatchLine>::new();
            while i < end && !is_codex_file_header(lines[i]) {
                let hunk_line = lines[i];
                if hunk_line == "@@" || hunk_line.starts_with("@@ ") {
                    if !current_hunk.is_empty() {
                        hunks.push(std::mem::take(&mut current_hunk));
                    }
                    i += 1;
                    continue;
                }
                let mut chars = hunk_line.chars();
                let Some(prefix) = chars.next() else {
                    return Err(NativeToolFailure::new(
                        "bad_patch",
                        "empty update line is invalid; use a leading space for blank context lines",
                        "Retry with update lines prefixed by space, '+', or '-'.",
                    ));
                };
                let text = chars.as_str().to_string();
                match prefix {
                    ' ' => current_hunk.push(CodexPatchLine::Context(text)),
                    '-' => current_hunk.push(CodexPatchLine::Remove(text)),
                    '+' => current_hunk.push(CodexPatchLine::Add(text)),
                    _ => {
                        return Err(NativeToolFailure::new(
                            "bad_patch",
                            format!("update line must start with space, '+', or '-': {hunk_line}"),
                            "Retry with Codex update hunk syntax.",
                        ));
                    }
                }
                i += 1;
            }
            if !current_hunk.is_empty() {
                hunks.push(current_hunk);
            }
            operations.push(CodexPatchOperation::Update {
                path: clean_codex_patch_path(path)?,
                new_path,
                hunks,
            });
            continue;
        }
        return Err(NativeToolFailure::new(
            "bad_patch",
            format!("unrecognized patch header: {line}"),
            "Retry with Add File, Update File, Delete File, or Move to headers.",
        ));
    }
    Ok(operations)
}

fn is_codex_file_header(line: &str) -> bool {
    line.starts_with("*** Add File: ")
        || line.starts_with("*** Update File: ")
        || line.starts_with("*** Delete File: ")
        || line.trim() == "*** End Patch"
}

fn clean_codex_patch_path(path: &str) -> Result<String, NativeToolFailure> {
    let path = path.trim();
    if path.is_empty() || path.contains('\0') {
        return Err(NativeToolFailure::new(
            "bad_patch",
            "patch path is empty or invalid",
            "Retry with a valid workspace-relative path.",
        ));
    }
    let path_buf = PathBuf::from(path);
    if !path_buf.is_absolute()
        && Path::new(path).components().any(|component| {
            matches!(
                component,
                Component::Prefix(_) | Component::ParentDir | Component::RootDir
            )
        })
    {
        return Err(NativeToolFailure::new(
            "bad_patch",
            format!("patch path must not contain parent directory components: {path}"),
            "Retry with a normalized workspace-relative path.",
        ));
    }
    Ok(path.to_string())
}

fn apply_codex_update_hunks(
    old: &str,
    hunks: &[Vec<CodexPatchLine>],
) -> Result<String, NativeToolFailure> {
    let mut updated = old.to_string();
    for hunk in hunks {
        let mut old_lines = Vec::new();
        let mut new_lines = Vec::new();
        for line in hunk {
            match line {
                CodexPatchLine::Context(text) => {
                    old_lines.push(text.clone());
                    new_lines.push(text.clone());
                }
                CodexPatchLine::Remove(text) => old_lines.push(text.clone()),
                CodexPatchLine::Add(text) => new_lines.push(text.clone()),
            }
        }
        let old_block = codex_lines_to_text(&old_lines);
        let new_block = codex_lines_to_text(&new_lines);
        updated = replace_codex_hunk_once(&updated, &old_block, &new_block)?;
    }
    Ok(updated)
}

fn replace_codex_hunk_once(
    current: &str,
    old_block: &str,
    new_block: &str,
) -> Result<String, NativeToolFailure> {
    if old_block.is_empty() {
        if current.is_empty() {
            return Ok(new_block.to_string());
        }
        return Err(NativeToolFailure::new(
            "patch_context_missing",
            "update hunk has no removable or context lines",
            "Retry with enough context lines to anchor the insertion.",
        ));
    }
    for (old_candidate, new_candidate) in codex_block_variants(old_block, new_block) {
        let count = current.matches(&old_candidate).count();
        if count == 1 {
            return Ok(current.replacen(&old_candidate, &new_candidate, 1));
        }
        if count > 1 {
            return Err(NativeToolFailure::new(
                "patch_context_ambiguous",
                "update hunk context matches more than once",
                "Retry with more surrounding context in the patch.",
            ));
        }
    }
    Err(NativeToolFailure::new(
        "patch_context_missing",
        "update hunk context was not found in the target file",
        "Inspect the current file with exec_command and retry with an up-to-date patch.",
    ))
}

fn codex_lines_to_text(lines: &[String]) -> String {
    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

fn codex_block_variants(old_block: &str, new_block: &str) -> Vec<(String, String)> {
    let mut variants = vec![(old_block.to_string(), new_block.to_string())];
    if let Some(old_without_newline) = old_block.strip_suffix('\n') {
        let new_without_newline = new_block.strip_suffix('\n').unwrap_or(new_block);
        variants.push((
            old_without_newline.to_string(),
            new_without_newline.to_string(),
        ));
    }
    variants
}

fn apply_staged_patch_operation(operation: &StagedPatchOperation) -> Result<(), NativeToolFailure> {
    match operation {
        StagedPatchOperation::Write {
            absolute,
            relative,
            after,
            ..
        } => {
            if let Some(parent) = absolute.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    NativeToolFailure::new(
                        "write_failed",
                        format!("failed to create parent directory for {relative}: {error}"),
                        "Retry after creating a writable parent directory.",
                    )
                })?;
            }
            fs::write(absolute, after).map_err(|error| {
                NativeToolFailure::new(
                    "write_failed",
                    format!("failed to write patch target {relative}: {error}"),
                    "Patch was rolled back; retry with writable workspace paths.",
                )
            })
        }
        StagedPatchOperation::Delete {
            absolute, relative, ..
        } => fs::remove_file(absolute).map_err(|error| {
            NativeToolFailure::new(
                "delete_failed",
                format!("failed to delete file {relative}: {error}"),
                "Patch was rolled back; retry with a writable file path.",
            )
        }),
        StagedPatchOperation::Move {
            from_absolute,
            from_relative,
            to_absolute,
            ..
        } => {
            if let Some(parent) = to_absolute.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    NativeToolFailure::new(
                        "write_failed",
                        format!("failed to create move target parent: {error}"),
                        "Patch was rolled back; retry with a writable parent directory.",
                    )
                })?;
            }
            fs::rename(from_absolute, to_absolute).map_err(|error| {
                NativeToolFailure::new(
                    "move_failed",
                    format!("failed to move file {from_relative}: {error}"),
                    "Patch was rolled back; retry with writable source and target paths.",
                )
            })
        }
    }
}

fn rollback_staged_patch_operations(applied: &[StagedPatchOperation]) {
    for operation in applied.iter().rev() {
        match operation {
            StagedPatchOperation::Write {
                absolute, before, ..
            } => {
                if let Some(before) = before {
                    let _ = fs::write(absolute, before);
                } else {
                    let _ = fs::remove_file(absolute);
                }
            }
            StagedPatchOperation::Delete {
                absolute, before, ..
            } => {
                if let Some(parent) = absolute.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(absolute, before);
            }
            StagedPatchOperation::Move {
                from_absolute,
                to_absolute,
                ..
            } => {
                let _ = fs::rename(to_absolute, from_absolute);
            }
        }
    }
}

#[cfg(test)]
mod fuzzy_and_patch_tests {
    use super::*;

    #[test]
    fn fuzzy_falls_back_to_exact_when_present() {
        let original = "let a = 1;\nlet b = 2;\n";
        let updated = apply_fuzzy_replacement(original, "let b = 2;", "let b = 3;", false)
            .expect("exact hit");
        assert_eq!(updated, "let a = 1;\nlet b = 3;\n");
    }

    #[test]
    fn fuzzy_tolerates_indentation_mismatch_verbatim_insert() {
        // File indents the block with 4 spaces; model's oldString has 6 (exact
        // match fails because 6-space prefix isn't a substring of 4-space line).
        // Model's newString has the correct 4-space indent — inserted verbatim.
        let original = "fn main() {\n    let x = 1;\n}\n";
        let updated =
            apply_fuzzy_replacement(original, "      let x = 1;", "    let x = 42;", false)
                .expect("whitespace-insensitive hit");
        // newString is inserted verbatim — no reindent, no corruption.
        assert_eq!(updated, "fn main() {\n    let x = 42;\n}\n");
    }

    #[test]
    fn fuzzy_multiline_block_verbatim_insert() {
        let original = "class C:\n    def f(self):\n        return 1\n";
        // Model's oldString has more indent than the file (6/10 vs 4/8) — exact
        // match fails; fuzzy locates by trimmed content; newString (correct 4/8
        // indent) is inserted verbatim.
        let old = "      def f(self):\n          return 1";
        let new = "    def f(self):\n        return 2";
        let updated = apply_fuzzy_replacement(original, old, new, false).expect("block hit");
        assert_eq!(updated, "class C:\n    def f(self):\n        return 2\n");
    }

    #[test]
    fn fuzzy_rejects_multiple_whitespace_matches_without_replace_all() {
        let original = "    log()\n    log()\n";
        let failure = apply_fuzzy_replacement(original, "log()", "trace()", false)
            .expect_err("ambiguous fuzzy match must fail, never pick the first");
        assert_eq!(failure.code, "edit_not_unique");
    }

    #[test]
    fn fuzzy_reports_not_found_when_absent() {
        let failure =
            apply_fuzzy_replacement("alpha\n", "beta", "gamma", false).expect_err("missing target");
        assert_eq!(failure.code, "edit_not_found");
    }

    #[test]
    fn codex_add_file_accepts_bare_and_plus_prefixed_lines() {
        // Standard Codex form (bare add-file lines) — used to fail before B3.
        let bare = "*** Begin Patch\n*** Add File: a.txt\nhello\nworld\n*** End Patch";
        let ops = parse_codex_patch(bare).expect("bare add-file lines accepted");
        match &ops[0] {
            CodexPatchOperation::Add { path, content } => {
                assert_eq!(path, "a.txt");
                assert_eq!(content, "hello\nworld\n");
            }
            other => panic!("expected Add, got {other:?}"),
        }

        // Lyra-extended form ('+'-prefixed) must keep working too.
        let plus = "*** Begin Patch\n*** Add File: b.txt\n+hello\n+world\n*** End Patch";
        let ops = parse_codex_patch(plus).expect("plus-prefixed add-file lines accepted");
        match &ops[0] {
            CodexPatchOperation::Add { path, content } => {
                assert_eq!(path, "b.txt");
                assert_eq!(content, "hello\nworld\n");
            }
            other => panic!("expected Add, got {other:?}"),
        }
    }
}
