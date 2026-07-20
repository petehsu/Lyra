# Prompt Templates

MiniJinja templates embedded at compile time by `prompt_templates.rs`.
16 templates, assembled by `prompt_policy.rs` into a layered system prompt.

## Architecture

Templates are layered P0–P6 and assembled by `build_system_prompt_report()` in `prompt_policy.rs`.
Two delivery modes: `full` (default) and `lean-experimental` (kernel + compact + scenes + dynamic context only).

| Layer | Template | Full | Lean | Role |
|-------|----------|------|------|------|
| P0 | `kernel.md.j2` | ✓ | ✓ | Identity + spatiotemporal + safety. Always on. |
| P1 | `interaction_contract.md.j2` | ✓ | ✓ | Blocking interaction protocol. Always on. |
| P1 | `compact_contract.md.j2` | ✓ | ✓ | Lean operating rules. Standalone with kernel in lean mode. |
| P2 | `full_contract.md.j2` | ✓ | — | Full-mode contract. Refreshed after trim/mismatch/hash change. |
| P2 | `plan_mode.md.j2` | ✓ | ✓ | Plan gate behavior + tool expectations. |
| P3 | `browser_scene.md.j2` | ✓ | scene | Browser behavior. Lean: included when browser scene detected. |
| P3 | `computer_scene.md.j2` | ✓ | scene | Computer/app control behavior. |
| P3 | `design_scene.md.j2` | ✓ | scene | Design workflow and native quality review. |
| P3 | `citation_scene.md.j2` | ✓ | ✓ | Transcript/page cite + attachment rules. |
| P3 | `image_scene.md.j2` | ✓ | ✓ | Vision input + image attachment rules. |
| P4 | `active_skill.md.j2` | ✓ | ✓ | Active skill prompt wrapper. Data only. |
| P4 | `memory_context.md.j2` | ✓ | ✓ | Memory projection wrapper. Data only. |
| P4 | `dynamic_context.md.j2` | ✓ | ✓ | Runtime context (spatiotemporal, workspace, device). Data only. |
| P5 | `prompt_accounting.md.j2` | ✓ | ✓ | Token estimate + omitted section summary. Data only. |
| P6 | `codegraph_fragments.md.j2` | ✓ | ✓ | CodeGraph signal-driven fragments. Budget-gated. |
| P6 | `codegraph_intent_fragments.md.j2` | ✓ | ✓ | CodeGraph intent fragments. Data only. |

## Identity System

`kernel.md.j2` renders a first-person identity from `ComputedPersona` — name, age, location, emails, usernames, bio, platforms, `first_used_at` brief.
Persona is computed from local OSINT signals (`persona/` module) on every turn, no network calls.
Identity is shaped by environment, not declared by instruction.

Do not add "you are X" identity directives to templates.
The kernel's identity lines are all conditional on persona fields being present.

## Tool Architecture

Fixed provider tools include direct file/search/shell tools, atomic `plan_begin/write/finalize/revise`, atomic `todo_write/update/finish`, `lyra_clarification_ask`, `lyra_session_read_message`, and 5 Tool-FS meta tools (`tool_fs_search/list/read_doc/inspect/run`).

Discoverable tools live in the Tool-FS catalog (`lyra-tool-fs-core/src/catalog/`): filesystem read/grep/glob/list, shell run, terminal write/list/read, codegraph, and more.
The agent finds them by intent, not by memorized name.

Do not list tool names or tool catalogs in templates.
The agent discovers capabilities through the computer — templates describe behavior, not tool inventories.

## Writing Style

Short. Direct. No filler, no intros, no repeated reasons, no sentence-ending punctuation when safe.

Short forms (use only when readable):
`U`, `r`, `msg`, `net`, `vals`, `caps`, `instr`, `ref`, `refs`, `dir`, `fg`, `ops`.

Prefer:
`Search first by task intent`
not:
`When you need to use a tool, you should generally consider searching first`

No bullet prefixes unless the marker carries meaning.
Plain short lines tokenize well and stay compact.
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
- `When u need to do something on the computer, do it for real — don't describe what u would do, do it.`
- Behavior norms: "Don't claim done w/o evidence", "batch independent calls", "climb the ladder: YAGNI → reuse → stdlib → native → dep → one line → minimum"
- Tool names only in behavior norms: `lyra_clarification_ask for blocking unknowns`, not in tool lists

## Safety Rules

Safety-critical lines may be short but must keep full meaning.
Never weaken:

- No done claims without evidence from tools/files/runtime/tests.
- Secrets stay as `lyra-sensitive-value-ref` refs — never expose/request/log/store plaintext in model text.
- Latest user msg + runtime context outrank old summaries/memory/recall.
- Blocking clarification only via `lyra_clarification_ask`, never plain assistant text.
- Do it for real — don't describe what u would do, do it.

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
`lean-experimental` works with only kernel + interaction + compact contract + plan mode + selected scenes + dynamic context.

Before moving any instruction out of always-on prompt, confirm one of these is true:

- It is in a scene module with conservative detection.
- It is recoverable through the computer (search/inspect/discovery).
- It is persisted in runtime context or memory projection.
- It is nonessential style guidance.

## Contract Versions

`prompt_contract.rs` defines version constants.
`prompt_contract_audit.toml` records intentional acknowledgements when a version bump is skipped.

If a prompt change depends on context trimming, memory projection, session snapshots, provider state, or tool catalog behavior — bump the relevant version or add a valid audit ack.

Current: `PROMPT_POLICY_VERSION=9`, `PROMPT_TEMPLATE_VERSION=31`.

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
