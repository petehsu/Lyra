use std::path::PathBuf;

use serde_json::Value;

pub fn project_name_from_root(project_root: &str) -> Option<String> {
    let path = PathBuf::from(project_root);
    path.file_name()
        .map(|value| value.to_string_lossy().trim().to_string())
        .filter(|value| !value.is_empty())
}

fn non_empty_string_field(input: &Value, key: &str) -> bool {
    input
        .as_object()
        .and_then(|object| object.get(key))
        .and_then(Value::as_str)
        .map(str::trim)
        .map(|value| !value.is_empty())
        .unwrap_or(false)
}

fn absolutize_tool_path(raw_path: &str, project_root: &str) -> String {
    let candidate = PathBuf::from(raw_path.trim());
    if candidate.is_absolute() {
        return candidate.to_string_lossy().to_string();
    }
    PathBuf::from(project_root)
        .join(candidate)
        .to_string_lossy()
        .to_string()
}

fn ensure_absolute_path_field(
    input: &Value,
    next: &mut serde_json::Map<String, Value>,
    field: &str,
    project_root: &str,
) {
    let maybe_value = input
        .as_object()
        .and_then(|object| object.get(field))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(value) = maybe_value {
        next.insert(
            field.to_string(),
            Value::String(absolutize_tool_path(value, project_root)),
        );
    }
}

pub fn apply_project_scope_to_tool_input(
    tool_name: &str,
    input: &Value,
    project_root: Option<&str>,
) -> Value {
    let Some(project_root) = project_root else {
        return input.clone();
    };
    let Some(object) = input.as_object() else {
        return input.clone();
    };
    let mut next = object.clone();
    match tool_name {
        "filesystem.list" => {
            if !non_empty_string_field(input, "path") {
                next.insert("path".to_string(), Value::String(project_root.to_string()));
            }
        }
        "filesystem.glob" => {
            if !non_empty_string_field(input, "root") {
                next.insert("root".to_string(), Value::String(project_root.to_string()));
            }
        }
        "filesystem.search" => {
            if !non_empty_string_field(input, "path") {
                next.insert("path".to_string(), Value::String(project_root.to_string()));
            }
        }
        "filesystem.read_range"
        | "filesystem.write"
        | "filesystem.edit"
        | "filesystem.multi_edit" => {
            ensure_absolute_path_field(input, &mut next, "path", project_root);
        }
        _ => {}
    }
    match tool_name {
        "filesystem.list"
        | "filesystem.search"
        | "filesystem.read_range"
        | "filesystem.write"
        | "filesystem.edit"
        | "filesystem.multi_edit" => {
            ensure_absolute_path_field(input, &mut next, "path", project_root);
        }
        "filesystem.glob" => {
            ensure_absolute_path_field(input, &mut next, "root", project_root);
        }
        _ => {}
    }

    Value::Object(next)
}
