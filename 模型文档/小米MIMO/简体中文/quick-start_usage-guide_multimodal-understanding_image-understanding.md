# 图片理解

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

# 图片理解

图片理解模型可以根据您传入的图片进行回答，支持图片 URL 和 Base64 编码两种传入方式，适用于图片描述、分类等场景。

## 快速开始

注意：获取 API Key 等准备工作，请参考 [首次调用API](<https://mimo.mi.com/#/docs/quick-start/first-api-call>)。

通过图片 URL 方式传入模型快速体验图片理解效果，示例代码如下。

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
                        "type": "image_url",
                        "image_url": {
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/image/image_example.png"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the image"
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
                        "type": "image_url",
                        "image_url": {
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/image/image_example.png"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the image"
                    }
                ]
            }
        ],
        max_completion_tokens=1024
    )
    
    print(completion.model_dump_json())
    

**响应结果**
    
    
    {
        "id": "be319773af414195b27a9b1cefc3fe6f",
        "choices": [
            {
                "finish_reason": "stop",
                "index": 0,
                "message": {
                    "content": "This is a serene, lush temperate old-growth forest scene, bathed in warm, golden hour light, likely early morning or late afternoon:\\n\\n1.  **Foreground & Stream**: A shallow, clear stream winds through the scene, its surface catching the sunlight to create shimmering highlights. Smooth, rounded river rocks, many covered in thick, vibrant green moss, line the stream's banks and sit partially submerged in the water. On the left, a large, detailed fern with full, feathery fronds anchors the mossy shore.\\n2.  **Midground & Forest Floor**: The forest floor is dense with verdant, mossy growth, small leafy shrubs, and undergrowth, creating a rich, textured green landscape. Ancient, gnarled trees with thick, textured trunks and sprawling, twisted branches rise up, their bases rooted in the mossy earth.\\n3.  **Light & Atmosphere**: Soft, dramatic sunbeams, crepuscular rays, filter through the misty forest canopy, cutting through the hazy air. Tiny particles like pollen or dust catch the light, adding an ethereal, magical quality. Mist hangs between the trees, softening the background and lending the scene a quiet, tranquil, almost enchanted mood.\\n\\nThe image conveys a sense of peace, untouched natural beauty, and the quiet magic of an old, undisturbed forest.",
                    "role": "assistant",
                    "tool_calls": null,
                    "reasoning_content": "Got it, let's break down this image step by step. First, the setting is a lush, misty old-growth forest, early morning or late afternoon (golden hour, since the sunbeams are warm).\\n\\nStart with the foreground: a shallow, clear stream with smooth, moss-covered rocks lining its banks. The rocks are rounded, some partially submerged, with bright green moss growing thickly on them and the shore. On the left, a large, vibrant fern with detailed fronds sits on the mossy bank.\\n\\nThen the midground: the stream winds through the forest, with small shrubs and more mossy growth along its edges. The trees are ancient, with thick, gnarled trunks and sprawling, twisted branches, their bark textured and aged. The forest floor is covered in moss and undergrowth, feeling dense and verdant.\\n\\nThe background and lighting: soft, golden sunbeams (crepuscular rays) filter through the misty forest canopy, illuminating the air—you can see tiny particles (like dust or pollen) catching the light, creating a magical, ethereal glow. The mist hangs in the air between the trees, softening the background and adding depth, making the forest feel quiet, serene, and almost enchanted.\\n\\nOverall, it's a tranquil, lush temperate rainforest scene, full of natural detail, with warm, diffused light creating a peaceful, mystical atmosphere."
                }
            }
        ],
        "created": 1776850561,
        "model": "mimo-v2.5",
        "object": "chat.completion",
        "usage": {
            "completion_tokens": 574,
            "prompt_tokens": 1085,
            "total_tokens": 1659,
            "completion_tokens_details": {
                "reasoning_tokens": 288
            },
            "prompt_tokens_details": {
                "cached_tokens": 1081,
                "image_tokens": 1024
            }
        }
    }
    

## 支持的模型列表

当前仅支持 `mimo-v2.5`，`mimo-v2-omni` 模型。

## 图片传入方式

支持的图片传入方式如下：

  * 图片 URL 传入：需提供公网可访问的图片 URL 地址。

  * Base64 编码传入：将图片转换为 Base64 编码字符串后再传入。

### 图片 URL 传入

通过公网可访问的图片 URL 地址直接传入图片，适用于图片已存储在公网可访问环境的场景。单张图片的文件大小不能超过 50 MB。

#### OpenAI API

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
                        "type": "image_url",
                        "image_url": {
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/image/image_example.png"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the image"
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
                        "type": "image_url",
                        "image_url": {
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/image/image_example.png"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the image"
                    }
                ]
            }
        ],
        max_completion_tokens=1024
    )
    
    print(completion.model_dump_json())
    

#### Anthropic API

**Curl**
    
    
    curl --location --request POST 'https://api.xiaomimimo.com/anthropic/v1/messages' \
    --header "api-key: $MIMO_API_KEY" \
    --header "Content-Type: application/json" \
    --data-raw '{
        "model": "mimo-v2.5",
        "max_tokens": 1024,
        "system": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024.",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/image/image_example.png"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the image"
                    }
                ]
            }
        ]
    }'
    

**Python**
    
    
    import os
    from anthropic import Anthropic
    
    client = Anthropic(
        api_key=os.environ.get("MIMO_API_KEY"),
        base_url="https://api.xiaomimimo.com/anthropic"
    )
    
    message = client.messages.create(
        model="mimo-v2.5",
        max_tokens=1024,
        system="You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024.",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "url",
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/image/image_example.png"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the image"
                    }
                ]
            }
        ]
    )
    
    print(message.content)
    

### Base64 编码传入

将图片文件转换为 Base64 编码字符串后传入，适用于图片无法通过公网 URL 访问的场景。转换后的 Base64 编码的字符串大小不能超过 50 MB。

#### OpenAI API

请在 Base64 编码前携带前缀：`data:{MIME_TYPE};base64,$BASE64_IMAGE`

  * `{MIME_TYPE}`：图像的 MIME 类型（媒体类型），用于标识图像格式，需替换为实际图像对应的 MIME 值。
  * `$BASE64_IMAGE`：图像文件的纯 Base64 编码字符串（不含任何前缀）。

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
                        "type": "image_url",
                        "image_url": {
                            "url": "data:{MIME_TYPE};base64,$BASE64_IMAGE"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the image"
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
                        "type": "image_url",
                        "image_url": {
                            "url": "data:{MIME_TYPE};base64,$BASE64_IMAGE"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the image"
                    }
                ]
            }
        ],
        max_completion_tokens=1024
    )
    
    print(completion.model_dump_json())
    

#### Anthropic API

**Curl**
    
    
    curl --location --request POST 'https://api.xiaomimimo.com/anthropic/v1/messages' \
    --header "api-key: $MIMO_API_KEY" \
    --header "Content-Type: application/json" \
    --data-raw '{
        "model": "mimo-v2.5",
        "max_tokens": 1024,
        "system": "You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024.",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "{MIME_TYPE}"
                            "data": "$BASE64_IMAGE"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the image"
                    }
                ]
            }
        ]
    }'
    

**Python**
    
    
    import os
    from anthropic import Anthropic
    
    client = Anthropic(
        api_key=os.environ.get("MIMO_API_KEY"),
        base_url="https://api.xiaomimimo.com/anthropic"
    )
    
    message = client.messages.create(
        model="mimo-v2.5",
        max_tokens=1024,
        system="You are MiMo, an AI assistant developed by Xiaomi. Today is date: Tuesday, December 16, 2025. Your knowledge cutoff date is December 2024.",
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "{MIME_TYPE}"
                            "data": "$BASE64_IMAGE"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the content of the image"
                    }
                ]
            }
        ]
    )
    
    print(message.content)
    

### 多图输入

支持同时传入多张图像的公网 URL 或 Base64 编码字符串，模型能够解析图像内容并返回贴合图像语义的回复。

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
                        "type": "image_url",
                        "image_url": {
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/image/image_example.png"
                        }
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:{MIME_TYPE};base64,$BASE64_IMAGE"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the connections and differences between these two pictures"
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
                        "type": "image_url",
                        "image_url": {
                            "url": "https://example-files.cnbj1.mi-fds.com/example-files/image/image_example.png"
                        }
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:{MIME_TYPE};base64,$BASE64_IMAGE"
                        }
                    },
                    {
                        "type": "text",
                        "text": "please describe the connections and differences between these two pictures"
                    }
                ]
            }
        ],
        max_completion_tokens=1024
    )
    
    print(completion.model_dump_json())
    

## 图片限制

  * 图片格式：JPEG，PNG，GIF，WebP，BMP。

  * 图像大小：

  * 以 URL 方式传入时：单张图片文件大小不超过 50 MB。

  * 以 Base64 编码传入时：单张图片 Base64 编码字符串大小不超过 50 MB。

  * 图片数量：传入多张图片时，图片数量受模型上下文长度限制，所有图片和文本的总 Token 数必须小于模型的上下文长度。

> 注：计算图像的 Token 请参考 [图片 Token 用量说明](<https://mimo.mi.com/#/docs/usage-guide/multimodal-understanding/image-understanding?target=%E5%9B%BE%E7%89%87-token-%E7%94%A8%E9%87%8F%E5%8F%8A%E7%BC%A9%E6%94%BE%E8%A7%84%E5%88%99%E8%AF%B4%E6%98%8E>)。模型上下文长度请参考 [定价与限速](<https://mimo.mi.com/#/docs/pricing>)。

## 图片 Token 用量及缩放规则说明

图片的计算规则较为复杂，Token 转化及缩放规则请参考以下代码。估算结果仅供参考，实际用量以 API 响应为准。
    
    
    import math
    from PIL import Image
    
    PATCH_SIZE = 16
    SPATIAL_MERGE_SIZE = 2
    TEMPORAL_PATCH_SIZE = 2
    IMAGE_MIN_PIXELS = 8192
    IMAGE_MAX_PIXELS = 8388608
    
    def calc_image_tokens(image_path: str) -> dict:
        image = Image.open(image_path)
        height = image.height
        width = image.width
    
        factor = PATCH_SIZE * SPATIAL_MERGE_SIZE  # 32
    
        h_bar = round(height / factor) * factor
        w_bar = round(width / factor) * factor
    
        if h_bar * w_bar > IMAGE_MAX_PIXELS:
            beta = math.sqrt((height * width) / IMAGE_MAX_PIXELS)
            h_bar = math.floor(height / beta / factor) * factor
            w_bar = math.floor(width / beta / factor) * factor
        elif h_bar * w_bar < IMAGE_MIN_PIXELS:
            beta = math.sqrt(IMAGE_MIN_PIXELS / (height * width))
            h_bar = math.ceil(height / beta / factor) * factor
            w_bar = math.ceil(width / beta / factor) * factor
    
        grid_t = 1
        grid_h = h_bar // PATCH_SIZE
        grid_w = w_bar // PATCH_SIZE
        num_tokens = (grid_t * grid_h * grid_w) // (SPATIAL_MERGE_SIZE ** 2)
        return num_tokens
    
    if __name__ == "__main__":
       token = calc_image_tokens(image_path="xxx/test.jpg")
       print(token)
    

## 计费说明

  * 计费：总费用根据输入、输入（命中缓存）和输出 Token 数计算；价格请参考 [定价与限速](<https://mimo.mi.com/#/docs/pricing>)。

  * 可通过 [图片 Token 用量说明](<https://mimo.mi.com/#/docs/usage-guide/multimodal-understanding/image-understanding?target=%E5%9B%BE%E7%89%87-token-%E7%94%A8%E9%87%8F%E5%8F%8A%E7%BC%A9%E6%94%BE%E8%A7%84%E5%88%99%E8%AF%B4%E6%98%8E>) 计算图片的 Token 消耗。估算结果仅供参考，实际用量以 API 响应为准。

  * 查看账单：您可以在控制台的 [账单明细](<https://platform.xiaomimimo.com/#/console/usage>) 页面查看账单及用量。

## 常见问题

### 是否支持本地文件上传？

`mimo-v2.5` 和 `mimo-v2-omni` 模型暂不支持图片本地文件上传。支持的上传方式请参考 [图片传入方式](<https://mimo.mi.com/#/docs/usage-guide/multimodal-understanding/image-understanding?target=%E5%9B%BE%E7%89%87%E4%BC%A0%E5%85%A5%E6%96%B9%E5%BC%8F>)。

更新时间 2026 年 04 月 22 日

[联网搜索](</docs/zh-CN/quick-start/usage-guide/tool-calling/web-search>)[音频理解](</docs/zh-CN/quick-start/usage-guide/multimodal-understanding/audio-understanding>)