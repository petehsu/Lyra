# 定价

了解 Anthropic 模型和功能的定价结构

---

本页面提供 Anthropic 模型和功能的详细定价信息。所有价格均以美元计。

如需获取最新定价信息，请访问 [claude.com/pricing](https://claude.com/pricing)。

## 模型定价 \{#model-pricing}

下表显示了所有 Claude 模型的定价：

| 模型             | 基础输入令牌 | 5 分钟缓存写入 | 1 小时缓存写入 | 缓存命中与刷新 | 输出令牌 |
|-------------------|-------------------|-----------------|-----------------|----------------------|---------------|
| Claude Fable 5      | $10 / MTok        | $12.50 / MTok   | $20 / MTok      | $1 / MTok | $50 / MTok    |
| Claude Mythos 5（[限量供应](https://anthropic.com/glasswing)） | $10 / MTok        | $12.50 / MTok   | $20 / MTok      | $1 / MTok | $50 / MTok    |
| Claude Opus 4.8     | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok | $25 / MTok    |
| Claude Opus 4.7     | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok | $25 / MTok    |
| Claude Opus 4.6     | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok | $25 / MTok    |
| Claude Opus 4.5   | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok | $25 / MTok    |
| Claude Opus 4.1（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $15 / MTok        | $18.75 / MTok   | $30 / MTok      | $1.50 / MTok | $75 / MTok    |
| Claude Opus 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $15 / MTok        | $18.75 / MTok   | $30 / MTok      | $1.50 / MTok | $75 / MTok    |
| Claude Sonnet 4.6   | $3 / MTok         | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok | $15 / MTok    |
| Claude Sonnet 4.5   | $3 / MTok         | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok | $15 / MTok    |
| Claude Sonnet 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $3 / MTok         | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok | $15 / MTok    |
| Claude Haiku 4.5  | $1 / MTok         | $1.25 / MTok    | $2 / MTok       | $0.10 / MTok | $5 / MTok     |
| Claude Haiku 3.5（[已停用，Bedrock 和 Vertex AI 除外](/docs/zh-CN/about-claude/model-deprecations)） | $0.80 / MTok      | $1 / MTok       | $1.60 / MTok     | $0.08 / MTok | $4 / MTok     |

<Note>
MTok = 百万令牌。"Base Input Tokens"（基础输入令牌）列显示标准输入定价，"5m Cache Writes"（5 分钟缓存写入）、"1h Cache Writes"（1 小时缓存写入）和 "Cache Hits & Refreshes"（缓存命中与刷新）列专用于[提示缓存](#prompt-caching)，"Output Tokens"（输出令牌）列显示输出定价。有关缓存列和定价乘数的说明，请参阅[提示缓存定价](#prompt-caching)。
</Note>

<Note>
Opus 4.7 及更高版本使用了与之前模型不同的新分词器，这有助于提升其在各类任务中的性能。对于相同的固定文本，此新分词器可能会多使用最多 35% 的令牌。
</Note>

有关 Claude Platform on AWS 的定价，请参阅 [Claude Platform on AWS 定价](#claude-platform-on-aws-pricing)。

## 云平台定价 \{#cloud-platform-pricing}

本节介绍由合作伙伴运营的云平台，其费用由云提供商向您开具账单。对于通过应用市场计费的 Anthropic 运营云平台，请参阅 [Claude Platform on AWS 定价](#claude-platform-on-aws-pricing)和 [Claude in Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)。

Claude 模型可在 [Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock) 和 [Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai) 上使用。如需官方定价，请访问：
- [Amazon Bedrock 定价](https://aws.amazon.com/bedrock/pricing/)
- [Vertex AI 定价](https://cloud.google.com/vertex-ai/generative-ai/pricing#claude-models)

<Note>
**Claude 4.5 及更高版本模型的区域和多区域端点定价**

从 Claude Sonnet 4.5、Haiku 4.5 和 Opus 4.5 开始：
- **Bedrock** 提供两种端点类型：全球端点（动态路由以实现最大可用性）和区域端点（保证数据通过特定地理区域路由）。
- **Vertex AI** 提供三种端点类型：全球端点、多区域端点（在某一地理区域内动态路由）和区域端点。

区域和多区域端点的价格比全球端点高 10%。Claude API（第一方）默认为全球路由；有关第一方数据驻留选项和定价，请参阅[数据驻留定价](#data-residency-pricing)。

**适用范围：**此定价结构适用于 Claude Sonnet 4.5、Haiku 4.5、Opus 4.5 及所有后续模型。早期模型（Claude Sonnet 4（已弃用）、Opus 4（已弃用）及更早版本）保留其现有定价。

有关实现细节和代码示例：
- 对于 Opus 4.7、Haiku 4.5 及更高版本的模型，请参阅 [Amazon Bedrock 全球与区域端点](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock#regions)；对于 Bedrock 上的所有其他模型，请参阅[旧版集成](/docs/zh-CN/build-with-claude/claude-on-amazon-bedrock-legacy#global-vs-regional-endpoints)
- [Vertex AI 全球、多区域和区域端点](/docs/zh-CN/build-with-claude/claude-on-vertex-ai#global-multi-region-and-regional-endpoints)
</Note>

## Claude Platform on AWS 定价 \{#claude-platform-on-aws-pricing}

[Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 通过 AWS Marketplace 使用 Claude 消费单位（Claude Consumption Units，CCU）进行计费。Anthropic 按标准的每模型、每功能费率以美元计算您的令牌使用量，应用任何协商的折扣，然后按每 CCU $0.01 的比率将结果转换为 CCU，并每小时向 AWS Marketplace 报告 CCU 数量。您的 AWS 账单将显示单个 CCU 行项目。

| 概念 | 详情 |
| :--- | :--- |
| **计费单位** | Claude 消费单位（CCU） |
| **CCU 价格** | 每 CCU $0.01（固定；折扣在令牌到 CCU 的转换时应用，而非应用于 CCU 价格） |
| **转换** | 令牌使用量按标准的每模型、每功能费率以美元计价（与 [Claude API 定价](#model-pricing)相同），然后按每 CCU $0.01 转换为 CCU |
| **计费周期** | 每小时向 AWS Marketplace 计量；按月开具发票 |
| **付款模式** | 仅限后付费（欠款结算）；无预付费额度 |
| **折扣** | 以计量更少的 CCU 形式应用 |
| **税费** | 税前计量；AWS Marketplace 处理税费 |
| **成本可见性** | 在 Claude Console 中实时查看明细（通过 AWS Console 访问）；AWS Cost Explorer 显示汇总的 CCU |

<Note>
**Claude 消费单位。**如果客户通过某些应用市场平台（例如 Claude Platform on AWS）访问服务，使用量将以 Claude 消费单位（"CCU"）而非每 MTok 开具发票。CCU 是仅用于应用市场平台开票的计量单位。一百（100）个 CCU 代表应付服务费用 $1.00 美元，该费用按 [claude.com/pricing#api](https://claude.com/pricing#api) 上的适用价格计算，并已应用任何折扣。
</Note>

### 推理地理位置 \{#inference-geography}

对于 Claude Opus 4.6、Claude Sonnet 4.6 及更高版本的模型，使用 `inference_geo: "us"` 会应用 1.1 倍的定价乘数。`inference_geo: "global"`（默认）使用标准定价。详情请参阅[数据驻留](/docs/zh-CN/manage-claude/data-residency)。

### 私有报价 \{#private-offers}

当您在 AWS Console 的 **Claude Platform on AWS** 服务页面上注册时，AWS Console 会查找与您的账户关联的任何私有报价，并提示您在 AWS Marketplace 中接受该报价。如需了解私有报价条款，请联系您的 Anthropic 客户代表。

<Note>
如果您已有 Amazon Bedrock 私有报价，请在开始使用 Claude Platform on AWS 之前联系您的 Anthropic 或 AWS 客户代表，以确保您的折扣得到正确应用。折扣无法追溯应用于接受私有报价之前产生的使用量。
</Note>

## 特定功能定价 \{#feature-specific-pricing}

### 提示缓存 \{#prompt-caching}

"Prompt caching"（提示缓存）通过在多次 API 调用之间重用先前处理过的提示部分来降低成本和延迟。API 无需在每次请求时重新处理相同的大型系统提示、文档或对话历史，而是以标准输入价格的一小部分从缓存中读取。

启用提示缓存有两种方式：

- **自动缓存：**在请求的顶层添加单个 `cache_control` 字段。系统会随着对话的增长自动管理缓存断点。对于大多数用例，这是推荐的起点。
- **显式缓存断点：**直接在各个内容块上放置 `cache_control`，以精细控制具体缓存哪些内容。

提示缓存相对于基础输入令牌费率使用以下定价乘数：

| 缓存操作 | 乘数 | 持续时间 |
|:----------------|:-----------|:---------|
| 5 分钟缓存写入 | 基础输入价格的 1.25 倍 | 缓存有效期 5 分钟 |
| 1 小时缓存写入 | 基础输入价格的 2 倍 | 缓存有效期 1 小时 |
| 缓存读取（命中） | 基础输入价格的 0.1 倍 | 与前一次写入的持续时间相同 |

缓存写入令牌在内容首次存储时计费。缓存读取令牌在后续请求检索缓存内容时计费。一次缓存命中的成本为标准输入价格的 10%，这意味着对于 5 分钟持续时间（1.25 倍写入），仅需一次缓存读取即可收回成本；对于 1 小时持续时间（2 倍写入），两次缓存读取后即可收回成本。

这些乘数可与其他定价修饰符叠加，包括 Batch API 折扣和数据驻留。

有关实现细节、支持的模型和代码示例，请参阅[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)。

### 数据驻留定价 \{#data-residency-pricing}

对于 Claude Opus 4.6、Claude Sonnet 4.6 及更高版本的模型，通过 `inference_geo` 参数指定仅限美国推理会对所有令牌定价类别（包括输入令牌、输出令牌、缓存写入和缓存读取）应用 1.1 倍的乘数。全球路由（默认）使用标准定价。

这适用于 Claude API（第一方）和 Claude Platform on AWS。合作伙伴运营的平台（Bedrock 和 Vertex AI）有独立的区域定价。详情请参阅 [Bedrock](https://aws.amazon.com/bedrock/pricing/) 和 [Vertex AI](https://cloud.google.com/vertex-ai/generative-ai/pricing#claude-models)。早期模型不支持 `inference_geo` 参数，始终使用标准定价；在这些模型上包含该参数的请求将返回 400 错误。

有关更多信息，请参阅[数据驻留](/docs/zh-CN/manage-claude/data-residency)。

### 快速模式定价 \{#fast-mode-pricing}

[快速模式](/docs/zh-CN/build-with-claude/fast-mode)（Fast mode）目前处于研究预览阶段，以高级定价为 Claude Opus 4.8、Claude Opus 4.7 和 Claude Opus 4.6 提供显著更快的输出。快速模式定价适用于整个上下文窗口，包括超过 20 万输入令牌的请求。快速模式在 Claude Platform on AWS 上不可用。

| 模型 | 输入 | 输出 |
|:------|:------|:-------|
| Claude Opus 4.6 / Claude Opus 4.7 | $30 / MTok | $150 / MTok |
| Claude Opus 4.8 | $10 / MTok | $50 / MTok |

快速模式定价可与其他定价修饰符叠加：
- [提示缓存乘数](#prompt-caching)在快速模式定价基础上叠加应用
- [数据驻留](/docs/zh-CN/manage-claude/data-residency)乘数在快速模式定价基础上叠加应用

快速模式不可与 [Batch API](#batch-processing) 一起使用。

有关更多信息，请参阅[快速模式](/docs/zh-CN/build-with-claude/fast-mode)。

### 批处理 \{#batch-processing}

Batch API 允许异步处理大量请求，输入和输出令牌均享受 50% 的折扣。

| 模型             | 批量输入      | 批量输出    |
|-------------------|------------------|-----------------|
| Claude Fable 5        | $5 / MTok        | $25 / MTok      |
| Claude Mythos 5（[限量供应](https://anthropic.com/glasswing)） | $5 / MTok        | $25 / MTok      |
| Claude Opus 4.8       | $2.50 / MTok     | $12.50 / MTok   |
| Claude Opus 4.7       | $2.50 / MTok     | $12.50 / MTok   |
| Claude Opus 4.6       | $2.50 / MTok     | $12.50 / MTok   |
| Claude Opus 4.5     | $2.50 / MTok     | $12.50 / MTok   |
| Claude Opus 4.1（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $7.50 / MTok     | $37.50 / MTok   |
| Claude Opus 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $7.50 / MTok     | $37.50 / MTok   |
| Claude Sonnet 4.6   | $1.50 / MTok     | $7.50 / MTok    |
| Claude Sonnet 4.5   | $1.50 / MTok     | $7.50 / MTok    |
| Claude Sonnet 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $1.50 / MTok     | $7.50 / MTok    |
| Claude Haiku 4.5  | $0.50 / MTok     | $2.50 / MTok    |
| Claude Haiku 3.5（[已停用，Bedrock 和 Vertex AI 除外](/docs/zh-CN/about-claude/model-deprecations)） | $0.40 / MTok     | $2 / MTok       |

有关批处理的更多信息，请参阅[批处理](/docs/zh-CN/build-with-claude/batch-processing)。

### 长上下文定价 \{#long-context-pricing}

Claude Fable 5、[Claude Mythos 5](https://anthropic.com/glasswing)、[Claude Mythos Preview](https://anthropic.com/glasswing)、Claude Opus 4.8、Opus 4.7、Opus 4.6 和 Sonnet 4.6 以标准定价包含完整的 [100 万令牌上下文窗口](/docs/zh-CN/build-with-claude/context-windows)。（90 万令牌的请求与 9 千令牌的请求按相同的每令牌费率计费。）提示缓存和批处理折扣在整个上下文窗口范围内按标准费率应用。

### 工具使用定价 \{#tool-use-pricing}

工具使用请求的定价基于以下因素：
1. 发送给模型的输入令牌总数（包括 `tools` 参数中的令牌）
2. 生成的输出令牌数量
3. 对于服务器端工具，还会产生基于使用量的额外费用（例如，网络搜索按每次执行的搜索收费）

客户端工具的定价与任何其他 Claude API 请求相同，而服务器端工具可能会根据其具体使用情况产生额外费用。

工具使用产生的额外令牌来自：

- API 请求中的 `tools` 参数（工具名称、描述和模式）
- API 请求和响应中的 `tool_use` 内容块
- API 请求中的 `tool_result` 内容块

当您使用 `tools` 时，API 还会自动为模型包含一个特殊的系统提示以启用工具使用。每个模型所需的工具使用令牌数量如下所列（不包括上述额外令牌）。请注意，该表格假设至少提供了 1 个工具。如果未提供任何 `tools`，则工具选择为 `none` 时使用 0 个额外的系统提示令牌。

| 模型                    | 工具选择                                          | 工具使用系统提示令牌数          |
|--------------------------|------------------------------------------------------|---------------------------------------------|
| Claude Opus 4.8                | `auto`、`none`<hr />`any`、`tool`   | 290 个令牌<hr />410 个令牌 |
| Claude Opus 4.7                | `auto`、`none`<hr />`any`、`tool`   | 675 个令牌<hr />804 个令牌 |
| Claude Opus 4.6              | `auto`、`none`<hr />`any`、`tool`   | 497 个令牌<hr />589 个令牌 |
| Claude Opus 4.5            | `auto`、`none`<hr />`any`、`tool`   | 496 个令牌<hr />588 个令牌 |
| Claude Opus 4.1（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | `auto`、`none`<hr />`any`、`tool`   | 313 个令牌<hr />315 个令牌 |
| Claude Opus 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | `auto`、`none`<hr />`any`、`tool`   | 313 个令牌<hr />315 个令牌 |
| Claude Sonnet 4.6          | `auto`、`none`<hr />`any`、`tool`   | 497 个令牌<hr />589 个令牌 |
| Claude Sonnet 4.5          | `auto`、`none`<hr />`any`、`tool`   | 496 个令牌<hr />588 个令牌 |
| Claude Sonnet 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | `auto`、`none`<hr />`any`、`tool`   | 313 个令牌<hr />315 个令牌 |
| Claude Haiku 4.5         | `auto`、`none`<hr />`any`、`tool`   | 496 个令牌<hr />588 个令牌 |
| Claude Haiku 3.5（[已停用，Bedrock 和 Vertex AI 除外](/docs/zh-CN/about-claude/model-deprecations)） | `auto`、`none`<hr />`any`、`tool`   | 264 个令牌<hr />355 个令牌 |

这些令牌数会被添加到您的常规输入和输出令牌中，以计算请求的总费用。

有关当前各模型的价格，请参阅[模型定价](#model-pricing)部分。

有关工具使用实现和最佳实践的更多信息，请参阅[工具使用](/docs/zh-CN/agents-and-tools/tool-use/overview)。

### 特定工具定价 \{#specific-tool-pricing}

#### Bash 工具 \{#bash-tool}

bash 工具会为您的 API 调用增加 **245 个输入令牌**。

以下内容会消耗额外的令牌：
- 命令输出（stdout/stderr）
- 错误消息
- 大型文件内容

有关完整的定价详情，请参阅[工具使用定价](#tool-use-pricing)。

#### 代码执行工具 \{#code-execution-tool}

**与网页搜索或网页抓取一起使用时，代码执行免费。** 当您的 API 请求中包含 `web_search_20260209` 或 `web_fetch_20260209` 时，除标准输入和输出令牌费用外，代码执行工具调用不会产生额外费用。

在不与这些工具一起使用时，代码执行按执行时间计费，与令牌使用量分开计算：

- 执行时间最少按 5 分钟计算
- 每个组织每月可获得 **1,550 小时免费**使用时长
- 超出 1,550 小时的额外使用量按**每个容器每小时 0.05 美元**计费
- 如果请求中包含文件，即使未调用该工具，也会按执行时间计费，因为文件会被预加载到容器中

代码执行使用情况会在响应中进行跟踪：

```json
{
  "usage": {
    "input_tokens": 105,
    "output_tokens": 239,
    "server_tool_use": {
      "code_execution_requests": 1
    }
  }
}
```

#### 文本编辑器工具 \{#text-editor-tool}

文本编辑器工具采用与 Claude 使用的其他工具相同的定价结构。它遵循基于您所使用的 Claude 模型的标准输入和输出 "token"（令牌）定价。

除基础令牌外，文本编辑器工具还需要以下额外的输入令牌：

| 工具 | 额外输入令牌 |
| ----------------------------------------- | --------------------------------------- |
| `text_editor_20250429`（Claude 4.x） | 700 个令牌 |

有关完整的定价详情，请参阅[工具使用定价](#tool-use-pricing)。

#### 网络搜索工具 \{#web-search-tool}

网络搜索的使用费用在令牌使用费用之外单独收取：

```json
{
  "usage": {
    "input_tokens": 105,
    "output_tokens": 6039,
    "cache_read_input_tokens": 7123,
    "cache_creation_input_tokens": 7345,
    "server_tool_use": {
      "web_search_requests": 1
    }
  }
}
```

网络搜索在 Claude API 上的价格为**每 1,000 次搜索 10 美元**，另加搜索生成内容的标准令牌费用。在整个对话过程中检索到的网络搜索结果均计为输入令牌，包括单轮对话中执行的搜索迭代以及后续对话轮次中的结果。

每次网络搜索计为一次使用，无论返回多少条结果。如果在网络搜索过程中发生错误，该次网络搜索将不会计费。

#### 网页获取工具 \{#web-fetch-tool}

Web fetch（网页抓取）的使用除标准令牌费用外**不产生额外费用**：

```json
{
  "usage": {
    "input_tokens": 25039,
    "output_tokens": 931,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0,
    "server_tool_use": {
      "web_fetch_requests": 1
    }
  }
}
```

Web fetch 工具在 Claude API 上可用，且**无需额外付费**。您只需为成为对话上下文一部分的抓取内容支付标准令牌费用。

为防止意外抓取会消耗过多令牌的大型内容，请使用 `max_content_tokens` 参数，根据您的使用场景和预算考量设置适当的限制。

典型内容的令牌使用量示例：
- 普通网页（10&nbsp;kB）：约 2,500 个令牌
- 大型文档页面（100&nbsp;kB）：约 25,000 个令牌
- 研究论文 PDF（500&nbsp;kB）：约 125,000 个令牌

#### 计算机使用工具 \{#computer-use-tool}

计算机使用遵循标准的[工具使用定价](/docs/zh-CN/agents-and-tools/tool-use/overview#pricing)。使用计算机使用工具时：

**系统提示开销**：计算机使用测试版会向系统提示添加 466-499 个令牌

**计算机使用工具的令牌用量**：
| 模型 | 每个工具定义的输入令牌数 |
| ----- | -------------------------------- |
| Claude 4.x 模型 | 735 个令牌 |

**额外的令牌消耗**：
- 屏幕截图图像（请参阅[视觉定价](/docs/zh-CN/build-with-claude/vision)）
- 返回给 Claude 的工具执行结果

<Note>
如果您在使用计算机使用工具的同时还使用 bash 或文本编辑器工具，这些工具有各自的令牌成本，详见其各自的文档页面。
</Note>

## Claude Managed Agents 定价 \{#claude-managed-agents-pricing}

[Claude Managed Agents](/docs/zh-CN/managed-agents/overview) 按两个维度计费：令牌和会话运行时间。

### 令牌 \{#tokens}

Claude Managed Agents 会话消耗的所有令牌均按[模型定价](#model-pricing)中显示的费率计费。[提示缓存](#prompt-caching)乘数同样适用。会话内触发的网络搜索按标准的每 1,000 次搜索 $10 收费。在 [Claude Platform on AWS](#claude-platform-on-aws-pricing) 上，会话令牌和运行时间费用按标准比率转换为 Claude 消费单位。

以下 Messages API 修饰符**不**适用于 Claude Managed Agents 会话：

| 修饰符 | 不适用的原因 |
| --- | --- |
| [Batch API 折扣](#batch-processing) | 会话是有状态且交互式的。没有批处理模式。 |
| [快速模式溢价](#fast-mode-pricing) | 推理速度由运行时管理。 |
| [数据驻留乘数](#data-residency-pricing) | `inference_geo` 是 Messages API 请求字段。 |
| [云平台定价](#cloud-platform-pricing) | 在合作伙伴运营的云平台上不可用。 |

### 会话运行时间 \{#session-runtime}

| SKU | 费率 | 计量方式 |
| --- | --- | --- |
| 会话运行时间 | 每会话小时 $0.08 | `running` 状态持续时间 |

运行时间精确到毫秒计量，仅在会话状态为 `running` 时累计。处于 `idle`（等待您的下一条消息或工具确认）、`rescheduling` 或 `terminated` 状态的时间不计入运行时间。

<Note>
使用 Claude Managed Agents 时，会话运行时间取代了[代码执行](#code-execution-tool)的容器小时计费模式。您不会在会话运行时间之外被单独收取容器小时费用。
</Note>

### 计算示例 \{#worked-example}

一个使用 Claude Opus 4.8 的一小时编码会话，消耗 50,000 个输入令牌和 15,000 个输出令牌：

| 行项目 | 计算 | 成本 |
| --- | --- | --- |
| 输入令牌 | 50,000 × $5 / 1,000,000 | $0.25 |
| 输出令牌 | 15,000 × $25 / 1,000,000 | $0.375 |
| 会话运行时间 | 1.0 小时 × $0.08 | $0.08 |
| **总计** | | **$0.705** |

如果提示缓存处于活动状态，且 40,000 个输入令牌为缓存读取：

| 行项目 | 计算 | 成本 |
| --- | --- | --- |
| 未缓存的输入令牌 | 10,000 × $5 / 1,000,000 | $0.05 |
| 缓存读取令牌 | 40,000 × $5 × 0.1 / 1,000,000 | $0.02 |
| 输出令牌 | 15,000 × $25 / 1,000,000 | $0.375 |
| 会话运行时间 | 1.0 小时 × $0.08 | $0.08 |
| **总计** | | **$0.525** |

<Note>
  处理 10,000 张支持工单的示例计算：
  - 每次对话平均约 3,700 个令牌
  - 使用 Claude Haiku 4.5，输入 $1/MTok，输出 $5/MTok
  - 总成本：每 10,000 张工单约 $37.00
</Note>

有关此计算的详细演练，请参阅[客户支持智能体指南](/docs/zh-CN/about-claude/use-case-guides/customer-support-chat)。

## 其他定价注意事项 \{#additional-pricing-considerations}

### 成本优化策略 \{#cost-optimization-strategies}

使用 Claude 构建智能体时：

1. **使用合适的模型：**简单任务选择 Haiku，大多数生产工作负载选择 Sonnet，最复杂的推理任务选择 Opus
2. **实施提示缓存：**降低重复上下文的成本
3. **批量操作：**对非时间敏感的任务使用 Batch API
4. **监控使用模式：**跟踪令牌消耗以识别优化机会

<Tip>
  对于高流量的智能体应用，请联系[企业销售团队](https://claude.com/contact-sales)以获取定制定价方案。
</Tip>

### 速率限制 \{#rate-limits}

速率限制因使用层级而异，会影响您可以发出的请求数量：

- **第 1 层：**入门级使用，基本限制
- **第 2 层：**为成长中的应用提供更高的限制
- **第 3 层：**为成熟应用提供更高的限制
- **第 4 层：**最高标准限制
- **企业级：**可提供自定义限制

有关详细的速率限制信息，请参阅[速率限制](/docs/zh-CN/api/rate-limits)。

如需更高的速率限制或定制定价方案，请[联系销售团队](https://claude.com/contact-sales)。

### 批量折扣 \{#volume-discounts}

高用量用户可能享有批量折扣。这些折扣根据具体情况协商确定。

- 标准层级使用[模型定价](#model-pricing)中显示的定价
- 企业客户可以[联系销售](mailto:sales@anthropic.com)获取定制定价
- 可能提供学术和研究折扣

### 企业定价 \{#enterprise-pricing}

对于有特定需求的企业客户：

- 自定义速率限制
- 批量折扣
- 专属支持
- 定制条款

请通过 [sales@anthropic.com](mailto:sales@anthropic.com) 或 [Claude Console](/settings/limits) 联系销售团队，讨论企业定价选项。

## 账单与付款 \{#billing-and-payment}

- 账单基于实际月度使用量
- 所有付款均以美元结算
- 提供信用卡和发票付款选项
- 可在 [Claude Console](/) 中跟踪使用情况

## 常见问题 \{#frequently-asked-questions}

**令牌使用量如何计算？**

令牌是模型处理的文本片段。粗略估算，1 个令牌大约相当于 4 个字符或 0.75 个英文单词。确切数量因语言和内容类型而异。

**是否有免费层级或试用？**

新用户会获得少量免费额度用于测试 API。如需了解企业评估的延长试用信息，请[联系销售](mailto:sales@anthropic.com)。

**折扣如何叠加？**

Batch API 和提示缓存折扣可以组合使用。例如，同时使用这两项功能与标准 API 调用相比可显著节省成本。有关乘数如何相互作用，请参阅[提示缓存定价](#prompt-caching)。

**接受哪些付款方式？**

标准账户接受主要信用卡。企业客户可以安排发票付款和其他付款方式。

如有其他定价相关问题，请联系 [support@anthropic.com](mailto:support@anthropic.com)。