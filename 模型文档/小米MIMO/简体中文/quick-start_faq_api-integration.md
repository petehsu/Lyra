# API 接入

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

# API 接入

### 如何获取 API Key？

  * **按量付费 API 调用的 API Key ：** 登录 Xiaomi MiMo API 开放平台后，在 [控制台-API Keys](<https://platform.xiaomimimo.com/#/console/api-keys>) 页面申请 API Key。通过 API 使用模型时，请在请求头中包含您的 API Key：`api-key: $MIMO_API_KEY` 或 `Authorization: Bearer $MIMO_API_KEY` 。

  * **Token Plan 的 API Key ：** 购买成功后在 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 页面可以看到专属 API Key。**注意：API Key 仅在创建时可见可复制，请妥善保存。**

  * **Token Plan 的 API Key 格式为** `tp-xxxxx`**，仅用于 Token Plan 订阅服务；按量付费 API 调用的 API Key 格式为** `sk-xxxxx`**，用于按量计费。两者相互独立，不可混用。Token Plan 的 API Key 仅在您所订阅的 Token Plan 套餐有效期内可用。**

  

### API Key 丢失/泄露了怎么办？

可以在 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 页面进行重置操作。

  

### Token Plan 的 Base URL 怎么获取？

以 Token Plan 页面提供的 Base URL 为准：提供兼容 OpenAI 接口协议和兼容 Anthropic 接口协议的 2 种 Base URL ，按需复制使用即可。

  

### Token Plan 支持哪些编程工具？

支持主流编程工具与模型框架，如 Claude Code、OpenClaw、 OpenCode、Kilo Code、Cline、Hermes Agent、CodeBuddy Code 等。具体接入方式请参考 [AI 工具总览](<https://mimo.mi.com/#/docs/integration/tools-overview>)。

  

### 可以同时在多个编程工具中使用 Token Plan 吗？

可以在所有支持的工具中使用同一套餐，但额度是共享的，所有工具的使用会消耗同一套餐额度。

  

### OpenAI 和 Anthropic 两个接口有什么区别？

  * OpenAI 接口 `/v1/chat/completions` 遵循 OpenAI 格式，包含 developer/system/user/assistant 角色

  * Anthropic 接口 `/anthropic/v1/messages` 遵循 Claude 格式，单独的 system 参数

  

### 如何在思考模式下进行多轮工具调用？

在思考模式下的多轮工具调用过程中，模型会在返回 `tool_calls` 字段的同时返回 `reasoning_content` 字段。若要继续对话，建议在后续每次请求的 `messages` 数组中保留所有历史 `reasoning_content`，以获得最佳表现。

请求示例如下：
    
    
    curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header "Content-Type: application/json" \
    --data-raw '{
        "messages": [
            {
                "role": "assistant",
                "content": "Hello! I am MiMo.",
                "reasoning_content": "Okay, the user just asked me to introduce myself. That is a pretty straightforward request, but I should think about why they are asking this."
            },
            {
                "role": "user",
                "content": "What is the weather like in Hebei?"
            }
        ],
        "model": "mimo-v2.5-pro",
        "max_completion_tokens": 1024,
        "temperature": 1.0,
        "stream": false,
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "get_current_weather",
                    "description": "Get the current weather in a given location",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "location": {
                                "type": "string",
                                "description": "The city and state, e.g. San Francisco, CA"
                            },
                            "unit": {
                                "type": "string",
                                "enum": [
                                    "celsius",
                                    "fahrenheit"
                                ]
                            }
                        },
                        "required": [
                            "location"
                        ]
                    }
                }
            }
        ],
        "tool_choice": "auto"
    }'
    

  

### 为什么有时候 tool_calls 会在 reasoning_content 字段里面，有时候又会在单独的 tool_calls 字段里？

`tool_calls` 出现在 `reasoning_content` 是模型在调 tool 的时候开启 thinking 导致的不稳定，输出不完整；建议调用 tool calls 的时候关闭 thinking，并且参考 [模型超参](<https://mimo.mi.com/#/docs/quick-start/model-hyperparameters>) 进行设置，来获得更稳定且更好的使用体验。

  

### 响应速度如何？

响应速度取决于：

  * 请求长度和复杂度

  * 服务器负载和地理位置

  * 是否使用流式响应

  

### 如何处理超时？

请在客户端做好以下超时处理优化：

  * 配置合理的连接与读取超时时间

  * 采用指数退避策略进行重试

  * 长响应场景建议使用流式模式

  

### API 返回违规内容怎么办？

平台已增加对用户输入及模型输出的内容审核环节，若出现违规，会自动拦截返回内容，确保您接收到的内容安全。

  

### 开启联网搜索后，模型为何没有执行网络搜索？

可能有以下三种原因：

  * **缓存** ：开启/关闭联网后，会有 5 分钟的缓存时间，5 分钟内联网搜索开关还未真实开启/关闭。

  * **模型判断无需联网** ：模型判断当前问题不涉及实时信息，可直接使用自身知识回答。如需强制联网，请设置 `forced_search: true`。

  * **仅部分模型支持** ：当前仅 `mimo-v2.5-pro`，`mimo-v2.5`，`mimo-v2-pro`，`mimo-v2-omni`，`mimo-v2-flash` 支持联网搜索。

  

### 是否支持本地文件上传？

暂不支持本地文件上传。

更新时间 2026 年 06 月 12 日

[付费](</docs/zh-CN/quick-start/faq/payment>)[Token Plan](</docs/zh-CN/quick-start/faq/token-plan>)