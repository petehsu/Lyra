use std::collections::BTreeMap;
use std::fs;
use std::process::Command;

use lyra_bootstrap_core::{
    ActivationRegistryV1, ComponentActivationStateV1, Target, read_activation_registry,
};
use tempfile::tempdir;

fn write_install_like_registry(root: &std::path::Path, target: &Target) {
    let directory = root.join("registry-v1");
    fs::create_dir_all(&directory).expect("registry directory");
    let registry = ActivationRegistryV1 {
        schema_version: 1,
        revision: 1,
        keyring_sequence: 7,
        catalog_sequence: 12,
        target: target.as_str().to_string(),
        active_release_version: Some("1.0.0".to_string()),
        pending_release_version: Some("1.1.0".to_string()),
        components: BTreeMap::from([(
            "lyra.images".to_string(),
            ComponentActivationStateV1 {
                active: Some("1.0.0".to_string()),
                previous: None,
                pending: Some("1.1.0".to_string()),
            },
        )]),
    };
    fs::write(
        directory.join("registry-00000000000000000001-00000000-0000-4000-8000-000000000001.json"),
        serde_json::to_vec_pretty(&registry).expect("registry JSON"),
    )
    .expect("write registry");
}

#[test]
fn internal_cli_activation_persists_in_the_canonical_registry() {
    let temp = tempdir().expect("tempdir");
    let state_root = temp.path().join("state");
    let install_root = temp.path().join("components");
    let target = Target::parse("darwin-arm64").expect("target");
    write_install_like_registry(&state_root, &target);

    let output = Command::new(env!("CARGO_BIN_EXE_lyra-bootstrap"))
        .args([
            "--registry-action",
            "activate",
            "--component-id",
            "lyra.images",
            "--expected-revision",
            "1",
            "--expected-version",
            "1.1.0",
            "--install-root",
        ])
        .arg(&install_root)
        .arg("--state-root")
        .arg(&state_root)
        .args(["--target", target.as_str()])
        .output()
        .expect("run lyra-bootstrap registry helper");
    assert!(
        output.status.success(),
        "helper failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let reported: ActivationRegistryV1 =
        serde_json::from_slice(&output.stdout).expect("bounded registry output");
    assert_eq!(reported.revision, 2);
    assert_eq!(
        reported.components["lyra.images"].active.as_deref(),
        Some("1.1.0")
    );
    assert_eq!(reported.components["lyra.images"].pending, None);
    assert_eq!(reported.active_release_version.as_deref(), Some("1.1.0"));
    assert_eq!(reported.pending_release_version, None);

    // A later process reads the same append-only registry rather than any
    // Desktop cache, proving activation survives process boundaries.
    let later = read_activation_registry(&state_root, &target).expect("later registry read");
    assert_eq!(later.revision, reported.revision);
    assert_eq!(
        later.components["lyra.images"],
        reported.components["lyra.images"]
    );
}
