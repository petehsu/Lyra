use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::HardwareError;

pub trait SerialTransport: Send {
    fn read_available(&mut self, max_bytes: usize) -> Result<Vec<u8>, HardwareError>;
    fn write_all_bytes(&mut self, bytes: &[u8]) -> Result<usize, HardwareError>;
}

pub trait SerialTransportFactory: Send + Sync {
    fn open(&self, path: &str, baud_rate: u32) -> Result<Box<dyn SerialTransport>, HardwareError>;
}

#[derive(Default)]
struct RealSerialTransportFactory;

impl SerialTransportFactory for RealSerialTransportFactory {
    fn open(&self, path: &str, baud_rate: u32) -> Result<Box<dyn SerialTransport>, HardwareError> {
        let port = serialport::new(path, baud_rate)
            .timeout(Duration::from_millis(40))
            .open()
            .map_err(|error| HardwareError::new("serial_open_failed", error.to_string()))?;
        Ok(Box::new(RealSerialTransport { port }))
    }
}

struct RealSerialTransport {
    port: Box<dyn serialport::SerialPort>,
}

impl SerialTransport for RealSerialTransport {
    fn read_available(&mut self, max_bytes: usize) -> Result<Vec<u8>, HardwareError> {
        let mut buffer = vec![0_u8; max_bytes.max(1)];
        match self.port.read(&mut buffer) {
            Ok(count) => {
                buffer.truncate(count);
                Ok(buffer)
            }
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => Ok(Vec::new()),
            Err(error) => Err(HardwareError::new("serial_read_failed", error.to_string())),
        }
    }

    fn write_all_bytes(&mut self, bytes: &[u8]) -> Result<usize, HardwareError> {
        self.port
            .write_all(bytes)
            .map_err(|error| HardwareError::new("serial_write_failed", error.to_string()))?;
        Ok(bytes.len())
    }
}

#[derive(Default)]
pub struct MockSerialTransport {
    pub reads: VecDeque<Vec<u8>>,
    pub writes: Vec<Vec<u8>>,
}

impl SerialTransport for MockSerialTransport {
    fn read_available(&mut self, _max_bytes: usize) -> Result<Vec<u8>, HardwareError> {
        Ok(self.reads.pop_front().unwrap_or_default())
    }

    fn write_all_bytes(&mut self, bytes: &[u8]) -> Result<usize, HardwareError> {
        self.writes.push(bytes.to_vec());
        Ok(bytes.len())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSessionConfig {
    pub device_id: String,
    pub path: String,
    #[serde(default = "default_baud_rate")]
    pub baud_rate: u32,
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSession {
    pub session_id: String,
    pub device_id: String,
    pub path: String,
    pub baud_rate: u32,
    pub mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSessionReadRequest {
    pub session_id: String,
    #[serde(default = "default_max_read_bytes")]
    pub max_bytes: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSessionReadResponse {
    pub session_id: String,
    pub text: String,
    pub bytes_read: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSessionWriteRequest {
    pub session_id: String,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub line: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HardwareSessionWriteResponse {
    pub session_id: String,
    pub bytes_written: usize,
}

pub(crate) struct HardwareSessionEntry {
    session: HardwareSession,
    transport: Box<dyn SerialTransport>,
}

pub(crate) struct HardwareSessionRegistry {
    factory: Box<dyn SerialTransportFactory>,
    sessions: HashMap<String, HardwareSessionEntry>,
}

impl Default for HardwareSessionRegistry {
    fn default() -> Self {
        Self {
            factory: Box::<RealSerialTransportFactory>::default(),
            sessions: HashMap::new(),
        }
    }
}

impl HardwareSessionRegistry {
    #[cfg(test)]
    pub(crate) fn with_factory(factory: Box<dyn SerialTransportFactory>) -> Self {
        Self {
            factory,
            sessions: HashMap::new(),
        }
    }

    pub(crate) fn open(
        &mut self,
        config: HardwareSessionConfig,
    ) -> Result<HardwareSession, HardwareError> {
        validate_config(&config)?;
        let transport = self.factory.open(&config.path, config.baud_rate)?;
        let session = HardwareSession {
            session_id: format!("hardware-session-{}", Uuid::new_v4()),
            device_id: config.device_id,
            path: config.path,
            baud_rate: config.baud_rate,
            mode: config.mode.unwrap_or_else(|| "serial.uart".to_string()),
        };
        self.sessions.insert(
            session.session_id.clone(),
            HardwareSessionEntry {
                session: session.clone(),
                transport,
            },
        );
        Ok(session)
    }

    pub(crate) fn read(
        &mut self,
        request: HardwareSessionReadRequest,
    ) -> Result<HardwareSessionReadResponse, HardwareError> {
        let entry = self.entry_mut(&request.session_id)?;
        let bytes = entry
            .transport
            .read_available(request.max_bytes.min(64_000))?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        Ok(HardwareSessionReadResponse {
            session_id: entry.session.session_id.clone(),
            text,
            bytes_read: bytes.len(),
        })
    }

    pub(crate) fn write(
        &mut self,
        request: HardwareSessionWriteRequest,
    ) -> Result<HardwareSessionWriteResponse, HardwareError> {
        let entry = self.entry_mut(&request.session_id)?;
        let payload = request
            .line
            .map(|line| format!("{line}\r\n"))
            .or(request.text)
            .ok_or_else(|| HardwareError::new("bad_hardware_write", "text or line is required"))?;
        let bytes_written = entry.transport.write_all_bytes(payload.as_bytes())?;
        Ok(HardwareSessionWriteResponse {
            session_id: entry.session.session_id.clone(),
            bytes_written,
        })
    }

    pub(crate) fn close(&mut self, session_id: &str) -> Result<(), HardwareError> {
        self.sessions
            .remove(session_id)
            .map(|_| ())
            .ok_or_else(|| HardwareError::not_found("session", session_id.to_string()))
    }

    fn entry_mut(&mut self, session_id: &str) -> Result<&mut HardwareSessionEntry, HardwareError> {
        self.sessions
            .get_mut(session_id)
            .ok_or_else(|| HardwareError::not_found("session", session_id.to_string()))
    }
}

fn default_baud_rate() -> u32 {
    115_200
}

fn default_max_read_bytes() -> usize {
    8192
}

fn validate_config(config: &HardwareSessionConfig) -> Result<(), HardwareError> {
    if config.path.trim().is_empty() || config.device_id.trim().is_empty() {
        return Err(HardwareError::new(
            "bad_hardware_session",
            "deviceId and path are required",
        ));
    }
    if !(300..=4_000_000).contains(&config.baud_rate) {
        return Err(HardwareError::new(
            "bad_baud_rate",
            "baudRate must be between 300 and 4000000",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct OneMockFactory;

    impl SerialTransportFactory for OneMockFactory {
        fn open(
            &self,
            _path: &str,
            _baud_rate: u32,
        ) -> Result<Box<dyn SerialTransport>, HardwareError> {
            let mut mock = MockSerialTransport::default();
            mock.reads.push_back(b"boot ok\r\n".to_vec());
            Ok(Box::new(mock))
        }
    }

    #[test]
    fn validates_session_config_defaults_and_bad_baud() {
        let config = HardwareSessionConfig {
            device_id: "device".to_string(),
            path: "/dev/ttyUSB0".to_string(),
            baud_rate: default_baud_rate(),
            mode: None,
        };
        assert!(validate_config(&config).is_ok());
        assert!(
            validate_config(&HardwareSessionConfig {
                baud_rate: 1,
                ..config
            })
            .is_err()
        );
    }

    #[test]
    fn simulates_session_read_and_write() {
        let mut registry = HardwareSessionRegistry::with_factory(Box::new(OneMockFactory));
        let session = registry
            .open(HardwareSessionConfig {
                device_id: "device".to_string(),
                path: "/dev/ttyUSB0".to_string(),
                baud_rate: 115_200,
                mode: None,
            })
            .expect("open");
        let read = registry
            .read(HardwareSessionReadRequest {
                session_id: session.session_id.clone(),
                max_bytes: 1024,
            })
            .expect("read");
        assert_eq!(read.text, "boot ok\r\n");
        let write = registry
            .write(HardwareSessionWriteRequest {
                session_id: session.session_id,
                text: None,
                line: Some("AT".to_string()),
            })
            .expect("write");
        assert_eq!(write.bytes_written, 4);
    }
}
