# 流式传输消息

---

在创建消息时，您可以设置 `"stream": true`，以使用 [server-sent events](https://developer.mozilla.org/en-US/Web/API/Server-sent%5Fevents/Using%5Fserver-sent%5Fevents)（服务器发送事件，即 SSE）增量地流式传输响应。

## 使用 SDK 进行流式传输 \{#streaming-with-sdks}

[Python](https://github.com/anthropics/anthropic-sdk-python) 和 [TypeScript](https://github.com/anthropics/anthropic-sdk-typescript) SDK 提供了多种流式传输方式。[PHP](https://github.com/anthropics/anthropic-sdk-php) SDK 通过 `createStream()` 提供流式传输。Python SDK 同时支持同步和异步流。详情请参阅各 SDK 的文档。

<CodeGroup>
    ```bash CLI
    ant messages create --stream --format jsonl \
      --model claude-opus-4-8 \
      --max-tokens 1024 \
      --message '{role: user, content: "Hello"}' \
      | while IFS= read -r event; do
          [[ $event == *'"text_delta"'* ]] || continue
          text=${event#*'"text":"'}
          printf '%b' "${text%\"*}"
        done
    ```

    ```python Python hidelines={1..2}
    import anthropic

    client = anthropic.Anthropic()

    with client.messages.stream(
        max_tokens=1024,
        messages=[{"role": "user", "content": "Hello"}],
        model="claude-opus-4-8",
    ) as stream:
        for text in stream.text_stream:
            print(text, end="", flush=True)
    ```

    ```typescript TypeScript hidelines={1..2}
    import Anthropic from "@anthropic-ai/sdk";

    const client = new Anthropic();

    await client.messages
      .stream({
        messages: [{ role: "user", content: "Hello" }],
        model: "claude-opus-4-8",
        max_tokens: 1024
      })
      .on("text", (text) => {
        console.log(text);
      });
    ```

    ```csharp C#
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
                MaxTokens = 1024,
                Messages = [new() { Role = Role.User, Content = "Hello" }]
            };

            await foreach (var msg in client.Messages.CreateStreaming(parameters))
            {
                Console.Write(msg);
            }
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
    		Model:     anthropic.ModelClaudeOpus4_8,
    		MaxTokens: 1024,
    		Messages: []anthropic.MessageParam{
    			anthropic.NewUserMessage(anthropic.NewTextBlock("Hello")),
    		},
    	})

    	for stream.Next() {
    		event := stream.Current()
    		switch eventVariant := event.AsAny().(type) {
    		case anthropic.ContentBlockDeltaEvent:
    			switch deltaVariant := eventVariant.Delta.AsAny().(type) {
    			case anthropic.TextDelta:
    				fmt.Print(deltaVariant.Text)
    			}
    		}
    	}
    	if err := stream.Err(); err != nil {
    		log.Fatal(err)
    	}
    }
    ```

    ```java Java hidelines={1..6,-2..}
    import com.anthropic.client.AnthropicClient;
    import com.anthropic.client.okhttp.AnthropicOkHttpClient;
    import com.anthropic.models.messages.MessageCreateParams;

    public class StreamingExample {
        public static void main(String[] args) {
            AnthropicClient client = AnthropicOkHttpClient.fromEnv();

            MessageCreateParams params = MessageCreateParams.builder()
                .model("claude-opus-4-8")
                .maxTokens(1024L)
                .addUserMessage("Hello")
                .build();

            try (var streamResponse = client.messages().createStreaming(params)) {
                streamResponse.stream().forEach(event -> {
                    event.contentBlockDelta().ifPresent(deltaEvent ->
                        deltaEvent.delta().text().ifPresent(td ->
                            System.out.print(td.text())
                        )
                    );
                });
            }
        }
    }
    ```

    ```php PHP hidelines={1..4}
    <?php

    use Anthropic\Client;

    $client = new Client();

    $stream = $client->messages->createStream(
        maxTokens: 1024,
        messages: [
            ['role' => 'user', 'content' => 'Hello']
        ],
        model: 'claude-opus-4-8',
    );

    foreach ($stream as $message) {
        echo $message;
    }
    ```

    ```ruby Ruby hidelines={1..2}
    require "anthropic"

    client = Anthropic::Client.new

    stream = client.messages.stream(
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }]
    )

    stream.text.each { |text| print(text) }
    ```
</CodeGroup>

## 无需处理事件即可获取最终消息 \{#get-the-final-message-without-handling-events}

如果您不需要在文本到达时进行处理，SDK 提供了一种在底层使用流式传输的同时返回完整 `Message` 对象的方法，该对象与 `.create()` 返回的对象完全相同。这对于 `max_tokens` 值较大的请求尤其有用，因为在这种情况下 SDK 需要使用流式传输来避免 HTTP 超时。

<CodeGroup>
    ```bash CLI
    # ant CLI 的 --stream 标志每行输出一个事件，且不会
    # 累积为最终的 Message。对于较长的生成内容，请流式传输
    # 原始事件：
    ant messages create --stream --format jsonl <<'YAML'
    model: claude-opus-4-8
    max_tokens: 128000
    messages:
      - role: user
        content: Write a detailed analysis...
    YAML
    ```

    ```python Python hidelines={1..2}
    import anthropic

    client = anthropic.Anthropic()

    with client.messages.stream(
        max_tokens=128000,
        messages=[{"role": "user", "content": "Write a detailed analysis..."}],
        model="claude-opus-4-8",
    ) as stream:
        message = stream.get_final_message()

    print(message.content[0].text)
    ```

    ```typescript TypeScript hidelines={1..2}
    import Anthropic from "@anthropic-ai/sdk";

    const client = new Anthropic();

    const stream = client.messages.stream({
      max_tokens: 128000,
      messages: [{ role: "user", content: "Write a detailed analysis..." }],
      model: "claude-opus-4-8"
    });

    const message = await stream.finalMessage();
    const textBlock = message.content.find((block) => block.type === "text");
    if (textBlock && textBlock.type === "text") {
      console.log(textBlock.text);
    }
    ```

    
    ```csharp C# nocheck
    using System;
    using System.Threading.Tasks;
    using Anthropic;
    using Anthropic.Models.Messages;

    class Program
    {
        static async Task Main()
        {
            AnthropicClient client = new();

            var parameters = new MessageCreateParams
            {
                Model = Model.ClaudeOpus4_8,
                MaxTokens = 128000,
                Messages = [new() { Role = Role.User, Content = "Write a detailed analysis..." }]
            };

            var fullText = "";
            await foreach (var msg in client.Messages.CreateStreaming(parameters))
            {
                fullText += msg;
            }

            Console.WriteLine(fullText);
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
    		Model:     anthropic.ModelClaudeOpus4_8,
    		MaxTokens: 128000,
    		Messages: []anthropic.MessageParam{
    			anthropic.NewUserMessage(anthropic.NewTextBlock("Write a detailed analysis...")),
    		},
    	})

    	message := anthropic.Message{}
    	for stream.Next() {
    		event := stream.Current()
    		if err := message.Accumulate(event); err != nil {
    			log.Fatal(err)
    		}
    	}
    	if err := stream.Err(); err != nil {
    		log.Fatal(err)
    	}

    	fmt.Println(message.Content[0].Text)
    }
    ```

    ```java Java hidelines={1..2,4..9,-2..}
    import com.anthropic.client.AnthropicClient;
    import com.anthropic.client.okhttp.AnthropicOkHttpClient;
    import com.anthropic.helpers.MessageAccumulator;
    import com.anthropic.models.messages.Message;
    import com.anthropic.models.messages.MessageCreateParams;
    import com.anthropic.models.messages.Model;

    public class StreamingExample {
        public static void main(String[] args) {
            AnthropicClient client = AnthropicOkHttpClient.fromEnv();

            MessageCreateParams params = MessageCreateParams.builder()
                .model(Model.CLAUDE_OPUS_4_8)
                .maxTokens(128000L)
                .addUserMessage("Write a detailed analysis...")
                .build();

            MessageAccumulator accumulator = MessageAccumulator.create();
            try (var streamResponse = client.messages().createStreaming(params)) {
                streamResponse.stream().forEach(accumulator::accumulate);
            }

            Message message = accumulator.message();
            message.content().get(0).text().ifPresent(tb -> System.out.println(tb.text()));
        }
    }
    ```

    ```php PHP hidelines={1..4}
    <?php

    use Anthropic\Client;

    $client = new Client();

    $stream = $client->messages->createStream(
        maxTokens: 128000,
        messages: [
            ['role' => 'user', 'content' => 'Write a detailed analysis...']
        ],
        model: 'claude-opus-4-8',
    );

    $fullText = '';
    foreach ($stream as $event) {
        if ($event->type === 'content_block_delta') {
            $fullText .= $event->delta->text;
        }
    }

    echo $fullText;
    ```

    ```ruby Ruby hidelines={1..2}
    require "anthropic"

    client = Anthropic::Client.new

    message = client.messages.stream(
      model: "claude-opus-4-8",
      max_tokens: 128000,
      messages: [{ role: "user", content: "Write a detailed analysis..." }]
    ).accumulated_message

    puts message.content.first.text
    ```
</CodeGroup>

`.stream()` 调用通过服务器发送事件保持 HTTP 连接处于活动状态，然后 `.get_final_message()`（Python）或 `.finalMessage()`（TypeScript）会累积所有事件并返回完整的 `Message` 对象。在 Go 中，您可以在流循环内调用 `message.Accumulate(event)` 来构建相同的完整 `Message`。在 Java 中，使用 `MessageAccumulator.create()` 并对每个事件调用 `accumulator.accumulate(event)`。在 C# 中，对流的 `.Aggregate()` 扩展方法使用 await 以获取完整的 `Message`，或者将 `MessageContentAggregator` 传递给 `.CollectAsync()` 以在处理事件的同时进行聚合。在 Ruby 中，对流调用 `.accumulated_message`。在 PHP SDK 中，您需要手动遍历流事件以累积响应。

## 事件类型 \{#event-types}

每个服务器发送事件都包含一个命名的事件类型和关联的 JSON 数据。每个事件使用一个 SSE 事件名称（例如 `event: message_stop`），并在其数据中包含匹配的事件 `type`。

每个流使用以下事件流程：

1. `message_start`：包含一个 `content` 为空的 `Message` 对象。
2. 一系列内容块，每个内容块都有一个 `content_block_start` 事件、一个或多个 `content_block_delta` 事件以及一个 `content_block_stop` 事件。每个内容块都有一个 `index`，对应于其在最终 Message `content` 数组中的索引。有一个例外：在[服务器端回退](/docs/zh-CN/build-with-claude/refusals-and-fallback#server-side-fallback)响应期间，`fallback` 内容块会在每个模型边界处以一对 `content_block_start` 和 `content_block_stop` 的形式到达，中间没有任何 delta。
3. 一个或多个 `message_delta` 事件，指示对最终 `Message` 对象的顶层更改。
4. 最后一个 `message_stop` 事件。

  <Warning>
  `message_delta` 事件的 `usage` 字段中显示的令牌计数是*累积的*。
  </Warning>

### Ping 事件 \{#ping-events}

事件流还可能包含任意数量的 `ping` 事件。

### 错误事件 \{#error-events}

API 可能偶尔会在事件流中发送[错误](/docs/zh-CN/api/errors)。例如，在高使用量期间，您可能会收到 `overloaded_error`，这在非流式传输上下文中通常对应于 HTTP 529：

```sse Example error
event: error
data: {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}
```

### 其他事件 \{#other-events}

根据[版本控制策略](/docs/zh-CN/api/versioning)，可能会添加新的事件类型，您的代码应能够优雅地处理未知的事件类型。

## 内容块 delta 类型 \{#content-block-delta-types}

每个 `content_block_delta` 事件都包含一个特定类型的 `delta`，用于更新给定 `index` 处的 `content` 块。

### 文本 delta \{#text-delta}

`text` 内容块的 delta 如下所示：
```sse Text delta
event: content_block_delta
data: {"type": "content_block_delta","index": 0,"delta": {"type": "text_delta", "text": "ello frien"}}
```

### 输入 JSON delta \{#input-json-delta}

`tool_use` 内容块的 delta 对应于该块 `input` 字段的更新。为了支持最大粒度，这些 delta 是*部分 JSON 字符串*，而最终的 `tool_use.input` 始终是一个*对象*。

您可以累积字符串 delta，并在收到 `content_block_stop` 事件后解析 JSON，方法是使用像 [Pydantic](https://docs.pydantic.dev/latest/concepts/json/#partial-json-parsing) 这样的库进行部分 JSON 解析，或者使用 [SDK](/docs/zh-CN/cli-sdks-libraries/overview)，它们提供了访问已解析增量值的辅助工具。

`tool_use` 内容块的 delta 如下所示：
```sse Input JSON delta
event: content_block_delta
data: {"type": "content_block_delta","index": 1,"delta": {"type": "input_json_delta","partial_json": "{\"location\": \"San Fra"}}}
```
注意：当前模型一次只支持从 `input` 中发出一个完整的键和值属性。因此，在使用工具时，模型工作期间流式传输事件之间可能会有延迟。一旦累积了一个 `input` 键和值，它们就会作为多个带有分块部分 JSON 的 `content_block_delta` 事件发出，以便该格式能够自动支持未来模型中更细的粒度。

### 思考 delta \{#thinking-delta}

当启用流式传输并使用[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking#streaming-thinking)时，您将通过 `thinking_delta` 事件接收思考内容。这些 delta 对应于 `thinking` 内容块的 `thinking` 字段。

对于思考内容，会在 `content_block_stop` 事件之前发送一个特殊的 `signature_delta` 事件。此签名用于验证思考块的完整性。

当在思考配置中设置 `display: "omitted"` 时，不会发送任何 `thinking_delta` 事件。思考块会打开，接收单个 `signature_delta`，然后关闭。请参阅[控制思考显示](/docs/zh-CN/build-with-claude/extended-thinking#controlling-thinking-display)。

典型的思考 delta 如下所示：
```sse Thinking delta
event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "I need to find the GCD of 1071 and 462 using the Euclidean algorithm.\n\n1071 = 2 × 462 + 147"}}
```

签名 delta 如下所示：
```sse Signature delta
event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pkiMOYds..."}}
```

## 完整的 HTTP 流响应 \{#full-http-stream-response}

使用流式传输模式时，请使用[客户端 SDK](/docs/zh-CN/cli-sdks-libraries/overview)。但是，如果您正在构建直接的 API 集成，则需要自行处理这些事件。

流响应包含：
1. 一个 `message_start` 事件
2. 可能有多个内容块，每个内容块包含：
    - 一个 `content_block_start` 事件
    - 可能有多个 `content_block_delta` 事件
    - 一个 `content_block_stop` 事件
3. 一个或多个 `message_delta` 事件
4. 一个 `message_stop` 事件

响应中还可能穿插有 `ping` 事件。有关格式的更多详细信息，请参阅[事件类型](#event-types)。

### 基本流式传输请求 \{#basic-streaming-request}

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --data \
'{
  "model": "claude-opus-4-8",
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 256,
  "stream": true
}'
```

```bash CLI
ant messages create --stream --format jsonl \
  --model claude-opus-4-8 \
  --max-tokens 256 \
  --message '{role: user, content: Hello}'
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

with client.messages.stream(
    model="claude-opus-4-8",
    messages=[{"role": "user", "content": "Hello"}],
    max_tokens=256,
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const stream = client.messages.stream({
  model: "claude-opus-4-8",
  messages: [{ role: "user", content: "Hello" }],
  max_tokens: 256
});

for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    process.stdout.write(event.delta.text);
  }
}
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

        var parameters = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 256,
            Messages = [new() { Role = Role.User, Content = "Hello" }]
        };

        await foreach (var msg in client.Messages.CreateStreaming(parameters))
        {
            Console.Write(msg);
        }
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
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 256,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Hello")),
		},
	})

	for stream.Next() {
		event := stream.Current()
		switch eventVariant := event.AsAny().(type) {
		case anthropic.ContentBlockDeltaEvent:
			switch deltaVariant := eventVariant.Delta.AsAny().(type) {
			case anthropic.TextDelta:
				fmt.Print(deltaVariant.Text)
			}
		}
	}
	if err := stream.Err(); err != nil {
		log.Fatal(err)
	}
}
```

```java Java hidelines={1..7,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;

public class StreamingExample {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(256L)
            .addUserMessage("Hello")
            .build();

        try (var streamResponse = client.messages().createStreaming(params)) {
            streamResponse.stream().forEach(event -> {
                event.contentBlockDelta().ifPresent(deltaEvent ->
                    deltaEvent.delta().text().ifPresent(td ->
                        System.out.print(td.text())
                    )
                );
            });
        }
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$stream = $client->messages->createStream(
    maxTokens: 256,
    messages: [
        ['role' => 'user', 'content' => 'Hello']
    ],
    model: 'claude-opus-4-8',
);

foreach ($stream as $message) {
    echo $message;
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

stream = client.messages.stream(
  model: "claude-opus-4-8",
  messages: [{ role: "user", content: "Hello" }],
  max_tokens: 256
)

stream.text.each { |text| print(text) }
```
</CodeGroup>

```sse Response
event: message_start
data: {"type": "message_start", "message": {"id": "msg_1nZdL29xx5MUA1yADyHTEsnR8uuvGzszyY", "type": "message", "role": "assistant", "content": [], "model": "claude-opus-4-8", "stop_reason": null, "stop_sequence": null, "usage": {"input_tokens": 25, "output_tokens": 1}}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: ping
data: {"type": "ping"}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "!"}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence":null}, "usage": {"output_tokens": 15}}

event: message_stop
data: {"type": "message_stop"}

```

### 带工具使用的流式传输请求 \{#streaming-request-with-tool-use}

<Tip>
工具使用支持参数值的[细粒度流式传输](/docs/zh-CN/agents-and-tools/tool-use/fine-grained-tool-streaming)。通过 `eager_input_streaming` 为每个工具启用它。
</Tip>

此请求要求 Claude 使用工具来报告天气。

<CodeGroup>
```bash cURL
  curl https://api.anthropic.com/v1/messages \
    -H "content-type: application/json" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -d '{
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
              }
            },
            "required": ["location"]
          }
        }
      ],
      "tool_choice": {"type": "any"},
      "messages": [
        {
          "role": "user",
          "content": "What is the weather like in San Francisco?"
        }
      ],
      "stream": true
    }'
```

```bash CLI
ant messages create --stream --format jsonl <<'YAML'
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
      required:
        - location
tool_choice:
  type: any
messages:
  - role: user
    content: What is the weather like in San Francisco?
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

tools = [
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
]

with client.messages.stream(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=tools,
    tool_choice={"type": "any"},
    messages=[
        {"role": "user", "content": "What is the weather like in San Francisco?"}
    ],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
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
];

const stream = client.messages.stream({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: tools,
  tool_choice: { type: "any" },
  messages: [
    {
      role: "user",
      content: "What is the weather like in San Francisco?"
    }
  ]
});

for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    process.stdout.write(event.delta.text);
  }
}
```

```csharp C#
using System;
using System.Text.Json;
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
                        },
                        Required = ["location"],
                    },
                }),
            ],
            ToolChoice = new ToolChoiceAny(),
            Messages = [
                new() { Role = Role.User, Content = "What is the weather like in San Francisco?" }
            ]
        };

        await foreach (var msg in client.Messages.CreateStreaming(parameters))
        {
            Console.Write(msg);
        }
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
					},
					Required: []string{"location"},
				},
			}},
		},
		ToolChoice: anthropic.ToolChoiceUnionParam{OfAny: &anthropic.ToolChoiceAnyParam{}},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What is the weather like in San Francisco?")),
		},
	})

	for stream.Next() {
		event := stream.Current()
		switch eventVariant := event.AsAny().(type) {
		case anthropic.ContentBlockDeltaEvent:
			switch deltaVariant := eventVariant.Delta.AsAny().(type) {
			case anthropic.TextDelta:
				fmt.Print(deltaVariant.Text)
			}
		}
	}
	if err := stream.Err(); err != nil {
		log.Fatal(err)
	}
}
```

```java Java hidelines={1..13,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.ToolChoice;
import com.anthropic.models.messages.ToolChoiceAny;
import com.anthropic.models.messages.Tool;
import com.anthropic.core.JsonValue;
import java.util.Map;
import java.util.List;

public class StreamingToolUse {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(1024L)
            .addTool(Tool.builder()
                .name("get_weather")
                .description("Get the current weather in a given location")
                .inputSchema(Tool.InputSchema.builder()
                    .properties(JsonValue.from(Map.of(
                        "location", Map.of(
                            "type", "string",
                            "description", "The city and state, e.g. San Francisco, CA"
                        )
                    )))
                    .putAdditionalProperty("required", JsonValue.from(List.of("location")))
                    .build())
                .build())
            .toolChoice(ToolChoice.ofAny(ToolChoiceAny.builder().build()))
            .addUserMessage("What is the weather like in San Francisco?")
            .build();

        try (var streamResponse = client.messages().createStreaming(params)) {
            streamResponse.stream().forEach(event -> {
                event.contentBlockDelta().ifPresent(deltaEvent ->
                    deltaEvent.delta().text().ifPresent(td ->
                        System.out.print(td.text())
                    )
                );
            });
        }
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$stream = $client->messages->createStream(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'What is the weather like in San Francisco?']
    ],
    model: 'claude-opus-4-8',
    toolChoice: ['type' => 'any'],
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

foreach ($stream as $message) {
    echo $message;
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

tools = [
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
]

stream = client.messages.stream(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: tools,
  tool_choice: { type: "any" },
  messages: [
    { role: "user", content: "What is the weather like in San Francisco?" }
  ]
)

stream.text.each { |text| print(text) }
```
</CodeGroup>

```sse Response
event: message_start
data: {"type":"message_start","message":{"id":"msg_014p7gG3wDgGV9EUtLvnow3U","type":"message","role":"assistant","model":"claude-opus-4-8","stop_sequence":null,"usage":{"input_tokens":472,"output_tokens":2},"content":[],"stop_reason":null}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: ping
data: {"type": "ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Okay"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":","}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" let"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"'s"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" check"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" the"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" weather"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" for"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" San"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" Francisco"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":","}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" CA"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":":"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_01T1x1fJ34qAmk2tNTrN7Up6","name":"get_weather","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"location\":"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":" \"San"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":" Francisc"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"o,"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":" CA\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":89}}

event: message_stop
data: {"type":"message_stop"}
```

### 带扩展思考的流式传输请求 \{#streaming-request-with-extended-thinking}

此请求启用带流式传输的扩展思考。`display: "summarized"` 设置会流式传输 Claude 推理过程的精简摘要，而不是完整的思维链。

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "model": "claude-opus-4-8",
    "max_tokens": 20000,
    "stream": true,
    "thinking": {
        "type": "adaptive",
        "display": "summarized"
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
  --model claude-opus-4-8 \
  --max-tokens 20000 \
  --thinking '{type: adaptive, display: summarized}' \
  --message '{role: user, content: What is the greatest common divisor of 1071 and 462?}'
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

with client.messages.stream(
    model="claude-opus-4-8",
    max_tokens=20000,
    thinking={"type": "adaptive", "display": "summarized"},
    messages=[
        {
            "role": "user",
            "content": "What is the greatest common divisor of 1071 and 462?",
        }
    ],
) as stream:
    for event in stream:
        if event.type == "content_block_delta":
            if event.delta.type == "thinking_delta":
                print(event.delta.thinking, end="", flush=True)
            elif event.delta.type == "text_delta":
                print(event.delta.text, end="", flush=True)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const stream = client.messages.stream({
  model: "claude-opus-4-8",
  max_tokens: 20000,
  thinking: { type: "adaptive", display: "summarized" },
  messages: [
    {
      role: "user",
      content: "What is the greatest common divisor of 1071 and 462?"
    }
  ]
});

for await (const event of stream) {
  if (event.type === "content_block_delta") {
    if (event.delta.type === "thinking_delta") {
      process.stdout.write(event.delta.thinking);
    } else if (event.delta.type === "text_delta") {
      process.stdout.write(event.delta.text);
    }
  }
}
```

```csharp C#
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 20000,
    Thinking = new ThinkingConfigAdaptive { Display = Display.Summarized },
    Messages = [new() { Role = Role.User, Content = "What is the greatest common divisor of 1071 and 462?" }]
};

await foreach (var msg in client.Messages.CreateStreaming(parameters))
{
    Console.Write(msg);
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
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 20000,
		Thinking: anthropic.ThinkingConfigParamUnion{
			OfAdaptive: &anthropic.ThinkingConfigAdaptiveParam{
				Display: anthropic.ThinkingConfigAdaptiveDisplaySummarized,
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What is the greatest common divisor of 1071 and 462?")),
		},
	})

	for stream.Next() {
		event := stream.Current()
		switch eventVariant := event.AsAny().(type) {
		case anthropic.ContentBlockDeltaEvent:
			switch deltaVariant := eventVariant.Delta.AsAny().(type) {
			case anthropic.ThinkingDelta:
				fmt.Print(deltaVariant.Thinking)
			case anthropic.TextDelta:
				fmt.Print(deltaVariant.Text)
			}
		}
	}
	if err := stream.Err(); err != nil {
		log.Fatal(err)
	}
}
```

```java Java hidelines={1..7,-1}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.ThinkingConfigAdaptive;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(20000L)
        .thinking(ThinkingConfigAdaptive.builder()
            .display(ThinkingConfigAdaptive.Display.SUMMARIZED)
            .build())
        .addUserMessage("What is the greatest common divisor of 1071 and 462?")
        .build();

    try (var streamResponse = client.messages().createStreaming(params)) {
        streamResponse.stream().forEach(event -> {
            event.contentBlockDelta().ifPresent(deltaEvent -> {
                deltaEvent.delta().thinking().ifPresent(td ->
                    IO.print(td.thinking())
                );
                deltaEvent.delta().text().ifPresent(td ->
                    IO.print(td.text())
                );
            });
        });
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$stream = $client->messages->createStream(
    maxTokens: 20000,
    messages: [
        ['role' => 'user', 'content' => 'What is the greatest common divisor of 1071 and 462?']
    ],
    model: 'claude-opus-4-8',
    thinking: ['type' => 'adaptive', 'display' => 'summarized'],
);

foreach ($stream as $message) {
    echo $message;
}
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

stream = client.messages.stream(
  model: "claude-opus-4-8",
  max_tokens: 20000,
  thinking: { type: "adaptive", display: "summarized" },
  messages: [
    { role: "user", content: "What is the greatest common divisor of 1071 and 462?" }
  ]
)

stream.each do |event|
  if event.type == :content_block_delta
    if event.delta.type == :thinking_delta
      print(event.delta.thinking)
    elsif event.delta.type == :text_delta
      print(event.delta.text)
    end
  end
end
```
</CodeGroup>

```sse Response
event: message_start
data: {"type": "message_start", "message": {"id": "msg_01...", "type": "message", "role": "assistant", "content": [], "model": "claude-opus-4-8", "stop_reason": null, "stop_sequence": null}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "I need to find the GCD of 1071 and 462 using the Euclidean algorithm.\n\n1071 = 2 × 462 + 147"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "\n462 = 3 × 147 + 21"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "\n147 = 7 × 21 + 0"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "\nThe remainder is 0, so GCD(1071, 462) = 21."}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "EqQBCgIYAhIM1gbcDa9GJwZA2b3hGgxBdjrkzLoky3dl1pkiMOYds..."}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: content_block_start
data: {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "The greatest common divisor of 1071 and 462 is **21**."}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 1}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": null}}

event: message_stop
data: {"type": "message_stop"}
```

### 带网络搜索工具使用的流式传输请求 \{#streaming-request-with-web-search-tool-use}

此请求要求 Claude 搜索网络以获取当前天气信息。

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
    "stream": true,
    "tools": [
        {
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5
        }
    ],
    "messages": [
        {
            "role": "user",
            "content": "What is the weather like in New York City today?"
        }
    ]
}'
```

```bash CLI
ant messages create --stream --format jsonl \
  --model claude-opus-4-8 \
  --max-tokens 1024 \
  --tool '{type: web_search_20250305, name: web_search, max_uses: 5}' \
  --message '{role: user, content: What is the weather like in New York City today?}'
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

with client.messages.stream(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}],
    messages=[
        {"role": "user", "content": "What is the weather like in New York City today?"}
    ],
) as stream:
    for text in stream.text_stream:
        print(text, end="", flush=True)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const stream = client.messages.stream({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
  messages: [{ role: "user", content: "What is the weather like in New York City today?" }]
});

for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    process.stdout.write(event.delta.text);
  }
}
```

```csharp C#
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Tools = [new ToolUnion(new WebSearchTool20250305() { MaxUses = 5 })],
    Messages = [new() { Role = Role.User, Content = "What is the weather like in New York City today?" }]
};

await foreach (var msg in client.Messages.CreateStreaming(parameters))
{
    Console.Write(msg);
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
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 1024,
		Tools: []anthropic.ToolUnionParam{
			{
				OfWebSearchTool20250305: &anthropic.WebSearchTool20250305Param{
					MaxUses: anthropic.Int(5),
				},
			},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("What is the weather like in New York City today?")),
		},
	})

	for stream.Next() {
		event := stream.Current()
		switch eventVariant := event.AsAny().(type) {
		case anthropic.ContentBlockDeltaEvent:
			switch deltaVariant := eventVariant.Delta.AsAny().(type) {
			case anthropic.TextDelta:
				fmt.Print(deltaVariant.Text)
			}
		}
	}
	if err := stream.Err(); err != nil {
		log.Fatal(err)
	}
}
```

```java Java hidelines={1..4,6..8,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.WebSearchTool20250305;

public class WebSearchStreaming {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(1024L)
            .addTool(WebSearchTool20250305.builder()
                .maxUses(5L)
                .build())
            .addUserMessage("What is the weather like in New York City today?")
            .build();

        try (var streamResponse = client.messages().createStreaming(params)) {
            streamResponse.stream().forEach(event -> {
                event.contentBlockDelta().ifPresent(deltaEvent ->
                    deltaEvent.delta().text().ifPresent(td ->
                        System.out.print(td.text())
                    )
                );
            });
        }
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$stream = $client->messages->createStream(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'What is the weather like in New York City today?']
    ],
    model: 'claude-opus-4-8',
    tools: [
        ['type' => 'web_search_20250305', 'name' => 'web_search', 'max_uses' => 5]
    ],
);

foreach ($stream as $message) {
    echo $message;
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

stream = client.messages.stream(
  model: :"claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 5
    }
  ],
  messages: [
    {
      role: "user",
      content: "What is the weather like in New York City today?"
    }
  ]
)

stream.text.each { |text| print(text) }
```
</CodeGroup>

```sse Response
event: message_start
data: {"type":"message_start","message":{"id":"msg_01G...","type":"message","role":"assistant","model":"claude-opus-4-8","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":2679,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":3}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I'll check"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" the current weather in New York City for you"}}

event: ping
data: {"type": "ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"server_tool_use","id":"srvtoolu_014hJH82Qum7Td6UV8gDXThB","name":"web_search","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"query"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\":"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":" \"weather"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":" NY"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"C to"}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"day\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1 }

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtoolu_014hJH82Qum7Td6UV8gDXThB","content":[{"type":"web_search_result","title":"Weather in New York City in May 2025 (New York) - detailed Weather Forecast for a month","url":"https://world-weather.info/forecast/usa/new_york/may-2025/","encrypted_content":"Ev0DCioIAxgCIiQ3NmU4ZmI4OC1k...","page_age":null},...]}}

event: content_block_stop
data: {"type":"content_block_stop","index":2}

event: content_block_start
data: {"type":"content_block_start","index":3,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":"Here's the current weather information for New York"}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":" City:\n\n# Weather"}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":" in New York City"}}

event: content_block_delta
data: {"type":"content_block_delta","index":3,"delta":{"type":"text_delta","text":"\n\n"}}

...

event: content_block_stop
data: {"type":"content_block_stop","index":17}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":10682,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":510,"server_tool_use":{"web_search_requests":1}}}

event: message_stop
data: {"type":"message_stop"}
```

## 错误恢复 \{#error-recovery}

### Claude 4.5 及更早版本 \{#claude-4-5-and-earlier}

对于 Claude 4.5 及更早版本的模型，您可以通过从流中断的位置恢复，来恢复因网络问题、超时或其他错误而中断的流式传输请求。这种方法可以避免重新处理整个响应。

基本的恢复策略包括：

1. **捕获部分响应：** 保存在错误发生之前成功接收到的所有内容
2. **构造续接请求：** 创建一个新的 API 请求，将部分助手响应作为新助手消息的开头
3. **恢复流式传输：** 从中断的位置继续接收响应的其余部分

### Claude 4.6 及更高版本 \{#claude-4-6-and-later}

对于 Claude 4.6 及更高版本的模型，同样适用捕获并恢复的策略，但第 2 步有所变化：不是将部分响应放在助手消息中，而是添加一条用户消息，指示模型从中断的位置继续。

1. **捕获部分响应：** 保存在错误发生之前成功接收到的所有内容
2. **构造续接请求：** 创建一个新的 API 请求，其中包含一条用户消息，该消息包含部分响应和继续的指令，例如：
   ```text Sample prompt
   Your previous response was interrupted and ended with [previous_response]. Continue from where you left off.
   ```
3. **恢复流式传输：** 从中断的位置继续接收响应的其余部分

### 错误恢复最佳实践 \{#error-recovery-best-practices}

1. **使用 SDK 功能：** 利用 SDK 内置的消息累积和错误处理功能
2. **处理内容类型：** 请注意，消息可以包含多个内容块（`text`、`tool_use`、`thinking`）。工具使用和扩展思考块无法部分恢复。您可以从最近的文本块恢复流式传输。