use anyhow::{Result, anyhow};
use async_stream::try_stream;
use async_trait::async_trait;
use futures::{Stream, StreamExt, stream};
use std::sync::Arc;

use serde::Deserialize;
use serde_json::{Value, json};

use crate::message::{ContentBlock, Message, Role, StreamEvent, ToolDefinition};
use crate::provider::{EventStream, Provider, shared_http_client};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderProfile {
    pub id: String,
    pub name: String,
    pub provider_id: String,
    pub protocol_id: String,
    #[serde(default)]
    pub runtime_supported: bool,
    #[serde(default)]
    pub connection_config: Value,
    #[serde(default)]
    pub auth_config: Value,
    pub model: String,
}

pub fn provider_from_profile(profile: AgentProviderProfile) -> Result<Box<dyn Provider>> {
    if !profile.runtime_supported {
        return Err(anyhow!(
            "{} is present in settings but is not wired to the Lyra Agent runtime yet",
            profile.name
        ));
    }

    match profile.protocol_id.as_str() {
        "anthropic_messages" => Ok(Box::new(AnthropicMessagesProvider::new(profile)?)),
        "gemini_generate_content" => Ok(Box::new(GeminiGenerateContentProvider::new(profile)?)),
        "mimo_openai_chat_completions" => {
            let protocol = string_field(&profile.connection_config, "mimoProtocol")
                .unwrap_or_else(|| "openai".to_string());
            if protocol == "anthropic" {
                Ok(Box::new(AnthropicMessagesProvider::new(profile)?))
            } else {
                Ok(Box::new(OpenAiCompatibleProvider::new(profile)?))
            }
        }
        "openai_chat_completions"
        | "openai_responses"
        | "openrouter_chat_completions"
        | "ollama_chat"
        | "lmstudio_chat_completions"
        | "llama_cpp_server"
        | "vllm_chat_completions"
        | "custom_chat_completions" => Ok(Box::new(OpenAiCompatibleProvider::new(profile)?)),
        other => Err(anyhow!("unsupported Agent provider protocol: {other}")),
    }
}

fn required_model(profile: &AgentProviderProfile) -> Result<String> {
    let model = profile.model.trim();
    if model.is_empty() {
        Err(anyhow!(
            "{} requires a model before Agent can run",
            profile.name
        ))
    } else if profile.provider_id == "mimo" {
        Ok(normalize_mimo_model_id(model))
    } else {
        Ok(model.to_string())
    }
}

fn normalize_mimo_model_id(model: &str) -> String {
    model.trim().to_ascii_lowercase()
}

fn string_field(source: &Value, key: &str) -> Option<String> {
    source
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn api_key(profile: &AgentProviderProfile) -> Option<String> {
    string_field(&profile.auth_config, "apiKey")
        .or_else(|| string_field(&profile.auth_config, "api_key"))
}

fn mimo_route(profile: &AgentProviderProfile) -> String {
    string_field(&profile.connection_config, "mimoRoute").unwrap_or_else(|| "api".to_string())
}

fn validated_mimo_api_key(profile: &AgentProviderProfile) -> Result<Option<String>> {
    let Some(api_key) = api_key(profile) else {
        return Ok(None);
    };
    if profile.provider_id != "mimo" {
        return Ok(Some(api_key));
    }
    let route = mimo_route(profile);
    if route == "token_plan" && !api_key.starts_with("tp-") {
        return Err(anyhow!(
            "{} Token Plan requires a tp- API key; the pay-as-you-go sk- key cannot be used there",
            profile.name
        ));
    }
    if route != "token_plan" && !api_key.starts_with("sk-") {
        return Err(anyhow!(
            "{} API requires an sk- API key; the Token Plan tp- key cannot be used there",
            profile.name
        ));
    }
    Ok(Some(api_key))
}

fn required_provider_api_key(profile: &AgentProviderProfile) -> Result<Option<String>> {
    let api_key = validated_mimo_api_key(profile)?;
    if profile.provider_id == "mimo" && api_key.is_none() {
        return Err(anyhow!("{} requires an API key", profile.name));
    }
    Ok(api_key)
}

fn base_url(profile: &AgentProviderProfile, fallback: &str) -> String {
    string_field(&profile.connection_config, "baseUrl").unwrap_or_else(|| fallback.to_string())
}

fn mimo_base_urls(profile: &AgentProviderProfile, protocol: &str) -> Vec<String> {
    if profile.provider_id != "mimo" {
        return Vec::new();
    }
    let route = mimo_route(profile);
    if route == "token_plan" {
        let selected_region = string_field(&profile.connection_config, "mimoRegion")
            .unwrap_or_else(|| "cn".to_string());
        let mut regions = vec![selected_region.as_str()];
        for fallback in ["cn", "sgp", "ams"] {
            if !regions.contains(&fallback) {
                regions.push(fallback);
            }
        }
        return regions
            .into_iter()
            .map(|region| {
                let host = match region {
                    "sgp" => "https://token-plan-sgp.xiaomimimo.com",
                    "ams" => "https://token-plan-ams.xiaomimimo.com",
                    _ => "https://token-plan-cn.xiaomimimo.com",
                };
                if protocol == "anthropic" {
                    format!("{host}/anthropic")
                } else {
                    format!("{host}/v1")
                }
            })
            .collect();
    }
    vec![if protocol == "anthropic" {
        "https://api.xiaomimimo.com/anthropic".to_string()
    } else {
        "https://api.xiaomimimo.com/v1".to_string()
    }]
}

fn mimo_config_summary(profile: &AgentProviderProfile, protocol: &str) -> String {
    let route = mimo_route(profile);
    if route == "token_plan" {
        let region = string_field(&profile.connection_config, "mimoRegion")
            .unwrap_or_else(|| "cn".to_string());
        format!("MiMo Token Plan/{protocol}/{region}")
    } else {
        format!("MiMo API/{protocol}")
    }
}

#[derive(Clone, Copy)]
enum OpenAiAuthMode {
    ApiKey,
    Bearer,
    Both,
}

impl OpenAiAuthMode {
    fn apply(self, request: reqwest::RequestBuilder, api_key: &str) -> reqwest::RequestBuilder {
        match self {
            Self::ApiKey => request.header("api-key", api_key),
            Self::Bearer => request.bearer_auth(api_key),
            Self::Both => request.header("api-key", api_key).bearer_auth(api_key),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::ApiKey => "api-key",
            Self::Bearer => "bearer",
            Self::Both => "api-key+bearer",
        }
    }
}

#[derive(Clone, Copy)]
enum AnthropicAuthMode {
    ApiKey,
    XApiKey,
    Both,
}

impl AnthropicAuthMode {
    fn apply(self, request: reqwest::RequestBuilder, api_key: &str) -> reqwest::RequestBuilder {
        match self {
            Self::ApiKey => request.header("api-key", api_key),
            Self::XApiKey => request.header("x-api-key", api_key),
            Self::Both => request
                .header("api-key", api_key)
                .header("x-api-key", api_key),
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::ApiKey => "api-key",
            Self::XApiKey => "x-api-key",
            Self::Both => "api-key+x-api-key",
        }
    }
}

fn message_text(message: &Message) -> String {
    message
        .content
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text { text, .. } | ContentBlock::Reasoning { text } => Some(text),
            ContentBlock::ToolResult { content, .. } => Some(content),
            _ => None,
        })
        .cloned()
        .collect::<Vec<_>>()
        .join("\n")
}

fn map_role(role: &Role) -> &'static str {
    match role {
        Role::User => "user",
        Role::Assistant => "assistant",
    }
}

fn boxed_once_text(text: String) -> EventStream {
    Box::pin(stream::iter(vec![
        Ok(StreamEvent::TextDelta(text)),
        Ok(StreamEvent::MessageEnd { stop_reason: None }),
    ]))
}

#[derive(Clone)]
struct OpenAiCompatibleProvider {
    profile: AgentProviderProfile,
    base_urls: Vec<String>,
    api_key: Option<String>,
    model: String,
}

impl OpenAiCompatibleProvider {
    fn new(profile: AgentProviderProfile) -> Result<Self> {
        let fallback = match profile.protocol_id.as_str() {
            "mimo_openai_chat_completions" => "https://api.xiaomimimo.com/v1",
            "openrouter_chat_completions" => "https://openrouter.ai/api/v1",
            "ollama_chat" => "http://127.0.0.1:11434/v1",
            "lmstudio_chat_completions" => "http://127.0.0.1:1234/v1",
            "llama_cpp_server" => "http://127.0.0.1:8080/v1",
            "vllm_chat_completions" => "http://127.0.0.1:8000/v1",
            _ => "https://api.openai.com/v1",
        };
        let model = required_model(&profile)?;
        let mut base_urls = if profile.provider_id == "mimo" {
            mimo_base_urls(&profile, "openai")
        } else {
            vec![base_url(&profile, fallback)]
        }
        .into_iter()
        .map(|url| url.trim_end_matches('/').to_string())
        .collect::<Vec<_>>();
        if profile.protocol_id == "ollama_chat" {
            for base_url in &mut base_urls {
                if !base_url.ends_with("/v1") {
                    base_url.push_str("/v1");
                }
            }
        }
        Ok(Self {
            api_key: required_provider_api_key(&profile)?,
            profile,
            base_urls,
            model,
        })
    }
}

#[async_trait]
impl Provider for OpenAiCompatibleProvider {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
        system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        let mut payload_messages = Vec::new();
        if !system.trim().is_empty() {
            payload_messages.push(json!({ "role": "system", "content": system }));
        }
        payload_messages.extend(messages.iter().map(|message| {
            json!({
                "role": map_role(&message.role),
                "content": message_text(message),
            })
        }));

        let body = json!({
            "model": self.model,
            "messages": payload_messages,
            "stream": true,
        });
        let mut failures = Vec::new();
        let auth_modes = if self.profile.provider_id == "mimo" {
            vec![
                OpenAiAuthMode::ApiKey,
                OpenAiAuthMode::Bearer,
                OpenAiAuthMode::Both,
            ]
        } else {
            vec![OpenAiAuthMode::Bearer]
        };
        for base_url in &self.base_urls {
            for auth_mode in &auth_modes {
                let mut request = shared_http_client()
                    .post(format!("{base_url}/chat/completions"))
                    .json(&body);
                if let Some(api_key) = &self.api_key {
                    request = auth_mode.apply(request, api_key);
                }
                if self.profile.provider_id == "openrouter" {
                    request = request
                        .header("HTTP-Referer", "https://lyra.local")
                        .header("X-Title", "Lyra");
                }
                let response = request.send().await?;
                if response.status().is_success() {
                    return Ok(parse_openai_sse(response.bytes_stream()));
                }
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                failures.push(format!(
                    "{base_url} via {} -> {status}: {body}",
                    auth_mode.label()
                ));
            }
        }

        if self.profile.provider_id == "mimo" {
            return Err(anyhow!(
                "{} request failed for {} after trying all MiMo Token Plan/API routes. Attempts: {}",
                self.profile.name,
                mimo_config_summary(&self.profile, "openai"),
                failures.join(" | ")
            ));
        }

        Err(anyhow!(
            "{} request failed: {}",
            self.profile.name,
            failures.join(" | ")
        ))
    }

    fn name(&self) -> &str {
        &self.profile.name
    }

    fn model(&self) -> String {
        self.model.clone()
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(self.clone())
    }
}

fn parse_openai_sse<S, E>(bytes: S) -> EventStream
where
    S: Stream<Item = std::result::Result<bytes::Bytes, E>> + Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    Box::pin(try_stream! {
        yield StreamEvent::ConnectionPhase { phase: crate::message::ConnectionPhase::Streaming };
        let mut bytes = Box::pin(bytes);
        let mut buffer = String::new();
        while let Some(chunk) = bytes.next().await {
            buffer.push_str(&String::from_utf8_lossy(&chunk.map_err(|error| anyhow!(error.to_string()))?));
            while let Some(index) = buffer.find("\n\n") {
                let frame = buffer[..index].to_string();
                buffer = buffer[index + 2..].to_string();
                for line in frame.lines().map(str::trim) {
                    let Some(data) = line.strip_prefix("data:") else { continue; };
                    let data = data.trim();
                    if data == "[DONE]" {
                        yield StreamEvent::MessageEnd { stop_reason: None };
                        return;
                    }
                    let value: Value = match serde_json::from_str(data) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    if let Some(delta) = value.pointer("/choices/0/delta/content").and_then(Value::as_str)
                        && !delta.is_empty()
                    {
                        yield StreamEvent::TextDelta(delta.to_string());
                    }
                    if let Some(reason) = value.pointer("/choices/0/finish_reason").and_then(Value::as_str) {
                        yield StreamEvent::MessageEnd { stop_reason: Some(reason.to_string()) };
                        return;
                    }
                }
            }
        }
        yield StreamEvent::MessageEnd { stop_reason: None };
    })
}

#[derive(Clone)]
struct AnthropicMessagesProvider {
    profile: AgentProviderProfile,
    base_urls: Vec<String>,
    api_key: String,
    model: String,
}

impl AnthropicMessagesProvider {
    fn new(profile: AgentProviderProfile) -> Result<Self> {
        let model = required_model(&profile)?;
        let api_key = validated_mimo_api_key(&profile)?
            .ok_or_else(|| anyhow!("{} requires an API key", profile.name))?;
        Ok(Self {
            base_urls: if profile.provider_id == "mimo" {
                mimo_base_urls(&profile, "anthropic")
            } else {
                vec![base_url(&profile, "https://api.anthropic.com")]
            }
            .into_iter()
            .map(|url| url.trim_end_matches('/').to_string())
            .collect(),
            profile,
            api_key,
            model,
        })
    }
}

#[async_trait]
impl Provider for AnthropicMessagesProvider {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
        system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        let body = json!({
            "model": self.model,
            "max_tokens": 4096,
            "system": system,
            "messages": messages.iter().map(|message| json!({
                "role": map_role(&message.role),
                "content": message_text(message),
            })).collect::<Vec<_>>(),
            "stream": true,
        });
        let mut failures = Vec::new();
        let auth_modes = if self.profile.provider_id == "mimo" {
            vec![
                AnthropicAuthMode::ApiKey,
                AnthropicAuthMode::XApiKey,
                AnthropicAuthMode::Both,
            ]
        } else {
            vec![AnthropicAuthMode::XApiKey]
        };
        for base_url in &self.base_urls {
            for auth_mode in &auth_modes {
                let response = auth_mode
                    .apply(
                        shared_http_client()
                            .post(format!("{base_url}/v1/messages"))
                            .header("anthropic-version", "2023-06-01")
                            .json(&body),
                        &self.api_key,
                    )
                    .send()
                    .await?;
                if response.status().is_success() {
                    return Ok(parse_anthropic_sse(response.bytes_stream()));
                }
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                failures.push(format!(
                    "{base_url} via {} -> {status}: {body}",
                    auth_mode.label()
                ));
            }
        }

        if self.profile.provider_id == "mimo" {
            return Err(anyhow!(
                "{} request failed for {} after trying all MiMo Token Plan/API routes. Attempts: {}",
                self.profile.name,
                mimo_config_summary(&self.profile, "anthropic"),
                failures.join(" | ")
            ));
        }

        Err(anyhow!(
            "{} request failed: {}",
            self.profile.name,
            failures.join(" | ")
        ))
    }

    fn name(&self) -> &str {
        &self.profile.name
    }

    fn model(&self) -> String {
        self.model.clone()
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(self.clone())
    }
}

fn parse_anthropic_sse<S, E>(bytes: S) -> EventStream
where
    S: Stream<Item = std::result::Result<bytes::Bytes, E>> + Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    Box::pin(try_stream! {
        yield StreamEvent::ConnectionPhase { phase: crate::message::ConnectionPhase::Streaming };
        let mut bytes = Box::pin(bytes);
        let mut buffer = String::new();
        while let Some(chunk) = bytes.next().await {
            buffer.push_str(&String::from_utf8_lossy(&chunk.map_err(|error| anyhow!(error.to_string()))?));
            while let Some(index) = buffer.find("\n\n") {
                let frame = buffer[..index].to_string();
                buffer = buffer[index + 2..].to_string();
                for line in frame.lines().map(str::trim) {
                    let Some(data) = line.strip_prefix("data:") else { continue; };
                    let value: Value = match serde_json::from_str(data.trim()) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    if let Some(delta) = value.pointer("/delta/text").and_then(Value::as_str)
                        && !delta.is_empty()
                    {
                        yield StreamEvent::TextDelta(delta.to_string());
                    }
                    if value.get("type").and_then(Value::as_str) == Some("message_stop") {
                        yield StreamEvent::MessageEnd { stop_reason: None };
                        return;
                    }
                }
            }
        }
        yield StreamEvent::MessageEnd { stop_reason: None };
    })
}

#[derive(Clone)]
struct GeminiGenerateContentProvider {
    profile: AgentProviderProfile,
    base_url: String,
    api_key: String,
    model: String,
}

impl GeminiGenerateContentProvider {
    fn new(profile: AgentProviderProfile) -> Result<Self> {
        let model = required_model(&profile)?;
        let api_key =
            api_key(&profile).ok_or_else(|| anyhow!("{} requires an API key", profile.name))?;
        Ok(Self {
            base_url: base_url(&profile, "https://generativelanguage.googleapis.com")
                .trim_end_matches('/')
                .to_string(),
            profile,
            api_key,
            model,
        })
    }
}

#[async_trait]
impl Provider for GeminiGenerateContentProvider {
    async fn complete(
        &self,
        messages: &[Message],
        _tools: &[ToolDefinition],
        system: &str,
        _resume_session_id: Option<&str>,
    ) -> Result<EventStream> {
        let mut contents = messages
            .iter()
            .map(|message| {
                json!({
                    "role": if message.role == Role::Assistant { "model" } else { "user" },
                    "parts": [{ "text": message_text(message) }],
                })
            })
            .collect::<Vec<_>>();
        if !system.trim().is_empty() {
            contents.insert(0, json!({ "role": "user", "parts": [{ "text": system }] }));
        }
        let body = json!({ "contents": contents });
        let response: Value = shared_http_client()
            .post(format!(
                "{}/v1beta/models/{}:generateContent?key={}",
                self.base_url, self.model, self.api_key
            ))
            .json(&body)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let text = response
            .pointer("/candidates/0/content/parts/0/text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        Ok(boxed_once_text(text))
    }

    fn name(&self) -> &str {
        &self.profile.name
    }

    fn model(&self) -> String {
        self.model.clone()
    }

    fn fork(&self) -> Arc<dyn Provider> {
        Arc::new(self.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(protocol_id: &str) -> AgentProviderProfile {
        AgentProviderProfile {
            id: "profile-1".to_string(),
            name: "Test Provider".to_string(),
            provider_id: "openai".to_string(),
            protocol_id: protocol_id.to_string(),
            runtime_supported: true,
            connection_config: json!({ "baseUrl": "http://127.0.0.1:9999" }),
            auth_config: json!({ "apiKey": "test-key" }),
            model: "test-model".to_string(),
        }
    }

    fn mimo_profile(route: &str, protocol: &str, region: Option<&str>) -> AgentProviderProfile {
        let mut connection_config = json!({
            "mimoRoute": route,
            "mimoProtocol": protocol,
        });
        if let Some(region) = region {
            connection_config["mimoRegion"] = json!(region);
        }
        AgentProviderProfile {
            id: "mimo-profile".to_string(),
            name: "Xiaomi MiMo".to_string(),
            provider_id: "mimo".to_string(),
            protocol_id: "mimo_openai_chat_completions".to_string(),
            runtime_supported: true,
            connection_config,
            auth_config: json!({
                "apiKey": if route == "token_plan" { "tp-test" } else { "sk-test" },
            }),
            model: "mimo-v2.5-pro".to_string(),
        }
    }

    #[test]
    fn builds_openai_compatible_provider_from_profile() {
        let provider = provider_from_profile(profile("openai_chat_completions")).unwrap();
        assert_eq!(provider.model(), "test-model");
        assert_eq!(provider.name(), "Test Provider");
    }

    #[test]
    fn maps_mimo_api_and_token_plan_base_urls() {
        assert_eq!(
            mimo_base_urls(&mimo_profile("api", "openai", None), "openai")
                .first()
                .map(String::as_str),
            Some("https://api.xiaomimimo.com/v1")
        );
        assert_eq!(
            mimo_base_urls(&mimo_profile("api", "anthropic", None), "anthropic")
                .first()
                .map(String::as_str),
            Some("https://api.xiaomimimo.com/anthropic")
        );
        assert_eq!(
            mimo_base_urls(&mimo_profile("token_plan", "openai", Some("sgp")), "openai")
                .first()
                .map(String::as_str),
            Some("https://token-plan-sgp.xiaomimimo.com/v1")
        );
        assert_eq!(
            mimo_base_urls(
                &mimo_profile("token_plan", "anthropic", Some("ams")),
                "anthropic"
            )
            .first()
            .map(String::as_str),
            Some("https://token-plan-ams.xiaomimimo.com/anthropic")
        );
    }

    #[test]
    fn token_plan_base_urls_try_selected_region_first_then_fallbacks() {
        assert_eq!(
            mimo_base_urls(&mimo_profile("token_plan", "openai", Some("ams")), "openai"),
            vec![
                "https://token-plan-ams.xiaomimimo.com/v1",
                "https://token-plan-cn.xiaomimimo.com/v1",
                "https://token-plan-sgp.xiaomimimo.com/v1",
            ]
        );
    }

    #[test]
    fn builds_mimo_provider_for_both_api_formats() {
        let mut openai = mimo_profile("api", "openai", None);
        openai.model = "MiMo-V2.5-Pro".to_string();
        let provider = provider_from_profile(openai).unwrap();
        assert_eq!(provider.model(), "mimo-v2.5-pro");
        assert!(provider_from_profile(mimo_profile("token_plan", "anthropic", Some("cn"))).is_ok());
    }

    #[test]
    fn rejects_mimo_key_route_mismatches_before_request() {
        let mut token_plan = mimo_profile("token_plan", "openai", Some("cn"));
        token_plan.auth_config = json!({ "apiKey": "sk-wrong" });
        let token_error = match provider_from_profile(token_plan) {
            Ok(_) => panic!("expected token plan sk key to fail"),
            Err(error) => error.to_string(),
        };
        assert!(token_error.contains("requires a tp- API key"));

        let mut api = mimo_profile("api", "openai", None);
        api.auth_config = json!({ "apiKey": "tp-wrong" });
        let api_error = match provider_from_profile(api) {
            Ok(_) => panic!("expected api tp key to fail"),
            Err(error) => error.to_string(),
        };
        assert!(api_error.contains("requires an sk- API key"));
    }

    #[test]
    fn rejects_mimo_without_api_key_before_request() {
        let mut profile = mimo_profile("token_plan", "openai", Some("cn"));
        profile.auth_config = json!({});
        let error = match provider_from_profile(profile) {
            Ok(_) => panic!("expected missing MiMo key to fail"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("requires an API key"));
    }

    #[test]
    fn rejects_profiles_marked_runtime_unsupported() {
        let mut profile = profile("copilot_chat_completions");
        profile.runtime_supported = false;
        let error = match provider_from_profile(profile) {
            Ok(_) => panic!("expected unsupported runtime profile to fail"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("not wired"));
    }

    #[test]
    fn rejects_unknown_protocols() {
        let error = match provider_from_profile(profile("copilot_chat_completions")) {
            Ok(_) => panic!("expected unknown protocol to fail"),
            Err(error) => error.to_string(),
        };
        assert!(error.contains("unsupported Agent provider protocol"));
    }
}
