use std::sync::Arc;

use async_trait::async_trait;
use lyra_agent_api::{AgentToolCapabilityRef, AgentToolResult, AgentToolStatus};
use lyra_agent_plugins::{ToolCapability, ToolProvider, ToolProviderRegistry};
use serde_json::{Value, json};

#[derive(Clone)]
pub struct ToolActivityService {
    registry: ToolProviderRegistry,
}

impl std::fmt::Debug for ToolActivityService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ToolActivityService")
            .field("capability_count", &self.registry.capabilities().len())
            .finish()
    }
}

impl Default for ToolActivityService {
    fn default() -> Self {
        let registry = ToolProviderRegistry::default();
        registry.register(Arc::new(BuiltInLyraToolProvider));
        Self { registry }
    }
}

impl ToolActivityService {
    pub const NAME: &'static str = "tool_activity_service";

    pub fn register_provider(&self, provider: Arc<dyn ToolProvider>) {
        self.registry.register(provider);
    }

    pub fn capabilities(&self) -> Vec<ToolCapability> {
        self.registry.capabilities()
    }

    pub fn project_result(
        &self,
        name: String,
        result: lyra_agent_api::AgentToolResult,
    ) -> lyra_agent_api::AgentToolActivity {
        lyra_agent_api::AgentToolActivity {
            id: result.tool_call_id,
            name: name.clone(),
            label: name,
            status: result.status,
            input: None,
            output: result.output,
            started_at: String::new(),
            finished_at: None,
        }
    }

    pub fn built_in_capabilities(&self) -> Value {
        json!({
            "tools": self.capabilities().into_iter().map(tool_capability_json).collect::<Vec<_>>()
        })
    }
}

struct BuiltInLyraToolProvider;

#[async_trait]
impl ToolProvider for BuiltInLyraToolProvider {
    fn id(&self) -> &str {
        "lyra-core"
    }

    fn capabilities(&self) -> Vec<ToolCapability> {
        vec![
            capability(
                "lyra-core",
                "read",
                "Read files or project state",
                "read",
                None,
            ),
            capability("lyra-core", "edit", "Edit workspace files", "write", None),
            capability("lyra-core", "bash", "Run shell commands", "command", None),
            capability(
                "lyra-core",
                "memory",
                "Read or update Agent memory",
                "state",
                None,
            ),
            capability(
                "lyra-software",
                "software",
                "Call a Lyra software adapter",
                "hostCapability",
                Some("software.invoke"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen",
                "Operate the Lyra browser surface",
                "hostCapability",
                Some("browser.operate"),
            ),
        ]
    }

    async fn execute(&self, capability: &AgentToolCapabilityRef, _input: Value) -> AgentToolResult {
        AgentToolResult {
            tool_call_id: capability
                .capability_id
                .clone()
                .unwrap_or_else(|| capability.tool_name.clone()),
            status: AgentToolStatus::Failed,
            output: None,
            error: Some(lyra_agent_api::LyraAgentError {
                code: lyra_agent_api::LyraAgentErrorCode::CapabilityUnavailable,
                message: "Built-in Lyra tools are executed by the core runtime dispatch path"
                    .to_string(),
                recoverability: lyra_agent_api::Recoverability::UserActionRequired,
                severity: lyra_agent_api::UserVisibleSeverity::Warning,
                detail: None,
            }),
        }
    }
}

fn capability(
    provider_id: &str,
    tool_name: &str,
    description: &str,
    risk_level: &str,
    required_host_capability: Option<&str>,
) -> ToolCapability {
    ToolCapability {
        reference: AgentToolCapabilityRef {
            provider_id: provider_id.to_string(),
            tool_name: tool_name.to_string(),
            capability_id: None,
        },
        description: description.to_string(),
        schema: json!({ "type": "object" }),
        risk_level: risk_level.to_string(),
        permission_policy: "runtimePolicy".to_string(),
        ui_renderer_hint: None,
        required_host_capability: required_host_capability.map(str::to_string),
    }
}

fn tool_capability_json(capability: ToolCapability) -> Value {
    json!({
        "providerId": capability.reference.provider_id,
        "name": capability.reference.tool_name,
        "capabilityId": capability.reference.capability_id,
        "description": capability.description,
        "schema": capability.schema,
        "riskLevel": capability.risk_level,
        "permissionPolicy": capability.permission_policy,
        "uiRendererHint": capability.ui_renderer_hint,
        "requiredHostCapability": capability.required_host_capability,
    })
}

#[cfg(test)]
mod tests {
    use super::ToolActivityService;

    #[test]
    fn tool_capabilities_are_registry_backed() {
        let service = ToolActivityService::default();
        let tools = service.built_in_capabilities();
        let names = tools["tools"]
            .as_array()
            .expect("tools array")
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect::<Vec<_>>();

        assert!(names.contains(&"read"));
        assert!(names.contains(&"software"));
        assert!(names.contains(&"lyra_lumen"));
    }
}
