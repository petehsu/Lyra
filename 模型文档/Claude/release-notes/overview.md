# Claude Platform

Claude Platform 的更新，包括 Claude API、客户端 SDK 和 Claude Console。

---

<Tip>
有关 Claude 应用的发布说明，请参阅 [Claude 帮助中心的 Claude 应用发布说明](https://support.claude.com/en/articles/12138966-release-notes)。

有关 Claude Code 的更新，请参阅 `claude-code` 代码仓库中的[完整 CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)。
</Tip>

### 2026 年 6 月 10 日 \{#june-10-2026}
- 用于列出[自托管沙箱](/docs/zh-CN/managed-agents/self-hosted-sandboxes)待处理工作的 `GET /v1/environments/{id}/work` 端点现已在 [Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 上可用。有关授权该端点的 `GetEnvironment` 操作，请参阅 [Claude Platform on AWS 的 IAM 操作](/docs/zh-CN/api/claude-platform-on-aws-iam-actions)。

### 2026 年 6 月 9 日 \{#june-9-2026}
- 我们发布了 **Claude Fable 5**（`claude-fable-5`），这是我们能力最强的广泛发布模型，同时为 Project Glasswing 参与者发布了 **Claude Mythos 5**（`claude-mythos-5`）。两个模型均默认支持 [100 万令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)、128k 最大输出令牌，以及始终开启的[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)。有关功能、API 变更和可用性，请参阅 [Claude Fable 5 和 Claude Mythos 5 介绍](/docs/zh-CN/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5)。
- Claude Fable 5 和 Claude Mythos 5 使用随 Claude Opus 4.7 引入的分词器。与 Claude Opus 4.7 之前的模型相比，相同的文本会产生大约多 30% 的令牌。请使用[令牌计数 API](/docs/zh-CN/build-with-claude/token-counting#token-counts-on-claude-fable-5) 并设置 `model: "claude-fable-5"`，以在新分词器下测量您的提示。
- Claude Fable 5 会在请求时和响应生成期间运行安全分类器。当分类器拒绝请求时，Messages API 会返回 `stop_reason: "refusal"`。如果请求在生成任何输出之前被拒绝，您不会被计费。可选启用的 `fallbacks` 参数（在 Claude API 和 Claude Platform on AWS 上处于测试阶段；Message Batches API 不支持）会在另一个模型上重新运行被拒绝的请求，并按回退模型的费率计费。请参阅[处理停止原因](/docs/zh-CN/build-with-claude/handling-stop-reasons)。
- 拒绝响应中的 [`stop_details.category`](/docs/zh-CN/build-with-claude/refusals-and-fallback#refusal-response) 字段现在在 Claude Fable 5 上包含 `"reasoning_extraction"`，当请求因违反 Anthropic 服务条款中关于逆向工程或复制模型输出的限制而被阻止时返回。现有的 `"cyber"` 和 `"bio"` 类别保持不变。无需测试版标头。
- 在 Claude Fable 5 和 Claude Mythos 5 上，[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)是唯一的思考模式：不支持 `thinking: {"type": "disabled"}`，也不支持手动扩展思考预算和助手预填充（两者均返回 400 错误）。请参阅[从 Claude Mythos Preview 迁移到 Claude Mythos 5](/docs/zh-CN/about-claude/models/migration-guide#migrating-from-claude-mythos-preview)。
- 在 Claude Fable 5 和 Claude Mythos 5 上，`thinking.display` 默认为 `"omitted"`，与 Claude Opus 4.8、Claude Opus 4.7 和 Claude Mythos Preview 相同；设置 `display: "summarized"` 可接收可读的思考摘要。原始思维链永远不会返回；在同一模型的多轮对话中，请原样传回思考块。请参阅 [Claude Fable 5 和 Claude Mythos 5 上的思考输出](/docs/zh-CN/build-with-claude/adaptive-thinking#thinking-output-on-claude-fable-5-and-claude-mythos-5)。
- Claude Fable 5 在 Claude API 上需要 30 天数据保留，在零数据保留下不可用。请参阅[特定模型的数据保留要求](/docs/zh-CN/manage-claude/api-and-data-retention#model-specific-data-retention-requirements)。
- Claude Managed Agents 现在支持[计划部署](/docs/zh-CN/managed-agents/scheduled-deployments)，让您可以按 cron 计划运行会话，而无需管理自己的调度器。
- Claude Managed Agents 保管库现在支持[环境变量凭据](/docs/zh-CN/managed-agents/vaults#add-a-credential)，因此您可以安全地将密钥注入代理的沙箱中，供通过环境变量进行身份验证的 CLI、SDK 和其他服务使用。
- `session.thread_*` webhook 事件现在包含一个 `session_thread_id` 字段，用于标识触发该事件的多代理线程。

### 2026 年 6 月 5 日 \{#june-5-2026}
- 我们宣布弃用 Claude Opus 4.1 模型（`claude-opus-4-1-20250805`），计划于 2026 年 8 月 5 日在 Claude API 上停用。我们建议迁移到 [Claude Opus 4.8](/docs/zh-CN/about-claude/models/migration-guide#migrating-from-claude-opus-47)。更多信息请参阅[模型弃用](/docs/zh-CN/about-claude/model-deprecations)。

### 2026 年 6 月 2 日 \{#june-2-2026}
- [顾问工具](/docs/zh-CN/agents-and-tools/tool-use/advisor-tool)现在支持 `max_tokens` 参数，用于限制顾问模型每次调用的输出，从而为不需要完整长度顾问响应的工作负载降低延迟和输出令牌成本。在顾问工具定义中设置 `tools[].max_tokens`；请参阅[限制顾问输出](/docs/zh-CN/agents-and-tools/tool-use/advisor-tool#capping-advisor-output)。
- 在 Claude API 上，当请求返回 `stop_reason: "refusal"` 且 Claude 未生成任何输出时，您将不再被计费。有关检测和处理拒绝的信息，请参阅[流式传输拒绝](/docs/zh-CN/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals)。

### 2026 年 5 月 29 日 \{#may-29-2026}
- Claude Managed Agents 的 [webhook](/docs/zh-CN/managed-agents/webhooks)、[多代理编排](/docs/zh-CN/managed-agents/multi-agent)和[自托管沙箱](/docs/zh-CN/managed-agents/self-hosted-sandboxes)现已在 [Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 上可用。有关新的 IAM 操作和 `AnthropicSelfHostedEnvironmentAccess` 托管策略，请参阅 [Claude Platform on AWS 的 IAM 操作](/docs/zh-CN/api/claude-platform-on-aws-iam-actions)。

### 2026 年 5 月 28 日 \{#may-28-2026}
- 我们发布了 **Claude Opus 4.8**（claude-opus-4-8），这是我们能力最强的正式发布模型。Claude Opus 4.8 在 Claude API、Amazon Bedrock 和 Vertex AI 上默认支持 [100 万令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)（在 Microsoft Foundry 上为 200k）、128k 最大输出令牌，以及与 Claude Opus 4.7 相同的工具集和平台功能。有关能力改进、新功能和迁移指南，请参阅 [Claude Opus 4.8 的新功能](/docs/zh-CN/about-claude/models/whats-new-claude-4-8)。
- 我们发布了[对话中系统消息](/docs/zh-CN/build-with-claude/mid-conversation-system-messages)。在 Claude Opus 4.8 上，您可以在 `messages` 数组中的用户轮次之后发送 `role: "system"` 消息（需遵守[放置规则](/docs/zh-CN/build-with-claude/mid-conversation-system-messages#limitations)），从而在长时间运行的会话中指令发生变化时保留提示缓存命中。无需测试版标头。
- 拒绝响应中的 [`stop_details`](/docs/zh-CN/build-with-claude/refusals-and-fallback#refusal-response) 字段现已公开记录；它返回一个 `category`（`cyber`、`bio` 或 `null`）和一个人类可读的 `explanation`，以便您的应用程序可以将不同类别的拒绝路由到正确的后续步骤。无需测试版标头。
- 在 Claude Opus 4.8 上，[effort 参数](/docs/zh-CN/build-with-claude/effort)在所有界面（包括 Claude Code 和 Messages API）上默认为 `high`。
- 在 Claude Opus 4.8 上，[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)的最小可缓存提示长度为 1,024 个令牌，低于 Claude Opus 4.7。
- 启用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)后，Claude Opus 4.8 仅在某个轮次需要时才触发推理，与相同 effort 级别下的 Claude Opus 4.7 相比，减少了浪费的思考令牌。
- Claude Opus 4.8 支持[高分辨率图像输入](/docs/zh-CN/build-with-claude/vision#high-resolution-image-support-on-claude-opus-4-7)（长边最高 2576 像素），与 Claude Opus 4.7 相同。
- [任务预算](/docs/zh-CN/build-with-claude/task-budgets)现在支持 Claude Opus 4.8。
- [顾问工具](/docs/zh-CN/agents-and-tools/tool-use/advisor-tool)现在支持 Claude Opus 4.8。
- [计算机使用](/docs/zh-CN/agents-and-tools/tool-use/computer-use-tool)现在支持 Claude Opus 4.8。
- Claude Opus 4.8 的[快速模式](/docs/zh-CN/build-with-claude/fast-mode)仅在 Claude API 上作为研究预览版提供。
- 在 Claude Opus 4.8 上，将采样参数 `temperature`、`top_p` 或 `top_k` 设置为非默认值会返回 400 错误，与 Claude Opus 4.7 相同。详情请参阅[迁移指南](/docs/zh-CN/about-claude/models/migration-guide)。
- 在 Claude Code 中，我们已将 Auto 模式扩展到更多用户，用于长时间运行的任务。请参阅 [Claude Code 文档](https://code.claude.com/docs)。
- 在 Claude Code 中，Max 套餐用户现在在 Claude Opus 4.8 上默认使用[快速模式](/docs/zh-CN/build-with-claude/fast-mode)。请参阅 [Claude Code 文档](https://code.claude.com/docs)。
- 在 Claude Code 中，Workflows 作为研究预览版提供，让您可以定义和运行多步骤代理计划。请参阅 [Claude Code 文档](https://code.claude.com/docs)。
- 我们已弃用 Claude Opus 4.6 的[快速模式](/docs/zh-CN/build-with-claude/fast-mode)，将在发布后约 30 天移除。请迁移到 Claude Opus 4.8 或 Claude Opus 4.7 的快速模式。更多信息请参阅[快速模式](/docs/zh-CN/build-with-claude/fast-mode#supported-models)。
- 有关本次发布中 claude.ai、Cowork、Claude for Microsoft 365 和其他 Claude 应用的更新，请参阅 [Claude 应用发布说明](https://support.claude.com/en/articles/12138966-release-notes)。

### 2026 年 5 月 27 日 \{#may-27-2026}
- Messages API 响应现在包含 [`usage.output_tokens_details.thinking_tokens`](/docs/zh-CN/build-with-claude/extended-thinking#working-with-thinking-budgets)，报告计费输出令牌中有多少是扩展思考令牌。在流式传输时，该细分仅出现在最终的 `message_delta` 事件中。无需测试版标头。

### 2026 年 5 月 19 日 \{#may-19-2026}
- [MCP 隧道](/docs/zh-CN/agents-and-tools/mcp-tunnels/overview)现已作为研究预览版提供，让您可以连接到私有网络中的 MCP 服务器。
- 自托管沙箱现已可用于 Claude Managed Agents，作为在 Anthropic 基础设施中运行工具执行的替代方案。请参阅[自托管沙箱](/docs/zh-CN/managed-agents/self-hosted-sandboxes)。
- 使用 Claude Managed Agents 时，您现在可以更新与活动会话关联的代理 MCP 服务器和工具配置。
- 使用 Claude Managed Agents 时，来自 `agent_toolset` 和 MCP 工具的超过 10 万令牌的大型输出现在会自动溢出到沙箱中的文件。模型会收到带有文件路径的截断预览，并可以从该路径读取完整内容。

### 2026 年 5 月 18 日 \{#may-18-2026}
- [网络搜索工具](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool)现在返回更丰富的 SEC 备案数据，使金融研究代理、财报分析和尽职调查工作流程更容易基于带引用的原始来源。

### 2026 年 5 月 13 日 \{#may-13-2026}
- 我们已在公开测试版中发布[缓存诊断](/docs/zh-CN/build-with-claude/cache-diagnostics)。在 Messages 请求中传递 `diagnostics.previous_message_id`，API 会报告一个 `cache_miss_reason`，解释提示缓存前缀在何处与上一轮次发生偏离。请在您的请求中包含 `cache-diagnosis-2026-04-07` 测试版标头。

### 2026 年 5 月 12 日 \{#may-12-2026}
- [快速模式](/docs/zh-CN/build-with-claude/fast-mode)（研究预览版）现在支持 Claude Opus 4.7。设置 `speed: "fast"` 和 `model: "claude-opus-4-7"` 并使用 `fast-mode-2026-02-01` 测试版标头，即可以高级定价获得显著更快的输出令牌生成速度。定价、速率限制和访问权限与 Opus 4.6 快速模式相同；感兴趣的客户请加入[候补名单](https://claude.com/fast-mode)。

### 2026 年 5 月 11 日 \{#may-11-2026}
- 我们发布了 **Claude Platform on AWS**，将 Claude API 引入可通过 AWS 访问的 Anthropic 托管基础设施，并使用 AWS 计费和 IAM 身份验证。通过原生 AWS 端点访问完整的 Messages API、Files API、Message Batches API、Claude Managed Agents、Agent Skills、代码执行和工具使用。更多信息请参阅 [Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws)。

### 2026 年 5 月 6 日 \{#may-6-2026}
- [多代理会话](/docs/zh-CN/managed-agents/multi-agent)和 [Outcomes](/docs/zh-CN/managed-agents/define-outcomes) 现已在标准 `managed-agents-2026-04-01` 测试版标头下进入公开测试版。
- Claude Managed Agents 保管库凭据后台刷新现在支持 `mcp_oauth` 凭据。请参阅[使用保管库进行身份验证](/docs/zh-CN/managed-agents/vaults)。
- 现在支持 Claude Managed Agents 的 Webhook。Webhook 事件类型包括会话和保管库生命周期事件。请参阅[订阅 webhook](/docs/zh-CN/managed-agents/webhooks)。
- Claude Managed Agents 现在支持更多筛选和排序选项。会话可以按状态筛选，事件可以按类型筛选。事件现在可以按创建时间筛选。

### 2026 年 4 月 30 日 \{#april-30-2026}
- 我们已停用 Claude Sonnet 4.5 和 Claude Sonnet 4 的 100 万令牌上下文窗口测试版（`context-1m-2025-08-07`）。该测试版标头现在对这些模型不再有任何效果，超过标准 200k 令牌上下文窗口的请求将返回错误。要使用 100 万上下文窗口，请迁移到 [Claude Sonnet 4.6](/docs/zh-CN/about-claude/models/overview#latest-models-comparison) 或 [Claude Opus 4.6](/docs/zh-CN/about-claude/models/overview#latest-models-comparison)，这些模型以标准定价正式提供该功能，无需测试版标头。

### 2026 年 4 月 24 日 \{#april-24-2026}
- 我们发布了[速率限制 API](/docs/zh-CN/manage-claude/rate-limits-api)，允许管理员以编程方式查询为其组织和工作区配置的速率限制。

### 2026 年 4 月 23 日 \{#april-23-2026}
- Claude Managed Agents 的内存功能现已在标准 `managed-agents-2026-04-01` 标头下进入公开测试版。有关完整的集成指南，请参阅[使用代理内存](/docs/zh-CN/managed-agents/memory)。

### 2026 年 4 月 20 日 \{#april-20-2026}
- 我们已停用 Claude Haiku 3 模型（`claude-3-haiku-20240307`）。对该模型的所有请求现在将返回错误。我们建议升级到 [Claude Haiku 4.5](/docs/zh-CN/about-claude/models/overview#latest-models-comparison)。

### 2026 年 4 月 16 日 \{#april-16-2026}
- 我们发布了 [Claude Opus 4.7](https://www.anthropic.com/news/claude-opus-4-7)，这是我们用于复杂推理和代理编码的能力最强的正式发布模型，定价与 Opus 4.6 相同，为每百万令牌 $5 / $25。有关能力改进、新功能和更新的分词器，请参阅 [Claude Opus 4.7 的新功能](/docs/zh-CN/about-claude/models/whats-new-claude-4-7)。Opus 4.7 相对于 Opus 4.6 包含 API 破坏性变更；升级前请参阅[迁移到 Claude Opus 4.7](/docs/zh-CN/about-claude/models/migration-guide#migrating-to-claude-opus-4-7)。
- [Claude in Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock) 现已向所有 Amazon Bedrock 客户开放。Claude Opus 4.7 和 Claude Haiku 4.5 可通过 Bedrock 控制台自助获取，使用位于 `/anthropic/v1/messages` 的 Messages API 端点，在 27 个 AWS 区域提供全球和区域端点。

### 2026 年 4 月 14 日 \{#april-14-2026}
- 我们宣布弃用 Claude Sonnet 4 模型（`claude-sonnet-4-20250514`）和 Claude Opus 4 模型（`claude-opus-4-20250514`），计划于 2026 年 6 月 15 日在 Claude API 上停用。我们建议分别迁移到 [Claude Sonnet 4.6](/docs/zh-CN/about-claude/models/overview#latest-models-comparison) 和 [Claude Opus 4.8](/docs/zh-CN/about-claude/models/migration-guide#migrating-from-claude-opus-47)。更多信息请参阅[模型弃用](/docs/zh-CN/about-claude/model-deprecations)。

### 2026 年 4 月 9 日 \{#april-9-2026}
- 我们已在公开测试版中发布[顾问工具](/docs/zh-CN/agents-and-tools/tool-use/advisor-tool)。将更快的执行器模型与更高智能的顾问模型配对，后者在生成过程中提供战略指导，使长周期代理工作负载获得接近顾问单独运行的质量，同时大部分令牌生成以执行器模型的费率进行。请在您的请求中包含测试版标头 `advisor-tool-2026-03-01`。

### 2026 年 4 月 8 日 \{#april-8-2026}
- 我们已在公开测试版中发布 **Claude Managed Agents**，这是一个完全托管的代理框架，用于将 Claude 作为自主代理运行，具有安全沙箱、内置工具和服务器发送事件流式传输。通过 API 创建代理、配置容器和运行会话。所有端点都需要 `managed-agents-2026-04-01` 测试版标头。更多信息请参阅 [Claude Managed Agents 概述](/docs/zh-CN/managed-agents/overview)。
- 我们发布了 **`ant` CLI**，这是 Claude API 的命令行客户端，可实现与 Claude API 更快的交互、与 Claude Code 的原生集成，以及在 YAML 文件中对 API 资源进行版本控制。更多信息请参阅 [CLI 快速入门](/docs/zh-CN/cli-sdks-libraries/cli/quickstart)。

### 2026 年 4 月 7 日 \{#april-7-2026}
- 我们宣布 [Claude Mythos Preview](https://anthropic.com/glasswing) 作为 [Project Glasswing](https://anthropic.com/glasswing) 的一部分，以受限研究预览版的形式提供，用于防御性网络安全工作。访问仅限邀请。
- [Messages API](/docs/zh-CN/api/messages) 现已在 Amazon Bedrock 上作为研究预览版提供。位于 `/anthropic/v1/messages` 的新 Claude in Amazon Bedrock 端点使用与第一方 Claude API 相同的请求格式，并在 AWS 托管的基础设施上运行，运营商零访问权限。在 `us-east-1` 可用；请联系您的 Anthropic 客户经理申请访问权限。更多信息请参阅 [Claude in Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)。

### 2026 年 3 月 30 日 \{#march-30-2026}
- 我们已将 Claude Opus 4.6 和 Sonnet 4.6 在 [Message Batches API](/docs/zh-CN/build-with-claude/batch-processing#extended-output-beta) 上的 `max_tokens` 上限提高到 300k。包含 `output-300k-2026-03-24` 测试版标头，即可为长篇内容、结构化数据和大型代码生成任务生成更长的单轮输出。
- 我们将于 **2026 年 4 月 30 日**停用 Claude Sonnet 4.5 和 Claude Sonnet 4 的 100 万令牌上下文窗口测试版。在该日期之后，`context-1m-2025-08-07` 测试版标头将对这些模型不再有任何效果，超过标准 200k 令牌上下文窗口的请求将返回错误。要继续使用 100 万上下文窗口，请迁移到 [Claude Sonnet 4.6](/docs/zh-CN/about-claude/models/overview#latest-models-comparison) 或 [Claude Opus 4.6](/docs/zh-CN/about-claude/models/overview#latest-models-comparison)，这些模型以标准定价支持完整的 100 万令牌上下文窗口，无需测试版标头。

### 2026 年 3 月 18 日 \{#march-18-2026}
- 我们已向 [Models API](/docs/zh-CN/api/models/list) 添加了模型能力字段。`GET /v1/models` 和 `GET /v1/models/{model_id}` 现在返回 `max_input_tokens`、`max_tokens` 和一个 `capabilities` 对象。查询 API 以了解每个模型支持的功能。

### 2026 年 3 月 16 日 \{#march-16-2026}
- 我们为扩展思考发布了 `display` 字段，让您可以从响应中省略思考内容以实现更快的流式传输。设置 `thinking.display: "omitted"` 可接收 `thinking` 字段为空但保留 `signature` 的思考块，以实现多轮连续性。计费不变。更多信息请参阅[控制思考显示](/docs/zh-CN/build-with-claude/extended-thinking#controlling-thinking-display)。

### 2026 年 3 月 13 日 \{#march-13-2026}
- [100 万令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)现已在 Claude Opus 4.6 和 Sonnet 4.6 上以标准定价正式发布。对于这些模型，超过 200k 令牌的请求会自动生效，无需测试版标头。100 万令牌上下文窗口在 Claude Sonnet 4.5 和 Sonnet 4 上仍处于测试阶段。
- 我们已移除所有支持模型的专用 100 万速率限制。您的标准账户限制现在适用于所有上下文长度。
- 使用 100 万令牌上下文窗口时，我们已将每个请求的媒体限制从 100 个图像或 PDF 页面提高到 600 个。

### 2026 年 2 月 19 日 \{#february-19-2026}
- 我们为 Messages API 发布了**自动缓存**。在请求正文中添加单个 `cache_control` 字段，系统会自动缓存最后一个可缓存块，并随着对话增长向前移动缓存点。无需手动管理断点。可与现有的块级缓存控制配合使用，以实现细粒度优化。在 Claude API 和 Microsoft Foundry（预览版）上可用。更多信息请参阅[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching#automatic-caching)。
- 我们已停用 Claude Sonnet 3.7 模型（`claude-3-7-sonnet-20250219`）和 Claude Haiku 3.5 模型（`claude-3-5-haiku-20241022`）。对这些模型的所有请求现在将返回错误。我们建议分别升级到 [Claude Sonnet 4.6](/docs/zh-CN/about-claude/models/overview#latest-models-comparison) 和 [Claude Haiku 4.5](/docs/zh-CN/about-claude/models/overview#latest-models-comparison)。研究人员可以通过[外部研究人员访问计划](https://support.claude.com/en/articles/9125743-what-is-the-external-researcher-access-program)申请持续访问权限。
- 我们宣布弃用 Claude Haiku 3 模型（`claude-3-haiku-20240307`），计划于 2026 年 4 月 20 日停用。我们建议迁移到 [Claude Haiku 4.5](/docs/zh-CN/about-claude/models/overview#latest-models-comparison)。更多信息请参阅[模型弃用](/docs/zh-CN/about-claude/model-deprecations)。

### 2026 年 2 月 17 日 \{#february-17-2026}
- 我们发布了 [Claude Sonnet 4.6](https://www.anthropic.com/news/claude-sonnet-4-6)，这是我们最新的平衡型模型，结合了速度和智能，适用于日常任务。Sonnet 4.6 在消耗更少令牌的同时提供了改进的代理搜索性能。Sonnet 4.6 支持[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)和 [100 万令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)（测试版）。详情请参阅[模型与定价](/docs/zh-CN/about-claude/models)。
- API [代码执行](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)现在**与网络搜索或网络获取一起使用时免费**。沙箱代码执行可提高模型能力和令牌效率。有关独立使用的信息，请参阅[定价详情](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool#usage-and-pricing)。
- [网络搜索工具](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool)和[编程式工具调用](/docs/zh-CN/agents-and-tools/tool-use/programmatic-tool-calling)现已正式发布（无需测试版标头）。网络搜索和网络获取现在支持[动态筛选](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool#dynamic-filtering)，它使用代码执行在结果到达上下文窗口之前对其进行筛选，以获得更好的性能并降低令牌成本。
- [代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)、[网络获取工具](/docs/zh-CN/agents-and-tools/tool-use/web-fetch-tool)、[工具搜索工具](/docs/zh-CN/agents-and-tools/tool-use/tool-search-tool)、[工具使用示例](/docs/zh-CN/agents-and-tools/tool-use/define-tools#providing-tool-use-examples)和[内存工具](/docs/zh-CN/agents-and-tools/tool-use/memory-tool)现已正式发布（无需测试版标头）。

### 2026 年 2 月 7 日 \{#february-7-2026}
- 我们已为 Opus 4.6 发布[快速模式](/docs/zh-CN/build-with-claude/fast-mode)研究预览版，通过 `speed` 参数提供显著更快的输出令牌生成速度。快速模式以高级定价提供高达 2.5 倍的速度。感兴趣的客户请加入[候补名单](https://claude.com/fast-mode)。

### 2026 年 2 月 5 日 \{#february-5-2026}
- 我们发布了 [Claude Opus 4.6](https://www.anthropic.com/news/claude-opus-4-6)，这是我们用于复杂代理任务和长周期工作的最智能模型。Opus 4.6 推荐使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（`thinking: {type: "adaptive"}`）；手动思考（带 `budget_tokens` 的 `type: "enabled"`）已弃用。Opus 4.6 不支持预填充助手消息。更多信息请参阅 [Claude 4.6 的新功能](/docs/zh-CN/about-claude/models/whats-new-claude-4-6)。
- [effort 参数](/docs/zh-CN/build-with-claude/effort)现已正式发布（无需测试版标头）并支持 Claude Opus 4.6。在新模型上，effort 取代 `budget_tokens` 来控制思考深度。
- 我们已在测试版中发布[压缩 API](/docs/zh-CN/build-with-claude/compaction)，提供服务器端上下文摘要，实现实际上无限的对话。在 Opus 4.6 上可用。
- 我们引入了[数据驻留控制](/docs/zh-CN/manage-claude/data-residency)，允许您使用 `inference_geo` 参数指定模型推理的运行位置。对于 2026 年 2 月 1 日之后发布的模型，仅限美国的推理以 1.1 倍定价提供。
- [100 万令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)现已在 Claude Opus 4.6 上以测试版提供，此外还支持 Sonnet 4.5 和 Sonnet 4。[长上下文定价](/docs/zh-CN/about-claude/pricing#long-context-pricing)适用于超过 200k 输入令牌的请求。
- [细粒度工具流式传输](/docs/zh-CN/agents-and-tools/tool-use/fine-grained-tool-streaming)现已在所有模型和平台上正式发布（无需测试版标头）。

### 2026 年 1 月 29 日 \{#january-29-2026}
- [结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)现已在 Claude API 上针对 Claude Sonnet 4.5、Claude Opus 4.5 和 Claude Haiku 4.5 正式发布。正式版包括扩展的模式支持、改进的语法编译延迟，以及无需测试版标头的简化集成路径。`output_format` 参数已移至 `output_config.format`。现有测试版用户可以在过渡期内继续使用测试版标头。结构化输出在 Amazon Bedrock 和 Microsoft Foundry 上仍处于公开测试阶段。

### 2026 年 1 月 12 日 \{#january-12-2026}
- `console.anthropic.com` 现在重定向到 `platform.claude.com`。作为我们 Claude 品牌整合的一部分，Claude Console 已迁移到新地址。现有书签和链接将通过自动重定向继续有效。更多详情请参阅 [2025 年 9 月 16 日公告](#september-16-2025)。

### 2026 年 1 月 5 日 \{#january-5-2026}
- 我们已停用 Claude Opus 3 模型（`claude-3-opus-20240229`）。对该模型的所有请求现在将返回错误。我们建议升级到 [Claude Opus 4.5](/docs/zh-CN/about-claude/models/overview#latest-models-comparison)，它以三分之一的成本提供显著改进的智能。研究人员可以通过[外部研究人员访问计划](https://support.claude.com/en/articles/9125743-what-is-the-external-researcher-access-program)申请在 API 上持续访问 Claude Opus 3。

### 2025 年 12 月 19 日 \{#december-19-2025}
- 我们宣布弃用 Claude Haiku 3.5 模型。更多信息请参阅[模型弃用](/docs/zh-CN/about-claude/model-deprecations)。

### 2025 年 12 月 4 日 \{#december-4-2025}
- [结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)现在支持 Claude Haiku 4.5。

### 2025 年 11 月 24 日 \{#november-24-2025}
- 我们发布了 [Claude Opus 4.5](https://www.anthropic.com/news/claude-opus-4-5)，这是我们最智能的模型，结合了最强能力与实用性能。非常适合复杂的专业任务、专业软件工程和高级代理。在视觉、编码和计算机使用方面实现了阶跃式改进，价格比之前的 Opus 模型更易于接受。更多信息请参阅[模型概述](/docs/zh-CN/about-claude/models)。
- 我们已在公开测试版中发布[编程式工具调用](/docs/zh-CN/agents-and-tools/tool-use/programmatic-tool-calling)，允许 Claude 在代码执行中调用工具，以减少多工具工作流程中的延迟和令牌使用量。
- 我们已在公开测试版中发布[工具搜索工具](/docs/zh-CN/agents-and-tools/tool-use/tool-search-tool)，使 Claude 能够从大型工具目录中动态发现和按需加载工具。
- 我们已在公开测试版中为 Claude Opus 4.5 发布 [effort 参数](/docs/zh-CN/build-with-claude/effort)，允许您通过在响应完整性和效率之间进行权衡来控制令牌使用量。
- 我们已向 Python 和 TypeScript SDK 添加了[客户端压缩](/docs/zh-CN/build-with-claude/context-editing#client-side-compaction-sdk)，在使用 `tool_runner` 时通过摘要自动管理对话上下文。

### 2025 年 11 月 21 日 \{#november-21-2025}
- 搜索结果内容块现已在 Amazon Bedrock 上正式发布。更多信息请参阅[搜索结果](/docs/zh-CN/build-with-claude/search-results)。

### 2025 年 11 月 19 日 \{#november-19-2025}
- 我们在 [platform.claude.com/docs](https://platform.claude.com/docs) 发布了**新的文档平台**。我们的文档现在与 Claude Console 并存，提供统一的开发者体验。之前位于 docs.claude.com 的文档站点将重定向到新位置。

### 2025 年 11 月 18 日 \{#november-18-2025}
- 我们发布了 **Claude in Microsoft Foundry**，为 Azure 客户提供 Claude 模型，并使用 Azure 计费和 OAuth 身份验证。访问完整的 Messages API，包括扩展思考、提示缓存（5 分钟和 1 小时）、PDF 支持、Files API、Agent Skills 和工具使用。更多信息请参阅 [Claude in Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)。

### 2025 年 11 月 14 日 \{#november-14-2025}
- 我们已在公开测试版中发布[结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)，为 Claude 的响应提供有保证的模式一致性。使用 JSON 输出获取结构化数据响应，或使用严格工具使用获取经过验证的工具输入。适用于 Claude Sonnet 4.5 和 Claude Opus 4.1。要启用，请使用测试版标头 `structured-outputs-2025-11-13`。

### 2025 年 10 月 28 日 \{#october-28-2025}
- 我们宣布弃用 Claude Sonnet 3.7 模型。更多信息请参阅[模型弃用](/docs/zh-CN/about-claude/model-deprecations)。
- 我们已停用 Claude Sonnet 3.5 模型。对这些模型的所有请求现在将返回错误。
- 我们通过思考块清除（`clear_thinking_20251015`）扩展了上下文编辑功能，实现思考块的自动管理。更多信息请参阅[上下文编辑](/docs/zh-CN/build-with-claude/context-editing)。

### 2025 年 10 月 16 日 \{#october-16-2025}
- 我们发布了 [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)（`skills-2025-10-02` 测试版），这是一种扩展 Claude 能力的新方式。Skills 是包含指令、脚本和资源的有组织文件夹，Claude 可动态加载它们以执行专业任务。初始版本包括：
  - **Anthropic 托管的 Skills**：用于处理 PowerPoint（.pptx）、Excel（.xlsx）、Word（.docx）和 PDF 文件的预构建 Skills
  - **自定义 Skills**：通过 Skills API（`/v1/skills` 端点）上传您自己的 Skills，以打包领域专业知识和组织工作流程
  - Skills 需要启用[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)
  - 更多信息请参阅 [Agent Skills](/docs/zh-CN/agents-and-tools/agent-skills/overview) 和 [API 参考](/docs/zh-CN/api/skills/create-skill)

### 2025 年 10 月 15 日 \{#october-15-2025}
- 我们发布了 [Claude Haiku 4.5](https://www.anthropic.com/news/claude-haiku-4-5)，这是我们最快、最智能的 Haiku 模型，具有接近前沿的性能。非常适合实时应用、高容量处理和需要强大推理能力的成本敏感型部署。更多信息请参阅[模型概述](/docs/zh-CN/about-claude/models)。

### 2025 年 9 月 29 日 \{#september-29-2025}
- 我们发布了 [Claude Sonnet 4.5](https://www.anthropic.com/news/claude-sonnet-4-5)，这是我们用于复杂代理和编码的最佳模型，在大多数任务中具有最高智能。更多信息请参阅[模型概述](/docs/zh-CN/about-claude/models/overview)。
- 我们为 Amazon Bedrock 和 Vertex AI 引入了[全球端点定价](/docs/zh-CN/about-claude/pricing#cloud-platform-pricing)。Claude API（第一方）定价不受影响。
- 我们引入了新的停止原因 `model_context_window_exceeded`，允许您在不计算输入大小的情况下请求最大可能的令牌数。更多信息请参阅[处理停止原因](/docs/zh-CN/build-with-claude/handling-stop-reasons)。
- 我们已在测试版中发布内存工具，使 Claude 能够跨对话存储和查阅信息。更多信息请参阅[内存工具](/docs/zh-CN/agents-and-tools/tool-use/memory-tool)。
- 我们已在测试版中发布上下文编辑，提供自动管理对话上下文的策略。初始版本支持在接近令牌限制时清除较早的工具结果和调用。更多信息请参阅[上下文编辑](/docs/zh-CN/build-with-claude/context-editing)。

### 2025 年 9 月 17 日 \{#september-17-2025}
- 我们已在 Python 和 TypeScript SDK 中发布测试版工具辅助功能，通过类型安全的输入验证和用于在对话中自动处理工具的工具运行器，简化工具的创建和执行。详情请参阅 [Python SDK](https://github.com/anthropics/anthropic-sdk-python/blob/main/tools.md) 和 [TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md#tool-helpers) 的文档。

### 2025 年 9 月 16 日 \{#september-16-2025}
- 我们已将开发者产品统一到 Claude 品牌下。您将在我们的平台和文档中看到更新后的命名和 URL，但**我们的开发者接口将保持不变**。以下是一些值得注意的变更：
  - Claude Console（[console.anthropic.com](https://console.anthropic.com)）→ Claude Console（[platform.claude.com](https://platform.claude.com)）。在 2026 年 1 月 12 日之前，控制台将在两个 URL 上均可访问。在该日期之后，[console.anthropic.com](https://console.anthropic.com) 将自动重定向到 [platform.claude.com](https://platform.claude.com)。
  - Anthropic Docs（[docs.anthropic.com](https://docs.anthropic.com)）→ Claude Docs（[docs.claude.com](https://docs.claude.com)）
  - Anthropic Help Center（[support.anthropic.com](https://support.anthropic.com)）→ Claude Help Center（[support.claude.com](https://support.claude.com)）
  - API 端点、请求头、环境变量和 SDK 保持不变。您现有的集成将继续正常工作，无需任何更改。

### 2025 年 9 月 10 日 \{#september-10-2025}
- 我们推出了网页抓取工具的测试版，允许 Claude 从指定的网页和 PDF 文档中检索完整内容。请在[网页抓取工具](/docs/zh-CN/agents-and-tools/tool-use/web-fetch-tool)中了解更多信息。
- 我们推出了 [Claude Code Analytics API](/docs/zh-CN/manage-claude/claude-code-analytics-api)，使组织能够以编程方式访问 Claude Code 的每日聚合使用指标，包括生产力指标、工具使用统计数据和成本数据。

### 2025 年 9 月 8 日 \{#september-8-2025}
- 我们推出了 [C# SDK](https://github.com/anthropics/anthropic-sdk-csharp) 的测试版。

### 2025 年 9 月 5 日 \{#september-5-2025}
- 我们在控制台的 [Usage](https://console.anthropic.com/settings/usage)（使用情况）页面中推出了[速率限制图表](/docs/zh-CN/api/rate-limits#monitoring-your-rate-limits-in-the-console)，让您可以随时间监控 API 速率限制使用情况和缓存率。

### 2025 年 9 月 3 日 \{#september-3-2025}
- 我们推出了对客户端工具结果中可引用文档的支持。请在[处理工具调用](/docs/zh-CN/agents-and-tools/tool-use/handle-tool-calls)中了解更多信息。

### 2025 年 9 月 2 日 \{#september-2-2025}
- 我们推出了[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool) v2 的公开测试版，用 Bash 命令执行和直接文件操作功能（包括使用其他语言编写代码）取代了原来仅支持 Python 的工具。

### 2025 年 8 月 27 日 \{#august-27-2025}
- 我们推出了 [PHP SDK](https://github.com/anthropics/anthropic-sdk-php) 的测试版。

### 2025 年 8 月 26 日 \{#august-26-2025}
- 我们提高了 Claude API 上 Claude Sonnet 4 的 [100 万令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)的速率限制。
- 100 万令牌上下文窗口现已在 Vertex AI 上可用。有关更多信息，请参阅 [Vertex AI 上的 Claude](/docs/zh-CN/build-with-claude/claude-on-vertex-ai)。

### 2025 年 8 月 19 日 \{#august-19-2025}
- 请求 ID 现在直接包含在错误响应正文中，与现有的 `request-id` 请求头并存。请在[错误](/docs/zh-CN/api/errors#error-shapes)中了解更多信息。

### 2025 年 8 月 18 日 \{#august-18-2025}
- 我们发布了 [Usage & Cost API](/docs/zh-CN/manage-claude/usage-cost-api)（使用情况与成本 API），允许管理员以编程方式监控其组织的使用情况和成本数据。
- 我们在 Admin API 中添加了一个用于检索组织信息的新端点。有关详细信息，请参阅 [Organization Info Admin API 参考](/docs/zh-CN/api/admin-api/organization/get-me)。

### 2025 年 8 月 13 日 \{#august-13-2025}
- 我们宣布弃用 Claude Sonnet 3.5 模型（`claude-3-5-sonnet-20240620` 和 `claude-3-5-sonnet-20241022`）。这些模型将于 2025 年 10 月 28 日停用。我们建议迁移到 Claude Sonnet 4.5（`claude-sonnet-4-5-20250929`）以获得更好的性能和功能。请在[模型弃用](/docs/zh-CN/about-claude/model-deprecations)中了解更多信息。
- 提示缓存的 1 小时缓存持续时间现已正式发布。您现在可以在不使用测试版请求头的情况下使用扩展的缓存 TTL。请在[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching#1-hour-cache-duration)中了解更多信息。

### 2025 年 8 月 12 日 \{#august-12-2025}
- 我们在 Claude API 和 Amazon Bedrock 上推出了 Claude Sonnet 4 的 [100 万令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)测试版支持。

### 2025 年 8 月 11 日 \{#august-11-2025}
- 由于 API 上的加速限制，部分客户在 API 使用量急剧增加后可能会遇到 429（`rate_limit_error`）[错误](/docs/zh-CN/api/errors)。此前，在类似情况下会出现 529（`overloaded_error`）错误。

### 2025 年 8 月 8 日 \{#august-8-2025}
- 搜索结果内容块现已在 Claude API 和 Vertex AI 上正式发布。此功能为 RAG 应用程序提供带有正确来源归属的自然引用。不再需要测试版请求头 `search-results-2025-06-09`。请在[搜索结果](/docs/zh-CN/build-with-claude/search-results)中了解更多信息。

### 2025 年 8 月 5 日 \{#august-5-2025}
- 我们推出了 [Claude Opus 4.1](https://www.anthropic.com/news/claude-opus-4-1)，这是对 Claude Opus 4 的增量更新，具有增强的功能和性能改进。<sup>*</sup> 请在[模型概述](/docs/zh-CN/about-claude/models)中了解更多信息。

_<sup>* - Opus 4.1 不允许同时指定 `temperature` 和 `top_p` 参数。请仅使用其中一个。</sup>_

### 2025 年 7 月 28 日 \{#july-28-2025}
- 我们发布了 `text_editor_20250728`，这是一个更新的文本编辑器工具，修复了先前版本中的一些问题，并添加了一个可选的 `max_characters` 参数，允许您在查看大文件时控制截断长度。

### 2025 年 7 月 24 日 \{#july-24-2025}
- 我们提高了 Claude API 上 Claude Opus 4 的[速率限制](/docs/zh-CN/api/rate-limits)，为您提供更多容量来使用 Claude 进行构建和扩展。对于具有[使用层级 1-4 速率限制](/docs/zh-CN/api/rate-limits#rate-limits)的客户，这些更改会立即应用于您的账户——无需任何操作。

### 2025 年 7 月 21 日 \{#july-21-2025}
- 我们已停用 Claude 2.0、Claude 2.1 和 Claude Sonnet 3 模型。对这些模型的所有请求现在都将返回错误。请在[模型弃用](/docs/zh-CN/about-claude/model-deprecations)中了解更多信息。

### 2025 年 7 月 17 日 \{#july-17-2025}
- 我们提高了 Claude API 上 Claude Sonnet 4 的[速率限制](/docs/zh-CN/api/rate-limits)，为您提供更多容量来使用 Claude 进行构建和扩展。对于具有[使用层级 1-4 速率限制](/docs/zh-CN/api/rate-limits#rate-limits)的客户，这些更改会立即应用于您的账户——无需任何操作。

### 2025 年 7 月 3 日 \{#july-3-2025}
- 我们推出了搜索结果内容块的测试版，为 RAG 应用程序提供自然引用功能。工具现在可以返回带有正确来源归属的搜索结果，Claude 将在其响应中自动引用这些来源——与网络搜索的引用质量相匹配。这消除了在自定义知识库应用程序中使用文档变通方法的需要。请在[搜索结果](/docs/zh-CN/build-with-claude/search-results)中了解更多信息。要启用此功能，请使用测试版请求头 `search-results-2025-06-09`。

### 2025 年 6 月 30 日 \{#june-30-2025}
- 我们宣布弃用 Claude Opus 3 模型。请在[模型弃用](/docs/zh-CN/about-claude/model-deprecations)中了解更多信息。

### 2025 年 6 月 23 日 \{#june-23-2025}
- 具有 Developer（开发者）角色的控制台用户现在可以访问 [Cost](https://console.anthropic.com/settings/cost)（成本）页面。此前，Developer 角色允许访问 [Usage](https://console.anthropic.com/settings/usage)（使用情况）页面，但不能访问 Cost 页面。

### 2025 年 6 月 11 日 \{#june-11-2025}
- 我们推出了[细粒度工具流式传输](/docs/zh-CN/agents-and-tools/tool-use/fine-grained-tool-streaming)的公开测试版，该功能使 Claude 能够在不进行缓冲/JSON 验证的情况下流式传输工具使用参数。要启用细粒度工具流式传输，请使用[测试版请求头](/docs/zh-CN/api/beta-headers) `fine-grained-tool-streaming-2025-05-14`。

### 2025 年 5 月 22 日 \{#may-22-2025}
- 我们推出了 [Claude Opus 4 和 Claude Sonnet 4](https://www.anthropic.com/news/claude-4)，这是我们具有扩展思考功能的最新模型。请在[模型概述](/docs/zh-CN/about-claude/models)中了解更多信息。
- Claude 4 模型中[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)的默认行为会返回 Claude 完整思考过程的摘要，完整思考内容经过加密并在 `thinking` 块输出的 `signature` 字段中返回。
- 我们推出了[交错思考](/docs/zh-CN/build-with-claude/extended-thinking#interleaved-thinking)的公开测试版，该功能使 Claude 能够在工具调用之间进行思考。要启用交错思考，请使用[测试版请求头](/docs/zh-CN/api/beta-headers) `interleaved-thinking-2025-05-14`。
- 我们推出了 [Files API](/docs/zh-CN/build-with-claude/files)（文件 API）的公开测试版，使您能够上传文件并在 Messages API 和代码执行工具中引用它们。
- 我们推出了[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)的公开测试版，该工具使 Claude 能够在安全的沙盒环境中执行 Python 代码。
- 我们推出了 [MCP 连接器](/docs/zh-CN/agents-and-tools/mcp-connector)的公开测试版，该功能允许您直接从 Messages API 连接到远程 MCP 服务器。
- 为了提高回答质量并减少工具错误，我们已将所有模型的 Messages API 中 `top_p` [核采样](https://en.wikipedia.org/wiki/Top-p_sampling)参数的默认值从 0.999 更改为 0.99。要恢复此更改，请将 `top_p` 设置为 0.999。
    此外，当启用扩展思考时，您现在可以将 `top_p` 设置为 0.95 到 1 之间的值。
- 我们已将 [Go SDK](https://github.com/anthropics/anthropic-sdk-go) 从测试版转为正式发布版。
- 我们在控制台的 [Usage](https://console.anthropic.com/settings/usage)（使用情况）页面中添加了分钟级和小时级粒度，以及 429 错误率。

### 2025 年 5 月 21 日 \{#may-21-2025}
- 我们已将 [Ruby SDK](https://github.com/anthropics/anthropic-sdk-ruby) 从测试版转为正式发布版。

### 2025 年 5 月 7 日 \{#may-7-2025}
- 我们在 API 中推出了网络搜索工具，允许 Claude 访问来自网络的最新信息。请在[网络搜索工具](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool)中了解更多信息。

### 2025 年 5 月 1 日 \{#may-1-2025}
- 缓存控制现在必须直接在 `tool_result` 和 `document.source` 的父 `content` 块中指定。为了向后兼容，如果在 `tool_result.content` 或 `document.source.content` 的最后一个块上检测到缓存控制，它将自动应用于父块。在 `tool_result.content` 和 `document.source.content` 内的任何其他块上设置缓存控制将导致验证错误。

### 2025 年 4 月 9 日 \{#april-9th-2025}
- 我们推出了 [Ruby SDK](https://github.com/anthropics/anthropic-sdk-ruby) 的测试版。

### 2025 年 3 月 31 日 \{#march-31st-2025}
- 我们已将 [Java SDK](https://github.com/anthropics/anthropic-sdk-java) 从测试版转为正式发布版。
- 我们已将 [Go SDK](https://github.com/anthropics/anthropic-sdk-go) 从 alpha 版转为测试版。

### 2025 年 2 月 27 日 \{#february-27th-2025}
- 我们在 Messages API 中为图像和 PDF 添加了 URL 源块。您现在可以直接通过 URL 引用图像和 PDF，而无需对其进行 base64 编码。请在[视觉](/docs/zh-CN/build-with-claude/vision)和 [PDF 支持](/docs/zh-CN/build-with-claude/pdf-support)中了解更多信息。
- 我们在 Messages API 的 `tool_choice` 参数中添加了对 `none` 选项的支持，该选项可防止 Claude 调用任何工具。此外，在包含 `tool_use` 和 `tool_result` 块时，您不再需要提供任何 `tools`。
- 我们推出了一个与 OpenAI 兼容的 API 端点，允许您通过仅更改现有 OpenAI 集成中的 API 密钥、基础 URL 和模型名称来测试 Claude 模型。此兼容层支持核心聊天补全功能。请在 [OpenAI SDK 兼容性](/docs/zh-CN/cli-sdks-libraries/libraries/openai-sdk)中了解更多信息。

### 2025 年 2 月 24 日 \{#february-24th-2025}
- 我们推出了 [Claude Sonnet 3.7](https://www.anthropic.com/news/claude-3-7-sonnet)，这是我们迄今为止最智能的模型。Claude Sonnet 3.7 可以产生近乎即时的响应，或逐步展示其扩展思考过程。一个模型，两种思考方式。请在[模型概述](/docs/zh-CN/about-claude/models)中了解所有 Claude 模型的更多信息。
- 我们为 Claude Haiku 3.5 添加了视觉支持，使该模型能够分析和理解图像。
- 我们发布了一个令牌高效的工具使用实现，提高了使用 Claude 工具时的整体性能。请在[使用 Claude 进行工具使用](/docs/zh-CN/agents-and-tools/tool-use/overview)中了解更多信息。
- 我们已将[控制台](https://console.anthropic.com/workbench)中新提示的默认温度从 0 更改为 1，以与 API 中的默认温度保持一致。现有已保存的提示不受影响。
- 我们发布了工具的更新版本，将文本编辑和 bash 工具与计算机使用系统提示解耦：
  - `bash_20250124`：功能与先前版本相同，但独立于计算机使用。不需要测试版请求头。
  - `text_editor_20250124`：功能与先前版本相同，但独立于计算机使用。不需要测试版请求头。
  - `computer_20250124`：更新的计算机使用工具，具有新的命令选项，包括 "hold_key"、"left_mouse_down"、"left_mouse_up"、"scroll"、"triple_click" 和 "wait"。此工具需要 "computer-use-2025-01-24" anthropic-beta 请求头。
  请在[使用 Claude 进行工具使用](/docs/zh-CN/agents-and-tools/tool-use/overview)中了解更多信息。

### 2025 年 2 月 10 日 \{#february-10th-2025}
- 我们已在所有 API 响应中添加了 `anthropic-organization-id` 响应头。此响应头提供与请求中使用的 API 密钥关联的组织 ID。

### 2025 年 1 月 31 日 \{#january-31st-2025}

- 我们已将 [Java SDK](https://github.com/anthropics/anthropic-sdk-java) 从 alpha 版转为测试版。

### 2025 年 1 月 23 日 \{#january-23rd-2025}

- 我们在 API 中推出了引用功能，允许 Claude 为信息提供来源归属。请在[引用](/docs/zh-CN/build-with-claude/citations)中了解更多信息。
- 我们在 Messages API 中添加了对纯文本文档和自定义内容文档的支持。

### 2025 年 1 月 21 日 \{#january-21st-2025}

- 我们宣布弃用 Claude 2、Claude 2.1 和 Claude Sonnet 3 模型。请在[模型弃用](/docs/zh-CN/about-claude/model-deprecations)中了解更多信息。

### 2025 年 1 月 15 日 \{#january-15th-2025}

- 我们更新了[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)，使其更易于使用。现在，当您设置缓存断点时，我们将自动从您最长的先前缓存前缀中读取。
- 您现在可以在使用工具时预填 Claude 的回复。

### 2025 年 1 月 10 日 \{#january-10th-2025}

- 我们优化了对 [Message Batches API 中提示缓存](/docs/zh-CN/build-with-claude/batch-processing#using-prompt-caching-with-message-batches)的支持，以提高缓存命中率。

### 2024 年 12 月 19 日 \{#december-19th-2024}

- 我们在 Message Batches API 中添加了对[删除端点](/docs/zh-CN/api/deleting-message-batches)的支持。

### 2024 年 12 月 17 日 \{#december-17th-2024}
以下功能现已在 Claude API 中正式发布：

- [Models API](/docs/zh-CN/api/models/list)（模型 API）：查询可用模型、验证模型 ID，并将[模型别名](/docs/zh-CN/about-claude/models#model-names)解析为其规范模型 ID。
- [Message Batches API](/docs/zh-CN/build-with-claude/batch-processing)（消息批处理 API）：以标准 API 成本的 50% 异步处理大批量消息。
- [Token counting API](/docs/zh-CN/build-with-claude/token-counting)（令牌计数 API）：在将消息发送给 Claude 之前计算其令牌数量。
- [提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)：通过缓存和重用提示内容，将成本降低多达 90%，延迟降低多达 80%。
- [PDF 支持](/docs/zh-CN/build-with-claude/pdf-support)：处理 PDF 以分析文档中的文本和视觉内容。

我们还发布了新的官方 SDK：
- [Java SDK](https://github.com/anthropics/anthropic-sdk-java)（alpha 版）
- [Go SDK](https://github.com/anthropics/anthropic-sdk-go)（alpha 版）

### 2024 年 12 月 4 日 \{#december-4th-2024}

- 我们在[开发者控制台](https://console.anthropic.com)的 [Usage](https://console.anthropic.com/settings/usage)（使用情况）和 [Cost](https://console.anthropic.com/settings/cost)（成本）页面中添加了按 API 密钥分组的功能。
- 我们在[开发者控制台](https://console.anthropic.com)的 [API keys](https://console.anthropic.com/settings/keys)（API 密钥）页面中添加了两个新列 **Last used at**（上次使用时间）和 **Cost**（成本），以及按任意列排序的功能。

### 2024 年 11 月 21 日 \{#november-21st-2024}

- 我们发布了 [Admin API](/docs/zh-CN/manage-claude/admin-api)（管理 API），允许用户以编程方式管理其组织的资源。

### 2024 年 11 月 20 日 \{#november-20th-2024}

- 我们更新了 Messages API 的速率限制。我们用新的每分钟输入令牌和每分钟输出令牌速率限制取代了每分钟令牌速率限制。请在[速率限制](/docs/zh-CN/api/rate-limits)中了解更多信息。
- 我们在 [Workbench](https://console.anthropic.com/workbench) 中添加了对[工具使用](/docs/zh-CN/agents-and-tools/tool-use/overview)的支持。

### 2024 年 11 月 13 日 \{#november-13th-2024}

- 我们为所有 Claude Sonnet 3.5 模型添加了 PDF 支持。请在 [PDF 支持](/docs/zh-CN/build-with-claude/pdf-support)中了解更多信息。

### 2024 年 11 月 6 日 \{#november-6th-2024}

- 我们已停用 Claude 1 和 Instant 模型。请在[模型弃用](/docs/zh-CN/about-claude/model-deprecations)中了解更多信息。

### 2024 年 11 月 4 日 \{#november-4th-2024}

- [Claude Haiku 3.5](https://www.anthropic.com/claude/haiku) 现已作为纯文本模型在 Claude API 上可用。

### 2024 年 11 月 1 日 \{#november-1st-2024}

- 我们添加了与新版 Claude Sonnet 3.5 配合使用的 PDF 支持。请在 [PDF 支持](/docs/zh-CN/build-with-claude/pdf-support)中了解更多信息。
- 我们还添加了令牌计数功能，允许您在将消息发送给 Claude 之前确定消息中的令牌总数。请在[令牌计数](/docs/zh-CN/build-with-claude/token-counting)中了解更多信息。

### 2024 年 10 月 22 日 \{#october-22nd-2024}

- 我们在 API 中添加了 Anthropic 定义的计算机使用工具，可与新版 Claude Sonnet 3.5 配合使用。请在[计算机使用工具](/docs/zh-CN/agents-and-tools/tool-use/computer-use-tool)中了解更多信息。
- Claude Sonnet 3.5，我们迄今为止最智能的模型，刚刚进行了升级，现已在 Claude API 上可用。请在 [Claude Sonnet 文档](https://www.anthropic.com/claude/sonnet)中了解更多信息。

### 2024 年 10 月 8 日 \{#october-8th-2024}

- Message Batches API 现已推出测试版。在 Claude API 中以低 50% 的成本异步处理大批量查询。请在[批处理](/docs/zh-CN/build-with-claude/batch-processing)中了解更多信息。
- 我们放宽了 Messages API 中 `user`/`assistant` 轮次顺序的限制。连续的 `user`/`assistant` 消息将被合并为单个消息而不是报错，并且我们不再要求第一条输入消息必须是 `user` 消息。
- 我们已弃用 Build 和 Scale 计划，转而采用标准功能套件（以前称为 Build），以及可通过销售获得的附加功能。请在我们的 [API 定价信息](https://claude.com/platform/api)中了解更多信息。

### 2024 年 10 月 3 日 \{#october-3rd-2024}

- 我们在 API 中添加了禁用并行工具使用的功能。在 `tool_choice` 字段中设置 `disable_parallel_tool_use: true` 以确保 Claude 最多使用一个工具。请在[并行工具使用](/docs/zh-CN/agents-and-tools/tool-use/parallel-tool-use)中了解更多信息。

### 2024 年 9 月 10 日 \{#september-10th-2024}

- 我们在[开发者控制台](https://console.anthropic.com)中添加了 Workspaces（工作区）。工作区允许您设置自定义支出或速率限制、对 API 密钥进行分组、按项目跟踪使用情况，以及通过用户角色控制访问权限。请在我们的[博客文章](https://www.anthropic.com/news/workspaces)中了解更多信息。

### 2024 年 9 月 4 日 \{#september-4th-2024}

- 我们宣布弃用 Claude 1 模型。请在[模型弃用](/docs/zh-CN/about-claude/model-deprecations)中了解更多信息。

### 2024 年 8 月 22 日 \{#august-22nd-2024}

- 我们通过在 API 响应中返回 CORS 请求头，添加了对在浏览器中使用 SDK 的支持。在 SDK 实例化时设置 `dangerouslyAllowBrowser: true` 以启用此功能。

### 2024 年 8 月 19 日 \{#august-19th-2024}

- 我们已将 Claude Sonnet 3.5 的 8,192 令牌输出从测试版转为正式发布。

### 2024 年 8 月 14 日 \{#august-14th-2024}

- [提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)现已作为测试版功能在 Claude API 中可用。缓存和重用提示可将延迟降低多达 80%，成本降低多达 90%。

### 2024 年 7 月 15 日 \{#july-15th-2024}

- 使用新的 `anthropic-beta: max-tokens-3-5-sonnet-2024-07-15` 请求头，从 Claude Sonnet 3.5 生成长度多达 8,192 令牌的输出。

### 2024 年 7 月 9 日 \{#july-9th-2024}

- 在[开发者控制台](https://console.anthropic.com)中使用 Claude 自动为您的提示生成测试用例。
- 在[开发者控制台](https://console.anthropic.com)的新输出比较模式中并排比较不同提示的输出。

### 2024 年 6 月 27 日 \{#june-27th-2024}

- 在[开发者控制台](https://console.anthropic.com)的新 [Usage](https://console.anthropic.com/settings/usage)（使用情况）和 [Cost](https://console.anthropic.com/settings/cost)（成本）选项卡中查看按美元金额、令牌数量和 API 密钥细分的 API 使用情况和账单。
- 在[开发者控制台](https://console.anthropic.com)的新 [Rate Limits](https://console.anthropic.com/settings/limits)（速率限制）选项卡中查看您当前的 API 速率限制。

### 2024 年 6 月 20 日 \{#june-20th-2024}

- [Claude Sonnet 3.5](https://www.anthropic.com/news/claude-3-5-sonnet)，我们迄今为止最智能的模型，现已在 Claude API、Amazon Bedrock 和 Vertex AI 上正式发布。

### 2024 年 5 月 30 日 \{#may-30th-2024}

- [工具使用](/docs/zh-CN/agents-and-tools/tool-use/overview)现已在 Claude API、Amazon Bedrock 和 Vertex AI 上正式发布。

### 2024 年 5 月 10 日 \{#may-10th-2024}

- 我们的提示生成器工具现已在[开发者控制台](https://console.anthropic.com)中可用。提示生成器可以轻松引导 Claude 生成针对您特定任务量身定制的高质量提示。请在我们的[博客文章](https://www.anthropic.com/news/prompt-generator)中了解更多信息。