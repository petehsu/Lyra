# Lyra

Lyra is an AI-native workstation monorepo.

## Quick Intent
- Familiar shell for browser users
- Deep workflows for IDE users
- Modular architecture with strict boundaries

## Repository Layout
- `apps/desktop`: Desktop shell (Electron UI host)
- `services/control-plane`: AI orchestration and session control
- `services/browser-automation`: Browser automation and telemetry bridge
- `services/agent-engine`: Python execution adapters (OpenHands / smolagents)
- `crates/lyrad`: Rust system daemon (permissions, audit, process)
- `crates/lyra-sandbox`: Rust sandbox policies and helpers
- `packages/capability-protocol`: Shared protocol schema and TS types
- `packages/plugin-sdk`: Plugin SDK and manifest contracts
- `docs/architecture`: Architecture and module boundaries
- `docs/adr`: Architecture decision records
- `tools`: Repository guardrail tooling

## Guardrails
Run:
```bash
pnpm lint:structure
```
This enforces:
- max source file length
- forbidden cross-layer imports
- no direct cross-module deep imports

## Start Building
1. Read architecture constraints in `docs/architecture/overview.md`.
2. For UI workbench changes, read `docs/architecture/workbench-design-standards.md`.
3. Create module skeletons with:
```bash
pnpm new:module <target-dir> <module-name>
```
Example:
```bash
pnpm new:module services/control-plane/src/modules approval_router
```
4. Run structure checks before each commit:
```bash
pnpm check
```
