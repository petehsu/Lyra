use super::*;
use std::{fs, path::Path};

pub(crate) fn export_memory_audit_snapshot(root: &Path) -> AgentRuntimeResult<Value> {
    let exports_dir = root.join("exports");
    fs::create_dir_all(&exports_dir).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let timestamp = now().replace(':', "-");
    let jsonl_path = exports_dir.join(format!("memory-audit-{timestamp}.jsonl"));
    let md_path = exports_dir.join(format!("memory-audit-{timestamp}.md"));

    let memories = list_long_term_memory(
        root,
        MemoryQuery {
            include_archived: true,
            limit: 500,
            ..MemoryQuery::default()
        },
    )?;
    let candidates = list_memory_candidates(root, None, 200)?;
    let injection = latest_injection_snapshot(root).unwrap_or_else(|_| json!({}));

    let mut jsonl_lines = Vec::new();
    for record in &memories {
        jsonl_lines.push(
            serde_json::to_string(&json!({
                "kind": "memory",
                "record": memory_record_json(record),
            }))
            .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
        );
    }
    for candidate in &candidates {
        jsonl_lines.push(
            serde_json::to_string(&json!({
                "kind": "candidate",
                "candidate": memory_candidate_json(candidate),
            }))
            .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
        );
    }
    jsonl_lines.push(
        serde_json::to_string(&json!({
            "kind": "injection",
            "snapshot": injection,
        }))
        .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
    );
    let policy_snapshot = build_effective_policy_snapshot(None, None);
    jsonl_lines.push(
        serde_json::to_string(&json!({
            "kind": "policy_snapshot",
            "snapshot": policy_snapshot,
        }))
        .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
    );
    fs::write(&jsonl_path, jsonl_lines.join("\n"))
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    let mut md = String::from("# Lyra Memory Audit Export\n\n");
    md.push_str(&format!("Generated: {}\n\n", now()));
    md.push_str("## Active Memories\n\n");
    for record in memories
        .iter()
        .filter(|record| record.status == "active")
        .take(80)
    {
        md.push_str(&format!(
            "- [{}] {} | layer={} | class={} | conf={:.2}\n",
            record.id, record.fact, record.layer, record.value_class, record.confidence
        ));
    }
    md.push_str("\n## Pending Candidates\n\n");
    for candidate in candidates.iter().filter(|c| c.status == "pending").take(40) {
        md.push_str(&format!(
            "- [{}] {} | action={}\n",
            candidate.id, candidate.fact, candidate.proposed_action
        ));
    }
    md.push_str("\n## Policy Snapshot\n\n```json\n");
    md.push_str(
        &serde_json::to_string_pretty(&policy_snapshot).unwrap_or_else(|_| "{}".to_string()),
    );
    md.push_str("\n```\n");
    md.push_str("\n## Latest Injection\n\n```json\n");
    md.push_str(&serde_json::to_string_pretty(&injection).unwrap_or_else(|_| "{}".to_string()));
    md.push_str("\n```\n");
    fs::write(&md_path, md).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;

    let layer_projections = export_layer_memory_projections(root, true)?;
    let prompt_cache = rebuild_prompt_cache_from_injection_events(root)
        .and_then(|_| export_dynamic_prompt_cache_markdown(root))
        .unwrap_or_else(|error| json!({ "error": error.to_string() }));

    Ok(json!({
        "jsonlPath": jsonl_path.display().to_string(),
        "markdownPath": md_path.display().to_string(),
        "memoryCount": memories.len(),
        "candidateCount": candidates.len(),
        "layerProjections": layer_projections,
        "promptCache": prompt_cache,
        "policySnapshotId": policy_snapshot.get("policySnapshotId").cloned().unwrap_or(Value::Null),
    }))
}

pub(crate) fn build_effective_policy_snapshot(
    session_id: Option<&str>,
    turn_id: Option<&str>,
) -> Value {
    let permission_policy =
        read_permission_policy().unwrap_or_else(|error| json!({ "error": error.to_string() }));
    let policy_snapshot_id = format!(
        "memory-policy-{}-{}",
        session_id.unwrap_or("global"),
        turn_id.unwrap_or("export")
    );
    json!({
        "policySnapshotId": policy_snapshot_id,
        "permissionPolicy": permission_policy,
        "capturedAt": now(),
        "source": "effective_runtime_policy",
    })
}
