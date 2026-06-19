use super::*;
use crate::native_backend::tools::resolve_lyra_artifact_path;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};

const MAX_INLINE_IMAGE_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) const INLINE_IMAGE_MARKER_PREFIX: &str = "⟦image:";
pub(crate) const INLINE_IMAGE_MARKER_SUFFIX: &str = "⟧";

pub(crate) fn text_has_inline_image_markers(text: &str) -> bool {
    text.contains(INLINE_IMAGE_MARKER_PREFIX)
}

pub(crate) fn inline_image_marker_ids(text: &str) -> Vec<String> {
    let mut ids = Vec::new();
    let mut rest = text;
    while let Some(marker_start) = rest.find(INLINE_IMAGE_MARKER_PREFIX) {
        let after_prefix = &rest[marker_start + INLINE_IMAGE_MARKER_PREFIX.len()..];
        let Some(suffix_rel) = after_prefix.find(INLINE_IMAGE_MARKER_SUFFIX) else {
            break;
        };
        let image_id = &after_prefix[..suffix_rel];
        if !image_id.is_empty() {
            ids.push(image_id.to_string());
        }
        rest = &after_prefix[suffix_rel + INLINE_IMAGE_MARKER_SUFFIX.len()..];
    }
    ids
}

pub(crate) fn inline_image_is_committable(image: &Value) -> bool {
    let source = image
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let data = image
        .get("data")
        .and_then(Value::as_str)
        .unwrap_or_default();
    !data.trim().is_empty()
        || is_openable_local_image_source(source)
        || source.starts_with("http://")
        || source.starts_with("https://")
        || resolve_lyra_artifact_path(source).ok().flatten().is_some()
}

pub(crate) fn validate_inline_image_turn_commit(
    text: &str,
    inline_images: &[Value],
) -> Result<(), String> {
    let marker_ids = inline_image_marker_ids(text);
    if marker_ids.is_empty() {
        return Ok(());
    }
    if inline_images.is_empty() {
        return Err(
            "Lyra rejected the turn because the message text contains inline image markers but no image attachments were committed."
                .to_string(),
        );
    }
    let image_by_id: std::collections::HashMap<String, &Value> = inline_images
        .iter()
        .filter_map(|image| {
            image
                .get("id")
                .and_then(Value::as_str)
                .map(|id| (id.to_string(), image))
        })
        .collect();
    for marker_id in marker_ids {
        let Some(image) = image_by_id.get(&marker_id) else {
            return Err(format!(
                "Lyra rejected the turn because inline image marker `{marker_id}` has no matching attachment metadata."
            ));
        };
        if !inline_image_is_committable(image) {
            return Err(format!(
                "Lyra rejected the turn because inline image `{marker_id}` has no resolvable path or image data."
            ));
        }
    }
    Ok(())
}

pub(crate) fn parse_inline_images(payload: &Value) -> Vec<Value> {
    payload
        .get("images")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(normalize_inline_image)
        .collect()
}

pub(crate) fn apply_inline_images_to_user_message(user_message: &mut Value, images: &[Value]) {
    if images.is_empty() {
        return;
    }
    let stored = images
        .iter()
        .cloned()
        .map(sanitize_inline_image_for_storage)
        .collect::<Vec<_>>();
    let metadata = user_message
        .get_mut("metadata")
        .and_then(Value::as_object_mut);
    let metadata = match metadata {
        Some(object) => object,
        None => {
            user_message["metadata"] = json!({});
            user_message
                .get_mut("metadata")
                .and_then(Value::as_object_mut)
                .expect("metadata object")
        }
    };
    metadata.insert("inlineImages".to_string(), json!(stored));
}

pub(crate) fn inline_image_provider_blocks(images: &[Value]) -> String {
    images
        .iter()
        .filter_map(format_inline_image_xml)
        .collect::<Vec<_>>()
        .join("\n")
}

pub(crate) fn effective_inline_images_for_user_turn(
    role: &str,
    message_inline_images: &[Value],
    text: &str,
    messages: &[Value],
    message_index: usize,
) -> (Vec<Value>, bool) {
    if role != "user" {
        return (Vec::new(), false);
    }
    if !message_inline_images.is_empty() {
        return (message_inline_images.to_vec(), false);
    }
    if text_has_inline_image_markers(text) {
        return (Vec::new(), false);
    }
    let inherited = recent_user_inline_images_from_history(messages, message_index);
    let did_inherit = !inherited.is_empty();
    (inherited, did_inherit)
}

pub(crate) fn recent_user_inline_images_from_history(
    messages: &[Value],
    before_index: usize,
) -> Vec<Value> {
    messages
        .get(..before_index)
        .unwrap_or(&[])
        .iter()
        .rev()
        .find_map(|message| {
            if message.get("role").and_then(Value::as_str) != Some("user") {
                return None;
            }
            let images = message
                .pointer("/metadata/inlineImages")
                .and_then(Value::as_array)
                .filter(|items| !items.is_empty())?;
            Some(images.clone())
        })
        .unwrap_or_default()
}

pub(crate) fn prepend_inline_images_vision_to_content(
    content: Value,
    images: &[Value],
    options: &crate::context_builder::ProviderContextOptions,
    output: &mut crate::context_builder::ProviderContext,
) -> Value {
    if images.is_empty() {
        return content;
    }
    let image_blocks = images
        .iter()
        .filter_map(format_inline_image_xml)
        .collect::<Vec<_>>()
        .join("\n");
    let hint = "This user turn continues the session's most recent inline image attachment(s). \
Vision input is re-attached here—describe what the image shows from vision. \
Use lyra-image-attach traits for original-file facts such as transparentBackground, hasAlpha, and colorMode. \
When visionComposited=true, vision is a white-backed composite while the source file may still be transparent. \
Do not search browser tabs, Desktop screenshots, or artifacts unless the member asks about those separately. \
Attachment ids (e.g. dropped-image-*) are session-local markers, not artifact ids—never pass them to artifact_read.";
    let anchor_text = if image_blocks.is_empty() {
        hint.to_string()
    } else {
        format!("{hint}\n\n{image_blocks}")
    };
    let mut parts = Vec::new();
    for image in images {
        push_image_part(&mut parts, image, options, output);
    }
    match content {
        Value::String(text) => {
            push_text_part(
                &mut parts,
                if text.trim().is_empty() {
                    anchor_text
                } else {
                    format!("{anchor_text}\n\nUser message:\n{text}")
                },
            );
            Value::Array(parts)
        }
        Value::Array(existing) => {
            push_text_part(&mut parts, anchor_text);
            parts.extend(existing);
            Value::Array(parts)
        }
        other => other,
    }
}

pub(crate) fn expand_inline_image_markers_in_content(
    content: Value,
    images: &[Value],
    options: &crate::context_builder::ProviderContextOptions,
    output: &mut crate::context_builder::ProviderContext,
) -> Value {
    if images.is_empty() {
        return content;
    }
    let image_by_id: std::collections::HashMap<String, &Value> = images
        .iter()
        .filter_map(|image| {
            image
                .get("id")
                .and_then(Value::as_str)
                .map(|id| (id.to_string(), image))
        })
        .collect();
    if image_by_id.is_empty() {
        return content;
    }

    match content {
        Value::String(text) => {
            expand_inline_image_markers_in_text(&text, &image_by_id, options, output)
        }
        Value::Array(ref parts) => {
            let mut expanded = Vec::new();
            for part in parts {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    expanded.extend(expand_inline_image_marker_parts(
                        text,
                        &image_by_id,
                        options,
                        output,
                    ));
                } else {
                    expanded.push(part.clone());
                }
            }
            if expanded.len() == 1
                && let Some(text) = expanded[0].get("text").and_then(Value::as_str)
            {
                Value::String(text.to_string())
            } else if expanded.is_empty() {
                content
            } else {
                Value::Array(expanded)
            }
        }
        other => other,
    }
}

fn expand_inline_image_markers_in_text(
    text: &str,
    image_by_id: &std::collections::HashMap<String, &Value>,
    options: &crate::context_builder::ProviderContextOptions,
    output: &mut crate::context_builder::ProviderContext,
) -> Value {
    let parts = expand_inline_image_marker_parts(text, image_by_id, options, output);
    if parts.len() == 1
        && let Some(single) = parts[0].get("text").and_then(Value::as_str)
    {
        Value::String(single.to_string())
    } else if parts.is_empty() {
        Value::String(text.to_string())
    } else {
        Value::Array(parts)
    }
}

fn expand_inline_image_marker_parts(
    text: &str,
    image_by_id: &std::collections::HashMap<String, &Value>,
    options: &crate::context_builder::ProviderContextOptions,
    output: &mut crate::context_builder::ProviderContext,
) -> Vec<Value> {
    let mut parts = Vec::new();
    let mut rest = text;
    while !rest.is_empty() {
        let Some(marker_start) = rest.find(INLINE_IMAGE_MARKER_PREFIX) else {
            push_text_part(&mut parts, rest.to_string());
            break;
        };
        if marker_start > 0 {
            push_text_part(&mut parts, rest[..marker_start].to_string());
        }
        let after_prefix = &rest[marker_start + INLINE_IMAGE_MARKER_PREFIX.len()..];
        let Some(suffix_rel) = after_prefix.find(INLINE_IMAGE_MARKER_SUFFIX) else {
            push_text_part(&mut parts, rest.to_string());
            break;
        };
        let image_id = &after_prefix[..suffix_rel];
        let marker_end = marker_start
            + INLINE_IMAGE_MARKER_PREFIX.len()
            + suffix_rel
            + INLINE_IMAGE_MARKER_SUFFIX.len();
        if image_id.is_empty() || !image_by_id.contains_key(image_id) {
            push_text_part(&mut parts, rest[..marker_end].to_string());
            rest = &rest[marker_end..];
            continue;
        }
        if let Some(image) = image_by_id.get(image_id) {
            push_image_part(&mut parts, image, options, output);
        }
        rest = &rest[marker_end..];
    }
    parts
}

fn push_text_part(parts: &mut Vec<Value>, text: String) {
    if text.is_empty() {
        return;
    }
    if let Some(last) = parts.last_mut() {
        if let Some(existing) = last.get("text").and_then(Value::as_str) {
            let merged = format!("{existing}{text}");
            *last = json!({ "type": "text", "text": merged });
            return;
        }
    }
    parts.push(json!({ "type": "text", "text": text }));
}

fn push_image_part(
    parts: &mut Vec<Value>,
    image: &Value,
    options: &crate::context_builder::ProviderContextOptions,
    output: &mut crate::context_builder::ProviderContext,
) {
    if options.supports_image_input {
        if let Some(url) = provider_image_url_from_value(image) {
            parts.push(json!({
                "type": "image_url",
                "image_url": { "url": url },
            }));
            return;
        }
        let downgrade = inline_image_downgrade(image, "image_data_unavailable");
        output.input_downgrades.push(downgrade.clone());
        push_text_part(
            parts,
            format!(
                "[Image omitted: {}]",
                downgrade["reason"].as_str().unwrap_or("image unavailable")
            ),
        );
        return;
    }
    let downgrade = inline_image_downgrade(image, "model_does_not_support_image_input");
    output.input_downgrades.push(downgrade.clone());
    push_text_part(
        parts,
        format!(
            "[Image omitted: {}]",
            downgrade["reason"]
                .as_str()
                .unwrap_or("image input unsupported")
        ),
    );
}

pub(crate) fn provider_image_url_from_value(image: &Value) -> Option<String> {
    let media_type = image
        .get("mediaType")
        .or_else(|| image.get("media_type"))
        .and_then(Value::as_str)
        .unwrap_or("image/png");
    let data = image
        .get("data")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if data.starts_with("data:image/")
        || data.starts_with("http://")
        || data.starts_with("https://")
    {
        return Some(data.to_string());
    }
    if !data.trim().is_empty() {
        return Some(format!("data:{media_type};base64,{data}"));
    }
    let source = image
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if source.starts_with("http://") || source.starts_with("https://") {
        return Some(source.to_string());
    }
    if is_openable_local_image_source(source) {
        return read_image_data_url_from_local_path(source, media_type);
    }
    if let Ok(Some(artifact)) = resolve_lyra_artifact_path(source) {
        return read_image_data_url_from_path(&artifact.absolute, &artifact.media_type);
    }
    None
}

fn inline_image_downgrade(image: &Value, reason: &str) -> Value {
    json!({
        "kind": "image_input_downgrade",
        "imageId": image.get("id").cloned().unwrap_or(Value::Null),
        "reason": reason,
    })
}

fn normalize_inline_image(raw: Value) -> Option<Value> {
    let media_type = raw
        .get("mediaType")
        .or_else(|| raw.get("media_type"))
        .and_then(Value::as_str)?;
    let data = raw.get("data").and_then(Value::as_str).unwrap_or_default();
    let source = raw
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let has_data = !data.trim().is_empty();
    let has_openable_source = is_openable_local_image_source(source)
        || resolve_lyra_artifact_path(source).ok().flatten().is_some();
    if media_type.trim().is_empty() || (!has_data && !has_openable_source) {
        return None;
    }
    let id = raw
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("image-{}", Uuid::new_v4()));
    Some(json!({
        "id": id,
        "mediaType": media_type,
        "data": if has_data { Value::String(data.to_string()) } else { Value::Null },
        "label": raw.get("label").cloned().unwrap_or(Value::Null),
        "source": raw.get("source").cloned().unwrap_or(Value::Null),
        "width": raw.get("width").cloned().unwrap_or(Value::Null),
        "height": raw.get("height").cloned().unwrap_or(Value::Null),
        "workspaceTabId": raw.get("workspaceTabId").cloned().unwrap_or(Value::Null),
        "workspaceTabTitle": raw.get("workspaceTabTitle").cloned().unwrap_or(Value::Null),
        "workspaceTabPageKind": raw.get("workspaceTabPageKind").cloned().unwrap_or(Value::Null),
        "workspaceTabAddress": raw.get("workspaceTabAddress").cloned().unwrap_or(Value::Null),
    }))
}

fn sanitize_inline_image_for_storage(mut image: Value) -> Value {
    if let Some(object) = image.as_object_mut() {
        object.remove("data");
    }
    image
}

fn is_placeholder_image_source(source: &str) -> bool {
    matches!(
        source,
        "local-file"
            | "browser-screenshot"
            | "workspace-screenshot"
            | "window-screenshot"
            | "inline-data-url"
            | "screenshot-drop"
    )
}

fn is_openable_local_image_source(source: &str) -> bool {
    let trimmed = source.trim();
    if trimmed.is_empty() || is_placeholder_image_source(trimmed) {
        return false;
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return false;
    }
    trimmed.starts_with('/')
        || trimmed.starts_with("~/")
        || trimmed.starts_with("./")
        || trimmed.starts_with("../")
        || trimmed.starts_with("file://")
        || [
            "apps/",
            "crates/",
            "web/",
            "scripts/",
            "packages/",
            "vendor/",
            "docs/",
            "target/",
            "参考/",
        ]
        .iter()
        .any(|prefix| trimmed.starts_with(prefix))
        || trimmed
            .chars()
            .nth(1)
            .is_some_and(|separator| separator == ':')
}

fn expand_home_path(path: &str) -> String {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    path.to_string()
}

fn read_image_data_url_from_local_path(path: &str, media_type: &str) -> Option<String> {
    let expanded = expand_home_path(path.trim());
    let path = if expanded.starts_with("file://") {
        Url::parse(&expanded)
            .ok()
            .and_then(|url| url.to_file_path().ok())
            .map(|value| value.display().to_string())
            .unwrap_or(expanded)
    } else {
        expanded
    };
    read_image_data_url_from_path(Path::new(&path), media_type)
}

#[derive(Clone, Debug, Default, PartialEq)]
struct InlineImageSourceTraits {
    width: Option<u32>,
    height: Option<u32>,
    color_mode: Option<String>,
    has_alpha: bool,
    transparent_background: bool,
    transparent_pixel_percent: Option<f64>,
    vision_composited: bool,
}

const TRANSPARENT_BACKGROUND_PERCENT_THRESHOLD: f64 = 1.0;

fn read_image_data_url_from_path(path: &Path, media_type: &str) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_INLINE_IMAGE_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let (encoded_bytes, encoded_type) = encode_image_bytes_for_vision(&bytes, media_type)
        .unwrap_or_else(|| (bytes, media_type.to_string()));
    Some(format!(
        "data:{};base64,{}",
        encoded_type,
        BASE64_STANDARD.encode(encoded_bytes)
    ))
}

pub(crate) fn enrich_inline_images_for_provider(images: &[Value]) -> Vec<Value> {
    images
        .iter()
        .cloned()
        .map(enrich_inline_image_for_provider)
        .collect()
}

pub(crate) fn enrich_inline_image_for_provider(image: Value) -> Value {
    let Some(source) = image.get("source").and_then(Value::as_str) else {
        return image;
    };
    let Some(path) = resolve_readable_inline_image_path(source) else {
        return image;
    };
    let Ok(metadata) = fs::metadata(&path) else {
        return image;
    };
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_INLINE_IMAGE_BYTES {
        return image;
    }
    let Ok(bytes) = fs::read(&path) else {
        return image;
    };
    let Some(traits) = inspect_image_bytes(&bytes) else {
        return image;
    };
    merge_inline_image_traits(image, traits)
}

fn resolve_readable_inline_image_path(source: &str) -> Option<PathBuf> {
    if is_openable_local_image_source(source) {
        return Some(PathBuf::from(expand_home_path(source.trim())));
    }
    resolve_lyra_artifact_path(source)
        .ok()
        .flatten()
        .map(|artifact| artifact.absolute)
}

fn inspect_image_bytes(bytes: &[u8]) -> Option<InlineImageSourceTraits> {
    let img = image::load_from_memory(bytes).ok()?;
    let has_alpha = img.color().has_alpha();
    let (width, height) = (img.width(), img.height());
    let (transparent_background, transparent_pixel_percent) = if has_alpha {
        let rgba = img.to_rgba8();
        let total = (rgba.width() as u64).saturating_mul(rgba.height() as u64);
        if total == 0 {
            (false, None)
        } else {
            let transparent = rgba.pixels().filter(|pixel| pixel[3] == 0).count() as u64;
            let percent = (transparent as f64 / total as f64) * 100.0;
            (
                percent >= TRANSPARENT_BACKGROUND_PERCENT_THRESHOLD,
                Some((percent * 10.0).round() / 10.0),
            )
        }
    } else {
        (false, None)
    };
    Some(InlineImageSourceTraits {
        width: Some(width),
        height: Some(height),
        color_mode: Some(color_mode_label(img.color())),
        has_alpha,
        transparent_background,
        transparent_pixel_percent,
        vision_composited: has_alpha,
    })
}

fn merge_inline_image_traits(mut image: Value, traits: InlineImageSourceTraits) -> Value {
    let object = match image.as_object_mut() {
        Some(object) => object,
        None => return image,
    };
    if let Some(width) = traits.width {
        object.insert("width".to_string(), json!(width));
    }
    if let Some(height) = traits.height {
        object.insert("height".to_string(), json!(height));
    }
    if let Some(color_mode) = traits.color_mode {
        object.insert("colorMode".to_string(), json!(color_mode));
    }
    object.insert("hasAlpha".to_string(), json!(traits.has_alpha));
    object.insert(
        "transparentBackground".to_string(),
        json!(traits.transparent_background),
    );
    if let Some(percent) = traits.transparent_pixel_percent {
        object.insert("transparentPixelPercent".to_string(), json!(percent));
    }
    object.insert(
        "visionComposited".to_string(),
        json!(traits.vision_composited),
    );
    image
}

fn color_mode_label(color: image::ColorType) -> String {
    match color {
        image::ColorType::L8 => "L".to_string(),
        image::ColorType::La8 => "LA".to_string(),
        image::ColorType::Rgb8 => "RGB".to_string(),
        image::ColorType::Rgba8 => "RGBA".to_string(),
        image::ColorType::L16 => "L16".to_string(),
        image::ColorType::La16 => "LA16".to_string(),
        image::ColorType::Rgb16 => "RGB16".to_string(),
        image::ColorType::Rgba16 => "RGBA16".to_string(),
        image::ColorType::Rgb32F => "RGB32F".to_string(),
        image::ColorType::Rgba32F => "RGBA32F".to_string(),
        _ => "unknown".to_string(),
    }
}

/// Flatten RGBA/transparency onto white before vision providers consume the image.
/// Many vision models render transparent pixels as blank white, hiding black-on-transparent SVG exports.
fn encode_image_bytes_for_vision(bytes: &[u8], media_type: &str) -> Option<(Vec<u8>, String)> {
    let img = image::load_from_memory(bytes).ok()?;
    if !img.color().has_alpha() {
        return None;
    }
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut canvas = image::RgbaImage::from_pixel(width, height, image::Rgba([255, 255, 255, 255]));
    image::imageops::overlay(&mut canvas, &rgba, 0, 0);
    let mut encoded = Vec::new();
    image::DynamicImage::ImageRgba8(canvas)
        .write_to(
            &mut std::io::Cursor::new(&mut encoded),
            vision_output_format(media_type),
        )
        .ok()?;
    Some((encoded, vision_output_media_type(media_type).to_string()))
}

fn vision_output_format(media_type: &str) -> image::ImageFormat {
    match media_type {
        "image/jpeg" | "image/jpg" => image::ImageFormat::Jpeg,
        "image/webp" => image::ImageFormat::WebP,
        _ => image::ImageFormat::Png,
    }
}

fn vision_output_media_type(media_type: &str) -> &'static str {
    match media_type {
        "image/jpeg" | "image/jpg" => "image/jpeg",
        "image/webp" => "image/webp",
        _ => "image/png",
    }
}

fn format_inline_image_trait_attributes(image: &Value) -> String {
    let mut attrs = Vec::new();
    if let Some(width) = image.get("width").and_then(Value::as_u64) {
        attrs.push(format!("width=\"{width}\""));
    }
    if let Some(height) = image.get("height").and_then(Value::as_u64) {
        attrs.push(format!("height=\"{height}\""));
    }
    if let Some(color_mode) = image.get("colorMode").and_then(Value::as_str) {
        attrs.push(format!("colorMode=\"{color_mode}\""));
    }
    if let Some(has_alpha) = image.get("hasAlpha").and_then(Value::as_bool) {
        attrs.push(format!("hasAlpha=\"{has_alpha}\""));
    }
    if let Some(transparent_background) =
        image.get("transparentBackground").and_then(Value::as_bool)
    {
        attrs.push(format!(
            "transparentBackground=\"{transparent_background}\""
        ));
    }
    if let Some(percent) = image.get("transparentPixelPercent").and_then(Value::as_f64) {
        attrs.push(format!("transparentPixelPercent=\"{percent}\""));
    }
    if let Some(vision_composited) = image.get("visionComposited").and_then(Value::as_bool) {
        attrs.push(format!("visionComposited=\"{vision_composited}\""));
    }
    if attrs.is_empty() {
        String::new()
    } else {
        format!(" {}", attrs.join(" "))
    }
}

pub(crate) fn format_inline_image_xml(image: &Value) -> Option<String> {
    let id = image.get("id").and_then(Value::as_str)?;
    let source = image
        .get("source")
        .and_then(Value::as_str)
        .unwrap_or("local-file");
    let label = image
        .get("label")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let workspace_tab_id = image
        .get("workspaceTabId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let workspace_tab_title = image
        .get("workspaceTabTitle")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let workspace_tab_page_kind = image
        .get("workspaceTabPageKind")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let workspace_tab_address = image
        .get("workspaceTabAddress")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let trait_attrs = format_inline_image_trait_attributes(image);
    Some(format!(
        "<lyra-image-attach id=\"{id}\" source=\"{source}\" label=\"{label}\" workspaceTabId=\"{workspace_tab_id}\" workspaceTabTitle=\"{workspace_tab_title}\" workspaceTabPageKind=\"{workspace_tab_page_kind}\" workspaceTabAddress=\"{workspace_tab_address}\"{trait_attrs} />"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_inline_image_requires_payload() {
        let image = normalize_inline_image(json!({
            "id": "img-1",
            "mediaType": "image/png",
            "data": "abc",
            "label": "Shot.png",
            "source": "browser-screenshot"
        }))
        .expect("image");
        assert_eq!(image["id"], "img-1");
        assert_eq!(image["source"], "browser-screenshot");
    }

    #[test]
    fn normalize_inline_image_accepts_path_only_metadata() {
        let image = normalize_inline_image(json!({
            "id": "img-path",
            "mediaType": "image/png",
            "label": "Shot.png",
            "source": "/tmp/example-shot.png"
        }))
        .expect("image");
        assert_eq!(image["id"], "img-path");
        assert_eq!(image["source"], "/tmp/example-shot.png");
        assert!(image.get("data").is_none() || image["data"].is_null());
    }

    #[test]
    fn validate_inline_image_turn_commit_rejects_markers_without_metadata() {
        let err = validate_inline_image_turn_commit("Look at ⟦image:img-1⟧ please", &[])
            .expect_err("missing metadata");
        assert!(err.contains("no image attachments"));
    }

    #[test]
    fn validate_inline_image_turn_commit_accepts_path_only_metadata() {
        validate_inline_image_turn_commit(
            "Look at ⟦image:img-1⟧ please",
            &[json!({
                "id": "img-1",
                "mediaType": "image/png",
                "source": "/tmp/example-shot.png"
            })],
        )
        .expect("valid commit");
    }

    #[test]
    fn sanitize_inline_image_for_storage_removes_data() {
        let stored = sanitize_inline_image_for_storage(json!({
            "id": "img-1",
            "mediaType": "image/png",
            "data": "abc",
            "source": "/tmp/example-shot.png"
        }));
        assert!(stored.get("data").is_none());
        assert_eq!(stored["source"], "/tmp/example-shot.png");
    }

    #[test]
    fn enrich_inline_image_for_provider_records_transparency_traits() {
        let rgba = image::RgbaImage::from_fn(16, 16, |x, y| {
            if y == 8 && (4..12).contains(&x) {
                image::Rgba([0, 0, 0, 255])
            } else {
                image::Rgba([0, 0, 0, 0])
            }
        });
        let dir = env::temp_dir().join(format!("lyra-inline-traits-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("alpha.png");
        image::DynamicImage::ImageRgba8(rgba)
            .save(&path)
            .expect("save");

        let enriched = enrich_inline_image_for_provider(json!({
            "id": "img-alpha",
            "mediaType": "image/png",
            "source": path.display().to_string()
        }));
        assert_eq!(enriched["hasAlpha"], true);
        assert_eq!(enriched["transparentBackground"], true);
        assert_eq!(enriched["visionComposited"], true);
        assert_eq!(enriched["colorMode"], "RGBA");
        let xml = format_inline_image_xml(&enriched).expect("xml");
        assert!(xml.contains("transparentBackground=\"true\""));
        assert!(xml.contains("visionComposited=\"true\""));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn encode_image_bytes_for_vision_flattens_rgba_on_white() {
        let mut rgba = image::RgbaImage::new(8, 8);
        for pixel in rgba.pixels_mut() {
            *pixel = image::Rgba([0, 0, 0, 0]);
        }
        rgba.put_pixel(4, 4, image::Rgba([0, 0, 0, 255]));
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgba8(rgba)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("png");
        let (flattened, media_type) =
            encode_image_bytes_for_vision(&bytes, "image/png").expect("flatten");
        assert_eq!(media_type, "image/png");
        let decoded = image::load_from_memory(&flattened)
            .expect("decoded")
            .to_rgba8();
        assert_eq!(decoded.get_pixel(4, 4).0, [0, 0, 0, 255]);
        assert_eq!(decoded.get_pixel(0, 0).0, [255, 255, 255, 255]);
    }

    #[test]
    fn provider_image_url_from_value_reads_local_path() {
        let dir = env::temp_dir().join(format!("lyra-inline-image-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join("sample.png");
        fs::write(&path, b"\x89PNG\r\n\x1a\n").expect("write sample");
        let url = provider_image_url_from_value(&json!({
            "id": "img-1",
            "mediaType": "image/png",
            "source": path.display().to_string()
        }))
        .expect("data url");
        assert!(url.starts_with("data:image/png;base64,"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn effective_inline_images_inherits_from_prior_user_turn_without_regex() {
        let prior = vec![json!({
            "id": "dropped-image-abc",
            "mediaType": "image/jpeg",
            "source": "/tmp/prior.jpg"
        })];
        let messages = vec![
            json!({
                "role": "user",
                "text": "look ⟦image:dropped-image-abc⟧",
                "metadata": { "inlineImages": prior }
            }),
            json!({ "role": "assistant", "text": "I see a photo." }),
            json!({ "role": "user", "text": "这张图片是什么" }),
        ];
        let (inherited, did_inherit) =
            effective_inline_images_for_user_turn("user", &[], "这张图片是什么", &messages, 2);
        assert!(did_inherit);
        assert_eq!(inherited.len(), 1);
        assert_eq!(inherited[0]["id"], "dropped-image-abc");

        let (unchanged, did_inherit_new) = effective_inline_images_for_user_turn(
            "user",
            &prior,
            "look ⟦image:dropped-image-abc⟧",
            &messages,
            0,
        );
        assert!(!did_inherit_new);
        assert_eq!(unchanged.len(), 1);
    }

    #[test]
    fn expand_inline_image_markers_interleaves_vision_parts() {
        let images = vec![json!({
            "id": "img-1",
            "mediaType": "image/png",
            "data": "AAAA"
        })];
        let image_by_id = images
            .iter()
            .filter_map(|image| {
                image
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|id| (id.to_string(), image))
            })
            .collect();
        let mut output = crate::context_builder::ProviderContext::default();
        let expanded = expand_inline_image_markers_in_text(
            "Look at ⟦image:img-1⟧ please",
            &image_by_id,
            &crate::context_builder::ProviderContextOptions {
                supports_image_input: true,
                ..crate::context_builder::ProviderContextOptions::default()
            },
            &mut output,
        );
        let parts = expanded.as_array().expect("parts");
        assert_eq!(parts.len(), 3);
        assert_eq!(
            parts[0].pointer("/text").and_then(Value::as_str),
            Some("Look at ")
        );
        assert!(parts[1].pointer("/image_url/url").is_some());
        assert_eq!(
            parts[2].pointer("/text").and_then(Value::as_str),
            Some(" please")
        );
    }
}
