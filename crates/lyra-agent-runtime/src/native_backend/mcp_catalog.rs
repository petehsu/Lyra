use super::*;
use reqwest::{
    blocking::{Client, Response},
    header::{ACCEPT, CONTENT_TYPE, HeaderName, HeaderValue},
};
use std::{
    collections::BTreeMap,
    io::{self, Write},
    process::{Child, ChildStdin, ChildStdout},
};

#[cfg(unix)]
use std::os::fd::AsRawFd;

const REGISTRY_FILE_NAME: &str = "registry.v1.json";
const DEFAULT_MCP_TIMEOUT_MS: u64 = 30_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub(crate) enum McpTransportConfig {
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
    },
    Http {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
    Sse {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
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
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) transport: McpTransportConfig,
    #[serde(default = "default_true")]
    pub(crate) enabled: bool,
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
}

struct StdioMcpClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    next_id: i64,
}

struct HttpMcpClient {
    client: Client,
    url: String,
    headers: BTreeMap<String, String>,
    session_id: Option<String>,
    next_id: i64,
}

impl Drop for StdioMcpClient {
    fn drop(&mut self) {
        lyra_process_lifecycle_core::terminate_process_tree(self.child.id(), false);
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl StdioMcpClient {
    fn spawn(server: &McpServerConfig) -> AgentRuntimeResult<Self> {
        let McpTransportConfig::Stdio { command, args, env } = &server.transport else {
            return Err(AgentRuntimeError::Core(format!(
                "MCP server {} uses a remote transport that is not supported yet",
                server.id
            )));
        };
        if command.trim().is_empty() {
            return Err(AgentRuntimeError::Core(format!(
                "MCP server {} is missing command",
                server.id
            )));
        }
        let mut command_builder = Command::new(command);
        command_builder
            .args(args)
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        lyra_process_lifecycle_core::configure_daemon_child_command(&mut command_builder);
        let mut child = command_builder
            .spawn()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let child_pid = child.id();
        lyra_process_lifecycle_core::spawn_parent_death_watcher(child_pid, true);
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AgentRuntimeError::Core("MCP server stdin unavailable".to_string()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AgentRuntimeError::Core("MCP server stdout unavailable".to_string()))?;
        set_nonblocking(&stdout).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let mut client = Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        };
        client.handshake(Duration::from_millis(DEFAULT_MCP_TIMEOUT_MS))?;
        Ok(client)
    }

    fn handshake(&mut self, timeout: Duration) -> AgentRuntimeResult<()> {
        let _ = self.request(
            "initialize",
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "lyra", "version": "0.1.0" }
            }),
            timeout,
        )?;
        self.send(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized",
            "params": {}
        }))?;
        Ok(())
    }

    fn list_tools(&mut self, timeout: Duration) -> AgentRuntimeResult<Vec<McpToolInfo>> {
        let mut cursor = Option::<String>::None;
        let mut tools = Vec::new();
        loop {
            let params = cursor
                .as_ref()
                .map(|value| json!({ "cursor": value }))
                .unwrap_or_else(|| json!({}));
            let result = self.request("tools/list", params, timeout)?;
            tools.extend(parse_mcp_tools(&result));
            cursor = result
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
        Ok(tools)
    }

    fn call_tool(
        &mut self,
        name: &str,
        arguments: Value,
        timeout: Duration,
    ) -> AgentRuntimeResult<Value> {
        self.request(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
            timeout,
        )
    }

    fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> AgentRuntimeResult<Value> {
        let request_id = self.next_id;
        self.next_id += 1;
        self.send(&json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }))?;
        loop {
            let response = self.recv(timeout)?;
            if response.get("id").and_then(Value::as_i64) != Some(request_id) {
                continue;
            }
            if let Some(error) = response.get("error") {
                return Err(AgentRuntimeError::Core(format!(
                    "MCP {method} failed: {error}"
                )));
            }
            return Ok(response.get("result").cloned().unwrap_or_else(|| json!({})));
        }
    }

    fn send(&mut self, value: &Value) -> AgentRuntimeResult<()> {
        let body = serde_json::to_vec(value)
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        self.stdin
            .write_all(&body)
            .and_then(|_| self.stdin.write_all(b"\n"))
            .and_then(|_| self.stdin.flush())
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))
    }

    fn recv(&mut self, timeout: Duration) -> AgentRuntimeResult<Value> {
        let deadline = Instant::now() + timeout;
        loop {
            let mut line = String::new();
            match self.stdout.read_line(&mut line) {
                Ok(0) => {
                    return Err(AgentRuntimeError::Core(
                        "MCP server closed stdout".to_string(),
                    ));
                }
                Ok(_) => {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    return serde_json::from_str(trimmed)
                        .map_err(|error| AgentRuntimeError::Core(error.to_string()));
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                    if Instant::now() >= deadline {
                        return Err(AgentRuntimeError::Core("MCP server timed out".to_string()));
                    }
                    thread::sleep(Duration::from_millis(20));
                }
                Err(error) => return Err(AgentRuntimeError::Core(error.to_string())),
            }
        }
    }
}

impl HttpMcpClient {
    fn connect(server: &McpServerConfig, timeout: Duration) -> AgentRuntimeResult<Self> {
        let (url, headers) = match &server.transport {
            McpTransportConfig::Http { url, headers }
            | McpTransportConfig::Sse { url, headers } => (url.clone(), headers.clone()),
            McpTransportConfig::Stdio { .. } => {
                return Err(AgentRuntimeError::Core(format!(
                    "MCP server {} is not a remote server",
                    server.id
                )));
            }
        };
        let client = Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        let mut client = Self {
            client,
            url,
            headers,
            session_id: None,
            next_id: 1,
        };
        client.handshake(timeout)?;
        Ok(client)
    }

    fn handshake(&mut self, timeout: Duration) -> AgentRuntimeResult<()> {
        let _ = self.request(
            "initialize",
            json!({
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "lyra", "version": "0.1.0" }
            }),
            timeout,
        )?;
        self.notify("notifications/initialized", json!({}), timeout)
    }

    fn list_tools(&mut self, timeout: Duration) -> AgentRuntimeResult<Vec<McpToolInfo>> {
        let mut cursor = Option::<String>::None;
        let mut tools = Vec::new();
        loop {
            let params = cursor
                .as_ref()
                .map(|value| json!({ "cursor": value }))
                .unwrap_or_else(|| json!({}));
            let result = self.request("tools/list", params, timeout)?;
            tools.extend(parse_mcp_tools(&result));
            cursor = result
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
        Ok(tools)
    }

    fn call_tool(
        &mut self,
        name: &str,
        arguments: Value,
        timeout: Duration,
    ) -> AgentRuntimeResult<Value> {
        self.request(
            "tools/call",
            json!({ "name": name, "arguments": arguments }),
            timeout,
        )
    }

    fn notify(&mut self, method: &str, params: Value, timeout: Duration) -> AgentRuntimeResult<()> {
        let _ = self.send_json(
            &json!({
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
            }),
            timeout,
        )?;
        Ok(())
    }

    fn request(
        &mut self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> AgentRuntimeResult<Value> {
        let request_id = self.next_id;
        self.next_id += 1;
        let responses = self.send_json(
            &json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": method,
                "params": params,
            }),
            timeout,
        )?;
        for response in responses {
            if response.get("id").and_then(Value::as_i64) != Some(request_id) {
                continue;
            }
            if let Some(error) = response.get("error") {
                return Err(AgentRuntimeError::Core(format!(
                    "MCP {method} failed: {error}"
                )));
            }
            return Ok(response.get("result").cloned().unwrap_or_else(|| json!({})));
        }
        Err(AgentRuntimeError::Core(format!(
            "MCP {method} returned no matching response"
        )))
    }

    fn send_json(&mut self, value: &Value, timeout: Duration) -> AgentRuntimeResult<Vec<Value>> {
        let mut request = self
            .client
            .post(&self.url)
            .timeout(timeout)
            .header(ACCEPT, "application/json, text/event-stream")
            .header(CONTENT_TYPE, "application/json")
            .json(value);
        for (key, value) in &self.headers {
            let name = HeaderName::from_bytes(key.as_bytes())
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
            let value = HeaderValue::from_str(value)
                .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
            request = request.header(name, value);
        }
        if let Some(session_id) = &self.session_id {
            request = request.header("Mcp-Session-Id", session_id);
        }
        let response = request
            .send()
            .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
        parse_http_mcp_response(response, &mut self.session_id)
    }
}

fn default_true() -> bool {
    true
}

fn default_disconnected() -> String {
    "disconnected".to_string()
}

#[cfg(unix)]
fn set_nonblocking<T: AsRawFd>(io: &T) -> io::Result<()> {
    let fd = io.as_raw_fd();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    let result = unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) };
    if result < 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(unix))]
fn set_nonblocking<T>(_io: &T) -> io::Result<()> {
    Ok(())
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
    root.parent()
        .map(|parent| parent.join("mcp"))
        .unwrap_or_else(|| root.join("mcp"))
}

fn registry_path(storage_root: &Path) -> PathBuf {
    storage_root.join(REGISTRY_FILE_NAME)
}

fn read_registry_from(storage_root: &Path) -> McpRegistryDocument {
    read_json::<McpRegistryDocument>(&registry_path(storage_root)).unwrap_or_default()
}

fn write_registry_to(
    storage_root: &Path,
    registry: &McpRegistryDocument,
) -> AgentRuntimeResult<()> {
    fs::create_dir_all(storage_root).map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    write_json(&registry_path(storage_root), registry)
}

fn read_registry() -> McpRegistryDocument {
    read_registry_from(&mcp_storage_root())
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

fn transport_label(transport: &McpTransportConfig) -> String {
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
        "lastError": server.last_error,
        "createdAt": server.created_at,
        "updatedAt": server.updated_at,
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
    if let Some(command) = string_field(value, &["command", "cmd"]) {
        return Ok(McpServerDraft {
            id,
            name,
            enabled,
            transport: McpTransportConfig::Stdio {
                command,
                args: parse_string_array(value.get("args").or_else(|| value.get("arguments"))),
                env: parse_string_map(value.get("env")),
            },
        });
    }
    if let Some(url) = url {
        let headers = parse_string_map(value.get("headers"));
        let transport = if transport_kind == "sse" {
            McpTransportConfig::Sse { url, headers }
        } else {
            McpTransportConfig::Http { url, headers }
        };
        return Ok(McpServerDraft {
            id,
            name,
            enabled,
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
            transport: McpTransportConfig::Http {
                url: text.to_string(),
                headers: BTreeMap::new(),
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
        transport: McpTransportConfig::Stdio {
            command,
            args: parts.into_iter().skip(1).collect(),
            env: BTreeMap::new(),
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

fn preserve_existing_secrets(
    mut transport: McpTransportConfig,
    existing: Option<&McpServerConfig>,
) -> McpTransportConfig {
    match (&mut transport, existing.map(|server| &server.transport)) {
        (
            McpTransportConfig::Stdio { env, .. },
            Some(McpTransportConfig::Stdio {
                env: existing_env, ..
            }),
        ) => preserve_redacted_values(env, existing_env),
        (
            McpTransportConfig::Http { headers, .. } | McpTransportConfig::Sse { headers, .. },
            Some(McpTransportConfig::Http {
                headers: existing_headers,
                ..
            })
            | Some(McpTransportConfig::Sse {
                headers: existing_headers,
                ..
            }),
        ) => preserve_redacted_values(headers, existing_headers),
        _ => {}
    }
    transport
}

fn upsert_mcp_servers_at(storage_root: &Path, payload: Value) -> AgentRuntimeResult<Value> {
    let drafts = parse_server_drafts(&payload)?;
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
            id: id.clone(),
            name,
            transport,
            enabled: draft.enabled,
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

pub(crate) fn mcp_list(_payload: Value) -> AgentRuntimeResult<Value> {
    let registry = read_registry();
    Ok(json!({
        "servers": registry.servers.iter().map(server_value).collect::<Vec<_>>(),
        "storageRoot": mcp_storage_root(),
    }))
}

pub(crate) fn mcp_server_upsert(payload: Value) -> AgentRuntimeResult<Value> {
    upsert_mcp_servers_at(&mcp_storage_root(), payload)
}

pub(crate) fn mcp_server_remove(payload: Value) -> AgentRuntimeResult<Value> {
    let server_id = string_field(&payload, &["serverId", "id", "name"])
        .map(|value| slugify_id(&value))
        .ok_or_else(|| AgentRuntimeError::Core("serverId is required".to_string()))?;
    let mut registry = read_registry();
    let before = registry.servers.len();
    registry.servers.retain(|server| server.id != server_id);
    write_registry(&registry)?;
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

fn parse_mcp_tools(result: &Value) -> Vec<McpToolInfo> {
    result
        .get("tools")
        .and_then(Value::as_array)
        .map(|tools| {
            tools
                .iter()
                .filter_map(|tool| {
                    let name = tool.get("name").and_then(Value::as_str)?.to_string();
                    Some(McpToolInfo {
                        name,
                        description: tool
                            .get("description")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        input_schema: tool.get("inputSchema").cloned(),
                        output_schema: tool.get("outputSchema").cloned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_http_mcp_response(
    response: Response,
    session_id: &mut Option<String>,
) -> AgentRuntimeResult<Vec<Value>> {
    if let Some(value) = response
        .headers()
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
    {
        *session_id = Some(value.to_string());
    }
    let status = response.status();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let body = response
        .text()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if status.as_u16() == 202 || status.as_u16() == 204 {
        return Ok(Vec::new());
    }
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "MCP HTTP request failed: {status} {body}"
        )));
    }
    parse_http_mcp_body(&content_type, &body)
}

fn parse_http_mcp_body(content_type: &str, body: &str) -> AgentRuntimeResult<Vec<Value>> {
    if content_type.contains("text/event-stream")
        || body.lines().any(|line| line.starts_with("data:"))
    {
        return parse_sse_json_events(body);
    }
    let value = serde_json::from_str::<Value>(body)
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    Ok(match value {
        Value::Array(values) => values,
        value => vec![value],
    })
}

fn parse_sse_json_events(body: &str) -> AgentRuntimeResult<Vec<Value>> {
    let mut values = Vec::new();
    let mut data = String::new();
    for line in body.lines().chain(std::iter::once("")) {
        let line = line.strip_prefix('\u{feff}').unwrap_or(line);
        if line.trim().is_empty() {
            let text = data.trim();
            if !text.is_empty() && text != "[DONE]" {
                values.push(
                    serde_json::from_str::<Value>(text)
                        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?,
                );
            }
            data.clear();
            continue;
        }
        if let Some(rest) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(rest.trim_start());
        }
    }
    Ok(values)
}

fn timeout_from_payload(payload: &Value) -> Duration {
    let ms = payload
        .get("timeoutMs")
        .and_then(Value::as_u64)
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
    match &server.transport {
        McpTransportConfig::Stdio { .. } => {
            let mut client = StdioMcpClient::spawn(server)?;
            client.list_tools(timeout)
        }
        McpTransportConfig::Http { .. } | McpTransportConfig::Sse { .. } => {
            let mut client = HttpMcpClient::connect(server, timeout)?;
            client.list_tools(timeout)
        }
    }
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

fn connect_servers(payload: Value) -> AgentRuntimeResult<Value> {
    let timeout = timeout_from_payload(&payload);
    let requested_ids = server_ids_from_payload(&payload);
    let registry = read_registry();
    let targets = registry
        .servers
        .iter()
        .filter(|server| requested_ids.is_empty() || requested_ids.contains(&server.id))
        .filter(|server| server.enabled)
        .cloned()
        .collect::<Vec<_>>();
    if targets.is_empty() {
        return Err(AgentRuntimeError::Core(
            "No enabled MCP servers matched the request".to_string(),
        ));
    }
    let mut results = Vec::new();
    for target in targets {
        let result = match probe_server(&target, timeout) {
            Ok(tools) => update_server(&target.id, |server| {
                server.state = "connected".to_string();
                server.tools = tools.clone();
                server.last_error = None;
                Ok(())
            }),
            Err(error) => update_server(&target.id, |server| {
                server.state = "failed".to_string();
                server.last_error = Some(error.to_string());
                Ok(())
            }),
        }?;
        results.push(server_value(&result));
    }
    Ok(json!({ "servers": results }))
}

pub(crate) fn mcp_server_connect(payload: Value) -> AgentRuntimeResult<Value> {
    connect_servers(payload)
}

pub(crate) fn mcp_server_reload(payload: Value) -> AgentRuntimeResult<Value> {
    connect_servers(payload)
}

pub(crate) fn mcp_server_disconnect(payload: Value) -> AgentRuntimeResult<Value> {
    let ids = server_ids_from_payload(&payload);
    if ids.is_empty() {
        return Err(AgentRuntimeError::Core("serverId is required".to_string()));
    }
    let mut servers = Vec::new();
    for server_id in ids {
        let server = update_server(&server_id, |server| {
            server.state = "disconnected".to_string();
            Ok(())
        })?;
        servers.push(server_value(&server));
    }
    Ok(json!({ "servers": servers }))
}

fn refresh_server_tools_if_needed(server: McpServerConfig, timeout: Duration) -> McpServerConfig {
    if !server.enabled || (!server.tools.is_empty() && server.state == "connected") {
        return server;
    }
    match probe_server(&server, timeout) {
        Ok(tools) => update_server(&server.id, |stored| {
            stored.state = "connected".to_string();
            stored.tools = tools.clone();
            stored.last_error = None;
            Ok(())
        })
        .unwrap_or(server),
        Err(error) => update_server(&server.id, |stored| {
            stored.state = "failed".to_string();
            stored.last_error = Some(error.to_string());
            Ok(())
        })
        .unwrap_or(server),
    }
}

pub(crate) fn mcp_tool_discover(payload: Value) -> AgentRuntimeResult<Value> {
    let timeout = timeout_from_payload(&payload);
    let query = string_field(&payload, &["query", "q"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let requested_ids = server_ids_from_payload(&payload);
    let registry = read_registry();
    let mut matches = Vec::new();
    let mut servers = Vec::new();
    for server in registry.servers {
        if !requested_ids.is_empty() && !requested_ids.contains(&server.id) {
            continue;
        }
        let server = refresh_server_tools_if_needed(server, timeout);
        for tool in &server.tools {
            let haystack =
                format!("{} {} {}", server.name, tool.name, tool.description).to_ascii_lowercase();
            if query.is_empty() || haystack.contains(&query) {
                matches.push(json!({
                    "serverId": server.id,
                    "serverName": server.name,
                    "name": tool.name,
                    "description": tool.description,
                }));
            }
        }
        servers.push(server_value(&server));
    }
    Ok(json!({
        "query": query,
        "tools": matches,
        "servers": servers,
    }))
}

pub(crate) fn mcp_tool_inspect(payload: Value) -> AgentRuntimeResult<Value> {
    let server_id = string_field(&payload, &["serverId", "id", "name"])
        .map(|value| slugify_id(&value))
        .ok_or_else(|| AgentRuntimeError::Core("serverId is required".to_string()))?;
    let tool_name = string_field(&payload, &["toolName", "tool", "name"])
        .ok_or_else(|| AgentRuntimeError::Core("toolName is required".to_string()))?;
    let timeout = timeout_from_payload(&payload);
    let server = read_registry()
        .servers
        .into_iter()
        .find(|server| server.id == server_id)
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!("MCP server is not configured: {server_id}"))
        })?;
    let server = refresh_server_tools_if_needed(server, timeout);
    let tool = server
        .tools
        .iter()
        .find(|tool| tool.name == tool_name)
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!("MCP tool not found: {server_id}/{tool_name}"))
        })?;
    Ok(json!({ "server": server_value(&server), "tool": tool }))
}

pub(crate) fn mcp_tool_execute(payload: Value) -> AgentRuntimeResult<Value> {
    let server_id = string_field(&payload, &["serverId", "id", "name"])
        .map(|value| slugify_id(&value))
        .ok_or_else(|| AgentRuntimeError::Core("serverId is required".to_string()))?;
    let tool_name = string_field(&payload, &["toolName", "tool"])
        .ok_or_else(|| AgentRuntimeError::Core("toolName is required".to_string()))?;
    let arguments = payload
        .get("arguments")
        .or_else(|| payload.get("input"))
        .or_else(|| payload.get("payload"))
        .cloned()
        .unwrap_or_else(|| json!({}));
    let timeout = timeout_from_payload(&payload);
    let server = read_registry()
        .servers
        .into_iter()
        .find(|server| server.id == server_id)
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!("MCP server is not configured: {server_id}"))
        })?;
    if !server.enabled {
        return Err(AgentRuntimeError::Core(format!(
            "MCP server is disabled: {server_id}"
        )));
    }
    let result = match &server.transport {
        McpTransportConfig::Stdio { .. } => {
            let mut client = StdioMcpClient::spawn(&server)?;
            client.call_tool(&tool_name, arguments, timeout)
        }
        McpTransportConfig::Http { .. } | McpTransportConfig::Sse { .. } => {
            let mut client = HttpMcpClient::connect(&server, timeout)?;
            client.call_tool(&tool_name, arguments, timeout)
        }
    };
    match result {
        Ok(value) => {
            let _ = update_server(&server_id, |server| {
                server.state = "connected".to_string();
                server.last_error = None;
                Ok(())
            });
            Ok(json!({
                "serverId": server_id,
                "toolName": tool_name,
                "result": value,
            }))
        }
        Err(error) => {
            let _ = update_server(&server_id, |server| {
                server.state = "failed".to_string();
                server.last_error = Some(error.to_string());
                Ok(())
            });
            Err(error)
        }
    }
}

pub(crate) fn execute_mcp_state_change(name: &str, input: &Value) -> Result<Value, String> {
    let result = match name {
        "mcp_server_list" => mcp_list(input.clone()),
        "mcp_server_upsert" => mcp_server_upsert(input.clone()),
        "mcp_server_remove" => mcp_server_remove(input.clone()),
        "mcp_server_connect" => mcp_server_connect(input.clone()),
        "mcp_server_disconnect" => mcp_server_disconnect(input.clone()),
        "mcp_server_reload" => mcp_server_reload(input.clone()),
        "mcp_tool_discover" => mcp_tool_discover(input.clone()),
        "mcp_tool_inspect" => mcp_tool_inspect(input.clone()),
        "mcp_tool_execute" => mcp_tool_execute(input.clone()),
        _ => Err(AgentRuntimeError::Core(format!(
            "Unknown Lyra MCP tool: {name}"
        ))),
    };
    result.map_err(|error| error.to_string())
}

pub(crate) fn format_mcp_output(action: &str, value: &Value) -> String {
    match action {
        "server_list" => {
            let servers = value
                .get("servers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if servers.is_empty() {
                return "No MCP servers are configured.".to_string();
            }
            format!(
                "Configured {} MCP server(s):\n{}",
                servers.len(),
                servers
                    .iter()
                    .take(10)
                    .map(format_mcp_server_line)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
        "server_upsert" => {
            let servers = value
                .get("servers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            format!(
                "Saved {} MCP server config(s):\n{}",
                servers.len(),
                servers
                    .iter()
                    .take(10)
                    .map(format_mcp_server_line)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
        "server_remove" => {
            let server_id = value
                .get("serverId")
                .and_then(Value::as_str)
                .unwrap_or("server");
            let removed = value
                .get("removed")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            format!("Removed MCP server {server_id}: removed={removed}")
        }
        "server_connect" | "server_reload" | "server_disconnect" => {
            let servers = value
                .get("servers")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            format!(
                "Updated {} MCP server(s):\n{}",
                servers.len(),
                servers
                    .iter()
                    .take(10)
                    .map(format_mcp_server_line)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
        "tool_discover" => {
            let tools = value
                .get("tools")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if tools.is_empty() {
                return "No MCP tools matched.".to_string();
            }
            format!(
                "Discovered {} MCP tool(s):\n{}",
                tools.len(),
                tools
                    .iter()
                    .take(12)
                    .map(format_mcp_tool_line)
                    .collect::<Vec<_>>()
                    .join("\n")
            )
        }
        "tool_inspect" => {
            let server_id = value
                .pointer("/server/id")
                .and_then(Value::as_str)
                .unwrap_or("server");
            let tool = value.get("tool").unwrap_or(&Value::Null);
            let name = tool.get("name").and_then(Value::as_str).unwrap_or("tool");
            let description = tool
                .get("description")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let schema = tool
                .get("inputSchema")
                .or_else(|| tool.get("input_schema"))
                .cloned()
                .unwrap_or_else(|| json!({}));
            format!(
                "MCP tool {server_id}/{name}\ndescription: {description}\ninputSchema: {schema}"
            )
        }
        "tool_execute" => {
            let server_id = value
                .get("serverId")
                .and_then(Value::as_str)
                .unwrap_or("server");
            let tool_name = value
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let result = value.get("result").cloned().unwrap_or_else(|| json!({}));
            let summary = summarize_mcp_result(&result);
            format!("Executed MCP tool {server_id}/{tool_name}:\n{summary}")
        }
        _ => serde_json::to_string_pretty(value).unwrap_or_default(),
    }
}

fn format_mcp_server_line(server: &Value) -> String {
    let id = server
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let name = server.get("name").and_then(Value::as_str).unwrap_or(id);
    let state = server
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let enabled = server
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let tool_count = server.get("toolCount").and_then(Value::as_u64).unwrap_or(0);
    let transport = server
        .get("transportSummary")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let error = server
        .get("lastError")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let suffix = if error.is_empty() {
        String::new()
    } else {
        format!(" error={error}")
    };
    format!(
        "- {id} ({name}) enabled={enabled} state={state} tools={tool_count} transport={transport}{suffix}"
    )
}

fn format_mcp_tool_line(tool: &Value) -> String {
    let server_id = tool
        .get("serverId")
        .and_then(Value::as_str)
        .unwrap_or("server");
    let name = tool.get("name").and_then(Value::as_str).unwrap_or("tool");
    let description = tool
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or_default();
    format!("- {server_id}/{name}: {description}")
}

fn summarize_mcp_result(result: &Value) -> String {
    if let Some(content) = result.get("content").and_then(Value::as_array) {
        let lines = content
            .iter()
            .take(6)
            .filter_map(|item| {
                item.get("text")
                    .and_then(Value::as_str)
                    .map(|text| text.chars().take(1200).collect::<String>())
                    .or_else(|| {
                        item.get("type")
                            .and_then(Value::as_str)
                            .map(|kind| format!("[{kind}]"))
                    })
            })
            .collect::<Vec<_>>();
        if !lines.is_empty() {
            return lines.join("\n");
        }
    }
    serde_json::to_string_pretty(result)
        .unwrap_or_default()
        .chars()
        .take(4000)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mcp_servers_json_shape() {
        let value = json!({
            "mcpServers": {
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                    "env": { "TOKEN": "secret" }
                }
            }
        });
        let drafts = parse_server_drafts(&value).expect("parse");
        assert_eq!(drafts.len(), 1);
        assert_eq!(drafts[0].id.as_deref(), Some("filesystem"));
        match &drafts[0].transport {
            McpTransportConfig::Stdio { command, args, env } => {
                assert_eq!(command, "npx");
                assert_eq!(args[1], "@modelcontextprotocol/server-filesystem");
                assert_eq!(env.get("TOKEN").map(String::as_str), Some("secret"));
            }
            _ => panic!("expected stdio"),
        }
    }

    #[test]
    fn parses_plain_command_line() {
        let drafts = parse_text_server("uvx mcp-server-git --repository /repo").expect("parse");
        match &drafts[0].transport {
            McpTransportConfig::Stdio { command, args, .. } => {
                assert_eq!(command, "uvx");
                assert_eq!(args, &vec!["mcp-server-git", "--repository", "/repo"]);
            }
            _ => panic!("expected stdio"),
        }
    }

    #[test]
    fn upsert_writes_registry_and_redacts_env() {
        let temp = tempfile::tempdir().expect("tempdir");
        let result = upsert_mcp_servers_at(
            temp.path(),
            json!({
                "id": "test",
                "name": "Test MCP",
                "command": "node",
                "args": ["server.js"],
                "env": { "API_KEY": "secret" }
            }),
        )
        .expect("upsert");
        assert_eq!(
            result.pointer("/server/id").and_then(Value::as_str),
            Some("test")
        );
        assert_eq!(
            result
                .pointer("/server/transport/env/API_KEY")
                .and_then(Value::as_str),
            Some("<configured>")
        );
        let registry = read_registry_from(temp.path());
        assert_eq!(registry.servers.len(), 1);
        match &registry.servers[0].transport {
            McpTransportConfig::Stdio { env, .. } => {
                assert_eq!(env.get("API_KEY").map(String::as_str), Some("secret"));
            }
            _ => panic!("expected stdio"),
        }
    }

    #[test]
    fn upsert_preserves_redacted_env_placeholders() {
        let temp = tempfile::tempdir().expect("tempdir");
        let _ = upsert_mcp_servers_at(
            temp.path(),
            json!({
                "id": "git",
                "name": "Git",
                "command": "uvx",
                "args": ["mcp-server-git"],
                "env": { "TOKEN": "secret" }
            }),
        )
        .expect("initial upsert");
        let _ = upsert_mcp_servers_at(
            temp.path(),
            json!({
                "serverId": "git",
                "name": "Git Tools",
                "command": "uvx",
                "args": "mcp-server-git --repository /repo",
                "env": "TOKEN=<configured>\nDEBUG=1"
            }),
        )
        .expect("edit upsert");
        let registry = read_registry_from(temp.path());
        match &registry.servers[0].transport {
            McpTransportConfig::Stdio { env, .. } => {
                assert_eq!(env.get("TOKEN").map(String::as_str), Some("secret"));
                assert_eq!(env.get("DEBUG").map(String::as_str), Some("1"));
            }
            _ => panic!("expected stdio"),
        }
    }

    #[test]
    fn parses_streamable_http_sse_response() {
        let values = parse_http_mcp_body(
            "text/event-stream",
            "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[]}}\n\n",
        )
        .expect("parse");
        assert_eq!(values[0].get("id").and_then(Value::as_i64), Some(1));
    }
}
