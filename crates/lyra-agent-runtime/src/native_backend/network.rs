use super::*;

const PROXY_ENV_VARS: &[&str] = &[
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
];

const NO_PROXY_ENV_VARS: &[&str] = &["NO_PROXY", "no_proxy"];

const PROVIDER_CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
const PROVIDER_NON_STREAMING_TIMEOUT: Duration = Duration::from_secs(300);

pub(crate) fn http_client_builder(timeout: Duration) -> reqwest::blocking::ClientBuilder {
    reqwest::blocking::Client::builder().timeout(timeout)
}

pub(crate) fn provider_http_client_builder(streaming: bool) -> reqwest::blocking::ClientBuilder {
    let builder = reqwest::blocking::Client::builder().connect_timeout(PROVIDER_CONNECT_TIMEOUT);
    if streaming {
        // SSE/code-generation turns can legitimately run for minutes. Do not set
        // reqwest's whole-request timeout here: it includes the full response body
        // and cuts long streams at a fixed wall-clock boundary.
        builder
    } else {
        builder.timeout(PROVIDER_NON_STREAMING_TIMEOUT)
    }
}

pub(crate) fn network_runtime_context() -> Value {
    let env_proxy = env_proxy_context();
    let system_proxy = system_proxy_context();
    json!({
        "nativeHttpClient": {
            "implementation": "reqwest",
            "honorsEnvironmentProxy": true,
            "honorsSystemProxy": true,
            "systemProxyFeature": "reqwest/system-proxy",
            "usedBy": ["provider", "web_fetch", "web_search"],
        },
        "envProxy": env_proxy,
        "systemProxy": system_proxy,
        "guidance": [
            "Native Agent HTTP calls use reqwest, not the Chromium page network stack.",
            "If browser navigation works but native web/provider calls fail, compare envProxy/systemProxy and use browser-backed capabilities as fallback evidence.",
            "Do not report API key misconfiguration unless the provider error is an auth/config error such as missing key or HTTP 401/403."
        ]
    })
}

pub(crate) fn network_status_summary(status: &Value) -> String {
    let env_active = status
        .pointer("/envProxy/active")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let system_active = status
        .pointer("/systemProxy/active")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let source = if env_active {
        "environment proxy"
    } else if system_active {
        "system proxy"
    } else {
        "direct network"
    };
    format!(
        "Native network status: {source}. reqwest provider/web tools honor environment and system proxy settings."
    )
}

fn env_proxy_context() -> Value {
    let proxies = PROXY_ENV_VARS
        .iter()
        .filter_map(|name| env::var(name).ok().map(|value| (*name, value)))
        .filter(|(_, value)| !value.trim().is_empty())
        .map(|(name, value)| {
            json!({
                "name": name,
                "value": redact_proxy_value(&value),
            })
        })
        .collect::<Vec<_>>();
    let no_proxy = NO_PROXY_ENV_VARS
        .iter()
        .filter_map(|name| env::var(name).ok().map(|value| (*name, value)))
        .filter(|(_, value)| !value.trim().is_empty())
        .map(|(name, value)| {
            json!({
                "name": name,
                "value": value,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "active": !proxies.is_empty(),
        "proxies": proxies,
        "noProxy": no_proxy,
    })
}

fn redact_proxy_value(value: &str) -> String {
    let Ok(mut parsed) = Url::parse(value) else {
        return value.to_string();
    };
    if !parsed.username().is_empty() {
        let _ = parsed.set_username("<redacted>");
    }
    if parsed.password().is_some() {
        let _ = parsed.set_password(Some("<redacted>"));
    }
    parsed.to_string()
}

fn system_proxy_context() -> Value {
    #[cfg(target_os = "macos")]
    {
        macos_system_proxy_context().unwrap_or_else(|| {
            json!({
                "source": "macos-scutil",
                "active": false,
                "available": false,
            })
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        json!({
            "source": "platform-default",
            "active": false,
            "available": false,
            "message": "System proxy inspection is currently implemented for macOS; reqwest still honors supported platform proxy settings when available."
        })
    }
}

#[cfg(target_os = "macos")]
fn macos_system_proxy_context() -> Option<Value> {
    let output = Command::new("scutil").arg("--proxy").output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    Some(parse_macos_scutil_proxy(&text))
}

pub(crate) fn parse_macos_scutil_proxy(text: &str) -> Value {
    let http_enabled = scutil_bool(text, "HTTPEnable");
    let https_enabled = scutil_bool(text, "HTTPSEnable");
    let socks_enabled = scutil_bool(text, "SOCKSEnable");
    let http_proxy = scutil_string(text, "HTTPProxy");
    let https_proxy = scutil_string(text, "HTTPSProxy");
    let socks_proxy = scutil_string(text, "SOCKSProxy");
    let http_port = scutil_u16(text, "HTTPPort");
    let https_port = scutil_u16(text, "HTTPSPort");
    let socks_port = scutil_u16(text, "SOCKSPort");
    let active = (http_enabled && http_proxy.is_some())
        || (https_enabled && https_proxy.is_some())
        || (socks_enabled && socks_proxy.is_some());
    json!({
        "source": "macos-scutil",
        "available": true,
        "active": active,
        "http": {
            "enabled": http_enabled,
            "host": http_proxy,
            "port": http_port,
        },
        "https": {
            "enabled": https_enabled,
            "host": https_proxy,
            "port": https_port,
        },
        "socks": {
            "enabled": socks_enabled,
            "host": socks_proxy,
            "port": socks_port,
        }
    })
}

fn scutil_bool(text: &str, key: &str) -> bool {
    scutil_string(text, key).as_deref() == Some("1")
}

fn scutil_u16(text: &str, key: &str) -> Option<u16> {
    scutil_string(text, key)?.parse::<u16>().ok()
}

fn scutil_string(text: &str, key: &str) -> Option<String> {
    let prefix = format!("{key} :");
    text.lines().find_map(|line| {
        let trimmed = line.trim();
        trimmed
            .strip_prefix(&prefix)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}
