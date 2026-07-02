use super::*;
use crate::native_backend::token_estimate::{estimate_message_tokens, estimate_messages_tokens};
use std::collections::HashSet;

pub(crate) const EXTRACT_COMPRESS_THRESHOLD: usize = 30_000;
pub(crate) const EXTRACT_INPUT_TARGET: usize = 10_000;
pub(crate) const EXTRACT_INPUT_MAX: usize = 15_000;

const EXTRACT_AND_COMPRESS_SYSTEM_PROMPT: &str = r#"You are Lyra's background context compression and memory maintenance agent.

You inspect a window of conversation messages and return compact JSON that simultaneously:
1. Extracts durable memory candidates (facts worth remembering long-term)
2. Produces a compressed context summary that replaces the original messages

Return ONLY a JSON object:
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
  ],
  "compressedContext": {
    "summary": "concise narrative summary of the conversation window (500-2000 chars)",
    "keyDecisions": ["decision1", "decision2"],
    "projectState": "current project state description",
    "compressedMessageIds": ["msg-id-1", "msg-id-2"],
    "tokenEstimate": 0
  }
}

Rules:
- Keep at most 6 candidates.
- compressedContext.summary should capture essential context: what was discussed, what was decided, what is the current state.
- compressedContext.compressedMessageIds must list the message IDs you are compressing.
- compressedContext.tokenEstimate is your estimate of the summary's token count.
- Ignore secrets, passwords, API keys, tokens in both candidates and summary.
- Do not include transient command output or one-off task details in candidates.
"#;

/// Apply a parsed compression response to a session in-place.
///
/// This is the post-LLM core: archive originals to cut_store, replace
/// messages with the compression block, advance `memoryCompression`.
/// Extracted from `spawn_extract_and_compress` for direct testability.
pub(crate) fn apply_compression_to_session(
    session: &mut NativeSession,
    root: &Path,
    session_id: &str,
    turn_id: &str,
    selected: &[(usize, Value)],
    messages: &[Value],
    parsed: &Value,
    compressed_up_to: usize,
) -> AgentRuntimeResult<()> {
    // 1. Process memory candidates (best-effort, non-fatal)
    if let Some(candidates_arr) = parsed.get("candidates").and_then(Value::as_array) {
        let mutations = candidates_arr
            .iter()
            .take(6)
            .filter_map(|candidate| {
                memory_candidate_from_agent_json(
                    candidate,
                    Some(format!("{session_id}:{turn_id}:memory_compress")),
                    None,
                )
            })
            .collect::<Vec<_>>();
        for mutation in mutations {
            let _ = process_extracted_candidate(root, session_id, &turn_id, mutation);
        }
    }

    // 2. Parse compressedContext
    let Some(compressed_ctx) = parsed.get("compressedContext") else {
        return Ok(());
    };
    let summary = compressed_ctx
        .get("summary")
        .and_then(Value::as_str)
        .unwrap_or("");
    if summary.is_empty() {
        return Ok(());
    }
    let key_decisions = compressed_ctx
        .get("keyDecisions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let project_state = compressed_ctx
        .get("projectState")
        .and_then(Value::as_str)
        .unwrap_or("");
    let token_estimate = compressed_ctx
        .get("tokenEstimate")
        .and_then(Value::as_u64)
        .map(|v| v as usize)
        .unwrap_or(0);

    // 3. Determine compress indices (selected + tool messages in range)
    let first_idx = selected.first().unwrap().0;
    let last_idx = selected.last().unwrap().0;
    let selected_indices: HashSet<usize> = selected.iter().map(|(i, _)| *i).collect();
    let mut compress_indices: Vec<usize> = Vec::new();
    for i in first_idx..=last_idx {
        let role = messages
            .get(i)
            .and_then(|m| m.get("role"))
            .and_then(Value::as_str);
        if selected_indices.contains(&i) || role == Some("tool") {
            compress_indices.push(i);
        }
    }

    // 4. Archive originals to cut_store
    let cut_entries: Vec<cut_store::CutMessageEntry> = compress_indices
        .iter()
        .filter_map(|&i| {
            messages.get(i).map(|msg| cut_store::CutMessageEntry {
                message: msg.clone(),
                ordinal: i as i64,
            })
        })
        .collect();
    if !cut_entries.is_empty() {
        let pack = cut_store::append_cut_pack(root, session_id, &cut_entries)?;
        cut_store::update_manifest_with_pack(root, session_id, &pack)?;
    }

    // 5. Build compression block
    let compression_block_id = format!("compression-{}", Uuid::new_v4());
    let compressed_message_ids: Vec<String> = compress_indices
        .iter()
        .filter_map(|&i| {
            messages
                .get(i)
                .and_then(|m| m.get("id"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect();
    let compression_block_text = json!({
        "summary": summary,
        "keyDecisions": key_decisions,
        "projectState": project_state,
        "compressedMessageIds": compressed_message_ids,
        "tokenEstimate": token_estimate,
    })
    .to_string();
    let compression_block = json!({
        "id": compression_block_id,
        "role": "system",
        "text": compression_block_text,
        "createdAt": now(),
        "metadata": {
            "kind": "compressed-context-block",
            "compressionBlockId": compression_block_id,
            "compressedMessageIds": compressed_message_ids,
        }
    });

    // 6. Remove old messages, insert compression block at head
    let compress_ids_set: HashSet<String> = compressed_message_ids.iter().cloned().collect();
    let last_compressed_ordinal = compress_indices
        .iter()
        .max()
        .copied()
        .unwrap_or(compressed_up_to);

    if let Some(live_messages) = session
        .snapshot
        .get_mut("messages")
        .and_then(Value::as_array_mut)
    {
        live_messages.retain(|msg| {
            let msg_id = msg.get("id").and_then(Value::as_str).unwrap_or("");
            !compress_ids_set.contains(msg_id)
        });
        live_messages.retain(|msg| {
            msg.pointer("/metadata/kind").and_then(Value::as_str)
                != Some("compressed-context-block")
        });
        let insert_at = live_messages
            .iter()
            .position(|m| m.get("role").and_then(Value::as_str) != Some("system"))
            .unwrap_or(live_messages.len());
        live_messages.insert(insert_at, compression_block);
    }

    // 7. Write memoryCompression watermark
    if let Some(obj) = session.snapshot.as_object_mut() {
        obj.insert(
            "memoryCompression".to_string(),
            json!({
                "lastCompressionTurnId": turn_id,
                "lastCompressionAt": now(),
                "compressedUpToMessageOrdinal": last_compressed_ordinal + 1,
                "compressedTokenBaseline": token_estimate,
                "compressionBlockId": compression_block_id,
            }),
        );
    }
    touch_session(session);
    Ok(())
}

pub(crate) fn spawn_extract_and_compress(root: PathBuf, session_id: String, turn_id: String) {
    {
        let mut state = match state().lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        if !state.active_compressions.insert(session_id.clone()) {
            return;
        }
    }

    thread::spawn(move || {
        let result = (|| -> AgentRuntimeResult<()> {
            emit_context_compression_progress(&session_id, "started", None, None);

            let session = {
                let state = state().lock().map_err(|_| {
                    AgentRuntimeError::Core("agent runtime state lock failed".to_string())
                })?;
                state.sessions.get(&session_id).cloned().ok_or_else(|| {
                    AgentRuntimeError::Core(format!("session not found: {session_id}"))
                })?
            };

            let messages = session
                .snapshot
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();

            let compressed_up_to = session
                .snapshot
                .pointer("/memoryCompression/compressedUpToMessageOrdinal")
                .and_then(Value::as_u64)
                .map(|v| v as usize)
                .unwrap_or(0);

            let candidates: Vec<(usize, Value)> = messages
                .iter()
                .enumerate()
                .skip(compressed_up_to)
                .filter(|(_, msg)| {
                    matches!(
                        msg.get("role").and_then(Value::as_str),
                        Some("user") | Some("assistant")
                    )
                })
                .map(|(i, msg)| (i, msg.clone()))
                .collect();

            if candidates.is_empty() {
                return Ok(());
            }

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

            if selected.is_empty() {
                return Ok(());
            }

            let token_before = estimate_messages_tokens(&messages);

            let (provider, model) = memory_agent_provider_and_model()?;
            let input_messages_json: Vec<Value> =
                selected.iter().map(|(_, msg)| msg.clone()).collect();

            let llm_messages = vec![
                json!({
                    "role": "system",
                    "content": EXTRACT_AND_COMPRESS_SYSTEM_PROMPT,
                }),
                json!({
                    "role": "user",
                    "content": json!({
                        "sessionId": session_id,
                        "turnId": turn_id,
                        "messages": input_messages_json,
                    }).to_string(),
                }),
            ];

            let reply = call_model_once_non_streaming(&provider, &model, &llm_messages, &[])?;
            let content = reply.content.as_deref().ok_or_else(|| {
                AgentRuntimeError::Core("compression agent returned no content".to_string())
            })?;

            let parsed = parse_memory_agent_json(content)?;

            let token_after;
            {
                let mut state = state().lock().map_err(|_| {
                    AgentRuntimeError::Core("agent runtime state lock failed".to_string())
                })?;
                if let Some(live_session) = state.sessions.get_mut(&session_id) {
                    apply_compression_to_session(
                        live_session,
                        &root,
                        &session_id,
                        &turn_id,
                        &selected,
                        &messages,
                        &parsed,
                        compressed_up_to,
                    )?;
                    token_after = live_session
                        .snapshot
                        .get("messages")
                        .and_then(Value::as_array)
                        .map(|msgs| estimate_messages_tokens(msgs))
                        .unwrap_or(0);
                } else {
                    token_after = 0;
                }
                state.save_state()?;
            }

            emit_context_compression_progress(
                &session_id,
                "completed",
                Some(token_before),
                Some(token_after),
            );

            Ok(())
        })();

        {
            let mut state = match state().lock() {
                Ok(state) => state,
                Err(_) => return,
            };
            state.active_compressions.remove(&session_id);
        }

        if let Err(error) = result {
            // ponytail: 隐式重试 — 压缩失败时 active_compressions 已 remove，
            // 下轮 turn 若 token 仍 ≥30K 会重新触发。无显式重试队列，避免过度工程。
            eprintln!("[lyra-agent-runtime] extract+compress failed for {session_id}: {error}");
            emit_context_compression_progress(&session_id, "failed", None, None);
        }
    });
}
