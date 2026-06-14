# OpenAI API 兼容

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

# OpenAI API 兼容

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

对话的消息列表。

隐藏子属性

Developer message · object

System message · object

User message · object

Assistant message · object

Tool message · object

  * 开发者提供的指令，模型应遵循这些指令，而不受用户发送的消息影响。

隐藏子属性

  * messages.contentstring | array必选

开发者消息的内容。

隐藏子属性

Text content · string

Array of content parts · array

  * 开发者消息的内容。

  * messages.rolestring必选

开发者消息的角色。  
可选值：`developer`

  * messages.namestring

参与者的可选名称。为模型提供信息以区分相同角色的参与者。

  *   * modelstring必选

用于生成响应的模型 ID。  
可选值：`mimo-v2.5-pro`，`mimo-v2.5`，`mimo-v2.5-tts`，`mimo-v2.5-tts-voicedesign`，`mimo-v2.5-tts-voiceclone`，`mimo-v2-pro`，`mimo-v2-omni`，`mimo-v2-tts`，`mimo-v2-flash`

  *   * audioobject

音频输出参数。详情请参考 [语音合成](<https://mimo.mi.com/#/docs/usage-guide/speech-synthesis-v2.1>)。  

> 注意：如果要生成音频，必须添加一条 `role` 为 `assistant` 的消息，该消息需指定用于音频合成的文本。此外，使用 `mimo-v2.5-tts-voicedesign` 模型时，`role` 为 `user` 的消息为必填，若将`optimize_text_preview` 设置为 `true`，则可省略 `assistant` 消息。详细用法请参考 [语音合成](<https://mimo.mi.com/#/docs/usage-guide/speech-synthesis-v2.1>)。

> 当前仅支持 `mimo-v2.5-tts`，`mimo-v2.5-tts-voicedesign`，`mimo-v2.5-tts-voiceclone` 和 `mimo-v2-tts` 模型。

隐藏子属性

  * audio.formatstring默认值: wav

指定输出音频格式。默认值：`wav`，如果设置 `stream: true` 则为 `pcm`。  

> 传入 `pcm` 或 `pcm16`，均表示指定使用 `pcm16` 格式。

可选值：`wav`，`mp3`，`pcm`，`pcm16`

  * audio.optimize_text_previewboolean默认值: false

是否开启目标音频播报文本智能优化能力。  
设置为 `true` 时，会对传入的目标文本做智能润色；若未传入目标文本，则自动生成适配播报场景的目标文本，再将处理完成的最终文本送入模型进行合成。  

> 注意：该参数为 `true` 时，可省略传入用于指定音频合成内容的 assistant 消息。

> 仅支持 `mimo-v2.5-tts-voicedesign` 模型。

  * audio.voicestring

预置音色的音色ID 或音频样本的 base64 编码。  

    * `mimo-v2.5-tts`，`mimo-v2-tts`：该字段为可选，且仅支持使用预置音色，默认值为 `mimo_default`
    * `mimo-v2.5-tts-voiceclone`：该字段为必填，且仅支持传入音频样本的 base64 编码，仅支持传入 `mp3` 和 `wav` 格式的音频样本文件
    * `mimo-v2.5-tts-voicedesign`：不支持该字段
可选值：  

    * `mimo-v2-tts`：`mimo_default`，`default_en`，`default_zh`
    * `mimo-v2.5-tts`：`mimo_default`，`冰糖`，`茉莉`，`苏打`，`白桦`，`Mia`，`Chloe`，`Milo`，`Dean`

  *   * frequency_penaltynumber | null默认值: 0

取值范围在 -2.0 到 2.0 之间的数值。如果该值为正，那么新 token 会根据其在已有文本中的出现频率受到相应的惩罚，降低模型重复相同内容的可能性。  
所需范围：`[-2.0, 2.0]`

  *   * max_completion_tokensinteger | null

对话补全中可以生成的 token 数的上限，包括可见的输出 token 数和推理 token 数。  

    * `mimo-v2-flash` 的默认值 `65536`
    * `mimo-v2.5-pro`，`mimo-v2-pro` 的默认值 `131072`
    * `mimo-v2.5`，`mimo-v2-omni` 的默认值为 `32768`
    * `mimo-v2.5-tts`，`mimo-v2.5-tts-voiceclone`，`mimo-v2.5-tts-voicedesign`，`mimo-v2-tts` 的默认值为 `8192`，取值范围为 `[1, 8192]`
所需范围：`[1, 131072]`

  *   * presence_penaltynumber | null默认值: 0

取值范围在 -2.0 到 2.0 之间的数值。如果该值为正，那么新 token 会根据其是否已在已有文本中出现受到相应的惩罚，从而增加模型谈论新主题的可能性。  
所需范围：`[-2.0, 2.0]`

  *   * response_formatobject

一个指定模型必须输出的格式的对象。  

> `mimo-v2.5-tts`，`mimo-v2.5-tts-voicedesign`，`mimo-v2.5-tts-voiceclone` 和 `mimo-v2-tts` 模型不支持。

隐藏子属性

Text · object

JSON object · object

  * 默认响应格式。用于生成文本响应。

隐藏子属性

  * response_format.typestring必选

所定义的响应格式类型。仅为 `text`。

  *   * stopstring | array | null默认值: null

最多 4 个序列，当 API 生成到这些序列时会停止继续生成 token。返回的文本中不会包含这些停止序列。  

> `mimo-v2.5-tts`，`mimo-v2.5-tts-voicedesign`，`mimo-v2.5-tts-voiceclone` 和 `mimo-v2-tts` 模型不支持。

  *   * streamboolean | null默认值: false

如果设置为 `true`，模型的响应数据会在生成过程中通过SSE（server-sent events）的形式流式传输到客户端。

  *   * thinkingobject

这个参数用于控制模型是否启用思维链。  

> 注意：在思考模式下的多轮工具调用过程中，模型会在返回 `tool_calls` 字段的同时返回 `reasoning_content` 字段。若要继续对话，建议在后续每次请求的 `messages` 数组中保留所有历史 `reasoning_content`，以获得最佳表现。

> 在思考模式下，`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-pro` 和 `mimo-v2-omni` 模型不支持自定义 `temperature` 和 `top_p` 参数。即使传入该参数，实际生效值也会被模型强制采用其推荐默认值 `1.0` 和 `0.95`。

> `mimo-v2.5-tts`，`mimo-v2.5-tts-voicedesign`，`mimo-v2.5-tts-voiceclone` 和 `mimo-v2-tts` 模型不支持。

隐藏子属性

  * thinking.typestring必选

是否启用思维链  

    * `mimo-v2-flash` 默认值为 `disabled`
    * `mimo-v2.5-pro`，`mimo-v2.5`，`mimo-v2-pro`，`mimo-v2-omni` 默认值为 `enabled`
可选值：`enabled`，`disabled`

  *   * temperaturenumber

要使用的采样温度，介于 0 和 1.5 之间。较高的值（如 0.8）会使输出更加随机，而较低的值（如 0.2）会使其更加集中和确定性。我们通常建议更改此值或 `top_p`，但不要同时更改。  

> 在思考模式下，`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-pro` 和 `mimo-v2-omni` 模型不支持自定义 `temperature` 参数。即使传入该参数，实际生效值也会被模型强制采用其推荐默认值 `1.0`。

    * `mimo-v2-flash` 默认值为 `0.3`
    * `mimo-v2.5-pro`，`mimo-v2.5`，`mimo-v2-pro`，`mimo-v2-omni` 默认值为 `1.0`
    * `mimo-v2.5-tts`，`mimo-v2.5-tts-voiceclone`，`mimo-v2.5-tts-voicedesign`，`mimo-v2-tts` 默认值为 `0.6`
所需范围：`[0, 1.5]`

  *   * tool_choicestring

控制模型如何选择工具。  

> 注意：当 `tool_choice` 传入非 `auto` 值时，后端会默认移除该字段，模型响应行为仍等同于 `auto` 模式（该逻辑保留调整的可能性）。

> `mimo-v2.5-tts`，`mimo-v2.5-tts-voicedesign`，`mimo-v2.5-tts-voiceclone` 和 `mimo-v2-tts` 模型不支持。

可选值：`auto`

  *   * toolsarray

模型可能调用的工具列表。目前仅支持函数作为工具。  

> 注意：在思考模式下的多轮工具调用过程中，模型会在返回 `tool_calls` 字段的同时返回 `reasoning_content` 字段。若要继续对话，建议在后续每次请求的 `messages` 数组中保留所有历史 `reasoning_content`，以获得最佳表现。

> `mimo-v2.5-tts`，`mimo-v2.5-tts-voicedesign`，`mimo-v2.5-tts-voiceclone` 和 `mimo-v2-tts` 模型不支持。

隐藏子属性

Function tool · object

Web search tool · object

  * 可用于生成响应的函数工具。

隐藏子属性

  * tools.functionobject必选

隐藏子属性

  * tools.function.namestring必选

工具函数的名称。必须由 `a-z`、`A-Z`、`0-9` 组成，或包含下划线（`_`）和连字符（`-`），最大长度为64。  
所需字符串长度：`1 - 64`

  * tools.function.descriptionstring

函数功能的描述，供模型判断何时以及如何调用该函数。

  * tools.function.parametersobject

函数接受的参数，以 JSON 模式对象的形式描述。  
若省略 `parameters`，则表示该函数的参数列表为空。

  * tools.function.strictboolean默认值: false

生成函数调用时是否启用严格的模式遵循。若设为 true，模型将严格遵循 `parameters` 字段中定义的确切模式。当 `strict` 为 `true` 时，仅支持 JSON 模式的一个子集。

  * tools.typestring必选

工具类型。目前仅支持 `function`。

  *   * top_pnumber默认值: 0.95

核采样的概率阈值，用于控制模型生成文本的多样性。`top_p` 值越高，生成的文本多样性越强；`top_p` 值越低，生成的文本确定性越高。  
由于 `temperature` 和 `top_p` 均用于控制生成文本的多样性，建议仅设置其中一个参数。  

> 在思考模式下，`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-pro` 和 `mimo-v2-omni` 模型不支持自定义 `top_p` 参数。即使传入该参数，实际生效值也会被模型强制采用其推荐默认值 `0.95`。

所需范围：`[0.01, 1.0]`

## Chat 响应对象（非流式输出）

  *   * choicesarray

包含生成的回复选项列表。

隐藏子属性

  * choices.finish_reasonstring

模型停止生成 token 的原因。如果模型到达自然停止点或提供的停止序列，则为 `stop`；如果达到请求中指定的最大 token 数，则为 `length`；如果模型调用了工具，则为 `tool_calls`。如果内容因触发过滤策略而被拦截，则为 `content_filter`；如果模型检测到了复读，则为 `repetition_truncation`。

  * choices.indexinteger

选项列表中对应选项的索引。

  * choices.messageobject

模型生成的对话补全消息。

隐藏子属性

  * choices.message.contentstring

消息的内容。

  * choices.message.reasoning_contentstring

助手消息中最终答案之前的推理内容。

  * choices.message.rolestring

消息作者的角色。

  * choices.message.tool_callsarray

函数调用启动后，模型会返回待调用的工具以及该调用所需的参数。此参数可包含一个或多个工具响应对象。

隐藏子属性

Function tool call · object

  * 模型创建的对函数工具的调用。

隐藏子属性

  * choices.message.tool_calls.functionobject

模型所调用的函数。

隐藏子属性

  * choices.message.tool_calls.function.argumentsstring

模型生成的用于调用函数的参数，格式为 JSON。请注意，模型生成的内容并非并非总能保证是有效的 JSON，且可能会虚构出函数模式中未定义的参数。在调用函数之前，请在代码中对这些参数进行验证。

  * choices.message.tool_calls.function.namestring

要调用的函数的名称。

  * choices.message.tool_calls.idstring

工具调用的 ID。

  * choices.message.tool_calls.typestring

工具的类型。目前仅支持 `function`。

  * choices.message.annotationsarray

联网搜索后，模型会返回全部引用网址的注释。

隐藏子属性

web_search tool call · object

  * 模型创建的对联网搜索的调用。

隐藏子属性

  * choices.message.annotations.logo_urlstring

logo网址。

  * choices.message.annotations.publish_timestring

发布时间。

  * choices.message.annotations.site_namestring

网站名称。

  * choices.message.annotations.summarystring

总结。

  * choices.message.annotations.titlestring

标题。

  * choices.message.annotations.typestring

类型。

  * choices.message.annotations.urlstring

网址。

  * choices.message.error_messagestring

联网搜索的错误信息。

  * choices.message.audioobject

如果请求输出音频，该对象将包含有关模型音频响应的数据。

隐藏子属性

  * choices.message.audio.idstring

此音频响应的唯一标识符。

  * choices.message.audio.datastring

模型生成的 Base64 编码音频，格式为请求中指定的格式。

  * choices.message.audio.expires_atnumber | null

此音频响应过期的 Unix 时间戳（以秒为单位）。当前仅为 `null`。

  * choices.message.audio.transcriptstring | null

模型生成的音频的文字记录。当前仅为 `null`。

  * choices.message.final_text_previewstring

经过智能优化润色后的音频播报最终文本。仅当请求参数 `optimize_text_preview` 设为 `true` 时，该字段才会返回。

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

模型为推理生成的 token 数量。

  * usage.prompt_tokens_detailsobject

提示中使用的 token 数量明细。

隐藏子属性

  * usage.prompt_tokens_details.cached_tokensinteger

命中缓存的 token 数量。

  * usage.prompt_tokens_details.audio_tokensinteger

提示中存在的音频输入 token 数量。

  * usage.prompt_tokens_details.image_tokensinteger

提示中存在的图像输入 token 数量。

  * usage.prompt_tokens_details.video_tokensinteger

提示中存在的视频输入 token 数量。

  * usage.web_search_usageobject

联网搜索 api 的调用量明细。

隐藏子属性

  * usage.web_search_usage.tool_usageinteger

联网搜索 api 的调用次数。

  * usage.web_search_usage.page_usageinteger

联网搜索 api 返回的网页数。

## Chat 响应 chunk 对象（流式输出）

  *   * choicesarray

包含生成的回复选项列表。

隐藏子属性

  * choices.deltaobject

流式模型响应生成的对话补全增量。

隐藏子属性

  * choices.delta.contentstring

数据块消息的内容。

  * choices.delta.reasoning_contentstring

助手消息中最终答案之前的推理内容。

  * choices.delta.rolestring

消息作者的角色。

  * choices.delta.tool_callsarray

函数调用启动后，模型会返回待调用的工具以及该调用所需的参数。此参数可包含一个或多个工具响应对象。

隐藏子属性

  * choices.delta.tool_calls.indexinteger

在 `tool_calls` 列表中被调用工具的索引，从 0 开始。

  * choices.delta.tool_calls.functionobject

调用的函数。

隐藏子属性

  * choices.delta.tool_calls.function.argumentsstring

模型生成的用于调用函数的参数，格式为 JSON。请注意，模型生成的内容并非并非总能保证是有效的 JSON，且可能会虚构出函数模式中未定义的参数。在调用函数之前，请在代码中对这些参数进行验证。

  * choices.delta.tool_calls.function.namestring

要调用的函数的名称。

  * choices.delta.tool_calls.idstring

工具调用的 ID。

  * choices.delta.tool_calls.typestring

工具的类型。目前仅支持 `function`。

  * choices.delta.annotationsarray

联网搜索后，模型会返回全部引用网址的注释。

隐藏子属性

web_search tool call · object

  * 模型创建的对联网搜索的调用。

隐藏子属性

  * choices.delta.annotations.logo_urlstring

logo网址。

  * choices.delta.annotations.publish_timestring

发布时间。

  * choices.delta.annotations.site_namestring

网站名称。

  * choices.delta.annotations.summarystring

总结。

  * choices.delta.annotations.titlestring

标题。

  * choices.delta.annotations.typestring

类型。

  * choices.delta.annotations.urlstring

网址。

  * choices.delta.error_messagestring

联网搜索链路的错误信息。

  * choices.delta.audioobject | null

如果请求输出音频，该对象将包含有关模型音频响应的数据。

隐藏子属性

  * choices.delta.audio.idstring

此音频响应的唯一标识符。

  * choices.delta.audio.datastring

模型生成的 Base64 编码音频，格式为请求中指定的格式。

  * choices.delta.audio.expires_atnumber | null

此音频响应过期的 Unix 时间戳（以秒为单位）。当前仅为 `null`。

  * choices.delta.audio.transcriptstring | null

模型生成的音频的文字记录。当前仅为 `null`。

  * choices.delta.final_text_previewstring

经过智能优化润色后的音频播报最终文本。仅当请求参数 `optimize_text_preview` 设为 `true` 时，该字段才会返回。

  * choices.finish_reasonstring | null

模型停止生成 token 的原因。如果模型到达自然停止点或提供的停止序列，则为 `stop`；如果达到请求中指定的最大 token 数，则为 `length`；如果模型调用了工具，则为 `tool_calls`。如果内容因触发过滤策略而被拦截，则为 `content_filter`；如果模型检测到了复读，则为 `repetition_truncation`。

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

模型为推理生成的 token 数量。

  * usage.prompt_tokens_detailsobject

提示中使用的 token 数量明细。

隐藏子属性

  * usage.prompt_tokens_details.cached_tokensinteger

命中缓存的 token 数量。

  * usage.prompt_tokens_details.audio_tokensinteger

提示中存在的音频输入 token 数量。

  * usage.prompt_tokens_details.image_tokensinteger

提示中存在的图像输入 token 数量。

  * usage.prompt_tokens_details.video_tokensinteger

提示中存在的视频输入 token 数量。

  * usage.web_search_usageobject

联网搜索 api 的调用量明细。

隐藏子属性

  * usage.web_search_usage.tool_usageinteger

联网搜索 api 的调用次数。

  * usage.web_search_usage.page_usageinteger

联网搜索 api 返回的网页数。

curlpython

基础调用

流式响应

函数调用

联网搜索

图像输入

音频输入

视频输入

语音合成

结构化输出

深度思考
    
    
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
        "presence_penalty": 0,
        "thinking": {
            "type": "disabled"
        }
    }'

响应

基础调用

流式响应

函数调用

联网搜索

图像输入

音频输入

视频输入

语音合成

结构化输出

深度思考
    
    
    {
        "id": "8b51f9e0515949cb8207fbd35ea6ea5c",
        "choices": [
            {
                "finish_reason": "stop",
                "index": 0,
                "message": {
                    "content": "Hello! I'm MiMo, Xiaomi's AI assistant created by the Xiaomi LLM-Core team. I'm here to chat, help answer questions, and assist with various tasks—whether it's providing information, brainstorming ideas, or just having a friendly conversation. Feel free to ask me anything, and I'll do my best to help! 😊",
                    "role": "assistant",
                    "tool_calls": null
                }
            }
        ],
        "created": 1776848906,
        "model": "mimo-v2.5-pro",
        "object": "chat.completion",
        "usage": {
            "completion_tokens": 72,
            "prompt_tokens": 57,
            "total_tokens": 129,
            "completion_tokens_details": {
                "reasoning_tokens": 0
            },
            "prompt_tokens_details": null
        }
    }

更新时间 2026 年 06 月 03 日

[错误码](</docs/zh-CN/api/guidance/error-codes>)[Anthropic API](</docs/zh-CN/api/chat/anthropic-api>)

curlpython

基础调用

流式响应

函数调用

联网搜索

图像输入

音频输入

视频输入

语音合成

结构化输出

深度思考
    
    
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
        "presence_penalty": 0,
        "thinking": {
            "type": "disabled"
        }
    }'

响应

基础调用

流式响应

函数调用

联网搜索

图像输入

音频输入

视频输入

语音合成

结构化输出

深度思考
    
    
    {
        "id": "8b51f9e0515949cb8207fbd35ea6ea5c",
        "choices": [
            {
                "finish_reason": "stop",
                "index": 0,
                "message": {
                    "content": "Hello! I'm MiMo, Xiaomi's AI assistant created by the Xiaomi LLM-Core team. I'm here to chat, help answer questions, and assist with various tasks—whether it's providing information, brainstorming ideas, or just having a friendly conversation. Feel free to ask me anything, and I'll do my best to help! 😊",
                    "role": "assistant",
                    "tool_calls": null
                }
            }
        ],
        "created": 1776848906,
        "model": "mimo-v2.5-pro",
        "object": "chat.completion",
        "usage": {
            "completion_tokens": 72,
            "prompt_tokens": 57,
            "total_tokens": 129,
            "completion_tokens_details": {
                "reasoning_tokens": 0
            },
            "prompt_tokens_details": null
        }
    }

回到顶部