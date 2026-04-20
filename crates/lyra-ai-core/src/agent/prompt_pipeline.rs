use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use once_cell::sync::Lazy;
use regex::{Captures, Regex};

use crate::agent::persona_runtime::get_persona_runtime_state;
use crate::agent::prompt_repetition::build_task_anchor_excerpt;
use crate::agent::turn_strategy::TurnStrategy;
use crate::agent::types::AgentPlanState;
use crate::agent::ui_prompt_context::{derive_ui_prompt_context_with_layers, UiStyleContextLayers};
use crate::memory::MemoryPromptSnapshot;

const STATIC_IDENTITY: &str = include_str!("prompts/static/identity.md");
const STATIC_PLAN_MODE: &str = include_str!("prompts/static/plan_mode.md");
const STATIC_EXECUTION_CONTRACT: &str = include_str!("prompts/static/execution_contract.md");
const STATIC_CORE_PRINCIPLES: &str = include_str!("prompts/static/core_principles.md");
const STATIC_CAPABILITY_MODEL: &str = include_str!("prompts/static/capability_model.md");
const STATIC_SAFETY_RULES: &str = include_str!("prompts/static/safety_rules.md");
const STATIC_TOOL_FRAMEWORK: &str = include_str!("prompts/static/tool_framework.md");
const STATIC_OUTPUT_FORMAT: &str = include_str!("prompts/static/output_format.md");
const STATIC_UI_DESIGN_CAPABILITY: &str = include_str!("prompts/static/ui_design_capability.md");

const DYNAMIC_SESSION_CONTEXT: &str = include_str!("prompts/dynamic/session_context.md");
const DYNAMIC_PERSONA_RUNTIME: &str = include_str!("prompts/dynamic/persona_runtime.md");
const DYNAMIC_ENV_INFO: &str = include_str!("prompts/dynamic/env_info.md");
const DYNAMIC_TASK_PROGRESS: &str = include_str!("prompts/dynamic/task_progress.md");
const DYNAMIC_TURN_STRATEGY: &str = include_str!("prompts/dynamic/turn_strategy.md");
const DYNAMIC_TASK_REREAD: &str = include_str!("prompts/dynamic/task_reread.md");
const DYNAMIC_PLAN_STATE: &str = include_str!("prompts/dynamic/plan_state.md");
const DYNAMIC_MEMORY_SNAPSHOT: &str = include_str!("prompts/dynamic/memory_snapshot.md");
const DYNAMIC_USER_PREFERENCES: &str = include_str!("prompts/dynamic/user_preferences.md");
const DYNAMIC_ACTIVE_SKILLS: &str = include_str!("prompts/dynamic/active_skills.md");
const DYNAMIC_MCP_TOOLS: &str = include_str!("prompts/dynamic/mcp_tools.md");
const DYNAMIC_BROWSER_ENGINE_CONTEXT: &str =
    include_str!("prompts/dynamic/browser_engine_context.md");
const DYNAMIC_BROWSER_WORKFLOW_CONTEXT: &str =
    include_str!("prompts/dynamic/browser_workflow_context.md");
const DYNAMIC_UI_DESIGN_CONTEXT: &str = include_str!("prompts/dynamic/ui_design_context.md");

const RESPONSE_LANGUAGE_RULES: &str = r#"## Response Language

- Respond in the same language as the user's latest message unless the user explicitly requests a different language.
- If the language is ambiguous, default to English.
"#;

const UNKNOWN_VALUE: &str = "unknown";

const MAX_MEMORY_RECALL_TOKENS: usize = 700;
const MAX_USER_PREFERENCES_TOKENS: usize = 300;
const MAX_FROZEN_FACTS_TOKENS: usize = 350;
const MAX_CURRENT_TASK_TOKENS: usize = 500;
const MAX_TASK_REREAD_TOKENS: usize = 220;
const MAX_ACTIVE_SKILLS_TOKENS: usize = 800;
const MAX_MCP_TOOLS_TOKENS: usize = 900;
const MAX_PLAN_DRAFT_TOKENS: usize = 1200;
const MAX_PLAN_PROPOSED_TOKENS: usize = 1200;
const MAX_PLAN_APPROVED_TOKENS: usize = 900;
const MAX_UI_STYLE_REASON_TOKENS: usize = 120;
const MAX_UI_STACK_SIGNALS_TOKENS: usize = 220;
const MAX_UI_POLICY_NOTE_TOKENS: usize = 200;
const MAX_UI_LAYER_TRACE_TOKENS: usize = 260;
const MAX_UI_CONFLICT_NOTE_TOKENS: usize = 200;

static PLACEHOLDER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\{([a-zA-Z0-9_]+)\}").expect("valid placeholder regex"));
static RESIDUAL_PLACEHOLDER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"\{[a-zA-Z0-9_-]+\}").expect("valid residual placeholder regex"));

#[derive(Clone, Debug)]
pub struct PromptBuildInput<'a> {
    pub session_id: &'a str,
    pub turn_number: usize,
    pub user_input: &'a str,
    pub project_root: Option<&'a str>,
    pub memory_snapshot: &'a MemoryPromptSnapshot,
    pub activated_skill_prompts: &'a str,
    pub mcp_tools_json: &'a str,
    pub execution_profile: Option<&'a str>,
    pub approval_profile: Option<&'a str>,
    pub turn_strategy: &'a TurnStrategy,
    pub ui_style_profile: Option<&'a str>,
    pub ui_style_plugin: Option<&'a str>,
    pub ui_style_user: Option<&'a str>,
    pub ui_style_project: Option<&'a str>,
    pub browser_engine_preference: Option<&'a str>,
    pub browser_use_health: Option<&'a str>,
    pub browser_tool_families: &'a str,
    pub browser_page_mode: Option<&'a str>,
    pub focus_atlas_status: Option<&'a str>,
    pub active_widget_id: Option<&'a str>,
    pub active_item_id: Option<&'a str>,
    pub active_focus_region_id: Option<&'a str>,
    pub current_browser_subgoal: Option<&'a str>,
    pub last_reveal_observed: Option<&'a str>,
    pub last_workflow_failure: Option<&'a str>,
}

#[derive(Clone, Debug, Default)]
pub struct PromptBuildResult {
    pub prompt: String,
    pub total_tokens: usize,
    pub section_tokens: BTreeMap<String, usize>,
    pub truncated_sections: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PromptAssemblyMode {
    Standard,
    Plan,
}

#[derive(Clone, Copy, Debug)]
struct PromptSectionSpec {
    id: &'static str,
    template: &'static str,
    include_standard: bool,
    include_plan: bool,
    ui_only: bool,
}

const PROMPT_SECTION_SPECS: &[PromptSectionSpec] = &[
    PromptSectionSpec {
        id: "identity",
        template: STATIC_IDENTITY,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "persona_runtime",
        template: DYNAMIC_PERSONA_RUNTIME,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "plan_mode",
        template: STATIC_PLAN_MODE,
        include_standard: false,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "task_progress",
        template: DYNAMIC_TASK_PROGRESS,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "turn_strategy",
        template: DYNAMIC_TURN_STRATEGY,
        include_standard: true,
        include_plan: false,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "plan_state",
        template: DYNAMIC_PLAN_STATE,
        include_standard: false,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "execution_contract",
        template: STATIC_EXECUTION_CONTRACT,
        include_standard: true,
        include_plan: false,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "core_principles",
        template: STATIC_CORE_PRINCIPLES,
        include_standard: true,
        include_plan: false,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "ui_design_capability",
        template: STATIC_UI_DESIGN_CAPABILITY,
        include_standard: true,
        include_plan: true,
        ui_only: true,
    },
    PromptSectionSpec {
        id: "tool_framework",
        template: STATIC_TOOL_FRAMEWORK,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "output_format",
        template: STATIC_OUTPUT_FORMAT,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "response_language",
        template: RESPONSE_LANGUAGE_RULES,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "safety_rules",
        template: STATIC_SAFETY_RULES,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "capability_model",
        template: STATIC_CAPABILITY_MODEL,
        include_standard: true,
        include_plan: false,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "session_context",
        template: DYNAMIC_SESSION_CONTEXT,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "env_info",
        template: DYNAMIC_ENV_INFO,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "memory_snapshot",
        template: DYNAMIC_MEMORY_SNAPSHOT,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "user_preferences",
        template: DYNAMIC_USER_PREFERENCES,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "active_skills",
        template: DYNAMIC_ACTIVE_SKILLS,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "ui_design_context",
        template: DYNAMIC_UI_DESIGN_CONTEXT,
        include_standard: true,
        include_plan: true,
        ui_only: true,
    },
    PromptSectionSpec {
        id: "browser_engine_context",
        template: DYNAMIC_BROWSER_ENGINE_CONTEXT,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "browser_workflow_context",
        template: DYNAMIC_BROWSER_WORKFLOW_CONTEXT,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "mcp_tools",
        template: DYNAMIC_MCP_TOOLS,
        include_standard: true,
        include_plan: true,
        ui_only: false,
    },
    PromptSectionSpec {
        id: "task_reread",
        template: DYNAMIC_TASK_REREAD,
        include_standard: true,
        include_plan: false,
        ui_only: false,
    },
];

pub fn build_system_prompt(input: &PromptBuildInput<'_>) -> PromptBuildResult {
    let mut truncated_sections = Vec::new();
    let raw_task_description = if input.user_input.trim().is_empty() {
        UNKNOWN_VALUE.to_string()
    } else {
        format!("User request: {}", input.user_input.trim())
    };
    let current_task_description = clamp_tokens(
        "current_task_description",
        &raw_task_description,
        MAX_CURRENT_TASK_TOKENS,
        &mut truncated_sections,
    );
    let task_reread_excerpt = build_task_anchor_excerpt(input.user_input, MAX_TASK_REREAD_TOKENS);
    if estimate_tokens(input.user_input.trim()) > MAX_TASK_REREAD_TOKENS {
        mark_truncated("task_reread", &mut truncated_sections);
    }

    let memory_recall = clamp_tokens(
        "memory_recall_results",
        &input.memory_snapshot.memory_recall_results,
        MAX_MEMORY_RECALL_TOKENS,
        &mut truncated_sections,
    );
    let user_preferences_memory = clamp_tokens(
        "user_habits_and_preferences",
        &input.memory_snapshot.user_habits_and_preferences,
        MAX_USER_PREFERENCES_TOKENS,
        &mut truncated_sections,
    );
    let frozen_facts = clamp_tokens(
        "frozen_memory_facts",
        &input.memory_snapshot.frozen_memory_facts,
        MAX_FROZEN_FACTS_TOKENS,
        &mut truncated_sections,
    );
    let activated_skills = clamp_tokens(
        "activated_skill_prompts",
        if input.activated_skill_prompts.trim().is_empty() {
            "- none"
        } else {
            input.activated_skill_prompts
        },
        MAX_ACTIVE_SKILLS_TOKENS,
        &mut truncated_sections,
    );
    let mcp_tools_json = clamp_tokens(
        "mcp_tools_json",
        if input.mcp_tools_json.trim().is_empty() {
            "[]"
        } else {
            input.mcp_tools_json
        },
        MAX_MCP_TOOLS_TOKENS,
        &mut truncated_sections,
    );
    let ui_prompt_context = derive_ui_prompt_context_with_layers(
        input.user_input,
        input.project_root,
        UiStyleContextLayers {
            plugin_style: input.ui_style_plugin,
            user_style: input.ui_style_user,
            project_style: input.ui_style_project,
            requested_profile: input.ui_style_profile,
        },
    );

    let mut vars = BTreeMap::<String, String>::new();
    vars.insert("session_id".to_string(), non_empty(input.session_id));
    vars.insert("turn_number".to_string(), input.turn_number.to_string());
    vars.insert(
        "execution_profile".to_string(),
        input
            .execution_profile
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "approval_profile".to_string(),
        input
            .approval_profile
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    insert_browser_context_vars(&mut vars, input);
    vars.insert(
        "current_task_description".to_string(),
        current_task_description,
    );
    vars.insert(
        "todo_items_with_status".to_string(),
        input.turn_strategy.todo_items().to_string(),
    );
    vars.insert("task_reread_excerpt".to_string(), task_reread_excerpt);
    vars.insert(
        "turn_strategy_name".to_string(),
        input.turn_strategy.prompt_name().to_string(),
    );
    vars.insert(
        "turn_strategy_summary".to_string(),
        input.turn_strategy.prompt_summary().to_string(),
    );
    vars.insert(
        "turn_strategy_reasoning_intensity".to_string(),
        input.turn_strategy.reasoning_intensity().to_string(),
    );
    vars.insert(
        "turn_strategy_planning_policy".to_string(),
        input.turn_strategy.prompt_planning_policy().to_string(),
    );
    vars.insert(
        "turn_strategy_question_policy".to_string(),
        input.turn_strategy.prompt_question_policy().to_string(),
    );
    vars.insert(
        "turn_strategy_request_user_input_enabled".to_string(),
        if input.turn_strategy.request_user_input_enabled() {
            "true".to_string()
        } else {
            "false".to_string()
        },
    );
    vars.insert(
        "turn_strategy_tool_budget".to_string(),
        input.turn_strategy.prompt_tool_budget().to_string(),
    );
    vars.insert(
        "turn_strategy_stop_condition".to_string(),
        input.turn_strategy.prompt_stop_condition().to_string(),
    );
    vars.insert(
        "turn_strategy_guidance".to_string(),
        input.turn_strategy.prompt_guidance().to_string(),
    );
    vars.insert("memory_recall_results".to_string(), memory_recall);
    vars.insert(
        "user_habits_and_preferences".to_string(),
        user_preferences_memory,
    );
    vars.insert("frozen_memory_facts".to_string(), frozen_facts);
    vars.insert("activated_skill_prompts".to_string(), activated_skills);
    vars.insert(
        "detected_project_stacks".to_string(),
        detect_project_stacks(input.project_root),
    );
    vars.insert("mcp_tools_json".to_string(), mcp_tools_json);
    insert_persona_runtime_vars(&mut vars);
    insert_environment_vars(&mut vars, input.project_root);

    vars.insert("language".to_string(), "follow_user".to_string());
    vars.insert("coding_style_notes".to_string(), UNKNOWN_VALUE.to_string());
    vars.insert("preferred_shell".to_string(), UNKNOWN_VALUE.to_string());
    vars.insert("editor".to_string(), UNKNOWN_VALUE.to_string());

    insert_ui_prompt_context_vars(&mut vars, &ui_prompt_context, &mut truncated_sections);

    build_prompt_from_sections(
        PromptAssemblyMode::Standard,
        &vars,
        true,
        truncated_sections,
    )
}

pub fn build_plan_mode_system_prompt(
    input: &PromptBuildInput<'_>,
    plan_state: Option<&AgentPlanState>,
    reentry_guidance: &str,
) -> PromptBuildResult {
    let mut truncated_sections = Vec::new();
    let plan = plan_state.cloned().unwrap_or(AgentPlanState {
        status: crate::agent::types::AgentPlanStatus::Draft,
        version: 0,
        draft_markdown: String::new(),
        proposed_markdown: None,
        approved_markdown: None,
        last_submitted_version: None,
        updated_at: 0,
    });
    let memory_recall = clamp_tokens(
        "memory_recall_results",
        &input.memory_snapshot.memory_recall_results,
        MAX_MEMORY_RECALL_TOKENS,
        &mut truncated_sections,
    );
    let user_preferences_memory = clamp_tokens(
        "user_habits_and_preferences",
        &input.memory_snapshot.user_habits_and_preferences,
        MAX_USER_PREFERENCES_TOKENS,
        &mut truncated_sections,
    );
    let frozen_facts = clamp_tokens(
        "frozen_memory_facts",
        &input.memory_snapshot.frozen_memory_facts,
        MAX_FROZEN_FACTS_TOKENS,
        &mut truncated_sections,
    );
    let activated_skills = clamp_tokens(
        "activated_skill_prompts",
        if input.activated_skill_prompts.trim().is_empty() {
            "- none"
        } else {
            input.activated_skill_prompts
        },
        MAX_ACTIVE_SKILLS_TOKENS,
        &mut truncated_sections,
    );
    let mcp_tools_json = clamp_tokens(
        "mcp_tools_json",
        if input.mcp_tools_json.trim().is_empty() {
            "[]"
        } else {
            input.mcp_tools_json
        },
        MAX_MCP_TOOLS_TOKENS,
        &mut truncated_sections,
    );
    let draft_markdown = clamp_tokens(
        "plan_draft_markdown",
        if plan.draft_markdown.trim().is_empty() {
            "- none"
        } else {
            &plan.draft_markdown
        },
        MAX_PLAN_DRAFT_TOKENS,
        &mut truncated_sections,
    );
    let proposed_markdown = clamp_tokens(
        "plan_proposed_markdown",
        plan.proposed_markdown.as_deref().unwrap_or("- none"),
        MAX_PLAN_PROPOSED_TOKENS,
        &mut truncated_sections,
    );
    let approved_markdown = clamp_tokens(
        "plan_approved_markdown",
        plan.approved_markdown.as_deref().unwrap_or("- none"),
        MAX_PLAN_APPROVED_TOKENS,
        &mut truncated_sections,
    );
    let ui_prompt_context = derive_ui_prompt_context_with_layers(
        input.user_input,
        input.project_root,
        UiStyleContextLayers {
            plugin_style: input.ui_style_plugin,
            user_style: input.ui_style_user,
            project_style: input.ui_style_project,
            requested_profile: input.ui_style_profile,
        },
    );

    let mut vars = BTreeMap::<String, String>::new();
    vars.insert("session_id".to_string(), non_empty(input.session_id));
    vars.insert("turn_number".to_string(), input.turn_number.to_string());
    vars.insert("memory_recall_results".to_string(), memory_recall);
    vars.insert(
        "user_habits_and_preferences".to_string(),
        user_preferences_memory,
    );
    vars.insert("frozen_memory_facts".to_string(), frozen_facts);
    vars.insert("activated_skill_prompts".to_string(), activated_skills);
    vars.insert(
        "detected_project_stacks".to_string(),
        detect_project_stacks(input.project_root),
    );
    vars.insert("mcp_tools_json".to_string(), mcp_tools_json);
    insert_persona_runtime_vars(&mut vars);
    vars.insert(
        "plan_status".to_string(),
        format!("{:?}", plan.status).to_lowercase(),
    );
    vars.insert("plan_version".to_string(), plan.version.to_string());
    vars.insert(
        "plan_last_submitted_version".to_string(),
        plan.last_submitted_version
            .map(|value| value.to_string())
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "plan_reentry_guidance".to_string(),
        non_empty(reentry_guidance),
    );
    vars.insert("plan_draft_markdown".to_string(), draft_markdown);
    vars.insert("plan_proposed_markdown".to_string(), proposed_markdown);
    vars.insert("plan_approved_markdown".to_string(), approved_markdown);
    vars.insert(
        "current_task_description".to_string(),
        clamp_tokens(
            "current_task_description",
            if input.user_input.trim().is_empty() {
                UNKNOWN_VALUE
            } else {
                input.user_input.trim()
            },
            MAX_CURRENT_TASK_TOKENS,
            &mut truncated_sections,
        ),
    );
    insert_browser_context_vars(&mut vars, input);
    insert_environment_vars(&mut vars, input.project_root);

    insert_ui_prompt_context_vars(&mut vars, &ui_prompt_context, &mut truncated_sections);

    build_prompt_from_sections(PromptAssemblyMode::Plan, &vars, true, truncated_sections)
}

fn build_prompt_from_sections(
    mode: PromptAssemblyMode,
    vars: &BTreeMap<String, String>,
    include_ui_sections: bool,
    truncated_sections: Vec<String>,
) -> PromptBuildResult {
    let mut section_tokens = BTreeMap::new();
    let mut rendered_sections = Vec::new();

    for spec in PROMPT_SECTION_SPECS {
        let mode_enabled = match mode {
            PromptAssemblyMode::Standard => spec.include_standard,
            PromptAssemblyMode::Plan => spec.include_plan,
        };
        if !mode_enabled {
            continue;
        }
        if spec.ui_only && !include_ui_sections {
            continue;
        }

        let content = render_template(spec.template, vars);
        let normalized = content.trim();
        if normalized.is_empty() {
            continue;
        }
        let tokens = estimate_tokens(normalized);
        section_tokens.insert(spec.id.to_string(), tokens);
        rendered_sections.push(normalized.to_string());
    }

    let prompt = PLACEHOLDER_RE
        .replace_all(&rendered_sections.join("\n\n"), UNKNOWN_VALUE)
        .to_string();
    debug_assert!(
        !RESIDUAL_PLACEHOLDER_RE.is_match(&prompt),
        "system prompt contains unresolved placeholders"
    );
    let total_tokens = estimate_tokens(&prompt);

    PromptBuildResult {
        prompt,
        total_tokens,
        section_tokens,
        truncated_sections,
    }
}

fn insert_browser_context_vars(vars: &mut BTreeMap<String, String>, input: &PromptBuildInput<'_>) {
    vars.insert(
        "browser_engine_preference".to_string(),
        input
            .browser_engine_preference
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "browser_use_health".to_string(),
        input
            .browser_use_health
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "browser_tool_families".to_string(),
        non_empty(input.browser_tool_families),
    );
    vars.insert(
        "browser_page_mode".to_string(),
        input
            .browser_page_mode
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "focus_atlas_status".to_string(),
        input
            .focus_atlas_status
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "active_widget_id".to_string(),
        input
            .active_widget_id
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "active_item_id".to_string(),
        input
            .active_item_id
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "active_focus_region_id".to_string(),
        input
            .active_focus_region_id
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "current_browser_subgoal".to_string(),
        input
            .current_browser_subgoal
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "last_reveal_observed".to_string(),
        input
            .last_reveal_observed
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "last_workflow_failure".to_string(),
        input
            .last_workflow_failure
            .map(non_empty)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
}

fn insert_environment_vars(vars: &mut BTreeMap<String, String>, project_root: Option<&str>) {
    let runtime_cwd = std::env::current_dir()
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| UNKNOWN_VALUE.to_string());
    let cwd = resolve_effective_prompt_cwd(project_root, &runtime_cwd);
    vars.insert("os".to_string(), std::env::consts::OS.to_string());
    vars.insert("cwd".to_string(), cwd.clone());
    vars.insert(
        "project_root".to_string(),
        project_root
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| "unbound".to_string()),
    );
    vars.insert(
        "shell".to_string(),
        std::env::var("SHELL")
            .or_else(|_| std::env::var("ComSpec"))
            .unwrap_or_else(|_| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "node_version".to_string(),
        read_command_line_output("node", &["--version"], None)
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "python_version".to_string(),
        read_command_line_output("python3", &["--version"], None)
            .or_else(|| read_command_line_output("python", &["--version"], None))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "git_branch".to_string(),
        read_command_line_output(
            "git",
            &["rev-parse", "--abbrev-ref", "HEAD"],
            project_root.or(Some(runtime_cwd.as_str())),
        )
        .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert("open_files".to_string(), UNKNOWN_VALUE.to_string());
}

fn insert_ui_prompt_context_vars(
    vars: &mut BTreeMap<String, String>,
    context: &crate::agent::ui_prompt_context::UiPromptContext,
    truncated_sections: &mut Vec<String>,
) {
    vars.insert(
        "ui_task_detected".to_string(),
        non_empty(&context.task_detection_mode),
    );
    vars.insert(
        "ui_target_surface".to_string(),
        non_empty(&context.target_surface),
    );
    vars.insert(
        "ui_style_control_policy".to_string(),
        clamp_tokens(
            "ui_style_control_policy",
            &context.style_control_policy,
            MAX_UI_POLICY_NOTE_TOKENS,
            truncated_sections,
        ),
    );
    vars.insert(
        "ui_style_profile".to_string(),
        context.style_profile.prompt_label().to_string(),
    );
    vars.insert(
        "ui_style_reason".to_string(),
        clamp_tokens(
            "ui_style_reason",
            &context.style_reason,
            MAX_UI_STYLE_REASON_TOKENS,
            truncated_sections,
        ),
    );
    vars.insert(
        "ui_style_override".to_string(),
        context
            .style_override
            .as_deref()
            .map(non_empty)
            .unwrap_or_else(|| "none".to_string()),
    );
    vars.insert(
        "ui_style_source".to_string(),
        non_empty(&context.style_profile_source),
    );
    vars.insert(
        "ui_style_layer_precedence".to_string(),
        non_empty(&context.style_layer_precedence),
    );
    vars.insert(
        "ui_style_layer_trace".to_string(),
        clamp_tokens(
            "ui_style_layer_trace",
            &context.style_layer_trace,
            MAX_UI_LAYER_TRACE_TOKENS,
            truncated_sections,
        ),
    );
    vars.insert(
        "ui_style_conflict_resolution".to_string(),
        clamp_tokens(
            "ui_style_conflict_resolution",
            &context.style_conflict_resolution,
            MAX_UI_CONFLICT_NOTE_TOKENS,
            truncated_sections,
        ),
    );
    vars.insert(
        "ui_stack_policy".to_string(),
        context.stack_policy.prompt_label().to_string(),
    );
    vars.insert(
        "ui_detected_frontend_stack".to_string(),
        clamp_tokens(
            "ui_detected_frontend_stack",
            &context.detected_stack_summary,
            MAX_UI_STACK_SIGNALS_TOKENS,
            truncated_sections,
        ),
    );
    vars.insert(
        "ui_stack_policy_note".to_string(),
        clamp_tokens(
            "ui_stack_policy_note",
            &context.stack_policy_note,
            MAX_UI_POLICY_NOTE_TOKENS,
            truncated_sections,
        ),
    );
    vars.insert(
        "ui_stack_confirmation_rule".to_string(),
        clamp_tokens(
            "ui_stack_confirmation_rule",
            &context.stack_confirmation_rule,
            MAX_UI_POLICY_NOTE_TOKENS,
            truncated_sections,
        ),
    );
}

pub fn estimate_tokens(text: &str) -> usize {
    text.len().div_ceil(4)
}

fn non_empty(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        UNKNOWN_VALUE.to_string()
    } else {
        trimmed.to_string()
    }
}

fn insert_persona_runtime_vars(vars: &mut BTreeMap<String, String>) {
    let runtime = get_persona_runtime_state();
    let persona_name = runtime.persona_name.unwrap_or_else(|| "Lyra".to_string());
    let company_name = runtime.company_name.unwrap_or_else(|| "Lyra".to_string());
    let company_description = runtime.company_description.unwrap_or_else(|| {
        "Lyra is a cross-functional company where teams handle engineering, operations, product delivery, and business execution.".to_string()
    });
    let coworker_label = runtime
        .coworker_label
        .unwrap_or_else(|| "coworker".to_string());

    vars.insert("persona_name".to_string(), non_empty(&persona_name));
    vars.insert("company_name".to_string(), non_empty(&company_name));
    vars.insert(
        "company_description".to_string(),
        non_empty(&company_description),
    );
    vars.insert("coworker_label".to_string(), non_empty(&coworker_label));
    vars.insert(
        "local_time".to_string(),
        runtime
            .local_time
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "timezone".to_string(),
        runtime
            .timezone
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "locale".to_string(),
        runtime
            .locale
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "location_display".to_string(),
        runtime
            .location_display
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "location_source".to_string(),
        runtime
            .location_source
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "location_confidence".to_string(),
        runtime
            .location_confidence
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "location_detail".to_string(),
        runtime
            .location_detail
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "physical_location_display".to_string(),
        runtime
            .physical_location_display
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "ip_location_display".to_string(),
        runtime
            .ip_location_display
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "ip_address".to_string(),
        runtime
            .ip_address
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "device_name".to_string(),
        runtime
            .device_name
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "device_profile".to_string(),
        runtime
            .device_profile
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "persona_os_name".to_string(),
        runtime
            .os_name
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "persona_os_version".to_string(),
        runtime
            .os_version
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "persona_architecture".to_string(),
        runtime
            .architecture
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "persona_cpu_model".to_string(),
        runtime
            .cpu_model
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "persona_cpu_cores".to_string(),
        runtime
            .cpu_cores
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
    vars.insert(
        "persona_memory_gb".to_string(),
        runtime
            .memory_gb
            .map(|value| non_empty(&value))
            .unwrap_or_else(|| UNKNOWN_VALUE.to_string()),
    );
}

fn clamp_tokens(
    section: &str,
    value: &str,
    max_tokens: usize,
    truncated_sections: &mut Vec<String>,
) -> String {
    if max_tokens == 0 {
        mark_truncated(section, truncated_sections);
        return "[truncated]".to_string();
    }
    if estimate_tokens(value) <= max_tokens {
        return non_empty(value);
    }
    let max_chars = max_tokens.saturating_mul(4);
    let mut clipped = value.chars().take(max_chars).collect::<String>();
    clipped.push_str("\n[truncated]");
    mark_truncated(section, truncated_sections);
    clipped
}

fn mark_truncated(section: &str, truncated_sections: &mut Vec<String>) {
    if !truncated_sections.iter().any(|entry| entry == section) {
        truncated_sections.push(section.to_string());
    }
}

fn render_template(template: &str, vars: &BTreeMap<String, String>) -> String {
    PLACEHOLDER_RE
        .replace_all(template, |caps: &Captures<'_>| {
            let key = caps.get(1).map(|m| m.as_str()).unwrap_or_default();
            vars.get(key)
                .cloned()
                .unwrap_or_else(|| UNKNOWN_VALUE.to_string())
        })
        .to_string()
}

fn read_command_line_output(program: &str, args: &[&str], cwd: Option<&str>) -> Option<String> {
    let mut command = Command::new(program);
    command.args(args);
    if let Some(path) = cwd {
        if !path.trim().is_empty() {
            command.current_dir(path);
        }
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn detect_project_stacks(project_root: Option<&str>) -> String {
    let Some(root) = project_root.filter(|path| !path.trim().is_empty()) else {
        return "- none (project root unavailable)".to_string();
    };
    let root_path = Path::new(root);
    let mut detected = Vec::new();

    if root_path.join("package.json").exists() {
        detected.push("TypeScript/JavaScript (`package.json` detected)");
    }
    if root_path.join("Cargo.toml").exists() {
        detected.push("Rust (`Cargo.toml` detected)");
    }
    if root_path.join("pyproject.toml").exists() || root_path.join("requirements.txt").exists() {
        detected.push("Python (`pyproject.toml` or `requirements.txt` detected)");
    }
    if root_path.join("go.mod").exists() {
        detected.push("Go (`go.mod` detected)");
    }
    if root_path.join("Gemfile").exists() {
        detected.push("Ruby (`Gemfile` detected)");
    }

    if detected.is_empty() {
        "- none".to_string()
    } else {
        detected
            .into_iter()
            .map(|entry| format!("- {entry}"))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn resolve_effective_prompt_cwd(project_root: Option<&str>, runtime_cwd: &str) -> String {
    project_root
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| runtime_cwd.to_string())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs::{create_dir_all, write};
    use std::path::PathBuf;

    use super::{
        build_plan_mode_system_prompt, build_system_prompt, estimate_tokens, render_template,
        PromptBuildInput,
    };
    use crate::agent::turn_strategy::select_turn_strategy;
    use crate::memory::MemoryPromptSnapshot;

    fn sample_snapshot() -> MemoryPromptSnapshot {
        MemoryPromptSnapshot {
            memory_recall_results: "- [shared:project] Keep API responses deterministic."
                .to_string(),
            user_habits_and_preferences: "- [shared:user] Prefers concise summaries.".to_string(),
            frozen_memory_facts: "- [frozen:user] User name: Pete.".to_string(),
        }
    }

    #[test]
    fn builds_prompt_without_unresolved_placeholders() {
        let snapshot = sample_snapshot();
        let strategy = select_turn_strategy("Please fix the failing test.");
        let result = build_system_prompt(&PromptBuildInput {
            session_id: "agent-session-1",
            turn_number: 3,
            user_input: "Please fix the failing test.",
            project_root: None,
            memory_snapshot: &snapshot,
            activated_skill_prompts: "- Rust skill active",
            mcp_tools_json: "[]",
            execution_profile: Some("standard"),
            approval_profile: Some("ask-on-risk"),
            turn_strategy: &strategy,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: None,
            browser_use_health: None,
            browser_tool_families: "lyra.web.*",
            browser_page_mode: None,
            focus_atlas_status: None,
            active_widget_id: None,
            active_item_id: None,
            active_focus_region_id: None,
            current_browser_subgoal: None,
            last_reveal_observed: None,
            last_workflow_failure: None,
        });
        assert!(result.prompt.contains("in-house execution specialist"));
        assert!(!result.prompt.contains("{session_id}"));
        assert!(result.total_tokens > 0);
    }

    #[test]
    fn truncates_large_sections_and_marks_them() {
        let very_large = "x".repeat(30_000);
        let snapshot = MemoryPromptSnapshot {
            memory_recall_results: very_large.clone(),
            user_habits_and_preferences: very_large.clone(),
            frozen_memory_facts: very_large.clone(),
        };
        let strategy = select_turn_strategy("Refactor this module.");
        let result = build_system_prompt(&PromptBuildInput {
            session_id: "agent-session-1",
            turn_number: 9,
            user_input: "Refactor this module.",
            project_root: None,
            memory_snapshot: &snapshot,
            activated_skill_prompts: &very_large,
            mcp_tools_json: &very_large,
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &strategy,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: None,
            browser_use_health: None,
            browser_tool_families: "lyra.web.*",
            browser_page_mode: None,
            focus_atlas_status: None,
            active_widget_id: None,
            active_item_id: None,
            active_focus_region_id: None,
            current_browser_subgoal: None,
            last_reveal_observed: None,
            last_workflow_failure: None,
        });
        assert!(result
            .truncated_sections
            .iter()
            .any(|entry| entry == "activated_skill_prompts"));
        assert!(result.prompt.contains("[truncated]"));
        assert!(estimate_tokens(&result.prompt) > 0);
    }

    #[test]
    fn detects_project_stacks_from_root_files() {
        let root = std::env::temp_dir().join("lyra-prompt-stack-detect-test");
        let _ = std::fs::remove_dir_all(&root);
        create_dir_all(&root).expect("create temp project root");
        write(root.join("Cargo.toml"), "[package]\nname=\"demo\"\n").expect("write cargo");
        write(root.join("package.json"), "{\"name\":\"demo\"}").expect("write package");

        let snapshot = sample_snapshot();
        let root_string = root.to_string_lossy().to_string();
        let strategy = select_turn_strategy("Inspect project setup.");
        let result = build_system_prompt(&PromptBuildInput {
            session_id: "agent-session-1",
            turn_number: 1,
            user_input: "Inspect project setup.",
            project_root: Some(&root_string),
            memory_snapshot: &snapshot,
            activated_skill_prompts: "- none",
            mcp_tools_json: "[]",
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &strategy,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: None,
            browser_use_health: None,
            browser_tool_families: "lyra.web.*",
            browser_page_mode: None,
            focus_atlas_status: None,
            active_widget_id: None,
            active_item_id: None,
            active_focus_region_id: None,
            current_browser_subgoal: None,
            last_reveal_observed: None,
            last_workflow_failure: None,
        });

        assert!(result.prompt.contains("Cargo.toml"));
        assert!(result.prompt.contains("package.json"));
        let _ = std::fs::remove_dir_all(PathBuf::from(&root_string));
    }

    #[test]
    fn bound_project_root_becomes_effective_working_directory() {
        let root = std::env::temp_dir().join("lyra-prompt-bound-root-test");
        let _ = std::fs::remove_dir_all(&root);
        create_dir_all(&root).expect("create temp project root");

        let snapshot = sample_snapshot();
        let root_string = root.to_string_lossy().to_string();
        let strategy = select_turn_strategy("Build a company website.");
        let result = build_system_prompt(&PromptBuildInput {
            session_id: "agent-session-12",
            turn_number: 1,
            user_input: "Build a company website.",
            project_root: Some(&root_string),
            memory_snapshot: &snapshot,
            activated_skill_prompts: "- none",
            mcp_tools_json: "[]",
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &strategy,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: None,
            browser_use_health: None,
            browser_tool_families: "lyra.web.*",
            browser_page_mode: None,
            focus_atlas_status: None,
            active_widget_id: None,
            active_item_id: None,
            active_focus_region_id: None,
            current_browser_subgoal: None,
            last_reveal_observed: None,
            last_workflow_failure: None,
        });

        assert!(result
            .prompt
            .contains(&format!("- Bound Project Root: {root_string}")));
        assert!(result
            .prompt
            .contains(&format!("- Working Directory For Tool Use: {root_string}")));
        let _ = std::fs::remove_dir_all(PathBuf::from(&root_string));
    }

    #[test]
    fn unknown_placeholders_fall_back_to_unknown() {
        let rendered = render_template("value: {missing_key}", &BTreeMap::new());
        assert_eq!(rendered, "value: unknown");
    }

    #[test]
    fn active_skills_defaults_when_no_data_available() {
        let snapshot = sample_snapshot();
        let strategy = select_turn_strategy("Check context.");
        let result = build_system_prompt(&PromptBuildInput {
            session_id: "agent-session-1",
            turn_number: 2,
            user_input: "Check context.",
            project_root: None,
            memory_snapshot: &snapshot,
            activated_skill_prompts: "",
            mcp_tools_json: "[]",
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &strategy,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: None,
            browser_use_health: None,
            browser_tool_families: "lyra.web.*",
            browser_page_mode: None,
            focus_atlas_status: None,
            active_widget_id: None,
            active_item_id: None,
            active_focus_region_id: None,
            current_browser_subgoal: None,
            last_reveal_observed: None,
            last_workflow_failure: None,
        });
        assert!(result.prompt.contains("## Active Skills"));
        assert!(result.prompt.contains("- none"));
        assert!(result.prompt.contains("project root unavailable"));
    }

    #[test]
    fn ui_sections_are_included_for_frontend_requests() {
        let snapshot = sample_snapshot();
        let strategy = select_turn_strategy("Design a bold responsive landing page UI.");
        let result = build_system_prompt(&PromptBuildInput {
            session_id: "agent-session-ui-1",
            turn_number: 1,
            user_input: "Design a bold responsive landing page UI.",
            project_root: None,
            memory_snapshot: &snapshot,
            activated_skill_prompts: "- none",
            mcp_tools_json: "[]",
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &strategy,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: None,
            browser_use_health: None,
            browser_tool_families: "lyra.web.*",
            browser_page_mode: None,
            focus_atlas_status: None,
            active_widget_id: None,
            active_item_id: None,
            active_focus_region_id: None,
            current_browser_subgoal: None,
            last_reveal_observed: None,
            last_workflow_failure: None,
        });

        assert!(result.prompt.contains("## UI Design Capability"));
        assert!(result.prompt.contains("## UI Design Context"));
        assert!(result
            .prompt
            .contains("model_decides_without_keyword_routing"));
        assert!(result.prompt.contains("Active style profile: adaptive"));
        assert!(result.section_tokens.contains_key("ui_design_capability"));
        assert!(result.section_tokens.contains_key("ui_design_context"));
    }

    #[test]
    fn ui_sections_are_also_included_for_non_frontend_requests() {
        let snapshot = sample_snapshot();
        let strategy = select_turn_strategy("Fix rust borrow checker regression.");
        let result = build_system_prompt(&PromptBuildInput {
            session_id: "agent-session-ui-2",
            turn_number: 1,
            user_input: "Fix rust borrow checker regression.",
            project_root: None,
            memory_snapshot: &snapshot,
            activated_skill_prompts: "- none",
            mcp_tools_json: "[]",
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &strategy,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: None,
            browser_use_health: None,
            browser_tool_families: "lyra.web.*",
            browser_page_mode: None,
            focus_atlas_status: None,
            active_widget_id: None,
            active_item_id: None,
            active_focus_region_id: None,
            current_browser_subgoal: None,
            last_reveal_observed: None,
            last_workflow_failure: None,
        });

        assert!(result.prompt.contains("## UI Design Capability"));
        assert!(result.prompt.contains("## UI Design Context"));
        assert!(result.section_tokens.contains_key("ui_design_capability"));
        assert!(result.section_tokens.contains_key("ui_design_context"));
    }

    #[test]
    fn plan_mode_includes_ui_sections_for_frontend_requests() {
        let snapshot = sample_snapshot();
        let strategy = select_turn_strategy("Plan a premium homepage redesign UI.");
        let result = build_plan_mode_system_prompt(
            &PromptBuildInput {
                session_id: "agent-session-ui-plan-1",
                turn_number: 2,
                user_input: "Plan a premium homepage redesign UI.",
                project_root: None,
                memory_snapshot: &snapshot,
                activated_skill_prompts: "- none",
                mcp_tools_json: "[]",
                execution_profile: None,
                approval_profile: None,
                turn_strategy: &strategy,
                ui_style_profile: None,
                ui_style_plugin: None,
                ui_style_user: None,
                ui_style_project: None,
                browser_engine_preference: None,
                browser_use_health: None,
                browser_tool_families: "lyra.web.*",
                browser_page_mode: None,
                focus_atlas_status: None,
                active_widget_id: None,
                active_item_id: None,
                active_focus_region_id: None,
                current_browser_subgoal: None,
                last_reveal_observed: None,
                last_workflow_failure: None,
            },
            None,
            "continue planning",
        );

        assert!(result.prompt.contains("## UI Design Capability"));
        assert!(result.prompt.contains("## UI Design Context"));
        assert!(result.section_tokens.contains_key("ui_design_capability"));
        assert!(result.section_tokens.contains_key("ui_design_context"));
    }

    #[test]
    fn prompt_places_task_sections_up_front_and_reread_at_end() {
        let snapshot = sample_snapshot();
        let strategy = select_turn_strategy("Review the failing tests and fix the root cause.");
        let result = build_system_prompt(&PromptBuildInput {
            session_id: "agent-session-9",
            turn_number: 4,
            user_input: "Review the failing tests and fix the root cause.",
            project_root: None,
            memory_snapshot: &snapshot,
            activated_skill_prompts: "- Rust skill active",
            mcp_tools_json: "[]",
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &strategy,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: None,
            browser_use_health: None,
            browser_tool_families: "lyra.web.*",
            browser_page_mode: None,
            focus_atlas_status: None,
            active_widget_id: None,
            active_item_id: None,
            active_focus_region_id: None,
            current_browser_subgoal: None,
            last_reveal_observed: None,
            last_workflow_failure: None,
        });

        let current_task_index = result.prompt.find("## Current Task").expect("current task");
        let turn_strategy_index = result
            .prompt
            .find("## Turn Strategy")
            .expect("turn strategy");
        let execution_contract_index = result
            .prompt
            .find("## Execution Contract")
            .expect("execution contract");
        let tool_framework_index = result
            .prompt
            .find("## Tool Usage Framework")
            .expect("tool framework");
        let reread_index = result.prompt.rfind("## Task Re-read").expect("task reread");
        let mcp_index = result
            .prompt
            .rfind("## External Tools (MCP)")
            .expect("mcp tools");

        assert!(current_task_index < execution_contract_index);
        assert!(current_task_index < turn_strategy_index);
        assert!(turn_strategy_index < execution_contract_index);
        assert!(execution_contract_index < tool_framework_index);
        assert!(mcp_index < reread_index);
        assert!(result.prompt.contains("This is for focus only"));
    }

    #[test]
    fn long_tasks_are_truncated_in_task_sections() {
        let snapshot = sample_snapshot();
        let long_task = "Investigate the regression and keep all constraints intact. ".repeat(200);
        let strategy = select_turn_strategy(&long_task);
        let result = build_system_prompt(&PromptBuildInput {
            session_id: "agent-session-10",
            turn_number: 6,
            user_input: &long_task,
            project_root: None,
            memory_snapshot: &snapshot,
            activated_skill_prompts: "- none",
            mcp_tools_json: "[]",
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &strategy,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: None,
            browser_use_health: None,
            browser_tool_families: "lyra.web.*",
            browser_page_mode: None,
            focus_atlas_status: None,
            active_widget_id: None,
            active_item_id: None,
            active_focus_region_id: None,
            current_browser_subgoal: None,
            last_reveal_observed: None,
            last_workflow_failure: None,
        });

        assert!(result
            .truncated_sections
            .iter()
            .any(|section| section == "current_task_description"));
        assert!(result
            .truncated_sections
            .iter()
            .any(|section| section == "task_reread"));
        assert!(result.prompt.contains("[truncated]"));
        assert!(result.prompt.contains("[truncated repeat anchor]"));
    }

    #[test]
    fn observation_requests_now_use_standard_strategy_without_language_heuristics() {
        let snapshot = sample_snapshot();
        let strategy = select_turn_strategy("看一下电脑现在状态怎么样");
        let result = build_system_prompt(&PromptBuildInput {
            session_id: "agent-session-11",
            turn_number: 1,
            user_input: "看一下电脑现在状态怎么样",
            project_root: None,
            memory_snapshot: &snapshot,
            activated_skill_prompts: "- none",
            mcp_tools_json: "[]",
            execution_profile: None,
            approval_profile: None,
            turn_strategy: &strategy,
            ui_style_profile: None,
            ui_style_plugin: None,
            ui_style_user: None,
            ui_style_project: None,
            browser_engine_preference: None,
            browser_use_health: None,
            browser_tool_families: "lyra.web.*",
            browser_page_mode: None,
            focus_atlas_status: None,
            active_widget_id: None,
            active_item_id: None,
            active_focus_region_id: None,
            current_browser_subgoal: None,
            last_reveal_observed: None,
            last_workflow_failure: None,
        });

        assert!(result.prompt.contains("standard execution"));
        assert!(result.prompt.contains("Use the normal autonomous workflow"));
        assert!(!result.prompt.contains("bounded observational fast path"));
    }
}
