use super::*;

pub(super) fn record_tool_usage_from_result(
    manifest: &ToolManifest,
    operation: &ToolOperationEnvelope,
    output: &Value,
) {
    let ok = output.get("ok").and_then(Value::as_bool).unwrap_or(false);
    let error_code = output
        .pointer("/error/code")
        .or_else(|| output.get("notRunReason"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let scene = scene_for_session(&operation.session_id)
        .as_str()
        .to_string();
    let timestamp = now();
    let mut guard = match state().lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let entry = guard
        .tool_usage_cache
        .entry(manifest.path.clone())
        .or_insert_with(|| ToolUsageCacheEntry {
            tool_path: manifest.path.clone(),
            handle: manifest.handle.clone(),
            title: manifest.title.clone(),
            domain: manifest.domain.clone(),
            operation: manifest.operation.clone(),
            ..ToolUsageCacheEntry::default()
        });
    entry.handle = manifest.handle.clone();
    entry.title = manifest.title.clone();
    entry.domain = manifest.domain.clone();
    entry.operation = manifest.operation.clone();
    entry.total_runs = entry.total_runs.saturating_add(1);
    entry.last_used_at = Some(timestamp.clone());
    entry.last_scene = Some(scene.clone());
    let scene_stats = entry.scene_stats.entry(scene).or_default();
    scene_stats.runs = scene_stats.runs.saturating_add(1);
    scene_stats.last_used_at = Some(timestamp.clone());
    if ok {
        entry.successes = entry.successes.saturating_add(1);
        entry.consecutive_failures = 0;
        entry.last_success_at = Some(timestamp);
        entry.last_error_code = None;
        scene_stats.successes = scene_stats.successes.saturating_add(1);
    } else {
        entry.failures = entry.failures.saturating_add(1);
        entry.last_failure_at = Some(timestamp);
        entry.last_error_code = error_code.clone();
        scene_stats.failures = scene_stats.failures.saturating_add(1);
        if error_code.as_deref() != Some("invalid_tool_args") {
            entry.consecutive_failures = entry.consecutive_failures.saturating_add(1);
        }
        guard
            .suppressed_tool_usage_by_turn
            .entry(operation.runtime_turn_id.clone())
            .or_default()
            .insert(manifest.path.clone());
    }
    let _ = guard.save_state();
}

pub(super) fn record_tool_descriptor_inspected(session_id: &str, manifest: &ToolManifest) {
    let mut guard = match state().lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };
    let session_cache = guard
        .inspected_tool_descriptors_by_session
        .entry(session_id.to_string())
        .or_default();
    session_cache.insert(
        manifest.path.clone(),
        ToolDescriptorCacheEntry {
            tool_path: manifest.path.clone(),
            handle: manifest.handle.clone(),
            title: manifest.title.clone(),
            domain: manifest.domain.clone(),
            operation: manifest.operation.clone(),
            inspected_at: now(),
            run_hint: descriptor_run_hint(manifest),
            mini_schema: descriptor_mini_schema(manifest),
        },
    );
}

pub(super) fn annotate_cached_tool_failure(
    output: &mut Value,
    manifest: Option<&ToolManifest>,
    operation: &ToolOperationEnvelope,
) {
    if output.get("ok").and_then(Value::as_bool) != Some(false) {
        return;
    }
    let Some(manifest) = manifest else {
        return;
    };
    let action = format!(
        "This tool failed for the current turn. Do not retry {} immediately with the same arguments; call tool_fs_search with the task description or inspect another /tools/{} capability.",
        manifest.path, manifest.domain
    );
    let reason = output
        .pointer("/error/code")
        .and_then(Value::as_str)
        .unwrap_or("tool_failed")
        .to_string();
    if let Some(object) = output.as_object_mut() {
        object.insert(
            "recommendedNextAction".to_string(),
            Value::String(action.clone()),
        );
        object.insert("cacheSuppressedForTurn".to_string(), Value::Bool(true));
        object.insert(
            "cacheSuppression".to_string(),
            json!({
                "toolPath": manifest.path.clone(),
                "runtimeTurnId": operation.runtime_turn_id.clone(),
                "reason": reason,
            }),
        );
        if let Some(error) = object.get_mut("error").and_then(Value::as_object_mut) {
            error.insert("recommendedNextAction".to_string(), Value::String(action));
        }
    }
}

pub(super) fn tool_usage_search_boosts(scene: &str, turn_id: &str) -> BTreeMap<String, f64> {
    let Ok(guard) = state().lock() else {
        return BTreeMap::new();
    };
    guard
        .tool_usage_cache
        .iter()
        .filter(|(tool_path, _)| {
            !guard
                .suppressed_tool_usage_by_turn
                .get(turn_id)
                .is_some_and(|suppressed| suppressed.contains(*tool_path))
        })
        .filter_map(|(tool_path, entry)| {
            let score = tool_usage_cache_score(entry, scene, Utc::now());
            (score > 0.0).then(|| (tool_path.clone(), score))
        })
        .collect()
}

pub(crate) fn cached_handles_for_scene(
    scene: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    let registry = runtime_registry_with_dispatcher(dispatcher);
    let now = Utc::now();
    let mut entries = match state().lock() {
        Ok(guard) => guard
            .tool_usage_cache
            .values()
            .filter_map(|entry| {
                let manifest = registry.lookup_path(&entry.tool_path)?;
                let score = tool_usage_cache_score(entry, scene, now);
                (score > 0.0 && entry.successes > 0).then(|| {
                    json!({
                        "handle": manifest.handle.clone(),
                        "path": manifest.path.clone(),
                        "title": manifest.title.clone(),
                        "domain": manifest.domain.clone(),
                        "operation": manifest.operation.clone(),
                        "score": round_runtime_score(score),
                        "confidence": round_runtime_score(tool_usage_success_rate(entry)),
                        "successRate": round_runtime_score(tool_usage_success_rate(entry)),
                        "totalRuns": entry.total_runs,
                        "successes": entry.successes,
                        "failures": entry.failures,
                        "consecutiveFailures": entry.consecutive_failures,
                        "lastUsedAt": entry.last_used_at.clone(),
                        "lastSuccessAt": entry.last_success_at.clone(),
                        "source": "toolUsageCache",
                    })
                })
            })
            .collect::<Vec<_>>(),
        Err(_) => Vec::new(),
    };
    entries.sort_by(|left, right| {
        right
            .get("score")
            .and_then(Value::as_f64)
            .partial_cmp(&left.get("score").and_then(Value::as_f64))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    Value::Array(entries.into_iter().take(8).collect())
}

pub(crate) fn inspected_descriptors_for_session(
    session_id: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    let registry = runtime_registry_with_dispatcher(dispatcher);
    let mut entries = match state().lock() {
        Ok(guard) => guard
            .inspected_tool_descriptors_by_session
            .get(session_id)
            .map(|session_cache| {
                session_cache
                    .values()
                    .filter(|entry| registry.lookup_path(&entry.tool_path).is_some())
                    .map(|entry| {
                        json!({
                            "path": entry.tool_path,
                            "handle": entry.handle,
                            "title": entry.title,
                            "domain": entry.domain,
                            "operation": entry.operation,
                            "inspectedAt": entry.inspected_at,
                            "runHint": entry.run_hint,
                            "miniSchema": entry.mini_schema,
                            "source": "sessionDescriptorCache",
                        })
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    entries.sort_by(|left, right| {
        right
            .get("inspectedAt")
            .and_then(Value::as_str)
            .cmp(&left.get("inspectedAt").and_then(Value::as_str))
    });
    Value::Array(entries.into_iter().take(12).collect())
}

pub(crate) fn presearch_hints_for_message(
    message: &str,
    scene: &str,
    turn_id: Option<&str>,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    let query = message.trim();
    if query.is_empty() {
        return Value::Array(Vec::new());
    }
    let scene = ToolScene::parse(scene);
    let registry = runtime_registry_with_dispatcher(dispatcher);
    let usage_boosts = turn_id
        .map(|turn_id| tool_usage_search_boosts(scene.as_str(), turn_id))
        .unwrap_or_default();
    let Ok(response) = registry.search_with_boosts(query, None, 0, 5, scene, &usage_boosts) else {
        return Value::Array(Vec::new());
    };
    let hints = response
        .results
        .into_iter()
        .take(5)
        .filter(|result| result.score >= 8.0)
        .map(|result| {
            json!({
                "query": response.query,
                "path": result.path,
                "handle": result.handle,
                "title": result.title,
                "domain": result.domain,
                "operation": result.operation,
                "summary": result.summary,
                "runHint": result.run_hint,
                "miniSchema": result.mini_schema,
                "score": result.score,
                "matchedFields": result.matched_fields,
                "matchReason": result.match_reason,
                "recommendedNextAction": result.recommended_next_action,
                "source": "latestUserMessagePresearch",
            })
        })
        .collect::<Vec<_>>();
    Value::Array(hints)
}

pub(super) fn tool_usage_cache_score(
    entry: &ToolUsageCacheEntry,
    scene: &str,
    now: DateTime<Utc>,
) -> f64 {
    if entry.total_runs == 0 || entry.successes == 0 {
        return 0.0;
    }
    let Some(last_used_at) = entry
        .last_used_at
        .as_deref()
        .or(entry.last_success_at.as_deref())
    else {
        return 0.0;
    };
    let Ok(last_used_at) = DateTime::parse_from_rfc3339(last_used_at) else {
        return 0.0;
    };
    let age_days = now
        .signed_duration_since(last_used_at.with_timezone(&Utc))
        .num_seconds()
        .max(0) as f64
        / 86_400.0;
    let retention_days = if entry.total_runs >= 3 && tool_usage_success_rate(entry) >= 0.8 {
        90.0
    } else {
        30.0
    };
    if age_days > retention_days {
        return 0.0;
    }
    let success_rate = tool_usage_success_rate(entry);
    let failure_rate = 1.0 - success_rate;
    let recency = (1.0 - (age_days / retention_days)).clamp(0.0, 1.0);
    let frequency = (entry.total_runs as f64 + 1.0).ln().min(4.0) / 4.0;
    let scene_boost = entry
        .scene_stats
        .get(scene)
        .filter(|stats| stats.successes > 0)
        .map(|stats| {
            let scene_success_rate = stats.successes as f64 / stats.runs.max(1) as f64;
            2.0 * scene_success_rate
        })
        .unwrap_or(0.0);
    let failure_penalty = entry.consecutive_failures as f64 * 2.5 + failure_rate * 2.0;
    (success_rate * 7.0 + recency * 4.0 + frequency * 3.0 + scene_boost - failure_penalty)
        .clamp(0.0, 18.0)
}

pub(super) fn tool_usage_success_rate(entry: &ToolUsageCacheEntry) -> f64 {
    if entry.total_runs == 0 {
        0.0
    } else {
        entry.successes as f64 / entry.total_runs as f64
    }
}

pub(super) fn round_runtime_score(score: f64) -> f64 {
    (score * 100.0).round() / 100.0
}

fn descriptor_run_hint(manifest: &ToolManifest) -> String {
    let target = manifest
        .handle
        .as_deref()
        .map(|handle| format!("toolHandle: {handle}"))
        .unwrap_or_else(|| format!("path: {}", manifest.path));
    format!(
        "tool_fs_run with {target}; operation: {}; args follow miniSchema. Re-inspect only if full schema details are needed.",
        manifest.operation
    )
}

fn descriptor_mini_schema(manifest: &ToolManifest) -> Value {
    let schema = &manifest.input_schema;
    let mut required = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    required.sort();
    let required_set = required.iter().cloned().collect::<HashSet<_>>();
    let parameters = schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| {
            let mut entries = properties
                .iter()
                .map(|(name, value)| (name.as_str(), value))
                .collect::<Vec<_>>();
            entries.sort_by(|left, right| {
                required_set
                    .contains(left.0)
                    .cmp(&required_set.contains(right.0))
                    .reverse()
                    .then_with(|| left.0.cmp(right.0))
            });
            entries
                .into_iter()
                .take(12)
                .map(|(name, value)| {
                    let mut summary = serde_json::Map::new();
                    summary.insert("name".to_string(), Value::String(name.to_string()));
                    summary.insert(
                        "required".to_string(),
                        Value::Bool(required_set.contains(name)),
                    );
                    if let Some(kind) = value.get("type") {
                        summary.insert("type".to_string(), kind.clone());
                    }
                    if let Some(default) = value.get("default") {
                        summary.insert("default".to_string(), default.clone());
                    }
                    if let Some(enum_values) = value.get("enum") {
                        summary.insert("enum".to_string(), enum_values.clone());
                    }
                    if let Some(description) = value
                        .get("description")
                        .and_then(Value::as_str)
                        .map(|description| description.chars().take(160).collect::<String>())
                    {
                        summary.insert("description".to_string(), Value::String(description));
                    }
                    Value::Object(summary)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "type": schema.get("type").cloned().unwrap_or_else(|| Value::String("object".to_string())),
        "required": required,
        "parameters": parameters,
        "truncated": schema
            .get("properties")
            .and_then(Value::as_object)
            .is_some_and(|properties| properties.len() > 12),
    })
}
