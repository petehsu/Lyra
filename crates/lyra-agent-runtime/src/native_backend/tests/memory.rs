use super::*;

#[test]
fn memory_tool_persists_shared_memory_for_future_turns() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method("agent.session.create", json!({ "title": "Memory Test" }))
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-memory",
            "/tools/memory/remember",
            json!({
                "scope": "global",
                "category": "user_profile",
                "fact": "The user prefers to be called Xu Yuanhao."
            }),
        ),
    );

    assert!(output["content"].as_str().unwrap().contains("Xu Yuanhao"));
    assert!(
        output["changes"]
            .as_array()
            .is_some_and(|changes| changes.iter().any(|change| {
                change["kind"] == "memory"
                    && change["operation"] == "remember"
                    && change["path"] == "/tools/memory/remember"
            }))
    );
    let request = build_model_request(&session_id).expect("model request");
    let system_prompt = request.messages[0]["content"]
        .as_str()
        .expect("system prompt");
    assert!(system_prompt.contains("Xu Yuanhao"));
}

#[test]
fn long_term_memory_crud_list_link_forget_and_audit() {
    let backend = LyraAgentBackend;
    let marker = Uuid::new_v4().to_string();
    let first = backend
        .call_agent_method(
            "agent.memory.longterm.create",
            json!({
                "scope": "global",
                "category": "preference",
                "fact": format!("phase one memory preference {marker}"),
                "confidence": 1.0,
                "sourceType": "user_declaration",
                "tags": ["phase-one", marker.clone()]
            }),
        )
        .expect("create first memory");
    let first_id = first["record"]["id"]
        .as_str()
        .expect("first id")
        .to_string();
    let second = backend
        .call_agent_method(
            "agent.memory.longterm.create",
            json!({
                "scope": "project",
                "category": "project",
                "fact": format!("phase one project memory {marker}"),
                "confidence": 0.9,
                "sourceType": "project_fact"
            }),
        )
        .expect("create second memory");
    let second_id = second["record"]["id"]
        .as_str()
        .expect("second id")
        .to_string();

    let search = backend
        .call_agent_method(
            "agent.memory.longterm.search",
            json!({ "query": marker, "limit": 10 }),
        )
        .expect("search memories");
    assert!(search["records"].as_array().expect("records").len() >= 2);
    assert_eq!(search["records"][0]["accessCount"], 1);

    let updated = backend
        .call_agent_method(
            "agent.memory.longterm.update",
            json!({
                "id": first_id,
                "fact": format!("phase one updated preference {marker}"),
                "status": "superseded",
                "supersededBy": second_id,
            }),
        )
        .expect("update memory");
    assert_eq!(updated["record"]["status"], "superseded");

    let linked = backend
        .call_agent_method(
            "agent.memory.longterm.link",
            json!({
                "sourceId": updated["record"]["id"],
                "targetId": second["record"]["id"],
                "relation": "related_to",
                "confidence": 0.8,
            }),
        )
        .expect("link memories");
    assert_eq!(linked["relation"]["relation"], "related_to");

    let listed = backend
        .call_agent_method(
            "agent.memory.longterm.list",
            json!({ "includeArchived": true, "query": marker, "limit": 20 }),
        )
        .expect("list memories");
    assert!(listed["records"].as_array().expect("records").len() >= 2);

    let forgotten = backend
        .call_agent_method(
            "agent.memory.longterm.forget",
            json!({ "id": second_id, "mode": "archive", "reason": "test cleanup" }),
        )
        .expect("forget memory");
    assert_eq!(forgotten["result"]["mode"], "archive");

    let audit = backend
        .call_agent_method("agent.memory.audit", json!({}))
        .expect("memory audit");
    assert!(
        audit
            .pointer("/longTermMemory/counts/total")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            >= 2
    );
    assert!(
        audit
            .pointer("/longTermMemory/relations/byType/related_to")
            .and_then(Value::as_i64)
            .unwrap_or(0)
            >= 1
    );

    let cleanup = backend
        .call_agent_method(
            "agent.memory.longterm.cleanupCandidates",
            json!({ "limit": 500 }),
        )
        .expect("cleanup candidates");
    assert!(cleanup["candidates"].as_array().is_some_and(|candidates| {
        candidates.iter().any(|candidate| {
            candidate.pointer("/record/id").and_then(Value::as_str)
                == updated.pointer("/record/id").and_then(Value::as_str)
        })
    }));

    let batch_forget = backend
        .call_agent_method(
            "agent.memory.longterm.forget",
            json!({
                "ids": [updated["record"]["id"].as_str().expect("updated id")],
                "mode": "archive",
                "reason": "batch cleanup test"
            }),
        )
        .expect("batch forget");
    assert_eq!(batch_forget.pointer("/result/count"), Some(&json!(1)));
}

#[test]
fn memory_tool_activity_does_not_commit_memory_events_as_chat_messages() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Memory Activity Isolation" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let turn_id = start_test_runtime_turn(&session_id);
    let marker = Uuid::new_v4().to_string();

    let output = execute_model_tool(
        &session_id,
        &turn_id,
        &None,
        &Arc::new(AtomicBool::new(false)),
        tool_fs_run_call(
            "tool-memory-isolation",
            "/tools/memory/remember",
            json!({
                "scope": "global",
                "category": "other",
                "fact": format!("memory isolation fact {marker}")
            }),
        ),
    );

    assert!(output["content"].as_str().unwrap().contains(&marker));
    let state = state().lock().expect("state lock");
    let session = state.sessions.get(&session_id).expect("session");
    assert!(
        session
            .snapshot
            .get("messages")
            .and_then(Value::as_array)
            .is_none_or(Vec::is_empty)
    );
    assert!(
        session
            .snapshot
            .get("tools")
            .and_then(Value::as_array)
            .is_some_and(|tools| tools.iter().any(|tool| tool["name"] == "memory"))
    );
}

#[test]
fn legacy_shared_memory_migration_is_idempotent_and_state_json_drops_array() {
    let temp = tempfile::tempdir().expect("tempdir");
    let timestamp = now();
    let legacy = SharedMemoryRecord {
        id: format!("legacy-memory-{}", Uuid::new_v4()),
        scope: "global".to_string(),
        content: json!({
            "fact": "legacy shared memory migrated",
            "category": "user_profile",
            "source": "user_declaration"
        }),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        status: "active".to_string(),
        priority: 82,
        injection_count: 7,
        last_injected_at: Some(now()),
        category: Some("user_profile".to_string()),
        confidence: Some(1.0),
        source: Some("user_declaration".to_string()),
    };

    let first =
        migrate_legacy_shared_memory(temp.path(), std::slice::from_ref(&legacy)).expect("migrate");
    let second = migrate_legacy_shared_memory(temp.path(), std::slice::from_ref(&legacy))
        .expect("migrate again");
    assert_eq!(first["inserted"], 1);
    assert_eq!(second["inserted"], 0);

    let records = list_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some("legacy shared memory migrated".to_string()),
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("list migrated memory");
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].access_count, 7);

    let state_file = NativeStateFile {
        tool_runtime_schema_version: TOOL_RUNTIME_SCHEMA_VERSION,
        tool_runtime_migration_diagnostics: Vec::new(),
        tool_usage_cache: HashMap::new(),
        active_session_id: None,
        config: NativeConfig::default(),
        legacy_shared_memory: vec![legacy],
        active_skills: HashSet::new(),
        overnight_runs: HashMap::new(),
        pending_permissions: HashMap::new(),
        pending_clarifications: HashMap::new(),
        goals: HashMap::new(),
        focused_goal_id: None,
    };
    let serialized = serde_json::to_string(&state_file).expect("state json");
    assert!(!serialized.contains("sharedMemory"));
}

#[test]
fn memory_search_uses_hybrid_ranker_and_updates_access_stats() {
    let temp = tempfile::tempdir().expect("tempdir");
    let marker = format!("phase2-search-{}", Uuid::new_v4());
    let created = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("preference".to_string()),
            fact: Some(format!(
                "The user prefers concise Chinese summaries for Lyra architecture reviews {marker}"
            )),
            confidence: Some(1.0),
            source_type: Some("user_declaration".to_string()),
            tags: Some(vec!["phase2".to_string(), marker.clone()]),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");

    let conn = rusqlite::Connection::open(memory_store_path(temp.path())).expect("open memory db");
    conn.execute("DELETE FROM memory_fts WHERE memory_id = ?1", [&created.id])
        .expect("delete fts");
    conn.execute(
        "DELETE FROM memory_embeddings WHERE memory_id = ?1",
        [&created.id],
    )
    .expect("delete embedding");
    let rebuilt = rebuild_long_term_memory_index(temp.path()).expect("rebuild index");
    assert_eq!(rebuilt["ftsRecords"], 1);

    let results = search_ranked_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(format!(
                "How should Lyra architecture review summaries be written for the user {marker}"
            )),
            explain: true,
            touch_access: true,
            access_type: "tool_search".to_string(),
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("search memory");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].record.id, created.id);
    assert_eq!(results[0].record.access_count, 1);
    assert!(results[0].breakdown.final_score > 0.0);
    assert!(
        results[0]
            .breakdown
            .matched_by
            .iter()
            .any(|source| source == "fts" || source == "vector" || source == "metadata")
    );

    let rendered = ranked_memory_json(&results[0], true);
    assert!(rendered["score"].as_f64().unwrap_or(0.0) > 0.0);
    assert!(rendered.pointer("/scoreBreakdown/finalScore").is_some());
    assert!(rendered.pointer("/scoreBreakdown/decayPenalty").is_some());
}

#[test]
fn memory_decay_ranks_frequent_user_declarations_above_stale_low_confidence_records() {
    let temp = tempfile::tempdir().expect("tempdir");
    let marker = format!("phase2-decay-{}", Uuid::new_v4());
    let stale = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("other".to_string()),
            fact: Some(format!("temporary inferred operation note {marker}")),
            confidence: Some(0.42),
            source_type: Some("agent_inference".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create stale memory");
    let durable = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("user_profile".to_string()),
            fact: Some(format!("durable user declaration operation note {marker}")),
            confidence: Some(1.0),
            source_type: Some("user_declaration".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create durable memory");
    let old_timestamp =
        (Utc::now() - chrono::Duration::days(180)).to_rfc3339_opts(SecondsFormat::Secs, true);
    let conn = rusqlite::Connection::open(memory_store_path(temp.path())).expect("open memory db");
    conn.execute(
        "UPDATE memories SET updated_at = ?2, access_count = 0, last_accessed_at = NULL WHERE id = ?1",
        rusqlite::params![stale.id, old_timestamp],
    )
    .expect("age stale memory");
    conn.execute(
        "UPDATE memories SET updated_at = ?2, access_count = 50, last_accessed_at = ?2 WHERE id = ?1",
        rusqlite::params![durable.id, old_timestamp],
    )
    .expect("age durable memory");

    let results = search_ranked_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(marker.clone()),
            explain: true,
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("search memory");
    let durable_rank = results
        .iter()
        .position(|entry| entry.record.id == durable.id)
        .expect("durable result");
    let stale_rank = results
        .iter()
        .position(|entry| entry.record.id == stale.id)
        .expect("stale result");
    assert!(durable_rank < stale_rank);
    assert!(
        results[stale_rank].breakdown.decay_penalty > results[durable_rank].breakdown.decay_penalty
    );

    let candidates =
        cleanup_long_term_memory_candidates(temp.path(), 10).expect("cleanup candidates");
    assert!(candidates.iter().any(|candidate| {
        candidate.pointer("/record/id").and_then(Value::as_str) == Some(stale.id.as_str())
            && candidate["reasons"]
                .as_array()
                .is_some_and(|reasons| reasons.iter().any(|reason| reason == "low_confidence"))
    }));
}

#[test]
fn memory_graph_include_related_adds_one_hop_related_records_without_loops() {
    let temp = tempfile::tempdir().expect("tempdir");
    let marker = format!("phase2-graph-{}", Uuid::new_v4());
    let seed = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("project".to_string()),
            category: Some("project".to_string()),
            fact: Some(format!("Lyra browser capability decision seed {marker}")),
            confidence: Some(0.95),
            source_type: Some("project_fact".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create seed memory");
    let related = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("project".to_string()),
            category: Some("instruction".to_string()),
            fact: Some(
                "Use visible follow mode when browser automation is user-facing".to_string(),
            ),
            confidence: Some(0.9),
            source_type: Some("project_fact".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create related memory");
    link_long_term_memory(temp.path(), &seed.id, &related.id, "supports", 0.9)
        .expect("link seed to related");
    link_long_term_memory(temp.path(), &related.id, &seed.id, "related_to", 0.9)
        .expect("link related to seed");
    let conn = rusqlite::Connection::open(memory_store_path(temp.path())).expect("open memory db");
    conn.execute("DELETE FROM memory_embeddings", [])
        .expect("disable vector rows for graph assertion");

    let without_related = search_ranked_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(marker.clone()),
            include_related: false,
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("search without related");
    assert!(
        without_related
            .iter()
            .any(|entry| entry.record.id == seed.id)
    );
    if let Some(related_hit) = without_related
        .iter()
        .find(|entry| entry.record.id == related.id)
    {
        assert_eq!(related_hit.breakdown.graph_boost, 0.0);
        assert!(
            !related_hit
                .breakdown
                .matched_by
                .iter()
                .any(|source| source == "graph")
        );
    }

    let with_related = search_ranked_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(marker),
            include_related: true,
            explain: true,
            limit: 10,
            ..MemoryQuery::default()
        },
    )
    .expect("search with related");
    let related_hit = with_related
        .iter()
        .find(|entry| entry.record.id == related.id)
        .expect("related memory returned");
    assert!(related_hit.breakdown.graph_boost > 0.0);
    assert!(
        related_hit
            .breakdown
            .matched_by
            .iter()
            .any(|source| source == "graph")
    );
    assert_eq!(
        with_related
            .iter()
            .filter(|entry| entry.record.id == seed.id)
            .count(),
        1
    );
}

#[test]
fn memory_search_uses_fts_and_lazily_repairs_missing_embedding_rows() {
    let temp = tempfile::tempdir().expect("tempdir");
    let marker = format!("phase2-fts-only-{}", Uuid::new_v4());
    let created = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("instruction".to_string()),
            fact: Some(format!("FTS fallback must retrieve this memory {marker}")),
            confidence: Some(0.9),
            source_type: Some("user_declaration".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");
    let conn = rusqlite::Connection::open(memory_store_path(temp.path())).expect("open memory db");
    conn.execute("DELETE FROM memory_embeddings", [])
        .expect("remove embeddings");

    let results = search_ranked_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some(marker),
            explain: true,
            limit: 5,
            ..MemoryQuery::default()
        },
    )
    .expect("fts-only search");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].record.id, created.id);
    assert!(results[0].breakdown.fts_score > 0.0);
    assert!(results[0].breakdown.vector_score >= 0.0);
    let repaired_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM memory_embeddings", [], |row| {
            row.get(0)
        })
        .expect("embedding count");
    assert_eq!(repaired_count, 1);
}

#[test]
fn memory_extraction_uses_background_memory_agent_without_tools() {
    let temp = tempfile::tempdir().expect("tempdir");
    let session_id = format!("session-{}", Uuid::new_v4());
    let turn_id = format!("turn-{}", Uuid::new_v4());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind provider");
    let address = listener.local_addr().expect("provider address");
    let (request_tx, request_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept provider request");
        let request = read_http_json_body(&mut stream);
        request_tx.send(request).expect("send provider request");
        let assistant_content = json!({
            "candidates": [{
                "fact": "用户的联系邮箱是 yuanhao@example.com",
                "category": "user_profile",
                "scope": "global",
                "confidence": 0.92,
                "sensitivity": "personal",
                "sourceType": "user_declaration",
                "requiresConfirmation": true,
                "content": {
                    "kind": "contact_email",
                    "email": "yuanhao@example.com"
                },
                "expiresAt": null
            }]
        })
        .to_string();
        let body = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": assistant_content
                }
            }]
        })
        .to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write provider response");
    });
    {
        let mut state = state().lock().expect("state lock");
        state.config.memory_agent_provider = Some("memory-agent-test".to_string());
        state.config.memory_agent_model = Some("memory-agent-model".to_string());
        state.config.providers.insert(
            "memory-agent-test".to_string(),
            NativeProviderProfile {
                id: "memory-agent-test".to_string(),
                label: "Memory Agent Test".to_string(),
                provider_type: "openai-compatible".to_string(),
                base_url: Some(format!("http://{address}/v1")),
                default_model: Some("memory-agent-model".to_string()),
                api_key: Some("test-key".to_string()),
                api_key_env: None,
                auth_header: None,
                embedding_model: None,
                models: vec![NativeProviderModel {
                    id: "memory-agent-model".to_string(),
                    label: None,
                    context_window: None,
                    supports_image_input: false,
                    supports_tool_calling: false,
                    supports_streaming: false,
                }],
            },
        );
    }
    let result = run_post_turn_memory_extraction(
        temp.path(),
        &session_id,
        &turn_id,
        "等会发我账单就行，我的邮箱是 yuanhao@example.com。",
        Some("好的。"),
    )
    .expect("extract memories");
    assert!(
        result["candidates"]
            .as_array()
            .is_some_and(|items| items.len() == 1)
    );
    let request = request_rx.recv().expect("provider request");
    assert_eq!(request["model"], "memory-agent-model");
    assert!(request["tools"].as_array().is_none_or(Vec::is_empty));

    let pending =
        list_memory_candidates(temp.path(), Some("pending"), 20).expect("pending candidates");
    let candidate = pending
        .iter()
        .find(|candidate| candidate.fact.contains("yuanhao@example.com"))
        .expect("email candidate");
    assert_eq!(candidate.category, "user_profile");
    assert_eq!(candidate.source_type, "memory_agent_inference");

    let memories = list_long_term_memory(
        temp.path(),
        MemoryQuery {
            query: Some("yuanhao@example.com".to_string()),
            include_archived: true,
            limit: 20,
            ..MemoryQuery::default()
        },
    )
    .expect("list memories");
    assert!(memories.is_empty());
}

#[test]
fn memory_conflict_auto_supersedes_low_confidence_and_confirms_high_confidence() {
    let temp = tempfile::tempdir().expect("tempdir");
    let low = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("preference".to_string()),
            fact: Some("用户偏好使用中文回复".to_string()),
            content: Some(json!({ "kind": "language_preference", "language": "中文" })),
            confidence: Some(0.6),
            source_type: Some("agent_inference".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create low confidence memory");
    let session_id = format!("session-{}", Uuid::new_v4());
    let turn_id = format!("turn-{}", Uuid::new_v4());
    process_extracted_candidate(
        temp.path(),
        &session_id,
        &turn_id,
        MemoryCandidateMutation {
            fact: "用户偏好使用英文回复".to_string(),
            content: json!({ "kind": "language_preference", "language": "英文" }),
            category: "preference".to_string(),
            scope: "global".to_string(),
            confidence: 1.0,
            source_type: "user_declaration".to_string(),
            source_ref: Some(format!("{session_id}:{turn_id}:memory_agent")),
            proposed_action: "create".to_string(),
            ..MemoryCandidateMutation::default()
        },
    )
    .expect("process conflict");
    let superseded = list_long_term_memory(
        temp.path(),
        MemoryQuery {
            status: Some("superseded".to_string()),
            include_archived: true,
            limit: 20,
            ..MemoryQuery::default()
        },
    )
    .expect("list superseded");
    assert!(superseded.iter().any(|record| record.id == low.id));

    let temp = tempfile::tempdir().expect("tempdir");
    let high = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("preference".to_string()),
            fact: Some("用户偏好使用中文回复".to_string()),
            content: Some(json!({ "kind": "language_preference", "language": "中文" })),
            confidence: Some(1.0),
            source_type: Some("user_declaration".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create high confidence memory");
    {
        let mut state = state().lock().expect("state lock");
        state.config.proactive_enabled = true;
        state
            .config
            .proactive_disabled_triggers
            .remove("memory_conflict");
    }
    process_extracted_candidate(
        temp.path(),
        &session_id,
        &turn_id,
        MemoryCandidateMutation {
            fact: "用户偏好使用英文回复".to_string(),
            content: json!({ "kind": "language_preference", "language": "英文" }),
            category: "preference".to_string(),
            scope: "global".to_string(),
            confidence: 1.0,
            source_type: "user_declaration".to_string(),
            source_ref: Some(format!("{session_id}:{turn_id}:memory_agent")),
            proposed_action: "create".to_string(),
            ..MemoryCandidateMutation::default()
        },
    )
    .expect("process high conflict");
    let candidates = list_memory_candidates(temp.path(), Some("needs_user_confirmation"), 20)
        .expect("review candidates");
    let candidate = candidates
        .iter()
        .find(|candidate| candidate.conflict_with.as_deref() == Some(high.id.as_str()))
        .expect("conflict candidate");
    let proactive =
        list_proactive_events(temp.path(), Some("pending"), 20).expect("proactive events");
    assert!(proactive.iter().any(|event| {
        event.trigger_type == "memory_conflict"
            && event.source.get("candidateId").and_then(Value::as_str)
                == Some(candidate.id.as_str())
    }));
    let applied = apply_memory_candidate(temp.path(), &candidate.id).expect("apply candidate");
    assert_eq!(applied.pointer("/result/action"), Some(&json!("supersede")));
}

#[test]
fn memory_explain_injection_records_ranked_long_term_memory_reasons() {
    let temp = tempfile::tempdir().expect("tempdir");
    create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("project".to_string()),
            fact: Some("Lyra memory injection should be explainable".to_string()),
            confidence: Some(0.9),
            source_type: Some("project_fact".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");
    let ranked = select_ranked_long_term_memory_for_injection(
        temp.path(),
        "explain Lyra memory injection",
        None,
        8,
    )
    .expect("rank injection");
    record_memory_injection(
        temp.path(),
        "session-explain",
        Some("turn-explain"),
        Some("explain Lyra memory injection"),
        &ranked,
    )
    .expect("record injection");
    let explanation =
        explain_memory_injection(temp.path(), "session-explain", Some("turn-explain"))
            .expect("explain injection");
    assert!(
        explanation["selected"]
            .as_array()
            .is_some_and(|items| !items.is_empty())
    );
    assert!(
        explanation
            .pointer("/selected/0/scoreBreakdown/finalScore")
            .is_some()
    );
}

#[test]
fn proactive_events_are_structured_dismissible_and_open_sessions_without_chat_pollution() {
    let backend = LyraAgentBackend;
    let root = state().lock().expect("state lock").root.clone();
    let event = create_proactive_event(
        &root,
        "memory_conflict",
        "Review memory conflict",
        "A memory candidate needs confirmation.",
        json!({ "candidateId": "candidate-test" }),
        "draft_message",
        None,
    )
    .expect("create proactive event");
    let listed = backend
        .call_agent_method("agent.proactive.list", json!({ "status": "pending" }))
        .expect("list proactive");
    assert!(listed["events"].as_array().is_some_and(|events| {
        events
            .iter()
            .any(|item| item.get("id").and_then(Value::as_str) == Some(event.id.as_str()))
    }));
    let opened = backend
        .call_agent_method("agent.proactive.openSession", json!({ "id": event.id }))
        .expect("open proactive session");
    assert_eq!(
        opened.pointer("/snapshot/sessionKind"),
        Some(&json!("proactive"))
    );
    assert!(
        opened
            .pointer("/snapshot/messages")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
    );
    assert_eq!(
        opened.pointer("/snapshot/proactiveMessages/0/role"),
        Some(&json!("proactive"))
    );

    let event = create_proactive_event(
        &root,
        "goal_due",
        "Goal due",
        "A goal is due.",
        json!({ "goalId": "goal-test" }),
        "notification_only",
        None,
    )
    .expect("create dismissible proactive event");
    let dismissed = backend
        .call_agent_method(
            "agent.proactive.dismiss",
            json!({ "id": event.id, "reason": "test complete" }),
        )
        .expect("dismiss proactive");
    assert_eq!(dismissed["status"], "dismissed");
}

#[test]
fn shared_memory_injection_rotates_records() {
    let now = now();
    let mut records = (0..6)
        .map(|index| LongTermMemoryRecord {
            id: format!("memory-{index}"),
            scope: "global".to_string(),
            category: "other".to_string(),
            fact: format!("rotation fact {index}"),
            content: json!({ "fact": format!("rotation fact {index}") }),
            confidence: 1.0,
            source_type: "agent_inference".to_string(),
            source_ref: Some("test".to_string()),
            created_at: now.clone(),
            updated_at: now.clone(),
            status: "active".to_string(),
            priority: 40,
            last_accessed_at: None,
            access_count: 0,
            tags: Vec::new(),
            related_to: Vec::new(),
            expires_at: None,
            supersedes: None,
            superseded_by: None,
        })
        .collect::<Vec<_>>();

    let first = select_shared_memory_for_injection(&mut records, "rotation", None, 3);
    let second = select_shared_memory_for_injection(&mut records, "rotation", None, 3);
    let first_ids = first
        .iter()
        .map(|record| record.id.as_str())
        .collect::<Vec<_>>();
    let second_ids = second
        .iter()
        .map(|record| record.id.as_str())
        .collect::<Vec<_>>();

    assert_ne!(first_ids, second_ids);
    assert!(
        records
            .iter()
            .take(3)
            .all(|record| record.access_count == 1)
    );
    assert!(
        records
            .iter()
            .skip(3)
            .all(|record| record.access_count == 1)
    );
}

#[test]
fn system_recall_selects_long_term_memory_with_source_markers() {
    let temp = tempfile::tempdir().expect("tempdir");
    let created = create_long_term_memory(
        temp.path(),
        MemoryMutation {
            scope: Some("global".to_string()),
            category: Some("user_profile".to_string()),
            fact: Some("用户的联系邮箱是 yuanhao@example.com".to_string()),
            content: Some(json!({ "kind": "contact_email", "email": "yuanhao@example.com" })),
            confidence: Some(0.95),
            source_type: Some("user_declaration".to_string()),
            ..MemoryMutation::default()
        },
    )
    .expect("create memory");

    let recall = select_system_recall_for_injection(
        temp.path(),
        "我的邮箱是什么",
        None,
        &[json!({ "role": "user", "text": "我的邮箱是什么" })],
    )
    .expect("select recall");

    assert_eq!(recall.len(), 1);
    assert_eq!(recall[0].item.source_kind, "long_term_memory");
    assert_eq!(recall[0].item.source_id, created.id);
    let rendered = system_recall_json(&recall);
    assert_eq!(
        rendered["records"][0]["systemRecalled"].as_bool(),
        Some(true)
    );
    assert_eq!(
        rendered["records"][0]["sourceKind"].as_str(),
        Some("long_term_memory")
    );
    assert!(
        rendered["records"][0]["content"]
            .as_str()
            .unwrap_or_default()
            .contains("yuanhao@example.com")
    );
}

#[test]
fn system_recall_indexes_session_messages_and_dedupes_current_context() {
    let temp = tempfile::tempdir().expect("tempdir");
    let mut old_session = new_session(Some("Old Session".to_string()), None, "normal");
    old_session.id = format!("session-{}", Uuid::new_v4());
    push_array(
        &mut old_session.snapshot,
        "messages",
        json!({
            "id": format!("message-{}", Uuid::new_v4()),
            "role": "user",
            "text": "我叫徐远豪",
            "createdAt": now()
        }),
    );
    index_session_messages_for_recall(temp.path(), &old_session).expect("index session");
    let rebuilt = rebuild_system_recall_index(temp.path(), &[old_session.clone()])
        .expect("rebuild recall index");
    assert_eq!(rebuilt["sessionItems"].as_u64(), Some(1));

    let recall = select_system_recall_for_injection(
        temp.path(),
        "我叫什么你还记得吗？",
        None,
        &[json!({ "role": "user", "text": "我叫什么你还记得吗？" })],
    )
    .expect("select recall");
    assert!(
        recall
            .iter()
            .any(|record| record.item.source_kind == "session_message"
                && record.item.text.contains("徐远豪"))
    );

    let duplicate = select_system_recall_for_injection(
        temp.path(),
        "我叫什么你还记得吗？",
        None,
        &[
            json!({ "role": "user", "text": "我叫徐远豪" }),
            json!({ "role": "user", "text": "我叫什么你还记得吗？" }),
        ],
    )
    .expect("select duplicate");
    assert!(duplicate.is_empty());
}

#[test]
fn system_recall_dedupes_repeated_session_facts() {
    let temp = tempfile::tempdir().expect("tempdir");
    for _ in 0..2 {
        let mut session = new_session(Some("Repeated Fact".to_string()), None, "normal");
        session.id = format!("session-{}", Uuid::new_v4());
        push_array(
            &mut session.snapshot,
            "messages",
            json!({
                "id": format!("message-{}", Uuid::new_v4()),
                "role": "user",
                "text": "我叫徐远豪",
                "createdAt": now()
            }),
        );
        index_session_messages_for_recall(temp.path(), &session).expect("index session");
    }

    let recall = select_system_recall_for_injection(
        temp.path(),
        "我叫什么",
        None,
        &[json!({ "role": "user", "text": "我叫什么" })],
    )
    .expect("select recall");
    let matching = recall
        .iter()
        .filter(|record| record.item.text.contains("徐远豪"))
        .count();
    assert_eq!(matching, 1);
}

#[test]
fn model_request_includes_system_recall_without_llm_lookup() {
    let backend = LyraAgentBackend;
    let created = backend
        .call_agent_method(
            "agent.session.create",
            json!({ "title": "Recall Request Test" }),
        )
        .expect("create session");
    let session_id = created["id"].as_str().expect("session id").to_string();
    let mut old_session = new_session(Some("Archived Identity".to_string()), None, "normal");
    old_session.id = format!("session-{}", Uuid::new_v4());
    push_array(
        &mut old_session.snapshot,
        "messages",
        json!({
            "id": format!("message-{}", Uuid::new_v4()),
            "role": "user",
            "text": "我叫徐远豪",
            "createdAt": now()
        }),
    );
    {
        let mut state = state().lock().expect("state lock");
        let root = state.root.clone();
        index_session_messages_for_recall(&root, &old_session).expect("index old session");
        let session = state.sessions.get_mut(&session_id).expect("session");
        push_array(
            &mut session.snapshot,
            "messages",
            json!({
                "id": format!("message-{}", Uuid::new_v4()),
                "role": "user",
                "text": "我叫什么你还记得吗？",
                "createdAt": now()
            }),
        );
        touch_session(session);
        state.save_state().expect("save state");
    }

    let request = build_model_request(&session_id).expect("model request");
    let system_prompt = request.messages[0]["content"]
        .as_str()
        .expect("system prompt");
    assert!(system_prompt.contains("System-recalled Lyra context"));
    assert!(system_prompt.contains("我叫徐远豪"));
}

#[test]
fn tool_retention_prunes_only_old_low_value_raw_payloads() {
    let mut session = new_session(Some("Retention Test".to_string()), None, "normal");
    let tools = (0..26)
        .map(|index| {
            let is_write = index == 0;
            json!({
                "id": format!("tool-{index}"),
                "name": if is_write { "file_write" } else { "file_read" },
                "label": if is_write { "Wrote file" } else { "Read file" },
                "status": "completed",
                "input": { "path": format!("file-{index}.txt") },
                "output": {
                    "content": "x".repeat(2_000),
                    "raw": {
                        "path": format!("file-{index}.txt"),
                        "data": "y".repeat(8_000)
                    }
                },
                "startedAt": "2026-05-30T00:00:00.000Z",
                "finishedAt": "2026-05-30T00:00:01.000Z"
            })
        })
        .collect::<Vec<_>>();
    session.snapshot["tools"] = Value::Array(tools);

    let metrics = prune_transient_tool_outputs(&mut session);
    let tools = session.snapshot["tools"].as_array().expect("tools");

    assert_eq!(metrics["pruned"], 1);
    assert!(tools[0].pointer("/output/raw/retention").is_none());
    assert_eq!(
        tools[1]
            .pointer("/output/raw/retention/policy")
            .and_then(Value::as_str),
        Some("old_transient_tool_raw_pruned")
    );
    assert!(tools[25].pointer("/output/raw/retention").is_none());
}
