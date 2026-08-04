use lyra_runtime_protocol::{
    PROTOCOL_MAX_VERSION, PROTOCOL_MIN_VERSION, RuntimeConnectionRole, RuntimeEnvelope,
    RuntimeError, RuntimeHelloV2Request, RuntimeHelloV2Response,
};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
        let hello = runtime_hello_request();
        let handshake = client.request(
            "runtime.handshake",
            serde_json::to_value(&hello)
                .map_err(|error| format!("encode RuntimeHelloV2 failed: {error}"))?,
            Duration::from_secs(5),
        )?;
        let response: RuntimeHelloV2Response = serde_json::from_value(handshake)
            .map_err(|error| format!("invalid RuntimeHelloV2 response: {error}"))?;
        validate_runtime_hello_response(&hello, &response)?;
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

fn runtime_hello_request() -> RuntimeHelloV2Request {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    RuntimeHelloV2Request {
        protocol_min_version: PROTOCOL_MIN_VERSION,
        protocol_max_version: PROTOCOL_MAX_VERSION,
        client_name: "lyra-cli".to_string(),
        component_version: env!("CARGO_PKG_VERSION").to_string(),
        build_id: option_env!("LYRA_BUILD_ID")
            .unwrap_or(env!("CARGO_PKG_VERSION"))
            .to_string(),
        host_api_version: "1.0.0".to_string(),
        capabilities: Vec::new(),
        data_schemas: Default::default(),
        connection_role: RuntimeConnectionRole::AuxiliaryClient,
        connection_lease_id: format!("lyra-cli-{}-{nonce}", std::process::id()),
    }
}

fn validate_runtime_hello_response(
    request: &RuntimeHelloV2Request,
    response: &RuntimeHelloV2Response,
) -> Result<(), String> {
    let minimum = request
        .protocol_min_version
        .max(response.protocol_min_version);
    let maximum = request
        .protocol_max_version
        .min(response.protocol_max_version);
    if response.protocol_min_version == 0
        || response.protocol_min_version > response.protocol_max_version
        || minimum > maximum
        || response.negotiated_protocol_version < minimum
        || response.negotiated_protocol_version > maximum
    {
        return Err(format!(
            "Lyra runtime protocol mismatch: client {}-{}, server {}-{}, negotiated {}",
            request.protocol_min_version,
            request.protocol_max_version,
            response.protocol_min_version,
            response.protocol_max_version,
            response.negotiated_protocol_version
        ));
    }
    if response.server_name.trim().is_empty()
        || response.component_version.trim().is_empty()
        || response.build_id.trim().is_empty()
        || response.host_api_version.trim().is_empty()
    {
        return Err("invalid RuntimeHelloV2 server identity".to_string());
    }
    if response.data_schemas.get("lyra.runtime") != Some(&1) {
        return Err("Lyra runtime data schema is incompatible".to_string());
    }
    if response.connection_role != request.connection_role
        || response.connection_lease_id != request.connection_lease_id
    {
        return Err("Lyra runtime returned a different connection role or lease".to_string());
    }
    Ok(())
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

    #[test]
    fn runtime_hello_v2_request_contains_cli_identity_and_range() {
        let request = runtime_hello_request();
        let value = serde_json::to_value(request).expect("hello");
        assert_eq!(value["protocolMinVersion"], 2);
        assert_eq!(value["protocolMaxVersion"], 2);
        assert_eq!(value["clientName"], "lyra-cli");
        assert_eq!(value["componentVersion"], env!("CARGO_PKG_VERSION"));
        assert_eq!(value["hostApiVersion"], "1.0.0");
        assert_eq!(value["connectionRole"], "auxiliaryClient");
        assert!(
            value["connectionLeaseId"]
                .as_str()
                .is_some_and(|id| !id.is_empty())
        );
    }

    #[test]
    fn runtime_hello_v2_accepts_overlap_and_rejects_wrong_lease() {
        let request = runtime_hello_request();
        let response = RuntimeHelloV2Response {
            protocol_min_version: 1,
            protocol_max_version: 3,
            negotiated_protocol_version: 2,
            server_name: "lyrad".to_string(),
            component_version: "0.1.0".to_string(),
            build_id: "test-build".to_string(),
            host_api_version: "1.0.0".to_string(),
            capabilities: vec!["agent.codegraph.status".to_string()],
            data_schemas: [("lyra.runtime".to_string(), 1)].into(),
            connection_role: request.connection_role.clone(),
            connection_lease_id: request.connection_lease_id.clone(),
        };
        assert!(validate_runtime_hello_response(&request, &response).is_ok());

        let wrong_lease = RuntimeHelloV2Response {
            connection_lease_id: "wrong".to_string(),
            ..response
        };
        assert_eq!(
            validate_runtime_hello_response(&request, &wrong_lease).unwrap_err(),
            "Lyra runtime returned a different connection role or lease"
        );
    }
}
