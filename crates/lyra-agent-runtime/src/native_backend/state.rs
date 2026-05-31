use super::*;

pub(crate) static STATE: OnceLock<Mutex<NativeRuntimeState>> = OnceLock::new();

pub(crate) fn state() -> &'static Mutex<NativeRuntimeState> {
    STATE.get_or_init(|| Mutex::new(NativeRuntimeState::load()))
}

impl NativeRuntimeState {
    pub(crate) fn load() -> Self {
        let root = runtime_root();
        let sessions_dir = root.join("sessions");
        let _ = fs::create_dir_all(&sessions_dir);

        let state_file = read_json::<NativeStateFile>(&root.join("state.json"));
        let legacy_shared_memory = state_file
            .as_ref()
            .map(|state| state.legacy_shared_memory.clone())
            .unwrap_or_default();
        let _ = ensure_memory_store(&root);
        let migrated_legacy_memory = !legacy_shared_memory.is_empty()
            && migrate_legacy_shared_memory(&root, &legacy_shared_memory).is_ok();
        let mut config = state_file
            .as_ref()
            .map(|state| state.config.clone())
            .unwrap_or_default();
        install_default_providers(&mut config);

        let mut sessions = HashMap::new();
        if let Ok(entries) = fs::read_dir(&sessions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }
                if let Some(session) = read_json::<NativeSession>(&path) {
                    sessions.insert(session.id.clone(), session);
                }
            }
        }

        let loaded = Self {
            root,
            sessions,
            active_session_id: state_file
                .as_ref()
                .and_then(|state| state.active_session_id.clone()),
            config,
            active_skills: state_file
                .as_ref()
                .map(|state| state.active_skills.clone())
                .unwrap_or_default(),
            overnight_runs: state_file
                .as_ref()
                .map(|state| state.overnight_runs.clone())
                .unwrap_or_default(),
            pending_permissions: state_file
                .as_ref()
                .map(|state| state.pending_permissions.clone())
                .unwrap_or_default(),
            pending_clarifications: state_file
                .as_ref()
                .map(|state| state.pending_clarifications.clone())
                .unwrap_or_default(),
            goals: state_file
                .as_ref()
                .map(|state| state.goals.clone())
                .unwrap_or_default(),
            focused_goal_id: state_file
                .as_ref()
                .and_then(|state| state.focused_goal_id.clone()),
            cancelled_turns: HashSet::new(),
            active_cancellations: HashMap::new(),
            event_callback: None,
            host_dispatcher: None,
        };
        if migrated_legacy_memory {
            let _ = loaded.save_state();
        }
        loaded
    }

    pub(crate) fn save_state(&self) -> AgentRuntimeResult<()> {
        fs::create_dir_all(self.root.join("sessions"))
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let state = NativeStateFile {
            active_session_id: self.active_session_id.clone(),
            config: self.config.clone(),
            legacy_shared_memory: Vec::new(),
            active_skills: self.active_skills.clone(),
            overnight_runs: self.overnight_runs.clone(),
            pending_permissions: self.pending_permissions.clone(),
            pending_clarifications: self.pending_clarifications.clone(),
            goals: self.goals.clone(),
            focused_goal_id: self.focused_goal_id.clone(),
        };
        write_json(&self.root.join("state.json"), &state)?;
        for session in self.sessions.values() {
            write_json(&self.session_path(&session.id), session)?;
        }
        Ok(())
    }

    pub(crate) fn session_path(&self, session_id: &str) -> PathBuf {
        self.root
            .join("sessions")
            .join(format!("{session_id}.json"))
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

pub(crate) fn default_true() -> bool {
    true
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
            .or_else(|| Some("gpt-4.1-mini".to_string()));
    }
    let openai_key = env::var("OPENAI_API_KEY").ok();
    config
        .providers
        .entry("openai".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "openai".to_string(),
            label: "OpenAI".to_string(),
            provider_type: "openai-compatible".to_string(),
            base_url: env::var("OPENAI_BASE_URL")
                .ok()
                .or_else(|| Some("https://api.openai.com/v1".to_string())),
            default_model: config.default_model.clone(),
            api_key: openai_key,
            api_key_env: Some("OPENAI_API_KEY".to_string()),
            auth_header: None,
            embedding_model: Some("lyra-hash-embedding-v1".to_string()),
            models: vec![NativeProviderModel {
                id: config
                    .default_model
                    .clone()
                    .unwrap_or_else(|| "gpt-4.1-mini".to_string()),
                label: None,
                context_window: None,
                supports_image_input: true,
                supports_tool_calling: true,
                supports_streaming: true,
            }],
        });
    config
        .providers
        .entry("openrouter".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "openrouter".to_string(),
            label: "OpenRouter".to_string(),
            provider_type: "openrouter".to_string(),
            base_url: env::var("OPENROUTER_BASE_URL")
                .ok()
                .or_else(|| Some("https://openrouter.ai/api/v1".to_string())),
            default_model: env::var("OPENROUTER_MODEL").ok(),
            api_key: env::var("OPENROUTER_API_KEY").ok(),
            api_key_env: Some("OPENROUTER_API_KEY".to_string()),
            auth_header: None,
            embedding_model: Some("lyra-hash-embedding-v1".to_string()),
            models: Vec::new(),
        });
    config
        .providers
        .entry("mimo-token-plan".to_string())
        .or_insert_with(|| NativeProviderProfile {
            id: "mimo-token-plan".to_string(),
            label: "MiMo Token Plan".to_string(),
            provider_type: "openai-compatible".to_string(),
            base_url: env::var("MIMO_BASE_URL").ok(),
            default_model: env::var("MIMO_MODEL")
                .ok()
                .or_else(|| Some("mimo-v2.5-pro".to_string())),
            api_key: env::var("MIMO_API_KEY").ok(),
            api_key_env: Some("MIMO_API_KEY".to_string()),
            auth_header: None,
            embedding_model: Some("lyra-hash-embedding-v1".to_string()),
            models: vec![NativeProviderModel {
                id: "mimo-v2.5-pro".to_string(),
                label: Some("MiMo v2.5 Pro".to_string()),
                context_window: None,
                supports_image_input: true,
                supports_tool_calling: true,
                supports_streaming: true,
            }],
        });
    for provider in config.providers.values_mut() {
        if provider.embedding_model.is_none() {
            provider.embedding_model = Some("lyra-hash-embedding-v1".to_string());
        }
    }
}
