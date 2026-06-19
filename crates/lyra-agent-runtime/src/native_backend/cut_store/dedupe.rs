use super::{
    AgentRuntimeError, AgentRuntimeResult, Value,
    persist::{cuts_dir, load_manifest},
    schema,
};
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, path::Path};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum ContentKind {
    Code,
    Command,
    Path,
    Config,
    Prose,
}

impl ContentKind {
    pub(super) fn as_str(&self) -> &'static str {
        match self {
            Self::Code => "code",
            Self::Command => "command",
            Self::Path => "path",
            Self::Config => "config",
            Self::Prose => "prose",
        }
    }
}

pub(super) struct NormalizedEntry {
    pub content_kind: ContentKind,
    pub normalized_text: String,
    pub content_hash: String,
}

pub(super) fn normalize_message(message: &Value) -> NormalizedEntry {
    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("runtime");
    let text = message_text(message);
    let content_kind = classify_content(role, &text);
    let normalized_text = match content_kind {
        ContentKind::Prose => fold_prose(&text),
        _ => text,
    };
    NormalizedEntry {
        content_kind,
        normalized_text: normalized_text.clone(),
        content_hash: hash_text(&normalized_text),
    }
}

pub(super) fn hash_text(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    format!("{:x}", digest)
}

pub(super) fn load_known_hashes(conn: &Connection) -> AgentRuntimeResult<HashSet<String>> {
    let mut hashes = HashSet::new();
    let mut statement = conn
        .prepare("SELECT content_hash FROM cut_normalized")
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    for row in rows {
        hashes.insert(row.map_err(|error| AgentRuntimeError::Core(error.to_string()))?);
    }
    Ok(hashes)
}

pub(super) fn collect_session_hashes(
    root: &Path,
    session_id: &str,
) -> AgentRuntimeResult<HashSet<String>> {
    let manifest = load_manifest(root, session_id)?;
    let mut hashes = HashSet::new();
    for pack in &manifest.packs {
        let pack_path = cuts_dir(root, session_id).join(&pack.path);
        if !pack_path.is_file() {
            continue;
        }
        let conn = schema::open_cut_pack(&pack_path)?;
        hashes.extend(load_known_hashes(&conn)?);
    }
    Ok(hashes)
}

fn classify_content(role: &str, text: &str) -> ContentKind {
    if role == "tool" {
        if text.contains('/') && (text.contains('.') || text.contains("src/")) {
            return ContentKind::Path;
        }
        if text.starts_with('$') || text.contains("npm ") || text.contains("cargo ") {
            return ContentKind::Command;
        }
        if text.contains('{') && text.contains('}') {
            return ContentKind::Config;
        }
        if text.contains("fn ") || text.contains("function ") || text.contains("class ") {
            return ContentKind::Code;
        }
    }
    ContentKind::Prose
}

fn fold_prose(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn message_text(message: &Value) -> String {
    message
        .get("text")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| serde_json::to_string(message).unwrap_or_else(|_| String::from("{}")))
}

pub(super) fn extract_refs(message: &Value) -> Vec<(String, String)> {
    let mut refs = Vec::new();
    let msg_id = message
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if msg_id.is_empty() {
        return refs;
    }
    if let Some(metadata) = message.get("metadata").and_then(Value::as_object) {
        for (key, value) in metadata {
            if key.contains("ref") || key.contains("cite") || key.contains("lineage") {
                if let Some(text) = value.as_str() {
                    refs.push((key.clone(), text.to_string()));
                }
            }
        }
    }
    refs
}
