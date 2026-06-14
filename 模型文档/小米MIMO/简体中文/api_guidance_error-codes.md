# 错误码

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

# 错误码

在使用 API 调用 MiMo 模型时，常见错误码与解决方法如下：

**错误码** | **错误原因** | **解决方法**  
---|---|---  
400 - 格式错误 | 请求体格式错误 | 

  * 检查 JSON 格式是否正确
  * 检查是否包含所有必需参数
  * 检查参数值是否在有效范围内
  * 检查消息格式是否符合接口要求
  * 检查模型是否是存在的模型
  * 检查字段是否输入正确
  * 检查多模态文件输入是否符合格式、大小等限制
  * 检查多模态文件输入是否可以公开访问
  * 多轮对话思考模式下，需完整回传 `reasoning_content` 字段给接口

  
401 - 认证失败 | 

  * 缺少或无效的 API Key，或 Authorization 请求头格式错误
  * 混用了 Token Plan 和按量付费 API 的 API Key

| 

  * 检查 API key 及请求头格式是否正确
  * 检查使用 Token Plan 时是否使用了专属 Base URL 和 API Key

  
402 - 余额不足 | 账户余额不足 | 检查账户余额，及时进行充值  
403 - 拒绝访问 | 服务暂不支持当前地区，或 API Key 被风控 | 新建 API Key，并注意输入内容安全  
404 - 资源未找到 | 接口或模型不支持图像输入能力 | 确认使用的模型 / 接口是否支持多模态图像输入  
421 - 内容拦截 | 内容审核拦截 | 避免输入不安全或敏感内容  
429 - 请求超限 | 请求过于频繁，或者 Token Plan 的额度耗尽 | 

  * 实现指数退避和重试逻辑，或降低请求频率
  * 升级 Token Plan 套餐或切换为按量付费的 API

  
500 - 服务器失败 | 服务器内部故障 | 请稍后重试，或联系我们解决  
503 - 服务器故障 | 服务器负载过高 | 请稍后重试  
  
更新时间 2026 年 05 月 12 日

[模型超参](</docs/zh-CN/api/guidance/model-hyperparameters>)[OpenAI API](</docs/zh-CN/api/chat/openai-api>)