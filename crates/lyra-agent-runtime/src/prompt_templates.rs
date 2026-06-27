use minijinja::{AutoEscape, Environment, UndefinedBehavior};
use serde_json::Value;
use sha2::{Digest, Sha256};

const TEMPLATES: &[(&str, &str)] = &[
    ("kernel.md.j2", include_str!("prompts/kernel.md.j2")),
    (
        "interaction_contract.md.j2",
        include_str!("prompts/interaction_contract.md.j2"),
    ),
    (
        "compact_contract.md.j2",
        include_str!("prompts/compact_contract.md.j2"),
    ),
    (
        "full_contract.md.j2",
        include_str!("prompts/full_contract.md.j2"),
    ),
    (
        "plan_mode.md.j2",
        include_str!("prompts/plan_mode.md.j2"),
    ),
    (
        "browser_scene.md.j2",
        include_str!("prompts/browser_scene.md.j2"),
    ),
    (
        "computer_scene.md.j2",
        include_str!("prompts/computer_scene.md.j2"),
    ),
    (
        "citation_scene.md.j2",
        include_str!("prompts/citation_scene.md.j2"),
    ),
    (
        "image_scene.md.j2",
        include_str!("prompts/image_scene.md.j2"),
    ),
    (
        "active_skill.md.j2",
        include_str!("prompts/active_skill.md.j2"),
    ),
    (
        "memory_context.md.j2",
        include_str!("prompts/memory_context.md.j2"),
    ),
    (
        "dynamic_context.md.j2",
        include_str!("prompts/dynamic_context.md.j2"),
    ),
    (
        "prompt_accounting.md.j2",
        include_str!("prompts/prompt_accounting.md.j2"),
    ),
];

pub(crate) fn render_template(name: &str, context: Value) -> Result<String, String> {
    let mut env = Environment::new();
    env.set_undefined_behavior(UndefinedBehavior::Strict);
    env.set_auto_escape_callback(|_| AutoEscape::None);
    for (template_name, source) in TEMPLATES {
        env.add_template(template_name, source)
            .map_err(|error| error.to_string())?;
    }
    env.get_template(name)
        .map_err(|error| error.to_string())?
        .render(context)
        .map_err(|error| error.to_string())
        .map(|text| text.trim().to_string())
}

pub(crate) fn templates_fingerprint() -> String {
    let mut hasher = Sha256::new();
    for (template_name, source) in TEMPLATES {
        hasher.update(template_name.as_bytes());
        hasher.update([0]);
        hasher.update(source.as_bytes());
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn render_uses_strict_undefined_and_no_escape() {
        let rendered = render_template(
            "memory_context.md.j2",
            json!({ "memory_prompt": "A < B && C > D" }),
        )
        .expect("render");
        assert!(rendered.contains("A < B && C > D"));
        assert!(!rendered.contains("&lt;"));
        assert!(render_template("memory_context.md.j2", json!({})).is_err());
    }
}
