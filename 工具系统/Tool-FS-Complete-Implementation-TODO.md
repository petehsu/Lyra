# Tool-FS 完整实现 TODO

本文是 `Tool-Filesystem-Agent-Design.md` 的落地验收清单。目标不是再描述架构愿景，而是列出必须完成的工程项。只有当本文所有 P0/P1 项完成并通过验收后，才可以认为 Lyra Tool-FS 是文档级完整实现，原架构文档可以删除或归档。

## 状态图例

- `[x]` 已完成并有测试覆盖。
- `[~]` 已部分完成，但还不是最终形态。
- `[ ]` 未完成或缺少明确验收。

## 不扩大范围

- 本轮只覆盖 Lyra 当前真实存在的内置能力和 host 能力。
- 不新增 GitHub、database、email、calendar、package manager、云服务等当前 Lyra 没有的业务工具。
- 旧工具实现可以继续作为 runtime 私有 adapter 复用，但旧 tool name 不得进入 provider schema、prompt context、Tool-FS manifest、inspect 输出、UI 主标题或模型可见工具列表。
- 不引入自由文本工具调用 fallback。只能执行 provider 原生 structured tool calls，或未来严格结构化 envelope adapter。

## 删除架构文档的总验收门槛

- [ ] Provider-visible tools 永远只包含 `tool_fs_list`、`tool_fs_read_doc`、`tool_fs_inspect`、`tool_fs_run`、`lyra_turn_finish`。
- [ ] `/tools` 是所有当前 Lyra 内置/host 工具的唯一 public discovery source。
- [ ] `inspect` 输出只包含 Tool-FS manifest 字段、schema refs 和 input schema，不包含 `legacyName` 或旧 direct tool name。
- [ ] 所有具体工具执行都通过 `tool_fs_run` 进入 `ToolOperationEnvelope -> validate -> policy gate -> runtime adapter -> ToolResultEnvelope`。
- [ ] UI activity、工具卡片、详情面板、artifact 展开都以 `toolPath/domain/operation/manifestTitle/activityKind/rendererHint/traceId/artifactRefs/changes` 为主，不显示 `tool_fs_run` 或旧 direct name 作为业务工具标题。
- [ ] 旧 session/tool activity 兼容解析已经删除，`toolRuntimeSchemaVersion = 3` 破坏性迁移覆盖旧会话清理。
- [ ] 文本 `[Tool call: ...]`、Markdown JSON 片段、自然语言伪工具调用只触发协议错误/重试，不执行。
- [~] Rust core、runtime、UI activity 窄测通过；desktop typecheck 仍被既有 lucide/react `TS2786 ReactNode/bigint` 冲突阻塞，未发现本轮 Tool-FS TS 改动引入的新错误。

## 当前基线

- [x] 已新增 `crates/lyra-tool-fs-core`，包含 manifest、registry、operation/result envelope、change record、trace record、scene package。
- [x] `model_tools()` 和 `model_tool_names()` 主路径已收口到 4 个 `tool_fs_*` 加 `lyra_turn_finish`。
- [x] `tool_fs_run` 已有 envelope、validate、trace、result projection 主流程。
- [x] 静态内置工具大多已有 `/tools/<domain>/<operation>` 路径。
- [x] dynamic software capability 已可通过 `/tools/software/capability/<softwareId>/<actionId>` discover、inspect、run。
- [x] activity 已投影 `toolPath/domain/operation/manifestTitle/activityKind/rendererHint/traceId/artifactRefs/changes`。
- [x] 文本工具调用 fallback 已被测试覆盖为拒绝执行。
- [~] `RuntimeToolManifestProvider` 已改成通用 manifests 聚合器雏形，目前动态来源主要覆盖 software。
- [~] policy gate 已复用现有 permission system，但 validator 和 permission/scope/availability 仍分散。
- [~] artifact/projection/ref 目前是投影和收集，不是完整 canonical artifact store。
- [~] UI 已优先显示 manifest title，但工具详情还未完全只消费 `ToolResultEnvelope`。
- [~] `ToolActivityService` 不再生成 provider-visible tools，但仍保留内部旧 capability catalog。
- [x] workbench/browser/software/terminal host bridge、memory/native/design/skill/MCP 已按 `RuntimeToolTarget` 显式分发，不再先伪装成旧 `ModelToolCall.name` 走旧大分支。

## P0: Public Surface 硬切完成

- [x] `lyra-agent-runtime` 的 `model_tools()` 只返回 4 个 `tool_fs_*` 和 `lyra_turn_finish`。
- [x] `model_tool_names()` 只返回上述 5 个名称。
- [x] 旧 direct tool name 调用返回结构化 `tool_not_found`。
- [x] 删除所有不可达的旧 direct provider schema/fallback 分支。
- [x] 删除 `LYRA_AGENT_DISABLE_TOOL_REGISTRY` 等旧 registry bypass 环境分支；当前 `rg` 无命中。
- [x] 确认 prompt runtime context 的 `tools` 字段只列 provider-visible tool names，不列旧 direct tool names。
- [x] 确认所有 provider adapter 的 allowed tool names 都来自 provider request 的 provider-visible tool schema，不从旧 capability catalog 拼接。
- [x] 增加 snapshot 测试，覆盖 provider request 中的 tool schema 名称。

验收：

```bash
cargo test -p lyra-agent-runtime model_request_injects_lyra_identity_and_tools
cargo test -p lyra-agent-runtime textual_tool_call_is_rejected_before_assistant_text_commit
rg 'LYRA_AGENT_DISABLE_TOOL_REGISTRY' crates/lyra-agent-runtime
```

## P0: Tool-FS Core 成为唯一 Manifest Source

- [x] `ToolManifest` 字段固定为 `path/handle/domain/operation/title/summary/riskLevel/permissionPolicy/inputSchema/outputKind/activityKind/rendererHint`。
- [x] `ToolFsRegistry::with_providers` 支持 provider 注入和去重。
- [x] manifest JSON 不含 `legacyName`。
- [ ] 将所有静态内置 manifest 审计一遍，确保标题、summary、risk、permission、rendererHint 与真实 adapter 行为一致。
- [ ] 给每个 manifest 增加稳定 schema ref 或可追溯 schema id，避免 UI 和测试依赖散落 JSON。
- [ ] registry list 支持目录分页、排序、domain doc、tool doc 的稳定 contract 测试。
- [ ] registry 对 path collision、handle collision、非法 domain/path、空 title/schema 做启动期校验。
- [ ] dynamic provider 注入失败时返回可诊断状态，但不得让 `/tools` 整体失败。

验收：

```bash
cargo test -p lyra-tool-fs-core
cargo test -p lyra-agent-runtime registry_model_tools_have_dispatch_paths_and_unknown_tools_fail_structurally
```

## P0: RuntimeToolManifestProvider 完整聚合

- [x] dynamic software capability provider 已接入。
- [~] 将 `RuntimeToolManifestProvider` 扩展为聚合器，按来源聚合：
  - [ ] built-in static manifests。
  - [ ] terminal action specs。
  - [ ] design tools。
  - [ ] skill registry current state。
  - [x] software host capabilities。
  - [ ] MCP current server/tool state。
  - [ ] workbench/browser host availability。
- [x] provider 注入只影响 `/tools` discoverability，不新增 provider-visible function schema。
- [x] dynamic provider 输出必须先转成 `ToolManifest`，再进入 registry，不允许 UI/runtime 直接拼旧 function schema。
- [x] dynamic tool path 必须稳定、URL-safe、可反向解析。
- [x] dynamic capability 必须支持 list、read_doc、inspect、run 的同一套 registry resolve 流程。
- [ ] host capability 暂不可用时，manifest availability 必须可诊断，不能让模型看到不可执行的假工具。

验收：

```bash
cargo test -p lyra-agent-runtime tool_fs_dynamic_software_capabilities_are_discoverable_and_runnable
cargo test -p lyra-agent-runtime terminal_schema_registry_exposes_complete_agent_surface
```

## P0: RuntimeToolTarget 私有分发收口

- [x] 已引入 `RuntimeToolTarget` enum，dynamic software 不再用 public legacy name 作为路径。
- [x] `RuntimeToolTarget` 覆盖所有当前可执行工具，禁止用 public string 作为半公开分发键。
- [ ] 旧 private tool name 只允许存在于 adapter 内部 mapping，不允许出现在 manifest、prompt、inspect、UI 主标题。
- [x] 将 `execute_tool_fs_target` 改成按 `RuntimeToolTarget` 分发，而不是先映射回 `ModelToolCall { name: old_private_name }` 再走旧执行大分支。
- [ ] 每个 domain 建立独立 adapter 文件，职责单一：
  - [ ] filesystem adapter。
  - [ ] code/search/LSP adapter。
  - [ ] shell adapter。
  - [ ] terminal adapter。
  - [ ] git adapter。
  - [ ] workbench adapter。
  - [ ] browser/Lumen adapter。
  - [ ] software adapter。
  - [ ] web adapter。
  - [ ] render adapter。
  - [ ] todo adapter。
  - [ ] memory adapter。
  - [ ] design adapter。
  - [ ] skill adapter。
  - [ ] MCP adapter。
- [ ] adapter 输入统一接收 `ToolOperationEnvelope` 和 resolved `ToolManifest`，输出统一为 raw execution result，再由 Tool-FS projection 生成 `ToolResultEnvelope`。

验收：

```bash
cargo test -p lyra-agent-runtime
rg 'legacyName' crates/lyra-agent-runtime crates/lyra-tool-fs-core apps/desktop/src
```

## P0: Operation Envelope 和 Validator 完整化

- [x] `ToolOperationEnvelope` 已包含 schemaVersion、opId、sessionId、runtimeTurnId、op、path、args、toolHandle、policySnapshotId、permissionMode、traceId、timeoutMs、riskContext、outputContract、createdAt。
- [x] `tool_fs_run` 已走 envelope validate。
- [~] `tool_fs_list/read_doc/inspect` 已有 envelope，但 runtime 状态校验仍偏轻。
- [ ] 所有 `tool_fs_*` provider input 先归一成完整 `ToolOperationEnvelope`，再进入 validator。
- [ ] validator 强制检查：
  - [x] runtime turn 存在且属于 session。
  - [x] session 状态允许执行。
  - [x] path 或 handle 唯一解析；同时传入 path 和 handle 时必须解析到同一个 manifest。
  - [x] args 是 object。
  - [~] args JSON Schema 校验已覆盖 required、基础 type、enum、minimum/maximum、array item、additionalProperties；完整 JSON Schema 草案级校验仍未引入。
  - [ ] permissionMode 合法。
  - [ ] policySnapshotId 存在且可追溯。
  - [ ] timeout 在工具允许范围内。
  - [ ] workspace scope/project binding。
  - [ ] host capability availability。
  - [ ] cancellation token 状态。
- [~] validator 错误返回结构化 `ToolFsError`/`NativeToolFailure` 并投影为 envelope，包含 code、message、recommendedNextAction、detail；host availability 侧还需继续统一。
- [ ] invalid envelope 不记录为成功工具 activity。

验收：

```bash
cargo test -p lyra-tool-fs-core operation_envelope_validator_checks_runtime_and_args
cargo test -p lyra-agent-runtime tool_fs_hard_cut_hides_legacy_names_and_validates_run_envelope
```

## P0: Policy Gate 统一化

- [x] 现有 permission system 已接入文件写、shell、terminal、browser、software 等高风险工具。
- [ ] 将 policy gate 明确放在 `validated -> permission_checked -> executing` 之间。
- [ ] full-access、ask、deny、read-only 等 permission mode 行为统一记录到 envelope/trace。
- [ ] 文件写、patch、shell、terminal mutation、git mutation、browser elevation、software invoke 必须生成审批或 auto-approval 记录。
- [ ] read-only 工具不得弹权限，除非请求 live login state 或 host 明确要求 elevation。
- [ ] permission 拒绝必须返回 `ToolResultEnvelope { status: failed, notRunReason, trace }`。
- [ ] permission 等待期间 cancellation 必须立即退出并记录 cancelled trace。
- [ ] policy 不能依赖用户文本关键词，只依赖 manifest、args、runtime state。

验收：

```bash
cargo test -p lyra-agent-runtime terminal_host_tools_apply_read_and_write_permission_policy
cargo test -p lyra-agent-runtime permission_request_denies_and_allows_native_file_write
cargo test -p lyra-agent-runtime lumen_live_login_state_requires_permission_even_for_read_tools
```

## P0: ToolResultEnvelope 作为最终结果事实来源

- [x] `ToolResultEnvelope` 已包含 status、durationMs、traceId、ok、content、raw、toolPath、domain、operation、artifacts、artifactRefs、projectionRef、dataRef、stdoutRef、stderrRef、changes、error、notRunReason。
- [x] runtime 已把 target output 包装成 envelope，并保留兼容字段。
- [ ] 所有 adapter 输出都必须由统一 projector 生成 `ToolResultEnvelope`，禁止工具各自返回不同顶层形状给模型。
- [ ] `content` 是模型可读 projection，不是完整 raw dump。
- [ ] `raw` 只能保存可控大小内容；大 raw 必须转 data/artifact ref。
- [ ] `projectionRef/dataRef/stdoutRef/stderrRef` 的语义稳定，UI 能按 ref 展开 canonical artifact。
- [ ] cancellation、permission denied、timeout、host unavailable、validation failed 都必须结构化到 envelope。
- [ ] Follow 事件只能作为过程流，最终判断必须以 `ToolResultEnvelope` 为准。

验收：

```bash
cargo test -p lyra-tool-fs-core result_trace_and_change_records_expose_document_fields
cargo test -p lyra-agent-runtime host_tool_timeout_finishes_activity
```

## P0: Trace 和 Artifact Store 完整化

- [x] 已有 trace record 阶段：received、validated、permission_checked、executing、artifact_recorded、completed/failed/cancelled。
- [~] artifact refs 已被收集和投影；shell stdout/stderr 已写入 artifact ref，但 canonical store/retention 仍不完整。
- [ ] 新增统一 artifact/data store API：
  - [ ] 写入 raw data。
  - [ ] 写入 stdout/stderr/log。
  - [ ] 写入 diff。
  - [ ] 写入 projection。
  - [ ] 支持 UI 展开。
  - [ ] 支持 retention/prune。
- [ ] 大输出统一进入 artifact/data ref，模型只收到 compact projection。
- [ ] 文件 patch/edit 生成 diff artifact。
- [~] shell 生成 stdout/stderr artifact ref；terminal log artifact 仍需继续收口。
- [ ] web/browser 大页面或截图生成 artifact ref，不把 base64 或超大文本塞回模型。
- [ ] 测试/lint/typecheck 若未运行，必须有 not-run 记录，而不是沉默缺失。
- [ ] trace record 持久化或可从 activity/artifact 重建。

验收：

```bash
cargo test -p lyra-agent-runtime tool_retention_prunes_only_old_low_value_raw_payloads
cargo test -p lyra-agent-runtime native_file_tools_enforce_policy_budgets_edits_and_patch_artifacts
```

## P0: ChangeRecord 完整化

- [x] `ToolChangeRecord` 已有 schemaVersion、changeId、kind、operation、path、summary、detail、reversible、beforeRef、afterRef、diffRef。
- [~] 文件变更和部分 mutation 已能推断 changes。
- [ ] 文件写入、edit、multi_edit、apply_patch 必须真实填充 beforeRef/afterRef/diffRef。
- [ ] Git stage/unstage/discard 必须填充 change records，并标记 reversible 风险。
- [~] Shell mutation 已记录 command/process/stdoutRef/stderrRef 且标记不可逆；terminal mutation log ref 仍需继续收口。
- [ ] Browser/software mutation 必须记录外部状态变更摘要。
- [ ] 所有 mutation 工具 result 必须 `changes.len() > 0` 或明确 `notRunReason`。
- [ ] UI 能展示 changes，并把 diff/artifact refs 展开。

验收：

```bash
cargo test -p lyra-agent-runtime stage_unstage_and_discard_are_real_git_mutations
cargo test -p lyra-agent-runtime native_file_tools_enforce_policy_budgets_edits_and_patch_artifacts
```

## P1: Scene Package 完整化

- [x] scene enum 已固定为 general、project-code、git、terminal、browser、workbench、design、automation。
- [x] scene inference 不读用户文本关键词。
- [ ] scene 输入信号固定并完整接入：
  - [ ] sessionKind。
  - [ ] projectBound。
  - [ ] workingDir。
  - [ ] Git repo 状态。
  - [ ] workbench active/focused tab。
  - [ ] terminal state。
  - [ ] browser state。
  - [ ] editor/file state。
  - [ ] design/software state。
  - [ ] active skills。
- [ ] scene 只影响 pinned handles 和 `/tools` 排序，不影响工具可发现性。
- [ ] runtime context 中的 `toolFilesystem.rootSummary` 和 `pinnedHandles` 与当前 scene/state 一致。
- [ ] dynamic provider 的能力可参与排序，但不新增 function schema。

验收：

```bash
cargo test -p lyra-tool-fs-core scene_package_uses_state_signals
cargo test -p lyra-agent-runtime design_prompt_gets_design_tools_and_dynamic_policy
```

## P1: UI Activity 和工具详情彻底切换

- [x] `AgentToolActivity` 已增加 `toolPath/domain/operation/manifestTitle/activityKind/rendererHint/traceId/artifactRefs/changes`。
- [x] 工具卡标题优先显示 manifest title。
- [ ] 工具组标题不得显示 `tool_fs_run`、`Run tool` 或旧 direct tool name。
- [ ] read/edit/search/shell/terminal/web/workbench/lumen/render/task details 全部从 `ToolResultEnvelope.raw/projection/artifactRefs/changes` 读取。
- [ ] 删除旧 session/tool activity 兼容解析逻辑。
- [ ] 空历史和新会话状态适配 schema version 3 破坏性迁移。
- [ ] UI 能展示 traceId、artifactRefs、changes，并支持展开 canonical artifact。
- [ ] UI 对 validation failed、permission denied、cancelled、timeout 有统一状态样式。

验收：

```bash
npm --prefix apps/desktop run test -- agent-session-view-model.test.ts
npm --prefix apps/desktop run typecheck
```

## P1: Session Migration 完成

- [x] 已有低版本清空 sessions、activeSessionId、pending permissions、pending clarifications 的测试。
- [ ] `toolRuntimeSchemaVersion = 3` 在所有 native state load/save 路径一致。
- [ ] 旧 session 文件删除失败时必须有诊断，不得半迁移。
- [ ] 保留 provider config、memory、skills、goals 的回归测试覆盖。
- [ ] 删除旧 tool activity 兼容读取逻辑后，历史空状态仍正常。
- [ ] 文档明确升级行为是破坏性迁移，不做备份、不迁移旧 activity。

验收：

```bash
cargo test -p lyra-agent-runtime native_state_schema_upgrade_clears_legacy_tool_sessions
```

## P1: Provider 协议清理

- [x] streaming/non-stream textual tool call 已被拒绝执行。
- [ ] 所有 provider reply normalization 只接受原生 structured tool calls。
- [ ] 只支持自由文本的模型不得执行工具，必须降级为普通对话或提示切换模型。
- [ ] 非原生 tool-calling 但支持严格 schema 输出的模型，只能通过未来 `ToolOperationEnvelope` adapter 执行。
- [ ] textual marker 出现时记录 protocol error 和 retry evidence，不写入 assistant 正文造成污染。
- [ ] provider tool choice/allowed names 测试覆盖 streaming、non-streaming、retry、fallback。

验收：

```bash
cargo test -p lyra-agent-runtime streaming_textual_tool_call_is_rejected
cargo test -p lyra-agent-runtime textual_tool_call_is_rejected_before_assistant_text_commit
cargo test -p lyra-agent-runtime non_stream_tool_call_parser_preserves_invalid_arguments_as_evidence
```

## P1: 测试矩阵补齐

- [x] core registry/envelope/scene 基础测试已存在。
- [x] runtime hard cut、dynamic software、textual rejection 基础测试已存在。
- [ ] Core tests：
  - [ ] list/read_doc/inspect/run resolve。
  - [ ] path lookup/handle lookup/page 分页。
  - [ ] schema refs。
  - [ ] manifest JSON 不含 legacy name。
  - [ ] unknown path/handle。
  - [ ] invalid args 完整 JSON Schema 校验。
  - [ ] scene 不读用户文本。
- [ ] Runtime tests：
  - [ ] 每个内置 domain 至少一个代表性 read 工具通过 `tool_fs_run`。
  - [ ] 每个 mutation domain 至少一个工具返回 changes。
  - [ ] file patch、shell permission、terminal route、browser route、memory/todo/render/web route。
  - [ ] skills、MCP、design、software dynamic provider discover/inspect/run。
  - [ ] cancellation、permission denied、timeout、host unavailable 结构化。
  - [ ] 大输出 artifact/data ref。
- [ ] UI tests：
  - [ ] manifest title。
  - [ ] rendererHint/activityKind 分类。
  - [ ] artifactRefs/changes/traceId 渲染。
  - [ ] 旧会话清空后空状态。
- [ ] Integration tests：
  - [ ] 代码任务通过 pinned handle 完成 read/search/apply_patch/run_command/git_status/git_diff。
  - [ ] 浏览器任务通过 `/tools/browser/*` 调用 host capability。
  - [ ] 软件能力通过 `/tools/software/capability/*` 调用 host capability。
  - [ ] MCP/skill/design 工具可 discover、inspect、run。

## P1: 清理和删除条件

- [ ] 删除或归档 `Tool-Filesystem-Agent-Design.md` 前，本文所有 P0/P1 必须完成。
- [ ] 新增短文档 `Tool-FS-Runtime-README.md`，只保留最终架构事实：
  - [ ] provider-visible tools。
  - [ ] `/tools` path 规范。
  - [ ] envelope/result/trace/artifact contract。
  - [ ] adapter 开发方式。
  - [ ] permission policy。
  - [ ] migration 行为。
- [ ] 原架构文档中仍有价值但非实现细节的内容迁移到 README 或 ADR。
- [ ] 代码中所有 TODO/注释不得引用已删除架构文档作为唯一事实来源。
- [ ] `rg` 检查旧 public surface：

```bash
rg 'legacyName' crates apps
rg 'LYRA_AGENT_DISABLE_TOOL_REGISTRY' crates apps
rg 'model_tool_provider_json|with_additional_properties' crates/lyra-agent-runtime
rg 'Tool call:' crates/lyra-agent-runtime/src/native_backend --glob '*.rs'
```

## 最终验收命令

删除或归档架构文档前必须全部通过：

```bash
cargo test -p lyra-tool-fs-core
cargo test -p lyra-agent-runtime
npm --prefix apps/desktop run test -- agent-session-view-model.test.ts
npm --prefix apps/desktop run typecheck
```

如果 `npm --prefix apps/desktop run typecheck` 被仓库已有 lucide/react 类型冲突阻塞，必须先修复该全局类型问题，不能把完整架构验收建立在过滤日志上。

## 完成定义

当以上 P0/P1 全部完成，并且最终验收命令全部通过时，才可以认为：

- Tool-FS 是 Lyra Agent 工具系统的唯一 public 架构。
- 旧 direct tool surface 已经从模型、prompt、manifest、inspect、UI 展示中退出。
- 旧工具实现只作为私有 adapter 存在。
- 架构文档可以删除或归档，日常维护以最终 README/ADR 和测试为准。
