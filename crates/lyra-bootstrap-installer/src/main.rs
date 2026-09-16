#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
#![cfg_attr(test, allow(clippy::expect_used, clippy::unwrap_used))]

mod configuration;
mod elevation;
mod embedded_bundle;
mod promo_video;
mod registry;
mod shortcuts;
mod status_copy;
mod uninstall;
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
mod windows_drives;

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use clap::Parser;
use configuration::{InstallScope, InstallerLanguage, resolve_install_paths};
use elevation::{ElevatedInstallRequestV1, read_request, relaunch_elevated, write_request};
use embedded_bundle::materialize_embedded_offline_bundle;
use lyra_bootstrap_core::{
    BootstrapInstaller, CoreProjectionConfig, CoreProjector, InstallProgressPhase,
    InstallProgressV1, InstallerConfig, Target, TrustedKeys,
};
use slint::{
    ComponentHandle, Image, ModelRc, Rgb8Pixel, SharedPixelBuffer, Timer, TimerMode, VecModel,
};
use uninstall::{UninstallConfig, uninstall};

#[allow(clippy::expect_used, clippy::unwrap_used)]
mod generated_ui {
    include!(env!("SLINT_INCLUDE_GENERATED"));
}
use generated_ui::*;

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
    /// Do not create host shortcuts or uninstall registry entries. Flatpak
    /// exports its immutable desktop entry and uses this mode.
    #[arg(long)]
    skip_shortcuts: bool,
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
    custom_program_root: Option<PathBuf>,
}

const EMBEDDED_CATALOG_URL: Option<&str> = option_env!("LYRA_INSTALLER_CATALOG_URL");
const EMBEDDED_TRUSTED_ROOTS_JSON: Option<&str> = option_env!("LYRA_INSTALLER_TRUSTED_ROOTS_JSON");
const ASCII_LOGO: &str = include_str!("../assets/ascii-logo.txt");
const PATH_LABEL_CHARS: usize = 36;

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

#[derive(Clone, Debug, Default)]
struct UiSnapshot {
    running: bool,
    finished: bool,
    failed: bool,
    error: Option<String>,
    phase: Option<InstallProgressPhase>,
    component: Option<String>,
    completed: u64,
    total: u64,
    fraction: f32,
    indeterminate: bool,
}

fn apply_install_path(ui: &InstallerWindow, path: &str) {
    ui.set_install_path(path.into());
    ui.set_install_path_label(status_copy::elide_install_path(path, PATH_LABEL_CHARS).into());
}

fn promo_frame_to_image(frame: &promo_video::PromoFrame) -> Image {
    let mut buffer = SharedPixelBuffer::<Rgb8Pixel>::new(frame.width, frame.height);
    for (dst, src) in buffer
        .make_mut_slice()
        .iter_mut()
        .zip(frame.rgb.chunks_exact(3))
    {
        *dst = Rgb8Pixel {
            r: src[0],
            g: src[1],
            b: src[2],
        };
    }
    Image::from_rgb8(buffer)
}

fn to_status_glyphs(frames: &[status_copy::GlyphFrame]) -> Vec<StatusGlyph> {
    frames
        .iter()
        .map(|frame| StatusGlyph {
            glyph: frame.glyph.clone().into(),
            offset_y: frame.offset_y,
            opacity: frame.opacity,
        })
        .collect()
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
    let program_root = selection
        .custom_program_root
        .clone()
        .or_else(|| arguments.program_root.clone())
        .unwrap_or(paths.program_root);
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
        program_root.clone(),
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
    if !arguments.skip_shortcuts {
        let _ = shortcuts::create_shortcuts(&shortcuts::ShortcutConfig {
            program_root: program_root.clone(),
            scope: selection.scope,
        });
        let _ = registry::write_arp_entries(&registry::ArpConfig {
            program_root: program_root.clone(),
            scope: selection.scope,
        });
    }
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
    let program_root = selection
        .custom_program_root
        .clone()
        .or_else(|| arguments.program_root.clone())
        .unwrap_or(paths.program_root);
    let shortcut_program_root = program_root.clone();
    let report = uninstall(UninstallConfig {
        component_root,
        state_root,
        program_root,
        user_data_root: arguments
            .elevated_user_data_root
            .clone()
            .unwrap_or(paths.user_data_root),
        target,
        remove_user_data: arguments.remove_user_data,
        remove_user_data_confirmation: arguments.confirm_remove_user_data.clone(),
    })?;
    let shortcut_config = shortcuts::ShortcutConfig {
        program_root: shortcut_program_root,
        scope: selection.scope,
    };
    let _ = shortcuts::remove_shortcuts(&shortcut_config);
    let _ = registry::remove_arp_entries(&registry::ArpConfig {
        program_root: shortcut_config.program_root.clone(),
        scope: shortcut_config.scope,
    });
    registry::remove_uninstaller_binary(&registry::ArpConfig {
        program_root: shortcut_config.program_root.clone(),
        scope: shortcut_config.scope,
    });
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
            .is_some_and(|path| std::path::Path::new(path).exists())
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
    request.program_root = selection
        .custom_program_root
        .clone()
        .or_else(|| arguments.program_root.clone());
    request.release = arguments.release.clone();
    request.target = arguments.target.clone();
    request.proxy = selection.proxy.clone();
    request.offline_bundle = arguments.offline_bundle.clone();
    request.include_on_demand = arguments.include_on_demand;
    request.skip_shortcuts = arguments.skip_shortcuts;
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
    arguments.skip_shortcuts = request.skip_shortcuts;
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
        custom_program_root: arguments.program_root.clone(),
    }
}

fn update_path_labels(ui: &InstallerWindow, arguments: &Arguments) {
    let scope = if arguments.scope == InstallScope::System && arguments.unattended {
        InstallScope::System
    } else {
        InstallScope::CurrentUser
    };
    if let Ok((_, _, paths)) = resolve_install_paths(
        scope,
        arguments.install_root.as_deref(),
        arguments.state_root.as_deref(),
    ) {
        let default = arguments.program_root.clone().unwrap_or(paths.program_root);
        apply_install_path(ui, &default.display().to_string());
    }
}

/// Open a platform-native folder picker dialog. Shells out to the OS
/// dialog tool (osascript / PowerShell / zenity) — no extra crate needed.
fn browse_folder() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("osascript")
            .arg("-e")
            .arg(r#"tell application "System Events" to POSIX path of (choose folder)"#)
            .output()
            .ok()?;
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
        None
    }
    #[cfg(target_os = "windows")]
    {
        let script = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }";
        let mut command = std::process::Command::new("powershell.exe");
        command.args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ]);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let output = command.output().ok()?;
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
        None
    }
    #[cfg(target_os = "linux")]
    {
        for (program, args) in [
            ("zenity", ["--file-selection", "--directory"]),
            ("kdialog", ["--getexistingdirectory", "."]),
        ] {
            if let Ok(output) = std::process::Command::new(program).args(args).output() {
                if output.status.success() {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(PathBuf::from(path));
                    }
                }
            }
        }
        None
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

fn spawn_install(
    arguments: Arguments,
    selection: InstallSelection,
    cancelled: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    outcome: Arc<Mutex<Option<Result<(), String>>>>,
    last_selection: Arc<Mutex<InstallSelection>>,
    snapshot: Arc<Mutex<UiSnapshot>>,
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
    if let Ok(mut state) = snapshot.lock() {
        *state = UiSnapshot {
            running: true,
            finished: false,
            failed: false,
            error: None,
            phase: Some(InstallProgressPhase::Catalog),
            component: None,
            completed: 0,
            total: 0,
            fraction: 0.0,
            indeterminate: true,
        };
    }

    thread::spawn(move || {
        let progress_snapshot = Arc::clone(&snapshot);
        let result = run_install(&arguments, &selection, &cancelled, |progress| {
            if let Ok(mut state) = progress_snapshot.lock() {
                state.phase = Some(progress.phase);
                state.component = progress.component_id.clone();
                state.completed = progress.completed;
                state.total = progress.total;
                state.fraction = progress_fraction(progress);
                state.indeterminate = matches!(
                    progress.phase,
                    InstallProgressPhase::Catalog
                        | InstallProgressPhase::Bom
                        | InstallProgressPhase::Verify
                );
            }
        });
        if let Ok(mut value) = outcome.lock() {
            *value = Some(result.clone());
        }
        running.store(false, Ordering::Release);
        if let Ok(mut state) = snapshot.lock() {
            match &result {
                Ok(()) => {
                    state.failed = false;
                    state.error = None;
                    state.phase = Some(InstallProgressPhase::Complete);
                    state.fraction = 1.0;
                    state.indeterminate = false;
                }
                Err(message) => {
                    state.failed = true;
                    state.error = Some(message.clone());
                    state.indeterminate = false;
                }
            }
            state.running = false;
            state.finished = true;
        }
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
    ui.set_ascii_logo(ASCII_LOGO.into());
    update_path_labels(&ui, &arguments);

    let cancelled = Arc::new(AtomicBool::new(false));
    let running = Arc::new(AtomicBool::new(false));
    let outcome = Arc::new(Mutex::new(None::<Result<(), String>>));
    let last_selection = Arc::new(Mutex::new(selection.clone()));
    let snapshot = Arc::new(Mutex::new(UiSnapshot::default()));
    let started_at = Instant::now();
    let rotator = Rc::new(RefCell::new(status_copy::StatusRotator::new(0)));
    let speed = Rc::new(RefCell::new(status_copy::SpeedEstimator::default()));
    let glyphs_model = Rc::new(VecModel::<StatusGlyph>::from(Vec::<StatusGlyph>::new()));
    ui.set_status_glyphs(ModelRc::from(glyphs_model.clone()));

    let (frame_tx, frame_rx) = mpsc::sync_channel::<promo_video::PromoFrame>(1);
    let video_stop = Arc::new(AtomicBool::new(false));
    promo_video::spawn_promo_loader(
        promo_video::DEFAULT_MANIFEST_URL.to_string(),
        selection.proxy.clone(),
        frame_tx,
        Arc::clone(&video_stop),
    );

    let start_arguments = arguments.clone();
    let start_cancelled = Arc::clone(&cancelled);
    let start_running = Arc::clone(&running);
    let start_outcome = Arc::clone(&outcome);
    let start_selection = Arc::clone(&last_selection);
    let start_snapshot = Arc::clone(&snapshot);
    ui.on_start_requested(move |install_path| {
        let install_path = install_path.to_string();
        let custom_program_root =
            (!install_path.trim().is_empty()).then(|| PathBuf::from(install_path.trim()));
        let selection = InstallSelection {
            scope: InstallScope::CurrentUser,
            language: InstallerLanguage::En,
            proxy: start_arguments
                .proxy
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned),
            custom_program_root,
        };
        spawn_install(
            start_arguments.clone(),
            selection,
            Arc::clone(&start_cancelled),
            Arc::clone(&start_running),
            Arc::clone(&start_outcome),
            Arc::clone(&start_selection),
            Arc::clone(&start_snapshot),
        );
    });

    let browse_ui = ui.as_weak();
    ui.on_browse_requested(move || {
        if let Some(path) = browse_folder() {
            if let Some(ui) = browse_ui.upgrade() {
                apply_install_path(&ui, &path.display().to_string());
            }
        }
    });

    let retry_arguments = arguments.clone();
    let retry_cancelled = Arc::clone(&cancelled);
    let retry_running = Arc::clone(&running);
    let retry_outcome = Arc::clone(&outcome);
    let retry_selection = Arc::clone(&last_selection);
    let retry_snapshot = Arc::clone(&snapshot);
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
            Arc::clone(&retry_snapshot),
        );
    });
    ui.on_close_requested(|| {
        let _ = slint::quit_event_loop();
    });

    if arguments.unattended {
        spawn_install(
            arguments,
            selection,
            Arc::clone(&cancelled),
            Arc::clone(&running),
            Arc::clone(&outcome),
            Arc::clone(&last_selection),
            Arc::clone(&snapshot),
        );
    }

    let timer_ui = ui.as_weak();
    let timer_snapshot = Arc::clone(&snapshot);
    let timer = Timer::default();
    timer.start(TimerMode::Repeated, Duration::from_millis(16), move || {
        let Some(ui) = timer_ui.upgrade() else {
            return;
        };
        let now_ms = started_at.elapsed().as_millis() as u64;
        ui.set_logo_wave(((now_ms % 2200) as f32) / 2200.0);
        if let Ok(frame) = frame_rx.try_recv() {
            ui.set_hero_frame(promo_frame_to_image(&frame));
            ui.set_hero_has_video(true);
        }
        let state = timer_snapshot.lock().ok().map(|guard| guard.clone());
        if let Some(state) = state {
            ui.set_running(state.running);
            ui.set_finished(state.finished);
            ui.set_failed(state.failed);
            ui.set_progress_value(state.fraction);
            ui.set_progress_indeterminate(state.running && state.indeterminate);
            if state.running && state.indeterminate {
                let cycle = (now_ms % 1800) as f32 / 1800.0;
                ui.set_indeterminate_phase(if cycle < 0.5 {
                    cycle * 2.0
                } else {
                    (1.0 - cycle) * 2.0
                });
            }
            if state.failed {
                let message = state.error.as_deref().unwrap_or("Installation stopped");
                rotator
                    .borrow_mut()
                    .show_static(status_copy::elide_install_path(message, 42), now_ms);
                ui.set_rate_text(Default::default());
                ui.set_percent_text(Default::default());
            } else if state.finished {
                rotator
                    .borrow_mut()
                    .show_static("Lyra is ready".to_string(), now_ms);
                ui.set_rate_text(Default::default());
                ui.set_percent_text("100%".into());
                ui.set_progress_value(1.0);
            } else if state.running {
                if let Some(phase) = state.phase {
                    rotator.borrow_mut().set_pool(
                        status_copy::pool_for_phase(phase, state.component.as_deref()),
                        now_ms,
                    );
                }
                let show_speed = matches!(state.phase, Some(InstallProgressPhase::Download))
                    && !state.indeterminate;
                if show_speed {
                    let bps = speed.borrow_mut().update(state.completed, now_ms);
                    ui.set_rate_text(status_copy::format_speed_bps(bps).into());
                    ui.set_percent_text(status_copy::format_percent(state.fraction).into());
                } else if matches!(state.phase, Some(InstallProgressPhase::Install)) {
                    ui.set_rate_text(Default::default());
                    ui.set_percent_text(status_copy::format_percent(state.fraction).into());
                } else {
                    ui.set_rate_text(Default::default());
                    ui.set_percent_text(Default::default());
                }
            }
        }
        let frames = rotator.borrow_mut().tick(now_ms);
        glyphs_model.set_vec(to_status_glyphs(&frames));
    });

    ui.run()?;
    video_stop.store(true, Ordering::Release);
    drop(timer);
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
            skip_shortcuts: false,
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
            custom_program_root: None,
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
