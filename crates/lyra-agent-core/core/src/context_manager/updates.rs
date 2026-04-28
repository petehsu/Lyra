use crate::environment_context::EnvironmentContext;
use crate::session::PreviousTurnSettings;
use crate::session::turn_context::TurnContext;
use crate::shell::Shell;
use lyra_execpolicy::Policy;
use lyra_features::Feature;
use lyra_protocol::models::ContentItem;
use lyra_protocol::models::DeveloperInstructions;
use lyra_protocol::models::ResponseItem;
use lyra_protocol::protocol::TurnContextItem;

fn build_environment_update_item(
    previous: Option<&TurnContextItem>,
    next: &TurnContext,
    shell: &Shell,
) -> Option<ResponseItem> {
    if !next.config.include_environment_context {
        return None;
    }

    let prev = previous?;
    let prev_context = EnvironmentContext::from_turn_context_item(prev, shell);
    let next_context = EnvironmentContext::from_turn_context(next, shell);
    if prev_context.equals_except_shell(&next_context) {
        return None;
    }

    Some(ResponseItem::from(
        EnvironmentContext::diff_from_turn_context_item(prev, next, shell),
    ))
}

fn build_permissions_update_item(
    previous: Option<&TurnContextItem>,
    next: &TurnContext,
    exec_policy: &Policy,
) -> Option<DeveloperInstructions> {
    if !next.config.include_permissions_instructions {
        return None;
    }

    let prev = previous?;
    if prev.sandbox_policy == *next.sandbox_policy.get()
        && prev.approval_policy == next.approval_policy.value()
    {
        return None;
    }

    Some(DeveloperInstructions::from_policy(
        next.sandbox_policy.get(),
        next.approval_policy.value(),
        next.config.approvals_reviewer,
        exec_policy,
        &next.cwd,
        next.features.enabled(Feature::ExecPermissionApprovals),
        next.features.enabled(Feature::RequestPermissionsTool),
    ))
}

fn build_collaboration_mode_update_item(
    previous: Option<&TurnContextItem>,
    next: &TurnContext,
) -> Option<DeveloperInstructions> {
    let prev = previous?;
    if prev.collaboration_mode.as_ref() != Some(&next.collaboration_mode) {
        // If the next mode has empty developer instructions, this returns None and we emit no
        // update, so prior collaboration instructions remain in the prompt history.
        Some(DeveloperInstructions::from_collaboration_mode(
            &next.collaboration_mode,
        )?)
    } else {
        None
    }
}

pub(crate) fn build_model_instructions_update_item(
    previous_turn_settings: Option<&PreviousTurnSettings>,
    next: &TurnContext,
) -> Option<DeveloperInstructions> {
    let previous_turn_settings = previous_turn_settings?;
    if previous_turn_settings.model == next.model_info.slug {
        return None;
    }

    let model_instructions = next.model_info.get_model_instructions();
    if model_instructions.is_empty() {
        return None;
    }

    Some(DeveloperInstructions::model_switch_message(
        model_instructions,
    ))
}

pub(crate) fn build_developer_update_item(text_sections: Vec<String>) -> Option<ResponseItem> {
    build_text_message("developer", text_sections)
}

pub(crate) fn build_contextual_user_message(text_sections: Vec<String>) -> Option<ResponseItem> {
    build_text_message("user", text_sections)
}

fn build_text_message(role: &str, text_sections: Vec<String>) -> Option<ResponseItem> {
    if text_sections.is_empty() {
        return None;
    }

    let content = text_sections
        .into_iter()
        .map(|text| ContentItem::InputText { text })
        .collect();

    Some(ResponseItem::Message {
        id: None,
        role: role.to_string(),
        content,
        end_turn: None,
        phase: None,
    })
}

pub(crate) fn build_settings_update_items(
    previous: Option<&TurnContextItem>,
    previous_turn_settings: Option<&PreviousTurnSettings>,
    next: &TurnContext,
    shell: &Shell,
    exec_policy: &Policy,
) -> Vec<ResponseItem> {
    // TODO(ccunningham): build_settings_update_items still does not cover every
    // model-visible item emitted by build_initial_context. Persist the remaining
    // inputs or add explicit replay events so fork/resume can diff everything
    // deterministically.
    let contextual_user_message = build_environment_update_item(previous, next, shell);
    let developer_update_sections = [
        // Keep model-switch instructions first so model-specific guidance is read before
        // any other context diffs on this turn.
        build_model_instructions_update_item(previous_turn_settings, next),
        build_permissions_update_item(previous, next, exec_policy),
        build_collaboration_mode_update_item(previous, next),
    ]
    .into_iter()
    .flatten()
    .map(DeveloperInstructions::into_text)
    .collect();

    let mut items = Vec::with_capacity(2);
    if let Some(developer_message) = build_developer_update_item(developer_update_sections) {
        items.push(developer_message);
    }
    if let Some(contextual_user_message) = contextual_user_message {
        items.push(contextual_user_message);
    }
    items
}
