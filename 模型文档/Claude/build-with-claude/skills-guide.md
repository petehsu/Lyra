# 通过 API 使用 Agent Skills

了解如何通过 API 使用 Agent Skills 来扩展 Claude 的能力。

---

Agent Skills 通过包含指令、脚本和资源的有组织文件夹来扩展 Claude 的能力。本指南将向您展示如何通过 Claude API 使用预构建的和自定义的 Skills。

<Note>
如需完整的 API 参考（包括请求/响应架构和所有参数），请参阅：
- [Skill 管理 API 参考](/docs/zh-CN/api/skills/list-skills) - Skills 的 CRUD 操作
- [Skill 版本 API 参考](/docs/zh-CN/api/skills/list-skill-versions) - 版本管理
</Note>

<Note>
此功能**不**符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。数据将根据该功能的标准保留策略进行保留。
</Note>

## 快速链接 \{#quick-links}

<CardGroup cols={2}>
  <Card
    title="Agent Skills 入门"
    icon="rocket"
    href="/docs/zh-CN/agents-and-tools/agent-skills/quickstart"
  >
    创建您的第一个 Skill
  </Card>
  <Card
    title="创建自定义 Skills"
    icon="hammer"
    href="/docs/zh-CN/agents-and-tools/agent-skills/best-practices"
  >
    编写 Skills 的最佳实践
  </Card>
</CardGroup>

## 概述 \{#overview}

<Note>
如需深入了解 Agent Skills 的架构和实际应用，请阅读工程博客文章：[Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)。
</Note>

Skills 通过[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)与 Messages API 集成。无论是使用 Anthropic 管理的预构建 Skills，还是您上传的自定义 Skills，集成方式都是相同的：两者都需要代码执行，并使用相同的 `container` 结构。

### 使用 Skills \{#using-skills}

无论来源如何，Skills 在 Messages API 中的集成方式都是相同的。您在 `container` 参数中指定 Skills，包含 `skill_id`、`type` 和可选的 `version`，它们将在代码执行环境中运行。

**您可以使用来自两个来源的 Skills：**

| 方面 | Anthropic Skills | 自定义 Skills |
|--------|------------------|---------------|
| **Type 值** | `anthropic` | `custom` |
| **Skill ID** | 短名称：`pptx`、`xlsx`、`docx`、`pdf` | 自动生成：`skill_01AbCdEfGhIjKlMnOpQrStUv` |
| **版本格式** | 基于日期：`20251013` 或 `latest` | Epoch 时间戳：`1759178010641129` 或 `latest` |
| **管理方式** | 由 Anthropic 预构建和维护 | 通过 [Skills API](/docs/zh-CN/api/skills/create-skill) 上传和管理 |
| **可用性** | 对所有用户可用 | 仅限您的工作区私有 |

两种 Skill 来源都可通过 [List Skills 端点](/docs/zh-CN/api/skills/list-skills)返回（使用 `source` 参数进行筛选）。集成方式和执行环境完全相同，唯一的区别在于 Skills 的来源以及管理方式。

### 前提条件 \{#prerequisites}

要使用 Skills，您需要：

1. 从 [Console](/settings/keys) 获取的 **Claude API 密钥**
2. **Beta 请求头：**
   - `code-execution-2025-08-25` - 启用代码执行（Skills 必需）
   - `skills-2025-10-02` - 启用 Skills API
   - `files-api-2025-04-14` - 用于向容器上传/从容器下载文件
3. 在您的请求中启用**[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)**

---

## 在 Messages 中使用 Skills \{#using-skills-in-messages}

### Container 参数 \{#container-parameter}

Skills 通过 Messages API 中的 `container` 参数指定。每个请求最多可包含 8 个 Skills。

Anthropic Skills 和自定义 Skills 的结构完全相同。指定必需的 `type` 和 `skill_id`，并可选择包含 `version` 以固定到特定版本：

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 4096,
    "container": {
      "skills": [
        {
          "type": "anthropic",
          "skill_id": "pptx",
          "version": "latest"
        }
      ]
    },
    "messages": [{
      "role": "user",
      "content": "Create a presentation about renewable energy"
    }],
    "tools": [{
      "type": "code_execution_20250825",
      "name": "code_execution"
    }]
  }'
```

```bash CLI
ant beta:messages create \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - type: anthropic
      skill_id: pptx
      version: latest
messages:
  - role: user
    content: Create a presentation about renewable energy
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [{"type": "anthropic", "skill_id": "pptx", "version": "latest"}]
    },
    messages=[
        {"role": "user", "content": "Create a presentation about renewable energy"}
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [
      {
        type: "anthropic",
        skill_id: "pptx",
        version: "latest"
      }
    ]
  },
  messages: [
    {
      role: "user",
      content: "Create a presentation about renewable energy"
    }
  ],
  tools: [
    {
      type: "code_execution_20250825",
      name: "code_execution"
    }
  ]
});
```

```csharp C# nocheck
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Messages;

public class Program
{
    public static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var parameters = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 4096,
            Betas = new[] { "code-execution-2025-08-25", "skills-2025-10-02" },
            Container = new BetaContainerParams
            {
                Skills = new[]
                {
                    new BetaAnthropicSkillParams
                    {
                        Type = "anthropic",
                        SkillId = "pptx",
                        Version = "latest"
                    }
                }
            },
            Messages = new[]
            {
                new BetaMessageParam
                {
                    Role = Role.User,
                    Content = "Create a presentation about renewable energy"
                }
            },
            Tools = new[]
            {
                new BetaCodeExecutionToolParams
                {
                    Type = "code_execution_20250825",
                    Name = "code_execution"
                }
            }
        };

        var message = await client.Beta.Messages.Create(parameters);
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
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas: []anthropic.AnthropicBeta{
			"code-execution-2025-08-25",
			anthropic.AnthropicBetaSkills2025_10_02,
		},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "pptx",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Create a presentation about renewable energy")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..4,8..10,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;

public class Main {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addBeta("code-execution-2025-08-25")
            .addBeta("skills-2025-10-02")
            .container(BetaContainerParams.builder()
                .addSkill(BetaSkillParams.builder()
                    .type(BetaSkillParams.Type.ANTHROPIC)
                    .skillId("pptx")
                    .version("latest")
                    .build())
                .build())
            .addUserMessage("Create a presentation about renewable energy")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build();

        BetaMessage response = client.beta().messages().create(params);
        System.out.println(response);
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => 'Create a presentation about renewable energy']
    ],
    model: 'claude-opus-4-8',
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [
            [
                'type' => 'anthropic',
                'skill_id' => 'pptx',
                'version' => 'latest'
            ]
        ]
    ],
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution']
    ]
);

echo $message;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [
      {
        type: "anthropic",
        skill_id: "pptx",
        version: "latest"
      }
    ]
  },
  messages: [
    { role: "user", content: "Create a presentation about renewable energy" }
  ],
  tools: [
    { type: "code_execution_20250825", name: "code_execution" }
  ]
)
puts message
```
</CodeGroup>

### 下载生成的文件 \{#downloading-generated-files}

当 Skills 创建文档（Excel、PowerPoint、PDF、Word）时，会在响应中返回 `file_id` 属性。您必须使用 Files API 来下载这些文件。

**工作原理：**
1. Skills 在代码执行期间创建文件
2. 响应中包含每个已创建文件的 `file_id`
3. 使用 Files API 下载实际的文件内容
4. 保存到本地或根据需要进行处理

**示例：创建并下载 Excel 文件**

<CodeGroup>

```bash cURL hidelines={1}
cd "$(mktemp -d)"
# 步骤 1：使用 Skill 创建文件
RESPONSE=$(curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 4096,
    "container": {
      "skills": [
        {"type": "anthropic", "skill_id": "xlsx", "version": "latest"}
      ]
    },
    "messages": [{
      "role": "user",
      "content": "Create an Excel file with a simple budget spreadsheet"
    }],
    "tools": [{
      "type": "code_execution_20250825",
      "name": "code_execution"
    }]
  }')

# 步骤 2：从响应中提取 file_id（使用 jq）
FILE_ID=$(echo "$RESPONSE" | jq -r '.content[] | select(.type=="bash_code_execution_tool_result") | .content | select(.type=="bash_code_execution_result") | .content[] | select(.file_id) | .file_id')

# 步骤 3：从元数据中获取文件名
FILENAME=$(curl "https://api.anthropic.com/v1/files/$FILE_ID" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14" | jq -r '.filename')

# 步骤 4：使用 Files API 下载文件
curl "https://api.anthropic.com/v1/files/$FILE_ID/content" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14" \
  --output "$FILENAME"

echo "Downloaded: $FILENAME"
```

```bash CLI nocheck hidelines={1}
cd "$(mktemp -d)"
# 步骤 1：使用 xlsx 技能创建文件
# 步骤 2：使用 --transform（GJSON 路径）从响应中提取 file_id
FILE_ID=$(ant beta:messages create \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 \
  --transform 'content.#.content.content.#.file_id|@flatten|0' \
  --raw-output <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - type: anthropic
      skill_id: xlsx
      version: latest
messages:
  - role: user
    content: Create an Excel file with a simple budget spreadsheet
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
)

# 步骤 3：从文件元数据中获取文件名
FILENAME=$(ant beta:files retrieve-metadata \
  --file-id "$FILE_ID" \
  --transform filename --raw-output)

# 步骤 4：使用 Files API 下载文件
ant beta:files download \
  --file-id "$FILE_ID" \
  --output "$FILENAME" > /dev/null

printf 'Downloaded: %s\n' "$FILENAME"
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

# 步骤 1：使用 Skill 创建文件
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [{"type": "anthropic", "skill_id": "xlsx", "version": "latest"}]
    },
    messages=[
        {
            "role": "user",
            "content": "Create an Excel file with a simple budget spreadsheet",
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)


# 步骤 2：从响应中提取文件 ID
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


# 步骤 3：使用 Files API 下载文件
for file_id in extract_file_ids(response):
    file_metadata = client.beta.files.retrieve_metadata(file_id=file_id)
    file_content = client.beta.files.download(file_id=file_id)

    # 步骤 4：保存到磁盘
    file_content.write_to_file(file_metadata.filename)
    print(f"Downloaded: {file_metadata.filename}")
```

```typescript TypeScript hidelines={1..3}
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs/promises";

const client = new Anthropic();

// 步骤 1：使用 Skill 创建文件
const response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{ type: "anthropic", skill_id: "xlsx", version: "latest" }]
  },
  messages: [
    {
      role: "user",
      content: "Create an Excel file with a simple budget spreadsheet"
    }
  ],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});

// 步骤 2：从响应中提取文件 ID
function extractFileIds(response: any): string[] {
  const fileIds: string[] = [];
  for (const item of response.content) {
    if (item.type === "bash_code_execution_tool_result") {
      const contentItem = item.content;
      if (contentItem.type === "bash_code_execution_result") {
        for (const file of contentItem.content) {
          if ("file_id" in file) {
            fileIds.push(file.file_id);
          }
        }
      }
    }
  }
  return fileIds;
}

// 步骤 3：使用 Files API 下载文件
for (const fileId of extractFileIds(response)) {
  const fileMetadata = await client.beta.files.retrieveMetadata(fileId);
  const fileContent = await client.beta.files.download(fileId);

  // 步骤 4：保存到磁盘
  await fs.writeFile(fileMetadata.filename, Buffer.from(await fileContent.arrayBuffer()));
  console.log(`Downloaded: ${fileMetadata.filename}`);
}
```

```csharp C# nocheck
using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Collections.Generic;
using Anthropic;
using Anthropic.Models.Beta.Messages;
using Anthropic.Models.Beta.Files;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        // 步骤 1：使用 Skill 创建文件
        var parameters = new MessageCreateParams
        {
            Model = "claude-opus-4-8",
            MaxTokens = 4096,
            Betas = new[] { "code-execution-2025-08-25", "skills-2025-10-02" },
            Container = new BetaContainer
            {
                Skills = new[]
                {
                    new BetaSkill
                    {
                        Type = "anthropic",
                        SkillId = "xlsx",
                        Version = "latest"
                    }
                }
            },
            Messages = new[]
            {
                new BetaMessage
                {
                    Role = Role.User,
                    Content = "Create an Excel file with a simple budget spreadsheet"
                }
            },
            Tools = new[]
            {
                new BetaTool
                {
                    Type = "code_execution_20250825",
                    Name = "code_execution"
                }
            }
        };

        var response = await client.Beta.Messages.Create(parameters);

        // 步骤 2：从响应中提取文件 ID
        var fileIds = ExtractFileIds(response);

        // 步骤 3：使用 Files API 下载文件
        foreach (var fileId in fileIds)
        {
            var fileMetadata = await client.Beta.Files.RetrieveMetadata(fileId);

            var fileContent = await client.Beta.Files.Download(fileId);

            // 步骤 4：保存到磁盘
            await File.WriteAllBytesAsync(fileMetadata.Filename, fileContent);
            Console.WriteLine($"Downloaded: {fileMetadata.Filename}");
        }
    }

    static List<string> ExtractFileIds(BetaMessage response)
    {
        var fileIds = new List<string>();
        foreach (var item in response.Content)
        {
            if (item is BetaBashCodeExecutionToolResult toolResult)
            {
                if (toolResult.Content is BetaBashCodeExecutionResult result)
                {
                    foreach (var content in result.Content)
                    {
                        if (content is BetaBashCodeExecutionResultFile file)
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

```go Go hidelines={1..15,68..69}
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

	// 步骤 1：使用 Skill 创建文件
	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas:     []anthropic.AnthropicBeta{"code-execution-2025-08-25", anthropic.AnthropicBetaSkills2025_10_02},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "xlsx",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Create an Excel file with a simple budget spreadsheet")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	// 步骤 2：从响应中提取文件 ID
	fileIDs := extractFileIDs(response)

	// 步骤 3：使用 Files API 下载文件
	for _, fileID := range fileIDs {
		fileMetadata, err := client.Beta.Files.GetMetadata(context.TODO(), fileID, anthropic.BetaFileGetMetadataParams{})
		if err != nil {
			log.Fatal(err)
		}

		fileContent, err := client.Beta.Files.Download(context.TODO(), fileID, anthropic.BetaFileDownloadParams{})
		if err != nil {
			log.Fatal(err)
		}

		// 步骤 4：保存到磁盘
		out, err := os.Create(fileMetadata.Filename)
		if err != nil {
			log.Fatal(err)
		}
		io.Copy(out, fileContent.Body)
		out.Close()
		fileContent.Body.Close()
		fmt.Printf("Downloaded: %s\n", fileMetadata.Filename)
	}
}

func extractFileIDs(response *anthropic.BetaMessage) []string {
	var fileIDs []string
	for _, item := range response.Content {
		switch v := item.AsAny().(type) {
		case anthropic.BetaBashCodeExecutionToolResultBlock:
			for _, output := range v.Content.Content {
				if output.FileID != "" {
					fileIDs = append(fileIDs, output.FileID)
				}
			}
		}
	}
	return fileIDs
}
```

```java Java nocheck hidelines={1..4,8,10..17,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import com.anthropic.models.beta.messages.BetaContentBlock;
import com.anthropic.models.beta.files.FileMetadata;
import com.anthropic.core.http.HttpResponse;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

public class SkillsFileDownload {
    public static void main(String[] args) throws Exception {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 步骤 1：使用 Skill 创建文件
        MessageCreateParams params = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addBeta("code-execution-2025-08-25")
            .addBeta("skills-2025-10-02")
            .container(BetaContainerParams.builder()
                .addSkill(BetaSkillParams.builder()
                    .type(BetaSkillParams.Type.ANTHROPIC)
                    .skillId("xlsx")
                    .version("latest")
                    .build())
                .build())
            .addUserMessage("Create an Excel file with a simple budget spreadsheet")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build();

        BetaMessage response = client.beta().messages().create(params);

        // 步骤 2：从响应中提取文件 ID
        List<String> fileIds = new ArrayList<>();
        for (BetaContentBlock block : response.content()) {
            if (block.isCodeExecutionToolResult()) {
                var toolResult = block.asCodeExecutionToolResult();
                for (var content : toolResult.content()) {
                    content.file().ifPresent(file -> fileIds.add(file.fileId()));
                }
            }
        }

        // 步骤 3：使用 Files API 下载文件
        for (String fileId : fileIds) {
            FileMetadata fileMetadata = client.beta().files().retrieveMetadata(fileId);
            HttpResponse fileContent = client.beta().files().download(fileId);

            // 步骤 4：保存到磁盘
            try (InputStream is = fileContent.body();
                 FileOutputStream fos = new FileOutputStream(fileMetadata.filename())) {
                is.transferTo(fos);
            }
            System.out.println("Downloaded: " + fileMetadata.filename());
        }
    }
}
```

```php PHP nocheck hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

// 步骤 1：使用 Skill 创建文件
$response = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => 'Create an Excel file with a simple budget spreadsheet']
    ],
    model: 'claude-opus-4-8',
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [
            ['type' => 'anthropic', 'skill_id' => 'xlsx', 'version' => 'latest']
        ]
    ],
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution']
    ]
);

// 步骤 2：从响应中提取文件 ID
function extractFileIds($response) {
    $fileIds = [];
    foreach ($response->content as $item) {
        if ($item->type === 'bash_code_execution_tool_result') {
            $contentItem = $item->content;
            if ($contentItem->type === 'bash_code_execution_result') {
                foreach ($contentItem->content as $file) {
                    if (isset($file->fileID)) {
                        $fileIds[] = $file->fileID;
                    }
                }
            }
        }
    }
    return $fileIds;
}

// 步骤 3：使用 Files API 下载文件
foreach (extractFileIds($response) as $fileId) {
    $fileMetadata = $client->beta->files->retrieveMetadata($fileId);
    $fileContent  = $client->beta->files->download($fileId);

    // 步骤 4：保存到磁盘
    file_put_contents($fileMetadata->filename, $fileContent);
    echo "Downloaded: {$fileMetadata->filename}\n";
}
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 步骤 1：使用 Skill 创建文件
response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{ type: "anthropic", skill_id: "xlsx", version: "latest" }]
  },
  messages: [
    {
      role: "user",
      content: "Create an Excel file with a simple budget spreadsheet"
    }
  ],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
)

# 步骤 2：从响应中提取文件 ID
def extract_file_ids(response)
  file_ids = []
  response.content.each do |item|
    if item.type == :bash_code_execution_tool_result
      content_item = item.content
      if content_item.type == :bash_code_execution_result
        content_item.content.each do |file|
          file_ids << file.file_id if file.respond_to?(:file_id)
        end
      end
    end
  end
  file_ids
end

# 步骤 3：使用 Files API 下载文件
extract_file_ids(response).each do |file_id|
  file_metadata = client.beta.files.retrieve_metadata(file_id)

  file_content = client.beta.files.download(file_id)

  # 步骤 4：保存到磁盘
  File.binwrite(file_metadata.filename, file_content.read)
  puts "Downloaded: #{file_metadata.filename}"
end
```

</CodeGroup>

**其他 Files API 操作：**

<CodeGroup>
```bash cURL
# 获取文件元数据
curl "https://api.anthropic.com/v1/files/$FILE_ID" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14"

# 列出所有文件
curl "https://api.anthropic.com/v1/files" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14"

# 删除文件
curl -X DELETE "https://api.anthropic.com/v1/files/$FILE_ID" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14"
```

```bash CLI nocheck
# 获取文件元数据
ant beta:files retrieve-metadata --file-id "$FILE_ID" \
  --transform '{filename,size_bytes}' --format yaml \
  | { read -r _ name; read -r _ size
      printf 'Filename: %s, Size: %s bytes\n' "$name" "$size"; }

# 列出所有文件
ant beta:files list \
  --transform '{filename,created_at}' --format yaml \
  | while read -r _ name && read -r _ date; do
      printf '%s - %s\n' "$name" "${date//\"/}"
    done

# 删除文件
ant beta:files delete --file-id "$FILE_ID" >/dev/null
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()
file_id = "file_abc123"
# 获取文件元数据
file_info = client.beta.files.retrieve_metadata(file_id=file_id)
print(f"Filename: {file_info.filename}, Size: {file_info.size_bytes} bytes")

# 列出所有文件
files = client.beta.files.list()
for file in files.data:
    print(f"{file.filename} - {file.created_at}")

# 删除文件
client.beta.files.delete(file_id=file_id)
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const fileId = "file_011CNha8iCJcU1wXNR6q4V8w";

// 获取文件元数据
const fileInfo = await client.beta.files.retrieveMetadata(fileId);
console.log(`Filename: ${fileInfo.filename}, Size: ${fileInfo.size_bytes} bytes`);

// 列出所有文件
const files = await client.beta.files.list();
for (const file of files.data) {
  console.log(`${file.filename} - ${file.created_at}`);
}

// 删除文件
await client.beta.files.delete(fileId);
```

```csharp C# nocheck
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Files;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();
        string fileId = "file_abc123";

        // 获取文件元数据
        var fileInfo = await client.Beta.Files.RetrieveMetadata(fileId);
        Console.WriteLine($"Filename: {fileInfo.Filename}, Size: {fileInfo.SizeBytes} bytes");

        // 列出所有文件
        var files = await client.Beta.Files.List();
        foreach (var file in files.Data)
        {
            Console.WriteLine($"{file.Filename} - {file.CreatedAt}");
        }

        // 删除文件
        await client.Beta.Files.Delete(fileId);
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
	fileID := "file_abc123"

	// 获取文件元数据
	fileInfo, err := client.Beta.Files.GetMetadata(context.TODO(), fileID, anthropic.BetaFileGetMetadataParams{})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("Filename: %s, Size: %d bytes\n", fileInfo.Filename, fileInfo.SizeBytes)

	// 列出所有文件
	files := client.Beta.Files.ListAutoPaging(context.TODO(), anthropic.BetaFileListParams{})
	for files.Next() {
		file := files.Current()
		fmt.Printf("%s - %s\n", file.Filename, file.CreatedAt)
	}

	// 删除文件
	_, err = client.Beta.Files.Delete(context.TODO(), fileID, anthropic.BetaFileDeleteParams{})
	if err != nil {
		log.Fatal(err)
	}
}
```

```java Java nocheck hidelines={1..2,5..7,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.files.FileMetadata;
import com.anthropic.models.beta.files.FileListPage;

public class FileManagement {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();
        String fileId = "file_abc123";

        // 获取文件元数据
        FileMetadata fileInfo = client.beta().files().retrieveMetadata(fileId);
        System.out.println("Filename: " + fileInfo.filename() + ", Size: " + fileInfo.sizeBytes() + " bytes");

        // 列出所有文件
        FileListPage files = client.beta().files().list();
        for (var file : files.data()) {
            System.out.println(file.filename() + " - " + file.createdAt());
        }

        // 删除文件
        client.beta().files().delete(fileId);
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();
$fileId = "file_abc123";

// 获取文件元数据
$fileInfo = $client->beta->files->retrieveMetadata($fileId);
echo "Filename: {$fileInfo->filename}, Size: {$fileInfo->sizeBytes} bytes\n";

// 列出所有文件
$files = $client->beta->files->list();
foreach ($files->data as $file) {
    echo "{$file->filename} - {$file->createdAt}\n";
}

// 删除文件
$client->beta->files->delete($fileId);
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new
file_id = "file_abc123"

# 获取文件元数据
file_info = client.beta.files.retrieve_metadata(file_id)
puts "Filename: #{file_info.filename}, Size: #{file_info.size_bytes} bytes"

# 列出所有文件
files = client.beta.files.list
files.data.each do |file|
  puts "#{file.filename} - #{file.created_at}"
end

# 删除文件
client.beta.files.delete(file_id)
```
</CodeGroup>

<Note>
有关 Files API 的完整详情，请参阅 [Files API 文档](/docs/zh-CN/api/files-content)。
</Note>

### 多轮对话 \{#multi-turn-conversations}

通过指定容器 ID，在多条消息之间复用同一个容器：

<CodeGroup>
```bash CLI
# 第一个请求创建容器
CONTAINER_ID=$(ant beta:messages create \
  --beta code-execution-2025-08-25 --beta skills-2025-10-02 \
  --transform container.id --raw-output <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - {type: anthropic, skill_id: xlsx, version: latest}
messages:
  - role: user
    content: Analyze this sales data
tools:
  - {type: code_execution_20250825, name: code_execution}
YAML
)

# 使用同一容器继续对话
ant beta:messages create \
  --beta code-execution-2025-08-25 --beta skills-2025-10-02 <<YAML
model: claude-opus-4-8
max_tokens: 4096
container:
  id: $CONTAINER_ID  # Reuse container
  skills:
    - {type: anthropic, skill_id: xlsx, version: latest}
messages:
  - role: user
    content: Analyze this sales data
  - role: assistant
    content: []  # content blocks from the first response
  - role: user
    content: What was the total revenue?
tools:
  - {type: code_execution_20250825, name: code_execution}
YAML
```

```python Python
# 第一个请求创建容器
response1 = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [{"type": "anthropic", "skill_id": "xlsx", "version": "latest"}]
    },
    messages=[{"role": "user", "content": "Analyze this sales data"}],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)

# 使用同一容器继续对话
messages = [
    {"role": "user", "content": "Analyze this sales data"},
    {"role": "assistant", "content": response1.content},
    {"role": "user", "content": "What was the total revenue?"},
]

response2 = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "id": response1.container.id,  # Reuse container
        "skills": [{"type": "anthropic", "skill_id": "xlsx", "version": "latest"}],
    },
    messages=messages,
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)
```

```typescript TypeScript
// 第一个请求创建容器
const response1 = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{ type: "anthropic", skill_id: "xlsx", version: "latest" }]
  },
  messages: [{ role: "user", content: "Analyze this sales data" }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});

// 使用同一容器继续对话
const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
  { role: "user", content: "Analyze this sales data" },
  {
    role: "assistant",
    content: response1.content as Anthropic.Beta.Messages.BetaContentBlockParam[]
  },
  { role: "user", content: "What was the total revenue?" }
];

const response2 = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    id: response1.container!.id, // Reuse container
    skills: [{ type: "anthropic", skill_id: "xlsx", version: "latest" }]
  },
  messages,
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});
```

```csharp C# nocheck
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Messages;

public class Program
{
    public static async Task Main()
    {
        var client = new AnthropicClient();

        var parameters1 = new MessageCreateParams
        {
            Model = "claude-opus-4-8",
            MaxTokens = 4096,
            Betas = new[] { "code-execution-2025-08-25", "skills-2025-10-02" },
            Container = new BetaContainerParams
            {
                Skills = new[]
                {
                    new BetaSkillParam
                    {
                        Type = "anthropic",
                        SkillId = "xlsx",
                        Version = "latest"
                    }
                }
            },
            Messages = new[]
            {
                new BetaMessageParam
                {
                    Role = Role.User,
                    Content = "Analyze this sales data"
                }
            },
            Tools = new[]
            {
                new BetaToolParam
                {
                    Type = "code_execution_20250825",
                    Name = "code_execution"
                }
            }
        };

        var response1 = await client.Beta.Messages.Create(parameters1);

        var parameters2 = new MessageCreateParams
        {
            Model = "claude-opus-4-8",
            MaxTokens = 4096,
            Betas = new[] { "code-execution-2025-08-25", "skills-2025-10-02" },
            Container = new BetaContainerParams
            {
                Id = response1.Container.Id,
                Skills = new[]
                {
                    new BetaSkillParam
                    {
                        Type = "anthropic",
                        SkillId = "xlsx",
                        Version = "latest"
                    }
                }
            },
            Messages = new[]
            {
                new BetaMessageParam { Role = Role.User, Content = "Analyze this sales data" },
                new BetaMessageParam { Role = Role.Assistant, Content = response1.Content },
                new BetaMessageParam { Role = Role.User, Content = "What was the total revenue?" }
            },
            Tools = new[]
            {
                new BetaToolParam
                {
                    Type = "code_execution_20250825",
                    Name = "code_execution"
                }
            }
        };

        var response2 = await client.Beta.Messages.Create(parameters2);
        Console.WriteLine(response2);
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

	response1, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas:     []anthropic.AnthropicBeta{"code-execution-2025-08-25", anthropic.AnthropicBetaSkills2025_10_02},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "xlsx",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Analyze this sales data")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	response2, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas:     []anthropic.AnthropicBeta{"code-execution-2025-08-25", anthropic.AnthropicBetaSkills2025_10_02},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfString: anthropic.String(response1.Container.ID),
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Analyze this sales data")),
			response1.ToParam(),
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("What was the total revenue?")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(response2)
}
```

```java Java hidelines={1..4,8..10,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;

public class ContainerReuse {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params1 = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addBeta("code-execution-2025-08-25")
            .addBeta("skills-2025-10-02")
            .container(BetaContainerParams.builder()
                .addSkill(BetaSkillParams.builder()
                    .type(BetaSkillParams.Type.ANTHROPIC)
                    .skillId("xlsx")
                    .version("latest")
                    .build())
                .build())
            .addUserMessage("Analyze this sales data")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build();

        BetaMessage response1 = client.beta().messages().create(params1);

        MessageCreateParams params2 = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addBeta("code-execution-2025-08-25")
            .addBeta("skills-2025-10-02")
            .container(BetaContainerParams.builder()
                .id(response1.container().get().id())
                .addSkill(BetaSkillParams.builder()
                    .type(BetaSkillParams.Type.ANTHROPIC)
                    .skillId("xlsx")
                    .version("latest")
                    .build())
                .build())
            .addUserMessage("Analyze this sales data")
            .addMessage(response1)
            .addUserMessage("What was the total revenue?")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build();

        BetaMessage response2 = client.beta().messages().create(params2);
        System.out.println(response2);
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$response1 = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => 'Analyze this sales data']
    ],
    model: 'claude-opus-4-8',
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [
            ['type' => 'anthropic', 'skill_id' => 'xlsx', 'version' => 'latest']
        ]
    ],
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution']
    ]
);

$messages = [
    ['role' => 'user', 'content' => 'Analyze this sales data'],
    ['role' => 'assistant', 'content' => $response1->content],
    ['role' => 'user', 'content' => 'What was the total revenue?']
];

$response2 = $client->beta->messages->create(
    maxTokens: 4096,
    messages: $messages,
    model: 'claude-opus-4-8',
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'id' => $response1->container->id,
        'skills' => [
            ['type' => 'anthropic', 'skill_id' => 'xlsx', 'version' => 'latest']
        ]
    ],
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution']
    ]
);

echo $response2;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response1 = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{ type: "anthropic", skill_id: "xlsx", version: "latest" }]
  },
  messages: [
    { role: "user", content: "Analyze this sales data" }
  ],
  tools: [
    { type: "code_execution_20250825", name: "code_execution" }
  ]
)

messages = [
  { role: "user", content: "Analyze this sales data" },
  { role: "assistant", content: response1.content },
  { role: "user", content: "What was the total revenue?" }
]

response2 = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    id: response1.container.id,
    skills: [
      { type: "anthropic", skill_id: "xlsx", version: "latest" }
    ]
  },
  messages: messages,
  tools: [
    { type: "code_execution_20250825", name: "code_execution" }
  ]
)

puts response2
```
</CodeGroup>

### 长时间运行的操作 \{#long-running-operations}

Skills 可能执行需要多轮的操作。请处理 `pause_turn` 停止原因：

<CodeGroup>

```bash cURL nocheck
# 初始请求
RESPONSE=$(curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 4096,
    "container": {
      "skills": [
        {
          "type": "custom",
          "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
          "version": "latest"
        }
      ]
    },
    "messages": [{
      "role": "user",
      "content": "Process this large dataset"
    }],
    "tools": [{
      "type": "code_execution_20250825",
      "name": "code_execution"
    }]
  }')

# 检查 stop_reason 并在循环中处理 pause_turn
STOP_REASON=$(echo "$RESPONSE" | jq -r '.stop_reason')
CONTAINER_ID=$(echo "$RESPONSE" | jq -r '.container.id')

while [ "$STOP_REASON" = "pause_turn" ]; do
  # 使用相同容器继续
  RESPONSE=$(curl https://api.anthropic.com/v1/messages \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
    -H "content-type: application/json" \
    -d "{
      \"model\": \"claude-opus-4-8\",
      \"max_tokens\": 4096,
      \"container\": {
        \"id\": \"$CONTAINER_ID\",
        \"skills\": [{
          \"type\": \"custom\",
          \"skill_id\": \"skill_01AbCdEfGhIjKlMnOpQrStUv\",
          \"version\": \"latest\"
        }]
      },
      \"messages\": [/* include conversation history */],
      \"tools\": [{
        \"type\": \"code_execution_20250825\",
        \"name\": \"code_execution\"
      }]
    }")

  STOP_REASON=$(echo "$RESPONSE" | jq -r '.stop_reason')
done
```

```bash CLI nocheck
RESP=$(mktemp)

# 初始请求：将完整的 JSON 响应捕获到临时文件
ant beta:messages create \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 \
 > "$RESP" <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - type: custom
      skill_id: skill_01AbCdEfGhIjKlMnOpQrStUv
      version: latest
messages:
  - role: user
    content: Process this large dataset
tools:
  - type: code_execution_20250825
    name: code_execution
YAML

# 处理长时间操作的 pause_turn（最多 10 次迭代）
for _ in {1..10}; do
  [[ $(jq -r '.stop_reason' "$RESP") == pause_turn ]] || break

  CONTAINER_ID=$(jq -r '.container.id' "$RESP")

  # 在同一容器中继续，将先前响应的 content 数组
  # 作为助手轮次追加到 messages 中。
  ant beta:messages create \
    --beta code-execution-2025-08-25 \
    --beta skills-2025-10-02 \
 > "$RESP" <<YAML
model: claude-opus-4-8
max_tokens: 4096
container:
  id: $CONTAINER_ID
  skills:
    - type: custom
      skill_id: skill_01AbCdEfGhIjKlMnOpQrStUv
      version: latest
messages:
  # ... 对话历史，已追加先前的助手内容
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
done
```

```python Python nocheck
messages = [{"role": "user", "content": "Process this large dataset"}]
max_retries = 10

response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [
            {
                "type": "custom",
                "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
                "version": "latest",
            }
        ]
    },
    messages=messages,
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)

# 处理长时间操作的 pause_turn
for i in range(max_retries):
    if response.stop_reason != "pause_turn":
        break

    messages.append({"role": "assistant", "content": response.content})
    response = client.beta.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        betas=["code-execution-2025-08-25", "skills-2025-10-02"],
        container={
            "id": response.container.id,
            "skills": [
                {
                    "type": "custom",
                    "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
                    "version": "latest",
                }
            ],
        },
        messages=messages,
        tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
    )
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
  { role: "user", content: "Process this large dataset" }
];
const maxRetries = 10;

let response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{ type: "custom", skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv", version: "latest" }]
  },
  messages,
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});

// 处理长时间操作的 pause_turn
for (let i = 0; i < maxRetries; i++) {
  if (response.stop_reason !== "pause_turn") {
    break;
  }

  messages.push({
    role: "assistant" as const,
    content: response.content as Anthropic.Beta.Messages.BetaContentBlockParam[]
  });
  response = await client.beta.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
    container: {
      id: response.container!.id,
      skills: [
        { type: "custom", skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv", version: "latest" }
      ]
    },
    messages,
    tools: [{ type: "code_execution_20250825", name: "code_execution" }]
  });
}
```

```csharp C# nocheck
using Anthropic;
using Anthropic.Models.Beta.Messages;

AnthropicClient client = new();

var messages = new List<BetaMessageParam>
{
    new() { Role = Role.User, Content = "Process this large dataset" }
};
int maxRetries = 10;

var response = await client.Beta.Messages.Create(new MessageCreateParams
{
    Model = "claude-opus-4-8",
    MaxTokens = 4096,
    Betas = ["code-execution-2025-08-25", "skills-2025-10-02"],
    Container = new BetaContainerParams
    {
        Skills = [
            new BetaSkillParam
            {
                Type = "custom",
                SkillId = "skill_01AbCdEfGhIjKlMnOpQrStUv",
                Version = "latest"
            }
        ]
    },
    Messages = messages,
    Tools = [new BetaToolParam { Type = "code_execution_20250825", Name = "code_execution" }]
});

for (int i = 0; i < maxRetries; i++)
{
    if (response.StopReason != "pause_turn")
    {
        break;
    }

    messages.Add(new BetaMessageParam { Role = Role.Assistant, Content = response.Content });

    response = await client.Beta.Messages.Create(new MessageCreateParams
    {
        Model = "claude-opus-4-8",
        MaxTokens = 4096,
        Betas = ["code-execution-2025-08-25", "skills-2025-10-02"],
        Container = new BetaContainerParams
        {
            Id = response.Container.Id,
            Skills = [
                new BetaSkillParam
                {
                    Type = "custom",
                    SkillId = "skill_01AbCdEfGhIjKlMnOpQrStUv",
                    Version = "latest"
                }
            ]
        },
        Messages = messages,
        Tools = [new BetaToolParam { Type = "code_execution_20250825", Name = "code_execution" }]
    });
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

	messages := []anthropic.BetaMessageParam{
		anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Process this large dataset")),
	}
	maxRetries := 10

	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas:     []anthropic.AnthropicBeta{"code-execution-2025-08-25", anthropic.AnthropicBetaSkills2025_10_02},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeCustom,
						SkillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: messages,
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	for i := 0; i < maxRetries; i++ {
		if response.StopReason != "pause_turn" {
			break
		}

		messages = append(messages, response.ToParam())

		response, err = client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
			Model:     "claude-opus-4-8",
			MaxTokens: 4096,
			Betas:     []anthropic.AnthropicBeta{"code-execution-2025-08-25", anthropic.AnthropicBetaSkills2025_10_02},
			Container: anthropic.BetaMessageNewParamsContainerUnion{
				OfString: anthropic.String(response.Container.ID),
			},
			Messages: messages,
			Tools: []anthropic.BetaToolUnionParam{
				{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
			},
		})
		if err != nil {
			log.Fatal(err)
		}
	}

	fmt.Println(response)
}
```

```java Java nocheck hidelines={1..5,9..10,12..14,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaMessageParam;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import java.util.ArrayList;
import java.util.List;
import com.anthropic.models.beta.messages.BetaStopReason;

public class Main {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        List<BetaMessageParam> messages = new ArrayList<>();
        messages.add(
            BetaMessageParam.builder()
                .role(BetaMessageParam.Role.USER)
                .content("Process this large dataset")
                .build()
        );
        int maxRetries = 10;

        BetaMessage response = client.beta().messages().create(
            MessageCreateParams.builder()
                .model("claude-opus-4-8")
                .maxTokens(4096L)
                .addBeta("code-execution-2025-08-25")
                .addBeta("skills-2025-10-02")
                .container(BetaContainerParams.builder()
                    .addSkill(BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.CUSTOM)
                        .skillId("skill_01AbCdEfGhIjKlMnOpQrStUv")
                        .version("latest")
                        .build())
                    .build())
                .messages(messages)
                .addTool(BetaCodeExecutionTool20250825.builder().build())
                .build());

        for (int i = 0; i < maxRetries; i++) {
            if (!response.stopReason().isPresent()
                    || !response.stopReason().get().equals(BetaStopReason.PAUSE_TURN)) {
                break;
            }

            messages.add(response.toParam());

            response = client.beta().messages().create(
                MessageCreateParams.builder()
                    .model("claude-opus-4-8")
                    .maxTokens(4096L)
                    .addBeta("code-execution-2025-08-25")
                    .addBeta("skills-2025-10-02")
                    .container(BetaContainerParams.builder()
                        .id(response.container().get().id())
                        .addSkill(BetaSkillParams.builder()
                            .type(BetaSkillParams.Type.CUSTOM)
                            .skillId("skill_01AbCdEfGhIjKlMnOpQrStUv")
                            .version("latest")
                            .build())
                        .build())
                    .messages(messages)
                    .addTool(BetaCodeExecutionTool20250825.builder().build())
                    .build());
        }
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

$messages = [
    ['role' => 'user', 'content' => 'Process this large dataset']
];
$maxRetries = 10;

$response = $client->beta->messages->create(
    maxTokens: 4096,
    messages: $messages,
    model: 'claude-opus-4-8',
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [
            [
                'type' => 'custom',
                'skill_id' => 'skill_01AbCdEfGhIjKlMnOpQrStUv',
                'version' => 'latest'
            ]
        ]
    ],
    tools: [['type' => 'code_execution_20250825', 'name' => 'code_execution']]
);

for ($i = 0; $i < $maxRetries; $i++) {
    if ($response->stopReason !== 'pause_turn') {
        break;
    }

    $messages[] = ['role' => 'assistant', 'content' => $response->content];

    $response = $client->beta->messages->create(
        maxTokens: 4096,
        messages: $messages,
        model: 'claude-opus-4-8',
        betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
        container: [
            'id' => $response->container->id,
            'skills' => [
                [
                    'type' => 'custom',
                    'skill_id' => 'skill_01AbCdEfGhIjKlMnOpQrStUv',
                    'version' => 'latest'
                ]
            ]
        ],
        tools: [['type' => 'code_execution_20250825', 'name' => 'code_execution']]
    );
}
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

messages = [
  { role: "user", content: "Process this large dataset" }
]
max_retries = 10

response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [
      {
        type: "custom",
        skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv",
        version: "latest"
      }
    ]
  },
  messages: messages,
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
)

max_retries.times do
  break if response.stop_reason != :pause_turn

  messages << { role: "assistant", content: response.content }

  response = client.beta.messages.create(
    model: "claude-opus-4-8",
    max_tokens: 4096,
    betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
    container: {
      id: response.container.id,
      skills: [
        {
          type: "custom",
          skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv",
          version: "latest"
        }
      ]
    },
    messages: messages,
    tools: [{ type: "code_execution_20250825", name: "code_execution" }]
  )
end
```
</CodeGroup>

<Note>
响应中可能包含 `pause_turn` 停止原因，这表示 API 暂停了一个长时间运行的 Skill 操作。您可以在后续请求中原样返回该响应，让 Claude 继续其轮次；或者如果您希望中断对话并提供额外指导，也可以修改内容。
</Note>

### 使用多个 Skills \{#using-multiple-skills}

在单个请求中组合多个 Skills 以处理复杂的工作流：

<CodeGroup>

```bash cURL nocheck
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 4096,
    "container": {
      "skills": [
        {
          "type": "anthropic",
          "skill_id": "xlsx",
          "version": "latest"
        },
        {
          "type": "anthropic",
          "skill_id": "pptx",
          "version": "latest"
        },
        {
          "type": "custom",
          "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
          "version": "latest"
        }
      ]
    },
    "messages": [{
      "role": "user",
      "content": "Analyze sales data and create a presentation"
    }],
    "tools": [{
      "type": "code_execution_20250825",
      "name": "code_execution"
    }]
  }'
```

```bash CLI nocheck
ant beta:messages create \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - type: anthropic
      skill_id: xlsx
      version: latest
    - type: anthropic
      skill_id: pptx
      version: latest
    - type: custom
      skill_id: skill_01AbCdEfGhIjKlMnOpQrStUv
      version: latest
messages:
  - role: user
    content: Analyze sales data and create a presentation
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
```

```python Python nocheck
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [
            {"type": "anthropic", "skill_id": "xlsx", "version": "latest"},
            {"type": "anthropic", "skill_id": "pptx", "version": "latest"},
            {
                "type": "custom",
                "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
                "version": "latest",
            },
        ]
    },
    messages=[
        {"role": "user", "content": "Analyze sales data and create a presentation"}
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)
```

```typescript TypeScript nocheck
const response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [
      {
        type: "anthropic",
        skill_id: "xlsx",
        version: "latest"
      },
      {
        type: "anthropic",
        skill_id: "pptx",
        version: "latest"
      },
      {
        type: "custom",
        skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv",
        version: "latest"
      }
    ]
  },
  messages: [
    {
      role: "user",
      content: "Analyze sales data and create a presentation"
    }
  ],
  tools: [
    {
      type: "code_execution_20250825",
      name: "code_execution"
    }
  ]
});
```

```csharp C# nocheck
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Messages;

public class Program
{
    public static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var parameters = new MessageCreateParams
        {
            Model = "claude-opus-4-8",
            MaxTokens = 4096,
            Betas = new[] { "code-execution-2025-08-25", "skills-2025-10-02" },
            Container = new BetaContainerParams
            {
                Skills = new object[]
                {
                    new
                    {
                        type = "anthropic",
                        skill_id = "xlsx",
                        version = "latest"
                    },
                    new
                    {
                        type = "anthropic",
                        skill_id = "pptx",
                        version = "latest"
                    },
                    new
                    {
                        type = "custom",
                        skill_id = "skill_01AbCdEfGhIjKlMnOpQrStUv",
                        version = "latest"
                    }
                }
            },
            Messages = new[]
            {
                new BetaMessageParam
                {
                    Role = Role.User,
                    Content = "Analyze sales data and create a presentation"
                }
            },
            Tools = new object[]
            {
                new
                {
                    type = "code_execution_20250825",
                    name = "code_execution"
                }
            }
        };

        var message = await client.Beta.Messages.Create(parameters);
        Console.WriteLine(message);
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

	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas: []anthropic.AnthropicBeta{
			"code-execution-2025-08-25",
			anthropic.AnthropicBetaSkills2025_10_02,
		},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "xlsx",
						Version: anthropic.String("latest"),
					},
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "pptx",
						Version: anthropic.String("latest"),
					},
					{
						Type:    anthropic.BetaSkillParamsTypeCustom,
						SkillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Analyze sales data and create a presentation")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java nocheck hidelines={1..4,8..11,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import java.util.List;

public class SkillsExample {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addBeta("code-execution-2025-08-25")
            .addBeta("skills-2025-10-02")
            .container(BetaContainerParams.builder()
                .skills(List.of(
                    BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.ANTHROPIC)
                        .skillId("xlsx")
                        .version("latest")
                        .build(),
                    BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.ANTHROPIC)
                        .skillId("pptx")
                        .version("latest")
                        .build(),
                    BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.CUSTOM)
                        .skillId("skill_01AbCdEfGhIjKlMnOpQrStUv")
                        .version("latest")
                        .build()
                ))
                .build())
            .addUserMessage("Analyze sales data and create a presentation")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build();

        BetaMessage response = client.beta().messages().create(params);
        System.out.println(response);
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

$message = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => 'Analyze sales data and create a presentation']
    ],
    model: 'claude-opus-4-8',
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [
            [
                'type' => 'anthropic',
                'skill_id' => 'xlsx',
                'version' => 'latest'
            ],
            [
                'type' => 'anthropic',
                'skill_id' => 'pptx',
                'version' => 'latest'
            ],
            [
                'type' => 'custom',
                'skill_id' => 'skill_01AbCdEfGhIjKlMnOpQrStUv',
                'version' => 'latest'
            ]
        ]
    ],
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution']
    ]
);

echo $message;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [
      {
        type: "anthropic",
        skill_id: "xlsx",
        version: "latest"
      },
      {
        type: "anthropic",
        skill_id: "pptx",
        version: "latest"
      },
      {
        type: "custom",
        skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv",
        version: "latest"
      }
    ]
  },
  messages: [
    { role: "user", content: "Analyze sales data and create a presentation" }
  ],
  tools: [
    { type: "code_execution_20250825", name: "code_execution" }
  ]
)
puts message
```
</CodeGroup>

---

## 管理自定义 Skills \{#managing-custom-skills}

### 创建 Skill \{#creating-a-skill}

Skill 包是一个目录，其顶层包含一个带有 `name` 和 `description` YAML frontmatter 的 `SKILL.md` 文件，以及任何支持脚本或资源。请参阅[在 API 中开始使用 Agent Skills](/docs/zh-CN/agents-and-tools/agent-skills/quickstart) 来编写一个 Skill，并查看示例后面的**要求**列表以了解完整的约束条件。

上传您的自定义 Skill 以使其在您的工作区中可用。您可以上传 zip 压缩包或单个文件对象；Python SDK 还额外提供了一个接受目录路径的 `files_from_dir` 辅助函数。

<CodeGroup defaultLanguage="CLI">

```bash cURL nocheck
curl -X POST "https://api.anthropic.com/v1/skills" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: skills-2025-10-02" \
  -F "display_title=Financial Analysis" \
  -F "files[]=@financial_skill/SKILL.md;filename=financial_skill/SKILL.md" \
  -F "files[]=@financial_skill/analyze.py;filename=financial_skill/analyze.py"
```

```bash CLI nocheck
# 选项 1：上传单个文件（每个文件使用一个 --file 标志）
ant beta:skills create \
  --display-title "Financial Analysis" \
  --file financial_skill/SKILL.md \
  --file financial_skill/analyze.py \
  --beta skills-2025-10-02

# 选项 2：上传 zip 压缩包
ant beta:skills create \
  --display-title "Financial Analysis" \
  --file financial_analysis_skill.zip \
  --beta skills-2025-10-02
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

# 选项 1：使用 files_from_dir 辅助函数（仅限 Python，推荐）
from anthropic.lib import files_from_dir

skill = client.beta.skills.create(
    display_title="Financial Analysis",
    files=files_from_dir("/path/to/financial_analysis_skill"),
)

# 选项 2：使用 zip 文件
skill = client.beta.skills.create(
    display_title="Financial Analysis",
    files=[("skill.zip", open("financial_analysis_skill.zip", "rb"))],
)

# 选项 3：使用文件元组 (filename, file_content, mime_type)
skill = client.beta.skills.create(
    display_title="Financial Analysis",
    files=[
        (
            "financial_skill/SKILL.md",
            open("financial_skill/SKILL.md", "rb"),
            "text/markdown",
        ),
        (
            "financial_skill/analyze.py",
            open("financial_skill/analyze.py", "rb"),
            "text/x-python",
        ),
    ],
)

print(f"Created skill: {skill.id}")
print(f"Latest version: {skill.latest_version}")
```

```typescript TypeScript nocheck
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import fs from "fs";

const client = new Anthropic();

// 选项 1：使用 zip 文件
const skillFromZip = await client.beta.skills.create({
  display_title: "Financial Analysis",
  files: [await toFile(fs.createReadStream("financial_analysis_skill.zip"), "skill.zip")]
});

// 选项 2：使用单独的文件对象
const skill = await client.beta.skills.create({
  display_title: "Financial Analysis",
  files: [
    await toFile(fs.createReadStream("financial_skill/SKILL.md"), "financial_skill/SKILL.md", {
      type: "text/markdown"
    }),
    await toFile(
      fs.createReadStream("financial_skill/analyze.py"),
      "financial_skill/analyze.py",
      { type: "text/x-python" }
    )
  ]
});

console.log(`Created skill: ${skill.id}`);
console.log(`Latest version: ${skill.latest_version}`);
```

```csharp C# nocheck
using System;
using System.IO;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Skills;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        // 选项 1：使用 zip 文件
        var parameters = new SkillCreateParams
        {
            DisplayTitle = "Financial Analysis",
            Files = [
                new FileStream("financial_analysis_skill.zip", FileMode.Open, FileAccess.Read)
            ],
        };

        var skill = await client.Beta.Skills.Create(parameters);

        // 选项 2：使用单独的文件
        var parameters2 = new SkillCreateParams
        {
            DisplayTitle = "Financial Analysis",
            Files = [
                new FileStream("financial_skill/SKILL.md", FileMode.Open, FileAccess.Read),
                new FileStream("financial_skill/analyze.py", FileMode.Open, FileAccess.Read)
            ],
        };

        var skill2 = await client.Beta.Skills.Create(parameters2);

        Console.WriteLine($"Created skill: {skill.Id}");
        Console.WriteLine($"Latest version: {skill.LatestVersion}");
    }
}
```

```go Go nocheck hidelines={1..15,-1}
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

	// 选项 1：使用 zip 文件
	zipFile, err := os.Open("financial_analysis_skill.zip")
	if err != nil {
		log.Fatal(err)
	}
	defer zipFile.Close()

	skill, err := client.Beta.Skills.New(context.TODO(), anthropic.BetaSkillNewParams{
		DisplayTitle: anthropic.String("Financial Analysis"),
		Files:        []io.Reader{zipFile},
	})
	if err != nil {
		log.Fatal(err)
	}

	// 选项 2：使用单独的文件
	skillMd, err := os.Open("financial_skill/SKILL.md")
	if err != nil {
		log.Fatal(err)
	}
	defer skillMd.Close()

	analyzePy, err := os.Open("financial_skill/analyze.py")
	if err != nil {
		log.Fatal(err)
	}
	defer analyzePy.Close()

	skill2, err := client.Beta.Skills.New(context.TODO(), anthropic.BetaSkillNewParams{
		DisplayTitle: anthropic.String("Financial Analysis"),
		Files:        []io.Reader{skillMd, analyzePy},
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Created skill: %s\n", skill.ID)
	fmt.Printf("Latest version: %s\n", skill.LatestVersion)
	fmt.Printf("Created skill 2: %s\n", skill2.ID)
}
```

```java Java nocheck hidelines={1..2,5..10,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.skills.SkillCreateParams;
import com.anthropic.models.beta.skills.SkillCreateResponse;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.file.Path;

public class SkillCreate {
    public static void main(String[] args) throws IOException {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 选项 1：使用 zip 文件
        SkillCreateParams params = SkillCreateParams.builder()
            .displayTitle("Financial Analysis")
            .addFile(new FileInputStream("financial_analysis_skill.zip"))
            .build();

        SkillCreateResponse skill = client.beta().skills().create(params);

        // 选项 2：使用单独的文件
        SkillCreateParams params2 = SkillCreateParams.builder()
            .displayTitle("Financial Analysis")
            .addFile(Path.of("financial_skill/SKILL.md"))
            .addFile(Path.of("financial_skill/analyze.py"))
            .build();

        SkillCreateResponse skill2 = client.beta().skills().create(params2);

        System.out.println("Created skill: " + skill.id());
        System.out.println("Latest version: " + skill.latestVersion());
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

// 选项 1：使用 zip 文件
$skill = $client->beta->skills->create(
    displayTitle: 'Financial Analysis',
    files: [
        fopen('financial_analysis_skill.zip', 'r')
    ],
);

// 选项 2：使用单独的文件
$skill = $client->beta->skills->create(
    displayTitle: 'Financial Analysis',
    files: [
        fopen('financial_skill/SKILL.md', 'r'),
        fopen('financial_skill/analyze.py', 'r')
    ],
);

echo "Created skill: {$skill->id}\n";
echo "Latest version: {$skill->latestVersion}\n";
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 选项 1：使用 zip 文件
skill = client.beta.skills.create(
  display_title: "Financial Analysis",
  files: [
    File.open("financial_analysis_skill.zip", "rb")
  ]
)

# 选项 2：使用单独的文件
skill = client.beta.skills.create(
  display_title: "Financial Analysis",
  files: [
    File.open("financial_skill/SKILL.md", "rb"),
    File.open("financial_skill/analyze.py", "rb")
  ]
)

puts "Created skill: #{skill.id}"
puts "Latest version: #{skill.latest_version}"
```
</CodeGroup>

**要求：**
- 必须在顶层包含一个 SKILL.md 文件
- 所有文件的路径中必须指定一个共同的根目录
- 上传总大小必须小于 30&nbsp;MB
- YAML frontmatter 要求：
  - `name`：最多 64 个字符，仅限小写字母/数字/连字符，不含 XML 标签，不含保留词（"anthropic"、"claude"）
  - `description`：最多 1024 个字符，非空，不含 XML 标签

如需完整的请求/响应架构，请参阅 [Create Skill API 参考](/docs/zh-CN/api/skills/create-skill)。

### 列出 Skills \{#listing-skills}

检索您的工作区中可用的所有 Skills，包括 Anthropic 预构建的 Skills 和您的自定义 Skills。使用 `source` 参数按 Skill 类型进行筛选：

<CodeGroup defaultLanguage="CLI">
```bash cURL
# 列出所有 Skill
curl "https://api.anthropic.com/v1/skills" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: skills-2025-10-02"

# 仅列出自定义 Skill
curl "https://api.anthropic.com/v1/skills?source=custom" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: skills-2025-10-02"
```

```bash CLI
# 列出所有 Skill
ant beta:skills list

# 仅列出自定义 Skill
ant beta:skills list --source custom
```

```python Python
# 列出所有 Skill
skills = client.beta.skills.list()

for skill in skills.data:
    print(f"{skill.id}: {skill.display_title} (source: {skill.source})")

# 仅列出自定义 Skill
custom_skills = client.beta.skills.list(source="custom")
```

```typescript TypeScript
// 列出所有 Skill
const skills = await client.beta.skills.list();

for (const skill of skills.data) {
  console.log(`${skill.id}: ${skill.display_title} (source: ${skill.source})`);
}

// 仅列出自定义 Skill
const customSkills = await client.beta.skills.list({
  source: "custom"
});
```

```csharp C# nocheck
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Skills;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        // 列出所有 Skills
        var skills = await client.Beta.Skills.List();

        foreach (var skill in skills.Data)
        {
            Console.WriteLine($"{skill.Id}: {skill.DisplayTitle} (source: {skill.Source})");
        }

        // 仅列出自定义 Skills
        var customSkills = await client.Beta.Skills.List(new SkillListParams
        {
            Source = "custom",
        });
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

	// 列出所有 Skills
	skills := client.Beta.Skills.ListAutoPaging(context.TODO(), anthropic.BetaSkillListParams{})

	for skills.Next() {
		skill := skills.Current()
		fmt.Printf("%s: %s (source: %s)\n", skill.ID, skill.DisplayTitle, skill.Source)
	}
	if skills.Err() != nil {
		log.Fatal(skills.Err())
	}

	// 仅列出自定义 Skills
	customSkills := client.Beta.Skills.ListAutoPaging(context.TODO(), anthropic.BetaSkillListParams{
		Source: anthropic.String("custom"),
	})

	for customSkills.Next() {
		skill := customSkills.Current()
		fmt.Printf("%s: %s (source: %s)\n", skill.ID, skill.DisplayTitle, skill.Source)
	}
}
```

```java Java hidelines={1..2,6..8,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.skills.SkillListParams;
import com.anthropic.models.beta.skills.SkillListPage;
import com.anthropic.models.beta.skills.SkillListResponse;

public class ListSkills {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 列出所有 Skill
        SkillListPage skills = client.beta().skills().list();

        for (SkillListResponse skill : skills.data()) {
            System.out.println(skill.id() + ": " + skill.displayTitle() + " (source: " + skill.source() + ")");
        }

        // 仅列出自定义 Skill
        SkillListParams customParams = SkillListParams.builder()
            .source("custom")
            .build();

        SkillListPage customSkills = client.beta().skills().list(customParams);
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

// 列出所有 Skill
$skills = $client->beta->skills->list();

foreach ($skills->data as $skill) {
    echo "{$skill->id}: {$skill->displayTitle} (source: {$skill->source})\n";
}

// 仅列出自定义 Skill
$customSkills = $client->beta->skills->list(
    source: 'custom',
);
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 列出所有 Skill
skills = client.beta.skills.list

skills.data.each do |skill|
  puts "#{skill.id}: #{skill.display_title} (source: #{skill.source})"
end

# 仅列出自定义 Skill
custom_skills = client.beta.skills.list(
  source: "custom"
)
```
</CodeGroup>

有关分页和筛选选项，请参阅 [List Skills API 参考](/docs/zh-CN/api/skills/list-skills)。

### 检索 Skill \{#retrieving-a-skill}

获取特定 Skill 的详细信息：

<CodeGroup defaultLanguage="CLI">

```bash cURL nocheck
curl "https://api.anthropic.com/v1/skills/skill_01AbCdEfGhIjKlMnOpQrStUv" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: skills-2025-10-02"
```

```bash CLI nocheck
ant beta:skills retrieve \
  --skill-id skill_01AbCdEfGhIjKlMnOpQrStUv
```

```python Python nocheck
skill = client.beta.skills.retrieve(skill_id="skill_01AbCdEfGhIjKlMnOpQrStUv")

print(f"Skill: {skill.display_title}")
print(f"Latest version: {skill.latest_version}")
print(f"Created: {skill.created_at}")
```

```typescript TypeScript nocheck
const skill = await client.beta.skills.retrieve("skill_01AbCdEfGhIjKlMnOpQrStUv");

console.log(`Skill: ${skill.display_title}`);
console.log(`Latest version: ${skill.latest_version}`);
console.log(`Created: ${skill.created_at}`);
```

```csharp C# nocheck
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Skills;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var skill = await client.Beta.Skills.Retrieve("skill_01AbCdEfGhIjKlMnOpQrStUv");

        Console.WriteLine($"Skill: {skill.DisplayTitle}");
        Console.WriteLine($"Latest version: {skill.LatestVersion}");
        Console.WriteLine($"Created: {skill.CreatedAt}");
    }
}
```

```go Go nocheck hidelines={1..13,-1}
package main

import (
	"context"
	"fmt"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	skill, err := client.Beta.Skills.Get(
		context.TODO(),
		"skill_01AbCdEfGhIjKlMnOpQrStUv",
		anthropic.BetaSkillGetParams{},
	)
	if err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Skill: %s\n", skill.DisplayTitle)
	fmt.Printf("Latest version: %s\n", skill.LatestVersion)
	fmt.Printf("Created: %s\n", skill.CreatedAt)
}
```

```java Java nocheck hidelines={1..2,4..6,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.skills.SkillRetrieveResponse;

public class RetrieveSkill {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        SkillRetrieveResponse skill = client.beta().skills().retrieve("skill_01AbCdEfGhIjKlMnOpQrStUv");

        System.out.println("Skill: " + skill.displayTitle());
        System.out.println("Latest version: " + skill.latestVersion());
        System.out.println("Created: " + skill.createdAt());
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

$skill = $client->beta->skills->retrieve(
    skillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
);

echo "Skill: " . $skill->displayTitle . "\n";
echo "Latest version: " . $skill->latestVersion . "\n";
echo "Created: " . $skill->createdAt . "\n";
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

skill = client.beta.skills.retrieve("skill_01AbCdEfGhIjKlMnOpQrStUv")

puts "Skill: #{skill.display_title}"
puts "Latest version: #{skill.latest_version}"
puts "Created: #{skill.created_at}"
```
</CodeGroup>

### 删除 Skill \{#deleting-a-skill}

要删除一个 Skill，您必须先删除其所有版本：

<CodeGroup defaultLanguage="CLI">

```bash cURL nocheck
# 先删除所有版本，然后删除该 Skill
curl -X DELETE "https://api.anthropic.com/v1/skills/skill_01AbCdEfGhIjKlMnOpQrStUv" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: skills-2025-10-02"
```

```bash CLI nocheck
# 步骤 1：删除所有版本
ant beta:skills:versions list \
  --skill-id skill_01AbCdEfGhIjKlMnOpQrStUv \
  --transform version --raw-output \
  | while read -r VERSION; do
      ant beta:skills:versions delete \
        --skill-id skill_01AbCdEfGhIjKlMnOpQrStUv \
        --version "$VERSION" >/dev/null
    done

# 步骤 2：删除该 Skill
ant beta:skills delete \
  --skill-id skill_01AbCdEfGhIjKlMnOpQrStUv >/dev/null
```

```python Python nocheck
# 步骤 1：删除所有版本
versions = client.beta.skills.versions.list(skill_id="skill_01AbCdEfGhIjKlMnOpQrStUv")

for version in versions.data:
    client.beta.skills.versions.delete(
        skill_id="skill_01AbCdEfGhIjKlMnOpQrStUv",
        version=version.version,
    )

# 步骤 2：删除该 Skill
client.beta.skills.delete(skill_id="skill_01AbCdEfGhIjKlMnOpQrStUv")
```

```typescript TypeScript nocheck hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// 步骤 1：删除所有版本
const versions = await client.beta.skills.versions.list("skill_01AbCdEfGhIjKlMnOpQrStUv");

for (const version of versions.data) {
  await client.beta.skills.versions.delete("skill_01AbCdEfGhIjKlMnOpQrStUv", version.version);
}

// 步骤 2：删除该 Skill
await client.beta.skills.delete("skill_01AbCdEfGhIjKlMnOpQrStUv");
```

```csharp C# nocheck
using System;
using System.Threading.Tasks;
using Anthropic;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        // 步骤 1：删除所有版本
        var versions = await client.Beta.Skills.Versions.List("skill_01AbCdEfGhIjKlMnOpQrStUv");

        foreach (var version in versions.Data)
        {
            await client.Beta.Skills.Versions.Delete(
                "skill_01AbCdEfGhIjKlMnOpQrStUv",
                version.Version
            );
        }

        // 步骤 2：删除该 Skill
        await client.Beta.Skills.Delete("skill_01AbCdEfGhIjKlMnOpQrStUv");
    }
}
```

```go Go nocheck hidelines={1..12,-1}
package main

import (
	"context"
	"log"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	// 步骤 1：删除所有版本
	versions := client.Beta.Skills.Versions.ListAutoPaging(
		context.TODO(),
		"skill_01AbCdEfGhIjKlMnOpQrStUv",
		anthropic.BetaSkillVersionListParams{},
	)

	for versions.Next() {
		version := versions.Current()
		_, err := client.Beta.Skills.Versions.Delete(
			context.TODO(),
			version.Version,
			anthropic.BetaSkillVersionDeleteParams{
				SkillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
			},
		)
		if err != nil {
			log.Fatal(err)
		}
	}

	// 步骤 2：删除该 Skill
	_, err := client.Beta.Skills.Delete(
		context.TODO(),
		"skill_01AbCdEfGhIjKlMnOpQrStUv",
		anthropic.BetaSkillDeleteParams{},
	)
	if err != nil {
		log.Fatal(err)
	}
}
```

```java Java nocheck hidelines={1..2,5..7,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.skills.versions.VersionListPage;
import com.anthropic.models.beta.skills.versions.VersionDeleteParams;

public class DeleteSkill {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 步骤 1：删除所有版本
        VersionListPage versions = client.beta().skills().versions().list("skill_01AbCdEfGhIjKlMnOpQrStUv");

        for (var version : versions.data()) {
            client.beta().skills().versions().delete(
                version.version(),
                VersionDeleteParams.builder()
                    .skillId("skill_01AbCdEfGhIjKlMnOpQrStUv")
                    .build()
            );
        }

        // 步骤 2：删除该 Skill
        client.beta().skills().delete("skill_01AbCdEfGhIjKlMnOpQrStUv");
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

// 步骤 1：删除所有版本
$versions = $client->beta->skills->versions->list(
    skillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
);

foreach ($versions->data as $version) {
    $client->beta->skills->versions->delete(
        skillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
        version: $version->version,
    );
}

// 步骤 2：删除该 Skill
$client->beta->skills->delete(
    skillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
);
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 步骤 1：删除所有版本
versions = client.beta.skills.versions.list("skill_01AbCdEfGhIjKlMnOpQrStUv")

versions.data.each do |version|
  client.beta.skills.versions.delete(
    version.version,
    skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv"
  )
end

# 步骤 2：删除该 Skill
client.beta.skills.delete("skill_01AbCdEfGhIjKlMnOpQrStUv")
```
</CodeGroup>

尝试删除仍存在版本的 Skill 将返回 400 错误。

### 版本管理 \{#versioning}

Skills 支持版本管理，以便安全地管理更新：

**Anthropic Skills：**
- 版本使用日期格式：`20251013`
- 随着更新发布新版本
- 指定确切版本以确保稳定性

**自定义 Skills：**
- 自动生成的 epoch 时间戳：`1759178010641129`
- 使用 `"latest"` 始终获取最新版本
- 更新 Skill 文件时创建新版本

<CodeGroup defaultLanguage="CLI">

```bash cURL nocheck
# 创建新版本
NEW_VERSION=$(curl -X POST "https://api.anthropic.com/v1/skills/skill_01AbCdEfGhIjKlMnOpQrStUv/versions" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: skills-2025-10-02" \
  -F "files[]=@updated_skill/SKILL.md;filename=updated_skill/SKILL.md")

VERSION_NUMBER=$(echo "$NEW_VERSION" | jq -r '.version')

# 使用特定版本
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
  -H "content-type: application/json" \
  -d "{
    \"model\": \"claude-opus-4-8\",
    \"max_tokens\": 4096,
    \"container\": {
      \"skills\": [{
        \"type\": \"custom\",
        \"skill_id\": \"skill_01AbCdEfGhIjKlMnOpQrStUv\",
        \"version\": \"$VERSION_NUMBER\"
      }]
    },
    \"messages\": [{\"role\": \"user\", \"content\": \"Use updated Skill\"}],
    \"tools\": [{\"type\": \"code_execution_20250825\", \"name\": \"code_execution\"}]
  }"

# 使用最新版本
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 4096,
    "container": {
      "skills": [{
        "type": "custom",
        "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
        "version": "latest"
      }]
    },
    "messages": [{"role": "user", "content": "Use latest Skill version"}],
    "tools": [{"type": "code_execution_20250825", "name": "code_execution"}]
  }'
```

```bash CLI nocheck
# 创建新版本
VERSION_NUMBER=$(ant beta:skills:versions create \
  --skill-id skill_01AbCdEfGhIjKlMnOpQrStUv \
  --file updated_skill/SKILL.md \
  --transform version --raw-output)

# 使用特定版本
ant beta:messages create \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 <<YAML
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - type: custom
      skill_id: skill_01AbCdEfGhIjKlMnOpQrStUv
      version: $VERSION_NUMBER
messages:
  - role: user
    content: Use updated Skill
tools:
  - type: code_execution_20250825
    name: code_execution
YAML

# 使用最新版本
ant beta:messages create \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - type: custom
      skill_id: skill_01AbCdEfGhIjKlMnOpQrStUv
      version: latest
messages:
  - role: user
    content: Use latest Skill version
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
```

```python Python nocheck
# 创建新版本
from anthropic.lib import files_from_dir

new_version = client.beta.skills.versions.create(
    skill_id="skill_01AbCdEfGhIjKlMnOpQrStUv",
    files=files_from_dir("/path/to/updated_skill"),
)

# 使用特定版本
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [
            {
                "type": "custom",
                "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
                "version": new_version.version,
            }
        ]
    },
    messages=[{"role": "user", "content": "Use updated Skill"}],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)

# 使用最新版本
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [
            {
                "type": "custom",
                "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
                "version": "latest",
            }
        ]
    },
    messages=[{"role": "user", "content": "Use latest Skill version"}],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)
```

```typescript TypeScript nocheck hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";

const client = new Anthropic();

// 使用 zip 文件创建新版本
const newVersion = await client.beta.skills.versions.create("skill_01AbCdEfGhIjKlMnOpQrStUv", {
  files: [fs.createReadStream("updated_skill.zip")]
});

// 使用特定版本
const specificVersionResponse = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [
      {
        type: "custom",
        skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv",
        version: newVersion.version
      }
    ]
  },
  messages: [{ role: "user", content: "Use updated Skill" }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});

// 使用最新版本
const latestVersionResponse = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [
      {
        type: "custom",
        skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv",
        version: "latest"
      }
    ]
  },
  messages: [{ role: "user", content: "Use latest Skill version" }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});
```

```csharp C# nocheck
using System;
using System.IO;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Messages;
using Anthropic.Models.Beta.Skills;

class Program
{
    static async Task Main()
    {
        var client = new AnthropicClient
        {
            ApiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY")
        };

        // 创建新版本
        var versionParams = new SkillVersionCreateParams
        {
            Files = [File.OpenRead("/path/to/updated_skill/SKILL.md")],
        };

        var newVersion = await client.Beta.Skills.Versions.Create(
            "skill_01AbCdEfGhIjKlMnOpQrStUv",
            versionParams
        );

        // 使用特定版本
        var specificVersionParams = new MessageCreateParams
        {
            Model = "claude-opus-4-8",
            MaxTokens = 4096,
            Betas = ["code-execution-2025-08-25", "skills-2025-10-02"],
            Container = new()
            {
                Skills =
                [
                    new()
                    {
                        Type = "custom",
                        SkillId = "skill_01AbCdEfGhIjKlMnOpQrStUv",
                        Version = newVersion.Version
                    }
                ]
            },
            Messages = [new() { Role = Role.User, Content = "Use updated Skill" }],
            Tools =
            [
                new() { Type = "code_execution_20250825", Name = "code_execution" }
            ]
        };

        var response = await client.Beta.Messages.Create(specificVersionParams);
        Console.WriteLine(response);

        // 使用最新版本
        var latestVersionParams = new MessageCreateParams
        {
            Model = "claude-opus-4-8",
            MaxTokens = 4096,
            Betas = ["code-execution-2025-08-25", "skills-2025-10-02"],
            Container = new()
            {
                Skills =
                [
                    new()
                    {
                        Type = "custom",
                        SkillId = "skill_01AbCdEfGhIjKlMnOpQrStUv",
                        Version = "latest"
                    }
                ]
            },
            Messages = [new() { Role = Role.User, Content = "Use latest Skill version" }],
            Tools =
            [
                new() { Type = "code_execution_20250825", Name = "code_execution" }
            ]
        };

        var latestResponse = await client.Beta.Messages.Create(latestVersionParams);
        Console.WriteLine(latestResponse);
    }
}
```

```go Go nocheck hidelines={1..13,87..88}
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

	// 创建新版本
	skillFile := mustOpen("/path/to/updated_skill/SKILL.md")
	defer skillFile.Close()

	newVersion, err := client.Beta.Skills.Versions.New(
		context.TODO(),
		"skill_01AbCdEfGhIjKlMnOpQrStUv",
		anthropic.BetaSkillVersionNewParams{
			Files: []io.Reader{skillFile},
		},
	)
	if err != nil {
		log.Fatal(err)
	}

	// 使用特定版本
	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas:     []anthropic.AnthropicBeta{"code-execution-2025-08-25", anthropic.AnthropicBetaSkills2025_10_02},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeCustom,
						SkillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
						Version: anthropic.String(newVersion.Version),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Use updated Skill")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)

	// 使用最新版本
	latestResponse, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas:     []anthropic.AnthropicBeta{"code-execution-2025-08-25", anthropic.AnthropicBetaSkills2025_10_02},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeCustom,
						SkillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Use latest Skill version")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(latestResponse)
}

func mustOpen(path string) *os.File {
	f, err := os.Open(path)
	if err != nil {
		log.Fatal(err)
	}
	return f
}
```

```java Java nocheck hidelines={1..4,10..13,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import com.anthropic.models.beta.skills.versions.VersionCreateParams;
import com.anthropic.models.beta.skills.versions.VersionCreateResponse;
import java.nio.file.Path;

public class SkillVersioning {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 创建新版本
        VersionCreateParams versionParams = VersionCreateParams.builder()
            .addFile(Path.of("/path/to/updated_skill/SKILL.md"))
            .build();

        VersionCreateResponse newVersion = client.beta().skills().versions()
            .create("skill_01AbCdEfGhIjKlMnOpQrStUv", versionParams);

        // 使用特定版本
        MessageCreateParams specificVersionParams = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addBeta("code-execution-2025-08-25")
            .addBeta("skills-2025-10-02")
            .container(BetaContainerParams.builder()
                .addSkill(BetaSkillParams.builder()
                    .type(BetaSkillParams.Type.CUSTOM)
                    .skillId("skill_01AbCdEfGhIjKlMnOpQrStUv")
                    .version(newVersion.version())
                    .build())
                .build())
            .addUserMessage("Use updated Skill")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build();

        BetaMessage response = client.beta().messages().create(specificVersionParams);
        System.out.println(response);

        // 使用最新版本
        MessageCreateParams latestVersionParams = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addBeta("code-execution-2025-08-25")
            .addBeta("skills-2025-10-02")
            .container(BetaContainerParams.builder()
                .addSkill(BetaSkillParams.builder()
                    .type(BetaSkillParams.Type.CUSTOM)
                    .skillId("skill_01AbCdEfGhIjKlMnOpQrStUv")
                    .version("latest")
                    .build())
                .build())
            .addUserMessage("Use latest Skill version")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build();

        BetaMessage latestResponse = client.beta().messages().create(latestVersionParams);
        System.out.println(latestResponse);
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

// 创建新版本
$newVersion = $client->beta->skills->versions->create(
    skillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
    files: [fopen("/path/to/updated_skill/SKILL.md", "r")],
);

// 使用特定版本
$response = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [['role' => 'user', 'content' => 'Use updated Skill']],
    model: 'claude-opus-4-8',
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [[
            'type' => 'custom',
            'skill_id' => 'skill_01AbCdEfGhIjKlMnOpQrStUv',
            'version' => $newVersion->version
        ]]
    ],
    tools: [['type' => 'code_execution_20250825', 'name' => 'code_execution']]
);
echo $response;

// 使用最新版本
$latestResponse = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [['role' => 'user', 'content' => 'Use latest Skill version']],
    model: 'claude-opus-4-8',
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [[
            'type' => 'custom',
            'skill_id' => 'skill_01AbCdEfGhIjKlMnOpQrStUv',
            'version' => 'latest'
        ]]
    ],
    tools: [['type' => 'code_execution_20250825', 'name' => 'code_execution']]
);
echo $latestResponse;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 创建新版本
new_version = client.beta.skills.versions.create(
  "skill_01AbCdEfGhIjKlMnOpQrStUv",
  files: [File.open("/path/to/updated_skill/SKILL.md")]
)

# 使用特定版本
response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{
      type: "custom",
      skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv",
      version: new_version.version
    }]
  },
  messages: [{ role: "user", content: "Use updated Skill" }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
)
puts response

# 使用最新版本
latest_response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{
      type: "custom",
      skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv",
      version: "latest"
    }]
  },
  messages: [{ role: "user", content: "Use latest Skill version" }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
)
puts latest_response
```
</CodeGroup>

有关完整详情，请参阅 [Create Skill Version API 参考](/docs/zh-CN/api/skills/create-skill-version)。

---

## Skills 的加载方式 \{#how-skills-are-loaded}

当您在容器中指定 Skills 时：

1. **元数据发现：** Claude 在系统提示中看到每个 Skill 的元数据（名称、描述）
2. **文件加载：** Skill 文件被复制到容器中的 `/skills/{directory}/` 路径下
3. **自动使用：** 当与您的请求相关时，Claude 会自动加载并使用 Skills
4. **组合：** 多个 Skills 可以组合在一起处理复杂的工作流

渐进式披露架构确保了高效的上下文使用：Claude 仅在需要时才加载完整的 Skill 指令。

---

## 使用场景 \{#use-cases}

### 组织级 Skills \{#organizational-skills}

**品牌与传播**
- 将公司特定的格式（颜色、字体、布局）应用于文档
- 按照组织模板生成传播内容
- 确保所有输出遵循一致的品牌指南

**项目管理**
- 使用公司特定的格式（OKR、决策日志）组织笔记
- 按照团队惯例生成任务
- 创建标准化的会议回顾和状态更新

**业务运营**
- 创建公司标准的报告、提案和分析
- 执行公司特定的分析流程
- 按照组织模板生成财务模型

### 个人 Skills \{#personal-skills}

**内容创作**
- 自定义文档模板
- 专门的格式和样式
- 特定领域的内容生成

**数据分析**
- 自定义数据处理流程
- 专门的可视化模板
- 行业特定的分析方法

**开发与自动化**
- 代码生成模板
- 测试框架
- 部署工作流

### 示例：财务建模 \{#example-financial-modeling}

组合 Excel 和自定义 DCF 分析 Skills：

<CodeGroup>

```bash cURL nocheck
# 创建自定义 DCF 分析 Skill
DCF_SKILL=$(curl -X POST "https://api.anthropic.com/v1/skills" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: skills-2025-10-02" \
  -F "display_title=DCF Analysis" \
  -F "files[]=@dcf_skill/SKILL.md;filename=dcf_skill/SKILL.md")

DCF_SKILL_ID=$(echo "$DCF_SKILL" | jq -r '.id')

# 与 Excel 配合使用以创建财务模型
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
  -H "content-type: application/json" \
  -d "{
    \"model\": \"claude-opus-4-8\",
    \"max_tokens\": 4096,
    \"container\": {
      \"skills\": [
        {
          \"type\": \"anthropic\",
          \"skill_id\": \"xlsx\",
          \"version\": \"latest\"
        },
        {
          \"type\": \"custom\",
          \"skill_id\": \"$DCF_SKILL_ID\",
          \"version\": \"latest\"
        }
      ]
    },
    \"messages\": [{
      \"role\": \"user\",
      \"content\": \"Build a DCF valuation model for a SaaS company with the attached financials\"
    }],
    \"tools\": [{
      \"type\": \"code_execution_20250825\",
      \"name\": \"code_execution\"
    }]
  }"
```

```bash CLI nocheck
# 创建自定义 DCF 分析 Skill
DCF_SKILL_ID=$(ant beta:skills create \
  --display-title "DCF Analysis" \
  --file dcf_skill/SKILL.md \
  --transform id --raw-output)

# 与 Excel 配合使用以创建财务模型
ant beta:messages create \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 <<YAML
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - type: anthropic
      skill_id: xlsx
      version: latest
    - type: custom
      skill_id: $DCF_SKILL_ID
      version: latest
messages:
  - role: user
    content: Build a DCF valuation model for a SaaS company with the attached financials
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
```

```python Python nocheck
# 创建自定义 DCF 分析 Skill
from anthropic.lib import files_from_dir

dcf_skill = client.beta.skills.create(
    display_title="DCF Analysis",
    files=files_from_dir("/path/to/dcf_skill"),
)

# 与 Excel 配合使用以创建财务模型
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [
            {"type": "anthropic", "skill_id": "xlsx", "version": "latest"},
            {"type": "custom", "skill_id": dcf_skill.id, "version": "latest"},
        ]
    },
    messages=[
        {
            "role": "user",
            "content": "Build a DCF valuation model for a SaaS company with the attached financials",
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)
print(response)
```

```typescript TypeScript nocheck
// 创建自定义 DCF 分析 Skill
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import fs from "fs";

const client = new Anthropic();

const dcfSkill = await client.beta.skills.create({
  display_title: "DCF Analysis",
  files: [await toFile(fs.createReadStream("dcf_skill.zip"), "skill.zip")]
});

// 与 Excel 结合使用以创建财务模型
const response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [
      { type: "anthropic", skill_id: "xlsx", version: "latest" },
      { type: "custom", skill_id: dcfSkill.id, version: "latest" }
    ]
  },
  messages: [
    {
      role: "user",
      content: "Build a DCF valuation model for a SaaS company with the attached financials"
    }
  ],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});
console.log(response);
```

```csharp C# nocheck hidelines={1..7}
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Messages;

var client = new AnthropicClient();

// 创建自定义 DCF 分析 Skill
var dcfSkill = await client.Beta.Skills.Create(new SkillCreateParams
{
    DisplayTitle = "DCF Analysis",
    Files = new[]
    {
        new SkillFileParam
        {
            Path = "dcf_skill/SKILL.md",
            Content = System.IO.File.ReadAllText("dcf_skill/SKILL.md")
        }
    },
});

// 与 Excel 配合使用以创建财务模型
var parameters = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 4096,
    Betas = new[] { "code-execution-2025-08-25", "skills-2025-10-02" },
    Container = new BetaContainerParams
    {
        Skills = new[]
        {
            new BetaSkillParam
            {
                Type = "anthropic",
                SkillId = "xlsx",
                Version = "latest"
            },
            new BetaSkillParam
            {
                Type = "custom",
                SkillId = dcfSkill.Id,
                Version = "latest"
            }
        }
    },
    Messages = new[]
    {
        new BetaMessageParam
        {
            Role = Role.User,
            Content = "Build a DCF valuation model for a SaaS company with the attached financials"
        }
    },
    Tools = new[]
    {
        new BetaToolParam
        {
            Type = "code_execution_20250825",
            Name = "code_execution"
        }
    }
};

var message = await client.Beta.Messages.Create(parameters);
Console.WriteLine(message);
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

	// 自定义 DCF 分析 Skill（ID 从 Skills API 创建响应中获取）
	dcfSkillID := "skill_01AbCdEfGhIjKlMnOpQrStUv"

	// 与 Excel 结合使用以创建财务模型
	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas: []anthropic.AnthropicBeta{
			"code-execution-2025-08-25",
			anthropic.AnthropicBetaSkills2025_10_02,
		},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "xlsx",
						Version: anthropic.String("latest"),
					},
					{
						Type:    anthropic.BetaSkillParamsTypeCustom,
						SkillID: dcfSkillID,
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Build a DCF valuation model for a SaaS company with the attached financials")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java nocheck hidelines={1..4,8..11,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import java.util.List;

public class CustomSkillExample {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 自定义 DCF 分析 Skill（ID 从 Skills API 创建响应中获取）
        String dcfSkillId = "skill_01AbCdEfGhIjKlMnOpQrStUv";

        // 与 Excel Skill 配合使用以创建财务模型
        MessageCreateParams params = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addBeta("code-execution-2025-08-25")
            .addBeta("skills-2025-10-02")
            .container(BetaContainerParams.builder()
                .skills(List.of(
                    BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.ANTHROPIC)
                        .skillId("xlsx")
                        .version("latest")
                        .build(),
                    BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.CUSTOM)
                        .skillId(dcfSkillId)
                        .version("latest")
                        .build()
                ))
                .build())
            .addUserMessage("Build a DCF valuation model for a SaaS company with the attached financials")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build();

        BetaMessage response = client.beta().messages().create(params);
        System.out.println(response);
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

// 自定义 DCF 分析 Skill（ID 从 Skills API 创建响应中获取）
$dcfSkillId = "skill_01AbCdEfGhIjKlMnOpQrStUv";

// 与 Excel 配合使用以创建财务模型
$message = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => 'Build a DCF valuation model for a SaaS company with the attached financials']
    ],
    model: 'claude-opus-4-8',
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [
            ['type' => 'anthropic', 'skill_id' => 'xlsx', 'version' => 'latest'],
            ['type' => 'custom', 'skill_id' => $dcfSkillId, 'version' => 'latest']
        ]
    ],
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution']
    ]
);
echo $message;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 创建自定义 DCF 分析 Skill
dcf_skill = client.beta.skills.create(
  display_title: "DCF Analysis",
  files: [
    File.open("dcf_skill/SKILL.md", "rb")
  ]
)

# 与 Excel 配合使用以创建财务模型
response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [
      { type: "anthropic", skill_id: "xlsx", version: "latest" },
      { type: "custom", skill_id: dcf_skill.id, version: "latest" }
    ]
  },
  messages: [
    { role: "user", content: "Build a DCF valuation model for a SaaS company with the attached financials" }
  ],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
)
puts response
```
</CodeGroup>

---

## 限制与约束 \{#limits-and-constraints}

### 请求限制 \{#request-limits}
- **每个请求的最大 Skills 数量：** 8
- **Skill 上传的最大大小：** 30&nbsp;MB（所有文件合计）
- **YAML frontmatter 要求：**
  - `name`：最多 64 个字符，仅限小写字母/数字/连字符，不含 XML 标签，不含保留词（"anthropic"、"claude"）
  - `description`：最多 1024 个字符，非空，不含 XML 标签

### 环境约束 \{#environment-constraints}
Skills 在代码执行容器中运行，具有以下限制：
- **无网络访问：** 无法进行外部 API 调用
- **无运行时包安装：** 仅可使用预安装的包
- **隔离环境：** 容器是隔离的；除非您指定现有的容器 ID，否则会创建一个新的容器

有关可用的包，请参阅[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)。

---

## 最佳实践 \{#best-practices}

### 何时使用多个 Skills \{#when-to-use-multiple-skills}

当任务涉及多种文档类型或领域时，组合使用 Skills：

**适用场景：**
- 数据分析（Excel）+ 演示文稿创建（PowerPoint）
- 报告生成（Word）+ 导出为 PDF
- 自定义领域逻辑 + 文档生成

**应避免：**
- 包含未使用的 Skills（会影响性能）

### 版本管理策略 \{#version-management-strategy}

**用于生产环境：**

```python nocheck
# 固定到特定版本以确保稳定性
container = {
    "skills": [
        {
            "type": "custom",
            "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
            "version": "1759178010641129",  # Specific version
        }
    ]
}
```

**用于开发环境：**

```python nocheck
# 在积极开发阶段使用 latest
container = {
    "skills": [
        {
            "type": "custom",
            "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
            "version": "latest",  # Always get newest
        }
    ]
}
```

### 提示缓存注意事项 \{#prompt-caching-considerations}

使用提示缓存时，请注意更改容器中的 Skills 列表会使缓存失效：

<CodeGroup>
```bash cURL
# 第一个请求创建缓存
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02,prompt-caching-2024-07-31" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 4096,
    "container": {
      "skills": [
        {"type": "anthropic", "skill_id": "xlsx", "version": "latest"}
      ]
    },
    "messages": [{"role": "user", "content": "Analyze sales data"}],
    "tools": [{"type": "code_execution_20250825", "name": "code_execution"}]
  }'

# 添加/移除技能会使缓存失效
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02,prompt-caching-2024-07-31" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 4096,
    "container": {
      "skills": [
        {"type": "anthropic", "skill_id": "xlsx", "version": "latest"},
        {"type": "anthropic", "skill_id": "pptx", "version": "latest"}
      ]
    },
    "messages": [{"role": "user", "content": "Create a presentation"}],
    "tools": [{"type": "code_execution_20250825", "name": "code_execution"}]
  }'
```

```bash CLI
# 第一个请求创建缓存
ant beta:messages create \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 \
  --beta prompt-caching-2024-07-31 <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - type: anthropic
      skill_id: xlsx
      version: latest
messages:
  - role: user
    content: Analyze sales data
tools:
  - type: code_execution_20250825
    name: code_execution
YAML

# 添加/移除技能会使缓存失效
ant beta:messages create \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 \
  --beta prompt-caching-2024-07-31 <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - type: anthropic
      skill_id: xlsx
      version: latest
    - type: anthropic
      skill_id: pptx
      version: latest
messages:
  - role: user
    content: Create a presentation
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
```

```python Python
# 第一个请求创建缓存
response1 = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=[
        "code-execution-2025-08-25",
        "skills-2025-10-02",
        "prompt-caching-2024-07-31",
    ],
    container={
        "skills": [{"type": "anthropic", "skill_id": "xlsx", "version": "latest"}]
    },
    messages=[{"role": "user", "content": "Analyze sales data"}],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)

# 添加/移除技能会使缓存失效
response2 = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    betas=[
        "code-execution-2025-08-25",
        "skills-2025-10-02",
        "prompt-caching-2024-07-31",
    ],
    container={
        "skills": [
            {"type": "anthropic", "skill_id": "xlsx", "version": "latest"},
            {
                "type": "anthropic",
                "skill_id": "pptx",
                "version": "latest",
            },  # Cache miss
        ]
    },
    messages=[{"role": "user", "content": "Create a presentation"}],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)
```

```typescript TypeScript
// 第一个请求创建缓存
const response1 = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02", "prompt-caching-2024-07-31"],
  container: {
    skills: [{ type: "anthropic", skill_id: "xlsx", version: "latest" }]
  },
  messages: [{ role: "user", content: "Analyze sales data" }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});

// 添加/移除 Skills 会使缓存失效
const response2 = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02", "prompt-caching-2024-07-31"],
  container: {
    skills: [
      { type: "anthropic", skill_id: "xlsx", version: "latest" },
      { type: "anthropic", skill_id: "pptx", version: "latest" } // Cache miss
    ]
  },
  messages: [{ role: "user", content: "Create a presentation" }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});
```

```csharp C# nocheck hidelines={1..7}
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Messages;

var client = new AnthropicClient();

// 第一个请求创建缓存
var parameters1 = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 4096,
    Betas = new[] { "code-execution-2025-08-25", "skills-2025-10-02", "prompt-caching-2024-07-31" },
    Container = new BetaContainer
    {
        Skills = new[]
        {
            new BetaSkill { Type = "anthropic", SkillId = "xlsx", Version = "latest" }
        }
    },
    Messages = new[] { new BetaMessageParam { Role = Role.User, Content = "Analyze sales data" } },
    Tools = new[] { new BetaTool { Type = "code_execution_20250825", Name = "code_execution" } }
};
var response1 = await client.Beta.Messages.Create(parameters1);
Console.WriteLine(response1);

// 添加/移除 Skills 会使缓存失效
var parameters2 = new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 4096,
    Betas = new[] { "code-execution-2025-08-25", "skills-2025-10-02", "prompt-caching-2024-07-31" },
    Container = new BetaContainer
    {
        Skills = new[]
        {
            new BetaSkill { Type = "anthropic", SkillId = "xlsx", Version = "latest" },
            new BetaSkill { Type = "anthropic", SkillId = "pptx", Version = "latest" }
        }
    },
    Messages = new[] { new BetaMessageParam { Role = Role.User, Content = "Create a presentation" } },
    Tools = new[] { new BetaTool { Type = "code_execution_20250825", Name = "code_execution" } }
};
var response2 = await client.Beta.Messages.Create(parameters2);
Console.WriteLine(response2);
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

	// 第一个请求创建缓存
	response1, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas: []anthropic.AnthropicBeta{
			"code-execution-2025-08-25",
			anthropic.AnthropicBetaSkills2025_10_02,
			anthropic.AnthropicBetaPromptCaching2024_07_31,
		},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "xlsx",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Analyze sales data")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response1)

	// 添加/移除技能会使缓存失效
	response2, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas: []anthropic.AnthropicBeta{
			"code-execution-2025-08-25",
			anthropic.AnthropicBetaSkills2025_10_02,
			anthropic.AnthropicBetaPromptCaching2024_07_31,
		},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "xlsx",
						Version: anthropic.String("latest"),
					},
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "pptx",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Create a presentation")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response2)
}
```

```java Java hidelines={1..4,8..11,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import java.util.List;

public class SkillsCaching {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 第一个请求创建缓存
        MessageCreateParams params1 = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addBeta("code-execution-2025-08-25")
            .addBeta("skills-2025-10-02")
            .addBeta("prompt-caching-2024-07-31")
            .container(BetaContainerParams.builder()
                .skills(List.of(
                    BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.ANTHROPIC)
                        .skillId("xlsx")
                        .version("latest")
                        .build()
                ))
                .build())
            .addUserMessage("Analyze sales data")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build();

        BetaMessage response1 = client.beta().messages().create(params1);
        System.out.println(response1);

        // 添加/移除 Skills 会使缓存失效
        MessageCreateParams params2 = MessageCreateParams.builder()
            .model("claude-opus-4-8")
            .maxTokens(4096L)
            .addBeta("code-execution-2025-08-25")
            .addBeta("skills-2025-10-02")
            .addBeta("prompt-caching-2024-07-31")
            .container(BetaContainerParams.builder()
                .skills(List.of(
                    BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.ANTHROPIC)
                        .skillId("xlsx")
                        .version("latest")
                        .build(),
                    BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.ANTHROPIC)
                        .skillId("pptx")
                        .version("latest")
                        .build()
                ))
                .build())
            .addUserMessage("Create a presentation")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build();

        BetaMessage response2 = client.beta().messages().create(params2);
        System.out.println(response2);
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

// 第一个请求创建缓存
$response1 = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => 'Analyze sales data']
    ],
    model: 'claude-opus-4-8',
    betas: [
        'code-execution-2025-08-25',
        'skills-2025-10-02',
        'prompt-caching-2024-07-31'
    ],
    container: [
        'skills' => [
            ['type' => 'anthropic', 'skill_id' => 'xlsx', 'version' => 'latest']
        ]
    ],
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution']
    ]
);
echo $response1;

// 添加/移除技能会使缓存失效
$response2 = $client->beta->messages->create(
    maxTokens: 4096,
    messages: [
        ['role' => 'user', 'content' => 'Create a presentation']
    ],
    model: 'claude-opus-4-8',
    betas: [
        'code-execution-2025-08-25',
        'skills-2025-10-02',
        'prompt-caching-2024-07-31'
    ],
    container: [
        'skills' => [
            ['type' => 'anthropic', 'skill_id' => 'xlsx', 'version' => 'latest'],
            ['type' => 'anthropic', 'skill_id' => 'pptx', 'version' => 'latest']
        ]
    ],
    tools: [
        ['type' => 'code_execution_20250825', 'name' => 'code_execution']
    ]
);
echo $response2;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 第一个请求创建缓存
response1 = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: [
    "code-execution-2025-08-25",
    "skills-2025-10-02",
    "prompt-caching-2024-07-31"
  ],
  container: {
    skills: [{ type: "anthropic", skill_id: "xlsx", version: "latest" }]
  },
  messages: [{ role: "user", content: "Analyze sales data" }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
)
puts response1

# 添加/移除技能会使缓存失效
response2 = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  betas: [
    "code-execution-2025-08-25",
    "skills-2025-10-02",
    "prompt-caching-2024-07-31"
  ],
  container: {
    skills: [
      { type: "anthropic", skill_id: "xlsx", version: "latest" },
      { type: "anthropic", skill_id: "pptx", version: "latest" }
    ]
  },
  messages: [{ role: "user", content: "Create a presentation" }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
)
puts response2
```
</CodeGroup>

为获得最佳缓存性能，请在各个请求之间保持 Skills 列表一致。

### 错误处理 \{#error-handling}

优雅地处理与 Skill 相关的错误：

<CodeGroup>

```bash CLI nocheck
if ! RESULT=$(ant beta:messages create \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 \
  --transform-error error.message --format-error yaml 2>&1 <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
container:
  skills:
    - type: custom
      skill_id: skill_01AbCdEfGhIjKlMnOpQrStUv
      version: latest
messages:
  - role: user
    content: Process data
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
); then
  case "$RESULT" in
    *skill*)
      printf 'Skill error: %s\n' "$RESULT"
      # 处理技能特定的错误
      ;;
    *)
      printf '%s\n' "$RESULT" >&2
      exit 1
      ;;
  esac
fi
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

try:
    response = client.beta.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        betas=["code-execution-2025-08-25", "skills-2025-10-02"],
        container={
            "skills": [
                {
                    "type": "custom",
                    "skill_id": "skill_01AbCdEfGhIjKlMnOpQrStUv",
                    "version": "latest",
                }
            ]
        },
        messages=[{"role": "user", "content": "Process data"}],
        tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
    )
except anthropic.BadRequestError as e:
    if "skill" in str(e):
        print(f"Skill error: {e}")
        # 处理技能特定的错误
    else:
        raise
```

```typescript TypeScript nocheck
try {
  const response = await client.beta.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
    container: {
      skills: [
        { type: "custom", skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv", version: "latest" }
      ]
    },
    messages: [{ role: "user", content: "Process data" }],
    tools: [{ type: "code_execution_20250825", name: "code_execution" }]
  });
  console.log(response);
} catch (error) {
  if (error instanceof Anthropic.BadRequestError && error.message.includes("skill")) {
    console.error(`Skill error: ${error.message}`);
    // 处理技能特定的错误
  } else {
    throw error;
  }
}
```

```csharp C# nocheck
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Messages;

class Program
{
    static async Task Main(string[] args)
    {
        var client = new AnthropicClient();

        try
        {
            var parameters = new MessageCreateParams
            {
                Model = "claude-opus-4-8",
                MaxTokens = 4096,
                Betas = ["code-execution-2025-08-25", "skills-2025-10-02"],
                Container = new BetaContainerParams
                {
                    Skills = [
                        new BetaSkillParam
                        {
                            Type = "custom",
                            SkillId = "skill_01AbCdEfGhIjKlMnOpQrStUv",
                            Version = "latest"
                        }
                    ]
                },
                Messages = [new() { Role = Role.User, Content = "Process data" }],
                Tools = [new BetaToolParam { Type = "code_execution_20250825", Name = "code_execution" }]
            };

            var message = await client.Beta.Messages.Create(parameters);
            Console.WriteLine(message);
        }
        catch (Exception e) when (e.Message.Contains("skill"))
        {
            Console.WriteLine($"Skill error: {e.Message}");
        }
    }
}
```

```go Go nocheck hidelines={1..14,-1}
package main

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, err := client.Beta.Messages.New(context.TODO(), anthropic.BetaMessageNewParams{
		Model:     "claude-opus-4-8",
		MaxTokens: 4096,
		Betas:     []anthropic.AnthropicBeta{"code-execution-2025-08-25", anthropic.AnthropicBetaSkills2025_10_02},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeCustom,
						SkillID: "skill_01AbCdEfGhIjKlMnOpQrStUv",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Process data")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
		},
	})

	if err != nil {
		if strings.Contains(err.Error(), "skill") {
			fmt.Printf("Skill error: %v\n", err)
		} else {
			log.Fatal(err)
		}
		return
	}
	fmt.Println(response)
}
```

```java Java nocheck hidelines={1..4,8..10,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.MessageCreateParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;

public class SkillErrorHandling {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        try {
            MessageCreateParams params = MessageCreateParams.builder()
                .model("claude-opus-4-8")
                .maxTokens(4096L)
                .addBeta("code-execution-2025-08-25")
                .addBeta("skills-2025-10-02")
                .container(BetaContainerParams.builder()
                    .addSkill(BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.CUSTOM)
                        .skillId("skill_01AbCdEfGhIjKlMnOpQrStUv")
                        .version("latest")
                        .build())
                    .build())
                .addUserMessage("Process data")
                .addTool(BetaCodeExecutionTool20250825.builder().build())
                .build();

            BetaMessage response = client.beta().messages().create(params);
            System.out.println(response);
        } catch (Exception e) {
            if (e.getMessage().contains("skill")) {
                System.err.println("Skill error: " + e.getMessage());
            } else {
                throw e;
            }
        }
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

try {
    $message = $client->beta->messages->create(
        maxTokens: 4096,
        messages: [
            ['role' => 'user', 'content' => 'Process data']
        ],
        model: 'claude-opus-4-8',
        betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
        container: [
            'skills' => [
                [
                    'type' => 'custom',
                    'skill_id' => 'skill_01AbCdEfGhIjKlMnOpQrStUv',
                    'version' => 'latest'
                ]
            ]
        ],
        tools: [
            ['type' => 'code_execution_20250825', 'name' => 'code_execution']
        ]
    );
    echo $message->content[0]->text;
} catch (Exception $e) {
    if (str_contains($e->getMessage(), 'skill')) {
        echo "Skill error: " . $e->getMessage();
    } else {
        throw $e;
    }
}
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

begin
  response = client.beta.messages.create(
    model: "claude-opus-4-8",
    max_tokens: 4096,
    betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
    container: {
      skills: [
        {
          type: "custom",
          skill_id: "skill_01AbCdEfGhIjKlMnOpQrStUv",
          version: "latest"
        }
      ]
    },
    messages: [{ role: "user", content: "Process data" }],
    tools: [{ type: "code_execution_20250825", name: "code_execution" }]
  )
rescue Anthropic::Errors::BadRequestError => e
  if e.message.include?("skill")
    puts "Skill error: #{e.message}"
  else
    raise
  end
end
```
</CodeGroup>

---

## 数据保留 \{#data-retention}

Agent Skills 不在 ZDR 协议的覆盖范围内。Skill 定义和执行数据将根据 Anthropic 的标准数据保留政策进行保留。

有关所有功能的 ZDR 适用性，请参阅 [API 与数据保留](/docs/zh-CN/manage-claude/api-and-data-retention)。

## 后续步骤 \{#next-steps}

<CardGroup cols={2}>
  <Card
    title="API 参考"
    icon="book"
    href="/docs/zh-CN/api/skills/create-skill"
  >
    包含所有端点的完整 API 参考
  </Card>
  <Card
    title="编写指南"
    icon="edit"
    href="/docs/zh-CN/agents-and-tools/agent-skills/best-practices"
  >
    编写高效 Skills 的最佳实践
  </Card>
  <Card
    title="代码执行工具"
    icon="terminal"
    href="/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool"
  >
    了解代码执行环境
  </Card>
</CardGroup>