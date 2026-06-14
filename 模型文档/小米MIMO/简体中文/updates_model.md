# 模型发布

[功能更新](</docs/zh-CN/updates/feature>)

[模型发布](</docs/zh-CN/updates/model>)

[模型下线](</docs/zh-CN/updates/deprecate>)

邀请好友得体验金

# 模型发布

## 2026-06-02 mimo-v2.5-asr 发布

模型简介：

  * **中英双语 + 方言：** 持中英双语识别及吴语、粤语、闽南语、四川话等多种中国方言，以及中英混合代码切换

  * **歌词转写：** 高精度中英文歌词转写，支持人声与伴奏混合场景

  * **复杂声学环境：** 在强噪声、远场、多说话人等挑战性声学条件下表现稳健

  * **知识密集内容：** 精准识别古诗词、专业术语、人名地名等知识密集型内容，自动生成标点

## 2026-04-23 mimo-v2.5-pro 发布

模型简介：

  * **万亿参数，高效架构 ：** 1T 总参数 | 42B 激活 | 1M 超长上下文

  * **极致 Agent 性能：** 在高强度智能体场景下，表现媲美 Claude Opus4.6

## 2026-04-23 mimo-v2.5 发布

模型简介：

  * **原生全模态感知 + 1M 上下文：** 支持图像、视频、音频、文本的原生理解，实现跨模态精准感知与长程推理，综合感知能力跻身行业前沿

  * **强大的全模态 Agent 能力：** 具备原生 Agent 执行能力，可高效完成浏览、理解、推理与操作等复杂任务，日常任务表现比肩 **mimo-v2.5-pro**

  * **性能与效率兼备：** 在保持领先能力的同时，实现更优的 token 效率，位于性能与效率的 Pareto 前沿

## 2026-04-23 MiMo-V2.5-TTS 系列发布

模型简介：

  * **精品音色 TTS：** 内置多款高质量精品音色，具备强大的风格指令理解与遵循能力，支持对语速、情绪、语气等进行精细化控制，满足多场景表达需求

  * **音色设计：** 支持通过一句话快速定义并生成全新音色，让音色创作更加直观、高效

  * **音色克隆：** 基于少量音频样本即可高保真复刻目标音色，在保持音色特征一致性的同时，具备良好的泛化与稳定性

## 2026-03-18 mimo-v2-pro 发布

模型简介：

  * 采用 1:7 的 Global Attention 与 Sliding Window Attention (SWA) 混合结构；

  * 1T 的总参数量（42B 激活参数）；

  * 1M 超长上下文长度。

模型详情：<https://mimo.mi.com/#/docs/news/v2-pro-release>

## 2026-03-18 mimo-v2-omni 发布

模型简介：

  * 支持 256K 上下文长度；

  * 支持文本、视觉、语音模态。

模型详情：<https://mimo.mi.com/#/docs/news/v2-omni-release>

## 2026-03-18 mimo-v2-tts 发布

模型简介：

  * 上亿小时预训练、自研多码本语音建模架构；

  * 具备风格控制、唱歌、音色克隆等独特能力。

模型定价：限时免费。

模型详情：<https://mimo.mi.com/#/docs/news/v2-tts-release>

## 2026-02-04 mimo-v2-flash 更新

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

## 2026-01-12 mimo-v2-flash 更新

  * **通用能力增强：** 提升了模型通用任务下的处理能力。

  * **Thinking 模式代码能力升级：** 针对编程场景，强化了 Thinking 模式下的代码生成质量。

  * **Claude Code 深度适配：** 全面支持在 Claude Code 中使用 Thinking 模式。

    * 最佳实践：建议将 Thinking 设为默认模式，以获得更稳定、更卓越的代码生成体验。
  * **其他Code Agent体验优化：** 同步提升了 Kilo、Cline、Roo 等代码辅助工具（Code Scaffolds）的交互体验与生成效果。

  * **稳定性与指令遵循提升：** 增强了模型的输出稳定性，大幅提高了对特定输出格式的遵循能力。

| **mimo-v2-flash-0112** | **mimo-v2-flash**  
---|---|---  
**SWE-Bench Verified**   
**Non-Thinking** | **73.3** | 73.4  
**SWE-Bench Verified Thinking** | **74.2** | -  
**Arena-Hard(Hard Prompt)**   
**Non-Thinking** | **52.7** | 46.0  
**Arena-Hard(Creative Writing)**   
**Non-Thinking** | **86.0** | 78.3  
**Arena-Hard(Hard Prompt)**  
**Thinking** | **58.3** | 54.1  
**Arena-Hard(Creative Writing)**  
**Thinking** | **90.4** | 86.2  
  
## 2025-12-16 mimo-v2-flash 发布

模型简介：

  * 采用 1:5 的 Global Attention 与 Sliding Window Attention (SWA) 混合结构，128 窗口大小，原生 32K 外扩 256K 训练；

  * 引入 3 层 MTP，实现 2.5 ～ 3.7 倍的推理加速；

模型定价：输入 $0.1/M tokens，输出 $0.3/M tokens。

模型详情：[mimo-v2-flash: 高效推理、代码与 Agent 基座模型](<https://mimo.mi.com/#/docs/news/news20251216>)

调用指南：[首次调用 API](<https://mimo.mi.com/#/docs/quick-start/first-api-call>)

更新时间 2026 年 06 月 02 日

[功能更新](</docs/zh-CN/updates/feature>)[模型下线](</docs/zh-CN/updates/deprecate>)