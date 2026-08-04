use std::path::Path;
use std::sync::{Arc, Mutex};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

const ARIA2_RESOURCE_COMPONENT_ID: &str = "lyra.resource.aria2";
const ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD: &str = "resource.aria2.lease.acquire";
const ARIA2_RESOURCE_LEASE_RELEASE_METHOD: &str = "resource.aria2.lease.release";

pub type Aria2ResourceLeaseDispatcher =
    Arc<dyn Fn(&str, String) -> Result<String, String> + Send + Sync + 'static>;

static ARIA2_RESOURCE_LEASE_DISPATCHER: Lazy<Mutex<Option<Aria2ResourceLeaseDispatcher>>> =
    Lazy::new(|| Mutex::new(None));

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AcquireRequest<'a> {
    component_id: &'static str,
    task_id: &'a str,
    runtime_path: &'a str,
    component_version: &'a str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcquireResponse {
    component_id: String,
    task_id: String,
    lease_id: String,
    version: Option<String>,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseRequest<'a> {
    component_id: &'static str,
    task_id: &'a str,
    lease_id: &'a str,
}

pub(crate) struct Aria2ResourceLeaseGuard {
    task_id: String,
    lease_id: String,
    dispatcher: Aria2ResourceLeaseDispatcher,
}

pub fn register_aria2_resource_lease_dispatcher(dispatcher: Aria2ResourceLeaseDispatcher) {
    if let Ok(mut slot) = ARIA2_RESOURCE_LEASE_DISPATCHER.lock() {
        *slot = Some(dispatcher);
    }
}

pub fn clear_aria2_resource_lease_dispatcher() {
    if let Ok(mut slot) = ARIA2_RESOURCE_LEASE_DISPATCHER.lock() {
        *slot = None;
    }
}

fn current_dispatcher() -> Result<Aria2ResourceLeaseDispatcher, String> {
    ARIA2_RESOURCE_LEASE_DISPATCHER
        .lock()
        .map_err(|_| "aria2 resource lease dispatcher is unavailable".to_string())?
        .clone()
        .ok_or_else(|| "Core did not register the aria2 resource lease host bridge".to_string())
}

impl Aria2ResourceLeaseGuard {
    pub(crate) fn acquire(
        task_id: &str,
        runtime_path: &Path,
        component_version: &str,
    ) -> Result<Self, String> {
        Self::acquire_with_dispatcher(
            task_id,
            runtime_path,
            component_version,
            current_dispatcher()?,
        )
    }

    fn acquire_with_dispatcher(
        task_id: &str,
        runtime_path: &Path,
        component_version: &str,
        dispatcher: Aria2ResourceLeaseDispatcher,
    ) -> Result<Self, String> {
        let runtime_path = runtime_path
            .to_str()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "aria2 component path is not valid UTF-8".to_string())?;
        let request = serde_json::to_string(&AcquireRequest {
            component_id: ARIA2_RESOURCE_COMPONENT_ID,
            task_id,
            runtime_path,
            component_version,
        })
        .map_err(|error| format!("failed to encode aria2 resource lease request: {error}"))?;
        let response_json = dispatcher(ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD, request)?;
        let response: AcquireResponse = serde_json::from_str(&response_json)
            .map_err(|error| format!("failed to decode aria2 resource lease response: {error}"))?;
        if response.component_id != ARIA2_RESOURCE_COMPONENT_ID
            || response.task_id != task_id
            || response.lease_id.trim().is_empty()
            || (response.source != "component" && response.source != "development-fallback")
        {
            return Err("Core returned an invalid aria2 resource lease identity".to_string());
        }
        if response.source == "component" && response.version.as_deref() != Some(component_version)
        {
            return Err(format!(
                "Core leased aria2 component version {}; Runtime is bound to {component_version}",
                response.version.as_deref().unwrap_or("missing")
            ));
        }
        if response.source == "development-fallback" && response.version.is_some() {
            return Err("Core returned a versioned development aria2 fallback lease".to_string());
        }
        Ok(Self {
            task_id: task_id.to_string(),
            lease_id: response.lease_id,
            dispatcher,
        })
    }
}

impl Drop for Aria2ResourceLeaseGuard {
    fn drop(&mut self) {
        let request = match serde_json::to_string(&ReleaseRequest {
            component_id: ARIA2_RESOURCE_COMPONENT_ID,
            task_id: &self.task_id,
            lease_id: &self.lease_id,
        }) {
            Ok(request) => request,
            Err(error) => {
                eprintln!("failed to encode aria2 resource lease release: {error}");
                return;
            }
        };
        if let Err(error) = (self.dispatcher)(ARIA2_RESOURCE_LEASE_RELEASE_METHOD, request) {
            eprintln!("failed to release aria2 resource lease: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn keeps_the_host_lease_until_the_guard_is_dropped() {
        let calls = Arc::new(Mutex::new(Vec::<(String, String)>::new()));
        let recorded = Arc::clone(&calls);
        let dispatcher: Aria2ResourceLeaseDispatcher = Arc::new(move |method, payload| {
            recorded
                .lock()
                .expect("recorded calls")
                .push((method.to_string(), payload));
            Ok(if method == ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD {
                serde_json::json!({
                    "componentId": ARIA2_RESOURCE_COMPONENT_ID,
                    "taskId": "download-a",
                    "leaseId": "lease-a",
                    "version": "1.37.0",
                    "source": "component"
                })
                .to_string()
            } else {
                serde_json::json!({ "released": true }).to_string()
            })
        });

        let guard = Aria2ResourceLeaseGuard::acquire_with_dispatcher(
            "download-a",
            Path::new("/components/aria2c"),
            "1.37.0",
            dispatcher,
        )
        .expect("resource lease");
        assert_eq!(calls.lock().expect("calls").len(), 1);
        drop(guard);

        let calls = calls.lock().expect("calls");
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].0, ARIA2_RESOURCE_LEASE_ACQUIRE_METHOD);
        assert_eq!(calls[1].0, ARIA2_RESOURCE_LEASE_RELEASE_METHOD);
        let release: serde_json::Value =
            serde_json::from_str(&calls[1].1).expect("release payload");
        assert_eq!(release["taskId"], "download-a");
        assert_eq!(release["leaseId"], "lease-a");
    }

    #[test]
    fn rejects_a_lease_for_a_different_component_version() {
        let dispatcher: Aria2ResourceLeaseDispatcher = Arc::new(|_, _| {
            Ok(serde_json::json!({
                "componentId": ARIA2_RESOURCE_COMPONENT_ID,
                "taskId": "download-a",
                "leaseId": "lease-a",
                "version": "1.36.0",
                "source": "component"
            })
            .to_string())
        });

        let error = Aria2ResourceLeaseGuard::acquire_with_dispatcher(
            "download-a",
            Path::new("/components/aria2c"),
            "1.37.0",
            dispatcher,
        )
        .err()
        .expect("version mismatch");
        assert!(error.contains("Runtime is bound to 1.37.0"));
    }
}
