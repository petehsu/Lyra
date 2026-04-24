#[cfg(not(unix))]
fn main() {
    eprintln!("lyra-execve-wrapper is only implemented for UNIX");
    std::process::exit(1);
}

#[cfg(unix)]
pub use lyra_shell_escalation::main_execve_wrapper as main;
