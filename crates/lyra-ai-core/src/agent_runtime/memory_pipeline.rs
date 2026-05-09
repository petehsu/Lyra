use crate::model_gateway::ProviderRuntimeConfig;
#[cfg(not(test))]
use crate::model_gateway::{generate_response, ChatMessage};
#[cfg(not(test))]
use crate::storage::{trim_to_string, AiStore, MemoryGatewayJob};
#[cfg(not(test))]
use serde_json::{json, Value};
use std::path::PathBuf;
#[cfg(not(test))]
use std::sync::atomic::AtomicBool;
#[cfg(not(test))]
use std::thread;

#[cfg(not(test))]
const MEMORY_GATEWAY_JOB_LIMIT: usize = 2;

pub(crate) fn spawn_memory_gateway_worker(storage_root: PathBuf, config: ProviderRuntimeConfig) {
    if should_run_memory_gateway_worker(&config) == false {
        return;
    }
    #[cfg(not(test))]
    {
        thread::spawn(move || {
            if let Err(error) = run_memory_gateway_worker(storage_root, config) {
                eprintln!("Lyra memory gateway worker failed: {error}");
            }
        });
    }
    #[cfg(test)]
    {
        let _ = storage_root;
        let _ = config;
    }
}

#[cfg(not(test))]
fn run_memory_gateway_worker(
    storage_root: PathBuf,
    config: ProviderRuntimeConfig,
) -> anyhow::Result<()> {
    let store = AiStore::open(Some(storage_root.to_string_lossy().as_ref()))?;
    let jobs = store.claim_pending_memory_gateway_jobs(MEMORY_GATEWAY_JOB_LIMIT)?;
    for job in jobs {
        match score_memory_job(&config, &job) {
            Ok(score) => {
                let scope = job
                    .request
                    .get("candidate")
                    .and_then(|candidate| candidate.get("scope"))
                    .and_then(Value::as_str)
                    .unwrap_or("shared");
                let confidence = score
                    .get("confidence")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.35);
                let stability = score
                    .get("stability")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.25);
                let accepted = score
                    .get("accepted")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                store.apply_memory_gateway_score(
                    scope,
                    &job.target_ref,
                    confidence,
                    stability,
                    accepted,
                    score.clone(),
                )?;
                store.complete_memory_gateway_job(&job.job_id, score)?;
            }
            Err(error) => {
                store.fail_memory_gateway_job(&job.job_id, &error.to_string())?;
            }
        }
    }
    Ok(())
}

#[cfg(not(test))]
fn score_memory_job(
    config: &ProviderRuntimeConfig,
    job: &MemoryGatewayJob,
) -> anyhow::Result<Value> {
    let cancel = AtomicBool::new(false);
    let mut streamed = String::new();
    let response = generate_response(
        config.clone(),
        vec![
            ChatMessage {
                role: "system".to_string(),
                content: "Score an Agent Memory V2 candidate. Return only compact JSON with fields accepted:boolean, confidence:number, stability:number, reason:string. Do not reveal or infer secrets. If evidence is weak, set accepted=false and keep confidence below 0.65.".to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: serde_json::to_string(&json!({
                    "schemaVersion": "v2",
                    "task": "score_memory_candidate",
                    "candidateOnlyOnFailure": true,
                    "job": job.request,
                }))?,
            },
        ],
        &cancel,
        |delta| {
            streamed.push_str(delta);
            Ok(())
        },
    )?;
    let text = if streamed.trim().is_empty() {
        response.text
    } else {
        streamed
    };
    parse_score_json(&text)
}

#[cfg(not(test))]
fn parse_score_json(text: &str) -> anyhow::Result<Value> {
    let trimmed = text.trim();
    let json_text = trimmed
        .strip_prefix("```json")
        .and_then(|value| value.strip_suffix("```"))
        .or_else(|| {
            trimmed
                .strip_prefix("```")
                .and_then(|value| value.strip_suffix("```"))
        })
        .unwrap_or(trimmed)
        .trim();
    let value = serde_json::from_str::<Value>(json_text)?;
    Ok(json!({
        "accepted": value.get("accepted").and_then(Value::as_bool).unwrap_or(false),
        "confidence": value.get("confidence").and_then(Value::as_f64).unwrap_or(0.35),
        "stability": value.get("stability").and_then(Value::as_f64).unwrap_or(0.25),
        "reason": value.get("reason").and_then(Value::as_str).and_then(trim_to_string).unwrap_or_else(|| "model_gateway_score".to_string()),
        "raw": value,
    }))
}

fn should_run_memory_gateway_worker(config: &ProviderRuntimeConfig) -> bool {
    if config.provider_id == "test" || config.protocol_id == "test" {
        return false;
    }
    config.model.trim().is_empty() == false
}
