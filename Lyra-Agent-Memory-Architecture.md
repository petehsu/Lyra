# Lyra Agent 记忆架构

## 文档状态

本文档是面向当前 Lyra Agent 运行时的新记忆架构方案。

它不是 `记忆架构/06-Memory-Architecture.md` 的简单续写。旧文档作为设计输入保留其合理约束，但本文档针对现在 Lyra Agent 暴露出来的问题重新设计：

- 旧摘要覆盖最新用户意图
- 内部 runtime note 暴露到用户聊天界面
- 模型自行生成“会话已重置”这类结论
- 工具结果、server reload、recovery 状态被表示成普通文本
- 长会话丢失未完成承诺、Todo、证据和恢复锚点
- UI、模型上下文、审计日志、运行时状态混用同一条 message stream

目标是构建一个本地优先、可审计、可恢复、由 Rust runtime 拥有的 Agent 会话记忆系统。

## 核心原则

记忆不只是长期事实。

对 Lyra Agent 来说，记忆包含：

1. 持久化会话真相日志
2. RuntimeTurn 运行时状态机
3. 活跃任务、工具调用、恢复锚点
4. 模型上下文装配策略
5. shared / frozen 长期记忆层
6. 面向 UI 的安全投影

模型绝不能通过原始文本标记来推断运行时真相。运行时真相必须由 Lyra runtime 的结构化状态拥有。

## 架构目标

新记忆系统需要保证：

- 会话可以跨 reload、崩溃、压缩、长工具链继续恢复
- 最新用户意图永远高于旧摘要
- 内部事件不会泄漏成用户消息
- 工具失败和等待超时是结构化 runtime state，不是含糊聊天文本
- 模型上下文由结构化层装配，而不是直接重放 UI 时间线
- 被裁剪内容都有 lineage，可追溯、可恢复
- 桌面 UI 消费投影，真实状态保留在 `lyrad` / Rust crates

## 非目标

本文档不做以下事情：

- 只做一个聊天记录归档
- 把 Markdown 当 primary truth
- 允许 renderer 直接修改记忆数据库
- 通过关键词、正则、隐藏规则处理内部消息泄漏
- 第一阶段解决所有 swarm / multi-agent plan UI
- 要求用户逐条确认记忆写入

## 总体结构

```text
User Input
  -> RuntimeTurn
  -> Session Event Log
  -> Context Assembler
  -> Model Provider
  -> Tool Runtime
  -> RuntimeTurn State Update
  -> UI Projection
  -> Trim / Archive / Shared Memory Pipelines
```

同一份 truth 派生出四类产物：

```text
Truth Store       权威结构化数据
Model Context     被选择、净化后的模型输入
UI Projection     用户可见的时间线和状态
Audit Projection  本地可检查的证据和调试轨迹
```

任何一层都不能替代另一层。

## 存储根目录

Agent 记忆数据建议统一放在：

```text
~/.lyra/modules/agent-memory/
```

推荐目录结构：

```text
~/.lyra/modules/agent-memory/
  sessions/
    <session_id>/
      session.sqlite
      event_log.sqlite
      runtime.sqlite
      context.sqlite
      cuts/
        cut_pack_0001.sqlite
        cut_pack_0002.sqlite
      manifests/
        cuts.manifest.json
      projections/
        timeline.jsonl
        audit.jsonl
  shared/
    shared_truth.sqlite
    frozen_truth.sqlite
    conflict_sets.sqlite
    projections/
      shared_memory.md
      frozen_memory.md
      audit.jsonl
  artifacts/
    index.sqlite
    blobs/
    thumbnails/
  jobs/
    memory_jobs.sqlite
    recovery_jobs.sqlite
  metrics/
    memory_compaction.log
    context_assembly.log
```

旧的 `~/.lyra/modules/ai/` 可以通过迁移器导入，但新实现建议使用 Agent 专属 root，让契约更清晰。

## 所有权边界

记忆 runtime 由 Rust runtime 拥有。

桌面层职责：

- 渲染 UI projection
- 读取 session snapshot
- 订阅 runtime events
- 发起用户动作，例如删除会话、重试 turn、恢复 turn

桌面层禁止：

- 直接写记忆 SQLite 文件
- 从聊天文本推断内部状态
- 扫描任意 tool input/output 重建 runtime truth
- 用关键词、正则隐藏内部泄漏

Runtime 职责：

- 写结构化 session truth
- 拥有 RuntimeTurn 状态
- 装配模型上下文
- 发出 UI-safe events
- 执行 trim / archive / recovery jobs
- 迁移旧会话数据

## 核心实体

### Session

Session 是一个隔离的 Agent 对话与工作域。

必需字段：

```text
session_id
created_at_ms
created_at_iso
updated_at_ms
updated_at_iso
title
working_dir
provider_key
model
status
schema_version
```

状态：

```text
active
idle
running
awaiting_user
interrupted
recovering
failed
archived
deleted_by_user
```

会话删除必须是用户显式动作。Runtime 日常维护不得静默删除 session。

### RuntimeTurn

RuntimeTurn 是会话恢复主索引。

每条用户请求都会开始或恢复一个 RuntimeTurn。每次 provider call、tool call、browser action、clarification request、reload interruption、recovery attempt、completion audit 都必须绑定到 RuntimeTurn。

必需字段：

```text
runtime_turn_id
session_id
parent_runtime_turn_id
user_message_id
state
started_at_ms
updated_at_ms
completed_at_ms
failure_kind
failure_detail_ref
latest_user_intent_ref
active_task_ref
provider_request_ref
context_snapshot_ref
completion_audit_ref
```

状态：

```text
queued
assembling_context
calling_model
streaming_model
waiting_for_tool
waiting_for_user
recovering_after_reload
recovering_after_crash
interrupted
completed
failed_recoverable
failed_terminal
cancelled_by_user
```

硬规则：

模型不能决定一个 turn 是否 reset、interrupted、recoverable。这个判断必须来自 RuntimeTurn state。

### SessionEvent

SessionEvent 是 append-only 的会话真相流。

必需字段：

```text
event_id
session_id
runtime_turn_id
kind
role
payload_json
visibility
model_context_policy
ui_policy
created_at_ms
created_at_iso
lineage_json
```

事件类型：

```text
user_message
assistant_message_delta
assistant_message_final
tool_call
tool_result
tool_progress
runtime_event
recovery_event
compaction_boundary
context_snapshot
clarification_request
clarification_response
completion_audit
delivery_proof
artifact_record
```

角色：

```text
user
assistant
tool
runtime
system
```

`role` 本身不够。是否进入 UI、是否进入模型上下文，必须由 visibility 和 context policy 决定。

## 消息可见性契约

这是新架构最重要的契约。

每个事件都必须有显式 visibility：

```text
user_visible
model_context_only
audit_only
internal
debug_only
```

每个事件都必须有 model context policy：

```text
include
include_summarized
exclude
include_as_runtime_state
```

每个事件也必须有 UI policy：

```text
show_in_timeline
show_as_status
show_in_details_only
hide_from_user
```

硬规则：

1. 内部 recovery prompt 永远不能 `user_visible`。
2. server reload marker 永远不能成为 assistant message。
3. provider retry hint 永远不能显示为 user 或 assistant text。
4. tool wait timeout 是 typed tool result，不是 assistant conclusion。
5. system note 不能作为伪 user message 插入。
6. 用户真的输入了 `<system-reminder>` 这类文本时，仍然是普通 user message，因为可见性由结构字段决定，不由关键词决定。
7. UI 只能渲染 UI projection events，不能直接渲染 provider context。
8. 模型上下文只能由 Context Assembler 构建，不能重放可见 UI timeline。

## Runtime 内部事件

Runtime event 是一等数据。

示例：

```text
server_reloading
server_reloaded
provider_request_started
provider_request_failed
provider_request_retried
tool_started
tool_finished
tool_failed
tool_timed_out
browser_wait_partial
context_trim_started
context_trim_committed
turn_interrupted
turn_recovered
turn_failed
turn_completed
```

这些事件可以审计，也可以生成 UI status chip，但不能变成普通聊天消息。

## Reload 与崩溃恢复

reload / crash recovery 必须是确定性的。

reload 开始时：

1. Runtime 写入 `runtime_event: server_reloading`。
2. 活跃 RuntimeTurn 转为 `interrupted`。
3. partial assistant text 作为 partial event 保存；如果没有明确用户价值，`ui_policy=show_in_details_only`。
4. 不向 assistant message 追加任何文本 marker。

runtime 重启时：

1. Runtime 扫描 `interrupted` 或 `failed_recoverable` turns。
2. Recovery job 重建最后稳定 RuntimeTurn 状态。
3. Context Assembler 从结构化状态构建 recovery context。
4. 如果 tool pending，runtime 将其标记为 `unknown_after_recovery` 或 retryable，再进入模型上下文。
5. UI 收到 `turn_recovered` 或 `turn_needs_user` 状态，而不是 assistant prose。

模型只能在 runtime 生成合法 recovery context 后继续工作。

## Context Assembler

Context Assembler 是唯一允许构建模型输入的组件。

它消费：

- 最新用户消息
- 活跃 RuntimeTurn state
- 当前 session Tail
- pinned facts 与 unresolved commitments
- 被选择的 middle anchors
- 由策略选择的 shared / frozen memory
- tool schema 与 runtime capability
- project policy 与 security snapshot

它不消费：

- UI projection text
- internal debug messages
- raw renderer logs
- 没有 lineage 的任意旧 summary
- 伪装成 user message 的 system reminder

## 上下文层级

模型输入由显式层级组成：

```text
System Contract
Runtime State
Latest User Intent
Pinned
Tail
Middle Anchors
Head
Retrieved Archives
Shared/Frozen Memory
Tool Capability Snapshot
```

优先级：

1. System Contract
2. Runtime State
3. Latest User Intent
4. Pinned unresolved commitments
5. Tail
6. Tool capability snapshot
7. Middle anchors
8. Head
9. Retrieved archives
10. Shared / frozen memory

Latest User Intent 永远不能低于旧 summary。

## Pinned 层

Pinned 保存压缩后也必须保留的内容：

```text
pinned_facts
pinned_spans
unresolved_commitments
active_todos
active_tool_waits
active_browser_targets
active_follow_sessions
current_project_policy_refs
security_policy_refs
delivery_obligations
```

Pinned 由结构化状态选择，不能只靠语义相似度。

典型例子：

- 用户说“先讨论，不改代码”
- 用户中途改变任务方向
- Agent 承诺要运行验证
- tool 正在等待用户澄清
- 浏览器 Follow 模式处于开启状态
- RuntimeTurn 有 pending delivery proof

## Tail 层

Tail 保存最近真实对话与工具状态。

Tail 必须包含：

- 最新用户消息
- 最新 user-visible assistant message
- 最近 tool calls 与 typed results
- 最近 RuntimeTurn state transitions
- clarification answers
- 用户纠正

Tail 必须排除：

- internal recovery reminders
- provider debug chunks
- raw reload markers
- renderer console noise

## Middle Anchors

Middle anchors 保存旧上下文里的关键锚点，不重放全部历史。

候选锚点：

- 已完成决策
- 被编辑文件
- 已运行命令
- 被操作过的浏览器页面
- 带 delivery evidence 的工具结果
- 用户纠正
- 影响后续工作的失败尝试
- 活跃任务切换点

Middle anchors 必须能通过 lineage 追溯到 raw events。

## Head 层

Head 保存会话起点与初始约束，但预算随时间衰减。

Head 适合保存：

- 初始目标
- 原始项目路径
- 早期约束
- 用户工作流偏好

Head 不能压过 Tail 或 Pinned。

## 归档与裁剪

裁剪不是删除。

当 live context 超过预算：

1. Runtime 计算 trim target。
2. Context Assembler 选择 Head / Pinned / Middle / Tail。
3. 未被选择的 span 成为 cut candidates。
4. cut candidates 写入 raw + normalized archive payload。
5. 记录 lineage。
6. archive commit 后，才允许 compact live projection。

cut payload 必需字段：

```text
archive_id
session_id
source_event_start_id
source_event_end_id
content_raw
content_normalized
content_kind
token_count_raw
char_count_raw
raw_digest
normalized_digest
trim_batch_id
lineage_json
created_at_ms
created_at_iso
```

trim journal 状态：

```text
pending_trim
archived
live_compacted
manifest_committed
failed_recoverable
```

崩溃不变式：

live event 在 archive 或 dedupe reference commit 前，绝不能被 compact。

## Summary 策略

Summary 是 projection，不是 truth。

每条 summary 必须包含：

```text
summary_id
source_event_range
source_archive_refs
created_by
created_at_ms
confidence
known_omissions
latest_user_intent_at_creation
```

规则：

1. summary 不能替代 Tail。
2. summary 不能替代 Pinned。
3. summary 不能静默覆盖更新的用户消息。
4. `latest_user_intent_at_creation` 已过期的 summary 必须降权。
5. summary 的 source range 如果与活跃 RuntimeTurn 冲突，必须重新生成或忽略。

## 工具结果

工具结果必须是 typed data。

最小字段：

```text
tool_call_id
tool_name
status
started_at_ms
finished_at_ms
duration_ms
input_ref
output_ref
error_kind
error_message
retryable
partial
evidence_refs
```

状态：

```text
running
success
success_partial
failed_retryable
failed_terminal
timed_out_partial
cancelled
unknown_after_recovery
```

浏览器 `loadIdle` timeout 通常应该是 `timed_out_partial`，不是 terminal failure。模型收到的应该是 typed state 与建议下一步，例如 read / map / wait_for_text。

## 浏览器与 Follow 记忆

浏览器操作属于 session memory。

浏览器状态记录：

```text
browser_target_id
workbench_tab_id
lumen_target_id
url
title
active
follow_enabled
last_observation_ref
last_action_ref
```

Follow 高频流分层保存：

```text
FollowSession       持久身份与目标
FollowAction        语义动作，例如 click/type/hover/wait
FollowFrame         可选视觉帧或 cursor update
FollowSummary       压缩过程摘要
RollbackMarker      undo/recovery 边界
```

主上下文只需要 FollowSession、FollowAction、target refs、rollback markers。高频视觉帧默认属于 audit/projection 数据，只有明确需要时才进入模型上下文。

## 澄清与 Ask User

澄清是 tool-driven runtime state，不是自由 assistant text。

必需实体：

```text
ClarificationRequest
ClarificationOption
ClarificationResponse
BlockedOperation
```

规则：

1. clarification request 必须绑定 `runtime_turn_id`。
2. pending request 让 RuntimeTurn 保持 `waiting_for_user`。
3. UI 从结构化数据渲染澄清面板。
4. 用户响应后恢复同一个 RuntimeTurn，或启动 linked child turn。
5. 澄清面板渲染失败时，不自动变成 assistant 道歉；只有 runtime 判断需要 user-visible fallback 时才显示。

## Shared 与 Frozen Memory

Shared memory 保存跨会话的长期事实。

Frozen memory 保存稳定用户画像与高置信偏好。

二者都是结构化 truth store。Markdown 只是可读 projection。

shared/frozen candidate 状态：

```text
candidate
delayed_promotion
active
conflict_candidate
deprecated
rejected
```

升格信号：

- 用户显式纠正
- 重复稳定偏好
- 项目级规则
- 成功执行证据
- 跨会话语义一致

反信号：

- 矛盾
- 低置信
- 敏感身份字段
- 没有用户证据的推测
- stale session context

## 冲突记忆与负记忆

冲突是一等对象。

如果用户修正旧事实，旧事实与新事实不能被静默合并。

冲突记录：

```text
conflict_id
namespace
key
candidate_memory_ids
resolution_memory_id
status
created_at_ms
updated_at_ms
evidence_refs
```

负记忆记录系统不应重复的做法，例如：

- 不要用关键词隐藏解决结构问题
- 不要未验证就 claim completed
- 不要使用截图代理做工作区切换动画

负记忆只在相关且预算允许时注入。

## Provider 与模型上下文边界

Provider request 必须可复现。

每次 provider request 存储：

```text
provider_request_id
runtime_turn_id
provider_key
model
context_snapshot_ref
tool_schema_snapshot_ref
started_at_ms
finished_at_ms
status
error_ref
usage_json
```

精确模型上下文应当通过 snapshot 保存，或通过 immutable refs 可重建。

Provider error 不是 assistant message。它是 runtime / tool / provider event。

## UI Projection

UI Projection 从 truth store 派生。

Timeline items：

```text
UserBubble
AssistantBubble
ToolCard
StatusChip
ClarificationPanel
TodoPanel
BrowserActivityIndicator
ArtifactLink
CompletionStatus
```

Projection 规则：

1. UserBubble 只渲染真实用户消息。
2. AssistantBubble 只渲染 user-visible assistant final/delta content。
3. ToolCard 渲染结构化 tool calls/results。
4. StatusChip 渲染被允许展示的 runtime events。
5. Internal events 只能进入 debug/audit view。
6. UI 不解析任意 JSON 来推断 todos、provider labels、active browser state、reset state。

## Audit Projection

Audit projection 是本地可检查数据。

它可以包含：

- internal recovery events
- provider errors
- context assembly decisions
- trim decisions
- dropped/hidden event reason
- migration records

Audit projection 默认不能发送给模型。

## 安全与隐私

规则：

1. secret 明文不得写入 shared/frozen memory。
2. provider keys 和 tokens 只能通过 secure handle 引用。
3. browser snapshots 可能包含敏感数据，必须有 visibility scope。
4. 用户删除单会话时，应删除 session-local live data、cuts、runtime state、projections。
5. shared/frozen memory 不因单会话删除而删除，除非用户显式要求更大范围清理。
6. dynamic prompt cache 永远不是 primary truth。

## 迁移策略

旧 journal 与旧 session DB 通过一次性 importer 迁移。

迁移输入：

- old journal jsonl
- old session sqlite
- old compaction summary
- old tool history
- old todo state

迁移输出：

- Session
- SessionEvent stream
- 可恢复的 RuntimeTurn records
- 旧 compacted spans 的 archive refs
- UI projection

迁移规则：

1. 不试图从含糊文本完美重建真相。
2. 旧日志里的 internal markers 导入为 audit-only runtime events。
3. 旧 summaries 如果可能，导入为带 source lineage 的 summary projection。
4. 缺失 lineage 的 summary 置信度降低。
5. 旧的 user-visible text 保持可见，除非旧 metadata 能结构化证明它是 internal；不能靠关键词判断。

## Runtime API

建议 runtime API：

```text
agent.session.create
agent.session.read
agent.session.delete
agent.session.list
agent.turn.start
agent.turn.resume
agent.turn.cancel
agent.turn.retry
agent.memory.snapshot
agent.memory.audit
agent.memory.trim.run
agent.memory.recover.run
agent.memory.shared.search
agent.memory.shared.update
```

Snapshot response 应包含：

```text
session
runtime_turns
timeline_projection
active_todos
active_browser_targets
active_clarification
status
provider_label
model_label
```

Runtime events：

```text
sessionUpdated
turnStarted
turnStateChanged
toolUpdated
clarificationOpened
clarificationResolved
todoUpdated
browserTargetUpdated
contextTrimmed
turnRecovered
turnCompleted
turnFailed
```

## 分阶段实施

### Phase 0：契约锁定

- 定义 Rust DTO：SessionEvent、RuntimeTurn、visibility、UI policy、model context policy。
- 增加所有 event variants 的 serialization tests。
- 增加 internal event non-visibility invariant tests。

### Phase 1：RuntimeTurn 与 Visibility

- 引入 RuntimeTurn table。
- 停止把 reload interruption 表示成 assistant text。
- 停止把 internal reminder 注入成伪 user message。
- 将 reload / recovery / tool timeout 转为 typed runtime events。
- UI 消费 projection，不消费 raw event stream。

这一阶段直接解决“会话已重置”和内部 note 泄漏问题。

### Phase 2：Context Assembler

- 模型上下文只通过 Context Assembler 构建。
- 增加 Head / Pinned / Middle / Tail 选择。
- 最新用户意图作为最高优先级运行层保留。
- 降权 stale summary。
- 为 provider request 增加 context snapshot。

这一阶段直接解决任务漂移。

### Phase 3：Archive 与 Trim

- 实现 cut packs 与 trim journal。
- 归档 raw + normalized payloads。
- 增加 lineage 与 recovery checks。
- 增加 cooldown 与 hysteresis。

这一阶段解决长会话增长与压缩安全。

### Phase 4：Shared/Frozen Memory

- 实现 shared/frozen 结构化 truth stores。
- 增加 conflict sets。
- 增加 Markdown projections。
- 增加 delayed promotion 与 update audit。

这一阶段解决跨会话长期学习。

### Phase 5：Recovery 与 Migration

- 增加 recovery scanner。
- 增加旧会话 importer。
- 增加 crash recovery tests。
- 增加 UI debug/audit view 展示 recovery decision。

## 必需测试

### Visibility Tests

- internal recovery reminder 不 user-visible
- server reload marker 不 assistant-visible
- 用户字面输入 internal-looking tags 仍保持 user-visible
- audit-only events 不进入模型上下文

### RuntimeTurn Tests

- reload 将 active turn 转为 interrupted
- restart 能恢复 interrupted turn
- pending tool 转为 unknown_after_recovery 或 retryable
- terminal failure 由 runtime 生成，不由模型生成

### Context Tests

- 最新用户意图高于 stale summary
- Pinned unresolved commitment 在 trim 后保留
- Tail 包含最新 clarification response
- stale summary 被排除或降权

### Tool Tests

- browser loadIdle timeout 返回 timed_out_partial
- partial tool output 仍可操作
- 重复 tool failure 生成 typed blocker state

### Trim Tests

- archive commit 前 live event 不 compact
- pending_trim 阶段崩溃可 replay
- archive 后 live_compacted 前崩溃可继续完成
- cut lineage 可解析 source events

### UI Projection Tests

- UI timeline 不显示 internal messages
- status chip 可以显示 recovering，但不生成 assistant text
- tool card 只在 expanded view 显示结构化错误细节
- user-visible timeline 可从 projection 重建

### Migration Tests

- 旧 reload marker 导入为 audit-only runtime event
- 旧 summary 导入为低置信 summary projection
- 旧可见 assistant text 保持可见
- 缺失 lineage 的内容不成为 primary truth

## 成功标准

新架构成功的标志：

1. runtime reload 不可能产生用户可见的伪 assistant reset message。
2. stale summary 不可能在用户切换任务后把 Agent 拉回旧任务。
3. tool timeout 不会被推断为 session failure，除非 runtime 标记 terminal。
4. UI、audit、model context 可以有意不同，因为它们是不同 projection。
5. 每次 model provider request 都有可重建 context snapshot。
6. 每个 trimmed span 都有 archive lineage。
7. 每个 active turn 都可以由 runtime state 恢复、重试、取消或标记 terminal。
8. shared/frozen memory 可以更新和纠错，而不是改写匿名 Markdown 文本块。

## 最终方向

Lyra Agent memory 应当实现为 Agent Session Runtime subsystem，而不是聊天历史辅助工具。

根治方向是结构性的：

- typed RuntimeTurn state，而不是文本 marker
- structural visibility，而不是关键词隐藏
- layered Context Assembler，而不是 raw replay
- recoverable trim/archive，而不是破坏性摘要
- UI projections，而不是 UI 侧推断

这是 Lyra Agent 从脆弱聊天记录走向持久本地智能工作区所需要的记忆架构。
