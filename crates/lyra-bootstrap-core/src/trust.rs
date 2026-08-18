use std::collections::{BTreeMap, HashMap, HashSet};
#[cfg(unix)]
use std::fs::File;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use chrono::{DateTime, Duration, Utc};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use semver::Version;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::model::{
    CatalogReleaseV1, ChannelCatalogPayloadV1, ComponentManifestV1, InstalledFileV1,
    ReleaseBomComponentV1, ReleaseBomV1, ReleaseKeyV1, ReleaseKeyringPayloadV1,
    SignedChannelCatalogV1,
};
use crate::{BootstrapError, Result, Target};

#[derive(Clone, Debug, Default)]
pub struct TrustedKeys {
    keys: BTreeMap<String, VerifyingKey>,
}

impl TrustedKeys {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert_base64(&mut self, key_id: impl Into<String>, value: &str) -> Result<()> {
        let key = decode_verifying_key(value)?;
        self.keys.insert(key_id.into(), key);
        Ok(())
    }

    fn verify(&self, key_id: &str, message: &[u8], signature: &str) -> Result<()> {
        let key = self
            .keys
            .get(key_id)
            .ok_or_else(|| BootstrapError::Trust(format!("untrusted signing key `{key_id}`")))?;
        verify_with_key(key, message, signature)
    }
}

fn decode_verifying_key(value: &str) -> Result<VerifyingKey> {
    let decoded = STANDARD
        .decode(value)
        .map_err(|error| BootstrapError::Trust(format!("invalid public key base64: {error}")))?;
    let bytes: [u8; 32] = decoded.try_into().map_err(|_| {
        BootstrapError::Trust("an Ed25519 public key must contain 32 bytes".to_string())
    })?;
    VerifyingKey::from_bytes(&bytes)
        .map_err(|error| BootstrapError::Trust(format!("invalid public key: {error}")))
}

fn verify_with_key(key: &VerifyingKey, message: &[u8], signature: &str) -> Result<()> {
    let decoded = STANDARD
        .decode(signature)
        .map_err(|error| BootstrapError::Trust(format!("invalid signature base64: {error}")))?;
    let signature = Signature::from_slice(&decoded)
        .map_err(|error| BootstrapError::Trust(format!("invalid Ed25519 signature: {error}")))?;
    key.verify(message, &signature)
        .map_err(|_| BootstrapError::Trust("signature verification failed".to_string()))
}

pub fn parse_and_verify_catalog(
    bytes: &[u8],
    keys: &TrustedKeys,
    now: DateTime<Utc>,
) -> Result<SignedChannelCatalogV1> {
    let catalog: SignedChannelCatalogV1 = serde_json::from_slice(bytes)
        .map_err(|error| BootstrapError::Json("channel catalog", error))?;
    if catalog.schema_version != 1 {
        return Err(BootstrapError::Validation(format!(
            "unsupported catalog schema version {}",
            catalog.schema_version
        )));
    }
    if catalog.keyring.schema_version != 1 {
        return Err(BootstrapError::Validation(format!(
            "unsupported release keyring schema version {}",
            catalog.keyring.schema_version
        )));
    }
    if catalog.keyring.signature.algorithm != "ed25519" {
        return Err(BootstrapError::Trust(format!(
            "unsupported keyring signature algorithm `{}`",
            catalog.keyring.signature.algorithm
        )));
    }
    if catalog.signature.algorithm != "ed25519" {
        return Err(BootstrapError::Trust(format!(
            "unsupported signature algorithm `{}`",
            catalog.signature.algorithm
        )));
    }
    keys.verify(
        &catalog.keyring.signature.key_id,
        &canonical_json(&catalog.keyring.payload)?,
        &catalog.keyring.signature.value,
    )?;
    validate_release_keyring(&catalog.keyring.payload, now)?;
    validate_catalog_payload(&catalog.payload, now)?;
    let release_key = require_catalog_signing_key(&catalog, now)?;
    verify_with_key(
        &decode_verifying_key(&release_key.public_key)?,
        &canonical_json(&catalog.payload)?,
        &catalog.signature.value,
    )?;
    Ok(catalog)
}

fn validate_release_keyring(payload: &ReleaseKeyringPayloadV1, now: DateTime<Utc>) -> Result<()> {
    if payload.sequence == 0 {
        return Err(BootstrapError::Validation(
            "release keyring sequence must be greater than zero".to_string(),
        ));
    }
    let generated = parse_time("keyring generatedAt", &payload.generated_at)?;
    let expires = parse_time("keyring expiresAt", &payload.expires_at)?;
    if generated >= expires || expires <= now || generated > now + Duration::minutes(10) {
        return Err(BootstrapError::Validation(
            "release keyring validity window is invalid".to_string(),
        ));
    }
    if payload.keys.is_empty() {
        return Err(BootstrapError::Validation(
            "release keyring has no release keys".to_string(),
        ));
    }
    let mut key_ids = HashSet::new();
    for key in &payload.keys {
        validate_identifier("release keyId", &key.key_id)?;
        decode_verifying_key(&key.public_key)?;
        if key.publisher.trim().is_empty() || key.channels.is_empty() {
            return Err(BootstrapError::Validation(format!(
                "release key `{}` has no publisher or channel",
                key.key_id
            )));
        }
        let mut channels = HashSet::new();
        for channel in &key.channels {
            if !matches!(channel.as_str(), "stable" | "preview")
                || !channels.insert(channel.as_str())
            {
                return Err(BootstrapError::Validation(format!(
                    "release key `{}` has an invalid or duplicate channel",
                    key.key_id
                )));
            }
        }
        if key.component_kinds.is_empty() {
            return Err(BootstrapError::Validation(format!(
                "release key `{}` has no component kind scope",
                key.key_id
            )));
        }
        let mut component_kinds = HashSet::new();
        for kind in &key.component_kinds {
            if !matches!(
                kind.as_str(),
                "core" | "runtime" | "app" | "resource" | "extension"
            ) || !component_kinds.insert(kind.as_str())
            {
                return Err(BootstrapError::Validation(format!(
                    "release key `{}` has an invalid or duplicate component kind",
                    key.key_id
                )));
            }
        }
        if key.component_id_prefixes.is_empty() {
            return Err(BootstrapError::Validation(format!(
                "release key `{}` has no component ID prefix scope",
                key.key_id
            )));
        }
        let mut component_id_prefixes = HashSet::new();
        for prefix in &key.component_id_prefixes {
            validate_component_id(prefix)?;
            if !component_id_prefixes.insert(prefix.as_str()) {
                return Err(BootstrapError::Validation(format!(
                    "release key `{}` has a duplicate component ID prefix",
                    key.key_id
                )));
            }
        }
        let mut execution_classes = HashSet::new();
        for execution_class in &key.execution_classes {
            if !matches!(
                execution_class.as_str(),
                "first-party-shared-renderer" | "sandboxed-web" | "sandboxed-web-wasi"
            ) || !execution_classes.insert(execution_class.as_str())
            {
                return Err(BootstrapError::Validation(format!(
                    "release key `{}` has an invalid or duplicate execution class",
                    key.key_id
                )));
            }
        }
        let valid_from = parse_time("release key validFrom", &key.valid_from)?;
        let valid_until = parse_time("release key validUntil", &key.valid_until)?;
        if valid_from >= valid_until || !key_ids.insert(key.key_id.as_str()) {
            return Err(BootstrapError::Validation(format!(
                "release key `{}` is invalid or duplicated",
                key.key_id
            )));
        }
    }
    let mut revoked = HashSet::new();
    for key_id in &payload.revoked_key_ids {
        validate_identifier("revoked release keyId", key_id)?;
        if !revoked.insert(key_id.as_str()) {
            return Err(BootstrapError::Validation(format!(
                "duplicate revoked release key `{key_id}`"
            )));
        }
    }
    Ok(())
}

fn release_key_for<'a>(
    catalog: &'a SignedChannelCatalogV1,
    key_id: &str,
) -> Result<&'a ReleaseKeyV1> {
    if catalog
        .keyring
        .payload
        .revoked_key_ids
        .iter()
        .any(|revoked| revoked == key_id)
    {
        return Err(BootstrapError::Trust(format!(
            "release signing key `{key_id}` is revoked"
        )));
    }
    catalog
        .keyring
        .payload
        .keys
        .iter()
        .find(|key| key.key_id == key_id)
        .ok_or_else(|| BootstrapError::Trust(format!("unknown release signing key `{key_id}`")))
}

fn authorize_execution_class(
    catalog: &SignedChannelCatalogV1,
    key_id: &str,
    execution_class: Option<&str>,
) -> Result<()> {
    let Some(execution_class) = execution_class else {
        return Ok(());
    };
    let key = release_key_for(catalog, key_id)?;
    if key
        .execution_classes
        .iter()
        .any(|authorized| authorized == execution_class)
    {
        return Ok(());
    }
    Err(BootstrapError::Trust(format!(
        "release signing key `{key_id}` is not root-authorized for execution class `{execution_class}`"
    )))
}

fn authorize_component_scope(
    catalog: &SignedChannelCatalogV1,
    key_id: &str,
    kind: &str,
    component_id: &str,
) -> Result<()> {
    let key = release_key_for(catalog, key_id)?;
    if !key
        .component_kinds
        .iter()
        .any(|authorized| authorized == kind)
    {
        return Err(BootstrapError::Trust(format!(
            "release signing key `{key_id}` is not root-authorized for component kind `{kind}`"
        )));
    }
    if !key
        .component_id_prefixes
        .iter()
        .any(|prefix| component_id.starts_with(prefix))
    {
        return Err(BootstrapError::Trust(format!(
            "release signing key `{key_id}` is not root-authorized for component ID `{component_id}`"
        )));
    }
    Ok(())
}

fn authorize_component_publisher(
    catalog: &SignedChannelCatalogV1,
    key_id: &str,
    publisher: &str,
) -> Result<()> {
    let signing_key = release_key_for(catalog, key_id)?;
    if publisher == signing_key.publisher {
        return Ok(());
    }
    Err(BootstrapError::Trust(format!(
        "component publisher is not authorized by release key `{key_id}`"
    )))
}

fn require_catalog_signing_key(
    catalog: &SignedChannelCatalogV1,
    _now: DateTime<Utc>,
) -> Result<&ReleaseKeyV1> {
    let key = release_key_for(catalog, &catalog.signature.key_id)?;
    let keyring_generated =
        parse_time("keyring generatedAt", &catalog.keyring.payload.generated_at)?;
    let keyring_expires = parse_time("keyring expiresAt", &catalog.keyring.payload.expires_at)?;
    let catalog_generated = parse_time("catalog generatedAt", &catalog.payload.generated_at)?;
    let catalog_expires = parse_time("catalog expiresAt", &catalog.payload.expires_at)?;
    let key_valid_from = parse_time("release key validFrom", &key.valid_from)?;
    let key_valid_until = parse_time("release key validUntil", &key.valid_until)?;
    if !key
        .channels
        .iter()
        .any(|channel| channel == &catalog.payload.channel)
        || catalog_generated < keyring_generated
        || catalog_expires > keyring_expires
        || catalog_generated < key_valid_from
        || catalog_expires > key_valid_until
        || catalog
            .payload
            .releases
            .iter()
            .any(|release| release.key_id != key.key_id)
        || catalog
            .payload
            .component_latest
            .iter()
            .flatten()
            .any(|component| component.key_id != key.key_id)
    {
        return Err(BootstrapError::Trust(
            "catalog signing key is outside its signed scope or validity window".to_string(),
        ));
    }
    Ok(key)
}

fn verify_release_signature(
    catalog: &SignedChannelCatalogV1,
    key_id: &str,
    message: &[u8],
    signature: &str,
) -> Result<()> {
    let key = release_key_for(catalog, key_id)?;
    if !key
        .channels
        .iter()
        .any(|channel| channel == &catalog.payload.channel)
    {
        return Err(BootstrapError::Trust(format!(
            "release signing key `{key_id}` is not authorized for channel `{}`",
            catalog.payload.channel
        )));
    }
    verify_with_key(&decode_verifying_key(&key.public_key)?, message, signature)
}

pub fn select_release<'a>(
    catalog: &'a SignedChannelCatalogV1,
    requested: Option<&str>,
) -> Result<&'a CatalogReleaseV1> {
    if let Some(requested) = requested {
        return catalog
            .payload
            .releases
            .iter()
            .find(|release| release.version == requested)
            .ok_or_else(|| {
                BootstrapError::Validation(format!(
                    "release `{requested}` is not present in the signed catalog"
                ))
            });
    }
    catalog
        .payload
        .releases
        .iter()
        .max_by(|left, right| {
            let left = Version::parse(&left.version).ok();
            let right = Version::parse(&right.version).ok();
            left.cmp(&right)
        })
        .ok_or_else(|| BootstrapError::Validation("catalog has no releases".to_string()))
}

pub fn select_component_latest<'a>(
    catalog: &'a SignedChannelCatalogV1,
    component_id: &str,
    target: &Target,
) -> Result<&'a ReleaseBomComponentV1> {
    let latest = catalog.payload.component_latest.as_ref().ok_or_else(|| {
        BootstrapError::Validation("catalog has no componentLatest entries".to_string())
    })?;
    latest
        .iter()
        .find(|c| c.component_id == component_id && c.target == target.as_str())
        .ok_or_else(|| {
            BootstrapError::Validation(format!(
                "component `{component_id}` for target `{}` is not in componentLatest",
                target.as_str()
            ))
        })
}

pub(crate) fn persist_verified_keyring(
    state_root: &Path,
    catalog: &SignedChannelCatalogV1,
) -> Result<()> {
    let directory = state_root.join("trust-v1");
    fs::create_dir_all(&directory).map_err(|error| BootstrapError::io(&directory, error))?;
    let bytes = serde_json::to_vec_pretty(&catalog.keyring)
        .map_err(|error| BootstrapError::Json("release keyring", error))?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let prefix = format!("keyring-{:020}-", catalog.keyring.payload.sequence);
    for entry in fs::read_dir(&directory).map_err(|error| BootstrapError::io(&directory, error))? {
        let entry = entry.map_err(|error| BootstrapError::io(&directory, error))?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with(&prefix) && name.ends_with(".json") {
            if name == format!("{prefix}{digest}.json") {
                return Ok(());
            }
            return Err(BootstrapError::Trust(format!(
                "release keyring sequence {} already exists with different content",
                catalog.keyring.payload.sequence
            )));
        }
    }
    let final_path = directory.join(format!("{prefix}{digest}.json"));
    let temporary = directory.join(format!(".keyring-{}.tmp", Uuid::new_v4()));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| BootstrapError::io(&temporary, error))?;
    file.write_all(&bytes)
        .map_err(|error| BootstrapError::io(&temporary, error))?;
    file.sync_all()
        .map_err(|error| BootstrapError::io(&temporary, error))?;
    fs::rename(&temporary, &final_path).map_err(|error| BootstrapError::io(&final_path, error))?;
    sync_trust_directory(&directory)?;
    Ok(())
}

#[cfg(unix)]
fn sync_trust_directory(directory: &Path) -> Result<()> {
    File::open(directory)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| BootstrapError::io(directory, error))
}

#[cfg(not(unix))]
fn sync_trust_directory(_directory: &Path) -> Result<()> {
    Ok(())
}

pub fn parse_and_verify_bom(
    bytes: &[u8],
    release: &CatalogReleaseV1,
    catalog: &SignedChannelCatalogV1,
    target: &Target,
) -> Result<ReleaseBomV1> {
    crate::download::verify_sha256_bytes(bytes, &release.bom_sha256)?;
    let bom: ReleaseBomV1 = serde_json::from_slice(bytes)
        .map_err(|error| BootstrapError::Json("release BOM", error))?;
    verify_release_signature(
        catalog,
        &release.key_id,
        &canonical_json(&bom)?,
        &release.bom_signature,
    )?;
    validate_bom(&bom, release, catalog, target)?;
    Ok(bom)
}

pub fn verify_component_signature(
    component: &ReleaseBomComponentV1,
    catalog: &SignedChannelCatalogV1,
) -> Result<()> {
    let payload = ComponentSignaturePayload::from(component);
    verify_release_signature(
        catalog,
        &component.key_id,
        &canonical_json(&payload)?,
        &component.signature,
    )?;
    authorize_component_scope(
        catalog,
        &component.key_id,
        &component.kind,
        &component.component_id,
    )?;
    authorize_execution_class(
        catalog,
        &component.key_id,
        component.execution_class.as_deref(),
    )
}

pub(crate) fn parse_and_verify_component_manifest(
    bytes: &[u8],
    component: &ReleaseBomComponentV1,
    inventory: &[InstalledFileV1],
    catalog: &SignedChannelCatalogV1,
) -> Result<ComponentManifestV1> {
    let manifest: ComponentManifestV1 = serde_json::from_slice(bytes)
        .map_err(|error| BootstrapError::Json("component manifest", error))?;
    if manifest.schema_version != 1 {
        return Err(BootstrapError::Validation(format!(
            "unsupported component manifest schema {}",
            manifest.schema_version
        )));
    }
    validate_component_id(&manifest.component_id)?;
    validate_identifier("component keyId", &manifest.key_id)?;
    validate_signature_text(&manifest.signature)?;
    let mut unsigned = serde_json::to_value(&manifest)
        .map_err(|error| BootstrapError::Json("component manifest signature payload", error))?;
    unsigned
        .as_object_mut()
        .ok_or_else(|| {
            BootstrapError::Validation("component manifest is not an object".to_string())
        })?
        .remove("signature");
    verify_release_signature(
        catalog,
        &manifest.key_id,
        &canonical_json(&unsigned)?,
        &manifest.signature,
    )?;
    authorize_component_scope(
        catalog,
        &manifest.key_id,
        &manifest.kind,
        &manifest.component_id,
    )?;
    authorize_execution_class(
        catalog,
        &manifest.key_id,
        manifest.execution_class.as_deref(),
    )?;
    authorize_component_publisher(catalog, &manifest.key_id, &manifest.publisher)?;

    if manifest.component_id != component.component_id
        || manifest.kind != component.kind
        || manifest.version != component.version
        || manifest.target != component.target
        || manifest.entry != component.entry
        || manifest.execution_class != component.execution_class
        || manifest.activation != component.activation
        || manifest.key_id != component.key_id
    {
        return Err(BootstrapError::Trust(format!(
            "component manifest identity does not match BOM for {}@{}",
            component.component_id, component.version
        )));
    }
    parse_version("component manifest version", &manifest.version)?;
    if !matches!(
        manifest.kind.as_str(),
        "core" | "runtime" | "app" | "resource" | "extension"
    ) || !matches!(
        manifest.activation.as_str(),
        "core-restart" | "module-idle" | "runtime-idle" | "resource-idle" | "next-session"
    ) {
        return Err(BootstrapError::Validation(format!(
            "component manifest kind or activation is invalid: {}",
            manifest.component_id
        )));
    }
    validate_execution_class(&manifest.kind, manifest.execution_class.as_deref())?;
    if manifest.publisher.trim().is_empty() {
        return Err(BootstrapError::Validation(
            "component manifest publisher is empty".to_string(),
        ));
    }
    if let Some(range) = manifest.host_api_range.as_ref() {
        parse_version("host API minimum", &range.min_inclusive)?;
        if let Some(maximum) = range.max_exclusive.as_deref() {
            parse_version("host API maximum", maximum)?;
        }
    }
    if let Some(range) = manifest.runtime_protocol_range.as_ref()
        && (range.min == 0 || range.min > range.max)
    {
        return Err(BootstrapError::Validation(
            "component runtime protocol range is invalid".to_string(),
        ));
    }
    if manifest.data_schema.reader_min == 0
        || manifest.data_schema.reader_min > manifest.data_schema.writer
        || manifest.data_schema.writer > manifest.data_schema.reader_max
    {
        return Err(BootstrapError::Validation(
            "component data schema range is invalid".to_string(),
        ));
    }
    let mut permissions = HashSet::new();
    for permission in &manifest.permissions {
        if !valid_permission(permission) || !permissions.insert(permission.as_str()) {
            return Err(BootstrapError::Validation(format!(
                "invalid or duplicate component permission `{permission}`"
            )));
        }
    }
    if manifest.files.is_empty() || inventory.len() != manifest.files.len().saturating_add(1) {
        return Err(BootstrapError::Trust(
            "component manifest file inventory is incomplete".to_string(),
        ));
    }
    let actual = inventory
        .iter()
        .map(|file| (file.path.as_str(), file))
        .collect::<HashMap<_, _>>();
    if !actual.contains_key("component.json") {
        return Err(BootstrapError::Trust(
            "component archive does not contain component.json".to_string(),
        ));
    }
    let mut declared = HashSet::new();
    for file in &manifest.files {
        crate::archive::validate_relative_path(&file.path)?;
        validate_sha256(&file.sha256)?;
        if file.path == "component.json" || !declared.insert(file.path.as_str()) {
            return Err(BootstrapError::Validation(format!(
                "invalid or duplicate component file `{}`",
                file.path
            )));
        }
        let Some(installed) = actual.get(file.path.as_str()) else {
            return Err(BootstrapError::Trust(format!(
                "component manifest file is missing from archive: {}",
                file.path
            )));
        };
        if installed.size != file.size || installed.sha256 != file.sha256 {
            return Err(BootstrapError::Trust(format!(
                "component manifest file digest does not match archive: {}",
                file.path
            )));
        }
    }
    if let Some(entry) = manifest.entry.as_deref()
        && !declared.contains(entry)
    {
        return Err(BootstrapError::Validation(format!(
            "component entry is not declared in files: {entry}"
        )));
    }
    Ok(manifest)
}

fn valid_permission(value: &str) -> bool {
    let mut segments = value.split(':');
    let Some(first) = segments.next() else {
        return false;
    };
    !first.is_empty()
        && first
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && segments.all(|segment| {
            !segment.is_empty()
                && segment.bytes().all(|byte| {
                    byte.is_ascii_lowercase()
                        || byte.is_ascii_digit()
                        || matches!(byte, b'.' | b'_' | b'-')
                })
        })
}

fn validate_execution_class(kind: &str, execution_class: Option<&str>) -> Result<()> {
    let valid = if kind == "app" {
        matches!(
            execution_class,
            Some("first-party-shared-renderer" | "sandboxed-web" | "sandboxed-web-wasi")
        )
    } else {
        execution_class.is_none()
    };
    if !valid {
        return Err(BootstrapError::Validation(format!(
            "component kind `{kind}` has an invalid execution class"
        )));
    }
    Ok(())
}

fn validate_catalog_payload(payload: &ChannelCatalogPayloadV1, now: DateTime<Utc>) -> Result<()> {
    if payload.sequence == 0 {
        return Err(BootstrapError::Validation(
            "catalog sequence must be greater than zero".to_string(),
        ));
    }
    if payload.channel.trim().is_empty() {
        return Err(BootstrapError::Validation(
            "catalog channel is empty".to_string(),
        ));
    }
    let generated = parse_time("generatedAt", &payload.generated_at)?;
    let expires = parse_time("expiresAt", &payload.expires_at)?;
    if generated >= expires {
        return Err(BootstrapError::Validation(
            "catalog expiresAt must be after generatedAt".to_string(),
        ));
    }
    if expires <= now {
        return Err(BootstrapError::Validation(
            "signed catalog has expired".to_string(),
        ));
    }
    if generated > now + Duration::minutes(10) {
        return Err(BootstrapError::Validation(
            "catalog generatedAt is too far in the future".to_string(),
        ));
    }
    if let Some(version) = payload.minimum_safe_core_version.as_deref() {
        parse_version("minimumSafeCoreVersion", version)?;
    }
    let mut releases = HashSet::new();
    for release in &payload.releases {
        parse_version("release version", &release.version)?;
        validate_https_url(&release.bom_url)?;
        validate_sha256(&release.bom_sha256)?;
        validate_signature_text(&release.bom_signature)?;
        validate_identifier("keyId", &release.key_id)?;
        if !releases.insert(release.version.as_str()) {
            return Err(BootstrapError::Validation(format!(
                "duplicate release version `{}`",
                release.version
            )));
        }
    }
    if payload.releases.is_empty() {
        return Err(BootstrapError::Validation(
            "catalog has no releases".to_string(),
        ));
    }
    for revocation in &payload.revocations {
        validate_component_id(&revocation.component_id)?;
        parse_version("revoked component version", &revocation.version)?;
    }
    if let Some(latest) = payload.component_latest.as_ref() {
        let mut latest_ids = HashSet::new();
        for component in latest {
            validate_component_fields(component)?;
            if !latest_ids.insert((
                component.component_id.as_str(),
                component.target.as_str(),
                component.version.as_str(),
            )) {
                return Err(BootstrapError::Validation(format!(
                    "duplicate componentLatest entry for `{}` {} {}",
                    component.component_id, component.target, component.version
                )));
            }
        }
    }
    Ok(())
}

fn validate_bom(
    bom: &ReleaseBomV1,
    release: &CatalogReleaseV1,
    catalog: &SignedChannelCatalogV1,
    target: &Target,
) -> Result<()> {
    if bom.schema_version != 1 {
        return Err(BootstrapError::Validation(format!(
            "unsupported BOM schema version {}",
            bom.schema_version
        )));
    }
    if bom.release_version != release.version {
        return Err(BootstrapError::Validation(format!(
            "BOM release `{}` does not match catalog release `{}`",
            bom.release_version, release.version
        )));
    }
    if bom.channel != catalog.payload.channel {
        return Err(BootstrapError::Validation(format!(
            "BOM channel `{}` does not match catalog channel `{}`",
            bom.channel, catalog.payload.channel
        )));
    }
    if bom.target != target.as_str() {
        return Err(BootstrapError::TargetMismatch {
            expected: target.as_str().to_string(),
            actual: bom.target.clone(),
        });
    }
    parse_version("releaseVersion", &bom.release_version)?;
    let core_version = parse_version("coreVersion", &bom.core_version)?;
    if bom.host_api_version.trim().is_empty() {
        return Err(BootstrapError::Validation(
            "hostApiVersion is empty".to_string(),
        ));
    }
    if let Some(minimum) = catalog.payload.minimum_safe_core_version.as_deref() {
        let minimum = parse_version("minimumSafeCoreVersion", minimum)?;
        if core_version < minimum {
            return Err(BootstrapError::Validation(format!(
                "BOM core version {core_version} is below the signed minimum {minimum}"
            )));
        }
    }
    if bom.components.is_empty() {
        return Err(BootstrapError::Validation(
            "release BOM has no components".to_string(),
        ));
    }
    let mut ids = HashSet::new();
    let mut core_count = 0_u8;
    for component in &bom.components {
        validate_component(component, target)?;
        authorize_component_scope(
            catalog,
            &component.key_id,
            &component.kind,
            &component.component_id,
        )?;
        authorize_execution_class(
            catalog,
            &component.key_id,
            component.execution_class.as_deref(),
        )?;
        if !ids.insert(component.component_id.as_str()) {
            return Err(BootstrapError::Validation(format!(
                "duplicate component `{}` in release BOM",
                component.component_id
            )));
        }
        if component.kind == "core" {
            core_count = core_count.saturating_add(1);
            if component.version != bom.core_version {
                return Err(BootstrapError::Validation(format!(
                    "core component version {} does not match coreVersion {}",
                    component.version, bom.core_version
                )));
            }
        }
        if let Some(revocation) = catalog.payload.revocations.iter().find(|revocation| {
            revocation.component_id == component.component_id
                && revocation.version == component.version
        }) {
            let reason = revocation.reason.as_deref().unwrap_or("no reason provided");
            return Err(BootstrapError::Trust(format!(
                "component {} {} is revoked: {reason}",
                component.component_id, component.version
            )));
        }
    }
    if core_count != 1 {
        return Err(BootstrapError::Validation(format!(
            "release BOM must contain exactly one core component, found {core_count}"
        )));
    }
    Ok(())
}

fn validate_component_fields(component: &ReleaseBomComponentV1) -> Result<()> {
    validate_component_id(&component.component_id)?;
    if component.kind.trim().is_empty() || component.activation.trim().is_empty() {
        return Err(BootstrapError::Validation(format!(
            "component `{}` has an empty kind or activation",
            component.component_id
        )));
    }
    if !matches!(component.delivery.as_str(), "required" | "on-demand") {
        return Err(BootstrapError::Validation(format!(
            "component `{}` has invalid delivery `{}`",
            component.component_id, component.delivery
        )));
    }
    validate_execution_class(&component.kind, component.execution_class.as_deref())?;
    parse_version("component version", &component.version)?;
    validate_https_url(&component.url)?;
    if component.size == 0 {
        return Err(BootstrapError::Validation(format!(
            "component `{}` has zero size",
            component.component_id
        )));
    }
    validate_sha256(&component.sha256)?;
    validate_signature_text(&component.signature)?;
    validate_identifier("keyId", &component.key_id)?;
    if let Some(entry) = component.entry.as_deref() {
        crate::archive::validate_relative_path(entry)?;
    }
    if let Some(version) = component.min_core_version.as_deref() {
        parse_version("minCoreVersion", version)?;
    }
    Ok(())
}

fn validate_component(component: &ReleaseBomComponentV1, target: &Target) -> Result<()> {
    validate_component_fields(component)?;
    if component.target != target.as_str() {
        return Err(BootstrapError::TargetMismatch {
            expected: target.as_str().to_string(),
            actual: component.target.clone(),
        });
    }
    Ok(())
}

pub(crate) fn validate_https_url(value: &str) -> Result<reqwest::Url> {
    let url = reqwest::Url::parse(value)
        .map_err(|error| BootstrapError::Validation(format!("invalid URL: {error}")))?;
    if url.scheme() != "https" {
        return Err(BootstrapError::Validation(
            "bootstrap downloads require HTTPS".to_string(),
        ));
    }
    if url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err(BootstrapError::Validation(
            "download URL must have a host and must not contain credentials".to_string(),
        ));
    }
    if url.fragment().is_some() {
        return Err(BootstrapError::Validation(
            "download URL must not contain a fragment".to_string(),
        ));
    }
    Ok(url)
}

pub(crate) fn validate_sha256(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(BootstrapError::Validation(
            "SHA-256 values must be 64 lowercase hexadecimal characters".to_string(),
        ));
    }
    Ok(())
}

fn validate_signature_text(value: &str) -> Result<()> {
    let decoded = STANDARD
        .decode(value)
        .map_err(|error| BootstrapError::Trust(format!("invalid signature base64: {error}")))?;
    if decoded.len() != 64 {
        return Err(BootstrapError::Trust(
            "an Ed25519 signature must contain 64 bytes".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn validate_component_id(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-' | b'_')
        })
    {
        return Err(BootstrapError::Validation(format!(
            "invalid component id `{value}`"
        )));
    }
    Ok(())
}

fn validate_identifier(label: &str, value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
    {
        return Err(BootstrapError::Validation(format!(
            "invalid {label} `{value}`"
        )));
    }
    Ok(())
}

fn parse_version(label: &str, value: &str) -> Result<Version> {
    Version::parse(value)
        .map_err(|error| BootstrapError::Validation(format!("invalid {label}: {error}")))
}

fn parse_time(label: &str, value: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|error| BootstrapError::Validation(format!("invalid {label}: {error}")))
}

pub(crate) fn canonical_json<T: Serialize>(value: &T) -> Result<Vec<u8>> {
    let value = serde_json::to_value(value)
        .map_err(|error| BootstrapError::Json("signature payload", error))?;
    let mut output = Vec::new();
    write_canonical_value(&value, &mut output)?;
    Ok(output)
}

fn write_canonical_value(value: &Value, output: &mut Vec<u8>) -> Result<()> {
    match value {
        Value::Null => output.extend_from_slice(b"null"),
        Value::Bool(value) => output.extend_from_slice(if *value { b"true" } else { b"false" }),
        Value::Number(value) => {
            if value.is_f64() {
                return Err(BootstrapError::Validation(
                    "floating-point values are not allowed in signed payloads".to_string(),
                ));
            }
            output.extend_from_slice(value.to_string().as_bytes());
        }
        Value::String(value) => {
            let encoded = serde_json::to_string(value)
                .map_err(|error| BootstrapError::Json("signature string", error))?;
            output.extend_from_slice(encoded.as_bytes());
        }
        Value::Array(values) => {
            output.push(b'[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                write_canonical_value(value, output)?;
            }
            output.push(b']');
        }
        Value::Object(values) => {
            output.push(b'{');
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            for (index, key) in keys.into_iter().enumerate() {
                if index > 0 {
                    output.push(b',');
                }
                let encoded = serde_json::to_string(key)
                    .map_err(|error| BootstrapError::Json("signature key", error))?;
                output.extend_from_slice(encoded.as_bytes());
                output.push(b':');
                write_canonical_value(&values[key], output)?;
            }
            output.push(b'}');
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ComponentSignaturePayload<'a> {
    component_id: &'a str,
    kind: &'a str,
    version: &'a str,
    target: &'a str,
    url: &'a str,
    size: u64,
    sha256: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    entry: Option<&'a String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    execution_class: Option<&'a String>,
    activation: &'a str,
    delivery: &'a str,
    key_id: &'a str,
}

impl<'a> From<&'a ReleaseBomComponentV1> for ComponentSignaturePayload<'a> {
    fn from(component: &'a ReleaseBomComponentV1) -> Self {
        Self {
            component_id: &component.component_id,
            kind: &component.kind,
            version: &component.version,
            target: &component.target,
            url: &component.url,
            size: component.size,
            sha256: &component.sha256,
            entry: component.entry.as_ref(),
            execution_class: component.execution_class.as_ref(),
            activation: &component.activation,
            delivery: &component.delivery,
            key_id: &component.key_id,
        }
    }
}

#[cfg(test)]
mod tests {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use chrono::TimeZone;
    use ed25519_dalek::{Signer, SigningKey};

    use super::*;
    use crate::model::{
        CatalogReleaseV1, ChannelCatalogPayloadV1, ReleaseBomComponentV1, ReleaseKeyV1,
        ReleaseKeyringPayloadV1, SignatureV1, SignedReleaseKeyringV1,
    };

    #[test]
    fn verifies_catalog_signature_before_using_payload() {
        let root_key = SigningKey::from_bytes(&[8_u8; 32]);
        let signing_key = SigningKey::from_bytes(&[7_u8; 32]);
        let mut catalog = sample_catalog();
        catalog.keyring.payload.keys[0].public_key =
            STANDARD.encode(signing_key.verifying_key().to_bytes());
        catalog.keyring.signature.value = STANDARD.encode(
            root_key
                .sign(&canonical_json(&catalog.keyring.payload).expect("canonical keyring"))
                .to_bytes(),
        );
        catalog.signature.value = STANDARD.encode(
            signing_key
                .sign(&canonical_json(&catalog.payload).expect("canonical payload"))
                .to_bytes(),
        );
        let mut keys = TrustedKeys::new();
        keys.insert_base64(
            "root-1",
            &STANDARD.encode(root_key.verifying_key().to_bytes()),
        )
        .expect("trusted key");
        let bytes = serde_json::to_vec(&catalog).expect("catalog JSON");
        let now = Utc
            .with_ymd_and_hms(2026, 7, 31, 0, 0, 0)
            .single()
            .expect("test time");
        parse_and_verify_catalog(&bytes, &keys, now).expect("verified catalog");

        catalog.payload.sequence = 2;
        let tampered = serde_json::to_vec(&catalog).expect("tampered catalog JSON");
        assert!(matches!(
            parse_and_verify_catalog(&tampered, &keys, now),
            Err(BootstrapError::Trust(_))
        ));
    }

    #[test]
    fn rejects_bom_for_a_different_target() {
        let target = Target::parse("darwin-arm64").expect("target");
        let catalog = sample_catalog();
        let release = &catalog.payload.releases[0];
        let mut bom = sample_bom();
        bom.target = "linux-arm64".to_string();
        bom.components[0].target = "linux-arm64".to_string();

        let result = validate_bom(&bom, release, &catalog, &target);
        assert!(matches!(result, Err(BootstrapError::TargetMismatch { .. })));
    }

    #[test]
    fn requires_exactly_one_core_matching_core_version() {
        let target = Target::parse("darwin-arm64").expect("target");
        let catalog = sample_catalog();
        let release = &catalog.payload.releases[0];
        let mut bom = sample_bom();
        bom.components[0].version = "1.0.1".to_string();

        let result = validate_bom(&bom, release, &catalog, &target);
        assert!(matches!(result, Err(BootstrapError::Validation(_))));
    }

    #[test]
    fn rejects_execution_class_outside_the_root_signed_key_scope() {
        let target = Target::parse("darwin-arm64").expect("target");
        let mut catalog = sample_catalog();
        catalog.keyring.payload.keys[0].execution_classes = vec![
            "sandboxed-web".to_string(),
            "sandboxed-web-wasi".to_string(),
        ];
        let release = &catalog.payload.releases[0];
        let mut bom = sample_bom();
        bom.components.push(ReleaseBomComponentV1 {
            component_id: "lyra.images".to_string(),
            kind: "app".to_string(),
            version: "1.0.0".to_string(),
            target: "darwin-arm64".to_string(),
            url: "https://example.com/images.zip".to_string(),
            size: 100,
            sha256: "0".repeat(64),
            signature: STANDARD.encode([0_u8; 64]),
            key_id: "release-1".to_string(),
            entry: Some("index.mjs".to_string()),
            execution_class: Some("first-party-shared-renderer".to_string()),
            activation: "module-idle".to_string(),
            delivery: "required".to_string(),
            min_core_version: None,
        });

        let result = validate_bom(&bom, release, &catalog, &target);
        assert!(matches!(result, Err(BootstrapError::Trust(_))));
    }

    #[test]
    fn rejects_component_kind_and_id_outside_the_root_signed_key_scope() {
        let target = Target::parse("darwin-arm64").expect("target");
        let mut app_only_catalog = sample_catalog();
        app_only_catalog.keyring.payload.keys[0].component_kinds = vec!["app".to_string()];
        let app_only_result = validate_bom(
            &sample_bom(),
            &app_only_catalog.payload.releases[0],
            &app_only_catalog,
            &target,
        );
        assert!(matches!(app_only_result, Err(BootstrapError::Trust(_))));

        let mut foreign_namespace_catalog = sample_catalog();
        foreign_namespace_catalog.keyring.payload.keys[0].component_id_prefixes =
            vec!["example.".to_string()];
        let foreign_namespace_result = validate_bom(
            &sample_bom(),
            &foreign_namespace_catalog.payload.releases[0],
            &foreign_namespace_catalog,
            &target,
        );
        assert!(matches!(
            foreign_namespace_result,
            Err(BootstrapError::Trust(_))
        ));
    }

    #[test]
    fn rejects_invalid_root_signed_component_scopes() {
        let now = Utc
            .with_ymd_and_hms(2026, 7, 31, 0, 0, 0)
            .single()
            .expect("test time");
        let mut duplicate_kind = sample_catalog().keyring.payload;
        duplicate_kind.keys[0].component_kinds = vec!["app".to_string(), "app".to_string()];
        assert!(matches!(
            validate_release_keyring(&duplicate_kind, now),
            Err(BootstrapError::Validation(_))
        ));

        let mut invalid_prefix = sample_catalog().keyring.payload;
        invalid_prefix.keys[0].component_id_prefixes = vec!["Example.".to_string()];
        assert!(matches!(
            validate_release_keyring(&invalid_prefix, now),
            Err(BootstrapError::Validation(_))
        ));
    }

    #[test]
    fn rejects_component_publisher_not_bound_to_the_root_signed_key() {
        let catalog = sample_catalog();
        assert!(authorize_component_publisher(&catalog, "release-1", "Lyra").is_ok());
        assert!(matches!(
            authorize_component_publisher(&catalog, "release-1", "Impostor Publisher"),
            Err(BootstrapError::Trust(_))
        ));
    }

    #[test]
    fn rejects_legacy_keyrings_without_explicit_release_key_scopes() {
        for field in ["componentKinds", "componentIdPrefixes", "executionClasses"] {
            let mut value = serde_json::to_value(sample_catalog()).expect("catalog JSON");
            value["keyring"]["payload"]["keys"][0]
                .as_object_mut()
                .expect("release key")
                .remove(field);
            assert!(
                serde_json::from_value::<SignedChannelCatalogV1>(value).is_err(),
                "legacy keyring unexpectedly accepted without {field}"
            );
        }
    }

    fn sample_catalog() -> SignedChannelCatalogV1 {
        SignedChannelCatalogV1 {
            schema_version: 1,
            keyring: SignedReleaseKeyringV1 {
                schema_version: 1,
                payload: ReleaseKeyringPayloadV1 {
                    sequence: 1,
                    generated_at: "2026-07-29T00:00:00Z".to_string(),
                    expires_at: "2026-09-30T00:00:00Z".to_string(),
                    keys: vec![ReleaseKeyV1 {
                        key_id: "release-1".to_string(),
                        public_key: STANDARD.encode([0_u8; 32]),
                        publisher: "Lyra".to_string(),
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
                        valid_from: "2026-07-29T00:00:00Z".to_string(),
                        valid_until: "2026-09-30T00:00:00Z".to_string(),
                    }],
                    revoked_key_ids: Vec::new(),
                },
                signature: SignatureV1 {
                    algorithm: "ed25519".to_string(),
                    key_id: "root-1".to_string(),
                    value: STANDARD.encode([0_u8; 64]),
                },
            },
            payload: ChannelCatalogPayloadV1 {
                sequence: 1,
                channel: "preview".to_string(),
                generated_at: "2026-07-30T00:00:00Z".to_string(),
                expires_at: "2026-08-30T00:00:00Z".to_string(),
                minimum_safe_core_version: None,
                revocations: Vec::new(),
                releases: vec![CatalogReleaseV1 {
                    version: "1.0.0".to_string(),
                    bom_url: "https://example.com/release.json".to_string(),
                    bom_sha256: "0".repeat(64),
                    bom_signature: STANDARD.encode([0_u8; 64]),
                    key_id: "release-1".to_string(),
                }],
                component_latest: None,
            },
            signature: SignatureV1 {
                algorithm: "ed25519".to_string(),
                key_id: "release-1".to_string(),
                value: STANDARD.encode([0_u8; 64]),
            },
        }
    }

    fn sample_bom() -> ReleaseBomV1 {
        ReleaseBomV1 {
            schema_version: 1,
            release_version: "1.0.0".to_string(),
            channel: "preview".to_string(),
            target: "darwin-arm64".to_string(),
            core_version: "1.0.0".to_string(),
            host_api_version: "1".to_string(),
            components: vec![ReleaseBomComponentV1 {
                component_id: "lyra.core".to_string(),
                kind: "core".to_string(),
                version: "1.0.0".to_string(),
                target: "darwin-arm64".to_string(),
                url: "https://example.com/core.zip".to_string(),
                size: 100,
                sha256: "0".repeat(64),
                signature: STANDARD.encode([0_u8; 64]),
                key_id: "release-1".to_string(),
                entry: Some("Lyra.app/Contents/MacOS/Lyra".to_string()),
                execution_class: None,
                activation: "core-restart".to_string(),
                delivery: "required".to_string(),
                min_core_version: None,
            }],
        }
    }
}
