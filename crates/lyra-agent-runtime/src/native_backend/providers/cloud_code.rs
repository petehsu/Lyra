//! Cloud Code generateContent used by Gemini Code Assist and Antigravity.
//!
//! Both accounts authenticate with Google and post to `v1internal:generateContent`.
//! The host differs: Code Assist uses `cloudcode-pa`, Antigravity uses `daily-cloudcode-pa`.

use serde_json::{Value, json};

use crate::native_backend::NativeProviderProfile;
use crate::{AgentRuntimeError, AgentRuntimeResult};

use super::routes::subscription as routes;

pub(crate) fn generate_url(provider: &NativeProviderProfile) -> AgentRuntimeResult<String> {
    let base = provider
        .base_url
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if provider.route_id == routes::ANTIGRAVITY {
                "https://daily-cloudcode-pa.googleapis.com".to_string()
            } else {
                "https://cloudcode-pa.googleapis.com".to_string()
            }
        });
    Ok(format!(
        "{}/v1internal:generateContent",
        base.trim_end_matches('/')
    ))
}

pub(crate) fn request_body(model: &str, messages: &[Value]) -> Value {
    let contents = messages
        .iter()
        .filter_map(|message| {
            let text = message.get("content").and_then(Value::as_str)?;
            let role = match message.get("role").and_then(Value::as_str) {
                Some("assistant") => "model",
                _ => "user",
            };
            Some(json!({
                "role": role,
                "parts": [{"text": text}]
            }))
        })
        .collect::<Vec<_>>();
    json!({
        "model": model,
        "project": "",
        "request": {
            "contents": contents,
            "generationConfig": {"maxOutputTokens": 4096}
        }
    })
}

pub(crate) fn fetch_model_ids(
    provider: &NativeProviderProfile,
    access_token: &str,
) -> AgentRuntimeResult<Vec<(String, Option<String>)>> {
    let url = format!("{}/v1internal:fetchAvailableModels", cloud_base(provider));
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let response = client
        .post(url)
        .bearer_auth(access_token)
        .header("content-type", "application/json")
        .json(&json!({}))
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "Cloud Code model list failed: {status} {body}"
        )));
    }
    let mut models = body
        .get("models")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(id, entry)| {
            let id = id.trim();
            if id.is_empty() || id == "default" {
                return None;
            }
            let label = entry
                .get("displayName")
                .and_then(Value::as_str)
                .map(str::to_string);
            Some((id.to_string(), label))
        })
        .collect::<Vec<_>>();
    if let Some(default_id) = body
        .get("defaultAgentModelId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty() && *id != "default")
    {
        if !models.iter().any(|(id, _)| id == default_id) {
            models.insert(0, (default_id.to_string(), None));
        }
    }
    if models.is_empty() {
        return Err(AgentRuntimeError::Core(
            "Cloud Code returned no models for this account".to_string(),
        ));
    }
    Ok(models)
}

fn cloud_base(provider: &NativeProviderProfile) -> String {
    provider
        .base_url
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if provider.route_id == routes::ANTIGRAVITY {
                "https://daily-cloudcode-pa.googleapis.com".to_string()
            } else {
                "https://cloudcode-pa.googleapis.com".to_string()
            }
        })
        .trim_end_matches('/')
        .to_string()
}

pub(crate) fn send(
    provider: &NativeProviderProfile,
    access_token: &str,
    model: &str,
    messages: &[Value],
) -> AgentRuntimeResult<String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let response = client
        .post(generate_url(provider)?)
        .bearer_auth(access_token)
        .header("content-type", "application/json")
        .json(&request_body(model, messages))
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "Cloud Code request failed: {status} {body}"
        )));
    }
    Ok(body
        .pointer("/response/candidates/0/content/parts/0/text")
        .or_else(|| body.pointer("/candidates/0/content/parts/0/text"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provider(route_id: &str, base: &str) -> NativeProviderProfile {
        NativeProviderProfile {
            id: route_id.to_string(),
            label: route_id.to_string(),
            route_id: route_id.to_string(),
            base_url: Some(base.to_string()),
            default_model: None,
            api_key: None,
            api_key_ref: None,
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        }
    }

    #[test]
    fn code_assist_and_antigravity_use_their_own_hosts() {
        assert_eq!(
            generate_url(&provider(
                routes::GEMINI_CODE_ASSIST,
                "https://cloudcode-pa.googleapis.com"
            ))
            .unwrap(),
            "https://cloudcode-pa.googleapis.com/v1internal:generateContent"
        );
        assert_eq!(
            generate_url(&provider(
                routes::ANTIGRAVITY,
                "https://daily-cloudcode-pa.googleapis.com"
            ))
            .unwrap(),
            "https://daily-cloudcode-pa.googleapis.com/v1internal:generateContent"
        );
    }
}
