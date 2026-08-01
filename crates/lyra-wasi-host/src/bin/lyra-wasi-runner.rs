use std::path::PathBuf;

use clap::Parser;
use lyra_wasi_host::{
    WasiRunnerLimits, WasiRunnerRequest, WasiRunnerResponse, execute_runner_request,
};

#[derive(Debug, Parser)]
#[command(
    name = "lyra-wasi-runner",
    about = "Run one integrity-checked WASI 0.2 component with a fail-closed policy"
)]
struct Arguments {
    #[arg(long)]
    component: PathBuf,
    #[arg(long)]
    expected_sha256: String,
    #[arg(long)]
    app_data_root: PathBuf,
    #[arg(long)]
    temporary_root: PathBuf,
    #[arg(long = "permission")]
    permissions: Vec<String>,
    #[arg(long)]
    max_component_bytes: u64,
    #[arg(long)]
    max_memory_bytes: u64,
    #[arg(long)]
    max_table_elements: u64,
    #[arg(long)]
    max_instances: u64,
    #[arg(long)]
    max_tables: u64,
    #[arg(long)]
    max_memories: u64,
    #[arg(long)]
    max_random_bytes: u64,
    #[arg(long)]
    fuel: u64,
    #[arg(long)]
    timeout_millis: u64,
}

impl From<Arguments> for WasiRunnerRequest {
    fn from(arguments: Arguments) -> Self {
        Self {
            component_path: arguments.component,
            expected_sha256: arguments.expected_sha256,
            app_data_root: arguments.app_data_root,
            temporary_root: arguments.temporary_root,
            permissions: arguments.permissions,
            limits: WasiRunnerLimits {
                max_component_bytes: arguments.max_component_bytes,
                max_memory_bytes: arguments.max_memory_bytes,
                max_table_elements: arguments.max_table_elements,
                max_instances: arguments.max_instances,
                max_tables: arguments.max_tables,
                max_memories: arguments.max_memories,
                max_random_bytes: arguments.max_random_bytes,
                fuel: arguments.fuel,
                timeout_millis: arguments.timeout_millis,
            },
        }
    }
}

fn main() {
    let response = match Arguments::try_parse() {
        Ok(arguments) => execute_runner_request(&arguments.into()),
        Err(error) => WasiRunnerResponse::invalid_arguments(error.to_string()),
    };
    let exit_code = response.exit_code();
    match serde_json::to_string(&response) {
        Ok(json) => println!("{json}"),
        Err(_) => println!(
            "{}",
            r#"{"protocolVersion":1,"status":"error","error":{"code":"serializationFailed","message":"runner response serialization failed"}}"#
        ),
    }
    std::process::exit(exit_code);
}
