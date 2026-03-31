# Rust-First Engineering

## Project Direction
Lyra is a Rust-led project.

That is not branding language. It is an engineering rule:
- Rust owns system-facing and core domain behavior.
- TypeScript owns UI, Electron shell wiring, typed contracts, and lightweight orchestration.
- When a capability can reasonably live in Rust, the default answer is Rust.
- TypeScript is not a second core runtime for the same capability.

The project bias is simple:
- More Rust
- Less TypeScript
- No dual implementation for one core capability

## Why Lyra Is Rust-First
Lyra is not a conventional web app. It is a desktop product with:
- terminal runtime
- file IO and filesystem traversal
- mount/eject logic
- LSP runtime management
- MCP runtime and secure secret handling
- skill package import, install, and parsing
- future sandboxed execution and agent workflows

Those areas are long-lived, stateful, performance-sensitive, OS-facing, and security-sensitive. They should not be reimplemented in TypeScript once a native boundary exists.

## Ownership Model
### Rust Must Own
The following classes of work belong in Rust by default:
- Filesystem traversal, recursive copy, large directory scans, and file summaries
- Process lifecycle and runtime registries
- PTY, shell session, and terminal-native behavior
- LSP transport/runtime orchestration
- MCP server lifecycle, validation, environment materialization, and secret backend
- Skill package parsing, install, storage mutation, and compatibility adapters
- Secret storage and secure token handling
- Config normalization, merge, validation, and persistence for native-owned domains
- OS integration: mount, eject, device inspection, permission and sandbox policy
- Hot-path parsing, structured data transforms, and repeated background work
- Anything that can create drift, race conditions, or perf cliffs if duplicated in TS

### TypeScript May Own
The following areas are intentionally TypeScript-owned:
- React UI, renderer state, selectors, and presentational composition
- Electron window/webContents/menu/tray integration
- IPC registration and request routing
- Shared request/response types and bridge contracts
- Theme tokens, i18n dictionaries, and docs/web presentation
- Lightweight request normalization before calling native
- Event fan-out from main to renderer
- Build tooling, scripts, and test harness glue

### TypeScript Must Not Own In Native-Owned Domains
Once a domain is native-owned, TypeScript must not:
- Keep a fallback implementation of the same behavior
- Reimplement core parsing, merge, validation, or persistence logic
- Spawn and manage runtime child processes that Rust already owns
- Store secrets or sensitive values outside the native secure backend
- Perform recursive scanning, package copy, or other heavy IO as a backup path
- Keep shadow registries, maps, or caches for runtime state already owned in Rust
- Quietly degrade into "native preferred but TS still works"

## Current Ownership Registry
### Native-Owned Desktop Main Modules
1. `apps/desktop/src/main/files`
- Native crate: `crates/lyra-files-napi`
- TypeScript role: IPC registration, request shaping, Electron bridge only

2. `apps/desktop/src/main/terminal`
- Native crate: `crates/lyra-terminal-napi`
- TypeScript role: IPC registration, starship/runtime integration, Electron event bridge

3. `apps/desktop/src/main/lsp`
- Native crate: `crates/lyra-lsp-napi`
- TypeScript role: environment path discovery, IPC registration, Electron event bridge

4. `apps/desktop/src/main/skills`
- Native crate: `crates/lyra-skills-napi`
- TypeScript role: IPC registration, builtin metadata assembly, window event publishing

5. `apps/desktop/src/main/mcp`
- Native crate: `crates/lyra-mcp-napi`
- TypeScript role: IPC registration, catalog metadata assembly, Electron event publishing

6. `apps/desktop/src/main/computer`
- Native crate: `crates/lyra-computer-napi`
- TypeScript role: IPC registration, host-state projection, Electron event publishing

7. `apps/desktop/src/main/system-image`
- Native crate: `crates/lyra-system-image-napi`
- TypeScript role: IPC registration, install source routing, session/system event publishing

8. `apps/desktop/src/main/runtime/workbench-fs-port.ts`
- Ownership: native-backed port only
- Rule: never reintroduce Node `fs` fallback here

### TypeScript-Owned Desktop Main Modules
1. `apps/desktop/src/main/search`
- Reason: provider composition and lightweight search routing are currently app-shell concerns
- Constraint: if search grows into indexing, ranking, caching, or background crawling, move core downward into Rust

2. `apps/desktop/src/main/linux-compat`
- Reason: startup environment detection and Electron/Linux bootstrap behavior are shell concerns
- Constraint: if low-level probing becomes deep or stateful, move the probing layer downward into Rust

### TypeScript-Owned App Layers
- `apps/desktop/src/modules/workbench/**`
- `apps/desktop/src/shared/**`
- `web/docs/**`

These layers are not native cores. They are UI, contracts, documentation, and presentation.

## New Module Rule
Any new desktop main module must be classified before implementation.

### Choose Native-Owned If It Touches
- process lifecycle
- filesystems
- OS devices
- permissions or secrets
- structured config persistence
- runtime registries
- repeated background work
- large scans or package installation
- anything performance-sensitive or security-sensitive

### Choose TypeScript-Owned Only If It Is Primarily
- UI orchestration
- Electron shell glue
- contract definition
- renderer state
- documentation or test tooling

### No Unclassified Main Modules
A new directory under `apps/desktop/src/main` must be registered in the Rust-first guard as one of:
- native-owned
- TypeScript-owned
- bridge-only

If it is not classified, the guard should fail.

## Mandatory Rules
1. Native-owned domains have one core implementation: Rust.
2. TypeScript must not keep a second implementation for the same core behavior.
3. Renderer and shared contracts must not import Electron main internals or Node-only runtime APIs.
4. `shared` stays contract-only and runtime-agnostic.
5. Main-process code may orchestrate, but core state machines and persistence logic should live in Rust.
6. If a TypeScript file in a native-owned domain starts growing parsing, merge, storage, or runtime logic, stop and move it downward.
7. During development, we prefer clean replacement over compatibility debt. Do not keep old TS paths alive "just in case."

## Practical Decision Table
### Put It In Rust
- "This touches the filesystem a lot."
- "This owns a long-lived process."
- "This holds runtime status for many objects."
- "This validates and merges persisted config."
- "This stores secrets or materializes environment variables."
- "This may become a perf bottleneck."
- "This should behave the same on every platform."

### Put It In TypeScript
- "This renders UI."
- "This binds IPC channels to an existing native core."
- "This forwards events to a BrowserWindow."
- "This defines request/response types."
- "This is docs, theming, copy, or view composition."

### Pause And Re-evaluate
- "This is in `apps/desktop/src/main`, but I am about to add recursive IO, parsing, or lifecycle code in TS."
- "This feature already has a native loader, but I want a TS backup path."
- "This is easier to write in TS, but it will become core product behavior."

If any of those are true, the answer is usually: move it into Rust now.

## Guardrails In Tooling
The repo uses automated checks to enforce this direction:
- `pnpm lint:structure`
- `pnpm lint:ui-style`
- `pnpm lint:rust-first`

`lint:rust-first` exists to protect the Rust-first ownership model, especially in desktop main modules.
AI 电脑系统镜像相关约束见 `docs/architecture/ai-computer-system-image-guardrails.md`。
统一数据目录契约见 `docs/architecture/lyra-storage-layout.md`。

## Red Flags
The following are strong indicators that architecture is slipping:
- "native preferred" plus a hidden TS fallback
- a TypeScript service file quietly re-growing runtime maps or storage mutation helpers
- Node `fs` fallback inside a native-backed port
- `shared` importing Electron or Node builtins
- renderer modules importing Node builtins or main-process code
- a new main module added without ownership classification

## Working Standard
For Lyra, the question is not "can this be done in TypeScript?"

The question is:
- Is this core product behavior?
- Is it stateful, heavy, system-facing, performance-sensitive, or security-sensitive?

If yes, it belongs in Rust.
