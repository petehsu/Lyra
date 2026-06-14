# 模型超参

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

# 模型超参

`temperature` 表示采样温度。较高的值（如 0.8）会使输出更加随机，而较低的值（如 0.2）会使输出更具确定性。

`top_p` 表示核采样的概率阈值，用于控制模型生成文本的多样性。值越高，生成的文本多样性越高。

在思考模式下，`mimo-v2.5-pro`、`mimo-v2.5`、`mimo-v2-pro` 和 `mimo-v2-omni` 模型不支持自定义 `temperature` 和 `top_p` 参数。即使传入该参数，实际生效值也会被模型强制采用其推荐默认值 `1.0` 和 `0.95`。

不同模型的 `temperature` 和 `top_p` 的默认值和参数范围如下：

**模型名称** | **temperature** | **top_p**  
---|---|---  
`mimo-v2.5-pro`  
`mimo-v2-pro` | 

  * 默认值：1.0
  * 范围：[0, 1.5]

| 

  * 默认值：0.95
  * 范围：[0.01, 1.0]

  
`mimo-v2.5`  
`mimo-v2-omni` | 

  * 默认值：1.0
  * 范围：[0, 1.5]

| 

  * 默认值：0.95
  * 范围：[0.01, 1.0]

  
`mimo-v2.5-tts`  
`mimo-v2.5-tts-voicedesign`  
`mimo-v2.5-tts-voiceclone`  
`mimo-v2-tts` | 

  * 默认值：0.6
  * 范围：[0, 1.5]

| 

  * 默认值：0.95
  * 范围：[0.01, 1.0]

  
`mimo-v2-flash` | 

  * 默认值：0.3
  * 范围：[0, 1.5]

| 

  * 默认值：0.95
  * 范围：[0.01, 1.0]

  
  
我们建议您按任务类型设置参数值，可参考以下推荐值。

`mimo-v2-flash` 模型的推荐值如下：

**任务类型** | **temperature** | **top_p**  
---|---|---  
AI 编程 | 0.3 | 0.95  
工具调用 | 0.3 | 0.95  
通用问答 | 0.8 | 0.95  
创意写作 | 0.8 | 0.95  
前端网页开发 | 0.8 | 0.95  
数学推理 | 1 | 0.95  
  
`mimo-v2.5-pro`，`mimo-v2.5`，`mimo-v2-pro`，`mimo-v2-omni` 模型对于上述任务的 `temperature` 和 `top_p` 参数推荐值分别为 `1.0` 和 `0.95`。

更新时间 2026 年 06 月 03 日

[速率限制](</docs/zh-CN/api/guidance/rate-limit>)[错误码](</docs/zh-CN/api/guidance/error-codes>)