#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TurnStrategyKind {
    StandardExecution,
    BoundedObservation,
}

impl TurnStrategyKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::StandardExecution => "standard_execution",
            Self::BoundedObservation => "bounded_observation",
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
        match self.kind {
            TurnStrategyKind::StandardExecution => None,
            TurnStrategyKind::BoundedObservation => Some(4),
        }
    }

    pub fn reminder_after_step(&self) -> Option<u32> {
        match self.kind {
            TurnStrategyKind::StandardExecution => None,
            TurnStrategyKind::BoundedObservation => Some(2),
        }
    }

    pub fn planning_enabled(&self, requested: bool) -> bool {
        requested && !matches!(self.kind, TurnStrategyKind::BoundedObservation)
    }

    pub fn reflection_enabled(&self, requested: bool) -> bool {
        requested && !matches!(self.kind, TurnStrategyKind::BoundedObservation)
    }

    pub fn prompt_name(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => "standard execution",
            TurnStrategyKind::BoundedObservation => "bounded observational fast path",
        }
    }

    pub fn prompt_summary(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "Use the normal autonomous workflow and match the amount of work to the request."
            }
            TurnStrategyKind::BoundedObservation => {
                "This turn is a straightforward observational request. Answer quickly with minimum sufficient evidence."
            }
        }
    }

    pub fn prompt_planning_policy(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "Use planning only when the task is genuinely non-trivial or the user explicitly asks for a plan."
            }
            TurnStrategyKind::BoundedObservation => {
                "Do not enter deep planning or reflection for this turn unless the user explicitly asks for investigation or a plan."
            }
        }
    }

    pub fn prompt_tool_budget(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "Use the tools needed to complete the request, but keep context focused and avoid unnecessary loops."
            }
            TurnStrategyKind::BoundedObservation => {
                "Prefer one compact probe or a small batch of independent read-only probes. Aim to finish in a few rounds, not a long checklist."
            }
        }
    }

    pub fn prompt_stop_condition(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "Stop when the requested work is complete or when you are genuinely blocked."
            }
            TurnStrategyKind::BoundedObservation => {
                "Stop as soon as the latest question can be answered with concrete evidence from the current turn."
            }
        }
    }

    pub fn prompt_guidance(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "- Keep the work scoped to the user's request.\n- Use tools deliberately and verify edits when you change code.\n- Avoid expanding into adjacent investigations unless they block the requested outcome."
            }
            TurnStrategyKind::BoundedObservation => {
                "- Gather only the minimum sufficient evidence needed to answer.\n- Prefer compact, targeted, read-only probes over exhaustive checklists.\n- If the current evidence already supports an answer, respond now instead of probing for minor extras."
            }
        }
    }

    pub fn todo_items(&self) -> &'static str {
        match self.kind {
            TurnStrategyKind::StandardExecution => {
                "- [in_progress] Resolve the user's latest request.\n- [pending] Run relevant validation after code changes.\n- [pending] Summarize outcomes and residual risks."
            }
            TurnStrategyKind::BoundedObservation => {
                "- [in_progress] Gather the minimum evidence needed to answer the latest request.\n- [pending] Stop probing once the answer is supported.\n- [pending] Summarize the findings and any remaining uncertainty."
            }
        }
    }

    pub fn reminder_message(&self) -> Option<&'static str> {
        match self.kind {
            TurnStrategyKind::StandardExecution => None,
            TurnStrategyKind::BoundedObservation => Some(
                "[Lyra Strategy Reminder] This is a bounded observational request. Use the evidence already gathered unless a specific missing fact still blocks the answer. Avoid broad additional probes.",
            ),
        }
    }

    pub fn soft_cap_message(&self, cap: u32, caller_provided: bool) -> Option<String> {
        if caller_provided {
            return Some(format!(
                "the current request reached the caller-provided soft cap ({cap} tool steps)"
            ));
        }
        match self.kind {
            TurnStrategyKind::StandardExecution => None,
            TurnStrategyKind::BoundedObservation => Some(format!(
                "this bounded observational request already used {cap} tool steps. Answer with the evidence you have, or ask the user for a narrower follow-up if a specific fact is still missing."
            )),
        }
    }
}

pub fn select_turn_strategy(input: &str) -> TurnStrategy {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return standard_strategy(vec!["empty_input".to_string()]);
    }

    let lower = trimmed.to_lowercase();
    let short_request = trimmed.chars().count() <= 220 && trimmed.lines().count() <= 4;
    let observation_phrasing = contains_any(&lower, OBSERVATION_HINTS);
    let deep_work_phrasing = contains_any(&lower, DEEP_WORK_HINTS);
    let dense_context = contains_any(trimmed, DENSE_CONTEXT_HINTS) || trimmed.lines().count() > 6;

    if short_request && observation_phrasing && !deep_work_phrasing && !dense_context {
        return TurnStrategy {
            kind: TurnStrategyKind::BoundedObservation,
            reasons: vec![
                "short_request".to_string(),
                "observation_phrasing".to_string(),
            ],
        };
    }

    let mut reasons = Vec::new();
    if deep_work_phrasing {
        reasons.push("deep_work_phrasing".to_string());
    }
    if dense_context {
        reasons.push("dense_context".to_string());
    }
    if !observation_phrasing {
        reasons.push("no_observation_fast_path_signal".to_string());
    }
    if reasons.is_empty() {
        reasons.push("default_full_execution".to_string());
    }
    standard_strategy(reasons)
}

fn standard_strategy(reasons: Vec<String>) -> TurnStrategy {
    TurnStrategy {
        kind: TurnStrategyKind::StandardExecution,
        reasons,
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

const OBSERVATION_HINTS: &[&str] = &[
    "check",
    "inspect",
    "look at",
    "look over",
    "show",
    "tell me",
    "status",
    "health",
    "what is",
    "what's",
    "how is",
    "how's",
    "看一下",
    "看下",
    "看看",
    "查一下",
    "查下",
    "检查一下",
    "检查下",
    "检查",
    "状态",
    "状况",
    "情况",
    "怎么样",
    "咋样",
    "多少",
    "显示",
    "列出",
];

const DEEP_WORK_HINTS: &[&str] = &[
    "fix",
    "implement",
    "edit",
    "change",
    "modify",
    "write",
    "create",
    "add ",
    "add a",
    "remove",
    "delete",
    "refactor",
    "optimize",
    "install",
    "deploy",
    "migrate",
    "plan",
    "strategy",
    "steps",
    "debug",
    "investigate",
    "analyze",
    "analysis",
    "root cause",
    "why ",
    "why is",
    "why are",
    "trace",
    "profile",
    "benchmark",
    "修复",
    "实现",
    "新增",
    "添加",
    "删除",
    "修改",
    "重构",
    "优化",
    "安装",
    "部署",
    "迁移",
    "规划",
    "计划",
    "方案",
    "步骤",
    "调试",
    "排查",
    "分析",
    "原因",
    "根因",
    "为什么",
    "加个",
    "加上",
    "改成",
    "写一个",
];

const DENSE_CONTEXT_HINTS: &[&str] = &[
    "```",
    "\n    ",
    "stack trace",
    "error:",
    "exception",
    "cargo test",
    "npm ",
    "pnpm ",
    "yarn ",
    "package.json",
    "cargo.toml",
    ".rs",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".go",
    ".java",
];

#[cfg(test)]
mod tests {
    use super::{select_turn_strategy, TurnStrategyKind};

    #[test]
    fn simple_observation_requests_use_bounded_observation() {
        let strategy = select_turn_strategy("看一下电脑现在状态怎么样");
        assert_eq!(strategy.kind, TurnStrategyKind::BoundedObservation);
        assert!(strategy
            .reasons
            .iter()
            .any(|reason| reason == "observation_phrasing"));
    }

    #[test]
    fn implementation_requests_stay_on_standard_execution() {
        let strategy = select_turn_strategy("看一下这个界面然后加个按钮");
        assert_eq!(strategy.kind, TurnStrategyKind::StandardExecution);
        assert!(strategy
            .reasons
            .iter()
            .any(|reason| reason == "deep_work_phrasing"));
    }

    #[test]
    fn deep_diagnostic_requests_stay_on_standard_execution() {
        let strategy = select_turn_strategy("帮我分析一下为什么构建一直失败");
        assert_eq!(strategy.kind, TurnStrategyKind::StandardExecution);
    }
}
