use std::{fs, path::Path, sync::Arc, thread, time::Duration};

use base64::Engine as _;
use reqwest::blocking::{Client, Response, multipart};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

use crate::{HostCapabilityDispatcher, native_backend::providers};

use super::*;

const MAX_MEDIA_BYTES: usize = 100 * 1024 * 1024;

struct ResolvedMediaModel {
    provider: NativeProviderProfile,
    model_id: String,
}

pub(crate) fn tool_media_generate_image(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> NativeToolResult {
    let prompt = required_string(input, "prompt")?;
    let resolved = resolve_media_model("imageGeneration", input, dispatcher)?;
    let client = media_client()?;
    let url = providers::transport::http::endpoint_url(&resolved.provider, "images/generations")
        .map_err(runtime_failure)?;
    let mut body = json!({ "model": resolved.model_id, "prompt": prompt });
    copy_string(input, &mut body, "size", "size");
    copy_string(input, &mut body, "quality", "quality");
    let response = providers::transport::auth::apply_model_auth(
        client.post(url).json(&body),
        &resolved.provider,
    )
    .map_err(runtime_failure)?
    .send()
    .map_err(http_failure)?;
    let value = response_json(response)?;
    let item = value
        .get("data")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .ok_or_else(|| malformed_response("image generation response has no data item"))?;
    let bytes = if let Some(encoded) = item.get("b64_json").and_then(Value::as_str) {
        base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|error| malformed_response(format!("invalid image base64: {error}")))?
    } else if let Some(url) = item.get("url").and_then(Value::as_str) {
        download_bytes(&client, url)?
    } else {
        return Err(malformed_response(
            "image generation response contains neither b64_json nor url",
        ));
    };
    ensure_size(&bytes)?;
    let artifact_ref = write_tool_artifact_bytes_with_kind(
        session_id,
        turn_id,
        tool_call_id,
        ToolArtifactKind::Image,
        "png",
        "image/png",
        &bytes,
    )
    .ok_or_else(artifact_failure)?;
    Ok(media_success("Image generated.", artifact_ref, &resolved))
}

pub(crate) fn tool_media_generate_speech(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> NativeToolResult {
    let text = required_string(input, "text")?;
    let resolved = resolve_media_model("speechGeneration", input, dispatcher)?;
    let format = input
        .get("format")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("mp3");
    let voice = input
        .get("voice")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("alloy");
    let client = media_client()?;
    let url = providers::transport::http::endpoint_url(&resolved.provider, "audio/speech")
        .map_err(runtime_failure)?;
    let response = providers::transport::auth::apply_model_auth(
        client.post(url).json(&json!({
            "model": resolved.model_id,
            "input": text,
            "voice": voice,
            "response_format": format,
        })),
        &resolved.provider,
    )
    .map_err(runtime_failure)?
    .send()
    .map_err(http_failure)?;
    let bytes = response_bytes(response)?;
    ensure_size(&bytes)?;
    let mime = audio_mime(format);
    let artifact_ref = write_tool_artifact_bytes_with_kind(
        session_id,
        turn_id,
        tool_call_id,
        ToolArtifactKind::Audio,
        format,
        mime,
        &bytes,
    )
    .ok_or_else(artifact_failure)?;
    Ok(media_success("Speech generated.", artifact_ref, &resolved))
}

pub(crate) fn tool_media_transcribe_audio(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> NativeToolResult {
    let path = required_string(input, "path")?;
    let metadata = fs::metadata(&path).map_err(|error| {
        NativeToolFailure::new(
            "media_file_unavailable",
            format!("Cannot read audio file {path}: {error}"),
            "Choose an existing local audio file and retry.",
        )
    })?;
    if !metadata.is_file() || metadata.len() as usize > MAX_MEDIA_BYTES {
        return Err(NativeToolFailure::new(
            "media_file_invalid",
            format!(
                "Audio input must be a file no larger than {} MiB.",
                MAX_MEDIA_BYTES / 1024 / 1024
            ),
            "Choose a smaller local audio file.",
        ));
    }
    let resolved = resolve_media_model("transcription", input, dispatcher)?;
    let client = media_client()?;
    let url = providers::transport::http::endpoint_url(&resolved.provider, "audio/transcriptions")
        .map_err(runtime_failure)?;
    let filename = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("audio.bin")
        .to_string();
    let bytes = fs::read(&path).map_err(|error| {
        NativeToolFailure::new(
            "media_file_unavailable",
            error.to_string(),
            "Check the file path and retry.",
        )
    })?;
    let part = multipart::Part::bytes(bytes).file_name(filename);
    let mut form = multipart::Form::new()
        .text("model", resolved.model_id.clone())
        .part("file", part);
    if let Some(language) = nonempty_string(input, "language") {
        form = form.text("language", language);
    }
    if let Some(prompt) = nonempty_string(input, "prompt") {
        form = form.text("prompt", prompt);
    }
    let response = providers::transport::auth::apply_model_auth(
        client.post(url).multipart(form),
        &resolved.provider,
    )
    .map_err(runtime_failure)?
    .send()
    .map_err(http_failure)?;
    let value = response_json(response)?;
    let transcript = value
        .get("text")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| malformed_response("transcription response has no text"))?;
    let artifact_ref = write_tool_artifact_with_kind(
        session_id,
        turn_id,
        tool_call_id,
        ToolArtifactKind::Transcription,
        transcript,
    )
    .ok_or_else(artifact_failure)?;
    Ok(NativeToolSuccess {
        content: transcript.to_string(),
        raw: json!({
            "text": transcript,
            "artifactRef": artifact_ref,
            "provider": resolved.provider.id,
            "model": resolved.model_id,
        }),
        recommended_next_action: None,
    })
}

pub(crate) fn tool_media_generate_video(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    cancellation: &CancellationToken,
) -> NativeToolResult {
    let prompt = required_string(input, "prompt")?;
    let resolved = resolve_media_model("videoGeneration", input, dispatcher)?;
    if resolved.provider.route_id != providers::routes::xai::ROUTE_ID {
        return Err(NativeToolFailure::new(
            "media_adapter_unavailable",
            "The first video adapter supports xAI providers only.",
            "Choose an enabled xAI video model or wait for another adapter.",
        ));
    }
    let client = media_client()?;
    let create_url =
        providers::transport::http::endpoint_url(&resolved.provider, "videos/generations")
            .map_err(runtime_failure)?;
    let mut body = json!({ "model": resolved.model_id, "prompt": prompt });
    copy_value(input, &mut body, "duration", "duration");
    copy_string(input, &mut body, "aspectRatio", "aspect_ratio");
    let response = providers::transport::auth::apply_model_auth(
        client.post(create_url).json(&body),
        &resolved.provider,
    )
    .map_err(runtime_failure)?
    .send()
    .map_err(http_failure)?;
    let mut value = response_json(response)?;
    let request_id = value
        .get("request_id")
        .or_else(|| value.get("id"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let started_at =
        crate::native_backend::activity::tool_started_at_for_call(session_id, tool_call_id);
    let mut last_progress: Option<u8> = None;
    let mut attempts = 0_u16;
    while video_url(&value).is_none() {
        if let Some(progress) = video_progress(&value)
            && last_progress != Some(progress)
        {
            last_progress = Some(progress);
            let mut activity = crate::native_backend::activity::tool_activity(
                tool_call_id,
                "media_generate_video",
                &crate::native_backend::activity::tool_label("media", "generate_video"),
                "running",
                input.clone(),
                Some(json!({
                    "content": format!("Generating video ({progress}%)."),
                    "activityKind": "media",
                    "rendererHint": "media",
                })),
                &started_at,
                None,
            );
            activity["progress"] = json!(progress);
            crate::native_backend::activity::record_tool_progress(session_id, turn_id, activity);
        }
        if cancellation.is_cancelled() {
            return Err(NativeToolFailure::new(
                "operation_cancelled",
                "Video generation was cancelled.",
                "Retry only if the video is still needed.",
            ));
        }
        let Some(request_id) = request_id.as_deref() else {
            return Err(malformed_response(
                "video response has no request id or result URL",
            ));
        };
        if video_failed(&value) {
            return Err(NativeToolFailure::new(
                "media_generation_failed",
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Video generation failed."),
                "Review the provider error and adjust the request.",
            ));
        }
        if attempts >= 300 {
            return Err(NativeToolFailure::new(
                "media_generation_timeout",
                "Video generation did not finish within ten minutes.",
                "Check the provider job status before retrying to avoid duplicate charges.",
            ));
        }
        thread::sleep(Duration::from_secs(2));
        attempts += 1;
        let status_url = providers::transport::http::endpoint_url(
            &resolved.provider,
            &format!("videos/{request_id}"),
        )
        .map_err(runtime_failure)?;
        let response = providers::transport::auth::apply_model_auth(
            client.get(status_url),
            &resolved.provider,
        )
        .map_err(runtime_failure)?
        .send()
        .map_err(http_failure)?;
        value = response_json(response)?;
    }
    let url = video_url(&value).expect("checked video URL");
    let bytes = download_bytes(&client, url)?;
    ensure_size(&bytes)?;
    let artifact_ref = write_tool_artifact_bytes_with_kind(
        session_id,
        turn_id,
        tool_call_id,
        ToolArtifactKind::Video,
        "mp4",
        "video/mp4",
        &bytes,
    )
    .ok_or_else(artifact_failure)?;
    Ok(media_success("Video generated.", artifact_ref, &resolved))
}

fn resolve_media_model(
    operation: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Result<ResolvedMediaModel, NativeToolFailure> {
    let operation_key = match operation {
        "imageGeneration" => providers::model_capabilities::OPERATION_IMAGE_GENERATION,
        "speechGeneration" => providers::model_capabilities::OPERATION_SPEECH_GENERATION,
        "transcription" => providers::model_capabilities::OPERATION_TRANSCRIPTION,
        "videoGeneration" => providers::model_capabilities::OPERATION_VIDEO_GENERATION,
        _ => return Err(malformed_response("unknown media operation")),
    };
    let (provider, model_id) = {
        let state = state().lock().map_err(|_| {
            NativeToolFailure::new(
                "runtime_unavailable",
                "Runtime state is unavailable.",
                "Retry.",
            )
        })?;
        let explicit_provider = nonempty_string(input, "provider");
        let explicit_model = nonempty_string(input, "model");
        let model_ref = match (explicit_provider, explicit_model) {
            (Some(provider_id), Some(model_id)) => NativeModelReference {
                provider_id,
                model_id,
            },
            (None, None) => state
                .media_model_defaults
                .get(operation)
                .cloned()
                .ok_or_else(|| {
                    NativeToolFailure::new(
                        "media_model_not_configured",
                        format!("No default model is configured for {operation}."),
                        "Open model capability settings and set a compatible default model.",
                    )
                })?,
            _ => {
                return Err(NativeToolFailure::new(
                    "media_model_reference_invalid",
                    "provider and model must be supplied together.",
                    "Provide both fields or omit both to use the configured default.",
                ));
            }
        };
        let provider = state
            .config
            .providers
            .get(&model_ref.provider_id)
            .cloned()
            .ok_or_else(|| {
                NativeToolFailure::new(
                    "media_provider_unavailable",
                    format!("Provider {} is not configured.", model_ref.provider_id),
                    "Configure the provider or choose another compatible model.",
                )
            })?;
        let model = provider
            .models
            .iter()
            .find(|model| model.id == model_ref.model_id && model.enabled)
            .ok_or_else(|| {
                NativeToolFailure::new(
                    "media_model_unavailable",
                    format!("Model {} is missing or disabled.", model_ref.model_id),
                    "Enable a compatible model and retry.",
                )
            })?;
        let route =
            providers::registry::require_route(&provider.route_id).map_err(runtime_failure)?;
        let record = state
            .model_capabilities
            .get(&provider.id)
            .and_then(|records| records.get(&model.id));
        let supported = providers::model_capabilities::effective_capability(
            record,
            &route.protocol_id,
            &provider.route_id,
            operation_key,
            false,
        );
        if !supported {
            return Err(NativeToolFailure::new(
                "media_capability_unavailable",
                format!(
                    "Model {} cannot execute {operation} through its configured protocol.",
                    model.id
                ),
                "Choose a model whose effective capability is Supported.",
            ));
        }
        (provider, model_ref.model_id)
    };
    let provider = providers::transport::auth::provider_with_resolved_api_key(provider, dispatcher)
        .map_err(runtime_failure)?;
    Ok(ResolvedMediaModel { provider, model_id })
}

fn media_client() -> Result<Client, NativeToolFailure> {
    crate::native_backend::network::http_client_builder(Duration::from_secs(120))
        .build()
        .map_err(http_failure)
}

fn response_json(response: Response) -> Result<Value, NativeToolFailure> {
    let status = response.status();
    let text = response.text().map_err(http_failure)?;
    if !status.is_success() {
        return Err(NativeToolFailure::new(
            "media_provider_error",
            format!(
                "Media provider returned HTTP {status}: {}",
                truncate(&text, 1000)
            ),
            "Review the provider response and model capability settings.",
        ));
    }
    serde_json::from_str(&text)
        .map_err(|error| malformed_response(format!("invalid JSON: {error}")))
}

fn response_bytes(response: Response) -> Result<Vec<u8>, NativeToolFailure> {
    let status = response.status();
    if !status.is_success() {
        let text = response.text().unwrap_or_default();
        return Err(NativeToolFailure::new(
            "media_provider_error",
            format!(
                "Media provider returned HTTP {status}: {}",
                truncate(&text, 1000)
            ),
            "Review the provider response and model capability settings.",
        ));
    }
    response
        .bytes()
        .map(|bytes| bytes.to_vec())
        .map_err(http_failure)
}

fn download_bytes(client: &Client, url: &str) -> Result<Vec<u8>, NativeToolFailure> {
    response_bytes(client.get(url).send().map_err(http_failure)?)
}

fn video_url(value: &Value) -> Option<&str> {
    value
        .get("url")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/video/url").and_then(Value::as_str))
        .or_else(|| value.pointer("/output/url").and_then(Value::as_str))
        .or_else(|| value.get("output_url").and_then(Value::as_str))
}

fn video_failed(value: &Value) -> bool {
    matches!(
        value.get("status").and_then(Value::as_str),
        Some("failed" | "cancelled" | "expired")
    )
}

// Providers report progress as a number or a numeric string, sometimes
// percent-suffixed. Absent or unparseable values mean "no progress available"
// and are silently skipped by the polling loop.
fn video_progress(value: &Value) -> Option<u8> {
    let raw = value.get("progress")?;
    let progress = match raw {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().trim_end_matches('%').parse::<f64>().ok(),
        _ => None,
    }?;
    Some(progress.clamp(0.0, 100.0).round() as u8)
}

fn media_success(
    content: &str,
    artifact_ref: Value,
    resolved: &ResolvedMediaModel,
) -> NativeToolSuccess {
    NativeToolSuccess {
        content: content.to_string(),
        raw: json!({
            "artifactRef": artifact_ref,
            "provider": resolved.provider.id,
            "model": resolved.model_id,
        }),
        recommended_next_action: None,
    }
}

fn required_string(input: &Value, key: &str) -> Result<String, NativeToolFailure> {
    nonempty_string(input, key).ok_or_else(|| {
        NativeToolFailure::new(
            "invalid_media_input",
            format!("{key} is required."),
            format!("Provide a non-empty {key} value."),
        )
    })
}

fn nonempty_string(input: &Value, key: &str) -> Option<String> {
    input
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn copy_string(input: &Value, body: &mut Value, source: &str, target: &str) {
    if let Some(value) = nonempty_string(input, source) {
        body[target] = Value::String(value);
    }
}

fn copy_value(input: &Value, body: &mut Value, source: &str, target: &str) {
    if let Some(value) = input.get(source).filter(|value| !value.is_null()) {
        body[target] = value.clone();
    }
}

fn ensure_size(bytes: &[u8]) -> Result<(), NativeToolFailure> {
    if bytes.len() > MAX_MEDIA_BYTES {
        return Err(NativeToolFailure::new(
            "media_result_too_large",
            format!(
                "Media result exceeds the {} MiB artifact limit.",
                MAX_MEDIA_BYTES / 1024 / 1024
            ),
            "Request a smaller or shorter result.",
        ));
    }
    Ok(())
}

fn audio_mime(format: &str) -> &'static str {
    match format {
        "wav" => "audio/wav",
        "opus" => "audio/opus",
        "flac" => "audio/flac",
        "aac" => "audio/aac",
        _ => "audio/mpeg",
    }
}

fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

fn runtime_failure(error: impl std::fmt::Display) -> NativeToolFailure {
    NativeToolFailure::new(
        "media_runtime_error",
        error.to_string(),
        "Check the provider configuration and retry.",
    )
}

fn http_failure(error: impl std::fmt::Display) -> NativeToolFailure {
    NativeToolFailure::new(
        "media_transport_error",
        error.to_string(),
        "Check the network and provider endpoint, then retry.",
    )
}

fn malformed_response(message: impl Into<String>) -> NativeToolFailure {
    NativeToolFailure::new(
        "media_response_invalid",
        message,
        "Check whether the selected provider implements the configured media endpoint.",
    )
}

fn artifact_failure() -> NativeToolFailure {
    NativeToolFailure::new(
        "media_artifact_write_failed",
        "The generated media could not be saved as a Lyra artifact.",
        "Check local storage and retry.",
    )
}
