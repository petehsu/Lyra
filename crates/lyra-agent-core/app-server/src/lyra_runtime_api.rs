use lyra_app_server_protocol::DynamicToolSpec;
use lyra_app_server_protocol::LyraHostToolsRemoveParams;
use lyra_app_server_protocol::LyraHostToolsRemoveResponse;
use lyra_app_server_protocol::LyraHostToolsSyncParams;
use lyra_app_server_protocol::LyraHostToolsSyncResponse;
use lyra_app_server_protocol::LyraPersonaContextParams;
use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::RwLock;

#[derive(Clone, Default)]
pub(crate) struct LyraRuntimeApi {
    inner: Arc<RwLock<LyraRuntimeState>>,
}

#[derive(Default)]
struct LyraRuntimeState {
    host_tool_sets: BTreeMap<String, Vec<DynamicToolSpec>>,
    persona_context: Option<LyraPersonaContextParams>,
}

impl LyraRuntimeApi {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn sync_host_tools(
        &self,
        params: LyraHostToolsSyncParams,
    ) -> LyraHostToolsSyncResponse {
        let LyraHostToolsSyncParams { tool_set_id, tools } = params;
        let sanitized = sanitize_host_tools(tools);
        let accepted_count = sanitized.len();
        if let Ok(mut guard) = self.inner.write() {
            guard.host_tool_sets.insert(tool_set_id, sanitized);
        }
        LyraHostToolsSyncResponse {
            accepted_count,
            dropped_as_lyra_owned_count: 0,
            dropped_tool_names: Vec::new(),
        }
    }

    pub(crate) fn remove_host_tools(
        &self,
        params: LyraHostToolsRemoveParams,
    ) -> LyraHostToolsRemoveResponse {
        if let Ok(mut guard) = self.inner.write() {
            guard.host_tool_sets.remove(&params.tool_set_id);
        }
        LyraHostToolsRemoveResponse {}
    }

    pub(crate) fn set_persona_context(&self, params: LyraPersonaContextParams) {
        if let Ok(mut guard) = self.inner.write() {
            guard.persona_context = Some(params);
        }
    }

    pub(crate) fn current_host_tools(&self) -> Vec<DynamicToolSpec> {
        self.inner
            .read()
            .map(|guard| {
                guard
                    .host_tool_sets
                    .values()
                    .flat_map(|tools| tools.iter().cloned())
                    .collect()
            })
            .unwrap_or_default()
    }

    pub(crate) fn current_host_tool_names(&self) -> BTreeSet<String> {
        self.current_host_tools()
            .into_iter()
            .map(|tool| tool.name)
            .collect()
    }

    pub(crate) fn merge_dynamic_tools(
        &self,
        tools: Option<Vec<DynamicToolSpec>>,
    ) -> Option<Vec<DynamicToolSpec>> {
        let mut merged = self.current_host_tools();
        let mut seen = merged
            .iter()
            .map(|tool| tool.name.clone())
            .collect::<BTreeSet<_>>();

        if let Some(extra_tools) = tools {
            for tool in sanitize_host_tools(extra_tools) {
                if seen.insert(tool.name.clone()) {
                    merged.push(tool);
                }
            }
        }

        if merged.is_empty() {
            None
        } else {
            Some(merged)
        }
    }

    pub(crate) fn merge_developer_instructions(
        &self,
        developer_instructions: Option<String>,
    ) -> Option<String> {
        let persona = self
            .inner
            .read()
            .ok()
            .and_then(|guard| guard.persona_context.clone())
            .map(render_persona_context);

        join_instruction_blocks(persona, developer_instructions)
    }
}

pub(crate) fn strip_persona_context_block(value: Option<String>) -> Option<String> {
    let text = value?;
    let start_marker = "<lyra_persona_context>";
    let end_marker = "</lyra_persona_context>";
    let stripped = if let Some(start) = text.find(start_marker) {
        if let Some(relative_end) = text[start..].find(end_marker) {
            let end = start + relative_end + end_marker.len();
            let mut next = String::new();
            next.push_str(text[..start].trim_end());
            if !next.is_empty() && !text[end..].trim_start().is_empty() {
                next.push_str("\n\n");
            }
            next.push_str(text[end..].trim_start());
            next
        } else {
            text
        }
    } else {
        text
    };
    let trimmed = stripped.trim().to_string();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn sanitize_host_tools(tools: Vec<DynamicToolSpec>) -> Vec<DynamicToolSpec> {
    let mut seen = BTreeSet::new();
    let mut result = Vec::new();

    for tool in tools {
        if tool.name.trim().is_empty() || tool.description.trim().is_empty() {
            continue;
        }
        if !seen.insert(tool.name.clone()) {
            continue;
        }
        result.push(tool);
    }

    result
}

fn join_instruction_blocks(first: Option<String>, second: Option<String>) -> Option<String> {
    match (
        first
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        second
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    ) {
        (None, None) => None,
        (Some(value), None) | (None, Some(value)) => Some(value),
        (Some(left), Some(right)) => Some(format!("{left}\n\n{right}")),
    }
}

fn render_persona_context(context: LyraPersonaContextParams) -> String {
    let LyraPersonaContextParams {
        persona_name,
        company_name,
        company_description,
        coworker_label,
        local_time,
        timezone,
        locale,
        location_display,
        location_source,
        location_confidence,
        location_detail,
        physical_location_display,
        ip_location_display,
        ip_address,
        device_name,
        device_profile,
        os_name,
        os_version,
        architecture,
        cpu_model,
        cpu_cores,
        memory_gb,
    } = context;

    let mut lines = vec![
        "<lyra_persona_context>".to_string(),
        format!("Primary host persona: {persona_name}"),
        format!("Company: {company_name}"),
        format!("Company description: {company_description}"),
        format!("Treat the local user as a {coworker_label}."),
        format!("Local time: {local_time}"),
        format!("Timezone: {timezone}"),
        format!("Locale: {locale}"),
        format!("Preferred location display: {location_display}"),
        format!("Location source: {location_source}"),
        format!("Location confidence: {location_confidence}"),
        format!("Location detail: {location_detail}"),
        format!("Physical location guess: {physical_location_display}"),
        format!("IP location guess: {ip_location_display}"),
        format!("Device name: {device_name}"),
        format!("Device profile: {device_profile}"),
        format!("OS: {os_name} {os_version}"),
        format!("Architecture: {architecture}"),
        format!("CPU: {cpu_model} x{cpu_cores}"),
        format!("Memory GB: {memory_gb}"),
    ];
    if let Some(ip_address) = ip_address.filter(|value| !value.trim().is_empty()) {
        lines.push(format!("Observed IP address: {ip_address}"));
    }
    lines.push(
        "Use this host context when it materially improves actions, wording, or safety checks."
            .to_string(),
    );
    lines.push("</lyra_persona_context>".to_string());
    lines.join("\n")
}
