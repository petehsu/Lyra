# Crate and package boundaries

Audience: Internal
Status: Active
Last verified: 2026-07-28

The generated [module index](../generated/modules.md) lists current workspaces.
This page records ownership direction rather than every package.

## Agent and daemon

- `lyra-agent-api`: data-only Agent DTOs and service contracts; no Desktop or
  kernel dependency.
- `lyra-agent-kernel`: kernel abstractions; no Desktop dependency.
- `lyra-agent-plugins`: provider registry abstractions for built-in, MCP, and
  Skill tools.
- `lyra-tool-fs-core`: manifest/schema/search registry; no Electron host logic.
- `lyra-agent-runtime`: authoritative Agent execution and persistence.
- `lyra-agent-core`: temporary compatibility facade over runtime.
- `lyra-runtime-protocol`: daemon envelopes and shared data-only transport
  types.
- `lyrad`: process/socket routing and native service composition.
- `lyra-cli`: user-facing command shell over supported runtime behavior.

Forbidden directions are enforced by `pnpm lint:agent-boundary` and
`pnpm lint:no-jcode-public-api`.

## Desktop

- `src/shared`: structured-clone-safe DTOs and constants; no main/renderer
  implementation imports.
- `src/preload`: fixed bridge adapters only.
- `src/main`: privileged Electron/OS adapters and native binding integration.
- `src/modules/workbench`: product/business UI modules.
- `src/renderer/ui` and `src/renderer/styles`: shared design system and tokens.

Presentational `*-view.tsx` modules must not acquire bridge calls or broad
runtime state. Business surfaces consume App components rather than Radix or
intrinsic controls directly.

## Native feature cores

Files, downloads, images, documents, LSP, terminal, accessibility, performance,
process lifecycle, computer use, and hardware are split into focused
core/N-API crates. Electron loads N-API bindings or calls `lyrad`; it should not
grow a second implementation for native-owned behavior.

## Compatibility

All of these package boundaries and Rust/TypeScript types are internal. Closed
source distribution does not turn crate names, symbols, IPC, socket methods, or
SQLite rows into supported public interfaces. Public developer compatibility
is limited to the explicitly documented external contracts.

