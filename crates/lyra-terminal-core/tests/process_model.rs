use lyra_terminal_core::process_model::{
    snapshot_from_ps, snapshot_from_windows_process_json, TerminalProcessModel,
};
use lyra_terminal_core::signals::{
    disposition_for_signal, parse_signal, planned_signal_command_for_platform,
    risk_hook_for_signal, signal_from_key,
};

#[test]
fn process_tree_snapshot_tracks_local_children() {
    let ps_output = "\
100 1 100 Ss /bin/zsh
101 100 100 R cargo
102 101 100 S rustc
200 1 200 S ssh
";
    let snapshot = snapshot_from_ps(100, Some(101), ps_output);
    assert_eq!(snapshot.root_pid, Some(100));
    assert_eq!(snapshot.foreground_pid, Some(101));
    assert_eq!(snapshot.process_count, 3);
    assert!(!snapshot.limited);
    assert_eq!(
        snapshot
            .processes
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>(),
        vec![100, 101, 102]
    );
}

#[test]
fn windows_process_tree_snapshot_tracks_local_children() {
    let process_json = r#"[
      {"ProcessId":100,"ParentProcessId":1,"Name":"powershell.exe","CommandLine":"powershell.exe"},
      {"ProcessId":101,"ParentProcessId":100,"Name":"npm.cmd","CommandLine":"npm run dev"},
      {"ProcessId":102,"ParentProcessId":101,"Name":"node.exe","CommandLine":"node server.js"},
      {"ProcessId":200,"ParentProcessId":1,"Name":"other.exe","CommandLine":"other.exe"}
    ]"#;

    let snapshot = snapshot_from_windows_process_json(100, Some(101), process_json);
    assert_eq!(snapshot.root_pid, Some(100));
    assert_eq!(snapshot.foreground_pid, Some(101));
    assert_eq!(snapshot.process_count, 3);
    assert!(!snapshot.limited);
    assert_eq!(
        snapshot
            .processes
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>(),
        vec![100, 101, 102]
    );
}

#[test]
fn process_model_links_commands_to_process_ids() {
    let mut model = TerminalProcessModel::new("session-1", Some(100));
    model.mark_foreground_pid(Some(101));
    model.link_command_processes("command-1", vec![102, 101, 101]);

    assert_eq!(model.pid, Some(100));
    assert_eq!(model.foreground_pid, Some(101));
    assert_eq!(model.command_links[0].command_id, "command-1");
    assert_eq!(model.command_links[0].process_ids, vec![101, 102]);
}

#[test]
fn process_tree_marks_limited_when_local_tree_is_unavailable() {
    let snapshot = snapshot_from_ps(999, None, "100 1 100 S /bin/zsh\n");
    assert!(snapshot.limited);
    assert_eq!(snapshot.process_count, 0);

    let mut model = TerminalProcessModel::new("session-remote", None);
    model.mark_remote_limited("ssh remote process tree unavailable");
    assert!(model.limited);
    assert_eq!(
        model.limited_reason.as_deref(),
        Some("ssh remote process tree unavailable")
    );
}

#[test]
fn signals_expose_risk_hooks_and_disposition() {
    let sigint = signal_from_key("ctrl_c").expect("ctrl-c signal");
    assert_eq!(sigint.name, "SIGINT");
    assert_eq!(sigint.control_bytes, vec![3]);

    let sigterm = parse_signal("TERM").expect("term signal");
    assert_eq!(sigterm.risk, "dangerous");
    assert_eq!(risk_hook_for_signal(&sigterm), "terminate_process_tree");

    let sigkill = parse_signal("SIGKILL").expect("kill signal");
    assert_eq!(risk_hook_for_signal(&sigkill), "force_kill_process_tree");

    let disposition = disposition_for_signal(&sigint, true);
    assert_eq!(disposition.delivery, "pty_control_bytes");
    assert!(disposition.records_process_signal_sent);
}

#[test]
fn windows_signal_delivery_uses_taskkill_process_tree_command() {
    let sigterm = parse_signal("SIGTERM").expect("term signal");
    let command =
        planned_signal_command_for_platform(42, &sigterm, "windows").expect("windows command");
    assert_eq!(command.program, "taskkill");
    assert_eq!(command.args, vec!["/PID", "42", "/T"]);

    let sigkill = parse_signal("SIGKILL").expect("kill signal");
    let command =
        planned_signal_command_for_platform(42, &sigkill, "windows").expect("windows command");
    assert_eq!(command.program, "taskkill");
    assert_eq!(command.args, vec!["/PID", "42", "/T", "/F"]);
}

#[test]
fn process_model_records_signal_and_exit_state() {
    let mut model = TerminalProcessModel::new("session-signal", Some(42));
    let sigterm = parse_signal("SIGTERM").expect("term signal");
    model.record_signal(&sigterm);
    assert_eq!(model.signal.as_deref(), Some("SIGTERM"));

    model.mark_exit(None, Some("SIGTERM".to_string()));
    assert!(!model.running);
    assert_eq!(model.exit_code, None);
    assert_eq!(model.signal.as_deref(), Some("SIGTERM"));
}
