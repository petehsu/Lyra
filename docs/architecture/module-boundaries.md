# Module Boundaries

## Single Responsibility Standard
- One module = one core responsibility.
- Public API exposed through `index.ts` / `mod.rs` / package init.
- Internal helpers stay private to module directory.

## Required Module Shape
- `module_name/index.*` (public entry)
- `module_name/types.*` (contracts)
- `module_name/service.*` (core behavior)
- `module_name/tests/*` (module tests)

## Native-Owned Desktop Main Shape
For native-owned modules under `apps/desktop/src/main/<module>`:
- `service.ts` is a thin Electron bridge
- `native-loader.ts` loads the corresponding NAPI addon
- `types.ts` defines the bridge contract
- the matching Rust crate under `crates/lyra-*-napi` owns the core behavior

Do not let `service.ts` regrow core parsing, persistence, runtime lifecycle, or fallback logic once the native boundary exists.

## Anti-Patterns
- God service files
- Shared mutable global state
- Circular imports
