use super::*;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

mod jsonc;

use jsonc::{read_jsonc_value, strip_json_comments_and_trailing_commas};

const PREFERENCES_FILE: &str = "import-preferences.v1.json";
const PROVENANCE_FILE: &str = "import-provenance.v1.json";

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum ImportSourceId {
    Claude,
    Cursor,
    Codex,
    Opencode,
    Zed,
}

impl ImportSourceId {
    fn parse(value: &str) -> AgentRuntimeResult<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "claude" => Ok(Self::Claude),
            "cursor" => Ok(Self::Cursor),
            "codex" => Ok(Self::Codex),
            "opencode" => Ok(Self::Opencode),
            "zed" => Ok(Self::Zed),
            _ => Err(AgentRuntimeError::Core(format!(
                "unsupported import source: {value}"
            ))),
        }
    }

    fn id(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::Cursor => "cursor",
            Self::Codex => "codex",
            Self::Opencode => "opencode",
            Self::Zed => "zed",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Claude => "Claude",
            Self::Cursor => "Cursor",
            Self::Codex => "Codex",
            Self::Opencode => "OpenCode",
            Self::Zed => "Zed",
        }
    }

    fn config_dir(self, home: &Path) -> PathBuf {
        match self {
            Self::Claude => home.join(".claude"),
            Self::Cursor => home.join(".cursor"),
            Self::Codex => env::var_os("CODEX_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".codex")),
            Self::Opencode => env::var_os("OPENCODE_CONFIG_DIR")
                .map(PathBuf::from)
                .or_else(|| {
                    env::var_os("XDG_CONFIG_HOME")
                        .map(PathBuf::from)
                        .map(|root| root.join("opencode"))
                })
                .unwrap_or_else(|| home.join(".config/opencode")),
            Self::Zed => env::var_os("ZED_CONFIG_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config/zed")),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SourcePreference {
    #[serde(default = "default_true")]
    skills: bool,
    #[serde(default = "default_true")]
    mcp: bool,
}

impl Default for SourcePreference {
    fn default() -> Self {
        Self {
            skills: true,
            mcp: true,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportPreferences {
    #[serde(default)]
    project_root: Option<String>,
    #[serde(default)]
    sources: BTreeMap<String, SourcePreference>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceDocument {
    #[serde(default)]
    entries: Vec<ProvenanceEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProvenanceEntry {
    source_id: String,
    kind: String,
    scope: String,
    source_path: String,
    source_item_id: String,
    target_id: String,
    source_fingerprint: String,
    target_fingerprint: String,
    synced_at: String,
}

#[derive(Clone, Debug)]
enum CandidatePayload {
    Skill { root: PathBuf },
    Mcp { config: Value },
}

#[derive(Clone, Debug)]
struct ImportCandidate {
    kind: String,
    scope: String,
    source_path: PathBuf,
    source_item_id: String,
    target_id: String,
    fingerprint: String,
    status: String,
    message: Option<String>,
    enabled: bool,
    payload: CandidatePayload,
}

#[derive(Clone, Debug)]
struct DetectionSnapshot {
    source: ImportSourceId,
    project_root: Option<PathBuf>,
    source_fingerprint: String,
    candidates: Vec<ImportCandidate>,
    diagnostics: Vec<Value>,
}

static DETECTIONS: OnceLock<Mutex<HashMap<String, DetectionSnapshot>>> = OnceLock::new();

fn detection_cache() -> &'static Mutex<HashMap<String, DetectionSnapshot>> {
    DETECTIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn import_root() -> PathBuf {
    runtime_root().join("import-sync")
}

fn preferences_path() -> PathBuf {
    import_root().join(PREFERENCES_FILE)
}

fn provenance_path() -> PathBuf {
    import_root().join(PROVENANCE_FILE)
}

fn read_preferences() -> ImportPreferences {
    read_json(&preferences_path()).unwrap_or_default()
}

fn write_preferences(preferences: &ImportPreferences) -> AgentRuntimeResult<()> {
    fs::create_dir_all(import_root())
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    write_json(&preferences_path(), preferences)
}

fn read_provenance() -> ProvenanceDocument {
    read_json(&provenance_path()).unwrap_or_default()
}

fn write_provenance(provenance: &ProvenanceDocument) -> AgentRuntimeResult<()> {
    fs::create_dir_all(import_root())
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    write_json(&provenance_path(), provenance)
}

fn home_dir() -> AgentRuntimeResult<PathBuf> {
    dirs::home_dir()
        .ok_or_else(|| AgentRuntimeError::Core("home directory is unavailable".to_string()))
}

fn command_exists(command: &str) -> bool {
    let Some(path) = env::var_os("PATH") else {
        return false;
    };
    env::split_paths(&path).any(|root| {
        let candidate = root.join(command);
        candidate.is_file()
            || (cfg!(windows)
                && ["exe", "cmd", "bat"]
                    .iter()
                    .any(|ext| candidate.with_extension(ext).is_file()))
    })
}

fn app_exists(source: ImportSourceId, home: &Path) -> bool {
    let names: &[&str] = match source {
        ImportSourceId::Claude => &["Claude.app"],
        ImportSourceId::Cursor => &["Cursor.app"],
        ImportSourceId::Codex => &["Codex.app"],
        ImportSourceId::Opencode => &["OpenCode.app"],
        ImportSourceId::Zed => &["Zed.app", "Zed Preview.app", "Zed Nightly.app"],
    };
    names.iter().any(|name| {
        Path::new("/Applications").join(name).exists()
            || home.join("Applications").join(name).exists()
    })
}

fn source_present(source: ImportSourceId, home: &Path) -> bool {
    source.config_dir(home).is_dir()
        || command_exists(source.id())
        || app_exists(source, home)
        || (source == ImportSourceId::Claude && home.join(".claude.json").is_file())
        || (source == ImportSourceId::Codex && home.join(".agents/skills").is_dir())
}

pub(crate) fn import_list_sources() -> AgentRuntimeResult<Value> {
    let home = home_dir()?;
    let sources = [
        ImportSourceId::Claude,
        ImportSourceId::Cursor,
        ImportSourceId::Codex,
        ImportSourceId::Opencode,
        ImportSourceId::Zed,
    ]
    .into_iter()
    .filter(|source| source_present(*source, &home))
    .map(|source| {
        json!({
            "id": source.id(),
            "label": source.label(),
            "configPath": source.config_dir(&home),
        })
    })
    .collect::<Vec<_>>();
    Ok(json!({ "sources": sources }))
}

pub(crate) fn import_get_preferences() -> AgentRuntimeResult<Value> {
    let mut preferences = read_preferences();
    if preferences.project_root.is_none() {
        preferences.project_root = recent_project_root();
    }
    for source in [
        ImportSourceId::Claude,
        ImportSourceId::Cursor,
        ImportSourceId::Codex,
        ImportSourceId::Opencode,
        ImportSourceId::Zed,
    ] {
        preferences
            .sources
            .entry(source.id().to_string())
            .or_default();
    }
    serde_json::to_value(preferences).map_err(|error| AgentRuntimeError::Core(error.to_string()))
}

fn recent_project_root() -> Option<String> {
    let runtime = state().lock().ok()?;
    let valid_root = |session: &NativeSession| {
        let project_bound = session
            .snapshot
            .get("projectBound")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let working_dir = session.snapshot.get("workingDir").and_then(Value::as_str)?;
        (project_bound && Path::new(working_dir).is_dir()).then(|| working_dir.to_string())
    };
    if let Some(root) = runtime
        .active_session_id
        .as_ref()
        .and_then(|id| runtime.sessions.get(id))
        .and_then(valid_root)
    {
        return Some(root);
    }
    runtime
        .sessions
        .values()
        .filter_map(|session| {
            let root = valid_root(session)?;
            let updated = session
                .snapshot
                .get("updatedAt")
                .and_then(Value::as_str)
                .unwrap_or(&session.created_at);
            Some((updated.to_string(), root))
        })
        .max_by(|left, right| left.0.cmp(&right.0))
        .map(|(_, root)| root)
}

pub(crate) fn import_set_preferences(payload: Value) -> AgentRuntimeResult<Value> {
    let mut preferences = read_preferences();
    if let Some(project_root) = payload.get("projectRoot") {
        preferences.project_root = project_root
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
    }
    if let Some(source_id) = string_opt(&payload, "sourceId") {
        let source = ImportSourceId::parse(&source_id)?;
        let entry = preferences
            .sources
            .entry(source.id().to_string())
            .or_default();
        if let Some(skills) = payload.get("skills").and_then(Value::as_bool) {
            entry.skills = skills;
        }
        if let Some(mcp) = payload.get("mcp").and_then(Value::as_bool) {
            entry.mcp = mcp;
        }
    }
    write_preferences(&preferences)?;
    if let Ok(mut cache) = detection_cache().lock() {
        cache.clear();
    }
    import_get_preferences()
}

fn canonical_project_root(
    payload: &Value,
    preferences: &ImportPreferences,
) -> AgentRuntimeResult<Option<PathBuf>> {
    let raw = string_opt(payload, "projectRoot").or_else(|| preferences.project_root.clone());
    let Some(raw) = raw.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };
    let path = fs::canonicalize(raw)
        .map_err(|error| AgentRuntimeError::Core(format!("invalid project root: {error}")))?;
    if !path.is_dir() {
        return Err(AgentRuntimeError::Core(
            "project root must be a directory".to_string(),
        ));
    }
    Ok(Some(path))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn hash_value(value: &Value) -> String {
    sha256_bytes(&serde_json::to_vec(value).unwrap_or_default())
}

fn skill_id(root: &Path) -> AgentRuntimeResult<String> {
    Ok(skill_catalog::parse_skill_package(root)?.id)
}

fn append_skill_candidate(candidates: &mut Vec<ImportCandidate>, scope: &str, path: PathBuf) {
    if !path.is_dir()
        || path.file_name().is_some_and(|name| name == ".system")
        || !path.join("SKILL.md").is_file()
    {
        return;
    }
    let result = skill_id(&path).and_then(|id| {
        skill_catalog::skill_package_fingerprint(&path).map(|fingerprint| (id, fingerprint))
    });
    if let Ok((id, fingerprint)) = result {
        candidates.push(ImportCandidate {
            kind: "skill".to_string(),
            scope: scope.to_string(),
            source_path: path.clone(),
            source_item_id: id.clone(),
            target_id: id,
            fingerprint,
            status: "pending".to_string(),
            message: None,
            enabled: true,
            payload: CandidatePayload::Skill { root: path },
        });
    }
}

fn append_skill_candidates(
    candidates: &mut Vec<ImportCandidate>,
    scope: &str,
    roots: impl IntoIterator<Item = PathBuf>,
) {
    for skills_root in roots.into_iter().filter(|path| path.is_dir()) {
        let Ok(entries) = fs::read_dir(&skills_root) else {
            continue;
        };
        for entry in entries.flatten() {
            append_skill_candidate(candidates, scope, entry.path());
        }
    }
}

fn append_skill_candidates_recursive(
    candidates: &mut Vec<ImportCandidate>,
    scope: &str,
    roots: impl IntoIterator<Item = PathBuf>,
) {
    let mut pending = roots
        .into_iter()
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    while let Some(root) = pending.pop() {
        if root.join("SKILL.md").is_file() {
            append_skill_candidate(candidates, scope, root);
            continue;
        }
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        pending.extend(entries.flatten().filter_map(|entry| {
            let path = entry.path();
            entry
                .file_type()
                .ok()
                .filter(|kind| kind.is_dir() && !kind.is_symlink())
                .map(|_| path)
        }));
    }
}

fn env_flag(name: &str) -> bool {
    env::var(name).ok().is_some_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

fn read_json_value(path: &Path) -> Result<Value, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn append_json_mcp_servers(target: &mut BTreeMap<String, Value>, value: &Value) {
    if let Some(servers) = value.get("mcpServers").and_then(Value::as_object) {
        for (name, config) in servers {
            target.insert(name.clone(), config.clone());
        }
    }
}

fn claude_mcp(
    scope_root: &Path,
    home: &Path,
    diagnostics: &mut Vec<Value>,
) -> BTreeMap<String, Value> {
    let mut servers = BTreeMap::new();
    for path in [
        scope_root.join(".mcp.json"),
        scope_root.join(".claude.json"),
    ] {
        if !path.is_file() {
            continue;
        }
        match read_json_value(&path) {
            Ok(value) => {
                append_json_mcp_servers(&mut servers, &value);
                if let Some(projects) = value.get("projects").and_then(Value::as_object) {
                    for (project, config) in projects {
                        if fs::canonicalize(project).ok().as_ref()
                            == fs::canonicalize(scope_root).ok().as_ref()
                        {
                            append_json_mcp_servers(&mut servers, config);
                        }
                    }
                }
            }
            Err(message) => diagnostics.push(json!({ "path": path, "message": message })),
        }
    }
    let home_config = home.join(".claude.json");
    if home_config.is_file() && scope_root != home {
        match read_json_value(&home_config) {
            Ok(value) => {
                if let Some(projects) = value.get("projects").and_then(Value::as_object) {
                    for (project, config) in projects {
                        if fs::canonicalize(project).ok().as_ref()
                            == fs::canonicalize(scope_root).ok().as_ref()
                        {
                            append_json_mcp_servers(&mut servers, config);
                        }
                    }
                }
            }
            Err(message) => diagnostics.push(json!({ "path": home_config, "message": message })),
        }
    }
    apply_claude_mcp_settings(scope_root, home, &mut servers, diagnostics);
    servers
}

fn apply_claude_mcp_settings(
    scope_root: &Path,
    home: &Path,
    servers: &mut BTreeMap<String, Value>,
    diagnostics: &mut Vec<Value>,
) {
    let settings_root = if scope_root == home {
        home.join(".claude")
    } else {
        scope_root.join(".claude")
    };
    let mut enabled = Vec::<String>::new();
    let mut disabled = HashSet::<String>::new();
    for path in [
        settings_root.join("settings.json"),
        settings_root.join("settings.local.json"),
    ] {
        if !path.is_file() {
            continue;
        }
        match read_json_value(&path) {
            Ok(value) => {
                if let Some(names) = value.get("enabledMcpjsonServers").and_then(Value::as_array) {
                    enabled = names
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect();
                }
                if let Some(names) = value
                    .get("disabledMcpjsonServers")
                    .and_then(Value::as_array)
                {
                    disabled.extend(names.iter().filter_map(Value::as_str).map(str::to_string));
                }
            }
            Err(message) => diagnostics.push(json!({ "path": path, "message": message })),
        }
    }
    for (name, config) in servers {
        let list_disabled = (!enabled.is_empty() && !enabled.iter().any(|item| item == name))
            || disabled.contains(name);
        if list_disabled {
            if let Some(object) = config.as_object_mut() {
                object.insert("enabled".to_string(), Value::Bool(false));
            }
        }
    }
}

fn cursor_mcp(config_dir: &Path, diagnostics: &mut Vec<Value>) -> BTreeMap<String, Value> {
    let path = config_dir.join("mcp.json");
    if !path.is_file() {
        return BTreeMap::new();
    }
    match read_json_value(&path) {
        Ok(value) => {
            let mut servers = BTreeMap::new();
            append_json_mcp_servers(&mut servers, &value);
            servers
        }
        Err(message) => {
            diagnostics.push(json!({ "path": path, "message": message }));
            BTreeMap::new()
        }
    }
}

fn toml_to_json(value: &toml::Value) -> Value {
    serde_json::to_value(value).unwrap_or(Value::Null)
}

fn codex_mcp(config_file: &Path, diagnostics: &mut Vec<Value>) -> BTreeMap<String, Value> {
    if !config_file.is_file() {
        return BTreeMap::new();
    }
    let raw = match fs::read_to_string(config_file) {
        Ok(raw) => raw,
        Err(error) => {
            diagnostics.push(json!({ "path": config_file, "message": error.to_string() }));
            return BTreeMap::new();
        }
    };
    let parsed = match raw.parse::<toml::Value>() {
        Ok(value) => value,
        Err(error) => {
            diagnostics.push(json!({ "path": config_file, "message": error.to_string() }));
            return BTreeMap::new();
        }
    };
    parsed
        .get("mcp_servers")
        .and_then(toml::Value::as_table)
        .map(|servers| {
            servers
                .iter()
                .map(|(name, config)| (name.clone(), toml_to_json(config)))
                .collect()
        })
        .unwrap_or_default()
}

fn merge_jsonc_mcp_files(
    paths: impl IntoIterator<Item = PathBuf>,
    key: &str,
    diagnostics: &mut Vec<Value>,
) -> BTreeMap<String, Value> {
    let mut servers = BTreeMap::new();
    for path in paths {
        if !path.is_file() {
            continue;
        }
        match read_jsonc_value(&path) {
            Ok(value) => {
                if let Some(entries) = value.get(key).and_then(Value::as_object) {
                    servers.extend(
                        entries
                            .iter()
                            .map(|(name, config)| (name.clone(), config.clone())),
                    );
                }
            }
            Err(message) => diagnostics.push(json!({ "path": path, "message": message })),
        }
    }
    servers
}

fn opencode_config_files(root: &Path, project: bool) -> Vec<PathBuf> {
    if project {
        vec![root.join("opencode.json"), root.join("opencode.jsonc")]
    } else {
        vec![
            root.join("config.json"),
            root.join("opencode.json"),
            root.join("opencode.jsonc"),
        ]
    }
}

fn opencode_skill_paths(
    files: impl IntoIterator<Item = PathBuf>,
    base: &Path,
    home: &Path,
    diagnostics: &mut Vec<Value>,
) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for file in files {
        if !file.is_file() {
            continue;
        }
        let value = match read_jsonc_value(&file) {
            Ok(value) => value,
            Err(message) => {
                diagnostics.push(json!({ "path": file, "message": message }));
                continue;
            }
        };
        let Some(configured) = value
            .get("skills")
            .and_then(|value| value.get("paths"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        paths.extend(configured.iter().filter_map(Value::as_str).map(|raw| {
            if let Some(relative) = raw.strip_prefix("~/") {
                home.join(relative)
            } else {
                let path = PathBuf::from(raw);
                if path.is_absolute() {
                    path
                } else {
                    base.join(path)
                }
            }
        }));
    }
    paths
}

fn zed_mcp(
    config_files: impl IntoIterator<Item = PathBuf>,
    diagnostics: &mut Vec<Value>,
) -> BTreeMap<String, Value> {
    merge_jsonc_mcp_files(config_files, "context_servers", diagnostics)
        .into_iter()
        .map(|(name, mut config)| {
            if let Some(object) = config.as_object_mut() {
                if let Some(timeout) = object.remove("timeout") {
                    object.insert("tool_timeout_sec".to_string(), timeout);
                }
                if object.contains_key("settings") && !object.contains_key("command") {
                    object.insert(
                        "execution_environment".to_string(),
                        Value::String("zed-extension".to_string()),
                    );
                }
            }
            (name, config)
        })
        .collect()
}

fn normalize_mcp(name: &str, config: Value) -> Result<(Value, bool), String> {
    let object = config
        .as_object()
        .ok_or_else(|| "MCP config must be an object".to_string())?;
    if object
        .get("oauth")
        .is_some_and(|value| !value.is_null() && value != &Value::Bool(false))
        || object.get("execution_environment").is_some()
        || object.get("approval_policy").is_some()
        || object
            .get("remote")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        return Err("unsupported OAuth, execution environment, or approval policy".to_string());
    }
    let enabled = !object
        .get("disabled")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        && object
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(true);
    let mut normalized = serde_json::Map::new();
    normalized.insert("id".to_string(), Value::String(name.to_string()));
    normalized.insert("name".to_string(), Value::String(name.to_string()));
    normalized.insert("enabled".to_string(), Value::Bool(enabled));
    let command_and_args = object
        .get("command")
        .and_then(Value::as_str)
        .map(|command| (command.to_string(), object.get("args").cloned()))
        .or_else(|| {
            let command = object.get("command")?.as_array()?;
            let executable = command.first()?.as_str()?.to_string();
            let args = Value::Array(command.iter().skip(1).cloned().collect());
            Some((executable, Some(args)))
        });
    if let Some((command, args)) = command_and_args {
        normalized.insert("command".to_string(), Value::String(command.to_string()));
        if let Some(args) = args {
            normalized.insert("args".to_string(), args);
        }
        if let Some(environment) = object.get("environment").or_else(|| object.get("env")) {
            normalized.insert("env".to_string(), environment.clone());
        }
        for key in ["env_vars", "cwd", "startup_timeout_sec", "tool_timeout_sec"] {
            if let Some(value) = object.get(key) {
                normalized.insert(key.to_string(), value.clone());
            }
        }
    } else if let Some(url) = object.get("url").and_then(Value::as_str) {
        normalized.insert("url".to_string(), Value::String(url.to_string()));
        let transport = object.get("type").and_then(Value::as_str).unwrap_or("http");
        normalized.insert(
            "transport".to_string(),
            Value::String(if transport == "sse" { "sse" } else { "http" }.to_string()),
        );
        for key in [
            "headers",
            "http_headers",
            "env_http_headers",
            "bearer_token_env_var",
            "startup_timeout_sec",
            "tool_timeout_sec",
        ] {
            if let Some(value) = object.get(key) {
                normalized.insert(key.to_string(), value.clone());
            }
        }
    } else {
        return Err("MCP config needs command or url".to_string());
    }
    if let Some(timeout) = object.get("timeout").and_then(Value::as_u64) {
        normalized.insert("toolTimeoutMs".to_string(), Value::Number(timeout.into()));
    }
    Ok((Value::Object(normalized), enabled))
}

fn append_mcp_candidates(
    candidates: &mut Vec<ImportCandidate>,
    diagnostics: &mut Vec<Value>,
    scope: &str,
    source_path: &Path,
    servers: BTreeMap<String, Value>,
) {
    for (name, config) in servers {
        match normalize_mcp(&name, config) {
            Ok((config, enabled)) => candidates.push(ImportCandidate {
                kind: "mcp".to_string(),
                scope: scope.to_string(),
                source_path: source_path.to_path_buf(),
                source_item_id: name.clone(),
                target_id: slug_mcp_id(&name),
                fingerprint: source_mcp_fingerprint(&config),
                status: "pending".to_string(),
                message: None,
                enabled,
                payload: CandidatePayload::Mcp { config },
            }),
            Err(message) => {
                diagnostics.push(json!({ "path": source_path, "itemId": name, "message": message }))
            }
        }
    }
}

fn insert_nonempty(
    normalized: &mut serde_json::Map<String, Value>,
    key: &str,
    value: Option<Value>,
) {
    let Some(value) = value else { return };
    let nonempty = match &value {
        Value::Null => false,
        Value::Array(values) => !values.is_empty(),
        Value::Object(values) => !values.is_empty(),
        Value::String(value) => !value.is_empty(),
        _ => true,
    };
    if nonempty {
        normalized.insert(key.to_string(), value);
    }
}

fn source_mcp_fingerprint(config: &Value) -> String {
    let mut normalized = serde_json::Map::new();
    for key in ["id", "name", "enabled"] {
        insert_nonempty(&mut normalized, key, config.get(key).cloned());
    }
    if config.get("command").is_some() {
        for (canonical, aliases) in [
            ("command", &["command"][..]),
            ("args", &["args"][..]),
            ("env", &["env"][..]),
            ("envVars", &["envVars", "env_vars"][..]),
            ("cwd", &["cwd"][..]),
        ] {
            insert_nonempty(
                &mut normalized,
                canonical,
                aliases.iter().find_map(|key| config.get(*key).cloned()),
            );
        }
    } else {
        insert_nonempty(
            &mut normalized,
            "transport",
            config.get("transport").cloned(),
        );
        for (canonical, aliases) in [
            ("url", &["url"][..]),
            ("headers", &["headers", "http_headers"][..]),
            (
                "envHttpHeaders",
                &["envHttpHeaders", "env_http_headers"][..],
            ),
            (
                "bearerTokenEnvVar",
                &["bearerTokenEnvVar", "bearer_token_env_var"][..],
            ),
        ] {
            insert_nonempty(
                &mut normalized,
                canonical,
                aliases.iter().find_map(|key| config.get(*key).cloned()),
            );
        }
    }
    for (milliseconds, seconds) in [
        ("startupTimeoutMs", "startup_timeout_sec"),
        ("toolTimeoutMs", "tool_timeout_sec"),
    ] {
        let value = config.get(milliseconds).cloned().or_else(|| {
            config
                .get(seconds)
                .and_then(Value::as_u64)
                .map(|value| json!(value * 1_000))
        });
        insert_nonempty(&mut normalized, milliseconds, value);
    }
    hash_value(&Value::Object(normalized))
}

fn slug_mcp_id(value: &str) -> String {
    let slug = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(96)
        .collect::<String>();
    if slug.is_empty() {
        "mcp-server".to_string()
    } else {
        slug
    }
}

fn target_storage_root(
    kind: &str,
    scope: &str,
    project_root: Option<&Path>,
) -> AgentRuntimeResult<PathBuf> {
    if scope == "project" {
        let root = project_root
            .ok_or_else(|| AgentRuntimeError::Core("project root is required".to_string()))?;
        return Ok(root
            .join(".lyra/agent")
            .join(if kind == "skill" { "skills" } else { "mcp" }));
    }
    Ok(if kind == "skill" {
        skill_storage_root()
    } else {
        mcp_storage_root()
    })
}

fn current_target_fingerprint(
    candidate: &ImportCandidate,
    project_root: Option<&Path>,
) -> Option<String> {
    let storage = target_storage_root(&candidate.kind, &candidate.scope, project_root).ok()?;
    if candidate.kind == "skill" {
        let registry: Value = read_json(&storage.join("registry.v1.json"))?;
        let package = registry
            .get("installed")?
            .as_array()?
            .iter()
            .find(|item| {
                item.get("id").and_then(Value::as_str) == Some(candidate.target_id.as_str())
            })?
            .get("packagePath")?
            .as_str()?;
        return skill_catalog::skill_package_fingerprint(Path::new(package)).ok();
    }
    let registry: Value = read_json(&storage.join("registry.v1.json"))?;
    let server = registry.get("servers")?.as_array()?.iter().find(|item| {
        item.get("id").and_then(Value::as_str) == Some(candidate.target_id.as_str())
    })?;
    Some(stored_mcp_fingerprint(server))
}

fn stored_mcp_fingerprint(server: &Value) -> String {
    let transport = server.get("transport").cloned().unwrap_or(Value::Null);
    let mut normalized = serde_json::Map::new();
    normalized.insert(
        "id".to_string(),
        server.get("id").cloned().unwrap_or(Value::Null),
    );
    normalized.insert(
        "name".to_string(),
        server.get("name").cloned().unwrap_or(Value::Null),
    );
    normalized.insert(
        "enabled".to_string(),
        server.get("enabled").cloned().unwrap_or(Value::Bool(true)),
    );
    if let Some(object) = transport.as_object() {
        match object.get("kind").and_then(Value::as_str) {
            Some("stdio") => {
                for key in ["command", "args", "env", "secretEnv", "envVars", "cwd"] {
                    insert_nonempty(&mut normalized, key, object.get(key).cloned());
                }
            }
            Some(kind @ ("http" | "sse")) => {
                normalized.insert("transport".to_string(), Value::String(kind.to_string()));
                for key in [
                    "url",
                    "headers",
                    "secretHeaders",
                    "envHttpHeaders",
                    "bearerTokenEnvVar",
                ] {
                    insert_nonempty(&mut normalized, key, object.get(key).cloned());
                }
            }
            _ => {}
        }
    }
    for key in ["startupTimeoutMs", "toolTimeoutMs"] {
        insert_nonempty(&mut normalized, key, server.get(key).cloned());
    }
    hash_value(&Value::Object(normalized))
}

fn apply_statuses(
    source: ImportSourceId,
    project_root: Option<&Path>,
    candidates: &mut [ImportCandidate],
) {
    let provenance = read_provenance();
    for candidate in candidates {
        let target_fingerprint = current_target_fingerprint(candidate, project_root);
        let record = provenance.entries.iter().find(|entry| {
            entry.source_id == source.id()
                && entry.kind == candidate.kind
                && entry.scope == candidate.scope
                && entry.source_item_id == candidate.source_item_id
        });
        let identical_owner = provenance.entries.iter().any(|entry| {
            entry.kind == candidate.kind
                && entry.scope == candidate.scope
                && entry.target_id == candidate.target_id
                && entry.source_fingerprint == candidate.fingerprint
        });
        candidate.status = match (record, target_fingerprint) {
            (None, None) => "pending",
            (None, Some(_)) if identical_owner => "synced",
            (None, Some(target)) if target == candidate.fingerprint => "synced",
            (None, Some(_)) => "conflict",
            (Some(_), None) => "pending",
            (Some(record), Some(target)) if target != record.target_fingerprint => "conflict",
            (Some(record), Some(_)) if record.source_fingerprint == candidate.fingerprint => {
                "synced"
            }
            (Some(_), Some(_)) => "update",
        }
        .to_string();
    }
}

fn scan_source(
    source: ImportSourceId,
    project_root: Option<PathBuf>,
    preference: SourcePreference,
) -> AgentRuntimeResult<DetectionSnapshot> {
    let home = home_dir()?;
    let config_dir = source.config_dir(&home);
    let mut candidates = Vec::new();
    let mut diagnostics = Vec::new();
    if preference.skills {
        match source {
            ImportSourceId::Claude => {
                append_skill_candidates(&mut candidates, "user", [config_dir.join("skills")])
            }
            ImportSourceId::Cursor => append_skill_candidates(
                &mut candidates,
                "user",
                [config_dir.join("skills"), config_dir.join("skills-cursor")],
            ),
            ImportSourceId::Codex => append_skill_candidates(
                &mut candidates,
                "user",
                [config_dir.join("skills"), home.join(".agents/skills")],
            ),
            ImportSourceId::Opencode => {
                let files = opencode_config_files(&config_dir, false);
                let mut roots = vec![config_dir.join("skill"), config_dir.join("skills")];
                if !env_flag("OPENCODE_DISABLE_EXTERNAL_SKILLS") {
                    roots.push(home.join(".agents/skills"));
                    if !env_flag("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS") {
                        roots.push(home.join(".claude/skills"));
                    }
                }
                roots.extend(opencode_skill_paths(
                    files,
                    &config_dir,
                    &home,
                    &mut diagnostics,
                ));
                append_skill_candidates_recursive(&mut candidates, "user", roots);
            }
            ImportSourceId::Zed => {
                append_skill_candidates(&mut candidates, "user", [home.join(".agents/skills")])
            }
        }
        if let Some(project) = project_root.as_ref() {
            let roots = match source {
                ImportSourceId::Claude => vec![project.join(".claude/skills")],
                ImportSourceId::Cursor => vec![project.join(".cursor/skills")],
                ImportSourceId::Codex => vec![project.join(".agents/skills")],
                ImportSourceId::Opencode => {
                    let mut files = opencode_config_files(project, true);
                    files.extend(opencode_config_files(&project.join(".opencode"), true));
                    let mut roots = vec![
                        project.join(".opencode/skill"),
                        project.join(".opencode/skills"),
                    ];
                    if !env_flag("OPENCODE_DISABLE_EXTERNAL_SKILLS") {
                        roots.push(project.join(".agents/skills"));
                        if !env_flag("OPENCODE_DISABLE_CLAUDE_CODE_SKILLS") {
                            roots.push(project.join(".claude/skills"));
                        }
                    }
                    roots.extend(opencode_skill_paths(
                        files,
                        project,
                        &home,
                        &mut diagnostics,
                    ));
                    roots
                }
                ImportSourceId::Zed => vec![project.join(".agents/skills")],
            };
            if source == ImportSourceId::Opencode {
                append_skill_candidates_recursive(&mut candidates, "project", roots);
            } else {
                append_skill_candidates(&mut candidates, "project", roots);
            }
        }
    }
    if preference.mcp {
        match source {
            ImportSourceId::Claude => {
                let servers = claude_mcp(&home, &home, &mut diagnostics);
                append_mcp_candidates(&mut candidates, &mut diagnostics, "user", &home, servers);
            }
            ImportSourceId::Cursor => {
                let servers = cursor_mcp(&config_dir, &mut diagnostics);
                append_mcp_candidates(
                    &mut candidates,
                    &mut diagnostics,
                    "user",
                    &config_dir.join("mcp.json"),
                    servers,
                );
            }
            ImportSourceId::Codex => {
                let path = config_dir.join("config.toml");
                let servers = codex_mcp(&path, &mut diagnostics);
                append_mcp_candidates(&mut candidates, &mut diagnostics, "user", &path, servers);
            }
            ImportSourceId::Opencode => {
                let files = opencode_config_files(&config_dir, false);
                let servers = merge_jsonc_mcp_files(files.clone(), "mcp", &mut diagnostics);
                append_mcp_candidates(
                    &mut candidates,
                    &mut diagnostics,
                    "user",
                    &config_dir,
                    servers,
                );
            }
            ImportSourceId::Zed => {
                let path = config_dir.join("settings.json");
                let servers = zed_mcp(
                    [config_dir.join("global_settings.json"), path.clone()],
                    &mut diagnostics,
                );
                append_mcp_candidates(&mut candidates, &mut diagnostics, "user", &path, servers);
            }
        }
        if let Some(project) = project_root.as_ref() {
            match source {
                ImportSourceId::Claude => {
                    let servers = claude_mcp(project, &home, &mut diagnostics);
                    append_mcp_candidates(
                        &mut candidates,
                        &mut diagnostics,
                        "project",
                        project,
                        servers,
                    );
                }
                ImportSourceId::Cursor => {
                    let config = project.join(".cursor");
                    let path = config.join("mcp.json");
                    let servers = cursor_mcp(&config, &mut diagnostics);
                    append_mcp_candidates(
                        &mut candidates,
                        &mut diagnostics,
                        "project",
                        &path,
                        servers,
                    );
                }
                ImportSourceId::Codex => {
                    let path = project.join(".codex/config.toml");
                    let servers = codex_mcp(&path, &mut diagnostics);
                    append_mcp_candidates(
                        &mut candidates,
                        &mut diagnostics,
                        "project",
                        &path,
                        servers,
                    );
                }
                ImportSourceId::Opencode => {
                    let mut files = opencode_config_files(project, true);
                    files.extend(opencode_config_files(&project.join(".opencode"), true));
                    let servers = merge_jsonc_mcp_files(files, "mcp", &mut diagnostics);
                    append_mcp_candidates(
                        &mut candidates,
                        &mut diagnostics,
                        "project",
                        project,
                        servers,
                    );
                }
                ImportSourceId::Zed => {
                    let path = project.join(".zed/settings.json");
                    let servers = zed_mcp([path.clone()], &mut diagnostics);
                    append_mcp_candidates(
                        &mut candidates,
                        &mut diagnostics,
                        "project",
                        &path,
                        servers,
                    );
                }
            }
        }
    }
    candidates.sort_by(|left, right| {
        (&left.scope, &left.kind, &left.target_id).cmp(&(
            &right.scope,
            &right.kind,
            &right.target_id,
        ))
    });
    candidates.dedup_by(|left, right| {
        left.scope == right.scope && left.kind == right.kind && left.target_id == right.target_id
    });
    apply_statuses(source, project_root.as_deref(), &mut candidates);
    let fingerprint_value = Value::Array(
        candidates
            .iter()
            .map(|item| json!([item.scope, item.kind, item.source_item_id, item.fingerprint]))
            .collect(),
    );
    Ok(DetectionSnapshot {
        source,
        project_root,
        source_fingerprint: hash_value(&fingerprint_value),
        candidates,
        diagnostics,
    })
}

fn candidate_value(candidate: &ImportCandidate) -> Value {
    json!({
        "kind": candidate.kind, "scope": candidate.scope, "sourcePath": candidate.source_path,
        "sourceItemId": candidate.source_item_id, "targetId": candidate.target_id,
        "status": candidate.status, "message": candidate.message, "enabled": candidate.enabled
    })
}

fn detection_value(id: &str, snapshot: &DetectionSnapshot) -> Value {
    let mut counts = BTreeMap::<String, usize>::new();
    for candidate in &snapshot.candidates {
        *counts.entry(candidate.status.clone()).or_default() += 1;
    }
    json!({
        "detectionId": id, "sourceId": snapshot.source.id(), "projectRoot": snapshot.project_root,
        "counts": counts, "candidates": snapshot.candidates.iter().map(candidate_value).collect::<Vec<_>>(),
        "diagnostics": snapshot.diagnostics
    })
}

pub(crate) fn import_detect(payload: Value) -> AgentRuntimeResult<Value> {
    let source = ImportSourceId::parse(
        &string_opt(&payload, "sourceId")
            .ok_or_else(|| AgentRuntimeError::Core("sourceId is required".to_string()))?,
    )?;
    let preferences = read_preferences();
    let project_root = canonical_project_root(&payload, &preferences)?;
    let preference = preferences
        .sources
        .get(source.id())
        .cloned()
        .unwrap_or_default();
    let snapshot = scan_source(source, project_root, preference)?;
    let id = Uuid::new_v4().to_string();
    let value = detection_value(&id, &snapshot);
    detection_cache()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("import detection cache unavailable".to_string()))?
        .insert(id, snapshot);
    Ok(value)
}

fn sync_candidate(
    candidate: &ImportCandidate,
    project_root: Option<&Path>,
) -> AgentRuntimeResult<(Value, Option<String>)> {
    let storage = target_storage_root(&candidate.kind, &candidate.scope, project_root)?;
    match &candidate.payload {
        CandidatePayload::Skill { root } => {
            skill_catalog::install_imported_skill_at(&storage, root).and_then(|value| {
                if candidate.scope == "user" {
                    let mut runtime = state().lock().map_err(|_| {
                        AgentRuntimeError::Core("agent runtime state lock failed".to_string())
                    })?;
                    runtime.active_skills.insert(candidate.target_id.clone());
                    runtime.save_state()?;
                }
                Ok((value, None))
            })
        }
        CandidatePayload::Mcp { config } => {
            let secured = secure_imported_mcp_config(config, candidate)?;
            let upserted = mcp_catalog::upsert_mcp_servers_at(&storage, secured)?;
            if candidate.enabled {
                let connected = mcp_catalog::mcp_server_connect_at(
                    &storage,
                    json!({ "serverId": candidate.target_id }),
                );
                let connected = connected?;
                let failure = connected
                    .get("servers")
                    .and_then(Value::as_array)
                    .and_then(|servers| servers.first())
                    .filter(|server| server.get("state").and_then(Value::as_str) == Some("failed"))
                    .and_then(|server| server.get("lastError").and_then(Value::as_str))
                    .map(str::to_string);
                return Ok((upserted, failure));
            }
            Ok((upserted, None))
        }
    }
}

fn secret_env_name(value: &str) -> Option<String> {
    let braced = value
        .strip_prefix("${")
        .and_then(|value| value.strip_suffix('}'))
        .or_else(|| {
            value
                .strip_prefix("{env:")
                .and_then(|value| value.strip_suffix('}'))
        });
    braced
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn store_mcp_secret(
    candidate: &ImportCandidate,
    field: &str,
    value: &str,
) -> AgentRuntimeResult<Value> {
    let dispatcher = host_dispatcher().ok_or_else(|| {
        AgentRuntimeError::Core(
            "secure storage is unavailable; MCP secret was not imported".to_string(),
        )
    })?;
    let payload = json!({
        "owner": "mcp-server",
        "valueKind": "credential",
        "label": format!("{} {}", candidate.target_id, field),
        "description": format!("Imported from {}", candidate.source_path.display()),
        "value": value,
        "capabilities": ["list_metadata", "use"],
        "timeoutMs": 30_000,
    });
    let stored = tools::invoke_host_capability_with_timeout(
        dispatcher,
        "sensitiveValues.storeForAgentUse".to_string(),
        payload,
        30_000,
    )
    .map_err(AgentRuntimeError::HostCapability)?;
    stored
        .get("ref")
        .filter(|value| value.is_object())
        .cloned()
        .ok_or_else(|| {
            AgentRuntimeError::Core(
                "secure storage did not return an MCP secret reference".to_string(),
            )
        })
}

fn secure_imported_mcp_config(
    config: &Value,
    candidate: &ImportCandidate,
) -> AgentRuntimeResult<Value> {
    let mut secured = config.clone();
    let object = secured
        .as_object_mut()
        .ok_or_else(|| AgentRuntimeError::Core("MCP config must be an object".to_string()))?;

    if let Some(env) = object
        .remove("env")
        .and_then(|value| value.as_object().cloned())
    {
        let mut inherited = object
            .remove("env_vars")
            .and_then(|value| value.as_array().cloned())
            .unwrap_or_default();
        let mut secret_env = serde_json::Map::new();
        for (name, value) in env {
            let text = value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            if let Some(variable) = secret_env_name(&text) {
                if variable == name {
                    inherited.push(Value::String(name));
                } else {
                    let resolved = env::var(&variable).map_err(|_| {
                        AgentRuntimeError::Core(format!(
                            "environment variable {variable} referenced by MCP field {name} is unavailable"
                        ))
                    })?;
                    secret_env.insert(
                        name.clone(),
                        store_mcp_secret(candidate, &format!("env {name}"), &resolved)?,
                    );
                }
            } else {
                secret_env.insert(
                    name.clone(),
                    store_mcp_secret(candidate, &format!("env {name}"), &text)?,
                );
            }
        }
        inherited.sort_by(|left, right| left.as_str().cmp(&right.as_str()));
        inherited.dedup();
        if !inherited.is_empty() {
            object.insert("env_vars".to_string(), Value::Array(inherited));
        }
        if !secret_env.is_empty() {
            object.insert("secret_env".to_string(), Value::Object(secret_env));
        }
    }

    let header_value = object
        .remove("headers")
        .or_else(|| object.remove("http_headers"));
    if let Some(headers) = header_value.and_then(|value| value.as_object().cloned()) {
        let mut env_headers = object
            .remove("env_http_headers")
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        let mut secret_headers = serde_json::Map::new();
        for (name, value) in headers {
            let text = value
                .as_str()
                .map(str::to_string)
                .unwrap_or_else(|| value.to_string());
            if name.eq_ignore_ascii_case("authorization") {
                if let Some(variable) = text.strip_prefix("Bearer ").and_then(secret_env_name) {
                    object.insert("bearer_token_env_var".to_string(), Value::String(variable));
                    continue;
                }
            }
            if let Some(variable) = secret_env_name(&text) {
                env_headers.insert(name, Value::String(variable));
            } else {
                secret_headers.insert(
                    name.clone(),
                    store_mcp_secret(candidate, &format!("header {name}"), &text)?,
                );
            }
        }
        if !env_headers.is_empty() {
            object.insert("env_http_headers".to_string(), Value::Object(env_headers));
        }
        if !secret_headers.is_empty() {
            object.insert("secret_headers".to_string(), Value::Object(secret_headers));
        }
    }
    Ok(secured)
}

pub(crate) fn import_sync(payload: Value) -> AgentRuntimeResult<Value> {
    let detection_id = string_opt(&payload, "detectionId")
        .ok_or_else(|| AgentRuntimeError::Core("detectionId is required".to_string()))?;
    let snapshot = detection_cache()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("import detection cache unavailable".to_string()))?
        .get(&detection_id)
        .cloned()
        .ok_or_else(|| AgentRuntimeError::Core("detection expired; detect again".to_string()))?;
    let preferences = read_preferences();
    let preference = preferences
        .sources
        .get(snapshot.source.id())
        .cloned()
        .unwrap_or_default();
    let fresh = scan_source(snapshot.source, snapshot.project_root.clone(), preference)?;
    if fresh.source_fingerprint != snapshot.source_fingerprint {
        return Err(AgentRuntimeError::Core(
            "source changed since detection; detect again".to_string(),
        ));
    }
    let mut provenance = read_provenance();
    let mut results = Vec::new();
    for candidate in fresh.candidates {
        if !matches!(candidate.status.as_str(), "pending" | "update") {
            results.push(json!({ "kind": candidate.kind, "scope": candidate.scope, "targetId": candidate.target_id, "status": candidate.status }));
            continue;
        }
        match sync_candidate(&candidate, fresh.project_root.as_deref()) {
            Ok((_, connection_error)) => {
                let target_fingerprint = current_target_fingerprint(&candidate, fresh.project_root.as_deref()).unwrap_or_else(|| candidate.fingerprint.clone());
                provenance.entries.retain(|entry| !(entry.source_id == fresh.source.id() && entry.kind == candidate.kind && entry.scope == candidate.scope && entry.source_item_id == candidate.source_item_id));
                provenance.entries.push(ProvenanceEntry {
                    source_id: fresh.source.id().to_string(), kind: candidate.kind.clone(), scope: candidate.scope.clone(),
                    source_path: candidate.source_path.to_string_lossy().to_string(), source_item_id: candidate.source_item_id.clone(),
                    target_id: candidate.target_id.clone(), source_fingerprint: candidate.fingerprint.clone(), target_fingerprint,
                    synced_at: now(),
                });
                let status = if connection_error.is_some() {
                    "failed"
                } else if candidate.kind == "mcp" && candidate.enabled {
                    "connected"
                } else if candidate.status == "update" {
                    "updated"
                } else {
                    "imported"
                };
                results.push(json!({ "kind": candidate.kind, "scope": candidate.scope, "targetId": candidate.target_id, "status": status, "message": connection_error }));
            }
            Err(error) => results.push(json!({ "kind": candidate.kind, "scope": candidate.scope, "targetId": candidate.target_id, "status": "failed", "message": error.to_string() })),
        }
    }
    write_provenance(&provenance)?;
    if let Ok(mut cache) = detection_cache().lock() {
        cache.remove(&detection_id);
    }
    Ok(
        json!({ "sourceId": fresh.source.id(), "results": results, "diagnostics": fresh.diagnostics }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn normalizes_stdio_and_remote_mcp_configs() {
        let (stdio, enabled) = normalize_mcp(
            "filesystem",
            json!({
                "command": "npx", "args": ["-y", "server"], "env_vars": ["TOKEN"],
                "cwd": "/tmp", "startup_timeout_sec": 5
            }),
        )
        .expect("stdio config");
        assert!(enabled);
        assert_eq!(stdio.get("id").and_then(Value::as_str), Some("filesystem"));
        assert_eq!(
            stdio
                .get("env_vars")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(1)
        );

        let (remote, enabled) = normalize_mcp(
            "remote",
            json!({
                "url": "https://example.test/mcp", "type": "sse",
                "env_http_headers": { "X-Token": "TOKEN" }, "bearer_token_env_var": "BEARER"
            }),
        )
        .expect("remote config");
        assert!(enabled);
        assert_eq!(remote.get("transport").and_then(Value::as_str), Some("sse"));
    }

    #[test]
    fn parses_opencode_and_zed_mcp_shapes() {
        let (local, enabled) = normalize_mcp(
            "local",
            json!({
                "type": "local",
                "command": ["npx", "-y", "server"],
                "environment": { "TOKEN": "${TOKEN}" },
                "timeout": 4500
            }),
        )
        .expect("OpenCode local config");
        assert!(enabled);
        assert_eq!(local.get("command").and_then(Value::as_str), Some("npx"));
        assert_eq!(
            local.get("args").and_then(Value::as_array).map(Vec::len),
            Some(2)
        );
        assert_eq!(
            local.get("toolTimeoutMs").and_then(Value::as_u64),
            Some(4500)
        );

        let (zed, enabled) = normalize_mcp(
            "zed",
            json!({
                "command": "node",
                "args": ["server.js"],
                "env": { "TOKEN": "${TOKEN}" },
                "tool_timeout_sec": 12,
                "enabled": false
            }),
        )
        .expect("Zed stdio config");
        assert!(!enabled);
        assert_eq!(
            zed.get("tool_timeout_sec").and_then(Value::as_u64),
            Some(12)
        );
    }

    #[test]
    fn parses_jsonc_comments_and_trailing_commas() {
        let parsed: Value = serde_json::from_str(&strip_json_comments_and_trailing_commas(
            r#"{
                // line comment
                "url": "https://example.test/a//b",
                "items": [1, 2,],
                /* block comment */
            }"#,
        ))
        .expect("valid JSON after cleanup");
        assert_eq!(
            parsed.get("url").and_then(Value::as_str),
            Some("https://example.test/a//b")
        );
        assert_eq!(
            parsed.get("items").and_then(Value::as_array).map(Vec::len),
            Some(2)
        );
    }

    #[test]
    fn finds_nested_opencode_skill_packages() {
        let temp = tempdir().expect("tempdir");
        let skill = temp.path().join("skills/team/review");
        fs::create_dir_all(&skill).expect("skill directory");
        fs::write(skill.join("SKILL.md"), "Review the changes carefully.").expect("skill markdown");

        let mut candidates = Vec::new();
        append_skill_candidates_recursive(&mut candidates, "user", [temp.path().join("skills")]);

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].target_id, "review");
        assert_eq!(candidates[0].source_path, skill);
    }

    #[test]
    fn merges_zed_settings_with_user_settings_winning() {
        let temp = tempdir().expect("tempdir");
        let global = temp.path().join("global_settings.json");
        let user = temp.path().join("settings.json");
        fs::write(
            &global,
            r#"{"context_servers":{"shared":{"command":"global"}}}"#,
        )
        .expect("global settings");
        fs::write(
            &user,
            r#"{"context_servers":{"shared":{"command":"user"},"remote":{"url":"https://example.test/mcp","timeout":15}}}"#,
        )
        .expect("user settings");

        let mut diagnostics = Vec::new();
        let servers = zed_mcp([global, user], &mut diagnostics);

        assert!(diagnostics.is_empty());
        assert_eq!(
            servers["shared"].get("command").and_then(Value::as_str),
            Some("user")
        );
        assert_eq!(
            servers["remote"]
                .get("tool_timeout_sec")
                .and_then(Value::as_u64),
            Some(15)
        );
    }

    #[test]
    fn recognizes_standard_and_opencode_environment_references() {
        assert_eq!(secret_env_name("${TOKEN}").as_deref(), Some("TOKEN"));
        assert_eq!(secret_env_name("{env:TOKEN}").as_deref(), Some("TOKEN"));
        assert_eq!(secret_env_name("literal"), None);
    }

    #[test]
    fn rejects_unrepresentable_mcp_config() {
        let error = normalize_mcp(
            "oauth",
            json!({
                "url": "https://example.test/mcp", "oauth": { "client_id": "id" }
            }),
        )
        .expect_err("unsupported oauth");
        assert!(error.contains("unsupported OAuth"));
    }

    #[test]
    fn stored_mcp_fingerprint_ignores_runtime_state() {
        let first = json!({
            "id": "remote", "name": "remote", "enabled": true,
            "transport": { "kind": "http", "url": "https://example.test/mcp", "headers": {} },
            "state": "disconnected", "updatedAt": "one"
        });
        let second = json!({
            "id": "remote", "name": "remote", "enabled": true,
            "transport": { "kind": "http", "url": "https://example.test/mcp", "headers": {} },
            "state": "connected", "updatedAt": "two", "tools": [{ "name": "read" }]
        });
        assert_eq!(
            stored_mcp_fingerprint(&first),
            stored_mcp_fingerprint(&second)
        );
    }

    #[test]
    fn source_and_stored_mcp_fingerprints_match_for_equivalent_config() {
        let source = json!({
            "id": "remote", "name": "remote", "enabled": true,
            "url": "https://example.test/mcp", "transport": "http",
            "env_http_headers": { "X-Token": "TOKEN" }, "tool_timeout_sec": 7
        });
        let stored = json!({
            "id": "remote", "name": "remote", "enabled": true,
            "transport": {
                "kind": "http", "url": "https://example.test/mcp", "headers": {},
                "envHttpHeaders": { "X-Token": "TOKEN" }
            },
            "toolTimeoutMs": 7000, "state": "connected"
        });
        assert_eq!(
            source_mcp_fingerprint(&source),
            stored_mcp_fingerprint(&stored)
        );
    }
}
