# 工具搜索工具

---

工具搜索工具使 Claude 能够通过按需动态发现和加载工具来处理数百甚至数千个工具。Claude 无需预先将所有工具定义加载到 "context window"（上下文窗口）中，而是搜索您的工具目录（包括工具名称、描述、参数名称和参数描述），并仅加载所需的工具。

这种方法解决了随着工具库规模扩大而迅速加剧的两个问题：

- **上下文膨胀：** 工具定义会快速消耗您的上下文预算。一个典型的多服务器配置（GitHub、Slack、Sentry、Grafana、Splunk）在 Claude 执行任何实际工作之前，仅定义就可能消耗约 55k 个令牌。工具搜索通常可将此开销减少 85% 以上，仅加载 Claude 处理特定请求实际需要的 3-5 个工具。
- **工具选择准确性：** 一旦可用工具超过 30-50 个，Claude 正确选择合适工具的能力就会显著下降。通过按需呈现一组聚焦的相关工具，工具搜索即使在数千个工具中也能保持较高的选择准确性。

<Tip>
有关工具搜索所解决的扩展性挑战的背景信息，请参阅 [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)。工具搜索的按需加载也是 [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) 中描述的更广泛的即时检索原则的一个实例。
</Tip>

虽然这是作为服务器端工具提供的，但您也可以实现自己的客户端工具搜索功能。有关详细信息，请参阅[自定义工具搜索实现](#custom-tool-search-implementation)。

<Note>
请通过[反馈表单](https://forms.gle/MhcGFFwLxuwnWTkYA)分享您对此功能的反馈。
</Note>

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

<Warning>
  在 Amazon Bedrock 上，服务器端工具搜索仅通过
  [InvokeModel
  API](https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-runtime_example_bedrock-runtime_InvokeModel_AnthropicClaude_section.html)
  提供，而非 Converse API。
</Warning>

<Note>
在 [AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 中，服务器端工具搜索的工作方式与 Claude API 完全相同。AWS 上的 Claude Platform 直接使用 Anthropic Messages API，因此不存在 InvokeModel 或 Converse 的区别。
</Note>

## 工具搜索的工作原理 \{#how-tool-search-works}

工具搜索有两种变体：

- **Regex**（`tool_search_tool_regex_20251119`）：Claude 构建正则表达式模式来搜索工具
- **BM25**（`tool_search_tool_bm25_20251119`）：Claude 使用自然语言查询来搜索工具

当您启用工具搜索工具时：

1. 您在工具列表中包含一个工具搜索工具（例如 `tool_search_tool_regex_20251119` 或 `tool_search_tool_bm25_20251119`）。
2. 您为不应立即加载的工具提供带有 `defer_loading: true` 的所有工具定义。
3. Claude 最初只能看到工具搜索工具和任何非延迟加载的工具。
4. 当 Claude 需要其他工具时，它会使用工具搜索工具进行搜索。
5. API 返回 3-5 个最相关的 `tool_reference` 块。
6. 这些引用会自动展开为完整的工具定义。
7. Claude 从发现的工具中进行选择并调用它们。

这样可以保持上下文窗口的高效利用，同时维持较高的工具选择准确性。

## 快速开始 \{#quick-start}

以下是一个使用延迟加载工具的简单示例：

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "anthropic-version: 2023-06-01" \
    --header "content-type: application/json" \
    --data '{
        "model": "claude-opus-4-8",
        "max_tokens": 2048,
        "messages": [
            {
                "role": "user",
                "content": "What is the weather in San Francisco?"
            }
        ],
        "tools": [
            {
                "type": "tool_search_tool_regex_20251119",
                "name": "tool_search_tool_regex"
            },
            {
                "name": "get_weather",
                "description": "Get the weather at a specific location",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string"},
                        "unit": {
                            "type": "string",
                            "enum": ["celsius", "fahrenheit"]
                        }
                    },
                    "required": ["location"]
                },
                "defer_loading": true
            },
            {
                "name": "search_files",
                "description": "Search through files in the workspace",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string"},
                        "file_types": {
                            "type": "array",
                            "items": {"type": "string"}
                        }
                    },
                    "required": ["query"]
                },
                "defer_loading": true
            }
        ]
    }'
```

```bash CLI
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 2048
messages:
  - role: user
    content: What is the weather in San Francisco?
tools:
  - type: tool_search_tool_regex_20251119
    name: tool_search_tool_regex
  - name: get_weather
    description: Get the weather at a specific location
    input_schema:
      type: object
      properties:
        location:
          type: string
        unit:
          type: string
          enum: [celsius, fahrenheit]
      required: [location]
    defer_loading: true
  - name: search_files
    description: Search through files in the workspace
    input_schema:
      type: object
      properties:
        query:
          type: string
        file_types:
          type: array
          items:
            type: string
      required: [query]
    defer_loading: true
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=2048,
    messages=[{"role": "user", "content": "What is the weather in San Francisco?"}],
    tools=[
        {"type": "tool_search_tool_regex_20251119", "name": "tool_search_tool_regex"},
        {
            "name": "get_weather",
            "description": "Get the weather at a specific location",
            "input_schema": {
                "type": "object",
                "properties": {
                    "location": {"type": "string"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
                },
                "required": ["location"],
            },
            "defer_loading": True,
        },
        {
            "name": "search_files",
            "description": "Search through files in the workspace",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "file_types": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["query"],
            },
            "defer_loading": True,
        },
    ],
)

print(response)
```

```typescript TypeScript hidelines={1..4}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 2048,
  messages: [
    {
      role: "user",
      content: "What is the weather in San Francisco?"
    }
  ],
  tools: [
    {
      type: "tool_search_tool_regex_20251119",
      name: "tool_search_tool_regex"
    },
    {
      name: "get_weather",
      description: "Get the weather at a specific location",
      input_schema: {
        type: "object" as const,
        properties: {
          location: { type: "string" },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"]
          }
        },
        required: ["location"]
      },
      defer_loading: true
    },
    {
      name: "search_files",
      description: "Search through files in the workspace",
      input_schema: {
        type: "object" as const,
        properties: {
          query: { type: "string" },
          file_types: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["query"]
      },
      defer_loading: true
    }
  ]
});

console.log(response);
```

```csharp C# hidelines={1..5}
using System;
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 2048,
    Messages = [
        new() {
            Role = Role.User,
            Content = "What is the weather in San Francisco?"
        }
    ],
    Tools = [
        new ToolUnion(new ToolSearchToolRegex20251119
        {
            Type = ToolSearchToolRegex20251119Type.ToolSearchToolRegex20251119
        }),
        new ToolUnion(new Tool()
        {
            Name = "get_weather",
            Description = "Get the weather at a specific location",
            InputSchema = new InputSchema()
            {
                Properties = new Dictionary<string, JsonElement>
                {
                    ["location"] = JsonSerializer.SerializeToElement(new { type = "string" }),
                    ["unit"] = JsonSerializer.SerializeToElement(new { type = "string", @enum = new[] { "celsius", "fahrenheit" } }),
                },
                Required = ["location"],
            },
            DeferLoading = true,
        }),
        new ToolUnion(new Tool()
        {
            Name = "search_files",
            Description = "Search through files in the workspace",
            InputSchema = new InputSchema()
            {
                Properties = new Dictionary<string, JsonElement>
                {
                    ["query"] = JsonSerializer.SerializeToElement(new { type = "string" }),
                    ["file_types"] = JsonSerializer.SerializeToElement(new { type = "array", items = new { type = "string" } }),
                },
                Required = ["query"],
            },
            DeferLoading = true,
        }),
    ]
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
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 2048,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What is the weather in San Francisco?")),
		},
		Tools: []anthropic.ToolUnionParam{
			{OfToolSearchToolRegex20251119: &anthropic.ToolSearchToolRegex20251119Param{
				Type: anthropic.ToolSearchToolRegex20251119TypeToolSearchToolRegex20251119,
			}},
			{OfTool: &anthropic.ToolParam{
				Name:        "get_weather",
				Description: anthropic.String("Get the weather at a specific location"),
				InputSchema: anthropic.ToolInputSchemaParam{
					Properties: map[string]any{
						"location": map[string]any{"type": "string"},
						"unit": map[string]any{
							"type": "string",
							"enum": []string{"celsius", "fahrenheit"},
						},
					},
					Required: []string{"location"},
				},
				DeferLoading: anthropic.Bool(true),
			}},
			{OfTool: &anthropic.ToolParam{
				Name:        "search_files",
				Description: anthropic.String("Search through files in the workspace"),
				InputSchema: anthropic.ToolInputSchemaParam{
					Properties: map[string]any{
						"query":      map[string]any{"type": "string"},
						"file_types": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					},
					Required: []string{"query"},
				},
				DeferLoading: anthropic.Bool(true),
			}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..8}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.Tool;
import com.anthropic.models.messages.Tool.InputSchema;
import com.anthropic.models.messages.ToolSearchToolRegex20251119;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    InputSchema weatherSchema = InputSchema.builder()
        .properties(JsonValue.from(Map.of(
            "location", Map.of("type", "string"),
            "unit", Map.of(
                "type", "string",
                "enum", List.of("celsius", "fahrenheit")
            )
        )))
        .putAdditionalProperty("required", JsonValue.from(List.of("location")))
        .build();

    InputSchema searchSchema = InputSchema.builder()
        .properties(JsonValue.from(Map.of(
            "query", Map.of("type", "string"),
            "file_types", Map.of(
                "type", "array",
                "items", Map.of("type", "string")
            )
        )))
        .putAdditionalProperty("required", JsonValue.from(List.of("query")))
        .build();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(2048L)
        .addUserMessage("What is the weather in San Francisco?")
        .addTool(ToolSearchToolRegex20251119.builder()
            .type(ToolSearchToolRegex20251119.Type.TOOL_SEARCH_TOOL_REGEX_20251119)
            .build())
        .addTool(Tool.builder()
            .name("get_weather")
            .description("Get the weather at a specific location")
            .inputSchema(weatherSchema)
            .deferLoading(true)
            .build())
        .addTool(Tool.builder()
            .name("search_files")
            .description("Search through files in the workspace")
            .inputSchema(searchSchema)
            .deferLoading(true)
            .build())
        .build();

    Message response = client.messages().create(params);
    IO.println(response);
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->messages->create(
    maxTokens: 2048,
    messages: [
        ['role' => 'user', 'content' => 'What is the weather in San Francisco?'],
    ],
    model: 'claude-opus-4-8',
    tools: [
        [
            'type' => 'tool_search_tool_regex_20251119',
            'name' => 'tool_search_tool_regex',
        ],
        [
            'name' => 'get_weather',
            'description' => 'Get the weather at a specific location',
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'location' => ['type' => 'string'],
                    'unit' => [
                        'type' => 'string',
                        'enum' => ['celsius', 'fahrenheit'],
                    ],
                ],
                'required' => ['location'],
            ],
            'defer_loading' => true,
        ],
        [
            'name' => 'search_files',
            'description' => 'Search through files in the workspace',
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'query' => ['type' => 'string'],
                    'file_types' => [
                        'type' => 'array',
                        'items' => ['type' => 'string'],
                    ],
                ],
                'required' => ['query'],
            ],
            'defer_loading' => true,
        ],
    ],
);

echo $message;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 2048,
  messages: [
    { role: "user", content: "What is the weather in San Francisco?" }
  ],
  tools: [
    {
      type: "tool_search_tool_regex_20251119",
      name: "tool_search_tool_regex"
    },
    {
      name: "get_weather",
      description: "Get the weather at a specific location",
      input_schema: {
        type: "object",
        properties: {
          location: { type: "string" },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"]
          }
        },
        required: ["location"]
      },
      defer_loading: true
    },
    {
      name: "search_files",
      description: "Search through files in the workspace",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string" },
          file_types: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["query"]
      },
      defer_loading: true
    }
  ]
)

puts message
```

</CodeGroup>

## 工具定义 \{#tool-definition}

工具搜索工具有两种变体：

```json JSON
{
  "type": "tool_search_tool_regex_20251119",
  "name": "tool_search_tool_regex"
}
```

```json JSON
{
  "type": "tool_search_tool_bm25_20251119",
  "name": "tool_search_tool_bm25"
}
```

<Warning>
**Regex 变体查询格式：Python 正则表达式，而非自然语言**

使用 `tool_search_tool_regex_20251119` 时，Claude 会使用 Python 的 `re.search()` 语法构建正则表达式模式，而非自然语言查询。常见模式：

- `"weather"` - 匹配名称/描述中包含 "weather" 的工具
- `"get_.*_data"` - 匹配 `get_user_data`、`get_weather_data` 等工具
- `"database.*query|query.*database"` - 使用 OR 模式提高灵活性
- `"(?i)slack"` - 不区分大小写的搜索

最大查询长度：200 个字符

</Warning>

<Note>
**BM25 变体查询格式：自然语言**

使用 `tool_search_tool_bm25_20251119` 时，Claude 使用自然语言查询来搜索工具。

</Note>

### 延迟工具加载 \{#deferred-tool-loading}

通过添加 `defer_loading: true` 将工具标记为按需加载：

```json JSON
{
  "name": "get_weather",
  "description": "Get current weather for a location",
  "input_schema": {
    "type": "object",
    "properties": {
      "location": { "type": "string" },
      "unit": { "type": "string", "enum": ["celsius", "fahrenheit"] }
    },
    "required": ["location"]
  },
  "defer_loading": true
}
```

**要点：**

- 没有 `defer_loading` 的工具会立即加载到上下文中
- 带有 `defer_loading: true` 的工具仅在 Claude 通过搜索发现它们时才会加载
- 工具搜索工具本身**绝不**应设置 `defer_loading: true`
- 将您最常用的 3-5 个工具保持为非延迟加载状态，以获得最佳性能

两种工具搜索变体（`regex` 和 `bm25`）都会搜索工具名称、描述、参数名称和参数描述。

**延迟加载的内部工作原理：** 延迟加载的工具不会包含在系统提示前缀中。当模型通过工具搜索发现延迟加载的工具时，API 会在对话中内联附加一个 `tool_reference` 块，然后在传递给 Claude 之前将其展开为完整的工具定义。前缀保持不变，因此提示缓存得以保留。[严格模式](/docs/zh-CN/agents-and-tools/tool-use/strict-tool-use)的语法（约束工具调用输出以匹配您的 schema 的规则）是基于完整工具集构建的，因此 `defer_loading` 和严格模式可以组合使用而无需重新编译语法。

## 响应格式 \{#response-format}

当 Claude 使用工具搜索工具时，响应会包含新的块类型：

```json JSON
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I'll search for tools to help with the weather information."
    },
    {
      "type": "server_tool_use",
      "id": "srvtoolu_01ABC123",
      "name": "tool_search_tool_regex",
      "input": {
        "query": "weather"
      }
    },
    {
      "type": "tool_search_tool_result",
      "tool_use_id": "srvtoolu_01ABC123",
      "content": {
        "type": "tool_search_tool_search_result",
        "tool_references": [{ "type": "tool_reference", "tool_name": "get_weather" }]
      }
    },
    {
      "type": "text",
      "text": "I found a weather tool. Let me get the weather for San Francisco."
    },
    {
      "type": "tool_use",
      "id": "toolu_01XYZ789",
      "name": "get_weather",
      "input": { "location": "San Francisco", "unit": "fahrenheit" }
    }
  ],
  "stop_reason": "tool_use"
}
```

### 理解响应 \{#understanding-the-response}

- **`server_tool_use`：** 表示 Claude 正在调用工具搜索工具
- **`tool_search_tool_result`：** 包含搜索结果，其中嵌套了一个 `tool_search_tool_search_result` 对象
- **`tool_references`：** 指向已发现工具的 `tool_reference` 对象数组
- **`tool_use`：** Claude 调用已发现的工具

`tool_reference` 块会在展示给 Claude 之前自动展开为完整的工具定义。您无需自行处理此展开过程。只要您在 `tools` 参数中提供所有匹配的工具定义，API 就会自动完成此操作。

## MCP 集成 \{#mcp-integration}

有关使用 `defer_loading` 配置 `mcp_toolset` 的信息，请参阅 [MCP 连接器](/docs/zh-CN/agents-and-tools/mcp-connector)。

## 自定义工具搜索实现 \{#custom-tool-search-implementation}

您可以通过从自定义工具返回 `tool_reference` 块来实现自己的工具搜索逻辑（例如，使用嵌入或语义搜索）。当 Claude 调用您的自定义搜索工具时，返回一个标准的 `tool_result`，并在 content 数组中包含 `tool_reference` 块：

```json JSON
{
  "type": "tool_result",
  "tool_use_id": "toolu_your_tool_id",
  "content": [{ "type": "tool_reference", "tool_name": "discovered_tool_name" }]
}
```

每个被引用的工具都必须在顶层 `tools` 参数中有对应的工具定义，并设置 `defer_loading: true`。这种方法使您可以使用更复杂的搜索算法，同时保持与工具搜索系统的兼容性。

<Note>
[响应格式](#response-format)部分中显示的 `tool_search_tool_result` 格式是 Anthropic 内置工具搜索在内部使用的服务器端格式。对于自定义客户端实现，请始终使用带有 `tool_reference` 内容块的标准 `tool_result` 格式，如前面的示例所示。
</Note>

有关使用嵌入的完整示例，请参阅[使用嵌入的工具搜索 cookbook](https://platform.claude.com/cookbooks/tool_use)。

## 错误处理 \{#error-handling}

<Note>
  工具搜索工具与[工具使用示例](/docs/zh-CN/agents-and-tools/tool-use/define-tools#providing-tool-use-examples)不兼容。
  如果您需要提供工具使用的示例，请使用不带工具搜索的标准工具调用。
</Note>

### HTTP 错误（400 状态码） \{#http-errors-400-status}

这些错误会阻止请求被处理：

**所有工具均被延迟加载：**

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "All tools have defer_loading set. At least one tool must be non-deferred."
  }
}
```

**缺少工具定义：**

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Tool reference 'unknown_tool' has no corresponding tool definition"
  }
}
```

### 工具结果错误（200 状态码） \{#tool-result-errors-200-status}

工具执行期间的错误会返回 200 响应，并在响应体中包含错误信息：

```json JSON
{
  "type": "tool_search_tool_result",
  "tool_use_id": "srvtoolu_01ABC123",
  "content": {
    "type": "tool_search_tool_result_error",
    "error_code": "invalid_pattern"
  }
}
```

**错误代码：**

- `too_many_requests`：工具搜索操作超出速率限制
- `invalid_pattern`：正则表达式模式格式错误
- `pattern_too_long`：模式超过 200 个字符的限制
- `unavailable`：工具搜索服务暂时不可用

### 常见错误 \{#common-mistakes}

<section title="400 错误：所有工具均被延迟加载">

**原因：** 您在所有工具（包括搜索工具）上都设置了 `defer_loading: true`

**修复方法：** 从工具搜索工具中移除 `defer_loading`：

```json
{
  "type": "tool_search_tool_regex_20251119",
  "name": "tool_search_tool_regex"
}
```

</section>

<section title="400 错误：缺少工具定义">

**原因：** 某个 `tool_reference` 指向的工具不在您的 `tools` 数组中

**修复方法：** 确保每个可能被发现的工具都有完整的定义：

```json
{
  "name": "my_tool",
  "description": "Full description here",
  "input_schema": {
    "type": "object"
  },
  "defer_loading": true
}
```

</section>

<section title="Claude 未找到预期的工具">

**原因：** 工具名称、描述、参数名称或参数描述与正则表达式模式不匹配

**调试步骤：**

1. 检查工具名称、描述、参数名称和参数描述。Claude 会搜索所有这些字段。
2. 测试您的模式：`import re; re.search(r"your_pattern", "tool_name")`。
3. 请记住，搜索默认区分大小写（使用 `(?i)` 进行不区分大小写的搜索）。
4. Claude 使用宽泛的模式，例如 `".*weather.*"`，而非精确匹配。

**提示：** 在工具描述中添加常用关键词以提高可发现性

</section>

## 提示缓存 \{#prompt-caching}

有关 `defer_loading` 如何保留提示缓存的信息，请参阅[工具使用与提示缓存](/docs/zh-CN/agents-and-tools/tool-use/tool-use-with-prompt-caching)。

系统会自动展开整个对话历史中的 `tool_reference` 块，因此 Claude 可以在后续轮次中重用已发现的工具，而无需重新搜索。

## 流式传输 \{#streaming}

启用 "streaming"（流式传输）后，您将在流中接收工具搜索事件：

```sse
event: content_block_start
data: {"type": "content_block_start", "index": 1, "content_block": {"type": "server_tool_use", "id": "srvtoolu_xyz789", "name": "tool_search_tool_regex"}}

// Search query streamed
event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"query\":\"weather\"}"}}

// Pause while search executes

// Search results streamed
event: content_block_start
data: {"type": "content_block_start", "index": 2, "content_block": {"type": "tool_search_tool_result", "tool_use_id": "srvtoolu_xyz789", "content": {"type": "tool_search_tool_search_result", "tool_references": [{"type": "tool_reference", "tool_name": "get_weather"}]}}}

// Claude continues with discovered tools
```

## 批量请求 \{#batch-requests}

您可以在 [Messages Batches API](/docs/zh-CN/build-with-claude/batch-processing) 中包含工具搜索工具。通过 Messages Batches API 进行的工具搜索操作的定价与常规 Messages API 请求中的定价相同。

## 限制和最佳实践 \{#limits-and-best-practices}

### 限制 \{#limits}

- **最大工具数：** 您的目录中最多可包含 10,000 个工具
- **搜索结果：** 每次搜索返回 3-5 个最相关的工具
- **模式长度：** 正则表达式模式最多 200 个字符
- **模型支持：** Claude Fable 5、Claude Mythos 5、[Claude Mythos Preview](https://anthropic.com/glasswing)、Sonnet 4.0+、Opus 4.0+、Haiku 4.5+

### 何时使用工具搜索 \{#when-to-use-tool-search}

**适用场景：**

- 您的系统中有 10 个以上的可用工具
- 工具定义消耗超过 10k 个令牌
- 在大型工具集中遇到工具选择准确性问题
- 构建具有多个服务器（200+ 个工具）的 MCP 驱动系统
- 工具库随时间不断增长

**传统工具调用可能更适合的情况：**

- 总共少于 10 个工具
- 每个请求中都会频繁使用所有工具
- 工具定义非常小（总计 \<100 个令牌）

### 优化技巧 \{#optimization-tips}

- 将最常用的 3-5 个工具保持为非延迟加载状态
- 编写清晰、描述性的工具名称和描述
- 在工具名称中使用一致的命名空间：按服务或资源添加前缀（例如 `github_`、`slack_`），以便搜索查询能够自然地呈现正确的工具组
- 在描述中使用与用户描述任务方式相匹配的语义关键词
- 添加描述可用工具类别的系统提示部分："您可以搜索用于与 Slack、GitHub 和 Jira 交互的工具"
- 监控 Claude 发现了哪些工具，以优化描述

## 用量 \{#usage}

工具搜索工具的用量会在响应的 usage 对象中进行跟踪：

```json JSON
{
  "usage": {
    "input_tokens": 1024,
    "output_tokens": 256,
    "server_tool_use": {
      "tool_search_requests": 2
    }
  }
}
```

## 后续步骤 \{#next-steps}

<CardGroup cols={2}>
  <Card title="工具参考" icon="list" href="/docs/zh-CN/agents-and-tools/tool-use/tool-reference">
    包含模型兼容性和参数的完整工具目录。
  </Card>
  <Card title="MCP 连接器" icon="plug" href="/docs/zh-CN/agents-and-tools/mcp-connector">
    配置具有延迟加载的 MCP 工具集。
  </Card>
  <Card title="提示缓存" icon="bolt" href="/docs/zh-CN/agents-and-tools/tool-use/tool-use-with-prompt-caching">
    将工具搜索与缓存的工具定义相结合。
  </Card>
  <Card title="定义工具" icon="hammer" href="/docs/zh-CN/agents-and-tools/tool-use/define-tools">
    定义工具的分步指南。
  </Card>
</CardGroup>