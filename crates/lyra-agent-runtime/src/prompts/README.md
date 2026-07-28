# Prompt Templates

MiniJinja templates embedded at compile time by `prompt_templates.rs`.
16 templates, assembled by `prompt_policy.rs` into a stable provider prefix and an append-only per-turn context tail.

## Architecture

Templates are layered P0–P6 and assembled by `build_system_prompt_report()` in `prompt_policy.rs`.
The provider `system` prefix contains the unconditional P0–P2 base plus the static full-mode and selected P3 modules for the current delivery shape. Its hash comes from the exact rendered prefix bytes.
Persona, time, memory, skills, runtime state, prompt accounting, and CodeGraph context are frozen into the active user message's `providerContext` tail and replayed at the same chronological position.
Two delivery modes remain: `full` (default) and `lean-experimental`. They may have different stable prefixes. A mode or scene transition changes the prefix once; later turns with the same selection reuse the same bytes.

| Layer | Template | Delivery | Role |
|-------|----------|----------|------|
| P0 | `kernel.md.j2` | Stable prefix | Core safety, trust hierarchy, real execution, and completion evidence. Always on. |
| P1 | `interaction_contract.md.j2` | Stable prefix | Blocking clarification and approval protocol. Always on. |
| P1 | `compact_contract.md.j2` | Stable prefix | Shared engineering discipline and response contract. Always on. |
| P2 | `plan_mode.md.j2` | Stable prefix | Plan and Todo lifecycle. Always on. |
| P2 | `full_contract.md.j2` | Stable prefix when selected | Full-mode tool discovery and failure recovery. |
| P3 | `browser_scene.md.j2` | Stable prefix when selected | Browser behavior. |
| P3 | `computer_scene.md.j2` | Stable prefix when selected | Computer/app control behavior. |
| P3 | `design_scene.md.j2` | Stable prefix when selected | Design workflow and native quality review. |
| P3 | `citation_scene.md.j2` | Stable prefix when selected | Transcript/page cite + attachment rules. |
| P3 | `image_scene.md.j2` | Stable prefix when selected | Vision input + image attachment rules. |
| P4 | `active_skill.md.j2` | Turn tail | Active skill prompt wrapper. Data only. |
| P4 | `memory_context.md.j2` | Turn tail | Memory projection wrapper. Data only. |
| P4 | `dynamic_context.md.j2` | Turn tail | Persona and runtime context (time, workspace, device). Data only. |
| P5 | `prompt_accounting.md.j2` | Turn tail | Token estimate + omitted section summary. Data only. |
| P6 | `codegraph_fragments.md.j2` | Turn tail | CodeGraph signal-driven fragments. Budget-gated. |
| P6 | `codegraph_intent_fragments.md.j2` | Turn tail | CodeGraph intent fragments. Data only. |

## Identity System

`dynamic_context.md.j2` renders a first-person identity from `ComputedPersona` — name, age, location, emails, usernames, bio, platforms, `first_used_at` brief.
Persona is computed from local OSINT signals (`persona/` module) on every turn, no network calls.
Identity is shaped by environment, not declared by instruction.

Do not add "you are X" identity directives to templates.
Identity lines are conditional on persona fields being present and must remain outside the stable prefix.

## OMA Prefix

OMA adds a separate agent-specific `system` prefix containing that worker's sealed identity and invariant privacy rules.
The current organization view, channel, routed targets, and assignment stay in that worker's frozen per-turn tail because they can change. Never share one worker's identity prefix or frozen tail with another Agent.

## Tool Architecture

Fixed provider tools include direct file/search/shell tools, atomic `plan_begin/write/finalize/revise`, atomic `todo_write/update/finish`, `lyra_clarification_ask`, `lyra_session_read_message`, and 5 Tool-FS meta tools (`tool_fs_search/list/read_doc/inspect/run`).

Discoverable tools live in the Tool-FS catalog (`lyra-tool-fs-core/src/catalog/`): filesystem read/grep/glob/list, shell run, terminal write/list/read, codegraph, and more.
The agent finds them by intent, not by memorized name.

Do not list tool names or tool catalogs in templates.
The agent discovers capabilities through the computer — templates describe behavior, not tool inventories.

## Writing Style

Professional, concise, and natural. Use the user's primary language and complete sentences.
Lead with the outcome, remove filler and repeated reasons, and preserve exact technical terms, code, commands, paths, URLs, citations, and errors.
Do not use compressed pronouns or invented abbreviations to save tokens.
Expand safety warnings, irreversible actions, high-stakes guidance, and ordered procedures when terseness could create ambiguity.
No emoji unless explicitly asked.

Lead with outcome in final answers. Don't end on a promise about undone work — do it now with tool calls.
Comments only for constraints the code can't show. Match surrounding code's comment density, naming, idiom.
Don't re-read a file right after editing — the harness tracks file state.
Reversible actions proceed; destructive ones confirm first. Before delete/overwrite, look at the target.
Can't mark todo completed when tests fail or implementation incomplete.

## Immersive Language Principles

Templates are environment context, not system instructions about being an AI.

Don't write:
- "Tool calls are provider structured tool calls only. Never write simulated JSON..."
- "You are an AI assistant..."
- "physical self" / "digital self" language
- Tool advertisement blocks ("Read files: read_file. Search: grep...")

Do write:
- `Complete authorized work on the user's real computer instead of merely describing it.`
- Behavior norms: "Never claim completion without evidence", "batch independent calls", "reuse the codebase before adding new code"
- Tool names only in behavior norms: `lyra_clarification_ask for blocking unknowns`, not in tool lists

## Safety Rules

Safety-critical lines may be short but must keep full meaning.
Never weaken:

- No completion claims without evidence from tools, files, runtime state, or tests.
- Secrets stay as `lyra-sensitive-value-ref` refs — never expose/request/log/store plaintext in model text.
- Latest user message + runtime context outrank old summaries/memory/recall.
- Blocking clarification only via `lyra_clarification_ask`, never plain assistant text.
- Complete authorized work through real capabilities instead of simulating it in prose.

## Key Terms

Keep these exact across templates — they are contracts with Rust/tests/UI:

`lyra_clarification_ask`
`lyra-sensitive-value-ref`
`lyra_session_read_message`
`projectContext`
`systemRecalled`
`Design Research Summary`

Do not rename runtime JSON fields, section ids, scene module names, or contract fields from templates.

## Dynamic Delivery

Default mode is `full`.
`lean-experimental` uses the same unconditional base but can omit `full_contract.md.j2` and include only selected P3 modules.
The resulting full and lean prefixes are independently stable. Mode or scene changes intentionally rotate the stable hash once instead of rewriting the prefix every turn.

Before moving any instruction out of always-on prompt, confirm one of these is true:

- It is in a scene module with conservative detection.
- It is recoverable through the computer (search/inspect/discovery).
- It is persisted in runtime context or memory projection.
- It is nonessential style guidance.

## Contract Versions

`prompt_contract.rs` defines version constants.
`prompt_contract_audit.toml` records intentional acknowledgements when a version bump is skipped.

If a prompt change depends on context trimming, memory projection, session snapshots, provider state, or tool catalog behavior — bump the relevant version or add a valid audit ack.

Current: `PROMPT_POLICY_VERSION=10`, `PROMPT_TEMPLATE_VERSION=34`, `CONTEXT_PROJECTION_VERSION=4`.

## MiniJinja Rules

- Simple `{% if %}` conditions + `{{ var }}` interpolation only.
- No selection logic, token accounting, hashing, scene detection, or fallback rules in templates.
- Strict undefined: every variable must be provided by `prompt_templates.rs` / `prompt_policy.rs`.
- Autoescape disabled. Write literal prompt text.

## Test Checklist

```bash
cargo test -p lyra-agent-runtime prompt_templates
cargo test -p lyra-agent-runtime prompt_policy
INSTA_UPDATE=always cargo test -p lyra-agent-runtime --test prompt_snapshots
cargo test -p lyra-agent-runtime --test prompt_snapshots
```

If snapshots change, review full and lean token estimates.
Goal: lower recurring prompt tokens without lowering capability.
