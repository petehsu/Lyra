# 代码执行工具

在沙盒容器中运行 Python 和 bash 代码，以分析数据、生成文件并迭代解决方案。

---

Claude 可以直接在 API 对话中分析数据、创建可视化图表、执行复杂计算、运行系统命令、创建和编辑文件，以及处理上传的文件。代码执行工具允许 Claude 在安全的沙盒环境中运行 Bash 命令和操作文件（包括编写代码）。

**当与网络搜索或网络抓取一起使用时，代码执行是免费的。** 当您的请求中包含 `web_search_20260209` 或 `web_fetch_20260209` 时，除标准输入和输出令牌费用外，代码执行工具调用不会产生额外费用。当未包含这些工具时，将按标准代码执行费用收费。

代码执行是构建高性能智能体的核心基础能力。它支持在网络搜索和网络抓取工具中进行动态过滤，使 Claude 能够在结果进入上下文窗口之前对其进行处理，从而提高准确性并减少令牌消耗。

<Note>
请通过[反馈表单](https://forms.gle/LTAU6Xn2puCJMi1n6)与我们分享您对此功能的反馈。
</Note>

<Note>
此功能**不**符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。数据将根据该功能的标准保留策略进行保留。
</Note>

## 模型兼容性 \{#model-compatibility}

代码执行工具在以下模型上可用：

| 模型 | 工具版本 |
|-------|--------------|
| Claude Fable 5 (claude-fable-5) | `code_execution_20250825`、`code_execution_20260120` |
| Claude Mythos 5 (claude-mythos-5) | `code_execution_20250825`、`code_execution_20260120` |
| Claude Opus 4.8 (claude-opus-4-8) | `code_execution_20250825`、`code_execution_20260120` |
| Claude Opus 4.7 (claude-opus-4-7) | `code_execution_20250825`、`code_execution_20260120` |
| Claude Opus 4.6 (claude-opus-4-6) | `code_execution_20250825`、`code_execution_20260120` |
| Claude Sonnet 4.6 (claude-sonnet-4-6) | `code_execution_20250825`、`code_execution_20260120` |
| Claude Opus 4.5 (claude-opus-4-5-20251101) | `code_execution_20250825`、`code_execution_20260120` |
| Claude Sonnet 4.5 (claude-sonnet-4-5-20250929) | `code_execution_20250825`、`code_execution_20260120` |
| Claude Haiku 4.5 (claude-haiku-4-5-20251001) | `code_execution_20250825` |
| Claude Opus 4.1 (claude-opus-4-1-20250805)（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | `code_execution_20250825` |
| Claude Opus 4 (claude-opus-4-20250514)（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | `code_execution_20250825` |
| Claude Sonnet 4 (claude-sonnet-4-20250514)（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | `code_execution_20250825` |

<Note>
`code_execution_20250825` 支持 Bash 命令和文件操作，并在上表中的所有模型上可用。`code_execution_20260120` 增加了 REPL 状态持久化以及在沙盒内进行[编程式工具调用](/docs/zh-CN/agents-and-tools/tool-use/programmatic-tool-calling)的功能，仅在 Claude Fable 5、Claude Mythos 5、Opus 4.5+ 和 Sonnet 4.5+ 上可用。如果您仍在使用旧版 `code_execution_20250522`（仅支持 Python），请参阅[升级到最新工具版本](#upgrade-to-latest-tool-version)以进行迁移。
</Note>

<Warning>
旧版工具不保证与新版模型向后兼容。请始终使用与您的模型版本相对应的工具版本。
</Warning>

## 平台可用性 \{#platform-availability}

代码执行在以下平台上可用：
- **Claude API**（Anthropic）
- **[Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws)**
- **[Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)**

代码执行目前在 Amazon Bedrock 或 Vertex AI 上不可用。

<Note>
对于 [Claude Mythos Preview](https://anthropic.com/glasswing)，代码执行仅在 Claude API 和 Microsoft Foundry 上受支持。在 Amazon Bedrock、Vertex AI 或 Claude Platform on AWS 上，Mythos Preview 不支持代码执行。
</Note>

## 快速开始 \{#quick-start}

以下是一个要求 Claude 执行计算的简单示例：

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
                "content": "Calculate the mean and standard deviation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]"
            }
        ],
        "tools": [{
            "type": "code_execution_20250825",
            "name": "code_execution"
        }]
    }'
```

```bash CLI
ant messages create \
  --model claude-opus-4-8 \
  --max-tokens 4096 \
  --message '{role: user, content: "Calculate the mean and standard deviation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]"}' \
  --tool '{type: code_execution_20250825, name: code_execution}'
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
            "content": "Calculate the mean and standard deviation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]",
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)

print(response)
```

```typescript TypeScript hidelines={1..5,-3..-1}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function main() {
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: "Calculate the mean and standard deviation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]"
      }
    ],
    tools: [
      {
        type: "code_execution_20250825",
        name: "code_execution"
      }
    ]
  });

  console.log(response);
}

main().catch(console.error);
```

```csharp C# hidelines={1..11,-2..}
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
            MaxTokens = 4096,
            Messages = [
                new() {
                    Role = Role.User,
                    Content = "Calculate the mean and standard deviation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]"
                }
            ],
            Tools = [new ToolUnion(new CodeExecutionTool20250825())]
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

	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 4096,
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Calculate the mean and standard deviation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
		Betas: []anthropic.AnthropicBeta{"code-execution-2025-08-25"},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..5,7..9,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.CodeExecutionTool20250825;

public class CodeExecution {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(4096L)
            .addUserMessage("Calculate the mean and standard deviation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]")
            .addTool(CodeExecutionTool20250825.builder().build())
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
    maxTokens: 4096,
    messages: [
        [
            'role' => 'user',
            'content' => 'Calculate the mean and standard deviation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]'
        ]
    ],
    model: 'claude-opus-4-8',
    tools: [
        [
            'type' => 'code_execution_20250825',
            'name' => 'code_execution'
        ]
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
    {
      role: "user",
      content: "Calculate the mean and standard deviation of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]"
    }
  ],
  tools: [
    {
      type: "code_execution_20250825",
      name: "code_execution"
    }
  ]
)

puts message
```
</CodeGroup>

## 代码执行的工作原理 \{#how-code-execution-works}

当您将代码执行工具添加到 API 请求中时：

1. Claude 会评估代码执行是否有助于回答您的问题
2. 该工具会自动为 Claude 提供以下能力：
   - **Bash 命令**：执行 shell 命令以进行系统操作和包管理
   - **文件操作**：直接创建、查看和编辑文件，包括编写代码
3. Claude 可以在单个请求中使用这些能力的任意组合
4. 所有操作都在安全的沙盒环境中运行
5. Claude 会提供结果以及生成的任何图表、计算或分析

### Claude 何时运行代码 \{#when-claude-runs-code}

当请求可以从计算或文件处理中受益时，Claude 会运行代码：

- 非简单数学运算（大数字、多步骤、对精度敏感的结果）
- 数据分析、文件解析或可视化
- 算法执行或模拟
- 明确要求"运行"、"计算"或"执行"的请求

对于以下情况，Claude 会直接回答而不运行代码：

- 简单算术和众所周知的数学事实
- 事实性、对话性或创意性请求
- 简单的单位换算或翻译

如果您希望 Claude 为边界情况的请求运行代码，请明确提出要求（例如，"运行代码来验证这一点"）。

## 将代码执行与其他执行工具一起使用 \{#using-code-execution-with-other-execution-tools}

当您在提供代码执行工具的同时，还提供了同样可以运行代码的客户端工具（例如 [bash 工具](/docs/zh-CN/agents-and-tools/tool-use/bash-tool)或自定义 REPL）时，Claude 就处于多计算机环境中。代码执行工具在 Anthropic 的沙盒容器中运行，而您的客户端工具则在您控制的独立环境中运行。Claude 有时可能会混淆这些环境，尝试使用错误的工具或假设它们之间共享状态。

为避免这种情况，请在系统提示中添加说明以阐明两者的区别：

```text
When multiple code execution environments are available, be aware that:
- Variables, files, and state do NOT persist between different execution environments
- Use the code_execution tool for general-purpose computation in Anthropic's sandboxed environment
- Use client-provided execution tools (e.g., bash) when you need access to the user's local system, files, or data
- If you need to pass results between environments, explicitly include outputs in subsequent tool calls rather than assuming shared state
```

当将代码执行与[网络搜索](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool)或[网络抓取](/docs/zh-CN/agents-and-tools/tool-use/web-fetch-tool)结合使用时，这一点尤为重要，因为这些工具会自动启用代码执行。如果您的应用程序已经提供了客户端 shell 工具，自动启用的代码执行会创建第二个执行环境，Claude 需要区分这两个环境。

## 如何使用该工具 \{#how-to-use-the-tool}

### 上传并分析您自己的文件 \{#upload-and-analyze-your-own-files}

要分析您自己的数据文件（如 CSV、Excel 或图像），请通过 Files API 上传它们并在请求中引用：

<Note>
将 Files API 与代码执行一起使用需要 Files API beta 标头：`"anthropic-beta": "files-api-2025-04-14"`
</Note>

Python 环境可以处理通过 Files API 上传的各种文件类型，包括：

- CSV
- Excel（.xlsx、.xls）
- JSON
- XML
- 图像（JPEG、PNG、GIF、WebP）
- 文本文件（.txt、.md、.py 等）

#### 上传并分析文件 \{#upload-and-analyze-files}

1. 使用 [Files API](/docs/zh-CN/build-with-claude/files) **上传您的文件**
2. 使用 `container_upload` 内容块在消息中**引用该文件**
3. 在 API 请求中**包含代码执行工具**

<CodeGroup>
```bash cURL hidelines={1..2}
cd "$(mktemp -d)"
printf 'name,value\nfoo,1\nbar,2\n' > data.csv
# 首先，上传文件
curl https://api.anthropic.com/v1/files \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "anthropic-version: 2023-06-01" \
    --header "anthropic-beta: files-api-2025-04-14" \
    --form 'file=@"data.csv"'

# 然后将 file_id 用于代码执行
curl https://api.anthropic.com/v1/messages \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "anthropic-version: 2023-06-01" \
    --header "anthropic-beta: files-api-2025-04-14" \
    --header "content-type: application/json" \
    --data '{
        "model": "claude-opus-4-8",
        "max_tokens": 4096,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "Analyze this CSV data"},
                {"type": "container_upload", "file_id": "file_abc123"}
            ]
        }],
        "tools": [{
            "type": "code_execution_20250825",
            "name": "code_execution"
        }]
    }'
```

```bash CLI hidelines={1}
printf 'name,value\nfoo,1\nbar,2\n' > data.csv
# 上传文件
FILE_ID=$(ant beta:files upload \
  --file ./data.csv \
  --transform id --raw-output)

# 将 file_id 用于代码执行
ant beta:messages create \
  --beta files-api-2025-04-14 <<YAML
model: claude-opus-4-8
max_tokens: 4096
messages:
  - role: user
    content:
      - type: text
        text: Analyze this CSV data
      - type: container_upload
        file_id: $FILE_ID
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

# 上传文件
file_object = client.beta.files.upload(
    file=open("data.csv", "rb"),
)

# 将 file_id 用于代码执行
response = client.beta.messages.create(
    model="claude-opus-4-8",
    betas=["files-api-2025-04-14"],
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Analyze this CSV data"},
                {"type": "container_upload", "file_id": file_object.id},
            ],
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)

print(response)
```

```typescript TypeScript nocheck hidelines={5..6,-3..-1}
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { createReadStream } from "fs";

const client = new Anthropic();

async function main() {
  // 上传文件
  const fileObject = await client.beta.files.upload({
    file: await toFile(createReadStream("data.csv"), undefined, { type: "text/csv" })
  });

  // 将 file_id 用于代码执行
  const response = await client.beta.messages.create({
    model: "claude-opus-4-8",
    betas: ["files-api-2025-04-14"],
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this CSV data" },
          { type: "container_upload", file_id: fileObject.id }
        ]
      }
    ],
    tools: [
      {
        type: "code_execution_20250825",
        name: "code_execution"
      }
    ]
  });

  console.log(response);
}

main().catch(console.error);
```

```csharp C# nocheck hidelines={1..10,-2..}
using Anthropic;
using Anthropic.Models.Beta.Files;
using Anthropic.Models.Beta.Messages;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        // 上传文件
        var fileObject = await client.Beta.Files.Upload(new FileUploadParams
        {
            File = File.OpenRead("data.csv")
        });

        // 在代码执行中使用 file_id
        var parameters = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            Betas = ["files-api-2025-04-14"],
            MaxTokens = 4096,
            Messages = [
                new()
                {
                    Role = Role.User,
                    Content = [
                        new() { Type = "text", Text = "Analyze this CSV data" },
                        new() { Type = "container_upload", FileId = fileObject.Id }
                    ]
                }
            ],
            Tools = [new ToolUnion(new CodeExecutionTool20250825())]
        };

        var response = await client.Beta.Messages.Create(parameters);
        Console.WriteLine(response);
    }
}
```

```go Go hidelines={11..15}
package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
)

func init() {
	os.WriteFile("data.csv", []byte("name,value\nalpha,1\nbeta,2\ngamma,3\n"), 0644)
}

func main() {
	client := anthropic.NewClient()

	// 上传文件
	file, err := os.Open("data.csv")
	if err != nil {
		log.Fatal(err)
	}
	defer file.Close()

	fileObject, err := client.Beta.Files.Upload(context.TODO(), anthropic.BetaFileUploadParams{
		File: file,
	})
	if err != nil {
		log.Fatal(err)
	}

	// 将 file_id 用于代码执行
	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 4096,
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(
				anthropic.NewBetaTextBlock("Analyze this CSV data"),
				anthropic.NewBetaContainerUploadBlock(fileObject.ID),
			),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
		Betas: []anthropic.AnthropicBeta{
			"code-execution-2025-08-25",
			anthropic.AnthropicBetaFilesAPI2025_04_14,
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(response)
}
```

```java Java nocheck hidelines={1..2,5..6,8..9,11..15,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.files.FileMetadata;
import com.anthropic.models.beta.files.FileUploadParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import com.anthropic.models.beta.messages.BetaContentBlockParam;
import com.anthropic.models.beta.messages.BetaTextBlockParam;
import com.anthropic.models.beta.messages.BetaContainerUploadBlockParam;
import java.nio.file.Paths;
import java.util.List;

public class CodeExecutionWithFiles {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 上传文件
        FileMetadata fileMetadata = client.beta().files().upload(
            FileUploadParams.builder()
                .file(Paths.get("data.csv"))
                .build()
        );

        // 将 file_id 用于代码执行
        BetaMessage response = client.beta().messages().create(
            MessageCreateParams.builder()
                .model("claude-opus-4-8")
                .addBeta("files-api-2025-04-14")
                .maxTokens(4096L)
                .addUserMessageOfBetaContentBlockParams(List.of(
                    BetaContentBlockParam.ofText(BetaTextBlockParam.builder()
                        .text("Analyze this CSV data")
                        .build()),
                    BetaContentBlockParam.ofContainerUpload(BetaContainerUploadBlockParam.builder()
                        .fileId(fileMetadata.id())
                        .build())
                ))
                .addTool(BetaCodeExecutionTool20250825.builder().build())
                .build()
        );

        System.out.println(response);
    }
}
```

```php PHP hidelines={1..3} nocheck
<?php

use Anthropic\Client;
use Anthropic\Core\FileParam;

$client = new Client();

// 上传文件
$fileObject = $client->beta->files->upload(
    file: FileParam::fromResource(fopen('data.csv', 'r')),
);

// 将 file_id 用于代码执行
$response = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [
        [
            'role' => 'user',
            'content' => [
                ['type' => 'text', 'text' => 'Analyze this CSV data'],
                ['type' => 'container_upload', 'file_id' => $fileObject->id],
            ],
        ],
    ],
    model: 'claude-opus-4-8',
    betas: ['files-api-2025-04-14'],
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution'],
    ],
);

echo $response;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 上传文件
file_object = client.beta.files.upload(
  file: File.open("data.csv", "rb")
)

# 将 file_id 用于代码执行
response = client.beta.messages.create(
  model: "claude-opus-4-8",
  betas: ["files-api-2025-04-14"],
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Analyze this CSV data" },
        { type: "container_upload", file_id: file_object.id }
      ]
    }
  ],
  tools: [
    { type: "code_execution_20250825", name: "code_execution" }
  ]
)

puts response
```
</CodeGroup>

### 检索生成的文件 \{#retrieve-generated-files}

当 Claude 在代码执行期间创建文件时，您可以使用 Files API 检索这些文件：

<CodeGroup>

```bash CLI nocheck
# 请求执行创建文件的代码；从工具结果中提取 file_id
TOOL_RESULT='content.#(type=="bash_code_execution_tool_result")#'
FILE_IDS=$(ant beta:messages create \
  --beta files-api-2025-04-14 \
  --transform "${TOOL_RESULT}.content.content|@flatten|#.file_id" \
  --format yaml \
    --model claude-opus-4-8 \
    --max-tokens 4096 \
    --message '{role: user, content: Create a matplotlib visualization and save it as output.png}' \
    --tool '{type: code_execution_20250825, name: code_execution}'
)

# 下载每个已创建的文件
while IFS= read -r LINE; do
  [[ "$LINE" != "- "* ]] && continue
  FILE_ID="${LINE#- }"
  FILENAME=$(ant beta:files retrieve-metadata \
    --file-id "$FILE_ID" \
    --transform filename --raw-output)
  ant beta:files download \
    --file-id "$FILE_ID" \
    --output "$FILENAME" > /dev/null
  printf 'Downloaded: %s\n' "$FILENAME"
done <<< "$FILE_IDS"
```

```python Python nocheck hidelines={1..2}
from anthropic import Anthropic

# 初始化客户端
client = Anthropic()

# 请求执行创建文件的代码
response = client.beta.messages.create(
    model="claude-opus-4-8",
    betas=["files-api-2025-04-14"],
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": "Create a matplotlib visualization and save it as output.png",
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)


# 从响应中提取文件 ID
def extract_file_ids(response):
    file_ids = []
    for item in response.content:
        if item.type == "bash_code_execution_tool_result":
            content_item = item.content
            if content_item.type == "bash_code_execution_result":
                # 具体类型的列表：List[BashCodeExecutionOutputBlock]
                for file in content_item.content:
                    file_ids.append(file.file_id)
    return file_ids


# 下载已创建的文件
for file_id in extract_file_ids(response):
    file_metadata = client.beta.files.retrieve_metadata(file_id)
    file_content = client.beta.files.download(file_id)
    file_content.write_to_file(file_metadata.filename)
    print(f"Downloaded: {file_metadata.filename}")
```

```typescript TypeScript nocheck hidelines={5..6,-3..-1}
import Anthropic from "@anthropic-ai/sdk";
import { writeFile } from "fs/promises";

const client = new Anthropic();

async function main() {
  // 请求创建文件的代码执行
  const response = await client.beta.messages.create({
    model: "claude-opus-4-8",
    betas: ["files-api-2025-04-14"],
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: "Create a matplotlib visualization and save it as output.png"
      }
    ],
    tools: [
      {
        type: "code_execution_20250825",
        name: "code_execution"
      }
    ]
  });

  // 从响应中提取文件 ID
  for (const item of response.content) {
    if (item.type === "bash_code_execution_tool_result") {
      const contentItem = item.content;
      if (contentItem.type === "bash_code_execution_result" && contentItem.content) {
        // 具体类型列表：BashCodeExecutionOutputBlock
        for (const file of contentItem.content) {
          const fileMetadata = await client.beta.files.retrieveMetadata(file.file_id);
          const fileResponse = await client.beta.files.download(file.file_id);
          const fileBytes = Buffer.from(await fileResponse.arrayBuffer());
          await writeFile(fileMetadata.filename, fileBytes);
          console.log(`Downloaded: ${fileMetadata.filename}`);
        }
      }
    }
  }
}

main().catch(console.error);
```

```csharp C# nocheck hidelines={1..14,-2..}
using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Collections.Generic;
using Anthropic;
using Anthropic.Models.Messages;

public class Program
{
    static async Task Main(string[] args)
    {
        var client = new AnthropicClient();

        var parameters = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 4096,
            Messages = [
                new() {
                    Role = Role.User,
                    Content = "Create a matplotlib visualization and save it as output.png"
                }
            ],
            Tools = [new ToolUnion(new CodeExecutionTool20250825())]
        };

        var response = await client.Beta.Messages.Create(parameters, ["files-api-2025-04-14"]);

        var fileIds = ExtractFileIds(response);

        foreach (var fileId in fileIds)
        {
            var fileMetadata = await client.Beta.Files.RetrieveMetadata(fileId);
            var fileContent = await client.Beta.Files.Download(fileId);

            await File.WriteAllBytesAsync(fileMetadata.Filename, fileContent);
            Console.WriteLine($"Downloaded: {fileMetadata.Filename}");
        }
    }

    static List<string> ExtractFileIds(dynamic response)
    {
        var fileIds = new List<string>();
        foreach (var item in response.Content)
        {
            if (item.Type == "bash_code_execution_tool_result")
            {
                var contentItem = item.Content;
                if (contentItem.Type == "bash_code_execution_result")
                {
                    // 具体类型列表：BetaBashCodeExecutionOutputBlock
                    foreach (var file in contentItem.Content)
                    {
                        if (file.FileId != null)
                        {
                            fileIds.Add(file.FileId);
                        }
                    }
                }
            }
        }
        return fileIds;
    }
}
```

```go Go nocheck hidelines={1..13,61..62}
package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 4096,
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Create a matplotlib visualization and save it as output.png")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
		Betas: []anthropic.AnthropicBeta{
			"code-execution-2025-08-25",
			anthropic.AnthropicBetaFilesAPI2025_04_14,
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	fileIDs := extractFileIDs(response)

	for _, fileID := range fileIDs {
		fileMetadata, err := client.Beta.Files.GetMetadata(context.TODO(), fileID, anthropic.BetaFileGetMetadataParams{})
		if err != nil {
			log.Fatal(err)
		}

		fileContent, err := client.Beta.Files.Download(context.TODO(), fileID, anthropic.BetaFileDownloadParams{})
		if err != nil {
			log.Fatal(err)
		}

		outFile, err := os.Create(fileMetadata.Filename)
		if err != nil {
			log.Fatal(err)
		}

		_, err = io.Copy(outFile, fileContent.Body)
		if err != nil {
			log.Fatal(err)
		}
		outFile.Close()
		fileContent.Body.Close()

		fmt.Printf("Downloaded: %s\n", fileMetadata.Filename)
	}
}

func extractFileIDs(response *anthropic.BetaMessage) []string {
	var fileIDs []string
	for _, item := range response.Content {
		switch variant := item.AsAny().(type) {
		case anthropic.BetaBashCodeExecutionToolResultBlock:
			// 具体类型列表：BashCodeExecutionOutputBlock
			for _, file := range variant.Content.Content {
				if file.FileID != "" {
					fileIDs = append(fileIDs, file.FileID)
				}
			}
		}
	}
	return fileIDs
}
```

```java Java nocheck hidelines={1..6,11..15,39..40}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.http.HttpResponse;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaContentBlock;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import com.anthropic.models.beta.messages.BetaBashCodeExecutionResultBlock;
import com.anthropic.models.beta.messages.BetaBashCodeExecutionOutputBlock;
import com.anthropic.models.beta.files.FileMetadata;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

void main() throws Exception {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model("claude-opus-4-8")
        .addBeta("files-api-2025-04-14")
        .maxTokens(4096L)
        .addUserMessage("Create a matplotlib visualization and save it as output.png")
        .addTool(BetaCodeExecutionTool20250825.builder().build())
        .build();

    BetaMessage response = client.beta().messages().create(params);

    List<String> fileIds = extractFileIds(response);

    for (String fileId : fileIds) {
        FileMetadata fileMetadata = client.beta().files().retrieveMetadata(fileId);
        try (HttpResponse fileContent = client.beta().files().download(fileId)) {
            try (FileOutputStream fos = new FileOutputStream(fileMetadata.filename())) {
                fileContent.body().transferTo(fos);
            }
        }
        IO.println("Downloaded: " + fileMetadata.filename());
    }
}

List<String> extractFileIds(BetaMessage response) {
    List<String> fileIds = new ArrayList<>();
    // .ifPresent() 是判别器守卫（非具体类型；扫描器无法识别 lambda 守卫）
    for (BetaContentBlock item : response.content()) {
        item.bashCodeExecutionToolResult().ifPresent(toolResult -> {
            if (toolResult.content().isBetaBashCodeExecutionResultBlock()) {
                BetaBashCodeExecutionResultBlock result =
                    toolResult.content().asBetaBashCodeExecutionResultBlock();
                // 具体类型列表：BetaBashCodeExecutionOutputBlock
                for (BetaBashCodeExecutionOutputBlock output : result.content()) {
                    fileIds.add(output.fileId());
                }
            }
        });
    }
    return fileIds;
}
```

```php PHP hidelines={1..2,4..5} nocheck
<?php

use Anthropic\Beta\Messages\BetaMessage;
use Anthropic\Client;

$client = new Client();

$response = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [
        [
            'role' => 'user',
            'content' => 'Create a matplotlib visualization and save it as output.png',
        ],
    ],
    model: 'claude-opus-4-8',
    betas: ['files-api-2025-04-14'],
    tools: [
        [
            'type' => 'code_execution_20250825',
            'name' => 'code_execution',
        ],
    ],
);

function extractFileIds(BetaMessage $response): array
{
    $fileIds = [];
    foreach ($response->content as $item) {
        if ($item->type !== 'bash_code_execution_tool_result') {
            continue;
        }
        $contentItem = $item->content;
        if ($contentItem->type !== 'bash_code_execution_result') {
            continue;
        }
        // 具体类型列表：BashCodeExecutionOutputBlock
        foreach ($contentItem->content as $file) {
            $fileIds[] = $file->fileID;
        }
    }
    return $fileIds;
}

foreach (extractFileIds($response) as $fileId) {
    $fileMetadata = $client->beta->files->retrieveMetadata($fileId);
    $fileContent = $client->beta->files->download($fileId);

    file_put_contents($fileMetadata->filename, $fileContent);
    echo "Downloaded: {$fileMetadata->filename}\n";
}
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response = client.beta.messages.create(
  model: "claude-opus-4-8",
  betas: ["files-api-2025-04-14"],
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content: "Create a matplotlib visualization and save it as output.png"
    }
  ],
  tools: [
    {
      type: "code_execution_20250825",
      name: "code_execution"
    }
  ]
)

def extract_file_ids(response)
  file_ids = []
  response.content.each do |item|
    if item.type == :bash_code_execution_tool_result
      content_item = item.content
      if content_item.type == :bash_code_execution_result
        # 具体类型列表：BashCodeExecutionOutputBlock
        content_item.content.each do |file|
          file_ids << file.file_id
        end
      end
    end
  end
  file_ids
end

extract_file_ids(response).each do |file_id|
  file_metadata = client.beta.files.retrieve_metadata(file_id)
  file_content = client.beta.files.download(file_id)

  File.open(file_metadata.filename, "wb") do |f|
    f.write(file_content.read)
  end

  puts "Downloaded: #{file_metadata.filename}"
end
```
</CodeGroup>

## 工具定义 \{#tool-definition}

代码执行工具不需要额外的参数：

```json JSON
{
  "type": "code_execution_20250825",
  "name": "code_execution"
}
```

当提供此工具时，Claude 会自动获得两个子工具的访问权限：
- `bash_code_execution`：运行 shell 命令
- `text_editor_code_execution`：查看、创建和编辑文件，包括编写代码

## 响应格式 \{#response-format}

代码执行工具可以根据操作返回两种类型的结果：

### Bash 命令响应 \{#bash-command-response}

```json Output hidelines={1,-1}
[
  {
    "type": "server_tool_use",
    "id": "srvtoolu_01B3C4D5E6F7G8H9I0J1K2L3",
    "name": "bash_code_execution",
    "input": {
      "command": "ls -la | head -5"
    }
  },
  {
    "type": "bash_code_execution_tool_result",
    "tool_use_id": "srvtoolu_01B3C4D5E6F7G8H9I0J1K2L3",
    "content": {
      "type": "bash_code_execution_result",
      "stdout": "total 24\ndrwxr-xr-x 2 user user 4096 Jan 1 12:00 .\ndrwxr-xr-x 3 user user 4096 Jan 1 11:00 ..\n-rw-r--r-- 1 user user  220 Jan 1 12:00 data.csv\n-rw-r--r-- 1 user user  180 Jan 1 12:00 config.json",
      "stderr": "",
      "return_code": 0
    }
  }
]
```

### 文件操作响应 \{#file-operation-responses}

**查看文件：**
```json Output hidelines={1,-1}
[
  {
    "type": "server_tool_use",
    "id": "srvtoolu_01C4D5E6F7G8H9I0J1K2L3M4",
    "name": "text_editor_code_execution",
    "input": {
      "command": "view",
      "path": "config.json"
    }
  },
  {
    "type": "text_editor_code_execution_tool_result",
    "tool_use_id": "srvtoolu_01C4D5E6F7G8H9I0J1K2L3M4",
    "content": {
      "type": "text_editor_code_execution_result",
      "file_type": "text",
      "content": "{\n  \"setting\": \"value\",\n  \"debug\": true\n}",
      "numLines": 4,
      "startLine": 1,
      "totalLines": 4
    }
  }
]
```

**创建文件：**
```json Output hidelines={1,-1}
[
  {
    "type": "server_tool_use",
    "id": "srvtoolu_01D5E6F7G8H9I0J1K2L3M4N5",
    "name": "text_editor_code_execution",
    "input": {
      "command": "create",
      "path": "new_file.txt",
      "file_text": "Hello, World!"
    }
  },
  {
    "type": "text_editor_code_execution_tool_result",
    "tool_use_id": "srvtoolu_01D5E6F7G8H9I0J1K2L3M4N5",
    "content": {
      "type": "text_editor_code_execution_result",
      "is_file_update": false
    }
  }
]
```

**编辑文件（str_replace）：**
```json Output hidelines={1,-1}
[
  {
    "type": "server_tool_use",
    "id": "srvtoolu_01E6F7G8H9I0J1K2L3M4N5O6",
    "name": "text_editor_code_execution",
    "input": {
      "command": "str_replace",
      "path": "config.json",
      "old_str": "\"debug\": true",
      "new_str": "\"debug\": false"
    }
  },
  {
    "type": "text_editor_code_execution_tool_result",
    "tool_use_id": "srvtoolu_01E6F7G8H9I0J1K2L3M4N5O6",
    "content": {
      "type": "text_editor_code_execution_result",
      "oldStart": 3,
      "oldLines": 1,
      "newStart": 3,
      "newLines": 1,
      "lines": ["-  \"debug\": true", "+  \"debug\": false"]
    }
  }
]
```

### 结果 \{#results}

所有执行结果都包括：
- `stdout`：成功执行的输出
- `stderr`：执行失败时的错误消息
- `return_code`：0 表示成功，非零表示失败

文件操作的附加字段：
- **查看**：`file_type`、`content`、`numLines`、`startLine`、`totalLines`
- **创建**：`is_file_update`（文件是否已存在）
- **编辑**：`oldStart`、`oldLines`、`newStart`、`newLines`、`lines`（diff 格式）

### 错误 \{#errors}

每种工具类型都可能返回特定的错误：

**通用错误（所有工具）：**
```json Output
{
  "type": "bash_code_execution_tool_result",
  "tool_use_id": "srvtoolu_01VfmxgZ46TiHbmXgy928hQR",
  "content": {
    "type": "bash_code_execution_tool_result_error",
    "error_code": "unavailable"
  }
}
```

**按工具类型划分的错误代码：**

| 工具 | 错误代码 | 描述 |
|------|-----------|-------------|
| 所有工具 | `unavailable` | 工具暂时不可用 |
| 所有工具 | `execution_time_exceeded` | 执行超过最大时间限制 |
| 所有工具 | `container_expired` | 容器已过期，不再可用 |
| 所有工具 | `invalid_tool_input` | 提供给工具的参数无效 |
| 所有工具 | `too_many_requests` | 超出工具使用的速率限制 |
| bash | `output_file_too_large` | 命令输出超过最大大小 |
| text_editor | `file_not_found` | 文件不存在（用于查看/编辑操作） |
| text_editor | `string_not_found` | 在文件中未找到 `old_str`（用于 str_replace） |

#### `pause_turn` 停止原因 \{#pause-turn-stop-reason}

响应可能包含 `pause_turn` 停止原因，这表示 API 暂停了一个长时间运行的回合。您可以在后续请求中按原样提供该响应，让 Claude 继续其回合；如果您希望中断对话，也可以修改内容。

## 容器 \{#containers}

代码执行工具在专为代码执行设计的安全容器化环境中运行，重点支持 Python。

### 运行时环境 \{#runtime-environment}
- **Python 版本**：3.11.12
- **操作系统**：基于 Linux 的容器
- **架构**：x86_64（AMD64）

### 资源限制 \{#resource-limits}
- **内存**：5GiB RAM
- **磁盘空间**：5GiB 工作区存储
- **CPU**：1 个 CPU

### 网络和安全 \{#networking-and-security}
- **互联网访问**：出于安全考虑完全禁用
- **外部连接**：不允许出站网络请求
- **沙盒隔离**：与主机系统和其他容器完全隔离
- **文件访问**：仅限于工作区目录
- **工作区范围**：与 [Files](/docs/zh-CN/build-with-claude/files) 类似，容器的范围限定于 API 密钥所属的工作区
- **过期时间**：容器在创建后 30 天过期

### 预装库 \{#pre-installed-libraries}
沙盒 Python 环境包含以下常用库：
- **数据科学**：pandas、numpy、scipy、scikit-learn、statsmodels
- **可视化**：matplotlib、seaborn
- **文件处理**：pyarrow、openpyxl、xlsxwriter、xlrd、pillow、python-pptx、python-docx、pypdf、pdfplumber、pypdfium2、pdf2image、pdfkit、tabula-py、reportlab[pycairo]、Img2pdf
- **数学与计算**：sympy、mpmath
- **实用工具**：tqdm、python-dateutil、pytz、joblib、unzip、unrar、7zip、bc、rg（ripgrep）、fd、sqlite

## 容器复用 \{#container-reuse}

您可以通过提供先前响应中的容器 ID，在多个 API 请求之间复用现有容器。这使您可以在请求之间保留已创建的文件。

### 示例 \{#example}

<CodeGroup>
```bash cURL hidelines={1}
cd "$(mktemp -d)"
# 第一个请求：创建一个包含随机数的文件
curl https://api.anthropic.com/v1/messages \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "anthropic-version: 2023-06-01" \
    --header "content-type: application/json" \
    --data '{
        "model": "claude-opus-4-8",
        "max_tokens": 4096,
        "messages": [{
            "role": "user",
            "content": "Write a file with a random number and save it to \"/tmp/number.txt\""
        }],
        "tools": [{
            "type": "code_execution_20250825",
            "name": "code_execution"
        }]
    }' > response1.json

# 从响应中提取容器 ID（使用 jq）
CONTAINER_ID=$(jq -r '.container.id' response1.json)

# 第二个请求：复用该容器以读取文件
curl https://api.anthropic.com/v1/messages \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "anthropic-version: 2023-06-01" \
    --header "content-type: application/json" \
    --data '{
        "container": "'$CONTAINER_ID'",
        "model": "claude-opus-4-8",
        "max_tokens": 4096,
        "messages": [{
            "role": "user",
            "content": "Read the number from \"/tmp/number.txt\" and calculate its square"
        }],
        "tools": [{
            "type": "code_execution_20250825",
            "name": "code_execution"
        }]
    }'
```

```bash CLI
# 第一个请求：创建一个包含随机数的文件
CONTAINER_ID=$(ant messages create \
  --transform container.id --raw-output \
    --model claude-opus-4-8 \
    --max-tokens 4096 \
    --message '{role: user, content: Write a file with a random number and save it to "/tmp/number.txt"}' \
    --tool '{type: code_execution_20250825, name: code_execution}'
)

# 第二个请求：复用该容器来读取文件
ant messages create --container "$CONTAINER_ID" \
  --model claude-opus-4-8 \
  --max-tokens 4096 \
  --message '{role: user, content: Read the number from "/tmp/number.txt" and calculate its square}' \
  --tool '{type: code_execution_20250825, name: code_execution}'
```

```python Python hidelines={1..6}
import os
from anthropic import Anthropic

# 初始化客户端
client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# 第一个请求：创建一个包含随机数的文件
response1 = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": "Write a file with a random number and save it to '/tmp/number.txt'",
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)

# 从第一个响应中提取容器 ID
container_id = response1.container.id

# 第二个请求：复用该容器以读取文件
response2 = client.messages.create(
    container=container_id,  # Reuse the same container
    model="claude-opus-4-8",
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": "Read the number from '/tmp/number.txt' and calculate its square",
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)

print(response2)
```

```typescript TypeScript hidelines={1..5,-3..-1}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function main() {
  // 第一个请求：创建一个包含随机数的文件
  const response1 = await client.beta.messages.create({
    model: "claude-opus-4-8",
    betas: ["code-execution-2025-08-25"],
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: "Write a file with a random number and save it to '/tmp/number.txt'"
      }
    ],
    tools: [
      {
        type: "code_execution_20250825",
        name: "code_execution"
      }
    ]
  });

  // 从第一个响应中提取容器 ID
  const containerId = response1.container!.id;

  // 第二个请求：复用该容器以读取文件
  const response2 = await client.beta.messages.create({
    container: containerId,
    model: "claude-opus-4-8",
    betas: ["code-execution-2025-08-25"],
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: "Read the number from '/tmp/number.txt' and calculate its square"
      }
    ],
    tools: [
      {
        type: "code_execution_20250825",
        name: "code_execution"
      }
    ]
  });

  console.log(response2.content);
}

main().catch(console.error);
```

```csharp C# hidelines={1..11,-2..}
using Anthropic;
using Anthropic.Models.Messages;
using System;
using System.Threading.Tasks;

class Program
{
    static async Task Main()
    {
        AnthropicClient client = new();

        var parameters1 = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 4096,
            Messages = [new() { Role = Role.User, Content = "Write a file with a random number and save it to '/tmp/number.txt'" }],
            Tools = [new ToolUnion(new CodeExecutionTool20250825())]
        };

        var response1 = await client.Messages.Create(parameters1);
        var containerId = response1.Container!.ID;

        var parameters2 = new MessageCreateParams
        {
            Container = containerId,
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 4096,
            Messages = [new() { Role = Role.User, Content = "Read the number from '/tmp/number.txt' and calculate its square" }],
            Tools = [new ToolUnion(new CodeExecutionTool20250825())]
        };

        var response2 = await client.Messages.Create(parameters2);
        Console.WriteLine(response2);
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

	response1, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 4096,
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Write a file with a random number and save it to '/tmp/number.txt'")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
		Betas: []anthropic.AnthropicBeta{"code-execution-2025-08-25"},
	})
	if err != nil {
		log.Fatal(err)
	}

	containerID := response1.Container.ID

	response2, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfString: anthropic.String(containerID),
		},
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 4096,
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Read the number from '/tmp/number.txt' and calculate its square")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
		Betas: []anthropic.AnthropicBeta{"code-execution-2025-08-25"},
	})
	if err != nil {
		log.Fatal(err)
	}

	for _, block := range response2.Content {
		if block.Type == "text" {
			fmt.Println(block.Text)
		}
	}
}
```

```java Java hidelines={1..5,7..9,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.CodeExecutionTool20250825;

public class ContainerReuse {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params1 = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(4096L)
            .addUserMessage("Write a file with a random number and save it to '/tmp/number.txt'")
            .addTool(CodeExecutionTool20250825.builder().build())
            .build();

        Message response1 = client.messages().create(params1);
        String containerId = response1.container().get().id();

        MessageCreateParams params2 = MessageCreateParams.builder()
            .container(containerId)
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(4096L)
            .addUserMessage("Read the number from '/tmp/number.txt' and calculate its square")
            .addTool(CodeExecutionTool20250825.builder().build())
            .build();

        Message response2 = client.messages().create(params2);
        System.out.println(response2);
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$response1 = $client->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => "Write a file with a random number and save it to '/tmp/number.txt'"]
    ],
    model: 'claude-opus-4-8',
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution']
    ],
);

$containerId = $response1->container->id;

$response2 = $client->messages->create(
    container: $containerId,
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => "Read the number from '/tmp/number.txt' and calculate its square"]
    ],
    model: 'claude-opus-4-8',
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution']
    ],
);
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response1 = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  messages: [
    { role: "user", content: "Write a file with a random number and save it to '/tmp/number.txt'" }
  ],
  tools: [
    { type: "code_execution_20250825", name: "code_execution" }
  ]
)

container_id = response1.container.id

response2 = client.messages.create(
  container: container_id,
  model: "claude-opus-4-8",
  max_tokens: 4096,
  messages: [
    { role: "user", content: "Read the number from '/tmp/number.txt' and calculate its square" }
  ],
  tools: [
    { type: "code_execution_20250825", name: "code_execution" }
  ]
)

puts response2.content
```
</CodeGroup>

## 流式传输 \{#streaming}

启用流式传输后，您将在代码执行事件发生时实时接收它们：

```sse
event: content_block_start
data: {"type": "content_block_start", "index": 1, "content_block": {"type": "server_tool_use", "id": "srvtoolu_xyz789", "name": "code_execution"}}

// Code execution streamed
event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"code\":\"import pandas as pd\\ndf = pd.read_csv('data.csv')\\nprint(df.head())\"}"}}

// Pause while code executes

// Execution results streamed
event: content_block_start
data: {"type": "content_block_start", "index": 2, "content_block": {"type": "code_execution_tool_result", "tool_use_id": "srvtoolu_xyz789", "content": {"stdout": "   A  B  C\n0  1  2  3\n1  4  5  6", "stderr": ""}}}
```

## 批量请求 \{#batch-requests}

您可以在 [Messages Batches API](/docs/zh-CN/build-with-claude/batch-processing) 中包含代码执行工具。通过 Messages Batches API 进行的代码执行工具调用的定价与常规 Messages API 请求中的定价相同。

## 使用量和定价 \{#usage-and-pricing}

**与网页搜索或网页抓取一起使用时，代码执行免费。** 当您的 API 请求中包含 `web_search_20260209` 或 `web_fetch_20260209` 时，除标准输入和输出令牌费用外，代码执行工具调用不会产生额外费用。

在不与这些工具一起使用时，代码执行按执行时间计费，与令牌使用量分开计算：

- 执行时间最少按 5 分钟计算
- 每个组织每月可获得 **1,550 小时免费**使用时长
- 超出 1,550 小时的额外使用量按**每个容器每小时 0.05 美元**计费
- 如果请求中包含文件，即使未调用该工具，也会按执行时间计费，因为文件会被预加载到容器中

代码执行使用情况会在响应中进行跟踪：

```json
{
  "usage": {
    "input_tokens": 105,
    "output_tokens": 239,
    "server_tool_use": {
      "code_execution_requests": 1
    }
  }
}
```

## 升级到最新工具版本 \{#upgrade-to-latest-tool-version}

通过升级到 `code-execution-2025-08-25`，您可以获得文件操作和 Bash 功能，包括使用多种语言编写代码。价格没有差异。

### 变更内容 \{#whats-changed}

| 组件 | 旧版 | 当前版本 |
|-----------|------------------|----------------------------|
| Beta 标头 | `code-execution-2025-05-22` | `code-execution-2025-08-25` |
| 工具类型 | `code_execution_20250522` | `code_execution_20250825` |
| 功能 | 仅 Python | Bash 命令、文件操作 |
| 响应类型 | `code_execution_result` | `bash_code_execution_result`、`text_editor_code_execution_result` |

### 向后兼容性 \{#backward-compatibility}

- 所有现有的 Python 代码执行将继续完全按照以前的方式工作
- 现有的仅 Python 工作流无需任何更改

### 升级步骤 \{#upgrade-steps}

要升级，请更新 API 请求中的工具类型：

```diff
- "type": "code_execution_20250522"
+ "type": "code_execution_20250825"
```

**检查响应处理**（如果以编程方式解析响应）：
- 之前用于 Python 执行响应的块将不再发送
- 取而代之的是，将发送用于 Bash 和文件操作的新响应类型（请参阅"响应格式"部分）

## 编程式工具调用 \{#programmatic-tool-calling}

有关在代码执行容器内运行工具的信息，请参阅[编程式工具调用](/docs/zh-CN/agents-and-tools/tool-use/programmatic-tool-calling)。

## 数据保留 \{#data-retention}

代码执行在服务器端沙盒容器中运行。容器数据（包括执行产物、上传的文件和输出）最多保留 30 天。此保留策略适用于容器环境中处理的所有数据。代码执行在 [Files API](/docs/zh-CN/build-with-claude/files) 中创建的文件（可通过 `client.beta.files.download()` 检索）将持续保留，直到被明确删除。

有关所有功能的 ZDR 资格，请参阅 [API 和数据保留](/docs/zh-CN/manage-claude/api-and-data-retention)。

## 将代码执行与 Agent Skills 一起使用 \{#using-code-execution-with-agent-skills}

代码执行工具使 Claude 能够使用 [Agent Skills](/docs/zh-CN/agents-and-tools/agent-skills/overview)。Skills（技能）是由指令、脚本和资源组成的模块化能力，用于扩展 Claude 的功能。

在 [Agent Skills](/docs/zh-CN/agents-and-tools/agent-skills/overview) 和[通过 API 使用 Agent Skills](/docs/zh-CN/build-with-claude/skills-guide) 中了解更多信息。