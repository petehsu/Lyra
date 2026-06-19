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
    Some(json!({
        "id": id,
        "path": path,
        "name": name,
        "preview": preview,
    }))
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
}
