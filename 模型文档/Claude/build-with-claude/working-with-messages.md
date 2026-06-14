# 使用 Messages API

有效使用 Messages API 的实用模式和示例

---

Anthropic 提供两种使用 Claude 进行构建的方式，每种方式适用于不同的使用场景：

| | Messages API | Claude Managed Agents |
|---|---|---|
| **是什么** | 直接访问模型提示功能 | 预构建、可配置的智能体框架，运行在托管基础设施上 |
| **最适合** | 自定义智能体循环和细粒度控制 | 长时间运行的任务和异步工作 |
| **了解更多** | [Messages API 文档](/docs/zh-CN/build-with-claude/working-with-messages) | [Claude Managed Agents 文档](/docs/zh-CN/managed-agents/overview) |

本指南涵盖使用 Messages API 的常见模式，包括基本请求、多轮对话、预填充技术和视觉功能。有关完整的 API 规范，请参阅 [Messages API 参考](/docs/zh-CN/api/messages/create)。

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

## 基本请求和响应 \{#basic-request-and-response}

<Note>
Claude Opus 4.7 及更高版本的模型（包括 Claude Opus 4.8）不支持 `temperature`、`top_p` 和 `top_k` 采样参数。将它们设置为非默认值会返回 400 错误。请从请求负载中省略这些参数，改用提示来引导模型的行为。请参阅[迁移指南](/docs/zh-CN/about-claude/models/migration-guide#migrating-from-claude-opus-47)。
</Note>

<CodeGroup>
  ```bash cURL
  #!/bin/sh
  curl https://api.anthropic.com/v1/messages \
       --header "x-api-key: $ANTHROPIC_API_KEY" \
       --header "anthropic-version: 2023-06-01" \
       --header "content-type: application/json" \
       --data \
  '{
      "model": "claude-opus-4-8",
      "max_tokens": 1024,
      "messages": [
          {"role": "user", "content": "Hello, Claude"}
      ]
  }'
  ```

  ```bash CLI
  ant messages create \
    --model claude-opus-4-8 \
    --max-tokens 1024 \
    --message '{role: user, content: "Hello, Claude"}'
  ```

  ```python Python hidelines={1..2}
  import anthropic

  message = anthropic.Anthropic().messages.create(
      model="claude-opus-4-8",
      max_tokens=1024,
      messages=[{"role": "user", "content": "Hello, Claude"}],
  )
  print(message)
  ```

  ```typescript TypeScript hidelines={1..2}
  import Anthropic from "@anthropic-ai/sdk";

  const anthropic = new Anthropic();

  const message = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello, Claude" }]
  });
  console.log(message);
  ```

  ```csharp C#
  using Anthropic;
  using Anthropic.Models.Messages;

  AnthropicClient client = new();

  var parameters = new MessageCreateParams
  {
      Model = Model.ClaudeOpus4_8,
      MaxTokens = 1024,
      Messages = [new() { Role = Role.User, Content = "Hello, Claude" }]
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
  			anthropic.NewUserMessage(anthropic.NewTextBlock("Hello, Claude")),
  		},
  	})
  	if err != nil {
  		log.Fatal(err)
  	}
  	fmt.Println(response)
  }
  ```

  ```java Java hidelines={1..8,-2..}
  import com.anthropic.client.AnthropicClient;
  import com.anthropic.client.okhttp.AnthropicOkHttpClient;
  import com.anthropic.models.messages.MessageCreateParams;
  import com.anthropic.models.messages.Message;
  import com.anthropic.models.messages.Model;

  public class Main {
      public static void main(String[] args) {
          AnthropicClient client = AnthropicOkHttpClient.fromEnv();

          MessageCreateParams params = MessageCreateParams.builder()
              .model(Model.CLAUDE_OPUS_4_8)
              .maxTokens(1024L)
              .addUserMessage("Hello, Claude")
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
      maxTokens: 1024,
      messages: [['role' => 'user', 'content' => 'Hello, Claude']],
      model: 'claude-opus-4-8',
  );
  echo $message->content[0]->text;
  ```

  ```ruby Ruby hidelines={1..2}
  require "anthropic"

  client = Anthropic::Client.new

  message = client.messages.create(
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [
      { role: "user", content: "Hello, Claude" }
    ]
  )
  puts message
  ```
</CodeGroup>

```json Output
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello!"
    }
  ],
  "model": "claude-opus-4-8",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 12,
    "output_tokens": 6
  }
}
```

在 Claude Opus 4.7 及更高版本的模型上，拒绝响应（`stop_reason: "refusal"`）还包含一个 `stop_details` 对象，用于标识触发拒绝的策略类别。有关字段参考和示例处理代码，请参阅[处理停止原因](/docs/zh-CN/build-with-claude/refusals-and-fallback#refusal-response)。

## 多轮对话 \{#multiple-conversational-turns}

Messages API 是无状态的，这意味着您始终需要将完整的对话历史发送到 API。您可以使用此模式随时间逐步构建对话。较早的对话轮次不一定需要实际来自 Claude，您可以使用合成的 `assistant` 消息。

<CodeGroup>
```bash cURL
#!/bin/sh
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "messages": [
        {"role": "user", "content": "Hello, Claude"},
        {"role": "assistant", "content": "Hello!"},
        {"role": "user", "content": "Can you describe LLMs to me?"}

    ]
}'
```

```bash CLI
ant messages create \
  --model claude-opus-4-8 \
  --max-tokens 1024 \
  --message '{role: user, content: "Hello, Claude"}' \
  --message '{role: assistant, content: "Hello!"}' \
  --message '{role: user, content: "Can you describe LLMs to me?"}'
```

```python Python hidelines={1..2}
import anthropic

message = anthropic.Anthropic().messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[
        {"role": "user", "content": "Hello, Claude"},
        {"role": "assistant", "content": "Hello!"},
        {"role": "user", "content": "Can you describe LLMs to me?"},
    ],
)
print(message)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const message = await anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    { role: "user", content: "Hello, Claude" },
    { role: "assistant", content: "Hello!" },
    { role: "user", content: "Can you describe LLMs to me?" }
  ]
});
console.log(message);
```

```csharp C#
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Messages =
    [
        new() { Role = Role.User, Content = "Hello, Claude" },
        new() { Role = Role.Assistant, Content = "Hello!" },
        new() { Role = Role.User, Content = "Can you describe LLMs to me?" }
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
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Hello, Claude")),
			anthropic.NewAssistantMessage(anthropic.NewTextBlock("Hello!")),
			anthropic.NewUserMessage(anthropic.NewTextBlock("Can you describe LLMs to me?")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..8,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;

public class MultiTurnConversation {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(1024L)
            .addUserMessage("Hello, Claude")
            .addAssistantMessage("Hello!")
            .addUserMessage("Can you describe LLMs to me?")
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
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'Hello, Claude'],
        ['role' => 'assistant', 'content' => 'Hello!'],
        ['role' => 'user', 'content' => 'Can you describe LLMs to me?'],
    ],
    model: 'claude-opus-4-8',
);

echo $message->content[0]->text;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    { role: "user", content: "Hello, Claude" },
    { role: "assistant", content: "Hello!" },
    { role: "user", content: "Can you describe LLMs to me?" }
  ]
)
puts message
```
</CodeGroup>

```json Output
{
  "id": "msg_018gCsTGsXkYJVqYPxTgDHBU",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Sure, I'd be happy to provide..."
    }
  ],
  "model": "claude-opus-4-8",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 30,
    "output_tokens": 309
  }
}
```

### 消息中的系统角色 \{#system-role-in-messages}

在 Claude Opus 4.8 上，您可以在用户轮次之后包含带有 `"role": "system"` 的消息（需遵守[放置规则](/docs/zh-CN/build-with-claude/mid-conversation-system-messages#limitations)），以便在对话中途添加新的系统指令。`system` 消息不能是 `messages` 中的第一个条目；对于从一开始就应生效的指令，请使用顶层 `system` 字段。

对话中途的系统消息与顶层 `system` 字段具有相同的权威性，但由于它被附加到消息历史的末尾，因此不会使其之前的任何缓存前缀失效。对于应从第一轮就生效的指令，请使用顶层 `system` 字段；对于仅在后续才相关的指令，请使用对话中途的系统消息。

请参阅[对话中途的系统消息](/docs/zh-CN/build-with-claude/mid-conversation-system-messages)获取完整指南，包括如何将其与[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)结合使用。

## 预填充 Claude 的回复 \{#putting-words-in-claudes-mouth}

您可以在输入消息列表的最后位置预填充 Claude 响应的一部分。这可用于塑造 Claude 的响应。下面的示例使用 `"max_tokens": 1` 从 Claude 获取单个多项选择答案。

<Warning>
Claude Fable 5、[Claude Mythos 5](https://anthropic.com/glasswing)、[Claude Mythos Preview](https://anthropic.com/glasswing)、Claude Opus 4.8、Claude Opus 4.7、Claude Opus 4.6 和 Claude Sonnet 4.6 不支持预填充。对这些模型使用预填充的请求会返回 400 错误。请在支持的模型上改用[结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)，或使用系统提示指令。有关迁移模式，请参阅[迁移指南](/docs/zh-CN/about-claude/models/migration-guide)。
</Warning>

<CodeGroup>
  ```bash cURL
  #!/bin/sh
  curl https://api.anthropic.com/v1/messages \
       --header "x-api-key: $ANTHROPIC_API_KEY" \
       --header "anthropic-version: 2023-06-01" \
       --header "content-type: application/json" \
       --data \
  '{
      "model": "claude-sonnet-4-5",
      "max_tokens": 1,
      "messages": [
          {"role": "user", "content": "What is latin for Ant? (A) Apoidea, (B) Rhopalocera, (C) Formicidae"},
          {"role": "assistant", "content": "The answer is ("}
      ]
  }'
  ```

  ```bash CLI
  ant messages create <<'YAML'
  model: claude-sonnet-4-5
  max_tokens: 1
  messages:
    - role: user
      content: "What is latin for Ant? (A) Apoidea, (B) Rhopalocera, (C) Formicidae"
    - role: assistant
      content: "The answer is ("
  YAML
  ```

  ```python Python hidelines={1..2}
  import anthropic

  message = anthropic.Anthropic().messages.create(
      model="claude-sonnet-4-5",
      max_tokens=1,
      messages=[
          {
              "role": "user",
              "content": "What is latin for Ant? (A) Apoidea, (B) Rhopalocera, (C) Formicidae",
          },
          {"role": "assistant", "content": "The answer is ("},
      ],
  )
  print(message)
  ```

  ```typescript TypeScript hidelines={1..2}
  import Anthropic from "@anthropic-ai/sdk";

  const anthropic = new Anthropic();

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1,
    messages: [
      {
        role: "user",
        content: "What is latin for Ant? (A) Apoidea, (B) Rhopalocera, (C) Formicidae"
      },
      { role: "assistant", content: "The answer is (" }
    ]
  });
  console.log(message);
  ```

  ```csharp C#
  using Anthropic;
  using Anthropic.Models.Messages;

  AnthropicClient client = new();

  var parameters = new MessageCreateParams
  {
      Model = Model.ClaudeSonnet4_5,
      MaxTokens = 1,
      Messages = [
          new() { Role = Role.User, Content = "What is latin for Ant? (A) Apoidea, (B) Rhopalocera, (C) Formicidae" },
          new() { Role = Role.Assistant, Content = "The answer is (" }
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
  		Model:     anthropic.ModelClaudeSonnet4_5,
  		MaxTokens: 1,
  		Messages: []anthropic.MessageParam{
  			anthropic.NewUserMessage(anthropic.NewTextBlock("What is latin for Ant? (A) Apoidea, (B) Rhopalocera, (C) Formicidae")),
  			anthropic.NewAssistantMessage(anthropic.NewTextBlock("The answer is (")),
  		},
  	})
  	if err != nil {
  		log.Fatal(err)
  	}
  	fmt.Println(response)
  }
  ```

  ```java Java hidelines={1..8,-2..}
  import com.anthropic.client.AnthropicClient;
  import com.anthropic.client.okhttp.AnthropicOkHttpClient;
  import com.anthropic.models.messages.MessageCreateParams;
  import com.anthropic.models.messages.Message;
  import com.anthropic.models.messages.Model;

  public class PrefillExample {
      public static void main(String[] args) {
          AnthropicClient client = AnthropicOkHttpClient.fromEnv();

          MessageCreateParams params = MessageCreateParams.builder()
              .model(Model.CLAUDE_SONNET_4_5)
              .maxTokens(1L)
              .addUserMessage("What is latin for Ant? (A) Apoidea, (B) Rhopalocera, (C) Formicidae")
              .addAssistantMessage("The answer is (")
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
      maxTokens: 1,
      messages: [
          ['role' => 'user', 'content' => 'What is latin for Ant? (A) Apoidea, (B) Rhopalocera, (C) Formicidae'],
          ['role' => 'assistant', 'content' => 'The answer is ('],
      ],
      model: 'claude-sonnet-4-5',
  );
  echo $message->content[0]->text;
  ```

  ```ruby Ruby hidelines={1..2}
  require "anthropic"

  client = Anthropic::Client.new

  message = client.messages.create(
    model: "claude-sonnet-4-5",
    max_tokens: 1,
    messages: [
      {
        role: "user",
        content: "What is latin for Ant? (A) Apoidea, (B) Rhopalocera, (C) Formicidae"
      },
      { role: "assistant", content: "The answer is (" }
    ]
  )
  puts message
  ```
</CodeGroup>

```json Output
{
  "id": "msg_01Q8Faay6S7QPTvEUUQARt7h",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "C"
    }
  ],
  "model": "claude-sonnet-4-5",
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 42,
    "output_tokens": 1
  }
}
```

## 视觉 \{#vision}

Claude 可以在请求中读取文本和图像。图像可以使用 `base64`、`url` 或 `file` 源类型提供。`file` 源类型引用通过 [Files API](/docs/zh-CN/build-with-claude/files) 上传的图像。支持的媒体类型为 `image/jpeg`、`image/png`、`image/gif` 和 `image/webp`。有关更多详细信息，请参阅[视觉指南](/docs/zh-CN/build-with-claude/vision)。

<CodeGroup>
  ```bash cURL
  #!/bin/sh

  # 选项 1：Base64 编码的图片
  IMAGE_URL="https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
  IMAGE_MEDIA_TYPE="image/jpeg"
  IMAGE_BASE64=$(curl "$IMAGE_URL" | base64 | tr -d '\n')

  curl https://api.anthropic.com/v1/messages \
       --header "x-api-key: $ANTHROPIC_API_KEY" \
       --header "anthropic-version: 2023-06-01" \
       --header "content-type: application/json" \
       --data \
  '{
      "model": "claude-opus-4-8",
      "max_tokens": 1024,
      "messages": [
          {"role": "user", "content": [
              {"type": "image", "source": {
                  "type": "base64",
                  "media_type": "'$IMAGE_MEDIA_TYPE'",
                  "data": "'$IMAGE_BASE64'"
              }},
              {"type": "text", "text": "What is in the above image?"}
          ]}
      ]
  }'

  # 选项 2：URL 引用的图片
  curl https://api.anthropic.com/v1/messages \
       --header "x-api-key: $ANTHROPIC_API_KEY" \
       --header "anthropic-version: 2023-06-01" \
       --header "content-type: application/json" \
       --data \
  '{
      "model": "claude-opus-4-8",
      "max_tokens": 1024,
      "messages": [
          {"role": "user", "content": [
              {"type": "image", "source": {
                  "type": "url",
                  "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
              }},
              {"type": "text", "text": "What is in the above image?"}
          ]}
      ]
  }'
  ```

  
  ```bash CLI nocheck
  IMAGE_URL="https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"

  # 选项 1：Base64 编码的图片（CLI 会自动对二进制 @file 引用进行编码）
  curl -s "$IMAGE_URL" -o ./ant.jpg

  ant messages create <<'YAML'
  model: claude-opus-4-8
  max_tokens: 1024
  messages:
    - role: user
      content:
        - type: image
          source:
            type: base64
            media_type: image/jpeg
            data: "@./ant.jpg"
        - type: text
          text: What is in the above image?
  YAML

  # 选项 2：通过 URL 引用的图片
  ant messages create <<YAML
  model: claude-opus-4-8
  max_tokens: 1024
  messages:
    - role: user
      content:
        - type: image
          source:
            type: url
            url: $IMAGE_URL
        - type: text
          text: What is in the above image?
  YAML
  ```

  
  ```python Python nocheck hidelines={1}
  import anthropic
  import base64
  import httpx

  # 选项 1：Base64 编码的图片
  image_url = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
  image_media_type = "image/jpeg"
  image_data = base64.standard_b64encode(httpx.get(image_url).content).decode("utf-8")

  message = anthropic.Anthropic().messages.create(
      model="claude-opus-4-8",
      max_tokens=1024,
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
                  {"type": "text", "text": "What is in the above image?"},
              ],
          }
      ],
  )
  print(message)

  # 选项 2：URL 引用的图片
  message_from_url = anthropic.Anthropic().messages.create(
      model="claude-opus-4-8",
      max_tokens=1024,
      messages=[
          {
              "role": "user",
              "content": [
                  {
                      "type": "image",
                      "source": {
                          "type": "url",
                          "url": "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg",
                      },
                  },
                  {"type": "text", "text": "What is in the above image?"},
              ],
          }
      ],
  )
  print(message_from_url)
  ```

  
  ```typescript TypeScript nocheck hidelines={1..2}
  import Anthropic from "@anthropic-ai/sdk";

  const anthropic = new Anthropic();

  // 选项 1：Base64 编码的图片
  const image_url =
    "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg";
  const image_media_type = "image/jpeg";
  const image_array_buffer = await (await fetch(image_url)).arrayBuffer();
  const image_data = Buffer.from(image_array_buffer).toString("base64");

  const message = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
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
            text: "What is in the above image?"
          }
        ]
      }
    ]
  });
  console.log(message);

  // 选项 2：URL 引用的图片
  const messageFromUrl = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "url",
              url: "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
            }
          },
          {
            type: "text",
            text: "What is in the above image?"
          }
        ]
      }
    ]
  });
  console.log(messageFromUrl);
  ```

  
  ```csharp C# nocheck
  using System.Collections.Generic;
  using System.Net.Http;
  using Anthropic;
  using Anthropic.Models.Messages;

  AnthropicClient client = new();

  // 选项 1：Base64 编码的图片
  string imageUrl = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg";

  using HttpClient httpClient = new();
  byte[] imageBytes = await httpClient.GetByteArrayAsync(imageUrl);
  string imageData = Convert.ToBase64String(imageBytes);

  var parameters = new MessageCreateParams
  {
      Model = Model.ClaudeOpus4_8,
      MaxTokens = 1024,
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
                  new ContentBlockParam(new TextBlockParam("What is in the above image?")),
              }),
          }
      ]
  };

  var message = await client.Messages.Create(parameters);
  Console.WriteLine(message);

  // 选项 2：通过 URL 引用的图片
  var parametersFromUrl = new MessageCreateParams
  {
      Model = Model.ClaudeOpus4_8,
      MaxTokens = 1024,
      Messages =
      [
          new()
          {
              Role = Role.User,
              Content = new MessageParamContent(new List<ContentBlockParam>
              {
                  new ContentBlockParam(new ImageBlockParam(
                      new ImageBlockParamSource(new UrlImageSource()
                      {
                          Url = new Uri("https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"),
                      })
                  )),
                  new ContentBlockParam(new TextBlockParam("What is in the above image?")),
              }),
          }
      ]
  };

  var messageFromUrl = await client.Messages.Create(parametersFromUrl);
  Console.WriteLine(messageFromUrl);
  ```

  
  ```go Go nocheck hidelines={1..16,-1}
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
  	client := anthropic.NewClient()

  	// 选项 1：Base64 编码的图片
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

  	message, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
  		Model:     anthropic.ModelClaudeOpus4_8,
  		MaxTokens: 1024,
  		Messages: []anthropic.MessageParam{
  			anthropic.NewUserMessage(
  				anthropic.NewImageBlockBase64("image/jpeg", imageData),
  				anthropic.NewTextBlock("What is in the above image?"),
  			),
  		},
  	})
  	if err != nil {
  		log.Fatal(err)
  	}
  	fmt.Println(message)

  	// 选项 2：URL 引用的图片
  	messageFromURL, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
  		Model:     anthropic.ModelClaudeOpus4_8,
  		MaxTokens: 1024,
  		Messages: []anthropic.MessageParam{
  			anthropic.NewUserMessage(
  				anthropic.NewImageBlock(anthropic.URLImageSourceParam{
  					URL: "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg",
  				}),
  				anthropic.NewTextBlock("What is in the above image?"),
  			),
  		},
  	})
  	if err != nil {
  		log.Fatal(err)
  	}
  	fmt.Println(messageFromURL)
  }
  ```

  
  ```java Java nocheck hidelines={1..12,-2..}
  import com.anthropic.client.AnthropicClient;
  import com.anthropic.client.okhttp.AnthropicOkHttpClient;
  import com.anthropic.models.messages.*;
  import java.net.URI;
  import java.net.http.HttpClient;
  import java.net.http.HttpRequest;
  import java.net.http.HttpResponse;
  import java.util.Base64;
  import java.util.List;

  public class VisionExample {
      public static void main(String[] args) throws Exception {
          AnthropicClient client = AnthropicOkHttpClient.fromEnv();

          // 选项 1：Base64 编码的图片
          String imageUrl = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg";

          HttpClient httpClient = HttpClient.newHttpClient();
          HttpRequest request = HttpRequest.newBuilder().uri(URI.create(imageUrl)).build();
          HttpResponse<byte[]> response = httpClient.send(request, HttpResponse.BodyHandlers.ofByteArray());
          String imageData = Base64.getEncoder().encodeToString(response.body());

          List<ContentBlockParam> base64Content = List.of(
              ContentBlockParam.ofImage(
                  ImageBlockParam.builder()
                      .source(Base64ImageSource.builder()
                          .data(imageData)
                          .mediaType(Base64ImageSource.MediaType.IMAGE_JPEG)
                          .build())
                      .build()),
              ContentBlockParam.ofText(
                  TextBlockParam.builder()
                      .text("What is in the above image?")
                      .build())
          );

          Message message = client.messages().create(
              MessageCreateParams.builder()
                  .model(Model.CLAUDE_OPUS_4_8)
                  .maxTokens(1024L)
                  .addUserMessageOfBlockParams(base64Content)
                  .build());
          System.out.println(message);

          // 选项 2：URL 引用的图片
          List<ContentBlockParam> urlContent = List.of(
              ContentBlockParam.ofImage(
                  ImageBlockParam.builder()
                      .source(UrlImageSource.builder()
                          .url("https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg")
                          .build())
                      .build()),
              ContentBlockParam.ofText(
                  TextBlockParam.builder()
                      .text("What is in the above image?")
                      .build())
          );

          Message messageFromUrl = client.messages().create(
              MessageCreateParams.builder()
                  .model(Model.CLAUDE_OPUS_4_8)
                  .maxTokens(1024L)
                  .addUserMessageOfBlockParams(urlContent)
                  .build());
          System.out.println(messageFromUrl);
      }
  }
  ```

  
  ```php PHP hidelines={1..4} nocheck
  <?php

  use Anthropic\Client;

  $client = new Client();

  // 选项 1：Base64 编码的图片
  $image_url = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg";
  $image_media_type = "image/jpeg";
  $image_data = base64_encode(file_get_contents($image_url));

  $message = $client->messages->create(
      maxTokens: 1024,
      messages: [
          [
              'role' => 'user',
              'content' => [
                  [
                      'type' => 'image',
                      'source' => [
                          'type' => 'base64',
                          'media_type' => $image_media_type,
                          'data' => $image_data,
                      ],
                  ],
                  [
                      'type' => 'text',
                      'text' => 'What is in the above image?',
                  ],
              ],
          ],
      ],
      model: 'claude-opus-4-8',
  );
  echo $message;

  // 选项 2：URL 引用的图片
  $message_from_url = $client->messages->create(
      maxTokens: 1024,
      messages: [
          [
              'role' => 'user',
              'content' => [
                  [
                      'type' => 'image',
                      'source' => [
                          'type' => 'url',
                          'url' => 'https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg',
                      ],
                  ],
                  [
                      'type' => 'text',
                      'text' => 'What is in the above image?',
                  ],
              ],
          ],
      ],
      model: 'claude-opus-4-8',
  );
  echo $message_from_url;
  ```

  
  ```ruby Ruby nocheck hidelines={1}
  require "anthropic"
  require "base64"
  require "net/http"

  client = Anthropic::Client.new

  # 选项 1：Base64 编码的图片
  image_url = "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
  image_media_type = "image/jpeg"
  image_data = Base64.strict_encode64(Net::HTTP.get(URI(image_url)))

  message = client.messages.create(
    model: "claude-opus-4-8",
    max_tokens: 1024,
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
            text: "What is in the above image?"
          }
        ]
      }
    ]
  )
  puts message

  # 选项 2：URL 引用的图片
  message_from_url = client.messages.create(
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "url",
              url: "https://upload.wikimedia.org/wikipedia/commons/a/a7/Camponotus_flavomarginatus_ant.jpg"
            }
          },
          {
            type: "text",
            text: "What is in the above image?"
          }
        ]
      }
    ]
  )
  puts message_from_url
  ```
</CodeGroup>

```json Output
{
  "id": "msg_01EcyWo6m4hyW8KHs2y2pei5",
  "type": "message",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "This image shows an ant, specifically a close-up view of an ant. The ant is shown in detail, with its distinct head, antennae, and legs clearly visible. The image is focused on capturing the intricate details and features of the ant, likely taken with a macro lens to get an extreme close-up perspective."
    }
  ],
  "model": "claude-opus-4-8",
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 1551,
    "output_tokens": 71
  }
}
```

## 工具使用和计算机使用 \{#tool-use-and-computer-use}

有关如何在 Messages API 中使用工具的示例，请参阅[工具使用指南](/docs/zh-CN/agents-and-tools/tool-use/overview)。
有关如何使用 Messages API 控制桌面计算机环境的示例，请参阅[计算机使用指南](/docs/zh-CN/agents-and-tools/tool-use/computer-use-tool)。
如需保证 JSON 输出，请参阅[结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)。
如需为完整的智能体循环设置建议性令牌预算，请设置 `output_config.task_budget`；请参阅[任务预算](/docs/zh-CN/build-with-claude/task-budgets)。