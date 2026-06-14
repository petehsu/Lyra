# 用量与成本 API

通过 Usage & Cost Admin API 以编程方式访问您组织的 API 用量和成本数据。

---

<Tip>
**Admin API 不适用于个人账户。** 如需与团队成员协作并添加成员，请在 **Console → Settings → Organization** 中设置您的组织。
</Tip>

Usage & Cost Admin API 提供对您组织历史 API 用量和成本数据的编程式细粒度访问。这些数据与 Claude Console 中 [Usage](/usage)（用量）和 [Cost](/cost)（成本）页面提供的信息类似。

此 API 使您能够更好地监控、分析和优化您的 Claude 实现：

* **精确的用量跟踪：** 获取精确的令牌计数和使用模式，而不是仅依赖响应中的令牌计数
* **成本对账：** 将内部记录与 Anthropic 账单进行匹配，供财务和会计团队使用
* **产品性能与改进：** 监控产品性能，同时衡量系统变更是否带来改进，或设置告警
* **[速率限制](/docs/zh-CN/api/rate-limits)和 [Priority Tier](/docs/zh-CN/api/service-tiers#get-started-with-priority-tier) 优化：** 优化[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)等功能或特定提示，以充分利用已分配的容量，或购买专用容量。
* **高级分析：** 执行比 Console 中可用功能更深入的数据分析

<Check>
  **需要 Admin API 密钥**

  此 API 是 [Admin API](/docs/zh-CN/manage-claude/admin-api) 的一部分。这些端点需要 Admin API 密钥（以 `sk-ant-admin...` 开头），它与标准 API 密钥不同。只有具有管理员角色的组织成员才能通过 [Claude Console](/settings/admin-keys) 配置 Admin API 密钥。
</Check>

<Note>
**AWS 上的 Claude Platform：** 目前不提供编程式的用量与成本 API 端点。请改为在 Claude Console 的 **Usage**（用量）和 **Cost**（成本）页面中查看用量和成本数据。
</Note>

## 合作伙伴解决方案 \{#partner-solutions}

领先的可观测性平台提供开箱即用的集成，用于监控您的 Claude API 用量和成本，无需编写自定义代码。这些集成提供仪表板、告警和分析功能，帮助您有效管理 API 用量。

<CardGroup cols={3}>
  <Card title="CloudZero" icon="chart" href="https://docs.cloudzero.com/docs/connections-anthropic">
    用于跟踪和预测成本的云智能平台
  </Card>
  <Card title="Datadog" icon="chart" href="https://docs.datadoghq.com/integrations/anthropic/">
    具有自动追踪和监控功能的 LLM 可观测性
  </Card>
  <Card title="Grafana Cloud" icon="chart" href="https://grafana.com/docs/grafana-cloud/monitor-infrastructure/integrations/integration-reference/integration-anthropic/">
    无代理集成，通过开箱即用的仪表板和告警轻松实现 LLM 可观测性
  </Card>
  <Card title="Honeycomb" icon="polygon" href="https://docs.honeycomb.io/integrations/anthropic-usage-monitoring/">
    通过 OpenTelemetry 进行高级查询和可视化
  </Card>
  <Card title="Vantage" icon="chart" href="https://docs.vantage.sh/connecting_anthropic">
    用于 LLM 成本和用量可观测性的 FinOps 平台
  </Card>
</CardGroup>

## 快速开始 \{#quick-start}

获取您组织过去 7 天的每日用量：

```bash cURL
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2025-01-08T00:00:00Z&\
ending_at=2025-01-15T00:00:00Z&\
bucket_width=1d" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

<Tip>
  **为集成设置 User-Agent 标头**

  如果您正在构建集成，请设置 User-Agent 标头以帮助我们了解使用模式：
  ```text
  User-Agent: YourApp/1.0.0 (https://yourapp.com)
  ```
</Tip>

## 用量 API \{#usage-api}

通过 `/v1/organizations/usage_report/messages` 端点，按模型、工作区和服务层级详细分类，跟踪整个组织的令牌消耗情况。

### 关键概念 \{#key-concepts}

- **时间桶**：以固定间隔（`1m`、`1h` 或 `1d`）聚合用量数据
- **令牌跟踪**：测量未缓存输入、已缓存输入、缓存创建和输出令牌
- **筛选与分组**：按 API 密钥、工作区、模型、服务层级、上下文窗口、[数据驻留](/docs/zh-CN/manage-claude/data-residency)或速度（测试版）进行筛选，并按这些维度对结果进行分组
- **服务器工具使用**：跟踪网络搜索等服务器端工具的使用情况

有关完整的参数详情和响应架构，请参阅[用量 API 参考](/docs/zh-CN/api/admin-api/usage-cost/get-messages-usage-report)。

### 基本示例 \{#basic-examples}

#### 按模型统计的每日用量 \{#daily-usage-by-model}

```bash cURL
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2025-01-01T00:00:00Z&\
ending_at=2025-01-08T00:00:00Z&\
group_by[]=model&\
bucket_width=1d" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

#### 带筛选条件的每小时用量 \{#hourly-usage-with-filtering}

```bash cURL
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2025-01-15T00:00:00Z&\
ending_at=2025-01-15T23:59:59Z&\
models[]=claude-opus-4-8&\
service_tiers[]=batch&\
context_window[]=0-200k&\
bucket_width=1h" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

#### 按 API 密钥和工作区筛选用量 \{#filter-usage-by-api-keys-and-workspaces}

```bash cURL
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2025-01-01T00:00:00Z&\
ending_at=2025-01-08T00:00:00Z&\
api_key_ids[]=apikey_01Rj2N8SVvo6BePZj99NhmiT&\
api_key_ids[]=apikey_01ABC123DEF456GHI789JKL&\
workspace_ids[]=wrkspc_01JwQvzr7rXLA5AGx3HKfFUJ&\
workspace_ids[]=wrkspc_01XYZ789ABC123DEF456MNO&\
bucket_width=1d" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

<Tip>
要检索您组织的 API 密钥 ID，请使用 [List API Keys](/docs/zh-CN/api/admin-api/apikeys/list-api-keys) 端点。

要检索您组织的工作区 ID，请使用 [List Workspaces](/docs/zh-CN/api/admin-api/workspaces/list-workspaces) 端点，或在 Claude Console 中查找您组织的工作区 ID。
</Tip>

#### 数据驻留 \{#data-residency}

通过使用 `inference_geo` 维度对用量进行分组和筛选，跟踪您的[数据驻留控制](/docs/zh-CN/manage-claude/data-residency)。这对于验证整个组织的地理路由非常有用。

```bash cURL
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2026-02-01T00:00:00Z&\
ending_at=2026-02-08T00:00:00Z&\
group_by[]=inference_geo&\
group_by[]=model&\
bucket_width=1d" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

您还可以筛选特定的地理位置。有效值为 `global`、`us` 和 `not_available`：

```bash cURL
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2026-02-01T00:00:00Z&\
ending_at=2026-02-08T00:00:00Z&\
inference_geos[]=us&\
group_by[]=model&\
bucket_width=1d" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

<Note>
2026 年 2 月之前发布的模型（即 Claude Opus 4.6 和 Claude Sonnet 4.6 之前的模型）不支持 `inference_geo` 请求参数，因此它们的用量报告在此维度上返回 `"not_available"`。您可以在 `inference_geos[]` 中使用 `not_available` 作为筛选值来定位这些模型。
</Note>

#### 快速模式（研究预览版） \{#fast-mode-research-preview}

通过使用 `speed` 维度进行分组和筛选，跟踪[快速模式](/docs/zh-CN/build-with-claude/fast-mode)的用量。这对于监控标准模式与快速模式的用量非常有用。

```bash cURL
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2026-02-01T00:00:00Z&\
ending_at=2026-02-08T00:00:00Z&\
group_by[]=speed&\
group_by[]=model&\
bucket_width=1d" \
  --header "anthropic-version: 2023-06-01" \
  --header "anthropic-beta: fast-mode-2026-02-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

您还可以筛选特定的速度。有效值为 `standard` 和 `fast`：

```bash cURL
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2026-02-01T00:00:00Z&\
ending_at=2026-02-08T00:00:00Z&\
speeds[]=fast&\
group_by[]=model&\
bucket_width=1d" \
  --header "anthropic-version: 2023-06-01" \
  --header "anthropic-beta: fast-mode-2026-02-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

<Note>
`speeds[]` 筛选器和 `speed` group_by 值都需要 `fast-mode-2026-02-01` 测试版标头。
</Note>

### 时间粒度限制 \{#time-granularity-limits}

| 粒度 | 默认限制 | 最大限制 | 使用场景 |
|-------------|---------------|---------------|----------|
| `1m` | 60 个桶 | 1440 个桶 | 实时监控 |
| `1h` | 24 个桶 | 168 个桶 | 每日模式 |
| `1d` | 7 个桶 | 31 个桶 | 每周/每月报告 |

## 成本 API \{#cost-api}

通过 `/v1/organizations/cost_report` 端点检索以美元计的服务级别成本明细。

### 关键概念 \{#key-concepts-2}

- **货币**：所有成本均以美元计，以最小单位（美分）的十进制字符串形式报告
- **成本类型**：跟踪令牌使用、网络搜索和代码执行成本
- **分组**：按工作区或描述对成本进行分组以获得详细明细。按 `description` 分组时，响应包含 `model` 和 `inference_geo` 等已解析字段
- **时间桶**：仅支持每日粒度（`1d`）

有关完整的参数详情和响应架构，请参阅[成本 API 参考](/docs/zh-CN/api/admin-api/usage-cost/get-cost-report)。

<Warning>
  Priority Tier 成本使用不同的计费模型，不包含在成本端点中。请改为通过用量端点跟踪 Priority Tier 用量。
</Warning>

### 基本示例 \{#basic-example}

```bash cURL
curl "https://api.anthropic.com/v1/organizations/cost_report?\
starting_at=2025-01-01T00:00:00Z&\
ending_at=2025-01-31T00:00:00Z&\
group_by[]=workspace_id&\
group_by[]=description" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

## 分页 \{#pagination}

两个端点都支持对大型数据集进行分页：

1. 发起初始请求
2. 如果 `has_more` 为 `true`，则在下一个请求中使用 `next_page` 值
3. 继续直到 `has_more` 为 `false`

```bash cURL
# 第一个请求
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2025-01-01T00:00:00Z&\
ending_at=2025-01-31T00:00:00Z&\
limit=7" \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"

# 响应包含："has_more": true, "next_page": "page_xyz..."

# 使用分页的下一个请求
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
starting_at=2025-01-01T00:00:00Z&\
ending_at=2025-01-31T00:00:00Z&\
limit=7&\
page=page_xyz..." \
  --header "anthropic-version: 2023-06-01" \
  --header "x-api-key: $ANTHROPIC_ADMIN_KEY"
```

## 常见使用场景 \{#common-use-cases}

在 [Claude Cookbook](https://platform.claude.com/cookbooks) 中探索详细的实现：

- **每日用量报告**：跟踪令牌消耗趋势
- **成本归因**：按工作区分配费用以进行内部结算
- **缓存效率**：测量和优化提示缓存
- **预算监控**：为支出阈值设置告警
- **CSV 导出**：为财务团队生成报告

## 常见问题 \{#frequently-asked-questions}

### 数据的新鲜度如何？ \{#how-fresh-is-the-data}
用量和成本数据通常在 API 请求完成后 5 分钟内出现，但延迟偶尔可能更长。

### 推荐的轮询频率是多少？ \{#whats-the-recommended-polling-frequency}
该 API 支持持续使用时每分钟轮询一次。对于短时突发（例如下载分页数据），可以接受更频繁的轮询。对于需要频繁更新的仪表板，请缓存结果。

### 如何跟踪代码执行用量？ \{#how-do-i-track-code-execution-usage}
代码执行成本出现在成本端点中，在 description 字段下归类为 `Code Execution Usage`。代码执行不包含在用量端点中。

### 如何跟踪 Priority Tier 用量？ \{#how-do-i-track-priority-tier-usage}
在用量端点中按 `service_tier` 筛选或分组，并查找 `priority` 值。Priority Tier 成本在成本端点中不可用。

### Workbench 用量如何处理？ \{#what-happens-with-workbench-usage}
来自 Workbench 的 API 用量不与任何 API 密钥关联，因此即使按该维度分组，`api_key_id` 也将为 `null`。

### 默认工作区如何表示？ \{#how-is-the-default-workspace-represented}
归属于默认工作区的用量和成本的 `workspace_id` 值为 `null`。

### 如何获取 Claude Code 的每用户成本明细？ \{#how-do-i-get-per-user-cost-breakdowns-for-claude-code}

使用 [Claude Code Analytics API](/docs/zh-CN/manage-claude/claude-code-analytics-api)，它提供每用户的估算成本和生产力指标，而不会因按大量 API 密钥分解成本而产生性能限制。对于使用大量密钥的常规 API 用量，请使用[用量 API](#usage-api) 跟踪令牌消耗作为成本的代理指标。

## 另请参阅 \{#see-also}
用量与成本 API 可用于帮助您为用户提供更好的体验、帮助您管理成本并保护您的速率限制。了解有关这些其他功能的更多信息：

- [Admin API](/docs/zh-CN/manage-claude/admin-api)
- [Admin API 参考](/docs/zh-CN/api/admin)
- [定价](/docs/zh-CN/about-claude/pricing)
- [提示缓存](/docs/zh-CN/build-with-claude/prompt-caching) - 通过缓存优化成本
- [批处理](/docs/zh-CN/build-with-claude/batch-processing) - 批量请求享受 50% 折扣
- [速率限制](/docs/zh-CN/api/rate-limits) - 了解用量层级
- [速率限制 API](/docs/zh-CN/manage-claude/rate-limits-api) - 读取您配置的速率限制
- [数据驻留](/docs/zh-CN/manage-claude/data-residency) - 控制推理地理位置