# 速率限制

API 指引

[速率限制](</docs/zh-CN/api/guidance/rate-limit>)

[模型超参](</docs/zh-CN/api/guidance/model-hyperparameters>)

[错误码](</docs/zh-CN/api/guidance/error-codes>)

对话

[OpenAI API](</docs/zh-CN/api/chat/openai-api>)

[Anthropic API](</docs/zh-CN/api/chat/anthropic-api>)

语音

[语音识别（MiMo‑V2.5-ASR）- OpenAI API 兼容](</docs/zh-CN/api/audio/Speech-Recognition>)

邀请好友得体验金

# 速率限制

本页列出 Xiaomi MiMo API 开放平台当前支持的全部模型及其限流配额，帮助您在接入前规划请求频率。

### 限流说明

平台对每个账号设有模型并发上限，服务器负载较高时可能出现响应延迟或 `429` 报错。建议您合理规划请求频率，在高并发场景下实现请求重试与退避策略，以避免触发限流。

  * **RPM（Requests Per Minute）** ：每分钟最多发起的请求数。计算范围为调用同一模型时，单个账号下所有 API Key 的请求总数之和。
  * **TPM（Tokens Per Minute）** ：每分钟最多交互的 Token 数。计算范围为调用同一模型时，单个账号下所有 API Key 的请求 Token 总数之和。

### 文本生成模型

模型系列 | 模型 ID | RPM | TPM  
---|---|---|---  
Pro 系列 | `mimo-v2.5-pro` | 100 | 10M  
`mimo-v2-pro` | 100 | 10M  
Omni 系列 | `mimo-v2.5` | 100 | 10M  
`mimo-v2-omni` | 100 | 10M  
Flash 系列 | `mimo-v2-flash` | 100 | 10M  
  
### 语音识别模型（ASR）

模型 ID | RPM | TPM  
---|---|---  
`mimo-v2.5-asr` | 100 | 10K  
  
### 语音合成模型（TTS）

模型 ID | RPM | TPM  
---|---|---  
`mimo-v2.5-tts` | 100 | 10M  
`mimo-v2.5-tts-voiceclone` | 100 | 10M  
`mimo-v2.5-tts-voicedesign` | 100 | 10M  
`mimo-v2-tts` | 100 | 10M  
  
更新时间 2026 年 06 月 11 日

[隐私政策](</docs/zh-CN/quick-start/terms/privacy-policy>)[模型超参](</docs/zh-CN/api/guidance/model-hyperparameters>)