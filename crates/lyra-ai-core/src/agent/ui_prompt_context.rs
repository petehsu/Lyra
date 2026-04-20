use std::path::Path;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UiStyleProfile {
    Adaptive,
    SystemAligned,
    BrandExpressive,
    ProductiveMinimal,
}

impl UiStyleProfile {
    pub fn prompt_label(self) -> &'static str {
        match self {
            Self::Adaptive => "adaptive",
            Self::SystemAligned => "system_aligned",
            Self::BrandExpressive => "brand_expressive",
            Self::ProductiveMinimal => "productive_minimal",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "adaptive" => Some(Self::Adaptive),
            "system_aligned" | "system-aligned" | "systemaligned" => Some(Self::SystemAligned),
            "brand_expressive" | "brand-expressive" | "brandexpressive" => {
                Some(Self::BrandExpressive)
            }
            "productive_minimal" | "productive-minimal" | "productiveminimal" => {
                Some(Self::ProductiveMinimal)
            }
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UiStackPolicy {
    PreserveExisting,
    RecommendModern,
}

impl UiStackPolicy {
    pub fn prompt_label(self) -> &'static str {
        match self {
            Self::PreserveExisting => "preserve_existing_stack",
            Self::RecommendModern => "recommend_modern_stack",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UiPromptContext {
    pub task_detection_mode: String,
    pub target_surface: String,
    pub style_profile: UiStyleProfile,
    pub style_reason: String,
    pub style_override: Option<String>,
    pub style_profile_source: String,
    pub style_layer_precedence: String,
    pub style_layer_trace: String,
    pub style_conflict_resolution: String,
    pub style_control_policy: String,
    pub stack_policy: UiStackPolicy,
    pub detected_stack_summary: String,
    pub stack_policy_note: String,
    pub stack_confirmation_rule: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct UiStyleContextLayers<'a> {
    pub plugin_style: Option<&'a str>,
    pub user_style: Option<&'a str>,
    pub project_style: Option<&'a str>,
    pub requested_profile: Option<&'a str>,
}

pub fn derive_ui_prompt_context(user_input: &str, project_root: Option<&str>) -> UiPromptContext {
    derive_ui_prompt_context_with_layers(user_input, project_root, UiStyleContextLayers::default())
}

pub fn derive_ui_prompt_context_with_layers(
    _user_input: &str,
    project_root: Option<&str>,
    layers: UiStyleContextLayers<'_>,
) -> UiPromptContext {
    let detected_stack = detect_frontend_stack(project_root);
    let detected_stack_summary = if detected_stack.is_empty() {
        "- none".to_string()
    } else {
        detected_stack
            .into_iter()
            .map(|entry| format!("- {entry}"))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let target_surface = detect_target_surface(project_root);
    let (stack_policy, stack_policy_note, stack_confirmation_rule) = if detected_stack_summary
        == "- none"
    {
        (
                UiStackPolicy::RecommendModern,
                "No established frontend stack was detected. You may suggest a modern stack when it improves delivery speed or UX quality."
                    .to_string(),
                "Before scaffolding or migrating stack choices, confirm with `request_user_input` unless the user explicitly named the stack."
                    .to_string(),
            )
    } else {
        (
                UiStackPolicy::PreserveExisting,
                "Existing frontend stack detected. Preserve framework and design-system continuity by default."
                    .to_string(),
                "If migration might help but was not explicitly requested, use `request_user_input` with tradeoffs before changing stack direction."
                    .to_string(),
            )
    };

    let built_in_profile = if detected_stack_summary == "- none" {
        UiStyleProfile::Adaptive
    } else {
        UiStyleProfile::SystemAligned
    };
    let mut effective_profile = built_in_profile;
    let mut effective_source = "built_in".to_string();
    let mut conflict_notes = Vec::<String>::new();
    let mut layer_trace = vec![format!(
        "- built_in: {} (from project/context defaults)",
        built_in_profile.prompt_label()
    )];

    apply_style_layer(
        "plugin",
        layers.plugin_style,
        &mut effective_profile,
        &mut effective_source,
        &mut conflict_notes,
        &mut layer_trace,
    );
    let user_layer_style =
        non_empty_opt(layers.requested_profile).or(non_empty_opt(layers.user_style));
    apply_style_layer(
        "user",
        user_layer_style,
        &mut effective_profile,
        &mut effective_source,
        &mut conflict_notes,
        &mut layer_trace,
    );
    apply_style_layer(
        "project",
        layers.project_style,
        &mut effective_profile,
        &mut effective_source,
        &mut conflict_notes,
        &mut layer_trace,
    );

    let style_conflict_resolution = if conflict_notes.is_empty() {
        "No style-profile conflicts detected across configured layers.".to_string()
    } else {
        conflict_notes.join("; ")
    };

    let style_override = non_empty_opt(layers.project_style)
        .or(non_empty_opt(user_layer_style))
        .or(non_empty_opt(layers.plugin_style))
        .map(str::to_string);

    let style_reason = format!(
        "Avoid keyword-trigger routing. Active profile `{}` selected from `{}` using semantic/context layers.",
        effective_profile.prompt_label(),
        effective_source
    );

    UiPromptContext {
        task_detection_mode: "model_decides_without_keyword_routing".to_string(),
        target_surface,
        style_profile: effective_profile,
        style_reason,
        style_override,
        style_profile_source: effective_source,
        style_layer_precedence: "built_in < plugin < user < project".to_string(),
        style_layer_trace: layer_trace.join("\n"),
        style_conflict_resolution,
        style_control_policy:
            "UI capability is always available. Interpret style intent semantically with deterministic precedence (built_in < plugin < user < project), never via keyword classifiers."
                .to_string(),
        stack_policy,
        detected_stack_summary,
        stack_policy_note,
        stack_confirmation_rule,
    }
}

fn detect_target_surface(project_root: Option<&str>) -> String {
    let Some(root) = project_root.filter(|value| !value.trim().is_empty()) else {
        return "frontend UI (model decides per task)".to_string();
    };
    let path = Path::new(root);

    let has_desktop = path
        .join("apps")
        .join("desktop")
        .join("package.json")
        .exists()
        || path.join("src-tauri").exists();
    let has_mobile = path.join("android").exists()
        || path.join("ios").exists()
        || path.join("app").join("build.gradle").exists()
        || path.join("app").join("build.gradle.kts").exists()
        || path.join("pubspec.yaml").exists();
    let has_web = path.join("web").exists()
        || path.join("frontend").exists()
        || path.join("next.config.js").exists()
        || path.join("next.config.mjs").exists()
        || path.join("next.config.ts").exists()
        || path.join("vite.config.ts").exists()
        || path.join("vite.config.js").exists();

    let surface_count = usize::from(has_desktop) + usize::from(has_mobile) + usize::from(has_web);
    if surface_count > 1 {
        return "multi-surface frontend".to_string();
    }
    if has_web {
        return "web UI".to_string();
    }
    if has_desktop {
        return "desktop application UI".to_string();
    }
    if has_mobile {
        return "mobile application UI".to_string();
    }
    "frontend UI (model decides per task)".to_string()
}

fn non_empty_opt(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|entry| !entry.is_empty())
}

fn apply_style_layer(
    source: &str,
    layer: Option<&str>,
    effective_profile: &mut UiStyleProfile,
    effective_source: &mut String,
    conflict_notes: &mut Vec<String>,
    layer_trace: &mut Vec<String>,
) {
    let Some(value) = non_empty_opt(layer) else {
        layer_trace.push(format!("- {source}: none"));
        return;
    };
    if let Some(candidate) = UiStyleProfile::parse(value) {
        if *effective_profile != candidate {
            conflict_notes.push(format!(
                "{source} overrode profile {} -> {}",
                effective_profile.prompt_label(),
                candidate.prompt_label()
            ));
        }
        *effective_profile = candidate;
        *effective_source = source.to_string();
        layer_trace.push(format!(
            "- {source}: {} (profile override)",
            candidate.prompt_label()
        ));
        return;
    }
    layer_trace.push(format!(
        "- {source}: {} (guidance only, no profile override)",
        value
    ));
}

fn detect_frontend_stack(project_root: Option<&str>) -> Vec<String> {
    let Some(root) = project_root.filter(|value| !value.trim().is_empty()) else {
        return Vec::new();
    };
    let root_path = Path::new(root);
    let mut stacks = Vec::new();

    if root_path.join("package.json").exists() {
        stacks.push("Node frontend workspace (`package.json`)".to_string());
    }
    if root_path.join("next.config.js").exists()
        || root_path.join("next.config.mjs").exists()
        || root_path.join("next.config.ts").exists()
    {
        stacks.push("Next.js".to_string());
    }
    if root_path.join("vite.config.ts").exists() || root_path.join("vite.config.js").exists() {
        stacks.push("Vite".to_string());
    }
    if root_path.join("angular.json").exists() {
        stacks.push("Angular".to_string());
    }
    if root_path.join("nuxt.config.ts").exists() || root_path.join("nuxt.config.js").exists() {
        stacks.push("Nuxt".to_string());
    }
    if root_path
        .join("apps")
        .join("desktop")
        .join("package.json")
        .exists()
    {
        stacks.push("Desktop app workspace (`apps/desktop`)".to_string());
    }
    if root_path.join("src-tauri").exists() {
        stacks.push("Tauri".to_string());
    }
    if root_path.join("app").join("build.gradle").exists()
        || root_path.join("app").join("build.gradle.kts").exists()
        || root_path.join("android").exists()
    {
        stacks.push("Android".to_string());
    }
    if root_path.join("ios").exists() || root_path.join("Podfile").exists() {
        stacks.push("iOS".to_string());
    }
    if root_path.join("pubspec.yaml").exists() {
        stacks.push("Flutter".to_string());
    }

    stacks
}

#[cfg(test)]
mod tests {
    use super::{
        derive_ui_prompt_context, derive_ui_prompt_context_with_layers, UiStackPolicy,
        UiStyleContextLayers, UiStyleProfile,
    };

    #[test]
    fn routing_is_not_keyword_based() {
        let context_a = derive_ui_prompt_context("Design a bold futuristic landing page", None);
        let context_b = derive_ui_prompt_context("Fix rust lifetime issue", None);

        assert_eq!(
            context_a.task_detection_mode,
            "model_decides_without_keyword_routing"
        );
        assert_eq!(context_a.task_detection_mode, context_b.task_detection_mode);
        assert_eq!(context_a.style_profile, UiStyleProfile::Adaptive);
        assert_eq!(context_a.style_profile, context_b.style_profile);
        assert_eq!(context_a.stack_policy, context_b.stack_policy);
    }

    #[test]
    fn stack_policy_preserves_existing_when_frontend_stack_detected() {
        let temp_root = std::env::temp_dir().join("lyra-ui-context-stack-policy");
        let _ = std::fs::remove_dir_all(&temp_root);
        std::fs::create_dir_all(&temp_root).expect("create temp root");
        std::fs::write(temp_root.join("package.json"), "{\"name\":\"demo\"}")
            .expect("write package json");

        let root_string = temp_root.to_string_lossy().to_string();
        let context = derive_ui_prompt_context("any request", Some(&root_string));
        assert_eq!(context.stack_policy, UiStackPolicy::PreserveExisting);
        assert!(context.detected_stack_summary.contains("package.json"));

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn target_surface_uses_project_structure_signals() {
        let temp_root = std::env::temp_dir().join("lyra-ui-context-surface-signals");
        let _ = std::fs::remove_dir_all(&temp_root);
        std::fs::create_dir_all(temp_root.join("apps").join("desktop"))
            .expect("create desktop workspace");
        std::fs::write(
            temp_root.join("apps").join("desktop").join("package.json"),
            "{\"name\":\"desktop\"}",
        )
        .expect("write desktop package");
        std::fs::create_dir_all(temp_root.join("web")).expect("create web workspace");

        let root_string = temp_root.to_string_lossy().to_string();
        let context = derive_ui_prompt_context("any request", Some(&root_string));
        assert_eq!(context.target_surface, "multi-surface frontend");

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn style_layers_follow_precedence_order() {
        let context = derive_ui_prompt_context_with_layers(
            "design a workspace shell",
            None,
            UiStyleContextLayers {
                plugin_style: Some("system_aligned"),
                user_style: Some("brand_expressive"),
                project_style: Some("productive_minimal"),
                requested_profile: None,
            },
        );
        assert_eq!(context.style_profile, UiStyleProfile::ProductiveMinimal);
        assert_eq!(context.style_profile_source, "project");
        assert!(context.style_layer_trace.contains("built_in"));
        assert!(context.style_layer_trace.contains("plugin"));
        assert!(context.style_layer_trace.contains("user"));
        assert!(context.style_layer_trace.contains("project"));
    }

    #[test]
    fn requested_profile_is_applied_as_user_layer() {
        let context = derive_ui_prompt_context_with_layers(
            "refresh dashboard visuals",
            None,
            UiStyleContextLayers {
                plugin_style: Some("system_aligned"),
                user_style: None,
                project_style: None,
                requested_profile: Some("brand_expressive"),
            },
        );
        assert_eq!(context.style_profile, UiStyleProfile::BrandExpressive);
        assert_eq!(context.style_profile_source, "user");
    }
}
