//! Thin adapters from terminal protocol DTOs into durable memory operations.

use crate::memory;
use crate::{
    to_error, Result, TerminalArtifactsListRequest, TerminalCommandsReadRequest,
    TerminalEventsReadRequest, TerminalHandoffEventRequest, TerminalMemoryTimelineReadRequest,
    TerminalOutputPolicyMarkerRequest, TerminalOutputRangeReadRequest,
    TerminalPermissionEventRequest, TerminalStoredSessionsReadRequest,
};

fn number_to_byte_offset(value: f64) -> u64 {
    if !value.is_finite() || value <= 0.0 {
        return 0;
    }
    value.floor().min(u64::MAX as f64) as u64
}

fn optional_number_to_u64(value: Option<f64>) -> Option<u64> {
    value.map(number_to_byte_offset)
}

fn optional_number_to_i64(value: Option<f64>) -> Option<i64> {
    value.and_then(|value| {
        if !value.is_finite() {
            None
        } else if value <= i64::MIN as f64 {
            Some(i64::MIN)
        } else if value >= i64::MAX as f64 {
            Some(i64::MAX)
        } else {
            Some(value.floor() as i64)
        }
    })
}

pub(crate) fn read_memory_timeline(request: TerminalMemoryTimelineReadRequest) -> Result<String> {
    memory::read_timeline(memory::TimelineReadInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        cursor: request.cursor,
        limit: request.limit,
        kinds: request.kinds,
        actors: request.actors,
        command_id: request.command_id,
        tool_call_id: request.tool_call_id,
        agent_session_id: request.agent_session_id,
        seq_start: optional_number_to_u64(request.seq_start),
        seq_end: optional_number_to_u64(request.seq_end),
        time_start_ms: optional_number_to_i64(request.time_start_ms),
        time_end_ms: optional_number_to_i64(request.time_end_ms),
        audit: request.audit,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

pub(crate) fn read_events(request: TerminalEventsReadRequest) -> Result<String> {
    memory::read_events(memory::EventsReadInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        cursor: request.cursor,
        limit: request.limit,
        kinds: request.kinds,
        actors: request.actors,
        audit: request.audit,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

pub(crate) fn read_commands(request: TerminalCommandsReadRequest) -> Result<String> {
    memory::read_commands(memory::CommandsReadInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        cursor: request.cursor,
        limit: request.limit,
        status: request.status,
        audit: request.audit,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

pub(crate) fn read_output_range(request: TerminalOutputRangeReadRequest) -> Result<String> {
    memory::read_output_range(memory::OutputRangeReadInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        start: number_to_byte_offset(request.start),
        end: number_to_byte_offset(request.end),
        raw: request.raw.unwrap_or(false),
        audit: request.audit,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

pub(crate) fn list_artifacts(request: TerminalArtifactsListRequest) -> Result<String> {
    memory::list_artifacts(memory::ArtifactsListInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        audit: request.audit,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}

pub(crate) fn read_stored_sessions(request: TerminalStoredSessionsReadRequest) -> Result<String> {
    memory::read_stored_sessions(&request.storage_root).map_err(to_error)
}

fn map_permission_event_request(
    request: TerminalPermissionEventRequest,
) -> memory::PermissionEventInput {
    memory::PermissionEventInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        permission_id: request.permission_id,
        action: request.action,
        risk: request.risk,
        summary: request.summary,
        title: request.title,
        detail: request.detail,
        command_id: request.command_id,
        input_id: request.input_id,
        agent_session_id: request.agent_session_id,
        runtime_turn_id: request.runtime_turn_id,
        tool_call_id: request.tool_call_id,
        decision: request.decision,
        reason: request.reason,
        expires_at: request.expires_at,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    }
}

pub(crate) fn record_permission_requested(request: TerminalPermissionEventRequest) -> Result<()> {
    memory::record_permission_requested(map_permission_event_request(request)).map_err(to_error)
}

pub(crate) fn record_permission_granted(request: TerminalPermissionEventRequest) -> Result<()> {
    memory::record_permission_granted(map_permission_event_request(request)).map_err(to_error)
}

pub(crate) fn record_permission_denied(request: TerminalPermissionEventRequest) -> Result<()> {
    memory::record_permission_denied(map_permission_event_request(request)).map_err(to_error)
}

pub(crate) fn record_permission_expired(request: TerminalPermissionEventRequest) -> Result<()> {
    memory::record_permission_expired(map_permission_event_request(request)).map_err(to_error)
}

fn map_handoff_event_request(request: TerminalHandoffEventRequest) -> memory::HandoffEventInput {
    memory::HandoffEventInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        from_actor_json: request.from_actor_json,
        to_actor_json: request.to_actor_json,
        reason: request.reason,
        summary: request.summary,
        status: request.status,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    }
}

pub(crate) fn record_handoff_started(request: TerminalHandoffEventRequest) -> Result<()> {
    memory::record_handoff_started(map_handoff_event_request(request)).map_err(to_error)
}

pub(crate) fn record_handoff_completed(request: TerminalHandoffEventRequest) -> Result<()> {
    memory::record_handoff_completed(map_handoff_event_request(request)).map_err(to_error)
}

pub(crate) fn mark_output_policy(request: TerminalOutputPolicyMarkerRequest) -> Result<()> {
    memory::mark_output_policy(memory::OutputPolicyMarkerInput {
        storage_root: request.storage_root,
        session_id: request.session_id,
        start: number_to_byte_offset(request.start),
        end: number_to_byte_offset(request.end),
        policy: request.policy,
        reason: request.reason,
        encrypted_ref: request.encrypted_ref,
        actor_json: request.actor_json,
        correlation_json: request.correlation_json,
    })
    .map_err(to_error)
}
