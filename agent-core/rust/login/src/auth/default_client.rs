//! Default Lyra HTTP client: shared `User-Agent` and reqwest/`CodexHttpClient`
//! construction.
//!
//! Use [`crate::default_client`] or [`lyra_login::default_client`] from other crates in this
//! workspace.

use lyra_client::BuildCustomCaTransportError;
use lyra_client::CodexHttpClient;
pub use lyra_client::CodexRequestBuilder;
use lyra_client::build_reqwest_client_with_custom_ca;
use lyra_terminal_detection::user_agent;
use reqwest::header::HeaderMap;
use reqwest::header::HeaderValue;
use std::sync::LazyLock;
use std::sync::Mutex;

/// Set this to add a suffix to the User-Agent string.
///
/// It is not ideal that we're using a global singleton for this.
/// This is primarily designed to differentiate MCP clients from each other.
/// Because there can only be one MCP server per process, it should be safe for this to be a global static.
/// However, future users of this should use this with caution as a result.
/// In addition, we want to be confident that this value is used for ALL clients and doing that requires a
/// lot of wiring and it's easy to miss code paths by doing so.
/// See https://github.com/openai/codex/pull/3388/files for an example of what that would look like.
/// Finally, we want to make sure this is set for ALL mcp clients without needing to know a special env var
/// or having to set data that they already specified in the mcp initialize request somewhere else.
///
/// A space is automatically added between the suffix and the rest of the User-Agent string.
/// The full user agent string is returned from the mcp initialize response.
/// Parenthesis will be added by Lyra. This should only specify what goes inside of the parenthesis.
pub static USER_AGENT_SUFFIX: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));
pub const DEFAULT_CLIENT_NAME: &str = "lyra";
pub const LYRA_CLIENT_NAME_OVERRIDE_ENV_VAR: &str = "LYRA_CLIENT_NAME_OVERRIDE";

fn resolve_client_name(provided: Option<String>) -> String {
    let value = std::env::var(LYRA_CLIENT_NAME_OVERRIDE_ENV_VAR)
        .ok()
        .or(provided)
        .unwrap_or(DEFAULT_CLIENT_NAME.to_string());

    if HeaderValue::from_str(&value).is_ok() {
        value
    } else {
        tracing::error!("Unable to turn client name override {value} into header value");
        DEFAULT_CLIENT_NAME.to_string()
    }
}

pub fn client_identity() -> String {
    resolve_client_name(/*provided*/ None)
}

pub fn get_lyra_user_agent() -> String {
    let build_version = env!("CARGO_PKG_VERSION");
    let os_info = os_info::get();
    let client_name = client_identity();
    let prefix = format!(
        "{}/{build_version} ({} {}; {}) {}",
        client_name.as_str(),
        os_info.os_type(),
        os_info.version(),
        os_info.architecture().unwrap_or("unknown"),
        user_agent()
    );
    let suffix = USER_AGENT_SUFFIX
        .lock()
        .ok()
        .and_then(|guard| guard.clone());
    let suffix = suffix
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map_or_else(String::new, |value| format!(" ({value})"));

    let candidate = format!("{prefix}{suffix}");
    sanitize_user_agent(candidate, &prefix)
}

/// Sanitize the user agent string.
///
/// Invalid characters are replaced with an underscore.
///
/// If the user agent fails to parse, it falls back to fallback and then to the default client name.
fn sanitize_user_agent(candidate: String, fallback: &str) -> String {
    if HeaderValue::from_str(candidate.as_str()).is_ok() {
        return candidate;
    }

    let sanitized: String = candidate
        .chars()
        .map(|ch| if matches!(ch, ' '..='~') { ch } else { '_' })
        .collect();
    if !sanitized.is_empty() && HeaderValue::from_str(sanitized.as_str()).is_ok() {
        tracing::warn!(
            "Sanitized Lyra user agent because provided suffix contained invalid header characters"
        );
        sanitized
    } else if HeaderValue::from_str(fallback).is_ok() {
        tracing::warn!(
            "Falling back to base Lyra user agent because provided suffix could not be sanitized"
        );
        fallback.to_string()
    } else {
        tracing::warn!(
            "Falling back to default Lyra client name because base user agent string is invalid"
        );
        client_identity()
    }
}

/// Create an HTTP client with Lyra's default HTTP transport policy.
pub fn create_client() -> CodexHttpClient {
    let inner = build_reqwest_client();
    CodexHttpClient::new(inner)
}

/// Builds the default reqwest client used for ordinary Lyra HTTP traffic.
///
/// This starts from the standard Lyra user agent, default headers, and sandbox-specific proxy
/// policy, then layers in shared custom CA handling from `LYRA_CA_CERTIFICATE` /
/// `SSL_CERT_FILE`. The function remains infallible for compatibility with existing call sites, so
/// a custom-CA or builder failure is logged and falls back to `reqwest::Client::new()`.
pub fn build_reqwest_client() -> reqwest::Client {
    try_build_reqwest_client().unwrap_or_else(|error| {
        tracing::warn!(error = %error, "failed to build default reqwest client");
        reqwest::Client::new()
    })
}

/// Tries to build the default reqwest client used for ordinary Lyra HTTP traffic.
///
/// Callers that need a structured CA-loading failure instead of the legacy logged fallback can use
/// this method directly.
pub fn try_build_reqwest_client() -> Result<reqwest::Client, BuildCustomCaTransportError> {
    let ua = get_lyra_user_agent();

    let mut builder = reqwest::Client::builder()
        // Set UA via dedicated helper to avoid header validation pitfalls
        .user_agent(ua)
        .default_headers(default_headers());
    if is_sandboxed() {
        builder = builder.no_proxy();
    }

    build_reqwest_client_with_custom_ca(builder)
}

pub fn default_headers() -> HeaderMap {
    HeaderMap::new()
}

fn is_sandboxed() -> bool {
    std::env::var("LYRA_SANDBOX").as_deref() == Ok("seatbelt")
}
