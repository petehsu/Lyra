use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;

use super::catalog::{AcquireKind, ServerEntry};
use super::events::{acquire_event, emit_event};

pub const DISABLE_DOWNLOAD_ENV: &str = "LYRA_DISABLE_LSP_DOWNLOAD";
const CACHE_DIR_ENV: &str = "LYRA_LSP_CACHE_DIR";

// ponytail: one npm/go/github fetch at a time so two yaml opens cannot race the same prefix.
static ACQUIRE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static FAILED_ACQUIRES: Lazy<Mutex<HashSet<&'static str>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

#[derive(Clone, Debug)]
pub struct ResolvedServerCommand {
    pub program: String,
    pub args: Vec<String>,
}

pub fn download_disabled() -> bool {
    matches!(
        std::env::var(DISABLE_DOWNLOAD_ENV).ok().as_deref(),
        Some("1" | "true" | "TRUE" | "yes")
    )
}

pub fn cache_root() -> PathBuf {
    if let Ok(explicit) = std::env::var(CACHE_DIR_ENV) {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lyra")
        .join("lsp")
}

fn cache_dir(entry: &ServerEntry) -> PathBuf {
    cache_root()
        .join(entry.id)
        .join(entry.pin_version.unwrap_or("default"))
}

fn version_file(entry: &ServerEntry) -> PathBuf {
    cache_dir(entry).join("VERSION")
}

fn cached_program(entry: &ServerEntry) -> Option<PathBuf> {
    let dir = cache_dir(entry);
    if !dir.is_dir() {
        return None;
    }
    if let Some(pinned) = entry.pin_version {
        let recorded = fs::read_to_string(version_file(entry)).unwrap_or_default();
        if recorded.trim() != pinned {
            return None;
        }
    }
    find_program_in_dir(&dir, entry.program)
}

fn find_program_in_dir(dir: &Path, program: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        format!("{program}.exe")
    } else {
        program.to_string()
    };
    let direct = dir.join(&exe);
    if is_executable(&direct) {
        return Some(direct);
    }
    let bin = dir.join("bin").join(&exe);
    if is_executable(&bin) {
        return Some(bin);
    }
    let npm_bin = dir
        .join("node_modules")
        .join(".bin")
        .join(if cfg!(windows) {
            format!("{program}.cmd")
        } else {
            program.to_string()
        });
    if npm_bin.exists() {
        return Some(npm_bin);
    }
    walk_for_program(dir, &exe, 0)
}

fn walk_for_program(dir: &Path, exe: &str, depth: usize) -> Option<PathBuf> {
    if depth > 4 {
        return None;
    }
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = walk_for_program(&path, exe, depth + 1) {
                return Some(found);
            }
            continue;
        }
        if path
            .file_name()?
            .to_string_lossy()
            .eq_ignore_ascii_case(exe)
            && is_executable(&path)
        {
            return Some(path);
        }
    }
    None
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .map(|meta| meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn env_program(entry: &ServerEntry) -> Option<String> {
    let key = entry.env_program?;
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty() && Path::new(value).exists())
}

fn path_program(program: &str) -> Option<String> {
    which::which(program)
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

fn server_cache_present(entry: &ServerEntry) -> bool {
    cache_root().join(entry.id).is_dir()
}

fn resolved(entry: &ServerEntry, program: String) -> ResolvedServerCommand {
    ResolvedServerCommand {
        program,
        args: entry
            .args
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
    }
}

pub fn resolve_existing_binary(entry: &ServerEntry) -> Option<ResolvedServerCommand> {
    if let Some(program) = env_program(entry) {
        return Some(resolved(entry, program));
    }
    if let Some(program) = cached_program(entry) {
        return Some(resolved(entry, program.to_string_lossy().into_owned()));
    }
    path_program(entry.program).map(|program| resolved(entry, program))
}

fn download_entry(
    entry: &ServerEntry,
    project_root: Option<&str>,
    status: &str,
    message: &str,
) -> Result<ResolvedServerCommand, String> {
    emit_event(acquire_event(entry.id, status, Some(message), project_root));
    let result = match entry.acquire {
        AcquireKind::Npm => install_npm(entry),
        AcquireKind::GithubRelease => install_github(entry),
        AcquireKind::GoInstall => install_go(entry),
        AcquireKind::DotnetTool => install_dotnet(entry),
        AcquireKind::Gem => install_gem(entry),
        AcquireKind::Path | AcquireKind::Component => {
            return Err(format!(
                "language server `{}` cannot be downloaded",
                entry.id
            ));
        }
    };
    match result {
        Ok(program) => {
            emit_event(acquire_event(
                entry.id,
                "completed",
                Some(&format!("{} is ready", entry.id)),
                project_root,
            ));
            Ok(resolved(entry, program.to_string_lossy().into_owned()))
        }
        Err(error) => {
            emit_event(acquire_event(
                entry.id,
                "failed",
                Some(&error),
                project_root,
            ));
            Err(error)
        }
    }
}

fn acquire_failed(id: &'static str) -> bool {
    FAILED_ACQUIRES
        .lock()
        .map(|ids| ids.contains(id))
        .unwrap_or(false)
}

fn mark_acquire_failed(id: &'static str) {
    if let Ok(mut ids) = FAILED_ACQUIRES.lock() {
        ids.insert(id);
    }
}

fn npm_install_args(spec: &str, prefix: &Path) -> Vec<String> {
    vec![
        "install".to_string(),
        "--omit=dev".to_string(),
        "--no-fund".to_string(),
        "--no-audit".to_string(),
        "--prefix".to_string(),
        prefix.to_string_lossy().into_owned(),
        spec.to_string(),
    ]
}

fn write_npm_prefix_manifest(dir: &Path) -> Result<(), String> {
    let path = dir.join("package.json");
    if path.is_file() {
        return Ok(());
    }
    fs::write(path, "{\"name\":\"lyra-lsp-cache\",\"private\":true}\n")
        .map_err(|error| error.to_string())
}

pub fn ensure_binary(
    entry: &ServerEntry,
    project_root: Option<&str>,
) -> Result<ResolvedServerCommand, String> {
    if !super::catalog::spawns_language_server(entry) {
        return Err(format!(
            "language server `{}` is syntax-only",
            entry.program
        ));
    }
    if let Some(command) = resolve_existing_binary(entry) {
        return Ok(command);
    }
    if download_disabled() {
        emit_event(acquire_event(
            entry.id,
            "skipped",
            Some("Language server download is disabled"),
            project_root,
        ));
        return Err(format!(
            "language server `{}` is unavailable and download is disabled",
            entry.id
        ));
    }
    if entry.acquire == AcquireKind::Component {
        emit_event(acquire_event(
            entry.id,
            "failed",
            Some(&format!(
                "{} requires the signed rust-analyzer component or PATH",
                entry.id
            )),
            project_root,
        ));
        return Err(format!(
            "{} requires the signed rust-analyzer component or PATH",
            entry.id
        ));
    }
    if entry.acquire == AcquireKind::Path {
        emit_event(acquire_event(
            entry.id,
            "failed",
            Some(&format!(
                "Language server `{}` is not installed locally",
                entry.program
            )),
            project_root,
        ));
        return Err(format!(
            "language server `{}` is not installed; install it on this machine",
            entry.program
        ));
    }
    if acquire_failed(entry.id) {
        return Err(format!(
            "language server `{}` is unavailable",
            entry.program
        ));
    }
    let _guard = ACQUIRE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(program) = cached_program(entry) {
        return Ok(resolved(entry, program.to_string_lossy().into_owned()));
    }
    if acquire_failed(entry.id) {
        return Err(format!(
            "language server `{}` is unavailable",
            entry.program
        ));
    }
    let status = if server_cache_present(entry) {
        "updating"
    } else {
        "downloading"
    };
    match download_entry(
        entry,
        project_root,
        status,
        &format!(
            "{} {}",
            if status == "updating" {
                "Updating"
            } else {
                "Downloading"
            },
            entry.id
        ),
    ) {
        Ok(command) => Ok(command),
        Err(error) => {
            mark_acquire_failed(entry.id);
            Err(error)
        }
    }
}

pub fn refresh_cached_servers() {
    if download_disabled() {
        return;
    }
    for entry in super::catalog::SERVERS {
        if !server_cache_present(entry) || cached_program(entry).is_some() {
            continue;
        }
        let _ = ensure_binary(entry, None);
    }
}

fn write_version(entry: &ServerEntry) -> Result<(), String> {
    if let Some(version) = entry.pin_version {
        fs::write(version_file(entry), version).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn install_npm(entry: &ServerEntry) -> Result<PathBuf, String> {
    let package = entry.npm_package.ok_or("npm package missing")?;
    let spec = match entry.pin_version {
        Some(version) => format!("{package}@{version}"),
        None => package.to_string(),
    };
    let dir = cache_dir(entry);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    write_npm_prefix_manifest(&dir)?;
    let tmp = dir.join("tmp");
    let npm_cache = dir.join(".npm-cache");
    fs::create_dir_all(&tmp).map_err(|error| error.to_string())?;
    fs::create_dir_all(&npm_cache).map_err(|error| error.to_string())?;
    let status = Command::new("npm")
        .args(npm_install_args(&spec, &dir))
        .current_dir(&dir)
        .env("TMPDIR", &tmp)
        .env("TEMP", &tmp)
        .env("TMP", &tmp)
        .env("npm_config_cache", &npm_cache)
        .env_remove("npm_config_prefix")
        .status()
        .map_err(|error| format!("npm is required to install {package}: {error}"))?;
    if !status.success() {
        return Err(format!("npm install {spec} failed"));
    }
    write_version(entry)?;
    find_program_in_dir(&dir, entry.npm_bin.unwrap_or(entry.program))
        .ok_or_else(|| format!("installed {package} but could not find {}", entry.program))
}

fn install_go(entry: &ServerEntry) -> Result<PathBuf, String> {
    let package = entry.go_package.ok_or("go package missing")?;
    let spec = match entry.pin_version {
        Some(version) => format!("{package}@{version}"),
        None => format!("{package}@latest"),
    };
    let dir = cache_dir(entry);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let status = Command::new("go")
        .args(["install", &spec])
        .env("GOBIN", &dir)
        .status()
        .map_err(|error| format!("go is required to install gopls: {error}"))?;
    if !status.success() {
        return Err(format!("go install {spec} failed"));
    }
    write_version(entry)?;
    find_program_in_dir(&dir, entry.program)
        .ok_or_else(|| format!("go install succeeded but {} is missing", entry.program))
}

fn install_dotnet(entry: &ServerEntry) -> Result<PathBuf, String> {
    let package = entry.dotnet_package.ok_or("dotnet package missing")?;
    let dir = cache_dir(entry);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let mut command = Command::new("dotnet");
    command
        .args(["tool", "install", "--tool-path"])
        .arg(&dir)
        .arg(package);
    if let Some(version) = entry.pin_version {
        command.args(["--version", version]);
    }
    let status = command
        .status()
        .map_err(|error| format!("dotnet is required to install {package}: {error}"))?;
    if !status.success() {
        return Err(format!("dotnet tool install {package} failed"));
    }
    write_version(entry)?;
    find_program_in_dir(&dir, entry.program).ok_or_else(|| {
        format!(
            "dotnet tool install succeeded but {} is missing",
            entry.program
        )
    })
}

fn install_gem(entry: &ServerEntry) -> Result<PathBuf, String> {
    let package = entry.gem_package.ok_or("gem package missing")?;
    let dir = cache_dir(entry);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let status = Command::new("gem")
        .args(["install", package, "--bindir"])
        .arg(&dir)
        .status()
        .map_err(|error| format!("gem is required to install {package}: {error}"))?;
    if !status.success() {
        return Err(format!("gem install {package} failed"));
    }
    write_version(entry)?;
    find_program_in_dir(&dir, entry.program)
        .ok_or_else(|| format!("gem install succeeded but {} is missing", entry.program))
}

fn install_github(entry: &ServerEntry) -> Result<PathBuf, String> {
    let repo = entry.github_repo.ok_or("github repo missing")?;
    let tag = entry.pin_version.ok_or("github release tag missing")?;
    let dir = cache_dir(entry);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .user_agent("lyra-lsp")
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| error.to_string())?;
    let url = format!("https://api.github.com/repos/{repo}/releases/tags/{tag}");
    let release: serde_json::Value = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status()?.json())
        .map_err(|error| format!("github release lookup failed: {error}"))?;
    let assets = release
        .get("assets")
        .and_then(serde_json::Value::as_array)
        .ok_or("github release has no assets")?;
    let needles = asset_needles();
    let asset = assets
        .iter()
        .find(|asset| {
            let name = asset
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .to_ascii_lowercase();
            needles.iter().all(|needle| name.contains(needle))
                && (name.ends_with(".zip") || name.ends_with(".tar.gz") || name.ends_with(".tgz"))
        })
        .ok_or_else(|| format!("no github asset matched {needles:?} for {repo}@{tag}"))?;
    let download_url = asset
        .get("browser_download_url")
        .and_then(serde_json::Value::as_str)
        .ok_or("asset is missing a download url")?;
    let bytes = client
        .get(download_url)
        .send()
        .and_then(|response| response.error_for_status()?.bytes())
        .map_err(|error| format!("github asset download failed: {error}"))?;
    let archive_name = asset
        .get("name")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("asset.bin");
    let archive_path = dir.join(archive_name);
    {
        let mut file = fs::File::create(&archive_path).map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
    }
    extract_archive(&archive_path, &dir)?;
    let _ = fs::remove_file(&archive_path);
    write_version(entry)?;
    find_program_in_dir(&dir, entry.program)
        .ok_or_else(|| format!("extracted {repo} but could not find {}", entry.program))
}

fn extract_archive(archive: &Path, dest: &Path) -> Result<(), String> {
    let name = archive
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if name.ends_with(".zip") {
        let file = fs::File::open(archive).map_err(|error| error.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
        zip.extract(dest).map_err(|error| error.to_string())?;
        return Ok(());
    }
    let file = fs::File::open(archive).map_err(|error| error.to_string())?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(dest).map_err(|error| error.to_string())
}

fn asset_needles() -> Vec<String> {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        vec!["aarch64", "arm64"]
    } else {
        vec!["x86_64", "x64", "amd64"]
    };
    let mut needles = vec![os.to_string()];
    needles.push(arch[0].to_string());
    needles
}

pub fn ensure_project_servers(project_root: &str) -> Vec<String> {
    let root = PathBuf::from(project_root);
    super::catalog::detect_primary_servers(&root)
        .into_iter()
        .filter_map(|entry| match ensure_binary(entry, Some(project_root)) {
            Ok(_) => Some(entry.id.to_string()),
            Err(_) => None,
        })
        .collect()
}

pub fn ensure_language(language_id: &str, project_root: Option<&str>) -> Result<String, String> {
    let entry = super::catalog::server_for_language(language_id)
        .ok_or_else(|| format!("language not supported: {language_id}"))?;
    ensure_binary(entry, project_root).map(|_| entry.id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::server_by_id;

    #[test]
    fn disable_flag_skips_download_for_missing_binaries() {
        let previous = std::env::var(DISABLE_DOWNLOAD_ENV).ok();
        std::env::set_var(DISABLE_DOWNLOAD_ENV, "1");
        let entry = server_by_id("tinymist").expect("tinymist");
        let error = ensure_binary(entry, None).expect_err("disabled");
        assert!(error.contains("download is disabled"));
        match previous {
            Some(value) => std::env::set_var(DISABLE_DOWNLOAD_ENV, value),
            None => std::env::remove_var(DISABLE_DOWNLOAD_ENV),
        }
    }

    #[test]
    fn refresh_is_a_no_op_without_local_cache() {
        let previous_cache = std::env::var(CACHE_DIR_ENV).ok();
        let previous_disable = std::env::var(DISABLE_DOWNLOAD_ENV).ok();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let cache = std::env::temp_dir().join(format!("lyra-lsp-refresh-{stamp}"));
        std::env::set_var(CACHE_DIR_ENV, &cache);
        std::env::set_var(DISABLE_DOWNLOAD_ENV, "1");
        refresh_cached_servers();
        assert!(!cache.exists());
        match previous_cache {
            Some(value) => std::env::set_var(CACHE_DIR_ENV, value),
            None => std::env::remove_var(CACHE_DIR_ENV),
        }
        match previous_disable {
            Some(value) => std::env::set_var(DISABLE_DOWNLOAD_ENV, value),
            None => std::env::remove_var(DISABLE_DOWNLOAD_ENV),
        }
    }

    #[test]
    fn npm_install_pins_prefix_to_cache_dir() {
        let prefix = PathBuf::from("/home/user/.lyra/lsp/yaml/1.17.0");
        let args = npm_install_args("yaml-language-server@1.17.0", &prefix);
        assert_eq!(
            args,
            vec![
                "install",
                "--omit=dev",
                "--no-fund",
                "--no-audit",
                "--prefix",
                "/home/user/.lyra/lsp/yaml/1.17.0",
                "yaml-language-server@1.17.0",
            ]
        );
    }

    #[test]
    fn finds_npm_bin_shim_inside_prefix() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lyra-lsp-npm-bin-{stamp}"));
        let bin = dir.join("node_modules").join(".bin");
        fs::create_dir_all(&bin).expect("bin dir");
        let shim = bin.join("yaml-language-server");
        fs::write(&shim, "#!/bin/sh\n").expect("shim");
        let found = find_program_in_dir(&dir, "yaml-language-server").expect("shim");
        assert_eq!(found, shim);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn failed_acquire_is_not_retried() {
        let entry = server_by_id("tinymist").expect("tinymist");
        if path_program(entry.program).is_some() {
            return;
        }
        mark_acquire_failed(entry.id);
        let started = std::time::Instant::now();
        let result = ensure_binary(entry, None);
        if let Ok(mut ids) = FAILED_ACQUIRES.lock() {
            ids.remove(entry.id);
        }
        let error = result.expect_err("latched");
        assert!(error.contains("unavailable"));
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }

    #[test]
    fn yaml_has_no_existing_binary_without_install() {
        let entry = server_by_id("yaml").expect("yaml");
        if path_program(entry.program).is_some() {
            return;
        }
        assert!(resolve_existing_binary(entry).is_none());
    }
}
