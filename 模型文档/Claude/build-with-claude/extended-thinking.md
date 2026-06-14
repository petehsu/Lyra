# 使用扩展思考进行构建

---

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

"Extended thinking"（扩展思考）为 Claude 提供了处理复杂任务的增强推理能力，同时在给出最终答案之前，以不同程度的透明度展示其逐步思考过程。

<Note>
在 `claude-fable-5` 和 `claude-mythos-5` 上，扩展思考始终启用且无法禁用。不支持手动扩展思考（`thinking: {type: "enabled", budget_tokens: N}`）；请改用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)。自适应思考始终开启，`thinking: {type: "disabled"}` 会返回错误。
</Note>

<Note>
对于 Claude Opus 4.8 和 Claude Opus 4.7，请设置 `thinking: {type: "adaptive"}` 以启用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)，并使用 [effort 参数](/docs/zh-CN/build-with-claude/effort)来控制思考深度。在这两个模型上，不支持手动扩展思考（`thinking: {type: "enabled", budget_tokens: N}`），会返回 400 错误。使用自适应思考时，模型会根据每个请求决定何时以及思考多少，因此仅在需要时触发思考。对于 Claude Opus 4.6 和 Claude Sonnet 4.6，同样推荐使用自适应思考；手动配置在这些模型上仍然可用，但已弃用，将在未来的模型版本中移除。
</Note>

## 支持的模型 \{#supported-models}

所有当前的 Claude 模型均支持手动扩展思考（`thinking: {type: "enabled", budget_tokens: N}`），**但 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8 和 Claude Opus 4.7 除外**，在这些模型上不接受该配置并会返回 400 错误。部分模型具有特定于模式的行为：

- **Claude Fable 5 (`claude-fable-5`) 和 Claude Mythos 5 (`claude-mythos-5`)：** 不支持手动扩展思考，会返回 400 错误。[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)始终开启；请使用 [effort 参数](/docs/zh-CN/build-with-claude/effort)来控制思考深度。
- **Claude Opus 4.8 (claude-opus-4-8)：** 不支持手动扩展思考，会返回 400 错误。请改用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（`thinking: {type: "adaptive"}`）配合 [effort 参数](/docs/zh-CN/build-with-claude/effort)。模型会根据每个请求决定是否以及在多大程度上使用扩展思考。
- **Claude Opus 4.7 (claude-opus-4-7)：** 不再支持手动扩展思考。请改用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（`thinking: {type: "adaptive"}`）配合 [effort 参数](/docs/zh-CN/build-with-claude/effort)。
- **[Claude Mythos Preview](https://anthropic.com/glasswing)：** [自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)是默认设置；也接受 `thinking: {type: "enabled", budget_tokens: N}`。不支持 `thinking: {type: "disabled"}`，且 `display` 默认为 `"omitted"` 而非返回思考内容。传递 `display: "summarized"` 以接收摘要。
- **Claude Opus 4.6 (claude-opus-4-6)：** 推荐使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)；手动模式（`type: "enabled"`）已弃用但仍可用。
- **Claude Sonnet 4.6 (claude-sonnet-4-6)：** 推荐使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)；配合[交错模式](#interleaved-thinking)的手动模式（`type: "enabled"`）已弃用但仍可用。

<Note>
不同 Claude 模型版本的思考行为有所不同。详情请参阅[不同模型版本的思考差异](#differences-in-thinking-across-model-versions)。
</Note>

## 扩展思考的工作原理 \{#how-extended-thinking-works}

当扩展思考开启时，Claude 会创建 `thinking` 内容块，在其中输出其内部推理。Claude 会在构建最终响应之前整合来自此推理的见解。

API 响应包含 `thinking` 内容块，后跟 `text` 内容块。

以下是默认响应格式的示例：

```json
{
  "content": [
    {
      "type": "thinking",
      "thinking": "Let me analyze this step by step...",
      "signature": "WaUjzkypQ2mUEVM36O2TxuC06KN8xyfbJwyem2dw3URve/op91XWHOEBLLqIOMfFG/UvLEczmEsUjavL...."
    },
    {
      "type": "text",
      "text": "Based on my analysis..."
    }
  ]
}
```

有关扩展思考响应格式的更多信息，请参阅 [Messages API 参考](/docs/zh-CN/api/messages/create)。

## 如何使用扩展思考 \{#how-to-use-extended-thinking}

以下是在 Messages API 中使用扩展思考的示例：

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-sonnet-4-6",
    "max_tokens": 16000,
    "thinking": {
        "type": "enabled",
        "budget_tokens": 10000
    },
    "messages": [
        {
            "role": "user",
            "content": "Are there an infinite number of prime numbers such that n mod 4 == 3?"
        }
    ]
}'
```

```bash CLI
ant messages create \
  --transform content --format yaml \
    --model claude-sonnet-4-6 \
    --max-tokens 16000 \
    --thinking '{type: enabled, budget_tokens: 10000}' \
    --message '{role: user, content: Are there an infinite number of prime numbers such that n mod 4 == 3?}'
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16000,
    thinking={"type": "enabled", "budget_tokens": 10000},
    messages=[
        {
            "role": "user",
            "content": "Are there an infinite number of prime numbers such that n mod 4 == 3?",
        }
    ],
)

# 响应包含摘要化的思考块和文本块
for block in response.content:
    if block.type == "thinking":
        print(f"\nThinking summary: {block.thinking}")
    elif block.type == "text":
        print(f"\nResponse: {block.text}")
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 16000,
  thinking: {
    type: "enabled",
    budget_tokens: 10000
  },
  messages: [
    {
      role: "user",
      content: "Are there an infinite number of prime numbers such that n mod 4 == 3?"
    }
  ]
});

// 响应包含摘要化的思考块和文本块
for (const block of response.content) {
  if (block.type === "thinking") {
    console.log(`\nThinking summary: ${block.thinking}`);
  } else if (block.type === "text") {
    console.log(`\nResponse: ${block.text}`);
  }
}
```

```csharp C# hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 16000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 10000),
    Messages = [
        new() {
            Role = Role.User,
            Content = "Are there an infinite number of prime numbers such that n mod 4 == 3?"
        }
    ]
};

var message = await client.Messages.Create(parameters);

foreach (var block in message.Content)
{
    if (block.TryPickThinking(out ThinkingBlock? thinking))
    {
        Console.WriteLine($"\nThinking summary: {thinking.Thinking}");
    }
    else if (block.TryPickText(out TextBlock? text))
    {
        Console.WriteLine($"\nResponse: {text.Text}");
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

	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 16000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(10000),
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Are there an infinite number of prime numbers such that n mod 4 == 3?")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	for _, block := range response.Content {
		switch v := block.AsAny().(type) {
		case anthropic.ThinkingBlock:
			fmt.Printf("\nThinking summary: %s", v.Thinking)
		case anthropic.TextBlock:
			fmt.Printf("\nResponse: %s", v.Text)
		}
	}
}
```

```java Java hidelines={1..7,-1}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(16000L)
        .enabledThinking(10000L)
        .addUserMessage("Are there an infinite number of prime numbers such that n mod 4 == 3?")
        .build();

    Message response = client.messages().create(params);

    response.content().forEach(block -> {
        block.thinking().ifPresent(thinkingBlock ->
            IO.println("\nThinking summary: " + thinkingBlock.thinking())
        );
        block.text().ifPresent(textBlock ->
            IO.println("\nResponse: " + textBlock.text())
        );
    });
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->messages->create(
    maxTokens: 16000,
    messages: [
        [
            'role' => 'user',
            'content' => 'Are there an infinite number of prime numbers such that n mod 4 == 3?'
        ]
    ],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'enabled', 'budget_tokens' => 10000],
);

foreach ($message->content as $block) {
    if ($block->type === 'thinking') {
        echo "\nThinking summary: " . $block->thinking;
    } elseif ($block->type === 'text') {
        echo "\nResponse: " . $block->text;
    }
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 16000,
  thinking: {
    type: "enabled",
    budget_tokens: 10000
  },
  messages: [
    {
      role: "user",
      content: "Are there an infinite number of prime numbers such that n mod 4 == 3?"
    }
  ]
)

message.content.each do |block|
  case block.type
  when :thinking
    puts "\nThinking summary: #{block.thinking}"
  when :text
    puts "\nResponse: #{block.text}"
  end
end
```

</CodeGroup>

要开启扩展思考，请添加一个 `thinking` 对象，将 `type` 参数设置为 `enabled`，并将 `budget_tokens` 设置为扩展思考的指定令牌预算。对于 Claude Opus 4.6 和 Claude Sonnet 4.6，请改用 `type: "adaptive"`。详情请参阅[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)。虽然带有 `budget_tokens` 的 `type: "enabled"` 在这些模型上仍然可用，但已弃用，将在未来版本中移除。

`budget_tokens` 参数决定了 Claude 在其内部推理过程中允许使用的最大令牌数。此限制适用于完整的思考令牌，而非[摘要输出](#summarized-thinking)。更大的预算可以通过对复杂问题进行更彻底的分析来提高响应质量，尽管 Claude 可能不会使用分配的全部预算，尤其是在超过 32k 的范围内。

<Warning>
`budget_tokens` 在 Claude Opus 4.6 和 Claude Sonnet 4.6 上已[弃用](/docs/zh-CN/build-with-claude/overview#feature-availability)，将在未来的模型版本中移除。请改用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)配合 [effort 参数](/docs/zh-CN/build-with-claude/effort)来控制思考深度。
</Warning>

<Note>
[Claude Mythos Preview](https://anthropic.com/glasswing)、Claude Opus 4.8、Claude Opus 4.7 和 Claude Opus 4.6 支持最多 128k 输出令牌。Claude Sonnet 4.6 和 Claude Haiku 4.5 支持最多 64k。有关旧版模型的限制，请参阅[模型概述](/docs/zh-CN/about-claude/models/overview)。在 [Message Batches API](/docs/zh-CN/build-with-claude/batch-processing#extended-output-beta) 上，`output-300k-2026-03-24` [beta 标头](/docs/zh-CN/api/beta-headers)将 Claude Opus 4.8、Opus 4.7、Opus 4.6 和 Sonnet 4.6 的输出限制提高到 300k。
</Note>

`budget_tokens` 必须设置为小于 `max_tokens` 的值。但是，当使用[带工具的交错思考](#interleaved-thinking)时，您可以超过此限制，因为令牌限制变为您的整个上下文窗口。由于 `budget_tokens` 必须小于 `max_tokens`，扩展思考不能与 `max_tokens: 0`（[缓存预热](/docs/zh-CN/build-with-claude/prompt-caching#pre-warming-the-cache)）结合使用。

### 摘要思考 \{#summarized-thinking}

启用扩展思考后，Claude 4 模型的 Messages API 会返回 Claude 完整思考过程的摘要。摘要式思考在提供扩展思考全部智能优势的同时，可防止滥用。当思考配置中的 `display` 字段未设置或设置为 `"summarized"` 时，这是 Claude 4 模型的默认行为。在 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8、Claude Opus 4.7 和 [Claude Mythos Preview](https://anthropic.com/glasswing) 上，`display` 默认为 `"omitted"`，因此您必须显式设置 `display: "summarized"` 才能接收摘要式思考。

以下是关于摘要式思考的一些重要注意事项：

- 您需要为原始请求生成的完整思考令牌付费，而非摘要令牌。
- 计费的输出令牌数量将**不会匹配**您在响应中看到的令牌数量。
- 在 Claude 4 模型上，思考输出的前几行更为详尽，提供了详细的推理过程，这对提示工程尤其有帮助。[Claude Mythos Preview](https://anthropic.com/glasswing) 从第一个令牌开始就进行摘要，因此其思考块不会显示这种详尽的前导内容。
- 随着 Anthropic 不断改进扩展思考功能，摘要行为可能会发生变化。
- 摘要以最小的额外延迟保留了 Claude 思考过程的关键思路，从而实现可流式传输的用户体验。
- 摘要由与您在请求中指定的模型不同的另一个模型处理。思考模型不会看到摘要后的输出。

<Note>
在极少数情况下，如果您需要访问 Claude 4 模型的完整思考输出，请[联系 Anthropic 销售团队](mailto:sales@anthropic.com)。
</Note>

### 控制思考显示 \{#controlling-thinking-display}

思考配置中的 `display` 字段用于控制 API 响应中思考内容的返回方式。它接受两个值：

- `"summarized"`：思考块包含摘要化的思考文本。详情请参阅[摘要化思考](#summarized-thinking)。这是 Claude Opus 4.6、Claude Sonnet 4.6 以及更早的 Claude 4 模型的默认值。
- `"omitted"`：返回的思考块中 `thinking` 字段为空。`signature` 字段仍然携带加密的完整思考内容，以支持多轮对话的连续性（请参阅[思考加密](#thinking-encryption)）。这是 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8、Claude Opus 4.7 以及 [Claude Mythos Preview](https://anthropic.com/glasswing) 的默认值。

当您的应用程序不向用户展示思考内容时，设置 `display: "omitted"` 会非常有用。其主要优势在于**流式传输时更快获得首个文本令牌：**服务器会完全跳过思考令牌的流式传输，仅传递签名，因此最终的文本响应能够更早开始流式传输。

以下是关于省略思考的一些重要注意事项：

- 您仍需为完整的思考令牌付费。省略思考可降低延迟，但不会降低成本。
- 如果您在多轮对话中回传思考块，请原样传递。服务器会解密 `signature` 以重建原始思考内容，用于构建提示（请参阅[保留思考块](/docs/zh-CN/build-with-claude/extended-thinking#preserving-thinking-blocks)）。您在回传的省略块的 `thinking` 字段中放置的任何文本都将被忽略。
- 当 `thinking.type: "disabled"` 时，`display` 无效（因为没有内容可显示）。
- 当使用 `thinking.type: "adaptive"` 且模型针对简单请求跳过思考时，无论 `display` 设置为何值，都不会生成思考块。

<Note>
无论 `display` 设置为 `"summarized"` 还是 `"omitted"`，`signature` 字段都是相同的。支持在对话的不同轮次之间切换 `display` 值。
</Note>

<Note>
在 [Claude Mythos Preview](https://anthropic.com/glasswing) 上，`display` 默认为 `"omitted"`。本节中的示例显式传递了 `display`，因此适用于所有模型，但在 Mythos Preview 上，您可以不设置它并获得相同的行为。要在 Mythos Preview 上接收摘要思考，请显式设置 `display: "summarized"`。
</Note>

从不向最终用户展示思考内容的自动化流水线可以跳过通过网络接收思考令牌的开销。对延迟敏感的应用程序可以获得相同的推理质量，而无需在最终响应开始之前等待思考文本的流式传输。

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-sonnet-4-6",
    "max_tokens": 16000,
    "thinking": {
        "type": "enabled",
        "budget_tokens": 10000,
        "display": "omitted"
    },
    "messages": [
        {
            "role": "user",
            "content": "What is 27 * 453?"
        }
    ]
}'
```

```bash CLI
ant messages create \
  --model claude-sonnet-4-6 \
  --max-tokens 16000 \
  --transform content --format yaml \
    --thinking '{type: enabled, budget_tokens: 10000, display: omitted}' \
    --message '{role: user, content: "What is 27 * 453?"}'
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16000,
    thinking={
        "type": "enabled",
        "budget_tokens": 10000,
        "display": "omitted",
    },
    messages=[
        {"role": "user", "content": "What is 27 * 453?"},
    ],
)

for block in response.content:
    if block.type == "thinking":
        if block.thinking:
            print(f"Thinking: {block.thinking}")
        else:
            print("Thinking: [omitted]")
    elif block.type == "text":
        print(f"Response: {block.text}")
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 16000,
  thinking: {
    type: "enabled",
    budget_tokens: 10000,
    display: "omitted"
  },
  messages: [
    {
      role: "user",
      content: "What is 27 * 453?"
    }
  ]
});

for (const block of response.content) {
  if (block.type === "thinking") {
    if (block.thinking.length > 0) {
      console.log(`Thinking: ${block.thinking}`);
    } else {
      console.log("Thinking: [omitted]");
    }
  } else if (block.type === "text") {
    console.log(`Response: ${block.text}`);
  }
}
```

```csharp C# hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var message = await client.Messages.Create(new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 16000,
    Thinking = new ThinkingConfigEnabled
    {
        BudgetTokens = 10000,
        Display = ThinkingConfigEnabledDisplay.Omitted
    },
    Messages =
    [
        new() { Role = Role.User, Content = "What is 27 * 453?" }
    ]
});

foreach (var block in message.Content)
{
    if (block.TryPickThinking(out ThinkingBlock? thinking))
    {
        Console.WriteLine(string.IsNullOrEmpty(thinking.Thinking)
            ? "Thinking: [omitted]"
            : $"Thinking: {thinking.Thinking}");
    }
    else if (block.TryPickText(out TextBlock? text))
    {
        Console.WriteLine($"Response: {text.Text}");
    }
}
```

```go Go hidelines={1..12,-1}
package main

import (
	"cmp"
	"context"
	"fmt"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 16000,
		Thinking: anthropic.ThinkingConfigParamUnion{
			OfEnabled: &anthropic.ThinkingConfigEnabledParam{
				BudgetTokens: 10000,
				Display:      anthropic.ThinkingConfigEnabledDisplayOmitted,
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What is 27 * 453?")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	for _, block := range response.Content {
		switch v := block.AsAny().(type) {
		case anthropic.ThinkingBlock:
			fmt.Println("Thinking:", cmp.Or(v.Thinking, "[omitted]"))
		case anthropic.TextBlock:
			fmt.Println("Response:", v.Text)
		}
	}
}
```

```java Java hidelines={1..5,7}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.ThinkingConfigEnabled;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(16000L)
        .thinking(ThinkingConfigEnabled.builder()
            .budgetTokens(10000L)
            .display(ThinkingConfigEnabled.Display.OMITTED)
            .build())
        .addUserMessage("What is 27 * 453?")
        .build();

    Message message = client.messages().create(params);

    message.content().forEach(block -> {
        block.thinking().ifPresent(thinkingBlock -> {
            if (thinkingBlock.thinking().isEmpty()) {
                IO.println("Thinking: [omitted]");
            } else {
                IO.println("Thinking: " + thinkingBlock.thinking());
            }
        });
        block.text().ifPresent(textBlock ->
            IO.println("Response: " + textBlock.text())
        );
    });
}
```

```php PHP hidelines={1..3,8}
<?php

use Anthropic\Client;
use Anthropic\Messages\TextBlock;
use Anthropic\Messages\ThinkingBlock;
use Anthropic\Messages\ThinkingConfigEnabled;
use Anthropic\Messages\ThinkingConfigEnabled\Display;

$client = new Client();

$response = $client->messages->create(
    model: 'claude-sonnet-4-6',
    maxTokens: 16000,
    thinking: ThinkingConfigEnabled::with(
        budgetTokens: 10000,
        display: Display::OMITTED,
    ),
    messages: [
        ['role' => 'user', 'content' => 'What is 27 * 453?'],
    ],
);

foreach ($response->content as $block) {
    echo match (true) {
        $block instanceof ThinkingBlock && $block->thinking === '' => "Thinking: [omitted]\n",
        $block instanceof ThinkingBlock => "Thinking: {$block->thinking}\n",
        $block instanceof TextBlock => "Response: {$block->text}\n",
        default => '',
    };
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 16000,
  thinking: {
    type: :enabled,
    budget_tokens: 10000,
    # Ruby SDK 使用 `display_`（带尾部下划线）以避免
    # 遮蔽 Kernel#display；传输字段仍为 `display`。
    display_: :omitted
  },
  messages: [{role: "user", content: "What is 27 * 453?"}]
)

response.content.each do |block|
  case block.type
  when :thinking
    puts block.thinking.empty? ? "Thinking: [omitted]" : "Thinking: #{block.thinking}"
  when :text
    puts "Response: #{block.text}"
  end
end
```
</CodeGroup>

当设置 `display: "omitted"` 时，响应包含 `thinking` 字段为空的 `thinking` 块：

```json Output
{
  "content": [
    {
      "type": "thinking",
      "thinking": "",
      "signature": "EosnCkYICxIMMb3LzNrMu..."
    },
    {
      "type": "text",
      "text": "The answer is 12,231."
    }
  ]
}
```

当使用 `display: "omitted"` 进行流式传输时，不会发出 `thinking_delta` 事件；有关事件序列，请参阅下方的[流式传输思考](#streaming-thinking)。

### 流式传输思考 \{#streaming-thinking}

您可以使用 [server-sent events (SSE)](https://developer.mozilla.org/en-US/Web/API/Server-sent%5Fevents/Using%5Fserver-sent%5Fevents)（服务器发送事件）流式传输扩展思考响应。

当为扩展思考启用流式传输时，您会通过 `thinking_delta` 事件接收思考内容。

当设置 `display: "omitted"` 时，不会发出 `thinking_delta` 事件。请参阅[控制思考显示](#controlling-thinking-display)。

有关通过 Messages API 进行流式传输的更多文档，请参阅[流式传输消息](/docs/zh-CN/build-with-claude/streaming)。

以下是如何处理带思考的流式传输：

<CodeGroup tryInConsole={{ userPrompt: "What is the greatest common divisor of 1071 and 462?", thinkingBudgetTokens: 10000 }}>
```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-sonnet-4-6",
    "max_tokens": 16000,
    "stream": true,
    "thinking": {
        "type": "enabled",
        "budget_tokens": 10000
    },
    "messages": [
        {
            "role": "user",
            "content": "What is the greatest common divisor of 1071 and 462?"
        }
    ]
}'
```

```bash CLI
ant messages create --stream --format jsonl \
  --model claude-sonnet-4-6 \
  --max-tokens 16000 \
  --thinking '{type: enabled, budget_tokens: 10000}' \
  --message '{role: user, content: What is the greatest common divisor of 1071 and 462?}'
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

with client.messages.stream(
    model="claude-sonnet-4-6",
    max_tokens=16000,
    thinking={"type": "enabled", "budget_tokens": 10000},
    messages=[
        {
            "role": "user",
            "content": "What is the greatest common divisor of 1071 and 462?",
        }
    ],
) as stream:
    thinking_started = False
    response_started = False

    for event in stream:
        if event.type == "content_block_start":
            print(f"\nStarting {event.content_block.type} block...")
            # 为每个新块重置标志
            thinking_started = False
            response_started = False
        elif event.type == "content_block_delta":
            if event.delta.type == "thinking_delta":
                if not thinking_started:
                    print("Thinking: ", end="", flush=True)
                    thinking_started = True
                print(event.delta.thinking, end="", flush=True)
            elif event.delta.type == "text_delta":
                if not response_started:
                    print("Response: ", end="", flush=True)
                    response_started = True
                print(event.delta.text, end="", flush=True)
        elif event.type == "content_block_stop":
            print("\nBlock complete.")
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const stream = await client.messages.stream({
  model: "claude-sonnet-4-6",
  max_tokens: 16000,
  thinking: {
    type: "enabled",
    budget_tokens: 10000
  },
  messages: [
    {
      role: "user",
      content: "What is the greatest common divisor of 1071 and 462?"
    }
  ]
});

let thinkingStarted = false;
let responseStarted = false;

for await (const event of stream) {
  if (event.type === "content_block_start") {
    console.log(`\nStarting ${event.content_block.type} block...`);
    // 为每个新块重置标志
    thinkingStarted = false;
    responseStarted = false;
  } else if (event.type === "content_block_delta") {
    if (event.delta.type === "thinking_delta") {
      if (!thinkingStarted) {
        process.stdout.write("Thinking: ");
        thinkingStarted = true;
      }
      process.stdout.write(event.delta.thinking);
    } else if (event.delta.type === "text_delta") {
      if (!responseStarted) {
        process.stdout.write("Response: ");
        responseStarted = true;
      }
      process.stdout.write(event.delta.text);
    }
  } else if (event.type === "content_block_stop") {
    console.log("\nBlock complete.");
  }
}
```

```csharp C# hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 16000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 10000),
    Messages = [new() { Role = Role.User, Content = "What is the greatest common divisor of 1071 and 462?" }]
};

bool thinkingStarted = false;
bool responseStarted = false;

await foreach (var streamEvent in client.Messages.CreateStreaming(parameters))
{
    if (streamEvent.TryPickContentBlockStart(out var blockStart))
    {
        Console.WriteLine($"\nStarting {blockStart.ContentBlock.Type} block...");
        thinkingStarted = false;
        responseStarted = false;
    }
    else if (streamEvent.TryPickContentBlockDelta(out var blockDelta))
    {
        if (blockDelta.Delta.TryPickThinking(out var thinkingDelta))
        {
            if (!thinkingStarted)
            {
                Console.Write("Thinking: ");
                thinkingStarted = true;
            }
            Console.Write(thinkingDelta.Thinking);
        }
        else if (blockDelta.Delta.TryPickText(out var textDelta))
        {
            if (!responseStarted)
            {
                Console.Write("Response: ");
                responseStarted = true;
            }
            Console.Write(textDelta.Text);
        }
    }
    else if (streamEvent.TryPickContentBlockStop(out _))
    {
        Console.WriteLine("\nBlock complete.");
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

	stream := client.Messages.NewStreaming(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 16000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(10000),
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What is the greatest common divisor of 1071 and 462?")),
		},
	})

	thinkingStarted := false
	responseStarted := false

	for stream.Next() {
		event := stream.Current()
		switch eventVariant := event.AsAny().(type) {
		case anthropic.ContentBlockStartEvent:
			fmt.Printf("\nStarting %s block...\n", eventVariant.ContentBlock.Type)
			thinkingStarted = false
			responseStarted = false
		case anthropic.ContentBlockDeltaEvent:
			switch deltaVariant := eventVariant.Delta.AsAny().(type) {
			case anthropic.ThinkingDelta:
				if !thinkingStarted {
					fmt.Print("Thinking: ")
					thinkingStarted = true
				}
				fmt.Print(deltaVariant.Thinking)
			case anthropic.TextDelta:
				if !responseStarted {
					fmt.Print("Response: ")
					responseStarted = true
				}
				fmt.Print(deltaVariant.Text)
			}
		case anthropic.ContentBlockStopEvent:
			fmt.Println("\nBlock complete.")
		}
	}

	if err := stream.Err(); err != nil {
		log.Fatal(err)
	}
}
```

```java Java hidelines={1..6,-1}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(16000L)
        .enabledThinking(10000L)
        .addUserMessage("What is the greatest common divisor of 1071 and 462?")
        .build();

    try (var streamResponse = client.messages().createStreaming(params)) {
        streamResponse.stream().forEach(event -> {
            event.contentBlockStart().ifPresent(startEvent ->
                IO.println("\nStarting block...")
            );
            event.contentBlockDelta().ifPresent(deltaEvent -> {
                deltaEvent.delta().thinking().ifPresent(td ->
                    IO.print(td.thinking())
                );
                deltaEvent.delta().text().ifPresent(td ->
                    IO.print(td.text())
                );
            });
            event.contentBlockStop().ifPresent(stopEvent ->
                IO.println("\nBlock complete.")
            );
        });
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$thinkingStarted = false;
$responseStarted = false;

$stream = $client->messages->createStream(
    maxTokens: 16000,
    messages: [
        ['role' => 'user', 'content' => 'What is the greatest common divisor of 1071 and 462?']
    ],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'enabled', 'budget_tokens' => 10000],
);

foreach ($stream as $event) {
    if ($event->type === 'content_block_start') {
        echo "\nStarting {$event->contentBlock->type} block...\n";
        $thinkingStarted = false;
        $responseStarted = false;
    } elseif ($event->type === 'content_block_delta') {
        if ($event->delta->type === 'thinking_delta') {
            if (!$thinkingStarted) {
                echo "Thinking: ";
                $thinkingStarted = true;
            }
            echo $event->delta->thinking;
        } elseif ($event->delta->type === 'text_delta') {
            if (!$responseStarted) {
                echo "Response: ";
                $responseStarted = true;
            }
            echo $event->delta->text;
        }
    } elseif ($event->type === 'content_block_stop') {
        echo "\nBlock complete.\n";
    }
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

thinking_started = false
response_started = false

stream = client.messages.stream(
  model: "claude-sonnet-4-6",
  max_tokens: 16000,
  thinking: {
    type: "enabled",
    budget_tokens: 10000
  },
  messages: [
    { role: "user", content: "What is the greatest common divisor of 1071 and 462?" }
  ]
)

stream.each do |event|
  case event.type
  when :content_block_start
    puts "\nStarting #{event.content_block.type} block..."
    thinking_started = false
    response_started = false
  when :content_block_delta
    if event.delta.type == :thinking_delta
      unless thinking_started
        print "Thinking: "
        thinking_started = true
      end
      print event.delta.thinking
    elsif event.delta.type == :text_delta
      unless response_started
        print "Response: "
        response_started = true
      end
      print event.delta.text
    end
  when :content_block_stop
    puts "\nBlock complete."
  end
end
```

</CodeGroup>

流式传输输出示例：
```sse Output
event: message_start
data: {"type": "message_start", "message": {"id": "msg_01...", "type": "message", "role": "assistant", "content": [], "model": "claude-sonnet-4-6", "stop_reason": null, "stop_sequence": null}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "I need to find the GCD of 1071 and 462 using the Euclidean algorithm.\n\n1071 = 2 × 462 + 147"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "\n462 = 3 × 147 + 21\n147 = 7 × 21 + 0\n\nSo GCD(1071, 462) = 21"}}

// Additional thinking deltas...

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pkiMOYds..."}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: content_block_start
data: {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "The greatest common divisor of 1071 and 462 is **21**."}}

// Additional text deltas...

event: content_block_stop
data: {"type": "content_block_stop", "index": 1}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": null}}

event: message_stop
data: {"type": "message_stop"}
```

当设置 `display: "omitted"` 时，思考块打开，单个 `signature_delta` 到达，然后块关闭，没有任何 `thinking_delta` 事件。文本流式传输随即开始：

```sse Output
event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EosnCkYICxIMMb3LzNrMu..."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}
```

<Note>
当使用启用了思考的流式传输时，您可能会注意到文本有时以较大的块到达，与较小的逐令牌传递交替出现。这是预期行为，尤其是对于思考内容。

流式传输系统需要批量处理内容以获得最佳性能，这可能导致这种"分块"传递模式，流式传输事件之间可能存在延迟。
</Note>

## 扩展思考与工具使用 \{#extended-thinking-with-tool-use}

扩展思考可以与[工具使用](/docs/zh-CN/agents-and-tools/tool-use/overview)一起使用，使 Claude 能够对工具选择和结果处理进行推理。

在将扩展思考与工具使用结合使用时，请注意以下限制：

1. **工具选择限制**：带思考的工具使用仅支持 `tool_choice: {"type": "auto"}`（默认值）或 `tool_choice: {"type": "none"}`。使用 `tool_choice: {"type": "any"}` 或 `tool_choice: {"type": "tool", "name": "..."}` 将导致错误，因为这些选项强制使用工具，这与扩展思考不兼容。

2. **保留思考块**：在工具使用期间，您必须将最后一条助手消息的 `thinking` 块传回 API。将完整的未修改块传回 API 以保持推理连续性。

### 在对话中切换思考模式 \{#toggling-thinking-modes-in-conversations}

您不能在助手回合中途切换思考，包括在工具使用循环期间。整个助手回合应在单一思考模式下运行：

- **如果启用了思考**，最后的助手回合应以思考块开始。
- **如果禁用了思考**，最后的助手回合不应包含任何思考块。

从模型的角度来看，**工具使用循环是助手回合的一部分**。助手回合在 Claude 完成其完整响应之前不会结束，这可能包括多个工具调用和结果。

例如，以下序列全部属于**单个助手回合**：
```text
User: "What's the weather in Paris?"
Assistant: [thinking] + [tool_use: get_weather]
User: [tool_result: "20°C, sunny"]
Assistant: [text: "The weather in Paris is 20°C and sunny"]
```

即使有多条 API 消息，工具使用循环在概念上也是一个连续助手响应的一部分。

#### 思考的优雅降级 \{#graceful-thinking-degradation}

当发生回合中途的思考冲突时（例如在工具使用循环期间开启或关闭思考），API 会自动为该请求禁用思考。为了保持模型质量并保持在分布范围内，API 可能会：

- 当思考块会创建无效的回合结构时，从对话中剥离思考块
- 当对话历史与启用思考不兼容时，为当前请求禁用思考

这意味着尝试在回合中途切换思考不会导致错误，但该请求的思考将被静默禁用。要确认思考是否处于活动状态，请检查响应中是否存在 `thinking` 块。

#### 实用指导 \{#practical-guidance}

**最佳实践**：在每个回合开始时规划您的思考策略，而不是尝试在回合中途切换。

**示例：完成回合后切换思考**
```text
User: "What's the weather?"
Assistant: [tool_use] (thinking disabled)
User: [tool_result]
Assistant: [text: "It's sunny"]
User: "What about tomorrow?"
Assistant: [thinking] + [text: "..."] (thinking enabled - new turn)
```

通过在切换思考之前完成助手回合，您可以确保新请求实际启用了思考。

<Note>
切换思考模式也会使消息历史的提示缓存失效。更多详情，请参阅[扩展思考与提示缓存](#extended-thinking-with-prompt-caching)部分。
</Note>

<section title="示例：随工具结果传递思考块">

以下是一个实际示例，展示如何在提供工具结果时保留思考块：

<CodeGroup>
```bash CLI
ant messages create --transform content <<'YAML'
model: claude-sonnet-4-6
max_tokens: 16000
thinking:
  type: enabled
  budget_tokens: 10000
tools:
  - name: get_weather
    description: Get current weather for a location
    input_schema:
      type: object
      properties:
        location:
          type: string
      required:
        - location
messages:
  - role: user
    content: "What's the weather in Paris?"
YAML
```

```python Python hidelines={1}
import anthropic

client = anthropic.Anthropic()

weather_tool = {
    "name": "get_weather",
    "description": "Get current weather for a location",
    "input_schema": {
        "type": "object",
        "properties": {"location": {"type": "string"}},
        "required": ["location"],
    },
}

# 第一个请求 - Claude 以思考和工具请求作为响应
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16000,
    thinking={"type": "enabled", "budget_tokens": 10000},
    tools=[weather_tool],
    messages=[{"role": "user", "content": "What's the weather in Paris?"}],
)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const weatherTool: Anthropic.Tool = {
  name: "get_weather",
  description: "Get current weather for a location",
  input_schema: {
    type: "object",
    properties: {
      location: { type: "string" }
    },
    required: ["location"]
  }
};

// 第一个请求 - Claude 以思考和工具请求作为响应
const response = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 16000,
  thinking: {
    type: "enabled",
    budget_tokens: 10000
  },
  tools: [weatherTool],
  messages: [{ role: "user", content: "What's the weather in Paris?" }]
});
```

```csharp C# hidelines={1..4}
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var weatherTool = new ToolUnion(new Tool()
{
    Name = "get_weather",
    Description = "Get current weather for a location",
    InputSchema = new InputSchema()
    {
        Properties = new Dictionary<string, JsonElement>
        {
            ["location"] = JsonSerializer.SerializeToElement(new { type = "string" }),
        },
        Required = ["location"],
    },
});

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 16000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 10000),
    Tools = [weatherTool],
    Messages = [new() { Role = Role.User, Content = "What's the weather in Paris?" }]
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

	weatherTool := anthropic.ToolUnionParam{
		OfTool: &anthropic.ToolParam{
			Name:        "get_weather",
			Description: anthropic.String("Get current weather for a location"),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{
					"location": map[string]any{
						"type": "string",
					},
				},
				Required: []string{"location"},
			},
		},
	}

	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 16000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(10000),
		Tools:     []anthropic.ToolUnionParam{weatherTool},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What's the weather in Paris?")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..11,-1}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.Tool;
import com.anthropic.core.JsonValue;
import java.util.List;
import java.util.Map;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(16000L)
        .enabledThinking(10000L)
        .addTool(Tool.builder()
            .name("get_weather")
            .description("Get current weather for a location")
            .inputSchema(Tool.InputSchema.builder()
                .properties(JsonValue.from(Map.of(
                    "location", Map.of("type", "string")
                )))
                .required(List.of("location"))
                .build())
            .build())
        .addUserMessage("What's the weather in Paris?")
        .build();

    Message response = client.messages().create(params);
    IO.println(response);
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$weatherTool = [
    'name' => 'get_weather',
    'description' => 'Get current weather for a location',
    'input_schema' => [
        'type' => 'object',
        'properties' => [
            'location' => ['type' => 'string']
        ],
        'required' => ['location']
    ]
];

$message = $client->messages->create(
    maxTokens: 16000,
    messages: [
        ['role' => 'user', 'content' => "What's the weather in Paris?"]
    ],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'enabled', 'budget_tokens' => 10000],
    tools: [$weatherTool],
);
echo $message;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

weather_tool = {
  name: "get_weather",
  description: "Get current weather for a location",
  input_schema: {
    type: "object",
    properties: {
      location: { type: "string" }
    },
    required: ["location"]
  }
}

message = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 16000,
  thinking: {
    type: "enabled",
    budget_tokens: 10000
  },
  tools: [weather_tool],
  messages: [
    { role: "user", content: "What's the weather in Paris?" }
  ]
)
puts message
```

</CodeGroup>

API 响应包含 thinking、text 和 tool_use 块：

```json Output
{
  "content": [
    {
      "type": "thinking",
      "thinking": "The user wants to know the current weather in Paris. I have access to a function `get_weather`...",
      "signature": "BDaL4VrbR2Oj0hO4XpJxT28J5TILnCrrUXoKiiNBZW9P+nr8XSj1zuZzAl4egiCCpQNvfyUuFFJP5CncdYZEQPPmLxYsNrcs...."
    },
    {
      "type": "text",
      "text": "I can help you get the current weather information for Paris. Let me check that for you"
    },
    {
      "type": "tool_use",
      "id": "toolu_01CswdEQBMshySk6Y9DFKrfq",
      "name": "get_weather",
      "input": {
        "location": "Paris"
      }
    }
  ]
}
```

现在让我们继续对话并使用该工具

<CodeGroup>
```bash CLI
# 第一轮：捕获助手内容数组（thinking + tool_use，
# 保留完整签名）并序列化为紧凑 JSON。
ASSISTANT_CONTENT=$(ant messages create \
  --transform content <<'YAML'
model: claude-sonnet-4-6
max_tokens: 16000
thinking:
  type: enabled
  budget_tokens: 10000
tools:
  - name: get_weather
    description: Get the current weather in a given location
    input_schema:
      type: object
      properties:
        location:
          type: string
          description: The city and state
      required: [location]
messages:
  - role: user
    content: What's the weather in Paris?
YAML
)

TOOL_USE_ID=$(printf '%s' "$ASSISTANT_CONTENT" \
  | grep -o 'toolu_[A-Za-z0-9]*')

# 第二轮：将捕获的块作为助手消息传回。
# thinking 块必须与 tool_use 块一同传递。
ant messages create <<YAML
model: claude-sonnet-4-6
max_tokens: 16000
thinking:
  type: enabled
  budget_tokens: 10000
tools:
  - name: get_weather
    description: Get the current weather in a given location
    input_schema:
      type: object
      properties:
        location:
          type: string
          description: The city and state
      required: [location]
messages:
  - role: user
    content: What's the weather in Paris?
  - role: assistant
    content: $ASSISTANT_CONTENT
  - role: user
    content:
      - type: tool_result
        tool_use_id: $TOOL_USE_ID
        content: "Current temperature: 88°F"
YAML
```

```python Python hidelines={1}
import anthropic

client = anthropic.Anthropic()
weather_tool = {
    "name": "get_weather",
    "description": "Get the current weather in a given location",
    "input_schema": {
        "type": "object",
        "properties": {
            "location": {"type": "string", "description": "The city and state"}
        },
        "required": ["location"],
    },
}
response = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16000,
    thinking={"type": "enabled", "budget_tokens": 10000},
    tools=[weather_tool],
    messages=[{"role": "user", "content": "What's the weather in Paris?"}],
)
# 提取思考块和工具使用块
thinking_block = next(
    (block for block in response.content if block.type == "thinking"), None
)
tool_use_block = next(
    (block for block in response.content if block.type == "tool_use"), None
)

# 调用您的实际天气 API，此处是您实际调用 API 的位置
# 假设这是我们收到的返回结果
weather_data = {"temperature": 88}

# 第二次请求 - 包含思考块和工具结果
# 响应中不会生成新的思考块
continuation = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=16000,
    thinking={"type": "enabled", "budget_tokens": 10000},
    tools=[weather_tool],
    messages=[
        {"role": "user", "content": "What's the weather in Paris?"},
        # 请注意，thinking_block 和 tool_use_block 都被传入
        # 如果未传入，则会引发错误
        {"role": "assistant", "content": [thinking_block, tool_use_block]},
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use_block.id,
                    "content": f"Current temperature: {weather_data['temperature']}°F",
                }
            ],
        },
    ],
)
print(continuation)
```

```typescript TypeScript nocheck
// 提取思考块和工具使用块
const thinkingBlock = response.content.find(
  (block): block is Anthropic.ThinkingBlock => block.type === "thinking"
);
const toolUseBlock = response.content.find(
  (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
);

// 调用您的实际天气 API，此处是您实际进行 API 调用的位置
// 假设这是我们收到的返回结果
const weatherData = { temperature: 88 };

if (thinkingBlock && toolUseBlock) {
  // 第二次请求 - 包含思考块和工具结果
  // 响应中不会生成新的思考块
  const continuation = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    thinking: {
      type: "enabled",
      budget_tokens: 10000
    },
    tools: [weatherTool],
    messages: [
      { role: "user", content: "What's the weather in Paris?" },
      // 请注意，thinkingBlock 和 toolUseBlock 都被一并传入
      // 如果未传入此内容，将会引发错误
      { role: "assistant", content: [thinkingBlock, toolUseBlock] },
      {
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: toolUseBlock.id,
            content: `Current temperature: ${weatherData.temperature}°F`
          }
        ]
      }
    ]
  });
  console.log(continuation);
}
```

```csharp C# hidelines={1..4}
using System.Text.Json;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var weatherTool = new ToolUnion(new Tool()
{
    Name = "get_weather",
    Description = "Get current weather for a location",
    InputSchema = new InputSchema()
    {
        Properties = new Dictionary<string, JsonElement>
        {
            ["location"] = JsonSerializer.SerializeToElement(new { type = "string", description = "City name" }),
        },
        Required = ["location"],
    },
});

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 16000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 10000),
    Tools = [weatherTool],
    Messages = [
        new() { Role = Role.User, Content = "What is the weather in Paris?" }
    ]
};

var response = await client.Messages.Create(parameters);

// 提取 tool_use 块以获取其 ID，用于工具结果
ToolUseBlock? toolUseBlock = null;
foreach (var block in response.Content)
{
    if (block.TryPickToolUse(out var toolUse))
    {
        toolUseBlock = toolUse;
    }
}

var weatherData = new { temperature = 88 };

// 构建包含工具结果的后续请求
var continuationParams = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 16000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 10000),
    Tools = [weatherTool],
    Messages = [
        new() { Role = Role.User, Content = "What is the weather in Paris?" },
        // response.Content 包含思考块；必须将它们传回
        new() { Role = Role.Assistant, Content = response.Content.Select(block => new ContentBlockParam(block.Json)).ToList() },
        new() { Role = Role.User, Content = new MessageParamContent(new List<ContentBlockParam>
        {
            new ContentBlockParam(new ToolResultBlockParam()
            {
                ToolUseID = toolUseBlock?.ID ?? "",
                Content = $"Current temperature: {weatherData.temperature}°F"
            })
        })}
    ]
};

var continuation = await client.Messages.Create(continuationParams);
Console.WriteLine(continuation);
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

	weatherTool := anthropic.ToolUnionParam{
		OfTool: &anthropic.ToolParam{
			Name:        "get_weather",
			Description: anthropic.String("Get current weather for a location"),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{
					"location": map[string]any{
						"type":        "string",
						"description": "City name",
					},
				},
				Required: []string{"location"},
			},
		},
	}

	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 16000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(10000),
		Tools:     []anthropic.ToolUnionParam{weatherTool},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What is the weather in Paris?")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	var toolUseBlock anthropic.ToolUseBlock
	for _, block := range response.Content {
		switch v := block.AsAny().(type) {
		case anthropic.ToolUseBlock:
			toolUseBlock = v
		}
	}

	weatherData := map[string]int{"temperature": 88}

	continuation, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 16000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(10000),
		Tools:     []anthropic.ToolUnionParam{weatherTool},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What is the weather in Paris?")),
			response.ToParam(),
			anthropic.NewUserMessage(
				anthropic.NewToolResultBlock(toolUseBlock.ID, fmt.Sprintf("Current temperature: %d°F", weatherData["temperature"]), false),
			),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(continuation)
}
```

```java Java hidelines={1..10,13..16}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.Tool;
import com.anthropic.models.messages.ToolResultBlockParam;
import com.anthropic.models.messages.ToolUseBlock;
import com.anthropic.models.messages.ToolUseBlockParam;
import com.anthropic.models.messages.ThinkingBlock;
import com.anthropic.models.messages.ThinkingBlockParam;
import com.anthropic.core.JsonValue;
import java.util.List;
import java.util.Map;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    Tool weatherTool = Tool.builder()
        .name("get_weather")
        .description("Get current weather for a location")
        .inputSchema(Tool.InputSchema.builder()
            .properties(JsonValue.from(Map.of(
                "location", Map.of("type", "string", "description", "City name")
            )))
            .required(List.of("location"))
            .build())
        .build();

    MessageCreateParams initialParams = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(16000L)
        .enabledThinking(10000L)
        .addTool(weatherTool)
        .addUserMessage("What is the weather in Paris?")
        .build();

    Message response = client.messages().create(initialParams);

    ThinkingBlock thinkingBlock = null;
    ToolUseBlock toolUseBlock = null;
    for (var block : response.content()) {
        if (block.thinking().isPresent()) {
            thinkingBlock = block.thinking().get();
        }
        if (block.toolUse().isPresent()) {
            toolUseBlock = block.toolUse().get();
        }
    }

    int temperature = 88;

    // 第二个请求：传回思考块和工具结果
    MessageCreateParams continuationParams = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(16000L)
        .enabledThinking(10000L)
        .addTool(weatherTool)
        .addUserMessage("What is the weather in Paris?")
        .addAssistantMessageOfBlockParams(List.of(
            ContentBlockParam.ofThinking(ThinkingBlockParam.builder()
                .thinking(thinkingBlock.thinking())
                .signature(thinkingBlock.signature())
                .build()),
            ContentBlockParam.ofToolUse(ToolUseBlockParam.builder()
                .id(toolUseBlock.id())
                .name(toolUseBlock.name())
                .input(toolUseBlock._input())
                .build())
        ))
        .addUserMessageOfBlockParams(List.of(
            ContentBlockParam.ofToolResult(
                ToolResultBlockParam.builder()
                    .toolUseId(toolUseBlock.id())
                    .content("Current temperature: " + temperature + "°F")
                    .build()
            )
        ))
        .build();

    Message continuation = client.messages().create(continuationParams);
    IO.println(continuation);
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$weatherTool = [
    'name' => 'get_weather',
    'description' => 'Get current weather for a location',
    'input_schema' => [
        'type' => 'object',
        'properties' => [
            'location' => [
                'type' => 'string',
                'description' => 'City name'
            ]
        ],
        'required' => ['location']
    ]
];

$response = $client->messages->create(
    maxTokens: 16000,
    messages: [
        ['role' => 'user', 'content' => 'What is the weather in Paris?']
    ],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'enabled', 'budget_tokens' => 10000],
    tools: [$weatherTool],
);

$thinkingBlock = null;
$toolUseBlock = null;
foreach ($response->content as $block) {
    if ($block->type === 'thinking') {
        $thinkingBlock = $block;
    }
    if ($block->type === 'tool_use') {
        $toolUseBlock = $block;
    }
}

$weatherData = ['temperature' => 88];

$continuation = $client->messages->create(
    maxTokens: 16000,
    messages: [
        ['role' => 'user', 'content' => 'What is the weather in Paris?'],
        ['role' => 'assistant', 'content' => [$thinkingBlock, $toolUseBlock]],
        ['role' => 'user', 'content' => [
            [
                'type' => 'tool_result',
                'tool_use_id' => $toolUseBlock->id,
                'content' => "Current temperature: {$weatherData['temperature']}°F"
            ]
        ]]
    ],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'enabled', 'budget_tokens' => 10000],
    tools: [$weatherTool],
);

echo $continuation;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

weather_tool = {
  name: "get_weather",
  description: "Get current weather for a location",
  input_schema: {
    type: "object",
    properties: {
      location: { type: "string", description: "City name" }
    },
    required: ["location"]
  }
}

response = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 16000,
  thinking: {
    type: "enabled",
    budget_tokens: 10000
  },
  tools: [weather_tool],
  messages: [
    { role: "user", content: "What is the weather in Paris?" }
  ]
)

thinking_block = response.content.find { |block| block.type == :thinking }
tool_use_block = response.content.find { |block| block.type == :tool_use }

raise "No tool_use block found" unless tool_use_block

weather_data = { temperature: 88 }

continuation = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 16000,
  thinking: {
    type: "enabled",
    budget_tokens: 10000
  },
  tools: [weather_tool],
  messages: [
    { role: "user", content: "What is the weather in Paris?" },
    { role: "assistant", content: [thinking_block, tool_use_block] },
    { role: "user", content: [
      {
        type: "tool_result",
        tool_use_id: tool_use_block.id,
        content: "Current temperature: #{weather_data[:temperature]}°F"
      }
    ] }
  ]
)

puts continuation
```

</CodeGroup>

API 响应现在**仅**包含文本

```json Output
{
  "content": [
    {
      "type": "text",
      "text": "Currently in Paris, the temperature is 88°F (31°C)"
    }
  ]
}
```

</section>

### 保留思考块 \{#preserving-thinking-blocks}

在工具使用期间，您必须将 `thinking` 块传回 API，并且必须将完整的未修改块传回 API。这对于维护模型的推理流程和对话完整性至关重要。

<Tip>
虽然您可以省略先前 `assistant` 角色回合中的 `thinking` 块，但对于任何多回合对话，始终将所有思考块传回 API。API 会：
- 自动过滤提供的思考块
- 使用保留模型推理所需的相关思考块
- 仅对显示给 Claude 的块的输入令牌计费

保留哪些块取决于模型。有关每个类别的默认值，请参阅[按模型划分的思考块保留](#thinking-block-preservation-in-claude-opus-45-and-later)。要覆盖默认值，请使用 [`clear_thinking_20251015` 上下文编辑策略](/docs/zh-CN/build-with-claude/context-editing#thinking-block-clearing)。
</Tip>

<Note>
在对话期间切换思考模式时，请记住整个助手回合（包括工具使用循环）必须在单一思考模式下运行。更多详情，请参阅[在对话中切换思考模式](#toggling-thinking-modes-in-conversations)。
</Note>

当 Claude 调用工具时，它会暂停构建响应以等待外部信息。当工具结果返回时，Claude 会继续构建该现有响应。这就需要在工具使用期间保留思考块，原因如下：

1. **推理连续性**：思考块捕获了 Claude 导致工具请求的逐步推理。当您发布工具结果时，包含原始思考可确保 Claude 能够从中断处继续其推理。

2. **上下文维护**：虽然工具结果在 API 结构中显示为用户消息，但它们是连续推理流程的一部分。保留思考块可在多个 API 调用之间维护此概念流程。有关上下文管理的更多信息，请参阅[上下文窗口指南](/docs/zh-CN/build-with-claude/context-windows)。

**重要提示**：提供 `thinking` 块时，连续 `thinking` 块的整个序列必须与模型在原始请求期间生成的输出相匹配；您不能重新排列或修改这些块的序列。

<Note>
如果思考块被修改，API 会返回 400 `invalid_request_error`，其消息包含 `` `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified ``。最常见的原因是应用程序代码按类型过滤内容块并丢弃了 `redacted_thinking` 块，或者重建了助手消息而不是原样回传。有关完整错误和修复步骤，请参阅[思考块不能被修改](/docs/zh-CN/api/errors#thinking-blocks-cannot-be-modified)。
</Note>

### 交错思考 \{#interleaved-thinking}

Claude 4 模型中带工具使用的扩展思考支持"interleaved thinking"（交错思考），这使 Claude 能够在工具调用之间进行思考，并在接收工具结果后进行更复杂的推理。

通过交错思考，Claude 可以：
- 在决定下一步做什么之前对工具调用的结果进行推理
- 在多个工具调用之间穿插推理步骤
- 根据中间结果做出更细致的决策

**模型支持：**
- **Claude Opus 4.8**：使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（Claude Opus 4.8 上唯一支持的思考模式）时，交错思考会自动启用。无需 beta 标头。
- **[Claude Mythos Preview](https://anthropic.com/glasswing)**：交错思考自动发生。每个工具间推理步骤都会移入思考块而非纯文本，并且思考块默认跨回合保留。无需也不支持 beta 标头。
- **Claude Opus 4.7**：使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（Opus 4.7 上唯一支持的思考模式）时，交错思考会自动启用。无需 beta 标头。
- **Claude Opus 4.6**：使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)时，交错思考会自动启用。无需 beta 标头。`interleaved-thinking-2025-05-14` beta 标头在 Opus 4.6 上已**弃用**，如果包含则会被安全忽略。
- **Claude Sonnet 4.6**：使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（推荐）时，交错思考会自动启用。配合手动扩展思考（`thinking: {type: "enabled"}`）的 `interleaved-thinking-2025-05-14` beta 标头仍然可用但已弃用。
- **其他 Claude 4 模型**（Opus 4.5、Opus 4.1（已弃用）、Opus 4（已弃用）、Sonnet 4.5、Sonnet 4（已弃用））：在您的 API 请求中添加 [beta 标头](/docs/zh-CN/api/beta-headers) `interleaved-thinking-2025-05-14` 以启用交错思考。

以下是交错思考的一些重要注意事项：
- 使用交错思考时，`budget_tokens` 可以超过 `max_tokens` 参数，因为它代表一个助手回合内所有思考块的总预算。
- 交错思考仅支持[通过 Messages API 使用的工具](/docs/zh-CN/agents-and-tools/tool-use/overview)。
- Claude API 和 [AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 在对任何模型的请求中接受 `interleaved-thinking-2025-05-14` 而不返回错误。在不支持交错思考的模型上，该标头会被忽略。在 Claude Opus 4.8、Claude Opus 4.7 和 Claude Opus 4.6 上，它已弃用并被安全忽略。在 Claude Mythos Preview 上，不需要该标头且会被安全忽略。
- 在合作伙伴运营的平台上（例如 [Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock) 和 [Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai)），如果您将 `interleaved-thinking-2025-05-14` 传递给 Claude Opus 4.8、Claude Opus 4.7、Claude Opus 4.6、Claude Sonnet 4.6、Claude Opus 4.5、Claude Opus 4.1（已弃用）、Opus 4（已弃用）、Sonnet 4.5 或 Sonnet 4（已弃用）以外的任何模型，您的请求将失败。

<section title="不使用交错思考的工具使用">

不使用交错思考时，Claude 在助手回合开始时思考一次。工具结果之后的后续响应继续进行，不会产生新的思考块。

```text nowrap
User: "What's the total revenue if we sold 150 units at $50 each,
       and how does this compare to our average monthly revenue?"

Turn 1: [thinking] "I need to calculate 150 * $50, then check the database..."
        [tool_use: calculator] { "expression": "150 * 50" }
  ↓ tool result: "7500"

Turn 2: [tool_use: database_query] { "query": "SELECT AVG(revenue)..." }
        ↑ no thinking block
  ↓ tool result: "5200"

Turn 3: [text] "The total revenue is $7,500, which is 44% above your
        average monthly revenue of $5,200."
        ↑ no thinking block
```

</section>

<section title="使用交错思考的工具使用">

启用交错思考后，Claude 可以在接收每个工具结果后进行思考，使其能够在继续之前对中间结果进行推理。

```text nowrap
User: "What's the total revenue if we sold 150 units at $50 each,
       and how does this compare to our average monthly revenue?"

Turn 1: [thinking] "I need to calculate 150 * $50 first..."
        [tool_use: calculator] { "expression": "150 * 50" }
  ↓ tool result: "7500"

Turn 2: [thinking] "Got $7,500. Now I should query the database to compare..."
        [tool_use: database_query] { "query": "SELECT AVG(revenue)..." }
        ↑ thinking after receiving calculator result
  ↓ tool result: "5200"

Turn 3: [thinking] "$7,500 vs $5,200 average - that's a 44% increase..."
        [text] "The total revenue is $7,500, which is 44% above your
        average monthly revenue of $5,200."
        ↑ thinking before final answer
```

</section>

## 扩展思考与提示缓存 \{#extended-thinking-with-prompt-caching}

带思考的[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)有几个重要的注意事项：

<Tip>
扩展思考任务通常需要超过 5 分钟才能完成。考虑使用 [1 小时缓存持续时间](/docs/zh-CN/build-with-claude/prompt-caching#1-hour-cache-duration)，以在较长的思考会话和多步骤工作流程中保持缓存命中。
</Tip>

**思考块上下文移除**
- 在早期的 Opus/Sonnet 模型和所有 Haiku 模型上，先前回合的思考块会从上下文中移除，这可能会影响缓存断点。在 Opus 4.5+ 和 Sonnet 4.6+ 上，它们默认保留。
- 在使用工具使用继续对话时，思考块会被缓存，并在从缓存读取时计为输入令牌
- 这产生了一个权衡：虽然思考块在视觉上不占用上下文窗口空间，但在缓存时它们仍然计入您的输入令牌使用量
- 如果思考被禁用，并且您在当前工具使用回合中传递了思考内容，则思考内容将被剥离，并且该请求的思考将保持禁用状态

**缓存失效模式**
- 对思考参数的更改（启用/禁用或预算分配）会使消息缓存断点失效
- [交错思考](#interleaved-thinking)会放大缓存失效，因为思考块可能出现在多个[工具调用](#extended-thinking-with-tool-use)之间
- 尽管思考参数更改或块移除，系统提示和工具仍保持缓存

<Note>
在早期的 Opus/Sonnet 模型和所有 Haiku 模型上，思考块会被移除以进行缓存和上下文计算；在 Opus 4.5+ 和 Sonnet 4.6+ 上，它们默认保留。无论哪种情况，在使用[工具使用](#extended-thinking-with-tool-use)继续对话时都必须保留它们，尤其是使用[交错思考](#interleaved-thinking)时。
</Note>

### 理解思考块缓存行为 \{#understanding-thinking-block-caching-behavior}

当将扩展思考与工具使用结合使用时，思考块表现出影响令牌计数的特定缓存行为：

**工作原理：**

1. 仅当您发出包含工具结果的后续请求时才会发生缓存
2. 发出后续请求时，先前的对话历史（包括思考块）可以被缓存
3. 这些缓存的思考块在从缓存读取时计为您使用指标中的输入令牌
4. 当包含非工具结果的用户块时：在 Opus 4.5+ 和 Sonnet 4.6+ 上，先前的思考块会被保留；在早期的 Opus/Sonnet 模型和所有 Haiku 模型上，所有先前的思考块都会被忽略并从上下文中剥离

**详细示例流程：**

**请求 1：**
```text
User: "What's the weather in Paris?"
```
**响应 1：**
```text
[thinking_block_1] + [tool_use block 1]
```

**请求 2：**
```text
User: ["What's the weather in Paris?"],
Assistant: [thinking_block_1] + [tool_use block 1],
User: [tool_result_1, cache=True]
```
**响应 2：**
```text
[thinking_block_2] + [text block 2]
```
请求 2 写入请求内容的缓存（而非响应）。缓存包括原始用户消息、第一个思考块、工具使用块和工具结果。

**请求 3：**
```text
User: ["What's the weather in Paris?"],
Assistant: [thinking_block_1] + [tool_use block 1],
User: [tool_result_1, cache=True],
Assistant: [thinking_block_2] + [text block 2],
User: [Text response, cache=True]
```
对于 Opus 4.5+ 和 Sonnet 4.6+，所有先前的思考块默认保留。对于早期的 Opus/Sonnet 模型和所有 Haiku 模型，由于包含了非工具结果的用户块，所有先前的思考块都会被忽略并从上下文中剥离。此请求的处理方式与以下相同：
```text
User: ["What's the weather in Paris?"],
Assistant: [tool_use block 1],
User: [tool_result_1, cache=True],
Assistant: [text block 2],
User: [Text response, cache=True]
```

**要点：**
- 即使没有显式的 `cache_control` 标记，此缓存行为也会自动发生
- 无论使用常规思考还是交错思考，此行为都是一致的

<section title="系统提示缓存（思考更改时保留）">

<CodeGroup>
```bash CLI
# 获取约 10 kB 的《傲慢与偏见》文本，用作缓存的系统块
curl -s https://www.gutenberg.org/cache/epub/1342/pg1342.txt \
  | head -c 10000 > pride.txt

# 为给定的思考预算生成请求体。一旦 CONTENT1
# 被填充（在第一轮之后），助手回复和后续的
# 用户消息将被追加，使对话逐步增长。
build_body() {
  cat <<YAML
model: claude-sonnet-4-6
max_tokens: 20000
thinking:
  type: enabled
  budget_tokens: $1
system:
  - type: text
    text: >-
      You are an AI assistant that is tasked with literary analysis.
      Analyze the following text carefully.
  - type: text
    text: "@./pride.txt"
    cache_control:
      type: ephemeral
messages:
  - role: user
    content: Analyze the tone of this passage.
YAML
  if [[ -n "${CONTENT1:-}" ]]; then
    printf '  - role: assistant\n    content: %s\n' "$CONTENT1"
    printf '  - role: user\n'
    printf '    content: Analyze the characters in this passage.\n'
  fi
}

# 第一个请求（预算 4000）：建立缓存。将 usage
# 和 content 捕获为两行 jsonl，以便将回复向前传递。
printf 'First request - establishing cache\n'
{
  read -r USAGE1
  read -r CONTENT1
} < <(build_body 4000 \
  | ant messages create --transform '[usage,content]' --format jsonl)
printf 'First response usage: %s\n' "$USAGE1"

# 第二个请求：相同预算，预期系统提示缓存命中。
printf '\nSecond request - same thinking parameters (cache hit expected)\n'
USAGE2=$(build_body 4000 \
  | ant messages create --transform usage --format jsonl)
printf 'Second response usage: %s\n' "$USAGE2"

# 第三个请求：预算改为 8000。缓存的系统提示
# 仍然命中；只有消息块缓存失效。
printf '\nThird request - different thinking parameters (cache miss for messages)\n'
USAGE3=$(build_body 8000 \
  | ant messages create --transform usage --format jsonl)
printf 'Third response usage: %s\n' "$USAGE3"
```

```python Python hidelines={1}
from anthropic import Anthropic
import requests
from bs4 import BeautifulSoup

client = Anthropic()


def fetch_article_content(url):
    response = requests.get(url)
    soup = BeautifulSoup(response.content, "html.parser")

    # 移除 script 和 style 元素
    for script in soup(["script", "style"]):
        script.decompose()

    # 获取文本
    text = soup.get_text()

    # 拆分为多行并去除每行首尾的空白
    lines = (line.strip() for line in text.splitlines())
    # 将多个标题拆分为单独的行
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    # 删除空行
    text = "\n".join(chunk for chunk in chunks if chunk)

    return text


# 获取文章内容
book_url = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt"
book_content = fetch_article_content(book_url)
# 仅使用足够触发缓存的文本量（前几章）
LARGE_TEXT = book_content[:10000]

SYSTEM_PROMPT = [
    {
        "type": "text",
        "text": "You are an AI assistant that is tasked with literary analysis. Analyze the following text carefully.",
    },
    {"type": "text", "text": LARGE_TEXT, "cache_control": {"type": "ephemeral"}},
]

MESSAGES = [{"role": "user", "content": "Analyze the tone of this passage."}]

# 第一次请求 - 建立缓存
print("First request - establishing cache")
response1 = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=20000,
    thinking={"type": "enabled", "budget_tokens": 4000},
    system=SYSTEM_PROMPT,
    messages=MESSAGES,
)

print(f"First response usage: {response1.usage}")

MESSAGES.append({"role": "assistant", "content": response1.content})
MESSAGES.append({"role": "user", "content": "Analyze the characters in this passage."})
# 第二次请求 - 相同的思考参数（预期缓存命中）
print("\nSecond request - same thinking parameters (cache hit expected)")
response2 = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=20000,
    thinking={"type": "enabled", "budget_tokens": 4000},
    system=SYSTEM_PROMPT,
    messages=MESSAGES,
)

print(f"Second response usage: {response2.usage}")

# 第三次请求 - 不同的思考参数（消息部分缓存未命中）
print("\nThird request - different thinking parameters (cache miss for messages)")
response3 = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=20000,
    thinking={
        "type": "enabled",
        "budget_tokens": 8000,  # Changed thinking budget
    },
    system=SYSTEM_PROMPT,  # System prompt remains cached
    messages=MESSAGES,  # Messages cache is invalidated
)

print(f"Third response usage: {response3.usage}")
```

```typescript TypeScript nocheck hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import * as cheerio from "cheerio";

const client = new Anthropic();

async function fetchArticleContent(url: string): Promise<string> {
  const response = await axios.get(url);
  const $ = cheerio.load(response.data);
  $("script, style").remove();
  let text = $.text();
  const lines = text.split("\n").map((line) => line.trim());
  text = lines.filter((line) => line.length > 0).join("\n");
  return text;
}

const bookUrl = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt";
const bookContent = await fetchArticleContent(bookUrl);
const LARGE_TEXT = bookContent.slice(0, 10000);

const SYSTEM_PROMPT: Anthropic.TextBlockParam[] = [
  {
    type: "text",
    text: "You are an AI assistant that is tasked with literary analysis. Analyze the following text carefully."
  },
  {
    type: "text",
    text: LARGE_TEXT,
    cache_control: { type: "ephemeral" }
  }
];

const messages: Anthropic.MessageParam[] = [
  { role: "user", content: "Analyze the tone of this passage." }
];

// 第一个请求 - 建立缓存
console.log("First request - establishing cache");
const response1 = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: { type: "enabled", budget_tokens: 4000 },
  system: SYSTEM_PROMPT,
  messages
});

console.log(`First response usage: ${JSON.stringify(response1.usage)}`);

messages.push({
  role: "assistant",
  content: response1.content
});
messages.push({
  role: "user",
  content: "Analyze the characters in this passage."
});

// 第二个请求 - 相同的思考参数（预期缓存命中）
console.log("\nSecond request - same thinking parameters (cache hit expected)");
const response2 = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: { type: "enabled", budget_tokens: 4000 },
  system: SYSTEM_PROMPT,
  messages
});

console.log(`Second response usage: ${JSON.stringify(response2.usage)}`);

// 第三个请求 - 不同的思考参数（消息缓存未命中）
console.log("\nThird request - different thinking parameters (cache miss for messages)");
const response3 = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: { type: "enabled", budget_tokens: 8000 },
  system: SYSTEM_PROMPT,
  messages
});

console.log(`Third response usage: ${JSON.stringify(response3.usage)}`);
```

```csharp C# hidelines={1..4}
using System.Net.Http;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

// 获取书籍内容
using var httpClient = new HttpClient();
var bookContent = await httpClient.GetStringAsync("https://www.gutenberg.org/cache/epub/1342/pg1342.txt");
var largeText = bookContent.Substring(0, Math.Min(10000, bookContent.Length));

var systemPrompt = new MessageCreateParamsSystem(new List<TextBlockParam>
{
    new TextBlockParam()
    {
        Text = "You are an AI assistant that is tasked with literary analysis. Analyze the following text carefully."
    },
    new TextBlockParam()
    {
        Text = largeText,
        CacheControl = new CacheControlEphemeral(),
    },
});

var messages = new List<MessageParam>
{
    new() { Role = Role.User, Content = "Analyze the tone of this passage." }
};

// 第一次请求 - 建立缓存
Console.WriteLine("First request - establishing cache");
var parameters1 = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 20000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 4000),
    System = systemPrompt,
    Messages = messages
};

var response1 = await client.Messages.Create(parameters1);
Console.WriteLine($"First response usage: {response1.Usage}");

messages.Add(new() { Role = Role.Assistant, Content = response1.Content.Select(block => new ContentBlockParam(block.Json)).ToList() });
messages.Add(new() { Role = Role.User, Content = "Analyze the characters in this passage." });

// 第二次请求 - 相同的思考参数（预期缓存命中）
Console.WriteLine("\nSecond request - same thinking parameters (cache hit expected)");
var parameters2 = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 20000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 4000),
    System = systemPrompt,
    Messages = messages
};

var response2 = await client.Messages.Create(parameters2);
Console.WriteLine($"Second response usage: {response2.Usage}");

// 第三次请求 - 不同的思考参数（消息缓存未命中）
Console.WriteLine("\nThird request - different thinking parameters (cache miss for messages)");
var parameters3 = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 20000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 8000),
    System = systemPrompt,
    Messages = messages
};

var response3 = await client.Messages.Create(parameters3);
Console.WriteLine($"Third response usage: {response3.Usage}");
```

```go Go hidelines={1..15,-6..-1}
package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	// 获取书籍内容
	resp, err := http.Get("https://www.gutenberg.org/cache/epub/1342/pg1342.txt")
	if err != nil {
		log.Fatal(err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Fatal(err)
	}

	largeText := string(body)
	if len(largeText) > 10000 {
		largeText = largeText[:10000]
	}

	systemPrompt := []anthropic.TextBlockParam{
		{Text: "You are an AI assistant that is tasked with literary analysis. Analyze the following text carefully."},
		{
			Text:         largeText,
			CacheControl: anthropic.NewCacheControlEphemeralParam(),
		},
	}

	messages := []anthropic.MessageParam{
		anthropic.NewUserMessage(anthropic.NewTextBlock("Analyze the tone of this passage.")),
	}

	// 第一次请求 - 建立缓存
	fmt.Println("First request - establishing cache")
	response1, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 20000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(4000),
		System:    systemPrompt,
		Messages:  messages,
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("First response usage: %s\n", response1.Usage.RawJSON())

	messages = append(messages, response1.ToParam())
	messages = append(messages, anthropic.NewUserMessage(anthropic.NewTextBlock("Analyze the characters in this passage.")))

	// 第二次请求 - 相同的思考参数（预期缓存命中）
	fmt.Println("\nSecond request - same thinking parameters (cache hit expected)")
	response2, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 20000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(4000),
		System:    systemPrompt,
		Messages:  messages,
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Second response usage: %s\n", response2.Usage.RawJSON())

	// 第三次请求 - 不同的思考参数（消息缓存未命中）
	fmt.Println("\nThird request - different thinking parameters (cache miss for messages)")
	response3, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 20000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(8000),
		System:    systemPrompt,
		Messages:  messages,
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Third response usage: %s\n", response3.Usage.RawJSON())
}
```

```java Java hidelines={1..2,4..13}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;

void main() throws Exception {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // 获取书籍内容
    HttpClient httpClient = HttpClient.newHttpClient();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create("https://www.gutenberg.org/cache/epub/1342/pg1342.txt"))
        .build();
    HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    String bookContent = response.body();
    String largeText = bookContent.substring(0, Math.min(10000, bookContent.length()));

    List<TextBlockParam> systemPrompt = List.of(
        TextBlockParam.builder()
            .text("You are an AI assistant that is tasked with literary analysis. Analyze the following text carefully.")
            .build(),
        TextBlockParam.builder()
            .text(largeText)
            .cacheControl(CacheControlEphemeral.builder().build())
            .build()
    );

    // 第一次请求 - 建立缓存
    IO.println("First request - establishing cache");
    MessageCreateParams params1 = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(20000L)
        .enabledThinking(4000L)
        .systemOfTextBlockParams(systemPrompt)
        .addUserMessage("Analyze the tone of this passage.")
        .build();

    Message response1 = client.messages().create(params1);
    IO.println("First response usage: " + response1.usage());

    // 第二次请求 - 相同的思考参数（预期缓存命中）
    IO.println("\nSecond request - same thinking parameters (cache hit expected)");
    MessageCreateParams params2 = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(20000L)
        .enabledThinking(4000L)
        .systemOfTextBlockParams(systemPrompt)
        .addUserMessage("Analyze the tone of this passage.")
        .addAssistantMessageOfBlockParams(response1.content().stream()
            .map(block -> block.toParam())
            .collect(java.util.stream.Collectors.toList()))
        .addUserMessage("Analyze the characters in this passage.")
        .build();

    Message response2 = client.messages().create(params2);
    IO.println("Second response usage: " + response2.usage());

    // 第三次请求 - 不同的思考参数（消息缓存未命中）
    IO.println("\nThird request - different thinking parameters (cache miss for messages)");
    MessageCreateParams params3 = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(20000L)
        .enabledThinking(8000L)
        .systemOfTextBlockParams(systemPrompt)
        .addUserMessage("Analyze the tone of this passage.")
        .addAssistantMessageOfBlockParams(response1.content().stream()
            .map(block -> block.toParam())
            .collect(java.util.stream.Collectors.toList()))
        .addUserMessage("Analyze the characters in this passage.")
        .build();

    Message response3 = client.messages().create(params3);
    IO.println("Third response usage: " + response3.usage());
}
```

```php PHP hidelines={1..5}
<?php


use Anthropic\Client;

$client = new Client();

// 获取书籍内容
$bookContent = file_get_contents("https://www.gutenberg.org/cache/epub/1342/pg1342.txt");
$largeText = substr($bookContent, 0, 10000);

$systemPrompt = [
    [
        'type' => 'text',
        'text' => 'You are an AI assistant that is tasked with literary analysis. Analyze the following text carefully.'
    ],
    [
        'type' => 'text',
        'text' => $largeText,
        'cache_control' => ['type' => 'ephemeral']
    ]
];

$messages = [
    ['role' => 'user', 'content' => 'Analyze the tone of this passage.']
];

// 第一次请求 - 建立缓存
echo "First request - establishing cache\n";
$response1 = $client->messages->create(
    maxTokens: 20000,
    messages: $messages,
    model: 'claude-sonnet-4-6',
    system: $systemPrompt,
    thinking: ['type' => 'enabled', 'budget_tokens' => 4000],
);

echo "First response usage: " . json_encode($response1->usage) . "\n";

$messages[] = ['role' => 'assistant', 'content' => $response1->content];
$messages[] = ['role' => 'user', 'content' => 'Analyze the characters in this passage.'];

// 第二次请求 - 相同的思考参数（预期缓存命中）
echo "\nSecond request - same thinking parameters (cache hit expected)\n";
$response2 = $client->messages->create(
    maxTokens: 20000,
    messages: $messages,
    model: 'claude-sonnet-4-6',
    system: $systemPrompt,
    thinking: ['type' => 'enabled', 'budget_tokens' => 4000],
);

echo "Second response usage: " . json_encode($response2->usage) . "\n";

// 第三次请求 - 不同的思考参数（消息缓存未命中）
echo "\nThird request - different thinking parameters (cache miss for messages)\n";
$response3 = $client->messages->create(
    maxTokens: 20000,
    messages: $messages,
    model: 'claude-sonnet-4-6',
    system: $systemPrompt,
    thinking: ['type' => 'enabled', 'budget_tokens' => 8000],
);

echo "Third response usage: " . json_encode($response3->usage) . "\n";
```

```ruby Ruby hidelines={1}
require "anthropic"
require "net/http"
require "uri"

client = Anthropic::Client.new

# 获取书籍内容
uri = URI("https://www.gutenberg.org/cache/epub/1342/pg1342.txt")
response = Net::HTTP.get_response(uri)
book_content = response.body
large_text = book_content[0...10000]

system_prompt = [
  {
    type: "text",
    text: "You are an AI assistant that is tasked with literary analysis. Analyze the following text carefully."
  },
  {
    type: "text",
    text: large_text,
    cache_control: { type: "ephemeral" }
  }
]

messages = [
  { role: "user", content: "Analyze the tone of this passage." }
]

# 第一次请求 - 建立缓存
puts "First request - establishing cache"
response1 = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: {
    type: "enabled",
    budget_tokens: 4000
  },
  system: system_prompt,
  messages: messages
)

puts "First response usage: #{response1.usage}"

messages << { role: "assistant", content: response1.content }
messages << { role: "user", content: "Analyze the characters in this passage." }

# 第二次请求 - 相同的思考参数（预期缓存命中）
puts "\nSecond request - same thinking parameters (cache hit expected)"
response2 = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: {
    type: "enabled",
    budget_tokens: 4000
  },
  system: system_prompt,
  messages: messages
)

puts "Second response usage: #{response2.usage}"

# 第三次请求 - 不同的思考参数（消息缓存未命中）
puts "\nThird request - different thinking parameters (cache miss for messages)"
response3 = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: {
    type: "enabled",
    budget_tokens: 8000
  },
  system: system_prompt,
  messages: messages
)

puts "Third response usage: #{response3.usage}"
```

</CodeGroup>

</section>
<section title="消息缓存（思考更改时失效）">

<CodeGroup>
```bash CLI
# 获取《傲慢与偏见》的前约 10 kB 作为缓存前缀
curl -sL 'https://www.gutenberg.org/cache/epub/1342/pg1342.txt' \
  | head -c 10000 > book.txt

# 调用 1：思考预算为 4000，写入缓存
USAGE=$(ant messages create \
  --model claude-sonnet-4-6 --max-tokens 20000 \
  --transform usage <<'YAML'
thinking:
  type: enabled
  budget_tokens: 4000
messages:
  - role: user
    content:
      - type: text
        text: "@./book.txt"
        cache_control:
          type: ephemeral
      - type: text
        text: "Give a one-sentence summary of this passage."
YAML
)
printf 'Call 1 (budget 4000):\n%s\n\n' "$USAGE"

# 调用 2：相同预算，对话已延长；预期缓存命中（HIT）
USAGE=$(ant messages create \
  --model claude-sonnet-4-6 --max-tokens 20000 \
  --transform usage <<'YAML'
thinking:
  type: enabled
  budget_tokens: 4000
messages:
  - role: user
    content:
      - type: text
        text: "@./book.txt"
        cache_control:
          type: ephemeral
      - type: text
        text: "Give a one-sentence summary of this passage."
  - role: assistant
    content: "It opens Pride and Prejudice with the Bennet family."
  - role: user
    content: "Who is the protagonist?"
YAML
)
printf 'Call 2 (budget 4000):\n%s\n\n' "$USAGE"

# 调用 3：预算改为 8000；即使前缀相同也会缓存未命中（MISS）
USAGE=$(ant messages create \
  --model claude-sonnet-4-6 --max-tokens 20000 \
  --transform usage <<'YAML'
thinking:
  type: enabled
  budget_tokens: 8000
messages:
  - role: user
    content:
      - type: text
        text: "@./book.txt"
        cache_control:
          type: ephemeral
      - type: text
        text: "Give a one-sentence summary of this passage."
  - role: assistant
    content: "It opens Pride and Prejudice with the Bennet family."
  - role: user
    content: "Who is the protagonist?"
  - role: assistant
    content: "Elizabeth Bennet is the protagonist."
  - role: user
    content: "What era is the story set in?"
YAML
)
printf 'Call 3 (budget 8000):\n%s\n' "$USAGE"
```

```python Python hidelines={1}
from anthropic import Anthropic
import requests
from bs4 import BeautifulSoup

client = Anthropic()


def fetch_article_content(url):
    response = requests.get(url)
    soup = BeautifulSoup(response.content, "html.parser")

    # 移除 script 和 style 元素
    for script in soup(["script", "style"]):
        script.decompose()

    # 获取文本
    text = soup.get_text()

    # 拆分为多行并去除每行首尾的空白
    lines = (line.strip() for line in text.splitlines())
    # 将多个标题拆分为单独的行
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    # 删除空行
    text = "\n".join(chunk for chunk in chunks if chunk)

    return text


# 获取文章内容
book_url = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt"
book_content = fetch_article_content(book_url)
# 仅使用足够触发缓存的文本量（前几章）
LARGE_TEXT = book_content[:10000]

# 不使用系统提示——改为在 messages 中缓存
MESSAGES = [
    {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": LARGE_TEXT,
                "cache_control": {"type": "ephemeral"},
            },
            {"type": "text", "text": "Analyze the tone of this passage."},
        ],
    }
]

# 第一次请求——建立缓存
print("First request - establishing cache")
response1 = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=20000,
    thinking={"type": "enabled", "budget_tokens": 4000},
    messages=MESSAGES,
)

print(f"First response usage: {response1.usage}")

MESSAGES.append({"role": "assistant", "content": response1.content})
MESSAGES.append({"role": "user", "content": "Analyze the characters in this passage."})
# 第二次请求——相同的思考参数（预期缓存命中）
print("\nSecond request - same thinking parameters (cache hit expected)")
response2 = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=20000,
    thinking={
        "type": "enabled",
        "budget_tokens": 4000,  # Same thinking budget
    },
    messages=MESSAGES,
)

print(f"Second response usage: {response2.usage}")

MESSAGES.append({"role": "assistant", "content": response2.content})
MESSAGES.append({"role": "user", "content": "Analyze the setting in this passage."})

# 第三次请求——不同的思考预算（预期缓存未命中）
print("\nThird request - different thinking budget (cache miss expected)")
response3 = client.messages.create(
    model="claude-sonnet-4-6",
    max_tokens=20000,
    thinking={
        "type": "enabled",
        "budget_tokens": 8000,  # Different thinking budget breaks cache
    },
    messages=MESSAGES,
)

print(f"Third response usage: {response3.usage}")
```

```typescript TypeScript nocheck hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import * as cheerio from "cheerio";

const client = new Anthropic();

async function fetchArticleContent(url: string): Promise<string> {
  const response = await axios.get(url);
  const $ = cheerio.load(response.data);

  // 移除 script 和 style 元素
  $("script, style").remove();

  // 获取文本
  let text = $.text();

  // 清理文本（拆分为行，移除空白字符）
  const lines = text.split("\n").map((line) => line.trim());
  const chunks = lines.flatMap((line) => line.split("  ").map((phrase) => phrase.trim()));
  text = chunks.filter((chunk) => chunk).join("\n");

  return text;
}

const bookUrl = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt";
const bookContent = await fetchArticleContent(bookUrl);
const LARGE_TEXT = bookContent.substring(0, 10000);

// 无系统提示 - 改为在消息中进行缓存
const messages: Anthropic.MessageParam[] = [
  {
    role: "user",
    content: [
      {
        type: "text",
        text: LARGE_TEXT,
        cache_control: { type: "ephemeral" }
      },
      {
        type: "text",
        text: "Analyze the tone of this passage."
      }
    ]
  }
];

// 第一次请求 - 建立缓存
console.log("First request - establishing cache");
const response1 = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: { type: "enabled", budget_tokens: 4000 },
  messages
});

console.log("First response usage: ", response1.usage);

messages.push(
  { role: "assistant", content: response1.content },
  { role: "user", content: "Analyze the characters in this passage." }
);

// 第二次请求 - 相同的思考参数（预期缓存命中）
console.log("\nSecond request - same thinking parameters (cache hit expected)");
const response2 = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: { type: "enabled", budget_tokens: 4000 },
  messages
});

console.log("Second response usage: ", response2.usage);

messages.push(
  { role: "assistant", content: response2.content },
  { role: "user", content: "Analyze the setting in this passage." }
);

// 第三次请求 - 不同的思考预算（预期缓存未命中）
console.log("\nThird request - different thinking budget (cache miss expected)");
const response3 = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: { type: "enabled", budget_tokens: 8000 },
  messages
});

console.log("Third response usage: ", response3.usage);
```

```csharp C# hidelines={1..4}
using System.Net.Http;
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

string bookUrl = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt";
string bookContent = await FetchArticleContent(bookUrl);
string largeText = bookContent.Substring(0, Math.Min(10000, bookContent.Length));

Console.WriteLine("First request - establishing cache");
var parameters1 = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 20000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 4000),
    Messages =
    [
        new()
        {
            Role = Role.User,
            Content = new MessageParamContent(new List<ContentBlockParam>
            {
                new ContentBlockParam(new TextBlockParam()
                {
                    Text = largeText,
                    CacheControl = new CacheControlEphemeral(),
                }),
                new ContentBlockParam(new TextBlockParam()
                {
                    Text = "Analyze the tone of this passage."
                }),
            })
        }
    ]
};

var response1 = await client.Messages.Create(parameters1);
Console.WriteLine($"First response usage: {response1.Usage}");

Console.WriteLine("\nSecond request - same thinking parameters (cache hit expected)");
var parameters2 = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 20000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 4000),
    Messages =
    [
        new()
        {
            Role = Role.User,
            Content = new MessageParamContent(new List<ContentBlockParam>
            {
                new ContentBlockParam(new TextBlockParam()
                {
                    Text = largeText,
                    CacheControl = new CacheControlEphemeral(),
                }),
                new ContentBlockParam(new TextBlockParam()
                {
                    Text = "Analyze the tone of this passage."
                }),
            })
        },
        new()
        {
            Role = Role.Assistant,
            Content = response1.Content.Select(block => new ContentBlockParam(block.Json)).ToList()
        },
        new()
        {
            Role = Role.User,
            Content = "Analyze the characters in this passage."
        }
    ]
};

var response2 = await client.Messages.Create(parameters2);
Console.WriteLine($"Second response usage: {response2.Usage}");

Console.WriteLine("\nThird request - different thinking budget (cache miss expected)");
var parameters3 = new MessageCreateParams
{
    Model = Model.ClaudeSonnet4_6,
    MaxTokens = 20000,
    Thinking = new ThinkingConfigEnabled(budgetTokens: 8000),
    Messages =
    [
        new()
        {
            Role = Role.User,
            Content = new MessageParamContent(new List<ContentBlockParam>
            {
                new ContentBlockParam(new TextBlockParam()
                {
                    Text = largeText,
                    CacheControl = new CacheControlEphemeral(),
                }),
                new ContentBlockParam(new TextBlockParam()
                {
                    Text = "Analyze the tone of this passage."
                }),
            })
        },
        new()
        {
            Role = Role.Assistant,
            Content = response1.Content.Select(block => new ContentBlockParam(block.Json)).ToList()
        },
        new()
        {
            Role = Role.User,
            Content = "Analyze the characters in this passage."
        },
        new()
        {
            Role = Role.Assistant,
            Content = response2.Content.Select(block => new ContentBlockParam(block.Json)).ToList()
        },
        new()
        {
            Role = Role.User,
            Content = "Analyze the setting in this passage."
        }
    ]
};

var response3 = await client.Messages.Create(parameters3);
Console.WriteLine($"Third response usage: {response3.Usage}");

static async Task<string> FetchArticleContent(string url)
{
    using HttpClient httpClient = new();
    string content = await httpClient.GetStringAsync(url);
    return content;
}
```

```go Go hidelines={1..41,-1}
package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
)

func fetchArticleContent(url string) (string, error) {
	resp, err := http.Get(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	text := string(body)
	lines := strings.Split(text, "\n")
	var cleanedLines []string
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed != "" {
			cleanedLines = append(cleanedLines, trimmed)
		}
	}

	return strings.Join(cleanedLines, "\n"), nil
}

func main() {
	client := anthropic.NewClient()

	bookURL := "https://www.gutenberg.org/cache/epub/1342/pg1342.txt"
	bookContent, err := fetchArticleContent(bookURL)
	if err != nil {
		log.Fatal(err)
	}

	largeText := bookContent
	if len(largeText) > 10000 {
		largeText = largeText[:10000]
	}

	// 无系统提示 - 改为在消息中进行缓存
	messages := []anthropic.MessageParam{
		anthropic.NewUserMessage(
			anthropic.ContentBlockParamUnion{OfText: &anthropic.TextBlockParam{
				Text:         largeText,
				CacheControl: anthropic.NewCacheControlEphemeralParam(),
			}},
			anthropic.NewTextBlock("Analyze the tone of this passage."),
		),
	}

	// 第一次请求 - 建立缓存
	fmt.Println("First request - establishing cache")
	response1, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 20000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(4000),
		Messages:  messages,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("First response usage: %s\n", response1.Usage.RawJSON())

	messages = append(messages, response1.ToParam())
	messages = append(messages, anthropic.NewUserMessage(anthropic.NewTextBlock("Analyze the characters in this passage.")))

	// 第二次请求 - 相同的思考参数（预期缓存命中）
	fmt.Println("\nSecond request - same thinking parameters (cache hit expected)")
	response2, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 20000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(4000),
		Messages:  messages,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Second response usage: %s\n", response2.Usage.RawJSON())

	messages = append(messages, response2.ToParam())
	messages = append(messages, anthropic.NewUserMessage(anthropic.NewTextBlock("Analyze the setting in this passage.")))

	// 第三次请求 - 不同的思考预算（预期缓存未命中）
	fmt.Println("\nThird request - different thinking budget (cache miss expected)")
	response3, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_6,
		MaxTokens: 20000,
		Thinking:  anthropic.ThinkingConfigParamOfEnabled(8000),
		Messages:  messages,
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Third response usage: %s\n", response3.Usage.RawJSON())
}
```

```java Java hidelines={1..2,4..14}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;

void main() throws Exception {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    String bookUrl = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt";
    String bookContent = fetchArticleContent(bookUrl);
    String largeText = bookContent.substring(0, Math.min(10000, bookContent.length()));

    // 第一个请求 - 建立缓存
    IO.println("First request - establishing cache");
    MessageCreateParams params1 = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(20000L)
        .enabledThinking(4000L)
        .addUserMessageOfBlockParams(List.of(
            ContentBlockParam.ofText(TextBlockParam.builder()
                .text(largeText)
                .cacheControl(CacheControlEphemeral.builder().build())
                .build()),
            ContentBlockParam.ofText(TextBlockParam.builder()
                .text("Analyze the tone of this passage.")
                .build())
        ))
        .build();

    Message response1 = client.messages().create(params1);
    IO.println("First response usage: " + response1.usage());

    // 第二个请求 - 相同的思考参数（预期缓存命中）
    IO.println("\nSecond request - same thinking parameters (cache hit expected)");
    MessageCreateParams params2 = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(20000L)
        .enabledThinking(4000L)
        .addUserMessageOfBlockParams(List.of(
            ContentBlockParam.ofText(TextBlockParam.builder()
                .text(largeText)
                .cacheControl(CacheControlEphemeral.builder().build())
                .build()),
            ContentBlockParam.ofText(TextBlockParam.builder()
                .text("Analyze the tone of this passage.")
                .build())
        ))
        .addAssistantMessageOfBlockParams(response1.content().stream()
            .map(block -> block.toParam())
            .collect(java.util.stream.Collectors.toList()))
        .addUserMessage("Analyze the characters in this passage.")
        .build();

    Message response2 = client.messages().create(params2);
    IO.println("Second response usage: " + response2.usage());

    // 第三个请求 - 不同的思考预算（预期缓存未命中）
    IO.println("\nThird request - different thinking budget (cache miss expected)");
    MessageCreateParams params3 = MessageCreateParams.builder()
        .model(Model.CLAUDE_SONNET_4_6)
        .maxTokens(20000L)
        .enabledThinking(8000L)
        .addUserMessageOfBlockParams(List.of(
            ContentBlockParam.ofText(TextBlockParam.builder()
                .text(largeText)
                .cacheControl(CacheControlEphemeral.builder().build())
                .build()),
            ContentBlockParam.ofText(TextBlockParam.builder()
                .text("Analyze the tone of this passage.")
                .build())
        ))
        .addAssistantMessageOfBlockParams(response1.content().stream()
            .map(block -> block.toParam())
            .collect(java.util.stream.Collectors.toList()))
        .addUserMessage("Analyze the characters in this passage.")
        .addAssistantMessageOfBlockParams(response2.content().stream()
            .map(block -> block.toParam())
            .collect(java.util.stream.Collectors.toList()))
        .addUserMessage("Analyze the setting in this passage.")
        .build();

    Message response3 = client.messages().create(params3);
    IO.println("Third response usage: " + response3.usage());
}

String fetchArticleContent(String url) throws Exception {
    HttpClient client = HttpClient.newHttpClient();
    HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(url))
        .build();
    HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
    return response.body();
}
```

```php PHP hidelines={1..6}
<?php


use Anthropic\Client;


function fetchArticleContent($url) {
    $content = file_get_contents($url);
    $lines = explode("\n", $content);
    $cleanedLines = array_filter(array_map('trim', $lines));
    return implode("\n", $cleanedLines);
}

$client = new Client();

$bookUrl = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt";
$bookContent = fetchArticleContent($bookUrl);
$largeText = substr($bookContent, 0, 10000);

echo "First request - establishing cache\n";
$response1 = $client->messages->create(
    maxTokens: 20000,
    messages: [[
        'role' => 'user',
        'content' => [
            [
                'type' => 'text',
                'text' => $largeText,
                'cache_control' => ['type' => 'ephemeral']
            ],
            [
                'type' => 'text',
                'text' => 'Analyze the tone of this passage.'
            ]
        ]
    ]],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'enabled', 'budget_tokens' => 4000],
);

echo "First response usage: " . json_encode($response1->usage) . "\n";

echo "\nSecond request - same thinking parameters (cache hit expected)\n";
$response2 = $client->messages->create(
    maxTokens: 20000,
    messages: [
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'text',
                    'text' => $largeText,
                    'cache_control' => ['type' => 'ephemeral']
                ],
                [
                    'type' => 'text',
                    'text' => 'Analyze the tone of this passage.'
                ]
            ]
        ],
        [
            'role' => 'assistant',
            'content' => $response1->content
        ],
        [
            'role' => 'user',
            'content' => 'Analyze the characters in this passage.'
        ]
    ],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'enabled', 'budget_tokens' => 4000],
);

echo "Second response usage: " . json_encode($response2->usage) . "\n";

echo "\nThird request - different thinking budget (cache miss expected)\n";
$response3 = $client->messages->create(
    maxTokens: 20000,
    messages: [
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'text',
                    'text' => $largeText,
                    'cache_control' => ['type' => 'ephemeral']
                ],
                [
                    'type' => 'text',
                    'text' => 'Analyze the tone of this passage.'
                ]
            ]
        ],
        [
            'role' => 'assistant',
            'content' => $response1->content
        ],
        [
            'role' => 'user',
            'content' => 'Analyze the characters in this passage.'
        ],
        [
            'role' => 'assistant',
            'content' => $response2->content
        ],
        [
            'role' => 'user',
            'content' => 'Analyze the setting in this passage.'
        ]
    ],
    model: 'claude-sonnet-4-6',
    thinking: ['type' => 'enabled', 'budget_tokens' => 8000],
);

echo "Third response usage: " . json_encode($response3->usage) . "\n";
```

```ruby Ruby hidelines={1}
require "anthropic"
require "net/http"
require "uri"

def fetch_article_content(url)
  uri = URI.parse(url)
  response = Net::HTTP.get_response(uri)
  text = response.body

  lines = text.split("\n").map(&:strip)
  lines.reject(&:empty?).join("\n")
end

client = Anthropic::Client.new

book_url = "https://www.gutenberg.org/cache/epub/1342/pg1342.txt"
book_content = fetch_article_content(book_url)
large_text = book_content[0...10000]

puts "First request - establishing cache"
response1 = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: {
    type: "enabled",
    budget_tokens: 4000
  },
  messages: [{
    role: "user",
    content: [
      {
        type: "text",
        text: large_text,
        cache_control: { type: "ephemeral" }
      },
      {
        type: "text",
        text: "Analyze the tone of this passage."
      }
    ]
  }]
)

puts "First response usage: #{response1.usage}"

puts "\nSecond request - same thinking parameters (cache hit expected)"
response2 = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: {
    type: "enabled",
    budget_tokens: 4000
  },
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: large_text,
          cache_control: { type: "ephemeral" }
        },
        {
          type: "text",
          text: "Analyze the tone of this passage."
        }
      ]
    },
    {
      role: "assistant",
      content: response1.content
    },
    {
      role: "user",
      content: "Analyze the characters in this passage."
    }
  ]
)

puts "Second response usage: #{response2.usage}"

puts "\nThird request - different thinking budget (cache miss expected)"
response3 = client.messages.create(
  model: "claude-sonnet-4-6",
  max_tokens: 20000,
  thinking: {
    type: "enabled",
    budget_tokens: 8000
  },
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: large_text,
          cache_control: { type: "ephemeral" }
        },
        {
          type: "text",
          text: "Analyze the tone of this passage."
        }
      ]
    },
    {
      role: "assistant",
      content: response1.content
    },
    {
      role: "user",
      content: "Analyze the characters in this passage."
    },
    {
      role: "assistant",
      content: response2.content
    },
    {
      role: "user",
      content: "Analyze the setting in this passage."
    }
  ]
)

puts "Third response usage: #{response3.usage}"
```

</CodeGroup>

以下是脚本的输出（您可能会看到略有不同的数字）

```text Output
First request - establishing cache
First response usage: { cache_creation_input_tokens: 1370, cache_read_input_tokens: 0, input_tokens: 17, output_tokens: 700 }

Second request - same thinking parameters (cache hit expected)

Second response usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 1370, input_tokens: 303, output_tokens: 874 }

Third request - different thinking budget (cache miss expected)
Third response usage: { cache_creation_input_tokens: 1370, cache_read_input_tokens: 0, input_tokens: 747, output_tokens: 619 }
```

此示例演示了当在消息数组中设置缓存时，更改思考参数（budget_tokens 从 4000 增加到 8000）会**使缓存失效**。第三个请求显示没有缓存命中，`cache_creation_input_tokens=1370` 且 `cache_read_input_tokens=0`，证明当思考参数更改时，基于消息的缓存会失效。

</section>

## 扩展思考的最大令牌数和上下文窗口大小 \{#max-tokens-and-context-window-size-with-extended-thinking}

`max_tokens`（启用思考时包括您的思考预算）作为严格限制强制执行。在 Claude 4.5 及更新的模型上，如果输入令牌加上 `max_tokens` 超过上下文窗口大小，API 会接受该请求。如果生成随后达到上下文窗口限制，则会以 `stop_reason: "model_context_window_exceeded"` 停止。在早期模型上，API 会返回验证错误。请参阅[处理停止原因](/docs/zh-CN/build-with-claude/handling-stop-reasons)。

<Note>
您可以阅读[上下文窗口指南](/docs/zh-CN/build-with-claude/context-windows)以进行更深入的了解。
</Note>

### 扩展思考的上下文窗口 \{#the-context-window-with-extended-thinking}

在启用思考的情况下计算上下文窗口使用量时，需要注意以下几点：

- 在 Opus 4.5+ 和 Sonnet 4.6+ 上，先前回合的思考块会被保留并计入您的上下文窗口；在早期的 Opus/Sonnet 模型和所有 Haiku 模型上，它们会被剥离且不计入
- 当前回合的思考计入该回合的 `max_tokens` 限制

下图演示了启用扩展思考时的专门令牌管理：

![带扩展思考的上下文窗口图](/docs/images/context-window-thinking.svg)

有效上下文窗口的计算方式为：

```text
context window =
  (current input tokens - previous thinking tokens) +
  (thinking tokens + encrypted thinking tokens + text output tokens)
```

使用[令牌计数 API](/docs/zh-CN/build-with-claude/token-counting) 为您的特定用例获取准确的令牌计数，尤其是在处理包含思考的多回合对话时。

### 扩展思考与工具使用的上下文窗口 \{#the-context-window-with-extended-thinking-and-tool-use}

当将扩展思考与工具使用结合使用时，必须显式保留思考块并随工具结果一起返回。

扩展思考与工具使用的有效上下文窗口计算变为：

```text
context window =
  (current input tokens + previous thinking tokens + tool use tokens) +
  (thinking tokens + encrypted thinking tokens + text output tokens)
```

下图说明了扩展思考与工具使用的令牌管理：

![带扩展思考和工具使用的上下文窗口图](/docs/images/context-window-thinking-tools.svg)

### 使用扩展思考管理令牌 \{#managing-tokens-with-extended-thinking}

鉴于扩展思考的上下文窗口和 `max_tokens` 行为，您可能需要：

- 更积极地监控和管理您的令牌使用量
- 随着提示长度的变化调整 `max_tokens` 值
- 可能更频繁地使用[令牌计数端点](/docs/zh-CN/build-with-claude/token-counting)
- 注意先前的思考块不会在您的上下文窗口中累积

## 思考加密 \{#thinking-encryption}

完整的思考内容会被加密并在 `signature` 字段中返回。当思考块被传回 API 时，该字段用于验证这些思考块确实是由 Claude 生成的。

<Note>
只有在使用[带扩展思考的工具](/docs/zh-CN/build-with-claude/extended-thinking#extended-thinking-with-tool-use)时，才严格需要将思考块发送回去。否则，您可以省略之前轮次中的思考块。如果您将它们传回，API 是保留还是剥离它们取决于所使用的模型：Opus 4.5+ 和 Sonnet 4.6+ 默认会将其保留在上下文中；更早版本的 Opus/Sonnet 模型以及所有 Haiku 模型会将其剥离。请参阅[上下文编辑](/docs/zh-CN/build-with-claude/context-editing)以配置此行为。

如果要发送回思考块，请按照您收到的原样完整传回，以保持一致性并避免潜在问题。
</Note>

以下是关于思考加密的一些重要注意事项：
- 当使用[流式传输响应](/docs/zh-CN/build-with-claude/extended-thinking#streaming-thinking)时，签名会通过 `content_block_delta` 事件内的 `signature_delta` 添加，该事件紧接在 `content_block_stop` 事件之前。
- Claude 4 模型中的 `signature` 值比之前的模型长得多。
- `signature` 字段是一个不透明字段，不应对其进行解释或解析。
- `signature` 值在各平台之间兼容（Claude API、[Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock) 和 [Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai)）。在一个平台上生成的值可以在另一个平台上兼容使用。

## 已编辑的思考块 \{#redacted-thinking-blocks}

除了常规的 `thinking` 块之外，API 还可能返回 `redacted_thinking` 块。`redacted_thinking` 块在 `data` 字段中包含加密的思考内容，没有可读的摘要：

```json
{
  "type": "redacted_thinking",
  "data": "..."
}
```

`data` 字段是不透明且加密的。与常规思考块上的 `signature` 字段一样，在使用[工具](/docs/zh-CN/build-with-claude/extended-thinking#extended-thinking-with-tool-use)继续多回合对话时，您应将 `redacted_thinking` 块原封不动地传回 API。

<Tip>
如果您的代码在往返传递带工具使用的响应时按类型过滤内容块（例如 `block.type == "thinking"`），请同时包含 `redacted_thinking` 块。仅按 `block.type == "thinking"` 过滤会静默丢弃 `redacted_thinking` 块，并破坏上述多回合协议。
</Tip>

<Note>
`redacted_thinking` 块是 API 在部分思考内容因安全原因被编辑时返回的一种独立内容块类型。这与 [`display: "omitted"`](#controlling-thinking-display) 选项不同，后者返回 `thinking` 字段为空的常规 `thinking` 块。
</Note>

## 不同模型版本的思考差异 \{#differences-in-thinking-across-model-versions}

Messages API 在不同 Claude 模型版本中对思考的处理方式不同。下表给出了简要比较：

| 功能 | Claude 4 模型（Opus 4.5 之前） | Claude Opus 4.5 | Claude Sonnet 4.6 | Claude Opus 4.6（[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)） | Claude Opus 4.7（[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)） | Claude Opus 4.8（[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)） | [Claude Mythos Preview](https://anthropic.com/glasswing)（[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)） |
|---------|-------------------------------|--------------------------|------------------|--------------------------|--------------------------|--------------------------|--------------------------|
| **思考输出** | 返回摘要思考 | 返回摘要思考 | 返回摘要思考 | 返回摘要思考 | 默认省略；设置 `display: "summarized"` 以接收摘要思考 | 默认省略；设置 `display: "summarized"` 以接收摘要思考 | 默认省略；设置 `display: "summarized"` 以接收摘要思考。从不返回原始思考令牌。 |
| **交错思考** | 通过 `interleaved-thinking-2025-05-14` beta 标头支持 | 通过 `interleaved-thinking-2025-05-14` beta 标头支持 | 通过 `interleaved-thinking-2025-05-14` beta 标头支持，或通过[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)自动启用 | 通过自适应思考自动启用（beta 标头已弃用并被安全忽略） | 通过自适应思考自动启用（beta 标头已弃用并被安全忽略） | 通过自适应思考自动启用（beta 标头已弃用并被安全忽略） | 通过自适应思考自动启用（无需 beta 标头且会被安全忽略）。在此模型上，工具间推理会移入思考块。 |
| **思考块保留** | 不跨回合保留 | **默认保留** | **默认保留** | **默认保留** | **默认保留** | **默认保留** | **默认保留。** 在不支持 Mythos 思考格式的模型上继续对话时，块会被剥离。 |

### 按模型划分的思考块保留 \{#thinking-block-preservation-by-model}

先前助手回合的思考块是否默认保留在上下文中取决于模型类别。**Opus**：Claude Opus 4.5 及更高版本的 Opus 模型保留所有先前的思考块；Claude Opus 4.1（已弃用）及更早的 Opus 模型仅保留最后一个助手回合的思考。**Sonnet**：Claude Sonnet 4.6 及更高版本的 Sonnet 模型保留所有；Claude Sonnet 4.5 及更早的 Sonnet 模型仅保留最后一个回合。**Haiku**：截至 Claude Haiku 4.5 的所有 Haiku 模型仅保留最后一个回合。[Claude Mythos Preview](https://anthropic.com/glasswing) 也保留所有先前的思考块。

**思考块保留的好处：**

- **缓存优化**：使用工具使用时，保留的思考块可实现缓存命中，因为它们随工具结果一起传回并在助手回合中增量缓存，从而在多步骤工作流程中节省令牌
- **无智能影响**：保留思考块对模型性能没有负面影响

**重要注意事项：**

- **上下文使用**：由于思考块保留在上下文中，长对话将消耗更多上下文空间
- **自动行为**：这是上述每个模型的默认行为。无需代码更改或 beta 标头
- **向后兼容性**：要利用此功能，请像工具使用一样继续将完整的、未修改的思考块传回 API

<Note>
对于早期模型（Claude Sonnet 4.5、Opus 4.1（已弃用）等），先前回合的思考块继续从上下文中移除。[扩展思考与提示缓存](#extended-thinking-with-prompt-caching)部分中描述的现有行为适用于这些模型。
</Note>

## 定价 \{#pricing}

有关基础费率、缓存写入、缓存命中和输出令牌的完整定价信息，请参阅[定价页面](/docs/zh-CN/about-claude/pricing)。

思考过程会产生以下费用：
- 思考期间使用的令牌（输出令牌）
- 保留在上下文中的先前助手轮次的思考块：在早期 Opus/Sonnet 模型和所有 Haiku 模型上仅保留最后一轮；在 Opus 4.5+ 和 Sonnet 4.6+ 上默认保留所有轮次（输入令牌）
- 标准文本输出令牌

<Note>
启用扩展思考时，系统会自动包含一个专用的系统提示以支持此功能。
</Note>

使用摘要式思考时：
- **输入令牌：**您原始请求中的令牌（不包括先前轮次的思考令牌）
- **输出令牌（计费）：**Claude 内部生成的原始思考令牌
- **输出令牌（可见）：**您在响应中看到的摘要式思考令牌
- **不收费：**用于生成摘要的令牌

使用 `display: "omitted"` 时：
- **输入令牌：**您原始请求中的令牌（与摘要式相同）
- **输出令牌（计费）：**Claude 内部生成的原始思考令牌（与摘要式相同）
- **输出令牌（可见）：**零思考令牌（`thinking` 字段为空）

<Warning>
计费的输出令牌数量将**不会**与响应中可见的令牌数量相匹配。您需要为完整的思考过程付费，而不是响应中可见的思考内容。
</Warning>

要查看内部推理消耗了多少计费输出令牌，请读取响应中的 `usage.output_tokens_details.thinking_tokens`。该值反映模型生成的原始推理（而非响应正文中返回的摘要文本），并且始终小于或等于 `output_tokens`。从 `output_tokens` 中减去该值即可估算输出中非推理部分的令牌数。

```json
{
  "usage": {
    "input_tokens": 25,
    "output_tokens": 348,
    "output_tokens_details": {
      "thinking_tokens": 312
    }
  }
}
```

`output_tokens` 仍然是用于计费的包含性权威总数。`output_tokens_details` 是用于可观测性的只读明细。

## 扩展思考的最佳实践和注意事项 \{#best-practices-and-considerations-for-extended-thinking}

### 使用思考预算 \{#working-with-thinking-budgets}

- **预算优化：**最小预算为 1,024 个令牌。从最小值开始，逐步增加思考预算，以找到适合您用例的最佳范围。更高的令牌数量可以实现更全面的推理，但根据任务的不同，收益会逐渐递减。增加预算可以提高响应质量，但代价是增加 "latency"（延迟）。对于关键任务，请测试不同的设置以找到最佳平衡点。请注意，思考预算是一个目标值，而非严格限制。实际令牌使用量可能因任务而异。
- **起始点：**对于复杂任务，从较大的思考预算（16k+ 令牌）开始，然后根据您的需求进行调整。
- **大额预算：**对于超过 32k 的思考预算，请使用[批处理](/docs/zh-CN/build-with-claude/batch-processing)以避免网络问题。促使模型思考超过 32k 令牌的请求会导致长时间运行的请求，可能会遇到系统超时和开放连接限制的问题。
- **令牌使用跟踪：**监控思考令牌的使用情况，以优化成本和性能。响应中的 `usage.output_tokens_details.thinking_tokens` 字段报告了计费输出令牌中有多少用于内部推理。在流式传输时，此细分数据仅出现在最后的 `message_delta` 事件中。

### 性能考量 \{#performance-considerations}

- **响应时间：**由于需要额外的处理，请做好响应时间更长的准备。生成思考块会增加整体响应时间。
- **流式传输要求：**当 `max_tokens` 大于 21,333 时，SDK 要求使用 "streaming"（流式传输），以避免长时间运行的请求出现 HTTP 超时。这是客户端验证，而非 API 限制。如果您不需要增量处理事件，请使用 `.stream()` 配合 `.get_final_message()`（Python）或 `.finalMessage()`（TypeScript）来获取完整的 `Message` 对象，而无需处理单个事件。详情请参阅[流式传输消息](/docs/zh-CN/build-with-claude/streaming#get-the-final-message-without-handling-events)。在流式传输时，请做好在思考内容块和文本内容块到达时分别处理它们的准备。
- **省略思考以降低延迟：**如果您的应用程序不显示思考内容，请在思考配置中设置 `display: "omitted"` 以减少首个文本令牌的生成时间。请参阅[控制思考显示](#controlling-thinking-display)。

### 功能兼容性 \{#feature-compatibility}

- 思考功能与 `temperature` 或 `top_k` 修改以及[强制工具使用](/docs/zh-CN/agents-and-tools/tool-use/define-tools#forcing-tool-use)不兼容。
- 启用思考功能时，您可以将 `top_p` 设置为 1 到 0.95 之间的值。
- 启用思考功能时，您无法预填充响应。
- 更改思考预算会使包含消息的已缓存提示前缀失效。但是，当思考参数更改时，已缓存的系统提示和工具定义将继续有效。

### 使用指南 \{#usage-guidelines}

- **任务选择：**对于特别复杂、能够从逐步推理中受益的任务（如数学、编程和分析），请使用扩展思考。
- **上下文处理：**您无需自行移除之前的思考块。在 Opus 4.5+ 和 Sonnet 4.6+ 上，Claude API 默认保留之前轮次的思考块；在更早的 Opus/Sonnet 模型以及所有 Haiku 模型上，API 会自动忽略它们，并且在计算上下文使用量时不会将其包含在内。
- **提示工程：**如果您想最大限度地发挥 Claude 的思考能力，请查阅[扩展思考提示技巧](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices#leverage-thinking-and-interleaved-thinking-capabilities)。

## 后续步骤 \{#next-steps}

<CardGroup>
  <Card title="试用扩展思考 cookbook" icon="book" href="https://platform.claude.com/cookbook/extended-thinking-extended-thinking">
    在 cookbook 中探索思考功能的实际示例。
  </Card>
  <Card title="扩展思考提示技巧" icon="code" href="/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices#leverage-thinking-and-interleaved-thinking-capabilities">
    了解扩展思考的提示工程最佳实践。
  </Card>
</CardGroup>