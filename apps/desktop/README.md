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

## Performance Direction
- TypeScript/React remains the default UI layer.
- Rust owns heavy runtime state, provider protocol behavior, event normalization, indexing, parsing, and compute-heavy view-model preparation.
- High-volume UI surfaces must use batching, selectors, virtualization, incremental rendering, and lazy rich rendering before introducing a new rendering stack.
- C/C++ is allowed only for narrow native library or platform integrations, or measured hot paths with a clear boundary.
- Hand-written assembly is exceptional, benchmark-driven, isolated, tested, and must have a portable fallback.
- See `../../docs/architecture/performance-engineering.md`.

## Commands
- `pnpm --filter @lyra/desktop dev` start Electron + renderer
- `pnpm --filter @lyra/desktop build` build desktop bundles
- `pnpm --filter @lyra/desktop test` run unit/component tests
- `npm --prefix apps/desktop run lsp:bundle:rust-analyzer` install rust-analyzer bundle matrix
- `npm --prefix apps/desktop run lsp:preflight` run LSP release preflight checks
