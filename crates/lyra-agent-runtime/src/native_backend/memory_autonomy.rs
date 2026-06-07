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
    let extraction = run_memory_agent_extraction(session_id, turn_id, user_text, assistant_text);
    let mutations = match extraction {
        Ok(mutations) => mutations,
        Err(error) => {
            return Ok(json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "agent": "memory",
                "skipped": true,
                "reason": error.to_string(),
                "candidates": [],
            }));
        }
    };
    for mutation in mutations {
        created.push(process_extracted_candidate(
            root, session_id, turn_id, mutation,
        )?);
    }
    Ok(json!({
        "sessionId": session_id,
        "turnId": turn_id,
        "agent": "memory",
        "candidates": created,
    }))
}

const MEMORY_AGENT_SYSTEM_PROMPT: &str = r#"You are Lyra's background memory maintenance agent.

You are not the main chat agent. You never use tools and never answer the user. Your only job is to inspect the just-finished turn and return compact JSON describing durable memory candidates.

Decide semantically whether the conversation contains useful long-term facts. Do not rely on fixed trigger phrases. Capture facts that would help future assistance, including identity, stable preferences, project decisions, working style, recurring constraints, user-owned contact details, and important project facts. Ignore transient task details, one-off commands, jokes, uncertain guesses, secrets, passwords, API keys, access tokens, and raw credentials.

Return only a JSON object:
{
  "candidates": [
    {
      "fact": "short durable fact",
      "category": "user_profile|preference|project|instruction|goal|other",
      "scope": "global|project",
      "confidence": 0.0,
      "sensitivity": "low|personal|sensitive",
      "sourceType": "user_declaration|memory_agent_inference",
      "requiresConfirmation": true,
      "content": {"kind":"brief_type","text":"fact or structured value"},
      "expiresAt": null
    }
  ]
}

Use requiresConfirmation=true for personal contact details, addresses, account identifiers, inferred facts, and anything the user did not explicitly ask Lyra to remember. Use sourceType=user_declaration only when the user clearly stated the fact. Keep at most 6 candidates."#;

fn run_memory_agent_extraction(
    session_id: &str,
    turn_id: &str,
    user_text: &str,
    assistant_text: Option<&str>,
) -> AgentRuntimeResult<Vec<MemoryCandidateMutation>> {
    if user_text.trim().is_empty() && assistant_text.is_none_or(|text| text.trim().is_empty()) {
        return Ok(Vec::new());
    }
    let (provider, model) = memory_agent_provider_and_model()?;
    let messages = vec![
        json!({
            "role": "system",
            "content": MEMORY_AGENT_SYSTEM_PROMPT,
        }),
        json!({
            "role": "user",
            "content": json!({
                "sessionId": session_id,
                "turnId": turn_id,
                "userMessage": user_text,
                "assistantMessage": assistant_text.unwrap_or_default(),
            }).to_string(),
        }),
    ];
    let reply = call_model_once_non_streaming(&provider, &model, &messages, &[])?;
    let content = reply
        .content
        .as_deref()
        .ok_or_else(|| AgentRuntimeError::Core("memory agent returned no content".to_string()))?;
    parse_memory_agent_candidates(session_id, turn_id, content)
}

fn memory_agent_provider_and_model() -> AgentRuntimeResult<(NativeProviderProfile, String)> {
    let state = state()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
    let provider_id = state
        .config
        .memory_agent_provider
        .as_ref()
        .or(state.config.default_provider.as_ref())
        .ok_or_else(|| {
            AgentRuntimeError::Core("memory agent provider is not configured".to_string())
        })?;
    let provider = state
        .config
        .providers
        .get(provider_id)
        .cloned()
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!("memory agent provider not found: {provider_id}"))
        })?;
    let model = state
        .config
        .memory_agent_model
        .clone()
        .or_else(|| provider.default_model.clone())
        .or_else(|| state.config.default_model.clone())
        .ok_or_else(|| {
            AgentRuntimeError::Core("memory agent model is not configured".to_string())
        })?;
    Ok((provider, model))
}

fn parse_memory_agent_candidates(
    session_id: &str,
    turn_id: &str,
    content: &str,
) -> AgentRuntimeResult<Vec<MemoryCandidateMutation>> {
    let value = parse_memory_agent_json(content)?;
    let candidates = value
        .get("candidates")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AgentRuntimeError::Core("memory agent JSON missing candidates array".to_string())
        })?;
    let source_ref = Some(format!("{session_id}:{turn_id}:memory_agent"));
    Ok(candidates
        .iter()
        .take(6)
        .filter_map(|candidate| memory_candidate_from_agent_json(candidate, source_ref.clone()))
        .collect())
}

fn parse_memory_agent_json(content: &str) -> AgentRuntimeResult<Value> {
    if let Ok(value) = serde_json::from_str::<Value>(content.trim()) {
        return Ok(value);
    }
    let start = content.find('{').ok_or_else(|| {
        AgentRuntimeError::Core("memory agent returned no JSON object".to_string())
    })?;
    let end = content.rfind('}').ok_or_else(|| {
        AgentRuntimeError::Core("memory agent returned incomplete JSON object".to_string())
    })?;
    if end < start {
        return Err(AgentRuntimeError::Core(
            "memory agent returned malformed JSON object".to_string(),
        ));
    }
    serde_json::from_str(&content[start..=end]).map_err(|error| {
        AgentRuntimeError::Core(format!("memory agent JSON parse failed: {error}"))
    })
}

fn memory_candidate_from_agent_json(
    candidate: &Value,
    source_ref: Option<String>,
) -> Option<MemoryCandidateMutation> {
    let fact = string_field(candidate, "fact")?;
    if fact.chars().count() < 4 {
        return None;
    }
    let category = normalize_memory_category(string_field(candidate, "category").as_deref());
    let scope = normalize_memory_scope(string_field(candidate, "scope").as_deref());
    let confidence = candidate
        .get("confidence")
        .and_then(Value::as_f64)
        .unwrap_or(0.7)
        .clamp(0.0, 1.0);
    let sensitivity = string_field(candidate, "sensitivity").unwrap_or_else(|| "low".to_string());
    let requires_confirmation = candidate
        .get("requiresConfirmation")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| sensitivity != "low");
    let source_type = match string_field(candidate, "sourceType").as_deref() {
        Some("user_declaration") if !requires_confirmation && sensitivity == "low" => {
            "user_declaration"
        }
        _ => "memory_agent_inference",
    }
    .to_string();
    let mut content = candidate
        .get("content")
        .cloned()
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({ "kind": "memory_agent_fact", "text": fact }));
    if let Value::Object(map) = &mut content {
        map.insert(
            "sensitivity".to_string(),
            Value::String(sensitivity.clone()),
        );
        map.insert(
            "requiresConfirmation".to_string(),
            Value::Bool(requires_confirmation),
        );
    }
    let status = requires_confirmation.then(|| "pending".to_string());
    Some(MemoryCandidateMutation {
        fact,
        content,
        category,
        scope,
        confidence,
        source_type,
        source_ref,
        proposed_action: "create".to_string(),
        status,
        expires_at: candidate
            .get("expiresAt")
            .and_then(Value::as_str)
            .map(str::to_string),
        ..MemoryCandidateMutation::default()
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn normalize_memory_category(value: Option<&str>) -> String {
    match value.unwrap_or("other") {
        "user_profile" | "preference" | "project" | "instruction" | "goal" | "other" => {
            value.unwrap_or("other").to_string()
        }
        _ => "other".to_string(),
    }
}

fn normalize_memory_scope(value: Option<&str>) -> String {
    match value {
        Some("project") => "project".to_string(),
        _ => "global".to_string(),
    }
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

pub(crate) fn process_extracted_candidate(
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
