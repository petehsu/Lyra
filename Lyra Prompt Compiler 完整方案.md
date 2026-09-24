# Lyra Prompt Compiler

## 1. 目标

Lyra 不采用传统的“大段固定 System Prompt + 动态注入”模式。

目标是构建一个真正由程序计算的 **Prompt Compiler**：

> 根据当前 Runtime State、Capabilities、Permissions、Workspace、Tool 状态和 Agent 执行阶段，确定性地计算出当前这一轮模型真正需要的最小提示词。

核心要求：

- 极少固定 Prompt
- 不额外调用模型生成 Prompt
- 不依赖自然语言关键词或正则做主要判断
- 编译速度足够快
- Prompt 长度随当前任务复杂度变化，而不是随 Lyra 总能力数量增长
- 可测试、可复现、可调试
- 能长期扩展到 Coding、Browser、Office、Desktop、Email、SSH、Database 等能力
- 不把安全和权限依赖于 Prompt
- 最终能扩展成完整的 Context Compiler

---

# 2. 核心原则

整个系统遵循一个边界：

```text
Prompt Compiler 不负责理解用户想做什么。

Prompt Compiler 负责计算：
“当前这一刻，主模型必须知道什么？”
```

真正的语义理解、推理、任务规划仍由主模型完成。

因此：

```text
主模型
负责智能

Prompt Compiler
负责上下文调度

Runtime
负责事实和权限

Tools
负责执行
```

不能混在一起。

---

# 3. 整体架构

```text
                     User Message
                          │
                          ▼
                    Main Model
               理解用户真正的需求
                          │
                          │
                          ▼
┌─────────────────────────────────────────────┐
│                Lyra Runtime                 │
│                                             │
│ Workspace                                   │
│ Capabilities                                │
│ Permissions                                 │
│ Current Application                         │
│ Selected Resource                           │
│ Git State                                   │
│ Agent Phase                                 │
│ Tool State                                  │
│ Previous Tool Result                        │
│ Attachments                                 │
└─────────────────────┬───────────────────────┘
                      │
                      ▼
               Prompt Compiler
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
    Rule Engine    Prompt IR     Dependency Graph
        │             │             │
        └─────────────┼─────────────┘
                      ▼
                  Optimizer
                      │
                      ▼
                   Emitter
                      │
                      ▼
               Minimal Prompt
                      │
                      ▼
                  Main Model
```

整个过程不需要额外模型。

---

# 4. 四层职责

## 4.1 Runtime

Runtime 提供确定性事实。

例如：

```rust
RuntimeState {
    workspace: WorkspaceKind::Rust,
    agent_mode: AgentMode::Agent,
    git: GitState::Dirty,

    capabilities: {
        FileRead,
        FileWrite,
        Terminal,
        Git,
    },

    permissions: {
        FileWrite,
        ShellExecution,
    },

    phase: AgentPhase::Inspecting,
}
```

这些数据来自真实系统，而不是模型猜测。

例如：

```text
是否存在 Cargo.toml
当前是否打开 Git 仓库
当前有没有文件写权限
是否允许执行 Terminal
某个文件是否已经被修改
当前 Tool Call 是什么
Git Working Tree 是否 Dirty
```

全部由程序直接获取。

---

## 4.2 Prompt Compiler

Prompt Compiler 输入：

```text
RuntimeState
+
Current Event
+
Capabilities
+
Permissions
```

输出：

```text
PromptIR
```

它不负责：

```text
理解自然语言
判断用户情绪
推理用户真实目的
规划整个任务
生成答案
```

这些仍由主模型负责。

---

## 4.3 Main Model

主模型负责：

```text
理解用户
推理
规划
判断
选择 Tool
阅读信息
生成内容
决定下一步动作
```

例如：

```text
用户：
“帮我看看为什么这里这么写”
```

Prompt Compiler 不需要判断：

```text
这是解释任务还是修改任务？
```

主模型自己理解。

Compiler 只告诉模型：

```text
当前有代码 Workspace
当前只有读取权限
当前有这些工具
```

---

## 4.4 Runtime Guard

真正的硬限制必须由 Runtime 实现。

例如：

```text
禁止删除根目录
禁止越权访问文件
发送消息前需要权限
Shell 沙箱
文件系统访问范围
工具参数合法性
```

不能依赖：

```text
Please don't delete important files.
```

而应该是：

```rust
if !permissions.allows(action) {
    return Err(PermissionDenied);
}
```

Prompt 只能指导行为，不能承担安全边界。

---

# 5. Prompt IR

Prompt IR 是整个架构的核心。

IR 即 Intermediate Representation，也就是“中间表示”。

所有运行状态经过规则计算后，先转换成结构化 Prompt IR，而不是马上拼接字符串。

例如：

```rust
pub struct PromptIr {
    pub objective: Objective,

    pub behaviors: Vec<Behavior>,

    pub constraints: Vec<Constraint>,

    pub context: Vec<ContextRequirement>,

    pub capabilities: Vec<CapabilityHint>,

    pub metadata: PromptMetadata,
}
```

行为：

```rust
pub enum Behavior {
    InspectBeforeEdit,
    VerifyAfterEdit,
    PreserveUserChanges,
    SearchFreshInformation,
    ValidateRecipient,
}
```

约束：

```rust
pub enum Constraint {
    DoNotFabricate,
    RespectPermissions,
    PreserveUnrelatedChanges,
}
```

这样系统处理的是：

```text
VerifyAfterEdit
```

而不是：

```text
"Remember to verify your changes after modifying..."
```

只有最后 Emitter 阶段才转成自然语言。

---

# 6. Rule Engine

Rule Engine 不应采用自然语言关键词匹配作为主要机制。

错误方案：

```text
用户提到 "Rust"
→ 加载 Rust Prompt
```

这种设计会产生大量误判和漏判。

正确方案主要依赖结构化事实。

例如：

```text
workspace.language == Rust
AND
capability.file_write == true
```

触发：

```text
RustEditing
```

例如：

```text
event == FileModified
AND
capability.terminal == true
```

触发：

```text
VerifyAfterEdit
```

例如：

```text
git.state == Dirty
AND
capability.file_write == true
```

触发：

```text
PreserveUserChanges
```

规则本质：

```text
事实
→ 行为需求
```

而不是：

```text
自然语言
→ 猜测用户意图
```

---

# 7. Rule 表达方式

核心规则执行逻辑使用 Rust。

大部分规则声明使用 TOML。

例如：

```toml
id = "code.verify"
priority = 80

[when]
file_modified = true
terminal_available = true

[emit]
behavior = "verify_after_edit"
```

另一个：

```toml
id = "git.preserve_changes"
priority = 100

[when]
git_dirty = true
file_write = true

[emit]
behavior = "preserve_user_changes"
```

Rust 负责：

```text
读取
解析
验证
执行
依赖解析
冲突检测
优化
```

TOML 只负责声明。

---

# 8. Prompt Dependency Graph

规则之间需要依赖关系。

例如：

```text
code_edit
├── inspect_before_edit
├── preserve_user_changes
└── verify_after_edit
      └── terminal_available
```

如果：

```text
terminal_available = false
```

那么：

```text
verify_after_edit
```

可以自动移除或降级。

依赖图使用：

```text
petgraph
```

实现。

Prompt Compiler 根据当前状态计算：

```text
Activated Rules
↓
Resolve Dependencies
↓
Remove Impossible Rules
↓
Resolve Conflicts
↓
Prompt IR
```

---

# 9. Event Driven Compilation

Prompt 不应该只在请求开始时生成一次。

应该随着 Agent 执行不断重新编译。

例如：

```text
用户请求
↓
Compile #1
↓
Model
↓
Tool Call
↓
Runtime State Changed
↓
Compile #2
↓
Model
↓
Tool Call
↓
Runtime State Changed
↓
Compile #3
```

典型事件：

```rust
enum RuntimeEvent {
    WorkspaceOpened,
    FileRead,
    FileModified,
    ToolRequested,
    ToolCompleted,
    GitStateChanged,
    BrowserOpened,
    ExternalActionRequested,
    MessageAboutToSend,
    CommandAboutToExecute,
}
```

事件修改 Runtime State。

Prompt Compiler 再根据最新 State 重新计算。

---

# 10. 示例：代码修复

用户：

```text
帮我把这个项目修一下。
```

初始状态：

```text
workspace = Rust
git = Dirty
terminal = Available
file_write = Available
phase = Inspecting
```

第一次编译：

```text
Follow the user's request directly.
Inspect relevant files before modifying them.
Preserve unrelated user changes.
```

模型开始读文件。

随后执行：

```text
write_file
```

Runtime：

```text
phase = Editing
file_modified = true
```

重新编译：

```text
Preserve unrelated user changes.
Make only changes required for the task.
```

修改完成：

```text
phase = Modified
```

重新编译：

```text
Verify the modified work using the narrowest relevant checks available.
Do not claim successful completion unless verification supports it.
```

因此模型不会从一开始就携带所有后续阶段的规则。

---

# 11. Prompt Source

真正给模型看的 Prompt 文本使用：

```text
英文自然语言
+
少量 Markdown
```

源文件：

```text
.md
.md.j2
```

基础静态文本使用：

```text
.md
```

存在变量的动态文本使用：

```text
.md.j2
```

例如：

```jinja2
Verify the modified {{ target }} using the available checks.
```

模板渲染使用：

```text
MiniJinja
```

---

# 12. MiniJinja 的定位

MiniJinja 不参与核心决策。

它只负责：

```text
Prompt IR
↓
Text Rendering
```

即：

```text
Rust：
为什么需要这条规则？

MiniJinja：
这条规则最后怎么表达？
```

不能把这些逻辑塞进模板：

```jinja2
{% if coding %}
  {% if write %}
    {% if git_dirty %}
      {% if terminal %}
```

否则 Prompt Compiler 会退化成模板脚本系统。

---

# 13. Kernel

永久固定 Prompt 应该非常小。

目标：

```text
50～100 tokens
```

例如：

```md
Follow the user's request directly.

Use available capabilities when they materially help.
Do not fabricate unavailable information.
Respect runtime permissions and constraints.
```

Kernel 只保存真正跨所有任务都成立的原则。

以下内容不要放 Kernel：

```text
Coding rules
Browser rules
Git rules
Office rules
Search rules
Email rules
Database rules
SSH rules
Android rules
```

全部动态加载。

---

# 14. Optimizer

Prompt IR 生成后必须经过优化。

Optimizer 执行：

```text
去重
依赖裁剪
冲突处理
规则合并
不可执行规则删除
优先级排序
Token Budget 控制
```

例如：

```text
InspectBeforeEdit
+
InspectRelevantFiles
+
ReadBeforeEditing
```

可能合并成：

```text
Inspect relevant files before modifying them.
```

不能三句全部输出。

---

# 15. Token Budget

建议默认预算：

```text
Kernel:
≤ 100 tokens

Dynamic Rules:
通常 ≤ 500 tokens

完整 Prompt Compiler 输出:
默认 ≤ 800 tokens

Soft Limit:
≈ 1,000 tokens

Hard Warning:
> 1,500 tokens
```

预期：

```text
普通问答
50～150 tokens

代码阅读
100～250

代码编辑
200～500

代码 + Git + Verify
300～700

Browser Agent
300～800

复杂跨应用任务
500～1,200
```

重点不是强制每次极短。

重点是：

> Prompt 大小与当前任务复杂度相关，而不是和 Lyra 总功能数量相关。

即使未来 Lyra 有 500 个能力，普通聊天仍然可能只需要 80 tokens System Prompt。

---

# 16. Prompt Budget 优化规则

每个规则拥有：

```rust
priority
cost
required
```

例如：

```rust
RuleMeta {
    priority: 100,
    estimated_tokens: 18,
    required: true,
}
```

Optimizer 在 Budget 超限时：

```text
保留 required
↓
保留高优先级
↓
删除重复信息
↓
压缩可合并规则
↓
删除低价值辅助规则
```

不能粗暴截断字符串。

---

# 17. Model Emitter

Prompt IR 不应该绑定某一家模型。

架构：

```text
PromptIR
├── OpenAIEmitter
├── AnthropicEmitter
├── GeminiEmitter
├── GLMEmitter
├── DeepSeekEmitter
└── GenericEmitter
```

例如同一个：

```text
Behavior::VerifyAfterEdit
```

GPT 可能输出：

```text
Verify modified work using available checks.
```

某些本地小模型可能需要更明确：

```text
After modifying files, run an appropriate verification command before reporting completion.
```

IR 不变。

只改变 Emitter。

这样模型优化不会污染规则系统。

---

# 18. Tool Context 也进入同一体系

长期不能只优化 Prompt。

最终应该扩展成：

# Context Compiler

输入：

```text
Prompt Rules
Tools
Skills
Memory
Workspace Context
Conversation History
Files
Search Results
Runtime State
```

输出：

```text
Minimal Context Package
```

整体：

```text
                       Context Compiler
                              │
       ┌──────────────────────┼─────────────────────┐
       │                      │                     │
 Prompt Compiler         Tool Selector        Context Selector
       │                      │                     │
       └──────────────────────┼─────────────────────┘
                              ▼
                    Minimal Context Package
                              ▼
                           Model
```

---

# 19. Tool 按需加载

不能把 Lyra 所有 Tool Schema 每次都发送。

例如用户只是问：

```text
Rust ownership 是什么？
```

不要加载：

```text
Browser
Email
Calendar
Office
Android
SSH
Database
Image
Video
Desktop
```

只加载当前可能使用的能力。

Prompt 和 Tool 使用相同的 Capability Graph。

---

# 20. Skill 按需加载

Skill 本身也不应该永久进入 Context。

流程：

```text
Runtime Context
↓
Skill Eligibility
↓
选中必要 Skill
↓
加载 Skill
```

例如：

```text
PDF attached
```

才允许 PDF Skill 进入候选范围。

不是每轮都加载 PDF Skill。

---

# 21. Memory 按需加载

Memory 不进入 Prompt Compiler 核心规则判断。

Memory 应由 Context Compiler 独立检索。

例如：

```text
Current Task
↓
Memory Retrieval
↓
Relevant Memory
↓
Context Budget
↓
Model
```

Prompt Compiler 只需要知道：

```text
memory_available = true
```

而不直接处理 embedding 或向量搜索。

---

# 22. 不使用向量数据库做 Prompt Rule 匹配

Prompt Rule 必须：

```text
确定
稳定
可复现
可测试
```

因此：

```text
相同 RuntimeState
→ 相同 PromptIR
```

不能让：

```text
Embedding
Vector Search
LLM Classifier
```

决定核心 Prompt Rule。

这些可以用于：

```text
Memory
Documents
Knowledge
Skill retrieval
```

但不能控制基础行为规则。

---

# 23. 自然语言信号

并不是完全禁止读取用户文本。

而是：

> 用户文本不能成为核心规则系统主要的数据来源。

例如某些非常简单、低风险的 hint：

```text
用户明确说：
“不要修改文件”
```

可以形成：

```text
ExplicitUserConstraint::ReadOnly
```

但这最好由主模型或请求解析层形成结构化约束。

不能建立几十个：

```regex
修改|修复|fix|edit|change
```

来猜用户意图。

---

# 24. 技术栈

核心：

```text
Rust
```

建议：

```text
serde
    配置、IR 序列化

toml
    声明式规则

MiniJinja
    最终 Prompt Rendering

petgraph
    Rule Dependency Graph

thiserror
    错误类型

criterion
    Benchmark
```

不建议引入：

```text
Node.js Prompt Core
Java Rule Engine
Shell Rules
Lua
独立 LLM Router
Vector DB for Rules
复杂 DSL
```

---

# 25. Rust crate 结构

建议：

```text
crates/

├── lyra-prompt-ir/
│   ├── behavior.rs
│   ├── constraint.rs
│   ├── capability.rs
│   ├── context.rs
│   └── prompt_ir.rs
│
├── lyra-prompt-rules/
│   ├── rule.rs
│   ├── matcher.rs
│   ├── dependency.rs
│   └── loader.rs
│
├── lyra-prompt-optimizer/
│   ├── dedup.rs
│   ├── dependency_prune.rs
│   ├── conflict.rs
│   ├── budget.rs
│   └── optimize.rs
│
├── lyra-prompt-compiler/
│   ├── compiler.rs
│   ├── emitter.rs
│   ├── generic.rs
│   └── providers/
│
└── lyra-agent-runtime/
    ├── state.rs
    ├── event.rs
    ├── permissions.rs
    └── capability.rs
```

Prompt assets：

```text
prompts/

├── kernel.md

├── behaviors/
│   ├── inspect-before-edit.md
│   ├── preserve-user-changes.md
│   ├── verify-after-edit.md
│   └── search-fresh-info.md

├── constraints/
│   └── ...

└── providers/
    ├── openai/
    ├── anthropic/
    └── generic/
```

---

# 26. Compiler Pipeline

正式 Pipeline：

```text
Runtime Snapshot
        ↓
Normalize State
        ↓
Rule Matching
        ↓
Dependency Resolution
        ↓
Prompt IR
        ↓
Optimization Passes
        ↓
Token Budgeting
        ↓
Model-specific Emitter
        ↓
MiniJinja Rendering
        ↓
Final Prompt
```

核心 API 可以保持简单：

```rust
pub fn compile(
    state: &RuntimeState,
    event: &RuntimeEvent,
    target: &ModelTarget,
) -> Result<CompiledPrompt>;
```

输出：

```rust
pub struct CompiledPrompt {
    pub text: String,
    pub ir: PromptIr,
    pub active_rules: Vec<RuleId>,
    pub estimated_tokens: usize,
}
```

保留 IR 和 Rules 是为了调试。

---

# 27. Explain Mode

Prompt Compiler 必须具备可解释能力。

开发阶段能够查看：

```text
为什么加载这条规则？
为什么没有加载另一条？
哪个 Runtime Fact 触发？
规则依赖是什么？
最后删除了什么？
Token 花在哪里？
```

例如：

```text
Rule: verify_after_edit

Activated because:
- FileModified = true
- TerminalAvailable = true

Dependencies:
- none

Estimated cost:
17 tokens
```

这对以后排查 Agent 行为非常重要。

---

# 28. Debug Trace

建议记录：

```rust
CompilationTrace {
    state_hash,
    matched_rules,
    rejected_rules,
    dependency_changes,
    optimization_changes,
    token_cost,
}
```

但 Debug Trace 不发送给模型。

它只是 Lyra 内部开发工具。

---

# 29. 测试策略

Prompt Compiler 必须大量依赖确定性测试。

例如：

```rust
#[test]
fn rust_edit_dirty_repo_requires_preserve_and_verify() {
    let state = ...
    let output = compile(...);

    assert!(output.ir.has(Behavior::PreserveUserChanges));
    assert!(output.ir.has(Behavior::VerifyAfterEdit));
}
```

重点测试 IR，不要只 Snapshot 整段 Prompt。

Prompt 文本测试可以使用 snapshot：

```text
IR semantic tests
+
Emitter snapshot tests
```

这样修改 Prompt wording 不会导致整个规则测试崩掉。

---

# 30. 性能目标

Prompt Compiler 本身不应成为明显延迟来源。

长期目标可以设：

```text
典型规则数：
< 500

单次 Rule Evaluation：
亚毫秒～几毫秒级

Prompt Rendering：
接近忽略不计

绝不产生：
额外网络请求
额外 LLM 请求
```

真正延迟仍然应该来自：

```text
Model inference
Tool execution
Network
```

而不是 Prompt Compilation。

---

# 31. 规则数量增长方式

Lyra 功能增加时：

```text
20 capabilities
→
100 capabilities
→
500 capabilities
```

Rule Graph 可以越来越大。

但一次激活规则应该始终很少。

例如：

```text
Total Rules:
650

Matched:
17

After Dependency Prune:
11

After Optimization:
7

Final Prompt:
312 tokens
```

这是系统应该追求的状态。

---

# 32. 安全规则分层

安全相关内容分三类。

### Runtime Enforcement

绝对安全边界：

```text
权限
Sandbox
Path Access
External Actions
Secrets
Tool Validation
```

由程序执行。

### Prompt Constraint

模型行为指导：

```text
确认目标对象
不要假装操作成功
不要覆盖无关修改
```

进入 Prompt。

### User Preference

用户风格偏好：

```text
简洁
语言
格式
```

进入 Context，而不是 Runtime 权限系统。

三个层次不能混。

---

# 33. 失败策略

Compiler 不应该因为某条低优先级规则失败就阻断 Agent。

规则分：

```text
Required
Recommended
Optional
```

例如：

```text
permission_constraint
Required

verify_after_edit
Recommended

formatting_preference
Optional
```

Required 出现逻辑错误：

```text
Compilation Error
```

Optional 无法渲染：

```text
Drop + telemetry
```

---

# 34. 不做的东西

第一阶段明确不做：

```text
自研 Prompt DSL
Prompt 生成模型
小模型 Intent Router
Embedding Rule Search
复杂自然语言分类
Shell Prompt Engine
Prompt Genetic Optimization
自动 Prompt Rewrite
在线 RL 优化
```

这些都会过早增加复杂度。

---

# 35. 第一阶段实现范围

第一版只完成：

```text
RuntimeState
RuntimeEvent
PromptIR
Rule
Rule Matcher
Dependency Graph
Optimizer
MiniJinja Emitter
Kernel
Token Budget
Debug Trace
Tests
```

先支持几个最常见场景：

```text
普通问答
Code Read
Code Edit
Terminal
Git Dirty
Verify
Web Search
```

这足够验证架构本身。

---

# 36. 第二阶段

等第一版稳定后，把：

```text
Tools
Skills
Memory
Workspace Context
```

接入相同 Capability Graph。

形成：

```text
Prompt Compiler
→
Context Compiler
```

---

# 37. 第三阶段

再增加：

```text
Provider-specific emitters
模型能力 profile
不同模型 Prompt 压缩策略
动态 Context Budget
Context Cache
Compilation Metrics
```

例如：

```rust
ModelProfile {
    instruction_following: Strong,
    context_window: 128_000,
    tool_use: Native,
    verbosity_bias: Medium,
}
```

Emitter 根据 Profile 微调表达方式。

这不会改变 Prompt IR。

---

# 38. 最终目标

Lyra 最终不应该拥有一个：

```text
20,000 token 的超级 System Prompt
```

而应该拥有一个规模很大的：

```text
Capability Graph
+
Rule Graph
+
Context Graph
```

每次请求只编译一个很小的 Context。

最终关系：

```text
Lyra 能力规模
            ↑
            ↑
            ↑

单次 Prompt 大小
──────────────
基本保持稳定
```

即：

> Lyra 越来越强，不意味着模型每次必须知道越来越多。

这就是 Prompt Compiler 最核心的价值。

---

# 39. 最终技术决定

长期方案确定为：

```text
Language
Rust

Runtime State
强类型 Rust 数据结构

Prompt IR
强类型 Rust enum / struct

Rules
Rust Engine + TOML 声明

Dependencies
petgraph

Optimization
Rust

Prompt Source
英文 .md / .md.j2

Rendering
MiniJinja

Provider Adaptation
独立 Emitter

Hard Security
Runtime Enforcement

Semantic Intelligence
Main Model

Future Direction
Prompt Compiler → Context Compiler
```

一句话概括整个设计：

> **Lyra 不再维护一份巨大 Prompt，而是维护一套机器可计算的行为系统；Runtime 提供事实，Compiler 计算最小上下文，主模型负责真正的智能。**