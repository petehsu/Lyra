use serde_json::{Value, json};
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashSet};

use crate::catalog::{builtin_manifests, domain_summary, validate_manifest_set};
use crate::error::ToolFsError;
use crate::model::{
    PinnedToolHandle, ResolvedToolRun, ToolDirectory, ToolDirectoryEntry, ToolDirectoryToolEntry,
    ToolManifest, ToolManifestProvider, ToolSearchResponse, ToolSearchResult,
};
use crate::scene::{ToolScene, pinned_handle_names, scene_domain_order};
use crate::search::{best_fallback_list_path, round_score, score_manifest_search};

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
        Self::try_with_builtin_filter_and_providers(|_| true, providers)
    }

    pub fn with_builtin_filter_and_providers(
        include_builtin: impl FnMut(&ToolManifest) -> bool,
        providers: &[&dyn ToolManifestProvider],
    ) -> Self {
        Self::try_with_builtin_filter_and_providers(include_builtin, providers)
            .unwrap_or_else(|_| Self::builtin())
    }

    pub fn try_with_builtin_filter_and_providers(
        mut include_builtin: impl FnMut(&ToolManifest) -> bool,
        providers: &[&dyn ToolManifestProvider],
    ) -> Result<Self, ToolFsError> {
        let mut manifests = builtin_manifests();
        manifests.retain(|manifest| include_builtin(manifest));
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
            .collect::<Vec<_>>();
        if tools.is_empty() {
            return Err(ToolFsError::new(
                "tool_directory_not_found",
                format!("Tool directory was not found or is empty: {normalized}"),
                "Call tool_fs_list with /tools to discover available directories.",
            ));
        }
        self.sort_manifest_refs(&mut tools, scene);
        let total = tools.len();
        let start = page.saturating_mul(page_size).min(total);
        let end = (start + page_size).min(total);
        let tools = tools[start..end]
            .iter()
            .map(|manifest| compact_directory_tool_entry(manifest))
            .collect::<Vec<_>>();
        Ok(ToolDirectory {
            kind: "tool_fs_directory".to_string(),
            path: normalized,
            directories: Vec::new(),
            tools,
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
                run_hint: run_hint_for_manifest(&entry.manifest),
                mini_schema: mini_schema_for_manifest(&entry.manifest),
                score: round_score(entry.score),
                matched_fields: entry.matched_fields.clone(),
                match_reason: entry.match_reason.clone(),
                recommended_next_action: "If miniSchema covers the needed arguments, call tool_fs_run directly with this path or handle; call tool_fs_inspect only when argument details are unclear.".to_string(),
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
                "content": "Search first with tool_fs_search using a natural-language task description for non-code domains. If search does not find the capability, browse /tools by domain with tool_fs_list, inspect a concrete tool path, then call tool_fs_run with that path or a pinned handle. Provider-visible Tool-FS tools are fixed to tool_fs_search, tool_fs_list, tool_fs_read_doc, tool_fs_inspect, and tool_fs_run. For project code work, use the direct exec_command tool for rg/sed/cat/git/tests and the direct apply_patch tool for all file changes. For long scenario chains, read /tools/playbooks only when a playbook would materially help."
            }));
        }
        if normalized == "/tools/playbooks" {
            return Ok(json!({
                "kind": "tool_fs_doc",
                "path": "/tools/playbooks",
                "title": "Tool-FS scenario playbooks",
                "content": crate::scenario_playbooks_doc()
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

    pub(crate) fn resolve_target(
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
                "read browser page",
                "capture browser visual evidence",
                "open a workbench tab",
                "render a quick table",
                "update the todo list",
                "search project memory"
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

    fn sort_manifest_refs(&self, tools: &mut [&ToolManifest], scene: ToolScene) {
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

fn compact_directory_tool_entry(manifest: &ToolManifest) -> ToolDirectoryToolEntry {
    ToolDirectoryToolEntry {
        path: manifest.path.clone(),
        handle: manifest.handle.clone(),
        title: manifest.title.clone(),
        domain: manifest.domain.clone(),
        operation: manifest.operation.clone(),
        summary: manifest.summary.clone(),
        risk_level: manifest.risk_level.clone(),
        permission_policy: manifest.permission_policy.clone(),
        run_hint: run_hint_for_manifest(manifest),
        recommended_next_action:
            "Call tool_fs_run when this compact entry is enough; call tool_fs_inspect for the full input schema, examples, aliases, or long description."
                .to_string(),
    }
}

fn run_hint_for_manifest(manifest: &ToolManifest) -> String {
    let target = manifest
        .handle
        .as_deref()
        .map(|handle| format!("toolHandle: {handle}"))
        .unwrap_or_else(|| format!("path: {}", manifest.path));
    format!(
        "tool_fs_run with {target}; operation: {}; provide args matching miniSchema.",
        manifest.operation
    )
}

fn mini_schema_for_manifest(manifest: &ToolManifest) -> Value {
    let schema = &manifest.input_schema;
    let mut required = schema
        .get("required")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    required.sort();
    let required_set = required.iter().cloned().collect::<HashSet<_>>();
    let properties = schema
        .get("properties")
        .and_then(Value::as_object)
        .map(|properties| {
            let mut entries = properties
                .iter()
                .map(|(name, value)| (name.as_str(), value))
                .collect::<Vec<_>>();
            entries.sort_by(|left, right| {
                required_set
                    .contains(left.0)
                    .cmp(&required_set.contains(right.0))
                    .reverse()
                    .then_with(|| left.0.cmp(right.0))
            });
            entries
                .into_iter()
                .take(12)
                .map(|(name, value)| {
                    let mut summary = serde_json::Map::new();
                    summary.insert("name".to_string(), Value::String(name.to_string()));
                    summary.insert(
                        "required".to_string(),
                        Value::Bool(required_set.contains(name)),
                    );
                    if let Some(kind) = value.get("type") {
                        summary.insert("type".to_string(), kind.clone());
                    }
                    if let Some(default) = value.get("default") {
                        summary.insert("default".to_string(), default.clone());
                    }
                    if let Some(max_length) = value.get("maxLength") {
                        summary.insert("maxLength".to_string(), max_length.clone());
                    }
                    if let Some(enum_values) = value.get("enum") {
                        summary.insert("enum".to_string(), enum_values.clone());
                    }
                    if let Some(description) = value
                        .get("description")
                        .and_then(Value::as_str)
                        .map(|description| description.chars().take(160).collect::<String>())
                    {
                        summary.insert("description".to_string(), Value::String(description));
                    }
                    Value::Object(summary)
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({
        "type": schema.get("type").cloned().unwrap_or_else(|| Value::String("object".to_string())),
        "required": required,
        "parameters": properties,
        "truncated": schema
            .get("properties")
            .and_then(Value::as_object)
            .is_some_and(|properties| properties.len() > 12),
    })
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
