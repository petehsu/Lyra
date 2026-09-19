//! Shared UserGate envelope for turn-blocking UI.
//!
//! Clarification, permission, and plan review still keep their pending maps
//! (those are the waiter source of truth). This layer is the single timeout,
//! event, resolve, and autonomous think-and-decide entry so new blocking UI
//! does not grow its own clock. Auto-resolve thinks about one panel; it does
//! not lock the session against opening another wait.

use super::*;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::Instant;
use tokio_util::sync::CancellationToken;

const AUTO_RESOLVE_MAX_TOOL_ROUNDS: usize = 3;
const AUTO_RESOLVE_TOOL_PREVIEW_CHARS: usize = 4_000;
const SESSION_EXCERPT_MESSAGES: usize = 8;
const SESSION_EXCERPT_TOOLS: usize = 4;
const AUTO_RESOLVE_SYSTEM: &str = "Think through the evidence on this blocking panel and decide. Reply with a single JSON object only. Do not open another question, permission, or plan review. Do not pick an option just because it is first. Clarification JSON: {\"answer\":\"...\",\"selectedOptionValue\":\"...\"}. Permission JSON: {\"allowed\":true|false}. Plan review JSON: {\"action\":\"approve\"|\"set_aside\"|\"request_revision\",\"feedback\":\"...\"}.";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum UserGateKind {
    Clarification,
    Permission,
    PlanReview,
}

impl UserGateKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Clarification => "clarification",
            Self::Permission => "permission",
            Self::PlanReview => "plan_review",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "clarification" => Some(Self::Clarification),
            "permission" => Some(Self::Permission),
            "plan_review" | "planReview" => Some(Self::PlanReview),
            _ => None,
        }
    }
}

struct UserGateLive {
    kind: UserGateKind,
    session_id: String,
    turn_id: String,
    opened_at_iso: String,
    last_activity_at: Instant,
    last_activity_iso: String,
    auto_resolve_in_flight: bool,
}

struct UserGateRegistry {
    live: HashMap<String, UserGateLive>,
}

fn registry() -> &'static Mutex<UserGateRegistry> {
    static REGISTRY: OnceLock<Mutex<UserGateRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        Mutex::new(UserGateRegistry {
            live: HashMap::new(),
        })
    })
}

#[cfg(test)]
static TEST_AUTO_RESOLVE_PROPOSAL: Mutex<Option<Value>> = Mutex::new(None);

#[cfg(test)]
pub(crate) fn set_test_auto_resolve_proposal(value: Option<Value>) {
    if let Ok(mut slot) = TEST_AUTO_RESOLVE_PROPOSAL.lock() {
        *slot = value;
    }
}

#[cfg(test)]
static TEST_AUTO_RESOLVE_HOLD: Mutex<Option<tokio::sync::oneshot::Receiver<()>>> = Mutex::new(None);

#[cfg(test)]
fn arm_test_auto_resolve_hold() -> tokio::sync::oneshot::Sender<()> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    if let Ok(mut slot) = TEST_AUTO_RESOLVE_HOLD.lock() {
        *slot = Some(rx);
    }
    tx
}

#[cfg(test)]
fn clear_test_auto_resolve_hold() {
    if let Ok(mut slot) = TEST_AUTO_RESOLVE_HOLD.lock() {
        *slot = None;
    }
}

#[cfg(test)]
fn auto_resolve_in_flight(gate_id: &str) -> bool {
    registry()
        .lock()
        .ok()
        .and_then(|reg| {
            reg.live
                .get(gate_id)
                .map(|live| live.auto_resolve_in_flight)
        })
        .unwrap_or(false)
}

fn log_user_gate(message: &str) {
    eprintln!("[user_gate] {message}");
}

pub(crate) fn plan_review_gate_id(session_id: &str) -> String {
    format!("plan-review:{session_id}")
}

pub(crate) fn record_open(
    kind: UserGateKind,
    id: &str,
    session_id: &str,
    turn_id: &str,
    payload: Value,
) -> Value {
    let opened_at_iso = now();
    let opened_at = Instant::now();
    if let Ok(mut reg) = registry().lock() {
        reg.live.insert(
            id.to_string(),
            UserGateLive {
                kind,
                session_id: session_id.to_string(),
                turn_id: turn_id.to_string(),
                opened_at_iso: opened_at_iso.clone(),
                last_activity_at: opened_at,
                last_activity_iso: opened_at_iso.clone(),
                auto_resolve_in_flight: false,
            },
        );
    }
    log_user_gate(&format!(
        "open id={id} kind={} session={session_id} turn={turn_id} openedAt={opened_at_iso} idleMs=0",
        kind.as_str()
    ));
    requested_event(kind, id, session_id, turn_id, payload, &opened_at_iso)
}

pub(crate) fn requested_event(
    kind: UserGateKind,
    id: &str,
    session_id: &str,
    turn_id: &str,
    payload: Value,
    opened_at: &str,
) -> Value {
    json!({
        "kind": "userGateRequested",
        "sessionId": session_id,
        "gate": {
            "id": id,
            "kind": kind.as_str(),
            "sessionId": session_id,
            "turnId": turn_id,
            "payload": payload,
            "openedAt": opened_at,
            "lastActivityAt": opened_at,
            "idleMs": 0,
            "autoResolveInFlight": false,
        }
    })
}

pub(crate) fn resolved_event(
    session_id: &str,
    id: &str,
    kind: UserGateKind,
    resolve_source: &str,
) -> Value {
    json!({
        "kind": "userGateResolved",
        "sessionId": session_id,
        "gateId": id,
        "gateKind": kind.as_str(),
        "resolveSource": resolve_source,
    })
}

pub(crate) fn drop_live(id: &str) {
    if let Ok(mut reg) = registry().lock() {
        reg.live.remove(id);
    }
}

pub(crate) fn on_resolved(id: &str, session_id: &str, kind: UserGateKind, resolve_source: &str) {
    let (opened_at, last_activity_at, idle_ms) = registry()
        .lock()
        .ok()
        .and_then(|mut reg| reg.live.remove(id))
        .map(|live| {
            (
                live.opened_at_iso,
                live.last_activity_iso,
                live.last_activity_at.elapsed().as_millis(),
            )
        })
        .unwrap_or_else(|| (now(), now(), 0));
    log_user_gate(&format!(
        "resolve id={id} kind={} session={session_id} source={resolve_source} openedAt={opened_at} lastActivityAt={last_activity_at} idleMs={idle_ms}",
        kind.as_str()
    ));
}

pub(crate) fn touch_activity(payload: Value) -> AgentRuntimeResult<Value> {
    let gate_id = string_opt(&payload, "gateId")
        .ok_or_else(|| AgentRuntimeError::Core("gateId is required".to_string()))?;
    let touched_iso = now();
    let touched = Instant::now();
    let found = registry().lock().ok().and_then(|mut reg| {
        let live = reg.live.get_mut(&gate_id)?;
        live.last_activity_at = touched;
        live.last_activity_iso = touched_iso.clone();
        Some(json!({
            "gateId": gate_id.clone(),
            "lastActivityAt": touched_iso,
            "idleMs": 0,
        }))
    });
    Ok(found.unwrap_or_else(|| {
        json!({
            "gateId": gate_id,
            "lastActivityAt": touched_iso,
            "idleMs": 0,
            "ignored": true,
        })
    }))
}

fn live_snapshot(id: &str) -> Option<(UserGateKind, String, String, String, String, u128, bool)> {
    let reg = registry().lock().ok()?;
    let live = reg.live.get(id)?;
    Some((
        live.kind,
        live.session_id.clone(),
        live.turn_id.clone(),
        live.opened_at_iso.clone(),
        live.last_activity_iso.clone(),
        live.last_activity_at.elapsed().as_millis(),
        live.auto_resolve_in_flight,
    ))
}

pub(crate) fn list_user_gates(payload: Value) -> AgentRuntimeResult<Value> {
    let session_id = string_opt(&payload, "sessionId");
    let mut gates = Vec::new();
    {
        let state = state()
            .lock()
            .map_err(|_| AgentRuntimeError::Core("agent runtime state lock failed".to_string()))?;
        for request in state.pending_clarifications.values() {
            if request.answer.is_some() {
                continue;
            }
            if session_id
                .as_ref()
                .is_some_and(|expected| expected != &request.session_id)
            {
                continue;
            }
            gates.push(gate_json(
                UserGateKind::Clarification,
                &request.id,
                &request.session_id,
                &request.turn_id,
                json!({
                    "question": request.question,
                    "i18nKey": request.i18n_key,
                    "options": request.options,
                    "allowCustomAnswer": request.allow_custom_answer,
                    "detail": request.detail,
                    "detailI18nKey": request.detail_i18n_key,
                    "toolCallId": request.tool_call_id,
                }),
                &request.created_at,
            ));
        }
        for request in state.pending_permissions.values() {
            if request.allowed.is_some() {
                continue;
            }
            if session_id
                .as_ref()
                .is_some_and(|expected| expected != &request.session_id)
            {
                continue;
            }
            gates.push(gate_json(
                UserGateKind::Permission,
                &request.id,
                &request.session_id,
                &request.turn_id,
                json!({
                    "title": request.title,
                    "detail": request.detail,
                    "action": request.action,
                    "risk": request.risk,
                    "summary": request.summary,
                    "why": request.why,
                    "toolCallId": request.tool_call_id,
                }),
                &request.created_at,
            ));
        }
        for (id, session) in &state.sessions {
            if session_id.as_ref().is_some_and(|expected| expected != id) {
                continue;
            }
            let Some(plan) = session
                .snapshot
                .get("plan")
                .filter(|value| value.is_object())
            else {
                continue;
            };
            if plan.get("phase").and_then(Value::as_str) != Some(PLAN_PHASE_REVIEWING) {
                continue;
            }
            let turn_id = session
                .snapshot
                .get("activeTurnId")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            gates.push(gate_json(
                UserGateKind::PlanReview,
                &plan_review_gate_id(id),
                id,
                &turn_id,
                plan.clone(),
                &now(),
            ));
        }
    }
    Ok(json!({ "gates": gates }))
}

fn gate_json(
    kind: UserGateKind,
    id: &str,
    session_id: &str,
    turn_id: &str,
    payload: Value,
    fallback_opened_at: &str,
) -> Value {
    let live = live_snapshot(id);
    let (opened_at, last_activity_at, idle_ms, in_flight) = live
        .as_ref()
        .map(|(_, _, _, opened, last, idle, in_flight)| {
            (opened.clone(), last.clone(), *idle, *in_flight)
        })
        .unwrap_or_else(|| {
            (
                fallback_opened_at.to_string(),
                fallback_opened_at.to_string(),
                0,
                false,
            )
        });
    json!({
        "id": id,
        "kind": kind.as_str(),
        "sessionId": session_id,
        "turnId": turn_id,
        "payload": payload,
        "openedAt": opened_at,
        "lastActivityAt": last_activity_at,
        "idleMs": idle_ms,
        "autoResolveInFlight": in_flight,
    })
}

pub(crate) fn resolve_user_gate(payload: Value) -> AgentRuntimeResult<Value> {
    let kind = string_opt(&payload, "kind")
        .or_else(|| string_opt(&payload, "gateKind"))
        .and_then(|value| UserGateKind::parse(&value))
        .ok_or_else(|| AgentRuntimeError::Core("kind is required".to_string()))?;
    let mut dispatch = payload.clone();
    if dispatch
        .get("resolveSource")
        .and_then(Value::as_str)
        .is_none()
    {
        dispatch["resolveSource"] = json!("user");
    }
    match kind {
        UserGateKind::Clarification => {
            if dispatch.get("clarificationId").is_none() {
                if let Some(gate_id) = string_opt(&dispatch, "gateId") {
                    dispatch["clarificationId"] = json!(gate_id);
                }
            }
            respond_clarification(dispatch)
        }
        UserGateKind::Permission => {
            if dispatch.get("permissionId").is_none() {
                if let Some(gate_id) = string_opt(&dispatch, "gateId") {
                    dispatch["permissionId"] = json!(gate_id);
                }
            }
            respond_permission(dispatch)
        }
        UserGateKind::PlanReview => {
            if dispatch.get("sessionId").and_then(Value::as_str).is_none() {
                if let Some(gate_id) = string_opt(&dispatch, "gateId") {
                    if let Some(session_id) = gate_id.strip_prefix("plan-review:") {
                        dispatch["sessionId"] = json!(session_id);
                    }
                }
            }
            plan_review_respond(dispatch)
        }
    }
}

pub(crate) fn cancel_user_gate(payload: Value) -> AgentRuntimeResult<Value> {
    let gate_id = string_opt(&payload, "gateId")
        .ok_or_else(|| AgentRuntimeError::Core("gateId is required".to_string()))?;
    let listed = list_user_gates(json!({}))?;
    let gate = listed
        .get("gates")
        .and_then(Value::as_array)
        .and_then(|gates| {
            gates
                .iter()
                .find(|gate| gate.get("id").and_then(Value::as_str) == Some(gate_id.as_str()))
        })
        .cloned()
        .ok_or_else(|| AgentRuntimeError::Core(format!("user gate not found: {gate_id}")))?;
    let kind = gate
        .get("kind")
        .and_then(Value::as_str)
        .and_then(UserGateKind::parse)
        .ok_or_else(|| AgentRuntimeError::Core("user gate kind missing".to_string()))?;
    let session_id = gate
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| AgentRuntimeError::Core("user gate sessionId missing".to_string()))?
        .to_string();
    match kind {
        UserGateKind::Clarification => {
            super::waiters::resolve(&gate_id, super::waiters::WaitSignal::Cancelled);
            if let Ok(mut state) = state().lock() {
                state.pending_clarifications.remove(&gate_id);
                let _ = state.save_state();
            }
            on_resolved(&gate_id, &session_id, kind, "user");
            let callback = event_callback();
            emit_with_callback(
                &callback,
                resolved_event(&session_id, &gate_id, kind, "user"),
            );
            Ok(json!({ "status": "cancelled", "gateId": gate_id }))
        }
        UserGateKind::Permission => resolve_user_gate(json!({
            "kind": "permission",
            "sessionId": session_id,
            "gateId": gate_id,
            "allowed": false,
            "resolveSource": "user",
        })),
        UserGateKind::PlanReview => resolve_user_gate(json!({
            "kind": "plan_review",
            "sessionId": session_id,
            "gateId": gate_id,
            "action": "set_aside",
            "resolveSource": "user",
        })),
    }
}

pub(crate) fn auto_resolve_user_gate(payload: Value) -> AgentRuntimeResult<Value> {
    super::turn_engine::block_on(auto_resolve_user_gate_async(payload))
}

async fn auto_resolve_user_gate_async(payload: Value) -> AgentRuntimeResult<Value> {
    if !is_autonomous_permission_mode() {
        return Err(AgentRuntimeError::Core(
            "user gate autoResolve requires autonomous mode".to_string(),
        ));
    }
    let gate_id = string_opt(&payload, "gateId")
        .ok_or_else(|| AgentRuntimeError::Core("gateId is required".to_string()))?;
    let listed = list_user_gates(json!({}))?;
    let gate = listed
        .get("gates")
        .and_then(Value::as_array)
        .and_then(|gates| {
            gates
                .iter()
                .find(|gate| gate.get("id").and_then(Value::as_str) == Some(gate_id.as_str()))
                .cloned()
        })
        .ok_or_else(|| AgentRuntimeError::Core(format!("user gate not found: {gate_id}")))?;
    let kind = gate
        .get("kind")
        .and_then(Value::as_str)
        .and_then(UserGateKind::parse)
        .ok_or_else(|| AgentRuntimeError::Core("user gate kind missing".to_string()))?;
    let session_id = gate
        .get("sessionId")
        .and_then(Value::as_str)
        .ok_or_else(|| AgentRuntimeError::Core("user gate sessionId missing".to_string()))?
        .to_string();
    let already_in_flight = registry()
        .lock()
        .ok()
        .and_then(|mut reg| {
            let live = reg.live.get_mut(&gate_id)?;
            if live.auto_resolve_in_flight {
                return Some(true);
            }
            live.auto_resolve_in_flight = true;
            Some(false)
        })
        .unwrap_or(false);
    if already_in_flight {
        return Err(AgentRuntimeError::Core(
            "user gate autoResolve already in flight".to_string(),
        ));
    }
    let proposal = auto_resolve_proposal(kind, &gate).await;
    if let Ok(mut reg) = registry().lock() {
        if let Some(live) = reg.live.get_mut(&gate_id) {
            live.auto_resolve_in_flight = false;
        }
    }
    let proposal = proposal?;
    if !gate_still_open(&gate_id) {
        return Ok(json!({
            "status": "superseded",
            "gateId": gate_id,
            "resolveSource": "user",
        }));
    }
    let mut resolve_payload = proposal;
    resolve_payload["kind"] = json!(kind.as_str());
    resolve_payload["gateId"] = json!(gate_id);
    resolve_payload["sessionId"] = json!(session_id);
    resolve_payload["resolveSource"] = json!("autonomous");
    resolve_user_gate(resolve_payload)
}

fn gate_still_open(gate_id: &str) -> bool {
    list_user_gates(json!({}))
        .ok()
        .and_then(|listed| {
            listed.get("gates").and_then(Value::as_array).map(|gates| {
                gates
                    .iter()
                    .any(|gate| gate.get("id").and_then(Value::as_str) == Some(gate_id))
            })
        })
        .unwrap_or(false)
}

async fn auto_resolve_proposal(kind: UserGateKind, gate: &Value) -> AgentRuntimeResult<Value> {
    #[cfg(test)]
    {
        let hold = TEST_AUTO_RESOLVE_HOLD
            .lock()
            .ok()
            .and_then(|mut slot| slot.take());
        if let Some(hold) = hold {
            let _ = hold.await;
        }
    }
    if let Some(fixture) = test_or_env_proposal() {
        return parse_autonomous_answer(kind, gate, &fixture.to_string())
            .or_else(|_| parse_autonomous_answer_from_value(kind, gate, fixture));
    }
    let session_id = gate
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let turn_id = gate
        .get("turnId")
        .and_then(Value::as_str)
        .unwrap_or("user-gate-auto")
        .to_string();
    let text = think_user_gate_answer(&session_id, &turn_id, gate).await?;
    parse_autonomous_answer(kind, gate, &text)
}

fn test_or_env_proposal() -> Option<Value> {
    #[cfg(test)]
    {
        if let Ok(slot) = TEST_AUTO_RESOLVE_PROPOSAL.lock()
            && let Some(value) = slot.clone()
        {
            return Some(value);
        }
    }
    std::env::var("LYRA_USER_GATE_AUTO_RESOLVE_JSON")
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

async fn think_user_gate_answer(
    session_id: &str,
    turn_id: &str,
    gate: &Value,
) -> AgentRuntimeResult<String> {
    let mut request = build_model_request_async(session_id.to_string()).await?;
    let evidence = session_evidence_excerpt(&request.messages, &[]);
    request.messages.push(json!({
        "role": "system",
        "content": AUTO_RESOLVE_SYSTEM,
    }));
    request.messages.push(json!({
        "role": "user",
        "content": format!(
            "Session evidence:\n{evidence}\n\nUserGate:\n{}\n\nReply with JSON only.",
            serde_json::to_string_pretty(gate).unwrap_or_else(|_| gate.to_string())
        ),
    }));
    request.tools = filter_auto_resolve_tools(&request.tools);
    request.tool_choice = if request.tools.is_empty() {
        ModelToolChoice::None
    } else {
        ModelToolChoice::Auto
    };
    let cancellation = CancellationToken::new();
    let dispatcher = request.host_dispatcher.clone();
    let runtime = ToolExecutionRuntime::from_model_capabilities(&request.capabilities);
    let mut messages = request.messages.clone();
    for round in 0..=AUTO_RESOLVE_MAX_TOOL_ROUNDS {
        let choice = if round == AUTO_RESOLVE_MAX_TOOL_ROUNDS || request.tools.is_empty() {
            ModelToolChoice::None
        } else {
            request.tool_choice.clone()
        };
        let reply = call_model_once_for_loop_async(
            session_id,
            turn_id,
            &request.provider,
            &request.model,
            &messages,
            &request.tools,
            &choice,
            &request.capabilities,
            &cancellation,
            false,
        )
        .await?;
        if reply.tool_calls.is_empty() {
            let text = reply.content.unwrap_or_default();
            if text.trim().is_empty() {
                return Err(AgentRuntimeError::Core(
                    "user gate autoResolve produced an empty answer".to_string(),
                ));
            }
            return Ok(text);
        }
        let mut previews = Vec::new();
        for call in reply.tool_calls {
            let output = execute_model_tool_with_runtime(
                session_id,
                &format!("{turn_id}::user-gate"),
                &dispatcher,
                &cancellation,
                runtime,
                call.clone(),
            )
            .await;
            previews.push(format!(
                "{}: {}",
                call.name,
                truncate_chars(
                    &tool_result_preview(&output),
                    AUTO_RESOLVE_TOOL_PREVIEW_CHARS
                )
            ));
        }
        messages.push(json!({
            "role": "user",
            "content": format!("Tool results:\n{}", previews.join("\n")),
        }));
    }
    Err(AgentRuntimeError::Core(
        "user gate autoResolve did not produce a JSON answer".to_string(),
    ))
}

fn filter_auto_resolve_tools(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter(|tool| {
            let name = tool_name(tool).to_ascii_lowercase();
            if name.contains("clarification")
                || name.contains("plan_finalize")
                || name.contains("plan_begin")
                || name.contains("ask")
            {
                return false;
            }
            name.contains("read")
                || name.contains("list")
                || name.contains("search")
                || name.contains("map")
                || name.contains("see")
                || name.contains("inspect")
                || name.contains("grep")
                || name.contains("glob")
                || name.contains("status")
                || name.contains("diff")
        })
        .cloned()
        .collect()
}

fn tool_name(tool: &Value) -> String {
    tool.pointer("/function/name")
        .or_else(|| tool.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn tool_result_preview(output: &Value) -> String {
    output
        .get("content")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| serde_json::to_string(output).ok())
        .unwrap_or_default()
}

fn session_evidence_excerpt(messages: &[Value], tools: &[Value]) -> String {
    let mut lines = Vec::new();
    for message in messages.iter().rev().take(SESSION_EXCERPT_MESSAGES).rev() {
        let role = message.get("role").and_then(Value::as_str).unwrap_or("?");
        let content = message
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(800)
            .collect::<String>();
        if content.trim().is_empty() {
            continue;
        }
        lines.push(format!("{role}: {content}"));
    }
    for tool in tools.iter().rev().take(SESSION_EXCERPT_TOOLS).rev() {
        let name = tool
            .get("name")
            .or_else(|| tool.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("tool");
        let content = tool
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .chars()
            .take(400)
            .collect::<String>();
        lines.push(format!("tool {name}: {content}"));
    }
    if lines.is_empty() {
        "(no additional session excerpt)".to_string()
    } else {
        lines.join("\n")
    }
}

fn truncate_chars(value: &str, max: usize) -> String {
    let mut truncated = value.chars().take(max).collect::<String>();
    if value.chars().count() > max {
        truncated.push('…');
    }
    truncated
}

pub(crate) fn parse_autonomous_answer(
    kind: UserGateKind,
    gate: &Value,
    text: &str,
) -> AgentRuntimeResult<Value> {
    let parsed = extract_json_object(text)?;
    parse_autonomous_answer_from_value(kind, gate, parsed)
}

fn parse_autonomous_answer_from_value(
    kind: UserGateKind,
    gate: &Value,
    parsed: Value,
) -> AgentRuntimeResult<Value> {
    match kind {
        UserGateKind::Clarification => parse_clarification_answer(gate, &parsed),
        UserGateKind::Permission => parse_permission_answer(&parsed),
        UserGateKind::PlanReview => parse_plan_review_answer(&parsed),
    }
}

fn extract_json_object(text: &str) -> AgentRuntimeResult<Value> {
    let trimmed = text.trim();
    let fenced = trimmed
        .strip_prefix("```json")
        .or_else(|| trimmed.strip_prefix("```"))
        .and_then(|body| body.strip_suffix("```"))
        .map(str::trim)
        .unwrap_or(trimmed);
    if let Ok(value) = serde_json::from_str::<Value>(fenced) {
        return Ok(value);
    }
    let start = fenced.find('{').ok_or_else(|| {
        AgentRuntimeError::Core("user gate autoResolve did not return JSON".to_string())
    })?;
    let end = fenced.rfind('}').ok_or_else(|| {
        AgentRuntimeError::Core("user gate autoResolve did not return JSON".to_string())
    })?;
    serde_json::from_str(&fenced[start..=end]).map_err(|error| {
        AgentRuntimeError::Core(format!("user gate autoResolve JSON parse failed: {error}"))
    })
}

fn parse_clarification_answer(gate: &Value, parsed: &Value) -> AgentRuntimeResult<Value> {
    let payload = gate.get("payload").unwrap_or(gate);
    let options = payload
        .get("options")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let allow_custom = payload
        .get("allowCustomAnswer")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let selected = parsed
        .get("selectedOptionValue")
        .or_else(|| parsed.get("selectedOption"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let answer = parsed
        .get("answer")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if options.is_empty() {
        let answer = answer.or(selected).ok_or_else(|| {
            AgentRuntimeError::Core(
                "user gate autoResolve clarification is missing answer".to_string(),
            )
        })?;
        return Ok(json!({ "answer": answer }));
    }
    let matched = options.iter().find_map(|option| {
        let label = option_label(option);
        let value = option_value(option);
        let selected_ref = selected.as_deref();
        let answer_ref = answer.as_deref();
        if selected_ref == Some(value.as_str())
            || selected_ref == Some(label.as_str())
            || answer_ref == Some(value.as_str())
            || answer_ref == Some(label.as_str())
        {
            Some((label, value))
        } else {
            None
        }
    });
    if let Some((label, value)) = matched {
        return Ok(json!({
            "answer": label,
            "selectedOption": label,
            "selectedOptionValue": value,
        }));
    }
    if allow_custom {
        let answer = answer.or(selected).ok_or_else(|| {
            AgentRuntimeError::Core(
                "user gate autoResolve clarification custom answer is missing".to_string(),
            )
        })?;
        return Ok(json!({ "answer": answer, "selectedOptionValue": Value::Null }));
    }
    Err(AgentRuntimeError::Core(
        "user gate autoResolve clarification did not match a legal option".to_string(),
    ))
}

fn option_label(option: &Value) -> String {
    if let Some(label) = option.get("label").and_then(Value::as_str) {
        return label.to_string();
    }
    option.as_str().unwrap_or_default().to_string()
}

fn option_value(option: &Value) -> String {
    option
        .get("value")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| option_label(option))
}

fn parse_permission_answer(parsed: &Value) -> AgentRuntimeResult<Value> {
    if let Some(allowed) = parsed.get("allowed").and_then(Value::as_bool) {
        return Ok(json!({ "allowed": allowed }));
    }
    match parsed
        .get("action")
        .or_else(|| parsed.get("decision"))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("allow") | Some("approve") | Some("approved") => Ok(json!({ "allowed": true })),
        Some("deny") | Some("denied") | Some("reject") => Ok(json!({ "allowed": false })),
        _ => Err(AgentRuntimeError::Core(
            "user gate autoResolve permission is missing allowed".to_string(),
        )),
    }
}

fn parse_plan_review_answer(parsed: &Value) -> AgentRuntimeResult<Value> {
    let action = parsed
        .get("action")
        .or_else(|| parsed.get("resolution"))
        .and_then(Value::as_str)
        .map(|value| value.trim().to_ascii_lowercase())
        .ok_or_else(|| {
            AgentRuntimeError::Core(
                "user gate autoResolve plan review is missing action".to_string(),
            )
        })?;
    let normalized = match action.as_str() {
        "approve" | "approved" => "approve",
        "set_aside" | "set-aside" | "defer" | "reject" | "rejected" => "set_aside",
        "request_revision" | "revise" | "revision" => "request_revision",
        _ => {
            return Err(AgentRuntimeError::Core(format!(
                "user gate autoResolve plan review action is illegal: {action}"
            )));
        }
    };
    let mut body = json!({ "action": normalized });
    if let Some(feedback) = parsed.get("feedback").and_then(Value::as_str) {
        body["feedback"] = json!(feedback);
    }
    Ok(body)
}

fn resolve_source_from_payload(payload: &Value) -> String {
    string_opt(payload, "resolveSource").unwrap_or_else(|| "user".to_string())
}

pub(crate) fn clarification_resolve_source(payload: &Value) -> String {
    resolve_source_from_payload(payload)
}

pub(crate) fn permission_resolve_source(payload: &Value) -> String {
    resolve_source_from_payload(payload)
}

pub(crate) fn plan_review_resolve_source(payload: &Value) -> String {
    resolve_source_from_payload(payload)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clarification_gate() -> Value {
        json!({
            "id": "clar-1",
            "kind": "clarification",
            "payload": {
                "question": "Which style?",
                "allowCustomAnswer": false,
                "options": [
                    {"label": "Detailed", "value": "detailed"},
                    {"label": "Brief", "value": "brief"}
                ]
            }
        })
    }

    #[test]
    fn parse_clarification_matches_option_value_not_first() {
        let parsed = parse_autonomous_answer(
            UserGateKind::Clarification,
            &clarification_gate(),
            "{\"selectedOptionValue\":\"brief\",\"answer\":\"Brief\"}",
        )
        .expect("parse");
        assert_eq!(parsed["selectedOptionValue"], "brief");
        assert_eq!(parsed["answer"], "Brief");
    }

    #[test]
    fn parse_clarification_refuses_to_guess_the_first_option() {
        let error = parse_autonomous_answer(
            UserGateKind::Clarification,
            &clarification_gate(),
            "{\"comment\":\"I am thinking\"}",
        )
        .expect_err("must not default");
        assert!(error.to_string().contains("did not match a legal option"));
    }

    #[test]
    fn parse_permission_requires_explicit_allowed() {
        let parsed = parse_autonomous_answer(
            UserGateKind::Permission,
            &json!({}),
            "```json\n{\"allowed\":false}\n```",
        )
        .expect("parse");
        assert_eq!(parsed["allowed"], false);
        parse_autonomous_answer(UserGateKind::Permission, &json!({}), "{}")
            .expect_err("missing allowed");
    }

    #[test]
    fn parse_plan_review_normalizes_action() {
        let parsed = parse_autonomous_answer(
            UserGateKind::PlanReview,
            &json!({}),
            "{\"action\":\"approved\",\"feedback\":\"ship it\"}",
        )
        .expect("parse");
        assert_eq!(parsed["action"], "approve");
        assert_eq!(parsed["feedback"], "ship it");
    }

    #[test]
    fn auto_resolve_tools_keep_reads_and_drop_gate_openers() {
        let tools = vec![
            json!({ "name": "read_file" }),
            json!({ "function": { "name": "plan_finalize" } }),
            json!({ "name": "ask_user" }),
            json!({ "name": "grep" }),
            json!({ "name": "wait_for_clarification" }),
        ];
        let kept: Vec<String> = filter_auto_resolve_tools(&tools)
            .iter()
            .map(|tool| tool_name(tool))
            .collect();
        assert_eq!(kept, vec!["read_file".to_string(), "grep".to_string()]);
    }

    #[test]
    fn resolve_user_gate_dispatches_clarification() {
        let backend = LyraAgentBackend;
        let created = backend
            .call_agent_method(
                "agent.session.create",
                json!({ "title": "UserGate dispatch" }),
            )
            .expect("create session");
        let session_id = created["id"].as_str().expect("session id").to_string();
        let clarification_id = format!("clar-dispatch-{session_id}");
        {
            let mut state = state().lock().expect("state");
            state.pending_clarifications.insert(
                clarification_id.clone(),
                ClarificationRequest {
                    id: clarification_id.clone(),
                    session_id: session_id.clone(),
                    turn_id: "turn-dispatch".to_string(),
                    tool_call_id: "tool-dispatch".to_string(),
                    question: "Which style?".to_string(),
                    i18n_key: None,
                    options: vec![json!({"label": "Brief", "value": "brief"})],
                    allow_custom_answer: false,
                    detail: None,
                    detail_i18n_key: None,
                    status: "pending".to_string(),
                    answer: None,
                    selected_option: None,
                    created_at: now(),
                    responded_at: None,
                },
            );
        }
        let result = resolve_user_gate(json!({
            "kind": "clarification",
            "sessionId": session_id,
            "gateId": clarification_id,
            "answer": "Brief",
            "selectedOptionValue": "brief",
        }))
        .expect("resolve");
        assert_eq!(result["status"], "resumed");
        assert_eq!(result["selectedOptionValue"], "brief");
    }

    struct RestoreAutonomousFixture;

    impl Drop for RestoreAutonomousFixture {
        fn drop(&mut self) {
            set_test_auto_resolve_proposal(None);
            clear_test_auto_resolve_hold();
            let _ = set_permission_policy_mode(json!({ "mode": "approval" }));
        }
    }

    #[test]
    fn auto_resolve_requires_autonomous_mode() {
        let _restore = RestoreAutonomousFixture;
        set_test_auto_resolve_proposal(None);
        set_permission_policy_mode(json!({ "mode": "approval" })).expect("approval");
        let error = auto_resolve_user_gate(json!({ "gateId": "missing" })).expect_err("mode");
        assert!(error.to_string().contains("autonomous"));
    }

    #[test]
    fn auto_resolve_uses_fixture_answer_not_first_option() {
        let _restore = RestoreAutonomousFixture;
        set_permission_policy_mode(json!({ "mode": "autonomous" })).expect("autonomous");
        set_test_auto_resolve_proposal(Some(json!({
            "selectedOptionValue": "brief",
            "answer": "Brief",
        })));
        let backend = LyraAgentBackend;
        let created = backend
            .call_agent_method(
                "agent.session.create",
                json!({ "title": "UserGate autoResolve" }),
            )
            .expect("create session");
        let session_id = created["id"].as_str().expect("session id").to_string();
        let clarification_id = format!("clar-auto-{session_id}");
        {
            let mut state = state().lock().expect("state");
            state.pending_clarifications.insert(
                clarification_id.clone(),
                ClarificationRequest {
                    id: clarification_id.clone(),
                    session_id: session_id.clone(),
                    turn_id: "turn-auto".to_string(),
                    tool_call_id: "tool-auto".to_string(),
                    question: "Which style?".to_string(),
                    i18n_key: None,
                    options: vec![
                        json!({"label": "Detailed", "value": "detailed"}),
                        json!({"label": "Brief", "value": "brief"}),
                    ],
                    allow_custom_answer: false,
                    detail: None,
                    detail_i18n_key: None,
                    status: "pending".to_string(),
                    answer: None,
                    selected_option: None,
                    created_at: now(),
                    responded_at: None,
                },
            );
        }
        let listed = list_user_gates(json!({ "sessionId": session_id })).expect("list");
        assert_eq!(listed["gates"].as_array().map(Vec::len), Some(1));
        let result = auto_resolve_user_gate(json!({ "gateId": clarification_id })).expect("auto");
        assert_eq!(result["status"], "resumed");
        assert_eq!(result["selectedOptionValue"], "brief");
        assert_eq!(result["resolveSource"], "autonomous");
        let listed = list_user_gates(json!({ "sessionId": session_id })).expect("list after");
        assert_eq!(listed["gates"].as_array().map(Vec::len), Some(0));
    }

    async fn wait_until(label: &str, mut ready: impl FnMut() -> bool) {
        let deadline = Instant::now() + std::time::Duration::from_secs(2);
        while !ready() {
            assert!(Instant::now() < deadline, "{label} did not become ready");
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    }

    fn listed_kinds(session_id: &str) -> Vec<String> {
        list_user_gates(json!({ "sessionId": session_id }))
            .expect("list")
            .get("gates")
            .and_then(Value::as_array)
            .map(|gates| {
                gates
                    .iter()
                    .filter_map(|gate| gate.get("kind").and_then(Value::as_str).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn auto_resolve_thinking_does_not_block_sibling_waits() {
        let _restore = RestoreAutonomousFixture;
        set_permission_policy_mode(json!({ "mode": "autonomous" })).expect("autonomous");
        set_test_auto_resolve_proposal(Some(json!({
            "selectedOptionValue": "brief",
            "answer": "Brief",
        })));
        let backend = LyraAgentBackend;
        let created = backend
            .call_agent_method(
                "agent.session.create",
                json!({ "title": "UserGate sibling waits" }),
            )
            .expect("create session");
        let session_id = created["id"].as_str().expect("session id").to_string();
        let clarification_id = format!("clar-hold-{session_id}");
        let sibling_id = format!("clar-sibling-{session_id}");
        let permission_id = format!("perm-sibling-{session_id}");
        {
            let mut state = state().lock().expect("state");
            let session = state.sessions.get_mut(&session_id).expect("session");
            session.snapshot["plan"] = json!({
                "activePlanId": format!("plan-{}", Uuid::new_v4()),
                "activeVersionId": format!("plan-version-{}", Uuid::new_v4()),
                "title": "Sibling plan",
                "phase": PLAN_PHASE_PLANNING,
                "markdown": "# Plan\n\n- Keep going\n",
                "annotations": [],
            });
            state.pending_clarifications.insert(
                clarification_id.clone(),
                ClarificationRequest {
                    id: clarification_id.clone(),
                    session_id: session_id.clone(),
                    turn_id: "turn-hold".to_string(),
                    tool_call_id: "tool-hold".to_string(),
                    question: "Which style?".to_string(),
                    i18n_key: None,
                    options: vec![
                        json!({"label": "Detailed", "value": "detailed"}),
                        json!({"label": "Brief", "value": "brief"}),
                    ],
                    allow_custom_answer: false,
                    detail: None,
                    detail_i18n_key: None,
                    status: "pending".to_string(),
                    answer: None,
                    selected_option: None,
                    created_at: now(),
                    responded_at: None,
                },
            );
        }
        let _ = record_open(
            UserGateKind::Clarification,
            &clarification_id,
            &session_id,
            "turn-hold",
            json!({ "question": "Which style?" }),
        );
        let release = arm_test_auto_resolve_hold();
        let auto = tokio::spawn(auto_resolve_user_gate_async(json!({
            "gateId": clarification_id.clone()
        })));
        wait_until("auto-resolve in flight", || {
            auto_resolve_in_flight(&clarification_id)
        })
        .await;
        assert!(!auto.is_finished(), "auto-resolve finished before the hold");

        tool_plan_finalize(&session_id, "turn-hold", &json!({}))
            .expect("plan review must open while auto-resolve is thinking");

        let sibling_session = session_id.clone();
        let sibling_task = tokio::spawn(wait_for_clarification_async(ClarificationRequest {
            id: sibling_id.clone(),
            session_id: sibling_session,
            turn_id: "turn-sibling".to_string(),
            tool_call_id: "tool-sibling".to_string(),
            question: "Keep going?".to_string(),
            i18n_key: None,
            options: Vec::new(),
            allow_custom_answer: true,
            detail: None,
            detail_i18n_key: None,
            status: "pending".to_string(),
            answer: None,
            selected_option: None,
            created_at: now(),
            responded_at: None,
        }));
        wait_until("sibling clarification", || {
            state()
                .lock()
                .ok()
                .is_some_and(|state| state.pending_clarifications.contains_key(&sibling_id))
        })
        .await;

        let permission_cancel = CancellationToken::new();
        let permission_wait_cancel = permission_cancel.clone();
        let permission_session = session_id.clone();
        let permission_lookup = permission_id.clone();
        let permission_task = tokio::spawn(async move {
            wait_for_permission_with_cancellation_async(
                PermissionRequest {
                    id: permission_id,
                    session_id: permission_session,
                    turn_id: "turn-perm".to_string(),
                    tool_call_id: "tool-perm".to_string(),
                    action: "exec_command".to_string(),
                    risk: "shell".to_string(),
                    summary: "Run a command".to_string(),
                    why: "Sibling wait coverage".to_string(),
                    title: "Run shell command".to_string(),
                    detail: "Run a command".to_string(),
                    status: "pending".to_string(),
                    allowed: None,
                    created_at: now(),
                    responded_at: None,
                },
                &permission_wait_cancel,
            )
            .await
        });
        wait_until("sibling permission", || {
            state()
                .lock()
                .ok()
                .is_some_and(|state| state.pending_permissions.contains_key(&permission_lookup))
        })
        .await;

        let kinds = listed_kinds(&session_id);
        assert_eq!(
            kinds.iter().filter(|kind| *kind == "clarification").count(),
            2
        );
        assert!(kinds.iter().any(|kind| kind == "permission"));
        assert!(kinds.iter().any(|kind| kind == "plan_review"));

        respond_clarification(json!({
            "sessionId": session_id,
            "clarificationId": sibling_id,
            "answer": "yes",
        }))
        .expect("answer sibling");
        sibling_task
            .await
            .expect("sibling join")
            .expect("sibling wait");
        permission_cancel.cancel();
        let _ = permission_task.await;
        release.send(()).expect("release auto-resolve");
        let auto_result = auto.await.expect("auto join").expect("auto-resolve");
        assert_eq!(auto_result["selectedOptionValue"], "brief");
        assert_eq!(auto_result["resolveSource"], "autonomous");
    }
}
