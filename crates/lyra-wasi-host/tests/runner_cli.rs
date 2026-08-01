use std::fs;
use std::process::Command;

use lyra_wasi_host::{WasiRunnerLimits, WasiRunnerResponse, WasiRunnerStatus};
use sha2::{Digest, Sha256};
use tempfile::TempDir;

type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

#[test]
fn runner_reports_component_rejection_as_json() -> TestResult {
    let root = TempDir::new()?;
    let component = root.path().join("native.wasm");
    let bytes = b"#!/bin/sh\nexit 0\n";
    fs::write(&component, bytes)?;
    let app_data = root.path().join("app-data");
    let temporary = root.path().join("temporary");
    fs::create_dir(&app_data)?;
    fs::create_dir(&temporary)?;
    let limits = WasiRunnerLimits::default();

    let output = Command::new(env!("CARGO_BIN_EXE_lyra-wasi-runner"))
        .args([
            "--component",
            component.to_str().ok_or("component path is not UTF-8")?,
            "--expected-sha256",
            &format!("{:x}", Sha256::digest(bytes)),
            "--app-data-root",
            app_data.to_str().ok_or("app data path is not UTF-8")?,
            "--temporary-root",
            temporary.to_str().ok_or("temporary path is not UTF-8")?,
            "--max-component-bytes",
            &limits.max_component_bytes.to_string(),
            "--max-memory-bytes",
            &limits.max_memory_bytes.to_string(),
            "--max-table-elements",
            &limits.max_table_elements.to_string(),
            "--max-instances",
            &limits.max_instances.to_string(),
            "--max-tables",
            &limits.max_tables.to_string(),
            "--max-memories",
            &limits.max_memories.to_string(),
            "--max-random-bytes",
            &limits.max_random_bytes.to_string(),
            "--fuel",
            &limits.fuel.to_string(),
            "--timeout-millis",
            &limits.timeout_millis.to_string(),
        ])
        .output()?;

    assert_eq!(output.status.code(), Some(2));
    assert!(output.stderr.is_empty());
    let response: WasiRunnerResponse = serde_json::from_slice(&output.stdout)?;
    assert_eq!(response.status, WasiRunnerStatus::Error);
    assert_eq!(
        response.error.map(|error| error.code),
        Some("componentRejected".to_owned())
    );
    Ok(())
}
