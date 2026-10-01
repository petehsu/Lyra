//! Companions that a role process owns. The agent host restarts tool execution.
//! The scheduler only wakes the agent host.

use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use super::router::host_role;

pub(crate) fn start_role_companions(own_socket: &Path) {
    match host_role().as_str() {
        "agent" => supervise_exec(own_socket),
        "scheduler" => supervise_scheduler(own_socket),
        _ => {}
    }
}

fn supervise_exec(own_socket: &Path) {
    let exec_socket = own_socket.with_file_name("exec.sock");
    std::env::set_var("LYRA_EXEC_SOCKET", exec_socket.display().to_string());
    let executable = std::env::current_exe().ok();
    thread::spawn(move || {
        let Some(executable) = executable else {
            return;
        };
        loop {
            let mut command = Command::new(&executable);
            command
                .arg("--role")
                .arg("exec")
                .arg("--socket")
                .arg(&exec_socket)
                .env_remove("LYRA_EXEC_SOCKET")
                .env("LYRA_HOST_ROLE", "exec")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::inherit());
            lyra_process_lifecycle_core::configure_daemon_child_command(&mut command);
            match command.spawn() {
                Ok(mut child) => {
                    eprintln!("[lyra-agent-host] exec pid {}", child.id());
                    let _ = child.wait();
                    eprintln!("[lyra-agent-host] exec exited; restarting");
                }
                Err(error) => {
                    eprintln!("[lyra-agent-host] failed to start exec: {error}");
                }
            }
            thread::sleep(Duration::from_millis(300));
        }
    });
}

fn supervise_scheduler(own_socket: &Path) {
    let agent_socket = own_socket.with_file_name("agent.sock");
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(30));
        if let Err(error) = poke_agent(&agent_socket) {
            eprintln!("[lyra-scheduler] agent wake failed: {error}");
        }
    });
}

fn poke_agent(socket: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::net::UnixStream;
        let mut stream = UnixStream::connect(socket)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        let hello = serde_json::json!({
            "kind": "request",
            "id": "sched-hello",
            "method": "runtime.handshake",
            "payload": {
                "protocolMinVersion": 2,
                "protocolMaxVersion": 2,
                "clientName": "lyra-scheduler",
                "componentVersion": "0.1.0",
                "buildId": "scheduler",
                "hostApiVersion": "1.0.0",
                "capabilities": ["scheduler.wake"],
                "dataSchemas": {"lyra.runtime": 1},
                "connectionRole": "auxiliaryClient",
                "connectionLeaseId": "scheduler"
            }
        });
        writeln!(stream, "{hello}")?;
        let wake = serde_json::json!({
            "kind": "request",
            "id": "sched-wake",
            "method": "agent.proactive.list",
            "payload": {"status": "pending"}
        });
        writeln!(stream, "{wake}")?;
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        let _ = reader.read_line(&mut line)?;
        line.clear();
        let _ = reader.read_line(&mut line)?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        let _ = socket;
        Ok(())
    }
}
