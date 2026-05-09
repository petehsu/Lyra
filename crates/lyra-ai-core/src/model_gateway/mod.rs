use crate::storage::{trim_to_string, AiProviderModelEntry};
use anyhow::{anyhow, Context, Result};
use reqwest::blocking::{Client, RequestBuilder, Response};
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

const MAX_MODEL_CALL_ATTEMPTS: usize = 3;

mod anthropic;
mod gemini;
mod local_inference;
mod mimo;
mod ollama;
mod openai;
mod responses;
pub mod types;

pub use types::{
    ChatMessage, ChatResponse, MimoRouteCandidate, ModelResponse, ProviderRuntimeConfig, ToolCall,
    ToolDefinition, Usage,
};

pub fn discover_models(config: &ProviderRuntimeConfig) -> Result<Vec<AiProviderModelEntry>> {
    if config.provider_id == "mimo" {
        return mimo::discover_models(config);
    }
    match config.protocol_id.as_str() {
        "ollama_chat" => ollama::discover_models(config),
        "anthropic_messages" => anthropic::discover_models(config),
        "gemini_generate_content" => gemini::discover_models(config),
        "openai_responses" => responses::discover_models(config),
        protocol_id if local_inference::is_local_ffi_protocol(protocol_id) => {
            local_inference::discover_models(config)
        }
        protocol_id if is_openai_chat_compatible_protocol(protocol_id) => {
            openai::discover_models(config)
        }
        protocol_id => Err(anyhow!("unsupported AI model protocol: {protocol_id}")),
    }
}

pub fn generate_response(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ModelResponse> {
    if config.provider_id == "mimo" {
        return mimo::generate_response(config, messages, cancel, on_delta);
    }
    match config.protocol_id.as_str() {
        "ollama_chat" => ollama::generate_response(config, messages, cancel, on_delta),
        "anthropic_messages" => anthropic::generate_response(config, messages, cancel, on_delta),
        "gemini_generate_content" => gemini::generate_response(config, messages, cancel, on_delta),
        "openai_responses" => responses::generate_response(config, messages, cancel, on_delta),
        protocol_id if local_inference::is_local_ffi_protocol(protocol_id) => {
            local_inference::generate_response(config, messages, cancel, on_delta)
        }
        protocol_id if is_openai_chat_compatible_protocol(protocol_id) => {
            openai::generate_response(config, messages, cancel, on_delta)
        }
        protocol_id => Err(anyhow!("unsupported AI model protocol: {protocol_id}")),
    }
}

pub fn stream_completion_with_tools_retrying(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
    mut on_retry: impl FnMut(usize, &str) -> Result<()>,
) -> Result<ChatResponse> {
    let mut attempt = 1_usize;
    loop {
        let result = stream_completion_with_tools_once(
            config.clone(),
            messages.clone(),
            tools.clone(),
            cancel,
            |delta| on_delta(delta),
        );
        match result {
            Ok(response) => return Ok(response),
            Err(error) if attempt < MAX_MODEL_CALL_ATTEMPTS && is_retryable_model_error(&error) => {
                let message = error.to_string();
                on_retry(attempt, &message)?;
                sleep_before_retry(attempt, cancel)?;
                attempt += 1;
            }
            Err(error) => return Err(error),
        }
    }
}

fn stream_completion_with_tools_once(
    config: ProviderRuntimeConfig,
    messages: Vec<ChatMessage>,
    tools: Vec<ToolDefinition>,
    cancel: &AtomicBool,
    on_delta: impl FnMut(&str) -> Result<()>,
) -> Result<ChatResponse> {
    if tools.is_empty() {
        let response = generate_response(config, messages, cancel, on_delta)?;
        return Ok(ChatResponse {
            text: response.text,
            usage: response.usage,
            tool_calls: Vec::new(),
        });
    }
    if config.provider_id == "mimo" {
        return mimo::stream_completion_with_tools(config, messages, tools, cancel, on_delta);
    }
    match config.protocol_id.as_str() {
        "ollama_chat" => {
            ollama::stream_completion_with_tools(config, messages, tools, cancel, on_delta)
        }
        "anthropic_messages" => {
            anthropic::stream_completion_with_tools(config, messages, tools, cancel, on_delta)
        }
        "gemini_generate_content" => {
            gemini::stream_completion_with_tools(config, messages, tools, cancel, on_delta)
        }
        "openai_responses" => {
            responses::stream_completion_with_tools(config, messages, tools, cancel, on_delta)
        }
        protocol_id if local_inference::is_local_ffi_protocol(protocol_id) => {
            local_inference::stream_completion_with_tools(config, messages, tools, cancel, on_delta)
        }
        protocol_id if is_openai_chat_compatible_protocol(protocol_id) => {
            openai::stream_completion_with_tools(config, messages, tools, cancel, on_delta)
        }
        protocol_id => Err(anyhow!("unsupported AI model protocol: {protocol_id}")),
    }
}

fn sleep_before_retry(attempt: usize, cancel: &AtomicBool) -> Result<()> {
    #[cfg(test)]
    {
        let _ = attempt;
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("turn cancelled"));
        }
        thread::sleep(Duration::from_millis(1));
        return Ok(());
    }
    #[cfg(not(test))]
    {
        let seconds = match attempt {
            1 => 1,
            2 => 3,
            _ => 9,
        };
        for _ in 0..seconds * 10 {
            if cancel.load(Ordering::Relaxed) {
                return Err(anyhow!("turn cancelled"));
            }
            thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    }
}

fn is_retryable_model_error(error: &anyhow::Error) -> bool {
    let message = error.to_string().to_ascii_lowercase();
    if message.contains("context length")
        || message.contains("maximum context")
        || message.contains("too many tokens")
        || message.contains("status=400")
        || message.contains("status=401")
        || message.contains("status=403")
    {
        return false;
    }
    message.contains("status=429")
        || message.contains("status=500")
        || message.contains("status=502")
        || message.contains("status=503")
        || message.contains("status=504")
        || message.contains("timeout")
        || message.contains("timed out")
        || message.contains("connection")
        || message.contains("temporarily unavailable")
}

pub fn default_base_url(provider_id: &str, protocol_id: &str) -> String {
    match protocol_id {
        "ollama_chat" => "http://127.0.0.1:11434".to_string(),
        "lmstudio_chat_completions" => "http://127.0.0.1:1234/v1".to_string(),
        "llama_cpp_server" => "http://127.0.0.1:8080/v1".to_string(),
        "vllm_chat_completions" => "http://127.0.0.1:8000/v1".to_string(),
        "llama_cpp_ffi" | "mlx_ffi" => String::new(),
        "anthropic_messages" => "https://api.anthropic.com".to_string(),
        "gemini_generate_content" => "https://generativelanguage.googleapis.com".to_string(),
        _ if provider_id == "mimo" => "https://api.xiaomimimo.com/v1".to_string(),
        _ => "https://api.openai.com/v1".to_string(),
    }
}

pub fn protocol_uses_base_url(protocol_id: &str) -> bool {
    !local_inference::is_local_ffi_protocol(protocol_id)
}

fn is_openai_chat_compatible_protocol(protocol_id: &str) -> bool {
    matches!(
        protocol_id,
        "openai_chat_completions"
            | "azure_openai_chat_completions"
            | "openrouter_chat_completions"
            | "deepseek_chat_completions"
            | "xai_chat_completions"
            | "mistral_chat_completions"
            | "groq_chat_completions"
            | "together_chat_completions"
            | "fireworks_chat_completions"
            | "vercel_ai_gateway_chat_completions"
            | "mimo_openai_chat_completions"
            | "lmstudio_chat_completions"
            | "llama_cpp_server"
            | "vllm_chat_completions"
            | "custom_chat_completions"
    )
}

pub(super) fn client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .context("failed to build AI HTTP client")
}

pub(super) fn normalize_base_url(config: &ProviderRuntimeConfig) -> String {
    trim_to_string(&config.base_url)
        .unwrap_or_else(|| default_base_url(&config.provider_id, &config.protocol_id))
        .trim_end_matches('/')
        .to_string()
}

pub(super) fn apply_headers(
    mut request: RequestBuilder,
    config: &ProviderRuntimeConfig,
) -> RequestBuilder {
    for (key, value) in &config.headers {
        if key.trim().is_empty() || value.trim().is_empty() {
            continue;
        }
        request = request.header(key.trim(), value.trim());
    }
    request
}

pub(super) fn provider_auth(
    request: RequestBuilder,
    config: &ProviderRuntimeConfig,
) -> RequestBuilder {
    match config.api_key.as_deref().and_then(trim_to_string) {
        Some(key) if config.provider_id == "mimo" => match config.auth_scheme.as_deref() {
            Some(mimo::MIMO_AUTH_BEARER) => request.bearer_auth(key),
            _ => request.header("api-key", key),
        },
        Some(key) => request.bearer_auth(key),
        None => request,
    }
}

pub(super) fn request_error(response: Response) -> anyhow::Error {
    let status = response.status();
    anyhow!("model provider request failed: status={status}")
}

pub(super) fn system_prompt_from_messages(messages: &[ChatMessage]) -> Option<String> {
    let text = messages
        .iter()
        .filter(|message| message.role == "system")
        .map(|message| message.content.trim())
        .filter(|content| content.is_empty() == false)
        .collect::<Vec<_>>()
        .join("\n\n");
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

pub(super) fn entry(id: impl Into<String>, source: &str) -> AiProviderModelEntry {
    let id = id.into();
    AiProviderModelEntry {
        name: id.clone(),
        id,
        description: None,
        context_window: None,
        supports_images: None,
        supports_tools: None,
        runtime_metadata: None,
        source: source.to_string(),
    }
}

pub(super) fn parse_tool_arguments(raw: &str) -> Value {
    if raw.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(raw).unwrap_or_else(|_| json!({ "raw": raw }))
    }
}

pub(super) fn is_auth_status(status: StatusCode) -> bool {
    status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN
}

pub(super) fn read_sse_stream(
    response: Response,
    cancel: &AtomicBool,
    mut on_delta: impl FnMut(&str) -> Result<()>,
    extract_delta: impl Fn(&Value) -> Option<String>,
) -> Result<ModelResponse> {
    let mut text = String::new();
    read_text_lines(response, cancel, |line| {
        let trimmed = line.trim();
        if !trimmed.starts_with("data:") {
            return Ok(());
        }
        let data = trimmed.trim_start_matches("data:").trim();
        if data == "[DONE]" || data.is_empty() {
            return Ok(());
        }
        let value: Value = serde_json::from_str(data).unwrap_or(Value::Null);
        if let Some(delta) = extract_delta(&value) {
            if !delta.is_empty() {
                text.push_str(&delta);
                on_delta(&delta)?;
            }
        }
        Ok(())
    })?;
    Ok(ModelResponse { text, usage: None })
}

pub(super) fn read_line_json_stream(
    response: Response,
    cancel: &AtomicBool,
    mut on_value: impl FnMut(&Value) -> Result<()>,
) -> Result<ModelResponse> {
    let mut text = String::new();
    read_text_lines(response, cancel, |line| {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Ok(());
        }
        let value: Value = serde_json::from_str(trimmed).unwrap_or(Value::Null);
        on_value(&value)?;
        let delta = value
            .get("message")
            .and_then(|message| message.get("content"))
            .or_else(|| value.get("response"))
            .and_then(Value::as_str)
            .unwrap_or("");
        text.push_str(delta);
        Ok(())
    })?;
    Ok(ModelResponse { text, usage: None })
}

pub(super) fn read_text_lines(
    mut response: Response,
    cancel: &AtomicBool,
    mut on_line: impl FnMut(&str) -> Result<()>,
) -> Result<()> {
    let mut pending = String::new();
    let mut buffer = [0_u8; 8192];
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(anyhow!("turn cancelled"));
        }
        let count = response.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        pending.push_str(&String::from_utf8_lossy(&buffer[..count]));
        while let Some(index) = pending.find('\n') {
            let line = pending[..index].trim_end_matches('\r').to_string();
            pending.drain(..=index);
            on_line(&line)?;
        }
    }
    if !pending.trim().is_empty() {
        on_line(&pending)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    fn test_config(base_url: String) -> ProviderRuntimeConfig {
        ProviderRuntimeConfig {
            provider_id: "openai".to_string(),
            protocol_id: "openai_chat_completions".to_string(),
            base_url,
            api_key: Some("test-key".to_string()),
            auth_scheme: None,
            headers: Default::default(),
            connection_config: Default::default(),
            model_runtime_metadata: None,
            model: "test-model".to_string(),
        }
    }

    fn test_messages() -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: "user".to_string(),
            content: "hello".to_string(),
        }]
    }

    #[test]
    fn stream_completion_retries_retryable_provider_errors() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let base_url = format!("http://{}", listener.local_addr().expect("addr"));
        let requests = Arc::new(Mutex::new(0_usize));
        let server_requests = Arc::clone(&requests);
        let server = thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().expect("accept");
                let mut buffer = [0_u8; 4096];
                let _ = stream.read(&mut buffer);
                let mut guard = server_requests.lock().expect("lock");
                *guard += 1;
                let response = if *guard == 1 {
                    "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n".to_string()
                } else {
                    let body = "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n";
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n\r\n{}",
                        body.len(),
                        body
                    )
                };
                stream.write_all(response.as_bytes()).expect("write");
            }
        });
        let mut text = String::new();
        let mut retries = Vec::new();

        let response = stream_completion_with_tools_retrying(
            test_config(base_url),
            test_messages(),
            Vec::new(),
            &AtomicBool::new(false),
            |delta| {
                text.push_str(delta);
                Ok(())
            },
            |attempt, error| {
                retries.push((attempt, error.to_string()));
                Ok(())
            },
        )
        .expect("response");

        server.join().expect("server");
        assert_eq!(response.text, "ok");
        assert_eq!(text, "ok");
        assert_eq!(retries.len(), 1);
        assert_eq!(retries[0].0, 1);
        assert!(retries[0].1.contains("status=500"));
        assert_eq!(*requests.lock().expect("lock"), 2);
    }

    #[test]
    fn protocol_defaults_cover_responses_and_local_runtimes() {
        assert_eq!(
            default_base_url("openai", "openai_responses"),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            default_base_url("llama_cpp", "llama_cpp_server"),
            "http://127.0.0.1:8080/v1"
        );
        assert_eq!(
            default_base_url("vllm", "vllm_chat_completions"),
            "http://127.0.0.1:8000/v1"
        );
        assert!(protocol_uses_base_url("llama_cpp_server"));
        assert!(!protocol_uses_base_url("llama_cpp_ffi"));
        assert!(!protocol_uses_base_url("mlx_ffi"));
    }

    #[test]
    fn unknown_protocol_is_not_silently_routed_to_openai() {
        let error = discover_models(&ProviderRuntimeConfig {
            provider_id: "custom".to_string(),
            protocol_id: "unknown_protocol".to_string(),
            base_url: String::new(),
            api_key: None,
            auth_scheme: None,
            headers: Default::default(),
            connection_config: Default::default(),
            model_runtime_metadata: None,
            model: String::new(),
        })
        .expect_err("unsupported protocol");

        assert!(error
            .to_string()
            .contains("unsupported AI model protocol: unknown_protocol"));
    }
}
