# 批处理

---

"Batch processing"（批处理）是一种高效处理大量请求的强大方法。与逐个处理请求并立即返回响应不同，批处理允许您将多个请求一起提交以进行异步处理。这种模式在以下情况下特别有用：

- 您需要处理大量数据
- 不需要立即获得响应
- 您希望优化成本效益
- 您正在运行大规模评估或分析

Message Batches API 是 Anthropic 对此模式的首个实现。

<Note>
此功能**不**符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。数据将根据该功能的标准保留策略进行保留。
</Note>

---

# Message Batches API \{#message-batches-api}

Message Batches API 是一种强大且经济高效的方式，用于异步处理大量 [Messages](/docs/zh-CN/api/messages/create) 请求。这种方法非常适合不需要立即响应的任务，大多数批次在 1 小时内完成，同时可降低 50% 的成本并提高吞吐量。

除了本指南外，您还可以[直接查阅 API 参考文档](/docs/zh-CN/api/creating-message-batches)。

## Message Batches API 的工作原理 \{#how-the-message-batches-api-works}

当您向 Message Batches API 发送请求时：

1. 系统会使用提供的 Messages 请求创建一个新的 Message Batch。
2. 然后异步处理该批次，每个请求独立处理。
3. 您可以轮询批次的状态，并在所有请求处理结束后检索结果。

这对于不需要立即获得结果的批量操作特别有用，例如：
- 大规模评估：高效处理数千个测试用例。
- 内容审核：异步分析大量用户生成的内容。
- 数据分析：为大型数据集生成洞察或摘要。
- 批量内容生成：为各种目的创建大量文本（例如产品描述、文章摘要）。

### 批次限制 \{#batch-limitations}
- 一个 Message Batch 最多包含 100,000 个 Message 请求或 256 MB 大小，以先达到者为准。
- 系统会尽可能快地处理每个批次，大多数批次在 1 小时内完成。当所有消息完成处理或 24 小时后（以先到者为准），您可以访问批次结果。如果处理未在 24 小时内完成，批次将过期。
- 批次结果在创建后 29 天内可用。此后，您仍可以查看批次，但其结果将不再可供下载。
- 批次的作用域限定在 [Workspace](/settings/workspaces) 内。您可以查看在您的 API 密钥所属 Workspace 中创建的所有批次（及其结果）。
- 速率限制同时适用于 Batches API 的 HTTP 请求以及批次中等待处理的请求数量。请参阅 [Message Batches API 速率限制](/docs/zh-CN/api/rate-limits#message-batches-api)。此外，处理速度可能会根据当前需求和您的请求量而减慢。在这种情况下，您可能会看到更多请求在 24 小时后过期。
- 由于高吞吐量和并发处理，批次可能会略微超出您的 Workspace 配置的[支出限额](/settings/limits)。
- 每个批处理请求的 `max_tokens` 必须至少为 `1`。批次内不支持 `max_tokens: 0`（[缓存预热](/docs/zh-CN/build-with-claude/prompt-caching#pre-warming-the-cache)），因为在批处理期间写入的临时缓存条目很可能在后续请求运行之前就已过期。

### 支持的模型 \{#supported-models}

所有[活跃模型](/docs/zh-CN/about-claude/models/overview)均支持 Message Batches API。

### 可批处理的内容 \{#what-can-be-batched}
几乎所有可以向 Messages API 发出的请求都可以包含在批次中。这包括：

- 视觉
- 工具使用，包括所有[服务器工具](/docs/zh-CN/agents-and-tools/tool-use/server-tools)（网络搜索、网络抓取、代码执行、MCP 连接器、advisor 和工具搜索）
- 系统消息
- 多轮对话
- 扩展思考
- 大多数测试版功能

由于批次中的每个请求都是独立处理的，您可以在单个批次中混合不同类型的请求。

少数 Messages API 参数在批处理请求中**不**受支持。包含以下任何参数都会返回验证错误：

| 参数 | 原因 |
|---|---|
| `stream: true` | 批次结果以单个文件形式返回，而非流式传输。 |
| `speed`（[快速模式](/docs/zh-CN/build-with-claude/fast-mode)） | 快速模式用于调优同步延迟，不适用于异步批处理。 |
| `store` / `previous_thread_event_id`（Threads） | Threads 是有状态的；批处理请求不是。 |
| `cache_hint` / `context_hint` | 这些路由提示仅适用于同步请求调度。 |
| `max_tokens: 0` | 请参阅[批次限制](#batch-limitations)。 |
| `research_preview_2026_02: "active"` | 研究预览模式在批处理路径上不可用。 |

<Tip>
由于批次处理可能需要超过 5 分钟，在处理具有共享上下文的批次时，请考虑将 [1 小时缓存持续时间](/docs/zh-CN/build-with-claude/prompt-caching#1-hour-cache-duration)与提示缓存结合使用，以获得更高的缓存命中率。
</Tip>

---
## 定价 \{#pricing}

Batches API 可显著节省成本。所有使用量均按标准 API 价格的 50% 收费。

| 模型             | 批量输入      | 批量输出    |
|-------------------|------------------|-----------------|
| Claude Fable 5        | $5 / MTok        | $25 / MTok      |
| Claude Mythos 5（[限量供应](https://anthropic.com/glasswing)） | $5 / MTok        | $25 / MTok      |
| Claude Opus 4.8       | $2.50 / MTok     | $12.50 / MTok   |
| Claude Opus 4.7       | $2.50 / MTok     | $12.50 / MTok   |
| Claude Opus 4.6       | $2.50 / MTok     | $12.50 / MTok   |
| Claude Opus 4.5     | $2.50 / MTok     | $12.50 / MTok   |
| Claude Opus 4.1（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $7.50 / MTok     | $37.50 / MTok   |
| Claude Opus 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $7.50 / MTok     | $37.50 / MTok   |
| Claude Sonnet 4.6   | $1.50 / MTok     | $7.50 / MTok    |
| Claude Sonnet 4.5   | $1.50 / MTok     | $7.50 / MTok    |
| Claude Sonnet 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | $1.50 / MTok     | $7.50 / MTok    |
| Claude Haiku 4.5  | $0.50 / MTok     | $2.50 / MTok    |
| Claude Haiku 3.5（[已停用，Bedrock 和 Vertex AI 除外](/docs/zh-CN/about-claude/model-deprecations)） | $0.40 / MTok     | $2 / MTok       |

---
## 如何使用 Message Batches API \{#how-to-use-the-message-batches-api}

### 准备并创建批次 \{#prepare-and-create-your-batch}

Message Batch 由一系列创建 Message 的请求组成。单个请求的结构包括：
- 一个唯一的 `custom_id`，用于标识 Messages 请求。必须为 1 到 64 个字符，且仅包含字母数字字符、连字符和下划线（匹配 `^[a-zA-Z0-9_-]{1,64}$`）。
- 一个 `params` 对象，包含标准的 [Messages API](/docs/zh-CN/api/messages/create) 参数

您可以通过将此列表传入 `requests` 参数来[创建批次](/docs/zh-CN/api/creating-message-batches)：

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages/batches \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "requests": [
        {
            "custom_id": "my-first-request",
            "params": {
                "model": "claude-opus-4-8",
                "max_tokens": 1024,
                "messages": [
                    {"role": "user", "content": "Hello, world"}
                ]
            }
        },
        {
            "custom_id": "my-second-request",
            "params": {
                "model": "claude-opus-4-8",
                "max_tokens": 1024,
                "messages": [
                    {"role": "user", "content": "Hi again, friend"}
                ]
            }
        }
    ]
}'
```

```bash CLI
ant messages:batches create <<'YAML'
requests:
  - custom_id: my-first-request
    params:
      model: claude-opus-4-8
      max_tokens: 1024
      messages:
        - role: user
          content: Hello, world
  - custom_id: my-second-request
    params:
      model: claude-opus-4-8
      max_tokens: 1024
      messages:
        - role: user
          content: Hi again, friend
YAML
```

```python Python hidelines={1}
import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

client = anthropic.Anthropic()

message_batch = client.messages.batches.create(
    requests=[
        Request(
            custom_id="my-first-request",
            params=MessageCreateParamsNonStreaming(
                model="claude-opus-4-8",
                max_tokens=1024,
                messages=[
                    {
                        "role": "user",
                        "content": "Hello, world",
                    }
                ],
            ),
        ),
        Request(
            custom_id="my-second-request",
            params=MessageCreateParamsNonStreaming(
                model="claude-opus-4-8",
                max_tokens=1024,
                messages=[
                    {
                        "role": "user",
                        "content": "Hi again, friend",
                    }
                ],
            ),
        ),
    ]
)

print(message_batch)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const messageBatch = await anthropic.messages.batches.create({
  requests: [
    {
      custom_id: "my-first-request",
      params: {
        model: "claude-opus-4-8",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hello, world" }]
      }
    },
    {
      custom_id: "my-second-request",
      params: {
        model: "claude-opus-4-8",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Hi again, friend" }]
      }
    }
  ]
});

console.log(messageBatch);
```

```csharp C#
using Anthropic;
using Anthropic.Models.Messages;
using Anthropic.Models.Messages.Batches;

AnthropicClient client = new();

var batch = await client.Messages.Batches.Create(new BatchCreateParams
{
    Requests =
    [
        new()
        {
            CustomID = "my-first-request",
            Params = new()
            {
                Model = Model.ClaudeOpus4_8,
                MaxTokens = 1024,
                Messages =
                [
                    new() { Role = Role.User, Content = "Hello, world" }
                ]
            }
        },
        new()
        {
            CustomID = "my-second-request",
            Params = new()
            {
                Model = Model.ClaudeOpus4_8,
                MaxTokens = 1024,
                Messages =
                [
                    new() { Role = Role.User, Content = "Hi again, friend" }
                ]
            }
        }
    ]
});

Console.WriteLine(batch);
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

	batch, _ := client.Messages.Batches.New(context.Background(),
		anthropic.MessageBatchNewParams{
			Requests: []anthropic.MessageBatchNewParamsRequest{
				{
					CustomID: "my-first-request",
					Params: anthropic.MessageBatchNewParamsRequestParams{
						Model:     anthropic.ModelClaudeOpus4_8,
						MaxTokens: 1024,
						Messages: []anthropic.MessageParam{
							anthropic.NewUserMessage(
								anthropic.NewTextBlock("Hello, world"),
							),
						},
					},
				},
				{
					CustomID: "my-second-request",
					Params: anthropic.MessageBatchNewParamsRequestParams{
						Model:     anthropic.ModelClaudeOpus4_8,
						MaxTokens: 1024,
						Messages: []anthropic.MessageParam{
							anthropic.NewUserMessage(
								anthropic.NewTextBlock("Hi again, friend"),
							),
						},
					},
				},
			},
		})

	fmt.Println(batch.ID)
}
```

```java Java hidelines={1..3,5..8,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.batches.*;

public class BatchExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    BatchCreateParams params = BatchCreateParams.builder()
      .addRequest(
        BatchCreateParams.Request.builder()
          .customId("my-first-request")
          .params(
            BatchCreateParams.Request.Params.builder()
              .model(Model.CLAUDE_OPUS_4_8)
              .maxTokens(1024)
              .addUserMessage("Hello, world")
              .build()
          )
          .build()
      )
      .addRequest(
        BatchCreateParams.Request.builder()
          .customId("my-second-request")
          .params(
            BatchCreateParams.Request.Params.builder()
              .model(Model.CLAUDE_OPUS_4_8)
              .maxTokens(1024)
              .addUserMessage("Hi again, friend")
              .build()
          )
          .build()
      )
      .build();

    MessageBatch messageBatch = client.messages().batches().create(params);

    System.out.println(messageBatch);
  }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$batch = $client->messages->batches->create(
    requests: [
        [
            'custom_id' => 'my-first-request',
            'params' => [
                'model' => 'claude-opus-4-8',
                'max_tokens' => 1024,
                'messages' => [
                    ['role' => 'user', 'content' => 'Hello, world']
                ]
            ]
        ],
        [
            'custom_id' => 'my-second-request',
            'params' => [
                'model' => 'claude-opus-4-8',
                'max_tokens' => 1024,
                'messages' => [
                    ['role' => 'user', 'content' => 'Hi again, friend']
                ]
            ]
        ]
    ],
);

echo $batch->id;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

batch = client.messages.batches.create(
  requests: [
    {
      custom_id: "my-first-request",
      params: {
        model: "claude-opus-4-8",
        max_tokens: 1024,
        messages: [
          { role: "user", content: "Hello, world" }
        ]
      }
    },
    {
      custom_id: "my-second-request",
      params: {
        model: "claude-opus-4-8",
        max_tokens: 1024,
        messages: [
          { role: "user", content: "Hi again, friend" }
        ]
      }
    }
  ]
)

puts batch
```

</CodeGroup>

在此示例中，两个独立的请求被批处理在一起以进行异步处理。每个请求都有一个唯一的 `custom_id`，并包含您在 Messages API 调用中会使用的标准参数。

<Tip>
  **使用 Messages API 测试您的批处理请求**

每个消息请求的 `params` 对象的验证是异步执行的，验证错误会在整个批次处理结束后返回。您可以先通过 [Messages API](/docs/zh-CN/api/messages/create) 验证请求结构，以确保正确构建输入。
</Tip>

首次创建批次时，响应的处理状态将为 `in_progress`。

```json Output
{
  "id": "msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d",
  "type": "message_batch",
  "processing_status": "in_progress",
  "request_counts": {
    "processing": 2,
    "succeeded": 0,
    "errored": 0,
    "canceled": 0,
    "expired": 0
  },
  "ended_at": null,
  "created_at": "2024-09-24T18:37:24.100435Z",
  "expires_at": "2024-09-25T18:37:24.100435Z",
  "cancel_initiated_at": null,
  "results_url": null
}
```

### 跟踪您的批次 \{#tracking-your-batch}

Message Batch 的 `processing_status` 字段指示批次所处的处理阶段。它从 `in_progress` 开始，当批次中的所有请求完成处理且结果准备就绪后，更新为 `ended`。您可以通过访问 [Console](/settings/workspaces/default/batches) 或使用[检索端点](/docs/zh-CN/api/retrieving-message-batches)来监控批次的状态。

#### 轮询 Message Batch 完成状态 \{#polling-for-message-batch-completion}

要轮询 Message Batch，您需要其 `id`，该 ID 在创建批次时的响应中提供，或通过列出批次获得。您可以实现一个轮询循环，定期检查批次状态，直到处理结束：

<CodeGroup>
```bash cURL hidelines={2..16,23}
#!/bin/sh
MESSAGE_BATCH_ID=$(curl -s https://api.anthropic.com/v1/messages/batches \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --data '{
    "requests": [{
      "custom_id": "test-1",
      "params": {
        "model": "claude-opus-4-8",
        "max_tokens": 100,
        "messages": [{"role": "user", "content": "Hi"}]
      }
    }]
  }' | jq -r '.id')

until [[ $(curl -s "https://api.anthropic.com/v1/messages/batches/$MESSAGE_BATCH_ID" \
          --header "x-api-key: $ANTHROPIC_API_KEY" \
          --header "anthropic-version: 2023-06-01" \
          | grep -o '"processing_status":[[:space:]]*"[^"]*"' \
          | cut -d'"' -f4) == "ended" ]]; do
    echo "Batch $MESSAGE_BATCH_ID is still processing..."
    break
    sleep 60
done

echo "Batch $MESSAGE_BATCH_ID has finished processing"
```

```bash CLI hidelines={2..14,19}
#!/bin/bash
MESSAGE_BATCH_ID=$(ant messages:batches create \
  --transform id --raw-output <<'YAML'
requests:
  - custom_id: test-1
    params:
      model: claude-opus-4-8
      max_tokens: 100
      messages:
        - role: user
          content: Hi
YAML
)

until [[ $(ant messages:batches retrieve \
          --message-batch-id "$MESSAGE_BATCH_ID" \
          --transform processing_status --raw-output) == "ended" ]]; do
    echo "Batch $MESSAGE_BATCH_ID is still processing..."
    break
    sleep 60
done

echo "Batch $MESSAGE_BATCH_ID has finished processing"
```

```python Python nocheck hidelines={1}
import anthropic
import time

client = anthropic.Anthropic()

MESSAGE_BATCH_ID = "msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d"

message_batch = None
while True:
    message_batch = client.messages.batches.retrieve(MESSAGE_BATCH_ID)
    if message_batch.processing_status == "ended":
        break

    print(f"Batch {MESSAGE_BATCH_ID} is still processing...")
    time.sleep(60)
print(message_batch)
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const messageBatchId = "msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d";

let messageBatch;
while (true) {
  messageBatch = await anthropic.messages.batches.retrieve(messageBatchId);
  if (messageBatch.processing_status === "ended") {
    break;
  }

  console.log(`Batch ${messageBatchId} is still processing... waiting`);
  await new Promise((resolve) => setTimeout(resolve, 60_000));
}
console.log(messageBatch);
```

```csharp C# nocheck hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages.Batches;

AnthropicClient client = new();
string messageBatchId = Environment.GetEnvironmentVariable("MESSAGE_BATCH_ID");

MessageBatch messageBatch = null;
while (true)
{
    messageBatch = await client.Messages.Batches.Retrieve(messageBatchId);
    if (messageBatch.ProcessingStatus == "ended")
    {
        break;
    }

    Console.WriteLine($"Batch {messageBatchId} is still processing...");
    await Task.Delay(60000);
}
Console.WriteLine(messageBatch);
```

```go Go nocheck hidelines={1..14,-1}
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()
	messageBatchID := os.Getenv("MESSAGE_BATCH_ID")

	var messageBatch *anthropic.MessageBatch
	for {
		var err error
		messageBatch, err = client.Messages.Batches.Get(context.TODO(), messageBatchID)
		if err != nil {
			log.Fatal(err)
		}
		if messageBatch.ProcessingStatus == "ended" {
			break
		}

		fmt.Printf("Batch %s is still processing...\n", messageBatchID)
		time.Sleep(60 * time.Second)
	}
	fmt.Println(messageBatch)
}
```

```java Java nocheck hidelines={1..2,4..6,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.batches.MessageBatch;

public class MessageBatchPolling {
    public static void main(String[] args) throws InterruptedException {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();
        String messageBatchId = "msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d";

        MessageBatch messageBatch = null;
        while (true) {
            messageBatch = client.messages().batches().retrieve(messageBatchId);
            if (messageBatch.processingStatus().equals(MessageBatch.ProcessingStatus.ENDED)) {
                break;
            }

            System.out.println("Batch " + messageBatchId + " is still processing...");
            Thread.sleep(60000);
        }
        System.out.println(messageBatch);
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();
$messageBatchId = getenv("MESSAGE_BATCH_ID");

$messageBatch = null;
while (true) {
    $messageBatch = $client->messages->batches->retrieve(
        messageBatchID: $messageBatchId,
    );
    if ($messageBatch->processingStatus === "ended") {
        break;
    }

    echo "Batch {$messageBatchId} is still processing...\n";
    sleep(60);
}
echo json_encode($messageBatch, JSON_PRETTY_PRINT);
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message_batch_id = ENV["MESSAGE_BATCH_ID"]
message_batch = nil
loop do
  message_batch = client.messages.batches.retrieve(message_batch_id)
  break if message_batch.processing_status == :ended

  puts "Batch #{message_batch_id} is still processing..."
  sleep 60
end
puts message_batch
```

</CodeGroup>

### 列出所有 Message Batches \{#listing-all-message-batches}

您可以使用[列表端点](/docs/zh-CN/api/listing-message-batches)列出 Workspace 中的所有 Message Batches。该 API 支持分页，会根据需要自动获取更多页面：

<CodeGroup>
```bash cURL
#!/bin/sh

if ! command -v jq &> /dev/null; then
    echo "Error: This script requires jq. Please install it first."
    exit 1
fi

BASE_URL="https://api.anthropic.com/v1/messages/batches"

has_more=true
after_id=""

while [ "$has_more" = true ]; do
    # 如果存在 after_id，则使用它构造 URL
    if [ -n "$after_id" ]; then
        url="${BASE_URL}?limit=20&after_id=${after_id}"
    else
        url="$BASE_URL?limit=20"
    fi

    response=$(curl -s "$url" \
              --header "x-api-key: $ANTHROPIC_API_KEY" \
              --header "anthropic-version: 2023-06-01")

    # 使用 jq 提取值
    has_more=$(echo "$response" | jq -r '.has_more')
    after_id=$(echo "$response" | jq -r '.last_id')

    # 处理并打印 data 数组中的每个条目
    echo "$response" | jq -c '.data[]' | while read -r entry; do
        echo "$entry" | jq '.'
    done
done
```

```bash CLI
# 根据需要自动获取更多页面
ant messages:batches list --limit 20
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

# 根据需要自动获取更多页面。
for message_batch in client.messages.batches.list(limit=20):
    print(message_batch)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// 根据需要自动获取更多页面。
for await (const messageBatch of anthropic.messages.batches.list({
  limit: 20
})) {
  console.log(messageBatch);
}
```

```csharp C# hidelines={1..11,-2..}
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages.Batches;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var parameters = new BatchListParams
        {
            Limit = 20
        };

        // 根据需要自动获取更多页面
        var page = await client.Messages.Batches.List(parameters);
        await foreach (var messageBatch in page.Paginate())
        {
            Console.WriteLine(messageBatch);
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

	// 根据需要自动获取更多页面
	iter := client.Messages.Batches.ListAutoPaging(context.TODO(), anthropic.MessageBatchListParams{
		Limit: anthropic.Int(20),
	})

	for iter.Next() {
		messageBatch := iter.Current()
		fmt.Println(messageBatch)
	}

	if err := iter.Err(); err != nil {
		log.Fatal(err)
	}
}
```

```java Java hidelines={1..2,4..7,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.batches.*;

public class BatchListExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // 根据需要自动获取更多页面
    for (MessageBatch messageBatch : client
      .messages()
      .batches()
      .list(BatchListParams.builder().limit(20).build())
      .autoPager()) {
      System.out.println(messageBatch);
    }
  }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

// 根据需要自动获取更多页面
foreach ($client->messages->batches->list(limit: 20)->pagingEachItem() as $messageBatch) {
    echo $messageBatch->id . "\n";
}
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 根据需要自动获取更多页面
client.messages.batches.list(limit: 20).auto_paging_each do |message_batch|
  puts message_batch
end
```

</CodeGroup>

### 检索批次结果 \{#retrieving-batch-results}

批处理结束后，批次中的每个 Messages 请求都会有一个结果。共有 4 种结果类型：

| 结果类型 | 描述 |
|-------------|-------------|
| `succeeded` | 请求成功。包含消息结果。 |
| `errored`   | 请求遇到错误，未创建消息。可能的错误包括无效请求和内部服务器错误。这些请求不会向您收费。 |
| `canceled`  | 用户在此请求发送到模型之前取消了批次。这些请求不会向您收费。 |
| `expired`   | 批次在此请求发送到模型之前达到了 24 小时过期时间。这些请求不会向您收费。 |

您可以通过批次的 `request_counts` 查看结果概览，其中显示了达到这四种状态的请求数量。

批次结果可通过 Message Batch 上的 `results_url` 属性下载，如果组织权限允许，也可在 Console 中下载。由于结果可能很大，建议[流式获取结果](/docs/zh-CN/api/retrieving-message-batch-results)，而不是一次性全部下载。

<CodeGroup>

```bash cURL
#!/bin/sh
curl "https://api.anthropic.com/v1/messages/batches/msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  | grep -o '"results_url":[[:space:]]*"[^"]*"' \
  | cut -d'"' -f4 \
  | while read -r url; do
    curl -s "$url" \
      --header "anthropic-version: 2023-06-01" \
      --header "x-api-key: $ANTHROPIC_API_KEY" \
      | sed 's/}{/}\n{/g' \
      | while IFS= read -r line
    do
      result_type=$(echo "$line" | sed -n 's/.*"result":[[:space:]]*{[[:space:]]*"type":[[:space:]]*"\([^"]*\)".*/\1/p')
      custom_id=$(echo "$line" | sed -n 's/.*"custom_id":[[:space:]]*"\([^"]*\)".*/\1/p')
      error_type=$(echo "$line" | sed -n 's/.*"error":[[:space:]]*{[[:space:]]*"type":[[:space:]]*"\([^"]*\)".*/\1/p')

      case "$result_type" in
        "succeeded")
          echo "Success! $custom_id"
          ;;
        "errored")
          if [ "$error_type" = "invalid_request_error" ]; then
            # 必须先修正请求体，然后才能重新发送请求
            echo "Validation error: $custom_id"
          else
            # 请求可以直接重试
            echo "Server error: $custom_id"
          fi
          ;;
        "expired")
          echo "Expired: $line"
          ;;
      esac
    done
  done

```

```bash CLI nocheck
ant messages:batches results \
  --message-batch-id msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d \
  --transform '{custom_id,"type":result.type,"error":result.error.error.type}' \
  --format jsonl \
  | while IFS= read -r line; do
    custom_id=${line#*'"custom_id":"'}; custom_id=${custom_id%%'"'*}
    case "$line" in
      *'"type":"succeeded"'*)
        printf 'Success! %s\n' "$custom_id" ;;
      *'"type":"errored"'*)
        case "$line" in
          *'"error":"invalid_request_error"'*)
            printf 'Validation error %s\n' "$custom_id" ;;
          *)
            printf 'Server error %s\n' "$custom_id" ;;
        esac ;;
      *'"type":"expired"'*)
        printf 'Request expired %s\n' "$custom_id" ;;
    esac
  done
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

# 以内存高效的分块方式流式传输结果文件，逐个处理
for result in client.messages.batches.results(
    "msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d",
):
    match result.result.type:
        case "succeeded":
            print(f"Success! {result.custom_id}")
        case "errored":
            if result.result.error.error.type == "invalid_request_error":
                # 重新发送请求前必须先修正请求体
                print(f"Validation error {result.custom_id}")
            else:
                # 请求可直接重试
                print(f"Server error {result.custom_id}")
        case "expired":
            print(f"Request expired {result.custom_id}")
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// 以内存高效的分块方式流式传输结果文件，逐个处理
for await (const result of await anthropic.messages.batches.results(
  "msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d"
)) {
  switch (result.result.type) {
    case "succeeded":
      console.log(`Success! ${result.custom_id}`);
      break;
    case "errored":
      if (result.result.error.type === "invalid_request_error") {
        // 重新发送请求前必须修正请求体
        console.log(`Validation error: ${result.custom_id}`);
      } else {
        // 请求可直接重试
        console.log(`Server error: ${result.custom_id}`);
      }
      break;
    case "expired":
      console.log(`Request expired: ${result.custom_id}`);
      break;
  }
}
```

```csharp C# nocheck hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages.Batches;

AnthropicClient client = new();

await foreach (var result in client.Messages.Batches.ResultsStreaming("msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d"))
{
    switch (result.Result.Type)
    {
        case "succeeded":
            Console.WriteLine($"Success! {result.CustomID}");
            break;
        case "errored":
            if (result.Result.Error?.Type == "invalid_request")
            {
                Console.WriteLine($"Validation error: {result.CustomID}");
            }
            else
            {
                Console.WriteLine($"Server error: {result.CustomID}");
            }
            break;
        case "expired":
            Console.WriteLine($"Request expired: {result.CustomID}");
            break;
    }
}
```

```go Go nocheck hidelines={1..11,-1}
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	stream := client.Messages.Batches.ResultsStreaming(context.TODO(), "msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d")

	for stream.Next() {
		result := stream.Current()

		switch variant := result.Result.AsAny().(type) {
		case anthropic.MessageBatchSucceededResult:
			fmt.Printf("Success! %s\n", result.CustomID)
		case anthropic.MessageBatchErroredResult:
			fmt.Printf("Error: %s - %s\n", result.CustomID, variant.Error.Error.Message)
		case anthropic.MessageBatchExpiredResult:
			fmt.Printf("Request expired: %s\n", result.CustomID)
		}
	}

	if err := stream.Err(); err != nil {
		log.Fatal(err)
	}
}
```

```java Java nocheck hidelines={1..2,6..9,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.http.StreamResponse;
import com.anthropic.models.messages.batches.BatchResultsParams;
import com.anthropic.models.messages.batches.MessageBatchIndividualResponse;

public class BatchResultsExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // 以内存高效的分块方式流式传输结果文件，逐个处理
    try (
      StreamResponse<MessageBatchIndividualResponse> streamResponse = client
        .messages()
        .batches()
        .resultsStreaming(
          BatchResultsParams.builder()
            .messageBatchId("msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d")
            .build()
        )
    ) {
      streamResponse
        .stream()
        .forEach(result -> {
          if (result.result().isSucceeded()) {
            System.out.println("Success! " + result.customId());
          } else if (result.result().isErrored()) {
            if (result.result().asErrored().error().error().isInvalidRequestError()) {
              // 重新发送请求前必须修正请求体
              System.out.println("Validation error: " + result.customId());
            } else {
              // 请求可直接重试
              System.out.println("Server error: " + result.customId());
            }
          } else if (result.result().isExpired()) {
            System.out.println("Request expired: " + result.customId());
          }
        });
    }
  }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

foreach ($client->messages->batches->resultsStream(messageBatchID: 'msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d') as $result) {
    switch ($result->result->type) {
        case "succeeded":
            echo "Success! {$result->customID}\n";
            break;
        case "errored":
            if ($result->result->error->error->type === "invalid_request_error") {
                echo "Validation error: {$result->customID}\n";
            } else {
                echo "Server error: {$result->customID}\n";
            }
            break;
        case "expired":
            echo "Request expired: {$result->customID}\n";
            break;
    }
}
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

client.messages.batches.results_streaming("msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d").each do |result|
  case result.result.type
  when :succeeded
    puts "Success! #{result.custom_id}"
  when :errored
    if result.result.error.type == :invalid_request
      puts "Validation error: #{result.custom_id}"
    else
      puts "Server error: #{result.custom_id}"
    end
  when :expired
    puts "Request expired: #{result.custom_id}"
  end
end
```

</CodeGroup>

结果采用 `.jsonl` 格式，其中每一行都是一个有效的 JSON 对象，代表 Message Batch 中单个请求的结果。对于每个流式返回的结果，您可以根据其 `custom_id` 和结果类型执行不同的操作。以下是一组结果示例：

```jsonl .jsonl file
{"custom_id":"my-second-request","result":{"type":"succeeded","message":{"id":"msg_014VwiXbi91y3JMjcpyGBHX5","type":"message","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"Hello again! It's nice to see you. How can I assist you today? Is there anything specific you'd like to chat about or any questions you have?"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":11,"output_tokens":36}}}}
{"custom_id":"my-first-request","result":{"type":"succeeded","message":{"id":"msg_01FqfsLoHwgeFbguDgpz48m7","type":"message","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"Hello! How can I assist you today? Feel free to ask me any questions or let me know if there's anything you'd like to chat about."}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":34}}}}
```

如果您的结果包含错误，其 `result.error` 将被设置为标准的[错误结构](/docs/zh-CN/api/errors#error-shapes)。

<Tip>
  **批次结果可能与输入顺序不匹配**

批次结果可以以任何顺序返回，可能与创建批次时的请求顺序不匹配。在上面的示例中，第二个批处理请求的结果在第一个之前返回。要正确地将结果与其对应的请求匹配，请始终使用 `custom_id` 字段。
</Tip>

### 取消 Message Batch \{#canceling-a-message-batch}

您可以使用[取消端点](/docs/zh-CN/api/canceling-message-batches)取消当前正在处理的 Message Batch。取消后，批次的 `processing_status` 将立即变为 `canceling`。您可以使用上述相同的轮询技术等待取消操作最终完成。已取消的批次最终状态为 `ended`，并且可能包含在取消之前已处理的请求的部分结果。

<CodeGroup>
```bash cURL hidelines={2..15}
#!/bin/sh
MESSAGE_BATCH_ID=$(curl -s https://api.anthropic.com/v1/messages/batches \
  --header "x-api-key: $ANTHROPIC_API_KEY" \
  --header "anthropic-version: 2023-06-01" \
  --header "content-type: application/json" \
  --data '{
    "requests": [{
      "custom_id": "test-1",
      "params": {
        "model": "claude-opus-4-8",
        "max_tokens": 100,
        "messages": [{"role": "user", "content": "Hi"}]
      }
    }]
  }' | jq -r '.id')
curl --request POST https://api.anthropic.com/v1/messages/batches/$MESSAGE_BATCH_ID/cancel \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "anthropic-version: 2023-06-01"
```

```bash CLI hidelines={2..13}
#!/bin/bash
MESSAGE_BATCH_ID=$(ant messages:batches create \
  --transform id --raw-output <<'YAML'
requests:
  - custom_id: test-1
    params:
      model: claude-opus-4-8
      max_tokens: 100
      messages:
        - role: user
          content: Hi
YAML
)
ant messages:batches cancel --message-batch-id "$MESSAGE_BATCH_ID"
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

MESSAGE_BATCH_ID = "msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d"

message_batch = client.messages.batches.cancel(
    MESSAGE_BATCH_ID,
)
print(message_batch)
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const messageBatch = await anthropic.messages.batches.cancel(MESSAGE_BATCH_ID);
console.log(messageBatch);
```

```csharp C# nocheck hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages.Batches;

AnthropicClient client = new();
string messageBatchId = Environment.GetEnvironmentVariable("MESSAGE_BATCH_ID");

var messageBatch = await client.Messages.Batches.Cancel(messageBatchId);
Console.WriteLine(messageBatch);
```

```go Go nocheck hidelines={1..12,-1}
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()
	messageBatchID := os.Getenv("MESSAGE_BATCH_ID")

	messageBatch, err := client.Messages.Batches.Cancel(context.TODO(), messageBatchID)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(messageBatch)
}
```

```java Java nocheck hidelines={1..2,4..7,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.batches.*;

public class BatchCancelExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageBatch messageBatch = client
      .messages()
      .batches()
      .cancel("msgbatch_01HkcTjaV5uDC8jWR4ZsDV8d");
    System.out.println(messageBatch);
  }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

$messageBatch = $client->messages->batches->cancel(
    messageBatchID: 'msgbatch_example_id',
);
echo $messageBatch;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message_batch_id = ENV.fetch("MESSAGE_BATCH_ID")
message_batch = client.messages.batches.cancel(message_batch_id)
puts message_batch
```

</CodeGroup>

响应将显示批次处于 `canceling` 状态：

```json Output
{
  "id": "msgbatch_013Zva2CMHLNnXjNJJKqJ2EF",
  "type": "message_batch",
  "processing_status": "canceling",
  "request_counts": {
    "processing": 2,
    "succeeded": 0,
    "errored": 0,
    "canceled": 0,
    "expired": 0
  },
  "ended_at": null,
  "created_at": "2024-09-24T18:37:24.100435Z",
  "expires_at": "2024-09-25T18:37:24.100435Z",
  "cancel_initiated_at": "2024-09-24T18:39:03.114875Z",
  "results_url": null
}
```

### 在 Message Batches 中使用提示缓存 \{#using-prompt-caching-with-message-batches}

Message Batches API 支持提示缓存，这可能有助于降低批处理请求的成本和处理时间。提示缓存和 Message Batches 的价格折扣可以叠加，当同时使用这两个功能时可以节省更多成本。但是，由于批处理请求是异步并发处理的，缓存命中是尽力而为提供的。根据流量模式的不同，用户通常会体验到 30% 到 98% 的缓存命中率。

要最大限度地提高批处理请求中的缓存命中可能性：

1. 在批次中的每个 Message 请求中包含相同的 `cache_control` 块
2. 保持稳定的请求流，以防止缓存条目在其 5 分钟生命周期后过期
3. 构建您的请求以尽可能多地共享缓存内容

在批次中实现提示缓存的示例：

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages/batches \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "content-type: application/json" \
     --data \
'{
    "requests": [
        {
            "custom_id": "my-first-request",
            "params": {
                "model": "claude-opus-4-8",
                "max_tokens": 1024,
                "system": [
                    {
                        "type": "text",
                        "text": "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n"
                    },
                    {
                        "type": "text",
                        "text": "<the entire contents of Pride and Prejudice>",
                        "cache_control": {"type": "ephemeral"}
                    }
                ],
                "messages": [
                    {"role": "user", "content": "Analyze the major themes in Pride and Prejudice."}
                ]
            }
        },
        {
            "custom_id": "my-second-request",
            "params": {
                "model": "claude-opus-4-8",
                "max_tokens": 1024,
                "system": [
                    {
                        "type": "text",
                        "text": "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n"
                    },
                    {
                        "type": "text",
                        "text": "<the entire contents of Pride and Prejudice>",
                        "cache_control": {"type": "ephemeral"}
                    }
                ],
                "messages": [
                    {"role": "user", "content": "Write a summary of Pride and Prejudice."}
                ]
            }
        }
    ]
}'
```

```bash CLI
ant messages:batches create <<'YAML'
requests:
  - custom_id: my-first-request
    params:
      model: claude-opus-4-8
      max_tokens: 1024
      system:
        - type: text
          text: >
            You are an AI assistant tasked with analyzing literary works. Your
            goal is to provide insightful commentary on themes, characters, and
            writing style.
        - type: text
          text: "<the entire contents of Pride and Prejudice>"
          cache_control:
            type: ephemeral
      messages:
        - role: user
          content: Analyze the major themes in Pride and Prejudice.
  - custom_id: my-second-request
    params:
      model: claude-opus-4-8
      max_tokens: 1024
      system:
        - type: text
          text: >
            You are an AI assistant tasked with analyzing literary works. Your
            goal is to provide insightful commentary on themes, characters, and
            writing style.
        - type: text
          text: "<the entire contents of Pride and Prejudice>"
          cache_control:
            type: ephemeral
      messages:
        - role: user
          content: Write a summary of Pride and Prejudice.
YAML
```

```python Python hidelines={1}
import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request

client = anthropic.Anthropic()

message_batch = client.messages.batches.create(
    requests=[
        Request(
            custom_id="my-first-request",
            params=MessageCreateParamsNonStreaming(
                model="claude-opus-4-8",
                max_tokens=1024,
                system=[
                    {
                        "type": "text",
                        "text": "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n",
                    },
                    {
                        "type": "text",
                        "text": "<the entire contents of Pride and Prejudice>",
                        "cache_control": {"type": "ephemeral"},
                    },
                ],
                messages=[
                    {
                        "role": "user",
                        "content": "Analyze the major themes in Pride and Prejudice.",
                    }
                ],
            ),
        ),
        Request(
            custom_id="my-second-request",
            params=MessageCreateParamsNonStreaming(
                model="claude-opus-4-8",
                max_tokens=1024,
                system=[
                    {
                        "type": "text",
                        "text": "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n",
                    },
                    {
                        "type": "text",
                        "text": "<the entire contents of Pride and Prejudice>",
                        "cache_control": {"type": "ephemeral"},
                    },
                ],
                messages=[
                    {
                        "role": "user",
                        "content": "Write a summary of Pride and Prejudice.",
                    }
                ],
            ),
        ),
    ]
)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const messageBatch = await anthropic.messages.batches.create({
  requests: [
    {
      custom_id: "my-first-request",
      params: {
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n"
          },
          {
            type: "text",
            text: "<the entire contents of Pride and Prejudice>",
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [
          { role: "user", content: "Analyze the major themes in Pride and Prejudice." }
        ]
      }
    },
    {
      custom_id: "my-second-request",
      params: {
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n"
          },
          {
            type: "text",
            text: "<the entire contents of Pride and Prejudice>",
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [{ role: "user", content: "Write a summary of Pride and Prejudice." }]
      }
    }
  ]
});
```

```csharp C#
using Anthropic;
using Anthropic.Models.Messages;
using Anthropic.Models.Messages.Batches;

AnthropicClient client = new()
{
    ApiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY")
};

var messageBatch = await client.Messages.Batches.Create(new BatchCreateParams
{
    Requests =
    [
        new()
        {
            CustomID = "my-first-request",
            Params = new()
            {
                Model = Model.ClaudeOpus4_8,
                MaxTokens = 1024,
                System = new List<TextBlockParam>
                {
                    new()
                    {
                        Text = "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n"
                    },
                    new()
                    {
                        Text = "<the entire contents of Pride and Prejudice>",
                        CacheControl = new()
                    }
                },
                Messages =
                [
                    new() { Role = Role.User, Content = "Analyze the major themes in Pride and Prejudice." }
                ]
            }
        },
        new()
        {
            CustomID = "my-second-request",
            Params = new()
            {
                Model = Model.ClaudeOpus4_8,
                MaxTokens = 1024,
                System = new List<TextBlockParam>
                {
                    new()
                    {
                        Text = "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n"
                    },
                    new()
                    {
                        Text = "<the entire contents of Pride and Prejudice>",
                        CacheControl = new()
                    }
                },
                Messages =
                [
                    new() { Role = Role.User, Content = "Write a summary of Pride and Prejudice." }
                ]
            }
        }
    ]
});
```

```go Go hidelines={1..10,-1}
package main

import (
	"context"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	messageBatch, err := client.Messages.Batches.New(context.TODO(), anthropic.MessageBatchNewParams{
		Requests: []anthropic.MessageBatchNewParamsRequest{
			{
				CustomID: "my-first-request",
				Params: anthropic.MessageBatchNewParamsRequestParams{
					Model:     anthropic.ModelClaudeOpus4_8,
					MaxTokens: 1024,
					System: []anthropic.TextBlockParam{
						{
							Text: "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n",
						},
						{
							Text:         "<the entire contents of Pride and Prejudice>",
							CacheControl: anthropic.NewCacheControlEphemeralParam(),
						},
					},
					Messages: []anthropic.MessageParam{
						anthropic.NewUserMessage(anthropic.NewTextBlock("Analyze the major themes in Pride and Prejudice.")),
					},
				},
			},
			{
				CustomID: "my-second-request",
				Params: anthropic.MessageBatchNewParamsRequestParams{
					Model:     anthropic.ModelClaudeOpus4_8,
					MaxTokens: 1024,
					System: []anthropic.TextBlockParam{
						{
							Text: "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n",
						},
						{
							Text:         "<the entire contents of Pride and Prejudice>",
							CacheControl: anthropic.NewCacheControlEphemeralParam(),
						},
					},
					Messages: []anthropic.MessageParam{
						anthropic.NewUserMessage(anthropic.NewTextBlock("Write a summary of Pride and Prejudice.")),
					},
				},
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("%+v\n", messageBatch)
}
```

```java Java hidelines={1..2,4..5,7..11,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import com.anthropic.models.messages.batches.*;
import java.util.List;

public class BatchExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    BatchCreateParams createParams = BatchCreateParams.builder()
      .addRequest(
        BatchCreateParams.Request.builder()
          .customId("my-first-request")
          .params(
            BatchCreateParams.Request.Params.builder()
              .model(Model.CLAUDE_OPUS_4_8)
              .maxTokens(1024)
              .systemOfTextBlockParams(
                List.of(
                  TextBlockParam.builder()
                    .text(
                      "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n"
                    )
                    .build(),
                  TextBlockParam.builder()
                    .text("<the entire contents of Pride and Prejudice>")
                    .cacheControl(CacheControlEphemeral.builder().build())
                    .build()
                )
              )
              .addUserMessage("Analyze the major themes in Pride and Prejudice.")
              .build()
          )
          .build()
      )
      .addRequest(
        BatchCreateParams.Request.builder()
          .customId("my-second-request")
          .params(
            BatchCreateParams.Request.Params.builder()
              .model(Model.CLAUDE_OPUS_4_8)
              .maxTokens(1024)
              .systemOfTextBlockParams(
                List.of(
                  TextBlockParam.builder()
                    .text(
                      "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n"
                    )
                    .build(),
                  TextBlockParam.builder()
                    .text("<the entire contents of Pride and Prejudice>")
                    .cacheControl(CacheControlEphemeral.builder().build())
                    .build()
                )
              )
              .addUserMessage("Write a summary of Pride and Prejudice.")
              .build()
          )
          .build()
      )
      .build();

    MessageBatch messageBatch = client.messages().batches().create(createParams);
  }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$messageBatch = $client->messages->batches->create(
    requests: [
        [
            'custom_id' => 'my-first-request',
            'params' => [
                'model' => 'claude-opus-4-8',
                'max_tokens' => 1024,
                'system' => [
                    [
                        'type' => 'text',
                        'text' => 'You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n'
                    ],
                    [
                        'type' => 'text',
                        'text' => '<the entire contents of Pride and Prejudice>',
                        'cache_control' => ['type' => 'ephemeral']
                    ]
                ],
                'messages' => [
                    ['role' => 'user', 'content' => 'Analyze the major themes in Pride and Prejudice.']
                ]
            ]
        ],
        [
            'custom_id' => 'my-second-request',
            'params' => [
                'model' => 'claude-opus-4-8',
                'max_tokens' => 1024,
                'system' => [
                    [
                        'type' => 'text',
                        'text' => 'You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n'
                    ],
                    [
                        'type' => 'text',
                        'text' => '<the entire contents of Pride and Prejudice>',
                        'cache_control' => ['type' => 'ephemeral']
                    ]
                ],
                'messages' => [
                    ['role' => 'user', 'content' => 'Write a summary of Pride and Prejudice.']
                ]
            ]
        ]
    ],
);
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message_batch = client.messages.batches.create(
  requests: [
    {
      custom_id: "my-first-request",
      params: {
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n"
          },
          {
            type: "text",
            text: "<the entire contents of Pride and Prejudice>",
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [
          { role: "user", content: "Analyze the major themes in Pride and Prejudice." }
        ]
      }
    },
    {
      custom_id: "my-second-request",
      params: {
        model: "claude-opus-4-8",
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: "You are an AI assistant tasked with analyzing literary works. Your goal is to provide insightful commentary on themes, characters, and writing style.\n"
          },
          {
            type: "text",
            text: "<the entire contents of Pride and Prejudice>",
            cache_control: { type: "ephemeral" }
          }
        ],
        messages: [
          { role: "user", content: "Write a summary of Pride and Prejudice." }
        ]
      }
    }
  ]
)
```

</CodeGroup>

在此示例中，批次中的两个请求都包含相同的系统消息和标记了 `cache_control` 的《傲慢与偏见》全文，以提高缓存命中的可能性。

### 服务器工具与智能体循环 \{#server-tools-and-the-agentic-loop}

所有[服务器工具](/docs/zh-CN/agents-and-tools/tool-use/server-tools)（网络搜索、网络抓取、代码执行、MCP 连接器、advisor 和工具搜索）均可在批处理请求中使用。批处理工作器运行的服务器端智能体循环与同步 Messages API 相同。

由于无需维持开放连接，批处理循环在返回 `stop_reason: "pause_turn"` 之前，**每轮运行的迭代次数比同步请求更多**。如果批次结果返回 `pause_turn`，则表示该轮次尚未完成；您可以按照 [pause_turn 续接模式](/docs/zh-CN/agents-and-tools/tool-use/server-tools#the-server-side-loop-and-pause-turn)中所示的方式，在后续请求（批处理或同步）中提交暂停的助手内容以继续该轮次。

此外，批处理工作器会按组织对 `web_search` 进行限流，以确保高并发的批处理不会耗尽您组织的网络搜索速率限制。批处理会自动重试被限流的请求；您无需自行处理此问题，但非常大的网络搜索批次可能需要更长时间才能完成。

### 扩展输出（测试版） \{#extended-output-beta}

`output-300k-2026-03-24` 测试版标头可将使用 Claude Opus 4.8、Claude Opus 4.7、Claude Opus 4.6 或 Claude Sonnet 4.6 的批处理请求的 `max_tokens` 上限提高到 300,000。包含此标头即可在单轮中生成远超标准限制（根据模型不同为 64k 到 128k）的输出。

<Note>
扩展输出仅在 Message Batches API 上可用，不适用于同步 Messages API。它在 Claude API 和 AWS 上的 Claude Platform 中受支持，目前在 Amazon Bedrock、Vertex AI 或 Microsoft Foundry 上不可用。
</Note>

扩展输出适用于长篇内容生成，例如书籍长度的草稿和技术文档、详尽的结构化数据提取、大型代码生成脚手架以及长推理链。

单次 300k 令牌的生成可能需要超过一小时才能完成，因此请在规划批次提交时考虑 24 小时的处理窗口。标准批处理定价（标准 API 价格的 50%）适用。

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages/batches \
     --header "x-api-key: $ANTHROPIC_API_KEY" \
     --header "anthropic-version: 2023-06-01" \
     --header "anthropic-beta: output-300k-2026-03-24" \
     --header "content-type: application/json" \
     --data \
'{
    "requests": [
        {
            "custom_id": "long-form-request",
            "params": {
                "model": "claude-opus-4-8",
                "max_tokens": 300000,
                "messages": [
                    {"role": "user", "content": "Write a comprehensive technical guide to building distributed systems, covering architecture patterns, consistency models, fault tolerance, and operational best practices."}
                ]
            }
        }
    ]
}'
```

```bash CLI
ant beta:messages:batches create --beta output-300k-2026-03-24 <<'YAML'
requests:
  - custom_id: long-form-request
    params:
      model: claude-opus-4-8
      max_tokens: 300000
      messages:
        - role: user
          content: >-
            Write a comprehensive technical guide to building distributed
            systems, covering architecture patterns, consistency models,
            fault tolerance, and operational best practices.
YAML
```

```python Python hidelines={1}
import anthropic
from anthropic.types.beta.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.beta.messages.batch_create_params import Request

client = anthropic.Anthropic()

message_batch = client.beta.messages.batches.create(
    betas=["output-300k-2026-03-24"],
    requests=[
        Request(
            custom_id="long-form-request",
            params=MessageCreateParamsNonStreaming(
                model="claude-opus-4-8",
                max_tokens=300_000,
                messages=[
                    {
                        "role": "user",
                        "content": "Write a comprehensive technical guide to building distributed systems, covering architecture patterns, consistency models, fault tolerance, and operational best practices.",
                    }
                ],
            ),
        ),
    ],
)

print(message_batch)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const messageBatch = await anthropic.beta.messages.batches.create({
  betas: ["output-300k-2026-03-24"],
  requests: [
    {
      custom_id: "long-form-request",
      params: {
        model: "claude-opus-4-8",
        max_tokens: 300000,
        messages: [
          {
            role: "user",
            content:
              "Write a comprehensive technical guide to building distributed systems, covering architecture patterns, consistency models, fault tolerance, and operational best practices."
          }
        ]
      }
    }
  ]
});

console.log(messageBatch);
```

```csharp C#
using Anthropic;
using Anthropic.Models.Beta.Messages;
using Anthropic.Models.Beta.Messages.Batches;

AnthropicClient client = new();

var batch = await client.Beta.Messages.Batches.Create(new BatchCreateParams
{
    Betas = ["output-300k-2026-03-24"],
    Requests =
    [
        new()
        {
            CustomID = "long-form-request",
            Params = new()
            {
                Model = "claude-opus-4-8",
                MaxTokens = 300_000,
                Messages =
                [
                    new() { Role = Role.User, Content = "Write a comprehensive technical guide to building distributed systems, covering architecture patterns, consistency models, fault tolerance, and operational best practices." }
                ]
            }
        }
    ]
});

Console.WriteLine(batch);
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

	batch, err := client.Beta.Messages.Batches.New(context.Background(),
		anthropic.BetaMessageBatchNewParams{
			Betas: []anthropic.AnthropicBeta{"output-300k-2026-03-24"},
			Requests: []anthropic.BetaMessageBatchNewParamsRequest{
				{
					CustomID: "long-form-request",
					Params: anthropic.BetaMessageBatchNewParamsRequestParams{
						Model:     anthropic.ModelClaudeOpus4_8,
						MaxTokens: 300_000,
						Messages: []anthropic.BetaMessageParam{
							anthropic.NewBetaUserMessage(
								anthropic.NewBetaTextBlock("Write a comprehensive technical guide to building distributed systems, covering architecture patterns, consistency models, fault tolerance, and operational best practices."),
							),
						},
					},
				},
			},
		})
	if err != nil {
		panic(err)
	}

	fmt.Println(batch.ID)
}
```

```java Java hidelines={1..3,5..6,-1}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Model;
import com.anthropic.models.beta.messages.batches.*;

void main() {
  AnthropicClient client = AnthropicOkHttpClient.fromEnv();

  BatchCreateParams params = BatchCreateParams.builder()
    .addBeta("output-300k-2026-03-24")
    .addRequest(
      BatchCreateParams.Request.builder()
        .customId("long-form-request")
        .params(
          BatchCreateParams.Request.Params.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(300_000L)
            .addUserMessage("Write a comprehensive technical guide to building distributed systems, covering architecture patterns, consistency models, fault tolerance, and operational best practices.")
            .build()
        )
        .build()
    )
    .build();

  BetaMessageBatch messageBatch = client.beta().messages().batches().create(params);

  IO.println(messageBatch);
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$batch = $client->beta->messages->batches->create(
    betas: ['output-300k-2026-03-24'],
    requests: [
        [
            'custom_id' => 'long-form-request',
            'params' => [
                'model' => 'claude-opus-4-8',
                'max_tokens' => 300_000,
                'messages' => [
                    ['role' => 'user', 'content' => 'Write a comprehensive technical guide to building distributed systems, covering architecture patterns, consistency models, fault tolerance, and operational best practices.']
                ]
            ]
        ]
    ],
);

echo $batch->id;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

batch = client.beta.messages.batches.create(
  betas: ["output-300k-2026-03-24"],
  requests: [
    {
      custom_id: "long-form-request",
      params: {
        model: "claude-opus-4-8",
        max_tokens: 300_000,
        messages: [
          { role: "user", content: "Write a comprehensive technical guide to building distributed systems, covering architecture patterns, consistency models, fault tolerance, and operational best practices." }
        ]
      }
    }
  ]
)

puts batch
```

</CodeGroup>

### 有效批处理的最佳实践 \{#best-practices-for-effective-batching}

要充分利用 Batches API：

- 定期监控批处理状态，并为失败的请求实施适当的重试逻辑。
- 使用有意义的 `custom_id` 值，以便轻松将结果与请求匹配，因为顺序无法保证。
- 考虑将非常大的数据集拆分为多个批次，以便更好地管理。
- 使用 Messages API 试运行单个请求结构，以避免验证错误。

### 常见问题排查 \{#troubleshooting-common-issues}

如果遇到意外行为：

- 验证批处理请求的总大小不超过 256 MB。如果请求大小过大，您可能会收到 413 `request_too_large` 错误。
- 检查批次中的所有请求是否都使用了[支持的模型](#supported-models)。
- 确保批次中的每个请求都有唯一的 `custom_id`。
- 确保距批次 `created_at`（而非处理 `ended_at`）时间不超过 29 天。如果超过 29 天，结果将不再可查看。
- 确认批次未被取消。

请注意，批次中一个请求的失败不会影响其他请求的处理。

---
## 批次存储与隐私 \{#batch-storage-and-privacy}

- **Workspace 隔离**：批次在其创建的 Workspace 内隔离。只有与该 Workspace 关联的 API 密钥，或有权在 Console 中查看 Workspace 批次的用户才能访问它们。

- **结果可用性**：批次结果在批次创建后 29 天内可用，为检索和处理提供充足的时间。

---
## 数据保留 \{#data-retention}

批处理会在批次创建后最多存储请求和响应数据 29 天。处理完成后，您可以随时使用 `DELETE /v1/messages/batches/{batch_id}` 端点删除消息批次。要删除正在进行中的批次，请先取消它。异步处理需要在服务器端存储输入和输出，直到批次完成并检索结果。

有关所有功能的 ZDR 资格，请参阅 [API 与数据保留](/docs/zh-CN/manage-claude/api-and-data-retention)。

## 常见问题解答 \{#faq}

  <section title="批次处理需要多长时间？">

    批次处理最多可能需要 24 小时，但许多批次会更快完成。实际处理时间取决于批次的大小、当前需求和您的请求量。批次有可能过期且未在 24 小时内完成。
  
</section>

  <section title="Batches API 是否适用于所有模型？">

    请参阅[上文](#supported-models)了解支持的模型列表。
  
</section>

  <section title="我可以将 Message Batches API 与其他 API 功能一起使用吗？">

    可以，Message Batches API 支持 Messages API 中几乎所有可用的功能，包括大多数测试版功能。少数参数（`stream`、`speed`、`store`、`previous_thread_event_id`、`cache_hint`、`context_hint`、`max_tokens: 0` 和 `research_preview_2026_02`）不受支持。完整列表请参阅[可批处理的内容](#what-can-be-batched)。
  
</section>

  <section title="Message Batches API 如何影响定价？">

    与标准 API 价格相比，Message Batches API 对所有使用量提供 50% 的折扣。这适用于输入令牌、输出令牌和任何特殊令牌。有关定价的更多信息，请访问[定价页面](https://claude.com/pricing#anthropic-api)。
  
</section>

  <section title="提交批次后可以更新吗？">

    不可以，批次一旦提交就无法修改。如果您需要进行更改，应取消当前批次并提交新批次。请注意，取消可能不会立即生效。
  
</section>

  <section title="Message Batches API 是否有速率限制，它们是否与 Messages API 速率限制相互影响？">

    Message Batches API 除了对需要处理的请求数量有限制外，还有基于 HTTP 请求的速率限制。请参阅 [Message Batches API 速率限制](/docs/zh-CN/api/rate-limits#message-batches-api)。使用 Batches API 不会影响 Messages API 中的速率限制。
  
</section>

  <section title="如何处理批处理请求中的错误？">

    当您检索结果时，每个请求都会有一个 `result` 字段，指示其状态为 `succeeded`、`errored`、`canceled` 还是 `expired`。对于 `errored` 结果，将提供额外的错误信息。请在 [API 参考](/docs/zh-CN/api/creating-message-batches)中查看错误响应对象。
  
</section>

  <section title="Message Batches API 如何处理隐私和数据隔离？">

    Message Batches API 在设计上采用了严格的隐私和数据隔离措施：

    1. 批次及其结果在创建它们的 Workspace 内隔离。这意味着只有来自同一 Workspace 的 API 密钥才能访问它们。
    2. 批次中的每个请求都是独立处理的，请求之间不会发生数据泄露。
    3. 结果仅在有限时间内（29 天）可用，并遵循 Anthropic 的[数据保留政策](https://support.claude.com/en/articles/7996866-how-long-do-you-store-personal-data)。
    4. 可以在组织级别或按 Workspace 禁用在 Console 中下载批次结果的功能。
  
</section>

  <section title="我可以在 Message Batches API 中使用提示缓存吗？">

    可以，Message Batches API 支持使用提示缓存。但是，由于异步批处理请求可以并发且以任何顺序处理，缓存命中是尽力而为提供的。
  
</section>