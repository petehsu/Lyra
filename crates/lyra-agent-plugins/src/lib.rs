use std::sync::{Arc, RwLock};

use async_trait::async_trait;
use lyra_agent_api::{
    AgentMemoryProjection, AgentToolActivity, AgentToolCapabilityRef, AgentToolResult,
    LyraSoftwareCapability, LyraSoftwareCommand, LyraSoftwareEvent,
};
use serde_json::Value;

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
}

#[async_trait]
pub trait ToolProvider: Send + Sync {
    fn id(&self) -> &str;
    fn capabilities(&self) -> Vec<ToolCapability>;
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
}
