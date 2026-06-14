# 令牌计数

---

"Token counting"（令牌计数）使您能够在将消息发送给 Claude 之前确定消息中的令牌数量，帮助您就提示和使用情况做出明智的决策。通过令牌计数，您可以：
- 主动管理速率限制和成本
- 做出明智的模型路由决策
- 优化提示以达到特定长度

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

---

## 如何计算消息令牌数 \{#how-to-count-message-tokens}

[令牌计数](/docs/zh-CN/api/messages-count-tokens)端点接受与创建消息相同的结构化输入列表，包括对系统提示、[工具](/docs/zh-CN/agents-and-tools/tool-use/overview)、[图像](/docs/zh-CN/build-with-claude/vision)和 [PDF](/docs/zh-CN/build-with-claude/pdf-support) 的支持。响应包含输入令牌的总数。

<Note>
令牌计数应被视为**估算值**。在某些情况下，创建消息时实际使用的输入令牌数量可能会有少量差异。

令牌计数可能包含 Anthropic 为系统优化而自动添加的令牌。**系统添加的令牌不会向您收费**。计费仅反映您的内容。
</Note>

### 支持的模型 \{#supported-models}
所有[活跃模型](/docs/zh-CN/about-claude/models/overview)均支持令牌计数。

### 计算基本消息中的令牌数 \{#count-tokens-in-basic-messages}

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages/count_tokens \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "content-type: application/json" \
    --header "anthropic-version: 2023-06-01" \
    --data '{
      "model": "claude-opus-4-8",
      "system": "You are a scientist",
      "messages": [{
        "role": "user",
        "content": "Hello, Claude"
      }]
    }'
```

```bash CLI
ant messages count-tokens \
  --model claude-opus-4-8 \
  --system "You are a scientist" \
  --message '{role: user, content: "Hello, Claude"}'
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.count_tokens(
    model="claude-opus-4-8",
    system="You are a scientist",
    messages=[{"role": "user", "content": "Hello, Claude"}],
)

print(response.json())
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.countTokens({
  model: "claude-opus-4-8",
  system: "You are a scientist",
  messages: [
    {
      role: "user",
      content: "Hello, Claude"
    }
  ]
});

console.log(response);
```

```csharp C#
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var parameters = new MessageCountTokensParams
        {
            Model = Model.ClaudeOpus4_8,
            System = "You are a scientist",
            Messages = [new() { Role = Role.User, Content = "Hello, Claude" }]
        };

        var response = await client.Messages.CountTokens(parameters);
        Console.WriteLine(response);
    }
}
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

	response, err := client.Messages.CountTokens(context.TODO(), anthropic.MessageCountTokensParams{
		Model: anthropic.ModelClaudeOpus4_8,
		System: anthropic.MessageCountTokensParamsSystemUnion{
			OfString: anthropic.String("You are a scientist"),
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Hello, Claude")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(response)
}
```

```java Java hidelines={1..2,5..9,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCountTokensParams;
import com.anthropic.models.messages.MessageTokensCount;
import com.anthropic.models.messages.Model;

public class CountTokensExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCountTokensParams params = MessageCountTokensParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .system("You are a scientist")
      .addUserMessage("Hello, Claude")
      .build();

    MessageTokensCount count = client.messages().countTokens(params);
    System.out.println(count);
  }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$response = $client->messages->countTokens(
    messages: [
        ['role' => 'user', 'content' => 'Hello, Claude']
    ],
    model: 'claude-opus-4-8',
    system: 'You are a scientist',
);

echo json_encode($response);
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response = client.messages.count_tokens(
  model: "claude-opus-4-8",
  system: "You are a scientist",
  messages: [
    { role: "user", content: "Hello, Claude" }
  ]
)

puts response
```
</CodeGroup>

```json Output
{ "input_tokens": 14 }
```

### 计算包含工具的消息中的令牌数 \{#count-tokens-in-messages-with-tools}

<Note>
[服务器工具](/docs/zh-CN/agents-and-tools/tool-use/server-tools)的令牌计数仅适用于第一次采样调用。
</Note>

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages/count_tokens \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "content-type: application/json" \
    --header "anthropic-version: 2023-06-01" \
    --data '{
      "model": "claude-opus-4-8",
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
              }
            },
            "required": ["location"]
          }
        }
      ],
      "messages": [
        {
          "role": "user",
          "content": "What'\''s the weather like in San Francisco?"
        }
      ]
    }'
```

```bash CLI
ant messages count-tokens <<'YAML'
model: claude-opus-4-8
tools:
  - name: get_weather
    description: Get the current weather in a given location
    input_schema:
      type: object
      properties:
        location:
          type: string
          description: The city and state, e.g. San Francisco, CA
      required:
        - location
messages:
  - role: user
    content: What's the weather like in San Francisco?
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.count_tokens(
    model="claude-opus-4-8",
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
                    }
                },
                "required": ["location"],
            },
        }
    ],
    messages=[{"role": "user", "content": "What's the weather like in San Francisco?"}],
)

print(response.json())
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.countTokens({
  model: "claude-opus-4-8",
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
          }
        },
        required: ["location"]
      }
    }
  ],
  messages: [{ role: "user", content: "What's the weather like in San Francisco?" }]
});

console.log(response);
```

```csharp C#
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var parameters = new MessageCountTokensParams
        {
            Model = Model.ClaudeOpus4_8,
            Tools =
            [
                new MessageCountTokensTool(new Tool()
                {
                    Name = "get_weather",
                    Description = "Get the current weather in a given location",
                    InputSchema = new InputSchema()
                    {
                        Properties = new Dictionary<string, JsonElement>
                        {
                            ["location"] = JsonSerializer.SerializeToElement(new { type = "string", description = "The city and state, e.g. San Francisco, CA" }),
                        },
                        Required = ["location"],
                    },
                }),
            ],
            Messages = [new() { Role = Role.User, Content = "What's the weather like in San Francisco?" }]
        };

        var count = await client.Messages.CountTokens(parameters);
        Console.WriteLine(count);
    }
}
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

	response, err := client.Messages.CountTokens(context.TODO(), anthropic.MessageCountTokensParams{
		Model: anthropic.ModelClaudeOpus4_8,
		Tools: []anthropic.MessageCountTokensToolUnionParam{
			{OfTool: &anthropic.ToolParam{
				Name:        "get_weather",
				Description: anthropic.String("Get the current weather in a given location"),
				InputSchema: anthropic.ToolInputSchemaParam{
					Properties: map[string]any{
						"location": map[string]any{
							"type":        "string",
							"description": "The city and state, e.g. San Francisco, CA",
						},
					},
					Required: []string{"location"},
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

	jsonData, _ := json.MarshalIndent(response, "", "  ")
	fmt.Println(string(jsonData))
}
```

```java Java hidelines={1..3,6..14,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.MessageCountTokensParams;
import com.anthropic.models.messages.MessageTokensCount;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.Tool;
import com.anthropic.models.messages.Tool.InputSchema;
import java.util.List;
import java.util.Map;

public class CountTokensWithToolsExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    InputSchema schema = InputSchema.builder()
      .properties(
        JsonValue.from(
          Map.of(
            "location",
            Map.of(
              "type",
              "string",
              "description",
              "The city and state, e.g. San Francisco, CA"
            )
          )
        )
      )
      .putAdditionalProperty("required", JsonValue.from(List.of("location")))
      .build();

    MessageCountTokensParams params = MessageCountTokensParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .addTool(
        Tool.builder()
          .name("get_weather")
          .description("Get the current weather in a given location")
          .inputSchema(schema)
          .build()
      )
      .addUserMessage("What's the weather like in San Francisco?")
      .build();

    MessageTokensCount count = client.messages().countTokens(params);
    System.out.println(count);
  }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$response = $client->messages->countTokens(
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
                    ]
                ],
                'required' => ['location']
            ]
        ]
    ],
);

echo json_encode($response, JSON_PRETTY_PRINT);
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response = client.messages.count_tokens(
  model: "claude-opus-4-8",
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
          }
        },
        required: ["location"]
      }
    }
  ],
  messages: [
    { role: "user", content: "What's the weather like in San Francisco?" }
  ]
)

puts response
```
</CodeGroup>

```json Output
{ "input_tokens": 403 }
```

### 计算包含图像的消息中的令牌数 \{#count-tokens-in-messages-with-images}

<CodeGroup>
```bash cURL
#!/bin/sh

IMAGE_URL="https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
IMAGE_MEDIA_TYPE="image/jpeg"
IMAGE_BASE64=$(curl -s "$IMAGE_URL" | base64 | tr -d '\n')

curl https://api.anthropic.com/v1/messages/count_tokens \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data @- <<EOF
{
    "model": "claude-opus-4-8",
    "messages": [
        {"role": "user", "content": [
            {"type": "image", "source": {
                "type": "base64",
                "media_type": "$IMAGE_MEDIA_TYPE",
                "data": "$IMAGE_BASE64"
            }},
            {"type": "text", "text": "Describe this image"}
        ]}
    ]
}
EOF
```

```bash CLI nocheck
IMAGE_URL="https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
curl -s "$IMAGE_URL" -o ./ant.jpg

ant messages count-tokens <<'YAML'
model: claude-opus-4-8
messages:
  - role: user
    content:
      - type: image
        source:
          type: base64
          media_type: image/jpeg
          data: "@./ant.jpg"
      - type: text
        text: Describe this image
YAML
```

```python Python nocheck hidelines={1}
import anthropic
import base64
import httpx

image_url = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
image_media_type = "image/jpeg"
image_data = base64.standard_b64encode(httpx.get(image_url).content).decode("utf-8")

client = anthropic.Anthropic()

response = client.messages.count_tokens(
    model="claude-opus-4-8",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": image_media_type,
                        "data": image_data,
                    },
                },
                {"type": "text", "text": "Describe this image"},
            ],
        }
    ],
)
print(response.json())
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const image_url =
  "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg";
const image_media_type = "image/jpeg";
const image_array_buffer = await (await fetch(image_url)).arrayBuffer();
const image_data = Buffer.from(image_array_buffer).toString("base64");

const response = await anthropic.messages.countTokens({
  model: "claude-opus-4-8",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: image_media_type,
            data: image_data
          }
        },
        {
          type: "text",
          text: "Describe this image"
        }
      ]
    }
  ]
});
console.log(response);
```

```csharp C# nocheck
using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

public class Program
{
    public static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        string imageUrl = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg";

        using HttpClient httpClient = new();
        byte[] imageBytes = await httpClient.GetByteArrayAsync(imageUrl);
        string imageData = Convert.ToBase64String(imageBytes);

        var parameters = new MessageCountTokensParams
        {
            Model = Model.ClaudeOpus4_8,
            Messages =
            [
                new()
                {
                    Role = Role.User,
                    Content = new MessageParamContent(new List<ContentBlockParam>
                    {
                        new ContentBlockParam(new ImageBlockParam(
                            new ImageBlockParamSource(new Base64ImageSource()
                            {
                                Data = imageData,
                                MediaType = MediaType.ImageJpeg,
                            })
                        )),
                        new ContentBlockParam(new TextBlockParam("Describe this image")),
                    }),
                }
            ]
        };

        var count = await client.Messages.CountTokens(parameters);
        Console.WriteLine(count);
    }
}
```

```go Go nocheck hidelines={1..14,-1}
package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	imageURL := "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"

	req, err := http.NewRequest("GET", imageURL, nil)
	if err != nil {
		log.Fatal(err)
	}
	req.Header.Set("User-Agent", "AnthropicDocsBot/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	imageBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Fatal(err)
	}
	imageData := base64.StdEncoding.EncodeToString(imageBytes)

	client := anthropic.NewClient()

	response, err := client.Messages.CountTokens(context.TODO(), anthropic.MessageCountTokensParams{
		Model: anthropic.ModelClaudeOpus4_8,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewImageBlockBase64("image/jpeg", imageData),
				anthropic.NewTextBlock("Describe this image"),
			),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(response)
}
```

```java Java nocheck hidelines={1..2,4..5,8..19,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Base64ImageSource;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.ImageBlockParam;
import com.anthropic.models.messages.MessageCountTokensParams;
import com.anthropic.models.messages.MessageTokensCount;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Base64;
import java.util.List;

public class CountTokensImageExample {

  public static void main(String[] args) throws Exception {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    String imageUrl =
      "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg";
    String imageMediaType = "image/jpeg";

    HttpClient httpClient = HttpClient.newHttpClient();
    HttpRequest request = HttpRequest.newBuilder().uri(URI.create(imageUrl)).build();
    byte[] imageBytes = httpClient
      .send(request, HttpResponse.BodyHandlers.ofByteArray())
      .body();
    String imageBase64 = Base64.getEncoder().encodeToString(imageBytes);

    ContentBlockParam imageBlock = ContentBlockParam.ofImage(
      ImageBlockParam.builder()
        .source(
          Base64ImageSource.builder()
            .mediaType(Base64ImageSource.MediaType.IMAGE_JPEG)
            .data(imageBase64)
            .build()
        )
        .build()
    );

    ContentBlockParam textBlock = ContentBlockParam.ofText(
      TextBlockParam.builder().text("Describe this image").build()
    );

    MessageCountTokensParams params = MessageCountTokensParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .addUserMessageOfBlockParams(List.of(imageBlock, textBlock))
      .build();

    MessageTokensCount count = client.messages().countTokens(params);
    System.out.println(count);
  }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$imageUrl = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg";
$imageMediaType = "image/jpeg";
$imageData = base64_encode(file_get_contents($imageUrl));

$client = new Client();

$response = $client->messages->countTokens(
    messages: [
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'image',
                    'source' => [
                        'type' => 'base64',
                        'media_type' => $imageMediaType,
                        'data' => $imageData
                    ]
                ],
                ['type' => 'text', 'text' => 'Describe this image']
            ]
        ]
    ],
    model: 'claude-opus-4-8',
);
print_r($response);
```

```ruby Ruby nocheck hidelines={1}
require "anthropic"
require "base64"
require "net/http"

image_url = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
image_media_type = "image/jpeg"

uri = URI(image_url)
image_data = Base64.strict_encode64(Net::HTTP.get(uri))

client = Anthropic::Client.new

response = client.messages.count_tokens(
  model: "claude-opus-4-8",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: image_media_type,
            data: image_data
          }
        },
        { type: "text", text: "Describe this image" }
      ]
    }
  ]
)
puts response
```
</CodeGroup>

```json Output
{ "input_tokens": 1551 }
```

### 计算包含扩展思考的消息中的令牌数 \{#count-tokens-in-messages-with-extended-thinking}

<Note>
有关更多详细信息，请参阅[使用扩展思考时如何计算上下文窗口](/docs/zh-CN/build-with-claude/extended-thinking#how-context-window-is-calculated-with-extended-thinking)
- **先前**助手轮次中的思考块会被忽略，**不会**计入您的输入令牌
- **当前**助手轮次的思考**会**计入您的输入令牌
</Note>

<CodeGroup>

```bash cURL nocheck
curl https://api.anthropic.com/v1/messages/count_tokens \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "content-type: application/json" \
    --header "anthropic-version: 2023-06-01" \
    --data '{
      "model": "claude-sonnet-4-6",
      "thinking": {
        "type": "enabled",
        "budget_tokens": 16000
      },
      "messages": [
        {
          "role": "user",
          "content": "Are there an infinite number of prime numbers such that n mod 4 == 3?"
        },
        {
          "role": "assistant",
          "content": [
            {
              "type": "thinking",
              "thinking": "This is a nice number theory question. Lets think about it step by step...",
              "signature": "EuYBCkQYAiJAgCs1le6/Pol5Z4/JMomVOouGrWdhYNsH3ukzUECbB6iWrSQtsQuRHJID6lWV..."
            },
            {
              "type": "text",
              "text": "Yes, there are infinitely many prime numbers p such that p mod 4 = 3..."
            }
          ]
        },
        {
          "role": "user",
          "content": "Can you write a formal proof?"
        }
      ]
    }'
```

```bash CLI nocheck
ant messages count-tokens <<'YAML'
model: claude-sonnet-4-6
thinking:
  type: enabled
  budget_tokens: 16000
messages:
  - role: user
    content: Are there an infinite number of prime numbers such that n mod 4 == 3?
  - role: assistant
    content:
      - type: thinking
        thinking: >-
          This is a nice number theory question. Lets think about it step by step...
        signature: >-
          EuYBCkQYAiJAgCs1le6/Pol5Z4/JMomVOouGrWdhYNsH3ukzUECbB6iWrSQtsQuRHJID6lWV...
      - type: text
        text: Yes, there are infinitely many prime numbers p such that p mod 4 = 3...
  - role: user
    content: Can you write a formal proof?
YAML
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.count_tokens(
    model="claude-sonnet-4-6",
    thinking={"type": "enabled", "budget_tokens": 16000},
    messages=[
        {
            "role": "user",
            "content": "Are there an infinite number of prime numbers such that n mod 4 == 3?",
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "thinking",
                    "thinking": "This is a nice number theory question. Let's think about it step by step...",
                    "signature": "EuYBCkQYAiJAgCs1le6/Pol5Z4/JMomVOouGrWdhYNsH3ukzUECbB6iWrSQtsQuRHJID6lWV...",
                },
                {
                    "type": "text",
                    "text": "Yes, there are infinitely many prime numbers p such that p mod 4 = 3...",
                },
            ],
        },
        {"role": "user", "content": "Can you write a formal proof?"},
    ],
)

print(response.json())
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.countTokens({
  model: "claude-sonnet-4-6",
  thinking: {
    type: "enabled",
    budget_tokens: 16000
  },
  messages: [
    {
      role: "user",
      content: "Are there an infinite number of prime numbers such that n mod 4 == 3?"
    },
    {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking:
            "This is a nice number theory question. Let's think about it step by step...",
          signature:
            "EuYBCkQYAiJAgCs1le6/Pol5Z4/JMomVOouGrWdhYNsH3ukzUECbB6iWrSQtsQuRHJID6lWV..."
        },
        {
          type: "text",
          text: "Yes, there are infinitely many prime numbers p such that p mod 4 = 3..."
        }
      ]
    },
    {
      role: "user",
      content: "Can you write a formal proof?"
    }
  ]
});

console.log(response);
```

```csharp C# nocheck
using System;
using System.Threading.Tasks;
using System.Collections.Generic;
using Anthropic;
using Anthropic.Models.Messages;

public class Program
{
    public static async Task Main(string[] args)
    {
        AnthropicClient client = new()
        {
            ApiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY")
        };

        var parameters = new MessageCountTokensParams
        {
            Model = Model.ClaudeSonnet4_6,
            Thinking = new ThinkingConfigEnabled(budgetTokens: 16000),
            Messages =
            [
                new()
                {
                    Role = Role.User,
                    Content = "Are there an infinite number of prime numbers such that n mod 4 == 3?"
                },
                new()
                {
                    Role = Role.Assistant,
                    Content = new MessageParamContent(new List<ContentBlockParam>
                    {
                        new ContentBlockParam(new ThinkingBlockParam()
                        {
                            Thinking = "This is a nice number theory question. Let's think about it step by step...",
                            Signature = "EuYBCkQYAiJAgCs1le6/Pol5Z4/JMomVOouGrWdhYNsH3ukzUECbB6iWrSQtsQuRHJID6lWV...",
                        }),
                        new ContentBlockParam(new TextBlockParam("Yes, there are infinitely many prime numbers p such that p mod 4 = 3...")),
                    }),
                },
                new()
                {
                    Role = Role.User,
                    Content = "Can you write a formal proof?"
                }
            ]
        };

        var response = await client.Messages.CountTokens(parameters);
        Console.WriteLine(response);
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

	thinkingBlock := anthropic.NewThinkingBlock(
		"EuYBCkQYAiJAgCs1le6/Pol5Z4/JMomVOouGrWdhYNsH3ukzUECbB6iWrSQtsQuRHJID6lWV...",
		"This is a nice number theory question. Let's think about it step by step...",
	)

	textBlock := anthropic.NewTextBlock(
		"Yes, there are infinitely many prime numbers p such that p mod 4 = 3...",
	)

	response, err := client.Messages.CountTokens(context.TODO(), anthropic.MessageCountTokensParams{
		Model:    anthropic.Model("claude-sonnet-4-6"),
		Thinking: anthropic.ThinkingConfigParamOfEnabled(16000),
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Are there an infinite number of prime numbers such that n mod 4 == 3?")),
			anthropic.NewAssistantMessage(thinkingBlock, textBlock),
			anthropic.NewUserMessage(anthropic.NewTextBlock("Can you write a formal proof?")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("%+v\n", response)
}
```

```java Java nocheck hidelines={1..3,6..7,9..13,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.MessageCountTokensParams;
import com.anthropic.models.messages.MessageTokensCount;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import com.anthropic.models.messages.ThinkingBlockParam;
import java.util.List;

public class CountTokensThinkingExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    List<ContentBlockParam> assistantBlocks = List.of(
      ContentBlockParam.ofThinking(
        ThinkingBlockParam.builder()
          .thinking(
            "This is a nice number theory question. Let's think about it step by step..."
          )
          .signature(
            "EuYBCkQYAiJAgCs1le6/Pol5Z4/JMomVOouGrWdhYNsH3ukzUECbB6iWrSQtsQuRHJID6lWV..."
          )
          .build()
      ),
      ContentBlockParam.ofText(
        TextBlockParam.builder()
          .text("Yes, there are infinitely many prime numbers p such that p mod 4 = 3...")
          .build()
      )
    );

    MessageCountTokensParams params = MessageCountTokensParams.builder()
      .model(Model.CLAUDE_SONNET_4_6)
      .enabledThinking(16000)
      .addUserMessage("Are there an infinite number of prime numbers such that n mod 4 == 3?")
      .addAssistantMessageOfBlockParams(assistantBlocks)
      .addUserMessage("Can you write a formal proof?")
      .build();

    MessageTokensCount count = client.messages().countTokens(params);
    System.out.println(count);
  }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

$response = $client->messages->countTokens(
    messages: [
        [
            'role' => 'user',
            'content' => 'Are there an infinite number of prime numbers such that n mod 4 == 3?'
        ],
        [
            'role' => 'assistant',
            'content' => [
                [
                    'type' => 'thinking',
                    'thinking' => 'This is a nice number theory question. Let\'s think about it step by step...',
                    'signature' => 'EuYBCkQYAiJAgCs1le6/Pol5Z4/JMomVOouGrWdhYNsH3ukzUECbB6iWrSQtsQuRHJID6lWV...'
                ],
                [
                    'type' => 'text',
                    'text' => 'Yes, there are infinitely many prime numbers p such that p mod 4 = 3...'
                ]
            ]
        ],
        [
            'role' => 'user',
            'content' => 'Can you write a formal proof?'
        ]
    ],
    model: 'claude-sonnet-4-6',
    thinking: [
        'type' => 'enabled',
        'budget_tokens' => 16000
    ],
);

echo json_encode($response);
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response = client.messages.count_tokens(
  model: "claude-sonnet-4-6",
  thinking: {
    type: "enabled",
    budget_tokens: 16000
  },
  messages: [
    {
      role: "user",
      content: "Are there an infinite number of prime numbers such that n mod 4 == 3?"
    },
    {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "This is a nice number theory question. Let's think about it step by step...",
          signature: "EuYBCkQYAiJAgCs1le6/Pol5Z4/JMomVOouGrWdhYNsH3ukzUECbB6iWrSQtsQuRHJID6lWV..."
        },
        {
          type: "text",
          text: "Yes, there are infinitely many prime numbers p such that p mod 4 = 3..."
        }
      ]
    },
    {
      role: "user",
      content: "Can you write a formal proof?"
    }
  ]
)

puts response
```
</CodeGroup>

```json Output
{ "input_tokens": 88 }
```

### 计算包含 PDF 的消息中的令牌数 \{#count-tokens-in-messages-with-pdfs}

<Note>
令牌计数支持 PDF，其[限制](/docs/zh-CN/build-with-claude/pdf-support#pdf-support-limitations)与 Messages API 相同。
</Note>

<CodeGroup>
```bash cURL hidelines={1..3}
PDF_URL="https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf"
PDF_BASE64=$(curl -s "$PDF_URL" | base64 | tr -d '\n')

curl https://api.anthropic.com/v1/messages/count_tokens \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "content-type: application/json" \
    --header "anthropic-version: 2023-06-01" \
    --data @- <<EOF
{
  "model": "claude-opus-4-8",
  "messages": [{
    "role": "user",
    "content": [
      {
        "type": "document",
        "source": {
          "type": "base64",
          "media_type": "application/pdf",
          "data": "$PDF_BASE64"
        }
      },
      {
        "type": "text",
        "text": "Please summarize this document."
      }
    ]
  }]
}
EOF
```

```bash CLI nocheck hidelines={1..3}
PDF_URL="https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf"
curl -s "$PDF_URL" -o document.pdf

ant messages count-tokens <<'YAML'
model: claude-opus-4-8
messages:
  - role: user
    content:
      - type: document
        source:
          type: base64
          media_type: application/pdf
          data: "@./document.pdf"
      - type: text
        text: Please summarize this document.
YAML
```

```python Python nocheck
import base64
import anthropic

client = anthropic.Anthropic()

with open("document.pdf", "rb") as pdf_file:
    pdf_base64 = base64.standard_b64encode(pdf_file.read()).decode("utf-8")

response = client.messages.count_tokens(
    model="claude-opus-4-8",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": pdf_base64,
                    },
                },
                {"type": "text", "text": "Please summarize this document."},
            ],
        }
    ],
)

print(response.json())
```

```typescript TypeScript nocheck hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "fs/promises";

const client = new Anthropic();

const pdfBase64 = await readFile("document.pdf", { encoding: "base64" });

const response = await client.messages.countTokens({
  model: "claude-opus-4-8",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: pdfBase64
          }
        },
        {
          type: "text",
          text: "Please summarize this document."
        }
      ]
    }
  ]
});

console.log(response);
```

```csharp C# nocheck
using System;
using System.IO;
using System.Threading.Tasks;
using System.Collections.Generic;
using Anthropic;
using Anthropic.Models.Messages;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        byte[] pdfBytes = await File.ReadAllBytesAsync("document.pdf");
        string pdfBase64 = Convert.ToBase64String(pdfBytes);

        var parameters = new MessageCountTokensParams
        {
            Model = Model.ClaudeOpus4_8,
            Messages =
            [
                new()
                {
                    Role = Role.User,
                    Content = new MessageParamContent(new List<ContentBlockParam>
                    {
                        new ContentBlockParam(new DocumentBlockParam(
                            new DocumentBlockParamSource(new Base64PdfSource()
                            {
                                Data = pdfBase64,
                                MediaType = MediaType.ApplicationPdf,
                            })
                        )),
                        new ContentBlockParam(new TextBlockParam("Please summarize this document.")),
                    }),
                }
            ]
        };

        var count = await client.Messages.CountTokens(parameters);
        Console.WriteLine(count);
    }
}
```

```go Go nocheck hidelines={1..15,-1}
package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	pdfBytes, err := os.ReadFile("document.pdf")
	if err != nil {
		log.Fatal(err)
	}
	pdfBase64 := base64.StdEncoding.EncodeToString(pdfBytes)

	response, err := client.Messages.CountTokens(context.TODO(), anthropic.MessageCountTokensParams{
		Model: anthropic.ModelClaudeOpus4_8,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.NewDocumentBlock(anthropic.Base64PDFSourceParam{
					Data: pdfBase64,
				}),
				anthropic.NewTextBlock("Please summarize this document."),
			),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(response)
}
```

```java Java nocheck hidelines={1..2,4,8..17,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Base64PdfSource;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.DocumentBlockParam;
import com.anthropic.models.messages.MessageCountTokensParams;
import com.anthropic.models.messages.MessageTokensCount;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;

public class CountTokensPdfExample {

  public static void main(String[] args) throws Exception {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    byte[] fileBytes = Files.readAllBytes(Path.of("document.pdf"));
    String pdfBase64 = Base64.getEncoder().encodeToString(fileBytes);

    ContentBlockParam documentBlock = ContentBlockParam.ofDocument(
      DocumentBlockParam.builder()
        .source(
          Base64PdfSource.builder()
            .mediaType(Base64PdfSource.MediaType.APPLICATION_PDF)
            .data(pdfBase64)
            .build()
        )
        .build()
    );

    ContentBlockParam textBlock = ContentBlockParam.ofText(
      TextBlockParam.builder().text("Please summarize this document.").build()
    );

    MessageCountTokensParams params = MessageCountTokensParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .addUserMessageOfBlockParams(List.of(documentBlock, textBlock))
      .build();

    MessageTokensCount count = client.messages().countTokens(params);
    System.out.println(count);
  }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

$pdfBase64 = base64_encode(file_get_contents("document.pdf"));

$response = $client->messages->countTokens(
    messages: [
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'document',
                    'source' => [
                        'type' => 'base64',
                        'media_type' => 'application/pdf',
                        'data' => $pdfBase64
                    ]
                ],
                [
                    'type' => 'text',
                    'text' => 'Please summarize this document.'
                ]
            ]
        ]
    ],
    model: 'claude-opus-4-8',
);

echo json_encode($response);
```

```ruby Ruby nocheck hidelines={1}
require "anthropic"
require "base64"

client = Anthropic::Client.new

pdf_base64 = Base64.strict_encode64(File.binread("document.pdf"))

response = client.messages.count_tokens(
  model: "claude-opus-4-8",
  messages: [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: pdf_base64
          }
        },
        {
          type: "text",
          text: "Please summarize this document."
        }
      ]
    }
  ]
)

puts response
```
</CodeGroup>

```json Output
{ "input_tokens": 2188 }
```

---

## Claude Fable 5 和 Claude Mythos 5 上的令牌计数 \{#token-counts-on-claude-fable-5}

Claude Fable 5 和 Claude Mythos 5 使用随 Claude Opus 4.7 引入的分词器，对于相同的文本，该分词器产生的令牌数量比 Claude Opus 4.7 之前的模型大约多 30%。令牌计数端点会根据您传入的 `model` 所对应的分词器返回计数，因此要衡量您的工作负载的差异，请对同一请求计数两次：一次使用您当前的模型，一次使用 `model: "claude-fable-5"`（或 `"claude-mythos-5"`），然后比较两个 `input_tokens` 值。

<Note>
**计费和迁移：**Claude Fable 5 和 Claude Mythos 5 上的使用量和计费反映的是此分词器的计数。如果您从 Claude Opus 4.7 之前的模型迁移，相同的内容将消耗大约多 30% 的令牌。在将工作负载迁移到 Claude Fable 5 和 Claude Mythos 5 时，请勿重复使用在 Claude Opus 4.7 之前的模型上测量的令牌计数来估算成本或上下文窗口的适配情况。请使用 `model: "claude-fable-5"`（或 `"claude-mythos-5"`）对您的提示进行计数。
</Note>

---

## 定价和速率限制 \{#pricing-and-rate-limits}

令牌计数**免费使用**，但会根据您的[使用层级](/docs/zh-CN/api/rate-limits#rate-limits)受到每分钟请求数的速率限制。如果您需要更高的限制，请通过 [Claude Console](/settings/limits) 联系销售团队。

| 使用层级 | 每分钟请求数（RPM） |
|------------|---------------------------|
| 1          | 100                       |
| 2          | 2,000                     |
| 3          | 4,000                     |
| 4          | 8,000                     |

<Note>
  令牌计数和消息创建具有独立且互不影响的速率限制。使用其中一个不会计入另一个的限制。
</Note>

---
## 常见问题 \{#faq}

  <section title="令牌计数是否使用提示缓存？">

    不，令牌计数在不使用缓存逻辑的情况下提供估算值。虽然您可以在令牌计数请求中提供 `cache_control` 块，但提示缓存仅在实际创建消息时发生。
  
</section>