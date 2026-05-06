use crate::tool_runtime::catalog::{
    ListFilesArgs, ReadFileArgs, ReadRangeArgs, SearchCodeArgs, SearchFilesArgs, SearchTextArgs,
    StatPathArgs, WalkDirectoryArgs,
};
use crate::tool_runtime::operation::{
    tool_error, ToolOperationEnvelope, ToolResultEnvelope, TOOL_INVALID_ARGUMENT,
    TOOL_PATH_NOT_DIRECTORY, TOOL_PATH_NOT_FILE, TOOL_UNSUPPORTED_ENCODING,
};
use crate::tool_runtime::security::{redact_secrets, WorkspaceSecurity};
use crate::tool_runtime::ToolExecutionContext;
use anyhow::{anyhow, Context, Result};
use serde_json::json;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;

const DEFAULT_LIST_MAX_ENTRIES: usize = 200;
const DEFAULT_READ_MAX_BYTES: usize = 64 * 1024;
const DEFAULT_SEARCH_MAX_RESULTS: usize = 80;
const DEFAULT_WALK_MAX_DEPTH: usize = 4;
const MAX_READ_BYTES: usize = 256 * 1024;
const MAX_SEARCH_RESULTS: usize = 200;
const MAX_CONTEXT_LINES: usize = 5;

pub fn list_files(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: ListFilesArgs,
) -> Result<ToolResultEnvelope> {
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let path = security.resolve_existing_path(args.path.as_deref())?;
    if path.is_dir() == false {
        return Err(tool_error(
            TOOL_PATH_NOT_DIRECTORY,
            "path is not a directory",
        ));
    }
    let max_entries = args
        .max_entries
        .unwrap_or(DEFAULT_LIST_MAX_ENTRIES)
        .clamp(1, DEFAULT_LIST_MAX_ENTRIES);
    let offset = args.offset.unwrap_or(0);
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path).context("failed to read directory")? {
        let entry = entry?;
        let metadata = fs::symlink_metadata(entry.path())?;
        entries.push(json!({
            "path": security.relative_display(&entry.path()),
            "kind": metadata_kind(&metadata),
            "sizeBytes": if metadata.is_file() { Some(metadata.len()) } else { None },
        }));
    }
    entries.sort_by(|left, right| {
        left["path"]
            .as_str()
            .unwrap_or_default()
            .cmp(right["path"].as_str().unwrap_or_default())
    });
    let total_entries = entries.len();
    let page = entries
        .into_iter()
        .skip(offset)
        .take(max_entries)
        .collect::<Vec<_>>();
    let next_offset = if offset + page.len() < total_entries {
        Some(offset + page.len())
    } else {
        None
    };
    let target = security.relative_display(&path);
    Ok(ToolResultEnvelope::completed(
        operation,
        format!("Listed {}", target),
        serde_json::to_string_pretty(&json!({
            "path": target,
            "offset": offset,
            "nextOffset": next_offset,
            "entries": page
        }))?,
        next_offset.is_some(),
    ))
}

pub fn stat_path(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: StatPathArgs,
) -> Result<ToolResultEnvelope> {
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let path = security.resolve_existing_path(Some(&args.path))?;
    let metadata = fs::metadata(&path).context("failed to stat path")?;
    let relative = security.relative_display(&path);
    Ok(ToolResultEnvelope::completed(
        operation,
        format!("Read metadata for {}", relative),
        serde_json::to_string_pretty(&json!({
            "path": relative,
            "kind": if metadata.is_dir() { "directory" } else if metadata.is_file() { "file" } else { "other" },
            "sizeBytes": metadata.len(),
            "readonly": metadata.permissions().readonly()
        }))?,
        false,
    ))
}

pub fn read_file(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: ReadFileArgs,
) -> Result<ToolResultEnvelope> {
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let path = security.resolve_existing_path(Some(&args.path))?;
    if path.is_file() == false {
        return Err(tool_error(TOOL_PATH_NOT_FILE, "path is not a file"));
    }
    let max_bytes = args
        .max_bytes
        .unwrap_or(DEFAULT_READ_MAX_BYTES)
        .clamp(1, MAX_READ_BYTES);
    let offset_bytes = args.offset_bytes.unwrap_or(0);
    let ReadChunk {
        content,
        truncated,
        next_offset_bytes,
    } = read_text_file_limited(&path, max_bytes, offset_bytes)?;
    let relative = security.relative_display(&path);
    Ok(ToolResultEnvelope::completed(
        operation,
        format!("Read {}", relative),
        serde_json::to_string_pretty(&json!({
            "path": relative,
            "offsetBytes": offset_bytes,
            "nextOffsetBytes": next_offset_bytes,
            "content": content
        }))?,
        truncated,
    ))
}

pub fn read_range(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: ReadRangeArgs,
) -> Result<ToolResultEnvelope> {
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let path = security.resolve_existing_path(Some(&args.path))?;
    if path.is_file() == false {
        return Err(tool_error(TOOL_PATH_NOT_FILE, "path is not a file"));
    }
    let max_bytes = args
        .max_bytes
        .unwrap_or(DEFAULT_READ_MAX_BYTES)
        .clamp(1, MAX_READ_BYTES);
    let ReadChunk {
        content,
        truncated: byte_truncated,
        ..
    } = read_text_file_limited(&path, max_bytes, 0)?;
    let start_line = args.start_line.unwrap_or(1).max(1);
    let end_line = args.end_line.unwrap_or(start_line + 120).max(start_line);
    let mut truncated = byte_truncated;
    let total_lines = content.lines().count();
    let selected = content
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let line_number = index + 1;
            if line_number >= start_line && line_number <= end_line {
                Some(json!({
                    "line": line_number,
                    "text": line
                }))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    let next_start_line = if total_lines > end_line {
        truncated = true;
        Some(end_line + 1)
    } else {
        None
    };
    let relative = security.relative_display(&path);
    Ok(ToolResultEnvelope::completed(
        operation,
        format!("Read lines {}-{} from {}", start_line, end_line, relative),
        serde_json::to_string_pretty(&json!({
            "path": relative,
            "startLine": start_line,
            "endLine": end_line,
            "nextStartLine": next_start_line,
            "lines": selected
        }))?,
        truncated,
    ))
}

pub fn search_files(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: SearchFilesArgs,
) -> Result<ToolResultEnvelope> {
    if args.query.trim().is_empty() {
        return Err(tool_error(TOOL_INVALID_ARGUMENT, "query is required"));
    }
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let path = security.resolve_existing_path(args.path.as_deref())?;
    let max_results = args
        .max_results
        .unwrap_or(DEFAULT_SEARCH_MAX_RESULTS)
        .clamp(1, MAX_SEARCH_RESULTS);
    let offset = args.offset.unwrap_or(0);
    let query = args.query.to_ascii_lowercase();
    let mut matches = Vec::new();
    for file in collect_files(&path)? {
        let relative = security.relative_display(&file);
        if relative.to_ascii_lowercase().contains(&query) {
            matches.push(json!({
                "path": relative,
                "kind": "file"
            }));
        }
    }
    let total_matches = matches.len();
    let page = matches
        .into_iter()
        .skip(offset)
        .take(max_results)
        .collect::<Vec<_>>();
    let next_offset = if offset + page.len() < total_matches {
        Some(offset + page.len())
    } else {
        None
    };
    Ok(ToolResultEnvelope::completed(
        operation,
        format!("Found {} file result(s) for {:?}", page.len(), args.query),
        serde_json::to_string_pretty(&json!({
            "query": redact_secrets(&args.query),
            "offset": offset,
            "nextOffset": next_offset,
            "matches": page
        }))?,
        next_offset.is_some(),
    ))
}

pub fn search_text(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: SearchTextArgs,
) -> Result<ToolResultEnvelope> {
    search_text_inner(
        context,
        operation,
        &args.query,
        args.path.as_deref(),
        args.max_results,
        args.offset,
        args.context_lines,
        None,
        "text",
    )
}

pub fn search_code(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: SearchCodeArgs,
) -> Result<ToolResultEnvelope> {
    search_text_inner(
        context,
        operation,
        &args.query,
        args.path.as_deref(),
        args.max_results,
        args.offset,
        args.context_lines,
        Some(is_source_like),
        "code",
    )
}

pub fn walk_directory(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: WalkDirectoryArgs,
) -> Result<ToolResultEnvelope> {
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let path = security.resolve_existing_path(args.path.as_deref())?;
    if path.is_dir() == false {
        return Err(tool_error(
            TOOL_PATH_NOT_DIRECTORY,
            "path is not a directory",
        ));
    }
    let max_entries = args
        .max_entries
        .unwrap_or(DEFAULT_LIST_MAX_ENTRIES)
        .clamp(1, DEFAULT_LIST_MAX_ENTRIES);
    let max_depth = args.max_depth.unwrap_or(DEFAULT_WALK_MAX_DEPTH).min(10);
    let offset = args.offset.unwrap_or(0);
    let mut entries = Vec::new();
    collect_tree(
        &security,
        &path,
        0,
        max_depth,
        offset + max_entries + 1,
        &mut entries,
    )?;
    let has_more = entries.len() > offset + max_entries;
    let page = entries
        .into_iter()
        .skip(offset)
        .take(max_entries)
        .collect::<Vec<_>>();
    let next_offset = if has_more {
        Some(offset + page.len())
    } else {
        None
    };
    let target = security.relative_display(&path);
    Ok(ToolResultEnvelope::completed(
        operation,
        format!("Walked {}", target),
        serde_json::to_string_pretty(&json!({
            "path": target,
            "offset": offset,
            "nextOffset": next_offset,
            "entries": page
        }))?,
        next_offset.is_some(),
    ))
}

fn search_text_inner(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    query: &str,
    path_arg: Option<&str>,
    max_results_arg: Option<usize>,
    offset_arg: Option<usize>,
    context_lines_arg: Option<usize>,
    file_filter: Option<fn(&Path) -> bool>,
    engine_kind: &str,
) -> Result<ToolResultEnvelope> {
    if query.trim().is_empty() {
        return Err(tool_error(TOOL_INVALID_ARGUMENT, "query is required"));
    }
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let path = security.resolve_existing_path(path_arg)?;
    let max_results = max_results_arg
        .unwrap_or(DEFAULT_SEARCH_MAX_RESULTS)
        .clamp(1, MAX_SEARCH_RESULTS);
    let offset = offset_arg.unwrap_or(0);
    let context_lines = context_lines_arg.unwrap_or(0).min(MAX_CONTEXT_LINES);
    let search_limit = offset + max_results;
    let SearchResult {
        mut lines,
        truncated,
        used_rg,
    } = match search_with_rg(
        &security,
        &path,
        query,
        search_limit,
        context_lines,
        file_filter,
    ) {
        Ok(Some(result)) => result,
        Ok(None) => search_fallback(
            &security,
            &path,
            query,
            search_limit,
            context_lines,
            file_filter,
        )?,
        Err(_) => search_fallback(
            &security,
            &path,
            query,
            search_limit,
            context_lines,
            file_filter,
        )?,
    };
    let total_collected = lines.len();
    let page = lines
        .drain(..)
        .skip(offset)
        .take(max_results)
        .collect::<Vec<_>>();
    let next_offset = if truncated || total_collected > offset + page.len() {
        Some(offset + page.len())
    } else {
        None
    };
    let target = security.relative_display(&path);
    Ok(ToolResultEnvelope::completed(
        operation,
        format!(
            "Found {} {} result{} for {:?} under {}",
            page.len(),
            engine_kind,
            if page.len() == 1 { "" } else { "s" },
            query,
            target
        ),
        serde_json::to_string_pretty(&json!({
            "query": redact_secrets(query),
            "path": target,
            "engine": if used_rg { "rg" } else { "fallback" },
            "offset": offset,
            "nextOffset": next_offset,
            "contextLines": context_lines,
            "matches": page
        }))?,
        next_offset.is_some(),
    ))
}

struct SearchResult {
    lines: Vec<serde_json::Value>,
    truncated: bool,
    used_rg: bool,
}

fn search_with_rg(
    security: &WorkspaceSecurity,
    path: &Path,
    query: &str,
    max_results: usize,
    context_lines: usize,
    file_filter: Option<fn(&Path) -> bool>,
) -> Result<Option<SearchResult>> {
    if context_lines > 0 {
        return Ok(None);
    }
    let output = match Command::new("rg")
        .arg("--line-number")
        .arg("--column")
        .arg("--no-heading")
        .arg("--color")
        .arg("never")
        .arg("--fixed-strings")
        .arg("--")
        .arg(query)
        .arg(path)
        .output()
    {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    if output.status.success() == false && output.status.code() != Some(1) {
        return Err(anyhow!("rg search failed"));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = Vec::new();
    for line in stdout.lines() {
        if lines.len() >= max_results {
            break;
        }
        if let Some(value) = parse_rg_line(security, line, file_filter) {
            lines.push(value);
        }
    }
    Ok(Some(SearchResult {
        truncated: stdout.lines().count() > max_results,
        lines,
        used_rg: true,
    }))
}

fn parse_rg_line(
    security: &WorkspaceSecurity,
    line: &str,
    file_filter: Option<fn(&Path) -> bool>,
) -> Option<serde_json::Value> {
    let mut parts = line.splitn(4, ':');
    let path = parts.next()?;
    let path = Path::new(path);
    if let Some(filter) = file_filter {
        if filter(path) == false {
            return None;
        }
    }
    let line_number = parts.next()?.parse::<usize>().ok()?;
    let column = parts.next()?.parse::<usize>().ok()?;
    let text = redact_secrets(parts.next().unwrap_or_default());
    Some(json!({
        "path": security.relative_display(path),
        "line": line_number,
        "column": column,
        "text": text
    }))
}

fn search_fallback(
    security: &WorkspaceSecurity,
    path: &Path,
    query: &str,
    max_results: usize,
    context_lines: usize,
    file_filter: Option<fn(&Path) -> bool>,
) -> Result<SearchResult> {
    let mut lines = Vec::new();
    let mut truncated = false;
    let files = collect_files(path)?;
    'files: for file in files {
        if let Some(filter) = file_filter {
            if filter(&file) == false {
                continue;
            }
        }
        if lines.len() >= max_results {
            truncated = true;
            break;
        }
        let Ok(content) = fs::read_to_string(&file) else {
            continue;
        };
        let file_lines = content.lines().collect::<Vec<_>>();
        for (index, line) in file_lines.iter().enumerate() {
            if line.contains(query) {
                if lines.len() >= max_results {
                    truncated = true;
                    break 'files;
                }
                let before_start = index.saturating_sub(context_lines);
                let after_end = (index + context_lines + 1).min(file_lines.len());
                lines.push(json!({
                    "path": security.relative_display(&file),
                    "line": index + 1,
                    "column": line.find(query).map(|value| value + 1).unwrap_or(1),
                    "text": redact_secrets(line),
                    "contextBefore": file_lines[before_start..index]
                        .iter()
                        .enumerate()
                        .map(|(context_index, value)| json!({
                            "line": before_start + context_index + 1,
                            "text": redact_secrets(value)
                        }))
                        .collect::<Vec<_>>(),
                    "contextAfter": file_lines[index + 1..after_end]
                        .iter()
                        .enumerate()
                        .map(|(context_index, value)| json!({
                            "line": index + context_index + 2,
                            "text": redact_secrets(value)
                        }))
                        .collect::<Vec<_>>()
                }));
            }
        }
    }
    Ok(SearchResult {
        lines,
        truncated,
        used_rg: false,
    })
}

struct ReadChunk {
    content: String,
    truncated: bool,
    next_offset_bytes: Option<usize>,
}

fn read_text_file_limited(path: &Path, max_bytes: usize, offset_bytes: usize) -> Result<ReadChunk> {
    let mut file = fs::File::open(path).context("failed to open file")?;
    file.seek(SeekFrom::Start(offset_bytes as u64))
        .context("failed to seek file")?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take((max_bytes + 1) as u64)
        .read_to_end(&mut bytes)
        .context("failed to read file")?;
    let truncated = bytes.len() > max_bytes;
    if truncated {
        bytes.truncate(max_bytes);
        while bytes.is_empty() == false && std::str::from_utf8(&bytes).is_err() {
            bytes.pop();
        }
    }
    let valid_bytes = bytes.len();
    let content = String::from_utf8(bytes)
        .map_err(|_| tool_error(TOOL_UNSUPPORTED_ENCODING, "file is not valid UTF-8 text"))?;
    Ok(ReadChunk {
        content: redact_secrets(&content),
        truncated,
        next_offset_bytes: if truncated {
            Some(offset_bytes + valid_bytes)
        } else {
            None
        },
    })
}

fn collect_files(path: &Path) -> Result<Vec<PathBuf>> {
    if path.is_file() {
        return Ok(vec![path.to_path_buf()]);
    }
    let mut result = Vec::new();
    collect_files_inner(path, &mut result)?;
    Ok(result)
}

fn collect_files_inner(path: &Path, result: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            collect_files_inner(&path, result)?;
        } else if metadata.is_file() {
            result.push(path);
        }
    }
    Ok(())
}

fn collect_tree(
    security: &WorkspaceSecurity,
    path: &Path,
    depth: usize,
    max_depth: usize,
    max_entries: usize,
    entries: &mut Vec<serde_json::Value>,
) -> Result<()> {
    if depth > max_depth || entries.len() >= max_entries {
        return Ok(());
    }
    let mut children = fs::read_dir(path)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    children.sort_by_key(|entry| entry.path());
    for entry in children {
        if entries.len() >= max_entries {
            break;
        }
        let metadata = fs::symlink_metadata(entry.path())?;
        let child_path = entry.path();
        entries.push(json!({
            "path": security.relative_display(&child_path),
            "depth": depth,
            "kind": metadata_kind(&metadata),
        }));
        if metadata.is_dir() && metadata.file_type().is_symlink() == false {
            collect_tree(
                security,
                &child_path,
                depth + 1,
                max_depth,
                max_entries,
                entries,
            )?;
        }
    }
    Ok(())
}

fn metadata_kind(metadata: &fs::Metadata) -> &'static str {
    if metadata.file_type().is_symlink() {
        "symlink"
    } else if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else {
        "other"
    }
}

fn is_source_like(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some(
            "rs" | "ts"
                | "tsx"
                | "js"
                | "jsx"
                | "mjs"
                | "cjs"
                | "py"
                | "go"
                | "java"
                | "kt"
                | "swift"
                | "c"
                | "h"
                | "cpp"
                | "hpp"
                | "cc"
                | "cs"
                | "rb"
                | "php"
                | "vue"
                | "svelte"
                | "css"
                | "scss"
                | "html"
                | "md"
                | "toml"
                | "json"
                | "yaml"
                | "yml"
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tool_runtime::operation::{ToolFsOp, ToolOperationEnvelope};
    use std::fs;

    fn operation(path: &str) -> ToolOperationEnvelope {
        ToolOperationEnvelope {
            schema_version: "v1".to_string(),
            kind: "tool_operation".to_string(),
            op_id: "op-test".to_string(),
            op: ToolFsOp::Run,
            path: path.to_string(),
            args: json!({}),
        }
    }

    #[test]
    fn read_file_enforces_max_bytes_truncation_and_redaction() {
        let temp = tempfile::tempdir().expect("tempdir");
        let file = temp.path().join("config.txt");
        fs::write(&file, "api_key = sk-secret-value\nhello world").expect("write");
        let context = ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        };
        let result = read_file(
            &context,
            &operation("/tools/filesystem/read_file"),
            ReadFileArgs {
                path: "config.txt".to_string(),
                max_bytes: Some(24),
                offset_bytes: None,
            },
        )
        .expect("read file");

        assert!(result.truncated);
        assert!(result.content.contains("sk-secret-value") == false);
        assert!(result.content.contains("[REDACTED]"));
    }

    #[test]
    fn read_range_returns_requested_lines() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("main.rs"), "one\ntwo\nthree\n").expect("write");
        let context = ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        };
        let result = read_range(
            &context,
            &operation("/tools/filesystem/read_range"),
            ReadRangeArgs {
                path: "main.rs".to_string(),
                start_line: Some(2),
                end_line: Some(2),
                max_bytes: None,
            },
        )
        .expect("read range");

        assert!(result.content.contains("\"line\": 2"));
        assert!(result.content.contains("two"));
        assert!(result.content.contains("one") == false);
    }

    #[test]
    fn read_file_and_list_files_return_continuation_offsets() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("a.txt"), "abcdef").expect("a");
        fs::write(temp.path().join("b.txt"), "b").expect("b");
        fs::write(temp.path().join("c.txt"), "c").expect("c");
        let context = ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        };

        let file = read_file(
            &context,
            &operation("/tools/filesystem/read_file"),
            ReadFileArgs {
                path: "a.txt".to_string(),
                max_bytes: Some(3),
                offset_bytes: Some(0),
            },
        )
        .expect("read file");
        let list = list_files(
            &context,
            &operation("/tools/filesystem/list_files"),
            ListFilesArgs {
                path: None,
                max_entries: Some(2),
                offset: Some(0),
            },
        )
        .expect("list");

        assert!(file.truncated);
        assert!(file.content.contains("\"nextOffsetBytes\": 3"));
        assert!(list.truncated);
        assert!(list.content.contains("\"nextOffset\": 2"));
    }

    #[test]
    fn search_files_walk_directory_and_code_search_return_safe_results() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(temp.path().join("src")).expect("src");
        fs::write(temp.path().join("src").join("main.rs"), "fn needle() {}\n").expect("main");
        fs::write(temp.path().join("notes.txt"), "needle\n").expect("notes");
        #[cfg(unix)]
        let _outside = {
            let outside = tempfile::tempdir().expect("outside");
            fs::write(outside.path().join("outside_secret.rs"), "fn needle() {}\n")
                .expect("outside secret");
            std::os::unix::fs::symlink(outside.path(), temp.path().join("outside-link"))
                .expect("symlink");
            outside
        };
        let context = ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        };

        let files = search_files(
            &context,
            &operation("/tools/filesystem/search_files"),
            SearchFilesArgs {
                query: "main".to_string(),
                path: None,
                max_results: Some(10),
                offset: None,
            },
        )
        .expect("search files");
        let tree = walk_directory(
            &context,
            &operation("/tools/filesystem/walk_directory"),
            WalkDirectoryArgs {
                path: None,
                max_entries: Some(10),
                max_depth: Some(3),
                offset: None,
            },
        )
        .expect("walk");
        let code = search_code(
            &context,
            &operation("/tools/code/search_code"),
            SearchCodeArgs {
                query: "needle".to_string(),
                path: None,
                max_results: Some(10),
                offset: None,
                context_lines: None,
            },
        )
        .expect("code search");

        assert!(files.content.contains("src/main.rs"));
        assert!(tree.content.contains("src/main.rs"));
        assert!(code.content.contains("src/main.rs"));
        assert!(code.content.contains("notes.txt") == false);
        assert!(files.content.contains("outside_secret.rs") == false);
        assert!(tree.content.contains("outside_secret.rs") == false);
        assert!(code.content.contains("outside_secret.rs") == false);
    }

    #[test]
    fn search_text_paginates_and_caps_context_lines() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(
            temp.path().join("notes.txt"),
            "before 1\nbefore 2\nneedle one\nafter 1\nafter 2\nneedle two\n",
        )
        .expect("notes");
        let context = ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        };

        let result = search_text(
            &context,
            &operation("/tools/filesystem/search_text"),
            SearchTextArgs {
                query: "needle".to_string(),
                path: None,
                max_results: Some(1),
                offset: Some(0),
                context_lines: Some(99),
            },
        )
        .expect("search");

        assert!(result.truncated);
        assert!(result.content.contains("\"contextLines\": 5"));
        assert!(result.content.contains("\"nextOffset\": 1"));
        assert!(result.content.contains("before 1"));
        assert!(result.content.contains("after 1"));
    }
}
