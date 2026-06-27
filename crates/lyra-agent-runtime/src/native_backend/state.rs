use super::*;

pub(crate) static STATE: OnceLock<Mutex<NativeRuntimeState>> = OnceLock::new();
pub(crate) const TOOL_RUNTIME_SCHEMA_VERSION: u32 = 4;

pub(crate) fn state() -> &'static Mutex<NativeRuntimeState> {
    STATE.get_or_init(|| Mutex::new(NativeRuntimeState::load()))
}

impl NativeRuntimeState {
    pub(crate) fn load() -> Self {
        Self::load_from_root(runtime_root())
    }

    pub(crate) fn load_from_root(root: PathBuf) -> Self {
        let sessions_dir = root.join("sessions");
        let _ = fs::create_dir_all(&sessions_dir);
        let _ = prune_low_value_tool_artifacts(&root);

        let state_file = read_json::<NativeStateFile>(&root.join("state.json"));
        let _ = ensure_memory_store(&root);
        let mut config = state_file
            .as_ref()
            .map(|state| state.config.clone())
            .unwrap_or_default();
        install_default_providers(&mut config);

        let previous_tool_runtime_schema_version = state_file
            .as_ref()
            .map(|state| state.tool_runtime_schema_version)
            .unwrap_or_default();
        let reset_tool_sessions =
            previous_tool_runtime_schema_version < TOOL_RUNTIME_SCHEMA_VERSION;
        let mut tool_runtime_migration_diagnostics = state_file
            .as_ref()
            .map(|state| state.tool_runtime_migration_diagnostics.clone())
            .unwrap_or_default();
        if reset_tool_sessions {
            tool_runtime_migration_diagnostics =
                clear_session_files(&sessions_dir, previous_tool_runtime_schema_version);
        }
        let tool_runtime_schema_version =
            if reset_tool_sessions && !tool_runtime_migration_diagnostics.is_empty() {
                previous_tool_runtime_schema_version
            } else {
                TOOL_RUNTIME_SCHEMA_VERSION
            };

        let mut sessions = HashMap::new();
        if !reset_tool_sessions {
            for session_id in list_session_ids(&root).unwrap_or_default() {
                if let Ok(Some(mut session)) = load_session(&root, &session_id) {
                    if resume_pending_trim_journal(&mut session, &root).is_ok() && session.dirty {
                        let _ = save_session(&root, &session);
                        session.dirty = false;
                    }
                    if reconcile_orphan_running_turn(&mut session, false, "runtime_startup") {
                        let _ = save_session(&root, &session);
                        session.dirty = false;
                    }
                    sessions.insert(session.id.clone(), session);
                }
            }
        }

        let pending_permissions = if reset_tool_sessions {
            HashMap::new()
        } else {
            state_file
                .as_ref()
                .map(|state| state.pending_permissions.clone())
                .unwrap_or_default()
        };
        let pending_clarifications = if reset_tool_sessions {
            HashMap::new()
        } else {
            state_file
                .as_ref()
                .map(|state| state.pending_clarifications.clone())
                .unwrap_or_default()
        };
        let mut tool_usage_cache = state_file
            .as_ref()
            .map(|state| state.tool_usage_cache.clone())
            .unwrap_or_default();
        prune_tool_usage_cache(&mut tool_usage_cache, Utc::now());

        let mut loaded = Self {
            root,
            tool_runtime_schema_version,
            tool_runtime_migration_diagnostics,
            tool_usage_cache,
            sessions,
            active_session_id: if reset_tool_sessions {
                None
            } else {
                state_file
                    .as_ref()
                    .and_then(|state| state.active_session_id.clone())
            },
            config,
            active_skills: state_file
                .as_ref()
                .map(|state| state.active_skills.clone())
                .unwrap_or_default(),
            pending_permissions,
            pending_clarifications,
            cancelled_turns: HashSet::new(),
            active_cancellations: HashMap::new(),
            suppressed_tool_usage_by_turn: HashMap::new(),
            inspected_tool_descriptors_by_session: HashMap::new(),
            active_ui_message_by_turn: HashMap::new(),
            event_callback: None,
            host_dispatcher: None,
            active_compressions: HashSet::new(),
        };
        let pruned_pending = loaded.prune_non_live_pending();
        if pruned_pending || reset_tool_sessions {
            let _ = loaded.save_state();
        }
        loaded
    }

    pub(crate) fn save_state(&mut self) -> AgentRuntimeResult<()> {
        fs::create_dir_all(self.root.join("sessions"))
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        prune_tool_usage_cache(&mut self.tool_usage_cache, Utc::now());
        let pending_permissions = self
            .pending_permissions
            .iter()
            .filter(|(_, request)| is_live_pending_permission(&self.sessions, request))
            .map(|(id, request)| (id.clone(), request.clone()))
            .collect();
        let pending_clarifications = self
            .pending_clarifications
            .iter()
            .filter(|(_, request)| is_live_pending_clarification(&self.sessions, request))
            .map(|(id, request)| (id.clone(), request.clone()))
            .collect();
        let state = NativeStateFile {
            tool_runtime_schema_version: self.tool_runtime_schema_version,
            tool_runtime_migration_diagnostics: self.tool_runtime_migration_diagnostics.clone(),
            tool_usage_cache: self.tool_usage_cache.clone(),
            active_session_id: self.active_session_id.clone(),
            config: self.config.clone(),
            active_skills: self.active_skills.clone(),
            pending_permissions,
            pending_clarifications,
        };
        write_json(&self.root.join("state.json"), &state)?;
        let session_ids = self
            .sessions
            .values()
            .filter(|session| !session.ephemeral)
            .filter(|session| session.dirty || !session_db_path(&self.root, &session.id).exists())
            .map(|session| session.id.clone())
            .collect::<Vec<_>>();
        for session_id in session_ids {
            if let Some(session) = self.sessions.get_mut(&session_id) {
                save_session(&self.root, session)?;
                session.dirty = false;
            }
        }
        Ok(())
    }

    pub(crate) fn prune_non_live_pending(&mut self) -> bool {
        let before_permissions = self.pending_permissions.len();
        let before_clarifications = self.pending_clarifications.len();
        self.pending_permissions
            .retain(|_, request| is_live_pending_permission(&self.sessions, request));
        self.pending_clarifications
            .retain(|_, request| is_live_pending_clarification(&self.sessions, request));
        before_permissions != self.pending_permissions.len()
            || before_clarifications != self.pending_clarifications.len()
    }

    pub(crate) fn resolve_session_id(
        &mut self,
        requested: Option<String>,
    ) -> AgentRuntimeResult<String> {
        if let Some(id) = requested.filter(|value| !value.trim().is_empty()) {
            if id == "active" {
                return self.ensure_active_session();
            }
            if self.sessions.contains_key(&id) {
                self.active_session_id = Some(id.clone());
                return Ok(id);
            }
            return Err(AgentRuntimeError::Core(format!("session not found: {id}")));
        }
        self.ensure_active_session()
    }

    pub(crate) fn ensure_active_session(&mut self) -> AgentRuntimeResult<String> {
        if let Some(id) = self.active_session_id.clone()
            && self.sessions.contains_key(&id)
        {
            return Ok(id);
        }
        let session = new_session(None, None, "normal");
        let id = session.id.clone();
        self.sessions.insert(id.clone(), session);
        self.active_session_id = Some(id.clone());
        self.save_state()?;
        Ok(id)
    }
}

fn clear_session_files(sessions_dir: &Path, from_schema_version: u32) -> Vec<Value> {
    let mut diagnostics = Vec::new();
    let Ok(entries) = fs::read_dir(sessions_dir) else {
        return diagnostics;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else if path.extension().and_then(|value| value.to_str()) == Some("json") {
            fs::remove_file(&path)
        } else {
            continue;
        };
        if let Err(error) = result {
            diagnostics.push(json!({
                "code": "tool_runtime_session_delete_failed",
                "message": "Failed to delete an incompatible Agent session during runtime schema migration.",
                "path": path.display().to_string(),
                "fromSchemaVersion": from_schema_version,
                "toSchemaVersion": TOOL_RUNTIME_SCHEMA_VERSION,
                "error": error.to_string(),
            }));
        }
    }
    diagnostics
}

fn prune_tool_usage_cache(
    cache: &mut HashMap<String, ToolUsageCacheEntry>,
    now: DateTime<Utc>,
) -> bool {
    let before_len = cache.len();
    cache.retain(|_, entry| {
        let Some(last_used_at) = entry_last_used_at(entry) else {
            return false;
        };
        let Ok(last_used_at) = DateTime::parse_from_rfc3339(last_used_at) else {
            return false;
        };
        let age_days = now
            .signed_duration_since(last_used_at.with_timezone(&Utc))
            .num_days()
            .max(0);
        age_days <= tool_usage_retention_days(entry)
    });
    if cache.len() > 500 {
        let mut ranked = cache
            .values()
            .map(|entry| {
                (
                    entry.tool_path.clone(),
                    entry_last_used_at(entry).unwrap_or_default().to_string(),
                    tool_usage_success_rate(entry),
                    entry.total_runs,
                )
            })
            .collect::<Vec<_>>();
        ranked.sort_by(|left, right| {
            right
                .1
                .cmp(&left.1)
                .then_with(|| {
                    right
                        .2
                        .partial_cmp(&left.2)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| right.3.cmp(&left.3))
        });
        let keep = ranked
            .into_iter()
            .take(500)
            .map(|entry| entry.0)
            .collect::<HashSet<_>>();
        cache.retain(|path, _| keep.contains(path));
    }
    cache.len() != before_len
}

fn entry_last_used_at(entry: &ToolUsageCacheEntry) -> Option<&str> {
    entry
        .last_used_at
        .as_deref()
        .or(entry.last_success_at.as_deref())
        .or(entry.last_failure_at.as_deref())
}

fn tool_usage_retention_days(entry: &ToolUsageCacheEntry) -> i64 {
    if entry.successes == 0 {
        7
    } else if entry.total_runs >= 3 && tool_usage_success_rate(entry) >= 0.8 {
        90
    } else {
        30
    }
}

fn tool_usage_success_rate(entry: &ToolUsageCacheEntry) -> f64 {
    if entry.total_runs == 0 {
        0.0
    } else {
        entry.successes as f64 / entry.total_runs as f64
    }
}

fn is_live_pending_permission(
    sessions: &HashMap<String, NativeSession>,
    request: &PermissionRequest,
) -> bool {
    request.allowed.is_none()
        && request.status == "pending"
        && session_has_active_turn(sessions, &request.session_id, &request.turn_id)
}

fn is_live_pending_clarification(
    sessions: &HashMap<String, NativeSession>,
    request: &ClarificationRequest,
) -> bool {
    request.answer.is_none()
        && request.status == "pending"
        && session_has_active_turn(sessions, &request.session_id, &request.turn_id)
}

fn session_has_active_turn(
    sessions: &HashMap<String, NativeSession>,
    session_id: &str,
    turn_id: &str,
) -> bool {
    sessions.get(session_id).is_some_and(|session| {
        session.snapshot.get("turnStatus").and_then(Value::as_str) == Some("running")
            && session.snapshot.get("activeTurnId").and_then(Value::as_str) == Some(turn_id)
    })
}

pub(crate) fn default_true() -> bool {
    true
}

pub(crate) fn default_false() -> bool {
    false
}

pub(crate) fn runtime_root() -> PathBuf {
    if let Some(path) = env::var_os("LYRA_AGENT_RUNTIME_HOME") {
        return PathBuf::from(path);
    }
    if cfg!(test) {
        return env::temp_dir()
            .join("lyra-agent-runtime-tests")
            .join(std::process::id().to_string());
    }
    if let Some(path) = env::var_os("LYRA_AGENT_HOME") {
        return PathBuf::from(path).join("agent-runtime");
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".lyra")
        .join("modules")
        .join("agent-runtime")
}

pub(crate) fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let data = fs::read_to_string(path).ok()?;
    serde_json::from_str(&data).ok()
}

pub(crate) fn write_json<T: Serialize>(path: &Path, value: &T) -> AgentRuntimeResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    }
    let data = serde_json::to_vec_pretty(value)
        .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?;
    fs::write(path, data).map_err(|error| AgentRuntimeError::Core(error.to_string()))
}

pub(crate) fn install_default_providers(config: &mut NativeConfig) {
    if config.default_provider.is_none() {
        config.default_provider = Some("openai".to_string());
    }
    if config.default_model.is_none() {
        config.default_model = env::var("OPENAI_MODEL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| Some("gpt-5-mini".to_string()));
    }
    let openai_key = env::var("OPENAI_API_KEY").ok();
    config
        .providers
        .entry("openai".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "openai".to_string(),
            label: "OpenAI".to_string(),
            route_id: providers::routes::openai::ROUTE_ID.to_string(),
            base_url: env::var("OPENAI_BASE_URL")
                .ok()
                .or_else(|| Some(providers::routes::openai::DEFAULT_BASE_URL.to_string())),
            default_model: config.default_model.clone(),
            api_key: openai_key,
            api_key_env: Some("OPENAI_API_KEY".to_string()),
            auth_header: None,
            embedding_model: Some("lyra-hash-embedding-v1".to_string()),
            models: Vec::new(),
        });
    config
        .providers
        .entry("openrouter".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "openrouter".to_string(),
            label: "OpenRouter".to_string(),
            route_id: providers::routes::openrouter::ROUTE_ID.to_string(),
            base_url: env::var("OPENROUTER_BASE_URL")
                .ok()
                .or_else(|| Some(providers::routes::openrouter::DEFAULT_BASE_URL.to_string())),
            default_model: env::var("OPENROUTER_MODEL").ok(),
            api_key: env::var("OPENROUTER_API_KEY").ok(),
            api_key_env: Some("OPENROUTER_API_KEY".to_string()),
            auth_header: None,
            embedding_model: Some("lyra-hash-embedding-v1".to_string()),
            models: Vec::new(),
        });
    config
        .providers
        .entry("anthropic".to_string())
        .or_insert_with(|| {
            let default_model = env::var("ANTHROPIC_MODEL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "claude-sonnet-4-6".to_string());
            NativeProviderProfile {
                id: "anthropic".to_string(),
                label: "Anthropic".to_string(),
                route_id: providers::routes::anthropic::ROUTE_ID.to_string(),
                base_url: env::var("ANTHROPIC_BASE_URL")
                    .ok()
                    .or_else(|| Some(providers::routes::anthropic::DEFAULT_BASE_URL.to_string())),
                default_model: Some(default_model.clone()),
                api_key: env::var("ANTHROPIC_API_KEY").ok(),
                api_key_env: Some("ANTHROPIC_API_KEY".to_string()),
                auth_header: None,
                embedding_model: Some("lyra-hash-embedding-v1".to_string()),
                models: Vec::new(),
            }
        });
    config
        .providers
        .entry("google_gemini".to_string())
        .or_insert_with(|| {
            let default_model = env::var("GEMINI_MODEL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "gemini-2.5-flash".to_string());
            NativeProviderProfile {
                id: "google_gemini".to_string(),
                label: "Google Gemini".to_string(),
                route_id: providers::routes::google_gemini::ROUTE_ID.to_string(),
                base_url: env::var("GEMINI_BASE_URL").ok().or_else(|| {
                    Some(providers::routes::google_gemini::DEFAULT_BASE_URL.to_string())
                }),
                default_model: Some(default_model.clone()),
                api_key: env::var("GEMINI_API_KEY").ok(),
                api_key_env: Some("GEMINI_API_KEY".to_string()),
                auth_header: None,
                embedding_model: Some("lyra-hash-embedding-v1".to_string()),
                models: Vec::new(),
            }
        });
    config
        .providers
        .entry("aws_bedrock".to_string())
        .or_insert_with(|| {
            let default_region = env::var("AWS_REGION")
                .ok()
                .or_else(|| env::var("AWS_DEFAULT_REGION").ok())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| {
                    providers::protocol::aws_bedrock_converse::DEFAULT_REGION.to_string()
                });
            let default_model = env::var("AWS_BEDROCK_MODEL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| "anthropic.claude-3-5-sonnet-20241022-v2:0".to_string());
            NativeProviderProfile {
                id: "aws_bedrock".to_string(),
                label: "AWS Bedrock".to_string(),
                route_id: providers::routes::aws_bedrock::ROUTE_ID.to_string(),
                base_url: env::var("AWS_BEDROCK_BASE_URL").ok().or_else(|| {
                    Some(format!(
                        "https://bedrock-runtime.{}.amazonaws.com",
                        default_region
                    ))
                }),
                default_model: Some(default_model.clone()),
                api_key: env::var("AWS_ACCESS_KEY_ID").ok(),
                api_key_env: Some("AWS_ACCESS_KEY_ID".to_string()),
                auth_header: None,
                embedding_model: Some("lyra-hash-embedding-v1".to_string()),
                models: Vec::new(),
            }
        });
    config
        .providers
        .entry("mimo".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "mimo".to_string(),
            label: "MiMo".to_string(),
            route_id: providers::routes::mimo::PAY_AS_YOU_GO_ROUTE_ID.to_string(),
            base_url: env::var("MIMO_BASE_URL")
                .ok()
                .or_else(|| Some(providers::routes::mimo::PAY_AS_YOU_GO_BASE_URL.to_string())),
            default_model: env::var("MIMO_MODEL")
                .ok()
                .or_else(|| Some("mimo-v2.5-pro".to_string())),
            api_key: env::var("MIMO_API_KEY").ok(),
            api_key_env: Some("MIMO_API_KEY".to_string()),
            auth_header: Some("api-key".to_string()),
            embedding_model: Some("lyra-hash-embedding-v1".to_string()),
            models: Vec::new(),
        });
    config
        .providers
        .entry("mimo-token-plan-cn".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "mimo-token-plan-cn".to_string(),
            label: "MiMo Token Plan (CN)".to_string(),
            route_id: providers::routes::mimo::TOKEN_PLAN_CN_ROUTE_ID.to_string(),
            base_url: env::var("MIMO_TOKEN_PLAN_CN_BASE_URL")
                .ok()
                .or_else(|| Some(providers::routes::mimo::TOKEN_PLAN_CN_BASE_URL.to_string())),
            default_model: env::var("MIMO_TOKEN_PLAN_MODEL")
                .ok()
                .or_else(|| Some("mimo-v2.5-pro".to_string())),
            api_key: env::var("MIMO_TOKEN_PLAN_API_KEY").ok(),
            api_key_env: Some("MIMO_TOKEN_PLAN_API_KEY".to_string()),
            auth_header: Some("api-key".to_string()),
            embedding_model: Some("lyra-hash-embedding-v1".to_string()),
            models: Vec::new(),
        });
    config
        .providers
        .entry("mimo-token-plan-sgp".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "mimo-token-plan-sgp".to_string(),
            label: "MiMo Token Plan (SGP)".to_string(),
            route_id: providers::routes::mimo::TOKEN_PLAN_SGP_ROUTE_ID.to_string(),
            base_url: env::var("MIMO_TOKEN_PLAN_SGP_BASE_URL")
                .ok()
                .or_else(|| Some(providers::routes::mimo::TOKEN_PLAN_SGP_BASE_URL.to_string())),
            default_model: env::var("MIMO_TOKEN_PLAN_MODEL")
                .ok()
                .or_else(|| Some("mimo-v2.5-pro".to_string())),
            api_key: env::var("MIMO_TOKEN_PLAN_API_KEY").ok(),
            api_key_env: Some("MIMO_TOKEN_PLAN_API_KEY".to_string()),
            auth_header: Some("api-key".to_string()),
            embedding_model: Some("lyra-hash-embedding-v1".to_string()),
            models: Vec::new(),
        });
    config
        .providers
        .entry("mimo-token-plan-ams".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "mimo-token-plan-ams".to_string(),
            label: "MiMo Token Plan (AMS)".to_string(),
            route_id: providers::routes::mimo::TOKEN_PLAN_AMS_ROUTE_ID.to_string(),
            base_url: env::var("MIMO_TOKEN_PLAN_AMS_BASE_URL")
                .ok()
                .or_else(|| Some(providers::routes::mimo::TOKEN_PLAN_AMS_BASE_URL.to_string())),
            default_model: env::var("MIMO_TOKEN_PLAN_MODEL")
                .ok()
                .or_else(|| Some("mimo-v2.5-pro".to_string())),
            api_key: env::var("MIMO_TOKEN_PLAN_API_KEY").ok(),
            api_key_env: Some("MIMO_TOKEN_PLAN_API_KEY".to_string()),
            auth_header: Some("api-key".to_string()),
            embedding_model: Some("lyra-hash-embedding-v1".to_string()),
            models: Vec::new(),
        });
    for provider in config.providers.values_mut() {
        if provider.embedding_model.is_none() {
            provider.embedding_model = Some("lyra-hash-embedding-v1".to_string());
        }
    }
}
