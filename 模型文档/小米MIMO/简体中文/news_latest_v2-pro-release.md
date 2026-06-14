# Xiaomi MiMo-V2-Pro 发布：面向 Agent 时代的旗舰基座

最新

[Xiaomi MiMo Orbit 首批 Agent 生态共建合作伙伴公布](</docs/zh-CN/news/latest/v2.5-orbit>)

[MiMo-V2.5 系列调价公告丨 百万亿 Token 创造者激励计划收官](</docs/zh-CN/news/latest/v2.5-price-update>)

[小米 MiMo-V2.5 系列开源 & Orbit 百万亿 Token 计划启动](</docs/zh-CN/news/latest/v2.5-open-sourced>)

[Xiaomi MiMo-V2.5-TTS-Series + ASR 正式发布：你的声音，随心所“驭”](</docs/zh-CN/news/latest/v2.5-tts-release>)

[Xiaomi MiMo-V2.5 系列大模型开启公测](</docs/zh-CN/news/latest/v2.5-news>)

[Xiaomi MiMo 现已接入全球顶级 Agent 框架 Hermes Agent，并限免两周](</docs/zh-CN/news/latest/hermes-free>)

[Xiaomi MiMo Token Plan 正式发布](</docs/zh-CN/news/latest/token-plan-release>)

[Xiaomi MiMo Agent 框架调用限免活动延长一周](</docs/zh-CN/news/latest/free-trial-extension>)

[Xiaomi MiMo 联合全球顶级 Agent 框架开启首周限免](</docs/zh-CN/news/latest/first-week-free>)

[Xiaomi MiMo-V2-Pro 发布：面向 Agent 时代的旗舰基座](</docs/zh-CN/news/latest/v2-pro-release>)

[Xiaomi MiMo-V2-Omni 发布：看得清，听得懂，能动手的全模态 Agent 基座](</docs/zh-CN/news/latest/v2-omni-release>)

[Xiaomi MiMo-V2-TTS 发布：能说会唱的语音合成大模型](</docs/zh-CN/news/latest/v2-tts-release>)

往期新闻

[MiMo-V2-Flash 更新日志 2026/03/03](</docs/zh-CN/news/previous-news/news20260303>)

[MiMo-V2-Flash 更新日志 2026/02/04](</docs/zh-CN/news/previous-news/news20260212>)

[Xiaomi MiMo API 开放平台计费即将启动](</docs/zh-CN/news/previous-news/billing>)

[Xiaomi MiMo API 开放平台充值功能开放通知](</docs/zh-CN/news/previous-news/recharge>)

[MiMo-V2-Flash 更新日志 2026/01/12](</docs/zh-CN/news/previous-news/news20260112>)

[MiMo 模型公测限免延长公告](</docs/zh-CN/news/previous-news/beta-free>)

[MiMo-V2-Flash 发布 2025/12/16](</docs/zh-CN/news/previous-news/news20251216>)

邀请好友得体验金

# Xiaomi MiMo-V2-Pro 发布：面向 Agent 时代的旗舰基座

今天，我们发布小米面向 Agent 时代的旗舰基座模型 Xiaomi mimo-v2-pro。

Xiaomi mimo-v2-pro 专为现实世界中高强度的 Agent 工作场景而打造。它拥有超过 **1T** 的总参数量（**42B** 激活参数），采用创新的混合注意力架构，并支持 **1M** 超长上下文长度。在强大的模型基座上，我们在更为广泛的 Agent 场景中持续 Scaling 算力，进一步拓展了智能的动作空间，实现了从 Coding 到 Claw 的重要泛化。

在全球权威大模型综合智能排行榜 Artificial Analysis 上，mimo-v2-pro 位列全球第八，国内第二。

![图片](/static/LTeVbc1a5oXPblxRnSRcoKFQnIg.4edb54d7.png)

在 OpenClaw、Claude Code 等智能体框架中，mimo-v2-pro 展现出了优秀的端到端任务完成能力，能够在无人工干预的条件下完成复杂工作流编排、长程规划与精准工具调用，并持续可靠地交付最终结果。整体使用体感已超越 Claude Sonnet 4.6，逼近 Opus 4.6，但模型 API 定价仅为其 1/5，降低了前沿智能的使用门槛。

## 基座能力的全面跃升

通过 Scaling 参数和算力，mimo-v2-pro 拥有了更大、更强的模型基座。

  * **万亿参数，高效架构** ：总参数量突破 1T（激活参数 42B），较前代 mimo-v2-flash 扩大约 3 倍。沿用前代 mimo-v2-flash 的创新 Hybrid Attention 机制，混合比例从 5:1 进一步提升至 7:1，在参数量大幅增长的同时依然维持了较高推理效率，并支持 1M 超长上下文。轻量 MTP (Multi Token Prediction) 层实现了高效的生成速度。

  * **从 Chat 到 Agent** ：通过后训练阶段在更广泛的 Agent 任务场景进行 Scaling，模型能力已不再局限于“回答问题”或是“生成精美 Demo”，而是“完成任务”。我们致力于将其深度集成至生产力场景，使其成为驱动系统运转的“大脑”，持续交付具有真实世界影响力的结果。

  * **超越榜单的实际体验** ：在各个衡量模型重要能力的基准测评中，mimo-v2-pro 均表现优异，Coding Agent、通用 Agent 和 Tool Use 与 Claude 4.5 Sonnet、GPT5.2、Gemini 3.0 Pro 处于同一梯队，展现了其领先的智能水平。我们坚持以“实际体感”为导向进行训练优化，始终关注模型在应用场景中的落地表现。

![图片](/static/VIxabskNvoV3jfxa66VcFwjMn2g.87d32637.png)

## 为 Agent 而生的旗舰模型

mimo-v2-pro 专为 Agent 场景深度优化。

### OpenClaw 的原生大脑

OpenClaw 是近期开源社区备受瞩目的通用智能体框架。作为驱动此类框架的核心，底层模型的能力上限直接决定了系统的业务表现。mimo-v2-pro 针对复杂多样的 Agent Scaffold 进行 SFT & RL，具备更强的工具调用与多步推理能力。

在 OpenClaw 标准评测榜单 PinchBench、ClawEval 上，mimo-v2-pro 效果处于全球顶尖。同时，凭借 1M 的超长上下文窗口，mimo-v2-pro 能够从容支撑高强度的真实 Claw 复杂应用流。下图中的 Hunter Alpha 为 mimo-v2-pro 的早期匿名版本。

![图片](/static/Ur05b3oh0ouWk8xO4YWckqdqngI.95aa6e6a.png)

### Coding 能力持续进化

不止于 Vibe Coding，mimo-v2-pro 能够参与更严肃的代码工程构建。

在小米内部工程师的深度评测中，mimo-v2-pro 体感已接近 Claude Opus 4.6，并展现出高阶的代码智能：拥有更出色的系统设计与任务规划能力、更优雅的代码风格，以及更高效直接的问题解决路径。

在 Hunter Alpha 测试阶段，调用量前几的 APP 多为编程专用工具，这印证了 mimo-v2-pro 在真实研发场景下的高可用性与高可靠性。

![图片](/static/PqCRbQ37Po6CRmxhdQ5cfGFvn4Y.ce213209.png)

## 百万上下文，开放 API

mimo-v2-pro 模型现已正式开放 API 服务，支持 1M 上下文长度，并根据使用量分段计价：

  * 256K 以内：输入 $1 / 百万 tokens，输出 $3 / 百万 tokens

  * 256K ~ 1M：输入 $2 / 百万 tokens，输出 $6 / 百万 tokens

访问 <https://platform.xiaomimimo.com> 即刻接入 API。

更新时间 2026 年 05 月 28 日

[Xiaomi MiMo 联合全球顶级 Agent 框架开启首周限免](</docs/zh-CN/news/latest/first-week-free>)[Xiaomi MiMo-V2-Omni 发布：看得清，听得懂，能动手的全模态 Agent 基座](</docs/zh-CN/news/latest/v2-omni-release>)