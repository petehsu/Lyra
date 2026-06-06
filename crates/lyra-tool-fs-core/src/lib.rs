use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};
use thiserror::Error;
use uuid::Uuid;

pub const TOOL_FS_SEARCH: &str = "tool_fs_search";
pub const TOOL_FS_LIST: &str = "tool_fs_list";
pub const TOOL_FS_READ_DOC: &str = "tool_fs_read_doc";
pub const TOOL_FS_INSPECT: &str = "tool_fs_inspect";
pub const TOOL_FS_RUN: &str = "tool_fs_run";
pub const PROVIDER_VISIBLE_TOOL_NAMES: [&str; 5] = [
    TOOL_FS_SEARCH,
    TOOL_FS_LIST,
    TOOL_FS_READ_DOC,
    TOOL_FS_INSPECT,
    TOOL_FS_RUN,
];
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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub description: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub examples: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
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
pub struct ToolSearchResponse {
    pub kind: String,
    pub query: String,
    pub scene: String,
    pub domain: Option<String>,
    pub results: Vec<ToolSearchResult>,
    pub total: usize,
    pub page: usize,
    pub page_size: usize,
    pub has_more: bool,
    pub fallback_list_path: String,
    pub recommended_next_action: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolSearchResult {
    pub path: String,
    pub handle: Option<String>,
    pub title: String,
    pub domain: String,
    pub operation: String,
    pub summary: String,
    pub score: f64,
    pub matched_fields: Vec<String>,
    pub match_reason: String,
    pub recommended_next_action: String,
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
        let manifests = builtin_manifests();
        validate_manifest_set(&manifests).expect("built-in Tool-FS manifests must be valid");
        Self { manifests }
    }

    pub fn with_providers(providers: &[&dyn ToolManifestProvider]) -> Self {
        Self::try_with_providers(providers).unwrap_or_else(|_| Self::builtin())
    }

    pub fn try_with_providers(
        providers: &[&dyn ToolManifestProvider],
    ) -> Result<Self, ToolFsError> {
        let mut manifests = builtin_manifests();
        for provider in providers {
            manifests.extend(provider.tool_manifests());
        }
        validate_manifest_set(&manifests)?;
        Ok(Self { manifests })
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

    pub fn search(
        &self,
        query: &str,
        domain: Option<&str>,
        page: usize,
        page_size: usize,
        scene: ToolScene,
    ) -> Result<ToolSearchResponse, ToolFsError> {
        self.search_with_boosts(query, domain, page, page_size, scene, &BTreeMap::new())
    }

    pub fn search_with_boosts(
        &self,
        query: &str,
        domain: Option<&str>,
        page: usize,
        page_size: usize,
        scene: ToolScene,
        usage_boosts: &BTreeMap<String, f64>,
    ) -> Result<ToolSearchResponse, ToolFsError> {
        let query = query.trim();
        if query.is_empty() {
            return Err(ToolFsError::new(
                "invalid_tool_search_query",
                "tool_fs_search query must not be empty.",
                "Describe the task or capability you need, or call tool_fs_list with /tools.",
            ));
        }
        let domain = domain
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.trim_start_matches("/tools/").to_ascii_lowercase());
        let page_size = page_size.clamp(1, 100);
        let mut scored = self
            .manifests
            .iter()
            .filter(|manifest| {
                domain
                    .as_deref()
                    .is_none_or(|domain| manifest.domain == domain)
            })
            .filter_map(|manifest| score_manifest_search(manifest, query, scene, usage_boosts))
            .collect::<Vec<_>>();
        scored.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.manifest.path.cmp(&right.manifest.path))
        });
        let total = scored.len();
        let start = page.saturating_mul(page_size).min(total);
        let end = (start + page_size).min(total);
        let results = scored[start..end]
            .iter()
            .map(|entry| ToolSearchResult {
                path: entry.manifest.path.clone(),
                handle: entry.manifest.handle.clone(),
                title: entry.manifest.title.clone(),
                domain: entry.manifest.domain.clone(),
                operation: entry.manifest.operation.clone(),
                summary: entry.manifest.summary.clone(),
                score: round_score(entry.score),
                matched_fields: entry.matched_fields.clone(),
                match_reason: entry.match_reason.clone(),
                recommended_next_action: "Call tool_fs_inspect for the schema, then tool_fs_run with this path or handle.".to_string(),
            })
            .collect::<Vec<_>>();
        let fallback_list_path = if let Some(domain) = domain.as_deref()
            && self
                .manifests
                .iter()
                .any(|manifest| manifest.domain == domain)
        {
            format!("/tools/{domain}")
        } else {
            best_fallback_list_path(query, &self.manifests, scene)
        };
        let recommended_next_action = if results.is_empty() {
            format!(
                "No strong Tool-FS search result matched. Call tool_fs_list with {fallback_list_path}, then inspect a concrete /tools path."
            )
        } else {
            "Use the highest ranked result when it matches the task; otherwise refine the search query or call tool_fs_list as a fallback.".to_string()
        };
        Ok(ToolSearchResponse {
            kind: "tool_fs_search".to_string(),
            query: query.to_string(),
            scene: scene.as_str().to_string(),
            domain,
            results,
            total,
            page,
            page_size,
            has_more: end < total,
            fallback_list_path,
            recommended_next_action,
        })
    }

    pub fn read_doc(&self, path: &str) -> Result<Value, ToolFsError> {
        let normalized = normalize_tool_path(path);
        if normalized == "/tools" {
            return Ok(json!({
                "kind": "tool_fs_doc",
                "path": "/tools",
                "title": "Lyra Tool Filesystem",
                "content": "Search first with tool_fs_search using a natural-language task description. If search does not find the capability, browse /tools by domain with tool_fs_list, inspect a concrete tool path, then call tool_fs_run with that path or a pinned handle. Provider-visible tools are fixed to tool_fs_search, tool_fs_list, tool_fs_read_doc, tool_fs_inspect, tool_fs_run, and lyra_turn_finish."
            }));
        }
        if let Some(manifest) = self.lookup_path(&normalized) {
            return Ok(json!({
                "kind": "tool_fs_doc",
                "path": manifest.path,
                "title": manifest.title,
                "content": format!("{} {} Input schema is available through tool_fs_inspect.", manifest.summary, manifest.description),
                "aliases": manifest.aliases.clone(),
                "examples": manifest.examples.clone(),
                "tags": manifest.tags.clone(),
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
        self.root_summary_for_scene(ToolScene::General)
    }

    pub fn root_summary_for_scene(&self, scene: ToolScene) -> Value {
        let domains = self.ordered_domains(scene);
        json!({
            "path": "/tools",
            "scene": scene.as_str(),
            "searchAvailable": true,
            "recommendedDiscovery": "Call tool_fs_search first with a natural-language task description; call tool_fs_list only when search needs a directory fallback.",
            "searchExamples": [
                "edit a file",
                "search code text",
                "run a shell command",
                "read browser page",
                "show git diff"
            ],
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

#[derive(Clone, Debug)]
struct ScoredToolManifest {
    manifest: ToolManifest,
    score: f64,
    matched_fields: Vec<String>,
    match_reason: String,
}

fn score_manifest_search(
    manifest: &ToolManifest,
    query: &str,
    scene: ToolScene,
    usage_boosts: &BTreeMap<String, f64>,
) -> Option<ScoredToolManifest> {
    let normalized_query = normalize_search_text(query);
    let query_terms = search_terms(query);
    if normalized_query.is_empty() || query_terms.is_empty() {
        return None;
    }
    let mut score = 0.0_f64;
    let mut matched_fields = Vec::new();
    let mut reasons = Vec::new();
    for field in searchable_manifest_fields(manifest) {
        let field_score = score_search_field(&normalized_query, &query_terms, &field);
        if field_score <= 0.0 {
            continue;
        }
        score += field_score * field.weight;
        if !matched_fields.iter().any(|name| name == field.name) {
            matched_fields.push(field.name.to_string());
        }
        if let Some(reason) = field.reason(field_score) {
            reasons.push(reason);
        }
    }
    if manifest
        .handle
        .as_deref()
        .is_some_and(|handle| normalize_search_text(handle) == normalized_query)
    {
        score += 40.0;
        reasons.push("exact handle match".to_string());
    }
    if normalize_search_text(&manifest.path) == normalized_query {
        score += 42.0;
        reasons.push("exact path match".to_string());
    }
    if score <= 0.0 {
        return None;
    }
    if scene_domain_order(scene)
        .first()
        .is_some_and(|domain| *domain == manifest.domain)
    {
        score += 4.0;
    } else if scene_domain_order(scene)
        .iter()
        .any(|domain| *domain == manifest.domain)
    {
        score += 2.0;
    }
    if let Some(handle) = manifest.handle.as_deref()
        && pinned_handle_names(scene)
            .iter()
            .any(|pinned| *pinned == handle)
    {
        score += 6.0;
    }
    if let Some(boost) = usage_boosts.get(&manifest.path) {
        score += boost.clamp(0.0, 18.0);
        if *boost > 0.0 {
            reasons.push("recent successful usage".to_string());
        }
    }
    if score < 0.5 {
        return None;
    }
    if reasons.is_empty() {
        reasons.push("matched searchable tool metadata".to_string());
    }
    Some(ScoredToolManifest {
        manifest: manifest.clone(),
        score,
        matched_fields,
        match_reason: reasons.join("; "),
    })
}

#[derive(Clone, Debug)]
struct SearchableField {
    name: &'static str,
    text: String,
    weight: f64,
}

impl SearchableField {
    fn reason(&self, score: f64) -> Option<String> {
        if score >= 1.8 {
            Some(format!("strong {} match", self.name))
        } else if score >= 1.0 {
            Some(format!("{} token match", self.name))
        } else if score > 0.0 {
            Some(format!("{} fuzzy match", self.name))
        } else {
            None
        }
    }
}

fn searchable_manifest_fields(manifest: &ToolManifest) -> Vec<SearchableField> {
    vec![
        SearchableField {
            name: "path",
            text: manifest.path.clone(),
            weight: 20.0,
        },
        SearchableField {
            name: "handle",
            text: manifest.handle.clone().unwrap_or_default(),
            weight: 18.0,
        },
        SearchableField {
            name: "title",
            text: manifest.title.clone(),
            weight: 16.0,
        },
        SearchableField {
            name: "aliases",
            text: manifest.aliases.join(" "),
            weight: 14.0,
        },
        SearchableField {
            name: "examples",
            text: manifest.examples.join(" "),
            weight: 12.0,
        },
        SearchableField {
            name: "summary",
            text: manifest.summary.clone(),
            weight: 10.0,
        },
        SearchableField {
            name: "description",
            text: manifest.description.clone(),
            weight: 9.0,
        },
        SearchableField {
            name: "tags",
            text: manifest.tags.join(" "),
            weight: 7.0,
        },
        SearchableField {
            name: "schema",
            text: schema_search_text(&manifest.input_schema),
            weight: 4.0,
        },
    ]
}

fn score_search_field(
    normalized_query: &str,
    query_terms: &[String],
    field: &SearchableField,
) -> f64 {
    let normalized_field = normalize_search_text(&field.text);
    if normalized_field.is_empty() {
        return 0.0;
    }
    if normalized_field == normalized_query {
        return 2.8;
    }
    if normalized_field.starts_with(normalized_query) {
        return 2.2;
    }
    if normalized_field.contains(normalized_query) {
        return 1.8;
    }
    let field_terms = search_terms(&normalized_field);
    if field_terms.is_empty() {
        return 0.0;
    }
    let mut exact = 0_usize;
    let mut prefix = 0_usize;
    let mut fuzzy = 0_usize;
    for term in query_terms {
        if field_terms.iter().any(|candidate| candidate == term) {
            exact += 1;
        } else if field_terms
            .iter()
            .any(|candidate| candidate.starts_with(term) || term.starts_with(candidate))
        {
            prefix += 1;
        } else if field_terms
            .iter()
            .any(|candidate| fuzzy_term_match(term, candidate))
        {
            fuzzy += 1;
        }
    }
    let total = query_terms.len().max(1) as f64;
    (exact as f64 / total) * 1.35 + (prefix as f64 / total) * 1.0 + (fuzzy as f64 / total) * 0.55
}

fn best_fallback_list_path(query: &str, manifests: &[ToolManifest], scene: ToolScene) -> String {
    let query_terms = search_terms(query);
    let mut domain_scores = HashMap::<String, f64>::new();
    for manifest in manifests {
        let text = format!(
            "{} {} {} {} {}",
            manifest.domain,
            manifest.title,
            manifest.summary,
            manifest.description,
            manifest.tags.join(" ")
        );
        let terms = search_terms(&text);
        let matched = query_terms
            .iter()
            .filter(|query| {
                terms
                    .iter()
                    .any(|term| term == *query || fuzzy_term_match(query, term))
            })
            .count();
        if matched > 0 {
            *domain_scores.entry(manifest.domain.clone()).or_default() += matched as f64;
        }
    }
    if let Some((domain, _)) = domain_scores.into_iter().max_by(|left, right| {
        left.1
            .partial_cmp(&right.1)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
    }) {
        return format!("/tools/{domain}");
    }
    scene_domain_order(scene)
        .first()
        .map(|domain| format!("/tools/{domain}"))
        .unwrap_or_else(|| "/tools".to_string())
}

fn schema_search_text(schema: &Value) -> String {
    let mut values = Vec::new();
    collect_schema_search_text(schema, &mut values);
    values.join(" ")
}

fn collect_schema_search_text(value: &Value, values: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if matches!(
                    key.as_str(),
                    "description" | "title" | "default" | "enum" | "properties" | "required"
                ) {
                    values.push(key.clone());
                }
                if key != "$id" {
                    values.push(key.clone());
                    collect_schema_search_text(value, values);
                }
            }
        }
        Value::Array(array) => {
            for value in array {
                collect_schema_search_text(value, values);
            }
        }
        Value::String(text) => values.push(text.clone()),
        Value::Bool(_) | Value::Number(_) | Value::Null => {}
    }
}

fn normalize_search_text(text: &str) -> String {
    text.to_lowercase()
        .replace(['_', '-', '/', '.', ':'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn search_terms(text: &str) -> Vec<String> {
    normalize_search_text(text)
        .split(|character: char| !character.is_alphanumeric())
        .map(str::trim)
        .filter(|term| term.chars().count() >= 2)
        .map(str::to_string)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect()
}

fn fuzzy_term_match(query: &str, candidate: &str) -> bool {
    let query_len = query.chars().count();
    let candidate_len = candidate.chars().count();
    if query_len < 4 || candidate_len < 4 {
        return false;
    }
    let delta = query_len.abs_diff(candidate_len);
    let max_distance = if query_len.max(candidate_len) >= 8 {
        2
    } else {
        1
    };
    delta <= max_distance && levenshtein_distance(query, candidate, max_distance) <= max_distance
}

fn levenshtein_distance(left: &str, right: &str, max_distance: usize) -> usize {
    let left_chars = left.chars().collect::<Vec<_>>();
    let right_chars = right.chars().collect::<Vec<_>>();
    if left_chars.len().abs_diff(right_chars.len()) > max_distance {
        return max_distance + 1;
    }
    let mut previous = (0..=right_chars.len()).collect::<Vec<_>>();
    let mut current = vec![0; right_chars.len() + 1];
    for (left_index, left_char) in left_chars.iter().enumerate() {
        current[0] = left_index + 1;
        let mut row_min = current[0];
        for (right_index, right_char) in right_chars.iter().enumerate() {
            let cost = usize::from(left_char != right_char);
            current[right_index + 1] = (current[right_index] + 1)
                .min(previous[right_index + 1] + 1)
                .min(previous[right_index] + cost);
            row_min = row_min.min(current[right_index + 1]);
        }
        if row_min > max_distance {
            return max_distance + 1;
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[right_chars.len()]
}

fn round_score(score: f64) -> f64 {
    (score * 100.0).round() / 100.0
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
    let session_kind = signals.session_kind.as_deref().unwrap_or_default().trim();
    if matches!(session_kind, "design") {
        return ToolScene::Design;
    }
    if matches!(session_kind, "selfdev" | "project-code" | "code") {
        return ToolScene::ProjectCode;
    }
    if matches!(session_kind, "automation") {
        return ToolScene::Automation;
    }
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
        if !valid_permission_mode(&self.permission_mode) {
            return Err(ToolFsError::new(
                "invalid_permission_mode",
                format!(
                    "Tool-FS permissionMode is not supported: {}",
                    self.permission_mode
                ),
                "Retry with runtime_policy, ask, deny, read_only, or full_access.",
            )
            .with_detail(json!({ "permissionMode": self.permission_mode })));
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
            "search" => Ok(None),
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
                "Use search, list, read_doc, inspect, or run.",
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

fn valid_permission_mode(value: &str) -> bool {
    matches!(
        value.trim(),
        "runtime_policy"
            | "ask"
            | "deny"
            | "read_only"
            | "read-only"
            | "full_access"
            | "full-access"
    )
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
    if !args.is_object() {
        return Err(ToolFsError::new(
            "invalid_tool_args",
            "Tool-FS args must be a JSON object.",
            "Retry with args as an object matching the inspected inputSchema.",
        ));
    };
    validate_value_against_schema(manifest, "args", args, &manifest.input_schema)
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
    validate_schema_combinators(manifest, field, value, schema)?;
    if let Some(expected_const) = schema.get("const")
        && expected_const != value
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value does not match const",
            json!({ "field": field, "expected": expected_const, "actual": value }),
        ));
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
    match value {
        Value::Number(_) => validate_number_constraints(manifest, field, value, schema)?,
        Value::String(actual) => validate_string_constraints(manifest, field, actual, schema)?,
        Value::Array(values) => validate_array_constraints(manifest, field, values, schema)?,
        Value::Object(values) => validate_object_constraints(manifest, field, values, schema)?,
        Value::Bool(_) | Value::Null => {}
    }
    Ok(())
}

fn validate_schema_combinators(
    manifest: &ToolManifest,
    field: &str,
    value: &Value,
    schema: &Value,
) -> Result<(), ToolFsError> {
    if let Some(schemas) = schema.get("allOf").and_then(Value::as_array) {
        for subschema in schemas {
            validate_value_against_schema(manifest, field, value, subschema)?;
        }
    }
    if let Some(schemas) = schema.get("anyOf").and_then(Value::as_array) {
        let matched = schemas
            .iter()
            .filter(|subschema| {
                validate_value_against_schema(manifest, field, value, subschema).is_ok()
            })
            .count();
        if matched == 0 {
            return Err(schema_validation_error(
                manifest,
                field,
                "field value does not match any allowed schema",
                json!({ "field": field, "schemaKeyword": "anyOf" }),
            ));
        }
    }
    if let Some(schemas) = schema.get("oneOf").and_then(Value::as_array) {
        let matched = schemas
            .iter()
            .filter(|subschema| {
                validate_value_against_schema(manifest, field, value, subschema).is_ok()
            })
            .count();
        if matched != 1 {
            return Err(schema_validation_error(
                manifest,
                field,
                "field value must match exactly one allowed schema",
                json!({ "field": field, "schemaKeyword": "oneOf", "matched": matched }),
            ));
        }
    }
    Ok(())
}

fn validate_number_constraints(
    manifest: &ToolManifest,
    field: &str,
    value: &Value,
    schema: &Value,
) -> Result<(), ToolFsError> {
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
    Ok(())
}

fn validate_string_constraints(
    manifest: &ToolManifest,
    field: &str,
    value: &str,
    schema: &Value,
) -> Result<(), ToolFsError> {
    let length = value.chars().count();
    if let Some(min_length) = schema.get("minLength").and_then(Value::as_u64)
        && length < min_length as usize
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value is shorter than minLength",
            json!({ "field": field, "minLength": min_length, "actualLength": length }),
        ));
    }
    if let Some(max_length) = schema.get("maxLength").and_then(Value::as_u64)
        && length > max_length as usize
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "field value is longer than maxLength",
            json!({ "field": field, "maxLength": max_length, "actualLength": length }),
        ));
    }
    if let Some(pattern) = schema.get("pattern").and_then(Value::as_str) {
        let regex = Regex::new(pattern).map_err(|error| {
            schema_validation_error(
                manifest,
                field,
                "schema pattern is invalid",
                json!({ "field": field, "pattern": pattern, "error": error.to_string() }),
            )
        })?;
        if !regex.is_match(value) {
            return Err(schema_validation_error(
                manifest,
                field,
                "field value does not match pattern",
                json!({ "field": field, "pattern": pattern, "actual": value }),
            ));
        }
    }
    Ok(())
}

fn validate_array_constraints(
    manifest: &ToolManifest,
    field: &str,
    values: &[Value],
    schema: &Value,
) -> Result<(), ToolFsError> {
    if let Some(min_items) = schema.get("minItems").and_then(Value::as_u64)
        && values.len() < min_items as usize
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "array has fewer items than minItems",
            json!({ "field": field, "minItems": min_items, "actualItems": values.len() }),
        ));
    }
    if let Some(max_items) = schema.get("maxItems").and_then(Value::as_u64)
        && values.len() > max_items as usize
    {
        return Err(schema_validation_error(
            manifest,
            field,
            "array has more items than maxItems",
            json!({ "field": field, "maxItems": max_items, "actualItems": values.len() }),
        ));
    }
    if let Some(items) = schema.get("items") {
        for (index, item) in values.iter().enumerate() {
            validate_value_against_schema(manifest, &format!("{field}[{index}]"), item, items)?;
        }
    }
    Ok(())
}

fn validate_object_constraints(
    manifest: &ToolManifest,
    field: &str,
    values: &serde_json::Map<String, Value>,
    schema: &Value,
) -> Result<(), ToolFsError> {
    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        let missing = required
            .iter()
            .filter_map(Value::as_str)
            .filter(|required_field| values.get(*required_field).is_none_or(Value::is_null))
            .map(|required_field| child_schema_field(field, required_field))
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

    let properties = schema.get("properties").and_then(Value::as_object);
    let additional_properties = schema.get("additionalProperties");
    for (key, value) in values {
        if let Some(property_schema) = properties.and_then(|properties| properties.get(key)) {
            validate_value_against_schema(
                manifest,
                &child_schema_field(field, key),
                value,
                property_schema,
            )?;
            continue;
        }
        match additional_properties {
            Some(Value::Bool(false)) => {
                return Err(schema_validation_error(
                    manifest,
                    &child_schema_field(field, key),
                    "field is not declared in the target input schema",
                    json!({ "field": child_schema_field(field, key) }),
                ));
            }
            Some(additional_schema @ Value::Object(_)) => validate_value_against_schema(
                manifest,
                &child_schema_field(field, key),
                value,
                additional_schema,
            )?,
            _ => {}
        }
    }
    Ok(())
}

fn child_schema_field(parent: &str, child: &str) -> String {
    if parent.is_empty() || parent == "args" {
        child.to_string()
    } else {
        format!("{parent}.{child}")
    }
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

fn validate_manifest_set(manifests: &[ToolManifest]) -> Result<(), ToolFsError> {
    let mut paths = HashSet::new();
    let mut handles = HashSet::new();
    for manifest in manifests {
        validate_manifest(manifest)?;
        if !paths.insert(manifest.path.clone()) {
            return Err(ToolFsError::new(
                "duplicate_tool_path",
                format!("Tool-FS manifest path is duplicated: {}", manifest.path),
                "Fix the manifest provider so every tool path is unique.",
            ));
        }
        if let Some(handle) = manifest.handle.as_deref().filter(|value| !value.is_empty())
            && !handles.insert(handle.to_string())
        {
            return Err(ToolFsError::new(
                "duplicate_tool_handle",
                format!("Tool-FS manifest handle is duplicated: {handle}"),
                "Fix the manifest provider so every pinned handle is unique.",
            ));
        }
    }
    Ok(())
}

fn validate_manifest(manifest: &ToolManifest) -> Result<(), ToolFsError> {
    let normalized = normalize_tool_path(&manifest.path);
    if manifest.path != normalized || !manifest.path.starts_with("/tools/") {
        return Err(ToolFsError::new(
            "invalid_tool_path",
            format!("Tool-FS manifest path is invalid: {}", manifest.path),
            "Use a normalized /tools/<domain>/<operation> path.",
        ));
    }
    let path_domain = manifest
        .path
        .trim_start_matches("/tools/")
        .split('/')
        .next()
        .unwrap_or_default();
    if manifest.domain.trim().is_empty()
        || manifest.domain != path_domain
        || !is_manifest_token(&manifest.domain)
    {
        return Err(ToolFsError::new(
            "invalid_tool_domain",
            format!(
                "Tool-FS manifest domain `{}` does not match path `{}`.",
                manifest.domain, manifest.path
            ),
            "Use a lowercase manifest domain matching /tools/<domain>.",
        ));
    }
    if manifest.operation.trim().is_empty() || !is_manifest_token(&manifest.operation) {
        return Err(ToolFsError::new(
            "invalid_tool_operation",
            format!(
                "Tool-FS manifest operation is invalid: {}",
                manifest.operation
            ),
            "Use a non-empty lowercase operation id.",
        ));
    }
    if manifest.title.trim().is_empty() || manifest.summary.trim().is_empty() {
        return Err(ToolFsError::new(
            "invalid_tool_manifest",
            format!(
                "Tool-FS manifest is missing title or summary: {}",
                manifest.path
            ),
            "Provide a user-facing title and summary.",
        ));
    }
    if manifest.input_schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err(ToolFsError::new(
            "invalid_tool_schema",
            format!(
                "Tool-FS manifest inputSchema must be an object: {}",
                manifest.path
            ),
            "Provide an object inputSchema.",
        ));
    }
    let expected_schema_id = schema_id_for_path(&manifest.path);
    if manifest.input_schema.get("$id").and_then(Value::as_str) != Some(expected_schema_id.as_str())
    {
        return Err(ToolFsError::new(
            "invalid_tool_schema_id",
            format!(
                "Tool-FS manifest inputSchema $id is invalid: {}",
                manifest.path
            ),
            "Attach the stable Tool-FS schema id for this path.",
        )
        .with_detail(json!({
            "expected": expected_schema_id,
            "actual": manifest.input_schema.get("$id").cloned().unwrap_or(Value::Null),
        })));
    }
    Ok(())
}

fn is_manifest_token(value: &str) -> bool {
    value.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || character == '_'
            || character == '-'
    })
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
            "/tools/browser/find",
            "browser",
            "find",
            "Find in browser page",
            "Search text within a browser page and optionally reveal the selected match.",
            Some("browser_find"),
        ),
        s(
            "/tools/browser/locate",
            "browser",
            "locate",
            "Locate browser page section",
            "Find or semantically locate text on a browser page, reveal it, and map nearby controls.",
            Some("browser_locate"),
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
            "/tools/browser/scroll",
            "browser",
            "scroll",
            "Scroll browser page",
            "Scroll the browser viewport or a target area before mapping or interacting.",
            Some("browser_scroll"),
        ),
        s(
            "/tools/browser/scroll_to_target",
            "browser",
            "scroll_to_target",
            "Scroll to browser target",
            "Bring a mapped browser target near the visible viewport center.",
            Some("browser_scroll_to_target"),
        ),
        s(
            "/tools/browser/ensure_visible",
            "browser",
            "ensure_visible",
            "Ensure browser target visible",
            "Auto-scroll a browser target or point into the visible viewport before acting.",
            Some("browser_ensure_visible"),
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
            "/tools/filesystem/strict_edit",
            "filesystem",
            "strict_edit",
            "Strict edit",
            "Replace exact text in a file after verifying the file was read and has not changed.",
            Some("strict_edit"),
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
    let description = description_for(path, domain, operation, title, summary);
    let aliases = aliases_for(domain, operation, title);
    let examples = examples_for(domain, operation, title);
    let tags = tags_for(domain, operation);
    ToolManifest {
        path: path.to_string(),
        handle: handle.map(str::to_string),
        domain: domain.to_string(),
        operation: operation.to_string(),
        title: title.to_string(),
        summary: summary.to_string(),
        description,
        aliases,
        examples,
        tags,
        risk_level: risk_level(domain, operation).to_string(),
        permission_policy: permission_policy(domain, operation).to_string(),
        input_schema: input_schema_for(path, domain, operation),
        output_kind: output_kind(domain, operation).to_string(),
        activity_kind: activity_kind(domain, operation).to_string(),
        renderer_hint: renderer_hint(domain, operation).to_string(),
    }
}

fn description_for(
    path: &str,
    domain: &str,
    operation: &str,
    title: &str,
    summary: &str,
) -> String {
    let purpose = match (domain, operation) {
        ("filesystem", "read") if path.ends_with("/read_file") => {
            "Use when the agent needs to open, inspect, or quote a complete file from the workspace."
        }
        ("filesystem", "read") => {
            "Use when the agent needs a precise line range from a workspace file without loading the whole file."
        }
        ("filesystem", "list") => {
            "Use when the agent needs to browse a directory, see file names, or understand project structure."
        }
        ("filesystem", "glob") => {
            "Use when the agent knows a file name pattern, extension, or glob and needs matching paths."
        }
        ("filesystem", "write") => {
            "Use when the agent must create or replace a whole workspace file."
        }
        ("filesystem", "strict_edit") => {
            "Use when the agent must safely modify existing file text with an exact replacement after reading the current file."
        }
        ("filesystem", "edit" | "multiedit") => {
            "Use when the agent must update existing file text with exact replacements."
        }
        ("filesystem", "apply_patch") => {
            "Use when the agent must make structured multi-file code or text edits through a patch."
        }
        ("code", "search_text" | "project") => {
            "Use when the agent needs to find real code snippets, project text, function calls, labels, strings, or file content."
        }
        ("code", "search_symbol") => {
            "Use when the agent needs to find classes, functions, components, methods, symbols, or definitions."
        }
        ("code", "graph_expand") => {
            "Use when the agent needs related imports, dependency context, call graph clues, or nearby code relationships."
        }
        ("code", "query") => {
            "Use when the agent needs language-server diagnostics, symbol metadata, references, or editor intelligence."
        }
        ("shell", "run") => {
            "Use when the agent needs to run a bounded non-interactive shell command, test, build, lint, typecheck, or inspect the system."
        }
        ("terminal", "run" | "input" | "write" | "keys" | "act") => {
            "Use when the agent needs to operate an interactive terminal session or terminal UI."
        }
        ("terminal", _) => {
            "Use when the agent needs to inspect, manage, wait for, or read persistent terminal sessions."
        }
        ("git", "status") => {
            "Use when the agent needs the repository working tree state, changed files, staged files, or branch cleanliness."
        }
        ("git", "diff") => {
            "Use when the agent needs to review exact source changes before explaining, committing, or editing further."
        }
        ("git", "log" | "show" | "branch") => {
            "Use when the agent needs commit history, the current branch, or a specific Git object."
        }
        ("git", "stage" | "unstage" | "discard") => {
            "Use when the agent needs to mutate Git index or working tree state."
        }
        ("browser", "read" | "read_until") => {
            "Use when the agent needs readable text, page state, or content from a Lyra browser or Lumen page."
        }
        ("browser", "find" | "locate") => {
            "Use when the agent needs to search, reveal, or semantically locate text or a section within a Lyra browser page before mapping nearby controls."
        }
        ("browser", "map" | "focus_scan" | "explain_target") => {
            "Use when the agent needs to discover clickable, typable, focusable, or targetable browser elements."
        }
        ("browser", "see") => {
            "Use when the agent needs a visual screenshot or bitmap observation of the browser page."
        }
        ("browser", "scroll" | "scroll_to_target" | "ensure_visible") => {
            "Use when the agent needs to scroll a browser page, bring an offscreen button or input into view, keep the Agent cursor visible, or recover after a mapped target is outside the viewport."
        }
        ("browser", "act" | "type" | "press" | "submit" | "navigate" | "wait" | "reveal") => {
            "Use when the agent needs to interact with, navigate, type into, click, wait for, or reveal browser page controls."
        }
        ("workbench", _) => {
            "Use when the agent needs Lyra workspace tabs, active tab state, visible app surfaces, or workbench navigation."
        }
        ("web", "search") => {
            "Use when the agent needs current web search results from the network."
        }
        ("web", "fetch") => "Use when the agent needs to download or inspect a known URL.",
        ("memory", "search" | "list" | "explain_injection") => {
            "Use when the agent needs stored Lyra memory, user preferences, project facts, or memory injection diagnostics."
        }
        ("memory", _) => {
            "Use when the agent needs to create, update, connect, review, or remove durable Lyra memory records."
        }
        ("todo", "read") => "Use when the agent needs current task checklist or progress state.",
        ("todo", "write") => "Use when the agent needs to update the active task checklist.",
        ("design", _) => {
            "Use when the agent needs Lyra design references, visual style guidance, or UI implementation patterns."
        }
        ("software", _) => {
            "Use when the agent needs to inspect or invoke installed Lyra software adapter capabilities."
        }
        ("skills", _) => {
            "Use when the agent needs to discover, inspect, activate, or deactivate Lyra skills."
        }
        ("mcp", _) => {
            "Use when the agent needs to manage MCP servers or discover, inspect, and execute MCP tools."
        }
        ("runtime", "read") => {
            "Use when the agent needs to reopen a Lyra-owned artifact, large output, screenshot, or tool data reference."
        }
        _ => "Use when the agent needs this Tool-FS capability for the current Lyra task.",
    };
    format!(
        "{title}. {summary} {purpose} Tool path: {path}. Domain: {domain}. Operation: {operation}."
    )
}

fn aliases_for(domain: &str, operation: &str, title: &str) -> Vec<String> {
    let mut aliases = vec![
        title.to_string(),
        title.to_ascii_lowercase(),
        domain.replace('_', " "),
        operation.replace('_', " "),
    ];
    aliases.extend(
        match (domain, operation) {
            ("filesystem", "list") => vec!["browse files", "list directory", "查看文件", "列目录"],
            ("filesystem", "read") => vec!["open file", "read source", "查看文件", "读取文件"],
            ("filesystem", "glob") => vec!["find file", "file pattern", "glob search", "找文件"],
            ("filesystem", "write") => vec!["create file", "overwrite file", "写文件", "新建文件"],
            ("filesystem", "strict_edit") => {
                vec![
                    "strict edit",
                    "safe edit",
                    "exact replacement",
                    "replace text after reading",
                    "modify file",
                    "edit code",
                    "修改文件",
                    "精确替换",
                    "安全编辑",
                ]
            }
            ("filesystem", "edit" | "multiedit") => {
                vec![
                    "modify file",
                    "replace text",
                    "edit code",
                    "修改文件",
                    "编辑代码",
                ]
            }
            ("filesystem", "apply_patch") => {
                vec![
                    "patch files",
                    "apply diff",
                    "code edit",
                    "修改代码",
                    "打补丁",
                ]
            }
            ("code", "search_text" | "project") => {
                vec![
                    "search code",
                    "find snippet",
                    "grep",
                    "搜索代码",
                    "查代码片段",
                ]
            }
            ("code", "search_symbol") => {
                vec![
                    "find symbol",
                    "find definition",
                    "function search",
                    "搜索函数",
                    "查定义",
                ]
            }
            ("code", "graph_expand") => vec!["related code", "imports", "dependencies", "代码关系"],
            ("code", "query") => vec!["lsp", "diagnostics", "references", "语言服务", "诊断"],
            ("shell", "run") => vec![
                "run command",
                "execute command",
                "test command",
                "执行命令",
                "跑测试",
            ],
            ("terminal", _) => vec!["terminal", "interactive command", "终端", "交互命令"],
            ("git", "status") => vec!["git status", "changed files", "工作区状态", "查看改动"],
            ("git", "diff") => vec!["git diff", "review changes", "查看 diff", "代码变更"],
            ("git", "log" | "show" | "branch") => {
                vec!["git history", "commit", "branch", "提交历史"]
            }
            ("git", "stage" | "unstage" | "discard") => {
                vec!["git mutation", "stage file", "撤销改动"]
            }
            ("browser", "read" | "read_until") => {
                vec!["read page", "browser text", "读取网页", "页面内容"]
            }
            ("browser", "find" | "locate") => vec![
                "find page text",
                "search in page",
                "locate section",
                "jump to text",
                "semantic page search",
                "查找网页内容",
                "跳到页面位置",
                "定位页面段落",
            ],
            ("browser", "map" | "focus_scan" | "explain_target") => {
                vec![
                    "find button",
                    "page controls",
                    "DOM map",
                    "找按钮",
                    "页面元素",
                ]
            }
            ("browser", "see") => vec!["screenshot", "visual page", "截图", "看页面"],
            ("browser", "scroll" | "scroll_to_target" | "ensure_visible") => vec![
                "scroll page",
                "scroll down",
                "scroll up",
                "bring target into view",
                "ensure visible",
                "cursor offscreen",
                "button outside viewport",
                "滚动页面",
                "向下滚动",
                "滚到按钮附近",
                "让目标可见",
                "光标不可见",
            ],
            ("browser", _) => vec![
                "click page",
                "type in browser",
                "navigate page",
                "浏览器操作",
            ],
            ("workbench", _) => vec!["workspace tabs", "active tab", "工作区", "标签页"],
            ("web", "search") => vec!["internet search", "search web", "联网搜索", "网页搜索"],
            ("web", "fetch") => vec!["fetch url", "download page", "读取链接", "抓取网页"],
            ("memory", _) => vec![
                "memory",
                "remember user",
                "long term memory",
                "记忆",
                "偏好",
            ],
            ("todo", "read") => vec!["read todo", "task list", "待办", "任务列表"],
            ("todo", "write") => vec!["update todo", "checklist", "更新待办", "计划"],
            ("design", _) => vec!["design reference", "UI style", "设计参考", "界面风格"],
            ("software", _) => vec!["app capability", "software adapter", "应用能力"],
            ("skills", _) => vec!["skill", "plugin skill", "技能"],
            ("mcp", _) => vec!["mcp", "external tool", "外部工具"],
            ("runtime", "read") => vec!["read artifact", "open artifact", "查看产物", "大输出"],
            _ => vec!["tool", "capability", "工具"],
        }
        .into_iter()
        .map(str::to_string),
    );
    dedupe_strings(aliases)
}

fn examples_for(domain: &str, operation: &str, title: &str) -> Vec<String> {
    let specific = match (domain, operation) {
        ("filesystem", "read") => vec!["Read src/main.rs before editing.", "查看这个文件的内容。"],
        ("filesystem", "strict_edit") => {
            vec![
                "Read a file, then safely replace one exact string.",
                "先读取文件，然后精确替换一段代码。",
            ]
        }
        ("filesystem", "edit" | "multiedit") => {
            vec!["Replace an exact string in a file.", "把按钮标题改掉。"]
        }
        ("filesystem", "apply_patch") => vec![
            "Patch multiple files after locating the bug.",
            "批量修改代码。",
        ],
        ("code", "search_text" | "project") => vec![
            "Search for the text 新回话 in the project.",
            "Find every caller of createSession.",
        ],
        ("code", "search_symbol") => vec![
            "Find the React component or Rust function definition.",
            "查找函数定义。",
        ],
        ("shell", "run") => vec!["Run cargo test or npm typecheck.", "执行测试命令。"],
        ("git", "status") => vec![
            "Check whether the repo has uncommitted changes.",
            "查看 Git 状态。",
        ],
        ("git", "diff") => vec![
            "Inspect the exact changes before summarizing.",
            "查看某个文件 diff。",
        ],
        ("browser", "read" | "read_until") => {
            vec!["Read the visible browser page text.", "读取当前网页内容。"]
        }
        ("browser", "find" | "locate") => {
            vec![
                "Find a visible browser page phrase and reveal the match.",
                "Locate a long page section before mapping nearby controls.",
            ]
        }
        ("browser", "map" | "focus_scan" | "explain_target") => {
            vec!["Find the submit button on the page.", "定位页面按钮。"]
        }
        ("browser", "act" | "type" | "press" | "submit" | "navigate") => {
            vec![
                "Click a browser target or type into an input.",
                "在浏览器里输入并提交。",
            ]
        }
        ("browser", "scroll") => vec![
            "Scroll the browser down one viewport and map again.",
            "页面没有看到目标时先向下滚动。",
        ],
        ("browser", "scroll_to_target") => vec![
            "Bring targetRef lumen:... near the viewport center before clicking.",
            "把已映射的按钮滚动到屏幕中间附近。",
        ],
        ("browser", "ensure_visible") => vec![
            "Ensure an offscreen targetRef is visible before act or type.",
            "光标定位到按钮但按钮不在可见区域时先拉回可见区域。",
        ],
        ("workbench", _) => vec![
            "Inspect open Lyra tabs and active workspace state.",
            "查看当前工作区标签页。",
        ],
        ("web", "search") => vec!["Search the web for recent documentation.", "联网搜索资料。"],
        ("web", "fetch") => vec!["Fetch a known documentation URL.", "读取指定网页。"],
        ("memory", "search") => vec![
            "Find saved user preferences or project facts.",
            "搜索记忆里的偏好。",
        ],
        ("todo", "write") => vec!["Mark a plan step as completed.", "更新任务清单。"],
        ("terminal", _) => vec![
            "Read or operate an existing terminal pane.",
            "操作交互式终端。",
        ],
        ("runtime", "read") => vec![
            "Open a large stdout artifact or screenshot ref.",
            "查看工具产物。",
        ],
        _ => vec!["Use this capability when the task asks for it."],
    };
    let mut examples = vec![format!("Use {title} for a matching Lyra task.")];
    examples.extend(specific.into_iter().map(str::to_string));
    dedupe_strings(examples)
}

fn tags_for(domain: &str, operation: &str) -> Vec<String> {
    let mut tags = vec![domain.to_string(), operation.to_string()];
    tags.extend(
        match domain {
            "filesystem" => vec!["file", "workspace", "code"],
            "code" => vec!["search", "source", "symbol"],
            "shell" => vec!["command", "test", "build"],
            "terminal" => vec!["interactive", "process", "pane"],
            "git" => vec!["repo", "diff", "commit"],
            "browser" => vec!["page", "lumen", "dom"],
            "workbench" => vec!["workspace", "tabs", "state"],
            "web" => vec!["network", "url", "internet"],
            "memory" => vec!["memory", "preference", "profile"],
            "todo" => vec!["task", "plan", "checklist"],
            "design" => vec!["ui", "style", "reference"],
            "software" => vec!["adapter", "app", "capability"],
            "skills" => vec!["skill", "activation", "instructions"],
            "mcp" => vec!["server", "external", "tool"],
            "runtime" => vec!["artifact", "projection", "large-output"],
            _ => vec!["tool"],
        }
        .into_iter()
        .map(str::to_string),
    );
    dedupe_strings(tags)
}

fn dedupe_strings(values: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .filter(|value| seen.insert(value.to_ascii_lowercase()))
        .collect()
}

fn risk_level(domain: &str, operation: &str) -> &'static str {
    match (domain, operation) {
        ("filesystem", "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch") => "file",
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
        ("filesystem", "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch")
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
        ("filesystem", "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch") => "edit",
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
        ("filesystem", "write" | "edit" | "strict_edit" | "multiedit" | "apply_patch") => "edit",
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
    let schema = match (domain, operation) {
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
                ("replaceAll", json!({ "type": "boolean", "default": false })),
            ],
            &["path", "oldString", "newString"],
        ),
        ("filesystem", "strict_edit") => object_schema(
            [
                ("path", string("Workspace file path that was already read.")),
                ("oldString", string("Exact unique text to replace.")),
                ("newString", string("Replacement text.")),
                ("replaceAll", json!({ "type": "boolean", "default": false })),
                (
                    "expectedReadVersion",
                    string("Optional readVersion returned by read_file/read_range."),
                ),
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
                ("cwd", working_dir.clone()),
                ("workingDir", working_dir.clone()),
                (
                    "description",
                    string("Short active-voice summary of what this command does."),
                ),
                (
                    "runInBackground",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "timeoutMs",
                    json!({ "type": "integer", "minimum": 250, "maximum": 120000 }),
                ),
                (
                    "maxOutputBytes",
                    json!({ "type": "integer", "minimum": 1, "maximum": 1000000 }),
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
                (
                    "direction",
                    json!({ "type": "string", "enum": ["up", "down", "left", "right", "current", "next", "previous", "scan"], "description": "Scroll direction for /tools/browser/scroll, find navigation for /tools/browser/find, or focus scan direction." }),
                ),
                (
                    "amount",
                    json!({ "type": "number", "minimum": 1, "maximum": 5000, "description": "Scroll pixels or wheel-like amount. Defaults to about one viewport." }),
                ),
                (
                    "pages",
                    json!({ "type": "number", "minimum": 0.1, "maximum": 10, "description": "Viewport pages to scroll; overrides amount when provided." }),
                ),
                (
                    "block",
                    json!({ "type": "string", "enum": ["start", "center", "end", "nearest"], "default": "center", "description": "Preferred target placement after scroll_to_target or ensure_visible." }),
                ),
                (
                    "behavior",
                    json!({ "type": "string", "enum": ["instant", "smooth"], "default": "instant" }),
                ),
                (
                    "containerRef",
                    string("Optional scroll container targetRef."),
                ),
                (
                    "point",
                    json!({ "type": "object", "properties": { "x": { "type": "number" }, "y": { "type": "number" }, "reason": { "type": "string" } } }),
                ),
                (
                    "x",
                    json!({ "type": "number", "description": "Viewport x coordinate for point-based ensure_visible." }),
                ),
                (
                    "y",
                    json!({ "type": "number", "description": "Viewport y coordinate for point-based ensure_visible." }),
                ),
                ("autoMap", json!({ "type": "boolean", "default": true })),
                ("text", string("Text for type operations.")),
                ("query", string("Text query for /tools/browser/find or /tools/browser/locate.")),
                (
                    "matchMode",
                    json!({ "type": "string", "enum": ["exact", "semantic"], "default": "semantic", "description": "Match mode for /tools/browser/locate." }),
                ),
                (
                    "activeIndex",
                    json!({ "type": "number", "minimum": 0, "description": "Current 1-based match index for browser find navigation." }),
                ),
                (
                    "caseSensitive",
                    json!({ "type": "boolean", "default": false }),
                ),
                (
                    "maxMatches",
                    json!({ "type": "number", "minimum": 1, "maximum": 100 }),
                ),
                (
                    "reveal",
                    json!({ "type": "boolean", "default": true }),
                ),
                (
                    "autoMap",
                    json!({ "type": "boolean", "default": true }),
                ),
                (
                    "nearbyLimit",
                    json!({ "type": "number", "minimum": 1, "maximum": 20 }),
                ),
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
    };
    attach_schema_id(path, schema)
}

pub fn schema_id_for_path(path: &str) -> String {
    let normalized = normalize_tool_path(path);
    format!("lyra-tool-fs://schema{normalized}/input")
}

pub fn attach_schema_id(path: &str, mut schema: Value) -> Value {
    if let Some(object) = schema.as_object_mut() {
        object
            .entry("$id".to_string())
            .or_insert_with(|| Value::String(schema_id_for_path(path)));
    }
    schema
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
            "find_files",
            "search_code",
            "read_file",
            "read_range",
            "strict_edit",
            "apply_patch",
            "run_command",
            "git_status",
            "git_diff",
            "todo_write",
        ],
        ToolScene::Git => vec![
            "search_code",
            "read_file",
            "read_range",
            "strict_edit",
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
            "browser_locate",
            "browser_find",
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

        let files_page_2 = registry
            .list("/tools/filesystem", 1, 2, ToolScene::ProjectCode)
            .expect("filesystem page 2");
        assert_eq!(files_page_2.page, 1);
        assert_eq!(files_page_2.page_size, 2);
        assert_ne!(files.tools[0].path, files_page_2.tools[0].path);

        let git_tools = registry
            .list("/tools/git", 0, 20, ToolScene::Git)
            .expect("git tools");
        assert_eq!(
            git_tools
                .tools
                .first()
                .and_then(|tool| tool.handle.as_deref()),
            Some("git_status")
        );
    }

    #[test]
    fn registry_reads_docs_and_inspects_path_and_handle() {
        let registry = ToolFsRegistry::default();
        let root_doc = registry.read_doc("/tools").expect("root doc");
        assert_eq!(root_doc["kind"], "tool_fs_doc");

        let domain_doc = registry.read_doc("/tools/git").expect("git doc");
        assert_eq!(domain_doc["path"], "/tools/git");
        assert!(
            domain_doc["content"]
                .as_str()
                .is_some_and(|content| content.contains("Git"))
        );

        let tool_doc = registry
            .read_doc("/tools/shell/run_command")
            .expect("tool doc");
        assert_eq!(tool_doc["path"], "/tools/shell/run_command");
        assert_eq!(tool_doc["title"], "Run command");
        assert!(
            tool_doc["content"]
                .as_str()
                .is_some_and(|content| content.contains("bounded shell command"))
        );

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
    fn provider_visible_names_include_search_first() {
        assert_eq!(
            provider_tool_names(),
            vec![
                "tool_fs_search".to_string(),
                "tool_fs_list".to_string(),
                "tool_fs_read_doc".to_string(),
                "tool_fs_inspect".to_string(),
                "tool_fs_run".to_string(),
            ]
        );
    }

    #[test]
    fn registry_search_finds_tools_by_natural_language_and_fuzzy_terms() {
        let registry = ToolFsRegistry::default();
        let edit = registry
            .search("修改文件 edit code", None, 0, 5, ToolScene::ProjectCode)
            .expect("edit search");
        assert!(
            edit.results
                .iter()
                .any(|result| result.path == "/tools/filesystem/apply_patch")
                || edit
                    .results
                    .iter()
                    .any(|result| result.path == "/tools/filesystem/edit_file")
        );

        let command = registry
            .search("执行测试命令", None, 0, 5, ToolScene::ProjectCode)
            .expect("command search");
        assert!(
            command
                .results
                .iter()
                .any(|result| result.path == "/tools/shell/run_command")
        );

        let git = registry
            .search("查看 git diff 代码变更", None, 0, 5, ToolScene::Git)
            .expect("git search");
        assert_eq!(
            git.results.first().map(|result| result.path.as_str()),
            Some("/tools/git/diff")
        );

        let browser = registry
            .search("brower page text", None, 0, 5, ToolScene::Browser)
            .expect("browser fuzzy search");
        assert!(
            browser
                .results
                .iter()
                .any(|result| result.path == "/tools/browser/read")
        );

        let browser_find = registry
            .search("search in page locate section", None, 0, 5, ToolScene::Browser)
            .expect("browser find search");
        assert!(browser_find.results.iter().any(|result| {
            result.path == "/tools/browser/find" || result.path == "/tools/browser/locate"
        }));

        let browser_locate = registry
            .search("定位页面段落", None, 0, 5, ToolScene::Browser)
            .expect("browser locate search");
        assert!(
            browser_locate
                .results
                .iter()
                .any(|result| result.path == "/tools/browser/locate")
        );

        let browser_scroll = registry
            .search(
                "滚到按钮附近 bring target into view",
                None,
                0,
                5,
                ToolScene::Browser,
            )
            .expect("browser scroll search");
        assert!(browser_scroll.results.iter().any(|result| {
            result.path == "/tools/browser/scroll_to_target"
                || result.path == "/tools/browser/ensure_visible"
                || result.path == "/tools/browser/scroll"
        }));

        let code = registry
            .search(
                "search code snippet 新回话",
                Some("code"),
                0,
                5,
                ToolScene::ProjectCode,
            )
            .expect("code search");
        assert!(code.results.iter().all(|result| result.domain == "code"));
        assert!(
            code.results
                .iter()
                .any(|result| result.path == "/tools/code/search_code")
        );
    }

    #[test]
    fn registry_search_returns_fallback_for_unknown_query() {
        let registry = ToolFsRegistry::default();
        let response = registry
            .search(
                "zzzzqqqq xxyyzzww",
                Some("filesystem"),
                0,
                5,
                ToolScene::General,
            )
            .expect("search response");
        assert!(response.results.is_empty());
        assert_eq!(response.fallback_list_path, "/tools/filesystem");
        assert!(response.recommended_next_action.contains("tool_fs_list"));
    }

    #[test]
    fn builtin_manifests_have_searchable_metadata() {
        let registry = ToolFsRegistry::default();
        for manifest in registry.manifests() {
            assert!(!manifest.description.trim().is_empty(), "{}", manifest.path);
            assert!(!manifest.aliases.is_empty(), "{}", manifest.path);
            assert!(!manifest.examples.is_empty(), "{}", manifest.path);
            assert!(!manifest.tags.is_empty(), "{}", manifest.path);
        }
    }

    #[test]
    fn manifest_input_schemas_have_stable_ids() {
        let registry = ToolFsRegistry::default();
        for manifest in registry.manifests() {
            let expected = schema_id_for_path(&manifest.path);
            assert_eq!(
                manifest.input_schema.get("$id").and_then(Value::as_str),
                Some(expected.as_str()),
                "{} schema id",
                manifest.path
            );
        }
    }

    struct TestManifestProvider {
        manifests: Vec<ToolManifest>,
    }

    impl ToolManifestProvider for TestManifestProvider {
        fn tool_manifests(&self) -> Vec<ToolManifest> {
            self.manifests.clone()
        }
    }

    fn test_manifest(path: &str, handle: Option<&str>) -> ToolManifest {
        let domain = path
            .trim_start_matches("/tools/")
            .split('/')
            .next()
            .unwrap_or("test");
        ToolManifest {
            path: path.to_string(),
            handle: handle.map(str::to_string),
            domain: domain.to_string(),
            operation: "read".to_string(),
            title: "Test tool".to_string(),
            summary: "A test tool.".to_string(),
            description: "Test tool description for search.".to_string(),
            aliases: vec!["test read".to_string()],
            examples: vec!["Use this test tool.".to_string()],
            tags: vec!["test".to_string()],
            risk_level: "read".to_string(),
            permission_policy: "runtime_policy".to_string(),
            input_schema: attach_schema_id(path, json!({ "type": "object", "properties": {} })),
            output_kind: "json".to_string(),
            activity_kind: "task".to_string(),
            renderer_hint: "task".to_string(),
        }
    }

    #[test]
    fn registry_startup_validation_rejects_invalid_manifests() {
        let duplicate_path = TestManifestProvider {
            manifests: vec![test_manifest("/tools/filesystem/read_file", None)],
        };
        assert_eq!(
            ToolFsRegistry::try_with_providers(&[&duplicate_path])
                .unwrap_err()
                .code,
            "duplicate_tool_path"
        );

        let duplicate_handle = TestManifestProvider {
            manifests: vec![test_manifest("/tools/test/read", Some("read_file"))],
        };
        assert_eq!(
            ToolFsRegistry::try_with_providers(&[&duplicate_handle])
                .unwrap_err()
                .code,
            "duplicate_tool_handle"
        );

        let mut invalid_schema = test_manifest("/tools/test/no_schema", None);
        invalid_schema.input_schema = json!({ "type": "object", "properties": {} });
        let invalid_schema_provider = TestManifestProvider {
            manifests: vec![invalid_schema],
        };
        assert_eq!(
            ToolFsRegistry::try_with_providers(&[&invalid_schema_provider])
                .unwrap_err()
                .code,
            "invalid_tool_schema_id"
        );
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

        let mut invalid_permission_mode = envelope.clone();
        invalid_permission_mode.permission_mode = "free_for_all".to_string();
        assert_eq!(
            invalid_permission_mode
                .validate(&registry)
                .unwrap_err()
                .code,
            "invalid_permission_mode"
        );

        let mut invalid_timeout = envelope.clone();
        invalid_timeout.timeout_ms = Some(MAX_TOOL_TIMEOUT_MS + 1);
        assert_eq!(
            invalid_timeout.validate(&registry).unwrap_err().code,
            "invalid_timeout"
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
    fn operation_envelope_validator_recursively_checks_json_schema_constraints() {
        let path = "/tools/test/validate_args";
        let mut manifest = test_manifest(path, None);
        manifest.operation = "validate_args".to_string();
        manifest.input_schema = attach_schema_id(
            path,
            json!({
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "minLength": 2,
                        "maxLength": 5,
                        "pattern": "^[a-z]+$"
                    },
                    "items": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 2,
                        "items": { "type": "integer", "minimum": 1 }
                    },
                    "options": {
                        "type": "object",
                        "properties": {
                            "mode": { "enum": ["fast", "safe"] }
                        },
                        "required": ["mode"],
                        "additionalProperties": false
                    },
                    "choice": {
                        "oneOf": [
                            { "const": "a" },
                            { "const": "b" }
                        ]
                    },
                    "maybe": {
                        "anyOf": [
                            { "type": "string" },
                            { "type": "integer" }
                        ]
                    }
                },
                "required": ["name", "items", "options"],
                "additionalProperties": false
            }),
        );
        let provider = TestManifestProvider {
            manifests: vec![manifest.clone()],
        };
        let registry = ToolFsRegistry::try_with_providers(&[&provider]).expect("registry");
        let context = ToolOperationContext {
            session_id: "session-1".to_string(),
            turn_id: "turn-1".to_string(),
            ..ToolOperationContext::default()
        };
        let valid_args = json!({
            "name": "alpha",
            "items": [1, 2],
            "options": { "mode": "fast" },
            "choice": "a",
            "maybe": 7
        });
        let mut valid = new_operation_envelope(&manifest, valid_args, None, context.clone());
        valid.created_at = "2026-06-05T00:00:00.000Z".to_string();
        assert!(valid.validate(&registry).is_ok());

        let invalid_cases = [
            (
                json!({
                    "name": "Alpha",
                    "items": [1],
                    "options": { "mode": "fast" }
                }),
                "name",
            ),
            (
                json!({
                    "name": "ok",
                    "items": [],
                    "options": { "mode": "fast" }
                }),
                "items",
            ),
            (
                json!({
                    "name": "ok",
                    "items": [0],
                    "options": { "mode": "fast" }
                }),
                "items[0]",
            ),
            (
                json!({
                    "name": "ok",
                    "items": [1],
                    "options": { "mode": "fast", "extra": true }
                }),
                "options.extra",
            ),
            (
                json!({
                    "name": "ok",
                    "items": [1],
                    "options": { "mode": "fast" },
                    "choice": "c"
                }),
                "choice",
            ),
            (
                json!({
                    "name": "ok",
                    "items": [1],
                    "options": { "mode": "fast" },
                    "maybe": true
                }),
                "maybe",
            ),
        ];
        for (args, field) in invalid_cases {
            let mut envelope = new_operation_envelope(&manifest, args, None, context.clone());
            envelope.created_at = "2026-06-05T00:00:00.000Z".to_string();
            let error = envelope.validate(&registry).expect_err("invalid args");
            assert_eq!(error.code, "invalid_tool_args");
            assert_eq!(
                error
                    .detail
                    .as_ref()
                    .and_then(|detail| detail.pointer("/schemaError/field"))
                    .and_then(Value::as_str),
                Some(field)
            );
        }

        let mut missing_nested = new_operation_envelope(
            &manifest,
            json!({
                "name": "ok",
                "items": [1],
                "options": {}
            }),
            None,
            context,
        );
        missing_nested.created_at = "2026-06-05T00:00:00.000Z".to_string();
        let error = missing_nested
            .validate(&registry)
            .expect_err("missing nested");
        assert_eq!(error.code, "invalid_tool_args");
        assert!(
            error
                .detail
                .as_ref()
                .and_then(|detail| detail.get("missing"))
                .and_then(Value::as_array)
                .is_some_and(|missing| missing
                    .iter()
                    .any(|field| field.as_str() == Some("options.mode")))
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
            session_kind: Some("selfdev".to_string()),
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::ProjectCode);

        let signals = ToolSceneSignals {
            project_bound: true,
            git_repo: false,
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::ProjectCode);

        let signals = ToolSceneSignals {
            git_repo: true,
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::Git);

        let signals = ToolSceneSignals {
            terminal_active: true,
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::Terminal);

        let signals = ToolSceneSignals {
            browser_active: true,
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::Browser);

        let signals = ToolSceneSignals {
            editor_active: true,
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::ProjectCode);

        let signals = ToolSceneSignals {
            software_active: true,
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::Automation);

        let signals = ToolSceneSignals {
            active_skills: vec!["lyra-design-research".to_string()],
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::Design);

        let signals = ToolSceneSignals {
            active_tab_kind: Some("workbench".to_string()),
            ..ToolSceneSignals::default()
        };
        assert_eq!(infer_scene(&signals), ToolScene::Workbench);
    }

    #[test]
    fn scene_changes_sorting_and_pins_without_hiding_tools() {
        let registry = ToolFsRegistry::default();
        let general_root = registry
            .list("/tools", 0, 100, ToolScene::General)
            .expect("general tools root");
        let git_root = registry
            .list("/tools", 0, 100, ToolScene::Git)
            .expect("git tools root");
        assert_eq!(
            registry.root_summary_for_scene(ToolScene::Git)["domains"][0],
            "git"
        );
        let general_domains = general_root
            .directories
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<HashSet<_>>();
        let git_domains = git_root
            .directories
            .iter()
            .map(|entry| entry.name.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(general_domains, git_domains);
        assert_ne!(
            general_root.directories[0].name,
            git_root.directories[0].name
        );

        let general_filesystem = registry
            .list("/tools/filesystem", 0, 200, ToolScene::General)
            .expect("general filesystem tools");
        let project_filesystem = registry
            .list("/tools/filesystem", 0, 200, ToolScene::ProjectCode)
            .expect("project filesystem tools");
        let general_paths = general_filesystem
            .tools
            .iter()
            .map(|manifest| manifest.path.as_str())
            .collect::<HashSet<_>>();
        let project_paths = project_filesystem
            .tools
            .iter()
            .map(|manifest| manifest.path.as_str())
            .collect::<HashSet<_>>();
        assert_eq!(general_paths, project_paths);
        assert_eq!(project_filesystem.tools[0].path, "/tools/filesystem/glob");
        assert!(
            registry
                .pinned_handles(ToolScene::ProjectCode)
                .iter()
                .any(|handle| handle.handle == "strict_edit")
        );
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
