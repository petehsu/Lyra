# 迁移指南

从先前 Claude 版本迁移到最新 Claude 模型的指南

---

<Note>
本指南涵盖 [Messages API](/docs/zh-CN/build-with-claude/working-with-messages) 代码的迁移。如果您使用 [Claude Managed Agents](/docs/zh-CN/managed-agents/overview)，除更新模型名称外无需其他更改。
</Note>

<Tip>
  **使用 Claude API skill 自动完成迁移。** 在 Claude Code 中，运行 `/claude-api migrate` 以调用内置的 [Claude API skill](/docs/zh-CN/agents-and-tools/agent-skills/claude-api-skill#migrating-to-a-newer-claude-model)。它适用于本页面上的任何目标模型：

  ```text
  /claude-api migrate this project to claude-opus-4-8
  ```

  该 skill 会在您的代码库中应用模型 ID 替换，并根据需要处理破坏性参数更改、预填充替换以及针对目标模型的 effort 校准，然后生成一份需要手动验证的检查清单。在编辑任何文件之前，它会要求您确认迁移范围（整个工作目录、某个子目录或特定文件列表）。该 skill 还会检测 Amazon Bedrock、Vertex AI、Claude Platform on AWS 和 Microsoft Foundry 客户端，并针对每个平台调整模型 ID 格式和功能变更。
</Tip>

## 从 Claude Mythos Preview 迁移到 Claude Mythos 5 \{#migrating-from-claude-mythos-preview}

[Claude Mythos 5](https://anthropic.com/glasswing) 是 [Claude Mythos Preview](https://anthropic.com/glasswing)（仅限邀请的研究预览版）的访问受限后继版本。如需具有相同能力的正式发布模型，请参阅 [Claude Fable 5](/docs/zh-CN/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5)。

迁移基本上是即插即用的。Claude Mythos 5 使用与 Claude Mythos Preview 相同的 [Messages API](/docs/zh-CN/build-with-claude/working-with-messages) 和相同的[工具使用](/docs/zh-CN/agents-and-tools/tool-use/overview)模式，并且由于两个模型使用相同的分词器，令牌数量基本保持不变。需要检查的关键变更是不再可用的功能（在下一节中列出）以及思考输出。

有关 Claude Mythos Preview 的停用时间表，请参阅[模型弃用](/docs/zh-CN/about-claude/model-deprecations)。

### 更新您的模型名称 \{#update-your-model-name}

```python
model = "claude-mythos-preview"  # Before
model = "claude-mythos-5"  # After
```

### Claude Mythos 5 上不可用的功能 \{#features-not-available-on-claude-mythos-5}

1. **扩展思考和思考令牌预算：** `claude-mythos-5` 不支持手动扩展思考（`thinking: {type: "enabled", budget_tokens: N}`），会返回 400 错误。[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)始终开启：模型会在每个请求中自行决定何时思考以及思考多少，无需任何 `thinking` 配置。`thinking: {type: "disabled"}` 会返回错误。`budget_tokens` 没有直接替代项：思考是自适应的，而 [effort 参数](/docs/zh-CN/build-with-claude/effort)是一个独立的输出级别控制，而非思考预算。

    之前（Claude Mythos Preview）：

    ```python
    client.messages.create(
        model="claude-mythos-preview",
        max_tokens=16000,
        thinking={"type": "enabled", "budget_tokens": 10000},
        messages=[{"role": "user", "content": "..."}],
    )
    ```

    之后（Claude Mythos 5）：

    
    ```python nocheck
    client.messages.create(
        model="claude-mythos-5",
        max_tokens=16000,
        messages=[{"role": "user", "content": "..."}],
    )
    ```

2. **助手预填充：** `claude-mythos-5` 不支持预填充助手消息，会返回 400 错误，与 Claude Mythos Preview 相同。请改用系统提示指令。

3. **思考输出：** 在 `claude-mythos-5` 上，原始思维链永远不会返回，但当 `thinking.display` 设置为 `summarized` 时，思考块仍会携带可读的摘要文本。在同一模型上继续对话时，请原样传回思考块。请参阅 [Claude Fable 5 和 Claude Mythos 5 上的思考输出](/docs/zh-CN/build-with-claude/adaptive-thinking#thinking-output-on-claude-fable-5-and-claude-mythos-5)。

### 令牌计数和计费 \{#token-counting-and-billing}

`claude-mythos-5` 使用与 `claude-mythos-preview` 相同的分词器（随 Claude Opus 4.7 引入的分词器）。从 `claude-mythos-preview` 迁移时，令牌数量基本保持不变。与 Claude Opus 4.7 之前的模型相比，相同内容的令牌数量可能增加约 30%，具体因内容和工作负载形态而异。

对于 `claude-mythos-5`，[`/v1/messages/count_tokens`](/docs/zh-CN/build-with-claude/token-counting) 返回的值与 `claude-mythos-preview` 相比基本保持不变。请基于您自己的工作负载重新建立成本和延迟基准。

### 迁移检查清单 \{#migration-checklist}

- [ ] 将模型名称从 `claude-mythos-preview` 更新为 `claude-mythos-5`。
- [ ] 移除手动扩展思考配置（`thinking: {type: "enabled", budget_tokens: N}`）。自适应思考始终开启，无需 `thinking` 字段。
- [ ] 移除任何 `thinking: {type: "disabled"}` 配置。在 `claude-mythos-5` 上禁用思考会返回错误。
- [ ] 移除 `budget_tokens`。它没有直接替代项：思考是自适应的，而 `effort` 参数是一个独立的输出级别控制，而非思考预算。
- [ ] 验证任何解析 `thinking` 字段的代码仅将其视为显示文本，并在同一模型上继续对话时原样传回思考块。在 `claude-mythos-5` 上，`thinking.display` 默认为 `"omitted"`，与 Claude Mythos Preview 相同；设置 `display: "summarized"` 以接收可读摘要。请参阅 [Claude Fable 5 和 Claude Mythos 5 上的思考输出](/docs/zh-CN/build-with-claude/adaptive-thinking#thinking-output-on-claude-fable-5-and-claude-mythos-5)。
- [ ] 如果您在另一个模型上重放对话历史，请先从之前的助手回合中剥离 `thinking` 和 `redacted_thinking` 块。来自 `claude-mythos-5` 的思考块与生成它们的模型绑定，Claude Fable 5 和 Claude Mythos 5 以外的模型会静默忽略它们。剥离这些块可使跨模型请求保持精简和统一。
- [ ] 基于您自己的工作负载重新建立令牌数量和成本基准。从 `claude-mythos-preview` 迁移时，令牌数量基本保持不变。

## 从 Claude Opus 4.8 迁移到 Claude Fable 5 \{#migrating-from-claude-opus-48}

[Claude Fable 5](/docs/zh-CN/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5) 是 Anthropic 能力最强的广泛发布模型，在 Claude API、[Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws)、[Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)、[Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上正式发布。

迁移基本上是即插即用的。Claude Fable 5 使用与 Claude Opus 4.8 相同的 [Messages API](/docs/zh-CN/build-with-claude/working-with-messages) 和相同的[工具使用](/docs/zh-CN/agents-and-tools/tool-use/overview)模式。它默认支持相同的 [1M 令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)和相同的 [128k 最大输出令牌](/docs/zh-CN/about-claude/models/overview)。由于两个模型使用相同的分词器，令牌数量基本保持不变。

需要检查的关键变更是始终开启的[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)、思考输出、安全分类器拒绝以及定价。[迁移前](#before-you-migrate)涵盖定价和数据保留；[变更内容](#what-changed)涵盖其余部分。

### 迁移前 \{#before-you-migrate}

Claude Fable 5 的定价为每百万输入令牌 10 美元、每百万输出令牌 50 美元，而 Claude Opus 4.8 分别为 5 美元和 25 美元。详情请参阅 [Claude 定价](/docs/zh-CN/about-claude/pricing)。

Claude Fable 5 要求 30 天数据保留，在零数据保留（ZDR）安排下不可用；它被指定为受管控模型（Covered Model）。如果组织的数据保留配置不满足此要求，请求将返回 400 `invalid_request_error`。具有 ZDR 安排的组织应联系其 Anthropic 客户团队讨论数据保留配置；Claude Opus 4.8 在 ZDR 下仍然可用。或者，您可以按工作区配置数据保留；请参阅[特定模型的数据保留要求](/docs/zh-CN/manage-claude/api-and-data-retention#model-specific-data-retention-requirements)。在 Amazon Bedrock、Vertex AI 和 Microsoft Foundry 上，数据保留由各平台管理。

<Note>
如果您的代码基于 Claude Opus 4.7 或更早版本，请先应用[从 Claude Opus 4.7 迁移到 Claude Opus 4.8](#migrating-from-claude-opus-47)，对于早于 Claude Opus 4.7 的模型，还需应用 [Claude Opus 4.7 迁移步骤](#migrating-to-claude-opus-4-7)。这些章节涵盖了本节不再重复的破坏性变更（采样参数被拒绝、手动扩展思考被拒绝、预填充被移除、新分词器）。
</Note>

### 更新您的模型名称 \{#update-your-model-name-2}

```python
model = "claude-opus-4-8"  # Before
model = "claude-fable-5"  # After
```

### 变更内容 \{#what-changed}

本节中的条目描述了在替换模型 ID 后值得检查的 API 和行为差异。

1. **自适应思考始终开启：** [自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)是 `claude-fable-5` 上唯一的思考模式。模型会在每个请求中自行决定何时思考以及思考多少，无需任何 `thinking` 配置。`thinking: {type: "disabled"}` 会返回错误。使用 [effort 参数](/docs/zh-CN/build-with-claude/effort)来控制思考深度。

    需要检查的行为变更：在 Claude Opus 4.8 上，没有 `thinking` 字段的请求在不思考的情况下运行；在 `claude-fable-5` 上，同样的请求会以自适应思考方式运行。`max_tokens` 仍然是总输出（思考加响应文本）的硬性限制，因此对于在 Claude Opus 4.8 上不使用思考运行的工作负载，请重新审视该参数。请参阅[成本控制](/docs/zh-CN/build-with-claude/adaptive-thinking#cost-control)。

    之前（Claude Opus 4.8）：

    ```python
    client.messages.create(
        model="claude-opus-4-8",
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        messages=[{"role": "user", "content": "..."}],
    )
    ```

    之后（Claude Fable 5）：

    ```python
    client.messages.create(
        model="claude-fable-5",
        max_tokens=16000,
        output_config={"effort": "high"},
        messages=[{"role": "user", "content": "..."}],
    )
    ```

2. **扩展思考和思考预算（未变更）：** `claude-fable-5` 不支持手动扩展思考（`thinking: {type: "enabled", budget_tokens: N}`），会返回 400 错误，与 Claude Opus 4.8 相同。`budget_tokens` 没有直接替代项：思考是自适应的，而 [effort 参数](/docs/zh-CN/build-with-claude/effort)是一个独立的输出级别控制，而非思考预算。

3. **助手预填充（未变更）：** `claude-fable-5` 不支持预填充助手消息，会返回 400 错误，与 Claude Opus 4.8 相同。请改用系统提示指令。

4. **思考输出：** 在 `claude-fable-5` 上，原始思维链永远不会返回，但当 `thinking.display` 设置为 `summarized` 时，思考块仍会携带可读的摘要文本。在同一模型上继续对话时，请原样传回思考块。请参阅 [Claude Fable 5 和 Claude Mythos 5 上的思考输出](/docs/zh-CN/build-with-claude/adaptive-thinking#thinking-output-on-claude-fable-5-and-claude-mythos-5)。

5. **安全分类器和 `refusal` 停止原因：** `claude-fable-5` 会在请求时和响应生成期间运行安全分类器。当分类器拒绝请求时，Messages API 会以成功的 HTTP 200 响应返回 `stop_reason: "refusal"`，而非错误。`stop_details.category` 字段报告触发的分类器类别，例如 `"cyber"`、`"bio"` 和 `"reasoning_extraction"`，当拒绝未映射到任何命名类别时则为 `null`。完整类别集请参阅[拒绝类别表](/docs/zh-CN/build-with-claude/refusals-and-fallback#refusal-response)。

    对于在生成任何输出之前被拒绝的请求，您不会被收取输入令牌费用。当分类器在流式传输中途触发时，输入和已流式传输的输出会被计费；请丢弃部分输出。

    要在另一个模型上自动重新运行被拒绝的请求，请传递可选的 `fallbacks` 参数，该参数在 Claude API 和 Claude Platform on AWS 上处于测试阶段。该参数在 Message Batches API 以及 Amazon Bedrock、Vertex AI 和 Microsoft Foundry 上不可用；在这三个平台上，请在客户端运行重试或使用 SDK 拒绝回退中间件。请参阅[处理停止原因](/docs/zh-CN/build-with-claude/refusals-and-fallback)。

6. **从 `high` effort 开始：** [effort 参数](/docs/zh-CN/build-with-claude/effort)的默认值仍为 `high`。在 Claude Opus 4.8 上，针对编码和高自主性工作的建议是显式设置 `xhigh`。在 `claude-fable-5` 上，对大多数任务使用 `high` 作为默认值，将 `xhigh` 保留给对能力最敏感的工作负载。`claude-fable-5` 上较低的 effort 设置仍然表现良好，通常超过先前模型上的 `xhigh` 性能。如果任务能够完成但耗时超过必要时间，请降低 effort。请参阅 [Claude Fable 5 提示技巧](/docs/zh-CN/build-with-claude/prompt-engineering/prompting-claude-fable-5#consider-all-effort-levels)。

7. **更低的提示缓存最小值：** `claude-fable-5` 上的最小可缓存提示长度为 512 个令牌，低于 Claude Opus 4.8 上的 1,024 个令牌。在 Claude Opus 4.8 上因太短而无法缓存的提示现在可以创建缓存条目，无需更改代码。在 Amazon Bedrock 上，`claude-fable-5` 的最小值为 1,024 个令牌。各模型的最小值请参阅[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching#cache-limitations)。

### 迁移检查清单 \{#migration-checklist-2}

- [ ] 如果您的组织具有零数据保留（ZDR）安排，请在迁移前确认资格。`claude-fable-5` 要求 30 天数据保留，否则返回 400 `invalid_request_error`。请参阅[特定模型的数据保留要求](/docs/zh-CN/manage-claude/api-and-data-retention#model-specific-data-retention-requirements)。
- [ ] 将模型名称从 `claude-opus-4-8` 更新为 `claude-fable-5`。
- [ ] 移除任何 `thinking: {type: "disabled"}` 配置。在 `claude-fable-5` 上禁用思考会返回错误，没有 `thinking` 字段的请求会以自适应思考方式运行。
- [ ] 如果您在早期迁移期间已移除手动扩展思考和助手预填充，则无需操作：两者在 `claude-fable-5` 上仍不受支持。
- [ ] 验证任何解析 `thinking` 字段的代码仅将其视为显示文本，并在同一模型上继续对话时原样传回思考块。在 `claude-fable-5` 上，`thinking.display` 默认为 `"omitted"`，与 Claude Opus 4.8 相同；设置 `display: "summarized"` 以接收可读摘要。请参阅 [Claude Fable 5 和 Claude Mythos 5 上的思考输出](/docs/zh-CN/build-with-claude/adaptive-thinking#thinking-output-on-claude-fable-5-and-claude-mythos-5)。
- [ ] 如果您在另一个模型上重放对话历史，请先从之前的助手回合中剥离 `thinking` 和 `redacted_thinking` 块。来自 `claude-fable-5` 的思考块与生成它们的模型绑定，Claude Fable 5 和 Claude Mythos 5 以外的模型会静默忽略它们。剥离这些块可使跨模型请求保持精简和统一。例外情况是兑换[回退额度](/docs/zh-CN/build-with-claude/fallback-credit)，这需要按照该功能的确切规则回显请求正文。
- [ ] 处理 `stop_reason: "refusal"` 并读取 `stop_details.category` 字段。要在另一个模型上自动重新运行被拒绝的请求，请考虑使用可选的 `fallbacks` 参数（测试版）。请参阅[处理停止原因](/docs/zh-CN/build-with-claude/refusals-and-fallback)。
- [ ] 重新评估您的 `effort` 设置。对大多数任务从 `high` 开始，包括在 Claude Opus 4.8 上以 `xhigh` 运行的工作负载。
- [ ] 基于您自己的工作负载重新建立成本和延迟基准。从 `claude-opus-4-8` 迁移时，令牌数量基本保持不变；每令牌定价有所不同。

## 从 Claude Opus 4.7 迁移到 Claude Opus 4.8 \{#migrating-from-claude-opus-47}

Claude Opus 4.8 是 Anthropic 能力最强的 Opus 级模型。它基于 Claude Opus 4.7 构建。

Claude Opus 4.8 在现有的 Claude Opus 4.7 提示和评估上应具有出色的开箱即用性能。对于已在 Claude Opus 4.7 上运行的代码，没有破坏性的 API 变更。它支持与 Claude Opus 4.7 相同的功能集，包括 [1M 令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)、[128k 最大输出令牌](/docs/zh-CN/about-claude/models/overview)、[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)、[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)、[批处理](/docs/zh-CN/build-with-claude/batch-processing)、[Files API](/docs/zh-CN/build-with-claude/files)、[PDF 支持](/docs/zh-CN/build-with-claude/pdf-support)、[视觉](/docs/zh-CN/build-with-claude/vision)，以及完整的服务器端和客户端[工具](/docs/zh-CN/agents-and-tools/tool-use/overview)集。它还新增了[对话中系统消息](/docs/zh-CN/about-claude/models/whats-new-claude-4-8#mid-conversation-system-messages)，并公开记录了[拒绝停止详情](/docs/zh-CN/about-claude/models/whats-new-claude-4-8#refusal-stop-details)。

<Note>
如果您的代码基于 Claude Opus 4.6 或更早版本，在升级到 Claude Opus 4.8 之前，还需应用下方的 [Claude Opus 4.7 迁移步骤](#migrating-to-claude-opus-4-7)。这些步骤包含破坏性变更（采样参数被拒绝、手动扩展思考被拒绝、新分词器），仅靠 4.8 升级无法涵盖。
</Note>

<Note>
在 Microsoft Foundry 上，Claude Opus 4.8 发布时具有 200k 令牌的上下文窗口。1M 上下文窗口适用于 Claude API、Amazon Bedrock 和 Vertex AI。请参阅 [Microsoft Foundry 中的 Claude](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)。
</Note>

### 更新您的模型名称 \{#update-your-model-name-3}

```python
# Opus 迁移
model = "claude-opus-4-7"  # Before
model = "claude-opus-4-8"  # After
```

### 变更内容 \{#what-changed-2}

这些不是破坏性变更。在 Claude Opus 4.7 上运行的代码在 Claude Opus 4.8 上无需更改即可继续工作。以下条目描述了在替换模型 ID 后值得检查的行为差异。

1. **采样参数（未变更）：** 在 Claude Opus 4.8 上将 `temperature`、`top_p` 或 `top_k` 设置为非默认值会返回 400 错误，与 Claude Opus 4.7 相同。SDK 请求类型仍然定义这些字段以兼容早期模型，因此设置它们的代码可以通过类型检查，但 API 会在服务器端拒绝该请求。如果您在迁移到 Opus 4.7 时已移除这些参数，则无需进一步更改。

2. **Effort 默认值为 `high`：** Claude Opus 4.8 上的 [effort 参数](/docs/zh-CN/build-with-claude/effort)默认值在所有界面（包括 Claude Code 和 Messages API）上均为 `high`。如果您已显式设置 effort，您的设置保持不变。对于编码和高自主性工作，请显式设置 `xhigh`。请根据您的延迟和成本预算重新评估您的 effort 设置。

3. **1M 上下文窗口为默认值：** Claude Opus 4.8 默认提供完整的 1M 令牌[上下文窗口](/docs/zh-CN/build-with-claude/context-windows)，无需测试版标头，也没有长上下文溢价。如果您的客户端为兼容旧模型而传递上下文窗口测试版标头，可以在 Claude Opus 4.8 上将其移除。

4. **对话中系统消息：** Claude Opus 4.8 接受在 `messages` 数组中紧跟用户回合之后的 `role: "system"` 消息（需遵守[放置规则](/docs/zh-CN/build-with-claude/mid-conversation-system-messages#limitations)）。对于从一开始就适用的指令，请使用顶层 `system` 字段。早期模型（包括 Claude Opus 4.7）会拒绝 `messages` 中的 `role: "system"` 并返回 400 错误。如果您维护的代码路径会重建完整消息历史以更新指令，您可以简化它们并保留早期回合的[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)命中。

5. **拒绝停止详情：** 拒绝响应上的 `stop_details` 对象（自 Claude Opus 4.7 起可用）现已公开记录。当模型拒绝请求时，除了现有的 `refusal` 停止原因外，它还会标识拒绝的类别。无需测试版标头，也无法选择退出。请参阅[处理停止原因](/docs/zh-CN/build-with-claude/handling-stop-reasons)。

6. **更低的提示缓存最小值：** Claude Opus 4.8 上的最小可缓存提示长度为 1,024 个令牌，低于 Claude Opus 4.7。在 Claude Opus 4.7 上因太短而无法缓存的提示现在可以创建缓存条目，无需更改代码。各模型的最小值请参阅[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching#cache-limitations)。

7. **Effort 级别重新校准：** 与 Claude Opus 4.7 相比，Claude Opus 4.8 上每个 effort 级别背后的令牌分配有所变化：`medium` 允许稍多的思考，`high` 稍少，`xhigh` 则大幅增加。如果您针对 Claude Opus 4.7 的成本或延迟调整过某个 effort 级别，请在调整之前先在相同级别重新建立基准。请参阅 [Effort](/docs/zh-CN/build-with-claude/effort)。

### 迁移检查清单 \{#migration-checklist-3}

- [ ] 将模型名称从 `claude-opus-4-7` 更新为 `claude-opus-4-8`（或更新别名）。
- [ ] 如果您在 Opus 4.7 迁移期间已移除采样参数，则无需操作。如果您通过 400 重试路径重新添加了它们，请移除该重试路径。
- [ ] 重新评估您的 `effort` 设置。所有界面上的默认值均为 `high`；对于编码和高自主性工作，请显式设置 `xhigh`。
- [ ] 移除任何上下文窗口测试版标头。在 Claude API、Amazon Bedrock 和 Vertex AI 上，1M 上下文窗口为默认值（Microsoft Foundry 上为 200k）。
- [ ] 如果您重建对话历史以更新指令，请考虑切换到对话中系统消息以保留提示缓存命中。
- [ ] 验证您的停止原因处理代码在拒绝时读取 `stop_details`（自 Claude Opus 4.7 起可用；现已公开记录）。
- [ ] 在您选择的 effort 级别上重新建立成本和延迟基准。

## 迁移到 Claude Opus 4.7 \{#migrating-to-claude-opus-4-7}

Claude Opus 4.7 具有高度自主性，在长周期智能体工作、知识工作、视觉任务和记忆任务方面表现出色。

Claude Opus 4.7 在现有的 Claude Opus 4.6 提示和评估上应具有出色的开箱即用性能，定价同为每百万令牌 `$5 / $25`，但在迁移时有一些行为和 API 变更值得了解。它支持与 Claude Opus 4.6 相同的功能集，包括：

- [1M 令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)，按标准 API 定价，无长上下文溢价
- [128k 最大输出令牌](/docs/zh-CN/about-claude/models/overview)
- [自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)
- [提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)
- [批处理](/docs/zh-CN/build-with-claude/batch-processing)
- [Files API](/docs/zh-CN/build-with-claude/files)
- [PDF 支持](/docs/zh-CN/build-with-claude/pdf-support)
- [视觉](/docs/zh-CN/build-with-claude/vision)
- 完整的服务器端和客户端[工具](/docs/zh-CN/agents-and-tools/tool-use/overview)集（[bash](/docs/zh-CN/agents-and-tools/tool-use/bash-tool)、[代码执行](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)、[计算机使用](/docs/zh-CN/agents-and-tools/tool-use/computer-use-tool)、[文本编辑器](/docs/zh-CN/agents-and-tools/tool-use/text-editor-tool)、[网络搜索](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool)、[网页获取](/docs/zh-CN/agents-and-tools/tool-use/web-fetch-tool)、[MCP 连接器](/docs/zh-CN/agents-and-tools/mcp-connector)、[记忆](/docs/zh-CN/agents-and-tools/tool-use/memory-tool)）

### 更新您的模型名称 \{#update-your-model-name-4}

```python
# Opus 迁移
model = "claude-opus-4-6"  # Before
model = "claude-opus-4-7"  # After
```

### 破坏性变更 \{#breaking-changes}

1. **扩展思考已移除：** Claude Opus 4.7 或更高版本的模型不再支持 `thinking: {type: "enabled", budget_tokens: N}`，会返回 400 错误。请切换到[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（`thinking: {type: "adaptive"}`），并使用 [effort 参数](/docs/zh-CN/build-with-claude/effort)来控制思考深度。在 Claude Opus 4.7 上，自适应思考**默认关闭**：没有 `thinking` 字段的请求在不思考的情况下运行，与 Opus 4.6 的行为一致。显式设置 `thinking: {type: "adaptive"}` 以启用它。

    之前（Claude Opus 4.6）：

    ```python
    client.messages.create(
        model="claude-opus-4-6",
        max_tokens=16000,
        thinking={"type": "enabled", "budget_tokens": 10000},
        messages=[{"role": "user", "content": "..."}],
    )
    ```

    之后（Claude Opus 4.7）：

    ```python
    client.messages.create(
        model="claude-opus-4-7",
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},  # or "max", "xhigh", "medium", "low"
        messages=[{"role": "user", "content": "..."}],
    )
    ```

    自适应思考可通过提示进行引导。有关在模型过度思考或思考不足时进行调整的指导，请参阅[校准 effort 和思考深度](/docs/zh-CN/build-with-claude/prompt-engineering/prompting-claude-opus-4-8#calibrating-effort-and-thinking-depth)。

2. **采样参数已移除：** 在 Claude Opus 4.7 上将 `temperature`、`top_p` 或 `top_k` 设置为任何非默认值会返回 400 错误。最安全的迁移路径是从请求负载中完全省略这些参数。在 Claude Opus 4.7 上，提示是引导模型行为的推荐方式。如果您之前使用 `temperature = 0` 来获得确定性，请注意它在先前的模型上也从未保证过完全相同的输出。

3. **思考内容默认省略：** 在 Claude Opus 4.7 上，思考块仍会出现在响应流中，但除非您显式选择加入，否则其 `thinking` 字段为空。这是相对于 Claude Opus 4.6 的静默变更，后者的默认行为是返回摘要思考文本。要在 Claude Opus 4.7 上恢复摘要思考内容，请将 `thinking.display` 设置为 `"summarized"`：

    ```python
    thinking = {
        "type": "adaptive",
        "display": "summarized",
    }
    ```

    在 Claude Opus 4.7 上，默认值为 `"omitted"`。如果您的产品向用户流式传输推理过程，新的默认值会表现为输出开始前的长时间停顿；设置 `display: "summarized"` 以在思考期间恢复可见的进度。详情请参阅[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking#controlling-thinking-display)。

4. **更新的令牌计数：** Claude Opus 4.7 使用新的分词器，这有助于其在广泛任务上的性能提升。与之前的模型相比，新分词器在处理文本时可能使用大约 1 倍到 1.35 倍的令牌（最多增加约 35%，因内容而异）。

    对于 Claude Opus 4.7，[`/v1/messages/count_tokens`](/docs/zh-CN/build-with-claude/token-counting) 返回的令牌数量将与 Claude Opus 4.6 不同。令牌效率可能因工作负载形态而异。

    提示干预、`task_budget` 和 `effort` 可以帮助控制成本并确保适当的令牌使用。这些控制可能会牺牲模型智能。更新您的 `max_tokens` 参数以提供额外的余量，包括压缩触发器。Claude Opus 4.7 以标准 API 定价提供 1M 上下文窗口，无长上下文溢价。

5. **预填充移除（从 Opus 4.6 延续）：** 在 Claude Opus 4.7 上预填充助手消息会返回 400 错误。请改用[结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)、系统提示指令或 `output_config.format`。

### 选择 effort 级别 \{#choosing-an-effort-level}

[effort 参数](/docs/zh-CN/build-with-claude/effort)允许您调整 Claude 的智能与令牌消耗之间的平衡，以能力换取更快的速度和更低的成本。对于编码和智能体用例，从新的 `xhigh` effort 级别开始；对于大多数对智能敏感的用例，至少使用 `high` effort。尝试其他 effort 级别以进一步调整令牌使用和智能：

- **`max`：** 最大 effort 在某些用例中可以带来性能提升，但可能因令牌使用增加而出现收益递减。此设置有时也容易导致过度思考。针对对智能要求高的任务测试最大 effort。
- **`xhigh`（新增）：** 超高 effort 是大多数编码和智能体用例的最佳设置。
- **`high`：** 此设置平衡令牌使用和智能。对于大多数对智能敏感的用例，至少使用 `high` effort。
- **`medium`：** 适用于需要减少令牌使用同时牺牲部分智能的成本敏感用例。
- **`low`：** 保留给简短、范围明确的任务以及对智能不敏感的延迟敏感工作负载。

对于此模型，effort 比任何先前的 Opus 都更重要。升级时请积极尝试不同设置。

### 行为变更 \{#behavior-changes}

Claude Opus 4.7 与 Claude Opus 4.6 相比有几项行为差异，这些不是 API 破坏性变更，但可能需要更新提示或移除脚手架。

1. **响应长度因用例而异：** Claude Opus 4.7 会根据其判断的任务复杂度来校准响应长度，而不是默认使用固定的详细程度。这通常意味着简单查询的答案更短，而开放式分析的答案则长得多。

    如果您的产品依赖于特定的输出风格或详细程度，您可能需要调整提示。例如，要降低详细程度，可添加："提供简洁、聚焦的响应。跳过非必要的上下文，并将示例保持在最少。"如果您看到特定类型的过度解释，请在提示中添加针对性指令以防止它们。

    展示 Claude 如何以适当简洁程度进行沟通的正面示例，往往比告诉模型不要做什么的负面示例或指令更有效。

2. **更字面的指令遵循：** Claude Opus 4.7 比 Claude Opus 4.6 更字面、更明确地解释提示，尤其是在较低的 effort 级别下。它不会静默地将一个条目的指令泛化到另一个条目，也不会推断您未提出的请求。这种字面性的好处是精确性和更少的反复。对于具有精心调整的提示、结构化提取以及需要可预测行为的流水线的 API 用例，它通常表现更好。在迁移到 Claude Opus 4.7 时，对提示和框架进行审查可能特别有帮助。

3. **更直接的语气：** 与任何新模型一样，长篇写作的文体风格可能会发生变化。Claude Opus 4.7 更直接、更有主见，与 Claude Opus 4.6 更温暖的风格相比，认可性措辞更少，表情符号也更少。如果您的产品依赖于特定的语气，请根据新基准重新评估风格提示。

4. **智能体追踪中的内置进度更新：** Claude Opus 4.7 在长时间的智能体追踪过程中会向用户提供更规律、更高质量的更新。如果您添加了脚手架来强制生成中间状态消息（"每 3 次工具调用后，总结进度"），请尝试移除它。如果您发现 Claude Opus 4.7 面向用户的更新的长度或内容未能很好地适配您的用例，请在提示中明确描述这些更新应该是什么样的，并提供示例。

5. **默认生成更少的子智能体：** Claude Opus 4.7 默认倾向于生成更少的子智能体。但是，此行为可通过提示进行引导；请为 Claude Opus 4.7 提供关于何时需要子智能体的明确指导。

6. **更严格的 effort 校准：** 与 Claude Opus 4.6 相比有显著变化，Claude Opus 4.7 严格遵守 [effort 级别](/docs/zh-CN/build-with-claude/effort)，尤其是在低端。在 `low` 和 `medium` 级别下，模型会将其工作范围限定在所要求的内容，而不会超额完成。

    这对延迟和成本有利，但在以 `low` effort 运行的中等复杂任务上，存在一定的思考不足风险。如果您在复杂问题上观察到浅层推理，请将 effort 提高到 `high` 或 `xhigh`，而不是通过提示来绕过。

    如果您需要为了延迟而将 effort 保持在 `low`，请添加针对性指导："此任务涉及多步推理。在响应之前请仔细思考问题。"请参阅 [Claude Opus 4.7 的推荐 effort 级别](/docs/zh-CN/build-with-claude/effort#recommended-effort-levels-for-claude-opus-4-7)。

7. **默认更少的工具调用：** Claude Opus 4.7 倾向于比 Claude Opus 4.6 更少地使用工具，而更多地使用推理。在大多数情况下，这会产生更好的结果。

    要增加工具使用，请提高 effort 设置。`high` 或 `xhigh` effort 设置在智能体搜索和编码中显示出明显更多的工具使用。您还可以调整提示，明确指示模型何时以及如何正确使用其工具。

8. **实时网络安全防护：** Claude Opus 4.7 新增的功能，涉及禁止或高风险主题的请求可能会导致拒绝。对于合法的安全工作，如渗透测试、漏洞研究或红队测试，请申请[网络验证计划](https://claude.com/form/cyber-use-case)以请求减少限制。背景信息请参阅[防护措施、警告和申诉](https://support.claude.com/en/articles/8241253-safeguards-warnings-and-appeals)。

9. **高分辨率图像支持：** Claude Opus 4.7 是首个支持高分辨率图像的 Claude 模型。最大图像分辨率在长边上为 2576 像素，高于先前模型的 1568 像素。这为视觉密集型工作负载带来了提升，对于计算机使用、屏幕截图理解和文档分析尤其有价值。

    高分辨率支持是自动的，无需测试版标头或客户端选择加入。需要规划两件事：

    - 全分辨率图像使用的图像令牌可能比先前模型多约 3 倍（每张图像最多 4,784 个令牌，而之前的上限约为每张图像 1,600 个令牌）。请为图像密集型工作负载重新规划 `max_tokens` 和成本预期，或者如果您不需要额外的保真度，请在发送前进行降采样。
    - Claude Opus 4.7 返回的指向和边界框坐标与实际图像像素为 1\:1 对应，因此无需进行比例因子转换。

    详情请参阅 [Claude Opus 4.7 上的高分辨率图像支持](/docs/zh-CN/build-with-claude/vision#high-resolution-image-support-on-claude-opus-4-7)。

### 推荐的更改 \{#recommended-changes}

以下更改并非必需，但会改善您的使用体验：

1. **重新评估 `max_tokens`：** 由于相同的文本在 Claude Opus 4.7 上会产生更高的令牌计数，请更新您的 `max_tokens` 参数以提供额外的余量，包括压缩触发器。提示干预、[`task_budget`](/docs/zh-CN/build-with-claude/task-budgets) 和 [`effort`](/docs/zh-CN/build-with-claude/effort) 可以帮助控制成本并确保适当的令牌使用。

2. **审核令牌计数预期：** 任何在客户端估算令牌或假设固定令牌与字符比率的代码路径都应针对 Claude Opus 4.7 重新测试。使用[令牌计数端点](/docs/zh-CN/build-with-claude/token-counting)进行验证。

3. **采用[任务预算](/docs/zh-CN/build-with-claude/task-budgets)（测试版）：** Claude Opus 4.7 引入了 "task budgets"（任务预算）。这些预算让您可以告知 Claude 在完整的智能体循环中有多少令牌可用，包括思考、工具调用、工具结果和最终输出。模型会看到一个运行中的倒计时，并利用它来确定工作优先级，在预算消耗时优雅地完成任务。要使用此功能，请设置测试版标头 `task-budgets-2026-03-13`，并将以下内容添加到您的输出配置中：

    ```python
    output_config = {
        "effort": "high",
        "task_budget": {"type": "tokens", "total": 128000},
    }
    ```

    您可能需要针对您的用例尝试不同的任务预算。如果给模型的任务预算过于严格，它可能会以预算作为约束条件，不够彻底地完成任务。

    对于质量比速度更重要的开放式智能体任务，请不要设置任务预算。仅在需要模型将其工作范围限定在令牌配额内的工作负载中使用任务预算。任务预算的最小值为 20k 令牌。

    任务预算不是硬性上限；它是模型知晓的一个建议。它与 `max_tokens` 不同：

    - **`task_budget`：** 跨整个智能体循环的建议性上限。模型可以看到它并用它来调整自己的节奏。
    - **`max_tokens`：** 每个请求生成令牌的硬性上限。它不会传递给模型，因此模型不知道它的存在。

    当您希望模型自我调节时使用 `task_budget`，将 `max_tokens` 作为硬性上限来限制使用量。

4. **在 `max` 或 `xhigh` effort 下设置较大的 `max_tokens`：** 如果您在 `max` 或 `xhigh` effort 下运行 Claude Opus 4.7，请设置较大的最大输出令牌预算，以便模型在其子智能体和工具调用中有足够的空间进行思考和行动。从 64k 令牌开始，然后进行调整。

5. **如果不需要高分辨率，请对图像进行降采样：** Claude Opus 4.7 支持最大 2576px / 3.75MP 的图像。高分辨率图像会使用更多令牌。如果不需要额外的图像保真度，请在发送给 Claude 之前对图像进行降采样，以避免令牌使用量增加。请参阅[图像和视觉](/docs/zh-CN/build-with-claude/vision)。

### 迁移检查清单 \{#migration-checklist-4}

- [ ] 将模型名称从 `claude-opus-4-6` 更新为 `claude-opus-4-7`（或更新别名）。
- [ ] 从请求负载中移除 `temperature`、`top_p` 和 `top_k`。
- [ ] 将 `thinking: {type: "enabled", budget_tokens: N}` 替换为 `thinking: {type: "adaptive"}` 加上 [effort 参数](/docs/zh-CN/build-with-claude/effort)。
- [ ] 移除所有助手消息预填充。
- [ ] 如果您的 UI 显示思考内容，请显式选择启用思考摘要。
- [ ] 在更新的分词方式下重新对端到端成本和延迟进行基准测试。
- [ ] 重新调整 `max_tokens` 以适应更新的分词方式。
- [ ] 重新测试所有客户端令牌计数估算。
- [ ] 如果您的应用程序发送图像，请为[高分辨率图像支持](/docs/zh-CN/build-with-claude/vision#high-resolution-image-support-on-claude-opus-4-7)重新制定预算（每张全分辨率图像最多约增加 3 倍的图像令牌）。如果您不需要额外的保真度，请在发送前进行降采样。
- [ ] 如果您使用模型输出的指向或边界框坐标，请移除任何比例因子转换；在 Claude Opus 4.7 上，坐标与实际图像像素是 1\:1 对应的。
- [ ] 针对上述行为变化审查提示（响应长度、字面理解、语气、进度更新、子智能体、effort 校准、工具触发、网络安全防护、高分辨率图像处理）。
- [ ] 移除现有的长度控制提示后重新建立响应长度基线，然后进行显式调整。
- [ ] 如果使用 `xhigh` 或 `max` effort，将 `max_tokens` 提高到至少 64k 作为起点。
- [ ] 考虑为智能体工作流采用任务预算（测试版）。
- [ ] 如果您的产品从事合法的安全工作，请申请[网络验证计划](https://claude.com/form/cyber-use-case)以获得对网络内容较低限制的访问权限。

## 从 Opus 4.5 或更早版本迁移到 Claude Opus 4.7 \{#migrating-to-claude-opus-4-7-from-opus-4-5-or-earlier}

如果您从 Claude Opus 4.5、Opus 4.1（已弃用）或更早的模型直接迁移到 Claude Opus 4.7，请应用**上述所有 [Opus 4.7 更改](#migrating-to-claude-opus-4-7)**，以及本节中在 Opus 4.5 和 Opus 4.7 之间生效的累积更改。如果您从 Opus 4.6 迁移，则只需要[上面的 Opus 4.7 部分](#migrating-to-claude-opus-4-7)。

### 更新您的模型名称 \{#update-your-model-name-5}

```python
# Opus 迁移
model = "claude-opus-4-5"  # Before
model = "claude-opus-4-7"  # After
```

### 重大变更 \{#breaking-changes-2}

1. **预填充移除**已在上面的 [Opus 4.7 重大变更](#breaking-changes)中介绍。

2. **工具参数引号处理：** Claude Opus 4.6 及更高版本的模型在工具调用参数中可能会产生略有不同的 JSON 字符串转义（例如，对 Unicode 转义或正斜杠转义的不同处理）。如果您将工具调用的 `input` 作为原始字符串解析而不是使用 JSON 解析器，请验证您的解析逻辑。标准 JSON 解析器（如 `json.loads()` 或 `JSON.parse()`）会自动处理这些差异。

### 推荐的更改 \{#recommended-changes-2}

这些更改可改善您在 Opus 4.7 上的体验。标记为**（Opus 4.7 上必需）**的项目在 Opus 4.6 发布时是可选建议，但现在是强制性的；其余项目仍为推荐。

1. **迁移到自适应思考（Opus 4.7 上必需）：** `thinking: {type: "enabled", budget_tokens: N}` 在 Claude Opus 4.7 上会返回 400 错误。请切换到 `thinking: {type: "adaptive"}` 并使用 [effort 参数](/docs/zh-CN/build-with-claude/effort)来控制思考深度。请参阅[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)。

   <CodeGroup>
   ```bash cURL
   curl -sS https://api.anthropic.com/v1/messages \
     -H "content-type: application/json" \
     -H "x-api-key: $ANTHROPIC_API_KEY" \
     -H "anthropic-version: 2023-06-01" \
     -d '{
       "model": "claude-opus-4-7",
       "max_tokens": 16000,
       "thinking": {"type": "adaptive"},
       "output_config": {"effort": "high"},
       "messages": [{"role": "user", "content": "Your prompt here"}]
     }'
   ```

   ```python Before hidelines={1..3}
   import anthropic

   client = anthropic.Anthropic()
   response = client.beta.messages.create(
       model="claude-opus-4-5",
       max_tokens=16000,
       thinking={"type": "enabled", "budget_tokens": 32000},
       betas=["interleaved-thinking-2025-05-14"],
       messages=[{"role": "user", "content": "Your prompt here"}],
   )
   ```

   ```python After
   response = client.messages.create(
       model="claude-opus-4-7",
       max_tokens=16000,
       thinking={"type": "adaptive"},
       output_config={"effort": "high"},
       messages=[{"role": "user", "content": "Your prompt here"}],
   )
   ```

   ```bash CLI
   ant messages create <<'YAML'
   model: claude-opus-4-7
   max_tokens: 16000
   thinking:
     type: adaptive
   output_config:
     effort: high
   messages:
     - role: user
       content: Your prompt here
   YAML
   ```

   ```typescript TypeScript hidelines={1..2}
   import Anthropic from "@anthropic-ai/sdk";

   const client = new Anthropic();

   const response = await client.messages.create({
     model: "claude-opus-4-7",
     max_tokens: 16000,
     thinking: { type: "adaptive" },
     output_config: { effort: "high" },
     messages: [{ role: "user", content: "Your prompt here" }]
   });
   ```

   ```csharp C#
   using Anthropic;
   using Anthropic.Models.Messages;

   AnthropicClient client = new();

   var parameters = new MessageCreateParams
   {
       Model = Model.ClaudeOpus4_7,
       MaxTokens = 16000,
       Thinking = new ThinkingConfigAdaptive(),
       OutputConfig = new OutputConfig { Effort = Effort.High },
       Messages = [new() { Role = Role.User, Content = "Your prompt here" }]
   };

   var response = await client.Messages.Create(parameters);
   Console.WriteLine(response);
   ```

   ```go Go hidelines={1..11,-1}
   package main

   import (
   	"context"
   	"fmt"
   	"log"

   	"github.com/anthropics/anthropic-sdk-go"
   )

   func main() {
   	client := anthropic.NewClient()

   	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
   		Model:     anthropic.ModelClaudeOpus4_7,
   		MaxTokens: 16000,
   		Thinking: anthropic.ThinkingConfigParamUnion{
   			OfAdaptive: &anthropic.ThinkingConfigAdaptiveParam{},
   		},
   		OutputConfig: anthropic.OutputConfigParam{
   			Effort: anthropic.OutputConfigEffortHigh,
   		},
   		Messages: []anthropic.MessageParam{
   			anthropic.NewUserMessage(anthropic.NewTextBlock("Your prompt here")),
   		},
   	})
   	if err != nil {
   		log.Fatal(err)
   	}
   	fmt.Println(response)
   }
   ```

   ```java Java hidelines={1..5,8..10,-2..}
   import com.anthropic.client.AnthropicClient;
   import com.anthropic.client.okhttp.AnthropicOkHttpClient;
   import com.anthropic.models.messages.MessageCreateParams;
   import com.anthropic.models.messages.Message;
   import com.anthropic.models.messages.Model;
   import com.anthropic.models.messages.OutputConfig;
   import com.anthropic.models.messages.ThinkingConfigAdaptive;

   public class AdaptiveThinkingExample {
       public static void main(String[] args) {
           AnthropicClient client = AnthropicOkHttpClient.fromEnv();

           MessageCreateParams params = MessageCreateParams.builder()
               .model(Model.CLAUDE_OPUS_4_7)
               .maxTokens(16000L)
               .thinking(ThinkingConfigAdaptive.builder().build())
               .outputConfig(OutputConfig.builder()
                   .effort(OutputConfig.Effort.HIGH)
                   .build())
               .addUserMessage("Your prompt here")
               .build();

           Message response = client.messages().create(params);
           System.out.println(response);
       }
   }
   ```

   ```php PHP hidelines={1..4}
   <?php

   use Anthropic\Client;

   $client = new Client();

   $response = $client->messages->create(
       maxTokens: 16000,
       messages: [['role' => 'user', 'content' => 'Your prompt here']],
       model: 'claude-opus-4-7',
       thinking: ['type' => 'adaptive'],
       outputConfig: ['effort' => 'high'],
   );
   ```

   ```ruby Ruby hidelines={1..2}
   require "anthropic"

   client = Anthropic::Client.new

   response = client.messages.create(
     model: "claude-opus-4-7",
     max_tokens: 16000,
     thinking: { type: "adaptive" },
     output_config: { effort: "high" },
     messages: [{ role: "user", content: "Your prompt here" }]
   )
   ```
   </CodeGroup>

   请注意，此迁移还将从 `client.beta.messages.create` 迁移到 `client.messages.create`。自适应思考和 effort 是正式发布（GA）功能，不需要测试版 SDK 命名空间或任何测试版标头。

2. **移除 effort 测试版标头：** effort 参数现已正式发布。从您的请求中移除 `betas=["effort-2025-11-24"]`。

3. **移除细粒度工具流式传输测试版标头：** 细粒度工具流式传输现已正式发布。从您的请求中移除 `betas=["fine-grained-tool-streaming-2025-05-14"]`。

4. **移除交错思考测试版标头：** 自适应思考在 Claude Opus 4.7、Opus 4.6 和 Sonnet 4.6 上会自动启用交错思考。从您的请求中移除 `betas=["interleaved-thinking-2025-05-14"]`。该标头在 Sonnet 4.6 上使用手动扩展思考时仍然有效，但手动模式已弃用。

5. **迁移到 output_config.format：** 如果使用结构化输出，请将 `output_format={...}` 更新为 `output_config={"format": {...}}`。旧参数仍然有效，但已弃用，将在未来的模型版本中移除。

### 从 Claude 4.1 或更早版本迁移 \{#migrating-from-claude-4-1-or-earlier}

如果您从 Opus 4.1（已弃用）、Sonnet 4（已弃用）或更早的模型直接迁移到 Claude Opus 4.7，请应用本指南顶部的 Claude Opus 4.7 更改和上述累积更改，以及本节中的其他更改。

```python
# 来自 Opus 4.1
model = "claude-opus-4-1-20250805"  # Before
model = "claude-opus-4-7"  # After

# 来自 Sonnet 4
model = "claude-sonnet-4-20250514"  # Before
model = "claude-opus-4-7"  # After

# 来自 Sonnet 3.7
model = "claude-3-7-sonnet-20250219"  # Before
model = "claude-opus-4-7"  # After
```

#### 其他重大变更 \{#additional-breaking-changes}

1. **移除采样参数**

   <Warning>
   从 Claude 3.x 模型迁移时，这是一个重大变更。
   </Warning>

   从 Claude Opus 4.7 开始，将 `temperature`、`top_p` 或 `top_k` 设置为任何非默认值都会返回 400 错误。最安全的迁移路径是从请求中完全省略这些参数，并使用提示来引导模型的行为。如果您之前使用 `temperature = 0` 来获得确定性，请注意它从未保证过完全相同的输出。

   
   ```python Python nocheck
   # 之前 - 这在 Claude 4+ 模型中会报错
   response = client.messages.create(
       model="claude-3-7-sonnet-20250219",
       temperature=0.7,
       top_p=0.9,  # Non-default sampling params return 400 on Opus 4.7
       # ...
   )

   # 之后
   response = client.messages.create(
       model="claude-opus-4-7",
       # ...
   )
   ```

2. **更新工具版本**

   <Warning>
   从 Claude 3.x 模型迁移时，这是一个重大变更。
   </Warning>

   更新到最新的工具版本。移除所有使用 `undo_edit` 命令的代码。

   ```python
   # 之前
   tools = [{"type": "text_editor_20250124", "name": "str_replace_editor"}]

   # 之后
   tools = [{"type": "text_editor_20250728", "name": "str_replace_based_edit_tool"}]
   ```

   - **文本编辑器：** 使用 `text_editor_20250728` 和 `str_replace_based_edit_tool`。详情请参阅[文本编辑器工具文档](/docs/zh-CN/agents-and-tools/tool-use/text-editor-tool)。
   - **代码执行：** 升级到 `code_execution_20250825`。迁移说明请参阅[代码执行工具文档](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool#upgrade-to-latest-tool-version)。

3. **处理 `refusal` 停止原因**

   更新您的应用程序以[处理 `refusal` 停止原因](/docs/zh-CN/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals)：

   
   ```python Python nocheck
   response = client.messages.create(...)

   if response.stop_reason == "refusal":
       # 适当处理拒绝情况
       pass
   ```

4. **处理 `model_context_window_exceeded` 停止原因**

   当生成因达到上下文窗口限制（而非请求的 `max_tokens` 限制）而停止时，Claude 4.5+ 模型会返回 `model_context_window_exceeded` 停止原因。更新您的应用程序以处理这个新的停止原因：

   
   ```python Python nocheck
   response = client.messages.create(...)

   if response.stop_reason == "model_context_window_exceeded":
       # 适当处理上下文窗口限制
       pass
   ```

5. **验证工具参数处理（尾随换行符）**

   Claude 4.5+ 模型会保留工具调用字符串参数中之前被去除的尾随换行符。如果您的工具依赖于对工具调用参数的精确字符串匹配，请验证您的逻辑能正确处理尾随换行符。

6. **针对行为变化更新您的提示**

   Claude 4+ 模型具有更简洁、直接的沟通风格，需要明确的指示。请查看[提示最佳实践](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)以获取优化指导。

#### 其他推荐的更改 \{#additional-recommended-changes}

- **移除旧版测试版标头：** 移除 `token-efficient-tools-2025-02-19` 和 `output-128k-2025-02-19`。所有 Claude 4+ 模型都内置了令牌高效的工具使用，这些标头没有任何效果。

### 迁移检查清单（从 Opus 4.5 或更早版本） \{#migration-checklist-from-opus-4-5-or-earlier}

- [ ] 将模型 ID 更新为 `claude-opus-4-7`
- [ ] 应用所有 [Opus 4.7 重大变更](#migrating-to-claude-opus-4-7)（扩展思考已移除、采样参数已移除、思考显示默认省略、更新的分词方式）
- [ ] **重大变更：** 移除助手消息预填充（返回 400 错误）；改用结构化输出或 `output_config.format`
- [ ] **Opus 4.7 上的重大变更：** 将 `thinking: {type: "enabled", budget_tokens: N}` 替换为 `thinking: {type: "adaptive"}` 加上 [effort 参数](/docs/zh-CN/build-with-claude/effort)（在 Opus 4.7 上返回 400）
- [ ] 验证工具调用 JSON 解析使用标准 JSON 解析器
- [ ] 移除 `effort-2025-11-24` 测试版标头（effort 现已正式发布）
- [ ] 移除 `fine-grained-tool-streaming-2025-05-14` 测试版标头
- [ ] 移除 `interleaved-thinking-2025-05-14` 测试版标头（自适应思考会自动启用交错思考）
- [ ] 将 `output_format` 迁移到 `output_config.format`（如适用）
- [ ] 如果从 Claude 4.1 或更早版本迁移：移除 `temperature`、`top_p` 和 `top_k`（非默认值在 Opus 4.7 上返回 400）
- [ ] 如果从 Claude 4.1 或更早版本迁移：更新工具版本（`text_editor_20250728`、`code_execution_20250825`）
- [ ] 如果从 Claude 4.1 或更早版本迁移：处理 `refusal` 停止原因
- [ ] 如果从 Claude 4.1 或更早版本迁移：处理 `model_context_window_exceeded` 停止原因
- [ ] 如果从 Claude 4.1 或更早版本迁移：验证工具字符串参数对尾随换行符的处理
- [ ] 如果从 Claude 4.1 或更早版本迁移：移除旧版测试版标头（`token-efficient-tools-2025-02-19`、`output-128k-2025-02-19`）
- [ ] 按照[提示最佳实践](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)审查和更新提示
- [ ] 在生产部署之前在开发环境中进行测试

---

## 迁移到 Claude Sonnet 4.6 \{#migrating-to-claude-sonnet-4-6}

Claude Sonnet 4.6 将强大的智能与快速的性能相结合，具有改进的智能体搜索能力，并在与网络搜索或网络获取一起使用时提供免费的代码执行。它非常适合日常编码、分析和内容任务。

有关功能的完整概述，请参阅[模型概述](/docs/zh-CN/about-claude/models/overview)。

<Note>
Sonnet 4.6 的定价为每百万输入令牌 3 美元，每百万输出令牌 15 美元。详情请参阅 [Claude 定价](/docs/zh-CN/about-claude/pricing)。
</Note>

**更新您的模型名称：**

```python
# 来自 Sonnet 4.5
model = "claude-sonnet-4-5"  # Before
model = "claude-sonnet-4-6"  # After

# 来自 Sonnet 4
model = "claude-sonnet-4-20250514"  # Before
model = "claude-sonnet-4-6"  # After
```

### 重大变更 \{#breaking-changes-3}

#### 从 Sonnet 4.5 迁移时 \{#when-migrating-from-sonnet-4-5}

1. **不再支持预填充助手消息**

   <Warning>
   从 Sonnet 4.5 或更早版本迁移时，这是一个重大变更。
   </Warning>

   在 Sonnet 4.6 上预填充助手消息会返回 `400` 错误。请改用[结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)、系统提示指令或 `output_config.format`。

   **常见的预填充用例和迁移方法：**

   - **控制输出格式**（强制 JSON/YAML 输出）：对于分类任务，使用[结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)或带有枚举字段的工具。

   - **消除前言**（移除"以下是..."等短语）：在系统提示中添加直接指令："直接回复，不要前言。不要以'以下是...'、'基于...'等短语开头。"

   - **避免不当拒绝：** Claude 现在在适当拒绝方面做得更好。在用户消息中使用清晰的提示而无需预填充应该就足够了。

   - **续写**（恢复中断的响应）：将续写内容移至用户消息："您之前的响应被中断，结尾是 `[previous_response]`。请从中断处继续。"

   - **上下文注入 / 角色一致性**（在长对话中刷新上下文）：将之前作为预填充助手提醒的内容改为注入到用户轮次中。

2. **工具参数 JSON 转义可能不同**

   <Warning>
   从 Sonnet 4.5 或更早版本迁移时，这是一个重大变更。
   </Warning>

   工具参数中的 JSON 字符串转义可能与之前的模型不同。标准 JSON 解析器会自动处理此问题，但基于自定义字符串的解析可能需要更新。

#### 从 Claude 3.x 迁移时 \{#when-migrating-from-claude-3-x}

3. **更新采样参数**

   <Warning>
   从 Claude 3.x 模型迁移时，这是一个重大变更。
   </Warning>

   仅使用 `temperature` 或 `top_p`，不要同时使用两者。

4. **更新工具版本**

   <Warning>
   从 Claude 3.x 模型迁移时，这是一个重大变更。
   </Warning>

   更新到最新的工具版本（`text_editor_20250728`、`code_execution_20250825`）。移除所有使用 `undo_edit` 命令的代码。

5. **处理 `refusal` 停止原因**

   更新您的应用程序以[处理 `refusal` 停止原因](/docs/zh-CN/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals)。

6. **针对行为变化更新您的提示**

   Claude 4 模型具有更简洁、直接的沟通风格。请查看[提示最佳实践](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)以获取优化指导。

### 推荐的更改 \{#recommended-changes-3}

1. **移除 `fine-grained-tool-streaming-2025-05-14` 测试版标头：** 细粒度工具流式传输在 Sonnet 4.6 上现已正式发布，不再需要测试版标头。
2. **将 `output_format` 迁移到 `output_config.format`：** `output_format` 参数已弃用。请改用 `output_config.format`。

### 从 Sonnet 4.5 迁移 \{#migrating-from-sonnet-4-5}

考虑从 Sonnet 4.5 迁移到 Sonnet 4.6，后者以相同的价格提供更高的智能。

<Warning>
Sonnet 4.6 的默认 effort 级别为 `high`，而 Sonnet 4.5 没有 effort 参数。在从 Sonnet 4.5 迁移到 Sonnet 4.6 时，请考虑调整 effort 参数。如果未显式设置，您可能会在默认 effort 级别下遇到更高的延迟。
</Warning>

#### 如果您未使用扩展思考 \{#if-you-re-not-using-extended-thinking}

如果您在 Sonnet 4.5 上未使用扩展思考，您可以在 Sonnet 4.6 上继续不使用它。您应该显式将 effort 设置为适合您用例的级别。在禁用思考的 `low` effort 下，您可以期望获得与未启用扩展思考的 Sonnet 4.5 相似或更好的性能。

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-sonnet-4-6",
    "max_tokens": 8192,
    "output_config": {
        "effort": "low"
    },
    "messages": [
        {
            "role": "user",
            "content": "Your prompt here"
        }
    ]
}'
```

```bash CLI
ant messages create <<'YAML'
model: claude-sonnet-4-6
max_tokens: 8192
output_config:
  effort: low
messages:
  - role: user
    content: Your prompt here
YAML
```

```python Python
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=8192,
    output_config={"effort": "low"},
    messages=[{"role": "user", "content": "Your prompt here"}],
)
```

```typescript TypeScript
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 8192,
  output_config: { effort: "low" },
  messages: [{ role: "user", content: "Your prompt here" }]
});
```

```csharp C#
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 8192,
    OutputConfig = new OutputConfig
    {
        Effort = Effort.Low
    },
    Messages = [new() { Role = Role.User, Content = "Your prompt here" }]
};
var message = await client.Messages.Create(parameters);
Console.WriteLine(message);
```

```go Go hidelines={1..11,-1}
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.Model("claude-sonnet-4-6"),
		MaxTokens: 8192,
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortLow,
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Your prompt here")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response.Content[0].Text)
}
```

```java Java hidelines={1..5,7..9,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.OutputConfig;

public class Main {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_SONNET_4_6)
            .maxTokens(8192L)
            .outputConfig(OutputConfig.builder()
                .effort(OutputConfig.Effort.LOW)
                .build())
            .addUserMessage("Your prompt here")
            .build();

        Message response = client.messages().create(params);
        response.content().stream()
            .flatMap(block -> block.text().stream())
            .forEach(textBlock -> System.out.println(textBlock.text()));
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->messages->create(
    maxTokens: 8192,
    messages: [['role' => 'user', 'content' => 'Your prompt here']],
    model: 'claude-sonnet-4-6',
    outputConfig: ['effort' => 'low'],
);
echo $message->content[0]->text;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 8192,
  output_config: {
    effort: "low"
  },
  messages: [
    { role: "user", content: "Your prompt here" }
  ]
)
puts message.content.first.text
```
</CodeGroup>

#### 如果您正在使用扩展思考 \{#if-you-re-using-extended-thinking}

如果您在 Sonnet 4.5 上使用带有 `budget_tokens` 的扩展思考，它在 Sonnet 4.6 上仍然有效，但已弃用。请迁移到带有 [effort 参数](/docs/zh-CN/build-with-claude/effort)的[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)。

##### 迁移到自适应思考

[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)是 Sonnet 4.6 上 `budget_tokens` 的推荐替代方案。它特别适合以下工作负载模式：

- **自主多步骤智能体：** 将需求转化为可运行软件的编码智能体、数据分析管道，以及模型在多个步骤中独立运行的错误查找。自适应思考让模型能够在每个步骤中校准其推理，在更长的执行轨迹中保持正确方向。对于这些工作负载，从 `high` effort 开始。如果延迟或令牌使用是一个问题，请降低到 `medium`。
- **计算机使用智能体：** Sonnet 4.6 使用自适应模式在计算机使用评估中取得了同类最佳的准确性。
- **双峰工作负载：** 简单和困难任务的混合，自适应思考会在简单查询上跳过思考，在复杂查询上进行深入推理。

使用自适应思考时，请在您的任务上评估 `medium` 和 `high` effort。合适的级别取决于您的工作负载在质量、延迟和令牌使用之间的权衡。

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-sonnet-4-6",
    "max_tokens": 64000,
    "thinking": {
        "type": "adaptive"
    },
    "output_config": {
        "effort": "medium"
    },
    "messages": [
        {
            "role": "user",
            "content": "Your prompt here"
        }
    ]
}'
```

```bash CLI nocheck
ant messages create <<'YAML'
model: claude-sonnet-4-6
max_tokens: 64000
thinking:
  type: adaptive
output_config:
  effort: medium
messages:
  - role: user
    content: Your prompt here
YAML
```

```python Python nocheck
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=64000,
    thinking={"type": "adaptive"},
    output_config={"effort": "medium"},
    messages=[{"role": "user", "content": "Your prompt here"}],
)
```

```typescript TypeScript nocheck
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 64000,
  thinking: { type: "adaptive" },
  output_config: { effort: "medium" },
  messages: [{ role: "user", content: "Your prompt here" }]
});
```

```csharp C# nocheck
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 64000,
    Thinking = new ThinkingConfigAdaptive(),
    OutputConfig = new OutputConfig { Effort = Effort.Medium },
    Messages = [new() { Role = Role.User, Content = "Your prompt here" }]
};

var message = await client.Messages.Create(parameters);
Console.WriteLine(message);
```

```go Go nocheck hidelines={1..11,-1}
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     "claude-sonnet-4-6",
		MaxTokens: 64000,
		Thinking: anthropic.ThinkingConfigParamUnion{
			OfAdaptive: &anthropic.ThinkingConfigAdaptiveParam{},
		},
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortMedium,
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Your prompt here")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java nocheck hidelines={1..5,8..10,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.OutputConfig;
import com.anthropic.models.messages.ThinkingConfigAdaptive;

public class Main {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_SONNET_4_6)
            .maxTokens(64000L)
            .thinking(ThinkingConfigAdaptive.builder().build())
            .outputConfig(OutputConfig.builder()
                .effort(OutputConfig.Effort.MEDIUM)
                .build())
            .addUserMessage("Your prompt here")
            .build();

        Message response = client.messages().create(params);
        System.out.println(response);
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->messages->create(
    maxTokens: 64000,
    messages: [['role' => 'user', 'content' => 'Your prompt here']],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'adaptive'],
    outputConfig: ['effort' => 'medium'],
);

echo array_find($message->content, fn($block) => $block->type === 'text')->text;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 64000,
  thinking: {
    type: "adaptive"
  },
  output_config: {
    effort: "medium"
  },
  messages: [
    { role: "user", content: "Your prompt here" }
  ]
)
puts message.content.find { |block| block.type == :text }.text
```
</CodeGroup>

<Note>
如果您在使用自适应思考时发现行为不一致或质量下降，请先尝试降低 [effort](/docs/zh-CN/build-with-claude/effort) 设置或使用 `max_tokens` 作为硬性限制。带有 `budget_tokens` 的扩展思考在 Sonnet 4.6 上仍然有效，但已弃用且不再推荐。
</Note>

##### 在迁移期间保留 budget_tokens

如果您在迁移期间需要暂时保留 `budget_tokens`，约 16k 令牌的预算可以为较难的问题提供余量，而不会有令牌使用失控的风险。此配置已弃用，将在未来的模型版本中移除。

###### 编码和智能体用例

对于智能体编码、前端设计、工具密集型工作流和复杂的企业工作流，从 `medium` effort 开始。如果您发现延迟过高，请考虑将 effort 降低到 `low`。如果您需要更高的智能，请考虑将 effort 提高到 `high` 或迁移到 Opus 4.7。

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "anthropic-beta: interleaved-thinking-2025-05-14" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-sonnet-4-6",
    "max_tokens": 16384,
    "thinking": {
        "type": "enabled",
        "budget_tokens": 16384
    },
    "output_config": {
        "effort": "medium"
    },
    "messages": [
        {
            "role": "user",
            "content": "Your prompt here"
        }
    ]
}'
```

```bash CLI
ant beta:messages create --beta interleaved-thinking-2025-05-14 <<'YAML'
model: claude-sonnet-4-6
max_tokens: 16384
thinking:
  type: enabled
  budget_tokens: 16384
output_config:
  effort: medium
messages:
  - role: user
    content: Your prompt here
YAML
```

```python Python
response = client.beta.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16384,
    thinking={"type": "enabled", "budget_tokens": 16384},
    output_config={"effort": "medium"},
    betas=["interleaved-thinking-2025-05-14"],
    messages=[{"role": "user", "content": "Your prompt here"}],
)
```

```typescript TypeScript
const response = await client.beta.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 16384,
  thinking: { type: "enabled", budget_tokens: 16384 },
  output_config: { effort: "medium" },
  betas: ["interleaved-thinking-2025-05-14"],
  messages: [{ role: "user", content: "Your prompt here" }]
});
```

```csharp C#
using Anthropic;
using Anthropic.Models.Beta;
using Anthropic.Models.Beta.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = "claude-sonnet-4-6",
    MaxTokens = 16384,
    Thinking = new BetaThinkingConfigEnabled { BudgetTokens = 16384 },
    OutputConfig = new BetaOutputConfig
    {
        Effort = Effort.Medium
    },
    Betas = [AnthropicBeta.InterleavedThinking2025_05_14],
    Messages = [new() { Role = Role.User, Content = "Your prompt here" }]
};

var message = await client.Beta.Messages.Create(parameters);
Console.WriteLine(message);
```

```go Go hidelines={1..11,-1}
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-sonnet-4-6",
		MaxTokens: 16384,
		Thinking:  anthropic.BetaThinkingConfigParamOfEnabled(16384),
		OutputConfig: anthropic.BetaOutputConfigParam{
			Effort: anthropic.BetaOutputConfigEffortMedium,
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Your prompt here")),
		},
		Betas: []anthropic.AnthropicBeta{anthropic.AnthropicBetaInterleavedThinking2025_05_14},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..6,9..11,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.messages.Model;
import com.anthropic.models.beta.AnthropicBeta;
import com.anthropic.models.beta.messages.BetaThinkingConfigEnabled;
import com.anthropic.models.beta.messages.BetaOutputConfig;

public class Main {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_SONNET_4_6)
            .maxTokens(16384L)
            .thinking(BetaThinkingConfigEnabled.builder()
                .budgetTokens(16384L)
                .build())
            .outputConfig(BetaOutputConfig.builder()
                .effort(BetaOutputConfig.Effort.MEDIUM)
                .build())
            .addBeta(AnthropicBeta.INTERLEAVED_THINKING_2025_05_14)
            .addUserMessage("Your prompt here")
            .build();

        BetaMessage response = client.beta().messages().create(params);
        System.out.println(response);
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->beta->messages->create(
    maxTokens: 16384,
    messages: [['role' => 'user', 'content' => 'Your prompt here']],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'enabled', 'budget_tokens' => 16384],
    outputConfig: ['effort' => 'medium'],
    betas: ['interleaved-thinking-2025-05-14'],
);

echo array_find($message->content, fn($block) => $block->type === 'text')->text;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.beta.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 16384,
  thinking: {
    type: "enabled",
    budget_tokens: 16384
  },
  output_config: {
    effort: "medium"
  },
  betas: ["interleaved-thinking-2025-05-14"],
  messages: [
    { role: "user", content: "Your prompt here" }
  ]
)
puts message.content.find { |block| block.type == :text }.text
```
</CodeGroup>

###### 聊天和非编码用例

对于聊天、内容生成、搜索、分类和其他非编码任务，从带有扩展思考的 `low` effort 开始。如果您需要更多深度，请将 effort 提高到 `medium`。

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "anthropic-beta: interleaved-thinking-2025-05-14" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-sonnet-4-6",
    "max_tokens": 8192,
    "thinking": {
        "type": "enabled",
        "budget_tokens": 16384
    },
    "output_config": {
        "effort": "low"
    },
    "messages": [
        {
            "role": "user",
            "content": "Your prompt here"
        }
    ]
}'
```

```bash CLI
ant beta:messages create --beta interleaved-thinking-2025-05-14 <<'YAML'
model: claude-sonnet-4-6
max_tokens: 8192
thinking:
  type: enabled
  budget_tokens: 16384
output_config:
  effort: low
messages:
  - role: user
    content: Your prompt here
YAML
```

```python Python
response = client.beta.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=8192,
    thinking={"type": "enabled", "budget_tokens": 16384},
    output_config={"effort": "low"},
    betas=["interleaved-thinking-2025-05-14"],
    messages=[{"role": "user", "content": "Your prompt here"}],
)
```

```typescript TypeScript
const response = await client.beta.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 8192,
  thinking: { type: "enabled", budget_tokens: 16384 },
  output_config: { effort: "low" },
  betas: ["interleaved-thinking-2025-05-14"],
  messages: [{ role: "user", content: "Your prompt here" }]
});
```

```csharp C#
using Anthropic;
using Anthropic.Models.Beta;
using Anthropic.Models.Beta.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = "claude-sonnet-4-6",
    MaxTokens = 8192,
    Thinking = new BetaThinkingConfigEnabled { BudgetTokens = 16384 },
    OutputConfig = new BetaOutputConfig
    {
        Effort = Effort.Low
    },
    Betas = [AnthropicBeta.InterleavedThinking2025_05_14],
    Messages = [new() { Role = Role.User, Content = "Your prompt here" }]
};

var message = await client.Beta.Messages.Create(parameters);
Console.WriteLine(message);
```

```go Go hidelines={1..11,-1}
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-sonnet-4-6",
		MaxTokens: 8192,
		Thinking:  anthropic.BetaThinkingConfigParamOfEnabled(16384),
		OutputConfig: anthropic.BetaOutputConfigParam{
			Effort: anthropic.BetaOutputConfigEffortLow,
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Your prompt here")),
		},
		Betas: []anthropic.AnthropicBeta{anthropic.AnthropicBetaInterleavedThinking2025_05_14},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..6,9..11,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.messages.Model;
import com.anthropic.models.beta.AnthropicBeta;
import com.anthropic.models.beta.messages.BetaThinkingConfigEnabled;
import com.anthropic.models.beta.messages.BetaOutputConfig;

public class Main {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_SONNET_4_6)
            .maxTokens(8192L)
            .thinking(BetaThinkingConfigEnabled.builder()
                .budgetTokens(16384L)
                .build())
            .outputConfig(BetaOutputConfig.builder()
                .effort(BetaOutputConfig.Effort.LOW)
                .build())
            .addBeta(AnthropicBeta.INTERLEAVED_THINKING_2025_05_14)
            .addUserMessage("Your prompt here")
            .build();

        BetaMessage response = client.beta().messages().create(params);
        System.out.println(response);
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->beta->messages->create(
    maxTokens: 8192,
    messages: [['role' => 'user', 'content' => 'Your prompt here']],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'enabled', 'budget_tokens' => 16384],
    outputConfig: ['effort' => 'low'],
    betas: ['interleaved-thinking-2025-05-14'],
);

echo array_find($message->content, fn($block) => $block->type === 'text')->text;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.beta.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 8192,
  thinking: {
    type: "enabled",
    budget_tokens: 16384
  },
  output_config: {
    effort: "low"
  },
  betas: ["interleaved-thinking-2025-05-14"],
  messages: [
    { role: "user", content: "Your prompt here" }
  ]
)
puts message.content.find { |block| block.type == :text }.text
```
</CodeGroup>

### Sonnet 4.6 迁移检查清单 \{#sonnet-4-6-migration-checklist}

- [ ] 将模型 ID 更新为 `claude-sonnet-4-6`
- [ ] **重大变更：** 移除助手消息预填充；改用结构化输出或 `output_config.format`
- [ ] **重大变更：** 验证工具参数 JSON 解析能处理转义差异
- [ ] **重大变更：** 将工具版本更新到最新（`text_editor_20250728`、`code_execution_20250825`）；不支持旧版本（如果从 3.x 迁移）
- [ ] **重大变更：** 移除所有使用 `undo_edit` 命令的代码（如适用）
- [ ] **重大变更：** 更新采样参数，仅使用 `temperature` 或 `top_p`，不要同时使用两者（如果从 3.x 迁移）
- [ ] 在您的应用程序中处理新的 `refusal` 停止原因
- [ ] 移除 `fine-grained-tool-streaming-2025-05-14` 测试版标头（现已正式发布）
- [ ] 将 `output_format` 迁移到 `output_config.format`
- [ ] 按照[提示最佳实践](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)审查和更新提示
- [ ] **推荐：** 从 `thinking: {type: "enabled", budget_tokens: N}` 迁移到带有 [effort 参数](/docs/zh-CN/build-with-claude/effort)的 `thinking: {type: "adaptive"}`（`budget_tokens` 已弃用，将在未来版本中移除）
- [ ] 在生产部署之前在开发环境中进行测试

---

## 迁移到 Claude Sonnet 4.5 \{#migrating-to-claude-sonnet-4-5}

Claude Sonnet 4.5 将强大的智能与快速的性能相结合，非常适合日常编码、分析和内容任务。

有关功能的完整概述，请参阅[模型概述](/docs/zh-CN/about-claude/models/overview)。

<Note>
Sonnet 4.5 的定价为每百万输入令牌 3 美元，每百万输出令牌 15 美元。详情请参阅 [Claude 定价](/docs/zh-CN/about-claude/pricing)。
</Note>

**更新您的模型名称：**

```python
# 来自 Sonnet 4
model = "claude-sonnet-4-20250514"  # Before
model = "claude-sonnet-4-5-20250929"  # After

# 来自 Sonnet 3.7
model = "claude-3-7-sonnet-20250219"  # Before
model = "claude-sonnet-4-5-20250929"  # After
```

### 重大变更 \{#breaking-changes-4}

这些重大变更适用于从 Claude 3.x Sonnet 模型迁移的情况。

1. **更新采样参数**

   <Warning>
   从 Claude 3.x 模型迁移时，这是一个重大变更。
   </Warning>

   仅使用 `temperature` 或 `top_p`，不要同时使用两者。

2. **更新工具版本**

   <Warning>
   从 Claude 3.x 模型迁移时，这是一个重大变更。
   </Warning>

   更新到最新的工具版本（`text_editor_20250728`、`code_execution_20250825`）。移除所有使用 `undo_edit` 命令的代码。

3. **处理 `refusal` 停止原因**

   更新您的应用程序以[处理 `refusal` 停止原因](/docs/zh-CN/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals)。

4. **针对行为变化更新您的提示**

   Claude 4 模型具有更简洁、直接的沟通风格。请查看[提示最佳实践](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)以获取优化指导。

### Sonnet 4.5 迁移检查清单 \{#sonnet-4-5-migration-checklist}

- [ ] 将模型 ID 更新为 `claude-sonnet-4-5-20250929`
- [ ] **重大变更：** 将工具版本更新到最新（`text_editor_20250728`、`code_execution_20250825`）；不支持旧版本（如果从 3.x 迁移）
- [ ] **重大变更：** 移除所有使用 `undo_edit` 命令的代码（如适用）
- [ ] **重大变更：** 更新采样参数，仅使用 `temperature` 或 `top_p`，不要同时使用两者（如果从 3.x 迁移）
- [ ] 在您的应用程序中处理新的 `refusal` 停止原因
- [ ] 按照[提示最佳实践](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)审查和更新提示
- [ ] 考虑为复杂推理任务启用扩展思考
- [ ] 在生产部署之前在开发环境中进行测试

---

## 迁移到 Claude Haiku 4.5 \{#migrating-to-claude-haiku-4-5}

Claude Haiku 4.5 是最快、最智能的 Haiku 模型，具有接近前沿的性能，为交互式应用程序和大批量处理提供优质的模型质量。

有关功能的完整概述，请参阅[模型概述](/docs/zh-CN/about-claude/models/overview)。

<Note>
Haiku 4.5 的定价为每百万输入令牌 1 美元，每百万输出令牌 5 美元。详情请参阅 [Claude 定价](/docs/zh-CN/about-claude/pricing)。
</Note>

**更新您的模型名称：**

```python
# 来自 Haiku 3.5
model = "claude-3-5-haiku-20241022"  # Before
model = "claude-haiku-4-5-20251001"  # After
```

**查看新的速率限制：** Haiku 4.5 的速率限制与 Haiku 3.5 是分开的。详情请参阅[速率限制文档](/docs/zh-CN/api/rate-limits)。

<Tip>
为了在编码和推理任务上获得显著的性能提升，请考虑使用 `thinking: {type: "enabled", budget_tokens: N}` 启用扩展思考。
</Tip>

<Note>
扩展思考会影响[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching#caching-with-thinking-blocks)的效率。

扩展思考在 Claude 4.6 模型中已弃用，并在 Claude Opus 4.7 中移除。如果使用较新的模型，请改用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)。
</Note>

**探索新功能：** 有关上下文感知、增加的输出容量（64k 令牌）、更高的智能和改进的速度的详细信息，请参阅[模型概述](/docs/zh-CN/about-claude/models/overview)。

### 重大变更 \{#breaking-changes-5}

这些重大变更适用于从 Claude 3.x Haiku 模型迁移的情况。

1. **更新采样参数**

   <Warning>
   从 Claude 3.x 模型迁移时，这是一个重大变更。
   </Warning>

   仅使用 `temperature` 或 `top_p`，不要同时使用两者。

2. **更新工具版本**

   <Warning>
   从 Claude 3.x 模型迁移时，这是一个重大变更。
   </Warning>

   更新到最新的工具版本（`text_editor_20250728`、`code_execution_20250825`）。移除所有使用 `undo_edit` 命令的代码。

3. **处理 `refusal` 停止原因**

   更新您的应用程序以[处理 `refusal` 停止原因](/docs/zh-CN/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals)。

4. **针对行为变化更新您的提示**

   Claude 4 模型具有更简洁、直接的沟通风格。请查看[提示最佳实践](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)以获取优化指导。

### Haiku 4.5 迁移检查清单 \{#haiku-4-5-migration-checklist}

- [ ] 将模型 ID 更新为 `claude-haiku-4-5-20251001`
- [ ] **重大变更：** 将工具版本更新到最新（`text_editor_20250728`、`code_execution_20250825`）；不支持旧版本
- [ ] **重大变更：** 移除所有使用 `undo_edit` 命令的代码（如适用）
- [ ] **重大变更：** 更新采样参数，仅使用 `temperature` 或 `top_p`，不要同时使用两者
- [ ] 在您的应用程序中处理新的 `refusal` 停止原因
- [ ] 审查并调整新的速率限制（与 Haiku 3.5 分开）
- [ ] 按照[提示最佳实践](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)审查和更新提示
- [ ] 考虑为复杂推理任务启用扩展思考
- [ ] 在生产部署之前在开发环境中进行测试

---

## 获取帮助 \{#get-help}

- 查看 [API 文档](/docs/zh-CN/api/overview)以获取详细规范
- 查看[模型功能](/docs/zh-CN/about-claude/models/overview)以进行性能比较
- 查看 [API 发布说明](/docs/zh-CN/release-notes/api)以了解 API 更新
- 如果您在迁移过程中遇到任何问题，请联系支持团队