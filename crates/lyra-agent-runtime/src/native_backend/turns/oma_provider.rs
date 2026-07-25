use std::{future::Future, pin::Pin};

use super::provider_metadata::finalize_openai_response_state_fingerprint;
use super::provider_request::build_model_request_async;
use super::*;

pub(super) async fn run_oma_turn_if_needed_async(
    session_id: &str,
    turn_id: &str,
    cancellation: &CancellationToken,
) -> Option<AgentRuntimeResult<ModelLoopResult>> {
    let (channel_id, targets) = {
        let state = state().lock().ok()?;
        let snapshot = &state.sessions.get(session_id)?.snapshot;
        if snapshot.get("agentMode").and_then(Value::as_str) != Some("oma") {
            return None;
        }
        oma_turn_targets(snapshot)?
    };
    Some(run_oma_turn_async(session_id, turn_id, &channel_id, targets, cancellation).await)
}

struct OmaWorkerOutcome {
    metadata: Option<Value>,
    error: Option<String>,
}

async fn run_oma_turn_async(
    session_id: &str,
    turn_id: &str,
    channel_id: &str,
    targets: Vec<String>,
    cancellation: &CancellationToken,
) -> AgentRuntimeResult<ModelLoopResult> {
    let mut worker_metadata = Vec::new();
    let tasks = targets
        .into_iter()
        .map(|session_agent_id| {
            let session_id = session_id.to_string();
            let turn_id = turn_id.to_string();
            let channel_id = channel_id.to_string();
            let cancellation = cancellation.clone();
            Box::pin(async move {
                let result = run_oma_agent_once(
                    &session_id,
                    &turn_id,
                    &channel_id,
                    &session_agent_id,
                    &cancellation,
                    true,
                )
                .await;
                (session_agent_id, result)
            })
                as Pin<
                    Box<dyn Future<Output = (String, AgentRuntimeResult<OmaWorkerOutcome>)> + Send>,
                >
        })
        .collect::<Vec<_>>();
    let timeout = super::turn_engine::oma_worker_timeout();
    for worker in super::turn_engine::run_batch_for_turn(tasks, timeout, turn_id).await {
        let (session_agent_id, result) = match worker {
            Ok(result) => result,
            Err(super::turn_engine::BlockingTaskFailure::Timeout) => {
                cancellation.cancel();
                super::session_runtime::request_turn_cancellation(turn_id);
                return Err(AgentRuntimeError::Cancelled);
            }
            Err(super::turn_engine::BlockingTaskFailure::Panic) => {
                return Err(AgentRuntimeError::Core(
                    "Oma Agent worker panicked".to_string(),
                ));
            }
        };
        match result {
            Ok(outcome) => {
                if let Some(metadata) = outcome.metadata {
                    worker_metadata.push((session_agent_id.clone(), metadata));
                }
                if let Some(error) = outcome.error {
                    commit_oma_agent_failure(session_id, channel_id, &session_agent_id, error)?;
                }
            }
            Err(error) => {
                if cancellation.is_cancelled() || turn_was_cancelled(session_id, turn_id) {
                    return Err(AgentRuntimeError::Cancelled);
                }
                commit_oma_agent_failure(
                    session_id,
                    channel_id,
                    &session_agent_id,
                    error.to_string(),
                )?;
            }
        }
    }
    for _ in 0..8 {
        let pending = {
            let mut state = state().lock().map_err(|_| {
                AgentRuntimeError::Core("agent runtime state lock failed".to_string())
            })?;
            let session = state.sessions.get_mut(session_id).ok_or_else(|| {
                AgentRuntimeError::Core(format!("session not found: {session_id}"))
            })?;
            take_pending_oma_turns(&mut session.snapshot)
        };
        if pending.is_empty() {
            break;
        }
        let mut unique_pending = Vec::new();
        for entry in pending {
            if !unique_pending.contains(&entry) {
                unique_pending.push(entry);
            }
        }
        let tasks = unique_pending
            .into_iter()
            .map(|(target_channel_id, session_agent_id)| {
                let session_id = session_id.to_string();
                let turn_id = turn_id.to_string();
                let cancellation = cancellation.clone();
                Box::pin(async move {
                    let result = run_oma_pending_agent(
                        &session_id,
                        &turn_id,
                        &target_channel_id,
                        &session_agent_id,
                        &cancellation,
                    )
                    .await;
                    (target_channel_id, session_agent_id, result)
                })
                    as Pin<
                        Box<
                            dyn Future<
                                    Output = (String, String, AgentRuntimeResult<OmaWorkerOutcome>),
                                > + Send,
                        >,
                    >
            })
            .collect::<Vec<_>>();
        let timeout = super::turn_engine::oma_worker_timeout();
        for worker in super::turn_engine::run_batch_for_turn(tasks, timeout, turn_id).await {
            let (target_channel_id, session_agent_id, result) = match worker {
                Ok(result) => result,
                Err(super::turn_engine::BlockingTaskFailure::Timeout) => {
                    cancellation.cancel();
                    super::session_runtime::request_turn_cancellation(turn_id);
                    return Err(AgentRuntimeError::Cancelled);
                }
                Err(super::turn_engine::BlockingTaskFailure::Panic) => {
                    return Err(AgentRuntimeError::Core(
                        "Oma pending worker panicked".to_string(),
                    ));
                }
            };
            match result {
                Ok(outcome) => {
                    if let Some(metadata) = outcome.metadata {
                        worker_metadata.push((session_agent_id.clone(), metadata));
                    }
                    if let Some(error) = outcome.error {
                        commit_oma_agent_failure(
                            session_id,
                            &target_channel_id,
                            &session_agent_id,
                            error,
                        )?;
                    }
                }
                Err(error) => {
                    if cancellation.is_cancelled() || turn_was_cancelled(session_id, turn_id) {
                        return Err(AgentRuntimeError::Cancelled);
                    }
                    commit_oma_agent_failure(
                        session_id,
                        &target_channel_id,
                        &session_agent_id,
                        error.to_string(),
                    )?;
                }
            }
        }
    }
    if let Ok(mut state) = state().lock()
        && let Some(session) = state.sessions.get_mut(session_id)
    {
        set_oma_execution_agent(&mut session.snapshot, None);
    }
    Ok(ModelLoopResult {
        final_text: None,
        final_message_id: None,
        metadata: aggregate_oma_worker_metadata(&worker_metadata),
        provider_transcript: Vec::new(),
        provider_replay_items: Vec::new(),
        ui_text_committed: false,
    })
}

fn aggregate_oma_worker_metadata(workers: &[(String, Value)]) -> Option<Value> {
    if workers.is_empty() {
        return None;
    }
    let sum = |key: &str| {
        workers
            .iter()
            .filter_map(|(_, metadata)| {
                metadata
                    .pointer(&format!("/providerUsage/{key}"))
                    .and_then(Value::as_u64)
            })
            .fold(0_u64, u64::saturating_add)
    };
    let input_total = sum("inputTotal");
    let cache_read = sum("cacheRead");
    let warnings = workers
        .iter()
        .flat_map(|(_, metadata)| {
            metadata
                .get("providerWarnings")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .cloned()
        })
        .collect::<Vec<_>>();
    let per_worker = workers
        .iter()
        .map(|(session_agent_id, metadata)| {
            json!({
                "sessionAgentId": session_agent_id,
                "providerUsage": metadata.get("providerUsage").cloned().unwrap_or(Value::Null),
                "providerWarnings": metadata.get("providerWarnings").cloned().unwrap_or_else(|| json!([])),
            })
        })
        .collect::<Vec<_>>();
    let mut metadata = json!({
        "providerUsage": {
            "callCount": sum("callCount"),
            "inputTotal": input_total,
            "inputUncached": sum("inputUncached"),
            "cacheRead": cache_read,
            "cacheWrite": sum("cacheWrite"),
            "output": sum("output"),
            "reasoning": sum("reasoning"),
            "hitRequestCount": sum("hitRequestCount"),
            "cacheReadShare": if input_total == 0 {
                0.0
            } else {
                cache_read as f64 / input_total as f64
            },
            "telemetryIncomplete": workers.iter().any(|(_, metadata)| {
                metadata.pointer("/providerUsage/telemetryIncomplete")
                    .and_then(Value::as_bool)
                    .unwrap_or(true)
            }),
        },
        "omaProviderWorkers": per_worker,
    });
    if !warnings.is_empty() {
        metadata["providerWarnings"] = Value::Array(warnings);
    }
    Some(metadata)
}

async fn run_oma_pending_agent(
    session_id: &str,
    turn_id: &str,
    target_channel_id: &str,
    session_agent_id: &str,
    cancellation: &CancellationToken,
) -> AgentRuntimeResult<OmaWorkerOutcome> {
    run_oma_agent_once(
        session_id,
        turn_id,
        target_channel_id,
        session_agent_id,
        cancellation,
        target_channel_id == OMA_DEFAULT_CHANNEL_ID,
    )
    .await
}

async fn run_oma_agent_once(
    session_id: &str,
    turn_id: &str,
    channel_id: &str,
    session_agent_id: &str,
    cancellation: &CancellationToken,
    publish: bool,
) -> AgentRuntimeResult<OmaWorkerOutcome> {
    let execution_session_id = format!("oma-execution-{}", Uuid::new_v4());
    let (callback, running_snapshot, work_package_id) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let parent = state
            .sessions
            .get(session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        let mut execution = parent.clone();
        execution.id = execution_session_id.clone();
        execution.ephemeral = true;
        execution.dirty = false;
        activate_oma_channel(&mut execution.snapshot, channel_id)?;
        hydrate_oma_private_provider_state(&mut execution.snapshot, session_agent_id);
        let work_package = oma_work_package_for_agent(&execution.snapshot, session_agent_id);
        let work_package_id = work_package
            .as_ref()
            .and_then(|package| package.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let assignment = work_package
            .unwrap_or_else(|| oma_assignment_for_agent(&execution.snapshot, session_agent_id));
        set_oma_execution_agent(&mut execution.snapshot, Some(session_agent_id));
        set_oma_execution_assignment(&mut execution.snapshot, assignment);
        execution.snapshot["oma"]["nestedProviderMetadataByTurn"] = json!({});
        execution.snapshot["oma"]["executingWorkPackageId"] =
            work_package_id.clone().map_or(Value::Null, Value::from);
        execution.snapshot["oma"]["parentSessionId"] = json!(session_id);
        execution.snapshot["activeTurnId"] = json!(turn_id);
        state
            .sessions
            .insert(execution_session_id.clone(), execution);
        let callback = event_callback();
        let parent = state
            .sessions
            .get_mut(session_id)
            .expect("Oma parent session still exists");
        if let Some(work_package_id) = work_package_id.as_deref() {
            set_oma_work_package_status(&mut parent.snapshot, work_package_id, "running", None);
        }
        if let Some(oma) = parent.snapshot.get_mut("oma") {
            set_agent_status(oma, session_agent_id, "running");
        }
        touch_session(parent);
        let snapshot = parent.snapshot.clone();
        state.save_state()?;
        (callback, snapshot, work_package_id)
    };
    if publish {
        emit_with_callback(
            &callback,
            json!({ "kind": "sessionSnapshot", "snapshot": running_snapshot }),
        );
    }
    let result = match build_model_request_async(execution_session_id.clone()).await {
        Ok(mut request) => {
            // Oma replies are committed only after their package identity and target
            // channel have been resolved.
            request.capabilities.supports_streaming = false;
            run_model_loop_without_ui_commit_async(
                &execution_session_id,
                turn_id,
                request,
                cancellation,
            )
            .await
        }
        Err(e) => Err(e),
    };
    let checkpoint_metadata =
        super::session_runtime::take_turn_provider_metadata(&execution_session_id, turn_id);
    let (text, error, replanned, provider_metadata) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let execution = state
            .sessions
            .remove(&execution_session_id)
            .ok_or_else(|| {
                AgentRuntimeError::Core("Oma execution session disappeared".to_string())
            })?;
        let mut provider_metadata = result
            .as_ref()
            .ok()
            .and_then(ModelLoopResult::session_metadata)
            .or(checkpoint_metadata);
        let text = result
            .as_ref()
            .ok()
            .and_then(|result| result.final_text.clone())
            .unwrap_or_default();
        let error = result.as_ref().err().map(ToString::to_string);
        let parent = state
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        let nested_provider_metadata =
            take_oma_nested_provider_metadata(&mut parent.snapshot, turn_id, session_agent_id);
        provider_metadata = merge_oma_nested_provider_metadata(
            provider_metadata,
            &nested_provider_metadata,
            session_agent_id,
        );
        finalize_openai_response_state_fingerprint(
            &execution,
            (!text.trim().is_empty()).then_some(text.as_str()),
            None,
            &mut provider_metadata,
        );
        capture_oma_private_provider_contexts(
            &mut parent.snapshot,
            &execution.snapshot,
            session_agent_id,
        );
        merge_oma_execution_channel_context(&mut parent.snapshot, channel_id, &execution.snapshot)?;
        let mut replanned = false;
        if let Some(work_package_id) = work_package_id.as_deref() {
            if let Some(error) = error.as_deref() {
                replanned =
                    replan_oma_work_package_once(&mut parent.snapshot, work_package_id, error);
                if !replanned {
                    set_oma_work_package_status(
                        &mut parent.snapshot,
                        work_package_id,
                        "failed",
                        Some(error),
                    );
                    queue_oma_team_failure_lead_followup(
                        &mut parent.snapshot,
                        work_package_id,
                        error,
                    );
                    queue_oma_team_completion_lead_followup(&mut parent.snapshot);
                }
            } else {
                set_oma_work_package_status(
                    &mut parent.snapshot,
                    work_package_id,
                    "completed",
                    (!text.trim().is_empty()).then_some(text.as_str()),
                );
                queue_oma_team_completion_lead_followup(&mut parent.snapshot);
            }
        }
        if let Some(oma) = parent.snapshot.get_mut("oma") {
            set_agent_status(
                oma,
                session_agent_id,
                match (work_package_id.is_some(), error.is_some(), replanned) {
                    (true, true, true) => "retrying",
                    (true, true, false) => "failed",
                    (true, false, _) => "completed",
                    (false, _, _) => "idle",
                },
            );
        }
        touch_session(parent);
        state.save_state()?;
        (text, error, replanned, provider_metadata)
    };
    if replanned {
        let _ = start_oma_team_work(session_id);
        return Ok(OmaWorkerOutcome {
            metadata: provider_metadata,
            error: None,
        });
    }
    if let Some(error) = error {
        if cancellation.is_cancelled() || turn_was_cancelled(session_id, turn_id) {
            return Err(AgentRuntimeError::Cancelled);
        }
        if work_package_id.is_some() {
            let _ = start_oma_team_work(session_id);
        }
        return Ok(OmaWorkerOutcome {
            metadata: provider_metadata,
            error: Some(error),
        });
    }
    if !text.trim().is_empty() {
        commit_oma_agent_reply(
            session_id,
            channel_id,
            session_agent_id,
            text,
            provider_metadata.clone(),
            publish,
        )?;
    } else if publish {
        emit_oma_session_snapshot(session_id)?;
    }
    if work_package_id.is_some() {
        let _ = start_oma_team_work(session_id);
    }
    Ok(OmaWorkerOutcome {
        metadata: provider_metadata,
        error: None,
    })
}

fn commit_oma_agent_reply(
    session_id: &str,
    channel_id: &str,
    session_agent_id: &str,
    text: String,
    provider_metadata: Option<Value>,
    publish: bool,
) -> AgentRuntimeResult<()> {
    let (callback, snapshot, message, visible) = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let callback = event_callback();
        let session = state
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        let private_provider_metadata = provider_metadata.clone();
        let mut metadata = oma_shared_provider_metadata(provider_metadata);
        metadata["oma"] = json!({
            "channelId": channel_id,
            "sender": "agent",
            "senderAgentId": session_agent_id,
            "kind": "agent_reply",
        });
        let message = assistant_message_with_metadata(text, Some(metadata));
        if let (Some(message_id), Some(private_provider_metadata)) = (
            message.get("id").and_then(Value::as_str),
            private_provider_metadata,
        ) {
            store_oma_private_provider_metadata(
                &mut session.snapshot,
                session_agent_id,
                message_id,
                private_provider_metadata,
            );
        }
        clear_oma_provider_protocol_checkpoint(&mut session.snapshot, session_agent_id);
        let visible =
            push_oma_message_to_channel(&mut session.snapshot, channel_id, message.clone())?;
        touch_session(session);
        let snapshot = session.snapshot.clone();
        state.save_state()?;
        (callback, snapshot, message, visible)
    };
    if publish && visible {
        emit_with_callback(
            &callback,
            json!({ "kind": "messageCommitted", "sessionId": session_id, "message": message }),
        );
    }
    if publish {
        emit_with_callback(
            &callback,
            json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
        );
    }
    Ok(())
}

fn oma_shared_provider_metadata(provider_metadata: Option<Value>) -> Value {
    let mut metadata = provider_metadata.unwrap_or_else(|| json!({}));
    if !metadata.is_object() {
        metadata = json!({ "provider": metadata });
    }
    if let Some(metadata) = metadata.as_object_mut() {
        // An Oma channel is shared conversation state. Native provider replay
        // belongs to the isolated worker that produced it and may contain
        // private reasoning, tool arguments, or tool results. Usage and
        // warnings remain public, but replay/cursor state must never cross an
        // Agent identity boundary.
        metadata.remove("providerTranscript");
        metadata.remove("openaiResponsesReplay");
        metadata.remove("openaiResponsesState");
        metadata.remove("providerProtocol");
    }
    metadata
}

pub(super) fn provider_observability_metadata(metadata: &Value) -> Option<Value> {
    let projection = [
        "providerUsage",
        "providerWarnings",
        "providerAttempts",
        "omaProviderWorkers",
    ]
    .into_iter()
    .filter_map(|key| {
        metadata
            .get(key)
            .cloned()
            .map(|value| (key.to_string(), value))
    })
    .collect::<serde_json::Map<_, _>>();
    (!projection.is_empty()).then_some(Value::Object(projection))
}

fn record_oma_nested_provider_metadata(
    snapshot: &mut Value,
    turn_id: &str,
    source_session_agent_id: &str,
    target_session_agent_id: &str,
    metadata: &Value,
) {
    let Some(metadata) = provider_observability_metadata(metadata) else {
        return;
    };
    let ledger = &mut snapshot["oma"]["nestedProviderMetadataByTurn"];
    if !ledger.is_object() {
        *ledger = json!({});
    }
    if !ledger[turn_id].is_object() {
        ledger[turn_id] = json!({});
    }
    if !ledger[turn_id][source_session_agent_id].is_array() {
        ledger[turn_id][source_session_agent_id] = json!([]);
    }
    ledger[turn_id][source_session_agent_id]
        .as_array_mut()
        .expect("nested provider metadata ledger is an array")
        .push(json!({
            "sessionAgentId": target_session_agent_id,
            "metadata": metadata,
        }));
}

fn take_oma_nested_provider_metadata(
    snapshot: &mut Value,
    turn_id: &str,
    source_session_agent_id: &str,
) -> Vec<Value> {
    let Some(by_turn) = snapshot
        .pointer_mut("/oma/nestedProviderMetadataByTurn")
        .and_then(Value::as_object_mut)
    else {
        return Vec::new();
    };
    let nested = by_turn
        .get_mut(turn_id)
        .and_then(Value::as_object_mut)
        .and_then(|by_agent| by_agent.remove(source_session_agent_id))
        .and_then(|value| value.as_array().cloned())
        .unwrap_or_default();
    if by_turn
        .get(turn_id)
        .and_then(Value::as_object)
        .is_some_and(serde_json::Map::is_empty)
    {
        by_turn.remove(turn_id);
    }
    nested
}

pub(super) fn clear_oma_nested_provider_metadata(snapshot: &mut Value, turn_id: &str) {
    if let Some(by_turn) = snapshot
        .pointer_mut("/oma/nestedProviderMetadataByTurn")
        .and_then(Value::as_object_mut)
    {
        by_turn.remove(turn_id);
    }
}

fn merge_oma_nested_provider_metadata(
    mut provider_metadata: Option<Value>,
    nested: &[Value],
    source_session_agent_id: &str,
) -> Option<Value> {
    if nested.is_empty() {
        return provider_metadata;
    }
    let mut workers = provider_metadata
        .as_ref()
        .map(|metadata| vec![(source_session_agent_id.to_string(), metadata.clone())])
        .unwrap_or_default();
    workers.extend(nested.iter().filter_map(|entry| {
        Some((
            entry.get("sessionAgentId")?.as_str()?.to_string(),
            entry.get("metadata")?.clone(),
        ))
    }));
    let aggregate = aggregate_oma_worker_metadata(&workers)?;
    let target = provider_metadata.get_or_insert_with(|| json!({}));
    if !target.is_object() {
        *target = json!({});
    }
    for key in ["providerUsage", "providerWarnings", "omaProviderWorkers"] {
        if let Some(value) = aggregate.get(key) {
            target[key] = value.clone();
        }
    }
    provider_metadata
}

fn hydrate_oma_private_provider_state(snapshot: &mut Value, session_agent_id: &str) {
    let private_contexts = snapshot
        .get("oma")
        .and_then(|oma| oma.get("privateProviderContextsByAgent"))
        .and_then(|by_agent| by_agent.get(session_agent_id))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let private_metadata = snapshot
        .get("oma")
        .and_then(|oma| oma.get("privateProviderMetadataByAgent"))
        .and_then(|by_agent| by_agent.get(session_agent_id))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let resumable_checkpoint = private_metadata
        .get("__activeTurn")
        .and_then(|checkpoint| checkpoint.get("providerProtocol"))
        .filter(|protocol| protocol.get("status").and_then(Value::as_str) == Some("complete"))
        .cloned();
    let Some(messages) = snapshot.get_mut("messages").and_then(Value::as_array_mut) else {
        return;
    };
    for message in messages.iter_mut() {
        let Some(message_id) = message
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            continue;
        };
        if let Some(provider_context) = private_contexts.get(&message_id) {
            message["metadata"]["providerContext"] = provider_context.clone();
        }
        if let Some(provider_metadata) =
            private_metadata.get(&message_id).and_then(Value::as_object)
        {
            if !message["metadata"].is_object() {
                message["metadata"] = json!({});
            }
            let metadata = message["metadata"]
                .as_object_mut()
                .expect("message metadata is an object");
            metadata.extend(provider_metadata.clone());
        }
    }
    if let Some(provider_protocol) = resumable_checkpoint {
        let turn_id = provider_protocol
            .get("turnId")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        messages.push(json!({
            "id": format!("oma-provider-checkpoint-{turn_id}"),
            "role": "assistant",
            "text": "",
            "metadata": {
                "kind": "oma-provider-protocol-checkpoint",
                "providerProtocol": provider_protocol,
            },
        }));
    }
}

fn capture_oma_private_provider_contexts(
    parent_snapshot: &mut Value,
    execution_snapshot: &Value,
    session_agent_id: &str,
) {
    let contexts = execution_snapshot
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|message| {
            let message_id = message.get("id").and_then(Value::as_str)?;
            let provider_context = message.pointer("/metadata/providerContext")?;
            Some((message_id.to_string(), provider_context.clone()))
        })
        .collect::<serde_json::Map<_, _>>();
    if contexts.is_empty() {
        return;
    }
    let oma = &mut parent_snapshot["oma"];
    if !oma["privateProviderContextsByAgent"].is_object() {
        oma["privateProviderContextsByAgent"] = json!({});
    }
    if !oma["privateProviderContextsByAgent"][session_agent_id].is_object() {
        oma["privateProviderContextsByAgent"][session_agent_id] = json!({});
    }
    oma["privateProviderContextsByAgent"][session_agent_id]
        .as_object_mut()
        .expect("private provider context ledger is an object")
        .extend(contexts);
}

fn store_oma_private_provider_metadata(
    snapshot: &mut Value,
    session_agent_id: &str,
    message_id: &str,
    provider_metadata: Value,
) {
    let oma = &mut snapshot["oma"];
    if !oma["privateProviderMetadataByAgent"].is_object() {
        oma["privateProviderMetadataByAgent"] = json!({});
    }
    if !oma["privateProviderMetadataByAgent"][session_agent_id].is_object() {
        oma["privateProviderMetadataByAgent"][session_agent_id] = json!({});
    }
    oma["privateProviderMetadataByAgent"][session_agent_id][message_id] = provider_metadata;
}

fn clear_oma_provider_protocol_checkpoint(snapshot: &mut Value, session_agent_id: &str) {
    if let Some(entries) = snapshot
        .pointer_mut("/oma/privateProviderMetadataByAgent")
        .and_then(Value::as_object_mut)
        .and_then(|agents| agents.get_mut(session_agent_id))
        .and_then(Value::as_object_mut)
    {
        entries.remove("__activeTurn");
    }
}

fn commit_oma_agent_failure(
    session_id: &str,
    channel_id: &str,
    session_agent_id: &str,
    error: String,
) -> AgentRuntimeResult<()> {
    commit_oma_agent_reply(
        session_id,
        channel_id,
        session_agent_id,
        format!("I couldn't complete this assignment: {error}"),
        None,
        true,
    )
}

fn emit_oma_session_snapshot(session_id: &str) -> AgentRuntimeResult<()> {
    let (callback, snapshot) = {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let snapshot = state
            .sessions
            .get(session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?
            .snapshot
            .clone();
        (event_callback(), snapshot)
    };
    emit_with_callback(
        &callback,
        json!({ "kind": "sessionSnapshot", "snapshot": snapshot }),
    );
    Ok(())
}

pub(crate) async fn run_oma_direct_ask(
    session_id: &str,
    turn_id: &str,
    source_session_agent_id: &str,
    target_session_agent_id: &str,
    text: String,
    publish_to_group: bool,
) -> AgentRuntimeResult<String> {
    let target_channel_id = direct_channel_id(target_session_agent_id);
    {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let session = state
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        ensure_oma_channel_message_contexts(&mut session.snapshot);
        let mut request = user_message(text, Vec::new(), now());
        request["metadata"] = json!({
            "oma": {
                "channelId": target_channel_id,
                "sender": "agent",
                "senderAgentId": source_session_agent_id,
                "targetSessionAgentIds": [target_session_agent_id],
                "kind": "agent_ask",
            }
        });
        push_oma_message_to_channel(&mut session.snapshot, &target_channel_id, request)?;
        touch_session(session);
    }
    let cancellation = CancellationToken::new();
    let outcome = run_oma_agent_once(
        session_id,
        turn_id,
        &target_channel_id,
        target_session_agent_id,
        &cancellation,
        false,
    )
    .await?;
    let reply = {
        let mut state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        let session = state
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| AgentRuntimeError::Core(format!("session not found: {session_id}")))?;
        if let Some(metadata) = outcome.metadata.as_ref() {
            record_oma_nested_provider_metadata(
                &mut session.snapshot,
                turn_id,
                source_session_agent_id,
                target_session_agent_id,
                metadata,
            );
        }
        let reply = oma_channel_messages(&session.snapshot, &target_channel_id)
            .iter()
            .rev()
            .find(|message| {
                message.get("role").and_then(Value::as_str) == Some("assistant")
                    && message
                        .pointer("/metadata/oma/senderAgentId")
                        .and_then(Value::as_str)
                        == Some(target_session_agent_id)
            })
            .and_then(|message| message.get("text").and_then(Value::as_str))
            .unwrap_or_default()
            .to_string();
        touch_session(session);
        state.save_state()?;
        reply
    };
    if let Some(error) = outcome.error {
        return Err(AgentRuntimeError::Core(error));
    }
    if publish_to_group && !reply.trim().is_empty() {
        commit_oma_agent_reply(
            session_id,
            OMA_DEFAULT_CHANNEL_ID,
            target_session_agent_id,
            reply.clone(),
            None,
            true,
        )?;
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oma_provider_usage_is_summed_across_workers() {
        let metadata = aggregate_oma_worker_metadata(&[
            (
                "agent-1".to_string(),
                json!({
                    "providerUsage": {
                        "callCount": 2,
                        "inputTotal": 100,
                        "inputUncached": 30,
                        "cacheRead": 70,
                        "cacheWrite": 0,
                        "output": 20,
                        "reasoning": 5,
                        "hitRequestCount": 1,
                        "telemetryIncomplete": false
                    }
                }),
            ),
            (
                "agent-2".to_string(),
                json!({
                    "providerUsage": {
                        "callCount": 1,
                        "inputTotal": 50,
                        "inputUncached": 40,
                        "cacheRead": 10,
                        "cacheWrite": 5,
                        "output": 10,
                        "reasoning": 0,
                        "hitRequestCount": 1,
                        "telemetryIncomplete": true
                    },
                    "providerWarnings": [{ "kind": "cache_fallback" }]
                }),
            ),
        ])
        .expect("aggregate");

        assert_eq!(metadata["providerUsage"]["callCount"], 3);
        assert_eq!(metadata["providerUsage"]["inputTotal"], 150);
        assert_eq!(metadata["providerUsage"]["cacheRead"], 80);
        assert_eq!(metadata["providerUsage"]["cacheWrite"], 5);
        assert_eq!(metadata["providerUsage"]["output"], 30);
        assert_eq!(metadata["providerUsage"]["telemetryIncomplete"], true);
        assert_eq!(
            metadata["omaProviderWorkers"].as_array().map(Vec::len),
            Some(2)
        );
        assert_eq!(
            metadata["providerWarnings"].as_array().map(Vec::len),
            Some(1)
        );
    }

    #[test]
    fn nested_oma_usage_is_merged_into_the_source_worker() {
        let mut snapshot = json!({ "oma": {} });
        record_oma_nested_provider_metadata(
            &mut snapshot,
            "turn-1",
            "source-agent",
            "consulted-agent",
            &json!({
                "providerUsage": {
                    "callCount": 1,
                    "inputTotal": 50,
                    "inputUncached": 40,
                    "cacheRead": 10,
                    "cacheWrite": 0,
                    "output": 5,
                    "reasoning": 0,
                    "hitRequestCount": 1,
                    "telemetryIncomplete": false
                }
            }),
        );
        let nested = take_oma_nested_provider_metadata(&mut snapshot, "turn-1", "source-agent");
        let merged = merge_oma_nested_provider_metadata(
            Some(json!({
                "providerUsage": {
                    "callCount": 2,
                    "inputTotal": 100,
                    "inputUncached": 20,
                    "cacheRead": 80,
                    "cacheWrite": 5,
                    "output": 20,
                    "reasoning": 5,
                    "hitRequestCount": 2,
                    "telemetryIncomplete": false
                },
                "providerTranscript": [{ "role": "assistant", "content": "keep private replay" }]
            })),
            &nested,
            "source-agent",
        )
        .expect("merged metadata");

        assert_eq!(merged["providerUsage"]["callCount"], 3);
        assert_eq!(merged["providerUsage"]["inputTotal"], 150);
        assert_eq!(merged["providerUsage"]["cacheRead"], 90);
        assert_eq!(merged["providerUsage"]["cacheWrite"], 5);
        assert_eq!(
            merged["omaProviderWorkers"].as_array().map(Vec::len),
            Some(2)
        );
        assert!(merged.get("providerTranscript").is_some());
        assert!(
            snapshot
                .pointer("/oma/nestedProviderMetadataByTurn/turn-1")
                .is_none()
        );
    }

    #[test]
    fn oma_shared_reply_never_persists_private_provider_replay() {
        let metadata = oma_shared_provider_metadata(Some(json!({
            "providerUsage": { "cacheRead": 42 },
            "providerWarnings": [{ "kind": "cache_fallback" }],
            "providerTranscript": [{ "role": "tool", "content": "private result" }],
            "openaiResponsesReplay": [{ "type": "function_call", "arguments": "private args" }],
            "openaiResponsesState": { "responseId": "private-cursor" },
        })));

        assert_eq!(metadata["providerUsage"]["cacheRead"], 42);
        assert_eq!(metadata["providerWarnings"][0]["kind"], "cache_fallback");
        assert!(metadata.get("providerTranscript").is_none());
        assert!(metadata.get("openaiResponsesReplay").is_none());
        assert!(metadata.get("openaiResponsesState").is_none());
    }

    #[test]
    fn oma_private_provider_state_hydrates_only_the_same_agent() {
        let mut parent = json!({
            "oma": {},
            "messages": [
                { "id": "user-1", "role": "user", "text": "task" },
                {
                    "id": "assistant-1",
                    "role": "assistant",
                    "text": "done",
                    "metadata": { "oma": { "senderAgentId": "agent-1" } }
                }
            ]
        });
        let execution = json!({
            "messages": [{
                "id": "user-1",
                "role": "user",
                "text": "task",
                "metadata": {
                    "providerContext": {
                        "version": 1,
                        "renderedTail": "agent-1 frozen tail"
                    }
                }
            }]
        });
        capture_oma_private_provider_contexts(&mut parent, &execution, "agent-1");
        store_oma_private_provider_metadata(
            &mut parent,
            "agent-1",
            "assistant-1",
            json!({
                "providerTranscript": [{ "role": "tool", "content": "private result" }],
                "openaiResponsesState": { "responseId": "resp-agent-1" }
            }),
        );
        store_oma_private_provider_metadata(
            &mut parent,
            "agent-1",
            "__activeTurn",
            json!({
                "turnId": "turn-interrupted-after-tools",
                "providerProtocol": {
                    "version": 2,
                    "turnId": "turn-interrupted-after-tools",
                    "status": "complete",
                    "assistant": {
                        "content": "",
                        "toolCalls": [{ "id": "call-1", "name": "inspect", "arguments": {} }]
                    },
                    "toolResults": [{
                        "toolCallId": "call-1",
                        "content": "durable result",
                        "status": "completed"
                    }]
                }
            }),
        );

        let mut same_agent = parent.clone();
        hydrate_oma_private_provider_state(&mut same_agent, "agent-1");
        assert_eq!(
            same_agent["messages"][0]
                .pointer("/metadata/providerContext/renderedTail")
                .and_then(Value::as_str),
            Some("agent-1 frozen tail")
        );
        assert_eq!(
            same_agent["messages"][1]
                .pointer("/metadata/openaiResponsesState/responseId")
                .and_then(Value::as_str),
            Some("resp-agent-1")
        );
        assert_eq!(
            same_agent["messages"][2]
                .pointer("/metadata/providerProtocol/toolResults/0/content")
                .and_then(Value::as_str),
            Some("durable result")
        );

        let mut other_agent = parent;
        hydrate_oma_private_provider_state(&mut other_agent, "agent-2");
        assert_eq!(other_agent["messages"].as_array().map(Vec::len), Some(2));
        assert!(
            other_agent["messages"][0]
                .pointer("/metadata/providerContext")
                .is_none()
        );
        assert!(
            other_agent["messages"][1]
                .pointer("/metadata/providerTranscript")
                .is_none()
        );
    }
}
