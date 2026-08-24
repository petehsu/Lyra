use super::super::*;
use tempfile::tempdir;

#[test]
fn retrieval_expansion_starts_with_project_scope() {
    let temp = tempdir().expect("tempdir");
    create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("project".to_string()),
            category: Some("project".to_string()),
            fact: Some("Lyra uses project scoped memory".to_string()),
            confidence: Some(0.9),
            ..MemoryMutation::default()
        },
    )
    .expect("create project memory");
    create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("other".to_string()),
            fact: Some("Lyra global fallback memory".to_string()),
            confidence: Some(0.9),
            ..MemoryMutation::default()
        },
    )
    .expect("create global memory");

    let ranked = expand_long_term_memory_injection(
        temp.path(),
        "Lyra project scoped memory",
        Some("/tmp/project"),
        4,
    )
    .expect("expand memory");
    assert!(ranked.iter().any(|entry| entry.record.scope == "project"));
}

#[test]
fn cut_pack_indexes_into_recall_as_cut_archive() {
    let temp = tempdir().expect("tempdir");
    let root = temp.path().to_path_buf();
    let session_id = "session-cut-recall";
    let entries = vec![cut_store::CutMessageEntry {
        message: json!({
            "id": "cut-msg-1",
            "role": "user",
            "text": "Archived cut pack message about Lyra memory",
            "createdAt": "2026-06-19T00:00:00.000Z"
        }),
        ordinal: 3,
    }];
    let pack = cut_store::append_cut_pack(&root, session_id, &entries).expect("append cut");
    index_cut_pack_for_recall(&root, session_id, &pack).expect("index cut recall");

    let recall = select_system_recall_for_injection(
        &root,
        Some(session_id),
        "Lyra memory archived cut",
        None,
        &[],
    )
    .expect("select recall");
    assert!(
        recall
            .iter()
            .any(|item| item.item.source_kind == "cut_archive")
    );
}

#[test]
fn memory_audit_export_writes_jsonl_and_markdown() {
    let temp = tempdir().expect("tempdir");
    create_long_term_memory(
        temp.path(),
        MemoryMutation {
            fact: Some("Export audit test memory".to_string()),
            confidence: Some(0.8),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");
    let result = export_memory_audit_snapshot(temp.path()).expect("export audit");
    let jsonl = result["jsonlPath"].as_str().expect("jsonl path");
    let md = result["markdownPath"].as_str().expect("md path");
    assert!(std::path::Path::new(jsonl).is_file());
    assert!(std::path::Path::new(md).is_file());
}
