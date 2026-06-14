# PDF 支持

使用 Claude 处理 PDF。从您的文档中提取文本、分析图表并理解视觉内容。

---

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

您可以向 Claude 询问您提供的 PDF 中的任何文本、图片、图表和表格。一些示例用例：
- 分析财务报告并理解图表/表格
- 从法律文档中提取关键信息
- 文档翻译辅助
- 将文档信息转换为结构化格式

## 开始之前 \{#before-you-begin}

### 检查 PDF 要求 \{#check-pdf-requirements}
Claude 可处理任何标准 PDF。请确保您的请求大小符合以下要求：

| 要求 | 限制 |
|------------|--------|
| 最大请求大小 | 32&nbsp;MB（[因平台而异](/docs/zh-CN/api/overview#request-size-limits)） |
| 每个请求的最大页数 | 600（对于具有 20 万令牌上下文窗口的模型为 100） |
| 格式 | 标准 PDF（无密码/加密） |

这两个限制均针对整个请求负载，包括与 PDF 一起发送的任何其他内容。对于大型 PDF，建议使用 [Files API](#option-3-files-api) 上传并通过 `file_id` 引用，以保持请求负载较小。

<Tip>
内容密集的 PDF（包含大量小字体页面、复杂表格或大量图形）可能在达到页数限制之前就填满上下文窗口。即使使用 Files API，包含大型 PDF 的请求也可能在达到页数限制之前失败。请尝试将文档拆分为多个部分；对于大文件，由于每个页面都作为图像处理，对嵌入的图像进行降采样也会有所帮助。
</Tip>

由于 PDF 支持依赖于 Claude 的视觉能力，因此它受到与其他视觉任务相同的[限制和注意事项](/docs/zh-CN/build-with-claude/vision#limitations)的约束。

### 支持的平台和模型 \{#supported-platforms-and-models}

PDF 支持可在 Claude API、[AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws)、[Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)（参见 [Amazon Bedrock PDF 支持](#amazon-bedrock-pdf-support)）、[Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上使用。所有[活跃模型](/docs/zh-CN/about-claude/models/overview)均支持 PDF 处理。

### Amazon Bedrock PDF 支持 \{#amazon-bedrock-pdf-support}

通过 Bedrock 的 Converse API 使用 PDF 支持时，有两种不同的文档处理模式：

<Note>
**重要提示：** 要在 Converse API 中访问 Claude 的完整视觉 PDF 理解能力，您必须启用引用（citations）。如果未启用引用，API 将回退到仅进行基本文本提取。了解更多关于[使用引用](/docs/zh-CN/build-with-claude/citations)的信息。
</Note>

#### 文档处理模式 \{#document-processing-modes}

1. **Converse 文档聊天**（原始模式 - 仅文本提取）
   - 提供 PDF 的基本文本提取
   - 无法分析 PDF 中的图像、图表或视觉布局
   - 3 页 PDF 大约使用 1,000 个令牌
   - 未启用引用时自动使用此模式

2. **Claude PDF 聊天**（新模式 - 完整视觉理解）
   - 提供 PDF 的完整视觉分析
   - 可以理解和分析图表、图形、图像和视觉布局
   - 将每个页面同时作为文本和图像处理，以实现全面理解
   - 3 页 PDF 大约使用 7,000 个令牌
   - 在 Converse API 中**需要启用引用**

#### 主要限制 \{#key-limitations}

- **Converse API**：视觉 PDF 分析需要启用引用。目前没有在不启用引用的情况下使用视觉分析的选项（与 InvokeModel API 不同）。
- **InvokeModel API**：提供对 PDF 处理的完全控制，无需强制启用引用。

#### 常见问题 \{#common-issues}

如果在使用 Converse API 时 Claude 无法看到您 PDF 中的图像或图表，您可能需要启用引用标志。如果未启用，Converse 将回退到仅进行基本文本提取。

<Note>
这是 Converse API 的一个已知限制。对于需要在不启用引用的情况下进行视觉 PDF 分析的应用程序，请考虑改用 InvokeModel API。
</Note>

<Note>
对于非 PDF 文件，如 .csv、.xlsx、.docx、.md 或 .txt 文件，请参阅[处理其他文件格式](/docs/zh-CN/build-with-claude/files#working-with-other-file-formats)。
</Note>

***

## 使用 Claude 处理 PDF \{#process-pdfs-with-claude}

### 发送您的第一个 PDF 请求 \{#send-your-first-pdf-request}
让我们从一个使用 Messages API 的简单示例开始。您可以通过三种方式向 Claude 提供 PDF：

1. 作为指向在线托管 PDF 的 URL 引用
2. 作为 `document` 内容块中的 base64 编码 PDF
3. 通过来自 [Files API](/docs/zh-CN/build-with-claude/files) 的 `file_id`

<Note>
在 Amazon Bedrock 和 Vertex AI 上，目前仅支持 base64 编码的来源。
</Note>

#### 选项 1：基于 URL 的 PDF 文档 \{#option-1-url-based-pdf-document}

最简单的方法是直接通过 URL 引用 PDF：

<CodeGroup>
   ```bash cURL
    curl https://api.anthropic.com/v1/messages \
      -H "content-type: application/json" \
      -H "x-api-key: $ANTHROPIC_API_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -d '{
        "model": "claude-opus-4-8",
        "max_tokens": 1024,
        "messages": [{
            "role": "user",
            "content": [{
                "type": "document",
                "source": {
                    "type": "url",
                    "url": "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf"
                }
            },
            {
                "type": "text",
                "text": "What are the key findings in this document?"
            }]
        }]
    }'
    ```
    ```bash CLI
    ant messages create --transform content --format yaml <<'YAML'
    model: claude-opus-4-8
    max_tokens: 1024
    messages:
      - role: user
        content:
          - type: document
            source:
              type: url
              url: https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf
          - type: text
            text: What are the key findings in this document?
    YAML
    ```
    ```python Python hidelines={1..2}
    import anthropic

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "url",
                            "url": "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf",
                        },
                    },
                    {"type": "text", "text": "What are the key findings in this document?"},
                ],
            }
        ],
    )

    print(message.content)
    ```
    ```typescript TypeScript hidelines={1..4}
    import Anthropic from "@anthropic-ai/sdk";

    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "url",
                url: "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf"
              }
            },
            {
              type: "text",
              text: "What are the key findings in this document?"
            }
          ]
        }
      ]
    });

    console.log(response);
    ```
    ```java Java hidelines={1..8,-2..}
    import com.anthropic.client.AnthropicClient;
    import com.anthropic.client.okhttp.AnthropicOkHttpClient;
    import com.anthropic.models.messages.*;
    import java.util.List;

    public class PdfUrlExample {

      public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 使用 URL 创建文档块
        DocumentBlockParam documentParam = DocumentBlockParam.builder()
          .source(
            UrlPdfSource.builder()
              .url(
                "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf"
              )
              .build()
          )
          .build();

        // 创建包含文档和文本内容块的消息
        MessageCreateParams params = MessageCreateParams.builder()
          .model(Model.CLAUDE_OPUS_4_8)
          .maxTokens(1024)
          .addUserMessageOfBlockParams(
            List.of(
              ContentBlockParam.ofDocument(documentParam),
              ContentBlockParam.ofText(
                TextBlockParam.builder()
                  .text("What are the key findings in this document?")
                  .build()
              )
            )
          )
          .build();

        Message message = client.messages().create(params);
        System.out.println(message.content());
      }
    }
    ```
</CodeGroup>

#### 选项 2：Base64 编码的 PDF 文档 \{#option-2-base64-encoded-pdf-document}

如果您需要从本地系统发送 PDF，或者当 URL 不可用时：

<CodeGroup>
    ```bash cURL hidelines={1}
    cd "$(mktemp -d)"
    # 方法 1：获取并编码远程 PDF
    curl -s "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf" | base64 | tr -d '\n' > pdf_base64.txt

    # 方法 2：编码本地 PDF 文件
    # base64 document.pdf | tr -d '\n' > pdf_base64.txt

    # 使用 pdf_base64.txt 的内容创建 JSON 请求文件
    jq -n --rawfile PDF_BASE64 pdf_base64.txt '{
        "model": "claude-opus-4-8",
        "max_tokens": 1024,
        "messages": [{
            "role": "user",
            "content": [{
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": $PDF_BASE64
                }
            },
            {
                "type": "text",
                "text": "What are the key findings in this document?"
            }]
        }]
    }' > request.json

    # 使用该 JSON 文件发送 API 请求
    curl https://api.anthropic.com/v1/messages \
      -H "content-type: application/json" \
      -H "x-api-key: $ANTHROPIC_API_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -d @request.json
    ```
    ```bash CLI hidelines={1..2}
    cd "$(mktemp -d)"
    curl -sSo document.pdf https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf
    ant messages create \
      --model claude-opus-4-8 \
      --max-tokens 1024 \
      --transform content --format yaml <<'YAML'
    messages:
      - role: user
        content:
          - type: document
            source:
              type: base64
              media_type: application/pdf
              data: "@./document.pdf"
          - type: text
            text: What are the key findings in this document?
    YAML
    ```
    ```python Python hidelines={1}
    import anthropic
    import base64
    import httpx

    # 首先，加载并编码 PDF
    pdf_url = "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf"
    pdf_data = base64.standard_b64encode(httpx.get(pdf_url).content).decode("utf-8")

    # 替代方案：从本地文件加载
    # with open("document.pdf", "rb") as f:
    #     pdf_data = base64.standard_b64encode(f.read()).decode("utf-8")

    # 使用 base64 编码发送给 Claude
    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_data,
                        },
                    },
                    {"type": "text", "text": "What are the key findings in this document?"},
                ],
            }
        ],
    )

    print(message.content)
    ```
    ```typescript TypeScript hidelines={1..3,-3..-1}
    import Anthropic from "@anthropic-ai/sdk";

    async function main() {
      // 方法 1：获取并编码远程 PDF
      const pdfURL =
        "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf";
      const pdfResponse = await fetch(pdfURL);
      const arrayBuffer = await pdfResponse.arrayBuffer();
      const pdfBase64 = Buffer.from(arrayBuffer).toString("base64");

      // 方法 2：从本地文件加载
      // import { readFile } from "node:fs/promises";
      // const pdfBase64 = (await readFile('document.pdf')).toString('base64');

      // 发送包含 base64 编码 PDF 的 API 请求
      const anthropic = new Anthropic();
      const response = await anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: pdfBase64
                }
              },
              {
                type: "text",
                text: "What are the key findings in this document?"
              }
            ]
          }
        ]
      });

      console.log(response);
    }

    main();
    ```

    ```java Java hidelines={1..2,4,6..22,-2..}
    import com.anthropic.client.AnthropicClient;
    import com.anthropic.client.okhttp.AnthropicOkHttpClient;
    import com.anthropic.models.messages.Base64PdfSource;
    import com.anthropic.models.messages.ContentBlockParam;
    import com.anthropic.models.messages.DocumentBlockParam;
    import com.anthropic.models.messages.Message;
    import com.anthropic.models.messages.MessageCreateParams;
    import com.anthropic.models.messages.Model;
    import com.anthropic.models.messages.TextBlockParam;
    import java.io.IOException;
    import java.net.URI;
    import java.net.http.HttpClient;
    import java.net.http.HttpRequest;
    import java.net.http.HttpResponse;
    import java.util.Base64;
    import java.util.List;

    public class PdfBase64Example {

      public static void main(String[] args) throws IOException, InterruptedException {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        // 方法 1：下载并编码远程 PDF
        String pdfUrl =
          "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf";
        HttpClient httpClient = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder().uri(URI.create(pdfUrl)).GET().build();

        HttpResponse<byte[]> response = httpClient.send(
          request,
          HttpResponse.BodyHandlers.ofByteArray()
        );
        String pdfBase64 = Base64.getEncoder().encodeToString(response.body());

        // 方法 2：从本地文件加载
        // byte[] fileBytes = Files.readAllBytes(Path.of("document.pdf"));
        // String pdfBase64 = Base64.getEncoder().encodeToString(fileBytes);

        // 使用 base64 数据创建文档块
        DocumentBlockParam documentParam = DocumentBlockParam.builder()
          .source(Base64PdfSource.builder().data(pdfBase64).build())
          .build();

        // 创建包含文档和文本内容块的消息
        MessageCreateParams params = MessageCreateParams.builder()
          .model(Model.CLAUDE_OPUS_4_8)
          .maxTokens(1024)
          .addUserMessageOfBlockParams(
            List.of(
              ContentBlockParam.ofDocument(documentParam),
              ContentBlockParam.ofText(
                TextBlockParam.builder()
                  .text("What are the key findings in this document?")
                  .build()
              )
            )
          )
          .build();

        Message message = client.messages().create(params);
        System.out.println(message.content());
      }
    }
    ```

</CodeGroup>

#### 选项 3：Files API \{#option-3-files-api}

对于您将重复使用的 PDF，或者当您希望避免编码开销时，请使用 [Files API](/docs/zh-CN/build-with-claude/files)：

<CodeGroup>
```bash cURL hidelines={1..2}
cd "$(mktemp -d)"
curl -sSo document.pdf https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf
# 首先，将您的 PDF 上传到 Files API
curl -X POST https://api.anthropic.com/v1/files \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14" \
  -F "file=@document.pdf"

# 然后在您的消息中使用返回的 file_id
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "messages": [{
      "role": "user",
      "content": [{
        "type": "document",
        "source": {
          "type": "file",
          "file_id": "file_abc123"
        }
      },
      {
        "type": "text",
        "text": "What are the key findings in this document?"
      }]
    }]
  }'
```

```bash CLI nocheck hidelines={1..2}
cd "$(mktemp -d)"
curl -sSo document.pdf https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf
# 首先，将您的 PDF 上传到 Files API
FILE_ID=$(ant beta:files upload \
  --file ./document.pdf \
  --transform id --raw-output)

# 然后在您的消息中使用返回的 file_id
ant beta:messages create \
  --beta files-api-2025-04-14 \
  --transform content --format yaml <<YAML
model: claude-opus-4-8
max_tokens: 1024
messages:
  - role: user
    content:
      - type: document
        source:
          type: file
          file_id: $FILE_ID
      - type: text
        text: What are the key findings in this document?
YAML
```

```python Python nocheck hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

# 上传 PDF 文件
with open("document.pdf", "rb") as f:
    file_upload = client.beta.files.upload(file=("document.pdf", f, "application/pdf"))

# 在消息中使用已上传的文件
message = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    betas=["files-api-2025-04-14"],
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {"type": "file", "file_id": file_upload.id},
                },
                {"type": "text", "text": "What are the key findings in this document?"},
            ],
        }
    ],
)

print(message.content)
```

```typescript TypeScript nocheck
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import fs from "fs";

const anthropic = new Anthropic();

// 上传 PDF 文件
const fileUpload = await anthropic.beta.files.upload({
  file: await toFile(fs.createReadStream("document.pdf"), undefined, {
    type: "application/pdf"
  })
});

// 在消息中使用已上传的文件
const response = await anthropic.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  betas: ["files-api-2025-04-14"],
  messages: [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "file",
            file_id: fileUpload.id
          }
        },
        {
          type: "text",
          text: "What are the key findings in this document?"
        }
      ]
    }
  ]
});

console.log(response);
```

```java Java nocheck hidelines={1..3,6,8,10..19,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Model;
import com.anthropic.models.beta.files.FileMetadata;
import com.anthropic.models.beta.files.FileUploadParams;
import com.anthropic.models.beta.messages.BetaContentBlockParam;
import com.anthropic.models.beta.messages.BetaFileDocumentSource;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaRequestDocumentBlock;
import com.anthropic.models.beta.messages.BetaTextBlockParam;
import com.anthropic.models.beta.messages.MessageCreateParams;
import java.nio.file.Path;
import java.util.List;

public class PdfFilesExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // 上传 PDF 文件
    FileMetadata file = client
      .beta()
      .files()
      .upload(FileUploadParams.builder().file(Path.of("document.pdf")).build());

    // 在消息中使用已上传的文件
    MessageCreateParams params = MessageCreateParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .addBeta("files-api-2025-04-14")
      .maxTokens(1024)
      .addUserMessageOfBetaContentBlockParams(
        List.of(
          BetaContentBlockParam.ofDocument(
            BetaRequestDocumentBlock.builder()
              .source(
                BetaFileDocumentSource.builder()
                  .fileId(file.id())
                  .build()
              )
              .build()
          ),
          BetaContentBlockParam.ofText(
            BetaTextBlockParam.builder()
              .text("What are the key findings in this document?")
              .build()
          )
        )
      )
      .build();

    BetaMessage message = client.beta().messages().create(params);
    System.out.println(message.content());
  }
}
```
</CodeGroup>

### PDF 支持的工作原理 \{#how-pdf-support-works}
当您向 Claude 发送 PDF 时，会执行以下步骤：
<Steps>
  <Step title="系统提取文档的内容。">
    - 系统将文档的每一页转换为图像。
    - 从每一页提取文本，并与每页的图像一起提供。
  </Step>
  <Step title="Claude 同时分析文本和图像，以更好地理解文档。">
    - 文档以文本和图像的组合形式提供以供分析。
    - 这使用户能够询问有关 PDF 视觉元素的见解，例如图表、图示和其他非文本内容。
  </Step>
  <Step title="Claude 作出响应，并在相关时引用 PDF 的内容。">
    Claude 在响应时可以同时引用文本和视觉内容。您可以通过将 PDF 支持与以下功能集成来进一步提高性能：
    - **提示缓存**：提高重复分析的性能。
    - **批处理**：用于大批量文档处理。
    - **工具使用**：从文档中提取特定信息以用作工具输入。
  </Step>
</Steps>

### 估算您的成本 \{#estimate-your-costs}
PDF 文件的令牌数量取决于从文档中提取的总文本量以及页数：
- 文本令牌成本：每页通常使用 1,500-3,000 个令牌，具体取决于内容密度。适用标准 API 定价，无额外 PDF 费用。
- 图像令牌成本：由于每页都会转换为图像，因此适用相同的[基于图像的成本计算](/docs/zh-CN/build-with-claude/vision#evaluate-image-size)。

您可以使用[令牌计数](/docs/zh-CN/build-with-claude/token-counting)来估算特定 PDF 的成本。

***

## 优化 PDF 处理 \{#optimize-pdf-processing}

### 提高性能 \{#improve-performance}
遵循以下最佳实践以获得最佳结果：
- 在请求中将 PDF 放在文本之前
- 使用标准字体
- 确保文本清晰易读
- 将页面旋转到正确的竖直方向
- 在提示中使用逻辑页码（来自 PDF 查看器）
- 必要时将大型 PDF 拆分为多个块
- 为重复分析启用提示缓存

### 扩展您的实现 \{#scale-your-implementation}
对于大批量处理，请考虑以下方法：

#### 使用提示缓存 \{#use-prompt-caching}
缓存 PDF 以提高重复查询的性能：
<CodeGroup>
```bash cURL hidelines={1..2}
cd "$(mktemp -d)"
curl -s "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf" | base64 | tr -d '\n' > pdf_base64.txt
# 使用 pdf_base64.txt 的内容创建 JSON 请求文件
jq -n --rawfile PDF_BASE64 pdf_base64.txt '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "messages": [{
        "role": "user",
        "content": [{
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": $PDF_BASE64
            },
            "cache_control": {
              "type": "ephemeral"
            }
        },
        {
            "type": "text",
            "text": "Which model has the highest human preference win rates across each use-case?"
        }]
    }]
}' > request.json

# 然后使用该 JSON 文件发起 API 调用
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d @request.json
```
```bash CLI hidelines={1..2}
cd "$(mktemp -d)"
curl -sSo document.pdf https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
messages:
  - role: user
    content:
      - type: document
        source:
          type: base64
          media_type: application/pdf
          data: "@./document.pdf"
        cache_control:
          type: ephemeral
      - type: text
        text: Which model has the highest human preference win rates across each use-case?
YAML
```

```python Python nocheck hidelines={1..5,7..13}
import anthropic
import base64
from pypdf import PdfWriter
import io

client = anthropic.Anthropic()

buf = io.BytesIO()
writer = PdfWriter()
writer.add_blank_page(width=72, height=72)
writer.write(buf)
pdf_data = base64.standard_b64encode(buf.getvalue()).decode("utf-8")

message = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "base64",
                        "media_type": "application/pdf",
                        "data": pdf_data,
                    },
                    "cache_control": {"type": "ephemeral"},
                },
                {"type": "text", "text": "Analyze this document."},
            ],
        }
    ],
)
```

```typescript TypeScript nocheck
const response = await anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      content: [
        {
          type: "document",
          source: {
            media_type: "application/pdf",
            type: "base64",
            data: pdfBase64
          },
          cache_control: { type: "ephemeral" }
        },
        {
          type: "text",
          text: "Which model has the highest human preference win rates across each use-case?"
        }
      ],
      role: "user"
    }
  ]
});
console.log(response);
```

```java Java nocheck hidelines={1..2,5,7..20,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Base64PdfSource;
import com.anthropic.models.messages.CacheControlEphemeral;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.DocumentBlockParam;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

public class MessagesDocumentExample {

  public static void main(String[] args) throws IOException {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // 以 base64 格式读取 PDF 文件
    byte[] pdfBytes = Files.readAllBytes(Paths.get("pdf_base64.txt"));
    String pdfBase64 = new String(pdfBytes);

    MessageCreateParams params = MessageCreateParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .maxTokens(1024)
      .addUserMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofDocument(
            DocumentBlockParam.builder()
              .source(Base64PdfSource.builder().data(pdfBase64).build())
              .cacheControl(CacheControlEphemeral.builder().build())
              .build()
          ),
          ContentBlockParam.ofText(
            TextBlockParam.builder()
              .text(
                "Which model has the highest human preference win rates across each use-case?"
              )
              .build()
          )
        )
      )
      .build();

    Message message = client.messages().create(params);
    System.out.println(message);
  }
}
```
</CodeGroup>

#### 批量处理文档 \{#process-document-batches}
使用 Message Batches API 处理大批量工作流：
<CodeGroup>
```bash cURL hidelines={1..2}
cd "$(mktemp -d)"
curl -s "https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf" | base64 | tr -d '\n' > pdf_base64.txt
# 使用 pdf_base64.txt 的内容创建 JSON 请求文件
jq -n --rawfile PDF_BASE64 pdf_base64.txt '
{
  "requests": [
      {
          "custom_id": "my-first-request",
          "params": {
              "model": "claude-opus-4-8",
              "max_tokens": 1024,
              "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": $PDF_BASE64
                            }
                        },
                        {
                            "type": "text",
                            "text": "Which model has the highest human preference win rates across each use-case?"
                        }
                    ]
                }
              ]
          }
      },
      {
          "custom_id": "my-second-request",
          "params": {
              "model": "claude-opus-4-8",
              "max_tokens": 1024,
              "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {
                                "type": "base64",
                                "media_type": "application/pdf",
                                "data": $PDF_BASE64
                            }
                        },
                        {
                            "type": "text",
                            "text": "Extract 5 key insights from this document."
                        }
                    ]
                }
              ]
          }
      }
  ]
}
' > request.json

# 然后使用该 JSON 文件发起 API 调用
curl https://api.anthropic.com/v1/messages/batches \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d @request.json
```
```bash CLI hidelines={1..2}
cd "$(mktemp -d)"
curl -sSo document.pdf https://assets.anthropic.com/m/1cd9d098ac3e6467/original/Claude-3-Model-Card-October-Addendum.pdf
ant messages:batches create <<'YAML'
requests:
  - custom_id: my-first-request
    params:
      model: claude-opus-4-8
      max_tokens: 1024
      messages:
        - role: user
          content:
            - type: document
              source:
                type: base64
                media_type: application/pdf
                data: "@./document.pdf"
            - type: text
              text: >-
                Which model has the highest human preference win rates
                across each use-case?
  - custom_id: my-second-request
    params:
      model: claude-opus-4-8
      max_tokens: 1024
      messages:
        - role: user
          content:
            - type: document
              source:
                type: base64
                media_type: application/pdf
                data: "@./document.pdf"
            - type: text
              text: Extract 5 key insights from this document.
YAML
```

```python Python nocheck hidelines={1..5,7..13}
import anthropic
import base64
from pypdf import PdfWriter
import io

client = anthropic.Anthropic()

buf = io.BytesIO()
writer = PdfWriter()
writer.add_blank_page(width=72, height=72)
writer.write(buf)
pdf_data = base64.standard_b64encode(buf.getvalue()).decode("utf-8")

message_batch = client.messages.batches.create(
    requests=[
        {
            "custom_id": "doc1",
            "params": {
                "model": "claude-opus-4-8",
                "max_tokens": 1024,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "document",
                                "source": {
                                    "type": "base64",
                                    "media_type": "application/pdf",
                                    "data": pdf_data,
                                },
                            },
                            {"type": "text", "text": "Summarize this document."},
                        ],
                    }
                ],
            },
        }
    ]
)
```

```typescript TypeScript nocheck
const response = await anthropic.messages.batches.create({
  requests: [
    {
      custom_id: "my-first-request",
      params: {
        max_tokens: 1024,
        messages: [
          {
            content: [
              {
                type: "document",
                source: {
                  media_type: "application/pdf",
                  type: "base64",
                  data: pdfBase64
                }
              },
              {
                type: "text",
                text: "Which model has the highest human preference win rates across each use-case?"
              }
            ],
            role: "user"
          }
        ],
        model: "claude-opus-4-8"
      }
    },
    {
      custom_id: "my-second-request",
      params: {
        max_tokens: 1024,
        messages: [
          {
            content: [
              {
                type: "document",
                source: {
                  media_type: "application/pdf",
                  type: "base64",
                  data: pdfBase64
                }
              },
              {
                type: "text",
                text: "Extract 5 key insights from this document."
              }
            ],
            role: "user"
          }
        ],
        model: "claude-opus-4-8"
      }
    }
  ]
});
console.log(response);
```

```java Java nocheck hidelines={1..3,5..14,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.*;
import com.anthropic.models.messages.batches.*;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;

public class MessagesBatchDocumentExample {

  public static void main(String[] args) throws IOException {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    // 以 base64 格式读取 PDF 文件
    byte[] pdfBytes = Files.readAllBytes(Paths.get("pdf_base64.txt"));
    String pdfBase64 = new String(pdfBytes);

    BatchCreateParams params = BatchCreateParams.builder()
      .addRequest(
        BatchCreateParams.Request.builder()
          .customId("my-first-request")
          .params(
            BatchCreateParams.Request.Params.builder()
              .model(Model.CLAUDE_OPUS_4_8)
              .maxTokens(1024)
              .addUserMessageOfBlockParams(
                List.of(
                  ContentBlockParam.ofDocument(
                    DocumentBlockParam.builder()
                      .source(Base64PdfSource.builder().data(pdfBase64).build())
                      .build()
                  ),
                  ContentBlockParam.ofText(
                    TextBlockParam.builder()
                      .text(
                        "Which model has the highest human preference win rates across each use-case?"
                      )
                      .build()
                  )
                )
              )
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
              .addUserMessageOfBlockParams(
                List.of(
                  ContentBlockParam.ofDocument(
                    DocumentBlockParam.builder()
                      .source(Base64PdfSource.builder().data(pdfBase64).build())
                      .build()
                  ),
                  ContentBlockParam.ofText(
                    TextBlockParam.builder()
                      .text("Extract 5 key insights from this document.")
                      .build()
                  )
                )
              )
              .build()
          )
          .build()
      )
      .build();

    MessageBatch batch = client.messages().batches().create(params);
    System.out.println(batch);
  }
}
```
</CodeGroup>

## 后续步骤 \{#next-steps}

<CardGroup cols={2}>
  <Card
    title="尝试 PDF 示例"
    icon="file"
    href="https://platform.claude.com/cookbook/multimodal-getting-started-with-vision"
  >
    在 cookbook 示例中探索 PDF 处理的实际示例。
  </Card>

  <Card
    title="查看 API 参考"
    icon="code"
    href="/docs/zh-CN/api/messages/create"
  >
    查看 PDF 支持的完整 API 文档。
  </Card>
</CardGroup>