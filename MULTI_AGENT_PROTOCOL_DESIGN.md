# Lyra 多 Agent 协议与产品方案

本文档记录 Lyra 多 Agent 体系的初版设计方向。目标是做成一套可本地创建、可远程安装、可社区分发、可被其他产品低成本适配的 Agent 定义与协作协议。

> 当前实现以本节为准；后文中市场、远程 Agent、动态 hook、额外群聊等内容是后续路线，不是 Oma v1 已提供的能力。

## 当前实现：Oma v1

Oma v1 不是五个独立 worker，也不是 Solo 会话上叠一层头像 UI。它使用一个通用 Lyra host runtime：同一个 provider、模型选择、工具执行和权限链路；Agent 的差异来自可加载的 Agent Package、被密封的身份 prompt 和频道上下文。

- Solo 与 Oma 是两套完全隔离的会话上下文；切换模式会原子保存和恢复各自的 messages、tools、todos、memory、prompt/token 状态。
- 每个 Oma session 内的 roster 使用临时 UUID `sessionAgentId`。包的稳定 `agentId` 不会被拿来当消息发送者、频道成员或路由目标。
- Oma 只允许两种频道：唯一的 `group:default` 和 `direct:<sessionAgentId>`。自定义群聊及其历史会在旧 session 迁移时删除；私聊历史会保留并迁移到新的实例频道 ID。
- 默认群聊始终包含当前 roster 的所有成员。移除 Agent 会让其退出默认群聊，并删除该 Agent 的私聊上下文；Lead 不可移除。
- 频道切换会整体交换 `messages`、`tools`、`todos`、`plan`、`projectTodo`、`memory`、prompt 元数据与 token 统计，不允许跨私聊泄漏。
- 模型提示词不会再拿到原始 `oma` state。每轮只注入一个公开组织图：当前 roster 的 `sessionAgentId`、身份、职责、公开委派元数据、状态与私聊入口；永远不包含其他 Agent 的 prompt、私聊消息、工具、memory、Todo、Plan 或 token 数据。

### 内置 Agent Package

五个内置 Agent 都是编译期校验并嵌入的真实目录包：

```text
crates/lyra-agent-runtime/assets/oma-agents/
  lead/
  builder/
  reviewer/
  designer/
  researcher/
```

每个包包含 `lyra-agent.json`、`prompts/main.md`、`assets/avatar.svg` 与 `README.md`。编译期会校验 schema、唯一 `agentId`、prompt 与 SVG 是否存在。Oma 管理面板的可添加列表来自该 Package Registry，不来自硬编码角色常量。

manifest 的 `delegation` 是公开元数据：`specialties`、`acceptedWork`、`deliverables`、`collaborationHints`。Lead 日常不搜索当前团队；它每轮直接读取这张紧凑组织图，像负责人读取组织架构一样选择已有成员。Tool-FS 风格的包发现只留给后续招聘、扩编和本地包管理。

除编译期内置包外，Oma 有一个本地 `AgentPackageRegistry`，持久化在 runtime 根目录的 `oma-agent-packages.json`。Lead 创建的可复用本地包会写入该 registry；之后任何 Oma session 都会在管理面板的可添加列表中看到它。加入 session 时才生成新的 `sessionAgentId`，因此同一包可安全加入多个 Oma 会话。临时角色不写入 registry，只在创建它的 session 内存在。管理面板会区分内置包、用户包（为后续本地导入预留）、Lead 可复用包和 Lead 临时角色。

### 调度与通信

- 默认群聊中未提及时先只运行 Lead。Lead 对简单问题直接负责；对跨职责、可并行或有风险的任务，可自主咨询团队、发布唯一的 Team Plan，并在用户批准后执行工作包。
- Lead 使用公开组织图做路由：它知道当前有哪些角色、每个角色接受什么工作、能交付什么，而不读取任何专员私聊。
- `agent.ask` 可以真正并发地执行多个专员包；专员请求、工具记录和完整回复留在各自私聊，结果回到 Lead。Lead 可选择把精简的专员讨论回复公开到默认群聊。
- 只有默认群聊支持 `@` 指派。输入 `@` 会从当前 roster 中按名称、短名和职责搜索；选择结果是含 `mentionId`、`sessionAgentId`、`agentId` 的内链胶囊，不依赖发送后再猜测文本中的名字。私聊与 Solo 没有此入口。
- 多个 `@` 按胶囊在消息中的出现顺序解析：第一个 `@` 前是所有被指派 Agent 的共同前言；每个 `@Agent` 后、下一个 `@Agent` 前是该 Agent 的专属任务。同一 Agent 被多次提及时，任务段按出现顺序合并，该 Agent 本回合只运行一次。
- 每个被指派 Agent 都获得完整群聊起始上下文、全部附件/引用、共同前言和自己的任务投影。发送后的用户消息继续以同一套内链胶囊渲染。
- 被 `@` 的多个 Agent 会并发执行，回复按真实完成顺序立即发布到默认群聊；单个 Agent 的失败只发布其明确失败状态，不取消其他 Agent。
- 没有隐式全员审阅或“由模型决定是否回复”的模式；没有结构化 `@` 时默认群聊只运行 Lead。
- `agent.send` 与 `agent.handoff` 将工作写入目标私聊，并在当前外层回合结束后由统一执行器处理；不会伪造一条已完成的 Agent 回复。
- `agent.ask` 同步调用目标包。所有 Agent 工具仍由 Lyra host 执行，但工具活动和结果只属于调用频道。
- `agent.team_plan` 是 Lead 专用的权威计划入口。它创建一个默认群聊 Team Plan 和带负责人、依赖、验收条件、交付物的工作包；既有 Plan Review 批准前不会派发执行。
- 批准后，所有无依赖工作包进入统一调度队列并并发执行；每个 Agent 对自己的私聊串行写入。依赖完成后后续工作包自动放行；失败依赖会把后续项标为 blocked，而不是让无关任务停止。每个工作包遇到执行失败时最多自动重规划一次：调度器把失败原因写回该私聊并要求负责人换一种更安全的方案；第二次失败才进入明确 failed 状态，供 Lead 在群聊说明并转入提问或权限流程。全部工作包进入终态后，runtime 会再排入一次 Lead 群聊跟进，由 Lead 基于公开工作包状态、交付摘要和失败原因发布结果、残余风险与下一步；不会复制专员的私聊过程。
- Lead 可通过 `agent.create_role` 创建临时角色或本地角色包；该动作只能作为已批准 Team Plan 中 Lead 自己的 staffing 工作包执行，因此组织扩编也受用户审批约束。两者仍复用 host provider、模型、工具和权限，本轮不允许生成 code hook、远程执行器或独立模型配置。

### 并发、限流与执行隔离

- 每个并发 Oma 任务在不可持久化的 execution scope 中运行；scope 固定绑定 session、频道、`sessionAgentId`、包身份、任务投影和群聊起始上下文。UI 的 `activeChannelId` 仅表示当前查看频道，用户切换频道不会改变正在运行的任务。
- execution scope 完成后只把新增的工具、todo、memory、prompt/token 元数据合并回它绑定的频道；回复也只写回该频道。
- 默认群聊保存 Team Plan 与公开工作包状态；角色私聊保存该角色的局部 Plan、Todo、工具和过程。群聊不复制专员原始工具日志。
- Solo 和 Oma 共用 provider 调度器。调度键为 provider route、配置身份、base URL 与 model；初始并发为 2，连续成功后渐进升至最高 4。
- 遇到 429、rate-limit 或服务过载时，调度器降低该 provider lane 的容量、按 `Retry-After`（可取得时）或带抖动的指数退避进入冷却，并让尚未开始的请求 FIFO 排队。取消 turn 会从等待队列移除，不会继续在后台发送。
- Agent 头像状态为 `queued`、`running`、`retrying`、`idle`；队列等待与退避状态通过外圈和 hover 说明表达。

### UI 边界

- 顶部频道顺序固定为：五彩默认群聊圆形徽章、每个 Agent 的单头像私聊、管理 `+`。
- 默认群聊图标是固定五色、无文字、无头像堆叠的圆形徽章；运行状态只通过外圈光晕表达。
- 私聊不显示发言者标签；默认群聊保留头像和名称。私聊头像和群聊发言头像使用包提供的 SVG。
- `+` 只打开 Oma 管理面板：添加内置包、移除 Agent；不再创建或管理额外群聊。
- 默认群聊在已有 Plan Review 附近显示紧凑 Team Plan / 工作包卡：负责人、状态、依赖、摘要与阻塞信息；点击工作包或负责人进入对应私聊查看完整过程。

### 本轮明确不做

用户本地导入、zip 分发、签名、市场、远程 A2A、动态 code hook、独立模型/工具权限不属于 Oma v1。当前提供 Lead 创建的临时角色与本地可复用角色包；后者只保存在本机 registry，不包含市场级安装、签名或分发。manifest 中可以声明未来能力，但 Oma v1 一律继承 host 的工具与权限链路，不执行这些扩展。

## 后续协议扩展目标（非 Oma v1）

Lyra 多 Agent 不是简单的“多开几个聊天窗口”，而是一套包含以下能力的体系：

- 用户可以本地创建自定义 Agent。
- 用户可以安装远程 Agent，也可以分享自己的 Agent 到社区市场。
- Agent 可以拥有头像、名称、说明、规范化信息、提示词、工具权限、高级动态提示词和代码能力。
- 一个 Lyra 会话内可以添加多个 Agent，但不同会话之间的 Agent 列表、上下文和状态互相隔离。
- 一个会话内的 Agent 支持默认群聊、私聊、相互通信和任务交接。
- 协议本身应足够简单，其他产品只需要解析 Agent 信息和通信 envelope，就能接入基础能力。

## 产品模式

Lyra Agent 面板建议分为两个模式：

- 当前单 Agent 模式：保持现有体验，适合作为默认、低干扰、直接执行的模式。产品命名可以避免叫“默认模式”，后续可考虑 `Classic`、`Solo`、`Focus` 等更有品牌感的名字。
- `Oma` 模式：多 Agent 模式，宣传语为 `Oh My Agents`。Oma v1 是一个会话内的多 Agent 工作空间，包含多个 Agent、唯一默认群聊、每个 Agent 的独立私聊，以及 Agent 间通信。

Oma 不应该替换现有模式，而是作为明确的新工作模式。这样可以保留当前用户的稳定体验，也能让多 Agent 的复杂性有自己的入口、UI 和状态模型。

## 核心判断

Lyra 不应该把多 Agent 做成另一套 MCP。MCP 已经适合承载工具、资源和提示词能力；Lyra 应该新增的是 Agent 包格式、会话内 Agent 拓扑、通信协议、市场分发和权限治理。

远程 Agent 也不建议从零发明传输协议。可以兼容 A2A 这类已有远程 Agent 协议，把 A2A endpoint 当作一种 Agent source。Lyra 自己重点定义本地 Agent 包和会话内协作语义。

Agent ID 不应该靠用户填写，也不应该依赖远端校验。建议使用自认证 ID：创建 Agent 时生成 Ed25519 keypair，`agentId = did:lyra:agent:<publicKeyFingerprint>`，Agent 包用私钥签名。这样不需要中心注册表，也能极大降低冲突概率，并天然支持市场签名和溯源。

## ID 模型

Lyra 内部建议分三层 ID：

- `agentId`：Agent 定义身份，来自公钥指纹，全球唯一。
- `installationId`：本机安装实例，同一个 Agent 可以安装多个版本或来源。
- `sessionAgentId`：某个 Lyra 会话内加入的 Agent 实例。

这种拆分可以同时满足：

- 同一个 Agent 在不同会话里隔离运行。
- 一个会话添加的 Agent 不影响其他会话。
- 市场、签名、更新和回滚可以围绕 `agentId` 管理。
- UI 和 runtime 可以围绕 `sessionAgentId` 做上下文隔离。

## Agent 包格式

开发阶段使用文件夹，分发阶段使用 zip 包，扩展名可定义为 `.lyra-agent`。

推荐目录结构：

```text
agent/
  lyra-agent.json
  prompts/main.md
  assets/avatar.svg
  README.md
  hooks/
  tools/
```

最小 manifest 示例：

```json
{
  "schemaVersion": "lyra.agent.v1",
  "agentId": "did:lyra:agent:z...",
  "name": "Frontend Architect",
  "version": "1.0.0",
  "description": "Reviews and implements production-quality frontend experiences.",
  "author": {
    "name": "Example Author",
    "id": "did:lyra:author:z..."
  },
  "icons": [
    {
      "src": "assets/avatar.svg",
      "type": "image/svg+xml"
    }
  ],
  "profile": {
    "facts": [
      {
        "key": "style",
        "label": "Style",
        "value": "precise, visual, critical",
        "visibility": "model_and_user"
      }
    ]
  },
  "prompt": {
    "main": "prompts/main.md",
    "variables": ["workspace", "channel", "date"]
  },
  "capabilities": {
    "tools": ["mcp:*", "lyra:/tools/design/extract_reference"],
    "codeHooks": []
  },
  "permissions": ["workspace:read", "browser:read"]
}
```

## 规范化信息

不要为 Agent 固定大量字段，例如性别、年龄、出生日期、关系网等。这类字段永远支持不完。

推荐使用 `profile.facts[]`：

```json
{
  "key": "domain",
  "label": "Domain",
  "value": "frontend systems",
  "visibility": "model_and_user",
  "source": "author"
}
```

UI 只负责渲染 facts，runtime 按规范注入模型上下文。这样既结构化，又保留用户自定义空间。

## Prompt 能力分级

为了兼顾安全和扩展性，Agent 能力建议分级：

- Level 1：纯 prompt Agent，市场默认允许。
- Level 2：prompt + MCP / Tool-FS 能力声明，需要用户授权。
- Level 3：动态 prompt，支持模板变量、条件片段、workspace/context 注入。
- Level 4：代码 hook，优先使用 sandbox JS/WASM，默认无 fs/network，权限显式声明。
- Level 5：远程 Agent，走 A2A endpoint，需要网络和 auth 权限。

这样可以支持高级 Agent，但不会一开始就把安全边界做乱。

## 后续协议扩展：会话内 UI（非 Oma v1）

如果后续重新评估自定义群聊，Oma 的 channel strip 可以扩展为更多会话内对话空间。以下不是 Oma v1 功能：

- 默认群聊显示为固定的五彩单圆徽章，表示当前会话所有默认成员都在里面。
- 单 Agent 私聊显示为单头像。
- Agent 之间创建的私聊也显示为头像组合，例如两个 Agent 的双头像。
- 用户自建群聊显示为头像组合，可展示最多 3 个头像，更多成员用 `+N`。
- 最右侧为 `+`，点击后打开 Oma 管理界面，可添加 Agent、创建群聊、拉 Agent 入群。

头像支持 `svg`、`png`、`jpg`、`gif`、代码生成类资源。SVG 必须 sanitize，GIF 要限制尺寸和帧数，避免市场包污染 UI 或拖慢渲染。

若未来开放额外频道，每个头像组可以有更多菜单：

- 单 Agent：查看详情、切换私聊、从当前会话移除 Agent。
- 群聊：查看成员、邀请 Agent、移除成员、解散群聊。
- Agent 间私聊：查看参与 Agent、关闭该私聊。

如果 Agent 正在运行任务，删除或移除必须进入受控状态：

- `idle`：可直接移除。
- `running`：提示用户取消任务后移除，或标记为 `removeAfterTurn`。
- `waitingForUser`：允许移除，但需要关闭该 Agent 的等待面板。
- `failed` / `cancelled`：可直接移除，保留历史消息。

Oma v1 当前的移除行为更简单：从 roster 移除 Agent 时，会删除该 Agent 的私聊频道上下文；不会保留 archived 自定义频道。

## 后续协议扩展：会话与频道模型（非 Oma v1）

Oma v1 实际只允许以下两个频道类型：

- `group:default`：默认群聊，当前会话内所有 Agent 可见。
- `direct:<sessionAgentId>`：用户和某个 Agent 的隔离私聊。

`agent-direct:<a>:<b>`、`group:<groupId>`、自定义成员 roster、频道归档和解散均不属于 Oma v1；旧 session 中的自定义群聊及其上下文会在迁移时删除。

隔离规则：

- Agent 私聊只进入该 Agent 的上下文。
- 群聊进入所有 Agent 的共享上下文，但需要窗口裁剪和摘要，避免 token 爆炸。
- 工具结果默认只给调用 Agent；除非该 Agent 主动发布 artifact/ref 到群聊。
- memory 分为 Agent 私有、本会话共享、全局长期记忆三层。

Oma v1 群聊成员规则：

- 默认群聊自动包含当前会话 roster 中的 Agent。
- 新增 Agent 自动加入默认群聊；移除 Agent 自动退出默认群聊。
- Lead 不可移除。

如果未来开放自定义群聊，才需要创建者选择成员、邀请/移除成员，以及 Agent 自主建群的权限策略。

## Agent 间通信协议

Oma v1 的 Agent 间通信不依赖模型随意 `@`，而是通过以下内部工具化协议：

- `agent.ask`：同步询问某个 Agent，等待回复。
- `agent.send`：异步发送消息。
- `agent.handoff`：把当前任务交给另一个 Agent。

`agent.broadcast`、`agent.channel.create`、`agent.channel.invite` 与 `agent.channel.leave` 不属于 Oma v1。默认群聊是唯一多人可见频道，不允许由用户或 Agent 新建、邀请、离开或解散。

消息 envelope 示例：

```json
{
  "type": "lyra.agent.message.v1",
  "messageId": "msg_...",
  "sessionId": "session_...",
  "channelId": "group:default",
  "from": "sessionAgentId:user",
  "to": ["sessionAgentId:frontend"],
  "intent": "request",
  "visibility": "group",
  "content": [
    {
      "type": "text",
      "text": "Review this layout."
    }
  ],
  "refs": [
    {
      "kind": "file",
      "path": "apps/desktop/src/..."
    }
  ],
  "requiresAck": true,
  "ttl": 2
}
```

必须有 `ttl` 或 `hopLimit`，否则多 Agent 可能互相循环通信。

未来若重新开放自定义频道，可以再定义频道创建 envelope；Oma v1 不解析也不执行该 envelope：

```json
{
  "type": "lyra.agent.channel.create.v1",
  "sessionId": "session_...",
  "createdBy": "sessionAgentId:planner",
  "channelKind": "group",
  "title": "Frontend review",
  "members": ["sessionAgentId:frontend", "sessionAgentId:design"],
  "reason": "Need focused review before implementation.",
  "userVisible": true
}
```

未来频道创建要快，但不能失控。建议规则：

- Agent 创建私聊默认允许，但 UI 标记来源。
- Agent 创建群聊默认需要轻量确认，或只允许在 Oma 设置中开启自动建群。
- 系统自动合并重复成员组合，避免同一批 Agent 出现多个重复群。
- 群聊空成员或只剩一个 Agent 时提示解散或转为私聊。

## 内置 Agent

Oma 模式建议内置少量高质量 Agent，不要一开始堆太多。第一版推荐：

- `Lyra Lead`：总协调 Agent，负责拆任务、分配 Agent、维护群聊秩序和总结进展。
- `Builder`：主实现 Agent，负责代码修改、运行测试、交付变更。
- `Reviewer`：审查 Agent，负责找 bug、风险、回归和测试缺口。
- `Designer`：UI / UX Agent，负责视觉质量、交互、响应式和设计参考落地。
- `Researcher`：研究 Agent，负责读取资料、网页、文档、设计参考和竞品信息。

后续可选内置：

- `Tester`：专门跑测试、定位失败、给出最小复现。
- `Product`：梳理用户目标、边界、验收标准和产品文案。
- `Security`：做权限、敏感数据、供应链和远程 Agent 风险检查。

Oma v1 默认激活全部五个内置 Agent：`Lyra Lead`、`Builder`、`Reviewer`、`Designer` 与 `Researcher`。

内置 Agent 也必须走同一套 manifest，只是 source 为 `builtin`。这样协议不会为内置 Agent 开特例，社区 Agent 也能复用同样能力。

## 生命周期状态

Oma v1 当前 UI 状态包括：

- `idle`：空闲。
- `queued`：已被指派，等待共享 provider 并发额度。
- `running`：模型或工具执行中。
- `retrying`：服务商限流或过载后正在退避、重试。

从当前 Oma session 移除 Agent 会删除其 `direct:<sessionAgentId>` 私聊上下文；Oma v1 不使用 `archived` 状态保留已移除 Agent 的私聊历史。

如果未来开放额外频道，Session Agent 可再增加 `archived` 状态，Channel 状态建议包括：

- `active`：可见且可发送。
- `muted`：保留但不主动触发 Agent。
- `archived`：不显示在主 strip，历史可查。
- `dissolved`：群聊已解散，不再发送新消息。

Oma v1 没有额外群聊的更多菜单；移除 Agent 只改变当前 session，不影响该 Agent 的全局安装。

## Agent 市场

建议单独创建公开仓库，例如 `lyra-agent-market`。第一版不做复杂后端，用 GitHub repo 作为 index 和包分发即可。

推荐结构：

```text
lyra-agent-market/
  index.v1.json
  agents/<agentId>/<version>/manifest.json
  agents/<agentId>/<version>/package.lyra-agent
```

`index.v1.json` 存储：

- Agent 元数据。
- 下载 URL。
- `sha256`。
- 签名。
- 公钥。
- 权限摘要。
- 风险等级。
- 版本和兼容范围。

Lyra 软件拉取 index，下载包，校验 hash/signature，再安装到：

```text
~/.lyra/agents/<agentId>/<version>/
```

社区上传第一版可以通过 PR 完成。后续再做 Web 上传、审核、评分和下载量。

## 远程 Agent

远程 Agent 作为一种 source：

```json
{
  "kind": "a2a",
  "agentCardUrl": "https://example.com/.well-known/agent-card.json"
}
```

Lyra 读取远程 Agent Card 后，将其映射到 Lyra Agent manifest 的公共字段：名称、描述、能力、认证方式、endpoint、风险提示。

本地会话内仍然使用 `sessionAgentId` 管理远程 Agent 的上下文、权限和通信。

## 安全模型

必须默认保守：

- 市场包下载后必须校验 hash 和签名。
- SVG sanitize。
- 代码 hook 默认禁用 fs/network/process。
- 权限按能力显式授权。
- Agent 调工具时仍走 Lyra 现有 permission / plan gate。
- 远程 Agent 默认不能读取本地文件，除非用户显式发送内容或授权。
- 群聊中发布工具结果要经过 artifact/ref 摘要，不直接泄漏私聊上下文。

## 为什么别人要用

Lyra 这套协议的优势：

- 本地优先：离线可创建、安装、运行。
- 身份自认证：无需中心注册，也能降低 ID 冲突并支持签名溯源。
- 包格式简单：解析一个 manifest 就能接入基础能力。
- 能力分层：从 prompt-only 到远程 A2A 都能覆盖。
- 兼容现有生态：工具用 MCP，远程用 A2A，不逼别人重写。
- 会话拓扑清晰：群聊、私聊、handoff、共享/私有 memory 都有规范。

## 实现状态与后续顺序

已完成的 Oma v1：

- 内置 Agent Package manifest 与编译期 Package Registry。
- 会话内 roster、Oma 模式入口、Solo / Oma 隔离。
- `group:default` 与 `direct:<sessionAgentId>` 频道上下文隔离。
- 输入框上方的默认群聊五彩徽章、单 Agent 私聊头像与管理 `+`。
- 五个内置 Agent、Agent 添加/移除、Lead 默认调度与默认群聊结构化 `@Agent` 精确路由。
- 结构化 `agentMention` 内链段、任务分段、完成即显示的并发 Oma 执行，以及共享 provider 的自适应 2→4 并发/限流队列。

后续阶段：

- 用户本地导入、zip 分发、签名与市场。
- 远程 Agent / A2A 接入。
- 动态 hook 与扩展权限模型。
- 重新评估是否需要自定义群聊；若恢复，才实现 `agent.channel.*`、成员管理、归档/解散与频道创建 envelope。

第三期：

- 公开市场 repo。
- index 拉取。
- 包下载、hash 校验、签名校验。
- 软件内安装/卸载/更新。

第四期：

- 动态 prompt。
- sandbox code hook。
- A2A 远程 Agent。
- 社区上传、审核和评分。

## 参考协议

- MCP：适合工具、资源、提示词能力层，Lyra 不重复造工具协议。
- A2A：适合远程 Agent 发现与调用，Lyra 可作为远程 Agent source 兼容。
- DID：适合自认证身份思路，Lyra Agent ID 可借鉴其去中心化身份模型。
