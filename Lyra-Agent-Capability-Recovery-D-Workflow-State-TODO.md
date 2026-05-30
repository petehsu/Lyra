# D - Workflow State / Rollback / Clarification / Permission / Long Work TODO

## 负责范围

本 TODO 负责把当前空壳或弱实现的 workflow service 做成真实可达能力，覆盖：

- rollback preview/restore
- permission request/respond/resume
- clarification ask/respond/resume
- goals
- overnight
- selfdev
- btw

不要处理底层文件编辑工具、provider streaming、MCP/Skills 动态工具。需要这些能力时通过 A/C/E 提供的接口调用。

## 当前问题证据

- `rollback_preview` 永远 `available:false`，`rollback_restore` 直接报错。
- `respond_permission` 只返回 `status:"recorded"`。
- `respond_clarification` 只发 `clarificationResolved`，没有恢复 blocked turn。
- `goals` 永远空列表。
- `start_overnight` 只创建 run record。
- `start_selfdev` 只是普通 session/turn 包装。
- `run_btw` 只写 side panel，不真正回答。

## 并行边界

本组主要触碰：

- `crates/lyra-agent-runtime/src/native_backend.rs`
- `crates/lyra-agent-runtime/src/permission_service.rs`
- `crates/lyra-agent-runtime/src/clarification_service.rs`
- `crates/lyra-agent-runtime/src/recovery_service.rs`
- `crates/lyra-agent-runtime/src/session_service.rs`
- `crates/lyra-agent-api/src/lib.rs`
- `apps/desktop/src/modules/workbench/agent-*`
- `apps/desktop/src/modules/workbench/ai-panel/*`

与 C 的接口约定：

- C 提供 turn lifecycle、interruption、resume primitives。
- D 的 clarification/permission 不直接 spawn 私有 turn loop，必须走 C 的 runtime turn state。

## TODO

### D1：Rollback checkpoint 主路径

- [ ] 定义 rollback checkpoint 数据结构，绑定 sessionId、turnId、messageId、changedFiles、artifact refs。
- [ ] 文件修改工具完成后写 checkpoint。
- [ ] `agent.rollback.preview` 返回真实 changedFiles 和 restore impact。
- [ ] `agent.rollback.restore` 能恢复 checkpoint 或给不可恢复原因。
- [ ] UI rollback action 只在 checkpoint 存在时显示。
- [ ] 测试：修改文件后 preview 可用，restore 后文件恢复。

### D2：Permission request/resume

- [ ] 定义 `PermissionRequest` typed state，包含 action、risk、summary、why、toolCallId、turnId。
- [ ] 高风险工具调用时 turn 进入 `waiting_for_permission`。
- [ ] UI permission respond 后恢复同一个 turn 或 linked child turn。
- [ ] deny 后工具结果结构化返回给模型，模型可选择替代方案。
- [ ] permission 不写 assistant bubble。
- [ ] 测试：危险 shell/file write 触发 permission，allow 后继续，deny 后不执行。

### D3：Clarification ask/respond/resume

- [ ] 定义 clarification model tool 或 runtime request，不能靠 assistant 文本伪装提问。
- [ ] ask 后 turn 进入 `waiting_for_user`。
- [ ] UI 面板展示结构化问题、选项、自由输入。
- [ ] 用户回答后恢复同一 runtime turn 或 linked child turn。
- [ ] 面板失败不暴露系统消息给用户。
- [ ] 测试：连续多个 clarification 都走面板，不退化为普通 assistant 文本。

### D4：Goals 真实化

- [ ] 定义 Lyra goal 数据结构和存储位置。
- [ ] 支持 list/create/open/resume/update/checkpoint。
- [ ] goal 与 memory/shared facts 同步，但不污染最新 user intent。
- [ ] side panel 或 goal view 消费结构化 projection。
- [ ] 测试：创建 goal 后 list/open/resume 可用。

### D5：Overnight 真实执行

- [ ] `agent.overnight.start` 创建 coordinator run 并启动后台执行。
- [ ] run event log 记录 task cards、progress、tool activity、handoff/review。
- [ ] 支持 cancel、status、log、review。
- [ ] overnight 不阻塞 UI 主会话。
- [ ] 测试：短任务 overnight 能完成并产出 review/log。

### D6：Selfdev 真实化

- [ ] selfdev session 有明确 mode、repo root、build/test/reload 能力。
- [ ] selfdev 工具走 A 的 file/shell/git 能力，reload 走 Lyra 原生 runtime reload。
- [ ] status 能返回当前 build/test/reload 状态。
- [ ] 不恢复 jcode selfdev 命名或 debug socket product API。
- [ ] 测试：selfdev start -> sendTurn -> status 有真实 task state。

### D7：BTW 真实侧问

- [ ] `/btw` 或 agent.btw.run 创建 side question turn。
- [ ] btw 默认只读当前会话上下文，不乱调用文件/网络工具。
- [ ] 答案写入 side panel，同时记录 runtime event。
- [ ] 正在主 turn 时可排队或并行，状态清晰。
- [ ] 测试：btw 会生成答案，而不是只把问题写进 side panel。

## 验收

- [ ] rollback/permission/clarification 不再是 fixed response。
- [ ] goals/overnight/selfdev/btw 都有真实状态和可恢复事件。
- [ ] workflow 状态全部 typed，不从文本推断。
- [ ] `cargo test -p lyra-agent-runtime -- --format terse`
- [ ] `npm --prefix apps/desktop run test -- src/modules/workbench/ai-panel/tests`
- [ ] 手工验收：权限面板、澄清面板、rollback、overnight review 在 UI 可用。
