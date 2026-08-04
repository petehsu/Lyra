use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

#[cfg(target_os = "windows")]
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

const REQUEST_SCHEMA_VERSION: u32 = 1;
const MAX_REQUEST_BYTES: u64 = 128 * 1024;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ElevatedInstallRequestV1 {
    pub schema_version: u32,
    pub catalog: Option<String>,
    pub install_root: Option<PathBuf>,
    pub state_root: Option<PathBuf>,
    pub program_root: Option<PathBuf>,
    pub language: String,
    pub release: Option<String>,
    pub target: Option<String>,
    pub proxy: Option<String>,
    pub offline_bundle: Option<PathBuf>,
    pub include_on_demand: bool,
    pub operation: String,
    pub remove_user_data: bool,
    pub remove_user_data_confirmation: Option<String>,
    pub trusted_roots: Vec<String>,
    pub user_data_root: PathBuf,
    pub cancel_path: PathBuf,
}

impl ElevatedInstallRequestV1 {
    pub fn new(language: impl Into<String>, user_data_root: PathBuf) -> Self {
        Self {
            schema_version: REQUEST_SCHEMA_VERSION,
            catalog: None,
            install_root: None,
            state_root: None,
            program_root: None,
            language: language.into(),
            release: None,
            target: None,
            proxy: None,
            offline_bundle: None,
            include_on_demand: false,
            operation: "install".to_string(),
            remove_user_data: false,
            remove_user_data_confirmation: None,
            trusted_roots: Vec::new(),
            user_data_root,
            cancel_path: std::env::temp_dir()
                .join(format!("lyra-installer-cancel-{}", Uuid::new_v4())),
        }
    }

    fn validate(&self) -> Result<(), String> {
        if self.schema_version != REQUEST_SCHEMA_VERSION {
            return Err(format!(
                "Unsupported elevation request schema {}.",
                self.schema_version
            ));
        }
        if self.language != "en" && self.language != "zh-CN" {
            return Err("The elevated installer language is invalid.".to_string());
        }
        if self.operation != "install" && self.operation != "uninstall" {
            return Err("The elevated installer operation is invalid.".to_string());
        }
        if self.operation != "uninstall"
            && (self.remove_user_data || self.remove_user_data_confirmation.is_some())
        {
            return Err("Only an uninstall request may remove user data.".to_string());
        }
        if self.operation == "uninstall"
            && self.remove_user_data
            && self.remove_user_data_confirmation.as_deref() != Some("DELETE-LYRA-DATA")
        {
            return Err(
                "The elevated uninstall request is missing the user-data confirmation phrase."
                    .to_string(),
            );
        }
        if !self.remove_user_data && self.remove_user_data_confirmation.is_some() {
            return Err(
                "A user-data confirmation is valid only when user data is removed.".to_string(),
            );
        }
        for (label, path) in [
            ("component root", self.install_root.as_deref()),
            ("state root", self.state_root.as_deref()),
            ("program root", self.program_root.as_deref()),
            ("offline bundle", self.offline_bundle.as_deref()),
            ("user data root", Some(self.user_data_root.as_path())),
            ("cancellation marker", Some(self.cancel_path.as_path())),
        ] {
            if path.is_some_and(|path| {
                !path.is_absolute()
                    || path.parent().is_none()
                    || path.components().any(|component| {
                        matches!(
                            component,
                            std::path::Component::CurDir | std::path::Component::ParentDir
                        )
                    })
            }) {
                return Err(format!(
                    "The elevated {label} must be an absolute, normalized, non-root path."
                ));
            }
        }
        if self.cancel_path.parent() != Some(std::env::temp_dir().as_path())
            || !self
                .cancel_path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("lyra-installer-cancel-"))
        {
            return Err(
                "The elevated cancellation marker is outside the installer temporary directory."
                    .to_string(),
            );
        }
        Ok(())
    }
}

#[derive(Debug)]
pub struct ElevationRequestFile {
    path: PathBuf,
    sha256: String,
    cancel_path: PathBuf,
}

impl ElevationRequestFile {
    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    fn cancel_path(&self) -> &Path {
        &self.cancel_path
    }
}

impl Drop for ElevationRequestFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
        let _ = fs::remove_file(&self.cancel_path);
    }
}

pub fn write_request(request: &ElevatedInstallRequestV1) -> Result<ElevationRequestFile, String> {
    request.validate()?;
    let bytes = serde_json::to_vec(request)
        .map_err(|error| format!("Unable to encode the elevation request: {error}"))?;
    if bytes.len() as u64 > MAX_REQUEST_BYTES {
        return Err("The elevation request is too large.".to_string());
    }
    if request.cancel_path.exists() {
        return Err("The elevation cancellation marker already exists.".to_string());
    }
    let path =
        std::env::temp_dir().join(format!("lyra-installer-elevation-{}.json", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|error| format!("Unable to create the elevation request: {error}"))?;
    if let Err(error) = file.write_all(&bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&path);
        return Err(format!("Unable to save the elevation request: {error}"));
    }
    Ok(ElevationRequestFile {
        path,
        sha256: hex_sha256(&bytes),
        cancel_path: request.cancel_path.clone(),
    })
}

pub fn read_request(
    path: &Path,
    expected_sha256: &str,
) -> Result<ElevatedInstallRequestV1, String> {
    if !is_sha256(expected_sha256) {
        return Err("The elevation request digest is invalid.".to_string());
    }
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Unable to inspect the elevation request: {error}"))?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() > MAX_REQUEST_BYTES
    {
        return Err("The elevation request is not a bounded regular file.".to_string());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    OpenOptions::new()
        .read(true)
        .open(path)
        .and_then(|file| file.take(MAX_REQUEST_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|error| format!("Unable to read the elevation request: {error}"))?;
    if bytes.len() as u64 > MAX_REQUEST_BYTES {
        return Err("The elevation request grew beyond its permitted size.".to_string());
    }
    if hex_sha256(&bytes) != expected_sha256 {
        return Err("The elevation request changed before it could be authorized.".to_string());
    }
    let request = serde_json::from_slice::<ElevatedInstallRequestV1>(&bytes)
        .map_err(|error| format!("The elevation request is invalid: {error}"))?;
    request.validate()?;
    fs::remove_file(path)
        .map_err(|error| format!("Unable to consume the elevation request: {error}"))?;
    Ok(request)
}

pub fn relaunch_elevated(
    request: &ElevationRequestFile,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("Unable to locate the Lyra installer: {error}"))?;
    let arguments = [
        "--elevation-request".to_string(),
        request.path().display().to_string(),
        "--elevation-request-sha256".to_string(),
        request.sha256().to_string(),
        "--headless".to_string(),
    ];
    let mut child = elevated_child(&executable, &arguments)?;
    let status = loop {
        if cancelled.load(Ordering::Acquire) {
            signal_cancellation(request.cancel_path())?;
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                return Err(format!(
                    "Unable to monitor the elevated Lyra installer: {error}"
                ));
            }
        }
    };
    if status.success() {
        Ok(())
    } else {
        Err(match status.code() {
            Some(code) => format!(
                "The elevated Lyra installer did not complete successfully (exit code {code})."
            ),
            None => "The elevated Lyra installer was interrupted.".to_string(),
        })
    }
}

#[cfg(target_os = "macos")]
fn elevated_child(executable: &Path, arguments: &[String]) -> Result<Child, String> {
    let mut command = shell_quote(
        executable
            .to_str()
            .ok_or_else(|| "The installer path is not valid UTF-8.".to_string())?,
    );
    for argument in arguments {
        command.push(' ');
        command.push_str(&shell_quote(argument));
    }
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        command.replace('\\', "\\\\").replace('"', "\\\"")
    );
    Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg(script)
        .spawn()
        .map_err(|error| format!("Unable to request administrator access: {error}"))
}

#[cfg(target_os = "linux")]
fn elevated_child(executable: &Path, arguments: &[String]) -> Result<Child, String> {
    Command::new("pkexec")
        .arg(executable)
        .args(arguments)
        .spawn()
        .map_err(|error| {
            format!(
                "Unable to request administrator access with pkexec. Install a PolicyKit authentication agent or choose the current-user installation: {error}"
            )
        })
}

#[cfg(target_os = "windows")]
fn elevated_child(executable: &Path, arguments: &[String]) -> Result<Child, String> {
    let executable = executable
        .to_str()
        .ok_or_else(|| "The installer path is not valid Unicode.".to_string())?;
    let argument_list = arguments
        .iter()
        .map(|value| windows_command_line_argument(value))
        .collect::<Vec<_>>()
        .join(" ");
    let script = format!(
        "$p=Start-Process -FilePath {} -ArgumentList {} -Verb RunAs -Wait -PassThru; if ($null -eq $p) {{ exit 1 }}; exit $p.ExitCode",
        powershell_literal(executable),
        powershell_literal(&argument_list)
    );
    let utf16_le = script
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16_le);
    Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            &encoded,
        ])
        .spawn()
        .map_err(|error| format!("Unable to request administrator access: {error}"))
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn elevated_child(_executable: &Path, _arguments: &[String]) -> Result<Child, String> {
    Err("System-wide installation is not supported on this platform.".to_string())
}

fn signal_cancellation(path: &Path) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(mut file) => file
            .write_all(b"cancel\n")
            .and_then(|()| file.sync_all())
            .map_err(|error| format!("Unable to signal installer cancellation: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(format!(
            "Unable to create the installer cancellation marker: {error}"
        )),
    }
}

fn hex_sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|value| value.is_ascii_hexdigit() && !value.is_ascii_uppercase())
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(any(target_os = "windows", test))]
fn powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(any(target_os = "windows", test))]
fn windows_command_line_argument(value: &str) -> String {
    if !value.is_empty()
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character == '"')
    {
        return value.to_string();
    }
    let mut quoted = String::from("\"");
    let mut backslashes = 0_usize;
    for character in value.chars() {
        if character == '\\' {
            backslashes += 1;
            continue;
        }
        if character == '"' {
            quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
            quoted.push('"');
        } else {
            quoted.push_str(&"\\".repeat(backslashes));
            quoted.push(character);
        }
        backslashes = 0;
    }
    quoted.push_str(&"\\".repeat(backslashes * 2));
    quoted.push('"');
    quoted
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_round_trip_is_content_bound_and_consumed_once() {
        let mut request =
            ElevatedInstallRequestV1::new("zh-CN", std::env::temp_dir().join("lyra-user-data"));
        request.catalog = Some("https://releases.example/catalog.json".to_string());
        request.proxy = Some("http://127.0.0.1:8080".to_string());
        let stored = write_request(&request).expect("stored request");
        let path = stored.path().to_path_buf();
        let restored = read_request(&path, stored.sha256()).expect("verified request");
        assert_eq!(restored, request);
        assert!(!path.exists());
    }

    #[test]
    fn changed_request_is_rejected_before_elevation_data_is_used() {
        let request =
            ElevatedInstallRequestV1::new("en", std::env::temp_dir().join("lyra-user-data"));
        let stored = write_request(&request).expect("stored request");
        fs::write(stored.path(), b"{}").expect("tamper test request");
        let error = read_request(stored.path(), stored.sha256()).expect_err("must reject");
        assert!(error.contains("changed"));
    }

    #[test]
    fn cancellation_marker_is_private_and_idempotent() {
        let request =
            ElevatedInstallRequestV1::new("en", std::env::temp_dir().join("lyra-user-data"));
        let stored = write_request(&request).expect("stored request");
        signal_cancellation(stored.cancel_path()).expect("first cancellation");
        signal_cancellation(stored.cancel_path()).expect("repeated cancellation");
        assert!(stored.cancel_path().is_file());
    }

    #[test]
    fn windows_elevation_arguments_preserve_spaces_quotes_and_trailing_slashes() {
        assert_eq!(
            windows_command_line_argument(r"C:\Users\Pete Hsu\request.json"),
            r#""C:\Users\Pete Hsu\request.json""#
        );
        assert_eq!(
            windows_command_line_argument("value\"quoted"),
            r#""value\"quoted""#
        );
        assert_eq!(
            windows_command_line_argument("C:\\folder with space\\"),
            "\"C:\\folder with space\\\\\""
        );
        assert_eq!(powershell_literal("Pete's"), "'Pete''s'");
    }
}
