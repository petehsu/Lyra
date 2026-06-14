# Console 提示工具

---

Claude Console 提供了一套工具，帮助您构建和优化提示。本页将按照您通常的使用顺序逐一介绍这些工具：生成初稿、添加模板和变量，然后改进现有提示。

---

## 提示生成器 \{#prompt-generator}

<Note>
提示生成器兼容所有 Claude 模型，包括具有扩展思考功能的模型。有关扩展思考模型的专属提示技巧，请参阅[扩展思考提示技巧](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices#leverage-thinking-and-interleaved-thinking-capabilities)。
</Note>

有时，使用 AI 模型最困难的部分是弄清楚如何有效地编写提示。提示生成器会引导 Claude 创建针对您特定任务量身定制的高质量提示模板，并遵循我们的许多提示工程最佳实践。

提示生成器对于解决"空白页问题"特别有用——它为您提供了一个起点，以便进行进一步的测试和迭代。

<Tip>立即在 [Console](/dashboard) 上直接试用提示生成器。</Tip>

如果您有兴趣分析底层提示和架构，请查看我们的[提示生成器 Google Colab 笔记本](https://anthropic.com/metaprompt-notebook/)。要运行 Colab 笔记本，您需要一个 [API 密钥](/settings/keys)。

---

## 提示模板和变量 \{#prompt-templates-and-variables}

在使用 Claude 部署基于 "large language model"（大型语言模型），即 LLM 的应用程序时，您的 API 调用通常由两种类型的内容组成：
- **固定内容：** 在多次交互中保持不变的静态指令或上下文
- **可变内容：** 随每次请求或对话而变化的动态元素，例如：
    - 用户输入
    - 用于 "Retrieval-Augmented Generation"（检索增强生成），即 RAG 的检索内容
    - 对话上下文，例如用户账户历史记录
    - 系统生成的数据，例如从对 Claude 的其他独立调用中传入的工具使用结果

**提示模板**将这些固定部分和可变部分组合在一起，使用占位符表示动态内容。在 [Claude Console](/) 中，这些占位符用 **\{\{双大括号\}\}** 表示，使其易于识别，并便于快速测试不同的值。

当您预计提示的任何部分会在对 Claude 的另一次调用中重复使用时（通过 API 或 [Claude Console](/)。[claude.ai](https://claude.ai/) 目前不支持提示模板或变量），您应该使用提示模板和变量。

提示模板具有以下几个优点：
- **一致性：** 确保您的提示在多次交互中保持一致的结构
- **效率：** 轻松替换可变内容，而无需重写整个提示
- **可测试性：** 通过仅更改可变部分，快速测试不同的输入和边缘情况
- **可扩展性：** 随着应用程序复杂性的增加，简化提示管理
- **版本控制：** 通过仅关注提示的核心部分（与动态输入分离），轻松跟踪提示结构随时间的变化

Console 使用提示模板和变量来支持其工具：
- **提示生成器：** 决定您的提示需要哪些变量，并将它们包含在输出的模板中
- **提示改进器：** 接收您现有的模板（包括所有变量），并在输出的改进模板中保留这些变量
- **[评估工具](/docs/zh-CN/test-and-evaluate/eval-tool)：** 通过分离提示模板的可变部分和固定部分，让您轻松测试、扩展和跟踪提示的各个版本

### 提示模板示例 \{#example-prompt-template}

假设有一个将英文文本翻译成西班牙语的简单应用程序。被翻译的文本是可变的，因为它会随用户或对 Claude 的调用而变化。您可以使用以下提示模板：

```text
Translate this text from English to Spanish: {{text}}
```

<Tip>要提升提示变量的效果，请将它们包裹在 [XML 标签](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices#structure-prompts-with-xml-tags)中，以获得更清晰的结构。</Tip>

---

## 提示改进器 \{#prompt-improver}

<Note>
提示改进器兼容所有 Claude 模型，包括具有扩展思考功能的模型。有关扩展思考模型的专属提示技巧，请参阅[扩展思考提示技巧](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices#leverage-thinking-and-interleaved-thinking-capabilities)。
</Note>

提示改进器通过自动化分析和增强，帮助您快速迭代和改进提示。它擅长使提示在需要高准确性的复杂任务中更加稳健。

<Frame>
  ![Image](/docs/images/prompt_improver.png)
</Frame>

### 开始之前 \{#before-you-begin}

您需要准备：
- 一个提示模板（请参阅上文的[提示模板和变量](#prompt-templates-and-variables)）
- 关于 Claude 当前输出问题的反馈（可选但推荐）
- 示例输入和理想输出（可选但推荐）

### 提示改进器的工作原理 \{#how-the-prompt-improver-works}

提示改进器通过 4 个步骤增强您的提示：

1. **示例识别**：定位并提取提示模板中的示例
2. **初稿创建**：创建具有清晰分区和 XML 标签的结构化模板
3. **思维链优化**：添加并优化详细的推理指令
4. **示例增强**：更新示例以演示新的推理过程

您可以在改进弹窗中实时观看这些步骤的执行过程。

### 您将获得什么 \{#what-you-get}

提示改进器生成的模板包含：
- 详细的 "chain-of-thought"（思维链）指令，引导 Claude 的推理过程，通常能提升其表现
- 使用 XML 标签分隔不同组件的清晰组织结构
- 标准化的示例格式，演示从输入到输出的逐步推理
- 引导 Claude 初始响应的策略性预填充内容

<Note>
虽然示例在 Workbench 界面中单独显示，但在实际的 API 调用中，它们会被包含在第一条用户消息的开头。点击"**\<\/\> Get Code**"查看原始格式，或通过 Examples 框以原始文本形式插入示例。
</Note>

### 如何使用提示改进器 \{#how-to-use-the-prompt-improver}

1. 提交您的提示模板
2. 添加关于 Claude 当前输出问题的任何反馈（例如，"摘要对于专业受众来说过于基础"）
3. 包含示例输入和理想输出
4. 查看改进后的提示

### 生成测试示例 \{#generate-test-examples}

还没有示例？使用[测试用例生成器](/docs/zh-CN/test-and-evaluate/eval-tool#creating-test-cases)来：
1. 生成示例输入
2. 获取 Claude 的响应
3. 编辑响应以匹配您的理想输出
4. 将完善后的示例添加到您的提示中

### 何时使用提示改进器 \{#when-to-use-the-prompt-improver}

提示改进器最适用于：
- 需要详细推理的复杂任务
- 准确性比速度更重要的场景
- Claude 当前输出需要显著改进的问题

<Note>
对于对 "latency"（延迟）或成本敏感的应用程序，请考虑使用更简单的提示。提示改进器创建的模板会生成更长、更详尽但响应更慢的输出。
</Note>

### 改进示例 \{#example-improvement}

以下是提示改进器如何增强一个基础分类提示的示例：

<section title="原始提示">

```text
From the following list of Wikipedia article titles, identify which article this sentence came from.
Respond with just the article title and nothing else.

Article titles:
{{titles}}

Sentence to classify:
{{sentence}}
```

</section>

<section title="改进后的提示">

```text
You are an intelligent text classification system specialized in matching sentences to Wikipedia article titles. Your task is to identify which Wikipedia article a given sentence most likely belongs to, based on a provided list of article titles.

First, review the following list of Wikipedia article titles:
<article_titles>
{{titles}}
</article_titles>

Now, consider this sentence that needs to be classified:
<sentence_to_classify>
{{sentence}}
</sentence_to_classify>

Your goal is to determine which article title from the provided list best matches the given sentence. Follow these steps:

1. List the key concepts from the sentence
2. Compare each key concept with the article titles
3. Rank the top 3 most relevant titles and explain why they are relevant
4. Select the most appropriate article title that best encompasses or relates to the sentence's content

Wrap your analysis in <analysis> tags. Include the following:
- List of key concepts from the sentence
- Comparison of each key concept with the article titles
- Ranking of top 3 most relevant titles with explanations
- Your final choice and reasoning

After your analysis, provide your final answer: the single most appropriate Wikipedia article title from the list.

Output only the chosen article title, without any additional text or explanation.
```

</section>

请注意改进后的提示如何：
- 添加清晰的逐步推理指令
- 使用 XML 标签组织内容
- 提供明确的输出格式要求
- 引导 Claude 完成分析过程

### 故障排除 \{#troubleshooting}

常见问题及解决方案：

- **示例未出现在输出中**：检查示例是否使用 XML 标签正确格式化，并出现在第一条用户消息的开头
- **思维链过于冗长**：添加关于期望输出长度和详细程度的具体指令
- **推理步骤不符合您的需求**：修改步骤部分以匹配您的特定用例

***

## 后续步骤 \{#next-steps}

<CardGroup cols={2}>
  <Card title="开始提示工程" icon="link" href="/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices">
    通过实际示例学习核心技术。
  </Card>
  <Card title="测试您的提示" icon="link" href="/docs/zh-CN/test-and-evaluate/eval-tool">
    使用评估工具测试您改进后的提示。
  </Card>
  <Card title="GitHub 提示教程" icon="link" href="https://github.com/anthropics/prompt-eng-interactive-tutorial">
    一个包含丰富示例的教程，涵盖我们文档中的提示工程概念。
  </Card>
</CardGroup>