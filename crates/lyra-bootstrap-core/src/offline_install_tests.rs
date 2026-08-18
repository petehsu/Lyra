#![allow(clippy::expect_used)]

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::{Duration, Utc};
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tempfile::{TempDir, tempdir};
use zip::write::SimpleFileOptions;

use crate::registry::commit_activation_registry;
use crate::trust::canonical_json;
use crate::{
    ActivationRegistryV1, BootstrapInstaller, CatalogReleaseV1, ChannelCatalogPayloadV1,
    ComponentActivationStateV1, ComponentDataSchemaV1, ComponentFileV1, ComponentManifestV1,
    InstallProgressPhase, InstalledComponentV1, InstallerConfig, ReleaseBomComponentV1,
    ReleaseBomV1, ReleaseKeyV1, ReleaseKeyringPayloadV1, SemanticVersionRangeV1, SignatureV1,
    SignedChannelCatalogV1, SignedReleaseKeyringV1, Target, TrustedKeys, read_activation_registry,
};

#[test]
fn signed_offline_install_reports_progress_and_resumes_after_cancellation() {
    let fixture = OfflineReleaseFixture::new();
    let error = fixture
        .installer()
        .install_with_progress(
            fixture.catalog_source(),
            Some(RELEASE_VERSION),
            |progress| progress.phase != InstallProgressPhase::Verify,
        )
        .expect_err("verification phase cancellation must stop before activation");
    assert!(matches!(error, crate::BootstrapError::Cancelled));

    let report = fixture
        .installer()
        .install(fixture.catalog_source(), Some(RELEASE_VERSION))
        .expect("a cancelled offline install can be resumed safely");
    assert_eq!(report.installed_components, vec![COMPONENT_ID.to_string()]);
}

const COMPONENT_ID: &str = "lyra.core";
const RELEASE_VERSION: &str = "1.0.0";
const SIGNING_KEY_ID: &str = "release-test-1";
const ROOT_KEY_ID: &str = "root-test-1";
const ENTRY_PATH: &str = "bin/lyra-core";
const ENTRY_BYTES: &[u8] = b"offline Lyra core fixture\n";

#[test]
fn an_existing_install_stages_a_new_release_without_switching_the_active_version() {
    let fixture = OfflineReleaseFixture::new();
    let previous_version = "0.9.0";
    commit_activation_registry(
        &fixture.state_root,
        &fixture.target,
        ActivationRegistryV1 {
            schema_version: 1,
            revision: 0,
            keyring_sequence: 0,
            catalog_sequence: 0,
            target: fixture.target.as_str().to_string(),
            active_release_version: Some(previous_version.to_string()),
            pending_release_version: None,
            components: BTreeMap::from([(
                COMPONENT_ID.to_string(),
                ComponentActivationStateV1 {
                    active: Some(previous_version.to_string()),
                    previous: None,
                    pending: None,
                },
            )]),
        },
    )
    .expect("existing activation state");

    let report = fixture
        .installer()
        .install(fixture.catalog_source(), Some(RELEASE_VERSION))
        .expect("new release is staged");

    assert_eq!(report.staged_components, [COMPONENT_ID]);
    let registry = read_activation_registry(&fixture.state_root, &fixture.target)
        .expect("activation registry after staging");
    assert_eq!(
        registry.active_release_version.as_deref(),
        Some(previous_version)
    );
    assert_eq!(
        registry.pending_release_version.as_deref(),
        Some(RELEASE_VERSION)
    );
    let core = registry.components.get(COMPONENT_ID).expect("core state");
    assert_eq!(core.active.as_deref(), Some(previous_version));
    assert_eq!(core.pending.as_deref(), Some(RELEASE_VERSION));
    assert!(core.previous.is_none());
}

#[test]
fn installs_and_repairs_a_fully_signed_offline_release_without_network() {
    let fixture = OfflineReleaseFixture::new();
    let installer = fixture.installer();
    let catalog_source = fixture
        .catalog_path
        .to_str()
        .expect("temporary catalog path is UTF-8");

    let first = installer
        .install(catalog_source, Some(RELEASE_VERSION))
        .expect("signed offline release installs");
    assert_eq!(first.release_version, RELEASE_VERSION);
    assert_eq!(first.catalog_sequence, 42);
    assert_eq!(first.target, fixture.target.as_str());
    assert_eq!(first.installed_components, [COMPONENT_ID]);
    assert!(first.repaired_components.is_empty());

    let component_root = fixture.component_root();
    assert_eq!(
        fs::read(component_root.join(ENTRY_PATH)).expect("installed entry"),
        ENTRY_BYTES
    );
    assert_eq!(
        fs::read(component_root.join("component.json")).expect("installed manifest"),
        fixture.manifest_bytes
    );
    assert_eq!(
        regular_file_paths(&component_root),
        [
            ".lyra-component.v1.json".to_string(),
            "bin/lyra-core".to_string(),
            "component.json".to_string(),
        ]
    );

    let marker: InstalledComponentV1 = serde_json::from_slice(
        &fs::read(component_root.join(".lyra-component.v1.json"))
            .expect("installed component marker"),
    )
    .expect("valid installed component marker");
    assert_eq!(marker.component_id, COMPONENT_ID);
    assert_eq!(marker.version, RELEASE_VERSION);
    assert_eq!(marker.target, fixture.target.as_str());
    assert_eq!(marker.archive_sha256, fixture.archive_sha256);
    assert_eq!(marker.files.len(), 2);

    let registry = read_activation_registry(&fixture.state_root, &fixture.target)
        .expect("activation registry after install");
    assert_eq!(registry.revision, 2);
    assert_eq!(registry.catalog_sequence, 42);
    assert_eq!(
        registry.active_release_version.as_deref(),
        Some(RELEASE_VERSION)
    );
    assert_eq!(registry.pending_release_version, None);
    let core_state = registry.components.get(COMPONENT_ID).expect("core state");
    assert_eq!(core_state.active.as_deref(), Some(RELEASE_VERSION));
    assert_eq!(core_state.previous, None);
    assert_eq!(core_state.pending, None);
    assert!(!fixture.state_root.join("cache-v1").exists());
    assert_eq!(
        fs::read(fixture.verified_catalog_path()).expect("verified catalog receipt"),
        fs::read(&fixture.catalog_path).expect("source catalog")
    );
    assert!(fixture.verified_bom_path().is_file());

    fs::write(component_root.join(ENTRY_PATH), b"tampered").expect("tamper installed component");
    fs::write(component_root.join("undeclared-file"), b"unexpected")
        .expect("add undeclared installed file");

    let repaired = installer
        .install(catalog_source, Some(RELEASE_VERSION))
        .expect("offline source repairs the component");
    assert!(repaired.installed_components.is_empty());
    assert_eq!(repaired.repaired_components, [COMPONENT_ID]);
    assert_eq!(
        fs::read(component_root.join(ENTRY_PATH)).expect("repaired entry"),
        ENTRY_BYTES
    );
    assert_eq!(
        regular_file_paths(&component_root),
        [
            ".lyra-component.v1.json".to_string(),
            "bin/lyra-core".to_string(),
            "component.json".to_string(),
        ]
    );
    assert!(!fixture.state_root.join("cache-v1").exists());

    let repaired_registry = read_activation_registry(&fixture.state_root, &fixture.target)
        .expect("activation registry after repair");
    assert_eq!(repaired_registry.revision, 4);
    assert_eq!(repaired_registry.catalog_sequence, 42);
    let repaired_core = repaired_registry
        .components
        .get(COMPONENT_ID)
        .expect("repaired core state");
    assert_eq!(repaired_core.active.as_deref(), Some(RELEASE_VERSION));
    assert_eq!(repaired_core.previous, None);
    assert_eq!(repaired_core.pending, None);
}

#[test]
fn a_single_on_demand_repair_uses_only_the_pinned_active_release() {
    let fixture = OfflineReleaseFixture::new_with_delivery("on-demand");
    fixture
        .installer()
        .install(fixture.catalog_source(), Some(RELEASE_VERSION))
        .expect("offline install activates the complete release");
    fs::remove_dir_all(fixture.component_root()).expect("simulate damaged resource package");

    let mut config = InstallerConfig::new(
        fixture.install_root.clone(),
        fixture.state_root.clone(),
        fixture.target.clone(),
    );
    config.offline_bundle_root = Some(fixture.bundle_root.clone());
    config.on_demand_component = Some(COMPONENT_ID.to_string());
    config.expected_catalog_sequence = Some(42);
    let installer = BootstrapInstaller::new(config, fixture.trusted_keys.clone())
        .expect("pinned on-demand installer");
    let report = installer
        .install(
            fixture
                .verified_catalog_path()
                .to_str()
                .expect("verified catalog path"),
            Some(RELEASE_VERSION),
        )
        .expect("pinned component is repaired");

    assert_eq!(report.installed_components, [COMPONENT_ID]);
    assert!(report.repaired_components.is_empty());
    assert!(report.staged_components.is_empty());
    let registry = read_activation_registry(&fixture.state_root, &fixture.target)
        .expect("activation registry after on-demand repair");
    assert_eq!(
        registry.active_release_version.as_deref(),
        Some(RELEASE_VERSION)
    );
    assert_eq!(registry.pending_release_version, None);
    assert_eq!(
        registry.components[COMPONENT_ID].active.as_deref(),
        Some(RELEASE_VERSION)
    );
}

struct OfflineReleaseFixture {
    _temp: TempDir,
    install_root: PathBuf,
    state_root: PathBuf,
    bundle_root: PathBuf,
    catalog_path: PathBuf,
    target: Target,
    trusted_keys: TrustedKeys,
    manifest_bytes: Vec<u8>,
    archive_sha256: String,
}

impl OfflineReleaseFixture {
    fn new() -> Self {
        Self::new_with_delivery("required")
    }

    fn new_with_delivery(delivery: &str) -> Self {
        let temp = tempdir().expect("temporary release workspace");
        let install_root = temp.path().join("install");
        let state_root = temp.path().join("state");
        let bundle_root = temp.path().join("offline-bundle");
        let components_root = bundle_root.join("components");
        let boms_root = bundle_root.join("boms");
        fs::create_dir_all(&components_root).expect("offline components directory");
        fs::create_dir_all(&boms_root).expect("offline BOM directory");

        let target = Target::current().expect("supported test target");
        let root_key = SigningKey::from_bytes(&[72_u8; 32]);
        let signing_key = SigningKey::from_bytes(&[73_u8; 32]);
        let mut trusted_keys = TrustedKeys::new();
        trusted_keys
            .insert_base64(
                ROOT_KEY_ID,
                &STANDARD.encode(root_key.verifying_key().to_bytes()),
            )
            .expect("fixture verifying key");

        let mut manifest = ComponentManifestV1 {
            schema_version: 1,
            component_id: COMPONENT_ID.to_string(),
            kind: "core".to_string(),
            version: RELEASE_VERSION.to_string(),
            target: target.as_str().to_string(),
            entry: Some(ENTRY_PATH.to_string()),
            execution_class: None,
            activation: "core-restart".to_string(),
            host_api_range: Some(SemanticVersionRangeV1 {
                min_inclusive: "1.0.0".to_string(),
                max_exclusive: Some("2.0.0".to_string()),
            }),
            runtime_protocol_range: None,
            data_schema: ComponentDataSchemaV1 {
                reader_min: 1,
                reader_max: 1,
                writer: 1,
            },
            permissions: vec!["host:core".to_string()],
            publisher: "Lyra offline fixture".to_string(),
            files: vec![ComponentFileV1 {
                path: ENTRY_PATH.to_string(),
                size: ENTRY_BYTES.len() as u64,
                sha256: sha256_bytes(ENTRY_BYTES),
            }],
            key_id: SIGNING_KEY_ID.to_string(),
            signature: String::new(),
        };
        manifest.signature = sign_without_signature(&manifest, &signing_key);
        let manifest_bytes = serde_json::to_vec_pretty(&manifest).expect("component manifest JSON");

        let pending_archive = bundle_root.join("component.pending.zip");
        write_component_archive(&pending_archive, &manifest_bytes);
        let archive_bytes = fs::read(&pending_archive).expect("component archive bytes");
        let archive_sha256 = sha256_bytes(&archive_bytes);
        let archive_size = archive_bytes.len() as u64;
        let archive_path = components_root.join(format!("{archive_sha256}.zip"));
        fs::rename(&pending_archive, &archive_path).expect("content-addressed component archive");

        let mut component = ReleaseBomComponentV1 {
            component_id: COMPONENT_ID.to_string(),
            kind: "core".to_string(),
            version: RELEASE_VERSION.to_string(),
            target: target.as_str().to_string(),
            // These URLs are deliberately unreachable. A successful test proves that
            // offline mode resolves both artifacts from the bundle instead.
            url: "https://127.0.0.1:9/components/unreachable.zip".to_string(),
            size: archive_size,
            sha256: archive_sha256.clone(),
            signature: String::new(),
            key_id: SIGNING_KEY_ID.to_string(),
            entry: Some(ENTRY_PATH.to_string()),
            execution_class: None,
            activation: "core-restart".to_string(),
            delivery: delivery.to_string(),
            min_core_version: None,
        };
        component.signature = sign_without_signature(&component, &signing_key);

        let bom = ReleaseBomV1 {
            schema_version: 1,
            release_version: RELEASE_VERSION.to_string(),
            channel: "preview".to_string(),
            target: target.as_str().to_string(),
            core_version: RELEASE_VERSION.to_string(),
            host_api_version: "1.0.0".to_string(),
            components: vec![component],
        };
        let bom_signature = sign(&bom, &signing_key);
        let bom_bytes = serde_json::to_vec_pretty(&bom).expect("release BOM JSON");
        let bom_sha256 = sha256_bytes(&bom_bytes);
        fs::write(boms_root.join(format!("{bom_sha256}.json")), &bom_bytes)
            .expect("content-addressed release BOM");

        let now = Utc::now();
        let generated_at = (now - Duration::minutes(1)).to_rfc3339();
        let expires_at = (now + Duration::days(1)).to_rfc3339();
        let payload = ChannelCatalogPayloadV1 {
            sequence: 42,
            channel: "preview".to_string(),
            generated_at: generated_at.clone(),
            expires_at: expires_at.clone(),
            minimum_safe_core_version: Some(RELEASE_VERSION.to_string()),
            revocations: Vec::new(),
            releases: vec![CatalogReleaseV1 {
                version: RELEASE_VERSION.to_string(),
                bom_url: "https://127.0.0.1:9/boms/unreachable.json".to_string(),
                bom_sha256,
                bom_signature,
                key_id: SIGNING_KEY_ID.to_string(),
            }],
            component_latest: None,
        };
        let catalog = SignedChannelCatalogV1 {
            schema_version: 1,
            keyring: {
                let payload = ReleaseKeyringPayloadV1 {
                    sequence: 7,
                    generated_at: generated_at.clone(),
                    expires_at: expires_at.clone(),
                    keys: vec![ReleaseKeyV1 {
                        key_id: SIGNING_KEY_ID.to_string(),
                        public_key: STANDARD.encode(signing_key.verifying_key().to_bytes()),
                        publisher: "Lyra offline fixture".to_string(),
                        channels: vec!["preview".to_string()],
                        component_kinds: vec![
                            "core".to_string(),
                            "runtime".to_string(),
                            "app".to_string(),
                            "resource".to_string(),
                            "extension".to_string(),
                        ],
                        component_id_prefixes: vec!["lyra.".to_string()],
                        execution_classes: vec![
                            "first-party-shared-renderer".to_string(),
                            "sandboxed-web".to_string(),
                            "sandboxed-web-wasi".to_string(),
                        ],
                        valid_from: generated_at,
                        valid_until: expires_at,
                    }],
                    revoked_key_ids: Vec::new(),
                };
                SignedReleaseKeyringV1 {
                    schema_version: 1,
                    signature: SignatureV1 {
                        algorithm: "ed25519".to_string(),
                        key_id: ROOT_KEY_ID.to_string(),
                        value: sign(&payload, &root_key),
                    },
                    payload,
                }
            },
            signature: SignatureV1 {
                algorithm: "ed25519".to_string(),
                key_id: SIGNING_KEY_ID.to_string(),
                value: sign(&payload, &signing_key),
            },
            payload,
        };
        let catalog_path = temp.path().join("catalog.json");
        fs::write(
            &catalog_path,
            serde_json::to_vec_pretty(&catalog).expect("channel catalog JSON"),
        )
        .expect("local signed catalog");

        Self {
            _temp: temp,
            install_root,
            state_root,
            bundle_root,
            catalog_path,
            target,
            trusted_keys,
            manifest_bytes,
            archive_sha256,
        }
    }

    fn installer(&self) -> BootstrapInstaller {
        let mut config = InstallerConfig::new(
            self.install_root.clone(),
            self.state_root.clone(),
            self.target.clone(),
        );
        config.offline_bundle_root = Some(self.bundle_root.clone());
        config.proxy = Some("http://127.0.0.1:9".to_string());
        BootstrapInstaller::new(config, self.trusted_keys.clone()).expect("offline installer")
    }

    fn catalog_source(&self) -> &str {
        self.catalog_path
            .to_str()
            .expect("temporary catalog path is UTF-8")
    }

    fn component_root(&self) -> PathBuf {
        self.install_root
            .join("components")
            .join(COMPONENT_ID)
            .join(RELEASE_VERSION)
            .join(self.target.as_str())
    }

    fn verified_catalog_path(&self) -> PathBuf {
        self.state_root
            .join("verified-releases-v1")
            .join(self.target.as_str())
            .join(RELEASE_VERSION)
            .join(format!("{:020}", 42))
            .join("catalog.json")
    }

    fn verified_bom_path(&self) -> PathBuf {
        self.state_root
            .join("verified-releases-v1")
            .join(self.target.as_str())
            .join(RELEASE_VERSION)
            .join(format!("{:020}", 42))
            .join("bom.json")
    }
}

fn write_component_archive(path: &Path, manifest_bytes: &[u8]) {
    let file = File::create(path).expect("create component archive");
    let mut archive = zip::ZipWriter::new(file);
    archive
        .start_file(
            "component.json",
            SimpleFileOptions::default().unix_permissions(0o644),
        )
        .expect("component manifest archive entry");
    archive
        .write_all(manifest_bytes)
        .expect("write component manifest");
    archive
        .start_file(
            ENTRY_PATH,
            SimpleFileOptions::default().unix_permissions(0o755),
        )
        .expect("component executable archive entry");
    archive
        .write_all(ENTRY_BYTES)
        .expect("write component executable");
    archive
        .finish()
        .expect("finish component archive")
        .sync_all()
        .expect("sync component archive");
}

fn sign<T: Serialize>(value: &T, key: &SigningKey) -> String {
    STANDARD.encode(
        key.sign(&canonical_json(value).expect("canonical signing payload"))
            .to_bytes(),
    )
}

fn sign_without_signature<T: Serialize>(value: &T, key: &SigningKey) -> String {
    let mut value = serde_json::to_value(value).expect("signature payload value");
    let Value::Object(object) = &mut value else {
        panic!("signature payload must be an object");
    };
    assert!(object.remove("signature").is_some());
    sign(&value, key)
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn regular_file_paths(root: &Path) -> Vec<String> {
    fn visit(root: &Path, directory: &Path, paths: &mut Vec<String>) {
        for entry in fs::read_dir(directory).expect("read installed component directory") {
            let entry = entry.expect("installed component entry");
            let file_type = entry.file_type().expect("installed component file type");
            if file_type.is_dir() {
                visit(root, &entry.path(), paths);
            } else {
                assert!(file_type.is_file(), "installed entry must be regular");
                paths.push(
                    entry
                        .path()
                        .strip_prefix(root)
                        .expect("installed relative path")
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
    }

    let mut paths = Vec::new();
    visit(root, root, &mut paths);
    paths.sort();
    paths
}
