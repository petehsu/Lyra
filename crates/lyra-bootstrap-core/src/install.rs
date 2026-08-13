use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use fs2::FileExt;
use semver::Version;
use uuid::Uuid;

use crate::archive::{
    ExtractionLimits, INSTALLED_MARKER, extract_verified, read_verified_entry, verified_inventory,
};
use crate::download::{HttpDownloader, sha256_file};
use crate::model::{
    ActivationRegistryV1, ComponentActivationStateV1, InstallProgressPhase, InstallProgressV1,
    InstallReport, InstalledComponentV1, InstalledFileV1, ReleaseBomComponentV1,
    ReleaseCheckReportV1,
};
use crate::registry::{commit_activation_registry, read_activation_registry};
use crate::trust::{
    TrustedKeys, parse_and_verify_bom, parse_and_verify_catalog,
    parse_and_verify_component_manifest, persist_verified_keyring, select_release,
    verify_component_signature,
};
use crate::{BootstrapError, Result, Target};

const MAX_CATALOG_BYTES: u64 = 2 * 1024 * 1024;
const MAX_BOM_BYTES: u64 = 4 * 1024 * 1024;
const MAX_COMPONENT_MANIFEST_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct InstallerConfig {
    pub install_root: PathBuf,
    pub state_root: PathBuf,
    pub target: Target,
    pub proxy: Option<String>,
    /// Content-addressed `boms/<sha>.json` and `components/<sha>.zip` bundle.
    /// When present, installation performs no network requests after reading
    /// the signed catalog.
    pub offline_bundle_root: Option<PathBuf>,
    /// Installs components marked `on-demand`. Full offline installers enable
    /// this automatically; small online installers normally leave it false.
    pub include_on_demand: bool,
    /// Installs exactly one component marked `on-demand` from the already
    /// active release. This is the Core first-use/repair path; it never
    /// resolves an independent component `latest`.
    pub on_demand_component: Option<String>,
    /// Catalog sequence recorded when the active release was installed.
    /// Required with `on_demand_component` so a mutable channel URL cannot
    /// silently move the request to another signed catalog generation.
    pub expected_catalog_sequence: Option<u64>,
    pub extraction_limits: ExtractionLimits,
}

impl InstallerConfig {
    pub fn new(install_root: PathBuf, state_root: PathBuf, target: Target) -> Self {
        Self {
            install_root,
            state_root,
            target,
            proxy: None,
            offline_bundle_root: None,
            include_on_demand: false,
            on_demand_component: None,
            expected_catalog_sequence: None,
            extraction_limits: ExtractionLimits::default(),
        }
    }
}

#[derive(Debug)]
pub struct BootstrapInstaller {
    config: InstallerConfig,
    downloader: HttpDownloader,
    trusted_keys: TrustedKeys,
}

impl BootstrapInstaller {
    pub fn new(config: InstallerConfig, trusted_keys: TrustedKeys) -> Result<Self> {
        validate_root_path("install root", &config.install_root)?;
        validate_root_path("state root", &config.state_root)?;
        if let Some(root) = config.offline_bundle_root.as_deref() {
            validate_root_path("offline bundle root", root)?;
            reject_symlink_root(root)?;
        }
        if config.include_on_demand && config.on_demand_component.is_some() {
            return Err(BootstrapError::Validation(
                "include-on-demand cannot be combined with a single on-demand component"
                    .to_string(),
            ));
        }
        if let Some(component_id) = config.on_demand_component.as_deref() {
            crate::trust::validate_component_id(component_id)?;
            if config.expected_catalog_sequence.is_none() {
                return Err(BootstrapError::Validation(
                    "an expected catalog sequence is required for on-demand acquisition"
                        .to_string(),
                ));
            }
        } else if config.expected_catalog_sequence.is_some() {
            return Err(BootstrapError::Validation(
                "expected catalog sequence is only valid for on-demand acquisition".to_string(),
            ));
        }
        let downloader = HttpDownloader::new(config.proxy.as_deref())?;
        Ok(Self {
            config,
            downloader,
            trusted_keys,
        })
    }

    pub fn install(
        &self,
        catalog_source: &str,
        requested_release: Option<&str>,
    ) -> Result<InstallReport> {
        self.install_with_progress(catalog_source, requested_release, |_| true)
    }

    /// Resolve and authenticate the newest release without mutating installation state.
    pub fn check_release(
        &self,
        catalog_source: &str,
        requested_release: Option<&str>,
    ) -> Result<ReleaseCheckReportV1> {
        let catalog_bytes = self
            .downloader
            .read_signed_document(catalog_source, MAX_CATALOG_BYTES)?;
        let catalog =
            parse_and_verify_catalog(&catalog_bytes, &self.trusted_keys, chrono::Utc::now())?;
        let release = select_release(&catalog, requested_release)?;
        let bom_bytes = self
            .downloader
            .read_signed_document(&release.bom_url, MAX_BOM_BYTES)?;
        let bom = parse_and_verify_bom(&bom_bytes, release, &catalog, &self.config.target)?;
        for component in &bom.components {
            verify_component_signature(component, &catalog)?;
        }
        Ok(ReleaseCheckReportV1 {
            release_version: release.version.clone(),
            catalog_sequence: catalog.payload.sequence,
            target: self.config.target.as_str().to_string(),
        })
    }

    pub fn install_with_progress(
        &self,
        catalog_source: &str,
        requested_release: Option<&str>,
        mut on_progress: impl FnMut(&InstallProgressV1) -> bool,
    ) -> Result<InstallReport> {
        fs::create_dir_all(&self.config.install_root)
            .map_err(|error| BootstrapError::io(&self.config.install_root, error))?;
        fs::create_dir_all(&self.config.state_root)
            .map_err(|error| BootstrapError::io(&self.config.state_root, error))?;
        reject_symlink_root(&self.config.install_root)?;
        reject_symlink_root(&self.config.state_root)?;
        let lock_path = self.config.state_root.join("bootstrap.lock");
        let lock = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(&lock_path)
            .map_err(|error| BootstrapError::io(&lock_path, error))?;
        lock.lock_exclusive()
            .map_err(|error| BootstrapError::io(&lock_path, error))?;

        let report = self.install_locked(catalog_source, requested_release, &mut on_progress);
        let unlock_result = lock
            .unlock()
            .map_err(|error| BootstrapError::io(&lock_path, error));
        match report {
            Ok(report) => {
                unlock_result?;
                Ok(report)
            }
            Err(error) => Err(error),
        }
    }

    fn install_locked(
        &self,
        catalog_source: &str,
        requested_release: Option<&str>,
        on_progress: &mut impl FnMut(&InstallProgressV1) -> bool,
    ) -> Result<InstallReport> {
        emit_progress(
            on_progress,
            InstallProgressV1 {
                phase: InstallProgressPhase::Catalog,
                component_id: None,
                completed: 0,
                total: 1,
                completed_components: 0,
                total_components: 0,
            },
        )?;
        let catalog_bytes = self
            .downloader
            .read_signed_document(catalog_source, MAX_CATALOG_BYTES)?;
        let catalog =
            parse_and_verify_catalog(&catalog_bytes, &self.trusted_keys, chrono::Utc::now())?;
        persist_verified_keyring(&self.config.state_root, &catalog)?;
        let release = select_release(&catalog, requested_release)?;
        let current = read_activation_registry(&self.config.state_root, &self.config.target)?;
        validate_update_order(
            &current,
            catalog.keyring.payload.sequence,
            catalog.payload.sequence,
            &release.version,
        )?;
        validate_on_demand_release_selection(
            &self.config,
            &current,
            requested_release,
            catalog.payload.sequence,
            &release.version,
        )?;

        emit_progress(
            on_progress,
            InstallProgressV1 {
                phase: InstallProgressPhase::Bom,
                component_id: None,
                completed: 0,
                total: 1,
                completed_components: 0,
                total_components: 0,
            },
        )?;

        let pinned_bom_path = verified_release_document_path(
            &self.config.state_root,
            &self.config.target,
            &release.version,
            catalog.payload.sequence,
            "bom.json",
        )?;
        let bom_bytes = match (
            self.config.on_demand_component.as_ref(),
            self.config.offline_bundle_root.as_deref(),
        ) {
            (Some(_), _) => self.downloader.read_signed_document(
                pinned_bom_path.to_str().ok_or_else(|| {
                    BootstrapError::Validation(
                        "verified release BOM path is not valid UTF-8".to_string(),
                    )
                })?,
                MAX_BOM_BYTES,
            )?,
            (None, Some(root)) => read_offline_artifact(
                root,
                "boms",
                &release.bom_sha256,
                "json",
                MAX_BOM_BYTES,
                None,
            )?,
            (None, None) => self
                .downloader
                .fetch_small_https(&release.bom_url, MAX_BOM_BYTES)?,
        };
        let bom = parse_and_verify_bom(&bom_bytes, release, &catalog, &self.config.target)?;
        for component in &bom.components {
            verify_component_signature(component, &catalog)?;
        }
        persist_verified_release_documents(
            &self.config.state_root,
            &self.config.target,
            &release.version,
            catalog.payload.sequence,
            &catalog_bytes,
            &bom_bytes,
        )?;
        let (selected_components, deferred_components) =
            select_components_for_install(&self.config, &bom)?;
        let total_components = selected_components.len();
        if self.config.offline_bundle_root.is_none() {
            self.preflight_downloads(&selected_components)?;
        }

        let is_on_demand_acquisition = self.config.on_demand_component.is_some();
        let activate_immediately = !is_on_demand_acquisition
            && (current.active_release_version.is_none()
                || current.active_release_version.as_deref() == Some(bom.release_version.as_str()));
        let mut intent = current;
        intent.keyring_sequence = catalog.keyring.payload.sequence;
        intent.catalog_sequence = catalog.payload.sequence;
        if !is_on_demand_acquisition {
            intent.pending_release_version = Some(bom.release_version.clone());
        }
        let intent =
            commit_activation_registry(&self.config.state_root, &self.config.target, intent)?;

        let cache_root = self.config.state_root.join("cache-v1");
        let mut prepared = Vec::with_capacity(selected_components.len());
        for (component_index, component) in selected_components.into_iter().enumerate() {
            emit_progress(
                on_progress,
                InstallProgressV1 {
                    phase: InstallProgressPhase::Download,
                    component_id: Some(component.component_id.clone()),
                    completed: 0,
                    total: component.size,
                    completed_components: component_index,
                    total_components,
                },
            )?;
            let archive_path = if let Some(root) = self.config.offline_bundle_root.as_deref() {
                let path = offline_artifact_path(root, "components", &component.sha256, "zip")?;
                validate_offline_file(&path, component.size, Some(&component.sha256))?;
                path
            } else {
                let path = cache_root.join(format!("{}.zip", component.sha256));
                self.downloader.download_to(
                    &component.url,
                    component.size,
                    &component.sha256,
                    &path,
                    |completed, total| {
                        on_progress(&InstallProgressV1 {
                            phase: InstallProgressPhase::Download,
                            component_id: Some(component.component_id.clone()),
                            completed,
                            total,
                            completed_components: component_index,
                            total_components,
                        })
                    },
                )?;
                path
            };
            emit_progress(
                on_progress,
                InstallProgressV1 {
                    phase: InstallProgressPhase::Verify,
                    component_id: Some(component.component_id.clone()),
                    completed: component.size,
                    total: component.size,
                    completed_components: component_index,
                    total_components,
                },
            )?;
            let inventory = verified_inventory(
                &archive_path,
                &component.sha256,
                self.config.extraction_limits,
            )?;
            let manifest_bytes = read_verified_entry(
                &archive_path,
                &component.sha256,
                "component.json",
                MAX_COMPONENT_MANIFEST_BYTES,
            )?;
            parse_and_verify_component_manifest(&manifest_bytes, component, &inventory, &catalog)?;
            if let Some(entry) = component.entry.as_deref()
                && !inventory.iter().any(|file| file.path == entry)
            {
                return Err(BootstrapError::Validation(format!(
                    "component `{}` entry `{entry}` is not a regular file in its archive",
                    component.component_id
                )));
            }
            prepared.push(PreparedComponent {
                component,
                archive_path,
                inventory,
            });
        }
        self.preflight_extraction(&prepared)?;

        let mut installed_components = Vec::new();
        let mut repaired_components = Vec::new();
        for (component_index, prepared) in prepared.iter().enumerate() {
            emit_progress(
                on_progress,
                InstallProgressV1 {
                    phase: InstallProgressPhase::Install,
                    component_id: Some(prepared.component.component_id.clone()),
                    completed: component_index as u64,
                    total: total_components as u64,
                    completed_components: component_index,
                    total_components,
                },
            )?;
            match self.install_component(prepared)? {
                ComponentInstallOutcome::Installed => {
                    installed_components.push(prepared.component.component_id.clone())
                }
                ComponentInstallOutcome::Repaired => {
                    repaired_components.push(prepared.component.component_id.clone())
                }
                ComponentInstallOutcome::AlreadyValid => {}
            }
        }

        let mut next = intent;
        let mut staged_components = Vec::new();
        if activate_immediately {
            let bom_ids = bom
                .components
                .iter()
                .map(|component| component.component_id.as_str())
                .collect::<HashSet<_>>();
            for (component_id, state) in &mut next.components {
                if !bom_ids.contains(component_id.as_str()) {
                    if state.active.is_some() {
                        state.previous = state.active.take();
                    }
                    state.pending = None;
                }
            }
            for component in prepared.iter().map(|prepared| prepared.component) {
                let state = next
                    .components
                    .entry(component.component_id.clone())
                    .or_insert_with(ComponentActivationStateV1::default);
                if state.active.as_deref() != Some(component.version.as_str()) {
                    state.previous = state.active.take();
                    state.active = Some(component.version.clone());
                }
                state.pending = None;
            }
            next.active_release_version = Some(bom.release_version.clone());
            next.pending_release_version = None;
        } else {
            for component in prepared.iter().map(|prepared| prepared.component) {
                let state = next
                    .components
                    .entry(component.component_id.clone())
                    .or_insert_with(ComponentActivationStateV1::default);
                if state.active.as_deref() == Some(component.version.as_str()) {
                    state.pending = None;
                } else {
                    state.pending = Some(component.version.clone());
                    staged_components.push(component.component_id.clone());
                }
            }
        }
        next.catalog_sequence = catalog.payload.sequence;
        commit_activation_registry(&self.config.state_root, &self.config.target, next)?;

        emit_progress(
            on_progress,
            InstallProgressV1 {
                phase: InstallProgressPhase::Complete,
                component_id: None,
                completed: total_components as u64,
                total: total_components as u64,
                completed_components: total_components,
                total_components,
            },
        )?;

        Ok(InstallReport {
            release_version: bom.release_version,
            catalog_sequence: catalog.payload.sequence,
            target: self.config.target.as_str().to_string(),
            installed_components,
            repaired_components,
            staged_components,
            deferred_components,
        })
    }

    fn preflight_downloads(&self, components: &[&ReleaseBomComponentV1]) -> Result<()> {
        let cache_root = self.config.state_root.join("cache-v1");
        fs::create_dir_all(&cache_root).map_err(|error| BootstrapError::io(&cache_root, error))?;
        let mut required = 0_u64;
        for component in components {
            let archive_path = cache_root.join(format!("{}.zip", component.sha256));
            if archive_path.exists()
                && fs::metadata(&archive_path)
                    .map_err(|error| BootstrapError::io(&archive_path, error))?
                    .len()
                    == component.size
                && sha256_file(&archive_path)? == component.sha256
            {
                continue;
            }
            required = required
                .checked_add(component.size)
                .ok_or_else(|| BootstrapError::Validation("download size overflow".to_string()))?;
        }
        let available = fs2::available_space(&cache_root)
            .map_err(|error| BootstrapError::io(&cache_root, error))?;
        if available < required {
            return Err(BootstrapError::InsufficientSpace {
                available,
                required,
            });
        }
        Ok(())
    }

    fn preflight_extraction(&self, prepared: &[PreparedComponent<'_>]) -> Result<()> {
        let mut required = 0_u64;
        for prepared in prepared {
            let destination = self.component_path(prepared.component);
            if installed_matches(&destination, prepared.component, &prepared.inventory)? {
                continue;
            }
            for file in &prepared.inventory {
                required = required.checked_add(file.size).ok_or_else(|| {
                    BootstrapError::Validation("extracted size overflow".to_string())
                })?;
            }
        }
        let available = fs2::available_space(&self.config.install_root)
            .map_err(|error| BootstrapError::io(&self.config.install_root, error))?;
        if available < required {
            return Err(BootstrapError::InsufficientSpace {
                available,
                required,
            });
        }
        Ok(())
    }

    fn install_component(
        &self,
        prepared: &PreparedComponent<'_>,
    ) -> Result<ComponentInstallOutcome> {
        let destination = self.component_path(prepared.component);
        let parent = destination.parent().ok_or_else(|| {
            BootstrapError::Validation("component path has no parent".to_string())
        })?;
        fs::create_dir_all(parent).map_err(|error| BootstrapError::io(parent, error))?;
        let backup = parent.join(format!(".{}.repair-backup", self.config.target.as_str()));
        recover_component_swap(&destination, &backup)?;
        if installed_matches(&destination, prepared.component, &prepared.inventory)? {
            return Ok(ComponentInstallOutcome::AlreadyValid);
        }
        let was_repair = destination.exists();
        let stage = parent.join(format!(
            ".{}.stage-{}",
            self.config.target.as_str(),
            Uuid::new_v4()
        ));
        let extraction = extract_verified(
            &prepared.archive_path,
            &prepared.component.sha256,
            &stage,
            self.config.extraction_limits,
        );
        let actual_inventory = match extraction {
            Ok(inventory) => inventory,
            Err(error) => {
                remove_directory_if_exists(&stage)?;
                return Err(error);
            }
        };
        if actual_inventory != prepared.inventory {
            remove_directory_if_exists(&stage)?;
            return Err(BootstrapError::Archive(
                "archive inventory changed during extraction".to_string(),
            ));
        }
        write_installed_marker(&stage, prepared.component, actual_inventory)?;
        if destination.exists() {
            fs::rename(&destination, &backup)
                .map_err(|error| BootstrapError::io(&destination, error))?;
        }
        if let Err(error) = fs::rename(&stage, &destination) {
            if backup.exists() && !destination.exists() {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(BootstrapError::io(&destination, error));
        }
        remove_directory_if_exists(&backup)?;
        Ok(if was_repair {
            ComponentInstallOutcome::Repaired
        } else {
            ComponentInstallOutcome::Installed
        })
    }

    fn component_path(&self, component: &ReleaseBomComponentV1) -> PathBuf {
        self.config
            .install_root
            .join("components")
            .join(&component.component_id)
            .join(&component.version)
            .join(self.config.target.as_str())
    }
}

fn emit_progress(
    on_progress: &mut impl FnMut(&InstallProgressV1) -> bool,
    progress: InstallProgressV1,
) -> Result<()> {
    if on_progress(&progress) {
        Ok(())
    } else {
        Err(BootstrapError::Cancelled)
    }
}

fn offline_artifact_path(
    root: &Path,
    group: &str,
    digest: &str,
    extension: &str,
) -> Result<PathBuf> {
    crate::trust::validate_sha256(digest)?;
    let path = root.join(group).join(format!("{digest}.{extension}"));
    let expected_parent = root.join(group);
    if path.parent() != Some(expected_parent.as_path()) {
        return Err(BootstrapError::Validation(
            "offline artifact escaped its content-addressed directory".to_string(),
        ));
    }
    Ok(path)
}

fn validate_offline_file(
    path: &Path,
    maximum_or_exact_size: u64,
    expected_sha256: Option<&str>,
) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| BootstrapError::io(path, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(BootstrapError::Validation(format!(
            "offline artifact {} must be a regular file",
            path.display()
        )));
    }
    if expected_sha256.is_some() {
        if metadata.len() != maximum_or_exact_size {
            return Err(BootstrapError::Validation(format!(
                "offline artifact {} has size {}, expected {}",
                path.display(),
                metadata.len(),
                maximum_or_exact_size
            )));
        }
    } else if metadata.len() > maximum_or_exact_size {
        return Err(BootstrapError::Validation(format!(
            "offline artifact {} exceeds the {}-byte limit",
            path.display(),
            maximum_or_exact_size
        )));
    }
    if let Some(expected) = expected_sha256 {
        let actual = sha256_file(path)?;
        if actual != expected {
            return Err(BootstrapError::HashMismatch {
                expected: expected.to_string(),
                actual,
            });
        }
    }
    Ok(())
}

fn read_offline_artifact(
    root: &Path,
    group: &str,
    digest: &str,
    extension: &str,
    max_bytes: u64,
    exact_size: Option<u64>,
) -> Result<Vec<u8>> {
    let path = offline_artifact_path(root, group, digest, extension)?;
    validate_offline_file(
        &path,
        exact_size.unwrap_or(max_bytes),
        exact_size.map(|_| digest),
    )?;
    let bytes = fs::read(&path).map_err(|error| BootstrapError::io(&path, error))?;
    crate::download::verify_sha256_bytes(&bytes, digest)?;
    Ok(bytes)
}

struct PreparedComponent<'a> {
    component: &'a ReleaseBomComponentV1,
    archive_path: PathBuf,
    inventory: Vec<InstalledFileV1>,
}

enum ComponentInstallOutcome {
    AlreadyValid,
    Installed,
    Repaired,
}

fn validate_on_demand_release_selection(
    config: &InstallerConfig,
    current: &ActivationRegistryV1,
    requested_release: Option<&str>,
    catalog_sequence: u64,
    selected_release: &str,
) -> Result<()> {
    if config.on_demand_component.is_none() {
        return Ok(());
    }
    let requested_release = requested_release.ok_or_else(|| {
        BootstrapError::Validation(
            "on-demand acquisition requires an explicit active release".to_string(),
        )
    })?;
    let active_release = current.active_release_version.as_deref().ok_or_else(|| {
        BootstrapError::Validation(
            "on-demand acquisition requires an existing active release".to_string(),
        )
    })?;
    if requested_release != active_release || selected_release != active_release {
        return Err(BootstrapError::Trust(format!(
            "on-demand acquisition is pinned to active release {active_release}"
        )));
    }
    if current.pending_release_version.is_some() {
        return Err(BootstrapError::Validation(
            "on-demand acquisition is unavailable while another release is pending".to_string(),
        ));
    }
    let expected_sequence = config.expected_catalog_sequence.ok_or_else(|| {
        BootstrapError::Validation(
            "on-demand acquisition is missing its expected catalog sequence".to_string(),
        )
    })?;
    if current.catalog_sequence == 0
        || expected_sequence != current.catalog_sequence
        || catalog_sequence != current.catalog_sequence
    {
        return Err(BootstrapError::Trust(format!(
            "on-demand catalog sequence must equal installed sequence {}",
            current.catalog_sequence
        )));
    }
    Ok(())
}

fn select_components_for_install<'a>(
    config: &InstallerConfig,
    bom: &'a crate::model::ReleaseBomV1,
) -> Result<(Vec<&'a ReleaseBomComponentV1>, Vec<String>)> {
    if let Some(component_id) = config.on_demand_component.as_deref() {
        let component = bom
            .components
            .iter()
            .find(|component| component.component_id == component_id)
            .ok_or_else(|| {
                BootstrapError::Validation(format!(
                    "on-demand component `{component_id}` is not present in the pinned BOM"
                ))
            })?;
        if component.delivery != "on-demand" {
            return Err(BootstrapError::Validation(format!(
                "component `{component_id}` is not marked on-demand in the pinned BOM"
            )));
        }
        let deferred = bom
            .components
            .iter()
            .filter(|candidate| {
                candidate.delivery == "on-demand" && candidate.component_id != component_id
            })
            .map(|candidate| candidate.component_id.clone())
            .collect();
        return Ok((vec![component], deferred));
    }

    let include_on_demand = config.include_on_demand || config.offline_bundle_root.is_some();
    let selected = bom
        .components
        .iter()
        .filter(|component| component.delivery == "required" || include_on_demand)
        .collect();
    let deferred = bom
        .components
        .iter()
        .filter(|component| component.delivery == "on-demand" && !include_on_demand)
        .map(|component| component.component_id.clone())
        .collect();
    Ok((selected, deferred))
}

fn verified_release_document_path(
    state_root: &Path,
    target: &Target,
    release_version: &str,
    catalog_sequence: u64,
    document: &str,
) -> Result<PathBuf> {
    Version::parse(release_version)
        .map_err(|error| BootstrapError::Validation(format!("invalid release version: {error}")))?;
    if !matches!(document, "catalog.json" | "bom.json") {
        return Err(BootstrapError::Validation(
            "invalid verified release document name".to_string(),
        ));
    }
    if catalog_sequence == 0 {
        return Err(BootstrapError::Validation(
            "verified release catalog sequence must be positive".to_string(),
        ));
    }
    Ok(state_root
        .join("verified-releases-v1")
        .join(target.as_str())
        .join(release_version)
        .join(format!("{catalog_sequence:020}"))
        .join(document))
}

fn persist_verified_release_documents(
    state_root: &Path,
    target: &Target,
    release_version: &str,
    catalog_sequence: u64,
    catalog_bytes: &[u8],
    bom_bytes: &[u8],
) -> Result<()> {
    persist_immutable_document(
        state_root,
        &verified_release_document_path(
            state_root,
            target,
            release_version,
            catalog_sequence,
            "catalog.json",
        )?,
        catalog_bytes,
        MAX_CATALOG_BYTES,
    )?;
    persist_immutable_document(
        state_root,
        &verified_release_document_path(
            state_root,
            target,
            release_version,
            catalog_sequence,
            "bom.json",
        )?,
        bom_bytes,
        MAX_BOM_BYTES,
    )
}

fn persist_immutable_document(
    state_root: &Path,
    path: &Path,
    bytes: &[u8],
    max_bytes: u64,
) -> Result<()> {
    if bytes.len() as u64 > max_bytes {
        return Err(BootstrapError::Validation(
            "verified release document exceeds its size limit".to_string(),
        ));
    }
    let parent = path.parent().ok_or_else(|| {
        BootstrapError::Validation("verified release document has no parent".to_string())
    })?;
    fs::create_dir_all(parent).map_err(|error| BootstrapError::io(parent, error))?;
    let relative_parent = parent.strip_prefix(state_root).map_err(|_| {
        BootstrapError::Validation("verified release document escaped the state root".to_string())
    })?;
    let mut cursor = state_root.to_path_buf();
    for component in relative_parent.components() {
        cursor.push(component.as_os_str());
        let metadata =
            fs::symlink_metadata(&cursor).map_err(|error| BootstrapError::io(&cursor, error))?;
        if metadata.file_type().is_symlink() {
            return Err(BootstrapError::Validation(format!(
                "verified release directory cannot be a symbolic link: {}",
                cursor.display()
            )));
        }
        if !metadata.is_dir() {
            return Err(BootstrapError::Validation(format!(
                "verified release path component is not a directory: {}",
                cursor.display()
            )));
        }
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(BootstrapError::Validation(format!(
                    "verified release document must be a regular file: {}",
                    path.display()
                )));
            }
            let existing = fs::read(path).map_err(|error| BootstrapError::io(path, error))?;
            if existing != bytes {
                return Err(BootstrapError::Trust(format!(
                    "verified release document already exists with different content: {}",
                    path.display()
                )));
            }
            return Ok(());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(BootstrapError::io(path, error)),
    }
    let temporary = parent.join(format!(".verified-release-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| BootstrapError::io(&temporary, error))?;
    file.write_all(bytes)
        .map_err(|error| BootstrapError::io(&temporary, error))?;
    file.sync_all()
        .map_err(|error| BootstrapError::io(&temporary, error))?;
    fs::rename(&temporary, path).map_err(|error| BootstrapError::io(path, error))
}

fn validate_update_order(
    current: &ActivationRegistryV1,
    keyring_sequence: u64,
    catalog_sequence: u64,
    release_version: &str,
) -> Result<()> {
    if keyring_sequence < current.keyring_sequence {
        return Err(BootstrapError::Trust(format!(
            "release keyring sequence {keyring_sequence} is older than installed sequence {}",
            current.keyring_sequence
        )));
    }
    if catalog_sequence < current.catalog_sequence {
        return Err(BootstrapError::Trust(format!(
            "catalog sequence {catalog_sequence} is older than installed sequence {}",
            current.catalog_sequence
        )));
    }
    if let Some(active) = current.active_release_version.as_deref()
        && Version::parse(release_version)
            .map_err(|error| BootstrapError::Validation(error.to_string()))?
            < Version::parse(active)
                .map_err(|error| BootstrapError::Validation(error.to_string()))?
    {
        return Err(BootstrapError::Trust(format!(
            "refusing release downgrade from {active} to {release_version}"
        )));
    }
    Ok(())
}

fn installed_matches(
    destination: &Path,
    component: &ReleaseBomComponentV1,
    expected: &[InstalledFileV1],
) -> Result<bool> {
    if !destination.exists() {
        return Ok(false);
    }
    let marker_path = destination.join(INSTALLED_MARKER);
    let marker_metadata = match fs::metadata(&marker_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(BootstrapError::io(&marker_path, error)),
    };
    if marker_metadata.len() > 4 * 1024 * 1024 {
        return Ok(false);
    }
    let marker_bytes = match fs::read(&marker_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(BootstrapError::io(&marker_path, error)),
    };
    let marker: InstalledComponentV1 = match serde_json::from_slice(&marker_bytes) {
        Ok(marker) => marker,
        Err(_) => return Ok(false),
    };
    if marker.schema_version != 1
        || marker.component_id != component.component_id
        || marker.version != component.version
        || marker.target != component.target
        || marker.archive_sha256 != component.sha256
        || marker.files != expected
    {
        return Ok(false);
    }
    let expected_paths = expected
        .iter()
        .map(|file| file.path.as_str())
        .chain(std::iter::once(INSTALLED_MARKER))
        .collect::<HashSet<_>>();
    let Some(actual_paths) = collect_regular_files(destination)? else {
        return Ok(false);
    };
    if actual_paths.len() != expected_paths.len()
        || actual_paths
            .iter()
            .any(|path| !expected_paths.contains(path.as_str()))
    {
        return Ok(false);
    }
    for expected_file in expected {
        let path = destination.join(Path::new(&expected_file.path));
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(BootstrapError::io(&path, error)),
        };
        if !metadata.file_type().is_file()
            || metadata.len() != expected_file.size
            || sha256_file(&path)? != expected_file.sha256
            || !mode_matches(&metadata, expected_file.unix_mode)
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn collect_regular_files(root: &Path) -> Result<Option<HashSet<String>>> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = HashSet::new();
    while let Some(directory) = pending.pop() {
        for entry in
            fs::read_dir(&directory).map_err(|error| BootstrapError::io(&directory, error))?
        {
            let entry = entry.map_err(|error| BootstrapError::io(&directory, error))?;
            let path = entry.path();
            let file_type = entry
                .file_type()
                .map_err(|error| BootstrapError::io(&path, error))?;
            if file_type.is_symlink() || (!file_type.is_dir() && !file_type.is_file()) {
                return Ok(None);
            }
            if file_type.is_dir() {
                pending.push(path);
                continue;
            }
            let relative = path.strip_prefix(root).map_err(|_| {
                BootstrapError::Validation("component file escaped its root".to_string())
            })?;
            files.insert(path_to_slashes(relative)?);
        }
    }
    Ok(Some(files))
}

#[cfg(unix)]
fn mode_matches(metadata: &fs::Metadata, expected: Option<u32>) -> bool {
    use std::os::unix::fs::PermissionsExt;

    expected.is_none_or(|mode| metadata.permissions().mode() & 0o777 == mode)
}

#[cfg(not(unix))]
fn mode_matches(_metadata: &fs::Metadata, _expected: Option<u32>) -> bool {
    true
}

fn write_installed_marker(
    stage: &Path,
    component: &ReleaseBomComponentV1,
    files: Vec<InstalledFileV1>,
) -> Result<()> {
    let marker = InstalledComponentV1 {
        schema_version: 1,
        component_id: component.component_id.clone(),
        version: component.version.clone(),
        target: component.target.clone(),
        archive_sha256: component.sha256.clone(),
        files,
    };
    let path = stage.join(INSTALLED_MARKER);
    let bytes = serde_json::to_vec_pretty(&marker)
        .map_err(|error| BootstrapError::Json("installed component marker", error))?;
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|error| BootstrapError::io(&path, error))?;
    file.write_all(&bytes)
        .map_err(|error| BootstrapError::io(&path, error))?;
    file.sync_all()
        .map_err(|error| BootstrapError::io(&path, error))
}

fn recover_component_swap(destination: &Path, backup: &Path) -> Result<()> {
    if !backup.exists() {
        return Ok(());
    }
    if destination.exists() {
        return remove_directory_if_exists(backup);
    }
    fs::rename(backup, destination).map_err(|error| BootstrapError::io(destination, error))
}

fn remove_directory_if_exists(path: &Path) -> Result<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(BootstrapError::io(path, error)),
    }
}

fn path_to_slashes(path: &Path) -> Result<String> {
    path.components()
        .map(|component| match component {
            Component::Normal(value) => value.to_str().map(str::to_string).ok_or_else(|| {
                BootstrapError::Validation("installed path is not valid UTF-8".to_string())
            }),
            _ => Err(BootstrapError::Validation(
                "installed path is not relative".to_string(),
            )),
        })
        .collect::<Result<Vec<_>>>()
        .map(|parts| parts.join("/"))
}

fn validate_root_path(label: &str, path: &Path) -> Result<()> {
    if !path.is_absolute() || path.parent().is_none() || path.parent() == Some(path) {
        return Err(BootstrapError::Validation(format!(
            "{label} must be an absolute non-root path"
        )));
    }
    Ok(())
}

fn reject_symlink_root(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| BootstrapError::io(path, error))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(BootstrapError::Validation(format!(
            "bootstrap root {} must be a real directory",
            path.display()
        )));
    }
    Ok(())
}
