# ADR-0005: Rust-First Project Direction

## Status
Accepted

## Date
2026-03-29

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
1. Lyra is a Rust-led project.
2. For native-owned domains, Rust is the only core implementation.
3. TypeScript remains important, but its role is constrained to:
   - UI
   - Electron shell glue
   - IPC registration
   - shared contracts
   - lightweight request shaping
   - event fan-out
4. TypeScript must not keep a second implementation of a native-owned capability.
5. Desktop main modules must be explicitly classified as one of:
   - native-owned
   - TypeScript-owned
   - bridge-only
6. The following desktop main domains are native-owned:
   - `files`
   - `terminal`
   - `lsp`
   - `skills`
   - `mcp`
   - native-backed runtime ports such as `workbench-fs-port`
7. `search` and `linux-compat` are currently TypeScript-owned shell concerns, but must move downward if they become heavier, stateful, or system-facing.
8. New core product behavior that is stateful, OS-facing, security-sensitive, or performance-sensitive should default to Rust.
9. During development, Lyra prefers clean replacement over compatibility debt. We do not keep TypeScript fallback paths alive for already-native-owned behavior.

## Consequences
### Positive
- Core behavior now has a single source of truth.
- Main-process services stay thinner and easier to reason about.
- Performance-sensitive and security-sensitive paths live closer to the system boundary.
- Future agent, sandbox, filesystem, and runtime features can build on stable native foundations.

### Tradeoffs
- Native build health becomes part of daily development, not an optional path.
- Some changes will require Rust work even when a TypeScript-only shortcut would be faster in the moment.
- Startup should fail loudly if required native capabilities are unavailable.

## Enforcement
This ADR is enforced by:
- `docs/architecture/rust-first-engineering.md`
- `pnpm lint:structure`
- `pnpm lint:rust-first`

The guard is intentionally opinionated. If a new desktop main module or capability needs a different ownership model, it should be justified explicitly instead of silently growing in TypeScript.
