use super::*;

pub(crate) struct RuntimeToolManifestProvider {
    manifests: Vec<ToolManifest>,
    sources: Vec<Value>,
    local_code_search_available: bool,
}

impl RuntimeToolManifestProvider {
    fn from_runtime(dispatcher: Option<&Arc<HostCapabilityDispatcher>>) -> Self {
        let local_code_search_available = local_code_search_tools_available();
        let builtin_registry = ToolFsRegistry::with_builtin_filter_and_providers(
            |manifest| {
                local_code_search_available || !is_local_code_search_tool_path(&manifest.path)
            },
            &[],
        );
        let builtin_diagnostics = if local_code_search_available {
            Vec::new()
        } else {
            local_code_search_unavailable_diagnostics()
        };
        let mut sources = vec![runtime_manifest_source(
            "core_builtin",
            "static",
            &[
                "filesystem",
                "code",
                "shell",
                "terminal",
                "git",
                "workbench",
                "browser",
                "web",
                "render",
                "todo",
                "memory",
                "design",
                "skills",
                "mcp",
                "software",
                "runtime",
            ],
            builtin_registry.manifests().len(),
            builtin_diagnostics,
        )];
        for (name, domains) in [
            ("terminal_action_specs", &["terminal"][..]),
            ("design_tools", &["design"][..]),
            ("skill_registry", &["skills"][..]),
            ("mcp_current_state", &["mcp"][..]),
            ("host_static_capabilities", &["workbench", "browser"][..]),
        ] {
            let diagnostics = if name == "mcp_current_state" {
                vec![json!({
                    "code": "static_management_only",
                    "domain": "mcp",
                    "message": "Runtime exposes MCP management tools; current external server/tool manifests are resolved by MCP tools at run time.",
                    "recoverable": true,
                })]
            } else if name == "host_static_capabilities" && dispatcher.is_none() {
                vec![json!({
                    "code": "host_unavailable",
                    "domain": "host",
                    "message": "Workbench/browser host capabilities are listed statically but cannot run until the host bridge is available.",
                    "recoverable": true,
                })]
            } else {
                Vec::new()
            };
            sources.push(runtime_manifest_source(
                name,
                "static",
                domains,
                count_registry_domains(&builtin_registry, domains),
                diagnostics,
            ));
        }
        let (software_manifests, software_diagnostics) =
            software_manifests_with_diagnostics(dispatcher);
        sources.push(runtime_manifest_source(
            "software_host_capabilities",
            "dynamic",
            &["software"],
            software_manifests.len(),
            software_diagnostics,
        ));
        Self {
            manifests: software_manifests,
            sources,
            local_code_search_available,
        }
    }

    fn source_summary(&self) -> Value {
        Value::Array(self.sources.clone())
    }

    fn include_builtin_manifest(&self, manifest: &ToolManifest) -> bool {
        self.local_code_search_available || !is_local_code_search_tool_path(&manifest.path)
    }
}

impl ToolManifestProvider for RuntimeToolManifestProvider {
    fn tool_manifests(&self) -> Vec<ToolManifest> {
        self.manifests.clone()
    }
}

pub(crate) fn runtime_registry() -> ToolFsRegistry {
    runtime_registry_with_dispatcher(None)
}

pub(crate) fn runtime_registry_with_dispatcher(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> ToolFsRegistry {
    let provider = RuntimeToolManifestProvider::from_runtime(dispatcher);
    ToolFsRegistry::with_builtin_filter_and_providers(
        |manifest| provider.include_builtin_manifest(manifest),
        &[&provider],
    )
}

pub(crate) fn runtime_manifest_source_summary(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    RuntimeToolManifestProvider::from_runtime(dispatcher).source_summary()
}

pub(super) fn runtime_registry_for_tool_fs_call(
    tool_name: &str,
    input: &Value,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> ToolFsRegistry {
    if tool_fs_call_needs_dynamic_software(tool_name, input) {
        runtime_registry_with_dispatcher(dispatcher)
    } else {
        runtime_registry()
    }
}

pub(super) fn tool_fs_call_needs_dynamic_software(tool_name: &str, input: &Value) -> bool {
    let path = input
        .get("path")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .trim_end_matches('/');
    match tool_name {
        TOOL_FS_SEARCH => true,
        TOOL_FS_LIST => {
            path == "/tools/software"
                || path == "/tools/software/capability"
                || path.starts_with("/tools/software/capability/")
        }
        TOOL_FS_READ_DOC | TOOL_FS_INSPECT | TOOL_FS_RUN => {
            path == "/tools/software/capability" || path.starts_with("/tools/software/capability/")
        }
        _ => false,
    }
}

pub(super) fn software_manifests_with_diagnostics(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> (Vec<ToolManifest>, Vec<Value>) {
    let Some(dispatcher) = dispatcher else {
        return (Vec::new(), software_capability_provider_diagnostics(None));
    };
    let Ok(value) = invoke_host_capability(
        dispatcher,
        "software.listCapabilities",
        json!({ "includeSchemas": true }),
    ) else {
        return (
            Vec::new(),
            software_capability_provider_diagnostics(Some(dispatcher)),
        );
    };
    let manifests = value
        .get("software")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(software_action_manifests)
        .collect::<Vec<_>>();
    let diagnostics = if manifests.is_empty() {
        vec![json!({
            "code": "dynamic_provider_empty",
            "domain": "software",
            "message": "No Lyra software capabilities are currently registered.",
            "recoverable": true,
        })]
    } else {
        Vec::new()
    };
    (manifests, diagnostics)
}

pub(super) fn count_registry_domains(registry: &ToolFsRegistry, domains: &[&str]) -> usize {
    registry
        .manifests()
        .iter()
        .filter(|manifest| domains.iter().any(|domain| *domain == manifest.domain))
        .count()
}

pub(super) fn runtime_manifest_source(
    name: &str,
    kind: &str,
    domains: &[&str],
    manifest_count: usize,
    diagnostics: Vec<Value>,
) -> Value {
    json!({
        "name": name,
        "kind": kind,
        "domains": domains,
        "manifestCount": manifest_count,
        "diagnostics": diagnostics,
    })
}

pub(super) fn software_capability_directory_requested(path: &str) -> bool {
    path.trim().trim_end_matches('/') == "/tools/software/capability"
}

pub(super) fn empty_software_capability_directory(
    page: usize,
    page_size: usize,
    diagnostics: Vec<Value>,
) -> Value {
    json!({
        "kind": "tool_fs_directory",
        "path": "/tools/software/capability",
        "directories": [],
        "tools": [],
        "total": 0,
        "page": page,
        "pageSize": page_size,
        "hasMore": false,
        "diagnostics": diagnostics,
    })
}

pub(super) fn software_capability_provider_diagnostics(
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Vec<Value> {
    let Some(dispatcher) = dispatcher else {
        return vec![json!({
            "code": "host_unavailable",
            "domain": "software",
            "message": "Lyra software capability provider is not available.",
            "recoverable": true,
        })];
    };
    match invoke_host_capability(
        dispatcher,
        "software.listCapabilities",
        json!({ "includeSchemas": true }),
    ) {
        Ok(value) => {
            let count = value
                .get("software")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
            if count == 0 {
                vec![json!({
                    "code": "dynamic_provider_empty",
                    "domain": "software",
                    "message": "No Lyra software capabilities are currently registered.",
                    "recoverable": true,
                })]
            } else {
                Vec::new()
            }
        }
        Err(error) => vec![json!({
            "code": "dynamic_provider_failed",
            "domain": "software",
            "message": error,
            "recoverable": true,
        })],
    }
}

pub(super) fn with_tool_directory_diagnostics(
    mut directory: Value,
    requested_path: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Value {
    let diagnostics = host_availability_diagnostics(requested_path, dispatcher);
    if diagnostics.is_empty() {
        return directory;
    }
    if let Some(object) = directory.as_object_mut() {
        object.insert("diagnostics".to_string(), Value::Array(diagnostics));
    }
    directory
}

pub(super) fn host_availability_diagnostics(
    requested_path: &str,
    dispatcher: Option<&Arc<HostCapabilityDispatcher>>,
) -> Vec<Value> {
    if dispatcher.is_some() {
        return Vec::new();
    }
    let normalized = requested_path.trim().trim_end_matches('/');
    let domain = normalized
        .strip_prefix("/tools/")
        .and_then(|rest| rest.split('/').next())
        .filter(|value| !value.trim().is_empty());
    let Some(domain) = domain else {
        return Vec::new();
    };
    if !matches!(
        domain,
        "browser" | "workbench" | "software" | "terminal" | "mcp"
    ) {
        return Vec::new();
    }
    vec![json!({
        "code": "host_unavailable",
        "domain": domain,
        "message": format!("The /tools/{domain} host capability bridge is not currently available."),
        "recoverable": true,
    })]
}

pub(super) fn software_action_manifests(software: &Value) -> Vec<ToolManifest> {
    let software_id = software
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("software");
    let software_title = software
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(software_id);
    software
        .get("actions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|action| {
            let action_id = action
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())?;
            let action_title = action
                .get("title")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or(action_id);
            let summary = action
                .get("description")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("Invoke {action_title} in {software_title}."));
            let risk = action
                .get("risk")
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .unwrap_or("external");
            let path = software_capability_path(software_id, action_id);
            Some(ToolManifest {
                path: path.clone(),
                handle: None,
                domain: "software".to_string(),
                operation: "invoke_capability".to_string(),
                title: action_title.to_string(),
                summary: summary.clone(),
                description: format!(
                    "Invoke the {action_title} capability in the {software_title} Lyra software adapter. {summary} Use when the agent needs an installed app or local software integration instead of a built-in Tool-FS domain."
                ),
                aliases: software_capability_aliases(software_id, software_title, action_id, action_title),
                examples: vec![
                    format!("Use {action_title} in {software_title}."),
                    format!("Invoke software capability {software_id}/{action_id}."),
                    "Find and run an installed app capability.".to_string(),
                ],
                tags: vec![
                    "software".to_string(),
                    "adapter".to_string(),
                    "capability".to_string(),
                    software_id.to_string(),
                    action_id.to_string(),
                ],
                risk_level: format!("software_{risk}"),
                permission_policy: "host_policy".to_string(),
                input_schema: attach_schema_id(&path, software_action_input_schema(action)),
                output_kind: "json".to_string(),
                activity_kind: "task".to_string(),
                renderer_hint: "software".to_string(),
            })
        })
        .collect()
}

pub(super) fn software_capability_aliases(
    software_id: &str,
    software_title: &str,
    action_id: &str,
    action_title: &str,
) -> Vec<String> {
    let mut values = vec![
        software_id.to_string(),
        software_title.to_string(),
        action_id.to_string(),
        action_title.to_string(),
        format!("{software_title} {action_title}"),
        "software adapter".to_string(),
        "app capability".to_string(),
        "应用能力".to_string(),
    ];
    values.sort();
    values.dedup();
    values
}

pub(super) fn software_action_input_schema(action: &Value) -> Value {
    action
        .get("inputSchema")
        .filter(|schema| schema.is_object())
        .cloned()
        .unwrap_or_else(|| json!({ "type": "object", "additionalProperties": true }))
}

pub(super) fn software_capability_path(software_id: &str, action_id: &str) -> String {
    format!(
        "/tools/software/capability/{}/{}",
        urlencoding::encode(software_id),
        urlencoding::encode(action_id)
    )
}

pub(super) fn parse_software_capability_path(path: &str) -> Option<(String, String)> {
    let rest = path.strip_prefix("/tools/software/capability/")?;
    let mut parts = rest.split('/');
    let software_id = parts.next().filter(|value| !value.trim().is_empty())?;
    let action_id = parts.next().filter(|value| !value.trim().is_empty())?;
    if parts.next().is_some() {
        return None;
    }
    let software_id = urlencoding::decode(software_id).ok()?.into_owned();
    let action_id = urlencoding::decode(action_id).ok()?.into_owned();
    (!software_id.trim().is_empty() && !action_id.trim().is_empty())
        .then_some((software_id, action_id))
}
