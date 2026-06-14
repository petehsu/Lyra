# Vertex AI 上的 Claude

Anthropic 的 Claude 模型可通过 [Vertex AI](https://cloud.google.com/vertex-ai) 使用。

---

用于访问 Claude 的 Vertex API 与 [Messages API](/docs/zh-CN/api/messages/create) 几乎完全相同，但在请求格式上有两个关键区别：

* 在 Vertex 中，`model` 不在请求正文中传递，而是在 Google Cloud 端点 URL 中指定。
* 在 Vertex 中，`anthropic_version` 在请求正文中传递（而不是作为请求头），并且必须设置为值 `vertex-2023-10-16`。

Anthropic 的官方[客户端 SDK](/docs/zh-CN/cli-sdks-libraries/overview) 也支持 Vertex。本指南将引导您使用 Anthropic 的客户端 SDK 之一向 Vertex AI 上的 Claude 发出请求。

请注意，本指南假设您已经拥有一个能够使用 Vertex AI 的 GCP 项目。有关所需设置和完整演练的更多信息，请参阅 [Vertex AI 上的 Anthropic Claude 模型](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude)。

## 安装用于访问 Vertex AI 的 SDK \{#install-an-sdk-for-accessing-vertex-ai}

首先，安装您所选语言的 Anthropic [客户端 SDK](/docs/zh-CN/cli-sdks-libraries/overview)。

<Tabs>
<Tab title="Python">
```bash
pip install -U google-cloud-aiplatform "anthropic[vertex]"
```
</Tab>

<Tab title="TypeScript">
```bash
npm install @anthropic-ai/vertex-sdk
```
</Tab>

<Tab title="C#">
```bash
dotnet add package Anthropic.Vertex
```
</Tab>

<Tab title="Go">
```bash
go get github.com/anthropics/anthropic-sdk-go
```
</Tab>

<Tab title="Java">
<CodeGroup>
```groovy Gradle
implementation("com.anthropic:anthropic-java-vertex:2.40.0")
```

```xml Maven
<dependency>
    <groupId>com.anthropic</groupId>
    <artifactId>anthropic-java-vertex</artifactId>
    <version>2.40.0</version>
</dependency>
```

```java Java nocheck hidelines={7..9,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.vertex.backends.VertexBackend;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;

public class BasicMessage {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.builder()
            .backend(VertexBackend.fromEnv())
            .build();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(1024L)
            .addUserMessage("What is the capital of France?")
            .build();

        Message response = client.messages().create(params);
        response.content().stream()
            .flatMap(block -> block.text().stream())
            .forEach(textBlock -> System.out.println(textBlock.text()));
    }
}
```
</CodeGroup>
</Tab>

<Tab title="PHP">
```bash
composer require anthropic-ai/sdk google/auth
```
</Tab>

<Tab title="Ruby">
```bash
# Gemfile
gem "anthropic"
gem "googleauth"
```
</Tab>
</Tabs>

## 访问 Vertex AI \{#accessing-vertex-ai}

### 模型可用性 \{#model-availability}

请注意，Anthropic 模型的可用性因区域而异。在 [Vertex AI Model Garden](https://cloud.google.com/model-garden) 中搜索"Claude"，或访问 [Anthropic Claude 模型](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude)以获取最新信息。

#### API 模型 ID \{#api-model-ids}

生命周期术语（已弃用、已停用）在[模型弃用](/docs/zh-CN/about-claude/model-deprecations)中定义。合作伙伴运营平台上的生命周期日期由合作伙伴设定，可能与 Claude API 的时间表不同。有关 Vertex AI 上任何模型的当前停用日期，请参阅 [Google Cloud 关于 Vertex AI 上 Claude 模型的文档](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude)。

| 模型                          | Vertex AI API 模型 ID |
| ------------------------------ | ------------------------ |
| Claude Fable 5                     | claude-fable-5 |
| Claude Opus 4.8                    | claude-opus-4-8 |
| Claude Opus 4.7                    | claude-opus-4-7 |
| Claude Opus 4.6                  | claude-opus-4-6 |
| Claude Sonnet 4.6              | claude-sonnet-4-6 |
| Claude Sonnet 4.5              | claude-sonnet-4-5@20250929 |
| Claude Sonnet 4 <br /><small>已弃用。</small> | claude-sonnet-4@20250514 |
| Claude Sonnet 3.7 <br /><small>已停用。</small> | claude-3-7-sonnet@20250219 |
| Claude Opus 4.5                | claude-opus-4-5@20251101 |
| Claude Opus 4.1 <br /><small>已弃用。</small> | claude-opus-4-1@20250805 |
| Claude Opus 4 <br /><small>已弃用。</small> | claude-opus-4@20250514   |
| Claude Haiku 4.5               | claude-haiku-4-5@20251001 |
| Claude Haiku 3.5 <br /><small>已弃用。</small> | claude-3-5-haiku@20241022 |

<Tip>
正在升级到更新的 Claude 模型？在 Claude Code 中运行 `/claude-api migrate`，即可在整个代码库中应用模型 ID 替换和破坏性参数变更。该技能会检测您的代码所针对的云平台，并针对该平台调整模型 ID 格式和功能变更。请参阅[迁移到更新的 Claude 模型](/docs/zh-CN/agents-and-tools/agent-skills/claude-api-skill#migrating-to-a-newer-claude-model)。
</Tip>

### 发出请求 \{#making-requests}

在运行请求之前，您可能需要运行 `gcloud auth application-default login` 以通过 GCP 进行身份验证。

以下示例展示了如何在 Vertex AI 上使用 Claude 生成文本：
<CodeGroup>

  
  ```bash cURL nocheck
  MODEL_ID=claude-opus-4-8
  LOCATION=global
  PROJECT_ID=MY_PROJECT_ID

  curl \
  -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  https://$LOCATION-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/anthropic/models/${MODEL_ID}:streamRawPredict -d \
  '{
    "anthropic_version": "vertex-2023-10-16",
    "messages": [{
      "role": "user",
      "content": "Hey Claude!"
    }],
    "max_tokens": 100
  }'
  ```

  ```bash CLI
  # ant CLI 不支持 Vertex AI。
  ```

  
  ```python Python nocheck
  from anthropic import AnthropicVertex

  project_id = "MY_PROJECT_ID"
  region = "global"

  client = AnthropicVertex(project_id=project_id, region=region)

  message = client.messages.create(
      model="claude-opus-4-8",
      max_tokens=100,
      messages=[
          {
              "role": "user",
              "content": "Hey Claude!",
          }
      ],
  )
  print(message)
  ```

  
  ```typescript TypeScript nocheck
  import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

  const projectId = "MY_PROJECT_ID";
  const region = "global";

  // 通过标准的 `google-auth-library` 流程进行。
  const client = new AnthropicVertex({
    projectId,
    region
  });

  async function main() {
    const result = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: "Hey Claude!"
        }
      ]
    });
    console.log(JSON.stringify(result, null, 2));
  }

  main();
  ```

  
  ```csharp C# nocheck
  using Anthropic;
  using Anthropic.Models.Messages;
  using Anthropic.Vertex;

  var projectId = "MY_PROJECT_ID";
  var region = "global";

  var client = new AnthropicClient
  {
      Backend = new VertexBackend(projectId, region)
  };

  var parameters = new MessageCreateParams
  {
      Model = Model.ClaudeOpus4_8,
      MaxTokens = 100,
      Messages = [new() { Role = Role.User, Content = "Hey Claude!" }]
  };

  var message = await client.Messages.Create(parameters);
  Console.WriteLine(message);
  ```

  
  ```go Go nocheck hidelines={1..2,10..11,-1}
  package main

  import (
  	"context"
  	"fmt"

  	"github.com/anthropics/anthropic-sdk-go"
  	"github.com/anthropics/anthropic-sdk-go/vertex"
  )

  func main() {
  	// 使用默认的 Google Cloud 凭据
  	client := anthropic.NewClient(
  		vertex.WithGoogleAuth(context.Background(), "global", "MY_PROJECT_ID"),
  	)

  	message, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
  		Model:     "claude-opus-4-8",
  		MaxTokens: 100,
  		Messages: []anthropic.MessageParam{
  			anthropic.NewUserMessage(anthropic.NewTextBlock("Hey Claude!")),
  		},
  	})
  	if err != nil {
  		panic(err)
  	}
  	fmt.Printf("%+v\n", message)
  }
  ```

  
  ```java Java nocheck hidelines={6..9,-2..}
  import com.anthropic.client.AnthropicClient;
  import com.anthropic.client.okhttp.AnthropicOkHttpClient;
  import com.anthropic.models.messages.Message;
  import com.anthropic.models.messages.MessageCreateParams;
  import com.anthropic.vertex.backends.VertexBackend;

  public class VertexExample {

    public static void main(String[] args) {
      // 使用默认的 Google Cloud 凭据
      AnthropicClient client = AnthropicOkHttpClient.builder()
        .backend(VertexBackend.fromEnv())
        .build();

      Message message = client
        .messages()
        .create(
          MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(100)
            .addUserMessage("Hey Claude!")
            .build()
        );

      System.out.println(message);
    }
  }
  ```

  
  ```php PHP nocheck
  <?php

  use Anthropic\Vertex;

  $client = Vertex\Client::fromEnvironment(
      location: 'global',
      projectId: 'MY_PROJECT_ID',
  );

  $message = $client->messages->create(
      maxTokens: 100,
      messages: [
          ['role' => 'user', 'content' => 'Hey Claude!']
      ],
      model: 'claude-opus-4-8',
  );
  echo $message->content[0]->text;
  ```

  
  ```ruby Ruby nocheck
  require "anthropic"

  client = Anthropic::VertexClient.new(
    region: "global",
    project_id: "MY_PROJECT_ID"
  )

  message = client.messages.create(
    model: "claude-opus-4-8",
    max_tokens: 100,
    messages: [{role: "user", content: "Hey Claude!"}]
  )

  puts message.content.first.text
  ```
</CodeGroup>

有关更多详细信息，请参阅[客户端 SDK](/docs/zh-CN/cli-sdks-libraries/overview) 和官方 [Vertex AI 文档](https://cloud.google.com/vertex-ai/docs)。

Claude 也可通过 [Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)、[AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 使用。

## 数据保留 \{#data-retention}

此服务的数据处理由 Google Cloud Vertex AI 管理。有关详细信息，请参阅 [Vertex AI 与零数据保留](https://cloud.google.com/vertex-ai/generative-ai/docs/data-governance)。

## 活动日志记录 \{#activity-logging}

Vertex 提供了[请求-响应日志记录服务](https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/request-response-logging)，允许客户记录与您的使用相关的提示和补全内容。

Anthropic 建议您至少以 30 天滚动周期记录您的活动，以便了解您的活动并调查任何潜在的滥用行为。

<Note>
开启此服务不会让 Google 或 Anthropic 访问您的内容。
</Note>

## 功能支持 \{#feature-support}
有关 Vertex AI 可用性的完整功能列表，请参阅[功能概览](/docs/zh-CN/build-with-claude/overview)。

### 支持的功能亮点 \{#supported-feature-highlights}

- [Messages API](/docs/zh-CN/api/messages/create)
- [提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)
- [扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)
- [工具使用](/docs/zh-CN/agents-and-tools/tool-use/overview)，包括 [Bash 工具](/docs/zh-CN/agents-and-tools/tool-use/bash-tool)、[计算机使用工具](/docs/zh-CN/agents-and-tools/tool-use/computer-use-tool)、[内存工具](/docs/zh-CN/agents-and-tools/tool-use/memory-tool)和[文本编辑器工具](/docs/zh-CN/agents-and-tools/tool-use/text-editor-tool)
- [网络搜索工具](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool)
- [引用](/docs/zh-CN/build-with-claude/citations)
- [结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)

### 不支持的功能 \{#features-not-supported}

- 输入源（图像和文档的 URL 源、Files API）
- 服务器端工具（代码执行、网络抓取、顾问）
- 智能体基础设施（Agent Skills、MCP 连接器、程序化工具调用）
- API 端点（Message Batches、Models、Admin、Compliance、Usage and Cost）
- Claude 托管智能体
- 服务器端回退（[`fallbacks` 参数](/docs/zh-CN/build-with-claude/refusals-and-fallback#server-side-fallback)；请改用[客户端回退模式](/docs/zh-CN/build-with-claude/refusals-and-fallback#client-side-fallback)）

### 上下文窗口 \{#context-window}

Claude Fable 5、Claude Opus 4.8、Claude Opus 4.7、Claude Opus 4.6 和 Claude Sonnet 4.6 在 Vertex AI 上拥有 [100 万令牌的上下文窗口](/docs/zh-CN/build-with-claude/context-windows)。其他 Claude 模型，包括 Sonnet 4.5 和 Sonnet 4（已弃用），拥有 20 万令牌的上下文窗口。

Vertex AI 将请求负载限制为 30 MB。当发送大型文档或大量图像时，您可能会在达到令牌限制之前先达到此限制。

## 全球、多区域和区域端点 \{#global-multi-region-and-regional-endpoints}

Vertex AI 提供三种端点类型：

- **全球端点：** 动态路由以实现最大可用性
- **多区域端点：** 在某个地理区域内（例如美国或欧盟）进行动态路由，在满足数据驻留要求的同时保持高可用性
- **区域端点：** 保证数据通过特定地理区域进行路由

区域端点和多区域端点的定价比全球端点高 10%。

<Note>
这仅适用于 Claude Sonnet 4.5 及未来的模型。较早的模型（Claude Sonnet 4（已弃用）、Opus 4（已弃用）及更早版本）保持其现有的定价结构。
</Note>

### 何时使用各选项 \{#when-to-use-each-option}

**全球端点（推荐）：**
- 提供最大的可用性和正常运行时间
- 动态将请求路由到具有可用容量的区域
- 无定价溢价
- 最适合对数据驻留要求灵活的应用程序
- 仅支持按需付费流量（预配置吞吐量需要区域端点）

**多区域端点：**
- 在某个地理区域内（目前为 `us` 和 `eu`）跨区域动态路由请求
- 当您需要在较大地理范围内满足数据驻留要求，同时希望获得比单一区域更高的可用性时非常有用
- 比全球端点高 10% 的定价溢价
- 仅支持按需付费流量（预配置吞吐量需要区域端点）

**区域端点：**
- 通过特定地理区域路由流量
- 适用于单一区域数据驻留、严格的合规要求或预配置吞吐量
- 同时支持按需付费和预配置吞吐量
- 10% 的定价溢价反映了专用区域容量的基础设施成本

### 实现方式 \{#implementation}

**使用全球端点（推荐）：**

在初始化客户端时将 `region` 参数设置为 `"global"`：

<CodeGroup>

```bash CLI
# ant CLI 不支持 Vertex AI。
```

```python Python nocheck
from anthropic import AnthropicVertex

project_id = "MY_PROJECT_ID"
region = "global"

client = AnthropicVertex(project_id=project_id, region=region)

message = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=100,
    messages=[
        {
            "role": "user",
            "content": "Hey Claude!",
        }
    ],
)
print(message)
```

```typescript TypeScript nocheck
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

const projectId = "MY_PROJECT_ID";
const region = "global";

const client = new AnthropicVertex({
  projectId,
  region
});

const result = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 100,
  messages: [
    {
      role: "user",
      content: "Hey Claude!"
    }
  ]
});
```

```csharp C# nocheck
using Anthropic;
using Anthropic.Models.Messages;
using Anthropic.Vertex;

var projectId = "MY_PROJECT_ID";
var region = "global";

var client = new AnthropicClient
{
    Backend = new VertexBackend(projectId, region)
};

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 100,
    Messages = [new() { Role = Role.User, Content = "Hey Claude!" }]
};

var message = await client.Messages.Create(parameters);
Console.WriteLine(message);
```

```go Go nocheck hidelines={1..2,9..10,-1}
package main

import (
	"context"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/vertex"
)

func main() {
	// 使用默认的 Google Cloud 凭据
	client := anthropic.NewClient(
		vertex.WithGoogleAuth(context.Background(), "global", "MY_PROJECT_ID"),
	)

	message, _ := client.Messages.New(context.Background(), anthropic.MessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 100,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Hey Claude!")),
		},
	})
	_ = message
}
```

```java Java nocheck
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.vertex.backends.VertexBackend;

void main() {
    // 使用默认的 Google Cloud 凭据
    AnthropicClient client = AnthropicOkHttpClient.builder()
        .backend(
            VertexBackend.builder()
                .region("global")
                .project("MY_PROJECT_ID")
                .build()
        )
        .build();

    var message = client
        .messages()
        .create(
            MessageCreateParams.builder()
                .model("claude-opus-4-8")
                .maxTokens(100)
                .addUserMessage("Hey Claude!")
                .build()
        );

    IO.println(message);
}
```

```php PHP nocheck
<?php

use Anthropic\Vertex;

$client = Vertex\Client::fromEnvironment(
    location: 'global',
    projectId: 'MY_PROJECT_ID',
);

$message = $client->messages->create(
    maxTokens: 100,
    messages: [
        ['role' => 'user', 'content' => 'Hey Claude!']
    ],
    model: 'claude-opus-4-8',
);

echo $message->content[0]->text;
```

```ruby Ruby nocheck
require "anthropic"

client = Anthropic::VertexClient.new(
  region: "global",
  project_id: "MY_PROJECT_ID"
)

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 100,
  messages: [{role: "user", content: "Hey Claude!"}]
)

puts message.content.first.text
```
</CodeGroup>

**使用多区域端点：**

将 `region` 参数设置为多区域标识符：`"us"` 表示美国，`"eu"` 表示欧盟。SDK 会将请求路由到相应的多区域端点（`https://aiplatform.us.rep.googleapis.com` 或 `https://aiplatform.eu.rep.googleapis.com`），该端点会在该地理范围内的各区域之间动态平衡流量。

<CodeGroup>

```bash CLI
# ant CLI 不支持 Vertex AI。
```

```python Python nocheck
from anthropic import AnthropicVertex

project_id = "MY_PROJECT_ID"
region = "us"  # Multi-region identifier: "us" or "eu"

client = AnthropicVertex(project_id=project_id, region=region)

message = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=100,
    messages=[
        {
            "role": "user",
            "content": "Hey Claude!",
        }
    ],
)
print(message)
```

```typescript TypeScript nocheck
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

const projectId = "MY_PROJECT_ID";
const region = "us"; // Multi-region identifier: "us" or "eu"

const client = new AnthropicVertex({
  projectId,
  region
});

const result = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 100,
  messages: [
    {
      role: "user",
      content: "Hey Claude!"
    }
  ]
});
```

```csharp C# nocheck
using Anthropic;
using Anthropic.Models.Messages;
using Anthropic.Vertex;

var projectId = "MY_PROJECT_ID";
var region = "us"; // Multi-region identifier: "us" or "eu"

var client = new AnthropicClient
{
    Backend = new VertexBackend(projectId, region)
};

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 100,
    Messages = [new() { Role = Role.User, Content = "Hey Claude!" }]
};

var message = await client.Messages.Create(parameters);
Console.WriteLine(message);
```

```go Go nocheck hidelines={1..2,9..10,-1}
package main

import (
	"context"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/vertex"
)

func main() {
	// 多区域标识符："us" 或 "eu"
	client := anthropic.NewClient(
		vertex.WithGoogleAuth(context.Background(), "us", "MY_PROJECT_ID"),
	)

	message, _ := client.Messages.New(context.Background(), anthropic.MessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 100,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Hey Claude!")),
		},
	})
	_ = message
}
```

```java Java nocheck
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.vertex.backends.VertexBackend;

void main() {
    // 多区域标识符："us" 或 "eu"
    AnthropicClient client = AnthropicOkHttpClient.builder()
        .backend(
            VertexBackend.builder()
                .region("us")
                .project("MY_PROJECT_ID")
                .build()
        )
        .build();

    var message = client
        .messages()
        .create(
            MessageCreateParams.builder()
                .model("claude-opus-4-8")
                .maxTokens(100)
                .addUserMessage("Hey Claude!")
                .build()
        );

    IO.println(message);
}
```

```php PHP nocheck
<?php

use Anthropic\Vertex;

$client = Vertex\Client::fromEnvironment(
    location: 'us', // Multi-region identifier: "us" or "eu"
    projectId: 'MY_PROJECT_ID',
);

$message = $client->messages->create(
    maxTokens: 100,
    messages: [
        ['role' => 'user', 'content' => 'Hey Claude!']
    ],
    model: 'claude-opus-4-8',
);
echo $message->content[0]->text;
```

```ruby Ruby nocheck
require "anthropic"

client = Anthropic::VertexClient.new(
  region: "us", # Multi-region identifier: "us" or "eu"
  project_id: "MY_PROJECT_ID"
)

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 100,
  messages: [{role: "user", content: "Hey Claude!"}]
)

puts message.content.first.text
```
</CodeGroup>

**使用区域端点：**

指定特定区域，如 `"us-east1"` 或 `"europe-west1"`：

<CodeGroup>

```bash CLI
# ant CLI 不支持 Vertex AI。
```

```python Python nocheck
from anthropic import AnthropicVertex

project_id = "MY_PROJECT_ID"
region = "us-east1"  # Specify a specific region

client = AnthropicVertex(project_id=project_id, region=region)

message = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=100,
    messages=[
        {
            "role": "user",
            "content": "Hey Claude!",
        }
    ],
)
print(message)
```

```typescript TypeScript nocheck
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

const projectId = "MY_PROJECT_ID";
const region = "us-east1"; // Specify a specific region

const client = new AnthropicVertex({
  projectId,
  region
});

const result = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 100,
  messages: [
    {
      role: "user",
      content: "Hey Claude!"
    }
  ]
});
```

```csharp C# nocheck
using Anthropic;
using Anthropic.Models.Messages;
using Anthropic.Vertex;

var projectId = "MY_PROJECT_ID";
var region = "us-east1";

AnthropicClient client = new()
{
    Backend = new VertexBackend(projectId, region)
};

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 100,
    Messages = [new() { Role = Role.User, Content = "Hey Claude!" }]
};

var message = await client.Messages.Create(parameters);
Console.WriteLine(message);
```

```go Go nocheck hidelines={1..2,9..10,-1}
package main

import (
	"context"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/vertex"
)

func main() {
	// 指定特定区域
	client := anthropic.NewClient(
		vertex.WithGoogleAuth(context.Background(), "us-east1", "MY_PROJECT_ID"),
	)

	message, _ := client.Messages.New(context.Background(), anthropic.MessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 100,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Hey Claude!")),
		},
	})
	_ = message
}
```

```java Java nocheck
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.vertex.backends.VertexBackend;

void main() {
    // 使用默认的 Google Cloud 凭据并指定特定区域
    AnthropicClient client = AnthropicOkHttpClient.builder()
        .backend(
            VertexBackend.builder()
                .region("us-east1") // Specify a specific region
                .project("MY_PROJECT_ID")
                .build()
        )
        .build();

    var message = client
        .messages()
        .create(
            MessageCreateParams.builder()
                .model("claude-opus-4-8")
                .maxTokens(100)
                .addUserMessage("Hey Claude!")
                .build()
        );

    IO.println(message);
}
```

```php PHP nocheck
<?php

use Anthropic\Vertex;

$client = Vertex\Client::fromEnvironment(
    location: 'us-east1',
    projectId: 'MY_PROJECT_ID',
);

$message = $client->messages->create(
    maxTokens: 100,
    messages: [
        ['role' => 'user', 'content' => 'Hey Claude!']
    ],
    model: 'claude-opus-4-8',
);
echo $message->content[0]->text;
```

```ruby Ruby nocheck
require "anthropic"

client = Anthropic::VertexClient.new(
  region: "us-east1", # Specify a specific region
  project_id: "MY_PROJECT_ID"
)

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 100,
  messages: [{role: "user", content: "Hey Claude!"}]
)

puts message.content.first.text
```
</CodeGroup>

<Note>
Claude Mythos Preview 是一个研究预览版，仅面向 Vertex AI 上受邀的客户提供。有关更多信息，请参阅 [Project Glasswing](https://anthropic.com/glasswing)。
</Note>

## 其他资源 \{#additional-resources}

- **Vertex AI 定价：** [cloud.google.com/vertex-ai/generative-ai/pricing](https://cloud.google.com/vertex-ai/generative-ai/pricing)
- **Claude 模型文档：** [Vertex AI 上的 Claude](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude)
- **Google 博客文章：** [Claude 模型的全球端点](https://cloud.google.com/blog/products/ai-machine-learning/global-endpoint-for-claude-models-generally-available-on-vertex-ai)
- **Anthropic 定价详情：** [云平台定价](/docs/zh-CN/about-claude/pricing#cloud-platform-pricing)