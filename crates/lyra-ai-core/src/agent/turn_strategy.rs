#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TurnStrategyKind {
    StandardExecution,
}

impl TurnStrategyKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StandardExecution => "standard_execution",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TurnStrategy {
    pub kind: TurnStrategyKind,
    pub reasons: Vec<String>,
}

impl TurnStrategy {
    pub fn default_max_steps(&self) -> Option<u32> {
        None
    }

    pub fn reminder_after_step(&self) -> Option<u32> {
        None
    }

    pub fn planning_enabled(&self, requested: bool) -> bool {
        requested
    }

    pub fn reflection_enabled(&self, requested: bool) -> bool {
        requested
    }

    pub fn prompt_name(&self) -> &'static str {
        "standard execution"
    }

    pub fn prompt_summary(&self) -> &'static str {
        "Use the normal autonomous workflow and match the amount of work to the request."
    }

    pub fn prompt_planning_policy(&self) -> &'static str {
        "Use planning only when the task is genuinely non-trivial or the user explicitly asks for a plan."
    }

    pub fn prompt_tool_budget(&self) -> &'static str {
        "Use the tools needed to complete the request, but keep context focused and avoid unnecessary loops."
    }

    pub fn prompt_stop_condition(&self) -> &'static str {
        "Stop when the requested work is complete or when you are genuinely blocked."
    }

    pub fn prompt_guidance(&self) -> &'static str {
        "- Keep the work scoped to the user's request.\n- Use tools deliberately and verify edits when you change code.\n- Avoid expanding into adjacent investigations unless they block the requested outcome."
    }

    pub fn todo_items(&self) -> &'static str {
        "- [in_progress] Resolve the user's latest request.\n- [pending] Run relevant validation after code changes.\n- [pending] Summarize outcomes and residual risks."
    }

    pub fn reminder_message(&self) -> Option<&'static str> {
        None
    }

    pub fn soft_cap_message(&self, cap: u32, caller_provided: bool) -> Option<String> {
        if caller_provided {
            return Some(format!(
                "the current request reached the caller-provided soft cap ({cap} tool steps)"
            ));
        }
        None
    }
}

pub fn select_turn_strategy(input: &str) -> TurnStrategy {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return standard_strategy(vec!["empty_input".to_string()]);
    }

    standard_strategy(vec![
        "automatic_turn_strategy_classifier_disabled".to_string(),
        format!("input_chars={}", trimmed.chars().count()),
        format!("input_lines={}", trimmed.lines().count()),
    ])
}

fn standard_strategy(reasons: Vec<String>) -> TurnStrategy {
    TurnStrategy {
        kind: TurnStrategyKind::StandardExecution,
        reasons,
    }
}

#[cfg(test)]
mod tests {
    use super::{select_turn_strategy, TurnStrategyKind};

    #[test]
    fn automatic_selection_defaults_to_standard_execution() {
        let strategy = select_turn_strategy("看一下电脑现在状态怎么样");
        assert_eq!(strategy.kind, TurnStrategyKind::StandardExecution);
        assert!(strategy
            .reasons
            .iter()
            .any(|reason| reason == "automatic_turn_strategy_classifier_disabled"));
    }

    #[test]
    fn implementation_requests_remain_on_standard_execution() {
        let strategy = select_turn_strategy("看一下这个界面然后加个按钮");
        assert_eq!(strategy.kind, TurnStrategyKind::StandardExecution);
        assert!(strategy
            .reasons
            .iter()
            .any(|reason| reason == "automatic_turn_strategy_classifier_disabled"));
    }

    #[test]
    fn deep_diagnostic_requests_remain_on_standard_execution() {
        let strategy = select_turn_strategy("帮我分析一下为什么构建一直失败");
        assert_eq!(strategy.kind, TurnStrategyKind::StandardExecution);
    }
}
