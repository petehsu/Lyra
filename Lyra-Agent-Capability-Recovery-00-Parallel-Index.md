# Lyra Agent 能力恢复并行 TODO 总索引

## 目标

这组 TODO 用来修复重构后暴露出的 Agent 能力不可达和行为退化问题。

本轮不是继续做架构换壳，也不是恢复 jcode 命名。目标是让 Lyra 原生 Agent 在不重新引入 `jcode-*` / legacy product-path 依赖的前提下，恢复重构前应保留的实际能力。

## 已知八类问题

1. 文件、代码、终端能力缺失：模型看不到 read/write/edit/patch/glob/grep/ls/bash/agentgrep/codesearch/lsp 等能力。
2. Web 搜索和 WebFetch 缺失：`websearch` / `webfetch` 没有 Lyra 原生模型工具替代。
3. MCP / Skill 动态工具缺失：registry 骨架存在，但没有进入模型工具暴露和 turn loop 执行链。
4. 图片输入没有送进模型：UI message blocks 保存了 image，但 provider request 只发送 text。
5. 浏览器能力有 host 层可用但模型不可达：`lyraLumen.see`、`lyraLumen.submit`、`software.inspectCapability` 等没有对应模型工具。
6. 多个工作流服务是壳或弱实现：rollback、permission、clarification、goals、overnight、selfdev、btw。
7. turn engine 弱化：没有真 streaming、不能中断阻塞 provider request、缺少 soft interrupt、context overflow guard、自动 compaction/retry。
8. 提示词和设计工具链退化：jcode 的主动性/验证/持续执行规则没有完整迁移，Lyra 设计参考工具链也未进入工具和提示词。

## 并行拆分

建议分 5 个并行工作流。不要一个人同时改多个主路径文件，避免互相覆盖。

| 工作流 | TODO 文件 | 负责问题 | 可并行性 | 主要风险 |
| --- | --- | --- | --- | --- |
| A | `Lyra-Agent-Capability-Recovery-A-Tool-Surface-TODO.md` | 1、2 的模型工具面和 ToolFS 执行主链 | 可先做，其他组依赖它的工具注册接口 | 触碰 model tool schema、tool dispatch、host runtime |
| B | `Lyra-Agent-Capability-Recovery-B-Browser-Software-TODO.md` | 5 以及软件能力 inspect/read/invoke 闭环 | 可和 A/C/D/E 并行 | 触碰 desktop host capability bridge 和 Lumen 工具 |
| C | `Lyra-Agent-Capability-Recovery-C-Turn-Context-TODO.md` | 4、7 的 provider 输入、streaming、cancel、compaction | 可和 B/D/E 并行，但会和 A 在 turn loop 合并 | 触碰 provider request、turn lifecycle、context builder |
| D | `Lyra-Agent-Capability-Recovery-D-Workflow-State-TODO.md` | 6 的 rollback/permission/clarification/goals/overnight/selfdev/btw | 可和 A/B/C/E 并行 | 需要 typed runtime state，不允许假事件 |
| E | `Lyra-Agent-Capability-Recovery-E-Plugins-Skills-Design-TODO.md` | 3、8 的 MCP/Skills/Design tools/prompt policy | 可和 A 并行设计，最终接入 A 的工具暴露接口 | 容易只做 registry 壳，不进入模型可达路径 |

## 合并顺序

1. A 先合入最小工具注册与执行接口，至少让 native backend 能从 registry 生成 model tools。
2. C 合入 provider request/context/streaming 基础改造，确保 A 的工具结果能按事实时间线进入模型和 UI。
3. B 合入浏览器/软件能力补齐，使用 A 的工具注册方式，不直接在 `model_tools()` 手写分叉。
4. D 合入 workflow typed state，权限和澄清必须和 C 的 turn lifecycle 对齐。
5. E 合入 MCP/Skills/Design tool packs，复用 A 的 registry 和 D 的 permission policy。

## 并行工作约束

- 每个工作流完成一个 checkbox 就把对应项改成 `[x]`。
- 自动可验证项必须跑测试后再打勾。
- 需要用户主观体验验收的项保留 `[ ] 手工验收`，不要为了清零伪造结果。
- 不重新引入 `lyra-agent-legacy-*` 或 `jcode-*` product-path 依赖。
- 不恢复 `jcode_`、`Jcode*`、`lyra:jcode/*` 公共命名。
- 不碰 `web/site/`，除非用户明确把它纳入本轮任务。
- 不从 assistant 文本、tool JSON、DOM 文本里猜状态。状态必须来自 typed runtime state/projection。
- 不用关键词/正则隐藏系统消息或内部消息。visibility 必须是结构字段。
- 不把 provider/tool error 写成 assistant bubble。

## 公共验证门槛

所有工作流最终都必须通过：

- [ ] `cargo check --workspace --tests`
- [ ] `cargo test -p lyra-agent-api -- --format terse`
- [ ] `cargo test -p lyra-agent-kernel -- --format terse`
- [ ] `cargo test -p lyra-agent-runtime -- --format terse`
- [ ] `cargo test -p lyra-agent-plugins -- --format terse`
- [ ] `cargo test -p lyra-agent-core -- --format terse`
- [ ] `cargo test -p lyrad -- --format terse`
- [ ] `npm --prefix apps/desktop run typecheck`
- [ ] `npm --prefix apps/desktop run test -- src/modules/workbench/ai-panel/tests`
- [ ] `npm --prefix apps/desktop run test -- src/main`
- [ ] `pnpm lint:structure`
- [ ] `pnpm lint:agent-boundary`
- [ ] `pnpm lint:no-jcode-public-api`
- [ ] `pnpm lint:rust-first`
- [ ] `pnpm lint:ui-style`
- [ ] `cargo fmt --all --check`
- [ ] `git diff --check`

## 最终行为验收

- [ ] Agent 能读取、搜索、编辑项目文件，并能运行安全受控命令。
- [ ] Agent 能使用本地搜索、代码搜索、LSP 和 Web 搜索/Fetch。
- [ ] Agent 能发现并调用 MCP/Skills/Lyra software tools，且工具数量不会无边界膨胀。
- [ ] 图片附件能按模型 capability gate 进入 provider request。
- [ ] 浏览器 `see/submit/reveal/wait/read_until/follow` 都可被模型触发，UI 能显示事实时间线。
- [ ] rollback/permission/clarification/goals/overnight/selfdev/btw 不再是空壳。
- [ ] turn 能真 streaming，cancel 能中断长 provider request 或明确进入 interrupted/recoverable。
- [ ] 提示词恢复主动、验证、持续执行、设计参考强约束，但保持 Lyra 命名和 Lyra 工具协议。
