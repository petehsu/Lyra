# 流式传输拒绝

---

从 Claude 4 模型开始，当流式传输分类器介入处理潜在的政策违规时，Claude API 的流式传输响应会返回 **`stop_reason`: `"refusal"`**。这项新的安全功能有助于在实时流式传输期间保持内容合规性。

<Tip>
如需进一步了解由 Claude Sonnet 4.5 的 API 安全过滤器触发的拒绝，请参阅[了解 Sonnet 4.5 的 API 安全过滤器](https://support.claude.com/en/articles/12449294-understanding-sonnet-4-5-s-api-safety-filters)。
</Tip>

## API 响应格式 \{#api-response-format}

当流式传输分类器检测到违反 Anthropic 政策的内容时，API 会返回以下响应：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Hello.."
    }
  ],
  "stop_reason": "refusal"
}
```

<Warning>
响应中不包含额外的拒绝消息。您必须自行处理该响应，并提供适当的面向用户的消息。
</Warning>

## 拒绝后重置上下文 \{#reset-context-after-refusal}

当您收到 **`stop_reason`: `refusal`** 时，必须先重置对话上下文才能继续。您可以移除或重新表述触发拒绝的那一轮对话，或者完全清除对话历史记录。如果不重置就尝试继续，将会导致持续的拒绝。

<Note>
即使响应被拒绝，响应中仍会提供使用量指标。

当拒绝在 Claude 生成任何输出之前到达时，您在 Claude API 上不会为该请求付费，该响应中的使用量计数仅供参考。当 Claude 在拒绝之前已生成输出时，您需要为该请求付费。
</Note>

<Tip>
如果您在使用 Claude Sonnet 4.5 或 Opus 4.1（[已弃用](/docs/zh-CN/about-claude/model-deprecations)）时频繁遇到 `refusal` 停止原因，可以尝试将 API 调用更新为使用 Haiku 4.5（`claude-haiku-4-5-20251001`），该模型具有不同的使用限制。详细了解[Sonnet 4.5 的 API 安全过滤器](https://support.claude.com/en/articles/12449294-understanding-sonnet-4-5-s-api-safety-filters)。
</Tip>

## 实现指南 \{#implementation-guide}

以下是如何在您的应用程序中检测和处理流式传输拒绝：

<CodeGroup>
```bash cURL
# 流式传输请求并检查拒绝情况
response=$(curl -N https://api.anthropic.com/v1/messages \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --data '{
    "model": "claude-opus-4-8",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 1024,
    "stream": true
  }')

# 在流中检查拒绝情况
if echo "$response" | grep -q '"stop_reason":"refusal"'; then
  echo "Response refused - resetting conversation context"
  # 在此处重置您的对话状态
fi
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()
messages = []


def reset_conversation():
    """Reset conversation context after refusal"""
    global messages
    messages = []
    print("Conversation reset due to refusal")


try:
    with client.messages.stream(
        max_tokens=1024,
        messages=messages + [{"role": "user", "content": "Hello"}],
        model="claude-opus-4-8",
    ) as stream:
        for event in stream:
            # 检查消息增量中的拒绝情况
            if event.type == "message_delta":
                if event.delta.stop_reason == "refusal":
                    reset_conversation()
                    break
except Exception as e:
    print(f"Error: {e}")
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
let messages: any[] = [];

function resetConversation() {
  // 在拒绝后重置对话上下文
  messages = [];
  console.log("Conversation reset due to refusal");
}

try {
  const stream = await client.messages.stream({
    messages: [...messages, { role: "user", content: "Hello" }],
    model: "claude-opus-4-8",
    max_tokens: 1024
  });

  for await (const event of stream) {
    // 在消息增量中检查拒绝
    if (event.type === "message_delta" && event.delta.stop_reason === "refusal") {
      resetConversation();
      break;
    }
  }
} catch (error) {
  console.error("Error:", error);
}
```

```csharp C# nocheck
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

class Program
{
    private static List<Message> messages = new();

    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var parameters = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 1024,
            Messages = [new() { Role = Role.User, Content = "Hello" }]
        };

        try
        {
            await foreach (var msg in client.Messages.CreateStreaming(parameters))
            {
                if (msg.Type == "message_delta" && msg.Delta?.StopReason == "refusal")
                {
                    ResetConversation();
                    break;
                }
            }
        }
        catch (Exception e)
        {
            Console.WriteLine($"Error: {e.Message}");
        }
    }

    private static void ResetConversation()
    {
        messages.Clear();
        Console.WriteLine("Conversation reset due to refusal");
    }
}
```

```go Go nocheck hidelines={1..10,17..18,-1..}
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

var messages []anthropic.MessageParam

func resetConversation() {
	messages = []anthropic.MessageParam{}
	fmt.Println("Conversation reset due to refusal")
}

func main() {
	client := anthropic.NewClient()

	stream := client.Messages.NewStreaming(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 1024,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Hello")),
		},
	})

streamLoop:
	for stream.Next() {
		event := stream.Current()
		switch eventVariant := event.AsAny().(type) {
		case anthropic.MessageDeltaEvent:
			if eventVariant.Delta.StopReason == "refusal" {
				resetConversation()
				break streamLoop
			}
		}
	}

	if err := stream.Err(); err != nil {
		log.Fatal(err)
	}
}
```

```java Java hidelines={1..5,9..10}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.MessageParam;
import com.anthropic.models.messages.Model;
import com.anthropic.core.http.StreamResponse;
import com.anthropic.models.messages.RawMessageStreamEvent;
import com.anthropic.models.messages.StopReason;
import java.util.ArrayList;
import java.util.List;

List<MessageParam> messages = new ArrayList<>();

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024L)
        .addUserMessage("Hello")
        .build();

    try (StreamResponse<RawMessageStreamEvent> stream = client.messages().createStreaming(params)) {
        stream.stream().forEach(event -> {
            event.messageDelta().ifPresent(deltaEvent -> {
                deltaEvent.delta().stopReason().ifPresent(stopReason -> {
                    if (stopReason.equals(StopReason.REFUSAL)) {
                        resetConversation();
                    }
                });
            });
        });
    } catch (Exception e) {
        System.err.println("Error: " + e.getMessage());
    }
}

void resetConversation() {
    messages.clear();
    IO.println("Conversation reset due to refusal");
}
```

```php PHP nocheck hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();
$messages = [];

function resetConversation(&$messages) {
    $messages = [];
    echo "Conversation reset due to refusal\n";
}

try {
    $stream = $client->messages->createStream(
        maxTokens: 1024,
        messages: [
            ['role' => 'user', 'content' => 'Hello']
        ],
        model: 'claude-opus-4-8',
    );

    foreach ($stream as $event) {
        if (isset($event->type) && $event->type === 'message_delta') {
            if (isset($event->delta->stopReason) && $event->delta->stopReason === 'refusal') {
                resetConversation($messages);
                break;
            }
        }
    }
} catch (Exception $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new
messages = []

def reset_conversation(messages)
  messages.clear
  puts "Conversation reset due to refusal"
end

begin
  stream = client.messages.stream(
    model: :"claude-opus-4-8",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Hello" }]
  )

  stream.each do |event|
    if event.type == :message_delta && event.delta.stop_reason == :refusal
      reset_conversation(messages)
      break
    end
  end
rescue => e
  puts "Error: #{e.message}"
end
```
</CodeGroup>

## 当前的拒绝类型 \{#current-refusal-types}

API 目前以三种不同的方式处理拒绝：

| 拒绝类型 | 响应格式 | 发生时机 |
|-------------|----------------|----------------|
| 流式传输分类器拒绝 | **`stop_reason`: `refusal`** | 在流式传输期间，当内容违反政策时 |
| API 输入和版权验证 | 400 错误代码 | 当输入未通过验证检查时 |
| 模型生成的拒绝 | 标准文本响应 | 当模型自身决定拒绝时 |

<Note>
未来的 API 版本将扩展 **`stop_reason`: `refusal`** 模式，以统一所有类型的拒绝处理。
</Note>

## 最佳实践 \{#best-practices}

- **监控拒绝**：在您的错误处理中包含 **`stop_reason`: `refusal`** 检查
- **自动重置**：在检测到拒绝时实现自动上下文重置
- **提供自定义消息**：创建用户友好的消息，以便在发生拒绝时提供更好的用户体验
- **跟踪拒绝模式**：监控拒绝频率，以识别提示中的潜在问题

## 迁移说明 \{#migration-notes}

- 未来的模型将把此模式扩展到其他拒绝类型
- 请规划您的错误处理，以适应未来拒绝响应的统一化