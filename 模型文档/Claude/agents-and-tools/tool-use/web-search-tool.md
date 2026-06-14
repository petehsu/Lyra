# 网络搜索工具

---

网络搜索工具使 Claude 能够直接访问实时网络内容，从而能够使用超出其知识截止日期的最新信息来回答问题。响应中包含从搜索结果中提取的来源引用。

最新的网络搜索工具版本（`web_search_20260209`）在 Claude Fable 5、Claude Opus 4.8、Claude Mythos 5、[Claude Mythos Preview](https://anthropic.com/glasswing)、Claude Opus 4.7、Claude Opus 4.6 和 Claude Sonnet 4.6 上支持**动态过滤**。Claude 可以编写并执行代码，在搜索结果进入上下文窗口之前对其进行过滤，仅保留相关信息并丢弃其余内容。这可以提高响应的准确性，同时减少令牌消耗。之前的工具版本（`web_search_20250305`）仍然可用，但不支持动态过滤。

<Note>
对于 [Claude Mythos Preview](https://anthropic.com/glasswing)，网络搜索在 Claude API、Microsoft Foundry 和 Vertex AI 上受支持。在 Amazon Bedrock 或 [Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 上，Mythos Preview 不支持网络搜索。
</Note>

有关零数据保留（Zero Data Retention）资格和 `allowed_callers` 解决方法，请参阅[服务器工具](/docs/zh-CN/agents-and-tools/tool-use/server-tools#zdr-and-allowed-callers)。

有关模型支持情况，请参阅[工具参考](/docs/zh-CN/agents-and-tools/tool-use/tool-reference)。

## 网络搜索的工作原理 \{#how-web-search-works}

当您将网络搜索工具添加到 API 请求中时：

1. Claude 根据提示决定何时进行搜索。
2. API 执行搜索并向 Claude 提供结果。在单个请求中，此过程可能会重复多次。
3. 在其回合结束时，Claude 提供带有引用来源的最终响应。

### Claude 何时进行搜索 \{#when-claude-searches}

当请求依赖于当前的、不断变化的或超出其训练数据范围的信息时，Claude 会进行搜索：

- 近期事件、新闻或公告
- 当前价格、汇率、比分或统计数据
- 有关特定组织、人物或产品的可能已发生变化的信息
- 明确要求搜索或查找某些内容的请求

当请求基于稳定的知识时，Claude 会直接回答而不进行搜索：

- 既定事实、数学、科学基础知识或编程概念
- 创意写作或头脑风暴
- 对对话中已提供内容的分析
- 对话性回复和问候

触发行为可以通过您的系统提示进行引导：您可以鼓励 Claude 更积极地搜索，或倾向于直接回答。如需硬性约束，请使用 `max_uses` 来限制每个请求的搜索次数上限。

### 动态过滤 \{#dynamic-filtering}

网络搜索是一项令牌密集型任务。使用基本网络搜索时，Claude 需要将搜索结果拉入上下文，从多个网站获取完整的 HTML，并对所有内容进行推理后才能得出答案。通常，这些内容中有很大一部分是不相关的，这可能会降低响应质量。

使用 `web_search_20260209` 工具版本时，Claude 可以编写并执行代码来对查询结果进行后处理。Claude 不再对完整的 HTML 文件进行推理，而是在将搜索结果加载到上下文之前对其进行动态过滤，仅保留相关内容并丢弃其余部分。

动态过滤在以下场景中特别有效：
- 搜索技术文档
- 文献综述和引用验证
- 技术研究
- 响应依据和验证

<Note>
动态过滤需要启用[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)。网络搜索工具（无论是否启用动态过滤）在 Claude API、[Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上均可用。在 Vertex AI 上，仅基本网络搜索工具（不含动态过滤）可用。网络搜索在 Amazon Bedrock 上不可用。
</Note>

要启用动态过滤，请使用 `web_search_20260209` 工具版本：

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
                "content": "Search for the current prices of AAPL and GOOGL, then calculate which has a better P/E ratio."
            }
        ],
        "tools": [{
            "type": "web_search_20260209",
            "name": "web_search"
        }]
    }'
```

```bash CLI
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
messages:
  - role: user
    content: >-
      Search for the current prices of AAPL and GOOGL, then calculate
      which has a better P/E ratio.
tools:
  - type: web_search_20260209
    name: web_search
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
            "content": "Search for the current prices of AAPL and GOOGL, then calculate which has a better P/E ratio.",
        }
    ],
    tools=[{"type": "web_search_20260209", "name": "web_search"}],
)
print(response)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const response = await anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content:
        "Search for the current prices of AAPL and GOOGL, then calculate which has a better P/E ratio."
    }
  ],
  tools: [{ type: "web_search_20260209", name: "web_search" }]
});

console.log(response);
```

```csharp C# hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 4096,
    Messages = [new() { Role = Role.User, Content = "Search for the current prices of AAPL and GOOGL, then calculate which has a better P/E ratio." }],
    Tools = [new ToolUnion(new WebSearchTool20260209())]
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
		MaxTokens: 4096,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Search for the current prices of AAPL and GOOGL, then calculate which has a better P/E ratio.")),
		},
		Tools: []anthropic.ToolUnionParam{
			{OfWebSearchTool20260209: &anthropic.WebSearchTool20260209Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..5}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.WebSearchTool20260209;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(4096L)
        .addUserMessage("Search for the current prices of AAPL and GOOGL, then calculate which has a better P/E ratio.")
        .addTool(WebSearchTool20260209.builder().build())
        .build();

    Message response = client.messages().create(params);
    IO.println(response);
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => 'Search for the current prices of AAPL and GOOGL, then calculate which has a better P/E ratio.'],
    ],
    model: 'claude-opus-4-8',
    tools: [
        [
            'type' => 'web_search_20260209',
            'name' => 'web_search',
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
    { role: "user", content: "Search for the current prices of AAPL and GOOGL, then calculate which has a better P/E ratio." }
  ],
  tools: [{
    type: "web_search_20260209",
    name: "web_search"
  }]
)
puts message
```
</CodeGroup>

## 如何使用网络搜索 \{#how-to-use-web-search}

<Note>
您组织的管理员必须在 [Claude Console](/settings/privacy) 中启用网络搜索。
</Note>

在您的 API 请求中提供网络搜索工具：

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "anthropic-version: 2023-06-01" \
    --header "content-type: application/json" \
    --data '{
        "model": "claude-opus-4-8",
        "max_tokens": 1024,
        "messages": [
            {
                "role": "user",
                "content": "What is the weather in NYC?"
            }
        ],
        "tools": [{
            "type": "web_search_20250305",
            "name": "web_search",
            "max_uses": 5
        }]
    }'
```

```bash CLI
ant messages create \
  --model claude-opus-4-8 \
  --max-tokens 1024 \
  --message '{role: user, content: What is the weather in NYC?}' \
  --tool '{type: web_search_20250305, name: web_search, max_uses: 5}'
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[{"role": "user", "content": "What's the weather in NYC?"}],
    tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}],
)
print(response)
```

```typescript TypeScript hidelines={1..5,-3..-1}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function main() {
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: "What's the weather in NYC?"
      }
    ],
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5
      }
    ]
  });

  console.log(response);
}

main().catch(console.error);
```

```csharp C# hidelines={1..3}
using Anthropic;
using Anthropic.Models.Messages;

AnthropicClient client = new();

var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Messages = [new() { Role = Role.User, Content = "What's the weather in NYC?" }],
    Tools = [new ToolUnion(new WebSearchTool20250305() { MaxUses = 5 })]
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
			anthropic.NewUserMessage(anthropic.NewTextBlock("What's the weather in NYC?")),
		},
		Tools: []anthropic.ToolUnionParam{
			{OfWebSearchTool20250305: &anthropic.WebSearchTool20250305Param{
				MaxUses: anthropic.Int(5),
			}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..5}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.WebSearchTool20250305;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024L)
        .addUserMessage("What's the weather in NYC?")
        .addTool(WebSearchTool20250305.builder()
            .maxUses(5L)
            .build())
        .build();

    Message response = client.messages().create(params);
    IO.println(response);
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => "What's the weather in NYC?"],
    ],
    model: 'claude-opus-4-8',
    tools: [
        [
            'type' => 'web_search_20250305',
            'name' => 'web_search',
            'max_uses' => 5,
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
  max_tokens: 1024,
  messages: [
    { role: "user", content: "What's the weather in NYC?" }
  ],
  tools: [{
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 5
  }]
)
puts message
```
</CodeGroup>

### 工具定义 \{#tool-definition}

网络搜索工具支持以下参数：

```json JSON
{
  "type": "web_search_20250305",
  "name": "web_search",

  // Optional: Limit the number of searches per request
  "max_uses": 5,

  // Optional: Only include results from these domains
  "allowed_domains": ["example.com", "trusteddomain.org"],

  // Optional: Never include results from these domains
  "blocked_domains": ["untrustedsource.com"],

  // Optional: Localize search results
  "user_location": {
    "type": "approximate",
    "city": "San Francisco",
    "region": "California",
    "country": "US",
    "timezone": "America/Los_Angeles"
  }
}
```

#### 最大使用次数 \{#max-uses}

`max_uses` 参数限制执行的搜索次数。如果 Claude 尝试的搜索次数超过允许的次数，`web_search_tool_result` 将返回带有 `max_uses_exceeded` 错误代码的错误。

简单的事实性查询通常使用 1–3 次搜索；比较性或多实体研究可能使用 10 次或更多。对于延迟敏感的查询，`max_uses: 3` 可以限制成本，同时很少会导致截断。对于研究型智能体，可将 `max_uses` 设置为 15–20 或完全省略。

#### 域名过滤 \{#domain-filtering}

有关使用 `allowed_domains` 和 `blocked_domains` 进行域名过滤的信息，请参阅[服务器工具](/docs/zh-CN/agents-and-tools/tool-use/server-tools#domain-filtering)。

#### 本地化 \{#localization}

`user_location` 参数允许您根据用户的位置对搜索结果进行本地化。

- `type`：位置类型（必须为 `approximate`）
- `city`：城市名称
- `region`：地区或州
- `country`：国家/地区
- `timezone`：[IANA 时区 ID](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)。

### 响应 \{#response}

以下是响应结构示例：

```json Output
{
  "role": "assistant",
  "content": [
    // 1. Claude's decision to search
    {
      "type": "text",
      "text": "I'll search for when Claude Shannon was born."
    },
    // 2. The search query used
    {
      "type": "server_tool_use",
      "id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
      "name": "web_search",
      "input": {
        "query": "claude shannon birth date"
      }
    },
    // 3. Search results
    {
      "type": "web_search_tool_result",
      "tool_use_id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
      "content": [
        {
          "type": "web_search_result",
          "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
          "title": "Claude Shannon - Wikipedia",
          "encrypted_content": "EqgfCioIARgBIiQ3YTAwMjY1Mi1mZjM5LTQ1NGUtODgxNC1kNjNjNTk1ZWI3Y...",
          "page_age": "April 30, 2025"
        }
      ]
    },
    {
      "text": "Based on the search results, ",
      "type": "text"
    },
    // 4. Claude's response with citations
    {
      "text": "Claude Shannon was born on April 30, 1916, in Petoskey, Michigan",
      "type": "text",
      "citations": [
        {
          "type": "web_search_result_location",
          "url": "https://en.wikipedia.org/wiki/Claude_Shannon",
          "title": "Claude Shannon - Wikipedia",
          "encrypted_index": "Eo8BCioIAhgBIiQyYjQ0OWJmZi1lNm..",
          "cited_text": "Claude Elwood Shannon (April 30, 1916 – February 24, 2001) was an American mathematician, electrical engineer, computer scientist, cryptographer and i..."
        }
      ]
    }
  ],
  "id": "msg_a930390d3a",
  "usage": {
    "input_tokens": 6039,
    "output_tokens": 931,
    "server_tool_use": {
      "web_search_requests": 1
    }
  },
  "stop_reason": "end_turn"
}
```

#### 搜索结果 \{#search-results}

搜索结果包括：

- `url`：来源页面的 URL
- `title`：来源页面的标题
- `page_age`：网站最后更新的时间
- `encrypted_content`：加密内容，在多轮对话中必须回传以用于引用

#### 引用 \{#citations}

网络搜索始终启用引用功能，每个 `web_search_result_location` 包括：

- `url`：被引用来源的 URL
- `title`：被引用来源的标题
- `encrypted_index`：在多轮对话中必须回传的引用标识。
- `cited_text`：最多 150 个字符的被引用内容

网络搜索引用字段 `cited_text`、`title` 和 `url` 不计入输入或输出令牌使用量。

<Note>
  当直接向最终用户显示 API 输出时，必须包含指向原始来源的引用。如果您对 API 输出进行了修改，包括在向最终用户显示之前对其进行再处理和/或与您自己的材料相结合，请在咨询您的法律团队后酌情显示引用。
</Note>

#### 错误 \{#errors}

当网络搜索工具遇到错误（例如达到速率限制）时，Claude API 仍会返回 200（成功）响应。错误会使用以下结构在响应正文中表示：

```json Output
{
  "type": "web_search_tool_result",
  "tool_use_id": "srvtoolu_a93jad",
  "content": {
    "type": "web_search_tool_result_error",
    "error_code": "max_uses_exceeded"
  }
}
```

以下是可能的错误代码：

- `too_many_requests`：超出速率限制
- `invalid_input`：搜索查询参数无效
- `max_uses_exceeded`：超出网络搜索工具的最大使用次数
- `query_too_long`：查询超出最大长度
- `unavailable`：发生内部错误

#### `pause_turn` 停止原因 \{#pause-turn-stop-reason}

有关在 `pause_turn` 停止原因后继续执行的信息，请参阅[服务器工具](/docs/zh-CN/agents-and-tools/tool-use/server-tools#the-server-side-loop-and-pause-turn)。

## 提示缓存 \{#prompt-caching}

有关跨回合缓存工具定义的信息，请参阅[工具使用与提示缓存](/docs/zh-CN/agents-and-tools/tool-use/tool-use-with-prompt-caching)。

## 流式传输 \{#streaming}

启用流式传输后，您将在流中接收搜索事件。在搜索执行期间会有一段暂停：

```sse Output
event: message_start
data: {"type": "message_start", "message": {"id": "msg_abc123", "type": "message"}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

// Claude's decision to search

event: content_block_start
data: {"type": "content_block_start", "index": 1, "content_block": {"type": "server_tool_use", "id": "srvtoolu_xyz789", "name": "web_search"}}

// Search query streamed
event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"query\":\"latest quantum computing breakthroughs 2025\"}"}}

// Pause while search executes

// Search results streamed
event: content_block_start
data: {"type": "content_block_start", "index": 2, "content_block": {"type": "web_search_tool_result", "tool_use_id": "srvtoolu_xyz789", "content": [{"type": "web_search_result", "title": "Quantum Computing Breakthroughs in 2025", "url": "https://example.com"}]}}

// Claude's response with citations (omitted in this example)
```

## 批量请求 \{#batch-requests}

您可以在 [Messages Batches API](/docs/zh-CN/build-with-claude/batch-processing) 中包含网络搜索工具。通过 Messages Batches API 进行的网络搜索工具调用与常规 Messages API 请求的定价相同。

为了保护共享容量，Batches API 会按组织对网络搜索请求进行限流，因此包含大量搜索的大型批次可能需要更长时间才能完成。您可以在 Claude Console 的[限制](/settings/limits)页面上查看您组织的网络搜索速率限制；如需申请更高的限制，请从该页面联系销售团队。典型的批量网络搜索工作负载包括：使用当前网络数据丰富记录、研究大量实体列表，以及根据实时来源对内容语料库进行依据验证或核查。

## 使用量和定价 \{#usage-and-pricing}

网络搜索的使用费用在令牌使用费用之外单独收取：

```json
{
  "usage": {
    "input_tokens": 105,
    "output_tokens": 6039,
    "cache_read_input_tokens": 7123,
    "cache_creation_input_tokens": 7345,
    "server_tool_use": {
      "web_search_requests": 1
    }
  }
}
```

网络搜索在 Claude API 上的价格为**每 1,000 次搜索 10 美元**，另加搜索生成内容的标准令牌费用。在整个对话过程中检索到的网络搜索结果均计为输入令牌，包括单轮对话中执行的搜索迭代以及后续对话轮次中的结果。

每次网络搜索计为一次使用，无论返回多少条结果。如果在网络搜索过程中发生错误，该次网络搜索将不会计费。

## 后续步骤 \{#next-steps}

<CardGroup>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/server-tools" title="服务器工具">
    Anthropic 执行的工具的共享机制。
  </Card>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/tool-reference" title="工具参考">
    所有 Anthropic 提供的工具的目录。
  </Card>
</CardGroup>