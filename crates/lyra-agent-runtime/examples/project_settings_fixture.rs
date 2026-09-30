//! JSON-lines bridge for the isolated project-settings browser regression.
//! Run with LYRA_AGENT_RUNTIME_HOME pointing at a disposable directory.
use lyra_agent_runtime::{AgentRuntimeBackend, AgentRuntimeServices, LyraAgentBackend};
use serde_json::{Value, json};
use std::io::{self, BufRead};
use std::sync::Arc;

fn main() {
    assert!(
        std::env::var_os("LYRA_AGENT_RUNTIME_HOME").is_some(),
        "Fixture requires a disposable runtime directory"
    );
    let backend = Arc::new(LyraAgentBackend);
    backend.register_event_callback(Arc::new(|event| {
        if let Ok(event) = serde_json::from_str::<Value>(&event) {
            println!("{}", json!({"event":event}));
        }
    }));
    let services = AgentRuntimeServices::with_backend(backend);
    for line in io::stdin().lock().lines().map_while(Result::ok) {
        let request: Value = serde_json::from_str(&line).expect("fixture request");
        let method = request["method"].as_str().expect("method");
        let result = services.handle_agent_request(method, request["payload"].clone());
        let response = match result {
            Ok(value) => json!({"id":request["id"],"result":value}),
            Err(error) => json!({"id":request["id"],"error":error.to_string()}),
        };
        println!("{response}");
    }
}
