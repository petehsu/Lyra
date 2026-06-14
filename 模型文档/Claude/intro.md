# Claude 简介

Claude 是由 Anthropic 打造的高性能、值得信赖且智能的 AI 平台。Claude 擅长处理涉及语言、推理、分析、编程等方面的任务。

---

<Tip>

最新一代的 Claude 模型：

**Claude Fable 5** - Anthropic 广泛发布的最强大模型，适用于要求最高的推理任务和长周期智能体工作。阅读 [Claude Fable 5 发布公告](https://www.anthropic.com/news/claude-fable-5)。

**Claude Mythos 5** - 具备与 Claude Fable 5 相同的能力，但不包含安全分类器。通过 [Project Glasswing](https://anthropic.com/glasswing) 限量发布。

**Claude Opus 4.8** - Anthropic 最强大的 Opus 级别模型，适用于复杂推理和智能体编程。阅读 [Claude Opus 4.8 发布公告](https://www.anthropic.com/news/claude-opus-4-8)。

**Claude Sonnet 4.6** - 可大规模部署的前沿智能，专为编程、智能体和企业工作流而构建。阅读 [Claude Sonnet 4.6 发布公告](https://www.anthropic.com/news/claude-sonnet-4-6)。

**Claude Haiku 4.5** - 速度最快的模型，具备接近前沿水平的智能。阅读 [Claude Haiku 4.5 发布公告](https://www.anthropic.com/news/claude-haiku-4-5)。

</Tip>

<Note>
想与 Claude 聊天？请访问 [claude.ai](https://claude.ai)。
</Note>

Anthropic 提供两种使用 Claude 进行构建的方式，每种方式适用于不同的使用场景：

| | Messages API | Claude Managed Agents |
|---|---|---|
| **是什么** | 直接访问模型提示功能 | 预构建、可配置的智能体框架，运行在托管基础设施上 |
| **最适合** | 自定义智能体循环和细粒度控制 | 长时间运行的任务和异步工作 |
| **了解更多** | [Messages API 文档](/docs/zh-CN/build-with-claude/working-with-messages) | [Claude Managed Agents 文档](/docs/zh-CN/managed-agents/overview) |

## 新开发者推荐路径 \{#recommended-path-for-new-developers}

按照以下步骤，从零开始构建一个可用的 Claude 集成。

<Steps>
  <Step title="发起您的第一次 API 调用">
    设置您的环境，安装 SDK，并向 Claude 发送您的第一条消息。

    [前往快速入门](/docs/zh-CN/get-started)
  </Step>
  <Step title="了解 Messages API">
    学习核心的请求和响应结构，包括多轮对话、系统提示和停止原因。

    [阅读 Messages API 指南](/docs/zh-CN/build-with-claude/working-with-messages)
  </Step>
  <Step title="选择合适的模型">
    按能力和成本比较 Claude 模型，为您的用例选择最合适的模型。

    [查看模型概览](/docs/zh-CN/about-claude/models/overview)
  </Step>
  <Step title="探索功能和工具">
    了解 Claude 的能力：扩展思考、网络搜索、文件处理、结构化输出等。

    [浏览功能概览](/docs/zh-CN/build-with-claude/overview)
  </Step>
</Steps>

---

## 使用 Claude 进行开发 \{#develop-with-claude}

Anthropic 提供开发者工具，帮助您使用 Claude 构建和扩展应用程序。

<CardGroup cols={3}>
  <Card title="开发者控制台" icon="computer" href="/">
    使用 Workbench 和提示生成器在浏览器中对提示进行原型设计和测试。
  </Card>
  <Card title="API 参考" icon="code" href="/docs/zh-CN/api/overview">
    浏览完整的 Claude API 和客户端 SDK 文档。
  </Card>
  <Card title="Claude Cookbook" icon="chef-hat" href="https://platform.claude.com/cookbooks">
    通过涵盖 PDF、嵌入等内容的交互式 Jupyter 笔记本进行学习。
  </Card>
</CardGroup>

---

## 核心能力 \{#key-capabilities}

Claude 可以协助处理许多涉及文本、代码和图像的任务。

<CardGroup cols={2}>
  <Card title="文本和代码生成" icon="text-aa" href="/docs/zh-CN/build-with-claude/overview">
    总结文本、回答问题、提取数据、翻译文本，以及解释和生成代码。
  </Card>
  <Card title="视觉" icon="image" href="/docs/zh-CN/build-with-claude/vision">
    处理和分析视觉输入，并从图像生成文本和代码。
  </Card>
</CardGroup>

---

## 支持 \{#support}

<CardGroup cols={2}>
  <Card title="帮助中心" icon="help" href="https://support.claude.com/en/">
    查找有关账户和账单常见问题的解答。
  </Card>

  <Card title="服务状态" icon="chart" href="https://status.claude.com">
    查看 Anthropic 服务的状态。
  </Card>
</CardGroup>