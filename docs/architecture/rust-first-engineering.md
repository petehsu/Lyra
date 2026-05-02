# Native-Core Engineering Guardrails

Status: Active  
Applies to: `apps/desktop/src/main`, `crates/*` native capability crates, C/C++ native components

## Goal
Lyra desktop keeps a single source of truth for system-facing capabilities:

- Native-owned capabilities live in native core code: Rust first for safety/orchestration, with C and C++ as accepted core implementation languages where they are the right tool.
- Desktop main TypeScript code stays as shell glue, IPC wiring, and orchestration.
- Bridge-only modules remain thin and do not re-implement native logic.
- Performance-sensitive state, event normalization, indexing, protocol behavior, parsing, scoring, and compute-heavy view-model preparation move downward instead of growing in UI code.
- Assembly is allowed only for isolated, benchmarked kernels behind a safe Rust or C/C++ boundary with a portable fallback.

This document is the enforcement reference for `pnpm lint:rust-first`. The command name is retained for compatibility; the policy is now native-core rather than Rust-only.
The performance escalation policy is defined in `docs/architecture/performance-engineering.md`.

## Native-Owned Modules
These modules must route core behavior to the matching native core boundary:

| Module | Desktop Path | Native Core |
| --- | --- | --- |
| files | `apps/desktop/src/main/files` | `crates/lyra-files-napi` |
| terminal | `apps/desktop/src/main/terminal` | `crates/lyra-terminal-core` |
| lsp | `apps/desktop/src/main/lsp` | `crates/lyra-lsp-core` |
| skills | `apps/desktop/src/main/skills` | `crates/lyra-skills-napi` |
| mcp | `apps/desktop/src/main/mcp` | `crates/lyra-mcp-core` |
| resources | `apps/desktop/src/main/resources` | `crates/lyra-resource-napi` / `crates/lyra-resource-core` |
| image-viewer | `apps/desktop/src/main/image-viewer` | `crates/lyra-image-napi` / `crates/lyra-image-core` |
| ai | `apps/desktop/src/main/ai` | `vendor/lyra-core/lyra-rs` |

Requirements:

1. Rust crate, Rust-owned C/C++ component, or vendored native workspace must exist.
2. Main process wiring must call the module bridge factory in `apps/desktop/src/main/index.ts`.
3. `apps/desktop/package.json` `scripts.native:build` must include `-p <crate>`.
4. `lyrad` must build in its own `cargo build` invocation. Do not combine it with Node-API/native addon packages in the same Cargo command, because Cargo feature unification can enable `node-api` on crates linked into the daemon and produce unresolved `_napi_*` symbols.
5. TypeScript services must not keep fallback implementations for native-owned behavior.

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

If a TypeScript-owned module becomes stateful + OS-facing + security-sensitive, it should move to native ownership.

If a TypeScript-owned module becomes a repeated performance bottleneck, first measure and reduce UI/event work. If the bottleneck is heavy state, parsing, scanning, indexing, protocol behavior, or long-lived runtime coordination, move that responsibility to the native core. Rust remains the default coordination and safety boundary; C/C++ may own the lower-level engine when that is the stronger implementation choice.

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

## Native Acceleration Policy
Lyra's core native implementation languages are Rust, C, and C++.

- Rust is the default for orchestration, safety boundaries, concurrency, permissions, lifecycle management, and API integration.
- C and C++ are first-class options for high-performance indexing, parsing, tokenization, search/scoring kernels, platform SDK integration, media/rendering engines, and mature native libraries.
- Rust should normally own the external product boundary even when the hot engine below it is C or C++.

Hand-written assembly is not part of normal product development, but it is allowed for exceptional, isolated kernels when profiling proves Rust/C/C++ and compiler/SIMD optimizations are insufficient. Assembly-level optimization must be isolated behind a safe Rust, C, or C++ API, benchmarked, tested, and paired with a portable fallback.

Do not rewrite ordinary UI surfaces in C/C++ or assembly. Optimize React rendering, event batching, virtualization, and native-backed view models first. Specialized native or canvas rendering is reserved for dense high-frequency surfaces with measured pressure.

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
