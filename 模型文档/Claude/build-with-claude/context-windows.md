# 上下文窗口

---

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

随着对话的增长，您最终会接近上下文窗口的限制。本指南解释了上下文窗口的工作原理，并介绍了有效管理上下文窗口的策略。

对于长时间运行的对话和智能体工作流，[服务器端压缩](/docs/zh-CN/build-with-claude/compaction)是上下文管理的主要策略。对于更专业的需求，[上下文编辑](/docs/zh-CN/build-with-claude/context-editing)提供了额外的策略，如工具结果清除和思考块清除。

## 理解上下文窗口 \{#understanding-the-context-window}

"Context window"（上下文窗口）是指语言模型在生成响应时可以参考的所有文本，包括响应本身。这与语言模型训练所用的大型数据语料库不同，而是代表模型的"工作记忆"。较大的上下文窗口允许模型处理更复杂和冗长的提示，但更多的上下文并不自动意味着更好。随着令牌数量的增长，准确性和召回率会下降，这种现象被称为*上下文腐化（context rot）*。这使得精心管理上下文中的内容与可用空间的大小同样重要。

Claude 在长上下文检索基准测试（如 [MRCR](https://arxiv.org/abs/2501.03276) 和 [GraphWalks](https://arxiv.org/abs/2412.04360)）上取得了最先进的结果，但这些成果取决于上下文中包含什么内容，而不仅仅是能容纳多少内容。

<Tip>
如需深入了解长上下文为何会退化以及如何围绕这一问题进行工程设计，请参阅[有效的上下文工程](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)。
</Tip>

下图展示了 API 请求的标准上下文窗口行为<sup>1</sup>：

![上下文窗口示意图](/docs/images/context-window.svg)

_<sup>1</sup>对于聊天界面（例如 [claude.ai](https://claude.ai/)），上下文窗口也可以设置为滚动的"先进先出"系统。_

* **渐进式令牌累积：** 随着对话轮次的推进，每条用户消息和助手响应都会在上下文窗口中累积。之前的轮次会被完整保留。
* **线性增长模式：** 上下文使用量随每个轮次线性增长，之前的轮次会被完整保留。
* **上下文窗口容量：** 总可用上下文窗口（最多 100 万个令牌）代表存储对话历史和生成 Claude 新输出的最大容量。
* **输入-输出流程：** 每个轮次包括：
  - **输入阶段：** 包含所有先前的对话历史以及当前的用户消息
  - **输出阶段：** 生成文本响应，该响应将成为未来输入的一部分

## 使用扩展思考时的上下文窗口 \{#the-context-window-with-extended-thinking}

使用[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)时，所有输入和输出令牌（包括用于思考的令牌）都会计入上下文窗口限制，但在多轮对话场景中存在一些细微差别。

思考预算令牌是 `max_tokens` 参数的子集，按输出令牌计费，并计入速率限制。使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)时，Claude 会动态决定其思考分配，因此每个请求的实际思考令牌使用量可能有所不同。

然而，之前的思考块会被 Claude API 自动从上下文窗口计算中剥离，不会成为模型在后续轮次中"看到"的对话历史的一部分，从而为实际对话内容保留令牌容量。

下图展示了启用扩展思考时的专门令牌管理：

![使用扩展思考的上下文窗口示意图](/docs/images/context-window-thinking.svg)

* **剥离扩展思考：** 扩展思考块（以深灰色显示）在每个轮次的输出阶段生成，**但不会作为输入令牌带入后续轮次**。您无需自行剥离思考块。如果您将它们传回，Claude API 会自动为您完成此操作。
* **技术实现细节：**
  - 当您将之前轮次的思考块作为对话历史的一部分传回时，API 会自动排除这些思考块。
  - 扩展思考令牌仅在生成时作为输出令牌计费一次。
  - 有效上下文窗口计算变为：`context_window = (input_tokens - previous_thinking_tokens) + current_turn_tokens`。
  - 思考令牌包括 `thinking` 块。

这种架构具有令牌效率，允许进行大量推理而不浪费令牌，因为思考块的长度可能相当可观。

<Note>
您可以在[扩展思考指南](/docs/zh-CN/build-with-claude/extended-thinking)中阅读有关上下文窗口和扩展思考的更多信息。
</Note>

## 结合扩展思考和工具使用时的上下文窗口 \{#the-context-window-with-extended-thinking-and-tool-use}

下图展示了结合扩展思考与工具使用时的上下文窗口令牌管理：

![使用扩展思考和工具使用的上下文窗口示意图](/docs/images/context-window-thinking-tools.svg)

<Steps>
  <Step title="第一轮架构">
    - **输入组件：** 工具配置和用户消息
    - **输出组件：** 扩展思考 + 文本响应 + 工具使用请求
    - **令牌计算：** 所有输入和输出组件都计入上下文窗口，所有输出组件都按输出令牌计费。
  </Step>
  <Step title="工具结果处理（第 2 轮）">
    - **输入组件：** 第一轮中的每个块以及 `tool_result`。扩展思考块**必须**与相应的工具结果一起返回。这是您**必须**返回思考块的唯一情况。
    - **输出组件：** 在工具结果传回给 Claude 后，Claude 仅以文本响应（在下一条 `user` 消息之前不会有额外的扩展思考，除非启用了[交错思考](/docs/zh-CN/build-with-claude/extended-thinking#interleaved-thinking)）。
    - **令牌计算：** 所有输入和输出组件都计入上下文窗口，所有输出组件都按输出令牌计费。
  </Step>
  <Step title="新的用户轮次（第 3 轮）">
    - **输入组件：** 上一轮的所有输入和输出都会被带入，但思考块除外，因为 Claude 已完成整个工具使用周期，此时可以丢弃思考块。如果您将思考块传回，API 会自动为您剥离，或者您也可以在此阶段自行剥离。这也是您添加下一个 `user` 轮次的位置。
    - **输出组件：** 由于在工具使用周期之外有新的 `user` 轮次，Claude 会生成新的扩展思考块并从那里继续。
    - **令牌计算：** 之前的思考令牌会自动从上下文窗口计算中剥离。所有其他先前的块仍计入令牌窗口，当前 `assistant` 轮次中的思考块也计入上下文窗口。
  </Step>
</Steps>

* **工具使用与扩展思考的注意事项：**
  - 发布工具结果时，必须包含伴随该特定工具请求的完整未修改的思考块（包括签名部分）。
  - 扩展思考与工具使用的有效上下文窗口计算变为：`context_window = input_tokens + current_turn_tokens`。
  - 系统使用加密签名来验证思考块的真实性。在工具使用期间未能保留思考块可能会破坏 Claude 的推理连续性。因此，如果您修改思考块，API 会返回错误。

<Note>
Claude 4 模型支持[交错思考](/docs/zh-CN/build-with-claude/extended-thinking#interleaved-thinking)，这使 Claude 能够在工具调用之间进行思考，并在收到工具结果后进行更复杂的推理。

有关将工具与扩展思考结合使用的更多信息，请参阅[扩展思考指南](/docs/zh-CN/build-with-claude/extended-thinking#extended-thinking-with-tool-use)。
</Note>

Claude 的工具选择设计为在处理大型输入文档时依然稳定——当对话包含超过 10 万个非工具上下文令牌时，仍能选择正确的工具（或正确地放弃使用工具）。如需减少工具本身消耗的上下文，请参阅[管理工具上下文](/docs/zh-CN/agents-and-tools/tool-use/manage-tool-context)，或使用[工具搜索工具](/docs/zh-CN/agents-and-tools/tool-use/tool-search-tool)延迟加载工具定义。

Claude Opus 4.8、[Claude Mythos Preview](https://anthropic.com/glasswing)、Claude Opus 4.7、Claude Opus 4.6 和 Claude Sonnet 4.6 在 Claude API、Amazon Bedrock 和 Vertex AI 上拥有 100 万令牌的上下文窗口。在 Microsoft Foundry 上，Claude Opus 4.8 拥有 20 万令牌的上下文窗口。其他 Claude 模型，包括 Claude Sonnet 4.5 和 Sonnet 4（已弃用），拥有 20 万令牌的上下文窗口。

Claude Fable 5 和 Claude Mythos 5（`claude-fable-5` 和 `claude-mythos-5`）在 Claude API 上拥有 100 万令牌的上下文窗口。100 万的最大值也是默认值，单个请求最多可生成 12.8 万个输出令牌（`max_tokens`）。

单个请求最多可包含 600 张图片或 PDF 页面（对于拥有 20 万令牌上下文窗口的模型，上限为 100）。当发送大量图片或大型文档时，您可能会在达到令牌限制之前先接近[请求大小限制](/docs/zh-CN/api/overview#request-size-limits)。

## Claude Sonnet 4.6、Sonnet 4.5 和 Haiku 4.5 中的上下文感知 \{#context-awareness-in-claude-sonnet-4-6-sonnet-4-5-and-haiku-4-5}

Claude Sonnet 4.6、Claude Sonnet 4.5 和 Claude Haiku 4.5 具备**上下文感知**功能。此功能使这些模型能够在整个对话过程中跟踪其剩余的上下文窗口（即"令牌预算"）。这使 Claude 能够通过了解自己有多少可用空间来更有效地执行任务和管理上下文。Claude 经过训练能够精确使用这些上下文，坚持执行任务直到最后，而不是猜测还剩多少令牌。对于模型来说，缺乏上下文感知就像在没有时钟的情况下参加烹饪比赛。上下文感知模型通过明确接收有关剩余上下文的信息改变了这一点，从而能够最大限度地利用可用令牌。

**工作原理：**

在对话开始时，Claude 会收到有关其总上下文窗口的信息：

```xml
<budget:token_budget>1000000</budget:token_budget>
```

预算设置为 100 万个令牌（对于上下文窗口较小的模型为 20 万个）。

每次工具调用后，Claude 会收到有关剩余容量的更新：

```xml
<system_warning>Token usage: 35000/1000000; 965000 remaining</system_warning>
```

这种感知能力帮助 Claude 确定还有多少容量可用于工作，并能够更有效地执行长时间运行的任务。图片令牌也包含在这些预算中。

**优势：**

上下文感知对以下场景特别有价值：
- 需要持续专注的长时间运行的智能体会话
- 状态转换很重要的多上下文窗口工作流
- 需要精细令牌管理的复杂任务

<Tip>
对于跨多个会话的智能体，请设计您的状态工件，以便在新会话开始时能够快速恢复上下文。[内存工具的多会话模式](/docs/zh-CN/agents-and-tools/tool-use/memory-tool#multi-session-software-development-pattern)详细介绍了一种具体方法。另请参阅[长时间运行智能体的有效框架](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)。
</Tip>

有关利用上下文感知的提示指导，请参阅[提示最佳实践指南](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices#context-awareness-and-multi-window-workflows)。

## 使用压缩管理上下文 \{#managing-context-with-compaction}

如果您的对话经常接近上下文窗口限制，[服务器端压缩](/docs/zh-CN/build-with-claude/compaction)是推荐的方法。压缩提供服务器端摘要功能，自动压缩对话的早期部分，使长时间运行的对话能够超越上下文限制，且集成工作量极小。该功能在 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8、Claude Mythos Preview、Claude Opus 4.7、Claude Opus 4.6 和 Claude Sonnet 4.6 上以测试版形式提供。

对于更专业的需求，[上下文编辑](/docs/zh-CN/build-with-claude/context-editing)提供了额外的策略：
- **工具结果清除** - 在智能体工作流中清除旧的工具结果
- **思考块清除** - 使用扩展思考时管理思考块

## 上下文窗口溢出行为 \{#context-window-overflow-behavior}

在 Claude 4.5 及更新的模型上，如果输入令牌加上 `max_tokens` 超过上下文窗口大小，API 会接受该请求。如果生成过程随后达到上下文窗口限制，则会以 `stop_reason: "model_context_window_exceeded"` 停止。在早期模型上，API 会返回验证错误；可通过 `model-context-window-exceeded-2025-08-26` 测试版标头选择启用 `model_context_window_exceeded` 行为。详情请参阅[处理停止原因](/docs/zh-CN/build-with-claude/handling-stop-reasons)。

为了保持在上下文窗口限制内，请在向 Claude 发送消息之前使用[令牌计数 API](/docs/zh-CN/build-with-claude/token-counting) 来估算令牌使用量。

请参阅[模型比较](/docs/zh-CN/about-claude/models/overview#latest-models-comparison)表，了解各模型的上下文窗口大小列表。

## 后续步骤 \{#next-steps}
<CardGroup cols={2}>
  <Card title="压缩" icon="compress" href="/docs/zh-CN/build-with-claude/compaction">
    管理长时间运行对话中上下文的推荐策略。
  </Card>
  <Card title="上下文编辑" icon="pen" href="/docs/zh-CN/build-with-claude/context-editing">
    工具结果清除和思考块清除等细粒度策略。
  </Card>
  <Card title="模型比较表" icon="scales" href="/docs/zh-CN/about-claude/models/overview#latest-models-comparison">
    查看模型比较表，了解各模型的上下文窗口大小以及输入/输出令牌定价。
  </Card>
  <Card title="扩展思考概述" icon="settings" href="/docs/zh-CN/build-with-claude/extended-thinking">
    详细了解扩展思考的工作原理，以及如何将其与工具使用和提示缓存等其他功能一起实现。
  </Card>
</CardGroup>