use super::*;
use crate::native_backend::token_estimate::{estimate_message_tokens, estimate_messages_tokens};

fn large_message(id: &str, role: &str, chars: usize) -> Value {
    json!({
        "id": id,
        "role": role,
        "text": "x".repeat(chars),
        "createdAt": "2026-06-19T00:00:00.000Z"
    })
}

#[test]
fn apply_compression_replaces_messages_with_block_and_archives_to_cut_store() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().to_path_buf();
    let session_id = format!("session-compress-{}", Uuid::new_v4());

    // Build messages exceeding 30K tokens: 1 system + 20 user/assistant pairs.
    // BPE collapses repeated chars aggressively, so use large payloads (20K chars each).
    let mut messages = vec![large_message("msg-system", "system", 100)];
    for i in 1..=20 {
        messages.push(large_message(&format!("msg-user-{i}"), "user", 20_000));
        messages.push(large_message(
            &format!("msg-assistant-{i}"),
            "assistant",
            20_000,
        ));
    }

    let mut session = NativeSession {
        id: session_id.clone(),
        snapshot: json!({
            "id": session_id,
            "title": "Compress Test",
            "sessionKind": "normal",
            "workingDir": "/tmp",
            "projectBound": true,
            "workingDirIsHome": false,
            "turnStatus": "idle",
            "messages": messages.clone(),
            "updatedAt": "2026-06-19T00:00:00.000Z"
        }),
        created_at: "2026-06-19T00:00:00.000Z".to_string(),
        saved: false,
        save_label: None,
        archived: false,
        custom_title: None,
        short_name: None,
        runtime_turns: Vec::new(),
        rollback_checkpoints: Vec::new(),
        file_read_state: HashMap::new(),
        dirty: true,
        ephemeral: false,
    };
    save_session(&root, &session).expect("save session");

    // Simulate the input selection logic from spawn_extract_and_compress
    let candidates: Vec<(usize, Value)> = messages
        .iter()
        .enumerate()
        .skip(0) // compressed_up_to = 0
        .filter(|(_, msg)| {
            matches!(
                msg.get("role").and_then(Value::as_str),
                Some("user") | Some("assistant")
            )
        })
        .map(|(i, msg)| (i, msg.clone()))
        .collect();

    let mut selected: Vec<(usize, Value)> = Vec::new();
    let mut accumulated = 0usize;
    for (idx, msg) in &candidates {
        let msg_tokens = estimate_message_tokens(msg);
        if accumulated + msg_tokens > EXTRACT_INPUT_MAX && !selected.is_empty() {
            break;
        }
        accumulated += msg_tokens;
        selected.push((*idx, msg.clone()));
        if accumulated >= EXTRACT_INPUT_TARGET {
            break;
        }
    }
    assert!(!selected.is_empty(), "should have selected messages");

    let token_before = estimate_messages_tokens(&messages);
    assert!(
        token_before >= EXTRACT_COMPRESS_THRESHOLD,
        "session should exceed 30K tokens"
    );

    // Fixed LLM response (no TCP mock needed)
    let parsed = json!({
        "candidates": [],
        "compressedContext": {
            "summary": "Test compression summary for the conversation window.",
            "keyDecisions": ["decision1"],
            "projectState": "test state",
            "compressedMessageIds": [],
            "tokenEstimate": 100
        }
    });

    let turn_id = format!("turn-compress-{}", Uuid::new_v4());
    apply_compression_to_session(
        &mut session,
        &root,
        &session_id,
        &turn_id,
        &selected,
        &messages,
        &parsed,
    )
    .expect("apply compression");

    // Assert: compression block at head after system messages
    let msgs = session.snapshot["messages"]
        .as_array()
        .expect("messages array");

    let compression_idx = msgs
        .iter()
        .position(|m| {
            m.pointer("/metadata/kind").and_then(Value::as_str) == Some("compressed-context-block")
        })
        .expect("compression block found");

    let first_non_system = msgs
        .iter()
        .position(|m| m.get("role").and_then(Value::as_str) != Some("system"))
        .unwrap_or(msgs.len());
    assert!(
        compression_idx <= first_non_system,
        "compression block should be at head after system messages (idx {}, first non-system {})",
        compression_idx,
        first_non_system
    );

    // Assert: memoryCompression advanced
    let watermark_id = session
        .snapshot
        .pointer("/memoryCompression/compressedUpToMessageId")
        .and_then(Value::as_str)
        .expect("compressedUpToMessageId");
    assert!(
        !watermark_id.is_empty(),
        "compressedUpToMessageId should be set"
    );
    assert!(
        session
            .snapshot
            .pointer("/memoryCompression/compressionBlockId")
            .and_then(Value::as_str)
            == Some(watermark_id),
        "compressedUpToMessageId should match compressionBlockId"
    );

    // Assert: some original messages removed
    assert!(
        msgs.len() < 41,
        "some messages should have been compressed, got {}",
        msgs.len()
    );

    // Assert: cut_store has at least one pack
    let manifest = cut_store::load_manifest(&root, &session_id).expect("cut manifest");
    assert!(
        !manifest.packs.is_empty(),
        "cut_store should have archived at least one pack"
    );
}

#[test]
fn read_cut_messages_round_trips_archived_messages() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path().to_path_buf();
    let session_id = format!("session-read-cut-{}", Uuid::new_v4());

    let msg_a = json!({
        "id": "cut-msg-a",
        "role": "user",
        "text": "Hello from message A",
        "createdAt": "2026-06-19T00:00:00.000Z"
    });
    let msg_b = json!({
        "id": "cut-msg-b",
        "role": "assistant",
        "text": "Reply from message B",
        "createdAt": "2026-06-19T00:00:01.000Z"
    });
    let msg_c = json!({
        "id": "cut-msg-c",
        "role": "user",
        "text": "Follow-up from message C",
        "createdAt": "2026-06-19T00:00:02.000Z"
    });

    let entries = vec![
        cut_store::CutMessageEntry {
            message: msg_a.clone(),
            ordinal: 0,
        },
        cut_store::CutMessageEntry {
            message: msg_b.clone(),
            ordinal: 1,
        },
        cut_store::CutMessageEntry {
            message: msg_c.clone(),
            ordinal: 2,
        },
    ];
    let pack = cut_store::append_cut_pack(&root, &session_id, &entries).expect("append cut pack");
    cut_store::update_manifest_with_pack(&root, &session_id, &pack).expect("update manifest");

    // Read back two of three messages by ID
    let ids = vec!["cut-msg-b".to_string(), "cut-msg-c".to_string()];
    let result = cut_store::read_cut_messages(&root, &session_id, &ids).expect("read cut messages");
    assert_eq!(result.len(), 2, "should return exactly 2 messages");
    assert_eq!(result[0]["id"], "cut-msg-b");
    assert_eq!(result[0]["text"], "Reply from message B");
    assert_eq!(result[1]["id"], "cut-msg-c");
    assert_eq!(result[1]["text"], "Follow-up from message C");

    // Reading a non-existent ID returns only found messages
    let missing = vec!["cut-msg-a".to_string(), "no-such-msg".to_string()];
    let result2 = cut_store::read_cut_messages(&root, &session_id, &missing).expect("read partial");
    assert_eq!(result2.len(), 1, "should return only the found message");
    assert_eq!(result2[0]["id"], "cut-msg-a");

    // Empty ID list returns empty
    let empty = cut_store::read_cut_messages(&root, &session_id, &[]).expect("read empty");
    assert!(empty.is_empty());
}
