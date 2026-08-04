#![cfg_attr(test, allow(clippy::expect_used, clippy::unwrap_used))]

mod actions;
mod audit;
mod broker;
mod discovery;
mod error;
mod model;
mod provider;
mod providers;
mod session;
mod toolchain;

pub use actions::{HardwareActionRequest, HardwareActionResponse};
pub use audit::{HardwareAuditRecord, HardwareAuditSink, MemoryAuditSink};
pub use broker::HardwareBroker;
pub use discovery::{DeviceEnumerator, SerialportDeviceEnumerator};
pub use error::HardwareError;
pub use model::{
    HardwareCapabilitiesRequest, HardwareCapabilitiesResponse, HardwareCapability,
    HardwareCapabilityEntry, HardwareDevice, HardwareDeviceFilter, HardwareDriverBackend,
    HardwareInspectRequest, HardwareInspectResponse, HardwareListRequest, HardwareListResponse,
    HardwareOsPermissionState, HardwareOsStatusRequest, HardwareOsStatusResponse,
    HardwarePermissionRequest, HardwarePermissionResponse, HardwareProtocolHint,
    HardwareProviderStatus, HardwareToolchainState, HardwareTransport,
};
pub use provider::HardwareProvider;
pub use providers::{
    BluetoothBleProvider, DebugProbeProvider, HidProvider, InputProvider, MediaAudioProvider,
    MediaCameraProvider, NetworkInterfaceProvider, OsProvider, SerialProvider, StorageProvider,
    ToolchainProvider, UsbProvider,
};
pub use session::{
    HardwareSession, HardwareSessionConfig, HardwareSessionReadRequest,
    HardwareSessionReadResponse, HardwareSessionWriteRequest, HardwareSessionWriteResponse,
    MockSerialTransport, SerialTransportFactory,
};
pub use toolchain::{ToolchainDetector, ToolchainProbe, ToolchainStatus};

use std::sync::{Arc, Mutex};

use serde_json::Value;

#[derive(Clone)]
pub struct HardwareService {
    inner: Arc<Mutex<HardwareServiceInner>>,
}

struct HardwareServiceInner {
    broker: HardwareBroker,
    toolchains: Arc<dyn ToolchainDetector>,
    sessions: session::HardwareSessionRegistry,
    audit: Arc<dyn HardwareAuditSink>,
    os: OsProvider,
}

impl Default for HardwareService {
    fn default() -> Self {
        Self::with_broker(
            default_broker(),
            Arc::new(ToolchainProbe::default()),
            Arc::new(MemoryAuditSink::default()),
        )
    }
}

impl HardwareService {
    pub fn new(
        enumerator: Arc<dyn DeviceEnumerator>,
        toolchains: Arc<dyn ToolchainDetector>,
        audit: Arc<dyn HardwareAuditSink>,
    ) -> Self {
        struct EnumeratorProvider {
            enumerator: Arc<dyn DeviceEnumerator>,
        }

        impl HardwareProvider for EnumeratorProvider {
            fn id(&self) -> &'static str {
                "serial"
            }

            fn list_devices(
                &self,
                filter: &HardwareDeviceFilter,
            ) -> Result<Vec<HardwareDevice>, HardwareError> {
                self.enumerator.list_devices(filter)
            }
        }

        Self::with_broker(
            HardwareBroker::new(vec![Arc::new(EnumeratorProvider { enumerator })]),
            toolchains,
            audit,
        )
    }

    pub fn with_broker(
        broker: HardwareBroker,
        toolchains: Arc<dyn ToolchainDetector>,
        audit: Arc<dyn HardwareAuditSink>,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HardwareServiceInner {
                broker,
                toolchains,
                sessions: session::HardwareSessionRegistry::default(),
                audit,
                os: OsProvider,
            })),
        }
    }

    pub fn list(
        &self,
        request: HardwareListRequest,
    ) -> Result<HardwareListResponse, HardwareError> {
        let inner = self.inner.lock().map_err(|_| HardwareError::poisoned())?;
        Ok(inner.broker.list(request))
    }

    pub fn inspect(
        &self,
        request: HardwareInspectRequest,
    ) -> Result<HardwareInspectResponse, HardwareError> {
        let inner = self.inner.lock().map_err(|_| HardwareError::poisoned())?;
        let device = inner.broker.find_device(&request.device_id)?;
        let toolchains = inner.toolchains.detect();
        let missing_tools = toolchains
            .iter()
            .filter(|tool| matches!(tool.status, ToolchainStatus::Missing))
            .map(|tool| tool.name.clone())
            .collect();
        Ok(HardwareInspectResponse {
            os_permissions: device.os_permissions.clone(),
            driver_backends: device.driver_backends.clone(),
            native_access: device.native_access.clone(),
            device,
            toolchains,
            missing_tools,
            missing_requirements: Vec::new(),
        })
    }

    pub fn os_status(
        &self,
        _request: HardwareOsStatusRequest,
    ) -> Result<HardwareOsStatusResponse, HardwareError> {
        let inner = self.inner.lock().map_err(|_| HardwareError::poisoned())?;
        let provider_statuses = inner
            .broker
            .list(HardwareListRequest {
                filter: HardwareDeviceFilter {
                    include_system: true,
                    ..HardwareDeviceFilter::default()
                },
            })
            .provider_statuses;
        Ok(inner.os.status(provider_statuses))
    }

    pub fn permissions_request(
        &self,
        request: HardwarePermissionRequest,
    ) -> Result<HardwarePermissionResponse, HardwareError> {
        let inner = self.inner.lock().map_err(|_| HardwareError::poisoned())?;
        inner.os.request_permission(request)
    }

    pub fn capabilities(
        &self,
        request: HardwareCapabilitiesRequest,
    ) -> Result<HardwareCapabilitiesResponse, HardwareError> {
        let inner = self.inner.lock().map_err(|_| HardwareError::poisoned())?;
        Ok(inner.broker.capabilities(request))
    }

    pub fn session_open(
        &self,
        request: HardwareSessionConfig,
    ) -> Result<HardwareSession, HardwareError> {
        let mut inner = self.inner.lock().map_err(|_| HardwareError::poisoned())?;
        let session = inner.sessions.open(request.clone())?;
        inner.audit.record(HardwareAuditRecord::new(
            "session_open",
            Some(request.device_id),
            Value::Null,
        ));
        Ok(session)
    }

    pub fn session_read(
        &self,
        request: HardwareSessionReadRequest,
    ) -> Result<HardwareSessionReadResponse, HardwareError> {
        let mut inner = self.inner.lock().map_err(|_| HardwareError::poisoned())?;
        inner.sessions.read(request)
    }

    pub fn session_write(
        &self,
        request: HardwareSessionWriteRequest,
    ) -> Result<HardwareSessionWriteResponse, HardwareError> {
        let mut inner = self.inner.lock().map_err(|_| HardwareError::poisoned())?;
        let response = inner.sessions.write(request.clone())?;
        inner.audit.record(HardwareAuditRecord::new(
            "session_write",
            Some(request.session_id),
            serde_json::json!({ "bytes": response.bytes_written }),
        ));
        Ok(response)
    }

    pub fn session_close(&self, session_id: &str) -> Result<(), HardwareError> {
        let mut inner = self.inner.lock().map_err(|_| HardwareError::poisoned())?;
        inner.sessions.close(session_id)?;
        inner.audit.record(HardwareAuditRecord::new(
            "session_close",
            Some(session_id.to_string()),
            Value::Null,
        ));
        Ok(())
    }

    pub fn run_action(
        &self,
        request: HardwareActionRequest,
    ) -> Result<HardwareActionResponse, HardwareError> {
        self.invoke(request)
    }

    pub fn invoke(
        &self,
        request: HardwareActionRequest,
    ) -> Result<HardwareActionResponse, HardwareError> {
        let mut inner = self.inner.lock().map_err(|_| HardwareError::poisoned())?;
        if matches!(
            request.capability_id.as_str(),
            "serial.uart" | "micropython.repl" | "esp.flash"
        ) {
            let toolchains = inner.toolchains.clone();
            return actions::run_action(&mut inner.sessions, toolchains.as_ref(), request);
        }
        inner.broker.invoke(request)
    }
}

fn default_broker() -> HardwareBroker {
    HardwareBroker::new(vec![
        Arc::new(SerialProvider::default()),
        Arc::new(InputProvider),
        Arc::new(UsbProvider),
        Arc::new(HidProvider),
        Arc::new(BluetoothBleProvider),
        Arc::new(NetworkInterfaceProvider),
        Arc::new(MediaAudioProvider),
        Arc::new(MediaCameraProvider),
        Arc::new(StorageProvider),
        Arc::new(DebugProbeProvider),
        Arc::new(ToolchainProvider::default()),
    ])
}
