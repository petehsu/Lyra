# Anthropic API 兼容

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

# Anthropic API 兼容

## 请求地址
    
    
    https://api.xiaomimimo.com/anthropic/v1/messages
    

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

输入消息列表。  
每个消息必须包含 `role` 和 `content` 字段。您可以指定单个用户角色消息，或包含多个用户和助手消息。如果最后一条消息使用助手角色，响应内容将直接从该消息的内容继续，这可以用来约束模型的响应。

隐藏子属性

  * messages.rolestring必选

消息的角色。  
可选值：`user`，`assistant`

  * messages.contentstring | array必选

隐藏子属性

Text content · string

Array of content parts · array

  * 消息的文本内容。

  *   * modelstring必选

使用的模型名称。  
可选值：`mimo-v2.5-pro`，`mimo-v2.5`，`mimo-v2-pro`，`mimo-v2-omni`，`mimo-v2-flash`

  *   * max_tokensinteger

停止前生成的最大 token 数。  
请注意，我们的模型可能在达到此最大值之前就停止。此参数仅指定要生成的绝对最大 token 数。  

    * `mimo-v2-flash` 的默认值 `65536`
    * `mimo-v2.5-pro`，`mimo-v2-pro` 的默认值 `131072`
    * `mimo-v2.5`，`mimo-v2-omni` 的默认值为 `32768`
所需范围：`[1, 131072]`

  *   * stop_sequencesarray

使模型停止生成的自定义文本序列。  
我们的模型通常会在自然完成一轮对话后停止，这将导致响应的 `stop_reason` 为 `end_turn`。  
如果您希望模型在遇到自定义文本字符串时停止生成，可以使用 `stop_sequences` 参数。

  *   * streamboolean默认值: false

是否以流式输出方式回复。

  *   * systemstring | array

系统提示词是向模型提供上下文与指令的一种方式，例如为模型指定特定目标或角色。

隐藏子属性

Text content · string

Array of content parts · array

  * 系统提示词的内容。

  *   * temperaturenumber

采样温度，控制模型生成文本的多样性。  
`temperature` 越高，生成的文本更多样，反之，生成的文本更确定。  

> 在思考模式下，`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-pro` 和 `mimo-v2-omni` 模型不支持自定义 `temperature` 参数。即使传入该参数，实际生效值也会被模型强制采用其推荐默认值 `1.0`。

    * `mimo-v2-flash` 默认值为 `0.3`
    * `mimo-v2.5-pro`，`mimo-v2.5`，`mimo-v2-pro`，`mimo-v2-omni` 默认值为 `1.0`
所需范围：`[0, 1.5]`

  *   * thinkingobject

启用模型扩展思维的配置。  

> 注意：在思考模式下的多轮工具调用过程中，模型会在返回 `tool_use` 内容块的同时返回 `thinking` 内容块。若要继续对话，建议在后续每次请求的 `messages` 数组中保留所有历史 `thinking` 内容块，以获得最佳表现。

> 在思考模式下，`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-pro` 和 `mimo-v2-omni` 模型不支持自定义 `temperature` 和 `top_p` 参数。即使传入该参数，实际生效值也会被模型强制采用其推荐默认值 `1.0` 和 `0.95`。

隐藏子属性

  * thinking.typestring必选

    * `mimo-v2-flash` 默认值为 `disabled`
    * `mimo-v2.5-pro`，`mimo-v2.5`，`mimo-v2-pro`，`mimo-v2-omni` 默认值为 `enabled`
可选值：`enabled`，`disabled`

  *   * tool_choiceobject

控制模型如何使用提供的工具。

隐藏子属性

  * tool_choice.typestring必选

    * `auto` 意味着模型将自动决定是否使用工具。

> 注意：当 `type` 传入非 `auto` 值时，后端会默认移除该字段，模型响应行为仍等同于 `auto` 模式（该逻辑保留调整的可能性）。

可选值：`auto`

  * tool_choice.disable_parallel_tool_useboolean默认值: false

是否禁用并行工具使用。  
如果设置为 true：  

    * 当类型为 `auto` 时，模型将输出至多一个工具使用。

  *   * toolsarray

模型可能会使用的工具的定义。  
如果在 API 请求中包含工具，则模型可能会返回 `tool_use` 内容块，表示模型对这些工具的使用。您可以使用模型生成的工具输入运行这些工具，然后选择性地返回结果给模型，使用 `tool_result` 内容块。  

> 注意：在思考模式下的多轮工具调用过程中，模型会在返回 `tool_use` 内容块的同时返回 `thinking` 内容块。若要继续对话，建议在后续每次请求的 `messages` 数组中保留所有历史 `thinking` 内容块，以获得最佳表现。

工具定义包括：  

    * `name`：工具的名称。
    * `description`：可选，但强烈推荐填写工具描述。
    * `input_schema`：工具输入形状的 JSON 模式，模型将在 ` tool_use ` 输出内容块中生成。

隐藏子属性

  * tools.namestring必选

工具名称。  
模型将通过它调用该工具，并是在 `tool_use` 块中使用的名称。

  * tools.descriptionstring

工具的描述。  
工具描述应尽可能详细。模型关于工具是什么以及如何使用的信息越多，执行表现就越好。您可以使用自然语言描述来强化工具输入 JSON 模式中的重要信息。

  * tools.typestring

可选值：`custom`

  * tools.input_schemaobject必选

工具输入形状的 JSON 模式，模型将在 `tool_use` 输出内容块中生成。

隐藏子属性

  * tools.input_schema.typestring必选

`input_schema` 的类型，仅为 `object`。  
可选值：`object`

  * tools.input_schema.propertiesobject | null

工具输入的属性。

  * tools.input_schema.requiredarray | null

工具输入中必须包含的属性列表。

  *   * top_pnumber默认值: 0.95

启用核采样。  
在核采样机制中，我们会按概率从高到低的顺序，为生成每个后续 token 的所有候选结果计算累积概率分布，当累积概率达到 `top_p` 参数指定的阈值时，便会截断后续候选。请注意，你应仅调整 `temperature` 或 `top_p` 二者其一，不可同时修改。  
此采样方式仅建议用于高级使用场景。通常情况下，你只需调整 `temperature` 参数即可满足需求。  

> 在思考模式下，`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-pro` 和 `mimo-v2-omni` 模型不支持自定义 `top_p` 参数。即使传入该参数，实际生效值也会被模型强制采用其推荐默认值 `0.95`。

所需范围：`[0.01, 1.0]`

## 非流式响应

  *   * idstring

该对话的唯一标识符。ID 的格式和长度可能会随时间而变化。

  *   * typestring

对象类型，对于 Messages 始终为 `message`。

  *   * rolestring

生成消息的会话角色，始终为 `assistant`。

  *   * contentarray

模型生成的内容，由多个内容块组成。每个内容块都有一个 type。

隐藏子属性

Text · object

Thinking · object

Tool use · object

  * 隐藏子属性

  * content.textstring

文本内容。

  * content.typestring

内容的类型。  
可选值：`text`

  *   * modelstring

使用的模型名称。

  *   * stop_reasonstring

消息完成的原因。  
其取值可能为以下之一：  

    * `end_turn`：模型达到自然停止点。
    * `max_tokens`：超过请求的 `max_tokens` 或模型的最大限制。
    * `tool_use`：模型调用了一个或多个工具。
    * `content_filter`：内容因触发过滤策略而被拦截。
    * `repetition_truncation`：模型检测到了复读。
可选值：`end_turn`，`max_tokens`，`tool_use`，`content_filter`，`repetition_truncation`

  *   * usageobject

计费和限流相关的使用量统计。

隐藏子属性

  * usage.input_tokensinteger

使用的输入 token 数量。

  * usage.output_tokensinteger

使用的输出 token 数量。

  * usage.cache_read_input_tokensinteger | null

从缓存读取的输入 token 数量。

## 流式响应

  *   * SSE.eventstring

描述的事件类型标识的字符串。  
可选值：`message_start`，`content_block_start`，` content_block_delta`，`content_block_stop`，`message_delta`，`message_stop`

  *   * typestring

每个服务器发送的事件包括一个命名事件类型和关联的 JSON 数据。  
可选值：`message_start`，`content_block_start`，` content_block_delta`，`content_block_stop`，`message_delta`，`message_stop`

  *   * messageobject

响应消息。

隐藏子属性

  * message.idstring

消息 ID。

  * message.typestring

可选值：`message`

  * message.rolestring

可选值：`assistant`

  * message.modelstring

模型名称。

  * message.contentarray

消息中的内容块数组。

  * message.stop_reasonstring | null

消息完成的原因。

  *   * indexinteger

内容块在消息中的位置。

  *   * content_blockobject

开始的内容块。

隐藏子属性

Text · object

Thinking · object

Tool use · object

  * 隐藏子属性

  * content_block.typestring

文本内容块的头部；实际文本通过后续 delta 事件到达。  
可选值：`text`

  * content_block.textstring

开头通常为空字符串；文本通过 `text_delta` 类型的 `content_block_delta` 事件附加。

  *   * deltaobject

实际响应内容。

隐藏子属性

Content block delta · object

Message delta · object

  * 内容块的增量数据。

隐藏子属性

  * delta.typestring

可选值：`text_delta`，`thinking_delta`，`input_json_delta`

  * delta.textstring

增量数据的文本部分。

  * delta.thinkingstring

增量数据的思考部分。

  * delta.partial_jsonstring

JSON 片段字符串。按到达顺序连接片段以形成完整的输入 JSON，然后解析。

  *   * usageobject | null

计费和限流相关的使用量统计。

隐藏子属性

  * usage.input_tokensinteger

使用的输入 token 数量。

  * usage.output_tokensinteger

使用的输出 token 数量。

  * usage.cache_read_input_tokensinteger | null

从缓存读取的输入 token 数量。

curlpython

基础调用

流式响应

函数调用

图像输入

深度思考
    
    
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
        "stop_sequences": null,
        "thinking": {
            "type": "disabled"
        }
    }'

响应

基础调用

流式响应

函数调用

图像输入

深度思考
    
    
    {
        "id": "b966dbcad38c48b59d16d8c1f313681b",
        "type": "message",
        "role": "assistant",
        "model": "mimo-v2.5-pro",
        "stop_reason": "end_turn",
        "content": [
            {
                "type": "text",
                "text": "Hello! I'm MiMo, an AI assistant developed by Xiaomi. I'm here to help answer your questions, provide information, or assist with various tasks. My knowledge is up to date until December 2024. How can I help you today?"
            }
        ],
        "usage": {
            "input_tokens": 57,
            "output_tokens": 54
        }
    }

更新时间 2026 年 06 月 03 日

[OpenAI API](</docs/zh-CN/api/chat/openai-api>)[语音识别（MiMo‑V2.5-ASR）- OpenAI API 兼容](</docs/zh-CN/api/audio/Speech-Recognition>)

curlpython

基础调用

流式响应

函数调用

图像输入

深度思考
    
    
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
        "stop_sequences": null,
        "thinking": {
            "type": "disabled"
        }
    }'

响应

基础调用

流式响应

函数调用

图像输入

深度思考
    
    
    {
        "id": "b966dbcad38c48b59d16d8c1f313681b",
        "type": "message",
        "role": "assistant",
        "model": "mimo-v2.5-pro",
        "stop_reason": "end_turn",
        "content": [
            {
                "type": "text",
                "text": "Hello! I'm MiMo, an AI assistant developed by Xiaomi. I'm here to help answer your questions, provide information, or assist with various tasks. My knowledge is up to date until December 2024. How can I help you today?"
            }
        ],
        "usage": {
            "input_tokens": 57,
            "output_tokens": 54
        }
    }

回到顶部