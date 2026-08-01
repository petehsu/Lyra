use std::time::Duration;

use tempfile::TempDir;
use wasmtime::component::{Component, Linker};
use wasmtime_wasi::cli::WasiCliView;
use wasmtime_wasi::filesystem::WasiFilesystemView;
use wasmtime_wasi::p2::bindings::cli::environment;
use wasmtime_wasi::p2::bindings::filesystem::preopens;

use crate::host::{ExecutionTimer, build_engine, build_store};
use crate::{
    APP_DATA_READ_PERMISSION, APP_DATA_WRITE_PERMISSION, DirectoryAccess, HostError,
    TEMP_READ_PERMISSION, WasiComponentHost, WasiComponentPolicy, WasiDirectoryRoots,
    WasiExecutionLimits,
};

type TestResult<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;

#[test]
fn default_policy_inherits_nothing_and_opens_nothing() -> TestResult {
    let policy = WasiComponentPolicy::default();
    let resolved = policy.prepare()?;

    assert!(resolved.preopens.is_empty());
    assert!(!resolved.inherits_environment());
    assert!(!resolved.allows_network());

    let engine = build_engine()?;
    let mut store = build_store(&engine, &WasiExecutionLimits::default(), &resolved)?;
    let mut cli = store.data_mut().cli();
    assert!(environment::Host::get_environment(&mut cli)?.is_empty());
    assert!(environment::Host::get_arguments(&mut cli)?.is_empty());
    assert_eq!(environment::Host::initial_cwd(&mut cli)?, None);

    let mut filesystem = store.data_mut().filesystem();
    assert!(preopens::Host::get_directories(&mut filesystem)?.is_empty());
    Ok(())
}

#[test]
fn only_declared_app_data_and_temp_roots_are_preopened() -> TestResult {
    let root = TempDir::new()?;
    let app_data = root.path().join("app-data");
    let temporary = root.path().join("temporary");
    let policy = WasiComponentPolicy::from_manifest_permissions(
        [APP_DATA_READ_PERMISSION, TEMP_READ_PERMISSION],
        WasiDirectoryRoots {
            app_data: Some(app_data.clone()),
            temporary: Some(temporary.clone()),
        },
    )?;
    let resolved = policy.prepare()?;

    assert_eq!(resolved.preopens.len(), 2);
    assert_eq!(resolved.preopens[0].guest_path, "/app-data");
    assert_eq!(resolved.preopens[0].access, DirectoryAccess::ReadOnly);
    assert_eq!(resolved.preopens[1].guest_path, "/tmp");
    assert_eq!(resolved.preopens[1].access, DirectoryAccess::ReadOnly);
    assert!(app_data.is_dir());
    assert!(temporary.is_dir());

    let engine = build_engine()?;
    let mut store = build_store(&engine, &WasiExecutionLimits::default(), &resolved)?;
    let mut filesystem = store.data_mut().filesystem();
    let directories = preopens::Host::get_directories(&mut filesystem)?;
    let guest_paths = directories
        .into_iter()
        .map(|(_, guest_path)| guest_path)
        .collect::<Vec<_>>();
    assert_eq!(guest_paths, ["/app-data", "/tmp"]);
    Ok(())
}

#[test]
fn write_permission_implies_read_write_preopen() -> TestResult {
    let root = TempDir::new()?;
    let policy = WasiComponentPolicy::from_manifest_permissions(
        [APP_DATA_WRITE_PERMISSION],
        WasiDirectoryRoots {
            app_data: Some(root.path().join("app-data")),
            temporary: None,
        },
    )?;

    let resolved = policy.prepare()?;
    assert_eq!(resolved.preopens[0].access, DirectoryAccess::ReadWrite);
    Ok(())
}

#[test]
fn wasi_permission_typos_fail_closed_but_unrelated_permissions_are_ignored() -> TestResult {
    let result = WasiComponentPolicy::from_manifest_permissions(
        ["wasi:appdata.read"],
        WasiDirectoryRoots::default(),
    );
    assert!(matches!(result, Err(HostError::UnknownWasiPermission(_))));

    let policy = WasiComponentPolicy::from_manifest_permissions(
        ["clipboard-read", "network"],
        WasiDirectoryRoots::default(),
    )?;
    assert!(policy.permissions().next().is_none());
    assert!(!policy.prepare()?.allows_network());
    Ok(())
}

#[test]
fn granted_directory_requires_a_corresponding_host_root() -> TestResult {
    let policy = WasiComponentPolicy::from_manifest_permissions(
        [APP_DATA_READ_PERMISSION],
        WasiDirectoryRoots::default(),
    )?;

    assert!(matches!(
        policy.prepare(),
        Err(HostError::MissingDirectoryRoot("application data"))
    ));
    Ok(())
}

#[test]
fn overlapping_capability_roots_are_rejected() -> TestResult {
    let root = TempDir::new()?;
    let shared = root.path().join("shared");
    let policy = WasiComponentPolicy::from_manifest_permissions(
        [APP_DATA_READ_PERMISSION, TEMP_READ_PERMISSION],
        WasiDirectoryRoots {
            app_data: Some(shared.clone()),
            temporary: Some(shared),
        },
    )?;

    assert!(matches!(
        policy.prepare(),
        Err(HostError::OverlappingDirectoryRoots(_))
    ));
    Ok(())
}

#[test]
fn nested_capability_roots_are_rejected() -> TestResult {
    let root = TempDir::new()?;
    let app_data = root.path().join("app-data");
    let temporary = app_data.join("temporary");
    let policy = WasiComponentPolicy::from_manifest_permissions(
        [APP_DATA_READ_PERMISSION, TEMP_READ_PERMISSION],
        WasiDirectoryRoots {
            app_data: Some(app_data),
            temporary: Some(temporary),
        },
    )?;

    assert!(matches!(
        policy.prepare(),
        Err(HostError::OverlappingDirectoryRoots(_))
    ));
    Ok(())
}

#[cfg(unix)]
#[test]
fn symlinked_capability_root_is_rejected() -> TestResult {
    use std::os::unix::fs::symlink;

    let root = TempDir::new()?;
    let real = root.path().join("real");
    std::fs::create_dir(&real)?;
    let linked = root.path().join("linked");
    symlink(&real, &linked)?;
    let policy = WasiComponentPolicy::from_manifest_permissions(
        [APP_DATA_READ_PERMISSION],
        WasiDirectoryRoots {
            app_data: Some(linked),
            temporary: None,
        },
    )?;

    assert!(matches!(
        policy.prepare(),
        Err(HostError::InvalidDirectoryRoot { .. })
    ));
    Ok(())
}

#[test]
fn zero_resource_limits_are_rejected() {
    let limits = WasiExecutionLimits {
        fuel: 0,
        ..WasiExecutionLimits::default()
    };
    assert!(matches!(
        WasiComponentHost::new(limits),
        Err(HostError::InvalidLimit("fuel"))
    ));
}

#[test]
fn component_size_is_checked_before_compilation() -> TestResult {
    let limits = WasiExecutionLimits {
        max_component_bytes: 1,
        ..WasiExecutionLimits::default()
    };
    let host = WasiComponentHost::new(limits)?;

    assert!(matches!(
        host.run_component(&[0, 1], &WasiComponentPolicy::default()),
        Err(HostError::ComponentTooLarge {
            actual: 2,
            maximum: 1
        })
    ));
    Ok(())
}

#[test]
fn component_memory_is_bounded_by_store_limits() -> TestResult {
    let limits = WasiExecutionLimits {
        max_memory_bytes: 64 * 1024,
        ..WasiExecutionLimits::default()
    };
    let (result, _) = instantiate_test_component(
        r#"(component
              (core module $module (memory 2))
              (core instance (instantiate $module))
            )"#,
        &limits,
    )?;

    assert!(result.is_err());
    Ok(())
}

#[test]
fn component_execution_is_stopped_when_fuel_is_exhausted() -> TestResult {
    let limits = WasiExecutionLimits {
        fuel: 1_000,
        timeout: Duration::from_secs(5),
        ..WasiExecutionLimits::default()
    };
    let (result, timed_out) = instantiate_test_component(infinite_start_component(), &limits)?;

    assert!(result.is_err());
    assert!(
        !timed_out,
        "fuel should trap before the wall-clock deadline"
    );
    Ok(())
}

#[test]
fn component_execution_is_stopped_at_wall_clock_deadline() -> TestResult {
    let limits = WasiExecutionLimits {
        fuel: u64::MAX,
        timeout: Duration::from_millis(20),
        ..WasiExecutionLimits::default()
    };
    let (result, timed_out) = instantiate_test_component(infinite_start_component(), &limits)?;

    assert!(result.is_err());
    assert!(timed_out, "epoch timer should interrupt the component");
    Ok(())
}

fn infinite_start_component() -> &'static str {
    r#"(component
          (core module $module
            (func $start
              (loop $forever
                br $forever))
            (start $start))
          (core instance (instantiate $module))
        )"#
}

fn instantiate_test_component(
    source: &str,
    limits: &WasiExecutionLimits,
) -> TestResult<(crate::Result<()>, bool)> {
    let bytes = wat::parse_str(source)?;
    let engine = build_engine()?;
    let component = Component::new(&engine, bytes)?;
    let linker = Linker::new(&engine);
    let policy = WasiComponentPolicy::default().prepare()?;
    let mut store = build_store(&engine, limits, &policy)?;
    let timer = ExecutionTimer::arm(engine, limits.timeout)?;
    let result = linker
        .instantiate(&mut store, &component)
        .map(|_| ())
        .map_err(HostError::Runtime);
    let timed_out = timer.finish();
    Ok((result, timed_out))
}
