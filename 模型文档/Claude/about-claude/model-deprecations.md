# 模型弃用

---

随着更安全、更强大的模型发布，Anthropic 会定期停用旧模型。依赖 Anthropic 模型的应用程序可能需要不定期更新才能继续正常运行。受影响的客户将始终通过电子邮件和文档收到通知。

本页面列出了所有 API 弃用信息以及推荐的替代方案。

## 概述 \{#overview}

Anthropic 使用以下术语来描述模型生命周期：
- **活跃（Active）：** 该模型受到完全支持，推荐使用。
- **遗留（Legacy）：** 该模型将不再接收更新，未来可能会被弃用。
- **已弃用（Deprecated）：** 该模型仍可正常使用，但不再推荐。Anthropic 会提供推荐的替代方案并指定停用日期。
- **已停用（Retired）：** 该模型不再可用。对已停用模型的请求将会失败。

<Warning>
已弃用的模型可能不如活跃模型可靠。请将工作负载迁移到活跃模型，以保持最高级别的支持和可靠性。
</Warning>

本页面上的日期适用于 Anthropic 运营的平台：Claude API、[AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 以及 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry)。合作伙伴运营的平台（Amazon Bedrock 和 Vertex AI）会自行设定停用时间表，因此模型的生命周期状态和日期可能有所不同。请参阅 [Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock#supported-models)、[Amazon Bedrock（遗留）](/docs/zh-CN/build-with-claude/claude-on-amazon-bedrock-legacy#api-model-ids) 和 [Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai#api-model-ids) 的模型表格。

## 迁移到替代方案 \{#migrating-to-replacements}

一旦某个模型被弃用，请在停用日期之前将所有使用迁移到合适的替代方案。在停用日期之后对该模型的请求将会失败。

为了帮助评估替代模型在您的任务上的性能，建议在停用日期之前充分使用新模型对您的应用程序进行全面测试。

有关迁移到最新 Claude 模型的具体说明，请参阅[迁移指南](/docs/zh-CN/about-claude/models/migration-guide)。

## 通知 \{#notifications}

对于即将停用的模型，Anthropic 会通知正在使用这些模型进行活跃部署的客户，并在公开发布的模型停用前至少提前 60 天发出通知。

## 审计模型使用情况 \{#auditing-model-usage}

为了帮助识别已弃用模型的使用情况，客户可以访问其 API 使用情况的审计记录。请按照以下步骤操作：

1. 前往 Claude Console 中的[使用情况](/usage)页面
2. 点击"导出"按钮
3. 查看下载的 CSV 文件，了解按 API 密钥和模型细分的使用情况

此审计将帮助您定位应用程序中仍在使用已弃用模型的任何实例，使您能够在停用日期之前优先更新到较新的模型。

## 最佳实践 \{#best-practices}

1. 定期查看文档以获取有关模型弃用的更新信息。
2. 在当前模型的停用日期之前，充分使用较新的模型测试您的应用程序。
3. 尽快更新您的代码以使用推荐的替代模型。
4. 如果您在迁移方面需要帮助或有任何疑问，请联系支持团队。

## 弃用的不利影响及缓解措施 \{#deprecation-downsides-and-mitigations}

Anthropic 目前弃用和停用模型是为了确保有足够的容量来发布新模型。这会带来一些不利影响：
- 重视特定模型的用户必须迁移到新版本
- 研究人员无法继续访问这些模型以进行持续研究和对比研究
- 模型停用会带来与安全性和模型福祉相关的风险

Anthropic 希望在未来某个时间点能够再次公开提供过去的模型。与此同时，Anthropic 已承诺长期保存模型权重，并采取其他措施来帮助缓解这些影响。有关更多详细信息，请参阅[关于模型弃用和保存的承诺](https://www.anthropic.com/research/deprecation-commitments)。

## 模型状态 \{#model-status}

<Note>
[Claude Mythos Preview](https://anthropic.com/glasswing)（`claude-mythos-preview`）将于 2026 年 6 月 30 日停用。要迁移到 [Claude Mythos 5](https://anthropic.com/glasswing)（`claude-mythos-5`），请参阅[迁移指南](/docs/zh-CN/about-claude/models/migration-guide#migrating-from-claude-mythos-preview)。
</Note>

下表列出了当前和最近停用的模型及其状态：

| API 模型名称              | 当前状态       | 弃用日期        | 暂定停用日期 |
|:----------------------------|:--------------------|:------------------|:-------------------------|
| claude-opus-4-8               | 活跃              | 不适用               | 不早于 2027 年 5 月 28 日 |
| claude-opus-4-7               | 活跃              | 不适用               | 不早于 2027 年 4 月 16 日 |
| claude-opus-4-6             | 活跃              | 不适用               | 不早于 2027 年 2 月 5 日 |
| claude-opus-4-5-20251101  | 活跃              | 不适用               | 不早于 2026 年 11 月 24 日 |
| claude-opus-4-1-20250805  | 已弃用          | 2026 年 6 月 5 日      | 2026 年 8 月 5 日           |
| claude-opus-4-20250514    | 已弃用          | 2026 年 4 月 14 日    | 2026 年 6 月 15 日            |
| claude-sonnet-4-6         | 活跃              | 不适用               | 不早于 2027 年 2 月 17 日 |
| claude-sonnet-4-5-20250929| 活跃              | 不适用               | 不早于 2026 年 9 月 29 日 |
| claude-sonnet-4-20250514  | 已弃用          | 2026 年 4 月 14 日    | 2026 年 6 月 15 日            |
| claude-3-7-sonnet-20250219| 已停用             | 2025 年 10 月 28 日  | 2026 年 2 月 19 日          |
| claude-haiku-4-5-20251001 | 活跃              | 不适用               | 不早于 2026 年 10 月 15 日 |
| claude-3-5-haiku-20241022 | 已停用             | 2025 年 12 月 19 日 | 2026 年 2 月 19 日          |
| claude-3-haiku-20240307   | 已停用             | 2026 年 2 月 19 日 | 2026 年 4 月 20 日             |

## 弃用历史 \{#deprecation-history}

以下列出了所有弃用信息，最新公告排在最前面。

### 2026-06-05：Claude Opus 4.1 模型 \{#2026-06-05-claude-opus-4-1-model}

2026 年 6 月 5 日，Anthropic 通知了使用 Claude Opus 4.1 的开发者，该模型即将在 Claude API 上停用。

| 停用日期             | 已弃用模型            | 推荐替代方案         |
|:----------------------------|:----------------------------|:--------------------------------|
| 2026 年 8 月 5 日              | `claude-opus-4-1-20250805`  | `claude-opus-4-8`               |

### 2026-04-14：Claude Sonnet 4 和 Claude Opus 4 模型 \{#2026-04-14-claude-sonnet-4-and-claude-opus-4-models}

2026 年 4 月 14 日，Anthropic 通知了使用 Claude Sonnet 4 和 Claude Opus 4 模型的开发者，这些模型即将在 Claude API 上停用。

| 停用日期             | 已弃用模型            | 推荐替代方案         |
|:----------------------------|:----------------------------|:--------------------------------|
| 2026 年 6 月 15 日               | `claude-sonnet-4-20250514`  | `claude-sonnet-4-6`             |
| 2026 年 6 月 15 日               | `claude-opus-4-20250514`    | `claude-opus-4-8`               |

### 2026-02-19：Claude Haiku 3 模型 \{#2026-02-19-claude-haiku-3-model}

<Note>
该模型已于 2026 年 4 月 20 日停用。
</Note>

2026 年 2 月 19 日，Anthropic 通知了使用 Claude Haiku 3 模型的开发者，该模型即将在 Claude API 上停用。

| 停用日期             | 已弃用模型            | 推荐替代方案         |
|:----------------------------|:----------------------------|:--------------------------------|
| 2026 年 4 月 20 日              | `claude-3-haiku-20240307`   | `claude-haiku-4-5-20251001`     |

### 2025-12-19：Claude Haiku 3.5 模型 \{#2025-12-19-claude-haiku-3-5-model}

<Note>
该模型已于 2026 年 2 月 19 日停用。
</Note>

2025 年 12 月 19 日，Anthropic 通知了使用 Claude Haiku 3.5 模型的开发者，该模型即将在 Claude API 上停用。

| 停用日期             | 已弃用模型            | 推荐替代方案         |
|:----------------------------|:----------------------------|:--------------------------------|
| 2026 年 2 月 19 日           | `claude-3-5-haiku-20241022` | `claude-haiku-4-5-20251001`     |

### 2025-10-28：Claude Sonnet 3.7 模型 \{#2025-10-28-claude-sonnet-3-7-model}

<Note>
该模型已于 2026 年 2 月 19 日停用。
</Note>

2025 年 10 月 28 日，Anthropic 通知了使用 Claude Sonnet 3.7 模型的开发者，该模型即将在 Claude API 上停用。

| 停用日期             | 已弃用模型            | 推荐替代方案         |
|:----------------------------|:----------------------------|:--------------------------------|
| 2026 年 2 月 19 日           | `claude-3-7-sonnet-20250219`| `claude-sonnet-4-6`               |

### 2025-08-13：Claude Sonnet 3.5 模型 \{#2025-08-13-claude-sonnet-3-5-models}

<Note>
这些模型已于 2025 年 10 月 28 日停用。
</Note>

2025 年 8 月 13 日，Anthropic 通知了使用 Claude Sonnet 3.5 模型的开发者，这些模型即将停用。

| 停用日期             | 已弃用模型            | 推荐替代方案         |
|:----------------------------|:----------------------------|:--------------------------------|
| 2025 年 10 月 28 日            | `claude-3-5-sonnet-20240620`| `claude-sonnet-4-6`               |
| 2025 年 10 月 28 日            | `claude-3-5-sonnet-20241022`| `claude-sonnet-4-6`               |

### 2025-06-30：Claude Opus 3 模型 \{#2025-06-30-claude-opus-3-model}

<Note>
该模型已于 2026 年 1 月 5 日停用。
</Note>

2025 年 6 月 30 日，Anthropic 通知了使用 Claude Opus 3 模型的开发者，该模型即将停用。

| 停用日期             | 已弃用模型            | 推荐替代方案         |
|:----------------------------|:----------------------------|:--------------------------------|
| 2026 年 1 月 5 日             | `claude-3-opus-20240229`    | `claude-opus-4-8`      |

### 2025-01-21：Claude 2、Claude 2.1 和 Claude Sonnet 3 模型 \{#2025-01-21-claude-2-claude-2-1-and-claude-sonnet-3-models}

<Note>
这些模型已于 2025 年 7 月 21 日停用。
</Note>

2025 年 1 月 21 日，Anthropic 通知了使用 Claude 2、Claude 2.1 和 Claude Sonnet 3 模型的开发者，这些模型即将停用。

| 停用日期             | 已弃用模型            | 推荐替代方案         |
|:----------------------------|:----------------------------|:--------------------------------|
| 2025 年 7 月 21 日               | `claude-2.0`                | `claude-opus-4-8`                  |
| 2025 年 7 月 21 日               | `claude-2.1`                | `claude-opus-4-8`                  |
| 2025 年 7 月 21 日               | `claude-3-sonnet-20240229`  | `claude-sonnet-4-6`                |

### 2024-09-04：Claude 1 和 Instant 模型 \{#2024-09-04-claude-1-and-instant-models}

<Note>
这些模型已于 2024 年 11 月 6 日停用。
</Note>

2024 年 9 月 4 日，Anthropic 通知了使用 Claude 1 和 Instant 模型的开发者，这些模型即将停用。

| 停用日期             | 已弃用模型          | 推荐替代方案    |
|:----------------------------|:--------------------------|:---------------------------|
| 2024 年 11 月 6 日            | `claude-1.0`              | `claude-haiku-4-5-20251001`|
| 2024 年 11 月 6 日            | `claude-1.1`              | `claude-haiku-4-5-20251001`|
| 2024 年 11 月 6 日            | `claude-1.2`              | `claude-haiku-4-5-20251001`|
| 2024 年 11 月 6 日            | `claude-1.3`              | `claude-haiku-4-5-20251001`|
| 2024 年 11 月 6 日            | `claude-instant-1.0`      | `claude-haiku-4-5-20251001`|
| 2024 年 11 月 6 日            | `claude-instant-1.1`      | `claude-haiku-4-5-20251001`|
| 2024 年 11 月 6 日            | `claude-instant-1.2`      | `claude-haiku-4-5-20251001`|

## API 参数弃用 \{#api-parameter-deprecations}

Anthropic 会不定期弃用不再适用于当前模型的请求参数。已弃用的参数仍保留在 SDK 请求类型中，以便现有代码能够继续通过类型检查，但其行为会因模型而异。

| 参数 | 状态 | 行为 | 推荐替代方案 |
| --- | --- | --- | --- |
| `temperature`、`top_p`、`top_k` | 已弃用（Claude Opus 4.7 及更高版本） | 在 Claude Opus 4.7 及更高版本（包括 Claude Opus 4.8）上设置为非默认值时，将返回 400 错误。 | 省略该参数，并使用[提示工程](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)来引导模型行为。 |

有关迁移步骤，请参阅[迁移指南](/docs/zh-CN/about-claude/models/migration-guide)。