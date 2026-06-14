# 选择合适的模型

为您的应用程序选择最佳的 Claude 模型需要平衡三个关键考虑因素：能力、速度和成本。本指南将帮助您根据具体需求做出明智的决策。

---

## 确立关键标准 \{#establish-key-criteria}

在选择 Claude 模型时，建议首先评估以下因素：
- **能力：** 为满足您的需求，模型需要具备哪些特定的功能或能力？
- **速度：** 在您的应用程序中，模型需要多快做出响应？Claude Opus 4.8、Claude Opus 4.7 和 Claude Opus 4.6 支持 [fast mode](/docs/zh-CN/build-with-claude/fast-mode)（快速模式，研究预览版），该模式以高级定价提供高达 2.5 倍的输出速度。Claude Opus 4.6 上的快速模式已弃用，即将移除。
- **成本：** 您在开发和生产使用方面的预算是多少？
- **Effort（推理投入）：** 近期的 Opus 和 Sonnet 模型支持 [effort 参数](/docs/zh-CN/build-with-claude/effort)，可在单个模型内在智能程度与延迟和成本之间进行权衡。调整 effort 通常比切换模型更为有效。在 Claude Opus 4.8 和 Claude Opus 4.7 上，介于 `high` 和 `max` 之间的 `xhigh` effort 级别是大多数编码和智能体用例的最佳设置。

提前明确这些问题的答案，将使您更容易缩小范围并决定使用哪个模型。

***

## 选择最佳的起始模型 \{#choose-the-best-model-to-start-with}

您可以采用两种通用方法来开始测试哪个 Claude 模型最适合您的需求。

### 方案 1：从快速、经济高效的模型开始 \{#option-1-start-with-a-fast-cost-effective-model}

对于许多应用程序而言，从 Claude Haiku 4.5 这样更快速、更经济高效的模型开始可能是最佳方法：

1. 使用 Claude Haiku 4.5 开始实现
2. 全面测试您的用例
3. 评估性能是否满足您的要求
4. 仅在存在特定能力缺口时才进行升级

这种方法支持快速迭代、降低开发成本，并且通常足以满足许多常见应用的需求。此方法最适合：
- 初始原型设计和开发
- 对延迟有严格要求的应用程序
- 对成本敏感的实现
- 高吞吐量、简单直接的任务

### 方案 2：从能力最强的模型开始 \{#option-2-start-with-the-most-capable-model}

对于智能和高级能力至关重要的复杂任务，您可能希望从能力最强的模型开始，然后再考虑优化到更高效的模型：

1. 使用 Claude Opus 4.8 进行实现
2. 针对这些模型优化您的提示
3. 评估性能是否满足您的要求
4. 随着工作流程的进一步优化，考虑通过降低 [effort](/docs/zh-CN/build-with-claude/effort) 或降级模型来提高效率

此方法最适合：
- 复杂的推理任务
- 科学或数学应用
- 需要细致理解的任务
- 准确性优先于成本考量的应用程序
- 高级编码和高自主性的智能体工作

<Note>
在 Claude Opus 4.8 上，所有界面（包括 Claude Code 和 Messages API）的默认 [effort 级别](/docs/zh-CN/build-with-claude/effort)均为 `high`。对于编码、高自主性工作以及对智能要求最高的任务，请使用 `xhigh`。
</Note>

**Claude Fable 5**（`claude-fable-5`）是 Anthropic 能力最强的广泛发布模型。请选择它来处理要求最高的推理任务和长周期智能体任务。**Claude Mythos 5**（`claude-mythos-5`）可通过 [Project Glasswing](https://anthropic.com/glasswing) 获取。这两个模型默认支持 100 万令牌的上下文窗口、最多 128k 输出令牌，以及始终开启的 [adaptive thinking](/docs/zh-CN/build-with-claude/adaptive-thinking)（自适应思考）。有关发布详情，请参阅 [Claude Fable 5 和 Claude Mythos 5 介绍](/docs/zh-CN/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5)。

Claude Fable 5 和 Claude Mythos 5 的定价为每百万输入令牌 10 美元，每百万输出令牌 50 美元。

## 模型选择矩阵 \{#model-selection-matrix}

| 当您需要…… | 建议从以下模型开始…… | 示例用例 |
|------------------|-------------------|-------------------|
| Anthropic 能力最强的 Opus 级模型，用于复杂推理、长周期智能体编码和高自主性工作 | Claude Opus 4.8 | 多小时自主编码智能体、大规模重构、复杂系统工程、高级研究、知识工作、视觉密集型工作流、计算机使用 |
| 可规模化部署的前沿智能，专为编码、智能体和企业工作流打造 | Claude Sonnet 4.6 | 代码生成、数据分析、内容创作、视觉理解、智能体工具使用 |
| 以最经济的价位获得接近前沿的性能、闪电般的速度和扩展思考能力 | Claude Haiku 4.5 | 实时应用、高吞吐量智能处理、需要强大推理能力的成本敏感型部署、子智能体任务 |

***

## 决定是否升级或更换模型 \{#decide-whether-to-upgrade-or-change-models}

要确定是否需要升级或更换模型，您应该：
1. [创建基准测试](/docs/zh-CN/test-and-evaluate/develop-tests)，针对您的具体用例——拥有良好的评估集是整个过程中最重要的一步
2. 使用您的实际提示和数据进行测试
3. 比较各模型在以下方面的表现：
   - 响应的准确性
   - 响应质量
   - 边缘情况的处理
4. 权衡性能与成本之间的取舍

## 后续步骤 \{#next-steps}

<CardGroup cols={3}>
  <Card title="模型对比表" icon="settings" href="/docs/zh-CN/about-claude/models/overview">
    查看最新 Claude 模型的详细规格和定价
  </Card>
  <Card title="Claude Opus 4.8 新特性" icon="sparkle" href="/docs/zh-CN/about-claude/models/whats-new-claude-4-8">
    探索 Claude Opus 4.8 的最新改进
  </Card>
  <Card title="开始构建" icon="code" href="/docs/zh-CN/get-started">
    开始您的第一次 API 调用
  </Card>
</CardGroup>