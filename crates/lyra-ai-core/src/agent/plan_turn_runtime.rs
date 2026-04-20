use napi::Result;
use serde_json::{json, Value};

use crate::agent::plan_helpers::{
    build_plan_reentry_guidance, build_plan_scope_reset_guidance, summarize_proposed_plan,
};
use crate::agent::project_scope::project_name_from_root;
use crate::agent::prompt_pipeline::{build_plan_mode_system_prompt, PromptBuildInput};
use crate::agent::prompt_repetition::build_live_repeated_user_input;
use crate::agent::runtime_events::emit_event;
use crate::agent::session_management::{
    blank_plan_state, ensure_plan_state, normalize_project_root,
    synthesize_plan_approval_from_assistant_message,
};
use crate::agent::terminal_policy::select_terminal_interaction_policy;
use crate::agent::tools::{
    cleanup_transient_ai_sessions, get_browser_strategy_runtime_state,
    plan_mode_tool_definitions_for_input_with_context, render_activated_skill_prompts,
    render_mcp_tools_prompt_json,
};
use crate::agent::turn_entry::{
    acquire_turn_guard, agent_error, resolve_profile_for_turn_with_model,
};
use crate::agent::turn_runner::{
    browser_tool_families_prompt, build_tool_ranking_context, run_plan_implementation_handoff,
    run_provider_loop,
};
use crate::agent::turn_runtime_helpers::{
    emit_input_postprocessed, emit_memory_events, replace_latest_user_message, total_message_tokens,
};
use crate::agent::turn_strategy::select_turn_strategy;
use crate::agent::types::{
    AgentCollaborationMode, AgentSendTurnRequest, AgentSendTurnResult, AGENT_TURN_FAILED,
};
use crate::auth::service::resolve_secret_values;
use crate::auth::store::KeyringSecretStore;
use crate::error::normalize_required_text;
use crate::memory::{
    append_session_dialog_message, build_turn_context, initialize_session_storage,
};
use crate::provider::types::{AgentInferenceMessage, AgentInferenceMessageRole};
use crate::storage::registry_db;

pub(crate) struct PlanTurnRuntimeOutcome {
    pub result: AgentSendTurnResult,
    pub optimization_state: Option<Value>,
}

pub(crate) fn execute_plan_turn(
    request: AgentSendTurnRequest,
    resume_optimization_state_payload: Option<Value>,
) -> Result<PlanTurnRuntimeOutcome> {
    let storage_root = normalize_required_text(&request.storage_root, "storageRoot")?;
    let session_id = normalize_required_text(&request.session_id, "sessionId")?;
    let input = normalize_required_text(&request.input, "input")?;
    let _turn_guard = acquire_turn_guard(&session_id)?;
    initialize_session_storage(&storage_root, &session_id)?;
    let mut session =
        registry_db::read_agent_session(&storage_root, &session_id)?.ok_or_else(|| {
            agent_error(
                AGENT_TURN_FAILED,
                format!("session not found: {session_id}"),
            )
        })?;
    let previous_project_root = session.project_root.clone();
    let requested_project_root = request
        .project_root
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut project_scope_changed = false;
    if let Some(project_root) = requested_project_root {
        let normalized_root = normalize_project_root(project_root)?;
        let project_name = project_name_from_root(&normalized_root);
        if session.project_root.as_deref() != Some(normalized_root.as_str())
            || session.project_name.as_deref() != project_name.as_deref()
        {
            project_scope_changed =
                previous_project_root.as_deref() != Some(normalized_root.as_str());
            session = registry_db::update_agent_session_project(
                &storage_root,
                &session_id,
                Some(normalized_root.clone()),
                project_name,
            )?;
        }
    }
    let effective_project_root = session.project_root.clone();
    let requested_profile_id = request
        .profile_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let requested_model = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let profile = resolve_profile_for_turn_with_model(
        &storage_root,
        &session,
        requested_profile_id,
        requested_model,
    )?;
    if session.profile_id.as_deref() != Some(profile.id.as_str()) {
        session = registry_db::update_agent_session_profile(
            &storage_root,
            &session_id,
            Some(profile.id.clone()),
        )?;
    }
    let running_turn = registry_db::create_agent_turn(&storage_root, &session_id, &profile.id)?;
    let user_message =
        registry_db::append_agent_message(&storage_root, &session_id, None, "user", &input)?;
    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "accepted",
        json!({ "messageId": user_message.id, "profileId": profile.id, "collaborationMode": "plan" }),
    )?;
    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "started",
        json!({
            "profileId": profile.id,
            "providerId": profile.provider_id,
            "protocolId": profile.protocol_id,
            "model": profile.model,
            "collaborationMode": "plan",
        }),
    )?;
    let user_memory_events = append_session_dialog_message(
        &storage_root,
        &session_id,
        &user_message.id,
        "user",
        &input,
        Some(&running_turn.id),
        effective_project_root.as_deref(),
    )?;
    emit_memory_events(
        &storage_root,
        &session_id,
        &running_turn.id,
        user_memory_events,
    )?;
    let secrets = resolve_secret_values(&profile.secret_refs, None, &KeyringSecretStore)?;
    let tool_ranking_context = build_tool_ranking_context(&storage_root, &session_id)?;
    let tools =
        plan_mode_tool_definitions_for_input_with_context(&input, Some(&tool_ranking_context));
    let terminal_policy = select_terminal_interaction_policy();
    let turn_context = build_turn_context(
        &storage_root,
        &session_id,
        &profile.to_public(),
        effective_project_root.as_deref(),
    )?;
    let turn_number = registry_db::list_agent_turns(&storage_root, &session_id)?.len();
    let activated_skill_prompts = render_activated_skill_prompts();
    let mcp_tools_json = render_mcp_tools_prompt_json();
    let plan_state = if project_scope_changed {
        registry_db::upsert_agent_plan(&storage_root, &session_id, &blank_plan_state())?
    } else {
        ensure_plan_state(&storage_root, &session_id)?
    };
    let reentry_guidance = if project_scope_changed {
        build_plan_scope_reset_guidance(effective_project_root.as_deref())
    } else {
        build_plan_reentry_guidance(Some(&plan_state))
    };
    let browser_strategy_state = get_browser_strategy_runtime_state();
    let browser_tool_families = browser_tool_families_prompt();
    let workbench_web_context = tool_ranking_context.workbench_web.as_ref();
    let focus_atlas_status = workbench_web_context.map(|web| {
        if web.focus_atlas_ready {
            if web.last_focus_probe_verified {
                "ready (probe_verified)"
            } else {
                "ready"
            }
        } else {
            "not_ready"
        }
    });
    let prompt_result = build_plan_mode_system_prompt(
        &PromptBuildInput {
            session_id: &session_id,
            turn_number,
            user_input: &input,
            project_root: effective_project_root.as_deref(),
            memory_snapshot: &turn_context.memory_snapshot,
            activated_skill_prompts: &activated_skill_prompts,
            mcp_tools_json: &mcp_tools_json,
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &select_turn_strategy(&input),
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: browser_strategy_state.preferred_engine.as_deref(),
            browser_use_health: browser_strategy_state.browser_use_health.as_deref(),
            browser_tool_families: &browser_tool_families,
            browser_page_mode: workbench_web_context.and_then(|web| web.page_mode.as_deref()),
            focus_atlas_status,
            active_widget_id: workbench_web_context.and_then(|web| web.active_widget_id.as_deref()),
            active_item_id: workbench_web_context.and_then(|web| web.active_item_id.as_deref()),
            active_focus_region_id: workbench_web_context
                .and_then(|web| web.active_focus_region_id.as_deref()),
            current_browser_subgoal: workbench_web_context
                .and_then(|web| web.current_browser_subgoal.as_deref()),
            last_reveal_observed: workbench_web_context.map(|web| {
                if web.last_reveal_observed {
                    "yes"
                } else {
                    "no"
                }
            }),
            last_workflow_failure: workbench_web_context
                .and_then(|web| web.last_workflow_failure.as_deref()),
        },
        Some(&plan_state),
        &reentry_guidance,
    );
    let system_message = AgentInferenceMessage {
        role: AgentInferenceMessageRole::System,
        content: prompt_result.prompt.clone(),
        tool_call_id: None,
        tool_calls: Vec::new(),
    };
    let mut provider_messages = turn_context.messages;
    provider_messages.insert(0, system_message.clone());
    let repeated_main_input = build_live_repeated_user_input(
        &input,
        total_message_tokens(&provider_messages),
        profile.model.as_str(),
    );
    let _ = replace_latest_user_message(
        &mut provider_messages,
        &repeated_main_input.transformed_input,
    );
    emit_event(
        &storage_root,
        &session_id,
        &running_turn.id,
        "prompt_compiled",
        json!({
            "collaborationMode": "plan",
            "totalTokens": prompt_result.total_tokens,
            "sectionTokens": prompt_result.section_tokens,
            "truncatedSections": prompt_result.truncated_sections,
            "truncated": !prompt_result.truncated_sections.is_empty(),
        }),
    )?;
    emit_input_postprocessed(
        &storage_root,
        &session_id,
        &running_turn.id,
        "main",
        &repeated_main_input,
    )?;
    let (turn, assistant_message, tool_calls, usage, approved_plan, optimization_state) =
        run_provider_loop(
            &storage_root,
            &session_id,
            &running_turn,
            &input,
            &profile,
            &secrets,
            system_message,
            provider_messages,
            tools,
            effective_project_root.clone(),
            &terminal_policy,
            false,
            true,
            false,
            usize::MAX,
            resume_optimization_state_payload,
        )?;
    cleanup_transient_ai_sessions(&session_id, &running_turn.id);

    if let Some(approved_plan) = approved_plan {
        registry_db::set_agent_session_collaboration_mode(
            &storage_root,
            &session_id,
            AgentCollaborationMode::Default,
        )?;
        emit_event(
            &storage_root,
            &session_id,
            &running_turn.id,
            "plan_mode_exited",
            json!({
                "reason": "approved_and_implement",
            }),
        )?;
        let handoff = run_plan_implementation_handoff(
            &storage_root,
            &session_id,
            &input,
            &request,
            &profile,
            &session,
            &approved_plan,
        )?;
        return Ok(PlanTurnRuntimeOutcome {
            result: handoff,
            optimization_state: None,
        });
    }

    if let Some(message) = assistant_message.as_ref() {
        synthesize_plan_approval_from_assistant_message(
            &storage_root,
            &session_id,
            &running_turn.id,
            &message.content,
            summarize_proposed_plan,
        )?;
    }

    let next_session =
        registry_db::read_agent_session(&storage_root, &session_id)?.unwrap_or(session);
    Ok(PlanTurnRuntimeOutcome {
        result: AgentSendTurnResult {
            session: next_session,
            turn,
            assistant_message,
            tool_calls,
            usage,
        },
        optimization_state,
    })
}
