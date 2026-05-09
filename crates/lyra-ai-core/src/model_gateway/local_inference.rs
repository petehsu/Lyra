use super::{
    ChatMessage, ChatResponse, ModelResponse, ProviderRuntimeConfig, ToolDefinition, Usage,
};
use crate::storage::{trim_to_string, AiProviderModelEntry};
use anyhow::{anyhow, Result};
use lyra_local_inference_core::{
    inspect_model, LocalBackendId, LocalChatMessage, LocalInferenceRequest, LocalModelRef,
};
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

const MODEL_PATH_CONFIG_KEY: &str = "modelPath";

pub(super) fn is_local_ffi_protocol(protocol_id: &str) -> bool {
    LocalBackendId::from_protocol_id(protocol_id).is_some()
}

pub(super) fn discover_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    let model = model_ref(config)?;
    let info = inspect_model(model)?;
    Ok(vec![AiProviderModelEntry {
        id: info.id.clone(),
        name: info.name,
        description: Some(format!(
            "Local embedded {} model at {}",
            info.backend, info.local_model_path
        )),
        context_window: None,
        supports_images: None,
        supports_tools: Some(false),
        runtime_metadata: Some(json!({
            "adapterId": "local_inference",
            "compatibilitySource": "native",
            "localRuntimeKind": "ffi",
            "localBackend": info.backend,
            "nativeToolCalling": false,
            "localModelPath": info.local_model_path,
        })),
        source: "dynamic".to_string(),
    }])
}

pub(super) fn generate_response(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    let response = lyra_local_inference_core::generate_response(
        inference_request(&config, messages)?,
        cancel,
        on_delta,
    )?;
    Ok(ModelResponse {
        text: response.text,
        usage: Some(Usage {
            input_tokens: None,
            output_tokens: None,
            total_tokens: None,
        }),
    })
}

pub(super) fn stream_completion_with_tools(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    _tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ChatResponse> {
    let response = generate_response(config, messages, cancel, on_delta)?;
    Ok(ChatResponse {
        text: response.text,
        usage: response.usage,
        tool_calls: Vec::new(),
    })
}

fn inference_request(
    config: &ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
) -> Result<LocalInferenceRequest> {
    Ok(LocalInferenceRequest {
        model: model_ref(config)?,
        model_id: config.model.clone(),
        messages: messages
            .into_iter()
            .map(|message| LocalChatMessage {
                role: message.role,
                content: message.content,
            })
            .collect(),
    })
}

fn model_ref(config: &ProviderRuntimeConfig) -> Result<LocalModelRef> {
    let backend = LocalBackendId::from_protocol_id(&config.protocol_id).ok_or_else(|| {
        anyhow!(
            "unsupported local inference protocol: {}",
            config.protocol_id
        )
    })?;
    let model_path = model_path(config)?;
    Ok(LocalModelRef {
        backend,
        model_path: PathBuf::from(model_path),
    })
}

fn model_path(config: &ProviderRuntimeConfig) -> Result<String> {
    config
        .connection_config
        .get(MODEL_PATH_CONFIG_KEY)
        .and_then(|value| trim_to_string(value))
        .or_else(|| {
            config
                .model_runtime_metadata
                .as_ref()
                .and_then(|metadata| metadata.get("localModelPath"))
                .and_then(|value| value.as_str())
                .and_then(trim_to_string)
        })
        .ok_or_else(|| anyhow!("local model path is required"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config(protocol_id: &str, model_path: &str) -> ProviderRuntimeConfig {
        ProviderRuntimeConfig {
            provider_id: "llama_cpp".to_string(),
            protocol_id: protocol_id.to_string(),
            base_url: String::new(),
            api_key: None,
            auth_scheme: None,
            headers: Default::default(),
            connection_config: [("modelPath".to_string(), model_path.to_string())]
                .into_iter()
                .collect::<HashMap<_, _>>(),
            model_runtime_metadata: None,
            model: "local-model".to_string(),
        }
    }

    #[test]
    fn discovers_single_model_from_local_path() {
        let temp = tempfile::NamedTempFile::new().expect("temp file");
        let models = discover_models(&config("llama_cpp_ffi", &temp.path().to_string_lossy()))
            .expect("models");

        assert_eq!(models.len(), 1);
        assert_eq!(
            models[0].name,
            temp.path()
                .file_name()
                .unwrap()
                .to_string_lossy()
                .to_string()
        );
        assert_eq!(
            models[0].runtime_metadata.as_ref().unwrap()["localBackend"],
            "llama_cpp_ffi"
        );
    }

    #[test]
    fn requires_model_path_for_embedded_backend() {
        let error = discover_models(&config("mlx_ffi", "")).expect_err("missing path");

        assert!(error.to_string().contains("local model path is required"));
    }
}
