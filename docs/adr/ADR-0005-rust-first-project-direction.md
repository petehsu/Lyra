# ADR-0005: Native-Core Project Direction

## Status
Accepted

## Date
2026-03-29

## Updated
2026-05-01

## Context
Lyra is growing into a desktop product with terminal runtime, filesystem operations, device handling, LSP orchestration, MCP runtime management, skill package management, and future sandboxed agent workflows.

Those capabilities are not ordinary UI logic. They are:
- stateful
- OS-facing
- performance-sensitive
- security-sensitive
- long-lived

Earlier iterations allowed some native capabilities to coexist with TypeScript fallback or duplicate implementations. That created the exact failure mode Lyra should avoid early: drift, hidden compatibility layers, thicker main-process services, and future cleanup debt.

## Decision
1. Lyra is a native-core-led project.
2. For native-owned domains, the core implementation belongs in native code: Rust, C, C++, or isolated assembly kernels when justified.
3. Rust remains the default safety, orchestration, lifecycle, permissions, concurrency, and product API boundary.
4. C and C++ are first-class implementation options for performance kernels, mature native engines, platform SDK integration, parsing/indexing/search engines, media/rendering subsystems, and other domains where they are the stronger technical fit.
5. TypeScript remains important, but its role is constrained to:
   - UI
   - Electron shell glue
   - IPC registration
   - shared contracts
   - lightweight request shaping
   - event fan-out
6. TypeScript must not keep a second implementation of a native-owned capability.
7. Desktop main modules must be explicitly classified as one of:
   - native-owned
   - TypeScript-owned
   - bridge-only
8. The following desktop main domains are native-owned:
   - `files`
   - `terminal`
   - `lsp`
   - `skills`
   - `mcp`
   - `resources`
   - `image-viewer`
   - native-backed runtime ports such as `workbench-fs-port`
9. `search` and `linux-compat` are currently TypeScript-owned shell concerns, but must move downward if they become heavier, stateful, or system-facing.
10. New core product behavior that is stateful, OS-facing, security-sensitive, or performance-sensitive should default to the native core, not TypeScript.
11. During development, Lyra prefers clean replacement over compatibility debt. We do not keep TypeScript fallback paths alive for already-native-owned behavior.
12. Lyra optimizes for measured performance before lower-level rewrites. TypeScript remains the default UI layer, while the native core is the destination for heavy state, event normalization, protocol behavior, indexing, parsing, scoring, and compute-heavy view-model preparation.
13. Hand-written assembly is exceptional. It must be isolated, benchmarked, tested, backed by a portable fallback, and entered through a safe Rust/C/C++ boundary.

## Consequences
### Positive
- Core behavior now has a single source of truth.
- Main-process services stay thinner and easier to reason about.
- Performance-sensitive and security-sensitive paths live closer to the system boundary.
- UI performance work has a clear escalation path: optimize React/event/state flow first, move heavy work to native core second, and use C/C++ or assembly-level techniques where evidence and boundaries justify them.
- Future agent, sandbox, filesystem, and runtime features can build on stable native foundations.

### Tradeoffs
- Native build health becomes part of daily development, not an optional path.
- Some changes will require Rust, C, or C++ work even when a TypeScript-only shortcut would be faster in the moment.
- Startup should fail loudly if required native capabilities are unavailable.
- Native acceleration must justify its complexity with measurements, tests, and a narrow boundary.

## Enforcement
This ADR is enforced by:
- `docs/architecture/rust-first-engineering.md`
- `docs/architecture/performance-engineering.md`
- `pnpm lint:structure`
- `pnpm lint:rust-first`

The guard is intentionally opinionated. If a new desktop main module or capability needs a different ownership model, it should be justified explicitly instead of silently growing in TypeScript.

The `rust-first` command and document path are historical compatibility names. The accepted project direction is native-core: Rust plus C/C++ as core implementation stacks, with assembly reserved for isolated measured kernels.
