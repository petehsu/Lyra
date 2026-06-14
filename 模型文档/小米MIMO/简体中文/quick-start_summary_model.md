# 模型列表

概述

[欢迎使用](</docs/zh-CN/quick-start/summary/welcome>)

[首次调用 API](</docs/zh-CN/quick-start/summary/first-api-call>)

[模型列表](</docs/zh-CN/quick-start/summary/model>)

使用指南

工具调用

[联网搜索](</docs/zh-CN/quick-start/usage-guide/tool-calling/web-search>)

多模态理解

[图片理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/image-understanding>)

[音频理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/audio-understanding>)

[视频理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/video-understanding>)

[语音识别（MiMo-V2.5-ASR）](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/Speech-Recognition>)

[语音合成（MiMo-V2.5-TTS 系列）](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/speech-synthesis-v2.5>)

[语音合成（MiMo-V2-TTS）](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/speech-synthesis>)

其他

[深度思考](</docs/zh-CN/quick-start/usage-guide/other/deep-thinking>)

精彩活动

[邀请有礼](</docs/zh-CN/quick-start/promotions/refer>)

常见问题

[账号与认证](</docs/zh-CN/quick-start/faq/account>)

[付费](</docs/zh-CN/quick-start/faq/payment>)

[API 接入](</docs/zh-CN/quick-start/faq/api-integration>)

[Token Plan](</docs/zh-CN/quick-start/faq/token-plan>)

[活动](</docs/zh-CN/quick-start/faq/promotions>)

[其他](</docs/zh-CN/quick-start/faq/others>)

条款与协议

[服务协议](</docs/quick-start/terms/user-agreement>)

[隐私政策](</docs/quick-start/terms/privacy-policy>)

邀请好友得体验金

# 模型列表

本页列出 Xiaomi MiMo API 开放平台当前支持的所有模型，包含模型能力、长度限制和限流配额，帮助您根据使用场景选择合适的模型。

### 限流说明

平台对每个账号设有模型并发上限，服务器负载较高时可能出现响应延迟或 `429` 报错。建议您合理规划请求频率，在高并发场景下实现请求重试与退避策略，以避免触发限流。

  * **RPM（Requests Per Minute）** ：每分钟最多发起的请求数。计算范围为调用同一模型时，单个账号下所有 API Key 的请求总数之和。
  * **TPM（Tokens Per Minute）** ：每分钟最多交互的 Token 数。计算范围为调用同一模型时，单个账号下所有 API Key 的请求 Token 总数之和。

  

### 文本生成模型

**模型系列** | **模型 ID (Model ID)** | **能力支持** | **长度限制（token）** | **限流**  
---|---|---|---|---  
**Pro 系列** | `mimo-v2.5-pro` | 文本生成  
深度思考  
流式输出  
函数调用  
结构化输出  
联网搜索 | 上下文窗口：1M  
最大输出：128K | 最大 RPM：100  
最大 TPM：10M  
`mimo-v2-pro`  
**Omni 系列** | `mimo-v2.5` | 文本生成  
全模态理解  
深度思考  
流式输出  
函数调用  
结构化输出  
联网搜索 | 上下文窗口：1M  
最大输出：128K  
`mimo-v2-omni` | 上下文窗口：256K  
最大输出：128K  
**Flash 系列** | `mimo-v2-flash` | 文本生成  
深度思考  
流式输出  
函数调用  
结构化输出  
联网搜索 | 上下文窗口：256K  
最大输出：64K  
  
  

### 语音识别模型（ASR）

**模型 ID (Model ID)** | **能力支持** | **长度限制（token）** | **限流**  
---|---|---|---  
`mimo-v2.5-asr` | 语音识别 | 上下文窗口：8k  
最大输出：2k | 最大 RPM：100  
最大 TPM：10k  
  
  

### 语音合成模型（TTS）

**模型 ID (Model ID)** | **能力支持** | **长度限制（token）** | **限流**  
---|---|---|---  
`mimo-v2.5-tts` | 语音合成 | 上下文窗口：8K  
最大输出：8K | 最大 RPM：100  
最大 TPM：10M  
`mimo-v2.5-tts-voiceclone` | 语音合成  
音色克隆  
`mimo-v2.5-tts-voicedesign` | 语音合成  
音色设计  
`mimo-v2-tts` | 语音合成  
  
  

### 快速选型指南

需求场景 | 推荐模型  
---|---  
复杂推理、深度分析、长文档处理 | `mimo-v2.5-pro`  
图片、音频、视频内容理解 | `mimo-v2.5` 或 `mimo-v2-omni`  
低成本、快速响应 | `mimo-v2-flash`  
语音转文字（支持中英双语） | `mimo-v2.5-asr`  
文字转语音（标准预置音色） | `mimo-v2.5-tts`  
声音克隆（上传音频样本） | `mimo-v2.5-tts-voiceclone`  
自定义音色设计 | `mimo-v2.5-tts-voicedesign`  
  
更新时间 2026 年 06 月 11 日

[首次调用 API](</docs/zh-CN/quick-start/summary/first-api-call>)[联网搜索](</docs/zh-CN/quick-start/usage-guide/tool-calling/web-search>)