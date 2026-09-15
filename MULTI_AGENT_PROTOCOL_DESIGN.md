# Lyra 多 Agent：当前实现

新建会话就是会话。没有 Solo/Oma 开关、频道条、内置 Lead/Builder，也没有 Team Plan 工具。

## 一台工人机器，两个入口

工人是持久子 session：`sessionKind: "subagent"`，`parentSessionId`，共享父 `workingDir`。对话与父隔离；深度 1（子不能再雇）。`list_sessions` 默认隐藏。用户从主会话工具卡片或 Plan 板打开只读工作区页，不能对工人打字。

### 1. `Agent` 工具

模型工具名 `Agent`，Tool-FS `/tools/agent/spawn`。字段：`description`、`prompt`（必填、自包含）、`subagent_type`、`run_in_background`、可选 `subagent_id`（续跑）、`stop`。

内置类型：`explore`（只读）、`generalPurpose`。项目自定义：工作区 `.lyra/agents/*.md`。

默认前台：父工具等终态，收回最后一段助手文本。后台先回 `subagentId`，完成后发 `subagentFinished`。

### 2. Todo 编号派发

`todo_write` 可选整数 `agent`。相同数字共用一个工人。系统用固定前缀（Plan + 分给它的 Todo），主 agent 不写工人提示词。主 Goal continuation 跳过已编号且未完成的项。不实现依赖锁/文件锁；重叠路径不要分给不同号。

## 调度

同一 provider lane 初始并发 2，成功后升到最高 4。父会话插到等待队列里第一个工人前面。429 减半容量并用 Retry-After 冷却；停的是这一枪，transcript 不追加「请继续」。取消会移出等待队列。

## UI

雇工在主会话里是普通工具卡片。点击打开 `agent-subagent` 工作区页（无 Composer）。同一父会话或同一 Plan 最多 4 分屏，第 5 个替换最早打开的雇工页。

## 已删除

Oma 模式、班组、频道、内置五人格、`/tools/agent/{send,ask,handoff,team_plan,create_role}`、`agent.oma.*` IPC。旧会话加载时丢掉 `agentMode` / `oma` / `modeContexts`。

## 后续（未做）

本地 Agent 包市场、签名分发、远程 A2A、动态 code hook。自定义 `.lyra/agents/*.md` 只覆盖当前工作区。
