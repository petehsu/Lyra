# 降低延迟

---

"Latency"（延迟）是指模型处理提示并生成输出所需的时间。延迟可能受到多种因素的影响，例如模型的大小、提示的复杂程度，以及支持模型和交互端点的底层基础设施。

<Note>
最好先设计一个在没有模型或提示约束的情况下也能良好运行的提示，然后再尝试降低延迟的策略。过早地尝试降低延迟可能会妨碍您发现最佳性能的表现。
</Note>

---

## 如何衡量延迟 \{#how-to-measure-latency}

在讨论延迟时，您可能会遇到以下几个术语和衡量指标：

- **基准延迟（Baseline latency）**：这是模型处理提示并生成响应所需的时间，不考虑每秒输入和输出的令牌数。它提供了对模型速度的总体了解。
- **首个令牌时间（Time to first token，即 TTFT）**：该指标衡量从发送提示到模型生成响应的第一个令牌所需的时间。当您使用流式传输（稍后会详细介绍）并希望为用户提供响应迅速的体验时，这一指标尤为重要。

如需更深入地了解这些术语，请查阅我们的[术语表](/docs/zh-CN/about-claude/glossary)。

---

## 如何降低延迟 \{#how-to-reduce-latency}

### 1. 选择合适的模型 \{#1-choose-the-right-model}

降低延迟最直接的方法之一是为您的用例选择合适的模型。Anthropic 提供了[一系列模型](/docs/zh-CN/about-claude/models/overview)，它们具有不同的能力和性能特征。请考虑您的具体需求，并在速度和输出质量方面选择最符合您需求的模型。

对于速度至关重要的应用，**Claude Haiku 4.5** 在保持高智能水平的同时提供最快的响应时间：

```python Python
import anthropic

client = anthropic.Anthropic()

# 对于时间敏感的应用，请使用 Claude Haiku 4.5
message = client.messages.create(
    model="claude-haiku-4-5",
    max_tokens=100,
    messages=[
        {
            "role": "user",
            "content": "Summarize this customer feedback in 2 sentences: [feedback text]",
        }
    ],
)
```

有关模型指标的更多详细信息，请参阅我们的[模型概览](/docs/zh-CN/about-claude/models/overview)页面。

### 2. 优化提示和输出长度 \{#2-optimize-prompt-and-output-length}

在保持高性能的同时，尽量减少输入提示和预期输出中的令牌数量。模型需要处理和生成的令牌越少，响应速度就越快。

以下是一些帮助您优化提示和输出的技巧：

- **清晰但简洁**：力求在提示中清晰简洁地传达您的意图。避免不必要的细节或冗余信息，同时请记住，[Claude 缺乏关于您用例的上下文](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices#be-clear-and-direct)，如果指令不清晰，它可能无法做出预期的逻辑推断。
- **要求更简短的响应**：直接要求 Claude 保持简洁。Claude 3 系列模型相比前几代具有更好的可控性。如果 Claude 输出的内容过长，可以要求 Claude [减少冗长的表达](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices#be-clear-and-direct)。
  <Tip> 由于 LLM 计算的是[令牌](/docs/zh-CN/about-claude/glossary#tokens)而非单词，因此要求精确的字数或字数限制不如要求段落数或句子数限制来得有效。</Tip>
- **设置适当的输出限制**：使用 `max_tokens` 参数为生成响应的最大长度设置硬性限制。这可以防止 Claude 生成过长的输出。
  > **注意**：当响应达到 `max_tokens` 令牌数时，响应将被截断，可能会在句子中间甚至单词中间中断，因此这是一种较为粗略的技术，可能需要后处理，通常最适用于答案出现在开头的多项选择或简短回答类响应。
- **尝试调整温度参数**：`temperature` [参数](/docs/zh-CN/api/messages/create)控制输出的随机性。较低的值（例如 0.2）有时会产生更聚焦、更简短的响应，而较高的值（例如 0.8）可能会产生更多样化但可能更长的输出。

在提示清晰度、输出质量和令牌数量之间找到适当的平衡可能需要一些实验。

### 3. 利用流式传输 \{#3-leverage-streaming}

"Streaming"（流式传输）是一项功能，允许模型在完整输出完成之前就开始返回其响应。这可以显著提高应用程序的感知响应速度，因为用户可以实时看到模型的输出。

启用流式传输后，您可以在模型输出到达时对其进行处理，同时更新用户界面或并行执行其他任务。这可以极大地提升用户体验，使您的应用程序感觉更具交互性和响应性。

请访问[流式传输 Messages](/docs/zh-CN/build-with-claude/streaming)，了解如何为您的用例实现流式传输。