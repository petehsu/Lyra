use super::*;

pub(super) fn try_upsert_memory_embedding(
    conn: &Connection,
    record: &LongTermMemoryRecord,
) -> AgentRuntimeResult<Option<()>> {
    let Some(provider) = embedding_provider() else {
        return Ok(None);
    };
    if record.status != "active" || is_expired(record) {
        conn.execute(
            "DELETE FROM memory_embeddings WHERE memory_id = ?1",
            params![record.id],
        )
        .map_err(sql_error)?;
        return Ok(None);
    }
    let text = memory_embedding_text(record);
    let content_hash = stable_hash(&text);
    let existing_hash = conn
        .query_row(
            "SELECT content_hash FROM memory_embeddings WHERE memory_id = ?1",
            params![record.id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(sql_error)?;
    if existing_hash.as_deref() == Some(content_hash.as_str()) {
        return Ok(Some(()));
    }
    let descriptor = active_embedding_descriptor();
    let (vector, used_fallback) = match provider.embed(&text) {
        Ok(vector) => (vector, false),
        Err(error) if descriptor.remote_available => {
            let fallback = LocalHashEmbeddingProvider.embed(&text)?;
            record_embedding_quality_best_effort(&descriptor, true);
            (fallback, true)
        }
        Err(error) => return Err(error),
    };
    if !used_fallback {
        record_embedding_quality_best_effort(&descriptor, false);
    }
    let timestamp = now();
    conn.execute(
        "INSERT INTO memory_embeddings
          (memory_id, provider, model, dimension, vector, content_hash, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(memory_id) DO UPDATE SET
           provider = excluded.provider,
           model = excluded.model,
           dimension = excluded.dimension,
           vector = excluded.vector,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at",
        params![
            record.id,
            provider.provider(),
            provider.model(),
            vector.len() as i64,
            vector_to_blob(&vector),
            content_hash,
            timestamp,
        ],
    )
    .map_err(sql_error)?;
    Ok(Some(()))
}

pub(super) fn load_embedding_map(
    conn: &Connection,
) -> AgentRuntimeResult<HashMap<String, Vec<f32>>> {
    let mut statement = conn
        .prepare("SELECT memory_id, vector FROM memory_embeddings")
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let blob: Vec<u8> = row.get(1)?;
            Ok((id, blob_to_vector(&blob)))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    Ok(rows.into_iter().collect())
}

pub(super) fn load_memory_embedding(
    conn: &Connection,
    memory_id: &str,
) -> AgentRuntimeResult<Option<Vec<f32>>> {
    conn.query_row(
        "SELECT vector FROM memory_embeddings WHERE memory_id = ?1",
        params![memory_id],
        |row| row.get::<_, Vec<u8>>(0),
    )
    .optional()
    .map(|blob| blob.map(|value| blob_to_vector(&value)))
    .map_err(sql_error)
}

#[derive(Clone, Debug)]
pub(crate) struct ActiveEmbeddingDescriptor {
    pub(crate) provider: String,
    pub(crate) model: String,
    pub(crate) dimension: usize,
    pub(crate) remote_available: bool,
}

fn record_embedding_quality_best_effort(
    descriptor: &ActiveEmbeddingDescriptor,
    used_fallback: bool,
) {
    if let Ok(root) = super::runtime_root_for_memory()
        && let Ok(conn) = super::open_memory_connection(&root)
        && super::init_memory_schema(&conn).is_ok()
    {
        let _ = super::super::memory_embedding_config::record_embedding_quality_event(
            &conn,
            &descriptor.provider,
            &descriptor.model,
            used_fallback,
        );
    }
}

pub(crate) fn active_embedding_descriptor() -> ActiveEmbeddingDescriptor {
    match embedding_provider() {
        Some(ActiveEmbeddingProvider::Remote(provider)) => ActiveEmbeddingDescriptor {
            provider: provider.provider().to_string(),
            model: provider.model().to_string(),
            dimension: provider.dimension(),
            remote_available: true,
        },
        Some(ActiveEmbeddingProvider::Local(provider)) => ActiveEmbeddingDescriptor {
            provider: provider.provider().to_string(),
            model: provider.model().to_string(),
            dimension: provider.dimension(),
            remote_available: false,
        },
        None => ActiveEmbeddingDescriptor {
            provider: "disabled".to_string(),
            model: "none".to_string(),
            dimension: 0,
            remote_available: false,
        },
    }
}

pub(super) fn query_embedding(query: &str) -> Option<Vec<f32>> {
    let provider = embedding_provider()?;
    let descriptor = active_embedding_descriptor();
    let key = format!(
        "{}:{}:{}",
        provider.provider(),
        provider.model(),
        stable_hash(query)
    );
    let cache = QUERY_EMBEDDING_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(cache) = cache.lock()
        && let Some(vector) = cache.get(&key)
    {
        return Some(vector.clone());
    }
    let (vector, used_fallback) = match provider.embed(query) {
        Ok(vector) => (vector, false),
        Err(_) => (LocalHashEmbeddingProvider.embed(query).ok()?, true),
    };
    record_embedding_quality_best_effort(&descriptor, used_fallback);
    if let Ok(mut cache) = cache.lock() {
        if cache.len() >= 64
            && let Some(first_key) = cache.keys().next().cloned()
        {
            cache.remove(&first_key);
        }
        cache.insert(key, vector.clone());
    }
    Some(vector)
}

pub(super) enum ActiveEmbeddingProvider {
    Remote(RemoteEmbeddingProvider),
    Local(LocalHashEmbeddingProvider),
}

impl ActiveEmbeddingProvider {
    pub(super) fn embed(&self, text: &str) -> AgentRuntimeResult<Vec<f32>> {
        match self {
            Self::Remote(provider) => provider.embed(text),
            Self::Local(provider) => provider.embed(text),
        }
    }

    pub(super) fn provider(&self) -> &'static str {
        match self {
            Self::Remote(provider) => provider.provider(),
            Self::Local(provider) => provider.provider(),
        }
    }

    pub(super) fn model(&self) -> &str {
        match self {
            Self::Remote(provider) => provider.model(),
            Self::Local(provider) => provider.model(),
        }
    }

    pub(super) fn dimension(&self) -> usize {
        match self {
            Self::Remote(provider) => provider.dimension(),
            Self::Local(provider) => provider.dimension(),
        }
    }
}

struct RemoteEmbeddingProvider {
    profile: NativeProviderProfile,
    model: String,
    dimension: usize,
}

impl RemoteEmbeddingProvider {
    fn try_from_runtime() -> Option<Self> {
        let state = state().lock().ok()?;
        let provider_id = state
            .config
            .default_provider
            .as_ref()
            .or(state.config.memory_agent_provider.as_ref())?;
        let profile = state.config.providers.get(provider_id)?.clone();
        let model = profile.embedding_model.clone()?;
        if model == EMBEDDING_MODEL || model.contains("hash-embedding") {
            return None;
        }
        let base_url = profile.base_url.as_deref()?.trim_end_matches('/');
        if base_url.is_empty() {
            return None;
        }
        Some(Self {
            profile,
            model,
            dimension: 1536,
        })
    }

    fn provider(&self) -> &'static str {
        "openai-compatible"
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn dimension(&self) -> usize {
        self.dimension
    }

    fn embed(&self, text: &str) -> AgentRuntimeResult<Vec<f32>> {
        let base_url = self
            .profile
            .base_url
            .as_deref()
            .ok_or_else(|| AgentRuntimeError::Core("embedding base url missing".to_string()))?
            .trim_end_matches('/');
        let client = super::super::network::http_client_builder(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let mut request = client.post(format!("{base_url}/embeddings")).json(&json!({
            "model": self.model,
            "input": text,
        }));
        request =
            super::super::providers::transport::auth::apply_model_auth(request, &self.profile)?;
        let response = request
            .send()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        if !response.status().is_success() {
            let body = response.text().unwrap_or_default();
            return Err(AgentRuntimeError::Core(format!(
                "embedding request failed: {}",
                body.chars().take(240).collect::<String>()
            )));
        }
        let payload: Value = response
            .json()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let vector = payload
            .get("data")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|item| item.get("embedding"))
            .and_then(Value::as_array)
            .map(|values| {
                values
                    .iter()
                    .filter_map(Value::as_f64)
                    .map(|value| value as f32)
                    .collect::<Vec<_>>()
            })
            .filter(|vector| !vector.is_empty())
            .ok_or_else(|| {
                AgentRuntimeError::Core("embedding response missing vector".to_string())
            })?;
        Ok(vector)
    }
}

pub(super) fn embedding_provider() -> Option<ActiveEmbeddingProvider> {
    if env::var_os("LYRA_MEMORY_DISABLE_EMBEDDINGS").is_some() {
        return None;
    }
    if let Some(provider) = RemoteEmbeddingProvider::try_from_runtime() {
        return Some(ActiveEmbeddingProvider::Remote(provider));
    }
    Some(ActiveEmbeddingProvider::Local(LocalHashEmbeddingProvider))
}

pub(super) fn memory_embedding_text(record: &LongTermMemoryRecord) -> String {
    format!(
        "scope: {}\ncategory: {}\nfact: {}\ncontent: {}\ntags: {}",
        record.scope,
        record.category,
        record.fact,
        serde_json::to_string(&record.content).unwrap_or_default(),
        record.tags.join(" ")
    )
}

pub(super) fn recall_index_text(item: &SystemRecallItem) -> String {
    let summary = item.summary.as_deref().unwrap_or_default();
    let token_text = search_terms(&format!(
        "{} {} {} {}",
        item.text,
        summary,
        item.source_kind,
        item.role.as_deref().unwrap_or_default()
    ))
    .join(" ");
    format!(
        "{}\n{}\n{}\n{}",
        item.text, summary, item.source_kind, token_text
    )
}

pub(super) fn recall_embedding_text(item: &SystemRecallItem) -> String {
    format!(
        "source_kind: {}\nrole: {}\ntext: {}\nsummary: {}",
        item.source_kind,
        item.role.as_deref().unwrap_or_default(),
        item.text,
        item.summary.as_deref().unwrap_or_default()
    )
}

pub(super) fn local_hash_embedding(text: &str, dimension: usize) -> Vec<f32> {
    let mut vector = vec![0.0_f32; dimension];
    for term in search_terms(text) {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        term.hash(&mut hasher);
        let hash = hasher.finish();
        let index = (hash as usize) % dimension;
        let sign = if hash & 1 == 0 { 1.0 } else { -1.0 };
        vector[index] += sign;
    }
    normalize_vector(&mut vector);
    vector
}

pub(super) fn vector_to_blob(vector: &[f32]) -> Vec<u8> {
    let mut output = Vec::with_capacity(vector.len() * 4);
    for value in vector {
        output.extend_from_slice(&value.to_le_bytes());
    }
    output
}

pub(super) fn blob_to_vector(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

pub(super) fn normalize_vector(vector: &mut [f32]) {
    let norm = vector
        .iter()
        .map(|value| (*value as f64) * (*value as f64))
        .sum::<f64>()
        .sqrt();
    if norm <= f64::EPSILON {
        return;
    }
    for value in vector {
        *value = (*value as f64 / norm) as f32;
    }
}

pub(super) fn cosine(left: &[f32], right: &[f32]) -> f64 {
    if left.is_empty() || right.is_empty() || left.len() != right.len() {
        return 0.0;
    }
    left.iter()
        .zip(right.iter())
        .map(|(left, right)| (*left as f64) * (*right as f64))
        .sum::<f64>()
        .max(0.0)
        .min(1.0)
}

pub(super) fn search_terms(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut terms = lower
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 2)
        .map(str::to_string)
        .collect::<Vec<_>>();
    let cjk_chars = lower
        .chars()
        .filter(|character| is_cjk_character(*character))
        .collect::<Vec<_>>();
    for width in [2_usize, 3] {
        if cjk_chars.len() >= width {
            for window in cjk_chars.windows(width) {
                terms.push(window.iter().collect());
            }
        }
    }
    if terms.is_empty() && lower.chars().count() >= 2 {
        terms.push(lower);
    }
    terms.sort();
    terms.dedup();
    terms
}

pub(super) fn is_cjk_character(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xF900..=0xFAFF
            | 0x20000..=0x2A6DF
            | 0x2A700..=0x2B73F
            | 0x2B740..=0x2B81F
            | 0x2B820..=0x2CEAF
    )
}

pub(super) fn stable_hash(text: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

pub(super) fn relation_degree_map(conn: &Connection) -> AgentRuntimeResult<HashMap<String, usize>> {
    let mut degree = HashMap::<String, usize>::new();
    let mut statement = conn
        .prepare("SELECT source_id, target_id FROM memory_relations")
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    for (source, target) in rows {
        *degree.entry(source).or_default() += 1;
        *degree.entry(target).or_default() += 1;
    }
    Ok(degree)
}

pub(super) fn memory_relation_summary(conn: &Connection) -> AgentRuntimeResult<Value> {
    let mut statement = conn
        .prepare(
            "SELECT relation, COUNT(*) FROM memory_relations GROUP BY relation ORDER BY relation",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    let mut by_type = Map::new();
    let mut total = 0_i64;
    for (relation, count) in rows {
        total += count;
        by_type.insert(relation, json!(count));
    }
    Ok(json!({
        "total": total,
        "byType": by_type,
        "defaultDepth": 1,
    }))
}

pub(super) fn contradiction_id_set(conn: &Connection) -> AgentRuntimeResult<HashSet<String>> {
    let mut ids = HashSet::new();
    let mut statement = conn
        .prepare("SELECT source_id, target_id FROM memory_relations WHERE relation = 'contradicts'")
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    for (source, target) in rows {
        ids.insert(source);
        ids.insert(target);
    }
    Ok(ids)
}

pub(super) fn graph_expansion_boosts(
    conn: &Connection,
    seed_ids: &[String],
) -> AgentRuntimeResult<HashMap<String, f64>> {
    if seed_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let seed_set = seed_ids.iter().cloned().collect::<HashSet<_>>();
    let mut boosts = HashMap::new();
    let mut statement = conn
        .prepare(
            "SELECT source_id, target_id, relation, confidence
             FROM memory_relations
             WHERE confidence >= 0.5",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, f64>(3)?,
            ))
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    for (source, target, relation, confidence) in rows {
        if relation == "contradicts" {
            continue;
        }
        if seed_set.contains(&source) && !seed_set.contains(&target) {
            *boosts.entry(target.clone()).or_insert(0.0_f64) += confidence * 0.75;
        }
        if seed_set.contains(&target) && !seed_set.contains(&source) {
            *boosts.entry(source).or_insert(0.0_f64) += confidence * 0.55;
        }
    }
    Ok(boosts)
}

pub(super) fn touch_memory_access_scores<'a>(
    conn: &Connection,
    ids: impl Iterator<Item = (&'a str, f64)>,
    access_type: &str,
    query: Option<&str>,
) -> AgentRuntimeResult<()> {
    let timestamp = now();
    for (id, score) in ids {
        conn.execute(
            "UPDATE memories
             SET access_count = access_count + 1, last_accessed_at = ?2
             WHERE id = ?1",
            params![id, timestamp],
        )
        .map_err(sql_error)?;
        conn.execute(
            "INSERT INTO memory_access_events (id, memory_id, access_type, query, score, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                format!("memory-access-{}", Uuid::new_v4()),
                id,
                access_type,
                query,
                score,
                timestamp,
            ],
        )
        .map_err(sql_error)?;
        write_memory_event(
            conn,
            Some(id),
            "accessed",
            json!({
                "accessType": access_type,
                "query": query,
                "score": score,
            }),
        )?;
    }
    Ok(())
}

pub(super) fn cleanup_candidate_json(record: &LongTermMemoryRecord) -> Option<Value> {
    let relation_degree = record.related_to.len();
    let (half_life_days, age_days, retention, decay_penalty) =
        decay_metrics(record, relation_degree);
    let expired = is_expired(record);
    let stale = retention < 0.35 && record.access_count <= 2;
    let low_confidence = record.confidence < 0.7;
    let superseded = record.status == "superseded";
    if !(expired || stale || low_confidence || superseded) {
        return None;
    }
    let mut reasons = Vec::new();
    if expired {
        reasons.push("expired");
    }
    if stale {
        reasons.push("stale");
    }
    if low_confidence {
        reasons.push("low_confidence");
    }
    if superseded {
        reasons.push("superseded");
    }
    let severity = (if expired { 1.0 } else { 0.0 })
        + (if superseded { 0.9 } else { 0.0 })
        + (if low_confidence { 0.55 } else { 0.0 })
        + decay_penalty;
    Some(json!({
        "record": memory_summary_json(record),
        "reasons": reasons,
        "severity": severity,
        "retention": retention,
        "halfLifeDays": half_life_days,
        "ageDays": age_days,
        "recommendedAction": if superseded || expired { "archive" } else { "review" },
    }))
}

pub(super) fn effective_limit(limit: usize) -> usize {
    if limit == 0 {
        DEFAULT_MEMORY_LIMIT
    } else {
        limit
    }
    .min(MAX_MEMORY_LIMIT)
}

pub(super) fn write_memory_event(
    conn: &Connection,
    memory_id: Option<&str>,
    event_type: &str,
    payload: Value,
) -> AgentRuntimeResult<()> {
    conn.execute(
        "INSERT INTO memory_events (id, memory_id, event_type, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            format!("memory-event-{}", Uuid::new_v4()),
            memory_id,
            event_type,
            serde_json::to_string(&payload)
                .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?,
            now(),
        ],
    )
    .map_err(sql_error)?;
    Ok(())
}

pub(super) fn mutation_to_new_memory(mutation: MemoryMutation) -> LongTermMemoryRecord {
    let timestamp = now();
    let scope = mutation
        .scope
        .as_deref()
        .map(normalize_scope)
        .unwrap_or_else(|| "global".to_string());
    let category = mutation
        .category
        .as_deref()
        .map(normalize_category)
        .unwrap_or_else(|| "other".to_string());
    let source_type = mutation
        .source_type
        .as_deref()
        .map(normalize_source_type)
        .unwrap_or_else(|| "agent_inference".to_string());
    let confidence = mutation
        .confidence
        .unwrap_or_else(|| default_confidence(&source_type))
        .clamp(0.0, 1.0);
    let fact = mutation
        .fact
        .clone()
        .unwrap_or_else(|| {
            mutation
                .content
                .as_ref()
                .and_then(|content| content.get("fact").and_then(Value::as_str))
                .unwrap_or_default()
                .to_string()
        })
        .trim()
        .to_string();
    let content = mutation.content.unwrap_or_else(|| {
        json!({
            "fact": fact,
            "category": category,
            "sourceType": source_type,
        })
    });
    let id = mutation
        .id
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("memory-{}", Uuid::new_v4()));
    let mut related_to = mutation.related_to.unwrap_or_default();
    for relation in &mut related_to {
        if relation.source_id.trim().is_empty() {
            relation.source_id = id.clone();
        }
    }
    let requires_confirmation = content
        .get("requiresConfirmation")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let layer = mutation.layer.clone().unwrap_or_else(|| {
        super::super::memory_layer::resolve_memory_layer(&category, &content, requires_confirmation)
    });
    let value_class = mutation
        .value_class
        .clone()
        .unwrap_or_else(|| super::super::memory_layer::VALUE_SEMANTIC.to_string());
    let abstract_text = mutation
        .abstract_text
        .clone()
        .or_else(|| Some(super::super::memory_layer::memory_abstract_text(&fact)));
    let mut record = LongTermMemoryRecord {
        id,
        scope: scope.clone(),
        category: category.clone(),
        fact,
        content,
        layer,
        value_class,
        abstract_text,
        confidence,
        source_type: source_type.clone(),
        source_ref: mutation.source_ref,
        status: mutation
            .status
            .as_deref()
            .map(normalize_status)
            .unwrap_or_else(|| "active".to_string()),
        priority: mutation
            .priority
            .unwrap_or_else(|| memory_priority_for_record(&scope, &category)),
        created_at: timestamp.clone(),
        updated_at: timestamp,
        last_accessed_at: None,
        access_count: 0,
        tags: mutation.tags.unwrap_or_default(),
        related_to,
        expires_at: mutation.expires_at,
        supersedes: mutation.supersedes,
        superseded_by: mutation.superseded_by,
        source_device: mutation
            .source_device
            .clone()
            .or_else(|| Some(super::super::memory_sync::memory_source_device())),
        revision: mutation.revision.unwrap_or(1),
        sync_origin: mutation
            .sync_origin
            .clone()
            .or_else(|| Some(super::super::memory_sync::SYNC_ORIGIN_LOCAL.to_string())),
    };
    super::super::memory_layer::apply_layer_fields_to_record(&mut record);
    super::super::memory_derived_fields::apply_derived_fields_to_record(&mut record);
    record
}

pub(super) fn mutation_to_memory_candidate(mutation: MemoryCandidateMutation) -> MemoryCandidate {
    let timestamp = now();
    let fact = mutation.fact.trim().to_string();
    let default_expires_at = if mutation.expires_at.is_none() {
        let days = if mutation.source_type == "agent_inference" || mutation.confidence < 0.7 {
            30
        } else {
            180
        };
        Some((Utc::now() + chrono::Duration::days(days)).to_rfc3339_opts(SecondsFormat::Secs, true))
    } else {
        mutation.expires_at.clone()
    };
    let status = mutation
        .status
        .as_deref()
        .map(normalize_candidate_status)
        .unwrap_or_else(|| default_candidate_status(&mutation));
    let stability_review_at = mutation
        .stability_review_at
        .clone()
        .or_else(|| stability_review_at_for_mutation(&mutation));
    let stability_window_hours = mutation
        .stability_window_hours
        .or_else(|| stability_window_hours_for_mutation(&mutation));
    MemoryCandidate {
        id: format!("memory-candidate-{}", Uuid::new_v4()),
        fact: fact.clone(),
        content: if mutation.content.is_null() {
            json!({ "fact": fact })
        } else {
            mutation.content
        },
        category: normalize_category(&mutation.category),
        scope: normalize_scope(&mutation.scope),
        layer: mutation.layer,
        value_class: mutation.value_class,
        trigger_event: mutation.trigger_event,
        evidence_json: mutation.evidence_json,
        confidence: mutation.confidence.clamp(0.0, 1.0),
        source_type: normalize_source_type(&mutation.source_type),
        source_ref: mutation.source_ref,
        proposed_action: normalize_candidate_action(&mutation.proposed_action),
        conflict_with: mutation.conflict_with,
        target_id: mutation.target_id,
        relation_type: mutation
            .relation_type
            .map(|value| normalize_relation(&value)),
        status,
        created_at: timestamp,
        reviewed_at: None,
        expires_at: default_expires_at,
        stability_review_at,
        stability_window_hours,
    }
}

fn default_candidate_status(mutation: &MemoryCandidateMutation) -> String {
    if super::super::memory_stability_policy::should_delay_promotion(mutation) {
        "stability_pending".to_string()
    } else {
        "pending".to_string()
    }
}

fn stability_window_hours_for_mutation(mutation: &MemoryCandidateMutation) -> Option<i64> {
    super::super::memory_stability_policy::stability_window_hours_for_mutation(mutation)
}

fn stability_review_at_for_mutation(mutation: &MemoryCandidateMutation) -> Option<String> {
    super::super::memory_stability_policy::stability_review_at_for_mutation(mutation)
}

pub(super) fn apply_memory_mutation(record: &mut LongTermMemoryRecord, mutation: MemoryMutation) {
    if let Some(scope) = mutation.scope.as_deref() {
        record.scope = normalize_scope(scope);
    }
    if let Some(category) = mutation.category.as_deref() {
        record.category = normalize_category(category);
    }
    if let Some(fact) = mutation.fact {
        record.fact = fact;
    }
    if let Some(content) = mutation.content {
        record.content = content;
    }
    if let Some(layer) = mutation.layer {
        record.layer = layer;
    }
    if let Some(value_class) = mutation.value_class {
        record.value_class = value_class;
    }
    if mutation.abstract_text.is_some() {
        record.abstract_text = mutation.abstract_text;
    }
    if let Some(confidence) = mutation.confidence {
        record.confidence = confidence.clamp(0.0, 1.0);
    }
    if let Some(source_type) = mutation.source_type.as_deref() {
        record.source_type = normalize_source_type(source_type);
    }
    if mutation.source_ref.is_some() {
        record.source_ref = mutation.source_ref;
    }
    if let Some(status) = mutation.status.as_deref() {
        record.status = normalize_status(status);
    }
    if let Some(priority) = mutation.priority {
        record.priority = priority;
    } else {
        record.priority = memory_priority_for_record(&record.scope, &record.category);
    }
    if let Some(tags) = mutation.tags {
        record.tags = tags;
    }
    if let Some(related_to) = mutation.related_to {
        record.related_to = related_to
            .into_iter()
            .map(|mut relation| {
                if relation.source_id.trim().is_empty() {
                    relation.source_id = record.id.clone();
                }
                relation
            })
            .collect();
    }
    if mutation.expires_at.is_some() {
        record.expires_at = mutation.expires_at;
    }
    if mutation.supersedes.is_some() {
        record.supersedes = mutation.supersedes;
    }
    if mutation.superseded_by.is_some() {
        record.superseded_by = mutation.superseded_by;
    }
    if mutation.source_device.is_some() {
        record.source_device = mutation.source_device;
    }
    if let Some(revision) = mutation.revision {
        record.revision = revision;
    } else {
        record.revision = super::super::memory_sync::bump_revision(record.revision);
    }
    if mutation.sync_origin.is_some() {
        record.sync_origin = mutation.sync_origin;
    }
    record.source_device = record
        .source_device
        .clone()
        .or_else(|| Some(super::super::memory_sync::memory_source_device()));
    record.sync_origin = record
        .sync_origin
        .clone()
        .or_else(|| Some(super::super::memory_sync::SYNC_ORIGIN_LOCAL.to_string()));
    super::super::memory_derived_fields::apply_derived_fields_to_record(record);
}

pub(super) fn count_memory_status(conn: &Connection, status: &str) -> AgentRuntimeResult<i64> {
    conn.query_row(
        "SELECT COUNT(*) FROM memories WHERE status = ?1",
        params![status],
        |row| row.get(0),
    )
    .map_err(sql_error)
}

pub(super) fn normalize_scope(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        "global".to_string()
    } else {
        value.to_string()
    }
}

pub(super) fn normalize_category(value: &str) -> String {
    match value.trim() {
        "user_profile" | "preference" | "project" | "instruction" | "goal" | "other" => {
            value.trim().to_string()
        }
        _ => "other".to_string(),
    }
}

pub(super) fn normalize_source_type(value: &str) -> String {
    match value.trim() {
        "user_declaration"
        | "agent_inference"
        | "memory_agent_inference"
        | "tool_observation"
        | "project_fact"
        | "goal_sync"
        | "imported" => value.trim().to_string(),
        _ => "agent_inference".to_string(),
    }
}

pub(super) fn normalize_status(value: &str) -> String {
    match value.trim() {
        "active" | "archived" | "superseded" | "forgotten" => value.trim().to_string(),
        _ => "active".to_string(),
    }
}

pub(super) fn normalize_candidate_status(value: &str) -> String {
    match value.trim() {
        "pending"
        | "stability_pending"
        | "auto_applied"
        | "needs_user_confirmation"
        | "approved"
        | "rejected"
        | "expired" => value.trim().to_string(),
        _ => "pending".to_string(),
    }
}

pub(super) fn normalize_candidate_action(value: &str) -> String {
    match value.trim() {
        "create" | "update" | "replace" | "merge" | "deprecate" | "supersede" | "forget"
        | "link" => value.trim().to_string(),
        _ => "create".to_string(),
    }
}

pub(super) fn normalize_proactive_status(value: &str) -> String {
    match value.trim() {
        "pending" | "dismissed" | "opened" | "expired" => value.trim().to_string(),
        _ => "pending".to_string(),
    }
}

pub(super) fn normalize_proactive_mode(value: &str) -> String {
    match value.trim() {
        "notification_only" | "draft_message" | "open_session" | "continue_existing_session" => {
            value.trim().to_string()
        }
        _ => "notification_only".to_string(),
    }
}

pub(super) fn normalize_relation(value: &str) -> String {
    match value.trim() {
        "related_to"
        | "supports"
        | "contradicts"
        | "supersedes"
        | "belongs_to_project"
        | "same_user_preference"
        | "derived_from" => value.trim().to_string(),
        _ => "related_to".to_string(),
    }
}

pub(super) fn default_confidence(source_type: &str) -> f64 {
    match source_type {
        "user_declaration" => 1.0,
        "project_fact" => 0.9,
        "tool_observation" => 0.85,
        "memory_agent_inference" => 0.7,
        "goal_sync" => 1.0,
        "imported" => 0.75,
        _ => 0.65,
    }
}

pub(super) fn memory_priority_for_record(scope: &str, category: &str) -> i64 {
    match category {
        "instruction" => 100,
        "preference" => 88,
        "user_profile" => 82,
        "project" => 76,
        "goal" => 90,
        _ if scope == "project" => 70,
        _ if scope == "global" => 48,
        _ => 40,
    }
}

pub(super) fn sql_error(error: rusqlite::Error) -> AgentRuntimeError {
    AgentRuntimeError::Core(format!("memory sqlite failed: {error}"))
}
