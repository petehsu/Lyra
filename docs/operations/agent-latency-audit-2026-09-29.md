# Agent 响应链路调查：Lyra 与四个参考项目

调查日期：2026-09-29。对象为当前工作区，包含先前尚未提交的修改；不是只审查 Git HEAD。

结论：存在可复现的本地等待和可避免的额外工作。最明确的缺陷是后端流式批处理没有真正的到期刷新；前置宿主查询、HTTP 客户端生命周期、工具启动时机和记忆维护也有改进空间。不能据此断言四个参考产品在相同模型下整体都更快。

本次只新增诊断桥、测量脚本和报告，没有修改产品运行逻辑，没有新增旧版兼容或迁移代码。

## 1. 固定观察动作与测量边界

用户最终应在桌面中重复的动作：

1. 启动应用，新建项目会话，发送“只回复 OK”；观察点击发送到首段文字。
2. 同一个会话再次发送；比较第一次与后续发送。
3. 请求读取 README.md 后回答；观察工具何时开始、结束后何时继续回答。
4. 观察零散文字输出遇到停顿时，已经收到的内容是否及时显示。

为隔离模型和公网影响，用实际 Rust runtime、临时项目、本地 HTTP 模拟模型复现对应后端链路。没有访问用户聊天或调用付费服务。模拟宿主返回空工作区和软件目录；并非实际 Electron renderer。

每个场景连续 3 轮；每组使用新进程、新数据目录。计时终点是 Node 收到 runtime 事件，**不是屏幕绘制完成**。Rust 为 debug 构建，绝对数字不能当成发布版耗时。受控增加的 600/800/100ms 是实验条件，不是声称真实服务商固定慢这么久。

入口：

- `crates/lyra-agent-runtime/examples/agent_latency_fixture.rs`
- `tools/diagnostics/agent-latency.mjs`
- [测量摘要](assets/agent-latency-2026-09-29/results.json)
- [分词器预热对照](assets/agent-latency-2026-09-29/prewarmed-results.json)
- [原始事件时序](assets/agent-latency-2026-09-29/traces.json)

复现：

```sh
cargo build -p lyra-agent-runtime --example agent_latency_fixture
node tools/diagnostics/agent-latency.mjs
LYRA_AUDIT_PREWARM_TOKENIZER=1 node tools/diagnostics/agent-latency.mjs baseline
```

使用仓库要求的 Node 24。结果写入 `tmp/agent-latency/`；预热组写入其 `prewarmed/` 子目录。

## 2. 实测结果

| 场景 | 结果 | 可以得出的结论 |
| --- | --- | --- |
| 普通短回复，宿主立即返回 | 热轮发送到 HTTP 请求约 168–188ms；模型文字到 runtime delta 约 1.7–3.2ms | 健康连续输出时，没有普遍的几百毫秒文字转发延迟 |
| 每次宿主查询人为延迟 100ms | 每轮 7 次查询；热轮发请求约 864–866ms | 串行宿主查询把等待相加，增加约 0.7 秒 |
| 第一段只发送 `Hi`，暂停 600ms 再发后续文字 | 三轮第一条 `messageDelta` 分别晚 601.4、601.9、602.9ms | 16ms 配置没有保证待发送文字在 16ms 到期时送出 |
| Chat Completions：完整工具参数后暂停 800ms 再结束响应 | 工具约 829–833ms 后启动 | 当前执行在整轮解析完成之后；该协议示例不能仅凭 JSON 完整推定参数已最终确定 |
| Anthropic：工具 `content_block_stop` 后暂停 800ms 再结束响应 | 工具约 830–834ms 后启动 | 即使协议已明确结束该工具输入，也未与余下响应重叠执行 |
| 读取文件后继续请求 | 工具结束到下一次主模型请求，Chat 约 39–55ms，Anthropic 约 43–51ms | 本场景没有发现工具结束后固定等待几秒的屏障 |
| 3 轮短回复 | 3 次 HTTP 请求、3 条 TCP 连接 | 当前未跨请求复用连接 |
| 3 轮“读文件后回答” | 6 次主模型请求，加 3 次非流式后台记忆请求，共 9 条 TCP 连接 | 一次普通成功读文件也触发额外模型工作 |
| 冷进程首次发送 vs 分词器预热对照 | 首次发请求 1793.7ms；预热后 209.6ms；预热本身 1563ms | 本 debug 实验中，大部分首次点击成本来自分词器初始化；预热只是移动成本 |

## 3. 具体发现、原因与参考做法

### A. 已确认缺陷：16ms 批处理没有自主到期刷新

Lyra 的 `StreamDeltaBatcher` 把字符数阈值设为 32 bytes、等待阈值设为 16ms，但 `flush_if_ready()` 只在 `push_visible` / `push_reasoning` 时执行。OpenAI SSE parser 等待 `reader.next_line().await` 时，没有同时等待一次刷新定时器。

因此，如果少量文字在上次刷新后的 16ms 内到达、后续流暂停，这部分文字会继续留在缓冲区，直到下一次 push 或响应结束。实验已经排除了 React 渲染：runtime 的 `messageDelta` 本身就晚发了约 600ms。真实服务商是否触发，取决于分块大小和间隔；并不是所有回复都延迟。

证据：

- `native_backend/turns/messages.rs:525`，`StreamDeltaBatcher`。
- `native_backend/provider/protocol_mapping.rs:964`，异步 Chat SSE 循环。
- `native_backend/providers/protocol/anthropic_messages/stream.rs:94`，同类等待结构。
- 前端 `apps/desktop/src/modules/workbench/agent-session-view-model/stream-store.ts:17` 另有实际 `setTimeout` 批处理；不能把它与后端仅检查 elapsed 的行为混为一谈。

参考：Zed `crates/agent/src/thread.rs:2877` 先处理已经到达的事件，再合并立即可取的事件；ZCode `model-streaming-event-queue.ts:14` 用有序写队列隔离事件落盘和 provider 读取，积压到 128 才施加背压；OpenCode `session/processor.ts:513` 收到文字增量就发布对应 part 的 delta。它们在这些路径上不会为了等待下一块数据而扣住已经可以显示的小段文字。

建议：首段及时发出，剩余批次由真实截止时间驱动；保持结束、错误、取消边界的顺序。不把后端缓冲和前端帧批处理重复扩大。验收必须覆盖“发一小段后暂停”的流，不能只测试整段立即结束的流。

### B. 前置查询工作过多，且与界面响应耦合

空工作区、没有浏览器任务时，每个新用户回合仍顺序执行：

1. `software.listCapabilities(includeSchemas=true)`
2. `workbench.listTabs`
3. `software.listCapabilities(includeSchemas=false)`
4. `workbench.browser.readSessionSnapshot`
5. `agent.readSpatiotemporalContext`
6. `agent.readHostPersonaContext`
7. `agent.readPersonaConsent`

两次软件能力查询都要通过 Electron 主进程向 renderer 发消息。主进程桥默认等待上限 5 秒；Rust 外层宿主调用默认上限 15 秒。这里不是说正常请求都会超时，而是**界面忙会拖延模型请求发出**。时空上下文处理器内部还再次调用 `listTabs`。

证据：

- `native_backend/turns/provider_request.rs:435`、`:625`、`:646`。
- `native_backend/context.rs:172`、`:200`、`:247`、`:429`。
- `apps/desktop/src/main/agent/software-capability-host.ts:19`、`:62`、`:70`。
- `apps/desktop/src/main/agent/workbench-observation-adapter.ts:613`。

Hermes 的系统提示按稳定、项目、易变信息分层缓存，常规回合复用会话快照；其代码没有在这个流程里每次重新采集同样的提示输入。Zed 也会每轮刷新工具集，不能说所有参考都完全不刷新，但它读取线程已有状态，而不是这里的两次软件目录 renderer 往返。

建议：复用一份宿主快照，配置变动时更新；避免每回合重复取得同一目录。只在当前任务需要时读取较重的浏览器恢复信息。当前权限与项目开关的执行前校验继续保留，不能为了缓存而绕过。

### C. HTTP 客户端生命周期太短

`provider/protocol_mapping.rs:342` 的 Chat 请求每次调用 `provider_http_client_builder_async(...).build()`；Responses、Anthropic、Gemini、Ollama 路径也分别重复构建。连接池属于 client，构建新 client 无法利用前一个 client 的池。

本地 keep-alive 服务实测连续 3 次请求用了 3 条 TCP 连接。测试没有 TLS，所以这里只证明未复用，**没有测得公网 DNS/TLS/代理握手究竟增加多少毫秒**。

Zed 的 OpenAI provider 持有 `Arc<dyn HttpClient>`，每次克隆句柄；Hermes 的 `agent/client_lifecycle.py:426` 在参数匹配时复用 request client slot，异常或参数变化才替换。[reqwest 官方文档](https://docs.rs/reqwest/latest/reqwest/struct.Client.html)也明确建议复用持有连接池的 client。

建议：在合理生命周期内复用客户端，保持请求级凭据和超时、代理配置的正确隔离；配置变化时失效。先测同一服务连续工具回合的连接次数，再比较真实网络上的等待。

### D. 工具已可执行时，仍等待整轮模型响应完成

Lyra `provider/model_loop.rs:114` 先 await 整个 `call_model_once_for_loop_async`，之后约 `:1020` 才进入工具执行；Anthropic parser 在 `finish_streaming_reply` 中归并工具调用。

对照：

- ZCode `runtime/methods/streaming-tool-coordinator.ts:54` 收到完整调用后开始工具；`:339` 严格检查 readOnly、concurrentSafe、非 destructive、无需 approval、无用户交互、sideEffectScope=none。
- Zed `crates/agent/src/thread.rs:3478` 按事件创建工具 task；只对明确支持输入流的工具传 partial，其他工具等输入完整。
- OpenCode `session/llm/native-runtime.ts:103` 对 `tool-call` fork 工具执行，继续消费 provider stream，收尾时等待未完成工具。
- Hermes 普通 tool round 在模型响应之后执行工具，这一点与 Lyra 相似；它的优势是安全的批次分段，而非所有工具都提前启动。

建议首先模仿 ZCode 的较窄边界：**仅允许已确认输入结束、可安全并发的只读工具提前执行**。不能靠“JSON 现在能解析”判断未来不会再改参数；Chat Completions 与 Anthropic/Responses 的结束信号不同。写文件、需要确认或有顺序依赖的工具不可直接照搬并行。

本次 Anthropic 实验特意发送 `content_block_stop` 再等 800ms，避免将 Chat 的输入未最终结束误判为可优化时机。后续修复仍需覆盖中断、重试、去重和副作用边界。

### E. 工具后的后台记忆工作过于频繁

`activity.rs:284` 对成功结束的工具生成 memory trigger；`memory_event_trigger.rs:18` 先落库入队，再启动后台线程。`memory_autonomy.rs:27` 每个事件调用一次非流式模型，未配置专用记忆模型时使用默认主模型。

实验每轮只读一次小文件，均观察到额外记忆请求。这些请求与主链路并行，不能说主模型必须等它们结束。但它们会增加服务商侧请求数、token 消耗和潜在限流竞争。该非流式路径直接 `.send()`，未经过主回合的 `scheduled_provider_request_async`；单 worker 不等于与主回合共享了预算。当前 4 秒 per-job budget 是完成后的检查日志，不会在 4 秒取消底层请求。

ZCode 在成功 turn 完成后调度提取，合并 pending 快照，并跳过无合格用户正文、已经直接写过记忆等情况；不会在每一个普通工具成功后都用同一规则发一遍提取请求。OpenCode 的会话摘要放在后台 fiber，压缩另按上下文条件触发。

建议：按回合和有效新信息合并记忆候选，在后台限流并让前台请求优先；普通读取、重复结果不应机械触发模型分析。不能简单删除持久化或记忆功能。

### F. 首次点击承担分词器初始化

`turns.rs:207` 添加用户消息时，`helpers.rs:137` → `mark_dialog_dirty_from` → `touch_session` → `refresh_token_estimate_if_stale` 触发 token 估计；`lyra-agent-reader/src/budget.rs:36` 首次初始化 `o200k_base_singleton()`。

仅在诊断桥提前调用一次 `estimate_tokens("warmup")` 后，首次发送到请求从 1793.7ms 降至 209.6ms，初始化本身耗时 1563ms。该对照支持冷初始化是本 debug 实验的主要原因。不能把这个数值直接用于发布版。

建议：在空闲准备阶段完成必要初始化，或避免 UI 用量显示迫使发送入口承担完整初始化；精确上下文预算仍需正确计算。验收同时观察应用启动和首次发送，不能只把卡顿搬到启动画面。

## 4. 已有正确设计，以及尚未确认的因素

- **已经有工具并行**：`model_loop.rs:1047` 把多个调用交给共享 Tokio 批次监督；浏览器相关调用还保持顺序。因此“把工具全部改并行”不是本次的根治方案。
- **普通工具后没有全量重建前置上下文**：`:1432` 仅在工具目录 revision 或管理操作改变时重建工具 schema。本实验工具完成后约 39–55ms 即发后续主请求。
- **已经有稳定缓存前缀**：连续 3 轮的第一条 system message 和工具定义 hash 均相同；易变上下文在后部。不能说 Lyra 每轮都把 prompt cache 打坏了。真实缓存命中率需服务商 usage 数据。
- **不是每个 token 都整段 Markdown 渲染/同步落盘**：后端发送原始增量，前端 StreamStore 分帧通知；生产 `save_state()` 使用延迟持久化。调试测试环境的同步保存不能冒充生产行为。
- **请求内容仍可审查**：空项目首个 Chat 请求约 50KB，其中 26 个工具的 schema 约 39.5KB、system 消息约 10.4KB。这是字节数，不是 token 数；没有跑四个产品同配置 prompt 对比，不能单凭尺寸断言它一定比参考更臃肿。懒加载工具已经存在，过度隐藏常用工具还会增加一次搜索回合。
- **配置远程 embedding 时有额外风险**：`memory_store/internal.rs:308` 在请求准备中查询 embedding；缺失记录向量时可现场补建，`embedding_tail.rs:211` 的网络请求有 30 秒超时。默认本地 hash 不承担这个网络成本，本次未开启远程 embedding，没有把它记作实测主因。
- **异常恢复确实可能多次请求**：无正文、reasoning-only、限流、断流等有各自恢复分支。正常实验未触发这些分支；不能为了变快无条件移除恢复，应该展示原因并区分实际物理请求。
- **未做完整桌面 paint 与长历史基准**：本轮没有测 Electron 点击至像素呈现、几百轮历史、真实 MCP 服务响应、真实服务商排队、不同模型 reasoning effort。此前的 UI 修复保留，不能用这份后端报告为所有可见卡顿签收。

## 5. 四个参考项目：做什么、不做什么

| 项目 | 读取到的实际做法 | 不做什么 / 边界 |
| --- | --- | --- |
| ZCode | 流式事件有序异步写队列；安全只读工具提前执行；回合完成后合并记忆提取 | 不让每次 token 落库阻塞读流；不提前执行需批准或有副作用的工具；不把每个读文件结果都机械当成一次独立记忆提取 |
| Hermes | 会话提示词分层缓存；匹配配置的 HTTP client 复用；工具按路径冲突分段并行 | 不每轮重建不变提示输入；不让冲突写操作跨过顺序屏障；普通流程也会等完整模型回复后执行工具 |
| Zed | 合并已经到达的流事件；工具 task 与模型流重叠；持有共享 HTTP client | 不为了凑固定批次而等未来事件；非流式输入工具不使用半截参数；上下文需要压缩时仍会等待压缩 |
| OpenCode | 原生 LLM 路径在完整 tool-call 后 fork 执行；文字 delta 直接更新 part；后台摘要与条件压缩 | 不把后台摘要当成每段回复的同步前置条件；但请求前仍可能做 Git snapshot，不能宣称它没有本地前置成本 |

参考版本固定为本地 checkout：ZCode `872ad96`、hermes-agent `d62716c704`、zed `d9e1c024f3`、opencode `f69beceaff`。这是源码路径比较，不是运行四个 GUI 得出的速度排名。

外部主文档交叉核对：[Hermes 压缩与缓存](https://hermes-agent.nousresearch.com/docs/developer-guide/context-compression-and-caching)、[OpenCode 压缩](https://opencode.ai/v2/docs/compaction)。具体代码结论以本地上述版本为准。

## 6. 修复顺序与验收

1. 修复流式到期刷新；保持小段后暂停的实验，确认界面也能及时看到已有文字。
2. 合并前置宿主快照、复用 HTTP client；界面繁忙时发送普通问题，不应重复等无关能力目录；连续工具回合应能复用可用连接。
3. 降低后台记忆触发频率并统一请求预算；多次读文件不会线性增加无价值模型调用。
4. 处理冷初始化；同时测启动和首次点击。
5. 基于各协议的明确输入完成事件，引入安全只读工具与流的重叠执行；保留权限、顺序、取消和执行去重。

最终验收还需要在实际桌面重复第 1 节的点击动作，并用相同 provider、model、reasoning effort、项目和输入对照。模拟实验能定位等待发生在哪里，不能替代这个可见验收。

验证：诊断 example 构建成功；5 个场景各 3 轮完成，另做 3 轮预热对照；脚本语法检查、`git diff --check` 通过。`pnpm lint:structure` 仍报告此前已有的 5 项：`state.rs`、`tools/file.rs`、`tools/web.rs` 超过模块行数基线，以及 `main/index.ts:1129`、`main/storage/roots.ts:212` 的存储根目录规则；没有新增报告项。没有产品实现变更，因此没有把先前整库检查结果冒充本次修复验收。
