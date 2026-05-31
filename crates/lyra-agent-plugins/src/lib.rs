use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, RwLock},
};

use async_trait::async_trait;
use lyra_agent_api::{
    AgentMemoryProjection, AgentToolActivity, AgentToolCapabilityRef, AgentToolResult,
    AgentToolStatus, LyraAgentError, LyraAgentErrorCode, LyraSoftwareCapability,
    LyraSoftwareCommand, LyraSoftwareEvent, LyraSoftwareRef, Recoverability, UserVisibleSeverity,
};
use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderSelectionKey {
    pub provider_id: String,
    pub profile_id: Option<String>,
    pub model_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderSelection {
    pub key: ProviderSelectionKey,
    pub label: String,
    pub capabilities: ProviderCapabilities,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderCapabilities {
    pub text: bool,
    pub image_input: bool,
    pub tool_calling: bool,
    pub streaming: bool,
    pub reasoning_metadata: bool,
    pub structured_output: bool,
    pub context_window: Option<usize>,
}

#[async_trait]
pub trait ProviderAdapter: Send + Sync {
    fn id(&self) -> &str;
    fn label(&self) -> &str;
    fn capabilities(&self) -> ProviderCapabilities;

    fn selection(&self, model_id: &str, profile_id: Option<&str>) -> ProviderSelection {
        ProviderSelection {
            key: ProviderSelectionKey {
                provider_id: self.id().to_string(),
                profile_id: profile_id.map(str::to_string),
                model_id: model_id.to_string(),
            },
            label: self.label().to_string(),
            capabilities: self.capabilities(),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolCapability {
    pub reference: AgentToolCapabilityRef,
    pub description: String,
    pub schema: Value,
    pub risk_level: String,
    pub permission_policy: String,
    pub ui_renderer_hint: Option<String>,
    pub required_host_capability: Option<String>,
    pub exposure_mode: ToolExposureMode,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ToolExposureMode {
    Always,
    Discoverable,
    InspectRequired,
    Hidden,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModelToolDescriptor {
    pub name: String,
    pub description: String,
    pub schema: Value,
    pub risk_level: String,
    pub permission_policy: String,
    pub capability_ref: AgentToolCapabilityRef,
    pub exposure_mode: ToolExposureMode,
}

impl From<ToolCapability> for ModelToolDescriptor {
    fn from(capability: ToolCapability) -> Self {
        Self {
            name: capability.reference.tool_name.clone(),
            description: capability.description,
            schema: capability.schema,
            risk_level: capability.risk_level,
            permission_policy: capability.permission_policy,
            capability_ref: capability.reference,
            exposure_mode: capability.exposure_mode,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ToolExposureRequest {
    pub task_text: Option<String>,
    pub workspace_focus: Option<String>,
    pub software_focus: Option<String>,
    pub provider_filter: Option<String>,
    pub server_filter: Option<String>,
    pub risk_filter: Option<String>,
    pub page: usize,
    pub page_size: usize,
    pub include_design_tools: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolDiscoveryPage {
    pub tools: Vec<ToolManifest>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub has_more: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ToolManifest {
    pub provider_id: String,
    pub server_id: Option<String>,
    pub name: String,
    pub description: String,
    pub risk_level: String,
    pub permission_policy: String,
    pub schema_ref: Option<String>,
    pub required_host_capability: Option<String>,
}

#[derive(Clone, Debug, Default)]
pub struct ToolExposurePolicy {
    pub max_always_visible_dynamic_tools: usize,
}

impl ToolExposurePolicy {
    pub fn select_model_tools(
        &self,
        capabilities: Vec<ToolCapability>,
        request: &ToolExposureRequest,
    ) -> Vec<ModelToolDescriptor> {
        let max_dynamic = if self.max_always_visible_dynamic_tools == 0 {
            16
        } else {
            self.max_always_visible_dynamic_tools
        };
        let mut always = Vec::new();
        let mut dynamic = Vec::new();

        for capability in capabilities {
            if !matches_provider_filter(&capability, request) {
                continue;
            }
            if !matches_risk_filter(&capability, request) {
                continue;
            }
            match capability.exposure_mode {
                ToolExposureMode::Always => always.push(capability.into()),
                ToolExposureMode::Discoverable => dynamic.push(capability.into()),
                ToolExposureMode::InspectRequired | ToolExposureMode::Hidden => {}
            }
        }

        dynamic.sort_by(|left: &ModelToolDescriptor, right| left.name.cmp(&right.name));
        always.extend(dynamic.into_iter().take(max_dynamic));
        always
    }
}

fn matches_provider_filter(capability: &ToolCapability, request: &ToolExposureRequest) -> bool {
    request
        .provider_filter
        .as_deref()
        .is_none_or(|provider| provider == capability.reference.provider_id)
}

fn matches_risk_filter(capability: &ToolCapability, request: &ToolExposureRequest) -> bool {
    request
        .risk_filter
        .as_deref()
        .is_none_or(|risk| risk == capability.risk_level)
}

#[async_trait]
pub trait ToolProvider: Send + Sync {
    fn id(&self) -> &str;
    fn capabilities(&self) -> Vec<ToolCapability>;
    fn inspect(&self, capability: &AgentToolCapabilityRef) -> Option<ToolCapability> {
        self.capabilities().into_iter().find(|candidate| {
            candidate.reference.provider_id == capability.provider_id
                && candidate.reference.tool_name == capability.tool_name
                && capability
                    .capability_id
                    .as_ref()
                    .is_none_or(|id| candidate.reference.capability_id.as_ref() == Some(id))
        })
    }
    async fn execute(&self, capability: &AgentToolCapabilityRef, input: Value) -> AgentToolResult;
}

#[async_trait]
pub trait SoftwareAdapter: Send + Sync {
    fn id(&self) -> &str;
    fn capabilities(&self) -> Vec<LyraSoftwareCapability>;
    fn surface(&self) -> SoftwareCapabilitySurface {
        SoftwareCapabilitySurface::default()
    }
    async fn invoke(&self, command: LyraSoftwareCommand) -> LyraSoftwareEvent;
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct SoftwareCapabilitySurface {
    pub readable_state: Vec<Value>,
    pub commands: Vec<LyraSoftwareCapability>,
    pub events: Vec<String>,
    pub permissions: Vec<String>,
    pub ui_affordances: Vec<String>,
    pub lightweight_summary: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BrowserOperationMode {
    Implicit,
    FollowVisible,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BrowserWaitStrategy {
    pub selector: Option<String>,
    pub read_until: Option<String>,
    pub timeout_ms: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct BrowserOperationRequest {
    pub mode: BrowserOperationMode,
    pub command: Value,
    pub selector_map: Vec<Value>,
    pub focus_scan: bool,
    pub allow_weak_dom: bool,
    pub allow_visual_fallback: bool,
    pub wait: Option<BrowserWaitStrategy>,
}

#[async_trait]
pub trait BrowserOperator: Send + Sync {
    async fn operate(&self, request: BrowserOperationRequest) -> AgentToolActivity;
}

#[async_trait]
pub trait MemoryStore: Send + Sync {
    async fn read_projection(&self, session_id: &str) -> AgentMemoryProjection;
    async fn write_fact(&self, session_id: &str, fact: Value);
}

pub trait MemoryProjectionBuilder: Send + Sync {
    fn build_projection(&self, session_id: &str, facts: Vec<Value>) -> AgentMemoryProjection;
}

#[derive(Clone, Default)]
pub struct ProviderRegistry {
    providers: Arc<RwLock<Vec<Arc<dyn ProviderAdapter>>>>,
}

impl ProviderRegistry {
    pub fn register(&self, provider: Arc<dyn ProviderAdapter>) {
        if let Ok(mut providers) = self.providers.write() {
            providers.push(provider);
        }
    }

    pub fn list(&self) -> Vec<ProviderRegistration> {
        self.providers
            .read()
            .map(|providers| {
                providers
                    .iter()
                    .map(|provider| ProviderRegistration {
                        id: provider.id().to_string(),
                        label: provider.label().to_string(),
                        capabilities: provider.capabilities(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn select(&self, key: &ProviderSelectionKey) -> Option<ProviderSelection> {
        self.providers.read().ok().and_then(|providers| {
            providers
                .iter()
                .find(|provider| provider.id() == key.provider_id)
                .map(|provider| provider.selection(&key.model_id, key.profile_id.as_deref()))
        })
    }

    pub fn provider_label(&self, key: &ProviderSelectionKey) -> Option<String> {
        self.select(key).map(|selection| selection.label)
    }

    pub fn can_accept_image_input(&self, key: &ProviderSelectionKey) -> bool {
        self.select(key)
            .map(|selection| selection.capabilities.image_input)
            .unwrap_or(false)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProviderRegistration {
    pub id: String,
    pub label: String,
    pub capabilities: ProviderCapabilities,
}

#[derive(Clone, Default)]
pub struct ToolProviderRegistry {
    providers: Arc<RwLock<Vec<Arc<dyn ToolProvider>>>>,
}

impl ToolProviderRegistry {
    pub fn register(&self, provider: Arc<dyn ToolProvider>) {
        if let Ok(mut providers) = self.providers.write() {
            providers.push(provider);
        }
    }

    pub fn capabilities(&self) -> Vec<ToolCapability> {
        self.providers
            .read()
            .map(|providers| {
                providers
                    .iter()
                    .flat_map(|provider| provider.capabilities())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn model_descriptors(&self, request: &ToolExposureRequest) -> Vec<ModelToolDescriptor> {
        ToolExposurePolicy::default().select_model_tools(self.capabilities(), request)
    }

    pub fn inspect(&self, capability: &AgentToolCapabilityRef) -> Option<ToolCapability> {
        self.providers.read().ok().and_then(|providers| {
            providers
                .iter()
                .find(|provider| provider.id() == capability.provider_id)
                .and_then(|provider| provider.inspect(capability))
        })
    }

    pub async fn execute(
        &self,
        capability: &AgentToolCapabilityRef,
        input: Value,
    ) -> AgentToolResult {
        let provider = self.providers.read().ok().and_then(|providers| {
            providers
                .iter()
                .find(|provider| provider.id() == capability.provider_id)
                .cloned()
        });
        match provider {
            Some(provider) => provider.execute(capability, input).await,
            None => failed_tool_result(
                capability
                    .capability_id
                    .clone()
                    .unwrap_or_else(|| capability.tool_name.clone()),
                LyraAgentErrorCode::CapabilityUnavailable,
                format!(
                    "Lyra tool provider is not registered: {}",
                    capability.provider_id
                ),
                Recoverability::UserActionRequired,
            ),
        }
    }
}

#[derive(Clone, Default)]
pub struct SoftwareAdapterRegistry {
    adapters: Arc<RwLock<Vec<Arc<dyn SoftwareAdapter>>>>,
}

impl SoftwareAdapterRegistry {
    pub fn register(&self, adapter: Arc<dyn SoftwareAdapter>) {
        if let Ok(mut adapters) = self.adapters.write() {
            adapters.push(adapter);
        }
    }

    pub fn capabilities(&self) -> Vec<LyraSoftwareCapability> {
        self.adapters
            .read()
            .map(|adapters| {
                adapters
                    .iter()
                    .flat_map(|adapter| adapter.capabilities())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn surfaces(&self) -> Vec<SoftwareCapabilitySurface> {
        self.adapters
            .read()
            .map(|adapters| adapters.iter().map(|adapter| adapter.surface()).collect())
            .unwrap_or_default()
    }

    pub fn minimal_surfaces(&self, max_adapters: usize) -> Vec<SoftwareCapabilitySurface> {
        self.adapters
            .read()
            .map(|adapters| {
                adapters
                    .iter()
                    .take(max_adapters)
                    .map(|adapter| {
                        let surface = adapter.surface();
                        SoftwareCapabilitySurface {
                            readable_state: Vec::new(),
                            commands: surface.commands,
                            events: surface.events,
                            permissions: surface.permissions,
                            ui_affordances: surface.ui_affordances,
                            lightweight_summary: surface.lightweight_summary,
                        }
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub async fn execute(
        &self,
        capability: &AgentToolCapabilityRef,
        input: Value,
    ) -> AgentToolResult {
        let adapter = self.adapters.read().ok().and_then(|adapters| {
            adapters
                .iter()
                .find(|adapter| adapter.id() == capability.provider_id)
                .cloned()
        });
        match adapter {
            Some(adapter) => {
                let event = adapter
                    .invoke(LyraSoftwareCommand {
                        software: LyraSoftwareRef {
                            id: capability.provider_id.clone(),
                            label: capability.provider_id.clone(),
                        },
                        command: capability.tool_name.clone(),
                        payload: Some(input),
                    })
                    .await;
                AgentToolResult {
                    tool_call_id: capability
                        .capability_id
                        .clone()
                        .unwrap_or_else(|| capability.tool_name.clone()),
                    status: AgentToolStatus::Completed,
                    output: Some(json!(event)),
                    error: None,
                }
            }
            None => failed_tool_result(
                capability
                    .capability_id
                    .clone()
                    .unwrap_or_else(|| capability.tool_name.clone()),
                LyraAgentErrorCode::CapabilityUnavailable,
                format!(
                    "Lyra software adapter is not registered: {}",
                    capability.provider_id
                ),
                Recoverability::UserActionRequired,
            ),
        }
    }
}

#[derive(Clone, Default)]
pub struct MemoryAdapterRegistry {
    stores: Arc<RwLock<Vec<Arc<dyn MemoryStore>>>>,
    projection_builders: Arc<RwLock<Vec<Arc<dyn MemoryProjectionBuilder>>>>,
}

impl MemoryAdapterRegistry {
    pub fn register_store(&self, store: Arc<dyn MemoryStore>) {
        if let Ok(mut stores) = self.stores.write() {
            stores.push(store);
        }
    }

    pub fn register_projection_builder(&self, builder: Arc<dyn MemoryProjectionBuilder>) {
        if let Ok(mut builders) = self.projection_builders.write() {
            builders.push(builder);
        }
    }

    pub fn store_count(&self) -> usize {
        self.stores.read().map(|stores| stores.len()).unwrap_or(0)
    }

    pub fn projection_builder_count(&self) -> usize {
        self.projection_builders
            .read()
            .map(|builders| builders.len())
            .unwrap_or(0)
    }
}

#[derive(Clone, Default)]
pub struct BrowserOperatorRegistry {
    operators: Arc<RwLock<Vec<Arc<dyn BrowserOperator>>>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BrowserOperatorCapability {
    pub implicit: bool,
    pub follow_visible: bool,
    pub non_interfering_input: bool,
    pub selector_map: bool,
    pub focus_scan: bool,
    pub weak_dom: bool,
    pub visual_fallback: bool,
    pub wait_read_until: bool,
}

impl BrowserOperatorRegistry {
    pub fn register(&self, operator: Arc<dyn BrowserOperator>) {
        if let Ok(mut operators) = self.operators.write() {
            operators.push(operator);
        }
    }

    pub fn operator_count(&self) -> usize {
        self.operators
            .read()
            .map(|operators| operators.len())
            .unwrap_or(0)
    }

    pub fn capability(&self) -> BrowserOperatorCapability {
        BrowserOperatorCapability {
            implicit: true,
            follow_visible: true,
            non_interfering_input: true,
            selector_map: true,
            focus_scan: true,
            weak_dom: true,
            visual_fallback: true,
            wait_read_until: true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum McpServerConnectionState {
    Disconnected,
    Connected,
    Failed,
}

#[derive(Clone, Debug, PartialEq)]
pub struct McpServerManifest {
    pub server_id: String,
    pub label: String,
    pub command: Option<String>,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct McpServerStatus {
    pub manifest: McpServerManifest,
    pub state: McpServerConnectionState,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct McpToolManifest {
    pub server_id: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
    pub risk_level: String,
    pub permission_policy: String,
}

#[async_trait]
pub trait McpToolExecutor: Send + Sync {
    async fn execute(
        &self,
        server_id: &str,
        tool_name: &str,
        input: Value,
    ) -> Result<Value, LyraAgentError>;
}

#[derive(Clone)]
struct McpServerRecord {
    status: McpServerStatus,
    tools: Vec<McpToolManifest>,
    executor: Arc<dyn McpToolExecutor>,
}

#[derive(Clone, Default)]
pub struct McpToolProvider {
    servers: Arc<RwLock<BTreeMap<String, McpServerRecord>>>,
}

impl McpToolProvider {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_server(
        &self,
        manifest: McpServerManifest,
        tools: Vec<McpToolManifest>,
        executor: Arc<dyn McpToolExecutor>,
    ) {
        let record = McpServerRecord {
            status: McpServerStatus {
                manifest: manifest.clone(),
                state: McpServerConnectionState::Disconnected,
                last_error: None,
            },
            tools,
            executor,
        };
        if let Ok(mut servers) = self.servers.write() {
            servers.insert(manifest.server_id.clone(), record);
        }
    }

    pub fn list_servers(&self) -> Vec<McpServerStatus> {
        self.servers
            .read()
            .map(|servers| {
                servers
                    .values()
                    .map(|record| record.status.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn connect(&self, server_id: &str) -> Result<McpServerStatus, LyraAgentError> {
        self.set_server_state(server_id, McpServerConnectionState::Connected, None)
    }

    pub fn disconnect(&self, server_id: &str) -> Result<McpServerStatus, LyraAgentError> {
        self.set_server_state(server_id, McpServerConnectionState::Disconnected, None)
    }

    pub fn reload(&self, server_id: &str) -> Result<McpServerStatus, LyraAgentError> {
        self.set_server_state(server_id, McpServerConnectionState::Connected, None)
    }

    fn set_server_state(
        &self,
        server_id: &str,
        state: McpServerConnectionState,
        last_error: Option<String>,
    ) -> Result<McpServerStatus, LyraAgentError> {
        let mut servers = self.servers.write().map_err(|_| {
            lyra_error(
                LyraAgentErrorCode::InternalError,
                "MCP registry lock failed",
                Recoverability::Retryable,
            )
        })?;
        let record = servers.get_mut(server_id).ok_or_else(|| {
            lyra_error(
                LyraAgentErrorCode::CapabilityUnavailable,
                format!("MCP server is not registered: {server_id}"),
                Recoverability::UserActionRequired,
            )
        })?;
        record.status.state = state;
        record.status.last_error = last_error;
        Ok(record.status.clone())
    }

    pub fn discover(&self, request: &ToolExposureRequest) -> ToolDiscoveryPage {
        let page_size = normalized_page_size(request.page_size);
        let page = request.page;
        let mut tools = self
            .servers
            .read()
            .map(|servers| {
                servers
                    .values()
                    .filter(|record| record.status.state == McpServerConnectionState::Connected)
                    .flat_map(|record| record.tools.iter())
                    .filter(|tool| {
                        request
                            .server_filter
                            .as_deref()
                            .is_none_or(|server| server == tool.server_id)
                    })
                    .filter(|tool| {
                        request
                            .risk_filter
                            .as_deref()
                            .is_none_or(|risk| risk == tool.risk_level)
                    })
                    .filter(|tool| {
                        request.task_text.as_deref().is_none_or(|task| {
                            task.trim().is_empty()
                                || contains_ci(&tool.name, task)
                                || contains_ci(&tool.description, task)
                        })
                    })
                    .map(|tool| ToolManifest {
                        provider_id: self.id().to_string(),
                        server_id: Some(tool.server_id.clone()),
                        name: tool.name.clone(),
                        description: tool.description.clone(),
                        risk_level: tool.risk_level.clone(),
                        permission_policy: tool.permission_policy.clone(),
                        schema_ref: Some(format!("mcp://{}/tools/{}", tool.server_id, tool.name)),
                        required_host_capability: Some("mcp.execute".to_string()),
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        tools.sort_by(|left, right| {
            left.server_id
                .cmp(&right.server_id)
                .then_with(|| left.name.cmp(&right.name))
        });
        paginate_tools(tools, page, page_size)
    }

    pub fn inspect_mcp_tool(&self, server_id: &str, tool_name: &str) -> Option<ToolCapability> {
        self.servers.read().ok().and_then(|servers| {
            servers.get(server_id).and_then(|record| {
                record
                    .tools
                    .iter()
                    .find(|tool| tool.name == tool_name)
                    .map(|tool| ToolCapability {
                        reference: AgentToolCapabilityRef {
                            provider_id: self.id().to_string(),
                            tool_name: "mcp_tool_execute".to_string(),
                            capability_id: Some(format!("{}:{}", tool.server_id, tool.name)),
                        },
                        description: tool.description.clone(),
                        schema: tool.input_schema.clone(),
                        risk_level: tool.risk_level.clone(),
                        permission_policy: tool.permission_policy.clone(),
                        ui_renderer_hint: Some("mcp".to_string()),
                        required_host_capability: Some("mcp.execute".to_string()),
                        exposure_mode: ToolExposureMode::InspectRequired,
                    })
            })
        })
    }

    async fn execute_mcp_tool(
        &self,
        server_id: &str,
        tool_name: &str,
        input: Value,
        tool_call_id: String,
    ) -> AgentToolResult {
        let record = self.servers.read().ok().and_then(|servers| {
            servers
                .get(server_id)
                .map(|record| (record.status.clone(), record.executor.clone()))
        });
        let Some((status, executor)) = record else {
            return failed_tool_result(
                tool_call_id,
                LyraAgentErrorCode::CapabilityUnavailable,
                format!("MCP server is not registered: {server_id}"),
                Recoverability::UserActionRequired,
            );
        };
        if status.state != McpServerConnectionState::Connected {
            return failed_tool_result(
                tool_call_id,
                LyraAgentErrorCode::CapabilityUnavailable,
                format!("MCP server is not connected: {server_id}"),
                Recoverability::UserActionRequired,
            );
        }

        match executor.execute(server_id, tool_name, input).await {
            Ok(output) => completed_tool_result(tool_call_id, output),
            Err(error) => AgentToolResult {
                tool_call_id,
                status: AgentToolStatus::Failed,
                output: None,
                error: Some(error),
            },
        }
    }
}

#[async_trait]
impl ToolProvider for McpToolProvider {
    fn id(&self) -> &str {
        "lyra-mcp"
    }

    fn capabilities(&self) -> Vec<ToolCapability> {
        vec![
            provider_capability(
                self.id(),
                "mcp_server_list",
                "List configured Lyra MCP servers and connection status.",
                json!({ "type": "object", "properties": {} }),
                "state",
                "runtimePolicy",
                ToolExposureMode::Always,
            ),
            provider_capability(
                self.id(),
                "mcp_server_connect",
                "Connect a configured Lyra MCP server.",
                json!({
                    "type": "object",
                    "properties": { "serverId": { "type": "string" } },
                    "required": ["serverId"]
                }),
                "network",
                "runtimePolicy",
                ToolExposureMode::Discoverable,
            ),
            provider_capability(
                self.id(),
                "mcp_server_disconnect",
                "Disconnect a Lyra MCP server.",
                json!({
                    "type": "object",
                    "properties": { "serverId": { "type": "string" } },
                    "required": ["serverId"]
                }),
                "state",
                "runtimePolicy",
                ToolExposureMode::Discoverable,
            ),
            provider_capability(
                self.id(),
                "mcp_server_reload",
                "Reload a Lyra MCP server and refresh its tool manifest.",
                json!({
                    "type": "object",
                    "properties": { "serverId": { "type": "string" } },
                    "required": ["serverId"]
                }),
                "state",
                "runtimePolicy",
                ToolExposureMode::Discoverable,
            ),
            provider_capability(
                self.id(),
                "mcp_tool_discover",
                "Search MCP tools by lightweight manifest without exposing full schemas.",
                discovery_schema(),
                "state",
                "runtimePolicy",
                ToolExposureMode::Always,
            ),
            provider_capability(
                self.id(),
                "mcp_tool_inspect",
                "Inspect one MCP tool schema on demand.",
                json!({
                    "type": "object",
                    "properties": {
                        "serverId": { "type": "string" },
                        "toolName": { "type": "string" }
                    },
                    "required": ["serverId", "toolName"]
                }),
                "state",
                "runtimePolicy",
                ToolExposureMode::Always,
            ),
            provider_capability(
                self.id(),
                "mcp_tool_execute",
                "Execute one inspected MCP tool.",
                json!({
                    "type": "object",
                    "properties": {
                        "serverId": { "type": "string" },
                        "toolName": { "type": "string" },
                        "input": { "type": "object" }
                    },
                    "required": ["serverId", "toolName"]
                }),
                "hostCapability",
                "runtimePolicy",
                ToolExposureMode::Always,
            ),
        ]
    }

    async fn execute(&self, capability: &AgentToolCapabilityRef, input: Value) -> AgentToolResult {
        let tool_call_id = capability
            .capability_id
            .clone()
            .unwrap_or_else(|| capability.tool_name.clone());
        match capability.tool_name.as_str() {
            "mcp_server_list" => completed_tool_result(
                tool_call_id,
                json!({ "servers": self.list_servers().into_iter().map(mcp_status_json).collect::<Vec<_>>() }),
            ),
            "mcp_server_connect" => server_id_from_input(&input)
                .and_then(|server_id| self.connect(&server_id))
                .map(|status| completed_tool_result(tool_call_id.clone(), mcp_status_json(status)))
                .unwrap_or_else(|error| error_tool_result(tool_call_id, error)),
            "mcp_server_disconnect" => server_id_from_input(&input)
                .and_then(|server_id| self.disconnect(&server_id))
                .map(|status| completed_tool_result(tool_call_id.clone(), mcp_status_json(status)))
                .unwrap_or_else(|error| error_tool_result(tool_call_id, error)),
            "mcp_server_reload" => server_id_from_input(&input)
                .and_then(|server_id| self.reload(&server_id))
                .map(|status| completed_tool_result(tool_call_id.clone(), mcp_status_json(status)))
                .unwrap_or_else(|error| error_tool_result(tool_call_id, error)),
            "mcp_tool_discover" => {
                let request = exposure_request_from_input(input);
                let page = self.discover(&request);
                completed_tool_result(tool_call_id, discovery_page_json(page))
            }
            "mcp_tool_inspect" => {
                let server_id = string_field(&input, "serverId");
                let tool_name = string_field(&input, "toolName");
                match (server_id, tool_name) {
                    (Some(server_id), Some(tool_name)) => self
                        .inspect_mcp_tool(&server_id, &tool_name)
                        .map(tool_capability_json)
                        .map(|tool| completed_tool_result(tool_call_id.clone(), tool))
                        .unwrap_or_else(|| {
                            failed_tool_result(
                                tool_call_id,
                                LyraAgentErrorCode::CapabilityUnavailable,
                                format!("MCP tool is not registered: {server_id}/{tool_name}"),
                                Recoverability::UserActionRequired,
                            )
                        }),
                    _ => failed_tool_result(
                        tool_call_id,
                        LyraAgentErrorCode::BadRequest,
                        "serverId and toolName are required",
                        Recoverability::UserActionRequired,
                    ),
                }
            }
            "mcp_tool_execute" => {
                let server_id = string_field(&input, "serverId");
                let tool_name = string_field(&input, "toolName");
                let payload = input.get("input").cloned().unwrap_or_else(|| json!({}));
                match (server_id, tool_name) {
                    (Some(server_id), Some(tool_name)) => {
                        self.execute_mcp_tool(&server_id, &tool_name, payload, tool_call_id)
                            .await
                    }
                    _ => failed_tool_result(
                        tool_call_id,
                        LyraAgentErrorCode::BadRequest,
                        "serverId and toolName are required",
                        Recoverability::UserActionRequired,
                    ),
                }
            }
            _ => failed_tool_result(
                tool_call_id,
                LyraAgentErrorCode::CapabilityUnavailable,
                format!("Unknown Lyra MCP tool: {}", capability.tool_name),
                Recoverability::UserActionRequired,
            ),
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct LyraSkillManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub prompt: String,
    pub permissions: Vec<String>,
    pub tool_capabilities: Vec<AgentToolCapabilityRef>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct LyraSkillState {
    pub manifest: LyraSkillManifest,
    pub active: bool,
}

#[derive(Clone, Debug, Default)]
pub struct SkillRegistry {
    skills: Arc<RwLock<BTreeMap<String, LyraSkillManifest>>>,
    active: Arc<RwLock<BTreeSet<String>>>,
}

impl SkillRegistry {
    pub fn with_builtin_skills() -> Self {
        let registry = Self::default();
        registry.register(LyraSkillManifest {
            id: "lyra-design-research".to_string(),
            name: "Lyra Design Research".to_string(),
            version: "1.0.0".to_string(),
            description:
                "Use Lyra design reference tools before creating or changing UI screens."
                    .to_string(),
            prompt: "For design or UI work, call Lyra design reference tools first, then include a concise Design Research Summary before proposing or editing UI.".to_string(),
            permissions: vec!["design.reference.read".to_string()],
            tool_capabilities: vec![
                AgentToolCapabilityRef {
                    provider_id: "lyra-design".to_string(),
                    tool_name: "lyra_design_search_styles".to_string(),
                    capability_id: None,
                },
                AgentToolCapabilityRef {
                    provider_id: "lyra-design".to_string(),
                    tool_name: "lyra_design_get_style_details".to_string(),
                    capability_id: None,
                },
            ],
        });
        registry
    }

    pub fn register(&self, manifest: LyraSkillManifest) {
        if let Ok(mut skills) = self.skills.write() {
            skills.insert(manifest.id.clone(), manifest);
        }
    }

    pub fn list(&self) -> Vec<LyraSkillState> {
        let active = self
            .active
            .read()
            .map(|active| active.clone())
            .unwrap_or_default();
        self.skills
            .read()
            .map(|skills| {
                skills
                    .values()
                    .map(|manifest| LyraSkillState {
                        manifest: manifest.clone(),
                        active: active.contains(&manifest.id),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn inspect(&self, skill_id: &str) -> Option<LyraSkillState> {
        let active = self
            .active
            .read()
            .map(|active| active.clone())
            .unwrap_or_default();
        self.skills.read().ok().and_then(|skills| {
            skills.get(skill_id).map(|manifest| LyraSkillState {
                manifest: manifest.clone(),
                active: active.contains(skill_id),
            })
        })
    }

    pub fn activate(&self, skill_id: &str) -> Result<LyraSkillState, LyraAgentError> {
        if self.inspect(skill_id).is_none() {
            return Err(lyra_error(
                LyraAgentErrorCode::CapabilityUnavailable,
                format!("Lyra skill is not registered: {skill_id}"),
                Recoverability::UserActionRequired,
            ));
        }
        if let Ok(mut active) = self.active.write() {
            active.insert(skill_id.to_string());
        }
        self.inspect(skill_id).ok_or_else(|| {
            lyra_error(
                LyraAgentErrorCode::InternalError,
                "Lyra skill activation state could not be read",
                Recoverability::Retryable,
            )
        })
    }

    pub fn deactivate(&self, skill_id: &str) -> Result<LyraSkillState, LyraAgentError> {
        if self.inspect(skill_id).is_none() {
            return Err(lyra_error(
                LyraAgentErrorCode::CapabilityUnavailable,
                format!("Lyra skill is not registered: {skill_id}"),
                Recoverability::UserActionRequired,
            ));
        }
        if let Ok(mut active) = self.active.write() {
            active.remove(skill_id);
        }
        self.inspect(skill_id).ok_or_else(|| {
            lyra_error(
                LyraAgentErrorCode::InternalError,
                "Lyra skill activation state could not be read",
                Recoverability::Retryable,
            )
        })
    }

    pub fn active_prompt(&self) -> String {
        self.list()
            .into_iter()
            .filter(|skill| skill.active)
            .map(|skill| {
                format!(
                    "Skill {}: {}",
                    skill.manifest.id,
                    skill.manifest.prompt.trim()
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    pub fn active_permissions(&self) -> Vec<String> {
        let mut permissions = BTreeSet::new();
        for skill in self.list().into_iter().filter(|skill| skill.active) {
            permissions.extend(skill.manifest.permissions);
        }
        permissions.into_iter().collect()
    }
}

#[derive(Clone)]
pub struct SkillToolProvider {
    registry: SkillRegistry,
}

impl SkillToolProvider {
    pub fn new(registry: SkillRegistry) -> Self {
        Self { registry }
    }

    pub fn registry(&self) -> SkillRegistry {
        self.registry.clone()
    }
}

#[async_trait]
impl ToolProvider for SkillToolProvider {
    fn id(&self) -> &str {
        "lyra-skills"
    }

    fn capabilities(&self) -> Vec<ToolCapability> {
        vec![
            provider_capability(
                self.id(),
                "skill_list",
                "List installed Lyra skills and active state.",
                json!({ "type": "object", "properties": {} }),
                "state",
                "runtimePolicy",
                ToolExposureMode::Always,
            ),
            provider_capability(
                self.id(),
                "skill_inspect",
                "Inspect one Lyra skill manifest and prompt.",
                json!({
                    "type": "object",
                    "properties": { "skillId": { "type": "string" } },
                    "required": ["skillId"]
                }),
                "state",
                "runtimePolicy",
                ToolExposureMode::Always,
            ),
            provider_capability(
                self.id(),
                "skill_activate",
                "Activate one Lyra skill for following turns.",
                json!({
                    "type": "object",
                    "properties": { "skillId": { "type": "string" } },
                    "required": ["skillId"]
                }),
                "state",
                "runtimePolicy",
                ToolExposureMode::Always,
            ),
            provider_capability(
                self.id(),
                "skill_deactivate",
                "Deactivate one Lyra skill.",
                json!({
                    "type": "object",
                    "properties": { "skillId": { "type": "string" } },
                    "required": ["skillId"]
                }),
                "state",
                "runtimePolicy",
                ToolExposureMode::Always,
            ),
        ]
    }

    async fn execute(&self, capability: &AgentToolCapabilityRef, input: Value) -> AgentToolResult {
        let tool_call_id = capability
            .capability_id
            .clone()
            .unwrap_or_else(|| capability.tool_name.clone());
        match capability.tool_name.as_str() {
            "skill_list" => completed_tool_result(
                tool_call_id,
                json!({ "skills": self.registry.list().into_iter().map(skill_state_json).collect::<Vec<_>>() }),
            ),
            "skill_inspect" => match string_field(&input, "skillId") {
                Some(skill_id) => self
                    .registry
                    .inspect(&skill_id)
                    .map(skill_state_json)
                    .map(|skill| completed_tool_result(tool_call_id.clone(), skill))
                    .unwrap_or_else(|| {
                        failed_tool_result(
                            tool_call_id,
                            LyraAgentErrorCode::CapabilityUnavailable,
                            format!("Lyra skill is not registered: {skill_id}"),
                            Recoverability::UserActionRequired,
                        )
                    }),
                None => failed_tool_result(
                    tool_call_id,
                    LyraAgentErrorCode::BadRequest,
                    "skillId is required",
                    Recoverability::UserActionRequired,
                ),
            },
            "skill_activate" => match string_field(&input, "skillId") {
                Some(skill_id) => self
                    .registry
                    .activate(&skill_id)
                    .map(skill_state_json)
                    .map(|skill| completed_tool_result(tool_call_id.clone(), skill))
                    .unwrap_or_else(|error| error_tool_result(tool_call_id, error)),
                None => failed_tool_result(
                    tool_call_id,
                    LyraAgentErrorCode::BadRequest,
                    "skillId is required",
                    Recoverability::UserActionRequired,
                ),
            },
            "skill_deactivate" => match string_field(&input, "skillId") {
                Some(skill_id) => self
                    .registry
                    .deactivate(&skill_id)
                    .map(skill_state_json)
                    .map(|skill| completed_tool_result(tool_call_id.clone(), skill))
                    .unwrap_or_else(|error| error_tool_result(tool_call_id, error)),
                None => failed_tool_result(
                    tool_call_id,
                    LyraAgentErrorCode::BadRequest,
                    "skillId is required",
                    Recoverability::UserActionRequired,
                ),
            },
            _ => failed_tool_result(
                tool_call_id,
                LyraAgentErrorCode::CapabilityUnavailable,
                format!("Unknown Lyra skill tool: {}", capability.tool_name),
                Recoverability::UserActionRequired,
            ),
        }
    }
}

fn normalized_page_size(page_size: usize) -> usize {
    match page_size {
        0 => 20,
        1..=100 => page_size,
        _ => 100,
    }
}

fn paginate_tools(tools: Vec<ToolManifest>, page: usize, page_size: usize) -> ToolDiscoveryPage {
    let total = tools.len();
    let start = page.saturating_mul(page_size);
    let end = (start + page_size).min(total);
    let paged_tools = if start >= total {
        Vec::new()
    } else {
        tools[start..end].to_vec()
    };
    ToolDiscoveryPage {
        tools: paged_tools,
        total,
        page,
        page_size,
        has_more: end < total,
    }
}

fn exposure_request_from_input(input: Value) -> ToolExposureRequest {
    ToolExposureRequest {
        task_text: string_field(&input, "query").or_else(|| string_field(&input, "taskText")),
        workspace_focus: string_field(&input, "workspaceFocus"),
        software_focus: string_field(&input, "softwareFocus"),
        provider_filter: string_field(&input, "providerId"),
        server_filter: string_field(&input, "serverId"),
        risk_filter: string_field(&input, "riskLevel"),
        page: input.get("page").and_then(Value::as_u64).unwrap_or(0) as usize,
        page_size: input.get("pageSize").and_then(Value::as_u64).unwrap_or(20) as usize,
        include_design_tools: input
            .get("includeDesignTools")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

fn provider_capability(
    provider_id: &str,
    tool_name: &str,
    description: &str,
    schema: Value,
    risk_level: &str,
    permission_policy: &str,
    exposure_mode: ToolExposureMode,
) -> ToolCapability {
    ToolCapability {
        reference: AgentToolCapabilityRef {
            provider_id: provider_id.to_string(),
            tool_name: tool_name.to_string(),
            capability_id: None,
        },
        description: description.to_string(),
        schema,
        risk_level: risk_level.to_string(),
        permission_policy: permission_policy.to_string(),
        ui_renderer_hint: None,
        required_host_capability: None,
        exposure_mode,
    }
}

fn discovery_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "query": { "type": "string" },
            "providerId": { "type": "string" },
            "serverId": { "type": "string" },
            "riskLevel": { "type": "string" },
            "page": { "type": "number" },
            "pageSize": { "type": "number" }
        }
    })
}

fn completed_tool_result(tool_call_id: String, output: Value) -> AgentToolResult {
    AgentToolResult {
        tool_call_id,
        status: AgentToolStatus::Completed,
        output: Some(output),
        error: None,
    }
}

fn error_tool_result(tool_call_id: String, error: LyraAgentError) -> AgentToolResult {
    AgentToolResult {
        tool_call_id,
        status: AgentToolStatus::Failed,
        output: None,
        error: Some(error),
    }
}

fn failed_tool_result(
    tool_call_id: String,
    code: LyraAgentErrorCode,
    message: impl Into<String>,
    recoverability: Recoverability,
) -> AgentToolResult {
    error_tool_result(
        tool_call_id,
        lyra_error(code, message.into(), recoverability),
    )
}

fn lyra_error(
    code: LyraAgentErrorCode,
    message: impl Into<String>,
    recoverability: Recoverability,
) -> LyraAgentError {
    LyraAgentError {
        code,
        message: message.into(),
        recoverability,
        severity: UserVisibleSeverity::Warning,
        detail: None,
    }
}

fn contains_ci(value: &str, needle: &str) -> bool {
    value.to_lowercase().contains(&needle.to_lowercase())
}

fn server_id_from_input(input: &Value) -> Result<String, LyraAgentError> {
    string_field(input, "serverId").ok_or_else(|| {
        lyra_error(
            LyraAgentErrorCode::BadRequest,
            "serverId is required",
            Recoverability::UserActionRequired,
        )
    })
}

fn string_field(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn mcp_status_json(status: McpServerStatus) -> Value {
    json!({
        "serverId": status.manifest.server_id,
        "label": status.manifest.label,
        "command": status.manifest.command,
        "description": status.manifest.description,
        "state": match status.state {
            McpServerConnectionState::Disconnected => "disconnected",
            McpServerConnectionState::Connected => "connected",
            McpServerConnectionState::Failed => "failed",
        },
        "lastError": status.last_error,
    })
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
        "exposureMode": exposure_mode_json(&capability.exposure_mode),
    })
}

fn discovery_page_json(page: ToolDiscoveryPage) -> Value {
    json!({
        "tools": page.tools.into_iter().map(tool_manifest_json).collect::<Vec<_>>(),
        "total": page.total,
        "page": page.page,
        "pageSize": page.page_size,
        "hasMore": page.has_more,
    })
}

fn tool_manifest_json(tool: ToolManifest) -> Value {
    json!({
        "providerId": tool.provider_id,
        "serverId": tool.server_id,
        "name": tool.name,
        "description": tool.description,
        "riskLevel": tool.risk_level,
        "permissionPolicy": tool.permission_policy,
        "schemaRef": tool.schema_ref,
        "requiredHostCapability": tool.required_host_capability,
    })
}

fn skill_state_json(skill: LyraSkillState) -> Value {
    json!({
        "id": skill.manifest.id,
        "name": skill.manifest.name,
        "version": skill.manifest.version,
        "description": skill.manifest.description,
        "prompt": skill.manifest.prompt,
        "permissions": skill.manifest.permissions,
        "toolCapabilities": skill.manifest.tool_capabilities,
        "active": skill.active,
    })
}

fn exposure_mode_json(mode: &ToolExposureMode) -> &'static str {
    match mode {
        ToolExposureMode::Always => "always",
        ToolExposureMode::Discoverable => "discoverable",
        ToolExposureMode::InspectRequired => "inspectRequired",
        ToolExposureMode::Hidden => "hidden",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestProvider;

    #[async_trait]
    impl ProviderAdapter for TestProvider {
        fn id(&self) -> &str {
            "test"
        }

        fn label(&self) -> &str {
            "Test Provider"
        }

        fn capabilities(&self) -> ProviderCapabilities {
            ProviderCapabilities {
                text: true,
                image_input: true,
                tool_calling: true,
                streaming: true,
                reasoning_metadata: false,
                structured_output: true,
                context_window: Some(128_000),
            }
        }
    }

    #[test]
    fn provider_capabilities_capture_vision_and_context_window() {
        let caps = ProviderCapabilities {
            text: true,
            image_input: true,
            tool_calling: true,
            streaming: true,
            reasoning_metadata: false,
            structured_output: true,
            context_window: Some(128_000),
        };
        assert!(caps.image_input);
        assert_eq!(caps.context_window, Some(128_000));
    }

    #[test]
    fn provider_registry_projects_structured_capabilities() {
        let registry = ProviderRegistry::default();
        registry.register(Arc::new(TestProvider));
        let providers = registry.list();
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].id, "test");
        assert!(providers[0].capabilities.image_input);
    }

    #[test]
    fn provider_selection_is_structured_not_string_only() {
        let provider = TestProvider;
        let selection = provider.selection("model-a", Some("profile-a"));
        assert_eq!(selection.key.provider_id, "test");
        assert_eq!(selection.key.profile_id.as_deref(), Some("profile-a"));
        assert_eq!(selection.key.model_id, "model-a");
        assert!(selection.capabilities.image_input);
    }

    #[test]
    fn provider_registry_gates_image_input_from_structured_selection() {
        let registry = ProviderRegistry::default();
        registry.register(Arc::new(TestProvider));
        let key = ProviderSelectionKey {
            provider_id: "test".to_string(),
            profile_id: Some("profile-a".to_string()),
            model_id: "model-a".to_string(),
        };
        assert_eq!(
            registry.provider_label(&key).as_deref(),
            Some("Test Provider")
        );
        assert!(registry.can_accept_image_input(&key));
    }

    #[test]
    fn software_surface_declares_minimal_exposure_shape() {
        let surface = SoftwareCapabilitySurface {
            readable_state: vec![serde_json::json!({ "kind": "summary" })],
            commands: Vec::new(),
            events: vec!["changed".to_string()],
            permissions: vec!["read".to_string()],
            ui_affordances: vec!["open".to_string()],
            lightweight_summary: Some(serde_json::json!({ "title": "Test" })),
        };
        assert_eq!(surface.readable_state.len(), 1);
        assert_eq!(surface.events, ["changed"]);
        assert!(surface.lightweight_summary.is_some());
    }

    struct TestSoftware;

    #[async_trait]
    impl SoftwareAdapter for TestSoftware {
        fn id(&self) -> &str {
            "test-software"
        }

        fn capabilities(&self) -> Vec<LyraSoftwareCapability> {
            vec![LyraSoftwareCapability {
                software: lyra_agent_api::LyraSoftwareRef {
                    id: "test-software".to_string(),
                    label: "Test Software".to_string(),
                },
                name: "open".to_string(),
                description: Some("Open a surface".to_string()),
                schema: Some(serde_json::json!({ "type": "object" })),
            }]
        }

        fn surface(&self) -> SoftwareCapabilitySurface {
            SoftwareCapabilitySurface {
                readable_state: vec![serde_json::json!({ "expensive": true })],
                commands: self.capabilities(),
                events: vec!["changed".to_string()],
                permissions: vec!["software.open".to_string()],
                ui_affordances: vec!["open".to_string()],
                lightweight_summary: Some(serde_json::json!({ "title": "Test Software" })),
            }
        }

        async fn invoke(&self, command: LyraSoftwareCommand) -> LyraSoftwareEvent {
            LyraSoftwareEvent {
                software: command.software,
                event: "invoked".to_string(),
                payload: command.payload,
            }
        }
    }

    #[test]
    fn software_registry_exposes_only_minimal_surfaces_to_model() {
        let registry = SoftwareAdapterRegistry::default();
        registry.register(Arc::new(TestSoftware));
        let surfaces = registry.minimal_surfaces(8);
        assert_eq!(surfaces.len(), 1);
        assert!(surfaces[0].readable_state.is_empty());
        assert_eq!(surfaces[0].commands.len(), 1);
        assert_eq!(surfaces[0].permissions, ["software.open"]);
        assert!(surfaces[0].lightweight_summary.is_some());
    }

    #[test]
    fn browser_request_separates_implicit_and_visible_follow_modes() {
        let request = BrowserOperationRequest {
            mode: BrowserOperationMode::FollowVisible,
            command: serde_json::json!({ "type": "click" }),
            selector_map: vec![serde_json::json!({ "id": "submit" })],
            focus_scan: true,
            allow_weak_dom: true,
            allow_visual_fallback: true,
            wait: Some(BrowserWaitStrategy {
                selector: Some("#done".to_string()),
                read_until: Some("loaded".to_string()),
                timeout_ms: 5_000,
            }),
        };
        assert_eq!(request.mode, BrowserOperationMode::FollowVisible);
        assert!(request.wait.is_some());
        assert!(request.allow_visual_fallback);
    }

    #[test]
    fn browser_registry_declares_non_interfering_follow_capabilities() {
        let registry = BrowserOperatorRegistry::default();
        let capability = registry.capability();
        assert!(capability.implicit);
        assert!(capability.follow_visible);
        assert!(capability.non_interfering_input);
        assert!(capability.selector_map);
        assert!(capability.focus_scan);
        assert!(capability.weak_dom);
        assert!(capability.visual_fallback);
        assert!(capability.wait_read_until);
    }

    struct MockMcpExecutor;

    #[async_trait]
    impl McpToolExecutor for MockMcpExecutor {
        async fn execute(
            &self,
            server_id: &str,
            tool_name: &str,
            input: Value,
        ) -> Result<Value, LyraAgentError> {
            Ok(serde_json::json!({
                "serverId": server_id,
                "toolName": tool_name,
                "input": input,
                "ok": true,
            }))
        }
    }

    fn mock_mcp_provider(tool_count: usize) -> McpToolProvider {
        let provider = McpToolProvider::default();
        let tools = (0..tool_count)
            .map(|index| McpToolManifest {
                server_id: "mock".to_string(),
                name: format!("mock_tool_{index}"),
                description: format!("Mock MCP tool {index}"),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "value": { "type": "string" }
                    }
                }),
                risk_level: "read".to_string(),
                permission_policy: "runtimePolicy".to_string(),
            })
            .collect::<Vec<_>>();
        provider.register_server(
            McpServerManifest {
                server_id: "mock".to_string(),
                label: "Mock MCP".to_string(),
                command: Some("mock-mcp".to_string()),
                description: None,
            },
            tools,
            Arc::new(MockMcpExecutor),
        );
        provider.connect("mock").expect("connect mock server");
        provider
    }

    #[test]
    fn mcp_provider_discovers_inspects_and_executes_mock_tool() {
        let provider = mock_mcp_provider(3);
        let page = provider.discover(&ToolExposureRequest {
            task_text: Some("mock_tool_1".to_string()),
            ..ToolExposureRequest::default()
        });
        assert_eq!(page.total, 1);
        assert_eq!(page.tools[0].name, "mock_tool_1");

        let inspected = provider
            .inspect_mcp_tool("mock", "mock_tool_1")
            .expect("inspect tool");
        assert_eq!(inspected.schema["type"], "object");
        assert_eq!(inspected.exposure_mode, ToolExposureMode::InspectRequired);

        let result = futures::executor::block_on(provider.execute(
            &AgentToolCapabilityRef {
                provider_id: "lyra-mcp".to_string(),
                tool_name: "mcp_tool_execute".to_string(),
                capability_id: Some("call-1".to_string()),
            },
            serde_json::json!({
                "serverId": "mock",
                "toolName": "mock_tool_1",
                "input": { "value": "hello" }
            }),
        ));
        assert_eq!(result.status, AgentToolStatus::Completed);
        assert_eq!(result.output.unwrap()["toolName"], "mock_tool_1");
    }

    #[test]
    fn exposure_policy_keeps_large_dynamic_tool_sets_bounded() {
        let policy = ToolExposurePolicy {
            max_always_visible_dynamic_tools: 4,
        };
        let capabilities = (0..100)
            .map(|index| ToolCapability {
                reference: AgentToolCapabilityRef {
                    provider_id: "dynamic".to_string(),
                    tool_name: format!("dynamic_tool_{index}"),
                    capability_id: None,
                },
                description: "Dynamic tool".to_string(),
                schema: serde_json::json!({ "type": "object" }),
                risk_level: "read".to_string(),
                permission_policy: "runtimePolicy".to_string(),
                ui_renderer_hint: None,
                required_host_capability: None,
                exposure_mode: ToolExposureMode::Discoverable,
            })
            .chain(std::iter::once(ToolCapability {
                reference: AgentToolCapabilityRef {
                    provider_id: "lyra-tooling".to_string(),
                    tool_name: "tool_discover".to_string(),
                    capability_id: None,
                },
                description: "Discover tools".to_string(),
                schema: serde_json::json!({ "type": "object" }),
                risk_level: "state".to_string(),
                permission_policy: "runtimePolicy".to_string(),
                ui_renderer_hint: None,
                required_host_capability: None,
                exposure_mode: ToolExposureMode::Always,
            }))
            .collect::<Vec<_>>();

        let selected = policy.select_model_tools(capabilities, &ToolExposureRequest::default());
        assert_eq!(selected.len(), 5);
        assert!(selected.iter().any(|tool| tool.name == "tool_discover"));
    }

    #[test]
    fn skill_registry_activation_changes_active_prompt_and_permissions() {
        let registry = SkillRegistry::default();
        registry.register(LyraSkillManifest {
            id: "test-skill".to_string(),
            name: "Test Skill".to_string(),
            version: "0.1.0".to_string(),
            description: "Test".to_string(),
            prompt: "Always run the test skill instructions.".to_string(),
            permissions: vec!["test.read".to_string()],
            tool_capabilities: Vec::new(),
        });

        assert!(registry.active_prompt().is_empty());
        registry.activate("test-skill").expect("activate skill");
        assert!(registry.active_prompt().contains("test-skill"));
        assert_eq!(registry.active_permissions(), ["test.read"]);
        registry.deactivate("test-skill").expect("deactivate skill");
        assert!(registry.active_prompt().is_empty());
    }
}
