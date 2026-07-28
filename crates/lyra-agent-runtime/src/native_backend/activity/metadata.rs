use super::*;

pub(super) fn inferred_activity_title(tool_path: Option<&str>, action: &str) -> Option<String> {
    match (tool_path, action) {
        (Some(path), _) if path.starts_with("/tools/filesystem/") => Some(
            match action {
                "read" => "Read file",
                "list" => "Listed files",
                "glob" => "Found files",
                "write" => "Wrote file",
                "edit" | "strict_edit" | "multiedit" | "apply_patch" => "Edited file",
                _ => return None,
            }
            .to_string(),
        ),
        _ => None,
    }
}

pub(super) fn inferred_activity_kind(tool_path: Option<&str>, action: &str) -> Option<String> {
    match (tool_path, action) {
        (Some(path), "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch")
            if path.starts_with("/tools/filesystem/") =>
        {
            Some("edit".to_string())
        }
        (Some(path), "read") if path.starts_with("/tools/filesystem/") => Some("read".to_string()),
        (Some(path), "list" | "glob") if path.starts_with("/tools/filesystem/") => {
            Some("search".to_string())
        }
        _ => None,
    }
}

pub(super) fn inferred_renderer_hint(tool_path: Option<&str>, action: &str) -> Option<String> {
    inferred_activity_kind(tool_path, action)
}

pub(super) fn filesystem_operation_from_tool_path(path: &str) -> Option<&'static str> {
    match path {
        "/tools/filesystem/write_file" => Some("write"),
        "/tools/filesystem/edit_file" => Some("edit"),
        "/tools/filesystem/multi_edit" => Some("multiedit"),
        "/tools/filesystem/apply_patch" => Some("apply_patch"),
        _ => None,
    }
}

pub(super) fn activity_artifact_refs(output: &Value) -> Value {
    let mut refs = Vec::new();
    for source in [Some(output), output.get("raw")] {
        let Some(source) = source else {
            continue;
        };
        for key in [
            "artifactRef",
            "rawArtifactRef",
            "diffArtifactRef",
            "projectionRef",
            "dataRef",
            "stdoutRef",
            "stderrRef",
            "stdoutArtifactRef",
            "stderrArtifactRef",
            "logArtifactRef",
            "pageArtifactRef",
            "screenshotArtifactRef",
            "pageshotArtifactRef",
        ] {
            if let Some(value) = source.get(key).filter(|value| value.is_object()) {
                refs.push(value.clone());
            }
        }
        if let Some(values) = source
            .get("artifactRefs")
            .or_else(|| source.get("artifacts"))
            .and_then(Value::as_array)
        {
            refs.extend(values.iter().filter(|value| value.is_object()).cloned());
        }
    }
    Value::Array(dedupe_activity_values(refs))
}

pub(super) fn activity_changes(
    tool_path: Option<&str>,
    manifest: Option<&lyra_tool_fs_core::ToolManifest>,
    output: &Value,
) -> Value {
    let manifest_domain = manifest
        .map(|manifest| manifest.domain.as_str())
        .or_else(|| tool_path.and_then(|path| path.trim_start_matches("/tools/").split('/').next()))
        .unwrap_or_default();
    let manifest_operation = manifest
        .map(|manifest| manifest.operation.as_str())
        .or_else(|| tool_path.and_then(filesystem_operation_from_tool_path))
        .unwrap_or_default();
    if manifest_domain != "filesystem" {
        return Value::Array(Vec::new());
    }
    let changed_files = output
        .pointer("/raw/changedFiles")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if changed_files.is_empty() {
        return Value::Array(Vec::new());
    }
    let diff_ref = output
        .pointer("/raw/diffArtifactRef")
        .filter(|value| value.is_object())
        .cloned();
    Value::Array(
        changed_files
            .into_iter()
            .map(|file| {
                let operation = file
                    .get("operation")
                    .and_then(Value::as_str)
                    .unwrap_or(manifest_operation)
                    .to_string();
                let path = file.get("path").and_then(Value::as_str).map(str::to_string);
                json!({
                    "schemaVersion": lyra_tool_fs_core::TOOL_FS_SCHEMA_VERSION,
                    "changeId": format!("change-{}", Uuid::new_v4()),
                    "kind": "file",
                    "operation": operation,
                    "path": path,
                    "summary": "Filesystem mutation executed.",
                    "detail": file,
                    "reversible": true,
                    "beforeRef": Value::Null,
                    "afterRef": Value::Null,
                    "diffRef": diff_ref.clone(),
                    "toolPath": tool_path,
                })
            })
            .collect(),
    )
}

pub(super) fn dedupe_activity_values(values: Vec<Value>) -> Vec<Value> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|value| {
            serde_json::to_string(value)
                .ok()
                .is_none_or(|key| seen.insert(key))
        })
        .collect()
}
