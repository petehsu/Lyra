use super::*;

pub(crate) const LYRA_TASK_CONTRACT_REPORT_TOOL: &str = "lyra_task_contract_report";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskContract {
    pub(crate) action: TaskAction,
    #[serde(default)]
    pub(crate) surfaces: Vec<TaskSurface>,
    pub(crate) scope: TaskScope,
    #[serde(default)]
    pub(crate) targets: Vec<TaskTarget>,
    pub(crate) constraints: TaskConstraints,
    pub(crate) ambiguity: TaskAmbiguity,
    pub(crate) relation: TaskRelation,
    pub(crate) confidence: ContractConfidence,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskAction {
    Respond,
    Inspect,
    Plan,
    Implement,
    Review,
    Debug,
    Test,
    Refactor,
    Optimize,
    Operate,
    Control,
}

impl TaskAction {
    pub(crate) fn requires_workspace_evidence(self) -> bool {
        !matches!(self, Self::Respond | Self::Control)
    }

    pub(crate) fn permits_artifact_mutation(self) -> bool {
        matches!(
            self,
            Self::Implement | Self::Debug | Self::Test | Self::Refactor | Self::Optimize
        )
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskSurface {
    Code,
    Ui,
    Ux,
    Web,
    Browser,
    Desktop,
    Terminal,
    Files,
    Docs,
    Data,
    Image,
    AgentRuntime,
    Infrastructure,
    Other,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskScope {
    Local,
    Major,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskTarget {
    pub(crate) kind: TaskTargetKind,
    pub(crate) value: String,
    #[serde(default)]
    pub(crate) evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskTargetKind {
    File,
    Symbol,
    Module,
    Route,
    Url,
    Selector,
    Artifact,
    Other,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskConstraints {
    pub(crate) maturity: ContractValue<Maturity>,
    pub(crate) architecture: ContractValue<Architecture>,
    #[serde(default)]
    pub(crate) visual_choices: Vec<VisualChoice>,
    #[serde(default)]
    pub(crate) delegated_decisions: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Maturity {
    Production,
    Demo,
    Prototype,
    Unspecified,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Architecture {
    Standard,
    SingleFile,
    Unspecified,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContractValue<T> {
    pub(crate) value: T,
    pub(crate) authority: ContractAuthority,
    #[serde(default)]
    pub(crate) evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ContractAuthority {
    ExplicitUser,
    Inherited,
    Delegated,
    Unspecified,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VisualChoice {
    pub(crate) kind: VisualChoiceKind,
    pub(crate) value: String,
    pub(crate) authority: VisualChoiceAuthority,
    #[serde(default)]
    pub(crate) evidence: Vec<EvidenceRef>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VisualChoiceKind {
    Color,
    Font,
    Motion,
    Layout,
    Material,
    Other,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VisualChoiceAuthority {
    ExplicitUser,
    ExistingSystem,
    Reference,
    Delegated,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskAmbiguity {
    pub(crate) level: AmbiguityLevel,
    #[serde(default)]
    pub(crate) missing: Vec<MissingTaskContext>,
    #[serde(default)]
    pub(crate) can_inspect_before_clarifying: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AmbiguityLevel {
    None,
    NonBlocking,
    Blocking,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MissingTaskContext {
    Purpose,
    Audience,
    Content,
    Workflow,
    Target,
    Other,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TaskRelation {
    pub(crate) kind: TaskRelationKind,
    pub(crate) prior_message_id: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskRelationKind {
    New,
    Continue,
    Refine,
    Supersede,
    Correct,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ContractConfidence {
    High,
    Medium,
    Low,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub(crate) enum EvidenceRef {
    UserText {
        quote: String,
        #[serde(default)]
        occurrence: Option<usize>,
    },
    Citation {
        id: String,
    },
    Attachment {
        id: String,
    },
}

#[derive(Clone, Debug)]
pub(crate) struct BoundTaskContract {
    pub(crate) user_message_id: String,
    pub(crate) contract: TaskContract,
    pub(crate) locked: bool,
}

pub(crate) fn task_contract_report_model_tool() -> Value {
    function_tool(
        LYRA_TASK_CONTRACT_REPORT_TOOL,
        "Report the structured contract for the current real user message. Required before planning, file changes, OMA delegation, or external side effects. Evidence quotes and ids must point to the current message; do not infer Demo, prototype, single-file architecture, or specific visual choices without valid authority.",
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["respond", "inspect", "plan", "implement", "review", "debug", "test", "refactor", "optimize", "operate", "control"]
                },
                "surfaces": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["code", "ui", "ux", "web", "browser", "desktop", "terminal", "files", "docs", "data", "image", "agent_runtime", "infrastructure", "other"]
                    }
                },
                "scope": { "type": "string", "enum": ["local", "major", "unknown"] },
                "targets": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "kind": { "type": "string", "enum": ["file", "symbol", "module", "route", "url", "selector", "artifact", "other"] },
                            "value": { "type": "string" },
                            "evidence": { "$ref": "#/$defs/evidenceArray" }
                        },
                        "required": ["kind", "value"]
                    }
                },
                "constraints": {
                    "type": "object",
                    "properties": {
                        "maturity": {
                            "allOf": [
                                { "$ref": "#/$defs/contractValue" },
                                {
                                    "properties": {
                                        "value": { "type": "string", "enum": ["production", "demo", "prototype", "unspecified"] }
                                    }
                                }
                            ]
                        },
                        "architecture": {
                            "allOf": [
                                { "$ref": "#/$defs/contractValue" },
                                {
                                    "properties": {
                                        "value": { "type": "string", "enum": ["standard", "single_file", "unspecified"] }
                                    }
                                }
                            ]
                        },
                        "visualChoices": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "kind": { "type": "string", "enum": ["color", "font", "motion", "layout", "material", "other"] },
                                    "value": { "type": "string" },
                                    "authority": { "type": "string", "enum": ["explicit_user", "existing_system", "reference", "delegated"] },
                                    "evidence": { "$ref": "#/$defs/evidenceArray" }
                                },
                                "required": ["kind", "value", "authority", "evidence"]
                            }
                        },
                        "delegatedDecisions": { "type": "boolean" }
                    },
                    "required": ["maturity", "architecture", "visualChoices", "delegatedDecisions"]
                },
                "ambiguity": {
                    "type": "object",
                    "properties": {
                        "level": { "type": "string", "enum": ["none", "non_blocking", "blocking"] },
                        "missing": {
                            "type": "array",
                            "items": { "type": "string", "enum": ["purpose", "audience", "content", "workflow", "target", "other"] }
                        },
                        "canInspectBeforeClarifying": { "type": "boolean" }
                    },
                    "required": ["level", "missing", "canInspectBeforeClarifying"]
                },
                "relation": {
                    "type": "object",
                    "properties": {
                        "kind": { "type": "string", "enum": ["new", "continue", "refine", "supersede", "correct"] },
                        "priorMessageId": { "type": "string" }
                    },
                    "required": ["kind"]
                },
                "confidence": { "type": "string", "enum": ["high", "medium", "low"] }
            },
            "required": ["action", "surfaces", "scope", "targets", "constraints", "ambiguity", "relation", "confidence"],
            "$defs": {
                "evidence": {
                    "oneOf": [
                        {
                            "type": "object",
                            "properties": {
                                "source": { "const": "user_text" },
                                "quote": { "type": "string" },
                                "occurrence": { "type": "integer", "minimum": 1 }
                            },
                            "required": ["source", "quote"]
                        },
                        {
                            "type": "object",
                            "properties": {
                                "source": { "const": "citation" },
                                "id": { "type": "string" }
                            },
                            "required": ["source", "id"]
                        },
                        {
                            "type": "object",
                            "properties": {
                                "source": { "const": "attachment" },
                                "id": { "type": "string" }
                            },
                            "required": ["source", "id"]
                        }
                    ]
                },
                "evidenceArray": {
                    "type": "array",
                    "items": { "$ref": "#/$defs/evidence" }
                },
                "contractValue": {
                    "type": "object",
                    "properties": {
                        "value": { "type": "string" },
                        "authority": { "type": "string", "enum": ["explicit_user", "inherited", "delegated", "unspecified"] },
                        "evidence": { "$ref": "#/$defs/evidenceArray" }
                    },
                    "required": ["value", "authority", "evidence"]
                }
            }
        }),
    )
}

pub(crate) fn execute_task_contract_report_model_tool(
    session_id: &str,
    turn_id: &str,
    arguments: Value,
) -> Value {
    match report_task_contract(session_id, turn_id, arguments) {
        Ok(bound) => json!({
            "content": "Task contract accepted.",
            "raw": {
                "kind": "task_contract",
                "userMessageId": bound.user_message_id,
                "contract": bound.contract,
                "locked": bound.locked,
            }
        }),
        Err(error) => tool_failure_output(
            &error.code,
            &error.message,
            &error.recommended_next_action,
            error.detail,
        ),
    }
}

pub(crate) fn task_contract_gate_model_tool(
    session_id: &str,
    turn_id: &str,
    tool_call_id: &str,
    tool_name: &str,
    arguments: Value,
    started_at: &str,
) -> Option<Value> {
    let effect = match tool_name {
        PLAN_BEGIN_MODEL_TOOL
        | PLAN_WRITE_MODEL_TOOL
        | PLAN_FINALIZE_MODEL_TOOL
        | PLAN_REVISE_MODEL_TOOL => "plan",
        TODO_WRITE_MODEL_TOOL | TODO_UPDATE_MODEL_TOOL | TODO_FINISH_MODEL_TOOL => "todo",
        _ => return None,
    };
    let result = {
        let state = state().lock().ok()?;
        let session = state.sessions.get(session_id)?;
        require_task_contract(session, turn_id)
    }
    .and_then(|_| lock_task_contract_for_side_effect(session_id, turn_id, effect));
    let failure = result.err()?;
    let output = tool_failure_output(
        &failure.code,
        &failure.message,
        &failure.recommended_next_action,
        failure.detail,
    );
    record_tool_activity(
        session_id,
        turn_id,
        tool_activity(
            tool_call_id,
            tool_name,
            tool_name,
            "failed",
            arguments,
            Some(output.clone()),
            started_at,
            Some(now()),
        ),
        "toolFinished",
    );
    Some(output)
}

pub(crate) fn task_contract_for_turn(
    session: &NativeSession,
    turn_id: &str,
) -> Result<BoundTaskContract, NativeToolFailure> {
    let user_message_id = turn_user_message_id(session, turn_id)?;
    bound_contract_for_message(session, &user_message_id)
}

pub(crate) fn require_task_contract(
    session: &NativeSession,
    turn_id: &str,
) -> Result<BoundTaskContract, NativeToolFailure> {
    task_contract_for_turn(session, turn_id).map_err(|error| {
        if error.code == "task_contract_missing" {
            NativeToolFailure::new(
                "task_contract_required",
                "A structured Task Contract is required before this operation.",
                "Call lyra_task_contract_report for the current user message, then retry the operation.",
            )
            .with_detail(json!({
                "requiredTool": LYRA_TASK_CONTRACT_REPORT_TOOL,
                "turnId": turn_id,
            }))
        } else {
            error
        }
    })
}

pub(crate) fn lock_task_contract_for_side_effect(
    session_id: &str,
    turn_id: &str,
    effect: &str,
) -> Result<BoundTaskContract, NativeToolFailure> {
    let mut state = state().lock().map_err(|_| {
        NativeToolFailure::new(
            "runtime_state_unavailable",
            "agent runtime state lock failed",
            "Retry the operation.",
        )
    })?;
    let session = state.sessions.get_mut(session_id).ok_or_else(|| {
        NativeToolFailure::new(
            "session_not_found",
            format!("session not found: {session_id}"),
            "Retry in an active session.",
        )
    })?;
    let user_message_id = turn_user_message_id(session, turn_id)?;
    let message = message_mut(session, &user_message_id)?;
    let contract_value = message
        .pointer("/metadata/taskContract/contract")
        .cloned()
        .ok_or_else(task_contract_missing)?;
    let contract: TaskContract = serde_json::from_value(contract_value).map_err(|error| {
        NativeToolFailure::new(
            "task_contract_invalid",
            format!("Stored Task Contract is invalid: {error}"),
            "Call lyra_task_contract_report again before any side effect.",
        )
    })?;
    ensure_metadata_object(message);
    message["metadata"]["taskContract"]["locked"] = Value::Bool(true);
    if message["metadata"]["taskContract"]["lockedAt"].is_null() {
        message["metadata"]["taskContract"]["lockedAt"] = Value::String(now());
        message["metadata"]["taskContract"]["lockEffect"] = Value::String(effect.to_string());
    }
    touch_session(session);
    state.save_state().map_err(|error| {
        NativeToolFailure::new(
            "write_failed",
            format!("failed to persist Task Contract lock: {error}"),
            "Retry after checking Lyra local storage.",
        )
    })?;
    Ok(BoundTaskContract {
        user_message_id,
        contract,
        locked: true,
    })
}

pub(crate) fn inherit_task_contract(
    source_session: &NativeSession,
    source_turn_id: &str,
    target_message: &mut Value,
) -> Result<(), NativeToolFailure> {
    let bound = require_task_contract(source_session, source_turn_id)?;
    inherit_task_contract_value(
        &bound.contract,
        Some(&bound.user_message_id),
        Some(source_turn_id),
        bound.locked,
        target_message,
    )
}

pub(crate) fn inherit_task_contract_value(
    contract: &TaskContract,
    source_message_id: Option<&str>,
    source_turn_id: Option<&str>,
    locked: bool,
    target_message: &mut Value,
) -> Result<(), NativeToolFailure> {
    let contract = serde_json::to_value(contract).map_err(|error| {
        NativeToolFailure::new(
            "task_contract_invalid",
            format!("Inherited Task Contract could not be serialized: {error}"),
            "Retry from the original user turn.",
        )
    })?;
    ensure_metadata_object(target_message);
    target_message["metadata"]["taskContract"] = json!({
        "contract": contract,
        "reportedAt": now(),
        "reportedForTurnId": source_turn_id,
        "boundUserMessageId": target_message.get("id").cloned().unwrap_or(Value::Null),
        "inheritedFromMessageId": source_message_id,
        "inheritedSourceLocked": locked,
        "locked": true,
        "lockedAt": now(),
        "lockEffect": "inherited",
    });
    Ok(())
}

fn report_task_contract(
    session_id: &str,
    turn_id: &str,
    arguments: Value,
) -> Result<BoundTaskContract, NativeToolFailure> {
    let mut contract: TaskContract = serde_json::from_value(arguments).map_err(|error| {
        NativeToolFailure::new(
            "task_contract_invalid",
            format!("Task Contract does not match the required schema: {error}"),
            "Retry lyra_task_contract_report with every required structured field.",
        )
    })?;
    let mut state = state().lock().map_err(|_| {
        NativeToolFailure::new(
            "runtime_state_unavailable",
            "agent runtime state lock failed",
            "Retry the Task Contract report.",
        )
    })?;
    let session = state.sessions.get_mut(session_id).ok_or_else(|| {
        NativeToolFailure::new(
            "session_not_found",
            format!("session not found: {session_id}"),
            "Retry in an active session.",
        )
    })?;
    let user_message_id = turn_user_message_id(session, turn_id)?;
    {
        let message = message(session, &user_message_id)?;
        if message
            .pointer("/metadata/taskContract/locked")
            .and_then(Value::as_bool)
            == Some(true)
        {
            return Err(NativeToolFailure::new(
                "task_contract_locked",
                "The Task Contract is locked because this turn already produced a side effect.",
                "Send a new user message to correct or supersede the contract.",
            ));
        }
        validate_contract_evidence(session, message, &contract)?;
    }
    normalize_contract(&mut contract)?;
    let message = message_mut(session, &user_message_id)?;
    ensure_metadata_object(message);
    message["metadata"]["taskContract"] = json!({
        "contract": contract,
        "reportedAt": now(),
        "reportedForTurnId": turn_id,
        "boundUserMessageId": user_message_id,
        "locked": false,
        "lockedAt": Value::Null,
        "lockEffect": Value::Null,
    });
    touch_session(session);
    state.save_state().map_err(|error| {
        NativeToolFailure::new(
            "write_failed",
            format!("failed to persist Task Contract: {error}"),
            "Retry after checking Lyra local storage.",
        )
    })?;
    Ok(BoundTaskContract {
        user_message_id,
        contract,
        locked: false,
    })
}

fn normalize_contract(contract: &mut TaskContract) -> Result<(), NativeToolFailure> {
    if contract.surfaces.is_empty() {
        contract.surfaces.push(TaskSurface::Other);
    }
    for target in &mut contract.targets {
        target.value = target.value.trim().to_string();
        if target.value.is_empty() {
            return Err(NativeToolFailure::new(
                "task_contract_invalid_target",
                "Task Contract targets cannot contain an empty value.",
                "Remove the empty target or report its concrete identifier.",
            ));
        }
    }
    match contract.constraints.maturity.value {
        Maturity::Unspecified => {
            contract.constraints.maturity = ContractValue {
                value: Maturity::Production,
                authority: ContractAuthority::Unspecified,
                evidence: Vec::new(),
            };
        }
        Maturity::Demo | Maturity::Prototype => {
            require_explicit_value_evidence(
                "maturity",
                contract.constraints.maturity.authority,
                &contract.constraints.maturity.evidence,
            )?;
        }
        Maturity::Production => {}
    }
    match contract.constraints.architecture.value {
        Architecture::Unspecified => {
            contract.constraints.architecture = ContractValue {
                value: Architecture::Standard,
                authority: ContractAuthority::Unspecified,
                evidence: Vec::new(),
            };
        }
        Architecture::SingleFile => {
            require_explicit_value_evidence(
                "single-file architecture",
                contract.constraints.architecture.authority,
                &contract.constraints.architecture.evidence,
            )?;
        }
        Architecture::Standard => {}
    }
    for choice in &mut contract.constraints.visual_choices {
        choice.value = choice.value.trim().to_string();
        if choice.value.is_empty() {
            return Err(NativeToolFailure::new(
                "task_contract_invalid_visual_choice",
                "Visual choices must contain a concrete value.",
                "Remove the choice or report the exact authorized value.",
            ));
        }
        match choice.authority {
            VisualChoiceAuthority::ExplicitUser
            | VisualChoiceAuthority::ExistingSystem
            | VisualChoiceAuthority::Reference => {
                if choice.evidence.is_empty() {
                    return Err(NativeToolFailure::new(
                        "task_contract_visual_evidence_required",
                        "A specific visual choice requires evidence from the user, existing system, or reference.",
                        "Attach a valid EvidenceRef or leave the visual choice unspecified.",
                    ));
                }
            }
            VisualChoiceAuthority::Delegated => {
                if !contract.constraints.delegated_decisions {
                    return Err(NativeToolFailure::new(
                        "task_contract_delegation_required",
                        "A delegated visual choice requires delegatedDecisions=true.",
                        "Report delegation only when the current user message grants it.",
                    ));
                }
                if choice.evidence.is_empty() {
                    return Err(NativeToolFailure::new(
                        "task_contract_visual_evidence_required",
                        "A delegated visual choice requires evidence that the current user granted design discretion.",
                        "Attach a valid EvidenceRef for the delegation or leave the visual choice unspecified.",
                    ));
                }
            }
        }
    }
    if contract.ambiguity.level == AmbiguityLevel::Blocking && contract.ambiguity.missing.is_empty()
    {
        return Err(NativeToolFailure::new(
            "task_contract_invalid_ambiguity",
            "Blocking ambiguity must identify at least one missing decision.",
            "List the missing purpose, audience, content, workflow, target, or other field.",
        ));
    }
    if contract.relation.kind == TaskRelationKind::New {
        contract.relation.prior_message_id = None;
    } else if contract
        .relation
        .prior_message_id
        .as_deref()
        .is_none_or(str::is_empty)
    {
        return Err(NativeToolFailure::new(
            "task_contract_prior_message_required",
            "A continued, refined, superseded, or corrected task must identify the prior user message.",
            "Retry with relation.priorMessageId referencing an existing user message.",
        ));
    }
    Ok(())
}

fn require_explicit_value_evidence(
    label: &str,
    authority: ContractAuthority,
    evidence: &[EvidenceRef],
) -> Result<(), NativeToolFailure> {
    if authority != ContractAuthority::ExplicitUser || evidence.is_empty() {
        return Err(NativeToolFailure::new(
            "task_contract_explicit_evidence_required",
            format!("{label} requires explicit evidence from the current user message."),
            "Use production and the existing architecture unless the user explicitly requested otherwise.",
        ));
    }
    Ok(())
}

fn validate_contract_evidence(
    session: &NativeSession,
    message: &Value,
    contract: &TaskContract,
) -> Result<(), NativeToolFailure> {
    let mut refs = Vec::new();
    refs.extend(contract.constraints.maturity.evidence.iter());
    refs.extend(contract.constraints.architecture.evidence.iter());
    for target in &contract.targets {
        refs.extend(target.evidence.iter());
    }
    for choice in &contract.constraints.visual_choices {
        refs.extend(choice.evidence.iter());
    }
    for evidence in refs {
        validate_evidence_ref(message, evidence)?;
    }
    if let Some(prior_message_id) = contract.relation.prior_message_id.as_deref() {
        let current_message_id = message
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let prior_exists = session
            .snapshot
            .get("messages")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take_while(|candidate| {
                candidate.get("id").and_then(Value::as_str) != Some(current_message_id)
            })
            .any(|candidate| {
                candidate.get("id").and_then(Value::as_str) == Some(prior_message_id)
                    && candidate.get("role").and_then(Value::as_str) == Some("user")
            });
        if !prior_exists {
            return Err(NativeToolFailure::new(
                "task_contract_prior_message_not_found",
                format!(
                    "Prior user message was not found before the current message: {prior_message_id}"
                ),
                "Use the id of an earlier user message or mark the relation as new.",
            ));
        }
    }
    Ok(())
}

fn validate_evidence_ref(message: &Value, evidence: &EvidenceRef) -> Result<(), NativeToolFailure> {
    let valid = match evidence {
        EvidenceRef::UserText { quote, occurrence } => {
            let text = message
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let quote = quote.as_str();
            !quote.is_empty()
                && occurrence
                    .unwrap_or(1)
                    .checked_sub(1)
                    .and_then(|index| text.match_indices(quote).nth(index))
                    .is_some()
        }
        EvidenceRef::Citation { id } => citation_id_exists(message, id),
        EvidenceRef::Attachment { id } => attachment_id_exists(message, id),
    };
    if valid {
        Ok(())
    } else {
        Err(NativeToolFailure::new(
            "task_contract_evidence_not_found",
            "A Task Contract evidence reference does not exist in the current user message.",
            "Use an exact quote occurrence or an attachment/citation id present on the current message.",
        )
        .with_detail(json!({ "evidence": evidence })))
    }
}

fn citation_id_exists(message: &Value, id: &str) -> bool {
    !id.trim().is_empty()
        && [
            "/metadata/transcriptCitations",
            "/metadata/pageCitations",
            "/metadata/fileCitations",
        ]
        .into_iter()
        .any(|pointer| array_entry_has_id(message.pointer(pointer), id))
}

fn attachment_id_exists(message: &Value, id: &str) -> bool {
    if id.trim().is_empty() {
        return false;
    }
    [
        "/metadata/inlineImages",
        "/metadata/fileAttachments",
        "/metadata/attachments",
        "/images",
        "/attachments",
    ]
    .into_iter()
    .any(|pointer| array_entry_has_id(message.pointer(pointer), id))
        || message
            .get("blocks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|block| {
                matches!(
                    block.get("type").and_then(Value::as_str),
                    Some("image" | "file" | "attachment")
                )
            })
            .any(|block| attachment_entry_has_id(block, id))
}

fn array_entry_has_id(value: Option<&Value>, id: &str) -> bool {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .any(|entry| entry.get("id").and_then(Value::as_str) == Some(id))
}

fn attachment_entry_has_id(entry: &Value, id: &str) -> bool {
    ["id", "attachmentId", "imageId", "fileId"]
        .into_iter()
        .any(|key| entry.get(key).and_then(Value::as_str) == Some(id))
        || ["/attachment/id", "/image/id", "/file/id"]
            .into_iter()
            .any(|pointer| entry.pointer(pointer).and_then(Value::as_str) == Some(id))
}

fn turn_user_message_id(
    session: &NativeSession,
    turn_id: &str,
) -> Result<String, NativeToolFailure> {
    session
        .runtime_turns
        .iter()
        .find(|turn| turn.get("runtimeTurnId").and_then(Value::as_str) == Some(turn_id))
        .and_then(|turn| turn.get("userMessageId").and_then(Value::as_str))
        .map(str::to_string)
        .ok_or_else(|| {
            NativeToolFailure::new(
                "task_contract_turn_unbound",
                "The current runtime turn is not bound to a user message.",
                "Retry from a real user turn; synthetic continuations must inherit a Task Contract.",
            )
        })
}

fn bound_contract_for_message(
    session: &NativeSession,
    user_message_id: &str,
) -> Result<BoundTaskContract, NativeToolFailure> {
    let message = message(session, user_message_id)?;
    let value = message
        .pointer("/metadata/taskContract/contract")
        .cloned()
        .ok_or_else(task_contract_missing)?;
    let contract = serde_json::from_value(value).map_err(|error| {
        NativeToolFailure::new(
            "task_contract_invalid",
            format!("Stored Task Contract is invalid: {error}"),
            "Call lyra_task_contract_report again before any side effect.",
        )
    })?;
    Ok(BoundTaskContract {
        user_message_id: user_message_id.to_string(),
        contract,
        locked: message
            .pointer("/metadata/taskContract/locked")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn message<'a>(
    session: &'a NativeSession,
    message_id: &str,
) -> Result<&'a Value, NativeToolFailure> {
    session
        .snapshot
        .get("messages")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
        .ok_or_else(|| {
            NativeToolFailure::new(
                "task_contract_message_not_found",
                format!("User message was not found: {message_id}"),
                "Retry from the active user turn.",
            )
        })
}

fn message_mut<'a>(
    session: &'a mut NativeSession,
    message_id: &str,
) -> Result<&'a mut Value, NativeToolFailure> {
    session
        .snapshot
        .get_mut("messages")
        .and_then(Value::as_array_mut)
        .into_iter()
        .flatten()
        .find(|message| message.get("id").and_then(Value::as_str) == Some(message_id))
        .ok_or_else(|| {
            NativeToolFailure::new(
                "task_contract_message_not_found",
                format!("User message was not found: {message_id}"),
                "Retry from the active user turn.",
            )
        })
}

fn ensure_metadata_object(message: &mut Value) {
    if !message.get("metadata").is_some_and(Value::is_object) {
        message["metadata"] = json!({});
    }
}

fn task_contract_missing() -> NativeToolFailure {
    NativeToolFailure::new(
        "task_contract_missing",
        "No Task Contract is bound to the current user message.",
        "Call lyra_task_contract_report before planning or producing side effects.",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contract(maturity: &str, architecture: &str, quote: Option<&str>) -> Value {
        let evidence = quote
            .map(|quote| json!([{ "source": "user_text", "quote": quote }]))
            .unwrap_or_else(|| json!([]));
        json!({
            "action": "implement",
            "surfaces": ["code"],
            "scope": "local",
            "targets": [],
            "constraints": {
                "maturity": {
                    "value": maturity,
                    "authority": if quote.is_some() { "explicit_user" } else { "unspecified" },
                    "evidence": evidence,
                },
                "architecture": {
                    "value": architecture,
                    "authority": if quote.is_some() { "explicit_user" } else { "unspecified" },
                    "evidence": evidence,
                },
                "visualChoices": [],
                "delegatedDecisions": false,
            },
            "ambiguity": {
                "level": "none",
                "missing": [],
                "canInspectBeforeClarifying": true,
            },
            "relation": { "kind": "new" },
            "confidence": "high",
        })
    }

    fn session_with_turn(text: &str) -> (NativeSession, String, String) {
        let mut session = new_session(None, None, "normal");
        let turn_id = "turn-contract".to_string();
        let message = user_message(text.to_string(), Vec::new(), now());
        let message_id = message["id"].as_str().unwrap().to_string();
        session.snapshot["messages"] = json!([message]);
        session.runtime_turns.push(runtime_turn(
            &turn_id,
            &session.id,
            "calling_model",
            Some(message_id.clone()),
            None,
        ));
        (session, turn_id, message_id)
    }

    #[test]
    fn unspecified_constraints_normalize_to_production_standard() {
        let mut parsed: TaskContract =
            serde_json::from_value(contract("unspecified", "unspecified", None)).unwrap();
        normalize_contract(&mut parsed).unwrap();
        assert_eq!(parsed.constraints.maturity.value, Maturity::Production);
        assert_eq!(
            parsed.constraints.architecture.value,
            Architecture::Standard
        );
    }

    #[test]
    fn demo_and_single_file_require_exact_current_message_evidence() {
        let (session, _, message_id) = session_with_turn("Please build a production application.");
        let message = message(&session, &message_id).unwrap();
        let parsed: TaskContract =
            serde_json::from_value(contract("demo", "single_file", Some("Demo"))).unwrap();
        assert_eq!(
            validate_contract_evidence(&session, message, &parsed)
                .unwrap_err()
                .code,
            "task_contract_evidence_not_found"
        );
    }

    #[test]
    fn language_does_not_change_normalization() {
        for text in [
            "构建产品",
            "Build the product",
            "製品を構築する",
            "제품을 구축하세요",
            "ابنِ المنتج",
            "Construye el producto",
        ] {
            let (session, _, message_id) = session_with_turn(text);
            let message = message(&session, &message_id).unwrap();
            let mut parsed: TaskContract =
                serde_json::from_value(contract("unspecified", "unspecified", None)).unwrap();
            validate_contract_evidence(&session, message, &parsed).unwrap();
            normalize_contract(&mut parsed).unwrap();
            assert_eq!(parsed.constraints.maturity.value, Maturity::Production);
            assert_eq!(
                parsed.constraints.architecture.value,
                Architecture::Standard
            );
        }
    }

    #[test]
    fn current_message_id_cannot_impersonate_citation_or_attachment_evidence() {
        let (session, _, message_id) = session_with_turn("Build the product.");
        let message = message(&session, &message_id).unwrap();
        for source in ["citation", "attachment"] {
            let mut value = contract("unspecified", "unspecified", None);
            value["targets"] = json!([{
                "kind": "other",
                "value": "current-message-id",
                "evidence": [{ "source": source, "id": message_id.clone() }],
            }]);
            let parsed: TaskContract = serde_json::from_value(value).unwrap();
            assert_eq!(
                validate_contract_evidence(&session, message, &parsed)
                    .unwrap_err()
                    .code,
                "task_contract_evidence_not_found"
            );
        }
    }

    #[test]
    fn delegated_visual_choice_requires_delegation_evidence() {
        let mut value = contract("unspecified", "unspecified", None);
        value["constraints"]["delegatedDecisions"] = Value::Bool(true);
        value["constraints"]["visualChoices"] = json!([{
            "kind": "layout",
            "value": "Choose a production-ready layout",
            "authority": "delegated",
            "evidence": [],
        }]);
        let mut parsed: TaskContract = serde_json::from_value(value).unwrap();
        assert_eq!(
            normalize_contract(&mut parsed).unwrap_err().code,
            "task_contract_visual_evidence_required"
        );
    }

    #[test]
    fn inherited_contract_is_immutable_even_when_source_was_unlocked() {
        let parsed: TaskContract =
            serde_json::from_value(contract("unspecified", "unspecified", None)).unwrap();
        let mut target_message = json!({
            "id": "synthetic-user-message",
            "role": "user",
            "text": "",
        });
        inherit_task_contract_value(
            &parsed,
            Some("source-message"),
            Some("source-turn"),
            false,
            &mut target_message,
        )
        .unwrap();
        assert_eq!(
            target_message.pointer("/metadata/taskContract/locked"),
            Some(&Value::Bool(true))
        );
        assert_eq!(
            target_message.pointer("/metadata/taskContract/inheritedSourceLocked"),
            Some(&Value::Bool(false))
        );
        assert_eq!(
            target_message
                .pointer("/metadata/taskContract/lockEffect")
                .and_then(Value::as_str),
            Some("inherited")
        );
    }

    #[test]
    fn current_message_cannot_be_its_own_prior_message() {
        let (session, _, message_id) = session_with_turn("Continue the task.");
        let message = message(&session, &message_id).unwrap();
        let mut value = contract("unspecified", "unspecified", None);
        value["relation"] = json!({
            "kind": "continue",
            "priorMessageId": message_id,
        });
        let parsed: TaskContract = serde_json::from_value(value).unwrap();
        assert_eq!(
            validate_contract_evidence(&session, message, &parsed)
                .unwrap_err()
                .code,
            "task_contract_prior_message_not_found"
        );
    }
}
