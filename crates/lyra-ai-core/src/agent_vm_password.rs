use crate::secret_broker::{self, CreateSecretRecordArgs};
use crate::secrets;
use crate::storage::{AiStore, CreateSecretAccessAuditInput};
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

const PASSWORD_BINDING_VERSION: &str = "v1";
const PASSWORD_BOOTSTRAP_TURN_ID: &str = "agent-vm-bootstrap";
const PASSWORD_START_TURN_ID: &str = "agent-vm-start";
const PASSWORD_REVEAL_TURN_ID: &str = "agent-vm-password-reveal";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageRequest {
    #[serde(default, alias = "storage_root")]
    storage_root: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VmIdRequest {
    #[serde(flatten)]
    storage: StorageRequest,
    #[serde(alias = "vm_id", alias = "capsule_id")]
    vm_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentVmPasswordBinding {
    schema_version: String,
    vm_id: String,
    session_id: String,
    secret_id: String,
    target_ref: String,
    created_at: i64,
}

pub fn create_agent_vm_json(request_json: String) -> Result<String> {
    let mut payload: Value =
        serde_json::from_str(&request_json).context("failed to parse Agent VM create request")?;
    let object = payload
        .as_object_mut()
        .ok_or_else(|| anyhow!("AgentVmPasswordInvalid: request must be an object"))?;
    let storage_root = object
        .get("storageRoot")
        .or_else(|| object.get("storage_root"))
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let session_id =
        required_text(object.get("sessionId").or_else(|| object.get("session_id")))?.to_string();
    let vm_id = object
        .get("vmId")
        .or_else(|| object.get("vm_id"))
        .or_else(|| object.get("capsuleId"))
        .or_else(|| object.get("capsule_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("agent-vm-{}", Uuid::new_v4()));
    object.insert("vmId".to_string(), Value::String(vm_id.clone()));

    let response = lyra_capsule_core::create_session_vm_json(payload.to_string())?;
    let store = AiStore::open(storage_root.as_deref())?;
    ensure_password_binding(&store, &session_id, &vm_id)?;
    Ok(response)
}

pub fn start_agent_vm_json(request_json: String) -> Result<String> {
    let mut payload: Value =
        serde_json::from_str(&request_json).context("failed to parse Agent VM start request")?;
    let request: VmIdRequest = serde_json::from_value(payload.clone())
        .context("failed to parse Agent VM password start request")?;
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    if let Some(binding) = read_password_binding(&store, &request.vm_id)? {
        let record = store
            .read_secret_record(&binding.session_id, &binding.secret_id)?
            .ok_or_else(|| anyhow!("AgentVmPasswordNotFound: password secret record is missing"))?;
        let password = secrets::read_secret(&store.root, &record.storage_ref)?;
        store.record_secret_access(CreateSecretAccessAuditInput {
            session_id: binding.session_id.clone(),
            turn_id: PASSWORD_START_TURN_ID.to_string(),
            secret_id: Some(binding.secret_id.clone()),
            handle_id: None,
            operation_id: Some(format!("agent-vm-start:{}", binding.vm_id)),
            access_kind: "inject_to_guest_seed".to_string(),
            target_ref: binding.target_ref.clone(),
            decision: "allow".to_string(),
            reason_codes: vec!["agent_vm_password_hash_injected".to_string()],
        })?;
        let hash = hash_linux_login_password(&password)?;
        let object = payload
            .as_object_mut()
            .ok_or_else(|| anyhow!("AgentVmPasswordInvalid: request must be an object"))?;
        object.insert("loginPasswordHash".to_string(), Value::String(hash));
        object.insert("consoleAutologin".to_string(), Value::Bool(true));
    }
    lyra_capsule_core::start_capsule_json(payload.to_string())
}

pub fn read_password_metadata_json(request_json: String) -> Result<String> {
    let request: VmIdRequest =
        serde_json::from_str(&request_json).context("failed to parse Agent VM password request")?;
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let binding = read_password_binding(&store, &request.vm_id)?;
    Ok(json!({
        "schemaVersion": "v1",
        "status": if binding.is_some() { "available" } else { "missing" },
        "vmId": request.vm_id,
        "password": binding.map(|binding| json!({
            "secretId": binding.secret_id,
            "sessionId": binding.session_id,
            "targetRef": binding.target_ref,
            "createdAt": binding.created_at,
        })),
    })
    .to_string())
}

pub fn reveal_password_json(request_json: String) -> Result<String> {
    let request: VmIdRequest =
        serde_json::from_str(&request_json).context("failed to parse Agent VM password request")?;
    let store = AiStore::open(request.storage.storage_root.as_deref())?;
    let binding = read_password_binding(&store, &request.vm_id)?
        .ok_or_else(|| anyhow!("AgentVmPasswordNotFound: VM has no managed login password"))?;
    let record = store
        .read_secret_record(&binding.session_id, &binding.secret_id)?
        .ok_or_else(|| anyhow!("AgentVmPasswordNotFound: password secret record is missing"))?;
    let password = secrets::read_secret(&store.root, &record.storage_ref)?;
    store.record_secret_access(CreateSecretAccessAuditInput {
        session_id: binding.session_id.clone(),
        turn_id: PASSWORD_REVEAL_TURN_ID.to_string(),
        secret_id: Some(binding.secret_id.clone()),
        handle_id: None,
        operation_id: Some(format!("agent-vm-password-reveal:{}", binding.vm_id)),
        access_kind: "user_reveal".to_string(),
        target_ref: binding.target_ref.clone(),
        decision: "allow".to_string(),
        reason_codes: vec!["agent_vm_password_user_revealed".to_string()],
    })?;
    Ok(json!({
        "schemaVersion": "v1",
        "status": "revealed",
        "vmId": binding.vm_id,
        "username": "lyra",
        "password": password,
        "targetRef": binding.target_ref,
        "secretId": binding.secret_id,
    })
    .to_string())
}

fn ensure_password_binding(
    store: &AiStore,
    session_id: &str,
    vm_id: &str,
) -> Result<AgentVmPasswordBinding> {
    if let Some(binding) = read_password_binding(store, vm_id)? {
        return Ok(binding);
    }
    let password = generate_login_password();
    let target_ref = password_target_ref(vm_id);
    let secret = secret_broker::create_secret_record(
        store,
        session_id,
        PASSWORD_BOOTSTRAP_TURN_ID,
        CreateSecretRecordArgs {
            kind: "password".to_string(),
            label: format!("Agent VM {vm_id} login password"),
            provider: Some("agent_vm".to_string()),
            value: Some(password),
            storage_ref: None,
            scope: Some(json!({
                "allowedTools": ["/tools/capsule/exec"],
                "allowedDomains": [target_ref],
                "allowedCommands": [],
                "allowedPurposes": ["agent_vm_login"],
                "allowModelContext": false,
                "allowArtifactRaw": false,
                "allowCapsuleExposure": true,
            })),
            expires_at: None,
        },
    )?;
    let secret_id = secret
        .get("secret")
        .and_then(|value| value.get("secretId"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("AgentVmPasswordInvalid: secret record missing id"))?
        .to_string();
    let binding = AgentVmPasswordBinding {
        schema_version: PASSWORD_BINDING_VERSION.to_string(),
        vm_id: vm_id.to_string(),
        session_id: session_id.to_string(),
        secret_id,
        target_ref,
        created_at: crate::storage::now_ms(),
    };
    write_password_binding(store, &binding)?;
    Ok(binding)
}

fn generate_login_password() -> String {
    format!(
        "lyra-{}-{}",
        Uuid::new_v4().simple(),
        Uuid::new_v4().simple()
    )
}

fn hash_linux_login_password(password: &str) -> Result<String> {
    let salt = Uuid::new_v4().simple().to_string();
    let salt = &salt[..16];
    let output = Command::new("openssl")
        .arg("passwd")
        .arg("-6")
        .arg("-salt")
        .arg(salt)
        .arg(password)
        .output()
        .context("AgentVmPasswordHashUnavailable: openssl passwd -6 is required")?;
    if output.status.success() == false {
        bail!(
            "AgentVmPasswordHashUnavailable: openssl passwd -6 failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    let hash = String::from_utf8(output.stdout)
        .context("AgentVmPasswordHashUnavailable: openssl output is not UTF-8")?
        .trim()
        .to_string();
    if is_valid_sha512_crypt_hash(&hash) == false {
        bail!("AgentVmPasswordHashUnavailable: openssl produced an invalid password hash");
    }
    Ok(hash)
}

fn is_valid_sha512_crypt_hash(hash: &str) -> bool {
    hash.starts_with("$6$")
        && hash.len() > 20
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'$' | b'.' | b'/' | b'_'))
}

fn read_password_binding(store: &AiStore, vm_id: &str) -> Result<Option<AgentVmPasswordBinding>> {
    let path = password_binding_path(&store.root, vm_id);
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path)
        .with_context(|| format!("AgentVmPasswordInvalid: failed to read {}", path.display()))?;
    serde_json::from_str(&text)
        .with_context(|| format!("AgentVmPasswordInvalid: failed to parse {}", path.display()))
}

fn write_password_binding(store: &AiStore, binding: &AgentVmPasswordBinding) -> Result<()> {
    let dir = password_bindings_dir(&store.root);
    fs::create_dir_all(&dir)?;
    fs::write(
        password_binding_path(&store.root, &binding.vm_id),
        serde_json::to_string_pretty(binding)?,
    )?;
    Ok(())
}

fn password_bindings_dir(root: &Path) -> PathBuf {
    root.join("agent-vm-passwords")
}

fn password_binding_path(root: &Path, vm_id: &str) -> PathBuf {
    password_bindings_dir(root).join(format!("{vm_id}.{PASSWORD_BINDING_VERSION}.json"))
}

fn password_target_ref(vm_id: &str) -> String {
    format!("agent-vm://{vm_id}/login")
}

fn required_text(value: Option<&Value>) -> Result<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| value.is_empty() == false)
        .ok_or_else(|| anyhow!("AgentVmPasswordInvalid: sessionId is required"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn creates_password_secret_without_returning_plaintext() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = AiStore::open(Some(temp.path().to_string_lossy().as_ref())).expect("store");

        let binding = ensure_password_binding(&store, "session-a", "vm-a").expect("binding");

        assert_eq!(binding.vm_id, "vm-a");
        assert_eq!(binding.session_id, "session-a");
        let metadata: Value = serde_json::from_str(
            &read_password_metadata_json(
                json!({
                    "storageRoot": temp.path().to_string_lossy(),
                    "vmId": "vm-a"
                })
                .to_string(),
            )
            .expect("metadata"),
        )
        .expect("metadata json");
        assert_eq!(metadata["status"], "available");
        assert_eq!(metadata["password"]["secretId"], binding.secret_id);
        assert!(metadata.to_string().contains("lyra-") == false);
    }

    #[test]
    fn reveal_password_returns_plaintext_and_audits_access() {
        let temp = tempfile::tempdir().expect("tempdir");
        let store = AiStore::open(Some(temp.path().to_string_lossy().as_ref())).expect("store");
        ensure_password_binding(&store, "session-a", "vm-a").expect("binding");

        let revealed: Value = serde_json::from_str(
            &reveal_password_json(
                json!({
                    "storageRoot": temp.path().to_string_lossy(),
                    "vmId": "vm-a"
                })
                .to_string(),
            )
            .expect("reveal"),
        )
        .expect("reveal json");

        assert_eq!(revealed["username"], "lyra");
        assert!(revealed["password"]
            .as_str()
            .expect("password")
            .starts_with("lyra-"));
        let audit_count = store
            .count_rows_for_test("session-a", "secret_access_audit")
            .expect("audit count");
        assert!(audit_count >= 2);
    }

    #[test]
    fn accepts_openssl_sha512_crypt_hash_shape() {
        assert!(is_valid_sha512_crypt_hash(
            "$6$lyraTestSalt$rLCllOKIi6D4834O1c6zr8ijiwjhcItt2ox6CI.zXxBu718oQJazTrzAHxnxeh/Yh1Bd4irmMV0K3N5s3KzVI/"
        ));
        assert!(!is_valid_sha512_crypt_hash("plain-password"));
    }
}
