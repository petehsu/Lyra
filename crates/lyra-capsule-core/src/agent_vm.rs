use anyhow::{anyhow, bail, Context, Result};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

const INSTANCE_FILE: &str = "instance.v1.json";
const BINDING_FILE_VERSION: &str = "v1";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageRequest {
    #[serde(default, alias = "storage_root")]
    storage_root: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateSessionVmRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(alias = "session_id")]
    session_id: String,
    #[serde(default, alias = "vm_id", alias = "capsule_id")]
    vm_id: Option<String>,
    #[serde(default, alias = "image_id")]
    image_id: Option<String>,
    #[serde(default, alias = "project_id")]
    project_id: Option<String>,
    #[serde(default, alias = "workspace_root")]
    workspace_root: Option<String>,
    #[serde(default, alias = "guest_workspace_path")]
    guest_workspace_path: Option<String>,
    #[serde(default, alias = "memory_mib")]
    memory_mib: Option<u32>,
    #[serde(default, alias = "cpu_count")]
    cpu_count: Option<u8>,
    #[serde(default, alias = "bridge_policy")]
    bridge_policy: Option<Value>,
    #[serde(default, alias = "attach_mode")]
    attach_mode: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListBindingsRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(default, alias = "session_id")]
    session_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadBindingRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(default, alias = "session_id")]
    session_id: Option<String>,
    #[serde(default, alias = "vm_id", alias = "capsule_id")]
    vm_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachSessionVmRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(alias = "session_id")]
    session_id: String,
    #[serde(alias = "vm_id", alias = "capsule_id")]
    vm_id: String,
    #[serde(default, alias = "attach_mode")]
    attach_mode: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TakeoverSessionVmRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(alias = "session_id")]
    session_id: String,
    #[serde(alias = "vm_id", alias = "capsule_id")]
    vm_id: String,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ForkSessionVmRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(alias = "session_id")]
    session_id: String,
    #[serde(alias = "source_vm_id", alias = "source_capsule_id")]
    source_vm_id: String,
    #[serde(default, alias = "snapshot_id")]
    snapshot_id: Option<String>,
    #[serde(default, alias = "new_vm_id", alias = "new_capsule_id")]
    new_vm_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateInheritanceProfileRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(alias = "session_id")]
    session_id: String,
    #[serde(alias = "source_vm_id", alias = "source_capsule_id")]
    source_vm_id: String,
    #[serde(default, alias = "profile_id")]
    profile_id: Option<String>,
    #[serde(default)]
    include: Vec<String>,
    #[serde(default, alias = "expires_at")]
    expires_at: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyInheritanceProfileRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(alias = "session_id")]
    session_id: String,
    #[serde(alias = "profile_id")]
    profile_id: String,
    #[serde(default, alias = "new_vm_id", alias = "new_capsule_id")]
    new_vm_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RevokeBindingRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(alias = "session_id")]
    session_id: String,
    #[serde(alias = "vm_id", alias = "capsule_id")]
    vm_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVmBinding {
    #[serde(default = "schema_v1", alias = "schema_version")]
    schema_version: String,
    vm_id: String,
    owner_session_id: String,
    attached_session_ids: Vec<String>,
    execution_target: String,
    state: String,
    source: Value,
    bridge_policy_ref: String,
    created_at: String,
    updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentVmInheritanceProfile {
    #[serde(default = "schema_v1", alias = "schema_version")]
    schema_version: String,
    profile_id: String,
    owner_session_id: String,
    source_vm_id: String,
    include: Vec<String>,
    description: Option<String>,
    expires_at: Option<String>,
    created_at: String,
}

pub fn create_session_vm_json(request_json: String) -> Result<String> {
    let request = parse::<CreateSessionVmRequest>(&request_json)?;
    let session_id = required_id("sessionId", &request.session_id)?;
    let vm_id = request
        .vm_id
        .as_deref()
        .and_then(clean_string)
        .unwrap_or_else(|| format!("agent-vm-{}", Uuid::new_v4()));
    ensure_id(&vm_id)?;
    let image_id = request
        .image_id
        .as_deref()
        .and_then(clean_string)
        .unwrap_or_else(|| crate::DEFAULT_AGENT_VM_IMAGE_ID.to_string());
    let attach_mode = request
        .attach_mode
        .as_deref()
        .and_then(clean_string)
        .unwrap_or_else(|| "exclusive".to_string());
    let storage_root = request.storage.storage_root.clone();
    let mut create_payload = serde_json::Map::new();
    if let Some(root) = storage_root.clone() {
        create_payload.insert("storageRoot".to_string(), Value::String(root));
    }
    create_payload.insert("capsuleId".to_string(), Value::String(vm_id.clone()));
    create_payload.insert("imageId".to_string(), Value::String(image_id));
    if let Some(project_id) = request.project_id.and_then(|value| clean_string(&value)) {
        create_payload.insert("projectId".to_string(), Value::String(project_id));
    }
    if let Some(workspace_root) = request
        .workspace_root
        .and_then(|value| clean_string(&value))
    {
        create_payload.insert("workspaceRoot".to_string(), Value::String(workspace_root));
    }
    if let Some(guest_workspace_path) = request
        .guest_workspace_path
        .and_then(|value| clean_string(&value))
    {
        create_payload.insert(
            "guestWorkspacePath".to_string(),
            Value::String(guest_workspace_path),
        );
    }
    if let Some(memory_mib) = request.memory_mib {
        create_payload.insert("memoryMib".to_string(), json!(memory_mib));
    }
    if let Some(cpu_count) = request.cpu_count {
        create_payload.insert("cpuCount".to_string(), json!(cpu_count));
    }
    create_payload.insert(
        "bridgePolicy".to_string(),
        request
            .bridge_policy
            .unwrap_or_else(default_agent_vm_bridge_policy),
    );
    let created: Value = serde_json::from_str(&crate::create_capsule_json(
        Value::Object(create_payload).to_string(),
    )?)?;
    let attach_payload = json!({
        "storageRoot": storage_root,
        "sessionId": session_id,
        "vmId": vm_id,
        "attachMode": attach_mode,
    });
    let attached: Value =
        serde_json::from_str(&attach_session_vm_json(attach_payload.to_string())?)?;
    let binding = attached.get("binding").cloned().unwrap_or(Value::Null);
    let vm = vm_summary_from_instance(
        created.get("capsule").unwrap_or(&Value::Null),
        Some(binding.clone()),
    );
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "created",
        "auditEvent": "agent_vm.created",
        "vm": vm,
        "binding": binding,
    }))
}

pub fn list_agent_vms_json(request_json: String) -> Result<String> {
    let request = parse::<StorageRequest>(&request_json)?;
    let root = resolve_root(request.storage_root.as_deref())?;
    let bindings = read_bindings(&root)?;
    let instances_root = instances_dir(&root);
    if !instances_root.exists() {
        return to_json(&json!({
            "schemaVersion": "v1",
            "status": "listed",
            "vms": [],
        }));
    }

    let mut vms = Vec::new();
    for entry in fs::read_dir(instances_root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let fallback_id = entry.file_name().to_string_lossy().to_string();
        let instance_path = entry.path().join(INSTANCE_FILE);
        let Ok(text) = fs::read_to_string(&instance_path) else {
            continue;
        };
        let instance: Value = serde_json::from_str(&text).with_context(|| {
            format!(
                "AgentVmUnavailable: failed to parse {}",
                instance_path.display()
            )
        })?;
        let vm_id = instance
            .get("capsuleId")
            .or_else(|| instance.get("vmId"))
            .and_then(Value::as_str)
            .and_then(clean_string)
            .unwrap_or(fallback_id);
        let binding = bindings
            .iter()
            .find(|candidate| candidate.vm_id == vm_id)
            .cloned();
        vms.push(vm_summary_from_instance(
            &instance,
            binding.map(serde_json::to_value).transpose()?,
        ));
    }
    vms.sort_by(|left, right| {
        left.get("vmId")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .cmp(
                right
                    .get("vmId")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            )
    });
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "listed",
        "vms": vms,
    }))
}

fn vm_summary_from_instance(instance: &Value, binding: Option<Value>) -> Value {
    let vm_id = instance
        .get("capsuleId")
        .or_else(|| instance.get("vmId"))
        .and_then(Value::as_str)
        .and_then(clean_string)
        .unwrap_or_else(|| "unknown".to_string());
    json!({
        "vmId": vm_id,
        "state": instance_state(instance),
        "imageId": instance.get("imageId").cloned().unwrap_or(Value::Null),
        "projectId": instance.get("projectId").cloned().unwrap_or(Value::Null),
        "workspaceRoot": instance.get("workspaceRoot").cloned().unwrap_or(Value::Null),
        "backend": instance.get("backend").cloned().unwrap_or(Value::Null),
        "arch": instance.get("arch").cloned().unwrap_or(Value::Null),
        "sshPort": instance.get("sshPort").cloned().unwrap_or(Value::Null),
        "vncPort": instance.get("vncPort").cloned().unwrap_or(Value::Null),
        "createdAt": instance.get("createdAt").cloned().unwrap_or(Value::Null),
        "updatedAt": instance.get("updatedAt").cloned().unwrap_or(Value::Null),
        "binding": binding.unwrap_or(Value::Null),
    })
}

pub fn list_session_bindings_json(request_json: String) -> Result<String> {
    let request = parse::<ListBindingsRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let session_id = request.session_id.as_deref().and_then(clean_string);
    let bindings = read_bindings(&root)?
        .into_iter()
        .filter(|binding| {
            session_id.is_none()
                || session_id
                    .as_ref()
                    .is_some_and(|id| binding_matches_session(binding, id))
        })
        .collect::<Vec<_>>();
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "listed",
        "bindings": bindings,
    }))
}

pub fn read_session_binding_json(request_json: String) -> Result<String> {
    let request = parse::<ReadBindingRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let binding = if let Some(vm_id) = request.vm_id.as_deref().and_then(clean_string) {
        read_binding(&root, &vm_id)?
    } else if let Some(session_id) = request.session_id.as_deref().and_then(clean_string) {
        read_bindings(&root)?
            .into_iter()
            .find(|binding| binding_matches_session(binding, &session_id))
            .ok_or_else(|| anyhow!("AgentVmBindingNotFound: session has no Agent VM binding"))?
    } else {
        bail!("AgentVmBindingInvalid: sessionId or vmId is required");
    };
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "read",
        "binding": binding,
    }))
}

pub fn attach_session_vm_json(request_json: String) -> Result<String> {
    let request = parse::<AttachSessionVmRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let session_id = required_id("sessionId", &request.session_id)?;
    let vm_id = required_id("vmId", &request.vm_id)?;
    let attach_mode = request
        .attach_mode
        .as_deref()
        .and_then(clean_string)
        .unwrap_or_else(|| "shared".to_string());
    if attach_mode != "shared" && attach_mode != "exclusive" {
        bail!("AgentVmBindingInvalid: attachMode must be shared or exclusive");
    }
    let instance = read_instance_value(&root, &vm_id)?;
    let state = instance_state(&instance);
    let mut binding = read_binding(&root, &vm_id).unwrap_or_else(|_| AgentVmBinding {
        schema_version: schema_v1(),
        vm_id: vm_id.clone(),
        owner_session_id: session_id.clone(),
        attached_session_ids: Vec::new(),
        execution_target: "agent_vm".to_string(),
        state,
        source: json!({"kind": "existing_vm", "sourceVmId": vm_id, "attachMode": attach_mode}),
        bridge_policy_ref: format!("agent-vm://{vm_id}/bridge-policy"),
        created_at: now_iso(),
        updated_at: now_iso(),
    });
    if attach_mode == "exclusive"
        && binding
            .attached_session_ids
            .iter()
            .any(|attached| attached != &session_id)
    {
        bail!("AgentVmBindingDenied: VM is already attached; use takeover for exclusive access");
    }
    if binding
        .attached_session_ids
        .iter()
        .all(|id| id != &session_id)
    {
        binding.attached_session_ids.push(session_id.clone());
    }
    binding.state = instance_state(&instance);
    binding.source = json!({"kind": "existing_vm", "sourceVmId": vm_id, "attachMode": attach_mode});
    binding.updated_at = now_iso();
    write_binding(&root, &binding)?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "attached",
        "auditEvent": "agent_vm.attached_to_session",
        "binding": binding,
    }))
}

pub fn takeover_session_vm_json(request_json: String) -> Result<String> {
    let request = parse::<TakeoverSessionVmRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let session_id = required_id("sessionId", &request.session_id)?;
    let vm_id = required_id("vmId", &request.vm_id)?;
    let instance = read_instance_value(&root, &vm_id)?;
    let mut binding = read_binding(&root, &vm_id)?;
    binding.owner_session_id = session_id.clone();
    binding.attached_session_ids = vec![session_id];
    binding.state = instance_state(&instance);
    binding.updated_at = now_iso();
    write_binding(&root, &binding)?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "taken_over",
        "auditEvent": "agent_vm.exclusive_takeover_requested",
        "reason": request.reason,
        "binding": binding,
    }))
}

pub fn fork_session_vm_json(request_json: String) -> Result<String> {
    let request = parse::<ForkSessionVmRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let session_id = required_id("sessionId", &request.session_id)?;
    let source_vm_id = required_id("sourceVmId", &request.source_vm_id)?;
    let new_vm_id = request
        .new_vm_id
        .as_deref()
        .and_then(clean_string)
        .unwrap_or_else(|| format!("agent-vm-{}", Uuid::new_v4()));
    ensure_id(&new_vm_id)?;
    let source_dir = instance_dir(&root, &source_vm_id);
    let target_dir = instance_dir(&root, &new_vm_id);
    if !source_dir.is_dir() {
        bail!("AgentVmBindingNotFound: source VM does not exist");
    }
    if target_dir.exists() {
        bail!("AgentVmBindingInvalid: target VM already exists");
    }
    copy_dir_all(&source_dir, &target_dir)?;
    let mut instance = read_instance_value(&root, &new_vm_id)?;
    replace_instance_id(&mut instance, &source_vm_id, &new_vm_id, &target_dir);
    fs::write(
        target_dir.join(INSTANCE_FILE),
        serde_json::to_string_pretty(&instance)?,
    )?;
    let binding = AgentVmBinding {
        schema_version: schema_v1(),
        vm_id: new_vm_id.clone(),
        owner_session_id: session_id.clone(),
        attached_session_ids: vec![session_id],
        execution_target: "agent_vm".to_string(),
        state: instance_state(&instance),
        source: match request.snapshot_id.as_deref().and_then(clean_string) {
            Some(snapshot_id) => json!({
                "kind": "snapshot",
                "sourceVmId": source_vm_id,
                "snapshotId": snapshot_id,
            }),
            None => json!({
                "kind": "existing_vm",
                "sourceVmId": source_vm_id,
                "attachMode": "fork_copy",
            }),
        },
        bridge_policy_ref: format!("agent-vm://{new_vm_id}/bridge-policy"),
        created_at: now_iso(),
        updated_at: now_iso(),
    };
    write_binding(&root, &binding)?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "forked",
        "auditEvent": "agent_vm.forked_from_snapshot",
        "binding": binding,
    }))
}

pub fn create_inheritance_profile_json(request_json: String) -> Result<String> {
    let request = parse::<CreateInheritanceProfileRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let session_id = required_id("sessionId", &request.session_id)?;
    let source_vm_id = required_id("sourceVmId", &request.source_vm_id)?;
    read_instance_value(&root, &source_vm_id)?;
    let profile_id = request
        .profile_id
        .as_deref()
        .and_then(clean_string)
        .unwrap_or_else(|| format!("inheritance-{}", Uuid::new_v4()));
    ensure_id(&profile_id)?;
    let profile = AgentVmInheritanceProfile {
        schema_version: schema_v1(),
        profile_id: profile_id.clone(),
        owner_session_id: session_id,
        source_vm_id,
        include: if request.include.is_empty() {
            vec!["login_state".to_string(), "package_cache".to_string()]
        } else {
            request
                .include
                .into_iter()
                .filter_map(|value| clean_string(&value))
                .collect()
        },
        description: request.description.and_then(|value| clean_string(&value)),
        expires_at: request.expires_at.and_then(|value| clean_string(&value)),
        created_at: now_iso(),
    };
    write_inheritance_profile(&root, &profile)?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "created",
        "auditEvent": "agent_vm.inheritance_profile_created",
        "profile": profile,
    }))
}

pub fn apply_inheritance_profile_json(request_json: String) -> Result<String> {
    let request = parse::<ApplyInheritanceProfileRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let profile = read_inheritance_profile(&root, &request.profile_id)?;
    let fork_payload = json!({
        "storageRoot": request.storage.storage_root,
        "sessionId": request.session_id,
        "sourceVmId": profile.source_vm_id,
        "newVmId": request.new_vm_id,
    });
    let forked: Value = serde_json::from_str(&fork_session_vm_json(fork_payload.to_string())?)?;
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "applied",
        "auditEvent": "agent_vm.inheritance_profile_applied",
        "profile": profile,
        "binding": forked.get("binding").cloned().unwrap_or(Value::Null),
    }))
}

pub fn revoke_session_binding_json(request_json: String) -> Result<String> {
    let request = parse::<RevokeBindingRequest>(&request_json)?;
    let root = resolve_root(request.storage.storage_root.as_deref())?;
    let session_id = required_id("sessionId", &request.session_id)?;
    let vm_id = required_id("vmId", &request.vm_id)?;
    let mut binding = read_binding(&root, &vm_id)?;
    binding
        .attached_session_ids
        .retain(|attached| attached != &session_id);
    if binding.owner_session_id == session_id {
        binding.owner_session_id = binding
            .attached_session_ids
            .first()
            .cloned()
            .unwrap_or_default();
    }
    binding.updated_at = now_iso();
    if binding.owner_session_id.is_empty() && binding.attached_session_ids.is_empty() {
        let _ = fs::remove_file(binding_path(&root, &vm_id));
    } else {
        write_binding(&root, &binding)?;
    }
    to_json(&json!({
        "schemaVersion": "v1",
        "status": "revoked",
        "auditEvent": "agent_vm.detached_from_session",
        "binding": binding,
    }))
}

fn read_bindings(root: &Path) -> Result<Vec<AgentVmBinding>> {
    let dir = bindings_dir(root);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut bindings = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let text = fs::read_to_string(entry.path())?;
        bindings.push(serde_json::from_str(&text)?);
    }
    bindings.sort_by(|left: &AgentVmBinding, right| left.vm_id.cmp(&right.vm_id));
    Ok(bindings)
}

fn read_binding(root: &Path, vm_id: &str) -> Result<AgentVmBinding> {
    ensure_id(vm_id)?;
    let text = fs::read_to_string(binding_path(root, vm_id))
        .with_context(|| format!("AgentVmBindingNotFound: {vm_id}"))?;
    serde_json::from_str(&text).context("AgentVmBindingInvalid: failed to parse binding")
}

fn write_binding(root: &Path, binding: &AgentVmBinding) -> Result<()> {
    ensure_id(&binding.vm_id)?;
    fs::create_dir_all(bindings_dir(root))?;
    fs::write(
        binding_path(root, &binding.vm_id),
        serde_json::to_string_pretty(binding)?,
    )?;
    Ok(())
}

fn write_inheritance_profile(root: &Path, profile: &AgentVmInheritanceProfile) -> Result<()> {
    fs::create_dir_all(inheritance_profiles_dir(root))?;
    fs::write(
        inheritance_profile_path(root, &profile.profile_id),
        serde_json::to_string_pretty(profile)?,
    )?;
    Ok(())
}

fn read_inheritance_profile(root: &Path, profile_id: &str) -> Result<AgentVmInheritanceProfile> {
    let profile_id = required_id("profileId", profile_id)?;
    let text = fs::read_to_string(inheritance_profile_path(root, &profile_id))
        .with_context(|| format!("AgentVmInheritanceProfileNotFound: {profile_id}"))?;
    serde_json::from_str(&text).context("AgentVmInheritanceProfileInvalid: failed to parse profile")
}

fn read_instance_value(root: &Path, vm_id: &str) -> Result<Value> {
    ensure_id(vm_id)?;
    let text = fs::read_to_string(instance_dir(root, vm_id).join(INSTANCE_FILE))
        .with_context(|| format!("AgentVmUnavailable: VM not found: {vm_id}"))?;
    serde_json::from_str(&text).context("AgentVmUnavailable: failed to parse VM state")
}

fn replace_instance_id(
    instance: &mut Value,
    source_vm_id: &str,
    new_vm_id: &str,
    target_dir: &Path,
) {
    if let Some(object) = instance.as_object_mut() {
        object.insert(
            "capsuleId".to_string(),
            Value::String(new_vm_id.to_string()),
        );
        object.insert("state".to_string(), Value::String("created".to_string()));
        object.insert("pid".to_string(), Value::Null);
        object.insert("sshPort".to_string(), Value::Null);
        object.insert("vncPort".to_string(), Value::Null);
        object.insert("seedIsoPath".to_string(), Value::Null);
        object.insert("updatedAt".to_string(), Value::String(now_iso()));
        for key in ["diskPath", "sshKeyPath"] {
            if let Some(value) = object.get(key).and_then(Value::as_str).map(str::to_string) {
                *object.get_mut(key).expect("key exists") =
                    Value::String(value.replace(source_vm_id, new_vm_id));
            }
        }
        object.entry("diskPath".to_string()).or_insert_with(|| {
            Value::String(target_dir.join("disk.qcow2").to_string_lossy().to_string())
        });
    }
}

fn binding_matches_session(binding: &AgentVmBinding, session_id: &str) -> bool {
    binding.owner_session_id == session_id
        || binding
            .attached_session_ids
            .iter()
            .any(|attached| attached == session_id)
}

fn instance_state(instance: &Value) -> String {
    instance
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string()
}

fn copy_dir_all(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let next_target = target.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &next_target)?;
        } else if ty.is_file() {
            fs::copy(entry.path(), next_target)?;
        }
    }
    Ok(())
}

fn parse<T: for<'de> Deserialize<'de>>(request_json: &str) -> Result<T> {
    serde_json::from_str(&request_json).context("failed to parse Agent VM request")
}

fn to_json(value: &Value) -> Result<String> {
    serde_json::to_string(value).context("failed to serialize Agent VM response")
}

fn resolve_root(value: Option<&str>) -> Result<PathBuf> {
    let root = value
        .and_then(clean_string)
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("HOME").ok().map(|home| {
                PathBuf::from(home)
                    .join(".lyra")
                    .join("modules")
                    .join("capsule")
            })
        })
        .ok_or_else(|| anyhow!("AgentVmUnavailable: storage root is unavailable"))?;
    fs::create_dir_all(&root)?;
    Ok(root)
}

fn instances_dir(root: &Path) -> PathBuf {
    root.join("instances")
}

fn instance_dir(root: &Path, vm_id: &str) -> PathBuf {
    instances_dir(root).join(vm_id)
}

fn bindings_dir(root: &Path) -> PathBuf {
    root.join("agent-vm-bindings")
}

fn binding_path(root: &Path, vm_id: &str) -> PathBuf {
    bindings_dir(root).join(format!("{vm_id}.{BINDING_FILE_VERSION}.json"))
}

fn inheritance_profiles_dir(root: &Path) -> PathBuf {
    root.join("agent-vm-inheritance")
}

fn inheritance_profile_path(root: &Path, profile_id: &str) -> PathBuf {
    inheritance_profiles_dir(root).join(format!("{profile_id}.{BINDING_FILE_VERSION}.json"))
}

fn required_id(name: &str, value: &str) -> Result<String> {
    let value =
        clean_string(value).ok_or_else(|| anyhow!("AgentVmBindingInvalid: {name} is required"))?;
    ensure_id(&value)?;
    Ok(value)
}

fn ensure_id(value: &str) -> Result<()> {
    let valid = !value.trim().is_empty()
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'));
    if valid {
        Ok(())
    } else {
        bail!("AgentVmBindingInvalid: invalid id")
    }
}

fn clean_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn schema_v1() -> String {
    "v1".to_string()
}

fn default_agent_vm_bridge_policy() -> Value {
    json!({
        "schemaVersion": "v1",
        "mountedPaths": [],
        "network": {
            "mode": "localhost_only",
            "allowedDomains": []
        },
        "secrets": {
            "exposeSshAgent": false,
            "exposeEnv": [],
            "exposeKeychain": false,
            "secretHandles": []
        },
        "ports": []
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attach_and_read_binding_for_existing_vm() {
        let temp = tempfile::tempdir().expect("tempdir");
        let vm_dir = temp.path().join("instances").join("vm-a");
        fs::create_dir_all(&vm_dir).expect("vm dir");
        fs::write(
            vm_dir.join(INSTANCE_FILE),
            json!({
                "schemaVersion": "v1",
                "capsuleId": "vm-a",
                "state": "created"
            })
            .to_string(),
        )
        .expect("instance");

        let attached: Value = serde_json::from_str(
            &attach_session_vm_json(
                json!({
                    "storageRoot": temp.path().to_string_lossy(),
                    "sessionId": "session-a",
                    "vmId": "vm-a",
                })
                .to_string(),
            )
            .expect("attach"),
        )
        .expect("json");
        assert_eq!(attached["status"], "attached");

        let read: Value = serde_json::from_str(
            &read_session_binding_json(
                json!({
                    "storageRoot": temp.path().to_string_lossy(),
                    "sessionId": "session-a",
                })
                .to_string(),
            )
            .expect("read"),
        )
        .expect("json");
        assert_eq!(read["binding"]["vmId"], "vm-a");
        assert_eq!(read["binding"]["executionTarget"], "agent_vm");
    }

    #[test]
    fn create_session_vm_creates_instance_and_binding() {
        let temp = tempfile::tempdir().expect("tempdir");
        let image_dir = temp
            .path()
            .join("images")
            .join(crate::DEFAULT_AGENT_VM_IMAGE_ID);
        fs::create_dir_all(&image_dir).expect("image dir");
        fs::write(
            image_dir.join("image-record.v1.json"),
            json!({
                "schemaVersion": "v1",
                "imageId": crate::DEFAULT_AGENT_VM_IMAGE_ID,
                "imageName": "Lyra Agent VM Lite (Ubuntu 24.04 LTS)",
                "arch": "x86_64",
                "format": "qcow2",
                "source": "test",
                "filePath": temp.path().join("image.qcow2").to_string_lossy(),
                "checksum": null,
                "verified": false,
                "signatureVerified": false,
                "importedAt": now_iso(),
                "verifiedAt": null
            })
            .to_string(),
        )
        .expect("image record");
        let workspace = temp.path().join("workspace");
        fs::create_dir_all(&workspace).expect("workspace");

        let created: Value = serde_json::from_str(
            &create_session_vm_json(
                json!({
                    "storageRoot": temp.path().to_string_lossy(),
                    "sessionId": "session-a",
                    "vmId": "vm-a",
                    "workspaceRoot": workspace.to_string_lossy(),
                })
                .to_string(),
            )
            .expect("create"),
        )
        .expect("json");
        assert_eq!(created["status"], "created");
        assert_eq!(created["vm"]["vmId"], "vm-a");
        assert_eq!(created["binding"]["ownerSessionId"], "session-a");
        let instance: Value = serde_json::from_str(
            &fs::read_to_string(
                temp.path()
                    .join("instances")
                    .join("vm-a")
                    .join(INSTANCE_FILE),
            )
            .expect("instance"),
        )
        .expect("instance json");
        assert_eq!(
            instance["bridgePolicy"]["network"]["mode"],
            "localhost_only"
        );

        let listed: Value = serde_json::from_str(
            &list_agent_vms_json(
                json!({
                    "storageRoot": temp.path().to_string_lossy(),
                })
                .to_string(),
            )
            .expect("list"),
        )
        .expect("json");
        assert_eq!(listed["vms"][0]["vmId"], "vm-a");
        assert_eq!(listed["vms"][0]["binding"]["ownerSessionId"], "session-a");
    }
}
