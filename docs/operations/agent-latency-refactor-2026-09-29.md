# Agent 延迟重构：2026-09-29

本次针对 [诊断报告](agent-latency-audit-2026-09-29.md) 中确认的等待点重构。保留当前工作区已有的项目设置、Markdown、主题和拖拽修复，没有增加旧版兼容分支。修改尚未提交。

## 固定验收动作

1. 新建项目会话，发送“只回复 OK”，再连续发送两次。
2. 发送“读取 README.md，然后回复 OK”，观察工具开始、完成及回复。
3. 模型先发送两个字符，暂停 600 毫秒，再继续；文字应在暂停期间显示。
4. 工具参数明确完成后，模型暂停 800 毫秒再收尾；安全读操作可以在此期间执行。仅仅拼出合法 JSON 不能被当成参数完成。

模拟服务只使用临时项目、合成内容和测试凭据。数值是本机 debug 构建的受控实验，不能代表在线模型的推理速度或真实网络延迟。浏览器检查使用真实 ChatView、StreamStore、StreamingText 和样式；原生事件经测试桥接到组件，未覆盖完整 Electron IPC 与所有工作区负载。

## 对照参考项目后的工作边界

| 位置 | 参考项目的做法／拒绝的工作 | Lyra 的改动 |
| --- | --- | --- |
| 流式文本 | OpenCode 直接发布文本增量；Zed 消费已有事件，不等待未来事件来释放已收到的文本 | 删除后端靠下一次 push 才检查时间的批处理器。每次增量立即进入事件通道，界面仍用现有 16ms 定时器合并刷新 |
| 请求准备 | Hermes 区分稳定系统信息、会话上下文和动态信息，不重复生成全部稳定内容 | 软件目录在变更时发布；发送时用一次 `agent.readTurnContext` 捕获目录、工作区、时间及授权信息，工作区只读取一次，没有浏览器页时不取浏览器恢复快照 |
| HTTP 传输 | Hermes 复用匹配的客户端；Zed 的 provider 共享 HTTP 客户端 | 复用连接池，认证仍逐请求附加。代理设置变化时替换连接池，已执行请求保留自己的客户端 |
| 记忆提取 | ZCode 在整轮结束后调度记忆工作，不为每个只读工具开模型请求 | 移除逐工具触发。成功轮次的实际文件变更合并为一个有界事件；读文件、搜索、状态查询不触发记忆模型。后台请求排在前台和工作 Agent 后，并有实际超时取消 |
| 工具与生成重叠 | ZCode 只允许无交互的只读工具提前执行；OpenCode/Zed 在接收模型事件时可以调度工具 | Anthropic `content_block_stop`、Responses `output_item.done` 后，可启动本地 read_file／glob／grep。写入形成屏障；动态能力、终端、浏览器和需要确认的调用不提前执行。最终结果复用一次；调用身份或参数被改写时拒绝继续 |
| 初始化与辅助信息 | 稳定辅助信息不应压住用户操作 | 启动时预热分词器，UI 计数不在会话锁中初始化分词器。实际请求预算仍精确计算。身份推断后台刷新，下次读取上下文发现授权撤回时清除并丢弃迟到结果；设备摘要不再启动 PowerShell/sysctl |

本地参考位置：

- `參考/ZCode/apps/zcode-cli/packages/core/src/runtime/methods/streaming-tool-coordinator.ts`
- `參考/ZCode/apps/zcode-cli/packages/core/src/runtime/methods/model-streaming-event-queue.ts`
- `參考/ZCode/apps/zcode-cli/packages/core/src/runtime/methods/turn.ts`
- `參考/hermes-agent/agent/client_lifecycle.py`
- `參考/hermes-agent/agent/system_prompt.py`
- `參考/zed/crates/agent/src/thread.rs`
- `參考/opencode/packages/opencode/src/session/llm/native-runtime.ts`
- `參考/opencode/packages/opencode/src/session/processor.ts`

连接复用同时符合 [reqwest Client 文档](https://docs.rs/reqwest/latest/reqwest/struct.Client.html) 对内置连接池的说明。

## 安全与语义

- 提前执行经过原工具执行器的工作区、计划和权限检查，不从解析器另开执行通道。请求范围内拥有任务，取消或失败时取消并中止未完成任务；不同请求的任务不可混用。
- 工具开始前写入可恢复的协议记录，结果完成后更新记录；最终响应到达后交给原执行循环复用。超时从实际启动工具时开始计算，不从响应结束、领取结果时才开始。
- 不提前结束供应商响应；计费、停止原因、推理签名及后续内容仍正常收完。因而“工具开始更早”不等于“下一次模型请求一定更早”。
- Chat Completions 的部分 JSON 即便可以解析，也继续等完整响应，不推测工具已经发完。
- 后台记忆也必须占用共享调度槽。Bedrock 非流式调用改为原生异步 HTTP，避免超时只取消外层等待、底层阻塞请求仍继续运行。
- 冷启动开销没有消失。若用户在初始化完成前立刻发送，精确请求预算仍可能等待分词器；预热主要把成本移到界面准备期间，不能宣称首个网络请求恒定即时。

## 复现命令

```sh
cargo build -p lyra-agent-runtime --example agent_latency_fixture
node tools/diagnostics/agent-latency.mjs
LYRA_UI_TEST_BROWSER=/path/to/chrome node apps/desktop/e2e/agent-latency.mjs
cargo test -p lyra-agent-runtime --lib -- --test-threads=1
pnpm --filter @lyra/desktop test src/main/agent/tests/turn-context-host.test.ts src/main/agent/tests/software-capability-host.test.ts src/main/agent/tests/host-persona-context.test.ts src/modules/workbench/software-capabilities
pnpm lint:structure
```

## 验收结果

以下为同一套本地模拟供应商、debug 构建的前后对照。基线保留在原有 `results.json`、`traces.json` 中，本次结果使用 `refactor-` 前缀单独保存。调度和磁盘负载会影响毫秒数，工作次数与等待关系更适合判断原因。

| 动作／观测点 | 修改前 | 修改后 |
| --- | --- | --- |
| 首次发送接口确认接收 | 约 1,593ms | 5ms（不等于模型开始回复） |
| 每轮发送前的主进程上下文请求 | 7 次 | 1 次 |
| 每次主进程调用增加 100ms 延迟时，后两轮发送到模型请求 | 864–866ms | 347–371ms |
| 两字符输出后停顿 600ms：供应商文字到后端增量 | 601–603ms | 1.8–3.0ms |
| Anthropic 明确完成工具参数后停顿 800ms：读取开始 | 830–834ms | 53–90ms，包含工具记录持久化 |
| Responses 明确完成工具后停顿 800ms：读取开始 | 此协议未建立旧版对照 | 33–55ms |
| 三轮只读工具对话的额外记忆请求 | 3 次 | 0 次 |
| 三轮普通对话的 TCP 连接数 | 3 个 | 1 个，逐轮切换测试凭据也验证通过 |

7 个场景共 21 轮模拟对话通过断言。Chat Completions 缺少明确的单个工具完成信号，因此工具仍在完整响应后开始（本轮 853–867ms），这是保留执行语义的边界。提前读工具结束后，到下一次模型请求仍可能等待剩余的 800ms 响应尾部；并未为了数字好看而丢弃尾部数据。

真实聊天组件的 3 次浏览器检查均在供应商的 600ms 暂停结束前观察到文字。供应商发送到 DOM 可见并经过两次动画帧的上界为 297、468、329ms，浏览器内部为 285、461、324ms；这些不是后端的 2ms，也不能证明完整桌面始终流畅。首次试跑采用的额外 400ms 门槛曾在机器负载较高时失败；最终按固定动作“暂停期间显示文字”检查，没有把该失败隐去或宣称达到 400ms 保证。

冷启动的第一个模型请求仍约 1.9 秒，立即发送时分词器预热可能尚未完成。本次解决了该初始化占住会话锁、拖慢发送确认的问题，未把精确请求预算改成不准确的估算。在线供应商的首 token 延迟、复杂工具耗时和完整工作区重绘不由这些局部结果证明。

检查记录：

- Rust runtime 全套：1,023 通过、10 失败。用原始 HEAD `571e81d4` 的独立工作区复测为 1,008 通过、13 失败；当前 10 个失败全部已存在于 HEAD，名单保存在验证记录中。
- 修正一个测试夹具：同一会话的并发权限／澄清等待使用同一活动轮次，避免原夹具把多个活动轮次相互取消。产品权限判断没有因此放宽。
- 相关桌面测试：6 个文件、45 项通过。补齐设置渲染模型的类型导入后，另有 9 项设置测试通过。更新后的软件目录服务测试另行通过；服务完整测试的 5 个既有失败在 HEAD 同样复现。
- TypeScript：当前 92 个错误、HEAD 为 95 个；按文件、错误码、错误信息及出现次数比较，没有新增。最终核对发现仅比较错误总数会漏掉新增的类型引用，已补齐 `LyraDesktopApi` 的类型导入并重跑检查。结构检查仍有 5 个既有失败，没有新增。
- `cargo fmt --all -- --check`、`git diff --check` 通过。runtime 全目标 Clippy 完成，有 970 条警告；这不等于整个仓库检查已全绿。

原始记录：[原生请求结果](assets/agent-latency-2026-09-29/refactor-results.json)、[事件轨迹](assets/agent-latency-2026-09-29/refactor-traces.json)、[浏览器结果](assets/agent-latency-2026-09-29/refactor-ui-results.json)、[检查及失败名单](assets/agent-latency-2026-09-29/refactor-validation.json)。

重新构建并打开桌面后，仍需重复“只回复 OK”“读取 README 后回复”和原来感觉慢的实际对话；本地模拟不能代替这一步。代码已完成上述明确等待点的修改，不能据此声称所有 Agent 卡顿和仓库既有问题都已根治。
