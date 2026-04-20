use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::agent::context_snip::SnipState;
use crate::agent::file_state_cache::{FileStateCache, FileStateEntry};
use crate::agent::micro_compact::MicroCompactTracker;
use crate::agent::prefetch::{PrefetchCache, PrefetchEntry};
use crate::agent::tool_budget::ToolResultBudgetState;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOptimizationStateSnapshot {
    #[serde(default)]
    pub file_state_cache: HashMap<String, FileStateEntry>,
    #[serde(default)]
    pub tool_result_budget: HashMap<String, String>,
    #[serde(default)]
    pub snip_state: SnipState,
    #[serde(default)]
    pub micro_compact_tracker: HashMap<String, (u64, u32)>,
    #[serde(default)]
    pub prefetch_cache: HashMap<String, PrefetchEntry>,
    #[serde(default)]
    pub current_round: u32,
}

impl RuntimeOptimizationStateSnapshot {
    pub fn capture(
        file_cache: &FileStateCache,
        budget: &ToolResultBudgetState,
        snip_state: &SnipState,
        micro_tracker: &MicroCompactTracker,
        prefetch_cache: &PrefetchCache,
        current_round: u32,
    ) -> Self {
        Self {
            file_state_cache: file_cache.to_map(),
            tool_result_budget: budget.to_map(),
            snip_state: snip_state.clone(),
            micro_compact_tracker: micro_tracker.to_map(),
            prefetch_cache: prefetch_cache.to_map(),
            current_round,
        }
    }

    pub fn restore(
        &self,
        file_cache: &mut FileStateCache,
        budget: &mut ToolResultBudgetState,
        snip_state: &mut SnipState,
        micro_tracker: &mut MicroCompactTracker,
        prefetch_cache: &PrefetchCache,
    ) -> u32 {
        *file_cache = FileStateCache::from_map(self.file_state_cache.clone());
        *budget = ToolResultBudgetState::from_map(self.tool_result_budget.clone());
        *snip_state = self.snip_state.clone();
        *micro_tracker = MicroCompactTracker::from_map(self.micro_compact_tracker.clone());
        prefetch_cache.restore_from_map(self.prefetch_cache.clone());
        self.current_round
    }

    pub fn from_payload(payload: &Value) -> Option<Self> {
        if payload.is_null() {
            return None;
        }
        serde_json::from_value(payload.clone()).ok()
    }

    pub fn to_payload(&self) -> Value {
        serde_json::to_value(self).unwrap_or(Value::Null)
    }

    pub fn is_empty(&self) -> bool {
        self.file_state_cache.is_empty()
            && self.tool_result_budget.is_empty()
            && self.snip_state.total_snipped == 0
            && self.snip_state.snip_passes == 0
            && self.micro_compact_tracker.is_empty()
            && self.prefetch_cache.is_empty()
            && self.current_round == 0
    }
}
