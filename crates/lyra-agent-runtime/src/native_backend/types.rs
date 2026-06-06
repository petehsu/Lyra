use super::*;

pub(crate) struct NativeRuntimeState {
    pub(crate) root: PathBuf,
    pub(crate) tool_runtime_schema_version: u32,
    pub(crate) tool_runtime_migration_diagnostics: Vec<Value>,
    pub(crate) sessions: HashMap<String, NativeSession>,
    pub(crate) active_session_id: Option<String>,
    pub(crate) config: NativeConfig,
    pub(crate) active_skills: HashSet<String>,
    pub(crate) overnight_runs: HashMap<String, Value>,
    pub(crate) pending_permissions: HashMap<String, PermissionRequest>,
    pub(crate) pending_clarifications: HashMap<String, ClarificationRequest>,
    pub(crate) goals: HashMap<String, LyraGoal>,
    pub(crate) focused_goal_id: Option<String>,
    pub(crate) cancelled_turns: HashSet<String>,
    pub(crate) active_cancellations: HashMap<String, Arc<AtomicBool>>,
    pub(crate) event_callback: Option<Arc<EventCallback>>,
    pub(crate) host_dispatcher: Option<Arc<HostCapabilityDispatcher>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeStateFile {
    #[serde(default)]
    pub(crate) tool_runtime_schema_version: u32,
    #[serde(default)]
    pub(crate) tool_runtime_migration_diagnostics: Vec<Value>,
    pub(crate) active_session_id: Option<String>,
    pub(crate) config: NativeConfig,
    #[serde(default, rename = "sharedMemory", skip_serializing)]
    pub(crate) legacy_shared_memory: Vec<SharedMemoryRecord>,
    #[serde(default)]
    pub(crate) active_skills: HashSet<String>,
    #[serde(default)]
    pub(crate) overnight_runs: HashMap<String, Value>,
    #[serde(default)]
    pub(crate) pending_permissions: HashMap<String, PermissionRequest>,
    #[serde(default)]
    pub(crate) pending_clarifications: HashMap<String, ClarificationRequest>,
    #[serde(default)]
    pub(crate) goals: HashMap<String, LyraGoal>,
    #[serde(default)]
    pub(crate) focused_goal_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeSession {
    pub(crate) id: String,
    pub(crate) snapshot: Value,
    pub(crate) created_at: String,
    pub(crate) saved: bool,
    pub(crate) save_label: Option<String>,
    pub(crate) archived: bool,
    pub(crate) custom_title: Option<String>,
    pub(crate) short_name: Option<String>,
    pub(crate) runtime_turns: Vec<Value>,
    #[serde(default)]
    pub(crate) rollback_checkpoints: Vec<RollbackCheckpoint>,
    #[serde(default, skip)]
    pub(crate) dirty: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeConfig {
    pub(crate) default_provider: Option<String>,
    pub(crate) default_model: Option<String>,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) service_tier: Option<String>,
    #[serde(default)]
    pub(crate) providers: HashMap<String, NativeProviderProfile>,
    #[serde(default)]
    pub(crate) roles: HashMap<String, String>,
    #[serde(default)]
    pub(crate) accounts: Vec<NativeAccount>,
    #[serde(default)]
    pub(crate) notifications: Map<String, Value>,
    #[serde(default = "default_true")]
    pub(crate) proactive_enabled: bool,
    #[serde(default)]
    pub(crate) proactive_disabled_triggers: HashSet<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeProviderProfile {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) provider_type: String,
    pub(crate) base_url: Option<String>,
    pub(crate) default_model: Option<String>,
    pub(crate) api_key: Option<String>,
    pub(crate) api_key_env: Option<String>,
    pub(crate) auth_header: Option<String>,
    pub(crate) embedding_model: Option<String>,
    #[serde(default)]
    pub(crate) models: Vec<NativeProviderModel>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeProviderModel {
    pub(crate) id: String,
    pub(crate) label: Option<String>,
    pub(crate) context_window: Option<usize>,
    #[serde(default = "default_true")]
    pub(crate) supports_image_input: bool,
    #[serde(default = "default_true")]
    pub(crate) supports_tool_calling: bool,
    #[serde(default = "default_true")]
    pub(crate) supports_streaming: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeAccount {
    pub(crate) provider: String,
    pub(crate) label: String,
    pub(crate) kind: String,
    pub(crate) active: bool,
    pub(crate) configured: bool,
    pub(crate) detail: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SharedMemoryRecord {
    pub(crate) id: String,
    pub(crate) scope: String,
    pub(crate) content: Value,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) priority: i64,
    #[serde(default)]
    pub(crate) injection_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_injected_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) confidence: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LongTermMemoryRecord {
    pub(crate) id: String,
    pub(crate) scope: String,
    pub(crate) category: String,
    pub(crate) fact: String,
    pub(crate) content: Value,
    pub(crate) confidence: f64,
    pub(crate) source_type: String,
    pub(crate) source_ref: Option<String>,
    pub(crate) status: String,
    pub(crate) priority: i64,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) last_accessed_at: Option<String>,
    pub(crate) access_count: u64,
    pub(crate) tags: Vec<String>,
    pub(crate) related_to: Vec<MemoryRelation>,
    pub(crate) expires_at: Option<String>,
    pub(crate) supersedes: Option<String>,
    pub(crate) superseded_by: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryRelation {
    pub(crate) source_id: String,
    pub(crate) target_id: String,
    pub(crate) relation: String,
    pub(crate) confidence: f64,
    pub(crate) created_at: String,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct MemoryQuery {
    pub(crate) query: Option<String>,
    pub(crate) scope: Option<String>,
    pub(crate) category: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) include_archived: bool,
    pub(crate) include_related: bool,
    pub(crate) explain: bool,
    pub(crate) min_score: Option<f64>,
    pub(crate) limit: usize,
    pub(crate) offset: usize,
    pub(crate) touch_access: bool,
    pub(crate) access_type: String,
}

#[derive(Clone, Debug)]
pub(crate) struct RankedMemoryRecord {
    pub(crate) record: LongTermMemoryRecord,
    pub(crate) score: f64,
    pub(crate) breakdown: MemoryScoreBreakdown,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryScoreBreakdown {
    pub(crate) fts_score: f64,
    pub(crate) vector_score: f64,
    pub(crate) metadata_relevance: f64,
    pub(crate) confidence_boost: f64,
    pub(crate) access_frequency_boost: f64,
    pub(crate) graph_boost: f64,
    pub(crate) recency_boost: f64,
    pub(crate) decay_penalty: f64,
    pub(crate) contradiction_penalty: f64,
    pub(crate) final_score: f64,
    pub(crate) half_life_days: f64,
    pub(crate) age_days: f64,
    pub(crate) retention: f64,
    pub(crate) matched_by: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct MemoryMutation {
    pub(crate) id: Option<String>,
    pub(crate) scope: Option<String>,
    pub(crate) category: Option<String>,
    pub(crate) fact: Option<String>,
    pub(crate) content: Option<Value>,
    pub(crate) confidence: Option<f64>,
    pub(crate) source_type: Option<String>,
    pub(crate) source_ref: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) priority: Option<i64>,
    pub(crate) tags: Option<Vec<String>>,
    pub(crate) related_to: Option<Vec<MemoryRelation>>,
    pub(crate) expires_at: Option<String>,
    pub(crate) supersedes: Option<String>,
    pub(crate) superseded_by: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryCandidate {
    pub(crate) id: String,
    pub(crate) fact: String,
    pub(crate) content: Value,
    pub(crate) category: String,
    pub(crate) scope: String,
    pub(crate) confidence: f64,
    pub(crate) source_type: String,
    pub(crate) source_ref: Option<String>,
    pub(crate) proposed_action: String,
    pub(crate) conflict_with: Option<String>,
    pub(crate) target_id: Option<String>,
    pub(crate) relation_type: Option<String>,
    pub(crate) status: String,
    pub(crate) created_at: String,
    pub(crate) reviewed_at: Option<String>,
    pub(crate) expires_at: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub(crate) struct MemoryCandidateMutation {
    pub(crate) fact: String,
    pub(crate) content: Value,
    pub(crate) category: String,
    pub(crate) scope: String,
    pub(crate) confidence: f64,
    pub(crate) source_type: String,
    pub(crate) source_ref: Option<String>,
    pub(crate) proposed_action: String,
    pub(crate) conflict_with: Option<String>,
    pub(crate) target_id: Option<String>,
    pub(crate) relation_type: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) expires_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProactiveEvent {
    pub(crate) id: String,
    pub(crate) trigger_type: String,
    pub(crate) title: String,
    pub(crate) reason: String,
    pub(crate) source: Value,
    pub(crate) mode: String,
    pub(crate) status: String,
    pub(crate) session_id: Option<String>,
    pub(crate) created_at: String,
    pub(crate) dismissed_at: Option<String>,
    pub(crate) opened_session_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RollbackCheckpoint {
    pub(crate) id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: String,
    pub(crate) message_id: String,
    pub(crate) created_at: String,
    pub(crate) changed_files: Vec<RollbackFileCheckpoint>,
    pub(crate) artifact_refs: Vec<Value>,
    pub(crate) before_messages: Vec<Value>,
    pub(crate) before_tools: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RollbackFileCheckpoint {
    pub(crate) path: String,
    pub(crate) absolute_path: String,
    pub(crate) before_exists: bool,
    pub(crate) before_content: Option<String>,
    pub(crate) after_exists: Option<bool>,
    pub(crate) after_content: Option<String>,
    #[serde(default)]
    pub(crate) artifact_refs: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PermissionRequest {
    pub(crate) id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: String,
    pub(crate) tool_call_id: String,
    pub(crate) action: String,
    pub(crate) risk: String,
    pub(crate) summary: String,
    pub(crate) why: String,
    pub(crate) title: String,
    pub(crate) detail: String,
    pub(crate) status: String,
    pub(crate) allowed: Option<bool>,
    pub(crate) created_at: String,
    pub(crate) responded_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClarificationRequest {
    pub(crate) id: String,
    pub(crate) session_id: String,
    pub(crate) turn_id: String,
    pub(crate) tool_call_id: String,
    pub(crate) question: String,
    pub(crate) options: Vec<Value>,
    pub(crate) allow_custom_answer: bool,
    pub(crate) detail: Option<String>,
    pub(crate) status: String,
    pub(crate) answer: Option<String>,
    pub(crate) selected_option: Option<String>,
    pub(crate) created_at: String,
    pub(crate) responded_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LyraGoal {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) status: String,
    pub(crate) scope: Option<String>,
    pub(crate) session_id: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) checkpoints: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelfDevState {
    pub(crate) mode: String,
    pub(crate) target: String,
    pub(crate) repo_root: String,
    pub(crate) capabilities: Vec<SelfDevCapability>,
    pub(crate) build: SelfDevTaskState,
    pub(crate) test: SelfDevTaskState,
    pub(crate) reload: SelfDevTaskState,
    pub(crate) started_at: String,
    pub(crate) updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelfDevCapability {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) kind: String,
    pub(crate) available: bool,
    pub(crate) tool: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelfDevTaskState {
    pub(crate) status: String,
    pub(crate) last_command: Option<String>,
    pub(crate) last_result: Option<String>,
    pub(crate) updated_at: String,
}
