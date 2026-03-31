use std::cmp::Ordering;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
use std::process::Command;

mod eject;
mod mount;

use napi::{Error, Result, Status};
use napi_derive::napi;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sysinfo::{DiskKind, Disks};

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

use eject::safely_eject_device;
use mount::mount_device as perform_mount_device;

const FAVORITES_FILE_NAME: &str = "favorites.json";
const RECENT_LOCATIONS_FILE_NAME: &str = "recent-locations.json";
const MAX_EDITABLE_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_READONLY_TEXT_FILE_BYTES: u64 = 8 * 1024 * 1024;
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";
#[cfg(target_os = "macos")]
const MAC_TRASH_INDEX_FILE_NAME: &str = "mac-trash-index.json";

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRootRequest {
    pub storage_root: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerLocation {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub path: Option<String>,
    pub special_id: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerFavorite {
    pub id: String,
    pub title: String,
    pub path: String,
    pub special_id: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerRecentLocation {
    pub id: String,
    pub title: String,
    pub path: String,
    pub last_opened_at: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerDisk {
    pub id: String,
    pub title: String,
    pub mount_path: String,
    pub device_path: Option<String>,
    pub file_system: String,
    pub kind: String,
    pub os_flavor: Option<String>,
    pub total_bytes: f64,
    pub available_bytes: f64,
    pub used_bytes: f64,
    pub usage_ratio: f64,
    pub is_removable: bool,
    pub can_eject: bool,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerDevice {
    pub id: String,
    pub title: String,
    pub device_path: String,
    pub display_path: Option<String>,
    pub file_system: Option<String>,
    pub kind: String,
    pub os_flavor: Option<String>,
    pub total_bytes: Option<f64>,
    pub is_removable: bool,
    pub can_mount: bool,
    pub can_eject: bool,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
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
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerTrashEntry {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub trashed_path: Option<String>,
    pub original_path: Option<String>,
    pub original_parent_path: Option<String>,
    pub extension: Option<String>,
    pub is_hidden: bool,
    pub folder_state: Option<String>,
    pub size_bytes: Option<f64>,
    pub deleted_at: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerReadHomeResponse {
    pub location: FileManagerLocation,
    pub system_locations: Vec<FileManagerLocation>,
    pub favorites: Vec<FileManagerFavorite>,
    pub recent_locations: Vec<FileManagerRecentLocation>,
    pub disks: Vec<FileManagerDisk>,
    pub devices: Vec<FileManagerDevice>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerReadDirectoryRequest {
    pub path: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerReadDirectoryResponse {
    pub location: FileManagerLocation,
    pub parent_path: Option<String>,
    pub entries: Vec<FileManagerEntry>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerReadTrashResponse {
    pub location: FileManagerLocation,
    pub entries: Vec<FileManagerTrashEntry>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerCreateFileRequest {
    pub parent_path: String,
    pub name: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerCreateFolderRequest {
    pub parent_path: String,
    pub name: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerMoveToTrashRequest {
    pub paths: Vec<String>,
    pub storage_root: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerRestoreFromTrashRequest {
    pub item_ids: Vec<String>,
    pub storage_root: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerEjectDeviceRequest {
    pub mount_path: String,
    pub device_path: Option<String>,
    pub kind: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerMountDeviceRequest {
    pub device_path: String,
    pub kind: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerEjectDeviceResult {
    pub ejected: bool,
    pub powered_off: bool,
    pub strategy: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerMountDeviceResult {
    pub mounted: bool,
    pub mount_path: Option<String>,
    pub strategy: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerDirectoryMutationResponse {
    pub entry: Option<FileManagerEntry>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerFavoritesPayload {
    pub favorites: Vec<FileManagerFavorite>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerFavoritesWriteRequest {
    pub storage_root: String,
    pub favorites: Vec<FileManagerFavorite>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerRecentLocationsPayload {
    pub recent_locations: Vec<FileManagerRecentLocation>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerRecentLocationsWriteRequest {
    pub storage_root: String,
    pub recent_locations: Vec<FileManagerRecentLocation>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadTextRequest {
    pub path: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadResult {
    pub kind: String,
    pub path: String,
    pub reason: Option<String>,
    pub revision: Option<String>,
    pub encoding: Option<String>,
    pub read_only: bool,
    pub size_bytes: f64,
    pub content: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteTextRequest {
    pub path: String,
    pub content: String,
    pub expected_revision: Option<String>,
    pub encoding: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteResult {
    pub ok: bool,
    pub kind: Option<String>,
    pub path: String,
    pub message: Option<String>,
    pub expected_revision: Option<String>,
    pub current_revision: Option<String>,
    pub revision: Option<String>,
    pub encoding: Option<String>,
    pub saved_at: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatRequest {
    pub path: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStatResult {
    pub path: String,
    pub exists: bool,
    pub is_directory: bool,
    pub read_only: bool,
    pub size_bytes: f64,
    pub modified_at: Option<String>,
    pub revision: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchPathProbeRequest {
    pub path: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchPathProbeResult {
    pub normalized_path: String,
    pub existing_path: Option<String>,
    pub directory_path: Option<String>,
    pub project_root: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchCollectFilePathsRequest {
    pub root_path: String,
    pub base_path: Option<String>,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchCollectedFilePath {
    pub path: String,
}

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

fn invalid_arg(message: impl Into<String>) -> Error {
    Error::new(Status::InvalidArg, message.into())
}

fn failure(message: impl Into<String>) -> Error {
    Error::new(Status::GenericFailure, message.into())
}

fn io_error(message: impl Into<String>, error: std::io::Error) -> Error {
    Error::new(
        Status::GenericFailure,
        format!("{}: {}", message.into(), error),
    )
}

fn ensure_storage_root(path: &str) -> Result<PathBuf> {
    let root = PathBuf::from(path);
    fs::create_dir_all(&root).map_err(|error| io_error("failed to create storage root", error))?;
    Ok(root)
}

fn storage_file(storage_root: &Path, file_name: &str) -> PathBuf {
    storage_root.join(file_name)
}

fn read_json_file<T>(path: &Path) -> Result<T>
where
    T: DeserializeOwned + Default,
{
    if !path.exists() {
        return Ok(T::default());
    }

    let bytes = fs::read(path)
        .map_err(|error| io_error(format!("failed to read {}", path.display()), error))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| failure(format!("failed to parse {}: {}", path.display(), error)))
}

fn write_json_file<T>(path: &Path, value: &T) -> Result<()>
where
    T: Serialize,
{
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| io_error(format!("failed to create {}", parent.display()), error))?;
    }

    let payload = serde_json::to_vec_pretty(value)
        .map_err(|error| failure(format!("failed to serialize {}: {}", path.display(), error)))?;
    fs::write(path, payload)
        .map_err(|error| io_error(format!("failed to write {}", path.display()), error))
}

fn normalize_path(value: &str) -> Result<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(invalid_arg("path is required"));
    }
    Ok(PathBuf::from(trimmed))
}

fn lexical_normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if normalized.pop() == false {
                    normalized.push(component.as_os_str());
                }
            }
            Component::Normal(segment) => normalized.push(segment),
        }
    }

    normalized
}

fn normalize_absolute_path(value: &str) -> Result<PathBuf> {
    let raw_path = normalize_path(value)?;
    let absolute_path = if raw_path.is_absolute() {
        raw_path
    } else {
        std::env::current_dir()
            .map_err(|error| io_error("failed to read current directory", error))?
            .join(raw_path)
    };

    Ok(lexical_normalize_path(&absolute_path))
}

fn find_git_root(start_path: &Path) -> Option<PathBuf> {
    let mut cursor = start_path.to_path_buf();

    loop {
        if cursor.join(".git").exists() {
            return Some(cursor);
        }

        let Some(parent) = cursor.parent() else {
            break;
        };
        if parent == cursor.as_path() {
            break;
        }
        cursor = parent.to_path_buf();
    }

    None
}

fn relative_workbench_path(path: &Path, base_path: &Path) -> PathBuf {
    match path.strip_prefix(base_path) {
        Ok(relative) => relative.to_path_buf(),
        Err(_) => path.to_path_buf(),
    }
}

fn collect_workbench_file_paths_recursive(
    root_path: &Path,
    base_path: &Path,
    collected: &mut Vec<WorkbenchCollectedFilePath>,
) -> Result<()> {
    let directory = fs::read_dir(root_path)
        .map_err(|error| io_error(format!("failed to read {}", root_path.display()), error))?;

    for entry in directory {
        let entry =
            entry.map_err(|error| io_error("failed to iterate directory entries", error))?;
        let entry_path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            io_error(
                format!("failed to read metadata for {}", entry_path.display()),
                error,
            )
        })?;

        if file_type.is_dir() {
            collect_workbench_file_paths_recursive(&entry_path, base_path, collected)?;
            continue;
        }

        if file_type.is_file() {
            let relative_path = relative_workbench_path(&entry_path, base_path);
            collected.push(WorkbenchCollectedFilePath {
                path: path_to_string(&relative_path).replace('\\', "/"),
            });
        }
    }

    Ok(())
}

fn normalize_name(value: &str) -> Result<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(invalid_arg("name is required"));
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(invalid_arg("name contains unsupported path separators"));
    }
    Ok(trimmed.to_string())
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn os_to_string(value: &std::ffi::OsStr) -> String {
    value.to_string_lossy().into_owned()
}

fn file_extension(path: &Path) -> Option<String> {
    path.extension()
        .map(os_to_string)
        .filter(|value| !value.is_empty())
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(os_to_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| path_to_string(path))
}

fn title_for_path(path: &Path) -> String {
    let title = file_name(path);
    if title.is_empty() {
        path_to_string(path)
    } else {
        title
    }
}

fn location_path_key(path: &Path) -> String {
    let normalized = path_to_string(path).replace('\\', "/");
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        return normalized.to_lowercase();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        normalized
    }
}

fn canonical_directory_path(path: &str) -> Option<PathBuf> {
    let canonical = PathBuf::from(path).canonicalize().ok()?;
    if canonical.is_dir() {
        Some(canonical)
    } else {
        None
    }
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .map(|name| name.to_string_lossy().starts_with('.'))
        .unwrap_or(false)
}

fn seconds_since_epoch(value: SystemTime) -> Option<String> {
    value
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs().to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    digest
        .iter()
        .map(|value| format!("{:02x}", value))
        .collect::<String>()
}

fn encode_text_content(content: &str, encoding: &str) -> Vec<u8> {
    let utf8_bytes = content.as_bytes();
    if encoding == "utf8-bom" {
        let mut bytes = Vec::with_capacity(UTF8_BOM.len() + utf8_bytes.len());
        bytes.extend_from_slice(UTF8_BOM);
        bytes.extend_from_slice(utf8_bytes);
        return bytes;
    }
    utf8_bytes.to_vec()
}

fn decode_text_content(bytes: &[u8]) -> std::result::Result<(String, String), String> {
    if bytes.starts_with(UTF8_BOM) {
        let payload = &bytes[UTF8_BOM.len()..];
        return std::str::from_utf8(payload)
            .map(|content| (content.to_string(), "utf8-bom".to_string()))
            .map_err(|_| "encoding-not-supported".to_string());
    }

    std::str::from_utf8(bytes)
        .map(|content| (content.to_string(), "utf8".to_string()))
        .map_err(|_| "encoding-not-supported".to_string())
}

fn normalize_text_encoding(value: Option<&str>) -> Result<String> {
    match value.map(str::trim).filter(|entry| !entry.is_empty()) {
        None => Ok("utf8".to_string()),
        Some("utf8") => Ok("utf8".to_string()),
        Some("utf8-bom") => Ok("utf8-bom".to_string()),
        Some(_) => Err(invalid_arg("encoding is unsupported")),
    }
}

fn create_temp_file_path(target_path: &Path) -> PathBuf {
    let parent = target_path
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let file_name = target_path
        .file_name()
        .map(os_to_string)
        .unwrap_or_else(|| "lyra-file".to_string());
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let process_id = std::process::id();
    parent.join(format!(
        ".{}.lyra.tmp.{}.{}",
        file_name, process_id, timestamp
    ))
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> std::io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::Other, "missing parent directory")
    })?;
    let file = File::open(parent)?;
    file.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

fn write_bytes_atomically(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| invalid_arg("path has no parent directory"))?;
    fs::create_dir_all(parent)
        .map_err(|error| io_error(format!("failed to create {}", parent.display()), error))?;

    let temp_path = create_temp_file_path(path);
    let write_result = (|| -> std::io::Result<()> {
        let mut temp_file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)?;
        temp_file.write_all(bytes)?;
        temp_file.sync_all()?;
        drop(temp_file);

        #[cfg(windows)]
        {
            if path.exists() {
                fs::remove_file(path)?;
            }
        }

        fs::rename(&temp_path, path)?;
        sync_parent_directory(path)?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(io_error(
            format!("failed to write {}", path.display()),
            error,
        ));
    }

    Ok(())
}

fn folder_state_from_path(path: &Path) -> String {
    match fs::read_dir(path) {
        Ok(mut entries) => match entries.next() {
            None => "empty".to_string(),
            Some(Ok(_)) => "non-empty".to_string(),
            Some(Err(_)) => "unknown".to_string(),
        },
        Err(_) => "unknown".to_string(),
    }
}

fn entry_from_path(path: &Path) -> Result<FileManagerEntry> {
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
            Some(folder_state_from_path(path))
        } else {
            None
        },
    })
}

fn sort_entries(entries: &mut [FileManagerEntry]) {
    entries.sort_by(
        |left, right| match (left.kind.as_str(), right.kind.as_str()) {
            ("directory", "file") => Ordering::Less,
            ("file", "directory") => Ordering::Greater,
            _ => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
        },
    );
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

fn sanitize_favorites(payload: FileManagerFavoritesPayload) -> FileManagerFavoritesPayload {
    let mut seen = std::collections::HashSet::new();
    let favorites = payload
        .favorites
        .into_iter()
        .filter_map(|favorite| {
            let canonical_path = canonical_directory_path(&favorite.path)?;
            let key = location_path_key(&canonical_path);
            if seen.insert(key) == false {
                return None;
            }

            Some(FileManagerFavorite {
                id: favorite.id,
                title: if favorite.title.trim().is_empty() {
                    title_for_path(&canonical_path)
                } else {
                    favorite.title
                },
                path: path_to_string(&canonical_path),
                special_id: favorite.special_id,
            })
        })
        .collect();

    FileManagerFavoritesPayload { favorites }
}

fn sanitize_recent_locations(
    payload: FileManagerRecentLocationsPayload,
) -> FileManagerRecentLocationsPayload {
    let mut seen = std::collections::HashSet::new();
    let recent_locations = payload
        .recent_locations
        .into_iter()
        .filter_map(|location| {
            let canonical_path = canonical_directory_path(&location.path)?;
            let key = location_path_key(&canonical_path);
            if seen.insert(key) == false {
                return None;
            }

            Some(FileManagerRecentLocation {
                id: location.id,
                title: if location.title.trim().is_empty() {
                    title_for_path(&canonical_path)
                } else {
                    location.title
                },
                path: path_to_string(&canonical_path),
                last_opened_at: location.last_opened_at,
            })
        })
        .collect();

    FileManagerRecentLocationsPayload { recent_locations }
}

fn read_favorites_from_storage(storage_root: &Path) -> Result<FileManagerFavoritesPayload> {
    read_json_file(&storage_file(storage_root, FAVORITES_FILE_NAME)).map(sanitize_favorites)
}

fn write_favorites_to_storage(
    storage_root: &Path,
    payload: &FileManagerFavoritesPayload,
) -> Result<FileManagerFavoritesPayload> {
    let path = storage_file(storage_root, FAVORITES_FILE_NAME);
    let sanitized = sanitize_favorites(payload.clone());
    write_json_file(&path, &sanitized)?;
    Ok(sanitized)
}

fn read_recent_from_storage(storage_root: &Path) -> Result<FileManagerRecentLocationsPayload> {
    read_json_file(&storage_file(storage_root, RECENT_LOCATIONS_FILE_NAME))
        .map(sanitize_recent_locations)
}

fn write_recent_to_storage(
    storage_root: &Path,
    payload: &FileManagerRecentLocationsPayload,
) -> Result<FileManagerRecentLocationsPayload> {
    let path = storage_file(storage_root, RECENT_LOCATIONS_FILE_NAME);
    let sanitized = sanitize_recent_locations(payload.clone());
    write_json_file(&path, &sanitized)?;
    Ok(sanitized)
}

fn existing_special_location(
    title: &str,
    special_id: &str,
    path: Option<PathBuf>,
    kind: &str,
) -> Option<FileManagerLocation> {
    match path {
        Some(value) if value.exists() => Some(create_location(
            format!("special:{}", special_id),
            title.to_string(),
            kind,
            Some(path_to_string(&value)),
            Some(special_id),
        )),
        Some(_) if special_id == "trash" => Some(create_location(
            format!("special:{}", special_id),
            title.to_string(),
            kind,
            None,
            Some(special_id),
        )),
        None if special_id == "trash" => Some(create_location(
            format!("special:{}", special_id),
            title.to_string(),
            kind,
            None,
            Some(special_id),
        )),
        _ => None,
    }
}

fn unquote_os_release_value(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn map_os_flavor(id: &str, id_like: &[String]) -> String {
    let values = std::iter::once(id.to_string())
        .chain(id_like.iter().cloned())
        .map(|value| value.to_lowercase())
        .collect::<Vec<_>>();

    if values.iter().any(|value| value == "alpine") {
        return "alpine".to_string();
    }

    if values.iter().any(|value| value == "bodhi") {
        return "bodhi".to_string();
    }

    if values.iter().any(|value| value == "openbsd") {
        return "openbsd".to_string();
    }

    if values.iter().any(|value| {
        matches!(
            value.as_str(),
            "arch" | "endeavouros" | "manjaro" | "garuda"
        )
    }) {
        return "arch".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "linuxmint" | "mint"))
    {
        return "mint".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "pop" | "pop_os" | "pop!_os"))
    {
        return "popos".to_string();
    }

    if values.iter().any(|value| value == "zorin") {
        return "zorin".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "ubuntu" | "elementary" | "neon"))
    {
        return "ubuntu".to_string();
    }

    if values.iter().any(|value| value == "kali") {
        return "kali".to_string();
    }

    if values.iter().any(|value| value == "debian") {
        return "debian".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "fedora" | "nobara"))
    {
        return "fedora".to_string();
    }

    if values.iter().any(|value| value == "centos") {
        return "centos".to_string();
    }

    if values.iter().any(|value| {
        matches!(
            value.as_str(),
            "rhel" | "redhat" | "red hat enterprise linux"
        )
    }) {
        return "redhat".to_string();
    }

    if values.iter().any(|value| value == "rocky") {
        return "rocky".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "opensuse" | "suse"))
    {
        return "opensuse".to_string();
    }

    if values.iter().any(|value| value == "void") {
        return "void".to_string();
    }

    if values.iter().any(|value| value == "windows") {
        return "windows".to_string();
    }

    if values
        .iter()
        .any(|value| matches!(value.as_str(), "macos" | "darwin" | "osx"))
    {
        return "macos".to_string();
    }

    if values.iter().any(|value| {
        matches!(
            value.as_str(),
            "linux" | "debian" | "rhel" | "centos" | "rocky" | "almalinux" | "opensuse" | "suse"
        )
    }) {
        return "linux".to_string();
    }

    "unknown".to_string()
}

fn read_os_release_flavor(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path).ok()?;
    let mut id = None;
    let mut id_like = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let Some((key, raw_value)) = trimmed.split_once('=') else {
            continue;
        };
        let value = unquote_os_release_value(raw_value);
        match key {
            "ID" => id = Some(value),
            "ID_LIKE" => {
                id_like = value
                    .split_whitespace()
                    .map(str::trim)
                    .filter(|segment| !segment.is_empty())
                    .map(ToString::to_string)
                    .collect();
            }
            _ => {}
        }
    }

    Some(map_os_flavor(id.as_deref().unwrap_or_default(), &id_like))
}

fn current_host_os_flavor() -> String {
    #[cfg(target_os = "windows")]
    {
        return "windows".to_string();
    }

    #[cfg(target_os = "macos")]
    {
        return "macos".to_string();
    }

    #[cfg(target_os = "linux")]
    {
        return read_os_release_flavor(Path::new("/etc/os-release"))
            .or_else(|| read_os_release_flavor(Path::new("/usr/lib/os-release")))
            .unwrap_or_else(|| "linux".to_string());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        "unknown".to_string()
    }
}

fn mount_has_windows_marker(mount_path: &Path) -> bool {
    mount_path.join("Windows").join("System32").exists()
}

fn mount_has_macos_marker(mount_path: &Path) -> bool {
    mount_path
        .join("System")
        .join("Library")
        .join("CoreServices")
        .join("SystemVersion.plist")
        .exists()
}

fn detect_volume_os_flavor(
    mount_path: &Path,
    mount_path_string: &str,
    system_mounts: &std::collections::HashSet<String>,
    host_flavor: &str,
) -> String {
    if system_mounts.contains(mount_path_string) {
        return host_flavor.to_string();
    }

    if mount_has_windows_marker(mount_path) {
        return "windows".to_string();
    }

    if mount_has_macos_marker(mount_path) {
        return "macos".to_string();
    }

    for candidate in [
        mount_path.join("etc").join("os-release"),
        mount_path.join("usr").join("lib").join("os-release"),
    ] {
        if let Some(flavor) = read_os_release_flavor(&candidate) {
            return flavor;
        }
    }

    "unknown".to_string()
}

fn system_reference_paths() -> Vec<PathBuf> {
    let mut paths = vec![
        std::env::current_exe().ok(),
        dirs::home_dir(),
        dirs::data_dir(),
        dirs::config_dir(),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>();

    #[cfg(target_os = "linux")]
    {
        for extra in ["/boot", "/boot/efi"] {
            let candidate = PathBuf::from(extra);
            if candidate.exists() {
                paths.push(candidate);
            }
        }
    }

    paths
}

fn is_external_mount_path(mount_path: &str) -> bool {
    #[cfg(target_os = "linux")]
    {
        return mount_path.starts_with("/run/media/") || mount_path.starts_with("/media/");
    }
    #[cfg(target_os = "macos")]
    {
        return mount_path.starts_with("/Volumes/");
    }
    #[cfg(target_os = "windows")]
    {
        false
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

fn can_eject_disk(kind: &str, mount_path: &str, device_path: Option<&str>) -> bool {
    if !matches!(kind, "removable" | "external") {
        return false;
    }

    #[cfg(target_os = "macos")]
    {
        return device_path.is_some() && !mount_path.is_empty();
    }

    #[cfg(target_os = "windows")]
    {
        let bytes = mount_path.as_bytes();
        return bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic();
    }

    #[cfg(target_os = "linux")]
    {
        return !mount_path.is_empty()
            && (device_path.is_some()
                || mount_path.starts_with("/run/media/")
                || mount_path.starts_with("/media/"));
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug, Deserialize)]
struct LinuxUnmountedDevicesResponse {
    blockdevices: Vec<LinuxUnmountedDevice>,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Debug, Deserialize)]
struct LinuxUnmountedDevice {
    path: Option<String>,
    pkname: Option<String>,
    #[serde(rename = "type")]
    device_type: Option<String>,
    rm: Option<bool>,
    hotplug: Option<bool>,
    tran: Option<String>,
    mountpoints: Option<Vec<Option<String>>>,
    size: Option<u64>,
    model: Option<String>,
    vendor: Option<String>,
    fstype: Option<String>,
    label: Option<String>,
}

#[cfg(target_os = "linux")]
fn linux_run_command(program: &str, args: &[&str]) -> Result<String> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|error| failure(format!("failed to run {}: {}", program, error)))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let message = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("{} exited with status {}", program, output.status)
    };

    Err(failure(format!("{} failed: {}", program, message)))
}

#[cfg(target_os = "linux")]
fn linux_valid_mountpoints(mountpoints: &Option<Vec<Option<String>>>) -> Vec<String> {
    mountpoints
        .clone()
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .filter(|value| !value.is_empty() && !value.starts_with('['))
        .collect()
}

#[cfg(target_os = "linux")]
fn linux_unmounted_device_kind(removable: bool, hotplug: bool, transport: Option<&str>) -> String {
    if removable {
        return "removable".to_string();
    }

    let normalized_transport = transport.map(str::trim).unwrap_or_default().to_lowercase();
    if hotplug
        || matches!(
            normalized_transport.as_str(),
            "usb" | "firewire" | "thunderbolt"
        )
    {
        return "external".to_string();
    }

    "local".to_string()
}

#[cfg(target_os = "linux")]
fn linux_unmounted_root_title(device: &LinuxUnmountedDevice, fallback: &str) -> String {
    let vendor = device.vendor.as_deref().map(str::trim).unwrap_or_default();
    let model = device.model.as_deref().map(str::trim).unwrap_or_default();
    match (vendor.is_empty(), model.is_empty()) {
        (false, false) => format!("{} {}", vendor, model),
        (false, true) => vendor.to_string(),
        (true, false) => model.to_string(),
        (true, true) => fallback.to_string(),
    }
}

#[cfg(target_os = "linux")]
fn linux_is_mountable_filesystem(file_system: Option<&str>) -> bool {
    let normalized = file_system.unwrap_or_default().trim().to_lowercase();
    !normalized.is_empty() && normalized != "swap"
}

#[cfg(target_os = "linux")]
fn linux_parent_path(device: &LinuxUnmountedDevice) -> Option<String> {
    let pkname = device.pkname.as_deref()?.trim();
    if pkname.is_empty() {
        return None;
    }

    Some(format!("/dev/{}", pkname))
}

#[cfg(target_os = "linux")]
fn linux_is_supported_unmounted_path(path: &str) -> bool {
    !path.starts_with("/dev/loop")
        && !path.starts_with("/dev/zram")
        && !path.starts_with("/dev/ram")
}

#[cfg(target_os = "linux")]
fn linux_has_children(devices: &[LinuxUnmountedDevice], path: &str) -> bool {
    devices
        .iter()
        .any(|candidate| linux_parent_path(candidate).as_deref() == Some(path))
}

#[cfg(target_os = "linux")]
fn linux_root_device<'a>(
    devices: &'a [LinuxUnmountedDevice],
    device: &'a LinuxUnmountedDevice,
) -> &'a LinuxUnmountedDevice {
    let mut current = device;

    for _ in 0..8 {
        let Some(parent_path) = linux_parent_path(current) else {
            break;
        };
        let Some(parent) = devices
            .iter()
            .find(|candidate| candidate.path.as_deref() == Some(parent_path.as_str()))
        else {
            break;
        };
        current = parent;
    }

    current
}

#[cfg(target_os = "linux")]
fn linux_unmounted_device_title(
    device: &LinuxUnmountedDevice,
    root: &LinuxUnmountedDevice,
) -> String {
    let label = device.label.as_deref().map(str::trim).unwrap_or_default();
    if !label.is_empty() {
        return label.to_string();
    }

    let device_path = device.path.as_deref().unwrap_or_default();
    if device.device_type.as_deref() == Some("disk") {
        return linux_unmounted_root_title(device, device_path);
    }

    let root_title = root
        .path
        .as_deref()
        .map(|path| linux_unmounted_root_title(root, path))
        .unwrap_or_default();
    if root_title.is_empty() {
        device_path.to_string()
    } else {
        root_title
    }
}

#[cfg(target_os = "linux")]
fn linux_is_auxiliary_unmounted_volume(
    device: &LinuxUnmountedDevice,
    sibling_has_mounted_content: bool,
) -> bool {
    if sibling_has_mounted_content == false {
        return false;
    }

    let size = device.size.unwrap_or(0);
    if size == 0 || size > 134_217_728 {
        return false;
    }

    let file_system = device
        .fstype
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_lowercase();
    matches!(
        file_system.as_str(),
        "vfat" | "fat" | "fat16" | "fat32" | "efi"
    )
}

#[cfg(target_os = "linux")]
fn push_linux_unmounted_device(
    devices: &mut Vec<FileManagerDevice>,
    title: String,
    device_path: String,
    file_system: Option<String>,
    kind: String,
    is_removable: bool,
    total_bytes: Option<u64>,
) {
    devices.push(FileManagerDevice {
        id: device_path.clone(),
        title,
        device_path: device_path.clone(),
        display_path: Some(device_path),
        file_system: file_system.clone(),
        kind: kind.clone(),
        os_flavor: None,
        total_bytes: total_bytes
            .filter(|value| *value > 0)
            .map(|value| value as f64),
        is_removable,
        can_mount: linux_is_mountable_filesystem(file_system.as_deref()),
        can_eject: matches!(kind.as_str(), "removable" | "external"),
    });
}

#[cfg(target_os = "linux")]
fn linux_collect_unmounted_devices(
    parsed: &LinuxUnmountedDevicesResponse,
) -> Vec<FileManagerDevice> {
    let mut devices = Vec::new();
    for device in &parsed.blockdevices {
        let Some(device_path) = device.path.clone() else {
            continue;
        };
        if linux_is_supported_unmounted_path(&device_path) == false {
            continue;
        }
        if !linux_valid_mountpoints(&device.mountpoints).is_empty() {
            continue;
        }
        if linux_has_children(&parsed.blockdevices, &device_path) {
            continue;
        }

        let file_system = device
            .fstype
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        if linux_is_mountable_filesystem(file_system.as_deref()) == false {
            continue;
        }

        let root = linux_root_device(&parsed.blockdevices, device);
        let root_path = root.path.as_deref().unwrap_or(device_path.as_str());
        let sibling_has_mounted_content = parsed.blockdevices.iter().any(|candidate| {
            linux_parent_path(candidate).as_deref() == Some(root_path)
                && !linux_valid_mountpoints(&candidate.mountpoints).is_empty()
        });
        if linux_is_auxiliary_unmounted_volume(device, sibling_has_mounted_content) {
            continue;
        }

        let root_kind = linux_unmounted_device_kind(
            root.rm.unwrap_or(false),
            root.hotplug.unwrap_or(false),
            root.tran.as_deref(),
        );
        push_linux_unmounted_device(
            &mut devices,
            linux_unmounted_device_title(device, root),
            device_path,
            file_system,
            root_kind,
            root.rm.unwrap_or(false),
            device.size,
        );
    }

    devices.sort_by(|left, right| {
        left.device_path
            .to_lowercase()
            .cmp(&right.device_path.to_lowercase())
    });
    devices
}

#[cfg(target_os = "linux")]
fn read_unmounted_devices() -> Vec<FileManagerDevice> {
    let output = match linux_run_command(
        "lsblk",
        &[
            "-J",
            "-b",
            "-o",
            "PATH,PKNAME,TYPE,RM,HOTPLUG,TRAN,MOUNTPOINTS,SIZE,MODEL,VENDOR,FSTYPE,LABEL",
        ],
    ) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let parsed: LinuxUnmountedDevicesResponse = match serde_json::from_str(&output) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    linux_collect_unmounted_devices(&parsed)
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Deserialize)]
struct MacDiskutilListResponse {
    #[serde(rename = "AllDisksAndPartitions", default)]
    all_disks_and_partitions: Vec<MacDiskutilListEntry>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Deserialize)]
struct MacDiskutilListEntry {
    #[serde(rename = "DeviceIdentifier")]
    device_identifier: String,
    #[serde(rename = "Content")]
    content: Option<String>,
    #[serde(rename = "Size")]
    size: Option<u64>,
    #[serde(rename = "VolumeName")]
    volume_name: Option<String>,
    #[serde(rename = "MountPoint")]
    mount_point: Option<String>,
    #[serde(rename = "Partitions", default)]
    partitions: Vec<MacDiskutilListEntry>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Debug, Deserialize)]
struct MacDiskutilInfo {
    #[serde(rename = "DeviceNode")]
    device_node: Option<String>,
    #[serde(rename = "VolumeName")]
    volume_name: Option<String>,
    #[serde(rename = "MediaName")]
    media_name: Option<String>,
    #[serde(rename = "FilesystemType")]
    filesystem_type: Option<String>,
    #[serde(rename = "FilesystemName")]
    filesystem_name: Option<String>,
    #[serde(rename = "RemovableMedia")]
    removable_media: Option<bool>,
    #[serde(rename = "Internal")]
    internal: Option<bool>,
    #[serde(rename = "TotalSize")]
    total_size: Option<u64>,
    #[serde(rename = "MountPoint")]
    mount_point: Option<String>,
}

#[cfg(target_os = "macos")]
fn macos_shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(target_os = "macos")]
fn macos_run_json_shell(script: &str) -> Result<String> {
    let output = Command::new("sh")
        .args(["-c", script])
        .output()
        .map_err(|error| failure(format!("failed to run macOS shell command: {}", error)))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(failure(format!("macOS shell command failed: {}", stderr)))
}

#[cfg(target_os = "macos")]
fn macos_device_path(device_identifier: &str) -> String {
    if device_identifier.starts_with("/dev/") {
        device_identifier.to_string()
    } else {
        format!("/dev/{}", device_identifier)
    }
}

#[cfg(target_os = "macos")]
fn macos_read_diskutil_info(device_identifier: &str) -> Option<MacDiskutilInfo> {
    let script = format!(
        "diskutil info -plist {} | plutil -convert json -o - -",
        macos_shell_quote(&macos_device_path(device_identifier))
    );
    let output = macos_run_json_shell(&script).ok()?;
    serde_json::from_str(&output).ok()
}

#[cfg(target_os = "macos")]
fn macos_device_kind(info: &MacDiskutilInfo) -> String {
    if info.removable_media.unwrap_or(false) {
        return "removable".to_string();
    }

    if info.internal.unwrap_or(false) {
        return "local".to_string();
    }

    "external".to_string()
}

#[cfg(target_os = "macos")]
fn macos_is_auxiliary_partition(
    entry: &MacDiskutilListEntry,
    info: &MacDiskutilInfo,
    sibling_has_mounted_content: bool,
) -> bool {
    let content = entry
        .content
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_lowercase();
    if matches!(
        content.as_str(),
        "efi" | "apple_apfs_isc" | "apple_apfs_recovery" | "apple_apfs_preboot"
    ) {
        return true;
    }

    if sibling_has_mounted_content == false {
        return false;
    }

    let size = entry.size.or(info.total_size).unwrap_or(0);
    if size == 0 || size > 134_217_728 {
        return false;
    }

    let file_system = info
        .filesystem_type
        .as_deref()
        .or(info.filesystem_name.as_deref())
        .map(str::trim)
        .unwrap_or_default()
        .to_lowercase();
    matches!(
        file_system.as_str(),
        "ms-dos fat32" | "ms-dos" | "fat32" | "exfat"
    )
}

#[cfg(target_os = "macos")]
fn read_unmounted_devices() -> Vec<FileManagerDevice> {
    let output = match macos_run_json_shell("diskutil list -plist | plutil -convert json -o - -") {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let parsed: MacDiskutilListResponse = match serde_json::from_str(&output) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    let mut devices = Vec::new();
    for root in &parsed.all_disks_and_partitions {
        let Some(root_info) = macos_read_diskutil_info(&root.device_identifier) else {
            continue;
        };
        let root_kind = macos_device_kind(&root_info);
        let sibling_has_mounted_content = root.partitions.iter().any(|partition| {
            partition
                .mount_point
                .as_deref()
                .is_some_and(|value| !value.trim().is_empty())
        });

        if !root.partitions.is_empty() {
            for partition in &root.partitions {
                if partition
                    .mount_point
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                {
                    continue;
                }
                let Some(partition_info) = macos_read_diskutil_info(&partition.device_identifier)
                else {
                    continue;
                };
                if partition_info
                    .mount_point
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty())
                {
                    continue;
                }
                if macos_is_auxiliary_partition(
                    partition,
                    &partition_info,
                    sibling_has_mounted_content,
                ) {
                    continue;
                }

                let device_path = partition_info
                    .device_node
                    .clone()
                    .unwrap_or_else(|| macos_device_path(&partition.device_identifier));
                let file_system = partition_info
                    .filesystem_type
                    .as_deref()
                    .or(partition_info.filesystem_name.as_deref())
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(ToString::to_string);
                devices.push(FileManagerDevice {
                    id: device_path.clone(),
                    title: partition_info
                        .volume_name
                        .clone()
                        .or(partition.volume_name.clone())
                        .or(partition_info.media_name.clone())
                        .unwrap_or_else(|| device_path.clone()),
                    device_path: device_path.clone(),
                    display_path: Some(device_path),
                    file_system: file_system.clone(),
                    kind: root_kind.clone(),
                    os_flavor: None,
                    total_bytes: partition
                        .size
                        .or(partition_info.total_size)
                        .map(|value| value as f64),
                    is_removable: root_info.removable_media.unwrap_or(false),
                    can_mount: file_system.is_some(),
                    can_eject: matches!(root_kind.as_str(), "removable" | "external"),
                });
            }
            continue;
        }

        if root_info
            .mount_point
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        {
            continue;
        }

        let device_path = root_info
            .device_node
            .clone()
            .unwrap_or_else(|| macos_device_path(&root.device_identifier));
        let file_system = root_info
            .filesystem_type
            .as_deref()
            .or(root_info.filesystem_name.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string);
        devices.push(FileManagerDevice {
            id: device_path.clone(),
            title: root_info
                .volume_name
                .clone()
                .or(root.volume_name.clone())
                .or(root_info.media_name.clone())
                .unwrap_or_else(|| device_path.clone()),
            device_path: device_path.clone(),
            display_path: Some(device_path),
            file_system: file_system.clone(),
            kind: root_kind.clone(),
            os_flavor: None,
            total_bytes: root.size.or(root_info.total_size).map(|value| value as f64),
            is_removable: root_info.removable_media.unwrap_or(false),
            can_mount: file_system.is_some(),
            can_eject: matches!(root_kind.as_str(), "removable" | "external"),
        });
    }

    devices.sort_by(|left, right| {
        left.device_path
            .to_lowercase()
            .cmp(&right.device_path.to_lowercase())
    });
    devices
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WindowsUnmountedDevice {
    device_path: String,
    display_path: Option<String>,
    title: String,
    file_system: Option<String>,
    kind: String,
    total_bytes: Option<f64>,
    is_removable: bool,
    can_mount: bool,
    can_eject: bool,
}

#[cfg(target_os = "windows")]
fn windows_powershell_escape(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn read_unmounted_devices() -> Vec<FileManagerDevice> {
    let script = "$items = Get-Partition | ForEach-Object { \
        $partition = $_; \
        $accessPaths = @($partition.AccessPaths | Where-Object { $_ -and $_ -ne '' }); \
        if ($accessPaths.Count -gt 0) { return }; \
        if ($partition.GptType -in @('{C12A7328-F81F-11D2-BA4B-00A0C93EC93B}','{DE94BBA4-06D1-4D40-A16A-BFD50179D6AC}','{E3C9E316-0B5C-4DB8-817D-F92DF00215AE}')) { return }; \
        $volume = Get-Volume -Partition $partition -ErrorAction SilentlyContinue; \
        if ($null -eq $volume) { return }; \
        if ($null -ne $volume.DriveLetter -and $volume.DriveLetter -ne '') { return }; \
        if ($volume.Size -lt 134217728 -and $volume.FileSystem -match 'FAT') { return }; \
        if ($null -eq $volume.UniqueId -or $volume.UniqueId -eq '') { return }; \
        $disk = Get-Disk -Number $partition.DiskNumber -ErrorAction SilentlyContinue; \
        $busType = if ($null -ne $disk) { [string]$disk.BusType } else { '' }; \
        $kind = if ($null -ne $disk -and ($disk.IsBoot -or $disk.IsSystem)) { 'system' } elseif ($volume.DriveType -eq 2) { 'removable' } elseif ($busType -in @('USB','FireWire','Thunderbolt','SD')) { 'external' } else { 'local' }; \
        [pscustomobject]@{ \
          devicePath = $volume.UniqueId; \
          displayPath = ('Disk ' + $partition.DiskNumber + ' Partition ' + $partition.PartitionNumber); \
          title = if ($volume.FileSystemLabel) { $volume.FileSystemLabel } elseif ($null -ne $disk -and $disk.FriendlyName) { $disk.FriendlyName } else { 'Unmounted Volume' }; \
          fileSystem = $volume.FileSystem; \
          kind = $kind; \
          totalBytes = if ($volume.Size -gt 0) { [double]$volume.Size } else { $null }; \
          isRemovable = ($volume.DriveType -eq 2); \
          canMount = $true; \
          canEject = $false \
        } \
      }; \
      if ($null -eq $items) { '[]' } else { @($items) | ConvertTo-Json -Depth 4 -Compress }";

    let output = match Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    {
        Ok(value) if value.status.success() => {
            String::from_utf8_lossy(&value.stdout).trim().to_string()
        }
        _ => return Vec::new(),
    };

    let parsed: Vec<WindowsUnmountedDevice> = match serde_json::from_str(&output) {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    parsed
        .into_iter()
        .map(|device| FileManagerDevice {
            id: device.device_path.clone(),
            title: device.title,
            device_path: device.device_path.clone(),
            display_path: device.display_path,
            file_system: device.file_system,
            kind: device.kind,
            os_flavor: None,
            total_bytes: device.total_bytes,
            is_removable: device.is_removable,
            can_mount: device.can_mount,
            can_eject: device.can_eject,
        })
        .collect()
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn read_unmounted_devices() -> Vec<FileManagerDevice> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn mac_trash_root() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| failure("home directory is unavailable"))?;
    Ok(home.join(".Trash"))
}

#[cfg(target_os = "macos")]
fn read_mac_trash_index(storage_root: &Path) -> Result<MacTrashIndex> {
    read_json_file(&storage_file(storage_root, MAC_TRASH_INDEX_FILE_NAME))
}

#[cfg(target_os = "macos")]
fn write_mac_trash_index(storage_root: &Path, index: &MacTrashIndex) -> Result<()> {
    write_json_file(
        &storage_file(storage_root, MAC_TRASH_INDEX_FILE_NAME),
        index,
    )
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
        let source = normalize_path(raw_path)?;
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

fn system_locations() -> Vec<FileManagerLocation> {
    let mut locations = Vec::new();

    if let Some(home_dir) = dirs::home_dir() {
        locations.push(create_location(
            "special:home".to_string(),
            "Home".to_string(),
            "special",
            Some(path_to_string(&home_dir)),
            Some("home"),
        ));
    }

    if let Some(location) =
        existing_special_location("Desktop", "desktop", dirs::desktop_dir(), "special")
    {
        locations.push(location);
    }
    if let Some(location) =
        existing_special_location("Documents", "documents", dirs::document_dir(), "special")
    {
        locations.push(location);
    }
    if let Some(location) =
        existing_special_location("Downloads", "downloads", dirs::download_dir(), "special")
    {
        locations.push(location);
    }

    #[cfg(target_os = "macos")]
    let trash_path = mac_trash_root().ok();
    #[cfg(not(target_os = "macos"))]
    let trash_path: Option<PathBuf> = None;

    if let Some(location) = existing_special_location("Trash", "trash", trash_path, "trash") {
        locations.push(location);
    } else {
        locations.push(create_location(
            "special:trash".to_string(),
            "Trash".to_string(),
            "trash",
            None,
            Some("trash"),
        ));
    }

    locations
}

fn read_disks() -> Vec<FileManagerDisk> {
    let disks = Disks::new_with_refreshed_list();
    let reference_paths = system_reference_paths();
    let host_flavor = current_host_os_flavor();

    let system_mounts = disks
        .list()
        .iter()
        .filter_map(|disk| {
            let mount = disk.mount_point();
            let matches_system = reference_paths
                .iter()
                .any(|reference_path| reference_path.starts_with(mount));
            if matches_system {
                Some(path_to_string(mount))
            } else {
                None
            }
        })
        .collect::<std::collections::HashSet<_>>();

    let mut items = disks
        .list()
        .iter()
        .filter_map(|disk| {
            let total_bytes = disk.total_space() as f64;
            if total_bytes <= 0.0 {
                return None;
            }

            let available_bytes = disk.available_space() as f64;
            let used_bytes = (total_bytes - available_bytes).max(0.0);
            let mount_path = path_to_string(disk.mount_point());
            let device_path = {
                let value = os_to_string(disk.name());
                if value.trim().is_empty() {
                    None
                } else {
                    Some(value)
                }
            };
            let title = {
                let name = device_path.clone().unwrap_or_default();
                if name.is_empty() || name == mount_path {
                    mount_path.clone()
                } else {
                    name
                }
            };

            let kind = if disk.is_removable() {
                "removable".to_string()
            } else if system_mounts.contains(&mount_path) {
                "system".to_string()
            } else if is_external_mount_path(&mount_path) {
                "external".to_string()
            } else {
                match disk.kind() {
                    DiskKind::SSD | DiskKind::HDD | DiskKind::Unknown(_) => "local".to_string(),
                }
            };
            let os_flavor = detect_volume_os_flavor(
                disk.mount_point(),
                &mount_path,
                &system_mounts,
                &host_flavor,
            );
            let can_eject = can_eject_disk(kind.as_str(), &mount_path, device_path.as_deref());

            Some(FileManagerDisk {
                id: mount_path.clone(),
                title,
                mount_path,
                device_path,
                file_system: disk.file_system().to_string_lossy().into_owned(),
                kind,
                os_flavor: Some(os_flavor),
                total_bytes,
                available_bytes,
                used_bytes,
                usage_ratio: if total_bytes > 0.0 {
                    used_bytes / total_bytes
                } else {
                    0.0
                },
                is_removable: disk.is_removable(),
                can_eject,
            })
        })
        .collect::<Vec<_>>();

    items.sort_by(|left, right| {
        left.mount_path
            .to_lowercase()
            .cmp(&right.mount_path.to_lowercase())
    });
    items
}

#[napi]
pub fn read_home(request: StorageRootRequest) -> Result<FileManagerReadHomeResponse> {
    let storage_root = ensure_storage_root(&request.storage_root)?;
    let favorites = read_favorites_from_storage(&storage_root)?;
    let recent_locations = read_recent_from_storage(&storage_root)?;

    Ok(FileManagerReadHomeResponse {
        location: create_location(
            "home".to_string(),
            "File Manager".to_string(),
            "home",
            None,
            Some("home"),
        ),
        system_locations: system_locations(),
        favorites: favorites.favorites,
        recent_locations: recent_locations.recent_locations,
        disks: read_disks(),
        devices: read_unmounted_devices(),
    })
}

#[napi]
pub fn read_directory(
    request: FileManagerReadDirectoryRequest,
) -> Result<FileManagerReadDirectoryResponse> {
    let path = normalize_path(&request.path)?;
    let canonical_path = path
        .canonicalize()
        .map_err(|error| io_error(format!("failed to access {}", path.display()), error))?;
    let metadata = fs::metadata(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    if !metadata.is_dir() {
        return Err(invalid_arg(format!(
            "{} is not a directory",
            canonical_path.display()
        )));
    }

    let mut entries = fs::read_dir(&canonical_path)
        .map_err(|error| {
            io_error(
                format!("failed to read {}", canonical_path.display()),
                error,
            )
        })?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .map(|entry_path| entry_from_path(&entry_path))
        .collect::<Result<Vec<_>>>()?;
    sort_entries(&mut entries);

    Ok(FileManagerReadDirectoryResponse {
        location: create_location(
            path_to_string(&canonical_path),
            title_for_path(&canonical_path),
            "directory",
            Some(path_to_string(&canonical_path)),
            None,
        ),
        parent_path: canonical_path.parent().map(path_to_string),
        entries,
    })
}

#[napi]
pub fn read_trash(_request: StorageRootRequest) -> Result<FileManagerReadTrashResponse> {
    #[cfg(target_os = "macos")]
    {
        let storage_root = ensure_storage_root(&_request.storage_root)?;
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

#[napi]
pub fn create_file(
    request: FileManagerCreateFileRequest,
) -> Result<FileManagerDirectoryMutationResponse> {
    let parent_path = normalize_path(&request.parent_path)?;
    let name = normalize_name(&request.name)?;
    let full_path = parent_path.join(name);
    File::create_new(&full_path)
        .map_err(|error| io_error(format!("failed to create {}", full_path.display()), error))?;
    Ok(FileManagerDirectoryMutationResponse {
        entry: Some(entry_from_path(&full_path)?),
    })
}

#[napi]
pub fn create_folder(
    request: FileManagerCreateFolderRequest,
) -> Result<FileManagerDirectoryMutationResponse> {
    let parent_path = normalize_path(&request.parent_path)?;
    let name = normalize_name(&request.name)?;
    let full_path = parent_path.join(name);
    fs::create_dir(&full_path)
        .map_err(|error| io_error(format!("failed to create {}", full_path.display()), error))?;
    Ok(FileManagerDirectoryMutationResponse {
        entry: Some(entry_from_path(&full_path)?),
    })
}

#[napi]
pub fn move_to_trash(request: FileManagerMoveToTrashRequest) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let storage_root = ensure_storage_root(&request.storage_root)?;
        return move_to_trash_macos(&request.paths, &storage_root);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let paths = request
            .paths
            .iter()
            .map(|path| normalize_path(path))
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

#[napi]
pub fn restore_from_trash(request: FileManagerRestoreFromTrashRequest) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let storage_root = ensure_storage_root(&request.storage_root)?;
        return restore_from_trash_macos(&request.item_ids, &storage_root);
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
        let items = find_native_trash_items(&request.item_ids)?;
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

#[napi]
pub fn empty_trash(_request: StorageRootRequest) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        let storage_root = ensure_storage_root(&_request.storage_root)?;
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

#[napi]
pub fn eject_device(
    request: FileManagerEjectDeviceRequest,
) -> Result<FileManagerEjectDeviceResult> {
    let mount_path = normalize_path(&request.mount_path)?;
    let device_path = request
        .device_path
        .as_deref()
        .map(normalize_path)
        .transpose()?;
    let mount_path_string = path_to_string(&mount_path);
    let device_path_string = device_path.as_deref().map(|path| path_to_string(path));
    let outcome = safely_eject_device(
        &mount_path_string,
        device_path_string.as_deref(),
        &request.kind,
    )?;

    Ok(FileManagerEjectDeviceResult {
        ejected: true,
        powered_off: outcome.powered_off,
        strategy: outcome.strategy.to_string(),
    })
}

#[napi]
pub fn mount_device(
    request: FileManagerMountDeviceRequest,
) -> Result<FileManagerMountDeviceResult> {
    let device_path = normalize_path(&request.device_path)?;
    let device_path_string = path_to_string(&device_path);
    let outcome = perform_mount_device(&device_path_string, &request.kind)?;

    Ok(FileManagerMountDeviceResult {
        mounted: true,
        mount_path: outcome.mount_path,
        strategy: outcome.strategy.to_string(),
    })
}

#[napi]
pub fn read_favorites(request: StorageRootRequest) -> Result<FileManagerFavoritesPayload> {
    let storage_root = ensure_storage_root(&request.storage_root)?;
    read_favorites_from_storage(&storage_root)
}

#[napi]
pub fn write_favorites(
    request: FileManagerFavoritesWriteRequest,
) -> Result<FileManagerFavoritesPayload> {
    let root = ensure_storage_root(&request.storage_root)?;
    write_favorites_to_storage(
        &root,
        &FileManagerFavoritesPayload {
            favorites: request.favorites,
        },
    )
}

#[napi]
pub fn read_recent_locations(
    request: StorageRootRequest,
) -> Result<FileManagerRecentLocationsPayload> {
    let storage_root = ensure_storage_root(&request.storage_root)?;
    read_recent_from_storage(&storage_root)
}

#[napi]
pub fn write_recent_locations(
    request: FileManagerRecentLocationsWriteRequest,
) -> Result<FileManagerRecentLocationsPayload> {
    let root = ensure_storage_root(&request.storage_root)?;
    write_recent_to_storage(
        &root,
        &FileManagerRecentLocationsPayload {
            recent_locations: request.recent_locations,
        },
    )
}

#[napi]
pub fn read_text_file(request: FileReadTextRequest) -> Result<FileReadResult> {
    let file_path = normalize_path(&request.path)?;
    let canonical_path = file_path
        .canonicalize()
        .map_err(|error| io_error(format!("failed to access {}", file_path.display()), error))?;
    let metadata = fs::metadata(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    if metadata.is_file() == false {
        return Err(invalid_arg(format!(
            "{} is not a file",
            canonical_path.display()
        )));
    }

    let forced_read_only = metadata.len() > MAX_EDITABLE_TEXT_FILE_BYTES;
    let read_only = metadata.permissions().readonly() || forced_read_only;
    let size_bytes = metadata.len() as f64;
    let path_string = path_to_string(&canonical_path);

    if metadata.len() > MAX_READONLY_TEXT_FILE_BYTES {
        return Ok(FileReadResult {
            kind: "unsupported".to_string(),
            path: path_string,
            reason: Some("file-too-large".to_string()),
            revision: None,
            encoding: None,
            read_only,
            size_bytes,
            content: None,
        });
    }

    let bytes = fs::read(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    let revision = sha256_hex(&bytes);

    let (content, encoding) = match decode_text_content(&bytes) {
        Ok(value) => value,
        Err(reason) => {
            return Ok(FileReadResult {
                kind: "unsupported".to_string(),
                path: path_string,
                reason: Some(reason),
                revision: Some(revision),
                encoding: None,
                read_only,
                size_bytes,
                content: None,
            })
        }
    };

    Ok(FileReadResult {
        kind: "text".to_string(),
        path: path_string,
        reason: None,
        revision: Some(revision),
        encoding: Some(encoding),
        read_only,
        size_bytes,
        content: Some(content),
    })
}

#[napi]
pub fn write_text_file(request: FileWriteTextRequest) -> Result<FileWriteResult> {
    let file_path = normalize_path(&request.path)?;
    let canonical_path = file_path
        .canonicalize()
        .map_err(|error| io_error(format!("failed to access {}", file_path.display()), error))?;
    let metadata = fs::metadata(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    if metadata.is_file() == false {
        return Err(invalid_arg(format!(
            "{} is not a file",
            canonical_path.display()
        )));
    }
    if metadata.permissions().readonly() {
        return Err(invalid_arg("file is read-only"));
    }
    if metadata.len() > MAX_EDITABLE_TEXT_FILE_BYTES {
        return Err(invalid_arg("file is too large for editing"));
    }

    let current_bytes = fs::read(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    let current_revision = sha256_hex(&current_bytes);
    let expected_revision = request
        .expected_revision
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(expected) = expected_revision.as_ref() {
        if expected != &current_revision {
            return Ok(FileWriteResult {
                ok: false,
                kind: Some("revision-conflict".to_string()),
                path: path_to_string(&canonical_path),
                message: Some("file changed outside Lyra".to_string()),
                expected_revision,
                current_revision: Some(current_revision),
                revision: None,
                encoding: None,
                saved_at: None,
            });
        }
    }

    let resolved_encoding = match request
        .encoding
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        Some(value) => normalize_text_encoding(Some(value))?,
        None => decode_text_content(&current_bytes)
            .map(|(_, encoding)| encoding)
            .unwrap_or_else(|_| "utf8".to_string()),
    };

    let next_bytes = encode_text_content(&request.content, &resolved_encoding);
    write_bytes_atomically(&canonical_path, &next_bytes)?;

    let revision = sha256_hex(&next_bytes);
    let saved_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string());

    Ok(FileWriteResult {
        ok: true,
        kind: None,
        path: path_to_string(&canonical_path),
        message: None,
        expected_revision: None,
        current_revision: None,
        revision: Some(revision),
        encoding: Some(resolved_encoding),
        saved_at: Some(saved_at),
    })
}

#[napi]
pub fn stat_file(request: FileStatRequest) -> Result<FileStatResult> {
    let file_path = normalize_path(&request.path)?;
    let canonical_path = match file_path.canonicalize() {
        Ok(path) => path,
        Err(_) => {
            return Ok(FileStatResult {
                path: path_to_string(&file_path),
                exists: false,
                is_directory: false,
                read_only: false,
                size_bytes: 0.0,
                modified_at: None,
                revision: None,
            })
        }
    };

    let metadata = fs::metadata(&canonical_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_path.display()),
            error,
        )
    })?;
    let is_directory = metadata.is_dir();
    let revision = if is_directory {
        None
    } else {
        let bytes = fs::read(&canonical_path).map_err(|error| {
            io_error(
                format!("failed to read {}", canonical_path.display()),
                error,
            )
        })?;
        Some(sha256_hex(&bytes))
    };

    Ok(FileStatResult {
        path: path_to_string(&canonical_path),
        exists: true,
        is_directory,
        read_only: metadata.permissions().readonly(),
        size_bytes: metadata.len() as f64,
        modified_at: metadata.modified().ok().and_then(seconds_since_epoch),
        revision,
    })
}

#[napi]
pub fn probe_workbench_path(
    request: WorkbenchPathProbeRequest,
) -> Result<WorkbenchPathProbeResult> {
    let normalized_path = normalize_absolute_path(&request.path)?;
    let existing_path = normalized_path.canonicalize().ok();

    let directory_path = match existing_path.as_ref() {
        Some(existing) => {
            let metadata = fs::metadata(existing).map_err(|error| {
                io_error(format!("failed to read {}", existing.display()), error)
            })?;
            if metadata.is_dir() {
                Some(existing.clone())
            } else {
                existing.parent().map(Path::to_path_buf)
            }
        }
        None => None,
    };

    let project_root = directory_path
        .as_ref()
        .map(|directory| find_git_root(directory).unwrap_or_else(|| directory.clone()));

    Ok(WorkbenchPathProbeResult {
        normalized_path: path_to_string(&normalized_path),
        existing_path: existing_path.as_ref().map(|value| path_to_string(value)),
        directory_path: directory_path.as_ref().map(|value| path_to_string(value)),
        project_root: project_root.as_ref().map(|value| path_to_string(value)),
    })
}

#[napi]
pub fn collect_workbench_file_paths(
    request: WorkbenchCollectFilePathsRequest,
) -> Result<Vec<WorkbenchCollectedFilePath>> {
    let normalized_root_path = normalize_absolute_path(&request.root_path)?;
    let canonical_root_path = normalized_root_path.canonicalize().map_err(|error| {
        io_error(
            format!("failed to access {}", normalized_root_path.display()),
            error,
        )
    })?;
    let root_metadata = fs::metadata(&canonical_root_path).map_err(|error| {
        io_error(
            format!("failed to read {}", canonical_root_path.display()),
            error,
        )
    })?;

    if root_metadata.is_dir() == false {
        return Err(invalid_arg(format!(
            "{} is not a directory",
            canonical_root_path.display()
        )));
    }

    let normalized_base_path = match request
        .base_path
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| value.is_empty() == false)
    {
        Some(value) => normalize_absolute_path(value)?,
        None => canonical_root_path.clone(),
    };
    let base_path = normalized_base_path
        .canonicalize()
        .unwrap_or(normalized_base_path);

    let mut collected = Vec::new();
    collect_workbench_file_paths_recursive(&canonical_root_path, &base_path, &mut collected)?;
    collected.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(collected)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::{
        linux_collect_unmounted_devices, FileManagerDevice, LinuxUnmountedDevice,
        LinuxUnmountedDevicesResponse,
    };

    fn linux_device(
        path: &str,
        pkname: Option<&str>,
        device_type: &str,
        mountpoints: &[&str],
        size: u64,
        file_system: Option<&str>,
        label: Option<&str>,
    ) -> LinuxUnmountedDevice {
        LinuxUnmountedDevice {
            path: Some(path.to_string()),
            pkname: pkname.map(ToString::to_string),
            device_type: Some(device_type.to_string()),
            rm: Some(path.starts_with("/dev/sd")),
            hotplug: Some(path.starts_with("/dev/sd")),
            tran: if path.starts_with("/dev/sd") {
                Some("usb".to_string())
            } else {
                Some("nvme".to_string())
            },
            mountpoints: Some(
                mountpoints
                    .iter()
                    .map(|value| Some((*value).to_string()))
                    .collect(),
            ),
            size: Some(size),
            model: Some("Test Device".to_string()),
            vendor: Some("Test Vendor".to_string()),
            fstype: file_system.map(ToString::to_string),
            label: label.map(ToString::to_string),
        }
    }

    fn device_paths(items: &[FileManagerDevice]) -> Vec<String> {
        items.iter().map(|item| item.device_path.clone()).collect()
    }

    #[test]
    fn linux_unmounted_devices_exclude_parent_disks_with_mounted_children() {
        let parsed = LinuxUnmountedDevicesResponse {
            blockdevices: vec![
                linux_device(
                    "/dev/nvme0n1",
                    None,
                    "disk",
                    &[],
                    512_000_000_000,
                    None,
                    None,
                ),
                linux_device(
                    "/dev/nvme0n1p1",
                    Some("nvme0n1"),
                    "part",
                    &["/boot"],
                    1_073_741_824,
                    Some("vfat"),
                    None,
                ),
                linux_device(
                    "/dev/nvme0n1p2",
                    Some("nvme0n1"),
                    "part",
                    &["/"],
                    50_000_000_000,
                    Some("ext4"),
                    None,
                ),
                linux_device("/dev/sda", None, "disk", &[], 123_000_000_000, None, None),
                linux_device(
                    "/dev/sda1",
                    Some("sda"),
                    "part",
                    &["/run/media/lyra/Ventoy"],
                    123_000_000_000,
                    Some("exfat"),
                    Some("Ventoy"),
                ),
                linux_device(
                    "/dev/sda2",
                    Some("sda"),
                    "part",
                    &[],
                    33_554_432,
                    Some("vfat"),
                    Some("VTOYEFI"),
                ),
            ],
        };

        let devices = linux_collect_unmounted_devices(&parsed);
        let paths = device_paths(&devices);

        assert_eq!(paths, Vec::<String>::new());
    }

    #[test]
    fn linux_unmounted_devices_include_mountable_leaf_volumes() {
        let parsed = LinuxUnmountedDevicesResponse {
            blockdevices: vec![linux_device(
                "/dev/sdb",
                None,
                "disk",
                &[],
                64_000_000_000,
                Some("exfat"),
                Some("SanDisk"),
            )],
        };

        let devices = linux_collect_unmounted_devices(&parsed);

        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].device_path, "/dev/sdb");
        assert_eq!(devices[0].title, "SanDisk");
        assert!(devices[0].can_mount);
    }
}
