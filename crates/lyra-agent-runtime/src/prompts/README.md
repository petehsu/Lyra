# Lyra Prompt Writing Guide

This dir holds MiniJinja prompt templates embedded by `prompt_templates.rs`.
Templates should only contain prompt text and simple `{% if %}` conditions.
Mode, scene, hash, token, refresh, memory, and context-window logic belongs in Rust.

## File Roles

`kernel.md.j2`: tiny always-on identity and safety kernel.
Keep it minimal. It is sent in every mode.

`compact_contract.md.j2`: lean operating rules.
It must stand alone with `kernel.md.j2` in `lean-experimental`.

`full_contract.md.j2`: stable full-mode contract.
Use for durable behavior that should be refreshed after trim, contract mismatch, or prompt hash change.

`*_scene.md.j2`: scene modules.
Use only for scene-specific behavior such as browser, computer, design, citation, or image work.

`dynamic_context.md.j2`, `memory_context.md.j2`, `active_skill.md.j2`, `prompt_accounting.md.j2`:
Wrappers for runtime data. Do not add policy here unless the policy truly belongs with that data.

## Writing Rules

Keep prompt text short.
Cut filler, intros, repeated reasons, examples that do not change behavior, and sentence-ending punctuation when safe.

Use common short forms only when readable:
`U`, `r`, `msg`, `net`, `vals`, `caps`, `instr`, `ref`, `refs`, `dir`, `fg`, `ops`.
Avoid rare slang or private abbreviations that translation tools may fail to understand.

Prefer direct commands:
`Search first by task intent`
not
`When you need to use a tool, you should generally consider searching first`

Do not use bullet prefixes in templates unless the marker itself carries meaning.
Plain short lines tokenize well enough and keep prompt text compact.

Keep key terms exact:
`provider structured tool calls`
`Tool-FS`
`lyra-sensitive-value-ref`
`Design Research Summary`
`systemRecalled`

Do not rename runtime JSON fields, section ids, scene module names, or contract fields from templates.
Those are contracts with Rust/tests/UI.

## Safety Rules

Safety-critical lines may be short, but must keep full meaning.
Never weaken rules about:

Tool calls using provider structured tool calls only.
No simulated JSON or fake tool calls.
No done claims without evidence.
Secrets staying as refs.
Latest member msg and runtime context outranking old memory/summary/recall.
Asking one concise clarification when progress truly needs missing input.

## Dynamic Delivery Rules

Assume default mode is still `full`.
`lean-experimental` must work with only kernel + compact contract + selected scene modules + dynamic context.

Before moving any instruction out of always-on prompt, confirm one of these is true:

It is in a scene module with conservative detection.
It is recoverable through Tool-FS docs/inspect/search.
It is persisted in runtime context or memory projection.
It is nonessential style guidance.

If a prompt change depends on context trimming, memory projection, session snapshots, provider state, or Tool-FS catalog behavior, update the prompt contract version or add a valid audit ack per `prompt_contract_audit.toml`.

## MiniJinja Rules

Use only simple conditions and variable interpolation.
Do not put selection logic, token accounting, hashing, scene detection, or fallback rules in templates.

Keep templates valid under strict undefined.
Every variable must be provided by `prompt_templates.rs` / `prompt_policy.rs`.

Autoescape is disabled.
Write literal prompt text; do not HTML-escape prompt content.

## Test Checklist

After prompt edits, run the smallest useful checks:

`cargo test -p lyra-agent-runtime prompt_templates`
`cargo test -p lyra-agent-runtime prompt_policy`
`INSTA_UPDATE=always cargo test -p lyra-agent-runtime --test prompt_snapshots`
`cargo test -p lyra-agent-runtime --test prompt_snapshots`
`pnpm lint:prompt-contract`
`git diff --check`

If snapshots change, review full and lean token estimates.
The goal is lower recurring prompt tokens without lowering Lyra capability.
