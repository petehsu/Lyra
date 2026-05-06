use super::long_work_continuation_state::{ProgressSnapshot, WorkRunRow};
use super::long_work_status::LongWorkAuditStatus;
use super::*;

pub(super) fn packet_for_continuation(
    run: &WorkRunRow,
    open_todo_items: &[String],
    completed_todo_items: &[String],
    missing_evidence: &[String],
    progress: &ProgressSnapshot,
    recommended_action: &str,
    next_slice_sequence: i64,
) -> Value {
    let continuation_id = new_id("continuation");
    json!({
        "schemaVersion": "v1",
        "continuationId": continuation_id,
        "longWorkRunId": run.run_id,
        "previousSliceId": run.current_slice_id,
        "nextSliceSequence": next_slice_sequence,
        "untrustedObjectiveSummary": run.objective_summary,
        "goalStatus": "running",
        "currentStateSummary": continuation_reason(&[
            if open_todo_items.is_empty() { "" } else { "open_todo_items" }.to_string(),
            if missing_evidence.is_empty() { "" } else { "missing_required_evidence" }.to_string(),
        ]),
        "openTodoItems": open_todo_items,
        "completedTodoItems": completed_todo_items,
        "blockers": [],
        "evidenceRefs": progress.evidence_refs,
        "changedFilesRefs": progress.artifact_refs,
        "nextRequiredActions": next_required_actions(open_todo_items, missing_evidence),
        "forbiddenUserVisiblePatterns": [
            "do not ask the user whether to continue without a real blocker",
            "do not claim completion while Todo, Verification, or CompletionAudit is incomplete",
            "do not repeat already completed Todo items"
        ],
        "recommendedAction": recommended_action,
        "budgetSnapshotRef": null,
        "usageSnapshot": {
            "tokensUsed": 0,
            "timeUsedSeconds": 0
        }
    })
}

pub(super) fn open_todo_item_ids(items: &[AgentTodoItem]) -> Vec<String> {
    items
        .iter()
        .filter(|item| matches!(item.status.as_str(), "completed" | "skipped") == false)
        .map(|item| item.todo_item_id.clone())
        .collect()
}

pub(super) fn open_todo_items(items: &[AgentTodoItem]) -> Vec<String> {
    items
        .iter()
        .filter(|item| matches!(item.status.as_str(), "completed" | "skipped") == false)
        .map(|item| format!("{}: {}", item.todo_item_id, item.title))
        .collect()
}

pub(super) fn completed_todo_items(items: &[AgentTodoItem]) -> Vec<String> {
    items
        .iter()
        .filter(|item| matches!(item.status.as_str(), "completed" | "skipped"))
        .map(|item| format!("{}: {}", item.todo_item_id, item.title))
        .collect()
}

pub(super) fn missing_evidence_refs(audit: Option<&LongWorkAuditStatus>) -> Vec<String> {
    let Some(audit) = audit else {
        return Vec::new();
    };
    let mut refs = value_string_array(&audit.summary, "missingEvidenceRefs");
    refs = merge_string_refs(
        &refs,
        &value_string_array(&audit.summary, "notRunVerificationRunIds"),
    );
    refs = merge_string_refs(
        &refs,
        &value_string_array(&audit.summary, "pendingVerificationRunIds"),
    );
    if audit
        .summary
        .get("missingRequiredVerificationCount")
        .and_then(Value::as_i64)
        .unwrap_or(0)
        > 0
    {
        refs = merge_string_refs(&refs, &["missing_required_verification".to_string()]);
    }
    refs
}

fn next_required_actions(open_todo_items: &[String], missing_evidence: &[String]) -> Vec<String> {
    let mut actions = Vec::new();
    if let Some(item) = open_todo_items.first() {
        actions.push(format!("Continue unresolved Todo item: {item}"));
    }
    if missing_evidence.is_empty() == false {
        actions.push("Run or record required verification evidence".to_string());
    }
    if actions.is_empty() {
        actions.push("Continue the next incomplete structured work item".to_string());
    }
    actions
}

pub(super) fn continuation_reason(signals: &[String]) -> &str {
    if signals
        .iter()
        .any(|signal| signal == "missing_required_evidence")
    {
        "Verification or evidence is still missing"
    } else if signals.iter().any(|signal| signal == "open_todo_items") {
        "Todo items remain open"
    } else if signals
        .iter()
        .any(|signal| signal == "no_progress_since_last_slice")
    {
        "No progress was recorded in the stopped slice"
    } else {
        "Completion candidate was not accepted by structured state"
    }
}
