use std::fs::{self, File};
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Deserialize;
use serde_json::{json, Value};

use crate::directory_host::{entry_from_core, poll_directory_patches};
use crate::eject::safely_eject_device;
use crate::mount::mount_device;
use crate::paths::{normalize_name, normalize_path, path_to_string};
use crate::preferences::{
    ensure_storage_root, read_favorites_from_storage, read_recent_from_storage,
    write_favorites_to_storage, write_recent_to_storage, FileManagerFavoritesPayload,
    FileManagerRecentLocationsPayload,
};
use crate::text_file::{self, FileWriteTextRequest};
use crate::workbench_paths::{collect_workbench_file_paths, probe_workbench_path};
use crate::wire::{
    FileManagerCreateFileRequest, FileManagerCreateFolderRequest, FileManagerEjectDeviceRequest,
    FileManagerFavoritesWriteRequest, FileManagerMountDeviceRequest, FileManagerMoveToTrashRequest,
    FileManagerReadDirectoryRequest, FileManagerRecentLocationsWriteRequest,
    FileManagerRestoreFromTrashRequest, FileManagerUnsubscribeDirectoryRequest, FileReadTextRequest,
    FileStatRequest, FileWriteTextRequest as WireWriteTextRequest, StorageRootRequest,
    WorkbenchCollectFilePathsRequest, WorkbenchPathProbeRequest,
};
use crate::{fail, FilesCoreError};

pub const FILES_METHODS: &[&str] = &[
    "files.read_home",
    "files.read_directory",
    "files.subscribe_directory",
    "files.unsubscribe_directory",
    "files.read_trash",
    "files.create_file",
    "files.create_folder",
    "files.move_to_trash",
    "files.restore_from_trash",
    "files.empty_trash",
    "files.mount_device",
    "files.eject_device",
    "files.read_favorites",
    "files.write_favorites",
    "files.read_recent_locations",
    "files.write_recent_locations",
    "files.read_text",
    "files.write_text",
    "files.stat",
    "files.search_text",
    "files.probe_workbench_path",
    "files.collect_workbench_paths",
];

pub const FILES_DIRECTORY_PATCH_EVENT: &str = "files.directoryPatch";

pub type FilesEventCallback = Arc<dyn Fn(String, String) + Send + Sync + 'static>;

static FILES_EVENT_CALLBACK: OnceLock<Mutex<Option<FilesEventCallback>>> = OnceLock::new();
static PATCH_POLLER: OnceLock<()> = OnceLock::new();

pub fn register_files_event_callback(callback: FilesEventCallback) {
    *callback_slot() = Some(callback);
    ensure_patch_poller();
}

pub fn clear_files_event_callback() {
    *callback_slot() = None;
}

fn callback_slot() -> std::sync::MutexGuard<'static, Option<FilesEventCallback>> {
    FILES_EVENT_CALLBACK
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn emit_event(event: &str, payload: &Value) {
    let Ok(encoded) = serde_json::to_string(payload) else {
        return;
    };
    if let Some(callback) = callback_slot().as_ref() {
        callback(event.to_string(), encoded);
    }
}

fn ensure_patch_poller() {
    PATCH_POLLER.get_or_init(|| {
        let _ = std::thread::Builder::new()
            .name("lyra-files-watch".to_string())
            .spawn(|| loop {
                std::thread::sleep(Duration::from_millis(150));
                match poll_directory_patches() {
                    Ok(patches) if patches.is_empty() => {}
                    Ok(patches) => {
                        for patch in patches {
                            if let Ok(payload) = serde_json::to_value(&patch) {
                                emit_event(FILES_DIRECTORY_PATCH_EVENT, &payload);
                            }
                        }
                    }
                    Err(_) => {}
                }
            });
    });
}

fn decode<'a, T: Deserialize<'a>>(payload: &'a str) -> Result<T, String> {
    serde_json::from_str(payload).map_err(|error| error.to_string())
}

fn encode<T: serde::Serialize>(value: T) -> Result<String, String> {
    serde_json::to_string(&value).map_err(|error| error.to_string())
}

fn map_core(error: FilesCoreError) -> String {
    error.to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchTextRequest {
    root_path: String,
    query: String,
    limit: Option<u32>,
}

const SKIP_EXTENSIONS: &[&str] = &[
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".avif", ".woff", ".woff2",
    ".ttf", ".otf", ".eot", ".mp3", ".mp4", ".wav", ".zip", ".gz", ".br", ".wasm", ".pdf", ".exe",
    ".dll", ".so", ".dylib", ".o", ".a", ".class", ".jar",
];
const MAX_SEARCH_FILE_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_SEARCH_LIMIT: usize = 200;
const MAX_SEARCH_LIMIT: usize = 500;

fn search_text(request: SearchTextRequest) -> Result<Value, String> {
    let query = request.query.trim();
    if query.is_empty() {
        return Err("query is required".to_string());
    }
    let limit = request
        .limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_SEARCH_LIMIT)
        .clamp(1, MAX_SEARCH_LIMIT);
    let collected = collect_workbench_file_paths(&request.root_path, None).map_err(map_core)?;
    let mut hits = Vec::new();
    let mut truncated = false;
    for item in collected {
        if hits.len() >= limit {
            truncated = true;
            break;
        }
        let path = Path::new(&item.path);
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| format!(".{}", value.to_ascii_lowercase()))
            .unwrap_or_default();
        if SKIP_EXTENSIONS.contains(&extension.as_str()) {
            continue;
        }
        let metadata = match fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        if metadata.len() > MAX_SEARCH_FILE_BYTES {
            continue;
        }
        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };
        for (index, line) in content.lines().enumerate() {
            if let Some(column) = line.find(query) {
                hits.push(json!({
                    "filePath": item.path,
                    "line": index + 1,
                    "column": column + 1,
                    "preview": line.chars().take(240).collect::<String>(),
                }));
                if hits.len() >= limit {
                    truncated = true;
                    break;
                }
            }
        }
    }
    Ok(json!({ "hits": hits, "truncated": truncated }))
}

pub fn handle_files_json(method: &str, payload: &str) -> Result<String, String> {
    ensure_patch_poller();
    match method {
        "files.read_home" => {
            let request: StorageRootRequest = decode(payload)?;
            encode(crate::home::read_home(&request.storage_root).map_err(map_core)?)
        }
        "files.read_directory" => {
            let request: FileManagerReadDirectoryRequest = decode(payload)?;
            encode(crate::directory_host::read_directory(&request.path).map_err(map_core)?)
        }
        "files.subscribe_directory" => {
            let request: FileManagerReadDirectoryRequest = decode(payload)?;
            encode(crate::directory_host::subscribe_directory(&request.path).map_err(map_core)?)
        }
        "files.unsubscribe_directory" => {
            let request: FileManagerUnsubscribeDirectoryRequest = decode(payload)?;
            encode(
                crate::directory_host::unsubscribe_directory(&request.subscription_id)
                    .map_err(map_core)?,
            )
        }
        "files.read_trash" => {
            let request: StorageRootRequest = decode(payload)?;
            encode(crate::trash::read_trash(&request.storage_root).map_err(map_core)?)
        }
        "files.create_file" => {
            let request: FileManagerCreateFileRequest = decode(payload)?;
            let parent = normalize_path(&request.parent_path).map_err(map_core)?;
            let name = normalize_name(&request.name).map_err(map_core)?;
            let full_path = parent.join(name);
            File::create_new(&full_path).map_err(|error| {
                crate::io_fail(format!("failed to create {}", full_path.display()), error).to_string()
            })?;
            encode(json!({
                "entry": entry_from_core(crate::read_entry_lazy(&full_path).map_err(map_core)?)
            }))
        }
        "files.create_folder" => {
            let request: FileManagerCreateFolderRequest = decode(payload)?;
            let parent = normalize_path(&request.parent_path).map_err(map_core)?;
            let name = normalize_name(&request.name).map_err(map_core)?;
            let full_path = parent.join(name);
            fs::create_dir(&full_path).map_err(|error| {
                crate::io_fail(format!("failed to create {}", full_path.display()), error).to_string()
            })?;
            encode(json!({
                "entry": entry_from_core(crate::read_entry_lazy(&full_path).map_err(map_core)?)
            }))
        }
        "files.move_to_trash" => {
            let request: FileManagerMoveToTrashRequest = decode(payload)?;
            crate::trash::move_to_trash(&request.paths, &request.storage_root).map_err(map_core)?;
            encode(Value::Null)
        }
        "files.restore_from_trash" => {
            let request: FileManagerRestoreFromTrashRequest = decode(payload)?;
            crate::trash::restore_from_trash(&request.item_ids, &request.storage_root)
                .map_err(map_core)?;
            encode(Value::Null)
        }
        "files.empty_trash" => {
            let request: StorageRootRequest = decode(payload)?;
            crate::trash::empty_trash(&request.storage_root).map_err(map_core)?;
            encode(Value::Null)
        }
        "files.mount_device" => {
            let request: FileManagerMountDeviceRequest = decode(payload)?;
            let device_path = normalize_path(&request.device_path).map_err(map_core)?;
            let outcome =
                mount_device(&path_to_string(&device_path), &request.kind).map_err(map_core)?;
            encode(json!({
                "mounted": true,
                "mountPath": outcome.mount_path,
                "strategy": outcome.strategy,
            }))
        }
        "files.eject_device" => {
            let request: FileManagerEjectDeviceRequest = decode(payload)?;
            let mount_path = normalize_path(&request.mount_path).map_err(map_core)?;
            let device_path = request
                .device_path
                .as_deref()
                .map(normalize_path)
                .transpose()
                .map_err(map_core)?;
            let outcome = safely_eject_device(
                &path_to_string(&mount_path),
                device_path.as_deref().map(path_to_string).as_deref(),
                &request.kind,
            )
            .map_err(map_core)?;
            encode(json!({
                "ejected": true,
                "poweredOff": outcome.powered_off,
                "strategy": outcome.strategy,
            }))
        }
        "files.read_favorites" => {
            let request: StorageRootRequest = decode(payload)?;
            let root = ensure_storage_root(&request.storage_root).map_err(map_core)?;
            encode(read_favorites_from_storage(&root).map_err(map_core)?)
        }
        "files.write_favorites" => {
            let request: FileManagerFavoritesWriteRequest = decode(payload)?;
            let root = ensure_storage_root(&request.storage_root).map_err(map_core)?;
            let payload = FileManagerFavoritesPayload {
                favorites: request
                    .favorites
                    .into_iter()
                    .map(|favorite| crate::preferences::FileManagerFavorite {
                        id: favorite.id,
                        title: favorite.title,
                        path: favorite.path,
                        kind: favorite.kind,
                        special_id: favorite.special_id,
                        url: favorite.url,
                        favicon_url: favorite.favicon_url,
                        session_id: favorite.session_id,
                        working_dir: favorite.working_dir,
                    })
                    .collect(),
            };
            encode(write_favorites_to_storage(&root, &payload).map_err(map_core)?)
        }
        "files.read_recent_locations" => {
            let request: StorageRootRequest = decode(payload)?;
            let root = ensure_storage_root(&request.storage_root).map_err(map_core)?;
            encode(read_recent_from_storage(&root).map_err(map_core)?)
        }
        "files.write_recent_locations" => {
            let request: FileManagerRecentLocationsWriteRequest = decode(payload)?;
            let root = ensure_storage_root(&request.storage_root).map_err(map_core)?;
            let payload = FileManagerRecentLocationsPayload {
                recent_locations: request
                    .recent_locations
                    .into_iter()
                    .map(|location| crate::preferences::FileManagerRecentLocation {
                        id: location.id,
                        title: location.title,
                        path: location.path,
                        last_opened_at: location.last_opened_at,
                    })
                    .collect(),
            };
            encode(write_recent_to_storage(&root, &payload).map_err(map_core)?)
        }
        "files.read_text" => {
            let request: FileReadTextRequest = decode(payload)?;
            encode(text_file::read_text_file(&request.path).map_err(map_core)?)
        }
        "files.write_text" => {
            let request: WireWriteTextRequest = decode(payload)?;
            encode(
                text_file::write_text_file(FileWriteTextRequest {
                    path: request.path,
                    content: request.content,
                    expected_revision: request.expected_revision,
                    encoding: request.encoding,
                })
                .map_err(map_core)?,
            )
        }
        "files.stat" => {
            let request: FileStatRequest = decode(payload)?;
            encode(text_file::stat_file(&request.path).map_err(map_core)?)
        }
        "files.search_text" => encode(search_text(decode(payload)?)?),
        "files.probe_workbench_path" => {
            let request: WorkbenchPathProbeRequest = decode(payload)?;
            encode(probe_workbench_path(&request.path).map_err(map_core)?)
        }
        "files.collect_workbench_paths" => {
            let request: WorkbenchCollectFilePathsRequest = decode(payload)?;
            encode(
                collect_workbench_file_paths(&request.root_path, request.base_path.as_deref())
                    .map_err(map_core)?,
            )
        }
        other => Err(fail(format!("unknown files method: {other}")).to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{handle_files_json, FILES_METHODS};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn files_methods_are_quoted_for_inventories() {
        assert!(FILES_METHODS.contains(&"files.read_directory"));
        assert!(FILES_METHODS.contains(&"files.search_text"));
        assert!(!FILES_METHODS.iter().any(|method| method.starts_with("code.")));
    }

    #[test]
    fn read_directory_json_lists_a_file() {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("lyra-files-json-{stamp}"));
        fs::create_dir_all(&root).expect("temp dir");
        fs::write(root.join("readme.txt"), b"hello").expect("write");
        let payload = serde_json::json!({ "path": root.to_string_lossy() }).to_string();
        let response = handle_files_json("files.read_directory", &payload).expect("read");
        let parsed: serde_json::Value = serde_json::from_str(&response).expect("json");
        let names: Vec<String> = parsed["entries"]
            .as_array()
            .expect("entries")
            .iter()
            .filter_map(|entry| entry["name"].as_str().map(str::to_string))
            .collect();
        assert!(names.contains(&"readme.txt".to_string()));
        fs::remove_dir_all(root).expect("cleanup");
    }
}
