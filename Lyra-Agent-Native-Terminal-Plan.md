# Lyra Agent-Native Terminal Plan

## 文档状态

本文档是 Lyra Terminal 从“基础终端”升级为“Agent 原生终端软件”的完整实现计划。

目标不是继续给现有终端补几个 `read/write/wait` 工具，而是把终端做成 Lyra 的一等运行时表面：终端会话、PTY、屏幕状态、输入、进程、命令边界、TUI 状态、Agent 权限和审计都由一个本地 Terminal Kernel 统一拥有。

配套文档：

- `Lyra-Terminal-Conversation-Memory.md`：定义终端作为会话参与者的独立存储、精确事件记录、长输出缓存、Agent/人类 actor 追踪和审计模型。

最终目标是：

- Agent 可以在终端里进行任何人类能做的操作
- Agent 可以读、看、等、输入、发信号、调整窗口、操作 TUI、运行命令、启动另一个 Agent
- 能力不人为阉割，但所有高影响动作都受 Lyra 权限审批、审计、可中断和可追踪约束
- 终端要做到快、准、狠、稳、强

## 背景问题

当前终端能力已经从普通 UI 终端扩展到了 Agent 工具，但本质仍是“Agent 通过旁路工具操作一个终端”。这种方式天然有以下问题：

- 输出截断：工具返回值有上下文预算，长输出会被截断，Agent 无法可靠恢复完整历史。
- 回车/输入脆弱：`text`、`data`、`appendNewline`、按键序列和 shell 行编辑状态混在一起，容易出现少回车、重复回车、输入位置不对。
- TUI 不可见：很多真实工具运行在 alternate screen 中，stdout 文本不能代表屏幕真实状态。
- 输出感知滞后：Agent 等待工具返回，而不是订阅终端事件流，容易出现终端已经输出结果但 Agent 仍在等。
- 进程状态不完整：running、exitCode、signal、当前命令、cwd、prompt、子进程等信息不够结构化。
- UI 终端和私有终端割裂：Follow 逻辑、UI 面板、私有会话和 Agent 工具之间的路由容易混乱。
- 权限体验繁琐：如果模型把一个动作拆成多个键盘动作，用户可能需要多次授权。
- 审计不够完整：终端里发生了什么、Agent 为什么输入、用户授权了什么，需要更强的本地证据链。

## 产品目标

Lyra Terminal 应该变成一个 Agent-native terminal software，而不是一个简单的 embedded terminal。

核心体验：

1. 人类使用时，它是一个强大的现代终端。
2. Agent 使用时，它是一个可读屏、可操控、可等待、可审计的操作环境。
3. 人类和 Agent 同时使用时，它有明确的 Follow、handoff、takeover、pause、resume 和 kill 语义。
4. 任何长输出、TUI、交互式安装、CLI login、REPL、debugger、SSH 会话都能被 Agent 稳定理解和操作。
5. 用户不需要为了每个字符、每个回车重复授权。权限应当按“语义动作”审批，而不是按底层按键审批。

## 核心原则

### 1. 能力无限制，执行受控

Agent 最终应当可以做任何终端操作：

- 运行任意命令
- 输入任意文本
- 发送任意按键和控制字符
- 发送信号，例如 Ctrl-C、SIGTERM、SIGKILL
- 操作 TUI、REPL、debugger、SSH、远程 shell
- 调整终端尺寸
- 读取完整输出和屏幕
- 启动、挂接、暂停、关闭终端内的 Agent
- 将一个终端会话交给另一个 Agent

安全边界不应该通过削弱 Agent 能力实现，而应该通过下面的机制实现：

- 权限审批
- 权限作用域
- 审计日志
- 可撤销授权
- 实时中断
- 高风险动作二次确认
- 敏感输出保护
- 用户接管

### 2. Terminal Kernel 是事实来源

Renderer 不是终端 truth，Agent 工具返回值也不是 truth。

终端真实状态必须由 Terminal Kernel 拥有：

- PTY session
- 进程树
- 终端屏幕 grid
- normal screen / alternate screen
- scrollback
- event journal
- input journal
- command lifecycle
- permission ledger
- Agent attachments

UI 和 Agent 都只是 Terminal Kernel 的消费者和操作者。

### 3. 所有东西都用 cursor 增量读取

终端输出不应该依赖一次性返回完整文本。

每个 session 都有 append-only event journal，每个消费者使用 cursor 增量读取：

- UI renderer cursor
- Agent tool cursor
- audit cursor
- replay cursor
- compaction cursor

### 4. 屏幕状态比 stdout 更重要

Agent 操作终端时，必须能看到“用户肉眼看到的终端屏幕”：

- 当前可见文本
- 光标位置
- 输入区域
- TUI 菜单和按钮
- 高亮项
- alternate screen
- 全屏编辑器状态
- ANSI 样式和布局
- 最后一段 scrollback

stdout 只是事件来源之一，不是交互真相。

### 5. 语义动作优先于底层按键

用户授权和 Agent 意图应尽量以语义动作表达：

- “运行 `npm test`”
- “在当前 prompt 输入并执行这条命令”
- “选择 TUI 中的 Continue”
- “停止当前进程”
- “粘贴这一段配置”

底层可能会拆成多个 bytes、keys 或 mouse events，但权限审批应该尽量只出现一次。

### 6. 快准狠稳强

- 快：低延迟事件流，输出实时到达 UI 和 Agent。
- 准：结构化屏幕、命令边界、退出码、cwd 和进程状态。
- 狠：Agent 可以完成真实复杂终端任务，不被简单 API 限制。
- 稳：长输出、TUI、崩溃恢复、会话切换都可靠。
- 强：终端本身成为 Lyra 的核心自动化执行面。

## 非目标

第一阶段不做以下事情：

- 不实现 OS kernel，不接管系统权限模型。
- 不把 Agent 默认提升成系统 root 权限。
- 不绕过 macOS/Windows/Linux 自身的安全限制。
- 不把所有终端输出永久明文上传云端。
- 不让 renderer 直接拥有 PTY truth。
- 不要求一次性支持所有 TUI 的语义识别。
- 不把权限审批简化成“一律允许所有危险操作”。

## 总体架构

```text
Renderer Terminal UI
  - xterm/canvas renderer
  - panes/tabs/splits
  - selection/search/copy
  - human input
  - follow/handoff controls
        |
        v
Desktop Main Bridge
  - IPC validation
  - window/session routing
  - permission panel integration
  - host capability handlers
        |
        v
Terminal Kernel (Rust)
  - PTY manager
  - screen model
  - event journal
  - process model
  - command tracker
  - input controller
  - agent attachment manager
  - permission gate
  - audit projector
        |
        v
OS PTY / Shell / Process / SSH / CLI Agent
```

## Terminal Kernel 模块

### 1. Session Manager

负责创建、恢复、关闭、列出终端会话。

状态字段：

```ts
type TerminalSession = {
  sessionId: string;
  title: string;
  cwd: string | null;
  shell: string;
  mode: "shell" | "command" | "agent" | "ssh" | "custom";
  createdAt: string;
  updatedAt: string;
  running: boolean;
  exitCode: number | null;
  signal: string | null;
  rows: number;
  cols: number;
  screenMode: "normal" | "alternate";
  owner: "user" | "agent" | "shared";
  visibility: "ui" | "private" | "background";
};
```

能力：

- 创建 shell session
- 创建 command session
- 创建 private Agent session
- 挂接到 UI pane
- detach UI 但保留 session
- close session
- kill process tree
- restore metadata after app reload

### 2. PTY Manager

负责 OS PTY 生命周期。

能力：

- spawn shell
- spawn command
- write bytes
- send key sequences
- resize
- send signal
- detect exit
- collect stderr/stdout merged PTY stream
- process group cleanup

要求：

- macOS/Linux 使用 portable PTY implementation
- Windows 预留 ConPTY 路径
- 所有写入必须进入 input journal
- 所有 PTY 输出必须进入 event journal
- 所有 exit/signal 必须结构化记录

### 3. Event Journal

终端事件是 append-only truth。

事件类型：

```ts
type TerminalEvent =
  | TerminalOutputEvent
  | TerminalScreenDiffEvent
  | TerminalInputEvent
  | TerminalResizeEvent
  | TerminalProcessEvent
  | TerminalCommandEvent
  | TerminalPermissionEvent
  | TerminalAgentEvent
  | TerminalErrorEvent;
```

基础字段：

```ts
type TerminalEventBase = {
  eventId: string;
  sessionId: string;
  seq: number;
  timestamp: string;
  source: "pty" | "user" | "agent" | "kernel" | "system";
};
```

输出事件：

```ts
type TerminalOutputEvent = TerminalEventBase & {
  kind: "output";
  bytesBase64: string;
  textPreview: string;
  byteLength: number;
};
```

屏幕 diff：

```ts
type TerminalScreenDiffEvent = TerminalEventBase & {
  kind: "screen_diff";
  screenVersion: number;
  mode: "normal" | "alternate";
  dirtyRows: Array<{
    row: number;
    text: string;
    cells?: TerminalCell[];
  }>;
  cursor: {
    row: number;
    col: number;
    visible: boolean;
  };
};
```

命令事件：

```ts
type TerminalCommandEvent = TerminalEventBase & {
  kind: "command";
  phase: "started" | "completed" | "failed" | "interrupted" | "unknown";
  commandId: string;
  commandText: string;
  cwd: string | null;
  exitCode?: number | null;
  signal?: string | null;
};
```

存储要求：

- 支持 cursor 增量读取
- 支持按时间/seq 范围读取
- 支持按 commandId 读取
- 支持压缩老输出但保留索引
- 支持输出 artifact 化，避免模型上下文爆炸

### 4. Screen Model

维护真实终端屏幕状态。

必须支持：

- ANSI parser
- normal screen
- alternate screen
- scrollback
- cursor position
- style attributes
- line wrap
- wide characters
- combining characters
- hyperlinks OSC 8
- bracketed paste mode
- mouse reporting mode
- application cursor mode

Agent-facing projection：

```ts
type TerminalScreenSnapshot = {
  sessionId: string;
  cursor: string;
  screenVersion: number;
  rows: number;
  cols: number;
  mode: "normal" | "alternate";
  visibleText: string;
  selectedText?: string | null;
  cursorPosition: {
    row: number;
    col: number;
    visible: boolean;
  };
  prompt?: TerminalPromptSnapshot | null;
  activeCommand?: TerminalCommandSnapshot | null;
  regions: TerminalScreenRegion[];
  truncated: boolean;
};
```

TUI regions：

```ts
type TerminalScreenRegion = {
  regionId: string;
  kind:
    | "prompt"
    | "input"
    | "menu_item"
    | "button"
    | "checkbox"
    | "table"
    | "log"
    | "error"
    | "selection"
    | "unknown";
  text: string;
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
  confidence: number;
  suggestedActions: Array<"type" | "enter" | "arrow" | "tab" | "mouse" | "read">;
};
```

### 5. Command Tracker

通过 shell integration 和启发式 fallback 识别命令边界。

优先支持：

- OSC 133
- shell prompt hooks
- zsh integration
- bash integration
- fish integration
- PowerShell integration

记录：

- prompt displayed
- user/agent submitted command
- command started
- command output range
- command completed
- exit code
- cwd after command
- duration

Fallback：

- 无 shell integration 时，通过 input journal + prompt heuristics + process exit 推断。
- 推断结果必须标记 confidence，不可伪装成确定事实。

### 6. Input Controller

统一所有终端输入。

输入 API：

```ts
type TerminalInputRequest =
  | { kind: "text"; text: string; appendNewline?: boolean; pasteMode?: "auto" | "bracketed" | "raw" }
  | { kind: "keys"; keys: string[] }
  | { kind: "bytes"; dataBase64: string }
  | { kind: "signal"; signal: "SIGINT" | "SIGTERM" | "SIGKILL" | "SIGHUP" }
  | { kind: "resize"; cols: number; rows: number }
  | { kind: "mouse"; row: number; col: number; button: string; action: string };
```

语义动作 API：

```ts
type TerminalSemanticAction =
  | { action: "runCommand"; command: string; cwd?: string | null }
  | { action: "submitInput"; text: string }
  | { action: "paste"; text: string }
  | { action: "selectTuiRegion"; regionId: string }
  | { action: "cancelCurrentProcess" }
  | { action: "confirmPrompt" }
  | { action: "chooseMenuItem"; label: string };
```

原则：

- Agent 优先调用语义动作。
- Kernel 将语义动作展开成底层输入。
- 权限按语义动作审批。
- input journal 同时记录语义动作和底层 bytes。

### 7. Permission Gate

这是“Agent 无限制操作”的控制核心。

能力上允许 Agent 请求任何终端操作，但执行前由 Permission Gate 判断是否需要审批、审批范围是什么、是否命中已有授权。

权限维度：

```ts
type TerminalPermissionRisk =
  | "read"
  | "input"
  | "shell"
  | "network"
  | "file"
  | "process"
  | "credential"
  | "remote"
  | "destructive"
  | "dangerous";
```

审批范围：

```ts
type TerminalPermissionScope =
  | { kind: "once"; requestId: string }
  | { kind: "session"; sessionId: string; expiresAt?: string }
  | { kind: "command"; commandPattern: string; cwd?: string | null }
  | { kind: "turn"; agentSessionId: string; turnId: string }
  | { kind: "agent"; agentSessionId: string; expiresAt?: string }
  | { kind: "deny" };
```

审批策略：

- read/screen/list 默认免权限。
- 等待 output/exit 默认免权限。
- UI focus/follow 低风险，通常免权限或轻量提示。
- 输入文本需要权限，除非用户已经授予当前 turn/session。
- 执行命令需要权限。
- 发送 Ctrl-C/SIGTERM 需要权限或当前 Agent 拥有该命令。
- SIGKILL、删除文件、改系统配置、联网安装、传输凭证需要高风险确认。
- 粘贴多行脚本必须展示摘要和风险。
- 涉及 secret/token/password 的输入需要敏感审批，默认不在模型输出中回显。

授权体验：

- 用户应看到“Agent 想做什么”，而不是“Agent 想按下 8 个键”。
- 支持 Allow once。
- 支持 Allow for this turn。
- 支持 Allow for this terminal session。
- 支持 Always allow matching command pattern。
- 支持 Deny。
- 支持 Emergency stop。

### 8. Audit Ledger

所有 Agent 终端操作必须可审计。

审计内容：

- Agent 请求
- 权限 prompt
- 用户决定
- 展开的底层输入
- 输出事件范围
- 命令退出码
- TUI 操作目标
- 是否包含敏感文本
- 是否被用户中断

审计不等于 UI 聊天消息。审计日志应本地保留，并可从 UI 打开查看。

### 9. Agent Attachment Manager

支持 Agent 和终端会话之间的强绑定。

模式：

```ts
type AgentTerminalAttachment = {
  attachmentId: string;
  agentSessionId: string;
  turnId?: string | null;
  terminalSessionId: string;
  mode: "observe" | "assist" | "control" | "exclusive";
  follow: boolean;
  permissionScope: TerminalPermissionScope;
  createdAt: string;
};
```

模式语义：

- observe：Agent 只能读屏、读事件、等待。
- assist：Agent 可建议命令，用户确认执行。
- control：Agent 可在权限审批后输入和运行命令。
- exclusive：Agent 独占控制，用户仍可 emergency stop。

### 10. Terminal-in-Terminal Agent

支持在终端中运行 Agent，也支持 Lyra Agent 启动和管理终端内 Agent。

场景：

- 在终端里运行 `codex`、`claude`、`opencode`、`gemini` 等 CLI Agent。
- Lyra Agent 启动一个子 Agent 处理长任务。
- 子 Agent 的输出进入 Terminal Kernel event journal。
- Lyra Agent 可以观察子 Agent、等待它、给它输入、停止它。

需要解决：

- 子 Agent 的输出和普通命令输出区分。
- 子 Agent 请求用户授权时如何映射回 Lyra 权限面板。
- 多 Agent 同时控制同一终端时的锁和优先级。
- 防止 Agent 递归失控。

## Agent 工具设计

保留现有 `terminal_*`，但升级为 Terminal Kernel 工具。

### 基础工具

```text
terminal_list
terminal_create
terminal_read
terminal_wait
terminal_write
terminal_close
```

升级后统一返回：

```ts
type TerminalToolOutput = {
  target: TerminalToolTarget;
  cursor: string;
  output: string;
  screen?: TerminalScreenSnapshot;
  running: boolean;
  exitCode: number | null;
  signal?: string | null;
  truncated: boolean;
};
```

### 新增工具

```text
terminal_screen
terminal_events
terminal_run
terminal_input
terminal_keys
terminal_signal
terminal_resize
terminal_map
terminal_act
terminal_processes
terminal_command_status
terminal_attach_agent
terminal_detach_agent
```

#### terminal_screen

读取当前真实屏幕。

```ts
type TerminalScreenInput = {
  sessionId?: string;
  cursor?: string;
  includeScrollback?: boolean;
  maxRows?: number;
  maxBytes?: number;
};
```

`terminal_screen.cursor` 是 screen version cursor，只描述 Kernel screen projection 的观察顺序；它独立于 `terminal_read.cursor` 的 UTF-8 output byte offset，二者不能混用。

```ts
type TerminalScreenSnapshot = {
  cursor: string;
  screenVersion: number;
  rows: number;
  cols: number;
  mode: "normal" | "alternate" | "unknown";
  visibleText: string;
  visibleRows: Array<{ row: number; text: string; wrapped: boolean }>;
  scrollbackCursor: string;
  scrollbackRows: Array<{ row: number; text: string; wrapped: boolean }>;
  cursorPosition: { row: number; col: number; visible: boolean };
  cells: Array<{
    row: number;
    col: number;
    text: string;
    width: number;
    styleId?: string | null;
    hyperlinkId?: string | null;
  }>;
  cellsTruncated: boolean;
  styles: Array<{
    styleId: string;
    foreground: string;
    background: string;
    bold: boolean;
    dim: boolean;
    italic: boolean;
    underline: boolean;
    inverse: boolean;
  }>;
  links: Array<{
    linkId: string;
    uri: string;
    rowStart: number;
    rowEnd: number;
    colStart: number;
    colEnd: number;
  }>;
  inputModes: {
    applicationCursor: boolean;
    applicationKeypad: boolean;
    bracketedPaste: boolean;
    mouseReporting: "none" | "press" | "pressRelease" | "buttonMotion" | "anyMotion" | string;
    mouseEncoding: "default" | "utf8" | "sgr" | string;
    lineWrap: boolean;
  };
};
```

#### terminal_events

按 cursor 读取 event journal。

```ts
type TerminalEventsInput = {
  sessionId: string;
  cursor?: string;
  kinds?: string[];
  maxEvents?: number;
  maxBytes?: number;
};
```

#### terminal_run

语义化运行命令。

```ts
type TerminalRunInput = {
  sessionId?: string;
  target?: "auto" | "private" | "ui";
  command: string;
  cwd?: string;
  waitMs?: number;
  maxBytes?: number;
};
```

特点：

- 审批展示完整命令。
- 自动 append newline。
- 自动创建 commandId。
- 自动等待初始输出或退出。
- 返回 commandId 和 cursor。

#### terminal_input

语义化输入文本。

```ts
type TerminalInputToolInput = {
  sessionId: string;
  text: string;
  appendNewline?: boolean;
  mode?: "type" | "paste" | "bracketedPaste";
};
```

#### terminal_map

把当前屏幕映射成可操作区域，类似浏览器 Lumen。

```ts
type TerminalMapInput = {
  sessionId: string;
  strategy?: "screen" | "tui" | "prompt" | "hybrid";
};
```

#### terminal_act

操作 TUI 区域。

```ts
type TerminalActInput = {
  sessionId: string;
  regionId?: string;
  action: "select" | "confirm" | "cancel" | "toggle" | "focus" | "type";
  text?: string;
};
```

## Token-Aware Output Cache

长输出不能靠“提高 maxBytes”解决。Terminal Kernel 应该内置 token-aware output projection：先估算输出进入模型上下文的成本，再决定直接返回、摘要返回，还是落到本地缓存文件让 Agent 像阅读大型代码库一样处理。

核心策略：

```text
PTY output
  -> Event Journal 完整保存
  -> Command Output Aggregator 聚合到 commandId
  -> Token Estimator 估算上下文成本
  -> Projection Gate 决定返回方式
     - short: 直接完整返回
     - medium: head + tail + error summary
     - long: 写入本地 cache artifact，只返回摘要、路径和读取建议
```

### Token 预算规则

每个终端工具输出都必须经过预算闸门。

建议默认阈值：

```ts
type TerminalOutputBudgetPolicy = {
  inlineTokenLimit: 6_000;
  summarizeTokenLimit: 24_000;
  cacheFileByteLimit: 64 * 1024;
  hardToolOutputTokenLimit: 12_000;
};
```

语义：

- 小于 `inlineTokenLimit`：直接返回完整输出。
- 大于 `inlineTokenLimit` 但仍可读：返回 head、tail、error lines、exit summary。
- 大于 `summarizeTokenLimit` 或 `cacheFileByteLimit`：写入本地 cache artifact。
- 工具返回永远不超过 `hardToolOutputTokenLimit`。

token 估算不需要依赖精确模型 tokenizer。第一版可用保守估算：

```text
estimatedTokens = ceil(utf8ByteLength / 3)
```

后续可根据 provider/model 接入精确 tokenizer。

### 本地缓存文件

长输出写入本地缓存文件，路径由 Kernel 管理。

推荐结构：

```text
~/.lyra/modules/terminal-kernel/
  sessions/
    <session_id>/
      outputs/
        command-<command_id>.txt
        command-<command_id>.ansi
        command-<command_id>.jsonl
      artifacts/
        output-<artifact_id>.txt
        output-<artifact_id>.summary.json
        output-<artifact_id>.index.sqlite
```

文件类型：

- `.txt`：去 ANSI 后的纯文本，供 Agent 直接读取、搜索、分段理解。
- `.ansi`：原始 ANSI 文本，供 replay 或 UI 还原。
- `.jsonl`：按 event/line/chunk 结构化保存。
- `.summary.json`：Kernel 或后台 summarizer 生成的摘要、错误索引、统计信息。
- `.index.sqlite`：可选，保存 line offset、error index、file path index。

工具返回示例：

```json
{
  "target": { "type": "ui", "sessionId": "term-1" },
  "cursor": "seq:98231",
  "running": false,
  "exitCode": 1,
  "truncated": true,
  "outputPolicy": "cached",
  "outputPreview": "Test run failed. 16 failed, 240 passed...",
  "artifact": {
    "artifactId": "terminal-output-abc123",
    "kind": "terminal_output",
    "textPath": "/Users/petehsu/Library/Application Support/Lyra/terminal-kernel/sessions/term-1/outputs/command-cmd-9.txt",
    "ansiPath": "/Users/petehsu/Library/Application Support/Lyra/terminal-kernel/sessions/term-1/outputs/command-cmd-9.ansi",
    "byteLength": 5242880,
    "estimatedTokens": 1747627,
    "lineCount": 81234
  },
  "readHints": [
    "Use file_read on artifact.textPath for specific ranges.",
    "Use code_search_text or project_search for error keywords in the cached output.",
    "Start with the summary and error index before reading the full file."
  ]
}
```

### Agent 使用方式

长输出被缓存后，Agent 不需要特殊大输出工具。它可以复用已有能力：

- `file_read`：按范围读缓存文件。
- `code_search_text`：搜索 `error`、`failed`、文件路径、测试名。
- `project_search`：结合项目文件定位输出中提到的源码。
- `artifact_read`：读取 terminal output artifact 元数据。
- `terminal_events`：按 cursor 继续读取增量输出。

这让 terminal 输出和大型代码库形成同一套理解路径：

```text
先看摘要
再搜关键错误
再读相关片段
再打开项目源码
最后回到 terminal 继续执行
```

### 输出索引

对长输出自动生成索引，降低 Agent 搜索成本。

索引内容：

- line number -> byte offset
- error/warning/fail/panic/exception 行
- file path + line/column 引用
- test suite/test case 名称
- repeated line pattern
- progress marker
- command phase
- first error
- last error

摘要格式：

```ts
type TerminalOutputSummary = {
  artifactId: string;
  commandId: string;
  byteLength: number;
  estimatedTokens: number;
  lineCount: number;
  exitCode: number | null;
  firstLines: string[];
  lastLines: string[];
  errorLines: Array<{
    line: number;
    text: string;
    severity: "error" | "warning" | "info";
  }>;
  fileReferences: Array<{
    path: string;
    line?: number;
    column?: number;
    outputLine: number;
  }>;
  recommendedReads: Array<{
    reason: string;
    startLine: number;
    endLine: number;
  }>;
};
```

### Cache 生命周期

缓存文件必须可控，不能无限增长。

策略：

- session 活跃期间保留完整缓存。
- command artifact 被聊天记录引用时保留。
- 未引用的大输出按 LRU 清理。
- 用户可从 UI 手动清理 terminal cache。
- 审计日志只记录 artifact metadata，不强制永久保存所有输出。
- 敏感输出可标记 redacted 或 encrypted。

### 与 Event Journal 的关系

Event Journal 是 truth，Output Cache 是面向阅读和检索的派生产物。

```text
Event Journal:
  完整、可重放、按 seq 记录

Output Cache:
  面向 Agent/file tools 的文本文件和索引

Screen Snapshot:
  面向当前交互和 TUI 的可见状态
```

三者不能互相替代。

## Renderer/UI 设计

终端 UI 不再直接绑定 PTY，而是渲染 Terminal Kernel 的 screen projection。

Workbench terminal 默认渲染 Terminal Kernel 的 screen projection；xterm 保留为隐藏兼容层，继续承担输入、fit/resize 和 raw PTY 对照诊断。隐藏诊断/回退开关：

- `localStorage["lyra.terminal.rendererDiagnostics"] = "1"`：开启 xterm visible buffer 与 Kernel screen snapshot 对比，并把 mismatch metrics 暴露到 `window.__lyraTerminalRendererDiagnostics`。
- `localStorage["lyra.terminal.renderer"] = "xterm"` 或 `"raw"`：临时回退到 xterm 可见渲染路径。
- `localStorage["lyra.terminal.renderer"] = "kernel"` 或未设置：使用 Kernel projection renderer；xterm 仍保留在底层处理输入和 raw PTY 兼容。

Screen snapshot v1 会回填 UI selection 文本、memory command tracker 中的 active command、Lyra prompt marker 推导出的 prompt，以及 prompt/cursor-line/hyperlink regions。这个 region 集合是 `terminal_map` / `terminal_act` 的 v1 输入面。

需要支持：

- tabs
- splits
- private Agent terminal card
- UI terminal pane
- session switcher
- command timeline
- Agent control badge
- Follow on/off
- takeover button
- pause Agent
- emergency stop
- permission prompt
- audit drawer
- full output artifact viewer
- TUI inspect overlay

Agent 操作可视化：

- 显示 Agent 当前观察的 terminal session。
- 显示 Agent 即将输入/运行的语义动作。
- 显示该动作对应权限。
- 显示执行后的输出范围。
- 显示 commandId、exitCode、duration。

私有终端：

- Follow off 时，Agent private terminal 不创建可见 Workbench tab。
- 聊天工具卡展示最新输出和屏幕摘要。
- 用户可一键“打开为终端面板”。

Follow on：

- 优先操作当前 UI terminal pane。
- 如果当前没有 UI terminal pane，Agent 可请求打开一个。
- 用户可随时 takeover。

## 权限体验设计

### 权限弹窗内容

权限弹窗必须展示：

- Agent 名称或会话
- 目标 terminal session
- 语义动作
- 命令或输入摘要
- cwd
- 风险级别
- 授权范围选项
- 最近屏幕上下文

例子：

```text
Agent wants to run a command in Terminal

Command:
  npm run dev:desktop

Working directory:
  /Users/petehsu/Documents/Lyra

Risk:
  shell

Allow:
  Once
  This turn
  This terminal session
  Matching command pattern
  Deny
```

### 敏感输入

如果 Agent 要输入 token、password、API key：

- 默认不把敏感值显示给模型。
- UI 显示 secret label 和目的地。
- Agent 可以请求“将用户提供的 secret 输入当前 prompt”。
- Kernel 执行输入，audit 记录 secret redacted。

### 高危动作

高危动作包括：

- `rm -rf`
- `sudo`
- 修改 shell profile
- 安装系统级包
- kill 不属于当前终端 session 的进程
- 上传文件或 secret
- SSH 到远程机器后执行 destructive command

这些动作必须二次确认或要求更窄 scope。

## 存储设计

推荐位置：

```text
~/.lyra/modules/terminal-kernel/
```

结构：

```text
~/.lyra/modules/terminal-kernel/
  sessions/
    <session_id>/
      session.sqlite
      events.sqlite
      outputs/
      screen.snapshots/
      artifacts/
      audit.jsonl
  permissions/
    terminal-permissions.sqlite
  indexes/
    command-index.sqlite
```

SQLite 表：

```sql
terminal_sessions(
  session_id text primary key,
  title text,
  cwd text,
  shell text,
  mode text,
  visibility text,
  rows integer,
  cols integer,
  running integer,
  exit_code integer,
  signal text,
  created_at text,
  updated_at text
);

terminal_events(
  session_id text,
  seq integer,
  event_id text,
  kind text,
  timestamp text,
  source text,
  payload_json text,
  primary key(session_id, seq)
);

terminal_commands(
  command_id text primary key,
  session_id text,
  start_seq integer,
  end_seq integer,
  command_text text,
  cwd text,
  status text,
  exit_code integer,
  signal text,
  started_at text,
  finished_at text,
  confidence real
);

terminal_permissions(
  permission_id text primary key,
  session_id text,
  agent_session_id text,
  turn_id text,
  risk text,
  scope_json text,
  status text,
  created_at text,
  responded_at text
);

terminal_output_artifacts(
  artifact_id text primary key,
  session_id text,
  command_id text,
  text_path text,
  ansi_path text,
  jsonl_path text,
  summary_path text,
  byte_length integer,
  estimated_tokens integer,
  line_count integer,
  output_start_seq integer,
  output_end_seq integer,
  retention text,
  created_at text
);
```

## IPC 和 Host Capability

Desktop main 注册 host handlers：

```text
terminal.list
terminal.create
terminal.read
terminal.wait
terminal.write
terminal.close
terminal.screen
terminal.events
terminal.run
terminal.input
terminal.keys
terminal.signal
terminal.resize
terminal.map
terminal.act
terminal.processes
terminal.commandStatus
terminal.attachAgent
terminal.detachAgent
```

Renderer bridge：

```text
window.lyra.terminalKernel.listSessions()
window.lyra.terminalKernel.subscribe(sessionId, cursor)
window.lyra.terminalKernel.readScreen(sessionId)
window.lyra.terminalKernel.writeInput(request)
window.lyra.terminalKernel.openPane(sessionId)
window.lyra.terminalKernel.closePane(sessionId)
window.lyra.terminalKernel.takeover(sessionId)
```

## 现有代码迁移路径

当前相关模块：

- `crates/lyra-terminal-core`
- `apps/desktop/src/main/agent/service.ts`
- `apps/desktop/src/main/workbench-observation`
- `apps/desktop/src/modules/workbench`
- 现有 `terminal_*` host tools

迁移原则：

- 不破坏现有 `shell_run`。
- 不破坏现有 Workbench terminal tab。
- 第一阶段保持原 IPC 兼容。
- 新 Kernel 能力先作为增强字段返回。
- 等 UI 和 Agent 都迁移后，再移除旧直连 PTY 假设。

## 实施阶段

### Phase 0: 设计冻结和边界确认

产物：

- Terminal Kernel interface spec
- permission taxonomy
- event schema
- screen snapshot schema
- UI routing spec

验收：

- 文档评审通过。
- 明确哪些动作免权限、哪些动作需要审批。
- 明确 private/UI terminal routing。

### Phase 1: Event Journal 和 Cursor 读取

目标：

- 所有输出进入 event journal。
- `terminal_read`/`terminal_wait` 从 journal 读。
- 不再依赖一次性输出 buffer。
- 工具输出经过 token-aware projection gate。
- 超长输出写入本地 cache artifact，并返回可由 Agent 读取的文件路径和摘要。

任务：

- Rust terminal core 增加 event seq。
- 每次 PTY output 写入 event journal。
- `read(cursor, maxBytes)` 返回稳定 cursor。
- `wait(cursor, waitMs)` 在 output/exit/timeout 返回。
- 增加 output token estimator。
- 增加 command output cache writer。
- 增加 output artifact metadata。
- 增加 read hints，让 Agent 用现有 file/search 工具继续理解长输出。

验收：

- 长输出不丢失。
- 多个读者 cursor 互不影响。
- 进程退出无新输出时 `wait` 返回 `reason: exit`。
- 短输出完整 inline 返回。
- 长输出不撑爆上下文，返回 `outputPolicy: cached`、`artifact.textPath`、`estimatedTokens`。
- Agent 可通过 `file_read` 和 `code_search_text` 读取缓存输出并定位错误。

### Phase 2: Screen Model

目标：

- Kernel 维护真实 terminal screen。
- 支持 normal/alternate screen。
- Agent 可读当前可见屏幕。

任务：

- 引入 ANSI parser。
- 维护 cell grid。
- 维护 scrollback。
- 实现 `terminal_screen`。
- 输出 screen diff event。

验收：

- `top`、`vim`、`less`、`pnpm dev` 等场景能读到可见屏幕。
- resize 后 screen 状态正确。
- UI 和 Agent 看到的屏幕一致。

### Phase 3: Input Controller 和语义动作

目标：

- 输入不再是散乱 bytes。
- Agent 操作按语义动作审批和审计。

任务：

- 增加 `terminal_run`。
- 增加 `terminal_input`。
- 增加 `terminal_keys`。
- 增加 bracketed paste。
- input journal 记录语义动作和底层 bytes。

验收：

- Agent 执行命令只需一次授权。
- 多行 paste 稳定进入 shell。
- Ctrl-C、Enter、Tab、Arrow keys 行为可靠。

### Phase 4: Permission Gate

目标：

- Agent 可以请求任何操作。
- Kernel 根据权限策略决定是否执行。

任务：

- 权限风险分类。
- 授权 scope。
- permission ledger。
- UI permission panel 增加 terminal-specific 展示。
- 支持 allow once / this turn / this session / pattern。

验收：

- 读屏免权限。
- 运行命令触发一次权限。
- 同一 turn/session scope 内不重复弹。
- 高危命令二次确认。
- 用户 deny 后 Agent 收到结构化失败。

### Phase 5: Command Tracker 和 Shell Integration

目标：

- 可靠知道命令边界、cwd、exitCode。

任务：

- zsh OSC 133 integration。
- bash/fish 后续补齐。
- commandId。
- prompt snapshot。
- fallback heuristic。

验收：

- 运行命令后可查询 command status。
- exitCode 准确。
- cwd 准确。
- prompt ready 可等待。

### Phase 6: TUI Map/Act

目标：

- Agent 能操作 TUI，而不是只能读 stdout。

任务：

- `terminal_map` 基于 screen regions。
- `terminal_act` 支持 select/confirm/cancel/toggle/type。
- 支持 keyboard-first 操作。
- 后续支持 mouse event。

验收：

- Agent 能操作常见选择型 TUI。
- Agent 能读 active selection。
- Agent 能在 `vim/less/top` 这类 alternate screen 中识别当前模式和退出路径。

### Phase 7: Agent Attachment 和终端内 Agent

目标：

- 支持 Agent attach 到 terminal session。
- 支持在终端中启动子 Agent。

任务：

- attachment manager。
- observe/assist/control/exclusive 模式。
- 子 Agent process metadata。
- nested Agent audit。
- recursion guard。

验收：

- Lyra Agent 可启动 CLI Agent。
- Lyra Agent 可等待子 Agent 输出。
- 用户可接管或停止。
- 权限请求能回到 Lyra permission panel。

### Phase 8: UI 产品化

目标：

- 终端成为强大的软件，而不是简陋面板。

任务：

- command timeline。
- screen search。
- session replay。
- Agent activity overlay。
- audit drawer。
- private terminal open-in-pane。
- terminal session switcher。
- emergency stop。

验收：

- 人类日常使用体验比当前终端明显更强。
- Agent 操作可见、可控、可中断。
- 长任务和 TUI 任务可追踪。

## 测试计划

### Rust Kernel

- PTY create/write/read/close。
- cursor 增量读取。
- long output 不截断。
- process exit wait。
- resize。
- signal。
- event journal persistence。
- screen parser。
- alternate screen。
- command tracker。
- permission gate。

### Desktop Main

- host handlers 注册完整。
- private terminal 不打开 UI pane。
- Follow on 优先 UI terminal pane。
- permission prompt 正确触发。
- scope 授权不重复触发。
- deny 返回结构化错误。
- terminal session cleanup。

### Renderer/UI

- screen diff 渲染。
- tabs/splits/panes。
- permission panel。
- Agent activity overlay。
- takeover/emergency stop。
- private terminal card。
- audit drawer。

### Agent Regression

- `shell_run` 行为不变。
- `terminal_read/wait/list` 免权限。
- `terminal_run/input/keys/signal` 权限正确。
- 长输出 Agent 可通过 cursor 续读。
- 短输出 inline 返回完整内容。
- 超长输出写入本地 cache artifact，不进入模型上下文。
- Agent 可使用现有 file/search 工具读取和搜索 terminal output cache。
- TUI Agent 可读取可见屏幕。
- terminal 中运行 Agent 不造成死循环。

### Real Workflow

- `npm run dev:desktop`
- `cargo test`
- `pnpm install`
- GitHub device auth CLI flow
- npm login
- SSH session
- `vim`
- `less`
- `top`
- interactive installer
- CLI Agent nested run

## 关键验收标准

第一版可称为 Agent-native Terminal，必须满足：

- Agent 可以实时看到终端输出，不会因为工具返回卡住。
- Agent 可以读取当前可见 TUI 屏幕。
- 长输出不会丢失，只会被上下文投影裁剪。
- 长输出会被自动写入本地缓存文件，Agent 像阅读大型项目代码一样搜索和分段读取。
- `terminal_wait` 总是在 output/exit/timeout 返回。
- Agent 执行一条命令只需要一次语义授权。
- 用户能随时 stop/takeover。
- 所有 Agent 输入和命令都有 audit。
- Follow off 私有终端不污染 UI。
- Follow on 操作当前 UI terminal pane。
- 终端内 CLI Agent 可被 Lyra 观察和控制。

## 风险和应对

### 风险 1: Scope 过宽导致安全问题

应对：

- 默认 allow once。
- session/turn scope 需要用户主动选择。
- destructive command 永远要求窄 scope。
- audit drawer 显示所有授权。

### 风险 2: TUI 识别不准

应对：

- 第一阶段只保证屏幕可读和键盘操作。
- region map 标注 confidence。
- 低 confidence 时让 Agent 读屏并使用普通 keys。

### 风险 3: Screen parser 复杂

应对：

- 先选成熟 parser 或小范围实现。
- 用真实 TUI fixture 测试。
- UI 和 Agent 共享同一 screen snapshot，减少双实现。

### 风险 4: 事件日志太大

应对：

- 输出 artifact 化。
- event compaction。
- command-level index。
- 保留 screen snapshots 和可恢复 lineage。

### 风险 5: 多 Agent 控制冲突

应对：

- attachment mode。
- session control lock。
- human takeover 优先。
- exclusive mode 必须明确授权。

## 推荐优先级

最高优先级：

1. Event Journal + Cursor。
2. `terminal_wait` output/exit/timeout 稳定语义。
3. Screen Model。
4. `terminal_run` 语义动作和一次性权限。
5. Follow UI/private routing 固化。

第二优先级：

1. Command Tracker。
2. Shell Integration。
3. Permission scope。
4. Audit drawer。
5. TUI map/act。

第三优先级：

1. Terminal-in-Terminal Agent。
2. Session replay。
3. SSH/remote terminal awareness。
4. Advanced TUI semantic model。

## 结论

Lyra Terminal 应该升级为 Agent-native Terminal Kernel。

这不是为了给 Agent 开一个更大的洞，而是为了让 Agent 能够完整、可靠、实时地操作真实开发环境，同时把所有风险收束到 Lyra 的权限审批、审计、接管和中断流程里。

能力层面目标是无限制，治理层面目标是强约束。

最终形态：

```text
Agent 能做任何终端操作
用户能审批、观察、接管、追责和停止任何终端操作
Terminal Kernel 记录并解释一切
```

这条路线能把 Lyra 终端从简单面板变成真正的 Agent 执行操作系统表面。
