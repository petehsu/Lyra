# 结构化输出

从智能体工作流中获取经过验证的 JSON 结果

---

结构化输出会约束 Claude 的响应遵循特定的 schema（模式），确保输出有效且可解析，便于下游处理。结构化输出提供两个互补的功能：

- **JSON 输出**（`output_config.format`）：以特定的 JSON 格式获取 Claude 的响应
- **严格工具使用**（`strict: true`）：保证对工具名称和输入进行 schema 验证

您可以在同一请求中独立使用或组合使用这些功能。

<Note>
结构化输出已在 Claude API 上正式发布，支持 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8、[Claude Mythos Preview](https://anthropic.com/glasswing)、Claude Opus 4.7、Claude Opus 4.6、Claude Sonnet 4.6、Claude Sonnet 4.5、Claude Opus 4.5 和 Claude Haiku 4.5。在 Amazon Bedrock 上，结构化输出已正式发布，支持 Claude Opus 4.6、Claude Sonnet 4.6、Claude Sonnet 4.5、Claude Opus 4.5 和 Claude Haiku 4.5；Claude Opus 4.7 和 Claude Mythos Preview 可通过 [Claude in Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)（Messages-API Bedrock 端点）使用。结构化输出在 [Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 上可用，并在 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上提供测试版。在 [Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai) 上，结构化输出已正式发布，支持 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8、Claude Mythos Preview、Claude Opus 4.7、Claude Opus 4.6、Claude Sonnet 4.6、Claude Sonnet 4.5、Claude Opus 4.5 和 Claude Haiku 4.5。
</Note>

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件，但存在有限的技术性保留。有关保留内容及原因的详细信息，请参阅[数据保留](#data-retention)部分。
</Note>

<Tip>
**从测试版迁移？** `output_format` 参数已移至 `output_config.format`，且不再需要 beta 标头。旧的 beta 标头（`structured-outputs-2025-11-13`）和 `output_format` 参数在过渡期内仍可继续使用。请参阅以下代码示例了解更新后的 API 结构。
</Tip>

## 为什么使用结构化输出 \{#why-use-structured-outputs}

如果不使用结构化输出，Claude 可能会生成格式错误的 JSON 响应或无效的工具输入，从而导致您的应用程序出错。即使经过精心的提示设计，您仍可能遇到：
- 无效 JSON 语法导致的解析错误
- 缺少必填字段
- 数据类型不一致
- 需要错误处理和重试的 schema 违规

结构化输出通过约束解码保证响应符合 schema：
- **始终有效：** 不再出现 `JSON.parse()` 错误
- **类型安全：** 保证字段类型和必填字段
- **可靠：** 无需因 schema 违规而重试

## JSON 输出 \{#json-outputs}

JSON 输出控制 Claude 的响应格式，确保 Claude 返回符合您的 schema 的有效 JSON。在以下情况下使用 JSON 输出：

- 控制 Claude 的响应格式
- 从图像或文本中提取数据
- 生成结构化报告
- 格式化 API 响应

### 快速开始 \{#quick-start}

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm."
      }
    ],
    "output_config": {
      "format": {
        "type": "json_schema",
        "schema": {
          "type": "object",
          "properties": {
            "name": {"type": "string"},
            "email": {"type": "string"},
            "plan_interest": {"type": "string"},
            "demo_requested": {"type": "boolean"}
          },
          "required": ["name", "email", "plan_interest", "demo_requested"],
          "additionalProperties": false
        }
      }
    }
  }'
```

```bash CLI
ant messages create \
  --transform 'content.0.text|@fromstr' \
  --format jsonl <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
messages:
  - role: user
    content: >-
      Extract the key information from this email: John Smith
      (john@example.com) is interested in our Enterprise plan and wants
      to schedule a demo for next Tuesday at 2pm.
output_config:
  format:
    type: json_schema
    schema:
      type: object
      properties:
        name: {type: string}
        email: {type: string}
        plan_interest: {type: string}
        demo_requested: {type: boolean}
      required: [name, email, plan_interest, demo_requested]
      additionalProperties: false
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm.",
        }
    ],
    output_config={
        "format": {
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "email": {"type": "string"},
                    "plan_interest": {"type": "string"},
                    "demo_requested": {"type": "boolean"},
                },
                "required": ["name", "email", "plan_interest", "demo_requested"],
                "additionalProperties": False,
            },
        }
    },
)
print(response.content[0].text)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content:
        "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm."
    }
  ],
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          plan_interest: { type: "string" },
          demo_requested: { type: "boolean" }
        },
        required: ["name", "email", "plan_interest", "demo_requested"],
        additionalProperties: false
      }
    }
  }
});

for (const block of response.content) {
  if (block.type === "text") {
    console.log(block.text);
  }
}
```

```csharp C#
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Messages = [new() { Role = Role.User, Content = "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan." }],
    OutputConfig = new OutputConfig
    {
        Format = new JsonOutputFormat
        {
            Schema = new Dictionary<string, JsonElement>
            {
                ["type"] = JsonSerializer.SerializeToElement("object"),
                ["properties"] = JsonSerializer.SerializeToElement(new
                {
                    name = new { type = "string" },
                    email = new { type = "string" },
                    plan_interest = new { type = "string" },
                    demo_requested = new { type = "boolean" },
                }),
                ["required"] = JsonSerializer.SerializeToElement(new[] { "name", "email", "plan_interest", "demo_requested" }),
                ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
            },
        },
    },
};

var message = await client.Messages.Create(parameters);
Console.WriteLine(message);
```

```go Go hidelines={1..10,-1}
package main

import (
	"context"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, _ := client.Messages.New(context.Background(),
		anthropic.MessageNewParams{
			Model:     anthropic.ModelClaudeOpus4_8,
			MaxTokens: 1024,
			Messages: []anthropic.MessageParam{
				anthropic.NewUserMessage(
					anthropic.NewTextBlock("Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan."),
				),
			},
			OutputConfig: anthropic.OutputConfigParam{
				Format: anthropic.JSONOutputFormatParam{
					Schema: map[string]any{
						"type": "object",
						"properties": map[string]any{
							"name":           map[string]string{"type": "string"},
							"email":          map[string]string{"type": "string"},
							"plan_interest":  map[string]string{"type": "string"},
							"demo_requested": map[string]string{"type": "boolean"},
						},
						"required":             []string{"name", "email", "plan_interest", "demo_requested"},
						"additionalProperties": false,
					},
				},
			},
		})

	fmt.Println(response.Content[0].Text)
}
```

```java Java hidelines={1..7}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StructuredMessage;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.Model;

static class ContactInfo {
    public String name;
    public String email;
    public String plan_interest;
    public boolean demo_requested;
}

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    StructuredMessageCreateParams<ContactInfo> params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024)
        .addUserMessage("Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan.")
        .outputConfig(ContactInfo.class)
        .build();

    StructuredMessage<ContactInfo> response = client.messages().create(params);
    ContactInfo contact = response.content().stream()
        .flatMap(block -> block.text().stream())
        .findFirst().orElseThrow().text();
    IO.println(contact.name + " (" + contact.email + ")");
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$response = $client->messages->create(
    maxTokens: 1024,
    messages: [
        [
            'role' => 'user',
            'content' => 'Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan.'
        ]
    ],
    model: 'claude-opus-4-8',
    outputConfig: [
        'format' => [
            'type' => 'json_schema',
            'schema' => [
                'type' => 'object',
                'properties' => [
                    'name' => ['type' => 'string'],
                    'email' => ['type' => 'string'],
                    'plan_interest' => ['type' => 'string'],
                    'demo_requested' => ['type' => 'boolean']
                ],
                'required' => ['name', 'email', 'plan_interest', 'demo_requested'],
                'additionalProperties' => false
            ]
        ]
    ],
);

echo $response->content[0]->text;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan."
    }
  ],
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          plan_interest: { type: "string" },
          demo_requested: { type: "boolean" }
        },
        required: ["name", "email", "plan_interest", "demo_requested"],
        additionalProperties: false
      }
    }
  }
)

puts response.content[0].text
```

</CodeGroup>

**响应格式：** 在 `response.content[0].text` 中返回符合您的 schema 的有效 JSON

```json Output
{
  "name": "John Smith",
  "email": "john@example.com",
  "plan_interest": "Enterprise",
  "demo_requested": true
}
```

### 工作原理 \{#how-it-works}

<Steps>
  <Step title="定义您的 JSON schema">
    创建一个描述您希望 Claude 遵循的结构的 JSON schema。该 schema 使用标准的 JSON Schema 格式，但有一些限制（请参阅 [JSON Schema 限制](#json-schema-limitations)）。
  </Step>
  <Step title="添加 output_config.format 参数">
    在您的 API 请求中包含 `output_config.format` 参数，并设置 `type: "json_schema"` 以及您的 schema 定义。
  </Step>
  <Step title="解析响应">
    Claude 的响应是符合您的 schema 的有效 JSON，在 `response.content[0].text` 中返回。
  </Step>
</Steps>

### 在 SDK 中使用 JSON 输出 \{#working-with-json-outputs-in-sdks}

SDK 提供了辅助工具，使 JSON 输出的使用更加便捷，包括 schema 转换、自动验证以及与流行的 schema 库的集成。

<Note>
Python SDK 的 `client.messages.parse()` 仍接受 `output_format` 作为便捷参数，并在内部将其转换为 `output_config.format`。其他 SDK 需要直接使用 `output_config`。以下示例展示了 SDK 辅助工具的语法。
</Note>

#### 使用原生 schema 定义 \{#using-native-schema-definitions}

您可以使用所用语言中熟悉的 schema 定义工具，而无需编写原始的 JSON schema：

- **Python：** 使用 [Pydantic](https://docs.pydantic.dev/) 模型配合 `client.messages.parse()`
- **TypeScript：** 使用 [Zod](https://zod.dev/) schema 配合 `zodOutputFormat()`，或使用类型化的 JSON Schema 字面量配合 `jsonSchemaOutputFormat()`
- **Java：** 使用普通 Java 类，通过 `outputConfig(Class<T>)` 自动派生 schema
- **Ruby：** 使用 `Anthropic::BaseModel` 类配合 `output_config: {format: Model}`
- **PHP：** 使用实现 `StructuredOutputModel` 的类配合 `outputConfig: ['format' => MyClass::class]`
- **C#：** 使用普通 C# 类配合泛型 `Create<T>()` 重载，自动派生 schema
- **Go：** 在 beta API 上自动将 Go 结构体反射为 JSON schema，或通过 `output_config` 传递原始 JSON schema
- **CLI：** 通过 `output_config` 传递原始 JSON schema

<CodeGroup>

```bash CLI
{ read -r _ NAME; read -r _ EMAIL; } < <(
  ant messages create \
    --transform 'content.0.text|@fromstr|{name,email}' --format yaml <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
messages:
  - role: user
    content: >-
      Extract the key information from this email: John Smith
      (john@example.com) is interested in our Enterprise plan and wants
      to schedule a demo for next Tuesday at 2pm.
output_config:
  format:
    type: json_schema
    schema:
      type: object
      properties:
        name: {type: string}
        email: {type: string}
        plan_interest: {type: string}
        demo_requested: {type: boolean}
      required: [name, email, plan_interest, demo_requested]
      additionalProperties: false
YAML
)
printf '%s (%s)\n' "$NAME" "$EMAIL"
```

```python Python
from pydantic import BaseModel
from anthropic import Anthropic


class ContactInfo(BaseModel):
    name: str
    email: str
    plan_interest: str
    demo_requested: bool


client = Anthropic()

response = client.messages.parse(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm.",
        }
    ],
    output_format=ContactInfo,
)

print(response.parsed_output)
```

```typescript TypeScript hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const ContactInfoSchema = z.object({
  name: z.string(),
  email: z.string(),
  plan_interest: z.string(),
  demo_requested: z.boolean()
});

const client = new Anthropic();

const response = await client.messages.parse({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content:
        "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm."
    }
  ],
  output_config: { format: zodOutputFormat(ContactInfoSchema) }
});

// 自动解析并验证
console.log(response.parsed_output);
```

```csharp C#
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

var client = new AnthropicClient();

var response = await client.Messages.Create(new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Messages = [new() {
        Role = Role.User,
        Content = "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm."
    }],
    OutputConfig = new OutputConfig
    {
        Format = new JsonOutputFormat
        {
            Schema = new Dictionary<string, JsonElement>
            {
                ["type"] = JsonSerializer.SerializeToElement("object"),
                ["properties"] = JsonSerializer.SerializeToElement(new
                {
                    name = new { type = "string" },
                    email = new { type = "string" },
                    plan_interest = new { type = "string" },
                    demo_requested = new { type = "boolean" },
                }),
                ["required"] = JsonSerializer.SerializeToElement(
                    new[] { "name", "email", "plan_interest", "demo_requested" }),
                ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
            },
        },
    },
});

if (response.Content[0].TryPickText(out var textBlock))
{
    // JSON 保证符合该 schema
    var contact = JsonSerializer.Deserialize<Dictionary<string, object>>(textBlock.Text)!;
    Console.WriteLine($"{contact["name"]} ({contact["email"]})");
}
```

```go Go hidelines={1..2,4..7,27..29,-1}
package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/invopop/jsonschema"
)

type ContactInfo struct {
	Name          string `json:"name" jsonschema:"description=Full name"`
	Email         string `json:"email" jsonschema:"description=Email address"`
	PlanInterest  string `json:"plan_interest" jsonschema:"description=Plan type"`
	DemoRequested bool   `json:"demo_requested" jsonschema:"description=Whether a demo was requested"`
}

func generateSchema(v any) map[string]any {
	r := jsonschema.Reflector{AllowAdditionalProperties: false, DoNotReference: true}
	s := r.Reflect(v)
	b, _ := json.Marshal(s)
	var m map[string]any
	json.Unmarshal(b, &m)
	return m
}

func main() {
	client := anthropic.NewClient()
	schema := generateSchema(&ContactInfo{})

	message, _ := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 1024,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(
				"Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm.",
			)),
		},
		OutputConfig: anthropic.OutputConfigParam{
			Format: anthropic.JSONOutputFormatParam{
				Schema: schema,
			},
		},
	})

	for _, block := range message.Content {
		switch variant := block.AsAny().(type) {
		case anthropic.TextBlock:
			var contact ContactInfo
			json.Unmarshal([]byte(variant.Text), &contact)
			fmt.Printf("%s (%s)\n", contact.Name, contact.Email)
		}
	}
}
```

```java Java hidelines={1..7}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StructuredMessage;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.Model;

static class ContactInfo {
    public String name;
    public String email;
    public String planInterest;
    public boolean demoRequested;
}

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    StructuredMessageCreateParams<ContactInfo> createParams = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024)
        .outputConfig(ContactInfo.class)
        .addUserMessage("Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm.")
        .build();

    StructuredMessage<ContactInfo> response = client.messages().create(createParams);
    ContactInfo contact = response.content().stream()
        .flatMap(block -> block.text().stream())
        .findFirst().orElseThrow().text();
    IO.println(contact.name + " (" + contact.email + ")");
}
```

```php PHP hidelines={1..3}
<?php

use Anthropic\Client;
use Anthropic\Lib\Concerns\StructuredOutputModelTrait;
use Anthropic\Lib\Contracts\StructuredOutputModel;

$client = new Client();

class ContactInfo implements StructuredOutputModel
{
    use StructuredOutputModelTrait;

    public string $name;
    public string $email;
    public string $plan_interest;
    public bool $demo_requested;
}

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm.'],
    ],
    model: 'claude-opus-4-8',
    outputConfig: ['format' => ContactInfo::class],
);

$contact = $message->parsedOutput();
if ($contact instanceof ContactInfo) {
    echo "{$contact->name} ({$contact->email})\n";
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

class ContactInfo < Anthropic::BaseModel
  required :name, String
  required :email, String
  required :plan_interest, String
  required :demo_requested, Anthropic::Boolean
end

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [{
    role: "user",
    content: "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan and wants to schedule a demo for next Tuesday at 2pm."
  }],
  output_config: {format: ContactInfo}
)

contact = message.parsed_output
puts "#{contact.name} (#{contact.email})"
```

</CodeGroup>

#### SDK 特定方法 \{#sdk-specific-methods}

每个 SDK 都提供了辅助工具，使结构化输出的使用更加便捷。有关完整详情，请参阅各个 SDK 的页面。

<Tabs>
<Tab title="CLI">

**通过 heredoc 正文传递原始 JSON schema**

CLI 将原始 JSON schema 作为 YAML heredoc 正文传递。使用 GJSON 的 `@fromstr` 修饰符配合 `--transform` 来解析 `content[0].text` 中返回的 JSON 字符串并提取特定字段。

```bash
ant messages create \
  --transform 'content.0.text|@fromstr|{name,email}' \
  --format yaml <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
messages:
  - role: user
    content: >-
      Extract contact info: John Smith, john@example.com,
      interested in the Pro plan
output_config:
  format:
    type: json_schema
    schema:
      type: object
      properties:
        name: {type: string}
        email: {type: string}
        plan_interest: {type: string}
      required: [name, email, plan_interest]
      additionalProperties: false
YAML
```

```yaml Output
name: John Smith
email: john@example.com
```

</Tab>
<Tab title="Python">

**`client.messages.parse()`（推荐）**

`parse()` 方法会自动转换您的 Pydantic 模型、验证响应，并返回一个 `parsed_output` 属性。

```python hidelines={2..4,9..12}
from pydantic import BaseModel
import anthropic


class ContactInfo(BaseModel):
    name: str
    email: str
    plan_interest: str


client = anthropic.Anthropic()

response = client.messages.parse(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": "Extract contact info: John Smith, john@example.com, interested in the Pro plan",
        }
    ],
    output_format=ContactInfo,
)

# 直接访问解析后的输出
contact = response.parsed_output
print(contact.name, contact.email)
```

**`transform_schema()` 辅助函数**

适用于需要在发送前手动转换 schema，或希望修改 Pydantic 生成的 schema 的情况。与自动转换所提供 schema 的 `client.messages.parse()` 不同，此方法会返回转换后的 schema，以便您进一步自定义。

```python nocheck
from anthropic import transform_schema
from pydantic import TypeAdapter

# 首先将 Pydantic 模型转换为 JSON schema，然后进行转换
schema = TypeAdapter(ContactInfo).json_schema()
schema = transform_schema(schema)
# 根据需要修改 schema
schema["properties"]["custom_field"] = {"type": "string"}

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[{"role": "user", "content": "..."}],
    output_config={
        "format": {"type": "json_schema", "schema": schema},
    },
)
```

</Tab>
<Tab title="TypeScript">

**`client.messages.parse()` 配合 `zodOutputFormat()`**

`parse()` 方法接受 Zod schema，验证响应，并返回一个 `parsed_output` 属性，其推断的 TypeScript 类型与 schema 匹配。

```typescript hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const ContactInfo = z.object({
  name: z.string(),
  email: z.string(),
  planInterest: z.string()
});

const client = new Anthropic();

const response = await client.messages.parse({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: "Extract contact info: John Smith, john@example.com, interested in the Pro plan"
    }
  ],
  output_config: { format: zodOutputFormat(ContactInfo) }
});

// 保证类型安全
console.log(response.parsed_output!.email);
```

**`client.messages.parse()` 配合 `jsonSchemaOutputFormat()`**

`jsonSchemaOutputFormat()` 辅助函数接受一个 JSON Schema 对象，并将其与 `parse()` 集成，无需依赖 Zod。Zod 是一个可选的对等依赖项，需要单独安装；而 `jsonSchemaOutputFormat()` 开箱即用，因为 SDK 直接捆绑了 `json-schema-to-ts`。

对于**内联 schema 字面量**（在源代码中使用 `as const` 声明），您还可以获得编译时类型推断：`parsed_output` 的类型会与 schema 结构匹配。对于**导入或生成的 schema**（来自 JSON 文件或 OpenAPI 代码生成），该辅助函数仍会发送 schema 并解析响应，但推断的类型为 `unknown`，因为 `as const` 只能应用于字面量表达式。

```typescript hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";

const client = new Anthropic();

const response = await client.messages.parse({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: "Extract contact info: John Smith, john@example.com, interested in the Pro plan"
    }
  ],
  output_config: {
    format: jsonSchemaOutputFormat({
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        planInterest: { type: "string" }
      },
      required: ["name", "email", "planInterest"],
      additionalProperties: false
    } as const)
  }
});

// response.parsed_output 的类型为 { name: string; email: string; planInterest: string } | null
console.log(response.parsed_output!.email);
```

**类型推断需要 `as const`。** 使用带有 `const` 断言的字面量对象表达式，以便 TypeScript 可以收窄属性类型。如果没有 `as const`，推断的类型会退化为 `unknown`。

**Schema 转换。** 默认情况下，该辅助函数会以与 `zodOutputFormat()` 相同的方式转换 schema：移除不支持的约束、向对象添加 `additionalProperties: false`，以及过滤字符串格式。传递 `jsonSchemaOutputFormat(schema, { transform: false })` 可将您的 schema 原样发送到 API。请参阅 [SDK 转换的工作原理](#how-sdk-transformation-works)。

</Tab>
<Tab title="C#">

**通过 `OutputConfig` 传递 JSON schema**

C# SDK 接受使用 `JsonSerializer.SerializeToElement` 以编程方式构建的原始 JSON schema（如此处所示），或通过泛型 `Create<T>()` 重载从普通 C# 类派生 schema。使用 `JsonSerializer.Deserialize` 反序列化响应 JSON。

```csharp
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

var client = new AnthropicClient();

var response = await client.Messages.Create(new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Messages = [new() {
        Role = Role.User,
        Content = "Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan."
    }],
    OutputConfig = new OutputConfig
    {
        Format = new JsonOutputFormat
        {
            Schema = new Dictionary<string, JsonElement>
            {
                ["type"] = JsonSerializer.SerializeToElement("object"),
                ["properties"] = JsonSerializer.SerializeToElement(new
                {
                    name = new { type = "string" },
                    email = new { type = "string" },
                    plan_interest = new { type = "string" },
                }),
                ["required"] = JsonSerializer.SerializeToElement(
                    new[] { "name", "email", "plan_interest" }),
                ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
            },
        },
    },
});

if (response.Content[0].TryPickText(out var textBlock))
{
    // JSON 保证符合该 schema
    var contact = JsonSerializer.Deserialize<Dictionary<string, object>>(textBlock.Text)!;
    Console.WriteLine($"{contact["name"]} ({contact["email"]})");
}
```

</Tab>
<Tab title="Go">

**通过 `OutputConfigParam` 传递原始 JSON schema**

Go SDK 使用原始 JSON schema。定义一个带有 json 标签的 Go 结构体，生成 JSON schema（例如使用 `invopop/jsonschema`），然后将响应文本反序列化到您的结构体中。在 beta API 上，将结构体作为输出格式 schema 传递会自动将其反射为 JSON schema。

```go hidelines={1..2,4..7,26..28,-1}
package main

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/invopop/jsonschema"
)

type ContactInfo struct {
	Name         string `json:"name" jsonschema:"description=Full name"`
	Email        string `json:"email" jsonschema:"description=Email address"`
	PlanInterest string `json:"plan_interest" jsonschema:"description=Plan type"`
}

func generateSchema(v any) map[string]any {
	r := jsonschema.Reflector{AllowAdditionalProperties: false, DoNotReference: true}
	s := r.Reflect(v)
	b, _ := json.Marshal(s)
	var m map[string]any
	json.Unmarshal(b, &m)
	return m
}

func main() {
	client := anthropic.NewClient()
	schema := generateSchema(&ContactInfo{})

	message, _ := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 1024,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(
				"Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan.",
			)),
		},
		OutputConfig: anthropic.OutputConfigParam{
			Format: anthropic.JSONOutputFormatParam{
				Schema: schema,
			},
		},
	})

	for _, block := range message.Content {
		switch variant := block.AsAny().(type) {
		case anthropic.TextBlock:
			var contact ContactInfo
			json.Unmarshal([]byte(variant.Text), &contact)
			fmt.Printf("%s (%s)\n", contact.Name, contact.Email)
		}
	}
}
```

</Tab>
<Tab title="Java">

本页面的 Java 示例使用 [JDK 25 紧凑源文件](https://openjdk.org/jeps/512)语法；有关早期 JDK 的替代方案，请参阅 [Java SDK 要求](/docs/zh-CN/cli-sdks-libraries/sdks/java#requirements)。

**`outputConfig(Class<T>)` 方法**

将 Java 类传递给 `outputConfig()`，SDK 会自动派生 JSON schema、对其进行验证，并返回一个 `StructuredMessageCreateParams<T>`。通过 `response.content().stream().flatMap(block -> block.text().stream()).findFirst().orElseThrow().text()` 访问解析后的结果。

<Note>
请将您的 schema 类声明为顶级类或 `static` 嵌套类。此要求来自 Jackson Databind 库（`com.fasterxml.jackson.databind`），SDK 使用该库将 JSON 响应反序列化为您的类实例，而该库无法实例化非静态内部类。
</Note>

```java hidelines={1..7}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StructuredMessage;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.Model;

static class ContactInfo {
    public String name;
    public String email;
    public String planInterest;
}

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    StructuredMessageCreateParams<ContactInfo> createParams = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024)
        .outputConfig(ContactInfo.class)
        .addUserMessage("Extract contact info: John Smith, john@example.com, interested in the Pro plan")
        .build();

    StructuredMessage<ContactInfo> response = client.messages().create(createParams);
    ContactInfo contact = response.content().stream()
        .flatMap(block -> block.text().stream())
        .findFirst().orElseThrow().text();
    IO.println(contact.name + " (" + contact.email + ")");
}
```

<section title="泛型类型擦除">

Java 在类的元数据中保留字段的泛型类型信息，但在其他作用域中会发生泛型类型擦除。虽然可以从类型为 `List<Book>` 的 `BookList.books` 字段派生 JSON schema，但无法从相同类型的局部变量派生有效的 JSON schema。

如果在将 JSON 响应转换为 Java 类实例时发生错误，错误消息会包含 JSON 响应以协助诊断。如果您的 JSON 响应可能包含敏感信息，请避免直接记录日志，或确保从错误消息中删除任何敏感详情。

</section>

<section title="本地 schema 验证">

结构化输出支持 [JSON Schema 语言的一个子集](/docs/zh-CN/build-with-claude/structured-outputs#json-schema-limitations)。SDK 会自动从类生成 schema 以符合此子集。`outputConfig(Class<T>)` 方法会对从指定类派生的 schema 执行验证检查。

要点：

- **本地验证**在不向远程 AI 模型发送请求的情况下进行。
- **远程验证**也会在 AI 模型收到 JSON schema 后执行。
- **版本兼容性：** 如果 SDK 版本过旧，本地验证可能失败而远程验证成功。
- **禁用本地验证：** 如果遇到兼容性问题，请传递 `JsonSchemaLocalValidation.NO`：

```java hidelines={2..4}
import com.anthropic.core.JsonSchemaLocalValidation;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.Model;

static class BookList {
    public List<String> books;
}

void main() {
    StructuredMessageCreateParams<BookList> createParams = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(2048)
        .outputConfig(BookList.class, JsonSchemaLocalValidation.NO)
        .addUserMessage("List some famous late twentieth century novels.")
        .build();
}
```

</section>

<section title="流式传输">

结构化输出也支持流式传输。由于响应以流事件的形式到达，您需要在反序列化 JSON 之前累积完整的响应。

使用 `MessageAccumulator` 从流中收集 JSON 字符串。累积完成后，调用 `MessageAccumulator.message(Class<T>)` 将累积的 `Message` 转换为 `StructuredMessage`，后者会自动将 JSON 反序列化为您的 Java 类。

</section>

<section title="JSON schema 属性">

当 SDK 从您的 Java 类派生 JSON schema 时，默认情况下会包含所有由 `public` 字段或 `public` getter 方法表示的属性，并排除非 `public` 的字段和 getter 方法。

您可以使用注解控制可见性：

- `@JsonIgnore` 排除 `public` 字段或 getter 方法
- `@JsonProperty` 包含非 `public` 字段或 getter 方法

如果您定义了带有 `public` getter 方法的 `private` 字段，SDK 会从 getter 派生属性名称（例如，`private` 字段 `myValue` 配合 `public` 方法 `getMyValue()` 会生成 `"myValue"` 属性）。如需使用非常规的 getter 名称，请使用 `@JsonProperty` 注解该方法。

每个类必须为 JSON schema 定义至少一个属性。如果没有字段或 getter 方法可以生成 schema 属性，则会发生验证错误，例如以下情况：

- 类中没有字段或 getter 方法
- 所有 `public` 成员都使用 `@JsonIgnore` 注解
- 所有非 `public` 成员都缺少 `@JsonProperty` 注解
- 字段使用 `Map` 类型，这会生成空的 `"properties"` 字段

</section>

<section title="组合与继承">

在定义 JSON schema 时，您的 Java 类可以使用组合和继承来共享结构。每种模式对输出结构的影响不同。

**组合**会产生嵌套的 JSON 输出。从组合了 `A` 和 `B` 的类 `Composed` 派生 schema：

```java hidelines={1..7,20..35}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.StructuredMessage;
import com.anthropic.models.messages.StructuredMessageCreateParams;

static class A {
    public String a;
}

static class B {
    public String b;
}

static class Composed {
    public A composedA;
    public B composedB;
}

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();
    StructuredMessageCreateParams<Composed> params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024)
        .outputConfig(Composed.class)
        .addUserMessage("Populate field a with 'hello' and field b with 'world'.")
        .build();
    StructuredMessage<Composed> response = client.messages().create(params);
    Composed result = response.content().stream()
        .flatMap(block -> block.text().stream())
        .findFirst().orElseThrow().text();
    IO.println("composedA.a=" + result.composedA.a);
    IO.println("composedB.b=" + result.composedB.b);
}
```

JSON 输出具有以下嵌套结构：

```json
{
  "composedA": { "a": "hello" },
  "composedB": { "b": "world" }
}
```

**继承**会产生扁平的 JSON 输出。从继承 `Base` 的类 `Derived` 派生 schema：

```java hidelines={1..7,15..30}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.StructuredMessage;
import com.anthropic.models.messages.StructuredMessageCreateParams;

static class Base {
    public String a;
}

static class Derived extends Base {
    public String b;
}

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();
    StructuredMessageCreateParams<Derived> params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024)
        .outputConfig(Derived.class)
        .addUserMessage("Populate field a with 'hello' and field b with 'world'.")
        .build();
    StructuredMessage<Derived> response = client.messages().create(params);
    Derived result = response.content().stream()
        .flatMap(block -> block.text().stream())
        .findFirst().orElseThrow().text();
    IO.println("a=" + result.a);
    IO.println("b=" + result.b);
}
```

JSON 输出具有以下扁平结构：

```json
{
  "a": "hello",
  "b": "world"
}
```

</section>

<section title="注解（Jackson 和 Swagger）">

您可以使用 Jackson Databind 注解来丰富从 Java 类派生的 JSON schema：

```java hidelines={-2..}
import com.fasterxml.jackson.annotation.JsonClassDescription;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonPropertyDescription;

static class Person {

  @JsonPropertyDescription("The first name and surname of the person")
  public String name;

  public int birthYear;

  @JsonPropertyDescription("The year the person died, or 'present' if the person is living.")
  public String deathYear;
}

@JsonClassDescription("The details of one published book")
static class Book {

  public String title;
  public Person author;

  @JsonPropertyDescription("The year in which the book was first published.")
  public int publicationYear;

  @JsonIgnore
  public String genre;
}

static class BookList {
  public List<Book> books;
}

void main() {}
```

注解摘要：

- `@JsonClassDescription`：为类添加描述
- `@JsonPropertyDescription`：为字段或 getter 方法添加描述
- `@JsonIgnore`：从 schema 中排除 `public` 字段或 getter
- `@JsonProperty`：在 schema 中包含非 `public` 字段或 getter

如果您使用 `@JsonProperty(required = false)`，SDK 会忽略 `false` 值。从类派生的 schema 始终将所有属性标记为必填。

您还可以使用 Swagger Core（OpenAPI 3）的 `@Schema` 和 `@ArraySchema` 注解来添加特定类型的约束：

```java hidelines={-2..}
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;

static class Article {

  @ArraySchema(minItems = 1)
  public List<String> authors;

  public String title;

  @Schema(format = "date")
  public String publicationDate;

  public int pageCount;
}

void main() {}
```

本地验证会检查您是否使用了任何不支持的约束关键字，但不会在本地验证约束值。例如，不支持的 `"format"` 值可能通过本地验证，但会导致远程错误。

如果您同时使用 Jackson 和 Swagger 注解来设置同一个 schema 字段，Jackson 注解优先。

</section>

<section title="不使用 Java 类定义 schema">

基于类的 schema 派生是最便捷的方式，但如果需要直接控制 schema 结构，您可以手动构建 `JsonOutputFormat.Schema` 并将其包装在 `OutputConfig` 中。

```java hidelines={1..2,5..6}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.JsonOutputFormat;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.OutputConfig;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    JsonOutputFormat.Schema schema = JsonOutputFormat.Schema.builder()
        .putAdditionalProperty("type", JsonValue.from("object"))
        .putAdditionalProperty("properties", JsonValue.from(Map.of(
            "name", Map.of("type", "string"),
            "email", Map.of("type", "string"),
            "plan_interest", Map.of("type", "string"))))
        .putAdditionalProperty("required", JsonValue.from(
            List.of("name", "email", "plan_interest")))
        .putAdditionalProperty("additionalProperties", JsonValue.from(false))
        .build();

    OutputConfig outputConfig = OutputConfig.builder()
        .format(JsonOutputFormat.builder().schema(schema).build())
        .build();

    MessageCreateParams createParams = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024)
        .outputConfig(outputConfig)
        .addUserMessage(
            "John Smith (john@example.com) is interested in our Enterprise plan.")
        .build();

    client.messages().create(createParams).content().stream()
        .flatMap(contentBlock -> contentBlock.text().stream())
        .forEach(textBlock -> IO.println(textBlock.text()));
}
```

有关构建带有数组和描述的嵌套 schema 的更详细示例，请参阅 SDK 仓库中的 [`StructuredOutputsRawExample.java`](https://github.com/anthropics/anthropic-sdk-java/blob/main/anthropic-java-example/src/main/java/com/anthropic/example/StructuredOutputsRawExample.java)。

</section>

</Tab>
<Tab title="PHP">

**通过 `StructuredOutputModel` 接口使用类**

定义一个实现 `StructuredOutputModel`（使用 `StructuredOutputModelTrait`）的 PHP 类，并将类名传递给 `outputConfig: ['format' => MyClass::class]`。SDK 会从您的原生 PHP 8 属性类型派生 JSON schema，并通过 `$message->parsedOutput()` 返回类型化的实例。

`parsedOutput()` 在成功时返回您的模型实例，在解析失败时返回 `null`（或错误数组）。在访问字段之前，请使用 `instanceof` 收窄类型。

```php hidelines={1..3}
<?php

use Anthropic\Client;
use Anthropic\Lib\Concerns\StructuredOutputModelTrait;
use Anthropic\Lib\Contracts\StructuredOutputModel;

$client = new Client();

class ContactInfo implements StructuredOutputModel
{
    use StructuredOutputModelTrait;

    public string $name;
    public string $email;
    public string $plan_interest;
}

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan.'],
    ],
    model: 'claude-opus-4-8',
    outputConfig: ['format' => ContactInfo::class],
);

$contact = $message->parsedOutput();
if ($contact instanceof ContactInfo) {
    echo "{$contact->name} ({$contact->email})\n";
}
```

<section title="类型推断">

SDK 将原生 PHP 8 属性类型映射到 JSON Schema：

| PHP 类型 | JSON Schema |
|---|---|
| `string` | `"string"` |
| `int` | `"integer"` |
| `float` | `"number"` |
| `bool` | `"boolean"` |
| `array` | `"array"`（参见以下说明） |
| `?type`（可空） | 可选字段 |
| 实现 `StructuredOutputModel` 的类 | 嵌套对象 |

对于 `array` 属性，仅当元素类型是嵌套的 `StructuredOutputModel`（通过 `#[Constrained(itemClass: MyModel::class)]` 或 `/** @var MyModel[] */` 文档块声明）时，SDK 才会添加 `items` schema。标量数组（`string[]`、`int[]`）会生成无约束的 `{"type":"array"}`。

所有不可空的属性都会成为必填字段。

</section>

<section title="使用 #[Constrained] 属性添加约束">

使用 `#[Constrained]` 属性添加约束：

```php hidelines={..2} highlight={3}
<?php

use Anthropic\Lib\Attributes\Constrained;
use Anthropic\Lib\Concerns\StructuredOutputModelTrait;
use Anthropic\Lib\Contracts\StructuredOutputModel;

class Address implements StructuredOutputModel { use StructuredOutputModelTrait; public string $street; }

class Profile implements StructuredOutputModel
{
    use StructuredOutputModelTrait;

    #[Constrained(description: 'Age in years', minimum: 0, maximum: 150)]
    public int $age;

    #[Constrained(format: 'email')]
    public string $email;

    #[Constrained(itemClass: Address::class, minItems: 1)]
    public array $addresses;
}
```

**API 强制执行的约束**（在 schema 中发送）：`description`、`format`、`const`、`itemClass`、`minItems`（仅限 0 或 1）。

**SDK 验证的约束**（从传输的 schema 中剥离，附加到描述中，并针对响应进行验证）：`minimum`、`maximum`、`multipleOf`、`minLength`、`maxLength`。

</section>

<section title="原始 JSON schema 回退方案">

对于 PHP 类型提示无法表达的 schema，可通过 `OutputConfig::with()` 传递原始关联数组。此方式会跳过 `parsedOutput()` 辅助函数；请使用 `json_decode()` 解码响应：

```php hidelines={1..3}
<?php

use Anthropic\Client;
use Anthropic\Messages\OutputConfig;
use Anthropic\Messages\JSONOutputFormat;

$client = new Client();

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'Extract the key information from this email: John Smith (john@example.com) is interested in our Enterprise plan.'],
    ],
    model: 'claude-opus-4-8',
    outputConfig: OutputConfig::with(format: JSONOutputFormat::with(schema: [
        'type' => 'object',
        'properties' => [
            'name' => ['type' => 'string'],
            'email' => ['type' => 'string'],
            'plan_interest' => ['type' => 'string'],
        ],
        'required' => ['name', 'email', 'plan_interest'],
        'additionalProperties' => false,
    ])),
);

$contact = json_decode($message->content[0]->text, associative: true);
echo "{$contact['name']} ({$contact['email']})\n";
```

</section>

</Tab>
<Tab title="Ruby">

**`output_config: {format: Model}` 配合 `parsed_output`**

定义一个继承 `Anthropic::BaseModel` 的模型类，并将其作为 format 传递给 `messages.create()`。响应包含一个 `parsed_output` 属性，其中包含类型化的 Ruby 对象。

```ruby hidelines={1..2}
require "anthropic"

class ContactInfo < Anthropic::BaseModel
  required :name, String
  required :email, String
  required :plan_interest, String
end

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: "Extract contact info: John Smith, john@example.com, interested in the Pro plan"
    }
  ],
  output_config: {format: ContactInfo}
)

contact = message.parsed_output
puts "#{contact.name} (#{contact.email})"
```

<section title="高级模型功能">

Ruby SDK 支持额外的模型定义功能，以实现更丰富的 schema：

- **`doc:` 关键字：** 为字段添加描述，以生成信息更丰富的 schema 输出
- **`Anthropic::ArrayOf[T]`：** 类型化数组。将数组级约束（`min_items:`、`max_items:`）作为关键字传递给 `required`/`optional`，而不是传递给 `ArrayOf` 本身
- **`Anthropic::EnumOf[:a, :b]`：** 具有约束值的枚举字段
- **`Anthropic::UnionOf[T1, T2]`：** 映射到 `anyOf` 的联合类型

```ruby
class FamousNumber < Anthropic::BaseModel
  required :value, Float
  optional :reason, String, doc: "why is this number mathematically significant?"
end

class Output < Anthropic::BaseModel
  required :numbers, Anthropic::ArrayOf[FamousNumber], min_items: 3, max_items: 5
end

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [{role: "user", content: "give me some famous numbers"}],
  output_config: {format: Output}
)

message.parsed_output
# => #<Output numbers=[#<FamousNumber value=3.14159... reason="Pi is...">...]>
```

</section>

</Tab>
</Tabs>

#### SDK 转换的工作原理 \{#how-sdk-transformation-works}

Python、TypeScript、Ruby 和 PHP SDK 会自动转换包含不支持功能的 schema。当 schema 从原生类型派生时（C# 中的 `Create<T>()`；Go beta API 上的结构体反射或 `BetaJSONSchemaOutputFormat()`），C# 和 Go SDK 也会应用相同的转换。转换步骤如下：

1. **移除不支持的约束**（例如 `minimum`、`maximum`、`minLength`、`maxLength`）
2. **使用约束信息更新描述**（例如"必须至少为 100"），当结构化输出不直接支持该约束时
3. **为所有对象添加 `additionalProperties: false`**
4. **将字符串格式过滤**为仅支持的列表
5. **根据您的原始 schema（包含所有约束）验证响应**

这意味着 Claude 接收的是简化的 schema，但您的代码仍会通过验证强制执行所有约束。

**示例：** 带有 `minimum: 100` 的 Pydantic 字段在发送的 schema 中会变成普通整数，但 SDK 会将描述更新为"必须至少为 100"，并根据原始约束验证响应。

### 常见用例 \{#common-use-cases}

<section title="数据提取">

从非结构化文本中提取结构化数据：

<CodeGroup>

```bash CLI
ant messages create \
  --transform 'content.0.text|@fromstr' --format jsonl <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
messages:
  - role: user
    content: "Extract invoice data from: Invoice #12345, Date: 2024-01-15, Total: $500.00"
output_config:
  format:
    type: json_schema
    schema:
      type: object
      properties:
        invoice_number: {type: string}
        date: {type: string}
        total_amount: {type: number}
        line_items:
          type: array
          items: {type: object, additionalProperties: false}
        customer_name: {type: string}
      required: [invoice_number, date, total_amount, line_items, customer_name]
      additionalProperties: false
YAML
```

```python Python hidelines={1}
import anthropic
from pydantic import BaseModel


class Invoice(BaseModel):
    invoice_number: str
    date: str
    total_amount: float
    line_items: list[dict]
    customer_name: str


client = anthropic.Anthropic()
invoice_text = "Invoice #12345, Date: 2024-01-15, Total: $500.00"

response = client.messages.parse(
    model="claude-opus-4-8",
    max_tokens=4096,
    output_format=Invoice,
    messages=[
        {"role": "user", "content": f"Extract invoice data from: {invoice_text}"}
    ],
)

print(response.parsed_output)
```

```typescript TypeScript hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic();

const InvoiceSchema = z.object({
  invoice_number: z.string(),
  date: z.string(),
  total_amount: z.number(),
  line_items: z.array(z.record(z.string(), z.any())),
  customer_name: z.string()
});

const invoiceText = "Invoice #12345, Date: 2024-01-15, Total: $500.00";
const response = await client.messages.parse({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  output_config: { format: zodOutputFormat(InvoiceSchema) },
  messages: [{ role: "user", content: `Extract invoice data from: ${invoiceText}` }]
});
console.log(response.parsed_output);
```

```csharp C# hidelines={1..4}
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

string invoiceText = "Invoice #12345, Date: 2024-01-15, Total: $500.00";

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 4096,
    OutputConfig = new OutputConfig
    {
        Format = new JsonOutputFormat
        {
            Schema = new Dictionary<string, JsonElement>
            {
                ["type"] = JsonSerializer.SerializeToElement("object"),
                ["properties"] = JsonSerializer.SerializeToElement(new
                {
                    invoice_number = new { type = "string" },
                    date = new { type = "string" },
                    total_amount = new { type = "number" },
                    line_items = new
                    {
                        type = "array",
                        items = new
                        {
                            type = "object",
                            additionalProperties = false,
                        },
                    },
                    customer_name = new { type = "string" },
                }),
                ["required"] = JsonSerializer.SerializeToElement(new[] { "invoice_number", "date", "total_amount", "line_items", "customer_name" }),
                ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
            },
        },
    },
    Messages = [new() { Role = Role.User, Content = $"Extract invoice data from: {invoiceText}" }]
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

	invoiceText := "Invoice #12345, Date: 2024-01-15, Total: $500.00"

	schema := map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"invoice_number": map[string]any{"type": "string"},
			"date":           map[string]any{"type": "string"},
			"total_amount":   map[string]any{"type": "number"},
			"line_items": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"description": map[string]any{"type": "string"},
						"quantity":    map[string]any{"type": "number"},
						"unit_price":  map[string]any{"type": "number"},
					},
					"required": []string{"description", "quantity", "unit_price"},
				},
			},
			"customer_name": map[string]any{"type": "string"},
		},
		"required": []string{"invoice_number", "date", "total_amount", "line_items", "customer_name"},
	}

	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 4096,
		OutputConfig: anthropic.OutputConfigParam{
			Format: anthropic.JSONOutputFormatParam{
				Schema: schema,
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(fmt.Sprintf("Extract invoice data from: %s", invoiceText))),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	for _, block := range response.Content {
		switch variant := block.AsAny().(type) {
		case anthropic.TextBlock:
			fmt.Println(variant.Text)
		}
	}
}
```

```java Java hidelines={1..6}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StructuredMessage;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.Model;
import com.fasterxml.jackson.annotation.JsonProperty;

static class LineItem {
    @JsonProperty("description")
    public String description;

    @JsonProperty("quantity")
    public int quantity;

    @JsonProperty("unit_price")
    public double unitPrice;
}

static class Invoice {
    @JsonProperty("invoice_number")
    public String invoiceNumber;

    @JsonProperty("date")
    public String date;

    @JsonProperty("total_amount")
    public double totalAmount;

    @JsonProperty("line_items")
    public List<LineItem> lineItems;

    @JsonProperty("customer_name")
    public String customerName;
}

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    String invoiceText = "Invoice #12345, Date: 2024-01-15, Total: $500.00";

    StructuredMessageCreateParams<Invoice> params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(4096L)
        .outputConfig(Invoice.class)
        .addUserMessage("Extract invoice data from: " + invoiceText)
        .build();

    StructuredMessage<Invoice> response = client.messages().create(params);
    Invoice invoice = response.content().stream()
        .flatMap(block -> block.text().stream())
        .findFirst().orElseThrow().text();
    IO.println(invoice.invoiceNumber + ": $" + invoice.totalAmount);
}
```

```php PHP hidelines={1..3}
<?php

use Anthropic\Client;
use Anthropic\Lib\Concerns\StructuredOutputModelTrait;
use Anthropic\Lib\Contracts\StructuredOutputModel;

$client = new Client();

class Invoice implements StructuredOutputModel
{
    use StructuredOutputModelTrait;

    public string $invoice_number;
    public string $date;
    public float $total_amount;
    public array $line_items;
    public string $customer_name;
}

$invoiceText = "Invoice #12345, Date: 2024-01-15, Total: $500.00";

$message = $client->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => "Extract invoice data from: $invoiceText"]
    ],
    model: 'claude-opus-4-8',
    outputConfig: ['format' => Invoice::class],
);

$invoice = $message->parsedOutput();
if ($invoice instanceof Invoice) {
    echo "Invoice {$invoice->invoice_number}: \${$invoice->total_amount}\n";
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

class LineItem < Anthropic::BaseModel
  required :description, String
  required :amount, Float
end

class Invoice < Anthropic::BaseModel
  required :invoice_number, String
  required :date, String
  required :total_amount, Float
  required :line_items, Anthropic::ArrayOf[LineItem]
  required :customer_name, String
end

invoice_text = "Invoice #12345, Date: 2024-01-15, Total: $500.00"

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  output_config: {format: Invoice},
  messages: [
    {role: "user", content: "Extract invoice data from: #{invoice_text}"}
  ]
)

invoice = message.parsed_output
puts "Invoice #{invoice.invoice_number}: $#{invoice.total_amount}"
```

</CodeGroup>

</section>

<section title="分类">

使用结构化类别对内容进行分类：

<CodeGroup>

```bash CLI
ant messages create \
  --transform 'content.0.text|@fromstr' --format jsonl <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
messages:
  - role: user
    content: "Classify this feedback: Great product, fast shipping!"
output_config:
  format:
    type: json_schema
    schema:
      type: object
      properties:
        category:
          type: string
        confidence:
          type: number
        tags:
          type: array
          items:
            type: string
        sentiment:
          type: string
      required:
        - category
        - confidence
        - tags
        - sentiment
      additionalProperties: false
YAML
```

```python Python hidelines={1}
from anthropic import Anthropic
from pydantic import BaseModel

client = Anthropic()


class Classification(BaseModel):
    category: str
    confidence: float
    tags: list[str]
    sentiment: str


feedback_text = "Great product, but the delivery was slow."
response = client.messages.parse(
    model="claude-opus-4-8",
    max_tokens=1024,
    output_format=Classification,
    messages=[{"role": "user", "content": f"Classify this feedback: {feedback_text}"}],
)

print(response.parsed_output)
```

```typescript TypeScript hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic();

const ClassificationSchema = z.object({
  category: z.string(),
  confidence: z.number(),
  tags: z.array(z.string()),
  sentiment: z.string()
});

const feedbackText = "Great product, but the delivery was slow.";
const response = await client.messages.parse({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  output_config: { format: zodOutputFormat(ClassificationSchema) },
  messages: [{ role: "user", content: `Classify this feedback: ${feedbackText}` }]
});

console.log(response.parsed_output);
```

```csharp C# hidelines={1..6}
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

string feedbackText = "Great product, fast shipping!";

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Messages = [new() { Role = Role.User, Content = $"Classify this feedback: {feedbackText}" }],
    OutputConfig = new OutputConfig
    {
        Format = new JsonOutputFormat
        {
            Schema = new Dictionary<string, JsonElement>
            {
                ["type"] = JsonSerializer.SerializeToElement("object"),
                ["properties"] = JsonSerializer.SerializeToElement(new
                {
                    category = new { type = "string" },
                    confidence = new { type = "number" },
                    tags = new { type = "array", items = new { type = "string" } },
                    sentiment = new { type = "string" },
                }),
                ["required"] = JsonSerializer.SerializeToElement(new[] { "category", "confidence", "tags", "sentiment" }),
                ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
            },
        },
    },
};

var message = await client.Messages.Create(parameters);
Console.WriteLine(message);
```

```go Go hidelines={1..14,-1}
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	feedbackText := "Great product, fast shipping!"

	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"category":   map[string]any{"type": "string"},
			"confidence": map[string]any{"type": "number"},
			"tags":       map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
			"sentiment":  map[string]any{"type": "string"},
		},
		"required":             []string{"category", "confidence", "tags", "sentiment"},
		"additionalProperties": false,
	}

	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 1024,
		OutputConfig: anthropic.OutputConfigParam{
			Format: anthropic.JSONOutputFormatParam{
				Schema: schema,
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(fmt.Sprintf("Classify this feedback: %s", feedbackText))),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	for _, block := range response.Content {
		switch variant := block.AsAny().(type) {
		case anthropic.TextBlock:
			var result map[string]any
			json.Unmarshal([]byte(variant.Text), &result)
			fmt.Println(result)
		}
	}
}
```

```java Java hidelines={1..6}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StructuredMessage;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.Model;
import com.fasterxml.jackson.annotation.JsonProperty;

static class Classification {
    @JsonProperty("category")
    public String category;

    @JsonProperty("confidence")
    public double confidence;

    @JsonProperty("tags")
    public List<String> tags;

    @JsonProperty("sentiment")
    public String sentiment;
}

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    String feedbackText = "Great product, fast shipping!";

    StructuredMessageCreateParams<Classification> params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024L)
        .outputConfig(Classification.class)
        .addUserMessage("Classify this feedback: " + feedbackText)
        .build();

    StructuredMessage<Classification> response = client.messages().create(params);
    Classification result = response.content().stream()
        .flatMap(block -> block.text().stream())
        .findFirst().orElseThrow().text();
    IO.println(result.category + " (" + result.confidence + ")");
}
```

```php PHP hidelines={1..3}
<?php

use Anthropic\Client;
use Anthropic\Lib\Concerns\StructuredOutputModelTrait;
use Anthropic\Lib\Contracts\StructuredOutputModel;

$client = new Client();

class Classification implements StructuredOutputModel
{
    use StructuredOutputModelTrait;

    public string $category;
    public float $confidence;
    public array $tags;
    public string $sentiment;
}

$feedbackText = "Great product, fast shipping!";

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => "Classify this feedback: {$feedbackText}"]
    ],
    model: 'claude-opus-4-8',
    outputConfig: ['format' => Classification::class],
);

$result = $message->parsedOutput();
if ($result instanceof Classification) {
    echo "{$result->category} ({$result->confidence}): {$result->sentiment}\n";
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

class Classification < Anthropic::BaseModel
  required :category, String
  required :confidence, Float
  required :tags, Anthropic::ArrayOf[String]
  required :sentiment, String
end

feedback_text = "Great product, fast shipping!"

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  output_config: {format: Classification},
  messages: [
    {role: "user", content: "Classify this feedback: #{feedback_text}"}
  ]
)
puts message.parsed_output
```

</CodeGroup>

</section>

<section title="API 响应格式化">

生成可直接用于 API 的响应：

<CodeGroup>

```bash CLI
ant messages create \
  --transform 'content.0.text' --raw-output <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
output_config:
  format:
    type: json_schema
    schema:
      type: object
      properties:
        status:
          type: string
        data:
          type: object
          additionalProperties: false
        errors:
          type: array
          items:
            type: object
            additionalProperties: false
        metadata:
          type: object
          additionalProperties: false
      required:
        - status
        - data
        - metadata
      additionalProperties: false
messages:
  - role: user
    content: "Process this request: ..."
YAML
```

```python Python hidelines={1}
from anthropic import Anthropic
from pydantic import BaseModel

client = Anthropic()


class APIResponse(BaseModel):
    status: str
    data: dict
    errors: list[dict] | None
    metadata: dict


response = client.messages.parse(
    model="claude-opus-4-8",
    max_tokens=1024,
    output_format=APIResponse,
    messages=[{"role": "user", "content": "Process this request: ..."}],
)

print(response.parsed_output)
```

```typescript TypeScript hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic();

const APIResponseSchema = z.object({
  status: z.string(),
  data: z.record(z.string(), z.any()),
  errors: z.array(z.record(z.string(), z.any())).optional(),
  metadata: z.record(z.string(), z.any())
});

const response = await client.messages.parse({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  output_config: { format: zodOutputFormat(APIResponseSchema) },
  messages: [{ role: "user", content: "Process this request..." }]
});

console.log(response.parsed_output);
```

```csharp C# hidelines={1..6}
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Messages = [new() { Role = Role.User, Content = "Process this request: ..." }],
    OutputConfig = new OutputConfig
    {
        Format = new JsonOutputFormat
        {
            Schema = new Dictionary<string, JsonElement>
            {
                ["type"] = JsonSerializer.SerializeToElement("object"),
                ["properties"] = JsonSerializer.SerializeToElement(new
                {
                    status = new { type = "string" },
                    data = new { type = "object", additionalProperties = false },
                    errors = new
                    {
                        type = "array",
                        items = new { type = "object", additionalProperties = false },
                    },
                    metadata = new { type = "object", additionalProperties = false },
                }),
                ["required"] = JsonSerializer.SerializeToElement(new[] { "status", "data", "metadata" }),
                ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
            },
        },
    },
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
		OutputConfig: anthropic.OutputConfigParam{
			Format: anthropic.JSONOutputFormatParam{
				Schema: map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"status": map[string]any{
							"type": "string",
						},
						"data": map[string]any{
							"type":                 "object",
							"additionalProperties": false,
						},
						"errors": map[string]any{
							"type": "array",
							"items": map[string]any{
								"type":                 "object",
								"additionalProperties": false,
							},
						},
						"metadata": map[string]any{
							"type":                 "object",
							"additionalProperties": false,
						},
					},
					"required": []string{"status", "data", "metadata"},
				},
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Process this request: ...")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	for _, block := range response.Content {
		switch variant := block.AsAny().(type) {
		case anthropic.TextBlock:
			fmt.Println(variant.Text)
		}
	}
}
```

```java Java hidelines={1..6}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.StructuredMessage;
import com.anthropic.models.messages.StructuredMessageCreateParams;
import com.anthropic.models.messages.Model;
import com.fasterxml.jackson.annotation.JsonProperty;

static class APIData {
    @JsonProperty("message")
    public String message;

    @JsonProperty("resource_id")
    public String resourceId;
}

static class APIError {
    @JsonProperty("code")
    public String code;

    @JsonProperty("message")
    public String message;
}

static class APIMetadata {
    @JsonProperty("request_id")
    public String requestId;

    @JsonProperty("timestamp")
    public String timestamp;
}

static class APIResponse {
    @JsonProperty("status")
    public String status;

    @JsonProperty("data")
    public APIData data;

    @JsonProperty("errors")
    public List<APIError> errors;

    @JsonProperty("metadata")
    public APIMetadata metadata;
}

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    StructuredMessageCreateParams<APIResponse> params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024L)
        .outputConfig(APIResponse.class)
        .addUserMessage("Process this request: ...")
        .build();

    StructuredMessage<APIResponse> response = client.messages().create(params);
    APIResponse result = response.content().stream()
        .flatMap(block -> block.text().stream())
        .findFirst().orElseThrow().text();
    IO.println(result.status);
}
```

```php PHP hidelines={1..3}
<?php

use Anthropic\Client;
use Anthropic\Lib\Attributes\Constrained;
use Anthropic\Lib\Concerns\StructuredOutputModelTrait;
use Anthropic\Lib\Contracts\StructuredOutputModel;

$client = new Client();

class Payload implements StructuredOutputModel { use StructuredOutputModelTrait; public string $message; }

class APIError implements StructuredOutputModel { use StructuredOutputModelTrait; public string $code; public string $detail; }

class Metadata implements StructuredOutputModel { use StructuredOutputModelTrait; public string $request_id; }

class APIResponse implements StructuredOutputModel
{
    use StructuredOutputModelTrait;

    public string $status;
    public Payload $data;
    #[Constrained(itemClass: APIError::class)]
    public ?array $errors;
    public Metadata $metadata;
}

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'Process this request: ...']
    ],
    model: 'claude-opus-4-8',
    outputConfig: ['format' => APIResponse::class],
);

$result = $message->parsedOutput();
if ($result instanceof APIResponse) {
    echo "{$result->status}: {$result->data->message}\n";
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

class Payload < Anthropic::BaseModel
  required :message, String
end

class APIError < Anthropic::BaseModel
  required :code, String
  required :detail, String
end

class Metadata < Anthropic::BaseModel
  required :request_id, String
end

class APIResponse < Anthropic::BaseModel
  required :status, String
  required :data, Payload
  optional :errors, Anthropic::ArrayOf[APIError]
  required :metadata, Metadata
end

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  output_config: {format: APIResponse},
  messages: [
    {role: "user", content: "Process this request: ..."}
  ]
)
puts message.parsed_output
```

</CodeGroup>

</section>

## 严格工具使用 \{#strict-tool-use}

有关通过语法约束采样对工具输入强制执行 JSON Schema 合规性的内容，请参阅[严格工具使用](/docs/zh-CN/agents-and-tools/tool-use/strict-tool-use)。

## 同时使用两个功能 \{#using-both-features-together}

JSON 输出和严格工具使用解决不同的问题，并且可以协同工作：

- **JSON 输出**控制 Claude 的响应格式（Claude 说什么）
- **严格工具使用**验证工具参数（Claude 如何调用您的函数）

组合使用时，Claude 可以使用保证有效的参数调用工具，并返回结构化的 JSON 响应。这对于既需要可靠的工具调用又需要结构化最终输出的智能体工作流非常有用。

<CodeGroup>

```bash CLI nocheck
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
messages:
  - role: user
    content: Help me plan a trip to Paris departing May 15, 2026
# JSON 输出：结构化响应格式
output_config:
  format:
    type: json_schema
    schema:
      type: object
      properties:
        summary:
          type: string
        next_steps:
          type: array
          items:
            type: string
      required: [summary, next_steps]
      additionalProperties: false
# 严格工具使用：保证工具参数符合规范
tools:
  - name: search_flights
    strict: true
    input_schema:
      type: object
      properties:
        destination:
          type: string
        date:
          type: string
          format: date
      required: [destination, date]
      additionalProperties: false
YAML
```

```python Python hidelines={1..4}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": "Help me plan a trip to Paris departing May 15, 2026",
        }
    ],
    # JSON 输出：结构化响应格式
    output_config={
        "format": {
            "type": "json_schema",
            "schema": {
                "type": "object",
                "properties": {
                    "summary": {"type": "string"},
                    "next_steps": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["summary", "next_steps"],
                "additionalProperties": False,
            },
        }
    },
    # 严格工具使用：保证工具参数符合规范
    tools=[
        {
            "name": "search_flights",
            "strict": True,
            "input_schema": {
                "type": "object",
                "properties": {
                    "destination": {"type": "string"},
                    "date": {"type": "string", "format": "date"},
                },
                "required": ["destination", "date"],
                "additionalProperties": False,
            },
        }
    ],
)

print(response)
```

```typescript TypeScript hidelines={1..4}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Help me plan a trip to Paris departing May 15, 2026" }],
  // JSON 输出：结构化响应格式
  output_config: {
    format: {
      type: "json_schema",
      schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          next_steps: { type: "array", items: { type: "string" } }
        },
        required: ["summary", "next_steps"],
        additionalProperties: false
      }
    }
  },
  // 严格工具使用：保证工具参数
  tools: [
    {
      name: "search_flights",
      description: "Search for available flights to a destination on a specific date",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          destination: { type: "string" },
          date: { type: "string", format: "date" }
        },
        required: ["destination", "date"],
        additionalProperties: false
      }
    }
  ]
});

// Claude 可能先调用工具（tool_use），或直接以 JSON 响应（text）
console.log("Stop reason:", response.stop_reason);
for (const block of response.content) {
  if (block.type === "tool_use") {
    console.log(`Tool call: ${block.name}(${JSON.stringify(block.input)})`);
  } else if (block.type === "text") {
    console.log("Response:", block.text);
  }
}
```

```csharp C# hidelines={1..6}
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Messages = [new() { Role = Role.User, Content = "Help me plan a trip to Paris departing May 15, 2026" }],
    // JSON 输出：结构化响应格式
    OutputConfig = new OutputConfig
    {
        Format = new JsonOutputFormat
        {
            Schema = new Dictionary<string, JsonElement>
            {
                ["type"] = JsonSerializer.SerializeToElement("object"),
                ["properties"] = JsonSerializer.SerializeToElement(new
                {
                    summary = new { type = "string" },
                    next_steps = new { type = "array", items = new { type = "string" } },
                }),
                ["required"] = JsonSerializer.SerializeToElement(new[] { "summary", "next_steps" }),
                ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
            },
        },
    },
    // 严格工具使用：保证工具参数符合规范
    Tools =
    [
        new Tool
        {
            Name = "search_flights",
            Strict = true,
            InputSchema = new InputSchema(new Dictionary<string, JsonElement>
            {
                ["properties"] = JsonSerializer.SerializeToElement(new Dictionary<string, object>
                {
                    ["destination"] = new { type = "string" },
                    ["date"] = new { type = "string", format = "date" },
                }),
                ["required"] = JsonSerializer.SerializeToElement(new[] { "destination", "date" }),
                ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
            }),
        }
    ],
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
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Help me plan a trip to Paris departing May 15, 2026")),
		},
		// JSON 输出：结构化响应格式
		OutputConfig: anthropic.OutputConfigParam{
			Format: anthropic.JSONOutputFormatParam{
				Schema: map[string]any{
					"type":                 "object",
					"additionalProperties": false,
					"properties": map[string]any{
						"summary":    map[string]any{"type": "string"},
						"next_steps": map[string]any{"type": "array", "items": map[string]any{"type": "string"}},
					},
					"required": []string{"summary", "next_steps"},
				},
			},
		},
		// 严格工具使用：保证工具参数
		Tools: []anthropic.ToolUnionParam{
			{OfTool: &anthropic.ToolParam{
				Name:   "search_flights",
				Strict: anthropic.Bool(true),
				InputSchema: anthropic.ToolInputSchemaParam{
					Properties: map[string]any{
						"destination": map[string]any{"type": "string"},
						"date":        map[string]any{"type": "string", "format": "date"},
					},
					Required: []string{"destination", "date"},
					ExtraFields: map[string]any{
						"additionalProperties": false,
					},
				}}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response.Content)
}
```

```java Java hidelines={1..12,53}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.JsonOutputFormat;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.OutputConfig;
import com.anthropic.models.messages.Tool;
import com.anthropic.models.messages.Tool.InputSchema;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // JSON 输出：结构化响应格式
    JsonOutputFormat.Schema outputSchema = JsonOutputFormat.Schema.builder()
        .putAdditionalProperty("type", JsonValue.from("object"))
        .putAdditionalProperty("properties", JsonValue.from(Map.of(
            "summary", Map.of("type", "string"),
            "next_steps", Map.of("type", "array", "items", Map.of("type", "string"))
        )))
        .putAdditionalProperty("required", JsonValue.from(List.of("summary", "next_steps")))
        .putAdditionalProperty("additionalProperties", JsonValue.from(false))
        .build();

    // 严格工具使用：保证工具参数符合规范
    InputSchema toolSchema = InputSchema.builder()
        .properties(JsonValue.from(Map.of(
            "destination", Map.of("type", "string"),
            "date", Map.of("type", "string", "format", "date")
        )))
        .putAdditionalProperty("required", JsonValue.from(List.of("destination", "date")))
        .putAdditionalProperty("additionalProperties", JsonValue.from(false))
        .build();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024L)
        .addUserMessage("Help me plan a trip to Paris departing May 15, 2026")
        .outputConfig(OutputConfig.builder()
            .format(JsonOutputFormat.builder().schema(outputSchema).build())
            .build())
        .addTool(Tool.builder()
            .name("search_flights")
            .description("Search for available flights to a destination on a specific date")
            .strict(true)
            .inputSchema(toolSchema)
            .build())
        .build();

    Message response = client.messages().create(params);
    IO.println(response);
}
```

```php PHP hidelines={1..3}
<?php

use Anthropic\Client;
use Anthropic\Lib\Concerns\StructuredOutputModelTrait;
use Anthropic\Lib\Contracts\StructuredOutputModel;
use Anthropic\Messages\ToolUseBlock;

$client = new Client();

class TripPlan implements StructuredOutputModel
{
    use StructuredOutputModelTrait;

    public string $summary;
    public array $next_steps;
}

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'Help me plan a trip to Paris departing May 15, 2026']
    ],
    model: 'claude-opus-4-8',
    // JSON 输出：结构化响应格式
    outputConfig: ['format' => TripPlan::class],
    // 严格工具使用：保证工具参数
    tools: [
        [
            'name' => 'search_flights',
            'strict' => true,
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'destination' => ['type' => 'string'],
                    'date' => ['type' => 'string', 'format' => 'date']
                ],
                'required' => ['destination', 'date'],
                'additionalProperties' => false
            ]
        ]
    ],
);

// Claude 可能先调用工具（tool_use），或直接以 JSON 响应（text）
$plan = $message->parsedOutput();
if ($plan instanceof TripPlan) {
    echo $plan->summary, "\n";
} elseif ($toolUse = array_find($message->content, fn($block) => $block instanceof ToolUseBlock)) {
    echo "Tool call: {$toolUse->name}(", json_encode($toolUse->input), ")\n";
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {role: "user", content: "Help me plan a trip to Paris departing May 15, 2026"}
  ],
  # JSON 输出：结构化响应格式
  output_config: {
    format: {
      type: :json_schema,
      schema: {
        type: "object",
        properties: {
          summary: {type: "string"},
          next_steps: {type: "array", items: {type: "string"}}
        },
        required: ["summary", "next_steps"],
        additionalProperties: false
      }
    }
  },
  # 严格工具使用：保证工具参数
  tools: [
    {
      name: "search_flights",
      strict: true,
      input_schema: {
        type: "object",
        properties: {
          destination: {type: "string"},
          date: {type: "string", format: "date"}
        },
        required: ["destination", "date"],
        additionalProperties: false
      }
    }
  ]
)
puts message
```

</CodeGroup>

## 重要注意事项 \{#important-considerations}

### 语法编译与缓存 \{#grammar-compilation-and-caching}

结构化输出使用带有编译语法工件的约束采样。这引入了一些需要注意的性能特征：

- **首次请求延迟：** 首次使用特定 schema 时，会因语法编译而产生额外延迟
- **自动缓存：** 编译后的语法自上次使用起缓存 24 小时，使后续请求速度大幅提升
- **缓存失效：** 如果您更改以下内容，缓存将失效：
  - JSON schema 结构
  - 请求中的工具集（当同时使用结构化输出和工具使用时）
  - 仅更改 `name` 或 `description` 字段不会使缓存失效

### 提示修改与令牌成本 \{#prompt-modification-and-token-costs}

使用结构化输出时，Claude 会自动接收一个额外的系统提示，用于说明预期的输出格式。这意味着：

- 您的输入令牌数量会略有增加
- 注入的提示会像任何其他系统提示一样消耗令牌
- 更改 `output_config.format` 参数会使该对话线程的任何[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)失效

### JSON Schema 限制 \{#json-schema-limitations}

结构化输出支持标准 JSON Schema，但有一些限制。JSON 输出和严格工具使用共享这些限制。

<section title="支持的功能">

- 所有基本类型：object、array、string、integer、number、boolean、null
- `enum`（仅限字符串、数字、布尔值或 null——不支持复杂类型）
- `const`
- `anyOf` 和 `allOf`（有限制——不支持带 `$ref` 的 `allOf`）
- `$ref`、`$def` 和 `definitions`（不支持外部 `$ref`）
- 所有支持类型的 `default` 属性
- `required` 和 `additionalProperties`（对象必须设置为 `false`）
- 字符串格式：`date-time`、`time`、`date`、`duration`、`email`、`hostname`、`uri`、`ipv4`、`ipv6`、`uuid`
- 数组 `minItems`（仅支持值 0 和 1）

</section>

<section title="不支持">

- 递归 schema
- 枚举中的复杂类型
- 外部 `$ref`（例如 `'$ref': 'http://...'`）
- 数值约束（`minimum`、`maximum`、`multipleOf` 等）
- 字符串约束（`minLength`、`maxLength`）
- 除 `minItems` 为 0 或 1 之外的数组约束
- `additionalProperties` 设置为 `false` 以外的任何值

如果您使用了不支持的功能，将收到包含详细信息的 400 错误。

</section>

<section title="Pattern 支持（正则表达式）">

**支持的正则表达式功能：**
- 完全匹配（`^...$`）和部分匹配
- 量词：`*`、`+`、`?`、简单的 `{n,m}` 情况
- 字符类：`[]`、`.`、`\d`、`\w`、`\s`
- 分组：`(...)`

**不支持：**
- 对分组的反向引用（例如 `\1`、`\2`）
- 前瞻/后顾断言（例如 `(?=...)`、`(?!...)`）
- 单词边界：`\b`、`\B`
- 范围较大的复杂 `{n,m}` 量词

简单的正则表达式模式可以正常工作。复杂的模式可能导致 400 错误。

</section>

<Tip>
Python、TypeScript、Ruby 和 PHP SDK 可以自动转换包含不支持功能的 schema，方法是移除这些功能并将约束添加到字段描述中。当 schema 从原生类型派生时，C# 和 Go SDK 也会执行相同的操作。有关详情，请参阅 [SDK 特定方法](#sdk-specific-methods)。
</Tip>

### 属性排序 \{#property-ordering}

使用结构化输出时，对象中的属性会保持您在 schema 中定义的顺序，但有一个重要的注意事项：**必填属性排在前面，然后是可选属性**。

例如，给定以下 schema：

```json
{
  "type": "object",
  "properties": {
    "notes": { "type": "string" },
    "name": { "type": "string" },
    "email": { "type": "string" },
    "age": { "type": "integer" }
  },
  "required": ["name", "email"],
  "additionalProperties": false
}
```

输出中的属性排序如下：

1. `name`（必填，按 schema 顺序）
2. `email`（必填，按 schema 顺序）
3. `notes`（可选，按 schema 顺序）
4. `age`（可选，按 schema 顺序）

这意味着输出可能如下所示：

```json
{
  "name": "John Smith",
  "email": "john@example.com",
  "notes": "Interested in enterprise plan",
  "age": 35
}
```

如果属性在输出中的顺序对您的应用程序很重要，请将所有属性标记为必填，或在解析逻辑中考虑这种重新排序。

### 无效输出 \{#invalid-outputs}

虽然结构化输出在大多数情况下保证 schema 合规性，但在某些场景下，输出可能与您的 schema 不匹配：

**拒绝**（`stop_reason: "refusal"`）

即使在使用结构化输出时，Claude 也会保持其安全性和有用性特性。如果 Claude 出于安全原因拒绝请求：

- 响应的 `stop_reason` 为 `"refusal"`
- 您将收到 200 状态码
- 您将为生成的令牌付费
- 输出可能与您的 schema 不匹配，因为拒绝消息优先于 schema 约束

**达到令牌限制**（`stop_reason: "max_tokens"`）

如果响应因达到 `max_tokens` 限制而被截断：

- 响应的 `stop_reason` 为 `"max_tokens"`
- 输出可能不完整且与您的 schema 不匹配
- 使用更高的 `max_tokens` 值重试以获取完整的结构化输出

### Schema 复杂度限制 \{#schema-complexity-limits}

结构化输出的工作原理是将您的 JSON schema 编译为约束 Claude 输出的语法。更复杂的 schema 会产生更大的语法，编译时间也更长。为了防止编译时间过长，API 强制执行若干复杂度限制。

#### 显式限制 \{#explicit-limits}

以下限制适用于所有带有 `output_config.format` 或 `strict: true` 的请求：

| 限制 | 值 | 描述 |
|-------|-------|-------------|
| 每个请求的严格工具数 | 20 | 带有 `strict: true` 的工具的最大数量。非严格工具不计入此限制。 |
| 可选参数 | 24 | 所有严格工具 schema 和 JSON 输出 schema 中可选参数的总数。每个未在 `required` 中列出的参数都计入此限制。 |
| 使用联合类型的参数 | 16 | 所有严格 schema 中使用 `anyOf` 或类型数组（例如 `"type": ["string", "null"]`）的参数总数。这些参数的成本特别高，因为它们会导致编译成本呈指数级增长。 |

<Note>
这些限制适用于单个请求中所有严格 schema 的合计总数。例如，如果您有 4 个严格工具，每个工具有 6 个可选参数，即使单个工具看起来并不复杂，您也会达到 24 个参数的限制。
</Note>

#### 额外的内部限制 \{#additional-internal-limits}

除了上表中的显式限制外，编译后的语法大小还有额外的内部限制。这些限制的存在是因为 schema 复杂度无法简化为单一维度：可选参数、联合类型、嵌套对象和工具数量等特性会相互作用，可能使编译后的语法不成比例地变大。

当超出这些限制时，您将收到 400 错误，消息为"Schema is too complex for compilation"（Schema 过于复杂，无法编译）。这些错误意味着您的 schema 的综合复杂度超出了可高效编译的范围，即使上表中的每个单独限制都已满足。作为最后的保护措施，API 还强制执行 **180 秒的编译超时**。通过所有显式检查但产生非常大的编译语法的 schema 可能会触发此超时。

#### 降低 schema 复杂度的技巧 \{#tips-for-reducing-schema-complexity}

如果您遇到复杂度限制，请按顺序尝试以下策略：

1. **仅将关键工具标记为严格。** 如果您有许多工具，请将严格模式保留给那些 schema 违规会导致实际问题的工具，对于较简单的工具则依赖 Claude 的自然遵循能力。

2. **减少可选参数。** 尽可能将参数设为 `required`。每个可选参数大约会使语法状态空间的一部分翻倍。如果某个参数始终有合理的默认值，请考虑将其设为必填，并让 Claude 显式提供该默认值。

3. **简化嵌套结构。** 带有可选字段的深度嵌套对象会加剧复杂度。尽可能扁平化结构。

4. **拆分为多个请求。** 如果您有许多严格工具，请考虑将它们拆分到单独的请求或子智能体中。

对于有效 schema 的持续性问题，请携带您的 schema 定义[联系支持团队](https://support.claude.com/en/articles/9015913-how-to-get-support)。

## 数据保留 \{#data-retention}

使用结构化输出时，提示和响应通过 ZDR（零数据保留）处理。但是，出于优化目的，JSON schema 本身会自上次使用起临时缓存最多 24 小时。除 API 响应外，不会保留任何提示或响应数据。

结构化输出符合 HIPAA 资格，但 **JSON schema 定义中不得包含 PHI（受保护健康信息）**。API 会将 JSON schema 编译为语法，这些语法与消息内容分开缓存，并且这些缓存的 schema 不会获得与提示和响应相同的 PHI 保护。请勿在 schema 属性名称、`enum` 值、`const` 值或 `pattern` 正则表达式中包含 PHI。PHI 应仅出现在消息内容（提示和响应）中，在那里它受到 HIPAA 保护措施的保护。

有关所有功能的 ZDR 和 HIPAA 资格，请参阅 [API 和数据保留](/docs/zh-CN/manage-claude/api-and-data-retention)。

## 功能兼容性 \{#feature-compatibility}

**兼容：**
- **[批处理](/docs/zh-CN/build-with-claude/batch-processing)：** 以 50% 的折扣大规模处理结构化输出
- **[令牌计数](/docs/zh-CN/build-with-claude/token-counting)：** 无需编译即可计算令牌数
- **[流式传输](/docs/zh-CN/build-with-claude/streaming)：** 像普通响应一样流式传输结构化输出
- **组合使用：** 在同一请求中同时使用 JSON 输出（`output_config.format`）和严格工具使用（`strict: true`）

**不兼容：**
- **[引用](/docs/zh-CN/build-with-claude/citations)：** 引用需要将引用块与文本交错排列，这与严格的 JSON schema 约束冲突。如果在启用 `output_config.format` 的同时启用引用，将返回 400 错误。
- **消息预填充：** 与 JSON 输出不兼容

<Tip>
**语法作用范围：** 语法仅适用于 Claude 的直接输出，不适用于工具使用调用、工具结果或思考标签（使用[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)时）。语法状态在各部分之间重置，使 Claude 可以自由思考，同时仍在最终响应中生成结构化输出。
</Tip>