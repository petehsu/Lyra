# 语音识别（MiMo‑V2.5-ASR）- OpenAI API 兼容

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

# 语音识别（MiMo‑V2.5-ASR）- OpenAI API 兼容

## 请求地址
    
    
    https://api.xiaomimimo.com/v1/chat/completions
    

## 请求头

接口支持以下两种认证方式，请选择其中一种添加到请求头中：

  1. 方式一：`api-key` 字段认证，格式：
         
         api-key: $MIMO_API_KEY
         Content-Type: application/json
         

  2. 方式二：`Authorization: Bearer` 认证，格式：
         
         Authorization: Bearer $MIMO_API_KEY
         Content-Type: application/json
         

## 请求体

  *   * messagesarray必选

消息列表。

隐藏子属性

User message · object

  * 由终端用户发送的消息。

隐藏子属性

  * messages.contentarray必选

用户消息的内容。  

> 详细用法请参考 [语音识别](<https://mimo.mi.com/docs/zh-CN/usage-guide/Speech-Recognition>)。

隐藏子属性

Array of content parts · array

  * 一个由指定类型的内容部分组成的数组。对于语音识别，仅支持单条音频输入。

隐藏子属性

Audio content part · object

  * 隐藏子属性

  * messages.content.input_audioobject必选

隐藏子属性

  * messages.content.input_audio.datastring必选

采用 data URL 格式的 Base64 编码音频。输入音频仅支持 `mp3`、`wav` 两种格式：  

    * `mp3`：`MIME_TYPE` 取值 `audio/mpeg`、`audio/mp3`
    * `wav`：`MIME_TYPE` 取值 `audio/wav`

  * messages.content.typestring必选

内容部分的类型。  
可选值：`input_audio`

  * messages.rolestring必选

消息作者的角色。  
可选值：`user`

  *   * modelstring必选

用于生成响应的模型 ID。  
可选值：`mimo-v2.5-asr`

  *   * asr_optionsobject

语音识别（ASR）自定义配置参数。

隐藏子属性

  * asr_options.languagestring默认值: auto

指定音频识别语种，仅支持单一语种。  

    * `auto`：自动检测音频语种
    * `zh`：中文
    * `en`：英文
可选值：`auto`，`zh`，`en`

  *   * streamboolean默认值: false

如果设置为 `true`，模型的响应数据会在生成过程中通过SSE（server-sent events）的形式流式传输到客户端。

## Chat 响应对象（非流式输出）

  *   * choicesarray

包含生成的回复选项列表。

隐藏子属性

  * choices.finish_reasonstring

模型停止生成 token 的原因：  

    * `stop`：模型到达自然结束点或触发了用户指定的停止序列
    * `length`：因超出模型最大生成长度而终止
    * `content_filter`：内容因触发过滤策略而被拦截

  * choices.indexinteger

选项列表中对应选项的索引。

  * choices.messageobject

模型生成的对话补全消息。

隐藏子属性

  * choices.message.contentstring

消息的内容。

  * choices.message.rolestring

消息作者的角色。

  *   * createdinteger

对话补全对象创建时的 Unix 时间戳（以秒为单位）。

  *   * idstring

响应的唯一标识符。

  *   * modelstring

用于生成结果的模型。

  *   * objectstring

对象类型，仅为 `chat.completion`。

  *   * usageobject | null

该对话补全请求的用量信息。

隐藏子属性

  * usage.completion_tokensinteger

模型输出内容花费的 token。

  * usage.prompt_tokensinteger

提示词使用的 token 数量。

  * usage.total_tokensinteger

请求中使用的 token 总数（提示词 + 补全结果）。

  * usage.completion_tokens_detailsobject

补全中使用的 token 数量明细。

隐藏子属性

  * usage.completion_tokens_details.reasoning_tokensinteger

模型为推理生成的 token 数量，固定为 `0`。

  * usage.prompt_tokens_detailsobject

提示中使用的 token 数量明细。

隐藏子属性

  * usage.prompt_tokens_details.cached_tokensinteger

命中缓存的 token 数量。

  * usage.prompt_tokens_details.audio_tokensinteger

提示中存在的音频输入 token 数量。

  * usage.secondsinteger

音频时长（秒）。

## Chat 响应 chunk 对象（流式输出）

  *   * choicesarray

包含生成的回复选项列表。

隐藏子属性

  * choices.deltaobject

流式模型响应生成的对话补全增量。

隐藏子属性

  * choices.delta.contentstring

数据块消息的内容。

  * choices.delta.rolestring

消息作者的角色。

  * choices.finish_reasonstring | null

模型停止生成 token 的原因：  

    * `stop`：模型到达自然结束点或触发了用户指定的停止序列
    * `length`：因超出模型最大生成长度而终止
    * `content_filter`：内容因触发过滤策略而被拦截

  * choices.indexinteger

选项列表中对应选项的索引。

  *   * createdinteger

对话补全对象创建时的 Unix 时间戳（以秒为单位）。每个数据块均使用相同的时间戳。

  *   * idstring

对话补全对象的唯一标识符。每个数据块均使用相同的 ID。

  *   * modelstring

用于生成结果的模型。

  *   * objectstring

对象类型，仅为 `chat.completion.chunk`。

  *   * usageobject | null

该对话补全请求的用量信息。

隐藏子属性

  * usage.completion_tokensinteger

模型输出内容花费的 token。

  * usage.prompt_tokensinteger

提示词使用的 token 数量。

  * usage.total_tokensinteger

请求中使用的 token 总数（提示词 + 补全结果）。

  * usage.completion_tokens_detailsobject

补全中使用的 token 数量明细。

隐藏子属性

  * usage.completion_tokens_details.reasoning_tokensinteger

模型为推理生成的 token 数量，固定为 `0`。

  * usage.prompt_tokens_detailsobject

提示中使用的 token 数量明细。

隐藏子属性

  * usage.prompt_tokens_details.cached_tokensinteger

命中缓存的 token 数量。

  * usage.prompt_tokens_details.audio_tokensinteger

提示中存在的音频输入 token 数量。

  * usage.secondsinteger

音频时长（秒）。

curlpython

基础调用

流式响应
    
    
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
        }
    }'

响应

基础调用

流式响应
    
    
    {
        "id": "9f51eba459dd4dfdabb31cabba0cb7dc",
        "choices": [
            {
                "finish_reason": "stop",
                "index": 0,
                "message": {
                    "content": "Good morning. Could you tell me what the weather will be like today?",
                    "role": "assistant",
                    "audio": null,
                    "tool_calls": null,
                    "audio_tokens": []
                }
            }
        ],
        "created": 1780398283,
        "model": "mimo-v2.5-asr",
        "object": "chat.completion",
        "usage": {
            "completion_tokens": 20,
            "prompt_tokens": 46,
            "total_tokens": 66,
            "completion_tokens_details": {
                "reasoning_tokens": 0
            },
            "prompt_tokens_details": {
                "audio_tokens": 25,
                "cached_tokens": 45
            },
            "seconds": 4
        }
    }

更新时间 2026 年 06 月 02 日

[Anthropic API](</docs/zh-CN/api/chat/anthropic-api>)[按量计费 API](</docs/zh-CN/price/pay-as-you-go>)

curlpython

基础调用

流式响应
    
    
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
        }
    }'

响应

基础调用

流式响应
    
    
    {
        "id": "9f51eba459dd4dfdabb31cabba0cb7dc",
        "choices": [
            {
                "finish_reason": "stop",
                "index": 0,
                "message": {
                    "content": "Good morning. Could you tell me what the weather will be like today?",
                    "role": "assistant",
                    "audio": null,
                    "tool_calls": null,
                    "audio_tokens": []
                }
            }
        ],
        "created": 1780398283,
        "model": "mimo-v2.5-asr",
        "object": "chat.completion",
        "usage": {
            "completion_tokens": 20,
            "prompt_tokens": 46,
            "total_tokens": 66,
            "completion_tokens_details": {
                "reasoning_tokens": 0
            },
            "prompt_tokens_details": {
                "audio_tokens": 25,
                "cached_tokens": 45
            },
            "seconds": 4
        }
    }

回到顶部