use crate::native_backend::tools::{
    CodeGraphFragmentReport, CodeGraphSignals, extract_codegraph_signals,
};
use crate::persona::ComputedPersona;
use crate::prompt_contract::{
    PromptRuntimeContract, current_prompt_runtime_contract, prompt_runtime_contract_matches,
};
use crate::prompt_templates::{render_template, templates_fingerprint};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, env};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptDeliveryMode {
    #[default]
    Full,
    LeanExperimental,
}

impl PromptDeliveryMode {
    pub fn from_config_value(value: Option<&str>) -> Self {
        match value.unwrap_or_default().trim() {
            "lean-experimental" => Self::LeanExperimental,
            _ => Self::Full,
        }
    }

    pub fn from_env() -> Self {
        Self::from_config_value(env::var("LYRA_PROMPT_DELIVERY_MODE").ok().as_deref())
    }

    pub fn resolve(config_value: Option<&str>) -> Self {
        let env_value = env::var("LYRA_PROMPT_DELIVERY_MODE")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        env_value
            .as_deref()
            .map(|value| Self::from_config_value(Some(value)))
            .unwrap_or_else(|| Self::from_config_value(config_value))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptRefreshReason {
    FullModeDefault,
    FirstSessionFullRefresh,
    ContractMismatchFullRefresh,
    ContextTrimmedFullRefresh,
    RecentToolFailureFullRefresh,
    RecentToolMismatchFullRefresh,
    UserCorrectionFullRefresh,
    PromptHashChangedFullRefresh,
    LeanExperimental,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum PromptLayer {
    P0,
    P1,
    P2,
    P3,
    P4,
    P5,
    P6,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PromptSectionModePolicy {
    Always,
    FullOnly,
    SceneOnly,
    Dynamic,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptSectionReport {
    pub id: String,
    pub layer: PromptLayer,
    pub mode_policy: PromptSectionModePolicy,
    pub included: bool,
    pub hash: String,
    pub estimated_tokens: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptBuildReport {
    pub prompt: String,
    pub prompt_mode: PromptDeliveryMode,
    pub refresh_reason: PromptRefreshReason,
    pub contract: PromptRuntimeContract,
    pub section_hashes: BTreeMap<String, String>,
    pub sections: Vec<PromptSectionReport>,
    pub scene_modules: Vec<String>,
    pub missed_module_recovery: PromptMissedModuleRecovery,
    pub estimated_prompt_tokens: usize,
    pub estimated_saved_tokens: usize,
    pub omitted_stable_tokens: usize,
    pub prefix_cache_eligible_tokens: usize,
    pub stable_prompt_hash: String,
    /// P6 CodeGraph signal-driven fragment audit. `None` when no codegraph
    /// signals were resolved this turn (graph not ready, no symbols in
    /// message, or budget exhausted before any resolution).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codegraph_fragment_report: Option<crate::native_backend::tools::CodeGraphFragmentReport>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptMissedModuleRecovery {
    pub enabled: bool,
    pub active_triggers: Vec<String>,
    pub next_action: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PromptAccounting {
    pub system_budget: usize,
    pub tools_budget: usize,
    pub memory_budget: usize,
    pub history_budget: usize,
    pub artifact_budget: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PersonaContext {
    pub current_time: Option<String>,
    pub location_label: Option<String>,
    pub device_summary: Option<String>,
    pub user_name: Option<String>,
    /// Precise Unix epoch milliseconds — enables elapsed-time arithmetic.
    pub current_epoch_ms: Option<u64>,
    /// IANA timezone label, e.g. "Asia/Shanghai".
    pub timezone: Option<String>,
    /// Offset from UTC in minutes, e.g. +480 for UTC+8.
    pub timezone_offset_minutes: Option<i32>,
    /// Primary display pixel width.
    pub screen_width: Option<u32>,
    /// Primary display pixel height.
    pub screen_height: Option<u32>,
    /// Display density (Retina = 2.0).
    pub screen_scale_factor: Option<f64>,
    /// Number of physical displays attached.
    pub screen_display_count: Option<u32>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PromptPolicyInput {
    pub runtime_context: Value,
    pub persona: PersonaContext,
    pub active_skill_prompt: String,
    pub memory_prompt: String,
    pub accounting: PromptAccounting,
    pub delivery_mode: Option<PromptDeliveryMode>,
    pub previous_runtime_contract: Option<Value>,
    pub previous_prompt_hash: Option<String>,
    pub context_trimmed: bool,
    pub recent_tool_failure_count: usize,
    pub recent_tool_mismatch_count: usize,
    pub consecutive_tool_failure_count: usize,
    pub user_correction_detected: bool,
    /// Computed persona from local signals + OSINT — drives P0 kernel identity rendering.
    pub computed_persona: Option<ComputedPersona>,
    /// ISO8601 timestamp of first usage — injected as "U've been here N days."
    pub first_used_at: Option<String>,
}

pub fn persona_context_from_value(value: &Value) -> PersonaContext {
    let read_string = |key: &str| -> Option<String> {
        value
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    let read_u64 = |key: &str| -> Option<u64> { value.get(key).and_then(Value::as_u64) };
    let read_i32 =
        |key: &str| -> Option<i32> { value.get(key).and_then(Value::as_i64).map(|n| n as i32) };
    let screen = value.get("screen");
    PersonaContext {
        current_time: read_string("currentTime"),
        location_label: read_string("locationLabel"),
        device_summary: read_string("deviceSummary"),
        user_name: read_string("userName"),
        current_epoch_ms: read_u64("currentEpochMs"),
        timezone: read_string("timezone"),
        timezone_offset_minutes: read_i32("timezoneOffsetMinutes"),
        screen_width: screen
            .and_then(|s| s.get("width"))
            .and_then(Value::as_u64)
            .map(|n| n as u32),
        screen_height: screen
            .and_then(|s| s.get("height"))
            .and_then(Value::as_u64)
            .map(|n| n as u32),
        screen_scale_factor: screen
            .and_then(|s| s.get("scaleFactor"))
            .and_then(Value::as_f64),
        screen_display_count: screen
            .and_then(|s| s.get("displayCount"))
            .and_then(Value::as_u64)
            .map(|n| n as u32),
    }
}

pub fn build_system_prompt(input: &PromptPolicyInput) -> String {
    build_system_prompt_report(input).prompt
}

pub fn build_system_prompt_report(input: &PromptPolicyInput) -> PromptBuildReport {
    let requested_mode = input
        .delivery_mode
        .unwrap_or_else(PromptDeliveryMode::from_env);
    let contract = current_prompt_runtime_contract();
    let stable_prompt_hash = templates_fingerprint();
    let refresh_reason = prompt_refresh_reason(input, requested_mode, &stable_prompt_hash);
    let prompt_mode = if requested_mode == PromptDeliveryMode::LeanExperimental
        && refresh_reason == PromptRefreshReason::LeanExperimental
    {
        PromptDeliveryMode::LeanExperimental
    } else {
        PromptDeliveryMode::Full
    };

    let mut runtime_context = input.runtime_context.clone();
    inject_prompt_runtime_metadata(
        &mut runtime_context,
        prompt_mode,
        &refresh_reason,
        &contract,
        &stable_prompt_hash,
    );

    let candidates = render_prompt_sections(input, &runtime_context);
    // P6: extract CodeGraph signals (if any) for the fragment audit report.
    // The signals themselves are rendered by render_prompt_sections from
    // runtime_context["codegraphSignals"]; here we build the observability
    // report persisted into the session snapshot.
    let codegraph_fragment_report =
        extract_codegraph_fragment_report(&runtime_context, input.accounting.system_budget);
    let full_tokens = estimate_prompt_tokens(&join_sections(
        candidates
            .iter()
            .filter(|section| section.include_full)
            .map(|section| section.text.as_str()),
    ));
    let included_prompt = join_sections(candidates.iter().filter_map(|section| {
        section
            .included_in(prompt_mode)
            .then_some(section.text.as_str())
    }));
    let estimated_prompt_tokens = estimate_prompt_tokens(&included_prompt);
    let estimated_saved_tokens = if prompt_mode == PromptDeliveryMode::LeanExperimental {
        full_tokens.saturating_sub(estimated_prompt_tokens)
    } else {
        0
    };
    let omitted_stable_tokens = if prompt_mode == PromptDeliveryMode::LeanExperimental {
        candidates
            .iter()
            .filter(|section| {
                section.stable && section.include_full && !section.included_in(prompt_mode)
            })
            .map(|section| estimate_prompt_tokens(&section.text))
            .sum()
    } else {
        0
    };
    let prefix_cache_eligible_tokens = candidates
        .iter()
        .take_while(|section| section.stable && section.included_in(prompt_mode))
        .map(|section| estimate_prompt_tokens(&section.text))
        .sum();
    let scene_modules = candidates
        .iter()
        .filter(|section| section.included_in(prompt_mode))
        .filter_map(|section| section.scene_module.map(str::to_string))
        .collect::<Vec<_>>();
    let missed_module_recovery =
        missed_module_recovery_report(input, prompt_mode, &refresh_reason, &scene_modules);
    let mut section_hashes = BTreeMap::new();
    let sections = candidates
        .into_iter()
        .map(|section| {
            let hash = hash_text(&section.text);
            section_hashes.insert(section.id.to_string(), hash.clone());
            PromptSectionReport {
                id: section.id.to_string(),
                layer: section.layer,
                mode_policy: section.mode_policy,
                included: section.included_in(prompt_mode),
                hash,
                estimated_tokens: estimate_prompt_tokens(&section.text),
            }
        })
        .collect::<Vec<_>>();

    PromptBuildReport {
        prompt: included_prompt,
        prompt_mode,
        refresh_reason,
        contract,
        section_hashes,
        sections,
        scene_modules,
        missed_module_recovery,
        estimated_prompt_tokens,
        estimated_saved_tokens,
        omitted_stable_tokens,
        prefix_cache_eligible_tokens,
        stable_prompt_hash,
        codegraph_fragment_report,
    }
}

fn prompt_refresh_reason(
    input: &PromptPolicyInput,
    requested_mode: PromptDeliveryMode,
    stable_prompt_hash: &str,
) -> PromptRefreshReason {
    if requested_mode == PromptDeliveryMode::Full {
        return PromptRefreshReason::FullModeDefault;
    }
    let previous_contract = input
        .previous_runtime_contract
        .as_ref()
        .filter(|value| !value.is_null());
    if previous_contract.is_none() {
        return PromptRefreshReason::FirstSessionFullRefresh;
    }
    if !prompt_runtime_contract_matches(previous_contract) {
        return PromptRefreshReason::ContractMismatchFullRefresh;
    }
    if input.context_trimmed {
        return PromptRefreshReason::ContextTrimmedFullRefresh;
    }
    if input.recent_tool_failure_count > 0 {
        return PromptRefreshReason::RecentToolFailureFullRefresh;
    }
    if input.recent_tool_mismatch_count > 0 {
        return PromptRefreshReason::RecentToolMismatchFullRefresh;
    }
    if input.user_correction_detected {
        return PromptRefreshReason::UserCorrectionFullRefresh;
    }
    if input
        .previous_prompt_hash
        .as_deref()
        .is_none_or(|previous| previous != stable_prompt_hash)
    {
        return PromptRefreshReason::PromptHashChangedFullRefresh;
    }
    PromptRefreshReason::LeanExperimental
}

fn inject_prompt_runtime_metadata(
    runtime_context: &mut Value,
    prompt_mode: PromptDeliveryMode,
    refresh_reason: &PromptRefreshReason,
    contract: &PromptRuntimeContract,
    stable_prompt_hash: &str,
) {
    runtime_context["promptDelivery"] = json!({
        "promptMode": prompt_mode,
        "refreshReason": refresh_reason,
        "stablePromptHash": stable_prompt_hash,
        "statefulProviderInheritance": false,
    });
    runtime_context["promptRuntimeContract"] =
        serde_json::to_value(contract).unwrap_or_else(|_| json!({}));
}

#[derive(Clone, Debug)]
struct PromptSectionCandidate {
    id: &'static str,
    layer: PromptLayer,
    mode_policy: PromptSectionModePolicy,
    include_full: bool,
    include_lean: bool,
    stable: bool,
    scene_module: Option<&'static str>,
    text: String,
}

impl PromptSectionCandidate {
    fn included_in(&self, mode: PromptDeliveryMode) -> bool {
        match mode {
            PromptDeliveryMode::Full => self.include_full,
            PromptDeliveryMode::LeanExperimental => self.include_lean,
        }
    }
}

/// Build a first-person spatiotemporal awareness brief for the kernel (P0).
///
/// Composes a natural-language paragraph that anchors the agent in a concrete
/// time-space coordinate: wall-clock time + timezone, session duration + turn
/// count, screen geometry, and workspace layout (active app/tab, pane count).
/// Degrades gracefully — if a datum is missing the corresponding clause is
/// omitted, and if ALL data is missing the function returns `None`.
fn build_spatiotemporal_brief(persona: &PersonaContext, runtime_context: &Value) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();

    // ── Time ──
    if let Some(ref t) = persona.current_time {
        let mut clause = format!("It is {t}");
        if let Some(ref tz) = persona.timezone {
            clause.push_str(&format!(" ({tz}"));
            if let Some(offset) = persona.timezone_offset_minutes {
                let sign = if offset >= 0 { "+" } else { "-" };
                let hours = (offset.abs() / 60).abs();
                let mins = (offset.abs() % 60).abs();
                clause.push_str(&format!(", UTC{sign}{hours:02}:{mins:02}"));
            }
            clause.push(')');
        }
        clause.push('.');
        parts.push(clause);
    }

    // ── Session temporal ──
    if let Some(st) = runtime_context
        .get("spatiotemporal")
        .and_then(|s| s.get("session"))
    {
        let mut session_parts: Vec<String> = Vec::new();
        if let Some(age) = st.get("ageSeconds").and_then(Value::as_u64) {
            let mins = age / 60;
            let secs = age % 60;
            if mins > 0 {
                session_parts.push(format!("{mins} min {secs} sec"));
            } else {
                session_parts.push(format!("{secs} sec"));
            }
        }
        if let Some(turns) = st.get("turnCount").and_then(Value::as_u64) {
            session_parts.push(format!("{turns} turn{}", if turns == 1 { "" } else { "s" }));
        }
        if !session_parts.is_empty() {
            parts.push(format!(
                "This session has been going for {}",
                session_parts.join(", ")
            ));
        }
        if let Some(idle) = st
            .get("secondsSinceLastInteraction")
            .and_then(Value::as_u64)
        {
            if idle > 0 {
                parts.push(format!("{idle} sec since the last message."));
            }
        }
    }

    // ── Screen / device ──
    let mut screen_clause = String::new();
    if let (Some(w), Some(h)) = (persona.screen_width, persona.screen_height) {
        screen_clause.push_str(&format!("Screen is {w}×{h} px"));
        if let Some(sf) = persona.screen_scale_factor {
            if sf > 1.0 {
                screen_clause.push_str(&format!(" @{sf}x"));
            }
        }
        if let Some(count) = persona.screen_display_count {
            if count > 1 {
                screen_clause.push_str(&format!(" ({count} monitors)"));
            }
        }
        screen_clause.push('.');
        parts.push(screen_clause);
    }

    // ── Workspace spatial ──
    if let Some(ws) = runtime_context
        .get("spatiotemporal")
        .and_then(|s| s.get("workspace"))
    {
        let mut ws_parts: Vec<String> = Vec::new();
        if let Some(app) = ws.get("foregroundApp").and_then(Value::as_str) {
            ws_parts.push(format!("you are in {app}"));
        }
        if let Some(win) = ws.get("focusedWindow").and_then(Value::as_str) {
            ws_parts.push(format!("looking at \"{win}\""));
        }
        if let Some(title) = ws.get("activeTabTitle").and_then(Value::as_str) {
            ws_parts.push(format!("active tab \"{title}\""));
        }
        if let Some(addr) = ws.get("activeTabAddress").and_then(Value::as_str) {
            ws_parts.push(format!("at {addr}"));
        }
        if let Some(panes) = ws.get("paneCount").and_then(Value::as_u64) {
            if panes > 1 {
                ws_parts.push(format!("{panes} panes"));
            }
        }
        if let Some(mode) = ws.get("layoutMode").and_then(Value::as_str) {
            if mode == "split" {
                ws_parts.push("split view".to_string());
            }
        }
        if !ws_parts.is_empty() {
            parts.push(format!("Workspace: {}.", ws_parts.join("; ")));
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

fn render_prompt_sections(
    input: &PromptPolicyInput,
    runtime_context: &Value,
) -> Vec<PromptSectionCandidate> {
    let active_skill_prompt = input.active_skill_prompt.trim();
    let memory_prompt = input.memory_prompt.trim();
    let scenes = select_scene_modules(input, runtime_context, active_skill_prompt);

    let spatiotemporal_brief = build_spatiotemporal_brief(&input.persona, runtime_context);

    let mut sections = vec![];

    // P0: kernel — identity + spatiotemporal + safety rules, single template.
    let persona_identity = input.computed_persona.as_ref().filter(|p| p.has_identity());
    let identity_platforms: Vec<Value> = persona_identity
        .map(|p| {
            p.identity_platforms
                .iter()
                .map(|plat| {
                    json!({
                        "site": plat.site,
                        "username": plat.username,
                        "profile_name": plat.profile_name,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    // Phase 2: location — real data only, no fake fallback.
    // ponytail: 假位置比没位置更糟。升级路径：用户手动设置 / OSINT / IP geo。
    let identity_location = input.persona.location_label.as_deref().map(String::from);

    // Phase 3: first_used_brief — "U've been here N days."
    let first_used_brief = input.first_used_at.as_deref().and_then(|ts| {
        let parsed = chrono::DateTime::parse_from_rfc3339(ts).ok()?;
        let now_ms = chrono::Utc::now().timestamp_millis();
        let then_ms = parsed.timestamp_millis();
        let days = ((now_ms - then_ms).max(0) / 86_400_000) as u64;
        if days == 0 {
            Some("U just got here.".to_string())
        } else if days == 1 {
            Some("U've been here 1 day.".to_string())
        } else {
            Some(format!("U've been here {} days.", days))
        }
    });

    // Phase 6: identity_age — no fake fallback.
    // ponytail: infer_age 假设用户创建 home 时 16 岁，太不可靠。不输出假年龄。
    // 升级路径：OSINT bio 正则提取生日 / 用户手动设置。
    let identity_age = persona_identity.and_then(|p| p.inferred_age);

    sections.push(PromptSectionCandidate {
        id: "P0.kernel",
        layer: PromptLayer::P0,
        mode_policy: PromptSectionModePolicy::Always,
        include_full: true,
        include_lean: true,
        stable: true,
        scene_module: None,
        text: render_prompt_template(
            "kernel.md.j2",
            json!({
                "current_time": input.persona.current_time.as_deref(),
                "location_label": input.persona.location_label.as_deref(),
                "device_summary": input.persona.device_summary.as_deref(),
                "user_name": input.persona.user_name.as_deref(),
                "spatiotemporal_brief": spatiotemporal_brief.as_deref(),
                "identity_name": persona_identity.map(|p| p.identity_name.as_str()),
                "identity_age": identity_age,
                "identity_location": identity_location,
                "identity_emails": persona_identity
                    .map(|p| p.identity_emails.iter().map(String::as_str).collect::<Vec<_>>())
                    .unwrap_or_default(),
                "identity_usernames": persona_identity
                    .map(|p| p.identity_usernames.iter().map(String::as_str).collect::<Vec<_>>())
                    .unwrap_or_default(),
                "identity_bio": persona_identity.and_then(|p| p.identity_bio.as_deref()),
                "identity_platforms": identity_platforms,
                "first_used_brief": first_used_brief,
            }),
        ),
    });
    sections.push(PromptSectionCandidate {
        id: "P1.interactionContract",
        layer: PromptLayer::P1,
        mode_policy: PromptSectionModePolicy::Always,
        include_full: true,
        include_lean: true,
        stable: true,
        scene_module: None,
        text: render_prompt_template("interaction_contract.md.j2", json!({})),
    });
    sections.push(PromptSectionCandidate {
        id: "P1.compactContract",
        layer: PromptLayer::P1,
        mode_policy: PromptSectionModePolicy::Always,
        include_full: true,
        include_lean: true,
        stable: true,
        scene_module: None,
        text: render_prompt_template("compact_contract.md.j2", json!({})),
    });
    sections.push(PromptSectionCandidate {
        id: "P2.fullContract",
        layer: PromptLayer::P2,
        mode_policy: PromptSectionModePolicy::FullOnly,
        include_full: true,
        include_lean: false,
        stable: true,
        scene_module: None,
        text: render_prompt_template("full_contract.md.j2", json!({})),
    });
    sections.push(PromptSectionCandidate {
        id: "P2.planMode",
        layer: PromptLayer::P2,
        mode_policy: PromptSectionModePolicy::Always,
        include_full: true,
        include_lean: true,
        stable: true,
        scene_module: None,
        text: render_prompt_template("plan_mode.md.j2", json!({})),
    });
    sections.push(PromptSectionCandidate {
        id: "P3.browserScene",
        layer: PromptLayer::P3,
        mode_policy: PromptSectionModePolicy::SceneOnly,
        include_full: true,
        include_lean: scenes.browser,
        stable: true,
        scene_module: Some("browser"),
        text: render_prompt_template("browser_scene.md.j2", json!({})),
    });
    sections.push(PromptSectionCandidate {
        id: "P3.computerScene",
        layer: PromptLayer::P3,
        mode_policy: PromptSectionModePolicy::SceneOnly,
        include_full: true,
        include_lean: scenes.computer,
        stable: true,
        scene_module: Some("computer"),
        text: render_prompt_template("computer_scene.md.j2", json!({})),
    });
    sections.push(PromptSectionCandidate {
        id: "P3.designScene",
        layer: PromptLayer::P3,
        mode_policy: PromptSectionModePolicy::SceneOnly,
        include_full: true,
        include_lean: scenes.design,
        stable: true,
        scene_module: Some("design"),
        text: render_prompt_template("design_scene.md.j2", json!({})),
    });
    if scenes.citation {
        sections.push(PromptSectionCandidate {
            id: "P3.citationScene",
            layer: PromptLayer::P3,
            mode_policy: PromptSectionModePolicy::SceneOnly,
            include_full: true,
            include_lean: true,
            stable: true,
            scene_module: Some("citation"),
            text: render_prompt_template("citation_scene.md.j2", json!({})),
        });
    }
    if scenes.image {
        sections.push(PromptSectionCandidate {
            id: "P3.imageScene",
            layer: PromptLayer::P3,
            mode_policy: PromptSectionModePolicy::SceneOnly,
            include_full: true,
            include_lean: true,
            stable: true,
            scene_module: Some("image"),
            text: render_prompt_template("image_scene.md.j2", json!({})),
        });
    }
    if !active_skill_prompt.is_empty() {
        sections.push(PromptSectionCandidate {
            id: "P4.activeSkill",
            layer: PromptLayer::P4,
            mode_policy: PromptSectionModePolicy::Dynamic,
            include_full: true,
            include_lean: true,
            stable: false,
            scene_module: None,
            text: render_prompt_template(
                "active_skill.md.j2",
                json!({ "active_skill_prompt": active_skill_prompt }),
            ),
        });
    }
    if !memory_prompt.is_empty() {
        sections.push(PromptSectionCandidate {
            id: "P4.memoryContext",
            layer: PromptLayer::P4,
            mode_policy: PromptSectionModePolicy::Dynamic,
            include_full: true,
            include_lean: true,
            stable: false,
            scene_module: None,
            text: render_prompt_template(
                "memory_context.md.j2",
                json!({ "memory_prompt": memory_prompt }),
            ),
        });
    }
    sections.push(PromptSectionCandidate {
        id: "P4.runtimeContext",
        layer: PromptLayer::P4,
        mode_policy: PromptSectionModePolicy::Dynamic,
        include_full: true,
        include_lean: true,
        stable: false,
        scene_module: None,
        text: render_prompt_template(
            "dynamic_context.md.j2",
            json!({
                "runtime_context_json": serde_json::to_string_pretty(runtime_context)
                    .unwrap_or_else(|_| "{}".to_string())
            }),
        ),
    });
    sections.push(PromptSectionCandidate {
        id: "P5.promptAccounting",
        layer: PromptLayer::P5,
        mode_policy: PromptSectionModePolicy::Always,
        include_full: true,
        include_lean: true,
        stable: false,
        scene_module: None,
        text: render_prompt_template(
            "prompt_accounting.md.j2",
            json!({
                "system_budget": input.accounting.system_budget,
                "tools_budget": input.accounting.tools_budget,
                "memory_budget": input.accounting.memory_budget,
                "history_budget": input.accounting.history_budget,
                "artifact_budget": input.accounting.artifact_budget,
            }),
        ),
    });
    // P6: CodeGraph signal-driven fragments (dynamic, budget-gated).
    // Signals are pre-computed by turns.rs and injected into
    // runtime_context["codegraphSignals"]; we only render here — no IO.
    if let Some(signals) = extract_codegraph_signals(runtime_context) {
        let text = render_prompt_template(
            "codegraph_fragments.md.j2",
            json!({
                "codegraph_signals": signals
            }),
        );
        if !text.trim().is_empty() {
            sections.push(PromptSectionCandidate {
                id: "P6.codegraphFragments",
                layer: PromptLayer::P6,
                mode_policy: PromptSectionModePolicy::Dynamic,
                include_full: true,
                include_lean: true,
                stable: false,
                scene_module: None,
                text,
            });
        }
    }
    sections
}

fn render_prompt_template(name: &str, context: Value) -> String {
    render_template(name, context)
        .unwrap_or_else(|error| panic!("failed to render prompt template {name}: {error}"))
}

/// Build the P6 CodeGraph fragment audit report from runtime_context signals.
/// Returns `None` when no signals were resolved (P6 section skipped).
fn extract_codegraph_fragment_report(
    runtime_context: &Value,
    _system_budget: usize,
) -> Option<CodeGraphFragmentReport> {
    let signals: CodeGraphSignals =
        serde_json::from_value(runtime_context.get("codegraphSignals")?.clone()).ok()?;
    if !signals.has_content() {
        return None;
    }
    let intent_queries_executed = signals
        .queries_executed
        .iter()
        .filter(|q| !q.tool.is_empty())
        .count();
    let estimated_tokens = signals.estimated_fragment_tokens();
    let dropped_symbols: Vec<String> = signals
        .mentioned_symbols
        .iter()
        .filter(|s| {
            !signals
                .resolved_neighborhoods
                .iter()
                .any(|nb| &nb.name == *s)
        })
        .cloned()
        .collect();
    let impact_attached = signals.impact_analysis.is_some();
    let tests_attached = !signals.related_tests.is_empty();
    let circular_deps_attached = !signals.circular_deps.is_empty();
    let dead_imports_attached = !signals.dead_imports.is_empty();
    let hot_paths_attached = !signals.hot_paths.is_empty();
    let pattern_matches_attached = !signals.pattern_matches.is_empty();
    let file_symbols_attached = !signals.file_symbols.is_empty();
    let memory_hits_attached = !signals.memory_hits.is_empty();
    Some(CodeGraphFragmentReport {
        signals_attached: true,
        symbols_resolved: signals.resolved_neighborhoods.len(),
        queries_executed: signals.queries_executed,
        cache_hits: signals.cache_hits,
        cache_misses: signals.cache_misses,
        estimated_tokens,
        budget_tokens: crate::native_backend::tools::CODEGRAPH_FRAGMENT_BUDGET_TOKENS,
        dropped_symbols,
        intent: signals.intent.clone(),
        intent_queries_executed,
        impact_attached,
        tests_attached,
        circular_deps_attached,
        dead_imports_attached,
        hot_paths_attached,
        pattern_matches_attached,
        file_symbols_attached,
        memory_hits_attached,
    })
}

#[derive(Clone, Debug, Default)]
struct SelectedSceneModules {
    browser: bool,
    computer: bool,
    design: bool,
    citation: bool,
    image: bool,
}

fn select_scene_modules(
    _input: &PromptPolicyInput,
    runtime_context: &Value,
    _active_skill_prompt: &str,
) -> SelectedSceneModules {
    let surfaces = runtime_context
        .pointer("/taskContract/contract/surfaces")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>();
    SelectedSceneModules {
        browser: scene_matches(runtime_context, &["browser", "web", "workbench"])
            || recovery_signal_matches(runtime_context, &["browser", "browser_ax", "web"])
            || surfaces
                .iter()
                .any(|surface| matches!(*surface, "browser" | "web")),
        computer: scene_matches(runtime_context, &["computer", "desktop", "software", "app"])
            || recovery_signal_matches(
                runtime_context,
                &[
                    "computer",
                    "desktop",
                    "software",
                    "app",
                    "workbench",
                    "terminal",
                    "shell",
                ],
            )
            || surfaces.iter().any(|surface| {
                matches!(*surface, "desktop" | "terminal" | "browser")
            }),
        design: recovery_signal_matches(runtime_context, &["design"])
            || surfaces
                .iter()
                .any(|surface| matches!(*surface, "ui" | "ux" | "web")),
        citation: runtime_context
            .pointer("/inputSignals/hasCitation")
            .and_then(Value::as_bool)
            == Some(true),
        image: runtime_context
            .pointer("/inputSignals/hasImage")
            .and_then(Value::as_bool)
            == Some(true)
            || surfaces.iter().any(|surface| *surface == "image"),
    }
}

fn missed_module_recovery_report(
    input: &PromptPolicyInput,
    prompt_mode: PromptDeliveryMode,
    refresh_reason: &PromptRefreshReason,
    scene_modules: &[String],
) -> PromptMissedModuleRecovery {
    let mut active_triggers = Vec::new();
    if input.context_trimmed {
        active_triggers.push("contextTrimmed".to_string());
    }
    if input.recent_tool_failure_count > 0 {
        active_triggers.push("recentToolFailure".to_string());
    }
    if input.consecutive_tool_failure_count > 1 {
        active_triggers.push("consecutiveToolFailure".to_string());
    }
    if input.recent_tool_mismatch_count > 0 {
        active_triggers.push("recentToolMismatch".to_string());
    }
    if input.user_correction_detected {
        active_triggers.push("userCorrection".to_string());
    }
    if prompt_recovery_signal_array(runtime_context_from_input(input), "recentSceneModules")
        .is_some_and(|items| !items.is_empty())
    {
        active_triggers.push("recentSceneModule".to_string());
    }
    if prompt_recovery_signal_array(runtime_context_from_input(input), "recentFailedToolDomains")
        .is_some_and(|items| !items.is_empty())
    {
        active_triggers.push("recentFailedToolDomain".to_string());
    }
    if matches!(
        refresh_reason,
        PromptRefreshReason::ContractMismatchFullRefresh
            | PromptRefreshReason::PromptHashChangedFullRefresh
            | PromptRefreshReason::FirstSessionFullRefresh
            | PromptRefreshReason::RecentToolFailureFullRefresh
            | PromptRefreshReason::RecentToolMismatchFullRefresh
            | PromptRefreshReason::UserCorrectionFullRefresh
    ) {
        active_triggers.push("fullRefresh".to_string());
    }
    let enabled = prompt_mode == PromptDeliveryMode::LeanExperimental;
    let next_action = if enabled && active_triggers.is_empty() {
        "Monitor tool search misses, failed concrete tools, and member corrections; inject broader scene modules or force full refresh on the next turn if drift appears."
    } else if enabled {
        "Lean mode is active with recovery signals present; keep selected scene modules conservative and force full refresh on repeated failure."
    } else if scene_modules.is_empty() {
        "Full prompt mode is active; no lean scene recovery is required."
    } else {
        "Full prompt mode is active; selected scene modules are available as the next lean baseline."
    };
    PromptMissedModuleRecovery {
        enabled,
        active_triggers,
        next_action: next_action.to_string(),
    }
}

fn scene_matches(runtime_context: &Value, needles: &[&str]) -> bool {
    let scene = runtime_context
        .get("toolFilesystem")
        .and_then(|tool_fs| tool_fs.get("scene"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    needles.iter().any(|needle| scene == *needle)
}

fn recovery_signal_matches(runtime_context: &Value, needles: &[&str]) -> bool {
    [
        "recentSceneModules",
        "recentFailedSceneModules",
        "recentToolDomains",
        "recentFailedToolDomains",
        "consecutiveFailedToolDomains",
        "recentToolPaths",
    ]
    .into_iter()
    .filter_map(|key| prompt_recovery_signal_array(runtime_context, key))
    .flatten()
    .any(|value| {
        let value = value.to_ascii_lowercase();
        needles.iter().any(|needle| value == *needle)
    })
}

fn prompt_recovery_signal_array(runtime_context: &Value, key: &str) -> Option<Vec<String>> {
    runtime_context
        .get("promptRecoverySignals")
        .and_then(|signals| signals.get(key))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
}

fn runtime_context_from_input(input: &PromptPolicyInput) -> &Value {
    &input.runtime_context
}

fn join_sections<'a>(sections: impl Iterator<Item = &'a str>) -> String {
    sections
        .map(str::trim)
        .filter(|section| !section.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn estimate_prompt_tokens(prompt: &str) -> usize {
    if prompt.trim().is_empty() {
        return 0;
    }
    prompt.chars().count().div_ceil(4).max(1)
}

fn hash_text(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn full_persona() -> PersonaContext {
        PersonaContext {
            current_time: Some("Wednesday, June 17, 2026, 2:45 PM GMT+8".to_string()),
            location_label: Some("Shanghai, China".to_string()),
            device_summary: Some("macOS arm64 · PetedeMacBook-Air · 0.1.0".to_string()),
            user_name: Some("petehsu".to_string()),
            ..PersonaContext::default()
        }
    }

    #[test]
    fn prompt_policy_source_keeps_prompt_text_in_templates() {
        let source = include_str!("prompt_policy.rs");
        let legacy_helpers = [
            ["persona_context", "_section"].concat(),
            ["communication_style", "_section"].concat(),
            ["hard_identity_rules", "_section"].concat(),
            ["transcript_citation", "_section"].concat(),
            ["page_citation", "_section"].concat(),
            ["inline_image", "_section"].concat(),
            ["tool_strategy", "_section"].concat(),
            ["scenario_playbooks", "_section"].concat(),
            ["sensitive_values", "_section"].concat(),
            ["network_awareness", "_section"].concat(),
            ["verification", "_section"].concat(),
            ["computer_use", "_section"].concat(),
        ];
        for helper in legacy_helpers {
            assert!(
                !source.contains(&format!("pub fn {helper}")),
                "legacy raw prompt helper {helper} should live in src/prompts/*.md.j2, not prompt_policy.rs"
            );
        }
    }

    #[test]
    fn prompt_policy_contains_persona_tool_strategy_and_verification() {
        let report = build_system_prompt_report(&PromptPolicyInput {
            runtime_context: json!({ "identity": "agent" }),
            persona: full_persona(),
            accounting: PromptAccounting {
                system_budget: 100,
                tools_budget: 20,
                memory_budget: 10,
                history_budget: 50,
                artifact_budget: 10,
            },
            ..PromptPolicyInput::default()
        });
        let prompt = report.prompt;
        assert_eq!(report.prompt_mode, PromptDeliveryMode::Full);
        assert_eq!(report.refresh_reason, PromptRefreshReason::FullModeDefault);
        assert!(report.estimated_prompt_tokens > 0);
        assert_eq!(report.estimated_saved_tokens, 0);
        assert_eq!(report.omitted_stable_tokens, 0);
        assert!(report.prefix_cache_eligible_tokens > 0);
        assert!(report.scene_modules.contains(&"browser".to_string()));
        assert!(report.scene_modules.contains(&"computer".to_string()));
        assert!(report.scene_modules.contains(&"design".to_string()));
        assert!(!report.missed_module_recovery.enabled);
        assert!(report.section_hashes.contains_key("P0.kernel"));
        assert!(report.section_hashes.contains_key("P1.interactionContract"));
        assert!(report.section_hashes.contains_key("P1.compactContract"));
        assert!(report.section_hashes.contains_key("P2.fullContract"));
        assert!(prompt.contains("It is Wednesday, June 17, 2026, 2:45 PM GMT+8"));
        assert!(prompt.contains("Blocking input only comes thru structured interaction"));
        assert!(prompt.contains("Plain text questions r final/non-blocking"));
        assert!(prompt.contains("lyra_clarification_ask shows panel"));
        assert!(prompt.contains("Vague build requests"));
        assert!(prompt.contains("This is ur computer"));
        assert!(prompt.contains("One-shot cmd/test/build/listing -> shell"));
        assert!(prompt.contains("Talk direct, grounded, technical, accountable"));
        assert!(prompt.contains("lyra-sensitive-value-ref"));
        assert!(prompt.contains("opaque refs owned by u"));
        assert!(prompt.contains("Don't claim done w/o evidence"));
        // ponytail: SOP reinforcement assertions — prove the new disciplines are in the prompt
        assert!(prompt.contains("Test alongside code"));
        assert!(prompt.contains("self-critique"));
        assert!(prompt.contains("Don't introduce regressions"));
        assert!(prompt.contains("Conventional Commits"));
        // ponytail: internet/reference awareness assertions
        assert!(prompt.contains("Search/fetch empty -> search through the browser"));
        assert!(prompt.contains("don't write blind from memory"));
        assert!(prompt.contains("Keep relevant references open while working"));
        assert!(prompt.contains("search current examples and docs"));
        // ponytail: deep-fusion assertions
        assert!(prompt.contains("climb the ladder"));
        assert!(prompt.contains("YAGNI"));
        assert!(prompt.contains("No unrequested abstractions"));
        assert!(prompt.contains("Shortest working diff"));
        assert!(prompt.contains("ponytail:"));
        assert!(prompt.contains("Major UI work"));
        assert!(prompt.contains("/tools/design/quality"));
        assert!(prompt.contains("fixed, retained, or ignored"));
        assert!(prompt.contains("Static source/DOM reports never prove visual completion"));
        assert!(prompt.contains("\"promptDelivery\""));
        assert!(prompt.contains("\"promptRuntimeContract\""));
        assert!(!prompt.contains("Tool-FS scenario playbooks"));
        assert!(!prompt.contains("/tools/web/map"));
        assert!(!prompt.contains("/tools/filesystem/read_file"));
        assert!(!prompt.contains("/tools/browser/navigate"));
        let legacy_name = ["jc", "ode"].join("");
        assert!(!prompt.to_lowercase().contains(&legacy_name));
        for direct_tool_name in [
            "file_read",
            "shell_run",
            "artifact_read",
            "workbench_read_tab",
            "lyra_lumen",
            "software_invoke_capability",
        ] {
            assert!(
                !contains_standalone_tool_name(&prompt, direct_tool_name),
                "{direct_tool_name} leaked into prompt"
            );
        }
    }

    #[test]
    fn persona_context_omits_missing_fields() {
        let prompt = build_system_prompt(&PromptPolicyInput {
            runtime_context: json!({}),
            persona: PersonaContext::default(),
            ..PromptPolicyInput::default()
        });
        assert!(!prompt.contains("It is "));
        assert!(!prompt.contains("U operate in"));
        assert!(!prompt.contains("Company gave U this device"));
        assert!(!prompt.contains("nickname only"));
        assert!(prompt.contains("This is ur computer"));
        // ponytail: compact SOP one-liners present even w/o persona
        assert!(prompt.contains("Self-critique before done"));
        assert!(prompt.contains("Don't regress"));
        assert!(prompt.contains("Conventional Commits"));
        // ponytail: compact internet awareness one-liners
        assert!(prompt.contains("browser search directly"));
        assert!(prompt.contains("check the real product/repo and current references first"));
        assert!(prompt.contains("One-shot cmd/test/build/listing -> shell"));
        // ponytail: compact deep-fusion one-liners
        assert!(prompt.contains("Code first, then"));
        assert!(prompt.contains("No unrequested abstractions"));
        assert!(prompt.contains("Major UI work"));
        assert!(prompt.contains("/tools/design/quality"));
        assert!(prompt.contains("actual render"));
    }

    #[test]
    fn persona_context_from_value_reads_optional_fields() {
        let persona = persona_context_from_value(&json!({
            "currentTime": "Monday",
            "locationLabel": "  ",
            "deviceSummary": "macOS",
            "userName": "alex"
        }));
        assert_eq!(persona.current_time.as_deref(), Some("Monday"));
        assert_eq!(persona.location_label, None);
        assert_eq!(persona.device_summary.as_deref(), Some("macOS"));
        assert_eq!(persona.user_name.as_deref(), Some("alex"));
    }

    fn contains_standalone_tool_name(prompt: &str, tool_name: &str) -> bool {
        prompt.match_indices(tool_name).any(|(index, _)| {
            let before = prompt[..index].chars().next_back();
            let after = prompt[index + tool_name.len()..].chars().next();
            !is_tool_path_or_identifier_char(before) && !is_tool_path_or_identifier_char(after)
        })
    }

    fn is_tool_path_or_identifier_char(value: Option<char>) -> bool {
        value.is_some_and(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-' | '/'))
    }

    #[test]
    fn lean_prompt_is_experimental_and_uses_contract_state() {
        let previous_contract =
            serde_json::to_value(crate::prompt_contract::current_prompt_runtime_contract())
                .expect("contract json");
        let report = build_system_prompt_report(&PromptPolicyInput {
            runtime_context: json!({
                "toolFilesystem": {
                    "scene": "general"
                }
            }),
            delivery_mode: Some(PromptDeliveryMode::LeanExperimental),
            previous_runtime_contract: Some(previous_contract),
            previous_prompt_hash: Some(crate::prompt_templates::templates_fingerprint()),
            accounting: PromptAccounting {
                system_budget: 100,
                tools_budget: 20,
                memory_budget: 10,
                history_budget: 50,
                artifact_budget: 10,
            },
            ..PromptPolicyInput::default()
        });
        assert_eq!(report.prompt_mode, PromptDeliveryMode::LeanExperimental);
        assert_eq!(report.refresh_reason, PromptRefreshReason::LeanExperimental);
        assert!(report.estimated_saved_tokens > 0);
        assert!(report.omitted_stable_tokens > 0);
        assert!(report.prefix_cache_eligible_tokens > 0);
        assert!(report.missed_module_recovery.enabled);
        assert!(report.scene_modules.is_empty());
        assert!(report.prompt.contains("This is ur computer"));
        assert!(report.prompt.contains("Blocking input only comes thru"));
        assert!(report.prompt.contains("lyra_clarification_ask"));
        assert!(report.prompt.contains("Current runtime context"));
        assert!(report.prompt.contains("Prompt accounting"));
        assert!(
            !report
                .prompt
                .contains("Talk direct, grounded, technical, accountable")
        );
        assert!(!report.prompt.contains("Browser scene module"));
        assert!(
            report
                .sections
                .iter()
                .any(|section| section.id == "P2.fullContract" && !section.included)
        );
    }

    #[test]
    fn lean_prompt_forces_full_refresh_when_contract_mismatches() {
        let report = build_system_prompt_report(&PromptPolicyInput {
            runtime_context: json!({}),
            delivery_mode: Some(PromptDeliveryMode::LeanExperimental),
            previous_runtime_contract: Some(json!({
                "promptPolicyVersion": 0
            })),
            previous_prompt_hash: Some(crate::prompt_templates::templates_fingerprint()),
            ..PromptPolicyInput::default()
        });
        assert_eq!(report.prompt_mode, PromptDeliveryMode::Full);
        assert_eq!(
            report.refresh_reason,
            PromptRefreshReason::ContractMismatchFullRefresh
        );
        assert!(
            report
                .prompt
                .contains("Talk direct, grounded, technical, accountable")
        );
    }

    #[test]
    fn lean_prompt_forces_full_refresh_on_recovery_signals() {
        let previous_contract =
            serde_json::to_value(crate::prompt_contract::current_prompt_runtime_contract())
                .expect("contract json");
        let base = PromptPolicyInput {
            runtime_context: json!({}),
            delivery_mode: Some(PromptDeliveryMode::LeanExperimental),
            previous_runtime_contract: Some(previous_contract.clone()),
            previous_prompt_hash: Some(crate::prompt_templates::templates_fingerprint()),
            ..PromptPolicyInput::default()
        };

        let tool_failure = build_system_prompt_report(&PromptPolicyInput {
            recent_tool_failure_count: 1,
            ..base.clone()
        });
        assert_eq!(tool_failure.prompt_mode, PromptDeliveryMode::Full);
        assert_eq!(
            tool_failure.refresh_reason,
            PromptRefreshReason::RecentToolFailureFullRefresh
        );
        assert!(
            tool_failure
                .missed_module_recovery
                .active_triggers
                .contains(&"recentToolFailure".to_string())
        );

        let correction = build_system_prompt_report(&PromptPolicyInput {
            user_correction_detected: true,
            ..base
        });
        assert_eq!(correction.prompt_mode, PromptDeliveryMode::Full);
        assert_eq!(
            correction.refresh_reason,
            PromptRefreshReason::UserCorrectionFullRefresh
        );
        assert!(
            correction
                .missed_module_recovery
                .active_triggers
                .contains(&"userCorrection".to_string())
        );
    }

    #[test]
    fn lean_prompt_selects_scene_modules_from_structured_signals() {
        let previous_contract =
            serde_json::to_value(crate::prompt_contract::current_prompt_runtime_contract())
                .expect("contract json");
        let report = build_system_prompt_report(&PromptPolicyInput {
            runtime_context: json!({
                "toolFilesystem": {
                    "scene": "general"
                },
                "taskContract": {
                    "contract": {
                        "surfaces": ["browser", "image"]
                    }
                },
                "inputSignals": {
                    "hasCitation": true,
                    "hasImage": true
                },
            }),
            delivery_mode: Some(PromptDeliveryMode::LeanExperimental),
            previous_runtime_contract: Some(previous_contract),
            previous_prompt_hash: Some(crate::prompt_templates::templates_fingerprint()),
            ..PromptPolicyInput::default()
        });
        assert_eq!(report.prompt_mode, PromptDeliveryMode::LeanExperimental);
        assert!(report.scene_modules.contains(&"browser".to_string()));
        assert!(report.scene_modules.contains(&"citation".to_string()));
        assert!(report.scene_modules.contains(&"image".to_string()));
        assert!(
            report
                .prompt
                .contains("Browser/web UI: discover caps by intent")
        );
        assert!(
            report
                .prompt
                .contains("Transcript cites anchor to prior msgs")
        );
        assert!(report.prompt.contains("Inline image markers show where"));
        assert!(
            !report
                .prompt
                .contains("Talk direct, grounded, technical, accountable")
        );
    }

    #[test]
    fn lean_prompt_loads_design_scene_only_for_structured_surface() {
        let previous_contract =
            serde_json::to_value(crate::prompt_contract::current_prompt_runtime_contract())
                .expect("contract json");
        let previous_hash = Some(crate::prompt_templates::templates_fingerprint());
        let design = build_system_prompt_report(&PromptPolicyInput {
            runtime_context: json!({
                "toolFilesystem": { "scene": "general" },
                "taskContract": { "contract": { "surfaces": ["ui"] } }
            }),
            delivery_mode: Some(PromptDeliveryMode::LeanExperimental),
            previous_runtime_contract: Some(previous_contract.clone()),
            previous_prompt_hash: previous_hash.clone(),
            ..PromptPolicyInput::default()
        });
        assert_eq!(design.prompt_mode, PromptDeliveryMode::LeanExperimental);
        assert!(design.scene_modules.contains(&"design".to_string()));
        assert!(design.prompt.contains("Major UI work"));

        let ordinary = build_system_prompt_report(&PromptPolicyInput {
            runtime_context: json!({
                "toolFilesystem": { "scene": "general" },
                "taskContract": { "contract": { "surfaces": ["code"] } }
            }),
            delivery_mode: Some(PromptDeliveryMode::LeanExperimental),
            previous_runtime_contract: Some(previous_contract),
            previous_prompt_hash: previous_hash,
            ..PromptPolicyInput::default()
        });
        assert_eq!(ordinary.prompt_mode, PromptDeliveryMode::LeanExperimental);
        assert!(!ordinary.scene_modules.contains(&"design".to_string()));
        assert!(!ordinary.prompt.contains("Major UI work"));
    }

    #[test]
    fn lean_prompt_continues_scene_modules_from_recovery_telemetry() {
        let previous_contract =
            serde_json::to_value(crate::prompt_contract::current_prompt_runtime_contract())
                .expect("contract json");
        let report = build_system_prompt_report(&PromptPolicyInput {
            runtime_context: json!({
                "toolFilesystem": {
                    "scene": "general"
                },
                "promptRecoverySignals": {
                    "recentSceneModules": ["browser", "design"],
                    "recentToolDomains": ["browser", "design"],
                    "recentToolPaths": ["/tools/browser/map", "/tools/design/quality"]
                }
            }),
            delivery_mode: Some(PromptDeliveryMode::LeanExperimental),
            previous_runtime_contract: Some(previous_contract),
            previous_prompt_hash: Some(crate::prompt_templates::templates_fingerprint()),
            ..PromptPolicyInput::default()
        });

        assert_eq!(report.prompt_mode, PromptDeliveryMode::LeanExperimental);
        assert!(report.scene_modules.contains(&"browser".to_string()));
        assert!(report.scene_modules.contains(&"design".to_string()));
        assert!(
            report
                .prompt
                .contains("Browser/web UI: discover caps by intent")
        );
        assert!(report.prompt.contains("Major UI work"));
    }

    #[test]
    fn prompt_report_projection_snapshot_covers_accounting_and_recovery() {
        let report = build_system_prompt_report(&PromptPolicyInput {
            runtime_context: json!({ "toolFilesystem": { "scene": "browser" } }),
            recent_tool_failure_count: 1,
            accounting: PromptAccounting {
                system_budget: 1200,
                tools_budget: 800,
                memory_budget: 600,
                history_budget: 400,
                artifact_budget: 200,
            },
            ..PromptPolicyInput::default()
        });
        let projection = json!({
            "promptMode": report.prompt_mode,
            "refreshReason": report.refresh_reason,
            "contract": report.contract,
            "sceneModules": report.scene_modules,
            "missedModuleRecovery": report.missed_module_recovery,
            "estimatedPromptTokens": report.estimated_prompt_tokens,
            "estimatedSavedTokens": report.estimated_saved_tokens,
            "omittedStableTokens": report.omitted_stable_tokens,
            "prefixCacheEligibleTokens": report.prefix_cache_eligible_tokens,
            "sectionCount": report.sections.len(),
        });
        assert_eq!(projection["promptMode"], json!("full"));
        assert_eq!(projection["refreshReason"], json!("fullModeDefault"));
        assert!(projection["contract"].get("promptPolicyVersion").is_some());
        assert!(
            projection["sceneModules"]
                .as_array()
                .is_some_and(|modules| modules.iter().any(|module| module == "browser"))
        );
        assert_eq!(projection["estimatedSavedTokens"], json!(0));
        assert_eq!(projection["omittedStableTokens"], json!(0));
        assert!(
            projection["prefixCacheEligibleTokens"]
                .as_u64()
                .is_some_and(|tokens| tokens > 0)
        );
        assert!(
            projection["sectionCount"]
                .as_u64()
                .is_some_and(|count| count >= 5)
        );
    }
}
