# ADR-0003: Remove the legacy Agent vendor copy

Audience: Internal

Date: 2026-05-29
Status: Accepted
Last verified: 2026-07-28

## Context

The old imported Agent implementation had become an unmaintained second kernel
inside the active workspace.

## Decision

- `crates/lyra-agent-core/src/jcode_core/vendor` is removed.
- `crates/lyra-agent-legacy-adapter` is removed.
- `crates/lyra-agent-legacy-kernel` is removed.
- `crates/lyra-agent-legacy-kernel-crates` is removed.
- Workspace manifests no longer include `lyra-agent-legacy-*` members or
  `jcode-*` dependencies.
- `lyrad` and `lyra-cli` use `lyra-agent-runtime::LyraAgentBackend`.
- `lyra-agent-core` is a facade over `lyra-agent-runtime`, not a code container
  for imported Agent internals.

## Alternatives considered

- Continue patching the vendor copy. Rejected because ownership and security
  fixes would remain split.
- Keep the copy as a runtime fallback. Rejected because fallback behavior
  obscures the authoritative code path and makes tests non-deterministic.
- Archive it outside the active workspace. Historical source may remain in
  repository history, but no build member or runtime fallback is retained.

## Enforcement

- `pnpm lint:agent-boundary` rejects removed legacy directories, workspace
  legacy members, and direct `jcode-*` dependencies.
- `pnpm lint:no-jcode-public-api` rejects public Desktop/core contract leakage.
- Dependency-tree acceptance checks are:
  - `cargo tree -p lyrad | rg 'lyra-agent-legacy|jcode-'` has no matches.
  - `cargo tree -p lyra-agent-runtime | rg 'lyra-agent-legacy|jcode-'` has no matches.
