use crate::{
    DeviceEnumerator, HardwareActionRequest, HardwareActionResponse, HardwareDevice,
    HardwareDeviceFilter, HardwareError, HardwareProvider, HardwareTransport,
    SerialportDeviceEnumerator, actions, session::HardwareSessionRegistry,
    toolchain::ToolchainProbe,
};

#[derive(Default)]
pub struct SerialProvider {
    enumerator: SerialportDeviceEnumerator,
}

impl HardwareProvider for SerialProvider {
    fn id(&self) -> &'static str {
        "serial"
    }

    fn list_devices(
        &self,
        filter: &HardwareDeviceFilter,
    ) -> Result<Vec<HardwareDevice>, HardwareError> {
        if !matches!(
            filter.transport,
            None | Some(HardwareTransport::Serial) | Some(HardwareTransport::Usb)
        ) {
            return Ok(Vec::new());
        }
        self.enumerator.list_devices(filter)
    }

    fn invoke(
        &self,
        request: &HardwareActionRequest,
    ) -> Result<Option<HardwareActionResponse>, HardwareError> {
        if !matches!(
            request.capability_id.as_str(),
            "serial.uart" | "micropython.repl" | "esp.flash"
        ) {
            return Ok(None);
        }
        let mut sessions = HardwareSessionRegistry::default();
        let toolchains = ToolchainProbe::default();
        actions::run_action(&mut sessions, &toolchains, request.clone()).map(Some)
    }
}
