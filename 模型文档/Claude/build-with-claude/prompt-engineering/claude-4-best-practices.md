# 提示最佳实践

针对 Claude 最新模型的提示工程技术综合指南，涵盖清晰度、示例、XML 结构化、思考以及智能体系统。

---

本文是使用 Claude 最新模型进行提示工程的参考文档，涵盖 Claude Fable 5、Claude Mythos 5、Claude Opus 4.8、Claude Opus 4.7、Claude Opus 4.6、Claude Sonnet 4.6 和 Claude Haiku 4.5。本页面分为三个部分：

- 首先是**模型特定指南**：介绍 [Claude Fable 5](/docs/zh-CN/build-with-claude/prompt-engineering/prompting-claude-fable-5) 和 [Claude Opus 4.8](/docs/zh-CN/build-with-claude/prompt-engineering/prompting-claude-opus-4-8) 在行为上的差异以及需要做出的调整。
- 其次是**适用于所有当前模型的技术**：通用原则、输出与格式化、工具使用、思考以及智能体系统。
- 最后是**迁移注意事项**，适用于从早期版本迁移过来的提示。

<Tip>
  有关模型能力的概述，请参阅[模型概述](/docs/zh-CN/about-claude/models/overview)。有关 Claude Fable 5 的能力和 API 变更，请参阅 [Claude Fable 5 和 Claude Mythos 5 介绍](/docs/zh-CN/about-claude/models/introducing-claude-fable-5-and-claude-mythos-5)。有关 Claude Opus 4.8 新功能的详细信息，请参阅 [Claude Opus 4.8 新功能](/docs/zh-CN/about-claude/models/whats-new-claude-4-8)。有关迁移指南，请参阅[迁移指南](/docs/zh-CN/about-claude/models/migration-guide)。
</Tip>

## Claude Fable 5 \{#claude-fable-5}

Claude Fable 5 和 Claude Mythos 5 的提示指南有专门的页面：[Claude Fable 5 提示指南](/docs/zh-CN/build-with-claude/prompt-engineering/prompting-claude-fable-5)。该页面涵盖了与 Claude Opus 4.8 的行为差异，以及值得进行的提示和脚手架调整，包括努力级别、指令遵循、长期运行进度声明、记忆系统以及 `reasoning_extraction` 拒绝类别。

## Claude Opus 4.8 提示指南 \{#prompting-claude-opus-4-8}

Claude Opus 4.8 的提示指南有专门的页面：[Claude Opus 4.8 提示指南](/docs/zh-CN/build-with-claude/prompt-engineering/prompting-claude-opus-4-8)。该页面涵盖了响应长度、努力和思考深度校准、工具使用触发、字面指令遵循、子智能体控制以及设计和前端默认设置。

## 通用原则 \{#general-principles}

本节及后续各节中的技术适用于所有当前的 Claude 模型，包括 Claude Fable 5 和 Claude Mythos 5。

### 清晰直接 \{#be-clear-and-direct}

Claude 对清晰、明确的指令响应良好。具体说明您期望的输出有助于提升结果。如果您希望获得"超出预期"的表现，请明确提出要求，而不是依赖模型从模糊的提示中推断。

可以把 Claude 想象成一位才华横溢但刚入职的新员工，对您的规范和工作流程缺乏了解。您越精确地解释您的需求，结果就越好。

**黄金法则：** 将您的提示展示给一位对该任务了解甚少的同事，请他们按照提示执行。如果他们感到困惑，Claude 也会如此。

- 明确说明期望的输出格式和约束条件。
- 当步骤的顺序或完整性很重要时，使用编号列表或项目符号将指令作为顺序步骤提供。

<section title="示例：创建分析仪表板">

**效果较差：**
```text
Create an analytics dashboard
```

**效果更好：**
```text
Create an analytics dashboard. Include as many relevant features and interactions as
possible. Go beyond the basics to create a fully-featured implementation.
```

</section>

### 添加上下文以提升性能 \{#add-context-to-improve-performance}

提供指令背后的上下文或动机，例如向 Claude 解释为什么这种行为很重要，可以帮助 Claude 更好地理解您的目标并提供更有针对性的响应。

<section title="示例：格式偏好">

**效果较差：**
```text
NEVER use ellipses
```

**效果更好：**
```text
Your response will be read aloud by a text-to-speech engine, so never use ellipses since
the text-to-speech engine will not know how to pronounce them.
```

</section>

Claude 足够智能，能够从解释中进行泛化。

### 有效使用示例 \{#use-examples-effectively}

示例是引导 Claude 输出格式、语气和结构最可靠的方法之一。几个精心设计的示例（称为 "few-shot"（少样本）或 "multishot"（多样本）提示）可以显著提高准确性和一致性。

添加示例时，请确保它们：
- **相关：** 紧密贴合您的实际用例。
- **多样：** 涵盖边缘情况，并有足够的变化，以免 Claude 学到非预期的模式。
- **结构化：** 将示例包裹在 `<example>` 标签中（多个示例使用 `<examples>` 标签），以便 Claude 能够将它们与指令区分开来。

<Tip>包含 3–5 个示例可获得最佳效果。您还可以让 Claude 评估您的示例的相关性和多样性，或根据您的初始示例集生成更多示例。</Tip>

### 使用 XML 标签构建提示结构 \{#structure-prompts-with-xml-tags}

XML 标签可帮助 Claude 无歧义地解析复杂提示，尤其是当您的提示混合了指令、上下文、示例和可变输入时。将每种类型的内容包裹在各自的标签中（例如 `<instructions>`、`<context>`、`<input>`）可以减少误解。

最佳实践：
- 在所有提示中使用一致且具有描述性的标签名称。
- 当内容具有自然层次结构时嵌套标签（文档放在 `<documents>` 内，每个文档放在 `<document index="n">` 内）。

### 为 Claude 设定角色 \{#give-claude-a-role}

在系统提示中设定角色可以让 Claude 的行为和语气聚焦于您的用例。即使只有一句话也能产生显著效果：

```python Python
import anthropic

client = anthropic.Anthropic()

message = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    system="You are a helpful coding assistant specializing in Python.",
    messages=[
        {"role": "user", "content": "How do I sort a list of dictionaries by key?"}
    ],
)
print(message.content)
```

### 长上下文提示 \{#long-context-prompting}

在处理大型文档或数据密集型输入（20k+ 令牌）时，请仔细构建您的提示以获得最佳结果：

- **将长篇数据放在顶部：** 将长文档和输入放在提示的顶部附近，位于您的查询、指令和示例之上。这可以显著提升所有模型的性能。

    <Note>测试表明，将查询放在末尾可以将响应质量提高多达 30%，尤其是在处理复杂的多文档输入时。</Note>

- **使用 XML 标签构建文档内容和元数据：** 使用多个文档时，将每个文档包裹在 `<document>` 标签中，并使用 `<document_content>` 和 `<source>`（以及其他元数据）子标签以提高清晰度。

    <section title="多文档结构示例">

    ```xml
    <documents>
      <document index="1">
        <source>annual_report_2023.pdf</source>
        <document_content>
          {{ANNUAL_REPORT}}
        </document_content>
      </document>
      <document index="2">
        <source>competitor_analysis_q2.xlsx</source>
        <document_content>
          {{COMPETITOR_ANALYSIS}}
        </document_content>
      </document>
    </documents>

    Analyze the annual report and competitor analysis. Identify strategic advantages and recommend Q3 focus areas.
    ```
    
</section>

- **用引用来支撑响应：** 对于长文档任务，要求 Claude 在执行任务之前先引用文档的相关部分。这有助于 Claude 排除文档其余内容的干扰。

    <section title="引用提取示例">

    ```xml
    You are an AI physician's assistant. Your task is to help doctors diagnose possible patient illnesses.

    <documents>
      <document index="1">
        <source>patient_symptoms.txt</source>
        <document_content>
          {{PATIENT_SYMPTOMS}}
        </document_content>
      </document>
      <document index="2">
        <source>patient_records.txt</source>
        <document_content>
          {{PATIENT_RECORDS}}
        </document_content>
      </document>
      <document index="3">
        <source>patient01_appt_history.txt</source>
        <document_content>
          {{PATIENT01_APPOINTMENT_HISTORY}}
        </document_content>
      </document>
    </documents>

    Find quotes from the patient records and appointment history that are relevant to diagnosing the patient's reported symptoms. Place these in <quotes> tags. Then, based on these quotes, list all information that would help the doctor diagnose the patient's symptoms. Place your diagnostic information in <info> tags.
    ```
    
</section>

### 模型自我认知 \{#model-self-knowledge}

如果您希望 Claude 在您的应用程序中正确识别自己或使用特定的 API 字符串：

```text Sample prompt for model identity
The assistant is Claude, created by Anthropic. The current model is Claude Opus 4.8.
```

对于需要指定模型字符串的 LLM 驱动应用：

```text Sample prompt for model string
When an LLM is needed, please default to Claude Opus 4.8 unless the user requests
otherwise. The exact model string for Claude Opus 4.8 is claude-opus-4-8.
```

## 输出与格式化 \{#output-and-formatting}

### 沟通风格与详细程度 \{#communication-style-and-verbosity}

与之前的模型相比，Claude 的最新模型具有更简洁、更自然的沟通风格：

- **更直接、更务实：** 提供基于事实的进度报告，而非自我夸耀式的更新
- **更具对话性：** 略微更流畅、更口语化，不那么机械
- **更简洁：** 除非另有提示，否则可能会为了效率而跳过详细摘要

这意味着 Claude 可能会在工具调用后跳过口头摘要，直接进入下一个操作。如果您希望更多地了解其推理过程：

```text Sample prompt
After completing a task that involves tool use, provide a quick summary of the work you've done.
```

### 控制响应格式 \{#control-the-format-of-responses}

有几种特别有效的方法可以引导输出格式：

1. **告诉 Claude 应该做什么，而不是不应该做什么**

   - 不要说："不要在响应中使用 markdown"
   - 而应说："您的响应应由流畅连贯的散文段落组成。"

2. **使用 XML 格式指示符**

   - 尝试："将响应的散文部分写在 \<smoothly_flowing_prose_paragraphs\> 标签中。"

3. **使提示风格与期望输出相匹配**

   您在提示中使用的格式风格可能会影响 Claude 的响应风格。如果您在输出格式的可控性方面仍遇到问题，请尝试使提示风格尽可能接近您期望的输出风格。例如，从提示中删除 markdown 可以减少输出中 markdown 的数量。

4. **使用详细提示来指定特定的格式偏好**

   如需更好地控制 markdown 和格式的使用，请提供明确的指导：

```text Sample prompt to minimize markdown
<avoid_excessive_markdown_and_bullet_points>
When writing reports, documents, technical explanations, analyses, or any long-form
content, write in clear, flowing prose using complete paragraphs and sentences. Use
standard paragraph breaks for organization and reserve markdown primarily for `inline
code`, code blocks (```...```), and simple headings (###, and ###). Avoid using **bold**
and *italics*.

DO NOT use ordered lists (1. ...) or unordered lists (*) unless : a) you're presenting
truly discrete items where a list format is the best option, or b) the user explicitly
requests a list or ranking

Instead of listing items with bullets or numbers, incorporate them naturally into
sentences. This guidance applies especially to technical writing. Using prose instead of
excessive formatting will improve user satisfaction. NEVER output a series of overly
short bullet points.

Your goal is readable, flowing text that guides the reader naturally through ideas
rather than fragmenting information into isolated points.
</avoid_excessive_markdown_and_bullet_points>
```

### LaTeX 输出 \{#la-te-x-output}

Claude 的最新模型默认对数学表达式、方程式和技术解释使用 LaTeX。如果您更喜欢纯文本，请在提示中添加以下指令：

```text Sample prompt
Format your response in plain text only. Do not use LaTeX, MathJax, or any markup
notation such as \( \), $, or \frac{}{}. Write all math expressions using standard text
characters (e.g., "/" for division, "*" for multiplication, and "^" for exponents).
```

### 文档创建 \{#document-creation}

Claude 的最新模型擅长创建演示文稿、动画和可视化文档，具有出色的创意表现力和强大的指令遵循能力。在大多数情况下，模型首次尝试即可生成精美、可用的输出。

为获得最佳的文档创建效果：

```text Sample prompt
Create a professional presentation on [topic]. Include thoughtful design elements,
visual hierarchy, and engaging animations where appropriate.
```

### 从预填充响应迁移 \{#migrating-away-from-prefilled-responses}

从 Claude 4.6 模型和 [Claude Mythos Preview](https://anthropic.com/glasswing) 开始，不再支持在最后一个助手回合中预填充响应。向这些模型发送带有预填充助手消息的请求将返回 400 错误。模型的智能和指令遵循能力已经提升到大多数预填充用例不再需要它的程度。早期模型继续支持预填充，并且在对话的其他位置添加助手消息不受影响。

以下是常见的预填充场景以及如何从中迁移：

<section title="控制输出格式">

预填充曾被用于强制特定的输出格式，如 JSON/YAML、分类以及类似的模式，其中预填充将 Claude 约束为特定的结构。

**迁移方法：** [结构化输出](/docs/zh-CN/build-with-claude/structured-outputs)功能专门设计用于约束 Claude 的响应遵循给定的模式。首先尝试直接要求模型符合您的输出结构，因为较新的模型在被告知时可以可靠地匹配复杂的模式，尤其是在配合重试机制实现时。对于分类任务，可以使用带有包含有效标签的枚举字段的工具，或使用结构化输出。

</section>

<section title="消除开场白">

像 `Here is the requested summary:\n` 这样的预填充曾被用于跳过引导性文本。

**迁移方法：** 在系统提示中使用直接指令："直接响应，不要有开场白。不要以'以下是...'、'基于...'等短语开头。"或者，指示模型在 XML 标签内输出、使用结构化输出或使用工具调用。如果偶尔有开场白漏过，可在后处理中将其去除。

</section>

<section title="避免不当拒绝">

预填充曾被用于绕过不必要的拒绝。

**迁移方法：** Claude 现在在适当拒绝方面表现得更好。在 `user` 消息中进行清晰的提示而无需预填充应该就足够了。

</section>

<section title="续写">

预填充曾被用于继续部分完成的内容、恢复中断的响应或从上一次生成停止的地方继续。

**迁移方法：** 将续写内容移至用户消息中，并包含中断响应的最后文本："您之前的响应被中断，结尾是 \`[previous_response]\`。请从中断处继续。"如果这是错误处理或不完整响应处理的一部分，且没有用户体验损失，则重试该请求。

</section>

<section title="上下文注入和角色一致性">

预填充曾被用于定期确保刷新或注入的上下文。

**迁移方法：** 对于非常长的对话，将之前预填充的助手提醒注入到用户回合中。如果上下文注入是更复杂的智能体系统的一部分，请考虑通过工具进行注入（根据回合数等启发式规则暴露或鼓励使用包含上下文的工具）或在上下文压缩期间进行注入。

</section>

## 工具使用 \{#tool-use}

### 工具使用方式 \{#tool-usage}

Claude 的最新模型经过训练以精确遵循指令，并受益于使用特定工具的明确指示。如果您说"能否建议一些更改"，Claude 有时会提供建议而不是实施它们，即使进行更改可能才是您的本意。

要让 Claude 采取行动，请更加明确：

<section title="示例：明确的指令">

**效果较差（Claude 只会提出建议）：**
```text
Can you suggest some changes to improve this function?
```

**效果更好（Claude 会进行更改）：**
```text
Change this function to improve its performance.
```

或者：
```text
Make these edits to the authentication flow.
```

</section>

要让 Claude 默认更主动地采取行动，您可以将以下内容添加到系统提示中：

```text Sample prompt for proactive action
<default_to_action>
By default, implement changes rather than only suggesting them. If the user's intent is
unclear, infer the most useful likely action and proceed, using tools to discover any
missing details instead of guessing. Try to infer the user's intent about whether a tool
call (e.g., file edit or read) is intended or not, and act accordingly.
</default_to_action>
```

另一方面，如果您希望模型默认更加谨慎，不那么倾向于直接开始实施，仅在被要求时才采取行动，您可以使用如下提示来引导这种行为：

```text Sample prompt for conservative action
<do_not_act_before_instructions>
Do not jump into implementation or change files unless clearly instructed to make
changes. When the user's intent is ambiguous, default to providing information, doing
research, and providing recommendations rather than taking action. Only proceed with
edits, modifications, or implementations when the user explicitly requests them.
</do_not_act_before_instructions>
```

Claude Opus 4.5 和 Claude Opus 4.6 对系统提示的响应也比之前的模型更敏感。如果您的提示旨在减少工具或技能的触发不足问题，这些模型现在可能会过度触发。解决方法是减弱任何激进的措辞。之前您可能会说"关键：您必须在...时使用此工具"，现在可以使用更常规的提示，如"在...时使用此工具"。

### 优化并行工具调用 \{#optimize-parallel-tool-calling}

Claude 的最新模型擅长并行工具执行。这些模型会：

- 在研究期间运行多个推测性搜索
- 一次读取多个文件以更快地构建上下文
- 并行执行 bash 命令（这甚至可能成为系统性能的瓶颈）

这种行为很容易引导。虽然模型在没有提示的情况下并行工具调用的成功率很高，但您可以将其提升到约 100% 或调整激进程度：

```text Sample prompt for maximum parallel efficiency
<use_parallel_tool_calls>
If you intend to call multiple tools and there are no dependencies between the tool
calls, make all of the independent tool calls in parallel. Prioritize calling tools
simultaneously whenever the actions can be done in parallel rather than sequentially.
For example, when reading 3 files, run 3 tool calls in parallel to read all 3 files into
context at the same time. Maximize use of parallel tool calls where possible to increase
speed and efficiency. However, if some tool calls depend on previous calls to inform
dependent values like the parameters, do NOT call these tools in parallel and instead
call them sequentially. Never use placeholders or guess missing parameters in tool
calls.
</use_parallel_tool_calls>
```

```text Sample prompt to reduce parallel execution
Execute operations sequentially with brief pauses between each step to ensure stability.
```

## 思考与推理 \{#thinking-and-reasoning}

### 过度思考和过度彻底 \{#overthinking-and-excessive-thoroughness}

Claude Opus 4.6 比之前的模型进行更多的前期探索，尤其是在较高的 `effort` 设置下。这种初始工作通常有助于优化最终结果，但模型可能会在没有提示的情况下收集大量上下文或追踪多条研究线索。如果您的提示之前鼓励模型更加彻底，您应该针对 Claude Opus 4.6 调整该指导：

- **用更有针对性的指令替换笼统的默认设置。** 不要说"默认使用 \[工具\]"，而应添加类似"当 \[工具\] 有助于增强您对问题的理解时使用它"的指导。
- **删除过度提示。** 在之前模型中触发不足的工具现在可能会适当触发。像"如有疑问，请使用 \[工具\]"这样的指令会导致过度触发。
- **将 effort 作为后备方案。** 如果 Claude 仍然过于激进，请使用较低的 `effort` 设置。

在某些情况下，Claude Opus 4.6 可能会进行大量思考，这会增加思考令牌并减慢响应速度。如果这种行为不是您想要的，您可以添加明确的指令来约束其推理，或者降低 `effort` 设置以减少整体思考和令牌使用量。

```text Sample prompt
When you're deciding how to approach a problem, choose an approach and commit to it.
Avoid revisiting decisions unless you encounter new information that directly
contradicts your reasoning. If you're weighing two approaches, pick one and see it
through. You can always course-correct later if the chosen approach fails.
```

如果您需要对思考成本设置硬性上限，带有 `budget_tokens` 上限的扩展思考在 Opus 4.6 和 Sonnet 4.6 上仍然可用，但已被弃用。建议优先降低 [effort](/docs/zh-CN/build-with-claude/effort) 设置，或将 `max_tokens` 作为硬性限制与[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)配合使用。

### 利用思考和交错思考能力 \{#leverage-thinking-and-interleaved-thinking-capabilities}

Claude 的最新模型提供思考能力，这对于涉及工具使用后反思或复杂多步推理的任务特别有帮助。您可以引导其初始思考或交错思考以获得更好的结果。

Claude Opus 4.6 和 Claude Sonnet 4.6 使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（`thinking: {type: "adaptive"}`），Claude 会动态决定何时思考以及思考多少。Claude 根据两个因素校准其思考：`effort` 参数和查询复杂度。更高的 effort 会引发更多思考，更复杂的查询也是如此。对于不需要思考的简单查询，模型会直接响应。在内部评估中，自适应思考可靠地带来比扩展思考更好的性能。建议迁移到自适应思考以获得最智能的响应。

对于需要智能体行为的工作负载（如多步工具使用、复杂编码任务和长期智能体循环），请使用自适应思考。较旧的模型使用带有 `budget_tokens` 的手动思考模式。

您可以引导 Claude 的思考行为：

```text Example prompt
After receiving tool results, carefully reflect on their quality and determine optimal
next steps before proceeding. Use your thinking to plan and iterate based on this new
information, and then take the best next action.
```

自适应思考的触发行为可以通过提示来调整。如果您发现模型思考的频率超出您的预期（这在大型或复杂的系统提示中可能发生），请添加指导来引导它：

```text Sample prompt
Extended thinking adds latency and should only be used when it will meaningfully improve
answer quality - typically for problems that require multi-step reasoning. When in
doubt, respond directly.
```

如果您正在从带有 `budget_tokens` 的[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)迁移，请替换您的思考配置并将预算控制移至 `effort`：

**之前（扩展思考，较旧的模型）：**

```python Python nocheck
client.messages.create(
    model="claude-sonnet-4-5-20250929",
    max_tokens=64000,
    thinking={"type": "enabled", "budget_tokens": 32000},
    messages=[{"role": "user", "content": "..."}],
)
```

**之后（自适应思考）：**

```python Python nocheck
client.messages.create(
    model="claude-opus-4-8",
    max_tokens=64000,
    thinking={"type": "adaptive"},
    output_config={"effort": "high"},  # or "max", "xhigh", "medium", "low"
    messages=[{"role": "user", "content": "..."}],
)
```

如果您没有使用扩展思考，则无需进行任何更改。当您省略 `thinking` 参数时，思考默认关闭。

- **优先使用通用指令而非规定性步骤。** 像"仔细思考"这样的提示通常比手写的分步计划产生更好的推理。Claude 的推理经常超出人类所能规定的范围。
- **多样本示例与思考配合使用。** 在少样本示例中使用 `<thinking>` 标签向 Claude 展示推理模式。它会将该风格泛化到自己的扩展思考块中。
- **手动 CoT 作为后备方案。** 当思考关闭时，您仍然可以通过要求 Claude 逐步思考问题来鼓励分步推理。使用 `<thinking>` 和 `<answer>` 等结构化标签来清晰地将推理与最终输出分开。
- **要求 Claude 自我检查。** 附加类似"在完成之前，请根据 [测试标准] 验证您的答案"的内容。这可以可靠地捕获错误，尤其是在编码和数学方面。

<Note>当扩展思考被禁用时，Claude Opus 4.5 对"think"（思考）一词及其变体特别敏感。在这些情况下，请考虑使用"consider"（考虑）、"evaluate"（评估）或"reason through"（推理）等替代词。</Note>

<Info>
  有关思考能力的更多信息，请参阅[扩展思考](/docs/zh-CN/build-with-claude/extended-thinking)和[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)。
</Info>

## 智能体系统 \{#agentic-systems}

### 长期推理和状态跟踪 \{#long-horizon-reasoning-and-state-tracking}

Claude 的最新模型擅长长期推理任务，具有出色的状态跟踪能力。Claude 通过专注于增量进展来在长时间会话中保持方向感，每次稳步推进少数几件事，而不是试图一次性完成所有事情。这种能力在跨多个上下文窗口或任务迭代时尤为突出，Claude 可以处理复杂任务、保存状态，然后在新的上下文窗口中继续。

#### 上下文感知和多窗口工作流 \{#context-awareness-and-multi-window-workflows}

Claude 4.6 和 Claude 4.5 模型具有[上下文感知](/docs/zh-CN/build-with-claude/context-windows#context-awareness-in-claude-sonnet-4-6-sonnet-4-5-and-haiku-4-5)功能，使模型能够在整个对话过程中跟踪其剩余的上下文窗口（即"令牌预算"）。这使 Claude 能够通过了解自己有多少工作空间来更有效地执行任务和管理上下文。

**管理上下文限制：**

如果您在智能体框架中使用 Claude，该框架会压缩上下文或允许将上下文保存到外部文件（如在 Claude Code 中），请考虑将此信息添加到您的提示中，以便 Claude 能够相应地行动。否则，Claude 有时可能会在接近上下文限制时自然地尝试收尾工作。以下是一个示例提示：

```text Sample prompt
Your context window will be automatically compacted as it approaches its limit, allowing
you to continue working indefinitely from where you left off. Therefore, do not stop
tasks early due to token budget concerns. As you approach your token budget limit, save
your current progress and state to memory before the context window refreshes. Always be
as persistent and autonomous as possible and complete tasks fully, even if the end of
your budget is approaching. Never artificially stop any task early regardless of the
context remaining.
```

[记忆工具](/docs/zh-CN/agents-and-tools/tool-use/memory-tool)与上下文感知自然搭配，可实现无缝的上下文转换。

#### 多上下文窗口工作流 \{#multi-context-window-workflows}

对于跨多个上下文窗口的任务：

1. **为第一个上下文窗口使用不同的提示：** 使用第一个上下文窗口来建立框架（编写测试、创建设置脚本），然后使用后续的上下文窗口来迭代待办事项列表。

2. **让模型以结构化格式编写测试：** 要求 Claude 在开始工作之前创建测试，并以结构化格式（例如 `tests.json`）跟踪它们。这有助于提高长期迭代能力。提醒 Claude 测试的重要性："删除或编辑测试是不可接受的，因为这可能导致功能缺失或存在缺陷。"

3. **设置便利工具：** 鼓励 Claude 创建设置脚本（例如 `init.sh`）以优雅地启动服务器、运行测试套件和代码检查工具。这可以避免在从新的上下文窗口继续时重复工作。

4. **全新开始与压缩：** 当上下文窗口被清除时，考虑从全新的上下文窗口开始，而不是使用压缩。Claude 的最新模型在从本地文件系统发现状态方面非常有效。在某些情况下，您可能希望利用这一点而不是压缩。请明确规定它应该如何开始：
   - "调用 pwd；您只能读取和写入此目录中的文件。"
   - "查看 progress.txt、tests.json 和 git 日志。"
   - "在继续实现新功能之前，手动运行一次基本的集成测试。"

5. **提供验证工具：** 随着自主任务时长的增加，Claude 需要在没有持续人工反馈的情况下验证正确性。Playwright MCP 服务器或用于测试 UI 的计算机使用能力等工具会很有帮助。

6. **鼓励充分利用上下文：** 提示 Claude 在继续下一步之前高效地完成各个组件：

```text Sample prompt
This is a very long task, so it may be beneficial to plan out your work clearly. It's
encouraged to spend your entire output context working on the task - just make sure you
don't run out of context with significant uncommitted work. Continue working
systematically until you have completed this task.
```

#### 状态管理最佳实践 \{#state-management-best-practices}

- **对状态数据使用结构化格式：** 在跟踪结构化信息（如测试结果或任务状态）时，使用 JSON 或其他结构化格式来帮助 Claude 理解模式要求
- **对进度笔记使用非结构化文本：** 自由格式的进度笔记适合跟踪一般进度和上下文
- **使用 git 进行状态跟踪：** Git 提供已完成工作的日志和可恢复的检查点。Claude 的最新模型在使用 git 跨多个会话跟踪状态方面表现尤为出色。
- **强调增量进展：** 明确要求 Claude 跟踪其进度并专注于增量工作

<section title="示例：状态跟踪">

```json
// Structured state file (tests.json)
{
  "tests": [
    { "id": 1, "name": "authentication_flow", "status": "passing" },
    { "id": 2, "name": "user_management", "status": "failing" },
    { "id": 3, "name": "api_endpoints", "status": "not_started" }
  ],
  "total": 200,
  "passing": 150,
  "failing": 25,
  "not_started": 25
}
```

```text
// Progress notes (progress.txt)
Session 3 progress:
- Fixed authentication token validation
- Updated user model to handle edge cases
- Next: investigate user_management test failures (test #2)
- Note: Do not remove tests as this could lead to missing functionality
```

</section>

### 平衡自主性与安全性 \{#balancing-autonomy-and-safety}

在没有指导的情况下，Claude Opus 4.6 可能会采取难以撤销或影响共享系统的操作，例如删除文件、强制推送或发布到外部服务。如果您希望 Claude Opus 4.6 在采取潜在风险操作之前进行确认，请在提示中添加指导：

```text Sample prompt
Consider the reversibility and potential impact of your actions. You are encouraged to
take local, reversible actions like editing files or running tests, but for actions that
are hard to reverse, affect shared systems, or could be destructive, ask the user before
proceeding.

Examples of actions that warrant confirmation:
- Destructive operations: deleting files or branches, dropping database tables, rm -rf
- Hard to reverse operations: git push --force, git reset --hard, amending published commits
- Operations visible to others: pushing code, commenting on PRs/issues, sending
messages, modifying shared infrastructure

When encountering obstacles, do not use destructive actions as a shortcut. For example,
don't bypass safety checks (e.g. --no-verify) or discard unfamiliar files that may be
in-progress work.
```

### 研究和信息收集 \{#research-and-information-gathering}

Claude 的最新模型展现出卓越的智能体搜索能力，可以有效地从多个来源查找和综合信息。为获得最佳研究结果：

1. **提供明确的成功标准：** 定义什么构成对您的研究问题的成功回答

2. **鼓励来源验证：** 要求 Claude 跨多个来源验证信息

3. **对于复杂的研究任务，使用结构化方法：**

```text Sample prompt for complex research
Search for this information in a structured way. As you gather data, develop several
competing hypotheses. Track your confidence levels in your progress notes to improve
calibration. Regularly self-critique your approach and plan. Update a hypothesis tree or
research notes file to persist information and provide transparency. Break down this
complex research task systematically.
```

这种结构化方法使 Claude 能够查找和综合几乎任何信息，并迭代地审视其发现，无论语料库的规模如何。

### 子智能体编排 \{#subagent-orchestration}

Claude 的最新模型展现出显著改进的原生子智能体编排能力。这些模型可以识别哪些任务会从将工作委派给专门的子智能体中受益，并主动这样做，而无需明确指示。

要利用这种行为：

1. **确保子智能体工具定义明确：** 提供可用的子智能体工具并在工具定义中进行描述
2. **让 Claude 自然地进行编排：** Claude 会在没有明确指示的情况下适当地委派任务
3. **注意过度使用：** Claude Opus 4.6 对子智能体有强烈的偏好，可能会在更简单、直接的方法就足够的情况下生成子智能体。例如，当直接调用 grep 更快且足够时，模型可能会为代码探索生成子智能体。

如果您发现子智能体使用过度，请添加关于何时需要和不需要子智能体的明确指导：

```text Sample prompt for subagent usage
Use subagents when tasks can run in parallel, require isolated context, or involve
independent workstreams that don't need to share state. For simple tasks, sequential
operations, single-file edits, or tasks where you need to maintain context across steps,
work directly rather than delegating.
```

### 链接复杂提示 \{#chain-complex-prompts}

借助自适应思考和子智能体编排，Claude 可以在内部处理大多数多步推理。当您需要检查中间输出或强制执行特定的流水线结构时，显式提示链接（将任务分解为顺序的 API 调用）仍然有用。

最常见的链接模式是**自我纠正：** 生成草稿 → 让 Claude 根据标准审查它 → 让 Claude 根据审查进行优化。每个步骤都是单独的 API 调用，因此您可以在任何时候记录、评估或分支。

### 减少智能体编码中的文件创建 \{#reduce-file-creation-in-agentic-coding}

Claude 的最新模型有时可能会为测试和迭代目的创建新文件，尤其是在处理代码时。这种方法允许 Claude 在保存最终输出之前将文件（尤其是 Python 脚本）用作"临时草稿本"。使用临时文件可以改善结果，特别是对于智能体编码用例。

如果您希望尽量减少新文件的创建，可以指示 Claude 自行清理：

```text Sample prompt
If you create any temporary new files, scripts, or helper files for iteration, clean up
these files by removing them at the end of the task.
```

### 过度积极 \{#overeagerness}

Claude Opus 4.5 和 Claude Opus 4.6 有过度工程化的倾向，会创建额外的文件、添加不必要的抽象或构建未被要求的灵活性。如果您看到这种不希望的行为，请添加具体指导以保持解决方案的简洁。

例如：

```text Sample prompt to minimize overengineering
Avoid over-engineering. Only make changes that are directly requested or clearly
necessary. Keep solutions simple and focused:

- Scope: Don't add features, refactor code, or make "improvements" beyond what was
asked. A bug fix doesn't need surrounding code cleaned up. A simple feature doesn't need
extra configurability.

- Documentation: Don't add docstrings, comments, or type annotations to code you didn't
change. Only add comments where the logic isn't self-evident.

- Defensive coding: Don't add error handling, fallbacks, or validation for scenarios
that can't happen. Trust internal code and framework guarantees. Only validate at system
boundaries (user input, external APIs).

- Abstractions: Don't create helpers, utilities, or abstractions for one-time
operations. Don't design for hypothetical future requirements. The right amount of
complexity is the minimum needed for the current task.
```

### 避免专注于通过测试和硬编码 \{#avoid-focusing-on-passing-tests-and-hard-coding}

Claude 有时可能过于专注于让测试通过，而牺牲了更通用的解决方案，或者可能使用辅助脚本等变通方法进行复杂的重构，而不是直接使用标准工具。为防止这种行为并确保稳健、可泛化的解决方案：

```text Sample prompt
Please write a high-quality, general-purpose solution using the standard tools
available. Do not create helper scripts or workarounds to accomplish the task more
efficiently. Implement a solution that works correctly for all valid inputs, not just
the test cases. Do not hard-code values or create solutions that only work for specific
test inputs. Instead, implement the actual logic that solves the problem generally.

Focus on understanding the problem requirements and implementing the correct algorithm.
Tests are there to verify correctness, not to define the solution. Provide a principled
implementation that follows best practices and software design principles.

If the task is unreasonable or infeasible, or if any of the tests are incorrect, please
inform me rather than working around them. The solution should be robust, maintainable,
and extendable.
```

### 最小化智能体编码中的幻觉 \{#minimizing-hallucinations-in-agentic-coding}

Claude 的最新模型不太容易产生幻觉，并能基于代码给出更准确、更有依据、更智能的答案。要进一步鼓励这种行为并最小化幻觉：

```text Sample prompt
<investigate_before_answering>
Never speculate about code you have not opened. If the user references a specific file,
you MUST read the file before answering. Make sure to investigate and read relevant
files BEFORE answering questions about the codebase. Never make any claims about code
before investigating unless you are certain of the correct answer - give grounded and
hallucination-free answers.
</investigate_before_answering>
```

## 特定能力提示 \{#capability-specific-tips}

### 改进的视觉能力 \{#improved-vision-capabilities}

与之前的 Claude 模型相比，Claude Opus 4.5 和 Claude Opus 4.6 具有改进的视觉能力。它们在图像处理和数据提取任务上表现更好，尤其是当上下文中存在多个图像时。这些改进也延伸到计算机使用场景，模型可以更可靠地解读屏幕截图和 UI 元素。您还可以通过将视频分解为帧来使用这些模型分析视频。

一种已被证明能进一步提升性能的有效技术是为 Claude 提供裁剪工具或[技能](/docs/zh-CN/agents-and-tools/agent-skills/overview)。测试表明，当 Claude 能够"放大"图像的相关区域时，图像评估的表现会持续提升。Anthropic 已创建了[裁剪工具的 cookbook](https://platform.claude.com/cookbook/multimodal-crop-tool)。

### 前端设计 \{#frontend-design}

Claude Opus 4.5 和 Claude Opus 4.6 擅长构建具有出色前端设计的复杂、真实的 Web 应用程序。然而，在没有指导的情况下，模型可能会默认使用通用模式，从而产生用户所说的"AI 粗制滥造"美学。要创建独特、富有创意、令人惊喜的前端：

<Tip>
有关改进前端设计的详细指南，请参阅博客文章[通过技能改进前端设计](https://www.claude.com/blog/improving-frontend-design-through-skills)。
</Tip>

以下是一个可用于鼓励更好前端设计的系统提示片段：

```text Sample prompt for frontend aesthetics
<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this
creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive
frontends that surprise and delight.

Focus on:
- Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic
fonts like Arial and Inter; opt instead for distinctive choices that elevate the
frontend's aesthetics.
- Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency.
Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw
from IDE themes and cultural aesthetics for inspiration.
- Motion: Use animations for effects and micro-interactions. Prioritize CSS-only
solutions for HTML. Use Motion library for React when available. Focus on high-impact
moments: one well-orchestrated page load with staggered reveals (animation-delay)
creates more delight than scattered micro-interactions.
- Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer
CSS gradients, use geometric patterns, or add contextual effects that match the overall
aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Clichéd color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the
context. Vary between light and dark themes, different fonts, different aesthetics. You
still tend to converge on common choices (Space Grotesk, for example) across
generations. Avoid this: it is critical that you think outside the box!
</frontend_aesthetics>
```

您还可以参考[完整的技能定义](https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md)。

## 迁移注意事项 \{#migration-considerations}

从早期版本迁移到 Claude 4.6 模型时：

1. **明确说明期望的行为：** 考虑准确描述您希望在输出中看到的内容。

2. **使用修饰语来构建指令：** 添加鼓励 Claude 提高输出质量和细节的修饰语可以帮助更好地塑造 Claude 的表现。例如，不要说"创建一个分析仪表板"，而应说"创建一个分析仪表板。包含尽可能多的相关功能和交互。超越基础，创建一个功能齐全的实现。"

3. **明确请求特定功能：** 需要动画和交互元素时应明确请求。

4. **更新思考配置：** Claude 4.6 模型使用[自适应思考](/docs/zh-CN/build-with-claude/adaptive-thinking)（`thinking: {type: "adaptive"}`），而不是带有 `budget_tokens` 的手动思考。使用 [effort 参数](/docs/zh-CN/build-with-claude/effort)来控制思考深度。

5. **从预填充响应迁移：** 从 Claude 4.6 模型开始，不再支持在最后一个助手回合中预填充响应。有关替代方案的详细指导，请参阅[从预填充响应迁移](#migrating-away-from-prefilled-responses)。

6. **调整反懒惰提示：** 如果您的提示之前鼓励模型更加彻底或更积极地使用工具，请减弱该指导。Claude 4.6 模型明显更加主动，可能会对之前模型所需的指令过度触发。

有关详细的迁移步骤，请参阅[迁移指南](/docs/zh-CN/about-claude/models/migration-guide)。

### 从 Claude Sonnet 4.5 迁移到 Claude Sonnet 4.6 \{#migrating-from-claude-sonnet-4-5-to-claude-sonnet-4-6}

请参阅迁移指南中的[从 Sonnet 4.5 迁移](/docs/zh-CN/about-claude/models/migration-guide#migrating-from-sonnet-45)，其中涵盖了 effort 默认值的变更以及两种扩展思考迁移路径。