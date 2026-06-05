# Tool Filesystem Agent：混合结构化工具架构设计

## 1. 摘要

现有 AI Agent 架构中，最常见的做法是把所有可用工具以 function calling、JSON schema、XML tool list 或系统提示词的形式一次性注入到模型上下文中。这个方案虽然直接，但存在明显问题：

- 普通对话也要携带大量工具描述，浪费 token。
- 工具数量一多，模型选择工具的成本和出错率都会上升。
- 全量 function calling 方案常把全部工具 schema 每轮注入，导致上下文膨胀。
- 工具说明和系统提示会污染模型上下文，影响正常对话质量。
- 编程 Agent 需要多步感知-行动循环，不能简单依赖外部路由器静默完成任务。

本文提出一种新的 Agent 工具组织方式：**Tool Filesystem Agent**。

核心思想是：

> 不把所有工具一次性塞进模型上下文，而是把工具组织成一个可浏览、可搜索、可逐级展开的虚拟文件系统。模型默认只知道“需要外部能力时可以查看 `/tools`”，普通对话不看工具；只有当任务需要时，才按需展开目录和工具说明。实际执行必须走结构化工具调用通道，禁止从自然语言正文或 Markdown 代码块中解析并执行工具。

这个方案可以理解为：

- 对普通对话：零工具开销。
- 对简单任务：按需发现少量工具。
- 对复杂任务：模型仍然主导推理和多步工具编排。
- 对总控流程：所有工具发现和执行都必须挂在 `../Agent机制/Agent-Runtime-Loop-Protocol.md` 的 RuntimeTurn 下，不能脱离用户消息生命周期单独运行。
- 对高风险动作：由运行时强制权限校验，并按权限模式处理审核或自动批准。
- 对工作台可观察性：文件写入、终端、测试、构建、浏览器和日志工具必须能按 `../Agent机制/Agent-Follow-Protocol.md` 发送实时 Follow 事件，不能只在执行结束后返回结果。
- 对模型接入：优先使用原生 tool calling；无原生能力时必须使用受约束的结构化输出通道；只支持自由文本输出的模型不得执行工具。
- 对非推理模型调用：按 `../Agent机制/Agent-Prompt-Repetition-Mode.md` 默认评估是否启用 Prompt Repetition，但不得重复 system/policy/tool schema 或结构化执行 envelope。
- 对模型协议：按 `../模型协议/Model-Protocol-Support.md` 使用 native adapter 接入云端、本地和离线模型；不得把所有模型协议隐藏转换成 OpenAI-compatible。
- 对可观测性：所有工具操作必须能映射到 trace、artifact、terminal/file stream 和本地操作日志，方便 UI 展示、问题定位和结果复盘。
- 对性能与能力保真：工具系统可以按需加载、缓存、分页和投影，但不得为了速度降低推理深度、上下文事实、工具覆盖、验证门禁、原始结果完整性或安全边界。

---

## 2. 背景：为什么现有方案不够好？

### 2.1 全量工具注入浪费 token

传统 Agent 一般会在每次请求中注入类似内容：

```json
{
  "tools": [
    {
      "name": "read_file",
      "description": "Read a file from the workspace.",
      "parameters": {
        "type": "object",
        "properties": {
          "path": {
            "type": "string",
            "description": "The path to read."
          }
        },
        "required": ["path"]
      }
    },
    {
      "name": "write_file",
      "description": "Write content to a file.",
      "parameters": {
        "...": "..."
      }
    }
  ]
}
````

当工具只有 3 到 5 个时，这还可以接受。

但一个真实 Agent 产品可能有几十甚至上百个工具：

* 文件系统工具
* Shell 工具
* Git 工具
* GitHub 工具
* 数据库工具
* 浏览器工具
* 搜索工具
* 邮件工具
* 日历工具
* Slack / Discord 工具
* Jira / Linear 工具
* 云服务工具
* IDE 工具
* 调试工具
* 部署工具

如果每轮都注入这些工具，即使用户只是说“你好”，模型也要先读一遍工具说明书。这显然不合理。

---

### 2.2 工具多了以后，模型更容易混乱

全量工具注入不仅浪费 token，也会增加模型选择难度。

例如模型同时看到：

```text
search_file
search_code
grep_code
find_symbol
find_references
read_file
open_file
inspect_file
```

模型可能不知道该用哪个。

工具描述越多，模型越容易：

* 选择错误工具。
* 忽略更合适的工具。
* 幻觉不存在的参数。
* 在不该使用工具时使用工具。
* 在应该使用工具时直接猜测。

所以问题不是“模型不知道工具”，而是“模型一次性知道太多工具”。

---

### 2.3 全量 Function Calling 绑定注入成本

OpenAI、Anthropic、Gemini 等平台都有自己的 tool calling 格式，这类结构化调用能力本身是有价值的，也应该作为生产执行通道的首选。

问题不在于 function calling，而在于把所有工具 schema 每轮全量注入：

* 工具越多，schema 注入成本越高。
* 长尾工具污染普通对话上下文。
* 模型需要在大量无关工具中做选择。
* 工具版本变化会扩大提示词和 schema 管理成本。

Tool Filesystem 的目标不是绕开结构化调用，而是：

> 保留结构化执行通道，同时把工具发现和工具 schema 展开改成按需加载。

因此，生产执行必须满足以下要求：

* 支持原生 tool calling 的模型：使用原生 tool call 承载 `tool_fs.list`、`tool_fs.inspect`、`tool_fs.run` 等元操作。
* 不支持原生 tool calling 但支持严格 JSON/schema 输出的模型：通过受约束解码或结构化输出生成 `ToolOperationEnvelope`。
* 只支持自由文本输出、无法稳定产生结构化操作的模型：不得执行工具，只能用于普通对话或由网关升级到支持结构化调用的模型。
* Prompt Repetition 只作用于模型输入编译层，不改变工具调用通道；重复后的自然语言正文不得被解析成工具调用。
* 模型协议适配由 Model Gateway 负责，Tool Runtime 不应承担 provider 协议转换。

---

### 2.4 编程 Agent 不能完全靠“幽灵工具”

对于天气、汇率、网页搜索这类简单任务，可以由外部路由层静默完成工具调用，然后把结果注入给模型。

但编程 Agent 不一样。

例如用户说：

```text
把这个 React 组件里的 fetch 封装成自定义 hook，并加上错误重试逻辑。
```

这不是一次简单工具调用，而是一个多步任务：

```text
读文件
→ 理解代码结构
→ 找相关组件
→ 设计 hook
→ 修改文件
→ 跑 lint
→ 看报错
→ 再修正
→ 跑测试
→ 总结修改
```

这种任务需要模型深度参与每一步决策。

因此，工具系统既不能全量注入，也不能完全隐藏在后台。更合理的方式是：

> 模型知道可以寻找工具，但只有需要时才去寻找；找到工具后，模型仍然主导工具组合和推理过程。

---

## 3. 核心理念

Tool Filesystem Agent 的核心理念是：

> 工具不是一次性注入的 schema，而是一个模型可以按需浏览的能力空间。

也就是说，工具系统应该像操作系统里的文件系统一样：

```text
/tools
  /filesystem
  /code
  /shell
  /git
  /github
  /web
  /database
  /email
  /calendar
```

模型一开始不需要知道每个目录里具体有什么工具。

它只需要知道：

```text
如果任务需要外部能力，可以浏览 /tools。
普通对话不需要浏览工具目录。
只能使用 /tools 中明确存在的工具。
```

这就把工具发现从：

```text
一次性注入所有工具
```

变成：

```text
按需查看工具目录
```

---

## 4. 这个方案是什么？

### 4.1 一句话定义

**Tool Filesystem Agent** 是一种将工具组织成虚拟文件系统的 Agent 架构。

模型可以通过少量结构化元操作浏览工具空间：

```text
tool_fs.list       { path }       查看目录
tool_fs.read_doc   { path }       阅读说明
tool_fs.inspect    { path }       查看工具详情
tool_fs.run        { path, args } 调用工具
```

模型初始只知道这些元操作，以及 `/tools` 这个入口。元操作必须由结构化调用承载，不允许写在正文里让运行时解析执行。

---

### 4.2 和传统工具调用的区别

传统方式：

```text
用户消息
+ 全部工具 schema
+ 系统提示
→ LLM
→ 选择工具
→ 调用工具
```

Tool Filesystem 方式：

```text
用户消息
+ 极简基础提示
→ LLM

如果不需要工具：
  直接回答

如果需要工具：
  tool_fs.list    { path: "/tools" }
  tool_fs.list    { path: "/tools/code" }
  tool_fs.inspect { path: "/tools/code/search_code" }
  tool_fs.run     { path: "/tools/code/search_code", args: { query: "fetch(" } }
```

关键区别：

| 维度       | 传统工具注入              | Tool Filesystem |
| -------- | ------------------- | --------------- |
| 工具可见性    | 全部工具默认可见            | 按需可见            |
| token 成本 | 每轮固定高成本             | 普通对话接近 0        |
| 工具数量扩展   | 工具越多越臃肿             | 工具可无限分类扩展       |
| 执行通道      | 全量 function calling | 原生 tool call 或结构化 envelope |
| 普通聊天体验   | 容易被系统提示污染           | 更接近裸模型聊天        |
| 复杂任务能力   | 强                   | 强               |
| 工具发现方式   | 靠模型在上下文中扫描          | 像浏览目录一样逐步发现     |

---

## 5. 为什么要这么做？

### 5.1 降低 token 浪费

普通对话不需要工具。

例如：

```text
用户：你好
助手：你好！有什么我可以帮你的？
```

在 Tool Filesystem 架构下，模型不会看到任何工具列表。

只有当用户说：

```text
帮我看看 src/App.tsx 里哪里用了 fetch。
```

模型才需要进入工具目录：

```text
tool_fs.list    { path: "/tools" }
tool_fs.list    { path: "/tools/code" }
tool_fs.inspect { path: "/tools/code/search_code" }
tool_fs.run     { path: "/tools/code/search_code", args: { query: "fetch(" } }
```

这使得工具成本从“每轮固定支出”变成“按需支出”。

---

### 5.2 避免工具描述污染上下文

大模型的上下文空间很宝贵。

如果系统提示里塞满工具描述，模型在生成自然语言回答时可能受到干扰。

例如用户问：

```text
什么是闭包？
```

模型本来可以直接解释。

但如果上下文里有几十个工具描述，模型可能会过度考虑是否要搜索、是否要读文件、是否要执行命令。

Tool Filesystem 可以让模型在普通知识问答中保持干净上下文。

---

### 5.3 支持大规模工具生态

随着 Agent 能力扩展，工具数量会不断增加。

全量注入不适合大规模工具生态。

Tool Filesystem 可以像操作系统一样组织工具：

```text
/tools
  /code
    search_code
    find_references
    get_symbols
    analyze_dependencies

  /git
    status
    diff
    log
    branch
    commit

  /github
    search_issues
    read_pr
    create_pr
    comment_pr

  /database
    list_tables
    describe_table
    query
    explain_query
```

模型不必一次性知道所有工具，只需要进入相关目录。

---

### 5.4 更符合人类使用工具的方式

人类不会一开始背下所有工具说明。

人类通常是：

```text
我知道电脑里有应用。
我需要编辑图片时，去找图像工具。
我需要查代码时，去找 IDE 或搜索工具。
我需要发邮件时，打开邮件应用。
```

Tool Filesystem 让模型也这样工作：

```text
我需要外部能力。
我去 /tools 看看有哪些类别。
我进入相关类别。
我阅读具体工具说明。
我调用工具。
```

这种方式比一次性把所有 API 文档塞给模型更自然。

---

### 5.5 混合结构化执行

Tool Filesystem 不要求把所有业务工具都暴露成模型平台的原生工具，但执行通道必须是结构化的。

支持两种生产形态：

1. **原生 tool calling 适配**  
   平台只暴露少量元工具，例如 `tool_fs.list`、`tool_fs.inspect`、`tool_fs.run`。具体业务工具不全量注入，而是在 `/tools` 内按需展开。

2. **结构化输出适配**  
   对不支持原生 tool calling 但支持严格 JSON/schema 输出的模型，要求它生成 `ToolOperationEnvelope`，并由 Validator 做 schema 校验。

禁止形态：

* 不允许从普通自然语言正文中解析工具调用。
* 不允许用 Markdown fenced block 作为执行协议。
* 不允许只支持自由文本输出的模型直接执行工具。

这样既保留 Tool Filesystem 的懒加载优势，又避免自由文本解析带来的误执行、注入攻击和解析歧义。

---

## 6. 系统架构

整体架构如下：

```text
User
  ↓
Runtime Loop Controller
  ↓
Context / Prompt Compiler
  ↓
LLM
  ↓
Structured Tool Call Adapter
  ↓
Tool Filesystem Runtime
  ↓
Tool Inspector
  ↓
Policy Gate
  ↓
Tool Executor
  ↓
Follow Event Broker
  ↓
Result Compressor
  ↓
Runtime Loop Controller
  ↓
LLM
  ↓
User
```

---

### 6.1 Base Prompt

基础提示词非常短，但不提供可执行文本语法。

示例：

```text
你是一个有帮助的 AI 助手。

普通知识、解释、写作和闲聊请直接回答。

当任务需要当前环境、文件、代码、网页、账号、命令输出、外部系统或实时信息时，不要猜测；你可以浏览 /tools 发现可用能力。

只能使用 /tools 中明确存在的工具。
普通对话不要浏览工具目录。
高风险操作必须按权限模式处理：`sandbox` 下请求用户审核，`full_access` 下自动批准并写本地操作日志。

工具执行必须通过系统提供的结构化工具调用通道完成，不得在正文或 Markdown 代码块中书写可执行工具调用。
```

这个提示词不会包含任何具体业务工具 schema。运行时仅暴露少量元工具 schema，例如 `tool_fs.list`、`tool_fs.read_doc`、`tool_fs.inspect`、`tool_fs.run`。

---

### 6.2 Tool Filesystem Runtime

Tool Filesystem Runtime 负责维护虚拟目录结构。

示例：

```text
/tools
  README.md
  /filesystem
    README.md
    list_files.tool
    read_file.tool
    apply_patch.tool
    write_file.tool

  /code
    README.md
    search_code.tool
    find_references.tool
    get_symbols.tool

  /shell
    README.md
    run_command.tool

  /git
    README.md
    status.tool
    diff.tool
    log.tool

  /web
    README.md
    search_web.tool
    open_url.tool

  /github
    README.md
    read_pr.tool
    search_issues.tool
    create_pr.tool
```

模型看到的不是完整真实文件，而是 runtime 生成的虚拟目录视图。

---

### 6.3 Tool Inspector

当模型通过结构化通道发起 `op=inspect, path=/tools/code/search_code` 时，系统返回该工具的详细说明。

```yaml
name: search_code
path: /tools/code/search_code
description: Search source code in the current workspace.
args:
  query:
    type: string
    required: true
    description: Text or regex-like query to search for.
  path:
    type: string
    required: false
    description: Optional directory to limit the search.
returns:
  type: list
  description: List of matching files and line snippets.
risk:
  level: low
  side_effect: none
permission:
  requires_confirmation: false
examples:
  - op: run
    path: /tools/code/search_code
    args:
      query: "fetch("
```

只有当模型真的需要某个工具时，才读取这部分内容。

---

### 6.4 Policy Gate

所有工具调用都必须经过 Policy Gate。

即使模型发起 `op=run, path=/tools/shell/run_command, args={"cmd":"rm -rf /"}`，系统也不能直接执行。

权限环境由 Lyra 的工具权限模式和项目级默认策略定义：

- `sandbox`：默认受限环境；需要非沙盒能力时请求用户审核，临时退出一次，执行后回到 sandbox。
- `full_access`：完全访问环境；不向用户发起确认，本应确认的动作自动批准并写本地操作日志。

Policy Gate 需要判断：

* 当前工具调用是否绑定有效 RuntimeTurn。
* 当前 RuntimeTurn 是否绑定当前项目策略快照。
* 工具是否存在。
* 参数是否合法。
* 是否越权访问路径。
* 是否命中 workspace scope、工具开关、网络和模型/工具项目策略。
* 是否会修改工作区或启动/停止进程。
* 是否是高风险命令。
* 是否涉及 secret、env、SSH key、敏感文件、模型输入或外部发送。
* 是否需要 Security Gate 执行扫描、脱敏、SecretHandle 注入或外泄阻断。
* 是否需要先按 `../Agent机制/Context-Reference-Protocol.md` 解析用户消息中的光标位置引用。
* 是否需要先按 `../Agent机制/Agent-Clarification-Protocol.md` 拉起 Clarification Panel 提问。
* 是否需要按 `../Agent机制/Agent-Planning-Mode.md` 创建、核对或等待已批准计划。
* 是否需要按 `../Agent机制/Agent-Todo-Protocol.md` 创建 plan_bound Todo 或 mini Todo。
* 是否需要按 `../Agent机制/Agent-Native-Long-Work-Protocol.md` 创建 LongWorkRun、检测早停并自动续跑。
* 是否需要按 `../Agent机制/Agent-Follow-Protocol.md` 创建 FollowSession、绑定 FollowTarget 或开启 LiveEditStream。
* 是否需要用户审核或 full_access 自动批准。
* 是否需要在沙箱中执行。
* 是否需要限制输出长度。

---

### 6.5 Tool Executor

Tool Executor 负责执行真实工具。

例如，`op=run, path=/tools/filesystem/read_file, args={"path":"src/App.tsx"}` 会映射到内部函数：

```ts
readFileFromWorkspace("src/App.tsx")
```

执行结果再返回给模型：

```text
[Tool Output: /tools/filesystem/read_file]

File: src/App.tsx

1 | import React from "react";
2 | ...
```

对于会产生用户可见过程的工具，Executor 还必须向 Follow Event Broker 发送结构化事件：

- 文件写入和代码编辑：`live_edit_started`、`live_edit_delta`、`live_edit_committed`。
- 终端、测试、构建、lint、日志：输出 delta 必须边产生边发送。
- 浏览器操作：页面、焦点、点击、输入、等待和截图事件必须可跟随。

这些 Follow 事件只用于工作区实时渲染，不能替代真实工具结果、diff、checkpoint 或本地操作记录。

---

### 6.6 Result Compressor

工具结果不能无脑塞回模型。

例如搜索代码返回 500 个结果时，不能全部注入上下文。

Result Compressor 需要做：

* 限制输出条数。
* 保留最相关片段。
* 提供下一步展开入口。
* 给每个结果分配引用 ID。
* 支持分页或按文件展开。
* 对长文件做摘要或局部读取。

示例：

```text
[Tool Output: /tools/code/search_code]

Found 23 matches. Showing top 5.

1. src/App.tsx:42
   fetch("/api/user")

2. src/hooks/useUser.ts:18
   fetch(USER_ENDPOINT)

3. src/services/api.ts:77
   return fetch(url, options)

Use op=run with /tools/filesystem/read_file or /tools/filesystem/read_range for details.
```

---

## 7. 工具目录设计

### 7.1 顶层目录

推荐顶层结构：

```text
/tools
  README.md
  /filesystem
  /code
  /shell
  /git
  /github
  /web
  /database
  /package
  /browser
  /email
  /calendar
  /memory
  /project
```

---

### 7.2 顶层目录返回内容

当模型通过结构化通道发起 `op=list, path=/tools` 时：

不要返回冗长说明，只返回类别摘要：

```text
/tools/filesystem - read and modify workspace files
/tools/code - search and analyze source code
/tools/shell - run commands in a sandbox
/tools/git - inspect local git state
/tools/github - work with issues, PRs, and repos
/tools/web - search and open web pages
/tools/database - inspect and query databases
/tools/package - inspect dependencies and package metadata
/tools/browser - interact with browser pages
/tools/email - search, draft, and send emails
/tools/calendar - search and create calendar events
```

这层必须短。

---

### 7.3 子目录返回内容

当模型通过结构化通道发起 `op=list, path=/tools/filesystem` 时：

返回：

```text
/tools/filesystem/list_files - list files and directories
/tools/filesystem/read_file - read a text file
/tools/filesystem/read_range - read part of a text file
/tools/filesystem/apply_patch - modify files using a patch
/tools/filesystem/write_file - write a full file, mostly for new files
```

仍然不要返回完整 schema。

---

### 7.4 工具详情格式

工具详情建议使用 YAML 或简化 JSON。

示例：

```yaml
name: apply_patch
path: /tools/filesystem/apply_patch
description: Modify workspace files using a unified patch.
args:
  patch:
    type: string
    required: true
    description: Patch text in unified diff format.
returns:
  type: object
  fields:
    success: boolean
    changed_files: string[]
    diff_summary: string
risk:
  level: medium
  side_effect: modifies_workspace
permission:
  requires_confirmation: false
rules:
  - Prefer this over write_file when editing existing files.
  - The patch must only touch files inside the workspace.
  - The runtime will reject path traversal.
examples:
  - |
    op: run
    path: /tools/filesystem/apply_patch
    args:
      "patch": "*** Begin Patch\n*** Update File: src/App.tsx\n..."
```

---

## 8. 结构化调用协议

### 8.1 禁止纯文本执行

工具调用不得从模型自然语言正文、Markdown 代码块或任意自由文本中解析执行。

禁止：

* 解析普通回答里的工具函数样式片段。
* 解析 Markdown fenced block 作为工具调用。
* 让模型通过“约定格式文本”绕过 schema、权限和执行记录。

允许：

* 平台原生 tool call。
* 受约束解码生成的结构化 JSON。
* 由运行时创建并验证的内部 operation envelope。

### 8.2 ToolOperationEnvelope

所有工具元操作统一归一到 `ToolOperationEnvelope`：

```ts
type ToolFsOp = "list" | "read_doc" | "inspect" | "run";

interface ToolOperationEnvelope {
  schema_version: "v1";
  op_id: string;
  session_id: string;
  runtime_turn_id: string;
  execution_run_id?: string;
  project_id?: string;
  op: ToolFsOp;
  path: string;
  args?: Record<string, unknown>;
  tool_handle?: string;
  idempotency_key?: string;
  policy_snapshot_id: string;
  permission_mode: "sandbox" | "full_access";
  approval_ticket_id?: string;
  security_decision_id?: string;
  checkpoint_id?: string;
  trace_id?: string;
  timeout_ms?: number;
  cancellation_token_id?: string;
  risk_context?: {
    user_visible_summary: string;
    expected_side_effect:
      | "none"
      | "workspace_write"
      | "external_write"
      | "system_change"
      | "database_write"
      | "process_change";
    affected_paths?: string[];
    affected_external_targets?: string[];
    reversible?: boolean;
  };
  output_contract?: {
    max_bytes?: number;
    max_items?: number;
    require_artifact: boolean;
    stream_follow: boolean;
    redaction_required: boolean;
  };
  created_at: string;
}
```

字段规则：

- `runtime_turn_id` 必填，工具调用不能脱离用户消息生命周期。
- `policy_snapshot_id` 必填，确保工具调用按当时的项目策略执行。
- 写操作和高风险命令应绑定 `checkpoint_id` 或留下可对照的 diff/log。
- 需要审批的动作必须绑定 `approval_ticket_id`，自动批准也必须有记录。
- 涉及 secret、敏感文件或模型输入外发的动作必须绑定 `security_decision_id`。
- `output_contract` 决定工具结果如何压缩、是否生成 artifact、是否进入 Follow 流。
- 本文后续 JSON 示例为了阅读简洁，可能省略 `runtime_turn_id`、`policy_snapshot_id`、`permission_mode` 等 Runtime 自动补全字段；真实进入 Validator 的 envelope 必须是完整形态。

元操作含义：

| 操作 | 作用 |
|---|---|
| `list` | 查看 `/tools` 目录或子目录 |
| `read_doc` | 阅读目录 README 或工具文档 |
| `inspect` | 获取单个工具 manifest |
| `run` | 调用具体工具 |

### 8.3 执行通道

执行通道优先级：

1. 原生 tool calling：模型调用 `tool_fs` 元工具，由平台返回结构化参数。
2. 结构化输出：模型只能输出符合 schema 的 `ToolOperationEnvelope`。
3. 内部 fast path：对已确认的低风险固定动作，系统可直接生成 envelope。

自由文本输出不能进入执行链。若模型只返回正文，Runtime 必须把它当成普通回答，不得尝试解析工具意图。

### 8.4 示例流程

用户：

```text
帮我看看这个项目里哪里用了 fetch。
```

模型通过结构化通道发起：

```json
{
  "schema_version": "v1",
  "op_id": "op_001",
  "session_id": "s_123",
  "op": "list",
  "path": "/tools",
  "created_at": "2026-01-01T00:00:00Z"
}
```

系统返回：

```text
/tools/filesystem - read and modify workspace files
/tools/code - search and analyze source code
/tools/shell - run commands
```

模型继续发起：

```json
{
  "schema_version": "v1",
  "op_id": "op_002",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/code/search_code",
  "args": {
    "query": "fetch("
  },
  "created_at": "2026-01-01T00:00:01Z"
}
```

系统返回搜索结果，模型再用自然语言回答用户。

---

## 9. 工具发现策略

### 9.1 目录浏览

适合模型知道大概类别时。

例如：

```text
查代码 → /tools/code
读文件 → /tools/filesystem
跑测试 → /tools/shell
看 PR → /tools/github
```

---

### 9.2 工具搜索

当工具很多时，光靠目录浏览可能太慢。

可以加入一个特殊工具：

```text
/tools/search
```

调用方式：通过结构化通道发送 `op=run, path=/tools/search` 的 envelope。

返回：

```text
Recommended tools:
1. /tools/code/search_code - search source code by query
2. /tools/code/find_references - find references to a symbol
3. /tools/filesystem/read_file - read a specific file
```

注意：`/tools/search` 只帮助发现工具，不执行真实业务动作。

`/tools/search` 不能依赖自然语言关键词词表。推荐信号：

* tool manifest 的能力标签。
* 输入/输出 schema 相似度。
* 当前任务类型和上下文状态。
* 工具风险等级与权限范围。
* 多语言语义 embedding。

---

### 9.3 常用工具缓存

一旦模型 inspect 过某个工具，runtime 可以给它一个短 handle。

例如：

```text
T1 = /tools/code/search_code
T2 = /tools/filesystem/read_file
T3 = /tools/filesystem/apply_patch
```

后续模型可以在结构化 envelope 中使用 `tool_handle: "T1"`，减少重复路径 token。

这样减少重复路径 token。

---

### 9.4 会话内工具 pinning

对于编程 Agent，可以把高频工具 pin 到当前会话的短工具栏：

```text
Pinned tools:
T_read = /tools/filesystem/read_file
T_patch = /tools/filesystem/apply_patch
T_search = /tools/code/search_code
T_shell = /tools/shell/run_command
```

模型后续无需反复浏览目录。

---

## 10. 安全设计

### 10.1 工具风险等级

每个工具必须有风险等级。

```text
low      只读、无隐私、不会修改本地状态
medium   修改本地工作区、创建草稿、运行安全命令
high     外部通信、删除、支付、部署、发邮件、发布内容
critical 涉及密钥、系统权限、生产数据库、不可逆操作
```

---

### 10.2 示例风险分类

| 工具                              | 风险            | 原因        |
| ------------------------------- | ------------- | --------- |
| `/tools/code/search_code`       | low           | 只读        |
| `/tools/filesystem/read_file`   | low / medium  | 取决于文件权限   |
| `/tools/filesystem/apply_patch` | medium        | 修改工作区     |
| `/tools/shell/run_command`      | high          | 可执行任意命令   |
| `/tools/email/draft_email`      | medium        | 创建草稿      |
| `/tools/email/send_email`       | high          | 外部通信      |
| `/tools/database/query`         | medium / high | 取决于数据库和语句 |
| `/tools/deploy/publish`         | critical      | 生产发布      |

---

### 10.3 Runtime 强制约束

不能只靠模型遵守规则。

Runtime 必须强制：

* 白名单工具路径。
* 参数 schema 校验。
* 路径沙箱。
* 命令安全检查。
* 输出长度限制。
* 写操作 diff 记录。
* 高风险操作审核或自动批准。
* 凭据和密钥脱敏。
* 网络访问域名限制。
* 数据库只读模式。
* 本地操作日志。

---

### 10.4 高风险操作审核

例如模型想发邮件：

```json
{
  "schema_version": "v1",
  "op_id": "op_send_email",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/email/send_email",
  "args": {
  "to": "alice@example.com",
  "subject": "Meeting update",
  "body": "Let's move the meeting to tomorrow."
  },
  "risk_context": {
    "user_visible_summary": "Send an email to alice@example.com",
    "expected_side_effect": "external_write"
  },
  "created_at": "2026-01-01T00:00:00Z"
}
```

Runtime 不应直接发送。

应该返回：

```text
This action requires user confirmation.

Prepared email:
To: alice@example.com
Subject: Meeting update
Body:
Let's move the meeting to tomorrow.

Ask for approval before sending when permission mode is sandbox.
```

模型再问用户：

```text
我已准备好邮件，内容如下。确认发送吗？
```

在 `sandbox` 下，只有用户确认后 Runtime 才允许执行。  
在 `full_access` 下，Runtime 不询问用户，自动批准并记录 `permission.auto_approved_by_full_access`。

---

## 11. 编程 Agent 中的推荐工具集

### 11.1 Filesystem

```text
/tools/filesystem/list_files
/tools/filesystem/read_file
/tools/filesystem/read_range
/tools/filesystem/apply_patch
/tools/filesystem/write_file
/tools/filesystem/delete_file
```

建议：

* 修改已有文件优先用 `apply_patch`。
* `write_file` 主要用于新建文件。
* `delete_file` 必须谨慎，并按权限模式处理审核或自动批准。

---

### 11.2 Code

```text
/tools/code/search_code
/tools/code/find_references
/tools/code/get_symbols
/tools/code/analyze_imports
/tools/code/diagnostics
```

用于：

* 查找函数调用。
* 找引用。
* 读取符号表。
* 理解代码结构。
* 获取 IDE 诊断信息。

---

### 11.3 Shell

```text
/tools/shell/run_command
/tools/shell/check_command_safety
```

建议：

* `run_command` 必须运行在沙箱。
* 禁止危险命令。
* 对 `rm`, `sudo`, `curl | sh`, `chmod`, `git reset --hard` 等命令做强拦截。
* 对测试命令、lint 命令、构建命令设置超时。

---

### 11.4 Git

```text
/tools/git/status
/tools/git/diff
/tools/git/log
/tools/git/branch
/tools/git/show
```

用于：

* 查看修改。
* 生成总结。
* 辅助代码审查。
* 回滚前查看 diff。

---

### 11.5 GitHub

```text
/tools/github/read_pr
/tools/github/read_issue
/tools/github/search_issues
/tools/github/comment_pr
/tools/github/create_pr
```

其中：

* `read_pr`, `read_issue`, `search_issues` 是低风险或中风险。
* `comment_pr`, `create_pr` 是高风险，必须按权限模式处理审核或自动批准。

---

## 12. 工作流示例

### 12.1 普通闲聊

用户：

```text
你好
```

模型：

```text
你好！有什么我可以帮你的？
```

不触发 `/tools`。

---

### 12.2 代码搜索

用户：

```text
这个项目里哪里用了 fetch？
```

模型：

```json
{
  "schema_version": "v1",
  "op_id": "op_001",
  "session_id": "s_123",
  "op": "list",
  "path": "/tools",
  "created_at": "2026-01-01T00:00:00Z"
}
```

系统返回：

```text
/tools/code - search and analyze source code
/tools/filesystem - read and modify files
```

模型：

```json
{
  "schema_version": "v1",
  "op_id": "op_002",
  "session_id": "s_123",
  "op": "list",
  "path": "/tools/code",
  "created_at": "2026-01-01T00:00:01Z"
}
```

系统返回：

```text
/tools/code/search_code - search code by query
```

模型：

```json
{
  "schema_version": "v1",
  "op_id": "op_003",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/code/search_code",
  "args": {
    "query": "fetch("
  },
  "created_at": "2026-01-01T00:00:02Z"
}
```

系统返回结果。

模型回答：

```text
我找到了 3 处 fetch 调用：
1. src/App.tsx:42
2. src/hooks/useUser.ts:18
3. src/services/api.ts:77

主要封装点可能在 src/services/api.ts，因为它已经承担 API 请求逻辑。
```

---

### 12.3 修改代码并运行测试

用户：

```text
把 App.tsx 里的 fetch 封装成 useUser hook。
```

模型流程：

```json
{
  "schema_version": "v1",
  "op_id": "op_read_app",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/filesystem/read_file",
  "args": {
    "path": "src/App.tsx"
  },
  "created_at": "2026-01-01T00:00:00Z"
}
```

读取后：

```json
{
  "schema_version": "v1",
  "op_id": "op_patch_app",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/filesystem/apply_patch",
  "args": {
  "patch": "*** Begin Patch\n*** Add File: src/hooks/useUser.ts\n...\n*** Update File: src/App.tsx\n...\n*** End Patch"
  },
  "risk_context": {
    "user_visible_summary": "Modify App.tsx and add useUser hook",
    "expected_side_effect": "workspace_write"
  },
  "created_at": "2026-01-01T00:00:01Z"
}
```

然后：

```json
{
  "schema_version": "v1",
  "op_id": "op_test",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/shell/run_command",
  "args": {
    "cmd": "npm test"
  },
  "created_at": "2026-01-01T00:00:02Z"
}
```

如果测试失败，模型读取报错，继续修复。

---

### 12.4 高风险命令

用户：

```text
清理这个项目里所有没用的文件。
```

模型可能想执行：

```json
{
  "schema_version": "v1",
  "op_id": "op_clean",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/shell/run_command",
  "args": {
    "cmd": "rm -rf unused/*"
  },
  "risk_context": {
    "user_visible_summary": "Delete files under unused/",
    "expected_side_effect": "workspace_write"
  },
  "created_at": "2026-01-01T00:00:00Z"
}
```

Runtime 应该拦截：

```text
Command blocked: destructive command requires confirmation and a concrete file list.
```

模型应改为：

```json
{
  "schema_version": "v1",
  "op_id": "op_list_files",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/filesystem/list_files",
  "args": {
    "path": "."
  },
  "created_at": "2026-01-01T00:00:01Z"
}
```

然后先列出候选文件，并按权限模式处理审核或自动批准。

---

## 13. 和其他方案对比

### 13.1 和全量 Function Calling 对比

| 维度        | 全量 Function Calling | Tool Filesystem |
| --------- | ------------------- | --------------- |
| token 成本  | 高                   | 低               |
| 工具发现      | 一次性注入               | 按需浏览            |
| 工具数量扩展    | 差                   | 好               |
| 执行通道      | 平台原生工具调用            | 原生工具调用或结构化 envelope |
| schema 校验 | 强                   | Runtime 强制校验     |
| 安全性       | 平台可辅助               | runtime 必须强     |
| 适合复杂任务    | 适合                  | 适合              |

---

### 13.2 和 Ghost Tools 对比

| 维度       | Ghost Tools | Tool Filesystem  |
| -------- | ----------- | ---------------- |
| 模型是否知道工具 | 基本不知道       | 知道可以按需发现         |
| 简单查询     | 很适合         | 适合               |
| 多步编程任务   | 不适合         | 适合               |
| 工具编排     | 外部路由主导      | 模型主导             |
| 安全控制     | 外部系统        | 外部系统 + 模型可见风险    |
| 适合场景     | 天气、搜索、汇率    | 编程、企业 Agent、复杂任务 |

---

### 13.3 和 Code-as-Tool 对比

| 维度         | Code-as-Tool | Tool Filesystem |
| ---------- | ------------ | --------------- |
| 工具形式       | 函数调用         | 文件系统目录 + 工具     |
| 模型是否知道工具名  | 需要知道或猜测      | 可按需发现           |
| 幻觉工具风险     | 较高           | 较低              |
| token 成本   | 很低           | 低               |
| 可扩展性       | 中等           | 高               |
| 适合编程 Agent | 很适合          | 很适合             |
| 适合长尾工具     | 一般           | 更好              |

---

## 14. MVP 设计

### 14.1 第一版目标

MVP 不需要支持所有工具。

建议先实现：

```text
/tools
  search

  /filesystem
    list_files
    read_file
    apply_patch

  /code
    search_code

  /shell
    run_command
```

这已经能支持大部分编程 Agent 基础能力：

* 查看项目结构。
* 搜索代码。
* 读取文件。
* 修改文件。
* 运行测试或 lint。
* 根据报错继续修复。

---

### 14.2 MVP 调用通道

基础提示词：

````text
你是一个编程助手。

普通解释和闲聊直接回答。
当任务需要查看或修改当前项目时，通过系统提供的结构化工具调用通道请求工具。

可用元操作：
tool_fs.list, tool_fs.inspect, tool_fs.run

工具入口：/tools
只能调用 /tools 中明确存在的工具。
修改已有文件优先使用 apply_patch。
危险命令必须按权限模式处理审核或自动批准。
禁止在正文或 Markdown 代码块中书写可执行工具调用。
````

---

### 14.3 MVP 工具详情示例

```yaml
name: read_file
path: /tools/filesystem/read_file
args:
  path:
    type: string
    required: true
returns:
  content: string
risk:
  level: low
```

```yaml
name: apply_patch
path: /tools/filesystem/apply_patch
args:
  patch:
    type: string
    required: true
returns:
  success: boolean
  changed_files: string[]
risk:
  level: medium
```

```yaml
name: run_command
path: /tools/shell/run_command
args:
  cmd:
    type: string
    required: true
returns:
  stdout: string
  stderr: string
  exit_code: number
risk:
  level: high
rules:
  - destructive commands require confirmation
  - command runs inside workspace sandbox
  - timeout is enforced
```

---

## 15. 实现建议

### 15.1 Structured Tool Call Adapter

负责接收结构化调用并归一化为 `ToolOperationEnvelope`。

输入来源只能是：

* 平台原生 tool call 参数。
* 受约束结构化输出生成的 JSON。
* Runtime 内部 fast path 生成的 envelope。

示例 envelope：

```json
{
  "schema_version": "v1",
  "op_id": "op_001",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/code/search_code",
  "args": {
    "query": "fetch("
  },
  "created_at": "2026-01-01T00:00:00Z"
}
```

Adapter 禁止解析模型正文、Markdown、XML 片段或任意自由文本。

---

### 15.2 Validator

Validator 负责校验：

* 是否是允许的元操作。
* envelope 是否符合 `schema_version`。
* `runtime_turn_id`、`policy_snapshot_id`、`permission_mode` 是否存在且有效。
* `op_id` 和 `idempotency_key` 是否满足幂等要求。
* path 是否存在。
* args 是否符合 schema。
* 是否有路径穿越。
* 是否尝试访问未授权目录。
* 是否超过调用次数限制。
* `tool_handle` 是否仍然有效，是否因工具版本变化或权限变化失效。
* `output_contract` 是否符合工具 manifest 和项目策略。

---

### 15.3 Executor

Executor 将虚拟工具映射到真实实现。

例如：

```ts
const registry = {
  "/tools/filesystem/read_file": readFileTool,
  "/tools/filesystem/apply_patch": applyPatchTool,
  "/tools/code/search_code": searchCodeTool,
  "/tools/shell/run_command": runCommandTool
};
```

---

### 15.4 Output Formatter

不要把原始输出直接丢给模型。

需要格式化：

```text
[Tool Output]
tool: /tools/code/search_code
status: success

Found 3 matches:
...
```

错误也要清晰：

```text
[Tool Error]
tool: /tools/filesystem/read_file
error: FileNotFound
message: src/App.tsx does not exist.
suggestion: Use list_files(".") to inspect the project structure.
```

好的错误消息可以让模型自我修正。

---

### 15.5 Tool Runtime 状态机

工具执行不是“模型发 JSON 后直接跑函数”。所有工具操作必须进入统一状态机：

```text
requested
  -> normalized
  -> validated
  -> policy_checked
  -> security_checked
  -> approval_checked
  -> checkpoint_created
  -> executing
  -> streaming(optional)
  -> result_compressed
  -> artifact_recorded
  -> operation_logged
  -> completed

failure path:
  -> rejected / blocked / failed / cancelled / timeout
```

每个状态必须可落库或写入本地操作日志：

```ts
type ToolOperationStatus =
  | "requested"
  | "normalized"
  | "validated"
  | "policy_checked"
  | "security_checked"
  | "approval_checked"
  | "checkpoint_created"
  | "executing"
  | "streaming"
  | "result_compressed"
  | "artifact_recorded"
  | "operation_logged"
  | "completed"
  | "rejected"
  | "blocked"
  | "failed"
  | "cancelled"
  | "timeout";

interface ToolOperationRecord {
  schema_version: "v1";
  op_id: string;
  session_id: string;
  runtime_turn_id: string;
  status: ToolOperationStatus;
  envelope_ref: string;
  result_ref?: string;
  artifact_refs: string[];
  approval_ticket_id?: string;
  security_decision_id?: string;
  checkpoint_id?: string;
  trace_id?: string;
  started_at?: string;
  completed_at?: string;
}
```

状态机规则：

- `validated` 之前不得执行任何真实工具。
- `policy_checked` 失败必须返回结构化拒绝，不交给模型自由解释。
- `security_checked` 可以产生 redacted projection、SecretHandle、local-only route 或 deny。
- `approval_checked` 在 `sandbox` 下可能阻断等待用户，在 `full_access` 下记录自动批准。
- `checkpoint_created` 对工作区写操作是强制状态。
- `operation_logged` 必须在 completed/failed/cancelled 之前完成或同步补写。

---

### 15.6 ToolResultEnvelope

工具结果必须统一为结构化结果，不能只返回一段文本。

```ts
type ToolResultStatus =
  | "success"
  | "partial_success"
  | "error"
  | "blocked"
  | "cancelled"
  | "timeout";

interface ToolResultEnvelope {
  schema_version: "v1";
  result_id: string;
  op_id: string;
  session_id: string;
  runtime_turn_id: string;
  status: ToolResultStatus;
  tool_path: string;
  summary: string;
  data_ref?: string;
  projection_ref?: string;
  artifact_refs: string[];
  follow_stream_refs: string[];
  stdout_ref?: string;
  stderr_ref?: string;
  exit_code?: number;
  duration_ms?: number;
  redaction: {
    applied: boolean;
    profile_ref?: string;
    sensitive_content_removed: boolean;
  };
  error?: {
    code: string;
    category:
      | "validation"
      | "permission"
      | "security"
      | "approval"
      | "environment"
      | "tool_runtime"
      | "external_service"
      | "timeout"
      | "cancelled"
      | "unknown";
    message: string;
    retryable: boolean;
    suggested_next_actions: string[];
  };
  created_at: string;
}
```

规则：

- 大内容只进 `data_ref` 或 artifact，不直接塞回模型。
- 可展示内容使用 `projection_ref`，原始内容可能需要权限。
- 写操作必须产生 diff 或 file snapshot。
- 测试、构建、lint、typecheck 必须产生对应 report artifact 或 not-run 记录。
- 失败结果必须给出机器可读 `error.category` 和 `retryable`。

---

### 15.7 Tool Registry 与 Manifest 生命周期

`/tools` 虚拟目录背后必须是版本化 Tool Registry。

```ts
interface ToolManifest {
  schema_version: "v1";
  tool_id: string;
  path: string;
  display_name: string;
  description: string;
  domain: string;
  version: string;
  status: "enabled" | "disabled" | "deprecated" | "suspended";
  args_schema_ref: string;
  result_schema_ref: string;
  risk_profile: {
    level: "low" | "medium" | "high" | "critical";
    side_effects: string[];
    reversible: boolean;
  };
  permission_profile: {
    default_requires_confirmation: boolean;
    allowed_permission_modes: Array<"sandbox" | "full_access">;
    allowed_scopes: string[];
  };
  output_profile: {
    supports_streaming: boolean;
    supports_pagination: boolean;
    supports_result_refs: boolean;
    max_default_bytes: number;
  };
  provider: {
    kind: "builtin" | "mcp" | "plugin" | "project_local";
    provider_id: string;
  };
  compatibility: {
    min_lyra_version: string;
    deprecated_after?: string;
  };
  checksum?: string;
}
```

生命周期：

```text
registered -> validated -> enabled -> deprecated -> disabled
                         -> suspended
```

规则：

- 工具 path 是稳定用户/模型可见入口，内部实现可以换。
- 工具版本变化必须让 inspect 缓存失效。
- `disabled` 或 `suspended` 工具不得通过 handle 调用。
- 项目策略和组织策略都可以禁用工具。
- MCP、插件和项目本地工具必须声明 provider 来源和校验信息。

---

### 15.8 可观测与本地操作记录

Lyra 第一阶段只接入三个基础记录面：

- `ToolOperationRecord`：记录工具请求、校验、权限、执行状态和耗时。
- `ToolResultEnvelope`：记录结构化结果、错误、stdout/stderr、artifact 引用和可展示投影。
- `ToolOperationTrace`：记录关键阶段事件，方便 UI Follow、问题定位和性能分析。

规则：

- 只读工具可以只保存结构化结果和压缩投影。
- 工作区写操作必须保存 diff 或 file snapshot，方便用户确认和回退。
- shell、测试、构建和 dev server 必须保存 stdout/stderr 引用，并支持 Follow 流式展示。
- FollowEvent 是过程投影，不是最终结果；最终判断必须以 ToolResult、diff、artifact 或原始日志引用为准。

---

### 15.9 Shell、进程和环境模型

`/tools/shell/run_command` 不应只接受 `cmd: string`。生产实现必须区分 argv mode 和 shell mode。

```ts
interface RunCommandArgs {
  mode: "argv" | "shell";
  argv?: string[];
  command?: string;
  cwd: string;
  env?: Record<string, string>;
  env_policy: {
    inherit: boolean;
    allowlist: string[];
    denylist: string[];
    secret_handles: string[];
  };
  timeout_ms: number;
  output_limit_bytes: number;
  network_policy_ref?: string;
  process_group_id?: string;
  expected_outputs?: string[];
}
```

规则：

- 默认优先 `argv`，只有确实需要 shell 语义时才允许 `shell`。
- `cwd` 必须在授权 scope 内。
- 环境变量默认不继承，必须 allowlist。
- secret env 只能通过 SecretHandle 注入。
- `sudo`、全局安装、系统配置、管道远程脚本、破坏性删除、权限修改必须进入高风险路径。
- 由 Lyra 启动的长期进程必须进入 process registry，可停止、查看日志和恢复。

长期进程记录：

```ts
interface ManagedProcessRecord {
  schema_version: "v1";
  process_id: string;
  op_id: string;
  command_summary: string;
  cwd: string;
  status: "starting" | "running" | "exited" | "failed" | "killed";
  pid?: number;
  port_refs: string[];
  log_artifact_refs: string[];
  started_at: string;
  stopped_at?: string;
}
```

---

### 15.10 写操作与进程记录

第一阶段只记录 Lyra 编程工具最常见的本地变化，不引入额外的外部写入账本。

```ts
interface ToolChangeRecord {
  schema_version: "v1";
  change_id: string;
  op_id: string;
  kind:
    | "workspace_write"
    | "workspace_delete"
    | "process_started"
    | "service_started"
    | "git_branch_change";
  target_ref: string;
  diff_ref?: string;
  snapshot_ref?: string;
  log_ref?: string;
  created_at: string;
}
```

规则：

- workspace 写入必须能通过 diff 或 snapshot 对照。
- Git 分支切换、commit、reset 等操作必须进入高风险路径，并在执行前展示清晰摘要。
- 长期进程必须进入 process registry，可停止、查看日志和恢复 UI 绑定。
- 外部写入类工具不进入第一阶段；未来需要时单独设计权限和日志模型。

---

### 15.11 Result Compressor 升级

Result Compressor 必须输出“模型可用投影”和“可展开原始引用”两层。

```ts
interface CompressedToolProjection {
  schema_version: "v1";
  projection_id: string;
  result_id: string;
  model_visible_summary: string;
  selected_items: Array<{
    item_ref: string;
    reason: string;
  }>;
  omitted_count?: number;
  next_page_token?: string;
  expansion_tools: string[];
  redaction_applied: boolean;
}
```

规则：

- 模型只看必要 projection。
- 原始大结果进入 artifact 或 result ref。
- 搜索结果必须保留可展开引用。
- 终端输出必须按 stdout/stderr/log artifact 分离。
- 任何脱敏都必须记录 redaction profile。

### 15.12 结构化代码搜索与能力保真投影

参考 `参考项目/jcode` 的 agentgrep 思路，Lyra 的 `/tools/code/search_code` 不应只是 `rg` 文本输出的包装。它应返回结构化代码理解投影：

```ts
interface StructuredCodeSearchResult {
  schema_version: "v1";
  result_id: string;
  query: string;
  total_matches: number;
  total_files: number;
  files: Array<{
    item_ref: string;
    path: string;
    language?: string;
    file_role?: "source" | "test" | "config" | "doc" | "generated" | "unknown";
    structure_confidence: number;
    matched_symbols: Array<{
      kind: "function" | "class" | "method" | "variable" | "type" | "module" | "unknown";
      name: string;
      start_line: number;
      end_line: number;
      matched_lines: number[];
    }>;
    nearby_symbols: Array<{
      kind: string;
      name: string;
      start_line: number;
      end_line: number;
    }>;
    snippets: Array<{
      line: number;
      text: string;
      truncated: boolean;
      omitted_prefix_chars?: number;
      omitted_suffix_chars?: number;
    }>;
    omitted_match_count: number;
    expansion_refs: string[];
  }>;
  projection_policy: {
    max_rendered_line_chars: number;
    max_non_code_matches_per_file: number;
    redaction_applied: boolean;
  };
}
```

规则：

- 搜索结果必须尽量包含符号范围、文件角色、匹配所在函数/类和可展开引用。
- 对大行、大文件和非代码文件可以限制 projection，但完整结果必须进入 `data_ref`、`artifact_ref` 或可展开 `item_ref`。
- 已经读过的文件、已展开的 region 和旧工具输出可以用于减少重复展示，但不能让模型误判内容不存在。
- 当搜索结果会影响代码修改、删除、迁移或安全判断时，Agent 必须进一步读取必要文件或代码范围；不得只凭压缩投影做最终判断。
- projection 的目标是减少无意义 token 和 UI 负担，不是减少 Agent 对项目的理解能力。
- 结构化搜索应结合 ripgrep、tree-sitter、LSP、全文索引和符号索引；实现可分层降级，但返回 envelope 必须明确 `structure_confidence`。

推荐工具组：

```text
/tools/code/search_code          语义化代码搜索，返回结构化投影
/tools/code/find_files           文件路径与角色检索
/tools/code/outline_file         单文件结构摘要
/tools/code/read_symbol_region   读取符号所在范围
/tools/code/find_references      查找符号引用
/tools/code/diagnostics          读取 LSP/类型/语法诊断
```

禁止：

- 把任意长 `rg` 输出直接塞给模型。
- 为了变快只返回路径、不提供展开入口。
- 为了省 token 删除原始命中或日志。
- 把搜索 projection 当成最终证据；最终交付必须引用 canonical artifact 或原始结果引用。

---

## 16. Agent 实现技术栈建议

Lyra Agent 不适合用单一语言实现。它需要桌面 UI、强本地执行、跨平台权限、安全隔离、长期进程、模型网关、索引搜索和插件生态，因此推荐采用分层技术栈。

核心原则：

- Electron / TypeScript 负责工作台和产品交互。
- Rust 负责 Runtime、工具执行、安全、状态机和本地系统能力。
- C / C++ 只用于必要的 native binding 和底层跨平台能力。
- Python 作为隔离 worker，用于数据分析、模型/脚本生态和诊断任务，不作为安全边界核心。
- 工具协议使用结构化 envelope；wire format 可用 Protobuf、MessagePack、CBOR 或 N-API object，不使用自然语言纯文本协议。

### 16.1 总体分层

```text
Electron / TypeScript Workbench
  -> UI state projection
  -> Follow / Approval / Clarification panels
  -> IPC client

Rust Core Runtime
  -> Runtime Loop
  -> Tool Filesystem Runtime
  -> Policy Gate / Security Gate
  -> Tool Executor
  -> Artifact / Tool Log Store
  -> Snapshot / Diff
  -> Model Routing Core

Native Layer C / C++
  -> OS-specific filesystem/process hooks
  -> optional high-performance native libraries

Python Workers
  -> local model scripts
  -> data/ML tooling
  -> project diagnostics
  -> optional tool adapters
```

---

### 16.2 Electron / TypeScript

适合负责：

- 主工作台 UI。
- 文件编辑器和 diff viewer。
- Follow 实时过程展示。
- Approval Panel、Clarification Panel、Plan Review Panel。
- 模型配置、项目配置 UI。
- Prompt Compiler 的 UI 侧预览和模块选择投影。

建议：

- Electron main process 只做宿主和 IPC 编排，不直接执行高风险工具。
- Renderer 使用 TypeScript 构建 UI 状态，不持有 secret 明文。
- 大型状态从 Rust Runtime 投影，不让前端成为权威状态源。
- UI 事件必须写回 Runtime action，不直接修改执行状态。

可选前端组合：

```text
Electron
+ TypeScript
+ React or equivalent component framework
+ Monaco Editor
+ lightweight graph/canvas renderer
+ Playwright UI verification
```

---

### 16.3 Rust Core Runtime

Rust 是 Lyra Agent 的核心实现语言。

适合负责：

- `RuntimeTurn` 生命周期。
- `ToolOperationEnvelope` 校验和执行状态机。
- Tool Registry、Tool Manifest、Tool Filesystem Runtime。
- 文件系统读写、patch、snapshot、diff。
- shell/process/service 管理。
- Policy Gate、Approval 自动记录、安全检查接入。
- Artifact Store、Tool Log Store。
- Follow Event Broker。
- Model Routing 决策和 provider adapter 调度。

建议：

- Rust Runtime 作为独立 sidecar 进程或 Node-API native module。
- 首选 sidecar 进程，便于崩溃隔离、权限隔离、日志和独立升级。
- IPC 使用结构化二进制或 schema 化对象，不从 stdout 文本解析动作。
- 所有高风险工具执行都在 Rust 侧做最终裁决。

推荐内部模块：

```text
lyra-runtime
lyra-tool-fs
lyra-policy
lyra-security
lyra-artifact
lyra-follow
lyra-model-gateway
```

---

### 16.4 TypeScript SDK 与插件层

TypeScript 适合做插件和工具适配生态。

适合负责：

- Tool provider SDK。
- 项目本地插件。
- GitHub、Jira、Linear、Slack、Email 等 API adapter。
- UI extension。
- prompt module 打包工具。

规则：

- TS 插件只能声明工具 manifest 和执行 adapter，不直接获得最终权限。
- 插件调用仍然必须回到 Rust Runtime 的 Policy Gate。
- 插件输出必须归一成 `ToolResultEnvelope`。
- 插件不得直接写入最终工具记录，只能提交候选结果，由 Runtime 统一落库。

---

### 16.5 Python Workers

Python 不建议作为主 Runtime 或安全边界，但适合做隔离 worker。

适合负责：

- 数据分析和 notebook 类任务。
- Python 项目诊断。
- 本地 ML / embedding / rerank / small model 脚本。
- 文档转换、PDF/Office 解析、统计分析。
- 项目专用自动化脚本。

规则：

- Python worker 必须由 Rust Runtime 启动和监管。
- Python worker 只通过结构化 IPC 收发 envelope。
- Python worker 不直接读取 secret；需要 secret 时使用 SecretHandle。
- Python worker 的 stdout/stderr 只作为日志 artifact，不作为工具协议。
- Python 依赖安装优先发生在 workspace sandbox 或隔离 worker 环境，不污染宿主全局环境。

---

### 16.6 C / C++ Native Layer

C / C++ 只在 Rust 或 Electron 现成能力不足时使用。

适合负责：

- 平台特定文件系统、进程、pty、terminal、watcher 能力。
- 高性能解析或索引库绑定。
- 需要稳定 ABI 的本地扩展。

规则：

- C / C++ 层不承载业务策略。
- C / C++ 层不直接处理 prompt、模型输出或权限决策。
- 所有 native 调用必须由 Rust Runtime 包装成安全 API。
- 崩溃隔离优先，能放 sidecar 就不放 UI 主进程。

---

### 16.7 本地数据存储

推荐：

```text
SQLite
  RuntimeTurn
  ToolOperationRecord
  ApprovalTicket
  Artifact metadata
  Tool log index
  Project config snapshot

Content-addressed file store
  large artifact content
  logs
  screenshots
  command output
  diff patches

Search index
  code search
  full text search
  symbol/document index
```

实现建议：

- SQLite 开启 WAL，用于本地可靠事务。
- 大对象不直接塞 SQLite，使用 content-addressed store。
- artifact metadata 和 content hash 分离。
- 全文搜索可用 SQLite FTS5 或 Rust 搜索引擎。
- 代码符号和 AST 使用 tree-sitter / LSP / 项目语言服务。

---

### 16.8 IPC 与协议格式

Lyra 不使用自然语言纯文本协议执行工具。

推荐 IPC：

- Electron renderer -> Electron main：受控 IPC。
- Electron main -> Rust sidecar：Protobuf / MessagePack / CBOR / N-API object。
- Rust Runtime -> Python worker：MessagePack / Protobuf over stdio pipe 或 local socket。
- Rust Runtime -> native service：typed FFI 或 local RPC。

规则：

- stdout/stderr 只能是日志流，不能是控制协议。
- JSON 可以用于 manifest 和调试投影，但生产执行以 schema 化 envelope 为准。
- 每条 IPC action 必须带 request id、runtime id、policy snapshot 或等价上下文。
- IPC 边界必须做 schema 校验和版本协商。

---

### 16.9 模型网关技术栈

模型网关建议拆成：

```text
Rust routing core
  model policy
  data classification
  local/cloud route decision
  cost accounting

Native provider adapters
  OpenAI
  Anthropic
  Gemini
  local Ollama / llama.cpp / vLLM / LM Studio
  embedded offline runtime
```

规则：

- 不把所有协议隐藏转换成 OpenAI-compatible。
- 每个 adapter 保留 provider 原生 request/response 语义。
- 模型调用结果只产生候选，不直接改变工具状态。
- 模型路由必须尊重任务所需能力、隐私策略和用户当前配置。

---

### 16.10 测试技术栈

建议测试层：

```text
Rust:
  cargo test
  integration tests
  property tests for policy/schema/sandbox

TypeScript:
  unit tests
  UI component tests
  Playwright end-to-end tests

Python:
  pytest for worker behavior
  fixture-based tool adapter tests

Cross-runtime:
  golden ToolOperationEnvelope tests
  security redaction tests
```

必须测试：

- 自由文本不能触发工具执行。
- 权限越界被拦截。
- full_access 自动批准有本地操作记录。
- Follow live draft 不等于真实文件写入。
- 工具结果能生成 artifact、stdout/stderr 引用和压缩投影。

---

### 16.11 MVP 技术栈裁剪

MVP 不需要一次实现全部。

建议 MVP：

```text
Electron + TypeScript
Rust sidecar Runtime
SQLite + content-addressed artifact store
Tool Filesystem MVP:
  filesystem/list_files
  filesystem/read_file
  filesystem/apply_patch
  code/search_code
  shell/run_command
  git/status
  git/diff
Follow basic stream:
  file draft
  terminal output
Approval basic panel
Message snapshot basic record
Model Gateway:
  OpenAI native
  Anthropic native
  one local adapter
```

暂缓：

- 多 provider 深度优化。
- 复杂插件生态。
- 高级 benchmark UI。

### 16.12 jcode 参考启发：常驻内核而不是削弱能力

`参考项目/jcode` 对 Lyra 的主要启发不是“少做一点所以快”，而是：

```text
常驻 daemon
  -> 快速 client attach
  -> 多 session 共享 provider / MCP / memory / runtime services
  -> 重任务后台化
  -> 结构化事件流驱动 UI
  -> 工具输出有界投影
  -> 原始工具结果完整保存
```

Lyra 采用 Electron 工作台时，应把这个思想落到进程边界：

```text
Electron Workbench
  只负责 UI、Follow、审批、规划和结果展示

Rust Daemon
  负责 RuntimeLoop、ToolRuntime、ModelGateway、Artifact 和 Tool Log
```

具体建议：

- daemon 已运行时，Workbench 启动优先 attach，不重新初始化模型、工具、索引和会话。
- daemon ready 后再做 embedding 预热、索引刷新、模型目录刷新和旧任务恢复。
- Electron main process 不直接跑 shell、写文件、读 secret 或执行插件。
- Follow、Todo、Approval、Artifact 和 Tool Log 都由 daemon 事件流投影到 UI。
- 工具结果采用 projection + canonical artifact 双层结构；模型看精简投影，展开和调试看完整 artifact。
- 代码搜索采用结构化符号投影和可展开引用，不把大段纯文本输出作为默认返回。
- 内存和延迟指标必须有归因，但超预算时优先优化架构和缓存，不以降低能力为手段。

不得采用的“伪优化”：

- 不读取必要文件就直接猜。
- 不运行应有验证就交付。
- 不保存原始工具输出，只保存摘要。
- 把强推理任务静默切到弱模型。
- 为了减少工具 schema 而隐藏任务需要的工具。
- 为了 UI 更快而把 Follow 过程流变成任务结束后的 diff。

---

## 17. 成功指标

可以用以下指标评估这个架构是否成功：

### 17.1 Token 指标

* 普通对话额外 token 接近 0。
* 工具任务平均工具说明 token 相比全量注入降低 70% 以上。
* 长会话中工具详情复用率提升。

---

### 17.2 延迟指标

* 普通对话不触发工具发现，延迟接近裸模型。
* 工具目录浏览延迟小于 50ms。
* 工具 inspect 结果可缓存。
* 常用工具 handle 命中率高。

---

### 17.3 质量指标

* 工具误触发率低。
* 工具幻觉率低。
* 复杂代码任务成功率高。
* 模型能在工具错误后自我修正。
* 权限审核和自动批准流程清晰。

---

### 17.4 安全指标

* 高风险工具无静默执行。
* 路径越权 100% 拦截。
* 危险 shell 命令 100% 拦截、审核或自动批准。
* 写操作均有 diff。
* 外部发送类操作必须审核或自动批准并记录本地操作日志。

### 17.5 能力保真指标

* 性能优化不降低任务成功率、验证覆盖率和原始结果完整性。
* 代码任务中，必要文件读取、结构化搜索、诊断和验证不因预算压力被跳过。
* 搜索 projection 可展开，canonical artifact 和原始结果引用完整保留。
* 模型路由满足任务所需能力和隐私策略，fallback 不静默降级。
* LongWorkRun 不因模型自然停止而假完成。
* Follow 仍展示过程流，而不是只展示最终 diff。

---

## 18. 主要风险和解决方案

### 18.1 模型不去找工具

风险：

```text
用户让它看项目文件，它却说“我无法访问你的文件”。
```

解决：

基础提示中明确写：

```text
涉及当前项目、文件、命令输出或外部信息时，不要猜测，先查看 /tools。
```

并提供 few-shot 示例。

---

### 18.2 模型过度找工具

风险：

```text
用户只是问“什么是闭包”，模型却发起 `op=list, path=/tools`。
```

解决：

提示中明确写：

```text
普通知识、解释、写作、闲聊直接回答。
普通对话不要浏览工具目录。
```

Runtime 也可以对明显不需要工具的场景加软限制。

---

### 18.3 工具目录浏览成本变高

风险：

模型每次都重复：

```text
tool_fs.list    { path: "/tools" }
tool_fs.list    { path: "/tools/code" }
tool_fs.inspect { path: "/tools/code/search_code" }
```

解决：

* 会话内缓存。
* 工具 handle。
* 常用工具 pinning。
* 自动记忆模型已 inspect 的工具。
* 对编程 Agent 默认 pin 4 个高频工具。

---

### 18.4 工具路径或工具名幻觉

风险：

模型调用不存在的路径：

```json
{
  "schema_version": "v1",
  "op_id": "op_bad_tool",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/code/grep",
  "args": {
    "query": "fetch"
  },
  "created_at": "2026-01-01T00:00:00Z"
}
```

解决：

Runtime 返回：

```text
Tool not found: /tools/code/grep.
Available tools in /tools/code:
- search_code
- find_references
```

让模型自我修正。

---

### 18.5 安全边界被模型绕过

风险：

模型试图用 shell 读取敏感文件：

```json
{
  "schema_version": "v1",
  "op_id": "op_sensitive_read",
  "session_id": "s_123",
  "op": "run",
  "path": "/tools/shell/run_command",
  "args": {
    "cmd": "cat ~/.ssh/id_rsa"
  },
  "created_at": "2026-01-01T00:00:00Z"
}
```

解决：

* Shell 沙箱。
* 文件路径限制。
* 默认拒绝策略 + 命令 allowlist / denylist。
* secret pattern 检测。
* 输出脱敏。
* 高风险操作审核或自动批准。

---

## 19. 推荐的长期形态

最终系统可以是混合架构：

```text
普通对话
  → 裸模型回答

简单低风险查询
  → Ghost Tool fast path 生成内部 envelope

编程与复杂任务
  → Tool Filesystem 懒加载 + 结构化调用

高频编程工具
  → 会话内 pin + tool_handle

长尾工具
  → /tools 按需发现

高风险操作
  → Policy Gate + Human Approval Ticket
```

也就是说，不需要所有场景都走同一个模式。

最佳实践是：

```text
简单任务幽灵化
复杂任务目录化
高频工具缓存化
执行通道结构化
高风险动作票据化
```

---

## 20. 结论

Tool Filesystem Agent 的核心不是“把工具真的做成文件夹”，而是把工具能力抽象成一个：

```text
可浏览
可搜索
可逐级展开
可缓存
可记录
可权限控制
```

的能力空间。

它解决了传统 Agent 的几个关键问题：

* 不再每轮注入全量工具。
* 普通对话几乎零额外 token。
* 工具数量可以大规模扩展。
* 模型仍然可以主导复杂多步任务。
* 执行通道保持结构化，拒绝自由文本工具协议。
* 安全控制可以集中在 runtime。
* 工具说明可以按需读取，而不是污染整个上下文。

一句话总结：

> Tool Filesystem Agent 不是让模型背工具说明书，而是给模型一个结构化工具操作系统。模型平时正常对话；需要外部能力时，按需打开目录、查找工具、阅读说明，并通过结构化调用通道请求执行，由 runtime 负责权限、安全和执行。

这是一个比全量 function calling 更轻，比 Ghost Tools 更适合复杂任务，比纯 Code-as-Tool 更稳定的混合 Agent 工具架构。
