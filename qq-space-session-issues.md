# QQ 空间会话问题调查报告

调查对象：本地会话 `session-cbddefc4-9655-4da0-9b10-54c8941bd28b`（标题「帮我定位到QQ」）

调查时间：2026-06-21

数据来源：`~/.lyra/modules/agent/agent-runtime/sessions/session-cbddefc4-.../session.sqlite`、`.ledger/events.jsonl`、artifact 目录、`state.json`

---

## 已修复（仅摘要，正文不展开）

| 类别 | 修复要点 |
|------|----------|
| 文件选择器误报 | `dormant_file_input` / `active_file_chooser`；CDP `Page.fileChooserOpened`；`browserBlocked` |
| `find`/`locate` 参数 | host 侧 `query ?? text` |
| 工具结果回显 / 误完成 | 结构性 JSON 泄漏检测；page-cite 锚点无 browser 工具时拒绝完成 |
| 超时不等于失败（基础） | `uncertain` + 8k map/see 预算 + `verification: fast` + `verifyAgentActionOutcome` |
| Page-cite URL | `canonicalizeBrowserCitationUrls` |
| 空响应 / 上下文过重（P0） | `retention_policy` 动态触发 + 交替裁剪 + cut_pack 归档；空响应 / context length 重试前 compact（无 LLM 摘要） |
| Feed 级 post-action 验证 | `buildObservationDiff` 跨观察周期结构 diff；`verifyAgentActionOutcome` 自动对比 cache |
| 分段 map | 默认 `mapScope: viewport`；视口外元素计入 `hiddenBelowCount` |
| 幽灵 turn / 重试 | `agent.turn.retry` 复用 `userMessageId`，不新建用户消息；`retrying_provider` 状态 |
| 结构化失败码 | Runtime `classify_turn_failure` → `turnFailed.failureKind`；UI 按 code 映射，无字符串 needle |
| 会话韧性（问题四） | `session_resilience`：中断释放 Follow、blockedBrowser 闸门、milestone、连续失败恢复；UI `retryTurn` |

---

## 会话概览（历史快照）

| 项 | 值 |
|---|---|
| Runtime turn 数 | 12（末 6 个连续 `failed_recoverable`） |
| 工具调用 | 49 次 |
| 子任务 | 发说说 ✅（用户确认）；评论 ❌；换模型重试 ❌ |

---

## 仍待观察（非阻塞）

- 长页 scroll 超时：已有 viewport map + scrollHints；极端 SPA 仍可能需要用户手动滚到目标 + page-cite
- milestone 与 todo 的 UI 展示（runtime 已写入 `taskMilestones` / pinned context）

---

## 附录：关键文件路径

| 用途 | 路径 |
|------|------|
| 观察 diff 验证 | `apps/desktop/src/main/workbench-browser/view-manager-runtime/agent-action-verification.ts` |
| 视口 map | `apps/desktop/src/main/workbench-browser/view-manager-runtime/agent-observation-engine.ts` |
| Turn 重试 | `crates/lyra-agent-runtime/src/native_backend/turns.rs` (`retry_turn`) |
| 失败码分类 | `crates/lyra-agent-runtime/src/native_backend/tool_protocol.rs` |
| 空响应 UI | `apps/desktop/src/modules/workbench/ai-panel/lyra-agents/core/turn-failure-message.ts` |
| 上下文 / 裁剪策略 | `crates/lyra-agent-runtime/src/retention_policy.rs` |