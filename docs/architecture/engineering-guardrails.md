# Engineering Guardrails

## Mandatory Rules
1. Keep each source file <= 420 lines.
2. Every module exposes only through `index.ts` / `mod.rs` / package root.
3. No app-to-service internal imports.
4. No service-to-app imports.
5. No cross-service internal imports without protocol contracts.
6. New features must be added as new modules, not appended to existing god files.
7. Lyra is Rust-first: system-facing, stateful, security-sensitive, performance-sensitive core logic belongs in Rust.
8. Native-owned desktop main modules must not keep TypeScript fallback implementations.
9. Every new directory under `apps/desktop/src/main` must be classified as native-owned, TypeScript-owned, or bridge-only before implementation.
10. Every native-owned crate must be wired in both `Cargo.toml` workspace and `apps/desktop/package.json` `native:build` script.
11. Every native-owned desktop main module must be explicitly wired in `apps/desktop/src/main/index.ts`.

## Rust-First Ownership
Use `docs/architecture/rust-first-engineering.md` as the authoritative decision guide.

Short version:
- Rust owns core runtime, IO, config merge/validation, secret handling, process lifecycle, and OS integration.
- TypeScript owns UI, Electron shell wiring, IPC registration, shared contracts, and lightweight orchestration.
- If a TypeScript service in a native-owned domain starts growing parsing, persistence, recursive IO, runtime maps, or child-process lifecycle logic, stop and move it into Rust.

## PR Checklist
- [ ] New module follows `types/service/index/tests` shape.
- [ ] Boundaries still pass `pnpm lint:structure`.
- [ ] Rust-first guard passes `pnpm lint:rust-first`.
- [ ] UI style guard passes `pnpm lint:ui-style` when touching workbench UI.
- [ ] No circular dependency introduced.
- [ ] Public contracts documented under `packages/capability-protocol` when needed.

## Module Lifecycle
- Create: `pnpm new:module <target-dir> <module-name>`
- Integrate through module index export
- Add tests/spec markdown in module tests folder
