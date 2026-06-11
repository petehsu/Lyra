use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};

const MAX_BROWSER_PAGE_INLINE_CHARS: usize = 12_000;
const MAX_IMAGE_EVIDENCE_TOOL_BYTES: u64 = 8 * 1024 * 1024;
pub(crate) fn attach_lumen_page_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    value: &mut Value,
) {
    if display_name != "lyra_lumen"
        || !matches!(
            action,
            "map" | "read" | "read_until" | "wait" | "follow_audit"
        )
        || value.get("pageArtifactRef").is_some()
    {
        return;
    }
    let Some((field, text)) = lumen_page_text_field(value) else {
        return;
    };
    let original_chars = text.chars().count();
    if original_chars <= MAX_BROWSER_PAGE_INLINE_CHARS {
        return;
    }
    let Some(artifact_ref) = write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-browser-page"),
        ToolArtifactKind::WebPage,
        &text,
    ) else {
        return;
    };
    let preview = format!(
        "{}\n\n[Full browser page text stored in pageArtifactRef.]",
        truncate_chars(&text, MAX_BROWSER_PAGE_INLINE_CHARS)
    );
    if let Some(object) = value.as_object_mut() {
        if let Some(field_value) = object.get_mut(field) {
            *field_value = Value::String(preview);
        }
        object.insert("pageArtifactRef".to_string(), artifact_ref);
        object.insert("pageTextTruncated".to_string(), Value::Bool(true));
        object.insert(
            "pageTextSourceField".to_string(),
            Value::String(field.to_string()),
        );
        object.insert(
            "pageTextOriginalChars".to_string(),
            Value::Number(serde_json::Number::from(original_chars as u64)),
        );
    }
}

pub(crate) fn lumen_page_text_field(value: &Value) -> Option<(&'static str, String)> {
    let mut best: Option<(&'static str, String, usize)> = None;
    for field in [
        "content",
        "text",
        "markdown",
        "pageText",
        "visibleText",
        "innerText",
        "compactText",
        "html",
    ] {
        let Some(text) = value
            .get(field)
            .and_then(Value::as_str)
            .filter(|text| !text.trim().is_empty())
        else {
            continue;
        };
        let chars = text.chars().count();
        if best
            .as_ref()
            .is_none_or(|(_, _, best_chars)| chars > *best_chars)
        {
            best = Some((field, text.to_string(), chars));
        }
    }
    best.map(|(field, text, _)| (field, text))
}

pub(crate) fn attach_host_log_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    mut raw: Value,
) -> Value {
    if display_name != "terminal" || raw.get("logArtifactRef").is_some() {
        return raw;
    }
    let log_text = raw
        .get("output")
        .and_then(Value::as_str)
        .or_else(|| raw.pointer("/screen/visibleText").and_then(Value::as_str))
        .or_else(|| raw.get("text").and_then(Value::as_str))
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let Some(log_text) = log_text else {
        return raw;
    };
    let Some(log_ref) = write_tool_artifact_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-terminal-{action}-log"),
        ToolArtifactKind::Log,
        &log_text,
    ) else {
        return raw;
    };
    if let Some(object) = raw.as_object_mut() {
        object.insert("logArtifactRef".to_string(), log_ref);
    }
    raw
}

pub(crate) fn attach_lumen_screenshot_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    value: &mut Value,
) {
    if display_name != "lyra_lumen" || action != "see" {
        return;
    }
    if let Some(path) = value
        .pointer("/imageArtifact/path")
        .and_then(Value::as_str)
        .filter(|path| !path.trim().is_empty())
        .map(str::to_string)
    {
        attach_provider_image_for_existing_artifact(value, &path);
        return;
    }
    let Some(image_data) = value
        .get("imageBase64")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/screenshot/data").and_then(Value::as_str))
        .filter(|data| !data.trim().is_empty())
    else {
        return;
    };
    let image_data = image_data
        .trim()
        .strip_prefix("data:")
        .and_then(|data_url| data_url.split_once(',').map(|(_, data)| data))
        .unwrap_or(image_data.trim());
    let Ok(bytes) = BASE64_STANDARD.decode(image_data) else {
        return;
    };
    if bytes.is_empty() {
        return;
    }
    let media_type = value
        .pointer("/screenshot/mediaType")
        .or_else(|| value.get("mediaType"))
        .and_then(Value::as_str)
        .unwrap_or("image/png")
        .to_string();
    let extension = image_extension_for_media_type(&media_type);
    let Some(artifact_ref) = write_tool_artifact_bytes_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-browser-screenshot"),
        ToolArtifactKind::BrowserScreenshot,
        extension,
        &media_type,
        &bytes,
    ) else {
        return;
    };
    let width = value
        .get("width")
        .or_else(|| value.pointer("/screenshot/width"))
        .and_then(Value::as_u64);
    let height = value
        .get("height")
        .or_else(|| value.pointer("/screenshot/height"))
        .and_then(Value::as_u64);
    let path = artifact_ref
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let id = artifact_ref
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("browser_screenshot")
        .to_string();
    if let Some(object) = value.as_object_mut() {
        object.insert("screenshotArtifactRef".to_string(), artifact_ref.clone());
        object.insert(
            "providerImage".to_string(),
            json!({
                "path": path,
                "mediaType": media_type,
                "bytes": bytes.len(),
            }),
        );
        object.insert(
            "imageArtifact".to_string(),
            json!({
                "id": id,
                "kind": "image",
                "mediaType": media_type,
                "path": path,
                "width": width,
                "height": height,
                "openTarget": {
                    "kind": "file",
                    "path": path,
                    "mediaType": media_type,
                }
            }),
        );
    }
}

pub(crate) fn attach_workbench_visual_evidence_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    value: &mut Value,
) {
    if display_name != "workbench" || action != "capture_visual_evidence" {
        return;
    }
    if value
        .pointer("/providerImage/path")
        .and_then(Value::as_str)
        .is_some_and(|path| !path.trim().is_empty())
    {
        return;
    }
    let Some(image_data) = value
        .pointer("/capture/imageBase64")
        .and_then(Value::as_str)
        .or_else(|| value.get("imageBase64").and_then(Value::as_str))
        .filter(|data| !data.trim().is_empty())
    else {
        if let Some(path) = value
            .pointer("/imageArtifact/path")
            .and_then(Value::as_str)
            .filter(|path| !path.trim().is_empty())
            .map(str::to_string)
        {
            attach_provider_image_for_existing_artifact(value, &path);
        }
        return;
    };
    let image_data = image_data
        .trim()
        .strip_prefix("data:")
        .and_then(|data_url| data_url.split_once(',').map(|(_, data)| data))
        .unwrap_or(image_data.trim());
    let Ok(bytes) = BASE64_STANDARD.decode(image_data) else {
        return;
    };
    if bytes.is_empty() || bytes.len() as u64 > MAX_IMAGE_EVIDENCE_TOOL_BYTES {
        return;
    }
    let media_type = value
        .pointer("/capture/mimeType")
        .or_else(|| value.get("mimeType"))
        .and_then(Value::as_str)
        .unwrap_or("image/png")
        .to_string();
    if !media_type
        .split(';')
        .next()
        .unwrap_or(&media_type)
        .trim()
        .to_ascii_lowercase()
        .starts_with("image/")
    {
        return;
    }
    let extension = image_extension_for_media_type(&media_type);
    let Some(artifact_ref) = write_tool_artifact_bytes_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-workspace-visual-evidence"),
        ToolArtifactKind::ImageEvidence,
        extension,
        &media_type,
        &bytes,
    ) else {
        return;
    };
    let width = value
        .get("width")
        .or_else(|| value.pointer("/capture/width"))
        .and_then(Value::as_u64);
    let height = value
        .get("height")
        .or_else(|| value.pointer("/capture/height"))
        .and_then(Value::as_u64);
    let visible_only = value
        .get("visibleOnly")
        .or_else(|| value.pointer("/capture/visibleOnly"))
        .and_then(Value::as_bool);
    let path = artifact_ref
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let id = artifact_ref
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("workspace_visual_evidence")
        .to_string();
    if let Some(object) = value.as_object_mut() {
        if let Some(capture) = object.get_mut("capture").and_then(Value::as_object_mut) {
            capture.remove("imageBase64");
        }
        object.remove("imageBase64");
        object.insert("imageEvidenceArtifactRef".to_string(), artifact_ref);
        object.insert(
            "providerImage".to_string(),
            json!({
                "path": path,
                "mediaType": media_type,
                "bytes": bytes.len(),
            }),
        );
        object.insert(
            "imageArtifact".to_string(),
            json!({
                "id": id,
                "kind": "image",
                "mediaType": media_type,
                "path": path,
                "width": width,
                "height": height,
                "visibleOnly": visible_only,
                "openTarget": {
                    "kind": "file",
                    "path": path,
                    "mediaType": media_type,
                },
            }),
        );
    }
}

pub(crate) fn attach_provider_image_for_existing_artifact(value: &mut Value, path: &str) {
    if value
        .pointer("/providerImage/path")
        .and_then(Value::as_str)
        .is_some_and(|path| !path.trim().is_empty())
    {
        return;
    }
    let Ok(Some(artifact)) = resolve_lyra_artifact_path(path) else {
        return;
    };
    let Ok(metadata) = fs::metadata(&artifact.absolute) else {
        return;
    };
    if metadata.len() == 0 || metadata.len() > MAX_IMAGE_EVIDENCE_TOOL_BYTES {
        return;
    }
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "providerImage".to_string(),
            json!({
                "path": path,
                "mediaType": artifact.media_type,
                "bytes": metadata.len(),
            }),
        );
    }
}

pub(crate) fn attach_software_image_evidence_artifact(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    display_name: &str,
    action: &str,
    input: &Value,
    value: &mut Value,
) {
    if display_name != "software"
        || action != "invoke_capability"
        || !software_image_viewer_vision_fallback(input, value)
        || value
            .pointer("/providerImage/path")
            .and_then(Value::as_str)
            .is_some_and(|path| !path.trim().is_empty())
    {
        return;
    }
    let Some(image_artifact) = value
        .pointer("/imageArtifact")
        .or_else(|| value.pointer("/output/imageArtifact"))
        .filter(|artifact| artifact.is_object())
    else {
        return;
    };
    let Some(source_path) = image_artifact
        .get("path")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|path| !path.is_empty())
    else {
        return;
    };
    let media_type = image_artifact
        .get("mediaType")
        .or_else(|| image_artifact.get("mimeType"))
        .and_then(Value::as_str)
        .unwrap_or("image/png")
        .trim()
        .to_string();
    if !media_type
        .split(';')
        .next()
        .unwrap_or(&media_type)
        .trim()
        .to_ascii_lowercase()
        .starts_with("image/")
    {
        return;
    }
    let source = PathBuf::from(source_path);
    let Ok(metadata) = fs::metadata(&source) else {
        return;
    };
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_IMAGE_EVIDENCE_TOOL_BYTES
    {
        return;
    }
    let Ok(bytes) = fs::read(&source) else {
        return;
    };
    if bytes.is_empty() {
        return;
    }
    let extension = image_extension_for_media_type(&media_type);
    let Some(artifact_ref) = write_tool_artifact_bytes_with_kind(
        session_id,
        turn_id,
        &format!("{tool_call_id}-image-evidence"),
        ToolArtifactKind::ImageEvidence,
        extension,
        &media_type,
        &bytes,
    ) else {
        return;
    };
    let path = artifact_ref
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let id = artifact_ref
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("image_evidence")
        .to_string();
    let width = image_artifact.get("width").and_then(Value::as_u64);
    let height = image_artifact.get("height").and_then(Value::as_u64);
    let source_artifact = image_artifact.clone();
    if let Some(object) = value.as_object_mut() {
        object.insert("imageEvidenceArtifactRef".to_string(), artifact_ref);
        object.insert(
            "providerImage".to_string(),
            json!({
                "path": path,
                "mediaType": media_type,
                "bytes": bytes.len(),
            }),
        );
        object.insert(
            "imageArtifact".to_string(),
            json!({
                "id": id,
                "kind": "image",
                "mediaType": media_type,
                "path": path,
                "width": width,
                "height": height,
                "openTarget": {
                    "kind": "file",
                    "path": path,
                    "mediaType": media_type,
                },
                "source": source_artifact,
            }),
        );
    }
}

pub(crate) fn software_image_viewer_vision_fallback(input: &Value, value: &Value) -> bool {
    let software_id = input
        .get("softwareId")
        .or_else(|| value.get("softwareId"))
        .and_then(Value::as_str);
    let action_id = input
        .get("actionId")
        .or_else(|| input.get("capabilityId"))
        .or_else(|| value.get("actionId"))
        .or_else(|| value.get("capabilityId"))
        .and_then(Value::as_str);
    software_id == Some("image-viewer") && action_id == Some("image-viewer.prepareVisionFallback")
}

pub(crate) fn image_extension_for_media_type(media_type: &str) -> &'static str {
    match media_type
        .split(';')
        .next()
        .unwrap_or(media_type)
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/bmp" => "bmp",
        _ => "png",
    }
}
