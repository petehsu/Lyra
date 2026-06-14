# 首次调用 API

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

# 首次调用 API

## 支持的接口类型

Xiaomi MiMo API 开放平台兼容 OpenAI API 、Anthropic API 两种主流 API 格式，您可以使用现有 SDK 来使用模型推理服务。

## 调用前准备

### 登录 Xiaomi MiMo API 开放平台

目前平台仅提供个人账号登录方式，需使用小米账号登录，如已注册过小米账号，可直接登录；若无小米账号，可访问 [控制台](<https://platform.xiaomimimo.com/#/console/usage>) 进行注册，或在 [id.mi.com](<https://id.mi.com/>) 提前注册。

### 获取凭证

支持两种使用方式，但对应的凭证获取方式不同：

使用方式 | 说明 | 获取方式（以下为 BASE_URL 和 API Key 均为示例）  
---|---|---  
按量付费 API 调用 | 按实际使用量计费，适合轻度使用 | 

  * BASE_URL
    * OpenAI 兼容协议：`https://api.xiaomimimo.com/v1`
    * Anthropic 兼容协议：`https://api.xiaomimimo.com/anthropic`
  * API Key
    * 格式：`sk-xxxxx`

  
前往 [API Keys](<https://platform.xiaomimimo.com/#/console/api-keys>) 创建 API Key  
Token Plan | 固定订阅费，按套餐限量调用 | 

  * BASE_URL
    * OpenAI 兼容协议：`https://token-plan-cn.xiaomimimo.com/v1`
    * Anthropic 兼容协议：`https://token-plan-cn.xiaomimimo.com/anthropic`
  * API Key
    * 格式：`tp-xxxxx`

  
成功订阅后，前往 [Token Plan](<https://platform.xiaomimimo.com/#/console/plan-manage>) 获取专属 Base URL 和 API Key  
  
> 请妥善保管您的 API Key，避免泄露造成额度被盗用，建议将 API Key 配置到环境变量。

## 快速接入示例

可复制以下 API 示例代码，并替换 API Key 的值，即可快速调用。如使用 Token Plan 需替换 BASE_URL，并使用专属 API Key。

强烈建议使用以下系统提示词，请从英文和中文版本中选择。

> 中文
>     
>     
>     你是MiMo（中文名称也是MiMo），是小米公司研发的AI智能助手。
>     今天的日期：{date} {week}，你的知识截止日期是2024年12月。
>     

> 英文
>     
>     
>     You are MiMo, an AI assistant developed by Xiaomi.
>     Today's date: {date} {week}. Your knowledge cutoff date is December 2024.
>     

### Python SDK 示例

#### OpenAI API 格式示例

通过运行以下命令安装 OpenAI Python SDK：
    
    
    # 如果运行失败，您可以将pip替换成pip3再运行
    pip install -U openai
    

调用 API：
    
    
    import os
    from openai import OpenAI
    
    client = OpenAI(
        api_key=os.environ.get("MIMO_API_KEY"),
        base_url="https://api.xiaomimimo.com/v1"
    )
    
    completion = client.chat.completions.create(
        model="mimo-v2.5-pro",
        messages=[
            {
                "role": "system",
                "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
            },
            {
                "role": "user",
                "content": "please introduce yourself"
            }
        ],
        max_completion_tokens=1024,
        temperature=1.0,
        top_p=0.95,
        stream=False,
        stop=None,
        frequency_penalty=0,
        presence_penalty=0
    )
    
    print(completion.model_dump_json())
    

#### Anthropic API 格式示例

通过运行以下命令安装 Anthropic Python SDK：
    
    
    # 如果运行失败，您可以将pip替换成pip3再运行
    pip install -U anthropic
    

调用 API：
    
    
    import os
    from anthropic import Anthropic
    
    client = Anthropic(
        api_key=os.environ.get("MIMO_API_KEY"),
        base_url="https://api.xiaomimimo.com/anthropic"
    )
    
    message = client.messages.create(
        model="mimo-v2.5-pro",
        max_tokens=1024,
        system="You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024.",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "please introduce yourself"
                    }
                ]
            }
        ],
        top_p=0.95,
        stream=False,
        temperature=1.0,
        stop_sequences=None
    )
    
    print(message.content)
    

### Curl 示例

#### OpenAI API 格式示例
    
    
    curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header "Content-Type: application/json" \
    --data-raw '{
        "model": "mimo-v2.5-pro",
        "messages": [
            {
                "role": "system",
                "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
            },
            {
                "role": "user",
                "content": "please introduce yourself"
            }
        ],
        "max_completion_tokens": 1024,
        "temperature": 1.0,
        "top_p": 0.95,
        "stream": false,
        "stop": null,
        "frequency_penalty": 0,
        "presence_penalty": 0
    }'
    

#### Anthropic API 格式示例
    
    
    curl --location --request POST 'https://api.xiaomimimo.com/anthropic/v1/messages' \
    --header "api-key: $MIMO_API_KEY" \
    --header "Content-Type: application/json" \
    --data-raw '{
        "model": "mimo-v2.5-pro",
        "max_tokens": 1024,
        "system": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024.",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "please introduce yourself"
                    }
                ]
            }
        ],
        "top_p": 0.95,
        "stream": false,
        "temperature": 1.0,
        "stop_sequences": null
    }'
    

### 在思考模式下进行多轮工具调用

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
    

## 查看用量信息

在 [用量信息](<https://platform.xiaomimimo.com/#/console/usage>) 页面 ，您可以按照日期查看、导出账号的模型 Tokens 用量及请求次数详细数据。

更新时间 2026 年 06 月 12 日

[欢迎使用](</docs/zh-CN/quick-start/summary/welcome>)[模型列表](</docs/zh-CN/quick-start/summary/model>)