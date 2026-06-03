# Lyra Terminal TODO 00: Parallel Master Roadmap

## Goal

把 Lyra Terminal 做成完整 Agent-native terminal software：

- Rust Terminal Kernel 拥有 PTY、事件、屏幕、命令、进程、权限、审计、Agent attachment 的事实来源。
- TypeScript 保持极轻，只做 IPC、Workbench 路由、权限 UI、prompt filter 和产品 UI。
- Agent 可以读、看、等、运行命令、输入文本、按键、发信号、操作 TUI、启动或挂接终端内 Agent。
- 能力不人为阉割，所有高影响执行都受 Lyra 权限审批、审计、可中断和可追踪约束。
- 长输出、TUI、REPL、debugger、SSH、dev server、CLI login 都能稳定处理。

## Completed Foundation

- [x] TODO 01 Kernel Truth and Storage completed and deleted.
- [x] TODO 02 Screen Model and Renderer completed and deleted.
- [x] TODO 03 Parallel Contracts and Integration Spine completed and deleted.
- [x] TODO 04 Kernel Input Controller and Permission Gate completed and deleted.
- [x] TODO 05 Command Tracker, Shell Integration, and Process Model completed and deleted.
- [x] TODO 06 TUI Map and Act completed and deleted.
- [x] TODO 07 Agent Tools and Event Streaming completed and deleted.
- [x] TODO 08 Workbench Terminal Product completed and deleted.
- [x] TODO 09 Agent Attachment and Terminal Agents completed and deleted.
- [x] TODO 10 Testing, Performance, and Release Gate completed and deleted.
- [x] TODO 11 Final Integration and Complete Terminal Shape completed and deleted.
- [x] Rust Terminal Memory is Kernel truth for v1 artifacts.
- [x] Journal cursor read/wait reads from `session-output.txt`.
- [x] `terminal_wait` returns `reason: output | exit | timeout`.
- [x] `terminal.events.read`, `terminal.commands.read`, `terminal.output.readRange`, `terminal.artifacts.list`.
- [x] Workbench `terminal-memory` tab and compact tool-card timeline.
- [x] Rust screen snapshot, screen diff, fixtures, and `terminal_screen`.

## Parallel Execution Model

Do not run this as one linear TODO queue. Use one AI window per TODO file.

### Wave 0: Contract Gate

- [x] `Lyra-Terminal-TODO-03-Parallel-Contracts-Spine.md`

This file owns shared contracts and central wiring. It should land first, or at least be the only window allowed to edit shared spine files.

Shared spine files:

- [x] `crates/lyra-terminal-core/src/lib.rs`
- [x] `crates/lyrad/src/handlers.rs`
- [x] `apps/desktop/src/shared/desktop-bridge.ts`
- [x] `apps/desktop/src/preload/index.ts`
- [x] `apps/desktop/src/main/terminal/types.ts`
- [x] `apps/desktop/src/main/terminal/service.ts`

### Wave 1: Parallel Feature Work

After TODO 03 stubs/contracts exist, these can run in parallel:

- [x] `Lyra-Terminal-TODO-04-Kernel-Input-Permissions.md`
- [x] `Lyra-Terminal-TODO-05-Command-Process-Shell.md`
- [x] `Lyra-Terminal-TODO-06-TUI-Map-Act.md`
- [x] `Lyra-Terminal-TODO-07-Agent-Tools-Streaming.md`
- [x] `Lyra-Terminal-TODO-08-Workbench-Terminal-Product.md`
- [x] `Lyra-Terminal-TODO-09-Agent-Attachment-Terminal-Agents.md`
- [x] `Lyra-Terminal-TODO-10-Testing-Perf-Release.md`

Each window must obey its TODO `Owned Files` list. If it needs a shared interface change, it should coordinate through TODO 03 rather than editing the shared spine directly.

### Wave 2: Final Integration

- [x] `Lyra-Terminal-TODO-11-Final-Integration-Acceptance.md`

Run only after TODO 04-10 land or are explicitly marked blocked. This window removes stubs, resolves integration edges, runs full release gate, and deletes completed TODO files.

## Conflict Avoidance Rules

- [x] One window owns shared runtime/bridge contracts: TODO 03.
- [x] Kernel feature windows create new Rust modules and tests; they do not wire `lib.rs` directly unless TODO 03 delegates it.
- [x] Agent tool window owns Agent runtime and tool-card logic; it does not implement Kernel internals.
- [x] Workbench product window owns terminal UI product surfaces; it does not implement Kernel truth.
- [x] Testing window may add tests/fixtures/benchmarks, but should not rewrite production logic.
- [x] Final integration window is last and may touch multiple areas only after feature windows are done.

## Current TODO Files

- [x] `Lyra-Terminal-TODO-03-Parallel-Contracts-Spine.md`
- [x] `Lyra-Terminal-TODO-04-Kernel-Input-Permissions.md`
- [x] `Lyra-Terminal-TODO-05-Command-Process-Shell.md`
- [x] `Lyra-Terminal-TODO-06-TUI-Map-Act.md`
- [x] `Lyra-Terminal-TODO-07-Agent-Tools-Streaming.md`
- [x] `Lyra-Terminal-TODO-08-Workbench-Terminal-Product.md`
- [x] `Lyra-Terminal-TODO-09-Agent-Attachment-Terminal-Agents.md`
- [x] `Lyra-Terminal-TODO-10-Testing-Perf-Release.md`
- [x] `Lyra-Terminal-TODO-11-Final-Integration-Acceptance.md`

All implementation TODO files above have been completed and removed. This master roadmap remains as the final completion record.

## Final Definition of Done

- [x] Agent can complete real terminal tasks: install, build, test, debug, CLI login, interactive setup, long-running dev server.
- [x] Agent sees current visible screen, including alternate-screen TUI.
- [x] Agent can run commands, input text, press keys, select TUI items, and send signals through semantic permissions.
- [x] All input, output, commands, permissions, processes, and Agent attachments are auditable.
- [x] Long output never disappears due to model context; local artifacts and indexes remain complete.
- [x] UI terminal, private terminal, Agent tools, and Workbench tabs use the same Rust Kernel truth.
- [x] TS does not own terminal truth.
- [x] Cross-platform, TUI, long-output, permission, security, and performance regression gates pass.

## Final Validation Log

- [x] `cargo test --manifest-path Cargo.toml -p lyra-terminal-core`
- [x] `cargo test --manifest-path Cargo.toml -p lyra-agent-runtime`
- [x] `cargo check --manifest-path Cargo.toml -p lyrad`
- [x] `cargo test --manifest-path Cargo.toml -p lyrad`
- [x] `npm --prefix apps/desktop run test -- src/main/terminal/tests src/main/agent/tests src/modules/workbench/ai-panel/tests`
- [x] `npm --prefix apps/desktop run test -- src/modules/workbench/ui-platform/tests src/modules/workbench/workspace-tabs/tests`
- [x] `npm --prefix apps/desktop run test -- src/modules/workbench/shell/tests/navigation-input.test.ts src/modules/workbench/shell/tests/use-titlebar-navigation-model.test.tsx src/modules/workbench/terminal-dock/tests/pane-surface.test.tsx src/modules/workbench/terminal-dock/tests/view.test.tsx src/modules/workbench/ai-panel/tests/terminal-tool-card.test.tsx`
- [x] `npm --prefix apps/desktop run typecheck`
- [x] `node scripts/terminal-fixtures/generate.mjs --check`
- [x] `cargo fmt --all --check --manifest-path Cargo.toml`
- [x] `git diff --check`
