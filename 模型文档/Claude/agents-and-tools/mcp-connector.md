# MCP 连接器

---

Claude 的 "Model Context Protocol"，即 MCP 连接器功能使您能够直接从 Messages API 连接到远程 MCP 服务器，而无需单独的 MCP 客户端。

<Note>
  **当前版本：**此功能需要 beta 标头：`"anthropic-beta": "mcp-client-2025-11-20"`

  之前的版本（`mcp-client-2025-04-04`）已弃用。请参阅[已弃用版本：mcp-client-2025-04-04](#deprecated-version-mcp-client-2025-04-04)。
</Note>

<Note>
此功能**不**符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。数据将根据该功能的标准保留策略进行保留。
</Note>

## 主要功能 \{#key-features}

- **直接 API 集成**：无需实现 MCP 客户端即可连接到 MCP 服务器
- **工具调用支持**：通过 Messages API 访问 MCP 工具
- **灵活的工具配置**：启用所有工具、将特定工具列入允许列表或将不需要的工具列入拒绝列表
- **按工具配置**：使用自定义设置配置单个工具
- **OAuth 身份验证**：支持用于已验证服务器的 OAuth Bearer 令牌
- **多服务器**：在单个请求中连接到多个 MCP 服务器

## Claude 何时使用 MCP 工具 \{#when-claude-uses-mcp-tools}

连接 MCP 服务器后，当用户的请求与工具描述的功能相匹配时，Claude 会调用其工具，无论是显式请求（"在 Jira 中搜索未解决的 bug"）还是隐式请求（在连接了 Jira 服务器的情况下询问"是什么阻碍了发布？"）。

对于有关已连接服务的常识性问题，Claude **不会**调用 MCP 工具。在连接了 Notion 服务器的情况下询问"Notion 数据库是如何工作的？"会直接得到回答；而询问"我的 Projects 数据库中有什么？"则会触发工具调用。

您可以通过系统提示来引导 Claude 调用 MCP 工具的积极程度。有关一般指导和示例措辞，请参阅 [Claude 何时使用工具](/docs/zh-CN/agents-and-tools/tool-use/overview#when-claude-uses-tools)。

## 限制 \{#limitations}

- 在 [MCP 规范](https://modelcontextprotocol.io/introduction#explore-mcp)的功能集中，目前仅支持[工具调用](https://modelcontextprotocol.io/docs/concepts/tools)。
- 服务器必须通过 HTTP 公开暴露（支持 Streamable HTTP 和 SSE 传输）。本地 STDIO 服务器无法直接连接。
- MCP 连接器可在 Claude API、[AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上使用。目前在 Amazon Bedrock 或 Vertex AI 上不可用。

## 在 Messages API 中使用 MCP 连接器 \{#using-the-mcp-connector-in-the-messages-api}

MCP 连接器使用两个组件：

1. **MCP 服务器定义**（`mcp_servers` 数组）：定义服务器连接详细信息（URL、身份验证）
2. **MCP 工具集**（`tools` 数组）：配置要启用哪些工具以及如何配置它们

### 基本示例 \{#basic-example}

此示例使用默认配置启用 MCP 服务器中的所有工具：

<CodeGroup>

```bash cURL nocheck
curl https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: mcp-client-2025-11-20" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1000,
    "messages": [{"role": "user", "content": "What tools do you have available?"}],
    "mcp_servers": [
      {
        "type": "url",
        "url": "https://example-server.modelcontextprotocol.io/sse",
        "name": "example-mcp",
        "authorization_token": "YOUR_TOKEN"
      }
    ],
    "tools": [
      {
        "type": "mcp_toolset",
        "mcp_server_name": "example-mcp"
      }
    ]
  }'
```

```bash CLI nocheck
ant beta:messages create --beta mcp-client-2025-11-20 <<'YAML'
model: claude-opus-4-8
max_tokens: 1000
messages:
  - role: user
    content: What tools do you have available?
mcp_servers:
  - type: url
    url: https://example-server.modelcontextprotocol.io/sse
    name: example-mcp
    authorization_token: YOUR_TOKEN
tools:
  - type: mcp_toolset
    mcp_server_name: example-mcp
YAML
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=1000,
    messages=[{"role": "user", "content": "What tools do you have available?"}],
    mcp_servers=[
        {
            "type": "url",
            "url": "https://example-server.modelcontextprotocol.io/sse",
            "name": "example-mcp",
            "authorization_token": "YOUR_TOKEN",
        }
    ],
    tools=[{"type": "mcp_toolset", "mcp_server_name": "example-mcp"}],
    betas=["mcp-client-2025-11-20"],
)

print(response)
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const response = await anthropic.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1000,
  messages: [
    {
      role: "user",
      content: "What tools do you have available?"
    }
  ],
  mcp_servers: [
    {
      type: "url",
      url: "https://example-server.modelcontextprotocol.io/sse",
      name: "example-mcp",
      authorization_token: "YOUR_TOKEN"
    }
  ],
  tools: [
    {
      type: "mcp_toolset",
      mcp_server_name: "example-mcp"
    }
  ],
  betas: ["mcp-client-2025-11-20"]
});

console.log(response);
```

```csharp C# nocheck hidelines={1..6}
using Anthropic;
using Anthropic.Models.Beta.Messages;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1000,
    Messages = new List<BetaMessageParam>
    {
        new() { Role = Role.User, Content = "What tools do you have available?" }
    },
    McpServers = new List<BetaRequestMcpServerUrlDefinition>
    {
        new()
        {
            Url = "https://example-server.modelcontextprotocol.io/sse",
            Name = "example-mcp",
            AuthorizationToken = "YOUR_TOKEN"
        }
    },
    Tools = new List<BetaToolUnion>
    {
        new BetaMcpToolset("example-mcp")
    },
    Betas = new List<string> { "mcp-client-2025-11-20" }
};

var message = await client.Beta.Messages.Create(parameters);
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

	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 1000,
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("What tools do you have available?")),
		},
		MCPServers: []anthropic.BetaRequestMCPServerURLDefinitionParam{
			{
				URL:                "https://example-server.modelcontextprotocol.io/sse",
				Name:               "example-mcp",
				AuthorizationToken: anthropic.String("YOUR_TOKEN"),
			},
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfMCPToolset: &anthropic.BetaMCPToolsetParam{
				MCPServerName: "example-mcp",
			}},
		},
		Betas: []anthropic.AnthropicBeta{
			anthropic.AnthropicBetaMCPClient2025_11_20,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java nocheck hidelines={1..2,4,6..7}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.BetaMcpToolset;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaRequestMcpServerUrlDefinition;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1000L)
        .addUserMessage("What tools do you have available?")
        .addMcpServer(BetaRequestMcpServerUrlDefinition.builder()
            .url("https://example-server.modelcontextprotocol.io/sse")
            .name("example-mcp")
            .authorizationToken("YOUR_TOKEN")
            .build())
        .addTool(BetaMcpToolset.builder()
            .mcpServerName("example-mcp")
            .build())
        .addBeta("mcp-client-2025-11-20")
        .build();

    BetaMessage response = client.beta().messages().create(params);
    IO.println(response);
}
```

```php PHP nocheck hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->beta->messages->create(
    maxTokens: 1000,
    messages: [
        ['role' => 'user', 'content' => 'What tools do you have available?']
    ],
    model: 'claude-opus-4-8',
    mcpServers: [
        [
            'type' => 'url',
            'url' => 'https://example-server.modelcontextprotocol.io/sse',
            'name' => 'example-mcp',
            'authorization_token' => 'YOUR_TOKEN',
        ],
    ],
    tools: [
        [
            'type' => 'mcp_toolset',
            'mcp_server_name' => 'example-mcp',
        ],
    ],
    betas: ['mcp-client-2025-11-20'],
);

echo $message;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1000,
  messages: [
    { role: "user", content: "What tools do you have available?" }
  ],
  mcp_servers: [
    {
      type: "url",
      url: "https://example-server.modelcontextprotocol.io/sse",
      name: "example-mcp",
      authorization_token: "YOUR_TOKEN"
    }
  ],
  tools: [
    {
      type: "mcp_toolset",
      mcp_server_name: "example-mcp"
    }
  ],
  betas: ["mcp-client-2025-11-20"]
)

puts response
```
</CodeGroup>

## MCP 服务器配置 \{#mcp-server-configuration}

`mcp_servers` 数组中的每个 MCP 服务器定义连接详细信息：

```json
{
  "type": "url",
  "url": "https://example-server.modelcontextprotocol.io/sse",
  "name": "example-mcp",
  "authorization_token": "YOUR_TOKEN"
}
```

### 字段说明 \{#field-descriptions}

| 属性 | 类型 | 必需 | 说明 |
|----------|------|----------|-------------|
| `type` | string | 是 | 目前仅支持 "url"。 |
| `url` | string | 是 | MCP 服务器的 URL。必须以 https:// 开头。 |
| `name` | string | 是 | 此 MCP 服务器的唯一标识符。必须被 `tools` 数组中的恰好一个 MCPToolset 引用。 |
| `authorization_token` | string | 否 | MCP 服务器需要时的 OAuth 授权令牌。请参阅 [MCP 规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)。 |

## MCP 工具集配置 \{#mcp-toolset-configuration}

MCPToolset 位于 `tools` 数组中，用于配置启用 MCP 服务器中的哪些工具以及如何配置它们。

### 基本结构 \{#basic-structure}

```json
{
  "type": "mcp_toolset",
  "mcp_server_name": "example-mcp",
  "default_config": {
    "enabled": true,
    "defer_loading": false
  },
  "configs": {
    "specific_tool_name": {
      "enabled": true,
      "defer_loading": true
    }
  }
}
```

### 字段说明 \{#field-descriptions-2}

| 属性 | 类型 | 必需 | 说明 |
|----------|------|----------|-------------|
| `type` | string | 是 | 必须为 "mcp_toolset"。 |
| `mcp_server_name` | string | 是 | 必须与 `mcp_servers` 数组中定义的服务器名称匹配。 |
| `default_config` | object | 否 | 应用于此工具集中所有工具的默认配置。`configs` 中的单个工具配置会覆盖这些默认值。 |
| `configs` | object | 否 | 按工具的配置覆盖。键为工具名称，值为配置对象。 |
| `cache_control` | object | 否 | 此工具集的[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)缓存断点配置。 |

### 工具配置选项 \{#tool-configuration-options}

每个工具（无论是在 `default_config` 还是在 `configs` 中配置）都支持以下字段：

| 属性 | 类型 | 默认值 | 说明 |
|----------|------|---------|-------------|
| `enabled` | boolean | `true` | 是否启用此工具。 |
| `defer_loading` | boolean | `false` | 如果为 true，则最初不会将工具描述发送给模型。与[工具搜索工具](/docs/zh-CN/agents-and-tools/tool-use/tool-search-tool)配合使用。 |

有关 Anthropic 提供的工具的完整目录以及 `defer_loading` 等可选属性，请参阅[工具参考](/docs/zh-CN/agents-and-tools/tool-use/tool-reference)。有关在大型工具集中进行搜索的信息，请参阅[工具搜索工具](/docs/zh-CN/agents-and-tools/tool-use/tool-search-tool)。

### 配置合并 \{#configuration-merging}

配置值按以下优先级合并（从高到低）：

1. `configs` 中的工具特定设置
2. 工具集级别的 `default_config`
3. 系统默认值

示例：

```json
{
  "type": "mcp_toolset",
  "mcp_server_name": "google-calendar-mcp",
  "default_config": {
    "defer_loading": true
  },
  "configs": {
    "search_events": {
      "enabled": false
    }
  }
}
```

结果为：
- `search_events`：`enabled: false`（来自 configs），`defer_loading: true`（来自 default_config）
- 所有其他工具：`enabled: true`（系统默认值），`defer_loading: true`（来自 default_config）

## 常见配置模式 \{#common-configuration-patterns}

### 使用默认配置启用所有工具 \{#enable-all-tools-with-default-configuration}

最简单的模式——启用服务器中的所有工具：

```json
{
  "type": "mcp_toolset",
  "mcp_server_name": "google-calendar-mcp"
}
```

### 允许列表：仅启用特定工具 \{#allowlist-enable-only-specific-tools}

将 `enabled: false` 设置为默认值，然后显式启用特定工具：

```json
{
  "type": "mcp_toolset",
  "mcp_server_name": "google-calendar-mcp",
  "default_config": {
    "enabled": false
  },
  "configs": {
    "search_events": {
      "enabled": true
    },
    "create_event": {
      "enabled": true
    }
  }
}
```

### 拒绝列表：禁用特定工具 \{#denylist-disable-specific-tools}

默认启用所有工具，然后显式禁用不需要的工具。在构建只读助手时，或者当您希望在状态更改之前有人工确认步骤时，建议将写入或破坏性工具列入拒绝列表：

```json
{
  "type": "mcp_toolset",
  "mcp_server_name": "google-calendar-mcp",
  "configs": {
    "delete_all_events": {
      "enabled": false
    },
    "share_calendar_publicly": {
      "enabled": false
    }
  }
}
```

### 混合模式：带按工具配置的允许列表 \{#mixed-allowlist-with-per-tool-configuration}

将允许列表与每个工具的自定义配置相结合：

```json
{
  "type": "mcp_toolset",
  "mcp_server_name": "google-calendar-mcp",
  "default_config": {
    "enabled": false,
    "defer_loading": true
  },
  "configs": {
    "search_events": {
      "enabled": true,
      "defer_loading": false
    },
    "list_events": {
      "enabled": true
    }
  }
}
```

在此示例中：
- `search_events` 已启用，且 `defer_loading: false`
- `list_events` 已启用，且 `defer_loading: true`（继承自 default_config）
- 所有其他工具均已禁用

## 验证规则 \{#validation-rules}

API 强制执行以下验证规则：

- **服务器必须存在**：MCPToolset 中的 `mcp_server_name` 必须与 `mcp_servers` 数组中定义的服务器匹配
- **服务器必须被使用**：`mcp_servers` 中定义的每个 MCP 服务器必须被恰好一个 MCPToolset 引用
- **每个服务器唯一的工具集**：每个 MCP 服务器只能被一个 MCPToolset 引用
- **未知工具名称**：如果 `configs` 中的工具名称在 MCP 服务器上不存在，会记录后端警告但不返回错误（MCP 服务器可能具有动态工具可用性）

## 响应内容类型 \{#response-content-types}

当 Claude 使用 MCP 工具时，响应包含两种新的内容块类型：

### MCP 工具使用块 \{#mcp-tool-use-block}

```json
{
  "type": "mcp_tool_use",
  "id": "mcptoolu_014Q35RayjACSWkSj4X2yov1",
  "name": "echo",
  "server_name": "example-mcp",
  "input": { "param1": "value1", "param2": "value2" }
}
```

### MCP 工具结果块 \{#mcp-tool-result-block}

```json
{
  "type": "mcp_tool_result",
  "tool_use_id": "mcptoolu_014Q35RayjACSWkSj4X2yov1",
  "is_error": false,
  "content": [
    {
      "type": "text",
      "text": "Hello"
    }
  ]
}
```

## 多个 MCP 服务器 \{#multiple-mcp-servers}

您可以通过在 `mcp_servers` 中包含多个服务器定义，并在 `tools` 数组中为每个服务器包含相应的 MCPToolset 来连接到多个 MCP 服务器：

```json
{
  "model": "claude-opus-4-8",
  "max_tokens": 1000,
  "messages": [
    {
      "role": "user",
      "content": "Use tools from both mcp-server-1 and mcp-server-2 to complete this task"
    }
  ],
  "mcp_servers": [
    {
      "type": "url",
      "url": "https://mcp.example1.com/sse",
      "name": "mcp-server-1",
      "authorization_token": "TOKEN1"
    },
    {
      "type": "url",
      "url": "https://mcp.example2.com/sse",
      "name": "mcp-server-2",
      "authorization_token": "TOKEN2"
    }
  ],
  "tools": [
    {
      "type": "mcp_toolset",
      "mcp_server_name": "mcp-server-1"
    },
    {
      "type": "mcp_toolset",
      "mcp_server_name": "mcp-server-2",
      "default_config": {
        "defer_loading": true
      }
    }
  ]
}
```

当有许多工具可用时，Claude 会根据工具名称和描述进行选择。清晰、具体的工具描述可以提高选择准确性。对于大型工具集（跨多个服务器的数十个工具），请考虑启用 [`defer_loading`](#tool-configuration-options) 并配合[工具搜索工具](/docs/zh-CN/agents-and-tools/tool-use/tool-search-tool)使用，以便每次查询只显示相关工具。

## 身份验证 \{#authentication}

对于需要 OAuth 身份验证的 MCP 服务器，您需要获取访问令牌。MCP 连接器 beta 版支持在 MCP 服务器定义中传递 `authorization_token` 参数。
API 使用者需要在进行 API 调用之前处理 OAuth 流程并获取访问令牌，并根据需要刷新令牌。

### 获取用于测试的访问令牌 \{#obtaining-an-access-token-for-testing}

MCP inspector 可以指导您完成获取用于测试目的的访问令牌的过程。

1. 使用以下命令运行 inspector。您的机器上需要安装 Node.js。

   ```bash
   npx @modelcontextprotocol/inspector
   ```

2. 在左侧边栏中，对于 "Transport type"，选择 "SSE" 或 "Streamable HTTP"。
3. 输入 MCP 服务器的 URL。
4. 在右侧区域中，点击 "Need to configure authentication?" 后面的 "Open Auth Settings" 按钮。
5. 点击 "Quick OAuth Flow" 并在 OAuth 界面上进行授权。
6. 按照 inspector 中 "OAuth Flow Progress" 部分的步骤操作，点击 "Continue" 直到到达 "Authentication complete"。
7. 复制 `access_token` 值。
8. 将其粘贴到 MCP 服务器配置中的 `authorization_token` 字段。

### 使用访问令牌 \{#using-the-access-token}

使用上述任一 OAuth 流程获取访问令牌后，您可以在 MCP 服务器配置中使用它：

```json
{
  "mcp_servers": [
    {
      "type": "url",
      "url": "https://example-server.modelcontextprotocol.io/sse",
      "name": "authenticated-server",
      "authorization_token": "YOUR_ACCESS_TOKEN_HERE"
    }
  ]
}
```

有关 OAuth 流程的详细说明，请参阅 MCP 规范中的[授权部分](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)。

## 客户端 MCP 辅助函数 \{#client-side-mcp-helpers}

如果您管理自己的 MCP 客户端连接（例如，使用本地 stdio 服务器、MCP 提示或 MCP 资源），SDK 提供了在 MCP 类型和 Claude API 类型之间进行转换的辅助函数。这消除了在将 MCP SDK（例如 [TypeScript MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk)）与 Anthropic SDK 一起使用时的手动转换代码。

<Note>
  这些辅助函数在 Python、TypeScript、Java、Go、Ruby 和 PHP SDK 中可用。它们目前在 C# SDK 中尚不可用。本节中的示例使用 TypeScript；在其他语言中，请从以下位置导入等效的辅助函数：

  - **Python：**`anthropic.lib.tools.mcp`（使用 `pip install anthropic[mcp]` 安装）
  - **Java：**`anthropic-java-mcp` 模块中的 `com.anthropic.mcp.BetaMcp`
  - **Go：**`github.com/anthropics/anthropic-sdk-go/mcp`
  - **Ruby：**`Anthropic::Mcp`（需要 `mcp` gem）
  - **PHP：**`Anthropic\Lib\Tools\BetaMcp`
</Note>
<Note>
  当您拥有可通过 URL 访问的远程服务器且只需要工具支持时，请使用 [`mcp_servers` API 参数](#using-the-mcp-connector-in-the-messages-api)。当您需要本地服务器、提示、资源或对基础 SDK 连接的更多控制时，请使用客户端辅助函数。
</Note>

### 安装 \{#installation}

同时安装 Anthropic SDK 和 MCP SDK：

```bash
npm install @anthropic-ai/sdk @modelcontextprotocol/sdk
```

### 可用的辅助函数 \{#available-helpers}

从 beta 命名空间导入辅助函数：

```typescript nocheck
import {
  mcpTools,
  mcpMessages,
  mcpResourceToContent,
  mcpResourceToFile
} from "@anthropic-ai/sdk/helpers/beta/mcp";
```

| 辅助函数 | 说明 |
|--------|-------------|
| `mcpTools(tools, mcpClient)` | 将 MCP 工具转换为 Claude API 工具，以便与 `client.beta.messages.toolRunner()` 一起使用 |
| `mcpMessages(messages)` | 将 MCP 提示消息转换为 Claude API 消息格式 |
| `mcpResourceToContent(resource)` | 将 MCP 资源转换为 Claude API 内容块 |
| `mcpResourceToFile(resource)` | 将 MCP 资源转换为用于上传的文件对象 |

### 使用 MCP 工具 \{#use-mcp-tools}

转换 MCP 工具以便与 SDK 的[工具运行器](/docs/zh-CN/agents-and-tools/tool-use/tool-runner)一起使用，该运行器会自动处理工具执行：

```typescript nocheck hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import { mcpTools } from "@anthropic-ai/sdk/helpers/beta/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const anthropic = new Anthropic();

// 连接到 MCP 服务器
const transport = new StdioClientTransport({ command: "mcp-server", args: [] });
const mcpClient = new Client({ name: "my-client", version: "1.0.0" });
await mcpClient.connect(transport);

// 列出工具并将其转换为 Claude API 格式
const { tools } = await mcpClient.listTools();
const finalMessage = await anthropic.beta.messages.toolRunner({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [{ role: "user", content: "What tools do you have available?" }],
  tools: mcpTools(tools, mcpClient)
});

console.log(finalMessage);
```

### 使用 MCP 提示 \{#use-mcp-prompts}

将 MCP 提示消息转换为 Claude API 消息格式：

```typescript nocheck
import { mcpMessages } from "@anthropic-ai/sdk/helpers/beta/mcp";

const { messages } = await mcpClient.getPrompt({ name: "my-prompt" });
const response = await anthropic.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: mcpMessages(messages)
});

console.log(response);
```

### 使用 MCP 资源 \{#use-mcp-resources}

将 MCP 资源转换为内容块以包含在消息中，或转换为用于上传的文件对象：

```typescript nocheck
import { mcpResourceToContent, mcpResourceToFile } from "@anthropic-ai/sdk/helpers/beta/mcp";

// 作为消息中的内容块
const resource = await mcpClient.readResource({ uri: "file:///path/to/doc.txt" });
await anthropic.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        mcpResourceToContent(resource),
        { type: "text", text: "Summarize this document" }
      ]
    }
  ]
});

// 作为文件上传
const fileResource = await mcpClient.readResource({ uri: "file:///path/to/data.json" });
await anthropic.beta.files.upload({ file: mcpResourceToFile(fileResource) });
```

### 错误处理 \{#error-handling}

如果 Claude API 不支持某个 MCP 值，转换函数会抛出 `UnsupportedMCPValueError`。这可能发生在不支持的内容类型、MIME 类型或非 HTTP 资源链接的情况下。

## 批量请求 \{#batch-requests}

您可以在[消息批处理 API](/docs/zh-CN/build-with-claude/batch-processing) 请求中包含 `mcp_servers`。通过批处理 API 进行的 MCP 工具调用的定价与常规 Messages API 请求中的定价相同。

## 数据保留 \{#data-retention}

MCP 连接器不在 ZDR 协议的覆盖范围内。与 MCP 服务器交换的数据（包括工具定义和执行结果）将根据 Anthropic 的标准数据保留政策进行保留。

有关所有功能的 ZDR 资格，请参阅 [API 和数据保留](/docs/zh-CN/manage-claude/api-and-data-retention)。

## 迁移指南 \{#migration-guide}

如果您正在使用已弃用的 `mcp-client-2025-04-04` beta 标头，请按照本指南迁移到新版本。

### 主要变更 \{#key-changes}

1. **新的 beta 标头**：从 `mcp-client-2025-04-04` 更改为 `mcp-client-2025-11-20`
2. **工具配置已移动**：工具配置现在作为 MCPToolset 对象位于 `tools` 数组中，而不是在 MCP 服务器定义中
3. **更灵活的配置**：新模式支持允许列表、拒绝列表和按工具配置

### 迁移步骤 \{#migration-steps}

**之前（已弃用）：**

```json
{
  "model": "claude-opus-4-8",
  "max_tokens": 1000,
  "messages": [
    // ...
  ],
  "mcp_servers": [
    {
      "type": "url",
      "url": "https://mcp.example.com/sse",
      "name": "example-mcp",
      "authorization_token": "YOUR_TOKEN",
      "tool_configuration": {
        "enabled": true,
        "allowed_tools": ["tool1", "tool2"]
      }
    }
  ]
}
```

**之后（当前）：**

```json
{
  "model": "claude-opus-4-8",
  "max_tokens": 1000,
  "messages": [
    // ...
  ],
  "mcp_servers": [
    {
      "type": "url",
      "url": "https://mcp.example.com/sse",
      "name": "example-mcp",
      "authorization_token": "YOUR_TOKEN"
    }
  ],
  "tools": [
    {
      "type": "mcp_toolset",
      "mcp_server_name": "example-mcp",
      "default_config": {
        "enabled": false
      },
      "configs": {
        "tool1": {
          "enabled": true
        },
        "tool2": {
          "enabled": true
        }
      }
    }
  ]
}
```

### 常见迁移模式 \{#common-migration-patterns}

| 旧模式 | 新模式 |
|-------------|-------------|
| 无 `tool_configuration`（启用所有工具） | 不带 `default_config` 或 `configs` 的 MCPToolset |
| `tool_configuration.enabled: false` | 带 `default_config.enabled: false` 的 MCPToolset |
| `tool_configuration.allowed_tools: [...]` | 带 `default_config.enabled: false` 并在 `configs` 中启用特定工具的 MCPToolset |

## 已弃用版本：mcp-client-2025-04-04 \{#deprecated-version-mcp-client-2025-04-04}

<Note type="warning">
  此版本已弃用。请使用前面的[迁移指南](#migration-guide)迁移到 `mcp-client-2025-11-20`。
</Note>

之前版本的 MCP 连接器将工具配置直接包含在 MCP 服务器定义中：

```json
{
  "mcp_servers": [
    {
      "type": "url",
      "url": "https://example-server.modelcontextprotocol.io/sse",
      "name": "example-mcp",
      "authorization_token": "YOUR_TOKEN",
      "tool_configuration": {
        "enabled": true,
        "allowed_tools": ["example_tool_1", "example_tool_2"]
      }
    }
  ]
}
```

### 已弃用的字段说明 \{#deprecated-field-descriptions}

| 属性 | 类型 | 说明 |
|----------|------|-------------|
| `tool_configuration` | object | **已弃用**：请改用 `tools` 数组中的 MCPToolset |
| `tool_configuration.enabled` | boolean | **已弃用**：请使用 MCPToolset 中的 `default_config.enabled` |
| `tool_configuration.allowed_tools` | array | **已弃用**：请使用 MCPToolset 中带 `configs` 的允许列表模式 |