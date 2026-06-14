# 提示缓存

---

"Prompt caching"（提示缓存）通过允许从提示中的特定前缀恢复来优化您的 API 使用。这显著减少了重复性任务或具有一致元素的提示的处理时间和成本。

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

有两种方式可以启用提示缓存：

- **[自动缓存](#automatic-caching)**：在请求的顶层添加一个 `cache_control` 字段。系统会自动将缓存断点应用于最后一个可缓存的块，并随着对话的增长向前移动。最适合多轮对话，其中不断增长的消息历史应被自动缓存。
- **[显式缓存断点](#explicit-cache-breakpoints)**：直接在各个内容块上放置 `cache_control`，以精细控制具体缓存哪些内容。

最简单的入门方式是使用自动缓存：

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "cache_control": {"type": "ephemeral"},
    "system": "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.",
    "messages": [
      {
        "role": "user",
        "content": "Analyze the major themes in Pride and Prejudice."
      }
    ]
  }'
```

```bash CLI
ant messages create --transform usage <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
cache_control:
  type: ephemeral
system: >-
  You are an AI assistant tasked with analyzing literary works. Your goal is
  to provide insightful commentary on themes, characters, and writing style.
messages:
  - role: user
    content: Analyze the major themes in Pride and Prejudice.
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    cache_control={"type": "ephemeral"},
    system="You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.",
    messages=[
        {
            "role": "user",
            "content": "Analyze the major themes in 'Pride and Prejudice'.",
        }
    ],
)
print(response.usage.model_dump_json())
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  cache_control: { type: "ephemeral" },
  system:
    "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.",
  messages: [
    {
      role: "user",
      content: "Analyze the major themes in 'Pride and Prejudice'."
    }
  ]
});
console.log(response.usage);
```

```csharp C# hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    CacheControl = new CacheControlEphemeral(),
    System = "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.",
    Messages =
    [
        new()
        {
            Role = Role.User,
            Content = "Analyze the major themes in 'Pride and Prejudice'."
        }
    ]
};

var message = await client.Messages.Create(parameters);
Console.WriteLine(message.Usage);
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
		Model:        anthropic.ModelClaudeOpus4_8,
		MaxTokens:    1024,
		CacheControl: anthropic.NewCacheControlEphemeralParam(),
		System: []anthropic.TextBlockParam{
			{Text: "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style."},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Analyze the major themes in 'Pride and Prejudice'.")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response.Usage)
}
```

```java Java hidelines={1..2,4..10,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;

public class PromptCachingExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024)
        .cacheControl(CacheControlEphemeral.builder().build())
        .system("You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.")
        .addUserMessage("Analyze the major themes in 'Pride and Prejudice'.")
        .build();

    Message message = client.messages().create(params);
    System.out.println(message.usage());
  }
}
```

```php PHP hidelines={1..3,5}
<?php

use Anthropic\Client;
use Anthropic\Messages\CacheControlEphemeral;

$client = new Client();

$response = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => "Analyze the major themes in 'Pride and Prejudice'."]
    ],
    model: 'claude-opus-4-8',
    cacheControl: CacheControlEphemeral::with(),
    system: "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.",
);
echo json_encode($response->usage);
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  cache_control: {type: "ephemeral"},
  system: "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.",
  messages: [
    {
      role: "user",
      content: "Analyze the major themes in 'Pride and Prejudice'."
    }
  ]
)
puts response.usage
```
</CodeGroup>

使用自动缓存时，系统会缓存直到并包括最后一个可缓存块的所有内容。在具有相同前缀的后续请求中，缓存的内容会被自动重用。

---

## 提示缓存的工作原理 \{#how-prompt-caching-works}

当您发送启用了提示缓存的请求时：

1. 系统检查提示前缀（直到指定的缓存断点）是否已从最近的查询中缓存。
2. 如果找到，则使用缓存版本，从而减少处理时间和成本。
3. 否则，系统会处理完整的提示，并在响应开始后缓存该前缀。

这在以下情况下特别有用：
- 包含大量示例的提示
- 大量上下文或背景信息
- 具有一致指令的重复性任务
- 长时间的多轮对话

默认情况下，缓存的生命周期为 5 分钟。每次使用缓存内容时，缓存都会免费刷新。

<Note>
如果您觉得 5 分钟太短，Anthropic 还提供 1 小时的缓存持续时间，[需额外付费](#pricing)。

有关更多信息，请参阅 [1 小时缓存持续时间](#1-hour-cache-duration)。
</Note>

<Tip>
  **提示缓存会缓存完整的前缀**

提示缓存引用整个提示——`tools`、`system` 和 `messages`（按此顺序），直到并包括用 `cache_control` 指定的块。

</Tip>

---

## 定价 \{#pricing}

提示缓存引入了新的定价结构。下表显示了每个支持的模型每百万令牌的价格：

| 模型             | 基础输入令牌 | 5 分钟缓存写入 | 1 小时缓存写入 | 缓存命中与刷新 | 输出令牌 |
|-------------------|-------------------|-----------------|-----------------|----------------------|---------------|
| Claude Fable 5      | $10 / MTok        | $12.50 / MTok   | $20 / MTok      | $1 / MTok | $50 / MTok    |
| Claude Mythos 5（[限量供应](https://anthropic.com/glasswing)） | $10 / MTok        | $12.50 / MTok   | $20 / MTok      | $1 / MTok | $50 / MTok    |
| Claude Opus 4.8     | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok | $25 / MTok    |
| Claude Opus 4.7     | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok | $25 / MTok    |
| Claude Opus 4.6     | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok | $25 / MTok    |
| Claude Opus 4.5   | $5 / MTok         | $6.25 / MTok    | $10 / MTok      | $0.50 / MTok | $25 / MTok    |
| Claude Opus 4.1（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $15 / MTok        | $18.75 / MTok   | $30 / MTok      | $1.50 / MTok | $75 / MTok    |
| Claude Opus 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $15 / MTok        | $18.75 / MTok   | $30 / MTok      | $1.50 / MTok | $75 / MTok    |
| Claude Sonnet 4.6   | $3 / MTok         | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok | $15 / MTok    |
| Claude Sonnet 4.5   | $3 / MTok         | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok | $15 / MTok    |
| Claude Sonnet 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $3 / MTok         | $3.75 / MTok    | $6 / MTok       | $0.30 / MTok | $15 / MTok    |
| Claude Haiku 4.5  | $1 / MTok         | $1.25 / MTok    | $2 / MTok       | $0.10 / MTok | $5 / MTok     |
| Claude Haiku 3.5（[已停用，Bedrock 和 Vertex AI 除外](/docs/zh-CN/about-claude/model-deprecations)） | $0.80 / MTok      | $1 / MTok       | $1.60 / MTok     | $0.08 / MTok | $4 / MTok     |

<Note>
上表反映了提示缓存的以下定价乘数：
- 5 分钟缓存写入令牌的价格是基础输入令牌价格的 1.25 倍
- 1 小时缓存写入令牌的价格是基础输入令牌价格的 2 倍
- 缓存读取令牌的价格是基础输入令牌价格的 0.1 倍

这些乘数会与其他定价修饰符（如 Batch API 折扣和数据驻留）叠加。有关完整详情，请参阅[定价](/docs/zh-CN/about-claude/pricing)。
</Note>

---

## 支持的模型 \{#supported-models}

所有[活跃的 Claude 模型](/docs/zh-CN/about-claude/models/overview)均支持提示缓存（包括自动和显式两种方式）。

---

## 自动缓存 \{#automatic-caching}

自动缓存是启用提示缓存最简单的方式。无需在各个内容块上放置 `cache_control`，只需在请求正文的顶层添加一个 `cache_control` 字段。系统会自动将缓存断点应用于最后一个可缓存的块。

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "cache_control": {"type": "ephemeral"},
    "system": "You are a helpful assistant that remembers our conversation.",
    "messages": [
      {"role": "user", "content": "My name is Alex. I work on machine learning."},
      {"role": "assistant", "content": "Nice to meet you, Alex! How can I help with your ML work today?"},
      {"role": "user", "content": "What did I say I work on?"}
    ]
  }'
```

```bash CLI
ant messages create --transform usage <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
cache_control:
  type: ephemeral
system: You are a helpful assistant that remembers our conversation.
messages:
  - role: user
    content: My name is Alex. I work on machine learning.
  - role: assistant
    content: Nice to meet you, Alex! How can I help with your ML work today?
  - role: user
    content: What did I say I work on?
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    cache_control={"type": "ephemeral"},
    system="You are a helpful assistant that remembers our conversation.",
    messages=[
        {"role": "user", "content": "My name is Alex. I work on machine learning."},
        {
            "role": "assistant",
            "content": "Nice to meet you, Alex! How can I help with your ML work today?",
        },
        {"role": "user", "content": "What did I say I work on?"},
    ],
)
print(response.usage.model_dump_json())
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  cache_control: { type: "ephemeral" },
  system: "You are a helpful assistant that remembers our conversation.",
  messages: [
    { role: "user", content: "My name is Alex. I work on machine learning." },
    {
      role: "assistant",
      content: "Nice to meet you, Alex! How can I help with your ML work today?"
    },
    { role: "user", content: "What did I say I work on?" }
  ]
});
console.log(response.usage);
```

```csharp C# hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    CacheControl = new CacheControlEphemeral(),
    System = "You are a helpful assistant that remembers our conversation.",
    Messages =
    [
        new()
        {
            Role = Role.User,
            Content = "My name is Alex. I work on machine learning."
        },
        new()
        {
            Role = Role.Assistant,
            Content = "Nice to meet you, Alex! How can I help with your ML work today?"
        },
        new()
        {
            Role = Role.User,
            Content = "What did I say I work on?"
        }
    ]
};

var message = await client.Messages.Create(parameters);
Console.WriteLine(message.Usage);
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
		Model:        anthropic.ModelClaudeOpus4_8,
		MaxTokens:    1024,
		CacheControl: anthropic.NewCacheControlEphemeralParam(),
		System: []anthropic.TextBlockParam{
			{Text: "You are a helpful assistant that remembers our conversation."},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("My name is Alex. I work on machine learning.")),
			anthropic.NewAssistantMessage(anthropic.NewTextBlock("Nice to meet you, Alex! How can I help with your ML work today?")),
			anthropic.NewUserMessage(anthropic.NewTextBlock("What did I say I work on?")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response.Usage)
}
```

```java Java hidelines={1..2,4..10,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;

public class AutomaticCachingExample {

    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
                .model(Model.CLAUDE_OPUS_4_8)
                .maxTokens(1024)
                .cacheControl(CacheControlEphemeral.builder().build())
                .system("You are a helpful assistant that remembers our conversation.")
                .addUserMessage("My name is Alex. I work on machine learning.")
                .addAssistantMessage("Nice to meet you, Alex! How can I help with your ML work today?")
                .addUserMessage("What did I say I work on?")
                .build();

        Message message = client.messages().create(params);
        System.out.println(message.usage());
    }
}
```

```php PHP hidelines={1..3,5}
<?php

use Anthropic\Client;
use Anthropic\Messages\CacheControlEphemeral;

$client = new Client();

$response = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'My name is Alex. I work on machine learning.'],
        ['role' => 'assistant', 'content' => 'Nice to meet you, Alex! How can I help with your ML work today?'],
        ['role' => 'user', 'content' => 'What did I say I work on?'],
    ],
    model: 'claude-opus-4-8',
    cacheControl: CacheControlEphemeral::with(),
    system: 'You are a helpful assistant that remembers our conversation.',
);
echo json_encode($response->usage);
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  cache_control: {type: "ephemeral"},
  system: "You are a helpful assistant that remembers our conversation.",
  messages: [
    {role: "user", content: "My name is Alex. I work on machine learning."},
    {role: "assistant", content: "Nice to meet you, Alex! How can I help with your ML work today?"},
    {role: "user", content: "What did I say I work on?"}
  ]
)
puts response.usage
```
</CodeGroup>

### 自动缓存在多轮对话中的工作原理 \{#how-automatic-caching-works-in-multi-turn-conversations}

使用自动缓存时，缓存点会随着对话的增长自动向前移动。每个新请求都会缓存直到最后一个可缓存块的所有内容，而之前的内容则从缓存中读取。

| 请求 | 内容 | 缓存行为 |
|---------|---------|----------------|
| 请求 1 | System <br/> + User(1) + Asst(1) <br/> + **User(2)** ◀ 缓存 | 所有内容写入缓存 |
| 请求 2 | System <br/> + User(1) + Asst(1) <br/> + User(2) + Asst(2) <br/> + **User(3)** ◀ 缓存 | System 到 User(2) 从缓存读取；<br/> Asst(2) + User(3) 写入缓存 |
| 请求 3 | System <br/> + User(1) + Asst(1) <br/> + User(2) + Asst(2) <br/> + User(3) + Asst(3) <br/> + **User(4)** ◀ 缓存 | System 到 User(3) 从缓存读取；<br/> Asst(3) + User(4) 写入缓存 |

缓存断点会自动移动到每个请求中的最后一个可缓存块，因此随着对话的增长，您无需更新任何 `cache_control` 标记。

### TTL 支持 \{#ttl-support}

默认情况下，自动缓存使用 5 分钟的 TTL。您可以指定 1 小时的 TTL，价格为基础输入令牌价格的 2 倍：

```json
{ "cache_control": { "type": "ephemeral", "ttl": "1h" } }
```

### 与块级缓存结合使用 \{#combining-with-block-level-caching}

自动缓存与[显式缓存断点](#explicit-cache-breakpoints)兼容。当两者一起使用时，自动缓存断点会占用 4 个可用断点槽位中的一个。

这使您可以结合两种方法。例如，使用显式断点缓存您的系统提示，同时让自动缓存处理对话：

```json
{
  "model": "claude-opus-4-8",
  "max_tokens": 1024,
  "cache_control": { "type": "ephemeral" },
  "system": [
    {
      "type": "text",
      "text": "You are a helpful assistant.",
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [{ "role": "user", "content": "What are the key terms?" }]
}
```

### 保持不变的部分 \{#what-stays-the-same}

自动缓存使用相同的底层缓存基础设施。定价、最小令牌阈值、上下文排序要求以及 20 块回溯窗口的应用方式均与显式断点相同。

### 边缘情况 \{#edge-cases}

- 如果最后一个块已经具有相同 TTL 的显式 `cache_control`，则自动缓存不执行任何操作。
- 如果最后一个块具有不同 TTL 的显式 `cache_control`，API 会返回 400 错误。
- 如果已存在 4 个显式块级断点，API 会返回 400 错误（没有剩余槽位用于自动缓存）。
- 如果最后一个块不符合作为自动缓存断点目标的条件，系统会静默地向后查找最近的符合条件的块。如果未找到，则跳过缓存。

<Note>
自动缓存在 Claude API、[Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)（测试版）上可用。Bedrock 和 Vertex AI 不支持自动缓存。
</Note>

---

## 显式缓存断点 \{#explicit-cache-breakpoints}

如需对缓存进行更多控制，您可以直接在各个内容块上放置 `cache_control`。当您需要缓存以不同频率变化的不同部分，或需要精细控制具体缓存哪些内容时，这非常有用。

### 构建您的提示 \{#structuring-your-prompt}

将静态内容（工具定义、系统指令、上下文、示例）放在提示的开头。使用 `cache_control` 参数标记可重用内容的结尾以进行缓存。

缓存前缀按以下顺序创建：`tools`、`system`，然后是 `messages`。此顺序形成一个层次结构，每个级别都建立在前一个级别之上。

#### 自动前缀检查的工作原理 \{#how-automatic-prefix-checking-works}

您可以只在静态内容的末尾使用一个缓存断点，系统会自动查找先前请求已写入缓存的最长前缀。了解其工作原理有助于您优化缓存策略。

**三个核心原则：**

1. **缓存写入仅发生在您的断点处。** 用 `cache_control` 标记一个块只会写入一个缓存条目：以该块结尾的前缀的哈希值。系统不会为任何更早的位置写入条目。由于哈希是累积的，涵盖直到并包括断点的所有内容，因此更改断点处或之前的任何块都会在下一个请求中产生不同的哈希。

2. **缓存读取会向后查找先前请求写入的条目。** 在每个请求中，系统会计算您断点处的前缀哈希，并检查是否有匹配的缓存条目。如果不存在，系统会一次向后移动一个块，检查每个更早位置的前缀哈希是否与缓存中已有的内容匹配。它查找的是先前的写入，而不是稳定的内容。

3. **回溯窗口为 20 个块。** 系统每个断点最多检查 20 个位置，将断点本身计为第一个。如果系统在该窗口内未找到匹配的条目，检查将停止（或从下一个显式断点恢复，如果有的话）。

**示例：不断增长的对话中的回溯**

您每轮追加新块，并在每个请求的最后一个块上设置 `cache_control`：

- **第 1 轮：** 10 个块，断点在块 10。不存在先前的缓存条目。系统在块 10 处写入一个条目。
- **第 2 轮：** 15 个块，断点在块 15。块 15 没有条目，因此系统向后回溯到块 10 并找到第 1 轮的条目。在块 10 处缓存命中；系统仅重新处理块 11 到 15，并在块 15 处写入新条目。
- **第 3 轮：** 35 个块，断点在块 35。系统检查 20 个位置（块 35 到 16），未找到任何内容。第 2 轮在块 15 处的条目位于窗口外一个位置，因此没有缓存命中。在块 15 处添加第二个断点会在那里启动第二个回溯窗口，从而找到第 2 轮的条目。

**常见错误：断点位于每次请求都会变化的内容上**

您的提示有一个大型静态系统上下文（块 1 到 5），后面跟着一个包含时间戳和用户消息的每请求块（块 6）。您在块 6 上设置 `cache_control`：

- **请求 1：** 在块 6 处缓存写入。哈希包含时间戳。
- **请求 2：** 时间戳不同，因此块 6 处的前缀哈希不同。回溯遍历块 5、4、3、2 和 1，但系统从未在这些位置写入过条目。没有缓存命中。您每次请求都要为新的缓存写入付费，却从未获得读取。

回溯不会找到断点后面的稳定内容并将其缓存。它查找的是先前请求已写入的条目，而写入仅发生在断点处。将 `cache_control` 移到块 5（跨请求保持不变的最后一个块），后续每个请求都会读取缓存的前缀。[自动缓存](#automatic-caching)也会遇到同样的陷阱：它将断点放在最后一个可缓存块上，而在这种结构中，该块正是每次请求都会变化的块，因此请改用块 5 上的显式断点。

**关键要点：** 将 `cache_control` 放在您希望共享缓存的请求之间前缀完全相同的最后一个块上。在不断增长的对话中，只要每轮添加的块少于 20 个，最后一个块就可以正常工作：较早的内容从不改变，因此下一个请求的回溯会找到先前的写入。对于具有可变后缀（时间戳、每请求上下文、传入消息）的提示，请将断点放在静态前缀的末尾，而不是可变块上。

#### 何时使用多个断点 \{#when-to-use-multiple-breakpoints}

如果您希望执行以下操作，可以定义最多 4 个缓存断点：
- 缓存以不同频率变化的不同部分（例如，工具很少变化，但上下文每天更新）
- 对具体缓存哪些内容有更多控制
- 当不断增长的对话将您的断点推到距上次缓存写入 20 个或更多块之外时，确保缓存命中

<Note>
**重要限制：** 回溯只能找到先前请求已写入的条目。如果不断增长的对话将您的断点推到距上次写入 20 个或更多块之外，回溯窗口就会错过它。从一开始就在靠近该位置的地方添加第二个断点，以便在您需要之前就在那里累积写入。
</Note>

### 了解缓存断点成本 \{#understanding-cache-breakpoint-costs}

**缓存断点本身不会增加任何成本。** 您只需为以下内容付费：
- **缓存写入**：当新内容写入缓存时（5 分钟 TTL 的价格比基础输入令牌高 25%）
- **缓存读取**：当使用缓存内容时（基础输入令牌价格的 10%）
- **常规输入令牌**：用于任何未缓存的内容

添加更多 `cache_control` 断点不会增加您的成本——您仍然根据实际缓存和读取的内容支付相同的金额。断点只是让您能够控制哪些部分可以独立缓存。

---

## 缓存策略和注意事项 \{#caching-strategies-and-considerations}

### 缓存限制 \{#cache-limitations}

在 Claude API、[Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws)、[Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)（测试版）上，最小可缓存提示长度为：

- Claude Fable 5 和 [Claude Mythos 5](https://anthropic.com/glasswing) 为 512 个令牌
- [Claude Mythos Preview](https://anthropic.com/glasswing) 和 Claude Opus 4.7 为 2,048 个令牌
- Claude Opus 4.6 和 Claude Opus 4.5 为 4,096 个令牌
- Claude Opus 4.8、Claude Sonnet 4.6、Claude Sonnet 4.5、Claude Opus 4.1（[已弃用](/docs/zh-CN/about-claude/model-deprecations)）、Claude Opus 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)）和 Claude Sonnet 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)）为 1,024 个令牌
- Claude Haiku 4.5 为 4,096 个令牌
- Claude Haiku 3.5（[已停用，Vertex AI 除外](/docs/zh-CN/about-claude/model-deprecations)）为 2,048 个令牌

模型可用性因平台而异，新发布模型的最小值也可能不同：在 [Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock) 上，Claude Fable 5 和 Claude Mythos 5 的最小可缓存提示长度为 1,024 个令牌。

较短的提示无法缓存，即使标记了 `cache_control`。任何缓存少于此令牌数的请求都将在不缓存的情况下处理，且不会返回错误。要验证提示是否已缓存，请检查响应的 usage [字段](/docs/zh-CN/build-with-claude/prompt-caching#tracking-cache-performance)：如果 `cache_creation_input_tokens` 和 `cache_read_input_tokens` 均为 0，则提示未被缓存（可能是因为未达到最小长度要求）。

如果您的提示略低于您的模型和平台的最小值，扩展缓存内容以达到阈值通常是值得的。缓存读取的成本远低于未缓存的输入令牌，因此达到最小值可以降低频繁重用的提示的成本。

<Note>
[Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock) 是由 AWS 运营的平台。在 Bedrock 上，请参阅 [Bedrock 提示缓存文档](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html)，了解适用的每模型最小值、失败行为和 usage 字段名称。
</Note>

对于并发请求，请注意缓存条目仅在第一个响应开始后才可用。如果您需要并行请求的缓存命中，请等待第一个响应后再发送后续请求。

目前，"ephemeral" 是唯一支持的缓存类型，默认生命周期为 5 分钟。

### 可以缓存的内容 \{#what-can-be-cached}
请求中的大多数块都可以缓存。这包括：

- 工具：`tools` 数组中的工具定义
- 系统消息：`system` 数组中的内容块
- 文本消息：`messages.content` 数组中的内容块，适用于用户和助手轮次
- 图像和文档：`messages.content` 数组中的内容块，在用户轮次中
- 工具使用和工具结果：`messages.content` 数组中的内容块，在用户和助手轮次中

这些元素中的每一个都可以缓存，可以自动缓存，也可以通过用 `cache_control` 标记它们来缓存。

### 无法缓存的内容 \{#what-cannot-be-cached}
虽然大多数请求块都可以缓存，但也有一些例外：

- 思考块不能直接用 `cache_control` 缓存。但是，当思考块出现在先前的助手轮次中时，它们可以与其他内容一起缓存。以这种方式缓存时，从缓存读取时它们确实会计为输入令牌。
- 子内容块（如[引用](/docs/zh-CN/build-with-claude/citations)）本身不能直接缓存。请改为缓存顶层块。

    对于引用，作为引用源材料的顶层文档内容块可以被缓存。这使您可以通过缓存引用将引用的文档来有效地将提示缓存与引用结合使用。
- 空文本块无法缓存。

### 什么会使缓存失效 \{#what-invalidates-the-cache}

对缓存内容的修改可能会使部分或全部缓存失效。

如[构建您的提示](#structuring-your-prompt)中所述，缓存遵循以下层次结构：`tools` → `system` → `messages`。每个级别的更改都会使该级别及所有后续级别失效。

下表显示了不同类型的更改会使缓存的哪些部分失效。✘ 表示缓存失效，而 ✓ 表示缓存保持有效。

| 更改内容 | 工具缓存 | 系统缓存 | 消息缓存 | 影响 |
|------------|------------------|---------------|----------------|-------------|
| **工具定义** | ✘ | ✘ | ✘ | 修改工具定义（名称、描述、参数）会使整个缓存失效 |
| **网络搜索开关** | ✓ | ✘ | ✘ | 启用/禁用网络搜索会修改系统提示 |
| **引用开关** | ✓ | ✘ | ✘ | 启用/禁用引用会修改系统提示 |
| **速度设置** | ✓ | ✘ | ✘ | 在 [`speed: "fast"` 和标准速度](/docs/zh-CN/build-with-claude/fast-mode)之间切换会使系统和消息缓存失效 |
| **工具选择** | ✓ | ✓ | ✘ | 对 `tool_choice` 参数的更改仅影响消息块 |
| **图像** | ✓ | ✓ | ✘ | 在提示中的任何位置添加/删除图像会影响消息块 |
| **思考参数** | ✓ | ✓ | ✘ | 对扩展思考设置（启用/禁用、预算）的更改会影响消息块 |
| **传递给扩展思考请求的非工具结果** | ✓ | ✓ | 因模型而异 | 在 Opus 4.5+ 和 Sonnet 4.6+ 上，思考块默认保留，因此缓存保持有效（✓）。在较早的 Opus/Sonnet 模型和所有 Haiku 模型上，所有先前缓存的思考块都会从上下文中剥离，并且这些思考块之后的任何消息都会从缓存中删除（✘）。有关更多详情，请参阅[使用思考块进行缓存](#caching-with-thinking-blocks)。 |

<Note>
在 Claude Opus 4.8 上，您可以在对话中途添加新的系统指令，而不会使系统或消息缓存失效。将 `{"role": "system"}` 消息追加到 `messages` 中，而不是编辑顶层 `system` 字段，这样缓存的前缀保持不变。请参阅[对话中途系统消息](/docs/zh-CN/build-with-claude/mid-conversation-system-messages)。
</Note>

### 跟踪缓存性能 \{#tracking-cache-performance}

使用响应中 `usage` 内的以下 API 响应字段（如果使用[流式传输](/docs/zh-CN/build-with-claude/streaming)，则为 `message_start` 事件）来监控缓存性能：

- `cache_creation_input_tokens`：创建新条目时写入缓存的令牌数。
- `cache_read_input_tokens`：此请求从缓存中检索的令牌数。
- `input_tokens`：未从缓存读取或用于创建缓存的输入令牌数（即最后一个缓存断点之后的令牌）。

<Note>
**了解令牌分解**

`input_tokens` 字段仅表示请求中**最后一个缓存断点之后**的令牌——而不是您发送的所有输入令牌。

要计算总输入令牌数：
```text
total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens
```

**空间解释：**
- `cache_read_input_tokens` = 断点之前已缓存的令牌（读取）
- `cache_creation_input_tokens` = 断点之前正在缓存的令牌（写入）
- `input_tokens` = 最后一个断点之后的令牌（不符合缓存条件）

**示例：** 如果您的请求包含 100,000 个缓存内容令牌（从缓存读取）、0 个正在缓存的新内容令牌，以及用户消息中的 50 个令牌（在缓存断点之后）：
- `cache_read_input_tokens`：100,000
- `cache_creation_input_tokens`：0
- `input_tokens`：50
- **处理的总输入令牌数**：100,050 个令牌

这对于理解成本和速率限制都很重要，因为在有效使用缓存时，`input_tokens` 通常会远小于您的总输入。
</Note>

### 使用思考块进行缓存 \{#caching-with-thinking-blocks}

当将[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)与提示缓存结合使用时，思考块具有特殊行为：

**与其他内容一起自动缓存**：虽然思考块不能显式地用 `cache_control` 标记，但当您使用工具结果进行后续 API 调用时，它们会作为请求内容的一部分被缓存。这通常发生在工具使用期间，当您将思考块传回以继续对话时。

**输入令牌计数**：当从缓存读取思考块时，它们在您的使用指标中计为输入令牌。这对于成本计算和令牌预算很重要。

**缓存失效模式**：
- 当仅提供工具结果作为用户消息时，缓存保持有效
- 在 Opus 4.5+ 和 Sonnet 4.6+ 上，即使添加了非工具结果的用户内容，思考块也默认保留，因此缓存保持有效
- 在较早的 Opus/Sonnet 模型和所有 Haiku 模型上，当添加非工具结果的用户内容时，缓存会失效，导致所有先前的思考块从上下文中剥离
- 即使没有显式的 `cache_control` 标记，也会发生这种缓存行为

有关缓存失效的更多详情，请参阅[什么会使缓存失效](#what-invalidates-the-cache)。

**工具使用示例**：
```text
Request 1: User: "What's the weather in Paris?"
Response: [thinking_block_1] + [tool_use block 1]

Request 2:
User: ["What's the weather in Paris?"],
Assistant: [thinking_block_1] + [tool_use block 1],
User: [tool_result_1, cache=True]
Response: [thinking_block_2] + [text block 2]
# Request 2 caches its request content (not the response)
# The cache includes: user message, thinking_block_1, tool_use block 1, and tool_result_1

Request 3:
User: ["What's the weather in Paris?"],
Assistant: [thinking_block_1] + [tool_use block 1],
User: [tool_result_1, cache=True],
Assistant: [thinking_block_2] + [text block 2],
User: [Text response, cache=True]
# On earlier Opus/Sonnet and all Haiku models, non-tool-result user block causes prior thinking blocks to be stripped; on Opus 4.5+/Sonnet 4.6+ they are kept
```

在较早的 Opus/Sonnet 模型和所有 Haiku 模型上，此时所有先前的思考块都会从上下文中删除。在 Opus 4.5+ 和 Sonnet 4.6+ 上，先前的思考块默认保留，并仍然是缓存前缀的一部分。

有关更详细的信息，请参阅[扩展思考文档](/docs/zh-CN/build-with-claude/extended-thinking#understanding-thinking-block-caching-behavior)。

### 缓存存储和共享 \{#cache-storage-and-sharing}

<Warning>
自 2026 年 2 月 5 日起，提示缓存使用[工作区](/docs/zh-CN/manage-claude/workspaces)级隔离，而不是组织级隔离。缓存按工作区隔离，确保同一组织内工作区之间的数据分离。这适用于 Claude API、Claude Platform on AWS 和 Microsoft Foundry（测试版）；Bedrock 和 Vertex AI 保持组织级缓存隔离。如果您使用多个工作区，请审查您的缓存策略以考虑此差异。
</Warning>

- **组织和工作区隔离：** 缓存在组织之间是隔离的。不同的组织永远不会共享缓存，即使它们使用相同的提示。自 2026 年 2 月 5 日起，在 Claude API、Claude Platform on AWS 和 Microsoft Foundry（测试版）上，缓存在组织内也按工作区隔离；Bedrock 和 Vertex AI 继续仅使用组织级隔离。

- **精确匹配：** 缓存命中需要 100% 相同的提示段，包括直到并包括用 cache control 标记的块的所有文本和图像。

- **输出令牌生成：** 提示缓存对输出令牌生成没有影响。您收到的响应与未使用提示缓存时收到的响应完全相同。

### 有效缓存的最佳实践 \{#best-practices-for-effective-caching}

要优化提示缓存性能：

- 对于多轮对话，从[自动缓存](#automatic-caching)开始。它会自动处理断点管理。
- 当您需要以不同的变化频率缓存不同部分时，使用[显式块级断点](#explicit-cache-breakpoints)。
- 缓存稳定、可重用的内容，如系统指令、背景信息、大型上下文或常用工具定义。
- 将缓存内容放在提示的开头以获得最佳性能。
- 策略性地使用缓存断点来分隔不同的可缓存前缀部分。
- 将断点放在跨请求保持完全相同的最后一个块上。对于具有静态前缀和可变后缀（时间戳、每请求上下文、传入消息）的提示，该位置是前缀的末尾，而不是可变块。
- 定期分析缓存命中率并根据需要调整您的策略。

### 针对不同用例进行优化 \{#optimizing-for-different-use-cases}

根据您的场景定制提示缓存策略：

- 对话代理：降低扩展对话的成本和延迟，特别是那些具有长指令或上传文档的对话。
- 编码助手：通过在提示中保留代码库的相关部分或摘要版本来改进自动完成和代码库问答。
- 大型文档处理：在提示中包含完整的长篇材料（包括图像），而不会增加响应延迟。
- 详细指令集：共享大量指令、程序和示例列表以微调 Claude 的响应。开发人员通常在提示中包含一两个示例，但通过提示缓存，您可以通过包含 20 多个高质量答案的多样化示例来获得更好的性能。
- 代理式工具使用：提高涉及多个工具调用和迭代代码更改的场景的性能，其中每个步骤通常需要新的 API 调用。
- 与书籍、论文、文档、播客转录和其他长篇内容对话：通过将整个文档嵌入提示中并让用户向其提问，使任何知识库变得生动。

### 常见问题排查 \{#troubleshooting-common-issues}

如果遇到意外行为：

<Tip>
[缓存诊断](/docs/zh-CN/build-with-claude/cache-diagnostics)（测试版）让 API 比较连续的请求并准确报告提示前缀在何处出现分歧，这会自动处理此列表中的许多步骤。
</Tip>

- 确保缓存部分在各次调用之间完全相同。对于显式断点，验证 `cache_control` 标记位于相同位置
- 检查调用是否在缓存生命周期内进行（默认为 5 分钟）
- 验证 `tool_choice` 和图像使用在各次调用之间保持一致
- 验证您缓存的令牌数至少达到您的模型和平台的最小值（请参阅[缓存限制](#cache-limitations)）
- 确认您的断点位于跨请求保持完全相同的块上。缓存写入仅发生在断点处，如果该块发生变化（时间戳、每请求上下文、传入消息），前缀哈希永远不会匹配。回溯不会找到断点后面的稳定内容；它只会找到先前请求在其自己的断点处写入的条目
- 验证您的 `tool_use` 内容块中的键具有稳定的排序，因为某些语言（例如 Swift、Go）在 JSON 转换期间会随机化键顺序，从而破坏缓存
- 使用[缓存诊断](/docs/zh-CN/build-with-claude/cache-diagnostics)让 API 比较连续的请求并报告提示的哪个部分出现了分歧

<Note>
对 `tool_choice` 的更改或提示中任何位置图像的存在/缺失都会使缓存失效，需要创建新的缓存条目。有关缓存失效的更多详情，请参阅[什么会使缓存失效](#what-invalidates-the-cache)。
</Note>

---
## 1 小时缓存持续时间 \{#1-hour-cache-duration}

如果您觉得 5 分钟太短，Anthropic 还提供 1 小时的缓存持续时间，[需额外付费](#pricing)。

<Note>
1 小时缓存持续时间在 Claude API、[Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws)、[Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)、[Amazon Bedrock（旧版）](/docs/zh-CN/build-with-claude/claude-on-amazon-bedrock-legacy)、[Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)（测试版）上可用。
</Note>

要使用扩展缓存，请在 `cache_control` 定义中包含 `ttl`，如下所示：
```json hidelines={1,-1}
{
  "cache_control": {
    "type": "ephemeral",
    "ttl": "1h"
  }
}
```

响应将包含详细的缓存信息，如下所示：
```json Output
{
  "usage": {
    "input_tokens": 2048,
    "cache_read_input_tokens": 1800,
    "cache_creation_input_tokens": 248,
    "output_tokens": 503,

    "cache_creation": {
      "ephemeral_5m_input_tokens": 148,
      "ephemeral_1h_input_tokens": 100
    }
  }
}
```

请注意，当前的 `cache_creation_input_tokens` 字段等于 `cache_creation` 对象中各值的总和。

### 何时使用 1 小时缓存 \{#when-to-use-the-1-hour-cache}

如果您的提示以固定节奏使用（即系统提示的使用频率高于每 5 分钟一次），请继续使用 5 分钟缓存，因为它会继续免费刷新。

1 小时缓存最适合以下场景：
- 当您的提示使用频率可能低于每 5 分钟一次，但高于每小时一次时。例如，当代理式子代理需要超过 5 分钟时，或者当存储与用户的长聊天对话且您通常预期该用户可能不会在接下来的 5 分钟内响应时。
- 当延迟很重要且您的后续提示可能在 5 分钟之后发送时。
- 当您希望提高速率限制利用率时，因为缓存命中不会从您的速率限制中扣除。

<Note>
5 分钟和 1 小时缓存在延迟方面的行为相同。对于长文档，您通常会看到首个令牌时间的改善。
</Note>

### 混合使用不同的 TTL \{#mixing-different-ttls}

您可以在同一请求中同时使用 1 小时和 5 分钟缓存控制，但有一个重要约束：TTL 较长的缓存条目必须出现在 TTL 较短的条目之前（即 1 小时缓存条目必须出现在任何 5 分钟缓存条目之前）。

当混合使用 TTL 时，API 会在您的提示中确定三个计费位置：
1. 位置 `A`：最高缓存命中处的令牌计数（如果没有命中则为 0）。
2. 位置 `B`：`A` 之后最高的 1 小时 `cache_control` 块处的令牌计数（如果不存在则等于 `A`）。
3. 位置 `C`：最后一个 `cache_control` 块处的令牌计数。

<Note>
如果 `B` 和/或 `C` 大于 `A`，它们必然是缓存未命中，因为 `A` 是最高的缓存命中。
</Note>

您将被收取以下费用：
1. `A` 的缓存读取令牌。
2. `(B - A)` 的 1 小时缓存写入令牌。
3. `(C - B)` 的 5 分钟缓存写入令牌。

以下是 3 个示例。这描绘了 3 个请求的输入令牌，每个请求都有不同的缓存命中和缓存未命中。因此，每个请求都有不同的计算定价，如彩色框中所示。
![混合 TTL 图表](/docs/images/prompt-cache-mixed-ttl.svg)

---
## 预热缓存 \{#pre-warming-the-cache}

缓存预热让您可以在用户触发真实请求之前将系统提示或工具定义加载到提示缓存中。这消除了首次用户交互时的缓存未命中延迟惩罚，减少了对延迟敏感的应用程序的首个令牌时间（TTFT）。

### 工作原理 \{#how-it-works}

在您的请求中设置 `max_tokens: 0`。API 会将您的提示读入模型，并在任何 `cache_control` 断点处写入缓存，然后立即返回而不生成任何输出。响应具有空的 `content` 数组、`stop_reason: "max_tokens"` 以及完整填充的 `usage` 块。

将 `cache_control` 断点放在与后续请求共享的最后一个块上（通常是您的系统提示或工具定义），而不是占位符用户消息上。否则，缓存条目会以占位符为键，后续请求将无法命中它。这意味着使用[显式缓存断点](#explicit-cache-breakpoints)而不是[自动缓存](#automatic-caching)，因为自动缓存会将断点放在最后一个块上，而在这里该块是占位符。占位符用户消息可以是任何包含非空白内容的字符串（此处的示例使用 `"warmup"`）；其内容会被读入模型但永远不会被回答。

<Note>
如果前缀尚未缓存，预热请求会产生**缓存写入**费用，与任何其他请求相同。检查响应中的 `usage.cache_creation_input_tokens` 以确认发生了写入。不会对输出令牌计费。
</Note>

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 0,
    "system": [
      {
        "type": "text",
        "text": "You are an expert software engineer with deep knowledge of distributed systems...",
        "cache_control": {"type": "ephemeral"}
      }
    ],
    "messages": [{"role": "user", "content": "warmup"}]
  }'
```

```bash CLI
ant messages create \
  --transform '{stop_reason,content,usage}' --format yaml <<'YAML'
model: claude-opus-4-8
max_tokens: 0
system:
  - type: text
    text: >-
      You are an expert software engineer with deep knowledge of
      distributed systems...
    cache_control:
      type: ephemeral
messages:
  - role: user
    content: warmup
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

# 在用户到达之前触发此操作，以预热共享的系统提示缓存。
prewarm = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=0,
    system=[
        {
            "type": "text",
            "text": "You are an expert software engineer with deep knowledge of distributed systems...",
            "cache_control": {"type": "ephemeral"},
        }
    ],
    messages=[{"role": "user", "content": "warmup"}],
)
print(prewarm.stop_reason)  # "max_tokens"
print(prewarm.content)  # []
print(prewarm.usage)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// 在用户到达之前触发此操作，以预热共享的系统提示缓存。
const prewarm = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 0,
  system: [
    {
      type: "text",
      text: "You are an expert software engineer with deep knowledge of distributed systems...",
      cache_control: { type: "ephemeral" }
    }
  ],
  messages: [{ role: "user", content: "warmup" }]
});
console.log(prewarm.stop_reason); // "max_tokens"
console.log(prewarm.content); // []
console.log(prewarm.usage);
```

```csharp C# hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var prewarm = await client.Messages.Create(
    new()
    {
        Model = Model.ClaudeOpus4_8,
        MaxTokens = 0,
        System = new(
            [
                new TextBlockParam
                {
                    Text = "You are an expert software engineer with deep knowledge of distributed systems...",
                    CacheControl = new(),
                },
            ]
        ),
        Messages = [new() { Role = Role.User, Content = "warmup" }],
    }
);

Console.WriteLine(prewarm.StopReason?.Raw()); // "max_tokens"
Console.WriteLine(prewarm.Content.Count); // 0
Console.WriteLine(prewarm.Usage);
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

	prewarm, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 0,
		System: []anthropic.TextBlockParam{
			{
				Text:         "You are an expert software engineer with deep knowledge of distributed systems...",
				CacheControl: anthropic.NewCacheControlEphemeralParam(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("warmup")),
		},
	})
	if err != nil {
		panic(err)
	}

	fmt.Println(prewarm.StopReason) // "max_tokens"
	fmt.Println(prewarm.Content)    // []
	fmt.Println(prewarm.Usage.RawJSON())
}
```

```java Java hidelines={1..9,-1..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    Message prewarm = client.messages().create(MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(0)
            .systemOfTextBlockParams(List.of(TextBlockParam.builder()
                    .text("You are an expert software engineer with deep knowledge of distributed systems...")
                    .cacheControl(CacheControlEphemeral.builder().build())
                    .build()))
            .addUserMessage("warmup")
            .build());

    IO.println(prewarm.stopReason()); // Optional[max_tokens]
    IO.println(prewarm.content());    // []
    IO.println(prewarm.usage());
}
```

```php PHP hidelines={1..5}
<?php

use Anthropic\Client;
use Anthropic\Messages\Model;

$client = new Client();

$prewarm = $client->messages->create(
    model: Model::CLAUDE_OPUS_4_8,
    maxTokens: 0,
    system: [
        [
            'type' => 'text',
            'text' => 'You are an expert software engineer with deep knowledge of distributed systems...',
            'cache_control' => ['type' => 'ephemeral'],
        ],
    ],
    messages: [['role' => 'user', 'content' => 'warmup']],
);

echo $prewarm->stopReason->value, PHP_EOL; // "max_tokens"
echo json_encode($prewarm->content), PHP_EOL; // []
echo json_encode($prewarm->usage), PHP_EOL;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

prewarm = client.messages.create(
  model: Anthropic::Model::CLAUDE_OPUS_4_8,
  max_tokens: 0,
  system_: [
    {
      type: "text",
      text: "You are an expert software engineer with deep knowledge of distributed systems...",
      cache_control: {type: "ephemeral"}
    }
  ],
  messages: [{role: "user", content: "warmup"}]
)

puts prewarm.stop_reason # :max_tokens
puts prewarm.content # []
puts prewarm.usage
```

</CodeGroup>

API 返回一个空的 `content` 数组：

```json Output
{
  "id": "msg_01XFDUDYJgAACzvnptvVoYEL",
  "type": "message",
  "role": "assistant",
  "content": [],
  "model": "claude-opus-4-8",
  "stop_reason": "max_tokens",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 8,
    "cache_creation_input_tokens": 5120,
    "cache_read_input_tokens": 0,
    "cache_creation": {
      "ephemeral_5m_input_tokens": 5120,
      "ephemeral_1h_input_tokens": 0
    },
    "iterations": [
      {
        "input_tokens": 8,
        "output_tokens": 0,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 5120,
        "cache_creation": {
          "ephemeral_5m_input_tokens": 5120,
          "ephemeral_1h_input_tokens": 0
        },
        "type": "message"
      }
    ],
    "output_tokens": 0,
    "service_tier": "standard",
    "inference_geo": "global"
  }
}
```

### 典型使用模式 \{#typical-usage-pattern}

在应用程序启动时（或按计划的时间间隔）发出预热请求，然后在预热完成后发送真实的用户请求：

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

SYSTEM_PROMPT = [
    {
        "type": "text",
        "text": "You are an expert software engineer with deep knowledge of distributed systems...",
        "cache_control": {"type": "ephemeral"},
    }
]


def prewarm_cache() -> None:
    """Call this at application startup or on a scheduled interval."""
    client.messages.create(
        model="claude-opus-4-8",
        max_tokens=0,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": "warmup"}],
    )


def respond(user_message: str) -> anthropic.types.Message:
    """The real user request; benefits from a warm cache."""
    return client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_message}],
    )


# 在任何用户流量到达之前预热缓存。
prewarm_cache()

# 之后，当用户提交消息时，系统提示前缀已被缓存。
response = respond("How do I implement a binary search tree?")
print(response.content[0].text)
```

请记住，缓存 TTL 仍然适用。对于默认的 5 分钟缓存，至少每 5 分钟发送一次新的预热请求以保持缓存处于预热状态。对于用户请求之间间隔较长的情况，请改用 [1 小时缓存持续时间](#1-hour-cache-duration)。

### 限制 \{#limitations}

如果设置了以下任何一项，`max_tokens: 0` 请求将被拒绝并返回 `invalid_request_error`，因为每一项都意味着需要生成输出，而零令牌预算无法产生输出：

- `stream: true`
- [扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)（`thinking.type: "enabled"`）
- [结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)（`output_config.format`）
- `tool_choice` 为 `{"type": "tool", ...}` 或 `{"type": "any"}`

在 [Message Batches](/docs/zh-CN/build-with-claude/batch-processing)（消息批处理）请求中，`max_tokens: 0` 同样会被拒绝。预热（pre-warming）针对的是首个令牌的响应时间，这不适用于批处理；而且在批处理期间写入的缓存条目很可能在后续请求运行之前就已过期。

### 替代 max_tokens=1 的变通方法 \{#replacing-the-max-tokens-1-workaround}

在 `max_tokens: 0` 可用之前，一些应用程序使用 `max_tokens: 1` 的预热调用来实现相同的效果。推荐使用 `max_tokens: 0` 方法：不会产生任何输出，因此无需丢弃单令牌回复，不会对输出令牌计费，并且请求的意图明确无歧义。

---
## 提示缓存示例 \{#prompt-caching-examples}

为了帮助您开始使用提示缓存，[提示缓存 cookbook](https://platform.claude.com/cookbook/misc-prompt-caching) 提供了详细的示例和最佳实践。

以下代码片段展示了各种提示缓存模式。这些示例演示了如何在不同场景中实现缓存，帮助您理解此功能的实际应用：

<section title="大型上下文缓存示例">

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "system": [
        {
            "type": "text",
            "text": "You are an AI assistant tasked with analyzing legal documents."
        },
        {
            "type": "text",
            "text": "Here is the full text of a complex legal agreement: [Insert full text of a 50-page legal agreement here]",
            "cache_control": {"type": "ephemeral"}
        }
    ],
    "messages": [
        {
            "role": "user",
            "content": "What are the key terms and conditions in this agreement?"
        }
    ]
}'
```

```bash CLI
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
system:
  - type: text
    text: You are an AI assistant tasked with analyzing legal documents.
  - type: text
    text: >-
      Here is the full text of a complex legal agreement:
      [Insert full text of a 50-page legal agreement here]
    cache_control:
      type: ephemeral
messages:
  - role: user
    content: What are the key terms and conditions in this agreement?
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": "You are an AI assistant tasked with analyzing legal documents.",
        },
        {
            "type": "text",
            "text": "Here is the full text of a complex legal agreement: [Insert full text of a 50-page legal agreement here]",
            "cache_control": {"type": "ephemeral"},
        },
    ],
    messages=[
        {
            "role": "user",
            "content": "What are the key terms and conditions in this agreement?",
        }
    ],
)
print(response.usage.model_dump_json())
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  system: [
    {
      type: "text",
      text: "You are an AI assistant tasked with analyzing legal documents."
    },
    {
      type: "text",
      text: "Here is the full text of a complex legal agreement: [Insert full text of a 50-page legal agreement here]",
      cache_control: { type: "ephemeral" }
    }
  ],
  messages: [
    {
      role: "user",
      content: "What are the key terms and conditions in this agreement?"
    }
  ]
});
console.log(response);
```

```csharp C# hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new()
{
    ApiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY")
};

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    System = new MessageCreateParamsSystem(new List<TextBlockParam>
    {
        new TextBlockParam()
        {
            Text = "You are an AI assistant tasked with analyzing legal documents.",
        },
        new TextBlockParam()
        {
            Text = "Here is the full text of a complex legal agreement: [Insert full text of a 50-page legal agreement here]",
            CacheControl = new CacheControlEphemeral(),
        },
    }),
    Messages =
    [
        new()
        {
            Role = Role.User,
            Content = "What are the key terms and conditions in this agreement?"
        }
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
		System: []anthropic.TextBlockParam{
			{
				Text: "You are an AI assistant tasked with analyzing legal documents.",
			},
			{
				Text:         "Here is the full text of a complex legal agreement: [Insert full text of a 50-page legal agreement here]",
				CacheControl: anthropic.NewCacheControlEphemeralParam(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What are the key terms and conditions in this agreement?")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response.Usage)
}
```

```java Java hidelines={1..2,4..12,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import java.util.List;

public class LegalDocumentAnalysisExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .maxTokens(1024)
      .systemOfTextBlockParams(
        List.of(
          TextBlockParam.builder()
            .text("You are an AI assistant tasked with analyzing legal documents.")
            .build(),
          TextBlockParam.builder()
            .text(
              "Here is the full text of a complex legal agreement: [Insert full text of a 50-page legal agreement here]"
            )
            .cacheControl(CacheControlEphemeral.builder().build())
            .build()
        )
      )
      .addUserMessage("What are the key terms and conditions in this agreement?")
      .build();

    Message message = client.messages().create(params);
    System.out.println(message);
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
        [
            'role' => 'user',
            'content' => 'What are the key terms and conditions in this agreement?'
        ]
    ],
    model: 'claude-opus-4-8',
    system: [
        [
            'type' => 'text',
            'text' => 'You are an AI assistant tasked with analyzing legal documents.'
        ],
        [
            'type' => 'text',
            'text' => 'Here is the full text of a complex legal agreement: [Insert full text of a 50-page legal agreement here]',
            'cache_control' => ['type' => 'ephemeral']
        ]
    ],
);

echo $message->content[0]->text;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  system: [
    {
      type: "text",
      text: "You are an AI assistant tasked with analyzing legal documents."
    },
    {
      type: "text",
      text: "Here is the full text of a complex legal agreement: [Insert full text of a 50-page legal agreement here]",
      cache_control: { type: "ephemeral" }
    }
  ],
  messages: [
    {
      role: "user",
      content: "What are the key terms and conditions in this agreement?"
    }
  ]
)
puts message
```
</CodeGroup>
此示例演示了提示缓存的基本用法，将法律协议的完整文本作为前缀进行缓存，同时保持用户指令不被缓存。

对于第一个请求：
- `input_tokens`：仅用户消息中的令牌数
- `cache_creation_input_tokens`：整个系统消息中的令牌数，包括法律文档
- `cache_read_input_tokens`：0（第一个请求没有缓存命中）

对于缓存生命周期内的后续请求：
- `input_tokens`：仅用户消息中的令牌数
- `cache_creation_input_tokens`：0（没有新的缓存创建）
- `cache_read_input_tokens`：整个已缓存系统消息中的令牌数

</section>

<section title="缓存工具定义">

通过在 `tools` 数组中的最后一个工具上放置 `cache_control`，可以缓存工具定义。该工具之前（包括该工具本身）定义的所有工具都会作为单个前缀被缓存。

```json
{
  "model": "claude-opus-4-8",
  "max_tokens": 1024,
  "tools": [
    {
      "name": "get_weather",
      "description": "Get the current weather in a given location",
      "input_schema": {
        "type": "object",
        "properties": { "location": { "type": "string" } },
        "required": ["location"]
      }
    },
    {
      "name": "get_time",
      "description": "Get the current time in a given time zone",
      "input_schema": {
        "type": "object",
        "properties": { "timezone": { "type": "string" } },
        "required": ["timezone"]
      },
      "cache_control": { "type": "ephemeral" }
    }
  ],
  "messages": [{ "role": "user", "content": "What is the weather and time in New York?" }]
}
```

在第一个请求中，`cache_creation_input_tokens` 反映所有工具定义的令牌数。在缓存生命周期内的后续请求中，这些令牌会改为出现在 `cache_read_input_tokens` 下。

有关工具定义、`defer_loading` 和缓存失效之间的详细交互，请参阅[工具使用与提示缓存](/docs/zh-CN/agents-and-tools/tool-use/tool-use-with-prompt-caching)。

</section>

<section title="继续多轮对话">

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "system": [
        {
            "type": "text",
            "text": "...long system prompt",
            "cache_control": {"type": "ephemeral"}
        }
    ],
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Hello, can you tell me more about the solar system?"
                }
            ]
        },
        {
            "role": "assistant",
            "content": "Certainly! The solar system is the collection of celestial bodies that orbit our Sun. It consists of eight planets, numerous moons, asteroids, comets, and other objects. The planets, in order from closest to farthest from the Sun, are: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Each planet has its own unique characteristics and features. Is there a specific aspect of the solar system you would like to know more about?"
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Good to know."
                },
                {
                    "type": "text",
                    "text": "Tell me more about Mars.",
                    "cache_control": {"type": "ephemeral"}
                }
            ]
        }
    ]
}'
```

```bash CLI
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
system:
  - type: text
    text: "...long system prompt"
    cache_control:
      type: ephemeral
messages:
  - role: user
    content:
      - type: text
        text: Hello, can you tell me more about the solar system?
  - role: assistant
    content: >-
      Certainly! The solar system is the collection of celestial bodies that
      orbit our Sun. It consists of eight planets, numerous moons, asteroids,
      comets, and other objects. The planets, in order from closest to farthest
      from the Sun, are: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus,
      and Neptune. Each planet has its own unique characteristics and features.
      Is there a specific aspect of the solar system you would like to know
      more about?
  - role: user
    content:
      - type: text
        text: Good to know.
      - type: text
        text: Tell me more about Mars.
        cache_control:
          type: ephemeral
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    system=[
        {
            "type": "text",
            "text": "...long system prompt",
            "cache_control": {"type": "ephemeral"},
        }
    ],
    messages=[
        # ...到目前为止的长对话
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Hello, can you tell me more about the solar system?",
                }
            ],
        },
        {
            "role": "assistant",
            "content": "Certainly! The solar system is the collection of celestial bodies that orbit our Sun. It consists of eight planets, numerous moons, asteroids, comets, and other objects. The planets, in order from closest to farthest from the Sun, are: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Each planet has its own unique characteristics and features. Is there a specific aspect of the solar system you'd like to know more about?",
        },
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Good to know."},
                {
                    "type": "text",
                    "text": "Tell me more about Mars.",
                    "cache_control": {"type": "ephemeral"},
                },
            ],
        },
    ],
)
print(response.model_dump_json())
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  system: [
    {
      type: "text",
      text: "...long system prompt",
      cache_control: { type: "ephemeral" }
    }
  ],
  messages: [
    // ...到目前为止的长对话
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Hello, can you tell me more about the solar system?"
        }
      ]
    },
    {
      role: "assistant",
      content:
        "Certainly! The solar system is the collection of celestial bodies that orbit our Sun. It consists of eight planets, numerous moons, asteroids, comets, and other objects. The planets, in order from closest to farthest from the Sun, are: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Each planet has its own unique characteristics and features. Is there a specific aspect of the solar system you'd like to know more about?"
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Good to know."
        },
        {
          type: "text",
          text: "Tell me more about Mars.",
          cache_control: { type: "ephemeral" }
        }
      ]
    }
  ]
});
console.log(response);
```

```csharp C# hidelines={1..6}
using Anthropic;
using Anthropic.Models.Messages;
using System.Collections.Generic;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    System = new MessageCreateParamsSystem(new List<TextBlockParam>
    {
        new TextBlockParam()
        {
            Text = "...long system prompt",
            CacheControl = new CacheControlEphemeral(),
        },
    }),
    Messages =
    [
        new()
        {
            Role = Role.User,
            Content = new MessageParamContent(new List<ContentBlockParam>
            {
                new ContentBlockParam(new TextBlockParam("Hello, can you tell me more about the solar system?")),
            }),
        },
        new()
        {
            Role = Role.Assistant,
            Content = "Certainly! The solar system is the collection of celestial bodies that orbit our Sun. It consists of eight planets, numerous moons, asteroids, comets, and other objects. The planets, in order from closest to farthest from the Sun, are: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Each planet has its own unique characteristics and features. Is there a specific aspect of the solar system you would like to know more about?"
        },
        new()
        {
            Role = Role.User,
            Content = new MessageParamContent(new List<ContentBlockParam>
            {
                new ContentBlockParam(new TextBlockParam("Good to know.")),
                new ContentBlockParam(new TextBlockParam()
                {
                    Text = "Tell me more about Mars.",
                    CacheControl = new CacheControlEphemeral(),
                }),
            })
        }
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
		System: []anthropic.TextBlockParam{
			{
				Text:         "...long system prompt",
				CacheControl: anthropic.NewCacheControlEphemeralParam(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Hello, can you tell me more about the solar system?")),
			anthropic.NewAssistantMessage(anthropic.NewTextBlock("Certainly! The solar system is the collection of celestial bodies that orbit our Sun. It consists of eight planets, numerous moons, asteroids, comets, and other objects. The planets, in order from closest to farthest from the Sun, are: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Each planet has its own unique characteristics and features. Is there a specific aspect of the solar system you would like to know more about?")),
			{
				Role: anthropic.MessageParamRoleUser,
				Content: []anthropic.ContentBlockParamUnion{
					anthropic.NewTextBlock("Good to know."),
					{OfText: &anthropic.TextBlockParam{
						Text:         "Tell me more about Mars.",
						CacheControl: anthropic.NewCacheControlEphemeralParam(),
					}},
				},
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..2,4..13,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import java.util.List;

public class ConversationWithCacheControlExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // 创建临时系统提示
    TextBlockParam systemPrompt = TextBlockParam.builder()
      .text("...long system prompt")
      .cacheControl(CacheControlEphemeral.builder().build())
      .build();

    // 创建消息参数
    MessageCreateParams params = MessageCreateParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .maxTokens(1024)
      .systemOfTextBlockParams(List.of(systemPrompt))
      // 第一条用户消息（不带 cache_control）
      .addUserMessage("Hello, can you tell me more about the solar system?")
      // 助手响应
      .addAssistantMessage(
        "Certainly! The solar system is the collection of celestial bodies that orbit our Sun. It consists of eight planets, numerous moons, asteroids, comets, and other objects. The planets, in order from closest to farthest from the Sun, are: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Each planet has its own unique characteristics and features. Is there a specific aspect of the solar system you would like to know more about?"
      )
      // 第二条用户消息（带 cache_control）
      .addUserMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofText(TextBlockParam.builder().text("Good to know.").build()),
          ContentBlockParam.ofText(
            TextBlockParam.builder()
              .text("Tell me more about Mars.")
              .cacheControl(CacheControlEphemeral.builder().build())
              .build()
          )
        )
      )
      .build();

    Message message = client.messages().create(params);
    System.out.println(message);
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
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'text',
                    'text' => 'Hello, can you tell me more about the solar system?'
                ]
            ]
        ],
        [
            'role' => 'assistant',
            'content' => "Certainly! The solar system is the collection of celestial bodies that orbit our Sun. It consists of eight planets, numerous moons, asteroids, comets, and other objects. The planets, in order from closest to farthest from the Sun, are: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Each planet has its own unique characteristics and features. Is there a specific aspect of the solar system you would like to know more about?"
        ],
        [
            'role' => 'user',
            'content' => [
                ['type' => 'text', 'text' => 'Good to know.'],
                [
                    'type' => 'text',
                    'text' => 'Tell me more about Mars.',
                    'cache_control' => ['type' => 'ephemeral']
                ]
            ]
        ]
    ],
    model: 'claude-opus-4-8',
    system: [
        [
            'type' => 'text',
            'text' => '...long system prompt',
            'cache_control' => ['type' => 'ephemeral']
        ]
    ],
);

echo $message->content[0]->text;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  system: [
    {
      type: "text",
      text: "...long system prompt",
      cache_control: { type: "ephemeral" }
    }
  ],
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Hello, can you tell me more about the solar system?"
        }
      ]
    },
    {
      role: "assistant",
      content: "Certainly! The solar system is the collection of celestial bodies that orbit our Sun. It consists of eight planets, numerous moons, asteroids, comets, and other objects. The planets, in order from closest to farthest from the Sun, are: Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, and Neptune. Each planet has its own unique characteristics and features. Is there a specific aspect of the solar system you would like to know more about?"
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Good to know." },
        {
          type: "text",
          text: "Tell me more about Mars.",
          cache_control: { type: "ephemeral" }
        }
      ]
    }
  ]
)
puts message
```
</CodeGroup>

此示例演示了如何在多轮对话中使用提示缓存。

在每一轮中，最后一条消息的最后一个块都标记了 `cache_control`，以便对话可以增量缓存。系统将自动查找并使用之前缓存的最长块序列来处理后续消息。也就是说，之前标记了 `cache_control` 块但后来未标记的块，如果在 5 分钟内被命中，仍会被视为缓存命中（同时也会刷新缓存！）。

此外，请注意 `cache_control` 参数放置在系统消息上。这是为了确保如果它从缓存中被逐出（超过 5 分钟未使用），它将在下一个请求时被重新添加到缓存中。

这种方法对于在持续对话中保持上下文而无需重复处理相同信息非常有用。

正确设置后，您应该在每个请求的 usage 响应中看到以下内容：
- `input_tokens`：新用户消息中的令牌数（将非常少）
- `cache_creation_input_tokens`：新的助手和用户轮次中的令牌数
- `cache_read_input_tokens`：截至上一轮的对话中的令牌数

</section>

<section title="综合应用：多个缓存断点">

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "tools": [
        {
            "name": "search_documents",
            "description": "Search through the knowledge base",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search query"
                    }
                },
                "required": ["query"]
            }
        },
        {
            "name": "get_document",
            "description": "Retrieve a specific document by ID",
            "input_schema": {
                "type": "object",
                "properties": {
                    "doc_id": {
                        "type": "string",
                        "description": "Document ID"
                    }
                },
                "required": ["doc_id"]
            },
            "cache_control": {"type": "ephemeral"}
        }
    ],
    "system": [
        {
            "type": "text",
            "text": "You are a helpful research assistant with access to a document knowledge base.\n\n# Instructions\n- Always search for relevant documents before answering\n- Provide citations for your sources\n- Be objective and accurate in your responses\n- If multiple documents contain relevant information, synthesize them\n- Acknowledge when information is not available in the knowledge base",
            "cache_control": {"type": "ephemeral"}
        },
        {
            "type": "text",
            "text": "# Knowledge Base Context\n\nHere are the relevant documents for this conversation:\n\n## Document 1: Solar System Overview\nThe solar system consists of the Sun and all objects that orbit it...\n\n## Document 2: Planetary Characteristics\nEach planet has unique features. Mercury is the smallest planet...\n\n## Document 3: Mars Exploration\nMars has been a target of exploration for decades...\n\n[Additional documents...]",
            "cache_control": {"type": "ephemeral"}
        }
    ],
    "messages": [
        {
            "role": "user",
            "content": "Can you search for information about Mars rovers?"
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": "tool_1",
                    "name": "search_documents",
                    "input": {"query": "Mars rovers"}
                }
            ]
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "tool_1",
                    "content": "Found 3 relevant documents: Document 3 (Mars Exploration), Document 7 (Rover Technology), Document 9 (Mission History)"
                }
            ]
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "I found 3 relevant documents about Mars rovers. Let me get more details from the Mars Exploration document."
                }
            ]
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Yes, please tell me about the Perseverance rover specifically.",
                    "cache_control": {"type": "ephemeral"}
                }
            ]
        }
    ]
}'
```

```bash CLI
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
tools:
  - name: search_documents
    description: Search through the knowledge base
    input_schema:
      type: object
      properties:
        query:
          type: string
          description: Search query
      required: [query]
  - name: get_document
    description: Retrieve a specific document by ID
    input_schema:
      type: object
      properties:
        doc_id:
          type: string
          description: Document ID
      required: [doc_id]
    cache_control:
      type: ephemeral
system:
  - type: text
    text: |-
      You are a helpful research assistant with access to a document knowledge base.

      # 指令
      - Always search for relevant documents before answering
      - Provide citations for your sources
      - Be objective and accurate in your responses
      - If multiple documents contain relevant information, synthesize them
      - Acknowledge when information is not available in the knowledge base
    cache_control:
      type: ephemeral
  - type: text
    text: |-
      # 知识库上下文

      Here are the relevant documents for this conversation:

      ## 文档 1：太阳系概述
      The solar system consists of the Sun and all objects that orbit it...

      ## 文档 2：行星特征
      Each planet has unique features. Mercury is the smallest planet...

      ## 文档 3：火星探索
      Mars has been a target of exploration for decades...

      [Additional documents...]
    cache_control:
      type: ephemeral
messages:
  - role: user
    content: Can you search for information about Mars rovers?
  - role: assistant
    content:
      - type: tool_use
        id: tool_1
        name: search_documents
        input:
          query: Mars rovers
  - role: user
    content:
      - type: tool_result
        tool_use_id: tool_1
        content: >-
          Found 3 relevant documents: Document 3 (Mars Exploration),
          Document 7 (Rover Technology), Document 9 (Mission History)
  - role: assistant
    content:
      - type: text
        text: >-
          I found 3 relevant documents about Mars rovers. Let me get more
          details from the Mars Exploration document.
  - role: user
    content:
      - type: text
        text: Yes, please tell me about the Perseverance rover specifically.
        cache_control:
          type: ephemeral
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=[
        {
            "name": "search_documents",
            "description": "Search through the knowledge base",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"}
                },
                "required": ["query"],
            },
        },
        {
            "name": "get_document",
            "description": "Retrieve a specific document by ID",
            "input_schema": {
                "type": "object",
                "properties": {
                    "doc_id": {"type": "string", "description": "Document ID"}
                },
                "required": ["doc_id"],
            },
            "cache_control": {"type": "ephemeral"},
        },
    ],
    system=[
        {
            "type": "text",
            "text": "You are a helpful research assistant with access to a document knowledge base.\n\n# Instructions\n- Always search for relevant documents before answering\n- Provide citations for your sources\n- Be objective and accurate in your responses\n- If multiple documents contain relevant information, synthesize them\n- Acknowledge when information is not available in the knowledge base",
            "cache_control": {"type": "ephemeral"},
        },
        {
            "type": "text",
            "text": "# Knowledge Base Context\n\nHere are the relevant documents for this conversation:\n\n## Document 1: Solar System Overview\nThe solar system consists of the Sun and all objects that orbit it...\n\n## Document 2: Planetary Characteristics\nEach planet has unique features. Mercury is the smallest planet...\n\n## Document 3: Mars Exploration\nMars has been a target of exploration for decades...\n\n[Additional documents...]",
            "cache_control": {"type": "ephemeral"},
        },
    ],
    messages=[
        {
            "role": "user",
            "content": "Can you search for information about Mars rovers?",
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "tool_use",
                    "id": "tool_1",
                    "name": "search_documents",
                    "input": {"query": "Mars rovers"},
                }
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "tool_1",
                    "content": "Found 3 relevant documents: Document 3 (Mars Exploration), Document 7 (Rover Technology), Document 9 (Mission History)",
                }
            ],
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "I found 3 relevant documents about Mars rovers. Let me get more details from the Mars Exploration document.",
                }
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": "Yes, please tell me about the Perseverance rover specifically.",
                    "cache_control": {"type": "ephemeral"},
                }
            ],
        },
    ],
)
print(response.model_dump_json())
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      name: "search_documents",
      description: "Search through the knowledge base",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query"
          }
        },
        required: ["query"]
      }
    },
    {
      name: "get_document",
      description: "Retrieve a specific document by ID",
      input_schema: {
        type: "object",
        properties: {
          doc_id: {
            type: "string",
            description: "Document ID"
          }
        },
        required: ["doc_id"]
      },
      cache_control: { type: "ephemeral" }
    }
  ],
  system: [
    {
      type: "text",
      text: "You are a helpful research assistant with access to a document knowledge base.\n\n# Instructions\n- Always search for relevant documents before answering\n- Provide citations for your sources\n- Be objective and accurate in your responses\n- If multiple documents contain relevant information, synthesize them\n- Acknowledge when information is not available in the knowledge base",
      cache_control: { type: "ephemeral" }
    },
    {
      type: "text",
      text: "# Knowledge Base Context\n\nHere are the relevant documents for this conversation:\n\n## Document 1: Solar System Overview\nThe solar system consists of the Sun and all objects that orbit it...\n\n## Document 2: Planetary Characteristics\nEach planet has unique features. Mercury is the smallest planet...\n\n## Document 3: Mars Exploration\nMars has been a target of exploration for decades...\n\n[Additional documents...]",
      cache_control: { type: "ephemeral" }
    }
  ],
  messages: [
    {
      role: "user",
      content: "Can you search for information about Mars rovers?"
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "search_documents",
          input: { query: "Mars rovers" }
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool_1",
          content:
            "Found 3 relevant documents: Document 3 (Mars Exploration), Document 7 (Rover Technology), Document 9 (Mission History)"
        }
      ]
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I found 3 relevant documents about Mars rovers. Let me get more details from the Mars Exploration document."
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Yes, please tell me about the Perseverance rover specifically.",
          cache_control: { type: "ephemeral" }
        }
      ]
    }
  ]
});
console.log(response);
```

```csharp C# hidelines={1..4}
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new()
{
    ApiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY")
};

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Tools =
    [
        new ToolUnion(new Tool()
        {
            Name = "search_documents",
            Description = "Search through the knowledge base",
            InputSchema = new InputSchema()
            {
                Properties = new Dictionary<string, JsonElement>
                {
                    ["query"] = JsonSerializer.SerializeToElement(new { type = "string", description = "Search query" }),
                },
                Required = ["query"],
            },
        }),
        new ToolUnion(new Tool()
        {
            Name = "get_document",
            Description = "Retrieve a specific document by ID",
            InputSchema = new InputSchema()
            {
                Properties = new Dictionary<string, JsonElement>
                {
                    ["doc_id"] = JsonSerializer.SerializeToElement(new { type = "string", description = "Document ID" }),
                },
                Required = ["doc_id"],
            },
            CacheControl = new CacheControlEphemeral(),
        }),
    ],
    System = new MessageCreateParamsSystem(new List<TextBlockParam>
    {
        new TextBlockParam()
        {
            Text = "You are a helpful research assistant with access to a document knowledge base.\n\n# Instructions\n- Always search for relevant documents before answering\n- Provide citations for your sources\n- Be objective and accurate in your responses\n- If multiple documents contain relevant information, synthesize them\n- Acknowledge when information is not available in the knowledge base",
            CacheControl = new CacheControlEphemeral(),
        },
        new TextBlockParam()
        {
            Text = "# Knowledge Base Context\n\nHere are the relevant documents for this conversation:\n\n## Document 1: Solar System Overview\nThe solar system consists of the Sun and all objects that orbit it...\n\n## Document 2: Planetary Characteristics\nEach planet has unique features. Mercury is the smallest planet...\n\n## Document 3: Mars Exploration\nMars has been a target of exploration for decades...\n\n[Additional documents...]",
            CacheControl = new CacheControlEphemeral(),
        },
    }),
    Messages =
    [
        new() { Role = Role.User, Content = "Can you search for information about Mars rovers?" },
        new()
        {
            Role = Role.Assistant,
            Content = new MessageParamContent(new List<ContentBlockParam>
            {
                new ContentBlockParam(new ToolUseBlockParam()
                {
                    ID = "tool_1",
                    Name = "search_documents",
                    Input = new Dictionary<string, JsonElement>
                    {
                        ["query"] = JsonSerializer.SerializeToElement("Mars rovers"),
                    },
                }),
            }),
        },
        new()
        {
            Role = Role.User,
            Content = new MessageParamContent(new List<ContentBlockParam>
            {
                new ContentBlockParam(new ToolResultBlockParam()
                {
                    ToolUseID = "tool_1",
                    Content = "Found 3 relevant documents: Document 3 (Mars Exploration), Document 7 (Rover Technology), Document 9 (Mission History)",
                }),
            }),
        },
        new()
        {
            Role = Role.Assistant,
            Content = "I found 3 relevant documents about Mars rovers. Let me get more details from the Mars Exploration document.",
        },
        new()
        {
            Role = Role.User,
            Content = new MessageParamContent(new List<ContentBlockParam>
            {
                new ContentBlockParam(new TextBlockParam()
                {
                    Text = "Yes, please tell me about the Perseverance rover specifically.",
                    CacheControl = new CacheControlEphemeral(),
                }),
            }),
        },
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
				Name:        "search_documents",
				Description: anthropic.String("Search through the knowledge base"),
				InputSchema: anthropic.ToolInputSchemaParam{
					Properties: map[string]any{
						"query": map[string]any{
							"type":        "string",
							"description": "Search query",
						},
					},
					Required: []string{"query"},
				},
			}},
			{OfTool: &anthropic.ToolParam{
				Name:        "get_document",
				Description: anthropic.String("Retrieve a specific document by ID"),
				InputSchema: anthropic.ToolInputSchemaParam{
					Properties: map[string]any{
						"doc_id": map[string]any{
							"type":        "string",
							"description": "Document ID",
						},
					},
					Required: []string{"doc_id"},
				},
				CacheControl: anthropic.NewCacheControlEphemeralParam(),
			}},
		},
		System: []anthropic.TextBlockParam{
			{
				Text:         "You are a helpful research assistant with access to a document knowledge base.\n\n# Instructions\n- Always search for relevant documents before answering\n- Provide citations for your sources\n- Be objective and accurate in your responses\n- If multiple documents contain relevant information, synthesize them\n- Acknowledge when information is not available in the knowledge base",
				CacheControl: anthropic.NewCacheControlEphemeralParam(),
			},
			{
				Text:         "# Knowledge Base Context\n\nHere are the relevant documents for this conversation:\n\n## Document 1: Solar System Overview\nThe solar system consists of the Sun and all objects that orbit it...\n\n## Document 2: Planetary Characteristics\nEach planet has unique features. Mercury is the smallest planet...\n\n## Document 3: Mars Exploration\nMars has been a target of exploration for decades...\n\n[Additional documents...]",
				CacheControl: anthropic.NewCacheControlEphemeralParam(),
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Can you search for information about Mars rovers?")),
			anthropic.NewAssistantMessage(anthropic.NewToolUseBlock(
				"tool_1",
				map[string]any{"query": "Mars rovers"},
				"search_documents",
			)),
			anthropic.NewUserMessage(anthropic.NewToolResultBlock(
				"tool_1",
				"Found 3 relevant documents: Document 3 (Mars Exploration), Document 7 (Rover Technology), Document 9 (Mission History)",
				false,
			)),
			anthropic.NewAssistantMessage(anthropic.NewTextBlock("I found 3 relevant documents about Mars rovers. Let me get more details from the Mars Exploration document.")),
			{
				Role: anthropic.MessageParamRoleUser,
				Content: []anthropic.ContentBlockParamUnion{
					{OfText: &anthropic.TextBlockParam{
						Text:         "Yes, please tell me about the Perseverance rover specifically.",
						CacheControl: anthropic.NewCacheControlEphemeralParam(),
					}},
				},
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..3,5..19,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import com.anthropic.models.messages.Tool;
import com.anthropic.models.messages.Tool.InputSchema;
import com.anthropic.models.messages.ToolResultBlockParam;
import com.anthropic.models.messages.ToolUseBlockParam;
import java.util.List;
import java.util.Map;

public class MultipleCacheBreakpointsExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // 搜索工具 schema
    InputSchema searchSchema = InputSchema.builder()
      .properties(
        JsonValue.from(
          Map.of("query", Map.of("type", "string", "description", "Search query"))
        )
      )
      .putAdditionalProperty("required", JsonValue.from(List.of("query")))
      .build();

    // 获取文档工具 schema
    InputSchema getDocSchema = InputSchema.builder()
      .properties(
        JsonValue.from(
          Map.of("doc_id", Map.of("type", "string", "description", "Document ID"))
        )
      )
      .putAdditionalProperty("required", JsonValue.from(List.of("doc_id")))
      .build();

    MessageCreateParams params = MessageCreateParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .maxTokens(1024)
      // 工具列表，在最后一个工具上设置缓存控制
      .addTool(
        Tool.builder()
          .name("search_documents")
          .description("Search through the knowledge base")
          .inputSchema(searchSchema)
          .build()
      )
      .addTool(
        Tool.builder()
          .name("get_document")
          .description("Retrieve a specific document by ID")
          .inputSchema(getDocSchema)
          .cacheControl(CacheControlEphemeral.builder().build())
          .build()
      )
      // 系统提示，分别在指令和上下文上设置缓存控制
      .systemOfTextBlockParams(
        List.of(
          TextBlockParam.builder()
            .text(
              "You are a helpful research assistant with access to a document knowledge base.\n\n# Instructions\n- Always search for relevant documents before answering\n- Provide citations for your sources\n- Be objective and accurate in your responses\n- If multiple documents contain relevant information, synthesize them\n- Acknowledge when information is not available in the knowledge base"
            )
            .cacheControl(CacheControlEphemeral.builder().build())
            .build(),
          TextBlockParam.builder()
            .text(
              "# Knowledge Base Context\n\nHere are the relevant documents for this conversation:\n\n## Document 1: Solar System Overview\nThe solar system consists of the Sun and all objects that orbit it...\n\n## Document 2: Planetary Characteristics\nEach planet has unique features. Mercury is the smallest planet...\n\n## Document 3: Mars Exploration\nMars has been a target of exploration for decades...\n\n[Additional documents...]"
            )
            .cacheControl(CacheControlEphemeral.builder().build())
            .build()
        )
      )
      // 对话历史
      .addUserMessage("Can you search for information about Mars rovers?")
      .addAssistantMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofToolUse(
            ToolUseBlockParam.builder()
              .id("tool_1")
              .name("search_documents")
              .input(JsonValue.from(Map.of("query", "Mars rovers")))
              .build()
          )
        )
      )
      .addUserMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofToolResult(
            ToolResultBlockParam.builder()
              .toolUseId("tool_1")
              .content(
                "Found 3 relevant documents: Document 3 (Mars Exploration), Document 7 (Rover Technology), Document 9 (Mission History)"
              )
              .build()
          )
        )
      )
      .addAssistantMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofText(
            TextBlockParam.builder()
              .text(
                "I found 3 relevant documents about Mars rovers. Let me get more details from the Mars Exploration document."
              )
              .build()
          )
        )
      )
      .addUserMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofText(
            TextBlockParam.builder()
              .text("Yes, please tell me about the Perseverance rover specifically.")
              .cacheControl(CacheControlEphemeral.builder().build())
              .build()
          )
        )
      )
      .build();

    Message message = client.messages().create(params);
    System.out.println(message);
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
        [
            'role' => 'user',
            'content' => 'Can you search for information about Mars rovers?'
        ],
        [
            'role' => 'assistant',
            'content' => [
                [
                    'type' => 'tool_use',
                    'id' => 'tool_1',
                    'name' => 'search_documents',
                    'input' => ['query' => 'Mars rovers']
                ]
            ]
        ],
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'tool_result',
                    'tool_use_id' => 'tool_1',
                    'content' => 'Found 3 relevant documents: Document 3 (Mars Exploration), Document 7 (Rover Technology), Document 9 (Mission History)'
                ]
            ]
        ],
        [
            'role' => 'assistant',
            'content' => [
                [
                    'type' => 'text',
                    'text' => 'I found 3 relevant documents about Mars rovers. Let me get more details from the Mars Exploration document.'
                ]
            ]
        ],
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'text',
                    'text' => 'Yes, please tell me about the Perseverance rover specifically.',
                    'cache_control' => ['type' => 'ephemeral']
                ]
            ]
        ]
    ],
    model: 'claude-opus-4-8',
    system: [
        [
            'type' => 'text',
            'text' => "You are a helpful research assistant with access to a document knowledge base.\n\n# Instructions\n- Always search for relevant documents before answering\n- Provide citations for your sources\n- Be objective and accurate in your responses\n- If multiple documents contain relevant information, synthesize them\n- Acknowledge when information is not available in the knowledge base",
            'cache_control' => ['type' => 'ephemeral']
        ],
        [
            'type' => 'text',
            'text' => "# Knowledge Base Context\n\nHere are the relevant documents for this conversation:\n\n## Document 1: Solar System Overview\nThe solar system consists of the Sun and all objects that orbit it...\n\n## Document 2: Planetary Characteristics\nEach planet has unique features. Mercury is the smallest planet...\n\n## Document 3: Mars Exploration\nMars has been a target of exploration for decades...\n\n[Additional documents...]",
            'cache_control' => ['type' => 'ephemeral']
        ]
    ],
    tools: [
        [
            'name' => 'search_documents',
            'description' => 'Search through the knowledge base',
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'query' => [
                        'type' => 'string',
                        'description' => 'Search query'
                    ]
                ],
                'required' => ['query']
            ]
        ],
        [
            'name' => 'get_document',
            'description' => 'Retrieve a specific document by ID',
            'input_schema' => [
                'type' => 'object',
                'properties' => [
                    'doc_id' => [
                        'type' => 'string',
                        'description' => 'Document ID'
                    ]
                ],
                'required' => ['doc_id']
            ],
            'cache_control' => ['type' => 'ephemeral']
        ]
    ],
);

echo json_encode($message->usage), PHP_EOL;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      name: "search_documents",
      description: "Search through the knowledge base",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query"
          }
        },
        required: ["query"]
      }
    },
    {
      name: "get_document",
      description: "Retrieve a specific document by ID",
      input_schema: {
        type: "object",
        properties: {
          doc_id: {
            type: "string",
            description: "Document ID"
          }
        },
        required: ["doc_id"]
      },
      cache_control: { type: "ephemeral" }
    }
  ],
  system: [
    {
      type: "text",
      text: "You are a helpful research assistant with access to a document knowledge base.\n\n# Instructions\n- Always search for relevant documents before answering\n- Provide citations for your sources\n- Be objective and accurate in your responses\n- If multiple documents contain relevant information, synthesize them\n- Acknowledge when information is not available in the knowledge base",
      cache_control: { type: "ephemeral" }
    },
    {
      type: "text",
      text: "# Knowledge Base Context\n\nHere are the relevant documents for this conversation:\n\n## Document 1: Solar System Overview\nThe solar system consists of the Sun and all objects that orbit it...\n\n## Document 2: Planetary Characteristics\nEach planet has unique features. Mercury is the smallest planet...\n\n## Document 3: Mars Exploration\nMars has been a target of exploration for decades...\n\n[Additional documents...]",
      cache_control: { type: "ephemeral" }
    }
  ],
  messages: [
    {
      role: "user",
      content: "Can you search for information about Mars rovers?"
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "search_documents",
          input: { query: "Mars rovers" }
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "tool_1",
          content: "Found 3 relevant documents: Document 3 (Mars Exploration), Document 7 (Rover Technology), Document 9 (Mission History)"
        }
      ]
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I found 3 relevant documents about Mars rovers. Let me get more details from the Mars Exploration document."
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Yes, please tell me about the Perseverance rover specifically.",
          cache_control: { type: "ephemeral" }
        }
      ]
    }
  ]
)
puts message
```
</CodeGroup>

这个综合示例演示了如何使用全部 4 个可用的缓存断点来优化提示的不同部分：

1. **工具缓存**（缓存断点 1）：最后一个工具定义上的 `cache_control` 参数会缓存所有工具定义。

2. **可复用指令缓存**（缓存断点 2）：系统提示中的静态指令被单独缓存。这些指令在不同请求之间很少变化。

3. **RAG 上下文缓存**（缓存断点 3）：知识库文档被独立缓存，允许您更新 RAG 文档而不会使工具或指令缓存失效。

4. **对话历史缓存**（缓存断点 4）：最后一条用户消息标记了 `cache_control`，以便在对话进行时启用增量缓存。

这种方法提供了最大的灵活性：
- 如果您在不更改早期内容的情况下向对话追加新的轮次，所有四个缓存段都会被复用
- 如果您更新 RAG 文档但保持相同的工具和指令，前两个缓存段会被复用
- 如果您更改对话但保持相同的工具、指令和文档，前三个段会被复用
- 任何断点处的更改都会使该段及其之后的所有内容失效，而之前的缓存段仍然有效

对于第一个请求：
- `input_tokens`：极少（最后一个缓存断点之后的令牌，在此示例中接近 0）
- `cache_creation_input_tokens`：所有缓存段中的令牌（工具 + 指令 + RAG 文档 + 对话历史）
- `cache_read_input_tokens`：0（没有缓存命中）

对于仅包含新用户消息的后续请求（并且第四个断点移动到该新的最后一条消息，如示例所示）：
- `input_tokens`：极少（最后一个缓存断点之后的令牌，在此示例中接近 0）
- `cache_creation_input_tokens`：新用户消息和上一个助手轮次中的令牌（正在缓存的新对话段）
- `cache_read_input_tokens`：所有之前缓存的令牌（工具 + 指令 + RAG 文档 + 之前的对话）

这种模式对以下场景特别有效：
- 具有大型文档上下文的 RAG 应用程序
- 使用多个工具的智能体系统
- 需要保持上下文的长时间运行对话
- 需要独立优化提示不同部分的应用程序

</section>

## 数据保留 \{#data-retention}

提示缓存（包括自动和显式）符合 ZDR（零数据保留）资格。Anthropic 不会存储您的提示或 Claude 响应的原始文本。

KV（键值）缓存表示和缓存内容的加密哈希仅保存在内存中，不会持久化存储。缓存条目的最短生命周期为 5 分钟（标准）或 1 小时（扩展），之后会被及时（但非立即）删除。缓存条目在组织之间是隔离的；在 Claude API、AWS 上的 Claude Platform 以及 Microsoft Foundry（测试版）上，组织内的工作区之间也是隔离的。

有关所有功能的 ZDR 资格，请参阅 [API 和数据保留](/docs/zh-CN/manage-claude/api-and-data-retention)。

---
## 常见问题 \{#faq}

  <section title="我需要多个缓存断点，还是在末尾放一个就足够了？">

    **在大多数情况下，在静态内容末尾放置单个缓存断点就足够了。** 缓存写入仅发生在您标记的块上。将其放置在跨请求保持相同的最后一个块上，每个后续请求都会读取同一个条目。如果后面的块在每个请求中都会变化（时间戳、传入的消息），请将断点保持在它之前，即最后一个稳定的块上。

    只有在以下情况下才需要多个断点：
    - 不断增长的对话将您的断点推到距上次缓存写入 20 个或更多块之外，使之前的条目超出回溯窗口
    - 您希望独立缓存以不同频率更新的部分
    - 您需要显式控制缓存内容以进行成本优化

    示例：如果您有系统指令（很少更改）和 RAG 上下文（每天更改），您可以使用两个断点分别缓存它们。
  
</section>

  <section title="缓存断点会增加额外成本吗？">

    不会，缓存断点本身是免费的。您只需为以下内容付费：
    - 将内容写入缓存（5 分钟 TTL 比基础输入令牌多 25%）
    - 从缓存读取（基础输入令牌价格的 10%）
    - 未缓存内容的常规输入令牌

    断点的数量不影响定价——只有缓存和读取的内容量才重要。
  
</section>

  <section title="如何从 usage 字段计算总输入令牌数？">

    usage 响应包含三个独立的输入令牌字段，它们共同代表您的总输入：

    ```text
    total_input_tokens = cache_read_input_tokens + cache_creation_input_tokens + input_tokens
    ```

    - `cache_read_input_tokens`：从缓存中检索的令牌（缓存断点之前已缓存的所有内容）
    - `cache_creation_input_tokens`：正在写入缓存的新令牌（在缓存断点处）
    - `input_tokens`：**最后一个缓存断点之后**未缓存的令牌

    **重要提示：** `input_tokens` 并不代表所有输入令牌——仅代表最后一个缓存断点之后的部分。如果您有缓存内容，`input_tokens` 通常会远小于您的总输入。

    **示例：** 缓存了一个 20 万令牌的文档，加上一个 50 令牌的用户问题：
    - `cache_read_input_tokens`：200,000
    - `cache_creation_input_tokens`：0
    - `input_tokens`：50
    - **总计**：200,050 个令牌

    这种细分对于理解您的成本和速率限制使用情况至关重要。有关更多详细信息，请参阅[跟踪缓存性能](#tracking-cache-performance)。
  
</section>

  <section title="缓存的生命周期是多长？">

    缓存的默认最短生命周期（TTL）为 5 分钟。每次使用缓存内容时，此生命周期都会刷新。

    如果您发现 5 分钟太短，Anthropic 还提供 [1 小时缓存 TTL](#1-hour-cache-duration)。
  
</section>

  <section title="我可以使用多少个缓存断点？">

    您可以在提示中定义最多 4 个缓存断点（使用 `cache_control` 参数）。
  
</section>

  <section title="所有模型都支持提示缓存吗？">

    所有[活跃的 Claude 模型](/docs/zh-CN/about-claude/models/overview)都支持提示缓存。
  
</section>

  <section title="提示缓存如何与扩展思考配合使用？">

    当思考参数更改时，缓存的系统提示和工具将被复用。但是，思考更改（启用/禁用或预算更改）将使之前缓存的包含消息内容的提示前缀失效。

    有关缓存失效的更多详细信息，请参阅[什么会使缓存失效](#what-invalidates-the-cache)。

    有关扩展思考的更多信息，包括其与工具使用和提示缓存的交互，请参阅[扩展思考文档](/docs/zh-CN/build-with-claude/extended-thinking#extended-thinking-and-prompt-caching)。
  
</section>

  <section title="如何启用提示缓存？">

    最简单的方法是在请求正文的顶层添加 `"cache_control": {"type": "ephemeral"}`（[自动缓存](#automatic-caching)）。或者，在各个内容块上至少包含一个 `cache_control` 断点（[显式缓存断点](#explicit-cache-breakpoints)）。
  
</section>

  <section title="我可以将提示缓存与其他 API 功能一起使用吗？">

    可以，提示缓存可以与其他 API 功能（如工具使用和视觉功能）一起使用。但是，更改提示中是否包含图像或修改工具使用设置将破坏缓存。

    有关缓存失效的更多详细信息，请参阅[什么会使缓存失效](#what-invalidates-the-cache)。
  
</section>

  <section title="提示缓存如何影响定价？">

    提示缓存引入了新的定价结构：5 分钟缓存写入的成本比基础输入令牌高 25%，1 小时缓存写入的成本是基础输入令牌的 2 倍，而缓存命中的成本仅为基础输入令牌价格的 10%。
  
</section>

  <section title="我可以手动清除缓存吗？">

    目前，无法手动清除缓存。缓存的前缀在至少 5 分钟不活动后会自动过期。
  
</section>

  <section title="如何跟踪我的缓存策略的有效性？">

    您可以使用 API 响应中的 `cache_creation_input_tokens` 和 `cache_read_input_tokens` 字段来监控缓存性能。
  
</section>

  <section title="什么会破坏缓存？">

    有关缓存失效的更多详细信息，请参阅[什么会使缓存失效](#what-invalidates-the-cache)，其中包括需要创建新缓存条目的更改列表。
  
</section>

  <section title="提示缓存如何处理隐私和数据隔离？">

提示缓存在设计时采用了强大的隐私和数据隔离措施：

1. 缓存键是使用截至缓存控制点的提示的加密哈希生成的。这意味着只有具有相同提示的请求才能访问特定缓存。

2. 在 Claude API、AWS 上的 Claude Platform 以及 Microsoft Foundry（测试版）上，缓存在组织内按工作区隔离。在 Bedrock 和 Vertex AI 上，缓存按组织隔离。在任何情况下，即使提示相同，缓存也绝不会在组织之间共享。有关详细信息，请参阅[缓存存储和共享](#cache-storage-and-sharing)。

3. 缓存机制旨在维护每个独特对话或上下文的完整性和隐私性。

4. 在提示中的任何位置使用 `cache_control` 都是安全的。为了使缓存产生读取命中，请将断点放置在稳定前缀的末尾：将其放置在每个请求都会变化的块上（例如时间戳或用户的任意输入）会每次都写入新条目，永远不会命中。

这些措施确保提示缓存在提供性能优势的同时维护数据隐私和安全。

  
</section>
  <section title="我可以将提示缓存与 Batches API 一起使用吗？">

    可以，您可以在 [Batches API](/docs/zh-CN/build-with-claude/batch-processing) 请求中使用提示缓存。但是，由于异步批处理请求可以并发处理且顺序不定，缓存命中是尽力而为提供的。

    [1 小时缓存](#1-hour-cache-duration)可以帮助提高您的缓存命中率。最具成本效益的使用方式如下：
    - 收集一组具有共享前缀的消息请求。
    - 发送一个批处理请求，其中包含具有此共享前缀和 1 小时缓存块的单个请求。这会将前缀写入 1 小时缓存。
    - 一旦完成，提交其余请求。您需要监控作业以了解其何时完成。

    这通常比使用 5 分钟缓存更好，因为批处理请求通常需要 5 分钟到 1 小时才能完成。
  
</section>
  <section title="为什么我在 Python 中看到错误 `AttributeError: 'Beta' object has no attribute 'prompt_caching'`？">

  此错误通常在您升级了 SDK 或使用了过时的代码示例时出现。提示缓存不再需要 beta 前缀。不要使用：
    <CodeGroup>
      
      ```python Python nocheck
      client.beta.prompt_caching.messages.create(**params)
      ```

      
      ```typescript TypeScript nocheck hidelines={1..2}
      import Anthropic from "@anthropic-ai/sdk";

      const client = new Anthropic();

      const response = await client.beta.promptCaching.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "You are an expert on this large document...",
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [{ role: "user", content: "Summarize the key points" }]
      });

      console.log(response);
      ```

      
      ```php PHP hidelines={1..4} nocheck
      <?php

      use Anthropic\Client;

      $client = new Client();

      $message = $client->beta->promptCaching->messages->create(
          maxTokens: 1024,
          messages: [
              ['role' => 'user', 'content' => 'Summarize the key points']
          ],
          model: 'claude-opus-4-8',
          system: [
              [
                  'type' => 'text',
                  'text' => 'You are an expert on this large document...',
                  'cache_control' => ['type' => 'ephemeral']
              ]
          ],
      );

      echo $message->content[0]->text;
      ```

      
      ```ruby Ruby nocheck hidelines={1..2}
      require "anthropic"

      client = Anthropic::Client.new

      message = client.beta.prompt_caching.messages.create(
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "You are an expert on this large document...",
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [
          { role: "user", content: "Summarize the key points" }
        ]
      )
      puts message.content.first.text
      ```
    </CodeGroup>
    请使用：
    <CodeGroup>
      
      ```python Python nocheck
      client.messages.create(**params)
      ```

      ```typescript TypeScript hidelines={1..2}
      import Anthropic from "@anthropic-ai/sdk";

      const client = new Anthropic();

      const response = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "You are an expert on this large document...",
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [{ role: "user", content: "Summarize the key points" }]
      });

      console.log(response);
      ```

      ```php PHP hidelines={1..4}
      <?php

      use Anthropic\Client;

      $client = new Client();

      $message = $client->messages->create(
          maxTokens: 1024,
          messages: [
              ['role' => 'user', 'content' => 'Summarize the key points']
          ],
          model: 'claude-opus-4-8',
          system: [
              [
                  'type' => 'text',
                  'text' => 'You are an expert on this large document...',
                  'cache_control' => ['type' => 'ephemeral']
              ]
          ],
      );

      echo $message->content[0]->text;
      ```

      ```ruby Ruby hidelines={1..2}
      require "anthropic"

      client = Anthropic::Client.new

      message = client.messages.create(
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "You are an expert on this large document...",
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [
          { role: "user", content: "Summarize the key points" }
        ]
      )
      puts message.content.first.text
      ```
    </CodeGroup>
  
</section>
  <section title="为什么我看到 'TypeError: Cannot read properties of undefined (reading 'messages')'？">

  此错误通常在您升级了 SDK 或使用了过时的代码示例时出现。提示缓存不再需要 beta 前缀。不要使用：

      ```typescript TypeScript
      client.beta.promptCaching.messages.create(/* ... */);
      ```

      只需使用：

      ```typescript
      client.messages.create(/* ... */);
      ```
  
</section>