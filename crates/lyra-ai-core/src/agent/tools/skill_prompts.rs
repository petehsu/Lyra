use std::sync::Mutex;

use once_cell::sync::Lazy;

static SKILL_PROMPTS: Lazy<Mutex<Vec<SkillPromptEntry>>> = Lazy::new(|| Mutex::new(Vec::new()));

#[derive(Clone, Debug)]
pub struct SkillPromptEntry {
    pub skill_id: String,
    pub name: String,
    pub content: String,
}

pub fn set_skill_prompts(prompts: Vec<SkillPromptEntry>) {
    if let Ok(mut skills) = SKILL_PROMPTS.lock() {
        *skills = prompts;
    }
}

pub fn get_skill_prompts() -> Vec<SkillPromptEntry> {
    SKILL_PROMPTS.lock().map(|s| s.clone()).unwrap_or_default()
}

pub fn render_activated_skill_prompts() -> String {
    let skills = get_skill_prompts();
    if skills.is_empty() {
        return "- none".to_string();
    }
    skills
        .iter()
        .map(|entry| {
            format!(
                "- Skill `{}` (`{}`):\n{}\n",
                entry.name,
                entry.skill_id,
                entry.content.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}
