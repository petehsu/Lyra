# Lyra Agent Vendor Audit

Date: 2026-05-29

## Scope

This audit records the completed removal of the old Agent vendor copy from the
active workspace.

## Current State

- `crates/lyra-agent-core/src/jcode_core/vendor` is removed.
- `crates/lyra-agent-legacy-adapter` is removed.
- `crates/lyra-agent-legacy-kernel` is removed.
- `crates/lyra-agent-legacy-kernel-crates` is removed.
- Workspace manifests no longer include `lyra-agent-legacy-*` members or
  `jcode-*` dependencies.
- `lyrad` and `lyra-cli` use `lyra-agent-runtime::LyraAgentBackend`.
- `lyra-agent-core` is a facade over `lyra-agent-runtime`, not a code container
  for imported Agent internals.

## Enforcement

- `pnpm lint:agent-boundary` rejects removed legacy directories, workspace
  legacy members, and direct `jcode-*` dependencies.
- `pnpm lint:no-jcode-public-api` rejects public Desktop/core contract leakage.
- Dependency-tree acceptance checks are:
  - `cargo tree -p lyrad | rg 'lyra-agent-legacy|jcode-'` has no matches.
  - `cargo tree -p lyra-agent-runtime | rg 'lyra-agent-legacy|jcode-'` has no matches.
