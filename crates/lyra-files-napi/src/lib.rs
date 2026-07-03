use std::fs::{self, File};

use napi::bindgen_prelude::{AsyncTask, ToNapiValue, TypeName};
use napi::{Env, Task};
use napi_derive::napi;

mod directory;
mod dto;
mod eject;
mod error;
mod home;
mod mount;
mod trash;
mod volumes;

pub use dto::*;

use directory::entry_from_core;
use eject::safely_eject_device;
pub(crate) use error::failure;
use error::{core_error, invalid_arg, io_error, NapiResult as Result};
use mount::mount_device as perform_mount_device;

pub struct BlockingTask<T> {
    compute: Option<Box<dyn FnOnce() -> Result<T> + Send>>,
}

impl<T> BlockingTask<T> {
    fn new(compute: impl FnOnce() -> Result<T> + Send + 'static) -> Self {
        Self {
            compute: Some(Box::new(compute)),
        }
    }
}

impl<T: Send + ToNapiValue + TypeName + 'static> Task for BlockingTask<T> {
    type Output = T;
    type JsValue = T;

    fn compute(&mut self) -> Result<Self::Output> {
        let compute = self
            .compute
            .take()
            .ok_or_else(|| failure("file task was already consumed"))?;
        compute()
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

fn blocking_task<T: Send + ToNapiValue + TypeName + 'static>(
    compute: impl FnOnce() -> Result<T> + Send + 'static,
) -> AsyncTask<BlockingTask<T>> {
    AsyncTask::new(BlockingTask::new(compute))
}

fn favorite_from_core(
    favorite: lyra_files_core::preferences::FileManagerFavorite,
) -> FileManagerFavorite {
    FileManagerFavorite {
        id: favorite.id,
        title: favorite.title,
        path: favorite.path,
        kind: favorite.kind,
        special_id: favorite.special_id,
        url: favorite.url,
        favicon_url: favorite.favicon_url,
        session_id: favorite.session_id,
        working_dir: favorite.working_dir,
    }
}

fn favorite_to_core(
    favorite: FileManagerFavorite,
) -> lyra_files_core::preferences::FileManagerFavorite {
    lyra_files_core::preferences::FileManagerFavorite {
        id: favorite.id,
        title: favorite.title,
        path: favorite.path,
        kind: favorite.kind,
        special_id: favorite.special_id,
        url: favorite.url,
        favicon_url: favorite.favicon_url,
        session_id: favorite.session_id,
        working_dir: favorite.working_dir,
    }
}

fn recent_from_core(
    location: lyra_files_core::preferences::FileManagerRecentLocation,
) -> FileManagerRecentLocation {
    FileManagerRecentLocation {
        id: location.id,
        title: location.title,
        path: location.path,
        last_opened_at: location.last_opened_at,
    }
}

fn recent_to_core(
    location: FileManagerRecentLocation,
) -> lyra_files_core::preferences::FileManagerRecentLocation {
    lyra_files_core::preferences::FileManagerRecentLocation {
        id: location.id,
        title: location.title,
        path: location.path,
        last_opened_at: location.last_opened_at,
    }
}

fn favorites_from_core(
    payload: lyra_files_core::preferences::FileManagerFavoritesPayload,
) -> FileManagerFavoritesPayload {
    FileManagerFavoritesPayload {
        favorites: payload
            .favorites
            .into_iter()
            .map(favorite_from_core)
            .collect(),
    }
}

fn recent_locations_from_core(
    payload: lyra_files_core::preferences::FileManagerRecentLocationsPayload,
) -> FileManagerRecentLocationsPayload {
    FileManagerRecentLocationsPayload {
        recent_locations: payload
            .recent_locations
            .into_iter()
            .map(recent_from_core)
            .collect(),
    }
}

fn read_result_from_core(result: lyra_files_core::text_file::FileReadResult) -> FileReadResult {
    FileReadResult {
        kind: result.kind,
        path: result.path,
        reason: result.reason,
        revision: result.revision,
        encoding: result.encoding,
        read_only: result.read_only,
        size_bytes: result.size_bytes,
        content: result.content,
    }
}

fn write_result_from_core(result: lyra_files_core::text_file::FileWriteResult) -> FileWriteResult {
    FileWriteResult {
        ok: result.ok,
        kind: result.kind,
        path: result.path,
        message: result.message,
        expected_revision: result.expected_revision,
        current_revision: result.current_revision,
        revision: result.revision,
        encoding: result.encoding,
        saved_at: result.saved_at,
    }
}

fn stat_result_from_core(result: lyra_files_core::text_file::FileStatResult) -> FileStatResult {
    FileStatResult {
        path: result.path,
        exists: result.exists,
        is_directory: result.is_directory,
        read_only: result.read_only,
        size_bytes: result.size_bytes,
        modified_at: result.modified_at,
        revision: result.revision,
    }
}

fn workbench_probe_from_core(
    result: lyra_files_core::workbench_paths::WorkbenchPathProbeResult,
) -> WorkbenchPathProbeResult {
    WorkbenchPathProbeResult {
        normalized_path: result.normalized_path,
        existing_path: result.existing_path,
        directory_path: result.directory_path,
        project_root: result.project_root,
    }
}

fn workbench_collected_from_core(
    result: lyra_files_core::workbench_paths::WorkbenchCollectedFilePath,
) -> WorkbenchCollectedFilePath {
    WorkbenchCollectedFilePath { path: result.path }
}

#[napi]
pub fn read_home(
    request: StorageRootRequest,
) -> AsyncTask<BlockingTask<FileManagerReadHomeResponse>> {
    blocking_task(move || home::read_home(&request.storage_root))
}

#[napi]
pub fn read_directory(
    request: FileManagerReadDirectoryRequest,
) -> AsyncTask<BlockingTask<FileManagerReadDirectoryResponse>> {
    blocking_task(move || directory::read_directory(&request.path))
}

#[napi]
pub fn subscribe_directory(
    request: FileManagerReadDirectoryRequest,
) -> AsyncTask<BlockingTask<FileManagerSubscribeDirectoryResponse>> {
    blocking_task(move || directory::subscribe_directory(&request.path))
}

#[napi]
pub fn unsubscribe_directory(
    request: FileManagerUnsubscribeDirectoryRequest,
) -> AsyncTask<BlockingTask<bool>> {
    blocking_task(move || {
        let subscription_id = request.subscription_id.trim().to_string();
        if subscription_id.is_empty() {
            return Err(invalid_arg("subscriptionId is required"));
        }
        directory::unsubscribe_directory(&subscription_id)
    })
}

#[napi]
pub fn poll_directory_patches() -> AsyncTask<BlockingTask<Vec<FileManagerDirectoryPatch>>> {
    blocking_task(directory::poll_directory_patches)
}

#[napi]
pub fn read_trash(
    request: StorageRootRequest,
) -> AsyncTask<BlockingTask<FileManagerReadTrashResponse>> {
    blocking_task(move || trash::read_trash(&request.storage_root))
}

#[napi]
pub fn create_file(
    request: FileManagerCreateFileRequest,
) -> AsyncTask<BlockingTask<FileManagerDirectoryMutationResponse>> {
    blocking_task(move || {
        let parent_path =
            lyra_files_core::paths::normalize_path(&request.parent_path).map_err(core_error)?;
        let name = lyra_files_core::paths::normalize_name(&request.name).map_err(core_error)?;
        let full_path = parent_path.join(name);
        File::create_new(&full_path).map_err(|error| {
            io_error(format!("failed to create {}", full_path.display()), error)
        })?;
        Ok(FileManagerDirectoryMutationResponse {
            entry: Some(entry_from_core(
                lyra_files_core::read_entry_lazy(&full_path).map_err(core_error)?,
            )),
        })
    })
}

#[napi]
pub fn create_folder(
    request: FileManagerCreateFolderRequest,
) -> AsyncTask<BlockingTask<FileManagerDirectoryMutationResponse>> {
    blocking_task(move || {
        let parent_path =
            lyra_files_core::paths::normalize_path(&request.parent_path).map_err(core_error)?;
        let name = lyra_files_core::paths::normalize_name(&request.name).map_err(core_error)?;
        let full_path = parent_path.join(name);
        fs::create_dir(&full_path).map_err(|error| {
            io_error(format!("failed to create {}", full_path.display()), error)
        })?;
        Ok(FileManagerDirectoryMutationResponse {
            entry: Some(entry_from_core(
                lyra_files_core::read_entry_lazy(&full_path).map_err(core_error)?,
            )),
        })
    })
}

#[napi]
pub fn move_to_trash(request: FileManagerMoveToTrashRequest) -> AsyncTask<BlockingTask<()>> {
    blocking_task(move || trash::move_to_trash(&request.paths, &request.storage_root))
}

#[napi]
pub fn restore_from_trash(
    request: FileManagerRestoreFromTrashRequest,
) -> AsyncTask<BlockingTask<()>> {
    blocking_task(move || trash::restore_from_trash(&request.item_ids, &request.storage_root))
}

#[napi]
pub fn empty_trash(request: StorageRootRequest) -> AsyncTask<BlockingTask<()>> {
    blocking_task(move || trash::empty_trash(&request.storage_root))
}

#[napi]
pub fn eject_device(
    request: FileManagerEjectDeviceRequest,
) -> AsyncTask<BlockingTask<FileManagerEjectDeviceResult>> {
    blocking_task(move || {
        let mount_path =
            lyra_files_core::paths::normalize_path(&request.mount_path).map_err(core_error)?;
        let device_path = request
            .device_path
            .as_deref()
            .map(lyra_files_core::paths::normalize_path)
            .transpose()
            .map_err(core_error)?;
        let mount_path_string = lyra_files_core::paths::path_to_string(&mount_path);
        let device_path_string = device_path
            .as_deref()
            .map(lyra_files_core::paths::path_to_string);
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
    })
}

#[napi]
pub fn mount_device(
    request: FileManagerMountDeviceRequest,
) -> AsyncTask<BlockingTask<FileManagerMountDeviceResult>> {
    blocking_task(move || {
        let device_path =
            lyra_files_core::paths::normalize_path(&request.device_path).map_err(core_error)?;
        let device_path_string = lyra_files_core::paths::path_to_string(&device_path);
        let outcome = perform_mount_device(&device_path_string, &request.kind)?;

        Ok(FileManagerMountDeviceResult {
            mounted: true,
            mount_path: outcome.mount_path,
            strategy: outcome.strategy.to_string(),
        })
    })
}

#[napi]
pub fn read_favorites(
    request: StorageRootRequest,
) -> AsyncTask<BlockingTask<FileManagerFavoritesPayload>> {
    blocking_task(move || {
        let storage_root = lyra_files_core::preferences::ensure_storage_root(&request.storage_root)
            .map_err(core_error)?;
        lyra_files_core::preferences::read_favorites_from_storage(&storage_root)
            .map(favorites_from_core)
            .map_err(core_error)
    })
}

#[napi]
pub fn write_favorites(
    request: FileManagerFavoritesWriteRequest,
) -> AsyncTask<BlockingTask<FileManagerFavoritesPayload>> {
    blocking_task(move || {
        let root = lyra_files_core::preferences::ensure_storage_root(&request.storage_root)
            .map_err(core_error)?;
        lyra_files_core::preferences::write_favorites_to_storage(
            &root,
            &lyra_files_core::preferences::FileManagerFavoritesPayload {
                favorites: request
                    .favorites
                    .into_iter()
                    .map(favorite_to_core)
                    .collect(),
            },
        )
        .map(favorites_from_core)
        .map_err(core_error)
    })
}

#[napi]
pub fn read_recent_locations(
    request: StorageRootRequest,
) -> AsyncTask<BlockingTask<FileManagerRecentLocationsPayload>> {
    blocking_task(move || {
        let storage_root = lyra_files_core::preferences::ensure_storage_root(&request.storage_root)
            .map_err(core_error)?;
        lyra_files_core::preferences::read_recent_from_storage(&storage_root)
            .map(recent_locations_from_core)
            .map_err(core_error)
    })
}

#[napi]
pub fn write_recent_locations(
    request: FileManagerRecentLocationsWriteRequest,
) -> AsyncTask<BlockingTask<FileManagerRecentLocationsPayload>> {
    blocking_task(move || {
        let root = lyra_files_core::preferences::ensure_storage_root(&request.storage_root)
            .map_err(core_error)?;
        lyra_files_core::preferences::write_recent_to_storage(
            &root,
            &lyra_files_core::preferences::FileManagerRecentLocationsPayload {
                recent_locations: request
                    .recent_locations
                    .into_iter()
                    .map(recent_to_core)
                    .collect(),
            },
        )
        .map(recent_locations_from_core)
        .map_err(core_error)
    })
}

#[napi]
pub fn read_text_file(request: FileReadTextRequest) -> AsyncTask<BlockingTask<FileReadResult>> {
    blocking_task(move || {
        lyra_files_core::text_file::read_text_file(&request.path)
            .map(read_result_from_core)
            .map_err(core_error)
    })
}

#[napi]
pub fn write_text_file(request: FileWriteTextRequest) -> AsyncTask<BlockingTask<FileWriteResult>> {
    blocking_task(move || {
        lyra_files_core::text_file::write_text_file(
            lyra_files_core::text_file::FileWriteTextRequest {
                path: request.path,
                content: request.content,
                expected_revision: request.expected_revision,
                encoding: request.encoding,
            },
        )
        .map(write_result_from_core)
        .map_err(core_error)
    })
}

#[napi]
pub fn stat_file(request: FileStatRequest) -> AsyncTask<BlockingTask<FileStatResult>> {
    blocking_task(move || {
        lyra_files_core::text_file::stat_file(&request.path)
            .map(stat_result_from_core)
            .map_err(core_error)
    })
}

#[napi]
pub fn probe_workbench_path(
    request: WorkbenchPathProbeRequest,
) -> AsyncTask<BlockingTask<WorkbenchPathProbeResult>> {
    blocking_task(move || {
        lyra_files_core::workbench_paths::probe_workbench_path(&request.path)
            .map(workbench_probe_from_core)
            .map_err(core_error)
    })
}

#[napi]
pub fn collect_workbench_file_paths(
    request: WorkbenchCollectFilePathsRequest,
) -> AsyncTask<BlockingTask<Vec<WorkbenchCollectedFilePath>>> {
    blocking_task(move || {
        lyra_files_core::workbench_paths::collect_workbench_file_paths(
            &request.root_path,
            request.base_path.as_deref(),
        )
        .map(|items| {
            items
                .into_iter()
                .map(workbench_collected_from_core)
                .collect()
        })
        .map_err(core_error)
    })
}
