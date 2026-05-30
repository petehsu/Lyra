# C - Turn Engine / Context / Multimodal 能力恢复 TODO

## 负责范围

本 TODO 负责恢复 Agent turn engine 的核心行为，覆盖：

- 图片输入进入 provider request
- 真 streaming 和 message delta
- cancel 中断阻塞 provider request
- soft interrupt / 用户中途改任务
- context overflow guard
- compaction / recovery / retry
- provider capability gate

不要处理文件工具细节、Lumen host handler、MCP/Skills 动态发现、workflow 服务业务逻辑。

## 当前问题证据

- `native_backend` provider request 使用 `"stream": false`。
- `build_model_request` 只把 `message.text` 转为 provider messages，image blocks 没有进入模型。
- cancel 只是写 `cancelled_turns`，不能中断正在阻塞的 `reqwest::blocking` provider call。
- `memory.trim.run` 和 `memory.recover.run` 当前基本是固定响应。

## 并行边界

本组主要触碰：

- `crates/lyra-agent-runtime/src/native_backend.rs`
- `crates/lyra-agent-runtime/src/turn_runner.rs`
- `crates/lyra-agent-runtime/src/context_builder.rs`
- `crates/lyra-agent-runtime/src/memory_service.rs`
- `crates/lyra-agent-runtime/src/recovery_service.rs`
- `crates/lyra-agent-kernel/src/lib.rs`
- `crates/lyra-agent-api/src/lib.rs`

与 A 的接口约定：

- A 负责工具 registry 和工具执行。
- C 负责 provider loop、消息流、工具结果进入下一轮 provider input。

## TODO

### C1：Provider request content block 正确构造

- [ ] 将 user message blocks 转为 provider 支持的 multimodal format。
- [ ] 文本、图片、tool result、artifact/evidence ref 都由 context builder 统一生成。
- [ ] 根据 model capability gate 决定是否发送 image input。
- [ ] 不支持 image 的模型必须返回结构化降级，不要静默丢图。
- [ ] 测试：带图片消息在 vision model 下包含 image block，在非 vision model 下被 gate。

### C2：真 streaming

- [ ] Provider request 支持 stream 模式。
- [ ] assistant token delta 发送 `messageDelta`。
- [ ] 工具调用 delta 能构造完整 tool call，再进入 tool dispatch。
- [ ] UI 能看到 assistant 文本和工具穿插，而不是结束后一次性补。
- [ ] 测试：模拟 streaming provider，断言 delta、toolStarted、toolFinished、messageCommitted 顺序。

### C3：可中断 cancel

- [ ] turn 有 cancellation token，并传入 provider request、tool execution、browser wait。
- [ ] cancel 能 abort 长 provider request 或让请求线程尽快停止。
- [ ] cancel 后不允许迟到 assistant message 覆盖 cancelled 状态。
- [ ] cancel 后 runtime turn 进入 interrupted/cancelled typed state。
- [ ] 测试：阻塞 provider 被 cancel 后不会 commit assistant message。

### C4：用户中途改任务 / soft interrupt

- [ ] running turn 收到新用户消息时，不简单把旧 turn 标 cancelled 后丢上下文。
- [ ] 支持 soft interrupt event，说明新用户 intent、是否跳过剩余工具、如何恢复。
- [ ] 工具执行间隙检查 urgent interrupt。
- [ ] 新用户意图必须进入最新 context，优先级高于旧 summary。
- [ ] 测试：旧任务进行中插入新任务，下一次 provider input 不漂回旧任务。

### C5：上下文预算和工具输出保护

- [ ] context builder 统计 system、history、memory、tools、tool results token 估算。
- [ ] 单个工具输出过大时裁剪并生成 artifact/evidence ref。
- [ ] 总上下文超限时触发 compaction 或结构化失败。
- [ ] provider context length error 可自动 compact/retry 一次。
- [ ] 测试：大工具输出不会造成 provider 400 context exceeded。

### C6：Compaction / trim / recover 真实化

- [ ] `agent.session.compact` 不再只返回固定文案。
- [ ] `agent.memory.trim.run` 执行真实 trim plan 或明确返回 skipped reason + metrics。
- [ ] `agent.memory.recover.run` 从 typed runtime state 恢复 interrupted/unknown turn。
- [ ] compaction 不能覆盖 Tail/Pinned/latest user intent。
- [ ] 测试：长会话 trim 后最新 intent、todo、clarification、tool evidence 仍在 projection。

### C7：Provider capability 和请求参数

- [ ] `supportsToolCalling=false` 时不发送 tools，返回能力不足或走无工具降级策略。
- [ ] `supportsImageInput=false` 时不发送 image block。
- [ ] `streaming=false` 时走 non-stream fallback，但 UI 状态仍一致。
- [ ] contextWindow 用 profile capability，不靠字符串猜。
- [ ] 测试：不同 capability profile 下 request body 正确。

## 验收

- [ ] 真实流式回复中，用户能看到文本 delta 和工具活动穿插。
- [ ] 图片附件能被 vision model 消费。
- [ ] cancel 能阻止迟到回复写入会话。
- [ ] 中途改任务不会把 Agent 拉回旧任务。
- [ ] 长工具输出和长会话不会直接撑爆上下文。
- [ ] `cargo test -p lyra-agent-runtime -- --format terse`
- [ ] `cargo test -p lyra-agent-kernel -- --format terse`
- [ ] `npm --prefix apps/desktop run test -- src/modules/workbench/ai-panel/tests`
