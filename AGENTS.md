# Repository Guidelines

## Project Structure & Module Organization

Lyra is a Rust/TypeScript monorepo: native code is in `crates/`, products in `apps/`, shared code in `packages/`, services in `services/`, and public projects in `web/`. Keep documentation in `docs/` and automation in `tools/` or `.github/workflows/`. Treat `archive/` and `references/` as non-product material.

## Build, Test, and Development Commands

Use Node 24, pnpm 11, and the Rust toolchain required by the workspace.

- `pnpm dev:desktop` starts the desktop application with local docs.
- `pnpm build:ts` builds TypeScript workspaces; `cargo build --workspace` builds Rust crates.
- `pnpm check` runs architecture, hygiene, type, component, app, docs, legal, and web checks.
- `cargo test --workspace` runs the complete Rust test suite.
- `pnpm --filter @lyra/desktop test` runs focused desktop tests.

Use focused checks while iterating; run the full checks before release changes.

## Coding Style & Naming Conventions

Follow `.editorconfig`: UTF-8, LF, two-space indentation generally, and four spaces for Rust/Python. Use `kebab-case` TypeScript filenames, `PascalCase` components/types, and `camelCase` values. Rust uses `snake_case` modules/functions and `PascalCase` types. Run `cargo fmt --all`, `cargo clippy --workspace --all-targets --no-deps`, and `pnpm lint:structure`.

## Testing Guidelines

TypeScript tests use Vitest or Node/tsx and are named `*.test.ts(x)`. Rust unit tests stay beside implementation; integration tests belong in `crates/<name>/tests/`. Review snapshot changes deliberately. Add regression tests for changed behavior and security boundaries; no universal coverage threshold exists.

## Commit & Pull Request Guidelines

History follows Conventional Commits, for example `fix(agent): restore default tool calling`. Use an imperative, scoped subject and focused commits. Pull requests should explain intent and risk, link issues or ADRs, list validation, and include screenshots for UI changes. Call out migrations, compatibility, and rollback considerations. Never commit secrets, keys, caches, or build output.

## Agent Collaboration Principles

Assume the repository owner is a non-technical vibe coder. Before implementing a request, check for false premises, logical gaps, missing requirements, and conflicts with repository constraints. Do not optimize for agreement: separate verified facts, forecasts, and subjective judgments. Verify consequential claims where practical. If a proposal is weak, say so and explain the evidence, risks, tradeoffs, and alternatives. Proactively surface overlooked variables, maintenance costs, accessibility, security, and bias. Treat option count and visible feature breadth as costs, not product value: reject speculative features that merely look powerful unless they solve a demonstrated user problem better than a smaller design. Prefer removing or consolidating weak capabilities before adding another path. Challenge design suggestions that harm usability, feasibility, or maintainability, and recommend a concrete alternative.
