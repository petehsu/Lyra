use crate::provider::types::AgentToolDefinition;

mod browser_use;
mod workbench;

use super::catalog::{
    all_builtin_tool_specs, decorated_builtin_definition, standard_builtin_tool_specs,
    BuiltinToolSpec, ToolExecutionMode,
};
use super::external::{
    decorated_tool_definition, registered_external_tools, ExternalToolApprovalMode,
    ExternalToolSideEffectLevel, ExternalToolSideEffects, RegisteredExternalTool,
};
use super::routing::browser_strategy::BrowserStrategyRoutingContext;
use super::routing::browser_strategy_prefilter::browser_strategy_prefilter_bonus;
use super::routing::web_context::WorkbenchWebRoutingContext;
use super::routing::workbench_web_prefilter::workbench_web_prefilter_bonus;

#[derive(Clone, Copy)]
enum ToolAvailabilityMode {
    Standard,
    Plan,
}

#[derive(Clone)]
struct ToolPlanningProfile {
    definition: AgentToolDefinition,
    execution_mode: ToolExecutionMode,
    approval_mode: ExternalToolApprovalMode,
    side_effects: ExternalToolSideEffects,
    source_bias: i32,
}

#[derive(Clone, Debug, Default)]
pub struct ToolRankingContext {
    pub workbench_web: Option<WorkbenchWebRoutingContext>,
    pub browser_strategy: Option<BrowserStrategyRoutingContext>,
}

pub fn ranked_standard_tool_definitions(user_input: &str) -> Vec<AgentToolDefinition> {
    ranked_standard_tool_definitions_with_context(user_input, None)
}

pub fn ranked_plan_tool_definitions(user_input: &str) -> Vec<AgentToolDefinition> {
    ranked_plan_tool_definitions_with_context(user_input, None)
}

pub fn ranked_standard_tool_definitions_with_context(
    user_input: &str,
    context: Option<&ToolRankingContext>,
) -> Vec<AgentToolDefinition> {
    rank_tools_for_input(user_input, ToolAvailabilityMode::Standard, context)
}

pub fn ranked_plan_tool_definitions_with_context(
    user_input: &str,
    context: Option<&ToolRankingContext>,
) -> Vec<AgentToolDefinition> {
    rank_tools_for_input(user_input, ToolAvailabilityMode::Plan, context)
}

fn rank_tools_for_input(
    user_input: &str,
    mode: ToolAvailabilityMode,
    context: Option<&ToolRankingContext>,
) -> Vec<AgentToolDefinition> {
    let mut tools = builtin_tool_profiles(mode);
    if matches!(mode, ToolAvailabilityMode::Standard) {
        tools.extend(external_tool_profiles());
    }

    tools.sort_by(|left, right| {
        let left_score = planning_score(left, user_input, mode, context);
        let right_score = planning_score(right, user_input, mode, context);
        right_score
            .cmp(&left_score)
            .then_with(|| left.definition.name.cmp(&right.definition.name))
    });

    tools.into_iter().map(|tool| tool.definition).collect()
}

fn builtin_tool_profiles(mode: ToolAvailabilityMode) -> Vec<ToolPlanningProfile> {
    let specs = match mode {
        ToolAvailabilityMode::Standard => standard_builtin_tool_specs(),
        ToolAvailabilityMode::Plan => all_builtin_tool_specs()
            .into_iter()
            .filter(|tool| tool.available_in_plan_mode)
            .collect(),
    };
    specs.into_iter().map(builtin_tool_profile).collect()
}

fn builtin_tool_profile(tool: BuiltinToolSpec) -> ToolPlanningProfile {
    ToolPlanningProfile {
        definition: decorated_builtin_definition(&tool),
        execution_mode: tool.execution_mode,
        approval_mode: tool.approval_mode,
        side_effects: tool.side_effects,
        source_bias: 2,
    }
}

fn external_tool_profiles() -> Vec<ToolPlanningProfile> {
    registered_external_tools()
        .into_iter()
        .map(external_tool_profile)
        .collect()
}

fn external_tool_profile(tool: RegisteredExternalTool) -> ToolPlanningProfile {
    ToolPlanningProfile {
        definition: decorated_tool_definition(&tool),
        execution_mode: tool.execution_mode,
        approval_mode: tool.metadata.approval_mode,
        side_effects: tool.metadata.side_effects,
        source_bias: 0,
    }
}

fn planning_score(
    tool: &ToolPlanningProfile,
    _user_input: &str,
    mode: ToolAvailabilityMode,
    context: Option<&ToolRankingContext>,
) -> i32 {
    let risk_penalty = risk_penalty(tool);
    let routing_bonus = workbench_web_prefilter_bonus(
        &tool.definition.name,
        tool.approval_mode,
        &tool.side_effects,
        context.and_then(|value| value.workbench_web.as_ref()),
    );
    let browser_strategy_bonus = browser_strategy_prefilter_bonus(
        &tool.definition.name,
        context.and_then(|value| value.browser_strategy.as_ref()),
    );
    intrinsic_tool_priority(tool, mode) - risk_penalty
        + tool.source_bias
        + routing_bonus
        + browser_strategy_bonus
        + browser_workflow_escape_penalty(&tool.definition.name, context)
}

fn browser_workflow_escape_penalty(tool_name: &str, context: Option<&ToolRankingContext>) -> i32 {
    let Some(context) = context else {
        return 0;
    };
    let Some(web) = context.workbench_web.as_ref() else {
        return 0;
    };
    let in_browser_workflow = web.page_mode.is_some()
        && (web.widget_graph_ready
            || web.native_widget_ready
            || web.active_widget_id.is_some()
            || web.has_live_candidates);
    if !in_browser_workflow {
        return 0;
    }

    match tool_name {
        "terminal.exec"
        | "terminal.session.start"
        | "terminal.session.write"
        | "terminal.session.read"
        | "terminal.session.close" => -120,
        "memory.recall" => -96,
        "workbench.tab.capture_visual" => -72,
        "workbench.web_graph.build" => {
            if web.focus_atlas_ready || web.widget_graph_ready || web.native_widget_ready {
                -96
            } else {
                0
            }
        }
        "workbench.web_graph.query" => {
            if web.focus_atlas_ready || web.widget_graph_ready || web.native_widget_ready {
                -72
            } else {
                0
            }
        }
        _ => 0,
    }
}

fn risk_penalty(tool: &ToolPlanningProfile) -> i32 {
    let approval_penalty = match tool.approval_mode {
        ExternalToolApprovalMode::Auto => 0,
        ExternalToolApprovalMode::Ask => 12,
        ExternalToolApprovalMode::Deny => 64,
    };

    let mut side_effect_penalty = match tool.side_effects.level {
        ExternalToolSideEffectLevel::ReadOnly => 0,
        ExternalToolSideEffectLevel::NetworkRead => 3,
        ExternalToolSideEffectLevel::SessionMutation => 8,
        ExternalToolSideEffectLevel::WorkspaceWrite => 16,
        ExternalToolSideEffectLevel::ExternalMutation => 24,
    };
    if tool.side_effects.mutates_workspace {
        side_effect_penalty += 4;
    }
    if tool.side_effects.mutates_memory {
        side_effect_penalty += 2;
    }
    if tool.side_effects.mutates_external_systems {
        side_effect_penalty += 6;
    }
    if tool.side_effects.opens_interactive_session {
        side_effect_penalty += 5;
    }
    if tool.side_effects.reads_network {
        side_effect_penalty += 1;
    }

    let execution_penalty = if tool.execution_mode.executes_serially() {
        2
    } else {
        0
    };

    approval_penalty + side_effect_penalty + execution_penalty
}

fn intrinsic_tool_priority(tool: &ToolPlanningProfile, mode: ToolAvailabilityMode) -> i32 {
    let name = tool.definition.name.as_str();
    if name.starts_with("workbench.") {
        return workbench::tool_priority(tool);
    }
    if name.starts_with("browser_use.") {
        return browser_use::tool_priority(tool);
    }

    if matches!(mode, ToolAvailabilityMode::Plan) {
        return match name {
            "request_user_input" => 50,
            "plan.update_draft" => 48,
            "plan.submit_for_approval" => 46,
            _ => default_tool_priority(name),
        };
    }

    default_tool_priority(name)
}

fn default_tool_priority(name: &str) -> i32 {
    match name {
        "filesystem.list" | "filesystem.glob" | "filesystem.search" | "filesystem.read_range" => 34,
        "lsp.goto_definition" | "lsp.find_references" | "lsp.hover" | "lsp.get_diagnostics" => 30,
        "memory.recall" => 24,
        "terminal.session.read" => 18,
        "request_user_input" => 16,
        "plan.update_draft" => 14,
        "plan.submit_for_approval" => 12,
        "memory.remember" => 10,
        "filesystem.write" | "filesystem.edit" | "filesystem.multi_edit" => 8,
        "terminal.exec" => 6,
        "terminal.session.start" | "terminal.session.write" | "terminal.session.close" => 4,
        _ => 0,
    }
}
