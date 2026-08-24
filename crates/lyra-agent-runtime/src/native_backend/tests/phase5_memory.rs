use super::super::*;
use tempfile::tempdir;

#[test]
fn derived_age_field_updates_from_date_of_birth() {
    let mut content = json!({
        "kind": "date_of_birth",
        "dateOfBirth": "1990-01-15"
    });
    apply_derived_fields_to_content(&mut content);
    assert!(
        content
            .get("derivedAgeYears")
            .and_then(Value::as_u64)
            .is_some()
    );
}

#[test]
fn low_confidence_candidate_enters_stability_pending() {
    let temp = tempdir().expect("tempdir");
    let candidate = create_memory_candidate(
        temp.path(),
        MemoryCandidateMutation {
            fact: "Inferred preference for dark mode".to_string(),
            content: json!({ "kind": "preference", "text": "dark mode" }),
            category: "preference".to_string(),
            scope: "global".to_string(),
            confidence: 0.72,
            source_type: "memory_agent_inference".to_string(),
            proposed_action: "create".to_string(),
            ..MemoryCandidateMutation::default()
        },
    )
    .expect("create candidate");
    assert_eq!(candidate.status, "stability_pending");
    assert!(candidate.stability_review_at.is_some());
}

#[test]
fn merge_candidate_action_merges_content() {
    let temp = tempdir().expect("tempdir");
    let existing = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            fact: Some("Project uses Rust".to_string()),
            content: Some(json!({ "stack": ["rust"], "notes": "backend" })),
            confidence: Some(0.9),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");
    let candidate = create_memory_candidate(
        temp.path(),
        MemoryCandidateMutation {
            fact: "Project uses Rust and TypeScript".to_string(),
            content: json!({ "stack": ["rust", "typescript"] }),
            category: "project".to_string(),
            scope: "global".to_string(),
            confidence: 0.95,
            source_type: "user_declaration".to_string(),
            proposed_action: "merge".to_string(),
            target_id: Some(existing.id.clone()),
            ..MemoryCandidateMutation::default()
        },
    )
    .expect("create candidate");
    let result = apply_memory_candidate(temp.path(), &candidate.id).expect("apply merge");
    let record = result["result"]["record"]["content"].clone();
    assert_eq!(
        record.get("stack").and_then(Value::as_array).map(Vec::len),
        Some(2)
    );
    assert_eq!(record.get("notes").and_then(Value::as_str), Some("backend"));
}

#[test]
fn memory_trigger_persists_mark_and_job_together() {
    let temp = tempdir().expect("tempdir");
    let event = MemoryTriggerEvent {
        event_type: EVENT_TOOL_CALL_COMPLETED.to_string(),
        session_id: "session-atomic-trigger".to_string(),
        turn_id: "turn-atomic-trigger".to_string(),
        payload: json!({ "toolName": "file_write" }),
    };

    record_memory_trigger_and_enqueue(temp.path(), &event).expect("enqueue trigger transaction");
    let conn = open_memory_connection(temp.path()).expect("open memory store");
    let trigger_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM trigger_marks", [], |row| row.get(0))
        .expect("count trigger marks");
    let job_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memory_jobs", [], |row| row.get(0))
        .expect("count memory jobs");
    assert_eq!((trigger_count, job_count), (1, 1));
}

#[test]
fn interrupted_memory_job_is_requeued() {
    let temp = tempdir().expect("tempdir");
    let event = MemoryTriggerEvent {
        event_type: EVENT_FILE_CHANGE_RECORDED.to_string(),
        session_id: "session-replay".to_string(),
        turn_id: "turn-replay".to_string(),
        payload: json!({ "path": "src/lib.rs" }),
    };
    record_memory_trigger_and_enqueue(temp.path(), &event).expect("enqueue trigger");
    let claimed = claim_next_memory_job(temp.path())
        .expect("claim job")
        .expect("pending job");

    assert_eq!(
        recover_interrupted_memory_jobs(temp.path()).expect("recover interrupted job"),
        1
    );
    let replayed = claim_next_memory_job(temp.path())
        .expect("reclaim job")
        .expect("requeued job");
    assert_eq!(replayed.id, claimed.id);
}
