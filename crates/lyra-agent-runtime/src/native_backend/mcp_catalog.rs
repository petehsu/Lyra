use super::*;
use http::{HeaderName, HeaderValue};
use rmcp::{
    ServiceExt,
    model::{CallToolRequestParams, ClientInfo},
    service::{Peer, RoleClient},
    transport::{
        StreamableHttpClientTransport, TokioChildProcess,
        auth::{
            AuthClient, AuthError, AuthorizationManager, AuthorizationRequest, CredentialStore,
            OAuthState, StoredCredentials,
        },
        streamable_http_client::{StreamableHttpClientTransportConfig, StreamableHttpError},
    },
};
use std::{
    collections::{BTreeMap, HashMap},
    future::Future,
    pin::Pin,
    process::Stdio,
    sync::{Arc, Mutex as StdMutex, OnceLock},
};

mod output;
mod policy;
pub(crate) use policy::execute_for_project;
pub(crate) use policy::{effective_registry, set_enabled};

pub(crate) use output::format_mcp_output;

const REGISTRY_FILE_NAME: &str = "registry.v1.json";
const OAUTH_CREDENTIAL_REFS_FILE_NAME: &str = "oauth-credential-refs.v1.json";
const DEFAULT_MCP_TIMEOUT_MS: u64 = 30_000;
const MCP_OAUTH_TIMEOUT: Duration = Duration::from_secs(10 * 60);

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct McpOAuthCredentialRefs {
    #[serde(default = "default_oauth_refs_version")]
    version: u32,
    #[serde(default)]
    refs: BTreeMap<String, Value>,
}

fn default_oauth_refs_version() -> u32 {
    1
}

fn oauth_credential_refs_lock() -> &'static StdMutex<()> {
    static LOCK: OnceLock<StdMutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| StdMutex::new(()))
}

fn oauth_credential_refs_path() -> PathBuf {
    mcp_storage_root().join(OAUTH_CREDENTIAL_REFS_FILE_NAME)
}

fn read_oauth_credential_ref(server_id: &str) -> Option<Value> {
    let _guard = oauth_credential_refs_lock().lock().ok()?;
    read_json::<McpOAuthCredentialRefs>(&oauth_credential_refs_path())
        .unwrap_or_default()
        .refs
        .remove(server_id)
}

fn write_oauth_credential_ref(server_id: &str, credential_ref: Value) -> AgentRuntimeResult<()> {
    let _guard = oauth_credential_refs_lock().lock().map_err(|_| {
        AgentRuntimeError::Core("MCP OAuth credential store lock failed".to_string())
    })?;
    let path = oauth_credential_refs_path();
    let mut document = read_json::<McpOAuthCredentialRefs>(&path).unwrap_or_default();
    document.version = 1;
    document.refs.insert(server_id.to_string(), credential_ref);
    write_json(&path, &document)
}

#[derive(Clone, Debug)]
struct McpOAuthCredentialStore {
    server_id: String,
}

impl McpOAuthCredentialStore {
    fn auth_error(error: impl ToString) -> AuthError {
        AuthError::InternalError(error.to_string())
    }
}

#[async_trait::async_trait]
impl CredentialStore for McpOAuthCredentialStore {
    async fn load(&self) -> Result<Option<StoredCredentials>, AuthError> {
        let Some(credential_ref) = read_oauth_credential_ref(&self.server_id) else {
            return Ok(None);
        };
        let serialized =
            resolve_mcp_secret(&credential_ref, &self.server_id).map_err(Self::auth_error)?;
        serde_json::from_str(&serialized)
            .map(Some)
            .map_err(Self::auth_error)
    }

    async fn save(&self, credentials: StoredCredentials) -> Result<(), AuthError> {
        let dispatcher = host_dispatcher().ok_or_else(|| {
            Self::auth_error("secure storage is unavailable for MCP OAuth credentials")
        })?;
        let serialized = serde_json::to_string(&credentials).map_err(Self::auth_error)?;
        let stored = tools::invoke_host_capability_with_timeout(
            dispatcher,
            "sensitiveValues.storeForAgentUse".to_string(),
            json!({
                "owner": "external",
                "valueKind": "token",
                "label": format!("MCP OAuth credentials for {}", self.server_id),
                "description": "OAuth client and refresh credentials encrypted by Electron safeStorage",
                "value": serialized,
                "timeoutMs": 30_000,
            }),
            30_000,
        )
        .map_err(Self::auth_error)?;
        let credential_ref = stored
            .get("ref")
            .filter(|value| value.is_object())
            .cloned()
            .ok_or_else(|| {
                Self::auth_error("secure storage did not return an MCP credential ref")
            })?;
        write_oauth_credential_ref(&self.server_id, credential_ref).map_err(Self::auth_error)
    }

    async fn clear(&self) -> Result<(), AuthError> {
        let _guard = oauth_credential_refs_lock()
            .lock()
            .map_err(|_| Self::auth_error("MCP OAuth credential store lock failed"))?;
        let path = oauth_credential_refs_path();
        let mut document = read_json::<McpOAuthCredentialRefs>(&path).unwrap_or_default();
        document.refs.remove(&self.server_id);
        write_json(&path, &document).map_err(Self::auth_error)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum McpTransportConfig {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(default, rename = "secretEnv")]
        secret_env: BTreeMap<String, Value>,
        #[serde(default, rename = "envVars")]
        env_vars: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
    },
    Http {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default, rename = "secretHeaders")]
        secret_headers: BTreeMap<String, Value>,
        #[serde(default, rename = "envHttpHeaders")]
        env_http_headers: BTreeMap<String, String>,
        #[serde(
            default,
            rename = "bearerTokenEnvVar",
            alias = "bearer_token_env_var",
            skip_serializing_if = "Option::is_none"
        )]
        bearer_token_env_var: Option<String>,
    },
    Sse {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default, rename = "secretHeaders")]
        secret_headers: BTreeMap<String, Value>,
        #[serde(default, rename = "envHttpHeaders")]
        env_http_headers: BTreeMap<String, String>,
        #[serde(
            default,
            rename = "bearerTokenEnvVar",
            alias = "bearer_token_env_var",
            skip_serializing_if = "Option::is_none"
        )]
        bearer_token_env_var: Option<String>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpToolInfo {
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) input_schema: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) output_schema: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpServerConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) source_label: Option<String>,
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) transport: McpTransportConfig,
    #[serde(default = "default_true")]
    pub(crate) enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) startup_timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) tool_timeout_ms: Option<u64>,
    #[serde(default = "default_disconnected")]
    pub(crate) state: String,
    #[serde(default)]
    pub(crate) tools: Vec<McpToolInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) last_error: Option<String>,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct McpRegistryDocument {
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) servers: Vec<McpServerConfig>,
}

impl Default for McpRegistryDocument {
    fn default() -> Self {
        Self {
            version: 1,
            servers: Vec::new(),
        }
    }
}

#[derive(Clone, Debug)]
struct McpServerDraft {
    id: Option<String>,
    name: Option<String>,
    transport: McpTransportConfig,
    enabled: bool,
    startup_timeout_ms: Option<u64>,
    tool_timeout_ms: Option<u64>,
}

fn mcp_sdk_runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .thread_name("lyra-mcp")
            .build()
            .expect("MCP runtime must initialize")
    })
}

fn mcp_sdk_peers() -> &'static tokio::sync::Mutex<HashMap<String, Peer<RoleClient>>> {
    static PEERS: OnceLock<tokio::sync::Mutex<HashMap<String, Peer<RoleClient>>>> = OnceLock::new();
    PEERS.get_or_init(|| tokio::sync::Mutex::new(HashMap::new()))
}

fn mcp_sdk_connection_lock(key: &str) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<StdMutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
        OnceLock::new();
    let locks = LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut locks = locks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks
        .entry(key.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn mcp_sdk_connection_key(server: &McpServerConfig) -> String {
    format!("{}:{}", server.id, transport_label(&server.transport))
}

fn resolved_remote_headers(
    server: &McpServerConfig,
) -> AgentRuntimeResult<HashMap<HeaderName, HeaderValue>> {
    let (mut headers, secret_headers, env_http_headers, bearer_token_env_var) =
        match &server.transport {
            McpTransportConfig::Http {
                headers,
                secret_headers,
                env_http_headers,
                bearer_token_env_var,
                ..
            }
            | McpTransportConfig::Sse {
                headers,
                secret_headers,
                env_http_headers,
                bearer_token_env_var,
                ..
            } => (
                headers.clone(),
                secret_headers,
                env_http_headers,
                bearer_token_env_var,
            ),
            McpTransportConfig::Stdio { .. } => return Ok(HashMap::new()),
        };
    for (name, secret_ref) in secret_headers {
        headers.insert(name.clone(), resolve_mcp_secret(secret_ref, &server.id)?);
    }
    for (name, variable) in env_http_headers {
        if let Ok(value) = std::env::var(variable) {
            headers.insert(name.clone(), value);
        }
    }
    if let Some(variable) = bearer_token_env_var
        && let Ok(value) = std::env::var(variable)
    {
        headers.insert("authorization".to_string(), format!("Bearer {value}"));
    }
    headers
        .into_iter()
        .map(|(name, value)| {
            Ok((
                HeaderName::from_bytes(name.as_bytes())
                    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?,
                HeaderValue::from_str(&value)
                    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?,
            ))
        })
        .collect()
}

type RunningMcpService = Pin<Box<dyn Future<Output = ()> + Send>>;

#[derive(Debug)]
struct RemoteMcpConnectError {
    message: String,
    challenge: Option<String>,
}

fn mcp_auth_challenge_from_error(error: &(dyn std::error::Error + 'static)) -> Option<String> {
    let mut current = Some(error);
    while let Some(source) = current {
        if let Some(http_error) = source.downcast_ref::<StreamableHttpError<rmcp_reqwest::Error>>()
            && let Some(challenge) = http_error.auth_challenge()
        {
            return Some(challenge.to_string());
        }
        current = source.source();
    }
    None
}

async fn new_mcp_authorization_manager(
    server_id: &str,
    url: &str,
    http_client: rmcp_reqwest::Client,
    initialize_from_store: bool,
) -> Result<AuthorizationManager, AuthError> {
    let mut manager = AuthorizationManager::new(url).await?;
    manager.with_client(http_client)?;
    manager.set_credential_store(McpOAuthCredentialStore {
        server_id: server_id.to_string(),
    });
    if initialize_from_store {
        let _ = manager.initialize_from_store().await?;
    }
    Ok(manager)
}

async fn serve_remote_mcp(
    server: &McpServerConfig,
    url: &str,
    http_client: rmcp_reqwest::Client,
    auth_manager: AuthorizationManager,
) -> Result<(Peer<RoleClient>, RunningMcpService), RemoteMcpConnectError> {
    let config = StreamableHttpClientTransportConfig::with_uri(url.to_string()).custom_headers(
        resolved_remote_headers(server).map_err(|error| RemoteMcpConnectError {
            message: error.to_string(),
            challenge: None,
        })?,
    );
    let transport = StreamableHttpClientTransport::with_client(
        AuthClient::new(http_client, auth_manager),
        config,
    );
    let service = ClientInfo::default()
        .serve(transport)
        .await
        .map_err(|error| RemoteMcpConnectError {
            challenge: mcp_auth_challenge_from_error(&error),
            message: error.to_string(),
        })?;
    let peer = service.peer().clone();
    let running = Box::pin(async move {
        let _ = service.waiting().await;
    });
    Ok((peer, running))
}

const MCP_AUTH_ERROR_MARKERS: [&str; 5] = ["auth", "unauthorized", "401", "status 401", "http 401"];

fn is_mcp_authentication_error(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    MCP_AUTH_ERROR_MARKERS
        .iter()
        .any(|marker| normalized.contains(marker))
}

async fn receive_mcp_oauth_callback(
    listener: tokio::net::TcpListener,
) -> AgentRuntimeResult<String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (mut stream, _) = tokio::time::timeout(MCP_OAUTH_TIMEOUT, listener.accept())
        .await
        .map_err(|_| AgentRuntimeError::Core("MCP OAuth authorization timed out".to_string()))?
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let mut request = Vec::with_capacity(2_048);
    let mut buffer = [0_u8; 2_048];
    loop {
        let read = stream
            .read(&mut buffer)
            .await
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") || request.len() >= 16_384 {
            break;
        }
    }
    let request = String::from_utf8_lossy(&request);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| AgentRuntimeError::Core("invalid MCP OAuth callback".to_string()))?;
    let callback_url = format!("http://127.0.0.1{target}");
    Url::parse(&callback_url)
        .map_err(|error| AgentRuntimeError::Core(format!("invalid MCP OAuth callback: {error}")))?;
    let body = "<!doctype html><title>Lyra</title><script>window.close()</script>Return to Lyra.";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
    Ok(callback_url)
}

async fn authorize_remote_mcp(
    server: &McpServerConfig,
    url: &str,
    http_client: rmcp_reqwest::Client,
    challenge: Option<&str>,
) -> AgentRuntimeResult<AuthorizationManager> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let port = listener
        .local_addr()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");
    let manager = new_mcp_authorization_manager(&server.id, url, http_client, false)
        .await
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let mut oauth = OAuthState::Unauthorized(manager);
    let mut request = AuthorizationRequest::new(redirect_uri)
        .with_client_name("Lyra")
        .with_application_type("native");
    if let Some(challenge) = challenge {
        request = request.with_challenge(challenge);
    }
    oauth
        .start_authorization(request)
        .await
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let authorization_url = oauth
        .get_authorization_url()
        .await
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let dispatcher = host_dispatcher().ok_or_else(|| {
        AgentRuntimeError::Core("Lyra browser is unavailable for MCP OAuth".to_string())
    })?;
    tools::invoke_host_capability_with_timeout(
        dispatcher,
        "mcp.oauth.openAuthorizationUrl".to_string(),
        json!({ "serverId": server.id, "url": authorization_url, "timeoutMs": 30_000 }),
        30_000,
    )
    .map_err(AgentRuntimeError::HostCapability)?;
    let callback_url = receive_mcp_oauth_callback(listener).await?;
    oauth
        .handle_callback_url(&callback_url)
        .await
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    oauth.into_authorization_manager().ok_or_else(|| {
        AgentRuntimeError::Core("MCP OAuth did not reach the authorized state".to_string())
    })
}

async fn connect_mcp_sdk(server: &McpServerConfig) -> AgentRuntimeResult<Peer<RoleClient>> {
    let key = mcp_sdk_connection_key(server);
    let connect_lock = mcp_sdk_connection_lock(&key);
    let _connect_guard = connect_lock.lock().await;
    {
        let mut peers = mcp_sdk_peers().lock().await;
        if let Some(peer) = peers.get(&key)
            && !peer.is_transport_closed()
        {
            return Ok(peer.clone());
        }
        peers.remove(&key);
    }

    let (peer, running): (Peer<RoleClient>, RunningMcpService) = match &server.transport {
        McpTransportConfig::Stdio {
            command,
            args,
            env,
            secret_env,
            env_vars,
            cwd,
        } => {
            let mut process = tokio::process::Command::new(command);
            process
                .args(args)
                .envs(env)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped());
            process.stderr(Stdio::null());
            for (name, secret_ref) in secret_env {
                process.env(name, resolve_mcp_secret(secret_ref, &server.id)?);
            }
            for variable in env_vars {
                if let Ok(value) = std::env::var(variable) {
                    process.env(variable, value);
                }
            }
            if let Some(cwd) = cwd
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                process.current_dir(cwd);
            }
            let transport = TokioChildProcess::new(process)
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
            let service = ClientInfo::default()
                .serve(transport)
                .await
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
            let peer = service.peer().clone();
            let running = Box::pin(async move {
                let _ = service.waiting().await;
            });
            (peer, running)
        }
        McpTransportConfig::Http { url, .. } | McpTransportConfig::Sse { url, .. } => {
            let http_client = rmcp_reqwest::Client::builder()
                .build()
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
            let auth_manager =
                new_mcp_authorization_manager(&server.id, url, http_client.clone(), true)
                    .await
                    .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
            match serve_remote_mcp(server, url, http_client.clone(), auth_manager).await {
                Ok(connection) => connection,
                Err(error)
                    if error.challenge.is_some() || is_mcp_authentication_error(&error.message) =>
                {
                    let auth_manager = authorize_remote_mcp(
                        server,
                        url,
                        http_client.clone(),
                        error.challenge.as_deref(),
                    )
                    .await?;
                    serve_remote_mcp(server, url, http_client, auth_manager)
                        .await
                        .map_err(|error| {
                            AgentRuntimeError::Core(format!(
                                "MCP connection failed after OAuth authorization: {}",
                                error.message
                            ))
                        })?
                }
                Err(error) => return Err(AgentRuntimeError::Core(error.message)),
            }
        }
    };
    tokio::spawn(running);
    mcp_sdk_peers().lock().await.insert(key, peer.clone());
    Ok(peer)
}

fn sdk_tool_info(tool: rmcp::model::Tool) -> McpToolInfo {
    McpToolInfo {
        name: tool.name.into_owned(),
        description: tool
            .description
            .map(|value| value.into_owned())
            .unwrap_or_default(),
        input_schema: Some(Value::Object((*tool.input_schema).clone())),
        output_schema: tool
            .output_schema
            .map(|schema| Value::Object((*schema).clone())),
    }
}

fn sdk_list_tools(
    server: &McpServerConfig,
    timeout: Duration,
) -> AgentRuntimeResult<Vec<McpToolInfo>> {
    mcp_sdk_runtime().block_on(async {
        let peer = connect_mcp_sdk(server).await?;
        tokio::time::timeout(timeout, peer.list_all_tools())
            .await
            .map_err(|_| AgentRuntimeError::Core("MCP tools/list timed out".to_string()))?
            .map(|tools| tools.into_iter().map(sdk_tool_info).collect())
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))
    })
}

fn sdk_call_tool(
    server: &McpServerConfig,
    name: &str,
    arguments: Value,
    timeout: Duration,
) -> AgentRuntimeResult<Value> {
    let arguments = arguments.as_object().cloned().ok_or_else(|| {
        AgentRuntimeError::Core("MCP tool arguments must be a JSON object".to_string())
    })?;
    mcp_sdk_runtime().block_on(async {
        let peer = connect_mcp_sdk(server).await?;
        let result = tokio::time::timeout(
            timeout,
            peer.call_tool(CallToolRequestParams::new(name.to_string()).with_arguments(arguments)),
        )
        .await
        .map_err(|_| AgentRuntimeError::Core(format!("MCP tool {name} timed out")))?
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        serde_json::to_value(result).map_err(|error| AgentRuntimeError::Core(error.to_string()))
    })
}

fn sdk_disconnect_server(server_id: &str) {
    mcp_sdk_runtime().block_on(async {
        let prefix = format!("{server_id}:");
        mcp_sdk_peers()
            .lock()
            .await
            .retain(|key, _| !key.starts_with(&prefix));
    });
}

fn default_true() -> bool {
    true
}

fn default_disconnected() -> String {
    "disconnected".to_string()
}

pub(crate) fn mcp_storage_root() -> PathBuf {
    if let Some(path) = env::var_os("LYRA_MCP_HOME") {
        return PathBuf::from(path);
    }
    if let Some(path) = env::var_os("LYRA_AGENT_HOME") {
        let agent_home = PathBuf::from(path);
        if let Some(modules_root) = agent_home.parent() {
            return modules_root.join("mcp");
        }
    }
    let root = runtime_root();
    if cfg!(test) {
        return root.join("mcp");
    }
    root.parent()
        .map(|parent| parent.join("mcp"))
        .unwrap_or_else(|| root.join("mcp"))
}

fn registry_path(storage_root: &Path) -> PathBuf {
    storage_root.join(REGISTRY_FILE_NAME)
}

pub(crate) fn read_registry_from(storage_root: &Path) -> McpRegistryDocument {
    // Reading a catalog must not rename or remove the user's configuration.
    // Mutations validate existing JSON before writing.
    fs::read(registry_path(storage_root))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<McpRegistryDocument>(&bytes).ok())
        .unwrap_or_default()
}

pub(crate) fn write_registry_to(
    storage_root: &Path,
    registry: &McpRegistryDocument,
) -> AgentRuntimeResult<()> {
    let path = registry_path(storage_root);
    if path.exists() {
        let bytes = fs::read(&path).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        serde_json::from_slice::<McpRegistryDocument>(&bytes)
            .map_err(|error| AgentRuntimeError::Core(format!("{}: {error}", path.display())))?;
    }
    fs::create_dir_all(storage_root).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    write_json(&registry_path(storage_root), registry)
}

fn read_registry() -> McpRegistryDocument {
    read_registry_from(&mcp_storage_root())
}

/// Read-only snapshot of the global MCP registry for dynamic Tool-FS
/// manifest generation (mcp_dynamic.rs). Exposes server configs including
/// their discovered tools without exposing mutation helpers.
pub(crate) fn registry_snapshot() -> McpRegistryDocument {
    read_registry()
}

fn write_registry(registry: &McpRegistryDocument) -> AgentRuntimeResult<()> {
    write_registry_to(&mcp_storage_root(), registry)
}

fn slugify_id(value: &str) -> String {
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

pub(crate) fn transport_label(transport: &McpTransportConfig) -> String {
    match transport {
        McpTransportConfig::Stdio { command, args, .. } => std::iter::once(command.as_str())
            .chain(args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" "),
        McpTransportConfig::Http { url, .. } | McpTransportConfig::Sse { url, .. } => url.clone(),
    }
}

fn default_name_for(transport: &McpTransportConfig) -> String {
    match transport {
        McpTransportConfig::Stdio { command, args, .. } => args
            .iter()
            .find(|arg| !arg.starts_with('-'))
            .or_else(|| args.last())
            .cloned()
            .unwrap_or_else(|| command.clone()),
        McpTransportConfig::Http { url, .. } | McpTransportConfig::Sse { url, .. } => {
            Url::parse(url)
                .ok()
                .and_then(|url| url.host_str().map(str::to_string))
                .unwrap_or_else(|| url.clone())
        }
    }
}

fn server_value(server: &McpServerConfig) -> Value {
    let mut transport = serde_json::to_value(&server.transport).unwrap_or_else(|_| json!({}));
    if let Some(object) = transport.as_object_mut() {
        if let Some(env) = object.get("env").and_then(Value::as_object) {
            let redacted = env
                .keys()
                .map(|key| (key.clone(), Value::String("<configured>".to_string())))
                .collect::<Map<_, _>>();
            object.insert("env".to_string(), Value::Object(redacted));
        }
        if let Some(headers) = object.get("headers").and_then(Value::as_object) {
            let redacted = headers
                .keys()
                .map(|key| (key.clone(), Value::String("<configured>".to_string())))
                .collect::<Map<_, _>>();
            object.insert("headers".to_string(), Value::Object(redacted));
        }
        if let Some(secret_env) = object
            .remove("secretEnv")
            .and_then(|value| value.as_object().cloned())
        {
            let redacted = secret_env
                .keys()
                .map(|key| (key.clone(), Value::String("<configured>".to_string())))
                .collect::<Map<_, _>>();
            object.insert("secretEnv".to_string(), Value::Object(redacted));
        }
        if let Some(secret_headers) = object
            .remove("secretHeaders")
            .and_then(|value| value.as_object().cloned())
        {
            let redacted = secret_headers
                .keys()
                .map(|key| (key.clone(), Value::String("<configured>".to_string())))
                .collect::<Map<_, _>>();
            object.insert("secretHeaders".to_string(), Value::Object(redacted));
        }
    }
    json!({
        "id": server.id,
        "name": server.name,
        "transport": transport,
        "transportSummary": transport_label(&server.transport),
        "enabled": server.enabled,
        "state": server.state,
        "toolCount": server.tools.len(),
        "tools": server.tools,
        "sourceLabel": server.source_label,
        "lastError": server.last_error,
        "createdAt": server.created_at,
        "updatedAt": server.updated_at,
        "startupTimeoutMs": server.startup_timeout_ms,
        "toolTimeoutMs": server.tool_timeout_ms,
    })
}

fn string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| string_opt(value, key))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn bool_field(value: &Value, key: &str, default_value: bool) -> bool {
    value
        .get(key)
        .and_then(Value::as_bool)
        .or_else(|| {
            value
                .get("disabled")
                .and_then(Value::as_bool)
                .map(|value| !value)
        })
        .unwrap_or(default_value)
}

fn parse_string_array(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        Some(Value::String(text)) => shlex::split(text).unwrap_or_else(|| vec![text.to_string()]),
        _ => Vec::new(),
    }
}

fn parse_string_map(value: Option<&Value>) -> BTreeMap<String, String> {
    match value {
        Some(Value::Object(object)) => object
            .iter()
            .filter_map(|(key, value)| {
                value
                    .as_str()
                    .map(str::to_string)
                    .or_else(|| Some(value.to_string()))
                    .map(|value| (key.clone(), value))
            })
            .collect(),
        Some(Value::String(text)) => text
            .lines()
            .filter_map(|line| line.split_once('='))
            .map(|(key, value)| (key.trim().to_string(), value.trim().to_string()))
            .filter(|(key, _)| !key.is_empty())
            .collect(),
        _ => BTreeMap::new(),
    }
}

fn parse_value_map(value: Option<&Value>) -> BTreeMap<String, Value> {
    value
        .and_then(Value::as_object)
        .map(|object| {
            object
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect()
        })
        .unwrap_or_default()
}

fn resolve_mcp_secret(secret_ref: &Value, server_id: &str) -> AgentRuntimeResult<String> {
    let dispatcher = host_dispatcher().ok_or_else(|| {
        AgentRuntimeError::Core(format!(
            "MCP secret for {server_id} is stored securely, but secure storage is unavailable"
        ))
    })?;
    let value = tools::invoke_host_capability_with_timeout(
        dispatcher,
        "sensitiveValues.resolveForAgentUse".to_string(),
        json!({ "ref": secret_ref, "reason": "mcp-server", "timeoutMs": 30_000 }),
        30_000,
    )
    .map_err(AgentRuntimeError::HostCapability)?;
    value
        .get("value")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!("stored MCP secret for {server_id} is unavailable"))
        })
}

fn parse_single_server(
    value: &Value,
    fallback_id: Option<&str>,
) -> AgentRuntimeResult<McpServerDraft> {
    let id = string_field(value, &["serverId", "id", "key", "name"])
        .or_else(|| fallback_id.map(str::to_string));
    let name = string_field(value, &["displayName", "label", "name"])
        .or_else(|| fallback_id.map(str::to_string));
    let transport_kind = string_field(value, &["transport", "type"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let url = string_field(value, &["url", "endpoint", "serverUrl"]);
    let enabled = bool_field(value, "enabled", true);
    let startup_timeout_ms = value
        .get("startupTimeoutMs")
        .and_then(Value::as_u64)
        .or_else(|| {
            value
                .get("startup_timeout_sec")
                .and_then(Value::as_u64)
                .map(|seconds| seconds.saturating_mul(1_000))
        });
    let tool_timeout_ms = value
        .get("toolTimeoutMs")
        .and_then(Value::as_u64)
        .or_else(|| {
            value
                .get("tool_timeout_sec")
                .and_then(Value::as_u64)
                .map(|seconds| seconds.saturating_mul(1_000))
        });
    if let Some(command) = string_field(value, &["command", "cmd"]) {
        return Ok(McpServerDraft {
            id,
            name,
            enabled,
            startup_timeout_ms,
            tool_timeout_ms,
            transport: McpTransportConfig::Stdio {
                command,
                args: parse_string_array(value.get("args").or_else(|| value.get("arguments"))),
                env: parse_string_map(value.get("env")),
                secret_env: parse_value_map(
                    value.get("secretEnv").or_else(|| value.get("secret_env")),
                ),
                env_vars: parse_string_array(
                    value.get("envVars").or_else(|| value.get("env_vars")),
                ),
                cwd: string_field(value, &["cwd"]),
            },
        });
    }
    if let Some(url) = url {
        let headers = parse_string_map(value.get("headers").or_else(|| value.get("http_headers")));
        let env_http_headers = parse_string_map(
            value
                .get("envHttpHeaders")
                .or_else(|| value.get("env_http_headers")),
        );
        let bearer_token_env_var =
            string_field(value, &["bearerTokenEnvVar", "bearer_token_env_var"]);
        let transport = if transport_kind == "sse" {
            McpTransportConfig::Sse {
                url,
                headers,
                secret_headers: parse_value_map(
                    value
                        .get("secretHeaders")
                        .or_else(|| value.get("secret_headers")),
                ),
                env_http_headers,
                bearer_token_env_var,
            }
        } else {
            McpTransportConfig::Http {
                url,
                headers,
                secret_headers: parse_value_map(
                    value
                        .get("secretHeaders")
                        .or_else(|| value.get("secret_headers")),
                ),
                env_http_headers,
                bearer_token_env_var,
            }
        };
        return Ok(McpServerDraft {
            id,
            name,
            enabled,
            startup_timeout_ms,
            tool_timeout_ms,
            transport,
        });
    }
    Err(AgentRuntimeError::Core(
        "MCP server config needs command+args or url".to_string(),
    ))
}

fn parse_text_server(text: &str) -> AgentRuntimeResult<Vec<McpServerDraft>> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AgentRuntimeError::Core(
            "MCP server input is empty".to_string(),
        ));
    }
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        return parse_server_drafts(&value);
    }
    if text.starts_with("http://") || text.starts_with("https://") {
        return Ok(vec![McpServerDraft {
            id: None,
            name: None,
            enabled: true,
            startup_timeout_ms: None,
            tool_timeout_ms: None,
            transport: McpTransportConfig::Http {
                url: text.to_string(),
                headers: BTreeMap::new(),
                secret_headers: BTreeMap::new(),
                env_http_headers: BTreeMap::new(),
                bearer_token_env_var: None,
            },
        }]);
    }
    let parts =
        shlex::split(text).unwrap_or_else(|| text.split_whitespace().map(str::to_string).collect());
    let Some(command) = parts.first().cloned() else {
        return Err(AgentRuntimeError::Core("MCP command is empty".to_string()));
    };
    Ok(vec![McpServerDraft {
        id: None,
        name: None,
        enabled: true,
        startup_timeout_ms: None,
        tool_timeout_ms: None,
        transport: McpTransportConfig::Stdio {
            command,
            args: parts.into_iter().skip(1).collect(),
            env: BTreeMap::new(),
            secret_env: BTreeMap::new(),
            env_vars: Vec::new(),
            cwd: None,
        },
    }])
}

fn parse_server_drafts(payload: &Value) -> AgentRuntimeResult<Vec<McpServerDraft>> {
    if let Some(text) = string_field(payload, &["text", "input", "value", "config"]) {
        return parse_text_server(&text);
    }
    if let Some(servers) = payload.get("mcpServers").and_then(Value::as_object) {
        return servers
            .iter()
            .map(|(server_id, config)| parse_single_server(config, Some(server_id)))
            .collect();
    }
    if let Some(servers) = payload.get("servers").and_then(Value::as_array) {
        return servers
            .iter()
            .map(|config| parse_single_server(config, None))
            .collect();
    }
    if let Some(server) = payload.get("server") {
        return parse_single_server(server, None).map(|server| vec![server]);
    }
    parse_single_server(payload, None).map(|server| vec![server])
}

fn preserve_redacted_values(
    next: &mut BTreeMap<String, String>,
    existing: &BTreeMap<String, String>,
) {
    for (key, value) in next.iter_mut() {
        if value == "<configured>" {
            if let Some(existing_value) = existing.get(key) {
                *value = existing_value.clone();
            }
        }
    }
}

fn preserve_secret_refs(
    plain: &mut BTreeMap<String, String>,
    refs: &mut BTreeMap<String, Value>,
    existing: &BTreeMap<String, Value>,
) {
    for (key, reference) in existing {
        if plain.get(key).is_some_and(|value| value == "<configured>") {
            plain.remove(key);
            refs.insert(key.clone(), reference.clone());
        }
    }
}

fn preserve_existing_secrets(
    mut transport: McpTransportConfig,
    existing: Option<&McpServerConfig>,
) -> McpTransportConfig {
    match (&mut transport, existing.map(|server| &server.transport)) {
        (
            McpTransportConfig::Stdio {
                env, secret_env, ..
            },
            Some(McpTransportConfig::Stdio {
                env: existing_env,
                secret_env: existing_secrets,
                ..
            }),
        ) => {
            preserve_redacted_values(env, existing_env);
            preserve_secret_refs(env, secret_env, existing_secrets);
        }
        (
            McpTransportConfig::Http {
                headers,
                secret_headers,
                ..
            }
            | McpTransportConfig::Sse {
                headers,
                secret_headers,
                ..
            },
            Some(McpTransportConfig::Http {
                headers: existing_headers,
                secret_headers: existing_secrets,
                ..
            })
            | Some(McpTransportConfig::Sse {
                headers: existing_headers,
                secret_headers: existing_secrets,
                ..
            }),
        ) => {
            preserve_redacted_values(headers, existing_headers);
            preserve_secret_refs(headers, secret_headers, existing_secrets);
        }
        _ => {}
    }
    transport
}

pub(crate) fn mutation_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

pub(crate) fn upsert_mcp_servers_at(
    storage_root: &Path,
    payload: Value,
) -> AgentRuntimeResult<Value> {
    let drafts = parse_server_drafts(&payload)?;
    let _guard = mutation_lock()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("MCP registry lock failed".into()))?;
    let mut registry = read_registry_from(storage_root);
    let timestamp = now();
    let mut installed = Vec::new();
    for draft in drafts {
        let name = draft
            .name
            .unwrap_or_else(|| default_name_for(&draft.transport));
        let id = draft
            .id
            .map(|value| slugify_id(&value))
            .unwrap_or_else(|| slugify_id(&name));
        let existing = registry.servers.iter().find(|server| server.id == id);
        let transport = preserve_existing_secrets(draft.transport, existing);
        let server = McpServerConfig {
            source_label: string_field(&payload, &["sourceLabel"])
                .or_else(|| existing.and_then(|server| server.source_label.clone())),
            id: id.clone(),
            name,
            transport,
            enabled: existing
                .map(|server| server.enabled)
                .unwrap_or(draft.enabled),
            startup_timeout_ms: draft.startup_timeout_ms,
            tool_timeout_ms: draft.tool_timeout_ms,
            state: existing
                .map(|server| server.state.clone())
                .unwrap_or_else(default_disconnected),
            tools: existing
                .map(|server| server.tools.clone())
                .unwrap_or_default(),
            last_error: None,
            created_at: existing
                .map(|server| server.created_at.clone())
                .unwrap_or_else(|| timestamp.clone()),
            updated_at: timestamp.clone(),
        };
        registry.servers.retain(|server| server.id != id);
        registry.servers.push(server.clone());
        installed.push(server);
    }
    registry
        .servers
        .sort_by(|left, right| left.id.cmp(&right.id));
    write_registry_to(storage_root, &registry)?;
    Ok(json!({
        "server": installed.first().map(server_value),
        "servers": installed.iter().map(server_value).collect::<Vec<_>>(),
        "allServers": registry.servers.iter().map(server_value).collect::<Vec<_>>(),
    }))
}

pub(crate) fn connect_needs_http_install(payload: &Value, servers: &[McpServerConfig]) -> bool {
    let Some(url) = string_field(payload, &["serverUrl", "url", "endpoint"]) else {
        return false;
    };
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return false;
    }
    let wanted = normalize_server_url(url);
    if servers
        .iter()
        .any(|server| normalize_server_url(&transport_label(&server.transport)) == wanted)
    {
        return false;
    }
    let named = server_ids_from_payload(payload);
    !named
        .iter()
        .any(|id| servers.iter().any(|server| &server.id == id))
}

pub(crate) fn install_http_server_at(storage: &Path, payload: &Value) -> AgentRuntimeResult<()> {
    let url = string_field(payload, &["serverUrl", "url", "endpoint"])
        .ok_or_else(|| AgentRuntimeError::Core("serverUrl is required".to_string()))?;
    let mut body = json!({ "serverUrl": url, "enabled": true });
    if let Some(name) = string_field(payload, &["name", "serverId", "id"]) {
        body["name"] = json!(name);
        body["serverId"] = json!(name);
    }
    upsert_mcp_servers_at(storage, body)?;
    Ok(())
}

pub(crate) fn mcp_server_upsert(payload: Value) -> AgentRuntimeResult<Value> {
    let storage = mcp_storage_root();
    let result = upsert_mcp_servers_at(&storage, payload)?;
    projects::notify_changed();
    Ok(result)
}

pub(crate) fn mcp_server_remove(payload: Value) -> AgentRuntimeResult<Value> {
    let _guard = mutation_lock()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("MCP registry lock failed".into()))?;
    let server_id = string_field(&payload, &["serverId", "id", "name"])
        .map(|value| slugify_id(&value))
        .ok_or_else(|| AgentRuntimeError::Core("serverId is required".to_string()))?;
    let storage = mcp_storage_root();
    let mut registry = read_registry_from(&storage);
    let before = registry.servers.len();
    registry.servers.retain(|server| server.id != server_id);
    write_registry_to(&storage, &registry)?;
    projects::notify_changed();
    Ok(json!({
        "serverId": server_id,
        "removed": before != registry.servers.len(),
        "servers": registry.servers.iter().map(server_value).collect::<Vec<_>>(),
    }))
}

fn update_server<F>(server_id: &str, mut update: F) -> AgentRuntimeResult<McpServerConfig>
where
    F: FnMut(&mut McpServerConfig) -> AgentRuntimeResult<()>,
{
    let _guard = mutation_lock()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("MCP registry lock failed".into()))?;
    let mut registry = read_registry();
    let Some(server) = registry
        .servers
        .iter_mut()
        .find(|server| server.id == server_id)
    else {
        return Err(AgentRuntimeError::Core(format!(
            "MCP server is not configured: {server_id}"
        )));
    };
    update(server)?;
    server.updated_at = now();
    let updated = server.clone();
    write_registry(&registry)?;
    Ok(updated)
}

fn timeout_from_payload_or(payload: &Value, configured_ms: Option<u64>) -> Duration {
    let ms = payload
        .get("timeoutMs")
        .and_then(Value::as_u64)
        .or(configured_ms)
        .unwrap_or(DEFAULT_MCP_TIMEOUT_MS)
        .clamp(1_000, 120_000);
    Duration::from_millis(ms)
}

fn probe_server(
    server: &McpServerConfig,
    timeout: Duration,
) -> AgentRuntimeResult<Vec<McpToolInfo>> {
    if !server.enabled {
        return Err(AgentRuntimeError::Core(format!(
            "MCP server is disabled: {}",
            server.id
        )));
    }
    sdk_list_tools(server, timeout)
}

fn server_ids_from_payload(payload: &Value) -> Vec<String> {
    if let Some(server_id) = string_field(payload, &["serverId", "id", "name"]) {
        return vec![slugify_id(&server_id)];
    }
    payload
        .get("serverIds")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(slugify_id)
                .collect()
        })
        .unwrap_or_default()
}

fn payload_names_a_server(payload: &Value) -> bool {
    string_field(
        payload,
        &["serverId", "id", "name", "serverUrl", "url", "endpoint"],
    )
    .is_some()
        || payload
            .get("serverIds")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item.as_str().is_some_and(|value| !value.trim().is_empty()))
            })
}

fn normalize_server_url(value: &str) -> String {
    value.trim().trim_end_matches('/').to_string()
}

/// A known id or name wins. An unknown id does not hide a URL. A URL selects
/// only the server that uses that URL. An empty result is "no server".
fn server_ids_for_operation(payload: &Value, servers: &[McpServerConfig]) -> Vec<String> {
    let ids = server_ids_from_payload(payload)
        .into_iter()
        .filter(|id| servers.iter().any(|server| &server.id == id))
        .collect::<Vec<_>>();
    if !ids.is_empty() {
        return ids;
    }
    let Some(url) = string_field(payload, &["serverUrl", "url", "endpoint"]) else {
        return Vec::new();
    };
    let wanted = normalize_server_url(&url);
    servers
        .iter()
        .filter(|server| normalize_server_url(&transport_label(&server.transport)) == wanted)
        .map(|server| server.id.clone())
        .collect()
}

pub(crate) fn mcp_server_disconnect(payload: Value) -> AgentRuntimeResult<Value> {
    let ids = server_ids_from_payload(&payload);
    if ids.is_empty() {
        return Err(AgentRuntimeError::Core("serverId is required".to_string()));
    }
    let mut servers = Vec::new();
    for server_id in ids {
        sdk_disconnect_server(&server_id);
        let server = update_server(&server_id, |server| {
            server.state = "disconnected".to_string();
            Ok(())
        })?;
        servers.push(server_value(&server));
    }
    Ok(json!({ "servers": servers }))
}

pub(crate) fn execute_mcp_state_change(name: &str, input: &Value) -> Result<Value, String> {
    let result = match name {
        "mcp_server_upsert" => mcp_server_upsert(input.clone()),
        "mcp_server_remove" => mcp_server_remove(input.clone()),
        "mcp_server_disconnect" => mcp_server_disconnect(input.clone()),
        _ => policy::execute(name, input, None),
    };
    result.map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests;
