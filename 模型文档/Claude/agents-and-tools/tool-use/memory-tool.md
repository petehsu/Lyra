# 记忆工具

---

记忆工具使 Claude 能够通过记忆文件目录跨对话存储和检索信息。Claude 可以创建、读取、更新和删除在会话之间持久保存的文件，从而随着时间推移积累知识，而无需将所有内容保留在上下文窗口中。

这是即时上下文检索（just-in-time context retrieval）的关键原语：智能体无需预先加载所有相关信息，而是将所学内容存储在记忆中，并按需调取。这使活跃上下文始终聚焦于当前相关的内容，对于长时间运行的工作流至关重要——在这类工作流中，一次性加载所有内容会使上下文窗口不堪重负。有关更广泛的模式，请参阅 [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（有效的上下文工程）。

记忆工具在客户端运行：您可以通过自己的基础设施控制数据的存储位置和方式。

<Note>
请通过[反馈表单](https://forms.gle/YXC2EKGMhjN1c4L88)与我们分享您对此功能的反馈。
</Note>

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

## 使用场景 \{#use-cases}

- 在多次智能体执行之间维护项目上下文
- 从过去的交互、决策和反馈中学习
- 随时间推移构建知识库
- 实现跨对话学习，使 Claude 在处理重复性工作流时不断改进

## 工作原理 \{#how-it-works}

启用后，Claude 会在开始任务之前自动检查其记忆目录。Claude 可以在 `/memories` 目录中创建、读取、更新和删除文件，以存储工作过程中学到的内容，然后在未来的对话中引用这些记忆，从而更有效地处理类似任务或从上次中断的地方继续。

由于这是一个客户端工具，Claude 会发起工具调用来执行记忆操作，而您的应用程序在本地执行这些操作。这使您可以完全控制记忆的存储位置和方式。出于安全考虑，您应将所有记忆操作限制在 `/memories` 目录内。

### 示例：记忆工具调用的工作方式 \{#example-how-memory-tool-calls-work}

当您请求 Claude 帮助完成某项任务时，Claude 会首先自动检查其记忆目录。以下是一个典型交互的示例：

**1. 用户请求：**
```text
"Help me respond to this customer service ticket."
```

**2. Claude 检查记忆目录：**
```text
"I'll help you respond to the customer service ticket. Let me check my memory for any previous context."
```

Claude 调用记忆工具：
```json
{
  "type": "tool_use",
  "id": "toolu_01C4D5E6F7G8H9I0J1K2L3M4",
  "name": "memory",
  "input": {
    "command": "view",
    "path": "/memories"
  }
}
```

**3. 您的应用程序返回目录内容：**
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01C4D5E6F7G8H9I0J1K2L3M4",
  "content": "Here're the files and directories up to 2 levels deep in /memories, excluding hidden items and node_modules:\n4.0K\t/memories\n1.5K\t/memories/customer_service_guidelines.xml\n2.0K\t/memories/refund_policies.xml"
}
```

**4. Claude 读取相关文件：**
```json
{
  "type": "tool_use",
  "id": "toolu_01D5E6F7G8H9I0J1K2L3M4N5",
  "name": "memory",
  "input": {
    "command": "view",
    "path": "/memories/customer_service_guidelines.xml"
  }
}
```

**5. 您的应用程序返回文件内容：**
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01D5E6F7G8H9I0J1K2L3M4N5",
  "content": "Here's the content of /memories/customer_service_guidelines.xml with line numbers:\n     1\t<guidelines>\n     2\t<addressing_customers>\n     3\t- Always address customers by their first name\n     4\t- Use empathetic language\n..."
}
```

**6. Claude 利用记忆提供帮助：**
```text
"Based on your customer service guidelines, I can help you craft a response. Please share the ticket details..."
```

有关模型支持情况，请参阅[工具参考](/docs/zh-CN/agents-and-tools/tool-use/tool-reference)。

## 快速入门 \{#getting-started}

要使用记忆工具：

1. 将记忆工具添加到您的请求中
2. 为记忆操作实现客户端处理程序

<Note>
要在您的应用程序中处理记忆工具操作，您需要为每个记忆命令实现处理程序。SDK 提供了处理工具接口的记忆工具辅助类。您可以继承 `BetaAbstractMemoryTool`（Python 和 C#）、使用 `betaMemoryTool`（TypeScript）或实现 `BetaMemoryToolHandler`（Java）来实现您自己的记忆后端（基于文件、数据库、云存储、加密文件等）。

有关可运行的示例，请参阅：
- Python：[examples/memory/basic.py](https://github.com/anthropics/anthropic-sdk-python/blob/main/examples/memory/basic.py)
- TypeScript：[examples/tools-helpers-memory.ts](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/examples/tools-helpers-memory.ts)
- Java：[BetaMemoryToolExample.java](https://github.com/anthropics/anthropic-sdk-java/blob/main/anthropic-java-example/src/main/java/com/anthropic/example/BetaMemoryToolExample.java)
- C#：[MemoryToolExample](https://github.com/anthropics/anthropic-sdk-csharp/tree/main/examples/MemoryToolExample)
</Note>

## 基本用法 \{#basic-usage}

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "anthropic-version: 2023-06-01" \
    --header "content-type: application/json" \
    --data '{
        "model": "claude-opus-4-8",
        "max_tokens": 2048,
        "messages": [
            {
                "role": "user",
                "content": "I'\''m working on a Python web scraper that keeps crashing with a timeout error. Here'\''s the problematic function:\n\n```python\ndef fetch_page(url, retries=3):\n    for i in range(retries):\n        try:\n            response = requests.get(url, timeout=5)\n            return response.text\n        except requests.exceptions.Timeout:\n            if i == retries - 1:\n                raise\n            time.sleep(1)\n```\n\nPlease help me debug this."
            }
        ],
        "tools": [{
            "type": "memory_20250818",
            "name": "memory"
        }]
    }'
```

````bash CLI
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 2048
tools:
  - type: memory_20250818
    name: memory
messages:
  - role: user
    content: |
      I'm working on a Python web scraper that keeps crashing with a
      timeout error. Here's the problematic function:

      ```python
      def fetch_page(url, retries=3):
          for i in range(retries):
              try:
                  response = requests.get(url, timeout=5)
                  return response.text
              except requests.exceptions.Timeout:
                  if i == retries - 1:
                      raise
                  time.sleep(1)
      ```

      Please help me debug this.
YAML
````

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

message = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=2048,
    messages=[
        {
            "role": "user",
            "content": "I'm working on a Python web scraper that keeps crashing with a timeout error. Here's the problematic function:\n\n```python\ndef fetch_page(url, retries=3):\n    for i in range(retries):\n        try:\n            response = requests.get(url, timeout=5)\n            return response.text\n        except requests.exceptions.Timeout:\n            if i == retries - 1:\n                raise\n            time.sleep(1)\n```\n\nPlease help me debug this.",
        }
    ],
    tools=[{"type": "memory_20250818", "name": "memory"}],
)

print(message)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

const message = await anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 2048,
  messages: [
    {
      role: "user",
      content:
        "I'm working on a Python web scraper that keeps crashing with a timeout error. Here's the problematic function:\n\n```python\ndef fetch_page(url, retries=3):\n    for i in range(retries):\n        try:\n            response = requests.get(url, timeout=5)\n            return response.text\n        except requests.exceptions.Timeout:\n            if i == retries - 1:\n                raise\n            time.sleep(1)\n```\n\nPlease help me debug this."
    }
  ],
  tools: [{ type: "memory_20250818", name: "memory" }]
});

console.log(message);
```

```csharp C#
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

public class Program
{
    public static async Task Main(string[] args)
    {
        AnthropicClient client = new()
        {
            ApiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY")
        };

        var parameters = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 2048,
            Messages = [
                new()
                {
                    Role = Role.User,
                    Content = "I'm working on a Python web scraper that keeps crashing with a timeout error. Here's the problematic function:\n\n```python\ndef fetch_page(url, retries=3):\n    for i in range(retries):\n        try:\n            response = requests.get(url, timeout=5)\n            return response.text\n        except requests.exceptions.Timeout:\n            if i == retries - 1:\n                raise\n            time.sleep(1)\n```\n\nPlease help me debug this."
                }
            ],
            Tools = [new ToolUnion(new MemoryTool20250818())]
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
		MaxTokens: 2048,
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("I'm working on a Python web scraper that keeps crashing with a timeout error. Here's the problematic function:\n\n```python\ndef fetch_page(url, retries=3):\n    for i in range(retries):\n        try:\n            response = requests.get(url, timeout=5)\n            return response.text\n        except requests.exceptions.Timeout:\n            if i == retries - 1:\n                raise\n            time.sleep(1)\n```\n\nPlease help me debug this.")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfMemoryTool20250818: &anthropic.BetaMemoryTool20250818Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..2,4..9,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MemoryTool20250818;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;

public class MemoryToolExample {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(2048L)
            .addUserMessage("I'm working on a Python web scraper that keeps crashing with a timeout error. Here's the problematic function:\n\n```python\ndef fetch_page(url, retries=3):\n    for i in range(retries):\n        try:\n            response = requests.get(url, timeout=5)\n            return response.text\n        except requests.exceptions.Timeout:\n            if i == retries - 1:\n                raise\n            time.sleep(1)\n```\n\nPlease help me debug this.")
            .addTool(MemoryTool20250818.builder().build())
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
    maxTokens: 2048,
    messages: [
        [
            'role' => 'user',
            'content' => "I'm working on a Python web scraper that keeps crashing with a timeout error. Here's the problematic function:\n\n```python\ndef fetch_page(url, retries=3):\n    for i in range(retries):\n        try:\n            response = requests.get(url, timeout=5)\n            return response.text\n        except requests.exceptions.Timeout:\n            if i == retries - 1:\n                raise\n            time.sleep(1)\n```\n\nPlease help me debug this.",
        ],
    ],
    model: 'claude-opus-4-8',
    tools: [
        [
            'type' => 'memory_20250818',
            'name' => 'memory',
        ],
    ],
);
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 2048,
  messages: [
    {
      role: "user",
      content: "I'm working on a Python web scraper that keeps crashing with a timeout error. Here's the problematic function:\n\n```python\ndef fetch_page(url, retries=3):\n    for i in range(retries):\n        try:\n            response = requests.get(url, timeout=5)\n            return response.text\n        except requests.exceptions.Timeout:\n            if i == retries - 1:\n                raise\n            time.sleep(1)\n```\n\nPlease help me debug this."
    }
  ],
  tools: [
    {
      type: "memory_20250818",
      name: "memory"
    }
  ]
)
puts message
```

</CodeGroup>

## 工具命令 \{#tool-commands}

您的客户端实现需要处理以下记忆工具命令。虽然这些规范描述了 Claude 最熟悉的推荐行为，但您可以根据自己的使用场景修改实现并按需返回字符串。

### view \{#view}
显示目录内容或文件内容，可选择指定行范围：

```json
{
  "command": "view",
  "path": "/memories",
  "view_range": [1, 10] // Optional: view specific lines
}
```

#### 返回值 \{#return-values}

**对于目录：** 返回一个列表，显示文件和目录及其大小：
```text nowrap
Here're the files and directories up to 2 levels deep in {path}, excluding hidden items and node_modules:
{size}    {path}
{size}    {path}/{filename1}
{size}    {path}/{filename2}
```

- 列出最多 2 层深度的文件
- 显示人类可读的大小（例如 `5.5K`、`1.2M`）
- 排除隐藏项（以 `.` 开头的文件）和 `node_modules`
- 在大小和路径之间使用制表符

**对于文件：** 返回带有标题和行号的文件内容：
```text
Here's the content of {path} with line numbers:
{line_numbers}{tab}{content}
```

行号格式：
- **宽度**：6 个字符，右对齐，使用空格填充
- **分隔符**：行号和内容之间使用制表符
- **索引**：从 1 开始（第一行为第 1 行）
- **行数限制**：超过 999,999 行的文件应返回错误：`"File {path} exceeds maximum line limit of 999,999 lines."`

**示例输出：**
```text nowrap
Here's the content of /memories/notes.txt with line numbers:
     1	Hello World
     2	This is line two
    10	Line ten
   100	Line one hundred
```

#### 错误处理 \{#error-handling}

- **文件/目录不存在**：`"The path {path} does not exist. Please provide a valid path."`

### create \{#create}
创建新文件：

```json
{
  "command": "create",
  "path": "/memories/notes.txt",
  "file_text": "Meeting notes:\n- Discussed project timeline\n- Next steps defined\n"
}
```

#### 返回值 \{#return-values-2}

- **成功**：`"File created successfully at: {path}"`

#### 错误处理 \{#error-handling-2}

- **文件已存在**：`"Error: File {path} already exists"`

### str_replace \{#str-replace}
替换文件中的文本：

```json
{
  "command": "str_replace",
  "path": "/memories/preferences.txt",
  "old_str": "Favorite color: blue",
  "new_str": "Favorite color: green"
}
```

#### 返回值 \{#return-values-3}

- **成功**：`"The memory file has been edited."`，后跟带行号的已编辑文件片段

#### 错误处理 \{#error-handling-3}

- **文件不存在**：`"Error: The path {path} does not exist. Please provide a valid path."`
- **未找到文本**：``"No replacement was performed, old_str `{old_str}` did not appear verbatim in {path}."``
- **文本重复**：当 `old_str` 出现多次时，返回：``"No replacement was performed. Multiple occurrences of old_str `{old_str}` in lines: {line_numbers}. Please ensure it is unique"``

#### 目录处理 \{#directory-handling}

如果路径是目录，则返回"文件不存在"错误。

### insert \{#insert}
在特定行插入文本：

```json
{
  "command": "insert",
  "path": "/memories/todo.txt",
  "insert_line": 2,
  "insert_text": "- Review memory tool documentation\n"
}
```

#### 返回值 \{#return-values-4}

- **成功**：`"The file {path} has been edited."`

#### 错误处理 \{#error-handling-4}

- **文件不存在**：`"Error: The path {path} does not exist"`
- **无效行号**：``"Error: Invalid `insert_line` parameter: {insert_line}. It should be within the range of lines of the file: [0, {n_lines}]"``

#### 目录处理 \{#directory-handling-2}

如果路径是目录，则返回"文件不存在"错误。

### delete \{#delete}
删除文件或目录：

```json
{
  "command": "delete",
  "path": "/memories/old_file.txt"
}
```

#### 返回值 \{#return-values-5}

- **成功**：`"Successfully deleted {path}"`

#### 错误处理 \{#error-handling-5}

- **文件/目录不存在**：`"Error: The path {path} does not exist"`

#### 目录处理 \{#directory-handling-3}

递归删除目录及其所有内容。

### rename \{#rename}
重命名或移动文件/目录：

```json
{
  "command": "rename",
  "old_path": "/memories/draft.txt",
  "new_path": "/memories/final.txt"
}
```

#### 返回值 \{#return-values-6}

- **成功**：`"Successfully renamed {old_path} to {new_path}"`

#### 错误处理 \{#error-handling-6}

- **源路径不存在**：`"Error: The path {old_path} does not exist"`
- **目标路径已存在**：返回错误（不覆盖）：`"Error: The destination {new_path} already exists"`

#### 目录处理 \{#directory-handling-4}

重命名目录。

## 提示指导 \{#prompting-guidance}

启用记忆工具后，以下指令会自动包含在系统提示中：

```text
IMPORTANT: ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE.
MEMORY PROTOCOL:
1. Use the `view` command of your `memory` tool to check for earlier progress.
2. ... (work on the task) ...
     - As you make progress, record status / progress / thoughts etc in your memory.
ASSUME INTERRUPTION: Your context window might be reset at any moment, so you risk losing any progress that is not recorded in your memory directory.
```

如果您发现 Claude 创建的记忆文件杂乱无章，可以包含以下指令：

> 注意：在编辑您的记忆文件夹时，请始终尽量保持其内容最新、连贯且有条理。您可以重命名或删除不再相关的文件。除非必要，否则不要创建新文件。

您还可以引导 Claude 写入记忆的内容。例如："仅在您的记忆系统中记录与 \<topic\> 相关的信息。"

## 安全注意事项 \{#security-considerations}

以下是实现记忆存储时需要关注的重要安全问题：

### 敏感信息 \{#sensitive-information}
Claude 通常会拒绝在记忆文件中记录敏感信息。但是，您可能希望实现更严格的验证，以剥离潜在的敏感信息。

### 文件存储大小 \{#file-storage-size}
考虑跟踪记忆文件的大小，并防止文件变得过大。考虑为记忆读取命令可返回的字符数设置上限，并让 Claude 分页浏览内容。

### 记忆过期 \{#memory-expiration}
考虑定期清理长时间未被访问的记忆文件。

### 路径遍历防护 \{#path-traversal-protection}

<Warning>
恶意的路径输入可能会尝试访问 `/memories` 目录之外的文件。您的实现**必须**验证所有路径，以防止目录遍历攻击。
</Warning>

请考虑以下防护措施：

- 验证所有路径均以 `/memories` 开头
- 将路径解析为其规范形式，并验证它们仍位于记忆目录内
- 拒绝包含 `../`、`..\\` 等序列或其他遍历模式的路径
- 注意 URL 编码的遍历序列（`%2e%2e%2f`）
- 使用您所用语言的内置路径安全工具（例如 Python 的 `pathlib.Path.resolve()` 和 `relative_to()`）

## 错误处理 \{#error-handling-7}

记忆工具使用与[文本编辑器工具](/docs/zh-CN/agents-and-tools/tool-use/text-editor-tool#handle-errors)类似的错误处理模式。有关详细的错误消息和行为，请参阅上文各工具命令部分。常见错误包括文件未找到、权限错误、无效路径和重复文本匹配。

## 上下文编辑集成 \{#context-editing-integration}

记忆工具可与上下文编辑配合使用，以管理长时间运行的对话。有关详细信息，请参阅[上下文编辑](/docs/zh-CN/build-with-claude/context-editing)。

## 与压缩功能配合使用 \{#using-with-compaction}

记忆工具还可以与[压缩](/docs/zh-CN/build-with-claude/compaction)（compaction）功能配合使用，后者提供对较早对话上下文的服务器端摘要。上下文编辑在客户端清除特定的工具结果，而压缩则在对话接近上下文窗口限制时，在服务器端自动对整个对话进行摘要。

对于长时间运行的智能体工作流，可以考虑同时使用两者：压缩功能无需客户端记账即可保持活跃上下文的可管理性，而记忆功能则在压缩边界之间持久保存重要信息，确保摘要过程中不会丢失任何关键内容。

## 多会话软件开发模式 \{#multi-session-software-development-pattern}

对于跨越多个智能体会话的长期软件项目，记忆文件需要经过有意识的初始化引导，而不是仅在工作进行时临时写入。下面的模式将记忆转变为一种结构化的恢复机制，使每个新会话都能准确地从上一个会话停止的地方继续。

### 工作原理 \{#how-it-works-2}

1. **初始化会话：** 第一个会话在任何实质性工作开始之前设置记忆工件。这包括进度日志（跟踪已完成的工作和接下来的任务）、功能清单（定义工作范围），以及对项目所需的任何启动或初始化脚本的引用。

2. **后续会话：** 每个新会话开始时都会读取这些记忆工件。这可以在几秒钟内恢复项目的完整状态，而无需重新探索代码库或回溯早期的决策。

3. **会话结束时更新：** 在会话结束之前，更新进度日志，记录已完成的内容和剩余的工作。这确保下一个会话有一个准确的起点。

### 关键原则 \{#key-principle}

一次只处理一个功能。只有在端到端验证确认功能正常工作后才将其标记为完成，而不是仅在代码编写完成后就标记。这可以保持进度日志的可信度，并防止范围蔓延在多个会话之间累积。

<Tip>
有关此模式在实践中的详细案例研究，包括初始化脚本、进度文件结构和基于 git 的恢复，请参阅 [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)（长时间运行智能体的有效框架）。
</Tip>

## 后续步骤 \{#next-steps}

<CardGroup>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/tool-reference" title="查看所有工具">
    Anthropic 提供的工具及其属性目录。
  </Card>
  <Card href="/docs/zh-CN/build-with-claude/context-editing" title="上下文编辑">
    在使用记忆的同时管理对话长度。
  </Card>
</CardGroup>