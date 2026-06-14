# Agent Skills

Agent Skills 是扩展 Claude 功能的模块化能力。每个 Skill 都打包了指令、元数据和可选资源（脚本、模板），Claude 会在相关时自动使用这些内容。

---

<Note>
此功能**不**符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。数据将根据该功能的标准保留策略进行保留。
</Note>

## 为什么使用 Skills \{#why-use-skills}

Skills 是可复用的、基于文件系统的资源，为 Claude 提供特定领域的专业知识：工作流程、上下文和最佳实践，将通用型智能体转变为专家。与提示（用于一次性任务的对话级指令）不同，Skills 按需加载，无需在多个对话中重复提供相同的指导。

**主要优势**：
- **让 Claude 专业化**：为特定领域任务定制能力
- **减少重复**：一次创建，自动使用
- **组合能力**：组合多个 Skills 以构建复杂的工作流程

<Note>
如需深入了解 Agent Skills 的架构和实际应用，请参阅工程博客文章 [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)。
</Note>

## 使用 Skills \{#using-skills}

Anthropic 为常见的文档任务（PowerPoint、Excel、Word、PDF）提供了预构建的 Agent Skills，您也可以创建自己的自定义 Skills。两者的工作方式相同。当与您的请求相关时，Claude 会自动使用它们。

**预构建的 Agent Skills** 可在 claude.ai、Claude API、[Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上使用。完整列表请参阅[可用的 Skills](#available-skills)。

**自定义 Skills** 让您能够打包领域专业知识和组织知识。它们可在 Claude 的各个产品中使用：在 Claude Code 中创建、通过 Claude API 上传，或在 claude.ai 设置中添加。在 [Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上，可通过 Skills API 上传自定义 Skills。

<Note>
**快速入门：**
- 对于预构建的 Agent Skills：请参阅[快速入门教程](/docs/zh-CN/agents-and-tools/agent-skills/quickstart)，开始在 API 中使用 PowerPoint、Excel、Word 和 PDF skills
- 对于自定义 Skills：请参阅 [Agent Skills Cookbook](https://platform.claude.com/cookbook/skills-notebooks-01-skills-introduction)，了解如何创建您自己的 Skills
</Note>

## Skills 的工作原理 \{#how-skills-work}

Skills 利用 Claude 的虚拟机环境，提供超越单纯提示所能实现的能力。Claude 在具有文件系统访问权限的虚拟机中运行，使 Skills 能够以目录的形式存在，其中包含指令、可执行代码和参考资料，其组织方式就像您为新团队成员创建的入职指南一样。

这种基于文件系统的架构实现了**渐进式披露**（progressive disclosure）：Claude 根据需要分阶段加载信息，而不是预先占用上下文。

### 三种类型的 Skill 内容，三个加载层级 \{#three-types-of-skill-content-three-levels-of-loading}

Skills 可以包含三种类型的内容，每种内容在不同的时间加载：

### 第 1 层级：元数据（始终加载） \{#level-1-metadata-always-loaded}

**内容类型：指令**。Skill 的 YAML frontmatter 提供发现信息：

```yaml
---
name: pdf-processing
description: Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
---
```

Claude 在启动时加载此元数据并将其包含在系统提示中。这种轻量级方法意味着您可以安装许多 Skills 而不会产生上下文开销；Claude 只知道每个 Skill 的存在以及何时使用它。

### 第 2 层级：指令（触发时加载） \{#level-2-instructions-loaded-when-triggered}

**内容类型：指令**。SKILL.md 的主体部分包含程序性知识：工作流程、最佳实践和指导：

````markdown
# PDF Processing

## Quick start

Use pdfplumber to extract text from PDFs:

```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```

For advanced form filling, see [FORMS.md](FORMS.md).
````

当您的请求与某个 Skill 的描述匹配时，Claude 会通过 bash 从文件系统读取 SKILL.md。只有此时，这些内容才会进入上下文窗口。

### 第 3 层级：资源和代码（按需加载） \{#level-3-resources-and-code-loaded-as-needed}

**内容类型：指令、代码和资源**。Skills 可以捆绑额外的材料：

```text nowrap
pdf-skill/
├── SKILL.md (main instructions)
├── FORMS.md (form-filling guide)
├── REFERENCE.md (detailed API reference)
└── scripts/
    └── fill_form.py (utility script)
```

**指令**：包含专门指导和工作流程的附加 markdown 文件（FORMS.md、REFERENCE.md）

**代码**：Claude 通过 bash 运行的可执行脚本（fill_form.py、validate.py）；脚本提供确定性操作而不消耗上下文

**资源**：参考资料，如数据库模式、API 文档、模板或示例

Claude 仅在被引用时访问这些文件。文件系统模型意味着每种内容类型都有不同的优势：指令用于灵活的指导，代码用于可靠性，资源用于事实查询。

| 层级 | 加载时机 | 令牌成本 | 内容 |
|-------|------------|------------|---------|
| **第 1 层级：元数据** | 始终（启动时） | 每个 Skill 约 100 个令牌 | YAML frontmatter 中的 `name` 和 `description` |
| **第 2 层级：指令** | Skill 被触发时 | 少于 5k 令牌 | 包含指令和指导的 SKILL.md 主体 |
| **第 3+ 层级：资源** | 按需 | 实际上无限制 | 通过 bash 执行的捆绑文件，无需将内容加载到上下文中 |

渐进式披露确保在任何给定时间只有相关内容占用上下文窗口。

### Skills 架构 \{#the-skills-architecture}

Skills 在代码执行环境中运行，Claude 在该环境中拥有文件系统访问权限、bash 命令和代码执行能力。可以这样理解：Skills 以目录的形式存在于虚拟机上，Claude 使用与您在计算机上浏览文件时相同的 bash 命令与它们交互。

![Agent Skills Architecture - showing how Skills integrate with the agent's configuration and virtual machine](/docs/images/agent-skills-architecture.png)

**Claude 如何访问 Skill 内容：**

当 Skill 被触发时，Claude 使用 bash 从文件系统读取 SKILL.md，将其指令带入上下文窗口。如果这些指令引用了其他文件（如 FORMS.md 或数据库模式），Claude 也会使用额外的 bash 命令读取这些文件。当指令提到可执行脚本时，Claude 通过 bash 运行它们，并且只接收输出（脚本代码本身永远不会进入上下文）。

**此架构实现的功能：**

**按需文件访问**：Claude 只读取每个特定任务所需的文件。一个 Skill 可以包含数十个参考文件，但如果您的任务只需要销售模式，Claude 就只加载那一个文件。其余文件保留在文件系统上，消耗零令牌。

**高效的脚本执行**：当 Claude 运行 `validate_form.py` 时，脚本的代码永远不会加载到上下文窗口中。只有脚本的输出（如"验证通过"或特定的错误消息）会消耗令牌。这使得脚本比让 Claude 即时生成等效代码要高效得多。

**捆绑内容没有实际限制**：由于文件在被访问之前不会消耗上下文，Skills 可以包含全面的 API 文档、大型数据集、大量示例或您需要的任何参考资料。未使用的捆绑内容不会产生上下文开销。

这种基于文件系统的模型正是渐进式披露得以实现的原因。Claude 浏览您的 Skill 就像您查阅入职指南的特定章节一样，精确访问每个任务所需的内容。

### 示例：加载 PDF 处理 skill \{#example-loading-a-pdf-processing-skill}

以下是 Claude 加载和使用 PDF 处理 skill 的方式：

1. **启动**：系统提示包含：`PDF Processing - Extract text and tables from PDF files, fill forms, merge documents`
2. **用户请求**："从这个 PDF 中提取文本并进行总结"
3. **Claude 调用**：`bash: read pdf-skill/SKILL.md` → 指令加载到上下文中
4. **Claude 判断**：不需要填写表单，因此不读取 FORMS.md
5. **Claude 执行**：使用 SKILL.md 中的指令完成任务

![Skills loading into context window - showing the progressive loading of skill metadata and content](/docs/images/agent-skills-context-window.png)

该图显示：
1. 默认状态，系统提示和 skill 元数据已预加载
2. Claude 通过 bash 读取 SKILL.md 来触发 skill
3. Claude 根据需要选择性地读取额外的捆绑文件，如 FORMS.md
4. Claude 继续执行任务

这种动态加载确保只有相关的 skill 内容占用上下文窗口。

## Skills 的适用范围 \{#where-skills-work}

Skills 可在 Claude 的各个智能体产品中使用：

<Note>
在以下所有章节中，Claude Platform on AWS 和 Microsoft Foundry 继承与 Claude API 相同的 Skills 行为。
</Note>

### Claude API \{#claude-api}

Claude API 同时支持预构建的 Agent Skills 和自定义 Skills。两者的工作方式相同：在 `container` 参数中指定相关的 `skill_id`，并配合代码执行工具使用。

**前提条件**：通过 API 使用 Skills 需要三个 beta 标头：
- `code-execution-2025-08-25` - Skills 在代码执行容器中运行
- `skills-2025-10-02` - 启用 Skills 功能
- `files-api-2025-04-14` - 向容器上传/从容器下载文件所必需

通过引用 `skill_id`（例如 `pptx`、`xlsx`）来使用预构建的 Agent Skills，或通过 Skills API（`/v1/skills` 端点）创建并上传您自己的 Skills。自定义 Skills 在工作区范围内共享；所有工作区成员都可以访问它们。

要了解更多信息，请参阅[在 Claude API 中使用 Skills](/docs/zh-CN/build-with-claude/skills-guide)。

### Claude Code \{#claude-code}

[Claude Code](https://code.claude.com/docs/en/overview) 仅支持自定义 Skills。

**自定义 Skills**：将 Skills 创建为包含 SKILL.md 文件的目录。Claude 会自动发现并使用它们。

Claude Code 中的自定义 Skills 基于文件系统，不需要 API 上传。

要了解更多信息，请参阅[在 Claude Code 中使用 Skills](https://code.claude.com/docs/en/skills)。

### claude.ai \{#claude-ai}

[claude.ai](https://claude.ai) 同时支持预构建的 Agent Skills 和自定义 Skills。

**预构建的 Agent Skills**：当您创建文档时，这些 Skills 已经在后台工作。Claude 无需任何设置即可使用它们。

**自定义 Skills**：通过"设置 > 功能"以 zip 文件形式上传您自己的 Skills。在启用代码执行的 Pro、Max、Team 和 Enterprise 套餐中可用。自定义 Skills 属于每个用户个人所有；它们不会在组织范围内共享，也无法由管理员集中管理。

要了解有关在 claude.ai 中使用 Skills 的更多信息，请参阅 Claude 帮助中心的以下资源：
- [什么是 Skills？](https://support.claude.com/en/articles/12512176-what-are-skills)
- [在 Claude 中使用 Skills](https://support.claude.com/en/articles/12512180-using-skills-in-claude)
- [如何创建自定义 Skills](https://support.claude.com/en/articles/12512198-creating-custom-skills)
- [使用 Skills 教会 Claude 您的工作方式](https://support.claude.com/en/articles/12580051-teach-claude-your-way-of-working-using-skills)

## Skill 结构 \{#skill-structure}

每个 Skill 都需要一个带有 YAML frontmatter 的 `SKILL.md` 文件：

```yaml
---
name: your-skill-name
description: Brief description of what this Skill does and when to use it
---

# Your Skill Name

## Instructions
[Clear, step-by-step guidance for Claude to follow]

## Examples
[Concrete examples of using this Skill]
```

**必填字段**：`name` 和 `description`

**字段要求**：

`name`：
- 最多 64 个字符
- 只能包含小写字母、数字和连字符
- 不能包含 XML 标签
- 不能包含保留词："anthropic"、"claude"

`description`：
- 必须非空
- 最多 1024 个字符
- 不能包含 XML 标签

`description` 应同时包含 Skill 的功能以及 Claude 应在何时使用它。有关完整的编写指南，请参阅[最佳实践指南](/docs/zh-CN/agents-and-tools/agent-skills/best-practices)。

## 安全注意事项 \{#security-considerations}

仅使用来自可信来源的 Skills：您自己创建的或从 Anthropic 获取的。Skills 通过指令和代码为 Claude 提供新的能力，虽然这使它们功能强大，但也意味着恶意 Skill 可能会指示 Claude 以与 Skill 声明用途不符的方式调用工具或执行代码。

<Warning>
如果您必须使用来自不可信或未知来源的 Skill，请格外谨慎，并在使用前对其进行彻底审核。根据 Claude 在执行 Skill 时拥有的访问权限，恶意 Skills 可能导致数据泄露、未经授权的系统访问或其他安全风险。
</Warning>

**关键安全注意事项**：
- **彻底审核**：审查 Skill 中捆绑的所有文件：SKILL.md、脚本、图像和其他资源。查找异常模式，如意外的网络调用、文件访问模式或与 Skill 声明用途不符的操作
- **外部来源存在风险**：从外部 URL 获取数据的 Skills 存在特别的风险，因为获取的内容可能包含恶意指令。即使是可信的 Skills，如果其外部依赖项随时间发生变化，也可能受到威胁
- **工具滥用**：恶意 Skills 可能以有害的方式调用工具（文件操作、bash 命令、代码执行）
- **数据暴露**：有权访问敏感数据的 Skills 可能被设计为将信息泄露到外部系统
- **像对待安装软件一样对待**：仅使用来自可信来源的 Skills。在将 Skills 集成到可访问敏感数据或关键操作的生产系统时，要格外小心

## 可用的 Skills \{#available-skills}

### 预构建的 Agent Skills \{#pre-built-agent-skills}

以下预构建的 Agent Skills 可立即使用：

- **PowerPoint (pptx)**：创建演示文稿、编辑幻灯片、分析演示文稿内容
- **Excel (xlsx)**：创建电子表格、分析数据、生成带图表的报告
- **Word (docx)**：创建文档、编辑内容、格式化文本
- **PDF (pdf)**：生成格式化的 PDF 文档和报告

这些 Skills 可在 Claude API、[Claude Platform on AWS](/docs/zh-CN/build-with-claude/claude-platform-on-aws)、[Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 和 claude.ai 上使用。请参阅[快速入门教程](/docs/zh-CN/agents-and-tools/agent-skills/quickstart)，开始在 API 中使用它们。

### 开源 Skills \{#open-source-skills}

Anthropic 还在 [skills 代码库](https://github.com/anthropics/skills)中发布开源 Skills：

- **[Claude API](/docs/zh-CN/agents-and-tools/agent-skills/claude-api-skill)**：为 Claude 提供最新的 API 参考资料、SDK 文档以及 8 种编程语言的最佳实践。随 Claude Code 捆绑提供，也可从 skills 代码库安装。

### 自定义 Skills 示例 \{#custom-skills-examples}

有关自定义 Skills 的完整示例，请参阅 [Skills cookbook](https://platform.claude.com/cookbook/skills-notebooks-01-skills-introduction)。

## 数据保留 \{#data-retention}

Agent Skills 不在 ZDR 协议的覆盖范围内。Skill 定义和执行数据根据 Anthropic 的标准数据保留政策进行保留。

有关所有功能的 ZDR 资格，请参阅 [API 和数据保留](/docs/zh-CN/manage-claude/api-and-data-retention)。

## 限制和约束 \{#limitations-and-constraints}

了解这些限制有助于您有效地规划 Skills 部署。在以下小节中，Claude Platform on AWS 和 Microsoft Foundry 遵循与 Claude API 相同的限制。

### 跨平台可用性 \{#cross-surface-availability}

**自定义 Skills 不会跨平台同步**。上传到一个平台的 Skills 不会自动在其他平台上可用：

- 上传到 claude.ai 的 Skills 必须单独上传到 API
- 通过 API 上传的 Skills 在 claude.ai 上不可用
- Claude Code 的 Skills 基于文件系统，与 claude.ai 和 API 都是分开的

您需要为每个想要使用 Skills 的平台分别管理和上传 Skills。

### 共享范围 \{#sharing-scope}

Skills 根据您使用它们的位置具有不同的共享模式：
- **claude.ai**：仅限个人用户；每个团队成员必须单独上传
- **Claude API**：工作区范围；所有工作区成员都可以访问已上传的 Skills
- **Claude Code**：个人（`~/.claude/skills/`）或基于项目（`.claude/skills/`）；也可以通过 Claude Code 插件共享

claude.ai 不支持自定义 Skills 的集中管理员管理或组织范围的分发。

### 运行时环境约束 \{#runtime-environment-constraints}

您的 skill 可用的确切运行时环境取决于您使用它的产品平台。

 - **claude.ai**：
    - **网络访问权限不同**：根据用户/管理员设置，Skills 可能具有完全、部分或无网络访问权限。有关更多详细信息，请参阅[使用 Claude 创建和编辑文件](https://support.claude.com/en/articles/12111783-create-and-edit-files-with-claude#h_6b7e833898)支持文章。
- **Claude API**：
    - **无网络访问**：Skills 无法进行外部 API 调用或访问互联网
    - **无运行时包安装**：仅预安装的包可用。您无法在执行期间安装新包。
    - **仅限预配置的依赖项**：请查看[代码执行工具文档](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)以获取可用包的列表
- **Claude Code**：
    - **完全网络访问**：Skills 具有与用户计算机上任何其他程序相同的网络访问权限
    - **不鼓励全局包安装**：Skills 应仅在本地安装包，以避免干扰用户的计算机

请在这些约束范围内规划您的 Skills。

## 后续步骤 \{#next-steps}

<CardGroup cols={2}>
  <Card
    title="Agent Skills 入门"
    icon="graduation-cap"
    href="/docs/zh-CN/agents-and-tools/agent-skills/quickstart"
  >
    创建您的第一个 Skill
  </Card>
  <Card
    title="API 指南"
    icon="code"
    href="/docs/zh-CN/build-with-claude/skills-guide"
  >
    在 Claude API 中使用 Skills
  </Card>
  <Card
    title="在 Claude Code 中使用 Skills"
    icon="terminal"
    href="https://code.claude.com/docs/en/skills"
  >
    在 Claude Code 中创建和管理自定义 Skills
  </Card>
  <Card
    title="编写最佳实践"
    icon="lightbulb"
    href="/docs/zh-CN/agents-and-tools/agent-skills/best-practices"
  >
    编写 Claude 能够有效使用的 Skills
  </Card>
</CardGroup>