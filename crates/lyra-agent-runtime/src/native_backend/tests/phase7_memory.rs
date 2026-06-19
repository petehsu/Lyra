use super::super::*;
use tempfile::tempdir;

#[test]
fn stability_policy_varies_by_source_type() {
    let inferred = MemoryCandidateMutation {
        source_type: "inferred".to_string(),
        confidence: 0.7,
        ..MemoryCandidateMutation::default()
    };
    let tool = MemoryCandidateMutation {
        source_type: "tool_observation".to_string(),
        confidence: 0.7,
        ..MemoryCandidateMutation::default()
    };
    assert_eq!(
        super::super::memory_stability_policy::stability_window_hours_for_mutation(&inferred),
        Some(72)
    );
    assert_eq!(
        super::super::memory_stability_policy::stability_window_hours_for_mutation(&tool),
        Some(36)
    );
}

#[test]
fn merge_candidate_writes_contradiction_relation() {
    let temp = tempdir().expect("tempdir");
    let target = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            fact: Some("Original preference".to_string()),
            confidence: Some(0.8),
            ..MemoryMutation::default()
        },
    )
    .expect("create target");
    let conflict = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            fact: Some("Conflicting preference".to_string()),
            confidence: Some(0.8),
            ..MemoryMutation::default()
        },
    )
    .expect("create conflict");
    let candidate = create_memory_candidate(
        temp.path(),
        MemoryCandidateMutation {
            fact: "Merged preference".to_string(),
            content: json!({ "fact": "Merged preference", "merged": true }),
            category: "preference".to_string(),
            scope: "global".to_string(),
            layer: Some(LAYER_SHARED.to_string()),
            value_class: Some(VALUE_SEMANTIC.to_string()),
            confidence: 0.9,
            source_type: "agent_inference".to_string(),
            proposed_action: "merge".to_string(),
            conflict_with: Some(conflict.id.clone()),
            target_id: Some(target.id.clone()),
            ..MemoryCandidateMutation::default()
        },
    )
    .expect("insert candidate");
    apply_memory_candidate(temp.path(), &candidate.id).expect("apply merge");
    let relations = list_long_term_memory(
        temp.path(),
        MemoryQuery {
            include_related: true,
            limit: 50,
            ..MemoryQuery::default()
        },
    )
    .expect("load memories");
    let related = relations
        .into_iter()
        .find(|record| record.id == target.id)
        .expect("target record");
    assert!(related.related_to.iter().any(|relation| {
        relation.target_id == conflict.id && relation.relation == "contradicts"
    }));
}

#[test]
fn revision_cas_rejects_stale_update() {
    let temp = tempdir().expect("tempdir");
    let record = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            fact: Some("Revision guarded".to_string()),
            confidence: Some(0.9),
            ..MemoryMutation::default()
        },
    )
    .expect("create");
    let error = update_long_term_memory(
        temp.path(),
        MemoryMutation {
            id: Some(record.id.clone()),
            fact: Some("Stale write".to_string()),
            revision: Some(0),
            ..MemoryMutation::default()
        },
    )
    .expect_err("stale revision");
    assert!(error.to_string().contains("revision conflict"));
}

#[test]
fn prompt_cache_rebuilds_from_injection_events() {
    let temp = tempdir().expect("tempdir");
    let record = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            fact: Some("Rebuild cache fact".to_string()),
            confidence: Some(0.9),
            ..MemoryMutation::default()
        },
    )
    .expect("create");
    let ranked = RankedMemoryRecord {
        record,
        score: 0.9,
        breakdown: MemoryScoreBreakdown::default(),
    };
    record_memory_injection(
        temp.path(),
        "session-rebuild",
        Some("turn-rebuild"),
        Some("cache rebuild"),
        &[ranked],
    )
    .expect("record injection");
    let rebuilt = rebuild_prompt_cache_from_injection_events(temp.path()).expect("rebuild");
    assert_eq!(rebuilt["rebuiltFromEvents"].as_u64(), Some(1));
}

#[test]
fn effective_policy_snapshot_includes_id() {
    let snapshot = build_effective_policy_snapshot(Some("session-1"), Some("turn-1"));
    assert_eq!(
        snapshot["policySnapshotId"].as_str(),
        Some("memory-policy-session-1-turn-1")
    );
    assert!(snapshot.get("permissionPolicy").is_some());
}

#[test]
fn derived_tenure_field_updates_from_start_date() {
    let mut content = json!({
        "kind": "start_date",
        "startDate": "2020-01-15"
    });
    apply_derived_fields_to_content(&mut content);
    assert!(content.get("derivedTenureYears").is_some());
}
