use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};
use thiserror::Error;
use uuid::Uuid;

pub const TOOL_FS_LIST: &str = "tool_fs_list";
pub const TOOL_FS_READ_DOC: &str = "tool_fs_read_doc";
pub const TOOL_FS_INSPECT: &str = "tool_fs_inspect";
pub const TOOL_FS_RUN: &str = "tool_fs_run";
pub const PROVIDER_VISIBLE_TOOL_NAMES: [&str; 4] =
    [TOOL_FS_LIST, TOOL_FS_READ_DOC, TOOL_FS_INSPECT, TOOL_FS_RUN];
pub const TOOL_FS_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_TOOL_TIMEOUT_MS: u64 = 30_000;
pub const MAX_TOOL_TIMEOUT_MS: u64 = 120_000;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolManifest {
    pub path: String,
    pub handle: Option<String>,
    pub domain: String,
    pub operation: String,
    pub title: String,
    pub summary: String,
    pub risk_level: String,
    pub permission_policy: String,
    pub input_schema: Value,
    pub output_kind: String,
    pub activity_kind: String,
    pub renderer_hint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDirectory {
    pub kind: String,
    pub path: String,
    pub directories: Vec<ToolDirectoryEntry>,
    pub tools: Vec<ToolManifest>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolDirectoryEntry {
    pub path: String,
    pub name: String,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolOperationEnvelope {
    pub schema_version: u32,
    pub op_id: String,
    pub session_id: String,
    pub runtime_turn_id: String,
    pub op: String,
    pub path: Option<String>,
    pub args: Value,
    pub tool_handle: Option<String>,
    pub policy_snapshot_id: Option<String>,
    pub permission_mode: String,
    pub trace_id: String,
    pub timeout_ms: Option<u64>,
    pub risk_context: Value,
    pub output_contract: Value,
    pub created_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolOperationContext {
    pub session_id: String,
    pub turn_id: String,
    pub working_dir: Option<String>,
    pub active_tab_id: Option<String>,
    pub workspace_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolResultEnvelope {
    pub schema_version: u32,
    pub status: String,
    pub runtime_turn_id: String,
    pub duration_ms: u64,
    pub trace_id: String,
    pub ok: bool,
    pub content: String,
    pub raw: Value,
    pub tool_path: String,
    pub domain: String,
    pub operation: String,
    pub artifacts: Vec<Value>,
    pub artifact_refs: Vec<Value>,
    pub projection_ref: Option<Value>,
    pub data_ref: Option<Value>,
    pub stdout_ref: Option<Value>,
    pub stderr_ref: Option<Value>,
    pub changes: Vec<ToolChangeRecord>,
    pub error: Option<Value>,
    pub not_run_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolChangeRecord {
    pub schema_version: u32,
    pub change_id: String,
    pub kind: String,
    pub operation: String,
    pub path: Option<String>,
    pub summary: String,
    pub detail: Value,
    pub reversible: bool,
    pub before_ref: Option<Value>,
    pub after_ref: Option<Value>,
    pub diff_ref: Option<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolTraceRecord {
    pub schema_version: u32,
    pub trace_id: String,
    pub op_id: String,
    pub runtime_turn_id: String,
    pub tool_path: Option<String>,
    pub phase: String,
    pub status: String,
    pub message: Option<String>,
    pub detail: Value,
    pub timestamp: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolScene {
    General,
    ProjectCode,
    Git,
    Terminal,
    Browser,
    Workbench,
    Design,
    Automation,
}

impl ToolScene {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::General => "general",
            Self::ProjectCode => "project-code",
            Self::Git => "git",
            Self::Terminal => "terminal",
            Self::Browser => "browser",
            Self::Workbench => "workbench",
            Self::Design => "design",
            Self::Automation => "automation",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value.trim() {
            "project-code" => Self::ProjectCode,
            "git" => Self::Git,
            "terminal" => Self::Terminal,
            "browser" => Self::Browser,
            "workbench" => Self::Workbench,
            "design" => Self::Design,
            "automation" => Self::Automation,
            _ => Self::General,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PinnedToolHandle {
    pub handle: String,
    pub path: String,
    pub title: String,
    pub domain: String,
    pub operation: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolSceneSignals {
    pub session_kind: Option<String>,
    pub project_bound: bool,
    pub working_dir: Option<String>,
    pub git_repo: bool,
    pub active_tab_kind: Option<String>,
    pub focused_tab_kind: Option<String>,
    pub terminal_active: bool,
    pub browser_active: bool,
    pub editor_active: bool,
    pub design_active: bool,
    pub software_active: bool,
    pub active_skills: Vec<String>,
}

pub trait ToolManifestProvider {
    fn tool_manifests(&self) -> Vec<ToolManifest>;
}

#[derive(Clone, Debug)]
pub struct ToolFsRegistry {
    manifests: Vec<ToolManifest>,
}

impl Default for ToolFsRegistry {
    fn default() -> Self {
        Self::builtin()
    }
}

impl ToolFsRegistry {
    pub fn builtin() -> Self {
        Self {
            manifests: builtin_manifests(),
        }
    }

    pub fn with_providers(providers: &[&dyn ToolManifestProvider]) -> Self {
        let mut manifests = builtin_manifests();
        for provider in providers {
            manifests.extend(provider.tool_manifests());
        }
        dedupe_manifests(&mut manifests);
        Self { manifests }
    }

    pub fn manifests(&self) -> &[ToolManifest] {
        &self.manifests
    }

    pub fn list(
        &self,
        path: &str,
        page: usize,
        page_size: usize,
        scene: ToolScene,
    ) -> Result<ToolDirectory, ToolFsError> {
        let normalized = normalize_tool_path(path);
        let page_size = page_size.clamp(1, 200);
        if normalized == "/tools" {
            let directories = self.ordered_domains(scene);
            return Ok(ToolDirectory {
                kind: "tool_fs_directory".to_string(),
                path: "/tools".to_string(),
                directories: directories
                    .into_iter()
                    .map(|domain| ToolDirectoryEntry {
                        path: format!("/tools/{domain}"),
                        name: domain.to_string(),
                        summary: domain_summary(&domain).to_string(),
                    })
                    .collect(),
                tools: Vec::new(),
                total: 0,
                page,
                page_size,
                has_more: false,
            });
        }

        let prefix = format!("{}/", normalized.trim_end_matches('/'));
        let mut tools = self
            .manifests
            .iter()
            .filter(|manifest| manifest.path.starts_with(&prefix))
            .cloned()
            .collect::<Vec<_>>();
        if tools.is_empty() {
            return Err(ToolFsError::new(
                "tool_directory_not_found",
                format!("Tool directory was not found or is empty: {normalized}"),
                "Call tool_fs_list with /tools to discover available directories.",
            ));
        }
        self.sort_manifests(&mut tools, scene);
        let total = tools.len();
        let start = page.saturating_mul(page_size).min(total);
        let end = (start + page_size).min(total);
        Ok(ToolDirectory {
            kind: "tool_fs_directory".to_string(),
            path: normalized,
            directories: Vec::new(),
            tools: tools[start..end].to_vec(),
            total,
            page,
            page_size,
            has_more: end < total,
        })
    }

    pub fn read_doc(&self, path: &str) -> Result<Value, ToolFsError> {
        let normalized = normalize_tool_path(path);
        if normalized == "/tools" {
            return Ok(json!({
                "kind": "tool_fs_doc",
                "path": "/tools",
                "title": "Lyra Tool Filesystem",
                "content": "Browse /tools by domain, inspect a concrete tool path, then call tool_fs_run with that path or a pinned handle. Provider-visible tools are fixed to tool_fs_list, tool_fs_read_doc, tool_fs_inspect, tool_fs_run, and lyra_turn_finish."
            }));
        }
        if let Some(manifest) = self.lookup_path(&normalized) {
            return Ok(json!({
                "kind": "tool_fs_doc",
                "path": manifest.path,
                "title": manifest.title,
                "content": format!("{} Input schema is available through tool_fs_inspect.", manifest.summary),
            }));
        }
        let domain = normalized
            .trim_start_matches("/tools/")
            .split('/')
            .next()
            .unwrap_or_default();
        if !domain.is_empty()
            && self
                .manifests
                .iter()
                .any(|manifest| manifest.domain == domain)
        {
            return Ok(json!({
                "kind": "tool_fs_doc",
                "path": format!("/tools/{domain}"),
                "title": format!("/tools/{domain}"),
                "content": domain_summary(domain),
            }));
        }
        Err(ToolFsError::new(
            "tool_doc_not_found",
            format!("Tool documentation was not found: {normalized}"),
            "Call tool_fs_list to discover valid documentation paths.",
        ))
    }

    pub fn inspect_path(&self, path: &str) -> Result<ToolManifest, ToolFsError> {
        let normalized = normalize_tool_path(path);
        self.lookup_path(&normalized).cloned().ok_or_else(|| {
            ToolFsError::new(
                "tool_not_found",
                format!("Tool Filesystem target was not found: {normalized}"),
                "Inspect an existing /tools path or pinned handle.",
            )
        })
    }

    pub fn inspect_handle(&self, handle: &str) -> Result<ToolManifest, ToolFsError> {
        let normalized = handle.trim();
        self.lookup_handle(normalized).cloned().ok_or_else(|| {
            ToolFsError::new(
                "tool_not_found",
                format!("Tool Filesystem handle was not found: {normalized}"),
                "Inspect an existing /tools path or pinned handle.",
            )
        })
    }

    pub fn inspect_input(&self, input: &Value) -> Result<ToolManifest, ToolFsError> {
        if let Some(path) = input.get("path").and_then(Value::as_str) {
            return self.inspect_path(path);
        }
        if let Some(handle) = input
            .get("toolHandle")
            .or_else(|| input.get("tool_handle"))
            .and_then(Value::as_str)
        {
            return self.inspect_handle(handle);
        }
        Err(ToolFsError::new(
            "tool_target_required",
            "tool_fs_inspect requires path or toolHandle.",
            "Provide a concrete /tools path or pinned tool handle.",
        ))
    }

    fn resolve_target(
        &self,
        target_path: Option<&str>,
        target_handle: Option<&str>,
        op: &str,
    ) -> Result<ToolManifest, ToolFsError> {
        let target_path = target_path.map(str::trim).filter(|value| !value.is_empty());
        let target_handle = target_handle
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if target_path.is_none() && target_handle.is_none() {
            return Err(ToolFsError::new(
                "tool_target_required",
                format!("tool_fs_{op} requires path or toolHandle."),
                "Provide a concrete /tools path or pinned handle.",
            ));
        }
        let path_manifest = target_path
            .map(|path| self.inspect_path(path))
            .transpose()?;
        let handle_manifest = target_handle
            .map(|handle| self.inspect_handle(handle))
            .transpose()?;
        match (path_manifest, handle_manifest) {
            (Some(path_manifest), Some(handle_manifest)) => {
                if path_manifest.path != handle_manifest.path {
                    return Err(ToolFsError::new(
                        "ambiguous_tool_target",
                        "Tool-FS path and toolHandle resolve to different tools.",
                        "Provide only one target, or make path and toolHandle refer to the same tool.",
                    )
                    .with_detail(json!({
                        "pathTarget": path_manifest.path,
                        "handleTarget": handle_manifest.path,
                    })));
                }
                Ok(path_manifest)
            }
            (Some(manifest), None) | (None, Some(manifest)) => Ok(manifest),
            (None, None) => unreachable!("target presence checked above"),
        }
    }

    pub fn resolve_run_input(&self, input: &Value) -> Result<ResolvedToolRun, ToolFsError> {
        let target_path = input.get("path").and_then(Value::as_str);
        let target_handle = input
            .get("toolHandle")
            .or_else(|| input.get("tool_handle"))
            .and_then(Value::as_str);
        let manifest = self.resolve_target(target_path, target_handle, "run")?;
        let args = input.get("args").cloned().unwrap_or_else(|| json!({}));
        if !args.is_object() {
            return Err(ToolFsError::new(
                "invalid_tool_args",
                "tool_fs_run args must be an object.",
                "Retry with args as a JSON object matching the inspected inputSchema.",
            )
            .with_detail(json!({ "args": args })));
        }
        Ok(ResolvedToolRun {
            manifest,
            args,
            requested_path: target_path.map(str::to_string),
            requested_handle: target_handle.map(str::to_string),
        })
    }

    pub fn lookup_path(&self, path: &str) -> Option<&ToolManifest> {
        let normalized = normalize_tool_path(path);
        self.manifests
            .iter()
            .find(|manifest| manifest.path == normalized)
    }

    pub fn lookup_handle(&self, handle: &str) -> Option<&ToolManifest> {
        let handle = handle.trim();
        self.manifests
            .iter()
            .find(|manifest| manifest.handle.as_deref() == Some(handle))
    }

    pub fn pinned_handles(&self, scene: ToolScene) -> Vec<PinnedToolHandle> {
        pinned_handle_names(scene)
            .into_iter()
            .filter_map(|handle| {
                let manifest = self.lookup_handle(handle)?;
                Some(PinnedToolHandle {
                    handle: handle.to_string(),
                    path: manifest.path.clone(),
                    title: manifest.title.clone(),
                    domain: manifest.domain.clone(),
                    operation: manifest.operation.clone(),
                })
            })
            .collect()
    }

    pub fn root_summary(&self) -> Value {
        let domains = self.ordered_domains(ToolScene::General);
        json!({
            "path": "/tools",
            "domainCount": domains.len(),
            "toolCount": self.manifests.len(),
            "domains": domains,
        })
    }

    fn ordered_domains(&self, scene: ToolScene) -> Vec<String> {
        let present = self
            .manifests
            .iter()
            .map(|manifest| manifest.domain.as_str())
            .collect::<HashSet<_>>();
        let mut ordered = scene_domain_order(scene)
            .into_iter()
            .filter(|domain| present.contains(*domain))
            .map(str::to_string)
            .collect::<Vec<_>>();
        let mut rest = present.into_iter().collect::<Vec<_>>();
        rest.sort_unstable();
        for domain in rest {
            if !ordered.iter().any(|ordered| ordered == domain) {
                ordered.push(domain.to_string());
            }
        }
        ordered
    }

    fn sort_manifests(&self, tools: &mut [ToolManifest], scene: ToolScene) {
        let pinned = pinned_handle_names(scene);
        tools.sort_by(|left, right| {
            let left_rank = left
                .handle
                .as_deref()
                .and_then(|handle| pinned.iter().position(|pinned| *pinned == handle))
                .unwrap_or(usize::MAX);
            let right_rank = right
                .handle
                .as_deref()
                .and_then(|handle| pinned.iter().position(|pinned| *pinned == handle))
                .unwrap_or(usize::MAX);
            left_rank
                .cmp(&right_rank)
                .then_with(|| left.path.cmp(&right.path))
        });
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedToolRun {
    pub manifest: ToolManifest,
    pub args: Value,
    pub requested_path: Option<String>,
    pub requested_handle: Option<String>,
}

#[derive(Clone, Debug, Error, Serialize, Deserialize, PartialEq)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct ToolFsError {
    pub code: String,
    pub message: String,
    pub recommended_next_action: String,
    pub detail: Option<Value>,
}

impl ToolFsError {
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        recommended_next_action: impl Into<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            recommended_next_action: recommended_next_action.into(),
            detail: None,
        }
    }

    pub fn with_detail(mut self, detail: Value) -> Self {
        self.detail = Some(detail);
        self
    }
}

pub fn normalize_tool_path(path: &str) -> String {
    let trimmed = path.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return "/tools".to_string();
    }
    if trimmed == "/tools" || trimmed.starts_with("/tools/") {
        return trimmed.to_string();
    }
    format!("/tools/{}", trimmed.trim_start_matches('/'))
}

pub fn provider_tool_names() -> Vec<String> {
    PROVIDER_VISIBLE_TOOL_NAMES
        .into_iter()
        .map(str::to_string)
        .collect()
}

pub fn infer_scene(signals: &ToolSceneSignals) -> ToolScene {
    if signals.design_active
        || signals
            .active_skills
            .iter()
            .any(|skill| skill == "lyra-design-research")
        || signal_kind_matches(signals, ["design", "image", "canvas"])
    {
        return ToolScene::Design;
    }
    if signals.terminal_active || signal_kind_matches(signals, ["terminal"]) {
        return ToolScene::Terminal;
    }
    if signals.browser_active || signal_kind_matches(signals, ["browser", "lumen", "web"]) {
        return ToolScene::Browser;
    }
    if signals.editor_active || signal_kind_matches(signals, ["file", "editor", "code"]) {
        return ToolScene::ProjectCode;
    }
    if signals.software_active || signal_kind_matches(signals, ["software", "app"]) {
        return ToolScene::Automation;
    }
    if signals.git_repo {
        return ToolScene::Git;
    }
    if signals.project_bound
        || signals
            .working_dir
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    {
        return ToolScene::ProjectCode;
    }
    if signal_kind_matches(signals, ["workbench"]) {
        return ToolScene::Workbench;
    }
    ToolScene::General
}

impl ToolOperationEnvelope {
    pub fn validate(&self, registry: &ToolFsRegistry) -> Result<Option<ToolManifest>, ToolFsError> {
        if self.schema_version != TOOL_FS_SCHEMA_VERSION {
            return Err(ToolFsError::new(
                "unsupported_schema_version",
                format!(
                    "Tool-FS operation schemaVersion {} is not supported.",
                    self.schema_version
                ),
                "Retry with the current Tool-FS operation envelope schema.",
            )
            .with_detail(json!({ "expectedSchemaVersion": TOOL_FS_SCHEMA_VERSION })));
        }
        if self.session_id.trim().is_empty() {
            return Err(ToolFsError::new(
                "missing_session",
                "Tool-FS operation is missing sessionId.",
                "Retry after creating or restoring an Agent session.",
            ));
        }
        if self.runtime_turn_id.trim().is_empty() {
            return Err(ToolFsError::new(
                "missing_runtime_turn",
                "Tool-FS operation is missing runtimeTurnId.",
                "Retry inside an active Agent runtime turn.",
            ));
        }
        if self.op.trim().is_empty() {
            return Err(ToolFsError::new(
                "missing_operation",
                "Tool-FS operation is missing op.",
                "Retry with list, read_doc, inspect, or run.",
            ));
        }
        if self
            .policy_snapshot_id
            .as_deref()
            .is_none_or(|value| value.trim().is_empty())
        {
            return Err(ToolFsError::new(
                "missing_policy_snapshot",
                "Tool-FS operation is missing policySnapshotId.",
                "Retry after the runtime attaches the current policy snapshot.",
            ));
        }
        if let Some(timeout_ms) = self.timeout_ms
            && !(1..=MAX_TOOL_TIMEOUT_MS).contains(&timeout_ms)
        {
            return Err(ToolFsError::new(
                "invalid_timeout",
                format!("Tool-FS timeoutMs must be between 1 and {MAX_TOOL_TIMEOUT_MS}."),
                "Retry with a valid timeoutMs or omit it.",
            )
            .with_detail(json!({ "timeoutMs": timeout_ms })));
        }
        if self
            .risk_context
            .get("cancellationRequested")
            .and_then(Value::as_bool)
            == Some(true)
        {
            return Err(ToolFsError::new(
                "operation_cancelled",
                "Tool-FS operation was cancelled before execution.",
                "Stop this tool call and wait for a new user turn.",
            ));
        }
        if !self.args.is_object() {
            return Err(ToolFsError::new(
                "invalid_tool_args",
                "Tool-FS args must be a JSON object.",
                "Retry with args as an object matching the inspected inputSchema.",
            )
            .with_detail(json!({ "args": self.args })));
        }

        match self.op.as_str() {
            "list" | "read_doc" => {
                if self
                    .path
                    .as_deref()
                    .is_none_or(|value| value.trim().is_empty())
                {
                    return Err(ToolFsError::new(
                        "tool_path_required",
                        format!("tool_fs_{} requires path.", self.op),
                        "Provide /tools or a concrete /tools path.",
                    ));
                }
                Ok(None)
            }
            "inspect" | "run" => {
                let manifest = self.resolve_target_manifest(registry)?;
                if self.op == "run" {
                    validate_args_against_schema(&manifest, &self.args)?;
                }
                Ok(Some(manifest))
            }
            other => Err(ToolFsError::new(
                "unknown_tool_fs_operation",
                format!("Unknown Tool-FS operation: {other}"),
                "Use list, read_doc, inspect, or run.",
            )),
        }
    }

    fn resolve_target_manifest(
        &self,
        registry: &ToolFsRegistry,
    ) -> Result<ToolManifest, ToolFsError> {
        registry.resolve_target(self.path.as_deref(), self.tool_handle.as_deref(), &self.op)
    }
}

impl ToolTraceRecord {
    pub fn new(
        trace_id: impl Into<String>,
        op_id: impl Into<String>,
        runtime_turn_id: impl Into<String>,
        tool_path: Option<String>,
        phase: impl Into<String>,
        status: impl Into<String>,
        message: Option<String>,
        detail: Value,
        timestamp: impl Into<String>,
    ) -> Self {
        Self {
            schema_version: TOOL_FS_SCHEMA_VERSION,
            trace_id: trace_id.into(),
            op_id: op_id.into(),
            runtime_turn_id: runtime_turn_id.into(),
            tool_path,
            phase: phase.into(),
            status: status.into(),
            message,
            detail,
            timestamp: timestamp.into(),
        }
    }
}

fn validate_args_against_schema(manifest: &ToolManifest, args: &Value) -> Result<(), ToolFsError> {
    let Some(args_object) = args.as_object() else {
        return Err(ToolFsError::new(
            "invalid_tool_args",
            "Tool-FS args must be a JSON object.",
            "Retry with args as an object matching the inspected inputSchema.",
        ));
    };
    if let Some(required) = manifest
        .input_schema
        .get("required")
        .and_then(Value::as_array)
    {
        let missing = required
            .iter()
            .filter_map(Value::as_str)
            .filter(|field| args_object.get(*field).is_none_or(Value::is_null))
            .map(str::to_string)
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(ToolFsError::new(
                "invalid_tool_args",
                format!(
                    "Tool-FS args are missing required field(s): {}.",
                    missing.join(", ")
                ),
                "Inspect the target tool and retry with all required args.",
            )
            .with_detail(json!({
                "toolPath": manifest.path,
                "missing": missing,
            })));
        }
    }
    let Some(properties) = manifest
        .input_schema
        .get("properties")
        .and_then(Value::as_object)
    else {
        return Ok(());
    };
    let allow_additional = manifest
        .input_schema
        .get("additionalProperties")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    for (field, value) in args_object {
        let Some(schema) = properties.get(field) else {
            if !allow_additional {
                return Err(schema_validation_error(
                    manifest,
                    field,
                    "field is not declared in the target input schema",
                    json!({ "field": field }),
                ));
            }
            continue;
        };
        validate_value_against_schema(manifest, field, value, schema)?;
    }
    Ok(())
}

fn validate_value_against_schema(
    manifest: &ToolManifest,
    field: &str,
    value: &Value,
    schema: &Value,
) -> Result<(), ToolFsError> {
    if value.is_null() {
        return Ok(());
    }
    if let Some(enum_values) = schema.get("enum").and_then(Value::as_array)
        && !enum_values.iter().any(|allowed| allowed == value)
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value is not in the allowed enum",
            json!({ "field": field, "allowed": enum_values, "actual": value }),
        ));
    }
    if let Some(expected) = schema.get("type")
        && !schema_type_allows(expected, value)
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value does not match the declared type",
            json!({
                "field": field,
                "expectedType": expected,
                "actualType": json_type_name(value),
            }),
        ));
    }
    if value.is_number() {
        if let Some(minimum) = schema.get("minimum").and_then(Value::as_f64)
            && value.as_f64().is_some_and(|actual| actual < minimum)
        {
            return Err(schema_validation_error(
                manifest,
                field,
                "field value is below minimum",
                json!({ "field": field, "minimum": minimum, "actual": value }),
            ));
        }
        if let Some(maximum) = schema.get("maximum").and_then(Value::as_f64)
            && value.as_f64().is_some_and(|actual| actual > maximum)
        {
            return Err(schema_validation_error(
                manifest,
                field,
                "field value is above maximum",
                json!({ "field": field, "maximum": maximum, "actual": value }),
            ));
        }
    }
    if let (Some(items), Some(values)) = (schema.get("items"), value.as_array()) {
        for (index, item) in values.iter().enumerate() {
            validate_value_against_schema(manifest, &format!("{field}[{index}]"), item, items)?;
        }
    }
    Ok(())
}

fn schema_type_allows(expected: &Value, value: &Value) -> bool {
    match expected {
        Value::String(expected) => single_schema_type_allows(expected, value),
        Value::Array(expected) => expected
            .iter()
            .filter_map(Value::as_str)
            .any(|expected| single_schema_type_allows(expected, value)),
        _ => true,
    }
}

fn single_schema_type_allows(expected: &str, value: &Value) -> bool {
    match expected {
        "array" => value.is_array(),
        "boolean" => value.is_boolean(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "number" => value.is_number(),
        "null" => value.is_null(),
        "object" => value.is_object(),
        "string" => value.is_string(),
        _ => true,
    }
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Array(_) => "array",
        Value::Bool(_) => "boolean",
        Value::Null => "null",
        Value::Number(_) => "number",
        Value::Object(_) => "object",
        Value::String(_) => "string",
    }
}

fn schema_validation_error(
    manifest: &ToolManifest,
    field: &str,
    message: &str,
    detail: Value,
) -> ToolFsError {
    ToolFsError::new(
        "invalid_tool_args",
        format!("Tool-FS args field `{field}` is invalid: {message}."),
        "Inspect the target tool and retry with args matching inputSchema.",
    )
    .with_detail(json!({
        "toolPath": manifest.path,
        "schemaError": detail,
    }))
}

fn signal_kind_matches<const N: usize>(signals: &ToolSceneSignals, needles: [&str; N]) -> bool {
    [&signals.active_tab_kind, &signals.focused_tab_kind]
        .into_iter()
        .filter_map(|value| value.as_deref())
        .map(str::to_ascii_lowercase)
        .any(|value| needles.iter().any(|needle| value.contains(needle)))
}

pub fn new_operation_envelope(
    manifest: &ToolManifest,
    args: Value,
    requested_handle: Option<String>,
    context: ToolOperationContext,
) -> ToolOperationEnvelope {
    let op_id = format!("tool-op-{}", Uuid::new_v4());
    ToolOperationEnvelope {
        schema_version: TOOL_FS_SCHEMA_VERSION,
        op_id: op_id.clone(),
        session_id: context.session_id,
        runtime_turn_id: context.turn_id,
        op: "run".to_string(),
        path: Some(manifest.path.clone()),
        args,
        tool_handle: requested_handle.or_else(|| manifest.handle.clone()),
        policy_snapshot_id: Some("runtime-default".to_string()),
        permission_mode: "runtime_policy".to_string(),
        trace_id: format!("trace-{op_id}"),
        timeout_ms: Some(DEFAULT_TOOL_TIMEOUT_MS),
        risk_context: json!({
            "workingDir": context.working_dir,
            "activeTabId": context.active_tab_id,
            "workspaceId": context.workspace_id,
        }),
        output_contract: json!({
            "kind": manifest.output_kind,
            "activityKind": manifest.activity_kind,
            "rendererHint": manifest.renderer_hint,
        }),
        created_at: String::new(),
    }
}

fn dedupe_manifests(manifests: &mut Vec<ToolManifest>) {
    let mut seen_paths = HashSet::new();
    let mut seen_handles = HashSet::new();
    manifests.retain(|manifest| {
        if !seen_paths.insert(manifest.path.clone()) {
            return false;
        }
        if let Some(handle) = &manifest.handle
            && !seen_handles.insert(handle.clone())
        {
            return false;
        }
        true
    });
}

fn builtin_manifests() -> Vec<ToolManifest> {
    let mut entries = vec![
        s(
            "/tools/runtime/artifact_read",
            "runtime",
            "read",
            "Read artifact",
            "Read a Lyra-owned artifact.",
            Some("artifact_read"),
        ),
        s(
            "/tools/memory/search",
            "memory",
            "search",
            "Search memory",
            "Search Lyra long-term shared memory.",
            Some("memory_search"),
        ),
        s(
            "/tools/memory/remember",
            "memory",
            "remember",
            "Remember",
            "Write a durable Lyra memory.",
            None,
        ),
        s(
            "/tools/memory/update",
            "memory",
            "update",
            "Update memory",
            "Update an existing memory record.",
            None,
        ),
        s(
            "/tools/memory/forget",
            "memory",
            "forget",
            "Forget memory",
            "Archive or delete a memory record.",
            None,
        ),
        s(
            "/tools/memory/list",
            "memory",
            "list",
            "List memory",
            "List memory summaries.",
            None,
        ),
        s(
            "/tools/memory/link",
            "memory",
            "link",
            "Link memory",
            "Create a memory relation.",
            None,
        ),
        s(
            "/tools/memory/review_candidates",
            "memory",
            "review_candidates",
            "Review memory candidates",
            "Review pending memory candidates.",
            None,
        ),
        s(
            "/tools/memory/apply_candidate",
            "memory",
            "apply_candidate",
            "Apply memory candidate",
            "Apply a memory candidate.",
            None,
        ),
        s(
            "/tools/memory/reject_candidate",
            "memory",
            "reject_candidate",
            "Reject memory candidate",
            "Reject a memory candidate.",
            None,
        ),
        s(
            "/tools/memory/explain_injection",
            "memory",
            "explain_injection",
            "Explain memory injection",
            "Explain injected memories.",
            None,
        ),
        s(
            "/tools/clarification/ask",
            "clarification",
            "ask",
            "Ask user",
            "Ask a structured clarification question.",
            Some("ask_user"),
        ),
        s(
            "/tools/workbench/list_tabs",
            "workbench",
            "list_tabs",
            "List workbench tabs",
            "List Lyra workbench tabs.",
            Some("workbench_list_tabs"),
        ),
        s(
            "/tools/workbench/read_workspace",
            "workbench",
            "read_workspace",
            "Read workspace",
            "Read visible workspace state.",
            Some("workbench_read_workspace"),
        ),
        s(
            "/tools/workbench/read_tab",
            "workbench",
            "read_tab",
            "Read workbench tab",
            "Read one Lyra workbench tab.",
            Some("workbench_read_tab"),
        ),
        s(
            "/tools/workbench/activate_tab",
            "workbench",
            "activate_tab",
            "Activate workbench tab",
            "Activate one Lyra workbench tab.",
            None,
        ),
        s(
            "/tools/software/list_capabilities",
            "software",
            "list_capabilities",
            "List software capabilities",
            "List installed software adapters.",
            None,
        ),
        s(
            "/tools/software/inspect_capability",
            "software",
            "inspect_capability",
            "Inspect software capability",
            "Inspect a software adapter capability.",
            None,
        ),
        s(
            "/tools/software/read_state",
            "software",
            "read_state",
            "Read software state",
            "Read lightweight software state.",
            None,
        ),
        s(
            "/tools/software/invoke_capability",
            "software",
            "invoke_capability",
            "Invoke software capability",
            "Invoke a software adapter capability.",
            None,
        ),
        s(
            "/tools/browser/map",
            "browser",
            "map",
            "Map browser page",
            "Map actionable browser elements.",
            Some("browser_map"),
        ),
        s(
            "/tools/browser/read",
            "browser",
            "read",
            "Read browser page",
            "Read text from a browser page.",
            Some("browser_read"),
        ),
        s(
            "/tools/browser/see",
            "browser",
            "see",
            "See browser page",
            "Capture a visual browser snapshot.",
            None,
        ),
        s(
            "/tools/browser/act",
            "browser",
            "act",
            "Act in browser",
            "Click or hover a browser target.",
            None,
        ),
        s(
            "/tools/browser/type",
            "browser",
            "type",
            "Type in browser",
            "Type text into a browser target.",
            None,
        ),
        s(
            "/tools/browser/press",
            "browser",
            "press",
            "Press browser key",
            "Press a browser keyboard key.",
            None,
        ),
        s(
            "/tools/browser/submit",
            "browser",
            "submit",
            "Submit browser control",
            "Submit focused browser control.",
            None,
        ),
        s(
            "/tools/browser/wait",
            "browser",
            "wait",
            "Wait browser",
            "Wait for browser page state.",
            None,
        ),
        s(
            "/tools/browser/read_until",
            "browser",
            "read_until",
            "Read browser until",
            "Wait and read browser text.",
            None,
        ),
        s(
            "/tools/browser/navigate",
            "browser",
            "navigate",
            "Navigate browser",
            "Navigate a browser page.",
            None,
        ),
        s(
            "/tools/browser/reveal",
            "browser",
            "reveal",
            "Reveal browser target",
            "Reveal a browser target.",
            None,
        ),
        s(
            "/tools/browser/focus_scan",
            "browser",
            "focus_scan",
            "Focus scan browser",
            "Scan focusable browser targets.",
            None,
        ),
        s(
            "/tools/browser/follow_audit",
            "browser",
            "follow_audit",
            "Audit browser Follow",
            "Audit browser follow state.",
            None,
        ),
        s(
            "/tools/browser/explain_target",
            "browser",
            "explain_target",
            "Explain browser target",
            "Explain a browser target reference.",
            None,
        ),
        s(
            "/tools/browser/audit",
            "browser",
            "audit",
            "Audit browser",
            "Audit browser state.",
            None,
        ),
        s(
            "/tools/browser/elevate",
            "browser",
            "elevate",
            "Elevate browser task",
            "Elevate an isolated browser task.",
            None,
        ),
        s(
            "/tools/filesystem/list_files",
            "filesystem",
            "list",
            "List files",
            "List workspace directory entries.",
            Some("list_files"),
        ),
        s(
            "/tools/filesystem/read_file",
            "filesystem",
            "read",
            "Read file",
            "Read a workspace file.",
            Some("read_file"),
        ),
        s(
            "/tools/filesystem/read_range",
            "filesystem",
            "read",
            "Read file range",
            "Read a line range from a workspace file.",
            Some("read_range"),
        ),
        s(
            "/tools/filesystem/glob",
            "filesystem",
            "glob",
            "Glob files",
            "Find files by glob.",
            Some("find_files"),
        ),
        s(
            "/tools/filesystem/write_file",
            "filesystem",
            "write",
            "Write file",
            "Write a workspace file.",
            None,
        ),
        s(
            "/tools/filesystem/edit_file",
            "filesystem",
            "edit",
            "Edit file",
            "Replace text in a workspace file.",
            None,
        ),
        s(
            "/tools/filesystem/multi_edit",
            "filesystem",
            "multiedit",
            "Multi-edit file",
            "Apply multiple exact replacements.",
            None,
        ),
        s(
            "/tools/filesystem/apply_patch",
            "filesystem",
            "apply_patch",
            "Apply patch",
            "Apply structured workspace patch operations.",
            Some("apply_patch"),
        ),
        s(
            "/tools/code/search_project",
            "code",
            "project",
            "Search project",
            "Search workspace files and content.",
            None,
        ),
        s(
            "/tools/code/search_code",
            "code",
            "search_text",
            "Search code",
            "Search code text with structured snippets.",
            Some("search_code"),
        ),
        s(
            "/tools/code/search_symbol",
            "code",
            "search_symbol",
            "Search symbols",
            "Search source symbols.",
            Some("search_symbol"),
        ),
        s(
            "/tools/code/graph_expand",
            "code",
            "graph_expand",
            "Expand code graph",
            "Expand imports and related code.",
            None,
        ),
        s(
            "/tools/code/lsp_query",
            "code",
            "query",
            "Query LSP",
            "Query language server diagnostics or symbols.",
            Some("diagnostics"),
        ),
        s(
            "/tools/shell/run_command",
            "shell",
            "run",
            "Run command",
            "Run a bounded shell command.",
            Some("run_command"),
        ),
        s(
            "/tools/git/status",
            "git",
            "status",
            "Git status",
            "Read Git repository status.",
            Some("git_status"),
        ),
        s(
            "/tools/git/diff",
            "git",
            "diff",
            "Git diff",
            "Read Git diff for a changed file.",
            Some("git_diff"),
        ),
        s(
            "/tools/git/stage",
            "git",
            "stage",
            "Git stage",
            "Stage a Git file.",
            None,
        ),
        s(
            "/tools/git/unstage",
            "git",
            "unstage",
            "Git unstage",
            "Unstage a Git file.",
            None,
        ),
        s(
            "/tools/git/discard",
            "git",
            "discard",
            "Git discard",
            "Discard a changed file.",
            None,
        ),
        s(
            "/tools/git/log",
            "git",
            "log",
            "Git log",
            "Read recent Git commits.",
            Some("git_log"),
        ),
        s(
            "/tools/git/show",
            "git",
            "show",
            "Git show",
            "Show a Git object or commit.",
            Some("git_show"),
        ),
        s(
            "/tools/git/branch",
            "git",
            "branch",
            "Git branch",
            "Read current Git branch state.",
            Some("git_branch"),
        ),
        s(
            "/tools/network/status",
            "network",
            "status",
            "Network status",
            "Read native network status.",
            None,
        ),
        s(
            "/tools/web/search",
            "web",
            "search",
            "Web search",
            "Search the web.",
            Some("web_search"),
        ),
        s(
            "/tools/web/fetch",
            "web",
            "fetch",
            "Fetch URL",
            "Fetch a web URL.",
            Some("web_fetch"),
        ),
        s(
            "/tools/render/surface",
            "render",
            "surface",
            "Render surface",
            "Create an inline render surface.",
            Some("render_surface"),
        ),
        s(
            "/tools/todo/read",
            "todo",
            "read",
            "Read todos",
            "Read active Lyra todos.",
            Some("todo_read"),
        ),
        s(
            "/tools/todo/write",
            "todo",
            "write",
            "Write todos",
            "Update active Lyra todos.",
            Some("todo_write"),
        ),
        s(
            "/tools/design/search_styles",
            "design",
            "search_styles",
            "Search design styles",
            "Search Lyra design references.",
            Some("design_search_styles"),
        ),
        s(
            "/tools/design/get_style_details",
            "design",
            "get_style_details",
            "Get design style details",
            "Read one design reference.",
            Some("design_get_style_details"),
        ),
        s(
            "/tools/skills/list",
            "skills",
            "list",
            "List skills",
            "List installed Lyra skills.",
            Some("skill_list"),
        ),
        s(
            "/tools/skills/inspect",
            "skills",
            "inspect",
            "Inspect skill",
            "Inspect one Lyra skill.",
            None,
        ),
        s(
            "/tools/skills/activate",
            "skills",
            "activate",
            "Activate skill",
            "Activate one Lyra skill.",
            None,
        ),
        s(
            "/tools/skills/deactivate",
            "skills",
            "deactivate",
            "Deactivate skill",
            "Deactivate one Lyra skill.",
            None,
        ),
        s(
            "/tools/mcp/server_list",
            "mcp",
            "server_list",
            "List MCP servers",
            "List configured MCP servers.",
            Some("mcp_server_list"),
        ),
        s(
            "/tools/mcp/server_connect",
            "mcp",
            "server_connect",
            "Connect MCP server",
            "Connect an MCP server.",
            None,
        ),
        s(
            "/tools/mcp/server_disconnect",
            "mcp",
            "server_disconnect",
            "Disconnect MCP server",
            "Disconnect an MCP server.",
            None,
        ),
        s(
            "/tools/mcp/server_reload",
            "mcp",
            "server_reload",
            "Reload MCP server",
            "Reload an MCP server.",
            None,
        ),
        s(
            "/tools/mcp/tool_discover",
            "mcp",
            "tool_discover",
            "Discover MCP tools",
            "Search MCP tool manifests.",
            Some("mcp_tool_discover"),
        ),
        s(
            "/tools/mcp/tool_inspect",
            "mcp",
            "tool_inspect",
            "Inspect MCP tool",
            "Inspect one MCP tool schema.",
            None,
        ),
        s(
            "/tools/mcp/tool_execute",
            "mcp",
            "tool_execute",
            "Execute MCP tool",
            "Execute one MCP tool.",
            None,
        ),
    ];
    entries.extend(terminal_manifests());
    dedupe_manifests(&mut entries);
    entries
}

fn terminal_manifests() -> Vec<ToolManifest> {
    [
        ("list", "List terminal sessions", Some("terminal_list")),
        ("create", "Create terminal session", None),
        ("read", "Read terminal output", Some("terminal_read")),
        ("screen", "Read terminal screen", Some("terminal_screen")),
        ("wait", "Wait terminal", Some("terminal_wait")),
        ("write", "Write terminal input", None),
        ("close", "Close terminal session", None),
        ("events", "Read terminal events", None),
        ("read_until", "Read terminal until", None),
        ("run", "Run terminal command", Some("terminal_run")),
        ("input", "Submit terminal input", Some("terminal_input")),
        ("keys", "Press terminal keys", None),
        ("resize", "Resize terminal", None),
        ("signal", "Signal terminal process", None),
        ("processes", "Read terminal processes", None),
        ("command_status", "Read command status", None),
        ("map", "Map terminal screen", None),
        ("act", "Act in terminal UI", None),
        ("attach_agent", "Attach terminal agent", None),
        ("detach_agent", "Detach terminal agent", None),
    ]
    .into_iter()
    .map(|(operation, title, handle)| {
        s(
            &format!("/tools/terminal/{operation}"),
            "terminal",
            operation,
            title,
            title,
            handle,
        )
    })
    .collect()
}

fn s(
    path: &str,
    domain: &str,
    operation: &str,
    title: &str,
    summary: &str,
    handle: Option<&str>,
) -> ToolManifest {
    ToolManifest {
        path: path.to_string(),
        handle: handle.map(str::to_string),
        domain: domain.to_string(),
        operation: operation.to_string(),
        title: title.to_string(),
        summary: summary.to_string(),
        risk_level: risk_level(domain, operation).to_string(),
        permission_policy: permission_policy(domain, operation).to_string(),
        input_schema: input_schema_for(path, domain, operation),
        output_kind: output_kind(domain, operation).to_string(),
        activity_kind: activity_kind(domain, operation).to_string(),
        renderer_hint: renderer_hint(domain, operation).to_string(),
    }
}

fn risk_level(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("filesystem", "write" | "edit" | "multiedit" | "apply_patch") => "file",
        ("shell", "run") => "shell",
        ("terminal", "run" | "write" | "input" | "keys" | "resize" | "signal" | "act") => {
            "terminal"
        }
        ("git", "stage" | "unstage" | "discard") => "git_mutation",
        ("browser", "act" | "type" | "press" | "submit" | "navigate" | "elevate") => "browser",
        (
            "memory",
            "remember" | "update" | "forget" | "link" | "apply_candidate" | "reject_candidate",
        ) => "memory_mutation",
        ("todo", "write") => "mutation",
        ("skills", "activate" | "deactivate") => "runtime_mutation",
        ("mcp", "server_connect" | "server_disconnect" | "server_reload" | "tool_execute") => {
            "external"
        }
        ("software", "invoke_capability") => "external",
        _ => "read",
    }
}

fn permission_policy(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("filesystem", "write" | "edit" | "multiedit" | "apply_patch")
        | ("shell", "run")
        | ("git", "stage" | "unstage" | "discard")
        | ("browser", "elevate") => "ask_on_risk",
        ("software", "invoke_capability") | ("mcp", "tool_execute") => "host_policy",
        _ => "runtime_policy",
    }
}

fn output_kind(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("filesystem", "read") => "text",
        ("browser", "see") => "artifact",
        ("render", _) => "render",
        _ => "json",
    }
}

fn activity_kind(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("filesystem", "write" | "edit" | "multiedit" | "apply_patch") => "edit",
        ("filesystem", _) => "read",
        ("code", _) => "search",
        ("shell", _) => "shell",
        ("terminal", _) => "terminal",
        ("browser", _) | ("web", _) => "web",
        ("workbench", _) => "workbench",
        ("render", _) => "render",
        ("todo", _) => "task",
        ("git", _) => "git",
        _ => "task",
    }
}

fn renderer_hint(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("browser", _) => "lumen",
        ("filesystem", "write" | "edit" | "multiedit" | "apply_patch") => "edit",
        ("filesystem", _) => "read",
        ("code", _) => "search",
        ("git", _) => "git",
        _ => activity_kind(domain, operation),
    }
}

fn input_schema_for(path: &str, domain: &str, operation: &str) -> Value {
    let string = |description: &str| json!({ "type": "string", "description": description });
    let working_dir = json!({
        "type": "string",
        "description": "Defaults to the current Lyra session workingDir when available."
    });
    match (domain, operation) {
        ("runtime", "read") => object_schema(
            [
                ("artifactId", string("Lyra artifact id.")),
                ("path", string("Artifact path.")),
            ],
            &[],
        ),
        ("filesystem", "list") => object_schema(
            [
                ("path", string("Workspace path.")),
                ("recursive", json!({ "type": "boolean", "default": false })),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 1000 }),
                ),
            ],
            &[],
        ),
        ("filesystem", "read") if path.ends_with("/read_range") => object_schema(
            [
                ("path", string("Workspace file path.")),
                ("startLine", json!({ "type": "integer", "minimum": 1 })),
                ("endLine", json!({ "type": "integer", "minimum": 1 })),
            ],
            &["path"],
        ),
        ("filesystem", "read") => object_schema(
            [
                ("path", string("Workspace file path.")),
                ("startLine", json!({ "type": "integer", "minimum": 1 })),
                ("endLine", json!({ "type": "integer", "minimum": 1 })),
                ("maxBytes", json!({ "type": "integer", "minimum": 1 })),
            ],
            &["path"],
        ),
        ("filesystem", "glob") => object_schema(
            [
                ("pattern", string("Glob pattern.")),
                ("path", string("Optional workspace directory.")),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 1000 }),
                ),
            ],
            &["pattern"],
        ),
        ("filesystem", "write") => object_schema(
            [
                ("path", string("Workspace file path.")),
                ("content", string("New file content.")),
                ("overwrite", json!({ "type": "boolean", "default": false })),
            ],
            &["path", "content"],
        ),
        ("filesystem", "edit") => object_schema(
            [
                ("path", string("Workspace file path.")),
                ("oldString", string("Exact text to replace.")),
                ("newString", string("Replacement text.")),
            ],
            &["path", "oldString", "newString"],
        ),
        ("filesystem", "multiedit") => object_schema(
            [
                ("path", string("Workspace file path.")),
                (
                    "edits",
                    json!({ "type": "array", "items": { "type": "object" } }),
                ),
            ],
            &["path", "edits"],
        ),
        ("filesystem", "apply_patch") => object_schema(
            [
                (
                    "operations",
                    json!({ "type": "array", "items": { "type": "object" } }),
                ),
                ("patch", string("Unified or structured patch text.")),
            ],
            &[],
        ),
        ("code", _) => object_schema(
            [
                ("query", string("Search query.")),
                ("path", string("Optional workspace path.")),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 200 }),
                ),
            ],
            if operation == "graph_expand" {
                &[]
            } else {
                &["query"]
            },
        ),
        ("shell", "run") => object_schema(
            [
                ("command", string("Command to run.")),
                ("workingDir", working_dir.clone()),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &["command"],
        ),
        ("git", "status" | "branch") => object_schema([("workingDir", working_dir.clone())], &[]),
        ("git", "diff") => object_schema(
            [
                ("workingDir", working_dir.clone()),
                ("path", string("Changed file path.")),
                (
                    "scope",
                    json!({ "type": "string", "enum": ["auto", "unstaged", "staged"], "default": "auto" }),
                ),
            ],
            &["path"],
        ),
        ("git", "stage" | "unstage" | "discard") => object_schema(
            [
                ("workingDir", working_dir.clone()),
                ("path", string("Changed file path.")),
            ],
            &["path"],
        ),
        ("git", "log") => object_schema(
            [
                ("workingDir", working_dir.clone()),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 100, "default": 20 }),
                ),
            ],
            &[],
        ),
        ("git", "show") => object_schema(
            [
                ("workingDir", working_dir.clone()),
                ("ref", json!({ "type": "string", "default": "HEAD" })),
            ],
            &[],
        ),
        ("browser", _) => object_schema(
            [
                ("tabId", string("Lyra browser tab id.")),
                (
                    "targetMode",
                    json!({ "type": "string", "enum": ["live", "isolated"], "default": "live" }),
                ),
                ("targetRef", string("Lumen target reference.")),
                ("elementId", json!({ "type": ["integer", "string"] })),
                ("text", string("Text for type operations.")),
                ("url", string("URL for navigate operations.")),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &[],
        ),
        ("terminal", "run") => object_schema(
            [
                ("command", string("Terminal command.")),
                ("sessionId", string("Terminal session id.")),
                ("cwd", string("Working directory.")),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &["command"],
        ),
        ("terminal", _) => object_schema(
            [
                ("sessionId", string("Terminal session id.")),
                ("input", string("Terminal input.")),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
            ],
            &[],
        ),
        ("web", "search") => object_schema(
            [
                ("query", string("Web search query.")),
                (
                    "limit",
                    json!({ "type": "integer", "minimum": 1, "maximum": 20 }),
                ),
            ],
            &["query"],
        ),
        ("web", "fetch") => object_schema([("url", string("URL to fetch."))], &["url"]),
        ("todo", "write") => object_schema(
            [(
                "todos",
                json!({ "type": "array", "items": { "type": "object" } }),
            )],
            &["todos"],
        ),
        ("memory", "remember") => object_schema([("fact", string("Fact to remember."))], &["fact"]),
        ("clarification", "ask") => object_schema(
            [
                ("question", string("Question to ask the user.")),
                ("options", json!({ "type": "array" })),
                (
                    "allowCustomAnswer",
                    json!({ "type": "boolean", "default": true }),
                ),
            ],
            &["question"],
        ),
        ("software", "inspect_capability" | "invoke_capability" | "read_state") => object_schema(
            [
                ("softwareId", string("Software adapter id.")),
                ("capabilityId", string("Capability id.")),
                (
                    "input",
                    json!({ "type": "object", "additionalProperties": true }),
                ),
            ],
            &[],
        ),
        _ => json!({ "type": "object", "properties": {} }),
    }
}

fn object_schema<const N: usize>(properties: [(&str, Value); N], required: &[&str]) -> Value {
    let mut map = BTreeMap::new();
    for (key, value) in properties {
        map.insert(key.to_string(), value);
    }
    let mut schema = json!({
        "type": "object",
        "properties": map,
    });
    if !required.is_empty() {
        schema["required"] = Value::Array(
            required
                .iter()
                .map(|key| Value::String((*key).to_string()))
                .collect(),
        );
    }
    schema
}

pub fn domain_summary(domain: &str) -> &'static str {
    match domain {
        "runtime" => "Runtime and artifact utilities.",
        "memory" => "Lyra long-term memory search and mutation tools.",
        "clarification" => "Structured user clarification through the Lyra decision panel.",
        "workbench" => "Read and operate Lyra workspace tabs and workspace state.",
        "software" => "Inspect and invoke installed Lyra software adapters.",
        "browser" => "Operate Lyra browser/Lumen pages with DOM, target, visual, and wait tools.",
        "filesystem" => "List, read, write, edit, and patch files in the bound workspace.",
        "code" => "Search code text, symbols, code graph, and LSP data.",
        "shell" => "Run bounded shell commands in the bound workspace.",
        "terminal" => "Control Lyra terminal sessions and terminal panes.",
        "git" => "Inspect and mutate Git repository state for the bound project.",
        "network" => "Inspect native network status.",
        "web" => "Fetch and search web resources through native network tools.",
        "render" => "Create inline render surfaces in the chat timeline.",
        "todo" => "Read and update Lyra task todos.",
        "design" => "Use Lyra design reference tools.",
        "skills" => "List, inspect, activate, and deactivate Lyra skills.",
        "mcp" => "Discover and manage MCP servers and MCP tools.",
        _ => "Lyra tool directory.",
    }
}

fn scene_domain_order(scene: ToolScene) -> Vec<&'static str> {
    match scene {
        ToolScene::ProjectCode => vec!["filesystem", "code", "shell", "git", "terminal"],
        ToolScene::Git => vec!["git", "filesystem", "code", "shell", "terminal"],
        ToolScene::Terminal => vec!["terminal", "shell", "filesystem", "code", "git"],
        ToolScene::Browser => vec!["browser", "workbench", "web", "filesystem", "code"],
        ToolScene::Workbench => vec!["workbench", "browser", "filesystem", "todo"],
        ToolScene::Design => vec!["design", "filesystem", "code", "browser", "web"],
        ToolScene::Automation => vec!["todo", "shell", "terminal", "software", "workbench"],
        ToolScene::General => vec!["workbench", "browser", "memory", "todo", "filesystem"],
    }
}

fn pinned_handle_names(scene: ToolScene) -> Vec<&'static str> {
    match scene {
        ToolScene::ProjectCode => vec![
            "read_file",
            "find_files",
            "search_code",
            "search_symbol",
            "apply_patch",
            "run_command",
        ],
        ToolScene::Git => vec![
            "read_file",
            "search_code",
            "apply_patch",
            "run_command",
            "git_status",
            "git_diff",
            "git_log",
        ],
        ToolScene::Terminal => vec![
            "terminal_list",
            "terminal_read",
            "terminal_run",
            "terminal_wait",
        ],
        ToolScene::Browser => vec![
            "workbench_list_tabs",
            "browser_map",
            "browser_read",
            "web_search",
        ],
        ToolScene::Workbench => vec![
            "workbench_list_tabs",
            "workbench_read_workspace",
            "workbench_read_tab",
        ],
        ToolScene::Design => vec![
            "design_search_styles",
            "design_get_style_details",
            "read_file",
        ],
        ToolScene::Automation => vec!["todo_read", "todo_write", "run_command", "terminal_run"],
        ToolScene::General => vec![
            "workbench_list_tabs",
            "workbench_read_workspace",
            "memory_search",
            "todo_read",
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_lists_root_and_pages_domain_tools() {
        let registry = ToolFsRegistry::default();
        let root = registry
            .list("/tools", 0, 80, ToolScene::General)
            .expect("root");
        assert_eq!(root.path, "/tools");
        assert!(
            root.directories
                .iter()
                .any(|entry| entry.name == "filesystem")
        );
        assert!(root.directories.iter().any(|entry| entry.name == "git"));

        let files = registry
            .list("/tools/filesystem", 0, 2, ToolScene::ProjectCode)
            .expect("filesystem");
        assert_eq!(files.page_size, 2);
        assert_eq!(files.tools.len(), 2);
        assert!(files.has_more);
    }

    #[test]
    fn registry_reads_docs_and_inspects_path_and_handle() {
        let registry = ToolFsRegistry::default();
        let root_doc = registry.read_doc("/tools").expect("root doc");
        assert_eq!(root_doc["kind"], "tool_fs_doc");

        let by_path = registry
            .inspect_path("/tools/filesystem/read_file")
            .expect("path");
        assert_eq!(by_path.handle.as_deref(), Some("read_file"));
        assert_eq!(by_path.input_schema["type"], "object");

        let by_handle = registry.inspect_handle("run_command").expect("handle");
        assert_eq!(by_handle.path, "/tools/shell/run_command");
    }

    #[test]
    fn manifest_projection_does_not_expose_legacy_name() {
        let registry = ToolFsRegistry::default();
        let manifest = registry
            .inspect_path("/tools/filesystem/read_file")
            .expect("manifest");
        let json = serde_json::to_value(manifest).expect("manifest json");
        let legacy_field = ["legacy", "Name"].join("");
        assert!(json.get(&legacy_field).is_none());
        assert!(json.get("inputSchema").is_some());
        assert!(json.get("handle").is_some());
    }

    #[test]
    fn run_input_validation_is_structured() {
        let registry = ToolFsRegistry::default();
        assert_eq!(
            registry
                .resolve_run_input(&json!({ "args": {} }))
                .unwrap_err()
                .code,
            "tool_target_required"
        );
        assert_eq!(
            registry
                .resolve_run_input(&json!({ "path": "/tools/missing", "args": {} }))
                .unwrap_err()
                .code,
            "tool_not_found"
        );
        assert_eq!(
            registry
                .resolve_run_input(&json!({ "toolHandle": "read_file", "args": [] }))
                .unwrap_err()
                .code,
            "invalid_tool_args"
        );
        let resolved = registry
            .resolve_run_input(&json!({
                "toolHandle": "read_file",
                "args": { "path": "README.md" }
            }))
            .expect("resolved");
        assert_eq!(resolved.manifest.path, "/tools/filesystem/read_file");
        assert_eq!(
            registry
                .resolve_run_input(&json!({
                    "path": "/tools/filesystem/read_file",
                    "toolHandle": "find_files",
                    "args": { "path": "README.md" }
                }))
                .unwrap_err()
                .code,
            "ambiguous_tool_target"
        );
    }

    #[test]
    fn operation_envelope_validator_checks_runtime_and_args() {
        let registry = ToolFsRegistry::default();
        let manifest = registry
            .inspect_path("/tools/filesystem/read_file")
            .expect("manifest");
        let mut envelope = new_operation_envelope(
            &manifest,
            json!({ "path": "README.md" }),
            None,
            ToolOperationContext {
                session_id: "session-1".to_string(),
                turn_id: "turn-1".to_string(),
                ..ToolOperationContext::default()
            },
        );
        envelope.created_at = "2026-06-05T00:00:00.000Z".to_string();
        assert_eq!(
            envelope
                .validate(&registry)
                .expect("validated")
                .unwrap()
                .path,
            "/tools/filesystem/read_file"
        );

        let mut missing_turn = envelope.clone();
        missing_turn.runtime_turn_id.clear();
        assert_eq!(
            missing_turn.validate(&registry).unwrap_err().code,
            "missing_runtime_turn"
        );

        let mut missing_policy = envelope.clone();
        missing_policy.policy_snapshot_id = None;
        assert_eq!(
            missing_policy.validate(&registry).unwrap_err().code,
            "missing_policy_snapshot"
        );

        let mut missing_args = envelope.clone();
        missing_args.args = json!({});
        assert_eq!(
            missing_args.validate(&registry).unwrap_err().code,
            "invalid_tool_args"
        );

        let mut wrong_type = envelope.clone();
        wrong_type.args = json!({ "path": 42 });
        let wrong_type_error = wrong_type.validate(&registry).unwrap_err();
        assert_eq!(wrong_type_error.code, "invalid_tool_args");
        assert_eq!(
            wrong_type_error
                .detail
                .as_ref()
                .and_then(|detail| detail.pointer("/schemaError/field"))
                .and_then(Value::as_str),
            Some("path")
        );

        let mut mismatched_handle = envelope.clone();
        mismatched_handle.tool_handle = Some("find_files".to_string());
        assert_eq!(
            mismatched_handle.validate(&registry).unwrap_err().code,
            "ambiguous_tool_target"
        );

        let mut cancelled = envelope;
        cancelled.risk_context = json!({ "cancellationRequested": true });
        assert_eq!(
            cancelled.validate(&registry).unwrap_err().code,
            "operation_cancelled"
        );
    }

    #[test]
    fn result_trace_and_change_records_expose_document_fields() {
        let change = ToolChangeRecord {
            schema_version: TOOL_FS_SCHEMA_VERSION,
            change_id: "change-1".to_string(),
            kind: "file".to_string(),
            operation: "write".to_string(),
            path: Some("README.md".to_string()),
            summary: "Updated README.md.".to_string(),
            detail: json!({ "path": "README.md" }),
            reversible: true,
            before_ref: None,
            after_ref: None,
            diff_ref: Some(json!({ "id": "artifact-diff" })),
        };
        let trace = ToolTraceRecord::new(
            "trace-1",
            "op-1",
            "turn-1",
            Some("/tools/filesystem/write_file".to_string()),
            "completed",
            "completed",
            None,
            json!({}),
            "2026-06-05T00:00:00.000Z",
        );
        let result = ToolResultEnvelope {
            schema_version: TOOL_FS_SCHEMA_VERSION,
            status: "completed".to_string(),
            runtime_turn_id: "turn-1".to_string(),
            duration_ms: 3,
            trace_id: "trace-1".to_string(),
            ok: true,
            content: "ok".to_string(),
            raw: json!({ "ok": true }),
            tool_path: "/tools/filesystem/write_file".to_string(),
            domain: "filesystem".to_string(),
            operation: "write".to_string(),
            artifacts: vec![json!({ "id": "artifact-diff" })],
            artifact_refs: vec![json!({ "id": "artifact-diff" })],
            projection_ref: None,
            data_ref: None,
            stdout_ref: None,
            stderr_ref: None,
            changes: vec![change],
            error: None,
            not_run_reason: None,
        };
        let result_json = serde_json::to_value(result).expect("result json");
        let trace_json = serde_json::to_value(trace).expect("trace json");
        assert_eq!(result_json["schemaVersion"], TOOL_FS_SCHEMA_VERSION);
        assert_eq!(result_json["runtimeTurnId"], "turn-1");
        assert_eq!(result_json["artifactRefs"][0]["id"], "artifact-diff");
        assert_eq!(result_json["changes"][0]["diffRef"]["id"], "artifact-diff");
        assert_eq!(trace_json["traceId"], "trace-1");
    }

    #[test]
    fn scene_package_uses_state_signals() {
        let signals = ToolSceneSignals {
            project_bound: true,
            git_repo: false,
            active_tab_kind: Some("editor".to_string()),
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::ProjectCode);

        let signals = ToolSceneSignals {
            active_skills: vec!["lyra-design-research".to_string()],
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::Design);
    }

    #[test]
    fn pinned_handles_include_manifest_metadata() {
        let registry = ToolFsRegistry::default();
        let handles = registry.pinned_handles(ToolScene::Git);
        assert!(handles.iter().any(|handle| handle.handle == "git_status"));
        assert!(
            handles
                .iter()
                .any(|handle| handle.path == "/tools/git/diff")
        );
    }
}
