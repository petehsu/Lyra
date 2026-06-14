# 使用评估工具

[Claude Console](/dashboard) 提供了一个**评估工具**，允许您在各种场景下测试您的提示。

---

## 访问评估功能 \{#accessing-the-evaluate-feature}

要开始使用评估工具：

1. 打开 Claude Console 并导航到提示编辑器。
2. 编写完提示后，在屏幕顶部找到"Evaluate"（评估）选项卡。

![访问评估功能](/docs/images/access_evaluate.png)

<Tip>
确保您的提示至少包含 1-2 个使用双大括号语法的动态变量：\{\{variable\}\}。这是创建评估测试集的必要条件。
</Tip>

## 生成提示 \{#generating-prompts}

Console 提供了一个由 Claude Sonnet 4.5 驱动的内置[提示生成器](/docs/zh-CN/build-with-claude/prompt-engineering/prompting-tools)：

<Steps>
  <Step title="点击'Generate Prompt'（生成提示）">
    点击"Generate Prompt"辅助工具将打开一个模态框，允许您输入任务信息。
  </Step>
  <Step title="描述您的任务">
    根据需要详细或简略地描述您期望的任务（例如，"对入站客户支持请求进行分类"）。您提供的上下文越多，Claude 就越能根据您的具体需求定制生成的提示。
  </Step>
  <Step title="生成您的提示">
    点击底部的橙色"Generate Prompt"按钮，Claude 将为您生成高质量的提示。然后，您可以使用 Console 中的评估界面进一步改进这些提示。
  </Step>
</Steps>

此功能使您可以更轻松地创建具有适当变量语法的提示以进行评估。

![提示生成器](/docs/images/promptgenerator.png)

## 创建测试用例 \{#creating-test-cases}

当您访问评估界面时，有多种方式可以创建测试用例：

1. 点击左下角的"+ Add Row"（添加行）按钮手动添加用例。
2. 使用"Generate Test Case"（生成测试用例）功能让 Claude 自动为您生成测试用例。
3. 从 CSV 文件导入测试用例。

要使用"Generate Test Case"功能：

<Steps>
  <Step title="点击'Generate Test Case'（生成测试用例）">
    Claude 将为您生成测试用例，每次点击按钮生成一行。
  </Step>
  <Step title="编辑生成逻辑（可选）">
    您还可以通过点击"Generate Test Case"按钮右侧的下拉箭头，然后点击弹出的 Variables（变量）窗口顶部的"Show generation logic"（显示生成逻辑）来编辑测试用例生成逻辑。您可能需要点击此窗口右上角的"Generate"来填充初始生成逻辑。

    编辑此内容可以让您自定义和微调 Claude 生成的测试用例，以获得更高的精确度和针对性。
  </Step>
</Steps>

以下是包含多个测试用例的已填充评估界面示例：

![已填充的评估界面](/docs/images/eval_populated.png)

<Note>
如果您更新了原始提示文本，可以针对新提示重新运行整个评估套件，以查看更改如何影响所有测试用例的性能。
</Note>

## 有效评估的技巧 \{#tips-for-effective-evaluation}

<section title="用于评估的提示结构">

为了充分利用评估工具，请使用清晰的输入和输出格式来构建您的提示。例如：

```text
In this task, you will generate a cute one sentence story that incorporates two elements: a color and a sound.
The color to include in the story is:
<color>
{{COLOR}}
</color>
The sound to include in the story is:
<sound>
{{SOUND}}
</sound>
Here are the steps to generate the story:
1. Think of an object, animal, or scene that is commonly associated with the color provided. For example, if the color is "blue", you might think of the sky, the ocean, or a bluebird.
2. Imagine a simple action, event or scene involving the colored object/animal/scene you identified and the sound provided. For instance, if the color is "blue" and the sound is "whistle", you might imagine a bluebird whistling a tune.
3. Describe the action, event or scene you imagined in a single, concise sentence. Focus on making the sentence cute, evocative and imaginative. For example: "A cheerful bluebird whistled a merry melody as it soared through the azure sky."
Please keep your story to one sentence only. Aim to make that sentence as charming and engaging as possible while naturally incorporating the given color and sound.
Write your completed one sentence story inside <story> tags.

```

这种结构使您可以轻松地改变输入（\{\{COLOR\}\} 和 \{\{SOUND\}\}）并一致地评估输出。

</section>

<Tip>
使用 Console 中的"Generate a prompt"（生成提示）辅助工具，快速创建具有适当变量语法的提示以进行评估。
</Tip>

## 理解和比较结果 \{#understanding-and-comparing-results}

评估工具提供了多项功能来帮助您优化提示：

1. **并排比较**：比较两个或多个提示的输出，快速查看更改带来的影响。
2. **质量评分**：按 5 分制对响应质量进行评分，以跟踪每个提示的响应质量改进情况。
3. **提示版本管理**：创建提示的新版本并重新运行测试套件，以快速迭代和改进结果。

通过查看各个测试用例的结果并比较不同的提示版本，您可以发现规律并更高效地对提示进行明智的调整。

立即开始评估您的提示，使用 Claude 构建更强大的 AI 应用程序！