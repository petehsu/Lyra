use super::*;
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

static MEMORY_JOB_WORKER_RUNNING: AtomicBool = AtomicBool::new(false);

pub(crate) const EVENT_TOOL_CALL_COMPLETED: &str = "tool_call_completed";
pub(crate) const EVENT_FILE_CHANGE_RECORDED: &str = "file_change_recorded";

#[derive(Clone, Debug)]
pub(crate) struct MemoryTriggerEvent {
    pub event_type: String,
    pub session_id: String,
    pub turn_id: String,
    pub payload: Value,
}

pub(crate) fn emit_memory_trigger(root: &Path, event: MemoryTriggerEvent) {
    let root = root.to_path_buf();
    if let Err(error) = record_memory_trigger_and_enqueue(&root, &event) {
        eprintln!("memory trigger enqueue transaction failed: {error}");
        return;
    }
    spawn_memory_job_worker(root);
}

pub(crate) fn spawn_memory_job_worker(root: PathBuf) {
    if MEMORY_JOB_WORKER_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    thread::spawn(move || {
        let _guard = MemoryJobWorkerGuard;
        let _ = drain_memory_jobs(&root);
    });
}

struct MemoryJobWorkerGuard;

impl Drop for MemoryJobWorkerGuard {
    fn drop(&mut self) {
        MEMORY_JOB_WORKER_RUNNING.store(false, Ordering::SeqCst);
    }
}

pub(crate) fn drain_memory_jobs(root: &Path) -> AgentRuntimeResult<usize> {
    let _ = recover_interrupted_memory_jobs(root)?;
    let _ = promote_stability_pending_memory_candidates(root);
    let queue_depth = count_pending_memory_jobs(root).unwrap_or(0);
    let budget = super::memory_job_budget::drain_budget_for_queue_depth(queue_depth);
    let started = Instant::now();
    let mut processed = 0_usize;
    for _ in 0..budget.max_jobs {
        if started.elapsed().as_millis() >= budget.wall_ms {
            break;
        }
        let Some(job) = claim_next_memory_job(root)? else {
            break;
        };
        let job_started = Instant::now();
        let per_job_budget = super::memory_job_budget::per_job_time_budget_ms(&job.job_type);
        let result = process_memory_job(root, &job);
        if job_started.elapsed().as_millis() > per_job_budget {
            eprintln!(
                "memory job {} exceeded per-type budget ({}ms)",
                job.job_type, per_job_budget
            );
        }
        let status = if result.is_ok() {
            "completed"
        } else {
            "failed"
        };
        let result_value = match &result {
            Ok(value) => value.clone(),
            Err(error) => json!({ "error": error.to_string() }),
        };
        let _ = finish_memory_job(root, &job.id, status, result_value);
        if result.is_ok() {
            let _ = mark_memory_job_triggers_processed(root, &job);
            processed += 1;
        }
    }
    Ok(processed)
}

fn process_memory_job(root: &Path, job: &MemoryJobRecord) -> AgentRuntimeResult<Value> {
    match job.job_type.as_str() {
        EVENT_TOOL_CALL_COMPLETED | EVENT_FILE_CHANGE_RECORDED => {
            run_event_memory_extraction(root, job)
        }
        other => Err(AgentRuntimeError::Core(format!(
            "unsupported memory job type: {other}"
        ))),
    }
}

fn run_event_memory_extraction(root: &Path, job: &MemoryJobRecord) -> AgentRuntimeResult<Value> {
    let extraction = run_memory_agent_extraction_for_event(
        &job.session_id,
        &job.turn_id,
        &job.job_type,
        &job.payload,
    );
    let mutations = match extraction {
        Ok(mutations) => mutations,
        Err(error) => {
            return Ok(json!({
                "sessionId": job.session_id,
                "turnId": job.turn_id,
                "agent": "memory",
                "eventType": job.job_type,
                "skipped": true,
                "reason": error.to_string(),
                "candidates": [],
            }));
        }
    };
    let mut created = Vec::new();
    for mutation in mutations {
        created.push(process_extracted_candidate(
            root,
            &job.session_id,
            &job.turn_id,
            mutation,
        )?);
    }
    Ok(json!({
        "sessionId": job.session_id,
        "turnId": job.turn_id,
        "agent": "memory",
        "eventType": job.job_type,
        "candidates": created,
    }))
}

pub(crate) fn memory_trigger_from_tool(
    tool: &Value,
    session_id: &str,
    turn_id: &str,
) -> Option<MemoryTriggerEvent> {
    let status = tool.get("status").and_then(Value::as_str)?;
    if status != "finished" {
        return None;
    }
    let name = tool
        .get("name")
        .or_else(|| tool.pointer("/input/name"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let event_type = if is_file_change_tool(name) {
        EVENT_FILE_CHANGE_RECORDED
    } else {
        EVENT_TOOL_CALL_COMPLETED
    };
    Some(MemoryTriggerEvent {
        event_type: event_type.to_string(),
        session_id: session_id.to_string(),
        turn_id: turn_id.to_string(),
        payload: json!({
            "toolName": name,
            "toolId": tool.get("id").cloned().unwrap_or(Value::Null),
            "label": tool.get("label").cloned().unwrap_or(Value::Null),
            "output": tool.get("output").cloned().unwrap_or(Value::Null),
            "input": tool.get("input").cloned().unwrap_or(Value::Null),
            "evidence": {
                "toolName": name,
                "toolId": tool.get("id").cloned().unwrap_or(Value::Null),
                "output": tool.get("output").cloned().unwrap_or(Value::Null),
            },
        }),
    })
}

fn is_file_change_tool(name: &str) -> bool {
    matches!(
        name,
        "file_write"
            | "file_edit"
            | "file_strict_edit"
            | "file_multiedit"
            | "apply_patch"
            | "tool_fs_run"
    )
}
