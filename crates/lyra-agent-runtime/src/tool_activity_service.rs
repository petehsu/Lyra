use std::sync::Arc;

use async_trait::async_trait;
use lyra_agent_api::{AgentToolCapabilityRef, AgentToolResult, AgentToolStatus};
use lyra_agent_plugins::{
    McpToolProvider, SkillRegistry, SkillToolProvider, ToolCapability, ToolExposureMode,
    ToolProvider, ToolProviderRegistry,
};
use serde_json::{Value, json};

#[derive(Clone)]
pub struct ToolActivityService {
    registry: ToolProviderRegistry,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ModelToolExposureMode {
    Direct,
    Discoverable,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ModelToolDescriptor {
    pub name: String,
    pub description: String,
    pub schema: Value,
    pub risk_level: String,
    pub permission_policy: String,
    pub capability_ref: AgentToolCapabilityRef,
    pub exposure_mode: ModelToolExposureMode,
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
        Self::with_skill_registry(SkillRegistry::with_builtin_skills())
    }
}

impl ToolActivityService {
    pub fn with_skill_registry(skill_registry: SkillRegistry) -> Self {
        let registry = ToolProviderRegistry::default();
        registry.register(Arc::new(BuiltInLyraToolProvider));
        registry.register(Arc::new(McpToolProvider::default()));
        registry.register(Arc::new(SkillToolProvider::new(skill_registry)));
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

    pub fn model_tool_descriptors(&self) -> Vec<ModelToolDescriptor> {
        self.capabilities()
            .into_iter()
            .map(|capability| ModelToolDescriptor {
                name: capability.reference.tool_name.clone(),
                description: capability.description,
                schema: capability.schema,
                risk_level: capability.risk_level,
                permission_policy: capability.permission_policy,
                capability_ref: capability.reference,
                exposure_mode: model_exposure_mode(&capability.exposure_mode),
            })
            .collect()
    }

    pub fn model_tool_names(&self) -> Vec<String> {
        self.model_tool_descriptors()
            .into_iter()
            .map(|descriptor| descriptor.name)
            .collect()
    }

    pub fn model_provider_tools(&self) -> Vec<Value> {
        self.model_tool_descriptors()
            .into_iter()
            .map(model_tool_provider_json)
            .collect()
    }

    pub fn can_dispatch_model_tool(&self, name: &str) -> bool {
        self.model_tool_descriptors()
            .iter()
            .any(|descriptor| descriptor.name == name)
    }

    pub fn capability_ref_for_model_tool(&self, name: &str) -> Option<AgentToolCapabilityRef> {
        self.capabilities()
            .into_iter()
            .find(|capability| capability.reference.tool_name == name)
            .map(|capability| capability.reference)
    }

    pub fn execute_model_tool_blocking(&self, name: &str, input: Value) -> Option<AgentToolResult> {
        let capability = self.capability_ref_for_model_tool(name)?;
        Some(futures::executor::block_on(
            self.registry.execute(&capability, input),
        ))
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

    pub fn cli_capabilities(&self) -> Value {
        json!({
            "tools": self.capabilities().into_iter().map(|capability| {
                let host_unavailable = capability.required_host_capability.is_some();
                let mut value = tool_capability_json(capability);
                value["available"] = Value::Bool(!host_unavailable);
                if host_unavailable {
                    value["unavailableReason"] = Value::String(
                        "Host capability bridge is not available in CLI mode.".to_string(),
                    );
                }
                value
            }).collect::<Vec<_>>()
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
                "lyra-memory",
                "memory_search",
                "Search Lyra long-term shared memory.",
                "read",
                "always",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "scope": { "type": "string" },
                        "category": { "type": "string" },
                        "status": { "type": "string", "enum": ["active", "archived", "superseded", "forgotten"] },
                        "includeRelated": { "type": "boolean", "default": true },
                        "explain": { "type": "boolean", "default": true },
                        "minScore": { "type": "number", "minimum": 0 },
                        "limit": { "type": "integer", "minimum": 1, "maximum": 500 }
                    }
                }),
                None,
            ),
            capability(
                "lyra-memory",
                "memory_remember",
                "Write a durable fact, user preference, name, identity, or project instruction to Lyra long-term memory.",
                "state",
                "runtimePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "scope": { "type": "string", "default": "global" },
                        "fact": { "type": "string" },
                        "category": {
                            "type": "string",
                            "enum": ["user_profile", "preference", "project", "instruction", "goal", "other"],
                            "default": "other"
                        },
                        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                        "sourceType": {
                            "type": "string",
                            "enum": ["user_declaration", "agent_inference", "tool_observation", "project_fact", "goal_sync", "imported"],
                            "default": "agent_inference"
                        },
                        "sourceRef": { "type": "string" },
                        "tags": { "type": "array", "items": { "type": "string" } },
                        "expiresAt": { "type": "string" }
                    },
                    "required": ["fact"]
                }),
                None,
            ),
            capability(
                "lyra-memory",
                "memory_update",
                "Update an existing Lyra long-term memory record by id.",
                "state",
                "runtimePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "fact": { "type": "string" },
                        "content": { "type": "object" },
                        "scope": { "type": "string" },
                        "category": { "type": "string", "enum": ["user_profile", "preference", "project", "instruction", "goal", "other"] },
                        "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
                        "sourceType": { "type": "string", "enum": ["user_declaration", "agent_inference", "tool_observation", "project_fact", "goal_sync", "imported"] },
                        "tags": { "type": "array", "items": { "type": "string" } },
                        "expiresAt": { "type": "string" },
                        "status": { "type": "string", "enum": ["active", "archived", "superseded", "forgotten"] },
                        "supersedes": { "type": "string" },
                        "supersededBy": { "type": "string" }
                    },
                    "required": ["id"]
                }),
                None,
            ),
            capability(
                "lyra-memory",
                "memory_forget",
                "Archive, tombstone, or explicitly hard-delete a Lyra long-term memory record.",
                "state",
                "runtimePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "ids": { "type": "array", "items": { "type": "string" } },
                        "mode": { "type": "string", "enum": ["archive", "tombstone", "hard_delete"], "default": "archive" },
                        "reason": { "type": "string" }
                    }
                }),
                None,
            ),
            capability(
                "lyra-memory",
                "memory_list",
                "List Lyra long-term memory summaries for audit.",
                "read",
                "always",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "scope": { "type": "string" },
                        "category": { "type": "string" },
                        "status": { "type": "string", "enum": ["active", "archived", "superseded", "forgotten"] },
                        "includeArchived": { "type": "boolean", "default": false },
                        "includeRelated": { "type": "boolean", "default": false },
                        "explain": { "type": "boolean", "default": true },
                        "minScore": { "type": "number", "minimum": 0 },
                        "limit": { "type": "integer", "minimum": 1, "maximum": 500 },
                        "offset": { "type": "integer", "minimum": 0 }
                    }
                }),
                None,
            ),
            capability(
                "lyra-memory",
                "memory_link",
                "Create or update a relation between two Lyra long-term memory records.",
                "state",
                "runtimePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "sourceId": { "type": "string" },
                        "targetId": { "type": "string" },
                        "relation": {
                            "type": "string",
                            "enum": ["related_to", "supports", "contradicts", "supersedes", "belongs_to_project", "same_user_preference", "derived_from"],
                            "default": "related_to"
                        },
                        "confidence": { "type": "number", "minimum": 0, "maximum": 1, "default": 1 }
                    },
                    "required": ["sourceId", "targetId", "relation"]
                }),
                None,
            ),
            capability(
                "lyra-memory",
                "memory_review_candidates",
                "Review pending Lyra memory candidates without mixing them into chat messages.",
                "read",
                "always",
                json!({
                    "type": "object",
                    "properties": {
                        "status": { "type": "string", "enum": ["pending", "auto_applied", "needs_user_confirmation", "approved", "rejected", "expired"], "default": "pending" },
                        "limit": { "type": "integer", "minimum": 1, "maximum": 500 }
                    }
                }),
                None,
            ),
            capability(
                "lyra-memory",
                "memory_apply_candidate",
                "Apply a reviewed Lyra memory candidate.",
                "state",
                "runtimePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    },
                    "required": ["id"]
                }),
                None,
            ),
            capability(
                "lyra-memory",
                "memory_reject_candidate",
                "Reject a Lyra memory candidate.",
                "state",
                "runtimePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "reason": { "type": "string" }
                    },
                    "required": ["id"]
                }),
                None,
            ),
            capability(
                "lyra-memory",
                "memory_explain_injection",
                "Explain which long-term memories were injected for the current or requested turn and why.",
                "read",
                "always",
                json!({
                    "type": "object",
                    "properties": {
                        "sessionId": { "type": "string" },
                        "turnId": { "type": "string" }
                    }
                }),
                None,
            ),
            capability(
                "lyra-clarification",
                "ask_user",
                "Ask the user a structured clarification question through Lyra's decision panel.",
                "state",
                "runtimePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "question": { "type": "string" },
                        "options": { "type": "array", "items": { "type": "object" } },
                        "allowCustomAnswer": { "type": "boolean", "default": true },
                        "detail": { "type": "string" }
                    },
                    "required": ["question"]
                }),
                None,
            ),
            capability(
                "lyra-workbench",
                "workbench_list_tabs",
                "List Lyra workbench tabs, including browser, file, image, terminal, and other app tabs.",
                "read",
                "hostCapability",
                json!({
                    "type": "object",
                    "properties": {
                        "scope": { "type": "string", "enum": ["all", "visible", "active"], "default": "all" },
                        "includeUnsupported": { "type": "boolean", "default": true }
                    }
                }),
                Some("workbench.listTabs"),
            ),
            capability(
                "lyra-workbench",
                "workbench_read_workspace",
                "Read the currently visible Lyra workspace state.",
                "read",
                "hostCapability",
                json!({
                    "type": "object",
                    "properties": {
                        "detail": { "type": "string", "enum": ["summary", "full"], "default": "summary" }
                    }
                }),
                Some("workbench.readWorkspace"),
            ),
            capability(
                "lyra-workbench",
                "workbench_read_tab",
                "Read one Lyra workbench tab by id. Use this for non-browser app tabs or tab summaries.",
                "read",
                "hostCapability",
                json!({
                    "type": "object",
                    "properties": {
                        "tabId": { "type": "string" },
                        "detail": { "type": "string", "enum": ["summary", "full"], "default": "summary" }
                    },
                    "required": ["tabId"]
                }),
                Some("workbench.readTab"),
            ),
            capability(
                "lyra-workbench",
                "workbench_activate_tab",
                "Activate a Lyra workbench tab by id.",
                "action",
                "hostCapability",
                json!({
                    "type": "object",
                    "properties": {
                        "tabId": { "type": "string" }
                    },
                    "required": ["tabId"]
                }),
                Some("workbench.activateTab"),
            ),
            capability(
                "lyra-software",
                "software_list_capabilities",
                "List installed Lyra software adapters and their lightweight capabilities.",
                "read",
                "hostCapability",
                json!({
                    "type": "object",
                    "properties": {
                        "includeSchemas": { "type": "boolean", "default": false }
                    }
                }),
                Some("software.listCapabilities"),
            ),
            capability(
                "lyra-software",
                "software_inspect_capability",
                "Inspect one Lyra software adapter capability including full schema and readable state hints.",
                "read",
                "hostCapability",
                json!({
                    "type": "object",
                    "properties": {
                        "softwareId": { "type": "string" },
                        "capabilityId": { "type": "string" }
                    },
                    "required": ["softwareId"]
                }),
                Some("software.inspectCapability"),
            ),
            capability(
                "lyra-software",
                "software_read_state",
                "Read lightweight state from installed Lyra software.",
                "read",
                "hostCapability",
                json!({
                    "type": "object",
                    "properties": {
                        "softwareId": { "type": "string" },
                        "capabilityId": { "type": "string" }
                    }
                }),
                Some("software.readState"),
            ),
            capability(
                "lyra-software",
                "software_invoke_capability",
                "Invoke a Lyra software adapter capability when the task requires an installed app.",
                "hostCapability",
                "runtimePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "softwareId": { "type": "string" },
                        "capabilityId": { "type": "string" },
                        "input": { "type": "object" }
                    },
                    "required": ["softwareId", "capabilityId"]
                }),
                Some("software.invoke"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_map",
                "Map actionable elements on a Lyra browser page using selectors, focus scan, and weak DOM.",
                "hostCapability",
                "hostCapability",
                lumen_target_schema(json!({
                    "strategy": { "type": "string", "enum": ["picker", "focus", "hybrid", "domFallback"], "default": "picker" },
                    "timeoutMs": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_read",
                "Read text from a Lyra browser page without relying on screenshot OCR.",
                "read",
                "hostCapability",
                lumen_target_schema(json!({
                    "strategy": { "type": "string", "enum": ["focus", "hybrid", "domFallback"], "default": "focus" },
                    "maxChars": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_see",
                "Capture a Lyra browser page as a visual evidence artifact.",
                "read",
                "hostCapability",
                lumen_target_schema(json!({
                    "timeoutMs": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_act",
                "Click, double-click, right-click, or hover an element or point on a Lyra browser page.",
                "hostCapability",
                "runtimePolicy",
                lumen_target_schema(json!({
                    "elementId": { "type": "number" },
                    "targetRef": { "type": "string" },
                    "point": {
                        "type": "object",
                        "properties": {
                            "x": { "type": "number" },
                            "y": { "type": "number" },
                            "reason": { "type": "string" }
                        }
                    },
                    "interaction": { "type": "string", "enum": ["click", "doubleClick", "rightClick", "hover"], "default": "click" },
                    "timeoutMs": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_type",
                "Type text into a browser editable element. Prefer passing elementId from lyra_lumen_map; if omitted, Lyra uses the current or last confirmed editable target.",
                "hostCapability",
                "runtimePolicy",
                lumen_target_schema(json!({
                    "elementId": { "type": "number" },
                    "targetRef": { "type": "string" },
                    "text": { "type": "string" },
                    "clear": { "type": "boolean", "default": false },
                    "timeoutMs": { "type": "number" }
                }))
                .with_required(vec!["text"]),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_press",
                "Press a keyboard key in the Lyra browser agent page.",
                "hostCapability",
                "runtimePolicy",
                lumen_target_schema(json!({
                    "elementId": { "type": "number" },
                    "targetRef": { "type": "string" },
                    "key": { "type": "string" },
                    "timeoutMs": { "type": "number" }
                }))
                .with_required(vec!["key"]),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_submit",
                "Submit the focused or selected Lyra browser control.",
                "hostCapability",
                "runtimePolicy",
                lumen_target_schema(json!({
                    "elementId": { "type": "number" },
                    "targetRef": { "type": "string" },
                    "key": { "type": "string", "default": "Enter" },
                    "timeoutMs": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_wait",
                "Wait for browser page loading, text changes, text stability, or text containment.",
                "read",
                "hostCapability",
                lumen_target_schema(json!({
                    "until": { "type": "string", "enum": ["loadIdle", "textChanged", "textStable", "textContains"], "default": "textStable" },
                    "text": { "type": "string" },
                    "timeoutMs": { "type": "number" },
                    "idleMs": { "type": "number" },
                    "maxChars": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_read_until",
                "Read the Lyra browser page repeatedly until a wait condition is satisfied.",
                "read",
                "hostCapability",
                lumen_target_schema(json!({
                    "until": { "type": "string", "enum": ["loadIdle", "textChanged", "textStable", "textContains"], "default": "textStable" },
                    "text": { "type": "string" },
                    "timeoutMs": { "type": "number" },
                    "idleMs": { "type": "number" },
                    "maxChars": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_navigate",
                "Navigate a Lyra browser page.",
                "hostCapability",
                "runtimePolicy",
                lumen_target_schema(json!({
                    "url": { "type": "string" },
                    "newTab": { "type": "boolean", "default": false },
                    "timeoutMs": { "type": "number" }
                }))
                .with_required(vec!["url"]),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_reveal",
                "Hover or otherwise reveal hidden browser elements, then return newly exposed actions.",
                "hostCapability",
                "runtimePolicy",
                lumen_target_schema(json!({
                    "elementId": { "type": "number" },
                    "targetRef": { "type": "string" },
                    "point": { "type": "object" },
                    "interaction": { "type": "string", "enum": ["hover", "click"], "default": "hover" },
                    "idleMs": { "type": "number" },
                    "timeoutMs": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_focus_scan",
                "Use focus navigation to scan focusable elements on a Lyra browser page.",
                "read",
                "hostCapability",
                lumen_target_schema(json!({
                    "direction": { "type": "string", "enum": ["scan", "next", "previous"], "default": "scan" },
                    "steps": { "type": "number" },
                    "restoreFocus": { "type": "boolean" },
                    "timeoutMs": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_follow_audit",
                "Read compact semantic Follow-mode browser action audit.",
                "read",
                "hostCapability",
                lumen_target_schema(json!({
                    "maxActions": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_audit",
                "Audit browser page diagnostics such as console errors, failed loads, and runtime reachability.",
                "read",
                "hostCapability",
                lumen_target_schema(json!({
                    "maxEntries": { "type": "number" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-browser",
                "lyra_lumen_elevate",
                "Promote an isolated browser task to a visible Lyra browser tab when user action is required.",
                "hostCapability",
                "runtimePolicy",
                lumen_target_schema(json!({
                    "reason": { "type": "string" }
                })),
                Some("browser.operate"),
            ),
            capability(
                "lyra-artifacts",
                "artifact_read",
                "Read a Lyra-owned artifact such as a Lumen screenshot, message image, or tool-output artifact by artifact id, path, source URI, or openTarget path.",
                "read",
                "lyraArtifactReadPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "artifactId": { "type": "string" },
                        "id": { "type": "string" },
                        "path": { "type": "string" },
                        "source": { "type": "string" },
                        "maxBytes": { "type": "number" }
                    }
                }),
                None,
            ),
            capability(
                "lyra-files",
                "file_read",
                "Read a workspace file with optional line range and byte budget.",
                "read",
                "workspaceReadPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "startLine": { "type": "number" },
                        "endLine": { "type": "number" },
                        "maxBytes": { "type": "number" },
                        "encoding": { "type": "string", "enum": ["utf-8", "utf8", "lossy-utf8"], "default": "utf-8" }
                    },
                    "required": ["path"]
                }),
                None,
            ),
            capability(
                "lyra-files",
                "file_list",
                "List a workspace directory with depth, hidden-file, and result limits.",
                "read",
                "workspaceReadPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "default": "." },
                        "recursive": { "type": "boolean", "default": false },
                        "depth": { "type": "number", "default": 1 },
                        "includeHidden": { "type": "boolean", "default": false },
                        "limit": { "type": "number", "default": 200 }
                    }
                }),
                None,
            ),
            capability(
                "lyra-files",
                "file_glob",
                "Find workspace paths matching a glob pattern under a checked root.",
                "read",
                "workspaceReadPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "pattern": { "type": "string" },
                        "root": { "type": "string", "default": "." },
                        "includeHidden": { "type": "boolean", "default": false },
                        "limit": { "type": "number", "default": 200 }
                    },
                    "required": ["pattern"]
                }),
                None,
            ),
            capability(
                "lyra-files",
                "file_write",
                "Write a workspace file through Lyra workspace policy.",
                "write",
                "workspaceWritePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "content": { "type": "string" },
                        "overwrite": { "type": "boolean", "default": false }
                    },
                    "required": ["path", "content"]
                }),
                None,
            ),
            capability(
                "lyra-files",
                "file_edit",
                "Edit a workspace file by exact old/new string replacement.",
                "write",
                "workspaceWritePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "oldString": { "type": "string" },
                        "newString": { "type": "string" },
                        "replaceAll": { "type": "boolean", "default": false }
                    },
                    "required": ["path", "oldString", "newString"]
                }),
                None,
            ),
            capability(
                "lyra-files",
                "file_multiedit",
                "Apply multiple exact replacements atomically across workspace files.",
                "write",
                "workspaceWritePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "edits": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "path": { "type": "string" },
                                    "oldString": { "type": "string" },
                                    "newString": { "type": "string" },
                                    "replaceAll": { "type": "boolean", "default": false }
                                },
                                "required": ["oldString", "newString"]
                            }
                        }
                    },
                    "required": ["edits"]
                }),
                None,
            ),
            capability(
                "lyra-files",
                "apply_patch",
                "Apply structured workspace patch operations for add, update, delete, or move.",
                "write",
                "workspaceWritePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "operations": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "op": { "type": "string", "enum": ["add", "update", "delete", "move"] },
                                    "path": { "type": "string" },
                                    "newPath": { "type": "string" },
                                    "content": { "type": "string" },
                                    "oldString": { "type": "string" },
                                    "newString": { "type": "string" },
                                    "replaceAll": { "type": "boolean", "default": false }
                                },
                                "required": ["op", "path"]
                            }
                        }
                    },
                    "required": ["operations"]
                }),
                None,
            ),
            capability(
                "lyra-terminal",
                "shell_run",
                "Run one non-interactive command in a checked workspace cwd with timeout and output limits.",
                "command",
                "commandPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" },
                        "cwd": { "type": "string" },
                        "timeoutMs": { "type": "number", "default": 30000 },
                        "maxOutputBytes": { "type": "number", "default": 20000 },
                        "env": { "type": "object" },
                        "envAllowlist": { "type": "array", "items": { "type": "string" } }
                    },
                    "required": ["command"]
                }),
                None,
            ),
            capability(
                "lyra-search",
                "project_search",
                "Search workspace file names and text content.",
                "read",
                "workspaceReadPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "root": { "type": "string", "default": "." },
                        "includeHidden": { "type": "boolean", "default": false },
                        "limit": { "type": "number", "default": 80 },
                        "maxFileBytes": { "type": "number", "default": 1000000 }
                    },
                    "required": ["query"]
                }),
                None,
            ),
            capability(
                "lyra-code",
                "code_search_text",
                "Search workspace source text and return file, line, and snippet matches.",
                "read",
                "workspaceReadPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "pattern": { "type": "string" },
                        "root": { "type": "string", "default": "." },
                        "glob": { "type": "string" },
                        "includeHidden": { "type": "boolean", "default": false },
                        "limit": { "type": "number", "default": 80 },
                        "caseSensitive": { "type": "boolean", "default": false }
                    }
                }),
                None,
            ),
            capability(
                "lyra-code",
                "code_search_symbol",
                "Search likely source symbols and return structured symbol matches.",
                "read",
                "workspaceReadPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "symbol": { "type": "string" },
                        "root": { "type": "string", "default": "." },
                        "kind": { "type": "string" },
                        "language": { "type": "string" },
                        "includeHidden": { "type": "boolean", "default": false },
                        "limit": { "type": "number", "default": 80 }
                    }
                }),
                None,
            ),
            capability(
                "lyra-code",
                "code_graph_expand",
                "Expand a lightweight code graph around a symbol using local text evidence.",
                "read",
                "workspaceReadPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "symbol": { "type": "string" },
                        "query": { "type": "string" },
                        "root": { "type": "string", "default": "." },
                        "depth": { "type": "number", "default": 1 },
                        "limit": { "type": "number", "default": 80 }
                    }
                }),
                None,
            ),
            capability(
                "lyra-lsp",
                "lsp_query",
                "Query LSP diagnostics, symbols, definition, references, hover, or completion, with structured fallback when LSP is unavailable.",
                "read",
                "workspaceReadPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "queryType": { "type": "string", "enum": ["diagnostics", "symbols", "definition", "references", "hover", "completion"] },
                        "path": { "type": "string" },
                        "line": { "type": "number" },
                        "column": { "type": "number" },
                        "languageId": { "type": "string" }
                    },
                    "required": ["queryType"]
                }),
                None,
            ),
            capability(
                "lyra-web",
                "network_status",
                "Inspect Lyra native Agent network/proxy awareness for provider, web_fetch, and web_search calls.",
                "read",
                "networkPolicy",
                json!({
                    "type": "object",
                    "properties": {}
                }),
                None,
            ),
            capability(
                "lyra-web",
                "web_search",
                "Search the web and return structured title, url, and snippet results.",
                "read",
                "networkPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "query": { "type": "string" },
                        "limit": { "type": "number", "default": 5 }
                    },
                    "required": ["query"]
                }),
                None,
            ),
            capability(
                "lyra-web",
                "web_fetch",
                "Fetch a URL and return status, title, links, and extracted text within budget.",
                "read",
                "networkPolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "url": { "type": "string" },
                        "maxChars": { "type": "number", "default": 12000 },
                        "extractText": { "type": "boolean", "default": true },
                        "includeLinks": { "type": "boolean", "default": true }
                    },
                    "required": ["url"]
                }),
                None,
            ),
            capability(
                "lyra-todo",
                "todo_read",
                "Read the current turn-bound Lyra todo projection.",
                "read",
                "always",
                json!({
                    "type": "object",
                    "properties": {}
                }),
                None,
            ),
            capability(
                "lyra-todo",
                "todo_write",
                "Replace the current typed Lyra todo projection for this session.",
                "state",
                "runtimePolicy",
                json!({
                    "type": "object",
                    "properties": {
                        "todos": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "id": { "type": "string" },
                                    "content": { "type": "string" },
                                    "status": { "type": "string", "enum": ["pending", "in_progress", "completed", "cancelled"] },
                                    "priority": { "type": "string", "default": "normal" },
                                    "blockedBy": { "type": "array", "items": { "type": "string" } },
                                    "assignedTo": { "type": "string" }
                                },
                                "required": ["content", "status"]
                            }
                        }
                    },
                    "required": ["todos"]
                }),
                None,
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
    permission_policy: &str,
    schema: Value,
    required_host_capability: Option<&str>,
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
        required_host_capability: required_host_capability.map(str::to_string),
        exposure_mode: ToolExposureMode::Always,
    }
}

trait JsonSchemaRequired {
    fn with_required(self, required: Vec<&str>) -> Self;
}

impl JsonSchemaRequired for Value {
    fn with_required(mut self, required: Vec<&str>) -> Self {
        if let Some(object) = self.as_object_mut() {
            object.insert(
                "required".to_string(),
                Value::Array(
                    required
                        .into_iter()
                        .map(|value| Value::String(value.to_string()))
                        .collect(),
                ),
            );
        }
        self
    }
}

fn lumen_target_schema(extra_properties: Value) -> Value {
    let mut properties = json!({
        "tabId": { "type": "string" },
        "targetMode": { "type": "string", "enum": ["isolated", "live"], "default": "isolated" }
    });
    if let (Some(base), Some(extra)) = (properties.as_object_mut(), extra_properties.as_object()) {
        for (key, value) in extra {
            base.insert(key.clone(), value.clone());
        }
    }
    json!({
        "type": "object",
        "properties": properties
    })
}

fn model_tool_provider_json(descriptor: ModelToolDescriptor) -> Value {
    json!({
        "type": "function",
        "function": {
            "name": descriptor.name,
            "description": descriptor.description,
            "parameters": with_additional_properties(descriptor.schema),
        }
    })
}

fn with_additional_properties(mut schema: Value) -> Value {
    if let Some(object) = schema.as_object_mut() {
        object
            .entry("additionalProperties")
            .or_insert(Value::Bool(false));
    }
    schema
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
        "exposureMode": exposure_mode_str(&capability.exposure_mode),
    })
}

fn model_exposure_mode(mode: &ToolExposureMode) -> ModelToolExposureMode {
    match mode {
        ToolExposureMode::Always => ModelToolExposureMode::Direct,
        ToolExposureMode::Discoverable
        | ToolExposureMode::InspectRequired
        | ToolExposureMode::Hidden => ModelToolExposureMode::Discoverable,
    }
}

fn exposure_mode_str(mode: &ToolExposureMode) -> &'static str {
    match mode {
        ToolExposureMode::Always => "always",
        ToolExposureMode::Discoverable => "discoverable",
        ToolExposureMode::InspectRequired => "inspectRequired",
        ToolExposureMode::Hidden => "hidden",
    }
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

        assert!(names.contains(&"file_read"));
        assert!(names.contains(&"software_list_capabilities"));
        assert!(names.contains(&"lyra_lumen_map"));
    }

    #[test]
    fn model_tool_descriptors_are_registry_backed() {
        let service = ToolActivityService::default();
        let descriptors = service.model_tool_descriptors();
        let names = descriptors
            .iter()
            .map(|descriptor| descriptor.name.as_str())
            .collect::<Vec<_>>();

        assert!(names.contains(&"file_read"));
        assert!(names.contains(&"shell_run"));
        assert!(names.contains(&"web_fetch"));
        assert!(service.can_dispatch_model_tool("todo_write"));
        assert!(!service.can_dispatch_model_tool("missing_tool"));
    }
}
