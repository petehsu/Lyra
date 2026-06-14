# 定义工具

指定工具模式、编写有效的描述，并控制 Claude 何时调用您的工具。

---

## 选择模型 \{#choosing-a-model}

对于复杂的工具和模糊的查询，请使用最新的 Claude Opus (4.7) 模型；它能更好地处理多个工具，并在需要时寻求澄清。

对于简单的工具，请使用 Claude Haiku 模型，但请注意它们可能会推断缺失的参数。

<Tip>
如果将 Claude 与工具使用和扩展思考结合使用，请参阅[扩展思考指南](/docs/zh-CN/build-with-claude/extended-thinking)了解更多信息。
</Tip>

## 指定客户端工具 \{#specifying-client-tools}

客户端工具（包括 Anthropic 模式和用户定义的工具）在 API 请求的顶级参数 `tools` 中指定。每个工具定义包括：

| 参数      | 描述                                                                                         |
| :------------- | :-------------------------------------------------------------------------------------------------- |
| `name`         | 工具的名称。必须匹配正则表达式 `^[a-zA-Z0-9_-]{1,64}$`。                                 |
| `description`  | 详细的纯文本描述，说明工具的功能、何时应使用以及其行为方式。 |
| `input_schema` | 一个 [JSON Schema](https://json-schema.org/) 对象，定义工具的预期参数。     |
| `input_examples` | （可选）示例输入对象的数组，帮助 Claude 理解如何使用该工具。请参阅[提供工具使用示例](#providing-tool-use-examples)。 |

有关任何工具定义上可用的完整可选属性集（包括 `cache_control`、`strict`、`defer_loading` 和 `allowed_callers`），请参阅[工具参考](/docs/zh-CN/agents-and-tools/tool-use/tool-reference#tool-definition-properties)。

<section title="简单工具定义示例">

```json JSON
{
  "name": "get_weather",
  "description": "Get the current weather in a given location",
  "input_schema": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "The city and state, e.g. San Francisco, CA"
      },
      "unit": {
        "type": "string",
        "enum": ["celsius", "fahrenheit"],
        "description": "The unit of temperature, either 'celsius' or 'fahrenheit'"
      }
    },
    "required": ["location"]
  }
}
```

这个名为 `get_weather` 的工具需要一个输入对象，其中包含必需的 `location` 字符串和可选的 `unit` 字符串，后者必须是 "celsius" 或 "fahrenheit"。

</section>

### 工具使用系统提示 \{#tool-use-system-prompt}

当您使用 `tools` 参数调用 Claude API 时，API 会根据工具定义、工具配置和任何用户指定的系统提示构建一个特殊的系统提示。构建的提示旨在指示模型使用指定的工具，并提供工具正常运行所需的上下文：

```text
In this environment you have access to a set of tools you can use to answer the user's question.
{{ FORMATTING INSTRUCTIONS }}
String and scalar parameters should be specified as is, while lists and objects should use JSON format. Note that spaces for string values are not stripped. The output is not expected to be valid XML and is parsed with regular expressions.
Here are the functions available in JSONSchema format:
{{ TOOL DEFINITIONS IN JSON SCHEMA }}
{{ USER SYSTEM PROMPT }}
{{ TOOL CONFIGURATION }}
```

### 工具定义的最佳实践 \{#best-practices-for-tool-definitions}

为了在使用工具时让 Claude 发挥最佳性能，请遵循以下准则：

- **提供极其详细的描述。** 这是迄今为止影响工具性能最重要的因素。您的描述应解释有关工具的每个细节，包括：
  - 工具的功能
  - 何时应使用（以及何时不应使用）
  - 每个参数的含义及其如何影响工具的行为
  - 任何重要的注意事项或限制，例如当工具名称不清楚时工具不会返回哪些信息。您为 Claude 提供的关于工具的上下文越多，它就越能更好地决定何时以及如何使用这些工具。每个工具描述至少应包含 3-4 句话，如果工具较复杂则应更多。
- **优先编写描述，但对于复杂工具可考虑使用 `input_examples`。** 清晰的描述最为重要，但对于具有复杂输入、嵌套对象或格式敏感参数的工具，您可以使用 `input_examples` 字段提供经过模式验证的示例。详情请参阅[提供工具使用示例](#providing-tool-use-examples)。
- **将相关操作整合到更少的工具中。** 与其为每个操作创建单独的工具（`create_pr`、`review_pr`、`merge_pr`），不如将它们组合成一个带有 `action` 参数的单一工具。更少但功能更强大的工具可以减少选择歧义，使 Claude 更容易浏览您的工具集。
- **在工具名称中使用有意义的命名空间。** 当您的工具跨越多个服务或资源时，请在名称前加上服务前缀（例如 `github_list_prs`、`slack_send_message`）。随着工具库的增长，这可以使工具选择变得明确，在使用[工具搜索](/docs/zh-CN/agents-and-tools/tool-use/tool-search-tool)时尤为重要。
- **设计工具响应时只返回高价值信息。** 返回语义化、稳定的标识符（例如 slug 或 UUID），而不是不透明的内部引用，并且只包含 Claude 推理下一步所需的字段。臃肿的响应会浪费上下文，并使 Claude 更难提取重要信息。

<section title="良好工具描述示例">

```json JSON
{
  "name": "get_stock_price",
  "description": "Retrieves the current stock price for a given ticker symbol. The ticker symbol must be a valid symbol for a publicly traded company on a major US stock exchange like NYSE or NASDAQ. The tool will return the latest trade price in USD. It should be used when the user asks about the current or most recent price of a specific stock. It will not provide any other information about the stock or company.",
  "input_schema": {
    "type": "object",
    "properties": {
      "ticker": {
        "type": "string",
        "description": "The stock ticker symbol, e.g. AAPL for Apple Inc."
      }
    },
    "required": ["ticker"]
  }
}
```

</section>

<section title="不良工具描述示例">

```json JSON
{
  "name": "get_stock_price",
  "description": "Gets the stock price for a ticker.",
  "input_schema": {
    "type": "object",
    "properties": {
      "ticker": {
        "type": "string"
      }
    },
    "required": ["ticker"]
  }
}
```

</section>

良好的描述清楚地解释了工具的功能、何时使用、返回什么数据以及 `ticker` 参数的含义。不良的描述过于简短，让 Claude 对工具的行为和用法存在许多疑问。

<Tip>
有关工具设计（整合、命名和响应塑造）的更深入指导，请参阅[为智能体编写工具](https://www.anthropic.com/engineering/writing-tools-for-agents)。
</Tip>

## 提供工具使用示例 \{#providing-tool-use-examples}

您可以提供有效工具输入的具体示例，帮助 Claude 更有效地理解如何使用您的工具。这对于具有嵌套对象、可选参数或格式敏感输入的复杂工具特别有用。

### 基本用法 \{#basic-usage}

在工具定义中添加可选的 `input_examples` 字段，其中包含示例输入对象的数组。每个示例必须符合工具的 `input_schema`：

<CodeGroup>
```bash cURL
curl -sS https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d @- <<'EOF'
{
  "model": "claude-opus-4-8",
  "max_tokens": 1024,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get the current weather in a given location",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "The city and state, e.g. San Francisco, CA"
          },
          "unit": {
            "type": "string",
            "enum": ["celsius", "fahrenheit"],
            "description": "The unit of temperature"
          }
        },
        "required": ["location"]
      },
      "input_examples": [
        {"location": "San Francisco, CA", "unit": "fahrenheit"},
        {"location": "Tokyo, Japan", "unit": "celsius"},
        {"location": "New York, NY"}
      ]
    }
  ],
  "messages": [
    {"role": "user", "content": "What's the weather like in San Francisco?"}
  ]
}
EOF
```

```bash CLI
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
tools:
  - name: get_weather
    description: Get the current weather in a given location
    input_schema:
      type: object
      properties:
        location:
          type: string
          description: The city and state, e.g. San Francisco, CA
        unit:
          type: string
          enum: [celsius, fahrenheit]
          description: The unit of temperature
      required: [location]
    input_examples:
      - location: San Francisco, CA
        unit: fahrenheit
      - location: Tokyo, Japan
        unit: celsius
      - location: New York, NY  # 'unit' is optional
messages:
  - role: user
    content: What's the weather like in San Francisco?
YAML
```

```python Python
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=[
        {
            "name": "get_weather",
            "description": "Get the current weather in a given location",
            "input_schema": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "The city and state, e.g. San Francisco, CA",
                    },
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "The unit of temperature",
                    },
                },
                "required": ["location"],
            },
            "input_examples": [
                {"location": "San Francisco, CA", "unit": "fahrenheit"},
                {"location": "Tokyo, Japan", "unit": "celsius"},
                {
                    "location": "New York, NY"  # 'unit' is optional
                },
            ],
        }
    ],
    messages=[{"role": "user", "content": "What's the weather like in San Francisco?"}],
)

print(response)
```

```typescript TypeScript hidelines={1..4}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      name: "get_weather",
      description: "Get the current weather in a given location",
      input_schema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The city and state, e.g. San Francisco, CA"
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "The unit of temperature"
          }
        },
        required: ["location"]
      },
      input_examples: [
        {
          location: "San Francisco, CA",
          unit: "fahrenheit"
        },
        {
          location: "Tokyo, Japan",
          unit: "celsius"
        },
        {
          location: "New York, NY"
          // 演示 'unit' 是可选的
        }
      ]
    }
  ],
  messages: [{ role: "user", content: "What's the weather like in San Francisco?" }]
});

console.log(response);
```

```csharp C# hidelines={1..7}
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Tools = [
        new ToolUnion(new Tool()
        {
            Name = "get_weather",
            Description = "Get the current weather in a given location",
            InputSchema = new InputSchema()
            {
                Properties = new Dictionary<string, JsonElement>
                {
                    ["location"] = JsonSerializer.SerializeToElement(new { type = "string", description = "The city and state, e.g. San Francisco, CA" }),
                    ["unit"] = JsonSerializer.SerializeToElement(new { type = "string", @enum = new[] { "celsius", "fahrenheit" }, description = "The unit of temperature" }),
                },
                Required = ["location"],
            },
            InputExamples =
            [
                new Dictionary<string, JsonElement>()
                {
                    { "location", JsonSerializer.SerializeToElement("San Francisco, CA") },
                    { "unit", JsonSerializer.SerializeToElement("fahrenheit") },
                },
                new Dictionary<string, JsonElement>()
                {
                    { "location", JsonSerializer.SerializeToElement("Tokyo, Japan") },
                    { "unit", JsonSerializer.SerializeToElement("celsius") },
                },
                new Dictionary<string, JsonElement>()
                {
                    { "location", JsonSerializer.SerializeToElement("New York, NY") },
                },
            ],
        }),
    ],
    Messages = [
        new() { Role = Role.User, Content = "What's the weather like in San Francisco?" }
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
		MaxTokens: 1024,
		Tools: []anthropic.ToolUnionParam{
			{OfTool: &anthropic.ToolParam{
				Name:        "get_weather",
				Description: anthropic.String("Get the current weather in a given location"),
				InputSchema: anthropic.ToolInputSchemaParam{
					Properties: map[string]any{
						"location": map[string]any{
							"type":        "string",
							"description": "The city and state, e.g. San Francisco, CA",
						},
						"unit": map[string]any{
							"type":        "string",
							"enum":        []string{"celsius", "fahrenheit"},
							"description": "The unit of temperature",
						},
					},
					Required: []string{"location"},
				},
				InputExamples: []map[string]any{
					{
						"location": "San Francisco, CA",
						"unit":     "fahrenheit",
					},
					{
						"location": "Tokyo, Japan",
						"unit":     "celsius",
					},
					{
						"location": "New York, NY",
						// 演示 'unit' 是可选的
					},
				},
			}},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What's the weather like in San Francisco?")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..6,9}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.Tool;
import com.anthropic.models.messages.Tool.InputSchema;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024L)
        .addTool(Tool.builder()
            .name("get_weather")
            .description("Get the current weather in a given location")
            .inputSchema(InputSchema.builder()
                .properties(JsonValue.from(Map.of(
                    "location", Map.of(
                        "type", "string",
                        "description", "The city and state, e.g. San Francisco, CA"
                    ),
                    "unit", Map.of(
                        "type", "string",
                        "enum", List.of("celsius", "fahrenheit"),
                        "description", "The unit of temperature"
                    )
                )))
                .required(List.of("location"))
                .build())
            .putAdditionalProperty("input_examples", JsonValue.from(List.of(
                Map.of(
                    "location", "San Francisco, CA",
                    "unit", "fahrenheit"
                ),
                Map.of(
                    "location", "Tokyo, Japan",
                    "unit", "celsius"
                ),
                Map.of(
                    "location", "New York, NY"
                )
            )))
            .build())
        .addUserMessage("What's the weather like in San Francisco?")
        .build();

    Message response = client.messages().create(params);
    IO.println(response);
}
```

```php PHP
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => "What's the weather like in San Francisco?"]
    ],
    model: 'claude-opus-4-8',
    tools: [
        [
            'name' => 'get_weather',
            'description' => 'Get the current weather in a given location',
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'location' => [
                        'type' => 'string',
                        'description' => 'The city and state, e.g. San Francisco, CA'
                    ],
                    'unit' => [
                        'type' => 'string',
                        'enum' => ['celsius', 'fahrenheit'],
                        'description' => 'The unit of temperature'
                    ]
                ],
                'required' => ['location']
            ],
            'input_examples' => [
                [
                    'location' => 'San Francisco, CA',
                    'unit' => 'fahrenheit'
                ],
                [
                    'location' => 'Tokyo, Japan',
                    'unit' => 'celsius'
                ],
                [
                    'location' => 'New York, NY'
                ]
            ]
        ]
    ],
);
```

```ruby Ruby
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      name: "get_weather",
      description: "Get the current weather in a given location",
      input_schema: {
        type: "object",
        properties: {
          location: {
            type: "string",
            description: "The city and state, e.g. San Francisco, CA"
          },
          unit: {
            type: "string",
            enum: ["celsius", "fahrenheit"],
            description: "The unit of temperature"
          }
        },
        required: ["location"]
      },
      input_examples: [
        {
          location: "San Francisco, CA",
          unit: "fahrenheit"
        },
        {
          location: "Tokyo, Japan",
          unit: "celsius"
        },
        {
          location: "New York, NY"
        }
      ]
    }
  ],
  messages: [
    { role: "user", content: "What's the weather like in San Francisco?" }
  ]
)
puts message
```
</CodeGroup>

示例会与您的工具模式一起包含在提示中，向 Claude 展示格式良好的工具调用的具体模式。这有助于 Claude 理解何时包含可选参数、使用什么格式以及如何构建复杂输入。

### 要求和限制 \{#requirements-and-limitations}

- **模式验证** - 每个示例必须符合工具的 `input_schema`。无效的示例会返回 400 错误
- **不支持服务器端工具** - 输入示例适用于用户定义和 Anthropic 模式的客户端工具，但不适用于网络搜索或代码执行等服务器工具
- **令牌成本** - 示例会增加提示令牌：简单示例约 20-50 个令牌，复杂嵌套对象约 100-200 个令牌

## 控制 Claude 的输出 \{#controlling-claudes-output}

### 强制工具使用 \{#forcing-tool-use}

在某些情况下，您可能希望 Claude 使用特定工具来回答用户的问题，即使 Claude 本可以不调用工具而直接回答。您可以通过在 `tool_choice` 字段中指定工具来实现这一点，如下所示：

```text
tool_choice = {"type": "tool", "name": "get_weather"}
```

使用 tool_choice 参数时，有四个可能的选项：

- `auto` 允许 Claude 决定是否调用任何提供的工具。当提供了 `tools` 时，这是默认值。
- `any` 告诉 Claude 必须使用提供的工具之一，但不强制使用特定工具。
- `tool` 强制 Claude 始终使用特定工具。
- `none` 阻止 Claude 使用任何工具。当未提供 `tools` 时，这是默认值。

<Note>
使用[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching#what-invalidates-the-cache)时，对 `tool_choice` 参数的更改将使缓存的消息块失效。工具定义和系统提示仍保持缓存，但消息内容必须重新处理。
</Note>

下图说明了每个选项的工作方式：

<Frame>
  ![展示四个 tool_choice 选项的图表：auto、any、tool 和 none](/docs/images/tool_choice.png)
</Frame>

请注意，当您将 `tool_choice` 设置为 `any` 或 `tool` 时，API 会预填充助手消息以强制使用工具。这意味着即使明确要求，模型也不会在 `tool_use` 内容块之前发出自然语言响应或解释。

<Note>
将[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)与工具使用结合使用时，不支持 `tool_choice: {"type": "any"}` 和 `tool_choice: {"type": "tool", "name": "..."}`，使用它们会导致错误。只有 `tool_choice: {"type": "auto"}`（默认值）和 `tool_choice: {"type": "none"}` 与扩展思考兼容。
</Note>

<Note>
[Claude Mythos Preview](https://anthropic.com/glasswing) 不支持强制工具使用。在此模型上，带有 `tool_choice: {"type": "any"}` 或 `tool_choice: {"type": "tool", "name": "..."}` 的请求会返回 400 错误。请使用 `tool_choice: {"type": "auto"}`（默认值）或 `tool_choice: {"type": "none"}`，并依靠提示来影响工具选择。
</Note>

测试表明这不会降低性能。如果您希望模型在仍然要求使用特定工具的同时提供自然语言上下文或解释，您可以对 `tool_choice` 使用 `{"type": "auto"}`（默认值），并在 `user` 消息中添加明确的指令。例如：`What's the weather like in London? Use the get_weather tool in your response.`

<Tip>
**使用严格工具保证工具调用**

将 `tool_choice: {"type": "any"}` 与[严格工具使用](/docs/zh-CN/agents-and-tools/tool-use/strict-tool-use)结合使用，可以同时保证您的某个工具会被调用，并且工具输入严格遵循您的模式。在工具定义上设置 `strict: true` 以启用模式验证。
</Tip>

### 使用工具时的模型响应 \{#model-responses-with-tools}

使用工具时，Claude 通常会在调用工具之前对其正在执行的操作进行说明，或自然地回应用户。

例如，给定提示 "What's the weather like in San Francisco right now, and what time is it there?"，Claude 可能会这样响应：

```json JSON
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I'll help you check the current weather and time in San Francisco."
    },
    {
      "type": "tool_use",
      "id": "toolu_01A09q90qw90lq917835lq9",
      "name": "get_weather",
      "input": { "location": "San Francisco, CA" }
    }
  ]
}
```

这种自然的响应风格有助于用户理解 Claude 正在做什么，并创造更具对话性的交互。您可以通过系统提示以及在提示中提供 `<examples>` 来引导这些响应的风格和内容。

需要注意的是，Claude 在解释其操作时可能会使用各种措辞和方式。您的代码应像处理任何其他助手生成的文本一样处理这些响应，而不应依赖特定的格式约定。

## 后续步骤 \{#next-steps}

<CardGroup>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/handle-tool-calls" title="处理工具调用">
    解析 tool_use 块并格式化 tool_result 响应。
  </Card>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/tool-runner" title="Tool Runner (SDK)">
    让 SDK 自动处理智能体循环。
  </Card>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/tool-reference" title="工具参考">
    Anthropic 提供的工具和可选属性目录。
  </Card>
</CardGroup>