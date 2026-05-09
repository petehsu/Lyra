use anyhow::{anyhow, bail, Context, Result};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::Read;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

mod agent_vm;
pub use agent_vm::{
    apply_inheritance_profile_json, attach_session_vm_json, create_inheritance_profile_json,
    create_session_vm_json, fork_session_vm_json, list_agent_vms_json, list_session_bindings_json,
    read_session_binding_json, revoke_session_binding_json, takeover_session_vm_json,
};

const MANIFEST_FILE: &str = "image-manifest.v1.json";
const IMAGE_RECORD_FILE: &str = "image-record.v1.json";
const INSTANCE_FILE: &str = "instance.v1.json";
const DEFAULT_MEMORY_MIB: u32 = 2048;
const DEFAULT_CPU_COUNT: u8 = 2;
const DEFAULT_OUTPUT_LIMIT_BYTES: usize = 64 * 1024;
const DEFAULT_EXEC_TIMEOUT_MS: u64 = 120_000;
const MAX_EXEC_TIMEOUT_MS: u64 = 300_000;
const VNC_PORT_BASE: u16 = 5900;
const VNC_PORT_END: u16 = 5999;
pub(crate) const DEFAULT_AGENT_VM_IMAGE_ID: &str = "lyra-agent-lite-ubuntu-24.04";
const UBUNTU_NOBLE_RELEASE_BASE_URL: &str =
    "https://cloud-images.ubuntu.com/releases/noble/release";
const IMAGE_DOWNLOAD_TIMEOUT_SECS: u64 = 30 * 60;
const IMAGE_METADATA_TIMEOUT_SECS: u64 = 60;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageRequest {
    #[serde(default, alias = "storage_root")]
    storage_root: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImageManifestRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(default, alias = "manifest_ref")]
    manifest_ref: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleImageManifest {
    #[serde(default = "schema_v1", alias = "schema_version")]
    pub schema_version: String,
    pub images: Vec<CapsuleImage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleImage {
    pub id: String,
    pub name: String,
    pub family: String,
    pub arch: Vec<String>,
    pub format: Vec<String>,
    #[serde(default)]
    pub recommended: bool,
    #[serde(default = "official_source")]
    pub source: String,
    #[serde(default)]
    pub urls: Vec<CapsuleImageUrl>,
    #[serde(default)]
    pub checksum: Option<String>,
    #[serde(default)]
    pub signature: Option<String>,
    #[serde(default, alias = "overlay_id")]
    pub overlay_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleImageUrl {
    pub url: String,
    #[serde(default)]
    pub region: Option<String>,
    #[serde(default)]
    pub arch: Option<String>,
    #[serde(default, alias = "checksum_url")]
    pub checksum_url: Option<String>,
    #[serde(default, alias = "checksum_file_name")]
    pub checksum_file_name: Option<String>,
    #[serde(default, alias = "size_bytes")]
    pub size_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapsuleImageRecord {
    schema_version: String,
    image_id: String,
    image_name: String,
    arch: String,
    format: String,
    source: String,
    file_path: String,
    checksum: Option<String>,
    verified: bool,
    signature_verified: bool,
    imported_at: String,
    verified_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadImageRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    image_id: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    arch: Option<String>,
    #[serde(default, alias = "manifest_ref")]
    manifest_ref: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VerifyImageRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    image_id: String,
    #[serde(default)]
    signature_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportImageRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    image_id: String,
    file_path: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arch: Option<String>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    checksum: Option<String>,
    #[serde(default, alias = "manifest_ref")]
    manifest_ref: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleBridgePolicy {
    #[serde(default = "schema_v1", alias = "schema_version")]
    pub schema_version: String,
    #[serde(default, alias = "mounted_paths")]
    pub mounted_paths: Vec<CapsuleMountedPath>,
    #[serde(default)]
    pub network: CapsuleNetworkPolicy,
    #[serde(default)]
    pub secrets: CapsuleBridgeSecrets,
    #[serde(default)]
    pub ports: Vec<CapsulePortForward>,
}

impl Default for CapsuleBridgePolicy {
    fn default() -> Self {
        Self {
            schema_version: schema_v1(),
            mounted_paths: Vec::new(),
            network: CapsuleNetworkPolicy::default(),
            secrets: CapsuleBridgeSecrets::default(),
            ports: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleMountedPath {
    #[serde(alias = "host_path")]
    pub host_path: String,
    #[serde(alias = "guest_path")]
    pub guest_path: String,
    pub mode: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleNetworkPolicy {
    pub mode: String,
    #[serde(default, alias = "allowed_domains")]
    pub allowed_domains: Vec<String>,
}

impl Default for CapsuleNetworkPolicy {
    fn default() -> Self {
        Self {
            mode: "disabled".to_string(),
            allowed_domains: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsuleBridgeSecrets {
    #[serde(default, alias = "expose_ssh_agent")]
    pub expose_ssh_agent: bool,
    #[serde(default, alias = "expose_env")]
    pub expose_env: Vec<String>,
    #[serde(default, alias = "expose_keychain")]
    pub expose_keychain: bool,
    #[serde(default, alias = "secret_handles")]
    pub secret_handles: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapsulePortForward {
    #[serde(alias = "host_port")]
    pub host_port: u16,
    #[serde(alias = "guest_port")]
    pub guest_port: u16,
    pub protocol: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateCapsuleRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(default, alias = "capsule_id")]
    capsule_id: Option<String>,
    #[serde(alias = "image_id")]
    image_id: String,
    #[serde(default, alias = "project_id")]
    project_id: Option<String>,
    #[serde(default, alias = "workspace_root")]
    workspace_root: Option<String>,
    #[serde(default, alias = "guest_workspace_path")]
    guest_workspace_path: Option<String>,
    #[serde(default, alias = "bridge_policy")]
    bridge_policy: CapsuleBridgePolicy,
    #[serde(default, alias = "memory_mib")]
    memory_mib: Option<u32>,
    #[serde(default, alias = "cpu_count")]
    cpu_count: Option<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapsuleIdRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(alias = "capsule_id", alias = "vmId", alias = "vm_id")]
    capsule_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartCapsuleRequest {
    #[serde(flatten)]
    base: CapsuleIdRequest,
    #[serde(default)]
    backend: Option<String>,
    #[serde(default, alias = "login_password_hash")]
    login_password_hash: Option<String>,
    #[serde(default, alias = "console_autologin")]
    console_autologin: Option<bool>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecCapsuleRequest {
    #[serde(flatten)]
    base: CapsuleIdRequest,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    argv: Vec<String>,
    #[serde(default, alias = "timeout_ms")]
    timeout_ms: Option<u64>,
    #[serde(default, alias = "output_limit_bytes")]
    output_limit_bytes: Option<usize>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotCapsuleRequest {
    #[serde(flatten)]
    base: CapsuleIdRequest,
    #[serde(default, alias = "snapshot_id")]
    snapshot_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreCapsuleRequest {
    #[serde(flatten)]
    base: CapsuleIdRequest,
    #[serde(alias = "snapshot_id")]
    snapshot_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateBridgeRequest {
    #[serde(flatten)]
    base: CapsuleIdRequest,
    #[serde(alias = "bridge_policy")]
    bridge_policy: CapsuleBridgePolicy,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportArtifactRequest {
    #[serde(flatten)]
    base: CapsuleIdRequest,
    #[serde(alias = "guest_path")]
    guest_path: String,
    #[serde(default, alias = "output_name")]
    output_name: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CapsuleInstance {
    schema_version: String,
    capsule_id: String,
    project_id: Option<String>,
    image_id: String,
    state: String,
    backend: String,
    arch: String,
    pid: Option<u32>,
    ssh_port: Option<u16>,
    #[serde(default)]
    vnc_port: Option<u16>,
    workspace_root: Option<String>,
    guest_workspace_path: String,
    bridge_policy: CapsuleBridgePolicy,
    memory_mib: u32,
    cpu_count: u8,
    disk_path: String,
    seed_iso_path: Option<String>,
    ssh_key_path: String,
    created_at: String,
    updated_at: String,
}

pub fn read_image_manifest_json(request_json: String) -> Result<String> {
    let request = parse::<ImageManifestRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    to_json(&load_manifest(&root, request.manifest_ref.as_deref())?)
}

pub fn list_images_json(request_json: String) -> Result<String> {
    let request = parse::<ImageManifestRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let manifest = load_manifest(&root, request.manifest_ref.as_deref())?;
    let arch = host_arch();
    let images = manifest
        .images
        .into_iter()
        .filter(|image| image.arch.iter().any(|candidate| candidate == &arch))
        .map(|image| {
            let record = read_image_record(&root, &image.id).ok().flatten();
            json!({
                "image": image,
                "installed": record.is_some(),
                "record": record,
            })
        })
        .collect::<Vec<_>>();
    to_json(&json!({
        "schemaVersion": "v1",
        "arch": arch,
        "images": images,
    }))
}

pub fn download_image_json(request_json: String) -> Result<String> {
    let request = parse::<DownloadImageRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let manifest = load_manifest(&root, request.manifest_ref.as_deref())?;
    let image = manifest
        .images
        .into_iter()
        .find(|candidate| candidate.id == request.image_id)
        .ok_or_else(|| anyhow!("CapsuleImageManifestInvalid: image not found"))?;
    let arch = request.arch.unwrap_or_else(host_arch);
    let image_url = select_image_url(&image, request.url.as_deref(), &arch)
        .ok_or_else(|| anyhow!("CapsuleImageManifestInvalid: image has no URL for this host"))?;
    let url = image_url.url.clone();
    ensure_image_id(&image.id)?;
    let image_dir = images_dir(&root).join(&image.id);
    fs::create_dir_all(&image_dir)?;
    let file_name = file_name_from_url(&url).unwrap_or_else(|| format!("{}.qcow2", image.id));
    let target = image_dir.join(file_name);
    let temp = target.with_extension("tmp");
    download_to_file(&url, &temp)?;
    let actual = sha256_file(&temp)?;
    let expected_checksum = resolve_expected_checksum(&image, &image_url, &url)?;
    if let Some(expected) = expected_checksum.as_deref() {
        if actual != expected {
            let _ = fs::remove_file(&temp);
            bail!("CapsuleImageChecksumFailed: expected {expected}, got {actual}");
        }
    }
    fs::rename(&temp, &target)?;
    let record = write_image_record(
        &root,
        CapsuleImageRecord {
            schema_version: schema_v1(),
            image_id: image.id.clone(),
            image_name: image.name.clone(),
            arch,
            format: infer_format(&target, image.format.first().map(String::as_str)),
            source: url,
            file_path: target.to_string_lossy().to_string(),
            checksum: Some(actual),
            verified: expected_checksum.is_some(),
            signature_verified: false,
            imported_at: now_iso(),
            verified_at: if expected_checksum.is_some() {
                Some(now_iso())
            } else {
                None
            },
        },
    )?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "downloaded",
        "auditEvent": "agent_vm.image_downloaded",
        "record": record,
    }))
}

pub fn import_image_json(request_json: String) -> Result<String> {
    let request = parse::<ImportImageRequest>(&request_json)?;
    ensure_image_id(&request.image_id)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let source = PathBuf::from(&request.file_path);
    if !source.is_file() {
        bail!("CapsuleImageManifestInvalid: imported image path is not a file");
    }
    let image_dir = images_dir(&root).join(&request.image_id);
    fs::create_dir_all(&image_dir)?;
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image.qcow2");
    let target = image_dir.join(file_name);
    if canonical_string(&source)? != canonical_string(&target).unwrap_or_default() {
        fs::copy(&source, &target).with_context(|| {
            format!(
                "failed to import capsule image {} -> {}",
                source.display(),
                target.display()
            )
        })?;
    }
    let actual = sha256_file(&target)?;
    let expected_checksum = match request.checksum.as_deref() {
        Some(checksum) => normalize_sha256(checksum).map(Some).ok_or_else(|| {
            anyhow!("CapsuleImageManifestInvalid: imported checksum is not sha256")
        })?,
        None => resolve_import_expected_checksum(
            &root,
            request.manifest_ref.as_deref(),
            &request.image_id,
            request.arch.as_deref(),
            &source,
        )?,
    };
    if let Some(expected) = expected_checksum.as_deref() {
        if actual != expected {
            bail!("CapsuleImageChecksumFailed: expected {expected}, got {actual}");
        }
    }
    let record = write_image_record(
        &root,
        CapsuleImageRecord {
            schema_version: schema_v1(),
            image_id: request.image_id.clone(),
            image_name: request.name.unwrap_or_else(|| request.image_id.clone()),
            arch: request.arch.unwrap_or_else(host_arch),
            format: request
                .format
                .unwrap_or_else(|| infer_format(&target, Some("qcow2"))),
            source: source.to_string_lossy().to_string(),
            file_path: target.to_string_lossy().to_string(),
            checksum: Some(actual),
            verified: expected_checksum.is_some(),
            signature_verified: false,
            imported_at: now_iso(),
            verified_at: if expected_checksum.is_some() {
                Some(now_iso())
            } else {
                None
            },
        },
    )?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "imported",
        "auditEvent": "agent_vm.image_downloaded",
        "record": record,
    }))
}

pub fn verify_image_json(request_json: String) -> Result<String> {
    let request = parse::<VerifyImageRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let mut record = read_image_record(&root, &request.image_id)?
        .ok_or_else(|| anyhow!("CapsuleImageManifestInvalid: image is not installed"))?;
    let actual = sha256_file(Path::new(&record.file_path))?;
    if let Some(expected) = record.checksum.as_deref().and_then(normalize_sha256) {
        if actual != expected {
            bail!("CapsuleImageChecksumFailed: expected {expected}, got {actual}");
        }
    }
    let signature_verified = match request.signature_path.as_deref() {
        Some(signature_path) => {
            verify_signature(Path::new(&record.file_path), Path::new(signature_path))?
        }
        None => false,
    };
    record.checksum = Some(actual);
    record.verified = true;
    record.signature_verified = signature_verified;
    record.verified_at = Some(now_iso());
    let record = write_image_record(&root, record)?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "verified",
        "auditEvent": "agent_vm.image_verified",
        "record": record,
    }))
}

pub fn create_capsule_json(request_json: String) -> Result<String> {
    let request = parse::<CreateCapsuleRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let image = read_image_record(&root, &request.image_id)?
        .ok_or_else(|| anyhow!("CapsuleImageManifestInvalid: image is not installed"))?;
    validate_bridge_policy(&request.bridge_policy, request.workspace_root.as_deref())?;
    let capsule_id = request
        .capsule_id
        .unwrap_or_else(|| format!("capsule-{}", Uuid::new_v4()));
    ensure_image_id(&capsule_id)?;
    let instance_dir = instances_dir(&root).join(&capsule_id);
    fs::create_dir_all(&instance_dir)?;
    let ssh_key_path = instance_dir.join("id_ed25519");
    ensure_ssh_key(&ssh_key_path)?;
    let disk_path = instance_dir.join("disk.qcow2");
    let instance = CapsuleInstance {
        schema_version: schema_v1(),
        capsule_id: capsule_id.clone(),
        project_id: request.project_id,
        image_id: request.image_id,
        state: "created".to_string(),
        backend: "qemu".to_string(),
        arch: image.arch,
        pid: None,
        ssh_port: None,
        vnc_port: None,
        workspace_root: request.workspace_root,
        guest_workspace_path: request
            .guest_workspace_path
            .unwrap_or_else(|| "/workspace".to_string()),
        bridge_policy: request.bridge_policy,
        memory_mib: request.memory_mib.unwrap_or(DEFAULT_MEMORY_MIB),
        cpu_count: request.cpu_count.unwrap_or(DEFAULT_CPU_COUNT),
        disk_path: disk_path.to_string_lossy().to_string(),
        seed_iso_path: None,
        ssh_key_path: ssh_key_path.to_string_lossy().to_string(),
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    write_instance(&root, &instance)?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "created",
        "auditEvent": "agent_vm.created",
        "capsule": instance,
    }))
}

pub fn start_capsule_json(request_json: String) -> Result<String> {
    let request = parse::<StartCapsuleRequest>(&request_json)?;
    let root = resolve_root(request.base.storage.storage_root.as_deref())?;
    let mut instance = read_instance(&root, &request.base.capsule_id)?;
    if instance.state == "running" && pid_is_alive(instance.pid) {
        return to_json(&json!({
            "schemaVersion": "v1",
            "status": "running",
            "capsule": instance,
        }));
    }
    let backend = request.backend.unwrap_or_else(|| "qemu".to_string());
    if backend != "qemu" {
        bail!("CapsuleUnavailable: unsupported capsule backend {backend}");
    }
    let image = read_image_record(&root, &instance.image_id)?
        .ok_or_else(|| anyhow!("CapsuleImageManifestInvalid: image is not installed"))?;
    let qemu = find_qemu(&instance.arch)?;
    ensure_instance_disk(&instance, &image)?;
    let ssh_port = pick_host_port()?;
    let (vnc_display, vnc_port) = pick_vnc_display()?;
    let seed_iso = create_nocloud_seed(
        &root,
        &instance,
        ssh_port,
        vnc_port,
        request.login_password_hash.as_deref(),
        request.console_autologin.unwrap_or_else(|| {
            request
                .login_password_hash
                .as_deref()
                .is_some_and(|value| value.trim().is_empty() == false)
        }),
    )?;
    let mut command = Command::new(&qemu);
    command
        .args(qemu_base_args(&instance, &seed_iso, ssh_port, vnc_display))
        .stdout(Stdio::from(log_file(
            &root,
            &instance.capsule_id,
            "stdout.log",
        )?))
        .stderr(Stdio::from(log_file(
            &root,
            &instance.capsule_id,
            "stderr.log",
        )?));
    let child = command.spawn().with_context(|| {
        format!(
            "CapsuleGuestInitFailed: failed to start QEMU backend {}",
            qemu.display()
        )
    })?;
    instance.state = "running".to_string();
    instance.pid = Some(child.id());
    instance.ssh_port = Some(ssh_port);
    instance.vnc_port = Some(vnc_port);
    instance.seed_iso_path = Some(seed_iso.to_string_lossy().to_string());
    instance.updated_at = now_iso();
    write_instance(&root, &instance)?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "started",
        "auditEvent": "agent_vm.started",
        "capsule": instance,
    }))
}

pub fn stop_capsule_json(request_json: String) -> Result<String> {
    let request = parse::<CapsuleIdRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let mut instance = read_instance(&root, &request.capsule_id)?;
    stop_process(instance.pid);
    instance.state = "stopped".to_string();
    instance.pid = None;
    instance.ssh_port = None;
    instance.vnc_port = None;
    instance.updated_at = now_iso();
    write_instance(&root, &instance)?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "stopped",
        "auditEvent": "agent_vm.stopped",
        "capsule": instance,
    }))
}

pub fn destroy_capsule_json(request_json: String) -> Result<String> {
    let request = parse::<CapsuleIdRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let instance = read_instance(&root, &request.capsule_id)?;
    stop_process(instance.pid);
    let dir = instance_dir(&root, &request.capsule_id);
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "destroyed",
        "auditEvent": "agent_vm.destroyed",
        "capsuleId": request.capsule_id,
    }))
}

pub fn capsule_status_json(request_json: String) -> Result<String> {
    let request = parse::<CapsuleIdRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let mut instance = read_instance(&root, &request.capsule_id)?;
    if instance.state == "running" && !pid_is_alive(instance.pid) {
        instance.state = "stopped".to_string();
        instance.pid = None;
        instance.ssh_port = None;
        instance.vnc_port = None;
        instance.updated_at = now_iso();
        write_instance(&root, &instance)?;
    }
    to_json(&json!({
        "schemaVersion": "v1",
        "status": instance.state,
        "capsule": instance,
    }))
}

pub fn exec_capsule_json(request_json: String) -> Result<String> {
    let request = parse::<ExecCapsuleRequest>(&request_json)?;
    let root = resolve_root(request.base.storage.storage_root.as_deref())?;
    let instance = read_instance(&root, &request.base.capsule_id)?;
    if instance.state != "running" || !pid_is_alive(instance.pid) {
        bail!("CapsuleUnavailable: capsule is not running");
    }
    let ssh_port = instance
        .ssh_port
        .ok_or_else(|| anyhow!("CapsuleGuestInitFailed: capsule has no SSH port"))?;
    let command_text = command_text(request.command, request.argv)?;
    let mut child = Command::new("ssh")
        .arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg("UserKnownHostsFile=/dev/null")
        .arg("-o")
        .arg("ConnectTimeout=5")
        .arg("-i")
        .arg(&instance.ssh_key_path)
        .arg("-p")
        .arg(ssh_port.to_string())
        .arg("lyra@127.0.0.1")
        .arg("--")
        .arg("sh")
        .arg("-lc")
        .arg(&command_text)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| "CapsuleGuestInitFailed: failed to execute guest command over SSH")?;
    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_EXEC_TIMEOUT_MS)
        .clamp(1_000, MAX_EXEC_TIMEOUT_MS);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let timed_out;
    let output = loop {
        if child.try_wait()?.is_some() {
            timed_out = false;
            break child.wait_with_output()?;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            timed_out = true;
            break child.wait_with_output()?;
        }
        thread::sleep(Duration::from_millis(25));
    };
    let limit = request
        .output_limit_bytes
        .unwrap_or(DEFAULT_OUTPUT_LIMIT_BYTES)
        .clamp(1024, 1024 * 1024);
    let stdout = cap_string(String::from_utf8_lossy(&output.stdout).to_string(), limit);
    let remaining = limit.saturating_sub(stdout.value.len());
    let stderr = cap_string(
        String::from_utf8_lossy(&output.stderr).to_string(),
        remaining,
    );
    to_json(&json!({
        "schemaVersion": "v1",
        "status": if output.status.success() && !timed_out { "passed" } else { "failed" },
        "auditEvent": "permission.auto_approved_by_full_access",
        "capsuleId": instance.capsule_id,
        "command": command_text,
        "exitCode": output.status.code(),
        "timedOut": timed_out,
        "stdout": stdout.value,
        "stderr": stderr.value,
        "truncated": stdout.truncated || stderr.truncated,
    }))
}

pub fn create_snapshot_json(request_json: String) -> Result<String> {
    let request = parse::<SnapshotCapsuleRequest>(&request_json)?;
    let root = resolve_root(request.base.storage.storage_root.as_deref())?;
    let instance = read_instance(&root, &request.base.capsule_id)?;
    ensure_stopped_for_disk_mutation(&instance)?;
    let snapshot_id = request
        .snapshot_id
        .unwrap_or_else(|| format!("snapshot-{}", now_ms()));
    let qemu_img = find_program("qemu-img")
        .ok_or_else(|| anyhow!("CapsuleUnavailable: qemu-img not found"))?;
    let status = Command::new(qemu_img)
        .arg("snapshot")
        .arg("-c")
        .arg(&snapshot_id)
        .arg(&instance.disk_path)
        .status()?;
    if !status.success() {
        bail!("CapsuleGuestInitFailed: qemu-img snapshot create failed");
    }
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "created",
        "auditEvent": "agent_vm.snapshot_created",
        "capsuleId": instance.capsule_id,
        "snapshotId": snapshot_id,
    }))
}

pub fn restore_snapshot_json(request_json: String) -> Result<String> {
    let request = parse::<RestoreCapsuleRequest>(&request_json)?;
    let root = resolve_root(request.base.storage.storage_root.as_deref())?;
    let instance = read_instance(&root, &request.base.capsule_id)?;
    ensure_stopped_for_disk_mutation(&instance)?;
    let qemu_img = find_program("qemu-img")
        .ok_or_else(|| anyhow!("CapsuleUnavailable: qemu-img not found"))?;
    let status = Command::new(qemu_img)
        .arg("snapshot")
        .arg("-a")
        .arg(&request.snapshot_id)
        .arg(&instance.disk_path)
        .status()?;
    if !status.success() {
        bail!("CapsuleGuestInitFailed: qemu-img snapshot restore failed");
    }
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "restored",
        "auditEvent": "agent_vm.snapshot_restored",
        "capsuleId": instance.capsule_id,
        "snapshotId": request.snapshot_id,
    }))
}

pub fn update_bridge_policy_json(request_json: String) -> Result<String> {
    let request = parse::<UpdateBridgeRequest>(&request_json)?;
    let root = resolve_root(request.base.storage.storage_root.as_deref())?;
    let mut instance = read_instance(&root, &request.base.capsule_id)?;
    validate_bridge_policy(&request.bridge_policy, instance.workspace_root.as_deref())?;
    instance.bridge_policy = request.bridge_policy;
    instance.updated_at = now_iso();
    write_instance(&root, &instance)?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "updated",
        "auditEvent": "agent_vm.bridge_changed",
        "capsule": instance,
    }))
}

pub fn read_guest_logs_json(request_json: String) -> Result<String> {
    let request = parse::<CapsuleIdRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let logs = instance_dir(&root, &request.capsule_id).join("logs");
    let stdout = fs::read_to_string(logs.join("stdout.log")).unwrap_or_default();
    let stderr = fs::read_to_string(logs.join("stderr.log")).unwrap_or_default();
    to_json(&json!({
        "schemaVersion": "v1",
        "capsuleId": request.capsule_id,
        "stdout": cap_string(stdout, DEFAULT_OUTPUT_LIMIT_BYTES).value,
        "stderr": cap_string(stderr, DEFAULT_OUTPUT_LIMIT_BYTES).value,
    }))
}

pub fn export_artifact_json(request_json: String) -> Result<String> {
    let request = parse::<ExportArtifactRequest>(&request_json)?;
    let root = resolve_root(request.base.storage.storage_root.as_deref())?;
    let instance = read_instance(&root, &request.base.capsule_id)?;
    if instance.state != "running" {
        bail!("CapsuleUnavailable: capsule is not running");
    }
    let ssh_port = instance
        .ssh_port
        .ok_or_else(|| anyhow!("CapsuleGuestInitFailed: capsule has no SSH port"))?;
    let output_name = request.output_name.unwrap_or_else(|| {
        Path::new(&request.guest_path)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("artifact")
            .to_string()
    });
    ensure_safe_file_name(&output_name)?;
    let export_dir = instance_dir(&root, &instance.capsule_id).join("exports");
    fs::create_dir_all(&export_dir)?;
    let target = export_dir.join(output_name);
    let status = Command::new("scp")
        .arg("-o")
        .arg("StrictHostKeyChecking=no")
        .arg("-o")
        .arg("UserKnownHostsFile=/dev/null")
        .arg("-i")
        .arg(&instance.ssh_key_path)
        .arg("-P")
        .arg(ssh_port.to_string())
        .arg(format!("lyra@127.0.0.1:{}", request.guest_path))
        .arg(&target)
        .status()?;
    if !status.success() {
        bail!("CapsuleGuestInitFailed: scp export failed");
    }
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "exported",
        "auditEvent": "agent_vm.exported_artifact",
        "capsuleId": instance.capsule_id,
        "guestPath": request.guest_path,
        "hostPath": target.to_string_lossy(),
        "sha256": sha256_file(&target)?,
    }))
}

fn parse<T: for<'de> Deserialize<'de>>(request_json: &str) -> Result<T> {
    serde_json::from_str(request_json).context("failed to parse capsule request")
}

fn to_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).context("failed to serialize capsule response")
}

fn resolve_root(storage_root: Option<&str>) -> Result<PathBuf> {
    let root = storage_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("LYRA_CAPSULE_ROOT").map(PathBuf::from))
        .or_else(|| home_dir().map(|home| home.join(".lyra").join("modules").join("capsule")))
        .ok_or_else(|| anyhow!("CapsuleUnavailable: capsule storage root is unavailable"))?;
    fs::create_dir_all(root.join("images"))?;
    fs::create_dir_all(root.join("instances"))?;
    Ok(root)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn images_dir(root: &Path) -> PathBuf {
    root.join("images")
}

fn instances_dir(root: &Path) -> PathBuf {
    root.join("instances")
}

fn instance_dir(root: &Path, capsule_id: &str) -> PathBuf {
    instances_dir(root).join(capsule_id)
}

fn load_manifest(root: &Path, manifest_ref: Option<&str>) -> Result<CapsuleImageManifest> {
    if let Some(path) = manifest_ref
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        return read_manifest_file(&path);
    }
    if let Some(path) = std::env::var_os("LYRA_CAPSULE_IMAGE_MANIFEST").map(PathBuf::from) {
        return read_manifest_file(&path);
    }
    let local = root.join(MANIFEST_FILE);
    if local.exists() {
        return read_manifest_file(&local);
    }
    Ok(default_manifest())
}

fn read_manifest_file(path: &Path) -> Result<CapsuleImageManifest> {
    let text = fs::read_to_string(path).with_context(|| {
        format!(
            "CapsuleImageManifestInvalid: failed to read {}",
            path.display()
        )
    })?;
    let manifest: CapsuleImageManifest = serde_json::from_str(&text).with_context(|| {
        format!(
            "CapsuleImageManifestInvalid: failed to parse {}",
            path.display()
        )
    })?;
    if manifest.schema_version != "v1" || manifest.images.is_empty() {
        bail!("CapsuleImageManifestInvalid: manifest must be v1 and contain images");
    }
    Ok(manifest)
}

fn default_manifest() -> CapsuleImageManifest {
    let checksum_url = format!("{UBUNTU_NOBLE_RELEASE_BASE_URL}/SHA256SUMS");
    CapsuleImageManifest {
        schema_version: schema_v1(),
        images: vec![CapsuleImage {
            id: DEFAULT_AGENT_VM_IMAGE_ID.to_string(),
            name: "Lyra Agent VM Lite (Ubuntu 24.04 LTS)".to_string(),
            family: "ubuntu".to_string(),
            arch: vec!["x86_64".to_string(), "arm64".to_string()],
            format: vec!["qcow2".to_string()],
            recommended: true,
            source: "ubuntu-cloud-images".to_string(),
            urls: vec![
                CapsuleImageUrl {
                    url: format!(
                        "{UBUNTU_NOBLE_RELEASE_BASE_URL}/ubuntu-24.04-server-cloudimg-amd64.img"
                    ),
                    region: Some("global".to_string()),
                    arch: Some("x86_64".to_string()),
                    checksum_url: Some(checksum_url.clone()),
                    checksum_file_name: Some("ubuntu-24.04-server-cloudimg-amd64.img".to_string()),
                    size_bytes: None,
                },
                CapsuleImageUrl {
                    url: format!(
                        "{UBUNTU_NOBLE_RELEASE_BASE_URL}/ubuntu-24.04-server-cloudimg-arm64.img"
                    ),
                    region: Some("global".to_string()),
                    arch: Some("arm64".to_string()),
                    checksum_url: Some(checksum_url),
                    checksum_file_name: Some("ubuntu-24.04-server-cloudimg-arm64.img".to_string()),
                    size_bytes: None,
                },
            ],
            checksum: None,
            signature: None,
            overlay_id: Some("lyra-agent-runtime-v1".to_string()),
        }],
    }
}

fn read_image_record(root: &Path, image_id: &str) -> Result<Option<CapsuleImageRecord>> {
    ensure_image_id(image_id)?;
    let path = images_dir(root).join(image_id).join(IMAGE_RECORD_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)?;
    let record = serde_json::from_str(&text)?;
    Ok(Some(record))
}

fn write_image_record(root: &Path, record: CapsuleImageRecord) -> Result<CapsuleImageRecord> {
    ensure_image_id(&record.image_id)?;
    let dir = images_dir(root).join(&record.image_id);
    fs::create_dir_all(&dir)?;
    let path = dir.join(IMAGE_RECORD_FILE);
    fs::write(&path, serde_json::to_string_pretty(&record)?)?;
    Ok(record)
}

fn read_instance(root: &Path, capsule_id: &str) -> Result<CapsuleInstance> {
    ensure_image_id(capsule_id)?;
    let path = instance_dir(root, capsule_id).join(INSTANCE_FILE);
    let text = fs::read_to_string(&path)
        .with_context(|| format!("CapsuleUnavailable: capsule not found: {capsule_id}"))?;
    serde_json::from_str(&text).context("CapsuleBridgePolicyInvalid: failed to parse capsule state")
}

fn write_instance(root: &Path, instance: &CapsuleInstance) -> Result<()> {
    ensure_image_id(&instance.capsule_id)?;
    let dir = instance_dir(root, &instance.capsule_id);
    fs::create_dir_all(&dir)?;
    fs::write(
        dir.join(INSTANCE_FILE),
        serde_json::to_string_pretty(instance)?,
    )?;
    Ok(())
}

fn select_image_url(
    image: &CapsuleImage,
    override_url: Option<&str>,
    arch: &str,
) -> Option<CapsuleImageUrl> {
    if let Some(url) = override_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return image
            .urls
            .iter()
            .find(|candidate| candidate.url == url)
            .cloned()
            .or_else(|| {
                Some(CapsuleImageUrl {
                    url: url.to_string(),
                    region: None,
                    arch: Some(arch.to_string()),
                    checksum_url: None,
                    checksum_file_name: None,
                    size_bytes: None,
                })
            });
    }
    image
        .urls
        .iter()
        .find(|candidate| candidate.arch.as_deref().is_none_or(|value| value == arch))
        .cloned()
}

fn resolve_expected_checksum(
    image: &CapsuleImage,
    image_url: &CapsuleImageUrl,
    url: &str,
) -> Result<Option<String>> {
    if let Some(checksum) = image.checksum.as_deref() {
        return normalize_sha256(checksum)
            .map(Some)
            .ok_or_else(|| anyhow!("CapsuleImageManifestInvalid: image checksum is not sha256"));
    }
    let Some(checksum_url) = image_url
        .checksum_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let file_name = image_url
        .checksum_file_name
        .as_deref()
        .and_then(clean_string)
        .or_else(|| file_name_from_url(url))
        .ok_or_else(|| anyhow!("CapsuleImageManifestInvalid: missing checksum file name"))?;
    let checksum_text = read_url_to_string(checksum_url)?;
    parse_sha256sums(&checksum_text, &file_name)
        .map(Some)
        .ok_or_else(|| anyhow!("CapsuleImageManifestInvalid: checksum missing for {file_name}"))
}

fn resolve_import_expected_checksum(
    root: &Path,
    manifest_ref: Option<&str>,
    image_id: &str,
    arch: Option<&str>,
    source: &Path,
) -> Result<Option<String>> {
    let manifest = load_manifest(root, manifest_ref)?;
    let Some(image) = manifest
        .images
        .into_iter()
        .find(|image| image.id == image_id)
    else {
        return Ok(None);
    };
    let arch = arch.and_then(clean_string).unwrap_or_else(host_arch);
    let source_file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .and_then(clean_string);
    let image_url = image
        .urls
        .iter()
        .find(|candidate| {
            candidate
                .arch
                .as_deref()
                .is_none_or(|candidate_arch| candidate_arch == arch)
                && source_file_name.as_ref().is_none_or(|file_name| {
                    candidate.checksum_file_name.as_deref() == Some(file_name.as_str())
                        || file_name_from_url(&candidate.url).as_deref() == Some(file_name.as_str())
                })
        })
        .or_else(|| {
            image
                .urls
                .iter()
                .find(|candidate| candidate.arch.as_deref().is_none_or(|value| value == arch))
        });
    let Some(image_url) = image_url else {
        return Ok(None);
    };
    resolve_expected_checksum(&image, image_url, &image_url.url)
}

fn download_to_file(url: &str, target: &Path) -> Result<()> {
    if let Some(path) = url.strip_prefix("file://") {
        fs::copy(path, target)?;
        return Ok(());
    }
    let client = http_client(Duration::from_secs(IMAGE_DOWNLOAD_TIMEOUT_SECS))?;
    let mut response = client
        .get(url)
        .send()
        .with_context(|| format!("CapsuleImageDownloadFailed: failed to request {url}"))?;
    if !response.status().is_success() {
        bail!("CapsuleImageDownloadFailed: HTTP {}", response.status());
    }
    let mut file = File::create(target)?;
    response
        .copy_to(&mut file)
        .with_context(|| format!("CapsuleImageDownloadFailed: failed to download {url}"))?;
    file.sync_all()?;
    Ok(())
}

fn read_url_to_string(url: &str) -> Result<String> {
    if let Some(path) = url.strip_prefix("file://") {
        return fs::read_to_string(path)
            .with_context(|| format!("CapsuleImageDownloadFailed: failed to read {url}"));
    }
    let client = http_client(Duration::from_secs(IMAGE_METADATA_TIMEOUT_SECS))?;
    let response = client
        .get(url)
        .send()
        .with_context(|| format!("CapsuleImageDownloadFailed: failed to request {url}"))?;
    if !response.status().is_success() {
        bail!("CapsuleImageDownloadFailed: HTTP {}", response.status());
    }
    response
        .text()
        .with_context(|| format!("CapsuleImageDownloadFailed: failed to read {url}"))
}

fn http_client(timeout: Duration) -> Result<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(timeout)
        .user_agent("Lyra-Agent-VM/1.0")
        .build()
        .context("CapsuleImageDownloadFailed: failed to create HTTP client")
}

fn verify_signature(image_path: &Path, signature_path: &Path) -> Result<bool> {
    let Some(gpg) = find_program("gpg") else {
        bail!("CapsuleImageSignatureFailed: gpg not found");
    };
    let status = Command::new(gpg)
        .arg("--verify")
        .arg(signature_path)
        .arg(image_path)
        .status()?;
    if !status.success() {
        bail!("CapsuleImageSignatureFailed: signature verification failed");
    }
    Ok(true)
}

fn ensure_instance_disk(instance: &CapsuleInstance, image: &CapsuleImageRecord) -> Result<()> {
    let disk = Path::new(&instance.disk_path);
    if disk.exists() {
        return Ok(());
    }
    if let Some(qemu_img) = find_program("qemu-img") {
        let status = Command::new(qemu_img)
            .arg("create")
            .arg("-f")
            .arg("qcow2")
            .arg("-F")
            .arg(&image.format)
            .arg("-b")
            .arg(&image.file_path)
            .arg(disk)
            .status()?;
        if status.success() {
            return Ok(());
        }
    }
    fs::copy(&image.file_path, disk).with_context(|| {
        format!(
            "CapsuleGuestInitFailed: failed to create capsule disk {}",
            disk.display()
        )
    })?;
    Ok(())
}

fn create_nocloud_seed(
    root: &Path,
    instance: &CapsuleInstance,
    ssh_port: u16,
    vnc_port: u16,
    login_password_hash: Option<&str>,
    console_autologin: bool,
) -> Result<PathBuf> {
    let dir = instance_dir(root, &instance.capsule_id).join("seed");
    fs::create_dir_all(&dir)?;
    let public_key = fs::read_to_string(format!("{}.pub", instance.ssh_key_path))
        .context("CapsuleGuestInitFailed: capsule SSH public key is missing")?;
    let user_data = build_nocloud_user_data(
        instance,
        public_key.trim(),
        ssh_port,
        vnc_port,
        login_password_hash,
        console_autologin,
    )?;
    fs::write(dir.join("user-data"), user_data)?;
    fs::write(
        dir.join("meta-data"),
        format!(
            "instance-id: {}\nlocal-hostname: lyra-{}\n",
            instance.capsule_id, instance.capsule_id
        ),
    )?;
    let iso = instance_dir(root, &instance.capsule_id).join("seed.iso");
    if create_seed_iso(&dir, &iso)? {
        return Ok(iso);
    }
    bail!("CapsuleGuestInitFailed: no NoCloud seed ISO tool found");
}

fn build_nocloud_user_data(
    instance: &CapsuleInstance,
    public_key: &str,
    ssh_port: u16,
    vnc_port: u16,
    login_password_hash: Option<&str>,
    console_autologin: bool,
) -> Result<String> {
    let login_password_hash = login_password_hash
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
        .map(validate_login_password_hash)
        .transpose()?;
    let password_lines = login_password_hash
        .map(|hash| format!("    passwd: '{hash}'\n    lock_passwd: false\n"))
        .unwrap_or_default();
    let ssh_pwauth = if login_password_hash.is_some() {
        "true"
    } else {
        "false"
    };
    let autologin_file = if console_autologin {
        r#"  - path: /etc/systemd/system/getty@tty1.service.d/override.conf
    permissions: '0644'
    content: |
      [Service]
      ExecStart=
      ExecStart=-/sbin/agetty --autologin lyra --noclear %I $TERM
"#
    } else {
        ""
    };
    let autologin_commands = if console_autologin {
        "  - systemctl daemon-reload\n  - systemctl restart getty@tty1 || true\n"
    } else {
        ""
    };
    Ok(format!(
        r#"#cloud-config
users:
  - name: lyra
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
{password_lines}    ssh_authorized_keys:
      - {public_key}
ssh_pwauth: {ssh_pwauth}
disable_root: false
write_files:
  - path: /etc/lyra/capsule-policy.json
    permissions: '0644'
    content: |
{policy}
{autologin_file}bootcmd:
  - mkdir -p /etc/systemd/system/getty@tty1.service.d
runcmd:
  - mkdir -p {guest_workspace}
  - chown -R lyra:lyra {guest_workspace}
{autologin_commands}  - systemctl restart ssh || service ssh restart || true
"#,
        public_key = public_key,
        ssh_pwauth = ssh_pwauth,
        password_lines = password_lines,
        autologin_file = autologin_file,
        autologin_commands = autologin_commands,
        policy = indent_json(&json!({
            "capsuleId": instance.capsule_id,
            "bridgePolicy": instance.bridge_policy,
            "sshPort": ssh_port,
            "vncPort": vnc_port,
        }))?,
        guest_workspace = shell_quote(&instance.guest_workspace_path),
    ))
}

fn validate_login_password_hash(hash: &str) -> Result<&str> {
    if hash.starts_with("$6$")
        && hash.len() > 20
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'$' | b'.' | b'/' | b'_'))
    {
        return Ok(hash);
    }
    bail!("CapsuleGuestInitFailed: invalid guest login password hash")
}

fn create_seed_iso(seed_dir: &Path, iso: &Path) -> Result<bool> {
    prepare_seed_iso_target(iso)?;
    if cfg!(target_os = "macos") {
        if let Some(hdiutil) = find_program("hdiutil") {
            let status = Command::new(hdiutil)
                .arg("makehybrid")
                .arg("-iso")
                .arg("-joliet")
                .arg("-default-volume-name")
                .arg("cidata")
                .arg("-o")
                .arg(iso)
                .arg(seed_dir)
                .status()?;
            if status.success() {
                return Ok(true);
            }
            bail!("CapsuleGuestInitFailed: hdiutil seed ISO creation failed");
        }
    }
    for program in ["cloud-localds", "genisoimage", "mkisofs"] {
        if let Some(path) = find_program(program) {
            let status = if program == "cloud-localds" {
                Command::new(path)
                    .arg(iso)
                    .arg(seed_dir.join("user-data"))
                    .arg(seed_dir.join("meta-data"))
                    .status()?
            } else {
                Command::new(path)
                    .arg("-output")
                    .arg(iso)
                    .arg("-volid")
                    .arg("cidata")
                    .arg("-joliet")
                    .arg("-rock")
                    .arg(seed_dir)
                    .status()?
            };
            if status.success() {
                return Ok(true);
            }
            bail!("CapsuleGuestInitFailed: {program} seed ISO creation failed");
        }
    }
    Ok(false)
}

fn prepare_seed_iso_target(iso: &Path) -> Result<()> {
    if iso.exists() {
        fs::remove_file(iso).with_context(|| {
            format!(
                "CapsuleGuestInitFailed: failed to replace existing seed ISO {}",
                iso.display()
            )
        })?;
    }
    Ok(())
}

fn qemu_base_args(
    instance: &CapsuleInstance,
    seed_iso: &Path,
    ssh_port: u16,
    vnc_display: u16,
) -> Vec<String> {
    let mut args = vec![
        "-m".to_string(),
        instance.memory_mib.to_string(),
        "-smp".to_string(),
        instance.cpu_count.to_string(),
        "-vnc".to_string(),
        format!("127.0.0.1:{vnc_display}"),
        "-serial".to_string(),
        "mon:stdio".to_string(),
    ];
    if cfg!(target_os = "macos") {
        args.extend(["-accel".to_string(), "hvf".to_string()]);
    } else if Path::new("/dev/kvm").exists() {
        args.extend(["-enable-kvm".to_string()]);
    }
    if instance.arch == "arm64" || instance.arch == "aarch64" {
        args.extend(["-machine".to_string(), "virt".to_string()]);
        args.extend(["-cpu".to_string(), "host".to_string()]);
        args.extend(["-device".to_string(), "virtio-gpu-pci".to_string()]);
    }
    args.extend([
        "-drive".to_string(),
        format!("if=virtio,file={},format=qcow2", instance.disk_path),
        "-drive".to_string(),
        format!(
            "if=virtio,media=cdrom,file={},readonly=on",
            seed_iso.display()
        ),
    ]);
    match instance.bridge_policy.network.mode.as_str() {
        "disabled" => args.extend(["-nic".to_string(), "none".to_string()]),
        "localhost_only" => args.extend([
            "-netdev".to_string(),
            format!("user,id=net0,restrict=on,hostfwd=tcp:127.0.0.1:{ssh_port}-:22"),
            "-device".to_string(),
            "virtio-net-pci,netdev=net0".to_string(),
        ]),
        _ => args.extend([
            "-netdev".to_string(),
            format!("user,id=net0,hostfwd=tcp:127.0.0.1:{ssh_port}-:22"),
            "-device".to_string(),
            "virtio-net-pci,netdev=net0".to_string(),
        ]),
    }
    for (index, mount) in instance.bridge_policy.mounted_paths.iter().enumerate() {
        let readonly = if mount.mode == "read_only" {
            ",readonly=on"
        } else {
            ""
        };
        args.extend([
            "-virtfs".to_string(),
            format!(
                "local,path={},mount_tag=lyra{},security_model=none,id=lyra{}{}",
                mount.host_path, index, index, readonly
            ),
        ]);
    }
    args
}

fn find_qemu(arch: &str) -> Result<PathBuf> {
    let env_name = if arch == "arm64" || arch == "aarch64" {
        "LYRA_QEMU_AARCH64"
    } else {
        "LYRA_QEMU_X86_64"
    };
    if let Some(path) = std::env::var_os(env_name)
        .map(PathBuf::from)
        .filter(|path| path.exists())
    {
        return Ok(path);
    }
    let candidates = if arch == "arm64" || arch == "aarch64" {
        [
            "qemu-system-aarch64",
            "qemu-system-arm",
            "qemu-system-x86_64",
        ]
    } else {
        [
            "qemu-system-x86_64",
            "qemu-system-aarch64",
            "qemu-system-arm",
        ]
    };
    for candidate in candidates {
        if let Some(path) = find_program(candidate) {
            return Ok(path);
        }
    }
    bail!(
        "CapsuleUnavailable: QEMU backend not found. Install QEMU with `brew install qemu`, or set {env_name} to the qemu-system binary path."
    )
}

fn find_program(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    if path.components().count() > 1 && path.exists() {
        return Some(path.to_path_buf());
    }
    for dir in program_search_paths() {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn program_search_paths() -> Vec<PathBuf> {
    let mut paths = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    for fallback in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/opt/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        let path = PathBuf::from(fallback);
        if paths.iter().all(|candidate| candidate != &path) {
            paths.push(path);
        }
    }
    paths
}

fn ensure_ssh_key(path: &Path) -> Result<()> {
    if path.exists() && path.with_extension("pub").exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let ssh_keygen = find_program("ssh-keygen")
        .ok_or_else(|| anyhow!("CapsuleUnavailable: ssh-keygen not found"))?;
    let status = Command::new(ssh_keygen)
        .arg("-t")
        .arg("ed25519")
        .arg("-N")
        .arg("")
        .arg("-f")
        .arg(path)
        .status()?;
    if !status.success() {
        bail!("CapsuleGuestInitFailed: ssh-keygen failed");
    }
    #[cfg(unix)]
    {
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn validate_bridge_policy(
    policy: &CapsuleBridgePolicy,
    workspace_root: Option<&str>,
) -> Result<()> {
    if policy.secrets.expose_keychain {
        bail!("CapsuleBridgeDenied: keychain exposure is not allowed");
    }
    if policy.secrets.expose_ssh_agent {
        bail!(
            "CapsuleBridgeDenied: SSH agent exposure requires explicit SecretHandle broker support"
        );
    }
    if !policy.secrets.expose_env.is_empty() {
        bail!("CapsuleBridgeDenied: raw host env exposure is not allowed");
    }
    let workspace = workspace_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let workspace = match workspace {
        Some(path) => Some(path.canonicalize().with_context(|| {
            format!(
                "CapsuleBridgePolicyInvalid: workspace root unavailable: {}",
                path.display()
            )
        })?),
        None => None,
    };
    for mount in &policy.mounted_paths {
        if mount.mode != "read_only" && mount.mode != "read_write" {
            bail!("CapsuleBridgePolicyInvalid: mount mode must be read_only or read_write");
        }
        let host_path = PathBuf::from(mount.host_path.trim());
        if host_path.as_os_str().is_empty() || host_path == Path::new("/") {
            bail!("CapsuleBridgeDenied: host root mount is denied");
        }
        let canonical = host_path.canonicalize().with_context(|| {
            format!(
                "CapsuleBridgePolicyInvalid: mounted host path is unavailable: {}",
                host_path.display()
            )
        })?;
        if is_sensitive_host_path(&canonical) {
            bail!("CapsuleBridgeDenied: sensitive host path is denied");
        }
        if let Some(workspace) = &workspace {
            if !canonical.starts_with(workspace) {
                bail!("CapsuleBridgeDenied: mounted host path must stay inside workspace policy");
            }
        }
    }
    for port in &policy.ports {
        if port.protocol != "tcp" && port.protocol != "udp" {
            bail!("CapsuleBridgePolicyInvalid: port protocol must be tcp or udp");
        }
        if port.host_port == 0 || port.guest_port == 0 {
            bail!("CapsuleBridgePolicyInvalid: port values must be non-zero");
        }
    }
    match policy.network.mode.as_str() {
        "disabled" | "localhost_only" | "allowed_domains" | "full" => {}
        _ => bail!("CapsuleBridgePolicyInvalid: invalid network mode"),
    }
    Ok(())
}

fn is_sensitive_host_path(path: &Path) -> bool {
    let normalized = path
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    normalized.contains("/.ssh")
        || normalized.contains("/.aws")
        || normalized.contains("/.gcp")
        || normalized.contains("/.azure")
        || normalized.contains("/library/keychains")
        || normalized.contains("/cookies")
        || normalized.ends_with(".pem")
        || normalized.ends_with(".key")
        || normalized.ends_with(".env")
}

fn ensure_stopped_for_disk_mutation(instance: &CapsuleInstance) -> Result<()> {
    if instance.state == "running" && pid_is_alive(instance.pid) {
        bail!("CapsuleBridgeDenied: stop capsule before disk snapshot mutation");
    }
    Ok(())
}

fn pid_is_alive(pid: Option<u32>) -> bool {
    let Some(pid) = pid else {
        return false;
    };
    Command::new("kill")
        .arg("-0")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn stop_process(pid: Option<u32>) {
    let Some(pid) = pid else {
        return;
    };
    let _ = Command::new("kill")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

fn log_file(root: &Path, capsule_id: &str, name: &str) -> Result<File> {
    let dir = instance_dir(root, capsule_id).join("logs");
    fs::create_dir_all(&dir)?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join(name))
        .context("failed to open capsule log")
}

fn pick_host_port() -> Result<u16> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

fn pick_vnc_display() -> Result<(u16, u16)> {
    for port in VNC_PORT_BASE..=VNC_PORT_END {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok((port - VNC_PORT_BASE, port));
        }
    }
    bail!("CapsuleUnavailable: no local VNC display port is available")
}

fn command_text(command: Option<String>, argv: Vec<String>) -> Result<String> {
    if let Some(command) = command
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        return Ok(command);
    }
    if argv.is_empty() {
        bail!("command or argv is required");
    }
    Ok(argv
        .iter()
        .map(|part| shell_quote(part))
        .collect::<Vec<_>>()
        .join(" "))
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '/' | '.' | ':' | '='))
    {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

struct CappedString {
    value: String,
    truncated: bool,
}

fn cap_string(value: String, limit: usize) -> CappedString {
    if value.len() <= limit {
        return CappedString {
            value,
            truncated: false,
        };
    }
    CappedString {
        value: value.chars().take(limit).collect(),
        truncated: true,
    }
}

fn indent_json(value: &Value) -> Result<String> {
    Ok(serde_json::to_string_pretty(value)?
        .lines()
        .map(|line| format!("      {line}"))
        .collect::<Vec<_>>()
        .join("\n"))
}

fn file_name_from_url(url: &str) -> Option<String> {
    let trimmed = url.trim_end_matches('/');
    let tail = trimmed.rsplit('/').next()?.trim();
    if tail.is_empty() {
        return None;
    }
    Some(tail.replace(['?', '&', '='], "_"))
}

fn clean_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn infer_format(path: &Path, fallback: Option<&str>) -> String {
    path.extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "qcow2" | "raw"))
        .or_else(|| fallback.map(ToString::to_string))
        .unwrap_or_else(|| "qcow2".to_string())
}

fn sha256_file(path: impl AsRef<Path>) -> Result<String> {
    let path = path.as_ref();
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn normalize_sha256(value: &str) -> Option<String> {
    let value = value.trim().strip_prefix("sha256:").unwrap_or(value.trim());
    if value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit()) {
        Some(value.to_ascii_lowercase())
    } else {
        None
    }
}

fn parse_sha256sums(text: &str, file_name: &str) -> Option<String> {
    let target = file_name.trim();
    if target.is_empty() {
        return None;
    }
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let Some(checksum) = parts.next().and_then(normalize_sha256) else {
            continue;
        };
        if parts.any(|part| part.trim_start_matches('*') == target) {
            return Some(checksum);
        }
    }
    None
}

fn canonical_string(path: &Path) -> Result<String> {
    Ok(path.canonicalize()?.to_string_lossy().to_string())
}

fn ensure_image_id(value: &str) -> Result<()> {
    let valid = !value.trim().is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'));
    if valid {
        Ok(())
    } else {
        bail!("CapsuleBridgePolicyInvalid: invalid id")
    }
}

fn ensure_safe_file_name(value: &str) -> Result<()> {
    if value.is_empty() || value.contains('/') || value.contains('\\') || value.contains("..") {
        bail!("CapsuleBridgePolicyInvalid: unsafe output name");
    }
    Ok(())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn schema_v1() -> String {
    "v1".to_string()
}

fn official_source() -> String {
    "official".to_string()
}

fn host_arch() -> String {
    match std::env::consts::ARCH {
        "aarch64" => "arm64".to_string(),
        "x86_64" => "x86_64".to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_manifest_lists_current_arch_images() {
        let temp = tempfile::tempdir().expect("tempdir");
        let value: Value = serde_json::from_str(
            &list_images_json(json!({ "storageRoot": temp.path().to_string_lossy() }).to_string())
                .expect("list images"),
        )
        .expect("json");

        assert_eq!(value["schemaVersion"], "v1");
        assert!(value["images"].as_array().expect("images").is_empty() == false);
        assert!(value["images"]
            .as_array()
            .expect("images")
            .iter()
            .any(|entry| entry["image"]["id"] == DEFAULT_AGENT_VM_IMAGE_ID));
    }

    #[test]
    fn parses_sha256sums_file_entries() {
        let checksum = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        let text = format!("{checksum} *ubuntu-24.04-server-cloudimg-arm64.img\n");
        assert_eq!(
            parse_sha256sums(&text, "ubuntu-24.04-server-cloudimg-arm64.img"),
            Some(checksum.to_string())
        );
    }

    #[test]
    fn program_search_paths_include_homebrew_locations() {
        let paths = program_search_paths();
        assert!(paths
            .iter()
            .any(|path| path == Path::new("/opt/homebrew/bin")));
        assert!(paths.iter().any(|path| path == Path::new("/usr/local/bin")));
    }

    #[test]
    fn bridge_policy_denies_sensitive_host_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path().join("workspace");
        let ssh_dir = workspace.join(".ssh");
        fs::create_dir_all(&ssh_dir).expect("ssh dir");
        let policy = CapsuleBridgePolicy {
            mounted_paths: vec![CapsuleMountedPath {
                host_path: ssh_dir.to_string_lossy().to_string(),
                guest_path: "/host/.ssh".to_string(),
                mode: "read_only".to_string(),
            }],
            ..CapsuleBridgePolicy::default()
        };

        assert!(
            validate_bridge_policy(&policy, Some(workspace.to_string_lossy().as_ref()))
                .expect_err("denied")
                .to_string()
                .contains("CapsuleBridgeDenied")
        );
    }

    #[test]
    fn import_image_records_checksum() {
        let temp = tempfile::tempdir().expect("tempdir");
        let image = temp.path().join("image.qcow2");
        fs::write(&image, b"fake-image").expect("image");
        let expected = sha256_file(&image).expect("hash");
        let response: Value = serde_json::from_str(
            &import_image_json(
                json!({
                    "storageRoot": temp.path().join("capsule").to_string_lossy(),
                    "imageId": "test-image",
                    "filePath": image.to_string_lossy(),
                    "checksum": format!("sha256:{expected}")
                })
                .to_string(),
            )
            .expect("import"),
        )
        .expect("json");

        assert_eq!(response["status"], "imported");
        assert_eq!(response["record"]["checksum"], expected);
    }

    #[test]
    fn download_image_uses_manifest_checksum_url() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("source.qcow2");
        fs::write(&source, b"fake-agent-image").expect("source image");
        let expected = sha256_file(&source).expect("hash");
        let sums = temp.path().join("SHA256SUMS");
        fs::write(&sums, format!("{expected} *source.qcow2\n")).expect("sums");
        let manifest = temp.path().join("manifest.json");
        fs::write(
            &manifest,
            json!({
                "schemaVersion": "v1",
                "images": [{
                    "id": "local-agent",
                    "name": "Local Agent",
                    "family": "test",
                    "arch": ["x86_64"],
                    "format": ["qcow2"],
                    "recommended": true,
                    "source": "local",
                    "urls": [{
                        "url": format!("file://{}", source.to_string_lossy()),
                        "arch": "x86_64",
                        "checksumUrl": format!("file://{}", sums.to_string_lossy()),
                        "checksumFileName": "source.qcow2"
                    }]
                }]
            })
            .to_string(),
        )
        .expect("manifest");

        let response: Value = serde_json::from_str(
            &download_image_json(
                json!({
                    "storageRoot": temp.path().join("capsule").to_string_lossy(),
                    "manifestRef": manifest.to_string_lossy(),
                    "imageId": "local-agent",
                    "arch": "x86_64"
                })
                .to_string(),
            )
            .expect("download"),
        )
        .expect("json");

        assert_eq!(response["status"], "downloaded");
        assert_eq!(response["record"]["checksum"], expected);
        assert_eq!(response["record"]["verified"], true);
    }

    #[test]
    fn import_image_uses_manifest_checksum_url_when_checksum_is_omitted() {
        let temp = tempfile::tempdir().expect("tempdir");
        let source = temp.path().join("source.qcow2");
        fs::write(&source, b"fake-agent-image").expect("source image");
        let expected = sha256_file(&source).expect("hash");
        let sums = temp.path().join("SHA256SUMS");
        fs::write(&sums, format!("{expected} *source.qcow2\n")).expect("sums");
        let manifest = temp.path().join("manifest.json");
        fs::write(
            &manifest,
            json!({
                "schemaVersion": "v1",
                "images": [{
                    "id": "local-agent",
                    "name": "Local Agent",
                    "family": "test",
                    "arch": ["x86_64"],
                    "format": ["qcow2"],
                    "recommended": true,
                    "source": "local",
                    "urls": [{
                        "url": "https://example.invalid/source.qcow2",
                        "arch": "x86_64",
                        "checksumUrl": format!("file://{}", sums.to_string_lossy()),
                        "checksumFileName": "source.qcow2"
                    }]
                }]
            })
            .to_string(),
        )
        .expect("manifest");

        let response: Value = serde_json::from_str(
            &import_image_json(
                json!({
                    "storageRoot": temp.path().join("capsule").to_string_lossy(),
                    "manifestRef": manifest.to_string_lossy(),
                    "imageId": "local-agent",
                    "filePath": source.to_string_lossy(),
                    "arch": "x86_64"
                })
                .to_string(),
            )
            .expect("import"),
        )
        .expect("json");

        assert_eq!(response["status"], "imported");
        assert_eq!(response["record"]["checksum"], expected);
        assert_eq!(response["record"]["verified"], true);
    }

    #[test]
    fn qemu_args_expose_local_vnc_console() {
        let temp = tempfile::tempdir().expect("tempdir");
        let instance = CapsuleInstance {
            schema_version: schema_v1(),
            capsule_id: "vm-a".to_string(),
            project_id: None,
            image_id: DEFAULT_AGENT_VM_IMAGE_ID.to_string(),
            state: "created".to_string(),
            backend: "qemu".to_string(),
            arch: "x86_64".to_string(),
            pid: None,
            ssh_port: None,
            vnc_port: None,
            workspace_root: None,
            guest_workspace_path: "/workspace".to_string(),
            bridge_policy: CapsuleBridgePolicy {
                network: CapsuleNetworkPolicy {
                    mode: "full".to_string(),
                    allowed_domains: Vec::new(),
                },
                ..CapsuleBridgePolicy::default()
            },
            memory_mib: DEFAULT_MEMORY_MIB,
            cpu_count: DEFAULT_CPU_COUNT,
            disk_path: temp.path().join("disk.qcow2").to_string_lossy().to_string(),
            seed_iso_path: None,
            ssh_key_path: temp.path().join("id_ed25519").to_string_lossy().to_string(),
            created_at: now_iso(),
            updated_at: now_iso(),
        };
        let args = qemu_base_args(&instance, &temp.path().join("seed.iso"), 2222, 7);

        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "-vnc" && pair[1] == "127.0.0.1:7"));
        assert!(!args
            .windows(2)
            .any(|pair| pair[0] == "-display" && pair[1] == "none"));
        assert!(args
            .iter()
            .any(|arg| arg == "user,id=net0,hostfwd=tcp:127.0.0.1:2222-:22"));
    }

    #[test]
    fn qemu_args_restrict_localhost_only_network() {
        let temp = tempfile::tempdir().expect("tempdir");
        let instance = CapsuleInstance {
            schema_version: schema_v1(),
            capsule_id: "vm-a".to_string(),
            project_id: None,
            image_id: DEFAULT_AGENT_VM_IMAGE_ID.to_string(),
            state: "created".to_string(),
            backend: "qemu".to_string(),
            arch: "x86_64".to_string(),
            pid: None,
            ssh_port: None,
            vnc_port: None,
            workspace_root: None,
            guest_workspace_path: "/workspace".to_string(),
            bridge_policy: CapsuleBridgePolicy {
                network: CapsuleNetworkPolicy {
                    mode: "localhost_only".to_string(),
                    allowed_domains: Vec::new(),
                },
                ..CapsuleBridgePolicy::default()
            },
            memory_mib: DEFAULT_MEMORY_MIB,
            cpu_count: DEFAULT_CPU_COUNT,
            disk_path: temp.path().join("disk.qcow2").to_string_lossy().to_string(),
            seed_iso_path: None,
            ssh_key_path: temp.path().join("id_ed25519").to_string_lossy().to_string(),
            created_at: now_iso(),
            updated_at: now_iso(),
        };
        let args = qemu_base_args(&instance, &temp.path().join("seed.iso"), 2222, 7);

        assert!(args
            .iter()
            .any(|arg| { arg == "user,id=net0,restrict=on,hostfwd=tcp:127.0.0.1:2222-:22" }));
        assert!(!args.windows(2).any(|pair| pair[0] == "-nic"));
    }

    #[test]
    fn prepare_seed_iso_target_removes_stale_iso() {
        let temp = tempfile::tempdir().expect("tempdir");
        let iso = temp.path().join("seed.iso");
        fs::write(&iso, b"stale").expect("stale iso");

        prepare_seed_iso_target(&iso).expect("prepare target");

        assert!(!iso.exists());
    }

    #[test]
    fn nocloud_user_data_injects_password_hash_and_console_autologin() {
        let temp = tempfile::tempdir().expect("tempdir");
        let instance = CapsuleInstance {
            schema_version: schema_v1(),
            capsule_id: "vm-a".to_string(),
            project_id: None,
            image_id: DEFAULT_AGENT_VM_IMAGE_ID.to_string(),
            state: "created".to_string(),
            backend: "qemu".to_string(),
            arch: "x86_64".to_string(),
            pid: None,
            ssh_port: None,
            vnc_port: None,
            workspace_root: None,
            guest_workspace_path: "/workspace".to_string(),
            bridge_policy: CapsuleBridgePolicy::default(),
            memory_mib: DEFAULT_MEMORY_MIB,
            cpu_count: DEFAULT_CPU_COUNT,
            disk_path: temp.path().join("disk.qcow2").to_string_lossy().to_string(),
            seed_iso_path: None,
            ssh_key_path: temp.path().join("id_ed25519").to_string_lossy().to_string(),
            created_at: now_iso(),
            updated_at: now_iso(),
        };
        let hash = "$6$lyraTestSalt$rLCllOKIi6D4834O1c6zr8ijiwjhcItt2ox6CI.zXxBu718oQJazTrzAHxnxeh/Yh1Bd4irmMV0K3N5s3KzVI/";

        let user_data =
            build_nocloud_user_data(&instance, "ssh-ed25519 test", 2222, 5907, Some(hash), true)
                .expect("user-data");

        assert!(user_data.contains(&format!("passwd: '{hash}'")));
        assert!(user_data.contains("lock_passwd: false"));
        assert!(user_data.contains("ssh_pwauth: true"));
        assert!(user_data.contains("agetty --autologin lyra"));
        assert!(!user_data.contains("lyra-secret-plaintext"));
    }

    #[test]
    fn nocloud_user_data_keeps_password_auth_disabled_without_hash() {
        let temp = tempfile::tempdir().expect("tempdir");
        let instance = CapsuleInstance {
            schema_version: schema_v1(),
            capsule_id: "vm-a".to_string(),
            project_id: None,
            image_id: DEFAULT_AGENT_VM_IMAGE_ID.to_string(),
            state: "created".to_string(),
            backend: "qemu".to_string(),
            arch: "x86_64".to_string(),
            pid: None,
            ssh_port: None,
            vnc_port: None,
            workspace_root: None,
            guest_workspace_path: "/workspace".to_string(),
            bridge_policy: CapsuleBridgePolicy::default(),
            memory_mib: DEFAULT_MEMORY_MIB,
            cpu_count: DEFAULT_CPU_COUNT,
            disk_path: temp.path().join("disk.qcow2").to_string_lossy().to_string(),
            seed_iso_path: None,
            ssh_key_path: temp.path().join("id_ed25519").to_string_lossy().to_string(),
            created_at: now_iso(),
            updated_at: now_iso(),
        };

        let user_data =
            build_nocloud_user_data(&instance, "ssh-ed25519 test", 2222, 5907, None, false)
                .expect("user-data");

        assert!(user_data.contains("ssh_pwauth: false"));
        assert!(!user_data.contains("passwd:"));
        assert!(!user_data.contains("lock_passwd: false"));
        assert!(!user_data.contains("agetty --autologin lyra"));
    }

    #[test]
    fn nocloud_user_data_rejects_plaintext_password_values() {
        let temp = tempfile::tempdir().expect("tempdir");
        let instance = CapsuleInstance {
            schema_version: schema_v1(),
            capsule_id: "vm-a".to_string(),
            project_id: None,
            image_id: DEFAULT_AGENT_VM_IMAGE_ID.to_string(),
            state: "created".to_string(),
            backend: "qemu".to_string(),
            arch: "x86_64".to_string(),
            pid: None,
            ssh_port: None,
            vnc_port: None,
            workspace_root: None,
            guest_workspace_path: "/workspace".to_string(),
            bridge_policy: CapsuleBridgePolicy::default(),
            memory_mib: DEFAULT_MEMORY_MIB,
            cpu_count: DEFAULT_CPU_COUNT,
            disk_path: temp.path().join("disk.qcow2").to_string_lossy().to_string(),
            seed_iso_path: None,
            ssh_key_path: temp.path().join("id_ed25519").to_string_lossy().to_string(),
            created_at: now_iso(),
            updated_at: now_iso(),
        };

        let error = build_nocloud_user_data(
            &instance,
            "ssh-ed25519 test",
            2222,
            5907,
            Some("lyra-secret-plaintext"),
            true,
        )
        .expect_err("invalid password hash");

        assert!(error
            .to_string()
            .contains("invalid guest login password hash"));
    }
}
