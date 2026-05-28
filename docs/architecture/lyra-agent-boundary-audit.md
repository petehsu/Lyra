# Lyra Agent Boundary Audit

This audit records the boundary that the agent-core refactor is enforcing.

## Current Findings

- `crates/lyra-agent-core/src/lib.rs` used to expose many `jcode_core/vendor/root_src` modules as public modules. These modules are now private implementation modules.
- `lyrad` now exposes agent runtime methods under `agent.*` only. The old `jcode.*` router branch is removed.
- Desktop shared contracts now use `Agent*` DTO names and `lyra:agent/...` IPC channels. `apps/desktop/src` and `crates/lyrad` no longer contain `Jcode`, `jcode.*`, or `lyra:jcode/...` public references.
- `lyra-agent-core` still contains private legacy implementation names while the kernel is being internalized. Public exports use Lyra Agent names.

## Public Boundary

- Desktop consumes structured `AgentSessionSnapshot`, `AgentRuntimeEvent`, `AgentToolActivity`, memory projection, clarification, permission, provider, account, git, and rollback DTOs.
- `lyrad` is the process and routing boundary. It maps runtime protocol requests to Lyra Agent public functions and does not route legacy jcode method names.
- `lyra-agent-core` is temporarily a compatibility facade. Its public exports are Lyra-named JSON entrypoints, event callback registration, host capability dispatch, git helpers, and rollback/session DTOs.

## Forbidden Directions

- Desktop must not import or reference `jcode_core`, `root_src`, or kernel implementation paths.
- `lyrad` must not expose `jcode.*` runtime methods or `lyra:jcode/...` channels.
- Public `lyra-agent-core` exports must not expose root_src modules, jcode modules, jcode provider/message/tool/session types, or unaliased `jcode_*` functions.
- Agent kernel code must not depend on Desktop or `lyrad`.
- API contracts must not depend on runtime implementation crates.

## Enforcement

- `pnpm lint:agent-boundary` checks Desktop/daemon naming and legacy path leakage.
- `pnpm lint:no-jcode-public-api` checks the public `lyra-agent-core` and Desktop shared contract surfaces.
- `pnpm check` runs both guards alongside the existing structure, Rust-first, and UI-style guards.
