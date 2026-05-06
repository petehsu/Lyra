use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionMode {
    Sandbox,
    FullAccess,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApplyPatchRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    #[serde(default)]
    pub artifact_id: Option<String>,
    #[serde(default)]
    pub patch_ref: Option<String>,
    #[serde(default)]
    pub permission_mode: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApplyPatchResult {
    pub session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
    pub status: String,
    pub detail: String,
    pub approval_ticket_id: String,
    pub artifact_id: String,
    pub evidence_id: String,
    pub patch_ref: String,
    pub changed_files: Vec<PatchChangedFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResolveApprovalRequest {
    #[serde(flatten)]
    pub storage: StorageRequest,
    pub session_id: String,
    pub approval_ticket_id: String,
    pub decision: ApprovalDecision,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    Approve,
    Deny,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentResolveApprovalResult {
    pub session_id: String,
    pub approval_ticket_id: String,
    pub status: String,
    pub detail: String,
    pub tool_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch_ref: Option<String>,
    #[serde(default)]
    pub changed_files: Vec<PatchChangedFile>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ApprovalSource {
    Model(PermissionMode),
    UserApproved,
    UserApprovedTicket(String),
}

pub(super) struct PreparedPatchApply {
    pub(super) record: DiffArtifactBlobRecord,
    pub(super) plan: PatchApplyPlan,
}

pub(super) struct AppliedPatch {
    pub(super) approval_ticket_id: String,
    pub(super) artifact_id: String,
    pub(super) evidence_id: String,
    pub(super) verification_plan_id: Option<String>,
    pub(super) patch_ref: String,
    pub(super) source_artifact_id: String,
    pub(super) changed_files: Vec<PatchChangedFile>,
    pub(super) backup_refs: Vec<PatchFileBackupRef>,
}

pub(super) struct PreparedPatchRollback {
    pub(super) applied_record: DiffArtifactBlobRecord,
    pub(super) source_artifact_id: String,
    pub(super) patch_ref: String,
    pub(super) changed_files: Vec<PatchChangedFile>,
    pub(super) backup_refs: Vec<PatchFileBackupRef>,
    pub(super) backups: Vec<PatchFileBackupRecord>,
}

pub(super) struct RollbackPatch {
    pub(super) approval_ticket_id: String,
    pub(super) artifact_id: String,
    pub(super) evidence_id: String,
    pub(super) rolled_back_artifact_id: String,
    pub(super) patch_ref: String,
    pub(super) changed_files: Vec<PatchChangedFile>,
}

impl PermissionMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Sandbox => "sandbox",
            Self::FullAccess => "full_access",
        }
    }
}

pub fn normalize_permission_mode(
    permission_mode: Option<&str>,
    approval_policy: Option<&str>,
) -> PermissionMode {
    if permission_mode.and_then(trim_to_string).as_deref() == Some("full_access")
        || approval_policy.and_then(trim_to_string).as_deref() == Some("never")
    {
        PermissionMode::FullAccess
    } else {
        PermissionMode::Sandbox
    }
}
