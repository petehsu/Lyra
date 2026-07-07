use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};

use crate::events::{emit_cwd_changed, emit_event, NativeEvent};
use crate::input_controller;
use crate::live_output::{append_output, mark_session_exit, Utf8StreamDecoder};
use crate::protocol::{
    TerminalShellLaunchEnvPair, TerminalShellLaunchPlanRequest, TerminalShellLaunchPlanResponse,
    TerminalWriteRequest,
};
use crate::session_runtime::SessionRuntime;
use crate::shell::{
    configure_shell_command, configure_shell_environment, make_shell_candidates, shell_exists,
};
use crate::shell_integration;
use crate::shell_integration::ShellIntegrationEventKind;
use crate::{to_error, Result};

const EXIT_READER_DRAIN_WAIT_MS: u64 = 1_000;

pub(crate) struct SpawnedPty {
    pub(crate) shell: String,
    pub(crate) process_id: Option<u32>,
    pub(crate) writer: Box<dyn Write + Send>,
    pub(crate) reader: Box<dyn Read + Send>,
    pub(crate) master: Box<dyn MasterPty + Send>,
    pub(crate) child: Box<dyn portable_pty::Child + Send + Sync>,
}

pub(crate) fn spawn_pty(
    requested_shell: Option<&str>,
    env: Option<&[TerminalShellLaunchEnvPair]>,
    rows: u16,
    cols: u16,
    cwd: Option<&str>,
    mode: &str,
    command_text: Option<&str>,
) -> Result<SpawnedPty> {
    let pty_system = native_pty_system();
    let shell_candidates = make_shell_candidates(requested_shell);
    let mut spawn_error = String::from("no shell available");

    for shell in shell_candidates {
        if !shell_exists(&shell) {
            continue;
        }

        let pair = match pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }) {
            Ok(v) => v,
            Err(error) => {
                spawn_error = error.to_string();
                continue;
            }
        };

        let mut builder = CommandBuilder::new(shell.clone());
        apply_shell_cwd(&mut builder, cwd);
        if mode == "shell" {
            configure_shell_environment(&mut builder, &shell);
            configure_shell_command(&mut builder, &shell);
        } else if let Some(command) = command_text {
            configure_command_mode(&mut builder, &shell, command);
        }
        apply_requested_env(&mut builder, env);
        let child = match pair.slave.spawn_command(builder) {
            Ok(v) => v,
            Err(error) => {
                spawn_error = error.to_string();
                continue;
            }
        };
        let process_id = child.process_id();
        if let Some(process_id) = process_id {
            lyra_process_lifecycle_core::spawn_parent_death_watcher(process_id, true);
        }

        let writer = pair
            .master
            .try_clone_writer()
            .map_err(|error| to_error(format!("failed to clone pty writer: {error}")))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| to_error(format!("failed to clone pty reader: {error}")))?;

        return Ok(SpawnedPty {
            shell,
            process_id,
            writer,
            reader,
            master: pair.master,
            child,
        });
    }

    Err(to_error(format!("failed to spawn shell: {spawn_error}")))
}

pub(crate) fn parse_exit_code(status: portable_pty::ExitStatus) -> i32 {
    if let Some(code) = status.code() {
        return code;
    }
    if let Some(signal) = status.signal() {
        return 128 + signal;
    }
    if status.success() {
        0
    } else {
        1
    }
}

pub(crate) fn spawn_io_threads(
    session_id: String,
    runtime: Arc<SessionRuntime>,
    mut reader: Box<dyn Read + Send>,
    on_exit: Box<dyn FnOnce(String) + Send>,
) {
    let session_id_for_reader = session_id.clone();
    let source_for_reader = runtime.source.clone();
    let mode_for_reader = runtime.mode.clone();
    let state_for_reader = Arc::clone(&runtime.state);
    let current_cwd_for_reader = Arc::clone(&runtime.current_cwd);
    let reader_done = Arc::new(AtomicBool::new(false));
    let reader_done_for_reader = Arc::clone(&reader_done);
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        let mut shell_parser = shell_integration::ShellIntegrationParser::new();
        let mut event_decoder = Utf8StreamDecoder::default();
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    let data = event_decoder.finish();
                    if !data.is_empty() {
                        emit_event(NativeEvent {
                            kind: "data".to_string(),
                            session_id: session_id_for_reader.clone(),
                            data: Some(data),
                            exit_code: None,
                            error: None,
                            source: Some(source_for_reader.clone()),
                            mode: Some(mode_for_reader.clone()),
                            cwd: None,
                            current_cwd: None,
                            command_id: None,
                            command: None,
                        });
                    }
                    break;
                }
                Ok(size) => {
                    let chunk = &buffer[..size];
                    let shell_events = shell_parser.feed(chunk);
                    append_output(&state_for_reader, chunk);
                    let data = event_decoder.decode(chunk);
                    if !data.is_empty() {
                        emit_event(NativeEvent {
                            kind: "data".to_string(),
                            session_id: session_id_for_reader.clone(),
                            data: Some(data),
                            exit_code: None,
                            error: None,
                            source: Some(source_for_reader.clone()),
                            mode: Some(mode_for_reader.clone()),
                            cwd: None,
                            current_cwd: None,
                            command_id: None,
                            command: None,
                        });
                    }
                    for event in shell_events
                        .iter()
                        .filter(|event| event.kind == ShellIntegrationEventKind::CwdChanged)
                    {
                        if let Some(cwd) = event.cwd.as_ref() {
                            if let Ok(mut current_cwd) = current_cwd_for_reader.lock() {
                                *current_cwd = Some(cwd.clone());
                            }
                            emit_cwd_changed(
                                &session_id_for_reader,
                                &source_for_reader,
                                &mode_for_reader,
                                cwd,
                            );
                        }
                    }
                }
                Err(error) => {
                    if error.kind() == std::io::ErrorKind::Interrupted {
                        continue;
                    }
                    emit_event(NativeEvent {
                        kind: "error".to_string(),
                        session_id: session_id_for_reader.clone(),
                        data: None,
                        exit_code: None,
                        error: Some(error.to_string()),
                        source: Some(source_for_reader.clone()),
                        mode: Some(mode_for_reader.clone()),
                        cwd: None,
                        current_cwd: None,
                        command_id: None,
                        command: None,
                    });
                    break;
                }
            }
        }
        reader_done_for_reader.store(true, Ordering::Release);
    });

    let source_for_exit = runtime.source.clone();
    let mode_for_exit = runtime.mode.clone();
    let state_for_exit = Arc::clone(&runtime.state);
    let child_for_exit = Arc::clone(&runtime.child);
    let reader_done_for_exit = Arc::clone(&reader_done);
    thread::spawn(move || {
        let exit_code = if let Ok(mut child) = child_for_exit.lock() {
            child.wait().ok().map(parse_exit_code).unwrap_or(1)
        } else {
            1
        };

        wait_for_reader_drain(&reader_done_for_exit);
        mark_session_exit(&state_for_exit, exit_code);

        let session_id_for_callback = session_id.clone();
        emit_event(NativeEvent {
            kind: "exit".to_string(),
            session_id,
            data: None,
            exit_code: Some(exit_code),
            error: None,
            source: Some(source_for_exit),
            mode: Some(mode_for_exit),
            cwd: None,
            current_cwd: None,
            command_id: None,
            command: None,
        });
        on_exit(session_id_for_callback);
    });
}

fn wait_for_reader_drain(reader_done: &AtomicBool) {
    let deadline = Instant::now() + Duration::from_millis(EXIT_READER_DRAIN_WAIT_MS);
    while !reader_done.load(Ordering::Acquire) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
}

fn apply_shell_cwd(command: &mut CommandBuilder, cwd: Option<&str>) {
    if let Some(cwd) = cwd {
        let cwd_trimmed = cwd.trim();
        if !cwd_trimmed.is_empty() {
            command.cwd(cwd_trimmed);
        }
    }
}

fn apply_requested_env(command: &mut CommandBuilder, env: Option<&[TerminalShellLaunchEnvPair]>) {
    let Some(env) = env else {
        return;
    };
    for pair in env {
        let key = pair.key.trim();
        if key.is_empty() || key.contains('=') || key.contains('\0') || pair.value.contains('\0') {
            continue;
        }
        command.env(key, &pair.value);
    }
}

fn default_terminal_cwd() -> Option<String> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE")
            .ok()
            .or_else(|| {
                let drive = std::env::var("HOMEDRIVE").ok()?;
                let path = std::env::var("HOMEPATH").ok()?;
                Some(format!("{drive}{path}"))
            })
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    }
}

pub(crate) fn normalize_terminal_cwd(cwd: Option<&str>) -> Option<String> {
    cwd.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .or_else(default_terminal_cwd)
}

fn configure_command_mode(command: &mut CommandBuilder, shell: &str, raw_command: &str) {
    configure_shell_environment(command, shell);
    if cfg!(windows) {
        command.arg("/C");
        command.arg(raw_command);
        return;
    }
    command.arg("-lc");
    command.arg(raw_command);
}

pub(crate) fn compose_write_payload(request: &TerminalWriteRequest) -> Result<String> {
    let mut payload = String::new();
    if let Some(data) = request.data.as_deref() {
        payload.push_str(data);
    } else if let Some(text) = request.text.as_deref() {
        payload.push_str(text);
    }
    if request.append_newline.unwrap_or(false) {
        payload.push('\n');
    }
    if let Some(keys) = request.keys.as_ref() {
        for key in keys {
            let bytes = input_controller::expand_key_stroke(&input_controller::KeyStroke {
                key: key.clone(),
                repeat: 1,
                delay_ms: None,
            })
            .map_err(to_error)?;
            payload.push_str(&String::from_utf8_lossy(&bytes));
        }
    }

    if payload.is_empty() {
        return Err(to_error("terminal write requires data, text, or keys"));
    }
    Ok(payload)
}

pub(crate) fn shell_launch_plan(
    request: TerminalShellLaunchPlanRequest,
) -> Result<TerminalShellLaunchPlanResponse> {
    let shell = request.shell.trim().to_string();
    if shell.is_empty() {
        return Err(to_error("shell is required"));
    }
    let config = shell_integration::shell_integration_config(&shell, false);
    Ok(TerminalShellLaunchPlanResponse {
        shell: shell.clone(),
        args: crate::shell::shell_startup_args(&shell),
        env: crate::shell::shell_environment(&shell)
            .into_iter()
            .map(|(key, value)| TerminalShellLaunchEnvPair { key, value })
            .collect(),
        integration_enabled: config.enabled,
        integration_family: config.family,
        integration_script_asset: config.script_asset,
    })
}