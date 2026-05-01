# Tool Filesystem Agent：基于工具目录的懒加载 Agent 架构设计

## 1. 摘要

现有 AI Agent 架构中，最常见的做法是把所有可用工具以 function calling、JSON schema、XML tool list 或系统提示词的形式一次性注入到模型上下文中。这个方案虽然直接，但存在明显问题：

- 普通对话也要携带大量工具描述，浪费 token。
- 工具数量一多，模型选择工具的成本和出错率都会上升。
- 很多不支持 function calling 的模型无法使用这类工具系统。
- 工具说明和系统提示会污染模型上下文，影响正常对话质量。
- 编程 Agent 需要多步感知-行动循环，不能简单依赖外部路由器静默完成任务。:contentReference[oaicite:0]{index=0}

本文提出一种新的 Agent 工具组织方式：**Tool Filesystem Agent**。

核心思想是：

> 不把所有工具一次性塞进模型上下文，而是把工具组织成一个可浏览、可搜索、可逐级展开的虚拟文件系统。模型默认只知道“需要外部能力时可以去 `/tools` 查找”，普通对话不看工具；只有当任务需要时，才进入相关目录，查看工具列表、阅读工具说明、调用具体工具。

这个方案可以理解为：

- 对普通对话：零工具开销。
- 对简单任务：按需发现少量工具。
- 对复杂任务：模型仍然主导推理和多步工具编排。
- 对高风险动作：由运行时强制权限校验和用户确认。
- 对不支持 function calling 的模型：仍然可以通过纯文本协议使用工具。

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

### 2.3 纯 function calling 绑定特定模型能力

OpenAI、Anthropic、Gemini 等平台都有自己的 tool calling 格式。

但很多模型或调用方式并不支持原生工具调用：

* 本地模型
* 反代网页
* 简化 Chat API
* 只支持纯文本输入输出的模型
* 一些开源推理框架
* 浏览器插件代理层

如果 Agent 架构强依赖 function calling，就会限制模型兼容性。

而 Tool Filesystem 的目标是：

> 模型只需要能读文本、写文本，就可以使用工具。

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

模型可以通过少量元操作浏览工具空间：

```text
ls(path)          查看目录
cat(path)         阅读说明
inspect(path)     查看工具详情
run(path, args)   调用工具
```

模型初始只知道这些元操作，以及 `/tools` 这个入口。

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
  ls("/tools")
  ls("/tools/code")
  inspect("/tools/code/search_code")
  run("/tools/code/search_code", {"query": "fetch("})
```

关键区别：

| 维度       | 传统工具注入              | Tool Filesystem |
| -------- | ------------------- | --------------- |
| 工具可见性    | 全部工具默认可见            | 按需可见            |
| token 成本 | 每轮固定高成本             | 普通对话接近 0        |
| 工具数量扩展   | 工具越多越臃肿             | 工具可无限分类扩展       |
| 模型兼容性    | 依赖 function calling | 可纯文本实现          |
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
ls("/tools")
ls("/tools/code")
inspect("/tools/code/search_code")
run("/tools/code/search_code", {"query": "fetch("})
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

### 5.5 兼容纯文本模型

Tool Filesystem 不要求模型支持特殊的 `tool_calls` 字段。

所有交互都可以是纯文本：

```agent
ls("/tools")
```

系统返回：

```text
/tools/code - code search and analysis
/tools/filesystem - read and modify workspace files
/tools/shell - run shell commands
```

模型继续：

```agent
ls("/tools/code")
```

这可以运行在：

* Chat API
* Completion API
* 本地模型
* 反代网页
* 浏览器插件
* IDE 插件
* CLI Agent

---

## 6. 系统架构

整体架构如下：

```text
User
  ↓
Base Prompt
  ↓
LLM
  ↓
Agent Protocol Parser
  ↓
Tool Filesystem Runtime
  ↓
Tool Inspector
  ↓
Policy Gate
  ↓
Tool Executor
  ↓
Result Compressor
  ↓
LLM
  ↓
User
```

---

### 6.1 Base Prompt

基础提示词非常短。

示例：

```text
你是一个有帮助的 AI 助手。

普通知识、解释、写作和闲聊请直接回答。

当任务需要当前环境、文件、代码、网页、账号、命令输出、外部系统或实时信息时，不要猜测；你可以浏览 /tools 发现可用能力。

使用：
- ls(path) 查看目录
- cat(path) 阅读文档
- inspect(path) 查看工具详情
- run(path, args) 调用工具

只能使用 /tools 中明确存在的工具。
普通对话不要浏览工具目录。
高风险操作必须先向用户确认。
```

这个提示词不会包含任何具体工具 schema。

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

当模型调用：

```agent
inspect("/tools/code/search_code")
```

系统返回该工具的详细说明：

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
  - run("/tools/code/search_code", {"query": "fetch("})
```

只有当模型真的需要某个工具时，才读取这部分内容。

---

### 6.4 Policy Gate

所有工具调用都必须经过 Policy Gate。

即使模型说：

```agent
run("/tools/shell/run_command", {"cmd": "rm -rf /"})
```

系统也不能直接执行。

Policy Gate 需要判断：

* 工具是否存在。
* 参数是否合法。
* 是否越权访问路径。
* 是否有副作用。
* 是否是高风险命令。
* 是否需要用户确认。
* 是否需要在沙箱中执行。
* 是否需要限制输出长度。

---

### 6.5 Tool Executor

Tool Executor 负责执行真实工具。

例如：

```agent
run("/tools/filesystem/read_file", {"path": "src/App.tsx"})
```

会映射到内部函数：

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

Use read_file(path) or read_range(path, start, end) for details.
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

当模型调用：

```agent
ls("/tools")
```

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

当模型调用：

```agent
ls("/tools/filesystem")
```

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
    run("/tools/filesystem/apply_patch", {
      "patch": "*** Begin Patch\n*** Update File: src/App.tsx\n..."
    })
```

---

## 8. 调用协议

### 8.1 推荐使用 agent fenced block

不要直接执行所有代码块，否则用户让模型写示例代码时会误执行。

推荐专用代码块：

````md
```agent
ls("/tools")
```
````

模型需要执行工具时，必须使用 `agent` fenced block。

---

### 8.2 元操作

最小元操作集合：

```text
ls(path)
cat(path)
inspect(path)
run(path, args)
```

含义：

| 操作                | 作用            |
| ----------------- | ------------- |
| `ls(path)`        | 查看目录          |
| `cat(path)`       | 阅读 README 或文档 |
| `inspect(path)`   | 查看工具详情        |
| `run(path, args)` | 调用工具          |

---

### 8.3 示例流程

用户：

```text
帮我看看这个项目里哪里用了 fetch。
```

模型：

````md
我先查看可用的代码搜索工具。

```agent
ls("/tools")
```
````

系统返回：

```text
/tools/filesystem - read and modify workspace files
/tools/code - search and analyze source code
/tools/shell - run commands
```

模型：

````md
```agent
ls("/tools/code")
```
````

系统返回：

```text
/tools/code/search_code - search source code by query
/tools/code/find_references - find references to a symbol
/tools/code/get_symbols - list symbols in files
```

模型：

````md
```agent
inspect("/tools/code/search_code")
```
````

系统返回：

```yaml
name: search_code
args:
  query: string
  path?: string
risk:
  level: low
```

模型：

````md
```agent
run("/tools/code/search_code", {"query": "fetch("})
```
````

系统返回搜索结果。

模型最终回答用户。

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

调用方式：

```agent
run("/tools/search", {"query": "find code usages of a function"})
```

返回：

```text
Recommended tools:
1. /tools/code/search_code - search source code by query
2. /tools/code/find_references - find references to a symbol
3. /tools/filesystem/read_file - read a specific file
```

注意：`/tools/search` 只帮助发现工具，不执行真实业务动作。

---

### 9.3 常用工具缓存

一旦模型 inspect 过某个工具，runtime 可以给它一个短 handle。

例如：

```text
T1 = /tools/code/search_code
T2 = /tools/filesystem/read_file
T3 = /tools/filesystem/apply_patch
```

后续模型可以调用：

```agent
run("T1", {"query": "fetch("})
```

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
low      只读、无隐私、无副作用
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
* 高风险操作用户确认。
* 凭据和密钥脱敏。
* 网络访问域名限制。
* 数据库只读模式。
* 审计日志。

---

### 10.4 高风险操作确认

例如模型想发邮件：

```agent
run("/tools/email/send_email", {
  "to": "alice@example.com",
  "subject": "Meeting update",
  "body": "Let's move the meeting to tomorrow."
})
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

Ask the user to confirm before sending.
```

模型再问用户：

```text
我已准备好邮件，内容如下。确认发送吗？
```

只有用户确认后，Runtime 才允许执行。

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
* `delete_file` 必须谨慎，通常需要确认。

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
* `comment_pr`, `create_pr` 是高风险，需要确认。

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

```agent
ls("/tools")
```

系统返回：

```text
/tools/code - search and analyze source code
/tools/filesystem - read and modify files
```

模型：

```agent
ls("/tools/code")
```

系统返回：

```text
/tools/code/search_code - search code by query
```

模型：

```agent
run("/tools/code/search_code", {"query": "fetch("})
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

```agent
run("/tools/filesystem/read_file", {"path": "src/App.tsx"})
```

读取后：

```agent
run("/tools/filesystem/apply_patch", {
  "patch": "*** Begin Patch\n*** Add File: src/hooks/useUser.ts\n...\n*** Update File: src/App.tsx\n...\n*** End Patch"
})
```

然后：

```agent
run("/tools/shell/run_command", {"cmd": "npm test"})
```

如果测试失败，模型读取报错，继续修复。

---

### 12.4 高风险命令

用户：

```text
清理这个项目里所有没用的文件。
```

模型可能想执行：

```agent
run("/tools/shell/run_command", {"cmd": "rm -rf unused/*"})
```

Runtime 应该拦截：

```text
Command blocked: destructive command requires confirmation and a concrete file list.
```

模型应改为：

```agent
run("/tools/filesystem/list_files", {"path": "."})
```

然后先列出候选文件，让用户确认。

---

## 13. 和其他方案对比

### 13.1 和全量 Function Calling 对比

| 维度        | 全量 Function Calling | Tool Filesystem |
| --------- | ------------------- | --------------- |
| token 成本  | 高                   | 低               |
| 工具发现      | 一次性注入               | 按需浏览            |
| 工具数量扩展    | 差                   | 好               |
| 模型兼容性     | 依赖平台                | 纯文本可用           |
| schema 校验 | 强                   | 需要 runtime 实现   |
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
  /filesystem
    list_files
    read_file
    apply_patch

  /code
    search_code

  /shell
    run_command

  /tools/search
```

这已经能支持大部分编程 Agent 基础能力：

* 查看项目结构。
* 搜索代码。
* 读取文件。
* 修改文件。
* 运行测试或 lint。
* 根据报错继续修复。

---

### 14.2 MVP 协议

基础提示词：

````text
你是一个编程助手。

普通解释和闲聊直接回答。
当任务需要查看或修改当前项目时，使用 ```agent 代码块调用工具。

可用元操作：
ls(path), inspect(path), run(path, args)

工具入口：/tools
只能调用 /tools 中明确存在的工具。
修改已有文件优先使用 apply_patch。
危险命令必须先征求用户确认。
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

### 15.1 Parser

负责解析模型输出中的 agent block。

示例输入：

````md
```agent
run("/tools/code/search_code", {"query": "fetch("})
```
````

Parser 输出：

```json
{
  "op": "run",
  "path": "/tools/code/search_code",
  "args": {
    "query": "fetch("
  }
}
```

---

### 15.2 Validator

Validator 负责校验：

* 是否是允许的元操作。
* path 是否存在。
* args 是否符合 schema。
* 是否有路径穿越。
* 是否尝试访问未授权目录。
* 是否超过调用次数限制。

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

## 16. 成功指标

可以用以下指标评估这个架构是否成功：

### 16.1 Token 指标

* 普通对话额外 token 接近 0。
* 工具任务平均工具说明 token 相比全量注入降低 70% 以上。
* 长会话中工具详情复用率提升。

---

### 16.2 延迟指标

* 普通对话不触发工具发现，延迟接近裸模型。
* 工具目录浏览延迟小于 50ms。
* 工具 inspect 结果可缓存。
* 常用工具 handle 命中率高。

---

### 16.3 质量指标

* 工具误触发率低。
* 工具幻觉率低。
* 复杂代码任务成功率高。
* 模型能在工具错误后自我修正。
* 用户确认流程清晰。

---

### 16.4 安全指标

* 高风险工具无静默执行。
* 路径越权 100% 拦截。
* 危险 shell 命令 100% 拦截或确认。
* 写操作均有 diff。
* 外部发送类操作均需确认。

---

## 17. 主要风险和解决方案

### 17.1 模型不去找工具

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

### 17.2 模型过度找工具

风险：

```text
用户只是问“什么是闭包”，模型也去 ls("/tools")。
```

解决：

提示中明确写：

```text
普通知识、解释、写作、闲聊直接回答。
普通对话不要浏览工具目录。
```

Runtime 也可以对明显不需要工具的场景加软限制。

---

### 17.3 工具目录浏览成本变高

风险：

模型每次都重复：

```text
ls("/tools")
ls("/tools/code")
inspect("/tools/code/search_code")
```

解决：

* 会话内缓存。
* 工具 handle。
* 常用工具 pinning。
* 自动记忆模型已 inspect 的工具。
* 对编程 Agent 默认 pin 4 个高频工具。

---

### 17.4 工具路径或工具名幻觉

风险：

模型调用不存在的路径：

```agent
run("/tools/code/grep", {"query": "fetch"})
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

### 17.5 安全边界被模型绕过

风险：

模型试图用 shell 读取敏感文件：

```agent
run("/tools/shell/run_command", {"cmd": "cat ~/.ssh/id_rsa"})
```

解决：

* Shell 沙箱。
* 文件路径限制。
* 命令黑名单。
* secret pattern 检测。
* 输出脱敏。
* 高风险操作确认。

---

## 18. 推荐的长期形态

最终系统可以是混合架构：

```text
普通对话
  → 裸模型回答

简单低风险查询
  → Ghost Tool fast path

编程与复杂任务
  → Tool Filesystem 懒加载

高频编程工具
  → 会话内 pin

长尾工具
  → /tools 按需发现

高风险操作
  → Policy Gate + 用户确认
```

也就是说，不需要所有场景都走同一个模式。

最佳实践是：

```text
简单任务幽灵化
复杂任务目录化
高频工具缓存化
高风险动作确认化
```

---

## 19. 结论

Tool Filesystem Agent 的核心不是“把工具真的做成文件夹”，而是把工具能力抽象成一个：

```text
可浏览
可搜索
可逐级展开
可缓存
可审计
可权限控制
```

的能力空间。

它解决了传统 Agent 的几个关键问题：

* 不再每轮注入全量工具。
* 普通对话几乎零额外 token。
* 工具数量可以大规模扩展。
* 模型仍然可以主导复杂多步任务。
* 兼容纯文本模型。
* 安全控制可以集中在 runtime。
* 工具说明可以按需读取，而不是污染整个上下文。

一句话总结：

> Tool Filesystem Agent 不是让模型背工具说明书，而是给模型一个工具操作系统。模型平时正常对话；需要外部能力时，像人一样打开目录、查找工具、阅读说明、调用能力，并由 runtime 负责权限、安全和执行。

这是一个比全量 function calling 更轻，比 Ghost Tools 更通用，比纯 Code-as-Tool 更稳定的 Agent 工具架构。

```
```
