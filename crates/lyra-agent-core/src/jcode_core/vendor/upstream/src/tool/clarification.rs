use super::{Tool, ToolContext, ToolOutput};
use anyhow::Result;
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{Map, Value, json};

pub struct AskUserTool;

impl AskUserTool {
    pub fn new() -> Self {
        Self
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AskUserInput {
    question: String,
    #[serde(default)]
    options: Option<Vec<AskUserOptionInput>>,
    #[serde(default, alias = "allow_custom_answer")]
    allow_custom_answer: Option<bool>,
    #[serde(default, alias = "description", alias = "context")]
    detail: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AskUserOptionInput {
    Label(String),
    Structured {
        label: String,
        #[serde(default)]
        description: Option<String>,
    },
}

#[async_trait]
impl Tool for AskUserTool {
    fn name(&self) -> &str {
        "ask_user"
    }

    fn description(&self) -> &str {
        "Ask the user one structured clarification question and wait for their answer in the Lyra GUI. Default to doing the work without asking; call this only when you are truly blocked after using available context. Ask exactly one targeted question per call, include the recommended/default choice first when options are useful, and state the impact of the answer in detail or option descriptions when that helps. Do not bundle a checklist, numbered list, or multiple independent questions. If several details are missing, ask the first blocker, wait for the answer, then ask the next only if it is still necessary. Provide 2-4 short options for category, type, preference, yes/no, style, framework, audience, priority, or other closed-decision questions. Do not provide options for genuinely open-ended facts such as a specific name, URL, path, API key, pasted text, or a free-form requirement. Options may be strings or { label, description } objects; descriptions should explain trade-offs or consequences. Do not add an Other/Custom option; the Lyra GUI adds that automatically when custom answers are allowed. Options must directly answer the question. Allow a custom answer unless custom answers would be invalid. Do not ask required clarification questions in normal assistant text; call ask_user so the GUI can show a blocking question panel."
    }

    fn parameters_schema(&self) -> Value {
        Value::Object(Map::from_iter([
            ("type".into(), json!("object")),
            ("required".into(), json!(["question"])),
            (
                "properties".into(),
                json!({
                    "intent": super::intent_schema_property(),
                    "question": {
                        "type": "string",
                        "description": "One concise question the user must answer before you continue. Ask only the first real blocker. Do not include multiple questions, a numbered list, or a checklist."
                    },
                    "options": {
                        "type": "array",
                        "minItems": 2,
                        "maxItems": 4,
                        "items": {
                            "oneOf": [
                                { "type": "string" },
                                {
                                    "type": "object",
                                    "required": ["label"],
                                    "properties": {
                                        "label": {
                                            "type": "string",
                                            "description": "Short visible option label, usually 1-5 words. Put the recommended choice first and suffix the label with (Recommended) when appropriate."
                                        },
                                        "description": {
                                            "type": "string",
                                            "description": "Optional one-sentence explanation of the impact or trade-off if the user selects this option."
                                        }
                                    }
                                }
                            ]
                        },
                        "description": "Optional mutually exclusive choices. Use when the question asks for a category, type, preference, yes/no decision, style, framework, audience, priority, or other known alternatives. Keep it short, usually 2-4 options. Do not use options for open-ended facts. Do not include Other or Custom; the GUI adds a custom-answer path automatically."
                    },
                    "allowCustomAnswer": {
                        "type": "boolean",
                        "description": "Whether the user may type a custom answer in addition to selecting an option. Defaults to true. Keep true unless custom answers would be invalid."
                    },
                    "detail": {
                        "type": "string",
                        "description": "Optional one-sentence context explaining why the answer is needed."
                    }
                }),
            ),
        ]))
    }

    async fn execute(&self, input: Value, ctx: ToolContext) -> Result<ToolOutput> {
        let input: AskUserInput = serde_json::from_value(input)?;
        let question = required_trimmed(&input.question, "question")?;
        let options = normalize_options(input.options.unwrap_or_default());
        let allow_custom_answer = input.allow_custom_answer.unwrap_or(true) || options.is_empty();
        let detail = input.detail.and_then(|value| normalize_optional(value));

        let answer = crate::lyra_runtime::ask_user_clarification(
            &ctx.session_id,
            &question,
            options.clone(),
            allow_custom_answer,
            detail.clone(),
        )?;

        let body = match answer.selected_option.as_deref() {
            Some(option) => format!(
                "User selected \"{}\" and answered: {}",
                option, answer.answer
            ),
            None => format!("User answered: {}", answer.answer),
        };

        Ok(ToolOutput::new(body)
            .with_title("user clarification")
            .with_metadata(json!({
                "question": question,
                "options": options,
                "allowCustomAnswer": allow_custom_answer,
                "detail": detail,
                "answer": answer.answer,
                "selectedOption": answer.selected_option
            })))
    }
}

fn required_trimmed(value: &str, name: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        anyhow::bail!("{name} is required");
    }
    Ok(value.to_string())
}

fn normalize_optional(value: String) -> Option<String> {
    let value = value.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn normalize_options(
    options: Vec<AskUserOptionInput>,
) -> Vec<crate::lyra_runtime::ClarificationOption> {
    let mut normalized: Vec<crate::lyra_runtime::ClarificationOption> = Vec::new();
    for option in options {
        let (label, description) = match option {
            AskUserOptionInput::Label(label) => (label, None),
            AskUserOptionInput::Structured { label, description } => (label, description),
        };
        let label = label.trim();
        let description = description.and_then(normalize_optional);
        if label.is_empty()
            || is_custom_option_label(label)
            || normalized
                .iter()
                .any(|existing| existing.label.as_str() == label)
        {
            continue;
        }
        normalized.push(crate::lyra_runtime::ClarificationOption {
            label: label.to_string(),
            description,
        });
    }
    normalized
}

fn is_custom_option_label(label: &str) -> bool {
    let label = label.trim();
    matches!(
        label.to_ascii_lowercase().as_str(),
        "other" | "custom" | "something else"
    ) || matches!(label, "其他" | "其它" | "自定义")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_exposes_structured_question_fields() {
        let schema = AskUserTool::new().parameters_schema();
        assert_eq!(schema["required"], json!(["question"]));
        assert!(schema["properties"]["question"].is_object());
        assert!(schema["properties"]["options"].is_object());
        assert_eq!(schema["properties"]["options"]["minItems"], json!(2));
        assert_eq!(schema["properties"]["options"]["maxItems"], json!(4));
        assert!(schema["properties"]["options"]["items"]["oneOf"].is_array());
        assert!(schema["properties"]["allowCustomAnswer"].is_object());
        assert!(schema["properties"]["detail"].is_object());
    }

    #[test]
    fn normalizes_structured_options_and_filters_custom() {
        let options = normalize_options(vec![
            AskUserOptionInput::Structured {
                label: " Direct ".to_string(),
                description: Some(" Short answer ".to_string()),
            },
            AskUserOptionInput::Label("Other".to_string()),
            AskUserOptionInput::Label("Direct".to_string()),
            AskUserOptionInput::Label(" Friendly ".to_string()),
        ]);

        assert_eq!(options.len(), 2);
        assert_eq!(options[0].label, "Direct");
        assert_eq!(options[0].description.as_deref(), Some("Short answer"));
        assert_eq!(options[1].label, "Friendly");
        assert_eq!(options[1].description, None);
    }

    #[tokio::test]
    async fn rejects_empty_question_before_waiting_for_gui() {
        let ctx = ToolContext {
            session_id: "missing-session".to_string(),
            message_id: "message".to_string(),
            tool_call_id: "tool".to_string(),
            working_dir: None,
            stdin_request_tx: None,
            graceful_shutdown_signal: None,
            execution_mode: crate::tool::ToolExecutionMode::Direct,
        };
        let error = AskUserTool::new()
            .execute(json!({ "question": "   " }), ctx)
            .await
            .expect_err("empty question should fail before runtime wait");
        assert!(error.to_string().contains("question is required"));
    }

    #[tokio::test]
    async fn allows_open_ended_fact_without_options_until_runtime_validation() {
        let ctx = test_context();
        let error = AskUserTool::new()
            .execute(json!({ "question": "官网名称是什么？" }), ctx)
            .await
            .expect_err("missing session should be the first runtime error");
        assert!(error.to_string().contains("not found"));
    }

    fn test_context() -> ToolContext {
        ToolContext {
            session_id: "missing-session".to_string(),
            message_id: "message".to_string(),
            tool_call_id: "tool".to_string(),
            working_dir: None,
            stdin_request_tx: None,
            graceful_shutdown_signal: None,
            execution_mode: crate::tool::ToolExecutionMode::Direct,
        }
    }
}
