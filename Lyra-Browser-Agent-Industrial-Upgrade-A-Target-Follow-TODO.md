# A 分轨：稳定目标标识与 Follow 审计压缩 TODO

## 目标

根治 `workbench_tab_id`、`lumen elementId`、frame id、视觉坐标之间不互通的问题，并把 Follow 模式升级为可审计、可压缩、可恢复的正式协议。

完成后：

- 模型永远不会被迫猜某个 id 能不能给某个工具用。
- Lumen map 返回的每个目标都有稳定 `targetRef`、作用域、frame 链、版本和失效原因。
- Follow 模式记录 `FollowSession`、`FollowAction`、`FollowFrame`，但模型上下文默认只注入 compact 后的语义动作。
- UI 显示、审计日志、模型上下文三者分层，不互相污染。

## 主拥有文件

- `apps/desktop/src/shared/workbench-browser.ts`
- `apps/desktop/src/main/workbench-browser/types.ts`
- `apps/desktop/src/main/workbench-browser/service.ts`
- `apps/desktop/src/main/agent/service.ts`
- `crates/lyra-agent-runtime/src/native_backend/context.rs`
- `crates/lyra-agent-runtime/src/native_backend/activity.rs`
- `crates/lyra-agent-runtime/src/tool_activity_service.rs`
- `crates/lyra-agent-runtime/src/follow_service.rs`

## A1. Target Identity Contract

- [ ] 定义 `LumenTargetRef` DTO：`targetRef`, `targetKind`, `tabId`, `frameRef`, `elementFingerprint`, `mapEpoch`, `expiresAt`, `staleReason`。
- [ ] 区分 `workbenchTabId`、`browserTabId`、`lumenTargetRef`、`lumenElementIndex`、`frameRef`，禁止字段复用。
- [ ] `lyra_lumen_map` 返回 `targets[]`，保留 `elements[]` 兼容但标注 numeric id 为 observation-local。
- [ ] `lyra_lumen_act/type/press/submit/reveal` 优先要求 `targetRef`，numeric `elementId` 仅作同一 observation 的短期兼容。
- [ ] stale target 返回结构化 `staleTarget`，包含 `reason`, `lastSeenAt`, `recommendedAction`, `nearestCandidates`。
- [ ] Agent service 中删除所有让模型“猜 id”的错误文案，改为明确字段协议和自动修复建议。

## A2. Target Registry

- [ ] 在主进程实现 per-tab `LumenTargetRegistry`，管理 targetRef -> resolved DOM/frame/AX/visual fallback。
- [ ] registry 支持 TTL、epoch、navigation invalidation、frame reload invalidation。
- [ ] registry 支持候选重绑定：同一 label/selector/AX node/bounds 变化后，能给出 confidence。
- [ ] registry 不保存敏感输入值，只保存定位和可访问性摘要。
- [ ] registry 暴露 `resolveTargetRef`, `explainTargetRef`, `listRecentTargets`。

## A3. FollowSession / FollowAction / FollowFrame

- [ ] 定义 `FollowSession`：`sessionId`, `turnId`, `tabId`, `targetMode`, `startedAt`, `endedAt`, `status`, `reason`。
- [ ] 定义 `FollowAction`：语义动作，例如 observe/read/click/type/wait/navigate/elevate/handoff。
- [ ] 定义 `FollowFrame`：可视轨迹帧，只进入审计/UI，不默认进入模型上下文。
- [ ] FollowFrame 按时间、位置变化、重要事件抽样，不记录每个动画 tick。
- [ ] 每个 browser operation 都必须追加 FollowAction，失败也要记录。
- [ ] FollowSession 结束条件接入 turn finish / cancel / fail / interrupted。

## A4. Compaction

- [ ] 实现 `compactFollowSession(sessionId)`，输出模型可读的短摘要。
- [ ] compact 输出包含关键动作、失败、等待、用户中断、升格、最终页面状态。
- [ ] 默认模型上下文只注入 compact FollowAction，不注入 FollowFrame。
- [ ] UI 和本地审计可以按需打开 FollowFrame 轨迹。
- [ ] 超长 FollowSession 自动分段，保留 chunk manifest。

## A5. Runtime / Tool Exposure

- [ ] 新增或完善 `lyra_lumen_follow_audit`，支持 `sessionId`, `tabId`, `turnId`, `maxActions`, `includeFrames=false`。
- [ ] 新增 `lyra_lumen_explain_target`，让 Agent 可解释某个 `targetRef` 是否仍可用。
- [ ] Tool activity 中将 `lumenTargetRef`、`followSessionId`、`followActionId` 写入结构化 activity。
- [ ] AI 面板从 structured activity 读 follow/action，不从工具 output 文本推断。

## A6. 测试

- [ ] 单测：tab id 不能作为 targetRef / elementId 被误接受。
- [ ] 单测：同一 observation numeric id 可用，跨 navigation 后 stale。
- [ ] 单测：targetRef 跨 map epoch 可重绑定或返回 stale reason。
- [ ] 单测：FollowAction 按事实时间线记录成功/失败。
- [ ] 单测：FollowFrame 不进入默认 model context。
- [ ] 集成测试：Agent 使用 `targetRef` 完成 hover -> reveal -> click 菜单。

## A7. 验收

- [ ] `npm --prefix apps/desktop run typecheck`
- [ ] `npm --prefix apps/desktop run test -- src/main/agent/tests`
- [ ] `npm --prefix apps/desktop run test -- src/main/workbench-browser/tests`
- [ ] `cargo test -p lyra-agent-runtime -- --format terse`
- [ ] 手工验收：Follow 开启后，Agent 操作轨迹持续可见，直到 turn 结束。
- [ ] 手工验收：模型不会再把 `browser-tab-xx` 当作 Lumen element 使用。
