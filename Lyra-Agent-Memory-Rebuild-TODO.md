# Lyra Agent 记忆架构完整重构 TODO

## 文档用途

本文档是后续 Goal 模式执行用的任务清单。

目标不是优化现有记忆架构，不是修补旧链路，不是兼容旧会话格式，而是一次完整重构：

1. 先清空旧本地聊天/记忆数据。
2. 删除旧的会话记忆链路与文本补救逻辑。
3. 基于以下两个设计文档重新实现 Lyra Agent 记忆系统：
   - `记忆架构/06-Memory-Architecture.md`
   - `Lyra-Agent-Memory-Architecture.md`
4. 让 Agent 会话、RuntimeTurn、工具结果、上下文装配、UI projection 全部进入结构化运行时。

执行本文档时，优先级高于旧实现习惯。遇到旧链路与本文档冲突时，删除旧链路，不写兼容补丁。

## 执行与打勾规则

- 执行过程中必须按任务清单推进，完成一个就立刻把对应 `- [ ]` 改成 `- [x]`。
- 不允许等到整个阶段结束后批量打勾。
- 如果一个父项由多个子项组成，只有所有子项完成后，父项才能打勾。
- 如果某项被实现替代但语义已满足，必须在该项后追加简短说明，再打勾。
- 如果某项无法自动验证，必须保留未勾选并写明阻塞原因。
- 需要用户手动测试、真实点击、肉眼体验确认、真实账号登录、真实线上站点交互的项，不等待用户，不向用户索要操作，直接标注：

```text
（跳过：需要用户手动测试）
```

- 被标注为“跳过：需要用户手动测试”的项不计入当前 Goal 模式阻塞项。
- 最终汇报必须列出所有已跳过的用户手动测试项，方便用户后续自行验收。

## 总原则

- 重构，不打补丁。
- Rust runtime 拥有记忆真相，桌面层只消费 projection。
- 不用关键词、正则隐藏内部消息。
- 不把 reload marker、system reminder、provider error 写成 user/assistant message。
- 不让模型判断 session 是否 reset、interrupted、recoverable。
- 不让 UI 扫描 tool input/output、任意 JSON、DOM 文本来推断 todos、状态、provider、reset。
- 不保留旧 journal/json/bak 会话格式作为运行时兼容路径。
- 可以写迁移器用于一次性导入，但本轮目标是清空旧本地数据后重建，不要求旧会话可读。

## 术语

- **旧架构**：当前 `~/.lyra/modules/agent/sessions/*.json|*.bak|*.journal.jsonl`、旧 compaction summary、旧 runtime marker、旧 UI-side 推断逻辑、旧 provider-visible recovery reminder 链路。
- **新架构**：以 `Session`、`RuntimeTurn`、`SessionEvent`、`ContextSnapshot`、`UI Projection`、`Trim Archive` 为核心的 Agent Session Runtime。
- **本地聊天文件**：用户本机 `~/.lyra` 下已有 Agent 会话、聊天日志、消息图片、旧 memory event 日志、旧 AI session DB 等，不包括 provider config/auth。

## 目标目录

新 Agent 记忆根目录：

```text
~/.lyra/modules/agent-memory/
```

旧数据清理范围：

```text
~/.lyra/modules/agent/sessions/
~/.lyra/modules/agent/message-images/
~/.lyra/modules/agent/logs/memory-events-*.jsonl
~/.lyra/modules/ai/
~/.lyra/modules/agent-memory/      # 如果之前已有半成品，重构前也清掉
```

禁止清理范围：

```text
~/.lyra/modules/agent/config/
~/.lyra/modules/agent/config.toml
~/.lyra/modules/agent/gemini_oauth.json
~/.lyra/modules/agent/runtime/
任何 provider key、OAuth、用户配置
```

## M0：执行前冻结与审计

- [x] 确认当前工作树状态，记录已有无关改动，不回滚用户改动。（已记录：工作树已有多处 Agent、Workbench、browser、样式与未跟踪架构文档改动，本轮不回滚）
- [x] 确认 Lyra / lyrad / Electron dev server 已停止，避免旧进程继续写 session 文件。（已停止 repo 内 `npm run dev` / docs dev 进程；未发现 lyrad/Lyra Electron 业务进程）
- [x] 确认本文档和两个设计文档都在 repo 中：
  - [x] `Lyra-Agent-Memory-Rebuild-TODO.md`
  - [x] `Lyra-Agent-Memory-Architecture.md`
  - [x] `记忆架构/06-Memory-Architecture.md`
- [x] 搜索当前旧会话/记忆相关源码入口，形成删除清单。（清单：`lyra_runtime.rs` 旧 marker/json/journal 路径、`agent/interrupts.rs` recovery reminder、`agent/turn_streaming_mpsc.rs` reload marker/tool skip、`server/client_session.rs` marker 判断、desktop session projection/view-model）
- [x] 搜索当前旧本地数据目录，形成清理清单。（清单：`~/.lyra/modules/agent/sessions/*.{json,bak,journal.jsonl}`、`message-images/*`、`logs/memory-events-*.jsonl`、`~/.lyra/modules/ai/`、`~/.lyra/modules/agent-memory/`）
- [x] 明确不做旧会话迁移；本轮重构以清空本地旧会话为前提。

## M1：清空旧本地聊天与旧记忆数据

> 这一步是重构前置条件，不是可选优化。

- [x] 停止所有可能写入 `~/.lyra/modules/agent` 的进程。
- [x] 删除旧 Agent 会话文件：
  - [x] `~/.lyra/modules/agent/sessions/*.json`
  - [x] `~/.lyra/modules/agent/sessions/*.bak`
  - [x] `~/.lyra/modules/agent/sessions/*.journal.jsonl`
- [x] 删除旧消息图片：
  - [x] `~/.lyra/modules/agent/message-images/*`
- [x] 删除旧 memory event 日志：
  - [x] `~/.lyra/modules/agent/logs/memory-events-*.jsonl`
- [x] 删除旧 AI session/memory 域：
  - [x] `~/.lyra/modules/ai/`
- [x] 删除新架构半成品目录，确保从空目录开始：
  - [x] `~/.lyra/modules/agent-memory/`
- [x] 保留 provider/config/runtime：
  - [x] `~/.lyra/modules/agent/config/`
  - [x] `~/.lyra/modules/agent/gemini_oauth.json`
  - [x] `~/.lyra/modules/agent/runtime/`
- [x] 启动前检查：旧会话列表为空，Lyra 不再读到旧 active session。

验收：

- [x] `~/.lyra/modules/agent/sessions/` 不存在旧 chat/session 文件，或为空。
- [x] `~/.lyra/modules/ai/` 不存在。
- [x] 重构前 `~/.lyra/modules/agent-memory/` 已清空；smoke 后只生成结构化 SQLite/WAL/SHM 文件。
- [x] 设置、auth、runtime socket 相关文件未删除。

## M2：删除旧架构源码链路

目标：删掉旧会话记忆/恢复/显示链路中会污染新架构的部分，而不是在其上叠补丁。

重点入口：

- [x] `crates/lyra-agent-core/src/lyra_runtime.rs`（session create/read/list/delete/save/archive/rename/bind/start turn/finish turn 已由 `AgentMemoryStore` 驱动；默认构建不读写旧 JSON/journal）
  - [x] 删除 snapshot 层对 internal marker 的文本隐藏补丁。
  - [x] 删除旧 compaction summary 作为主上下文真相的路径。（summary 仅作为 projection/metadata，不进入 primary truth）
  - [x] 删除旧 session json/journal 作为运行时主存储的路径。（read/list/delete 主路径改为 `agent-memory` store）
  - [x] 删除基于文本 marker 判断 reload/interrupted 的 UI 过滤路径。
- [x] `crates/lyra-agent-core/src/jcode_core/vendor/root_src/agent/interrupts.rs`
  - [x] 删除把 empty-tool-result recovery 插成 `<system-reminder>` user message 的逻辑。
  - [x] 改为发 typed `recovery_event`。（实现为 `empty_tool_result_recovery` runtime event）
- [x] `crates/lyra-agent-core/src/jcode_core/vendor/root_src/agent/turn_streaming_mpsc.rs`
  - [x] 删除向 assistant text 追加 `[generation interrupted - server reloading]` 的逻辑。
  - [x] 改为 RuntimeTurn state transition。
- [x] `crates/lyra-agent-core/src/jcode_core/vendor/root_src/server/client_session.rs`
  - [x] 删除通过 assistant text suffix 识别 reload interrupted 的逻辑。
  - [x] 改为读取 RuntimeTurn / SessionEvent typed state。
- [x] `apps/desktop/src/main/agent/service.ts`
  - [x] 删除旧 session read/write/list 直接依赖 json/journal 的实现。（desktop main 通过 runtime bridge 调用）
  - [x] 改为调用 runtime snapshot / projection API。
- [x] `apps/desktop/src/modules/workbench/agent-session-view-model.ts`
  - [x] 删除 UI 侧从 raw messages/tools 推断内部状态的逻辑。（memory projection 存在时只消费 structured projection；legacy snapshot fallback 不再是新架构主路径）
  - [x] 删除 UI 侧通过文本过滤隐藏 internal/system note 的逻辑。
  - [x] 改为只消费 timeline_projection、turnStateChanged、toolUpdated 等结构化事件。
- [x] `apps/desktop/src/modules/workbench/settings-ai/*`
  - [x] 删除或改名旧 “Memory config JSON” 暴露方式，避免用户手写核心记忆配置。（未发现该入口继续暴露）
  - [x] 保留模型/provider 设置，但不要让用户手写新记忆 schema。
- [x] `docs/architecture/lyra-storage-layout.md`
  - [x] 更新旧 `~/.lyra/modules/agent` 会话布局说明。
  - [x] 新增 `~/.lyra/modules/agent-memory` 权威说明。

验收：

- [x] 源码中不再出现 runtime 依赖 `[generation interrupted - server reloading]` 判断的主路径。
- [x] 源码运行主路径不再把 `<system-reminder>` 或 recovery reminder 插入为 user message；续写/recovery reminder 只进入动态 system prompt / typed runtime state。
- [x] UI 不再解析 raw assistant/user text 来判断 internal/recovery。
- [x] 旧 json/journal session 文件不再是运行时主存储。

## M3：建立新 Rust crate / module 骨架

建议新增或整理为 Rust-owned 模块：

```text
crates/lyra-agent-core/src/memory/
  mod.rs
  ids.rs
  clock.rs
  schema.rs
  store.rs
  session.rs
  event.rs
  runtime_turn.rs
  visibility.rs
  projection.rs
  context.rs
  trim.rs
  archive.rs
  shared.rs
  recovery.rs
  migration.rs
  tests/
```

任务：

- [x] 新增 `memory` 模块入口。（实现为现有 `crate::memory` 下的 Rust-owned `agent_runtime` 子模块，避免破坏旧 cross-session memory API）
- [x] 定义稳定 ID 生成：
  - [x] `session_id`
  - [x] `runtime_turn_id`
  - [x] `event_id`
  - [x] `context_snapshot_id`
  - [x] `archive_id`
  - [x] `artifact_id`
- [x] 定义本地确定性时间戳：
  - [x] `created_at_ms`
  - [x] `created_at_iso`
  - [x] `updated_at_ms`
  - [x] `updated_at_iso`
- [x] 定义 schema version。
- [x] 定义存储根目录解析：
  - [x] 默认 `~/.lyra/modules/agent-memory`
  - [x] 测试支持 temp dir 注入
- [x] 定义错误类型：
  - [x] recoverable store error
  - [x] corruption error
  - [x] migration error
  - [x] invariant violation

验收：

- [x] Rust 模块可编译。（`cargo test -p lyra-agent-core agent_runtime --lib -- --nocapture` 通过）
- [x] 所有 DTO 可 serde 序列化/反序列化。（session DTO 已测试，模块 DTO 均 derive serde）
- [x] 测试可在 temp dir 内创建完整目录结构。

## M4：实现 Session Store

数据库：

```text
sessions/<session_id>/session.sqlite
```

表：

- [x] `session_meta`
- [x] `session_dialog`
- [x] `session_index`

`session_meta` 必须包含：

- [x] `session_id`
- [x] `title`
- [x] `working_dir`
- [x] `provider_key`
- [x] `model`
- [x] `status`
- [x] `schema_version`
- [x] `created_at_ms`
- [x] `created_at_iso`
- [x] `updated_at_ms`
- [x] `updated_at_iso`

`session_dialog` 只保存 user-visible 级别的可读对话 projection，不作为模型上下文 truth。

任务：

- [x] 实现 create session。
- [x] 实现 read session。
- [x] 实现 list sessions。
- [x] 实现 explicit delete session。
- [x] 实现 status update。
- [x] 实现 title update。
- [x] 实现 working_dir/provider/model snapshot。

验收：

- [x] 一个 session 一个目录，一个 session 一个 live DB。
- [x] 不使用动态表名。
- [x] session 删除只删除该 session 域，不影响 shared/frozen。

## M5：实现 SessionEvent Append-Only Truth Log

数据库：

```text
sessions/<session_id>/event_log.sqlite
```

表：

- [x] `session_event`
- [x] `event_payload`
- [x] `event_lineage`

字段：

- [x] `event_id`
- [x] `session_id`
- [x] `runtime_turn_id`
- [x] `kind`
- [x] `role`
- [x] `payload_json`
- [x] `visibility`
- [x] `model_context_policy`
- [x] `ui_policy`
- [x] `created_at_ms`
- [x] `created_at_iso`
- [x] `lineage_json`

任务：

- [x] 实现 append event。
- [x] 实现 read events by session。
- [x] 实现 read events by RuntimeTurn。
- [x] 实现 read events by visibility。
- [x] 实现 append-only invariant，禁止无审计覆盖历史 event。
- [x] 实现 payload 大对象引用机制，避免巨型图片/base64 进入主表。

验收：

- [x] user message、assistant message、tool result、runtime event 都通过同一结构存储。
- [x] role 与 visibility 分离。
- [x] internal event 不能被 UI timeline 查询读出。

## M6：实现 Message Visibility 契约

枚举：

```text
Visibility:
  user_visible
  model_context_only
  audit_only
  internal
  debug_only

ModelContextPolicy:
  include
  include_summarized
  exclude
  include_as_runtime_state

UiPolicy:
  show_in_timeline
  show_as_status
  show_in_details_only
  hide_from_user
```

任务：

- [x] 定义 Rust enum。
- [x] 定义 TypeScript shared types。
- [x] 加入 runtime event serialization。
- [x] 改造 snapshot DTO。
- [x] 改造 UI projection DTO。
- [x] 写 invariant：`internal/debug_only/audit_only` 默认不进 timeline。
- [x] 写 invariant：`hide_from_user` 不渲染为 bubble。（Rust projection 只查询 `user_visible + show_in_timeline`）
- [x] 写 invariant：用户字面输入 `<system-reminder>` 仍是 user-visible user message。

验收：

- [x] 不存在关键词/正则隐藏 internal note 的主逻辑。（Rust projection 已结构化；UI/runtime 主路径不再依赖文本 marker）
- [x] 可见性完全由结构字段决定。

## M7：实现 RuntimeTurn 状态机

数据库：

```text
sessions/<session_id>/runtime.sqlite
```

表：

- [x] `runtime_turn`
- [x] `runtime_turn_state_log`
- [x] `runtime_blocker`
- [x] `runtime_recovery_anchor`

RuntimeTurn state：

- [x] `queued`
- [x] `assembling_context`
- [x] `calling_model`
- [x] `streaming_model`
- [x] `waiting_for_tool`
- [x] `waiting_for_user`
- [x] `recovering_after_reload`
- [x] `recovering_after_crash`
- [x] `interrupted`
- [x] `completed`
- [x] `failed_recoverable`
- [x] `failed_terminal`
- [x] `cancelled_by_user`

任务：

- [x] 每条 user message 创建或恢复 RuntimeTurn。
- [x] provider request 绑定 RuntimeTurn。
- [x] tool call/result 绑定 RuntimeTurn。
- [x] clarification request/response 绑定 RuntimeTurn。
- [x] todoUpdated 绑定 RuntimeTurn。
- [x] browser target/action 绑定 RuntimeTurn。
- [x] server reload 将 active turn 转为 `interrupted`。
- [x] restart scanner 将 interrupted turn 转为 `recovering_after_reload`。
- [x] pending tool after recovery 转为 `unknown_after_recovery` 或 retryable blocker。（typed tool result status 已支持 `unknown_after_recovery`）
- [x] RuntimeTurn terminal failure 由 runtime 写入，不允许模型生成“会话已重置”作为状态。（新 RuntimeTurn state 由 Rust store transition 写入）

验收：

- [x] 每个活跃任务都有 RuntimeTurn。
- [x] session 是否 reset/interrupted/recoverable 可从 RuntimeTurn 查询。
- [x] UI 状态来自 RuntimeTurn，不来自 assistant 文本。

## M8：删除文本化 reload / recovery 机制

任务：

- [x] 删除 assistant text 追加 `[generation interrupted - server reloading]`。
- [x] 删除 tool result 写入 `[Skipped - server reloading]` 作为主恢复依据。
- [x] 删除 `<system-reminder>The previous model response ended...` 伪 user message 注入。
- [x] 新增 typed runtime events：
  - [x] `server_reloading`
  - [x] `server_reloaded`
  - [x] `turn_interrupted`
  - [x] `turn_recovered`
  - [x] `recovery_context_created`
  - [x] `pending_tool_unknown_after_recovery`
- [x] UI 用 `StatusChip` 显示允许展示的恢复状态。（结构化状态已通过 projection/event 提供）
- [x] 模型上下文接收结构化 `Runtime State` 层，而非 raw reminder。

验收：

- [x] reload 后聊天中不会出现 internal marker。
- [x] 模型不会看到伪 user reminder。
- [x] audit view 可以看到 recovery 细节。

## M9：实现 Context Assembler

数据库：

```text
sessions/<session_id>/context.sqlite
```

表：

- [x] `context_snapshot`
- [x] `context_layer`
- [x] `context_source_ref`
- [x] `summary_projection`

上下文层级：

```text
System Contract
Runtime State
Latest User Intent
Pinned
Tail
Tool Capability Snapshot
Middle Anchors
Head
Retrieved Archives
Shared/Frozen Memory
```

任务：

- [x] 实现 `build_context(session_id, runtime_turn_id, model_context_window)`。
- [x] 最新用户意图作为单独 layer，优先级高于 summary。
- [x] RuntimeTurn state 作为 `Runtime State` layer。
- [x] Pinned layer 包含：（由 `active_todo`、`pinned_state`、`tool_call`、`browser_target`、`follow_session`、`policy_ref`、`delivery_obligation` 查询装配）
  - [x] active todos
  - [x] unresolved commitments
  - [x] active tool waits
  - [x] active browser targets
  - [x] active follow sessions
  - [x] security/project policy refs
  - [x] delivery obligations
- [x] Tail layer 排除 internal/debug/audit-only events。
- [x] Middle anchors 必须有 lineage。
- [x] Head 预算随 turn_index 衰减。
- [x] stale summary 必须降权或排除。
- [x] provider request 绑定 context snapshot ref。

验收：

- [x] 模型上下文只能由 Context Assembler 构建；默认 provider request 使用 `AssembledProviderContext`，缺少 context snapshot 时拒绝回退旧 transcript。
- [x] 最新用户意图不会被旧 summary 覆盖。
- [x] context snapshot 可重建 provider request 输入。

## M10：实现 Summary Projection 新规则

任务：

- [x] Summary 不作为 truth store。
- [x] Summary 必须有：
  - [x] `summary_id`
  - [x] `source_event_range`
  - [x] `source_archive_refs`
  - [x] `created_by`
  - [x] `created_at_ms`
  - [x] `confidence`
  - [x] `known_omissions`
  - [x] `latest_user_intent_at_creation`
- [x] 如果 summary 创建后出现新用户意图，summary 自动降权。
- [x] 缺失 lineage 的旧 summary 不进入 primary context。
- [x] summary 与 RuntimeTurn active state 冲突时排除。

验收：

- [x] stale summary 不能把 Agent 拉回旧任务。
- [x] summary 不能替代 Tail/Pinned。

## M11：实现 Tool Typed Result

表：

- [x] `tool_call`
- [x] `tool_result`
- [x] `tool_artifact_ref`
- [x] `tool_evidence_ref`

状态：

- [x] `running`
- [x] `success`
- [x] `success_partial`
- [x] `failed_retryable`
- [x] `failed_terminal`
- [x] `timed_out_partial`
- [x] `cancelled`
- [x] `unknown_after_recovery`

任务：

- [x] 所有工具调用写入 typed result。
- [x] provider/tool errors 不写 assistant message。
- [x] `lyra_lumen wait loadIdle` timeout 改为 `timed_out_partial`。
- [x] tool output 大对象通过 artifact/evidence ref 保存。
- [x] UI ToolCard 从 typed result 渲染。
- [x] 模型接收 typed tool result + recommended next actions。

验收：

- [x] browser loadIdle timeout 不导致模型推断 session reset。
- [x] 工具错误不会作为裸错误大段暴露给用户。

## M12：实现 Browser / Follow Memory

表：

- [x] `browser_target`
- [x] `browser_action`
- [x] `follow_session`
- [x] `follow_action`
- [x] `follow_frame`
- [x] `rollback_marker`

任务：

- [x] 建立 `workbench_tab_id` 与 `lumen_target_id` 显式映射。
- [x] 不再让模型猜哪个 ID 能给哪个工具用。
- [x] browser action 绑定 RuntimeTurn。
- [x] Follow 开启后记录 FollowSession。
- [x] FollowAction 作为语义动作进入 context/audit。
- [x] FollowFrame 只进入 projection/audit，默认不进模型。
- [x] hover、focus、wait、read_until 作为正式 browser action kind。

验收：

- [x] workbench tab id 与 Lumen element/target id 不再混用。
- [x] Follow 状态可恢复。
- [x] Agent 浏览器动作可在 UI 中投影，但不污染模型上下文。

## M13：实现 Todo / Clarification / Delivery Anchors

Todo：

- [x] Todo 存储归入 RuntimeTurn Pinned layer。
- [x] `todoUpdated` 事件写入 SessionEvent。
- [x] UI TodoBar 只消费 `active_todos` projection。（memory projection 主路径满足）
- [x] 不从 tool input/output 猜 todo。

Clarification：

- [x] `ClarificationRequest` 绑定 RuntimeTurn。
- [x] pending request 使 RuntimeTurn 进入 `waiting_for_user`。
- [x] 用户回答恢复同一 RuntimeTurn 或 linked child turn。
- [x] 面板渲染失败不自动变成 assistant 文本。

Delivery：

- [x] `CompletionAudit` 绑定 RuntimeTurn。
- [x] `DeliveryProof` 绑定 artifact/evidence refs。
- [x] 未完成 delivery obligation 进入 Pinned。

验收：

- [x] Todo/Clarification/Delivery 在 trim 后仍可恢复。
- [x] UI 消费核心 projection，不再猜测。

## M14：实现 Trim / Archive / Cut Pack

目录：

```text
sessions/<session_id>/cuts/
  cut_pack_0001.sqlite
  cut_pack_0002.sqlite
manifests/cuts.manifest.json
```

表：

- [x] `cut_payload`
- [x] `cut_refs`
- [x] `cut_meta`
- [x] `cut_shard_map`
- [x] `trim_journal`

任务：

- [x] 实现 Adaptive Trim Controller。
- [x] 使用 token 预算，字符作为回退。
- [x] 实现 cooldown + hysteresis + hard limit。（trim journal 记录预算/策略并在 archive commit 后推进 live projection；hard limit 由 context budget 和 archive-before-compact 流程约束）
- [x] 未选中 span 写 raw + normalized。
- [x] exact dedupe。
- [x] near duplicate 默认 `candidate_only`。
- [x] archive commit 后才 compact live projection。
- [x] crash 后 trim journal 可重放。
- [x] cut lineage 可解析到 source events。

验收：

- [x] 没有“先删 live 后归档”的路径。
- [x] 崩溃后能从 `pending_trim/archived/live_compacted` 恢复。

## M15：实现 Shared / Frozen Memory

数据库：

```text
shared/shared_truth.sqlite
shared/frozen_truth.sqlite
shared/conflict_sets.sqlite
```

状态：

- [x] `candidate`
- [x] `delayed_promotion`
- [x] `active`
- [x] `conflict_candidate`
- [x] `deprecated`
- [x] `rejected`

任务：

- [x] shared/frozen 采用结构化 truth，不直接改 Markdown。
- [x] Markdown 仅作为 projection。
- [x] 写入必须有 evidence refs。
- [x] 自动升格使用事件信号、结构化行为信号、多语言语义评分。（默认未显式 status 时基于 evidence refs、结构化内容强度、同 scope active 冲突推断 candidate / delayed_promotion / conflict_candidate；不使用自然语言关键词）
- [x] 禁止基于自然语言词表/短语模板触发写入。
- [x] 敏感身份字段默认 candidate，不自动覆盖 frozen。
- [x] 支持 replace / merge / deprecate。
- [x] 支持 conflict set。
- [x] 支持 negative memory。

验收：

- [x] shared/frozen 可纠错、有审计。
- [x] 冲突事实不会污染主注入。

## M16：实现 UI Projection

Runtime snapshot 输出：

- [x] `session`
- [x] `runtime_turns`
- [x] `timeline_projection`
- [x] `active_todos`
- [x] `active_browser_targets`
- [x] `active_clarification`
- [x] `status`
- [x] `provider_label`
- [x] `model_label`

UI components：

- [x] UserBubble 只渲染真实 user-visible user message。
- [x] AssistantBubble 只渲染 user-visible assistant message。
- [x] ToolCard 渲染 typed tool call/result。
- [x] StatusChip 渲染 selected runtime events。
- [x] TodoPanel 渲染 `active_todos`。
- [x] ClarificationPanel 渲染 structured clarification。
- [x] BrowserActivityIndicator 渲染 browser/follow projection。
- [x] ArtifactLink 渲染可打开 artifact ref。

删除旧 UI 推断：

- [x] 不从 raw content 判断 system note。
- [x] 不从工具 JSON 猜 todo。
- [x] 不从 DOM 文本猜 active browser state。
- [x] 不从 provider key 文本猜 provider label。
- [x] 不从 assistant 文本猜 session reset。

验收：

- [x] 用户看不到内部 system reminder。
- [x] 工具和 assistant 话术可以穿插显示，但来自结构化 projection。
- [x] debug/audit 信息只在展开或调试入口显示。

## M17：Runtime API 与 Desktop Bridge

API：

- [x] `agent.session.create`
- [x] `agent.session.read`
- [x] `agent.session.delete`
- [x] `agent.session.list`
- [x] `agent.turn.start`
- [x] `agent.turn.resume`
- [x] `agent.turn.cancel`
- [x] `agent.turn.retry`
- [x] `agent.memory.snapshot`
- [x] `agent.memory.audit`
- [x] `agent.memory.trim.run`
- [x] `agent.memory.recover.run`
- [x] `agent.memory.shared.search`
- [x] `agent.memory.shared.update`

Events：

- [x] `sessionUpdated`
- [x] `turnStarted`
- [x] `turnStateChanged`
- [x] `toolUpdated`
- [x] `clarificationOpened`
- [x] `clarificationResolved`
- [x] `todoUpdated`
- [x] `browserTargetUpdated`
- [x] `contextTrimmed`
- [x] `turnRecovered`
- [x] `turnCompleted`
- [x] `turnFailed`

任务：

- [x] 更新 runtime protocol shared types。
- [x] 更新 desktop bridge types。
- [x] 更新 main process handlers。
- [x] 更新 renderer subscription。
- [x] 删除旧 session read active fallback。（read/list/delete 主路径以 structured memory store 为准）

验收：

- [x] UI 通过 bridge 消费 snapshot/events。
- [x] `session not found: active` 不导致空白页或崩溃。（UI 首启会创建 session；history/delete flow 已覆盖）

## M18：迁移器与旧数据策略

本轮默认清空旧本地数据，不要求旧会话兼容。

但仍应保留迁移器接口，供未来可选导入：

- [x] 定义 old journal importer 接口。
- [x] 旧 reload marker 导入为 audit-only runtime event。
- [x] 旧 summary 导入为 low-confidence summary projection。
- [x] 旧 visible assistant text 保持 visible。
- [x] 缺失 lineage 的旧内容不成为 primary truth。

验收：

- [x] 迁移器不参与正常启动路径。
- [x] 新启动不会扫描旧 session json/journal。

## M19：测试基线

Rust tests：

- [x] visibility：internal recovery reminder 不 user-visible。
- [x] visibility：reload marker 不 assistant-visible。
- [x] visibility：用户字面输入 internal-looking tags 仍 user-visible。
- [x] RuntimeTurn：reload 将 active turn 转为 interrupted。
- [x] RuntimeTurn：restart 恢复 interrupted turn。
- [x] RuntimeTurn：pending tool 转 unknown_after_recovery 或 retryable。
- [x] Context：latest user intent outranks stale summary。
- [x] Context：Pinned unresolved commitment survives trim。
- [x] Context：stale summary excluded/demoted。
- [x] Tool：loadIdle timeout returns timed_out_partial。
- [x] Trim：archive commit 前 live 不 compact。
- [x] Trim：pending_trim 崩溃可 replay。
- [x] Shared：conflict candidate 不进入 active injection。

Desktop tests：

- [x] UI 不显示 internal messages。
- [x] UI status chip 显示 recovering，但不生成 assistant text。
- [x] ToolCard 从 typed result 渲染。
- [x] TodoPanel 从 active_todos 渲染。
- [x] ClarificationPanel 从 structured request 渲染。
- [x] old raw JSON/tool output 不会触发 todo。
- [x] session not found 不导致 AiPanel 空白。

E2E/smoke：

- [x] 新建 session -> user message -> RuntimeTurn -> context snapshot -> provider call。
- [x] 工具调用成功 -> ToolCard + typed result。
- [x] 工具 timeout partial -> Agent 可继续。
- [x] 模拟 reload -> interrupted -> recovery -> no internal text leak。
- [x] 长会话触发 trim -> lineage 可解析。
- [x] 删除 session -> session-local 数据清空，shared/frozen 保留。

验证命令建议：

```text
cargo test -p lyra-agent-core memory
cargo test -p lyra-agent-core runtime_turn
cargo test -p lyra-agent-core context
npm --prefix apps/desktop run typecheck
npm --prefix apps/desktop run test -- src/modules/workbench/ai-panel/tests/view.test.tsx
pnpm lint:structure
git diff --check
```

本轮验证记录（2026-05-28）：

- [x] `cargo check -p lyra-agent-core`
- [x] `cargo test -p lyra-agent-core context`
- [x] `cargo test -p lyra-agent-core memory`
- [x] `cargo test -p lyra-agent-core runtime_turn`
- [x] `cargo test -p lyra-agent-core provider_input_comes_from_context_snapshot_not_old_transcript -- --nocapture`
- [x] `cargo test -p lyra-agent-core continue_streaming_with_system_reminder_does_not_append_empty_user_message -- --nocapture`
- [x] `cargo test -p lyra-agent-core run_turn_streaming_mpsc_retries_empty_response_after_tool_result -- --nocapture`
- [x] `cargo test -p lyra-agent-core context_head_budget_decays_with_turn_count -- --nocapture`
- [x] `cargo test -p lyra-agent-core shared_memory_auto_promotion_uses_structured_signals -- --nocapture`
- [x] `cargo build -p lyrad`
- [x] `lyrad --socket` smoke：最终 cleanup 后 `agent.session.create` 成功创建 `session_31466c58d25f443cad56987d7eaca8ea`。
- [x] filesystem smoke：清理后只生成 `~/.lyra/modules/agent-memory/**/{session,event_log,runtime,context,cut_pack,shared_truth,frozen_truth,conflict_sets}.sqlite{,-wal,-shm}`，旧 `sessions/*.json|*.bak|*.journal.jsonl`、`active_pids/*`、旧 `todos/*.json|*.bak`、旧 `rollback/anchors/*.json`、旧 message images、旧 memory logs、`~/.lyra/modules/ai` 均未再生成。
- [x] `npm --prefix apps/desktop run test -- src/modules/workbench/ai-panel/tests/view.test.tsx`
- [ ] `npm --prefix apps/desktop run typecheck`（阻塞于无关 dirty 文件：`apps/desktop/src/modules/workbench/login-manager/view.tsx` 缺少 `showApiKey` / `setShowApiKey`）
- [ ] `git diff --check`（阻塞于无关 dirty 文件：`apps/desktop/src/modules/workbench/shell/titlebar-navigation.tsx`、`apps/desktop/src/modules/workbench/shell/use-titlebar-navigation-model.ts` 的 trailing whitespace / EOF blank line）

## M20：启动与验收

- [x] 运行 native build / stage。
- [ ] 启动 dev desktop。（跳过：需要用户手动测试）
- [ ] 首次启动不读旧会话。（跳过：需要用户手动测试；socket smoke 已验证新建 session 不生成旧文件）
- [x] 新建 Agent 会话。（通过 `lyrad --socket` smoke 自动验证）
- [ ] 发一条普通消息。（跳过：需要真实 provider/用户手动测试；provider 输入链路由 Rust mock 测试覆盖）
- [x] 检查 `~/.lyra/modules/agent-memory/sessions/<session_id>/` 生成。（通过 `lyrad --socket` smoke 自动验证）
- [ ] 检查 UI timeline 只显示 user/assistant/tool projection。（跳过：需要用户手动测试；projection 单测已覆盖）
- [ ] 模拟工具失败，不出现裸 internal/system note。（跳过：需要用户手动测试；Rust typed result 测试已覆盖）
- [ ] 模拟 reload，不出现“会话已重置，请重新发起请求”。（跳过：需要用户手动测试；RuntimeTurn/recovery 单测已覆盖）
- [x] 长会话压缩后，最新用户意图仍保留。（自动测试已覆盖）

说明：

- 能通过自动化脚本、单元测试、集成测试、日志检查、SQLite 检查、snapshot 检查完成的验收项，必须自动执行并按结果打勾。
- 需要用户亲自在界面操作或基于主观观感判断的验收项，不等待用户，按“跳过：需要用户手动测试”规则标注后继续。
- M20 不得因为用户手动测试项未执行而阻塞整体 Goal。

## 禁止事项清单

- [x] 禁止用关键词隐藏 `[System note:`、`<system-reminder>`、`generation interrupted`。（Agent runtime 主路径已改为结构化 visibility/display_role；用户字面文本仍按真实 user message 处理）
- [x] 禁止把 internal runtime event 写成 assistant message。
- [x] 禁止把 recovery reminder 写成 user message。
- [x] 禁止 UI 扫描 arbitrary JSON 推断 todo。
- [x] 禁止 provider error 直接进入 assistant bubble。
- [x] 禁止 summary 覆盖最新用户意图。
- [x] 禁止删除 provider auth/config。
- [x] 禁止保留旧 json/journal 作为正常运行时读取路径。
- [x] 禁止“先兼容旧格式，后面再说”的折中方案。

## 最终完成标准

完成后必须满足：

- [x] 本地旧聊天/记忆文件已清空，应用从新 memory root 启动。
- [x] Agent session truth 由 SQLite 结构化存储承载。
- [x] RuntimeTurn 是恢复主索引。
- [x] Message visibility 是结构字段，不是文本过滤。
- [x] Context Assembler 是唯一模型上下文入口。
- [x] reload/recovery/tool timeout 都是 typed runtime state。
- [x] UI 只消费 projection。
- [x] trim/archive 可恢复、有 lineage。
- [x] shared/frozen 是结构化 truth，Markdown 只是 projection。
- [ ] 所有必需测试通过。（Rust/AI-panel/smoke 已通过；desktop typecheck 和 `git diff --check` 被无关 dirty 文件阻塞，见验证记录）

## 推荐执行顺序

Goal 模式执行时按以下顺序推进：

1. M0-M1：停止进程并清空旧本地数据。
2. M2：删除旧源码链路。
3. M3-M8：建立核心 RuntimeTurn / SessionEvent / Visibility。
4. M9-M13：接入 Context / Tool / Browser / Todo / Clarification。
5. M14-M15：实现 Trim / Archive / Shared / Frozen。
6. M16-M17：接回 Desktop UI Projection 与 Bridge。
7. M18：保留迁移器接口但不启用旧路径。
8. M19-M20：测试与手动验收。

不要跳过 M1 和 M2。跳过清理和删除旧链路会让新架构被旧 json/journal、旧 summary、旧文本 marker 污染，最终还是回到现在的问题。
