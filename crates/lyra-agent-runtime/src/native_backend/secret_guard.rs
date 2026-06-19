use super::{AgentRuntimeError, AgentRuntimeResult};
use regex::Regex;
use std::sync::OnceLock;

static SECRET_PATTERNS: OnceLock<Vec<Regex>> = OnceLock::new();

fn secret_patterns() -> &'static Vec<Regex> {
    SECRET_PATTERNS.get_or_init(|| {
        [
            r"(?i)\b(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password)\b\s*[:=]\s*\S+",
            r"(?i)\bBearer\s+[A-Za-z0-9._\-]{16,}\b",
            r"\bsk-[A-Za-z0-9]{20,}\b",
            r"\bAKIA[0-9A-Z]{16}\b",
            r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----",
            r"(?i)\b(xox[baprs]-[A-Za-z0-9\-]{10,})\b",
            r"(?i)\bghp_[A-Za-z0-9]{20,}\b",
            r"(?i)\bgho_[A-Za-z0-9]{20,}\b",
        ]
        .into_iter()
        .filter_map(|pattern| Regex::new(pattern).ok())
        .collect()
    })
}

pub(crate) fn contains_secret_material(text: &str) -> bool {
    if text.trim().is_empty() {
        return false;
    }
    secret_patterns()
        .iter()
        .any(|pattern| pattern.is_match(text))
}

pub(crate) fn reject_if_secret_text(text: &str, field: &str) -> AgentRuntimeResult<()> {
    if contains_secret_material(text) {
        return Err(AgentRuntimeError::Core(format!(
            "memory write rejected: {field} appears to contain secret material"
        )));
    }
    Ok(())
}

pub(crate) fn validate_memory_fact(fact: &str) -> AgentRuntimeResult<()> {
    reject_if_secret_text(fact, "fact")
}

pub(crate) fn validate_memory_content_value(content: &serde_json::Value) -> AgentRuntimeResult<()> {
    if let Some(text) = content.as_str() {
        reject_if_secret_text(text, "content")?;
    } else if let Some(object) = content.as_object() {
        for (key, value) in object {
            if let Some(text) = value.as_str() {
                reject_if_secret_text(text, key)?;
            }
        }
    }
    Ok(())
}
