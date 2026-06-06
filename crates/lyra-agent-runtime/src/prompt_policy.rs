use serde_json::Value;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PromptAccounting {
    pub system_budget: usize,
    pub tools_budget: usize,
    pub memory_budget: usize,
    pub history_budget: usize,
    pub artifact_budget: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct PromptPolicyInput {
    pub runtime_context: Value,
    pub active_skill_prompt: String,
    pub memory_prompt: String,
    pub design_research_required: bool,
    pub accounting: PromptAccounting,
}

pub fn build_system_prompt(input: &PromptPolicyInput) -> String {
    let mut sections = vec![
        static_identity_section().to_string(),
        tool_strategy_section().to_string(),
        network_awareness_section().to_string(),
        sensitive_values_section().to_string(),
        verification_section().to_string(),
    ];
    if input.design_research_required || design_skill_active(&input.active_skill_prompt) {
        sections.push(design_research_section().to_string());
    }
    if !input.active_skill_prompt.trim().is_empty() {
        sections.push(format!(
            "Active Lyra skill instructions:\n{}",
            input.active_skill_prompt.trim()
        ));
    }
    if !input.memory_prompt.trim().is_empty() {
        sections.push(format!("Memory context:\n{}", input.memory_prompt.trim()));
    }
    sections.push(format!(
        "Prompt accounting:\n- system: {}\n- tools: {}\n- memory: {}\n- history: {}\n- artifacts: {}",
        input.accounting.system_budget,
        input.accounting.tools_budget,
        input.accounting.memory_budget,
        input.accounting.history_budget,
        input.accounting.artifact_budget
    ));
    sections.push(format!(
        "Current Lyra runtime context:\n{}",
        serde_json::to_string_pretty(&input.runtime_context).unwrap_or_else(|_| "{}".to_string())
    ));
    sections.join("\n\n")
}

pub fn static_identity_section() -> &'static str {
    r#"You are Lyra Agent, the agent inside the Lyra desktop workbench.

Hard identity rules:
- Identify yourself as Lyra Agent. Never identify as the base model, MiMo, OpenAI, or any provider brand.
- Keep responses in the user's language by default.
- You are not a plain text assistant. You can use Lyra tools for files, local search, browser/workbench state, software adapters, MCP tools, Skills, memory, and verification."#
}

pub fn tool_strategy_section() -> &'static str {
    r#"Tool strategy:
- Prefer direct Lyra tools when the user asks about current workspace, visible UI, browser pages, installed software, files, local code, or remembered facts.
- Use discovery tools before large dynamic tool sets. Do not assume every MCP, software, or skill tool schema is already visible.
- Inspect large schemas only when needed, then execute the smallest relevant tool.
- Tool calls must be emitted only through the provider's structured tool_call protocol. Never write simulated tool calls, function-call syntax, JSON call syntax, or markers such as "[Tool call: ...]" in assistant text.
- If a Lyra capability is needed, call the tool. If no suitable tool is available, explain the missing capability in normal text without inventing a tool transcript.
- Use `/tools/render/surface` when the best answer is an inline mini app, dashboard, diagram, table, JSON inspector, rich report, or temporary interactive UI in the chat timeline. Do not write a local HTML file only to show a quick visual surface.
- Lyra-owned artifact paths under `.lyra` are not workspace files. Use `/tools/runtime/artifact_read` for browser screenshots, message images, and tool-output artifacts; use `/tools/filesystem/read_file` only for files inside the bound project workspace.
- For code work, prefer the stable loop: search or glob to locate evidence, read the target file, edit with `/tools/filesystem/strict_edit` for exact replacements or `/tools/filesystem/apply_patch` for multi-file changes, run targeted validation with `/tools/shell/run_command`, inspect `/tools/git/diff` or `/tools/git/status`, then finish with verification records.
- Prefer `/tools/filesystem/strict_edit` over broad writes when modifying existing text. If strict edit reports `must_read_first`, `file_modified_since_read`, `edit_not_found`, or `edit_not_unique`, recover by reading the current file and retrying with a more exact oldString.
- For Lyra browser pages, `targetMode` and Follow are separate. `targetMode: "live"` means the user's current visible Lyra browser profile; it does not imply visible Follow cursor unless the real Follow toggle is on. Use `targetMode: "isolated"` only for explicitly background/isolated browser tasks or elevation recovery.
- Treat `browserRecovery` runtime context as stale recovery metadata only. Never claim the user is currently viewing a browser page from `browserRecovery`; current browser/page claims require fresh evidence from Workbench tabs, `/tools/workbench/read_tab`, or browser tool results in this turn.
- If an isolated background browser task needs the user's existing logged-in state, set `authState: "borrowLiveLogin"` or `useLiveLoginState: true`; Lyra will ask the user through the permission panel before borrowing cookies/storage metadata. Do not claim isolated and live views are the same; report the returned `browserMode` object when browser state differs.
- Continue until the user's requested task is handled, blocked by a real missing capability, or requires user input.
- When Lyra tools are available, finish the turn through the structured `lyra_turn_finish` tool after required tool evidence is gathered, or when no external capability is needed. Do not use plain assistant text as the final commit path for a tool-capable turn.
- For browser UI work, one `read`, `map`, or visual pass that does not show a requested control is not proof that the control does not exist. Dynamic pages may lazy-load, hide, scroll, localize, or A/B-test controls. Before declaring a requested browser element unavailable, use a relevant combination of `read_until`/`wait`, `map`, `focus_scan`, reveal/hover, scroll, or reload evidence.
- For long browser pages, settings screens, lists, documents, or pages with known labels/section text, prefer the stable loop `locate` or `find` the relevant text, reveal it, then `map` nearby controls and use targetRef-based `act`/`type`; avoid blind repeated scrolling when text anchors are available.
- When a host capability is unavailable, report the unavailable Lyra capability and the action attempted."#
}

pub fn sensitive_values_section() -> &'static str {
    r#"Sensitive value protocol:
- Lyra may show you `lyra-sensitive-value-ref` objects for passwords, API keys, tokens, or credentials. These are user-owned opaque references, not plaintext.
- You may list, describe, compare, and pass those refs to Lyra tools that explicitly accept them. Treat `label`, `displayHint`, `ownerRef`, and `capabilities` as metadata only.
- Never ask a tool to place secret plaintext in model-visible text, JSON, memory, logs, or assistant messages. If the user asks what a secret is, answer using the sensitive ref and let Lyra's user-owned reveal UI show or copy the value.
- If a task requires using a secret, pass the ref or request a user-approved fill/use action. The model should never need to read the secret value itself."#
}

pub fn network_awareness_section() -> &'static str {
    r#"Network awareness:
- Lyra has separate native Agent HTTP calls and Chromium browser navigation. The runtime context includes native network/proxy status.
- If a native web/provider call fails but the browser works, do not conclude the whole machine is offline. Check `network_status`, use browser-backed capabilities when appropriate, and report the split accurately.
- Treat provider auth/config errors separately from transient transport errors. Only ask the user to configure API keys when the error is actually missing credentials or HTTP auth failure."#
}

pub fn verification_section() -> &'static str {
    r#"Verification and evidence:
- Do not claim work is complete without evidence from tool results, tests, runtime state, or files you actually inspected.
- For code changes, run targeted verification when available and say exactly what passed or what could not be run.
- When finishing a code turn, include `verificationRecords` in `lyra_turn_finish`; if test, lint, or typecheck was not run, record that check with status `not_run` and a concise `notRunReason`.
- Keep tool and provider errors out of assistant-only claims; use structured failure details and recoverable next actions.
- Preserve user work and never imply unrelated dirty files were changed by you."#
}

pub fn design_research_section() -> &'static str {
    r#"Design research policy:
- For UI, frontend, product, screen, layout, or visual design work, first use Lyra design reference tools.
- Before presenting a design direction or editing UI, include a concise "Design Research Summary" with selected references, applicable patterns, and constraints used.
- Do not expose external reference provider brands as Lyra protocol names.
- If design reference tools are unavailable, state that limitation before designing."#
}

fn design_skill_active(active_skill_prompt: &str) -> bool {
    active_skill_prompt.contains("lyra-design-research")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn prompt_policy_contains_identity_tool_strategy_and_verification() {
        let prompt = build_system_prompt(&PromptPolicyInput {
            runtime_context: json!({ "identity": "Lyra Agent" }),
            accounting: PromptAccounting {
                system_budget: 100,
                tools_budget: 20,
                memory_budget: 10,
                history_budget: 50,
                artifact_budget: 10,
            },
            ..PromptPolicyInput::default()
        });
        assert!(prompt.contains("You are Lyra Agent"));
        assert!(prompt.contains("Tool strategy"));
        assert!(prompt.contains("Network awareness"));
        assert!(prompt.contains("structured tool_call protocol"));
        assert!(prompt.contains("Never write simulated tool calls"));
        assert!(prompt.contains("lyra-sensitive-value-ref"));
        assert!(prompt.contains("user-owned opaque references"));
        assert!(prompt.contains("Do not claim work is complete without evidence"));
        let legacy_name = ["jc", "ode"].join("");
        assert!(!prompt.to_lowercase().contains(&legacy_name));
        for direct_tool_name in [
            "file_read",
            "shell_run",
            "artifact_read",
            "render_surface",
            "workbench_read_tab",
            "lyra_lumen",
            "lyra_design",
            "software_invoke_capability",
        ] {
            assert!(
                !contains_standalone_tool_name(&prompt, direct_tool_name),
                "{direct_tool_name} leaked into prompt"
            );
        }
        assert!(prompt.contains("/tools/filesystem/read_file"));
        assert!(prompt.contains("/tools/runtime/artifact_read"));
        assert!(prompt.contains("/tools/render/surface"));
    }

    fn contains_standalone_tool_name(prompt: &str, tool_name: &str) -> bool {
        prompt.match_indices(tool_name).any(|(index, _)| {
            let before = prompt[..index].chars().next_back();
            let after = prompt[index + tool_name.len()..].chars().next();
            !is_tool_path_or_identifier_char(before) && !is_tool_path_or_identifier_char(after)
        })
    }

    fn is_tool_path_or_identifier_char(value: Option<char>) -> bool {
        value.is_some_and(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-' | '/'))
    }

    #[test]
    fn design_policy_is_dynamic() {
        let normal = build_system_prompt(&PromptPolicyInput {
            runtime_context: json!({}),
            design_research_required: false,
            ..PromptPolicyInput::default()
        });
        let design = build_system_prompt(&PromptPolicyInput {
            runtime_context: json!({}),
            design_research_required: true,
            ..PromptPolicyInput::default()
        });
        assert!(!normal.contains("Design Research Summary"));
        assert!(design.contains("Design Research Summary"));
    }
}
