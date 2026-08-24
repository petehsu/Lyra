use super::super::*;

#[test]
fn frozen_sensitive_profile_assigns_frozen_layer() {
    let layer = resolve_memory_layer(
        "user_profile",
        &json!({
            "kind": "contact_email",
            "email": "user@example.com",
            "requiresConfirmation": true
        }),
        true,
    );
    assert_eq!(layer, LAYER_FROZEN);
}

#[test]
fn execution_evidence_requires_higher_confidence_gate() {
    assert!(!promotion_gate_passes(VALUE_EXECUTION_EVIDENCE, 0.7, true));
    assert!(promotion_gate_passes(VALUE_EXECUTION_EVIDENCE, 0.9, true));
    assert!(promotion_gate_passes(VALUE_SEMANTIC, 0.6, false));
}

#[test]
fn ranked_injection_uses_layered_depth_markers() {
    let now = now();
    let ranked = RankedMemoryRecord {
        record: LongTermMemoryRecord {
            id: "memory-layered".to_string(),
            scope: "global".to_string(),
            category: "project".to_string(),
            fact: "Lyra memory injection uses layered depth".to_string(),
            content: json!({ "fact": "Lyra memory injection uses layered depth" }),
            layer: LAYER_SHARED.to_string(),
            value_class: VALUE_SEMANTIC.to_string(),
            abstract_text: Some("Lyra memory injection uses layered depth".to_string()),
            confidence: 0.95,
            source_type: "project_fact".to_string(),
            source_ref: None,
            status: "active".to_string(),
            priority: 40,
            created_at: now.clone(),
            updated_at: now,
            last_accessed_at: None,
            access_count: 0,
            tags: Vec::new(),
            related_to: Vec::new(),
            expires_at: None,
            supersedes: None,
            superseded_by: None,
            revision: 1,
        },
        score: 0.8,
        breakdown: MemoryScoreBreakdown::default(),
    };
    let prompt = shared_memory_prompt(&[ranked]);
    assert!(prompt.contains("[L2/detail]"));
    assert!(prompt.contains("layer=shared"));
}

#[test]
fn frozen_record_blocks_auto_overwrite() {
    let temp = tempfile::tempdir().expect("tempdir");
    let existing = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("user_profile".to_string()),
            fact: Some("用户联系邮箱是 old@example.com".to_string()),
            content: Some(json!({
                "kind": "contact_email",
                "email": "old@example.com",
                "requiresConfirmation": true
            })),
            layer: Some(LAYER_FROZEN.to_string()),
            confidence: Some(1.0),
            source_type: Some("user_declaration".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create frozen memory");
    let result = process_extracted_candidate(
        temp.path(),
        "session-frozen",
        "turn-frozen",
        MemoryCandidateMutation {
            fact: "用户联系邮箱是 new@example.com".to_string(),
            content: json!({
                "kind": "contact_email",
                "email": "new@example.com",
                "requiresConfirmation": true
            }),
            category: "user_profile".to_string(),
            scope: "global".to_string(),
            confidence: 0.96,
            source_type: "memory_agent_inference".to_string(),
            proposed_action: "create".to_string(),
            ..MemoryCandidateMutation::default()
        },
    )
    .expect("process candidate");
    assert_eq!(
        result.get("frozenProtected").and_then(Value::as_bool),
        Some(true)
    );
    let active = list_long_term_memory(
        temp.path(),
        MemoryQuery {
            status: Some("active".to_string()),
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("list active");
    assert!(active.iter().any(|record| record.id == existing.id));
}
