use std::sync::{Mutex, OnceLock};

use crate::dto::{
    FileManagerDirectoryPatch, FileManagerDirectorySnapshot, FileManagerEntry, FileManagerLocation,
    FileManagerReadDirectoryResponse, FileManagerSubscribeDirectoryResponse,
};
use crate::error::{core_error, failure, NapiResult};

static DIRECTORY_SERVICE: OnceLock<Mutex<lyra_files_core::DirectoryService>> = OnceLock::new();

fn with_directory_service<T>(
    f: impl FnOnce(&mut lyra_files_core::DirectoryService) -> lyra_files_core::Result<T>,
) -> NapiResult<T> {
    let service =
        DIRECTORY_SERVICE.get_or_init(|| Mutex::new(lyra_files_core::DirectoryService::new()));
    let mut guard = service
        .lock()
        .map_err(|_| failure("directory service lock is poisoned"))?;
    f(&mut guard).map_err(core_error)
}

pub fn location_from_core(location: lyra_files_core::FileManagerLocation) -> FileManagerLocation {
    FileManagerLocation {
        id: location.id,
        title: location.title,
        kind: location.kind,
        path: location.path,
        special_id: location.special_id,
    }
}

pub fn entry_from_core(entry: lyra_files_core::FileManagerEntry) -> FileManagerEntry {
    FileManagerEntry {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        kind: entry.kind,
        extension: entry.extension,
        is_hidden: entry.is_hidden,
        size_bytes: entry.size_bytes,
        modified_at: entry.modified_at,
        folder_state: entry.folder_state,
        hydration_state: Some(entry.hydration_state),
    }
}

pub fn snapshot_from_core(
    snapshot: lyra_files_core::DirectorySnapshot,
) -> FileManagerDirectorySnapshot {
    FileManagerDirectorySnapshot {
        location: location_from_core(snapshot.location),
        parent_path: snapshot.parent_path,
        entries: snapshot.entries.into_iter().map(entry_from_core).collect(),
        generation: snapshot.generation as f64,
    }
}

pub fn read_directory_response_from_core(
    snapshot: lyra_files_core::DirectorySnapshot,
) -> FileManagerReadDirectoryResponse {
    FileManagerReadDirectoryResponse {
        location: location_from_core(snapshot.location),
        parent_path: snapshot.parent_path,
        entries: snapshot.entries.into_iter().map(entry_from_core).collect(),
    }
}

pub fn patch_from_core(patch: lyra_files_core::DirectoryPatch) -> FileManagerDirectoryPatch {
    FileManagerDirectoryPatch {
        subscription_id: patch.subscription_id,
        directory_path: patch.directory_path,
        generation: patch.generation as f64,
        kind: patch.kind.as_str().to_string(),
        entry: patch.entry.map(entry_from_core),
        path: patch.path,
        old_path: patch.old_path,
        new_path: patch.new_path,
        snapshot: patch.snapshot.map(snapshot_from_core),
        error_message: patch.error_message,
    }
}

pub fn create_location(
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

pub fn read_directory(path: &str) -> NapiResult<FileManagerReadDirectoryResponse> {
    let snapshot = with_directory_service(|service| service.read_directory(path))?;
    Ok(read_directory_response_from_core(snapshot))
}

pub fn subscribe_directory(path: &str) -> NapiResult<FileManagerSubscribeDirectoryResponse> {
    let subscription = with_directory_service(|service| service.subscribe_directory(path))?;
    Ok(FileManagerSubscribeDirectoryResponse {
        subscription_id: subscription.subscription_id,
        snapshot: snapshot_from_core(subscription.snapshot),
    })
}

pub fn unsubscribe_directory(subscription_id: &str) -> NapiResult<bool> {
    with_directory_service(|service| Ok(service.unsubscribe_directory(subscription_id)))
}

pub fn poll_directory_patches() -> NapiResult<Vec<FileManagerDirectoryPatch>> {
    with_directory_service(|service| Ok(service.poll_patches()))
        .map(|patches| patches.into_iter().map(patch_from_core).collect())
}
