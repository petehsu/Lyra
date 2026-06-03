use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretRef {
    pub ref_id: String,
    pub label: Option<String>,
    pub purpose: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SensitiveText {
    pub plaintext: Option<String>,
    pub secret_refs: Vec<SecretRef>,
}

impl SensitiveText {
    pub fn plain(value: impl Into<String>) -> Self {
        Self {
            plaintext: Some(value.into()),
            secret_refs: Vec::new(),
        }
    }

    pub fn refs(secret_refs: Vec<SecretRef>) -> Self {
        Self {
            plaintext: None,
            secret_refs,
        }
    }

    pub fn has_secret_refs(&self) -> bool {
        !self.secret_refs.is_empty()
    }
}

pub fn bracketed_paste_payload(value: &str) -> String {
    format!("\x1b[200~{value}\x1b[201~")
}

pub fn secret_ref_preview(secret_refs: &[SecretRef]) -> String {
    if secret_refs.is_empty() {
        return String::new();
    }
    secret_refs
        .iter()
        .map(|item| {
            item.label
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("[secret:{value}]"))
                .unwrap_or_else(|| "[secret]".to_string())
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn redact_plaintext(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.len() <= 8 {
        return "[redacted]".to_string();
    }
    let prefix = trimmed.chars().take(4).collect::<String>();
    format!("{prefix}...[redacted]")
}

pub fn redacted_preview(input: &SensitiveText) -> String {
    if input.has_secret_refs() {
        return secret_ref_preview(&input.secret_refs);
    }
    input
        .plaintext
        .as_deref()
        .map(redact_plaintext)
        .unwrap_or_default()
}

pub fn assert_no_secret_material_in_journal(
    journal_preview: &str,
    input: &SensitiveText,
) -> Result<(), String> {
    if let Some(plaintext) = input.plaintext.as_deref() {
        if !plaintext.is_empty() && journal_preview.contains(plaintext) {
            return Err("journal preview contains plaintext secret material".to_string());
        }
    }
    for secret_ref in &input.secret_refs {
        if journal_preview.contains(&secret_ref.ref_id) {
            return Err("journal preview contains a raw secret ref id".to_string());
        }
    }
    Ok(())
}
