use std::ffi::OsString;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use crate::model::{DownloadSettings, DownloadTask};

const ARIA2_BINARY_ENV: &str = "LYRA_ARIA2_BINARY";
const ARIA2_BINARY_SHA256_ENV: &str = "LYRA_ARIA2_BINARY_SHA256";
const ARIA2_COMPONENT_ROOT_ENV: &str = "LYRA_ARIA2_COMPONENT_ROOT";
const ARIA2_COMPONENT_VERSION_ENV: &str = "LYRA_ARIA2_COMPONENT_VERSION";
const ARIA2_TRUST_ENV: &str = "LYRA_ARIA2_TRUST";
const ARIA2_TRUST_VALUE: &str = "verified-component-v1";
const ARIA2_DEVELOPMENT_TRUST_VALUE: &str = "development-bundle-v1";
const RESOURCE_COMPONENT_MODE_ENV: &str = "LYRA_RESOURCE_COMPONENT_MODE";
const DEVELOPMENT_RESOURCE_MODE: &str = "development-fallback";
const PROGRESS_INTERVAL: Duration = Duration::from_millis(500);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(100);
const GRACEFUL_STOP_TIMEOUT: Duration = Duration::from_millis(1_500);
const MAX_STDERR_BYTES: u64 = 256 * 1024;

#[derive(Clone, Debug)]
pub(crate) struct Aria2Runtime {
    binary_path: PathBuf,
    component_root: PathBuf,
    component_version: String,
    expected_sha256: String,
}

#[derive(Debug)]
pub(crate) enum Aria2RunError {
    Unavailable(String),
    Rejected(String),
    Failed(String),
}

impl Aria2RunError {
    pub(crate) fn message(self) -> String {
        match self {
            Self::Unavailable(message) | Self::Rejected(message) | Self::Failed(message) => message,
        }
    }

    pub(crate) fn retryable(&self) -> bool {
        matches!(self, Self::Failed(_))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Aria2Progress {
    pub(crate) received: u64,
    pub(crate) speed: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Aria2Complete {
    pub(crate) received: u64,
}

impl Aria2Runtime {
    pub(crate) fn from_process_environment() -> Result<Self, String> {
        Self::from_values(
            std::env::var_os(ARIA2_BINARY_ENV),
            std::env::var_os(ARIA2_COMPONENT_ROOT_ENV),
            std::env::var(ARIA2_COMPONENT_VERSION_ENV).ok(),
            std::env::var(ARIA2_BINARY_SHA256_ENV).ok(),
            std::env::var(ARIA2_TRUST_ENV).ok(),
            std::env::var(RESOURCE_COMPONENT_MODE_ENV).ok(),
        )
    }

    fn from_values(
        binary_path: Option<OsString>,
        component_root: Option<OsString>,
        component_version: Option<String>,
        expected_sha256: Option<String>,
        trust: Option<String>,
        resource_component_mode: Option<String>,
    ) -> Result<Self, String> {
        let trusted_component = trust.as_deref() == Some(ARIA2_TRUST_VALUE);
        let verified_development_bundle = trust.as_deref() == Some(ARIA2_DEVELOPMENT_TRUST_VALUE)
            && resource_component_mode.as_deref() == Some(DEVELOPMENT_RESOURCE_MODE);
        if !trusted_component && !verified_development_bundle {
            return Err(unavailable_message(
                "Core did not provide a verified aria2 component identity",
            ));
        }
        let binary_path = required_absolute_path(binary_path, "binary")?;
        let component_root = required_absolute_path(component_root, "component root")?;
        let component_version = component_version
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| unavailable_message("component version is missing"))?;
        let expected_sha256 = expected_sha256
            .filter(|value| is_sha256(value))
            .map(|value| value.to_ascii_lowercase())
            .ok_or_else(|| unavailable_message("binary SHA-256 is missing or invalid"))?;
        let runtime = Self {
            binary_path,
            component_root,
            component_version,
            expected_sha256,
        };
        runtime.verify()?;
        Ok(runtime)
    }

    pub(crate) fn verify(&self) -> Result<(), String> {
        assert_component_binary_path(&self.component_root, &self.binary_path)?;
        let actual = sha256_file(&self.binary_path)?;
        if actual != self.expected_sha256 {
            return Err(unavailable_message(&format!(
                "aria2 component {} binary failed its SHA-256 check",
                self.component_version
            )));
        }
        Ok(())
    }

    pub(crate) fn resource_binding(&self) -> (&Path, &str) {
        (&self.binary_path, &self.component_version)
    }

    pub(crate) fn execute(
        &self,
        task: &DownloadTask,
        settings: &DownloadSettings,
        mut should_continue: impl FnMut() -> bool,
        mut on_progress: impl FnMut(Aria2Progress),
    ) -> Result<Option<Aria2Complete>, Aria2RunError> {
        if !crate::transport::is_aria2_url(&task.url) {
            return Err(Aria2RunError::Rejected(
                "aria2 rejected a URL outside the magnet, torrent, and Metalink allowlist"
                    .to_string(),
            ));
        }
        self.verify().map_err(Aria2RunError::Unavailable)?;
        fs::create_dir_all(&task.save_path).map_err(|error| {
            Aria2RunError::Failed(format!(
                "Unable to create aria2 download directory {}: {error}",
                task.save_path
            ))
        })?;

        let mut command = self.command_for(task, settings)?;
        lyra_process_lifecycle_core::configure_daemon_child_command(&mut command);
        let mut child = command.spawn().map_err(|error| {
            Aria2RunError::Unavailable(unavailable_message(&format!(
                "verified binary could not be started: {error}"
            )))
        })?;
        lyra_process_lifecycle_core::spawn_parent_death_watcher(child.id(), true);
        let stderr = child.stderr.take();
        let stderr_reader = thread::spawn(move || {
            let mut bytes = Vec::new();
            if let Some(stderr) = stderr {
                let _ = stderr.take(MAX_STDERR_BYTES).read_to_end(&mut bytes);
            }
            String::from_utf8_lossy(&bytes).trim().to_string()
        });

        let mut last_bytes = directory_size(Path::new(&task.save_path));
        let mut last_progress = Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {}
                Err(error) => {
                    stop_process_tree(&mut child);
                    let _ = stderr_reader.join();
                    return Err(Aria2RunError::Failed(format!(
                        "Unable to inspect aria2 process state: {error}"
                    )));
                }
            }

            if !should_continue() {
                stop_process_tree(&mut child);
                let _ = stderr_reader.join();
                return Ok(None);
            }

            if last_progress.elapsed() >= PROGRESS_INTERVAL {
                let received = directory_size(Path::new(&task.save_path));
                let elapsed = last_progress.elapsed().as_secs_f64().max(0.001);
                let speed = ((received.saturating_sub(last_bytes)) as f64 / elapsed).round() as u64;
                on_progress(Aria2Progress { received, speed });
                last_bytes = received;
                last_progress = Instant::now();
            }
            thread::sleep(PROCESS_POLL_INTERVAL);
        };

        let stderr = stderr_reader.join().unwrap_or_default();
        if !status.success() {
            return Err(Aria2RunError::Failed(aria2_exit_message(status, &stderr)));
        }
        if !should_continue() {
            return Ok(None);
        }
        let received = directory_size(Path::new(&task.save_path));
        on_progress(Aria2Progress { received, speed: 0 });
        Ok(Some(Aria2Complete { received }))
    }

    fn command_for(
        &self,
        task: &DownloadTask,
        settings: &DownloadSettings,
    ) -> Result<Command, Aria2RunError> {
        let mut command = Command::new(&self.binary_path);
        command
            .arg("--no-conf=true")
            .arg("--continue=true")
            .arg("--allow-overwrite=false")
            .arg("--auto-file-renaming=false")
            .arg("--summary-interval=0")
            .arg("--console-log-level=warn")
            .arg("--show-console-readout=false")
            .arg("--download-result=hide")
            .arg("--enable-rpc=false")
            .arg("--follow-torrent=mem")
            .arg("--follow-metalink=mem")
            .arg("--max-concurrent-downloads=1")
            .arg("--dir")
            .arg(&task.save_path)
            .arg(format!("--enable-dht={}", settings.bt.dht_enabled))
            .arg(format!(
                "--enable-peer-exchange={}",
                settings.bt.peer_exchange_enabled
            ))
            .arg(format!(
                "--bt-enable-lpd={}",
                settings.bt.local_peer_discovery_enabled
            ))
            .arg("--seed-time")
            .arg(settings.bt.seed_time_minutes.to_string());

        for (name, value) in task.request_headers.as_ref().into_iter().flatten() {
            if name.contains(['\r', '\n']) || value.contains(['\r', '\n']) {
                return Err(Aria2RunError::Failed(
                    "aria2 request headers must not contain newlines".to_string(),
                ));
            }
            command.arg("--header").arg(format!("{name}: {value}"));
        }
        if let Some(limit) = settings
            .speed_limit_bytes_per_second
            .filter(|value| *value > 0)
        {
            command.arg("--max-download-limit").arg(format!("{limit}B"));
        }
        if let Some(limit) = settings
            .bt
            .max_upload_bytes_per_second
            .filter(|value| *value > 0)
        {
            command.arg("--max-upload-limit").arg(format!("{limit}B"));
        }
        let proxy = task
            .proxy
            .as_ref()
            .or(Some(&settings.proxy))
            .and_then(|value| value.url.as_deref())
            .filter(|value| !value.trim().is_empty());
        if let Some(proxy) = proxy {
            command.arg("--all-proxy").arg(proxy);
        }
        let selected_files = task
            .bt
            .as_ref()
            .and_then(|value| value.selected_file_indexes.as_ref())
            .into_iter()
            .flatten()
            .copied()
            .filter(|value| *value > 0)
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        if !selected_files.is_empty() {
            command.arg("--select-file").arg(selected_files.join(","));
        }
        let task_trackers = task
            .bt
            .as_ref()
            .and_then(|value| value.tracker_urls.as_ref())
            .into_iter()
            .flatten();
        let trackers = task_trackers
            .chain(settings.bt.tracker_urls.iter())
            .filter(|value| !value.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>();
        if !trackers.is_empty() {
            command.arg("--bt-tracker").arg(trackers.join(","));
        }
        command
            .arg(&task.url)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        Ok(command)
    }
}

fn stop_process_tree(child: &mut Child) {
    lyra_process_lifecycle_core::terminate_process_tree(child.id(), false);
    let deadline = Instant::now() + GRACEFUL_STOP_TIMEOUT;
    while Instant::now() < deadline {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => thread::sleep(PROCESS_POLL_INTERVAL),
            Err(_) => break,
        }
    }
    lyra_process_lifecycle_core::terminate_process_tree(child.id(), true);
    let _ = child.kill();
    let _ = child.wait();
}

fn required_absolute_path(value: Option<OsString>, name: &str) -> Result<PathBuf, String> {
    let path = value
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| unavailable_message(&format!("{name} path is missing")))?;
    if !path.is_absolute() {
        return Err(unavailable_message(&format!(
            "{name} path must be absolute"
        )));
    }
    Ok(path)
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn assert_component_binary_path(component_root: &Path, binary_path: &Path) -> Result<(), String> {
    let root_metadata = fs::symlink_metadata(component_root)
        .map_err(|error| unavailable_message(&format!("component root is unavailable: {error}")))?;
    if !root_metadata.is_dir() || root_metadata.file_type().is_symlink() {
        return Err(unavailable_message(
            "component root must be a real directory, not a symbolic link",
        ));
    }
    let relative = binary_path
        .strip_prefix(component_root)
        .map_err(|_| unavailable_message("binary path is outside the verified component root"))?;
    if relative.as_os_str().is_empty()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(unavailable_message(
            "binary path contains an unsafe component",
        ));
    }
    let mut lexical = component_root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(part) = component else {
            return Err(unavailable_message(
                "binary path contains an unsafe component",
            ));
        };
        lexical.push(part);
        let metadata = fs::symlink_metadata(&lexical).map_err(|error| {
            unavailable_message(&format!("binary path cannot be inspected: {error}"))
        })?;
        if metadata.file_type().is_symlink() {
            return Err(unavailable_message(
                "binary path must not contain symbolic links",
            ));
        }
    }

    let root = fs::canonicalize(component_root)
        .map_err(|error| unavailable_message(&format!("component root is invalid: {error}")))?;
    let binary = fs::canonicalize(binary_path)
        .map_err(|error| unavailable_message(&format!("binary is unavailable: {error}")))?;
    if binary == root || !binary.starts_with(&root) {
        return Err(unavailable_message(
            "binary path is outside the verified component root",
        ));
    }
    let metadata = fs::metadata(&binary)
        .map_err(|error| unavailable_message(&format!("binary is unavailable: {error}")))?;
    if !metadata.is_file() {
        return Err(unavailable_message("binary is not a regular file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(unavailable_message("binary is not executable"));
        }
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path)
        .map_err(|error| unavailable_message(&format!("binary cannot be read: {error}")))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| unavailable_message(&format!("binary cannot be hashed: {error}")))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn directory_size(root: &Path) -> u64 {
    let Ok(metadata) = fs::symlink_metadata(root) else {
        return 0;
    };
    if metadata.file_type().is_symlink() {
        return 0;
    }
    if metadata.is_file() {
        return metadata.len();
    }
    if !metadata.is_dir() {
        return 0;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| directory_size(&entry.path()))
        .sum()
}

fn aria2_exit_message(status: ExitStatus, stderr: &str) -> String {
    if stderr.is_empty() {
        format!(
            "aria2 component exited unsuccessfully ({})",
            status.code().map_or_else(
                || "terminated by signal".to_string(),
                |code| code.to_string()
            )
        )
    } else {
        format!("aria2 component failed: {stderr}")
    }
}

fn unavailable_message(detail: &str) -> String {
    format!("aria2 component unavailable: {detail}. Repair or reinstall lyra.resource.aria2.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        DownloadBtSettings, DownloadBtTaskOptions, DownloadPostProcessingSettings,
        DownloadPriority, DownloadProxySettings, DownloadTaskBackend, DownloadTaskOutputKind,
        DownloadTaskSource, DownloadTaskState,
    };
    use std::collections::HashMap;

    fn write_binary(root: &Path, contents: &[u8]) -> PathBuf {
        let binary = root.join("bin").join(if cfg!(windows) {
            "aria2c.exe"
        } else {
            "aria2c"
        });
        fs::create_dir_all(binary.parent().expect("parent")).expect("create bin");
        fs::write(&binary, contents).expect("write binary");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o755))
                .expect("make executable");
        }
        binary
    }

    fn runtime(root: &Path, binary: &Path, digest: String) -> Result<Aria2Runtime, String> {
        Aria2Runtime::from_values(
            Some(binary.as_os_str().to_owned()),
            Some(root.as_os_str().to_owned()),
            Some("1.0.0".to_string()),
            Some(digest),
            Some(ARIA2_TRUST_VALUE.to_string()),
            None,
        )
    }

    fn settings() -> DownloadSettings {
        DownloadSettings {
            version: 1,
            speed_limit_bytes_per_second: None,
            schedule: None,
            proxy: DownloadProxySettings {
                mode: "none".to_string(),
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
            updated_at: "2026-07-31T00:00:00.000Z".to_string(),
        }
    }

    fn task(output: &Path) -> DownloadTask {
        DownloadTask {
            id: "aria-task".to_string(),
            url: "magnet:?xt=urn:btih:abc".to_string(),
            original_url: None,
            final_url: None,
            referrer: None,
            file_name: "payload".to_string(),
            mime_type: None,
            request_headers: None,
            proxy: None,
            save_path: output.to_string_lossy().to_string(),
            directory: output
                .parent()
                .expect("output parent")
                .to_string_lossy()
                .to_string(),
            protocol: "magnet".to_string(),
            source: DownloadTaskSource::Manual,
            backend: Some(DownloadTaskBackend::Aria2),
            output_kind: Some(DownloadTaskOutputKind::Directory),
            source_tab_id: None,
            source_title: None,
            state: DownloadTaskState::Downloading,
            received_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_second: 0,
            estimated_remaining_ms: None,
            priority: DownloadPriority::Normal,
            connections_requested: 1,
            connections_active: 1,
            can_resume: true,
            created_at: "2026-07-31T00:00:00.000Z".to_string(),
            updated_at: "2026-07-31T00:00:00.000Z".to_string(),
            started_at: None,
            completed_at: None,
            error_message: None,
            checksum: None,
            retry_count: Some(0),
            max_retries: Some(0),
            retry_delay_ms: Some(0),
            mirrors: None,
            active_mirror_index: Some(0),
            bt: Some(DownloadBtTaskOptions::default()),
            schedule_paused: Some(false),
            post_processing_state: Some("idle".to_string()),
            post_processing_message: None,
            missing_archive_parts: None,
            tags: Vec::new(),
        }
    }

    #[test]
    fn consumes_only_the_digest_bound_component_binary_path() {
        let temp = tempfile::tempdir().expect("tempdir");
        let binary = write_binary(temp.path(), b"verified aria2 fixture");
        let digest = sha256_file(&binary).expect("digest");
        let runtime = runtime(temp.path(), &binary, digest).expect("runtime");
        let command = runtime
            .command_for(&task(&temp.path().join("output")), &settings())
            .expect("command");

        assert_eq!(command.get_program(), binary.as_os_str());
        assert!(
            command
                .get_args()
                .any(|argument| argument == "magnet:?xt=urn:btih:abc")
        );
        assert!(!command.get_args().any(|argument| argument == "aria2c"));
    }

    #[test]
    fn rejects_missing_and_tampered_component_binaries() {
        let temp = tempfile::tempdir().expect("tempdir");
        let binary = write_binary(temp.path(), b"original");
        let digest = sha256_file(&binary).expect("digest");
        fs::write(&binary, b"tampered").expect("tamper");

        let tampered = runtime(temp.path(), &binary, digest).expect_err("must reject tamper");
        assert!(tampered.contains("SHA-256"));

        let missing = Aria2Runtime::from_values(
            Some(temp.path().join("missing").into_os_string()),
            Some(temp.path().as_os_str().to_owned()),
            Some("1.0.0".to_string()),
            Some("0".repeat(64)),
            Some(ARIA2_TRUST_VALUE.to_string()),
            None,
        )
        .expect_err("must reject missing");
        assert!(missing.contains("unavailable"));
    }

    #[test]
    fn rechecks_the_binary_digest_immediately_before_each_spawn() {
        let temp = tempfile::tempdir().expect("tempdir");
        let binary = write_binary(temp.path(), b"original");
        let digest = sha256_file(&binary).expect("digest");
        let runtime = runtime(temp.path(), &binary, digest).expect("runtime");
        fs::write(&binary, b"replaced after resolution").expect("replace binary");

        let error = runtime
            .execute(
                &task(&temp.path().join("output")),
                &settings(),
                || true,
                |_| {},
            )
            .expect_err("must recheck digest");
        assert!(matches!(error, Aria2RunError::Unavailable(_)));
    }

    #[cfg(unix)]
    #[test]
    fn executes_the_verified_absolute_component_binary() {
        let temp = tempfile::tempdir().expect("tempdir");
        let binary = write_binary(temp.path(), b"#!/bin/sh\nexit 0\n");
        let digest = sha256_file(&binary).expect("digest");
        let runtime = runtime(temp.path(), &binary, digest).expect("runtime");

        let outcome = runtime
            .execute(
                &task(&temp.path().join("output")),
                &settings(),
                || true,
                |_| {},
            )
            .expect("execute")
            .expect("completed");
        assert_eq!(outcome.received, 0);
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_stops_the_verified_process_group() {
        let temp = tempfile::tempdir().expect("tempdir");
        let binary = write_binary(
            temp.path(),
            b"#!/bin/sh\ntrap 'exit 0' TERM\nwhile :; do sleep 1; done\n",
        );
        let digest = sha256_file(&binary).expect("digest");
        let runtime = runtime(temp.path(), &binary, digest).expect("runtime");

        let started = Instant::now();
        let outcome = runtime
            .execute(
                &task(&temp.path().join("output")),
                &settings(),
                || false,
                |_| {},
            )
            .expect("cancel");
        assert_eq!(outcome, None);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn rejects_untrusted_or_relative_runtime_identity_without_path_fallback() {
        let missing_trust = Aria2Runtime::from_values(
            Some(OsString::from("/usr/bin/aria2c")),
            Some(OsString::from("/usr")),
            Some("1.0.0".to_string()),
            Some("0".repeat(64)),
            None,
            None,
        )
        .expect_err("must require Core trust marker");
        assert!(missing_trust.contains("verified aria2 component identity"));

        let relative = Aria2Runtime::from_values(
            Some(OsString::from("aria2c")),
            Some(OsString::from("components")),
            Some("1.0.0".to_string()),
            Some("0".repeat(64)),
            Some(ARIA2_TRUST_VALUE.to_string()),
            None,
        )
        .expect_err("must reject PATH-style identity");
        assert!(relative.contains("absolute"));
    }

    #[test]
    fn accepts_the_manifest_verified_bundle_marker_only_in_development_mode() {
        let temp = tempfile::tempdir().expect("tempdir");
        let binary = write_binary(temp.path(), b"verified development aria2 fixture");
        let digest = sha256_file(&binary).expect("digest");
        let accepted = Aria2Runtime::from_values(
            Some(binary.as_os_str().to_owned()),
            Some(temp.path().as_os_str().to_owned()),
            Some("aria2-development".to_string()),
            Some(digest.clone()),
            Some(ARIA2_DEVELOPMENT_TRUST_VALUE.to_string()),
            Some(DEVELOPMENT_RESOURCE_MODE.to_string()),
        );
        assert!(accepted.is_ok());

        let rejected = Aria2Runtime::from_values(
            Some(binary.as_os_str().to_owned()),
            Some(temp.path().as_os_str().to_owned()),
            Some("aria2-development".to_string()),
            Some(digest),
            Some(ARIA2_DEVELOPMENT_TRUST_VALUE.to_string()),
            Some("signed-components".to_string()),
        )
        .expect_err("development identity must not work in packaged mode");
        assert!(rejected.contains("verified aria2 component identity"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_binary_even_when_it_resolves_inside_the_component() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let binary = write_binary(temp.path(), b"verified aria2 fixture");
        let linked = binary.with_file_name("aria2-link");
        symlink(&binary, &linked).expect("create symlink");
        let digest = sha256_file(&binary).expect("digest");

        let error = runtime(temp.path(), &linked, digest).expect_err("must reject symlink");
        assert!(error.contains("symbolic links"));
    }

    #[test]
    fn rejects_non_aria2_urls_before_spawning_the_component() {
        let temp = tempfile::tempdir().expect("tempdir");
        let binary = write_binary(temp.path(), b"verified aria2 fixture");
        let digest = sha256_file(&binary).expect("digest");
        let runtime = runtime(temp.path(), &binary, digest).expect("runtime");
        let mut request = task(&temp.path().join("output"));
        request.url = "https://example.com/archive.zip".to_string();

        let error = runtime
            .execute(&request, &settings(), || true, |_| {})
            .expect_err("ordinary HTTP must not use aria2");
        assert!(matches!(error, Aria2RunError::Rejected(_)));
    }
}
