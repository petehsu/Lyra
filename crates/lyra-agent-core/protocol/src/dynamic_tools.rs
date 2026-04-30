use schemars::JsonSchema;
use serde::Deserialize;
use serde::Deserializer;
use serde::Serialize;
use serde_json::Value as JsonValue;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct DynamicToolSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host_method: Option<String>,
    pub description: String,
    pub input_schema: JsonValue,
    #[serde(default)]
    pub defer_loading: bool,
    pub side_effects: Option<DynamicToolSideEffects>,
    pub approval_mode: Option<String>,
    pub risk: Option<JsonValue>,
    pub model_input_capabilities: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct DynamicToolSideEffects {
    #[serde(default)]
    pub level: Option<String>,
    #[serde(default)]
    pub mutates_workspace: bool,
    #[serde(default)]
    pub mutates_memory: bool,
    #[serde(default)]
    pub mutates_external_systems: bool,
    #[serde(default)]
    pub mutates_session_state: bool,
    #[serde(default)]
    pub opens_interactive_session: bool,
    #[serde(default)]
    pub reads_network: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct DynamicToolCallRequest {
    pub call_id: String,
    pub turn_id: String,
    #[serde(default)]
    pub namespace: Option<String>,
    pub tool: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub host_method: Option<String>,
    pub arguments: JsonValue,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema, TS)]
#[serde(rename_all = "camelCase")]
pub struct DynamicToolResponse {
    pub content_items: Vec<DynamicToolCallOutputContentItem>,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, JsonSchema, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(tag = "type")]
pub enum DynamicToolCallOutputContentItem {
    #[serde(rename_all = "camelCase")]
    InputText { text: String },
    #[serde(rename_all = "camelCase")]
    InputImage { image_url: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DynamicToolSpecDe {
    namespace: Option<String>,
    name: String,
    host_method: Option<String>,
    description: String,
    input_schema: JsonValue,
    defer_loading: Option<bool>,
    expose_to_context: Option<bool>,
    side_effects: Option<DynamicToolSideEffects>,
    approval_mode: Option<String>,
    risk: Option<JsonValue>,
    model_input_capabilities: Option<Vec<String>>,
}

impl<'de> Deserialize<'de> for DynamicToolSpec {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let DynamicToolSpecDe {
            namespace,
            name,
            host_method,
            description,
            input_schema,
            defer_loading,
            expose_to_context,
            side_effects,
            approval_mode,
            risk,
            model_input_capabilities,
        } = DynamicToolSpecDe::deserialize(deserializer)?;

        Ok(Self {
            namespace,
            name,
            host_method,
            description,
            input_schema,
            defer_loading: defer_loading
                .unwrap_or_else(|| expose_to_context.map(|visible| !visible).unwrap_or(false)),
            side_effects,
            approval_mode,
            risk,
            model_input_capabilities,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::DynamicToolSpec;
    use pretty_assertions::assert_eq;
    use serde_json::json;

    #[test]
    fn dynamic_tool_spec_deserializes_defer_loading() {
        let value = json!({
            "name": "lookup_ticket",
            "description": "Fetch a ticket",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                }
            },
            "deferLoading": true,
        });

        let actual: DynamicToolSpec = serde_json::from_value(value).expect("deserialize");

        assert_eq!(
            actual,
            DynamicToolSpec {
                namespace: None,
                name: "lookup_ticket".to_string(),
                host_method: None,
                description: "Fetch a ticket".to_string(),
                input_schema: json!({
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" }
                    }
                }),
                defer_loading: true,
                side_effects: None,
                approval_mode: None,
                risk: None,
                model_input_capabilities: None,
            }
        );
    }

    #[test]
    fn dynamic_tool_spec_legacy_expose_to_context_inverts_to_defer_loading() {
        let value = json!({
            "name": "lookup_ticket",
            "description": "Fetch a ticket",
            "inputSchema": {
                "type": "object",
                "properties": {}
            },
            "exposeToContext": false,
        });

        let actual: DynamicToolSpec = serde_json::from_value(value).expect("deserialize");

        assert!(actual.defer_loading);
    }

    #[test]
    fn dynamic_tool_spec_preserves_permission_metadata() {
        let value = json!({
            "name": "workbench.workspace.read",
            "hostMethod": "workbench.document.read",
            "description": "Read workspace state",
            "inputSchema": { "type": "object", "properties": {} },
            "approvalMode": "auto",
            "sideEffects": {
                "level": "read_only",
                "mutatesWorkspace": false,
                "mutatesMemory": false,
                "mutatesExternalSystems": false,
                "mutatesSessionState": false,
                "opensInteractiveSession": false,
                "readsNetwork": false
            },
            "risk": { "level": "low" },
            "modelInputCapabilities": ["text"]
        });

        let actual: DynamicToolSpec = serde_json::from_value(value).expect("deserialize");

        assert_eq!(actual.approval_mode.as_deref(), Some("auto"));
        assert_eq!(
            actual.host_method.as_deref(),
            Some("workbench.document.read")
        );
        assert_eq!(
            actual
                .side_effects
                .as_ref()
                .and_then(|effects| effects.level.as_deref()),
            Some("read_only")
        );
        assert_eq!(
            actual.model_input_capabilities,
            Some(vec!["text".to_string()])
        );
        assert_eq!(actual.risk, Some(json!({ "level": "low" })));
    }
}
