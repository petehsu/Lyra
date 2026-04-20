use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use regex::Regex;
use serde::Deserialize;

use crate::agent::types::AgentToolCall;
use crate::profile::types::StoredAiProviderProfile;
use crate::provider;
use crate::provider::types::{AgentInferenceMessage, AgentInferenceMessageRole};

static THINK_BLOCK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<think>.*?</think>").expect("valid think block regex"));
static THINK_TAIL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<think>.*$").expect("valid think tail regex"));
static REFLECTION_BLOCK_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?is)<reflection>.*?</reflection>").expect("valid reflection block regex")
});
static REFLECTION_TAIL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<reflection>.*$").expect("valid reflection tail regex"));
static INTERNAL_REFLECTION_HEADING_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?is)(?:^|\n)\s{0,3}(?:#{1,6}\s*)?(?:reflection|反思)[\s\S]*$")
        .expect("valid internal reflection heading regex")
});
#[cfg(test)]
static CHOICE_ALTERNATIVE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?is)(?:\b(?:or|either)\b|还是|或者|或是|ou|oder|o bien)")
        .expect("valid alternative connector regex")
});
#[cfg(test)]
static COUNTERFACTUAL_COUNT_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?is)(?:after|then|remaining|left|remain|还剩|剩下|之后|以后|打中|shot|hit).{0,40}(?:\d+|多少|几(?:个|只|条|位|本|人)?|how many)",
    )
    .expect("valid counterfactual count regex")
});
#[cfg(test)]
static ASSUMPTION_FRAME_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?is)(?:assuming|assume|under the assumption|假设|前提|默认|按常规|忽略边界|without edge cases)",
    )
    .expect("valid assumption frame regex")
});
#[cfg(test)]
static OFFLINE_STATE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?is)(?:上不了网|无法上网|没有网络|没网|offline|no internet|can't connect|cannot connect|network down|router.*broken)",
    )
    .expect("valid offline state regex")
});
#[cfg(test)]
static ONLINE_ACTION_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?is)(?:上网搜|在线搜索|search online|google|browse|web search|open a website)")
        .expect("valid online action regex")
});
#[cfg(test)]
static CLARIFYING_ANSWER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"(?is)(?:\?|？|取决于|depends|before I answer|在回答前|需要确认|need to confirm|需要先确认)",
    )
    .expect("valid clarifying answer regex")
});
static CJK_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\u{4E00}-\u{9FFF}]").expect("valid cjk regex"));

static SESSION_PATTERN_MEMORY: Lazy<Mutex<HashMap<String, Vec<String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QualityQuestionOption {
    pub label: String,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QualityGateAction {
    Accept {
        revised_answer: Option<String>,
    },
    Ask {
        question: String,
        options: Vec<QualityQuestionOption>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QualityGateOutcome {
    pub goal_model_summary: Option<String>,
    pub contradictions: Vec<String>,
    pub correction_patterns: Vec<String>,
    pub action: QualityGateAction,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IntentClarificationAction {
    Proceed,
    Ask {
        question: String,
        options: Vec<QualityQuestionOption>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IntentClarificationOutcome {
    pub blocking_unknowns: Vec<String>,
    pub action: IntentClarificationAction,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GateFailureStage {
    ProviderInference,
    MissingJson,
    InvalidJson,
}

impl GateFailureStage {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ProviderInference => "provider_inference",
            Self::MissingJson => "missing_json",
            Self::InvalidJson => "invalid_json",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GateFailure {
    pub stage: GateFailureStage,
    pub detail: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum IntentClarificationGateResult {
    Disabled,
    Outcome(IntentClarificationOutcome),
    Failed(GateFailure),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum QualityGateResult {
    Skipped,
    Outcome(QualityGateOutcome),
    Failed(GateFailure),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct QualityGateResponse {
    decision: Option<String>,
    goal_model: Option<GoalModelResponse>,
    contradictions: Option<Vec<String>>,
    correction_patterns: Option<Vec<String>>,
    clarifying_question: Option<ClarifyingQuestionResponse>,
    final_answer: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoalModelResponse {
    objective: Option<String>,
    constraints: Option<Vec<String>>,
    unknowns: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClarifyingQuestionResponse {
    question: Option<String>,
    options: Option<Vec<ClarifyingOptionResponse>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClarifyingOptionResponse {
    label: Option<String>,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IntentClarificationResponse {
    decision: Option<String>,
    blocking_unknowns: Option<Vec<String>>,
    clarifying_question: Option<ClarifyingQuestionResponse>,
}

fn trim_non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn compact_gate_failure_detail(raw: impl Into<String>) -> String {
    let text = raw.into();
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return "unknown".to_string();
    }
    let mut chars = trimmed.chars();
    let head: String = chars.by_ref().take(240).collect();
    if chars.next().is_some() {
        format!("{head}...")
    } else {
        head
    }
}

fn normalize_line_endings(text: &str) -> String {
    text.replace("\r\n", "\n")
}

fn strip_xml_internal_sections(text: &str) -> String {
    let normalized = normalize_line_endings(text);
    let without_think = THINK_TAIL_RE
        .replace_all(&THINK_BLOCK_RE.replace_all(&normalized, ""), "")
        .to_string();
    REFLECTION_TAIL_RE
        .replace_all(&REFLECTION_BLOCK_RE.replace_all(&without_think, ""), "")
        .to_string()
}

pub fn compute_display_content(raw_answer: &str) -> String {
    if raw_answer.trim().is_empty() {
        return String::new();
    }
    let without_internal = strip_xml_internal_sections(raw_answer);
    if let Some(capture) = INTERNAL_REFLECTION_HEADING_RE.find(&without_internal) {
        let cut_index = capture.start();
        return without_internal[..cut_index].trim_end().to_string();
    }
    without_internal.trim_end().to_string()
}

pub fn should_repair_display_content(raw_answer: &str, display_content: &str) -> bool {
    !raw_answer.trim().is_empty() && display_content.trim().is_empty()
}

fn extract_first_json_object(text: &str) -> Option<String> {
    let content = text.trim();
    if content.is_empty() {
        return None;
    }
    let mut start_index = None;
    let mut depth = 0_i32;
    let mut in_string = false;
    let mut escape_next = false;

    for (index, ch) in content.char_indices() {
        if start_index.is_none() {
            if ch == '{' {
                start_index = Some(index);
                depth = 1;
            }
            continue;
        }

        if in_string {
            if escape_next {
                escape_next = false;
                continue;
            }
            if ch == '\\' {
                escape_next = true;
                continue;
            }
            if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch == '"' {
            in_string = true;
            continue;
        }
        if ch == '{' {
            depth += 1;
            continue;
        }
        if ch == '}' {
            depth -= 1;
            if depth == 0 {
                let start = start_index?;
                return Some(content[start..=index].to_string());
            }
        }
    }
    None
}

fn normalize_list(items: Option<Vec<String>>, max_items: usize) -> Vec<String> {
    items
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| trim_non_empty(&entry))
        .map(|entry| {
            let mut chars = entry.chars();
            let shortened: String = chars.by_ref().take(180).collect();
            if chars.next().is_some() {
                format!("{shortened}...")
            } else {
                shortened
            }
        })
        .take(max_items)
        .collect()
}

fn default_ask_options() -> Vec<QualityQuestionOption> {
    vec![
        QualityQuestionOption {
            label: "Provide context".to_string(),
            description: "Share the missing detail so I can answer accurately.".to_string(),
        },
        QualityQuestionOption {
            label: "Best effort now".to_string(),
            description: "Proceed with your preferred assumption and state it clearly.".to_string(),
        },
    ]
}

#[cfg(test)]
fn contains_choice_alternative(text: &str) -> bool {
    CHOICE_ALTERNATIVE_RE.is_match(text)
}

#[cfg(test)]
fn contains_counterfactual_count(text: &str) -> bool {
    COUNTERFACTUAL_COUNT_RE.is_match(text)
}

#[cfg(test)]
fn contains_assumption_frame(text: &str) -> bool {
    ASSUMPTION_FRAME_RE.is_match(text)
}

#[cfg(test)]
fn contains_offline_online_conflict(text: &str) -> bool {
    OFFLINE_STATE_RE.is_match(text) && ONLINE_ACTION_RE.is_match(text)
}

#[cfg(test)]
fn answer_already_clarifies(draft_answer: &str) -> bool {
    CLARIFYING_ANSWER_RE.is_match(draft_answer)
}

fn is_cjk_text(text: &str) -> bool {
    CJK_RE.is_match(text)
}

#[cfg(test)]
fn zh_options_for_ambiguity() -> Vec<QualityQuestionOption> {
    vec![
        QualityQuestionOption {
            label: "按常规现实场景".to_string(),
            description: "使用一般现实假设，排除极端边界条件。".to_string(),
        },
        QualityQuestionOption {
            label: "按脑筋急转弯场景".to_string(),
            description: "允许非常规边界条件，按题面陷阱逻辑处理。".to_string(),
        },
        QualityQuestionOption {
            label: "我补充约束".to_string(),
            description: "你先问我关键前提，我给定后再回答。".to_string(),
        },
    ]
}

#[cfg(test)]
fn en_options_for_ambiguity() -> Vec<QualityQuestionOption> {
    vec![
        QualityQuestionOption {
            label: "Use real-world defaults".to_string(),
            description: "Assume normal real-world behavior and ignore edge cases.".to_string(),
        },
        QualityQuestionOption {
            label: "Treat as puzzle logic".to_string(),
            description: "Allow trick-style edge cases and literal puzzle framing.".to_string(),
        },
        QualityQuestionOption {
            label: "I will specify constraints".to_string(),
            description: "Ask me the key assumptions first, then answer.".to_string(),
        },
    ]
}

#[cfg(test)]
fn zh_options_for_network_conflict() -> Vec<QualityQuestionOption> {
    vec![
        QualityQuestionOption {
            label: "问题就在这台设备".to_string(),
            description: "按当前设备断网处理，给我离线方案。".to_string(),
        },
        QualityQuestionOption {
            label: "问题在其他设备".to_string(),
            description: "当前设备可联网，请按远程排查思路回答。".to_string(),
        },
        QualityQuestionOption {
            label: "先给两套方案".to_string(),
            description: "分别给当前设备断网和其他设备断网两种处理路径。".to_string(),
        },
    ]
}

#[cfg(test)]
fn en_options_for_network_conflict() -> Vec<QualityQuestionOption> {
    vec![
        QualityQuestionOption {
            label: "Issue is on this device".to_string(),
            description: "Treat this current device as offline and give an offline-first path."
                .to_string(),
        },
        QualityQuestionOption {
            label: "Issue is on another device".to_string(),
            description: "This device is online; answer as a remote troubleshooting case."
                .to_string(),
        },
        QualityQuestionOption {
            label: "Give both paths".to_string(),
            description: "Provide both on-device-offline and other-device-offline handling."
                .to_string(),
        },
    ]
}

#[cfg(test)]
pub fn structural_ambiguity_gate(
    user_input: &str,
    draft_answer: &str,
    tool_calls: &[AgentToolCall],
) -> Option<QualityGateOutcome> {
    if user_input.trim().is_empty() || draft_answer.trim().is_empty() || !tool_calls.is_empty() {
        return None;
    }
    if answer_already_clarifies(draft_answer) || contains_assumption_frame(user_input) {
        return None;
    }

    let is_cjk = is_cjk_text(user_input);
    if contains_offline_online_conflict(user_input) {
        let (question, options) = if is_cjk {
            (
                "你描述的是“无法上网”，但任务里又包含“在线搜索”动作。为避免误判，我需要先确认问题发生在哪台设备或网络？".to_string(),
                zh_options_for_network_conflict(),
            )
        } else {
            (
                "You describe an offline state but also include an online action. To avoid a wrong assumption, which device/network is actually affected?".to_string(),
                en_options_for_network_conflict(),
            )
        };
        return Some(QualityGateOutcome {
            goal_model_summary: Some("objective: resolve a premise conflict before committing".to_string()),
            contradictions: vec![
                "Input contains an offline premise and an online-required action in the same decision."
                    .to_string(),
            ],
            correction_patterns: vec![
                "When premise and required action conflict, ask for affected scope before answering."
                    .to_string(),
            ],
            action: QualityGateAction::Ask { question, options },
        });
    }

    if contains_choice_alternative(user_input) || contains_counterfactual_count(user_input) {
        let (question, options) = if is_cjk {
            (
                "这个问题的结果取决于你采用的前提规则。为避免拍脑袋，我先确认：你希望按哪种规则回答？".to_string(),
                zh_options_for_ambiguity(),
            )
        } else {
            (
                "This outcome depends on which assumptions you want. Before I commit, which rule set should I use?".to_string(),
                en_options_for_ambiguity(),
            )
        };
        return Some(QualityGateOutcome {
            goal_model_summary: Some(
                "objective: lock assumptions before giving a deterministic answer".to_string(),
            ),
            contradictions: vec![
                "Multiple plausible assumption branches could yield different answers.".to_string(),
            ],
            correction_patterns: vec![
                "For assumption-sensitive scenarios, ask for rule framing before finalizing."
                    .to_string(),
            ],
            action: QualityGateAction::Ask { question, options },
        });
    }
    None
}

fn normalize_question_options(
    options: Option<Vec<ClarifyingOptionResponse>>,
) -> Vec<QualityQuestionOption> {
    let normalized = options
        .unwrap_or_default()
        .into_iter()
        .filter_map(|entry| {
            let label = trim_non_empty(entry.label.as_deref().unwrap_or_default())?;
            let description = trim_non_empty(entry.description.as_deref().unwrap_or_default())
                .unwrap_or_else(|| "Clarifies a blocking decision.".to_string());
            Some(QualityQuestionOption { label, description })
        })
        .take(4)
        .collect::<Vec<_>>();

    if normalized.len() >= 2 {
        normalized
    } else {
        default_ask_options()
    }
}

pub fn is_intent_clarification_gate_enabled() -> bool {
    if cfg!(test) {
        let enabled_for_tests = std::env::var("LYRA_ENABLE_INTENT_CLARIFICATION_GATE_IN_TESTS")
            .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if !enabled_for_tests {
            return false;
        }
    }
    std::env::var("LYRA_DISABLE_INTENT_CLARIFICATION_GATE")
        .map(|value| value != "1" && !value.eq_ignore_ascii_case("true"))
        .unwrap_or(true)
}

fn summarize_recent_context(messages: &[AgentInferenceMessage]) -> String {
    if messages.is_empty() {
        return "none".to_string();
    }
    let summaries = messages
        .iter()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .map(|message| {
            let role = match message.role {
                AgentInferenceMessageRole::System => "system",
                AgentInferenceMessageRole::User => "user",
                AgentInferenceMessageRole::Assistant => "assistant",
                AgentInferenceMessageRole::Tool => "tool",
            };
            let mut chars = message.content.chars();
            let head: String = chars.by_ref().take(180).collect();
            let preview = if chars.next().is_some() {
                format!("{head}...")
            } else {
                head
            };
            format!("- {role}: {}", preview.replace('\n', " "))
        })
        .collect::<Vec<_>>();
    if summaries.is_empty() {
        "none".to_string()
    } else {
        summaries.join("\n")
    }
}

fn build_intent_clarification_prompt(user_input: &str, recent_context: &str) -> String {
    format!(
        "[Lyra Intent Clarification Gate]\nDecide whether we must ask one blocking clarification BEFORE any implementation or tool action.\n\nDecision policy:\n1) Choose `ask` when missing preferences, constraints, acceptance criteria, target audience, stack direction, visual direction, or output shape could materially change the result.\n2) Do semantic completeness reasoning from the request + context. Do NOT rely on keyword heuristics.\n3) A permissive request still can be under-specified; only choose `proceed` when defaults are clearly anchored by existing context/repo constraints.\n4) If uncertainty is material, ask exactly one concise question with 2-4 options.\n\nOutput JSON schema:\n{{\n  \"decision\": \"proceed\" | \"ask\",\n  \"blockingUnknowns\": string[],\n  \"clarifyingQuestion\": {{\n    \"question\": string,\n    \"options\": [{{\"label\": string, \"description\": string}}]\n  }}\n}}\n\nRules:\n- Same language as the user.\n- No markdown fences.\n- No prose outside JSON.\n\nRecent context:\n{recent_context}\n\nLatest user request:\n{user_input}\n"
    )
}

fn default_intent_clarification_question(user_input: &str) -> (String, Vec<QualityQuestionOption>) {
    if is_cjk_text(user_input) {
        (
            "开始前我需要先确认一个关键偏好：你希望我优先哪种方向？".to_string(),
            vec![
                QualityQuestionOption {
                    label: "稳妥实用".to_string(),
                    description: "优先可落地、易维护和常见最佳实践。".to_string(),
                },
                QualityQuestionOption {
                    label: "视觉优先".to_string(),
                    description: "优先观感和表现力，允许更激进设计。".to_string(),
                },
                QualityQuestionOption {
                    label: "先给最小版".to_string(),
                    description: "先做最小可用版本，再逐步加细节。".to_string(),
                },
            ],
        )
    } else {
        (
            "Before I start, which direction should I prioritize?".to_string(),
            vec![
                QualityQuestionOption {
                    label: "Practical default".to_string(),
                    description: "Prioritize maintainability and common best practices."
                        .to_string(),
                },
                QualityQuestionOption {
                    label: "Visual-first".to_string(),
                    description: "Prioritize presentation and stronger visual expression."
                        .to_string(),
                },
                QualityQuestionOption {
                    label: "MVP first".to_string(),
                    description: "Ship a minimal version first, then refine.".to_string(),
                },
            ],
        )
    }
}

pub fn run_intent_clarification_gate(
    profile: &StoredAiProviderProfile,
    secrets: &BTreeMap<String, String>,
    system_message: &AgentInferenceMessage,
    user_input: &str,
    provider_messages: &[AgentInferenceMessage],
) -> IntentClarificationGateResult {
    if user_input.trim().is_empty() || !is_intent_clarification_gate_enabled() {
        return IntentClarificationGateResult::Disabled;
    }

    let prompt =
        build_intent_clarification_prompt(user_input, &summarize_recent_context(provider_messages));
    let messages = vec![
        system_message.clone(),
        AgentInferenceMessage {
            role: AgentInferenceMessageRole::User,
            content: prompt,
            tool_call_id: None,
            tool_calls: Vec::new(),
        },
    ];

    let inference = match provider::run_agent_inference(
        &profile.to_public(),
        secrets,
        &messages,
        &[],
        None::<&mut dyn FnMut(&str)>,
        None::<&mut dyn FnMut(&str)>,
    ) {
        Ok(value) => value,
        Err(error) => {
            return IntentClarificationGateResult::Failed(GateFailure {
                stage: GateFailureStage::ProviderInference,
                detail: compact_gate_failure_detail(error.to_string()),
            });
        }
    };
    let json_text = match extract_first_json_object(inference.assistant_text.trim()) {
        Some(value) => value,
        None => {
            return IntentClarificationGateResult::Failed(GateFailure {
                stage: GateFailureStage::MissingJson,
                detail: compact_gate_failure_detail(inference.assistant_text),
            });
        }
    };
    let parsed = match serde_json::from_str::<IntentClarificationResponse>(&json_text) {
        Ok(value) => value,
        Err(error) => {
            return IntentClarificationGateResult::Failed(GateFailure {
                stage: GateFailureStage::InvalidJson,
                detail: compact_gate_failure_detail(error.to_string()),
            });
        }
    };
    let blocking_unknowns = normalize_list(parsed.blocking_unknowns, 8);
    let decision = parsed
        .decision
        .unwrap_or_else(|| "proceed".to_string())
        .trim()
        .to_ascii_lowercase();

    if decision == "ask" {
        let parsed_question = parsed.clarifying_question;
        let question = parsed_question
            .as_ref()
            .and_then(|entry| trim_non_empty(entry.question.as_deref().unwrap_or_default()));
        let options = normalize_question_options(parsed_question.and_then(|entry| entry.options));
        let (question, options) = match question {
            Some(question) => (question, options),
            None => default_intent_clarification_question(user_input),
        };
        return IntentClarificationGateResult::Outcome(IntentClarificationOutcome {
            blocking_unknowns,
            action: IntentClarificationAction::Ask { question, options },
        });
    }

    IntentClarificationGateResult::Outcome(IntentClarificationOutcome {
        blocking_unknowns,
        action: IntentClarificationAction::Proceed,
    })
}

fn build_goal_model_summary(goal_model: Option<GoalModelResponse>) -> Option<String> {
    let model = goal_model?;
    let objective = trim_non_empty(model.objective.as_deref().unwrap_or_default());
    let constraints = normalize_list(model.constraints, 4);
    let unknowns = normalize_list(model.unknowns, 4);

    if objective.is_none() && constraints.is_empty() && unknowns.is_empty() {
        return None;
    }

    let mut lines = Vec::new();
    if let Some(objective) = objective {
        lines.push(format!("objective: {objective}"));
    }
    if !constraints.is_empty() {
        lines.push(format!("constraints: {}", constraints.join(" | ")));
    }
    if !unknowns.is_empty() {
        lines.push(format!("unknowns: {}", unknowns.join(" | ")));
    }
    Some(lines.join("\n"))
}

fn build_quality_gate_prompt(
    user_input: &str,
    draft_answer: &str,
    tool_calls: &[AgentToolCall],
) -> String {
    let tool_trace = if tool_calls.is_empty() {
        "none".to_string()
    } else {
        tool_calls
            .iter()
            .take(8)
            .map(|call| format!("{} ({})", call.tool_name, call.status))
            .collect::<Vec<_>>()
            .join(", ")
    };

    format!(
        "[Lyra Goal Modeling + Quality Gate]\nRun strict pre-answer QA. Think privately and output JSON only.\n\nProcess requirements:\n1) Build a compact goal model for the user request.\n2) Build a tiny state-transition model (entities, location/state before and after each action) and reject impossible or assumption-sensitive transitions.\n3) Simulate the scenario as if you are the actor, then detect contradictions between the goal model and the draft answer.\n4) If a blocking unknown could materially change correctness, choose `ask` instead of guessing.\n5) If runtime context and coworker premise may conflict (for example online/offline scope), ask a neutral scope question instead of accusing intent.\n6) If draft is wrong but can be corrected from available context, choose `revise` and return corrected final answer only.\n7) `correctionPatterns` must be abstract reusable error patterns (no user-specific wording).\n\nOutput JSON schema:\n{{\n  \"decision\": \"accept\" | \"revise\" | \"ask\",\n  \"goalModel\": {{\n    \"objective\": string,\n    \"constraints\": string[],\n    \"unknowns\": string[]\n  }},\n  \"contradictions\": string[],\n  \"correctionPatterns\": string[],\n  \"clarifyingQuestion\": {{\n    \"question\": string,\n    \"options\": [{{\"label\": string, \"description\": string}}]\n  }},\n  \"finalAnswer\": string\n}}\n\nRules:\n- Use the same language as the user request.\n- No markdown fences. No prose outside JSON.\n- Keep contradictions concise.\n- When decision=ask, provide one blocking clarifying question and 2-4 options.\n- Never fabricate missing facts. If key facts are unknown, ask.\n- When decision=accept, leave finalAnswer empty unless a minimal wording cleanup is needed.\n\nUser request:\n{user_input}\n\nDraft answer:\n{draft_answer}\n\nTool trace:\n{tool_trace}\n"
    )
}

pub fn run_quality_gate(
    profile: &StoredAiProviderProfile,
    secrets: &BTreeMap<String, String>,
    system_message: &AgentInferenceMessage,
    user_input: &str,
    draft_answer: &str,
    tool_calls: &[AgentToolCall],
) -> QualityGateResult {
    if user_input.trim().is_empty() || draft_answer.trim().is_empty() {
        return QualityGateResult::Skipped;
    }

    let quality_prompt = build_quality_gate_prompt(user_input, draft_answer, tool_calls);
    let messages = vec![
        system_message.clone(),
        AgentInferenceMessage {
            role: AgentInferenceMessageRole::User,
            content: quality_prompt,
            tool_call_id: None,
            tool_calls: Vec::new(),
        },
    ];

    let inference = match provider::run_agent_inference(
        &profile.to_public(),
        secrets,
        &messages,
        &[],
        None::<&mut dyn FnMut(&str)>,
        None::<&mut dyn FnMut(&str)>,
    ) {
        Ok(value) => value,
        Err(error) => {
            return QualityGateResult::Failed(GateFailure {
                stage: GateFailureStage::ProviderInference,
                detail: compact_gate_failure_detail(error.to_string()),
            });
        }
    };

    let raw = inference.assistant_text.trim();
    let json_text = match extract_first_json_object(raw) {
        Some(value) => value,
        None => {
            return QualityGateResult::Failed(GateFailure {
                stage: GateFailureStage::MissingJson,
                detail: compact_gate_failure_detail(raw),
            });
        }
    };
    let parsed = match serde_json::from_str::<QualityGateResponse>(&json_text) {
        Ok(value) => value,
        Err(error) => {
            return QualityGateResult::Failed(GateFailure {
                stage: GateFailureStage::InvalidJson,
                detail: compact_gate_failure_detail(error.to_string()),
            });
        }
    };

    let contradictions = normalize_list(parsed.contradictions, 6);
    let mut correction_patterns = normalize_list(parsed.correction_patterns, 8);
    if correction_patterns.is_empty() {
        correction_patterns = contradictions.clone();
    }

    let goal_model_summary = build_goal_model_summary(parsed.goal_model);
    let decision = parsed.decision.unwrap_or_else(|| "accept".to_string());
    let normalized_decision = decision.trim().to_ascii_lowercase();

    if normalized_decision == "ask" {
        let clarifying = parsed.clarifying_question;
        let question = clarifying
            .as_ref()
            .and_then(|entry| trim_non_empty(entry.question.as_deref().unwrap_or_default()))
            .unwrap_or_else(|| {
                "I need one blocking detail before I can answer accurately. Which option should I use?"
                    .to_string()
            });
        let options = normalize_question_options(clarifying.and_then(|entry| entry.options));
        return QualityGateResult::Outcome(QualityGateOutcome {
            goal_model_summary,
            contradictions,
            correction_patterns,
            action: QualityGateAction::Ask { question, options },
        });
    }

    let revised_answer = trim_non_empty(parsed.final_answer.as_deref().unwrap_or_default())
        .filter(|answer| answer != draft_answer.trim());

    QualityGateResult::Outcome(QualityGateOutcome {
        goal_model_summary,
        contradictions,
        correction_patterns,
        action: QualityGateAction::Accept { revised_answer },
    })
}

pub fn repair_display_answer(
    profile: &StoredAiProviderProfile,
    secrets: &BTreeMap<String, String>,
    system_message: &AgentInferenceMessage,
    user_input: &str,
    raw_answer: &str,
) -> Option<String> {
    if raw_answer.trim().is_empty() {
        return None;
    }
    let prompt = format!(
        "[Lyra Display Repair]\nThe draft may contain hidden thinking tags or malformed internal text.\nReturn only the final user-facing answer text.\n\nRules:\n- Same language as user request.\n- Do not include XML tags, thinking, reflection, or meta commentary.\n- Keep it concise and directly answer the request.\n- If the draft is unusable, ask the user to restate briefly.\n\nUser request:\n{user_input}\n\nDraft:\n{raw_answer}\n"
    );

    let messages = vec![
        system_message.clone(),
        AgentInferenceMessage {
            role: AgentInferenceMessageRole::User,
            content: prompt,
            tool_call_id: None,
            tool_calls: Vec::new(),
        },
    ];

    let inference = provider::run_agent_inference(
        &profile.to_public(),
        secrets,
        &messages,
        &[],
        None::<&mut dyn FnMut(&str)>,
        None::<&mut dyn FnMut(&str)>,
    )
    .ok()?;

    trim_non_empty(inference.assistant_text.as_str())
}

pub fn read_session_patterns(session_id: &str) -> Vec<String> {
    if session_id.trim().is_empty() {
        return Vec::new();
    }
    if let Ok(guard) = SESSION_PATTERN_MEMORY.lock() {
        return guard.get(session_id).cloned().unwrap_or_default();
    }
    Vec::new()
}

pub fn record_session_patterns(session_id: &str, patterns: &[String]) {
    if session_id.trim().is_empty() || patterns.is_empty() {
        return;
    }
    if let Ok(mut guard) = SESSION_PATTERN_MEMORY.lock() {
        let entry = guard.entry(session_id.to_string()).or_insert_with(Vec::new);
        for pattern in patterns {
            if let Some(trimmed) = trim_non_empty(pattern) {
                if entry.iter().any(|existing| existing == &trimmed) {
                    continue;
                }
                entry.push(trimmed);
            }
        }
        if entry.len() > 12 {
            let drop_count = entry.len().saturating_sub(12);
            entry.drain(0..drop_count);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compute_display_content, extract_first_json_object, structural_ambiguity_gate,
        QualityGateAction,
    };

    #[test]
    fn strips_think_and_reflection_tags() {
        let raw = "<think>secret</think>Visible answer\n<reflection>internal</reflection>";
        assert_eq!(compute_display_content(raw), "Visible answer");
    }

    #[test]
    fn strips_unterminated_think_tail() {
        let raw = "<think>secret";
        assert_eq!(compute_display_content(raw), "");
    }

    #[test]
    fn extracts_first_json_object_from_wrapped_text() {
        let raw = "prefix {\"decision\":\"accept\",\"finalAnswer\":\"ok\"} suffix";
        let extracted = extract_first_json_object(raw).expect("json extracted");
        assert!(extracted.contains("decision"));
    }

    #[test]
    fn structural_gate_asks_for_assumption_lock_on_counterfactual_count() {
        let input = "There are ten birds on the tree. After I shoot one, how many are left?";
        let draft = "There are zero birds left.";
        let outcome = structural_ambiguity_gate(input, draft, &[]).expect("structural outcome");
        match outcome.action {
            QualityGateAction::Ask { question, options } => {
                assert!(!question.trim().is_empty());
                assert!(options.len() >= 2);
            }
            QualityGateAction::Accept { .. } => panic!("expected ask action"),
        }
    }

    #[test]
    fn structural_gate_detects_offline_online_conflict() {
        let input =
            "Router is broken and I cannot connect. Should I search online first or call ISP?";
        let draft = "Search online first.";
        let outcome = structural_ambiguity_gate(input, draft, &[]).expect("structural outcome");
        match outcome.action {
            QualityGateAction::Ask { .. } => {}
            QualityGateAction::Accept { .. } => panic!("expected ask action"),
        }
    }

    #[test]
    fn structural_gate_asks_for_chinese_counterfactual_bird_question() {
        let input = "树上有10只鸟，我打中一只，还剩几只？";
        let draft = "还剩9只。";
        let outcome = structural_ambiguity_gate(input, draft, &[]).expect("structural outcome");
        match outcome.action {
            QualityGateAction::Ask { question, options } => {
                assert!(!question.trim().is_empty());
                assert!(options.len() >= 2);
            }
            QualityGateAction::Accept { .. } => panic!("expected ask action"),
        }
    }
}
