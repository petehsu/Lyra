//! Thin host entry points. Each one replaces itself with `lyrad --role <name>`
//! so the socket server stays in one place and the process name stays distinct.

use std::process::Command;

pub fn exec_host_role(role: &str) -> ! {
    let lyrad = std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.parent()
                .map(|parent| parent.join(if cfg!(windows) { "lyrad.exe" } else { "lyrad" }))
        })
        .unwrap_or_else(|| "lyrad".into());
    let mut command = Command::new(lyrad);
    command.arg("--role").arg(role);
    command.args(std::env::args_os().skip(1));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.arg0(format!("lyra-{role}-host"));
        let error = command.exec();
        eprintln!("lyra-{role}-host failed to start: {error}");
    }
    #[cfg(not(unix))]
    {
        match command.status() {
            Ok(status) => std::process::exit(status.code().unwrap_or(1)),
            Err(error) => eprintln!("lyra-{role}-host failed to start: {error}"),
        }
    }
    std::process::exit(1);
}
