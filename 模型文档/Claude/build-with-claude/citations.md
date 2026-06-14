# 引用

---

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

Claude 能够在回答有关文档的问题时提供详细的引用，帮助您追踪和验证响应中的信息来源。

所有[当前可用的模型](/docs/zh-CN/about-claude/models/overview)均支持引用功能，Haiku 3 除外。

<Tip>
  请使用此[表单](https://forms.gle/9n9hSrKnKe3rpowH9)分享您对引用功能的反馈和建议。
</Tip>

以下是如何在 Messages API 中使用引用的示例：

<CodeGroup>

```bash cURL
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "document",
            "source": {
              "type": "text",
              "media_type": "text/plain",
              "data": "The grass is green. The sky is blue."
            },
            "title": "My Document",
            "context": "This is a trustworthy document.",
            "citations": {"enabled": true}
          },
          {
            "type": "text",
            "text": "What color is the grass and sky?"
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
      - type: document
        source:
          type: text
          media_type: text/plain
          data: The grass is green. The sky is blue.
        title: My Document
        context: This is a trustworthy document.
        citations:
          enabled: true
      - type: text
        text: What color is the grass and sky?
YAML
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
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "text",
                        "media_type": "text/plain",
                        "data": "The grass is green. The sky is blue.",
                    },
                    "title": "My Document",
                    "context": "This is a trustworthy document.",
                    "citations": {"enabled": True},
                },
                {"type": "text", "text": "What color is the grass and sky?"},
            ],
        }
    ],
)
print(response)
```

```java Java hidelines={1..8,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.*;
import java.util.List;

public class DocumentExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    PlainTextSource source = PlainTextSource.builder()
      .data("The grass is green. The sky is blue.")
      .build();

    DocumentBlockParam documentParam = DocumentBlockParam.builder()
      .source(source)
      .title("My Document")
      .context("This is a trustworthy document.")
      .citations(CitationsConfigParam.builder().enabled(true).build())
      .build();

    TextBlockParam textBlockParam = TextBlockParam.builder()
      .text("What color is the grass and sky?")
      .build();

    MessageCreateParams params = MessageCreateParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .maxTokens(1024)
      .addUserMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofDocument(documentParam),
          ContentBlockParam.ofText(textBlockParam)
        )
      )
      .build();

    Message message = client.messages().create(params);
    System.out.println(message);
  }
}
```

</CodeGroup>

<Tip>
**与基于提示的方法的比较**

与基于提示的引用解决方案相比，引用功能具有以下优势：
- **节省成本：** 如果您基于提示的方法要求 Claude 输出直接引语，由于 `cited_text` 不计入您的输出令牌，您可能会看到成本节省。
- **更高的引用可靠性：** 由于引用会被解析为上述相应的响应格式，并且 `cited_text` 是被提取出来的，因此可以保证引用包含指向所提供文档的有效指针。
- **更高的引用质量：** 在评估中，与纯粹基于提示的方法相比，引用功能被发现更有可能引用文档中最相关的引语。
</Tip>

---

## 引用的工作原理 \{#how-citations-work}

按照以下步骤将引用与 Claude 集成：

<Steps>
  <Step title="提供文档并启用引用">
    - 以任何受支持的格式包含文档：[PDF](#pdf-documents)、[纯文本](#plain-text-documents)或[自定义内容](#custom-content-documents)文档
    - 在每个文档上设置 `citations.enabled=true`。目前，必须对请求中的所有文档启用引用，或全部不启用。
    - 请注意，目前仅支持文本引用，尚不支持图像引用。
  </Step>
  <Step title="文档被处理">
    - 文档内容会被"分块"（chunked），以定义可能引用的最小粒度。例如，句子分块将允许 Claude 引用单个句子，或将多个连续句子串联起来以引用一个段落（或更长的内容）！
      - **对于 PDF：** 文本按照 [PDF 支持](/docs/zh-CN/build-with-claude/pdf-support)中所述的方式提取，内容被分块为句子。目前不支持从 PDF 中引用图像。
      - **对于纯文本文档：** 内容被分块为可供引用的句子。
      - **对于自定义内容文档：** 您提供的内容块将按原样使用，不会进行进一步的分块。
  </Step>
  <Step title="Claude 提供带引用的响应">
    - 响应现在可能包含多个文本块，其中每个文本块可以包含 Claude 提出的一个论断以及支持该论断的引用列表。
    - 引用指向源文档中的特定位置。这些引用的格式取决于被引用文档的类型。
      - **对于 PDF：** 引用包含页码范围（从 1 开始索引）。
      - **对于纯文本文档：** 引用包含字符索引范围（从 0 开始索引）。
      - **对于自定义内容文档：** 引用包含内容块索引范围（从 0 开始索引），对应于提供的原始内容列表。
    - 文档索引用于指示引用来源，并根据您原始请求中所有文档的列表从 0 开始索引。
  </Step>
</Steps>

<Tip>
  **自动分块与自定义内容**

  默认情况下，纯文本和 PDF 文档会自动分块为句子。如果您需要对引用粒度进行更多控制（例如，对于项目符号列表或转录文本），请改用自定义内容文档。有关更多详细信息，请参阅[文档类型](#document-types)。

  例如，如果您希望 Claude 能够引用 RAG 块中的特定句子，则应将每个 RAG 块放入一个纯文本文档中。否则，如果您不希望进行任何进一步的分块，或者希望自定义任何额外的分块，则可以将 RAG 块放入自定义内容文档中。
</Tip>

### 可引用与不可引用的内容 \{#citable-vs-non-citable-content}

- 文档 `source` 内容中的文本可以被引用。
- `title` 和 `context` 是可选字段，它们将被传递给模型，但不会用作被引用的内容。
- `title` 的长度有限，因此您可能会发现 `context` 字段对于以文本或字符串化 JSON 的形式存储任何文档元数据非常有用。

### 引用索引 \{#citation-indices}
- 文档索引从请求中所有文档内容块的列表（跨所有消息）从 0 开始索引。
- 字符索引从 0 开始索引，结束索引为不包含（exclusive）。
- 页码从 1 开始索引，结束页码为不包含。
- 内容块索引从自定义内容文档中提供的 `content` 列表从 0 开始索引，结束索引为不包含。

### 令牌成本 \{#token-costs}
- 启用引用会由于系统提示的添加和文档分块而导致输入令牌略有增加。
- 然而，引用功能在输出令牌方面非常高效。在底层，模型以标准化格式输出引用，然后将其解析为被引用的文本和文档位置索引。`cited_text` 字段是为方便起见而提供的，不计入输出令牌。
- 当在后续对话轮次中传回时，`cited_text` 也不计入输入令牌。

### 功能兼容性 \{#feature-compatibility}
引用可与其他 API 功能结合使用，包括[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)、[令牌计数](/docs/zh-CN/build-with-claude/token-counting)和[批处理](/docs/zh-CN/build-with-claude/batch-processing)。

<Warning>
**引用与结构化输出不兼容**

引用不能与[结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)一起使用。如果您在任何用户提供的文档（Document 块或 RequestSearchResultBlock）上启用引用，同时又包含 `output_config.format` 参数（或已弃用的 `output_format` 参数），API 将返回 400 错误。

这是因为引用需要将引用块与文本输出交错排列，这与结构化输出的严格 JSON schema 约束不兼容。
</Warning>

#### 将提示缓存与引用结合使用 \{#using-prompt-caching-with-citations}

引用和提示缓存可以有效地结合使用。

响应中生成的引用块无法直接缓存，但它们引用的源文档可以被缓存。为了优化性能，请将 `cache_control` 应用于您的顶层文档内容块。

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
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "text",
                        "media_type": "text/plain",
                        "data": "This is a very long document with thousands of words..."
                    },
                    "citations": {"enabled": true},
                    "cache_control": {"type": "ephemeral"}
                },
                {
                    "type": "text",
                    "text": "What does this document say about API features?"
                }
            ]
        }
    ]
}'
```

```bash CLI
ant messages create \
  --model claude-opus-4-8 \
  --max-tokens 1024 <<'YAML'
messages:
  - role: user
    content:
      - type: document
        source:
          type: text
          media_type: text/plain
          data: This is a very long document with thousands of words...
        citations:
          enabled: true
        cache_control:
          type: ephemeral
      - type: text
        text: What does this document say about API features?
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

# 长文档内容（例如技术文档）
long_document = (
    "This is a very long document with thousands of words..." + " ... " * 1000
)  # Minimum cacheable length

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "document",
                    "source": {
                        "type": "text",
                        "media_type": "text/plain",
                        "data": long_document,
                    },
                    "citations": {"enabled": True},
                    "cache_control": {
                        "type": "ephemeral"
                    },  # Cache the document content
                },
                {
                    "type": "text",
                    "text": "What does this document say about API features?",
                },
            ],
        }
    ],
)
print(response)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

// 长文档内容（例如技术文档）
const longDocument =
  "This is a very long document with thousands of words..." + " ... ".repeat(1000); // Minimum cacheable length

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  messages: [
    {
      role: "user",
      content: [
        {
          type: "document",
          source: {
            type: "text",
            media_type: "text/plain",
            data: longDocument
          },
          citations: { enabled: true },
          cache_control: { type: "ephemeral" } // Cache the document content
        },
        {
          type: "text",
          text: "What does this document say about API features?"
        }
      ]
    }
  ]
});
```
</CodeGroup>

在此示例中：
- 通过在文档块上使用 `cache_control` 来缓存文档内容
- 在文档上启用了引用
- Claude 可以生成带引用的响应，同时受益于缓存的文档内容
- 使用相同文档的后续请求将受益于缓存的内容

## 文档类型 \{#document-types}

### 选择文档类型 \{#choosing-a-document-type}

引用支持三种文档类型。文档可以直接在消息中提供（base64、文本或 URL），也可以通过 [Files API](/docs/zh-CN/build-with-claude/files) 上传并通过 `file_id` 引用：

| 类型 | 最适用于 | 分块方式 | 引用格式 |
| :--- | :--- | :--- | :--- |
| 纯文本 | 简单文本文档、散文 | 句子 | 字符索引（从 0 开始索引） |
| PDF | 包含文本内容的 PDF 文件 | 句子 | 页码（从 1 开始索引） |
| 自定义内容 | 列表、转录文本、特殊格式、更细粒度的引用 | 无额外分块 | 块索引（从 0 开始索引） |

<Note>
.csv、.xlsx、.docx、.md 和 .txt 文件不支持作为文档块。请将这些文件转换为纯文本并直接包含在消息内容中。请参阅[处理其他文件格式](/docs/zh-CN/build-with-claude/files#working-with-other-file-formats)。
</Note>

### 纯文本文档 \{#plain-text-documents}

纯文本文档会自动分块为句子。您可以内联提供它们，或通过其 `file_id` 引用：

<Tabs>
<Tab title="内联文本">
```python
{
    "type": "document",
    "source": {
        "type": "text",
        "media_type": "text/plain",
        "data": "Plain text content...",
    },
    "title": "Document Title",  # optional
    "context": "Context about the document that will not be cited from",  # optional
    "citations": {"enabled": True},
}
```
</Tab>
<Tab title="Files API">
```python
{
    "type": "document",
    "source": {"type": "file", "file_id": "file_011CNvxoj286tYUAZFiZMf1U"},
    "title": "Document Title",  # optional
    "context": "Context about the document that will not be cited from",  # optional
    "citations": {"enabled": True},
}
```
</Tab>
</Tabs>

<section title="纯文本引用示例">

```python
{
    "type": "char_location",
    "cited_text": "The exact text being cited",  # not counted towards output tokens
    "document_index": 0,
    "document_title": "Document Title",
    "start_char_index": 0,  # 0-indexed
    "end_char_index": 50,  # exclusive
}
```

</section>

### PDF 文档 \{#pdf-documents}

PDF 文档可以作为 base64 编码的数据、URL 或通过 `file_id` 提供。PDF 文本会被提取并分块为句子。由于尚不支持图像引用，因此作为文档扫描件且不包含可提取文本的 PDF 将无法被引用。

<Tabs>
<Tab title="Base64">
```python
{
    "type": "document",
    "source": {
        "type": "base64",
        "media_type": "application/pdf",
        "data": base64_encoded_pdf_data,
    },
    "title": "Document Title",  # optional
    "context": "Context about the document that will not be cited from",  # optional
    "citations": {"enabled": True},
}
```
</Tab>
<Tab title="URL">
```python
{
    "type": "document",
    "source": {"type": "url", "url": "https://example.com/document.pdf"},
    "title": "Document Title",  # optional
    "context": "Context about the document that will not be cited from",  # optional
    "citations": {"enabled": True},
}
```
</Tab>
<Tab title="Files API">
```python
{
    "type": "document",
    "source": {"type": "file", "file_id": "file_011CNvxoj286tYUAZFiZMf1U"},
    "title": "Document Title",  # optional
    "context": "Context about the document that will not be cited from",  # optional
    "citations": {"enabled": True},
}
```
</Tab>
</Tabs>

<section title="PDF 引用示例">

```python
{
    "type": "page_location",
    "cited_text": "The exact text being cited",  # not counted towards output tokens
    "document_index": 0,
    "document_title": "Document Title",
    "start_page_number": 1,  # 1-indexed
    "end_page_number": 2,  # exclusive
}
```

</section>

### 自定义内容文档 \{#custom-content-documents}

自定义内容文档让您可以控制引用粒度。不会进行额外的分块，块会根据提供的内容块传递给模型。

```python
{
    "type": "document",
    "source": {
        "type": "content",
        "content": [
            {"type": "text", "text": "First chunk"},
            {"type": "text", "text": "Second chunk"},
        ],
    },
    "title": "Document Title",  # optional
    "context": "Context about the document that will not be cited from",  # optional
    "citations": {"enabled": True},
}
```

<section title="引用示例">

```python
{
    "type": "content_block_location",
    "cited_text": "The exact text being cited",  # not counted towards output tokens
    "document_index": 0,
    "document_title": "Document Title",
    "start_block_index": 0,  # 0-indexed
    "end_block_index": 1,  # exclusive
}
```

</section>

---

## 响应结构 \{#response-structure}

启用引用后，响应会包含多个带引用的文本块：

```python
{
    "content": [
        {"type": "text", "text": "According to the document, "},
        {
            "type": "text",
            "text": "the grass is green",
            "citations": [
                {
                    "type": "char_location",
                    "cited_text": "The grass is green.",
                    "document_index": 0,
                    "document_title": "Example Document",
                    "start_char_index": 0,
                    "end_char_index": 20,
                }
            ],
        },
        {"type": "text", "text": " and "},
        {
            "type": "text",
            "text": "the sky is blue",
            "citations": [
                {
                    "type": "char_location",
                    "cited_text": "The sky is blue.",
                    "document_index": 0,
                    "document_title": "Example Document",
                    "start_char_index": 20,
                    "end_char_index": 36,
                }
            ],
        },
        {
            "type": "text",
            "text": ". Information from page 5 states that ",
        },
        {
            "type": "text",
            "text": "water is essential",
            "citations": [
                {
                    "type": "page_location",
                    "cited_text": "Water is essential for life.",
                    "document_index": 1,
                    "document_title": "PDF Document",
                    "start_page_number": 5,
                    "end_page_number": 6,
                }
            ],
        },
        {
            "type": "text",
            "text": ". The custom document mentions ",
        },
        {
            "type": "text",
            "text": "important findings",
            "citations": [
                {
                    "type": "content_block_location",
                    "cited_text": "These are important findings.",
                    "document_index": 2,
                    "document_title": "Custom Content Document",
                    "start_block_index": 0,
                    "end_block_index": 1,
                }
            ],
        },
    ]
}
```

### 流式传输支持 \{#streaming-support}

对于流式传输响应，包含了一个 `citations_delta` 类型，其中包含一个要添加到当前 `text` 内容块的 `citations` 列表中的单个引用。

<section title="流式传输事件示例">

```sse
event: message_start
data: {"type": "message_start", ...}

event: content_block_start
data: {"type": "content_block_start", "index": 0, ...}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0,
       "delta": {"type": "text_delta", "text": "According to..."}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0,
       "delta": {"type": "citations_delta",
                 "citation": {
                     "type": "char_location",
                     "cited_text": "...",
                     "document_index": 0,
                     ...
                 }}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_stop
data: {"type": "message_stop"}
```

</section>