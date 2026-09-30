//! Host catalog snapshots, separate from tool discovery and execution.
//! A failed refresh is not an authoritative empty directory. A successful
//! empty response is, and replaces the previous catalog just like any update.
use super::*;
use std::sync::{Mutex, OnceLock, TryLockError, Weak};

#[derive(Default)]
struct Snapshot {
    attempted: bool,
    manifests: Vec<ToolManifest>,
    diagnostics: Vec<Value>,
}

#[derive(Default)]
struct CatalogSlot {
    snapshot: Mutex<Snapshot>,
    refresh: Mutex<()>,
}

impl CatalogSlot {
    fn read(&self) -> (bool, Vec<ToolManifest>, Vec<Value>) {
        let snapshot = self.snapshot.lock().unwrap_or_else(|e| e.into_inner());
        (
            snapshot.attempted,
            snapshot.manifests.clone(),
            snapshot.diagnostics.clone(),
        )
    }
}

struct HostCatalog {
    host: Weak<HostCapabilityDispatcher>,
    snapshot: Arc<CatalogSlot>,
}

fn slot(dispatcher: &Arc<HostCapabilityDispatcher>) -> Arc<CatalogSlot> {
    static CATALOGS: OnceLock<Mutex<Vec<HostCatalog>>> = OnceLock::new();
    let mut catalogs = CATALOGS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    catalogs.retain(|entry| entry.host.strong_count() > 0);
    if let Some(entry) = catalogs
        .iter()
        .find(|entry| entry.host.ptr_eq(&Arc::downgrade(dispatcher)))
    {
        return entry.snapshot.clone();
    }
    let snapshot = Arc::new(CatalogSlot::default());
    catalogs.push(HostCatalog {
        host: Arc::downgrade(dispatcher),
        snapshot: snapshot.clone(),
    });
    snapshot
}

pub(crate) fn software_catalog(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    refresh: bool,
) -> (Vec<ToolManifest>, Vec<Value>) {
    let Some(dispatcher) = dispatcher else {
        return (
            Vec::new(),
            vec![json!({"code":"host_unavailable", "domain":"software",
            "message":"Lyra software host is not connected.", "recoverable":true})],
        );
    };
    let slot = slot(dispatcher);
    let (attempted, manifests, diagnostics) = slot.read();
    if attempted && !refresh {
        return (manifests, diagnostics);
    }
    // A slow renderer must not block ordinary searches against a valid
    // snapshot, and concurrent turns share one in-flight refresh.
    let _refresh_guard = match slot.refresh.try_lock() {
        Ok(guard) => guard,
        Err(TryLockError::Poisoned(error)) => error.into_inner(),
        Err(TryLockError::WouldBlock) => {
            if !attempted {
                drop(slot.refresh.lock().unwrap_or_else(|e| e.into_inner()));
            }
            let (_, manifests, diagnostics) = slot.read();
            return (manifests, diagnostics);
        }
    };
    let (attempted, manifests, diagnostics) = slot.read();
    if attempted && !refresh {
        return (manifests, diagnostics);
    }
    let result = invoke_host_capability_with_timeout(
        dispatcher.clone(),
        "software.listCapabilities".into(),
        json!({"includeSchemas":true}),
        DEFAULT_HOST_TOOL_TIMEOUT_MS,
    )
    .and_then(|value| parse_catalog(&value));
    store_result(&slot, result);
    let (_, manifests, diagnostics) = slot.read();
    (manifests, diagnostics)
}

fn parse_catalog(value: &Value) -> Result<Vec<ToolManifest>, String> {
    if value
        .get("hostCapabilityAvailable")
        .and_then(Value::as_bool)
        == Some(false)
    {
        return Err("Software capability snapshot is not available yet.".into());
    }
    let software = value
        .get("software")
        .and_then(Value::as_array)
        .ok_or_else(|| "software catalog response is missing its software array".to_string())?;
    if software.iter().any(|entry| {
        entry.get("id").and_then(Value::as_str).is_none()
            || entry.get("actions").and_then(Value::as_array).is_none()
    }) {
        return Err("software catalog contains an invalid capability entry".into());
    }
    Ok(software
        .iter()
        .flat_map(registry::software_action_manifests)
        .collect::<Vec<_>>())
}

fn store_result(slot: &CatalogSlot, result: Result<Vec<ToolManifest>, String>) {
    let mut snapshot = slot.snapshot.lock().unwrap_or_else(|e| e.into_inner());
    snapshot.attempted = true;
    match result {
        Ok(manifests) => {
            snapshot.diagnostics = if manifests.is_empty() {
                vec![json!({"code":"dynamic_provider_empty", "domain":"software",
                        "message":"No Lyra software capabilities are currently registered.", "recoverable":true})]
            } else {
                Vec::new()
            };
            snapshot.manifests = manifests;
        }
        Err(error) => {
            snapshot.diagnostics = vec![
                json!({"code":"dynamic_provider_failed", "domain":"software",
                    "message":error, "usingLastKnownCatalog":!snapshot.manifests.is_empty(), "recoverable":true}),
            ];
        }
    }
}

/// Install the catalog already captured for this turn. No renderer round trip.
pub(crate) fn update_software_catalog(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
    value: &Value,
) {
    if let Some(dispatcher) = dispatcher {
        store_result(&slot(dispatcher), parse_catalog(value));
    }
}

/// Explicit ToolSearch refresh; ordinary turn preparation supplies its snapshot.
pub(crate) fn refresh_software_catalog(dispatcher: Option<&Arc<HostCapabilityDispatcher>>) {
    software_catalog(dispatcher, true);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn concurrent_search_and_refresh_share_snapshot_without_waiting_on_renderer() {
        let requests = Arc::new(AtomicUsize::new(0));
        let count = requests.clone();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let release_rx = Mutex::new(release_rx);
        let host: Arc<HostCapabilityDispatcher> = Arc::new(move |_, _| {
            if count.fetch_add(1, Ordering::SeqCst) == 1 {
                entered_tx.send(()).unwrap();
                release_rx
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(2))
                    .unwrap();
            }
            Ok(json!({"software":[]}).to_string())
        });
        software_catalog(Some(&host), false);
        let worker_host = host.clone();
        let refresh = std::thread::spawn(move || software_catalog(Some(&worker_host), true));
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        software_catalog(Some(&host), false);
        software_catalog(Some(&host), true);
        assert_eq!(requests.load(Ordering::SeqCst), 2);
        release_tx.send(()).unwrap();
        refresh.join().unwrap();
    }

    #[test]
    fn refresh_failure_retains_snapshot_but_successful_removal_replaces_it() {
        let requests = Arc::new(AtomicUsize::new(0));
        let mode = Arc::new(AtomicUsize::new(0));
        let (count, response) = (requests.clone(), mode.clone());
        let host: Arc<HostCapabilityDispatcher> = Arc::new(move |_, _| {
            count.fetch_add(1, Ordering::SeqCst);
            match response.load(Ordering::SeqCst) {
                1 => Err("renderer temporarily unavailable".into()),
                2 => Ok(json!({"software":[]}).to_string()),
                3 => Ok(json!({}).to_string()),
                _ => Ok(
                    json!({"software":[{"id":"images","name":"Images","actions":[{
                        "id":"read","title":"Read image","inputSchema":{"type":"object"}
                    }]}]})
                    .to_string(),
                ),
            }
        });
        let initial = software_catalog(Some(&host), false);
        assert_eq!(initial.0.len(), 1);
        for _ in 0..10 {
            assert_eq!(software_catalog(Some(&host), false).0.len(), 1);
        }
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        for failure in [1, 3] {
            mode.store(failure, Ordering::SeqCst);
            let stale = software_catalog(Some(&host), true);
            assert_eq!(stale.0.len(), 1);
            assert_eq!(stale.1[0]["code"], "dynamic_provider_failed");
            assert_eq!(stale.1[0]["usingLastKnownCatalog"], true);
        }
        mode.store(2, Ordering::SeqCst);
        assert!(software_catalog(Some(&host), true).0.is_empty());
        let other: Arc<HostCapabilityDispatcher> = Arc::new(|_, _| Err("other host".into()));
        assert!(software_catalog(Some(&other), false).0.is_empty());
        assert!(software_catalog(None, false).0.is_empty());
    }
}
