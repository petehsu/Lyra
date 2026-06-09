use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareDeviceFilter {
    #[serde(default)]
    pub transport: Option<HardwareTransport>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub include_system: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HardwareTransport {
    Serial,
    Usb,
    Hid,
    Bluetooth,
    Network,
    Storage,
    DebugProbe,
    MediaAudio,
    MediaCamera,
    Toolchain,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HardwareProtocolHint {
    UartConsole,
    AtCommands,
    MicroPythonRepl,
    EspSerialBoot,
    UsbDevice,
    HidReports,
    BleGatt,
    NetworkInterface,
    MediaCapture,
    StorageVolume,
    DebugProbe,
    Toolchain,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareCapability {
    pub id: String,
    pub title: String,
    pub risk: String,
    #[serde(default)]
    pub permission: Option<String>,
    #[serde(default)]
    pub risk_level: Option<String>,
    #[serde(default)]
    pub input_schema: Option<Value>,
    #[serde(default)]
    pub output_schema: Option<Value>,
    #[serde(default)]
    pub streaming: bool,
    #[serde(default)]
    pub destructive: bool,
    #[serde(default)]
    pub os_permission: Option<String>,
    #[serde(default)]
    pub native_access: Option<String>,
    #[serde(default)]
    pub actions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareDevice {
    pub id: String,
    pub path: String,
    pub title: String,
    pub transport: HardwareTransport,
    #[serde(default)]
    pub provider_id: String,
    #[serde(default)]
    pub transport_path: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub confidence: Option<f32>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub os_permissions: Vec<HardwareOsPermissionState>,
    #[serde(default)]
    pub driver_backends: Vec<HardwareDriverBackend>,
    #[serde(default)]
    pub native_access: Option<String>,
    #[serde(default)]
    pub platform: Option<String>,
    #[serde(default)]
    pub vendor_id: Option<u16>,
    #[serde(default)]
    pub product_id: Option<u16>,
    #[serde(default)]
    pub manufacturer: Option<String>,
    #[serde(default)]
    pub product: Option<String>,
    #[serde(default)]
    pub serial_number: Option<String>,
    #[serde(default)]
    pub protocol_hints: Vec<HardwareProtocolHint>,
    #[serde(default)]
    pub capabilities: Vec<HardwareCapability>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareListRequest {
    #[serde(default)]
    pub filter: HardwareDeviceFilter,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareListResponse {
    pub devices: Vec<HardwareDevice>,
    #[serde(default)]
    pub provider_statuses: Vec<HardwareProviderStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInspectRequest {
    pub device_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInspectResponse {
    pub device: HardwareDevice,
    pub toolchains: Vec<HardwareToolchainState>,
    pub missing_tools: Vec<String>,
    #[serde(default)]
    pub os_permissions: Vec<HardwareOsPermissionState>,
    #[serde(default)]
    pub driver_backends: Vec<HardwareDriverBackend>,
    #[serde(default)]
    pub native_access: Option<String>,
    #[serde(default)]
    pub missing_requirements: Vec<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareCapabilitiesRequest {
    #[serde(default)]
    pub transport: Option<HardwareTransport>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub risk: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub os_permission: Option<String>,
    #[serde(default)]
    pub native_access: Option<String>,
    #[serde(default)]
    pub streaming: Option<bool>,
    #[serde(default)]
    pub destructive: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareCapabilityEntry {
    pub device_id: String,
    pub provider_id: String,
    pub transport: HardwareTransport,
    pub capability: HardwareCapability,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareCapabilitiesResponse {
    pub capabilities: Vec<HardwareCapabilityEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProviderStatus {
    pub provider_id: String,
    pub status: String,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareOsPermissionState {
    pub id: String,
    pub title: String,
    pub state: String,
    #[serde(default)]
    pub platform_hint: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareDriverBackend {
    pub id: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareOsStatusRequest {
    #[serde(default)]
    pub include_permissions: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareOsStatusResponse {
    pub platform: String,
    pub arch: String,
    pub family: String,
    #[serde(default)]
    pub permissions: Vec<HardwareOsPermissionState>,
    #[serde(default)]
    pub driver_backends: Vec<HardwareDriverBackend>,
    #[serde(default)]
    pub system_limits: Vec<String>,
    #[serde(default)]
    pub provider_statuses: Vec<HardwareProviderStatus>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwarePermissionRequest {
    pub permission_id: String,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwarePermissionResponse {
    pub permission_id: String,
    pub status: String,
    pub platform: String,
    #[serde(default)]
    pub guidance: Option<String>,
    #[serde(default)]
    pub attempted_system_prompt: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareToolchainState {
    pub name: String,
    pub status: crate::ToolchainStatus,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub install_hint: Option<String>,
}
