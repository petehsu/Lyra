# 搜索结果

通过提供带有来源归属的搜索结果，为 RAG 应用程序启用自然引用

---

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

搜索结果内容块可实现带有正确来源归属的自然引用，将网络搜索级别的引用质量带入您的自定义应用程序。此功能对于 "RAG"（Retrieval-Augmented Generation，检索增强生成）应用程序尤为强大，在这类应用中您需要 Claude 准确地引用来源。

搜索结果功能在以下模型上可用：

- Claude Opus 4.8（claude-opus-4-8）
- Claude Opus 4.7（`claude-opus-4-7`）
- Claude Opus 4.6（`claude-opus-4-6`）
- Claude Sonnet 4.6（`claude-sonnet-4-6`）
- Claude Sonnet 4.5（`claude-sonnet-4-5-20250929`）
- Claude Opus 4.5（`claude-opus-4-5-20251101`）
- Claude Opus 4.1（[已弃用](/docs/zh-CN/about-claude/model-deprecations)）（`claude-opus-4-1-20250805`）
- Claude Opus 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)）（`claude-opus-4-20250514`）
- Claude Sonnet 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)）（`claude-sonnet-4-20250514`）
- Claude Haiku 4.5（`claude-haiku-4-5-20251001`）
- Claude Haiku 3.5（[已停用，Bedrock 和 Vertex AI 除外](/docs/zh-CN/about-claude/model-deprecations)）（`claude-3-5-haiku-20241022`）

## 主要优势 \{#key-benefits}

- **自然引用：**为任何内容实现与网络搜索相同的引用质量
- **灵活集成：**可在工具返回中用于动态 RAG，或作为顶层内容用于预取数据
- **正确的来源归属：**每个结果都包含来源和标题信息，以便清晰归属
- **无需文档变通方案：**消除了对基于文档的变通方案的需求
- **一致的引用格式：**与 Claude 网络搜索功能的引用质量和格式相匹配

## 工作原理 \{#how-it-works}

搜索结果可以通过两种方式提供：

1. **来自工具调用：**您的自定义工具返回搜索结果，从而实现动态 RAG 应用程序
2. **作为顶层内容：**您直接在用户消息中提供搜索结果，用于预取或缓存的内容

在这两种情况下，Claude 都可以自动引用搜索结果中的信息，并附带正确的来源归属。

### 搜索结果架构 \{#search-result-schema}

搜索结果使用以下结构：

```json
{
  "type": "search_result",
  "source": "https://example.com/article", // Required: Source URL or identifier
  "title": "Article Title", // Required: Title of the result
  "content": [
    // Required: Array of text blocks
    {
      "type": "text",
      "text": "The actual content of the search result..."
    }
  ],
  "citations": {
    // Optional: Citation configuration
    "enabled": true // Enable/disable citations for this result
  }
}
```

### 必填字段 \{#required-fields}

| 字段 | 类型 | 描述 |
|-------|------|-------------|
| `type` | string | 必须为 `"search_result"` |
| `source` | string | 内容的来源 URL 或标识符 |
| `title` | string | 搜索结果的描述性标题 |
| `content` | array | 包含实际内容的文本块数组 |

### 可选字段 \{#optional-fields}

| 字段 | 类型 | 描述 |
|-------|------|-------------|
| `citations` | object | 引用配置，包含 `enabled` 布尔字段 |
| `cache_control` | object | 缓存控制设置（例如 `{"type": "ephemeral"}`） |

`content` 数组中的每一项都必须是具有以下属性的文本块：
- `type`：必须为 `"text"`
- `text`：实际的文本内容（非空字符串）

## 方法 1：来自工具调用的搜索结果 \{#method-1-search-results-from-tool-calls}

最强大的用例是从您的自定义工具返回搜索结果。这可以实现动态 RAG 应用程序，其中工具获取并返回相关内容，并自动生成引用。

### 示例：知识库工具 \{#example-knowledge-base-tool}

<CodeGroup>

```python Python nocheck hidelines={1}
from anthropic import Anthropic
from anthropic.types import (
    MessageParam,
    TextBlockParam,
    SearchResultBlockParam,
    ToolResultBlockParam,
)

client = Anthropic()

# 定义一个知识库搜索工具
knowledge_base_tool = {
    "name": "search_knowledge_base",
    "description": "Search the company knowledge base for information",
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "string", "description": "The search query"}},
        "required": ["query"],
    },
}


# 用于处理工具调用的函数
def search_knowledge_base(query):
    # 在此处编写您的搜索逻辑
    # 以正确的格式返回搜索结果
    return [
        SearchResultBlockParam(
            type="search_result",
            source="https://docs.company.com/product-guide",
            title="Product Configuration Guide",
            content=[
                TextBlockParam(
                    type="text",
                    text="To configure the product, navigate to Settings > Configuration. The default timeout is 30 seconds, but can be adjusted between 10-120 seconds based on your needs.",
                )
            ],
            citations={"enabled": True},
        ),
        SearchResultBlockParam(
            type="search_result",
            source="https://docs.company.com/troubleshooting",
            title="Troubleshooting Guide",
            content=[
                TextBlockParam(
                    type="text",
                    text="If you encounter timeout errors, first check the configuration settings. Common causes include network latency and incorrect timeout values.",
                )
            ],
            citations={"enabled": True},
        ),
    ]


# 创建带有该工具的消息
response = client.messages.create(
    model="claude-opus-4-8",  # Works with all supported models
    max_tokens=1024,
    tools=[knowledge_base_tool],
    messages=[
        MessageParam(role="user", content="How do I configure the timeout settings?")
    ],
)

# 当 Claude 调用该工具时，提供搜索结果
if response.content[0].type == "tool_use":
    tool_result = search_knowledge_base(response.content[0].input["query"])

    # 将工具结果发送回去
    final_response = client.messages.create(
        model="claude-opus-4-8",  # Works with all supported models
        max_tokens=1024,
        messages=[
            MessageParam(
                role="user", content="How do I configure the timeout settings?"
            ),
            MessageParam(role="assistant", content=response.content),
            MessageParam(
                role="user",
                content=[
                    ToolResultBlockParam(
                        type="tool_result",
                        tool_use_id=response.content[0].id,
                        content=tool_result,  # Search results go here
                    )
                ],
            ),
        ],
    )
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// 定义一个知识库搜索工具
const knowledgeBaseTool: Anthropic.Messages.Tool = {
  name: "search_knowledge_base",
  description: "Search the company knowledge base for information",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The search query"
      }
    },
    required: ["query"]
  }
};

// 用于处理工具调用的函数
function searchKnowledgeBase(query: string) {
  // 您的搜索逻辑在此处
  // 以正确的格式返回搜索结果
  return [
    {
      type: "search_result" as const,
      source: "https://docs.company.com/product-guide",
      title: "Product Configuration Guide",
      content: [
        {
          type: "text" as const,
          text: "To configure the product, navigate to Settings > Configuration. The default timeout is 30 seconds, but can be adjusted between 10-120 seconds based on your needs."
        }
      ],
      citations: { enabled: true }
    },
    {
      type: "search_result" as const,
      source: "https://docs.company.com/troubleshooting",
      title: "Troubleshooting Guide",
      content: [
        {
          type: "text" as const,
          text: "If you encounter timeout errors, first check the configuration settings. Common causes include network latency and incorrect timeout values."
        }
      ],
      citations: { enabled: true }
    }
  ];
}

// 使用该工具创建一条消息
const response = await anthropic.messages.create({
  model: "claude-opus-4-8", // Works with all supported models
  max_tokens: 1024,
  tools: [knowledgeBaseTool],
  messages: [
    {
      role: "user",
      content: "How do I configure the timeout settings?"
    }
  ]
});

// 处理工具使用并提供结果
if (response.content[0].type === "tool_use") {
  const input = response.content[0].input as { query: string };
  const toolResult = searchKnowledgeBase(input.query);

  const finalResponse = await anthropic.messages.create({
    model: "claude-opus-4-8", // Works with all supported models
    max_tokens: 1024,
    messages: [
      { role: "user", content: "How do I configure the timeout settings?" },
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: response.content[0].id,
            content: toolResult // Search results go here
          }
        ]
      }
    ]
  });
}
```

```csharp C# nocheck
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

public class Program
{
    public static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var knowledgeBaseTool = new Tool
        {
            Name = "search_knowledge_base",
            Description = "Search the company knowledge base for information",
            InputSchema = new
            {
                type = "object",
                properties = new
                {
                    query = new
                    {
                        type = "string",
                        description = "The search query"
                    }
                },
                required = new[] { "query" }
            }
        };

        var parameters = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 1024,
            Tools = new[] { knowledgeBaseTool },
            Messages = new[]
            {
                new MessageParam
                {
                    Role = Role.User,
                    Content = "How do I configure the timeout settings?"
                }
            }
        };

        var response = await client.Messages.Create(parameters);

        if (response.Content[0] is ToolUseBlock toolUse)
        {
            var toolResult = SearchKnowledgeBase(toolUse.Input["query"].ToString());

            var finalParameters = new MessageCreateParams
            {
                Model = Model.ClaudeOpus4_8,
                MaxTokens = 1024,
                Messages = new[]
                {
                    new MessageParam { Role = Role.User, Content = "How do I configure the timeout settings?" },
                    new MessageParam { Role = Role.Assistant, Content = response.Content },
                    new MessageParam
                    {
                        Role = Role.User,
                        Content = new[]
                        {
                            new ToolResultBlockParam
                            {
                                ToolUseID = toolUse.Id,
                                Content = toolResult
                            }
                        }
                    }
                }
            };

            var finalResponse = await client.Messages.Create(finalParameters);
            Console.WriteLine(finalResponse);
        }
    }

    private static List<SearchResultBlockParam> SearchKnowledgeBase(string query)
    {
        return new List<SearchResultBlockParam>
        {
            new SearchResultBlockParam
            {
                Source = "https://docs.company.com/product-guide",
                Title = "Product Configuration Guide",
                Content = new[]
                {
                    new TextBlockParam
                    {
                        Text = "To configure the product, navigate to Settings > Configuration. The default timeout is 30 seconds, but can be adjusted between 10-120 seconds based on your needs."
                    }
                },
                Citations = new CitationsConfigParam { Enabled = true }
            },
            new SearchResultBlockParam
            {
                Source = "https://docs.company.com/troubleshooting",
                Title = "Troubleshooting Guide",
                Content = new[]
                {
                    new TextBlockParam
                    {
                        Text = "If you encounter timeout errors, first check the configuration settings. Common causes include network latency and incorrect timeout values."
                    }
                },
                Citations = new CitationsConfigParam { Enabled = true }
            }
        };
    }
}
```

```go Go nocheck hidelines={1..12,77..78}
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

	knowledgeBaseTool := anthropic.ToolUnionParam{
		OfTool: &anthropic.ToolParam{
			Name:        "search_knowledge_base",
			Description: anthropic.String("Search the company knowledge base for information"),
			InputSchema: anthropic.ToolInputSchemaParam{
				Properties: map[string]any{
					"query": map[string]any{
						"type":        "string",
						"description": "The search query",
					},
				},
				Required: []string{"query"},
			},
		},
	}

	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 1024,
		Tools:     []anthropic.ToolUnionParam{knowledgeBaseTool},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("How do I configure the timeout settings?")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	for _, block := range response.Content {
		switch variant := block.AsAny().(type) {
		case anthropic.ToolUseBlock:
			var input struct {
				Query string `json:"query"`
			}
			if err := json.Unmarshal(variant.Input, &input); err != nil {
				log.Fatal(err)
			}
			toolResults := searchKnowledgeBase(input.Query)

			// 从响应构建助手消息
			assistantParam := response.ToParam()

			finalResponse, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
				Model:     anthropic.ModelClaudeOpus4_8,
				MaxTokens: 1024,
				Messages: []anthropic.MessageParam{
					anthropic.NewUserMessage(anthropic.NewTextBlock("How do I configure the timeout settings?")),
					assistantParam,
					anthropic.NewUserMessage(anthropic.ContentBlockParamUnion{
						OfToolResult: &anthropic.ToolResultBlockParam{
							ToolUseID: variant.ID,
							Content:   toolResults,
						},
					}),
				},
			})
			if err != nil {
				log.Fatal(err)
			}
			fmt.Println(finalResponse)
		}
	}
}

func searchKnowledgeBase(query string) []anthropic.ToolResultBlockParamContentUnion {
	return []anthropic.ToolResultBlockParamContentUnion{
		{OfSearchResult: &anthropic.SearchResultBlockParam{
			Content: []anthropic.TextBlockParam{
				{Text: "To configure the product, navigate to Settings > Configuration. The default timeout is 30 seconds, but can be adjusted between 10-120 seconds based on your needs."},
			},
			Source:    "https://docs.company.com/product-guide",
			Title:     "Product Configuration Guide",
			Citations: anthropic.CitationsConfigParam{Enabled: anthropic.Bool(true)},
		}},
		{OfSearchResult: &anthropic.SearchResultBlockParam{
			Content: []anthropic.TextBlockParam{
				{Text: "If you encounter timeout errors, first check the configuration settings. Common causes include network latency and incorrect timeout values."},
			},
			Source:    "https://docs.company.com/troubleshooting",
			Title:     "Troubleshooting Guide",
			Citations: anthropic.CitationsConfigParam{Enabled: anthropic.Bool(true)},
		}},
	}
}
```

```java Java nocheck hidelines={1..3,5..7,9..19,75..76,-1}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.CitationsConfigParam;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.SearchResultBlockParam;
import com.anthropic.models.messages.TextBlockParam;
import com.anthropic.models.messages.Tool;
import com.anthropic.models.messages.ToolResultBlockParam;
import com.anthropic.models.messages.ToolUseBlock;
import com.anthropic.models.messages.ToolUseBlockParam;
import com.anthropic.core.JsonValue;
import java.util.List;
import java.util.Map;

public class SearchKnowledgeBaseExample {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        Tool knowledgeBaseTool = Tool.builder()
            .name("search_knowledge_base")
            .description("Search the company knowledge base for information")
            .inputSchema(Tool.InputSchema.builder()
                .properties(JsonValue.from(Map.of(
                    "query", Map.of(
                        "type", "string",
                        "description", "The search query"
                    )
                )))
                .putAdditionalProperty("required", JsonValue.from(List.of("query")))
                .build())
            .build();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(1024L)
            .addTool(knowledgeBaseTool)
            .addUserMessage("How do I configure the timeout settings?")
            .build();

        Message response = client.messages().create(params);

        response.content().get(0).toolUse().ifPresent(toolUse -> {
            List<ContentBlockParam> toolResult = searchKnowledgeBase(
                (String) ((Map<?, ?>) toolUse._input()).get("query")
            );

            MessageCreateParams finalParams = MessageCreateParams.builder()
                .model(Model.CLAUDE_OPUS_4_8)
                .maxTokens(1024L)
                .addUserMessage("How do I configure the timeout settings?")
                .addAssistantMessageOfBlockParams(List.of(
                    ContentBlockParam.ofToolUse(ToolUseBlockParam.builder()
                        .id(toolUse.id())
                        .name(toolUse.name())
                        .input(toolUse._input())
                        .build())
                ))
                .addUserMessageOfBlockParams(List.of(
                    ContentBlockParam.ofToolResult(
                        ToolResultBlockParam.builder()
                            .toolUseId(toolUse.id())
                            .contentOfBlockParams(toolResult)
                            .build()
                    )
                ))
                .build();

            Message finalResponse = client.messages().create(finalParams);
            System.out.println(finalResponse);
        });
    }

    private static List<ContentBlockParam> searchKnowledgeBase(String query) {
        return List.of(
            ContentBlockParam.ofSearchResult(
                SearchResultBlockParam.builder()
                    .source("https://docs.company.com/product-guide")
                    .title("Product Configuration Guide")
                    .content(List.of(
                        TextBlockParam.builder()
                            .text("To configure the product, navigate to Settings > Configuration. The default timeout is 30 seconds, but can be adjusted between 10-120 seconds based on your needs.")
                            .build()
                    ))
                    .citations(CitationsConfigParam.builder().enabled(true).build())
                    .build()
            ),
            ContentBlockParam.ofSearchResult(
                SearchResultBlockParam.builder()
                    .source("https://docs.company.com/troubleshooting")
                    .title("Troubleshooting Guide")
                    .content(List.of(
                        TextBlockParam.builder()
                            .text("If you encounter timeout errors, first check the configuration settings. Common causes include network latency and incorrect timeout values.")
                            .build()
                    ))
                    .citations(CitationsConfigParam.builder().enabled(true).build())
                    .build()
            )
        );
    }
}
```

```php PHP nocheck hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$knowledgeBaseTool = [
    'name' => 'search_knowledge_base',
    'description' => 'Search the company knowledge base for information',
    'input_schema' => [
        'type' => 'object',
        'properties' => [
            'query' => [
                'type' => 'string',
                'description' => 'The search query'
            ]
        ],
        'required' => ['query']
    ]
];

function searchKnowledgeBase($query) {
    return [
        [
            'type' => 'search_result',
            'source' => 'https://docs.company.com/product-guide',
            'title' => 'Product Configuration Guide',
            'content' => [
                [
                    'type' => 'text',
                    'text' => 'To configure the product, navigate to Settings > Configuration. The default timeout is 30 seconds, but can be adjusted between 10-120 seconds based on your needs.'
                ]
            ],
            'citations' => ['enabled' => true]
        ],
        [
            'type' => 'search_result',
            'source' => 'https://docs.company.com/troubleshooting',
            'title' => 'Troubleshooting Guide',
            'content' => [
                [
                    'type' => 'text',
                    'text' => 'If you encounter timeout errors, first check the configuration settings. Common causes include network latency and incorrect timeout values.'
                ]
            ],
            'citations' => ['enabled' => true]
        ]
    ];
}

$response = $client->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'How do I configure the timeout settings?']
    ],
    model: 'claude-opus-4-8',
    tools: [$knowledgeBaseTool],
);

$toolUseBlock = null;
foreach ($response->content as $block) {
    if ($block->type === 'tool_use') {
        $toolUseBlock = $block;
        break;
    }
}

if ($toolUseBlock !== null) {
    $toolResult = searchKnowledgeBase($toolUseBlock->input['query']);

    $finalResponse = $client->messages->create(
        maxTokens: 1024,
        messages: [
            ['role' => 'user', 'content' => 'How do I configure the timeout settings?'],
            ['role' => 'assistant', 'content' => $response->content],
            [
                'role' => 'user',
                'content' => [
                    [
                        'type' => 'tool_result',
                        'tool_use_id' => $toolUseBlock->id,
                        'content' => $toolResult
                    ]
                ]
            ]
        ],
        model: 'claude-opus-4-8',
    );
    echo $finalResponse;
} else {
    echo $response;
}
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

knowledge_base_tool = {
  name: "search_knowledge_base",
  description: "Search the company knowledge base for information",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query" }
    },
    required: ["query"]
  }
}

def search_knowledge_base(query)
  [
    {
      type: "search_result",
      source: "https://docs.company.com/product-guide",
      title: "Product Configuration Guide",
      content: [
        {
          type: "text",
          text: "To configure the product, navigate to Settings > Configuration. The default timeout is 30 seconds, but can be adjusted between 10-120 seconds based on your needs."
        }
      ],
      citations: { enabled: true }
    },
    {
      type: "search_result",
      source: "https://docs.company.com/troubleshooting",
      title: "Troubleshooting Guide",
      content: [
        {
          type: "text",
          text: "If you encounter timeout errors, first check the configuration settings. Common causes include network latency and incorrect timeout values."
        }
      ],
      citations: { enabled: true }
    }
  ]
end

response = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [knowledge_base_tool],
  messages: [
    { role: "user", content: "How do I configure the timeout settings?" }
  ]
)

if response.content.first.type == :tool_use
  tool_result = search_knowledge_base(response.content.first.input["query"])

  final_response = client.messages.create(
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [
      { role: "user", content: "How do I configure the timeout settings?" },
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: response.content.first.id,
            content: tool_result
          }
        ]
      }
    ]
  )
  puts final_response
end
```
</CodeGroup>

## 方法 2：作为顶层内容的搜索结果 \{#method-2-search-results-as-top-level-content}

您也可以直接在用户消息中提供搜索结果。这适用于：
- 来自您的搜索基础设施的预取内容
- 来自先前查询的缓存搜索结果
- 来自外部搜索服务的内容
- 测试和开发

### 示例：直接提供搜索结果 \{#example-direct-search-results}

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
        {
            "role": "user",
            "content": [
                {
                    "type": "search_result",
                    "source": "https://docs.company.com/api-reference",
                    "title": "API Reference - Authentication",
                    "content": [
                        {
                            "type": "text",
                            "text": "All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard. Rate limits: 1000 requests per hour for standard tier, 10000 for premium."
                        }
                    ],
                    "citations": {
                        "enabled": true
                    }
                },
                {
                    "type": "search_result",
                    "source": "https://docs.company.com/quickstart",
                    "title": "Getting Started Guide",
                    "content": [
                        {
                            "type": "text",
                            "text": "To get started: 1) Sign up for an account, 2) Generate an API key from the dashboard, 3) Install our SDK using pip install company-sdk, 4) Initialize the client with your API key."
                        }
                    ],
                    "citations": {
                        "enabled": true
                    }
                },
                {
                    "type": "text",
                    "text": "Based on these search results, how do I authenticate API requests and what are the rate limits?"
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
messages:
  - role: user
    content:
      - type: search_result
        source: https://docs.company.com/api-reference
        title: API Reference - Authentication
        content:
          - type: text
            text: >-
              All API requests must include an API key in the Authorization
              header. Keys can be generated from the dashboard. Rate limits:
              1000 requests per hour for standard tier, 10000 for premium.
        citations:
          enabled: true
      - type: search_result
        source: https://docs.company.com/quickstart
        title: Getting Started Guide
        content:
          - type: text
            text: >-
              To get started: 1) Sign up for an account, 2) Generate an API
              key from the dashboard, 3) Install our SDK using pip install
              company-sdk, 4) Initialize the client with your API key.
        citations:
          enabled: true
      - type: text
        text: >-
          Based on these search results, how do I authenticate API requests
          and what are the rate limits?
YAML
```

```python Python hidelines={1}
from anthropic import Anthropic
from anthropic.types import MessageParam, TextBlockParam, SearchResultBlockParam

client = Anthropic()

# 直接在用户消息中提供搜索结果
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[
        MessageParam(
            role="user",
            content=[
                SearchResultBlockParam(
                    type="search_result",
                    source="https://docs.company.com/api-reference",
                    title="API Reference - Authentication",
                    content=[
                        TextBlockParam(
                            type="text",
                            text="All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard. Rate limits: 1000 requests per hour for standard tier, 10000 for premium.",
                        )
                    ],
                    citations={"enabled": True},
                ),
                SearchResultBlockParam(
                    type="search_result",
                    source="https://docs.company.com/quickstart",
                    title="Getting Started Guide",
                    content=[
                        TextBlockParam(
                            type="text",
                            text="To get started: 1) Sign up for an account, 2) Generate an API key from the dashboard, 3) Install our SDK using pip install company-sdk, 4) Initialize the client with your API key.",
                        )
                    ],
                    citations={"enabled": True},
                ),
                TextBlockParam(
                    type="text",
                    text="Based on these search results, how do I authenticate API requests and what are the rate limits?",
                ),
            ],
        )
    ],
)

print(response)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

// 直接在用户消息中提供搜索结果
const response = await anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "search_result" as const,
          source: "https://docs.company.com/api-reference",
          title: "API Reference - Authentication",
          content: [
            {
              type: "text" as const,
              text: "All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard. Rate limits: 1000 requests per hour for standard tier, 10000 for premium."
            }
          ],
          citations: { enabled: true }
        },
        {
          type: "search_result" as const,
          source: "https://docs.company.com/quickstart",
          title: "Getting Started Guide",
          content: [
            {
              type: "text" as const,
              text: "To get started: 1) Sign up for an account, 2) Generate an API key from the dashboard, 3) Install our SDK using pip install company-sdk, 4) Initialize the client with your API key."
            }
          ],
          citations: { enabled: true }
        },
        {
          type: "text" as const,
          text: "Based on these search results, how do I authenticate API requests and what are the rate limits?"
        }
      ]
    }
  ]
});

console.log(response);
```

```csharp C# nocheck
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
            MaxTokens = 1024,
            Messages =
            [
                new()
                {
                    Role = Role.User,
                    Content =
                    [
                        new SearchResultBlockParam
                        {
                            Source = "https://docs.company.com/api-reference",
                            Title = "API Reference - Authentication",
                            Content =
                            [
                                new TextBlockParam
                                {
                                    Text = "All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard. Rate limits: 1000 requests per hour for standard tier, 10000 for premium."
                                }
                            ],
                            Citations = new CitationsConfigParam { Enabled = true }
                        },
                        new SearchResultBlockParam
                        {
                            Source = "https://docs.company.com/quickstart",
                            Title = "Getting Started Guide",
                            Content =
                            [
                                new TextBlockParam
                                {
                                    Text = "To get started: 1) Sign up for an account, 2) Generate an API key from the dashboard, 3) Install our SDK using pip install company-sdk, 4) Initialize the client with your API key."
                                }
                            ],
                            Citations = new CitationsConfigParam { Enabled = true }
                        },
                        new TextBlockParam
                        {
                            Text = "Based on these search results, how do I authenticate API requests and what are the rate limits?"
                        }
                    ]
                }
            ]
        };

        var message = await client.Messages.Create(parameters);
        Console.WriteLine(message);
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
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 1024,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(
				anthropic.ContentBlockParamUnion{OfSearchResult: &anthropic.SearchResultBlockParam{
					Content: []anthropic.TextBlockParam{
						{Text: "All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard. Rate limits: 1000 requests per hour for standard tier, 10000 for premium."},
					},
					Source:    "https://docs.company.com/api-reference",
					Title:     "API Reference - Authentication",
					Citations: anthropic.CitationsConfigParam{Enabled: anthropic.Bool(true)},
				}},
				anthropic.ContentBlockParamUnion{OfSearchResult: &anthropic.SearchResultBlockParam{
					Content: []anthropic.TextBlockParam{
						{Text: "To get started: 1) Sign up for an account, 2) Generate an API key from the dashboard, 3) Install our SDK using pip install company-sdk, 4) Initialize the client with your API key."},
					},
					Source:    "https://docs.company.com/quickstart",
					Title:     "Getting Started Guide",
					Citations: anthropic.CitationsConfigParam{Enabled: anthropic.Bool(true)},
				}},
				anthropic.NewTextBlock("Based on these search results, how do I authenticate API requests and what are the rate limits?"),
			),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..3,5..7,9..13,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.CitationsConfigParam;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.SearchResultBlockParam;
import com.anthropic.models.messages.TextBlockParam;
import java.util.List;

public class SearchResultExample {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(1024L)
            .addUserMessageOfBlockParams(List.of(
                ContentBlockParam.ofSearchResult(
                    SearchResultBlockParam.builder()
                        .source("https://docs.company.com/api-reference")
                        .title("API Reference - Authentication")
                        .content(List.of(
                            TextBlockParam.builder()
                                .text("All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard. Rate limits: 1000 requests per hour for standard tier, 10000 for premium.")
                                .build()
                        ))
                        .citations(CitationsConfigParam.builder().enabled(true).build())
                        .build()
                ),
                ContentBlockParam.ofSearchResult(
                    SearchResultBlockParam.builder()
                        .source("https://docs.company.com/quickstart")
                        .title("Getting Started Guide")
                        .content(List.of(
                            TextBlockParam.builder()
                                .text("To get started: 1) Sign up for an account, 2) Generate an API key from the dashboard, 3) Install our SDK using pip install company-sdk, 4) Initialize the client with your API key.")
                                .build()
                        ))
                        .citations(CitationsConfigParam.builder().enabled(true).build())
                        .build()
                ),
                ContentBlockParam.ofText(
                    TextBlockParam.builder()
                        .text("Based on these search results, how do I authenticate API requests and what are the rate limits?")
                        .build()
                )
            ))
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
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'search_result',
                    'source' => 'https://docs.company.com/api-reference',
                    'title' => 'API Reference - Authentication',
                    'content' => [
                        [
                            'type' => 'text',
                            'text' => 'All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard. Rate limits: 1000 requests per hour for standard tier, 10000 for premium.'
                        ]
                    ],
                    'citations' => ['enabled' => true]
                ],
                [
                    'type' => 'search_result',
                    'source' => 'https://docs.company.com/quickstart',
                    'title' => 'Getting Started Guide',
                    'content' => [
                        [
                            'type' => 'text',
                            'text' => 'To get started: 1) Sign up for an account, 2) Generate an API key from the dashboard, 3) Install our SDK using pip install company-sdk, 4) Initialize the client with your API key.'
                        ]
                    ],
                    'citations' => ['enabled' => true]
                ],
                [
                    'type' => 'text',
                    'text' => 'Based on these search results, how do I authenticate API requests and what are the rate limits?'
                ]
            ]
        ]
    ],
    model: 'claude-opus-4-8',
);

echo json_encode($message, JSON_PRETTY_PRINT);
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "search_result",
          source: "https://docs.company.com/api-reference",
          title: "API Reference - Authentication",
          content: [
            {
              type: "text",
              text: "All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard. Rate limits: 1000 requests per hour for standard tier, 10000 for premium."
            }
          ],
          citations: { enabled: true }
        },
        {
          type: "search_result",
          source: "https://docs.company.com/quickstart",
          title: "Getting Started Guide",
          content: [
            {
              type: "text",
              text: "To get started: 1) Sign up for an account, 2) Generate an API key from the dashboard, 3) Install our SDK using pip install company-sdk, 4) Initialize the client with your API key."
            }
          ],
          citations: { enabled: true }
        },
        {
          type: "text",
          text: "Based on these search results, how do I authenticate API requests and what are the rate limits?"
        }
      ]
    }
  ]
)

puts message
```
</CodeGroup>

## Claude 带引用的响应 \{#claudes-response-with-citations}

无论搜索结果以何种方式提供，Claude 在使用其中的信息时都会自动包含引用：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard.",
      "citations": [
        {
          "type": "search_result_location",
          "cited_text": "All API requests must include an API key in the Authorization header. Keys can be generated from the dashboard. Rate limits: 1000 requests per hour for standard tier, 10000 for premium.",
          "source": "https://docs.company.com/api-reference",
          "title": "API Reference - Authentication",
          "search_result_index": 0,
          "start_block_index": 0,
          "end_block_index": 1
        }
      ]
    },
    {
      "type": "text",
      "text": "\n\nTo set this up from scratch, you'll need to "
    },
    {
      "type": "text",
      "text": "sign up for an account, generate an API key from the dashboard, install the SDK using `pip install company-sdk`, and initialize the client with your API key.",
      "citations": [
        {
          "type": "search_result_location",
          "cited_text": "To get started: 1) Sign up for an account, 2) Generate an API key from the dashboard, 3) Install our SDK using pip install company-sdk, 4) Initialize the client with your API key.",
          "source": "https://docs.company.com/quickstart",
          "title": "Getting Started Guide",
          "search_result_index": 1,
          "start_block_index": 0,
          "end_block_index": 1
        }
      ]
    }
  ]
}
```

### 引用字段 \{#citation-fields}

每个引用包含：

| 字段 | 类型 | 描述 |
|-------|------|-------------|
| `type` | string | 对于搜索结果引用，始终为 `"search_result_location"` |
| `source` | string | 来自原始搜索结果的来源 |
| `title` | string 或 null | 来自原始搜索结果的标题 |
| `cited_text` | string | 被引用块的完整文本，拼接而成。等于 `content[start_block_index:end_block_index]` 的内容连接在一起。不计入输出令牌。 |
| `search_result_index` | integer | 被引用的搜索结果在请求中所有 `search_result` 块中的索引（从 0 开始），按其出现顺序排列（跨所有消息和工具结果）。 |
| `start_block_index` | integer | 搜索结果 `content` 数组中第一个被引用块的索引（从 0 开始）。 |
| `end_block_index` | integer | 搜索结果 `content` 数组中被引用块范围的结束索引（不含）。始终大于 `start_block_index`。 |

块索引标识搜索结果 `content` 数组的一个切片，而 `cited_text` 是该切片的完整文本。文本块是最小的可引用单元：Claude 引用的是整个块，而不是块内的子字符串。要获得更细粒度的引用，请将您的搜索结果内容拆分为更小的块（参见[多个内容块](#多个内容块)）。

## 多个内容块 \{#multiple-content-blocks}

搜索结果可以在 `content` 数组中包含多个文本块：

```json
{
  "type": "search_result",
  "source": "https://docs.company.com/api-guide",
  "title": "API Documentation",
  "content": [
    {
      "type": "text",
      "text": "Authentication: All API requests require an API key."
    },
    {
      "type": "text",
      "text": "Rate Limits: The API allows 1000 requests per hour per key."
    },
    {
      "type": "text",
      "text": "Error Handling: The API returns standard HTTP status codes."
    }
  ]
}
```

引用速率限制块的引用如下所示：

```json
{
  "type": "search_result_location",
  "cited_text": "Rate Limits: The API allows 1000 requests per hour per key.",
  "source": "https://docs.company.com/api-guide",
  "title": "API Documentation",
  "search_result_index": 0,
  "start_block_index": 1,
  "end_block_index": 2
}
```

当此搜索结果被引用时，`start_block_index` 和 `end_block_index` 标识引用覆盖了哪些块，而 `cited_text` 恰好包含这些块的文本。将内容拆分为更小、更聚焦的块可以为 Claude 提供更精细的引用边界；将内容合并为一个块则意味着每次引用都会返回完整文本。这与引用功能中[自定义内容文档](/docs/zh-CN/build-with-claude/citations#custom-content-documents)所使用的模型相同。

## 高级用法 \{#advanced-usage}

### 结合两种方法 \{#combining-both-methods}

您可以在同一对话中同时使用基于工具的搜索结果和顶层搜索结果：

```python nocheck
from anthropic.types import MessageParam, SearchResultBlockParam, TextBlockParam

# 第一条消息，包含顶层搜索结果
messages = [
    MessageParam(
        role="user",
        content=[
            SearchResultBlockParam(
                type="search_result",
                source="https://docs.company.com/overview",
                title="Product Overview",
                content=[
                    TextBlockParam(
                        type="text", text="Our product helps teams collaborate..."
                    )
                ],
                citations={"enabled": True},
            ),
            TextBlockParam(
                type="text",
                text="Tell me about this product and search for pricing information",
            ),
        ],
    )
]

# Claude 可能会响应并调用工具来搜索定价信息
# 然后您提供包含更多搜索结果的工具结果
```

### 与其他内容类型结合 \{#combining-with-other-content-types}

两种方法都支持将搜索结果与其他内容混合使用：

```python nocheck
from anthropic.types import SearchResultBlockParam, TextBlockParam

# 在工具结果中
tool_result = [
    SearchResultBlockParam(
        type="search_result",
        source="https://docs.company.com/guide",
        title="User Guide",
        content=[TextBlockParam(type="text", text="Configuration details...")],
        citations={"enabled": True},
    ),
    TextBlockParam(
        type="text", text="Additional context: This applies to version 2.0 and later."
    ),
]

# 在顶层内容中
user_content = [
    SearchResultBlockParam(
        type="search_result",
        source="https://research.com/paper",
        title="Research Paper",
        content=[TextBlockParam(type="text", text="Key findings...")],
        citations={"enabled": True},
    ),
    {
        "type": "image",
        "source": {"type": "url", "url": "https://example.com/chart.png"},
    },
    TextBlockParam(
        type="text", text="How does the chart relate to the research findings?"
    ),
]
```

### 缓存控制 \{#cache-control}

添加缓存控制以获得更好的性能：

```json
{
  "type": "search_result",
  "source": "https://docs.company.com/guide",
  "title": "User Guide",
  "content": [{ "type": "text", "text": "..." }],
  "cache_control": {
    "type": "ephemeral"
  }
}
```

### 引用控制 \{#citation-control}

默认情况下，搜索结果的引用功能是禁用的。您可以通过显式设置 `citations` 配置来启用引用：

```json
{
  "type": "search_result",
  "source": "https://docs.company.com/guide",
  "title": "User Guide",
  "content": [{ "type": "text", "text": "Important documentation..." }],
  "citations": {
    "enabled": true // Enable citations for this result
  }
}
```

当 `citations.enabled` 设置为 `true` 时，Claude 在使用搜索结果中的信息时会包含引用参考。这可以实现：
- 为您的自定义 RAG 应用程序提供自然引用
- 在对接专有知识库时提供来源归属
- 为任何返回搜索结果的自定义工具提供网络搜索级别的引用质量

<Warning>
引用是全有或全无的：请求中的所有搜索结果必须全部启用引用，或全部禁用引用。混合使用具有不同引用设置的搜索结果会导致错误。
</Warning>

## 最佳实践 \{#best-practices}

### 基于工具的搜索（方法 1） \{#for-tool-based-search-method-1}

- **动态内容：**用于实时搜索和动态 RAG 应用程序
- **错误处理：**当搜索失败时返回适当的消息
- **结果限制：**仅返回最相关的结果，以避免上下文溢出

### 顶层搜索（方法 2） \{#for-top-level-search-method-2}

- **预取内容：**当您已经拥有搜索结果时使用
- **批量处理：**非常适合一次处理多个搜索结果
- **测试：**非常适合使用已知内容测试引用行为

### 通用最佳实践 \{#general-best-practices}

1. **有效地构建结果结构：**
   - 使用清晰、永久的来源 URL
   - 提供描述性标题
   - 将长内容拆分为逻辑文本块，以便为 Claude 提供更精细的引用边界

2. **保持一致性：**
   - 在整个应用程序中使用一致的来源格式
   - 确保标题准确反映内容
   - 保持格式一致

3. **优雅地处理错误：**
   
   ```python nocheck
   def search_with_fallback(query):
       try:
           results = perform_search(query)
           if not results:
               return {"type": "text", "text": "No results found."}
           return format_as_search_results(results)
       except Exception as e:
           return {"type": "text", "text": f"Search error: {str(e)}"}
   ```

## 限制 \{#limitations}

- 搜索结果内容块在 Claude API、Amazon Bedrock 和 Google Cloud 的 Vertex AI 上可用
- 搜索结果中仅支持文本内容（不支持图像或其他媒体）
- `content` 数组必须包含至少一个文本块