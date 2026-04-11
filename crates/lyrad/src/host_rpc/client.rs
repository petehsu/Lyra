use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::Duration;

use lyra_runtime_protocol::{RuntimeEnvelope, RuntimeError};
use serde_json::Value;
use tokio::sync::{mpsc::UnboundedSender, oneshot, Mutex};

use super::types::HostRpcResult;

#[derive(Clone)]
pub struct HostRpcClient {
    outgoing: UnboundedSender<RuntimeEnvelope>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<HostRpcResult>>>>,
    next_id: Arc<AtomicU64>,
}

impl HostRpcClient {
    pub fn new(outgoing: UnboundedSender<RuntimeEnvelope>) -> Self {
        Self {
            outgoing,
            pending: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(AtomicU64::new(1)),
        }
    }

    fn create_request_id(&self) -> String {
        format!("host-rpc-{}", self.next_id.fetch_add(1, Ordering::Relaxed))
    }

    pub async fn call_json(
        &self,
        method: &str,
        payload: Value,
        timeout: Duration,
    ) -> HostRpcResult {
        let request_id = self.create_request_id();
        let (sender, receiver) = oneshot::channel::<HostRpcResult>();
        self.pending.lock().await.insert(request_id.clone(), sender);
        if self
            .outgoing
            .send(RuntimeEnvelope::Request {
                id: request_id.clone(),
                method: method.to_string(),
                payload,
            })
            .is_err()
        {
            self.pending.lock().await.remove(&request_id);
            return Err(RuntimeError::new(
                "HOST_RPC_SEND_FAILED",
                format!("failed to send host RPC request: {method}"),
            ));
        }

        match tokio::time::timeout(timeout, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(RuntimeError::new(
                "HOST_RPC_CHANNEL_CLOSED",
                format!("host RPC response channel closed: {method}"),
            )),
            Err(_) => {
                self.pending.lock().await.remove(&request_id);
                Err(RuntimeError::new(
                    "HOST_RPC_TIMEOUT",
                    format!("host RPC timed out: {method}"),
                ))
            }
        }
    }

    pub fn call_json_blocking(
        &self,
        method: &str,
        payload: Value,
        _timeout: Duration,
    ) -> HostRpcResult {
        let request_id = self.create_request_id();
        let (sender, receiver) = oneshot::channel::<HostRpcResult>();
        {
            let mut pending = self.pending.blocking_lock();
            pending.insert(request_id.clone(), sender);
        }
        if self
            .outgoing
            .send(RuntimeEnvelope::Request {
                id: request_id.clone(),
                method: method.to_string(),
                payload,
            })
            .is_err()
        {
            self.pending.blocking_lock().remove(&request_id);
            return Err(RuntimeError::new(
                "HOST_RPC_SEND_FAILED",
                format!("failed to send host RPC request: {method}"),
            ));
        }

        match receiver.blocking_recv() {
            Ok(result) => result,
            Err(_) => {
                self.pending.blocking_lock().remove(&request_id);
                Err(RuntimeError::new(
                    "HOST_RPC_CHANNEL_CLOSED",
                    format!("host RPC response channel closed: {method}"),
                ))
            }
        }
    }

    pub async fn resolve_response(
        &self,
        id: String,
        ok: bool,
        result: Option<Value>,
        error: Option<RuntimeError>,
    ) -> bool {
        let sender = self.pending.lock().await.remove(&id);
        let Some(sender) = sender else {
            return false;
        };
        let response = if ok {
            Ok(result.unwrap_or(Value::Null))
        } else {
            Err(error
                .unwrap_or_else(|| RuntimeError::new("HOST_RPC_FAILED", "host RPC request failed")))
        };
        let _ = sender.send(response);
        true
    }
}
