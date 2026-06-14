# 编程式工具调用

---

"Programmatic tool calling"（编程式工具调用）允许 Claude 编写代码，在[代码执行](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)容器内以编程方式调用您的工具，而无需每次工具调用都经过模型往返。这降低了多工具工作流的延迟，并通过允许 Claude 在数据进入模型的上下文窗口之前对其进行过滤或处理来减少令牌消耗。在 [BrowseComp](https://arxiv.org/abs/2504.12516) 和 [DeepSearchQA](https://github.com/google-deepmind/deepsearchqa) 等智能体搜索基准测试中（这些测试评估多步骤网络研究和复杂信息检索能力），在基础搜索工具之上添加编程式工具调用使性能平均提升了 11%，同时输入令牌使用量减少了 24%（参见[通过动态过滤改进网络搜索](https://claude.com/blog/improved-web-search-with-dynamic-filtering)）。

这种差异在实际工作流中会迅速累积。以检查 20 名员工的预算合规性为例：传统方法需要 20 次独立的模型往返，过程中会将数千条费用明细项拉入上下文。而使用编程式工具调用，单个脚本即可运行全部 20 次查询、过滤结果，并仅返回超出限额的员工，将 Claude 需要推理的内容从数百 KB 缩减到寥寥几行。

<Tip>
如需深入了解编程式工具调用所解决的推理和上下文成本问题，请参阅[高级工具使用](https://www.anthropic.com/engineering/advanced-tool-use)。
</Tip>

<Note>
此功能需要启用代码执行工具。
</Note>

<Note>
此功能**不**符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。数据将根据该功能的标准保留策略进行保留。
</Note>

## 模型兼容性 \{#model-compatibility}

编程式工具调用需要 `code_execution_20260120`，以下模型支持该版本：

| 模型 |
|-------|
| Claude Fable 5 (claude-fable-5) |
| Claude Mythos 5 (claude-mythos-5) |
| Claude Opus 4.8 (claude-opus-4-8) |
| Claude Opus 4.7 (claude-opus-4-7) |
| Claude Opus 4.6 (claude-opus-4-6) |
| Claude Sonnet 4.6 (claude-sonnet-4-6) |
| Claude Opus 4.5 (claude-opus-4-5-20251101) |
| Claude Sonnet 4.5 (claude-sonnet-4-5-20250929) |

有关完整的代码执行工具版本矩阵，请参阅[代码执行工具模型兼容性表](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool#model-compatibility)。编程式工具调用可在 Claude API、[AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上使用。目前在 Amazon Bedrock 或 Vertex AI 上不可用。

## 快速开始 \{#quick-start}

以下示例展示了 Claude 如何以编程方式多次查询数据库并聚合结果：

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "anthropic-version: 2023-06-01" \
    --header "content-type: application/json" \
    --data '{
        "model": "claude-opus-4-8",
        "max_tokens": 4096,
        "messages": [
            {
                "role": "user",
                "content": "Query sales data for the West, East, and Central regions, then tell me which region had the highest revenue"
            }
        ],
        "tools": [
            {
                "type": "code_execution_20260120",
                "name": "code_execution"
            },
            {
                "name": "query_database",
                "description": "Execute a SQL query against the sales database. Returns a list of rows as JSON objects.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "sql": {
                            "type": "string",
                            "description": "SQL query to execute"
                        }
                    },
                    "required": ["sql"]
                },
                "allowed_callers": ["code_execution_20260120"]
            }
        ]
    }'
```

```bash CLI
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
messages:
  - role: user
    content: >-
      Query sales data for the West, East, and Central regions, then
      tell me which region had the highest revenue
tools:
  - type: code_execution_20260120
    name: code_execution
  - name: query_database
    description: >-
      Execute a SQL query against the sales database. Returns a list
      of rows as JSON objects.
    input_schema:
      type: object
      properties:
        sql:
          type: string
          description: SQL query to execute
      required:
        - sql
    allowed_callers:
      - code_execution_20260120
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": "Query sales data for the West, East, and Central regions, then tell me which region had the highest revenue",
        }
    ],
    tools=[
        {"type": "code_execution_20260120", "name": "code_execution"},
        {
            "name": "query_database",
            "description": "Execute a SQL query against the sales database. Returns a list of rows as JSON objects.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "SQL query to execute"}
                },
                "required": ["sql"],
            },
            "allowed_callers": ["code_execution_20260120"],
        },
    ],
)

print(response)
```

```typescript TypeScript hidelines={1..5,-3..-1}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function main() {
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content:
          "Query sales data for the West, East, and Central regions, then tell me which region had the highest revenue"
      }
    ],
    tools: [
      {
        type: "code_execution_20260120",
        name: "code_execution"
      },
      {
        name: "query_database",
        description:
          "Execute a SQL query against the sales database. Returns a list of rows as JSON objects.",
        input_schema: {
          type: "object" as const,
          properties: {
            sql: {
              type: "string",
              description: "SQL query to execute"
            }
          },
          required: ["sql"]
        },
        allowed_callers: ["code_execution_20260120"]
      }
    ]
  });

  console.log(response);
}

main().catch(console.error);
```

```csharp C# hidelines={1..13,-2..}
using Anthropic;
using Anthropic.Models.Messages;
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var parameters = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 4096,
            Messages = [
                new() {
                    Role = Role.User,
                    Content = "Query sales data for the West, East, and Central regions, then tell me which region had the highest revenue"
                }
            ],
            Tools = [
                new CodeExecutionTool20260120(),
                new ToolUnion(new Tool()
                {
                    Name = "query_database",
                    Description = "Execute a SQL query against the sales database. Returns a list of rows as JSON objects.",
                    InputSchema = new InputSchema()
                    {
                        Properties = new Dictionary<string, JsonElement>
                        {
                            ["sql"] = JsonSerializer.SerializeToElement(new { type = "string", description = "SQL query to execute" }),
                        },
                        Required = ["sql"],
                    },
                    AllowedCallers = ["code_execution_20260120"]
                }),
            ]
        };

        var message = await client.Messages.Create(parameters);
        Console.WriteLine(message);
    }
}
```

```go Go hidelines={1..13,-1}
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
		MaxTokens: 4096,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Query sales data for the West, East, and Central regions, then tell me which region had the highest revenue")),
		},
		Tools: []anthropic.ToolUnionParam{
			{OfCodeExecutionTool20260120: &anthropic.CodeExecutionTool20260120Param{}},
			{OfTool: &anthropic.ToolParam{
				Name:        "query_database",
				Description: anthropic.String("Execute a SQL query against the sales database. Returns a list of rows as JSON objects."),
				InputSchema: anthropic.ToolInputSchemaParam{
					Properties: map[string]any{
						"sql": map[string]any{
							"type":        "string",
							"description": "SQL query to execute",
						},
					},
					Required: []string{"sql"},
				},
				AllowedCallers: []string{"code_execution_20260120"},
			}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..7,9..13,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Tool;
import com.anthropic.models.messages.Tool.InputSchema;
import com.anthropic.models.messages.CodeExecutionTool20260120;
import java.util.List;
import java.util.Map;

public class Main {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addUserMessage("Query sales data for the West, East, and Central regions, then tell me which region had the highest revenue")
            .addTool(CodeExecutionTool20260120.builder().build())
            .addTool(Tool.builder()
                .name("query_database")
                .description("Execute a SQL query against the sales database. Returns a list of rows as JSON objects.")
                .inputSchema(InputSchema.builder()
                    .properties(JsonValue.from(Map.of(
                        "sql", Map.of(
                            "type", "string",
                            "description", "SQL query to execute"
                        )
                    )))
                    .putAdditionalProperty("required", JsonValue.from(List.of("sql")))
                    .build())
                .allowedCallers(List.of(Tool.AllowedCaller.of("code_execution_20260120")))
                .build())
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

$message = $client->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => 'Query sales data for the West, East, and Central regions, then tell me which region had the highest revenue'],
    ],
    model: 'claude-opus-4-8',
    tools: [
        [
            'type' => 'code_execution_20260120',
            'name' => 'code_execution',
        ],
        [
            'name' => 'query_database',
            'description' => 'Execute a SQL query against the sales database. Returns a list of rows as JSON objects.',
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'sql' => [
                        'type' => 'string',
                        'description' => 'SQL query to execute',
                    ],
                ],
                'required' => ['sql'],
            ],
            'allowed_callers' => ['code_execution_20260120'],
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
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content: "Query sales data for the West, East, and Central regions, then tell me which region had the highest revenue"
    }
  ],
  tools: [
    {
      type: "code_execution_20260120",
      name: "code_execution"
    },
    {
      name: "query_database",
      description: "Execute a SQL query against the sales database. Returns a list of rows as JSON objects.",
      input_schema: {
        type: "object",
        properties: {
          sql: {
            type: "string",
            description: "SQL query to execute"
          }
        },
        required: ["sql"]
      },
      allowed_callers: ["code_execution_20260120"]
    }
  ]
)

puts message
```
</CodeGroup>

## 编程式工具调用的工作原理 \{#how-programmatic-tool-calling-works}

当您将某个工具配置为可从代码执行中调用，且 Claude 决定使用该工具时：

1. Claude 编写 Python 代码，将该工具作为函数调用，可能包含多个工具调用以及前置/后置处理逻辑
2. Claude 通过代码执行在沙盒容器中运行此代码
3. 当工具函数被调用时，代码执行暂停，API 返回一个 `tool_use` 块
4. 您提供工具结果，代码执行继续（中间结果不会加载到 Claude 的上下文窗口中）
5. 所有代码执行完成后，Claude 接收最终输出并继续处理任务

此方法特别适用于：
- **大数据处理：** 在工具结果到达 Claude 的上下文之前对其进行过滤或聚合
- **多步骤工作流：** 通过串行或循环调用工具而无需在工具调用之间对 Claude 进行采样，从而节省令牌和延迟
- **条件逻辑：** 基于中间工具结果做出决策

<Note>
自定义工具会被转换为异步 Python 函数以支持并行工具调用。当 Claude 编写调用您工具的代码时，它会使用 `await`（例如 `result = await query_database("<sql>")`），并自动包含相应的异步包装函数。

为清晰起见，本文档的代码示例中省略了异步包装器。
</Note>

## 核心概念 \{#core-concepts}

### `allowed_callers` 字段 \{#the-allowed-callers-field}

`allowed_callers` 字段指定哪些上下文可以调用工具：

```json
{
  "name": "query_database",
  "description": "Execute a SQL query against the database",
  "input_schema": {
    // ...
  },
  "allowed_callers": ["code_execution_20260120"]
}
```

**可能的值：**
- `["direct"]` - 引导 Claude 直接调用此工具（省略时的默认值）
- `["code_execution_20260120"]` - 引导 Claude 仅从代码执行内部调用此工具
- `["direct", "code_execution_20260120"]` - Claude 可以直接调用此工具，也可以从代码执行内部调用

<Tip>
为每个工具选择 `["direct"]` 或 `["code_execution_20260120"]` 之一，而不是同时启用两者，因为这能为 Claude 提供更清晰的指导，帮助其确定如何最好地使用该工具。
</Tip>

<Note>
`allowed_callers` 控制工具如何呈现给 Claude，并会针对 `tool_choice` 进行验证，但它并非 API 层面对直接调用的硬性阻止。Claude 会被强烈引导遵守此设置，但您的客户端仍应准备好处理其定义的任何工具的直接 `tool_use`。请勿将 `allowed_callers` 作为安全边界来依赖。
</Note>

### 响应中的 `caller` 字段 \{#the-caller-field-in-responses}

每个工具使用块都包含一个 `caller` 字段，指示其调用方式：

**直接调用（传统工具使用）：**
```json
{
  "type": "tool_use",
  "id": "toolu_abc123",
  "name": "query_database",
  "input": { "sql": "<sql>" },
  "caller": { "type": "direct" }
}
```

**编程式调用：**
```json
{
  "type": "tool_use",
  "id": "toolu_xyz789",
  "name": "query_database",
  "input": { "sql": "<sql>" },
  "caller": {
    "type": "code_execution_20260120",
    "tool_id": "srvtoolu_abc123"
  }
}
```

`tool_id` 引用发起编程式调用的代码执行工具。

### 容器生命周期 \{#container-lifecycle}

编程式工具调用使用与代码执行相同的容器：

- **容器创建：** 除非您重用现有容器，否则每个请求都会创建一个新容器
- **过期：** 容器的最长生命周期为 30 天，空闲 4.5 分钟后会被清理
- **容器 ID：** 在响应的 `container` 字段中返回
- **重用：** 传递容器 ID 以在请求之间保持状态

<Warning>
当工具被以编程方式调用且容器正在等待您的工具结果时，您必须在容器过期之前响应。请监控 `expires_at` 字段。如果容器过期，Claude 可能会将该工具调用视为超时并重试。
</Warning>

## 示例工作流 \{#example-workflow}

以下是完整的编程式工具调用流程的工作方式：

### 步骤 1：初始请求 \{#step-1-initial-request}

发送一个包含代码执行和允许编程式调用的工具的请求。要启用编程式调用，请在工具定义中添加 `allowed_callers` 字段。

<Note>
在工具描述中提供工具输出格式的详细说明。如果您指定工具返回 JSON，Claude 会尝试在代码中反序列化并处理结果。您提供的输出模式细节越多，Claude 就越能以编程方式处理响应。
</Note>

请求结构与[快速开始](#快速开始)示例相同：在工具列表中包含 `code_execution`，为您希望 Claude 从代码中调用的任何工具添加 `allowed_callers: ["code_execution_20260120"]`，然后发送您的用户消息。本工作流的其余步骤使用的用户消息为 `"Query customer purchase history from the last quarter and identify our top 5 customers by revenue"`。

### 步骤 2：包含工具调用的 API 响应 \{#step-2-api-response-with-tool-call}

Claude 编写调用您工具的代码。API 暂停并返回：

```json Output
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I'll query the purchase history and analyze the results."
    },
    {
      "type": "server_tool_use",
      "id": "srvtoolu_abc123",
      "name": "code_execution",
      "input": {
        "code": "results = await query_database('<sql>')\ntop_customers = sorted(results, key=lambda x: x['revenue'], reverse=True)[:5]\nprint(f'Top 5 customers: {top_customers}')"
      }
    },
    {
      "type": "tool_use",
      "id": "toolu_def456",
      "name": "query_database",
      "input": { "sql": "<sql>" },
      "caller": {
        "type": "code_execution_20260120",
        "tool_id": "srvtoolu_abc123"
      }
    }
  ],
  "container": {
    "id": "container_xyz789",
    "expires_at": "2026-01-20T14:30:00Z"
  },
  "stop_reason": "tool_use"
}
```

### 步骤 3：提供工具结果 \{#step-3-provide-tool-result}

包含完整的对话历史以及您的工具结果：

<CodeGroup>

```bash CLI nocheck
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
container: container_xyz789
messages:
  - role: user
    content: >-
      Query customer purchase history from the last quarter and identify our
      top 5 customers by revenue
  - role: assistant
    content:
      - type: text
        text: I'll query the purchase history and analyze the results.
      - type: server_tool_use
        id: srvtoolu_abc123
        name: code_execution
        input:
          code: "..."
      - type: tool_use
        id: toolu_def456
        name: query_database
        input:
          sql: "<sql>"
        caller:
          type: code_execution_20260120
          tool_id: srvtoolu_abc123
  - role: user
    content:
      - type: tool_result
        tool_use_id: toolu_def456
        content: >-
          [{"customer_id": "C1", "revenue": 45000}, {"customer_id": "C2",
          "revenue": 38000}, ...]
tools: [...]
YAML
```

```python Python nocheck
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    container="container_xyz789",  # Reuse the container
    messages=[
        {
            "role": "user",
            "content": "Query customer purchase history from the last quarter and identify our top 5 customers by revenue",
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "I'll query the purchase history and analyze the results.",
                },
                {
                    "type": "server_tool_use",
                    "id": "srvtoolu_abc123",
                    "name": "code_execution",
                    "input": {"code": "..."},
                },
                {
                    "type": "tool_use",
                    "id": "toolu_def456",
                    "name": "query_database",
                    "input": {"sql": "<sql>"},
                    "caller": {
                        "type": "code_execution_20260120",
                        "tool_id": "srvtoolu_abc123",
                    },
                },
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_def456",
                    "content": '[{"customer_id": "C1", "revenue": 45000}, {"customer_id": "C2", "revenue": 38000}, ...]',
                }
            ],
        },
    ],
    tools=[...],
)

print(response)
```

```typescript TypeScript nocheck
const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  container: "container_xyz789", // Reuse the container
  messages: [
    {
      role: "user",
      content:
        "Query customer purchase history from the last quarter and identify our top 5 customers by revenue"
    },
    {
      role: "assistant",
      content: [
        { type: "text", text: "I'll query the purchase history and analyze the results." },
        {
          type: "server_tool_use",
          id: "srvtoolu_abc123",
          name: "code_execution",
          input: { code: "..." }
        },
        {
          type: "tool_use",
          id: "toolu_def456",
          name: "query_database",
          input: { sql: "<sql>" },
          caller: {
            type: "code_execution_20260120",
            tool_id: "srvtoolu_abc123"
          }
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_def456",
          content:
            '[{"customer_id": "C1", "revenue": 45000}, {"customer_id": "C2", "revenue": 38000}, ...]'
        }
      ]
    }
  ],
  tools: [
    /* ... */
  ]
});

console.log(response);
```

```csharp C# nocheck
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var parameters = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 4096,
            Container = "container_xyz789",
            Messages =
            [
                new()
                {
                    Role = Role.User,
                    Content = "Query customer purchase history from the last quarter and identify our top 5 customers by revenue"
                },
                new()
                {
                    Role = Role.Assistant,
                    Content = new ContentBlock[]
                    {
                        new TextBlock { Text = "I'll query the purchase history and analyze the results." },
                        new ServerToolUseBlock
                        {
                            Id = "srvtoolu_abc123",
                            Name = "code_execution",
                            Input = new { code = "..." }
                        },
                        new ToolUseBlock
                        {
                            Id = "toolu_def456",
                            Name = "query_database",
                            Input = new { sql = "<sql>" },
                            Caller = new ToolCaller
                            {
                                Type = "code_execution_20260120",
                                ToolId = "srvtoolu_abc123"
                            }
                        }
                    }
                },
                new()
                {
                    Role = Role.User,
                    Content = new ContentBlockParam[]
                    {
                        new ToolResultBlockParam
                        {
                            ToolUseID = "toolu_def456",
                            Content = "[{\"customer_id\": \"C1\", \"revenue\": 45000}, {\"customer_id\": \"C2\", \"revenue\": 38000}, ...]"
                        }
                    }
                }
            ],
            Tools = []
        };

        var message = await client.Messages.Create(parameters);
        Console.WriteLine(message);
    }
}
```

```go Go nocheck hidelines={1..13,-1}
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
		MaxTokens: 4096,
		Container: anthropic.MessageNewParamsContainerUnion{
			OfString: anthropic.String("container_xyz789"),
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Query customer purchase history from the last quarter and identify our top 5 customers by revenue")),
			{
				Role: anthropic.MessageParamRoleAssistant,
				Content: []anthropic.ContentBlockParamUnion{
					anthropic.NewTextBlock("I'll query the purchase history and analyze the results."),
					{OfServerToolUse: &anthropic.ServerToolUseBlockParam{
						ID:    "srvtoolu_abc123",
						Name:  anthropic.ServerToolUseBlockParamNameCodeExecution,
						Input: map[string]any{"code": "..."},
					}},
					{OfToolUse: &anthropic.ToolUseBlockParam{
						ID:    "toolu_def456",
						Name:  "query_database",
						Input: map[string]any{"sql": "<sql>"},
						Caller: anthropic.ServerToolUseBlockParamCallerUnion{
							OfCodeExecution20260120: &anthropic.ServerToolCaller20260120Param{
								ToolID: "srvtoolu_abc123",
							},
						},
					}},
				},
			},
			{
				Role: anthropic.MessageParamRoleUser,
				Content: []anthropic.ContentBlockParamUnion{
					{OfToolResult: &anthropic.ToolResultBlockParam{
						ToolUseID: "toolu_def456",
						Content: []anthropic.ToolResultBlockParamContentUnion{
							{OfText: &anthropic.TextBlockParam{
								Text: `[{"customer_id": "C1", "revenue": 45000}, {"customer_id": "C2", "revenue": 38000}, ...]`,
							}},
						},
					}},
				},
			},
		},
		Tools: []anthropic.ToolUnionParam{
			{OfCodeExecutionTool20260120: &anthropic.CodeExecutionTool20260120Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java nocheck hidelines={1..3,5..8,10..17,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.CodeExecutionTool20260120;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.ServerToolUseBlockParam;
import com.anthropic.models.messages.TextBlockParam;
import com.anthropic.models.messages.ToolResultBlockParam;
import com.anthropic.models.messages.ToolUseBlockParam;
import java.util.List;
import java.util.Map;

public class ContainerReuse {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(4096L)
            .container("container_xyz789")
            .addUserMessage("Query customer purchase history from the last quarter and identify our top 5 customers by revenue")
            .addAssistantMessageOfBlockParams(List.of(
                ContentBlockParam.ofText(
                    TextBlockParam.builder()
                        .text("I'll query the purchase history and analyze the results.")
                        .build()),
                ContentBlockParam.ofServerToolUse(
                    ServerToolUseBlockParam.builder()
                        .id("srvtoolu_abc123")
                        .name("code_execution")
                        .input(JsonValue.from(Map.of("code", "...")))
                        .build()),
                ContentBlockParam.ofToolUse(
                    ToolUseBlockParam.builder()
                        .id("toolu_def456")
                        .name("query_database")
                        .input(JsonValue.from(Map.of("sql", "<sql>")))
                        .codeExecution20260120Caller("srvtoolu_abc123")
                        .build())
            ))
            .addUserMessageOfBlockParams(List.of(
                ContentBlockParam.ofToolResult(
                    ToolResultBlockParam.builder()
                        .toolUseId("toolu_def456")
                        .content("[{\"customer_id\": \"C1\", \"revenue\": 45000}, {\"customer_id\": \"C2\", \"revenue\": 38000}, ...]")
                        .build())
            ))
            .addTool(CodeExecutionTool20260120.builder().build())
            .build();

        Message response = client.messages().create(params);
        System.out.println(response);
    }
}
```

```php PHP hidelines={1..6} nocheck
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->messages->create(
    maxTokens: 4096,
    messages: [
        [
            'role' => 'user',
            'content' => 'Query customer purchase history from the last quarter and identify our top 5 customers by revenue',
        ],
        [
            'role' => 'assistant',
            'content' => [
                [
                    'type' => 'text',
                    'text' => "I'll query the purchase history and analyze the results.",
                ],
                [
                    'type' => 'server_tool_use',
                    'id' => 'srvtoolu_abc123',
                    'name' => 'code_execution',
                    'input' => ['code' => '...'],
                ],
                [
                    'type' => 'tool_use',
                    'id' => 'toolu_def456',
                    'name' => 'query_database',
                    'input' => ['sql' => '<sql>'],
                    'caller' => [
                        'type' => 'code_execution_20260120',
                        'tool_id' => 'srvtoolu_abc123',
                    ],
                ],
            ],
        ],
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'tool_result',
                    'tool_use_id' => 'toolu_def456',
                    'content' => '[{"customer_id": "C1", "revenue": 45000}, {"customer_id": "C2", "revenue": 38000}, ...]',
                ],
            ],
        ],
    ],
    model: 'claude-opus-4-8',
    container: 'container_xyz789',
    tools: [],
);

echo $message;
```

```ruby Ruby nocheck
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  container: "container_xyz789",
  messages: [
    {
      role: "user",
      content: "Query customer purchase history from the last quarter and identify our top 5 customers by revenue"
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I'll query the purchase history and analyze the results."
        },
        {
          type: "server_tool_use",
          id: "srvtoolu_abc123",
          name: "code_execution",
          input: { code: "..." }
        },
        {
          type: "tool_use",
          id: "toolu_def456",
          name: "query_database",
          input: { sql: "<sql>" },
          caller: {
            type: "code_execution_20260120",
            tool_id: "srvtoolu_abc123"
          }
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_def456",
          content: '[{"customer_id": "C1", "revenue": 45000}, {"customer_id": "C2", "revenue": 38000}, ...]'
        }
      ]
    }
  ],
  tools: [
    { type: "code_execution_20260120", name: "code_execution" }
  ]
)
puts message
```
</CodeGroup>

### 步骤 4：下一个工具调用或完成 \{#step-4-next-tool-call-or-completion}

代码执行继续并处理结果。如果需要额外的工具调用，请重复步骤 3，直到满足所有工具调用。

### 步骤 5：最终响应 \{#step-5-final-response}

代码执行完成后，Claude 提供最终响应：

```json Output
{
  "content": [
    {
      "type": "code_execution_tool_result",
      "tool_use_id": "srvtoolu_abc123",
      "content": {
        "type": "code_execution_result",
        "stdout": "Top 5 customers: [{'customer_id': 'C1', 'revenue': 45000}, {'customer_id': 'C2', 'revenue': 38000}, {'customer_id': 'C5', 'revenue': 32000}, {'customer_id': 'C8', 'revenue': 28500}, {'customer_id': 'C3', 'revenue': 24000}]",
        "stderr": "",
        "return_code": 0,
        "content": []
      }
    },
    {
      "type": "text",
      "text": "I've analyzed the purchase history from last quarter. Your top 5 customers generated $167,500 in total revenue, with Customer C1 leading at $45,000."
    }
  ],
  "stop_reason": "end_turn"
}
```

## 高级模式 \{#advanced-patterns}

### 使用循环进行批处理 \{#batch-processing-with-loops}

Claude 可以编写高效处理多个项目的代码：

```python hidelines={1..4,-1}
async def query_database(sql):
    return [{"revenue": 100}]


async def _claude_code():
    regions = ["West", "East", "Central", "North", "South"]
    results = {}
    for region in regions:
        data = await query_database(f"<sql for {region}>")
        results[region] = sum(row["revenue"] for row in data)

    # 以编程方式处理结果
    top_region = max(results.items(), key=lambda x: x[1])
    print(f"Top region: {top_region[0]} with ${top_region[1]:,} in revenue")


_ = _claude_code
```

此模式：
- 将模型往返次数从 N 次（每个区域一次）减少到 1 次
- 在返回给 Claude 之前以编程方式处理大型结果集
- 通过仅返回聚合结论而非原始数据来节省令牌

### 提前终止 \{#early-termination}

Claude 可以在满足成功条件后立即停止处理：

```python hidelines={1..4,-1}
async def check_health(ep):
    return "healthy"


async def _claude_code():
    endpoints = ["us-east", "eu-west", "apac"]
    for endpoint in endpoints:
        status = await check_health(endpoint)
        if status == "healthy":
            print(f"Found healthy endpoint: {endpoint}")
            break  # Stop early, don't check remaining


_ = _claude_code
```

### 条件工具选择 \{#conditional-tool-selection}

```python hidelines={1..15,-1}
async def get_file_info(p):
    return {"size": 500}


async def read_full_file(p):
    return "content"


async def read_file_summary(p):
    return "summary"


path = "/tmp/example.txt"


async def _claude_code():
    file_info = await get_file_info(path)
    if file_info["size"] < 10000:
        content = await read_full_file(path)
    else:
        content = await read_file_summary(path)
    print(content)


_ = _claude_code
```

### 数据过滤 \{#data-filtering}

```python hidelines={1..7,-1}
async def fetch_logs(sid):
    return ["INFO: ok", "ERROR: failed"]


server_id = "srv-01"


async def _claude_code():
    logs = await fetch_logs(server_id)
    errors = [log for log in logs if "ERROR" in log]
    print(f"Found {len(errors)} errors")
    for error in errors[-10:]:  # Only return last 10 errors
        print(error)


_ = _claude_code
```

## 响应格式 \{#response-format}

### 编程式工具调用 \{#programmatic-tool-call}

当代码执行调用工具时：

```json
{
  "type": "tool_use",
  "id": "toolu_abc123",
  "name": "query_database",
  "input": { "sql": "<sql>" },
  "caller": {
    "type": "code_execution_20260120",
    "tool_id": "srvtoolu_xyz789"
  }
}
```

### 工具结果处理 \{#tool-result-handling}

您的工具结果会被传回正在运行的代码：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_abc123",
      "content": "[{\"customer_id\": \"C1\", \"revenue\": 45000, \"orders\": 23}, {\"customer_id\": \"C2\", \"revenue\": 38000, \"orders\": 18}, ...]"
    }
  ]
}
```

### 代码执行完成 \{#code-execution-completion}

当所有工具调用都已满足且代码完成时：

```json
{
  "type": "code_execution_tool_result",
  "tool_use_id": "srvtoolu_xyz789",
  "content": {
    "type": "code_execution_result",
    "stdout": "Analysis complete. Top 5 customers identified from 847 total records.",
    "stderr": "",
    "return_code": 0,
    "content": []
  }
}
```

## 错误处理 \{#error-handling}

### 常见错误 \{#common-errors}

| 错误 | 描述 | 解决方案 |
|-------|-------------|----------|
| `invalid_tool_input` | 工具输入与模式不匹配 | 验证您工具的 input_schema |
| `invalid_request_error`（针对 `tool_choice`） | `tool_choice` 指定的工具的 `allowed_callers` 不包含 `"direct"` | 将 `"direct"` 添加到该工具的 `allowed_callers`，或从 `tool_choice` 中移除该工具并让 Claude 从代码中调用它 |

### 工具调用期间容器过期 \{#container-expiration-during-tool-call}

如果您的工具响应时间过长，代码执行会收到 `TimeoutError`。Claude 会在 stderr 中看到此错误，通常会重试：

```json
{
  "type": "code_execution_tool_result",
  "tool_use_id": "srvtoolu_abc123",
  "content": {
    "type": "code_execution_result",
    "stdout": "",
    "stderr": "TimeoutError: Calling tool ['query_database'] timed out.",
    "return_code": 0,
    "content": []
  }
}
```

防止超时的方法：
- 监控响应中的 `expires_at` 字段
- 为您的工具执行实现超时机制
- 考虑将长时间操作拆分为较小的块

### 工具执行错误 \{#tool-execution-errors}

如果您的工具返回错误：

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_abc123",
  "content": "Error: Query timeout - table lock exceeded 30 seconds"
}
```

Claude 的代码会收到此错误并可以适当地处理它。

## 约束和限制 \{#constraints-and-limitations}

### 功能不兼容性 \{#feature-incompatibilities}

- **结构化输出：** 编程式调用不支持设置了 `strict: true` 的工具
- **工具选择：** 您无法通过 `tool_choice` 强制对特定工具进行编程式调用
- **并行工具使用：** 编程式调用不支持 `disable_parallel_tool_use: true`

### 工具限制 \{#tool-restrictions}

以下工具无法以编程方式调用：

- 由 [MCP 连接器](/docs/zh-CN/agents-and-tools/mcp-connector)提供的工具

### 消息格式限制 \{#message-formatting-restrictions}

响应编程式工具调用时，有严格的格式要求：

**仅工具结果响应：** 如果有待处理的编程式工具调用正在等待结果，您的响应消息必须**仅**包含 `tool_result` 块。您不能包含任何文本内容，即使在工具结果之后也不行。

无效 - 响应编程式工具调用时不能包含文本：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01",
      "content": "[{\"customer_id\": \"C1\", \"revenue\": 45000}]"
    },
    { "type": "text", "text": "What should I do next?" }
  ]
}
```

有效 - 响应编程式工具调用时仅包含工具结果：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01",
      "content": "[{\"customer_id\": \"C1\", \"revenue\": 45000}]"
    }
  ]
}
```

此限制仅适用于响应编程式（代码执行）工具调用的情况。对于常规客户端工具调用，您可以在工具结果之后包含文本内容。

### 速率限制 \{#rate-limits}

编程式工具调用受与常规工具调用相同的速率限制约束。来自代码执行的每个工具调用都计为一次单独的调用。

### 使用前验证工具结果 \{#validate-tool-results-before-use}

在实现将被以编程方式调用的用户定义工具时：

- **工具结果以字符串形式返回：** 它们可以包含任何内容，包括可能被执行环境处理的代码片段或可执行命令。
- **验证外部工具结果：** 如果您的工具返回来自外部来源的数据或接受用户输入，请注意当输出将被解释或作为代码执行时存在的代码注入风险。

## 令牌效率 \{#token-efficiency}

编程式工具调用可以显著减少令牌消耗：

- **编程式调用的工具结果不会添加到 Claude 的上下文中** - 只有最终的代码输出会被添加
- **中间处理在代码中进行** - 过滤、聚合和其他转换不消耗模型令牌
- **在一次代码执行中进行多个工具调用** - 与单独的模型轮次相比减少了开销

例如，直接调用 10 个工具所使用的令牌约为以编程方式调用它们并返回摘要的 10 倍。

在 Anthropic 对生产环境 Claude 模型的内部评估中：

- 在一个包含 75 个工具的项目管理智能体基准测试中，启用编程式工具调用使计费输入令牌减少了约 38%，且任务准确率没有变化。
- 在 [τ²-bench](https://arxiv.org/abs/2506.07982)（航空、零售和电信领域）中，每轮进行一到两次顺序工具调用，编程式工具调用使得分保持不变，但成本增加了约 8%。顺序单次调用工作流无法从中受益。
- 在生产环境 API 流量中，`tools` 数组包含 10 到 49 个工具定义的请求在启用编程式工具调用后通常可节省 20% 到 40% 的令牌。

实际节省量因工作负载形态而异；请参阅[何时使用编程式调用](#何时使用编程式调用)。

## 使用和定价 \{#usage-and-pricing}

编程式工具调用使用与代码执行相同的定价。详情请参阅[代码执行定价](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool#usage-and-pricing)。

<Note>
编程式工具调用的令牌计数：编程式调用的工具结果不计入您的输入/输出令牌使用量。只有最终的代码执行结果和 Claude 的响应会被计入。
</Note>

## 最佳实践 \{#best-practices}

### 工具设计 \{#tool-design}

- **提供详细的输出描述：** 由于 Claude 在代码中反序列化工具结果，请清晰地记录格式（JSON 结构和字段类型）
- **返回结构化数据：** JSON 或其他易于解析的格式最适合编程式处理
- **保持响应简洁：** 仅返回必要的数据以最小化处理开销

### 何时使用编程式调用 \{#when-to-use-programmatic-calling}

编程式工具调用以少量固定开销（容器启动、脚本生成）换取工具结果令牌和模型往返的大幅节省。这种权衡是否划算取决于工作负载形态。

**非常适合：**
- 跨多个项目的扇出或并行操作（例如，检查 50 个端点或查询 20 条记录）
- 可以在到达 Claude 上下文之前进行过滤、聚合或汇总的大型工具结果
- 智能体搜索和检索，其中迭代查询和结果过滤主导整个工作流

**不太适合：**
- 严格顺序的工作流，其中每次调用都依赖于 Claude 对前一个结果的推理，因为在这种情况下脚本无法跳过模型往返
- 少量工具调用且响应较小的情况，尤其是在对话的第一轮，此时容器和脚本开销可能超过节省的成本
- 需要在调用之间立即获得用户反馈的工具

如果您不确定，请在广泛启用之前，在您流量的代表性样本上测量启用和不启用 `allowed_callers` 时的计费输入令牌。

### 性能优化 \{#performance-optimization}

- 在进行多个相关请求时**重用容器**以保持状态
- 尽可能在单次代码执行中**批处理类似操作**

## 故障排除 \{#troubleshooting}

### 常见问题 \{#common-issues}

**设置 `tool_choice` 时出现 `invalid_request_error`**
- `tool_choice` 不能指定 `allowed_callers` 中省略了 `"direct"` 的工具。请将 `"direct"` 添加到该工具的 `allowed_callers`，或从 `tool_choice` 中移除该工具并让 Claude 从代码中调用它。

**容器过期**
- 确保在容器空闲超时之前响应工具调用（4.5 分钟无活动；30 天硬性上限）
- 监控响应中的 `expires_at` 字段
- 考虑实现更快的工具执行

**工具结果未正确解析**
- 确保您的工具返回 Claude 可以反序列化的字符串数据
- 在工具描述中提供清晰的输出格式文档

### 调试技巧 \{#debugging-tips}

1. **记录所有工具调用和结果**以跟踪流程
2. **检查 `caller` 字段**以确认编程式调用
3. **监控容器 ID** 以确保正确重用
4. 在启用编程式调用之前**独立测试工具**

## 编程式工具调用为何有效 \{#why-programmatic-tool-calling-works}

Claude 的训练包含大量代码内容，使其能够有效地推理和链接函数调用。当工具在代码执行环境中以可调用函数的形式呈现时，Claude 可以利用这一优势来：

- **自然地推理工具组合：** 像编写任何 Python 代码一样自然地链接操作和处理依赖关系
- **高效处理大型结果：** 过滤大型工具输出、仅提取相关数据，或在将摘要返回到上下文窗口之前将中间结果写入文件
- **显著降低延迟：** 消除多步骤工作流中每次工具调用之间重新采样 Claude 的开销

这种方法使传统工具使用中不切实际的工作流（例如处理超过 100 万令牌的文件）成为可能，因为它允许 Claude 以编程方式处理数据，而不是将所有内容加载到对话上下文中。

## 替代实现方案 \{#alternative-implementations}

编程式工具调用是一种可泛化的模式，也可以在您自己的基础设施上实现。以下是各种方法的比较：

### 客户端直接执行 \{#client-side-direct-execution}

为 Claude 提供一个代码执行工具，并描述该环境中可用的函数。当 Claude 使用代码调用该工具时，您的应用程序在定义这些函数的本地环境中执行它。

**优点：**
- 实现简单，只需最少的重新架构
- 对环境和指令拥有完全控制权

**缺点：**
- 在沙盒之外执行不受信任的代码
- 工具调用可能成为代码注入的载体

**适用场景：** 您的应用程序可以安全地执行任意代码，您需要一个简单的解决方案，且 Anthropic 的托管方案不符合您的需求。

### 自管理沙盒执行 \{#self-managed-sandboxed-execution}

从 Claude 的角度来看方法相同，但代码在具有安全限制（例如无网络出口）的沙盒容器中运行。如果您的工具需要外部资源，您需要一个在沙盒外执行工具调用的协议。

**优点：**
- 在您自己的基础设施上实现安全的编程式工具调用
- 对执行环境拥有完全控制权

**缺点：**
- 构建和维护复杂
- 需要同时管理基础设施和进程间通信

**适用场景：** 安全性至关重要，且 Anthropic 的托管解决方案不符合您的要求。

### Anthropic 托管执行 \{#anthropic-managed-execution}

Anthropic 的编程式工具调用是沙盒执行的托管版本，具有针对 Claude 调优的特定 Python 环境。Anthropic 负责处理容器管理、代码执行和安全的工具调用通信。

**优点：**
- 默认安全可靠
- 易于启用，只需最少的配置
- 环境和指令针对 Claude 进行了优化

如果您正在使用 Claude API、[AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 或 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)，请考虑使用 Anthropic 的托管解决方案。

## 数据保留 \{#data-retention}

编程式工具调用构建在代码执行基础设施之上，并使用相同的沙盒容器。容器数据（包括执行产物和输出）最多保留 30 天。

有关所有功能的 ZDR 资格，请参阅 [API 和数据保留](/docs/zh-CN/manage-claude/api-and-data-retention)。

## 相关功能 \{#related-features}

<CardGroup cols={2}>
  <Card title="代码执行工具" icon="code" href="/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool">
    了解支撑编程式工具调用的底层代码执行能力。
  </Card>
  <Card title="Claude 的工具使用" icon="wrench" href="/docs/zh-CN/agents-and-tools/tool-use/overview">
    了解 Claude 工具使用的基础知识。
  </Card>
  <Card title="定义工具" icon="hammer" href="/docs/zh-CN/agents-and-tools/tool-use/define-tools">
    定义工具的分步指南。
  </Card>
</CardGroup>