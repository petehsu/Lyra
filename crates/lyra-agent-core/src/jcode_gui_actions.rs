use crate::session::SessionImproveMode;
use crate::todo::TodoItem;

pub const BTW_PAGE_ID: &str = "btw";

pub enum JcodeGuiActionKind {
    Improve,
    Refactor,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum JcodeFeedbackActionKind {
    Review,
    Judge,
}

pub fn session_improve_mode_for(kind: JcodeGuiActionKind, plan_only: bool) -> SessionImproveMode {
    match (kind, plan_only) {
        (JcodeGuiActionKind::Improve, false) => SessionImproveMode::ImproveRun,
        (JcodeGuiActionKind::Improve, true) => SessionImproveMode::ImprovePlan,
        (JcodeGuiActionKind::Refactor, false) => SessionImproveMode::RefactorRun,
        (JcodeGuiActionKind::Refactor, true) => SessionImproveMode::RefactorPlan,
    }
}

pub fn build_improve_prompt(plan_only: bool, focus: Option<&str>) -> String {
    let focus_line = focus_line(focus, "but you may choose a different task");

    if plan_only {
        format!(
            "You are entering improvement planning mode for this repository.\n\
Your job is to inspect the project and identify the highest-leverage improvements worth doing next.\n\
\n\
First inspect the codebase and current repo state. Then write a concise ranked todo list using `todo` with the best 3-7 candidate improvements. Prefer work that is high-impact, low-risk, and easy to validate. Consider refactors, reliability issues, missing tests, UX papercuts, docs gaps, startup/runtime performance, and profiling opportunities.\n\
\n\
This is plan-only mode: do not edit files, write patches, or otherwise modify source code or git state. Read/search/analyze freely, and you may run builds/tests/profiling commands if that helps you rank the work, but stop after presenting the todo list and brief rationale.\n\
\n\
Avoid broad speculative rewrites, cosmetic churn, and busywork. If the repo already has todos, replace them with a tighter ranked improve plan if appropriate.{}",
            focus_line,
        )
    } else {
        format!(
            "You are entering improvement mode for this repository.\n\
Your job is to identify and implement the highest-leverage safe improvements to this project, then reassess and continue only while further work is clearly worthwhile.\n\
\n\
First inspect the codebase and current repo state. Then write a concise ranked todo list using `todo` with the best 3-7 improvements to tackle next. Prefer work that is high-impact, low-risk, locally scoped, and easy to validate. Consider refactors, reliability issues, missing tests, UX papercuts, docs gaps, startup/runtime performance, and profiling opportunities.{}\n\
\n\
Execute the strongest items, updating the todo list as you go. Validate meaningful changes with builds, tests, or measurements. If you make performance claims, measure before and after when possible.\n\
\n\
After completing the batch, reassess. If strong opportunities remain, write a fresh todo list and continue. If remaining work has diminishing returns, stop and explain why the next ideas are not clearly worth the churn.\n\
\n\
Avoid broad speculative rewrites, cosmetic churn, and busywork. Do not invent work just to stay busy. If the repo already has todos, refine or replace them with the best current improve batch before continuing.",
            focus_line,
        )
    }
}

pub fn build_refactor_prompt(plan_only: bool, focus: Option<&str>) -> String {
    let focus_line = focus_line(focus, "but choose a different task");

    if plan_only {
        format!(
            "You are entering refactor planning mode for this repository.\n\
Your job is to inspect the project and identify the highest-leverage safe refactors worth doing next.\n\
\n\
First inspect the codebase, current repo state, and the in-repo quality docs if they exist, especially `docs/REFACTORING.md`, `docs/CODE_QUALITY_10_10_PLAN.md`, and `docs/CODE_QUALITY_TODO.md`. Then write a concise ranked todo list using `todo` with the best 3-7 candidate refactors. Prefer behavior-preserving extraction, file splits, dead-code deletion, warning reduction, test isolation, and clearer module boundaries.\n\
\n\
This is plan-only mode: do not edit files, write patches, or otherwise modify source code or git state. Read/search/analyze freely, and you may run builds/tests if that helps rank the work, but stop after presenting the ranked refactor plan and brief rationale.\n\
\n\
Avoid broad speculative rewrites, cosmetic churn, and risky busywork. If the repo already has todos, tighten or replace them with the best current refactor plan.{}",
            focus_line,
        )
    } else {
        format!(
            "You are entering refactor mode for this repository.\n\
Your job is to move the codebase closer to a practical 10/10 by making the highest-leverage safe refactors, validating them, getting an independent review, and only continuing while the next batch is clearly worth the churn.\n\
\n\
First inspect the codebase, current repo state, and the in-repo quality docs if they exist, especially `docs/REFACTORING.md`, `docs/CODE_QUALITY_10_10_PLAN.md`, and `docs/CODE_QUALITY_TODO.md`. Then write a concise ranked todo list using `todo` with the best 3-7 refactors to tackle next. Prefer behavior-preserving extraction, splitting oversized modules, dead-code deletion, warning reduction, test improvements, and boundary clarification.{}\n\
\n\
For v1, do the implementation work yourself in this main session. Do not create a swarm for ordinary execution. Keep changes locally scoped and easy to validate.\n\
\n\
After each meaningful batch, use the `subagent` tool exactly once to launch an independent read-only reviewer. In that subagent prompt, explicitly forbid file edits, patch application, and git changes. Ask it to inspect the changed areas plus nearby tests and report concrete regressions, risks, abstraction problems, or follow-up refactors. Incorporate valid findings before continuing.\n\
\n\
Validate each meaningful batch with relevant builds, tests, or repo verification scripts. Prefer behavior-preserving changes first. After the batch and independent review, reassess. If strong refactors remain, write a fresh todo list and continue. If remaining work has diminishing returns or becomes too risky, stop and explain why.\n\
\n\
Avoid broad speculative rewrites, cosmetic churn, and busywork. Do not invent work just to stay busy.",
            focus_line,
        )
    }
}

pub fn incomplete_poke_todos(todos: Vec<TodoItem>) -> Vec<TodoItem> {
    todos
        .into_iter()
        .filter(|todo| todo.status != "completed" && todo.status != "cancelled")
        .collect()
}

pub fn build_poke_message(incomplete: &[TodoItem]) -> String {
    format!(
        "You have {} incomplete todo{}. Continue working, or update the todo tool.",
        incomplete.len(),
        if incomplete.len() == 1 { "" } else { "s" },
    )
}

pub fn build_selfdev_start_prompt(
    prompt: Option<&str>,
    target: Option<&str>,
    repo_dir: &str,
) -> String {
    let trimmed_prompt = prompt.map(str::trim).unwrap_or_default();
    if trimmed_prompt.is_empty() {
        return String::new();
    }
    let target_guidance = match target.map(str::trim).unwrap_or("general") {
        "agent-core" => {
            "Focus on Lyra Agent Rust runtime, lyra-agent-core, lyrad IPC, vendored Agent integration, and tests."
        }
        "desktop-gui" => {
            "Focus on Lyra desktop React/Electron GUI, Workbench app surfaces, bridge wiring, i18n, and typecheck validation."
        }
        "validation" => {
            "Focus on validation, tests, typecheck failures, build scripts, and narrow correctness fixes."
        }
        _ => {
            "Focus on the highest-leverage Lyra Agent self-development path for the requested task."
        }
    };

    format!(
        "You are in Lyra Agent self-development mode.\n\
The target repository is `{}`.\n\
This session may modify Lyra Agent internals and the vendored Agent integration, not an end-user project.\n\
{}\n\
\n\
Use Lyra-aware validation commands when relevant:\n\
- Rust runtime: `cargo test -p lyra-agent-core lyra_runtime -- --nocapture`\n\
- lyrad bridge: `cargo test -p lyrad`\n\
- Desktop GUI: `npm --prefix apps/desktop run typecheck`\n\
\n\
Do not use upstream-only vendored build commands such as `cargo build --profile selfdev -p jcode --bin jcode` in this Lyra repo.\n\
\n\
Task:\n{}",
        repo_dir, target_guidance, trimmed_prompt
    )
}

pub fn build_review_startup_message(parent_session_id: &str) -> String {
    format!(
        "You are the one-shot reviewer for parent session `{}`.\n\
Your job is to inspect the recent work, determine whether a review is needed, and perform that review if needed.\n\
\n\
First read only the conversation history you actually need:\n\
1. Use `conversation_search` with `stats=true` to learn the history size.\n\
2. Read the most recent turns with `conversation_search turns` (start with roughly the last 6-12 turns, then widen only if needed).\n\
3. If requirements are unclear, use `conversation_search query` to find the latest relevant user request or acceptance criteria.\n\
\n\
{}\
Then determine whether review is needed. Review is needed if the recent work likely changed code, config, docs, tests, tooling behavior, or made technical claims worth validating. If the recent turn was purely conversational or administrative, no review is needed.\n\
\n\
If no review is needed:\n\
- Send exactly one DM to session `{}` using `communicate` with action `dm`.\n\
- Briefly explain why no review was needed.\n\
- Then stop.\n\
\n\
If review is needed:\n\
- Inspect the actual repo changes with targeted commands such as `git diff --stat`, `git diff --name-only`, and focused file reads.\n\
- Perform a concise code review. Look for correctness bugs, regressions, missing validation, missing tests, edge cases, unsafe behavior, or broken assumptions. Prefer concrete findings over style comments.\n\
- When finished, send exactly one DM to session `{}` summarizing:\n\
  - whether review was needed\n\
  - any findings with severity and file paths\n\
  - or `No issues found` if the work looks good\n\
- After sending the DM, stop.\n\
\n\
Do not ask the user anything unless absolutely necessary. Keep your own session concise.",
        parent_session_id,
        review_session_read_only_guardrails(),
        parent_session_id,
        parent_session_id
    )
}

pub fn build_judge_startup_message(parent_session_id: &str) -> String {
    format!(
        "You are the one-shot judge for parent session `{}`.\n\
Your job is to inspect the recent work, determine whether a judgment pass is needed, and perform that judgment if needed.\n\
{}\
\n\
First read only the conversation history you actually need:\n\
1. Use `conversation_search` with `stats=true` to learn the history size.\n\
2. Read the most recent turns with `conversation_search turns` (start with roughly the last 6-12 turns, then widen only if needed).\n\
3. If requirements are unclear, use `conversation_search query` to find the latest relevant user request, constraints, preferences, or acceptance criteria.\n\
\n\
{}\
Then determine whether a judgment pass is needed. It is needed if the recent work likely changed code, docs, tests, tooling behavior, repo state, or made claims about what was completed. If the recent turn was purely conversational or administrative, no judgment is needed.\n\
\n\
If no judgment is needed:\n\
- Send exactly one DM to session `{}` using `communicate` with action `dm`.\n\
- Briefly explain why no judgment was needed.\n\
- Then stop.\n\
\n\
If judgment is needed:\n\
- Inspect the actual repo changes with targeted commands such as `git diff --stat`, `git diff --name-only`, focused file reads, and relevant tests or validation commands when warranted.\n\
- Evaluate: intent alignment, completeness, initiative, approach quality, correctness, validation quality, and whether obvious next steps were missed.\n\
- Prefer concrete findings over vague commentary. Call out if the work stopped after one pass when more follow-through was clearly needed.\n\
- When finished, send exactly one DM to session `{}` summarizing:\n\
  - whether judgment was needed\n\
  - whether the work looks complete and well-executed\n\
  - any findings with severity and file paths when relevant\n\
  - specific missing follow-through or better next steps if the execution was incomplete or low-agency\n\
  - or `Looks good` if the work is aligned, thoughtful, and complete\n\
- After sending the DM, stop.\n\
\n\
Do not ask the user anything unless absolutely necessary. Keep your own session concise.",
        parent_session_id,
        judge_session_visible_context_notice(),
        review_session_read_only_guardrails(),
        parent_session_id,
        parent_session_id
    )
}

pub fn build_btw_loading_markdown(question: &str) -> String {
    format!(
        "# `/btw`\n\n## Question\n{}\n\n## Status\nThinking...\n",
        question.trim()
    )
}

pub fn build_btw_system_reminder(question: &str) -> String {
    format!(
        "The user invoked `/btw`, which is a side question about the current session. \
Answer ONLY from the existing conversation/context already in memory for this session. \
Do not read files, run commands, search the web, or call any tool except `side_panel`.\n\n\
Use the `side_panel` tool exactly once with:\n\
- `action`: `write`\n\
- `page_id`: `{}`\n\
- `title`: ``/btw``\n\
- `focus`: `true`\n\n\
Write markdown with this shape:\n\
# `/btw`\n\
## Question\n<repeat the question>\n\
## Answer\n<your concise answer>\n\n\
If the answer is not already knowable from the current session context, say so clearly in the Answer section and explain that a normal prompt is needed.\n\n\
After writing the side panel content, do not add any normal chat response text.\n\n\
Question: {}",
        BTW_PAGE_ID,
        question.trim()
    )
}

fn focus_line(focus: Option<&str>, choose_clause: &str) -> String {
    focus
        .map(str::trim)
        .filter(|focus| !focus.is_empty())
        .map(|focus| {
            format!(
                "\nFocus area: {}. Prefer this area when leverage is comparable, {} if it is clearly higher leverage.",
                focus, choose_clause
            )
        })
        .unwrap_or_default()
}

fn review_session_read_only_guardrails() -> &'static str {
    "Important constraints for this session:\n\
- This session is analysis-only. Do not do the work yourself.\n\
- Do not modify files or repo state. Do not call `edit`, `write`, `multiedit`, `patch`, `apply_patch`, or destructive `bash`/`git` commands.\n\
- Do not continue implementation, fix issues, or take follow-up actions yourself.\n\
- If additional work is needed, describe it in your DM to the parent session instead.\n\
\n"
}

fn judge_session_visible_context_notice() -> &'static str {
    "Important context for this judge session:\n\
- This session contains a user-visible mirror of the parent conversation, not the full original implementation context.\n\
- It includes the user's prompts, the assistant's visible replies, and shallow summaries of visible tool calls.\n\
- It intentionally omits deep tool-result details and hidden internal context beyond what the user could see.\n\
- Base your judgment on this mirror, then verify claims by inspecting repo state or tests directly when needed.\n\
\n"
}
