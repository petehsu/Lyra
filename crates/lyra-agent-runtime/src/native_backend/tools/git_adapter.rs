use super::*;
use anyhow::Context;

pub(crate) fn execute_git_tool_fs_tool(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    manifest: &lyra_tool_fs_core::ToolManifest,
    operation_envelope: &lyra_tool_fs_core::ToolOperationEnvelope,
    args: Value,
    started_at: &str,
) -> Value {
    let input = with_session_working_dir(session_id, args);
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "git",
            &tool_label("git", &manifest.operation),
            "running",
            input.clone(),
            None,
            started_at,
            None,
        ),
        "toolStarted",
    );
    let git_mutation_audit = capture_git_mutation_before_refs(
        session_id,
        turn_id,
        tool_call_id,
        &manifest.operation,
        &input,
    );
    let payload = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());
    let raw_result = match manifest.operation.as_str() {
        "status" => crate::git_runtime::git_status_json(payload),
        "diff" => crate::git_runtime::git_diff_json(payload),
        "stage" => crate::git_runtime::git_stage_json(payload),
        "unstage" => crate::git_runtime::git_unstage_json(payload),
        "discard" => crate::git_runtime::git_discard_json(payload),
        "log" => crate::git_runtime::git_log_json(payload),
        "show" => crate::git_runtime::git_show_json(payload),
        "branch" => crate::git_runtime::git_branch_json(payload),
        _ => Err(anyhow::anyhow!("unknown git operation")),
    }
    .and_then(|text| serde_json::from_str::<Value>(&text).context("decode git tool output"));
    let (status, output) = match raw_result {
        Ok(mut raw) => {
            if let Some(object) = raw.as_object_mut() {
                object
                    .entry("toolOperation".to_string())
                    .or_insert_with(|| {
                        serde_json::to_value(operation_envelope).unwrap_or_else(|_| Value::Null)
                    });
            }
            if policy_record_required("git", &manifest.operation, &input) {
                raw = attach_policy_decision_to_raw(
                    raw,
                    Some(auto_approval_policy_decision(
                        "git",
                        &manifest.operation,
                        &input,
                    )),
                );
            }
            attach_git_mutation_change_refs(
                session_id,
                turn_id,
                tool_call_id,
                &manifest.operation,
                &input,
                &mut raw,
                git_mutation_audit,
            );
            (
                "completed",
                json!({
                    "content": format_git_output(&manifest.operation, &raw),
                    "raw": raw,
                }),
            )
        }
        Err(error) => (
            "failed",
            tool_failure_output(
                "git_tool_failed",
                &format!("Git tool failed: {error}"),
                "Inspect the Git tool input and retry with a valid workingDir/path/ref.",
                Some(json!({ "operation": manifest.operation })),
            ),
        ),
    };
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            "git",
            &tool_label("git", &manifest.operation),
            status,
            input,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    output
}

#[derive(Clone, Default)]
struct GitMutationAuditRefs {
    before_ref: Option<Value>,
    diff_ref: Option<Value>,
    diff_scope: Option<String>,
}

fn capture_git_mutation_before_refs(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    operation: &str,
    input: &Value,
) -> Option<GitMutationAuditRefs> {
    if !matches!(operation, "stage" | "unstage" | "discard") {
        return None;
    }
    Some(GitMutationAuditRefs {
        before_ref: capture_git_status_artifact(
            session_id,
            turn_id,
            tool_call_id,
            "git-before-status",
            input,
        ),
        diff_ref: capture_git_diff_artifact(session_id, turn_id, tool_call_id, operation, input),
        diff_scope: git_mutation_diff_scope(operation).map(str::to_string),
    })
}

fn attach_git_mutation_change_refs(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    operation: &str,
    input: &Value,
    raw: &mut Value,
    audit: Option<GitMutationAuditRefs>,
) {
    if !matches!(operation, "stage" | "unstage" | "discard") {
        return;
    }
    let audit = audit.unwrap_or_default();
    let path = input
        .get("path")
        .or_else(|| input.get("file"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let after_ref = raw
        .get("snapshot")
        .and_then(|snapshot| {
            write_json_tool_artifact(
                session_id,
                turn_id,
                tool_call_id,
                "git-after-status",
                snapshot,
            )
        })
        .or_else(|| {
            capture_git_status_artifact(
                session_id,
                turn_id,
                tool_call_id,
                "git-after-status",
                input,
            )
        });
    let change = json!({
        "kind": "git",
        "operation": operation,
        "path": path,
        "summary": "Git working tree mutation executed.",
        "reversible": operation != "discard",
        "beforeRef": audit.before_ref.unwrap_or(Value::Null),
        "afterRef": after_ref.unwrap_or(Value::Null),
        "diffRef": audit.diff_ref.clone().unwrap_or(Value::Null),
        "diffScope": audit.diff_scope,
    });
    let Some(object) = raw.as_object_mut() else {
        return;
    };
    object.insert("changedFiles".to_string(), json!([change]));
    if let Some(diff_ref) = audit.diff_ref {
        object.insert("diffArtifactRef".to_string(), diff_ref);
    }
}

fn capture_git_status_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    label: &str,
    input: &Value,
) -> Option<Value> {
    let working_dir =
        value_string(input, "workingDir").or_else(|| value_string(input, "working_dir"))?;
    let payload = json!({ "workingDir": working_dir }).to_string();
    let text = crate::git_runtime::git_status_json(payload).ok()?;
    let content = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| serde_json::to_string_pretty(&value).ok())
        .unwrap_or(text);
    write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-{label}"),
        ToolArtifactKind::Snapshot,
        &content,
    )
}

fn capture_git_diff_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    operation: &str,
    input: &Value,
) -> Option<Value> {
    let diff = capture_git_mutation_diff_text(operation, input)?;
    if diff.trim().is_empty() {
        return None;
    }
    write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-git-diff"),
        ToolArtifactKind::Diff,
        &diff,
    )
}

fn capture_git_mutation_diff_text(operation: &str, input: &Value) -> Option<String> {
    let working_dir =
        value_string(input, "workingDir").or_else(|| value_string(input, "working_dir"))?;
    let path = value_string(input, "path").or_else(|| value_string(input, "file"))?;
    if operation == "discard" {
        let staged = git_diff_text(&working_dir, &path, "staged").unwrap_or_default();
        let unstaged = git_diff_text(&working_dir, &path, "unstaged").unwrap_or_default();
        let mut parts = Vec::new();
        if !staged.trim().is_empty() {
            parts.push(format!("## staged\n{staged}"));
        }
        if !unstaged.trim().is_empty() {
            parts.push(format!("## unstaged\n{unstaged}"));
        }
        return Some(parts.join("\n"));
    }
    let scope = git_mutation_diff_scope(operation)?;
    git_diff_text(&working_dir, &path, scope)
}

fn git_mutation_diff_scope(operation: &str) -> Option<&'static str> {
    match operation {
        "stage" => Some("unstaged"),
        "unstage" => Some("staged"),
        "discard" => Some("staged+unstaged"),
        _ => None,
    }
}

fn git_diff_text(working_dir: &str, path: &str, scope: &str) -> Option<String> {
    let payload = json!({
        "workingDir": working_dir,
        "path": path,
        "scope": scope,
    })
    .to_string();
    let text = crate::git_runtime::git_diff_json(payload).ok()?;
    let value = serde_json::from_str::<Value>(&text).ok()?;
    value
        .get("diff")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn write_json_tool_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    label: &str,
    value: &Value,
) -> Option<Value> {
    let content = serde_json::to_string_pretty(value).ok()?;
    write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-{label}"),
        ToolArtifactKind::RawData,
        &content,
    )
}

fn with_session_working_dir(session_id: &str, args: Value) -> Value {
    let mut input = args.as_object().cloned().unwrap_or_default();
    let has_working_dir = input
        .get("workingDir")
        .or_else(|| input.get("working_dir"))
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    if !has_working_dir && let Some(working_dir) = session_working_dir(session_id) {
        input.insert("workingDir".to_string(), Value::String(working_dir));
    }
    Value::Object(input)
}

fn session_working_dir(session_id: &str) -> Option<String> {
    state().lock().ok().and_then(|state| {
        state
            .sessions
            .get(session_id)
            .and_then(|session| session.snapshot.get("workingDir"))
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
    })
}

fn format_git_output(operation: &str, raw: &Value) -> String {
    match operation {
        "status" => {
            let branch = raw
                .get("branch")
                .and_then(Value::as_str)
                .unwrap_or("detached");
            let changed = raw
                .pointer("/summary/changed")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            format!("Git status on {branch}: {changed} changed files.")
        }
        "diff" => format!(
            "Git diff for {}.",
            raw.get("path").and_then(Value::as_str).unwrap_or("path")
        ),
        "log" => format!(
            "Git log: {} commits.",
            raw.get("commits")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0)
        ),
        "show" => format!(
            "Git show {}.",
            raw.get("ref").and_then(Value::as_str).unwrap_or("ref")
        ),
        "branch" => format!(
            "Git branch: {}.",
            raw.get("current")
                .and_then(Value::as_str)
                .unwrap_or("unknown")
        ),
        "stage" | "unstage" | "discard" => "Git mutation completed.".to_string(),
        _ => serde_json::to_string_pretty(raw).unwrap_or_default(),
    }
}
