use crate::handlers::{handle_lsp_request, handle_terminal_request};
use crate::modules::code_intel::{
    expand_code_graph_json, read_code_index_status_json, rebuild_code_index_json,
    search_code_symbol_json, search_code_text_json,
};
use crate::modules::fs::{
    read_search_index_status_json, rebuild_search_index_json, search_local_json,
    search_local_stream_cancel_json, search_local_stream_read_json, search_local_stream_start_json,
};
use crate::modules::web::{
    search_site_stream_cancel_json, search_site_stream_read_json, search_site_stream_start_json,
};
use lyra_ai_core::{
    append_agent_follow_live_edit_json, apply_agent_patch_json,
    apply_agent_vm_inheritance_profile_json, attach_agent_vm_json, cancel_agent_turn_json,
    commit_agent_follow_live_edit_json, create_agent_plan_json, create_agent_session_json,
    create_agent_todo_json, create_agent_vm_inheritance_profile_json, create_agent_vm_json,
    delete_model_profile_json, discard_agent_follow_live_edit_json, discover_models_json,
    download_agent_vm_image_json, execute_agent_message_rollback_json, fork_agent_vm_json,
    import_agent_vm_image_json, list_agent_sessions_json, list_agent_vm_bindings_json,
    list_agent_vm_images_json, list_agent_vms_json, pause_agent_follow_json,
    preview_agent_message_rollback_json, read_agent_artifact_json, read_agent_follow_json,
    read_agent_rollback_preview_json, read_agent_session_json, read_agent_vm_binding_json,
    read_agent_vm_password_metadata_json, read_agent_vm_status_json, read_model_config_json,
    resolve_agent_approval_json, resolve_agent_clarification_json, resolve_agent_plan_review_json,
    resume_agent_follow_json, reveal_agent_vm_password_json, revoke_agent_vm_binding_json,
    rollback_agent_to_turn_json, send_agent_turn_json, start_agent_follow_live_edit_json,
    start_agent_vm_json, stop_agent_vm_json, takeover_agent_vm_json, update_agent_session_json,
    upsert_model_profile_json,
};
use lyra_mcp_core::{
    call_mcp_runtime_tool_json, create_mcp_server_from_template_json, delete_mcp_secret_refs_json,
    materialize_mcp_runtime_environment_json, merge_mcp_effective_config_json,
    normalize_mcp_environment_input_json, read_mcp_runtime_introspection_json,
    read_mcp_runtime_statuses_json, read_mcp_scope_document_json, read_mcp_secret_store_json,
    restart_mcp_runtime_json, sanitize_mcp_environment_json, start_mcp_runtime_json,
    stop_mcp_runtime_json, validate_mcp_server_json, write_mcp_managed_manifest_json,
    write_mcp_scope_document_json, write_mcp_secret_store_json,
};
use lyra_runtime_protocol::{HandshakeRequest, HandshakeResponse, RuntimeError, PROTOCOL_VERSION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub(crate) fn runtime_error(code: &str, message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(code, message.into())
}

fn map_runtime_error(error: impl std::fmt::Display) -> RuntimeError {
    runtime_error("RUNTIME_ERROR", error.to_string())
}

fn json_request(payload: Value) -> Result<String, RuntimeError> {
    serde_json::to_string(&payload)
        .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
}

fn parse_json_result(payload: String) -> Result<Value, RuntimeError> {
    serde_json::from_str(&payload)
        .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))
}

fn call_json<E>(
    payload: Value,
    handler: impl FnOnce(String) -> Result<String, E>,
) -> Result<Value, RuntimeError>
where
    E: std::fmt::Display,
{
    let response_json = handler(json_request(payload)?).map_err(map_runtime_error)?;
    parse_json_result(response_json)
}

fn call_json_noarg<E>(handler: impl FnOnce() -> Result<String, E>) -> Result<Value, RuntimeError>
where
    E: std::fmt::Display,
{
    parse_json_result(handler().map_err(map_runtime_error)?)
}

fn call_void<E>(
    payload: Value,
    handler: impl FnOnce(String) -> Result<(), E>,
) -> Result<Value, RuntimeError>
where
    E: std::fmt::Display,
{
    handler(json_request(payload)?).map_err(map_runtime_error)?;
    Ok(Value::Null)
}

fn call_approval_decision(mut payload: Value, decision: &str) -> Result<Value, RuntimeError> {
    let Some(object) = payload.as_object_mut() else {
        return Err(runtime_error(
            "BAD_REQUEST",
            "approval payload must be an object",
        ));
    };
    object.insert("decision".to_string(), Value::String(decision.to_string()));
    call_json(payload, resolve_agent_approval_json)
}

fn to_value<T: Serialize>(value: &T) -> Result<Value, RuntimeError> {
    serde_json::to_value(value)
        .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
}

pub(crate) fn handle_ai_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "model.config.read" => call_json(payload, read_model_config_json),
        "model.profile.upsert" => call_json(payload, upsert_model_profile_json),
        "model.profile.delete" => call_void(payload, delete_model_profile_json),
        "model.models.discover" => call_json(payload, discover_models_json),
        "agent.sessions.list" => call_json(payload, list_agent_sessions_json),
        "agent.sessions.create" => call_json(payload, create_agent_session_json),
        "agent.sessions.read" => call_json(payload, read_agent_session_json),
        "agent.sessions.update" => call_json(payload, update_agent_session_json),
        "agent.follow.read" => call_json(payload, read_agent_follow_json),
        "agent.follow.pause" => call_json(payload, pause_agent_follow_json),
        "agent.follow.resume" => call_json(payload, resume_agent_follow_json),
        "agent.follow.live_edit.start" => call_json(payload, start_agent_follow_live_edit_json),
        "agent.follow.live_edit.append" => call_json(payload, append_agent_follow_live_edit_json),
        "agent.follow.live_edit.commit" => call_json(payload, commit_agent_follow_live_edit_json),
        "agent.follow.live_edit.discard" => call_json(payload, discard_agent_follow_live_edit_json),
        "agent.rollback.read" => call_json(payload, read_agent_rollback_preview_json),
        "agent.rollback.preview" => call_json(payload, preview_agent_message_rollback_json),
        "agent.rollback.execute" => call_json(payload, execute_agent_message_rollback_json),
        "agent.rollback.to_turn" => call_json(payload, rollback_agent_to_turn_json),
        "agent.turn.send" => call_json(payload, send_agent_turn_json),
        "agent.turn.cancel" => call_json(payload, cancel_agent_turn_json),
        "agent.todo.create" => call_json(payload, create_agent_todo_json),
        "agent.plan.create" => call_json(payload, create_agent_plan_json),
        "agent.plan.review.resolve" => call_json(payload, resolve_agent_plan_review_json),
        "agent.clarification.resolve" => call_json(payload, resolve_agent_clarification_json),
        "agent.artifact.read" => call_json(payload, read_agent_artifact_json),
        "agent.patch.apply" => call_json(payload, apply_agent_patch_json),
        "agent.approval.resolve" => call_json(payload, resolve_agent_approval_json),
        "agent.approval.approve_and_resume_tool" => call_approval_decision(payload, "approve"),
        "agent.approval.deny_and_resume_tool" => call_approval_decision(payload, "deny"),
        "agent.vm.list" => call_json(payload, list_agent_vms_json),
        "agent.vm.images.list" => call_json(payload, list_agent_vm_images_json),
        "agent.vm.image.download" => call_json(payload, download_agent_vm_image_json),
        "agent.vm.image.import" => call_json(payload, import_agent_vm_image_json),
        "agent.vm.create" => call_json(payload, create_agent_vm_json),
        "agent.vm.bindings.list" => call_json(payload, list_agent_vm_bindings_json),
        "agent.vm.binding.read" => call_json(payload, read_agent_vm_binding_json),
        "agent.vm.attach" => call_json(payload, attach_agent_vm_json),
        "agent.vm.takeover" => call_json(payload, takeover_agent_vm_json),
        "agent.vm.fork" => call_json(payload, fork_agent_vm_json),
        "agent.vm.binding.revoke" => call_json(payload, revoke_agent_vm_binding_json),
        "agent.vm.inheritance.create" => {
            call_json(payload, create_agent_vm_inheritance_profile_json)
        }
        "agent.vm.inheritance.apply" => call_json(payload, apply_agent_vm_inheritance_profile_json),
        "agent.vm.status" => call_json(payload, read_agent_vm_status_json),
        "agent.vm.start" => call_json(payload, start_agent_vm_json),
        "agent.vm.stop" => call_json(payload, stop_agent_vm_json),
        "agent.vm.password.metadata" => call_json(payload, read_agent_vm_password_metadata_json),
        "agent.vm.password.reveal" => call_json(payload, reveal_agent_vm_password_json),
        _ => unknown_method("ai", method),
    }
}

pub(crate) fn handle_runtime_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "runtime.handshake" => {
            let request: HandshakeRequest = from_payload(payload)?;
            if request.protocol_version != PROTOCOL_VERSION {
                return Err(runtime_error(
                    "PROTOCOL_VERSION_MISMATCH",
                    format!(
                        "expected protocol version {}, got {}",
                        PROTOCOL_VERSION, request.protocol_version
                    ),
                ));
            }
            to_value(&HandshakeResponse {
                protocol_version: PROTOCOL_VERSION,
                server_name: crate::RUNTIME_NAME.to_string(),
            })
        }
        "runtime.reload" => Ok(json!({
            "status": "reloaded",
            "detail": "runtime modules will use latest persisted configuration on subsequent calls"
        })),
        method if method.starts_with("code.") => handle_code_request(method, payload),
        method if method.starts_with("search.") => handle_search_request(method, payload),
        method if method.starts_with("terminal.") => handle_terminal_request(method, payload),
        method if method.starts_with("mcp.") => handle_mcp_request(method, payload),
        method if method.starts_with("lsp.") => handle_lsp_request(method, payload),
        method if method.starts_with("model.") || method.starts_with("agent.") => {
            handle_ai_request(method, payload)
        }
        other => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unknown runtime method: {other}"),
        )),
    }
}

fn handle_mcp_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "mcp.read_scope_document" => call_json(payload, read_mcp_scope_document_json),
        "mcp.write_scope_document" => call_void(payload, write_mcp_scope_document_json),
        "mcp.read_secret_store" => call_json(payload, read_mcp_secret_store_json),
        "mcp.write_secret_store" => call_void(payload, write_mcp_secret_store_json),
        "mcp.sanitize_environment" => call_json(payload, sanitize_mcp_environment_json),
        "mcp.normalize_environment_input" => {
            call_json(payload, normalize_mcp_environment_input_json)
        }
        "mcp.delete_secret_refs" => call_json(payload, delete_mcp_secret_refs_json),
        "mcp.merge_effective_config" => call_json(payload, merge_mcp_effective_config_json),
        "mcp.validate_server" => call_json(payload, validate_mcp_server_json),
        "mcp.write_managed_manifest" => call_void(payload, write_mcp_managed_manifest_json),
        "mcp.materialize_runtime_environment" => {
            call_json(payload, materialize_mcp_runtime_environment_json)
        }
        "mcp.create_server_from_template" => {
            call_json(payload, create_mcp_server_from_template_json)
        }
        "mcp.read_runtime_statuses" => call_json_noarg(read_mcp_runtime_statuses_json),
        "mcp.read_runtime_introspection" => call_json(payload, read_mcp_runtime_introspection_json),
        "mcp.call_tool" => call_json(payload, call_mcp_runtime_tool_json),
        "mcp.start_runtime" => call_json(payload, start_mcp_runtime_json),
        "mcp.stop_runtime" => call_json(payload, stop_mcp_runtime_json),
        "mcp.restart_runtime" => call_json(payload, restart_mcp_runtime_json),
        _ => unknown_method("mcp", method),
    }
}

fn handle_search_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "search.local" => call_json(payload, search_local_json),
        "search.local.stream.start" => call_json(payload, search_local_stream_start_json),
        "search.local.stream.read" => call_json(payload, search_local_stream_read_json),
        "search.local.stream.cancel" => call_json(payload, search_local_stream_cancel_json),
        "search.index.status" => call_json(payload, read_search_index_status_json),
        "search.index.rebuild" => call_json(payload, rebuild_search_index_json),
        "search.site.stream.start" => call_json(payload, search_site_stream_start_json),
        "search.site.stream.read" => call_json(payload, search_site_stream_read_json),
        "search.site.stream.cancel" => call_json(payload, search_site_stream_cancel_json),
        _ => unknown_method("search", method),
    }
}

fn handle_code_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "code.index.status" => call_json(payload, read_code_index_status_json),
        "code.index.rebuild" => call_json(payload, rebuild_code_index_json),
        "code.search.text" => call_json(payload, search_code_text_json),
        "code.search.symbol" => call_json(payload, search_code_symbol_json),
        "code.graph.expand" => call_json(payload, expand_code_graph_json),
        _ => unknown_method("code", method),
    }
}

fn from_payload<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, RuntimeError> {
    serde_json::from_value(payload).map_err(|error| runtime_error("BAD_REQUEST", error.to_string()))
}

fn unknown_method(scope: &str, method: &str) -> Result<Value, RuntimeError> {
    Err(runtime_error(
        "METHOD_NOT_FOUND",
        format!("unknown {scope} runtime method: {method}"),
    ))
}
