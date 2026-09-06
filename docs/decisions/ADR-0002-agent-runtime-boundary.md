# ADR-0002: Lyra Agent runtime boundary

Audience: Internal
Date: 2026-05-29
Status: Accepted
Last verified: 2026-08-28

## Context

The former Agent core exposed imported implementation modules, legacy `jcode`
names, and multiple runtime ownership paths. This decision records the boundary
enforced by the completed refactor.

## Current Findings

- The former compatibility facade and its imported jcode modules are no longer present in the active workspace.
- `lyrad` now exposes agent runtime methods under `agent.*` only. The old `jcode.*` router branch is removed.
- Desktop shared contracts now use `Agent*` DTO names and `lyra:agent/...` IPC channels. `apps/desktop/src` and `crates/lyrad` no longer contain `Jcode`, `jcode.*`, or `lyra:jcode/...` public references.
- `lyra-agent-runtime` owns the native `LyraAgentBackend` main path and does not depend on legacy Agent or `jcode-*` crates.
- `lyrad` and `lyra-cli` compose `LyraAgentBackend` directly.

## Decision

- Desktop consumes structured `AgentSessionSnapshot`, `AgentRuntimeEvent`, `AgentToolActivity`, memory projection, clarification, permission, provider, account, git, and rollback DTOs.
- `lyrad` is the process and routing boundary. It maps runtime protocol requests to Lyra Agent public functions and does not route legacy jcode method names.
- Internal consumers use `lyra-agent-runtime` directly; there is no compatibility facade.

## Alternatives considered

- Keep the imported Agent implementation public and rename only Desktop
  channels. Rejected because internal implementation types would remain part
  of the compatibility surface.
- Move Agent execution into Electron main. Rejected because it would duplicate
  native runtime ownership and tie the kernel to Desktop.
- Keep a compatibility facade after all internal consumers moved to the runtime.
  Rejected because it preserves an unused public surface and maintenance path.

## Forbidden Directions

- Desktop must not import or reference `jcode_core`, `root_src`, `kernel_legacy`, or kernel implementation paths.
- `lyrad` must not expose `jcode.*` runtime methods or `lyra:jcode/...` channels.
- Agent kernel code must not depend on Desktop or `lyrad`.
- API contracts must not depend on runtime implementation crates.
- `lyra-agent-runtime` must not depend on legacy Agent or `jcode-*` crates.
- No workspace crate may depend on `lyra-agent-legacy-*` or `jcode-*` crates.
- `crates/lyra-agent-legacy-adapter`, `crates/lyra-agent-legacy-kernel`, and `crates/lyra-agent-legacy-kernel-crates` must not return.

## Enforcement

- `pnpm lint:agent-boundary` checks Desktop/daemon naming and legacy path leakage.
- `pnpm lint:agent-boundary` also rejects removed legacy crate directories,
  workspace legacy/jcode dependencies, and runtime dependencies on those crates.
- `pnpm check` runs the guard alongside the existing structure, native-core,
  and UI-style guards.
