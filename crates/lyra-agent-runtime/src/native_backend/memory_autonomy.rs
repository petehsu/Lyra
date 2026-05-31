use super::*;

pub(crate) fn spawn_post_turn_memory_extraction(
    root: PathBuf,
    session_id: String,
    turn_id: String,
    user_text: String,
    assistant_text: Option<String>,
) {
    thread::spawn(move || {
        let _ = run_post_turn_memory_extraction(
            &root,
            &session_id,
            &turn_id,
            &user_text,
            assistant_text.as_deref(),
        );
    });
}

pub(crate) fn run_post_turn_memory_extraction(
    root: &Path,
    session_id: &str,
    turn_id: &str,
    user_text: &str,
    assistant_text: Option<&str>,
) -> AgentRuntimeResult<Value> {
    let mut created = Vec::new();
    for mutation in extract_user_memory_candidates(session_id, turn_id, user_text) {
        created.push(process_extracted_candidate(
            root, session_id, turn_id, mutation,
        )?);
    }
    if let Some(assistant_text) = assistant_text {
        for mutation in extract_agent_inference_candidates(session_id, turn_id, assistant_text) {
            created.push(process_extracted_candidate(
                root, session_id, turn_id, mutation,
            )?);
        }
    }
    Ok(json!({
        "sessionId": session_id,
        "turnId": turn_id,
        "candidates": created,
    }))
}

pub(crate) fn memory_review_candidates(payload: Value) -> AgentRuntimeResult<Value> {
    let root = runtime_root_for_memory()?;
    let status = string_opt(&payload, "status").or_else(|| Some("pending".to_string()));
    let limit = payload
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .min(500) as usize;
    let candidates = list_memory_candidates(&root, status.as_deref(), limit)?
        .iter()
        .map(memory_candidate_json)
        .collect::<Vec<_>>();
    Ok(json!({ "candidates": candidates }))
}

pub(crate) fn memory_apply_candidate(payload: Value) -> AgentRuntimeResult<Value> {
    let root = runtime_root_for_memory()?;
    let id = string_opt(&payload, "id")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentRuntimeError::Core("memory candidate id is required".to_string()))?;
    apply_memory_candidate(&root, &id)
}

pub(crate) fn memory_reject_candidate(payload: Value) -> AgentRuntimeResult<Value> {
    let root = runtime_root_for_memory()?;
    let id = string_opt(&payload, "id")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentRuntimeError::Core("memory candidate id is required".to_string()))?;
    reject_memory_candidate(&root, &id, string_opt(&payload, "reason").as_deref())
}

pub(crate) fn memory_explain_injection(payload: Value) -> AgentRuntimeResult<Value> {
    let root = runtime_root_for_memory()?;
    let session_id = string_opt(&payload, "sessionId").or_else(|| {
        state()
            .lock()
            .ok()
            .and_then(|state| state.active_session_id.clone())
    });
    let session_id = session_id
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentRuntimeError::Core("sessionId is required".to_string()))?;
    let turn_id = string_opt(&payload, "turnId");
    explain_memory_injection(&root, &session_id, turn_id.as_deref())
}

pub(crate) fn proactive_trigger_registry() -> Value {
    json!({
        "triggers": [
            { "type": "goal_due", "defaultMode": "notification_only" },
            { "type": "overnight_complete", "defaultMode": "notification_only" },
            { "type": "memory_conflict", "defaultMode": "draft_message" },
            { "type": "long_task_blocked", "defaultMode": "draft_message" },
            { "type": "scheduled_reminder", "defaultMode": "notification_only" },
            { "type": "project_state_changed", "defaultMode": "notification_only" },
            { "type": "memory_review", "defaultMode": "notification_only" }
        ]
    })
}

pub(crate) fn proactive_list(payload: Value) -> AgentRuntimeResult<Value> {
    let (root, enabled, disabled) = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        (
            state.root.clone(),
            state.config.proactive_enabled,
            state.config.proactive_disabled_triggers.clone(),
        )
    };
    if enabled {
        ensure_state_proactive_triggers(&root, &disabled)?;
    }
    let status = string_opt(&payload, "status").or_else(|| Some("pending".to_string()));
    let limit = payload
        .get("limit")
        .and_then(Value::as_u64)
        .unwrap_or(50)
        .min(500) as usize;
    let events = list_proactive_events(&root, status.as_deref(), limit)?
        .iter()
        .map(proactive_event_json)
        .collect::<Vec<_>>();
    Ok(json!({
        "enabled": enabled,
        "disabledTriggers": disabled,
        "registry": proactive_trigger_registry(),
        "events": events,
    }))
}

pub(crate) fn proactive_dismiss(payload: Value) -> AgentRuntimeResult<Value> {
    let root = runtime_root_for_memory()?;
    let id = string_opt(&payload, "id")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentRuntimeError::Core("proactive event id is required".to_string()))?;
    dismiss_proactive_event(&root, &id, string_opt(&payload, "reason").as_deref())
}

pub(crate) fn proactive_open_session(payload: Value) -> AgentRuntimeResult<Value> {
    let event_id = string_opt(&payload, "id")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| AgentRuntimeError::Core("proactive event id is required".to_string()))?;
    let (root, event) = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let root = state.root.clone();
        let event = list_proactive_events(&root, None, 500)?
            .into_iter()
            .find(|event| event.id == event_id)
            .ok_or_else(|| {
                AgentRuntimeError::Core(format!("proactive event not found: {event_id}"))
            })?;
        (root, event)
    };
    let mut session = new_session(Some(event.title.clone()), None, "proactive");
    session.snapshot["proactive"] = json!({
        "eventId": event.id,
        "triggerType": event.trigger_type,
        "reason": event.reason,
        "source": event.source,
        "role": "proactive",
    });
    session.snapshot["proactiveMessages"] = json!([{
        "id": format!("proactive-message-{}", Uuid::new_v4()),
        "role": "proactive",
        "title": event.title,
        "reason": event.reason,
        "source": event.source,
        "createdAt": now(),
    }]);
    let snapshot = session.snapshot.clone();
    let session_id = session.id.clone();
    let callback = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        state.active_session_id = Some(session_id.clone());
        state.sessions.insert(session_id.clone(), session);
        state.save_state()?;
        state.event_callback.clone()
    };
    let opened = mark_proactive_event_opened(&root, &event_id, &session_id)?;
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );
    Ok(json!({
        "sessionId": session_id,
        "event": proactive_event_json(&opened),
        "snapshot": snapshot,
    }))
}

fn process_extracted_candidate(
    root: &Path,
    session_id: &str,
    turn_id: &str,
    mut mutation: MemoryCandidateMutation,
) -> AgentRuntimeResult<Value> {
    let related = search_ranked_long_term_memory(
        root,
        MemoryQuery {
            query: Some(mutation.fact.clone()),
            scope: Some(mutation.scope.clone()),
            category: Some(mutation.category.clone()),
            include_related: true,
            limit: 8,
            ..MemoryQuery::default()
        },
    )?;
    let conflict = related
        .iter()
        .find(|entry| memory_candidate_conflicts(&mutation, &entry.record))
        .map(|entry| entry.record.clone());

    if let Some(conflict) = conflict {
        mutation.conflict_with = Some(conflict.id.clone());
        mutation.target_id = Some(conflict.id.clone());
        mutation.proposed_action = "supersede".to_string();
        if mutation.source_type == "user_declaration"
            && mutation.confidence >= 0.95
            && conflict.confidence < 0.95
        {
            mutation.status = Some("auto_applied".to_string());
            let candidate = create_memory_candidate(root, mutation.clone())?;
            let record = create_long_term_memory(
                root,
                MemoryMutation {
                    scope: Some(mutation.scope),
                    category: Some(mutation.category),
                    fact: Some(mutation.fact),
                    content: Some(mutation.content),
                    confidence: Some(mutation.confidence),
                    source_type: Some("user_declaration".to_string()),
                    source_ref: mutation.source_ref,
                    status: Some("active".to_string()),
                    supersedes: Some(conflict.id.clone()),
                    ..MemoryMutation::default()
                },
            )?;
            let old = update_long_term_memory(
                root,
                MemoryMutation {
                    id: Some(conflict.id.clone()),
                    status: Some("superseded".to_string()),
                    superseded_by: Some(record.id.clone()),
                    ..MemoryMutation::default()
                },
            )?;
            link_long_term_memory(root, &record.id, &old.id, "supersedes", 1.0)?;
            return Ok(json!({
                "candidate": memory_candidate_json(&candidate),
                "autoApplied": true,
                "record": memory_record_json(&record),
                "superseded": memory_summary_json(&old),
            }));
        }

        mutation.status = Some("needs_user_confirmation".to_string());
        let candidate = create_memory_candidate(root, mutation)?;
        let _ = link_long_term_memory(root, &conflict.id, &conflict.id, "contradicts", 0.5).ok();
        create_memory_conflict_clarification(session_id, turn_id, &candidate, &conflict);
        if proactive_enabled_for("memory_conflict") {
            let _ = create_proactive_event(
                root,
                "memory_conflict",
                "Memory conflict needs review",
                "A newly extracted memory conflicts with an existing durable memory.",
                json!({ "candidateId": candidate.id, "conflictWith": conflict.id }),
                "draft_message",
                Some(session_id),
            );
        }
        return Ok(json!({
            "candidate": memory_candidate_json(&candidate),
            "needsUserConfirmation": true,
            "conflictWith": memory_summary_json(&conflict),
        }));
    }

    if mutation.source_type == "user_declaration" && mutation.confidence >= 0.95 {
        mutation.status = Some("auto_applied".to_string());
        let candidate = create_memory_candidate(root, mutation.clone())?;
        let record = create_long_term_memory(
            root,
            MemoryMutation {
                scope: Some(mutation.scope),
                category: Some(mutation.category),
                fact: Some(mutation.fact),
                content: Some(mutation.content),
                confidence: Some(mutation.confidence),
                source_type: Some("user_declaration".to_string()),
                source_ref: mutation.source_ref,
                status: Some("active".to_string()),
                ..MemoryMutation::default()
            },
        )?;
        return Ok(json!({
            "candidate": memory_candidate_json(&candidate),
            "autoApplied": true,
            "record": memory_record_json(&record),
        }));
    }

    let candidate = create_memory_candidate(root, mutation)?;
    Ok(json!({ "candidate": memory_candidate_json(&candidate), "autoApplied": false }))
}

fn create_memory_conflict_clarification(
    session_id: &str,
    turn_id: &str,
    candidate: &MemoryCandidate,
    conflict: &LongTermMemoryRecord,
) {
    if let Ok(mut state) = state().lock() {
        let id = format!("clarification-{}", Uuid::new_v4());
        state.pending_clarifications.insert(
            id.clone(),
            ClarificationRequest {
                id,
                session_id: session_id.to_string(),
                turn_id: turn_id.to_string(),
                tool_call_id: format!("memory-conflict-{}", candidate.id),
                question: "Lyra found a possible memory conflict. Should it update the old memory?"
                    .to_string(),
                options: vec![
                    json!({
                        "label": "Update memory",
                        "value": "apply_candidate",
                        "candidateId": candidate.id,
                        "conflictWith": conflict.id,
                    }),
                    json!({
                        "label": "Keep old memory",
                        "value": "reject_candidate",
                        "candidateId": candidate.id,
                    }),
                ],
                allow_custom_answer: true,
                detail: Some(format!("Old: {}\nNew: {}", conflict.fact, candidate.fact)),
                status: "pending".to_string(),
                answer: None,
                selected_option: None,
                created_at: now(),
                responded_at: None,
            },
        );
        let _ = state.save_state();
    }
}

fn proactive_enabled_for(trigger_type: &str) -> bool {
    state()
        .lock()
        .map(|state| {
            state.config.proactive_enabled
                && !state
                    .config
                    .proactive_disabled_triggers
                    .contains(trigger_type)
        })
        .unwrap_or(true)
}

fn extract_user_memory_candidates(
    session_id: &str,
    turn_id: &str,
    user_text: &str,
) -> Vec<MemoryCandidateMutation> {
    let mut candidates = Vec::new();
    let source_ref = Some(format!("{session_id}:{turn_id}:user"));
    if let Some(name) = extract_name(user_text) {
        candidates.push(MemoryCandidateMutation {
            fact: format!("用户的名字是{name}"),
            content: json!({ "kind": "identity", "name": name }),
            category: "user_profile".to_string(),
            scope: "global".to_string(),
            confidence: 1.0,
            source_type: "user_declaration".to_string(),
            source_ref: source_ref.clone(),
            proposed_action: "create".to_string(),
            ..MemoryCandidateMutation::default()
        });
    }
    if let Some(language) = extract_language_preference(user_text) {
        candidates.push(MemoryCandidateMutation {
            fact: format!("用户偏好使用{language}回复"),
            content: json!({ "kind": "language_preference", "language": language }),
            category: "preference".to_string(),
            scope: "global".to_string(),
            confidence: 1.0,
            source_type: "user_declaration".to_string(),
            source_ref: source_ref.clone(),
            proposed_action: "create".to_string(),
            ..MemoryCandidateMutation::default()
        });
    }
    if let Some(preference) = extract_general_preference(user_text) {
        candidates.push(MemoryCandidateMutation {
            fact: preference.clone(),
            content: json!({ "kind": "preference", "text": preference }),
            category: "preference".to_string(),
            scope: "global".to_string(),
            confidence: 0.95,
            source_type: "user_declaration".to_string(),
            source_ref: source_ref.clone(),
            proposed_action: "create".to_string(),
            ..MemoryCandidateMutation::default()
        });
    }
    if let Some(decision) = extract_project_decision(user_text) {
        candidates.push(MemoryCandidateMutation {
            fact: decision.clone(),
            content: json!({ "kind": "project_decision", "text": decision }),
            category: "project".to_string(),
            scope: "project".to_string(),
            confidence: 0.9,
            source_type: "project_fact".to_string(),
            source_ref,
            proposed_action: "create".to_string(),
            ..MemoryCandidateMutation::default()
        });
    }
    candidates
}

fn extract_agent_inference_candidates(
    session_id: &str,
    turn_id: &str,
    assistant_text: &str,
) -> Vec<MemoryCandidateMutation> {
    let lower = assistant_text.to_lowercase();
    if !(lower.contains("i infer") || lower.contains("it seems") || assistant_text.contains("推断"))
    {
        return Vec::new();
    }
    let fact = sentence_prefix(assistant_text, 160);
    if fact.trim().is_empty() {
        return Vec::new();
    }
    vec![MemoryCandidateMutation {
        fact: fact.clone(),
        content: json!({ "kind": "agent_inference", "text": fact }),
        category: "other".to_string(),
        scope: "global".to_string(),
        confidence: 0.55,
        source_type: "agent_inference".to_string(),
        source_ref: Some(format!("{session_id}:{turn_id}:assistant")),
        proposed_action: "create".to_string(),
        status: Some("pending".to_string()),
        ..MemoryCandidateMutation::default()
    }]
}

fn memory_candidate_conflicts(
    candidate: &MemoryCandidateMutation,
    record: &LongTermMemoryRecord,
) -> bool {
    if record.status != "active"
        || record.scope != candidate.scope
        || record.category != candidate.category
    {
        return false;
    }
    match candidate.category.as_str() {
        "preference" => {
            preference_key(&candidate.content)
                .is_some_and(|key| preference_key(&record.content).as_deref() == Some(key.as_str()))
                && normalized_fact(&candidate.fact) != normalized_fact(&record.fact)
        }
        "user_profile" => {
            candidate
                .content
                .get("kind")
                .and_then(Value::as_str)
                .is_some_and(|kind| {
                    record.content.get("kind").and_then(Value::as_str) == Some(kind)
                })
                && normalized_fact(&candidate.fact) != normalized_fact(&record.fact)
        }
        _ => false,
    }
}

fn preference_key(content: &Value) -> Option<String> {
    content
        .get("kind")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn normalized_fact(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn extract_name(text: &str) -> Option<String> {
    for marker in ["我的名字是", "我叫", "叫我", "my name is", "call me"] {
        if let Some(index) = text.to_lowercase().find(marker) {
            let start = index + marker.len();
            let candidate = take_until_boundary(&text[start..], 32);
            if !candidate.is_empty() {
                return Some(candidate);
            }
        }
    }
    None
}

fn extract_language_preference(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    if text.contains("以后用英文")
        || text.contains("用英文回复")
        || lower.contains("reply in english")
    {
        return Some("英文".to_string());
    }
    if text.contains("以后用中文")
        || text.contains("用中文回复")
        || lower.contains("reply in chinese")
    {
        return Some("中文".to_string());
    }
    None
}

fn extract_general_preference(text: &str) -> Option<String> {
    for marker in ["我希望", "我偏好", "我喜欢", "I prefer", "I want"] {
        if let Some(index) = text.find(marker) {
            let value = sentence_prefix(&text[index..], 160);
            if value.chars().count() >= 8 {
                return Some(value);
            }
        }
    }
    None
}

fn extract_project_decision(text: &str) -> Option<String> {
    let mentions_project = text.contains("Lyra") || text.contains("项目") || text.contains("架构");
    let decision = text.contains("决定")
        || text.contains("方案")
        || text.contains("协议")
        || text.to_lowercase().contains("we will");
    if mentions_project && decision {
        return Some(sentence_prefix(text, 220));
    }
    None
}

fn take_until_boundary(text: &str, max_chars: usize) -> String {
    text.trim_start()
        .chars()
        .take_while(|character| !matches!(character, '。' | '，' | ',' | '.' | '\n' | ';' | '；'))
        .take(max_chars)
        .collect::<String>()
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn sentence_prefix(text: &str, max_chars: usize) -> String {
    text.trim()
        .chars()
        .take(max_chars)
        .collect::<String>()
        .trim()
        .to_string()
}

fn ensure_state_proactive_triggers(
    root: &Path,
    disabled: &HashSet<String>,
) -> AgentRuntimeResult<()> {
    if !disabled.contains("goal_due") {
        let goals = state()
            .lock()
            .ok()
            .map(|state| state.goals.values().cloned().collect::<Vec<_>>())
            .unwrap_or_default();
        let existing = list_proactive_events(root, None, 500)?;
        for goal in goals {
            if !matches!(goal.status.as_str(), "due" | "overdue") {
                continue;
            }
            let already_exists = existing.iter().any(|event| {
                event.trigger_type == "goal_due"
                    && event.source.get("goalId").and_then(Value::as_str) == Some(goal.id.as_str())
            });
            if !already_exists {
                let _ = create_proactive_event(
                    root,
                    "goal_due",
                    &format!("Goal needs attention: {}", goal.title),
                    "A Lyra goal is due or overdue.",
                    json!({ "goalId": goal.id, "status": goal.status }),
                    "notification_only",
                    goal.session_id.as_deref(),
                );
            }
        }
    }
    if !disabled.contains("overnight_complete") {
        let runs = state()
            .lock()
            .ok()
            .map(|state| state.overnight_runs.clone())
            .unwrap_or_default();
        let existing = list_proactive_events(root, None, 500)?;
        for (run_id, run) in runs {
            if run.get("status").and_then(Value::as_str) != Some("completed") {
                continue;
            }
            let already_exists = existing.iter().any(|event| {
                event.trigger_type == "overnight_complete"
                    && event.source.get("runId").and_then(Value::as_str) == Some(run_id.as_str())
            });
            if !already_exists {
                let _ = create_proactive_event(
                    root,
                    "overnight_complete",
                    "Overnight task completed",
                    "A background Lyra task finished and is ready for review.",
                    json!({ "runId": run_id }),
                    "notification_only",
                    run.get("sessionId").and_then(Value::as_str),
                );
            }
        }
    }
    Ok(())
}
