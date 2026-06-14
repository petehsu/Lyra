# MiMo-V2-Flash 更新日志 2026/02/04

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

# MiMo-V2-Flash 更新日志 2026/02/04

  1. **Thinking 模式代码能力升级：** 针对编程场景进行了专门优化，Thinking 模式在 SWE-Bench Verified 上的评分提升至 **78.6** ，代码生成的解决率和质量均有显著提高。

  2. **工具调用准确率大幅提升：** 解决了工具使用的稳定性问题，Thinking 模式下的工具调用准确率从 64% 跃升至 **97.0%** ，大幅增强了模型在 Agent 场景下的执行可靠性。

  3. **指令遵循与抗幻觉能力增强：**

     * 提升了对特定指令的遵循能力，AA-IFBench 评分达到 **72** 。

     * 增强了事实性回答的严谨度，非幻觉率（Non-Hallucination Rate）提升至 **52%。**

  4. **复杂任务处理优化：** 在 Thinking 模式下，针对 Arena-Hard (Hard Prompt) 的处理能力有所增强，评分提升至 **60.6** ，在处理高难度逻辑问题时表现更佳。

  5. **思维链长度缩短：** 通过优化思维链生成策略，显著降低了冗余 Token 的消耗。在 AIME25、HMMT 等基准测试中，平均生成长度缩减了 **13% 至 30%** ，在保持模型效果的同时，有效降低了 Token 成本。

| **mimo-v2-flash-0204** | **mimo-v2-flash-0112** | **mimo-v2-flash**  
---|---|---|---  
**SWE-Bench Verified**   
**Non-Thinking** | **73.7** | 73.3 | 73.4  
**SWE-Bench Verified**   
**Thinking** | **78.6** | 74.2 | -  
**Arena-Hard(Hard Prompt)**   
**Non-Thinking** | **49.3** | 52.7 | 46.0  
**Arena-Hard(Creative Writing)**   
**Non-Thinking** | **85.0** | 86.0 | 78.3  
**Aren-Hard(Hard Prompt)**  
**Thinking** | **60.6** | 58.3 | 54.1  
**Arena-Hard(Creative Writing)**  
**Thinking** | **85.8** | 90.4 | 86.2  
**AA-IFBench** | **72** | - | 64  
**AA-Omniscience Accuracy** | **19** | - | 27  
**AA-Omniscience Non-Hallucination Rate** | **52%** | - | 9%  
**Tool call success rate**  
**Thinking** | **97.0%** | 64% | 44%  
  
**Benchmark** | **mimo-v2-flash (Acc)** | **mimo-v2-flash (Avg Tokens)** | **mimo-v2-flash-0204 (Acc)** | **mimo-v2-flash-0204 (Avg Tokens)** | **Length Reduction Ratio (%)**  
---|---|---|---|---|---  
**AIME25** | 94.8 | 26984 | 91.1 | 18879 | **30.04%**  
**HMMT_Feb_25** | 94.2 | 29294 | 92.9 | 21470 | **26.71%**  
**LiveCodeBench-AA** | 83.2 | 21488 | 84.9 | 18335 | **14.67%**  
**GPQA-Diamond** | 83.7 | 15862 | 83.8 | 13659 | **13.89%**  
  
> 注：模型调用方式和模型名称不变

更新时间 2026 年 05 月 28 日

[MiMo-V2-Flash 更新日志 2026/03/03](</docs/zh-CN/news/previous-news/news20260303>)[Xiaomi MiMo API 开放平台计费即将启动](</docs/zh-CN/news/previous-news/billing>)