use crate::JsonSchema;
use crate::ResponsesApiTool;
use crate::ToolSpec;
use lyra_protocol::config_types::ModeKind;
use lyra_protocol::request_user_input::RequestUserInputArgs;
use std::collections::BTreeMap;

pub const AGENT_QUESTION_TOOL_NAME: &str = "agent_question";
pub const REQUEST_USER_INPUT_TOOL_NAME: &str = "request_user_input";

pub fn create_agent_question_tool() -> ToolSpec {
    create_question_tool(
        AGENT_QUESTION_TOOL_NAME,
        agent_question_tool_description(),
        /*include_reason*/ true,
    )
}

pub fn create_request_user_input_tool(description: String) -> ToolSpec {
    create_question_tool(
        REQUEST_USER_INPUT_TOOL_NAME,
        description,
        /*include_reason*/ false,
    )
}

fn create_question_tool(name: &str, description: String, include_reason: bool) -> ToolSpec {
    let option_props = BTreeMap::from([
        (
            "label".to_string(),
            JsonSchema::string(Some("User-facing label (1-5 words).".to_string())),
        ),
        (
            "description".to_string(),
            JsonSchema::string(Some(
                "One short sentence explaining impact/tradeoff if selected.".to_string(),
            )),
        ),
    ]);

    let options_schema = JsonSchema::array(JsonSchema::object(
            option_props,
            Some(vec!["label".to_string(), "description".to_string()]),
            Some(false.into()),
        ), Some(
            "Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with \"(Recommended)\". Do not include an \"Other\" option in this list; the client will add a free-form \"Other\" option automatically."
                .to_string(),
        ));

    let question_props = BTreeMap::from([
        (
            "id".to_string(),
            JsonSchema::string(Some(
                "Stable identifier for mapping answers (snake_case).".to_string(),
            )),
        ),
        (
            "header".to_string(),
            JsonSchema::string(Some(
                "Short header label shown in the UI (12 or fewer chars).".to_string(),
            )),
        ),
        (
            "question".to_string(),
            JsonSchema::string(Some(
                "Single-sentence prompt shown to the user.".to_string(),
            )),
        ),
        ("options".to_string(), options_schema),
    ]);

    let questions_schema = JsonSchema::array(
        JsonSchema::object(
            question_props,
            Some(vec![
                "id".to_string(),
                "header".to_string(),
                "question".to_string(),
                "options".to_string(),
            ]),
            Some(false.into()),
        ),
        Some("Questions to show the user. Prefer 1 and do not exceed 3".to_string()),
    );

    let mut properties = BTreeMap::from([("questions".to_string(), questions_schema)]);
    if include_reason {
        properties.insert(
            "reason".to_string(),
            JsonSchema::string(Some(
                "Short internal reason for why this question is blocking or materially clarifying."
                    .to_string(),
            )),
        );
    }

    ToolSpec::Function(ResponsesApiTool {
        name: name.to_string(),
        description,
        strict: false,
        defer_loading: None,
        parameters: JsonSchema::object(
            properties,
            Some(vec!["questions".to_string()]),
            Some(false.into()),
        ),
        output_schema: None,
    })
}

pub fn request_user_input_unavailable_message(
    mode: ModeKind,
    default_mode_request_user_input: bool,
) -> Option<String> {
    if request_user_input_is_available(mode, default_mode_request_user_input) {
        None
    } else {
        let mode_name = mode.display_name();
        Some(format!(
            "request_user_input is unavailable in {mode_name} mode"
        ))
    }
}

pub fn normalize_request_user_input_args(
    mut args: RequestUserInputArgs,
) -> Result<RequestUserInputArgs, String> {
    let missing_options = args
        .questions
        .iter()
        .any(|question| question.options.as_ref().is_none_or(Vec::is_empty));
    if missing_options {
        return Err("agent_question requires non-empty options for every question".to_string());
    }

    for question in &mut args.questions {
        question.is_other = true;
    }

    Ok(args)
}

pub fn agent_question_tool_description() -> String {
    "Ask the user one to three structured questions when the agent is blocked by ambiguity, missing truth, or a material decision. This tool is available in all collaboration modes and from all agent threads; call it instead of writing a plain questionnaire. The turn waits for the user's answer and then continues.".to_string()
}

pub fn request_user_input_tool_description(default_mode_request_user_input: bool) -> String {
    let allowed_modes = format_allowed_modes(default_mode_request_user_input);
    format!(
        "Request user input for one to three short questions and wait for the response. This tool is only available in {allowed_modes}."
    )
}

fn request_user_input_is_available(mode: ModeKind, default_mode_request_user_input: bool) -> bool {
    mode.allows_request_user_input()
        || (default_mode_request_user_input && mode == ModeKind::Default)
}

fn format_allowed_modes(default_mode_request_user_input: bool) -> String {
    if default_mode_request_user_input {
        "Default or Plan mode".to_string()
    } else {
        "Plan mode".to_string()
    }
}

#[cfg(test)]
#[path = "request_user_input_tool_tests.rs"]
mod tests;
