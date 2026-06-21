# Lyra Dynamic Prompt Delivery Design

## 目标

Lyra 当前每轮都会重新拼接完整系统提示词。这个方案的目标是同时做到两件事：

1. 利用 provider prefix cache：稳定提示尽量固定、靠前、可缓存。
2. 真正减少后续轮次发送的输入 token：首轮或刷新轮发送完整提示，普通后续轮发送精简提示。

设计目标不是简单少发，而是 **几乎不降低 Agent 能力**。关键原则是：不能把能力建立在“模型应该还记得上轮系统提示”这种不可靠假设上；必须每轮保留最小安全内核，并在需要时自动刷新完整提示。

## 当前状态

当前主链路：

- `crates/lyra-agent-runtime/src/native_backend/turns.rs` 每轮调用 `build_system_prompt(...)`。
- `crates/lyra-agent-runtime/src/prompt_policy.rs` 将 persona、沟通风格、工具策略、citation/image/browser/computer policy、memory、runtime context 拼成一条 system prompt。
- `crates/lyra-agent-runtime/src/context_builder.rs` 将这条 prompt 作为 provider messages 的第一条 system message。
- 上下文裁剪主要裁 session messages，不裁 system prompt。
- post-turn session trim 会把旧消息归档到 cut pack，并进入 system recall index。

这意味着目前每轮都会重新发送完整提示。即使 provider 能做 prefix cache，完整提示仍然占上下文窗口。

另一个关键事实：OpenAI Responses 当前请求体使用 `store: false`。因此默认不能假设 provider 端保存上一轮系统提示。除非引入 provider-specific stateful conversation 能力，否则后续轮次少发时必须自己携带一份足够强的最小提示。

## 2026-06-22 实施状态

已落地：

- `PromptRuntimeContract` 已集中在 `crates/lyra-agent-runtime/src/prompt_contract.rs`，初始版本均为 `1`。
- Prompt 已迁移到 MiniJinja 模板文件，Rust 仍负责 mode、scene、hash、token estimate、refresh trigger。
- `prompt_policy.rs` 已移除旧的大段 raw prompt helper；提示词正文归档到 `src/prompts/*.md.j2`，Rust 保留 typed input、section registry、scene selection、hash/accounting/report 和守护测试。
- `build_system_prompt_report(...)` 已输出 prompt、mode、refresh reason、contract、section hashes、section reports、scene modules、missed module recovery、prompt token estimate、lean saved token estimate、omitted stable tokens、prefix-cache eligible tokens。
- 默认仍为 `full`；`LYRA_PROMPT_DELIVERY_MODE=lean-experimental` 才允许 lean，且首次会话、contract mismatch、context trim、prompt hash change 会强制 full refresh。
- 上一轮工具失败和最新用户纠正信号已接入 runtime context 的 `promptRecoverySignals`，并会让 lean mode 在下一轮升级为 full refresh。
- session snapshot 已持久化 `promptRuntimeContract` 与 `promptDelivery`，包括 scene/accounting/recovery 元数据。
- Tool-FS `list` 已改成 compact entry；完整 `description`、`examples`、`aliases`、`inputSchema` 仍只在 `inspect`/doc 路径出现。
- `/tools` doc 已缩短为 discovery 协议，长 playbooks 移到 `/tools/playbooks`。
- `tools/verify-prompt-contract.ts` 已接入 `pnpm check` 和 CI，并带 `--self-test` fixture 验证 gate 行为；snapshot ack 已收紧为 prompt/context/memory/runtime/Tool-FS 相关快照，避免无关 snapshot 绕过受保护路径。
- 已新增 snapshot/eval scaffold：
  - `crates/lyra-agent-runtime/tests/prompt_snapshots.rs` 固定 full prompt report、lean prompt report、runtime context、memory injection、section hashes/token accounting。
  - `crates/lyra-tool-fs-core/tests/tool_discovery_snapshots.rs` 固定 Tool-FS root/doc/playbooks、compact list、常见中英文 human intent search 投影。

仍为实验或后续增强：

- Lean prompt 仍不默认开启，需要继续跑 full-vs-lean eval。
- Stateful provider prompt inheritance 只作为 OpenAI Responses 实验兼容入口；默认关闭，不承诺降低 billed input tokens，也尚未作为跨 turn session state 的默认路径持久化。
- Scene module 检测当前采用保守规则与最新用户文本意图；tool failure/user correction 现在已作为 full refresh 恢复信号接入，但连续误匹配、具体 scene module 延续和更细粒度的工具轨迹 telemetry 仍可继续增强。
- Tool-FS 搜索已增加中英文 intent boost，但搜索词库可以继续扩展；扩展必须继续停留在 catalog/search 层，不回流常驻 prompt。
- Full-vs-lean 自动评测仍是 scaffold，还不是覆盖真实任务成功率的完整 eval harness。

## Prompt 分层

### P0: Always Safety Kernel

每轮必须发送。目标大小：约 600-1000 tokens。

内容：

- Lyra 名称和最高优先级身份约束。
- 工具调用必须使用 provider structured tool call，不能文本伪造。
- 不编造完成状态；代码任务必须有证据或说明无法验证。
- 敏感值只传 ref，不泄露 plaintext。
- 当前用户消息和最新 runtime context 优先于旧摘要。
- 遇到缺能力、缺权限、需要用户输入时正常报告。

P0 是能力不退化的底线。即使所有其他稳定提示都省略，P0 也必须足以防止身份漂移、工具协议漂移、敏感值泄露和虚假完成。

### P1: Compact Identity And Operating Contract

普通后续轮默认发送。目标大小：约 500-1000 tokens。

内容：

- 用极短形式覆盖 team-lead voice、不要称呼用户为 user、不要客服式结尾。
- 工作类任务必须先用工具调查，不凭记忆描述代码库。
- Computer-first 工作合同：Lyra 坐在一台公司电脑前，电脑能力很多，不需要预先背工具名。
- 需要电脑能力时，先用普通人类意图搜索能力；搜索不确定时浏览能力目录；只 inspect 当前候选；再 run 最小相关能力。
- 不在 P1 常驻具体真实工具路径或工具链。代码、浏览器、终端、Git、软件等能力都通过发现获得。

P1 不是完整提示的摘要，而是可执行的最小工作合同。它必须独立可用。

### P2: Full Stable Contract

首轮、刷新轮、风险轮发送。目标是保持现有完整能力。

内容来自当前 `prompt_policy.rs` 中大部分稳定段：

- 完整 persona。
- communication style。
- transcript/page/image citation protocol。
- full cross-tool policy：structured tool call、证据、验证、敏感值、权限、失败恢复。
- network/sensitive/verification policy。
- Computer-first discovery policy。
- 少量高风险场景的通用禁令和恢复原则。
- 不包含真实工具路径清单；browser/computer/code/git 等详细操作规程通过 P3、Tool-FS domain docs 或 inspect docs 按需获得。

P2 可以每隔一段时间刷新，但普通轮不必总发。

### P3: Scene Modules

按场景条件注入。目标是把长规则从全局 prompt 移到场景 prompt。

候选模块：

- Browser/Lumen policy。
- Computer use policy。
- Design research policy。
- Inline image attachment policy。
- Page/transcript citation policy。
- Large Tool-FS scenario playbooks, preferably as references to Tool-FS docs rather than inline catalogs。

例如普通代码任务不需要完整 browser/computer 操作规程；当 latest user、active tool scene、workbench state 或工具错误显示需要浏览器/桌面能力时，再注入对应模块。

### P4: Dynamic Runtime Context

每轮发送，但必须压缩。

内容：

- 当前时间、设备、网络、模型能力。
- active skills。
- Tool-FS scene、pinned handles、presearch hints。
- workbench/browser/software state。
- prompt accounting。

P4 是动态的，所以应该放在 prompt 后部。稳定段必须靠前，最大化 prefix cache。

### P5: Memory And Recall Injection

每轮按需发送。

内容：

- pinned context。
- selected long-term memory。
- system recall records。

这些不替代系统提示。它们只负责事实、偏好、项目上下文和旧会话召回。

## Computer-First Tool Discovery

Tool-FS 的核心价值不是“把所有真实工具换一种格式告诉模型”，而是让模型拥有一台可发现能力的电脑。

当前风险是：虽然 provider-visible tools 已经被压缩成少量 Tool-FS meta tools，但系统提示仍然写了大量具体工具路径、场景 playbook 和固定链路。例如浏览器、终端、代码编辑、Git、视觉兜底等规则如果长期常驻 prompt，本质上还是在让模型背工具清单。这样工具越多，prompt 越长，Tool-FS 的设计初衷会被削弱。

目标心智模型：

- Lyra 坐在一台公司电脑前，不是“处于 IDE/Workbench/终端里”。
- 这台电脑能力很多，能读文件、操作软件、访问网页、运行命令、管理项目、使用外部能力，但 Lyra 不需要预先记住每个能力。
- 当任务需要电脑时，Lyra 像人一样先判断“我需要什么能力”，再搜索或浏览电脑能力。
- 搜索能用自然语言、中文、英文、错拼、宽泛意图和具体动作。
- 搜索不到或结果不确定时，打开能力目录逐层找，而不是要求系统提示提前列出所有工具。
- 找到候选能力后再读取说明、检查参数、执行最小相关动作。
- 成功使用过的能力由 inspected descriptor cache、usage cache、pinned handles 和 presearch hints 帮助复用，而不是靠全局 prompt 背诵。

### 最小常驻协议

系统提示中长期常驻的工具协议应该缩到类似下面的级别：

```text
You have a company computer with discoverable capabilities.
When work needs the computer, search capabilities by ordinary intent.
If search is weak, browse the capability directory.
Inspect only the capability you plan to use.
Run the smallest relevant capability.
After success, reuse known handles/descriptors from the session instead of rediscovering.
```

这段只教“怎么发现和使用能力”，不教“有哪些具体能力”。除 Tool-FS meta tools 和少数协议级直连工具外，base prompt 不应该常驻真实工具路径。

### 工具知识下沉位置

具体工具知识应该放在 Tool-FS 内部，而不是系统提示：

- `/tools` 根文档：只说明搜索、列目录、读文档、inspect、run 的发现流程。
- `/tools/<domain>` 文档：说明该 domain 的短摘要和选择建议。
- `tool_fs_search` 结果：返回 path、handle、summary、runHint、miniSchema、matchReason、recommendedNextAction。
- `tool_fs_inspect` 结果：返回完整 schema、风险、权限、示例和该能力自己的短 playbook。
- `tool_fs_run` 失败结果：给出下一步恢复建议，例如换查询、列目录、重新 inspect、不要重复同样参数。
- `inspectedDescriptors`：会话内已经看过的能力摘要，避免重复 inspect。
- `cachedHandles`：近期成功能力的轻量推荐，帮助复用但不能替代搜索。
- `presearchHints`：运行时根据最新用户消息预搜索，清楚匹配时可直接减少一次 search。

这样以后新增 50 个或 500 个工具，都主要增长 Tool-FS catalog/search/index，而不是增长 system prompt。

### 搜索能力要求

如果 Agent 搜不到“浏览器”“browser”“brower”“打开网页”“操作页面”“终端”“terminal”“命令行”“跑测试”等自然意图，应该优先修 Tool-FS 搜索和 catalog metadata，而不是继续往系统提示里加说明。

搜索应支持：

- 中英文别名和常见错拼。
- path、handle、title、summary、description、aliases、examples、tags、schema 文本的统一索引。
- 意图 boost，例如打开网址、网页搜索、页内查找、终端命令、文件编辑、代码搜索、Git 状态、桌面软件操作。
- scene 只影响排序和 pinned handles，不影响可发现性。
- 无强匹配时返回最可能的 fallback list path，而不是空结果让模型死路。
- 结果中给出足够小的 `miniSchema`，让模型能在简单场景直接 run；复杂场景再 inspect。

### Prompt 预算原则

基础提示词只允许出现：

- Tool-FS meta tools 的用途。
- “像人使用电脑一样发现能力”的操作协议。
- 工具调用必须走 structured tool call 的协议约束。
- 安全、敏感值、证据、验证、失败恢复这些跨工具规则。

基础提示词不应该常驻：

- 具体真实工具路径列表。
- 浏览器、终端、代码、Git、桌面软件的完整工具链。
- 大段 scenario playbooks。
- 每个 domain 的详细策略。
- 因为某个搜索 query 当前匹配不好而临时追加的提示词补丁。

如果确实有领域策略必须保留，也应作为 P3 场景模块或 Tool-FS domain doc 按需出现，而不是 P0/P1/P2 永久常驻。

## Prompt Contract Gate

动态提示、记忆架构、上下文管理和裁剪策略存在强耦合。不能只靠文档提醒开发者“记得检查提示词”。Lyra 需要一个强制性的 prompt contract gate：相关架构变化没有更新或确认 prompt contract 时，CI 直接失败；运行时发现 contract 不一致时，自动 full refresh。

### 版本化合同

新增一个集中定义的 `PromptRuntimeContract`，至少包含：

- `promptPolicyVersion`
- `promptTemplateVersion`
- `memoryProjectionVersion`
- `contextProjectionVersion`
- `retentionPolicyVersion`
- `toolDiscoveryContractVersion`
- `runtimeContextSchemaVersion`
- `promptDeliveryModeVersion`

这些 version 不只是显示用 metadata，而是 prompt builder、context builder、session trim、memory projection 和 runtime context 的握手协议。

原则：

- memory/context/trim 输出结构变化，必须 bump 对应 projection version。
- prompt 读取或解释这些结构的方式变化，必须 bump prompt policy/template version。
- Tool-FS discovery 心智模型或 provider-visible meta tools 变化，必须 bump tool discovery contract version。
- lean/full/stateful delivery 触发规则变化，必须 bump prompt delivery mode version。

### CI 强制门禁

CI 增加 touched-file gate。以下路径发生变更时，必须满足至少一个条件：

- 更新相关 contract version。
- 更新 prompt snapshot 或 projection snapshot。
- 添加一条显式 prompt-contract audit 记录，说明本次变更不影响提示词/记忆/上下文投影。

建议纳入 gate 的路径：

- `crates/lyra-agent-runtime/src/prompt_policy.rs`
- `crates/lyra-agent-runtime/src/context_builder.rs`
- `crates/lyra-agent-runtime/src/retention_policy.rs`
- `crates/lyra-agent-runtime/src/memory_service.rs`
- `crates/lyra-agent-runtime/src/native_backend/context.rs`
- `crates/lyra-agent-runtime/src/native_backend/session_trim/**`
- `crates/lyra-agent-runtime/src/native_backend/context_window/**`
- `crates/lyra-tool-fs-core/src/model.rs`
- `crates/lyra-tool-fs-core/src/registry.rs`
- `crates/lyra-tool-fs-core/src/catalog/**`

这不是要求每次都必须改 prompt 文案；而是要求每次相关系统变化都必须被 contract gate 看见。没有影响也要留下机器可检查的确认。

### Required Tests

门禁应绑定这些测试或 snapshot：

- Full prompt snapshot。
- Lean prompt snapshot。
- Runtime context projection snapshot。
- Memory projection snapshot。
- Trim/compact message snapshot。
- Tool-FS runtime context snapshot。
- Prompt accounting snapshot。
- Contract version compatibility test。

如果 context trim、memory injection、system recall、Tool-FS discovery 或 prompt delivery mode 变化，snapshot 必须变化；如果 snapshot 不变化，必须有 audit ack 解释为什么。

### Runtime Enforcement

运行时也要做防漏：

- session 保存 `lastPromptRuntimeContract`。
- 每轮 build prompt 前对比当前 contract。
- 如果 memory/context/trim/tool discovery contract 不一致，本轮强制 `promptMode = full`。
- full refresh 后更新 session 里的 contract。
- 如果 provider stateful path 的 contract 不一致，废弃旧 provider state id，重新发送完整合同。

这样即使 CI 漏掉，用户长会话里也不会继续用旧提示合同解释新上下文结构。

### Audit Artifact

可以新增一个小型机器可读文件，例如：

```text
crates/lyra-agent-runtime/src/prompt_contract_audit.toml
```

内容示例：

```toml
prompt_policy_version = 3
memory_projection_version = 2
context_projection_version = 4
retention_policy_version = 2
tool_discovery_contract_version = 2

[[acks]]
id = "2026-06-dynamic-prompt-contract"
paths = ["crates/lyra-agent-runtime/src/retention_policy.rs"]
reason = "Trim thresholds changed only; compacted context marker shape unchanged."
reviewed_prompt_contract = true
```

CI 可以检查：相关路径变更时，version/snapshot/audit ack 三者至少命中一个。

## Tool Catalog Description Token Boundary

工具描述应该变多，但不能重新回到 prompt token 膨胀。正确边界是：描述增长发生在 Tool-FS catalog/search index 中，只有搜索、列目录、读文档、inspect 某个具体能力时，相关片段才进入模型上下文。

### 描述分层

Tool-FS manifest 建议区分这些字段：

- `summary`: 短摘要，允许出现在 search/list 结果。
- `aliases`: 中英文别名、常见错拼、高频简称，用于搜索，可少量返回。
- `intentPhrases`: 用户自然表达，例如“打开网页”“跑测试”“改文件”“查看 git diff”，主要用于搜索索引。
- `examples`: 简短任务例子，用于搜索和 inspect。
- `description`: 较长能力说明，只在 inspect/read_doc 时返回。
- `playbook`: 该能力自己的小流程，只在 inspect/read_doc 或明确需要时返回。
- `searchOnlyText`: 只进搜索索引，默认永不返回给模型。
- `negativeHints`: 降低误匹配，例如“不是网页搜索”“不是文件搜索”。

这样可以大胆扩展匹配词、中文词、错拼词和自然任务表达，同时避免每轮 system prompt 变长。

### Token 影响

描述增多的 token 影响分三类：

- 不影响每轮 prompt：catalog 内部字段、搜索索引、searchOnlyText。
- 按需少量影响：`tool_fs_search` 返回 top results 的 summary/miniSchema/runHint。
- 按需较大影响：`tool_fs_inspect` 或 `tool_fs_read_doc` 返回某个具体能力的长 description/playbook/schema。

所以新增工具描述不会像 system prompt 那样每轮付费。成本从“每轮固定成本”变成“发现工具时的按需成本”。

### Search Quality Priority

如果 Agent 搜不到常见意图，应优先改 catalog/search，而不是加 prompt 补丁。

优先级：

1. 增加 aliases 和 intentPhrases。
2. 增加中文、英文、错拼和口语表达。
3. 调整 search field weights。
4. 增加 intent boost 或 negative boost。
5. 改进 fallback list path。
6. 最后才考虑 P3 场景模块。

不要因为某个 query 匹配不好，就把具体工具路径写回 P0/P1/P2。那会让 Tool-FS 退回工具说明书模式。

### Result Budget

为了防止 search/list 自身变胖，需要给返回结果设预算：

- `tool_fs_search`: 默认 top 5-8，每条只返回 title、summary、handle、path、runHint、miniSchema、matchReason。
- `tool_fs_list`: domain list 只返回短 summary，不返回长 description。
- `tool_fs_read_doc`: 返回 domain 或 tool doc，可分页或分 section。
- `tool_fs_inspect`: 返回完整 schema 和局部 playbook，但只针对一个能力。
- 任何长字段都应可被 projection/truncation 管理，并提供 read-more path。

## 两条执行路径

### A. Stateless Safe-Lean Path

适用于当前默认 provider 请求模式，包括 `store: false` 或没有可靠 server-side conversation state 的 provider。

首轮：

- 发送 P0 + P1 + P2 + relevant P3 + P4 + P5。
- 记录 `promptEpoch`、`fullPromptHash`、`toolManifestHash`、`modelRouteId`、`activeSkillHash`。

普通后续轮：

- 发送 P0 + P1 + relevant P3 + P4 + P5。
- 不发送完整 P2。

刷新轮：

- 发送 P0 + P1 + P2 + relevant P3 + P4 + P5。
- 更新 `lastFullPromptTurn` 和 refresh reason。

这条路径是真正少发 token，但不依赖模型记忆。能力保持依赖 P0/P1 的设计质量，以及 P3 场景注入是否准确。

### B. Stateful Provider Path

适用于 provider 明确支持 server-side conversation state，且 Lyra 能保存并恢复 provider conversation id / previous response id 的情况。

首轮：

- 发送完整 P0 + P1 + P2 + P3 + P4 + P5。
- 请求 provider 保存会话状态。
- 记录 provider state id。

后续轮：

- 发送 P0 + P4 + P5，以及场景变化需要的 P3。
- 通过 provider state id 继承先前完整 instructions。

刷新轮：

- 当 prompt hash、model、tools、skills、裁剪、错误恢复等发生变化时，重新发送完整合同并更新 provider state。

这条路径节省最多，但只能作为 provider capability 驱动的优化，不能成为通用默认假设。

## 刷新触发器

以下任一条件触发 full refresh：

- 新会话第一轮。
- `fullPromptHash` 变化。
- Lyra 版本或 prompt policy version 变化。
- provider、model、protocol route 变化。
- tool manifest hash 或 Tool-FS provider-visible tools 变化。
- active skill set 或 active skill prompt 变化。
- design/browser/computer 场景从未激活变为激活。
- provider context compacted 或 session trim 发生。
- cut archive 写入后，下一轮需要从裁剪后的上下文继续。
- 连续 recoverable failure 达到阈值。
- 模型出现协议漂移：文本伪造工具调用、缺少最终回答、错误使用敏感值、忽略工具证据。
- 用户要求改变 Lyra 身份、语气、工作方式，或记忆/偏好发生高优先级更新。
- 周期性刷新：例如每 8-12 个用户轮，或每新增 24k-40k session tokens。

刷新触发器应记录到 runtime context，便于调试：

- `promptMode`: `full | lean | stateful-lean`
- `refreshReason`
- `promptEpoch`
- `fullPromptHash`
- `stableKernelHash`
- `sceneModules`
- `estimatedPromptTokens`
- `estimatedSavedTokens`

## 上下文裁剪的配合

当前有两类裁剪：

1. Provider request 前裁剪：只影响本轮 provider context。
2. Post-turn session trim：会把旧消息归档到 cut pack，并索引到 system recall。

动态提示应与裁剪这样配合：

- provider request 前如果发生裁剪，本轮直接升级为 full refresh。
- post-turn session trim 完成后，下一轮升级为 full refresh。
- full refresh 后，system recall 和 pinned context 仍然保留，因为它们恢复的是被裁掉的事实和任务状态，不是系统协议。
- 裁剪提示消息本身可以缩短，但必须说明“旧上下文已被 Lyra 裁剪，最新用户意图、pinned memory、tool evidence 优先”。

## 能力不退化策略

为了做到几乎无影响，不能只做 token 裁剪，还要加保护网。

### 1. P0/P1 必须可独立执行

普通 lean turn 不能只有一句 “follow previous instructions”。P0/P1 必须覆盖：

- 身份底线。
- 工具协议。
- 证据和验证。
- 敏感值。
- 电脑能力发现流程。
- Tool-FS search/list/inspect/run 协议。
- 不把具体真实工具路径当作常驻知识。

### 2. 场景检测宁可多注入，不要漏注入

P3 模块的目标不是极限省 token，而是把长规则从全局常驻变成按需常驻。

场景检测应保守：

- 用户提到浏览器、网页、登录、按钮、表单、页面、截图时注入 browser。
- 用户提到桌面 app、窗口、macOS app、原生 GUI 时注入 computer。
- 用户提到 UI、设计、页面、视觉、frontend、layout 时注入 design。
- 消息含 page citation、transcript citation、inline image metadata 时注入对应 protocol。
- 相关工具刚失败或刚被使用过时，下轮继续注入该模块。

### 3. 漂移检测自动升级

如果模型在 lean mode 下出现这些迹象，下一次立刻 full refresh：

- 把工具调用写成文本。
- 忘记最终回答。
- 声称无法访问已有工具。
- 使用 “AI assistant / user” 这类禁用身份措辞。
- 在代码任务未验证时声称完成。
- 对 sensitive value 请求明文。
- browser/computer 操作出现重复无进展。

### 4. 失败恢复用 full refresh

连续失败、provider retry、context overflow retry、image downgrade、tool output 大量截断后，都应该暂时回 full mode。省 token 不能压过恢复能力。

## Token 节省估算

当前静态提示正文约 22KB，粗略折算约 4.5k-6k tokens。实际每轮还有 runtime context、memory、tool schemas 等动态部分，不能全部省掉。

目标模式：

- Full turn：P0 + P1 + P2 + P3 + P4 + P5，约等于当前完整提示。
- Lean turn：P0 + P1 + selected P3 + P4 + P5。

保守估计：

- P0 + P1 约 1.1k-2k tokens。
- 普通非 browser/computer lean turn 可少发约 3k-5k tokens。
- 如果 browser/computer/design 模块未激活，再多省约 1k-2k tokens。

单独看“真实工具描述下沉”的收益：

- 从 always-on prompt 删除具体工具路径、固定工具链和长 scenario playbooks，预计每轮少发约 1.5k-3k input tokens。
- 去掉 system prompt 与 runtime context 中重复出现的 Tool-FS playbooks，预计每轮再少发数百 tokens。
- 工具 catalog 描述变长不计入每轮固定 prompt，只在 search/list/inspect/read_doc 按需进入上下文。
- 因此工具数量继续增长时，固定 prompt token 应保持近似稳定，增长主要体现在 Tool-FS catalog/index，而不是 provider request。

会话级估算：

- 10 轮会话，首轮 full、后 9 轮 lean：少发约 27k-45k input tokens。
- 20 轮会话，每 10 轮 refresh 一次：少发约 54k-90k input tokens。
- 对 32k/64k 上下文模型，单轮节省 3k-5k tokens 很明显。
- 对 200k 上下文模型，主要收益是成本和延迟，其次才是 overflow 风险。

如果启用 stateful provider path，节省可能更高，但必须按 provider 能力单独验证。

## Prompt 模板化设计

当前 Lyra 的提示词主要写在 Rust 源码中，例如 `prompt_policy.rs` 里的大段 raw string。这样短期简单，类型安全也强，但提示词继续变长后，会带来几个问题：

- 自然语言 prompt 混在 Rust 代码里，diff 可读性差。
- 非 Rust 逻辑变更也要改 Rust 文件，review 成本高。
- 很难把 P0/P1/P2/P3 分层和 prompt section 独立审计。
- 很难让 prompt 文案、产品语气、能力策略做独立 snapshot review。
- 动态 prompt delivery 需要 section hash、section accounting、scene module selection，纯字符串拼接会越来越重。

Zed 使用 `system_prompt.hbs` 的优势不只是文件后缀，而是它配套了：

- typed render context。
- Handlebars strict mode。
- embed templates。
- render tests。
- 条件段清晰可读。

Lyra 可以吸收这个方向，但不建议照搬成一个巨大的 `system_prompt.hbs`。Lyra 的动态策略比 Zed 更复杂，尤其是 full/lean、scene module、refresh trigger、token accounting、provider stateful fallback。这些决策应该留在 Rust 中，而不是塞进模板语言。

### 推荐架构

采用 **Rust typed prompt engine + 模板文件/partials** 的混合方案。

Rust 负责：

- 选择 `promptMode`: `full | lean | stateful-lean`。
- 决定 P0/P1/P2/P3/P4/P5 哪些 section 进入本轮。
- 判断 scene modules。
- 计算 section hash、full prompt hash、token estimate。
- 触发 full refresh。
- 注入 runtime context、memory、Tool-FS hints。
- 维护测试和协议级约束。

模板负责：

- 大段自然语言策略文本。
- section 内部的少量条件文案。
- prompt 文案可读性和 review。
- P0/P1/P2/P3 的模块化正文。

### 推荐目录

建议新增类似结构：

- `crates/lyra-agent-runtime/src/prompt_policy.rs`
  - 保留 typed input、mode decision、section selection。
- `crates/lyra-agent-runtime/src/prompt_templates.rs`
  - 加载和渲染模板。
- `crates/lyra-agent-runtime/src/prompts/kernel.hbs`
  - P0 always safety kernel。
- `crates/lyra-agent-runtime/src/prompts/compact_contract.hbs`
  - P1 compact operating contract。
- `crates/lyra-agent-runtime/src/prompts/full_contract.hbs`
  - P2 full stable contract。
- `crates/lyra-agent-runtime/src/prompts/sections/browser.hbs`
  - Browser/Lumen scene module。
- `crates/lyra-agent-runtime/src/prompts/sections/computer.hbs`
  - Computer use scene module。
- `crates/lyra-agent-runtime/src/prompts/sections/design.hbs`
  - Design research scene module。
- `crates/lyra-agent-runtime/src/prompts/sections/citations.hbs`
  - transcript/page citation module。
- `crates/lyra-agent-runtime/src/prompts/sections/images.hbs`
  - inline image attachment module。
- `crates/lyra-agent-runtime/src/prompts/dynamic_context.hbs`
  - P4 runtime context wrapper。
- `crates/lyra-agent-runtime/src/prompts/memory_context.hbs`
  - P5 memory and recall wrapper。

不要把所有文本放进一个大模板。每个 section 独立，方便计算 token、hash、测试和按需注入。

### 模板引擎选择

候选：

- Handlebars：和 Zed 一致，语法简单，适合少量条件和循环。
- MiniJinja：表达能力更强，但更容易把业务逻辑写进模板。
- Askama：编译期模板检查强，但更适合 HTML/固定模板，动态 section registry 会重一些。

推荐先用 Handlebars 或 MiniJinja，但必须满足：

- strict mode。
- 模板随 binary embed。
- 渲染 context 是 Rust typed struct，不直接传散装 JSON。
- 模板里禁止复杂业务逻辑。
- 对 prompt 文本默认不做 HTML escaping。

最后一点非常重要：Handlebars 默认会 HTML escape，prompt 里通常不希望出现 `&quot;`、`&gt;`、`&#x27;`。Lyra 需要统一采用 no-escape policy，或只对明确需要的字段使用 raw interpolation，并用测试防止 HTML entity 泄漏。

### 模板上下文

建议定义强类型 context：

- `PromptRenderContext`
  - `persona`
  - `prompt_mode`
  - `selected_sections`
  - `scene_modules`
  - `active_skills`
  - `runtime_context`
  - `memory_context`
  - `tool_filesystem`
  - `accounting`
  - `refresh_reason`

每个 section 也可以有自己的 context，例如：

- `KernelPromptContext`
- `ToolStrategyPromptContext`
- `BrowserPromptContext`
- `MemoryPromptContext`

这样可以避免模板里写大量 `{{#if runtime_context.foo.bar}}`，也避免字段缺失静默失败。

### Section Registry

动态 prompt delivery 需要一个 section registry，而不是简单 `sections.join("\n\n")`。

每个 section 建议包含：

- `id`
- `layer`: `P0 | P1 | P2 | P3 | P4 | P5`
- `template_name`
- `mode_policy`: `always | full_only | lean_allowed | scene_only`
- `scene`
- `version`
- `hash`
- `estimated_tokens`
- `refresh_sensitive`

渲染后输出：

- `rendered_text`
- `section_token_estimate`
- `section_hash`
- `omitted_in_lean`
- `refresh_reason_if_required`

这能直接服务 token accounting、prefix cache、full refresh 和 eval。

### 测试要求

模板化后必须增加测试，否则 prompt 重构风险很高。

最低测试：

- Full prompt snapshot。
- Lean prompt snapshot。
- P0/P1 必须包含关键协议句。
- Full prompt 必须包含 browser/computer/design/citation/image 的完整段。
- Lean prompt 在非相关场景不包含大型 P3。
- Browser 场景必须包含 browser P3。
- Computer 场景必须包含 computer P3。
- Design 场景必须包含 design P3。
- 模板渲染不能出现 HTML escaped artifacts，例如 `&quot;`、`&gt;`。
- 所有模板 strict render 通过。
- section hash 变化可被检测。
- token accounting 总和与完整 prompt 估算一致。

还应保留现有行为断言，例如身份规则、Tool-FS 策略、verification policy、sensitive value policy。

### 迁移策略

模板化应该分阶段做，避免一次性改动影响 Agent 行为。

第一阶段：行为不变迁移。

- 将现有 `prompt_policy.rs` 大段 raw string 迁到模板文件。
- Rust 仍然按原顺序渲染完整 prompt。
- snapshot 证明新旧 prompt 等价或差异极小。

第二阶段：section registry。

- 每段 prompt 有 id、layer、hash、token estimate。
- 输出 prompt accounting。
- 行为仍保持 full mode。

第三阶段：动态 delivery。

- 引入 P0/P1/P2/P3/P4/P5。
- 默认 full mode。
- lean mode 只作为实验开关。

第四阶段：scene modules。

- Browser/computer/design/citation/image 按场景注入。
- 漏注入自动 full refresh。

第五阶段：stateful provider path。

- provider 支持时再启用 server-side state 优化。
- 不支持时回到 stateless safe-lean。

### 不建议的做法

不要：

- 把所有 prompt 塞进一个巨大 `system_prompt.hbs`。
- 在 hbs 里实现 refresh trigger、scene inference、token budget。
- 让模板直接读取散装 JSON 并深层判断业务状态。
- 依赖模板条件替代 Rust 类型检查。
- 只为了“更像 Zed”而迁移。
- 引入模板后不做 snapshot/eval。

模板化的价值是让 prompt 文案变得可读、可审计、可分层、可计量。动态行为仍然应该由 Rust 控制。

## 实施计划

### Phase 1: 只观测，不改变行为

- 给 prompt builder 增加 section id 和 token estimate。
- 输出 prompt accounting：P0/P1/P2/P3/P4/P5 分项。
- 记录当前每轮完整 prompt token、runtime context token、memory token。
- 为 full prompt hash、tool manifest hash、active skill hash 建字段。
- 新增 `PromptRuntimeContract` 和 contract version 字段，但先只记录不阻断。
- 新增 full/lean/runtime-context/memory/trim projection snapshot 基线。

成功标准：行为完全不变，只得到准确数据。

### Phase 2: Prompt Contract Gate

- 开启 touched-file CI gate。
- memory/context/retention/session_trim/Tool-FS/prompt 相关路径变更时，必须更新 version、snapshot 或 audit ack。
- 运行时保存 `lastPromptRuntimeContract`，contract mismatch 时强制 full refresh。
- provider stateful path 在 contract mismatch 时丢弃旧 state id。

成功标准：相关架构变更不能绕过 prompt contract 检查；误报可以通过 audit ack 明确关闭。

### Phase 3: 稳定段前置，提升 prefix cache

- 将稳定段放在 system prompt 最前。
- 将 current time、runtime context、memory、presearch hints 放后面。
- 去掉重复注入，例如 Tool-FS scenario playbooks 不应同时出现在 base prompt 和 runtime context。
- 从 always-on prompt 移除具体真实工具路径和长工具链说明，只保留 computer-first discovery 协议。
- 将 browser/code/shell/git/computer 等具体策略下沉到 Tool-FS domain docs、inspect docs、search hints 或 P3 场景模块。
- 为 Tool-FS manifest 增加 aliases/intentPhrases/searchOnlyText/negativeHints 等搜索字段，不让这些字段默认进入 prompt。

成功标准：完整提示仍每轮发送，但缓存命中更稳定，测试无行为差异。

### Phase 4: 引入 Lean Prompt 实验开关

- 新增 `promptDeliveryMode`: `full | lean-experimental | stateful-lean-experimental`。
- 默认仍 full。
- lean mode 每轮发送 P0 + computer-first P1 + selected P3 + P4 + P5。
- full refresh triggers 全部生效。

成功标准：内部 eval 下 lean 与 full 的工具选择、最终答案、验证行为无明显差异。

### Phase 5: 场景模块化

- Browser/computer/design/citation/image 模块按 scene 注入。
- 场景检测先保守，允许多注入。
- 记录每轮 sceneModules 和 missedModuleRecovery。

成功标准：token 明显下降，浏览器/桌面/设计任务成功率不低于 full baseline。

### Phase 6: Stateful Provider 支持

- 为 provider route 增加 `supports_stateful_prompt_contract`。
- 保存 provider conversation state id。
- full refresh 时更新 state id。
- provider 不支持或恢复失败时自动退回 stateless safe-lean。

成功标准：stateful path 不影响跨 provider 兼容性，失败可无感降级。

## 验证计划

必须建立 full vs lean 对照 eval：

- 身份和称呼：不自称 AI/assistant，不称用户为 user。
- 代码任务：先查文件，修改后验证，最终说明测试结果。
- Tool-FS：能用自然语言 search，弱匹配时 list 浏览目录，inspect 当前候选，run 最小相关能力，不伪造工具调用。
- Memory：能使用 injected memory 和 system recall，但不把旧记忆压过最新用户消息。
- Browser：即使 base prompt 不常驻浏览器工具链，也能通过“浏览器/网页/页面操作”等意图发现相关能力并完成任务。
- Computer：即使 base prompt 不常驻桌面工具链，也能通过“电脑/应用/窗口/桌面操作”等意图发现相关能力并语义化验证。
- Sensitive value：只用 ref，不要明文。
- Image/citation：有附件/引用时正确处理，没附件时不乱编。
- Failure recovery：连续失败后 full refresh，并改变策略。
- Contract gate：修改 memory/context/trim/Tool-FS/prompt 相关路径时，CI 能强制要求 version、snapshot 或 audit ack；运行时 contract mismatch 会触发 full refresh。

上线门槛：

- critical protocol failures: 0。
- identity drift: 0。
- sensitive value violations: 0。
- tool-call textual leak 不高于 full baseline。
- prompt contract gate bypass: 0。
- 代码任务 pass rate 不低于 full baseline。
- browser/computer/design 任务成功率不低于 full baseline。
- 平均 input prompt tokens 下降至少 25%-40%，长会话下降更明显。

## 风险和处理

### 风险：模型忘记完整细节

处理：P0/P1 独立可执行；P3 保守注入；漂移后 full refresh。

### 风险：scene 检测漏掉模块

处理：先宁可多注入；工具失败和用户纠正都触发下一轮 full/P3 refresh。

### 风险：provider 不支持状态继承

处理：stateful path 只做能力开关；默认 stateless safe-lean。

### 风险：省 token 后影响少数复杂任务

处理：复杂度高、工具多、上下文接近裁剪、连续失败时自动 full mode。

### 风险：缓存优化和少发优化混在一起难判断

处理：日志分开记录 `prefixCacheEligibleTokens` 和 `omittedStableTokens`。

## 推荐默认策略

短期默认：

- 仍使用 full prompt。
- 先做 section accounting 和稳定段前置。
- 立刻去掉重复注入。
- 开始删除 always-on prompt 中的具体工具路径清单，把这些说明搬到 Tool-FS catalog/doc/inspect。

中期默认：

- 普通代码/聊天任务启用 stateless safe-lean。
- browser/computer/design 任务自动注入相关 P3。
- 大多数任务依赖 computer-first discovery，而不是依赖常驻工具 playbook。
- 裁剪、失败、模型/工具变化后 full refresh。

长期默认：

- provider 支持可靠 stateful conversation 时启用 stateful-lean。
- 否则使用 stateless safe-lean。
- 所有模式都有 full refresh 和漂移检测兜底。

## 结论

这个方案有意义，但正确目标不是“让模型自己记住系统提示”，而是：

- 每轮保留足够强的最小工作合同。
- 只在需要时发送完整稳定合同。
- 让 Agent 知道自己有一台可发现能力的电脑，而不是背一份不断膨胀的工具说明书。
- 动态上下文继续每轮发送。
- 稀有场景规则按需注入。
- 裁剪、失败和能力变化自动 full refresh。

这样既能真正减少后续轮次输入 token，也能把 Agent 能力影响控制到几乎不可感知。
