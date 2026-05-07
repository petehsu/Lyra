use super::*;

pub fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4())
}

pub fn resolve_storage_root(value: Option<&str>) -> Result<PathBuf> {
    if let Some(root) = value.and_then(trim_to_string) {
        return Ok(PathBuf::from(root));
    }
    if let Ok(root) = env::var("LYRA_AI_ROOT") {
        if let Some(root) = trim_to_string(&root) {
            return Ok(PathBuf::from(root));
        }
    }
    let home = dirs::home_dir().ok_or_else(|| anyhow!("home directory is unavailable"))?;
    Ok(home.join(".lyra").join("modules").join("ai"))
}

pub fn trim_to_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn json_string<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).context("failed to encode AI JSON field")
}

pub fn parse_json_or<T: for<'de> Deserialize<'de>>(value: String, fallback: T) -> T {
    serde_json::from_str(&value).unwrap_or(fallback)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub(super) fn preview_text(value: &str, max_chars: usize) -> String {
    let mut preview = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        preview.push_str("...");
    }
    preview
}

pub(super) fn merge_string_refs(existing: &[String], next: &[String]) -> Vec<String> {
    let mut refs = existing.to_vec();
    for value in next {
        if value.trim().is_empty() == false && refs.iter().any(|item| item == value) == false {
            refs.push(value.clone());
        }
    }
    refs
}

pub(super) fn merge_todo_blocker_json(existing: &Value, next: &Value) -> Value {
    let mut blockers = existing.as_array().cloned().unwrap_or_else(|| {
        if existing.is_null() || existing == &json!({}) {
            Vec::new()
        } else {
            vec![existing.clone()]
        }
    });
    if next.is_null() == false && blockers.iter().any(|value| value == next) == false {
        blockers.push(next.clone());
    }
    json!(blockers)
}

pub(super) fn parse_json_vec_string(value: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(value).unwrap_or_default()
}

pub(super) fn parse_json_vec_value(value: &str) -> Vec<Value> {
    serde_json::from_str::<Vec<Value>>(value).unwrap_or_default()
}

pub(super) fn normalize_todo_kind(kind: &str) -> &'static str {
    match kind.trim() {
        "plan_bound" => "plan_bound",
        "recovery" => "recovery",
        _ => "mini",
    }
}

pub(super) fn normalize_risk_level(risk_level: &str) -> &'static str {
    match risk_level.trim() {
        "low" => "low",
        "high" => "high",
        "critical" => "critical",
        _ => "medium",
    }
}

pub(super) fn normalize_todo_status(status: &str) -> &'static str {
    match status.trim() {
        "in_progress" => "in_progress",
        "completed" => "completed",
        "blocked" => "blocked",
        "failed" => "failed",
        "skipped" => "skipped",
        _ => "pending",
    }
}

pub(super) fn todo_status_priority(status: &str) -> u8 {
    match status {
        "blocked" => 0,
        "in_progress" => 1,
        "pending" => 2,
        "failed" => 3,
        "completed" => 4,
        "skipped" => 5,
        _ => 6,
    }
}

pub(super) fn value_string_array(value: &Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

pub fn project_name_from_root(project_root: Option<&str>) -> Option<String> {
    let root = project_root.and_then(trim_to_string)?;
    Path::new(&root)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToString::to_string)
}
