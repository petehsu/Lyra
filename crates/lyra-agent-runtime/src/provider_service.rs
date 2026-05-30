use crate::BackendHandle;

#[derive(Clone, Debug)]
pub struct ProviderService {
    backend: BackendHandle,
}

impl Default for ProviderService {
    fn default() -> Self {
        Self::new(BackendHandle::default())
    }
}

impl ProviderService {
    pub const NAME: &'static str = "provider_service";

    pub fn new(backend: BackendHandle) -> Self {
        Self { backend }
    }

    pub fn read_config(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.config.read", payload)
    }

    pub fn config_snapshot(&self) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend
            .call("agent.config.read", serde_json::json!({}))
    }

    pub fn provider_profiles(&self) -> crate::AgentRuntimeResult<serde_json::Value> {
        let snapshot = self.config_snapshot()?;
        let default_provider = snapshot
            .pointer("/config/provider/default_provider")
            .or_else(|| snapshot.pointer("/config/provider/defaultProvider"))
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let providers = snapshot
            .pointer("/config/providers")
            .and_then(serde_json::Value::as_object)
            .map(|items| {
                let mut providers = items
                    .iter()
                    .map(|(id, profile)| {
                        serde_json::json!({
                            "id": id,
                            "providerType": profile.get("provider_type").or_else(|| profile.get("providerType")).cloned().unwrap_or(serde_json::Value::Null),
                            "baseUrl": profile.get("base_url").or_else(|| profile.get("baseUrl")).cloned().unwrap_or(serde_json::Value::Null),
                            "defaultModel": profile.get("default_model").or_else(|| profile.get("defaultModel")).cloned().unwrap_or(serde_json::Value::Null),
                            "requiresApiKey": profile.get("requires_api_key").or_else(|| profile.get("requiresApiKey")).cloned().unwrap_or(serde_json::Value::Null),
                        })
                    })
                    .collect::<Vec<_>>();
                providers.sort_by(|left, right| {
                    left["id"]
                        .as_str()
                        .unwrap_or_default()
                        .cmp(right["id"].as_str().unwrap_or_default())
                });
                providers
            })
            .unwrap_or_default();

        Ok(serde_json::json!({
            "defaultProvider": default_provider,
            "providers": providers,
        }))
    }

    pub fn update_config(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.config.update", payload)
    }

    pub fn save_profile(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.provider.profile.save", payload)
    }

    pub fn update_options(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.provider.options.update", payload)
    }

    pub fn model_catalog_from_payload(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.models.list", payload)
    }

    pub fn model_catalog(
        &self,
        session_id: Option<String>,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        let mut payload = serde_json::Map::new();
        if let Some(session_id) = session_id {
            payload.insert(
                "sessionId".to_string(),
                serde_json::Value::String(session_id),
            );
        }
        self.backend
            .call("agent.models.list", serde_json::Value::Object(payload))
    }

    pub fn switch_model(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.models.switch", payload)
    }

    pub fn refresh_models(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.models.refresh", payload)
    }

    pub fn update_roles(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.roles.update", payload)
    }

    pub fn accounts(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.accounts.list", payload)
    }

    pub fn login_account(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.accounts.login", payload)
    }

    pub fn login_providers(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.accounts.loginProviders", payload)
    }

    pub fn start_login(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.accounts.loginStart", payload)
    }

    pub fn complete_login(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.accounts.loginComplete", payload)
    }

    pub fn switch_account(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.accounts.switch", payload)
    }

    pub fn remove_account(
        &self,
        payload: serde_json::Value,
    ) -> crate::AgentRuntimeResult<serde_json::Value> {
        self.backend.call("agent.accounts.remove", payload)
    }

    pub fn selection_summary(&self, catalog: &serde_json::Value) -> serde_json::Value {
        serde_json::json!({
            "currentProvider": catalog.get("currentProvider").cloned().unwrap_or(serde_json::Value::Null),
            "currentModel": catalog.get("currentModel").cloned().unwrap_or(serde_json::Value::Null),
            "defaultProvider": catalog.get("defaultProvider").cloned().unwrap_or(serde_json::Value::Null),
            "routes": catalog.get("routes").cloned().unwrap_or_else(|| serde_json::json!([])),
        })
    }

    pub fn can_send_image_input(&self, catalog: &serde_json::Value, model_id: &str) -> bool {
        catalog
            .get("models")
            .and_then(serde_json::Value::as_array)
            .and_then(|models| {
                models.iter().find(|model| {
                    model.get("id").and_then(serde_json::Value::as_str) == Some(model_id)
                        || model.get("model").and_then(serde_json::Value::as_str) == Some(model_id)
                })
            })
            .and_then(|model| {
                model
                    .get("supportsImageInput")
                    .or_else(|| model.get("supports_image_input"))
                    .and_then(serde_json::Value::as_bool)
            })
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::ProviderService;

    #[test]
    fn provider_selection_summary_is_structured() {
        let catalog = serde_json::json!({
            "currentProvider": "mimo-token-plan",
            "currentModel": "mimo-v2.5-pro",
            "defaultProvider": "mimo-token-plan",
            "routes": [{ "providerId": "mimo-token-plan", "modelId": "mimo-v2.5-pro" }]
        });
        let summary = ProviderService::default().selection_summary(&catalog);
        assert_eq!(summary["currentProvider"], "mimo-token-plan");
        assert!(summary["routes"].is_array());
    }

    #[test]
    fn provider_vision_gate_is_model_capability_driven() {
        let catalog = serde_json::json!({
            "models": [
                { "id": "text-model", "supportsImageInput": false },
                { "id": "vision-model", "supportsImageInput": true }
            ]
        });
        let service = ProviderService::default();
        assert!(!service.can_send_image_input(&catalog, "text-model"));
        assert!(service.can_send_image_input(&catalog, "vision-model"));
    }
}
