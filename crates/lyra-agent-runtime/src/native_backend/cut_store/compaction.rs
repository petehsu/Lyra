use super::{
    AgentRuntimeError, AgentRuntimeResult, Value, cuts_dir, load_manifest,
    persist::{CutPackManifestEntry, save_manifest},
};
use serde_json::json;
use std::{fs, path::Path};

pub(crate) const CUTS_SIZE_TRIGGER_BYTES: u64 = 48 * 1024 * 1024;
const MIN_PACKS_FOR_COMPACTION: usize = 4;

pub(crate) fn maybe_compact_cuts(
    root: &Path,
    session_id: &str,
) -> AgentRuntimeResult<Option<Value>> {
    let dir = cuts_dir(root, session_id);
    if !dir.is_dir() {
        return Ok(None);
    }
    let size = directory_size(&dir)?;
    if size < CUTS_SIZE_TRIGGER_BYTES {
        return Ok(None);
    }
    let mut manifest = load_manifest(root, session_id)?;
    if manifest.packs.len() < MIN_PACKS_FOR_COMPACTION {
        return Ok(None);
    }

    let head = manifest.packs.first().cloned().expect("head pack");
    let tail = manifest.packs.last().cloned().expect("tail pack");
    if manifest.packs.len() <= 2 {
        return Ok(None);
    }
    let middle = manifest.packs[1..manifest.packs.len() - 1].to_vec();
    let omitted_span_summary = format!(
        "Compacted {} middle cut pack(s) spanning ordinals {}-{} ({} messages, {} tokens). Head pack {} and tail pack {} retained.",
        middle.len(),
        middle.first().map(|pack| pack.ordinal_start).unwrap_or(0),
        middle.last().map(|pack| pack.ordinal_end).unwrap_or(0),
        middle.iter().map(|pack| pack.msg_count).sum::<i64>(),
        middle.iter().map(|pack| pack.token_total).sum::<i64>(),
        head.pack_id,
        tail.pack_id
    );

    for pack in &middle {
        let pack_path = dir.join(&pack.path);
        if pack_path.is_file() {
            fs::remove_file(&pack_path)
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        }
    }

    manifest.packs = vec![
        head,
        CutPackManifestEntry {
            pack_id: format!("cut_pack_compact_{}", middle.len()),
            path: "cuts.compact.summary.json".to_string(),
            ordinal_start: middle.first().map(|pack| pack.ordinal_start).unwrap_or(0),
            ordinal_end: middle.last().map(|pack| pack.ordinal_end).unwrap_or(0),
            token_total: middle.iter().map(|pack| pack.token_total).sum(),
            msg_count: 0,
            created_at_iso: crate::native_backend::now(),
            deduped_msg_ids: Vec::new(),
        },
        tail,
    ];
    save_manifest(root, &manifest)?;
    let summary_path = dir.join("cuts.compact.summary.json");
    fs::write(
        &summary_path,
        serde_json::to_string_pretty(&json!({
            "sessionId": session_id,
            "omittedSpanSummary": omitted_span_summary,
            "compactedPackIds": middle.iter().map(|pack| &pack.pack_id).collect::<Vec<_>>(),
            "bytesBefore": size,
        }))
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?,
    )
    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    Ok(Some(json!({
        "sessionId": session_id,
        "bytesBefore": size,
        "omittedSpanSummary": omitted_span_summary,
        "compactedPacks": middle.len(),
    })))
}

fn directory_size(path: &Path) -> AgentRuntimeResult<u64> {
    let mut total = 0_u64;
    for entry in fs::read_dir(path).map_err(|error| AgentRuntimeError::Core(error.to_string()))? {
        let entry = entry.map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let metadata = entry
            .metadata()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        if metadata.is_file() {
            total = total.saturating_add(metadata.len());
        } else if metadata.is_dir() {
            total = total.saturating_add(directory_size(&entry.path())?);
        }
    }
    Ok(total)
}
