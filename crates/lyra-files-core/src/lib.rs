use std::collections::{HashMap, HashSet, VecDeque};
use std::error::Error;
use std::fmt::{Display, Formatter};
use std::fs;
use std::num::NonZeroUsize;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

use lru::LruCache;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};

pub mod paths;
pub mod preferences;
pub mod text_file;
pub mod workbench_paths;

use paths::{
    canonical_directory_path, directory_key, file_extension, file_name, folder_state_from_path,
    is_hidden, path_to_string, seconds_since_epoch, title_for_path,
};

const DIRECTORY_CACHE_CAPACITY: usize = 96;
const MAX_INCREMENTAL_PATCHES: usize = 512;

#[derive(Debug)]
pub enum FilesCoreError {
    InvalidArgument(String),
    Io {
        context: String,
        source: std::io::Error,
    },
    Watch(String),
}

impl Display for FilesCoreError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidArgument(message) => formatter.write_str(message),
            Self::Io { context, source } => write!(formatter, "{context}: {source}"),
            Self::Watch(message) => formatter.write_str(message),
        }
    }
}

impl Error for FilesCoreError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

pub type Result<T> = std::result::Result<T, FilesCoreError>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerLocation {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub path: Option<String>,
    pub special_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    pub kind: String,
    pub extension: Option<String>,
    pub is_hidden: bool,
    pub size_bytes: Option<f64>,
    pub modified_at: Option<String>,
    pub folder_state: Option<String>,
    pub hydration_state: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySnapshot {
    pub location: FileManagerLocation,
    pub parent_path: Option<String>,
    pub entries: Vec<FileManagerEntry>,
    pub generation: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DirectoryPatchKind {
    Create,
    Update,
    Remove,
    Rename,
    Reset,
}

impl DirectoryPatchKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Update => "update",
            Self::Remove => "remove",
            Self::Rename => "rename",
            Self::Reset => "reset",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPatch {
    pub subscription_id: String,
    pub directory_path: String,
    pub generation: u64,
    pub kind: DirectoryPatchKind,
    pub entry: Option<FileManagerEntry>,
    pub path: Option<String>,
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub snapshot: Option<DirectorySnapshot>,
    pub error_message: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorySubscription {
    pub subscription_id: String,
    pub snapshot: DirectorySnapshot,
}

#[derive(Clone, Debug)]
struct DirectorySubscriptionState {
    directory_key: String,
}

struct DirectoryWatchState {
    path: PathBuf,
    generation: u64,
    subscriptions: HashSet<String>,
    _watcher: RecommendedWatcher,
}

#[derive(Clone, Debug)]
enum DirectorySignal {
    Dirty {
        directory_path: PathBuf,
    },
    Hydrated {
        directory_path: PathBuf,
        entry_path: String,
        folder_state: String,
    },
}

pub struct DirectoryService {
    cache: LruCache<String, DirectorySnapshot>,
    watchers: HashMap<String, DirectoryWatchState>,
    subscriptions: HashMap<String, DirectorySubscriptionState>,
    patches: VecDeque<DirectoryPatch>,
    signal_tx: Sender<DirectorySignal>,
    signal_rx: Receiver<DirectorySignal>,
    next_subscription_id: u64,
}

impl Default for DirectoryService {
    fn default() -> Self {
        Self::new()
    }
}

impl DirectoryService {
    pub fn new() -> Self {
        let (signal_tx, signal_rx) = mpsc::channel();
        Self {
            cache: LruCache::new(
                NonZeroUsize::new(DIRECTORY_CACHE_CAPACITY)
                    .expect("directory cache capacity must be non-zero"),
            ),
            watchers: HashMap::new(),
            subscriptions: HashMap::new(),
            patches: VecDeque::new(),
            signal_tx,
            signal_rx,
            next_subscription_id: 1,
        }
    }

    pub fn read_directory(&mut self, path: &str) -> Result<DirectorySnapshot> {
        let canonical_path = canonical_directory_path(path)?;
        let directory_key = directory_key(&canonical_path);
        let generation = self
            .watchers
            .get(&directory_key)
            .map(|watcher| watcher.generation)
            .or_else(|| {
                self.cache
                    .get(&directory_key)
                    .map(|snapshot| snapshot.generation)
            })
            .unwrap_or(1);
        let snapshot = read_directory_snapshot_for_path(&canonical_path, generation)?;
        self.cache.put(directory_key, snapshot.clone());
        self.schedule_hydration(
            snapshot.location.path.clone().unwrap_or_default(),
            &snapshot.entries,
        );
        Ok(snapshot)
    }

    pub fn subscribe_directory(&mut self, path: &str) -> Result<DirectorySubscription> {
        let canonical_path = canonical_directory_path(path)?;
        let directory_key = directory_key(&canonical_path);
        let subscription_id = self.allocate_subscription_id();

        if self.watchers.contains_key(&directory_key) == false {
            let watcher = create_watcher(canonical_path.clone(), self.signal_tx.clone())?;
            let snapshot = match self.cache.get(&directory_key).cloned() {
                Some(snapshot) => snapshot,
                None => read_directory_snapshot_for_path(&canonical_path, 1)?,
            };
            let generation = snapshot.generation.max(1);
            self.cache.put(directory_key.clone(), snapshot);
            self.watchers.insert(
                directory_key.clone(),
                DirectoryWatchState {
                    path: canonical_path.clone(),
                    generation,
                    subscriptions: HashSet::new(),
                    _watcher: watcher,
                },
            );
        }

        let snapshot = match self.cache.get(&directory_key) {
            Some(snapshot) => snapshot.clone(),
            None => {
                let generation = self
                    .watchers
                    .get(&directory_key)
                    .map(|watcher| watcher.generation)
                    .unwrap_or(1);
                let snapshot = read_directory_snapshot_for_path(&canonical_path, generation)?;
                self.cache.put(directory_key.clone(), snapshot.clone());
                snapshot
            }
        };

        if let Some(watcher) = self.watchers.get_mut(&directory_key) {
            watcher.subscriptions.insert(subscription_id.clone());
        }
        self.subscriptions.insert(
            subscription_id.clone(),
            DirectorySubscriptionState {
                directory_key: directory_key.clone(),
            },
        );
        self.schedule_hydration(
            snapshot.location.path.clone().unwrap_or_default(),
            &snapshot.entries,
        );

        Ok(DirectorySubscription {
            subscription_id,
            snapshot,
        })
    }

    pub fn unsubscribe_directory(&mut self, subscription_id: &str) -> bool {
        let Some(subscription) = self.subscriptions.remove(subscription_id) else {
            return false;
        };

        let should_remove =
            if let Some(watcher) = self.watchers.get_mut(&subscription.directory_key) {
                watcher.subscriptions.remove(subscription_id);
                watcher.subscriptions.is_empty()
            } else {
                false
            };

        if should_remove {
            self.watchers.remove(&subscription.directory_key);
        }

        true
    }

    pub fn poll_patches(&mut self) -> Vec<DirectoryPatch> {
        self.drain_signals();
        self.patches.drain(..).collect()
    }

    fn allocate_subscription_id(&mut self) -> String {
        let id = self.next_subscription_id;
        self.next_subscription_id = self.next_subscription_id.saturating_add(1).max(1);
        format!("dir-sub-{id}")
    }

    fn drain_signals(&mut self) {
        let mut dirty_keys = HashSet::new();
        let mut hydration_updates = Vec::new();

        while let Ok(signal) = self.signal_rx.try_recv() {
            match signal {
                DirectorySignal::Dirty { directory_path } => {
                    dirty_keys.insert(directory_key(&directory_path));
                }
                DirectorySignal::Hydrated {
                    directory_path,
                    entry_path,
                    folder_state,
                } => hydration_updates.push((directory_path, entry_path, folder_state)),
            }
        }

        for (directory_path, entry_path, folder_state) in hydration_updates {
            self.apply_hydration(directory_path, entry_path, folder_state);
        }

        for directory_key in dirty_keys {
            self.refresh_dirty_directory(&directory_key);
        }
    }

    fn apply_hydration(
        &mut self,
        directory_path: PathBuf,
        entry_path: String,
        folder_state: String,
    ) {
        let key = directory_key(&directory_path);
        let Some((updated_entry, generation, directory_path_string)) = (|| {
            let snapshot = self.cache.get_mut(&key)?;
            let entry = snapshot
                .entries
                .iter_mut()
                .find(|entry| entry.path == entry_path)?;
            if entry.kind != "directory"
                || entry.folder_state.as_deref() == Some(folder_state.as_str())
                || entry.hydration_state == "complete"
            {
                return None;
            }
            entry.folder_state = Some(folder_state);
            entry.hydration_state = "complete".to_string();
            Some((
                entry.clone(),
                snapshot.generation,
                snapshot
                    .location
                    .path
                    .clone()
                    .unwrap_or_else(|| path_to_string(&directory_path)),
            ))
        })() else {
            return;
        };
        let subscription_ids = self.subscription_ids_for_key(&key);
        for subscription_id in subscription_ids {
            self.patches.push_back(DirectoryPatch {
                subscription_id,
                directory_path: directory_path_string.clone(),
                generation,
                kind: DirectoryPatchKind::Update,
                entry: Some(updated_entry.clone()),
                path: Some(updated_entry.path.clone()),
                old_path: None,
                new_path: None,
                snapshot: None,
                error_message: None,
            });
        }
    }

    fn refresh_dirty_directory(&mut self, directory_key: &str) {
        let Some((directory_path, generation)) =
            self.watchers.get_mut(directory_key).map(|watcher| {
                watcher.generation = watcher.generation.saturating_add(1).max(1);
                (watcher.path.clone(), watcher.generation)
            })
        else {
            return;
        };

        let previous = self.cache.get(directory_key).cloned();
        match read_directory_snapshot_for_path(&directory_path, generation) {
            Ok(next_snapshot) => {
                self.cache
                    .put(directory_key.to_string(), next_snapshot.clone());
                self.schedule_hydration(
                    next_snapshot.location.path.clone().unwrap_or_default(),
                    &next_snapshot.entries,
                );
                let patches = match previous {
                    Some(previous_snapshot) => diff_snapshots(&previous_snapshot, &next_snapshot),
                    None => vec![reset_patch_template(next_snapshot.clone(), None)],
                };
                self.broadcast_patch_templates(directory_key, patches);
            }
            Err(error) => {
                self.cache.pop(directory_key);
                self.broadcast_patch_templates(
                    directory_key,
                    vec![DirectoryPatch {
                        subscription_id: String::new(),
                        directory_path: path_to_string(&directory_path),
                        generation,
                        kind: DirectoryPatchKind::Reset,
                        entry: None,
                        path: None,
                        old_path: None,
                        new_path: None,
                        snapshot: None,
                        error_message: Some(error.to_string()),
                    }],
                );
            }
        }
    }

    fn broadcast_patch_templates(&mut self, directory_key: &str, patches: Vec<DirectoryPatch>) {
        let subscription_ids = self.subscription_ids_for_key(directory_key);
        for subscription_id in subscription_ids {
            for patch in &patches {
                let mut next_patch = patch.clone();
                next_patch.subscription_id = subscription_id.clone();
                self.patches.push_back(next_patch);
            }
        }
    }

    fn subscription_ids_for_key(&self, directory_key: &str) -> Vec<String> {
        self.watchers
            .get(directory_key)
            .map(|watcher| watcher.subscriptions.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn schedule_hydration(&self, directory_path: String, entries: &[FileManagerEntry]) {
        if directory_path.is_empty() {
            return;
        }
        let directory_entries = entries
            .iter()
            .filter(|entry| entry.kind == "directory" && entry.hydration_state != "complete")
            .map(|entry| entry.path.clone())
            .collect::<Vec<_>>();
        if directory_entries.is_empty() {
            return;
        }

        let tx = self.signal_tx.clone();
        thread::spawn(move || {
            let directory_path_buf = PathBuf::from(directory_path);
            for entry_path in directory_entries {
                let folder_state = folder_state_from_path(Path::new(&entry_path));
                if tx
                    .send(DirectorySignal::Hydrated {
                        directory_path: directory_path_buf.clone(),
                        entry_path,
                        folder_state,
                    })
                    .is_err()
                {
                    return;
                }
            }
        });
    }
}

fn create_watcher(path: PathBuf, tx: Sender<DirectorySignal>) -> Result<RecommendedWatcher> {
    let watched_path = path.clone();
    let mut watcher = notify::recommended_watcher(move |_event| {
        let _ = tx.send(DirectorySignal::Dirty {
            directory_path: watched_path.clone(),
        });
    })
    .map_err(|error| FilesCoreError::Watch(format!("failed to create watcher: {error}")))?;

    watcher
        .watch(&path, RecursiveMode::NonRecursive)
        .map_err(|error| {
            FilesCoreError::Watch(format!("failed to watch {}: {error}", path.display()))
        })?;

    Ok(watcher)
}

fn io_error(context: impl Into<String>, source: std::io::Error) -> FilesCoreError {
    FilesCoreError::Io {
        context: context.into(),
        source,
    }
}

fn create_location(
    id: String,
    title: String,
    kind: &str,
    path: Option<String>,
    special_id: Option<&str>,
) -> FileManagerLocation {
    FileManagerLocation {
        id,
        title,
        kind: kind.to_string(),
        path,
        special_id: special_id.map(str::to_string),
    }
}

fn read_directory_snapshot_for_path(path: &Path, generation: u64) -> Result<DirectorySnapshot> {
    let mut entries = fs::read_dir(path)
        .map_err(|error| io_error(format!("failed to read {}", path.display()), error))?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .map(|entry_path| read_entry_lazy(&entry_path))
        .collect::<Result<Vec<_>>>()?;
    sort_entries(&mut entries);

    Ok(DirectorySnapshot {
        location: create_location(
            path_to_string(path),
            title_for_path(path),
            "directory",
            Some(path_to_string(path)),
            None,
        ),
        parent_path: path.parent().map(path_to_string),
        entries,
        generation,
    })
}

pub fn read_entry_lazy(path: &Path) -> Result<FileManagerEntry> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        io_error(
            format!("failed to read metadata for {}", path.display()),
            error,
        )
    })?;
    let is_dir = metadata.is_dir();
    Ok(FileManagerEntry {
        id: path_to_string(path),
        name: file_name(path),
        path: path_to_string(path),
        kind: if is_dir {
            "directory".to_string()
        } else {
            "file".to_string()
        },
        extension: if is_dir { None } else { file_extension(path) },
        is_hidden: is_hidden(path),
        size_bytes: if is_dir {
            None
        } else {
            Some(metadata.len() as f64)
        },
        modified_at: metadata.modified().ok().and_then(seconds_since_epoch),
        folder_state: if is_dir {
            Some("unknown".to_string())
        } else {
            None
        },
        hydration_state: if is_dir {
            "pending".to_string()
        } else {
            "complete".to_string()
        },
    })
}

fn sort_entries(entries: &mut [FileManagerEntry]) {
    entries.sort_by(
        |left, right| match (left.kind.as_str(), right.kind.as_str()) {
            ("directory", "file") => std::cmp::Ordering::Less,
            ("file", "directory") => std::cmp::Ordering::Greater,
            _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
        },
    );
}

fn diff_snapshots(previous: &DirectorySnapshot, next: &DirectorySnapshot) -> Vec<DirectoryPatch> {
    let previous_entries = previous
        .entries
        .iter()
        .map(|entry| (entry.path.clone(), entry))
        .collect::<HashMap<_, _>>();
    let next_entries = next
        .entries
        .iter()
        .map(|entry| (entry.path.clone(), entry))
        .collect::<HashMap<_, _>>();

    let mut patches = Vec::new();
    for previous_entry in &previous.entries {
        if next_entries.contains_key(&previous_entry.path) == false {
            patches.push(DirectoryPatch {
                subscription_id: String::new(),
                directory_path: next.location.path.clone().unwrap_or_default(),
                generation: next.generation,
                kind: DirectoryPatchKind::Remove,
                entry: None,
                path: Some(previous_entry.path.clone()),
                old_path: None,
                new_path: None,
                snapshot: None,
                error_message: None,
            });
        }
    }

    for next_entry in &next.entries {
        match previous_entries.get(&next_entry.path) {
            None => patches.push(DirectoryPatch {
                subscription_id: String::new(),
                directory_path: next.location.path.clone().unwrap_or_default(),
                generation: next.generation,
                kind: DirectoryPatchKind::Create,
                entry: Some(next_entry.clone()),
                path: Some(next_entry.path.clone()),
                old_path: None,
                new_path: None,
                snapshot: None,
                error_message: None,
            }),
            Some(previous_entry) if *previous_entry != next_entry => {
                patches.push(DirectoryPatch {
                    subscription_id: String::new(),
                    directory_path: next.location.path.clone().unwrap_or_default(),
                    generation: next.generation,
                    kind: DirectoryPatchKind::Update,
                    entry: Some(next_entry.clone()),
                    path: Some(next_entry.path.clone()),
                    old_path: None,
                    new_path: None,
                    snapshot: None,
                    error_message: None,
                });
            }
            Some(_) => {}
        }
    }

    if patches.len() > MAX_INCREMENTAL_PATCHES {
        return vec![reset_patch_template(next.clone(), None)];
    }

    patches
}

fn reset_patch_template(
    snapshot: DirectorySnapshot,
    error_message: Option<String>,
) -> DirectoryPatch {
    DirectoryPatch {
        subscription_id: String::new(),
        directory_path: snapshot.location.path.clone().unwrap_or_default(),
        generation: snapshot.generation,
        kind: DirectoryPatchKind::Reset,
        entry: None,
        path: None,
        old_path: None,
        new_path: None,
        snapshot: Some(snapshot),
        error_message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "lyra-files-core-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn snapshot_is_sorted_and_uses_lazy_directory_state() {
        let root = temp_dir();
        fs::create_dir(root.join("z-dir")).unwrap();
        fs::write(root.join("a-file.txt"), b"hello").unwrap();
        fs::create_dir(root.join("a-dir")).unwrap();

        let mut service = DirectoryService::new();
        let snapshot = service.read_directory(root.to_str().unwrap()).unwrap();

        let names = snapshot
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names, vec!["a-dir", "z-dir", "a-file.txt"]);
        assert_eq!(snapshot.entries[0].folder_state.as_deref(), Some("unknown"));
        assert_eq!(snapshot.entries[0].hydration_state, "pending");

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn subscription_emits_create_patch_after_poll() {
        let root = temp_dir();
        let mut service = DirectoryService::new();
        let subscription = service.subscribe_directory(root.to_str().unwrap()).unwrap();
        fs::write(root.join("new.txt"), b"hello").unwrap();

        let mut patches = Vec::new();
        for _ in 0..20 {
            patches.extend(service.poll_patches());
            if patches
                .iter()
                .any(|patch| patch.kind == DirectoryPatchKind::Create)
            {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }

        assert!(patches.iter().any(|patch| {
            patch.subscription_id == subscription.subscription_id
                && patch.kind == DirectoryPatchKind::Create
                && patch.entry.as_ref().map(|entry| entry.name.as_str()) == Some("new.txt")
        }));

        fs::remove_dir_all(root).unwrap();
    }
}
