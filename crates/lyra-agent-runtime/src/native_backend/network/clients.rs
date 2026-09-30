//! Transport pools live across model rounds. Authentication stays on requests.
//! Replace pools when proxy/timeout settings change; active requests retain
//! their client so changing settings cannot interrupt another conversation.
use super::*;
use std::ffi::OsString;
use std::sync::Mutex;

#[derive(Default)]
struct Clients<C> {
    settings: Vec<Option<OsString>>,
    streaming: Option<C>,
    non_streaming: Option<C>,
}

fn transport_settings() -> Vec<Option<OsString>> {
    let mut settings = PROXY_ENV_VARS
        .iter()
        .chain(NO_PROXY_ENV_VARS.iter())
        .map(env::var_os)
        .collect::<Vec<_>>();
    settings.push(env::var_os("LYRA_PROVIDER_STREAMING_IDLE_TIMEOUT_MS"));
    #[cfg(windows)]
    {
        let registry = windows_registry::CURRENT_USER
            .open("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
            .ok();
        settings.push(
            registry
                .as_ref()
                .and_then(|key| key.get_u32("ProxyEnable").ok())
                .map(|v| v.to_string().into()),
        );
        for name in ["ProxyServer", "ProxyOverride"] {
            settings.push(
                registry
                    .as_ref()
                    .and_then(|key| key.get_string(name).ok())
                    .map(Into::into),
            );
        }
    }
    settings
}

fn cached<C: Clone>(
    store: &Mutex<Clients<C>>,
    settings: Vec<Option<OsString>>,
    streaming: bool,
    build: impl FnOnce() -> Result<C, reqwest::Error>,
) -> AgentRuntimeResult<C> {
    let mut clients = store.lock().unwrap_or_else(|e| e.into_inner());
    if clients.settings != settings {
        clients.settings = settings;
        clients.streaming = None;
        clients.non_streaming = None;
    }
    let slot = if streaming {
        &mut clients.streaming
    } else {
        &mut clients.non_streaming
    };
    if let Some(client) = slot.as_ref() {
        return Ok(client.clone());
    }
    let client = build().map_err(|error| AgentRuntimeError::Core(error.to_string()))?;
    *slot = Some(client.clone());
    Ok(client)
}

pub(crate) fn provider_http_client_async(streaming: bool) -> AgentRuntimeResult<reqwest::Client> {
    static CLIENTS: OnceLock<Mutex<Clients<reqwest::Client>>> = OnceLock::new();
    cached(
        CLIENTS.get_or_init(Default::default),
        transport_settings(),
        streaming,
        || provider_http_client_builder_async(streaming).build(),
    )
}

pub(crate) fn provider_http_client(
    streaming: bool,
) -> AgentRuntimeResult<reqwest::blocking::Client> {
    static CLIENTS: OnceLock<Mutex<Clients<reqwest::blocking::Client>>> = OnceLock::new();
    cached(
        CLIENTS.get_or_init(Default::default),
        transport_settings(),
        streaming,
        || provider_http_client_builder(streaming).build(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn settings_replace_both_pools_without_invalidating_live_handles() {
        let store = Mutex::new(Clients::<Arc<usize>>::default());
        let count = AtomicUsize::new(0);
        let build = || Ok(Arc::new(count.fetch_add(1, Ordering::SeqCst)));
        let old = cached(&store, vec![], true, build).unwrap();
        assert!(Arc::ptr_eq(
            &old,
            &cached(&store, vec![], true, build).unwrap()
        ));
        let other = cached(&store, vec![], false, build).unwrap();
        assert!(!Arc::ptr_eq(&old, &other));
        let settings = vec![Some(OsString::from("proxy-settings-changed"))];
        let new = cached(&store, settings.clone(), true, build).unwrap();
        assert!(!Arc::ptr_eq(&old, &new));
        assert!(!Arc::ptr_eq(
            &other,
            &cached(&store, settings, false, build).unwrap()
        ));
        assert_eq!(*old, 0);
        assert_eq!(count.load(Ordering::SeqCst), 4);
    }
}
