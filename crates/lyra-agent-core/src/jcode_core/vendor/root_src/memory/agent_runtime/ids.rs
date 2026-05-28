use uuid::Uuid;

fn new_prefixed_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
}

pub fn new_session_id() -> String {
    new_prefixed_id("session")
}

pub fn new_runtime_turn_id() -> String {
    new_prefixed_id("turn")
}

pub fn new_event_id() -> String {
    new_prefixed_id("event")
}

pub fn new_context_snapshot_id() -> String {
    new_prefixed_id("context")
}

pub fn new_provider_request_id() -> String {
    new_prefixed_id("provider_request")
}

pub fn new_completion_audit_id() -> String {
    new_prefixed_id("completion_audit")
}

pub fn new_delivery_obligation_id() -> String {
    new_prefixed_id("delivery_obligation")
}

pub fn new_delivery_proof_id() -> String {
    new_prefixed_id("delivery_proof")
}

pub fn new_policy_ref_id() -> String {
    new_prefixed_id("policy_ref")
}

pub fn new_archive_id() -> String {
    new_prefixed_id("archive")
}

pub fn new_artifact_id() -> String {
    new_prefixed_id("artifact")
}

pub fn new_state_log_id() -> String {
    new_prefixed_id("state")
}

pub fn new_tool_call_id() -> String {
    new_prefixed_id("tool_call")
}

pub fn new_tool_result_id() -> String {
    new_prefixed_id("tool_result")
}

pub fn new_browser_target_id() -> String {
    new_prefixed_id("browser_target")
}

pub fn new_browser_action_id() -> String {
    new_prefixed_id("browser_action")
}

pub fn new_follow_session_id() -> String {
    new_prefixed_id("follow_session")
}

pub fn new_follow_action_id() -> String {
    new_prefixed_id("follow_action")
}

pub fn new_follow_frame_id() -> String {
    new_prefixed_id("follow_frame")
}

pub fn new_rollback_marker_id() -> String {
    new_prefixed_id("rollback_marker")
}

pub fn new_trim_batch_id() -> String {
    new_prefixed_id("trim")
}

pub fn new_shared_memory_id() -> String {
    new_prefixed_id("shared")
}

pub fn new_summary_id() -> String {
    new_prefixed_id("summary")
}
