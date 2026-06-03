# Lyra Terminal Conversation Memory

## 文档状态

本文档定义 Lyra Agent-native Terminal 的会话存储和记忆架构。

核心想法是：终端可以被理解为一个会话参与者。用户和 Agent 向终端发送输入，终端和终端内进程向用户与 Agent 发送输出。这个抽象可以让终端具备类似 Agent 会话的长期 truth store、UI projection、model context projection 和 audit projection。

但这不是把终端输出塞进 Agent 聊天上下文。终端有独立的存储、索引、权限记录和审计记录。Agent 只通过预算内投影、artifact 路径、cursor 和搜索读取它。

目标：

- 每一条命令、输入、输出、屏幕变化、进程退出都有精确记录。
- 每条记录能追踪到具体 terminal session、Agent session、RuntimeTurn、tool call、UI pane、人类输入或 Agent 输入。
- 长输出绝不因为模型上下文而丢失。
- 所有记录可搜索、可回放、可调查、可审计。
- Terminal Memory 和 Agent Memory 使用相同架构原则，但独立存储。

## 核心结论

这个设计非常有意义。

终端本身就是一个高价值任务环境。大量开发事实都发生在终端里：

- 项目如何启动
- 哪个端口被占用
- 哪个测试失败
- 哪条命令修复了问题
- 哪个 Agent 做了什么
- 哪个用户授权了什么
- 哪个命令产生了危险输出
- 哪个错误在什么时候第一次出现

如果终端只保留 UI scrollback，这些事实很快丢失。如果把它塞进模型上下文，会撑爆上下文并污染聊天。如果把它做成独立 memory，就能同时做到完整保留和按需理解。

## 和 Agent Memory 的关系

现有 Agent Memory 架构强调：

```text
Truth Store
Model Context
UI Projection
Audit Projection
```

Terminal Conversation Memory 采用同样原则：

```text
Terminal Truth Store       终端完整事实
Terminal Model Context     给 Agent 的预算内终端投影
Terminal UI Projection     给用户看的终端消息流和时间线
Terminal Audit Projection  本地可调查的证据链
```

硬规则：

1. Terminal Truth Store 独立于 Agent chat messages。
2. Terminal output 不直接进入 Agent 对话上下文。
3. UI 可以把终端渲染成“消息流”，但这只是 projection。
4. Agent context assembler 只能读取预算内 projection 或 artifact 摘要。
5. Audit projection 可以包含完整细节，但默认不发送给模型。

## 终端作为会话参与者

抽象模型：

```text
User  -> Terminal: 输入命令、按键、粘贴
Agent -> Terminal: 请求运行命令、输入文本、操作 TUI、发送信号
Terminal -> User: 显示输出、屏幕变化、状态
Terminal -> Agent: 输出事件、屏幕快照、命令状态、等待结果
Terminal -> Audit: 谁做了什么、何时做、授权是什么、结果是什么
Terminal -> Memory: 可复用项目事实、命令模式、失败模式
```

这个模型的好处：

- 人和 Agent 的行为用同一套事件表示。
- 输出和输入是双向消息，但底层是结构化事件。
- 终端可以像一个有记忆的参与者一样被查询。
- 每个行为都能追踪 actor、session、turn、tool、permission。

## 核心原则

### 1. 终端消息不是聊天消息

终端消息是 terminal memory event，不是 `AgentMessage`。

它可以被投影成 UI message，但不能直接混入 Agent 聊天 truth。

错误做法：

```text
assistant message:
  [terminal output] npm test failed...
```

正确做法：

```text
terminal_event:
  actor=process
  kind=output_chunk
  artifactRef=terminal-output-123
  commandId=cmd-9
  terminalSessionId=term-1
```

### 2. 完整事实永不按模型上下文截断

Truth Store 不为模型上下文让路。

可截断的是投影：

- UI projection 可以折叠。
- Model projection 可以摘要。
- Tool output 可以返回 `truncated: true`。
- Audit view 可以分页。

但 truth store、cache artifact、event journal 不能因为上下文不够而丢失事实。

### 3. 每条记录必须有可追踪身份

任何输入和输出都必须能回答：

- 属于哪个 terminal session？
- 属于哪个 Agent session？
- 属于哪个 RuntimeTurn？
- 属于哪个 tool call？
- 是用户做的还是 Agent 做的？
- 通过哪个 UI pane 或 private terminal 做的？
- 发生在什么时间？
- 关联哪个 commandId？
- 触发了哪个 permission？
- 输出范围是什么？
- 是否进入了模型上下文？

### 4. Actor 精确区分

终端事件必须区分 actor：

```text
human_user       人类用户输入
agent            Lyra Agent 输入或操作
subagent         终端内 Agent 输入或操作
terminal_kernel  Terminal Kernel 生成状态
process          PTY 内进程输出
system           OS 或 Lyra 系统事件
permission       权限系统事件
```

### 5. UI 和调查是 projection

用户看到的聊天式终端时间线是 UI projection。

调查视图是 audit projection。

Agent 看到的是 model projection。

三者可以不同，但都必须能追溯到同一组 truth events。

## 存储根目录

推荐路径：

```text
~/.lyra/modules/terminal-memory/
```

目录结构：

```text
~/.lyra/modules/terminal-memory/
  sessions/
    <terminal_session_id>/
      terminal.sqlite
      events.sqlite
      conversation.sqlite
      commands.sqlite
      permissions.sqlite
      screen.sqlite
      projections/
        ui_timeline.jsonl
        model_context.jsonl
        audit.jsonl
      outputs/
        command-<command_id>.txt
        command-<command_id>.ansi
        command-<command_id>.jsonl
      artifacts/
        output-<artifact_id>.summary.json
        output-<artifact_id>.index.sqlite
      snapshots/
        screen-<screen_version>.json
      attachments/
        agent-attachments.jsonl
  indexes/
    global-command-index.sqlite
    global-output-search.sqlite
    agent-terminal-links.sqlite
  retention/
    retention-policy.json
  metrics/
    terminal-memory.log
```

`terminal-memory` 可以和 `terminal-kernel` 合并实现，但概念上要分清：

- Terminal Kernel 负责执行和实时状态。
- Terminal Memory 负责持久化、索引、回放、调查和投影。

### 当前 v1 文件投影

第一刀实现先落在 Desktop main 侧的 `storageRoot/terminal-memory/sessions/<terminal_session_id>/`，不引入 SQLite，使用 JSONL 和纯文本 artifact 保持 append-only、可搜索、可审计：

```text
events.jsonl
summary.json
commands.jsonl
outputs/session-output.txt
outputs/session-output.raw
outputs/session-output.lines.jsonl
outputs/session-output.errors.jsonl
```

其中 `session-output.txt` 是去 ANSI 后的完整文本输出，`session-output.raw` 是原始 PTY 数据，`session-output.lines.jsonl` 提供行号与 byte offset 索引，`session-output.errors.jsonl` 提供错误行索引，`summary.json` 提供 Agent/UI 可快速展示的 token、byte、line、error 和 event 概况。

## 核心实体

### TerminalSession

终端会话是一个可持久追踪的执行空间。

```ts
type TerminalSessionRecord = {
  terminalSessionId: string;
  title: string;
  createdAtIso: string;
  createdAtMs: number;
  updatedAtIso: string;
  updatedAtMs: number;
  workingDir: string | null;
  shell: string | null;
  mode: "shell" | "command" | "agent" | "ssh" | "custom";
  visibility: "ui" | "private" | "background";
  ownerKind: "human_user" | "agent" | "shared" | "system";
  ownerAgentSessionId?: string | null;
  ownerRuntimeTurnId?: string | null;
  uiWindowId?: string | null;
  terminalTabId?: string | null;
  paneId?: string | null;
  rows: number;
  cols: number;
  running: boolean;
  exitCode: number | null;
  signal: string | null;
  schemaVersion: number;
};
```

### TerminalConversationEvent

所有输入、输出、状态和审计都落成事件。

```ts
type TerminalConversationEvent = {
  eventId: string;
  terminalSessionId: string;
  seq: number;
  kind: TerminalConversationEventKind;
  actor: TerminalActor;
  payload: unknown;
  createdAtIso: string;
  createdAtMs: number;
  monotonicMs: number;
  correlation: TerminalCorrelation;
  visibility: TerminalEventVisibility;
  modelContextPolicy: TerminalModelContextPolicy;
  uiPolicy: TerminalUiPolicy;
  auditPolicy: TerminalAuditPolicy;
  lineage: TerminalEventLineage;
};
```

事件类型：

```ts
type TerminalConversationEventKind =
  | "session_created"
  | "session_attached"
  | "session_detached"
  | "session_closed"
  | "input_text"
  | "input_keys"
  | "input_bytes"
  | "input_signal"
  | "input_resize"
  | "output_chunk"
  | "output_cached"
  | "screen_snapshot"
  | "screen_diff"
  | "command_started"
  | "command_finished"
  | "command_interrupted"
  | "command_failed"
  | "process_started"
  | "process_exited"
  | "permission_requested"
  | "permission_granted"
  | "permission_denied"
  | "agent_attached"
  | "agent_detached"
  | "user_takeover"
  | "follow_changed"
  | "memory_summary_created"
  | "audit_checkpoint";
```

Actor：

```ts
type TerminalActor = {
  kind:
    | "human_user"
    | "agent"
    | "subagent"
    | "terminal_kernel"
    | "process"
    | "system"
    | "permission";
  displayName?: string | null;
  userId?: string | null;
  agentSessionId?: string | null;
  runtimeTurnId?: string | null;
  toolCallId?: string | null;
  processId?: number | null;
  processName?: string | null;
};
```

Correlation：

```ts
type TerminalCorrelation = {
  agentSessionId?: string | null;
  runtimeTurnId?: string | null;
  parentRuntimeTurnId?: string | null;
  toolCallId?: string | null;
  terminalToolName?: string | null;
  commandId?: string | null;
  inputId?: string | null;
  outputArtifactId?: string | null;
  permissionId?: string | null;
  uiWindowId?: string | null;
  terminalTabId?: string | null;
  paneId?: string | null;
  workbenchTabId?: string | null;
  projectRoot?: string | null;
  cwd?: string | null;
};
```

Visibility：

```ts
type TerminalEventVisibility =
  | "user_visible"
  | "model_context_only"
  | "audit_only"
  | "internal"
  | "debug_only";

type TerminalModelContextPolicy =
  | "include"
  | "include_summarized"
  | "include_as_runtime_state"
  | "artifact_reference_only"
  | "exclude";

type TerminalUiPolicy =
  | "show_in_timeline"
  | "show_as_status"
  | "show_in_terminal_only"
  | "show_in_details_only"
  | "hide_from_user";

type TerminalAuditPolicy =
  | "full"
  | "redacted"
  | "metadata_only"
  | "exclude";
```

Lineage：

```ts
type TerminalEventLineage = {
  parentEventIds: string[];
  derivedFromEventIds: string[];
  derivedFromSeqRange?: {
    startSeq: number;
    endSeq: number;
  } | null;
  source: "pty" | "ui" | "agent_tool" | "kernel" | "memory_job" | "migration";
};
```

### TerminalCommand

每条命令是一个一等实体。

```ts
type TerminalCommandRecord = {
  commandId: string;
  terminalSessionId: string;
  commandText: string;
  normalizedCommandText: string;
  actor: TerminalActor;
  submittedAtIso: string;
  submittedAtMs: number;
  startedAtIso?: string | null;
  startedAtMs?: number | null;
  finishedAtIso?: string | null;
  finishedAtMs?: number | null;
  cwd: string | null;
  shell: string | null;
  pid?: number | null;
  processGroupId?: number | null;
  status:
    | "submitted"
    | "running"
    | "completed"
    | "failed"
    | "interrupted"
    | "cancelled"
    | "unknown_after_recovery";
  exitCode: number | null;
  signal: string | null;
  inputEventIds: string[];
  outputStartSeq?: number | null;
  outputEndSeq?: number | null;
  outputArtifactId?: string | null;
  permissionId?: string | null;
  agentSessionId?: string | null;
  runtimeTurnId?: string | null;
  toolCallId?: string | null;
  confidence: number;
};
```

CommandRecord 可以回答：

- 这条命令是谁执行的？
- 是哪个 Agent turn 触发的？
- 用户授权记录是什么？
- 输出在哪里？
- 退出码是什么？
- 用哪个 cwd 执行？
- 是否是 shell integration 确认的命令边界？

### TerminalOutputArtifact

长输出缓存到本地文件。

```ts
type TerminalOutputArtifact = {
  artifactId: string;
  terminalSessionId: string;
  commandId?: string | null;
  outputStartSeq: number;
  outputEndSeq: number;
  textPath: string;
  ansiPath?: string | null;
  jsonlPath?: string | null;
  summaryPath?: string | null;
  indexPath?: string | null;
  byteLength: number;
  estimatedTokens: number;
  lineCount: number;
  sha256: string;
  createdAtIso: string;
  retention: "session" | "referenced" | "pinned" | "temporary";
  sensitivity: "normal" | "secret_detected" | "redacted" | "encrypted";
};
```

### AgentTerminalAttachment

记录 Agent 和 terminal session 的绑定关系。

```ts
type AgentTerminalAttachment = {
  attachmentId: string;
  terminalSessionId: string;
  agentSessionId: string;
  runtimeTurnId?: string | null;
  mode: "observe" | "assist" | "control" | "exclusive";
  follow: boolean;
  createdAtIso: string;
  detachedAtIso?: string | null;
  permissionScope?: unknown;
};
```

## 事件记录示例

### 人类执行命令

```json
{
  "eventId": "term-event-001",
  "terminalSessionId": "term-1",
  "seq": 120,
  "kind": "input_text",
  "actor": {
    "kind": "human_user",
    "displayName": "Pete"
  },
  "payload": {
    "text": "npm run dev:desktop",
    "appendNewline": true
  },
  "createdAtIso": "2026-06-01T06:30:00.000Z",
  "correlation": {
    "commandId": "cmd-1",
    "terminalTabId": "terminal-tab-1",
    "paneId": "pane-1",
    "cwd": "/Users/petehsu/Documents/Lyra"
  },
  "visibility": "user_visible",
  "modelContextPolicy": "artifact_reference_only",
  "uiPolicy": "show_in_timeline",
  "auditPolicy": "full"
}
```

### Agent 执行命令

```json
{
  "eventId": "term-event-010",
  "terminalSessionId": "term-1",
  "seq": 300,
  "kind": "command_started",
  "actor": {
    "kind": "agent",
    "agentSessionId": "agent-session-7",
    "runtimeTurnId": "turn-12",
    "toolCallId": "tool-call-99"
  },
  "payload": {
    "commandText": "cargo test --manifest-path Cargo.toml -p lyra-terminal-core shell_session",
    "cwd": "/Users/petehsu/Documents/Lyra"
  },
  "createdAtIso": "2026-06-01T06:31:00.000Z",
  "correlation": {
    "agentSessionId": "agent-session-7",
    "runtimeTurnId": "turn-12",
    "toolCallId": "tool-call-99",
    "terminalToolName": "terminal_run",
    "commandId": "cmd-2",
    "permissionId": "permission-44",
    "terminalTabId": "terminal-tab-1",
    "paneId": "pane-1"
  },
  "visibility": "user_visible",
  "modelContextPolicy": "include_as_runtime_state",
  "uiPolicy": "show_in_timeline",
  "auditPolicy": "full"
}
```

### 进程输出进入缓存

```json
{
  "eventId": "term-event-220",
  "terminalSessionId": "term-1",
  "seq": 900,
  "kind": "output_cached",
  "actor": {
    "kind": "process",
    "processId": 12345,
    "processName": "cargo"
  },
  "payload": {
    "artifactId": "terminal-output-abc123",
    "textPath": "/Users/petehsu/Library/Application Support/Lyra/terminal-memory/sessions/term-1/outputs/command-cmd-2.txt",
    "byteLength": 5242880,
    "estimatedTokens": 1747627,
    "lineCount": 81234,
    "preview": "running 2 tests..."
  },
  "createdAtIso": "2026-06-01T06:31:30.000Z",
  "correlation": {
    "commandId": "cmd-2",
    "outputArtifactId": "terminal-output-abc123",
    "agentSessionId": "agent-session-7",
    "runtimeTurnId": "turn-12",
    "toolCallId": "tool-call-99"
  },
  "visibility": "user_visible",
  "modelContextPolicy": "artifact_reference_only",
  "uiPolicy": "show_in_details_only",
  "auditPolicy": "full"
}
```

## SQLite Schema

### terminal_sessions

```sql
create table terminal_sessions (
  terminal_session_id text primary key,
  title text not null,
  created_at_iso text not null,
  created_at_ms integer not null,
  updated_at_iso text not null,
  updated_at_ms integer not null,
  working_dir text,
  shell text,
  mode text not null,
  visibility text not null,
  owner_kind text not null,
  owner_agent_session_id text,
  owner_runtime_turn_id text,
  ui_window_id text,
  terminal_tab_id text,
  pane_id text,
  rows integer not null,
  cols integer not null,
  running integer not null,
  exit_code integer,
  signal text,
  schema_version integer not null
);
```

### terminal_events

```sql
create table terminal_events (
  terminal_session_id text not null,
  seq integer not null,
  event_id text not null unique,
  kind text not null,
  actor_kind text not null,
  actor_json text not null,
  payload_json text not null,
  created_at_iso text not null,
  created_at_ms integer not null,
  monotonic_ms integer not null,
  correlation_json text not null,
  visibility text not null,
  model_context_policy text not null,
  ui_policy text not null,
  audit_policy text not null,
  lineage_json text not null,
  primary key (terminal_session_id, seq)
);

create index terminal_events_kind_idx
  on terminal_events(terminal_session_id, kind, seq);

create index terminal_events_created_idx
  on terminal_events(created_at_ms);
```

### terminal_commands

```sql
create table terminal_commands (
  command_id text primary key,
  terminal_session_id text not null,
  command_text text not null,
  normalized_command_text text not null,
  actor_json text not null,
  submitted_at_iso text not null,
  submitted_at_ms integer not null,
  started_at_iso text,
  started_at_ms integer,
  finished_at_iso text,
  finished_at_ms integer,
  cwd text,
  shell text,
  pid integer,
  process_group_id integer,
  status text not null,
  exit_code integer,
  signal text,
  input_event_ids_json text not null,
  output_start_seq integer,
  output_end_seq integer,
  output_artifact_id text,
  permission_id text,
  agent_session_id text,
  runtime_turn_id text,
  tool_call_id text,
  confidence real not null
);

create index terminal_commands_session_idx
  on terminal_commands(terminal_session_id, submitted_at_ms);

create index terminal_commands_agent_idx
  on terminal_commands(agent_session_id, runtime_turn_id, tool_call_id);
```

### terminal_output_artifacts

```sql
create table terminal_output_artifacts (
  artifact_id text primary key,
  terminal_session_id text not null,
  command_id text,
  output_start_seq integer not null,
  output_end_seq integer not null,
  text_path text not null,
  ansi_path text,
  jsonl_path text,
  summary_path text,
  index_path text,
  byte_length integer not null,
  estimated_tokens integer not null,
  line_count integer not null,
  sha256 text not null,
  created_at_iso text not null,
  retention text not null,
  sensitivity text not null
);
```

### agent_terminal_links

```sql
create table agent_terminal_links (
  link_id text primary key,
  terminal_session_id text not null,
  agent_session_id text not null,
  runtime_turn_id text,
  tool_call_id text,
  command_id text,
  permission_id text,
  created_at_iso text not null,
  relation text not null
);

create index agent_terminal_links_agent_idx
  on agent_terminal_links(agent_session_id, runtime_turn_id);
```

## UI Projection

Terminal UI 可以使用消息流形式展示，但每个 UI item 都来自 terminal event。

Timeline item：

```ts
type TerminalTimelineItem =
  | { type: "human_input"; eventId: string; text: string; createdAt: string }
  | { type: "agent_input"; eventId: string; text: string; agentSessionId: string; runtimeTurnId: string }
  | { type: "command"; commandId: string; text: string; status: string; exitCode: number | null }
  | { type: "output_preview"; artifactId?: string; text: string; truncated: boolean }
  | { type: "screen_snapshot"; screenVersion: number; text: string }
  | { type: "permission"; permissionId: string; status: string; summary: string }
  | { type: "status"; eventId: string; label: string };
```

UI 规则：

- 用户输入和 Agent 输入可以像消息一样显示。
- 大输出默认折叠为 preview。
- 点击 output preview 打开 artifact viewer。
- 点击 command 打开 command detail。
- 点击 Agent 操作显示对应 permission、tool call、RuntimeTurn。
- UI 不从 terminal 文本中推断 truth，只读 projection。

## Model Context Projection

Agent 不读取完整终端消息流。

Context assembler 只放入：

- 当前屏幕摘要。
- 最近少量输出 tail。
- 当前命令状态。
- 最近失败摘要。
- artifact refs。
- read hints。
- 必要的 commandId/sessionId/cursor。

示例：

```json
{
  "terminalSessionId": "term-1",
  "cursor": "seq:900",
  "activeCommand": {
    "commandId": "cmd-2",
    "commandText": "cargo test --manifest-path Cargo.toml -p lyra-terminal-core shell_session",
    "status": "failed",
    "exitCode": 1
  },
  "output": {
    "policy": "artifact_reference_only",
    "artifactId": "terminal-output-abc123",
    "textPath": "/.../command-cmd-2.txt",
    "estimatedTokens": 1747627,
    "summary": "2 tests failed in shell_session tests.",
    "recommendedReads": [
      { "reason": "first error", "startLine": 120, "endLine": 170 }
    ]
  }
}
```

## Audit Projection

Audit view 必须支持调查：

- 某个 Agent session 做过哪些终端操作？
- 某个 RuntimeTurn 运行了哪些命令？
- 某个命令是谁触发的？
- 用户是否授权？
- 授权范围是什么？
- Agent 输入了什么？
- 终端输出了什么？
- 输出是否被缓存、摘要或 redacted？
- 命令是否影响文件、网络、进程？

查询示例：

```text
Find all terminal commands executed by agent-session-7
Find all events for runtimeTurn turn-12
Find all commands that used permission permission-44
Find all outputs containing "permission denied"
Find all user takeover events
```

## 长输出和绝对不截断

绝对不截断的含义：

- Truth Store 不截断。
- Output Artifact 不截断。
- Event Journal 不丢 seq。
- UI 可以折叠。
- Model Context 可以摘要。
- Tool result 可以截断但必须给 artifactRef、cursor 和 read hints。

长输出处理流程：

```text
PTY bytes
  -> terminal_events output_chunk
  -> output aggregator
  -> token estimator
  -> if short: inline projection
  -> if long: write output artifact
  -> terminal_events output_cached
  -> model projection returns artifactRef
```

Agent 后续像读大型项目一样处理：

- 用 file read 分段读取。
- 用 text search 查错误。
- 用 line index 定位片段。
- 用 project search 对照源码。
- 用 command status 判断是否继续执行。

## 记忆提升

Terminal Memory 不只是日志，也可以产生长期记忆候选。

可提升为 Agent shared memory 的内容：

- 项目常用启动命令。
- 测试命令。
- 已知端口。
- 常见失败和修复方式。
- 环境要求。
- 需要手动授权的 CLI login 流程。

不能提升的内容：

- secret、token、password。
- 完整敏感输出。
- 临时路径中的敏感数据。
- 未经确认的推断。

提升流程：

```text
Terminal Event Journal
  -> terminal memory summarizer
  -> memory candidate
  -> confidence + lineage
  -> Agent Memory review/apply
```

## 权限和隐私

敏感信息处理：

- secret 输入事件 payload 必须 redacted。
- audit 可以记录 secret handle，不记录明文。
- output artifact 如果检测到 secret，标记 `secret_detected`。
- secret artifact 可加密或仅保留 metadata。
- 用户可删除 terminal session memory。
- 用户可清理 output cache。

权限记录必须绑定：

- permissionId
- terminalSessionId
- agentSessionId
- runtimeTurnId
- toolCallId
- commandId 或 inputId
- risk
- scope
- user decision
- created/responded time

## 与现有终端工具的关系

现有工具：

```text
terminal_list
terminal_create
terminal_read
terminal_wait
terminal_write
terminal_close
```

升级后每个工具都必须写 Terminal Memory：

- `terminal_create` 写 `session_created`。
- `terminal_write` 写 `input_*`，并关联 actor。
- `terminal_read` 不创建新 truth，但可以写 audit read event。
- `terminal_wait` 不创建新 truth，但可以写 wait audit event。
- `terminal_close` 写 `session_closed`。
- `terminal_run` 写 command lifecycle。

## 实施阶段

### Phase 1: Terminal Event Identity

目标：

- 每个终端事件都有 session id、seq、event id、actor、timestamp、correlation。

任务：

- 定义 DTO。
- Rust terminal core 生成 seq。
- Desktop main 传入 agent/session/turn/tool correlation。
- UI human input 传入 pane/tab/window correlation。

验收：

- 任意输出能追踪到 terminal session。
- 任意 Agent 输入能追踪到 Agent session、RuntimeTurn、tool call。
- 任意用户输入能追踪到 UI pane。

### Phase 2: Terminal Conversation Store

目标：

- 独立 SQLite 和 JSONL projection。

任务：

- 创建 `terminal-memory` root。
- 写 `terminal_events`。
- 写 `terminal_commands`。
- 写 `terminal_output_artifacts`。
- 写 projection generator。

验收：

- 重启后可查看历史 terminal session。
- command timeline 可恢复。
- audit view 可查询。

### Phase 3: Output Artifact and Search

目标：

- 长输出本地缓存，Agent 用现有 file/search 工具读取。

任务：

- output token estimator。
- artifact writer。
- line index。
- error index。
- read hints。

验收：

- 大输出不进入模型上下文。
- 大输出完整落盘。
- Agent 可搜索 artifact。

### Phase 4: UI Conversation Timeline

目标：

- 终端像会话参与者一样可读，但不污染 Agent chat truth。

任务：

- terminal timeline projection。
- command card。
- output preview。
- Agent action badge。
- permission link。
- audit detail drawer。

验收：

- 人类能看清哪个命令是谁执行的。
- 点击命令能看到输出、权限、Agent turn。
- 长输出默认折叠但可打开全文。

### Phase 5: Memory Promotion

目标：

- 从终端历史提取可复用项目事实。

任务：

- terminal summarizer。
- memory candidate。
- lineage。
- review/apply。

验收：

- 能提取项目启动命令。
- 能提取测试命令。
- 不提升 secret。
- 每条提升记忆可追溯到 terminal events。

## 测试计划

### Identity Tests

- Human input has terminalSessionId and paneId.
- Agent input has agentSessionId, runtimeTurnId, toolCallId.
- Process output has commandId when known.
- Permission events link to command/input.

### Storage Tests

- Events are append-only.
- Seq is monotonic per terminal session.
- Restart preserves sessions and commands.
- Output artifacts keep sha256 and line count.

### Projection Tests

- UI timeline is derived from events.
- Model context excludes raw long output.
- Audit projection includes permission and actor details.
- Internal events do not appear as chat messages.

### Long Output Tests

- Short output inline returns full text.
- Long output writes artifact.
- Tool result includes artifact path and read hints.
- Agent can search cached output.

### Investigation Tests

- Query all commands run by an Agent session.
- Query all events for a RuntimeTurn.
- Query who executed a destructive command.
- Query the permission decision for a command.
- Replay a terminal session around a failure.

## 关键验收标准

这个架构完成后，必须做到：

- 终端历史不是聊天文本，而是独立 truth store。
- 每条命令、输入、输出都有精确 ID 和时间。
- 能区分人类执行和 Agent 执行。
- 能从 Agent session 追踪到 terminal command。
- 能从 terminal command 追踪到 output artifact。
- 能从 permission 追踪到实际执行。
- 长输出不会撑爆上下文，也不会丢失。
- UI 可以像消息流一样展示终端，但不污染模型上下文。
- Agent 可以像读大型代码库一样读取终端长输出。
- Terminal Memory 可以生成可审查、可追溯的长期记忆候选。

## 结论

“终端作为会话参与者”是一个有价值的核心抽象。

它让终端从临时输出窗口升级为有结构化记忆的执行空间。人、Agent、进程、权限系统都在这个空间里留下精确事件。UI 可以把这些事件渲染成自然的消息流，Agent 可以按需读取预算内投影，审计系统可以调查完整事实。

关键不是把终端聊天化，而是把终端事件化、记忆化、可追踪化。

最终形态：

```text
终端像一个参与者一样收发消息
底层像数据库一样记录事实
Agent 像读项目一样理解长输出
用户像审计系统一样追查每个动作
```
