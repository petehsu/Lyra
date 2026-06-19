use super::{
    AgentRuntimeError, AgentRuntimeResult, LongTermMemoryRecord, MemoryMutation, Value, json,
};
use std::sync::OnceLock;

static SOURCE_DEVICE: OnceLock<String> = OnceLock::new();

pub(crate) const SYNC_ORIGIN_LOCAL: &str = "local";
pub(crate) const SYNC_ORIGIN_REMOTE: &str = "remote";
pub(crate) const SYNC_STATUS_CONFLICT: &str = "conflict";

pub(crate) fn memory_source_device() -> String {
    SOURCE_DEVICE
        .get_or_init(|| {
            std::env::var("LYRA_DEVICE_ID")
                .ok()
                .or_else(|| std::env::var("HOSTNAME").ok())
                .or_else(|| std::env::var("COMPUTERNAME").ok())
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "lyra-local".to_string())
        })
        .clone()
}

pub(crate) fn initial_sync_metadata() -> (String, u64, String) {
    (memory_source_device(), 1, SYNC_ORIGIN_LOCAL.to_string())
}

pub(crate) fn bump_revision(current: u64) -> u64 {
    current.saturating_add(1)
}

pub(crate) fn validate_revision_cas(
    record: &LongTermMemoryRecord,
    expected_revision: Option<u64>,
) -> AgentRuntimeResult<()> {
    let Some(expected) = expected_revision else {
        return Ok(());
    };
    if record.revision != expected {
        return Err(AgentRuntimeError::Core(format!(
            "revision conflict: expected {expected}, found {}",
            record.revision
        )));
    }
    Ok(())
}

pub(crate) fn detect_sync_conflict(
    local: &LongTermMemoryRecord,
    remote_revision: u64,
    remote_device: &str,
) -> bool {
    local.source_device.as_deref() != Some(remote_device) && remote_revision <= local.revision
}

pub(crate) fn merge_remote_memory_mutation(
    local: &LongTermMemoryRecord,
    remote: &Value,
) -> AgentRuntimeResult<MemoryMutation> {
    let remote_id = remote
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AgentRuntimeError::Core("remote memory id is required".to_string()))?;
    if remote_id != local.id {
        return Err(AgentRuntimeError::Core(
            "remote memory id does not match local record".to_string(),
        ));
    }
    let remote_revision = remote.get("revision").and_then(Value::as_u64).unwrap_or(1);
    let remote_device = remote
        .get("sourceDevice")
        .or_else(|| remote.get("source_device"))
        .and_then(Value::as_str)
        .unwrap_or("remote");
    if detect_sync_conflict(local, remote_revision, remote_device) {
        return Err(AgentRuntimeError::Core(format!(
            "sync conflict for memory {}: local revision {} from {:?}, remote revision {remote_revision} from {remote_device}",
            local.id, local.revision, local.source_device
        )));
    }
    if remote_revision <= local.revision {
        return Err(AgentRuntimeError::Core(format!(
            "remote revision {remote_revision} is not newer than local {}",
            local.revision
        )));
    }
    Ok(MemoryMutation {
        id: Some(local.id.clone()),
        fact: remote
            .get("fact")
            .and_then(Value::as_str)
            .map(str::to_string),
        content: remote.get("content").cloned(),
        layer: remote
            .get("layer")
            .and_then(Value::as_str)
            .map(str::to_string),
        value_class: remote
            .get("valueClass")
            .or_else(|| remote.get("value_class"))
            .and_then(Value::as_str)
            .map(str::to_string),
        abstract_text: remote
            .get("abstractText")
            .or_else(|| remote.get("abstract_text"))
            .and_then(Value::as_str)
            .map(str::to_string),
        confidence: remote.get("confidence").and_then(Value::as_f64),
        source_type: remote
            .get("sourceType")
            .or_else(|| remote.get("source_type"))
            .and_then(Value::as_str)
            .map(str::to_string),
        source_ref: remote
            .get("sourceRef")
            .or_else(|| remote.get("source_ref"))
            .and_then(Value::as_str)
            .map(str::to_string),
        status: remote
            .get("status")
            .and_then(Value::as_str)
            .map(str::to_string),
        priority: remote.get("priority").and_then(Value::as_i64),
        revision: Some(remote_revision),
        source_device: Some(remote_device.to_string()),
        sync_origin: Some(SYNC_ORIGIN_REMOTE.to_string()),
        ..MemoryMutation::default()
    })
}

pub(crate) fn sync_reconcile_payload_json(records: &[Value], conflicts: &[Value]) -> Value {
    json!({
        "merged": records,
        "conflicts": conflicts,
        "device": memory_source_device(),
    })
}
