# 嵌入

文本嵌入是文本的数值表示，可用于衡量语义相似度。本指南介绍嵌入的概念、应用场景，以及如何使用嵌入模型完成搜索、推荐和异常检测等任务。

---

## 实施嵌入之前 \{#before-implementing-embeddings}

在选择嵌入提供商时，您可以根据自身需求和偏好考虑以下几个因素：

- 数据集规模与领域特异性：模型训练数据集的规模及其与您希望嵌入的领域的相关性。更大或更具领域特异性的数据通常能生成更好的领域内嵌入
- 推理性能：嵌入查找速度和端到端 "latency"（延迟）。对于大规模生产部署而言，这是一个尤为重要的考量因素
- 定制化：是否支持在私有数据上继续训练，或针对特定领域对模型进行专门优化。这可以提升模型在独特词汇上的表现

## 如何通过 Anthropic 获取嵌入 \{#how-to-get-embeddings-with-anthropic}

Anthropic 本身不提供嵌入模型。Voyage AI 是一家嵌入提供商，提供涵盖上述所有考量因素的多种选项和功能。

Voyage AI 提供最先进的嵌入模型，并为金融、医疗等特定行业领域提供定制模型，也可为个人客户提供专属的微调模型。

本指南的其余部分针对 Voyage AI，但您应评估多家嵌入供应商，以找到最适合您特定用例的方案。

## 可用模型 \{#available-models}

Voyage 推荐使用以下文本嵌入模型：

**Voyage 4（最新一代）**

| 模型 | 上下文长度 | 嵌入维度 | 描述 |
| --- | --- | --- | --- |
| `voyage-4-large` | 32,000 | 1024（默认）、256、512、2048 | 最佳的通用及多语言检索质量。详情请参阅[博客文章](https://blog.voyageai.com/2026/01/15/voyage-4/)。 |
| `voyage-4` | 32,000 | 1024（默认）、256、512、2048 | 针对通用及多语言检索质量进行优化。在质量与效率之间取得平衡。详情请参阅[博客文章](https://blog.voyageai.com/2026/01/15/voyage-4/)。 |
| `voyage-4-lite` | 32,000 | 1024（默认）、256、512、2048 | 针对延迟和成本进行优化。详情请参阅[博客文章](https://blog.voyageai.com/2026/01/15/voyage-4/)。 |
| `voyage-4-nano` | 32,000 | 1024（默认）、256、512、2048 | 开放权重模型（Apache 2.0 许可证），可在 Hugging Face 上获取。详情请参阅[博客文章](https://blog.voyageai.com/2026/01/15/voyage-4/)。 |

**上一代**

| 模型 | 上下文长度 | 嵌入维度 | 描述 |
| --- | --- | --- | --- |
| `voyage-3-large` | 32,000 | 1024（默认）、256、512、2048 | 最佳的通用及多语言检索质量。详情请参阅[博客文章](https://blog.voyageai.com/2025/01/07/voyage-3-large/)。 |
| `voyage-3.5` | 32,000 | 1024（默认）、256、512、2048 | 针对通用及多语言检索质量进行优化。详情请参阅[博客文章](https://blog.voyageai.com/2025/05/20/voyage-3-5/)。 |
| `voyage-3.5-lite` | 32,000 | 1024（默认）、256、512、2048 | 针对延迟和成本进行优化。详情请参阅[博客文章](https://blog.voyageai.com/2025/05/20/voyage-3-5/)。 |
| `voyage-code-3` | 32,000 | 1024（默认）、256、512、2048 | 针对**代码**检索进行优化。详情请参阅[博客文章](https://blog.voyageai.com/2024/12/04/voyage-code-3/)。 |
| `voyage-finance-2` | 32,000 | 1024 | 针对**金融**检索和 RAG 进行优化。详情请参阅[博客文章](https://blog.voyageai.com/2024/06/03/domain-specific-embeddings-finance-edition-voyage-finance-2/)。 |
| `voyage-law-2` | 16,000 | 1024 | 针对**法律**和**长上下文**检索及 RAG 进行优化。同时在所有领域均有性能提升。详情请参阅[博客文章](https://blog.voyageai.com/2024/04/15/domain-specific-embeddings-and-retrieval-legal-edition-voyage-law-2/)。 |

此外，推荐使用以下多模态嵌入模型：

| 模型 | 上下文长度 | 嵌入维度 | 描述 |
| --- | --- | --- | --- |
| `voyage-multimodal-3.5` | 32,000 | 1024（默认）、256、512、2048 | 功能丰富的多模态嵌入模型，可对交错的文本、图像和视频进行向量化。作为首个生产级视频嵌入模型，支持视频处理。详情请参阅[博客文章](https://blog.voyageai.com/2026/01/15/voyage-multimodal-3-5/)。 |
| `voyage-multimodal-3` | 32,000 | 1024 | 功能丰富的多模态嵌入模型，可对交错的文本和内容丰富的图像（如 PDF 截图、幻灯片、表格、图表等）进行向量化。详情请参阅[博客文章](https://blog.voyageai.com/2024/11/12/voyage-multimodal-3/)。 |

需要帮助决定使用哪个文本嵌入模型？请查看[常见问题解答](https://docs.voyageai.com/docs/faq#what-embedding-models-are-available-and-which-one-should-i-use&ref=anthropic)。

## Voyage AI 入门 \{#getting-started-with-voyage-ai}

要访问 Voyage 嵌入：

1. 在 Voyage AI 网站上注册
2. 获取 API 密钥
3. 为方便起见，将 API 密钥设置为环境变量：

```bash
export VOYAGE_API_KEY="<your secret key>"
```

您可以通过官方 [`voyageai` Python 包](https://github.com/voyage-ai/voyageai-python)或 HTTP 请求来获取嵌入，具体方法如下所述。

### Voyage Python 库 \{#voyage-python-library}

可以使用以下命令安装 `voyageai` 包：

```bash
pip install -U voyageai
```

然后，您可以创建一个客户端对象并开始使用它来嵌入您的文本：

```python nocheck
import voyageai

vo = voyageai.Client()
# 这将自动使用环境变量 VOYAGE_API_KEY。
# 或者，您可以使用 vo = voyageai.Client(api_key="<your secret key>")

texts = ["Sample text 1", "Sample text 2"]

result = vo.embed(texts, model="voyage-4", input_type="document")
print(result.embeddings[0])
print(result.embeddings[1])
```

`result.embeddings` 将是一个包含两个嵌入向量的列表，每个向量包含 1024 个浮点数。运行上述代码后，这两个嵌入将打印在屏幕上：

```text nowrap
[-0.013131560757756233, 0.019828535616397858, ...]   # embedding for "Sample text 1"
[-0.0069352793507277966, 0.020878976210951805, ...]  # embedding for "Sample text 2"
```

在创建嵌入时，您可以向 `embed()` 函数指定其他几个参数。

有关 Voyage Python 包的更多信息，请参阅 [Voyage 文档](https://docs.voyageai.com/docs/embeddings#python-api)。

### Voyage HTTP API \{#voyage-http-api}

您也可以通过请求 Voyage HTTP API 来获取嵌入。例如，您可以在终端中通过 `curl` 命令发送 HTTP 请求：

```bash cURL
curl https://api.voyageai.com/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VOYAGE_API_KEY" \
  -d '{
    "input": ["Sample text 1", "Sample text 2"],
    "model": "voyage-4"
  }'
```

您将收到的响应是一个包含嵌入和令牌使用情况的 JSON 对象：

```json
{
  "object": "list",
  "data": [
    {
      "embedding": [-0.013131560757756233, 0.019828535616397858 /* ... */],
      "index": 0
    },
    {
      "embedding": [-0.0069352793507277966, 0.020878976210951805 /* ... */],
      "index": 1
    }
  ],
  "model": "voyage-4",
  "usage": {
    "total_tokens": 10
  }
}
```

有关 Voyage HTTP API 的更多信息，请参阅 [Voyage 文档](https://docs.voyageai.com/reference/embeddings-api)。

### AWS Marketplace \{#aws-marketplace}

Voyage 嵌入可在 [AWS Marketplace](https://aws.amazon.com/marketplace/seller-profile?id=seller-snt4gb6fd7ljg) 上获取。有关在 AWS 上访问 Voyage 的说明，请参阅 [Voyage AWS Marketplace 文档](https://docs.voyageai.com/docs/aws-marketplace-model-package?ref=anthropic)。

## 快速入门示例 \{#quickstart-example}

以下简短示例展示了如何使用嵌入。

假设您有一个包含六个文档的小型语料库用于检索

```python nocheck
documents = [
    "The Mediterranean diet emphasizes fish, olive oil, and vegetables, believed to reduce chronic diseases.",
    "Photosynthesis in plants converts light energy into glucose and produces essential oxygen.",
    "20th-century innovations, from radios to smartphones, centered on electronic advancements.",
    "Rivers provide water, irrigation, and habitat for aquatic species, vital for ecosystems.",
    "Apple's conference call to discuss fourth fiscal quarter results and business updates is scheduled for Thursday, November 2, 2023 at 2:00 p.m. PT / 5:00 p.m. ET.",
    "Shakespeare's works, like 'Hamlet' and 'A Midsummer Night's Dream,' endure in literature.",
]
```

首先，使用 Voyage 将每个文档转换为嵌入向量

```python nocheck
import voyageai

vo = voyageai.Client()

# 嵌入文档
doc_embds = vo.embed(documents, model="voyage-4", input_type="document").embeddings
```

嵌入使您能够在向量空间中进行语义搜索/检索。给定一个示例查询，

```python
query = "When is Apple's conference call scheduled?"
```

接下来，将其转换为嵌入，并进行最近邻搜索，根据嵌入空间中的距离找到最相关的文档。

```python nocheck
import numpy as np

# 嵌入查询
query_embd = vo.embed([query], model="voyage-4", input_type="query").embeddings[0]

# 计算相似度
# Voyage 嵌入已归一化为长度 1，因此点积
# 与余弦相似度是相同的。
similarities = np.dot(doc_embds, query_embd)

retrieved_id = np.argmax(similarities)
print(documents[retrieved_id])
```

请注意，`input_type="document"` 和 `input_type="query"` 分别用于嵌入文档和查询。更多规范说明请参阅 [Voyage Python 库](/docs/zh-CN/build-with-claude/embeddings#voyage-python-library)。

输出将是第 5 个文档，它确实是与查询最相关的文档：

```text
Apple's conference call to discuss fourth fiscal quarter results and business updates is scheduled for Thursday, November 2, 2023 at 2:00 p.m. PT / 5:00 p.m. ET.
```

如果您正在寻找一套详细的操作指南，了解如何使用嵌入（包括向量数据库）进行 RAG，请查看 [RAG 操作指南](https://platform.claude.com/cookbook/third-party-pinecone-rag-using-pinecone)。

## 常见问题解答 \{#faq}

  <section title="为什么 Voyage 嵌入具有卓越的质量？">

    嵌入模型依赖强大的神经网络来捕获和压缩语义上下文，这与生成式模型类似。Voyage 经验丰富的 AI 研究团队对嵌入过程的每个组件进行了优化，包括：
    - 模型架构
    - 数据收集
    - 损失函数
    - 优化器选择

    在他们的[博客](https://blog.voyageai.com/)上了解更多关于 Voyage 技术方法的信息。
  
</section>

  <section title="有哪些嵌入模型可用，我应该使用哪一个？">

    对于通用嵌入，推荐的模型如下：
    - `voyage-4-large`：最佳质量
    - `voyage-4-lite`：最低延迟和成本
    - `voyage-4`：性能均衡

    对于检索任务，请使用 `input_type` 参数指定文本是查询类型还是文档类型。

    领域专用模型：

    - 法律任务：`voyage-law-2`
    - 代码和编程文档：`voyage-code-3`
    - 金融相关任务：`voyage-finance-2`
  
</section>

  <section title="我应该使用哪种相似度函数？">

    您可以将 Voyage 嵌入与点积相似度、余弦相似度或欧几里得距离配合使用。有关嵌入相似度的说明，请参阅此[向量相似度指南](https://www.pinecone.io/learn/vector-similarity/)。

    Voyage AI 嵌入已归一化为长度 1，这意味着：

    - 余弦相似度等同于点积相似度，而后者的计算速度更快。
    - 余弦相似度和欧几里得距离将产生相同的排序结果。
  
</section>

  <section title="字符、单词和令牌之间的关系是什么？">

    请参阅此[页面](https://docs.voyageai.com/docs/tokenization?ref=anthropic)。
  
</section>

  <section title="何时以及如何使用 input_type 参数？">

    对于所有检索任务和用例（例如 RAG），请使用 `input_type` 参数指定输入文本是查询还是文档。请勿省略 `input_type` 或设置 `input_type=None`。指定输入文本是查询还是文档可以为检索创建更好的稠密向量表示，从而获得更好的检索质量。

    使用 `input_type` 参数时，会在嵌入之前将特殊提示添加到输入文本的前面。具体而言：

    > 📘 **与 `input_type` 关联的提示**
    >
    > - 对于查询，提示为 "Represent the query for retrieving supporting documents: "。
    > - 对于文档，提示为 "Represent the document for retrieval: "。
    > - 示例
    >     - 当 `input_type="query"` 时，像 "When is Apple's conference call scheduled?" 这样的查询将变为 "**Represent the query for retrieving supporting documents:** When is Apple's conference call scheduled?"
    >     - 当 `input_type="document"` 时，像 "Apple's conference call to discuss fourth fiscal quarter results and business updates is scheduled for Thursday, November 2, 2023 at 2:00 p.m. PT / 5:00 p.m. ET." 这样的文本将变为 "**Represent the document for retrieval:** Apple's conference call to discuss fourth fiscal quarter results and business updates is scheduled for Thursday, November 2, 2023 at 2:00 p.m. PT / 5:00 p.m. ET."

    `voyage-large-2-instruct`，顾名思义，经过训练可以响应添加到输入文本前面的附加指令。对于分类、聚类或其他 [MTEB](https://huggingface.co/mteb) 子任务，请使用 [voyage-large-2-instruct 指令](https://github.com/voyage-ai/voyage-large-2-instruct)。
  
</section>

  <section title="有哪些量化选项可用？">

    嵌入中的量化将高精度值（如 32 位单精度浮点数）转换为低精度格式（如 8 位整数或 1 位二进制值），从而分别将存储、内存和成本降低 4 倍和 32 倍。支持的 Voyage 模型通过使用 `output_dtype` 参数指定输出数据类型来启用量化：

    - `float`：每个返回的嵌入是一个 32 位（4 字节）单精度浮点数列表。这是默认值，提供最高的精度/检索准确性。
    - `int8` 和 `uint8`：每个返回的嵌入是一个 8 位（1 字节）整数列表，取值范围分别为 -128 到 127 和 0 到 255。
    - `binary` 和 `ubinary`：每个返回的嵌入是一个 8 位整数列表，表示位打包的量化单比特嵌入值：`binary` 对应 `int8`，`ubinary` 对应 `uint8`。返回的整数列表长度为嵌入实际维度的 1/8。binary 类型使用偏移二进制方法，您可以在下面的常见问题解答中了解更多信息。

    > **二进制量化示例**
    >
    > 考虑以下八个嵌入值：-0.03955078、0.006214142、-0.07446289、-0.039001465、0.0046463013、0.00030612946、-0.08496094 和 0.03994751。通过二进制量化，小于或等于零的值将被量化为二进制零，正值将被量化为二进制一，从而得到以下二进制序列：0、1、0、0、1、1、0、1。然后将这八个比特打包成一个 8 位整数 01001101（最左边的比特为最高有效位）。
    >   - `ubinary`：二进制序列直接转换并表示为无符号整数（`uint8`）77。
    >   - `binary`：二进制序列表示为有符号整数（`int8`）-51，使用偏移二进制方法计算得出（77 - 128 = -51）。
  
</section>

  <section title="如何截断 Matryoshka 嵌入？">

    Matryoshka 学习在单个向量中创建从粗到细的表示。支持多种输出维度的 Voyage 模型（如 `voyage-code-3`）会生成此类 Matryoshka 嵌入。您可以通过保留前导维度子集来截断这些向量。例如，以下 Python 代码演示了如何将 1024 维向量截断为 256 维：

    
    ```python nocheck
    import voyageai
    import numpy as np


    def embd_normalize(v: np.ndarray) -> np.ndarray:
        """
        Normalize the rows of a 2D numpy array to unit vectors by dividing each row by its Euclidean
        norm. Raises a ValueError if any row has a norm of zero to prevent division by zero.
        """
        row_norms = np.linalg.norm(v, axis=1, keepdims=True)
        if np.any(row_norms == 0):
            raise ValueError("Cannot normalize rows with a norm of zero.")
        return v / row_norms


    vo = voyageai.Client()

    # 生成 voyage-code-3 向量，默认为 1024 维浮点数
    embd = vo.embed(["Sample text 1", "Sample text 2"], model="voyage-code-3").embeddings

    # 设置更短的维度
    short_dim = 256

    # 将向量调整大小并归一化为更短的维度
    resized_embd = embd_normalize(np.array(embd)[:, :short_dim]).tolist()
    ```
  
</section>

## 定价 \{#pricing}

请访问 Voyage 的[定价页面](https://docs.voyageai.com/docs/pricing?ref=anthropic)获取最新的定价详情。