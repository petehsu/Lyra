use crate::tool_runtime::catalog::ProposePatchArgs;
use crate::tool_runtime::operation::{
    tool_error, ToolOperationEnvelope, ToolResultEnvelope, TOOL_INVALID_ARGUMENT,
    TOOL_PATCH_INVALID, TOOL_PATH_NOT_FILE, TOOL_UNSUPPORTED_ENCODING,
};
use crate::tool_runtime::security::{redact_secrets, WorkspaceSecurity};
use crate::tool_runtime::ToolExecutionContext;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_PATCH_BYTES: usize = 256 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchChangedFile {
    pub path: String,
    pub change_type: String,
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Clone, Debug)]
pub struct PatchProposal {
    pub title: String,
    pub rationale: Option<String>,
    pub patch: String,
    pub changed_files: Vec<PatchChangedFile>,
    pub approval_preview: Value,
}

#[derive(Clone, Debug)]
pub struct PatchApplyPlan {
    pub changed_files: Vec<PatchChangedFile>,
    pub files: Vec<PatchApplyFilePlan>,
}

#[derive(Clone, Debug)]
pub struct PatchApplyFilePlan {
    pub path: String,
    pub target_path: PathBuf,
    pub original_content: Option<String>,
    pub new_content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchWriteRecord {
    pub path: String,
    pub bytes: usize,
}

pub fn propose_patch(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: ProposePatchArgs,
) -> Result<ToolResultEnvelope> {
    let proposal = validate_patch_proposal(context, args)?;
    let changed_files = serde_json::to_value(&proposal.changed_files)?;
    let mut result = ToolResultEnvelope::completed(
        operation,
        format!(
            "Proposed patch for {} file{}",
            proposal.changed_files.len(),
            if proposal.changed_files.len() == 1 {
                ""
            } else {
                "s"
            }
        ),
        redact_secrets(&proposal.patch),
        proposal.patch.len() > MAX_PATCH_BYTES,
    );
    result.metadata = Some(json!({
        "kind": "patch_proposal",
        "title": proposal.title,
        "rationale": proposal.rationale,
        "changedFiles": changed_files,
        "approvalPreview": proposal.approval_preview
    }));
    Ok(result)
}

pub fn validate_patch_proposal(
    context: &ToolExecutionContext,
    args: ProposePatchArgs,
) -> Result<PatchProposal> {
    if args.title.trim().is_empty() {
        return Err(tool_error(TOOL_INVALID_ARGUMENT, "title is required"));
    }
    if args.patch.trim().is_empty() {
        return Err(tool_error(TOOL_PATCH_INVALID, "patch is required"));
    }
    if args.patch.len() > MAX_PATCH_BYTES {
        return Err(tool_error(TOOL_PATCH_INVALID, "patch exceeds maximum size"));
    }
    if args.expected_files.is_empty() {
        return Err(tool_error(
            TOOL_INVALID_ARGUMENT,
            "expectedFiles is required",
        ));
    }
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let expected_files = args
        .expected_files
        .iter()
        .map(|path| security.validate_relative_path_for_write_preview(path))
        .collect::<Result<BTreeSet<_>>>()?;
    if expected_files.is_empty() {
        return Err(tool_error(
            TOOL_INVALID_ARGUMENT,
            "expectedFiles is required",
        ));
    }
    let changed_files = parse_unified_diff(&args.patch)?;
    let patch_files = changed_files
        .iter()
        .map(|file| file.path.clone())
        .collect::<BTreeSet<_>>();
    if patch_files != expected_files {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "patch paths do not match expectedFiles",
        ));
    }
    let approval_preview = json!({
        "schemaVersion": "v1",
        "risk": {
            "level": "medium",
            "kinds": ["workspace_write"],
            "reversible": "yes",
            "summary": format!("A future apply step would modify {} workspace file{}.", changed_files.len(), if changed_files.len() == 1 { "" } else { "s" })
        },
        "impactFiles": changed_files.iter().map(|file| file.path.clone()).collect::<Vec<_>>(),
        "requestedFutureAction": {
            "toolPath": "/tools/filesystem/apply_patch",
            "executeAfterApproval": false
        }
    });
    Ok(PatchProposal {
        title: args.title.trim().to_string(),
        rationale: args.rationale.and_then(|value| {
            let value = value.trim().to_string();
            if value.is_empty() {
                None
            } else {
                Some(value)
            }
        }),
        patch: args.patch,
        changed_files,
        approval_preview,
    })
}

pub fn parse_unified_diff(patch: &str) -> Result<Vec<PatchChangedFile>> {
    let sections = parse_unified_diff_sections(patch)?;
    Ok(sections
        .into_iter()
        .map(|section| section.summary)
        .collect())
}

pub fn plan_patch_apply(
    context: &ToolExecutionContext,
    patch: &str,
    expected_changed_files: &[PatchChangedFile],
) -> Result<PatchApplyPlan> {
    if patch.trim().is_empty() {
        return Err(tool_error(TOOL_PATCH_INVALID, "patch is required"));
    }
    if patch.len() > MAX_PATCH_BYTES {
        return Err(tool_error(TOOL_PATCH_INVALID, "patch exceeds maximum size"));
    }
    if expected_changed_files.is_empty() {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "patch artifact is missing changedFiles metadata",
        ));
    }
    let sections = parse_unified_diff_sections(patch)?;
    let changed_files = sections
        .iter()
        .map(|section| section.summary.clone())
        .collect::<Vec<_>>();
    if changed_files != expected_changed_files {
        return Err(tool_error(
            TOOL_PATCH_INVALID,
            "patch content does not match artifact changedFiles metadata",
        ));
    }
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let mut seen_paths = BTreeSet::new();
    let mut files = Vec::with_capacity(sections.len());
    for section in sections {
        if seen_paths.insert(section.summary.path.clone()) == false {
            return Err(tool_error(
                TOOL_PATCH_INVALID,
                format!(
                    "patch changes path more than once: {}",
                    section.summary.path
                ),
            ));
        }
        let relative_path =
            security.validate_relative_path_for_write_preview(&section.summary.path)?;
        match section.summary.change_type.as_str() {
            "created" => {
                let target_path = security.root().join(&relative_path);
                if target_path.exists() {
                    return Err(tool_error(
                        TOOL_PATCH_INVALID,
                        format!("created file already exists: {relative_path}"),
                    ));
                }
                let new_content = apply_hunks("", &section.hunks)?;
                files.push(PatchApplyFilePlan {
                    path: relative_path,
                    target_path,
                    original_content: None,
                    new_content,
                });
            }
            "modified" => {
                if section.old_path != section.new_path {
                    return Err(tool_error(
                        TOOL_PATCH_INVALID,
                        "rename patches are not supported by apply_patch",
                    ));
                }
                let target_path = security.root().join(&relative_path);
                if target_path.is_file() == false {
                    return Err(tool_error(
                        TOOL_PATH_NOT_FILE,
                        format!("path is not a file: {relative_path}"),
                    ));
                }
                let bytes = fs::read(&target_path)
                    .with_context(|| format!("failed to read {}", target_path.display()))?;
                let original_content = String::from_utf8(bytes).map_err(|_| {
                    tool_error(
                        TOOL_UNSUPPORTED_ENCODING,
                        format!("file is not valid UTF-8: {relative_path}"),
                    )
                })?;
                let new_content = apply_hunks(&original_content, &section.hunks)?;
                files.push(PatchApplyFilePlan {
                    path: relative_path,
                    target_path,
                    original_content: Some(original_content),
                    new_content,
                });
            }
            "deleted" => {
                return Err(tool_error(
                    TOOL_PATCH_INVALID,
                    "delete patches are not supported by apply_patch",
                ));
            }
            _ => {
                return Err(tool_error(
                    TOOL_PATCH_INVALID,
                    "unsupported patch change type",
                ));
            }
        }
    }
    Ok(PatchApplyPlan {
        changed_files,
        files,
    })
}

pub fn write_patch_apply_plan(plan: &PatchApplyPlan) -> Result<Vec<PatchWriteRecord>> {
    let mut writes = Vec::with_capacity(plan.files.len());
    for file in &plan.files {
        write_atomic_text(&file.target_path, &file.new_content)?;
        writes.push(PatchWriteRecord {
            path: file.path.clone(),
            bytes: file.new_content.len(),
        });
    }
    Ok(writes)
}

pub fn write_atomic_text(target_path: &Path, content: &str) -> Result<()> {
    let parent = target_path
        .parent()
        .ok_or_else(|| tool_error(TOOL_PATCH_INVALID, "patch target has no parent"))?;
    let file_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("patch-target");
    let temp_path = parent.join(format!(".{file_name}.lyra-{}.tmp", Uuid::new_v4()));
    let write_result = (|| -> Result<()> {
        let mut temp_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .with_context(|| format!("failed to create temp file {}", temp_path.display()))?;
        temp_file
            .write_all(content.as_bytes())
            .with_context(|| format!("failed to write temp file {}", temp_path.display()))?;
        temp_file
            .sync_all()
            .with_context(|| format!("failed to sync temp file {}", temp_path.display()))?;
        drop(temp_file);
        fs::rename(&temp_path, target_path)
            .with_context(|| format!("failed to atomically replace {}", target_path.display()))?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

#[derive(Clone, Debug)]
struct DiffFileSection {
    old_path: String,
    new_path: String,
    summary: PatchChangedFile,
    hunks: Vec<DiffHunk>,
}

#[derive(Clone, Debug)]
struct DiffHunk {
    old_start: usize,
    lines: Vec<DiffHunkLine>,
}

#[derive(Clone, Debug)]
enum DiffHunkLine {
    Context(String),
    Delete(String),
    Add(String),
}

fn parse_unified_diff_sections(patch: &str) -> Result<Vec<DiffFileSection>> {
    let lines = patch.split('\n').collect::<Vec<_>>();
    let mut result = Vec::new();
    let mut index = 0;
    while index < lines.len() {
        if !lines[index].starts_with("--- ") {
            index += 1;
            continue;
        }
        let old_path = parse_diff_path(lines[index], "--- ")?;
        index += 1;
        if index >= lines.len() || !lines[index].starts_with("+++ ") {
            return Err(tool_error(TOOL_PATCH_INVALID, "malformed unified diff"));
        }
        let new_path = parse_diff_path(lines[index], "+++ ")?;
        index += 1;
        let mut additions = 0_usize;
        let mut deletions = 0_usize;
        let mut hunks = Vec::new();
        while index < lines.len() && !lines[index].starts_with("--- ") {
            let line = lines[index];
            if line.starts_with("@@") {
                let (hunk, next_index, hunk_additions, hunk_deletions) = parse_hunk(&lines, index)?;
                additions += hunk_additions;
                deletions += hunk_deletions;
                hunks.push(hunk);
                index = next_index;
                continue;
            }
            index += 1;
        }
        if hunks.is_empty() {
            return Err(tool_error(
                TOOL_PATCH_INVALID,
                "diff file section has no hunk",
            ));
        }
        let path = if new_path == "/dev/null" {
            old_path.clone()
        } else {
            new_path.clone()
        };
        if path == "/dev/null" || path.trim().is_empty() {
            return Err(tool_error(TOOL_PATCH_INVALID, "diff path is invalid"));
        }
        let change_type = if old_path == "/dev/null" {
            "created"
        } else if new_path == "/dev/null" {
            "deleted"
        } else {
            "modified"
        };
        result.push(DiffFileSection {
            old_path,
            new_path,
            summary: PatchChangedFile {
                path,
                change_type: change_type.to_string(),
                additions,
                deletions,
            },
            hunks,
        });
    }
    if result.is_empty() {
        return Err(tool_error(TOOL_PATCH_INVALID, "patch has no file changes"));
    }
    Ok(result)
}

fn parse_hunk(lines: &[&str], start_index: usize) -> Result<(DiffHunk, usize, usize, usize)> {
    let header = lines[start_index];
    let old_start = parse_hunk_old_start(header)?;
    let mut index = start_index + 1;
    let mut hunk_lines = Vec::new();
    let mut additions = 0_usize;
    let mut deletions = 0_usize;
    while index < lines.len()
        && !lines[index].starts_with("@@")
        && !lines[index].starts_with("--- ")
    {
        let line = lines[index];
        if line == r"\ No newline at end of file" {
            if let Some(last) = hunk_lines.last_mut() {
                strip_trailing_newline(last);
            }
            index += 1;
            continue;
        }
        let Some(kind) = line.chars().next() else {
            if index + 1 == lines.len() {
                break;
            }
            return Err(tool_error(TOOL_PATCH_INVALID, "malformed hunk line"));
        };
        let text = format!("{}\n", &line[kind.len_utf8()..]);
        match kind {
            ' ' => hunk_lines.push(DiffHunkLine::Context(text)),
            '-' => {
                deletions += 1;
                hunk_lines.push(DiffHunkLine::Delete(text));
            }
            '+' => {
                additions += 1;
                hunk_lines.push(DiffHunkLine::Add(text));
            }
            _ => {
                if index + 1 == lines.len() && line.is_empty() {
                    break;
                }
                return Err(tool_error(TOOL_PATCH_INVALID, "malformed hunk line"));
            }
        }
        index += 1;
    }
    if hunk_lines.is_empty() {
        return Err(tool_error(TOOL_PATCH_INVALID, "empty diff hunk"));
    }
    Ok((
        DiffHunk {
            old_start,
            lines: hunk_lines,
        },
        index,
        additions,
        deletions,
    ))
}

fn parse_hunk_old_start(header: &str) -> Result<usize> {
    let Some(rest) = header.strip_prefix("@@ -") else {
        return Err(tool_error(TOOL_PATCH_INVALID, "malformed hunk header"));
    };
    let old_range = rest
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_start_matches('-');
    let start = old_range
        .split(',')
        .next()
        .unwrap_or_default()
        .parse::<usize>()
        .map_err(|_| tool_error(TOOL_PATCH_INVALID, "malformed hunk range"))?;
    Ok(start)
}

fn strip_trailing_newline(line: &mut DiffHunkLine) {
    let value = match line {
        DiffHunkLine::Context(value) | DiffHunkLine::Delete(value) | DiffHunkLine::Add(value) => {
            value
        }
    };
    if value.ends_with('\n') {
        value.pop();
    }
}

fn apply_hunks(original: &str, hunks: &[DiffHunk]) -> Result<String> {
    let source_lines = original
        .split_inclusive('\n')
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let mut output = Vec::<String>::new();
    let mut cursor = 0_usize;
    for hunk in hunks {
        let old_index = hunk.old_start.saturating_sub(1);
        if old_index < cursor || old_index > source_lines.len() {
            return Err(tool_error(
                TOOL_PATCH_INVALID,
                "hunk range is out of bounds",
            ));
        }
        output.extend(source_lines[cursor..old_index].iter().cloned());
        cursor = old_index;
        for line in &hunk.lines {
            match line {
                DiffHunkLine::Context(text) => {
                    expect_source_line(&source_lines, cursor, text)?;
                    output.push(text.clone());
                    cursor += 1;
                }
                DiffHunkLine::Delete(text) => {
                    expect_source_line(&source_lines, cursor, text)?;
                    cursor += 1;
                }
                DiffHunkLine::Add(text) => output.push(text.clone()),
            }
        }
    }
    output.extend(source_lines[cursor..].iter().cloned());
    Ok(output.concat())
}

fn expect_source_line(source_lines: &[String], cursor: usize, expected: &str) -> Result<()> {
    if source_lines.get(cursor).map(String::as_str) == Some(expected) {
        return Ok(());
    }
    Err(tool_error(
        TOOL_PATCH_INVALID,
        "patch hunk does not match current file content",
    ))
}

fn parse_diff_path(line: &str, prefix: &str) -> Result<String> {
    let path = line
        .strip_prefix(prefix)
        .unwrap_or_default()
        .split_whitespace()
        .next()
        .unwrap_or_default();
    if path.is_empty() {
        return Err(tool_error(TOOL_PATCH_INVALID, "diff path is empty"));
    }
    if path == "/dev/null" {
        return Ok(path.to_string());
    }
    Ok(path
        .strip_prefix("a/")
        .or_else(|| path.strip_prefix("b/"))
        .unwrap_or(path)
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(root: &std::path::Path) -> ToolExecutionContext {
        ToolExecutionContext {
            workspace_root: Some(root.to_string_lossy().to_string()),
        }
    }

    #[test]
    fn parses_modify_create_and_delete_summaries() {
        let patch = "--- a/README.md\n+++ b/README.md\n@@ -1 +1,2 @@\n-old\n+new\n+line\n--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1 @@\n+created\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-deleted\n";
        let parsed = parse_unified_diff(patch).expect("parse");

        assert_eq!(parsed[0].path, "README.md");
        assert_eq!(parsed[0].change_type, "modified");
        assert_eq!(parsed[0].additions, 2);
        assert_eq!(parsed[0].deletions, 1);
        assert_eq!(parsed[1].change_type, "created");
        assert_eq!(parsed[2].change_type, "deleted");
    }

    #[test]
    fn validates_expected_files_and_workspace_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::write(temp.path().join("README.md"), "old\n").expect("write");
        let proposal = validate_patch_proposal(
            &context(temp.path()),
            ProposePatchArgs {
                title: "Update README".to_string(),
                rationale: None,
                patch: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n".to_string(),
                expected_files: vec!["README.md".to_string()],
            },
        )
        .expect("proposal");

        assert_eq!(proposal.changed_files[0].path, "README.md");
        assert!(validate_patch_proposal(
            &context(temp.path()),
            ProposePatchArgs {
                title: "Bad".to_string(),
                rationale: None,
                patch: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n".to_string(),
                expected_files: vec!["../README.md".to_string()],
            },
        )
        .is_err());
    }

    #[test]
    fn rejects_invalid_patch_inputs() {
        let temp = tempfile::tempdir().expect("tempdir");
        std::fs::create_dir_all(temp.path().join("src")).expect("src");
        let valid_patch = "--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -1 +1 @@\n-old\n+new\n";

        for expected_files in [
            vec!["/tmp/lib.rs".to_string()],
            vec!["src/../lib.rs".to_string()],
            vec!["src/main.rs".to_string()],
        ] {
            assert!(validate_patch_proposal(
                &context(temp.path()),
                ProposePatchArgs {
                    title: "Bad".to_string(),
                    rationale: None,
                    patch: valid_patch.to_string(),
                    expected_files,
                },
            )
            .is_err());
        }

        for patch in [
            "",
            "not a unified diff",
            "--- a/src/lib.rs\n+++ b/src/lib.rs\n",
        ] {
            assert!(validate_patch_proposal(
                &context(temp.path()),
                ProposePatchArgs {
                    title: "Bad".to_string(),
                    rationale: None,
                    patch: patch.to_string(),
                    expected_files: vec!["src/lib.rs".to_string()],
                },
            )
            .is_err());
        }

        assert!(validate_patch_proposal(
            &context(temp.path()),
            ProposePatchArgs {
                title: "Too large".to_string(),
                rationale: None,
                patch: "x".repeat(MAX_PATCH_BYTES + 1),
                expected_files: vec!["src/lib.rs".to_string()],
            },
        )
        .is_err());
    }
}
