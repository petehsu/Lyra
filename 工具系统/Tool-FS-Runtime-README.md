# Tool-FS Runtime README

本文记录 Lyra Agent Tool-FS 当前实现事实。日常维护以代码和测试为准，本文只保留运行时约定。

## Design principles

Tool-FS 的目标是降低工具数量增长带来的上下文污染和误选工具风险。模型默认只看到少量元工具，通过 `/tools` 按需发现具体能力；普通对话不需要扫描所有工具说明。

生产执行必须保持结构化：支持原生 tool calling 的 provider 使用 provider 原生 tool call 承载 `tool_fs_*`；当前不支持原生 tool calling 的模型不得执行工具。未来如果接入严格 schema/JSON 输出模型，也必须先转换为 `ToolOperationEnvelope` 并经过同一套 validator、policy gate、trace 和 result envelope，不能解析自由文本、Markdown 代码块或自然语言伪工具调用。

Tool-FS 不做“幽灵工具”。模型负责决定何时 list、inspect、run；runtime 负责校验、权限、执行和压缩结果。场景包只能影响 pinned handles 和目录排序，不能隐藏工具、不能扩大 provider-visible schema。

Follow 事件只表达过程状态，例如文件编辑、终端输出、浏览器动作正在发生。模型和 UI 的最终事实来源始终是 `ToolResultEnvelope`、artifact refs、changes 和 trace。

新增工具域时优先复用现有 registry、manifest、adapter 和 projector。不要把 provider 协议转换、Prompt Repetition、外部插件市场或未实现的业务域写进 Tool-FS runtime；这些属于独立系统边界。

## Provider-visible tools

模型只看到 5 个 provider-visible tools：

- `tool_fs_list`
- `tool_fs_read_doc`
- `tool_fs_inspect`
- `tool_fs_run`
- `lyra_turn_finish`

具体业务工具不再作为 provider function schema 暴露。旧 direct tool name 只能作为 runtime adapter 私有标识存在，不得进入 provider schema、prompt context、Tool-FS manifest、inspect 输出或 UI 主标题。

## `/tools` path

所有具体能力通过 `/tools` discover 和 run：

- `/tools/filesystem/*`
- `/tools/code/*`
- `/tools/shell/*`
- `/tools/terminal/*`
- `/tools/git/*`
- `/tools/workbench/*`
- `/tools/browser/*`
- `/tools/software/*`
- `/tools/web/*`
- `/tools/render/*`
- `/tools/todo/*`
- `/tools/memory/*`
- `/tools/design/*`
- `/tools/skills/*`
- `/tools/mcp/*`
- `/tools/runtime/*`

场景只改变 pinned handles 和目录排序，不隐藏工具，也不增加 provider-visible function schema。

`toolFilesystem.manifestSources` 暴露运行时来源摘要：`core_builtin` 是静态 manifest 基座；terminal、design、skills、MCP management、workbench/browser host capability 是静态 handler 来源；software capability 是动态 provider 来源。动态 provider 只能向 registry 注入 `ToolManifest`，不能新增 provider-visible function schema。

## Envelope contract

所有 `tool_fs_run` 都进入：

`ToolOperationEnvelope -> validate -> availability check -> policy gate -> runtime adapter -> ToolResultEnvelope`

`ToolOperationEnvelope` 必须包含 session、turn、path/handle、args、policy snapshot、permission mode、trace id、timeout、risk context 和 output contract。

`ToolResultEnvelope` 是模型和 UI 的最终事实来源，包含 status、content projection、raw/data ref、tool path、domain、operation、artifact refs、changes、trace id、error 和 not-run reason。

## Trace and artifacts

Trace phase 至少覆盖：

- `received`
- `validated`
- `permission_checked`
- `executing`
- `artifact_recorded`
- `completed` / `failed` / `cancelled`

大 raw payload 会写入 artifact，并通过 `dataRef` 返回 compact marker。超长 content projection 会写入 artifact，并通过 `projectionRef` 返回截断 projection。Shell stdout/stderr、文件 diff、文件 before/after snapshot、git mutation diff 等也必须走 artifact refs。

文本 artifact refs 包含短 `preview` 和 `previewTruncated`，UI 可在工具 evidence 面板 inline 展示摘要，同时保留 `openTarget` 打开 canonical artifact。

Runtime load 会执行低价值 artifact retention：超过 7 天的 raw/projection artifact 可被清理；diff、stdout/stderr/log、snapshot、web page、screenshot 等证据 artifact 不在这个低价值清理集合内。

## Adapter rules

Runtime adapter 只接收已解析 manifest 和 envelope args，不负责暴露 public schema。新增工具时先在 Tool-FS registry 增加 manifest，再在 runtime 私有 target 分发中绑定 adapter。

Host-only tools 在 host bridge 不可用时必须返回结构化 `host_unavailable`，不能进入 permission 或 executing 阶段。

Mutation tool 必须返回 `changes`，或者明确 `notRunReason`。

## Turn finish verification

`lyra_turn_finish` 是唯一直接暴露给模型的非 Tool-FS 工具。代码任务结束时应提交 `verificationRecords`：

- `kind`: `test`、`lint`、`typecheck`
- `status`: `passed`、`failed`、`skipped`、`not_run`
- `command`、`summary`、`notRunReason`、`artifactRef` 可选

Runtime 会归一化这些记录，并为缺失的 `test`、`lint`、`typecheck` 自动补 `status: "not_run"` 和 `notRunReason: "not_reported_by_model"`。记录保存到最终 assistant message metadata，用于审计和后续 UI 展示，不污染用户可见 final text。

## Permission policy

Policy 只依赖 manifest、args 和 runtime state，不依赖用户自然语言关键词。

文件写、patch、shell、terminal mutation、git mutation、browser elevation、software invoke 等高风险工具必须生成审批或 full-access/auto-approval 记录。Permission waiting 期间 cancellation 必须立即退出，返回 cancelled envelope，并清理 pending permission。

`permissionMode` 由 runtime envelope 管理：`runtime_policy`/`ask` 走现有审批策略；`deny` 在 adapter 执行前结构化失败；`read_only` 允许只读工具、阻止 mutation；`full_access` 跳过 adapter 内部审批并记录 `policyDecision.mode = "full_access"`。

## Migration

`toolRuntimeSchemaVersion = 3` 是破坏性迁移。低版本启动时删除 Agent sessions，清空 `activeSessionId`、pending permissions 和 pending clarifications。Provider config、memory、skills、goals 保留。

旧 session/tool activity 不做兼容迁移。
