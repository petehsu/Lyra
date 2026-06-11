use napi_derive::napi;
use serde::{Deserialize, Serialize};

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
    pub hydration_state: Option<String>,
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
pub struct FileManagerDirectorySnapshot {
    pub location: FileManagerLocation,
    pub parent_path: Option<String>,
    pub entries: Vec<FileManagerEntry>,
    pub generation: f64,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerSubscribeDirectoryResponse {
    pub subscription_id: String,
    pub snapshot: FileManagerDirectorySnapshot,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerUnsubscribeDirectoryRequest {
    pub subscription_id: String,
}

#[napi(object)]
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileManagerDirectoryPatch {
    pub subscription_id: String,
    pub directory_path: String,
    pub generation: f64,
    pub kind: String,
    pub entry: Option<FileManagerEntry>,
    pub path: Option<String>,
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub snapshot: Option<FileManagerDirectorySnapshot>,
    pub error_message: Option<String>,
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
