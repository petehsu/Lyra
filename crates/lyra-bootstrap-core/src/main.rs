#![cfg_attr(test, allow(clippy::expect_used, clippy::unwrap_used))]

use std::io::{self, Write};
use std::path::PathBuf;
use std::time::Duration;

use clap::{Parser, ValueEnum};
use lyra_bootstrap_core::{
    ActivationRegistryMutationV1, BootstrapInstaller, CoreProjectionConfig, CoreProjectionMode,
    CoreProjector, InstallerConfig, Target, TrustedKeys, mutate_activation_registry,
    read_activation_registry, read_activation_registry_revision,
};

const MAX_REGISTRY_OUTPUT_BYTES: usize = 4 * 1024 * 1024 + 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
enum RegistryAction {
    Read,
    ReadRevision,
    Activate,
    Rollback,
    Restore,
}

#[derive(Debug, Parser)]
#[command(
    name = "lyra-bootstrap",
    about = "Install or repair an exact signed Lyra release BOM"
)]
struct Arguments {
    #[arg(long)]
    catalog: Option<String>,
    #[arg(long)]
    install_root: PathBuf,
    #[arg(long)]
    state_root: PathBuf,
    #[arg(long)]
    release: Option<String>,
    #[arg(long)]
    target: Option<String>,
    #[arg(long)]
    proxy: Option<String>,
    /// Root of a full offline bundle containing content-addressed `boms/`
    /// and `components/` directories.
    #[arg(long)]
    offline_bundle: Option<PathBuf>,
    /// Include resources marked on-demand in an online installation.
    #[arg(long)]
    include_on_demand: bool,
    /// Install or repair exactly one on-demand component from --release.
    /// Internal Core first-use path; the catalog must be the immutable local
    /// receipt written by the original signed release installation.
    #[arg(
        long,
        conflicts_with = "include_on_demand",
        requires_all = ["release", "expected_catalog_sequence"]
    )]
    on_demand_component: Option<String>,
    /// Installed catalog sequence that the on-demand receipt must match.
    #[arg(long, requires = "on_demand_component")]
    expected_catalog_sequence: Option<u64>,
    #[arg(long)]
    json_progress: bool,
    #[arg(long = "trusted-root", value_name = "KEY_ID=BASE64")]
    trusted_roots: Vec<String>,
    /// Apply the active or pending lyra.core payload to --program-root. The
    /// executable must first be copied outside that program directory.
    #[arg(long)]
    apply_core: bool,
    #[arg(long, requires = "apply_core")]
    program_root: Option<PathBuf>,
    /// Lyra process IDs to observe before replacing an existing Core. Their
    /// descendants and executables inside --program-root are also observed.
    #[arg(long, requires = "apply_core")]
    wait_pid: Vec<u32>,
    #[arg(long, default_value_t = 300, requires = "apply_core")]
    wait_timeout_seconds: u64,
    /// Request automatic rather than user-started replacement. Unsigned builds
    /// reject this mode at compile-time policy regardless of runtime input.
    #[arg(long, requires = "apply_core")]
    automatic_core_replacement: bool,
    /// Internal Desktop helper operation for the authoritative append-only
    /// activation registry. This interface is not a user-facing CLI command.
    #[arg(long, value_enum, conflicts_with = "apply_core", hide = true)]
    registry_action: Option<RegistryAction>,
    #[arg(long, requires = "registry_action", hide = true)]
    component_id: Option<String>,
    #[arg(long, requires = "registry_action", hide = true)]
    expected_revision: Option<u64>,
    /// Expected pending version for activate, or previous version for rollback.
    #[arg(long, requires = "registry_action", hide = true)]
    expected_version: Option<String>,
    /// Registry revision to restore. It must immediately precede the expected
    /// current revision and describe the directly reversed pointer mutation.
    #[arg(long, requires = "registry_action", hide = true)]
    restore_revision: Option<u64>,
    #[arg(long, requires = "registry_action", hide = true)]
    registry_revision: Option<u64>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("lyra-bootstrap: {error}");
        std::process::exit(1);
    }
}

fn run() -> lyra_bootstrap_core::Result<()> {
    let arguments = Arguments::parse();
    let target = arguments
        .target
        .as_deref()
        .map_or_else(Target::current, Target::parse)?;
    if arguments.apply_core {
        if arguments.wait_timeout_seconds == 0 {
            return Err(lyra_bootstrap_core::BootstrapError::Validation(
                "--wait-timeout-seconds must be greater than zero".to_string(),
            ));
        }
        let program_root = arguments.program_root.ok_or_else(|| {
            lyra_bootstrap_core::BootstrapError::Validation(
                "--program-root is required with --apply-core".to_string(),
            )
        })?;
        let mut config = CoreProjectionConfig::new(
            arguments.install_root,
            arguments.state_root,
            program_root,
            target,
        );
        config.wait_pids = arguments.wait_pid;
        config.wait_timeout = Duration::from_secs(arguments.wait_timeout_seconds);
        config.mode = if arguments.automatic_core_replacement {
            CoreProjectionMode::Automatic
        } else {
            CoreProjectionMode::Manual
        };
        let report = CoreProjector::new(config)?.project()?;
        let output = serde_json::to_string_pretty(&report).map_err(|error| {
            lyra_bootstrap_core::BootstrapError::Json("Core projection report", error)
        })?;
        println!("{output}");
        return Ok(());
    }

    if let Some(action) = arguments.registry_action {
        if action != RegistryAction::ReadRevision && arguments.registry_revision.is_some() {
            return Err(lyra_bootstrap_core::BootstrapError::Validation(
                "--registry-revision is only valid for registry action read-revision".to_string(),
            ));
        }
        let registry = match action {
            RegistryAction::Read => {
                reject_registry_mutation_arguments(&arguments)?;
                read_activation_registry(&arguments.state_root, &target)?
            }
            RegistryAction::ReadRevision => {
                if arguments.component_id.is_some()
                    || arguments.expected_revision.is_some()
                    || arguments.expected_version.is_some()
                    || arguments.restore_revision.is_some()
                {
                    return Err(lyra_bootstrap_core::BootstrapError::Validation(
                        "registry revision read does not accept mutation arguments".to_string(),
                    ));
                }
                read_activation_registry_revision(
                    &arguments.state_root,
                    &target,
                    required_argument(arguments.registry_revision, "--registry-revision", action)?,
                )?
            }
            RegistryAction::Activate => mutate_activation_registry(
                &arguments.state_root,
                &target,
                ActivationRegistryMutationV1::Activate {
                    component_id: required_argument(
                        arguments.component_id.as_deref(),
                        "--component-id",
                        action,
                    )?
                    .to_string(),
                    expected_revision: required_argument(
                        arguments.expected_revision,
                        "--expected-revision",
                        action,
                    )?,
                    expected_pending: required_argument(
                        arguments.expected_version.as_deref(),
                        "--expected-version",
                        action,
                    )?
                    .to_string(),
                },
            )?,
            RegistryAction::Rollback => mutate_activation_registry(
                &arguments.state_root,
                &target,
                ActivationRegistryMutationV1::Rollback {
                    component_id: required_argument(
                        arguments.component_id.as_deref(),
                        "--component-id",
                        action,
                    )?
                    .to_string(),
                    expected_revision: required_argument(
                        arguments.expected_revision,
                        "--expected-revision",
                        action,
                    )?,
                    expected_previous: required_argument(
                        arguments.expected_version.as_deref(),
                        "--expected-version",
                        action,
                    )?
                    .to_string(),
                },
            )?,
            RegistryAction::Restore => mutate_activation_registry(
                &arguments.state_root,
                &target,
                ActivationRegistryMutationV1::Restore {
                    component_id: required_argument(
                        arguments.component_id.as_deref(),
                        "--component-id",
                        action,
                    )?
                    .to_string(),
                    expected_revision: required_argument(
                        arguments.expected_revision,
                        "--expected-revision",
                        action,
                    )?,
                    source_revision: required_argument(
                        arguments.restore_revision,
                        "--restore-revision",
                        action,
                    )?,
                },
            )?,
        };
        write_bounded_registry_json(&registry)?;
        return Ok(());
    }

    let catalog = arguments.catalog.ok_or_else(|| {
        lyra_bootstrap_core::BootstrapError::Validation(
            "--catalog is required when installing components".to_string(),
        )
    })?;
    if arguments.trusted_roots.is_empty() {
        return Err(lyra_bootstrap_core::BootstrapError::Validation(
            "at least one --trusted-root is required when installing components".to_string(),
        ));
    }
    let mut trusted_keys = TrustedKeys::new();
    for value in arguments.trusted_roots {
        let (key_id, key) = value.split_once('=').ok_or_else(|| {
            lyra_bootstrap_core::BootstrapError::Validation(
                "--trusted-root must use KEY_ID=BASE64".to_string(),
            )
        })?;
        trusted_keys.insert_base64(key_id, key)?;
    }
    let mut config = InstallerConfig::new(arguments.install_root, arguments.state_root, target);
    config.proxy = arguments.proxy;
    config.offline_bundle_root = arguments.offline_bundle;
    config.include_on_demand = arguments.include_on_demand;
    config.on_demand_component = arguments.on_demand_component;
    config.expected_catalog_sequence = arguments.expected_catalog_sequence;
    let installer = BootstrapInstaller::new(config, trusted_keys)?;
    let report = if arguments.json_progress {
        installer.install_with_progress(&catalog, arguments.release.as_deref(), |progress| {
            let event = serde_json::json!({ "type": "progress", "progress": progress });
            println!("{event}");
            let _ = io::stdout().flush();
            true
        })?
    } else {
        installer.install(&catalog, arguments.release.as_deref())?
    };
    if arguments.json_progress {
        println!(
            "{}",
            serde_json::json!({ "type": "complete", "report": report })
        );
    } else {
        let output = serde_json::to_string_pretty(&report)
            .map_err(|error| lyra_bootstrap_core::BootstrapError::Json("install report", error))?;
        println!("{output}");
    }
    Ok(())
}

fn required_argument<T>(
    value: Option<T>,
    name: &str,
    action: RegistryAction,
) -> lyra_bootstrap_core::Result<T> {
    value.ok_or_else(|| {
        lyra_bootstrap_core::BootstrapError::Validation(format!(
            "{name} is required for registry action {}",
            match action {
                RegistryAction::Read => "read",
                RegistryAction::ReadRevision => "read-revision",
                RegistryAction::Activate => "activate",
                RegistryAction::Rollback => "rollback",
                RegistryAction::Restore => "restore",
            }
        ))
    })
}

fn reject_registry_mutation_arguments(arguments: &Arguments) -> lyra_bootstrap_core::Result<()> {
    if arguments.component_id.is_some()
        || arguments.expected_revision.is_some()
        || arguments.expected_version.is_some()
        || arguments.restore_revision.is_some()
        || arguments.registry_revision.is_some()
    {
        return Err(lyra_bootstrap_core::BootstrapError::Validation(
            "registry read does not accept mutation arguments".to_string(),
        ));
    }
    Ok(())
}

fn write_bounded_registry_json(
    registry: &lyra_bootstrap_core::ActivationRegistryV1,
) -> lyra_bootstrap_core::Result<()> {
    let mut bytes = serde_json::to_vec(registry)
        .map_err(|error| lyra_bootstrap_core::BootstrapError::Json("activation registry", error))?;
    bytes.push(b'\n');
    if bytes.len() > MAX_REGISTRY_OUTPUT_BYTES {
        return Err(lyra_bootstrap_core::BootstrapError::Validation(
            "activation registry output exceeds the 4 MiB limit".to_string(),
        ));
    }
    io::stdout()
        .write_all(&bytes)
        .map_err(|source| lyra_bootstrap_core::BootstrapError::Io {
            path: PathBuf::from("stdout"),
            source,
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_install_command_does_not_require_projection_flags() {
        let arguments = Arguments::try_parse_from([
            "lyra-bootstrap",
            "--catalog",
            "https://releases.example/catalog.json",
            "--install-root",
            "/tmp/lyra-components",
            "--state-root",
            "/tmp/lyra-state",
            "--trusted-root",
            "root-1=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        ])
        .expect("install arguments");
        assert!(!arguments.apply_core);
        assert_eq!(arguments.wait_timeout_seconds, 300);
        assert_eq!(arguments.registry_action, None);
    }

    #[test]
    fn projection_command_needs_no_catalog_or_release_key() {
        let arguments = Arguments::try_parse_from([
            "lyra-bootstrap",
            "--apply-core",
            "--install-root",
            "/tmp/lyra-components",
            "--state-root",
            "/tmp/lyra-state",
            "--program-root",
            "/tmp/Lyra",
            "--wait-pid",
            "42",
        ])
        .expect("projection arguments");
        assert!(arguments.apply_core);
        assert_eq!(arguments.catalog, None);
        assert!(arguments.trusted_roots.is_empty());
        assert_eq!(arguments.wait_pid, [42]);
    }

    #[test]
    fn registry_command_needs_no_catalog_or_release_key() {
        let arguments = Arguments::try_parse_from([
            "lyra-bootstrap",
            "--registry-action",
            "activate",
            "--component-id",
            "lyra.images",
            "--expected-revision",
            "4",
            "--expected-version",
            "1.1.0",
            "--install-root",
            "/tmp/lyra-components",
            "--state-root",
            "/tmp/lyra-state",
        ])
        .expect("registry arguments");
        assert_eq!(arguments.registry_action, Some(RegistryAction::Activate));
        assert_eq!(arguments.catalog, None);
        assert!(arguments.trusted_roots.is_empty());
    }

    #[test]
    fn on_demand_install_is_explicitly_pinned_to_release_and_catalog_sequence() {
        let arguments = Arguments::try_parse_from([
            "lyra-bootstrap",
            "--catalog",
            "/tmp/verified-releases-v1/darwin-arm64/1.2.3/00000000000000000012/catalog.json",
            "--install-root",
            "/tmp/lyra-components",
            "--state-root",
            "/tmp/lyra-state",
            "--release",
            "1.2.3",
            "--on-demand-component",
            "lyra.resource.playwright",
            "--expected-catalog-sequence",
            "12",
            "--trusted-root",
            "root-1=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        ])
        .expect("on-demand arguments");
        assert_eq!(
            arguments.on_demand_component.as_deref(),
            Some("lyra.resource.playwright")
        );
        assert_eq!(arguments.expected_catalog_sequence, Some(12));
        assert_eq!(arguments.release.as_deref(), Some("1.2.3"));
    }
}
