use lyra_runtime_protocol::{PROTOCOL_VERSION, RuntimeEnvelope, RuntimeError};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct RuntimeEvent {
    pub event: String,
    pub payload: Value,
}

pub struct RuntimeSocketClient {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pending: Arc<Mutex<HashMap<String, mpsc::Sender<Result<Value, RuntimeError>>>>>,
    events: mpsc::Receiver<RuntimeEvent>,
    next_id: AtomicU64,
}

impl RuntimeSocketClient {
    #[cfg(unix)]
    pub fn connect(socket_path: &str) -> Result<Self, String> {
        use std::os::unix::net::UnixStream;

        let stream = UnixStream::connect(socket_path)
            .map_err(|error| format!("connect Lyra runtime socket failed: {error}"))?;
        let reader = stream
            .try_clone()
            .map_err(|error| format!("clone Lyra runtime socket failed: {error}"))?;
        let client = Self::new(Box::new(stream), Box::new(reader));
        let handshake = client.request(
            "runtime.handshake",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "clientName": "lyra-cli"
            }),
            Duration::from_secs(5),
        )?;
        let protocol = handshake
            .get("protocolVersion")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        if protocol != u64::from(PROTOCOL_VERSION) {
            return Err(format!(
                "Lyra runtime protocol mismatch: expected {}, got {}",
                PROTOCOL_VERSION, protocol
            ));
        }
        Ok(client)
    }

    #[cfg(not(unix))]
    pub fn connect(_socket_path: &str) -> Result<Self, String> {
        Err("Lyra desktop CLI socket mode is currently available on Unix targets only.".to_string())
    }

    fn new(reader_writer: Box<dyn Write + Send>, reader: Box<dyn std::io::Read + Send>) -> Self {
        let pending: Arc<Mutex<HashMap<String, mpsc::Sender<Result<Value, RuntimeError>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let (event_tx, events) = mpsc::channel();
        let pending_for_reader = pending.clone();
        thread::spawn(move || {
            let reader = BufReader::new(reader);
            for line in reader.lines().map_while(Result::ok) {
                if line.trim().is_empty() {
                    continue;
                }
                let Ok(envelope) = serde_json::from_str::<RuntimeEnvelope>(&line) else {
                    continue;
                };
                match envelope {
                    RuntimeEnvelope::Response {
                        id,
                        ok,
                        result,
                        error,
                    } => {
                        let sender = pending_for_reader
                            .lock()
                            .ok()
                            .and_then(|mut pending| pending.remove(&id));
                        if let Some(sender) = sender {
                            let _ = sender.send(if ok {
                                Ok(result.unwrap_or(Value::Null))
                            } else {
                                Err(error.unwrap_or_else(|| {
                                    RuntimeError::new("RUNTIME_ERROR", "runtime request failed")
                                }))
                            });
                        }
                    }
                    RuntimeEnvelope::Event { event, payload } => {
                        let _ = event_tx.send(RuntimeEvent { event, payload });
                    }
                    RuntimeEnvelope::Request { .. } => {
                        // Do not answer unknown host capability requests. The desktop
                        // renderer owns those bridges; replying from CLI would race it.
                    }
                }
            }
        });
        Self {
            writer: Arc::new(Mutex::new(reader_writer)),
            pending,
            events,
            next_id: AtomicU64::new(1),
        }
    }

    pub fn request(
        &self,
        method: &str,
        payload: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = format!("cli-{}", self.next_id.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|_| "runtime pending map lock failed".to_string())?
            .insert(id.clone(), tx);
        self.write_envelope(RuntimeEnvelope::Request {
            id: id.clone(),
            method: method.to_string(),
            payload,
        })?;
        match rx.recv_timeout(timeout) {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(error)) => Err(error.message),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                Err(format!("runtime request timed out: {method}"))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err("runtime socket reader disconnected".to_string())
            }
        }
    }

    pub fn recv_event_timeout(&self, timeout: Duration) -> Option<RuntimeEvent> {
        self.events.recv_timeout(timeout).ok()
    }

    fn write_envelope(&self, envelope: RuntimeEnvelope) -> Result<(), String> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|_| "runtime writer lock failed".to_string())?;
        let encoded = serde_json::to_vec(&envelope)
            .map_err(|error| format!("serialize runtime envelope failed: {error}"))?;
        writer
            .write_all(&encoded)
            .and_then(|_| writer.write_all(b"\n"))
            .and_then(|_| writer.flush())
            .map_err(|error| format!("write runtime envelope failed: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn request_envelopes_are_ignored_by_reader_without_response() {
        let request = serde_json::to_vec(&RuntimeEnvelope::Request {
            id: "host-1".to_string(),
            method: "terminal.create".to_string(),
            payload: json!({}),
        })
        .expect("request");
        let reader = Cursor::new([request, b"\n".to_vec()].concat());
        let writer = Cursor::new(Vec::<u8>::new());
        let client = RuntimeSocketClient::new(Box::new(writer), Box::new(reader));
        assert!(
            client
                .recv_event_timeout(Duration::from_millis(20))
                .is_none()
        );
    }
}
