# 功能概览

探索 Claude 的高级功能和能力。

---

Claude 的 API 体系分为五个领域：

- **模型能力：** 控制 Claude 的推理方式和响应格式。
- **工具：** 让 Claude 在网络上或您的环境中执行操作。
- **工具基础设施：** 处理大规模的工具发现和编排。
- **上下文管理：** 保持长时间运行会话的高效性。
- **文件和资产：** 管理您提供给 Claude 的文档和数据。

如果您是新用户，请从[模型能力](#model-capabilities)和[工具](#tools)开始。当您准备好优化成本、延迟或扩展规模时，再回到其他部分。

有关管理和治理，请参阅 [Admin API](/docs/zh-CN/manage-claude/admin-api)、[Usage and Cost API](/docs/zh-CN/manage-claude/usage-cost-api) 和 [Compliance API](/docs/zh-CN/manage-claude/compliance-api)。

## 功能可用性 \{#feature-availability}

Claude 平台上的功能在每个平台上都会被分配以下可用性分类之一（显示在下方各表的"可用性"列中）。并非所有功能都会经历每个阶段。功能可以从任何分类进入，也可以跳过某些阶段。

| 分类 | 描述 |
|----------------|-------------|
| **Beta（测试版）**<sup>*</sup> | 预览功能，用于收集反馈并针对尚不成熟的用例进行迭代。可用性可能受限，包括需要注册或加入候补名单，且可能不会公开宣布。<br/><br/> 功能可能会根据反馈发生重大变化或被停用。不保证可持续用于生产环境。可能会在通知后进行破坏性更改，并且可能存在某些特定于平台的限制。Claude API 和 [Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 上的 Beta 功能带有 [beta 标头](/docs/zh-CN/api/beta-headers)。 |
| **正式发布（GA）** | 功能稳定、完全受支持，推荐用于生产环境。不应带有 beta 标头或其他表明该功能处于预览状态的标识。受标准 API [版本控制](/docs/zh-CN/api/versioning)保证的覆盖。 |
| **已弃用（Deprecated）** | 功能仍可使用，但不再推荐。会提供迁移路径和移除时间表。 |
| **已停用（Retired）** | 功能不再可用。 |

_<sup>*</sup> 可能带有限定词，表示可用性更窄或存在额外限制（例如，"beta: research preview"）。详情请参阅该功能的页面。_

**平台标签：** Claude API（Anthropic 第一方）· [Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws)（Anthropic 在 AWS 上运营）· [Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)（AWS 运营）· [Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai)（Google 运营）· [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)（Anthropic 在 Azure 上运营）

## 模型能力 \{#model-capabilities}

引导 Claude 及其直接输出的方式，包括响应格式、推理深度和输入模态。

<Tip>
您可以通过编程方式发现模型支持哪些能力。[Models API](/docs/zh-CN/api/models/list) 会为每个可用模型返回 `max_input_tokens`、`max_tokens` 和一个 `capabilities` 对象。
</Tip>

ZDR 列指示某项功能是否可在 "Zero Data Retention"（零数据保留）安排下使用。对于大多数功能，这仅取决于该功能机制所保留的内容；对于与特定模型绑定的功能，模型级别的 ZDR 可用性同样适用。请参阅[特定模型的数据保留要求](/docs/zh-CN/manage-claude/api-and-data-retention#model-specific-data-retention-requirements)。

| 功能 | 描述 | 零数据保留（ZDR） | 可用性 |
|---------|-----------|----|--------------|
| [上下文窗口](/docs/zh-CN/build-with-claude/context-windows) | 最多 100 万个令牌，用于处理大型文档、大规模代码库和长对话。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking) | 让 Claude 动态决定何时思考以及思考多少。这是 Claude Opus 4.8 和 Claude Opus 4.7 上唯一的思考模式。使用 effort 参数控制思考深度。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [批处理](/docs/zh-CN/build-with-claude/batch-processing) | 异步处理大量请求以节省成本。每批次可发送大量查询。Batch API 调用的成本比标准 API 调用低 50%。 | 不符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws /> |
| [引用](/docs/zh-CN/build-with-claude/citations) | 将 Claude 的响应锚定在源文档中。通过引用功能，Claude 可以提供其生成响应时所使用的确切句子和段落的详细参考，从而产生更可验证、更可信的输出。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [数据驻留](/docs/zh-CN/manage-claude/data-residency) | 使用地理控制来控制模型推理的运行位置。通过 `inference_geo` 参数为每个请求指定 `"global"` 或 `"us"` 路由。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws /> |
| [Effort](/docs/zh-CN/build-with-claude/effort) | 使用 effort 参数控制 Claude 响应时使用的令牌数量，在响应完整性和令牌效率之间进行权衡。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [扩展思考](/docs/zh-CN/build-with-claude/extended-thinking) | 针对复杂任务的增强推理能力，在给出最终答案之前，透明地展示 Claude 的逐步思考过程。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [回退额度](/docs/zh-CN/build-with-claude/fallback-credit) | 当您在另一个模型上重试被拒绝的请求时，避免重复支付提示缓存成本。拒绝响应会携带一个额度令牌，在重试时回传该令牌，重试的计费将如同对话一直在新模型上进行一样。Message Batches 结果中返回的额度令牌无法兑换。 | 不符合 ZDR 条件* | <PlatformAvailability claudeApiBeta claudePlatformAwsBeta bedrockBeta vertexAiBeta azureAiBeta /> |
| [PDF 支持](/docs/zh-CN/build-with-claude/pdf-support) | 处理和分析 PDF 文档中的文本和视觉内容。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [搜索结果](/docs/zh-CN/build-with-claude/search-results) | 通过提供带有正确来源归属的搜索结果，为 RAG 应用启用自然引用。为自定义知识库和工具实现网络搜索级别的引用质量。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [服务器端回退](/docs/zh-CN/build-with-claude/refusals-and-fallback) | 在单个 API 调用内重试被拒绝的请求。最多指定三个回退模型，当所请求的模型拒绝时，API 会在同一请求上运行链中的下一个模型。`fallbacks` 参数在 Message Batches API 中不可用。 | 不符合 ZDR 条件* | <PlatformAvailability claudeApiBeta claudePlatformAwsBeta /> |
| [结构化输出](/docs/zh-CN/build-with-claude/structured-outputs) | 通过两种方法保证模式一致性：用于结构化数据响应的 JSON 输出，以及用于验证工具输入的严格工具使用。 | [符合 ZDR 条件（有限定条件）](/docs/zh-CN/build-with-claude/structured-outputs#data-retention)* | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |

## 工具 \{#tools}

Claude 通过 `tool_use` 调用的内置工具。服务器端工具由平台运行；客户端工具由您实现和执行。

### 服务器端工具 \{#server-side-tools}

| 功能 | 描述 | ZDR | 可用性 |
|---------|-----------|----|--------------|
| [顾问工具](/docs/zh-CN/agents-and-tools/tool-use/advisor-tool) | 将速度更快的执行器模型与智能更高的顾问模型配对，后者在生成过程中为长周期智能体工作负载提供战略指导。 | 符合 ZDR 条件 | <PlatformAvailability claudeApiBeta claudePlatformAwsBeta /> |
| [代码执行](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool) | 在沙盒环境中运行代码，用于高级数据分析、计算和文件处理。与网络搜索或网页抓取一起使用时免费。 | 不符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws azureAiBeta /> |
| [网页抓取](/docs/zh-CN/agents-and-tools/tool-use/web-fetch-tool) | 从指定的网页和 PDF 文档中检索完整内容以进行深入分析。 | 符合 ZDR 条件* | <PlatformAvailability claudeApi claudePlatformAws azureAiBeta /> |
| [网络搜索](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool) | 使用来自网络的最新真实数据增强 Claude 的全面知识。 | 符合 ZDR 条件* | <PlatformAvailability claudeApi claudePlatformAws vertexAi azureAiBeta /> |

### 客户端工具 \{#client-side-tools}

| 功能 | 描述 | ZDR | 可用性 |
|---------|-----------|----|--------------|
| [Bash](/docs/zh-CN/agents-and-tools/tool-use/bash-tool) | 执行 bash 命令和脚本，与系统 shell 交互并执行命令行操作。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [计算机使用](/docs/zh-CN/agents-and-tools/tool-use/computer-use-tool) | 通过截取屏幕截图并发出鼠标和键盘命令来控制计算机界面。 | 符合 ZDR 条件 | <PlatformAvailability claudeApiBeta claudePlatformAwsBeta bedrockBeta vertexAiBeta azureAiBeta /> |
| [记忆](/docs/zh-CN/agents-and-tools/tool-use/memory-tool) | 使 Claude 能够跨对话存储和检索信息。随时间构建知识库、维护项目上下文并从过去的交互中学习。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [文本编辑器](/docs/zh-CN/agents-and-tools/tool-use/text-editor-tool) | 使用内置文本编辑器界面创建和编辑文本文件，用于文件操作任务。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |

## 工具基础设施 \{#tool-infrastructure}

支持发现、编排和扩展工具使用的基础设施。

| 功能 | 描述 | ZDR | 可用性 |
|---------|-----------|----|--------------|
| [Agent Skills](/docs/zh-CN/agents-and-tools/agent-skills/overview) | 使用 Skills 扩展 Claude 的能力。使用预构建的 Skills（PowerPoint、Excel、Word、PDF）或使用指令和脚本创建自定义 Skills。Skills 使用渐进式披露来高效管理上下文。 | 不符合 ZDR 条件 | <PlatformAvailability claudeApiBeta claudePlatformAwsBeta azureAiBeta /> |
| [细粒度工具流式传输](/docs/zh-CN/agents-and-tools/tool-use/fine-grained-tool-streaming) | 在不进行缓冲/JSON 验证的情况下流式传输工具使用参数，减少接收大型参数时的延迟。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAi /> |
| [MCP 连接器](/docs/zh-CN/agents-and-tools/mcp-connector) | 直接从 Messages API 连接到远程 [MCP](/docs/zh-CN/mcp) 服务器，无需单独的 MCP 客户端。 | 不符合 ZDR 条件 | <PlatformAvailability claudeApiBeta claudePlatformAwsBeta azureAiBeta /> |
| [编程式工具调用](/docs/zh-CN/agents-and-tools/tool-use/programmatic-tool-calling) | 使 Claude 能够在代码执行容器内以编程方式调用您的工具，减少多工具工作流的延迟和令牌消耗。 | 不符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws azureAiBeta /> |
| [工具搜索](/docs/zh-CN/agents-and-tools/tool-use/tool-search-tool) | 通过使用基于正则表达式的搜索按需动态发现和加载工具，扩展到数千个工具，优化上下文使用并提高工具选择准确性。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |

## 上下文管理 \{#context-management}

用于控制和优化 Claude 上下文窗口的基础设施。

| 功能 | 描述 | ZDR | 可用性 |
|---------|-----------|----|--------------|
| [压缩](/docs/zh-CN/build-with-claude/compaction) | 针对长时间运行对话的服务器端上下文摘要。当上下文接近窗口限制时，API 会自动对对话的较早部分进行摘要。 | 符合 ZDR 条件 | <PlatformAvailability claudeApiBeta claudePlatformAwsBeta bedrockBeta vertexAiBeta azureAiBeta /> |
| [上下文编辑](/docs/zh-CN/build-with-claude/context-editing) | 使用可配置策略自动管理对话上下文。支持在接近令牌限制时清除工具结果，以及在扩展思考对话中管理思考块。 | 符合 ZDR 条件 | <PlatformAvailability claudeApiBeta claudePlatformAwsBeta bedrockBeta vertexAiBeta azureAiBeta /> |
| [自动提示缓存](/docs/zh-CN/build-with-claude/prompt-caching#automatic-caching) | 将提示缓存简化为单个 API 参数。系统会自动缓存请求中最后一个可缓存的块，并随着对话增长向前移动缓存点。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws azureAiBeta /> |
| [提示缓存（5 分钟）](/docs/zh-CN/build-with-claude/prompt-caching) | 为 Claude 提供更多背景知识和示例输出，以降低成本和延迟。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [提示缓存（1 小时）](/docs/zh-CN/build-with-claude/prompt-caching#1-hour-cache-duration) | 延长至 1 小时的缓存持续时间，适用于访问频率较低但重要的上下文，作为标准 5 分钟缓存的补充。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |
| [令牌计数](/docs/zh-CN/build-with-claude/token-counting) | 令牌计数使您能够在将消息发送给 Claude 之前确定消息中的令牌数量，帮助您就提示和使用情况做出明智的决策。 | 符合 ZDR 条件 | <PlatformAvailability claudeApi claudePlatformAws bedrock vertexAi azureAiBeta /> |

## 文件和资产 \{#files-and-assets}

管理用于 Claude 的文件和资产。

| 功能 | 描述 | ZDR | 可用性 |
|---------|-----------|----|--------------|
| [Files API](/docs/zh-CN/build-with-claude/files) | 上传和管理文件以供 Claude 使用，无需在每次请求时重新上传内容。支持 PDF、图像和文本文件。 | 不符合 ZDR 条件 | <PlatformAvailability claudeApiBeta claudePlatformAwsBeta azureAiBeta /> |

\* **结构化输出：** 您的提示和 Claude 的输出不会被存储。仅缓存 JSON 模式，自上次使用起最多保留 24 小时。**网络搜索和网页抓取：** 符合 ZDR 条件，但启用[动态过滤](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool#dynamic-filtering)时除外。**回退额度和服务器端回退：** 这些功能不保留任何消息内容，但两者都处理来自 Claude Fable 5 的拒绝，而该模型[在 ZDR 下不可用](/docs/zh-CN/manage-claude/api-and-data-retention#model-specific-data-retention-requirements)。请参阅 [ZDR 详情](/docs/zh-CN/manage-claude/api-and-data-retention#feature-eligibility)。