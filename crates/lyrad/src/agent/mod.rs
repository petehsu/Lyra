mod ai_config;

use lyra_app_server_client::{AppServerEvent, EmbeddedClientDefaults, InProcessAppServerClient};
use lyra_app_server_protocol::{
    ClientNotification, ClientRequest, DynamicToolCallOutputContentItem, DynamicToolCallParams,
    DynamicToolCallResponse, JSONRPCErrorError, RequestId, ServerNotification, ServerRequest,
};
use lyra_runtime_protocol::{RuntimeEnvelope, RuntimeError};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};

use crate::host_rpc::HostRpcClient;

const AGENT_CORE_RUNTIME_EVENT_NAME: &str = "lyra.runtime";
const LYRA_AGENT_CORE_BACKEND: &str = "lyra-agent-core";
const HOST_RPC_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
static NEXT_RUNTIME_REQUEST_ID: AtomicI64 = AtomicI64::new(1);

#[derive(Clone)]
pub struct AgentRuntime {
    tx: mpsc::Sender<AgentCommand>,
}

impl AgentRuntime {
    pub fn new(
        outgoing: tokio::sync::mpsc::UnboundedSender<RuntimeEnvelope>,
        host_rpc: HostRpcClient,
        storage_root: PathBuf,
    ) -> Self {
        let (tx, rx) = mpsc::channel::<AgentCommand>(256);
        let mut actor = AgentActor {
            outgoing,
            host_rpc,
            storage_root,
        };
        tokio::spawn(async move {
            actor.run(rx).await;
        });
        Self { tx }
    }

    pub async fn handle_request(
        &self,
        method: &str,
        payload: Value,
    ) -> Result<Value, RuntimeError> {
        let (reply_tx, reply_rx) = oneshot::channel();
        self.tx
            .send(AgentCommand::RuntimeRequest {
                method: method.to_string(),
                payload,
                reply: reply_tx,
            })
            .await
            .map_err(|_| {
                runtime_error(
                    "LYRA_RUNTIME_UNAVAILABLE",
                    "agent core runtime command channel closed",
                )
            })?;

        reply_rx.await.map_err(|_| {
            runtime_error(
                "LYRA_RUNTIME_UNAVAILABLE",
                "agent core runtime response channel closed",
            )
        })?
    }

    pub async fn shutdown(&self) {
        let _ = self.tx.send(AgentCommand::Shutdown).await;
    }
}

struct AgentActor {
    outgoing: tokio::sync::mpsc::UnboundedSender<RuntimeEnvelope>,
    host_rpc: HostRpcClient,
    storage_root: PathBuf,
}

enum RuntimeState {
    Ready(InProcessAppServerClient),
    Failed(RuntimeError),
    ShuttingDown,
}

impl AgentActor {
    async fn run(&mut self, mut rx: mpsc::Receiver<AgentCommand>) {
        let mut state = match start_agent_core_client().await {
            Ok(client) => {
                let _ = self.forward_event_payload(json!({
                    "kind": "ready",
                    "backend": LYRA_AGENT_CORE_BACKEND,
                    "transport": "in_process",
                    "version": env!("CARGO_PKG_VERSION"),
                }));
                RuntimeState::Ready(client)
            }
            Err(error) => {
                let _ = self.forward_event_payload(json!({
                    "kind": "startup_failed",
                    "error": {
                        "code": error.code,
                        "message": error.message,
                        "details": error.details,
                    },
                }));
                RuntimeState::Failed(error)
            }
        };

        loop {
            match &mut state {
                RuntimeState::Ready(client) => {
                    tokio::select! {
                        command = rx.recv() => {
                            match command {
                                Some(AgentCommand::RuntimeRequest { method, payload, reply }) => {
                                    let result = self.handle_runtime_request(client, &method, payload).await;
                                    let _ = reply.send(result);
                                }
                                Some(AgentCommand::Shutdown) => {
                                    let current_state = std::mem::replace(&mut state, RuntimeState::ShuttingDown);
                                    if let RuntimeState::Ready(client) = current_state {
                                        let _ = client.shutdown().await;
                                    }
                                    break;
                                }
                                None => {
                                    let current_state = std::mem::replace(&mut state, RuntimeState::ShuttingDown);
                                    if let RuntimeState::Ready(client) = current_state {
                                        let _ = client.shutdown().await;
                                    }
                                    break;
                                }
                            }
                        }
                        event = client.next_event() => {
                            match event {
                                Some(event) => {
                                    let _ = self.handle_app_server_event(client, event.into()).await;
                                }
                                None => {
                                    let error = runtime_error(
                                        "LYRA_RUNTIME_DISCONNECTED",
                                        "in-process agent core runtime disconnected",
                                    );
                                    let _ = self.forward_event_payload(json!({
                                        "kind": "disconnected",
                                        "error": {
                                            "code": error.code,
                                            "message": error.message,
                                            "details": error.details,
                                        },
                                    }));
                                    state = RuntimeState::Failed(error);
                                }
                            }
                        }
                    }
                }
                RuntimeState::Failed(error) => match rx.recv().await {
                    Some(AgentCommand::RuntimeRequest { reply, .. }) => {
                        let _ = reply.send(Err(error.clone()));
                    }
                    Some(AgentCommand::Shutdown) | None => break,
                },
                RuntimeState::ShuttingDown => break,
            }
        }
    }

    async fn handle_runtime_request(
        &self,
        client: &InProcessAppServerClient,
        method: &str,
        payload: Value,
    ) -> Result<Value, RuntimeError> {
        match method {
            "lyra.runtime.health" => Ok(json!({
                "backend": LYRA_AGENT_CORE_BACKEND,
                "transport": "in_process",
                "version": env!("CARGO_PKG_VERSION"),
            })),
            "lyra.runtime.request" => {
                self.handle_agent_core_runtime_request(client, payload)
                    .await
            }
            "lyra.runtime.notify" => {
                let notification: ClientNotification = from_value(payload)?;
                client
                    .notify(notification)
                    .await
                    .map_err(|error| runtime_error("LYRA_NOTIFY_FAILED", error.to_string()))?;
                Ok(Value::Null)
            }
            "lyra.runtime.resolve_server_request" => {
                let request: ResolveServerRequestPayload = from_value(payload)?;
                client
                    .resolve_server_request(request.request_id, request.result)
                    .await
                    .map_err(|error| {
                        runtime_error("LYRA_SERVER_REQUEST_RESOLVE_FAILED", error.to_string())
                    })?;
                Ok(Value::Null)
            }
            "lyra.runtime.reject_server_request" => {
                let request: RejectServerRequestPayload = from_value(payload)?;
                client
                    .reject_server_request(request.request_id, request.error)
                    .await
                    .map_err(|error| {
                        runtime_error("LYRA_SERVER_REQUEST_REJECT_FAILED", error.to_string())
                    })?;
                Ok(Value::Null)
            }
            retired if retired.starts_with("agent.") => Err(runtime_error(
                "METHOD_RETIRED",
                format!(
                    "{retired} has been retired. Use lyra.runtime.* with native runtime payloads instead."
                ),
            )),
            _ => Err(runtime_error(
                "METHOD_NOT_FOUND",
                format!("unknown lyra runtime method: {method}"),
            )),
        }
    }

    async fn handle_agent_core_runtime_request(
        &self,
        client: &InProcessAppServerClient,
        payload: Value,
    ) -> Result<Value, RuntimeError> {
        let request_method = payload
            .get("method")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                runtime_error(
                    "INVALID_RUNTIME_REQUEST",
                    "lyra.runtime.request requires a string method field",
                )
            })?;
        let request_params = payload.get("params").cloned().unwrap_or(Value::Null);

        if ai_config::handles_method(request_method) {
            return self
                .handle_lyra_ai_config_request(request_method, request_params)
                .await;
        }

        if is_retired_runtime_request_method(request_method) {
            return Err(runtime_error(
                "METHOD_RETIRED",
                format!(
                    "{request_method} has been retired. Use lyra/config/profiles/*, lyra/config/models/discover, or lyra/config/providers/catalog/read instead."
                ),
            ));
        }

        let request: ClientRequest = from_value(normalize_runtime_client_request_payload(payload))?;
        let result = client.request(request).await.map_err(|error| {
            runtime_error("LYRA_AGENT_REQUEST_TRANSPORT_FAILED", error.to_string())
        })?;
        match result {
            Ok(value) => Ok(value),
            Err(error) => Err(runtime_error_with_details(
                "LYRA_AGENT_REQUEST_REJECTED",
                error.message.clone(),
                json!({
                    "code": error.code,
                    "message": error.message,
                    "data": error.data,
                }),
            )),
        }
    }

    async fn handle_lyra_ai_config_request(
        &self,
        request_method: &str,
        request_params: Value,
    ) -> Result<Value, RuntimeError> {
        ai_config::handle_request(request_method, request_params, &self.storage_root).await
    }

    async fn handle_app_server_event(
        &self,
        client: &InProcessAppServerClient,
        event: AppServerEvent,
    ) -> Result<(), RuntimeError> {
        if let AppServerEvent::ServerRequest(ServerRequest::DynamicToolCall {
            request_id,
            params,
        }) = event
        {
            self.handle_dynamic_tool_call(client, request_id, params)
                .await?;
            return Ok(());
        }
        self.forward_app_server_event(event)
    }

    async fn handle_dynamic_tool_call(
        &self,
        client: &InProcessAppServerClient,
        request_id: RequestId,
        params: DynamicToolCallParams,
    ) -> Result<(), RuntimeError> {
        let DynamicToolCallParams {
            thread_id,
            turn_id,
            tool,
            host_method,
            arguments,
            ..
        } = params;
        let host_method = dynamic_tool_host_method(tool.as_str(), host_method.as_deref());
        let payload = json!({
            "toolName": tool,
            "hostMethod": host_method.clone(),
            "arguments": arguments,
            "context": {
                "agentSessionId": thread_id,
                "agentTurnId": turn_id,
            },
        });
        let response = match self
            .host_rpc
            .call_json(&host_method, payload, HOST_RPC_REQUEST_TIMEOUT)
            .await
        {
            Ok(value) => normalize_dynamic_tool_call_response(value),
            Err(error) => dynamic_tool_error_response(error.message),
        };
        client
            .resolve_server_request(request_id, to_value(&response)?)
            .await
            .map_err(|error| {
                runtime_error("LYRA_SERVER_REQUEST_RESOLVE_FAILED", error.to_string())
            })?;
        Ok(())
    }

    fn forward_app_server_event(&self, event: AppServerEvent) -> Result<(), RuntimeError> {
        let payload = match event {
            AppServerEvent::Lagged { skipped } => json!({
                "kind": "lagged",
                "skipped": skipped,
            }),
            AppServerEvent::ServerNotification(notification) => json!({
                "kind": "notification",
                "notification": to_value(&notification)?,
            }),
            AppServerEvent::ServerRequest(request) => json!({
                "kind": "request",
                "request": to_value(&request)?,
            }),
            AppServerEvent::Disconnected { message } => json!({
                "kind": "disconnected",
                "message": message,
            }),
        };
        self.forward_event_payload(payload)
    }

    fn forward_event_payload(&self, payload: Value) -> Result<(), RuntimeError> {
        self.outgoing
            .send(RuntimeEnvelope::Event {
                event: AGENT_CORE_RUNTIME_EVENT_NAME.to_string(),
                payload,
            })
            .map_err(|_| {
                runtime_error(
                    "LYRA_AGENT_EVENT_SEND_FAILED",
                    "failed to forward agent core runtime event",
                )
            })
    }
}

enum AgentCommand {
    RuntimeRequest {
        method: String,
        payload: Value,
        reply: oneshot::Sender<Result<Value, RuntimeError>>,
    },
    Shutdown,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveServerRequestPayload {
    request_id: RequestId,
    result: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RejectServerRequestPayload {
    request_id: RequestId,
    error: JSONRPCErrorError,
}

async fn start_agent_core_client() -> Result<InProcessAppServerClient, RuntimeError> {
    InProcessAppServerClient::start_with_embedded_defaults(EmbeddedClientDefaults::lyra(env!(
        "CARGO_PKG_VERSION"
    )))
    .await
    .map_err(|error| {
        let code = match error.kind() {
            ErrorKind::PermissionDenied => "LYRA_RUNTIME_PERMISSION_DENIED",
            _ => "LYRA_RUNTIME_START_FAILED",
        };
        runtime_error(code, error.to_string())
    })
}

fn runtime_error(code: &str, message: impl Into<String>) -> RuntimeError {
    RuntimeError::new(code, message.into())
}

fn runtime_error_with_details(
    code: &str,
    message: impl Into<String>,
    details: Value,
) -> RuntimeError {
    RuntimeError::with_details(code, message.into(), details)
}

fn from_value<T>(value: Value) -> Result<T, RuntimeError>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(value)
        .map_err(|error| runtime_error("SERDE_DECODE_FAILED", error.to_string()))
}

fn to_value<T>(value: &T) -> Result<Value, RuntimeError>
where
    T: serde::Serialize,
{
    serde_json::to_value(value)
        .map_err(|error| runtime_error("SERDE_ENCODE_FAILED", error.to_string()))
}

fn normalize_dynamic_tool_call_response(value: Value) -> DynamicToolCallResponse {
    match serde_json::from_value::<DynamicToolCallResponse>(value.clone()) {
        Ok(response) => response,
        Err(_) => DynamicToolCallResponse {
            content_items: vec![DynamicToolCallOutputContentItem::InputText {
                text: value_to_text(value),
            }],
            success: true,
        },
    }
}

fn dynamic_tool_error_response(message: String) -> DynamicToolCallResponse {
    DynamicToolCallResponse {
        content_items: vec![DynamicToolCallOutputContentItem::InputText { text: message }],
        success: false,
    }
}

fn dynamic_tool_host_method(tool: &str, host_method: Option<&str>) -> String {
    host_method
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(tool)
        .to_string()
}

fn value_to_text(value: Value) -> String {
    match value {
        Value::String(text) => text,
        other => serde_json::to_string_pretty(&other).unwrap_or_else(|_| other.to_string()),
    }
}

fn is_retired_runtime_request_method(method: &str) -> bool {
    matches!(
        method,
        "lyra/config/profileWrite" | "externalAgentConfig/detect" | "externalAgentConfig/import"
    )
}

fn normalize_runtime_client_request_payload(payload: Value) -> Value {
    match payload {
        Value::Object(mut object) => {
            if !object.contains_key("id") {
                object.insert(
                    "id".to_string(),
                    Value::Number(next_runtime_request_id().into()),
                );
            }
            Value::Object(object)
        }
        other => other,
    }
}

fn next_runtime_request_id() -> i64 {
    NEXT_RUNTIME_REQUEST_ID.fetch_add(1, Ordering::Relaxed)
}

#[allow(dead_code)]
fn _keep_protocol_types_linked(_notification: ServerNotification, _request: ServerRequest) {}

#[cfg(test)]
mod tests {
    use super::dynamic_tool_host_method;
    use super::normalize_runtime_client_request_payload;
    use serde_json::json;

    #[test]
    fn adds_id_when_runtime_request_payload_omits_it() {
        let payload = json!({
            "method": "lyra/config/providers/catalog/read",
            "params": {}
        });
        let normalized = normalize_runtime_client_request_payload(payload);
        assert_eq!(
            normalized.get("method"),
            Some(&json!("lyra/config/providers/catalog/read"))
        );
        assert!(
            normalized
                .get("id")
                .and_then(serde_json::Value::as_i64)
                .is_some()
        );
    }

    #[test]
    fn keeps_existing_runtime_request_id() {
        let payload = json!({
            "method": "thread/start",
            "id": "settings-test-id",
            "params": {}
        });
        let normalized = normalize_runtime_client_request_payload(payload);
        assert_eq!(normalized.get("id"), Some(&json!("settings-test-id")));
    }

    #[test]
    fn dynamic_tool_host_method_overrides_model_tool_name() {
        assert_eq!(
            dynamic_tool_host_method("read_open_document", Some("workbench.document.read")),
            "workbench.document.read"
        );
        assert_eq!(
            dynamic_tool_host_method("read_open_document", Some("   ")),
            "read_open_document"
        );
        assert_eq!(
            dynamic_tool_host_method("read_open_document", None),
            "read_open_document"
        );
    }
}
