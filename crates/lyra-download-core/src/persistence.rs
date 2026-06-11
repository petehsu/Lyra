use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::{
    DownloadBtSettings, DownloadPostProcessingSettings, DownloadProxySettings, DownloadSettings,
    DownloadTask, DownloadTaskBackend, DownloadTaskOutputKind, DownloadTaskState,
};
use crate::now_iso;

pub(crate) const TASKS_FILE_NAME: &str = "tasks.v1.json";
pub(crate) const SETTINGS_FILE_NAME: &str = "settings.v1.json";
pub(crate) const REMOTE_API_FILE_NAME: &str = "remote-api.v1.json";
pub(crate) const DEFAULT_MAX_RETRIES: u32 = 3;
pub(crate) const DEFAULT_RETRY_DELAY_MS: u64 = 1_500;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredDownloadTasksFile {
    pub(crate) version: u8,
    pub(crate) tasks: Vec<DownloadTask>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteApiConfig {
    pub(crate) version: u8,
    pub(crate) token: String,
    pub(crate) host: String,
    pub(crate) port: u16,
}

pub(crate) fn read_tasks(path: &Path) -> Result<Vec<DownloadTask>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let parsed: StoredDownloadTasksFile =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    Ok(parsed.tasks)
}

pub(crate) fn read_settings(path: &Path) -> Result<DownloadSettings, String> {
    if !path.exists() {
        return Ok(default_settings());
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

pub(crate) fn default_settings() -> DownloadSettings {
    DownloadSettings {
        version: 1,
        speed_limit_bytes_per_second: None,
        schedule: None,
        proxy: DownloadProxySettings {
            mode: "system".to_string(),
            url: None,
        },
        post_processing: DownloadPostProcessingSettings {
            auto_extract: false,
            extract_directory: None,
            delete_archive_after_extract: false,
            detect_split_archives: true,
        },
        bt: DownloadBtSettings {
            dht_enabled: true,
            peer_exchange_enabled: true,
            local_peer_discovery_enabled: true,
            seed_time_minutes: 0,
            tracker_urls: Vec::new(),
            max_upload_bytes_per_second: None,
        },
        default_headers: HashMap::new(),
        default_cookie_header: None,
        save_rules: Vec::new(),
        updated_at: now_iso(),
    }
}

pub(crate) fn read_remote_config(path: &Path) -> Result<RemoteApiConfig, String> {
    if path.exists() {
        let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
        return serde_json::from_str(&raw).map_err(|error| error.to_string());
    }
    Ok(RemoteApiConfig {
        version: 1,
        token: Uuid::new_v4().simple().to_string(),
        host: "127.0.0.1".to_string(),
        port: 17373,
    })
}

pub(crate) fn write_json_atomic<T: Serialize>(
    root: &Path,
    path: &Path,
    value: &T,
) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let temp = path.with_extension("tmp");
    let encoded = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(&temp, encoded).map_err(|error| error.to_string())?;
    fs::rename(temp, path).map_err(|error| error.to_string())
}

pub(crate) fn restore_task(mut task: DownloadTask) -> Result<DownloadTask, String> {
    let was_active = matches!(
        task.state,
        DownloadTaskState::Downloading | DownloadTaskState::Queued | DownloadTaskState::Paused
    );
    if matches!(
        task.state,
        DownloadTaskState::Downloading | DownloadTaskState::Queued
    ) {
        task.state = DownloadTaskState::Queued;
    }
    task.speed_bytes_per_second = 0;
    task.connections_active = 0;
    task.can_resume = if matches!(
        task.state,
        DownloadTaskState::Completed | DownloadTaskState::Canceled
    ) {
        false
    } else {
        was_active || task.can_resume
    };
    task.retry_count.get_or_insert(0);
    task.max_retries.get_or_insert(DEFAULT_MAX_RETRIES);
    task.retry_delay_ms.get_or_insert(DEFAULT_RETRY_DELAY_MS);
    task.backend.get_or_insert(DownloadTaskBackend::Electron);
    task.output_kind.get_or_insert(DownloadTaskOutputKind::File);
    task.active_mirror_index.get_or_insert(0);
    task.schedule_paused.get_or_insert(false);
    task.post_processing_state
        .get_or_insert_with(|| "idle".to_string());
    if was_active {
        task.error_message = None;
    }
    Ok(task)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    #[test]
    fn restores_active_tasks_to_queue() {
        let mut task = sample_task("active", DownloadTaskState::Downloading);
        task.error_message = Some("interrupted".to_string());
        let restored = restore_task(task).expect("restored");

        assert_eq!(restored.state, DownloadTaskState::Queued);
        assert_eq!(restored.connections_active, 0);
        assert_eq!(restored.can_resume, true);
        assert_eq!(restored.error_message, None);
    }

    #[test]
    fn default_settings_and_remote_config_keep_expected_defaults() {
        let settings = default_settings();
        assert_eq!(settings.version, 1);
        assert_eq!(settings.proxy.mode, "system");
        assert_eq!(settings.bt.dht_enabled, true);

        let temp = tempfile::tempdir().expect("tempdir");
        let remote = read_remote_config(&temp.path().join("remote-api.v1.json")).expect("remote");
        assert_eq!(remote.version, 1);
        assert_eq!(remote.host, "127.0.0.1");
        assert_eq!(remote.port, 17373);
        assert_eq!(remote.token.len(), 32);
    }

    fn sample_task(id: &str, state: DownloadTaskState) -> DownloadTask {
        DownloadTask {
            id: id.to_string(),
            url: format!("https://example.com/{id}.zip"),
            original_url: None,
            final_url: None,
            referrer: None,
            file_name: format!("{id}.zip"),
            mime_type: None,
            request_headers: None,
            proxy: None,
            save_path: format!("/tmp/{id}.zip"),
            directory: "/tmp".to_string(),
            protocol: "https".to_string(),
            source: crate::model::DownloadTaskSource::Manual,
            backend: Some(DownloadTaskBackend::NativeHttp),
            output_kind: Some(DownloadTaskOutputKind::File),
            source_tab_id: None,
            source_title: None,
            state,
            received_bytes: 0,
            total_bytes: 100,
            speed_bytes_per_second: 0,
            estimated_remaining_ms: None,
            priority: crate::model::DownloadPriority::Normal,
            connections_requested: 4,
            connections_active: 0,
            can_resume: true,
            created_at: "2026-05-04T00:00:00.000Z".to_string(),
            updated_at: "2026-05-04T00:00:00.000Z".to_string(),
            started_at: None,
            completed_at: None,
            error_message: None,
            checksum: None,
            retry_count: None,
            max_retries: None,
            retry_delay_ms: None,
            mirrors: None,
            active_mirror_index: None,
            bt: None,
            schedule_paused: None,
            post_processing_state: None,
            post_processing_message: None,
            missing_archive_parts: None,
            tags: Vec::new(),
        }
    }
}
