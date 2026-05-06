use crate::tool_runtime::catalog::{GitDiffArgs, GitStatusArgs};
use crate::tool_runtime::operation::{
    tool_error, ToolOperationEnvelope, ToolResultEnvelope, TOOL_GIT_NOT_REPOSITORY,
    TOOL_GIT_UNAVAILABLE,
};
use crate::tool_runtime::security::{redact_secrets, WorkspaceSecurity};
use crate::tool_runtime::ToolExecutionContext;
use anyhow::Result;
use serde_json::json;
use std::process::Command;

const DEFAULT_GIT_MAX_BYTES: usize = 64 * 1024;
const MAX_GIT_BYTES: usize = 256 * 1024;

pub fn status(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: GitStatusArgs,
) -> Result<ToolResultEnvelope> {
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let max_bytes = args
        .max_bytes
        .unwrap_or(DEFAULT_GIT_MAX_BYTES)
        .clamp(1, MAX_GIT_BYTES);
    let (stdout, truncated) = run_git_limited(
        security.root().to_string_lossy().as_ref(),
        &["status", "--short"],
        max_bytes,
    )?;
    let status = redact_secrets(&stdout);
    Ok(ToolResultEnvelope::completed(
        operation,
        if status.trim().is_empty() {
            "Git status is clean".to_string()
        } else {
            "Read git status".to_string()
        },
        serde_json::to_string_pretty(&json!({
            "workspace": ".",
            "status": status,
            "isClean": status.trim().is_empty()
        }))?,
        truncated,
    ))
}

pub fn diff(
    context: &ToolExecutionContext,
    operation: &ToolOperationEnvelope,
    args: GitDiffArgs,
) -> Result<ToolResultEnvelope> {
    let security = WorkspaceSecurity::new(context.workspace_root.as_deref())?;
    let stat = args.stat.unwrap_or(true);
    let max_bytes = args
        .max_bytes
        .unwrap_or(DEFAULT_GIT_MAX_BYTES)
        .clamp(1, MAX_GIT_BYTES);
    let git_args: &[&str] = if stat {
        &["diff", "--stat", "--"]
    } else {
        &["diff", "--"]
    };
    let (stdout, truncated) = run_git_limited(
        security.root().to_string_lossy().as_ref(),
        git_args,
        max_bytes,
    )?;
    let diff = redact_secrets(&stdout);
    Ok(ToolResultEnvelope::completed(
        operation,
        if stat {
            "Read git diff stat".to_string()
        } else {
            "Read git diff".to_string()
        },
        serde_json::to_string_pretty(&json!({
            "workspace": ".",
            "stat": stat,
            "diff": diff,
            "isEmpty": diff.trim().is_empty()
        }))?,
        truncated,
    ))
}

fn run_git_limited(cwd: &str, args: &[&str], max_bytes: usize) -> Result<(String, bool)> {
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .map_err(|error| {
            tool_error(TOOL_GIT_UNAVAILABLE, format!("git is unavailable: {error}"))
        })?;
    if output.status.success() == false {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let message = truncate_redacted(stderr.as_ref(), 4096).0;
        let code = if message.contains("not a git repository") {
            TOOL_GIT_NOT_REPOSITORY
        } else {
            TOOL_GIT_UNAVAILABLE
        };
        return Err(tool_error(code, format!("git command failed: {message}")));
    }
    Ok(truncate_redacted(
        String::from_utf8_lossy(&output.stdout).as_ref(),
        max_bytes,
    ))
}

fn truncate_redacted(value: &str, max_bytes: usize) -> (String, bool) {
    let redacted = redact_secrets(value);
    if redacted.len() <= max_bytes {
        return (redacted, false);
    }
    let mut end = max_bytes;
    while !redacted.is_char_boundary(end) {
        end -= 1;
    }
    (redacted[..end].to_string(), true)
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
    fn git_status_and_diff_are_read_only_and_redacted() {
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }
        let temp = tempfile::tempdir().expect("tempdir");
        Command::new("git")
            .arg("-C")
            .arg(temp.path())
            .arg("init")
            .output()
            .expect("git init");
        fs::write(temp.path().join("config.txt"), "api_key = sk-secret\n").expect("write");
        Command::new("git")
            .arg("-C")
            .arg(temp.path())
            .args(["add", "config.txt"])
            .output()
            .expect("git add");
        Command::new("git")
            .arg("-C")
            .arg(temp.path())
            .args([
                "-c",
                "user.name=test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "init",
            ])
            .output()
            .expect("git commit");
        fs::write(
            temp.path().join("config.txt"),
            "api_key = sk-secret\nchanged\n",
        )
        .expect("edit");

        let context = ToolExecutionContext {
            workspace_root: Some(temp.path().to_string_lossy().to_string()),
        };
        let status = status(
            &context,
            &operation("/tools/git/status"),
            GitStatusArgs { max_bytes: None },
        )
        .expect("status");
        let diff = diff(
            &context,
            &operation("/tools/git/diff"),
            GitDiffArgs {
                stat: Some(false),
                max_bytes: Some(4096),
            },
        )
        .expect("diff");

        assert!(status.content.contains("config.txt"));
        assert!(diff.content.contains("sk-secret") == false);
        assert!(diff.content.contains("[REDACTED]"));
    }
}
