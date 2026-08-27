//! Dynamic Skill capability manifests for the Tool-FS registry.
//!
//! The static skills domain only registers skill *management* tools
//! (install/list/inspect/...). An installed skill's actual capability —
//! its `toolPaths` from the skill manifest — was invisible to
//! tool_fs_search. This module projects each installed skill into the
//! registry as a `/tools/skills/capability/<id>` manifest so discovery
//! finds it directly.

use serde_json::{json, Value};

use super::*;

/// Path prefix for dynamic skill capability manifests.
pub(super) const SKILLS_CAPABILITY_PREFIX: &str = "/tools/skills/capability";

/// Parse `/tools/skills/capability/<id>` into the skill id.
pub(crate) fn parse_skill_capability_path(path: &str) -> Option<String> {
    let rest = path.strip_prefix(SKILLS_CAPABILITY_PREFIX)?;
    let rest = rest.strip_prefix('/')?;
    if rest.is_empty() || rest.contains('/') {
        return None;
    }
    Some(
        urlencoding::decode(rest)
            .unwrap_or_default()
            .into_owned(),
    )
}

pub(crate) fn skill_capability_path(skill_id: &str) -> String {
    format!(
        "{SKILLS_CAPABILITY_PREFIX}/{}",
        urlencoding::encode(skill_id)
    )
}

/// Build dynamic Tool-FS manifests for installed skills.
///
/// Each installed skill contributes one manifest. Invoking the capability
/// surfaces the skill's tool paths (its capability surface) — the skill
/// prompt is activated through the existing skills domain tools.
pub(super) fn skill_capability_manifests() -> (Vec<ToolManifest>, Vec<Value>) {
    let registry = crate::native_backend::skill_catalog::registry_snapshot();
    let manifests = registry
        .installed
        .iter()
        .map(|skill| {
            let path = skill_capability_path(&skill.id);
            let summary = skill
                .manifest
                .description
                .lines()
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();
            let summary = if summary.is_empty() {
                format!("Use the installed skill {}.", skill.manifest.name)
            } else {
                summary
            };
            let tool_paths = skill_tool_paths(skill);
            ToolManifest {
                path: path.clone(),
                handle: None,
                domain: "skills".to_string(),
                operation: "invoke_capability".to_string(),
                title: skill.manifest.name.clone(),
                summary: summary.clone(),
                description: format!(
                    "Invoke the installed Lyra skill {}. {} The skill's tool paths are resolved through the skills domain tools.",
                    skill.manifest.name, summary
                ),
                aliases: vec![
                    skill.id.clone(),
                    skill.manifest.name.clone(),
                    "skill".to_string(),
                ],
                examples: vec![
                    format!("Use the {} skill.", skill.manifest.name),
                    format!("Invoke skill {}.", skill.id),
                ],
                tags: vec![
                    "skills".to_string(),
                    "capability".to_string(),
                    skill.id.clone(),
                ],
                risk_level: "standard".to_string(),
                permission_policy: "allowed".to_string(),
                input_schema: attach_schema_id(&path, skill_capability_input_schema(&tool_paths)),
                output_kind: "json".to_string(),
                activity_kind: "skill".to_string(),
                renderer_hint: "skill".to_string(),
            }
        })
        .collect();
    let diagnostics = if registry.installed.is_empty() {
        vec![json!({
            "code": "dynamic_provider_empty",
            "domain": "skills",
            "message": "No skills are installed. Use /tools/skills/install from a store or git source.",
            "recoverable": true,
        })]
    } else {
        Vec::new()
    };
    (manifests, diagnostics)
}

fn skill_tool_paths(skill: &crate::native_backend::skill_catalog::InstalledSkill) -> Vec<Value> {
    skill
        .manifest
        .tool_paths
        .iter()
        .map(|path| json!(path))
        .collect()
}

/// The executable envelope for a skill capability: `input` carries optional
/// caller-provided context; the skill's tool paths are embedded as
/// documentation so inspect shows what the skill can reach.
fn skill_capability_input_schema(tool_paths: &[Value]) -> Value {
    let mut input = json!({
        "type": "string",
        "description": "Optional task context for the skill invocation.",
    });
    if !tool_paths.is_empty() {
        if let Some(object) = input.as_object_mut() {
            object.insert(
                "skillToolPaths".to_string(),
                json!({
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Tool paths this skill exposes.",
                    "value": tool_paths,
                }),
            );
        }
    }
    json!({
        "type": "object",
        "properties": {
            "input": input
        },
        "required": [],
    })
}