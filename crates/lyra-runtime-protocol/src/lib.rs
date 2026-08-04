use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_MIN_VERSION: u32 = 2;
pub const PROTOCOL_MAX_VERSION: u32 = 2;

/// Stable, distributable definition of one Lyra Agent package.
///
/// This is deliberately data-only: hosts keep their existing model, tool and
/// permission runtimes and project this identity into them.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPackageManifest {
    pub schema_version: String,
    pub agent_id: String,
    pub name: String,
    pub short_name: String,
    pub role: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub profile: AgentPackageProfile,
    #[serde(default)]
    pub icons: Vec<AgentPackageIcon>,
    pub prompt: AgentPackagePrompt,
    #[serde(default)]
    pub capabilities: AgentPackageCapabilities,
    #[serde(default)]
    pub permissions: Vec<String>,
    /// Public, prompt-safe routing information. Hosts may expose this to a
    /// coordinating Agent without exposing the package prompt or private state.
    #[serde(default)]
    pub delegation: AgentPackageDelegation,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPackageProfile {
    #[serde(default)]
    pub facts: Vec<AgentPackageFact>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPackageFact {
    pub key: String,
    pub label: String,
    pub value: String,
    pub visibility: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPackageIcon {
    pub src: String,
    #[serde(rename = "type")]
    pub media_type: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPackagePrompt {
    pub main: String,
    #[serde(default)]
    pub variables: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPackageCapabilities {
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub code_hooks: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPackageDelegation {
    #[serde(default)]
    pub specialties: Vec<String>,
    #[serde(default)]
    pub accepted_work: Vec<String>,
    #[serde(default)]
    pub deliverables: Vec<String>,
    #[serde(default)]
    pub collaboration_hints: Vec<String>,
}

/// A package installed into one Oma session. `session_agent_id` is local to
/// the session; `agent_id` stays stable across installations and distribution.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAgent {
    pub session_agent_id: String,
    pub agent_id: String,
    pub package_version: String,
    pub status: String,
}

/// Backward-compatible name for the Oma session member model.
pub type OmaSessionAgent = SessionAgent;

/// Oma permits exactly one shared channel and per-session-Agent private
/// channels. Hosts derive the persisted channel id through [`OmaChannel::id`].
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum OmaChannel {
    GroupDefault,
    Direct { session_agent_id: String },
}

impl OmaChannel {
    pub fn id(&self) -> String {
        match self {
            Self::GroupDefault => "group:default".to_string(),
            Self::Direct { session_agent_id } => format!("direct:{session_agent_id}"),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmaChannelContext {
    #[serde(default)]
    pub messages: Vec<Value>,
    #[serde(default)]
    pub tools: Vec<Value>,
    #[serde(default)]
    pub todos: Vec<Value>,
    #[serde(default)]
    pub memory: Option<Value>,
    #[serde(default)]
    pub prompt_runtime_contract: Option<Value>,
    #[serde(default)]
    pub prompt_delivery: Option<Value>,
    #[serde(default)]
    pub token_estimate: Option<Value>,
    #[serde(default)]
    pub token_estimate_at_ms: Option<Value>,
    #[serde(default)]
    pub plan: Option<Value>,
    #[serde(default)]
    pub project_todo: Option<Value>,
}

/// Per-Agent projection of a structured default-group `@` assignment.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmaExecutionAssignment {
    #[serde(default)]
    pub common_preamble: String,
    #[serde(default)]
    pub task: String,
    #[serde(default)]
    pub task_parts: Vec<String>,
    #[serde(default)]
    pub full_text: String,
}

/// Prompt-safe view of the current Oma roster. It intentionally carries only
/// public package metadata and routing ids; private channel state never crosses
/// this boundary.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmaOrganizationProjection {
    #[serde(default)]
    pub current_agent: Option<OmaOrganizationMember>,
    #[serde(default)]
    pub members: Vec<OmaOrganizationMember>,
    #[serde(default)]
    pub team: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmaOrganizationMember {
    pub session_agent_id: String,
    pub agent_id: String,
    pub name: String,
    pub short_name: String,
    pub role: String,
    pub description: String,
    pub status: String,
    pub source: String,
    pub direct_channel_id: String,
    #[serde(default)]
    pub delegation: AgentPackageDelegation,
}

/// The neutral hand-off boundary for hosts that want to adopt Oma without
/// replacing their existing agent runner.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmaExecutionRequest {
    pub session_id: String,
    pub channel_id: String,
    pub session_agent_id: String,
    pub package: AgentPackageManifest,
    pub context: OmaChannelContext,
    pub input: Value,
    #[serde(default)]
    pub assignment: Option<OmaExecutionAssignment>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RuntimeEnvelope {
    Request {
        id: String,
        method: String,
        payload: Value,
    },
    Response {
        id: String,
        ok: bool,
        result: Option<Value>,
        error: Option<RuntimeError>,
    },
    Event {
        event: String,
        payload: Value,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeConnectionRole {
    PrimaryHost,
    AuxiliaryClient,
}

pub type RuntimeDataSchemas = BTreeMap<String, u32>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHelloV2Request {
    pub protocol_min_version: u32,
    pub protocol_max_version: u32,
    pub client_name: String,
    pub component_version: String,
    pub build_id: String,
    pub host_api_version: String,
    pub capabilities: Vec<String>,
    pub data_schemas: RuntimeDataSchemas,
    pub connection_role: RuntimeConnectionRole,
    pub connection_lease_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHelloV2Response {
    pub protocol_min_version: u32,
    pub protocol_max_version: u32,
    pub negotiated_protocol_version: u32,
    pub server_name: String,
    pub component_version: String,
    pub build_id: String,
    pub host_api_version: String,
    pub capabilities: Vec<String>,
    pub data_schemas: RuntimeDataSchemas,
    pub connection_role: RuntimeConnectionRole,
    pub connection_lease_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityBridgePayload {
    pub request_json: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityBridgeResult {
    pub response_json: String,
}

impl RuntimeError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    pub fn with_details(
        code: impl Into<String>,
        message: impl Into<String>,
        details: Value,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: Some(details),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn oma_execution_request_serializes_package_identity_and_channel_context() {
        let request = OmaExecutionRequest {
            session_id: "session-1".to_string(),
            channel_id: "direct:instance-1".to_string(),
            session_agent_id: "instance-1".to_string(),
            package: AgentPackageManifest {
                schema_version: "lyra.agent.v1".to_string(),
                agent_id: "did:lyra:agent:builtin:lead".to_string(),
                name: "Lyra Lead".to_string(),
                short_name: "Lead".to_string(),
                role: "lead".to_string(),
                version: "1.0.0".to_string(),
                description: "Coordinates work".to_string(),
                profile: AgentPackageProfile::default(),
                icons: vec![AgentPackageIcon {
                    src: "assets/avatar.svg".to_string(),
                    media_type: "image/svg+xml".to_string(),
                }],
                prompt: AgentPackagePrompt {
                    main: "prompts/main.md".to_string(),
                    variables: Vec::new(),
                },
                capabilities: AgentPackageCapabilities::default(),
                permissions: Vec::new(),
                delegation: AgentPackageDelegation::default(),
            },
            context: OmaChannelContext {
                messages: vec![json!({ "role": "user", "text": "hello" })],
                tools: vec![json!({ "id": "tool-1" })],
                todos: vec![json!({ "id": "todo-1" })],
                memory: Some(json!({ "summary": "private" })),
                prompt_runtime_contract: None,
                prompt_delivery: None,
                token_estimate: Some(json!(42)),
                token_estimate_at_ms: Some(json!(1)),
                plan: None,
                project_todo: None,
            },
            input: json!({ "text": "hello" }),
            assignment: Some(OmaExecutionAssignment {
                common_preamble: "Review this change".to_string(),
                task: "Check release risks.".to_string(),
                task_parts: vec!["Check release risks.".to_string()],
                full_text: "Review this change @Reviewer Check release risks.".to_string(),
            }),
        };
        let value = serde_json::to_value(request).expect("serialize");
        assert_eq!(value["sessionAgentId"], "instance-1");
        assert_eq!(value["package"]["agentId"], "did:lyra:agent:builtin:lead");
        assert_eq!(value["context"]["messages"][0]["text"], "hello");
        assert_eq!(value["assignment"]["task"], "Check release risks.");
    }

    #[test]
    fn oma_channels_only_model_the_default_group_or_one_private_agent_channel() {
        assert_eq!(OmaChannel::GroupDefault.id(), "group:default");
        assert_eq!(
            OmaChannel::Direct {
                session_agent_id: "instance-1".to_string(),
            }
            .id(),
            "direct:instance-1"
        );
    }
}
