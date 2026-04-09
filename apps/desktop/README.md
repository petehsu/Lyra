# @lyra/desktop

Desktop shell module for Lyra.

## Responsibilities
- Electron window shell and secure preload bridge
- React renderer for workbench layout
- UI state orchestration (layout, tabs, AI panel)
- Desktop-side bootstrap and connection management for native runtimes

## Non-Responsibilities
- Business orchestration logic
- Direct system privilege operations
- Hosting the steady-state AI execution loop for `Chat` / `Agent` / `Oma`

## AI Runtime Direction
- Lyra desktop is the shell, not the AI execution host.
- The steady-state architecture is: desktop startup establishes one long-lived Rust AI runtime transport.
- `Chat`, `Agent`, and `Oma` all use that same runtime mainline.
- Callback-style Electron execution is transitional compatibility only, not the target design.

## Commands
- `pnpm --filter @lyra/desktop dev` start Electron + renderer
- `pnpm --filter @lyra/desktop build` build desktop bundles
- `pnpm --filter @lyra/desktop test` run unit/component tests
- `npm --prefix apps/desktop run lsp:bundle:rust-analyzer` install rust-analyzer bundle matrix
- `npm --prefix apps/desktop run lsp:preflight` run LSP release preflight checks
