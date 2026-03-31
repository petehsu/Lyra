# @lyra/desktop

Desktop shell module for Lyra.

## Responsibilities
- Electron window shell and secure preload bridge
- React renderer for workbench layout
- UI state orchestration (layout, tabs, AI panel)

## Non-Responsibilities
- Business orchestration logic
- Direct system privilege operations

## Commands
- `pnpm --filter @lyra/desktop dev` start Electron + renderer
- `pnpm --filter @lyra/desktop build` build desktop bundles
- `pnpm --filter @lyra/desktop test` run unit/component tests
- `npm --prefix apps/desktop run lsp:bundle:rust-analyzer` install rust-analyzer bundle matrix
- `npm --prefix apps/desktop run lsp:preflight` run LSP release preflight checks
