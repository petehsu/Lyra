use super::memory_event_trigger::{
    EVENT_DECISION_RECORDED, EVENT_FILE_CHANGE_RECORDED, EVENT_TOOL_CALL_COMPLETED,
    EVENT_TURN_COMPLETED,
};
use super::memory_token_checkpoint::EVENT_TOKEN_CHECKPOINT;

#[derive(Clone, Debug)]
pub(crate) struct JobDrainBudget {
    pub(crate) max_jobs: usize,
    pub(crate) wall_ms: u128,
    pub(crate) degraded: bool,
}

const BASE_MAX_JOBS: usize = 8;
const BASE_WALL_MS: u128 = 12_000;
const DEGRADED_MAX_JOBS: usize = 3;
const DEGRADED_WALL_MS: u128 = 4_000;
const DEGRADE_QUEUE_DEPTH: usize = 24;

pub(crate) fn drain_budget_for_queue_depth(depth: usize) -> JobDrainBudget {
    if depth >= DEGRADE_QUEUE_DEPTH {
        JobDrainBudget {
            max_jobs: DEGRADED_MAX_JOBS,
            wall_ms: DEGRADED_WALL_MS,
            degraded: true,
        }
    } else {
        JobDrainBudget {
            max_jobs: BASE_MAX_JOBS,
            wall_ms: BASE_WALL_MS,
            degraded: false,
        }
    }
}

pub(crate) fn job_type_priority(job_type: &str) -> i32 {
    match job_type {
        EVENT_TURN_COMPLETED => 0,
        EVENT_TOOL_CALL_COMPLETED | EVENT_FILE_CHANGE_RECORDED => 10,
        EVENT_DECISION_RECORDED => 20,
        EVENT_TOKEN_CHECKPOINT => 30,
        _ => 40,
    }
}

pub(crate) fn per_job_time_budget_ms(job_type: &str) -> u128 {
    match job_type {
        EVENT_TURN_COMPLETED => 6_000,
        EVENT_TOOL_CALL_COMPLETED | EVENT_FILE_CHANGE_RECORDED | EVENT_DECISION_RECORDED => 4_000,
        EVENT_TOKEN_CHECKPOINT => 3_000,
        _ => 2_000,
    }
}

pub(crate) fn job_type_order_clause() -> &'static str {
    "CASE job_type
        WHEN 'turn_completed' THEN 0
        WHEN 'tool_call_completed' THEN 10
        WHEN 'file_change_recorded' THEN 10
        WHEN 'decision_recorded' THEN 20
        WHEN 'token_checkpoint' THEN 30
        ELSE 40
     END ASC, created_at ASC"
}
