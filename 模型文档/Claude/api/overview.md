# API 概述

---

Claude API 是一个位于 `https://api.anthropic.com` 的 RESTful API，提供对 Claude 模型和 Claude 托管智能体的编程访问。

<Note>
**初次使用 Claude？** 如需直接访问模型，请从[快速入门](/docs/zh-CN/get-started)和[使用 Messages](/docs/zh-CN/build-with-claude/working-with-messages) 开始。如需托管智能体基础设施，请参阅 [Claude 托管智能体快速入门](/docs/zh-CN/managed-agents/quickstart)。
</Note>

## 前提条件 \{#prerequisites}

要使用 Claude API，您需要：

- 一个 [Claude Console 账户](https://platform.claude.com)
- 一个 [API 密钥](/settings/keys)，或已配置的[工作负载身份联合](/docs/zh-CN/manage-claude/workload-identity-federation)规则

有关分步设置说明，请参阅[快速入门](/docs/zh-CN/get-started)。

## 可用的 API \{#available-apis}

Claude API 包含以下 API：

**正式发布：**
- **[Messages API](/docs/zh-CN/api/messages/create)**：向 Claude 发送消息以进行对话交互（`POST /v1/messages`）
- **[Message Batches API](/docs/zh-CN/api/creating-message-batches)**：异步处理大量 Messages 请求，成本降低 50%（`POST /v1/messages/batches`）
- **[Token Counting API](/docs/zh-CN/api/messages-count-tokens)**：在发送消息前统计令牌数量，以管理成本和速率限制（`POST /v1/messages/count_tokens`）
- **[Models API](/docs/zh-CN/api/models-list)**：列出可用的 Claude 模型及其详细信息（`GET /v1/models`）

**Beta 版：**
- **[Files API](/docs/zh-CN/api/files-create)**：上传和管理文件，以便在多个 API 调用中使用（`POST /v1/files`、`GET /v1/files`）
- **[Skills API](/docs/zh-CN/api/skills/create-skill)**：创建和管理自定义智能体技能（`POST /v1/skills`、`GET /v1/skills`）
- **[Agents API](/docs/zh-CN/managed-agents/agent-setup)**：为 Claude 托管智能体定义可复用的、带版本控制的智能体配置（`POST /v1/agents`、`GET /v1/agents`）
- **[Sessions API](/docs/zh-CN/managed-agents/sessions)**：在托管云沙箱中运行有状态的智能体会话（`POST /v1/sessions`、`GET /v1/sessions/{id}/stream`）
- **[Environments API](/docs/zh-CN/managed-agents/environments)**：为智能体会话配置沙箱模板（`POST /v1/environments`、`GET /v1/environments`）

如需查看包含所有端点、参数和响应架构的完整 API 参考，请浏览导航中列出的 API 参考页面。要访问 Beta 功能，请参阅 [Beta 请求头](/docs/zh-CN/api/beta-headers)。

## 身份验证 \{#authentication}

有关两种身份验证方法的详细信息以及各自的适用场景，请参阅[身份验证](/docs/zh-CN/manage-claude/authentication)。所有发送到 Claude API 的请求都必须包含以下请求头：

| 请求头 | 值 | 是否必需 |
|--------|-------|----------|
| `x-api-key` | 您从 Console 获取的 API 密钥 | `x-api-key` 或 `Authorization` 二选一 |
| `Authorization` | `Bearer <token>`，其中 `<token>` 是通过[工作负载身份联合](/docs/zh-CN/manage-claude/workload-identity-federation)从 `POST /v1/oauth/token` 获取的短期访问令牌 | `x-api-key` 或 `Authorization` 二选一 |
| `anthropic-version` | API 版本（例如 `2023-06-01`） | 是 |
| `content-type` | `application/json` | 是 |

如果您使用[客户端 SDK](#client-sdks)，SDK 将自动发送这些请求头。有关 API 版本控制的详细信息，请参阅 [API 版本](/docs/zh-CN/api/versioning)。

当通过[云平台](#claude-api-vs-cloud-platforms)访问 Claude 时，身份验证会与云提供商的 IAM 系统集成。有关支持的凭证类型、所需的请求头和身份验证选项，请参阅特定平台的文档。

### 获取 API 密钥 \{#getting-api-keys}

API 通过 Web 端的 [Console](https://platform.claude.com/) 提供。您可以使用 [Workbench](https://platform.claude.com/workbench) 在浏览器中试用 API，然后在[账户设置](https://platform.claude.com/settings/keys)中生成 API 密钥。使用[工作区](https://platform.claude.com/settings/workspaces)对您的 API 密钥进行分组，并按用例[控制支出](/docs/zh-CN/api/rate-limits)。

## 客户端 SDK \{#client-sdks}

Anthropic 提供官方 SDK，通过处理身份验证、请求格式化、错误处理等来简化 API 集成。

**优势：**
- 自动管理请求头（x-api-key、anthropic-version、content-type）
- 类型安全的请求和响应处理
- 内置重试逻辑和错误处理
- 流式传输支持
- 请求超时和连接管理

有关客户端 SDK 的列表，请参阅[客户端 SDK](/docs/zh-CN/cli-sdks-libraries/overview)。

## Claude API 与云平台对比 \{#claude-api-vs-cloud-platforms}

Claude 可通过直接的 Claude API 和云平台访问。请根据您的基础设施、功能可用性、合规要求和定价偏好进行选择。

### Claude API \{#claude-api}

- **直接访问**最新的模型和功能
- **Anthropic 计费和支持**
- **最适合：** 新集成、完整功能访问、与 Anthropic 的直接合作关系

### 云平台 API \{#cloud-platform-apis}

通过 AWS、Google Cloud 或 Microsoft Azure 访问 Claude：
- 与云提供商的计费和 IAM **集成**
- **功能可用性因平台而异：** Anthropic 运营的平台包括 [AWS 上的 Claude 平台](/docs/zh-CN/build-with-claude/claude-platform-on-aws)和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)；合作伙伴运营的平台包括 Amazon Bedrock 和 Vertex AI。有关功能可用性和时间安排，请参阅各平台的页面。
- **最适合：** 现有云承诺、特定合规要求、统一的云计费

| 平台 | 提供商 | 文档 |
|----------|----------|---------------|
| AWS 上的 Claude 平台 | AWS（Anthropic 运营） | [AWS 上的 Claude 平台](/docs/zh-CN/build-with-claude/claude-platform-on-aws) |
| Amazon Bedrock | AWS | [Amazon Bedrock 中的 Claude](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock) |
| Vertex AI | Google Cloud | [Vertex AI 上的 Claude](/docs/zh-CN/build-with-claude/claude-on-vertex-ai) |
| Microsoft Foundry | Microsoft Azure（Anthropic 运营） | [Microsoft Foundry 中的 Claude](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) |

<Note>
Claude 托管智能体可通过直接的 Claude API 和 [AWS 上的 Claude 平台](/docs/zh-CN/build-with-claude/claude-platform-on-aws)使用。有关各平台的功能可用性，请参阅[功能概述](/docs/zh-CN/build-with-claude/overview)。
</Note>

## 请求和响应格式 \{#request-and-response-format}

### 请求大小限制 \{#request-size-limits}

| 端点 | 最大请求大小 |
| --- | --- |
| Messages、Token Counting | 32 MB |
| [Message Batches API](/docs/zh-CN/build-with-claude/batch-processing) | 256 MB |
| [Files API](/docs/zh-CN/build-with-claude/files) | 500 MB |
| Sessions、Agents、Environments | 32 MB |

如果超出这些限制，您将收到 413 `request_too_large` 错误。

<Note>
合作伙伴运营的平台有各自的请求大小限制：Vertex AI 将请求限制为 30 MB，Bedrock 将请求限制为 20 MB。AWS 上的 Claude 平台使用与直接 Claude API 相同的限制。请查阅您所用平台的文档以获取当前值。
</Note>

### 响应头 \{#response-headers}

Claude API 在每个响应中都包含以下响应头：

- `request-id`：请求的全局唯一标识符
- `anthropic-organization-id`：与请求中使用的 API 密钥关联的组织 ID

<Note>
AWS 上的 Claude 平台会在标准 `request-id` 响应头之外额外添加一个 AWS 请求 ID（`x-amzn-requestid`）。有关双 ID 处理模式，请参阅[请求 ID](/docs/zh-CN/build-with-claude/claude-platform-on-aws#request-ids)。
</Note>

## 速率限制和可用性 \{#rate-limits-and-availability}

### 速率限制 \{#rate-limits}

API 强制执行速率限制和支出限制，以防止滥用并管理容量。限制按使用层级组织，随着您使用 API 而自动提升。每个层级包含：

- **支出限制**：API 使用的每月最高费用
- **速率限制**：每分钟最大请求数（RPM）和每分钟最大令牌数（TPM）

您可以在 [Console](/settings/limits) 中查看您组织的当前限制。如需更高的限制或优先层级（具有承诺支出的增强服务级别），请通过 Console 联系销售团队。

有关限制、层级以及用于速率限制的令牌桶算法的详细信息，请参阅[速率限制](/docs/zh-CN/api/rate-limits)。

### 可用性 \{#availability}

Claude API 在全球[众多国家和地区](/docs/zh-CN/api/supported-regions)可用。请查看支持的地区页面以确认您所在位置的可用性。

## 后续步骤 \{#next-steps}

<CardGroup cols={2}>
  <Card title="Messages API 参考" icon="book" href="/docs/zh-CN/api/messages/create">
    直接模型交互的完整 API 规范
  </Card>
  <Card title="Claude 托管智能体参考" icon="brain" href="/docs/zh-CN/managed-agents/sessions">
    Agents、Sessions 和 Environments 端点
  </Card>
  <Card title="客户端 SDK" icon="code" href="/docs/zh-CN/cli-sdks-libraries/overview">
    Python、TypeScript、C#、Go、Java、PHP 和 Ruby
  </Card>
  <Card title="速率限制" icon="gauge" href="/docs/zh-CN/api/rate-limits">
    使用层级、支出限制和令牌桶算法
  </Card>
</CardGroup>