# M6B-1 LongWorkRun v1 Design Checkpoint

## Objective

完成 LongWorkRun v1 最小内核：Runtime 在 approved plan_bound Todo 和中等复杂 mini Todo 后创建可读的 LongWork 账本，`read_session_detail` 暴露摘要，prompt 和 AI panel 显示当前 LongWork 状态，并由 Todo / Approval / Verification / CompletionAudit 保守推进状态。

不实现自动 continuation、多 slice 续跑、Follow live edit、message rollback、pause / resume / cancel UI、shell/test/build 能力扩展。

## Module Ownership

- Storage schema owner: `crates/lyra-ai-core/src/storage/long_work_schema.rs`，只负责 LongWork 表 DDL 和轻量 migration 接线。
- Storage ledger owner: `crates/lyra-ai-core/src/storage/long_work.rs`，负责创建 goal/run、读取 latest active run、状态更新、slice 创建/关闭、summary 查询。
- Storage models owner: `crates/lyra-ai-core/src/storage/long_work_models.rs`，承载 `AgentLongWorkSummary`、`AgentWorkSliceSummary` 和 ledger input/result 类型。
- Runtime projection owner: `crates/lyra-ai-core/src/agent_runtime/long_work_projection.rs`，负责从 plan approve、mini Todo、tool result、completion audit 投影 LongWork 状态并发事件。
- Prompt owner: `crates/lyra-ai-core/src/prompt.rs` 只接收 `long_work_summaries` 并渲染短摘要；摘要构造不放在 prompt。
- UI owner: `apps/desktop/src/modules/workbench/ai-panel/long-work-status-row.tsx` 及同名测试；`surface-view.tsx` 只接线。
- Type bridge owner: `apps/desktop/src/shared/agent.ts` 承载共享 TS 类型和事件枚举；主进程 bridge 不新增 API。
- Tests owner: `crates/lyra-ai-core/src/agent_runtime/long_work_tests.rs` 和 focused UI tests；不扩张 legacy `agent_runtime/tests.rs`。

历史高触达文件只能薄接线，不承载 LongWork SQL、状态机或 UI 组合逻辑。

## State Contract

- `native_long_work_goal.goal_id` 绑定 `session_id`，保存 thread 级 `objective_summary`、`status`、`budget_json`、`completion_contract_json`。
- `long_work_run.long_work_run_id` 绑定 `session_id`、`runtime_turn_id`、`user_message_id`、`plan_id`、`todo_list_id`、`execution_run_id`、`goal_id` 和 `current_slice_id`。
- `work_slice.work_slice_id` 绑定 `long_work_run_id`、`todo_list_id`、`execution_run_id`，记录当前 5-9 步 active slice 的 `status`、checkpoint/blocker ids 和 started/closed 时间。
- plan approve 入口只有在 `planCoverageSummary.status == valid` 且存在 `plan_bound` Todo 与 ExecutionRun 时创建 run。
- mini Todo 入口只在 heuristic 判断为执行请求并创建 Todo/ExecutionRun 后创建 run；纯问答不创建。
- Approval required / denied、tool failed、CompletionAudit 结果只通过 focused projection 更新 LongWork，不改变 Todo/Approval/Verification/CompletionAudit 的 owner。
- completed 只能在 CompletionAudit passed 且绑定 Todo 全部完成时设置；否则保持 running / blocked / failed。

## Current Slice

1. 建立 LongWork focused storage/schema/model 文件并薄接线。
2. 写 Rust targeted tests 覆盖 plan valid/failed、mini Todo、approval denied、unfinished Todo、read_session_detail。
3. 实现 SQLite 表和 LongWork ledger methods。
4. 接入 plan approve 和 mini Todo 创建路径，发 `long_work.created` / `long_work.slice_started`。
5. 接入 tool/result 与 completion projection，发 blocked/completed 事件并保守防止未完成 Todo completed。
6. 注入 prompt LongWork 摘要。
7. 扩展 shared TS types 和 AI panel compact `LongWorkStatusRow`。
8. 跑 targeted tests 与文档要求的 verification gates。

## Verification First

先写可运行的 focused tests：

- Rust: `cargo test -p lyra-ai-core long_work`
- Desktop: `npm --prefix apps/desktop run test -- long-work-status-row`

实现稳定后再跑文档要求的 broad gates：

- `cargo test -p lyra-ai-core`
- `cargo test -p lyrad`
- `npm --prefix apps/desktop run test -- ai-panel`
- `npm --prefix apps/desktop run test -- main/ai`
- `pnpm lint:rust-first`
- `pnpm check`
- `git diff --check`

## No Bulk Generation

不生成无 owner 的脚手架，不留下 AI/bulk generated marker，不做一函数一文件拆分。新增模块必须分别拥有 schema、ledger、model、runtime projection、UI status row、focused tests 的稳定职责边界。
