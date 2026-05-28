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
use lyra_agent_core::{
    agent_memory_audit_json, agent_memory_recover_run_json, agent_memory_shared_search_json,
    agent_memory_shared_update_json, agent_memory_snapshot_json, agent_memory_trim_run_json,
    archive_session_json, bind_project_session_json, cancel_jcode_overnight_json, cancel_turn_json,
    compact_jcode_session_json, complete_jcode_account_login_json, create_session_json,
    delete_session_json, git_diff_json, git_discard_json, git_stage_json, git_status_json,
    git_unstage_json, list_jcode_accounts_json, list_jcode_goals_json,
    list_jcode_login_providers_json, list_jcode_models_json, list_jcode_overnight_json,
    list_jcode_sessions_json, log_jcode_overnight_json, login_jcode_account_json,
    open_jcode_goals_json, preview_rollback_json, read_jcode_config_json, read_session_json,
    refactor_session_json, refresh_jcode_models_json, remove_jcode_account_json,
    rename_session_json, respond_clarification_json, respond_permission_json,
    restore_rollback_json, resume_jcode_goal_json, review_jcode_overnight_json,
    run_improve_session_json, run_jcode_btw_json, run_jcode_subagent_json, run_judge_session_json,
    run_review_session_json, save_jcode_provider_profile_json, save_session_json,
    selfdev_status_json, send_selfdev_turn_json, send_turn_json, show_jcode_goal_json,
    split_jcode_session_json, start_jcode_account_login_json, start_jcode_overnight_json,
    start_selfdev_session_json, status_jcode_overnight_json, switch_jcode_account_json,
    switch_jcode_model_json, transfer_jcode_session_json, trigger_poke_session_json,
    unsave_session_json, update_jcode_agent_roles_json, update_jcode_config_json,
    update_jcode_provider_options_json, update_jcode_session_automation_json,
};
use lyra_download_core::{
    cancel_all_downloads_json, cancel_download_json, download_remote_status_json,
    enqueue_download_json, import_external_browser_downloads_json, list_downloads_json,
    pause_all_downloads_json, pause_download_json, read_download_settings_json,
    remove_download_json, resume_all_downloads_json, resume_download_json, retry_download_json,
    set_download_priority_json, start_download_remote_json, stop_download_remote_json,
    update_download_settings_json,
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

fn to_value<T: Serialize>(value: &T) -> Result<Value, RuntimeError> {
    serde_json::to_value(value)
        .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
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
        method if method.starts_with("lsp.") => handle_lsp_request(method, payload),
        method if method.starts_with("download.") => handle_download_request(method, payload),
        method if method.starts_with("agent.") => handle_agent_request(method, payload),
        method if method.starts_with("jcode.") => handle_jcode_request(method, payload),
        other => Err(runtime_error(
            "METHOD_NOT_FOUND",
            format!("unknown runtime method: {other}"),
        )),
    }
}

fn handle_agent_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "agent.session.create" => call_json(payload, create_session_json),
        "agent.session.read" => call_json(payload, read_session_json),
        "agent.session.list" => call_json(payload, list_jcode_sessions_json),
        "agent.session.save" => call_json(payload, save_session_json),
        "agent.session.unsave" => call_json(payload, unsave_session_json),
        "agent.session.rename" => call_json(payload, rename_session_json),
        "agent.session.archive" => call_json(payload, archive_session_json),
        "agent.session.delete" => call_json(payload, delete_session_json),
        "agent.session.bindProject" => call_json(payload, bind_project_session_json),
        "agent.selfdev.start" => call_json(payload, start_selfdev_session_json),
        "agent.selfdev.status" => call_json(payload, selfdev_status_json),
        "agent.selfdev.sendTurn" => call_json(payload, send_selfdev_turn_json),
        "agent.turn.send" => call_json(payload, send_turn_json),
        "agent.turn.start" => call_json(payload, send_turn_json),
        "agent.turn.resume" => call_json(payload, send_turn_json),
        "agent.turn.cancel" => call_json(payload, cancel_turn_json),
        "agent.turn.retry" => call_json(payload, send_turn_json),
        "agent.memory.snapshot" => call_json(payload, agent_memory_snapshot_json),
        "agent.memory.audit" => call_json(payload, agent_memory_audit_json),
        "agent.memory.trim.run" => call_json(payload, agent_memory_trim_run_json),
        "agent.memory.recover.run" => call_json(payload, agent_memory_recover_run_json),
        "agent.memory.shared.search" => call_json(payload, agent_memory_shared_search_json),
        "agent.memory.shared.update" => call_json(payload, agent_memory_shared_update_json),
        "agent.rollback.preview" => call_json(payload, preview_rollback_json),
        "agent.rollback.restore" => call_json(payload, restore_rollback_json),
        "agent.git.status" => call_json(payload, git_status_json),
        "agent.git.diff" => call_json(payload, git_diff_json),
        "agent.git.stage" => call_json(payload, git_stage_json),
        "agent.git.unstage" => call_json(payload, git_unstage_json),
        "agent.git.discard" => call_json(payload, git_discard_json),
        "agent.permission.respond" => call_json(payload, respond_permission_json),
        "agent.clarification.respond" => call_json(payload, respond_clarification_json),
        _ => unknown_method("agent", method),
    }
}

fn handle_jcode_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "jcode.config.read" => call_json(payload, read_jcode_config_json),
        "jcode.config.update" => call_json(payload, update_jcode_config_json),
        "jcode.provider.profile.save" => call_json(payload, save_jcode_provider_profile_json),
        "jcode.sessions.list" => call_json(payload, list_jcode_sessions_json),
        "jcode.models.list" => call_json(payload, list_jcode_models_json),
        "jcode.model.switch" => call_json(payload, switch_jcode_model_json),
        "jcode.model.refresh" => call_json(payload, refresh_jcode_models_json),
        "jcode.provider.options.update" => call_json(payload, update_jcode_provider_options_json),
        "jcode.agent-roles.update" => call_json(payload, update_jcode_agent_roles_json),
        "jcode.improve.run" => call_json(payload, run_improve_session_json),
        "jcode.refactor.run" => call_json(payload, refactor_session_json),
        "jcode.poke.trigger" => call_json(payload, trigger_poke_session_json),
        "jcode.review.run" => call_json(payload, run_review_session_json),
        "jcode.judge.run" => call_json(payload, run_judge_session_json),
        "jcode.subagent.run" => call_json(payload, run_jcode_subagent_json),
        "jcode.btw.run" => call_json(payload, run_jcode_btw_json),
        "jcode.session.split" => call_json(payload, split_jcode_session_json),
        "jcode.session.transfer" => call_json(payload, transfer_jcode_session_json),
        "jcode.session.compact" => call_json(payload, compact_jcode_session_json),
        "jcode.session.automation.update" => {
            call_json(payload, update_jcode_session_automation_json)
        }
        "jcode.goals.list" => call_json(payload, list_jcode_goals_json),
        "jcode.goals.open" => call_json(payload, open_jcode_goals_json),
        "jcode.goals.resume" => call_json(payload, resume_jcode_goal_json),
        "jcode.goals.show" => call_json(payload, show_jcode_goal_json),
        "jcode.accounts.list" => call_json(payload, list_jcode_accounts_json),
        "jcode.accounts.login" => call_json(payload, login_jcode_account_json),
        "jcode.accounts.loginProviders" => call_json(payload, list_jcode_login_providers_json),
        "jcode.accounts.loginStart" => call_json(payload, start_jcode_account_login_json),
        "jcode.accounts.loginComplete" => call_json(payload, complete_jcode_account_login_json),
        "jcode.accounts.switch" => call_json(payload, switch_jcode_account_json),
        "jcode.accounts.remove" => call_json(payload, remove_jcode_account_json),
        "jcode.overnight.start" => call_json(payload, start_jcode_overnight_json),
        "jcode.overnight.list" => call_json(payload, list_jcode_overnight_json),
        "jcode.overnight.status" => call_json(payload, status_jcode_overnight_json),
        "jcode.overnight.log" => call_json(payload, log_jcode_overnight_json),
        "jcode.overnight.review" => call_json(payload, review_jcode_overnight_json),
        "jcode.overnight.cancel" => call_json(payload, cancel_jcode_overnight_json),
        "jcode.session.read" => call_json(payload, read_session_json),
        "jcode.session.create" => call_json(payload, create_session_json),
        "jcode.turn.send" => call_json(payload, send_turn_json),
        "jcode.turn.cancel" => call_json(payload, cancel_turn_json),
        _ => unknown_method("jcode", method),
    }
}

fn handle_download_request(method: &str, payload: Value) -> Result<Value, RuntimeError> {
    match method {
        "download.list" => call_json(payload, list_downloads_json),
        "download.enqueue" => call_json(payload, enqueue_download_json),
        "download.import_external_browser" => {
            call_json(payload, import_external_browser_downloads_json)
        }
        "download.pause" => call_json(payload, pause_download_json),
        "download.resume" => call_json(payload, resume_download_json),
        "download.cancel" => call_json(payload, cancel_download_json),
        "download.retry" => call_json(payload, retry_download_json),
        "download.remove" => call_void(payload, remove_download_json),
        "download.set_priority" => call_json(payload, set_download_priority_json),
        "download.pause_all" => call_json(payload, pause_all_downloads_json),
        "download.resume_all" => call_json(payload, resume_all_downloads_json),
        "download.cancel_all" => call_json(payload, cancel_all_downloads_json),
        "download.settings.read" => call_json(payload, read_download_settings_json),
        "download.settings.update" => call_json(payload, update_download_settings_json),
        "download.remote.status" => call_json(payload, download_remote_status_json),
        "download.remote.start" => call_json(payload, start_download_remote_json),
        "download.remote.stop" => call_json(payload, stop_download_remote_json),
        _ => unknown_method("download", method),
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
