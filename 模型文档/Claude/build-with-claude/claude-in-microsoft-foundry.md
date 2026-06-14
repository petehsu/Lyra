# Microsoft Foundry 中的 Claude

通过 Microsoft Foundry 使用 Azure 原生端点和身份验证访问 Claude 模型。

---

本指南将引导您完成在 Foundry 中设置并使用 Anthropic 的客户端 SDK 或直接 HTTP 请求对 Claude 进行 API 调用的过程。当您在 Foundry 中访问 Claude 时，Claude 的使用费用将通过 Microsoft Marketplace 计费，这使您能够在通过 Azure 订阅管理成本的同时，使用 Claude 的最新功能。

区域可用性：在发布时，Claude 在 Foundry 资源中作为 Global Standard 部署类型提供。Microsoft Marketplace 中 Claude 的定价采用 Anthropic 的标准 API 定价。请访问[定价](https://claude.com/pricing#api)了解详情。

<Note>
Foundry 受 C#、Java、PHP、Python 和 TypeScript SDK 支持。Go 和 Ruby SDK 目前不支持 Microsoft Foundry。
</Note>

## 预览 \{#preview}

在此预览平台集成中，Claude 模型运行在 Anthropic 的基础设施上。这是一个通过 Azure 进行计费和访问的商业集成。作为 Microsoft 的独立处理方，通过 Microsoft Foundry 使用 Claude 的客户须遵守 Anthropic 的数据使用条款。Anthropic 将继续提供其行业领先的安全和数据承诺，包括零数据保留的可用性。

## 前提条件 \{#prerequisites}

在开始之前，请确保您具备以下条件：

- 有效的 Azure 订阅
- 可访问 [Foundry](https://ai.azure.com/)
- 已安装 [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli)（可选，用于资源管理）

## 安装 SDK \{#install-an-sdk}

Anthropic 的[客户端 SDK](/docs/zh-CN/cli-sdks-libraries/overview) 通过特定于平台的包或客户端类支持 Foundry。

<Tabs>
<Tab title="Python">
```bash
pip install -U "anthropic"
```
</Tab>

<Tab title="TypeScript">
```bash
npm install @anthropic-ai/foundry-sdk
```
</Tab>

<Tab title="C#">
```bash
dotnet add package Anthropic.Foundry
```
</Tab>

<Tab title="Java">
<Tabs>
<Tab title="Gradle">
```kotlin
implementation("com.anthropic:anthropic-java-foundry:2.40.0")
```
</Tab>
<Tab title="Maven">
```xml
<dependency>
    <groupId>com.anthropic</groupId>
    <artifactId>anthropic-java-foundry</artifactId>
    <version>2.40.0</version>
</dependency>
```
</Tab>
</Tabs>
</Tab>

<Tab title="PHP">
```bash
composer require anthropic-ai/sdk
```
</Tab>
</Tabs>

## 资源配置 \{#provisioning}

Foundry 使用两级层次结构：**资源**包含您的安全和计费配置，而**部署**是您通过 API 调用的模型实例。您需要先创建一个 Foundry 资源，然后在其中创建一个或多个 Claude 部署。

### 配置 Foundry 资源 \{#provisioning-foundry-resources}

创建一个 Foundry 资源，这是在 Azure 中使用和管理服务所必需的。您可以按照以下说明创建 [Foundry 资源](https://learn.microsoft.com/en-us/azure/ai-services/multi-service-resource?pivots=azportal#create-a-new-azure-ai-foundry-resource)。或者，您也可以从创建 [Foundry 项目](https://learn.microsoft.com/en-us/azure/ai-foundry/how-to/create-projects?tabs=ai-foundry)开始，该过程包含创建 Foundry 资源。

要配置您的资源：

1. 导航到 [Foundry 门户](https://ai.azure.com/)
2. 创建新的 Foundry 资源或选择现有资源
3. 使用 Azure 颁发的 API 密钥或 Entra ID（前身为 Azure Active Directory）配置访问管理，以实现基于角色的访问控制
4. 可选择将资源配置为私有网络（Azure 虚拟网络）的一部分，以增强安全性
5. 记下您的资源名称。您将在 API 端点中将其用作 `{resource}`（例如，`https://{resource}.services.ai.azure.com/anthropic/v1/*`）

### 创建 Foundry 部署 \{#creating-foundry-deployments}

创建资源后，部署 Claude 模型以使其可用于 API 调用：

1. 在 Foundry 门户中，导航到您的资源
2. 转到 **Models + endpoints**（模型 + 端点），然后选择 **+ Deploy model**（+ 部署模型）> **Deploy base model**（部署基础模型）
3. 搜索并选择一个 Claude 模型（例如，`claude-sonnet-4-6`）
4. 配置部署设置：
   - **Deployment name（部署名称）：** 默认为模型 ID，但您可以自定义（例如，`my-claude-deployment`）。部署名称在创建后无法更改。
   - **Deployment type（部署类型）：** 选择 Global Standard（推荐用于 Claude）
5. 选择 **Deploy**（部署）并等待配置完成
6. 部署完成后，您可以在 **Keys and Endpoint**（密钥和端点）下找到您的端点 URL 和密钥

<Note>
  您选择的部署名称将成为您在 API 请求的 `model` 参数中传递的值。您可以为同一模型创建多个具有不同名称的部署，以管理不同的配置或速率限制。
</Note>

## 身份验证 \{#authentication}

Foundry 中的 Claude 支持两种身份验证方法：API 密钥和 Entra ID 令牌。两种方法都使用格式为 `https://{resource}.services.ai.azure.com/anthropic/v1/*` 的 Azure 托管端点。

### API 密钥身份验证 \{#api-key-authentication}

配置 Foundry Claude 资源后，您可以从 Foundry 门户获取 API 密钥：

1. 在 Foundry 门户中导航到您的资源
2. 转到 **Keys and Endpoint**（密钥和端点）部分
3. 复制提供的 API 密钥之一
4. 在请求中使用 `api-key` 或 `x-api-key` 标头，或将其提供给 SDK

Foundry SDK 需要 API 密钥以及资源名称或基础 URL。如果定义了以下环境变量，C#、Java、PHP、Python 和 TypeScript SDK 会自动从中读取这些值：

- `ANTHROPIC_FOUNDRY_API_KEY` - 您的 API 密钥
- `ANTHROPIC_FOUNDRY_RESOURCE` - 您的资源名称（例如，`example-resource`）
- `ANTHROPIC_FOUNDRY_BASE_URL` - 资源名称的替代方案；完整的基础 URL（例如，`https://example-resource.services.ai.azure.com/anthropic/`）

<Note>
`resource` 和 `base_url` 参数是互斥的。请提供资源名称（SDK 会使用它构建 URL，格式为 `https://{resource}.services.ai.azure.com/anthropic/`）或直接提供完整的基础 URL。
</Note>

**使用 API 密钥的示例：**

<Tabs>
<Tab title="cURL">

```bash cURL nocheck
curl https://{resource}.services.ai.azure.com/anthropic/v1/messages \
  -H "content-type: application/json" \
  -H "api-key: YOUR_AZURE_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```
</Tab>

<Tab title="CLI">

```bash CLI nocheck
# ant reads ANTHROPIC_API_KEY and sends it as x-api-key, which Foundry accepts
export ANTHROPIC_API_KEY="YOUR_AZURE_API_KEY"

ant messages create \
  --base-url https://example-resource.services.ai.azure.com/anthropic \
  --model claude-opus-4-8 \
  --max-tokens 1024 \
  --message '{role: user, content: "Hello!"}' \
  --transform content
```
</Tab>

<Tab title="Python">

```python nocheck
import os
from anthropic import AnthropicFoundry

client = AnthropicFoundry(
    api_key=os.environ.get("ANTHROPIC_FOUNDRY_API_KEY"),
    resource="example-resource",  # your resource name
)

message = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content)
```
</Tab>

<Tab title="TypeScript">

```typescript nocheck
import AnthropicFoundry from "@anthropic-ai/foundry-sdk";

const client = new AnthropicFoundry({
  apiKey: process.env.ANTHROPIC_FOUNDRY_API_KEY,
  resource: "example-resource" // your resource name
});

const message = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }]
});
console.log(message.content);
```
</Tab>

<Tab title="C#">

```csharp nocheck
using Anthropic.Foundry;
using Anthropic.Models.Messages;

var client = new AnthropicFoundryClient(
    new AnthropicFoundryApiKeyCredentials(
        Environment.GetEnvironmentVariable("ANTHROPIC_FOUNDRY_API_KEY")!,
        "example-resource"
    )
);

var response = await client.Messages.Create(new MessageCreateParams
{
    Model = "claude-opus-4-8",
    MaxTokens = 1024,
    Messages = [new() { Role = Role.User, Content = "Hello!" }],
});

Console.WriteLine(
    string.Join("", response.Content
        .Select(block => block.Value)
        .OfType<TextBlock>()
        .Select(textBlock => textBlock.Text)));
```
</Tab>

<Tab title="Java">

```java Java nocheck
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.foundry.backends.FoundryBackend;
import com.anthropic.models.messages.MessageCreateParams;

void main() {
    // Requires env vars: ANTHROPIC_FOUNDRY_API_KEY, ANTHROPIC_FOUNDRY_RESOURCE
    AnthropicClient client = AnthropicOkHttpClient.builder()
        .backend(FoundryBackend.fromEnv())
        .build();

    MessageCreateParams params = MessageCreateParams.builder()
        .model("claude-opus-4-8")
        .maxTokens(1024)
        .addUserMessage("Hello!")
        .build();

    client.messages().create(params).content().stream()
        .flatMap(block -> block.text().stream())
        .forEach(textBlock -> System.out.println(textBlock.text()));
}
```
</Tab>

<Tab title="PHP">

```php PHP nocheck
<?php

use Anthropic\Foundry;

$client = Foundry\Client::withCredentials(
    apiKey: getenv('ANTHROPIC_FOUNDRY_API_KEY'),
    baseUrl: 'https://example-resource.services.ai.azure.com/anthropic/v1',
);

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'Hello!']
    ],
    model: 'claude-opus-4-8',
);
echo $message->content[0]->text;
```
</Tab>

<Tab title="Ruby">
<Note>
Anthropic Ruby SDK 目前不支持 Microsoft Foundry。您可以使用标准的 `Anthropic::Client` 并设置指向您的 Foundry 端点的自定义 `base_url`，但 Azure 特定的身份验证（Entra ID）并未内置。如需完整的 Foundry 支持，请使用 C#、Java、PHP、Python 或 TypeScript SDK。
</Note>
</Tab>
</Tabs>

<Warning>
请妥善保管您的 API 密钥。切勿将其提交到版本控制系统或公开共享。任何拥有您 API 密钥的人都可以通过您的 Foundry 资源向 Claude 发出请求。
</Warning>

### Microsoft Entra 身份验证 \{#microsoft-entra-authentication}

为了增强安全性和集中化访问管理，您可以使用 Entra ID 令牌：

1. 为您的 Foundry 资源启用 Entra 身份验证
2. 从 Entra ID 获取访问令牌
3. 在 `Authorization: Bearer {TOKEN}` 标头中使用该令牌

**使用 Entra ID 的示例：**

<Tabs>
<Tab title="cURL">

```bash cURL nocheck
# Get Microsoft Entra ID token
ACCESS_TOKEN=$(az account get-access-token --resource https://cognitiveservices.azure.com --query accessToken -o tsv)

# Make request with token. Replace {resource} with your resource name
curl https://{resource}.services.ai.azure.com/anthropic/v1/messages \
  -H "content-type: application/json" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello!"}
    ]
  }'
```
</Tab>

<Tab title="Python">

```python nocheck
import os
from anthropic import AnthropicFoundry
from azure.identity import DefaultAzureCredential, get_bearer_token_provider

# Get Microsoft Entra ID token using token provider pattern
token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)

# Create client with Entra ID authentication
client = AnthropicFoundry(
    resource="example-resource",  # your resource name
    azure_ad_token_provider=token_provider,  # Use token provider for Entra ID auth
)

# Make request
message = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content)
```
</Tab>

<Tab title="TypeScript">

```typescript nocheck
import AnthropicFoundry from "@anthropic-ai/foundry-sdk";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";

// Get Entra ID token using token provider pattern
const credential = new DefaultAzureCredential();
const tokenProvider = getBearerTokenProvider(
  credential,
  "https://cognitiveservices.azure.com/.default"
);

// Create client with Entra ID authentication
const client = new AnthropicFoundry({
  resource: "example-resource", // your resource name
  azureADTokenProvider: tokenProvider // Use token provider for Entra ID auth
});

// Make request
const message = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }]
});
console.log(message.content);
```
</Tab>

<Tab title="C#">

```csharp nocheck
using Anthropic.Foundry;
using Anthropic.Models.Messages;
using Azure.Identity;

var client = new AnthropicFoundryClient(
    new AnthropicFoundryIdentityTokenCredentials(
        new DefaultAzureCredential(),
        "example-resource"
    )
);

var response = await client.Messages.Create(new MessageCreateParams
{
    Model = "claude-opus-4-8",
    MaxTokens = 1024,
    Messages = [new() { Role = Role.User, Content = "Hello!" }],
});

Console.WriteLine(
    string.Join("", response.Content
        .Select(block => block.Value)
        .OfType<TextBlock>()
        .Select(textBlock => textBlock.Text)));
```
</Tab>

<Tab title="Java">

```java Java nocheck hidelines={1..2,4,8}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.foundry.backends.FoundryBackend;
import com.anthropic.models.messages.MessageCreateParams;
import com.azure.identity.AuthenticationUtil;
import com.azure.identity.DefaultAzureCredentialBuilder;
import java.util.function.Supplier;

void main() {
    Supplier<String> bearerTokenSupplier = AuthenticationUtil.getBearerTokenSupplier(
        new DefaultAzureCredentialBuilder().build(),
        "https://cognitiveservices.azure.com/.default"
    );

    AnthropicClient client = AnthropicOkHttpClient.builder()
        .backend(FoundryBackend.builder()
            .bearerTokenSupplier(bearerTokenSupplier)
            .resource("example-resource")
            .build())
        .build();

    MessageCreateParams params = MessageCreateParams.builder()
        .model("claude-opus-4-8")
        .maxTokens(1024)
        .addUserMessage("Hello!")
        .build();

    client.messages().create(params).content().stream()
        .flatMap(block -> block.text().stream())
        .forEach(textBlock -> System.out.println(textBlock.text()));
}
```
</Tab>

<Tab title="PHP">

```php PHP nocheck
<?php

use Anthropic\Foundry;

// Obtain an Entra ID access token, for example via the Azure CLI:
//   az account get-access-token --resource https://cognitiveservices.azure.com \
//     --query accessToken -o tsv
$token = getenv('AZURE_ACCESS_TOKEN');

$client = Foundry\Client::withCredentials(
    authToken: $token,
    baseUrl: 'https://example-resource.services.ai.azure.com/anthropic/v1',
);

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'Hello!']
    ],
    model: 'claude-opus-4-8',
);
echo $message->content[0]->text;
```
</Tab>

<Tab title="Ruby">
<Note>
Anthropic Ruby SDK 目前不支持 Microsoft Foundry。您可以使用标准的 `Anthropic::Client` 并设置指向您的 Foundry 端点的自定义 `base_url`，但 Azure 特定的身份验证（Entra ID）并未内置。如需完整的 Foundry 支持，请使用 C#、Java、PHP、Python 或 TypeScript SDK。
</Note>
</Tab>
</Tabs>

<Note>
Microsoft Entra ID 身份验证允许您使用 Azure RBAC 管理访问权限，与您组织的身份管理系统集成，并避免手动管理 API 密钥。
</Note>

## 关联请求 ID \{#correlation-request-ids}

Foundry 在 HTTP 响应标头中包含请求标识符，用于调试和追踪。联系支持团队时，请同时提供 `request-id` 和 `apim-request-id` 的值，以帮助团队在 Anthropic 和 Azure 系统中快速定位和调查您的请求。

## 功能支持 \{#feature-support}

Foundry 中的 Claude 支持 Claude 的大多数强大功能。您可以在[功能概览](/docs/zh-CN/build-with-claude/overview)中找到当前支持的所有功能。

### 上下文窗口 \{#context-window}

Claude Fable 5、Claude Opus 4.7、Claude Opus 4.6 和 Claude Sonnet 4.6 在 Microsoft Foundry 上拥有 [100 万令牌的上下文窗口](/docs/zh-CN/build-with-claude/context-windows)。其他 Claude 模型（包括 Claude Opus 4.8 和 Sonnet 4.5）拥有 20 万令牌的上下文窗口。

### 不支持的功能 \{#features-not-supported}

- Admin API
- Compliance API
- Models API
- Message Batches API
- 服务器端回退（[`fallbacks` 参数](/docs/zh-CN/build-with-claude/refusals-and-fallback#server-side-fallback)；请改用[客户端回退模式](/docs/zh-CN/build-with-claude/refusals-and-fallback#client-side-fallback)）

## API 响应 \{#api-responses}

Foundry 中 Claude 的 API 响应遵循标准的 [Claude API 响应格式](/docs/zh-CN/api/messages/create)。这包括响应正文中的 `usage` 对象，该对象提供您请求的详细令牌消耗信息。`usage` 对象在所有平台（Claude API、Foundry、AWS 上的 Claude Platform、Amazon Bedrock 和 Vertex AI）上保持一致。

有关 Foundry 特定响应标头的详细信息，请参阅[关联请求 ID](#correlation-request-ids)。

## API 模型 ID 和部署 \{#api-model-ids-and-deployments}

生命周期术语（已弃用、已停用）在[模型弃用](/docs/zh-CN/about-claude/model-deprecations)中定义。Microsoft Foundry 遵循 Claude API 的生命周期计划。

以下 Claude 模型可通过 Foundry 使用。最新一代模型（Claude Fable 5、Opus 4.8、Opus 4.7、Opus 4.6、Sonnet 4.6 和 Haiku 4.5）提供最先进的功能：

| 模型             | 默认部署名称     |
| :---------------- | :-------------------------- |
| Claude Fable 5    | claude-fable-5 |
| Claude Opus 4.8   | claude-opus-4-8 |
| Claude Opus 4.7   | claude-opus-4-7           |
| Claude Opus 4.6   | claude-opus-4-6           |
| Claude Opus 4.5   | claude-opus-4-5           |
| Claude Opus 4.1 <br /><small>已弃用。将于 2026 年 8 月 5 日停用。</small> | claude-opus-4-1           |
| Claude Sonnet 4.6 | claude-sonnet-4-6         |
| Claude Sonnet 4.5 | claude-sonnet-4-5         |
| Claude Haiku 4.5  | claude-haiku-4-5          |

默认情况下，部署名称与上表中显示的模型 ID 相匹配。但是，您可以在 Foundry 门户中创建具有不同名称的自定义部署，以管理不同的配置、版本或速率限制。在您的 API 请求中使用部署名称（不一定是模型 ID）。

<Tip>
正在升级到更新的 Claude 模型？在 Claude Code 中运行 `/claude-api migrate`，即可在整个代码库中应用模型 ID 替换和破坏性参数变更。该技能会检测您的代码所针对的云平台，并针对该平台调整模型 ID 格式和功能变更。请参阅[迁移到更新的 Claude 模型](/docs/zh-CN/agents-and-tools/agent-skills/claude-api-skill#migrating-to-a-newer-claude-model)。
</Tip>

## 监控和日志记录 \{#monitoring-and-logging}

Azure 通过标准的 Azure 模式为您的 Claude 使用情况提供全面的监控和日志记录功能：

- **Azure Monitor：** 跟踪 API 使用情况、延迟和错误率
- **Azure Log Analytics：** 查询和分析请求/响应日志
- **成本管理：** 监控和预测与 Claude 使用相关的成本

Anthropic 建议至少以 30 天滚动方式记录您的活动，以了解使用模式并调查任何潜在问题。

<Note>
Azure 的日志记录服务在您的 Azure 订阅中配置。启用日志记录不会使 Microsoft 或 Anthropic 访问超出计费和服务运营所需范围的内容。
</Note>

## 故障排除 \{#troubleshooting}

### 身份验证错误 \{#authentication-errors}

**错误：** `401 Unauthorized` 或 `Invalid API key`

- **解决方案：** 验证您的 API 密钥是否正确。您可以从 Foundry 门户中您的 Foundry 资源的 **Keys and Endpoint**（密钥和端点）下获取新的 API 密钥。
- **解决方案：** 如果使用 Microsoft Entra ID，请确保您的访问令牌有效且未过期。令牌通常在 1 小时后过期。

**错误：** `403 Forbidden`

- **解决方案：** 您的 Azure 帐户可能缺少必要的权限。请确保您已分配适当的 Azure RBAC 角色（例如，"Cognitive Services OpenAI User"）。

### 速率限制 \{#rate-limiting}

**错误：** `429 Too Many Requests`

- **解决方案：** 您已超出速率限制。请在您的应用程序中实现指数退避和重试逻辑。
- **解决方案：** 考虑通过 Azure 门户或 Azure 支持请求提高速率限制。

#### 速率限制标头 \{#rate-limit-headers}

Foundry 的响应中不包含 Anthropic 的标准速率限制标头（`anthropic-ratelimit-tokens-limit`、`anthropic-ratelimit-tokens-remaining`、`anthropic-ratelimit-tokens-reset`、`anthropic-ratelimit-input-tokens-limit`、`anthropic-ratelimit-input-tokens-remaining`、`anthropic-ratelimit-input-tokens-reset`、`anthropic-ratelimit-output-tokens-limit`、`anthropic-ratelimit-output-tokens-remaining` 和 `anthropic-ratelimit-output-tokens-reset`）。请改为通过 Azure 的监控工具管理速率限制。

### 模型和部署错误 \{#model-and-deployment-errors}

**错误：** `Model not found` 或 `Deployment not found`

- **解决方案：** 验证您使用的部署名称是否正确。如果您尚未创建自定义部署，请使用默认模型 ID（例如，`claude-sonnet-4-6`）。
- **解决方案：** 确保模型/部署在您的 Azure 区域中可用。

**错误：** `Invalid model parameter`

- **解决方案：** model 参数应包含您的部署名称，该名称可以在 Foundry 门户中自定义。请验证部署是否存在且配置正确。

<Info>
[Claude Mythos Preview](https://anthropic.com/glasswing) 是一个研究预览版，面向 Microsoft Foundry 上受邀的客户提供。有关更多信息，请参阅 [Project Glasswing](https://anthropic.com/glasswing)。
</Info>

## 其他资源 \{#additional-resources}

- **Foundry 文档：** [ai.azure.com/catalog](https://ai.azure.com/catalog/publishers/anthropic)
- **Azure 定价：** [azure.microsoft.com/en-us/pricing/details/ai-foundry](https://azure.microsoft.com/en-us/pricing/details/ai-foundry/#pricing)
- **Anthropic 定价详情：** [模型定价](/docs/zh-CN/about-claude/pricing#model-pricing)
- **身份验证指南：** 请参阅[身份验证](#authentication)
- **Azure 门户：** [portal.azure.com](https://portal.azure.com/)