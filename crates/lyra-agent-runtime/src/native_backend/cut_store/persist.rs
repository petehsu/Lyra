use super::super::{session_store::session_dir, token_estimate};
use super::{
    AgentRuntimeError, AgentRuntimeResult, Value,
    dedupe::{collect_session_hashes, extract_refs, normalize_message},
    iso_ms, now,
    schema::*,
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, path::PathBuf};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CutPackManifestEntry {
    pub pack_id: String,
    pub path: String,
    pub ordinal_start: i64,
    pub ordinal_end: i64,
    pub token_total: i64,
    pub msg_count: i64,
    pub created_at_iso: String,
    #[serde(default)]
    pub deduped_msg_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CutManifest {
    pub session_id: String,
    #[serde(default)]
    pub packs: Vec<CutPackManifestEntry>,
}

#[derive(Clone, Debug)]
pub(crate) struct CutPackRef {
    pub pack_id: String,
    pub path: String,
    pub ordinal_start: i64,
    pub ordinal_end: i64,
    pub token_total: i64,
    pub msg_count: i64,
    pub deduped_msg_ids: Vec<String>,
}

pub(crate) struct CutMessageEntry {
    pub message: Value,
    pub ordinal: i64,
}

pub(crate) fn load_manifest(root: &Path, session_id: &str) -> AgentRuntimeResult<CutManifest> {
    let path = manifest_path(root, session_id);
    if !path.is_file() {
        return Ok(CutManifest {
            session_id: session_id.to_string(),
            packs: Vec::new(),
        });
    }
    let raw =
        fs::read_to_string(&path).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let mut manifest: CutManifest =
        serde_json::from_str(&raw).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    manifest.session_id = session_id.to_string();
    Ok(manifest)
}

pub(crate) fn save_manifest(root: &Path, manifest: &CutManifest) -> AgentRuntimeResult<()> {
    let dir = cuts_dir(root, &manifest.session_id);
    fs::create_dir_all(&dir).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let raw = serde_json::to_string_pretty(manifest)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    fs::write(manifest_path(root, &manifest.session_id), raw)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(())
}

pub(crate) fn append_cut_pack(
    root: &Path,
    session_id: &str,
    entries: &[CutMessageEntry],
) -> AgentRuntimeResult<CutPackRef> {
    if entries.is_empty() {
        return Err(AgentRuntimeError::Core(
            "cut pack requires at least one message".to_string(),
        ));
    }

    let dir = cuts_dir(root, session_id);
    fs::create_dir_all(&dir).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    let manifest = load_manifest(root, session_id)?;
    let pack_index = manifest.packs.len() + 1;
    let pack_id = format!("cut_pack_{pack_index:04}");
    let pack_filename = format!("{pack_id}.sqlite");
    let pack_path = dir.join(&pack_filename);

    let mut known_hashes = collect_session_hashes(root, session_id)?;
    let conn = open_cut_pack(&pack_path)?;

    let ordinal_start = entries.first().map(|entry| entry.ordinal).unwrap_or(0);
    let ordinal_end = entries
        .last()
        .map(|entry| entry.ordinal)
        .unwrap_or(ordinal_start);
    let created_at_iso = now();
    let created_at_ms = iso_ms(&created_at_iso);

    let mut token_total = 0_i64;
    let mut msg_count = 0_i64;
    let mut deduped_msg_ids = Vec::new();

    let tx = conn
        .unchecked_transaction()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    for entry in entries {
        let msg_id = entry
            .message
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| format!("{session_id}:cut:{pack_id}:{}", entry.ordinal));
        let role = entry
            .message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("runtime")
            .to_string();
        let turn_index = entry
            .message
            .get("turnIndex")
            .or_else(|| entry.message.pointer("/metadata/turnIndex"))
            .and_then(Value::as_i64);
        let normalized = normalize_message(&entry.message);
        token_total += token_estimate::estimate_message_tokens(&entry.message) as i64;

        if known_hashes.contains(&normalized.content_hash) {
            deduped_msg_ids.push(msg_id);
            continue;
        }
        known_hashes.insert(normalized.content_hash.clone());

        let content_raw = serde_json::to_string(&entry.message)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        tx.execute(
            "INSERT INTO cut_payload (msg_id, ordinal, turn_index, role, content_raw)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![msg_id, entry.ordinal, turn_index, role, content_raw],
        )
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

        for (ref_kind, ref_value) in extract_refs(&entry.message) {
            tx.execute(
                "INSERT OR IGNORE INTO cut_refs (msg_id, ref_kind, ref_value) VALUES (?1, ?2, ?3)",
                params![msg_id, ref_kind, ref_value],
            )
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        }

        tx.execute(
            "INSERT INTO cut_normalized (msg_id, content_kind, normalized_text, content_hash)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                msg_id,
                normalized.content_kind.as_str(),
                normalized.normalized_text,
                normalized.content_hash
            ],
        )
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

        msg_count += 1;
    }

    tx.execute(
        "INSERT INTO cut_meta (pack_id, session_id, ordinal_start, ordinal_end, token_total, msg_count, created_at_ms, created_at_iso)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            pack_id,
            session_id,
            ordinal_start,
            ordinal_end,
            token_total,
            msg_count,
            created_at_ms,
            created_at_iso
        ],
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    tx.commit()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    Ok(CutPackRef {
        pack_id,
        path: pack_filename,
        ordinal_start,
        ordinal_end,
        token_total,
        msg_count,
        deduped_msg_ids,
    })
}

pub(crate) fn update_manifest_with_pack(
    root: &Path,
    session_id: &str,
    pack: &CutPackRef,
) -> AgentRuntimeResult<()> {
    let mut manifest = load_manifest(root, session_id)?;
    manifest.packs.push(CutPackManifestEntry {
        pack_id: pack.pack_id.clone(),
        path: pack.path.clone(),
        ordinal_start: pack.ordinal_start,
        ordinal_end: pack.ordinal_end,
        token_total: pack.token_total,
        msg_count: pack.msg_count,
        created_at_iso: now(),
        deduped_msg_ids: pack.deduped_msg_ids.clone(),
    });
    save_manifest(root, &manifest)
}

pub(crate) fn delete_cuts(root: &Path, session_id: &str) -> AgentRuntimeResult<()> {
    let dir = cuts_dir(root, session_id);
    if dir.exists() {
        fs::remove_dir_all(&dir).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    }
    Ok(())
}

pub(crate) fn manifest_path(root: &Path, session_id: &str) -> PathBuf {
    cuts_dir(root, session_id).join("cuts.manifest.json")
}

pub(crate) fn cuts_dir(root: &Path, session_id: &str) -> PathBuf {
    session_dir(root, session_id).join("cuts")
}

pub(crate) fn read_cut_messages(
    root: &Path,
    session_id: &str,
    msg_ids: &[String],
) -> AgentRuntimeResult<Vec<Value>> {
    if msg_ids.is_empty() {
        return Ok(Vec::new());
    }
    let manifest = load_manifest(root, session_id)?;
    let dir = cuts_dir(root, session_id);
    let id_set: std::collections::HashSet<&str> =
        msg_ids.iter().map(String::as_str).collect();
    let mut found: std::collections::HashMap<String, Value> =
        std::collections::HashMap::new();

    for entry in &manifest.packs {
        if found.len() >= id_set.len() {
            break;
        }
        let pack_path = dir.join(&entry.path);
        if !pack_path.is_file() {
            continue;
        }
        let conn = open_cut_pack(&pack_path)?;
        let placeholders = msg_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT msg_id, content_raw FROM cut_payload WHERE msg_id IN ({placeholders})"
        );
        let params: Vec<&dyn rusqlite::ToSql> = msg_ids
            .iter()
            .map(|id| id as &dyn rusqlite::ToSql)
            .collect();
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| AgentRuntimeError::Core(e.to_string()))?;
        let rows = stmt
            .query_map(params.as_slice(), |row| {
                let msg_id: String = row.get(0)?;
                let content_raw: String = row.get(1)?;
                Ok((msg_id, content_raw))
            })
            .map_err(|e| AgentRuntimeError::Core(e.to_string()))?;
        for row in rows {
            let (msg_id, content_raw) =
                row.map_err(|e| AgentRuntimeError::Core(e.to_string()))?;
            if !id_set.contains(msg_id.as_str()) {
                continue;
            }
            let value: Value = serde_json::from_str(&content_raw)
                .map_err(|e| AgentRuntimeError::Core(e.to_string()))?;
            found.insert(msg_id, value);
        }
    }

    let mut result = Vec::with_capacity(msg_ids.len());
    for id in msg_ids {
        if let Some(value) = found.remove(id) {
            result.push(value);
        }
    }
    Ok(result)
}
