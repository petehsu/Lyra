use super::*;

pub(crate) fn parse_file_citations(payload: &Value) -> Vec<Value> {
    payload
        .get("fileCitations")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(normalize_file_citation)
        .collect()
}

pub(crate) fn apply_file_citations_to_user_message(user_message: &mut Value, citations: &[Value]) {
    if citations.is_empty() {
        return;
    }
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
    metadata.insert("fileAttachments".to_string(), json!(citations));
}

const RASTER_IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "heic", "heif", "tif", "tiff",
];

fn media_type_for_image_path(path: &str) -> &'static str {
    match Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "tif" | "tiff" => "image/tiff",
        _ => "image/png",
    }
}

pub(crate) fn path_is_raster_image(path: &str) -> bool {
    let ext = Path::new(path.trim())
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    RASTER_IMAGE_EXTENSIONS.contains(&ext.as_str())
}

pub(crate) fn file_citation_as_inline_image(citation: &Value) -> Option<Value> {
    let path = citation.get("path").and_then(Value::as_str)?;
    if !path_is_raster_image(path) {
        return None;
    }
    let id = citation.get("id").and_then(Value::as_str)?;
    let name = citation.get("name").and_then(Value::as_str).unwrap_or(path);
    Some(json!({
        "id": id,
        "mediaType": media_type_for_image_path(path),
        "data": "",
        "source": path,
        "label": name,
    }))
}

pub(crate) fn inline_images_from_file_citations(citations: &[Value]) -> Vec<Value> {
    citations
        .iter()
        .filter_map(file_citation_as_inline_image)
        .collect()
}

pub(crate) fn format_file_cite_xml(citation: &Value) -> Option<String> {
    let id = citation.get("id").and_then(Value::as_str)?;
    let path = citation.get("path").and_then(Value::as_str)?;
    let name = citation.get("name").and_then(Value::as_str).unwrap_or(path);
    let preview = citation
        .get("preview")
        .and_then(Value::as_str)
        .unwrap_or(name);
    Some(format!(
        "<lyra-file-cite id=\"{id}\" path=\"{path}\" name=\"{name}\" preview=\"{preview}\" />"
    ))
}

fn normalize_file_citation(raw: Value) -> Option<Value> {
    let path = raw.get("path").and_then(Value::as_str)?;
    let id = raw
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| format!("file-{}", Uuid::new_v4()));
    let name = raw.get("name").and_then(Value::as_str).unwrap_or(path);
    let preview = raw.get("preview").and_then(Value::as_str).unwrap_or(name);
    let mut citation = json!({
        "id": id,
        "path": path,
        "name": name,
        "preview": preview,
    });
    if let Some(kind) = raw.get("kind").and_then(Value::as_str) {
        if kind == "file" || kind == "directory" {
            citation["kind"] = json!(kind);
        }
    }
    Some(citation)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_file_citations_normalizes_payload() {
        let payload = json!({
            "fileCitations": [{
                "id": "file-1",
                "path": "/tmp/example.txt",
                "name": "example.txt"
            }]
        });
        let citations = parse_file_citations(&payload);
        assert_eq!(citations.len(), 1);
        assert_eq!(citations[0]["path"], "/tmp/example.txt");
    }

    #[test]
    fn parse_file_citations_keeps_directory_kind() {
        let payload = json!({
            "fileCitations": [{
                "id": "file-web",
                "path": "/tmp/web",
                "name": "web",
                "kind": "directory"
            }]
        });
        let citations = parse_file_citations(&payload);
        assert_eq!(citations[0]["kind"], "directory");
    }

    #[test]
    fn format_file_cite_xml_includes_metadata() {
        let citation = json!({
            "id": "file-1",
            "path": "/tmp/example.txt",
            "name": "example.txt",
            "preview": "example.txt"
        });
        let xml = format_file_cite_xml(&citation).expect("xml");
        assert!(xml.contains("path=\"/tmp/example.txt\""));
        assert!(xml.contains("name=\"example.txt\""));
    }

    #[test]
    fn file_citation_as_inline_image_promotes_jpeg_paths() {
        let image = file_citation_as_inline_image(&json!({
            "id": "file-1",
            "path": "/tmp/Screenshot.jpg",
            "name": "Screenshot.jpg"
        }))
        .expect("jpeg");
        assert_eq!(image["mediaType"], "image/jpeg");
        assert_eq!(image["source"], "/tmp/Screenshot.jpg");
        assert!(
            file_citation_as_inline_image(&json!({
                "id": "file-2",
                "path": "/tmp/notes.md",
                "name": "notes.md"
            }))
            .is_none()
        );
    }
}
