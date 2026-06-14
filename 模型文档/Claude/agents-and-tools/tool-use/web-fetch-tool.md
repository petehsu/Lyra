# 网页抓取工具

从特定 URL 抓取并读取内容，以实时网页内容增强 Claude 的上下文。

---

网页抓取工具（web fetch tool）允许 Claude 从指定的网页和 PDF 文档中检索完整内容。

最新的网页抓取工具版本（`web_fetch_20260209`）在 Claude Fable 5、Claude Opus 4.8、Claude Mythos 5、[Claude Mythos Preview](https://anthropic.com/glasswing)、Claude Opus 4.7、Claude Opus 4.6 和 Claude Sonnet 4.6 上支持**动态过滤**。Claude 可以编写并执行代码，在抓取的内容进入上下文窗口之前对其进行过滤，仅保留相关信息并丢弃其余内容。这在保持响应质量的同时减少了令牌消耗。之前的工具版本（`web_fetch_20250910`）仍然可用，但不支持动态过滤。

<Note>
对于 [Claude Mythos Preview](https://anthropic.com/glasswing)，网页抓取在 Claude API 和 Microsoft Foundry 上可用。目前在 Amazon Bedrock 或 Vertex AI 上不适用于 Mythos Preview。
</Note>

<Note>
请使用[反馈表单](https://forms.gle/NhWcgmkcvPCMmPE86)就模型响应质量、API 本身或文档质量提供反馈。
</Note>

有关零数据保留（Zero Data Retention）资格和 `allowed_callers` 解决方法，请参阅[服务器工具](/docs/zh-CN/agents-and-tools/tool-use/server-tools#zdr-and-allowed-callers)。

<Warning>
在 Claude 同时处理不受信任的输入和敏感数据的环境中启用网页抓取工具会带来数据泄露风险。请仅在受信任的环境中或处理非敏感数据时使用此工具。

为了最大限度地降低数据泄露风险，Claude 不允许动态构造 URL。Claude 只能抓取用户明确提供的 URL，或来自先前网页搜索或网页抓取结果的 URL。但是，使用此工具时仍存在残余风险，应仔细考虑。

如果担心数据泄露，请考虑：
- 完全禁用网页抓取工具
- 使用 `max_uses` 参数限制请求次数
- 使用 `allowed_domains` 参数将访问限制在已知的安全域名范围内
</Warning>

有关模型支持情况，请参阅[工具参考](/docs/zh-CN/agents-and-tools/tool-use/tool-reference)。

## 网页抓取的工作原理 \{#how-web-fetch-works}

当您将网页抓取工具添加到 API 请求中时：

1. Claude 根据提示和可用的 URL 决定何时抓取内容。
2. API 从指定的 URL 检索完整的文本内容。
3. 对于 PDF 文件，会自动执行文本提取。
4. Claude 分析抓取的内容并提供带有可选引用的响应。

<Note>
网页抓取工具目前不支持使用 JavaScript 动态渲染的网站。
</Note>

### Claude 何时进行抓取 \{#when-claude-fetches}

当请求指向特定页面或文档时，Claude 会进行抓取：

- 对话中（或先前的工具结果中）提供了 URL
- 用户指明了特定资源（某篇特定文章、README、定价页面或文档章节）但未提供 URL，并且同时启用了[网页搜索工具](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool)，以便 Claude 可以先定位该资源（请参阅[搜索与抓取结合使用](#combined-search-and-fetch)）

对于不涉及特定页面的常识性或开放式问题，Claude **不会**进行抓取。"总结这篇文章：`<url>`"会触发抓取；而"REST API 设计的最佳实践是什么？"则会直接回答。

### 动态过滤 \{#dynamic-filtering}

抓取完整的网页和 PDF 可能会快速消耗令牌，尤其是当只需要从大型文档中获取特定信息时。使用 `web_fetch_20260209` 工具版本，Claude 可以编写并执行代码，在将抓取的内容加载到上下文之前对其进行过滤。

这种动态过滤特别适用于：
- 从长文档中提取特定章节
- 处理网页中的结构化数据
- 从 PDF 中筛选相关信息
- 在处理大型文档时降低令牌成本

<Note>
动态过滤需要启用[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)。网页抓取工具（无论是否启用动态过滤）在 Claude API、[AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上均可用。目前在 Amazon Bedrock 或 Vertex AI 上不可用。
</Note>

要启用动态过滤，请使用 `web_fetch_20260209` 工具版本：

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
                "content": "Fetch the content at https://example.com/research-paper and extract the key findings."
            }
        ],
        "tools": [{
            "type": "web_fetch_20260209",
            "name": "web_fetch"
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
      Fetch the content at https://example.com/research-paper
      and extract the key findings.
tools:
  - type: web_fetch_20260209
    name: web_fetch
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
            "content": "Fetch the content at https://example.com/research-paper and extract the key findings.",
        }
    ],
    tools=[{"type": "web_fetch_20260209", "name": "web_fetch"}],
)
print(response)
```

```typescript TypeScript hidelines={1..5,-3..-1}
import { Anthropic } from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

async function main() {
  const response = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content:
          "Fetch the content at https://example.com/research-paper and extract the key findings."
      }
    ],
    tools: [{ type: "web_fetch_20260209", name: "web_fetch" }]
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
    MaxTokens = 4096,
    Messages = [new() { Role = Role.User, Content = "Fetch the content at https://example.com/research-paper and extract the key findings." }],
    Tools = [new ToolUnion(new WebFetchTool20260209())]
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
			anthropic.NewUserMessage(anthropic.NewTextBlock("Fetch the content at https://example.com/research-paper and extract the key findings.")),
		},
		Tools: []anthropic.ToolUnionParam{
			{OfWebFetchTool20260209: &anthropic.WebFetchTool20260209Param{}},
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
import com.anthropic.models.messages.WebFetchTool20260209;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(4096L)
        .addUserMessage("Fetch the content at https://example.com/research-paper and extract the key findings.")
        .addTool(WebFetchTool20260209.builder().build())
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
        ['role' => 'user', 'content' => 'Fetch the content at https://example.com/research-paper and extract the key findings.']
    ],
    model: 'claude-opus-4-8',
    tools: [[
        'type' => 'web_fetch_20260209',
        'name' => 'web_fetch',
    ]],
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
    { role: "user", content: "Fetch the content at https://example.com/research-paper and extract the key findings." }
  ],
  tools: [{
    type: "web_fetch_20260209",
    name: "web_fetch"
  }]
)
puts message
```
</CodeGroup>

## 如何使用网页抓取 \{#how-to-use-web-fetch}

在您的 API 请求中提供网页抓取工具：

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
                "content": "Please analyze the content at https://example.com/article"
            }
        ],
        "tools": [{
            "type": "web_fetch_20250910",
            "name": "web_fetch",
            "max_uses": 5
        }]
    }'
```

```bash CLI
ant messages create \
  --model claude-opus-4-8 \
  --max-tokens 1024 \
  --message '{role: user, content: "Please analyze the content at https://example.com/article"}' \
  --tool '{type: web_fetch_20250910, name: web_fetch, max_uses: 5}'
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
            "content": "Please analyze the content at https://example.com/article",
        }
    ],
    tools=[{"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 5}],
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
        content: "Please analyze the content at https://example.com/article"
      }
    ],
    tools: [
      {
        type: "web_fetch_20250910",
        name: "web_fetch",
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
    Messages = [new() { Role = Role.User, Content = "Please analyze the content at https://example.com/article" }],
    Tools = [new ToolUnion(new WebFetchTool20250910() { MaxUses = 5 })]
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
			anthropic.NewUserMessage(anthropic.NewTextBlock("Please analyze the content at https://example.com/article")),
		},
		Tools: []anthropic.ToolUnionParam{
			{OfWebFetchTool20250910: &anthropic.WebFetchTool20250910Param{
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
import com.anthropic.models.messages.WebFetchTool20250910;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(1024L)
        .addUserMessage("Please analyze the content at https://example.com/article")
        .addTool(WebFetchTool20250910.builder()
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
        ['role' => 'user', 'content' => 'Please analyze the content at https://example.com/article']
    ],
    model: 'claude-opus-4-8',
    tools: [[
        'type' => 'web_fetch_20250910',
        'name' => 'web_fetch',
        'max_uses' => 5,
    ]],
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
    { role: "user", content: "Please analyze the content at https://example.com/article" }
  ],
  tools: [{
    type: "web_fetch_20250910",
    name: "web_fetch",
    max_uses: 5
  }]
)
puts message
```
</CodeGroup>

### 工具定义 \{#tool-definition}

网页抓取工具支持以下参数：

```json JSON
{
  "type": "web_fetch_20250910",
  "name": "web_fetch",

  // Optional: Limit the number of fetches per request
  "max_uses": 10,

  // Optional: Only fetch from these domains
  "allowed_domains": ["example.com", "docs.example.com"],

  // Optional: Never fetch from these domains
  "blocked_domains": ["private.example.com"],

  // Optional: Enable citations for fetched content
  "citations": {
    "enabled": true
  },

  // Optional: Maximum content length in tokens
  "max_content_tokens": 100000
}
```

#### 最大使用次数 \{#max-uses}

`max_uses` 参数限制执行网页抓取的次数。如果 Claude 尝试的抓取次数超过允许的次数，`web_fetch_tool_result` 将返回一个带有 `max_uses_exceeded` 错误代码的错误。目前没有默认限制。

#### 域名过滤 \{#domain-filtering}

有关使用 `allowed_domains` 和 `blocked_domains` 进行域名过滤的信息，请参阅[服务器工具](/docs/zh-CN/agents-and-tools/tool-use/server-tools#domain-filtering)。

#### 内容限制 \{#content-limits}

`max_content_tokens` 参数限制包含在上下文中的内容量。如果抓取的内容超过此限制，工具会将其截断。这有助于在抓取大型文档时控制令牌使用量。

<Note>
`max_content_tokens` 参数的限制是近似值。实际使用的输入令牌数量可能会有少量偏差。
</Note>

#### 引用 \{#citations}

与始终启用引用的网页搜索不同，网页抓取的引用是可选的。设置 `"citations": {"enabled": true}` 可使 Claude 能够引用所抓取文档中的特定段落。

<Note>
当直接向最终用户显示 API 输出时，必须包含指向原始来源的引用。如果您对 API 输出进行了修改（包括在向最终用户显示之前对其进行再处理和/或与您自己的材料相结合），请在咨询您的法务团队后酌情显示引用。
</Note>

### 响应 \{#response}

以下是一个响应结构示例：

```json Output
{
  "role": "assistant",
  "content": [
    // 1. Claude's decision to fetch
    {
      "type": "text",
      "text": "I'll fetch the content from the article to analyze it."
    },
    // 2. The fetch request
    {
      "type": "server_tool_use",
      "id": "srvtoolu_01234567890abcdef",
      "name": "web_fetch",
      "input": {
        "url": "https://example.com/article"
      }
    },
    // 3. Fetch results
    {
      "type": "web_fetch_tool_result",
      "tool_use_id": "srvtoolu_01234567890abcdef",
      "content": {
        "type": "web_fetch_result",
        "url": "https://example.com/article",
        "content": {
          "type": "document",
          "source": {
            "type": "text",
            "media_type": "text/plain",
            "data": "Full text content of the article..."
          },
          "title": "Article Title",
          "citations": { "enabled": true }
        },
        "retrieved_at": "2025-08-25T10:30:00Z"
      }
    },
    // 4. Claude's analysis with citations (if enabled)
    {
      "text": "Based on the article, ",
      "type": "text"
    },
    {
      "text": "the main argument presented is that artificial intelligence will transform healthcare",
      "type": "text",
      "citations": [
        {
          "type": "char_location",
          "document_index": 0,
          "document_title": "Article Title",
          "start_char_index": 1234,
          "end_char_index": 1456,
          "cited_text": "Artificial intelligence is poised to revolutionize healthcare delivery..."
        }
      ]
    }
  ],
  "id": "msg_a930390d3a",
  "usage": {
    "input_tokens": 25039,
    "output_tokens": 931,
    "server_tool_use": {
      "web_fetch_requests": 1
    }
  },
  "stop_reason": "end_turn"
}
```

#### 抓取结果 \{#fetch-results}

抓取结果包括：

- `url`：被抓取的 URL
- `content`：包含所抓取内容的文档块
- `retrieved_at`：检索内容时的时间戳

<Note>
网页抓取工具会缓存结果以提高性能并减少冗余请求。返回的内容可能并不总是反映该 URL 上可用的最新版本。缓存行为是自动管理的，并可能随时间变化，以针对不同的内容类型和使用模式进行优化。
</Note>

对于 PDF 文档，内容以 base64 编码的数据形式返回：

```json Output
{
  "type": "web_fetch_tool_result",
  "tool_use_id": "srvtoolu_02",
  "content": {
    "type": "web_fetch_result",
    "url": "https://example.com/paper.pdf",
    "content": {
      "type": "document",
      "source": {
        "type": "base64",
        "media_type": "application/pdf",
        "data": "JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmo..."
      },
      "citations": { "enabled": true }
    },
    "retrieved_at": "2025-08-25T10:30:02Z"
  }
}
```

#### 错误 \{#errors}

当网页抓取工具遇到错误时，Claude API 会返回 200（成功）响应，并在响应正文中表示该错误：

```json Output
{
  "type": "web_fetch_tool_result",
  "tool_use_id": "srvtoolu_a93jad",
  "content": {
    "type": "web_fetch_tool_error",
    "error_code": "url_not_accessible"
  }
}
```

以下是可能的错误代码：

- `invalid_input`：URL 格式无效
- `url_too_long`：URL 超过最大长度（250 个字符）
- `url_not_allowed`：URL 被域名过滤规则和模型限制所阻止
- `url_not_accessible`：无法抓取内容（HTTP 错误）
- `too_many_requests`：超出速率限制
- `unsupported_content_type`：不支持的内容类型（仅支持文本和 PDF）
- `max_uses_exceeded`：超出网页抓取工具的最大使用次数
- `unavailable`：发生内部错误

## URL 验证 \{#url-validation}

出于安全原因，网页抓取工具只能抓取先前已出现在对话上下文中的 URL。这包括：

- 用户消息中的 URL
- 客户端工具结果中的 URL
- 来自先前网页搜索或网页抓取结果的 URL

该工具无法抓取 Claude 生成的任意 URL，也无法抓取来自基于容器的服务器工具（代码执行、Bash 等）的 URL。

## 搜索与抓取结合使用 \{#combined-search-and-fetch}

网页抓取可与网页搜索无缝配合，以实现全面的信息收集：

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": "Find recent articles about quantum computing and analyze the most relevant one in detail",
        }
    ],
    tools=[
        {"type": "web_search_20250305", "name": "web_search", "max_uses": 3},
        {
            "type": "web_fetch_20250910",
            "name": "web_fetch",
            "max_uses": 5,
            "citations": {"enabled": True},
        },
    ],
)
print(response)
```

在此工作流程中，Claude 将：
1. 使用网页搜索查找相关文章
2. 选择最有价值的结果
3. 使用网页抓取检索完整内容
4. 提供带有引用的详细分析

当同时启用网页搜索和网页抓取工具，且用户指明了特定页面或文档但未提供 URL 时（例如，"阅读 anthropics/anthropic-sdk-python 代码库中的 README"），Claude 会使用网页搜索定位该资源，然后抓取结果。

## 提示缓存 \{#prompt-caching}

有关跨轮次缓存工具定义的信息，请参阅[工具使用与提示缓存](/docs/zh-CN/agents-and-tools/tool-use/tool-use-with-prompt-caching)。

## 流式传输 \{#streaming}

启用流式传输后，抓取事件是流的一部分，在内容检索期间会有暂停：

```sse Output
event: message_start
data: {"type": "message_start", "message": {"id": "msg_abc123", "type": "message"}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

// Claude's decision to fetch

event: content_block_start
data: {"type": "content_block_start", "index": 1, "content_block": {"type": "server_tool_use", "id": "srvtoolu_xyz789", "name": "web_fetch"}}

// Fetch URL streamed
event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"url\":\"https://example.com/article\"}"}}

// Pause while fetch executes

// Fetch results streamed
event: content_block_start
data: {"type": "content_block_start", "index": 2, "content_block": {"type": "web_fetch_tool_result", "tool_use_id": "srvtoolu_xyz789", "content": {"type": "web_fetch_result", "url": "https://example.com/article", "content": {"type": "document", "source": {"type": "text", "media_type": "text/plain", "data": "Article content..."}}}}}

// Claude's response continues...
```

## 批量请求 \{#batch-requests}

您可以在 [Messages Batches API](/docs/zh-CN/build-with-claude/batch-processing) 中包含网页抓取工具。通过 Messages Batches API 进行的网页抓取工具调用的定价与常规 Messages API 请求中的定价相同。

## 使用量和定价 \{#usage-and-pricing}

Web fetch（网页抓取）的使用除标准令牌费用外**不产生额外费用**：

```json
{
  "usage": {
    "input_tokens": 25039,
    "output_tokens": 931,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0,
    "server_tool_use": {
      "web_fetch_requests": 1
    }
  }
}
```

Web fetch 工具在 Claude API 上可用，且**无需额外付费**。您只需为成为对话上下文一部分的抓取内容支付标准令牌费用。

为防止意外抓取会消耗过多令牌的大型内容，请使用 `max_content_tokens` 参数，根据您的使用场景和预算考量设置适当的限制。

典型内容的令牌使用量示例：
- 普通网页（10&nbsp;kB）：约 2,500 个令牌
- 大型文档页面（100&nbsp;kB）：约 25,000 个令牌
- 研究论文 PDF（500&nbsp;kB）：约 125,000 个令牌

## 后续步骤 \{#next-steps}

<CardGroup>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/server-tools" title="服务器工具">
    Anthropic 执行的工具的共享机制。
  </Card>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/tool-reference" title="工具参考">
    所有 Anthropic 提供的工具的目录。
  </Card>
</CardGroup>