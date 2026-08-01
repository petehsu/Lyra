use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use fs2::FileExt;
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sysinfo::{Pid, System};
use uuid::Uuid;

use crate::archive::{ExtractionLimits, INSTALLED_MARKER, extract_verified, verified_inventory};
use crate::download::sha256_file;
use crate::model::{ActivationRegistryV1, ComponentManifestV1, InstalledComponentV1};
use crate::registry::{commit_activation_registry, read_activation_registry};
use crate::{BootstrapError, Result, Target};

mod support;

use support::*;

const CORE_COMPONENT_ID: &str = "lyra.core";
const CORE_PROJECTION_ENTRY: &str = "projection.json";
const CORE_PAYLOAD_ENTRY: &str = "payload.zip";
const PROJECTION_STATE_DIRECTORY: &str = "core-projection-v1";
const PROJECTION_COMMITS_DIRECTORY: &str = "commits";
const MAX_COMPONENT_MARKER_BYTES: u64 = 4 * 1024 * 1024;
const MAX_COMPONENT_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PROJECTION_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_PROJECTION_MARKER_BYTES: u64 = 64 * 1024;

/// Automatic Core replacement is deliberately a compile-time release
/// capability. Beta builds without platform signing can still be installed or
/// repaired manually, but cannot turn on automatic replacement with a runtime
/// flag. Signed release jobs must explicitly set this value while compiling
/// the helper after their platform-signing gate has passed.
pub fn system_signed_core_replacement_enabled() -> bool {
    matches!(
        option_env!("LYRA_SYSTEM_SIGNED_CORE_REPLACEMENT"),
        Some("1")
    )
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CoreProjectionMode {
    Manual,
    Automatic,
}

#[derive(Clone, Debug)]
pub struct CoreProjectionConfig {
    /// Scope root containing `components/<id>/<version>/<target>`.
    pub component_root: PathBuf,
    /// Scope root containing the append-only bootstrap activation registry.
    pub state_root: PathBuf,
    /// Fixed OS-visible application directory, for example `Lyra.app`.
    pub program_root: PathBuf,
    pub target: Target,
    /// The launching Lyra PID and any additional processes that must exit.
    /// Descendants are discovered while waiting. Program-root executables are
    /// also detected independently, so a PID list is not the only safeguard.
    pub wait_pids: Vec<u32>,
    pub wait_timeout: Duration,
    pub poll_interval: Duration,
    pub mode: CoreProjectionMode,
    pub extraction_limits: ExtractionLimits,
}

impl CoreProjectionConfig {
    pub fn new(
        component_root: PathBuf,
        state_root: PathBuf,
        program_root: PathBuf,
        target: Target,
    ) -> Self {
        Self {
            component_root,
            state_root,
            program_root,
            target,
            wait_pids: Vec::new(),
            wait_timeout: Duration::from_secs(5 * 60),
            poll_interval: Duration::from_millis(200),
            mode: CoreProjectionMode::Manual,
            extraction_limits: ExtractionLimits::default(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreProjectionReport {
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_version: Option<String>,
    pub target: String,
    pub program_root: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_projection_root: Option<PathBuf>,
    pub registry_revision: u64,
    pub changed: bool,
    pub recovered_transaction: bool,
    pub automatic_replacement_enabled: bool,
}

#[derive(Debug)]
pub struct CoreProjector {
    config: CoreProjectionConfig,
}

impl CoreProjector {
    pub fn new(config: CoreProjectionConfig) -> Result<Self> {
        validate_absolute_non_root("component root", &config.component_root)?;
        validate_absolute_non_root("state root", &config.state_root)?;
        validate_absolute_non_root("program root", &config.program_root)?;
        if config.wait_timeout.is_zero()
            || config.poll_interval.is_zero()
            || config.poll_interval > config.wait_timeout
        {
            return Err(BootstrapError::Validation(
                "Core projection wait intervals are invalid".to_string(),
            ));
        }
        if config.wait_pids.contains(&0) {
            return Err(BootstrapError::Validation(
                "Core projection wait PIDs must be positive".to_string(),
            ));
        }
        Ok(Self { config })
    }

    pub fn project(&self) -> Result<CoreProjectionReport> {
        fs::create_dir_all(&self.config.state_root)
            .map_err(|error| BootstrapError::io(&self.config.state_root, error))?;
        let program_parent = self.program_parent()?;
        fs::create_dir_all(program_parent)
            .map_err(|error| BootstrapError::io(program_parent, error))?;
        require_real_directory(&self.config.component_root, "component root")?;
        require_real_directory(&self.config.state_root, "state root")?;
        require_real_directory(program_parent, "program parent")?;

        let bootstrap_lock_path = self.config.state_root.join("bootstrap.lock");
        let bootstrap_lock = open_lock(&bootstrap_lock_path)?;
        bootstrap_lock
            .lock_exclusive()
            .map_err(|error| BootstrapError::io(&bootstrap_lock_path, error))?;

        let program_lock_path = program_parent.join(format!(
            ".lyra-core-projection-{}.lock",
            self.program_identity()
        ));
        let program_lock = match open_lock(&program_lock_path).and_then(|file| {
            file.lock_exclusive()
                .map_err(|error| BootstrapError::io(&program_lock_path, error))?;
            Ok(file)
        }) {
            Ok(file) => file,
            Err(error) => {
                let _ = FileExt::unlock(&bootstrap_lock);
                return Err(error);
            }
        };

        let outcome = self.project_locked();
        let program_unlock = FileExt::unlock(&program_lock)
            .map_err(|error| BootstrapError::io(&program_lock_path, error));
        let bootstrap_unlock = FileExt::unlock(&bootstrap_lock)
            .map_err(|error| BootstrapError::io(&bootstrap_lock_path, error));
        match outcome {
            Ok(report) => {
                program_unlock?;
                bootstrap_unlock?;
                Ok(report)
            }
            Err(error) => Err(error),
        }
    }

    fn project_locked(&self) -> Result<CoreProjectionReport> {
        let recovered_transaction = self.recover_interrupted_transaction()?;
        self.cleanup_orphan_stages()?;

        let registry = read_activation_registry(&self.config.state_root, &self.config.target)?;
        let (version, pending) = selected_core_version(&registry)?;
        let source = self.verify_installed_core(&version)?;
        let current_commit = self.read_projection_commit()?;
        let current_marker = if path_exists(&self.config.program_root)? {
            match current_commit.as_ref() {
                Some(commit) => match self.verify_program_against_marker(&commit.active, None) {
                    Ok(()) => Some(commit.active.clone()),
                    Err(_) if self.config.mode == CoreProjectionMode::Manual => None,
                    Err(error) => return Err(error),
                },
                None if self.config.mode == CoreProjectionMode::Manual => None,
                None => {
                    return Err(BootstrapError::Trust(
                        "automatic Core replacement requires a verified existing projection"
                            .to_string(),
                    ));
                }
            }
        } else {
            None
        };

        if current_marker
            .as_ref()
            .map(|marker| marker.version.as_str())
            == Some(version.as_str())
        {
            let registry = if pending {
                let registry = self.commit_core_activation(&version, false)?;
                let marker = current_marker.as_ref().expect("matching marker exists");
                self.record_projection_commit(
                    registry.revision,
                    marker,
                    current_commit
                        .as_ref()
                        .and_then(|commit| commit.previous.as_ref()),
                )?;
                registry
            } else {
                registry
            };
            return Ok(self.report(
                version,
                current_marker.and_then(|marker| marker.previous_version),
                registry.revision,
                false,
                recovered_transaction,
            ));
        }

        let had_program = path_exists(&self.config.program_root)?;
        if had_program {
            require_real_directory(&self.config.program_root, "program root")?;
            self.require_replacement_authorized()?;
            self.require_helper_outside_program()?;
        }

        let previous_version = current_marker.as_ref().map(|marker| marker.version.clone());
        let transaction = self.prepare_projection(&source, had_program, current_marker)?;
        self.write_transaction(&transaction)?;

        if had_program || !self.config.wait_pids.is_empty() {
            if let Err(error) = self.wait_until_exit() {
                let cleanup = self.abandon_unstarted_transaction(&transaction);
                return match cleanup {
                    Ok(()) => Err(error),
                    Err(cleanup_error) => Err(BootstrapError::Validation(format!(
                        "{error}; failed to discard staged Core projection: {cleanup_error}"
                    ))),
                };
            }
        }

        let registry = self.switch_and_commit(&transaction)?;
        Ok(self.report(
            version,
            previous_version,
            registry.revision,
            true,
            recovered_transaction,
        ))
    }

    fn report(
        &self,
        version: String,
        previous_version: Option<String>,
        registry_revision: u64,
        changed: bool,
        recovered_transaction: bool,
    ) -> CoreProjectionReport {
        let previous_root = self.previous_root();
        CoreProjectionReport {
            version,
            previous_version,
            target: self.config.target.as_str().to_string(),
            program_root: self.config.program_root.clone(),
            previous_projection_root: previous_root.exists().then_some(previous_root),
            registry_revision,
            changed,
            recovered_transaction,
            automatic_replacement_enabled: system_signed_core_replacement_enabled(),
        }
    }

    fn require_replacement_authorized(&self) -> Result<()> {
        if self.config.mode == CoreProjectionMode::Automatic
            && !system_signed_core_replacement_enabled()
        {
            return Err(BootstrapError::Trust(
                "automatic Core replacement is disabled because this build has no verified system signing capability"
                    .to_string(),
            ));
        }
        Ok(())
    }

    fn require_helper_outside_program(&self) -> Result<()> {
        let executable = std::env::current_exe()
            .map_err(|error| BootstrapError::io("current executable", error))?;
        let executable = fs::canonicalize(&executable)
            .map_err(|error| BootstrapError::io(&executable, error))?;
        let program = fs::canonicalize(&self.config.program_root)
            .map_err(|error| BootstrapError::io(&self.config.program_root, error))?;
        if executable.starts_with(&program) {
            return Err(BootstrapError::Validation(
                "the Core projection helper must be copied outside the program directory before replacement"
                    .to_string(),
            ));
        }
        Ok(())
    }

    fn verify_installed_core(&self, version: &str) -> Result<VerifiedCoreSource> {
        Version::parse(version).map_err(|error| {
            BootstrapError::Validation(format!("invalid Core version `{version}`: {error}"))
        })?;
        let root = self
            .config
            .component_root
            .join("components")
            .join(CORE_COMPONENT_ID)
            .join(version)
            .join(self.config.target.as_str());
        require_real_directory(&root, "installed Core component")?;

        let marker_path = root.join(INSTALLED_MARKER);
        let marker_bytes = read_bounded_regular_file(
            &marker_path,
            MAX_COMPONENT_MARKER_BYTES,
            "installed Core marker",
        )?;
        let marker: InstalledComponentV1 = serde_json::from_slice(&marker_bytes)
            .map_err(|error| BootstrapError::Json("installed Core marker", error))?;
        if marker.schema_version != 1
            || marker.component_id != CORE_COMPONENT_ID
            || marker.version != version
            || marker.target != self.config.target.as_str()
            || !is_sha256(&marker.archive_sha256)
        {
            return Err(BootstrapError::Trust(format!(
                "installed Core identity is invalid for {CORE_COMPONENT_ID}@{version}"
            )));
        }
        verify_installed_inventory(&root, &marker.files)?;

        let manifest_path = root.join("component.json");
        let manifest_bytes = read_bounded_regular_file(
            &manifest_path,
            MAX_COMPONENT_MANIFEST_BYTES,
            "Core component manifest",
        )?;
        let manifest: ComponentManifestV1 = serde_json::from_slice(&manifest_bytes)
            .map_err(|error| BootstrapError::Json("Core component manifest", error))?;
        validate_core_manifest(&manifest, version, &self.config.target, &marker.files)?;

        let projection_path = root.join(CORE_PROJECTION_ENTRY);
        let projection_bytes = read_bounded_regular_file(
            &projection_path,
            MAX_PROJECTION_MANIFEST_BYTES,
            "Core projection manifest",
        )?;
        let projection: CoreProjectionManifestV1 = serde_json::from_slice(&projection_bytes)
            .map_err(|error| BootstrapError::Json("Core projection manifest", error))?;
        if projection.schema_version != 1
            || projection.format != "zip"
            || projection.payload != CORE_PAYLOAD_ENTRY
            || projection.target != self.config.target.as_str()
        {
            return Err(BootstrapError::Validation(format!(
                "Core projection manifest is invalid for {}",
                self.config.target.as_str()
            )));
        }
        let payload = manifest
            .files
            .iter()
            .find(|file| file.path == projection.payload)
            .ok_or_else(|| {
                BootstrapError::Trust(
                    "Core projection payload is not in the signed component inventory".to_string(),
                )
            })?;
        let payload_path = root.join(&projection.payload);
        let payload_metadata = fs::symlink_metadata(&payload_path)
            .map_err(|error| BootstrapError::io(&payload_path, error))?;
        if payload_metadata.file_type().is_symlink()
            || !payload_metadata.is_file()
            || payload_metadata.len() != payload.size
            || sha256_file(&payload_path)? != payload.sha256
        {
            return Err(BootstrapError::Trust(
                "installed Core projection payload failed its signed digest check".to_string(),
            ));
        }
        Ok(VerifiedCoreSource {
            version: version.to_string(),
            payload_path,
            payload_sha256: payload.sha256.clone(),
            component_archive_sha256: marker.archive_sha256,
        })
    }

    fn prepare_projection(
        &self,
        source: &VerifiedCoreSource,
        had_program: bool,
        previous_projection: Option<ProjectedCoreMarkerV1>,
    ) -> Result<ProjectionTransactionV1> {
        let transaction_id = Uuid::new_v4();
        let stage_name = format!(
            ".lyra-core-stage-{}-{transaction_id}",
            self.program_identity()
        );
        let stage_root = self.program_parent()?.join(&stage_name);
        if path_exists(&stage_root)? {
            return Err(BootstrapError::Validation(
                "Core projection staging path already exists".to_string(),
            ));
        }

        let expected_inventory = verified_inventory(
            &source.payload_path,
            &source.payload_sha256,
            self.config.extraction_limits,
        )?;
        let required = expected_inventory.iter().try_fold(0_u64, |total, file| {
            total.checked_add(file.size).ok_or_else(|| {
                BootstrapError::Validation("Core projection size overflow".to_string())
            })
        })?;
        let program_parent = self.program_parent()?;
        let available = fs2::available_space(program_parent)
            .map_err(|error| BootstrapError::io(program_parent, error))?;
        if available < required {
            return Err(BootstrapError::InsufficientSpace {
                available,
                required,
            });
        }

        let extracted = match extract_verified(
            &source.payload_path,
            &source.payload_sha256,
            &stage_root,
            self.config.extraction_limits,
        ) {
            Ok(inventory) => inventory,
            Err(error) => {
                let _ = remove_real_directory_if_exists(&stage_root);
                return Err(error);
            }
        };
        if extracted != expected_inventory {
            remove_real_directory_if_exists(&stage_root)?;
            return Err(BootstrapError::Archive(
                "Core payload inventory changed during extraction".to_string(),
            ));
        }
        let inventory_sha256 = inventory_digest(&extracted)?;
        let projection_marker = ProjectedCoreMarkerV1 {
            schema_version: 1,
            component_id: CORE_COMPONENT_ID.to_string(),
            version: source.version.clone(),
            previous_version: previous_projection
                .as_ref()
                .map(|projection| projection.version.clone()),
            target: self.config.target.as_str().to_string(),
            component_archive_sha256: source.component_archive_sha256.clone(),
            payload_sha256: source.payload_sha256.clone(),
            file_count: extracted.len(),
            inventory_sha256,
        };
        sync_directory(&stage_root)?;

        Ok(ProjectionTransactionV1 {
            schema_version: 1,
            transaction_id: transaction_id.to_string(),
            program_identity: self.program_identity(),
            target: self.config.target.as_str().to_string(),
            version: source.version.clone(),
            stage_name,
            previous_name: self
                .previous_root()
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| {
                    BootstrapError::Validation(
                        "Core previous projection path is not valid UTF-8".to_string(),
                    )
                })?
                .to_string(),
            had_program,
            mode: self.config.mode,
            projection: projection_marker,
            previous_projection,
        })
    }

    fn switch_and_commit(
        &self,
        transaction: &ProjectionTransactionV1,
    ) -> Result<ActivationRegistryV1> {
        let stage_root = self.stage_root(transaction)?;
        let previous_root = self.previous_root();
        if path_exists(&previous_root)? {
            remove_real_directory_if_exists(&previous_root)?;
            sync_directory(self.program_parent()?)?;
        }

        let mut old_moved = false;
        if transaction.had_program {
            require_real_directory(&self.config.program_root, "program root")?;
            fs::rename(&self.config.program_root, &previous_root)
                .map_err(|error| BootstrapError::io(&self.config.program_root, error))?;
            old_moved = true;
            sync_directory(self.program_parent()?)?;
        } else if path_exists(&self.config.program_root)? {
            return Err(BootstrapError::Validation(
                "program directory appeared while Core was being staged".to_string(),
            ));
        }

        if let Err(error) = fs::rename(&stage_root, &self.config.program_root) {
            let projection_error = BootstrapError::io(&self.config.program_root, error);
            if old_moved {
                fs::rename(&previous_root, &self.config.program_root)
                    .map_err(|rollback| BootstrapError::Validation(format!(
                        "{projection_error}; failed to restore the previous Core projection: {rollback}"
                    )))?;
                sync_directory(self.program_parent()?)?;
            }
            self.clear_transaction()?;
            return Err(projection_error);
        }
        sync_directory(self.program_parent()?)?;

        let finish = (|| {
            self.verify_program_against_marker(
                &transaction.projection,
                Some(&transaction.version),
            )?;
            let registry = self.commit_core_activation(&transaction.version, true)?;
            self.record_projection_commit(
                registry.revision,
                &transaction.projection,
                transaction.previous_projection.as_ref(),
            )?;
            Ok(registry)
        })();

        let registry = match finish {
            Ok(registry) => registry,
            Err(error) => {
                if self.registry_has_active_core(&transaction.version)? {
                    let registry =
                        read_activation_registry(&self.config.state_root, &self.config.target)?;
                    self.record_projection_commit(
                        registry.revision,
                        &transaction.projection,
                        transaction.previous_projection.as_ref(),
                    )?;
                    self.clear_transaction()?;
                    return Ok(registry);
                }
                self.rollback_program_switch(transaction)?;
                return Err(error);
            }
        };
        self.clear_transaction()?;
        Ok(registry)
    }

    fn rollback_program_switch(&self, transaction: &ProjectionTransactionV1) -> Result<()> {
        let discard = self.program_parent()?.join(format!(
            ".lyra-core-discard-{}-{}",
            self.program_identity(),
            transaction.transaction_id
        ));
        if path_exists(&discard)? {
            remove_real_directory_if_exists(&discard)?;
        }
        if path_exists(&self.config.program_root)? {
            require_real_directory(&self.config.program_root, "new Core projection")?;
            fs::rename(&self.config.program_root, &discard)
                .map_err(|error| BootstrapError::io(&self.config.program_root, error))?;
        }
        let previous = self.previous_root();
        if transaction.had_program {
            if !path_exists(&previous)? {
                if path_exists(&discard)? {
                    let _ = fs::rename(&discard, &self.config.program_root);
                }
                return Err(BootstrapError::Validation(
                    "cannot roll back Core because the previous projection is missing".to_string(),
                ));
            }
            if let Err(error) = fs::rename(&previous, &self.config.program_root) {
                if path_exists(&discard)? && !path_exists(&self.config.program_root)? {
                    let _ = fs::rename(&discard, &self.config.program_root);
                }
                return Err(BootstrapError::io(&self.config.program_root, error));
            }
        }
        sync_directory(self.program_parent()?)?;
        remove_real_directory_if_exists(&discard)?;
        let stage = self.stage_root(transaction)?;
        remove_real_directory_if_exists(&stage)?;
        self.clear_transaction()
    }

    fn commit_core_activation(
        &self,
        version: &str,
        force_projection_revision: bool,
    ) -> Result<ActivationRegistryV1> {
        let mut registry = read_activation_registry(&self.config.state_root, &self.config.target)?;
        let state = registry.components.get(CORE_COMPONENT_ID).ok_or_else(|| {
            BootstrapError::Validation("Core is missing from the activation registry".to_string())
        })?;
        if state.active.as_deref() == Some(version) && state.pending.is_none() {
            return if force_projection_revision {
                commit_activation_registry(&self.config.state_root, &self.config.target, registry)
            } else {
                Ok(registry)
            };
        }
        if state.pending.as_deref() != Some(version) {
            return Err(BootstrapError::Validation(format!(
                "Core projection {version} is neither active nor pending"
            )));
        }
        let state = registry
            .components
            .get_mut(CORE_COMPONENT_ID)
            .expect("Core state was checked above");
        if state.active.as_deref() != Some(version) {
            state.previous = state.active.take();
            state.active = Some(version.to_string());
        }
        state.pending = None;
        reconcile_release_pointer(&mut registry);
        commit_activation_registry(&self.config.state_root, &self.config.target, registry)
    }

    fn registry_has_active_core(&self, version: &str) -> Result<bool> {
        let registry = read_activation_registry(&self.config.state_root, &self.config.target)?;
        Ok(registry
            .components
            .get(CORE_COMPONENT_ID)
            .is_some_and(|state| {
                state.active.as_deref() == Some(version) && state.pending.is_none()
            }))
    }

    /// Verifies that the configured roots contain one internally consistent
    /// modular Lyra installation before an uninstaller removes any files.
    ///
    /// Requiring both the append-only activation registry and the installed
    /// Core inventory prevents an arbitrary absolute directory from becoming
    /// a deletion target merely because it was passed on the command line.
    pub fn verify_installation_for_removal(&self) -> Result<()> {
        require_real_directory(&self.config.component_root, "component root")?;
        require_real_directory(&self.config.state_root, "state root")?;
        let registry = read_activation_registry(&self.config.state_root, &self.config.target)?;
        if registry.revision == 0
            || registry.keyring_sequence == 0
            || registry.catalog_sequence == 0
        {
            return Err(BootstrapError::Trust(
                "the selected paths do not contain a committed Lyra installation".to_string(),
            ));
        }
        let core = registry.components.get(CORE_COMPONENT_ID).ok_or_else(|| {
            BootstrapError::Trust(
                "the selected activation registry does not contain Lyra Core".to_string(),
            )
        })?;
        let version = core
            .active
            .as_deref()
            .or(core.pending.as_deref())
            .or(core.previous.as_deref())
            .ok_or_else(|| {
                BootstrapError::Trust(
                    "the selected activation registry has no installed Lyra Core version"
                        .to_string(),
                )
            })?;
        self.verify_installed_core(version)?;

        if path_exists(&self.config.program_root)? {
            require_real_directory(&self.config.program_root, "program root")?;
            let commit = self.read_projection_commit()?.ok_or_else(|| {
                BootstrapError::Trust(
                    "the projected Core has no committed Lyra projection record".to_string(),
                )
            })?;
            self.verify_program_against_marker(&commit.active, None)?;
        }
        Ok(())
    }

    /// Waits until every process launched from the projected Core (and its
    /// observed descendants), or from an installed component, has exited.
    /// Installers and uninstallers use the same process-safe boundary as Core
    /// replacement.
    pub fn wait_until_exit(&self) -> Result<()> {
        let mut executable_roots = Vec::new();
        for (path, label) in [
            (&self.config.program_root, "program root"),
            (
                &self.config.component_root.join("components"),
                "component store",
            ),
        ] {
            if path_exists(path)? {
                require_real_directory(path, label)?;
                executable_roots
                    .push(fs::canonicalize(path).map_err(|error| BootstrapError::io(path, error))?);
            }
        }
        let own_pid = std::process::id();
        let started = Instant::now();
        let mut observed = BTreeMap::<u32, u64>::new();
        let mut quiescent_observations = 0_u8;

        loop {
            let system = System::new_all();
            for pid in &self.config.wait_pids {
                if *pid == own_pid || observed.contains_key(pid) {
                    continue;
                }
                if let Some(process) = system.process(Pid::from_u32(*pid)) {
                    observed.insert(*pid, process.start_time());
                }
            }
            for (pid, process) in system.processes() {
                let pid = pid.as_u32();
                if pid == own_pid {
                    continue;
                }
                if process.exe().is_some_and(|executable| {
                    executable_roots
                        .iter()
                        .any(|root| executable_is_under(executable, root))
                }) {
                    observed.entry(pid).or_insert_with(|| process.start_time());
                }
            }

            loop {
                let alive_parents = observed
                    .iter()
                    .filter_map(|(pid, start_time)| {
                        system
                            .process(Pid::from_u32(*pid))
                            .filter(|process| process.start_time() == *start_time)
                            .map(|_| *pid)
                    })
                    .collect::<HashSet<_>>();
                let mut changed = false;
                for (pid, process) in system.processes() {
                    let pid = pid.as_u32();
                    if pid == own_pid || observed.contains_key(&pid) {
                        continue;
                    }
                    if process
                        .parent()
                        .is_some_and(|parent| alive_parents.contains(&parent.as_u32()))
                    {
                        observed.insert(pid, process.start_time());
                        changed = true;
                    }
                }
                if !changed {
                    break;
                }
            }

            let alive = observed.iter().any(|(pid, start_time)| {
                system
                    .process(Pid::from_u32(*pid))
                    .is_some_and(|process| process.start_time() == *start_time)
            });
            if alive {
                quiescent_observations = 0;
            } else {
                quiescent_observations = quiescent_observations.saturating_add(1);
                if quiescent_observations >= 2 {
                    return Ok(());
                }
            }
            if started.elapsed() >= self.config.wait_timeout {
                let pids = observed
                    .iter()
                    .filter_map(|(pid, start_time)| {
                        system
                            .process(Pid::from_u32(*pid))
                            .filter(|process| process.start_time() == *start_time)
                            .map(|_| pid.to_string())
                    })
                    .collect::<Vec<_>>();
                return Err(BootstrapError::Validation(format!(
                    "timed out waiting for Lyra to exit{}",
                    if pids.is_empty() {
                        String::new()
                    } else {
                        format!(" (still running: {})", pids.join(", "))
                    }
                )));
            }
            thread::sleep(self.config.poll_interval);
        }
    }

    #[cfg(test)]
    fn verify_program_projection(
        &self,
        expected_version: Option<&str>,
    ) -> Result<Option<ProjectedCoreMarkerV1>> {
        if !path_exists(&self.config.program_root)? {
            return Ok(None);
        }
        require_real_directory(&self.config.program_root, "program root")?;
        let Some(commit) = self.read_projection_commit()? else {
            return Ok(None);
        };
        self.verify_program_against_marker(&commit.active, expected_version)?;
        Ok(Some(commit.active))
    }

    fn verify_program_against_marker(
        &self,
        marker: &ProjectedCoreMarkerV1,
        expected_version: Option<&str>,
    ) -> Result<()> {
        validate_projection_marker(marker, &self.config.target)?;
        if expected_version.is_some_and(|version| marker.version != version) {
            return Err(BootstrapError::Trust(format!(
                "projected Core version {} does not match the expected version {}",
                marker.version,
                expected_version.unwrap_or_default()
            )));
        }
        let inventory = collect_regular_inventory(&self.config.program_root, None)?;
        if inventory.len() != marker.file_count
            || inventory_digest(&inventory)? != marker.inventory_sha256
        {
            return Err(BootstrapError::Trust(
                "projected Core files do not match the committed projection inventory".to_string(),
            ));
        }
        Ok(())
    }

    fn read_projection_commit(&self) -> Result<Option<ProjectionCommitV1>> {
        let directory = self
            .projection_state_root()
            .join(PROJECTION_COMMITS_DIRECTORY)
            .join(self.program_identity());
        if !path_exists(&directory)? {
            return Ok(None);
        }
        require_real_directory(&directory, "Core projection commits")?;
        let mut candidates = Vec::new();
        for entry in
            fs::read_dir(&directory).map_err(|error| BootstrapError::io(&directory, error))?
        {
            let entry = entry.map_err(|error| BootstrapError::io(&directory, error))?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            let Some(value) = name
                .strip_prefix("projection-")
                .and_then(|value| value.strip_suffix(".json"))
            else {
                continue;
            };
            let Some((revision, transaction)) = value.split_once('-') else {
                continue;
            };
            if revision.len() != 20 || Uuid::parse_str(transaction).is_err() {
                continue;
            }
            let Ok(revision) = revision.parse::<u64>() else {
                continue;
            };
            candidates.push((revision, entry.path()));
        }
        if candidates.is_empty() {
            return Ok(None);
        }
        candidates.sort_by_key(|(revision, _)| *revision);
        let highest = candidates
            .last()
            .map(|(revision, _)| *revision)
            .unwrap_or(0);
        if candidates
            .iter()
            .filter(|(revision, _)| *revision == highest)
            .count()
            != 1
        {
            return Err(BootstrapError::Validation(format!(
                "multiple Core projection commits have registry revision {highest}"
            )));
        }
        let path = &candidates.last().expect("candidate exists").1;
        let bytes =
            read_bounded_regular_file(path, MAX_PROJECTION_MARKER_BYTES, "Core projection commit")?;
        let commit: ProjectionCommitV1 = serde_json::from_slice(&bytes)
            .map_err(|error| BootstrapError::Json("Core projection commit", error))?;
        self.validate_projection_commit(&commit, highest)?;
        Ok(Some(commit))
    }

    fn validate_projection_commit(&self, commit: &ProjectionCommitV1, revision: u64) -> Result<()> {
        if commit.schema_version != 1
            || commit.registry_revision != revision
            || commit.program_identity != self.program_identity()
        {
            return Err(BootstrapError::Validation(
                "Core projection commit does not match this installation".to_string(),
            ));
        }
        validate_projection_marker(&commit.active, &self.config.target)?;
        if let Some(previous) = commit.previous.as_ref() {
            validate_projection_marker(previous, &self.config.target)?;
        }
        Ok(())
    }

    fn record_projection_commit(
        &self,
        registry_revision: u64,
        active: &ProjectedCoreMarkerV1,
        previous: Option<&ProjectedCoreMarkerV1>,
    ) -> Result<()> {
        validate_projection_marker(active, &self.config.target)?;
        if let Some(previous) = previous {
            validate_projection_marker(previous, &self.config.target)?;
        }
        let next = ProjectionCommitV1 {
            schema_version: 1,
            registry_revision,
            program_identity: self.program_identity(),
            active: active.clone(),
            previous: previous.cloned(),
        };
        if let Some(current) = self.read_projection_commit()? {
            if current.registry_revision > registry_revision {
                return Err(BootstrapError::Validation(format!(
                    "Core projection commit revision {} is newer than registry revision {registry_revision}",
                    current.registry_revision
                )));
            }
            if current.registry_revision == registry_revision {
                if current == next {
                    return Ok(());
                }
                return Err(BootstrapError::Validation(format!(
                    "Core projection registry revision {registry_revision} already has different content"
                )));
            }
        }
        let directory = self
            .projection_state_root()
            .join(PROJECTION_COMMITS_DIRECTORY)
            .join(self.program_identity());
        fs::create_dir_all(&directory).map_err(|error| BootstrapError::io(&directory, error))?;
        require_real_directory(&directory, "Core projection commits")?;
        let id = Uuid::new_v4();
        let final_path = directory.join(format!("projection-{registry_revision:020}-{id}.json"));
        let temporary = directory.join(format!(".projection-{id}.tmp"));
        write_new_json(&temporary, &next, "Core projection commit")?;
        fs::rename(&temporary, &final_path)
            .map_err(|error| BootstrapError::io(&final_path, error))?;
        sync_directory(&directory)
    }

    fn write_transaction(&self, transaction: &ProjectionTransactionV1) -> Result<()> {
        let state = self.projection_state_root();
        fs::create_dir_all(&state).map_err(|error| BootstrapError::io(&state, error))?;
        require_real_directory(&state, "Core projection state")?;
        let journal = self.transaction_path();
        if path_exists(&journal)? {
            return Err(BootstrapError::Validation(
                "a Core projection transaction is already active".to_string(),
            ));
        }
        let temporary = state.join(format!(".transaction-{}.tmp", Uuid::new_v4()));
        write_new_json(&temporary, transaction, "Core projection transaction")?;
        fs::rename(&temporary, &journal).map_err(|error| BootstrapError::io(&journal, error))?;
        sync_directory(&state)
    }

    fn read_transaction(&self) -> Result<Option<ProjectionTransactionV1>> {
        let journal = self.transaction_path();
        if !path_exists(&journal)? {
            return Ok(None);
        }
        let bytes = read_bounded_regular_file(
            &journal,
            MAX_PROJECTION_MARKER_BYTES,
            "Core projection transaction",
        )?;
        let transaction: ProjectionTransactionV1 = serde_json::from_slice(&bytes)
            .map_err(|error| BootstrapError::Json("Core projection transaction", error))?;
        self.validate_transaction(&transaction)?;
        Ok(Some(transaction))
    }

    fn validate_transaction(&self, transaction: &ProjectionTransactionV1) -> Result<()> {
        let transaction_id = Uuid::parse_str(&transaction.transaction_id).map_err(|_| {
            BootstrapError::Validation("Core projection transaction ID is invalid".to_string())
        })?;
        let expected_stage = format!(
            ".lyra-core-stage-{}-{transaction_id}",
            self.program_identity()
        );
        let previous_root = self.previous_root();
        let expected_previous = previous_root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if transaction.schema_version != 1
            || transaction.program_identity != self.program_identity()
            || transaction.target != self.config.target.as_str()
            || transaction.stage_name != expected_stage
            || transaction.previous_name != expected_previous
            || Version::parse(&transaction.version).is_err()
            || transaction.projection.version != transaction.version
        {
            return Err(BootstrapError::Validation(
                "Core projection transaction does not match this installation".to_string(),
            ));
        }
        validate_projection_marker(&transaction.projection, &self.config.target)?;
        if transaction.previous_projection.is_some() && !transaction.had_program {
            return Err(BootstrapError::Validation(
                "Core projection transaction previous-state metadata is inconsistent".to_string(),
            ));
        }
        if let Some(previous) = transaction.previous_projection.as_ref() {
            validate_projection_marker(previous, &self.config.target)?;
        }
        Ok(())
    }

    fn recover_interrupted_transaction(&self) -> Result<bool> {
        let Some(transaction) = self.read_transaction()? else {
            return Ok(false);
        };
        let stage = self.stage_root(&transaction)?;
        let previous = self.previous_root();
        let stage_exists = path_exists(&stage)?;
        let program_exists = path_exists(&self.config.program_root)?;
        let previous_exists = path_exists(&previous)?;
        if stage_exists {
            require_real_directory(&stage, "staged Core projection")?;
        }
        if program_exists {
            require_real_directory(&self.config.program_root, "program root")?;
        }
        if previous_exists {
            require_real_directory(&previous, "previous Core projection")?;
        }

        // Staging still exists, so the new projection was never installed.
        if stage_exists && program_exists {
            remove_real_directory_if_exists(&stage)?;
            self.clear_transaction()?;
            return Ok(true);
        }
        // The old projection was moved aside but the staged rename did not
        // complete. Restore it instead of guessing whether the new tree is OK.
        if stage_exists && !program_exists && previous_exists {
            fs::rename(&previous, &self.config.program_root)
                .map_err(|error| BootstrapError::io(&self.config.program_root, error))?;
            sync_directory(self.program_parent()?)?;
            remove_real_directory_if_exists(&stage)?;
            self.clear_transaction()?;
            return Ok(true);
        }
        if stage_exists && !program_exists && !previous_exists {
            if transaction.had_program {
                return Err(BootstrapError::Validation(
                    "interrupted Core projection lost the previous program directory".to_string(),
                ));
            }
            remove_real_directory_if_exists(&stage)?;
            self.clear_transaction()?;
            return Ok(true);
        }

        // Staging disappeared. A valid target at program_root means the
        // directory swap completed; finish the append-only registry commit.
        if !stage_exists && program_exists {
            if transaction.had_program && !previous_exists {
                return Err(BootstrapError::Validation(
                    "interrupted Core replacement has no preserved previous projection".to_string(),
                ));
            }
            let projection = self
                .verify_program_against_marker(&transaction.projection, Some(&transaction.version));
            let authorized = transaction.mode == CoreProjectionMode::Manual
                || system_signed_core_replacement_enabled();
            if projection.is_ok() && authorized {
                match self.commit_core_activation(&transaction.version, true) {
                    Ok(registry) => {
                        self.record_projection_commit(
                            registry.revision,
                            &transaction.projection,
                            transaction.previous_projection.as_ref(),
                        )?;
                        self.clear_transaction()?;
                        return Ok(true);
                    }
                    Err(_error) if self.registry_has_active_core(&transaction.version)? => {
                        let registry =
                            read_activation_registry(&self.config.state_root, &self.config.target)?;
                        self.record_projection_commit(
                            registry.revision,
                            &transaction.projection,
                            transaction.previous_projection.as_ref(),
                        )?;
                        self.clear_transaction()?;
                        return Ok(true);
                    }
                    Err(error) => {
                        self.rollback_program_switch(&transaction)?;
                        return Err(error);
                    }
                }
            }
            self.rollback_program_switch(&transaction)?;
            return Ok(true);
        }

        if !stage_exists && !program_exists && previous_exists {
            fs::rename(&previous, &self.config.program_root)
                .map_err(|error| BootstrapError::io(&self.config.program_root, error))?;
            sync_directory(self.program_parent()?)?;
            self.clear_transaction()?;
            return Ok(true);
        }
        Err(BootstrapError::Validation(
            "interrupted Core projection has no recoverable program, stage, or previous directory"
                .to_string(),
        ))
    }

    fn abandon_unstarted_transaction(&self, transaction: &ProjectionTransactionV1) -> Result<()> {
        if !path_exists(&self.config.program_root)? && transaction.had_program {
            return Err(BootstrapError::Validation(
                "cannot abandon Core staging because the program directory disappeared".to_string(),
            ));
        }
        remove_real_directory_if_exists(&self.stage_root(transaction)?)?;
        self.clear_transaction()
    }

    fn clear_transaction(&self) -> Result<()> {
        let state = self.projection_state_root();
        let journal = self.transaction_path();
        match fs::remove_file(&journal) {
            Ok(()) => sync_directory(&state),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(BootstrapError::io(&journal, error)),
        }
    }

    fn cleanup_orphan_stages(&self) -> Result<()> {
        let parent = self.program_parent()?;
        let prefix = format!(".lyra-core-stage-{}-", self.program_identity());
        for entry in fs::read_dir(parent).map_err(|error| BootstrapError::io(parent, error))? {
            let entry = entry.map_err(|error| BootstrapError::io(parent, error))?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if name.starts_with(&prefix) && Uuid::parse_str(&name[prefix.len()..]).is_ok() {
                remove_real_directory_if_exists(&entry.path())?;
            }
        }
        Ok(())
    }

    fn stage_root(&self, transaction: &ProjectionTransactionV1) -> Result<PathBuf> {
        self.validate_transaction(transaction)?;
        Ok(self.program_parent()?.join(&transaction.stage_name))
    }

    fn previous_root(&self) -> PathBuf {
        self.config
            .program_root
            .parent()
            .expect("program root was validated")
            .join(format!(".lyra-core-previous-{}", self.program_identity()))
    }

    fn projection_state_root(&self) -> PathBuf {
        self.config.state_root.join(PROJECTION_STATE_DIRECTORY)
    }

    fn transaction_path(&self) -> PathBuf {
        self.projection_state_root()
            .join(format!("transaction-{}.json", self.program_identity()))
    }

    fn program_parent(&self) -> Result<&Path> {
        self.config.program_root.parent().ok_or_else(|| {
            BootstrapError::Validation("program root has no parent directory".to_string())
        })
    }

    fn program_identity(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.config.program_root.as_os_str().as_encoded_bytes());
        hasher.update([0]);
        hasher.update(self.config.target.as_str().as_bytes());
        let digest = format!("{:x}", hasher.finalize());
        digest[..16].to_string()
    }
}

#[derive(Clone, Debug)]
struct VerifiedCoreSource {
    version: String,
    payload_path: PathBuf,
    payload_sha256: String,
    component_archive_sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct CoreProjectionManifestV1 {
    schema_version: u8,
    format: String,
    payload: String,
    target: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProjectedCoreMarkerV1 {
    schema_version: u8,
    component_id: String,
    version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_version: Option<String>,
    target: String,
    component_archive_sha256: String,
    payload_sha256: String,
    file_count: usize,
    inventory_sha256: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProjectionCommitV1 {
    schema_version: u8,
    registry_revision: u64,
    program_identity: String,
    active: ProjectedCoreMarkerV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous: Option<ProjectedCoreMarkerV1>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProjectionTransactionV1 {
    schema_version: u8,
    transaction_id: String,
    program_identity: String,
    target: String,
    version: String,
    stage_name: String,
    previous_name: String,
    had_program: bool,
    mode: CoreProjectionMode,
    projection: ProjectedCoreMarkerV1,
    #[serde(skip_serializing_if = "Option::is_none")]
    previous_projection: Option<ProjectedCoreMarkerV1>,
}

#[cfg(test)]
mod tests {
    use std::fs::File;
    use std::io::Write as _;

    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use tempfile::tempdir;
    use zip::write::SimpleFileOptions;

    use super::*;
    use crate::model::{
        ComponentActivationStateV1, ComponentDataSchemaV1, ComponentFileV1, InstalledFileV1,
    };

    fn target() -> Target {
        Target::current().expect("test target")
    }

    fn create_payload(path: &Path, text: &str) {
        let file = File::create(path).expect("payload file");
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file(
                "core.txt",
                SimpleFileOptions::default().unix_permissions(0o644),
            )
            .expect("payload entry");
        archive.write_all(text.as_bytes()).expect("payload bytes");
        archive.finish().expect("finish payload");
    }

    fn installed_file(root: &Path, relative: &str) -> InstalledFileV1 {
        let path = root.join(relative);
        let metadata = fs::metadata(&path).expect("metadata");
        InstalledFileV1 {
            path: relative.to_string(),
            size: metadata.len(),
            sha256: sha256_file(&path).expect("sha256"),
            unix_mode: unix_mode(&metadata),
        }
    }

    fn install_core(component_root: &Path, version: &str, text: &str, target: &Target) {
        let root = component_root
            .join("components")
            .join(CORE_COMPONENT_ID)
            .join(version)
            .join(target.as_str());
        fs::create_dir_all(&root).expect("component root");
        create_payload(&root.join(CORE_PAYLOAD_ENTRY), text);
        fs::write(
            root.join(CORE_PROJECTION_ENTRY),
            serde_json::to_vec_pretty(&serde_json::json!({
                "schemaVersion": 1,
                "format": "zip",
                "payload": CORE_PAYLOAD_ENTRY,
                "target": target.as_str()
            }))
            .expect("projection JSON"),
        )
        .expect("projection manifest");
        let signed_files = [CORE_PAYLOAD_ENTRY, CORE_PROJECTION_ENTRY]
            .into_iter()
            .map(|relative| {
                let file = installed_file(&root, relative);
                ComponentFileV1 {
                    path: file.path,
                    size: file.size,
                    sha256: file.sha256,
                }
            })
            .collect::<Vec<_>>();
        let manifest = ComponentManifestV1 {
            schema_version: 1,
            component_id: CORE_COMPONENT_ID.to_string(),
            kind: "core".to_string(),
            version: version.to_string(),
            target: target.as_str().to_string(),
            entry: Some(CORE_PROJECTION_ENTRY.to_string()),
            execution_class: None,
            activation: "core-restart".to_string(),
            host_api_range: None,
            runtime_protocol_range: None,
            data_schema: ComponentDataSchemaV1 {
                reader_min: 1,
                reader_max: 1,
                writer: 1,
            },
            permissions: vec!["system:desktop-host".to_string()],
            publisher: "Lyra test".to_string(),
            files: signed_files,
            key_id: "test-key".to_string(),
            signature: STANDARD.encode([7_u8; 64]),
        };
        fs::write(
            root.join("component.json"),
            serde_json::to_vec_pretty(&manifest).expect("manifest JSON"),
        )
        .expect("manifest");
        let mut files = ["component.json", CORE_PAYLOAD_ENTRY, CORE_PROJECTION_ENTRY]
            .into_iter()
            .map(|relative| installed_file(&root, relative))
            .collect::<Vec<_>>();
        files.sort_by(|left, right| left.path.cmp(&right.path));
        let marker = InstalledComponentV1 {
            schema_version: 1,
            component_id: CORE_COMPONENT_ID.to_string(),
            version: version.to_string(),
            target: target.as_str().to_string(),
            archive_sha256: "a".repeat(64),
            files,
        };
        fs::write(
            root.join(INSTALLED_MARKER),
            serde_json::to_vec_pretty(&marker).expect("marker JSON"),
        )
        .expect("marker");
    }

    fn write_registry(
        state_root: &Path,
        target: &Target,
        active: Option<&str>,
        pending: Option<&str>,
    ) {
        let mut components = BTreeMap::new();
        components.insert(
            CORE_COMPONENT_ID.to_string(),
            ComponentActivationStateV1 {
                active: active.map(str::to_string),
                previous: None,
                pending: pending.map(str::to_string),
            },
        );
        commit_activation_registry(
            state_root,
            target,
            ActivationRegistryV1 {
                schema_version: 1,
                revision: 0,
                keyring_sequence: 1,
                catalog_sequence: 1,
                target: target.as_str().to_string(),
                active_release_version: active.map(str::to_string),
                pending_release_version: pending.map(str::to_string),
                components,
            },
        )
        .expect("registry");
    }

    fn projector(temp: &Path, target: Target) -> CoreProjector {
        let mut config = CoreProjectionConfig::new(
            temp.join("store"),
            temp.join("state"),
            temp.join("program/Lyra"),
            target,
        );
        config.poll_interval = Duration::from_millis(1);
        config.wait_timeout = Duration::from_secs(1);
        CoreProjector::new(config).expect("projector")
    }

    fn stage_second_core(temp: &Path, target: &Target) {
        let mut registry =
            read_activation_registry(temp.join("state").as_path(), target).expect("registry");
        registry.pending_release_version = Some("2.0.0".to_string());
        registry
            .components
            .get_mut(CORE_COMPONENT_ID)
            .expect("Core")
            .pending = Some("2.0.0".to_string());
        commit_activation_registry(temp.join("state").as_path(), target, registry)
            .expect("stage registry");
    }

    #[test]
    fn projects_an_initial_core_from_the_active_component() {
        let temp = tempdir().expect("tempdir");
        let target = target();
        fs::create_dir_all(temp.path().join("store")).expect("store");
        fs::create_dir_all(temp.path().join("state")).expect("state");
        install_core(temp.path().join("store").as_path(), "1.0.0", "one", &target);
        write_registry(
            temp.path().join("state").as_path(),
            &target,
            Some("1.0.0"),
            None,
        );

        let report = projector(temp.path(), target.clone())
            .project()
            .expect("project Core");
        assert!(report.changed);
        assert_eq!(report.version, "1.0.0");
        assert_eq!(
            fs::read_to_string(temp.path().join("program/Lyra/core.txt")).expect("projected file"),
            "one"
        );
        assert!(report.previous_projection_root.is_none());
        let registry = read_activation_registry(temp.path().join("state").as_path(), &target)
            .expect("registry");
        assert_eq!(
            registry.components[CORE_COMPONENT_ID].active.as_deref(),
            Some("1.0.0")
        );
        projector(temp.path(), target)
            .verify_installation_for_removal()
            .expect("projected installation is internally consistent");
    }

    #[test]
    fn removal_verification_rejects_uncommitted_or_tampered_programs() {
        let temp = tempdir().expect("tempdir");
        let target = target();
        fs::create_dir_all(temp.path().join("store")).expect("store");
        fs::create_dir_all(temp.path().join("state")).expect("state");
        fs::create_dir_all(temp.path().join("program/Lyra")).expect("program");
        fs::write(temp.path().join("program/Lyra/not-lyra.txt"), b"keep").expect("unowned file");
        assert!(
            projector(temp.path(), target.clone())
                .verify_installation_for_removal()
                .is_err()
        );

        fs::remove_dir_all(temp.path().join("program/Lyra")).expect("remove unowned program");
        install_core(temp.path().join("store").as_path(), "1.0.0", "one", &target);
        write_registry(
            temp.path().join("state").as_path(),
            &target,
            Some("1.0.0"),
            None,
        );
        let projector = projector(temp.path(), target);
        projector.project().expect("initial projection");
        fs::write(projector.config.program_root.join("core.txt"), b"tampered")
            .expect("tamper projected Core");
        assert!(projector.verify_installation_for_removal().is_err());
    }

    #[test]
    fn promotes_pending_core_and_preserves_the_previous_projection() {
        let temp = tempdir().expect("tempdir");
        let target = target();
        fs::create_dir_all(temp.path().join("store")).expect("store");
        fs::create_dir_all(temp.path().join("state")).expect("state");
        install_core(temp.path().join("store").as_path(), "1.0.0", "one", &target);
        install_core(temp.path().join("store").as_path(), "2.0.0", "two", &target);
        write_registry(
            temp.path().join("state").as_path(),
            &target,
            Some("1.0.0"),
            None,
        );
        let initial = projector(temp.path(), target.clone());
        initial.project().expect("initial projection");

        stage_second_core(temp.path(), &target);

        let report = projector(temp.path(), target.clone())
            .project()
            .expect("update Core");
        assert_eq!(report.previous_version.as_deref(), Some("1.0.0"));
        assert_eq!(
            fs::read_to_string(temp.path().join("program/Lyra/core.txt")).expect("new Core"),
            "two"
        );
        let previous = report
            .previous_projection_root
            .expect("previous projection");
        assert_eq!(
            fs::read_to_string(previous.join("core.txt")).expect("previous Core"),
            "one"
        );
        let registry = read_activation_registry(temp.path().join("state").as_path(), &target)
            .expect("registry");
        let core = &registry.components[CORE_COMPONENT_ID];
        assert_eq!(core.active.as_deref(), Some("2.0.0"));
        assert_eq!(core.previous.as_deref(), Some("1.0.0"));
        assert_eq!(core.pending, None);
        assert_eq!(registry.active_release_version.as_deref(), Some("2.0.0"));
        assert_eq!(registry.pending_release_version, None);
    }

    #[test]
    fn manual_repair_reprojects_a_tampered_active_core() {
        let temp = tempdir().expect("tempdir");
        let target = target();
        fs::create_dir_all(temp.path().join("store")).expect("store");
        fs::create_dir_all(temp.path().join("state")).expect("state");
        install_core(temp.path().join("store").as_path(), "1.0.0", "one", &target);
        write_registry(
            temp.path().join("state").as_path(),
            &target,
            Some("1.0.0"),
            None,
        );
        let projector = projector(temp.path(), target.clone());
        let initial = projector.project().expect("initial projection");
        fs::write(temp.path().join("program/Lyra/core.txt"), b"tampered")
            .expect("tamper active Core");

        let repaired = projector.project().expect("manual repair");
        assert!(repaired.changed);
        assert!(repaired.registry_revision > initial.registry_revision);
        assert_eq!(
            fs::read_to_string(temp.path().join("program/Lyra/core.txt")).expect("repaired Core"),
            "one"
        );
        assert_eq!(
            fs::read_to_string(projector.previous_root().join("core.txt"))
                .expect("preserved damaged projection"),
            "tampered"
        );
        let registry = read_activation_registry(temp.path().join("state").as_path(), &target)
            .expect("registry");
        assert_eq!(
            registry.components[CORE_COMPONENT_ID].active.as_deref(),
            Some("1.0.0")
        );
        assert_eq!(registry.components[CORE_COMPONENT_ID].pending, None);
    }

    #[test]
    fn rejects_tampered_component_payload_without_touching_program() {
        let temp = tempdir().expect("tempdir");
        let target = target();
        fs::create_dir_all(temp.path().join("store")).expect("store");
        fs::create_dir_all(temp.path().join("state")).expect("state");
        install_core(temp.path().join("store").as_path(), "1.0.0", "one", &target);
        write_registry(
            temp.path().join("state").as_path(),
            &target,
            Some("1.0.0"),
            None,
        );
        let payload = temp
            .path()
            .join("store/components/lyra.core/1.0.0")
            .join(target.as_str())
            .join(CORE_PAYLOAD_ENTRY);
        fs::write(payload, b"tampered").expect("tamper payload");

        let error = projector(temp.path(), target)
            .project()
            .expect_err("tamper must fail");
        assert!(error.to_string().contains("failed verification"));
        assert!(!temp.path().join("program/Lyra").exists());
    }

    #[test]
    fn automatic_replacement_is_blocked_in_unsigned_builds() {
        if system_signed_core_replacement_enabled() {
            return;
        }
        let temp = tempdir().expect("tempdir");
        let target = target();
        fs::create_dir_all(temp.path().join("store")).expect("store");
        fs::create_dir_all(temp.path().join("state")).expect("state");
        install_core(temp.path().join("store").as_path(), "1.0.0", "one", &target);
        install_core(temp.path().join("store").as_path(), "2.0.0", "two", &target);
        write_registry(
            temp.path().join("state").as_path(),
            &target,
            Some("1.0.0"),
            None,
        );
        projector(temp.path(), target.clone())
            .project()
            .expect("initial projection");
        stage_second_core(temp.path(), &target);
        let mut config = CoreProjectionConfig::new(
            temp.path().join("store"),
            temp.path().join("state"),
            temp.path().join("program/Lyra"),
            target,
        );
        config.mode = CoreProjectionMode::Automatic;

        let error = CoreProjector::new(config)
            .expect("projector")
            .project()
            .expect_err("unsigned automatic replacement must fail");
        assert!(error.to_string().contains("system signing"));
        assert_eq!(
            fs::read_to_string(temp.path().join("program/Lyra/core.txt")).expect("old Core"),
            "one"
        );
    }

    #[test]
    fn crash_after_moving_old_core_restores_it_and_keeps_pending() {
        let temp = tempdir().expect("tempdir");
        let target = target();
        fs::create_dir_all(temp.path().join("store")).expect("store");
        fs::create_dir_all(temp.path().join("state")).expect("state");
        install_core(temp.path().join("store").as_path(), "1.0.0", "one", &target);
        install_core(temp.path().join("store").as_path(), "2.0.0", "two", &target);
        write_registry(
            temp.path().join("state").as_path(),
            &target,
            Some("1.0.0"),
            None,
        );
        projector(temp.path(), target.clone())
            .project()
            .expect("initial projection");
        stage_second_core(temp.path(), &target);

        let projector = projector(temp.path(), target.clone());
        let source = projector.verify_installed_core("2.0.0").expect("source");
        let previous = projector
            .verify_program_projection(Some("1.0.0"))
            .expect("verify previous")
            .expect("previous projection");
        let transaction = projector
            .prepare_projection(&source, true, Some(previous))
            .expect("stage projection");
        projector
            .write_transaction(&transaction)
            .expect("transaction");
        fs::rename(&projector.config.program_root, projector.previous_root())
            .expect("move old Core");

        assert!(
            projector
                .recover_interrupted_transaction()
                .expect("recover")
        );
        assert_eq!(
            fs::read_to_string(temp.path().join("program/Lyra/core.txt")).expect("restored Core"),
            "one"
        );
        let registry = read_activation_registry(temp.path().join("state").as_path(), &target)
            .expect("registry");
        let core = &registry.components[CORE_COMPONENT_ID];
        assert_eq!(core.active.as_deref(), Some("1.0.0"));
        assert_eq!(core.pending.as_deref(), Some("2.0.0"));
    }

    #[test]
    fn crash_after_new_core_move_finishes_registry_commit() {
        let temp = tempdir().expect("tempdir");
        let target = target();
        fs::create_dir_all(temp.path().join("store")).expect("store");
        fs::create_dir_all(temp.path().join("state")).expect("state");
        install_core(temp.path().join("store").as_path(), "1.0.0", "one", &target);
        install_core(temp.path().join("store").as_path(), "2.0.0", "two", &target);
        write_registry(
            temp.path().join("state").as_path(),
            &target,
            Some("1.0.0"),
            None,
        );
        projector(temp.path(), target.clone())
            .project()
            .expect("initial projection");
        stage_second_core(temp.path(), &target);

        let projector = projector(temp.path(), target.clone());
        let source = projector.verify_installed_core("2.0.0").expect("source");
        let previous = projector
            .verify_program_projection(Some("1.0.0"))
            .expect("verify previous")
            .expect("previous projection");
        let transaction = projector
            .prepare_projection(&source, true, Some(previous))
            .expect("stage projection");
        projector
            .write_transaction(&transaction)
            .expect("transaction");
        fs::rename(&projector.config.program_root, projector.previous_root())
            .expect("move old Core");
        fs::rename(
            projector.stage_root(&transaction).expect("stage root"),
            &projector.config.program_root,
        )
        .expect("move new Core");

        assert!(
            projector
                .recover_interrupted_transaction()
                .expect("recover")
        );
        assert_eq!(
            fs::read_to_string(temp.path().join("program/Lyra/core.txt")).expect("new Core"),
            "two"
        );
        assert_eq!(
            fs::read_to_string(projector.previous_root().join("core.txt")).expect("previous Core"),
            "one"
        );
        let registry = read_activation_registry(temp.path().join("state").as_path(), &target)
            .expect("registry");
        let core = &registry.components[CORE_COMPONENT_ID];
        assert_eq!(core.active.as_deref(), Some("2.0.0"));
        assert_eq!(core.previous.as_deref(), Some("1.0.0"));
        assert_eq!(core.pending, None);
    }

    #[test]
    fn invalid_new_projection_rolls_back_to_preserved_core() {
        let temp = tempdir().expect("tempdir");
        let target = target();
        fs::create_dir_all(temp.path().join("store")).expect("store");
        fs::create_dir_all(temp.path().join("state")).expect("state");
        install_core(temp.path().join("store").as_path(), "1.0.0", "one", &target);
        install_core(temp.path().join("store").as_path(), "2.0.0", "two", &target);
        write_registry(
            temp.path().join("state").as_path(),
            &target,
            Some("1.0.0"),
            None,
        );
        projector(temp.path(), target.clone())
            .project()
            .expect("initial projection");
        stage_second_core(temp.path(), &target);

        let projector = projector(temp.path(), target.clone());
        let source = projector.verify_installed_core("2.0.0").expect("source");
        let previous = projector
            .verify_program_projection(Some("1.0.0"))
            .expect("verify previous")
            .expect("previous projection");
        let transaction = projector
            .prepare_projection(&source, true, Some(previous))
            .expect("stage projection");
        projector
            .write_transaction(&transaction)
            .expect("transaction");
        fs::rename(&projector.config.program_root, projector.previous_root())
            .expect("move old Core");
        fs::rename(
            projector.stage_root(&transaction).expect("stage root"),
            &projector.config.program_root,
        )
        .expect("move new Core");
        fs::write(projector.config.program_root.join("core.txt"), b"corrupt")
            .expect("corrupt new projection");

        assert!(
            projector
                .recover_interrupted_transaction()
                .expect("recover")
        );
        assert_eq!(
            fs::read_to_string(temp.path().join("program/Lyra/core.txt")).expect("restored Core"),
            "one"
        );
        let registry = read_activation_registry(temp.path().join("state").as_path(), &target)
            .expect("registry");
        let core = &registry.components[CORE_COMPONENT_ID];
        assert_eq!(core.active.as_deref(), Some("1.0.0"));
        assert_eq!(core.pending.as_deref(), Some("2.0.0"));
    }
}
