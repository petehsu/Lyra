# 语音识别（MiMo-V2.5-ASR）

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

# 语音识别（MiMo-V2.5-ASR）

语音识别支持将输入的音频自动转换为文本输出，适用于会议转写、歌词识别、方言转写、嘈杂环境录音等场景。您可通过指定语种等参数，提升识别准确率。

**核心能力**

  * **覆盖多种语言与方言** ：支持中英双语识别及自动语种检测，原生支持粤语、吴语、闽南语、四川话等中国方言。

  * **支持多种复杂场景** ：在噪声、远场拾音、多人重叠对话等复杂声学条件下保持稳定识别，支持带伴奏的歌词转写。

  * **精准处理多种专业内容** ：精准识别古诗词、专业术语、人名地名等知识密集型内容，自动生成标点无需后处理。

## 支持的模型

当前仅支持 `mimo-v2.5-asr` 模型。

## 准备工作

获取 API Key 等准备工作，请参考 [首次调用 API](<https://mimo.mi.com/#/docs/quick-start/first-api-call>)。

## 支持的音频格式

目前仅支持 `wav` 和 `mp3` 格式的音频样本文件，传入前需将音频文件转换为 Base64 编码字符串，Base64 编码后的字符串大小上限为 10MB。

传入格式为：`data:{MIME_TYPE};base64,$BASE64_AUDIO`

**支持的格式及对应 MIME 类型：**

格式 | MIME 类型  
---|---  
wav | `audio/wav`  
mp3 | `audio/mpeg` 或 `audio/mp3`  
  
## 调用示例

**注意事项**

  * 音频数据需通过 `input_audio.data` 字段以 data URL 格式传入。
  * 使用 `asr_options.language` 指定语种，未配置时为自动检测。明确语种时建议手动指定，提升识别效果。支持取值：`auto`、`zh`、`en`。

### 非流式调用

**Curl**
    
    
    curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header 'Content-Type: application/json' \
    --data-raw '{
        "model": "mimo-v2.5-asr",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": "data:{MIME_TYPE};base64,$BASE64_AUDIO"
                        }
                    }
                ]
            }
        ],
        "asr_options": {
            "language": "zh"
        }
    }'
    

**Python**
    
    
    import os
    import base64
    from openai import OpenAI
    
    client = OpenAI(
        api_key=os.environ.get("MIMO_API_KEY"),
        base_url="https://api.xiaomimimo.com/v1"
    )
    
    # 需替换为本地真实的文件路径
    with open("audio_file.wav", "rb") as f:
        audio_bytes = f.read()
    audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
    
    completion = client.chat.completions.create(
        model="mimo-v2.5-asr",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": f"data:audio/wav;base64,{audio_base64}"
                        }
                    }
                ]
            }
        ],
        extra_body={
            "asr_options": {
                "language": "zh"
            }
        }
    )
    
    print(completion.model_dump_json())
    

### 流式调用

**Curl**
    
    
    curl --location --request POST 'https://api.xiaomimimo.com/v1/chat/completions' \
    --header "api-key: $MIMO_API_KEY" \
    --header 'Content-Type: application/json' \
    --data-raw '{
        "model": "mimo-v2.5-asr",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": "data:{MIME_TYPE};base64,$BASE64_AUDIO"
                        }
                    }
                ]
            }
        ],
        "asr_options": {
            "language": "auto"
        },
        "stream": true
    }'
    

**Python**
    
    
    import os
    import base64
    from openai import OpenAI
    
    client = OpenAI(
        api_key=os.environ.get("MIMO_API_KEY"),
        base_url="https://api.xiaomimimo.com/v1"
    )
    
    # 需替换为本地真实的文件路径
    with open("audio_file.wav", "rb") as f:
        audio_bytes = f.read()
    audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
    
    completion = client.chat.completions.create(
        model="mimo-v2.5-asr",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_audio",
                        "input_audio": {
                            "data": f"data:audio/wav;base64,{audio_base64}"
                        }
                    }
                ]
            }
        ],
        extra_body={
            "asr_options": {
                "language": "auto"
            }
        },
        stream=True
    )
    
    for chunk in completion:
        print(chunk.model_dump_json())
    

## 计费说明

  * 计费：请参考 [按量计费 API](<https://mimo.mi.com/#/docs/pricing>)。

  * 查看账单：您可以在控制台的 [账单明细](<https://platform.xiaomimimo.com/#/console/usage>) 页面查看用量。

更新时间 2026 年 06 月 02 日

[视频理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/video-understanding>)[语音合成（MiMo-V2.5-TTS 系列）](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/speech-synthesis-v2.5>)