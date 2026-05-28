# Lyra Agent Core 完整重构 TODO

> 目标：把当前“机械移植 jcode 的代码容器”重构为真正属于 Lyra 的 Agent 核心平台。
>
> 执行规则：
> - 这是重构，不是补丁式优化。
> - 完成一个任务就把对应复选框改成 `[x]`。
> - 需要用户手动验证的任务不阻塞自动执行，可以保留未勾选并在汇报中列出。
> - 每一阶段都必须能编译、能测试、能启动，不允许长期处于半迁移不可运行状态。

## 0. 背景与问题定义

当前 `lyra-agent-core` 的形态主要来自早期快速移植：

- 通过 `#[path = "jcode_core/vendor/root_src/..."]` 把大量 jcode 内部模块直接挂进 `lyra-agent-core`。
- `lyra-agent-core` 同时承担 jcode 代码容器、Lyra runtime 适配层、NAPI/daemon API 暴露、事件映射、状态管理等职责。
- `lyra_runtime.rs` 过大，已经接近上帝模块。
- Desktop、`lyrad`、runtime 和 jcode 内部类型之间的边界不够清晰。
- 后续做 LCP、软件商店、内部软件控制、长期记忆、多 Agent、CLI 版、插件化 Agent 后端时，当前结构会持续放大耦合成本。

本重构的目标不是简单把目录移动到 `crates/`，而是先建立 Lyra 自己的稳定抽象，再逐步把 jcode 移植代码内化、模块化、私有化。

## 1. 最终架构目标

重构完成后，目标分层如下：

```text
apps/desktop
  只消费 Lyra 结构化 DTO、事件、命令；不直接依赖 jcode 内部类型

crates/lyrad
  进程边界、路由、生命周期、权限、事件分发；只暴露 Lyra runtime API

crates/lyra-agent-api
  稳定公共契约：DTO、Command、Event、Snapshot、ToolActivity、MemoryProjection

crates/lyra-agent-runtime
  Lyra 运行时编排：session、turn、memory、tool orchestration、LCP、browser、permission、provider profile

crates/lyra-agent-kernel
  Agent 内核实现：模型调用循环、工具执行引擎、消息 primitive、压缩、todo/plan 基础能力
  这里可以来自 jcode 迁移代码，但对外不暴露 jcode 内部结构

crates/lyra-agent-plugins
  后续可插拔能力：Provider、Tool Pack、Software Adapter、Memory Adapter、Browser Operator

crates/lyra-cli
  后续 CLI 入口；通过 lyra-agent-api / lyra-agent-runtime 使用同一套核心能力
```

## 2. 非目标

- [ ] 不在本次重构里重做 Desktop UI 视觉。
- [ ] 不在本次重构里重新设计所有 Agent 工具能力。
- [ ] 不在本次重构里追求兼容旧 jcode CLI 行为。
- [ ] 不为了迁移目录而迁移目录；所有物理移动必须服务于边界收敛。
- [ ] 不引入“关键词/正则猜测 UI 状态”的过渡方案。

## 3. 成功标准

- [ ] Desktop 不能直接 import / 依赖 jcode 内部类型。
- [ ] `lyrad` 对外只暴露 Lyra 命名的 API、事件和错误码。
- [ ] `lyra-agent-core` 不再是 jcode root_src 的公开重导出容器。
- [ ] `lyra_runtime.rs` 被拆分为多个单一职责模块或 crate，单文件不再承担主流程全部职责。
- [ ] 所有 Agent 面向 UI 的状态都来自结构化 projection，不来自 tool output 猜测。
- [ ] Agent kernel 可以被 Lyra runtime 调用，但不能反向依赖 Desktop 或 `lyrad`。
- [ ] Provider、Tool、Memory、Browser、Software Control 具备清晰注册接口，为后续可插拔做准备。
- [ ] 新 CLI 可以复用同一套 Agent runtime，而不是重新包一套 jcode CLI。
- [ ] `cargo test`、desktop typecheck、结构 lint 能覆盖核心边界。

## 4. 阶段一：边界审计与冻结

目标：先知道当前到底暴露了什么，冻结新增耦合入口，避免一边重构一边继续泄漏。

### 4.1 公开 API 审计

- [ ] 列出 `crates/lyra-agent-core/src/lib.rs` 当前所有 `pub mod`、`pub use`。
- [ ] 将每个公开项分类为：
  - Lyra 稳定 API
  - Lyra runtime 内部实现
  - jcode kernel 内部实现
  - 历史兼容残留
  - 应删除
- [ ] 产出 `docs/architecture/lyra-agent-boundary-audit.md`。
- [ ] 标记 Desktop、`lyrad`、tests 当前使用了哪些 jcode 内部类型。

### 4.2 依赖方向审计

- [ ] 绘制当前依赖方向：
  - Desktop -> preload/main -> runtime-client -> lyrad
  - lyrad -> lyra-agent-core
  - lyra-agent-core -> jcode vendor/root_src
  - jcode vendor/root_src -> Lyra 新增模块
- [ ] 找出反向依赖和循环依赖风险。
- [ ] 明确禁止方向：
  - kernel 不依赖 Desktop
  - kernel 不依赖 `lyrad`
  - API crate 不依赖 runtime
  - Desktop 不依赖 kernel

### 4.3 新增耦合冻结

- [ ] 新增结构 lint，禁止 `apps/desktop` 引用 `jcode_core`、`root_src`、`jcode_*` 内部路径。
- [ ] 新增结构 lint，禁止 `crates/lyrad` 直接暴露 jcode 命名 API。
- [ ] 新增结构 lint，禁止新的 `#[path = "jcode_core/vendor/root_src/..."] pub mod ...` 出现在公共 lib 门面。
- [ ] 在重构期间，所有新增 UI 状态必须先进入 Lyra DTO/projection。

## 5. 阶段二：建立 Lyra Agent API 契约层

目标：先把 Desktop 和 `lyrad` 依赖的公共契约从 `lyra-agent-core` 中抽出来。

### 5.1 新建 `lyra-agent-api`

- [ ] 新建 `crates/lyra-agent-api`。
- [ ] 定义统一错误类型：
  - [ ] `LyraAgentError`
  - [ ] `LyraAgentErrorCode`
  - [ ] `Recoverability`
  - [ ] `UserVisibleSeverity`
- [ ] 定义 session DTO：
  - [ ] `AgentSessionId`
  - [ ] `AgentTurnId`
  - [ ] `AgentSessionSnapshot`
  - [ ] `AgentSessionSummary`
  - [ ] `AgentSessionKind`
  - [ ] `AgentSessionStatus`
- [ ] 定义 message DTO：
  - [ ] `AgentMessage`
  - [ ] `AgentMessageRole`
  - [ ] `AgentContentBlock`
  - [ ] `AgentAttachment`
  - [ ] `AgentCitation`
- [ ] 定义 runtime event：
  - [ ] `AgentRuntimeEvent`
  - [ ] `turnStarted`
  - [ ] `messageDelta`
  - [ ] `messageCommitted`
  - [ ] `toolStarted`
  - [ ] `toolUpdated`
  - [ ] `toolFinished`
  - [ ] `todoUpdated`
  - [ ] `memoryUpdated`
  - [ ] `browserActivityChanged`
  - [ ] `permissionRequested`
  - [ ] `clarificationRequested`
  - [ ] `turnFinished`
  - [ ] `turnFailed`
  - [ ] `turnInterrupted`
- [ ] 定义 tool DTO：
  - [ ] `AgentToolCall`
  - [ ] `AgentToolActivity`
  - [ ] `AgentToolResult`
  - [ ] `AgentToolStatus`
  - [ ] `AgentToolCapabilityRef`
- [ ] 定义 memory projection DTO：
  - [ ] `AgentMemoryProjection`
  - [ ] `PinnedContext`
  - [ ] `ActiveTodo`
  - [ ] `SessionFacts`
  - [ ] `SharedFacts`
  - [ ] `RecoveryState`
- [ ] 定义 software/LCP DTO：
  - [ ] `LyraSoftwareRef`
  - [ ] `LyraSoftwareCapability`
  - [ ] `LyraSoftwareCommand`
  - [ ] `LyraSoftwareEvent`

### 5.2 API 序列化稳定性

- [ ] 所有 DTO 使用 Lyra 命名，不再泄漏 jcode 命名。
- [ ] JSON 序列化统一 camelCase。
- [ ] 新增 snapshot 序列化测试。
- [ ] 新增 runtime event 序列化测试。
- [ ] 新增错误码序列化测试。
- [ ] 新增 Desktop shared type 对齐测试或 typecheck。

### 5.3 迁移 Desktop 契约依赖

- [ ] Desktop shared types 从 `lyra-agent-api` 生成或手动同步。
- [ ] `apps/desktop` 不再依赖任何 jcode 命名字段。
- [ ] AI 面板、TodoBar、工具流、图片附件、链接打开、browser follow 都消费 Lyra DTO。
- [ ] 新增回归测试：工具 output 内出现任意 JSON、DOM 文本、文件名、网页文字，不会被 UI 当成结构化状态。

## 6. 阶段三：拆分 Lyra Runtime 职责

目标：把 `lyra_runtime.rs` 拆成小模块，每个模块有单一职责。

### 6.1 目标模块结构

- [ ] 新建或整理如下 runtime 模块：

```text
crates/lyra-agent-core/src/runtime/
  mod.rs
  session_service.rs
  turn_runner.rs
  event_bus.rs
  event_mapper.rs
  tool_activity_service.rs
  memory_service.rs
  context_builder.rs
  provider_service.rs
  permission_service.rs
  clarification_service.rs
  todo_service.rs
  browser_service.rs
  software_service.rs
  follow_service.rs
  recovery_service.rs
  archive_service.rs
```

- [ ] `session_service` 只负责创建、读取、列表、重命名、归档、删除、绑定项目。
- [ ] `turn_runner` 只负责一轮 Agent 执行生命周期。
- [ ] `event_bus` 只负责事件订阅、广播、缓冲、回放。
- [ ] `event_mapper` 只负责 kernel event -> Lyra event。
- [ ] `tool_activity_service` 只负责工具活动投影。
- [ ] `memory_service` 只负责读写 Agent memory store。
- [ ] `context_builder` 只负责构造模型输入上下文。
- [ ] `provider_service` 只负责 provider profile、model catalog、能力声明。
- [ ] `permission_service` 只负责权限请求和授权结果。
- [ ] `clarification_service` 只负责 Agent 提问工具和 UI 问题面板。
- [ ] `todo_service` 只负责核心 todo 存储和 todo projection。
- [ ] `browser_service` 只负责 Lyra browser/Lumen 能力调度。
- [ ] `software_service` 只负责 LCP/software capability 调度。
- [ ] `follow_service` 只负责 follow 模式和可见操作反馈。
- [ ] `recovery_service` 只负责会话恢复、中断、reset、继续执行。

### 6.2 拆分顺序

- [ ] 先抽出纯 DTO 转换函数，不改变行为。
- [ ] 再抽出纯服务模块，不改变外部 API。
- [ ] 再替换 `lyra_runtime.rs` 内联逻辑为服务调用。
- [ ] 每抽出一个服务，都添加最小单元测试。
- [ ] 每个服务完成后运行对应 Rust 测试。
- [ ] `lyra_runtime.rs` 最终只保留门面函数和向后兼容桥接。

### 6.3 完成标准

- [ ] `lyra_runtime.rs` 不再超过 1500 行。
- [ ] 任一服务文件不超过合理职责范围；超过时继续拆分。
- [ ] Runtime 模块没有 UI 概念。
- [ ] Runtime 模块没有 Desktop IPC 概念。
- [ ] Runtime 模块不直接暴露 jcode 内部类型到 public API。

## 7. 阶段四：内化 jcode kernel，关闭公开泄漏

目标：让 jcode 移植代码成为 Lyra Agent kernel 的内部实现，而不是 public surface。

### 7.1 新建 kernel 边界

- [ ] 新建 `lyra_agent_kernel` 模块或 crate。
- [ ] 定义 kernel 对 runtime 的最小接口：
  - [ ] `KernelSession`
  - [ ] `KernelTurnInput`
  - [ ] `KernelTurnEvent`
  - [ ] `KernelToolCall`
  - [ ] `KernelToolResult`
  - [ ] `KernelProvider`
  - [ ] `KernelCancellation`
- [ ] Runtime 只通过 kernel 接口启动 turn。
- [ ] Kernel 不直接知道 Desktop、LCP UI、TodoBar、AI 面板。

### 7.2 关闭 `pub mod` 泄漏

- [ ] 将当前 `lib.rs` 中 jcode root_src 的 `pub mod` 改为私有或 kernel 内部导出。
- [ ] 对仍被外部依赖的类型建立 Lyra wrapper。
- [ ] 删除不再需要的 `pub use message::{...}` 等 jcode 内部重导出。
- [ ] 删除或迁移 TUI-only 模块的公开入口。
- [ ] 删除或迁移 jcode CLI-only 模块的公开入口。

### 7.3 迁移命名

- [ ] 公共 API 不再出现 `jcode` 命名。
- [ ] 用户可见文案不再出现 jcode 命名。
- [ ] 内部兼容模块可以临时保留 `jcode_compat` 命名。
- [ ] 迁移完成后评估是否将 `jcode_core/vendor` 改名为 `kernel_legacy` 或直接拆 crate。

### 7.4 上游 README/文档清理

- [ ] `crates/lyra-agent-core/README.md` 不再是 jcode 原 README。
- [ ] 新增 Lyra Agent Core README：
  - [ ] 架构图
  - [ ] 模块边界
  - [ ] 如何新增 provider
  - [ ] 如何新增 tool
  - [ ] 如何新增 software adapter
  - [ ] 如何跑测试
  - [ ] 如何从 CLI/daemon 使用 runtime

## 8. 阶段五：物理 crate 重组

目标：在 API 和 runtime 边界稳定后，再迁移物理结构，降低大规模移动风险。

### 8.1 推荐 crate 切分

- [ ] 新增 `crates/lyra-agent-api`。
- [ ] 新增 `crates/lyra-agent-kernel`。
- [ ] 新增 `crates/lyra-agent-runtime`。
- [ ] 保留 `crates/lyra-agent-core` 作为短期兼容 facade。
- [ ] 迁移完成后评估删除 `lyra-agent-core` 或让其成为聚合 re-export crate。

### 8.2 jcode vendor crates 处理

- [ ] 审计 `jcode_core/vendor/crates/*` 中已有子 crate。
- [ ] 将仍需要的子 crate 纳入 workspace 正常依赖。
- [ ] 删除不需要的 TUI、mobile、demo、upstream-only crate。
- [ ] 对需要改造的 crate 重命名为 Lyra 内部 crate。
- [ ] 不再通过 `#[path]` 从 `root_src` 暴力挂载大量模块。

### 8.3 root_src 处理

- [ ] 将 `root_src` 中仍需要的模块分批迁入 kernel/runtime。
- [ ] 每批迁移都要保持测试通过。
- [ ] 每批迁移后删除旧路径引用。
- [ ] 所有路径迁移结束后，删除或冻结 `jcode_core/vendor/root_src`。

## 9. 阶段六：可插拔 Agent 平台能力

目标：为后续软件商店、用户安装软件、第三方扩展、CLI 版打基础。

### 9.1 Provider 插件接口

- [ ] 定义 `ProviderAdapter` trait。
- [ ] 支持 provider capability 声明：
  - [ ] text
  - [ ] image input
  - [ ] tool calling
  - [ ] streaming
  - [ ] reasoning metadata
  - [ ] context window
  - [ ] structured output
- [ ] provider 选择不再只靠字符串。
- [ ] UI provider label 来自结构化 provider profile。
- [ ] 不支持 vision 的模型不能收到 image input。
- [ ] 支持 vision 的模型不能被 UI/bridge 错误剥夺图片能力。

### 9.2 Tool Pack 插件接口

- [ ] 定义 `ToolProvider` trait。
- [ ] 定义工具能力声明：
  - [ ] name
  - [ ] description
  - [ ] schema
  - [ ] risk level
  - [ ] permission policy
  - [ ] UI renderer hint
  - [ ] required host capability
- [ ] 工具执行结果统一进入 `AgentToolActivity`。
- [ ] 工具 UI 只消费结构化 tool activity，不读原始任意 JSON 来推断状态。

### 9.3 Software Adapter / LCP

- [ ] 定义 `SoftwareAdapter` trait。
- [ ] 每个 Lyra 内部软件声明自己的：
  - [ ] readable state
  - [ ] commands
  - [ ] events
  - [ ] permissions
  - [ ] UI affordances
  - [ ] lightweight summary
- [ ] Agent 不直接看到所有软件完整 schema。
- [ ] Runtime 根据任务、当前 workspace、用户授权动态选择暴露最小能力集合。
- [ ] 软件过多时不会导致模型工具列表膨胀。

### 9.4 Browser Operator 插件接口

- [ ] 浏览器操作能力从 runtime 中抽为独立 adapter。
- [ ] 支持隐式操作和 follow 可见操作两种模式。
- [ ] follow 模式下真实展示 Agent 光标、焦点、hover、点击、输入、等待。
- [ ] 隐式模式下不干扰用户鼠标键盘。
- [ ] 支持 selector map、focus scan、weak DOM、必要时视觉 fallback。
- [ ] 支持正式 wait/read_until 能力，禁止用 shell sleep 作为主要等待方案。

### 9.5 Memory Adapter

- [ ] 定义 `MemoryStore` trait。
- [ ] 定义 `MemoryProjectionBuilder` trait。
- [ ] Runtime 不直接依赖某个 SQLite 实现细节。
- [ ] CLI、Desktop、daemon 使用同一套 memory projection。
- [ ] 跨会话记忆、短期上下文、恢复状态、active todos 都走统一投影。

## 10. 阶段七：CLI 版准备

目标：让 Lyra Agent 可以在无 Desktop 的情况下工作，证明核心真的独立。

### 10.1 新建 CLI crate

- [ ] 新建 `crates/lyra-cli`。
- [ ] CLI 只依赖：
  - [ ] `lyra-agent-api`
  - [ ] `lyra-agent-runtime`
  - [ ] 必要的 terminal UI crate
- [ ] CLI 不直接依赖 Desktop。
- [ ] CLI 不直接依赖 jcode root_src。

### 10.2 CLI 最小功能

- [ ] `lyra agent run "prompt"`。
- [ ] `lyra agent chat`。
- [ ] `lyra agent sessions list`。
- [ ] `lyra agent sessions read <id>`。
- [ ] `lyra agent memory search <query>`。
- [ ] `lyra agent provider list`。
- [ ] `lyra agent tools list`。
- [ ] `lyra agent software list`。

### 10.3 CLI 验证价值

- [ ] CLI 可以复用 Desktop 同一套 session/memory。
- [ ] CLI 可以显示同一套 runtime event。
- [ ] CLI 可以调用同一套 tool registry。
- [ ] CLI 可以证明 Agent core 不是 Desktop 附属物。

## 11. 阶段八：测试与质量门禁

### 11.1 Rust 测试

- [ ] `cargo test -p lyra-agent-api`
- [ ] `cargo test -p lyra-agent-kernel`
- [ ] `cargo test -p lyra-agent-runtime`
- [ ] `cargo test -p lyra-agent-core`
- [ ] `cargo test -p lyrad`
- [ ] `cargo check --workspace --tests`

### 11.2 Desktop 测试

- [ ] `npm --prefix apps/desktop run typecheck`
- [ ] `npm --prefix apps/desktop run test -- src/modules/workbench/ai-panel/tests`
- [ ] `npm --prefix apps/desktop run test -- src/main`

### 11.3 结构 lint

- [ ] `pnpm lint:structure`
- [ ] `pnpm lint:rust-first`
- [ ] 新增并通过 `pnpm lint:agent-boundary`
- [ ] 新增并通过 `pnpm lint:no-jcode-public-api`

### 11.4 格式和 diff

- [ ] `cargo fmt --all --check`
- [ ] `git diff --check`

### 11.5 启动验证

- [ ] `npm run dev:desktop`
- [ ] Desktop 能正常启动。
- [ ] `lyrad` 能正常启动。
- [ ] 新建会话能发送消息。
- [ ] 工具调用和消息按事实时间线穿插显示。
- [ ] TodoBar 只消费结构化 todo projection。
- [ ] Memory projection 能跨会话生效。
- [ ] Browser follow 可见操作正常。
- [ ] Provider label 正确。

## 12. 阶段九：迁移完成后的删除清单

目标：重构不是多加一层 wrapper 后继续保留旧混乱结构，最终必须删除旧入口。

- [ ] 删除 Desktop 对旧 agent snapshot 字段的兼容分支。
- [ ] 删除 Runtime 对旧 jcode public event 的兼容分支。
- [ ] 删除任意从 tool input/output 猜 UI 状态的逻辑。
- [ ] 删除旧 `jcode_*_json` 公共 API 或改为内部兼容入口。
- [ ] 删除未使用的 jcode TUI-only 模块。
- [ ] 删除未使用的 jcode CLI-only 模块。
- [ ] 删除旧 README 中 jcode 用户文档。
- [ ] 删除旧路径下不再使用的 root_src 模块。
- [ ] 删除所有新增重构期间的临时 compatibility TODO。

## 13. 风险控制

- [ ] 每个阶段独立提交。
- [ ] 每个阶段保留可启动状态。
- [ ] 不做一次性全仓库移动大提交。
- [ ] 先收敛 public API，再移动物理文件。
- [ ] 大规模 rename 前先确认测试覆盖。
- [ ] 对用户数据、session、memory、provider config 做迁移前备份。
- [ ] 任何删除本地用户数据的操作必须单独确认。

## 14. 推荐执行顺序

1. [ ] 完成阶段一：边界审计与冻结。
2. [ ] 完成阶段二：建立 `lyra-agent-api`。
3. [ ] 完成阶段三：拆分 `lyra_runtime.rs`。
4. [ ] 完成阶段四：内化 jcode kernel，关闭公开泄漏。
5. [ ] 完成阶段五：物理 crate 重组。
6. [ ] 完成阶段六：可插拔 Agent 平台能力。
7. [ ] 完成阶段七：CLI 版准备。
8. [ ] 完成阶段八：测试与质量门禁。
9. [ ] 完成阶段九：删除旧入口。

## 15. 最终验收

- [ ] 根目录有清晰 Agent core 架构文档。
- [ ] `docs/architecture` 有最新架构图和边界说明。
- [ ] `lyra-agent-api` 是唯一稳定公共契约来源。
- [ ] `lyra-agent-runtime` 是唯一运行时编排入口。
- [ ] `lyra-agent-kernel` 是可替换的 Agent 内核实现。
- [ ] `lyrad` 只负责进程边界和路由。
- [ ] Desktop 只消费结构化状态。
- [ ] CLI 可以复用同一套 Agent runtime。
- [ ] 新增 provider/tool/software adapter 不需要改 Desktop 主逻辑。
- [ ] 新增内部软件不会让模型看到膨胀的全部协议。
- [ ] jcode 已经从“外部移植代码容器”转为“Lyra 内部 kernel 实现来源之一”。
