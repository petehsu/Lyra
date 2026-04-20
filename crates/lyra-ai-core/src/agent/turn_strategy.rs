#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TurnStrategyKind {
    StandardExecution,
    DeliberateExecution,
    ExpediteExecution,
}

impl TurnStrategyKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StandardExecution => "standard_execution",
            Self::DeliberateExecution => "deliberate_execution",
            Self::ExpediteExecution => "expedite_execution",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnStrategySelectionOptions<'a> {
    pub strategy_preset: Option<&'a str>,
    pub collaboration_mode: Option<&'a str>,
    pub request_user_input_enabled: Option<bool>,
}

impl<'a> Default for TurnStrategySelectionOptions<'a> {
    fn default() -> Self {
        Self {
            strategy_preset: None,
            collaboration_mode: None,
            request_user_input_enabled: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnStrategy {
    pub kind: TurnStrategyKind,
    pub reasons: Vec<String>,
    request_user_input_enabled: bool,
}

impl TurnStrategy {
    pub fn default_max_steps(&self) -> Option<u32> {
        match self.kind {
            TurnStrategyKind::StandardExecution => None,
            TurnStrategyKind::DeliberateExecution => Some(18),
            TurnStrategyKind::ExpediteExecution => Some(6),
        }
    }

    pub fn reminder_after_step(&self) -> Option<u32> {
        match self.kind {
            TurnStrategyKind::DeliberateExecution => Some(10),
            TurnStrategyKind::ExpediteExecution => Some(4),
            TurnStrategyKind::StandardExecution => None,
        }
    }

    pub fn planning_enabled(&self, requested: bool) -> bool {
        // Keep caller intent as the source of truth for plan-mode entry.
        // Strategy still influences prompt policy and soft caps, but does not
        // force planning on implicitly.
        requested
    }

    pub fn planning_min_chars_hint(&self) -> usize {
        match self.kind {
            TurnStrategyKind::StandardExecution => 96,
            TurnStrategyKind::DeliberateExecution => 48,
            TurnStrategyKind::ExpediteExecution => 160,
        }
    }

    pub fn reflection_enabled(&self, requested: bool) -> bool {
        // Preserve backward compatibility with existing runtime expectations:
        // reflection stays opt-in unless the caller explicitly requests it.
        requested
    }

    pub fn request_user_input_enabled(&self) -> bool {
        self.request_user_input_enabled
    }

    pub fn reasoning_intensity(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => "balanced",
            TurnStrategyKind::DeliberateExecution => "high",
            TurnStrategyKind::ExpediteExecution => "low",
        }
    }

    pub fn prompt_name(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => "standard execution",
            TurnStrategyKind::DeliberateExecution => "deliberate execution",
            TurnStrategyKind::ExpediteExecution => "expedite execution",
        }
    }

    pub fn prompt_summary(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "Use the normal autonomous workflow and match the amount of work to the request."
            }
            TurnStrategyKind::DeliberateExecution => {
                "Prioritize robustness: gather context, validate assumptions, and prefer explicit checkpoints."
            }
            TurnStrategyKind::ExpediteExecution => {
                "Bias for minimal steps and fast completion when the request is narrowly scoped."
            }
        }
    }

    pub fn prompt_planning_policy(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "Use planning only when the task is genuinely non-trivial or the user explicitly asks for a plan."
            }
            TurnStrategyKind::DeliberateExecution => {
                "Use planning by default and keep an explicit checklist when decisions can affect outcomes."
            }
            TurnStrategyKind::ExpediteExecution => {
                "Skip heavyweight planning unless the user explicitly requests it."
            }
        }
    }

    pub fn prompt_tool_budget(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "Use the tools needed to complete the request, but keep context focused and avoid unnecessary loops."
            }
            TurnStrategyKind::DeliberateExecution => {
                "Allocate extra tool budget for verification and cross-checks before concluding."
            }
            TurnStrategyKind::ExpediteExecution => {
                "Keep tool usage compact and avoid exploratory loops unless blocked."
            }
        }
    }

    pub fn prompt_stop_condition(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "Stop when the requested work is complete or when you are genuinely blocked."
            }
            TurnStrategyKind::DeliberateExecution => {
                "Stop only after key assumptions are validated or a concrete blocker is documented."
            }
            TurnStrategyKind::ExpediteExecution => {
                "Stop as soon as the narrowly scoped request is complete."
            }
        }
    }

    pub fn prompt_question_policy(&self) -> &'static str {
        if self.request_user_input_enabled {
            "Request user input when a high-impact ambiguity remains."
        } else {
            "Avoid request_user_input and proceed with explicit assumptions when safe."
        }
    }

    pub fn prompt_guidance(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "- Keep the work scoped to the user's request.\n- Use tools deliberately and verify edits when you change code.\n- Avoid expanding into adjacent investigations unless they block the requested outcome."
            }
            TurnStrategyKind::DeliberateExecution => {
                "- Validate ambiguous requirements before irreversible actions.\n- Prefer deterministic checks over assumptions.\n- Record decision points so follow-up turns remain explainable."
            }
            TurnStrategyKind::ExpediteExecution => {
                "- Prefer direct execution with minimal branching.\n- Avoid optional detours unless they materially reduce risk.\n- Keep output concise and completion-oriented."
            }
        }
    }

    pub fn todo_items(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "- [in_progress] Resolve the user's latest request.\n- [pending] Run relevant validation after code changes.\n- [pending] Summarize outcomes and residual risks."
            }
            TurnStrategyKind::DeliberateExecution => {
                "- [in_progress] Establish the safest execution path for the request.\n- [pending] Validate assumptions and high-risk branches.\n- [pending] Summarize verified outcomes and remaining uncertainty."
            }
            TurnStrategyKind::ExpediteExecution => {
                "- [in_progress] Complete the scoped request with minimal steps.\n- [pending] Run only essential validation.\n- [pending] Return concise results."
            }
        }
    }

    pub fn reminder_message(&self) -> Option<&'static str> {
        match self.kind {
            TurnStrategyKind::DeliberateExecution => {
                Some("Pause and confirm unresolved constraints before continuing.")
            }
            TurnStrategyKind::StandardExecution | TurnStrategyKind::ExpediteExecution => None,
        }
    }

    pub fn soft_cap_message(&self, cap: u32, caller_provided: bool) -> Option<String> {
        if caller_provided {
            return Some(format!(
                "the current request reached the caller-provided soft cap ({cap} tool steps)"
            ));
        }
        if matches!(self.kind, TurnStrategyKind::DeliberateExecution) {
            return Some(format!(
                "deliberate execution reached the adaptive soft cap ({cap} tool steps)"
            ));
        }
        None
    }
}

pub fn select_turn_strategy(input: &str) -> TurnStrategy {
    select_turn_strategy_with_options(input, TurnStrategySelectionOptions::default())
}

pub fn select_turn_strategy_with_options(
    input: &str,
    options: TurnStrategySelectionOptions<'_>,
) -> TurnStrategy {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return build_strategy(
            TurnStrategyKind::StandardExecution,
            vec!["empty_input".to_string()],
            options.request_user_input_enabled,
        );
    }

    let input_chars = trimmed.chars().count();
    let input_lines = trimmed.lines().count();

    if let Some(explicit_kind) = options.strategy_preset.and_then(parse_strategy_preset) {
        return build_strategy(
            explicit_kind,
            vec![
                "explicit_strategy_preset".to_string(),
                format!("preset={}", options.strategy_preset.unwrap_or("unknown")),
            ],
            options.request_user_input_enabled,
        );
    }

    if options.collaboration_mode == Some("plan") {
        return build_strategy(
            TurnStrategyKind::DeliberateExecution,
            vec![
                "collaboration_mode_plan".to_string(),
                format!("input_chars={input_chars}"),
                format!("input_lines={input_lines}"),
            ],
            options.request_user_input_enabled,
        );
    }

    if input_lines >= 14 || input_chars >= 1200 {
        return build_strategy(
            TurnStrategyKind::DeliberateExecution,
            vec![
                "high_complexity_structural_signal".to_string(),
                format!("input_chars={input_chars}"),
                format!("input_lines={input_lines}"),
            ],
            options.request_user_input_enabled,
        );
    }

    if input_lines == 1 && input_chars <= 8 {
        return build_strategy(
            TurnStrategyKind::ExpediteExecution,
            vec![
                "compact_request_structural_signal".to_string(),
                format!("input_chars={input_chars}"),
            ],
            options.request_user_input_enabled,
        );
    }

    build_strategy(
        TurnStrategyKind::StandardExecution,
        vec![
            "semantic_routing_without_keyword_matching".to_string(),
            format!("input_chars={input_chars}"),
            format!("input_lines={input_lines}"),
        ],
        options.request_user_input_enabled,
    )
}

fn parse_strategy_preset(value: &str) -> Option<TurnStrategyKind> {
    match value.trim().to_ascii_lowercase().as_str() {
        "standard" | "default" | "standard_execution" => Some(TurnStrategyKind::StandardExecution),
        "deliberate" | "deep" | "deliberate_execution" => {
            Some(TurnStrategyKind::DeliberateExecution)
        }
        "expedite" | "fast" | "expedite_execution" => Some(TurnStrategyKind::ExpediteExecution),
        _ => None,
    }
}

fn build_strategy(
    kind: TurnStrategyKind,
    reasons: Vec<String>,
    request_user_input_override: Option<bool>,
) -> TurnStrategy {
    let request_user_input_enabled = request_user_input_override.unwrap_or(match kind {
        TurnStrategyKind::StandardExecution => true,
        TurnStrategyKind::DeliberateExecution => true,
        TurnStrategyKind::ExpediteExecution => false,
    });
    TurnStrategy {
        kind,
        reasons,
        request_user_input_enabled,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        select_turn_strategy, select_turn_strategy_with_options, TurnStrategyKind,
        TurnStrategySelectionOptions,
    };

    #[test]
    fn automatic_selection_defaults_to_standard_execution() {
        let strategy = select_turn_strategy("看一下电脑现在状态怎么样");
        assert_eq!(strategy.kind, TurnStrategyKind::StandardExecution);
        assert!(strategy
            .reasons
            .iter()
            .any(|reason| reason == "semantic_routing_without_keyword_matching"));
    }

    #[test]
    fn implementation_requests_remain_on_standard_execution() {
        let strategy = select_turn_strategy("看一下这个界面然后加个按钮");
        assert_eq!(strategy.kind, TurnStrategyKind::StandardExecution);
        assert!(strategy
            .reasons
            .iter()
            .any(|reason| reason == "semantic_routing_without_keyword_matching"));
    }

    #[test]
    fn deep_diagnostic_requests_remain_on_standard_execution() {
        let strategy = select_turn_strategy("帮我分析一下为什么构建一直失败");
        assert_eq!(strategy.kind, TurnStrategyKind::StandardExecution);
    }

    #[test]
    fn explicit_preset_selects_deliberate_strategy() {
        let strategy = select_turn_strategy_with_options(
            "fix production incident",
            TurnStrategySelectionOptions {
                strategy_preset: Some("deliberate"),
                collaboration_mode: None,
                request_user_input_enabled: None,
            },
        );
        assert_eq!(strategy.kind, TurnStrategyKind::DeliberateExecution);
        assert!(strategy
            .reasons
            .iter()
            .any(|reason| reason.contains("preset=")));
    }

    #[test]
    fn plan_collaboration_mode_prefers_deliberate_strategy() {
        let strategy = select_turn_strategy_with_options(
            "ship this release safely",
            TurnStrategySelectionOptions {
                strategy_preset: None,
                collaboration_mode: Some("plan"),
                request_user_input_enabled: None,
            },
        );
        assert_eq!(strategy.kind, TurnStrategyKind::DeliberateExecution);
    }

    #[test]
    fn request_user_input_toggle_overrides_strategy_default() {
        let strategy = select_turn_strategy_with_options(
            "ok",
            TurnStrategySelectionOptions {
                strategy_preset: Some("expedite"),
                collaboration_mode: None,
                request_user_input_enabled: Some(true),
            },
        );
        assert_eq!(strategy.kind, TurnStrategyKind::ExpediteExecution);
        assert!(strategy.request_user_input_enabled());
    }

    #[test]
    fn planning_min_chars_hint_tracks_strategy_kind() {
        let standard = select_turn_strategy("show current status");
        assert_eq!(standard.kind, TurnStrategyKind::StandardExecution);
        assert_eq!(standard.planning_min_chars_hint(), 96);

        let deliberate = select_turn_strategy_with_options(
            &"x".repeat(1400),
            TurnStrategySelectionOptions::default(),
        );
        assert_eq!(deliberate.kind, TurnStrategyKind::DeliberateExecution);
        assert_eq!(deliberate.planning_min_chars_hint(), 48);

        let expedite = select_turn_strategy_with_options(
            "ok",
            TurnStrategySelectionOptions {
                strategy_preset: Some("expedite"),
                collaboration_mode: None,
                request_user_input_enabled: None,
            },
        );
        assert_eq!(expedite.kind, TurnStrategyKind::ExpediteExecution);
        assert_eq!(expedite.planning_min_chars_hint(), 160);
    }
}
