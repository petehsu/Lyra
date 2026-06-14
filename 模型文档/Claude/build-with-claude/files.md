# Files API

---

Files API 允许您上传和管理文件，以便在 Claude API 中使用，而无需在每次请求时重新上传内容。这在使用[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)时特别有用，可以提供输入（例如数据集和文档），然后下载输出（例如图表）。您还可以使用 Files API 避免在多个 API 调用中反复重新上传常用的文档和图片。除了本指南外，您还可以[直接查阅 API 参考文档](/docs/zh-CN/api/files-create)。

<Note>
Files API 目前处于测试阶段。请通过[反馈表单](https://forms.gle/tisHyierGwgN4DUE9)与我们分享您使用 Files API 的体验。
</Note>

<Note>
此功能**不**符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。数据将根据该功能的标准保留策略进行保留。
</Note>

## 支持的模型 \{#supported-models}

在 Messages 请求中引用 `file_id` 的功能在所有支持相应文件类型的模型上均可用。[图片](/docs/zh-CN/build-with-claude/vision)在所有当前的 Claude 模型上均受支持。对于 [PDF](/docs/zh-CN/build-with-claude/pdf-support) 和[代码执行工具支持的其他文件类型](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool#model-compatibility)，请参阅链接页面了解模型支持情况。

Files API 可在 Claude API、[AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上使用。目前在 Amazon Bedrock 或 Vertex AI 上不可用。

## Files API 的工作原理 \{#how-the-files-api-works}

Files API 提供了一种简单的"一次创建，多次使用"的文件处理方式：

- **上传文件**到 Anthropic 的安全存储，并获得唯一的 `file_id`
- **下载文件**，即由技能或代码执行工具创建的文件
- 在 [Messages](/docs/zh-CN/api/messages/create) 请求中使用 `file_id` **引用文件**，而无需重新上传内容
- 通过列出、检索和删除操作**管理您的文件**

## 如何使用 Files API \{#how-to-use-the-files-api}

<Note>
要使用 Files API，您需要包含测试版功能标头：`anthropic-beta: files-api-2025-04-14`。
</Note>

### 上传文件 \{#uploading-a-file}

上传文件以便在后续 API 调用中引用：

<CodeGroup>

````bash
curl -X POST https://api.anthropic.com/v1/files \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14" \
  -F "file=@/path/to/document.pdf"
````

````bash
FILE_ID=$(ant beta:files upload \
  --file /path/to/document.pdf \
  --transform id --raw-output)
````

````python
uploaded = client.beta.files.upload(
    file=("document.pdf", open("/path/to/document.pdf", "rb"), "application/pdf"),
)
````

````typescript
const uploaded = await client.beta.files.upload({
  file: await toFile(
    fs.createReadStream("/path/to/document.pdf"),
    undefined,
    { type: "application/pdf" },
  ),
});
````

````csharp
var uploaded = await client.Beta.Files.Upload(
    new FileUploadParams
    {
        File = new BinaryContent
        {
            Stream = File.OpenRead("/path/to/document.pdf"),
            FileName = "document.pdf",
            ContentType = new("application/pdf")
        }
    });

Console.WriteLine(uploaded.ID);
````

````go
f, err := os.Open("/path/to/document.pdf")
if err != nil {
	log.Fatal(err)
}
defer f.Close()

response, err := client.Beta.Files.Upload(context.Background(),
	anthropic.BetaFileUploadParams{
		File: anthropic.File(f, "document.pdf", "application/pdf"),
	})
if err != nil {
	log.Fatal(err)
}

fmt.Println(response.ID)
````

````java
FileMetadata file = client.beta().files().upload(
    FileUploadParams.builder()
        .file(MultipartField.<InputStream>builder()
            .value(Files.newInputStream(Path.of("/path/to/document.pdf")))
            .filename("document.pdf")
            .contentType("application/pdf")
            .build())
        .build()
);

System.out.println(file.id());
````

````php
$file = $client->beta->files->upload(
    FileParam::fromResource(fopen('/path/to/document.pdf', 'rb'), contentType: 'application/pdf'),
);

echo $file->id;
````

````ruby
file = client.beta.files.upload(
  file: Anthropic::FilePart.new(
    Pathname("/path/to/document.pdf"),
    content_type: "application/pdf"
  )
)

puts file.id
````

</CodeGroup>

上传文件的响应将包含：

```json Output
{
  "id": "file_011CNha8iCJcU1wXNR6q4V8w",
  "type": "file",
  "filename": "document.pdf",
  "mime_type": "application/pdf",
  "size_bytes": 1024000,
  "created_at": "2025-01-01T00:00:00Z",
  "downloadable": false
}
```

### 在消息中使用文件 \{#using-a-file-in-messages}

上传后，使用文件的 `file_id` 引用该文件：

<CodeGroup>

````bash
curl -X POST https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14" \
  -H "content-type: application/json" \
  -d @- <<EOF
{
  "model": "claude-opus-4-8",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Please summarize this document for me."
        },
        {
          "type": "document",
          "source": {
            "type": "file",
            "file_id": "$FILE_ID"
          }
        }
      ]
    }
  ]
}
EOF
````

````bash
ant beta:messages create --beta files-api-2025-04-14 <<YAML
model: claude-opus-4-8
max_tokens: 1024
messages:
  - role: user
    content:
      - type: text
        text: Please summarize this document for me.
      - type: document
        source:
          type: file
          file_id: $FILE_ID
YAML
````

````python
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Please summarize this document for me."},
                {
                    "type": "document",
                    "source": {
                        "type": "file",
                        "file_id": file_id,
                    },
                },
            ],
        }
    ],
    betas=["files-api-2025-04-14"],
)
print(response)
````

````typescript
const response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Please summarize this document for me.",
        },
        {
          type: "document",
          source: {
            type: "file",
            file_id: uploaded.id,
          },
        },
      ],
    },
  ],
  betas: ["files-api-2025-04-14"],
});

console.log(response);
````

````csharp
var response = await client.Beta.Messages.Create(
    new MessageCreateParams
    {
        Model = Messages::Model.ClaudeOpus4_6,
        MaxTokens = 1024,
        Betas = [AnthropicBeta.FilesApi2025_04_14],
        Messages =
        [
            new BetaMessageParam
            {
                Role = Role.User,
                Content = new List<BetaContentBlockParam>
                {
                    new BetaTextBlockParam { Text = "Please summarize this document for me." },
                    new BetaRequestDocumentBlock
                    {
                        Source = new BetaFileDocumentSource { FileID = fileId }
                    }
                }
            }
        ]
    });

Console.WriteLine(response);
````

````go
msg, err := client.Beta.Messages.New(context.Background(),
	anthropic.BetaMessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_6,
		MaxTokens: 1024,
		Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaFilesAPI2025_04_14},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(
				anthropic.NewBetaTextBlock("Please summarize this document for me."),
				anthropic.NewBetaDocumentBlock(anthropic.BetaFileDocumentSourceParam{
					FileID: fileID,
				}),
			),
		},
	})
if err != nil {
	log.Fatal(err)
}

fmt.Println(msg)
````

````java
MessageCreateParams params = MessageCreateParams.builder()
    .model(Model.CLAUDE_OPUS_4_8)
    .addBeta("files-api-2025-04-14")
    .maxTokens(1024)
    .addUserMessageOfBetaContentBlockParams(List.of(
        BetaContentBlockParam.ofText(BetaTextBlockParam.builder()
            .text("Please summarize this document for me.")
            .build()),
        BetaContentBlockParam.ofDocument(BetaRequestDocumentBlock.builder()
            .source(BetaFileDocumentSource.builder()
                .fileId(fileId)
                .build())
            .build())
    ))
    .build();

BetaMessage message = client.beta().messages().create(params);
System.out.println(message);
````

````php
$response = $client->beta->messages->create(
    maxTokens: 1024,
    messages: [
        [
            'role' => 'user',
            'content' => [
                ['type' => 'text', 'text' => 'Please summarize this document for me.'],
                [
                    'type' => 'document',
                    'source' => [
                        'type' => 'file',
                        'file_id' => $fileId
                    ]
                ]
            ]
        ]
    ],
    model: 'claude-opus-4-8',
    betas: ['files-api-2025-04-14'],
);

print_r($response);
````

````ruby
response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  betas: ["files-api-2025-04-14"],
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Please summarize this document for me." },
        {
          type: "document",
          source: {
            type: "file",
            file_id: file_id
          }
        }
      ]
    }
  ]
)

puts response
````

</CodeGroup>

### 文件类型和内容块 \{#file-types-and-content-blocks}

Files API 支持不同的文件类型，对应不同的内容块类型：

| 文件类型 | MIME 类型 | 内容块类型 | 使用场景 |
| :--- | :--- | :--- | :--- |
| PDF | `application/pdf` | `document` | 文本分析、文档处理 |
| 纯文本 | `text/plain` | `document` | 文本分析、处理 |
| 图片 | `image/jpeg`、`image/png`、`image/gif`、`image/webp` | `image` | 图像分析、视觉任务 |
| [数据集及其他](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool#upload-and-analyze-your-own-files) | 多种类型 | `container_upload` | 分析数据、创建可视化图表 |

### 处理其他文件格式 \{#working-with-other-file-formats}

对于不支持作为 `document` 块的文件类型（.csv、.txt、.md、.docx、.xlsx），请将文件转换为纯文本，并将内容直接包含在您的消息中：

<CodeGroup>
```bash cURL hidelines={3..4}
# 示例：读取文本文件并将其作为纯文本发送
# 注意：对于包含特殊字符的文件，请考虑使用 base64 编码
TEXT_CONTENT="This is a sample document. It has multiple lines."

curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d @- <<EOF
{
  "model": "claude-opus-4-8",
  "max_tokens": 1024,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "Here's the document content:\n\n${TEXT_CONTENT}\n\nPlease summarize this document."
        }
      ]
    }
  ]
}
EOF
```

```bash CLI hidelines={1}
printf 'This is a test document for upload.\n' > document.txt
# "@./path" 引用会将文件内容直接内联到该字段中。
ant messages create \
  --model claude-opus-4-8 \
  --max-tokens 1024 \
  --transform 'content.0.text' --raw-output <<'YAML'
messages:
  - role: user
    content:
      - type: text
        text: "Here's the document content:"
      - type: text
        text: "@./document.txt"
      - type: text
        text: "Please summarize this document."
YAML
```

```python Python nocheck hidelines={2..5}
import pandas as pd
import anthropic

client = anthropic.Anthropic()

# 示例：读取 CSV 文件
df = pd.read_csv("data.csv")
csv_content = df.to_string()

# 作为纯文本在消息中发送
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": f"Here's the CSV data:\n\n{csv_content}\n\nPlease analyze this data.",
                }
            ],
        }
    ],
)

print(response.content[0].text)
```

```typescript TypeScript nocheck hidelines={1}
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs/promises";

const anthropic = new Anthropic();

async function analyzeDocument() {
  // 示例：读取文本文件
  const textContent = await fs.readFile("document.txt", "utf-8");

  // 作为纯文本在消息中发送
  const response = await anthropic.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Here's the document content:\n\n${textContent}\n\nPlease summarize this document.`
          }
        ]
      }
    ]
  });

  const block = response.content[0];
  if (block.type === "text") {
    console.log(block.text);
  }
}

analyzeDocument();
```

```csharp C# nocheck
using System;
using System.IO;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Messages;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        // 示例：读取文本文件
        string textContent = await File.ReadAllTextAsync("document.txt");

        var parameters = new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 1024,
            Messages = [new()
            {
                Role = Role.User,
                Content = $"Here's the document content:\n\n{textContent}\n\nPlease summarize this document."
            }]
        };

        var message = await client.Messages.Create(parameters);
        Console.WriteLine(message);
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
	os.WriteFile("document.txt", []byte("This is a test document for upload."), 0644)
}

func main() {
	client := anthropic.NewClient()

	// 示例：读取文本文件
	textContent, err := os.ReadFile("document.txt")
	if err != nil {
		log.Fatal(err)
	}

	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 1024,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock(
				fmt.Sprintf("Here's the document content:\n\n%s\n\nPlease summarize this document.", string(textContent)),
			)),
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	fmt.Println(response.Content[0].Text)
}
```

```java Java nocheck hidelines={1..11,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.io.IOException;

public class FileUploadExample {
    public static void main(String[] args) throws IOException {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 示例：读取文本文件
        String textContent = Files.readString(Paths.get("document.txt"));

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(1024L)
            .addUserMessage("Here's the document content:\n\n" + textContent + "\n\nPlease summarize this document.")
            .build();

        Message response = client.messages().create(params);
        response.content().stream()
            .flatMap(block -> block.text().stream())
            .forEach(textBlock -> System.out.println(textBlock.text()));
    }
}
```

```php PHP hidelines={1..4} nocheck
<?php

use Anthropic\Client;

$client = new Client();

// 示例：读取文本文件
$textContent = file_get_contents("document.txt");

$message = $client->messages->create(
    maxTokens: 1024,
    messages: [
        [
            'role' => 'user',
            'content' => [
                [
                    'type' => 'text',
                    'text' => "Here's the document content:\n\n{$textContent}\n\nPlease summarize this document."
                ]
            ]
        ]
    ],
    model: 'claude-opus-4-8',
);

echo $message->content[0]->text;
```

```ruby Ruby nocheck hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

# 示例：读取文本文件
text_content = File.read("document.txt")

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Here's the document content:\n\n#{text_content}\n\nPlease summarize this document."
        }
      ]
    }
  ]
)

puts message.content.first.text
```
</CodeGroup>

<Note>
对于包含图片的 .docx 文件，请先将其转换为 PDF 格式，然后使用 [PDF 支持](/docs/zh-CN/build-with-claude/pdf-support)以利用内置的图片解析功能。这样可以使用来自 PDF 文档的引用。
</Note>

#### Document 块 \{#document-blocks}

对于 PDF 和文本文件，请使用 `document` 内容块：

```json
{
  "type": "document",
  "source": {
    "type": "file",
    "file_id": "file_011CNha8iCJcU1wXNR6q4V8w"
  },
  "title": "Document Title", // Optional
  "context": "Context about the document", // Optional
  "citations": { "enabled": true } // Optional, enables citations
}
```

#### Image 块 \{#image-blocks}

对于图片，请使用 `image` 内容块：

```json
{
  "type": "image",
  "source": {
    "type": "file",
    "file_id": "file_011CPMxVD3fHLUhvTqtsQA5w"
  }
}
```

### 管理文件 \{#managing-files}

#### 列出文件 \{#list-files}

检索您已上传文件的列表：

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/files \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14"
```

```bash CLI nocheck
ant beta:files list
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()
files = client.beta.files.list()
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();
const files = await anthropic.beta.files.list();
```

```csharp C#
using System;
using System.Threading.Tasks;
using Anthropic;
using Anthropic.Models.Beta.Files;

class Program
{
    static async Task Main(string[] args)
    {
        AnthropicClient client = new();

        var files = await client.Beta.Files.List();
        Console.WriteLine(files);
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

	files, err := client.Beta.Files.List(context.TODO(), anthropic.BetaFileListParams{})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(files)
}
```

```java Java hidelines={1..2,4..6,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.files.FileListPage;

public class ListFiles {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        FileListPage files = client.beta().files().list();
        System.out.println(files);
    }
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$files = $client->beta->files->list();
print_r($files);
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

files = client.beta.files.list
puts files
```
</CodeGroup>

#### 获取文件元数据 \{#get-file-metadata}

检索特定文件的信息：

<CodeGroup>

````bash
curl "https://api.anthropic.com/v1/files/$FILE_ID" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14"
````

````bash
ant beta:files retrieve-metadata \
  --file-id "$FILE_ID"
````

````python
file = client.beta.files.retrieve_metadata(file_id)
````

````typescript
const file = await client.beta.files.retrieveMetadata(uploaded.id);
````

````csharp
var file = await client.Beta.Files.RetrieveMetadata(fileId);
Console.WriteLine(file);
````

````go
metadata, err := client.Beta.Files.GetMetadata(
	context.TODO(),
	fileID,
	anthropic.BetaFileGetMetadataParams{},
)
if err != nil {
	log.Fatal(err)
}

fmt.Println(metadata)
````

````java
FileMetadata metadata = client.beta().files().retrieveMetadata(fileId);

System.out.println(metadata);
````

````php
$file = $client->beta->files->retrieveMetadata($fileId);
echo $file;
````

````ruby
file = client.beta.files.retrieve_metadata(file_id)
puts file
````

</CodeGroup>

#### 删除文件 \{#delete-a-file}

从您的工作区中移除文件：

<CodeGroup>

````bash
curl -X DELETE "https://api.anthropic.com/v1/files/$FILE_ID" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14"
````

````bash
ant beta:files delete \
  --file-id "$FILE_ID"
````

````python
result = client.beta.files.delete(file_id)
````

````typescript
await client.beta.files.delete(uploaded.id);
````

````csharp
await client.Beta.Files.Delete(fileId);
````

````go
_, err = client.Beta.Files.Delete(
	context.TODO(),
	fileID,
	anthropic.BetaFileDeleteParams{},
)
if err != nil {
	log.Fatal(err)
}
````

````java
client.beta().files().delete(fileId);
````

````php
$result = $client->beta->files->delete($fileId);
````

````ruby
result = client.beta.files.delete(file_id)
````

</CodeGroup>

### 下载文件 \{#downloading-a-file}

下载由技能或代码执行工具创建的文件：

<CodeGroup>

````bash
curl -X GET "https://api.anthropic.com/v1/files/$FILE_ID/content" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14" \
  --output downloaded_file.txt
````

````bash
ant beta:files download \
  --file-id "$FILE_ID" \
  --output downloaded_file.txt
````

````python
file_content = client.beta.files.download(file_id)

# 保存到文件
file_content.write_to_file("downloaded_file.txt")
````

````typescript
const content = await client.beta.files.download(uploaded.id);

const bytes = Buffer.from(await content.arrayBuffer());
await fsp.writeFile("downloaded_file.txt", bytes);
````

````csharp
using var fileContent = await client.Beta.Files.Download(fileId);
await using var source = await fileContent.ReadAsStream();
await using var destination = File.Create("downloaded_file.txt");
await source.CopyToAsync(destination);
````

````go
func downloadFile(client anthropic.Client, fileID string) error {
	resp, err := client.Beta.Files.Download(
		context.TODO(),
		fileID,
		anthropic.BetaFileDownloadParams{},
	)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	fileContent, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	return os.WriteFile("downloaded_file.txt", fileContent, 0644)
}

````

````java
try (HttpResponse response = client.beta().files().download(fileId)) {
    try (InputStream body = response.body()) {
        Files.copy(body, Path.of("downloaded_file.txt"),
            StandardCopyOption.REPLACE_EXISTING);
    }
}
````

````php
$fileContent = $client->beta->files->download($fileId);

file_put_contents("downloaded_file.txt", $fileContent);
````

````ruby
file_content = client.beta.files.download(file_id)

File.binwrite("downloaded_file.txt", file_content.read)
````

</CodeGroup>

<Note>
您只能下载由[技能](/docs/zh-CN/build-with-claude/skills-guide)或[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)创建的文件。您上传的文件无法下载。
</Note>

---

## 文件存储和限制 \{#file-storage-and-limits}

### 存储限制 \{#storage-limits}

- **最大文件大小：** 每个文件 500 MB
- **总存储空间：** 每个组织 500 GB

### 文件生命周期 \{#file-lifecycle}

- 文件的作用域限定在 API 密钥所属的工作区。其他 API 密钥可以使用由同一工作区关联的任何其他 API 密钥创建的文件
- 文件会一直保留，直到您删除它们
- 已删除的文件无法恢复
- 文件在删除后很快将无法通过 API 访问，但它们可能会在活跃的 `Messages` API 调用及相关工具使用中继续存在
- 用户删除的文件将按照 Anthropic 的[数据保留政策](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)进行删除。

---

## 数据保留 \{#data-retention}

通过 Files API 上传的文件会一直保留，直到使用 `DELETE /v1/files/{file_id}` 端点显式删除。文件会被存储以便在多个 API 请求中重复使用。

有关所有功能的 ZDR 资格，请参阅 [API 和数据保留](/docs/zh-CN/manage-claude/api-and-data-retention)。

## 错误处理 \{#error-handling}

使用 Files API 时的常见错误包括：

- **文件未找到（404）：** 指定的 `file_id` 不存在，或您无权访问该文件
- **无效的文件类型（400）：** 文件类型与内容块类型不匹配（例如，在 document 块中使用图片文件）
- **超出上下文窗口大小（400）：** 文件大于上下文窗口大小（例如，在 `/v1/messages` 请求中使用 500 MB 的纯文本文件）
- **无效的文件名（400）：** 文件名不符合长度要求（1-255 个字符）或包含禁用字符（`<`、`>`、`:`、`"`、`|`、`?`、`*`、`\`、`/` 或 Unicode 字符 0-31）
- **文件过大（413）：** 文件超过 500 MB 限制
- **超出存储限制（403）：** 您的组织已达到 500 GB 存储限制

```json Output
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "File not found: file_011CNha8iCJcU1wXNR6q4V8w"
  }
}
```

## 使用和计费 \{#usage-and-billing}

文件 API 操作是**免费的**：
- 上传文件
- 下载文件
- 列出文件
- 获取文件元数据
- 删除文件

在 `Messages` 请求中使用的文件内容按输入令牌计费。您只能下载由[技能](/docs/zh-CN/build-with-claude/skills-guide)或[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)创建的文件。

### 速率限制 \{#rate-limits}

在测试期间：
- 与文件相关的 API 调用限制为每分钟约 100 个请求
- 如果您的使用场景需要更高的限制，请[联系我们](mailto:sales@anthropic.com)