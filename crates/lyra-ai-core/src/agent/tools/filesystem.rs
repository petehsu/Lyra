use super::*;
use lyra_code_intel_core::{CodeIntelService, CodeSearchTextParams};
use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};

static CODE_INTEL_SERVICES: OnceLock<RwLock<HashMap<String, Arc<CodeIntelService>>>> =
    OnceLock::new();

pub(super) fn run_filesystem_list(
    input: &Value,
    scope_root: Option<&Path>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let root_path = optional_string(object, "path")
        .map(|value| resolve_path(&value, scope_root))
        .transpose()?
        .unwrap_or(current_dir_path(scope_root)?);
    let limit = clamp_limit(optional_usize(object, "limit"), 200);

    let metadata = fs::metadata(&root_path).map_err(|error| {
        AgentToolError::exec_failed(format!(
            "failed to stat path {}: {error}",
            root_path.display()
        ))
    })?;

    if metadata.is_file() {
        let name = root_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| root_path.to_string_lossy().to_string());
        return Ok(json!({
            "path": root_path.to_string_lossy(),
            "entries": [{
                "name": name,
                "path": root_path.to_string_lossy(),
                "kind": "file",
                "sizeBytes": metadata.len()
            }],
            "truncated": false
        }));
    }

    let read_dir = fs::read_dir(&root_path).map_err(|error| {
        AgentToolError::exec_failed(format!(
            "failed to read directory {}: {error}",
            root_path.display()
        ))
    })?;

    let mut entries = read_dir.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by(|left, right| left.file_name().cmp(&right.file_name()));

    let truncated = entries.len() > limit;
    let mapped = entries
        .into_iter()
        .take(limit)
        .map(|entry| {
            let entry_path = entry.path();
            let entry_type = entry.file_type().ok();
            let kind = if entry_type.as_ref().is_some_and(|value| value.is_dir()) {
                "directory"
            } else if entry_type.as_ref().is_some_and(|value| value.is_file()) {
                "file"
            } else {
                "other"
            };
            let size_bytes = fs::metadata(&entry_path)
                .ok()
                .map(|metadata| metadata.len());
            json!({
                "name": entry.file_name().to_string_lossy(),
                "path": entry_path.to_string_lossy(),
                "kind": kind,
                "sizeBytes": size_bytes,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({
        "path": root_path.to_string_lossy(),
        "entries": mapped,
        "truncated": truncated,
    }))
}

pub(super) fn run_filesystem_glob(
    input: &Value,
    scope_root: Option<&Path>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let pattern = required_string(object, "pattern")?;
    let root_path = optional_string(object, "root")
        .map(|value| resolve_path(&value, scope_root))
        .transpose()?
        .unwrap_or(current_dir_path(scope_root)?);
    let limit = clamp_limit(optional_usize(object, "limit"), DEFAULT_GLOB_LIMIT);
    let glob_set = build_glob(&pattern)?;

    let candidates = collect_candidates(&root_path, limit.saturating_mul(8))?;
    let mut matched = Vec::new();
    for candidate in &candidates {
        if matched.len() >= limit {
            break;
        }
        if matches_glob(&candidate.relative_path, &pattern, &glob_set) {
            matched.push(json!({
                "path": candidate.absolute_path.to_string_lossy(),
                "relativePath": candidate.relative_path,
                "kind": candidate.kind,
            }));
        }
    }

    Ok(json!({
        "rootPath": root_path.to_string_lossy(),
        "pattern": pattern,
        "truncated": matched.len() >= limit,
        "matches": matched,
    }))
}

pub(super) fn run_filesystem_search(
    input: &Value,
    scope_root: Option<&Path>,
    storage_root: Option<&str>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let pattern = required_string(object, "pattern")?;
    let root_path = optional_string(object, "path")
        .map(|value| resolve_path(&value, scope_root))
        .transpose()?
        .unwrap_or(current_dir_path(scope_root)?);
    let limit = clamp_limit(optional_usize(object, "limit"), DEFAULT_SEARCH_LIMIT);
    let case_sensitive = optional_bool(object, "caseSensitive").unwrap_or(false);
    let glob_pattern = optional_string(object, "glob");

    if let Ok(service) = resolve_code_intel_service(storage_root) {
        if let Ok(response) = service.search_text(CodeSearchTextParams {
            query: pattern.clone(),
            roots: vec![root_path.clone()],
            include_hidden: false,
            glob: glob_pattern.clone(),
            limit,
            case_sensitive,
        }) {
            let matches = response
                .matches
                .into_iter()
                .map(|item| {
                    json!({
                        "path": item.path,
                        "relativePath": item.relative_path,
                        "line": item.line,
                        "excerpt": item.excerpt,
                    })
                })
                .collect::<Vec<_>>();
            return Ok(json!({
                "rootPath": root_path.to_string_lossy(),
                "pattern": pattern,
                "caseSensitive": case_sensitive,
                "truncated": response.truncated,
                "matches": matches,
            }));
        }
    }

    run_filesystem_search_legacy(pattern, root_path, limit, case_sensitive, glob_pattern)
}

fn resolve_code_intel_service(
    storage_root: Option<&str>,
) -> Result<Arc<CodeIntelService>, AgentToolError> {
    let base_storage = storage_root
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::temp_dir().join("lyra-agent"));
    let service_root = base_storage.join("code-intel");
    std::fs::create_dir_all(&service_root).map_err(|error| {
        AgentToolError::exec_failed(format!(
            "failed to initialize code index storage {}: {error}",
            service_root.display()
        ))
    })?;
    let key = service_root.to_string_lossy().to_string();
    let services = CODE_INTEL_SERVICES.get_or_init(|| RwLock::new(HashMap::new()));
    if let Ok(guard) = services.read() {
        if let Some(service) = guard.get(&key) {
            return Ok(service.clone());
        }
    }
    let service = Arc::new(CodeIntelService::new(&service_root));
    let mut guard = services
        .write()
        .map_err(|_| AgentToolError::exec_failed("code intel service lock poisoned"))?;
    let entry = guard.entry(key).or_insert_with(|| service.clone());
    Ok(entry.clone())
}

fn run_filesystem_search_legacy(
    pattern: String,
    root_path: PathBuf,
    limit: usize,
    case_sensitive: bool,
    glob_pattern: Option<String>,
) -> Result<Value, AgentToolError> {
    let glob = glob_pattern
        .as_ref()
        .map(|pattern| build_glob(pattern))
        .transpose()?;

    let metadata = fs::metadata(&root_path).map_err(|error| {
        AgentToolError::exec_failed(format!(
            "failed to stat path {}: {error}",
            root_path.display()
        ))
    })?;

    let candidates = if metadata.is_file() {
        vec![CandidatePath {
            absolute_path: root_path.clone(),
            relative_path: root_path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| root_path.to_string_lossy().to_string()),
            kind: "file",
        }]
    } else {
        collect_candidates(&root_path, MAX_RESULT_LIMIT.saturating_mul(8))?
            .into_iter()
            .filter(|candidate| candidate.kind == "file")
            .collect()
    };

    let needle = if case_sensitive {
        pattern.clone()
    } else {
        pattern.to_lowercase()
    };

    let mut matches = Vec::new();
    let mut truncated = false;

    for candidate in candidates {
        if matches.len() >= limit {
            truncated = true;
            break;
        }

        if let (Some(glob_set), Some(glob_pattern_value)) = (&glob, &glob_pattern) {
            if !matches_glob(&candidate.relative_path, glob_pattern_value, glob_set) {
                continue;
            }
        }

        let content = match read_text_file(&candidate.absolute_path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let lines = split_lines(&content);

        for (index, line) in lines.iter().enumerate() {
            if matches.len() >= limit {
                truncated = true;
                break;
            }
            let haystack = if case_sensitive {
                line.to_string()
            } else {
                line.to_lowercase()
            };
            if !haystack.contains(&needle) {
                continue;
            }
            matches.push(json!({
                "path": candidate.absolute_path.to_string_lossy(),
                "relativePath": candidate.relative_path,
                "line": index + 1,
                "excerpt": clip_excerpt(line),
            }));
        }
    }

    Ok(json!({
        "rootPath": root_path.to_string_lossy(),
        "pattern": pattern,
        "caseSensitive": case_sensitive,
        "truncated": truncated,
        "matches": matches,
    }))
}

pub(super) fn run_filesystem_read_range(
    input: &Value,
    scope_root: Option<&Path>,
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let path = resolve_path(&required_string(object, "path")?, scope_root)?;
    let start_line = required_positive_line(object, "startLine")?;
    let end_line = required_positive_line(object, "endLine")?.max(start_line);

    let content = match read_text_file(&path) {
        Ok(value) => value,
        Err(error) => {
            return Ok(json!({
                "kind": "unsupported",
                "path": path.to_string_lossy(),
                "reason": error.message,
                "requestedStartLine": start_line,
                "requestedEndLine": end_line,
                "actualStartLine": 0,
                "actualEndLine": 0,
                "totalLines": 0,
            }))
        }
    };

    let lines = split_lines(&content);
    if lines.is_empty() {
        return Ok(json!({
            "kind": "text",
            "path": path.to_string_lossy(),
            "requestedStartLine": start_line,
            "requestedEndLine": end_line,
            "actualStartLine": 0,
            "actualEndLine": 0,
            "totalLines": 0,
            "content": "",
        }));
    }

    let actual_start = start_line.min(lines.len());
    let actual_end = end_line.min(lines.len());
    let content_slice = if actual_start == 0 || actual_end == 0 || actual_start > actual_end {
        String::new()
    } else {
        lines[(actual_start - 1)..actual_end].join("\n")
    };

    Ok(json!({
        "kind": "text",
        "path": path.to_string_lossy(),
        "requestedStartLine": start_line,
        "requestedEndLine": end_line,
        "actualStartLine": actual_start,
        "actualEndLine": actual_end,
        "totalLines": lines.len(),
        "content": content_slice,
    }))
}

fn line_count(content: &str) -> usize {
    if content.is_empty() {
        return 0;
    }
    content.replace("\r\n", "\n").split('\n').count()
}

fn first_changed_line(previous: &str, next: &str) -> usize {
    if previous == next {
        return 1;
    }
    let previous_lines = split_lines(previous);
    let next_lines = split_lines(next);
    let max_len = previous_lines.len().max(next_lines.len());
    for index in 0..max_len {
        if previous_lines.get(index) != next_lines.get(index) {
            return index + 1;
        }
    }
    1
}

#[derive(Clone, Debug)]
struct EditCandidate {
    old_text: String,
    new_text: String,
    mode: &'static str,
}

#[derive(Clone, Debug)]
enum EditResolution {
    Applied {
        next_content: String,
        replacements: usize,
        mode: &'static str,
    },
    AlreadyApplied {
        mode: &'static str,
    },
    NoMatch,
}

fn push_edit_candidate(
    candidates: &mut Vec<EditCandidate>,
    old_text: String,
    new_text: String,
    mode: &'static str,
) {
    if old_text.is_empty() {
        return;
    }
    if candidates
        .iter()
        .any(|entry| entry.old_text == old_text && entry.new_text == new_text)
    {
        return;
    }
    candidates.push(EditCandidate {
        old_text,
        new_text,
        mode,
    });
}

fn build_edit_candidates(old_text: &str, new_text: &str) -> Vec<EditCandidate> {
    let mut candidates = Vec::new();
    push_edit_candidate(
        &mut candidates,
        old_text.to_string(),
        new_text.to_string(),
        "exact",
    );

    let old_lf = old_text.replace("\r\n", "\n");
    let new_lf = new_text.replace("\r\n", "\n");
    if old_lf != old_text || new_lf != new_text {
        push_edit_candidate(
            &mut candidates,
            old_lf.clone(),
            new_lf.clone(),
            "normalize_lf",
        );
    }

    if old_lf.contains('\n') {
        let old_crlf = old_lf.replace('\n', "\r\n");
        let new_crlf = new_lf.replace('\n', "\r\n");
        if old_crlf != old_text || new_crlf != new_text {
            push_edit_candidate(&mut candidates, old_crlf, new_crlf, "normalize_crlf");
        }
    }

    candidates
}

fn resolve_text_edit(
    current: &str,
    old_text: &str,
    new_text: &str,
    replace_all: bool,
) -> EditResolution {
    let candidates = build_edit_candidates(old_text, new_text);

    for candidate in &candidates {
        let matches = current.matches(candidate.old_text.as_str()).count();
        if matches == 0 {
            continue;
        }
        let replacements = if replace_all { matches } else { 1 };
        let next_content = if replace_all {
            current.replace(candidate.old_text.as_str(), candidate.new_text.as_str())
        } else {
            current.replacen(candidate.old_text.as_str(), candidate.new_text.as_str(), 1)
        };
        return EditResolution::Applied {
            next_content,
            replacements,
            mode: candidate.mode,
        };
    }

    for candidate in &candidates {
        if !candidate.new_text.is_empty() && current.contains(candidate.new_text.as_str()) {
            return EditResolution::AlreadyApplied {
                mode: candidate.mode,
            };
        }
    }

    EditResolution::NoMatch
}

fn write_text_file_with_progress(
    path: &Path,
    content: &str,
    first_changed_line: Option<usize>,
    on_progress: &mut dyn FnMut(Value),
) -> Result<(), AgentToolError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            AgentToolError::exec_failed(format!(
                "failed to create parent directory {}: {error}",
                parent.display()
            ))
        })?;
    }

    let bytes = content.as_bytes();
    let total = bytes.len();
    let display_path = path.to_string_lossy().to_string();
    on_progress(json!({
        "stage": "preparing",
        "path": display_path,
        "bytesTotal": total,
        "bytesWritten": 0,
        "firstChangedLine": first_changed_line,
    }));

    let mut file = std::fs::File::create(path).map_err(|error| {
        AgentToolError::exec_failed(format!("failed to write file {}: {error}", path.display()))
    })?;
    if total == 0 {
        file.flush().map_err(|error| {
            AgentToolError::exec_failed(format!("failed to flush file {}: {error}", path.display()))
        })?;
        on_progress(json!({
            "stage": "writing",
            "path": display_path,
            "bytesTotal": 0,
            "bytesWritten": 0,
            "progress": 1.0,
            "chunkText": "",
            "firstChangedLine": first_changed_line,
        }));
        return Ok(());
    }

    let target_events = 10usize;
    let char_boundaries = content
        .char_indices()
        .map(|(offset, _)| offset)
        .chain(std::iter::once(content.len()))
        .collect::<Vec<_>>();
    let total_chars = char_boundaries.len().saturating_sub(1);
    let chunk_chars = (total_chars / target_events).max(1);
    let mut current_char_index = 0usize;
    let mut written = 0usize;
    while current_char_index < total_chars {
        let next_char_index = (current_char_index + chunk_chars).min(total_chars);
        let end = char_boundaries[next_char_index];
        file.write_all(&bytes[written..end]).map_err(|error| {
            AgentToolError::exec_failed(format!("failed to write file {}: {error}", path.display()))
        })?;
        file.flush().map_err(|error| {
            AgentToolError::exec_failed(format!("failed to flush file {}: {error}", path.display()))
        })?;
        let chunk_text = &content[written..end];
        written = end;
        current_char_index = next_char_index;
        on_progress(json!({
            "stage": "writing",
            "path": display_path,
            "bytesTotal": total,
            "bytesWritten": written,
            "progress": (written as f64 / total as f64),
            "chunkText": chunk_text,
            "firstChangedLine": first_changed_line,
        }));
    }
    Ok(())
}

pub(super) fn run_filesystem_write(
    input: &Value,
    scope_root: Option<&Path>,
    on_progress: &mut dyn FnMut(Value),
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let path = resolve_path(&required_string(object, "path")?, scope_root)?;
    let content = required_raw_string(object, "content")?;
    let previous_content = fs::read_to_string(&path).ok();
    let created = previous_content.is_none();
    let previous_line_count = previous_content.as_deref().map(line_count).unwrap_or(0);
    if previous_content.as_deref() == Some(content.as_str()) {
        on_progress(json!({
            "stage": "baseline",
            "path": path.to_string_lossy(),
            "created": false,
            "baselineContent": previous_content,
        }));
        on_progress(json!({
            "stage": "writing",
            "path": path.to_string_lossy(),
            "status": "unchanged",
        }));
        return Ok(json!({
            "kind": "unchanged",
            "path": path.to_string_lossy(),
            "created": false,
            "bytes": content.len(),
            "addedLines": 0,
            "removedLines": 0,
            "firstChangedLine": 1,
        }));
    }
    let first_changed_line = previous_content
        .as_deref()
        .map(|previous| first_changed_line(previous, &content))
        .unwrap_or(1);
    on_progress(json!({
        "stage": "baseline",
        "path": path.to_string_lossy(),
        "created": created,
        "baselineContent": previous_content,
    }));
    write_text_file_with_progress(&path, &content, Some(first_changed_line), on_progress)?;
    let new_line_count = line_count(&content);
    Ok(json!({
        "kind": if created { "created" } else { "updated" },
        "path": path.to_string_lossy(),
        "created": created,
        "bytes": content.len(),
        "addedLines": new_line_count.saturating_sub(previous_line_count),
        "removedLines": previous_line_count.saturating_sub(new_line_count),
        "firstChangedLine": first_changed_line,
    }))
}

pub(super) fn run_filesystem_edit(
    input: &Value,
    scope_root: Option<&Path>,
    on_progress: &mut dyn FnMut(Value),
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let path = resolve_path(&required_string(object, "path")?, scope_root)?;
    let old_text = required_nonempty_raw_string(object, "oldText")?;
    let new_text = required_raw_string(object, "newText")?;
    let replace_all = optional_bool(object, "replaceAll").unwrap_or(false);

    let current = read_text_file(&path)?;
    on_progress(json!({
        "stage": "baseline",
        "path": path.to_string_lossy(),
        "created": false,
        "baselineContent": current.clone(),
    }));
    match resolve_text_edit(&current, &old_text, &new_text, replace_all) {
        EditResolution::Applied {
            next_content,
            replacements,
            mode,
        } => {
            if next_content == current {
                on_progress(json!({
                    "stage": "editing",
                    "path": path.to_string_lossy(),
                    "status": "unchanged",
                    "matchMode": mode,
                }));
                return Ok(json!({
                    "kind": "unchanged",
                    "path": path.to_string_lossy(),
                    "replacements": 0,
                    "alreadyApplied": true,
                    "matchMode": mode,
                }));
            }

            let first_changed_line = first_changed_line(&current, &next_content);

            on_progress(json!({
                "stage": "editing",
                "path": path.to_string_lossy(),
                "status": "applied",
                "matchMode": mode,
                "replacements": replacements,
                "firstChangedLine": first_changed_line,
            }));

            let previous_line_count = line_count(&current);
            let next_line_count = line_count(&next_content);
            write_text_file_with_progress(
                &path,
                &next_content,
                Some(first_changed_line),
                on_progress,
            )?;

            Ok(json!({
                "kind": "updated",
                "path": path.to_string_lossy(),
                "replacements": replacements,
                "matchMode": mode,
                "addedLines": next_line_count.saturating_sub(previous_line_count),
                "removedLines": previous_line_count.saturating_sub(next_line_count),
                "firstChangedLine": first_changed_line,
            }))
        }
        EditResolution::AlreadyApplied { mode } => {
            on_progress(json!({
                "stage": "editing",
                "path": path.to_string_lossy(),
                "status": "already_applied",
                "matchMode": mode,
            }));
            Ok(json!({
                "kind": "unchanged",
                "path": path.to_string_lossy(),
                "replacements": 0,
                "alreadyApplied": true,
                "matchMode": mode,
            }))
        }
        EditResolution::NoMatch => {
            on_progress(json!({
                "stage": "editing",
                "path": path.to_string_lossy(),
                "status": "no_match",
            }));
            Ok(json!({
                "kind": "no_match",
                "path": path.to_string_lossy(),
                "replacements": 0,
                "alreadyApplied": false,
                "message": format!(
                    "oldText was not found in file {}. Consider reading the latest file content and retrying with a narrower edit.",
                    path.display()
                ),
            }))
        }
    }
}

pub(super) fn run_filesystem_multi_edit(
    input: &Value,
    scope_root: Option<&Path>,
    on_progress: &mut dyn FnMut(Value),
) -> Result<Value, AgentToolError> {
    let object = as_object(input)?;
    let path = resolve_path(&required_string(object, "path")?, scope_root)?;
    let edits = object
        .get("edits")
        .and_then(Value::as_array)
        .ok_or_else(|| AgentToolError::exec_failed("edits is required"))?;
    if edits.is_empty() {
        return Err(AgentToolError::exec_failed(
            "edits must contain at least one edit",
        ));
    }

    let mut next_content = read_text_file(&path)?;
    let baseline_content = next_content.clone();
    let previous_line_count = line_count(&next_content);
    let mut total_replacements = 0usize;
    let mut applied_edits = 0usize;
    let mut already_applied_edit_indexes = Vec::<usize>::new();
    let mut not_found_edit_indexes = Vec::<usize>::new();
    on_progress(json!({
        "stage": "baseline",
        "path": path.to_string_lossy(),
        "created": false,
        "baselineContent": baseline_content,
    }));

    for (index, edit_value) in edits.iter().enumerate() {
        let edit = edit_value.as_object().ok_or_else(|| {
            AgentToolError::exec_failed(format!("edits[{index}] must be an object"))
        })?;
        let old_text = required_nonempty_raw_string(edit, "oldText")?;
        let new_text = required_raw_string(edit, "newText")?;
        let replace_all = optional_bool(edit, "replaceAll").unwrap_or(false);
        match resolve_text_edit(&next_content, &old_text, &new_text, replace_all) {
            EditResolution::Applied {
                next_content: resolved_next,
                replacements,
                mode,
            } => {
                if resolved_next == next_content {
                    already_applied_edit_indexes.push(index + 1);
                    on_progress(json!({
                        "stage": "editing",
                        "path": path.to_string_lossy(),
                        "editIndex": index + 1,
                        "editCount": edits.len(),
                        "status": "already_applied",
                        "matchMode": mode,
                        "replacements": total_replacements,
                    }));
                    continue;
                }

                total_replacements = total_replacements.saturating_add(replacements);
                applied_edits = applied_edits.saturating_add(1);
                next_content = resolved_next;
                on_progress(json!({
                    "stage": "editing",
                    "path": path.to_string_lossy(),
                    "editIndex": index + 1,
                    "editCount": edits.len(),
                    "status": "applied",
                    "matchMode": mode,
                    "replacements": total_replacements,
                }));
            }
            EditResolution::AlreadyApplied { mode } => {
                already_applied_edit_indexes.push(index + 1);
                on_progress(json!({
                    "stage": "editing",
                    "path": path.to_string_lossy(),
                    "editIndex": index + 1,
                    "editCount": edits.len(),
                    "status": "already_applied",
                    "matchMode": mode,
                    "replacements": total_replacements,
                }));
            }
            EditResolution::NoMatch => {
                not_found_edit_indexes.push(index + 1);
                on_progress(json!({
                    "stage": "editing",
                    "path": path.to_string_lossy(),
                    "editIndex": index + 1,
                    "editCount": edits.len(),
                    "status": "no_match",
                    "replacements": total_replacements,
                }));
            }
        }
    }

    let has_changes = baseline_content != next_content;
    let kind = if has_changes && not_found_edit_indexes.is_empty() {
        "updated"
    } else if has_changes {
        "partial"
    } else if !not_found_edit_indexes.is_empty() {
        "no_match"
    } else {
        "unchanged"
    };

    let first_changed_line = if has_changes {
        Some(first_changed_line(&baseline_content, &next_content))
    } else {
        None
    };

    if has_changes {
        write_text_file_with_progress(&path, &next_content, first_changed_line, on_progress)?;
    }

    let next_line_count = line_count(&next_content);

    Ok(json!({
        "kind": kind,
        "path": path.to_string_lossy(),
        "editCount": edits.len(),
        "appliedEditCount": applied_edits,
        "replacements": total_replacements,
        "alreadyAppliedEditIndexes": already_applied_edit_indexes,
        "notFoundEditIndexes": not_found_edit_indexes,
        "addedLines": next_line_count.saturating_sub(previous_line_count),
        "removedLines": previous_line_count.saturating_sub(next_line_count),
        "firstChangedLine": first_changed_line,
        "message": if kind == "no_match" {
            Some("No edit blocks matched exactly. Consider reading latest file content before retrying.")
        } else if kind == "partial" {
            Some("Some edits were applied, while others did not match the latest file content.")
        } else {
            None
        },
    }))
}
