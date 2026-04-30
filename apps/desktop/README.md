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
- Native core code owns heavy runtime state, provider protocol behavior, event normalization, indexing, parsing, and compute-heavy view-model preparation.
- Rust remains the default safety/orchestration boundary, while C and C++ are accepted core implementation languages for measured engines, platform SDKs, parsers, indexers, media/rendering subsystems, and hot kernels.
- High-volume UI surfaces must use batching, selectors, virtualization, incremental rendering, and lazy rich rendering before introducing a new rendering stack.
- Hand-written assembly is exceptional, benchmark-driven, isolated behind a safe Rust/C/C++ boundary, tested, and must have a portable fallback.
- See `../../docs/architecture/performance-engineering.md`.

## Commands
- `pnpm --filter @lyra/desktop dev` start Electron + renderer
- `pnpm --filter @lyra/desktop build` build desktop bundles
- `pnpm --filter @lyra/desktop test` run unit/component tests
- `npm --prefix apps/desktop run lsp:bundle:rust-analyzer` install rust-analyzer bundle matrix
- `npm --prefix apps/desktop run lsp:preflight` run LSP release preflight checks
