# Claude 的工具使用

将 Claude 连接到外部工具和 API。了解工具在何处执行以及智能体循环的工作原理。

---

"Tool use"（工具使用）让 Claude 能够调用您定义的函数或 Anthropic 提供的函数。Claude 会根据用户的请求和工具的描述来决定何时调用工具，然后返回一个结构化的调用，由您的应用程序执行（客户端工具）或由 Anthropic 执行（服务器工具）。

以下是使用服务器工具的最简单示例，其中由 Anthropic 处理执行：

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "tools": [{"type": "web_search_20260209", "name": "web_search"}],
    "messages": [{"role": "user", "content": "What'\''s the latest on the Mars rover?"}]
  }'
```

```bash CLI
ant messages create --transform content --format yaml \
  --model claude-opus-4-8 \
  --max-tokens 1024 \
  --tool '{type: web_search_20260209, name: web_search}' \
  --message '{role: user, content: "What is the latest on the Mars rover?"}'
```

```python Python
import anthropic

client = anthropic.Anthropic()
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=[{"type": "web_search_20260209", "name": "web_search"}],
    messages=[{"role": "user", "content": "What's the latest on the Mars rover?"}],
)
print(response.content)
```

```typescript TypeScript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [{ type: "web_search_20260209", name: "web_search" }],
  messages: [{ role: "user", content: "What's the latest on the Mars rover?" }]
});
console.log(response.content);
```
</CodeGroup>

---

## 工具使用的工作原理 \{#how-tool-use-works}

工具的主要区别在于代码的执行位置。**客户端工具**（包括用户定义的工具以及 Anthropic 提供模式的工具，如 bash 和 text_editor）在您的应用程序中运行：Claude 会返回 `stop_reason: "tool_use"` 以及一个或多个 `tool_use` 块，您的代码执行相应操作，然后您发回一个 `tool_result`。**服务器工具**（web_search、code_execution、web_fetch、tool_search）在 Anthropic 的基础设施上运行：您可以直接看到结果，无需处理执行过程。

有关完整的概念模型，包括智能体循环以及何时选择每种方法，请参阅[工具使用的工作原理](/docs/zh-CN/agents-and-tools/tool-use/how-tool-use-works)。

有关连接到 MCP 服务器的信息，请参阅 [MCP 连接器](/docs/zh-CN/agents-and-tools/mcp-connector)。有关构建您自己的 MCP 客户端的信息，请参阅 [modelcontextprotocol.io](https://modelcontextprotocol.io/docs/develop/build-client)。

<Tip>
**通过严格工具使用保证模式一致性**

在您的工具定义中添加 `strict: true`，以确保 Claude 的工具调用始终与您的模式完全匹配。请参阅[严格工具使用](/docs/zh-CN/agents-and-tools/tool-use/strict-tool-use)。
</Tip>

工具访问是您可以赋予智能体的最具杠杆效应的基础能力之一。在 [LAB-Bench FigQA](https://lab-bench.org/)（科学图表解读）和 [SWE-bench](https://www.swebench.com/)（真实世界软件工程）等基准测试中，即使添加基本工具也能带来显著的能力提升，通常超过人类专家基线。

---

## Claude 何时使用工具 \{#when-claude-uses-tools}

在默认的 `tool_choice` 为 `{"type": "auto"}` 时，Claude 会在每一轮决定是调用工具还是直接回应。当请求与某个工具所描述的能力相匹配且答案尚不在上下文中时，它会调用工具；对于稳定的知识、创意任务和对话性轮次，它会直接回应。

这一边界可以通过您的系统提示进行引导。如果 Claude 没有在您预期的时候调用工具，像 `"Use the tools to investigate before responding."` 这样的轻度指令可以显著增加工具使用；更强的形式如 `"Always call a tool first before responding."` 会进一步推动这一行为。相反，`"Use your judgment about whether to call a tool or respond directly."` 会使触发行为保持保守。

如果需要硬性保证而非温和引导，请使用 [`tool_choice`](/docs/zh-CN/agents-and-tools/tool-use/define-tools#forcing-tool-use)。

每个服务器工具的页面都更详细地描述了其自身的触发边界。例如，请参阅[网络搜索工具](/docs/zh-CN/agents-and-tools/tool-use/web-search-tool)或[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)。

---

## 工具使用示例 \{#tool-use-examples}

有关完整的实操演练，请参阅[教程](/docs/zh-CN/agents-and-tools/tool-use/build-a-tool-using-agent)。有关各个概念的参考示例，请参阅[定义工具](/docs/zh-CN/agents-and-tools/tool-use/define-tools)和[处理工具调用](/docs/zh-CN/agents-and-tools/tool-use/handle-tool-calls)。

<section title="当 Claude 需要更多信息时会发生什么">

如果用户的提示没有包含足够的信息来填写工具所需的所有参数，Claude Opus 更有可能识别出缺少某个参数并主动询问。Claude Sonnet 也可能会询问，尤其是在被提示先思考再输出工具请求时。但它也可能尽力推断出一个合理的值。

例如，给定一个需要 `location` 参数的 `get_weather` 工具，如果您在未指定位置的情况下询问 Claude"天气怎么样？"，Claude（尤其是 Claude Sonnet）可能会对工具输入进行猜测：

```json JSON
{
  "type": "tool_use",
  "id": "toolu_01A09q90qw90lq917835lq9",
  "name": "get_weather",
  "input": { "location": "New York, NY", "unit": "fahrenheit" }
}
```

这种行为并不能保证，尤其是对于更模糊的提示和智能程度较低的模型。如果 Claude Opus 没有足够的上下文来填写所需的参数，它更有可能以澄清性问题作为回应，而不是进行工具调用。

</section>

---

## 定价 \{#pricing}

工具使用请求的定价基于以下因素：
1. 发送给模型的输入令牌总数（包括 `tools` 参数中的令牌）
2. 生成的输出令牌数量
3. 对于服务器端工具，还会产生基于使用量的额外费用（例如，网络搜索按每次执行的搜索收费）

客户端工具的定价与任何其他 Claude API 请求相同，而服务器端工具可能会根据其具体使用情况产生额外费用。

工具使用产生的额外令牌来自：

- API 请求中的 `tools` 参数（工具名称、描述和模式）
- API 请求和响应中的 `tool_use` 内容块
- API 请求中的 `tool_result` 内容块

当您使用 `tools` 时，API 还会自动为模型包含一个特殊的系统提示以启用工具使用。每个模型所需的工具使用令牌数量如下所列（不包括上述额外令牌）。请注意，该表格假设至少提供了 1 个工具。如果未提供任何 `tools`，则工具选择为 `none` 时使用 0 个额外的系统提示令牌。

| 模型                    | 工具选择                                          | 工具使用系统提示令牌数          |
|--------------------------|------------------------------------------------------|---------------------------------------------|
| Claude Opus 4.8                | `auto`、`none`<hr />`any`、`tool`   | 290 个令牌<hr />410 个令牌 |
| Claude Opus 4.7                | `auto`、`none`<hr />`any`、`tool`   | 675 个令牌<hr />804 个令牌 |
| Claude Opus 4.6              | `auto`、`none`<hr />`any`、`tool`   | 497 个令牌<hr />589 个令牌 |
| Claude Opus 4.5            | `auto`、`none`<hr />`any`、`tool`   | 496 个令牌<hr />588 个令牌 |
| Claude Opus 4.1（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | `auto`、`none`<hr />`any`、`tool`   | 313 个令牌<hr />315 个令牌 |
| Claude Opus 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | `auto`、`none`<hr />`any`、`tool`   | 313 个令牌<hr />315 个令牌 |
| Claude Sonnet 4.6          | `auto`、`none`<hr />`any`、`tool`   | 497 个令牌<hr />589 个令牌 |
| Claude Sonnet 4.5          | `auto`、`none`<hr />`any`、`tool`   | 496 个令牌<hr />588 个令牌 |
| Claude Sonnet 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)） | `auto`、`none`<hr />`any`、`tool`   | 313 个令牌<hr />315 个令牌 |
| Claude Haiku 4.5         | `auto`、`none`<hr />`any`、`tool`   | 496 个令牌<hr />588 个令牌 |
| Claude Haiku 3.5（[已停用，Bedrock 和 Vertex AI 除外](/docs/zh-CN/about-claude/model-deprecations)） | `auto`、`none`<hr />`any`、`tool`   | 264 个令牌<hr />355 个令牌 |

这些令牌数会被添加到您的常规输入和输出令牌中，以计算请求的总费用。

有关当前各模型的价格，请参阅[模型概览表](/docs/zh-CN/about-claude/models/overview#latest-models-comparison)。

当您发送工具使用提示时，与任何其他 API 请求一样，响应将在报告的 `usage` 指标中输出输入和输出令牌计数。

---

## 后续步骤 \{#next-steps}

### 选择您的路径 \{#choose-your-path}

<CardGroup>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/how-tool-use-works" title="理解概念">
    工具在何处运行、循环如何工作以及何时使用工具。
  </Card>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/build-a-tool-using-agent" title="逐步构建">
    教程：从单个工具调用到生产环境。
  </Card>
  <Card href="/docs/zh-CN/agents-and-tools/tool-use/tool-reference" title="浏览所有工具">
    Anthropic 提供的工具及其属性目录。
  </Card>
</CardGroup>