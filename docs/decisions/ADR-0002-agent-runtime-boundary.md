# ADR-0002: Lyra Agent runtime boundary

Audience: Internal
Date: 2026-05-29
Status: Accepted
Last verified: 2026-07-28

## Context

The former Agent core exposed imported implementation modules, legacy `jcode`
names, and multiple runtime ownership paths. This decision records the boundary
enforced by the completed refactor.

## Current Findings

- `crates/lyra-agent-core/src/lib.rs` used to expose many imported jcode modules as public modules. Those modules are no longer present in the active workspace.
- `lyrad` now exposes agent runtime methods under `agent.*` only. The old `jcode.*` router branch is removed.
- Desktop shared contracts now use `Agent*` DTO names and `lyra:agent/...` IPC channels. `apps/desktop/src` and `crates/lyrad` no longer contain `Jcode`, `jcode.*`, or `lyra:jcode/...` public references.
- `lyra-agent-runtime` owns the native `LyraAgentBackend` main path and no longer depends on `lyra-agent-core`, `lyra-agent-legacy-*`, or any `jcode-*` crate.
- `lyrad` and `lyra-cli` compose `LyraAgentBackend` directly.
- `lyra-agent-core` is now a compatibility facade over `lyra-agent-runtime`. Public exports use Lyra Agent names.

## Decision

- Desktop consumes structured `AgentSessionSnapshot`, `AgentRuntimeEvent`, `AgentToolActivity`, memory projection, clarification, permission, provider, account, git, and rollback DTOs.
- `lyrad` is the process and routing boundary. It maps runtime protocol requests to Lyra Agent public functions and does not route legacy jcode method names.
- `lyra-agent-core` is temporarily a compatibility facade. Its public exports are Lyra-named JSON entrypoints, event callback registration, host capability dispatch, git helpers, and rollback/session DTOs.

## Alternatives considered

- Keep the imported Agent implementation public and rename only Desktop
  channels. Rejected because internal implementation types would remain part
  of the compatibility surface.
- Move Agent execution into Electron main. Rejected because it would duplicate
  native runtime ownership and tie the kernel to Desktop.
- Delete the compatibility facade immediately. Deferred until all internal
  consumers can depend on `lyra-agent-runtime` directly.

## Forbidden Directions

- Desktop must not import or reference `jcode_core`, `root_src`, `kernel_legacy`, or kernel implementation paths.
- `lyrad` must not expose `jcode.*` runtime methods or `lyra:jcode/...` channels.
- Public `lyra-agent-core` exports must not expose `root_src`/`kernel_legacy` modules, jcode modules, jcode provider/message/tool/session types, or unaliased `jcode_*` functions.
- Agent kernel code must not depend on Desktop or `lyrad`.
- API contracts must not depend on runtime implementation crates.
- `lyra-agent-runtime` must not depend on `lyra-agent-core`, `lyra-agent-legacy-*`, or `jcode-*` crates.
- No workspace crate may depend on `lyra-agent-legacy-*` or `jcode-*` crates.
- `crates/lyra-agent-legacy-adapter`, `crates/lyra-agent-legacy-kernel`, and `crates/lyra-agent-legacy-kernel-crates` must not return.

## Enforcement

- `pnpm lint:agent-boundary` checks Desktop/daemon naming and legacy path leakage.
- `pnpm lint:agent-boundary` also rejects `lyra-agent-core/src/kernel_legacy.rs`, `lyra-agent-core/src/kernel_legacy/`, removed legacy crate directories, workspace legacy/jcode dependencies, runtime dependencies on core/legacy/jcode crates, and direct legacy module access from the core compatibility facade.
- `pnpm lint:no-jcode-public-api` checks the public `lyra-agent-core` and Desktop shared contract surfaces.
- `pnpm check` runs both guards alongside the existing structure, native-core, and UI-style guards.
