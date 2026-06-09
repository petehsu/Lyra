use crate::{
    HardwareCapability, HardwareDevice, HardwareDeviceFilter, HardwareError, HardwareProtocolHint,
    HardwareTransport,
};

pub trait DeviceEnumerator: Send + Sync {
    fn list_devices(
        &self,
        filter: &HardwareDeviceFilter,
    ) -> Result<Vec<HardwareDevice>, HardwareError>;
}

#[derive(Default)]
pub struct SerialportDeviceEnumerator;

impl DeviceEnumerator for SerialportDeviceEnumerator {
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
        let ports = serialport::available_ports().map_err(|error| {
            HardwareError::new(
                "hardware_discovery_failed",
                format!("serial scan failed: {error}"),
            )
        })?;
        Ok(ports
            .into_iter()
            .map(|port| {
                let (vendor_id, product_id, manufacturer, product, serial_number) =
                    match port.port_type {
                        serialport::SerialPortType::UsbPort(info) => (
                            Some(info.vid),
                            Some(info.pid),
                            info.manufacturer,
                            info.product,
                            info.serial_number,
                        ),
                        _ => (None, None, None, None, None),
                    };
                serial_device(
                    port.port_name,
                    vendor_id,
                    product_id,
                    manufacturer,
                    product,
                    serial_number,
                )
            })
            .collect())
    }
}

pub fn normalize_serial_device_id(
    path: &str,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
) -> String {
    let stable_path = path.replace('\\', "/");
    match (vendor_id, product_id) {
        (Some(vid), Some(pid)) => format!("serial:{vid:04x}:{pid:04x}:{stable_path}"),
        _ => format!("serial:unknown:{stable_path}"),
    }
}

pub fn serial_device(
    path: String,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
    manufacturer: Option<String>,
    product: Option<String>,
    serial_number: Option<String>,
) -> HardwareDevice {
    let title = product
        .clone()
        .or_else(|| manufacturer.clone())
        .unwrap_or_else(|| path.clone());
    let protocol_hints = infer_protocol_hints(&title, vendor_id, product_id);
    HardwareDevice {
        id: normalize_serial_device_id(&path, vendor_id, product_id),
        path: path.clone(),
        title,
        transport: HardwareTransport::Serial,
        provider_id: "serial".to_string(),
        transport_path: Some(path.clone()),
        tags: vec!["serial".to_string(), "development_board".to_string()],
        confidence: Some(0.8),
        status: Some("available".to_string()),
        os_permissions: Vec::new(),
        driver_backends: vec![crate::HardwareDriverBackend {
            id: "serialport".to_string(),
            title: "Serial port".to_string(),
            status: "available".to_string(),
            detail: None,
        }],
        native_access: Some("read_write".to_string()),
        platform: Some(std::env::consts::OS.to_string()),
        vendor_id,
        product_id,
        manufacturer,
        product,
        serial_number,
        protocol_hints,
        capabilities: vec![
            capability(
                "serial.uart",
                "Serial console",
                "hardware.read.stream",
                &["open", "read", "write_line"],
            ),
            capability(
                "micropython.repl",
                "MicroPython REPL",
                "hardware.write.stream",
                &["enter_repl", "write_line"],
            ),
            capability(
                "esp.flash",
                "ESP firmware flashing",
                "hardware.flash",
                &["flash"],
            ),
        ],
    }
}

fn capability(id: &str, title: &str, risk: &str, actions: &[&str]) -> HardwareCapability {
    HardwareCapability {
        id: id.to_string(),
        title: title.to_string(),
        risk: risk.to_string(),
        permission: Some(risk.to_string()),
        risk_level: Some(
            if risk == "hardware.flash" {
                "critical"
            } else if risk == "hardware.write.stream" {
                "high"
            } else {
                "low"
            }
            .to_string(),
        ),
        input_schema: None,
        output_schema: None,
        streaming: id == "serial.uart",
        destructive: risk == "hardware.flash",
        os_permission: None,
        native_access: Some("read_write".to_string()),
        actions: actions.iter().map(|action| (*action).to_string()).collect(),
    }
}

fn infer_protocol_hints(
    title: &str,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
) -> Vec<HardwareProtocolHint> {
    let mut hints = vec![
        HardwareProtocolHint::UartConsole,
        HardwareProtocolHint::AtCommands,
    ];
    let lower = title.to_ascii_lowercase();
    if lower.contains("micropython") || lower.contains("circuitpython") {
        hints.push(HardwareProtocolHint::MicroPythonRepl);
    }
    if lower.contains("esp")
        || matches!(vendor_id, Some(0x303a | 0x10c4 | 0x1a86))
        || matches!(product_id, Some(0x1001 | 0x7523 | 0xea60))
    {
        hints.push(HardwareProtocolHint::EspSerialBoot);
    }
    hints
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_serial_device_ids() {
        assert_eq!(
            normalize_serial_device_id("/dev/cu.usbserial-110", Some(0x1a86), Some(0x7523)),
            "serial:1a86:7523:/dev/cu.usbserial-110"
        );
    }

    #[test]
    fn infers_esp_and_repl_capabilities() {
        let device = serial_device(
            "/dev/ttyUSB0".to_string(),
            Some(0x303a),
            Some(0x1001),
            Some("Espressif".to_string()),
            Some("ESP32-S3 MicroPython".to_string()),
            None,
        );
        assert!(
            device
                .protocol_hints
                .contains(&HardwareProtocolHint::EspSerialBoot)
        );
        assert!(
            device
                .protocol_hints
                .contains(&HardwareProtocolHint::MicroPythonRepl)
        );
        assert!(
            device
                .capabilities
                .iter()
                .any(|capability| capability.id == "esp.flash")
        );
    }
}
