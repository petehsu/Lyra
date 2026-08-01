use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use fs2::FileExt;
#[cfg(unix)]
use std::fs::File;
use uuid::Uuid;

use crate::model::{ActivationRegistryV1, ComponentActivationStateV1};
use crate::{BootstrapError, Result, Target};

const REGISTRY_DIRECTORY: &str = "registry-v1";
const REGISTRY_MAX_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ActivationRegistryMutationV1 {
    Activate {
        component_id: String,
        expected_revision: u64,
        expected_pending: String,
    },
    Rollback {
        component_id: String,
        expected_revision: u64,
        expected_previous: String,
    },
    /// Restore the component pointers from the registry transaction immediately
    /// preceding an activation or rollback. The source transaction, rather than
    /// caller-supplied versions, is authoritative.
    Restore {
        component_id: String,
        expected_revision: u64,
        source_revision: u64,
    },
}

impl ActivationRegistryMutationV1 {
    fn component_id(&self) -> &str {
        match self {
            Self::Activate { component_id, .. }
            | Self::Rollback { component_id, .. }
            | Self::Restore { component_id, .. } => component_id,
        }
    }

    fn expected_revision(&self) -> u64 {
        match self {
            Self::Activate {
                expected_revision, ..
            }
            | Self::Rollback {
                expected_revision, ..
            }
            | Self::Restore {
                expected_revision, ..
            } => *expected_revision,
        }
    }
}

pub fn read_activation_registry(
    state_root: &Path,
    target: &Target,
) -> Result<ActivationRegistryV1> {
    let directory = state_root.join(REGISTRY_DIRECTORY);
    if !directory.exists() {
        return Ok(ActivationRegistryV1::empty(target.as_str().to_string()));
    }
    let candidates = registry_candidates(&directory)?;
    if candidates.is_empty() {
        return Ok(ActivationRegistryV1::empty(target.as_str().to_string()));
    }
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
            "multiple activation registries have revision {highest}"
        )));
    }
    let path = candidates
        .last()
        .map(|(_, path)| path)
        .ok_or_else(|| BootstrapError::Validation("activation registry is missing".to_string()))?;
    read_registry_file(path, highest, target)
}

pub fn read_activation_registry_revision(
    state_root: &Path,
    target: &Target,
    revision: u64,
) -> Result<ActivationRegistryV1> {
    let directory = state_root.join(REGISTRY_DIRECTORY);
    let candidates = registry_candidates(&directory)?;
    let matches = candidates
        .iter()
        .filter(|(candidate, _)| *candidate == revision)
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(BootstrapError::Validation(format!(
            "activation registry revision {revision} is missing or ambiguous"
        )));
    }
    read_registry_file(&matches[0].1, revision, target)
}

fn registry_candidates(directory: &Path) -> Result<Vec<(u64, PathBuf)>> {
    let mut candidates = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| BootstrapError::io(directory, error))? {
        let entry = entry.map_err(|error| BootstrapError::io(directory, error))?;
        if !entry
            .file_type()
            .map_err(|error| BootstrapError::io(entry.path(), error))?
            .is_file()
        {
            continue;
        }
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        let Some(revision) = registry_revision(name) else {
            continue;
        };
        candidates.push((revision, entry.path()));
    }
    candidates.sort_by_key(|(revision, _)| *revision);
    Ok(candidates)
}

fn read_registry_file(
    path: &Path,
    expected_revision: u64,
    target: &Target,
) -> Result<ActivationRegistryV1> {
    let size = fs::metadata(path)
        .map_err(|error| BootstrapError::io(path, error))?
        .len();
    if size > REGISTRY_MAX_BYTES {
        return Err(BootstrapError::Validation(
            "activation registry exceeds the 4 MiB limit".to_string(),
        ));
    }
    let bytes = fs::read(path).map_err(|error| BootstrapError::io(path, error))?;
    let registry: ActivationRegistryV1 = serde_json::from_slice(&bytes)
        .map_err(|error| BootstrapError::Json("activation registry", error))?;
    if registry.schema_version != 1 || registry.revision != expected_revision {
        return Err(BootstrapError::Validation(
            "activation registry schema or revision does not match its transaction".to_string(),
        ));
    }
    if registry.target != target.as_str() {
        return Err(BootstrapError::TargetMismatch {
            expected: target.as_str().to_string(),
            actual: registry.target,
        });
    }
    for (label, version) in [
        (
            "active release version",
            registry.active_release_version.as_deref(),
        ),
        (
            "pending release version",
            registry.pending_release_version.as_deref(),
        ),
    ] {
        if let Some(version) = version {
            validate_registry_version(label, version)?;
        }
    }
    for (component_id, state) in &registry.components {
        crate::trust::validate_component_id(component_id)?;
        for version in [
            state.active.as_deref(),
            state.previous.as_deref(),
            state.pending.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            semver::Version::parse(version).map_err(|error| {
                BootstrapError::Validation(format!(
                    "invalid registry version for `{component_id}`: {error}"
                ))
            })?;
        }
    }
    Ok(registry)
}

/// Atomically changes one component's activation pointers in the append-only
/// bootstrap registry. Every mutation is serialized by `bootstrap.lock` and
/// uses an expected revision plus an expected source pointer (or source
/// transaction) so a second process cannot silently overwrite a newer state.
pub fn mutate_activation_registry(
    state_root: &Path,
    target: &Target,
    mutation: ActivationRegistryMutationV1,
) -> Result<ActivationRegistryV1> {
    crate::trust::validate_component_id(mutation.component_id())?;
    match &mutation {
        ActivationRegistryMutationV1::Activate {
            expected_pending, ..
        } => validate_registry_version("expected pending version", expected_pending)?,
        ActivationRegistryMutationV1::Rollback {
            expected_previous, ..
        } => validate_registry_version("expected previous version", expected_previous)?,
        ActivationRegistryMutationV1::Restore { .. } => {}
    }

    fs::create_dir_all(state_root).map_err(|error| BootstrapError::io(state_root, error))?;
    let lock_path = state_root.join("bootstrap.lock");
    let lock = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| BootstrapError::io(&lock_path, error))?;
    lock.lock_exclusive()
        .map_err(|error| BootstrapError::io(&lock_path, error))?;

    let result = mutate_activation_registry_locked(state_root, target, mutation);
    let unlock_result =
        FileExt::unlock(&lock).map_err(|error| BootstrapError::io(&lock_path, error));
    match result {
        Ok(registry) => {
            unlock_result?;
            Ok(registry)
        }
        Err(error) => Err(error),
    }
}

fn mutate_activation_registry_locked(
    state_root: &Path,
    target: &Target,
    mutation: ActivationRegistryMutationV1,
) -> Result<ActivationRegistryV1> {
    let mut current = read_activation_registry(state_root, target)?;
    if current.revision != mutation.expected_revision() {
        return Err(BootstrapError::Validation(format!(
            "activation registry race: expected revision {}, current revision is {}",
            mutation.expected_revision(),
            current.revision
        )));
    }
    match mutation {
        ActivationRegistryMutationV1::Activate {
            component_id,
            expected_pending,
            ..
        } => {
            let state = current.components.get_mut(&component_id).ok_or_else(|| {
                BootstrapError::Validation(format!(
                    "component `{component_id}` is missing from the activation registry"
                ))
            })?;
            if state.pending.as_deref() != Some(expected_pending.as_str()) {
                return Err(BootstrapError::Validation(format!(
                    "activation pointer race for `{component_id}`: expected pending `{expected_pending}`"
                )));
            }
            if state.active.as_deref() == Some(expected_pending.as_str()) {
                return Err(BootstrapError::Validation(format!(
                    "component `{component_id}` already has pending version `{expected_pending}` active"
                )));
            }
            state.previous = state.active.take();
            state.active = Some(expected_pending);
            state.pending = None;
            reconcile_release_pointer(&mut current);
        }
        ActivationRegistryMutationV1::Rollback {
            component_id,
            expected_previous,
            ..
        } => {
            let state = current.components.get_mut(&component_id).ok_or_else(|| {
                BootstrapError::Validation(format!(
                    "component `{component_id}` is missing from the activation registry"
                ))
            })?;
            if state.previous.as_deref() != Some(expected_previous.as_str()) {
                return Err(BootstrapError::Validation(format!(
                    "rollback pointer race for `{component_id}`: expected previous `{expected_previous}`"
                )));
            }
            if state.active.as_deref() == Some(expected_previous.as_str()) {
                return Err(BootstrapError::Validation(format!(
                    "component `{component_id}` already has previous version `{expected_previous}` active"
                )));
            }
            let old_active = state.active.take();
            state.active = Some(expected_previous);
            state.previous = old_active;
            state.pending = None;
            clear_pending_release_pointer(&mut current);
        }
        ActivationRegistryMutationV1::Restore {
            component_id,
            source_revision,
            ..
        } => {
            if source_revision.checked_add(1) != Some(current.revision) {
                return Err(BootstrapError::Validation(format!(
                    "restore source revision {source_revision} is not the immediate predecessor of revision {}",
                    current.revision
                )));
            }
            let source = read_activation_registry_revision(state_root, target, source_revision)?;
            let source_state = source.components.get(&component_id).ok_or_else(|| {
                BootstrapError::Validation(format!(
                    "component `{component_id}` is missing from restore revision {source_revision}"
                ))
            })?;
            let current_state = current.components.get(&component_id).ok_or_else(|| {
                BootstrapError::Validation(format!(
                    "component `{component_id}` is missing from the current activation registry"
                ))
            })?;
            if !is_direct_pointer_mutation(source_state, current_state) {
                return Err(BootstrapError::Validation(format!(
                    "component `{component_id}` was not directly activated or rolled back from revision {source_revision}"
                )));
            }
            current
                .components
                .insert(component_id, source_state.clone());
            current.active_release_version = source.active_release_version;
            current.pending_release_version = source.pending_release_version;
        }
    }
    commit_activation_registry(state_root, target, current)
}

fn validate_registry_version(label: &str, version: &str) -> Result<()> {
    semver::Version::parse(version)
        .map(|_| ())
        .map_err(|error| BootstrapError::Validation(format!("invalid {label}: {error}")))
}

fn activated_state(source: &ComponentActivationStateV1) -> Option<ComponentActivationStateV1> {
    let pending = source.pending.as_ref()?;
    if source.active.as_ref() == Some(pending) {
        return None;
    }
    Some(ComponentActivationStateV1 {
        active: Some(pending.clone()),
        previous: source.active.clone(),
        pending: None,
    })
}

fn rolled_back_state(source: &ComponentActivationStateV1) -> Option<ComponentActivationStateV1> {
    let previous = source.previous.as_ref()?;
    if source.active.as_ref() == Some(previous) {
        return None;
    }
    Some(ComponentActivationStateV1 {
        active: Some(previous.clone()),
        previous: source.active.clone(),
        pending: None,
    })
}

fn is_direct_pointer_mutation(
    source: &ComponentActivationStateV1,
    current: &ComponentActivationStateV1,
) -> bool {
    activated_state(source).as_ref() == Some(current)
        || rolled_back_state(source).as_ref() == Some(current)
}

pub(crate) fn reconcile_release_pointer(registry: &mut ActivationRegistryV1) {
    if registry
        .components
        .values()
        .any(|state| state.pending.is_some())
    {
        return;
    }
    if let Some(pending) = registry.pending_release_version.take() {
        registry.active_release_version = Some(pending);
    }
}

fn clear_pending_release_pointer(registry: &mut ActivationRegistryV1) {
    if !registry
        .components
        .values()
        .any(|state| state.pending.is_some())
    {
        registry.pending_release_version = None;
    }
}

pub(crate) fn commit_activation_registry(
    state_root: &Path,
    target: &Target,
    mut next: ActivationRegistryV1,
) -> Result<ActivationRegistryV1> {
    let current = read_activation_registry(state_root, target)?;
    next.schema_version = 1;
    next.revision = current
        .revision
        .checked_add(1)
        .ok_or_else(|| BootstrapError::Validation("registry revision overflow".to_string()))?;
    next.target = target.as_str().to_string();
    let directory = state_root.join(REGISTRY_DIRECTORY);
    fs::create_dir_all(&directory).map_err(|error| BootstrapError::io(&directory, error))?;
    let final_path = directory.join(format!(
        "registry-{:020}-{}.json",
        next.revision,
        Uuid::new_v4()
    ));
    let temp_path = temp_path(&directory);
    let bytes = serde_json::to_vec_pretty(&next)
        .map_err(|error| BootstrapError::Json("activation registry", error))?;
    if bytes.len() as u64 > REGISTRY_MAX_BYTES {
        return Err(BootstrapError::Validation(
            "activation registry exceeds the 4 MiB limit".to_string(),
        ));
    }
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| BootstrapError::io(&temp_path, error))?;
    file.write_all(&bytes)
        .map_err(|error| BootstrapError::io(&temp_path, error))?;
    file.sync_all()
        .map_err(|error| BootstrapError::io(&temp_path, error))?;
    fs::rename(&temp_path, &final_path).map_err(|error| BootstrapError::io(&final_path, error))?;
    sync_directory(&directory)?;
    Ok(next)
}

fn registry_revision(name: &str) -> Option<u64> {
    let value = name.strip_prefix("registry-")?.strip_suffix(".json")?;
    let (revision, uuid) = value.split_once('-')?;
    if revision.len() != 20 || Uuid::parse_str(uuid).is_err() {
        return None;
    }
    revision.parse().ok()
}

fn temp_path(directory: &Path) -> PathBuf {
    directory.join(format!(".registry-{}.tmp", Uuid::new_v4()))
}

#[cfg(unix)]
fn sync_directory(directory: &Path) -> Result<()> {
    File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(|error| BootstrapError::io(directory, error))
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) -> Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::{Arc, Barrier};
    use std::thread;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn commits_registry_as_atomic_append_only_transactions() {
        let temp = tempdir().expect("tempdir");
        let target = Target::parse("darwin-arm64").expect("target");
        let mut first = ActivationRegistryV1::empty(target.as_str().to_string());
        first.catalog_sequence = 3;
        first.active_release_version = Some("1.0.0".to_string());
        let first = commit_activation_registry(temp.path(), &target, first).expect("first commit");
        assert_eq!(first.revision, 1);

        let transaction_dir = temp.path().join(REGISTRY_DIRECTORY);
        fs::write(
            transaction_dir.join(".registry-99999999999999999999.tmp"),
            b"partial",
        )
        .expect("interrupted temp transaction");
        let after_interruption =
            read_activation_registry(temp.path(), &target).expect("registry after interruption");
        assert_eq!(after_interruption.revision, 1);
        assert_eq!(
            after_interruption.active_release_version.as_deref(),
            Some("1.0.0")
        );

        let mut second = after_interruption;
        second.catalog_sequence = 4;
        second.active_release_version = Some("1.1.0".to_string());
        commit_activation_registry(temp.path(), &target, second).expect("second commit");
        let current = read_activation_registry(temp.path(), &target).expect("current registry");
        assert_eq!(current.revision, 2);
        assert_eq!(current.catalog_sequence, 4);
        assert_eq!(current.active_release_version.as_deref(), Some("1.1.0"));
    }

    fn staged_registry(target: &Target) -> ActivationRegistryV1 {
        ActivationRegistryV1 {
            schema_version: 1,
            revision: 0,
            keyring_sequence: 2,
            catalog_sequence: 3,
            target: target.as_str().to_string(),
            active_release_version: Some("1.0.0".to_string()),
            pending_release_version: Some("1.1.0".to_string()),
            components: BTreeMap::from([
                (
                    "lyra.images".to_string(),
                    ComponentActivationStateV1 {
                        active: Some("1.0.0".to_string()),
                        previous: Some("0.9.0".to_string()),
                        pending: Some("1.1.0".to_string()),
                    },
                ),
                (
                    "lyra.files".to_string(),
                    ComponentActivationStateV1 {
                        active: Some("1.0.0".to_string()),
                        previous: None,
                        pending: Some("1.1.0".to_string()),
                    },
                ),
            ]),
        }
    }

    #[test]
    fn activates_and_rolls_back_only_authoritative_source_pointers() {
        let temp = tempdir().expect("tempdir");
        let target = Target::parse("darwin-arm64").expect("target");
        let initial = commit_activation_registry(temp.path(), &target, staged_registry(&target))
            .expect("stage registry");

        let activated = mutate_activation_registry(
            temp.path(),
            &target,
            ActivationRegistryMutationV1::Activate {
                component_id: "lyra.images".to_string(),
                expected_revision: initial.revision,
                expected_pending: "1.1.0".to_string(),
            },
        )
        .expect("activate pending");
        assert_eq!(
            activated.components["lyra.images"],
            ComponentActivationStateV1 {
                active: Some("1.1.0".to_string()),
                previous: Some("1.0.0".to_string()),
                pending: None,
            }
        );
        assert_eq!(activated.pending_release_version.as_deref(), Some("1.1.0"));

        let rolled_back = mutate_activation_registry(
            temp.path(),
            &target,
            ActivationRegistryMutationV1::Rollback {
                component_id: "lyra.images".to_string(),
                expected_revision: activated.revision,
                expected_previous: "1.0.0".to_string(),
            },
        )
        .expect("rollback previous");
        assert_eq!(
            rolled_back.components["lyra.images"],
            ComponentActivationStateV1 {
                active: Some("1.0.0".to_string()),
                previous: Some("1.1.0".to_string()),
                pending: None,
            }
        );
    }

    #[test]
    fn reconciles_release_and_restores_only_the_immediate_authoritative_transaction() {
        let temp = tempdir().expect("tempdir");
        let target = Target::parse("darwin-arm64").expect("target");
        let mut staged = staged_registry(&target);
        staged
            .components
            .get_mut("lyra.files")
            .expect("files")
            .pending = None;
        let staged = commit_activation_registry(temp.path(), &target, staged).expect("stage");
        let activated = mutate_activation_registry(
            temp.path(),
            &target,
            ActivationRegistryMutationV1::Activate {
                component_id: "lyra.images".to_string(),
                expected_revision: staged.revision,
                expected_pending: "1.1.0".to_string(),
            },
        )
        .expect("activate");
        assert_eq!(activated.active_release_version.as_deref(), Some("1.1.0"));
        assert_eq!(activated.pending_release_version, None);

        let restored = mutate_activation_registry(
            temp.path(),
            &target,
            ActivationRegistryMutationV1::Restore {
                component_id: "lyra.images".to_string(),
                expected_revision: activated.revision,
                source_revision: staged.revision,
            },
        )
        .expect("restore");
        assert_eq!(
            restored.components["lyra.images"],
            staged.components["lyra.images"]
        );
        assert_eq!(
            restored.active_release_version,
            staged.active_release_version
        );
        assert_eq!(
            restored.pending_release_version,
            staged.pending_release_version
        );

        let error = mutate_activation_registry(
            temp.path(),
            &target,
            ActivationRegistryMutationV1::Restore {
                component_id: "lyra.images".to_string(),
                expected_revision: restored.revision,
                source_revision: staged.revision,
            },
        )
        .expect_err("non-immediate restore must fail");
        assert!(error.to_string().contains("immediate predecessor"));
    }

    #[test]
    fn rejects_stale_revisions_and_pointer_substitution() {
        let temp = tempdir().expect("tempdir");
        let target = Target::parse("darwin-arm64").expect("target");
        let staged = commit_activation_registry(temp.path(), &target, staged_registry(&target))
            .expect("stage");
        let pointer_error = mutate_activation_registry(
            temp.path(),
            &target,
            ActivationRegistryMutationV1::Activate {
                component_id: "lyra.images".to_string(),
                expected_revision: staged.revision,
                expected_pending: "9.9.9".to_string(),
            },
        )
        .expect_err("wrong pointer must fail");
        assert!(pointer_error.to_string().contains("pointer race"));

        let activated = mutate_activation_registry(
            temp.path(),
            &target,
            ActivationRegistryMutationV1::Activate {
                component_id: "lyra.images".to_string(),
                expected_revision: staged.revision,
                expected_pending: "1.1.0".to_string(),
            },
        )
        .expect("activate");
        let stale_error = mutate_activation_registry(
            temp.path(),
            &target,
            ActivationRegistryMutationV1::Rollback {
                component_id: "lyra.images".to_string(),
                expected_revision: staged.revision,
                expected_previous: "1.0.0".to_string(),
            },
        )
        .expect_err("stale revision must fail");
        assert!(stale_error.to_string().contains("activation registry race"));
        assert_eq!(
            read_activation_registry(temp.path(), &target)
                .expect("current")
                .revision,
            activated.revision
        );
    }

    #[test]
    fn bootstrap_lock_serializes_competing_activation_writers() {
        let temp = tempdir().expect("tempdir");
        let target = Target::parse("darwin-arm64").expect("target");
        let staged = commit_activation_registry(temp.path(), &target, staged_registry(&target))
            .expect("stage");
        let expected_revision = staged.revision;
        let barrier = Arc::new(Barrier::new(3));
        let mut writers = Vec::new();
        for _ in 0..2 {
            let state_root = temp.path().to_path_buf();
            let target = target.clone();
            let barrier = Arc::clone(&barrier);
            writers.push(thread::spawn(move || {
                barrier.wait();
                mutate_activation_registry(
                    &state_root,
                    &target,
                    ActivationRegistryMutationV1::Activate {
                        component_id: "lyra.images".to_string(),
                        expected_revision,
                        expected_pending: "1.1.0".to_string(),
                    },
                )
            }));
        }
        barrier.wait();
        let results = writers
            .into_iter()
            .map(|writer| writer.join().expect("writer thread"))
            .collect::<Vec<_>>();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert_eq!(results.iter().filter(|result| result.is_err()).count(), 1);
        assert!(
            results
                .iter()
                .filter_map(|result| result.as_ref().err())
                .any(|error| error.to_string().contains("activation registry race"))
        );
    }
}
