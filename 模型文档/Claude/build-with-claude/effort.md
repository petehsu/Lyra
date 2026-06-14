# Effort

通过 effort 参数控制 Claude 在响应时使用的令牌数量，在响应完整性和令牌效率之间进行权衡。

---

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

effort 参数允许您控制 Claude 在响应请求时消耗令牌的积极程度。这使您能够在响应完整性和令牌效率之间进行权衡，而这一切只需使用单个模型即可实现。effort 参数在所有受支持的模型上均可用，无需 beta 标头。

<Note>
  effort 参数受 Claude Fable 5、[Claude Mythos 5](https://anthropic.com/glasswing)、Claude Opus 4.8、[Claude Mythos Preview](https://anthropic.com/glasswing)、Claude Opus 4.7、Claude Opus 4.6、Claude Sonnet 4.6 和 Claude Opus 4.5 支持。
</Note>

<Tip>
对于 Claude Opus 4.6 和 Sonnet 4.6，effort 取代了 `budget_tokens`，成为控制思考深度的推荐方式。将 effort 与[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（`thinking: {type: "adaptive"}`）结合使用可获得最佳体验。虽然 Opus 4.6 和 Sonnet 4.6 仍接受 `budget_tokens`，但该参数已被弃用，并将在未来的模型版本中移除。在 `high`（默认）和 `max` effort 级别下，Claude 几乎总是会进行思考。在较低的 effort 级别下，对于较简单的问题，它可能会跳过思考。
</Tip>

## effort 的工作原理 \{#how-effort-works}

默认情况下，Claude 使用 high effort，根据需要消耗尽可能多的令牌以获得出色的结果。您可以将 effort 级别提高到 `max` 以获得绝对最高的能力，或者降低该级别以更保守地使用令牌，从而优化速度和成本，同时接受一定程度的能力下降。

<Tip>
将 `effort` 设置为 `"high"` 所产生的行为与完全省略 `effort` 参数完全相同。
</Tip>

effort 参数会影响响应中的**所有令牌**，包括：

- 文本响应和解释
- 工具调用和函数参数
- 扩展思考（启用时）

这种方法有两个主要优势：

1. 使用它不需要启用思考功能。
2. 它可以影响所有令牌消耗，包括工具调用。例如，较低的 effort 意味着 Claude 会进行更少的工具调用。这为效率控制提供了更大的灵活性。

### Effort 级别 \{#effort-levels}

| 级别    | 描述                                                                                                                      | 典型用例                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `max`    | 绝对最高能力，对令牌消耗没有限制。在 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8、Claude Mythos Preview、Claude Opus 4.7、Claude Opus 4.6 和 Claude Sonnet 4.6 上可用。 | 需要尽可能深入的推理和最全面分析的任务 |
| `xhigh`  | 适用于长周期工作的扩展能力。在 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8 和 Claude Opus 4.7 上可用。 | 长时间运行的智能体和编码任务（超过 30 分钟），令牌预算达数百万 |
| `high`   | 高能力。等同于不设置该参数。 | 复杂推理、困难的编码问题、智能体任务                           |
| `medium` | 平衡方法，适度节省令牌。 | 需要在速度、成本和性能之间取得平衡的智能体任务                                                         |
| `low`    | 最高效。显著节省令牌，但能力有所降低。 | 需要最佳速度和最低成本的较简单任务，例如子智能体                     |

<Note>
Effort 是一种行为信号，而非严格的令牌预算。在较低的 effort 级别下，Claude 仍会对足够困难的问题进行思考，但对于同一问题，其思考程度会低于较高 effort 级别下的思考程度。
</Note>

### Sonnet 4.6 的推荐 effort 级别 \{#recommended-effort-levels-for-sonnet-4-6}

Sonnet 4.6 默认使用 `high` effort。使用 Sonnet 4.6 时请显式设置 effort，以避免出现意外的延迟：

- **Medium effort**（推荐默认值）：对于大多数应用而言，在速度、成本和性能之间实现最佳平衡。适用于智能体编码、工具密集型工作流和代码生成。
- **Low effort：** 适用于高吞吐量或对延迟敏感的工作负载。适用于优先考虑更快响应速度的聊天和非编码用例。
- **High effort：** 适用于复杂推理以及质量比速度或成本更重要的任务。
- **Max effort：** 适用于需要绝对最高能力且对令牌消耗没有限制的任务。

### Claude Opus 4.7 的推荐 effort 级别 \{#recommended-effort-levels-for-claude-opus-4-7}

**对于编码和智能体用例，请从 `xhigh` 开始**，对于大多数对智能要求较高的工作负载，请至少使用 `high`。对于成本敏感的工作负载，可降至 `medium`；仅当您的评估显示在 `xhigh` 级别下仍有可衡量的提升空间时，才升至 `max`。

API 默认值为 `high`。要使用 `xhigh`，请显式设置 `effort`；您传入的值会覆盖默认值。

| Effort | Claude Opus 4.7 使用指南 |
|--------|------------------------------|
| `low`    | 高效，但最适合简短、范围明确的任务。如果您的任务包含多个部分，请将 `low` 与明确的检查清单搭配使用。 |
| `medium` | 适用于希望在降低成本的同时获得良好结果的一般工作流的即插即用选项。 |
| `high`   | 仍需要在智能和令牌消耗之间取得平衡的高级用例。这通常是平衡质量和令牌效率的最佳选择。 |
| `xhigh`  | 编码和智能体工作的推荐起点，也适用于探索性任务，例如重复工具调用、详细的网络搜索和知识库搜索。预计令牌使用量会明显高于 `high`。 |
| `max`    | 保留用于真正的前沿问题。在大多数工作负载上，`max` 会显著增加成本，但质量提升相对较小；在某些结构化输出或对智能要求较低的任务上，它可能导致过度思考。 |

Claude Opus 4.7 对 effort 级别的遵循也比 Claude Opus 4.6 更严格，尤其是在 `low` 和 `medium` 级别。在较低的 effort 级别下，模型会将其工作范围限定在所要求的内容上，而不会超额完成。如果您在使用 Claude Opus 4.7 处理复杂问题时观察到推理较浅，请提高 effort 级别，而不是通过提示来绕过这个问题。如果您必须为了延迟而保持较低的 effort，请添加有针对性的指导，例如"此任务涉及多步推理。请在响应前仔细思考。"

在 `xhigh` 或 `max` effort 级别下运行 Claude Opus 4.7 时，请设置较大的 `max_tokens`，以便模型有足够的空间在子智能体和工具调用之间进行思考和操作。从 64k 令牌开始并据此调整是一个合理的默认值。

### Claude Opus 4.8 的推荐 effort 级别 \{#recommended-effort-levels-for-claude-opus-4-8}

上述针对 Claude Opus 4.7 的指南同样适用于 Claude Opus 4.8。**对于编码和智能体用例，请从 `xhigh` 开始**，对于大多数其他对智能要求较高的工作负载使用 `high`，仅当您通过评估确认较低级别在您的用例上能保持质量时，才降至 `medium` 或 `low`。

在所有平台上（包括 Claude API 和 Claude Code），默认值均为 `high`。显式设置 `effort` 以使用不同的级别；您传入的值会覆盖默认值。

在 `xhigh` 或 `max` effort 级别下运行 Claude Opus 4.8 时，请设置较大的 `max_tokens`，以便模型有足够的空间在子智能体和工具调用之间进行思考和操作。从 64k 令牌开始并据此调整是一个合理的默认值。

### Claude Fable 5 的推荐 effort 级别 \{#recommended-effort-levels-for-claude-fable-5}

Effort 是在 Claude Fable 5 上权衡智能、延迟和成本的主要控制手段。**对于大多数任务，请从默认值 `high` 开始**，对于对能力要求最高的工作负载使用 `xhigh`，对于常规工作则降至 `medium` 或 `low`。Claude Fable 5 上较低的 effort 设置仍然表现良好，并且通常超过之前模型在 `xhigh` 级别下的表现。在 `high` 和 `xhigh` 级别下，请设置较大的 `max_tokens`：它是总输出（思考加响应文本）的硬性限制。请参阅[成本控制](/docs/zh-CN/build-with-claude/adaptive-thinking#cost-control)。

如果任务能够完成但耗时超过必要时间，或者您希望获得更快、更具交互性的工作方式，请降低 effort。同样的建议也适用于 Claude Mythos 5。如需更完整的指南，请参阅[为 Claude Fable 5 编写提示](/docs/zh-CN/build-with-claude/prompt-engineering/prompting-claude-fable-5)。

## 基本用法 \{#basic-usage}

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
    --header "x-api-key: $ANTHROPIC_API_KEY" \
    --header "anthropic-version: 2023-06-01" \
    --header "content-type: application/json" \
    --data '{
        "model": "claude-opus-4-8",
        "max_tokens": 4096,
        "messages": [{
            "role": "user",
            "content": "Analyze the trade-offs between microservices and monolithic architectures"
        }],
        "output_config": {
            "effort": "medium"
        }
    }'
```

```bash CLI
ant messages create --transform 'content.0.text' --raw-output <<'YAML'
model: claude-opus-4-8
max_tokens: 4096
messages:
  - role: user
    content: Analyze the trade-offs between microservices and monolithic architectures
output_config:
  effort: medium
YAML
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
            "content": "Analyze the trade-offs between microservices and monolithic architectures",
        }
    ],
    output_config={"effort": "medium"},
)

print(response.content[0].text)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content: "Analyze the trade-offs between microservices and monolithic architectures"
    }
  ],
  output_config: {
    effort: "medium"
  }
});

const textBlock = response.content.find(
  (block): block is Anthropic.TextBlock => block.type === "text"
);
console.log(textBlock?.text);
```

```csharp C#
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
            Messages = [new() { Role = Role.User, Content = "Analyze the trade-offs between microservices and monolithic architectures" }],
            OutputConfig = new OutputConfig
            {
                Effort = Effort.Medium
            }
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

	response, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 4096,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Analyze the trade-offs between microservices and monolithic architectures")),
		},
		OutputConfig: anthropic.OutputConfigParam{
			Effort: anthropic.OutputConfigEffortMedium,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response.Content[0].Text)
}
```

```java Java hidelines={1..5,7..9,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.OutputConfig;

public class Main {
    public static void main(String[] args) {
        AnthropicClient client = AnthropicOkHttpClient.fromEnv();

        MessageCreateParams params = MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(4096L)
            .addUserMessage("Analyze the trade-offs between microservices and monolithic architectures")
            .outputConfig(OutputConfig.builder()
                .effort(OutputConfig.Effort.MEDIUM)
                .build())
            .build();

        Message response = client.messages().create(params);
        response.content().stream()
            .flatMap(block -> block.text().stream())
            .forEach(textBlock -> System.out.println(textBlock.text()));
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
        ['role' => 'user', 'content' => 'Analyze the trade-offs between microservices and monolithic architectures']
    ],
    model: 'claude-opus-4-8',
    outputConfig: ['effort' => 'medium'],
);

echo $message->content[0]->text;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

message = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 4096,
  messages: [
    { role: "user", content: "Analyze the trade-offs between microservices and monolithic architectures" }
  ],
  output_config: {
    effort: "medium"
  }
)

puts message.content.first.text
```

</CodeGroup>

## 何时调整 effort 参数 \{#when-to-adjust-the-effort-parameter}

- 当您需要绝对最高能力且没有任何限制时，使用 **max effort**：最全面的推理和最深入的分析。在 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8、Claude Mythos Preview、Claude Opus 4.7、Claude Opus 4.6 和 Claude Sonnet 4.6 上可用。
- 对于需要扩展探索的高级编码和复杂智能体工作（例如重复工具调用和详细搜索），使用 **xhigh effort**。在 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8 和 Claude Opus 4.7 上可用。
- 对于复杂推理、细致分析、困难的编码问题，或任何质量比速度或成本更重要的任务，使用 **high effort**（默认值）。
- 当您希望获得稳定的性能而不需要 high effort 的全部令牌消耗时，使用 **medium effort** 作为平衡选项。
- 当您优化速度（因为 Claude 使用更少的令牌来回答）或成本时，使用 **low effort**。例如，简单的分类任务、快速查询，或边际质量提升不足以证明额外延迟或花费合理性的高吞吐量用例。

<Note>
**Claude Code 的 ultracode 模式：** ultracode 出现在 Claude Code 的 effort 菜单中，但它并不是额外的 API effort 级别。本页面记录的值是 API 接受的完整集合。Ultracode 将 `xhigh` effort 级别与 Claude Code 启动多智能体工作流的常驻权限相结合，该权限通过[对话中系统消息](/docs/zh-CN/build-with-claude/mid-conversation-system-messages)授予。要使用 API 构建类似的行为，请参阅[构建编排模式](/docs/zh-CN/build-with-claude/mid-conversation-effort-example)。
</Note>

## Effort 与工具使用 \{#effort-with-tool-use}

使用工具时，effort 参数会同时影响围绕工具调用的解释和工具调用本身。较低的 effort 级别往往会：

- 将多个操作合并为更少的工具调用
- 进行更少的工具调用
- 直接进入操作而不加开场白
- 完成后使用简洁的确认消息

较高的 effort 级别可能会：

- 进行更多的工具调用
- 在采取行动之前解释计划
- 提供详细的变更摘要
- 包含更全面的代码注释

## Effort 与扩展思考 \{#effort-with-extended-thinking}

effort 参数与扩展思考协同工作。其行为取决于模型：

- **Claude Fable 5 和 Claude Mythos 5** 使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)，该功能始终开启（无需 `thinking` 配置）。`thinking: {type: "disabled"}` 会被拒绝。Effort 控制思考深度的方式与 Opus 4.8 和 Opus 4.7 相同。
- **Claude Opus 4.8** 使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（`thinking: {type: "adaptive"}`），其中 effort 是控制思考深度的推荐方式。不支持手动扩展思考（`thinking: {type: "enabled", budget_tokens: N}`），会返回 400 错误。模型会根据每个请求决定何时以及思考多少，因此仅在需要时触发思考。在 `high`、`xhigh` 和 `max` effort 级别下，Claude 几乎总是会深入思考。在较低级别下，对于较简单的问题，它可能会跳过思考。设置 `thinking: {type: "adaptive"}` 以启用思考；如果不设置，请求将在不思考的情况下运行。
- **Claude Mythos Preview** 默认使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（无需 `thinking` 配置）。`thinking: {type: "disabled"}` 会被拒绝。Effort 控制思考深度的方式与 Opus 4.7 和 Opus 4.6 相同。
- **Claude Opus 4.7** 使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（`thinking: {type: "adaptive"}`），其中 effort 是控制思考深度的推荐方式。Opus 4.7 不再支持手动扩展思考（`thinking: {type: "enabled", budget_tokens: N}`）；请改用带 effort 的自适应思考。在 `high`、`xhigh` 和 `max` effort 级别下，Claude 几乎总是会深入思考。在较低级别下，对于较简单的问题，它可能会跳过思考。
- **Claude Opus 4.6** 使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（`thinking: {type: "adaptive"}`），其中 effort 是控制思考深度的推荐方式。虽然 Opus 4.6 仍接受 `budget_tokens`，但该参数已被弃用，并将在未来版本中移除。在 `high` 和 `max` effort 级别下，Claude 几乎总是会深入思考。在较低级别下，对于较简单的问题，它可能会跳过思考。
- **Claude Sonnet 4.6** 使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（其中 effort 控制思考深度）。带[交错模式](/docs/zh-CN/build-with-claude/extended-thinking#interleaved-thinking)的手动思考（`thinking: {type: "enabled", budget_tokens: N}`）仍然可用，但已被弃用。
- **Claude Opus 4.5** 使用手动思考（`thinking: {type: "enabled", budget_tokens: N}`），其中 effort 与思考令牌预算协同工作。根据您的任务设置 effort 级别，然后根据任务复杂度设置思考令牌预算。

无论是否启用扩展思考，都可以使用 effort 参数。在不启用思考的情况下使用时，它仍然控制文本响应和工具调用的总体令牌消耗。

## 最佳实践 \{#best-practices}

1. **显式设置 effort：** API 默认为 `high`，但正确的起点取决于您的模型和工作负载。
2. **对速度敏感或简单的任务使用 low：** 当延迟很重要或任务较为简单时，low effort 可以显著减少响应时间和成本。
3. **测试您的用例：** effort 级别的影响因任务类型而异。在部署之前，请在您的具体用例上评估性能。
4. **考虑动态 effort：** 根据任务复杂度调整 effort。简单查询可能适合使用 low effort，而智能体编码和复杂推理则受益于 high effort。