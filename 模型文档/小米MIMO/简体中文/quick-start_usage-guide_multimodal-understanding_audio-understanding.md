# 音频理解

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

# 音频理解

音频理解模型可以根据您传入的音频进行回答，支持音频 URL 和 Base64 编码两种传入方式，适用于音频分析等场景。

## 快速开始

注意：获取 API Key 等准备工作，请参考 [首次调用API](<https://mimo.mi.com/#/docs/quick-start/first-api-call>)。

通过音频 URL 方式传入模型快速体验音频理解效果，示例代码如下。

**Curl**
    
    
    curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header "Content-Type: application/json" \
    --data-raw '{
        "model": "mimo-v2.5",
        "messages": [
            {
                "role": "system",
                "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": "https://example-files.cnbj1.mi-fds.com/example-files/audio/audio_example.wav"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the audio"
                    }
                ]
            }
        ],
        "max_completion_tokens": 1024
    }'
    

**Python**
    
    
    import os
    from openai import OpenAI
    
    client = OpenAI(
        api_key=os.environ.get("MIMO_API_KEY"),
        base_url="https://api.xiaomimimo.com/v1"
    )
    
    completion = client.chat.completions.create(
        model="mimo-v2.5",
        messages=[
            {
                "role": "system",
                "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": "https://example-files.cnbj1.mi-fds.com/example-files/audio/audio_example.wav"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the audio"
                    }
                ]
            }
        ],
        max_completion_tokens=1024
    )
    
    print(completion.model_dump_json())
    

**响应结果**
    
    
    {
        "id": "550a678a6c2046a29128883eaaf849e7",
        "choices": [
            {
                "finish_reason": "stop",
                "index": 0,
                "message": {
                    "content": "",
                    "role": "assistant",
                    "tool_calls": null,
                    "reasoning_content": "Good morning. Could you tell me what the weather will be like today?"
                }
            }
        ],
        "created": 1776850627,
        "model": "mimo-v2.5",
        "object": "chat.completion",
        "usage": {
            "completion_tokens": 17,
            "prompt_tokens": 86,
            "total_tokens": 103,
            "completion_tokens_details": {
                "reasoning_tokens": 15
            },
            "prompt_tokens_details": {
                "audio_tokens": 25,
                "cached_tokens": 82
            }
        }
    }
    

## 支持的模型列表

当前仅支持 `mimo-v2.5`，`mimo-v2-omni` 模型。

## 音频传入方式

支持的音频传入方式如下：

  * 音频 URL 传入：需提供公网可访问的音频 URL 地址。

  * Base64 编码传入：将音频转换为 Base64 编码字符串后再传入。

### 音频 URL 传入

通过公网可访问的音频 URL 地址直接传入音频文件，适用于音频文件已存储在公网可访问环境的场景。单个音频文件大小不能超过 100 MB。

**Curl**
    
    
    curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header "Content-Type: application/json" \
    --data-raw '{
        "model": "mimo-v2.5",
        "messages": [
            {
                "role": "system",
                "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": "https://example-files.cnbj1.mi-fds.com/example-files/audio/audio_example.wav"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the audio"
                    }
                ]
            }
        ],
        "max_completion_tokens": 1024
    }'
    

**Python**
    
    
    import os
    from openai import OpenAI
    
    client = OpenAI(
        api_key=os.environ.get("MIMO_API_KEY"),
        base_url="https://api.xiaomimimo.com/v1"
    )
    
    completion = client.chat.completions.create(
        model="mimo-v2.5",
        messages=[
            {
                "role": "system",
                "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": "https://example-files.cnbj1.mi-fds.com/example-files/audio/audio_example.wav"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the audio"
                    }
                ]
            }
        ],
        max_completion_tokens=1024
    )
    
    print(completion.model_dump_json())
    

### Base64 编码传入

将音频文件转换为 Base64 编码字符串后传入，适用于音频文件无法通过公网 URL 访问的场景。转换后的 Base64 编码的字符串大小不能超过 50 MB。

请在 Base64 编码前携带前缀：`data:{MIME_TYPE};base64,$BASE64_AUDIO`

  * `{MIME_TYPE}`：音频的 MIME 类型（媒体类型），用于标识音频格式，需替换为实际音频对应的 MIME 值。
  * `$BASE64_AUDIO`：音频文件的纯 Base64 编码字符串（不含任何前缀）。

**Curl**
    
    
    curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header "Content-Type: application/json" \
    --data-raw '{
        "model": "mimo-v2.5",
        "messages": [
            {
                "role": "system",
                "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": "data:{MIME_TYPE};base64,$BASE64_AUDIO"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the audio"
                    }
                ]
            }
        ],
        "max_completion_tokens": 1024
    }'
    

**Python**
    
    
    import os
    from openai import OpenAI
    
    client = OpenAI(
        api_key=os.environ.get("MIMO_API_KEY"),
        base_url="https://api.xiaomimimo.com/v1"
    )
    
    completion = client.chat.completions.create(
        model="mimo-v2.5",
        messages=[
            {
                "role": "system",
                "content": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024."
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": "data:{MIME_TYPE};base64,$BASE64_AUDIO"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the audio"
                    }
                ]
            }
        ],
        max_completion_tokens=1024
    )
    
    print(completion.model_dump_json())
    

## 音频限制

  * 音频格式：MP3，WAV，FLAC，M4A，OGG。

> 音频文件格式变种较多，不能保证所有文件都能被识别，请通过测试验证文件能够被正常识别。

  * 音频大小：

    * 以 URL 方式传入时：单个音频文件大小不超过 100 MB。

    * 以 Base64 编码传入时：单个音频的 Base64 编码字符串大小不超过 50 MB。

  * 音频数量：传入多个音频时，音频数量受模型上下文长度限制，所有音频和文本的总 Token 数必须小于模型的上下文长度。

> 注：计算音频的 Token 请参考 [音频 Token 用量说明](<https://mimo.mi.com/#/docs/usage-guide/multimodal-understanding/audio-understanding?target=%E9%9F%B3%E9%A2%91-token-%E7%94%A8%E9%87%8F%E8%AF%B4%E6%98%8E>)。模型上下文长度请参考 [定价与限速](<https://mimo.mi.com/#/docs/pricing>)。

## 音频 Token 用量说明

音频的 Token 转化请参考以下代码。估算结果仅供参考，实际用量以 API 响应为准。
    
    
    总 Tokens 数 ≈ 音频时长（单位：秒，例如：10.6 秒）* 6.25
    

## 计费说明

  * 计费：总费用根据输入、输入（命中缓存）和输出 Token 数计算；价格请参考 [定价与限速](<https://mimo.mi.com/#/docs/pricing>)。

    * 可通过 [音频 Token 用量说明](<https://mimo.mi.com/#/docs/usage-guide/multimodal-understanding/audio-understanding?target=%E9%9F%B3%E9%A2%91-token-%E7%94%A8%E9%87%8F%E8%AF%B4%E6%98%8E>) 计算音频的 Token 消耗。估算结果仅供参考，实际用量以 API 响应为准。
  * 查看账单：您可以在控制台的 [账单明细](<https://platform.xiaomimimo.com/#/console/usage>) 页面查看账单及用量。

## 常见问题

### 是否支持本地文件上传？

`mimo-v2.5` 和 `mimo-v2-omni` 模型暂不支持音频本地文件上传。支持的上传方式请参考 [音频传入方式](<https://mimo.mi.com/#/docs/usage-guide/multimodal-understanding/audio-understanding?target=%E9%9F%B3%E9%A2%91%E4%BC%A0%E5%85%A5%E6%96%B9%E5%BC%8F>)。

更新时间 2026 年 04 月 22 日

[图片理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/image-understanding>)[视频理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/video-understanding>)