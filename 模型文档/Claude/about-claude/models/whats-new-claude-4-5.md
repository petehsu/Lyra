# 模型概述

Claude 是由 Anthropic 开发的一系列先进的大型语言模型。本指南介绍可用的模型并比较它们的性能。

---

## 选择模型 \{#choosing-a-model}

如果您不确定使用哪个模型，建议从 **Claude Opus 4.8** 开始处理最复杂的任务。它是 Anthropic 在 Opus 层级中能力最强的模型，适用于复杂推理、长周期智能体编码和高自主性工作。对于需要最高可用能力的工作负载，请参阅 [Claude Fable 5](#claude-fable-5-and-claude-mythos-5)。

所有当前的 Claude 模型均支持文本和图像输入、文本输出、多语言能力以及视觉功能。这些模型可通过 Claude API、[Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws)、[Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)、[Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 使用。

选定模型后，请[了解如何进行首次 API 调用](/docs/zh-CN/get-started)。

### Claude Fable 5 和 Claude Mythos 5 \{#claude-fable-5-and-claude-mythos-5}

Claude Fable 5（`claude-fable-5`）是 Anthropic 能力最强的广泛发布模型。Claude Mythos 5（`claude-mythos-5`）与仅限邀请的 Claude Mythos Preview（`claude-mythos-preview`）一同归属于 [Project Glasswing](https://anthropic.com/glasswing)。有关发布详情和 API 变更，请参阅 [Claude Fable 5 和 Claude Mythos 5 介绍](/docs/zh-CN/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5)。

| 特性 | Claude Fable 5 | Claude Mythos 5 |
|:--------|:-------------|:-------------|
| **描述** | Anthropic 能力最强的广泛发布模型，适用于要求最高的推理和长周期智能体工作 | 通过 Project Glasswing 提供。Claude Mythos Preview 的继任者。 |
| **Claude API ID** | `claude-fable-5` | `claude-mythos-5` |
| **AWS Bedrock ID** | anthropic.claude-fable-5 | 有限可用 |
| **Vertex AI ID** | claude-fable-5 | 有限可用 |
| **[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)** | 否 | 否 |
| **[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)** | 是（始终开启） | 是（始终开启） |
| **上下文窗口** | <Tooltip tooltipContent="Claude Fable 5 和 Claude Mythos 5 使用随 Claude Opus 4.7 引入的分词器。与 Claude Opus 4.7 之前的模型相比，相同文本产生的令牌数量大约多 30%。">100 万令牌</Tooltip> | <Tooltip tooltipContent="Claude Fable 5 和 Claude Mythos 5 使用随 Claude Opus 4.7 引入的分词器。与 Claude Opus 4.7 之前的模型相比，相同文本产生的令牌数量大约多 30%。">100 万令牌</Tooltip> |
| **最大输出** | 12.8 万令牌 | 12.8 万令牌 |
| **定价** | 每百万令牌 \$10 / \$50（输入 / 输出） | 每百万令牌 \$10 / \$50（输入 / 输出） |

Claude Fable 5 自 2026 年 6 月 9 日起在 Claude API、Claude Platform on AWS、Amazon Bedrock、Vertex AI 和 Microsoft Foundry 上正式可用。Claude Mythos 5 并非正式可用：它自同一天起以有限可用的方式提供给 [Project Glasswing](https://anthropic.com/glasswing) 中已获批准的客户。如需访问权限，请联系您的 Anthropic、AWS 或 Google Cloud 客户团队。

### 最新模型对比 \{#latest-models-comparison}

| 特性 | Claude Opus 4.8 | Claude Sonnet 4.6 | Claude Haiku 4.5 |
|:--------|:-------------|:------------------|:-----------------|
| **描述** | Anthropic 在 Opus 层级中能力最强的模型，适用于复杂推理和智能体编码 | 速度与智能的最佳组合 | 具有接近前沿智能水平的最快模型 |
| **Claude API ID** | claude-opus-4-8 | claude-sonnet-4-6 | claude-haiku-4-5-20251001 |
| **Claude API 别名** | claude-opus-4-8 | claude-sonnet-4-6 | claude-haiku-4-5 |
| **AWS Bedrock ID** | anthropic.claude-opus-4-8<sup>3</sup> | anthropic.claude-sonnet-4-6 | anthropic.claude-haiku-4-5-20251001-v1:0 |
| **Vertex AI ID** | claude-opus-4-8 | claude-sonnet-4-6 | claude-haiku-4-5@20251001 |
| **定价**<sup>1</sup> | \$5 / 输入百万令牌<br/>\$25 / 输出百万令牌 | \$3 / 输入百万令牌<br/>\$15 / 输出百万令牌 | \$1 / 输入百万令牌<br/>\$5 / 输出百万令牌 |
| **[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)** | 否 | 是 | 是 |
| **[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)** | 是 | 是 | 否 |
| **[优先层级](/docs/zh-CN/api/service-tiers)** | 是 | 是 | 是 |
| **相对延迟** | 中等 | 快 | 最快 |
| **上下文窗口** | <Tooltip tooltipContent="约 55.5 万词 \ 约 250 万 Unicode 字符">100 万令牌</Tooltip><sup>4</sup> | <Tooltip tooltipContent="约 75 万词 \ 约 340 万 Unicode 字符">100 万令牌</Tooltip> | <Tooltip tooltipContent="约 15 万词 \ 约 68 万 Unicode 字符">20 万令牌</Tooltip> |
| **最大输出** | 12.8 万令牌 | 6.4 万令牌 | 6.4 万令牌 |
| **可靠知识截止日期** | 2026 年 1 月<sup>2</sup> | 2025 年 8 月<sup>2</sup> | 2025 年 2 月 |
| **训练数据截止日期** | 2026 年 1 月 | 2026 年 1 月 | 2025 年 7 月 |

_<sup>1 - 有关完整定价信息（包括 Batch API 折扣和提示缓存费率），请参阅[定价](/docs/zh-CN/about-claude/pricing)。</sup>_

_<sup>2 - **可靠知识截止日期**表示模型知识最全面、最可靠的截止日期。**训练数据截止日期**是所用训练数据的更广泛日期范围。更多信息请参阅 [Anthropic 透明度中心](https://www.anthropic.com/transparency)。</sup>_

_<sup>3 - Claude Opus 4.8 可通过 [Claude in Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)（Messages-API Bedrock 端点）在 Bedrock 上使用。</sup>_

_<sup>4 - 在 Microsoft Foundry 上，Claude Opus 4.8 的上下文窗口为 20 万令牌。请参阅 [Claude in Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)。</sup>_

<Info>
[Claude Mythos Preview](https://anthropic.com/glasswing) 作为 [Project Glasswing](https://anthropic.com/glasswing) 的一部分，以研究预览模型的形式单独提供，用于防御性网络安全工作流。访问仅限邀请，不提供自助注册。
</Info>

<Note>每个 Claude 模型 ID 都是一个固定快照。ID 中包含日期的模型（例如 `20250929`）固定为该特定版本。从 Claude 4.6 代开始，模型 ID 采用无日期格式，这同样是固定快照，而非持续更新的指针。对于 4.6 代之前的模型，Claude API 别名列中的条目是便捷指针，会解析为带日期的模型 ID。有关命名约定和版本控制工作原理的详细信息，请参阅[模型 ID 和版本控制](/docs/zh-CN/about-claude/models/model-ids-and-versions)。</Note>

<Note>从 **Claude Sonnet 4.5 及所有后续模型**（包括 Claude Sonnet 4.6）开始，Bedrock 提供两种端点类型：**全球端点**（动态路由以实现最大可用性）和**区域端点**（保证数据通过特定地理区域路由）。Vertex AI 提供三种端点类型：全球端点、**多区域端点**（在某一地理区域内动态路由）和区域端点。更多信息请参阅[云平台定价](/docs/zh-CN/about-claude/pricing#cloud-platform-pricing)。</Note>

<Note>**Claude Platform on AWS** 使用与 Claude API 相同的模型 ID（例如 `claude-opus-4-6`），而非 Bedrock 风格的 ID。Claude Platform on AWS 上的模型生命周期遵循 Anthropic 第一方的[模型弃用](/docs/zh-CN/about-claude/model-deprecations)政策，而非 Bedrock 的政策。有关模型列表，请参阅[可用模型](/docs/zh-CN/build-with-claude/claude-platform-on-aws#available-models)。</Note>

<Tip>
您可以使用 [Models API](/docs/zh-CN/api/models/list) 以编程方式查询模型能力和令牌限制。响应中包含每个可用模型的 `max_input_tokens`、`max_tokens` 和 `capabilities` 对象。
</Tip>

<Note>
在 Claude Opus 4.8 上，`effort` 参数在所有平台（包括 Claude API 和 Claude Code）上默认为 `high`。如需使用不同级别，请显式设置 `effort`。有关选择级别的指导，请参阅 [Effort](/docs/zh-CN/build-with-claude/effort)。
</Note>

<Note>
上述最大输出值适用于同步 Messages API。在 [Message Batches API](/docs/zh-CN/build-with-claude/batch-processing#extended-output-beta) 上，Claude Opus 4.8、Opus 4.7、Opus 4.6 和 Sonnet 4.6 通过使用 `output-300k-2026-03-24` beta 标头支持最多 30 万输出令牌。
</Note>

<section title="旧版模型">

以下模型仍然可用。建议迁移到当前模型以获得更好的性能：

| 特性 | Claude Opus 4.7 | Claude Opus 4.6 | Claude Sonnet 4.5 | Claude Opus 4.5 | Claude Opus 4.1（已弃用） | Claude Sonnet 4（已弃用） | Claude Opus 4（已弃用） |
|:--------|:----------------|:----------------|:------------------|:----------------|:----------------|:----------------|:--------------|
| **Claude API ID** | claude-opus-4-7 | claude-opus-4-6 | claude-sonnet-4-5-20250929 | claude-opus-4-5-20251101 | claude-opus-4-1-20250805 | claude-sonnet-4-20250514 | claude-opus-4-20250514 |
| **Claude API 别名** | claude-opus-4-7 | claude-opus-4-6 | claude-sonnet-4-5 | claude-opus-4-5 | claude-opus-4-1 | claude-sonnet-4-0 | claude-opus-4-0 |
| **AWS Bedrock ID** | anthropic.claude-opus-4-7<sup>6</sup> | anthropic.claude-opus-4-6-v1 | anthropic.claude-sonnet-4-5-20250929-v1:0 | anthropic.claude-opus-4-5-20251101-v1:0 | anthropic.claude-opus-4-1-20250805-v1:0 | anthropic.claude-sonnet-4-20250514-v1:0 | anthropic.claude-opus-4-20250514-v1:0 |
| **Vertex AI ID** | claude-opus-4-7 | claude-opus-4-6 | claude-sonnet-4-5@20250929 | claude-opus-4-5@20251101 | claude-opus-4-1@20250805 | claude-sonnet-4@20250514 | claude-opus-4@20250514 |
| **定价** | \$5 / 输入百万令牌<br/>\$25 / 输出百万令牌 | \$5 / 输入百万令牌<br/>\$25 / 输出百万令牌 | \$3 / 输入百万令牌<br/>\$15 / 输出百万令牌 | \$5 / 输入百万令牌<br/>\$25 / 输出百万令牌 | \$15 / 输入百万令牌<br/>\$75 / 输出百万令牌 | \$3 / 输入百万令牌<br/>\$15 / 输出百万令牌 | \$15 / 输入百万令牌<br/>\$75 / 输出百万令牌 |
| **[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)** | 否 | 是 | 是 | 是 | 是 | 是 | 是 |
| **[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)** | 是 | 是 | 否 | 否 | 否 | 否 | 否 |
| **[优先层级](/docs/zh-CN/api/service-tiers)** | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| **相对延迟** | 中等 | 中等 | 快 | 中等 | 中等 | 快 | 中等 |
| **上下文窗口** | <Tooltip tooltipContent="约 55.5 万词 \ 约 250 万 Unicode 字符（Opus 4.7 使用新的分词器）">100 万令牌</Tooltip> | <Tooltip tooltipContent="约 75 万词 \ 约 340 万 Unicode 字符">100 万令牌</Tooltip> | <Tooltip tooltipContent="约 15 万词 \ 约 68 万 Unicode 字符">20 万令牌</Tooltip> | <Tooltip tooltipContent="约 15 万词 \ 约 68 万 Unicode 字符">20 万令牌</Tooltip> | <Tooltip tooltipContent="约 15 万词 \ 约 68 万 Unicode 字符">20 万令牌</Tooltip> | <Tooltip tooltipContent="约 15 万词 \ 约 68 万 Unicode 字符">20 万令牌</Tooltip> | <Tooltip tooltipContent="约 15 万词 \ 约 68 万 Unicode 字符">20 万令牌</Tooltip> |
| **最大输出** | 12.8 万令牌 | 12.8 万令牌 | 6.4 万令牌 | 6.4 万令牌 | 3.2 万令牌 | 6.4 万令牌 | 3.2 万令牌 |
| **可靠知识截止日期** | 2026 年 1 月<sup>5</sup> | 2025 年 5 月<sup>5</sup> | 2025 年 1 月<sup>5</sup> | 2025 年 5 月<sup>5</sup> | 2025 年 1 月<sup>5</sup> | 2025 年 1 月<sup>5</sup> | 2025 年 1 月<sup>5</sup> |
| **训练数据截止日期** | 2026 年 1 月 | 2025 年 8 月 | 2025 年 7 月 | 2025 年 8 月 | 2025 年 3 月 | 2025 年 3 月 | 2025 年 3 月 |

<Warning>
Claude Opus 4.1（`claude-opus-4-1-20250805`）已弃用，将于 2026 年 8 月 5 日停用。请在停用日期前迁移到 [Claude Opus 4.8](/docs/zh-CN/about-claude/models/migration-guide#migrating-from-claude-opus-47)。

Claude Sonnet 4（`claude-sonnet-4-20250514`）和 Claude Opus 4（`claude-opus-4-20250514`）已弃用，将于 2026 年 6 月 15 日停用。请在停用日期前分别迁移到 [Claude Sonnet 4.6](/docs/zh-CN/about-claude/models/overview#latest-models-comparison) 和 [Claude Opus 4.8](/docs/zh-CN/about-claude/models/migration-guide#migrating-from-claude-opus-47)。

详情请参阅[模型弃用](/docs/zh-CN/about-claude/model-deprecations)。
</Warning>

_<sup>5 - **可靠知识截止日期**表示模型知识最全面、最可靠的截止日期。**训练数据截止日期**是所用训练数据的更广泛日期范围。</sup>_

_<sup>6 - Claude Opus 4.7 可通过 [Claude in Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)（Messages-API Bedrock 端点）在 Bedrock 上使用。</sup>_

</section>

## 提示和输出性能 \{#prompt-and-output-performance}

Claude 4 模型在以下方面表现出色：
- **性能**：在推理、编码、多语言任务、长上下文处理、诚实性和图像处理方面取得顶级成果。更多信息请参阅 [Claude 4 博客文章](https://www.anthropic.com/news/claude-4)。
- **引人入胜的响应**：Claude 模型非常适合需要丰富、类人交互的应用程序。

    - 如果您希望获得更简洁的响应，可以调整提示以引导模型生成所需长度的输出。详情请参阅[提示工程指南](/docs/zh-CN/build-with-claude/prompt-engineering)。
    - 有关提示最佳实践，请参阅[提示最佳实践](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)。
- **输出质量**：从之前的模型代迁移到 Claude 4 时，您可能会注意到整体性能有更大的提升。

## 迁移到 Claude Opus 4.8 \{#migrating-to-claude-opus-4-8}

如果您当前正在使用 Claude Opus 4.7 或更早的 Claude 模型，请参阅[迁移到 Claude Opus 4.8](/docs/zh-CN/about-claude/models/migration-guide#migrating-from-claude-opus-47)。

## 迁移到 Claude Opus 4.7 \{#migrating-to-claude-opus-4-7}

如果您当前正在使用 Claude Opus 4.6 或更旧的 Claude 模型，请参阅[迁移到 Claude Opus 4.7](/docs/zh-CN/about-claude/models/migration-guide#migrating-to-claude-opus-4-7)。

## 开始使用 Claude \{#get-started-with-claude}

如果您已准备好开始探索 Claude 能为您做什么，那就开始吧！无论您是希望将 Claude 集成到应用程序中的开发者，还是想亲身体验 AI 强大功能的用户，以下资源都能为您提供帮助。

<Note>想与 Claude 聊天？请访问 [claude.ai](https://claude.ai)！</Note>

<CardGroup cols={3}>
  <Card title="Claude 简介" icon="check" href="/docs/zh-CN/intro">
    探索 Claude 的能力和开发流程。
  </Card>
  <Card title="快速入门" icon="lightning" href="/docs/zh-CN/get-started">
    了解如何在几分钟内完成首次 API 调用。
  </Card>
  <Card title="Claude Console" icon="code" href="/">
    直接在浏览器中编写和测试强大的提示。
  </Card>
</CardGroup>

如果您有任何问题或需要帮助，请随时联系[支持团队](https://support.claude.com/)或咨询 [Discord 社区](https://www.anthropic.com/discord)。