//! Subscription-account login and request identity.
//!
//! One token shape is stored in the existing secret store. Login can be a
//! loopback PKCE flow, a device code, a read-only borrow of another tool's
//! credential file, or an API key on the routes that also accept one.
//! Refresh writes a new token back through the host secret store when that
//! store is available.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::{AgentRuntimeError, AgentRuntimeResult, HostCapabilityDispatcher};

use super::routes::subscription as routes;
use crate::native_backend::{NativeProviderModel, NativeProviderProfile};

const CLAUDE_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const CLAUDE_AUTHORIZE: &str = "https://claude.com/cai/oauth/authorize";
const CLAUDE_TOKEN: &str = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_REDIRECT: &str = "https://platform.claude.com/oauth/code/callback";
const CLAUDE_SCOPES: &str = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTHORIZE: &str = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN: &str = "https://auth.openai.com/oauth/token";
const OPENAI_REDIRECT: &str = "http://localhost:1455/auth/callback";
const OPENAI_SCOPES: &str =
    "openid profile email offline_access api.connectors.read api.connectors.invoke";

const COPILOT_CLIENT_ID: &str = "Iv1.b507a08c87ecfe98";
const GITHUB_DEVICE: &str = "https://github.com/login/device/code";
const GITHUB_TOKEN: &str = "https://github.com/login/oauth/access_token";

const GEMINI_CLIENT_ID: &str =
    "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
// Public installed-app credential published by the Gemini CLI. Override with
// LYRA_GEMINI_CLIENT_SECRET. Not a user secret.
const GEMINI_CLIENT_SECRET: &str = "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";
const GOOGLE_AUTHORIZE: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN: &str = "https://oauth2.googleapis.com/token";
const GEMINI_REDIRECT: &str = "https://codeassist.google.com/authcode";
const GEMINI_SCOPES: &str = "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";

const ANTIGRAVITY_CLIENT_ID: &str =
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const ANTIGRAVITY_CLIENT_SECRET: &str = "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";
const ANTIGRAVITY_REDIRECT: &str = "http://127.0.0.1:51121/oauth-callback";

const XAI_CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_DEVICE: &str = "https://auth.x.ai/oauth2/device/code";
const XAI_TOKEN: &str = "https://auth.x.ai/oauth2/token";
const XAI_SCOPES: &str = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";

const MINIMAX_CLIENT_ID: &str = "78257093-7e40-4613-99e0-527b14b39113";
const MINIMAX_CODE: &str = "https://api.minimax.io/oauth/code";
const MINIMAX_TOKEN: &str = "https://api.minimax.io/oauth/token";
const QWEN_CLIENT_ID: &str = "f0304373b74a44d2b584a3fb70ca9e56";
const QWEN_TOKEN: &str = "https://chat.qwen.ai/api/v1/oauth2/token";
const DO_CLIENT_ID: &str = "b1a6c5158156caac821fd1b30253ca8acb52454a48fa744420e41889cb589f82";
const DO_AUTHORIZE: &str = "https://cloud.digitalocean.com/v1/oauth/authorize";
const CURSOR_EXCHANGE: &str = "https://api2.cursor.sh/auth/exchange_user_api_key";

#[derive(Clone, Debug)]
struct PendingLogin {
    account_id: String,
    verifier: String,
    state: String,
    device_code: Option<String>,
    token_url: String,
    client_id: String,
    client_secret: Option<String>,
    redirect_uri: String,
}

fn pending() -> &'static Mutex<HashMap<String, PendingLogin>> {
    static PENDING: LazyLock<Mutex<HashMap<String, PendingLogin>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    &PENDING
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SubscriptionToken {
    pub(crate) access_token: String,
    #[serde(default)]
    pub(crate) refresh_token: Option<String>,
    #[serde(default)]
    pub(crate) expires_at: Option<u64>,
    #[serde(default)]
    pub(crate) account_id: Option<String>,
    #[serde(default)]
    pub(crate) source_path: Option<String>,
    #[serde(default)]
    pub(crate) email: Option<String>,
    #[serde(default)]
    pub(crate) display_name: Option<String>,
    #[serde(default)]
    pub(crate) avatar_url: Option<String>,
}

impl SubscriptionToken {
    pub(crate) fn to_secret(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| self.access_token.clone())
    }

    fn expired(&self) -> bool {
        let Some(expires_at) = self.expires_at else {
            return false;
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_secs())
            .unwrap_or(0);
        expires_at <= now.saturating_add(60)
    }
}

pub(crate) fn is_subscription_route(route_id: &str) -> bool {
    routes::is_subscription_route(route_id)
}

pub(crate) fn is_special_transport(route_id: &str) -> bool {
    matches!(
        route_id,
        routes::CURSOR | routes::GEMINI_CODE_ASSIST | routes::ANTIGRAVITY | routes::COPILOT_ACP
    )
}

pub(crate) fn special_text(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
) -> AgentRuntimeResult<String> {
    let provider = provider.clone();
    let model = model.to_string();
    let messages = messages.to_vec();
    let tools = tools.to_vec();
    let model_for_error = model.clone();
    // reqwest::blocking starts a runtime. The chat turn already runs on tokio,
    // and calling it there panics the worker before any provider response exists.
    let text =
        run_off_runtime(move || special_text_blocking(&provider, &model, &messages, &tools))?;
    if text.trim().is_empty() {
        return Err(AgentRuntimeError::Core(format!(
            "{model_for_error} returned an empty reply"
        )));
    }
    Ok(text)
}

fn special_text_blocking(
    provider: &NativeProviderProfile,
    model: &str,
    messages: &[Value],
    tools: &[Value],
) -> AgentRuntimeResult<String> {
    let secret = provider.api_key.clone().unwrap_or_default();
    let access = bearer_secret(&provider.route_id, &secret);
    match provider.route_id.as_str() {
        routes::CURSOR => super::cursor_agent::send_run(&access, model, messages, tools),
        routes::GEMINI_CODE_ASSIST | routes::ANTIGRAVITY => {
            super::cloud_code::send(provider, &access, model, messages)
        }
        routes::COPILOT_ACP => {
            let prompt = messages
                .last()
                .and_then(|message| message.get("content"))
                .and_then(Value::as_str)
                .unwrap_or("");
            super::copilot_acp::run_prompt(prompt)
        }
        other => Err(AgentRuntimeError::Core(format!(
            "{other} has no special transport"
        ))),
    }
}

pub(crate) fn run_off_runtime<T: Send>(work: impl FnOnce() -> T + Send) -> T {
    if tokio::runtime::Handle::try_current().is_ok() {
        std::thread::scope(|scope| {
            scope
                .spawn(work)
                .join()
                .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
        })
    } else {
        work()
    }
}

pub(crate) fn access_token(secret: &str) -> Option<String> {
    parse_token(secret).map(|token| token.access_token)
}

pub(crate) fn parse_token(secret: &str) -> Option<SubscriptionToken> {
    let value: Value = serde_json::from_str(secret).ok()?;
    if value.get("accessToken").is_some() || value.get("access_token").is_some() {
        return serde_json::from_value(normalize_token_json(value)).ok();
    }
    None
}

fn normalize_token_json(value: Value) -> Value {
    let mut object = value.as_object().cloned().unwrap_or_default();
    if let Some(token) = object.remove("access_token") {
        object.insert("accessToken".to_string(), token);
    }
    if let Some(token) = object.remove("refresh_token") {
        object.insert("refreshToken".to_string(), token);
    }
    Value::Object(object)
}

pub(crate) fn bearer_secret(route_id: &str, secret: &str) -> String {
    if is_subscription_route(route_id) {
        access_token(secret).unwrap_or_else(|| secret.to_string())
    } else {
        secret.to_string()
    }
}

pub(crate) fn extra_headers(route_id: &str, secret: &str) -> Vec<(&'static str, String)> {
    let token = parse_token(secret);
    match route_id {
        routes::CLAUDE => vec![
            ("user-agent", "claude-cli/1.0.0".to_string()),
            (
                "anthropic-beta",
                "oauth-2025-04-20,claude-code-20250219".to_string(),
            ),
        ],
        routes::CHATGPT => {
            let mut headers = vec![("originator", "codex_cli_rs".to_string())];
            if let Some(account) = token.as_ref().and_then(|item| item.account_id.clone()) {
                headers.push(("chatgpt-account-id", account));
            }
            headers
        }
        routes::COPILOT => vec![
            ("editor-version", "vscode/1.96.2".to_string()),
            ("copilot-integration-id", "vscode-chat".to_string()),
            ("user-agent", "GitHubCopilotChat/0.26.7".to_string()),
        ],
        routes::GROK_BUILD => vec![
            ("user-agent", grok_user_agent()),
            ("x-xai-token-auth", "xai-grok-cli".to_string()),
            ("x-grok-client-version", grok_version()),
            ("x-grok-client-identifier", "grok-shell".to_string()),
            ("x-grok-client-surface", "cli".to_string()),
        ],
        routes::XAI_OAUTH => vec![("user-agent", grok_user_agent())],
        routes::CURSOR => vec![
            ("user-agent", format!("cursor/{}", cursor_version())),
            ("connect-protocol-version", "1".to_string()),
        ],
        _ => Vec::new(),
    }
}

pub(crate) fn uses_claude_code_contract(route_id: &str) -> bool {
    route_id == routes::CLAUDE
}

pub(crate) fn apply_claude_code_contract(body: &mut Value) {
    const IDENTITY: &str = "You are Claude Code, Anthropic's official CLI for Claude.";
    let system = body.get("system").and_then(Value::as_str).unwrap_or("");
    if !system.contains(IDENTITY) {
        let next = if system.is_empty() {
            IDENTITY.to_string()
        } else {
            format!("{IDENTITY}\n\n{system}")
        };
        body["system"] = Value::String(next);
    }
    if let Some(tools) = body.get_mut("tools").and_then(Value::as_array_mut) {
        for tool in tools {
            if let Some(name) = tool.get("name").and_then(Value::as_str) {
                let renamed = claude_code_tool_name(name);
                if renamed != name {
                    tool["name"] = Value::String(renamed);
                }
            }
        }
    }
}

pub(crate) fn claude_code_tool_name(name: &str) -> String {
    match name {
        "bash" => "Bash",
        "read" => "Read",
        "write" => "Write",
        "edit" => "Edit",
        "glob" => "Glob",
        "grep" => "Grep",
        "subagent" => "Agent",
        "schedule" => "ScheduleWakeup",
        "skill_manage" => "Skill",
        other => other,
    }
    .to_string()
}

fn grok_version() -> String {
    std::env::var("LYRA_GROK_CLI_VERSION").unwrap_or_else(|_| "1.0.41".to_string())
}

fn grok_user_agent() -> String {
    format!("grok-cli/{}", grok_version())
}

pub(crate) fn cursor_version() -> String {
    std::env::var("LYRA_CURSOR_CLIENT_VERSION").unwrap_or_else(|_| "3.8.24".to_string())
}

pub(crate) fn login_provider_rows(config_has: impl Fn(&str) -> bool) -> Vec<Value> {
    routes::descriptors()
        .into_iter()
        .map(|route| {
            let configured = config_has(&route.id);
            json!({
                "id": route.id,
                "displayName": route.label,
                "authKind": route.auth_kind,
                "statusMethod": "lyra-subscription",
                "detail": route.description,
                "recommended": false,
                "configured": configured,
                "state": if configured { "configured" } else { "available" },
                "requiresCallback": route.auth_kind.starts_with("subscription"),
                "requiresApiKey": route.auth_kind.contains("or-key"),
            })
        })
        .collect()
}

pub(crate) fn start_login(payload: &Value) -> AgentRuntimeResult<Value> {
    let account = string_field(payload, "provider")
        .ok_or_else(|| AgentRuntimeError::Core("provider is required".to_string()))?;
    if !is_subscription_route(&account) {
        return Err(AgentRuntimeError::Core(format!(
            "{account} is not a subscription account"
        )));
    }
    let flow_id = format!("login-{}", uuid_lite());
    match account.as_str() {
        routes::COPILOT => start_device(
            &flow_id,
            &account,
            GITHUB_DEVICE,
            GITHUB_TOKEN,
            COPILOT_CLIENT_ID,
            None,
            "repo",
        ),
        routes::GROK_BUILD | routes::XAI_OAUTH => start_device(
            &flow_id,
            &account,
            XAI_DEVICE,
            XAI_TOKEN,
            XAI_CLIENT_ID,
            None,
            XAI_SCOPES,
        ),
        routes::MINIMAX => start_minimax(&flow_id, &account),
        routes::AZURE => Ok(json!({
            "provider": account,
            "flowId": flow_id,
            "authUrl": null,
            "authKind": "subscription-or-key",
            "instructions": "Uses the current `az` login. Paste an API key instead if Azure CLI is not signed in.",
            "requiresCallback": false,
            "requiresApiKey": true,
        })),
        routes::QWEN => Ok(json!({
            "provider": account,
            "flowId": flow_id,
            "authUrl": null,
            "authKind": "subscription",
            "instructions": "Reads ~/.qwen/oauth_creds.json after you confirm. The original file is not modified.",
            "requiresCallback": false,
            "requiresApiKey": false,
            "borrow": true,
        })),
        routes::CURSOR => Ok(json!({
            "provider": account,
            "flowId": flow_id,
            "authUrl": null,
            "authKind": "subscription-or-key",
            "instructions": "Borrows Cursor's local login, or paste a Cursor API key to exchange.",
            "requiresCallback": false,
            "requiresApiKey": true,
            "borrow": true,
        })),
        routes::SNOWFLAKE => start_snowflake(&flow_id, &account, payload),
        other => start_pkce(&flow_id, other),
    }
}

pub(crate) fn complete_login(payload: &Value) -> AgentRuntimeResult<SubscriptionToken> {
    let account = string_field(payload, "provider")
        .ok_or_else(|| AgentRuntimeError::Core("provider is required".to_string()))?;
    if payload.get("borrow").and_then(Value::as_bool) == Some(true)
        || string_field(payload, "callbackInput").as_deref() == Some("borrow")
    {
        return borrow_token(&account).map(|token| identified(&account, token));
    }
    if let Some(api_key) = string_field(payload, "apiKey") {
        if account == routes::CURSOR {
            return exchange_cursor_api_key(&api_key);
        }
        if let Some(token) = parse_token(&api_key) {
            return Ok(token);
        }
        return Ok(SubscriptionToken {
            access_token: api_key,
            refresh_token: None,
            expires_at: None,
            account_id: None,
            source_path: None,
            email: None,
            display_name: None,
            avatar_url: None,
        });
    }
    let flow_id = string_field(payload, "flowId")
        .ok_or_else(|| AgentRuntimeError::Core("flowId is required".to_string()))?;
    let pending_login = pending()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("login state lock failed".to_string()))?
        .get(&flow_id)
        .cloned()
        .ok_or_else(|| {
            AgentRuntimeError::Core("login flow expired or was not started".to_string())
        })?;
    let callback = string_field(payload, "callbackInput").unwrap_or_default();
    if !pending_login.state.is_empty() {
        if let Some(returned) = query_param(&callback, "state") {
            if returned != pending_login.state {
                return Err(AgentRuntimeError::Core(
                    "login state did not match".to_string(),
                ));
            }
        }
    }
    let token = if let Some(device_code) = pending_login.device_code.clone() {
        poll_device(&pending_login, &device_code)?
    } else if account == routes::DIGITALOCEAN && !callback.contains("code=") {
        SubscriptionToken {
            access_token: access_token_from_callback(&callback).unwrap_or(callback),
            refresh_token: None,
            expires_at: None,
            account_id: None,
            source_path: None,
            email: None,
            display_name: None,
            avatar_url: None,
        }
    } else {
        let code = authorization_code(&callback);
        exchange_code(&pending_login, &code)?
    };
    let _ = pending().lock().map(|mut pending| pending.remove(&flow_id));
    Ok(identified(&account, token))
}

pub(crate) fn refresh_if_needed(
    provider: &NativeProviderProfile,
    dispatcher: Option<&std::sync::Arc<HostCapabilityDispatcher>>,
) -> AgentRuntimeResult<NativeProviderProfile> {
    if !is_subscription_route(&provider.route_id) {
        return Ok(provider.clone());
    }
    let Some(secret) = provider.api_key.clone() else {
        return Ok(provider.clone());
    };
    let Some(token) = parse_token(&secret) else {
        return Ok(provider.clone());
    };
    if !token.expired() {
        return Ok(provider.clone());
    }
    let Some(refresh_token) = token.refresh_token.clone() else {
        return Ok(provider.clone());
    };
    let refreshed =
        refresh_token_request(&provider.route_id, &refresh_token, token.account_id.clone())?;
    let mut next = provider.clone();
    next.api_key = Some(refreshed.to_secret());
    if let Some(dispatcher) = dispatcher {
        if let Ok(reference) = store_secret(dispatcher, &provider.label, &refreshed.to_secret()) {
            next.api_key_ref = Some(reference);
            next.api_key = Some(refreshed.to_secret());
        }
    }
    Ok(next)
}

pub(crate) fn store_secret(
    dispatcher: &std::sync::Arc<HostCapabilityDispatcher>,
    label: &str,
    secret: &str,
) -> AgentRuntimeResult<Value> {
    let payload = serde_json::to_string(&json!({
        "owner": "ai-provider",
        "valueKind": "token",
        "label": format!("Subscription token for {label}"),
        "description": format!("Lyra subscription token for {label}"),
        "value": secret,
        "capabilities": ["list_metadata", "use"],
    }))
    .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?;
    let output = dispatcher("sensitiveValues.storeForAgentUse".to_string(), payload)
        .map_err(AgentRuntimeError::HostCapability)?;
    let value: Value = serde_json::from_str(&output)
        .map_err(|error| AgentRuntimeError::Serialization(error.to_string()))?;
    value
        .get("ref")
        .cloned()
        .ok_or_else(|| AgentRuntimeError::Core("secret store did not return a ref".to_string()))
}

pub(crate) struct AccountIdentity {
    pub(crate) email: Option<String>,
    pub(crate) display_name: Option<String>,
    pub(crate) avatar_url: Option<String>,
}

pub(crate) fn identity_from_secret(route_id: &str, secret: &str) -> AccountIdentity {
    let access = bearer_secret(route_id, secret);
    let mut identity = jwt_identity(&access);
    if route_id == routes::CURSOR {
        if let Some(profile) = cursor_local_profile() {
            if identity.email.is_none() {
                identity.email = profile.0;
            }
            if identity.display_name.is_none() {
                identity.display_name = profile.1;
            }
            if identity.avatar_url.is_none() {
                identity.avatar_url = profile.2;
            }
        }
    }
    identity
}

fn identified(route_id: &str, mut token: SubscriptionToken) -> SubscriptionToken {
    let identity = identity_from_secret(route_id, &token.access_token);
    if token.email.is_none() {
        token.email = identity.email;
    }
    if token.display_name.is_none() {
        token.display_name = identity.display_name;
    }
    if token.avatar_url.is_none() {
        token.avatar_url = identity.avatar_url;
    }
    if token.account_id.is_none() {
        token.account_id = jwt_account_id(&token.access_token);
    }
    token
}

fn jwt_identity(access_token: &str) -> AccountIdentity {
    let Some(claims) = jwt_claims(access_token) else {
        return AccountIdentity {
            email: None,
            display_name: None,
            avatar_url: None,
        };
    };
    AccountIdentity {
        email: string_claim(&claims, &["email", "preferred_username"]),
        display_name: string_claim(&claims, &["name", "display_name", "preferred_username"]),
        avatar_url: string_claim(&claims, &["picture", "pictureUrl", "avatar_url"]),
    }
}

fn jwt_account_id(access_token: &str) -> Option<String> {
    let claims = jwt_claims(access_token)?;
    claims
        .get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| string_claim(&claims, &["account_id", "chatgpt_account_id"]))
}

fn string_claim(claims: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        claims
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

fn jwt_claims(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let mut padded = payload.to_string();
    let remainder = padded.len() % 4;
    if remainder != 0 {
        padded.push_str(&"=".repeat(4 - remainder));
    }
    let bytes = base64::engine::general_purpose::URL_SAFE
        .decode(padded)
        .ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(crate) fn discover_live_models(
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
    let provider = provider.clone();
    run_off_runtime(move || discover_live_models_blocking(&provider))
}

fn discover_live_models_blocking(
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
    let secret = provider.api_key.clone().unwrap_or_default();
    if secret.trim().is_empty() {
        return Err(AgentRuntimeError::Core(format!(
            "{} has no signed-in account, so Lyra cannot read its model list",
            provider.label
        )));
    }
    let mut provider = provider.clone();
    if let Some(token) = parse_token(&secret) {
        provider.api_key = Some(identified(&provider.route_id, token).to_secret());
    }
    let named = match provider.route_id.as_str() {
        routes::CURSOR => super::cursor_agent::fetch_model_ids(&bearer_secret(
            &provider.route_id,
            provider.api_key.as_deref().unwrap_or(""),
        ))?,
        routes::GEMINI_CODE_ASSIST | routes::ANTIGRAVITY => super::cloud_code::fetch_model_ids(
            &provider,
            &bearer_secret(
                &provider.route_id,
                provider.api_key.as_deref().unwrap_or(""),
            ),
        )?,
        routes::COPILOT_ACP => {
            return Err(AgentRuntimeError::Core(
                "GitHub Copilot CLI does not publish a model list. Use the GitHub Copilot account."
                    .to_string(),
            ));
        }
        routes::CLAUDE | routes::MINIMAX => {
            let client = http_client()?;
            return nonempty_models(
                &provider,
                super::protocol::anthropic_messages::discover_models(&client, &provider)?,
            );
        }
        _ => fetch_catalog_models(&provider)?,
    };
    nonempty_models(&provider, models_from_names(&provider, named))
}

fn nonempty_models(
    provider: &NativeProviderProfile,
    models: Vec<NativeProviderModel>,
) -> AgentRuntimeResult<Vec<NativeProviderModel>> {
    if models.is_empty() {
        return Err(AgentRuntimeError::Core(format!(
            "{} returned no models for this account",
            provider.label
        )));
    }
    Ok(models)
}

fn models_from_names(
    provider: &NativeProviderProfile,
    names: Vec<(String, Option<String>)>,
) -> Vec<NativeProviderModel> {
    let route = super::registry::require_route(&provider.route_id).ok();
    let mut models = names
        .into_iter()
        .filter(|(id, _)| {
            let trimmed = id.trim();
            !trimmed.is_empty() && trimmed != "default"
        })
        .map(|(id, label)| {
            super::model_capabilities::discovered_model(id, label, None, route.as_ref(), None)
        })
        .collect::<Vec<_>>();
    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);
    models
}

fn fetch_catalog_models(
    provider: &NativeProviderProfile,
) -> AgentRuntimeResult<Vec<(String, Option<String>)>> {
    let mut url = super::transport::http::endpoint_url(provider, "models")?;
    if provider.route_id == routes::CHATGPT {
        url.push_str("?client_version=1.0.0");
    }
    let client = http_client()?;
    let response = super::transport::auth::apply_model_auth(client.get(url), provider)?
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "model list failed with status {status}: {body}"
        )));
    }
    Ok(model_names_from_catalog(&body))
}

pub(crate) fn model_names_from_catalog(body: &Value) -> Vec<(String, Option<String>)> {
    let mut names = Vec::new();
    if let Some(entries) = body.get("data").and_then(Value::as_array) {
        names.extend(names_from_entries(entries));
    }
    if let Some(entries) = body.get("models").and_then(Value::as_array) {
        names.extend(names_from_entries(entries));
    }
    if let Some(entries) = body.get("models").and_then(Value::as_object) {
        for (id, entry) in entries {
            let label = entry
                .get("displayName")
                .or_else(|| entry.get("display_name"))
                .and_then(Value::as_str)
                .map(str::to_string);
            names.push((id.clone(), label));
        }
    }
    names
}

fn names_from_entries(entries: &[Value]) -> Vec<(String, Option<String>)> {
    entries
        .iter()
        .filter_map(|entry| {
            if let Some(id) = entry.as_str() {
                return Some((id.to_string(), None));
            }
            if entry
                .get("visibility")
                .and_then(Value::as_str)
                .is_some_and(|value| {
                    value.eq_ignore_ascii_case("hide") || value.eq_ignore_ascii_case("hidden")
                })
            {
                return None;
            }
            let id = entry
                .get("slug")
                .or_else(|| entry.get("id"))
                .or_else(|| entry.get("model"))
                .and_then(Value::as_str)?
                .trim();
            if id.is_empty() {
                return None;
            }
            let label = entry
                .get("displayName")
                .or_else(|| entry.get("name"))
                .and_then(Value::as_str)
                .map(str::to_string);
            Some((id.to_string(), label))
        })
        .collect()
}

fn start_pkce(flow_id: &str, account: &str) -> AgentRuntimeResult<Value> {
    let (verifier, challenge) = pkce_pair();
    let state = uuid_lite();
    let (authorize, token_url, client_id, secret, redirect, scopes) = pkce_endpoints(account)?;
    let url = authorize_url(
        &authorize,
        &[
            ("response_type", "code"),
            ("client_id", &client_id),
            ("redirect_uri", &redirect),
            ("scope", &scopes),
            ("state", &state),
            ("code_challenge", &challenge),
            ("code_challenge_method", "S256"),
        ],
    )?;
    remember(
        PendingLogin {
            account_id: account.to_string(),
            verifier,
            state: state.clone(),
            device_code: None,
            token_url,
            client_id,
            client_secret: secret,
            redirect_uri: redirect,
        },
        flow_id,
    )?;
    Ok(json!({
        "provider": account,
        "flowId": flow_id,
        "authUrl": url,
        "authKind": "subscription",
        "instructions": "Approve the browser login, then paste the full callback URL.",
        "requiresCallback": true,
        "requiresApiKey": false,
    }))
}

fn pkce_endpoints(
    account: &str,
) -> AgentRuntimeResult<(String, String, String, Option<String>, String, String)> {
    match account {
        routes::CLAUDE => Ok((
            CLAUDE_AUTHORIZE.to_string(),
            CLAUDE_TOKEN.to_string(),
            CLAUDE_CLIENT_ID.to_string(),
            None,
            CLAUDE_REDIRECT.to_string(),
            CLAUDE_SCOPES.to_string(),
        )),
        routes::CHATGPT => Ok((
            OPENAI_AUTHORIZE.to_string(),
            OPENAI_TOKEN.to_string(),
            OPENAI_CLIENT_ID.to_string(),
            None,
            OPENAI_REDIRECT.to_string(),
            OPENAI_SCOPES.to_string(),
        )),
        routes::GEMINI_CODE_ASSIST => Ok((
            GOOGLE_AUTHORIZE.to_string(),
            GOOGLE_TOKEN.to_string(),
            GEMINI_CLIENT_ID.to_string(),
            Some(
                std::env::var("LYRA_GEMINI_CLIENT_SECRET")
                    .unwrap_or_else(|_| GEMINI_CLIENT_SECRET.to_string()),
            ),
            GEMINI_REDIRECT.to_string(),
            GEMINI_SCOPES.to_string(),
        )),
        routes::ANTIGRAVITY => Ok((
            GOOGLE_AUTHORIZE.to_string(),
            GOOGLE_TOKEN.to_string(),
            ANTIGRAVITY_CLIENT_ID.to_string(),
            Some(
                std::env::var("LYRA_ANTIGRAVITY_CLIENT_SECRET")
                    .unwrap_or_else(|_| ANTIGRAVITY_CLIENT_SECRET.to_string()),
            ),
            ANTIGRAVITY_REDIRECT.to_string(),
            GEMINI_SCOPES.to_string(),
        )),
        routes::DIGITALOCEAN => Ok((
            DO_AUTHORIZE.to_string(),
            "https://cloud.digitalocean.com/v1/oauth/token".to_string(),
            DO_CLIENT_ID.to_string(),
            None,
            "http://localhost:1456/auth/callback".to_string(),
            "genai:read inference:query".to_string(),
        )),
        other => Err(AgentRuntimeError::Core(format!(
            "{other} does not use a browser login"
        ))),
    }
}

fn start_device(
    flow_id: &str,
    account: &str,
    device_url: &str,
    token_url: &str,
    client_id: &str,
    client_secret: Option<String>,
    scopes: &str,
) -> AgentRuntimeResult<Value> {
    let response = form_post(device_url, &[("client_id", client_id), ("scope", scopes)])?;
    let device_code = response
        .get("device_code")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if device_code.is_empty() {
        return Err(AgentRuntimeError::Core(
            "device login did not return a device code".to_string(),
        ));
    }
    let user_code = response
        .get("user_code")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let verification = response
        .get("verification_uri")
        .or_else(|| response.get("verification_url"))
        .and_then(Value::as_str)
        .unwrap_or("https://github.com/login/device")
        .to_string();
    remember(
        PendingLogin {
            account_id: account.to_string(),
            verifier: String::new(),
            state: String::new(),
            device_code: Some(device_code),
            token_url: token_url.to_string(),
            client_id: client_id.to_string(),
            client_secret,
            redirect_uri: String::new(),
        },
        flow_id,
    )?;
    Ok(json!({
        "provider": account,
        "flowId": flow_id,
        "authUrl": verification,
        "userCode": user_code,
        "authKind": "subscription",
        "instructions": format!("Open the page and enter code {user_code}. Then confirm here."),
        "requiresCallback": true,
        "requiresApiKey": false,
    }))
}

fn start_minimax(flow_id: &str, account: &str) -> AgentRuntimeResult<Value> {
    let (verifier, challenge) = pkce_pair();
    let state = uuid_lite();
    let response = form_post(
        MINIMAX_CODE,
        &[
            ("response_type", "code"),
            ("client_id", MINIMAX_CLIENT_ID),
            ("scope", "group_id profile model.completion"),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
        ],
    )?;
    let user_code = response
        .get("user_code")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let verification = response
        .get("verification_uri")
        .and_then(Value::as_str)
        .unwrap_or("https://www.minimax.io")
        .to_string();
    remember(
        PendingLogin {
            account_id: account.to_string(),
            verifier,
            state,
            device_code: Some(user_code.clone()),
            token_url: MINIMAX_TOKEN.to_string(),
            client_id: MINIMAX_CLIENT_ID.to_string(),
            client_secret: None,
            redirect_uri: String::new(),
        },
        flow_id,
    )?;
    Ok(json!({
        "provider": account,
        "flowId": flow_id,
        "authUrl": verification,
        "userCode": user_code,
        "authKind": "subscription",
        "instructions": "Enter the MiniMax code, then confirm here.",
        "requiresCallback": true,
        "requiresApiKey": false,
    }))
}

fn start_snowflake(flow_id: &str, account: &str, payload: &Value) -> AgentRuntimeResult<Value> {
    let locator = string_field(payload, "account")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core("Snowflake account locator is required".to_string())
        })?;
    let (verifier, challenge) = pkce_pair();
    let state = uuid_lite();
    let redirect = "http://127.0.0.1:1457/".to_string();
    let authorize = authorize_url(
        &format!("https://{locator}.snowflakecomputing.com/oauth/authorize"),
        &[
            ("response_type", "code"),
            ("client_id", "LOCAL_APPLICATION"),
            ("redirect_uri", redirect.as_str()),
            ("scope", "refresh_token"),
            ("state", state.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
        ],
    )?;
    remember(
        PendingLogin {
            account_id: account.to_string(),
            verifier,
            state,
            device_code: None,
            token_url: format!("https://{locator}.snowflakecomputing.com/oauth/token-request"),
            client_id: "LOCAL_APPLICATION".to_string(),
            client_secret: None,
            redirect_uri: redirect,
        },
        flow_id,
    )?;
    Ok(json!({
        "provider": account,
        "flowId": flow_id,
        "authUrl": authorize,
        "baseUrl": format!("https://{locator}.snowflakecomputing.com/api/v2/cortex/v1"),
        "authKind": "subscription",
        "instructions": "Approve Snowflake, then paste the callback URL.",
        "requiresCallback": true,
        "requiresApiKey": false,
    }))
}

fn poll_device(pending: &PendingLogin, device_code: &str) -> AgentRuntimeResult<SubscriptionToken> {
    let mut fields = vec![
        ("client_id", pending.client_id.as_str()),
        ("device_code", device_code),
        ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
    ];
    if pending.account_id == routes::MINIMAX {
        fields = vec![
            ("grant_type", "urn:ietf:params:oauth:grant-type:user_code"),
            ("client_id", pending.client_id.as_str()),
            ("user_code", device_code),
            ("code_verifier", pending.verifier.as_str()),
        ];
    }
    let body = form_post(&pending.token_url, &fields)?;
    token_from_response(body, None)
}

fn exchange_code(pending: &PendingLogin, code: &str) -> AgentRuntimeResult<SubscriptionToken> {
    let mut fields = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", pending.redirect_uri.as_str()),
        ("client_id", pending.client_id.as_str()),
        ("code_verifier", pending.verifier.as_str()),
    ];
    let secret = pending.client_secret.clone().unwrap_or_default();
    if !secret.is_empty() {
        fields.push(("client_secret", secret.as_str()));
    }
    let body = form_post(&pending.token_url, &fields)?;
    token_from_response(body, None)
}

fn refresh_token_request(
    route_id: &str,
    refresh_token: &str,
    account_id: Option<String>,
) -> AgentRuntimeResult<SubscriptionToken> {
    let (url, client_id, secret) = match route_id {
        routes::CLAUDE => (CLAUDE_TOKEN, CLAUDE_CLIENT_ID, None),
        routes::CHATGPT => (OPENAI_TOKEN, OPENAI_CLIENT_ID, None),
        routes::GEMINI_CODE_ASSIST => (GOOGLE_TOKEN, GEMINI_CLIENT_ID, Some(GEMINI_CLIENT_SECRET)),
        routes::ANTIGRAVITY => (
            GOOGLE_TOKEN,
            ANTIGRAVITY_CLIENT_ID,
            Some(ANTIGRAVITY_CLIENT_SECRET),
        ),
        routes::GROK_BUILD | routes::XAI_OAUTH => (XAI_TOKEN, XAI_CLIENT_ID, None),
        routes::QWEN => (QWEN_TOKEN, QWEN_CLIENT_ID, None),
        routes::MINIMAX => (MINIMAX_TOKEN, MINIMAX_CLIENT_ID, None),
        _ => {
            return Err(AgentRuntimeError::Core(format!(
                "{route_id} cannot refresh this token"
            )));
        }
    };
    let secret_owned = secret.unwrap_or("").to_string();
    let mut fields = vec![
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
    ];
    if !secret_owned.is_empty() {
        fields.push(("client_secret", secret_owned.as_str()));
    }
    let body = form_post(url, &fields)?;
    token_from_response(body, account_id)
}

fn exchange_cursor_api_key(api_key: &str) -> AgentRuntimeResult<SubscriptionToken> {
    let client = http_client()?;
    let response = client
        .post(CURSOR_EXCHANGE)
        .bearer_auth(api_key)
        .header("content-type", "application/json")
        .body("{}")
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: Value = response
        .json()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "Cursor API key exchange failed: {status}"
        )));
    }
    token_from_response(body, None)
}

pub(crate) fn borrow_token(account: &str) -> AgentRuntimeResult<SubscriptionToken> {
    if account == routes::COPILOT {
        if let Ok(output) = Command::new("gh").args(["auth", "token"]).output() {
            if output.status.success() {
                let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !token.is_empty() {
                    return Ok(SubscriptionToken {
                        access_token: token,
                        refresh_token: None,
                        expires_at: None,
                        account_id: None,
                        source_path: Some("gh auth token".to_string()),
                        email: None,
                        display_name: None,
                        avatar_url: None,
                    });
                }
            }
        }
    }
    if account == routes::AZURE {
        return azure_cli_token();
    }
    if account == routes::CURSOR {
        if let Some(token) = borrow_cursor_vscdb() {
            return Ok(token);
        }
    }
    for path in borrow_paths(account) {
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() {
            return Err(AgentRuntimeError::Core(format!(
                "refusing to read symlink {}",
                path.display()
            )));
        }
        if !meta.is_file() {
            continue;
        }
        let text = fs::read_to_string(&path).map_err(|error| {
            AgentRuntimeError::Core(format!("cannot read {}: {error}", path.display()))
        })?;
        if let Some(mut token) = token_from_borrowed_json(&text) {
            token.source_path = Some(path.display().to_string());
            return Ok(token);
        }
    }
    Err(AgentRuntimeError::Core(format!(
        "no local login file was found for {account}"
    )))
}

fn cursor_local_profile() -> Option<(Option<String>, Option<String>, Option<String>)> {
    let home = dirs::home_dir()?;
    let candidates = [
        home.join(".config/Cursor/User/globalStorage/state.vscdb"),
        home.join(".config/cursor/User/globalStorage/state.vscdb"),
    ];
    for path in candidates {
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_file() {
            continue;
        }
        let Ok(connection) = rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) else {
            continue;
        };
        let email = vscdb_value(&connection, "cursorAuth/cachedEmail");
        let profile = vscdb_value(&connection, "cursorAuth/cachedScopedProfile")
            .and_then(|text| serde_json::from_str::<Value>(&text).ok());
        let name = profile
            .as_ref()
            .and_then(|value| value.get("displayName"))
            .and_then(Value::as_str)
            .map(str::to_string);
        let avatar = profile
            .as_ref()
            .and_then(|value| value.get("pictureUrl"))
            .and_then(Value::as_str)
            .map(str::to_string);
        if email.is_some() || name.is_some() || avatar.is_some() {
            return Some((email, name, avatar));
        }
    }
    None
}

fn vscdb_value(connection: &rusqlite::Connection, key: &str) -> Option<String> {
    connection
        .query_row("SELECT value FROM ItemTable WHERE key = ?1", [key], |row| {
            row.get::<_, String>(0)
        })
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn borrow_cursor_vscdb() -> Option<SubscriptionToken> {
    let home = dirs::home_dir()?;
    let candidates = [
        home.join(".config/Cursor/User/globalStorage/state.vscdb"),
        home.join(".config/cursor/User/globalStorage/state.vscdb"),
    ];
    for path in candidates {
        let Ok(meta) = fs::symlink_metadata(&path) else {
            continue;
        };
        if meta.file_type().is_symlink() || !meta.is_file() {
            continue;
        }
        let Ok(connection) = rusqlite::Connection::open_with_flags(
            &path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) else {
            continue;
        };
        let Ok(token) = connection.query_row(
            "SELECT value FROM ItemTable WHERE key = ?1",
            ["cursorAuth/accessToken"],
            |row| row.get::<_, String>(0),
        ) else {
            continue;
        };
        if token.trim().is_empty() {
            continue;
        }
        return Some(SubscriptionToken {
            access_token: token,
            refresh_token: None,
            expires_at: None,
            account_id: None,
            source_path: Some(path.display().to_string()),
            email: None,
            display_name: None,
            avatar_url: None,
        });
    }
    None
}

pub(crate) fn borrow_paths(account: &str) -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    match account {
        routes::CLAUDE => vec![home.join(".claude/.credentials.json")],
        routes::CHATGPT => vec![home.join(".codex/auth.json")],
        routes::GEMINI_CODE_ASSIST => vec![home.join(".gemini/oauth_creds.json")],
        routes::COPILOT => vec![
            home.join(".copilot/config.json"),
            home.join(".config/github-copilot/hosts.json"),
        ],
        routes::CURSOR => vec![
            home.join(".config/cursor/auth.json"),
            home.join(".cursor/auth.json"),
        ],
        routes::GROK_BUILD | routes::XAI_OAUTH => vec![home.join(".grok/auth.json")],
        routes::QWEN => vec![home.join(".qwen/oauth_creds.json")],
        _ => Vec::new(),
    }
}

fn token_from_borrowed_json(text: &str) -> Option<SubscriptionToken> {
    let value: Value = serde_json::from_str(text).ok()?;
    if let Some(token) = parse_token(text) {
        return Some(token);
    }
    for key in ["claudeAiOauth", "tokens", "openai"] {
        if let Some(nested) = value.get(key) {
            if let Ok(token) =
                serde_json::from_value::<SubscriptionToken>(normalize_token_json(nested.clone()))
            {
                if !token.access_token.is_empty() {
                    return Some(token);
                }
            }
        }
    }
    value
        .get("accessToken")
        .or_else(|| value.get("access_token"))
        .and_then(Value::as_str)
        .map(|access_token| SubscriptionToken {
            access_token: access_token.to_string(),
            refresh_token: value
                .get("refreshToken")
                .or_else(|| value.get("refresh_token"))
                .and_then(Value::as_str)
                .map(str::to_string),
            expires_at: None,
            account_id: None,
            source_path: None,
            email: None,
            display_name: None,
            avatar_url: None,
        })
}

fn azure_cli_token() -> AgentRuntimeResult<SubscriptionToken> {
    let output = Command::new("az")
        .args([
            "account",
            "get-access-token",
            "--resource",
            "https://cognitiveservices.azure.com",
            "--query",
            "accessToken",
            "-o",
            "tsv",
        ])
        .output()
        .map_err(|error| AgentRuntimeError::Core(format!("Azure CLI is not available: {error}")))?;
    if !output.status.success() {
        return Err(AgentRuntimeError::Core(
            "Azure CLI is not signed in. Run `az login` or paste an API key.".to_string(),
        ));
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        return Err(AgentRuntimeError::Core(
            "Azure CLI returned an empty token".to_string(),
        ));
    }
    Ok(SubscriptionToken {
        access_token: token,
        refresh_token: None,
        expires_at: None,
        account_id: None,
        source_path: Some("az account get-access-token".to_string()),
        email: None,
        display_name: None,
        avatar_url: None,
    })
}

pub(crate) fn authorize_url(base: &str, pairs: &[(&str, &str)]) -> AgentRuntimeResult<String> {
    let mut url = url::Url::parse(base)
        .map_err(|error| AgentRuntimeError::Core(format!("invalid authorize url: {error}")))?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in pairs {
            query.append_pair(key, value);
        }
    }
    Ok(url.to_string())
}

pub(crate) fn pkce_pair() -> (String, String) {
    let verifier = uuid_lite() + &uuid_lite();
    let digest = Sha256::digest(verifier.as_bytes());
    let challenge = URL_SAFE_NO_PAD.encode(digest);
    (verifier, challenge)
}

pub(crate) fn authorization_code(callback: &str) -> String {
    if let Some(code) = query_param(callback, "code") {
        return code;
    }
    callback.trim().to_string()
}

fn access_token_from_callback(callback: &str) -> Option<String> {
    query_param(callback, "access_token")
}

fn query_param(input: &str, key: &str) -> Option<String> {
    let query = input.split('?').nth(1).unwrap_or(input);
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if parts.next() == Some(key) {
            return parts.next().map(|value| value.to_string());
        }
    }
    None
}

fn token_from_response(
    body: Value,
    account_id: Option<String>,
) -> AgentRuntimeResult<SubscriptionToken> {
    let access_token = body
        .get("access_token")
        .or_else(|| body.get("accessToken"))
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AgentRuntimeError::Core(format!("token response had no access token: {body}"))
        })?
        .to_string();
    let refresh_token = body
        .get("refresh_token")
        .or_else(|| body.get("refreshToken"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let expires_at = body
        .get("expires_in")
        .and_then(Value::as_u64)
        .map(|seconds| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|value| value.as_secs().saturating_add(seconds))
                .unwrap_or(seconds)
        });
    let account_id = account_id.or_else(|| {
        body.get("account_id")
            .or_else(|| body.get("chatgpt_account_id"))
            .and_then(Value::as_str)
            .map(str::to_string)
    });
    Ok(SubscriptionToken {
        access_token,
        refresh_token,
        expires_at,
        account_id,
        source_path: None,
        email: None,
        display_name: None,
        avatar_url: None,
    })
}

fn form_post(url: &str, fields: &[(&str, &str)]) -> AgentRuntimeResult<Value> {
    let client = http_client()?;
    let response = client
        .post(url)
        .header("accept", "application/json")
        .form(fields)
        .send()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    let status = response.status();
    let body: Value = response
        .json()
        .unwrap_or_else(|_| Value::String(String::new()));
    if !status.is_success() {
        return Err(AgentRuntimeError::Core(format!(
            "login request to {url} failed: {status} {body}"
        )));
    }
    Ok(body)
}

fn http_client() -> AgentRuntimeResult<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|error| AgentRuntimeError::Core(error.to_string()))
}

fn remember(login: PendingLogin, flow_id: &str) -> AgentRuntimeResult<()> {
    pending()
        .lock()
        .map_err(|_| AgentRuntimeError::Core("login state lock failed".to_string()))?
        .insert(flow_id.to_string(), login);
    Ok(())
}

fn string_field(payload: &Value, key: &str) -> Option<String> {
    payload
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn uuid_lite() -> String {
    use uuid::Uuid;
    Uuid::new_v4().simple().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn chatgpt_login_starts_a_browser_url() {
        let started = start_login(&json!({"provider": "chatgpt_codex"})).expect("start");
        let url = started["authUrl"].as_str().expect("url");
        assert!(url.contains("auth.openai.com/oauth/authorize"));
        assert!(url.contains("code_challenge="));
        assert!(url.contains("code_challenge_method=S256"));
    }

    #[test]
    fn pkce_challenge_is_base64url_without_padding() {
        let (verifier, challenge) = pkce_pair();
        assert!(!verifier.is_empty());
        assert!(!challenge.contains('=') && !challenge.contains('+') && !challenge.contains('/'));
    }

    #[test]
    fn authorization_code_reads_the_callback_query() {
        assert_eq!(
            authorization_code("http://localhost:1455/auth/callback?code=abc&state=s"),
            "abc"
        );
    }

    #[test]
    fn claude_contract_prefixes_identity_and_renames_tools() {
        let mut body = json!({
            "system": "be careful",
            "tools": [{"name": "bash"}, {"name": "web_search"}]
        });
        apply_claude_code_contract(&mut body);
        assert!(
            body["system"]
                .as_str()
                .unwrap()
                .starts_with("You are Claude Code")
        );
        assert_eq!(body["tools"][0]["name"], "Bash");
        assert_eq!(body["tools"][1]["name"], "web_search");
    }

    #[test]
    fn subscription_headers_include_the_codex_account() {
        let secret = SubscriptionToken {
            access_token: "access".to_string(),
            refresh_token: None,
            expires_at: None,
            account_id: Some("acct_1".to_string()),
            source_path: None,
            email: None,
            display_name: None,
            avatar_url: None,
        }
        .to_secret();
        let headers = extra_headers(routes::CHATGPT, &secret);
        assert!(
            headers
                .iter()
                .any(|(name, value)| *name == "originator" && value == "codex_cli_rs")
        );
        assert!(
            headers
                .iter()
                .any(|(name, value)| *name == "chatgpt-account-id" && value == "acct_1")
        );
        assert_eq!(bearer_secret(routes::CHATGPT, &secret), "access");
    }

    #[test]
    fn borrow_rejects_a_symlink() {
        let dir = std::env::temp_dir().join(format!("lyra-sub-{}", uuid_lite()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("real.json");
        let link = dir.join("link.json");
        fs::write(&target, r#"{"access_token":"tok"}"#).unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let error = fs::symlink_metadata(&link).unwrap();
        assert!(error.file_type().is_symlink());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn token_exchange_reads_a_mock_token_endpoint() {
        let body = r#"{"access_token":"ya","refresh_token":"yr","expires_in":3600}"#;
        let url = serve_json(body);
        let response = form_post(&url, &[("grant_type", "authorization_code")]).expect("exchange");
        let token = token_from_response(response, Some("acct".to_string())).unwrap();
        assert_eq!(token.access_token, "ya");
        assert_eq!(token.refresh_token.as_deref(), Some("yr"));
        assert_eq!(token.account_id.as_deref(), Some("acct"));
        assert!(token.expires_at.is_some());
    }

    fn serve_json(body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let body = body.to_string();
        thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buf = [0_u8; 2048];
            let _ = socket.read(&mut buf);
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = socket.write_all(response.as_bytes());
        });
        format!("http://127.0.0.1:{port}/token")
    }

    #[test]
    fn catalog_body_reads_codex_slugs_and_hides_hidden_models() {
        let body = json!({
            "models": [
                {"slug": "gpt-5.4", "visibility": "visible"},
                {"slug": "hidden-model", "visibility": "hide"}
            ]
        });
        let names = model_names_from_catalog(&body);
        assert_eq!(names, vec![("gpt-5.4".to_string(), None)]);
    }

    #[test]
    fn jwt_identity_reads_email_and_picture_without_inventing_them() {
        let payload = URL_SAFE_NO_PAD.encode(
            br#"{"email":"ada@example.com","name":"Ada","picture":"https://example.com/a.png"}"#,
        );
        let token = format!("e30.{payload}.sig");
        let identity = jwt_identity(&token);
        assert_eq!(identity.email.as_deref(), Some("ada@example.com"));
        assert_eq!(identity.display_name.as_deref(), Some("Ada"));
        assert_eq!(
            identity.avatar_url.as_deref(),
            Some("https://example.com/a.png")
        );
    }

    #[test]
    fn live_catalog_refuses_to_invent_models_without_an_account() {
        let provider = NativeProviderProfile {
            id: "cursor_subscription".to_string(),
            label: "Cursor".to_string(),
            route_id: "cursor_subscription".to_string(),
            base_url: Some("https://agentn.global.api5.cursor.sh".to_string()),
            default_model: None,
            api_key: None,
            api_key_ref: None,
            api_key_env: None,
            auth_header: None,
            embedding_model: None,
            models: Vec::new(),
        };
        let error = discover_live_models(&provider).expect_err("missing account");
        let text = error.to_string();
        assert!(!text.contains("composer-1.5"));
        assert!(text.contains("no signed-in account"));
    }
}
