use lyra_performance_core::helper::{
    DEFAULT_HELPER_TCP_ADDR, run_oneshot, run_stdio, serve_tcp, serve_unix_socket,
};
use std::path::PathBuf;

fn main() {
    if let Err(error) = run() {
        eprintln!("[lyra-performance-helper] {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    match args.next().as_deref() {
        Some("--oneshot") => run_oneshot(args.next()),
        Some("--stdio") => run_stdio(true),
        Some("--serve-unix") => {
            let path = args
                .next()
                .map(PathBuf::from)
                .ok_or_else(|| "--serve-unix requires a socket path".to_string())?;
            serve_unix_socket(&path)
        }
        Some("--serve-tcp") => {
            let addr = args
                .next()
                .unwrap_or_else(|| DEFAULT_HELPER_TCP_ADDR.to_string());
            serve_tcp(&addr)
        }
        Some("--status") => run_oneshot(Some(
            r#"{"method":"helper.status","payload":null}"#.to_string(),
        )),
        Some("--help") | Some("-h") => {
            print_usage();
            Ok(())
        }
        Some(other) => Err(format!("unknown argument: {other}")),
        None => {
            print_usage();
            Ok(())
        }
    }
}

fn print_usage() {
    println!(
        "{}",
        [
            "Usage: lyra-performance-helper <mode>",
            "",
            "Modes:",
            "  --serve-unix <path>      Run a privileged Unix-domain socket helper",
            "  --serve-tcp [addr]       Run a privileged localhost TCP helper",
            "  --stdio                  Run newline-delimited JSON helper over stdin/stdout",
            "  --oneshot [json]         Handle one helper request from argv or stdin",
            "  --status                 Print helper.status response JSON",
        ]
        .join("\n")
    );
}
