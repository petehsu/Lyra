use super::*;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSessionsRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub collaboration_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadSessionRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentReadFollowRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPauseFollowRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    #[serde(default)]
    pub follow_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResumeFollowRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    #[serde(default)]
    pub follow_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSessionRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub project_root: Option<String>,
    #[serde(default)]
    pub collaboration_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTurnRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    #[serde(default)]
    pub session_id: Option<String>,
    pub input: RuntimeTurnInput,
    #[serde(default)]
    pub options: RuntimeThreadOptions,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTurnRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeThreadOptions {
    #[serde(default)]
    pub profile_id: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub model_provider: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub collaboration_mode: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default)]
    pub verbosity: Option<String>,
    #[serde(default)]
    pub approval_policy: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
    #[serde(default)]
    pub follow_enabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTurnInput {
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<RuntimeTurnAttachment>,
    #[serde(default)]
    pub parts: Vec<RuntimeTurnInputPart>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeTurnAttachment {
    pub name: String,
    pub path: String,
    pub kind: String,
    #[serde(default)]
    pub context_text: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RuntimeTurnInputPart {
    Text { text: String },
    Attachment { attachment: RuntimeTurnAttachment },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SendTurnResult {
    pub session_id: String,
    pub turn_id: String,
    pub detail: AgentSessionDetail,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelTurnResult {
    pub session_id: String,
    pub turn_id: String,
    pub cancelled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateTodoRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub source: Option<Value>,
    pub items: Vec<CreateTodoItemInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreateTodoResult {
    pub session_id: String,
    pub todo_list_id: String,
    pub execution_run_id: String,
    pub detail: AgentSessionDetail,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreatePlanRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    pub title: String,
    pub objective_summary: String,
    #[serde(default)]
    pub source: Option<Value>,
    pub version: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCreatePlanResult {
    pub session_id: String,
    pub plan_id: String,
    pub version_id: String,
    pub panel_id: String,
    pub detail: AgentSessionDetail,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResolvePlanReviewRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    pub plan_id: String,
    pub version_id: String,
    pub decision: String,
    #[serde(default)]
    pub annotation_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResolvePlanReviewResult {
    pub session_id: String,
    pub plan_id: String,
    pub version_id: String,
    pub status: String,
    pub detail: AgentSessionDetail,
}
