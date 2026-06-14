# 提示工程概述

---

## 开始提示工程之前 \{#before-prompt-engineering}

本指南假设您已具备以下条件：
1. 对您的用例有明确的成功标准定义
2. 有一些方法可以根据这些标准进行实证测试
3. 有一个想要改进的初稿提示

如果没有，我们强烈建议您先花时间建立这些基础。请查看[定义成功标准并构建评估](/docs/zh-CN/test-and-evaluate/develop-tests)以获取相关提示和指导。

<CardGroup cols={2}>
  <Card title="提示生成器" icon="link" href="/dashboard">
    还没有初稿提示？试试 Claude Console 中的提示生成器！
  </Card>
  <Card title="提示最佳实践" icon="link" href="/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices">
    如需针对 Claude 最新模型的特定调优指导，请从这里开始。
  </Card>
</CardGroup>

***

## 何时进行提示工程 \{#when-to-prompt-engineer}

  本指南重点关注可通过"prompt engineering"（提示工程）控制的成功标准。
  并非所有成功标准或失败的评估都最适合通过提示工程来解决。例如，"latency"（延迟）和成本有时可以通过选择不同的模型来更轻松地改善。

***

## 如何进行提示工程 \{#how-to-prompt-engineer}

所有提示技术——从清晰度和示例，到 XML 结构化、角色提示、思考以及提示链——都涵盖在[提示最佳实践](/docs/zh-CN/build-with-claude/prompt-engineering/claude-prompting-best-practices)中。这是持续更新的参考文档，请从那里开始。

[Claude Console](/dashboard) 还提供了[提示工具](/docs/zh-CN/build-with-claude/prompt-engineering/prompting-tools)——提示生成器、模板和变量，以及提示改进器——帮助您快速构建和优化提示。

***

## 提示工程教程 \{#prompt-engineering-tutorial}

如果您是交互式学习者，可以直接深入学习我们的交互式教程！

<CardGroup cols={2}>
  <Card title="GitHub 提示教程" icon="link" href="https://github.com/anthropics/prompt-eng-interactive-tutorial">
    一个包含丰富示例的教程，涵盖了我们文档中的提示工程概念。
  </Card>
  <Card title="Google Sheets 提示教程" icon="link" href="https://docs.google.com/spreadsheets/d/19jzLgRruG9kjUQNKtCg1ZjdD6l6weA6qRXG5zLIAhC8">
    通过交互式电子表格提供的轻量版提示工程教程。
  </Card>
</CardGroup>