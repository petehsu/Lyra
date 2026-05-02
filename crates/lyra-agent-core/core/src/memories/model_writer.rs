use crate::client_common::Prompt;
use crate::client_common::ResponseEvent;
use crate::memories::lyra_truth;
use crate::memories::lyra_truth::LyraMemoryWriteOutcome;
use crate::memories::lyra_truth::MemoryModelDecision;
use crate::memories::lyra_truth::PendingMemoryJob;
use crate::session::session::Session;
use anyhow::Context;
use futures::StreamExt;
use lyra_protocol::models::BaseInstructions;
use lyra_protocol::models::ContentItem;
use lyra_protocol::models::ResponseItem;
use serde_json::Value;
use serde_json::json;
use std::sync::Arc;
use tracing::warn;
use uuid::Uuid;

const MEMORY_WRITER_JOB_LIMIT: usize = 4;

const MEMORY_WRITER_INSTRUCTIONS: &str = r#"You are Lyra's memory writer.

Decide whether the candidate message should update durable memory. Use the full JSON input:
- candidate
- current_session_summary
- shared_truth
- frozen_truth
- conflict_truth

Return strict JSON only. Do not include markdown or explanatory prose.

Required output shape:
{
  "salience": 0.0,
  "promotions": [
    {
      "target_space": "shared",
      "namespace": "project",
      "kind": "constraint",
      "value": "Durable memory value.",
      "confidence": 0.0,
      "rationale": "Short reason."
    }
  ],
  "rationale": "Short reason for the whole decision."
}

Use target_space "shared" for project or conversation facts that should help this thread or project.
Use target_space "frozen" only for durable user identity, durable user preferences, or durable global operating constraints.
Return an empty promotions array when the candidate is transient, redundant, ambiguous, unsafe to store, or lower than high confidence.
"#;

pub(crate) async fn drain_memory_writer_jobs_for_session(
    session: &Arc<Session>,
) -> anyhow::Result<LyraMemoryWriteOutcome> {
    let turn_context = session
        .new_default_turn_with_sub_id(format!("memory-writer-{}", Uuid::new_v4()))
        .await;
    let root = lyra_truth::lyra_truth_root_path(turn_context.config.lyra_home.as_ref());
    let jobs = {
        let root = root.clone();
        tokio::task::spawn_blocking(move || {
            lyra_truth::claim_pending_memory_jobs(&root, MEMORY_WRITER_JOB_LIMIT)
        })
        .await
        .context("join Lyra memory writer job claim task")??
    };
    let mut aggregate = LyraMemoryWriteOutcome::default();
    for job in jobs {
        let decision = request_memory_model_decision(session, turn_context.as_ref(), &job).await;
        match decision {
            Ok(decision) => {
                let root = root.clone();
                let job_id = job.job_id.clone();
                let outcome = tokio::task::spawn_blocking(move || {
                    lyra_truth::apply_memory_model_decision(&root, &job_id, decision)
                })
                .await
                .context("join Lyra memory writer decision apply task")??;
                aggregate.shared_updated |= outcome.shared_updated;
                aggregate.frozen_updated |= outcome.frozen_updated;
                aggregate.trimmed |= outcome.trimmed;
                aggregate.prompt_cache_updated |= outcome.prompt_cache_updated;
            }
            Err(error) => {
                warn!(
                    job_id = job.job_id.as_str(),
                    session_id = job.session_id.as_str(),
                    "Lyra memory model writer failed: {error}"
                );
                let root = root.clone();
                let job_id = job.job_id.clone();
                tokio::task::spawn_blocking(move || {
                    lyra_truth::mark_memory_model_job_failed(&root, &job_id, error.to_string())
                })
                .await
                .context("join Lyra memory writer failure mark task")??;
            }
        }
    }
    Ok(aggregate)
}

async fn request_memory_model_decision(
    session: &Session,
    turn_context: &crate::session::turn_context::TurnContext,
    job: &PendingMemoryJob,
) -> anyhow::Result<MemoryModelDecision> {
    let prompt = memory_writer_prompt(job)?;
    let inference_trace = session
        .services
        .rollout_thread_trace
        .inference_trace_context(
            turn_context.sub_id.as_str(),
            turn_context.model_info.slug.as_str(),
            turn_context.provider.info().name.as_str(),
        );
    let mut client_session = session.services.model_client.new_session();
    let mut stream = client_session
        .stream(
            &prompt,
            &turn_context.model_info,
            &turn_context.session_telemetry,
            turn_context.reasoning_effort,
            turn_context.reasoning_summary,
            turn_context.config.model_verbosity,
            turn_context.config.service_tier,
            None,
            &inference_trace,
        )
        .await
        .map_err(|error| anyhow::anyhow!(error.to_string()))?;

    let mut delta_text = String::new();
    let mut completed_message_text = String::new();
    while let Some(event) = stream.next().await {
        match event.map_err(|error| anyhow::anyhow!(error.to_string()))? {
            ResponseEvent::OutputTextDelta(delta) => delta_text.push_str(&delta),
            ResponseEvent::OutputItemDone(item) => {
                if let Some(text) = response_item_text(&item)
                    && !text.trim().is_empty()
                {
                    completed_message_text = text;
                }
            }
            ResponseEvent::Completed { .. } => break,
            ResponseEvent::ToolCallInputDelta { .. } => {
                anyhow::bail!("memory writer model attempted a tool call")
            }
            _ => {}
        }
    }

    let text = if delta_text.trim().is_empty() {
        completed_message_text
    } else {
        delta_text
    };
    parse_memory_model_decision(text.as_str())
}

fn memory_writer_prompt(job: &PendingMemoryJob) -> anyhow::Result<Prompt> {
    let input_json =
        serde_json::to_string_pretty(&job.payload_json).context("encode memory writer payload")?;
    Ok(Prompt {
        input: vec![ResponseItem::Message {
            id: None,
            role: "user".to_string(),
            content: vec![ContentItem::InputText { text: input_json }],
            end_turn: None,
            phase: None,
        }],
        tools: Vec::new(),
        parallel_tool_calls: false,
        base_instructions: BaseInstructions {
            text: MEMORY_WRITER_INSTRUCTIONS.to_string(),
        },
        output_schema: Some(memory_writer_output_schema()),
    })
}

fn response_item_text(item: &ResponseItem) -> Option<String> {
    let ResponseItem::Message { content, .. } = item else {
        return None;
    };
    let mut text = String::new();
    for item in content {
        match item {
            ContentItem::InputText { text: value } | ContentItem::OutputText { text: value } => {
                text.push_str(value);
            }
            ContentItem::InputImage { .. } => {}
        }
    }
    Some(text)
}

fn parse_memory_model_decision(text: &str) -> anyhow::Result<MemoryModelDecision> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        anyhow::bail!("memory writer model returned empty output");
    }
    serde_json::from_str::<MemoryModelDecision>(trimmed)
        .context("memory writer model output was not strict JSON")
}

fn memory_writer_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "salience": {
                "type": "number",
                "minimum": 0.0,
                "maximum": 1.0
            },
            "promotions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "target_space": {
                            "type": "string",
                            "enum": ["shared", "frozen"]
                        },
                        "namespace": {
                            "type": "string"
                        },
                        "kind": {
                            "type": "string"
                        },
                        "value": {
                            "type": "string"
                        },
                        "confidence": {
                            "type": "number",
                            "minimum": 0.0,
                            "maximum": 1.0
                        },
                        "rationale": {
                            "type": "string"
                        }
                    },
                    "required": [
                        "target_space",
                        "namespace",
                        "kind",
                        "value",
                        "confidence",
                        "rationale"
                    ]
                }
            },
            "rationale": {
                "type": "string"
            }
        },
        "required": ["salience", "promotions", "rationale"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_strict_memory_model_decision_json() {
        let decision = parse_memory_model_decision(
            r#"{"salience":0.8,"promotions":[],"rationale":"transient"}"#,
        )
        .unwrap();

        assert_eq!(decision.salience, 0.8);
        assert!(decision.promotions.is_empty());
    }

    #[test]
    fn rejects_non_json_memory_model_decision_output() {
        let error = parse_memory_model_decision(
            r#"Here is the JSON: {"salience":0.8,"promotions":[],"rationale":"wrapped"}"#,
        )
        .unwrap_err();

        assert!(error.to_string().contains("strict JSON"));
    }

    #[test]
    fn memory_writer_schema_requires_promotion_rationale() {
        let schema = memory_writer_output_schema();
        let required = schema
            .pointer("/properties/promotions/items/required")
            .and_then(Value::as_array)
            .unwrap();

        assert!(required.contains(&Value::String("rationale".to_string())));
    }
}
