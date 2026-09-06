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
/// Per-operation idle timeout applied to every streaming read. A provider that
/// keeps the TCP connection open but stops sending bytes (a transient route
/// hiccup, e.g. the mimo token-plan lines) would otherwise block
/// `reader.lines()` forever — no error, no cancellation, no retry, the agent
/// just hangs. In `reqwest::blocking`, `.timeout()` is a *per read/write
/// operation* budget (not a whole-request deadline): each `read()` on the
/// streaming body gets a fresh window of this length. So a 180s value lets long
/// generations run indefinitely (each arriving chunk resets the clock) while
/// guaranteeing a stalled stream surfaces a timeout within 180s. That timeout is
/// classified as `ProviderTransportKind::Timeout` (see
/// `classify_reqwest_transport`), which the streaming safe-retry /
/// non-streaming fallback in `call_model_once_inner` recovers from. A separate
/// parser-level total deadline bounds slow-but-non-idle streams.
const PROVIDER_STREAMING_IDLE_TIMEOUT: Duration = Duration::from_secs(180);
/// Whole-stream deadline enforced while parsing provider SSE/JSONL events.
/// This closes the "slow drip forever" class without lowering the idle budget
/// needed by providers that occasionally pause between chunks.
const PROVIDER_STREAMING_TOTAL_TIMEOUT: Duration = Duration::from_secs(30 * 60);

/// Resolve the streaming per-operation idle timeout, honoring a
/// `LYRA_PROVIDER_STREAMING_IDLE_TIMEOUT_MS` override (milliseconds). Tests use a
/// small override so the idle-timeout recovery paths can be exercised without
/// waiting the full production budget.
pub(crate) fn streaming_idle_timeout() -> Duration {
    if let Ok(raw) = std::env::var("LYRA_PROVIDER_STREAMING_IDLE_TIMEOUT_MS") {
        if let Ok(ms) = raw.trim().parse::<u64>() {
            return Duration::from_millis(ms);
        }
    }
    PROVIDER_STREAMING_IDLE_TIMEOUT
}

pub(crate) fn streaming_total_timeout() -> Duration {
    if let Ok(raw) = std::env::var("LYRA_PROVIDER_STREAMING_TOTAL_TIMEOUT_MS") {
        if let Ok(ms) = raw.trim().parse::<u64>() {
            return Duration::from_millis(ms);
        }
    }
    PROVIDER_STREAMING_TOTAL_TIMEOUT
}

pub(crate) fn http_client_builder(timeout: Duration) -> reqwest::blocking::ClientBuilder {
    let builder = reqwest::blocking::Client::builder().timeout(timeout);
    match system_proxy_override() {
        Some(proxy) => builder.proxy(proxy),
        None => builder,
    }
}

pub(crate) fn provider_http_client_builder(streaming: bool) -> reqwest::blocking::ClientBuilder {
    let builder = reqwest::blocking::Client::builder().connect_timeout(PROVIDER_CONNECT_TIMEOUT);
    let builder = if streaming {
        // Per-operation idle timeout for streaming reads (see
        // PROVIDER_STREAMING_IDLE_TIMEOUT). This is NOT a whole-request
        // deadline: reqwest::blocking applies it per read(), so a long-lived
        // stream that keeps delivering chunks is never cut off, while a stalled
        // connection is bounded and surfaces a transport Timeout that the
        // caller can safely retry / fall back from.
        builder.timeout(streaming_idle_timeout())
    } else {
        builder.timeout(PROVIDER_NON_STREAMING_TIMEOUT)
    };
    match system_proxy_override() {
        Some(proxy) => builder.proxy(proxy),
        None => builder,
    }
}

/// Async client builder. `streaming=true` leaves the request unbounded (the
/// idle watchdog and parser deadline bound stalled streams). `streaming=false`
/// sets a whole-request timeout matching the blocking non-streaming path.
pub(crate) fn provider_http_client_builder_async(streaming: bool) -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder().connect_timeout(PROVIDER_CONNECT_TIMEOUT);
    let builder = if streaming {
        builder
    } else {
        builder.timeout(PROVIDER_NON_STREAMING_TIMEOUT)
    };
    match system_proxy_override() {
        Some(proxy) => builder.proxy(proxy),
        None => builder,
    }
}

/// Windows system proxies (v2ray, Clash, corporate gateways) are resolved by
/// hyper-util from the registry, but its `ProxyOverride` conversion only
/// understands `*.domain` prefix wildcards. Windows overrides also use
/// `<local>` and suffix wildcards (`127.*`), which never match — so a local
/// proxy listening on 127.0.0.1 intercepts loopback destinations (local model
/// servers, self-hosted endpoints) and answers them with empty 503s. We
/// resolve the registry proxy ourselves with full WinINET bypass semantics
/// and keep loopback destinations direct. When environment proxy variables
/// are set we defer to reqwest, whose env handling (including NO_PROXY) is
/// correct.
#[cfg(windows)]
fn system_proxy_override() -> Option<reqwest::Proxy> {
    if PROXY_ENV_VARS
        .iter()
        .any(|name| env::var(name).is_ok_and(|value| !value.trim().is_empty()))
    {
        return None;
    }
    let settings = windows_registry::CURRENT_USER
        .open("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
        .ok()?;
    if settings.get_u32("ProxyEnable").unwrap_or(0) == 0 {
        return None;
    }
    let server = settings.get_string("ProxyServer").ok()?;
    let (http, https) = parse_wininet_proxy_server(&server);
    if http.is_none() && https.is_none() {
        return None;
    }
    let override_raw = settings.get_string("ProxyOverride").unwrap_or_default();
    let policy = WinInetProxyPolicy {
        http,
        https,
        bypass: WinInetBypass::parse(&override_raw),
    };
    Some(reqwest::Proxy::custom(move |url| {
        if policy
            .bypass
            .matches_host(url.host_str().unwrap_or_default())
        {
            return None;
        }
        if url.scheme() == "https" {
            policy.https.clone()
        } else {
            policy.http.clone()
        }
    }))
}

#[cfg(not(windows))]
fn system_proxy_override() -> Option<reqwest::Proxy> {
    None
}

#[cfg(windows)]
#[derive(Debug, Clone, PartialEq, Eq)]
struct WinInetProxyPolicy {
    http: Option<String>,
    https: Option<String>,
    bypass: WinInetBypass,
}

/// Split a WinINET `ProxyServer` value into the proxy endpoints used for http
/// and https destinations. Handles both the single `host:port` form (applies
/// to both schemes) and the per-protocol `http=...;https=...;...` form.
/// SOCKS-only entries are ignored (the bundled reqwest has no socks feature).
#[cfg(windows)]
fn parse_wininet_proxy_server(raw: &str) -> (Option<String>, Option<String>) {
    let raw = raw.trim();
    if raw.is_empty() {
        return (None, None);
    }
    if !raw.contains('=') {
        return (Some(raw.to_string()), Some(raw.to_string()));
    }
    let mut http = None;
    let mut https = None;
    for part in raw.split(';') {
        let Some((protocol, endpoint)) = part.split_once('=') else {
            continue;
        };
        let endpoint = endpoint.trim();
        if endpoint.is_empty() {
            continue;
        }
        match protocol.trim().to_ascii_lowercase().as_str() {
            "http" => http = Some(endpoint.to_string()),
            "https" => https = Some(endpoint.to_string()),
            _ => {}
        }
    }
    (http, https)
}

/// WinINET proxy-override matching: `<local>` covers dotless hostnames,
/// `prefix*` entries match by prefix (`127.*`), `*.suffix` entries match the
/// suffix domain and its subdomains, exact entries match exactly, and `*`
/// bypasses everything. Loopback destinations always bypass regardless of
/// the override list, so a misconfigured local proxy can never intercept
/// them.
#[cfg(windows)]
#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct WinInetBypass {
    entries: Vec<String>,
    local: bool,
}

#[cfg(windows)]
impl WinInetBypass {
    fn parse(raw: &str) -> Self {
        let mut entries = Vec::new();
        let mut local = false;
        for entry in raw.split([';', ',']) {
            let entry = entry.trim();
            if entry.is_empty() {
                continue;
            }
            if entry.eq_ignore_ascii_case("<local>") {
                local = true;
            } else {
                entries.push(entry.to_ascii_lowercase());
            }
        }
        Self { entries, local }
    }

    fn matches_host(&self, host: &str) -> bool {
        let host = host
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_ascii_lowercase();
        if is_loopback_host(&host) {
            return true;
        }
        if self.local && !host.contains('.') {
            return true;
        }
        self.entries
            .iter()
            .any(|entry| wininet_entry_matches(entry, &host))
    }
}

#[cfg(windows)]
fn wininet_entry_matches(entry: &str, host: &str) -> bool {
    if let Some(prefix) = entry.strip_suffix('*') {
        return host.starts_with(prefix);
    }
    if let Some(suffix) = entry.strip_prefix("*.") {
        return host == suffix || host.ends_with(&format!(".{suffix}"));
    }
    host == entry
}

#[cfg(windows)]
fn is_loopback_host(host: &str) -> bool {
    host == "localhost"
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
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

#[cfg(test)]
mod proxy_policy_tests {
    use super::*;

    /// A loopback destination must never be routed through a system proxy.
    /// Before the explicit proxy policy, a local proxy (e.g. v2ray) listening
    /// on 127.0.0.1 intercepted loopback requests because hyper-util ignores
    /// Windows override entries like `127.*` and `<local>`; a connection to a
    /// closed loopback port then came back as an empty HTTP 503 answered by
    /// the proxy instead of a connection error.
    #[cfg(windows)]
    #[test]
    fn closed_loopback_port_is_not_proxied() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let addr = listener.local_addr().expect("addr");
        drop(listener);
        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        let result = runtime.block_on(async {
            let client = provider_http_client_builder_async(false)
                .build()
                .expect("client");
            client
                .post(format!("http://{addr}/v1/chat/completions"))
                .json(&json!({ "model": "x", "messages": [] }))
                .send()
                .await
        });
        let error = result.expect_err("closed loopback port must not answer");
        let text = error.to_string();
        assert!(
            !text.contains("503"),
            "loopback traffic was routed through a proxy: {text}"
        );
    }

    #[cfg(windows)]
    #[test]
    fn wininet_proxy_server_forms() {
        assert_eq!(
            parse_wininet_proxy_server("127.0.0.1:10808"),
            (
                Some("127.0.0.1:10808".to_string()),
                Some("127.0.0.1:10808".to_string())
            )
        );
        assert_eq!(
            parse_wininet_proxy_server("http=10.0.0.1:80;https=10.0.0.2:443;ftp=10.0.0.3:21"),
            (
                Some("10.0.0.1:80".to_string()),
                Some("10.0.0.2:443".to_string())
            )
        );
        assert_eq!(
            parse_wininet_proxy_server("socks=127.0.0.1:1080"),
            (None, None)
        );
        assert_eq!(parse_wininet_proxy_server(""), (None, None));
    }

    #[cfg(windows)]
    #[test]
    fn wininet_bypass_matches_windows_override_semantics() {
        let bypass = WinInetBypass::parse(
            "localhost.*;;<local>;localhost;127.*;10.*;172.16.*;192.168.*;*.internal.corp",
        );
        for host in [
            "127.0.0.1",
            "127.9.9.9",
            "localhost",
            "::1",
            "[::1]",
            "10.1.2.3",
            "192.168.1.5",
            "myhost",
            "api.internal.corp",
            "internal.corp",
        ] {
            assert!(bypass.matches_host(host), "expected {host} to bypass");
        }
        for host in ["api.example.com", "notinternal.corp", "8.8.8.8"] {
            assert!(!bypass.matches_host(host), "expected {host} to be proxied");
        }

        let all = WinInetBypass::parse("*");
        assert!(all.matches_host("api.example.com"));

        let empty = WinInetBypass::parse("");
        assert!(empty.matches_host("127.0.0.1"));
        assert!(empty.matches_host("localhost"));
        assert!(empty.matches_host("::1"));
        assert!(!empty.matches_host("api.example.com"));
    }
}
