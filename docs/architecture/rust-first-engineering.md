# Rust-First Engineering Guardrails

Status: Active  
Applies to: `apps/desktop/src/main`, `crates/*` native capability crates

## Goal
Lyra desktop keeps a single source of truth for system-facing capabilities:

- Native-owned capabilities live in Rust crates.
- Desktop main TypeScript code stays as shell glue, IPC wiring, and orchestration.
- Bridge-only modules remain thin and do not re-implement native logic.

This document is the enforcement reference for `pnpm lint:rust-first`.

## Native-Owned Modules
These modules must route core behavior to the matching Rust crate:

| Module | Desktop Path | Rust Crate |
| --- | --- | --- |
| files | `apps/desktop/src/main/files` | `crates/lyra-files-napi` |
| terminal | `apps/desktop/src/main/terminal` | `crates/lyra-terminal-core` |
| lsp | `apps/desktop/src/main/lsp` | `crates/lyra-lsp-core` |
| skills | `apps/desktop/src/main/skills` | `crates/lyra-skills-napi` |
| mcp | `apps/desktop/src/main/mcp` | `crates/lyra-mcp-core` |
| ai | `apps/desktop/src/main/ai` | `crates/lyra-ai-core` |

Requirements:

1. Rust crate must exist and be in workspace `Cargo.toml`.
2. Main process wiring must call the module bridge factory in `apps/desktop/src/main/index.ts`.
3. `apps/desktop/package.json` `scripts.native:build` must include `-p <crate>`.
4. TypeScript services must not keep fallback implementations for native-owned behavior.

## TypeScript-Owned Main Modules
These modules are shell-level logic and may stay TypeScript-owned:

- `browser-use`
- `capabilities`
- `search`
- `linux-compat`
- `storage`
- `workbench-browser`
- `workbench-documents`
- `workbench-observation`
- `workbench-state`
- `workbench-web-automation`

If a TypeScript-owned module becomes stateful + OS-facing + security-sensitive, it should move to native ownership.

## Bridge-Only Main Modules
These modules must stay thin adapters:

- `runtime`
- `runtime-host-rpc`
- `code-intel`
- `documents`

Bridge-only rule:

1. No business-domain state machine growth.
2. No native capability re-implementation in TypeScript.
3. Prefer type-shaping + transport adaptation only.

## Required Checks
Run before merge:

```bash
pnpm lint:rust-first
pnpm lint:structure
pnpm lint:ui-style
```

Combined gate:

```bash
pnpm check
```

## Ownership Change Process
When changing ownership for a desktop main module:

1. Update `tools/verify-rust-first.ts` classification map.
2. Add/update native crate workspace membership if it becomes native-owned.
3. Update `apps/desktop/package.json` `scripts.native:build`.
4. Update this document and relevant ADRs.
