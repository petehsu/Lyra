use super::super::*;
use tempfile::tempdir;

#[test]
fn memory_record_includes_sync_metadata() {
    let temp = tempdir().expect("tempdir");
    let record = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            fact: Some("Sync metadata test memory".to_string()),
            confidence: Some(0.9),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");
    assert!(record.source_device.is_some());
    assert_eq!(record.revision, 1);
    assert_eq!(record.sync_origin.as_deref(), Some(SYNC_ORIGIN_LOCAL));
}

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
fn token_checkpoint_records_session_progress() {
    let temp = tempdir().expect("tempdir");
    let session_id = "session-token-checkpoint";
    record_session_token_checkpoint(
        temp.path(),
        session_id,
        "turn-1",
        Some("msg-3".to_string()),
        14_500,
    )
    .expect("record checkpoint");
    let latest = load_latest_session_token_checkpoint(temp.path(), session_id)
        .expect("load checkpoint")
        .expect("checkpoint");
    assert_eq!(latest.0.as_deref(), Some("msg-3"));
    assert_eq!(latest.1, 14_500);
}
