use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[cfg(any(
    target_os = "windows",
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
))]
use trash::{os_limited, TrashItem, TrashItemSize};

use crate::directory::create_location;
use crate::dto::{FileManagerReadTrashResponse, FileManagerTrashEntry};
use crate::error::{core_error, failure, io_error, NapiResult as Result};
#[cfg(any(
    target_os = "windows",
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
))]
use lyra_files_core::paths::os_to_string;
use lyra_files_core::paths::{
    file_extension, file_name, folder_state_from_path, is_hidden, normalize_path, path_to_string,
    seconds_since_epoch,
};
use lyra_files_core::preferences::{
    ensure_storage_root, read_json_file, storage_file, write_json_file,
};

#[cfg(target_os = "macos")]
const MAC_TRASH_INDEX_FILE_NAME: &str = "mac-trash-index.json";

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MacTrashIndex {
    entries: Vec<MacTrashRecord>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MacTrashRecord {
    id: String,
    trashed_path: String,
    original_path: String,
    deleted_at: String,
}

#[cfg(target_os = "macos")]
fn mac_trash_root() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| failure("home directory is unavailable"))?;
    Ok(home.join(".Trash"))
}

#[cfg(target_os = "macos")]
fn read_mac_trash_index(storage_root: &Path) -> Result<MacTrashIndex> {
    read_json_file(&storage_file(storage_root, MAC_TRASH_INDEX_FILE_NAME)).map_err(core_error)
}

#[cfg(target_os = "macos")]
fn write_mac_trash_index(storage_root: &Path, index: &MacTrashIndex) -> Result<()> {
    write_json_file(
        &storage_file(storage_root, MAC_TRASH_INDEX_FILE_NAME),
        index,
    )
    .map_err(core_error)
}

#[cfg(target_os = "macos")]
fn split_duplicate_name(name: &str) -> (String, String) {
    match name.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => {
            (stem.to_string(), format!(".{}", extension))
        }
        _ => (name.to_string(), String::new()),
    }
}

#[cfg(target_os = "macos")]
fn resolve_unique_mac_trash_target(trash_root: &Path, original_name: &str) -> PathBuf {
    let mut candidate = trash_root.join(original_name);
    if !candidate.exists() {
        return candidate;
    }

    let (stem, extension) = split_duplicate_name(original_name);
    for index in 2..10_000_u32 {
        let name = format!("{} {}{}", stem, index, extension);
        candidate = trash_root.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }

    trash_root.join(format!("{} {}{}", stem, now_id(), extension))
}

#[cfg(target_os = "macos")]
fn now_id() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(target_os = "macos")]
fn move_to_trash_macos(paths: &[String], storage_root: &Path) -> Result<()> {
    let trash_root = mac_trash_root()?;
    fs::create_dir_all(&trash_root)
        .map_err(|error| io_error("failed to create macOS trash directory", error))?;
    let mut index = read_mac_trash_index(storage_root)?;

    for raw_path in paths {
        let source = normalize_path(raw_path).map_err(core_error)?;
        let canonical_source = source
            .canonicalize()
            .map_err(|error| io_error(format!("failed to access {}", source.display()), error))?;
        let target = resolve_unique_mac_trash_target(&trash_root, &file_name(&canonical_source));
        fs::rename(&canonical_source, &target).map_err(|error| {
            io_error(
                format!("failed to move {} to trash", canonical_source.display()),
                error,
            )
        })?;

        index
            .entries
            .retain(|entry| entry.id != path_to_string(&target));
        index.entries.push(MacTrashRecord {
            id: path_to_string(&target),
            trashed_path: path_to_string(&target),
            original_path: path_to_string(&canonical_source),
            deleted_at: now_id(),
        });
    }

    write_mac_trash_index(storage_root, &index)
}

#[cfg(target_os = "macos")]
fn read_trash_macos(storage_root: &Path) -> Result<FileManagerReadTrashResponse> {
    let trash_root = mac_trash_root()?;
    fs::create_dir_all(&trash_root)
        .map_err(|error| io_error("failed to create macOS trash directory", error))?;
    let index = read_mac_trash_index(storage_root)?;

    let mut entries = Vec::new();
    for directory_entry in fs::read_dir(&trash_root)
        .map_err(|error| io_error(format!("failed to read {}", trash_root.display()), error))?
    {
        let directory_entry = directory_entry
            .map_err(|error| io_error("failed to iterate trash directory", error))?;
        let path = directory_entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            io_error(
                format!("failed to read metadata for {}", path.display()),
                error,
            )
        })?;
        let is_dir = metadata.is_dir();
        let entry_id = path_to_string(&path);
        let record = index.entries.iter().find(|item| item.id == entry_id);
        let original_path = record.map(|item| item.original_path.clone());
        let original_parent_path = original_path
            .as_ref()
            .and_then(|item| Path::new(item).parent().map(path_to_string));

        entries.push(FileManagerTrashEntry {
            id: entry_id.clone(),
            name: file_name(&path),
            kind: if is_dir {
                "directory".to_string()
            } else {
                "file".to_string()
            },
            trashed_path: Some(entry_id),
            original_path,
            original_parent_path,
            extension: if is_dir { None } else { file_extension(&path) },
            is_hidden: is_hidden(&path),
            folder_state: if is_dir {
                Some(folder_state_from_path(&path))
            } else {
                None
            },
            size_bytes: if is_dir {
                None
            } else {
                Some(metadata.len() as f64)
            },
            deleted_at: record
                .map(|item| item.deleted_at.clone())
                .or_else(|| metadata.modified().ok().and_then(seconds_since_epoch)),
        });
    }

    entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));

    Ok(FileManagerReadTrashResponse {
        location: create_location(
            "trash".to_string(),
            "Trash".to_string(),
            "trash",
            None,
            Some("trash"),
        ),
        entries,
    })
}

#[cfg(target_os = "macos")]
fn restore_from_trash_macos(item_ids: &[String], storage_root: &Path) -> Result<()> {
    let mut index = read_mac_trash_index(storage_root)?;
    for item_id in item_ids {
        let record = index
            .entries
            .iter()
            .find(|entry| entry.id == *item_id)
            .cloned()
            .ok_or_else(|| failure(format!("trash item not restorable: {}", item_id)))?;
        let trashed_path = PathBuf::from(&record.trashed_path);
        let original_path = PathBuf::from(&record.original_path);
        if original_path.exists() {
            return Err(failure(format!(
                "restore target already exists: {}",
                original_path.display()
            )));
        }
        if let Some(parent) = original_path.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                io_error(format!("failed to create {}", parent.display()), error)
            })?;
        }
        fs::rename(&trashed_path, &original_path).map_err(|error| {
            io_error(
                format!("failed to restore {}", trashed_path.display()),
                error,
            )
        })?;
        index.entries.retain(|entry| entry.id != *item_id);
    }
    write_mac_trash_index(storage_root, &index)
}

#[cfg(target_os = "macos")]
fn empty_trash_macos(storage_root: &Path) -> Result<()> {
    let trash_root = mac_trash_root()?;
    if trash_root.exists() {
        for directory_entry in fs::read_dir(&trash_root)
            .map_err(|error| io_error(format!("failed to read {}", trash_root.display()), error))?
        {
            let directory_entry = directory_entry
                .map_err(|error| io_error("failed to iterate trash directory", error))?;
            let path = directory_entry.path();
            if path.is_dir() {
                fs::remove_dir_all(&path).map_err(|error| {
                    io_error(format!("failed to remove {}", path.display()), error)
                })?;
            } else {
                fs::remove_file(&path).map_err(|error| {
                    io_error(format!("failed to remove {}", path.display()), error)
                })?;
            }
        }
    }
    write_mac_trash_index(storage_root, &MacTrashIndex::default())
}

#[cfg(any(
    target_os = "windows",
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
))]
fn trash_entry_from_native(item: &TrashItem) -> Result<FileManagerTrashEntry> {
    let metadata = os_limited::metadata(item)
        .map_err(|error| failure(format!("failed to read trash metadata: {}", error)))?;
    let (kind, folder_state, size_bytes) = match metadata.size {
        TrashItemSize::Entries(count) => (
            "directory".to_string(),
            Some(if count == 0 {
                "empty".to_string()
            } else {
                "non-empty".to_string()
            }),
            None,
        ),
        TrashItemSize::Bytes(bytes) => ("file".to_string(), None, Some(bytes as f64)),
    };

    let original_path = item.original_path();
    Ok(FileManagerTrashEntry {
        id: os_to_string(&item.id),
        name: os_to_string(&item.name),
        kind,
        trashed_path: Some(os_to_string(&item.id)),
        original_path: Some(path_to_string(&original_path)),
        original_parent_path: Some(path_to_string(&item.original_parent)),
        extension: if folder_state.is_some() {
            None
        } else {
            file_extension(Path::new(&item.name))
        },
        is_hidden: item.name.to_string_lossy().starts_with('.'),
        folder_state,
        size_bytes,
        deleted_at: if item.time_deleted >= 0 {
            Some(item.time_deleted.to_string())
        } else {
            None
        },
    })
}

#[cfg(any(
    target_os = "windows",
    all(
        unix,
        not(target_os = "macos"),
        not(target_os = "ios"),
        not(target_os = "android")
    )
))]
fn find_native_trash_items(item_ids: &[String]) -> Result<Vec<TrashItem>> {
    let all_items =
        os_limited::list().map_err(|error| failure(format!("failed to list trash: {}", error)))?;
    Ok(all_items
        .into_iter()
        .filter(|item| item_ids.iter().any(|id| id == &os_to_string(&item.id)))
        .collect())
}

pub fn read_trash(storage_root: &str) -> Result<FileManagerReadTrashResponse> {
    #[cfg(target_os = "macos")]
    {
        let storage_root = ensure_storage_root(storage_root).map_err(core_error)?;
        return read_trash_macos(&storage_root);
    }

    #[cfg(any(
        target_os = "windows",
        all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        )
    ))]
    {
        let mut entries = os_limited::list()
            .map_err(|error| failure(format!("failed to list trash: {}", error)))?
            .into_iter()
            .map(|item| trash_entry_from_native(&item))
            .collect::<Result<Vec<_>>>()?;
        entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
        return Ok(FileManagerReadTrashResponse {
            location: create_location(
                "trash".to_string(),
                "Trash".to_string(),
                "trash",
                None,
                Some("trash"),
            ),
            entries,
        });
    }

    #[allow(unreachable_code)]
    Err(failure(format!(
        "trash is not supported on {}",
        std::env::consts::OS
    )))
}

pub fn move_to_trash(paths: &[String], storage_root: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let storage_root = ensure_storage_root(storage_root).map_err(core_error)?;
        return move_to_trash_macos(paths, &storage_root);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let paths = paths
            .iter()
            .map(|path| normalize_path(path).map_err(core_error))
            .collect::<Result<Vec<_>>>()?;
        trash::delete_all(paths)
            .map_err(|error| failure(format!("failed to move items to trash: {}", error)))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(failure(format!(
        "trash is not supported on {}",
        std::env::consts::OS
    )))
}

pub fn restore_from_trash(item_ids: &[String], storage_root: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let storage_root = ensure_storage_root(storage_root).map_err(core_error)?;
        return restore_from_trash_macos(item_ids, &storage_root);
    }

    #[cfg(any(
        target_os = "windows",
        all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        )
    ))]
    {
        let items = find_native_trash_items(item_ids)?;
        os_limited::restore_all(items)
            .map_err(|error| failure(format!("failed to restore trash items: {}", error)))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(failure(format!(
        "trash is not supported on {}",
        std::env::consts::OS
    )))
}

pub fn empty_trash(storage_root: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let storage_root = ensure_storage_root(storage_root).map_err(core_error)?;
        return empty_trash_macos(&storage_root);
    }

    #[cfg(any(
        target_os = "windows",
        all(
            unix,
            not(target_os = "macos"),
            not(target_os = "ios"),
            not(target_os = "android")
        )
    ))]
    {
        let items = os_limited::list()
            .map_err(|error| failure(format!("failed to list trash: {}", error)))?;
        os_limited::purge_all(&items)
            .map_err(|error| failure(format!("failed to empty trash: {}", error)))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(failure(format!(
        "trash is not supported on {}",
        std::env::consts::OS
    )))
}
