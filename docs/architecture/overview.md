# Lyra Architecture Overview

## Layers
1. App Layer: `apps/desktop`
2. Service Layer: `services/control-plane`, `services/browser-automation`, `services/agent-engine`
3. System Layer: `crates/lyrad`, `crates/lyra-sandbox`
4. Shared Contracts Layer: `packages/capability-protocol`, `packages/plugin-sdk`

## Rules
- Layer can only depend downward through explicit contracts.
- No app-to-service direct internal imports.
- No cross-module deep imports (`../../other-module/internal/*`).
- Keep source files under 420 lines.
- Desktop main follows Rust-first ownership: core runtime, IO, security, and lifecycle code belongs in Rust.

## Core References
- Rust-first ownership and engineering rules: `docs/architecture/rust-first-engineering.md`
- AI computer system-image guardrails: `docs/architecture/ai-computer-system-image-guardrails.md`
- AI storage architecture V1: `docs/architecture/ai-storage-architecture-v1.md`
- AI memory architecture V2 (session isolation and trim archive): `docs/architecture/ai-memory-architecture-v2.md`
- Architecture constraints: `docs/architecture/engineering-guardrails.md`
- Module boundaries: `docs/architecture/module-boundaries.md`
- Workbench UI standards: `docs/architecture/workbench-design-standards.md`
- UI anti-web guardrails: `docs/architecture/ui-anti-web-guardrails.md`
- File editor intelligent core (LSP V1): `docs/architecture/file-editor-lsp-v1.md`
- LSP packaging and release preflight: `docs/architecture/lsp-packaging-v1.md`
