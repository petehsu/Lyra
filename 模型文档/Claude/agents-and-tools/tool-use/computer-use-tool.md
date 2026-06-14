# 计算机使用工具

---

Claude 可以通过计算机使用工具与计算机环境进行交互，该工具提供截图功能和鼠标/键盘控制，用于自主桌面交互。在 [WebArena](https://webarena.dev/)（一个针对真实网站自主网页导航的基准测试）上，Claude 在单智能体系统中取得了最先进的结果，展示了端到端完成多步骤浏览器任务的强大能力。

<Note>
计算机使用功能目前处于测试阶段，需要使用 [beta header](/docs/zh-CN/api/beta-headers)（测试版标头）：
- `"computer-use-2025-11-24"` 适用于 Claude Opus 4.8、Claude Opus 4.7、Claude Opus 4.6、Claude Sonnet 4.6 和 Claude Opus 4.5
- `"computer-use-2025-01-24"` 适用于 Claude Sonnet 4.5、Claude Haiku 4.5、Claude Opus 4.1（[已弃用](/docs/zh-CN/about-claude/model-deprecations)）、Claude Sonnet 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)）和 Claude Opus 4（[已弃用](/docs/zh-CN/about-claude/model-deprecations)）

请通过[反馈表单](https://forms.gle/H6UFuXaaLywri9hz6)分享您对此功能的反馈。
</Note>

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

## 概述 \{#overview}

计算机使用是一项测试版功能，使 Claude 能够与桌面环境进行交互。此工具提供：

- **截图捕获：** 查看屏幕上当前显示的内容
- **鼠标控制：** 点击、拖动和移动光标
- **键盘输入：** 输入文本和使用键盘快捷键
- **桌面自动化：** 与任何应用程序或界面进行交互

虽然计算机使用可以与其他工具（如 bash 和文本编辑器）结合使用，以实现更全面的自动化工作流程，但计算机使用特指计算机使用工具查看和控制桌面环境的能力。

有关模型支持情况，请参阅[工具参考](/docs/zh-CN/agents-and-tools/tool-use/tool-reference)。

## 安全注意事项 \{#security-considerations}

计算机使用是一项测试版功能，具有与标准 API 功能不同的独特风险。在与互联网交互时，这些风险会进一步加剧。

<Warning>
为了将风险降至最低，请考虑采取以下预防措施：

1. 使用具有最低权限的专用虚拟机或容器，以防止直接的系统攻击或意外事故。
2. 避免让模型访问敏感数据（如账户登录信息），以防止信息被窃取。
3. 将互联网访问限制在允许的域名列表内，以减少接触恶意内容的风险。
4. 对于可能导致重大现实后果的决策以及任何需要明确同意的任务（如接受 Cookie、完成金融交易或同意服务条款），请要求人工确认。
</Warning>

在某些情况下，Claude 会遵循内容中发现的命令，即使这些命令与用户的指令相冲突。例如，网页上或图像中包含的 Claude 指令可能会覆盖用户指令或导致 Claude 出错。请采取预防措施，将 Claude 与敏感数据和操作隔离开来，以避免与提示注入相关的风险。

Anthropic 已训练模型抵御这些提示注入，并增加了额外的防御层。如果您使用计算机使用工具，分类器将自动对您的提示运行，以标记潜在的提示注入实例。当这些分类器在截图中识别出潜在的提示注入时，它们会自动引导模型在继续下一步操作之前请求用户确认。这种额外的保护并非适用于所有用例（例如，没有人工参与的用例），因此如果您希望选择退出并关闭此功能，请[联系支持团队](https://support.claude.com/en/)。

即使有分类器防御层，这些预防措施仍然很重要。

在您自己的产品中启用计算机使用功能之前，请告知最终用户相关风险并获得他们的同意。

<Card
  title="计算机使用参考实现"
  icon="computer"
  href="https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo"
>

开始使用计算机使用参考实现，其中包括 Web 界面、Docker 容器、示例工具实现和智能体循环。

</Card>

## 快速开始 \{#quick-start}

以下是如何开始使用计算机使用功能：

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: computer-use-2025-11-24" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "tools": [
      {
        "type": "computer_20251124",
        "name": "computer",
        "display_width_px": 1024,
        "display_height_px": 768,
        "display_number": 1
      },
      {
        "type": "text_editor_20250728",
        "name": "str_replace_based_edit_tool"
      },
      {
        "type": "bash_20250124",
        "name": "bash"
      }
    ],
    "messages": [
      {
        "role": "user",
        "content": "Save a picture of a cat to my desktop."
      }
    ]
  }'
```

```bash CLI
ant beta:messages create --beta computer-use-2025-11-24 <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
tools:
  - type: computer_20251124
    name: computer
    display_width_px: 1024
    display_height_px: 768
    display_number: 1
  - type: text_editor_20250728
    name: str_replace_based_edit_tool
  - type: bash_20250124
    name: bash
messages:
  - role: user
    content: Save a picture of a cat to my desktop.
YAML
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.beta.messages.create(
    model="claude-opus-4-8",  # or another compatible model
    max_tokens=1024,
    tools=[
        {
            "type": "computer_20251124",
            "name": "computer",
            "display_width_px": 1024,
            "display_height_px": 768,
            "display_number": 1,
        },
        {"type": "text_editor_20250728", "name": "str_replace_based_edit_tool"},
        {"type": "bash_20250124", "name": "bash"},
    ],
    messages=[{"role": "user", "content": "Save a picture of a cat to my desktop."}],
    betas=["computer-use-2025-11-24"],
)
print(response)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      type: "computer_20251124",
      name: "computer",
      display_width_px: 1024,
      display_height_px: 768,
      display_number: 1
    },
    {
      type: "text_editor_20250728",
      name: "str_replace_based_edit_tool"
    },
    {
      type: "bash_20250124",
      name: "bash"
    }
  ],
  messages: [{ role: "user", content: "Save a picture of a cat to my desktop." }],
  betas: ["computer-use-2025-11-24"]
});

console.log(response);
```

```csharp C#
using Anthropic;
using Anthropic.Models.Beta.Messages;
using Messages = Anthropic.Models.Messages;

var client = new AnthropicClient();

var parameters = new MessageCreateParams
{
    Model = Messages::Model.ClaudeOpus4_8,
    MaxTokens = 1024,
    Tools = new BetaToolUnion[]
    {
        new BetaToolComputerUse20251124
        {
            DisplayWidthPx = 1024,
            DisplayHeightPx = 768,
            DisplayNumber = 1
        },
        new BetaToolTextEditor20250728(),
        new BetaToolBash20250124()
    },
    Messages =
    [
        new BetaMessageParam
        {
            Role = Role.User,
            Content = "Save a picture of a cat to my desktop."
        }
    ],
    Betas = ["computer-use-2025-11-24"]
};

var response = await client.Beta.Messages.Create(parameters);
Console.WriteLine(response);
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
		MaxTokens: 1024,
		Tools: []anthropic.BetaToolUnionParam{
			{OfComputerUseTool20251124: &anthropic.BetaToolComputerUse20251124Param{
				DisplayWidthPx:  1024,
				DisplayHeightPx: 768,
				DisplayNumber:   anthropic.Int(1),
			}},
			{OfTextEditor20250728: &anthropic.BetaToolTextEditor20250728Param{}},
			{OfBashTool20250124: &anthropic.BetaToolBash20250124Param{}},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Save a picture of a cat to my desktop.")),
		},
		Betas: []anthropic.AnthropicBeta{
			"computer-use-2025-11-24", // typed constant pending in the Go SDK
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java hidelines={1..2}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaToolBash20250124;
import com.anthropic.models.beta.messages.BetaToolComputerUse20251124;
import com.anthropic.models.beta.messages.BetaToolTextEditor20250728;
import com.anthropic.models.beta.messages.MessageCreateParams;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
        .model("claude-opus-4-8")
        .maxTokens(1024L)
        .addTool(BetaToolComputerUse20251124.builder()
            .displayWidthPx(1024L)
            .displayHeightPx(768L)
            .displayNumber(1L)
            .build())
        .addTool(BetaToolTextEditor20250728.builder().build())
        .addTool(BetaToolBash20250124.builder().build())
        .addUserMessage("Save a picture of a cat to my desktop.")
        .addBeta("computer-use-2025-11-24")
        .build();

    BetaMessage response = client.beta().messages().create(params);
    IO.println(response);
}
```

```php PHP hidelines={1..4}
<?php

use Anthropic\Client;

$client = new Client();

$response = $client->beta->messages->create(
    maxTokens: 1024,
    messages: [
        ['role' => 'user', 'content' => 'Save a picture of a cat to my desktop.'],
    ],
    model: 'claude-opus-4-8',
    tools: [
        [
            'type' => 'computer_20251124',
            'name' => 'computer',
            'display_width_px' => 1024,
            'display_height_px' => 768,
            'display_number' => 1,
        ],
        [
            'type' => 'text_editor_20250728',
            'name' => 'str_replace_based_edit_tool',
        ],
        [
            'type' => 'bash_20250124',
            'name' => 'bash',
        ],
    ],
    betas: ['computer-use-2025-11-24'],
);

echo $response;
```

```ruby Ruby hidelines={1..2}
require "anthropic"

client = Anthropic::Client.new

response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      type: "computer_20251124",
      name: "computer",
      display_width_px: 1024,
      display_height_px: 768,
      display_number: 1
    },
    {
      type: "text_editor_20250728",
      name: "str_replace_based_edit_tool"
    },
    {
      type: "bash_20250124",
      name: "bash"
    }
  ],
  messages: [
    { role: "user", content: "Save a picture of a cat to my desktop." }
  ],
  betas: ["computer-use-2025-11-24"]
)

puts response
```
</CodeGroup>

<Note>
只有计算机使用工具需要测试版标头。

上述示例展示了三个工具一起使用的情况，由于包含了计算机使用工具，因此需要测试版标头。
</Note>

---

## 计算机使用的工作原理 \{#how-computer-use-works}

<Steps>
  <Step
    title="向 Claude 提供计算机使用工具和用户提示"
    icon="tool"
  >
    - 将计算机使用工具（以及可选的其他工具）添加到您的 API 请求中。
    - 包含一个需要桌面交互的用户提示，例如"将一张猫的图片保存到我的桌面"。
  </Step>
  <Step title="Claude 选择计算机使用工具" icon="wrench">
    - Claude 评估计算机使用工具是否能帮助解决用户的查询。
    - 如果可以，Claude 会构建一个格式正确的工具使用请求。
    - API 响应的 `stop_reason` 为 `tool_use`，表示这是一个工具使用请求。
  </Step>
  <Step
    title="提取工具输入，在计算机上评估工具，并返回结果"
    icon="computer"
  >
    - 在您这一端，从 Claude 的请求中提取工具名称和输入。
    - 在容器或虚拟机上使用该工具。
    - 使用包含 `tool_result` 内容块的新 `user` 消息继续对话。
  </Step>
  <Step
    title="Claude 持续调用计算机使用工具，直到完成任务"
    icon="arrows-clockwise"
  >
    - Claude 分析工具结果，以确定是否需要更多工具使用或任务是否已完成。
    - 如果 Claude 确定需要另一个工具，它会以另一个 `tool_use` `stop_reason` 进行响应，您应返回到步骤 3。
    - 否则，它会为用户生成文本响应。
  </Step>
</Steps>

在没有用户输入的情况下重复步骤 3 和 4 被称为"智能体循环"（agent loop），即 Claude 以工具使用请求进行响应，而您的应用程序以评估该请求的结果响应 Claude。

### 计算环境 \{#the-computing-environment}

计算机使用需要一个沙盒化的计算环境，Claude 可以在其中安全地与应用程序和网络进行交互。此环境包括：

1. **虚拟显示器：** 一个虚拟 X11 显示服务器（使用 Xvfb），用于渲染 Claude 将通过截图查看并通过鼠标/键盘操作控制的桌面界面。

2. **桌面环境：** 在 Linux 上运行的轻量级 UI，包含窗口管理器（Mutter）和面板（Tint2），为 Claude 提供一致的图形界面进行交互。

3. **应用程序：** 预装的 Linux 应用程序，如 Firefox、LibreOffice、文本编辑器和文件管理器，Claude 可以使用它们来完成任务。

4. **工具实现：** 将 Claude 的抽象工具请求（如"移动鼠标"或"截图"）转换为虚拟环境中实际操作的集成代码。

5. **智能体循环：** 一个处理 Claude 与环境之间通信的程序，将 Claude 的操作发送到环境，并将结果（截图、命令输出）返回给 Claude。

当您使用计算机使用功能时，Claude 不会直接连接到此环境。相反，您的应用程序会：

1. 接收 Claude 的工具使用请求
2. 将它们转换为计算环境中的操作
3. 捕获结果（如截图和命令输出）
4. 将这些结果返回给 Claude

为了安全和隔离，参考实现在 Docker 容器内运行所有这些内容，并配置了适当的端口映射以便查看和与环境交互。

---

## 如何实现计算机使用 \{#how-to-implement-computer-use}

### 从参考实现开始 \{#start-with-the-reference-implementation}

我们提供了一个[参考实现](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo)，其中包含开始使用计算机使用所需的一切：

- 一个适用于 Claude 计算机使用的[容器化环境](https://github.com/anthropics/anthropic-quickstarts/blob/main/computer-use-demo/Dockerfile)
- [计算机使用工具](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo/computer_use_demo/tools)的实现
- 一个与 Claude API 交互并运行计算机使用工具的[智能体循环](https://github.com/anthropics/anthropic-quickstarts/blob/main/computer-use-demo/computer_use_demo/loop.py)
- 一个用于与容器、智能体循环和工具交互的 Web 界面。

### 理解智能体循环 \{#understanding-the-agentic-loop}

计算机使用的核心是"智能体循环"：一个 Claude 请求工具操作、您的应用程序运行这些操作并将结果返回给 Claude 的循环。以下是一个简化示例：

<Tabs>
<Tab title="cURL">
<Info>
智能体循环是一种有状态的多轮模式，无法转换为一次性的 shell 命令。请参阅 SDK 选项卡了解实现方式。
</Info>
</Tab>

<Tab title="CLI">
<Info>
智能体循环是一种有状态的多轮模式，无法转换为一次性的 shell 命令。请参阅 SDK 选项卡了解实现方式。
</Info>
</Tab>

<Tab title="Python">

````python
def sampling_loop(model, messages, max_iterations=10):
    """
    Run the computer-use agent loop until Claude stops requesting tools
    or the iteration limit is reached.
    """
    for _ in range(max_iterations):
        response = client.beta.messages.create(
            model=model,
            max_tokens=4096,
            messages=messages,
            tools=TOOLS,
            betas=["computer-use-2025-11-24"],
        )

        # 将 Claude 的响应添加到对话历史记录中
        messages.append({"role": "assistant", "content": response.content})

        # 运行 Claude 请求的所有工具并收集结果
        tool_results = process_tool_calls(response)
        if not tool_results:
            return messages  # No more tool use; task complete

        # 将工具结果发送回 Claude 以进行下一次迭代
        messages.append({"role": "user", "content": tool_results})

    return messages
````

</Tab>

<Tab title="TypeScript">

````typescript
async function samplingLoop(
  model: string,
  messages: Anthropic.Beta.BetaMessageParam[],
  maxIterations = 10,
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  // 运行计算机使用代理循环，直到 Claude 停止请求工具
  // 或达到迭代次数上限。
  for (let i = 0; i < maxIterations; i++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4096,
      messages,
      tools,
      betas: ["computer-use-2025-11-24"],
    });

    // 将 Claude 的响应添加到对话历史记录中
    messages.push({ role: "assistant", content: response.content });

    // 运行 Claude 请求的所有工具并收集结果
    const toolResults = processToolCalls(response);
    if (toolResults.length === 0) {
      return messages; // No more tool use; task complete
    }

    // 将工具结果发送回 Claude 以进行下一次迭代
    messages.push({ role: "user", content: toolResults });
  }

  return messages;
}
````

</Tab>

<Tab title="C#">

````csharp
async Task<List<BetaMessageParam>> SamplingLoop(
    Model model,
    List<BetaMessageParam> messages,
    int maxIterations = 10
)
{
    // 运行计算机使用代理循环，直到 Claude 停止请求工具
    // 或达到迭代次数上限。
    for (var i = 0; i < maxIterations; i++)
    {
        var response = await client.Beta.Messages.Create(
            new MessageCreateParams
            {
                Model = model,
                MaxTokens = 4096,
                Messages = messages,
                Tools = tools,
                Betas = ["computer-use-2025-11-24"],
            }
        );

        // 将 Claude 的响应添加到对话历史记录中
        messages.Add(
            new()
            {
                Role = Role.Assistant,
                Content = response
                    .Content.Select(block => new BetaContentBlockParam(block.Json))
                    .ToList(),
            }
        );

        // 运行 Claude 请求的所有工具并收集结果
        var toolResults = ProcessToolCalls(response);
        if (toolResults.Count == 0)
        {
            return messages; // No more tool use; task complete
        }

        // 将工具结果发送回 Claude 以进行下一次迭代
        messages.Add(new() { Role = Role.User, Content = toolResults });
    }

    return messages;
}
````

</Tab>

<Tab title="Go">

````go
// samplingLoop 运行计算机使用代理循环，直到 Claude 停止
// 请求工具或达到迭代次数上限。
func samplingLoop(ctx context.Context, model anthropic.Model, messages []anthropic.BetaMessageParam, maxIterations int) ([]anthropic.BetaMessageParam, error) {
	for range maxIterations {
		response, err := client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
			Model:     model,
			MaxTokens: 4096,
			Messages:  messages,
			Tools:     tools,
			Betas:     []anthropic.AnthropicBeta{"computer-use-2025-11-24"},
		})
		if err != nil {
			return nil, err
		}

		// 将 Claude 的响应添加到对话历史记录中
		messages = append(messages, response.ToParam())

		// 运行 Claude 请求的所有工具并收集结果
		toolResults := processToolCalls(response)
		if len(toolResults) == 0 {
			return messages, nil // No more tool use; task complete
		}

		// 将工具结果发送回 Claude 以进行下一次迭代
		messages = append(messages, anthropic.BetaMessageParam{
			Role:    anthropic.BetaMessageParamRoleUser,
			Content: toolResults,
		})
	}
	return messages, nil
}

````

</Tab>

<Tab title="Java">

````java
/**
 * Run the computer-use agent loop until Claude stops requesting tools
 * or the iteration limit is reached.
 */
List<BetaMessageParam> samplingLoop(Model model, List<BetaMessageParam> messages, int maxIterations) {
    for (int i = 0; i < maxIterations; i++) {
        BetaMessage response = client.beta().messages().create(MessageCreateParams.builder()
                .model(model)
                .maxTokens(4096)
                .messages(messages)
                .addTool(COMPUTER_TOOL)
                .addBeta("computer-use-2025-11-24")
                .build());

        // 将 Claude 的响应添加到对话历史记录中
        messages.add(BetaMessageParam.builder()
                .role(BetaMessageParam.Role.ASSISTANT)
                .contentOfBetaContentBlockParams(
                        response.content().stream().map(BetaContentBlock::toParam).toList())
                .build());

        // 运行 Claude 请求的所有工具并收集结果
        List<BetaContentBlockParam> toolResults = processToolCalls(response);
        if (toolResults.isEmpty()) {
            return messages; // No more tool use; task complete
        }

        // 将工具结果发送回 Claude 以进行下一次迭代
        messages.add(BetaMessageParam.builder()
                .role(BetaMessageParam.Role.USER)
                .contentOfBetaContentBlockParams(toolResults)
                .build());
    }
    return messages;
}
````

</Tab>

<Tab title="PHP">

````php
/**
 * Run the computer-use agent loop until Claude stops requesting tools
 * or the iteration limit is reached.
 */
function samplingLoop(string $model, array $messages, int $maxIterations = 10): array
{
    global $client, $tools;

    for ($i = 0; $i < $maxIterations; $i++) {
        $response = $client->beta->messages->create(
            model: $model,
            maxTokens: 4096,
            messages: $messages,
            tools: $tools,
            betas: ['computer-use-2025-11-24'],
        );

        // 将 Claude 的响应添加到对话历史记录中
        $messages[] = BetaMessageParam::with(role: Role::ASSISTANT, content: $response->content);

        // 运行 Claude 请求的所有工具并收集结果
        $toolResults = processToolCalls($response);
        if ($toolResults === []) {
            return $messages; // No more tool use; task complete
        }

        // 将工具结果发送回 Claude 以进行下一次迭代
        $messages[] = BetaMessageParam::with(role: Role::USER, content: $toolResults);
    }

    return $messages;
}
````

</Tab>

<Tab title="Ruby">

````ruby
# 运行计算机使用代理循环，直到 Claude 停止请求工具
# 或达到迭代次数上限。
def sampling_loop(model, messages, max_iterations: 10)
  max_iterations.times do
    response = CLIENT.beta.messages.create(
      model: model,
      max_tokens: 4096,
      messages: messages,
      tools: TOOLS,
      betas: ["computer-use-2025-11-24"]
    )

    # 将 Claude 的响应添加到对话历史记录中
    messages << {role: "assistant", content: response.content}

    # 运行 Claude 请求的所有工具并收集结果
    tool_results = process_tool_calls(response)
    return messages if tool_results.empty? # No more tool use; task complete

    # 将工具结果发送回 Claude 以进行下一次迭代
    messages << {role: "user", content: tool_results}
  end

  messages
end
````

</Tab>
</Tabs>

循环会持续进行，直到 Claude 在不请求任何工具的情况下响应（任务完成）或达到最大迭代限制。此保护措施可防止可能导致意外 API 成本的潜在无限循环。

在阅读本文档的其余部分之前，请先试用参考实现。

### 通过提示优化模型性能 \{#optimize-model-performance-with-prompting}

以下是一些获得最佳质量输出的技巧：

1. 指定简单、定义明确的任务，并为每个步骤提供明确的指令。
2. Claude 有时会在未明确检查结果的情况下假设其操作的结果。为防止这种情况，您可以向 Claude 提示：`After each step, take a screenshot and carefully evaluate if you have achieved the right outcome. Explicitly show your thinking: "I have evaluated step X..." If not correct, try again. Only when you confirm a step was executed correctly should you move on to the next one.`
3. 某些 UI 元素（如下拉菜单和滚动条）可能难以让 Claude 通过鼠标移动来操作。如果您遇到这种情况，请尝试提示模型使用键盘快捷键。
4. 对于可重复的任务或 UI 交互，请在提示中包含成功结果的示例截图和工具调用。
5. 如果您需要模型登录，请在提示中使用 XML 标签（如 `<robot_credentials>`）提供用户名和密码。在需要登录的应用程序中使用计算机使用功能会增加因提示注入而导致不良结果的风险。在向模型提供登录凭据之前，请查看[缓解越狱和提示注入](/docs/zh-CN/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks)。
6. 在构建用户轮次的 `content` 数组时，将指令文本放在截图图像*之前*。在处理图像之前提供目标描述可以提高点击准确性。
7. 当使用设置了 `enable_zoom: true` 的 `computer_20251124` 时，如果被问及在截图默认分辨率下无法辨认的小文本或特定 UI 元素（如侧边栏中的文件名、选项卡标题、状态栏文本、行号或按钮标签），Claude 会放大某个区域。如果 Claude 没有按您的预期进行放大，请询问特定区域或元素，而不是整个屏幕。

<Tip>
  如果您反复遇到一组明确的问题，或者提前知道 Claude 需要完成的任务，请使用系统提示为 Claude 提供有关如何成功完成任务的明确提示或指令。
</Tip>

<Tip>
  对于跨多个会话的智能体，请在每个会话开始时运行端到端验证，而不仅仅是在实现之后。基于浏览器的检查可以捕获仅靠代码级审查无法发现的来自先前会话的回归问题。有关详细信息，请参阅[长时间运行智能体的有效框架](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)。
</Tip>

### 系统提示 \{#system-prompts}

当通过 Claude API 请求 Anthropic 架构工具之一时，会生成一个特定于计算机使用的系统提示。它类似于[工具使用系统提示](/docs/zh-CN/agents-and-tools/tool-use/define-tools#tool-use-system-prompt)，但开头为：

> You have access to a set of functions you can use to answer the user's question. This includes access to a sandboxed computing environment. You do NOT currently have the ability to inspect files or interact with external resources, except by invoking the below functions.

与常规工具使用一样，用户提供的 `system_prompt` 字段仍然会被采用，并用于构建组合系统提示。

### 可用操作 \{#available-actions}

计算机使用工具支持以下操作：

**基本操作（所有版本）**
- **screenshot：** 捕获当前显示内容
- **left_click：** 在坐标 `[x, y]` 处点击
- **type：** 输入文本字符串
- **key：** 按下按键或按键组合（例如 "ctrl+s"）
- **mouse_move：** 将光标移动到坐标位置

**增强操作（`computer_20250124`）**
适用于所有支持计算机使用的模型：
- **scroll：** 向任意方向滚动并控制滚动量
- **left_click_drag：** 在坐标之间点击并拖动
- **right_click**、**middle_click：** 其他鼠标按钮
- **double_click**、**triple_click：** 多次点击
- **left_mouse_down**、**left_mouse_up：** 细粒度的点击控制
- **hold_key：** 按住某个键指定的持续时间（以秒为单位）
- **wait：** 在操作之间暂停

**增强操作（`computer_20251124`）**
适用于 Claude Opus 4.8、Claude Opus 4.7、Claude Opus 4.6、Claude Sonnet 4.6 和 Claude Opus 4.5：
- `computer_20250124` 中的所有操作
- **zoom：** 以完整分辨率查看屏幕的特定区域。需要在工具定义中设置 `enable_zoom: true`。接受一个 `region` 参数，其坐标 `[x1, y1, x2, y2]` 定义了要检查区域的左上角和右下角。

<section title="操作示例">

截图：

```json
{
  "action": "screenshot"
}
```

在指定位置点击：

```json
{
  "action": "left_click",
  "coordinate": [500, 300]
}
```

输入文本：

```json
{
  "action": "type",
  "text": "Hello, world!"
}
```

向下滚动：

```json
{
  "action": "scroll",
  "coordinate": [500, 400],
  "scroll_direction": "down",
  "scroll_amount": 3
}
```

放大以查看区域详情（Claude Opus 4.8、Opus 4.7、Opus 4.6、Sonnet 4.6 和 Opus 4.5）：

```json
{
  "action": "zoom",
  "region": [100, 200, 400, 350]
}
```

</section>

<section title="点击和滚动操作中的修饰键">

要在执行点击或滚动操作时按住修饰键（如 Shift、Ctrl 或 Alt），请在这些操作上使用 `text` 参数。这与 `hold_key` 不同，后者是在不执行其他操作的情况下按住某个键一段时间。

Shift+点击（例如，选择一系列项目）：

```json
{
  "action": "left_click",
  "coordinate": [500, 300],
  "text": "shift"
}
```

Ctrl+点击（例如，在 Windows/Linux 上多选）：

```json
{
  "action": "left_click",
  "coordinate": [500, 300],
  "text": "ctrl"
}
```

Cmd+点击（例如，在 macOS 上多选）：

```json
{
  "action": "left_click",
  "coordinate": [500, 300],
  "text": "super"
}
```

Shift+滚动（例如，水平滚动）：

```json
{
  "action": "scroll",
  "coordinate": [500, 400],
  "scroll_direction": "down",
  "scroll_amount": 3,
  "text": "shift"
}
```

点击/滚动操作中的 `text` 参数接受修饰键，如 `shift`、`ctrl`、`alt` 和 `super`（用于 Command/Windows 键）。

</section>

### 工具参数 \{#tool-parameters}

| 参数 | 必需 | 描述 |
|-----------|----------|-------------|
| `type` | 是 | 工具版本（`computer_20251124` 或 `computer_20250124`） |
| `name` | 是 | 必须为 "computer" |
| `display_width_px` | 是 | 显示宽度（像素） |
| `display_height_px` | 是 | 显示高度（像素） |
| `display_number` | 否 | X11 环境的显示编号 |
| `enable_zoom` | 否 | 启用缩放操作（仅限 `computer_20251124`）。设置为 `true` 以允许 Claude 放大特定屏幕区域。默认值：`false` |

<Note>
**重要提示：** 您的应用程序必须显式运行计算机使用工具；Claude 无法直接运行它。您负责根据 Claude 的请求实现截图捕获、鼠标移动、键盘输入和其他操作。
</Note>

### 与扩展思考结合使用 \{#combining-with-extended-thinking}

有关将计算机使用与扩展思考结合使用的信息，请参阅[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)。

<Tip>
具体到计算机使用，内部基准测试建议采用以下 `effort` 设置：

- **Claude Opus 4.7：** 默认使用 `high`；对于高吞吐量或成本敏感的工作负载，使用 `low`。
- **Claude Sonnet 4.6 和 Claude Opus 4.6：** 默认使用 `medium`（最佳准确性与成本比）。避免使用 `max`，它会增加令牌成本，但不会提高 UI 任务的准确性。在这些模型上，`low` 使用的输出令牌比完全禁用思考*更少*（错误更少意味着重试更少），使其成为成本敏感循环的理想选择。
</Tip>

### 使用其他工具增强计算机使用 \{#augmenting-computer-use-with-other-tools}

要在计算机使用的同时添加其他工具，请将它们包含在同一个 `tools` 数组中。[快速开始](#快速开始)部分展示了这种模式，结合使用了 [bash 工具](/docs/zh-CN/agents-and-tools/tool-use/bash-tool)和[文本编辑器工具](/docs/zh-CN/agents-and-tools/tool-use/text-editor-tool)。您可以用同样的方式添加自己的[自定义工具定义](/docs/zh-CN/agents-and-tools/tool-use/define-tools)。

### 构建自定义计算机使用环境 \{#build-a-custom-computer-use-environment}

[参考实现](https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo)旨在帮助您开始使用计算机使用功能。它包含让 Claude 使用计算机所需的所有组件。但是，您可以根据自己的需求构建自己的计算机使用环境。您需要：

- 一个适用于 Claude 计算机使用的虚拟化或容器化环境
- 至少一个 Anthropic 架构计算机使用工具的实现
- 一个与 Claude API 交互并使用您的工具实现运行 `tool_use` 结果的智能体循环
- 一个允许用户输入以启动智能体循环的 API 或 UI

#### 实现计算机使用工具 \{#implement-the-computer-use-tool}

计算机使用工具是作为无架构（schema-less）工具实现的。使用此工具时，您不需要像其他工具那样提供输入架构；该架构已内置于 Claude 的模型中，无法修改。

<Steps>
  <Step title="设置您的计算环境">
    创建一个虚拟显示器或连接到 Claude 将与之交互的现有显示器。这通常涉及设置 Xvfb（X 虚拟帧缓冲区）或类似技术。
  </Step>
  <Step title="实现操作处理程序">
    创建函数来处理 Claude 可能请求的每种操作类型：
    <Tabs>
    <Tab title="cURL">
    <Info>
    这是应用程序端的辅助代码，不涉及 API 请求。请参阅 SDK 选项卡了解该模式。
    </Info>
    </Tab>

    <Tab title="CLI">
    <Info>
    这是应用程序端的辅助代码，不涉及 API 请求。请参阅 SDK 选项卡了解该模式。
    </Info>
    </Tab>

    <Tab title="Python">
    
````python
def capture_screenshot():
    return "<screenshot data>"


def click_at(x, y):
    return f"clicked at ({x}, {y})"


def type_text(text):
    return f"typed: {text}"


def handle_computer_action(action_type, params):
    if action_type == "screenshot":
        return capture_screenshot()
    elif action_type == "left_click":
        x, y = params["coordinate"]
        return click_at(x, y)
    elif action_type == "type":
        return type_text(params["text"])
    # 根据需要处理其他操作
    return f"unhandled action: {action_type}"
````

    </Tab>

    <Tab title="TypeScript">
    
````typescript
function captureScreenshot(): string {
  return "<screenshot data>";
}

function clickAt(x: number, y: number): string {
  return `clicked at (${x}, ${y})`;
}

function typeText(text: string): string {
  return `typed: ${text}`;
}

function handleComputerAction(
  actionType: string,
  params: Record<string, unknown>,
): string {
  if (actionType === "screenshot") {
    return captureScreenshot();
  } else if (actionType === "left_click") {
    const [x, y] = params.coordinate as [number, number];
    return clickAt(x, y);
  } else if (actionType === "type") {
    return typeText(params.text as string);
  }
  // 根据需要处理其他操作
  return `unhandled action: ${actionType}`;
}
````

    </Tab>

    <Tab title="C#">
    
````csharp
string CaptureScreenshot() => "<screenshot data>";

string ClickAt(int x, int y) => $"clicked at ({x}, {y})";

string TypeText(string text) => $"typed: {text}";

string HandleComputerAction(string actionType, IReadOnlyDictionary<string, JsonElement> input) =>
    actionType switch
    {
        "screenshot" => CaptureScreenshot(),
        "left_click" => ClickAt(
            input["coordinate"][0].GetInt32(),
            input["coordinate"][1].GetInt32()
        ),
        "type" => TypeText(input["text"].GetString()!),
        // 根据需要处理其他操作
        _ => $"unhandled action: {actionType}",
    };
````

    </Tab>

    <Tab title="Go">
    
````go
func captureScreenshot() string {
	return "<screenshot data>"
}

func clickAt(x, y int) string {
	return fmt.Sprintf("clicked at (%d, %d)", x, y)
}

func typeText(text string) string {
	return fmt.Sprintf("typed: %s", text)
}

func handleComputerAction(actionType string, params map[string]any) string {
	switch actionType {
	case "screenshot":
		return captureScreenshot()
	case "left_click":
		coord := params["coordinate"].([]any)
		return clickAt(int(coord[0].(float64)), int(coord[1].(float64)))
	case "type":
		return typeText(params["text"].(string))
	// 根据需要处理其他操作
	default:
		return fmt.Sprintf("unhandled action: %s", actionType)
	}
}

````

    </Tab>

    <Tab title="Java">
    
````java
String captureScreenshot() {
    return "<screenshot data>";
}

String clickAt(long x, long y) {
    return "clicked at (" + x + ", " + y + ")";
}

String typeText(String text) {
    return "typed: " + text;
}

String handleComputerAction(String actionType, Map<String, JsonValue> params) {
    return switch (actionType) {
        case "screenshot" -> captureScreenshot();
        case "left_click" -> {
            List<JsonValue> coordinate = (List<JsonValue>) params.get("coordinate").asArray().get();
            long x = ((Number) coordinate.get(0).asNumber().get()).longValue();
            long y = ((Number) coordinate.get(1).asNumber().get()).longValue();
            yield clickAt(x, y);
        }
        case "type" -> typeText(params.get("text").asStringOrThrow());
        // 根据需要处理其他操作
        default -> "unhandled action: " + actionType;
    };
}
````

    </Tab>

    <Tab title="PHP">
    
````php
function captureScreenshot(): string
{
    return '<screenshot data>';
}

function clickAt(int $x, int $y): string
{
    return "clicked at ({$x}, {$y})";
}

function typeText(string $text): string
{
    return "typed: {$text}";
}

function handleComputerAction(string $actionType, array $params): string
{
    return match ($actionType) {
        'screenshot' => captureScreenshot(),
        'left_click' => clickAt(...$params['coordinate']),
        'type' => typeText($params['text']),
        // 根据需要处理其他操作
        default => "unhandled action: {$actionType}",
    };
}
````

    </Tab>

    <Tab title="Ruby">
    
````ruby
def capture_screenshot
  "<screenshot data>"
end

def click_at(x, y)
  "clicked at (#{x}, #{y})"
end

def type_text(text)
  "typed: #{text}"
end

def handle_computer_action(action_type, params)
  case action_type
  when "screenshot"
    capture_screenshot
  when "left_click"
    x, y = params[:coordinate]
    click_at(x, y)
  when "type"
    type_text(params[:text])
  # 根据需要处理其他操作
  else
    "unhandled action: #{action_type}"
  end
end
````

    </Tab>
    </Tabs>
  </Step>
  <Step title="处理 Claude 的工具调用">
    从 Claude 的响应中提取并运行工具调用：
    <Tabs>
    <Tab title="cURL">
    <Info>
    这是应用程序端的辅助代码，不涉及 API 请求。请参阅 SDK 选项卡了解该模式。
    </Info>
    </Tab>

    <Tab title="CLI">
    <Info>
    这是应用程序端的辅助代码，不涉及 API 请求。请参阅 SDK 选项卡了解该模式。
    </Info>
    </Tab>

    <Tab title="Python">
    
````python
def process_tool_calls(response):
    tool_results = []
    for block in response.content:
        if block.type == "tool_use":
            action = block.input["action"]
            result = handle_computer_action(action, block.input)
            tool_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": result,
                }
            )
    return tool_results
````

    </Tab>

    <Tab title="TypeScript">
    
````typescript
function processToolCalls(
  response: Anthropic.Beta.BetaMessage,
): Anthropic.Beta.BetaToolResultBlockParam[] {
  const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
  for (const block of response.content) {
    if (block.type === "tool_use") {
      const input = block.input as Record<string, unknown>;
      const action = input.action as string;
      const result = handleComputerAction(action, input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
      });
    }
  }
  return toolResults;
}
````

    </Tab>

    <Tab title="C#">
    
````csharp
List<BetaContentBlockParam> ProcessToolCalls(BetaMessage response)
{
    List<BetaContentBlockParam> toolResults = [];
    foreach (var block in response.Content)
    {
        if (block.TryPickToolUse(out var toolUse))
        {
            var action = toolUse.Input["action"].GetString()!;
            var result = HandleComputerAction(action, toolUse.Input);
            toolResults.Add(new BetaToolResultBlockParam(toolUse.ID) { Content = result });
        }
    }
    return toolResults;
}
````

    </Tab>

    <Tab title="Go">
    
````go
func processToolCalls(response *anthropic.BetaMessage) []anthropic.BetaContentBlockParamUnion {
	var toolResults []anthropic.BetaContentBlockParamUnion
	for _, block := range response.Content {
		switch variant := block.AsAny().(type) {
		case anthropic.BetaToolUseBlock:
			input := variant.Input.(map[string]any)
			action := input["action"].(string)
			result := handleComputerAction(action, input)
			toolResults = append(toolResults, anthropic.NewBetaToolResultBlock(variant.ID, result, false))
		}
	}
	return toolResults
}

````

    </Tab>

    <Tab title="Java">
    
````java
List<BetaContentBlockParam> processToolCalls(BetaMessage response) {
    List<BetaContentBlockParam> toolResults = new ArrayList<>();
    for (BetaContentBlock block : response.content()) {
        if (block.isToolUse()) {
            BetaToolUseBlock toolUse = block.asToolUse();
            Map<String, JsonValue> input =
                    (Map<String, JsonValue>) toolUse._input().asObject().get();
            String action = input.get("action").asStringOrThrow();
            String result = handleComputerAction(action, input);
            toolResults.add(BetaContentBlockParam.ofToolResult(
                    BetaToolResultBlockParam.builder()
                            .toolUseId(toolUse.id())
                            .content(result)
                            .build()));
        }
    }
    return toolResults;
}
````

    </Tab>

    <Tab title="PHP">
    
````php
function processToolCalls(BetaMessage $response): array
{
    $toolResults = [];
    foreach ($response->content as $block) {
        if ($block instanceof BetaToolUseBlock) {
            $action = $block->input['action'];
            $result = handleComputerAction($action, $block->input);
            $toolResults[] = BetaToolResultBlockParam::with(
                toolUseID: $block->id,
                content: $result,
            );
        }
    }
    return $toolResults;
}
````

    </Tab>

    <Tab title="Ruby">
    
````ruby
def process_tool_calls(response)
  tool_results = []
  response.content.each do |block|
    next unless block.type == :tool_use

    action = block.input[:action]
    result = handle_computer_action(action, block.input)
    tool_results << {
      type: "tool_result",
      tool_use_id: block.id,
      content: result
    }
  end
  tool_results
end
````

    </Tab>
    </Tabs>
  </Step>
  <Step title="实现智能体循环">
    创建一个循环，持续运行直到 Claude 完成任务：
    <Tabs>
    <Tab title="cURL">
    <Info>
    智能体循环是一种有状态的多轮模式，无法转换为一次性的 shell 命令。请参阅 SDK 选项卡了解实现方式。
    </Info>
    </Tab>

    <Tab title="CLI">
    <Info>
    智能体循环是一种有状态的多轮模式，无法转换为一次性的 shell 命令。请参阅 SDK 选项卡了解实现方式。
    </Info>
    </Tab>

    <Tab title="Python">
    
````python
def sampling_loop(model, messages, max_iterations=10):
    """
    Run the computer-use agent loop until Claude stops requesting tools
    or the iteration limit is reached.
    """
    for _ in range(max_iterations):
        response = client.beta.messages.create(
            model=model,
            max_tokens=4096,
            messages=messages,
            tools=TOOLS,
            betas=["computer-use-2025-11-24"],
        )

        # 将 Claude 的响应添加到对话历史记录中
        messages.append({"role": "assistant", "content": response.content})

        # 运行 Claude 请求的所有工具并收集结果
        tool_results = process_tool_calls(response)
        if not tool_results:
            return messages  # No more tool use; task complete

        # 将工具结果发送回 Claude 以进行下一次迭代
        messages.append({"role": "user", "content": tool_results})

    return messages
````

    </Tab>

    <Tab title="TypeScript">
    
````typescript
async function samplingLoop(
  model: string,
  messages: Anthropic.Beta.BetaMessageParam[],
  maxIterations = 10,
): Promise<Anthropic.Beta.BetaMessageParam[]> {
  // 运行计算机使用代理循环，直到 Claude 停止请求工具
  // 或达到迭代次数上限。
  for (let i = 0; i < maxIterations; i++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4096,
      messages,
      tools,
      betas: ["computer-use-2025-11-24"],
    });

    // 将 Claude 的响应添加到对话历史记录中
    messages.push({ role: "assistant", content: response.content });

    // 运行 Claude 请求的所有工具并收集结果
    const toolResults = processToolCalls(response);
    if (toolResults.length === 0) {
      return messages; // No more tool use; task complete
    }

    // 将工具结果发送回 Claude 以进行下一次迭代
    messages.push({ role: "user", content: toolResults });
  }

  return messages;
}
````

    </Tab>

    <Tab title="C#">
    
````csharp
async Task<List<BetaMessageParam>> SamplingLoop(
    Model model,
    List<BetaMessageParam> messages,
    int maxIterations = 10
)
{
    // 运行计算机使用代理循环，直到 Claude 停止请求工具
    // 或达到迭代次数上限。
    for (var i = 0; i < maxIterations; i++)
    {
        var response = await client.Beta.Messages.Create(
            new MessageCreateParams
            {
                Model = model,
                MaxTokens = 4096,
                Messages = messages,
                Tools = tools,
                Betas = ["computer-use-2025-11-24"],
            }
        );

        // 将 Claude 的响应添加到对话历史记录中
        messages.Add(
            new()
            {
                Role = Role.Assistant,
                Content = response
                    .Content.Select(block => new BetaContentBlockParam(block.Json))
                    .ToList(),
            }
        );

        // 运行 Claude 请求的所有工具并收集结果
        var toolResults = ProcessToolCalls(response);
        if (toolResults.Count == 0)
        {
            return messages; // No more tool use; task complete
        }

        // 将工具结果发送回 Claude 以进行下一次迭代
        messages.Add(new() { Role = Role.User, Content = toolResults });
    }

    return messages;
}
````

    </Tab>

    <Tab title="Go">
    
````go
// samplingLoop 运行计算机使用代理循环，直到 Claude 停止
// 请求工具或达到迭代次数上限。
func samplingLoop(ctx context.Context, model anthropic.Model, messages []anthropic.BetaMessageParam, maxIterations int) ([]anthropic.BetaMessageParam, error) {
	for range maxIterations {
		response, err := client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
			Model:     model,
			MaxTokens: 4096,
			Messages:  messages,
			Tools:     tools,
			Betas:     []anthropic.AnthropicBeta{"computer-use-2025-11-24"},
		})
		if err != nil {
			return nil, err
		}

		// 将 Claude 的响应添加到对话历史记录中
		messages = append(messages, response.ToParam())

		// 运行 Claude 请求的所有工具并收集结果
		toolResults := processToolCalls(response)
		if len(toolResults) == 0 {
			return messages, nil // No more tool use; task complete
		}

		// 将工具结果发送回 Claude 以进行下一次迭代
		messages = append(messages, anthropic.BetaMessageParam{
			Role:    anthropic.BetaMessageParamRoleUser,
			Content: toolResults,
		})
	}
	return messages, nil
}

````

    </Tab>

    <Tab title="Java">
    
````java
/**
 * Run the computer-use agent loop until Claude stops requesting tools
 * or the iteration limit is reached.
 */
List<BetaMessageParam> samplingLoop(Model model, List<BetaMessageParam> messages, int maxIterations) {
    for (int i = 0; i < maxIterations; i++) {
        BetaMessage response = client.beta().messages().create(MessageCreateParams.builder()
                .model(model)
                .maxTokens(4096)
                .messages(messages)
                .addTool(COMPUTER_TOOL)
                .addBeta("computer-use-2025-11-24")
                .build());

        // 将 Claude 的响应添加到对话历史记录中
        messages.add(BetaMessageParam.builder()
                .role(BetaMessageParam.Role.ASSISTANT)
                .contentOfBetaContentBlockParams(
                        response.content().stream().map(BetaContentBlock::toParam).toList())
                .build());

        // 运行 Claude 请求的所有工具并收集结果
        List<BetaContentBlockParam> toolResults = processToolCalls(response);
        if (toolResults.isEmpty()) {
            return messages; // No more tool use; task complete
        }

        // 将工具结果发送回 Claude 以进行下一次迭代
        messages.add(BetaMessageParam.builder()
                .role(BetaMessageParam.Role.USER)
                .contentOfBetaContentBlockParams(toolResults)
                .build());
    }
    return messages;
}
````

    </Tab>

    <Tab title="PHP">
    
````php
/**
 * Run the computer-use agent loop until Claude stops requesting tools
 * or the iteration limit is reached.
 */
function samplingLoop(string $model, array $messages, int $maxIterations = 10): array
{
    global $client, $tools;

    for ($i = 0; $i < $maxIterations; $i++) {
        $response = $client->beta->messages->create(
            model: $model,
            maxTokens: 4096,
            messages: $messages,
            tools: $tools,
            betas: ['computer-use-2025-11-24'],
        );

        // 将 Claude 的响应添加到对话历史记录中
        $messages[] = BetaMessageParam::with(role: Role::ASSISTANT, content: $response->content);

        // 运行 Claude 请求的所有工具并收集结果
        $toolResults = processToolCalls($response);
        if ($toolResults === []) {
            return $messages; // No more tool use; task complete
        }

        // 将工具结果发送回 Claude 以进行下一次迭代
        $messages[] = BetaMessageParam::with(role: Role::USER, content: $toolResults);
    }

    return $messages;
}
````

    </Tab>

    <Tab title="Ruby">
    
````ruby
# 运行计算机使用代理循环，直到 Claude 停止请求工具
# 或达到迭代次数上限。
def sampling_loop(model, messages, max_iterations: 10)
  max_iterations.times do
    response = CLIENT.beta.messages.create(
      model: model,
      max_tokens: 4096,
      messages: messages,
      tools: TOOLS,
      betas: ["computer-use-2025-11-24"]
    )

    # 将 Claude 的响应添加到对话历史记录中
    messages << {role: "assistant", content: response.content}

    # 运行 Claude 请求的所有工具并收集结果
    tool_results = process_tool_calls(response)
    return messages if tool_results.empty? # No more tool use; task complete

    # 将工具结果发送回 Claude 以进行下一次迭代
    messages << {role: "user", content: tool_results}
  end

  messages
end
````

    </Tab>
    </Tabs>
  </Step>
</Steps>

#### 处理错误 \{#handle-errors}

在实现计算机使用工具时，可能会发生各种错误。以下是处理方法：

<section title="截图捕获失败">

如果截图捕获失败，返回适当的错误消息：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "Error: Failed to capture screenshot. Display may be locked or unavailable.",
      "is_error": true
    }
  ]
}
```

</section>

<section title="无效坐标">

如果 Claude 提供的坐标超出显示范围：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "Error: Coordinates (1200, 900) are outside display bounds (1024x768).",
      "is_error": true
    }
  ]
}
```

</section>

<section title="操作执行失败">

如果操作运行失败：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "Error: Failed to perform click action. The application may be unresponsive.",
      "is_error": true
    }
  ]
}
```

</section>

#### 处理更高分辨率的坐标缩放 \{#handle-coordinate-scaling-for-higher-resolutions}

<Note>
Claude Opus 4.8 和 Claude Opus 4.7 支持长边最多 2576 像素，其坐标与图像像素为 1\:1 对应（无需缩放因子转换）。以下 1568 像素的指导适用于较早的模型。
</Note>

API 将图像限制为最长边最多 1568 像素，总计约 115 万像素（有关详细信息，请参阅[图像调整大小](/docs/zh-CN/build-with-claude/vision#evaluate-image-size)）。例如，1512x982 的屏幕会被下采样到约 1330x864。Claude 分析这个较小的图像并返回该空间中的坐标，但您的工具在原始屏幕空间中执行点击。

除非您处理坐标转换，否则这可能导致 Claude 的点击坐标偏离目标。

要解决此问题，请自行调整截图大小并将 Claude 的坐标按比例放大：

<Tabs>
<Tab title="cURL">
<Info>
坐标缩放和截图调整大小发生在您的应用程序代码中，而不是在 API 请求中。请参阅 SDK 选项卡了解辅助模式。
</Info>
</Tab>

<Tab title="CLI">
<Info>
坐标缩放和截图调整大小发生在您的应用程序代码中，而不是在 API 请求中。请参阅 SDK 选项卡了解辅助模式。
</Info>
</Tab>

<Tab title="Python">
```python hidelines={1..7,-2..}
screen_width, screen_height = 1512, 982


def capture_and_resize(w, h): ...
def perform_click(x, y): ...


import math


def get_scale_factor(width, height):
    """Calculate scale factor to meet API constraints."""
    long_edge = max(width, height)
    total_pixels = width * height

    long_edge_scale = 1568 / long_edge
    total_pixels_scale = math.sqrt(1_150_000 / total_pixels)

    return min(1.0, long_edge_scale, total_pixels_scale)


# 捕获截图时
scale = get_scale_factor(screen_width, screen_height)
scaled_width = int(screen_width * scale)
scaled_height = int(screen_height * scale)

# 在发送给 Claude 之前，将图像调整为缩放后的尺寸
screenshot = capture_and_resize(scaled_width, scaled_height)


# 处理 Claude 返回的坐标时，将其放大还原
def execute_click(x, y):
    screen_x = x / scale
    screen_y = y / scale
    perform_click(screen_x, screen_y)


print(f"scale={scale:.6f} scaled={scaled_width}x{scaled_height}")
```
</Tab>

<Tab title="TypeScript">
```typescript hidelines={1..6,-2..}
const screenWidth = 1512;
const screenHeight = 982;
function captureAndResize(w: number, h: number): string {
  return "";
}
function performClick(x: number, y: number): void {}
const MAX_LONG_EDGE = 1568;
const MAX_PIXELS = 1_150_000;

function getScaleFactor(width: number, height: number): number {
  const longEdge = Math.max(width, height);
  const totalPixels = width * height;

  const longEdgeScale = MAX_LONG_EDGE / longEdge;
  const totalPixelsScale = Math.sqrt(MAX_PIXELS / totalPixels);

  return Math.min(1.0, longEdgeScale, totalPixelsScale);
}

// 捕获屏幕截图时
const scale = getScaleFactor(screenWidth, screenHeight);
const scaledWidth = Math.floor(screenWidth * scale);
const scaledHeight = Math.floor(screenHeight * scale);

// 在发送给 Claude 之前，将图像调整为缩放后的尺寸
const screenshot = captureAndResize(scaledWidth, scaledHeight);

// 处理 Claude 返回的坐标时，将其放大还原
function executeClick(x: number, y: number): void {
  const screenX = x / scale;
  const screenY = y / scale;
  performClick(screenX, screenY);
}

console.log(`scale=${scale.toFixed(6)} scaled=${scaledWidth}x${scaledHeight}`);
```
</Tab>

<Tab title="C#">
```csharp hidelines={1..5,-2..}
int screenWidth = 1512, screenHeight = 982;

object? CaptureAndResize(int w, int h) => null;
void PerformClick(double x, double y) { }

double GetScaleFactor(int width, int height)
{
    // 计算缩放因子以满足 API 约束。
    int longEdge = Math.Max(width, height);
    int totalPixels = width * height;

    double longEdgeScale = 1568.0 / longEdge;
    double totalPixelsScale = Math.Sqrt(1_150_000.0 / totalPixels);

    return Math.Min(1.0, Math.Min(longEdgeScale, totalPixelsScale));
}

// 捕获屏幕截图时
double scale = GetScaleFactor(screenWidth, screenHeight);
int scaledWidth = (int)(screenWidth * scale);
int scaledHeight = (int)(screenHeight * scale);

// 在发送给 Claude 之前将图像调整为缩放后的尺寸
var screenshot = CaptureAndResize(scaledWidth, scaledHeight);

// 处理 Claude 返回的坐标时，将其放大还原
void ExecuteClick(int x, int y)
{
    double screenX = x / scale;
    double screenY = y / scale;
    PerformClick(screenX, screenY);
}

Console.WriteLine($"scale={scale:F6} scaled={scaledWidth}x{scaledHeight}");
```
</Tab>

<Tab title="Go">
```go hidelines={1..10,17..19,-4..}
package main

import (
	"fmt"
	"math"
)

func captureAndResize(w, h int) any { return nil }
func performClick(x, y float64)     {}

func getScaleFactor(width, height int) float64 {
	longest := float64(max(width, height))
	area := float64(width * height)
	return min(1.0, 1568/longest, math.Sqrt(1_150_000/area))
}

func main() {
	screenWidth, screenHeight := 1512, 982

	// 捕获屏幕截图时
	scale := getScaleFactor(screenWidth, screenHeight)
	scaledWidth := int(float64(screenWidth) * scale)
	scaledHeight := int(float64(screenHeight) * scale)

	// 在发送给 Claude 之前，将图像调整为缩放后的尺寸
	screenshot := captureAndResize(scaledWidth, scaledHeight)

	// 处理 Claude 返回的坐标时，将其放大还原
	executeClick := func(x, y int) {
		performClick(float64(x)/scale, float64(y)/scale)
	}

	_, _ = screenshot, executeClick
	fmt.Printf("scale=%.6f scaled=%dx%d\n", scale, scaledWidth, scaledHeight)
}
```
</Tab>

<Tab title="Java">
```java hidelines={1..5,17..18,30..31}
import java.util.function.BiConsumer;

static Object captureAndResize(int w, int h) { return null; }
static void performClick(double x, double y) {}

static double getScaleFactor(int width, int height) {
    return Math.min(
        1.0,
        Math.min(
            1568.0 / Math.max(width, height),
            Math.sqrt(1_150_000.0 / (width * height))
        )
    );
}

void main() {
    int screenWidth = 1512, screenHeight = 982;

    // 截取屏幕截图时
    double scale = getScaleFactor(screenWidth, screenHeight);
    int scaledWidth = (int)(screenWidth * scale);
    int scaledHeight = (int)(screenHeight * scale);

    // 在发送给 Claude 之前，将图像调整为缩放后的尺寸
    var screenshot = captureAndResize(scaledWidth, scaledHeight);

    // 处理 Claude 返回的坐标时，将其放大还原
    BiConsumer<Integer, Integer> executeClick =
        (x, y) -> performClick(x / scale, y / scale);

    IO.println("scale=%.6f scaled=%dx%d".formatted(scale, scaledWidth, scaledHeight));
}
```
</Tab>

<Tab title="PHP">
```php hidelines={1..5,14..17,-2..}
<?php

function captureAndResize(int $w, int $h): mixed { return null; }
function performClick(float $x, float $y): void {}

function getScaleFactor(int $width, int $height): float
{
    return min(
        1.0,
        1568 / max($width, $height),
        sqrt(1_150_000 / ($width * $height)),
    );
}

$screenWidth = 1512;
$screenHeight = 982;

// 捕获屏幕截图时
$scale = getScaleFactor($screenWidth, $screenHeight);
$scaledWidth = (int)($screenWidth * $scale);
$scaledHeight = (int)($screenHeight * $scale);

// 在发送给 Claude 之前，将图像调整为缩放后的尺寸
$screenshot = captureAndResize($scaledWidth, $scaledHeight);

// 处理 Claude 返回的坐标时，将其放大还原
$executeClick = fn(int $x, int $y) => performClick($x / $scale, $y / $scale);

printf("scale=%.6f scaled=%dx%d\n", $scale, $scaledWidth, $scaledHeight);
```
</Tab>

<Tab title="Ruby">
```ruby hidelines={1..3,7..9,-2..}
def capture_and_resize(w, h) = nil
def perform_click(x, y) = nil

def get_scale_factor(width, height)
  [1.0, 1568.0 / [width, height].max, Math.sqrt(1_150_000.0 / (width * height))].min
end

screen_width, screen_height = 1512, 982

# 捕获屏幕截图时
scale = get_scale_factor(screen_width, screen_height)
scaled_width = (screen_width * scale).to_i
scaled_height = (screen_height * scale).to_i

# 在发送给 Claude 之前，将图像调整为缩放后的尺寸
screenshot = capture_and_resize(scaled_width, scaled_height)

# 处理 Claude 返回的坐标时，将其放大还原
execute_click = ->(x, y) { perform_click(x / scale, y / scale) }

puts format("scale=%.6f scaled=%dx%d", scale, scaled_width, scaled_height)
```
</Tab>
</Tabs>

<Note>
**macOS Retina 显示器**以 2 的设备像素比捕获截图，因此图像分辨率是逻辑屏幕坐标的两倍。请在发送前将截图缩小 2 倍，或在发出点击之前将 Claude 返回的坐标减半。
</Note>

#### 诊断点击问题 \{#diagnose-click-issues}

如果点击未命中目标，原因通常是以下之一：

| 症状 | 可能原因 | 尝试方法 |
|---------|--------------|-----|
| 点击始终向一个方向偏移 | `display_width_px`/`display_height_px` 与实际发送的图像尺寸不匹配，或图像超出 API 限制并被静默缩小 | 确保显示尺寸与调整大小后的截图完全匹配；预先缩小以适应 API 限制 |
| 点击落在正确区域但未命中目标 | 目标非常小，从 4K+ 源缩小时丢失了细节，或宽高比被扭曲 | 设置 `enable_zoom: true`；以较低 DPI 捕获或裁剪到相关区域；调整大小时保持宽高比 |
| Claude 完全点击了错误的元素 | 指令不明确，或附近有视觉上相似的元素 | 使用位置提示（"右下角的蓝色提交按钮"）；将交互分解为更小的步骤 |
| 准确性始终较差 | 发送的截图超出 API 限制，或分辨率太低 | 预先缩小以适应限制；尝试以 1280x720 作为基准 |

<Tip>
**模型选择会影响点击精度。** Claude Sonnet 4.6 在点击方面比 Claude Opus 4.6 机械精度更高，并且在截图需要大幅缩小时更加稳健。Claude Opus 4.7 缩小了这一差距：其点击精度与 Sonnet 4.6 大致相当，并且其更高的分辨率限制意味着需要更少的缩小处理。
</Tip>

#### 遵循实现最佳实践 \{#follow-implementation-best-practices}

<section title="使用适当的显示分辨率">

设置与您的用例匹配的显示尺寸，同时保持在推荐限制内：
- 对于一般桌面任务：1024x768 或 1280x720
- 对于 Web 应用程序：1280x800 或 1366x768
- 避免使用高于 1920x1080 的分辨率，以防止性能问题

</section>

<section title="实现正确的截图处理">

向 Claude 返回截图时：
- 将截图编码为 base64 PNG 或 JPEG
- 考虑压缩大型截图以提高性能
- 包含相关元数据，如时间戳或显示状态
- 如果使用更高分辨率，请确保坐标被准确缩放

</section>

<section title="管理截图历史以实现提示缓存">

长时间运行的智能体循环会快速累积截图（每张大约 1,000–1,800 个输入令牌）。为了在限制上下文的同时保持[提示缓存](/docs/zh-CN/build-with-claude/prompt-caching)的有效性：
- 在系统提示和工具定义之后放置一个 `cache_control` 断点，并在最近的 `tool_result` 块上最多再放置三个，每轮向前推进。
- *批量*清理旧截图，而不是每轮清理一张。每轮删除一张截图会每轮更改前缀并使缓存失效。合理的默认设置是保留最后三张截图并每 25 轮清理一次，这样前缀在清理事件之间保持字节完全相同。

</section>

<section title="添加操作延迟">

某些应用程序需要时间来响应操作：
<Tabs>
<Tab title="cURL">
<Info>
这是应用程序端的辅助代码，不涉及 API 请求。请参阅 SDK 选项卡了解该模式。
</Info>
</Tab>

<Tab title="CLI">
<Info>
这是应用程序端的辅助代码，不涉及 API 请求。请参阅 SDK 选项卡了解该模式。
</Info>
</Tab>

<Tab title="Python">
```python hidelines={1..4,-3..}
import time


def click_at(x, y): ...
def click_and_wait(x, y, wait_time=0.5):
    click_at(x, y)
    time.sleep(wait_time)  # Allow UI to update


print("ok")
```
</Tab>

<Tab title="TypeScript">
```typescript hidelines={1..4,-3..}
import { setTimeout } from "node:timers/promises";

function clickAt(x: number, y: number): void {}

async function clickAndWait(x: number, y: number, waitMs = 500): Promise<void> {
  clickAt(x, y);
  await setTimeout(waitMs); // Allow UI to update
}

await clickAndWait(100, 200);
console.log("ok");
```
</Tab>

<Tab title="C#">
```csharp hidelines={1..5}
ClickAndWait(100, 200);
Console.WriteLine("ok");

static void ClickAt(int x, int y) { }

static void ClickAndWait(int x, int y, double waitSeconds = 0.5)
{
    ClickAt(x, y);
    Thread.Sleep(TimeSpan.FromSeconds(waitSeconds));  // Allow UI to update
}
```
</Tab>

<Tab title="Go">
```go hidelines={1..9,-4..}
package main

import (
	"fmt"
	"time"
)

func clickAt(x, y int) {}

func clickAndWaitFor(x, y int, wait time.Duration) {
	clickAt(x, y)
	time.Sleep(wait) // Allow UI to update
}

func clickAndWait(x, y int) {
	clickAndWaitFor(x, y, 500*time.Millisecond)
}

func main() {
	fmt.Println("ok")
}
```
</Tab>

<Tab title="Java">
```java hidelines={1..2,-4..}
void clickAt(int x, int y) {}

void clickAndWait(int x, int y) throws InterruptedException {
    clickAndWait(x, y, 500);
}

void clickAndWait(int x, int y, long waitTimeMillis) throws InterruptedException {
    clickAt(x, y);
    Thread.sleep(waitTimeMillis);  // Allow UI to update
}

void main() {
    IO.println("ok");
}
```
</Tab>

<Tab title="PHP">
```php hidelines={1..4,-2..}
<?php

function clickAt(int $x, int $y): void {}

function clickAndWait(int $x, int $y, float $waitSeconds = 0.5): void
{
    clickAt($x, $y);
    usleep((int) ($waitSeconds * 1_000_000));  // Allow UI to update
}

echo "ok\n";
```
</Tab>

<Tab title="Ruby">
```ruby hidelines={1..2,-2..}
def click_at(x, y) = nil

def click_and_wait(x, y, wait_time: 0.5)
  click_at(x, y)
  sleep(wait_time) # Allow UI to update
end

puts "ok"
```
</Tab>
</Tabs>

</section>

<section title="在运行操作之前验证操作">

检查请求的操作是否安全有效：
<Tabs>
<Tab title="cURL">
<Info>
这是应用程序端的辅助代码，不涉及 API 请求。请参阅 SDK 选项卡了解该模式。
</Info>
</Tab>

<Tab title="CLI">
<Info>
这是应用程序端的辅助代码，不涉及 API 请求。请参阅 SDK 选项卡了解该模式。
</Info>
</Tab>

<Tab title="Python">
```python hidelines={1,-3..}
display_width, display_height = 1024, 768


def validate_action(action_type, params):
    if action_type == "left_click":
        x, y = params.get("coordinate", (0, 0))
        if not (0 <= x < display_width and 0 <= y < display_height):
            return False, "Coordinates out of bounds"
    return True, None


print(validate_action("left_click", {"coordinate": (2000, 100)}))
```
</Tab>

<Tab title="TypeScript">
```typescript hidelines={1..3,-2..}
const displayWidth = 1024;
const displayHeight = 768;

interface ActionParams {
  coordinate?: [number, number];
}

function validateAction(actionType: string, params: ActionParams): [boolean, string | null] {
  if (actionType === "left_click") {
    const [x, y] = params.coordinate ?? [0, 0];
    if (!(x >= 0 && x < displayWidth && y >= 0 && y < displayHeight)) {
      return [false, "Coordinates out of bounds"];
    }
  }
  return [true, null];
}

console.log(validateAction("left_click", { coordinate: [2000, 100] }));
```
</Tab>

<Tab title="C#">
```csharp hidelines={1..2,5..7}
using System.Text.Json;

const int DisplayWidth = 1024;
const int DisplayHeight = 768;

Console.WriteLine(ValidateAction("left_click", new Dictionary<string, JsonElement> { ["coordinate"] = JsonSerializer.SerializeToElement(new[] { 2000, 100 }) }));

static (bool IsValid, string? Error) ValidateAction(string actionType, IReadOnlyDictionary<string, JsonElement> parameters)
{
    if (actionType == "left_click")
    {
        int x = parameters["coordinate"][0].GetInt32();
        int y = parameters["coordinate"][1].GetInt32();
        if (x is < 0 or >= DisplayWidth || y is < 0 or >= DisplayHeight)
        {
            return (false, "Coordinates out of bounds");
        }
    }
    return (true, null);
}
```
</Tab>

<Tab title="Go">
```go hidelines={1..4,-5..}
package main

import "fmt"

const (
	displayWidth  = 1024
	displayHeight = 768
)

func validateAction(actionType string, params map[string]any) (bool, string) {
	if actionType == "left_click" {
		coord, ok := params["coordinate"].([]any)
		if !ok || len(coord) != 2 {
			return false, "Invalid coordinate"
		}
		x, y := int(coord[0].(float64)), int(coord[1].(float64))
		if !(0 <= x && x < displayWidth && 0 <= y && y < displayHeight) {
			return false, "Coordinates out of bounds"
		}
	}
	return true, ""
}

func main() {
	ok, msg := validateAction("left_click", map[string]any{"coordinate": []any{2000.0, 100.0}})
	fmt.Println(ok, msg)
}
```
</Tab>

<Tab title="Java">
```java hidelines={1..2,-4..}
import com.anthropic.core.JsonValue;

static final int DISPLAY_WIDTH = 1024;
static final int DISPLAY_HEIGHT = 768;

record Validation(boolean valid, String error) {}

Validation validateAction(String actionType, Map<String, JsonValue> params) {
    if (actionType.equals("left_click")) {
        List<JsonValue> coord = (List<JsonValue>) params.get("coordinate").asArray().get();
        long x = ((Number) coord.get(0).asNumber().get()).longValue();
        long y = ((Number) coord.get(1).asNumber().get()).longValue();
        if (!(0 <= x && x < DISPLAY_WIDTH && 0 <= y && y < DISPLAY_HEIGHT)) {
            return new Validation(false, "Coordinates out of bounds");
        }
    }
    return new Validation(true, null);
}

void main() {
    IO.println(validateAction("left_click", Map.of("coordinate", JsonValue.from(List.of(2000, 100)))));
}
```
</Tab>

<Tab title="PHP">
```php hidelines={1..2,-3..}
<?php

const DISPLAY_WIDTH = 1024;
const DISPLAY_HEIGHT = 768;

/** @return array{bool, ?string} */
function validateAction(string $actionType, array $params): array
{
    if ($actionType === 'left_click') {
        [$x, $y] = $params['coordinate'] ?? [0, 0];
        if (!(0 <= $x && $x < DISPLAY_WIDTH && 0 <= $y && $y < DISPLAY_HEIGHT)) {
            return [false, 'Coordinates out of bounds'];
        }
    }
    return [true, null];
}

[$valid, $error] = validateAction('left_click', ['coordinate' => [2000, 100]]);
echo ($valid ? 'true' : 'false') . ' ' . $error . "\n";
```
</Tab>

<Tab title="Ruby">
```ruby hidelines={-2..}
DISPLAY_WIDTH = 1024
DISPLAY_HEIGHT = 768

def validate_action(action_type, params)
  if action_type == "left_click"
    x, y = params.fetch(:coordinate, [0, 0])
    unless (0...DISPLAY_WIDTH).cover?(x) && (0...DISPLAY_HEIGHT).cover?(y)
      return [false, "Coordinates out of bounds"]
    end
  end
  [true, nil]
end

p validate_action("left_click", {coordinate: [2000, 100]})
```
</Tab>
</Tabs>

</section>

<section title="记录操作以便调试">

保留所有操作的日志以便故障排除：
<Tabs>
<Tab title="cURL">
<Info>
这是应用程序端的辅助代码，不涉及 API 请求。请参阅 SDK 选项卡了解该模式。
</Info>
</Tab>

<Tab title="CLI">
<Info>
这是应用程序端的辅助代码，不涉及 API 请求。请参阅 SDK 选项卡了解该模式。
</Info>
</Tab>

<Tab title="Python">
```python hidelines={-3..}
import logging


def log_action(action_type, params, result):
    logging.info(f"Action: {action_type}, Params: {params}, Result: {result}")


print("ok")
```
</Tab>

<Tab title="TypeScript">
```typescript hidelines={-2..}
function logAction(actionType: string, params: unknown, result: unknown): void {
  console.error(
    `Action: ${actionType}, Params: ${JSON.stringify(params)}, Result: ${JSON.stringify(
      result
    )}`
  );
}

console.log("ok");
```
</Tab>

<Tab title="C#">
```csharp hidelines={1..3}
LogAction("screenshot", null, "<image data>");
Console.WriteLine("ok");

static void LogAction(string actionType, object? parameters, object? result)
{
    Console.Error.WriteLine($"Action: {actionType}, Params: {parameters}, Result: {result}");
}
```
</Tab>

<Tab title="Go">
```go hidelines={1..7,-4..}
package main

import (
	"fmt"
	"log"
)

func logAction(actionType string, params map[string]any, result any) {
	log.Printf("Action: %s, Params: %v, Result: %v", actionType, params, result)
}

func main() {
	fmt.Println("ok")
}
```
</Tab>

<Tab title="Java">
```java hidelines={-4..}
import static java.lang.System.Logger.Level.INFO;

static final System.Logger LOGGER = System.getLogger("computer-use");

void logAction(String actionType, Object params, Object result) {
    LOGGER.log(INFO, "Action: {0}, Params: {1}, Result: {2}", actionType, params, result);
}

void main() {
    IO.println("ok");
}
```
</Tab>

<Tab title="PHP">
```php hidelines={1..2,-2..}
<?php

function logAction(string $actionType, array $params, mixed $result): void
{
    error_log(sprintf(
        'Action: %s, Params: %s, Result: %s',
        $actionType,
        json_encode($params),
        json_encode($result),
    ));
}

echo "ok\n";
```
</Tab>

<Tab title="Ruby">
```ruby hidelines={-2..}
require "logger"

LOGGER = Logger.new($stderr)

def log_action(action_type, params, result)
  LOGGER.info("Action: #{action_type}, Params: #{params}, Result: #{result}")
end

puts "ok"
```
</Tab>
</Tabs>

</section>

---

## 了解计算机使用的局限性 \{#understand-computer-use-limitations}

计算机使用功能目前处于测试阶段。虽然 Claude 的能力处于业界领先水平，但开发者应了解其局限性：

1. **延迟：** 当前人机交互中的计算机使用 "latency"（延迟）可能比常规的人工操作计算机慢得多。请在可信环境中专注于对速度要求不高的用例（例如后台信息收集、自动化软件测试）。
2. **计算机视觉的准确性和可靠性：** Claude 在生成操作时输出具体坐标可能会出错或产生幻觉。扩展思考可以帮助您理解模型的推理过程并识别潜在问题。
3. **工具选择的准确性和可靠性：** Claude 在生成操作时选择工具可能会出错或产生幻觉，或者采取意外的操作来解决问题。此外，在与小众应用程序或同时与多个应用程序交互时，可靠性可能会降低。在请求执行复杂任务时，请仔细编写提示。
4. **滚动可靠性：** 滚动操作支持方向控制（上、下、左、右）和指定的滚动量。在滚动不生效的应用程序中，使用键盘替代方案（如 Page Down 键）可能会有所帮助。
5. **电子表格交互：** 使用精细的鼠标控制操作（`left_mouse_down`、`left_mouse_up`）和修饰键组合来选择单个单元格。复杂的电子表格操作可能仍需要多次尝试。
6. **在社交和通讯平台上创建账户和生成内容：** 虽然 Claude 会访问网站，但 Claude 在社交媒体网站和平台上创建账户、生成和分享内容或以其他方式进行人类冒充的能力是受限的。此功能未来可能会更新。
7. **漏洞：** 越狱或提示注入等漏洞可能在前沿 AI 系统中持续存在，包括测试版的计算机使用 API。在某些情况下，Claude 会遵循内容中发现的指令，有时甚至与用户的指令相冲突。例如，网页上或图像中包含的 Claude 指令可能会覆盖原有指令或导致 Claude 出错。请考虑以下措施：
   a. 将计算机使用限制在可信环境中，例如具有最低权限的虚拟机或容器
   b. 在没有严格监督的情况下，避免让计算机使用功能访问敏感账户或数据
   c. 在您的应用程序中启用或请求计算机使用功能所需的权限之前，告知最终用户相关风险并获得其同意
8. **不当或非法行为：** 根据 Anthropic 的服务条款，您不得使用计算机使用功能违反任何法律或可接受使用政策。

请始终仔细审查和验证 Claude 的计算机使用操作和日志。在没有人工监督的情况下，请勿将 Claude 用于需要完美精度或涉及敏感用户信息的任务。

## 数据保留 \{#data-retention}

计算机使用是一个客户端工具。会话中涉及的所有屏幕截图、鼠标操作、键盘输入和任何文件均在您的环境中捕获和存储，而非由 Anthropic 存储。Anthropic 在 API 调用过程中实时处理屏幕截图图像和操作请求，但在返回响应后不会保留这些数据。

由于您的应用程序控制计算机使用数据的存储位置和方式，因此计算机使用符合 ZDR（零数据保留）资格。有关所有功能的 ZDR 资格，请参阅 [API 和数据保留](/docs/zh-CN/manage-claude/api-and-data-retention)。

## 定价 \{#pricing}

计算机使用遵循标准的[工具使用定价](/docs/zh-CN/agents-and-tools/tool-use/overview#pricing)。使用计算机使用工具时：

**系统提示开销**：计算机使用测试版会向系统提示添加 466-499 个令牌

**计算机使用工具的令牌用量**：
| 模型 | 每个工具定义的输入令牌数 |
| ----- | -------------------------------- |
| Claude 4.x 模型 | 735 个令牌 |

**额外的令牌消耗**：
- 屏幕截图图像（请参阅[视觉定价](/docs/zh-CN/build-with-claude/vision)）
- 返回给 Claude 的工具执行结果

<Note>
如果您在使用计算机使用工具的同时还使用 bash 或文本编辑器工具，这些工具有各自的令牌成本，详见其各自的文档页面。
</Note>

## 后续步骤 \{#next-steps}

<CardGroup cols={2}>
  <Card
    title="参考实现"
    icon="github-logo"
    href="https://github.com/anthropics/anthropic-quickstarts/tree/main/computer-use-demo"
  >
    开始使用完整的基于 Docker 的实现
  </Card>
  <Card
    title="工具文档"
    icon="tool"
    href="/docs/zh-CN/agents-and-tools/tool-use/overview"
  >
    了解有关工具使用和创建自定义工具的更多信息
  </Card>
  <Card
    title="详细最佳实践"
    icon="book-open"
    href="https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude"
  >
    关于分辨率、思考力度和上下文管理的基准测试建议
  </Card>
</CardGroup>