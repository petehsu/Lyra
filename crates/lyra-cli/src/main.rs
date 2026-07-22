use clap::{Parser, Subcommand};
use lyra_agent_plugins::LyraSkillState;
use lyra_agent_runtime::{AgentRuntimeServices, LyraAgentBackend};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    io::{self, Write},
    path::{Path, PathBuf},
    process::{Command as ProcessCommand, Stdio},
    sync::{
        Arc, Once,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

mod cli_render;
mod runtime_socket;
mod system_router;

use cli_render::{
    LoadingSpinner, render_agent_response_block, render_control_menu_block,
    render_follow_command_prompt, render_follow_command_result, render_input_prompt, render_notice,
    render_permission_decision, render_permission_prompt, render_shell_result_line,
    render_status_block, render_tool_line, render_welcome_block,
};
use runtime_socket::RuntimeSocketClient;
use system_router::{RouteDecision, ShellCommandValidator, SystemInputRouter};

static SIGINT_REQUESTED: AtomicBool = AtomicBool::new(false);
static INSTALL_SIGINT_HANDLER: Once = Once::new();

fn write_cli_output(text: &str, raw_mode: bool) -> Result<(), String> {
    if raw_mode {
        print!("{}", normalize_newlines_for_raw_mode(text));
    } else {
        print!("{text}");
    }
    io::stdout().flush().map_err(|error| error.to_string())
}

fn normalize_newlines_for_raw_mode(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut previous_was_cr = false;
    for ch in text.chars() {
        if ch == '\n' && !previous_was_cr {
            output.push('\r');
        }
        output.push(ch);
        previous_was_cr = ch == '\r';
    }
    output
}

#[derive(Debug, Parser)]
#[command(name = "lyra")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Agent {
        #[command(subcommand)]
        command: AgentCommand,
    },
}

#[derive(Debug, Subcommand)]
enum AgentCommand {
    Run {
        prompt: String,
        #[arg(long)]
        session_id: Option<String>,
    },
    Chat(ChatOptions),
    Sessions {
        #[command(subcommand)]
        command: SessionCommand,
    },
    Memory {
        #[command(subcommand)]
        command: MemoryCommand,
    },
    Provider {
        #[command(subcommand)]
        command: ProviderCommand,
    },
    Events,
    Tools {
        #[command(subcommand)]
        command: ToolsCommand,
    },
    Skills {
        #[command(subcommand)]
        command: SkillsCommand,
    },
    Software {
        #[command(subcommand)]
        command: SoftwareCommand,
    },
}

#[derive(Debug, Subcommand)]
enum SessionCommand {
    List,
    Read { id: String },
}

#[derive(Debug, Subcommand)]
enum MemoryCommand {
    Search { query: String },
}

#[derive(Debug, Subcommand)]
enum ProviderCommand {
    List,
}

#[derive(Debug, Subcommand)]
enum ToolsCommand {
    List,
}

#[derive(Debug, Subcommand)]
enum SkillsCommand {
    List,
    Inspect { id: String },
    Activate { id: String },
    Deactivate { id: String },
}

#[derive(Debug, Subcommand)]
enum SoftwareCommand {
    List,
}

fn main() {
    let cli = Cli::parse();
    let Command::Agent {
        command: AgentCommand::Chat(options),
    } = &cli.command
    else {
        let services = AgentRuntimeServices::with_backend(Arc::new(LyraAgentBackend));
        services.attach_core_event_bus();
        let output = match cli.command {
            Command::Agent { command } => handle_agent(command, &services),
        };
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("serialize CLI output")
        );
        return;
    };

    if let Err(error) = run_agent_chat(options.clone()) {
        eprintln!("[lyra] {error}");
        std::process::exit(1);
    }
}

#[derive(Clone, Debug, Parser)]
struct ChatOptions {
    #[arg(long)]
    desktop: bool,
    #[arg(long)]
    session_id: Option<String>,
    #[arg(long)]
    working_dir: Option<String>,
    #[arg(long)]
    terminal_session_id: Option<String>,
    #[arg(long)]
    terminal_pane_id: Option<String>,
    #[arg(long)]
    terminal_tab_id: Option<String>,
}

fn run_agent_chat(options: ChatOptions) -> Result<(), String> {
    if !options.desktop {
        return Err("interactive chat currently requires --desktop".to_string());
    }

    let socket_path = env::var("LYRA_RUNTIME_SOCKET")
        .map_err(|_| "LYRA_RUNTIME_SOCKET is required for desktop chat".to_string())?;
    let client = RuntimeSocketClient::connect(&socket_path)?;
    let mut cwd = resolve_working_dir(options.working_dir.as_deref())?;
    let shell = default_shell();
    let validator = ShellCommandValidator::new(shell.clone());
    let router = SystemInputRouter::new();
    let session_id = ensure_agent_session(&client, &options, &cwd)?;
    update_follow(&client, &session_id, &options, false).ok();
    install_sigint_handler();
    SIGINT_REQUESTED.store(false, Ordering::SeqCst);

    print!("{}", render_welcome_block(&session_id, &cwd));

    let stdin = io::stdin();
    loop {
        print!("{}", render_input_prompt(&cwd));
        io::stdout().flush().map_err(|error| error.to_string())?;
        let mut line = String::new();
        match stdin.read_line(&mut line) {
            Ok(0) => {
                println!();
                return Ok(());
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                SIGINT_REQUESTED.store(false, Ordering::SeqCst);
                println!();
                continue;
            }
            Err(error) => return Err(error.to_string()),
        }
        let input = line.trim();
        match router.route(input, &cwd, &validator) {
            RouteDecision::Empty => continue,
            RouteDecision::Control => handle_control_input(&client, &session_id, &options, input)?,
            RouteDecision::Shell => {
                if let ShellCommandOutcome::Failed(failure) =
                    run_shell_command(input, &shell, &mut cwd)?
                {
                    print!("{}", render_status_block("shell", &failure.summary()));
                    io::stdout().flush().map_err(|error| error.to_string())?;
                    run_agent_turn(&client, &session_id, &failure.to_agent_message(), &mut cwd)?;
                }
            }
            RouteDecision::Agent => run_agent_turn(&client, &session_id, input, &mut cwd)?,
        }
    }
}

fn resolve_working_dir(value: Option<&str>) -> Result<PathBuf, String> {
    let path = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    if path.is_dir() {
        Ok(path)
    } else {
        Err(format!(
            "working directory does not exist: {}",
            path.display()
        ))
    }
}

fn default_shell() -> String {
    env::var("SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "/bin/sh".to_string())
}

fn ensure_agent_session(
    client: &RuntimeSocketClient,
    options: &ChatOptions,
    cwd: &Path,
) -> Result<String, String> {
    if let Some(session_id) = options
        .session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let snapshot = client.request(
            "agent.session.read",
            json!({ "sessionId": session_id }),
            Duration::from_secs(10),
        )?;
        return snapshot
            .get("id")
            .and_then(Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| "agent.session.read returned no session id".to_string());
    }
    let snapshot = client.request(
        "agent.session.create",
        json!({
            "title": "Lyra CLI",
            "workingDir": cwd.display().to_string(),
        }),
        Duration::from_secs(10),
    )?;
    snapshot
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "agent.session.create returned no session id".to_string())
}

fn handle_control_input(
    client: &RuntimeSocketClient,
    session_id: &str,
    options: &ChatOptions,
    input: &str,
) -> Result<(), String> {
    let current = read_follow(client, session_id).unwrap_or(false);
    if input == "/" {
        print!("{}", render_control_menu_block(current));
        return Ok(());
    }
    if input.starts_with("/follow") {
        let next = !current;
        update_follow(client, session_id, options, next)?;
        print!(
            "{}",
            render_status_block(
                "controls",
                &format!("Follow {}", if next { "on" } else { "off" })
            )
        );
        return Ok(());
    }
    print!(
        "{}",
        render_status_block("controls", "Unknown control. Type / to list controls.")
    );
    Ok(())
}

fn read_follow(client: &RuntimeSocketClient, session_id: &str) -> Result<bool, String> {
    let snapshot = client.request(
        "agent.cli.follow.read",
        json!({ "sessionId": session_id }),
        Duration::from_secs(5),
    )?;
    Ok(snapshot
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false))
}

fn update_follow(
    client: &RuntimeSocketClient,
    session_id: &str,
    options: &ChatOptions,
    enabled: bool,
) -> Result<(), String> {
    client.request(
        "agent.cli.follow.update",
        json!({
            "sessionId": session_id,
            "enabled": enabled,
            "terminalSessionId": options.terminal_session_id,
            "terminalPaneId": options.terminal_pane_id,
            "terminalTabId": options.terminal_tab_id,
        }),
        Duration::from_secs(5),
    )?;
    Ok(())
}

#[cfg(unix)]
extern "C" fn handle_sigint(_signal: libc::c_int) {
    SIGINT_REQUESTED.store(true, Ordering::SeqCst);
}

fn install_sigint_handler() {
    INSTALL_SIGINT_HANDLER.call_once(|| {
        #[cfg(unix)]
        unsafe {
            let mut action: libc::sigaction = std::mem::zeroed();
            action.sa_sigaction = handle_sigint as *const () as usize;
            action.sa_flags = 0;
            libc::sigemptyset(&mut action.sa_mask);
            libc::sigaction(libc::SIGINT, &action, std::ptr::null_mut());
        }
    });
}

fn take_sigint_requested() -> bool {
    SIGINT_REQUESTED.swap(false, Ordering::SeqCst)
}

struct AgentInterruptListener {
    raw_mode_enabled: bool,
}

impl AgentInterruptListener {
    fn start() -> Self {
        let raw_mode_enabled = crossterm::terminal::enable_raw_mode().is_ok();
        Self { raw_mode_enabled }
    }

    fn take_requested(&self) -> bool {
        take_sigint_requested() || poll_for_interrupt_key(self.raw_mode_enabled)
    }

    fn raw_mode_enabled(&self) -> bool {
        self.raw_mode_enabled
    }
}

impl Drop for AgentInterruptListener {
    fn drop(&mut self) {
        if self.raw_mode_enabled {
            let _ = crossterm::terminal::disable_raw_mode();
        }
    }
}

fn poll_for_interrupt_key(raw_mode_enabled: bool) -> bool {
    if !raw_mode_enabled {
        return false;
    }
    loop {
        let polled = crossterm::event::poll(Duration::from_millis(0)).unwrap_or(false);
        if !polled {
            return false;
        }
        let Ok(event) = crossterm::event::read() else {
            return false;
        };
        if is_interrupt_key_event(&event) {
            return true;
        }
    }
}

fn is_interrupt_key_event(event: &crossterm::event::Event) -> bool {
    let crossterm::event::Event::Key(key) = event else {
        return false;
    };
    match key.code {
        crossterm::event::KeyCode::Esc => true,
        crossterm::event::KeyCode::Char('c') | crossterm::event::KeyCode::Char('C') => key
            .modifiers
            .contains(crossterm::event::KeyModifiers::CONTROL),
        _ => false,
    }
}

fn agent_interrupt_requested(listener: &AgentInterruptListener) -> bool {
    listener.take_requested()
}

fn cancel_agent_turn(client: &RuntimeSocketClient, session_id: &str) -> Result<(), String> {
    match client.request(
        "agent.turn.cancel",
        json!({ "sessionId": session_id }),
        Duration::from_secs(5),
    ) {
        Ok(_) => Ok(()),
        Err(error) if error.contains("turn not running") => Ok(()),
        Err(error) => Err(error),
    }
}

enum PermissionDecision {
    Allow,
    Deny,
    CancelTurn,
}

fn read_permission_decision(
    listener: &AgentInterruptListener,
) -> Result<PermissionDecision, String> {
    if !listener.raw_mode_enabled() {
        let mut line = String::new();
        match io::stdin().read_line(&mut line) {
            Ok(_) => {
                return Ok(if line.trim().eq_ignore_ascii_case("y") {
                    PermissionDecision::Allow
                } else {
                    PermissionDecision::Deny
                });
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {
                take_sigint_requested();
                return Ok(PermissionDecision::CancelTurn);
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    loop {
        if take_sigint_requested() {
            return Ok(PermissionDecision::CancelTurn);
        }
        let polled = crossterm::event::poll(Duration::from_millis(100)).unwrap_or(false);
        if !polled {
            continue;
        }
        let Ok(event) = crossterm::event::read() else {
            continue;
        };
        let crossterm::event::Event::Key(key) = event else {
            continue;
        };
        match key.code {
            crossterm::event::KeyCode::Char('y') | crossterm::event::KeyCode::Char('Y') => {
                return Ok(PermissionDecision::Allow);
            }
            crossterm::event::KeyCode::Char('n')
            | crossterm::event::KeyCode::Char('N')
            | crossterm::event::KeyCode::Enter => {
                return Ok(PermissionDecision::Deny);
            }
            crossterm::event::KeyCode::Esc => return Ok(PermissionDecision::CancelTurn),
            crossterm::event::KeyCode::Char('c') | crossterm::event::KeyCode::Char('C')
                if key
                    .modifiers
                    .contains(crossterm::event::KeyModifiers::CONTROL) =>
            {
                return Ok(PermissionDecision::CancelTurn);
            }
            _ => {}
        }
    }
}

fn respond_permission(
    client: &RuntimeSocketClient,
    session_id: &str,
    permission_id: &str,
    allowed: bool,
) -> Result<(), String> {
    client.request(
        "agent.permission.respond",
        json!({
            "sessionId": session_id,
            "permissionId": permission_id,
            "allowed": allowed,
        }),
        Duration::from_secs(5),
    )?;
    Ok(())
}

fn tool_event_identity(payload: &Value) -> Option<(String, String)> {
    let name = payload
        .pointer("/tool/name")
        .or_else(|| payload.pointer("/tool/displayName"))
        .and_then(Value::as_str)
        .unwrap_or("tool")
        .to_string();
    let key = payload
        .pointer("/tool/id")
        .or_else(|| payload.pointer("/tool/callId"))
        .or_else(|| payload.pointer("/tool/toolCallId"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| name.clone());
    if key.trim().is_empty() {
        None
    } else {
        Some((key, name))
    }
}

fn is_terminal_like_tool_name(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase();
    normalized == "terminal"
        || normalized == "shell"
        || normalized.starts_with("terminal_")
        || normalized.starts_with("terminal.")
        || normalized.starts_with("shell_")
        || normalized.starts_with("shell.")
}

#[derive(Clone, Debug)]
struct MirroredCommand {
    command: String,
    cwd: Option<String>,
}

fn mirrored_command_from_tool_payload(payload: &Value) -> Option<MirroredCommand> {
    let tool = payload.get("tool")?;
    let name = tool.get("name").and_then(Value::as_str).unwrap_or("");
    if !is_terminal_like_tool_name(name) {
        return None;
    }
    let input = tool.get("input")?;
    let command = input
        .get("command")
        .or_else(|| {
            let append_newline = input
                .get("appendNewline")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if append_newline {
                input.get("text").or_else(|| input.get("data"))
            } else {
                None
            }
        })
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .to_string();
    let cwd = input
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Some(MirroredCommand { command, cwd })
}

fn mirrored_output_from_tool_payload(
    payload: &Value,
    command: &str,
) -> (Option<String>, Option<i64>, bool) {
    let output_value = payload
        .pointer("/tool/output")
        .or_else(|| payload.get("output"))
        .unwrap_or(&Value::Null);
    let output = output_value
        .get("output")
        .or_else(|| output_value.get("content"))
        .and_then(Value::as_str)
        .map(|text| strip_command_echo(text, command))
        .filter(|text| !text.trim().is_empty());
    let exit_code = output_value
        .get("exitCode")
        .or_else(|| output_value.get("exit_code"))
        .and_then(Value::as_i64);
    let truncated = output_value
        .get("truncated")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    (output, exit_code, truncated)
}

fn strip_command_echo(output: &str, command: &str) -> String {
    let command = command.trim();
    let mut lines = output.lines();
    let Some(first) = lines.next() else {
        return String::new();
    };
    let first_trimmed = first.trim();
    if first_trimmed == command || first_trimmed.ends_with(command) {
        lines.collect::<Vec<_>>().join("\n")
    } else {
        output.to_string()
    }
}

fn sync_cwd_from_mirrored_command(
    mirror: &MirroredCommand,
    output: Option<&str>,
    exit_code: Option<i64>,
    cwd: &mut PathBuf,
) -> Result<bool, String> {
    if matches!(exit_code, Some(code) if code != 0) {
        return Ok(false);
    }
    let Some(next_cwd) =
        cwd_from_mirrored_command_result(&mirror.command, mirror.cwd.as_deref(), output, cwd)
    else {
        return Ok(false);
    };
    if next_cwd == *cwd {
        return Ok(false);
    }
    env::set_current_dir(&next_cwd).map_err(|error| format!("sync cwd failed: {error}"))?;
    *cwd = next_cwd;
    emit_cwd(cwd)?;
    Ok(true)
}

fn cwd_from_mirrored_command_result(
    command: &str,
    command_cwd: Option<&str>,
    output: Option<&str>,
    current_cwd: &Path,
) -> Option<PathBuf> {
    if !command_starts_with_cd(command) {
        return None;
    }
    if command_reports_pwd(command) {
        if let Some(path) = absolute_directory_from_output(output) {
            return Some(path);
        }
    }
    let base = command_cwd
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
        .unwrap_or_else(|| current_cwd.to_path_buf());
    resolve_cd_target_from_command(command, &base)
}

fn command_starts_with_cd(command: &str) -> bool {
    shlex::split(command)
        .and_then(|tokens| tokens.first().cloned())
        .as_deref()
        == Some("cd")
}

fn command_reports_pwd(command: &str) -> bool {
    let Some(tokens) = shlex::split(command) else {
        return false;
    };
    tokens.iter().any(|token| {
        let token = token.trim_matches(';');
        let program = Path::new(token)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(token);
        program == "pwd"
    })
}

fn absolute_directory_from_output(output: Option<&str>) -> Option<PathBuf> {
    output?
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| line.starts_with('/'))
        .map(PathBuf::from)
        .find_map(|path| path.canonicalize().ok().filter(|path| path.is_dir()))
}

fn resolve_cd_target_from_command(command: &str, base: &Path) -> Option<PathBuf> {
    let tokens = shlex::split(command)?;
    if tokens.first().map(String::as_str) != Some("cd") {
        return None;
    }
    let target = tokens.get(1).map(String::as_str);
    if target == Some("-") {
        return None;
    }
    let target_path = match target {
        Some("~") | None => env::var("HOME").ok().map(PathBuf::from)?,
        Some(value) if value.starts_with("~/") => {
            env::var("HOME").ok().map(PathBuf::from)?.join(&value[2..])
        }
        Some(value) => PathBuf::from(value.trim_end_matches(';')),
    };
    let next = if target_path.is_absolute() {
        target_path
    } else {
        base.join(target_path)
    };
    next.canonicalize().ok().filter(|path| path.is_dir())
}

fn run_agent_turn(
    client: &RuntimeSocketClient,
    session_id: &str,
    text: &str,
    cwd: &mut PathBuf,
) -> Result<(), String> {
    take_sigint_requested();
    let immersive_follow = read_follow(client, session_id).unwrap_or(false);
    let interrupts = AgentInterruptListener::start();
    let mut loading = LoadingSpinner::new();
    loading.tick()?;
    let response = match client.request(
        "agent.turn.send",
        json!({ "sessionId": session_id, "text": text }),
        Duration::from_secs(10),
    ) {
        Ok(response) => response,
        Err(error) => {
            loading.clear()?;
            return Err(error);
        }
    };
    let turn_id = response
        .get("turnId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut assistant_text = String::new();
    let mut started_tools = HashSet::new();
    let mut finished_tools = HashSet::new();
    let mut mirrored_commands: HashMap<String, MirroredCommand> = HashMap::new();
    if agent_interrupt_requested(&interrupts) {
        loading.clear()?;
        cancel_agent_turn(client, session_id)?;
        write_cli_output(
            &render_status_block("assistant", "cancelled"),
            interrupts.raw_mode_enabled(),
        )?;
        return Ok(());
    }
    loop {
        if agent_interrupt_requested(&interrupts) {
            loading.clear()?;
            cancel_agent_turn(client, session_id)?;
            write_cli_output(
                &render_status_block("assistant", "cancelled"),
                interrupts.raw_mode_enabled(),
            )?;
            return Ok(());
        }
        let Some(event) = client.recv_event_timeout(Duration::from_millis(100)) else {
            loading.tick()?;
            continue;
        };
        if event.event != "agent.runtime"
            || event.payload.get("sessionId").and_then(Value::as_str) != Some(session_id)
        {
            if event
                .payload
                .pointer("/snapshot/id")
                .and_then(Value::as_str)
                != Some(session_id)
            {
                loading.tick()?;
                continue;
            }
        }
        let kind = event
            .payload
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("");
        match kind {
            "turnStateChanged"
                if event
                    .payload
                    .get("turnId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    == turn_id =>
            {
                let state = event
                    .payload
                    .get("state")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if matches!(state, "cancelled" | "interrupted") {
                    loading.clear()?;
                    write_cli_output(
                        &render_status_block("assistant", state),
                        interrupts.raw_mode_enabled(),
                    )?;
                    return Ok(());
                }
            }
            "messageDelta" => {
                let delta = event
                    .payload
                    .get("delta")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                assistant_text.push_str(delta);
                loading.tick()?;
            }
            "toolStarted" | "toolUpdated" => {
                if let Some((tool_key, name)) = tool_event_identity(&event.payload) {
                    let first_start_for_tool = started_tools.insert(tool_key.clone());
                    if immersive_follow {
                        if let Some(command) = mirrored_command_from_tool_payload(&event.payload) {
                            let first_mirror_for_tool = !mirrored_commands.contains_key(&tool_key);
                            if first_mirror_for_tool {
                                loading.clear()?;
                                write_cli_output(
                                    &render_follow_command_prompt(
                                        command.cwd.as_deref(),
                                        &command.command,
                                    ),
                                    interrupts.raw_mode_enabled(),
                                )?;
                            }
                            mirrored_commands.insert(tool_key, command);
                        } else if first_start_for_tool && !is_terminal_like_tool_name(&name) {
                            loading.clear()?;
                            write_cli_output(
                                &render_tool_line(&name, None),
                                interrupts.raw_mode_enabled(),
                            )?;
                        }
                    } else if first_start_for_tool {
                        loading.clear()?;
                        write_cli_output(
                            &render_tool_line(&name, None),
                            interrupts.raw_mode_enabled(),
                        )?;
                    }
                }
                loading.tick()?;
            }
            "toolFinished" => {
                let (tool_key, name) = tool_event_identity(&event.payload)
                    .unwrap_or_else(|| ("tool".to_string(), "tool".to_string()));
                let status = event
                    .payload
                    .pointer("/tool/status")
                    .and_then(Value::as_str)
                    .unwrap_or("done");
                if finished_tools.insert(tool_key.clone()) {
                    loading.clear()?;
                    if immersive_follow {
                        let mirror = mirrored_commands
                            .remove(&tool_key)
                            .or_else(|| mirrored_command_from_tool_payload(&event.payload));
                        if let Some(mirror) = mirror {
                            let (output, exit_code, truncated) =
                                mirrored_output_from_tool_payload(&event.payload, &mirror.command);
                            sync_cwd_from_mirrored_command(
                                &mirror,
                                output.as_deref(),
                                exit_code,
                                cwd,
                            )?;
                            write_cli_output(
                                &render_follow_command_result(
                                    output.as_deref(),
                                    exit_code,
                                    truncated,
                                ),
                                interrupts.raw_mode_enabled(),
                            )?;
                        } else if !is_terminal_like_tool_name(&name) {
                            write_cli_output(
                                &render_tool_line(&name, Some(status)),
                                interrupts.raw_mode_enabled(),
                            )?;
                        }
                    } else {
                        write_cli_output(
                            &render_tool_line(&name, Some(status)),
                            interrupts.raw_mode_enabled(),
                        )?;
                    }
                }
                loading.tick()?;
            }
            "permissionRequested" => {
                loading.clear()?;
                let title = event
                    .payload
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Permission requested");
                let detail = event
                    .payload
                    .get("detail")
                    .or_else(|| event.payload.get("summary"))
                    .and_then(Value::as_str);
                let Some(permission_id) = event
                    .payload
                    .get("permissionId")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                else {
                    write_cli_output(
                        &render_notice("permission", title),
                        interrupts.raw_mode_enabled(),
                    )?;
                    loading.tick()?;
                    continue;
                };
                write_cli_output(
                    &render_permission_prompt(title, detail),
                    interrupts.raw_mode_enabled(),
                )?;
                match read_permission_decision(&interrupts)? {
                    PermissionDecision::Allow => {
                        respond_permission(client, session_id, &permission_id, true)?;
                        write_cli_output(
                            &render_permission_decision(true),
                            interrupts.raw_mode_enabled(),
                        )?;
                        loading.tick()?;
                    }
                    PermissionDecision::Deny => {
                        respond_permission(client, session_id, &permission_id, false)?;
                        write_cli_output(
                            &render_permission_decision(false),
                            interrupts.raw_mode_enabled(),
                        )?;
                        loading.tick()?;
                    }
                    PermissionDecision::CancelTurn => {
                        cancel_agent_turn(client, session_id)?;
                        write_cli_output(
                            &render_status_block("assistant", "cancelled"),
                            interrupts.raw_mode_enabled(),
                        )?;
                        return Ok(());
                    }
                }
            }
            "clarificationRequested" => {
                loading.clear()?;
                let question = event
                    .payload
                    .get("question")
                    .and_then(Value::as_str)
                    .unwrap_or("Clarification requested");
                write_cli_output(
                    &render_notice("question", question),
                    interrupts.raw_mode_enabled(),
                )?;
            }
            "turnFinished" | "turnFailed" | "turnInterrupted" | "turnCompleted"
                if event
                    .payload
                    .get("turnId")
                    .and_then(Value::as_str)
                    .map(|event_turn_id| event_turn_id == turn_id)
                    .unwrap_or(true) =>
            {
                loading.clear()?;
                let text = if assistant_text.trim().is_empty() {
                    latest_assistant_message_text(client, session_id)?
                } else {
                    Some(assistant_text)
                };
                if let Some(text) = text {
                    write_cli_output(
                        &render_agent_response_block(&text),
                        interrupts.raw_mode_enabled(),
                    )?;
                }
                return Ok(());
            }
            _ => {}
        }
    }
}

fn latest_assistant_message_text(
    client: &RuntimeSocketClient,
    session_id: &str,
) -> Result<Option<String>, String> {
    let snapshot = client.request(
        "agent.session.read",
        json!({ "sessionId": session_id }),
        Duration::from_secs(10),
    )?;
    let Some(messages) = snapshot.get("messages").and_then(Value::as_array) else {
        return Ok(None);
    };
    let Some(message) = messages
        .iter()
        .rev()
        .find(|message| message.get("role").and_then(Value::as_str) == Some("assistant"))
    else {
        return Ok(None);
    };
    Ok(message_text(message))
}

fn message_text(message: &Value) -> Option<String> {
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        return Some(text.to_string());
    }
    let blocks = message.get("blocks").and_then(Value::as_array)?;
    let text = blocks
        .iter()
        .filter_map(|block| {
            block
                .get("text")
                .or_else(|| block.get("content"))
                .and_then(Value::as_str)
        })
        .collect::<Vec<_>>()
        .join("");
    (!text.is_empty()).then_some(text)
}

#[derive(Debug, Clone)]
enum ShellCommandOutcome {
    Succeeded,
    Failed(ShellCommandFailure),
}

#[derive(Debug, Clone)]
struct ShellCommandFailure {
    command: String,
    cwd: String,
    exit_code: Option<i32>,
    error: String,
    recovery_hint: Option<String>,
}

impl ShellCommandFailure {
    fn summary(&self) -> String {
        let summary = match self.exit_code {
            Some(exit_code) => format!("exit {exit_code}: {}", self.error),
            None => self.error.clone(),
        };
        match self.recovery_hint.as_deref() {
            Some(hint) => format!("{summary} · try: {hint}"),
            None => summary,
        }
    }

    fn to_agent_message(&self) -> String {
        let exit_code = self
            .exit_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "none".to_string());
        let recovery_hint = self
            .recovery_hint
            .as_deref()
            .map(|hint| format!("\nLikely correction: `{hint}`"))
            .unwrap_or_default();
        format!(
            "A shell command failed in Lyra Agent CLI. Help the user recover. \
Use the command, cwd, and error below.\n\
If a likely correction is provided, do not call shell/terminal tools just to rediscover it. \
Give a concise recovery answer and put the corrected command in its own fenced `sh` code block. \
If no likely correction is provided, reason from the error and ask for clarification only when needed.\n\n\
Command: `{}`\nCwd: `{}`\nExit code: `{}`\nError: {}",
            self.command, self.cwd, exit_code, self.error
        ) + &recovery_hint
    }
}

enum CdOutcome {
    NotCd,
    Changed,
    Failed(String),
}

fn run_shell_command(
    command: &str,
    shell: &str,
    cwd: &mut PathBuf,
) -> Result<ShellCommandOutcome, String> {
    match try_apply_cd(command, cwd)? {
        CdOutcome::Changed => {
            emit_cwd(cwd)?;
            print!("{}", render_status_block("cwd", &cwd.display().to_string()));
            io::stdout().flush().map_err(|error| error.to_string())?;
            return Ok(ShellCommandOutcome::Succeeded);
        }
        CdOutcome::Failed(error) => {
            let recovery_hint = suggest_cd_correction(command, cwd);
            return Ok(ShellCommandOutcome::Failed(ShellCommandFailure {
                command: command.to_string(),
                cwd: cwd.display().to_string(),
                exit_code: None,
                error,
                recovery_hint,
            }));
        }
        CdOutcome::NotCd => {}
    }
    let started_at = Instant::now();
    emit_command_start(command)?;
    let status = ProcessCommand::new(shell)
        .arg("-lc")
        .arg(command)
        .current_dir(&*cwd)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|error| format!("run shell command failed: {error}"))?;
    let interrupted_by_user = shell_status_was_interrupted(&status);
    let exit_code = status
        .code()
        .unwrap_or(if interrupted_by_user { 130 } else { 1 });
    take_sigint_requested();
    emit_command_end(exit_code)?;
    print!(
        "{}",
        render_shell_result_line(exit_code, started_at.elapsed())
    );
    io::stdout().flush().map_err(|error| error.to_string())?;
    if exit_code == 0 || interrupted_by_user {
        Ok(ShellCommandOutcome::Succeeded)
    } else {
        Ok(ShellCommandOutcome::Failed(ShellCommandFailure {
            command: command.to_string(),
            cwd: cwd.display().to_string(),
            exit_code: Some(exit_code),
            error: "command exited unsuccessfully; stdout/stderr were shown in the terminal above"
                .to_string(),
            recovery_hint: None,
        }))
    }
}

fn suggest_cd_correction(command: &str, cwd: &Path) -> Option<String> {
    let tokens = shlex::split(command)?;
    if tokens.first().map(String::as_str) != Some("cd") {
        return None;
    }
    let target = tokens.get(1)?;
    if target.trim().is_empty() || target == "-" {
        return None;
    }
    let target_path = PathBuf::from(target);
    let full_target = if target_path.is_absolute() {
        target_path
    } else {
        cwd.join(target_path)
    };
    let needle = full_target.file_name()?.to_string_lossy().to_string();
    if needle.trim().is_empty() {
        return None;
    }
    let parent = full_target.parent().unwrap_or(cwd);
    let candidate = best_directory_match(parent, &needle)?;
    let suggested_path = if Path::new(target).is_absolute() {
        parent.join(candidate).display().to_string()
    } else {
        let original = Path::new(target);
        match original.parent() {
            Some(prefix) if !prefix.as_os_str().is_empty() => {
                prefix.join(candidate).display().to_string()
            }
            _ => candidate,
        }
    };
    Some(format!("cd {}", shlex::try_quote(&suggested_path).ok()?))
}

fn best_directory_match(parent: &Path, needle: &str) -> Option<String> {
    let needle_lower = needle.to_lowercase();
    let mut best: Option<(usize, String)> = None;
    let entries = fs::read_dir(parent).ok()?;
    for entry in entries.flatten() {
        let file_type = entry.file_type().ok()?;
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let name_lower = name.to_lowercase();
        let distance = levenshtein(&needle_lower, &name_lower);
        let max_len = needle_lower.chars().count().max(name_lower.chars().count());
        let plausible = distance <= 2 || (max_len >= 6 && distance <= 3);
        if !plausible {
            continue;
        }
        match best.as_ref() {
            Some((best_distance, best_name))
                if distance > *best_distance
                    || (distance == *best_distance && name >= *best_name) => {}
            _ => best = Some((distance, name)),
        }
    }
    best.map(|(_, name)| name)
}

fn levenshtein(left: &str, right: &str) -> usize {
    if left == right {
        return 0;
    }
    let right_chars = right.chars().collect::<Vec<_>>();
    let mut previous = (0..=right_chars.len()).collect::<Vec<_>>();
    let mut current = vec![0; right_chars.len() + 1];
    for (left_index, left_char) in left.chars().enumerate() {
        current[0] = left_index + 1;
        for (right_index, right_char) in right_chars.iter().enumerate() {
            let deletion = previous[right_index + 1] + 1;
            let insertion = current[right_index] + 1;
            let substitution = previous[right_index] + usize::from(left_char != *right_char);
            current[right_index + 1] = deletion.min(insertion).min(substitution);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right_chars.len()]
}

#[cfg(unix)]
fn shell_status_was_interrupted(status: &std::process::ExitStatus) -> bool {
    use std::os::unix::process::ExitStatusExt;
    status.signal() == Some(libc::SIGINT)
}

#[cfg(not(unix))]
fn shell_status_was_interrupted(_status: &std::process::ExitStatus) -> bool {
    take_sigint_requested()
}

fn try_apply_cd(command: &str, cwd: &mut PathBuf) -> Result<CdOutcome, String> {
    let Some(tokens) = shlex::split(command) else {
        return Ok(CdOutcome::NotCd);
    };
    if tokens.first().map(String::as_str) != Some("cd") {
        return Ok(CdOutcome::NotCd);
    }
    let target = tokens
        .get(1)
        .map(PathBuf::from)
        .or_else(|| env::var("HOME").ok().map(PathBuf::from));
    let Some(target) = target else {
        return Ok(CdOutcome::Failed("cd failed: HOME is not set".to_string()));
    };
    let next = if target.is_absolute() {
        target
    } else {
        cwd.join(target)
    };
    let canonical = match next.canonicalize() {
        Ok(path) => path,
        Err(error) => return Ok(CdOutcome::Failed(format!("cd failed: {error}"))),
    };
    if !canonical.is_dir() {
        return Ok(CdOutcome::Failed(format!(
            "cd failed: not a directory: {}",
            canonical.display()
        )));
    }
    *cwd = canonical;
    env::set_current_dir(&*cwd).map_err(|error| format!("cd failed: {error}"))?;
    Ok(CdOutcome::Changed)
}

fn emit_command_start(command: &str) -> Result<(), String> {
    print!("\x1b]133;C;command={}\x07", percent_encode(command));
    io::stdout().flush().map_err(|error| error.to_string())
}

fn emit_command_end(exit_code: i32) -> Result<(), String> {
    print!("\x1b]133;D;exitCode={exit_code}\x07");
    io::stdout().flush().map_err(|error| error.to_string())
}

fn emit_cwd(cwd: &Path) -> Result<(), String> {
    print!(
        "\x1b]7;file://localhost{}\x07",
        percent_encode(&cwd.display().to_string())
    );
    io::stdout().flush().map_err(|error| error.to_string())
}

fn percent_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| {
            let keep =
                byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/' | b':');
            if keep {
                vec![byte as char]
            } else {
                format!("%{byte:02X}").chars().collect()
            }
        })
        .collect()
}

fn handle_agent(command: AgentCommand, services: &AgentRuntimeServices) -> serde_json::Value {
    match match command {
        AgentCommand::Chat(_) => Ok(json!({
            "status": "ready",
            "mode": "chat",
            "runtimeServices": services.service_names(),
        })),
        AgentCommand::Run { prompt, session_id } => {
            run_prompt_with_events(prompt, session_id, services)
        }
        AgentCommand::Sessions { command } => match command {
            SessionCommand::List => services.session.list(None),
            SessionCommand::Read { id } => services.session.read(Some(id)),
        },
        AgentCommand::Memory { command } => match command {
            MemoryCommand::Search { query } => services.memory.search_shared(query),
        },
        AgentCommand::Provider { command } => match command {
            ProviderCommand::List => services.provider.provider_profiles(),
        },
        AgentCommand::Events => Ok(json!({
            "events": services.event_bus.replay(),
        })),
        AgentCommand::Tools { command } => match command {
            ToolsCommand::List => Ok(services.tool_activity.cli_capabilities()),
        },
        AgentCommand::Skills { command } => match command {
            SkillsCommand::List => Ok(json!({
                "skills": services
                    .skill_registry
                    .list()
                    .into_iter()
                    .map(skill_state_json)
                    .collect::<Vec<_>>()
            })),
            SkillsCommand::Inspect { id } => services
                .skill_registry
                .inspect(&id)
                .map(skill_state_json)
                .map(|skill| json!({ "skill": skill }))
                .ok_or_else(|| {
                    lyra_agent_runtime::AgentRuntimeError::Core(format!(
                        "Lyra skill is not registered: {id}"
                    ))
                }),
            SkillsCommand::Activate { id } => services
                .skill_registry
                .activate(&id)
                .map(skill_state_json)
                .map(|skill| json!({ "skill": skill }))
                .map_err(|error| lyra_agent_runtime::AgentRuntimeError::Core(error.to_string())),
            SkillsCommand::Deactivate { id } => services
                .skill_registry
                .deactivate(&id)
                .map(skill_state_json)
                .map(|skill| json!({ "skill": skill }))
                .map_err(|error| lyra_agent_runtime::AgentRuntimeError::Core(error.to_string())),
        },
        AgentCommand::Software { command } => match command {
            SoftwareCommand::List => services.software.list_capabilities(),
        },
    } {
        Ok(value) => value,
        Err(error) => json!({
            "ok": false,
            "error": {
                "message": error.to_string(),
            },
        }),
    }
}

fn run_prompt_with_events(
    prompt: String,
    session_id: Option<String>,
    services: &AgentRuntimeServices,
) -> lyra_agent_runtime::AgentRuntimeResult<serde_json::Value> {
    let mut payload = serde_json::json!({ "text": prompt });
    if let Some(sid) = session_id {
        payload["sessionId"] = serde_json::Value::String(sid);
    }
    let mut value = services.turn_runner.send(payload)?;
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "runtimeEvents".to_string(),
            serde_json::Value::Array(services.event_bus.drain()),
        );
    }
    Ok(value)
}

fn skill_state_json(skill: LyraSkillState) -> Value {
    json!({
        "id": skill.manifest.id,
        "name": skill.manifest.name,
        "version": skill.manifest.version,
        "description": skill.manifest.description,
        "prompt": skill.manifest.prompt,
        "permissions": skill.manifest.permissions,
        "toolCapabilities": skill.manifest.tool_capabilities,
        "active": skill.active,
    })
}

#[cfg(test)]
mod cli_shell_tests {
    use super::*;

    #[test]
    fn raw_mode_output_normalizes_newlines_to_crlf() {
        assert_eq!(
            normalize_newlines_for_raw_mode("╭─ tool\n│ workbench\n╰─\n"),
            "╭─ tool\r\n│ workbench\r\n╰─\r\n"
        );
        assert_eq!(
            normalize_newlines_for_raw_mode("already\r\nok\n"),
            "already\r\nok\r\n"
        );
    }

    #[test]
    fn cd_failure_becomes_agent_recovery_context() {
        let mut cwd = env::temp_dir();
        let missing = format!(
            "lyra-cli-missing-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        );
        let command = format!("cd {missing}");
        let outcome = try_apply_cd(&command, &mut cwd).expect("cd outcome");
        let CdOutcome::Failed(error) = outcome else {
            panic!("missing directory should fail without exiting CLI");
        };
        let failure = ShellCommandFailure {
            command: command.clone(),
            cwd: cwd.display().to_string(),
            exit_code: None,
            error,
            recovery_hint: None,
        };
        let message = failure.to_agent_message();
        assert!(message.contains(&format!("Command: `{command}`")));
        assert!(message.contains("cd failed"));
    }

    #[test]
    fn cd_failure_suggests_nearest_directory() {
        let root = env::temp_dir().join(format!(
            "lyra-cli-cd-suggest-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        let documents = root.join("Documents");
        fs::create_dir_all(&documents).expect("create Documents");
        let suggestion = suggest_cd_correction("cd Documants", &root);
        assert_eq!(suggestion.as_deref(), Some("cd Documents"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn recovery_prompt_includes_likely_correction_and_discourages_tool_spam() {
        let failure = ShellCommandFailure {
            command: "cd Documants".to_string(),
            cwd: "/Users/petehsu".to_string(),
            exit_code: None,
            error: "cd failed: No such file or directory".to_string(),
            recovery_hint: Some("cd Documents".to_string()),
        };
        let message = failure.to_agent_message();
        assert!(message.contains("Likely correction: `cd Documents`"));
        assert!(message.contains("do not call shell/terminal tools"));
        assert!(message.contains("fenced `sh` code block"));
    }

    #[test]
    fn mirrored_terminal_tool_extracts_command_and_output() {
        let payload = json!({
            "tool": {
                "id": "tool-1",
                "name": "shell",
                "input": {
                    "action": "run",
                    "command": "ls",
                    "cwd": "/tmp"
                },
                "output": {
                    "output": "ls\nfile.txt\n",
                    "exitCode": 0,
                    "truncated": false
                }
            }
        });
        let command = mirrored_command_from_tool_payload(&payload).expect("mirrored command");
        assert_eq!(command.command, "ls");
        assert_eq!(command.cwd.as_deref(), Some("/tmp"));
        let (output, exit_code, truncated) =
            mirrored_output_from_tool_payload(&payload, &command.command);
        assert_eq!(output.as_deref(), Some("file.txt"));
        assert_eq!(exit_code, Some(0));
        assert!(!truncated);
    }

    #[test]
    fn mirrored_terminal_write_with_newline_is_treated_as_command() {
        let payload = json!({
            "tool": {
                "id": "tool-1",
                "name": "terminal_write",
                "input": {
                    "action": "write",
                    "text": "pwd",
                    "appendNewline": true
                }
            }
        });
        let command = mirrored_command_from_tool_payload(&payload).expect("mirrored command");
        assert_eq!(command.command, "pwd");
    }

    #[test]
    fn mirrored_terminal_run_tool_name_extracts_command() {
        let payload = json!({
            "tool": {
                "id": "tool-1",
                "name": "terminal_run",
                "input": {
                    "action": "run",
                    "command": "cd Documents && pwd"
                }
            }
        });
        let command = mirrored_command_from_tool_payload(&payload).expect("mirrored command");
        assert_eq!(command.command, "cd Documents && pwd");
    }

    #[test]
    fn mirrored_cd_pwd_output_updates_cli_cwd() {
        let root = env::temp_dir().join(format!(
            "lyra-cli-follow-cwd-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system time")
                .as_nanos()
        ));
        let documents = root.join("Documents");
        fs::create_dir_all(&documents).expect("create Documents");
        let next = cwd_from_mirrored_command_result(
            "cd Documents && pwd",
            Some(root.to_string_lossy().as_ref()),
            Some(&format!("{}\n", documents.display())),
            &root,
        )
        .expect("cwd from output");
        assert_eq!(next, documents.canonicalize().expect("canonical Documents"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn mirrored_non_cd_command_does_not_update_cli_cwd() {
        let root = env::temp_dir();
        assert!(cwd_from_mirrored_command_result("pwd", None, Some("/tmp\n"), &root).is_none());
    }
}
