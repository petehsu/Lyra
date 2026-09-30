//! Isolated JSON-lines bridge for tools/diagnostics/agent-latency.mjs.
//! Host replies are synthetic; no desktop state or external provider is used.
use lyra_agent_runtime::{AgentRuntimeBackend, LyraAgentBackend};
use serde_json::{Value, json};
use std::io::{self, BufRead};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn main() {
    assert!(std::env::var_os("LYRA_AGENT_RUNTIME_HOME").is_some());
    if std::env::var_os("LYRA_AUDIT_PREWARM_TOKENIZER").is_some() {
        let started = Instant::now();
        lyra_agent_reader::estimate_tokens("warmup");
        eprintln!(
            "audit tokenizer warmup: {}ms",
            started.elapsed().as_millis()
        );
    }
    let backend = LyraAgentBackend;
    backend.register_event_callback(Arc::new(|event| {
        if let Ok(event) = serde_json::from_str::<Value>(&event) {
            println!("{}", json!({"event": event}));
        }
    }));
    let delay_ms = std::env::var("LYRA_AUDIT_HOST_DELAY_MS")
        .unwrap_or_default()
        .parse::<u64>()
        .unwrap_or(0);
    backend.register_host_capability_dispatcher(Arc::new(move |method, payload| {
        let start = Instant::now();
        std::thread::sleep(Duration::from_millis(delay_ms));
        let result = match method.as_str() {
            "agent.readTurnContext" => json!({
                "software": {"software": []}, "workbench": {"tabs": []},
                "persona": {}, "personaSignalsAllowed": false, "workspace": {}
            }),
            "software.listCapabilities" => json!({"software": []}),
            "workbench.listTabs" => json!({"tabs": []}),
            "agent.readPersonaConsent" => json!({"allowed": false}),
            _ => json!({}),
        };
        println!(
            "{}",
            json!({"host": {"method": method,
            "payload": serde_json::from_str::<Value>(&payload).unwrap_or(Value::Null),
            "durationMs": start.elapsed().as_millis()}})
        );
        Ok(result.to_string())
    }));
    for line in io::stdin().lock().lines().map_while(Result::ok) {
        let request: Value = serde_json::from_str(&line).expect("fixture request");
        let result = backend.call_agent_method(
            request["method"].as_str().expect("method"),
            request["payload"].clone(),
        );
        println!(
            "{}",
            match result {
                Ok(value) => json!({"id": request["id"], "result": value}),
                Err(error) => json!({"id": request["id"], "error": error.to_string()}),
            }
        );
    }
}
