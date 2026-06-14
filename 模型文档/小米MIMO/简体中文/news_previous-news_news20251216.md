# MiMo-V2-Flash: 高效推理、代码与 Agent 基座模型

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

# MiMo-V2-Flash: 高效推理、代码与 Agent 基座模型

mimo-v2-flash 正式开源！这是一个专为极致推理效率自研的总参数 309B（激活 15B）的 MoE 模型，通过 Hybrid 注意力架构创新及多层 MTP 推理加速，在多个 Agent 测评基准上保持进入**全球开源模型 Top 2** ；代码能力超过所有开源模型，比肩标杆闭源模型 Claude 4.5 Sonnet，但推理成本仅为其 **2.5%** ，生成速度提升 **2 倍** ，成功将大模型推理效率推向极致。

![图片](/static/TKo5bjhEuo7xy8xfyzhcvPWznQc.68b9e067.png)

秉持开放精神，模型权重和推理代码均采用 MIT 协议全面开源。**API 限时免费** 。

## 推理成本与速度的极致优化

mimo-v2-flash 的 API 定价为: **输入 $0.1/M tokens，输出 $0.3/M tokens。**

下图横轴为全球顶尖模型速度和成本的对比图，mimo-v2-flash 实现了最低成本、最高速度。

![图片](/static/JZVcbQmUgoDEjAxbxlgcl9fPnrd.bb68f025.png)

## 面向高效推理的结构创新

结构要点如下：

  * **混合注意力** ：采用 1:5 的 Global Attention 与 Sliding Window Attention (SWA) 混合结构，128 窗口大小，原生 32K 外扩 256K 训练。经前期大量实证发现，SWA 简单、高效、易用，展现了比主流 Linear Attention 综合更佳的通用、长文和推理能力，并提供了固定大小的 KV Cache 从而极易适配现有训练和推理 Infra 框架。

![图片](/static/F5PKbGh0bo13bLxZTcYcIvU6nXd.e731e8d3.jpeg)

  * **MTP推理加速** ：通过引入 MTP (Multi-Token Prediction) 训练提升基座能力的同时，并在推理阶段通过并行验证 MTP Token，打破了传统 Decoding 在大 Batch 下的显存带宽瓶颈，实测在 3 层 MTP 情况下可实现 **2.5～3.7 的实际加速比** 。

![图片](/static/AnbZbXYXboy7UexqtxscAgnqnPd.f0d294be.png)

## 相关链接

  * 技术报告：<https://github.com/XiaomiMiMo/MiMo-V2-Flash/blob/main/paper.pdf>

  * 模型权重：<https://hf.co/XiaomiMiMo/MiMo-V2-Flash>

  * github 仓库：<https://github.com/xiaomimimo/MiMo-V2-Flash>

  * 官方博客：<https://mimo.xiaomi.com/blog/mimo-v2-flash>

  * LMSYS 博客：[https://lmsys.org/blog/2025-12-16-mimo-v2-flash](<https://lmsys.org/blog/2025-12-16-mimo-v2-flash/>)

更新时间 2026 年 05 月 28 日

[MiMo 模型公测限免延长公告](</docs/zh-CN/news/previous-news/beta-free>)[功能更新](</docs/zh-CN/updates/feature>)