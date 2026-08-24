use super::{
    NativeSession, Value,
    pinned_context::{PinnedItem, collect_pinned_items, pinned_message_ids},
};
use crate::retention_policy::{
    InterleavedTrimPlan, RetentionPolicy, RetentionSignals, TrimAggressiveness,
    build_interleaved_trim_plan,
};
use std::collections::HashSet;

#[derive(Clone, Debug)]
pub(crate) struct TrimControllerConfig {
    pub trim_trigger_tokens: usize,
    pub target_tokens: usize,
    pub protected_recent_tokens: usize,
}

impl Default for TrimControllerConfig {
    fn default() -> Self {
        let policy = crate::retention_policy::retention_policy_from_messages(
            &[],
            &RetentionSignals {
                context_window: None,
                session_tool_count: 0,
                last_turn_tool_count: 0,
            },
        );
        crate::retention_policy::trim_controller_config_from_policy(policy)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct ContextWindowPlan {
    pub pinned_message_ids: HashSet<String>,
    pub pinned_items: Vec<PinnedItem>,
    pub trim_ordinals: Vec<usize>,
    pub token_before: usize,
    pub token_after: usize,
}

impl From<InterleavedTrimPlan> for ContextWindowPlan {
    fn from(plan: InterleavedTrimPlan) -> Self {
        Self {
            pinned_message_ids: HashSet::new(),
            pinned_items: Vec::new(),
            trim_ordinals: plan.trim_ordinals,
            token_before: plan.token_before,
            token_after: plan.token_after,
        }
    }
}

pub(crate) fn build_context_window_plan(
    session: &NativeSession,
    config: &TrimControllerConfig,
    active_clarification: Option<&Value>,
) -> Option<ContextWindowPlan> {
    let messages = session.snapshot.get("messages")?.as_array()?;
    let pinned_items = collect_pinned_items(session, active_clarification);
    let pinned_ids = pinned_message_ids(&pinned_items);
    let policy = RetentionPolicy {
        usable_context_tokens: config.trim_trigger_tokens.max(config.target_tokens),
        trim_trigger_tokens: config.trim_trigger_tokens,
        target_tokens: config.target_tokens,
        protected_recent_tokens: config.protected_recent_tokens,
        complexity_score: 0,
        complexity_band: crate::retention_policy::ComplexityBand::Simple,
        has_explicit_context_window: false,
    };
    let interleaved =
        build_interleaved_trim_plan(messages, &policy, &pinned_ids, TrimAggressiveness::Normal)?;
    if interleaved.trim_ordinals.is_empty() {
        return None;
    }
    let mut plan = ContextWindowPlan::from(interleaved);
    plan.pinned_message_ids = pinned_ids;
    plan.pinned_items = pinned_items;
    Some(plan)
}

pub(crate) fn filter_messages_by_window_plan(
    messages: &[Value],
    plan: &ContextWindowPlan,
) -> (Vec<Value>, usize) {
    let before = messages.len();
    let trim_set: HashSet<usize> = plan.trim_ordinals.iter().copied().collect();
    let filtered = messages
        .iter()
        .enumerate()
        .filter_map(|(ordinal, message)| {
            let message_id = message.get("id").and_then(Value::as_str).unwrap_or("");
            if trim_set.contains(&ordinal) && !plan.pinned_message_ids.contains(message_id) {
                None
            } else {
                Some(message.clone())
            }
        })
        .collect::<Vec<_>>();
    let dropped = before.saturating_sub(filtered.len());
    (filtered, dropped)
}
