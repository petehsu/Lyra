use lyra_collaboration_mode_templates::DEFAULT as COLLABORATION_MODE_DEFAULT;
use lyra_collaboration_mode_templates::PLAN as COLLABORATION_MODE_PLAN;
use lyra_protocol::config_types::CollaborationModeMask;
use lyra_protocol::config_types::ModeKind;
use lyra_protocol::config_types::TUI_VISIBLE_COLLABORATION_MODES;
use lyra_protocol::openai_models::ReasoningEffort;
use lyra_utils_template::Template;
use std::sync::LazyLock;

const KNOWN_MODE_NAMES_TEMPLATE_KEY: &str = "KNOWN_MODE_NAMES";
const REQUEST_USER_INPUT_AVAILABILITY_TEMPLATE_KEY: &str = "REQUEST_USER_INPUT_AVAILABILITY";
const ASKING_QUESTIONS_GUIDANCE_TEMPLATE_KEY: &str = "ASKING_QUESTIONS_GUIDANCE";
static COLLABORATION_MODE_DEFAULT_TEMPLATE: LazyLock<Template> = LazyLock::new(|| {
    Template::parse(COLLABORATION_MODE_DEFAULT)
        .unwrap_or_else(|err| panic!("collaboration mode default template must parse: {err}"))
});

/// Stores feature flags that control collaboration-mode behavior.
///
/// Keep mode-related flags here so new collaboration-mode capabilities can be
/// added without large cross-cutting diffs to constructor and call-site
/// signatures.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CollaborationModesConfig {
    /// Legacy flag retained for config compatibility. `agent_question` is globally available.
    pub default_mode_request_user_input: bool,
}

pub fn builtin_collaboration_mode_presets(
    collaboration_modes_config: CollaborationModesConfig,
) -> Vec<CollaborationModeMask> {
    vec![plan_preset(), default_preset(collaboration_modes_config)]
}

fn plan_preset() -> CollaborationModeMask {
    CollaborationModeMask {
        name: ModeKind::Plan.display_name().to_string(),
        mode: Some(ModeKind::Plan),
        model: None,
        reasoning_effort: Some(Some(ReasoningEffort::Medium)),
        developer_instructions: Some(Some(COLLABORATION_MODE_PLAN.to_string())),
    }
}

fn default_preset(collaboration_modes_config: CollaborationModesConfig) -> CollaborationModeMask {
    CollaborationModeMask {
        name: ModeKind::Default.display_name().to_string(),
        mode: Some(ModeKind::Default),
        model: None,
        reasoning_effort: None,
        developer_instructions: Some(Some(default_mode_instructions(collaboration_modes_config))),
    }
}

fn default_mode_instructions(_collaboration_modes_config: CollaborationModesConfig) -> String {
    let known_mode_names = format_mode_names(&TUI_VISIBLE_COLLABORATION_MODES);
    let request_user_input_availability = agent_question_availability_message(ModeKind::Default);
    let asking_questions_guidance = asking_questions_guidance_message();
    COLLABORATION_MODE_DEFAULT_TEMPLATE
        .render([
            (KNOWN_MODE_NAMES_TEMPLATE_KEY, known_mode_names.as_str()),
            (
                REQUEST_USER_INPUT_AVAILABILITY_TEMPLATE_KEY,
                request_user_input_availability.as_str(),
            ),
            (
                ASKING_QUESTIONS_GUIDANCE_TEMPLATE_KEY,
                asking_questions_guidance.as_str(),
            ),
        ])
        .unwrap_or_else(|err| panic!("collaboration mode default template must render: {err}"))
}

fn format_mode_names(modes: &[ModeKind]) -> String {
    let mode_names: Vec<&str> = modes.iter().map(|mode| mode.display_name()).collect();
    match mode_names.as_slice() {
        [] => "none".to_string(),
        [mode_name] => (*mode_name).to_string(),
        [first, second] => format!("{first} and {second}"),
        [..] => mode_names.join(", "),
    }
}

fn agent_question_availability_message(mode: ModeKind) -> String {
    let mode_name = mode.display_name();
    format!("The `agent_question` tool is available in {mode_name} mode and in subagent threads.")
}

fn asking_questions_guidance_message() -> String {
    "In Default mode, make reasonable assumptions and execute when the path is clear. Whenever you are blocked by ambiguity, missing truth, impossible verification, or a material decision that cannot be safely inferred from available context, call `agent_question` instead of writing a questionnaire in plain assistant text. Never write a multiple choice question as a textual assistant message.".to_string()
}

#[cfg(test)]
#[path = "collaboration_mode_presets_tests.rs"]
mod tests;
