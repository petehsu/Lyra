#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod configuration;
mod elevation;
mod embedded_bundle;
mod uninstall;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use clap::Parser;
use configuration::{InstallScope, InstallerLanguage, resolve_install_paths};
use elevation::{ElevatedInstallRequestV1, read_request, relaunch_elevated, write_request};
use embedded_bundle::materialize_embedded_offline_bundle;
use lyra_bootstrap_core::{
    BootstrapInstaller, CoreProjectionConfig, CoreProjector, InstallProgressPhase,
    InstallProgressV1, InstallerConfig, Target, TrustedKeys,
};
use slint::ComponentHandle;
use uninstall::{UninstallConfig, uninstall};

slint::include_modules!();

#[derive(Clone, Debug, Parser)]
#[command(
    name = "lyra-installer",
    about = "Install or repair an exact signed Lyra release"
)]
struct Arguments {
    #[arg(long)]
    catalog: Option<String>,
    /// Override the scoped component store root. Intended for tests and
    /// managed deployments; normal installations derive this from --scope.
    #[arg(long)]
    install_root: Option<PathBuf>,
    /// Override the scoped activation/bootstrap state root.
    #[arg(long)]
    state_root: Option<PathBuf>,
    /// Override the fixed OS-visible Core projection directory. Intended for
    /// CI and managed deployments; normal installs derive it from --scope.
    #[arg(long)]
    program_root: Option<PathBuf>,
    #[arg(long, value_enum, default_value_t = InstallScope::CurrentUser)]
    scope: InstallScope,
    #[arg(long, value_enum, default_value_t = InstallerLanguage::Auto)]
    language: InstallerLanguage,
    #[arg(long)]
    release: Option<String>,
    #[arg(long)]
    target: Option<String>,
    #[arg(long)]
    proxy: Option<String>,
    #[arg(long)]
    offline_bundle: Option<PathBuf>,
    #[arg(long)]
    include_on_demand: bool,
    /// Remove the selected Lyra program and modular installation. User data
    /// is retained unless --remove-user-data is also explicitly confirmed.
    #[arg(long)]
    uninstall: bool,
    #[arg(long, requires = "uninstall")]
    remove_user_data: bool,
    #[arg(long, requires = "remove_user_data", value_name = "DELETE-LYRA-DATA")]
    confirm_remove_user_data: Option<String>,
    /// Start immediately with command-line selections. Used by CI and
    /// managed installation; the normal installer asks before writing.
    #[arg(long)]
    unattended: bool,
    /// Run without a window and exit when installation finishes. This is
    /// intended for CI smoke tests and managed deployment tooling.
    #[arg(long, conflicts_with = "unattended")]
    headless: bool,
    #[arg(long = "trusted-root", value_name = "KEY_ID=BASE64")]
    trusted_roots: Vec<String>,
    /// Internal, content-bound request used after the user authorizes a
    /// system-wide installation through the operating system.
    #[arg(long, hide = true)]
    elevation_request: Option<PathBuf>,
    #[arg(long, hide = true, requires = "elevation_request")]
    elevation_request_sha256: Option<String>,
    #[arg(skip)]
    elevated_cancel_path: Option<PathBuf>,
    /// Original invoking user's data root. This is transferred in the
    /// content-bound elevation request because a privileged child may observe
    /// a different HOME/USERPROFILE.
    #[arg(skip)]
    elevated_user_data_root: Option<PathBuf>,
}

#[derive(Clone, Debug)]
struct InstallSelection {
    scope: InstallScope,
    language: InstallerLanguage,
    proxy: Option<String>,
}

const EMBEDDED_CATALOG_URL: Option<&str> = option_env!("LYRA_INSTALLER_CATALOG_URL");
const EMBEDDED_TRUSTED_ROOTS_JSON: Option<&str> = option_env!("LYRA_INSTALLER_TRUSTED_ROOTS_JSON");

fn resolve_external_offline_bundle(arguments: &Arguments) -> Option<PathBuf> {
    if let Some(root) = arguments.offline_bundle.as_ref() {
        return Some(root.clone());
    }
    let adjacent = std::env::current_exe()
        .ok()?
        .parent()?
        .join("offline-bundle");
    adjacent.is_dir().then_some(adjacent)
}

fn resolve_catalog_source(
    arguments: &Arguments,
    offline_bundle: Option<&std::path::Path>,
) -> Result<String, String> {
    if let Some(value) = arguments
        .catalog
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(value.to_string());
    }
    if let Some(bundle_root) = offline_bundle {
        let catalog = bundle_root.join("catalog.json");
        if catalog.is_file() {
            return Ok(catalog.display().to_string());
        }
    }
    if let Some(value) = EMBEDDED_CATALOG_URL
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Ok(value.to_string());
    }
    Err(
        "No signed release catalog is configured. Use --catalog or build the installer with LYRA_INSTALLER_CATALOG_URL."
            .to_string(),
    )
}

fn resolve_trusted_roots(arguments: &Arguments) -> Result<Vec<(String, String)>, String> {
    if !arguments.trusted_roots.is_empty() {
        return arguments
            .trusted_roots
            .iter()
            .map(|value| {
                let (key_id, key) = value
                    .split_once('=')
                    .ok_or_else(|| "--trusted-root must use KEY_ID=BASE64".to_string())?;
                Ok((key_id.to_string(), key.to_string()))
            })
            .collect();
    }
    let raw = EMBEDDED_TRUSTED_ROOTS_JSON.ok_or_else(|| {
        "No trusted Lyra root keys are configured. Use --trusted-root or build the installer with LYRA_INSTALLER_TRUSTED_ROOTS_JSON."
            .to_string()
    })?;
    let roots = serde_json::from_str::<std::collections::BTreeMap<String, String>>(raw)
        .map_err(|error| format!("Embedded trusted roots are invalid: {error}"))?;
    if roots.is_empty() {
        return Err("Embedded trusted roots are empty.".to_string());
    }
    Ok(roots.into_iter().collect())
}

fn progress_fraction(progress: &InstallProgressV1) -> f32 {
    match progress.phase {
        InstallProgressPhase::Download if progress.total > 0 => {
            progress.completed as f32 / progress.total as f32
        }
        InstallProgressPhase::Install if progress.total_components > 0 => {
            progress.completed_components as f32 / progress.total_components as f32
        }
        InstallProgressPhase::Complete => 1.0,
        _ => 0.0,
    }
}

fn progress_labels(
    progress: &InstallProgressV1,
    language: InstallerLanguage,
) -> (&'static str, String) {
    let component = progress.component_id.as_deref().unwrap_or("Lyra");
    if language.is_chinese() {
        return match progress.phase {
            InstallProgressPhase::Catalog => {
                ("正在检查签名版本", "正在下载并验证发布目录".to_string())
            }
            InstallProgressPhase::Bom => {
                ("正在准备组件", "正在验证此版本的精确组件清单".to_string())
            }
            InstallProgressPhase::Download => ("正在下载 Lyra", format!("正在下载 {component}")),
            InstallProgressPhase::Verify => {
                ("正在验证组件", format!("正在检查 {component} 的签名和文件"))
            }
            InstallProgressPhase::Install => {
                ("正在安装 Lyra", format!("正在安全暂存或激活 {component}"))
            }
            InstallProgressPhase::Complete => {
                ("Lyra 已准备就绪", "所选组件均已通过完整性检查".to_string())
            }
        };
    }
    match progress.phase {
        InstallProgressPhase::Catalog => (
            "Checking the signed release",
            "Downloading and verifying the release catalog".to_string(),
        ),
        InstallProgressPhase::Bom => (
            "Preparing components",
            "Verifying the exact release bill of materials".to_string(),
        ),
        InstallProgressPhase::Download => ("Downloading Lyra", format!("Downloading {component}")),
        InstallProgressPhase::Verify => (
            "Verifying components",
            format!("Checking the signature and files for {component}"),
        ),
        InstallProgressPhase::Install => (
            "Installing Lyra",
            format!("Safely staging or activating {component}"),
        ),
        InstallProgressPhase::Complete => (
            "Lyra is ready",
            "All selected components passed integrity checks".to_string(),
        ),
    }
}

fn run_install(
    arguments: &Arguments,
    selection: &InstallSelection,
    cancelled: &AtomicBool,
    mut on_progress: impl FnMut(&InstallProgressV1),
) -> Result<(), String> {
    if should_relaunch_elevated(arguments, selection) {
        let request = elevated_request(arguments, selection)?;
        let stored = write_request(&request)?;
        return relaunch_elevated(&stored, cancelled);
    }
    if installation_cancelled(arguments, cancelled) {
        return Err("Installation was cancelled.".to_string());
    }
    let target = arguments
        .target
        .as_deref()
        .map_or_else(Target::current, Target::parse)
        .map_err(|error| error.to_string())?;
    let mut trusted_keys = TrustedKeys::new();
    for (key_id, key) in resolve_trusted_roots(arguments)? {
        trusted_keys
            .insert_base64(key_id, &key)
            .map_err(|error| error.to_string())?;
    }
    let (install_root, state_root, paths) = resolve_install_paths(
        selection.scope,
        arguments.install_root.as_deref(),
        arguments.state_root.as_deref(),
    )?;
    let program_root = arguments.program_root.clone().unwrap_or(paths.program_root);
    let offline_bundle = match resolve_external_offline_bundle(arguments) {
        Some(root) => Some(root),
        None => materialize_embedded_offline_bundle(&state_root)?,
    };
    let catalog_source = resolve_catalog_source(arguments, offline_bundle.as_deref())?;
    let mut config = InstallerConfig::new(install_root.clone(), state_root.clone(), target.clone());
    config.proxy = selection.proxy.clone();
    config.offline_bundle_root = offline_bundle;
    config.include_on_demand = arguments.include_on_demand;
    let installer =
        BootstrapInstaller::new(config, trusted_keys).map_err(|error| error.to_string())?;
    let report = installer
        .install_with_progress(&catalog_source, arguments.release.as_deref(), |progress| {
            on_progress(progress);
            !installation_cancelled(arguments, cancelled)
        })
        .map_err(|error| error.to_string())?;
    let projection = CoreProjector::new(CoreProjectionConfig::new(
        install_root,
        state_root,
        program_root,
        target,
    ))
    .and_then(|projector| projector.project())
    .map_err(|error| error.to_string())?;
    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::json!({
            "install": report,
            "coreProjection": projection
        }))
        .map_err(|error| error.to_string())?
    );
    Ok(())
}

fn run_uninstall(
    arguments: &Arguments,
    selection: &InstallSelection,
    cancelled: &AtomicBool,
) -> Result<(), String> {
    if should_relaunch_elevated(arguments, selection) {
        let request = elevated_request(arguments, selection)?;
        let stored = write_request(&request)?;
        return relaunch_elevated(&stored, cancelled);
    }
    if installation_cancelled(arguments, cancelled) {
        return Err("Uninstallation was cancelled.".to_string());
    }
    let target = arguments
        .target
        .as_deref()
        .map_or_else(Target::current, Target::parse)
        .map_err(|error| error.to_string())?;
    let (component_root, state_root, paths) = resolve_install_paths(
        selection.scope,
        arguments.install_root.as_deref(),
        arguments.state_root.as_deref(),
    )?;
    let report = uninstall(UninstallConfig {
        component_root,
        state_root,
        program_root: arguments.program_root.clone().unwrap_or(paths.program_root),
        user_data_root: arguments
            .elevated_user_data_root
            .clone()
            .unwrap_or(paths.user_data_root),
        target,
        remove_user_data: arguments.remove_user_data,
        remove_user_data_confirmation: arguments.confirm_remove_user_data.clone(),
    })?;
    println!(
        "{}",
        serde_json::to_string_pretty(&report).map_err(|error| error.to_string())?
    );
    Ok(())
}

fn installation_cancelled(arguments: &Arguments, cancelled: &AtomicBool) -> bool {
    cancelled.load(Ordering::Acquire)
        || arguments
            .elevated_cancel_path
            .as_deref()
            .is_some_and(|path| path.exists())
}

fn should_relaunch_elevated(arguments: &Arguments, selection: &InstallSelection) -> bool {
    selection.scope == InstallScope::System
        && arguments.elevation_request.is_none()
        && !(arguments.install_root.is_some()
            && arguments.state_root.is_some()
            && arguments.program_root.is_some())
}

fn elevated_request(
    arguments: &Arguments,
    selection: &InstallSelection,
) -> Result<ElevatedInstallRequestV1, String> {
    let (_, _, paths) = resolve_install_paths(
        selection.scope,
        arguments.install_root.as_deref(),
        arguments.state_root.as_deref(),
    )?;
    let mut request = ElevatedInstallRequestV1::new(
        if selection.language.is_chinese() {
            "zh-CN"
        } else {
            "en"
        },
        arguments
            .elevated_user_data_root
            .clone()
            .unwrap_or(paths.user_data_root),
    );
    request.catalog = arguments.catalog.clone();
    request.install_root = arguments.install_root.clone();
    request.state_root = arguments.state_root.clone();
    request.program_root = arguments.program_root.clone();
    request.release = arguments.release.clone();
    request.target = arguments.target.clone();
    request.proxy = selection.proxy.clone();
    request.offline_bundle = arguments.offline_bundle.clone();
    request.include_on_demand = arguments.include_on_demand;
    request.operation = if arguments.uninstall {
        "uninstall".to_string()
    } else {
        "install".to_string()
    };
    request.remove_user_data = arguments.remove_user_data;
    request.remove_user_data_confirmation = arguments.confirm_remove_user_data.clone();
    request.trusted_roots.clone_from(&arguments.trusted_roots);
    Ok(request)
}

fn apply_elevation_request(mut arguments: Arguments) -> Result<Arguments, String> {
    let Some(path) = arguments.elevation_request.clone() else {
        return Ok(arguments);
    };
    let digest = arguments
        .elevation_request_sha256
        .as_deref()
        .ok_or_else(|| "The elevation request digest is missing.".to_string())?;
    let request = read_request(&path, digest)?;
    arguments.catalog = request.catalog;
    arguments.install_root = request.install_root;
    arguments.state_root = request.state_root;
    arguments.program_root = request.program_root;
    arguments.scope = InstallScope::System;
    arguments.language = match request.language.as_str() {
        "en" => InstallerLanguage::En,
        "zh-CN" => InstallerLanguage::ZhCn,
        _ => return Err("The elevated installer language is invalid.".to_string()),
    };
    arguments.release = request.release;
    arguments.target = request.target;
    arguments.proxy = request.proxy;
    arguments.offline_bundle = request.offline_bundle;
    arguments.include_on_demand = request.include_on_demand;
    arguments.uninstall = request.operation == "uninstall";
    arguments.remove_user_data = request.remove_user_data;
    arguments.confirm_remove_user_data = request.remove_user_data_confirmation;
    arguments.unattended = false;
    arguments.headless = true;
    arguments.trusted_roots = request.trusted_roots;
    arguments.elevated_cancel_path = Some(request.cancel_path);
    arguments.elevated_user_data_root = Some(request.user_data_root);
    Ok(arguments)
}

fn initial_selection(arguments: &Arguments) -> InstallSelection {
    InstallSelection {
        scope: arguments.scope,
        language: arguments.language.resolved(),
        proxy: arguments
            .proxy
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
    }
}

fn update_path_labels(ui: &InstallerWindow, arguments: &Arguments) {
    let current = resolve_install_paths(
        InstallScope::CurrentUser,
        arguments.install_root.as_deref(),
        arguments.state_root.as_deref(),
    );
    let system = resolve_install_paths(
        InstallScope::System,
        arguments.install_root.as_deref(),
        arguments.state_root.as_deref(),
    );
    if let Ok((_, _, paths)) = current {
        ui.set_current_user_path(paths.program_root.display().to_string().into());
        ui.set_user_data_path(paths.user_data_root.display().to_string().into());
    }
    if let Ok((_, _, paths)) = system {
        ui.set_system_path(paths.program_root.display().to_string().into());
    }
}

fn spawn_install(
    arguments: Arguments,
    selection: InstallSelection,
    cancelled: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    outcome: Arc<Mutex<Option<Result<(), String>>>>,
    last_selection: Arc<Mutex<InstallSelection>>,
    ui: slint::Weak<InstallerWindow>,
) {
    if running.swap(true, Ordering::AcqRel) {
        return;
    }
    cancelled.store(false, Ordering::Release);
    if let Ok(mut previous) = last_selection.lock() {
        *previous = selection.clone();
    }
    if let Ok(mut value) = outcome.lock() {
        *value = None;
    }
    if let Some(ui) = ui.upgrade() {
        ui.set_configuring(false);
        ui.set_running(true);
        ui.set_finished(false);
        ui.set_failed(false);
        ui.set_progress_value(0.0);
        ui.set_progress_indeterminate(true);
        if selection.language.is_chinese() {
            ui.set_status_text("正在准备 Lyra".into());
            ui.set_detail_text("正在验证签名发布信息".into());
        } else {
            ui.set_status_text("Preparing Lyra".into());
            ui.set_detail_text("Verifying the signed release".into());
        }
    }

    thread::spawn(move || {
        let language = selection.language;
        let progress_ui = ui.clone();
        let result = run_install(&arguments, &selection, &cancelled, |progress| {
            let progress = progress.clone();
            let ui = progress_ui.clone();
            let _ = slint::invoke_from_event_loop(move || {
                if let Some(ui) = ui.upgrade() {
                    let (status, detail) = progress_labels(&progress, language);
                    ui.set_status_text(status.into());
                    ui.set_detail_text(detail.into());
                    ui.set_progress_value(progress_fraction(&progress));
                    ui.set_progress_indeterminate(matches!(
                        progress.phase,
                        InstallProgressPhase::Catalog
                            | InstallProgressPhase::Bom
                            | InstallProgressPhase::Verify
                    ));
                }
            });
        });
        if let Ok(mut value) = outcome.lock() {
            *value = Some(result.clone());
        }
        running.store(false, Ordering::Release);
        let completed_ui = ui.clone();
        let _ = slint::invoke_from_event_loop(move || {
            if let Some(ui) = completed_ui.upgrade() {
                match result {
                    Ok(()) => {
                        if language.is_chinese() {
                            ui.set_status_text("Lyra 已准备就绪".into());
                            ui.set_detail_text("安装已成功完成".into());
                        } else {
                            ui.set_status_text("Lyra is ready".into());
                            ui.set_detail_text("Installation completed successfully".into());
                        }
                        ui.set_progress_value(1.0);
                        ui.set_failed(false);
                    }
                    Err(message) => {
                        if language.is_chinese() {
                            ui.set_status_text("安装已停止".into());
                        } else {
                            ui.set_status_text("Installation stopped".into());
                        }
                        ui.set_detail_text(message.into());
                        ui.set_failed(true);
                    }
                }
                ui.set_progress_indeterminate(false);
                ui.set_running(false);
                ui.set_finished(true);
            }
        });
    });
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments = apply_elevation_request(Arguments::parse()).map_err(std::io::Error::other)?;
    let selection = initial_selection(&arguments);
    if arguments.uninstall {
        let cancelled = AtomicBool::new(false);
        return run_uninstall(&arguments, &selection, &cancelled)
            .map_err(|message| std::io::Error::other(message).into());
    }
    if arguments.headless {
        let cancelled = AtomicBool::new(false);
        return run_install(&arguments, &selection, &cancelled, |_| {})
            .map_err(|message| std::io::Error::other(message).into());
    }
    let ui = InstallerWindow::new()?;
    update_path_labels(&ui, &arguments);
    ui.set_use_chinese(selection.language.is_chinese());
    ui.set_language_index(if selection.language.is_chinese() {
        1
    } else {
        0
    });
    ui.set_scope_index(if selection.scope == InstallScope::System {
        1
    } else {
        0
    });
    ui.set_proxy_text(selection.proxy.clone().unwrap_or_default().into());

    let cancelled = Arc::new(AtomicBool::new(false));
    let running = Arc::new(AtomicBool::new(false));
    let outcome = Arc::new(Mutex::new(None::<Result<(), String>>));
    let last_selection = Arc::new(Mutex::new(selection.clone()));

    let start_arguments = arguments.clone();
    let start_cancelled = Arc::clone(&cancelled);
    let start_running = Arc::clone(&running);
    let start_outcome = Arc::clone(&outcome);
    let start_selection = Arc::clone(&last_selection);
    let start_ui = ui.as_weak();
    ui.on_start_requested(move |use_chinese, system_scope, proxy| {
        let proxy = proxy.to_string();
        let selection = InstallSelection {
            scope: if system_scope {
                InstallScope::System
            } else {
                InstallScope::CurrentUser
            },
            language: if use_chinese {
                InstallerLanguage::ZhCn
            } else {
                InstallerLanguage::En
            },
            proxy: (!proxy.trim().is_empty()).then(|| proxy.trim().to_string()),
        };
        spawn_install(
            start_arguments.clone(),
            selection,
            Arc::clone(&start_cancelled),
            Arc::clone(&start_running),
            Arc::clone(&start_outcome),
            Arc::clone(&start_selection),
            start_ui.clone(),
        );
    });

    let retry_arguments = arguments.clone();
    let retry_cancelled = Arc::clone(&cancelled);
    let retry_running = Arc::clone(&running);
    let retry_outcome = Arc::clone(&outcome);
    let retry_selection = Arc::clone(&last_selection);
    let retry_ui = ui.as_weak();
    ui.on_retry_requested(move || {
        let selection = retry_selection
            .lock()
            .map(|value| value.clone())
            .unwrap_or_else(|_| initial_selection(&retry_arguments));
        spawn_install(
            retry_arguments.clone(),
            selection,
            Arc::clone(&retry_cancelled),
            Arc::clone(&retry_running),
            Arc::clone(&retry_outcome),
            Arc::clone(&retry_selection),
            retry_ui.clone(),
        );
    });

    let cancel_flag = Arc::clone(&cancelled);
    let cancel_ui = ui.as_weak();
    ui.on_cancel_requested(move || {
        cancel_flag.store(true, Ordering::Release);
        if let Some(ui) = cancel_ui.upgrade() {
            if ui.get_use_chinese() {
                ui.set_status_text("正在取消安装".into());
                ui.set_detail_text("已下载的数据会保留，以便稍后继续".into());
            } else {
                ui.set_status_text("Cancelling installation".into());
                ui.set_detail_text(
                    "Downloaded data is retained so installation can resume later".into(),
                );
            }
            ui.set_progress_indeterminate(true);
        }
    });
    ui.on_close_requested(|| {
        let _ = slint::quit_event_loop();
    });

    if arguments.unattended {
        spawn_install(
            arguments.clone(),
            selection,
            Arc::clone(&cancelled),
            Arc::clone(&running),
            Arc::clone(&outcome),
            Arc::clone(&last_selection),
            ui.as_weak(),
        );
    }

    ui.run()?;
    cancelled.store(true, Ordering::Release);
    let result = outcome
        .lock()
        .map_err(|_| std::io::Error::other("installer outcome lock was poisoned"))?
        .clone();
    match result {
        Some(Ok(())) => Ok(()),
        Some(Err(message)) => Err(std::io::Error::other(message).into()),
        None => Err(std::io::Error::other("installation was cancelled").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments() -> Arguments {
        Arguments {
            catalog: Some("https://releases.example/catalog.json".to_string()),
            install_root: None,
            state_root: None,
            program_root: None,
            scope: InstallScope::CurrentUser,
            language: InstallerLanguage::En,
            release: None,
            target: Some("darwin-arm64".to_string()),
            proxy: None,
            offline_bundle: None,
            include_on_demand: false,
            uninstall: false,
            remove_user_data: false,
            confirm_remove_user_data: None,
            unattended: false,
            headless: false,
            trusted_roots: vec![format!("root-1={}", "A".repeat(43) + "=")],
            elevation_request: None,
            elevation_request_sha256: None,
            elevated_cancel_path: None,
            elevated_user_data_root: None,
        }
    }

    #[test]
    fn explicit_catalog_and_roots_override_embedded_release_configuration() {
        let arguments = arguments();
        assert_eq!(
            resolve_catalog_source(&arguments, None).expect("catalog"),
            "https://releases.example/catalog.json"
        );
        assert_eq!(
            resolve_trusted_roots(&arguments).expect("roots"),
            [("root-1".to_string(), "A".repeat(43) + "=")]
        );
    }

    #[test]
    fn malformed_explicit_root_is_rejected_before_installation() {
        let mut arguments = arguments();
        arguments.trusted_roots = vec!["missing-separator".to_string()];
        assert!(resolve_trusted_roots(&arguments).is_err());
    }

    #[test]
    fn embedded_offline_bundle_catalog_precedes_the_online_build_default() {
        let root = tempfile::tempdir().expect("offline bundle root");
        std::fs::write(root.path().join("catalog.json"), b"{}").expect("offline catalog");
        let mut arguments = arguments();
        arguments.catalog = None;
        assert_eq!(
            resolve_catalog_source(&arguments, Some(root.path())).expect("offline catalog"),
            root.path().join("catalog.json").display().to_string()
        );
    }

    #[test]
    fn system_defaults_request_elevation_after_scope_confirmation() {
        let mut arguments = arguments();
        let mut selection = initial_selection(&arguments);
        selection.scope = InstallScope::System;
        assert!(should_relaunch_elevated(&arguments, &selection));

        arguments.install_root = Some(PathBuf::from("/managed/components"));
        arguments.state_root = Some(PathBuf::from("/managed/state"));
        arguments.program_root = Some(PathBuf::from("/managed/program"));
        assert!(!should_relaunch_elevated(&arguments, &selection));
    }

    #[test]
    fn elevated_request_preserves_sensitive_proxy_outside_process_arguments() {
        let arguments = arguments();
        let selection = InstallSelection {
            scope: InstallScope::System,
            language: InstallerLanguage::ZhCn,
            proxy: Some("https://user:secret@proxy.example".to_string()),
        };
        let request = elevated_request(&arguments, &selection).expect("elevation request");
        assert_eq!(request.language, "zh-CN");
        assert_eq!(request.proxy, selection.proxy);
        assert_eq!(
            request.user_data_root,
            resolve_install_paths(InstallScope::System, None, None)
                .expect("system paths")
                .2
                .user_data_root
        );
    }
}
