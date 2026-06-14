# 视频理解

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

# 视频理解

视频理解模型可以根据您传入的视频进行回答，支持视频 URL 和 Base64 编码两种传入方式，适用于视频分析等场景。

## 快速开始

注意：获取 API Key 等准备工作，请参考 [首次调用API](<https://mimo.mi.com/#/docs/quick-start/first-api-call>)。

通过视频 URL 方式传入模型快速体验视频理解效果，示例代码如下。

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
                        "type": "video_url",
                        "video_url": {
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/video/video_example.mp4"
                        },
                        "fps": 2,
                        "media_resolution": "default"
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the video"
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
                        "type": "video_url",
                        "video_url": {
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/video/video_example.mp4"
                        },
                        "fps": 2,
                        "media_resolution": "default"
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the video"
                    }
                ]
            }
        ],
        max_completion_tokens=1024
    )
    
    print(completion.model_dump_json())
    

**响应结果**
    
    
    {
        "id": "a7a6fe52ffeb40ab9e699fe018592b16",
        "choices": [
            {
                "finish_reason": "stop",
                "index": 0,
                "message": {
                    "content": "The video features a small, fluffy white kitten with bright blue eyes sitting on a polished wooden floor. The kitten is positioned near a window draped with sheer, light-colored curtains, through which sunlight is streaming, casting warm shadows on the floorboards. In the background to the right, a potted green plant, resembling a Monstera, adds a touch of color to the room.\\n\\nThroughout the clip, the kitten is meowing repeatedly. It opens its mouth wide to let out high-pitched meows, looking slightly to its left before turning its gaze directly toward the camera. The audio consists entirely of the kitten's vocalizations.",
                    "role": "assistant",
                    "tool_calls": null,
                    "reasoning_content": "The user wants me to describe the video provided.\\n\\n1.  **Analyze the video:**\\n*   **Subject:** A small white kitten with striking blue eyes.\\n*   **Action:** The kitten is sitting on a wooden floor near a window. It is meowing. Its mouth opens and closes repeatedly. It looks slightly to its left and then more directly forward.\\n*   **Setting:** Indoors. There's a window on the left with light-colored curtains. Sunlight is streaming in, casting shadows on the floor. In the background, there's a green plant (looks like a Monstera) in a pot. The walls are light-colored.\\n*   **Audio:** The audio consists of the kitten meowing. It's a series of high-pitched meows.\\n*   **Visual details:** The kitten is fluffy. The floor is polished wood. The lighting is warm and natural.\\n\\n2.  **Break down the description chronologically:**\\n*   **Start (00:00 - 00:01):** The video opens with a white kitten sitting on a wooden floor. It's positioned near a window with sheer curtains. Sunlight is hitting the floor. The kitten is looking slightly to the side.\\n*   **Middle (00:01 - 00:02):** The kitten opens its mouth wide to meow. It does this multiple times. Its gaze shifts a bit. The sunlight highlights its white fur.\\n*   **End (00:02 - 00:03):** The kitten continues to meow. It looks directly at the camera/viewer. The background remains consistent with the plant and the wall.\\n\\n3.  **Synthesize the description:**\\n*   Start with the main subject: A white kitten with blue eyes.\\n*   Describe the environment: Sitting on a wooden floor near a window with curtains. Sunlight is present. A plant is in the background.\\n*   Describe the action: The kitten is meowing repeatedly. It looks around and then at the camera.\\n*   Mention the audio: The sound of the kitten meowing.\\n\\n4.  **Refine the language:**\\n*   \\\"A white kitten with blue eyes is sitting on a wooden floor.\\\"\\n*   \\\"It is positioned next to a window with light curtains.\\\"\\n*   \\\"Sunlight is streaming in, creating shadows.\\\"\\n*   \\\"The kitten is meowing, opening its mouth wide.\\\"\\n*   \\\"In the background, there is a potted green plant.\\\"\\n*   \\\"The kitten looks to the side and then towards the camera while meowing.\\\"\\n\\n5.  **Final Polish:** Combine these points into a coherent paragraph or a list of key observations. The prompt asks to \\\"describe the content of the video,\\\" so a narrative description is appropriate.\\n\\n*   *Draft:* The video shows a cute white kitten with blue eyes sitting on a polished wooden floor. It's near a window with white curtains that are letting in bright sunlight. To the right, in the background, there is a large green plant. The kitten is meowing repeatedly, opening its mouth wide. It looks around a bit and then stares directly at the camera. The audio is just the sound of the kitten's meows.\\n\\n*   *Structure:*\\n*   **Scene:** White kitten, wooden floor, window, sunlight, plant.\\n*   **Action:** Meowing, looking around.\\n*   **Audio:** Meowing sounds.\\n\\nThis covers all the essential aspects of the video."
                }
            }
        ],
        "created": 1776850708,
        "model": "mimo-v2.5",
        "object": "chat.completion",
        "usage": {
            "completion_tokens": 849,
            "prompt_tokens": 1260,
            "total_tokens": 2109,
            "completion_tokens_details": {
                "reasoning_tokens": 719
            },
            "prompt_tokens_details": {
                "audio_tokens": 19,
                "cached_tokens": 1256,
                "video_tokens": 1144
            }
        }
    }
    

## 支持的模型列表

当前仅支持 `mimo-v2.5`，`mimo-v2-omni` 模型。

## 视频传入方式

支持的视频传入方式如下：

  * 视频 URL 传入：需提供公网可访问的视频 URL 地址。

  * Base64 编码传入：将视频转换为 Base64 编码字符串后再传入。

### 视频 URL 传入

通过公网可访问的视频 URL 地址直接传入视频，适用于视频已存储在公网可访问环境的场景。单个视频文件大小不能超过 300 MB。

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
                        "type": "video_url",
                        "video_url": {
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/video/video_example.mp4"
                        },
                        "fps": 2,
                        "media_resolution": "default"
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the video"
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
                        "type": "video_url",
                        "video_url": {
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/video/video_example.mp4"
                        },
                        "fps": 2,
                        "media_resolution": "default"
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the video"
                    }
                ]
            }
        ],
        max_completion_tokens=1024
    )
    
    print(completion.model_dump_json())
    

### Base64 编码传入

将视频文件转换为 Base64 编码字符串后传入，适用于视频无法通过公网 URL 访问的场景。转换后的 Base64 编码的字符串大小不能超过 50 MB。

请在 Base64 编码前携带前缀：`data:{MIME_TYPE};base64,$BASE64_VIDEO`

  * `{MIME_TYPE}`：视频的 MIME 类型（媒体类型），用于标识视频格式，需替换为实际视频对应的 MIME 值。
  * `$BASE64_VIDEO`：视频文件的纯 Base64 编码字符串（不含任何前缀）。

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
                        "type": "video_url",
                        "video_url": {
                            "url": "data:{MIME_TYPE};base64,$BASE64_VIDEO"
                        },
                        "fps": 2,
                        "media_resolution": "default"
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the video"
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
                        "type": "video_url",
                        "video_url": {
                            "url": "data:{MIME_TYPE};base64,$BASE64_VIDEO"
                        },
                        "fps": 2,
                        "media_resolution": "default"
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the video"
                    }
                ]
            }
        ],
        max_completion_tokens=1024
    )
    
    print(completion.model_dump_json())
    

## 使用说明

### 视频限制

  * 视频格式：MP4，MOV，AVI，WMV。

> 视频文件格式变种较多，不能保证所有文件都能被识别，请通过测试验证文件能够被正常识别。

  * 视频大小：

    * 以 URL 方式传入时：单个视频文件大小不超过 300 MB。

    * 以 Base64 编码传入时：单个视频的 Base64 编码字符串大小不超过 50 MB。

  * 视频数量：传入多个视频时，视频数量受模型上下文长度限制，所有音频和文本的总 Token 数必须小于模型的上下文长度。

> 注：计算视频的 Token 请参考 [视频 Token 用量说明](<https://mimo.mi.com/#/docs/usage-guide/multimodal-understanding/video-understanding?target=%E8%A7%86%E9%A2%91-token-%E7%94%A8%E9%87%8F%E8%AF%B4%E6%98%8E>)。模型上下文长度请参考 [定价与限速](<https://mimo.mi.com/#/docs/pricing>)。

### 控制视频理解的精细度

您可以分别通过 `fps` 和 `media_resolution` 两个字段来控制视频理解的精细度。

  1. `fps` 即每秒从视频中抽取图像的帧数，用于控制视频时间维度的理解精细度。默认值为 2，范围为 `[0.1, 10]`。

     * 数值越高，抽帧越密集，模型对画面变化、动作、时序细节的感知越精细；

     * 数值越低，抽帧越稀疏，处理速度越快，Token 消耗越少。

  2. `media_resolution` 即视频帧的解析分辨率档次，用于控制单帧画面的视觉理解精细度。默认值为 `default`。

     * `default`：默认档次，平衡识别效果与处理效率；

     * `max`：最高分辨率档次，提升对小物体、细节纹理的识别能力。

## 视频 Token 用量说明

视频的 Token 分为 `video_tokens`（视觉）与 `audio_tokens`（音频）。

  * `video_tokens` 计算请参考以下代码。估算结果仅供参考，实际用量以 API 响应为准。
        
        """
        根据视频的时长、分辨率，估算 API 调用所消耗的 Token 数。
        用户可通过 fps 和 media_resolution 两个参数控制精细度：
          - fps: 每秒抽帧数，默认 2，范围 [0.1, 10]。越高时序越精细，Token 越多。
          - media_resolution: 单帧分辨率档次。"default" 平衡效果与效率；"max" 提升细节识别。
        """
        
        import math
        
        def estimate_video_tokens(
            duration: float,
            width: int,
            height: int,
            fps: float = 2.0,
            media_resolution: str = "default",
            mute: bool = False,
        ) -> int:
            """
            估算视频输入的 Token 数。
        
            Args:
                duration:         视频时长（秒）
                width:            视频宽度（像素）
                height:           视频高度（像素）
                fps:              抽帧帧率，默认 2，范围 [0.1, 10]
                media_resolution: "default" 或 "max"
                mute:             True 则不计算音频 Token
        
            Returns:
                预估总 Token 数
            """
            # ---- 常量 ----
            PATCH, MERGE, T_PATCH = 16, 2, 2
            SPATIAL = PATCH * MERGE                         # 32
            PIX_PER_TOKEN = SPATIAL ** 2                    # 1024
            MAX_TOTAL_TOKENS = 131072
            TOTAL_MAX_PIX = MAX_TOTAL_TOKENS * PIX_PER_TOKEN
            MIN_PIX, MAX_PIX = 8192, 8388608
            MAX_FRAMES = 2048
            DEFAULT_MAX_FRAME_TOKEN = 300
        
            # ---- 1. 抽帧数 ----
            nframes = math.ceil(duration * fps)
            nframes = min(nframes, MAX_FRAMES)
            nframes = max(math.ceil(nframes / T_PATCH) * T_PATCH, T_PATCH)
        
            # ---- 2. 单帧像素预算 ----
            max_pix = TOTAL_MAX_PIX * T_PATCH // nframes
            if media_resolution != "max":
                max_pix = min(max_pix, DEFAULT_MAX_FRAME_TOKEN * PIX_PER_TOKEN)
            max_pix = max(MIN_PIX, min(max_pix, MAX_PIX))
        
            # ---- 3. 缩放分辨率 ----
            h, w = height, width
            if min(h, w) < SPATIAL:
                if h < w:
                    w = int(w * SPATIAL / h); h = SPATIAL
                else:
                    h = int(h * SPATIAL / w); w = SPATIAL
            h_bar = round(h / SPATIAL) * SPATIAL
            w_bar = round(w / SPATIAL) * SPATIAL
            if h_bar * w_bar > max_pix:
                beta = math.sqrt(h * w / max_pix)
                h_bar = math.floor(h / beta / SPATIAL) * SPATIAL
                w_bar = math.floor(w / beta / SPATIAL) * SPATIAL
            elif h_bar * w_bar < MIN_PIX:
                beta = math.sqrt(MIN_PIX / (h * w))
                h_bar = math.ceil(h * beta / SPATIAL) * SPATIAL
                w_bar = math.ceil(w * beta / SPATIAL) * SPATIAL
        
            # ---- 4. Token 计算 ----
            grids = nframes // T_PATCH                       # 时序网格数
            tokens_per_grid = (h_bar // PATCH) * (w_bar // PATCH) // (MERGE ** 2)
            vision = grids * tokens_per_grid
            timestamps = grids * (5 if fps > 2 else 3)       # 时间戳文本 token
            special = grids * 2 + 2                           # 特殊标记
        
            # ---- 5. 音频 Token ----
            audio = 0
            if not mute:
                spec_len = int(duration * 24000) // 240 + 1
                t = (spec_len - 1) // 2 + 1
                t = t // 2 + int(t % 2 != 0)
                audio = math.ceil(t / 4) + 2                 # +2 for audio special tokens
        
            return vision + timestamps + special + audio
        
        # ============ 示例 ============
        if __name__ == "__main__":
            # 一个 1080p、60 秒的视频
            tokens = estimate_video_tokens(duration=60, width=1920, height=1080)
            print(f"默认参数 (fps=2, default): {tokens:,} tokens")
        
            tokens = estimate_video_tokens(duration=60, width=1920, height=1080, fps=5)
            print(f"高帧率  (fps=5, default): {tokens:,} tokens")
        
            tokens = estimate_video_tokens(duration=60, width=1920, height=1080, media_resolution="max")
            print(f"高分辨率 (fps=2, max):     {tokens:,} tokens")
        
            tokens = estimate_video_tokens(duration=60, width=1920, height=1080, mute=True)
            print(f"静音    (fps=2, mute):    {tokens:,} tokens")
        
        

  * `audio_tokens` 计算请参考以下代码。估算结果仅供参考，实际用量以 API 响应为准。
        
        总 Tokens 数 ≈ 音频时长（单位：秒）* 6.25
        

## 计费说明

  * 计费：总费用根据输入、输入（命中缓存）和输出 Token 数计算；价格请参考 [定价与限速](<https://mimo.mi.com/#/docs/pricing>)。

    * 可通过 [视频 Token 用量说明](<https://mimo.mi.com/#/docs/usage-guide/multimodal-understanding/video-understanding?target=%E8%A7%86%E9%A2%91-token-%E7%94%A8%E9%87%8F%E8%AF%B4%E6%98%8E>) 计算视频的 Token 消耗。估算结果仅供参考，实际用量以 API 响应为准。
  * 查看账单：您可以在控制台的 [账单明细](<https://platform.xiaomimimo.com/#/console/usage>) 页面查看账单及用量。

## 常见问题

### 是否支持本地文件上传？

`mimo-v2.5` 和 `mimo-v2-omni` 模型暂不支持视频本地文件上传。支持的上传方式请参考 [视频传入方式](<https://mimo.mi.com/#/docs/usage-guide/multimodal-understanding/video-understanding?target=%E8%A7%86%E9%A2%91%E4%BC%A0%E5%85%A5%E6%96%B9%E5%BC%8F>)。

更新时间 2026 年 04 月 22 日

[音频理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/audio-understanding>)[语音识别（MiMo-V2.5-ASR）](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/Speech-Recognition>)