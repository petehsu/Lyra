use super::index::{
    aggregate_root_state, normalize_path_for_display, rebuild_all_root_statuses,
    remove_path_or_descendants,
};
use super::model::*;
use super::query::refresh_content_postings_after_changes;
use anyhow::Context;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

impl LocalSearchState {
    pub(super) fn from_config(config: LocalSearchEngineConfig) -> Self {
        let storage = V3Storage::from_mode(&config.storage_mode);
        let mut state = Self {
            entries: Vec::new(),
            content_postings: HashMap::new(),
            roots: BTreeMap::new(),
            storage,
            state: LocalSearchIndexState::Empty,
            phase: "idle".to_string(),
            policy_hash: None,
            policy_source: Vec::new(),
            policy_warnings: Vec::new(),
            pending_changes: 0,
            load_error: None,
        };
        if let Err(error) = load_v3_state(&mut state) {
            state.state = LocalSearchIndexState::Failed;
            state.phase = "failed".to_string();
            state.load_error = Some(format!("local search v3 load failed: {error}"));
        }
        state
    }
}

impl V3Storage {
    pub(super) fn from_mode(mode: &LocalSearchStorageMode) -> Self {
        match mode {
            LocalSearchStorageMode::Memory => Self { native_dir: None },
            LocalSearchStorageMode::Persistent { storage_root } => Self {
                native_dir: Some(storage_root.join("native")),
            },
        }
    }

    pub(super) fn snapshot_path(&self) -> Option<PathBuf> {
        self.native_dir
            .as_ref()
            .map(|dir| dir.join("snapshot.lyidx"))
    }

    pub(super) fn delta_path(&self) -> Option<PathBuf> {
        self.native_dir.as_ref().map(|dir| dir.join("delta.lylog"))
    }

    pub(super) fn meta_path(&self) -> Option<PathBuf> {
        self.native_dir.as_ref().map(|dir| dir.join("meta.json"))
    }
}

impl From<IndexedEntry> for SnapshotEntry {
    fn from(entry: IndexedEntry) -> Self {
        Self {
            root: entry.root,
            relative_path: entry.relative_path,
            full_path: entry.full_path,
            display_path: entry.display_path,
            kind: entry.kind,
            extension: entry.extension,
            size_bytes: entry.size_bytes,
            modified_at: entry.modified_at,
            created_at: entry.created_at,
            hidden: entry.hidden,
            vendor: entry.vendor,
            content_indexed: entry.content_indexed,
            content_text: entry.content_text,
        }
    }
}

impl From<SnapshotEntry> for IndexedEntry {
    fn from(entry: SnapshotEntry) -> Self {
        let lower_file_name = entry
            .full_path
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_else(|| entry.display_path.to_lowercase());
        let lower_path = entry.display_path.to_lowercase();
        Self {
            root: entry.root,
            relative_path: entry.relative_path,
            full_path: entry.full_path,
            display_path: entry.display_path,
            kind: entry.kind,
            extension: entry.extension,
            lower_file_name,
            lower_path,
            size_bytes: entry.size_bytes,
            modified_at: entry.modified_at,
            created_at: entry.created_at,
            hidden: entry.hidden,
            vendor: entry.vendor,
            content_indexed: entry.content_indexed,
            content_text: entry.content_text,
        }
    }
}

pub(super) fn load_v3_state(state: &mut LocalSearchState) -> anyhow::Result<()> {
    let Some(snapshot_path) = state.storage.snapshot_path() else {
        return Ok(());
    };
    if !snapshot_path.exists() {
        return Ok(());
    }
    let snapshot = read_snapshot(&snapshot_path)?;
    state.entries = snapshot.entries;
    state.content_postings = snapshot.content_postings;
    if let Some(meta_path) = state.storage.meta_path() {
        if meta_path.exists() {
            if let Ok(text) = fs::read_to_string(&meta_path) {
                if let Ok(meta) = serde_json::from_str::<V3Meta>(&text) {
                    state.roots = meta
                        .roots
                        .into_iter()
                        .map(|root| (root.root.clone(), root))
                        .collect();
                    state.policy_hash = meta.policy_hash;
                    state.policy_source = meta.policy_source;
                    state.policy_warnings = meta.policy_warnings;
                    state.pending_changes = meta.pending_changes;
                    state.phase = meta.phase;
                }
            }
        }
    }
    if replay_delta(state)? {
        refresh_content_postings_after_changes(state);
    }
    if state.roots.is_empty() && !state.entries.is_empty() {
        rebuild_all_root_statuses(state);
    }
    state.state = aggregate_root_state(state.roots.values());
    if state.state == LocalSearchIndexState::Empty && !state.entries.is_empty() {
        state.state = LocalSearchIndexState::Ready;
    }
    Ok(())
}

struct SnapshotState {
    entries: Vec<IndexedEntry>,
    content_postings: HashMap<String, Vec<usize>>,
}

fn read_snapshot(path: &Path) -> anyhow::Result<SnapshotState> {
    let mut file = fs::File::open(path)?;
    let mut magic = [0_u8; 8];
    file.read_exact(&mut magic)?;
    if &magic != SNAPSHOT_MAGIC {
        anyhow::bail!("invalid snapshot magic");
    }
    let version = read_u32(&mut file)?;
    if version != SNAPSHOT_VERSION {
        anyhow::bail!("unsupported snapshot version {version}");
    }
    let count = read_u64(&mut file)?;
    let mut entries = Vec::new();
    for _ in 0..count {
        let snapshot = SnapshotEntry {
            root: PathBuf::from(read_string(&mut file)?),
            relative_path: PathBuf::from(read_string(&mut file)?),
            full_path: PathBuf::from(read_string(&mut file)?),
            display_path: read_string(&mut file)?,
            kind: if read_u8(&mut file)? == 1 {
                LocalSearchKind::Directory
            } else {
                LocalSearchKind::File
            },
            extension: read_optional_string(&mut file)?,
            size_bytes: read_u64(&mut file)?,
            modified_at: read_optional_u64(&mut file)?,
            created_at: read_optional_u64(&mut file)?,
            hidden: read_u8(&mut file)? != 0,
            vendor: read_u8(&mut file)? != 0,
            content_indexed: read_u8(&mut file)? != 0,
            content_text: read_optional_string(&mut file)?,
        };
        entries.push(IndexedEntry::from(snapshot));
    }
    let posting_count = read_u64(&mut file)?;
    let mut content_postings = HashMap::new();
    for _ in 0..posting_count {
        let term = read_string(&mut file)?;
        let count = read_u64(&mut file)?;
        let mut indices = Vec::new();
        for _ in 0..count {
            let index = read_u64(&mut file)? as usize;
            if index < entries.len() {
                indices.push(index);
            }
        }
        indices.sort_unstable();
        indices.dedup();
        if !indices.is_empty() {
            content_postings.insert(term, indices);
        }
    }
    Ok(SnapshotState {
        entries,
        content_postings,
    })
}

pub(super) fn write_snapshot(state: &LocalSearchState) -> anyhow::Result<()> {
    write_snapshot_parts(&state.storage, &state.entries, &state.content_postings)
}

pub(super) fn write_snapshot_parts(
    storage: &V3Storage,
    entries: &[IndexedEntry],
    content_postings: &HashMap<String, Vec<usize>>,
) -> anyhow::Result<()> {
    let Some(snapshot_path) = storage.snapshot_path() else {
        return Ok(());
    };
    let native_dir = snapshot_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("snapshot path has no parent"))?;
    fs::create_dir_all(native_dir)?;
    let tmp_path = snapshot_path.with_extension("lyidx.tmp");
    let mut file = fs::File::create(&tmp_path)?;
    file.write_all(SNAPSHOT_MAGIC)?;
    write_u32(&mut file, SNAPSHOT_VERSION)?;
    write_u64(&mut file, entries.len() as u64)?;
    for entry in entries {
        write_string(&mut file, &normalize_path_for_display(&entry.root))?;
        write_string(&mut file, &normalize_path_for_display(&entry.relative_path))?;
        write_string(&mut file, &normalize_path_for_display(&entry.full_path))?;
        write_string(&mut file, &entry.display_path)?;
        write_u8(
            &mut file,
            if entry.kind == LocalSearchKind::Directory {
                1
            } else {
                0
            },
        )?;
        write_optional_string(&mut file, entry.extension.as_deref())?;
        write_u64(&mut file, entry.size_bytes)?;
        write_optional_u64(&mut file, entry.modified_at)?;
        write_optional_u64(&mut file, entry.created_at)?;
        write_u8(&mut file, u8::from(entry.hidden))?;
        write_u8(&mut file, u8::from(entry.vendor))?;
        write_u8(&mut file, u8::from(entry.content_indexed))?;
        write_optional_string(&mut file, entry.content_text.as_deref())?;
    }
    write_u64(&mut file, content_postings.len() as u64)?;
    for (term, indices) in content_postings {
        write_string(&mut file, term)?;
        write_u64(&mut file, indices.len() as u64)?;
        for index in indices {
            write_u64(&mut file, *index as u64)?;
        }
    }
    file.flush()?;
    fs::rename(tmp_path, snapshot_path)?;
    Ok(())
}

pub(super) fn write_meta(state: &LocalSearchState) -> anyhow::Result<()> {
    write_meta_parts(
        &state.storage,
        &state.roots,
        &state.policy_hash,
        &state.policy_source,
        &state.policy_warnings,
        state.pending_changes,
        &state.phase,
    )
}

pub(super) fn write_meta_parts(
    storage: &V3Storage,
    roots: &BTreeMap<PathBuf, LocalSearchRootStatus>,
    policy_hash: &Option<String>,
    policy_source: &[String],
    policy_warnings: &[String],
    pending_changes: u64,
    phase: &str,
) -> anyhow::Result<()> {
    let Some(meta_path) = storage.meta_path() else {
        return Ok(());
    };
    let native_dir = meta_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("meta path has no parent"))?;
    fs::create_dir_all(native_dir)?;
    let tmp_path = meta_path.with_extension("json.tmp");
    let meta = V3Meta {
        engine_version: ENGINE_VERSION.to_string(),
        snapshot_version: SNAPSHOT_VERSION,
        phase: phase.to_string(),
        policy_hash: policy_hash.clone(),
        policy_source: policy_source.to_vec(),
        policy_warnings: policy_warnings.to_vec(),
        roots: roots.values().cloned().collect(),
        pending_changes,
        last_written_at: Some(unix_seconds_now()),
    };
    fs::write(&tmp_path, serde_json::to_vec_pretty(&meta)?)?;
    fs::rename(tmp_path, meta_path)?;
    Ok(())
}

pub(super) fn replay_delta(state: &mut LocalSearchState) -> anyhow::Result<bool> {
    let Some(delta_path) = state.storage.delta_path() else {
        return Ok(false);
    };
    if !delta_path.exists() {
        return Ok(false);
    }
    let text = fs::read_to_string(&delta_path)?;
    let records = text.lines().filter(|line| !line.trim().is_empty()).count();
    if records > DELTA_REPLAY_RECORD_LIMIT {
        state.pending_changes = state.pending_changes.saturating_add(records as u64);
        return Ok(false);
    }
    let mut replayed = false;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let record: DeltaRecord = serde_json::from_str(line)?;
        apply_delta_record(&mut state.entries, record);
        state.pending_changes = state.pending_changes.saturating_add(1);
        replayed = true;
    }
    Ok(replayed)
}

pub(super) fn apply_delta_record(entries: &mut Vec<IndexedEntry>, record: DeltaRecord) {
    match record {
        DeltaRecord::Upsert { entry } => {
            let entry = IndexedEntry::from(entry);
            entries.retain(|existing| existing.full_path != entry.full_path);
            entries.push(entry);
        }
        DeltaRecord::Delete { full_path } => {
            entries.retain(|entry| entry.full_path != full_path);
        }
        DeltaRecord::DeleteTree { full_path } => {
            remove_path_or_descendants(entries, &full_path);
        }
    }
}

pub(super) fn append_delta(storage: &V3Storage, records: &[DeltaRecord]) -> anyhow::Result<()> {
    if records.is_empty() {
        return Ok(());
    }
    let Some(delta_path) = storage.delta_path() else {
        return Ok(());
    };
    if let Some(native_dir) = delta_path.parent() {
        fs::create_dir_all(native_dir)?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(delta_path)?;
    for record in records {
        serde_json::to_writer(&mut file, record)?;
        file.write_all(b"\n")?;
    }
    Ok(())
}

pub(super) fn clear_delta(storage: &V3Storage) -> anyhow::Result<()> {
    if let Some(delta_path) = storage.delta_path() {
        if let Some(parent) = delta_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(delta_path, [])?;
    }
    Ok(())
}

pub(super) fn should_compact_delta(storage: &V3Storage) -> bool {
    let delta_bytes = storage
        .delta_path()
        .and_then(|path| file_len(&path))
        .unwrap_or(0);
    if delta_bytes >= DELTA_COMPACT_BYTES {
        return true;
    }
    let snapshot_bytes = storage
        .snapshot_path()
        .and_then(|path| file_len(&path))
        .unwrap_or(0);
    snapshot_bytes > 0 && delta_bytes > snapshot_bytes / 10
}

pub(super) fn storage_size(storage: &V3Storage) -> u64 {
    let Some(native_dir) = &storage.native_dir else {
        return 0;
    };
    directory_size(native_dir)
}

pub(super) fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            match entry.metadata() {
                Ok(metadata) if metadata.is_dir() => directory_size(&path),
                Ok(metadata) => metadata.len(),
                Err(_) => 0,
            }
        })
        .sum()
}

pub(super) fn file_len(path: &Path) -> Option<u64> {
    fs::metadata(path).ok().map(|metadata| metadata.len())
}

pub(super) fn system_time_to_unix_seconds(value: SystemTime) -> Option<u64> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

pub(super) fn unix_seconds_now() -> u64 {
    system_time_to_unix_seconds(SystemTime::now()).unwrap_or(0)
}

pub(super) fn read_u8(reader: &mut impl Read) -> anyhow::Result<u8> {
    let mut bytes = [0_u8; 1];
    reader.read_exact(&mut bytes)?;
    Ok(bytes[0])
}

pub(super) fn write_u8(writer: &mut impl Write, value: u8) -> anyhow::Result<()> {
    writer.write_all(&[value])?;
    Ok(())
}

pub(super) fn read_u32(reader: &mut impl Read) -> anyhow::Result<u32> {
    let mut bytes = [0_u8; 4];
    reader.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

pub(super) fn write_u32(writer: &mut impl Write, value: u32) -> anyhow::Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

pub(super) fn read_u64(reader: &mut impl Read) -> anyhow::Result<u64> {
    let mut bytes = [0_u8; 8];
    reader.read_exact(&mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
}

pub(super) fn write_u64(writer: &mut impl Write, value: u64) -> anyhow::Result<()> {
    writer.write_all(&value.to_le_bytes())?;
    Ok(())
}

pub(super) fn read_optional_u64(reader: &mut impl Read) -> anyhow::Result<Option<u64>> {
    if read_u8(reader)? == 0 {
        Ok(None)
    } else {
        Ok(Some(read_u64(reader)?))
    }
}

pub(super) fn write_optional_u64(
    writer: &mut impl Write,
    value: Option<u64>,
) -> anyhow::Result<()> {
    match value {
        Some(value) => {
            write_u8(writer, 1)?;
            write_u64(writer, value)?;
        }
        None => write_u8(writer, 0)?,
    }
    Ok(())
}

pub(super) fn read_string(reader: &mut impl Read) -> anyhow::Result<String> {
    let len = read_u32(reader)? as usize;
    let mut bytes = vec![0_u8; len];
    reader.read_exact(&mut bytes)?;
    String::from_utf8(bytes).context("snapshot string is not utf-8")
}

pub(super) fn write_string(writer: &mut impl Write, value: &str) -> anyhow::Result<()> {
    let bytes = value.as_bytes();
    let len = u32::try_from(bytes.len()).context("snapshot string too large")?;
    write_u32(writer, len)?;
    writer.write_all(bytes)?;
    Ok(())
}

pub(super) fn read_optional_string(reader: &mut impl Read) -> anyhow::Result<Option<String>> {
    if read_u8(reader)? == 0 {
        Ok(None)
    } else {
        Ok(Some(read_string(reader)?))
    }
}

pub(super) fn write_optional_string(
    writer: &mut impl Write,
    value: Option<&str>,
) -> anyhow::Result<()> {
    match value {
        Some(value) => {
            write_u8(writer, 1)?;
            write_string(writer, value)?;
        }
        None => write_u8(writer, 0)?,
    }
    Ok(())
}
