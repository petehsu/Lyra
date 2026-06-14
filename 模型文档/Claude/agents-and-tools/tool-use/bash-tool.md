# Bash 工具

---

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

Bash 工具使 Claude 能够在持久化的 bash 会话中执行 shell 命令，从而实现系统操作、脚本执行和命令行自动化。Shell 访问是一项基础性的智能体能力。在 [Terminal-Bench 2.0](https://github.com/terminal-bench/terminal-bench)（一个使用纯 shell 验证来评估真实终端任务的基准测试）中，Claude 在拥有持久化 bash 会话访问权限时表现出显著的性能提升。

## 概述 \{#overview}

Bash 工具为 Claude 提供：
- 保持状态的持久化 bash 会话
- 运行任何 shell 命令的能力
- 访问环境变量和工作目录
- 命令链式调用和脚本编写能力

有关模型支持情况，请参阅[工具参考](/docs/zh-CN/agents-and-tools/tool-use/tool-reference)。

## 使用场景 \{#use-cases}

- **开发工作流：** 运行构建命令、测试和开发工具
- **系统自动化：** 执行脚本、管理文件、自动化任务
- **数据处理：** 处理文件、运行分析脚本、管理数据集
- **环境配置：** 安装软件包、配置环境

## 快速开始 \{#quick-start}

<CodeGroup>
```bash cURL
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 1024,
    "tools": [
      {
        "type": "bash_20250124",
        "name": "bash"
      }
    ],
    "messages": [
      {
        "role": "user",
        "content": "List all Python files in the current directory."
      }
    ]
  }'
```

```bash CLI
ant messages create \
  --model claude-opus-4-8 \
  --max-tokens 1024 \
  --tool '{type: bash_20250124, name: bash}' \
  --message '{role: user, content: List all Python files in the current directory.}'
```

```python Python
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=[{"type": "bash_20250124", "name": "bash"}],
    messages=[
        {"role": "user", "content": "List all Python files in the current directory."}
    ],
)

print(response)
```

```typescript TypeScript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [{ type: "bash_20250124", name: "bash" }],
  messages: [
    {
      role: "user",
      content: "List all Python files in the current directory."
    }
  ]
});

console.log(response);
```

```csharp C#
using Anthropic;
using Anthropic.Models.Messages;

var client = new AnthropicClient();

var response = await client.Messages.Create(
    new()
    {
        Model = Model.ClaudeOpus4_8,
        MaxTokens = 1024,
        Tools = [new ToolBash20250124()],
        Messages =
        [
            new()
            {
                Role = Role.User,
                Content = "List all Python files in the current directory.",
            },
        ],
    }
);

Console.WriteLine(response);
```

```go Go hidelines={1..10,-1}
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
		MaxTokens: 1024,
		Tools: []anthropic.ToolUnionParam{
			{OfBashTool20250124: &anthropic.ToolBash20250124Param{}},
		},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("List all Python files in the current directory.")),
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println(response)
}
```

```java Java
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.ToolBash20250124;

void main() {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    Message response = client.messages().create(
        MessageCreateParams.builder()
            .model(Model.CLAUDE_OPUS_4_8)
            .maxTokens(1024)
            .addTool(ToolBash20250124.builder().build())
            .addUserMessage("List all Python files in the current directory.")
            .build()
    );

    IO.println(response);
}
```

```php PHP hidelines={1}
<?php

use Anthropic\Client;
use Anthropic\Messages\ToolBash20250124;

$client = new Client();

$response = $client->messages->create(
    model: 'claude-opus-4-8',
    maxTokens: 1024,
    tools: [new ToolBash20250124()],
    messages: [
        ['role' => 'user', 'content' => 'List all Python files in the current directory.'],
    ],
);

echo $response;
```

```ruby Ruby
require "anthropic"

client = Anthropic::Client.new

response = client.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [{type: "bash_20250124", name: "bash"}],
  messages: [
    {role: "user", content: "List all Python files in the current directory."}
  ]
)

puts response
```
</CodeGroup>

## 工作原理 \{#how-it-works}

Bash 工具维护一个持久化会话：

1. Claude 确定要运行的命令
2. 您在 bash shell 中执行该命令
3. 将输出（stdout 和 stderr）返回给 Claude
4. 会话状态在命令之间保持（环境变量、工作目录）

## 参数 \{#parameters}

| 参数 | 必需 | 描述 |
|-----------|----------|-------------|
| `command` | 是* | 要运行的 bash 命令 |
| `restart` | 否 | 设置为 `true` 以重启 bash 会话 |

*除非使用 `restart`，否则为必需

<section title="使用示例">

运行命令：

```json
{
  "command": "ls -la *.py"
}
```

重启会话：

```json
{
  "restart": true
}
```

</section>

## 示例：多步骤自动化 \{#example-multi-step-automation}

Claude 可以链式调用命令来完成复杂任务：

```text nowrap
User request:
"Install the requests library and create a simple Python script that
fetches a joke from an API, then run it."

Claude's tool uses:
1. Install package
   {"command": "pip install requests"}

2. Create script
   {"command": "cat > fetch_joke.py << 'EOF'\nimport requests\nresponse = requests.get('https://official-joke-api.appspot.com/random_joke')\njoke = response.json()\nprint(f\"Setup: {joke['setup']}\")\nprint(f\"Punchline: {joke['punchline']}\")\nEOF"}

3. Run script
   {"command": "python fetch_joke.py"}
```

会话在命令之间保持状态，因此在步骤 2 中创建的文件在步骤 3 中可用。

## 实现 bash 工具 \{#implement-the-bash-tool}

Bash 工具作为无模式（schema-less）工具实现。使用此工具时，您无需像其他工具那样提供输入模式；该模式已内置于 Claude 的模型中，无法修改。

<Steps>
  <Step title="设置 bash 环境">
    创建一个 Claude 可以与之交互的持久化 bash 会话：
    ```python hidelines={-2..-1}
    import subprocess
    import threading
    import queue


    class BashSession:
        def __init__(self):
            self.process = subprocess.Popen(
                ["/bin/bash"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=0,
            )
            self.output_queue = queue.Queue()
            self.error_queue = queue.Queue()
            self._start_readers()

        def _start_readers(self): ...
    ```
  </Step>
  <Step title="处理命令执行">
    创建一个函数来执行命令并捕获输出：
    ```python hidelines={1..2,-1}
    class BashSession:
        def _read_output(self, timeout): ...
        def execute_command(self, command):
            # 向 bash 发送命令
            self.process.stdin.write(command + "\n")
            self.process.stdin.flush()

            # 在超时限制内捕获输出
            output = self._read_output(timeout=10)
            return output

        process = None
    ```
  </Step>
  <Step title="处理 Claude 的工具调用">
    从 Claude 的响应中提取并执行命令：
    ```python hidelines={1..6}
    from types import SimpleNamespace as _SN

    response = _SN(
        content=[_SN(type="tool_use", name="bash", input={"command": "ls"}, id="toolu_01")]
    )
    bash_session = _SN(restart=lambda: None, execute_command=lambda c: "output")
    for content in response.content:
        if content.type == "tool_use" and content.name == "bash":
            if content.input.get("restart"):
                bash_session.restart()
                result = "Bash session restarted"
            else:
                command = content.input.get("command")
                result = bash_session.execute_command(command)

            # 将结果返回给 Claude
            tool_result = {
                "type": "tool_result",
                "tool_use_id": content.id,
                "content": result,
            }
    ```
  </Step>
  <Step title="实施安全措施">
    添加验证和限制。使用允许列表（allowlist）而非阻止列表（blocklist），因为阻止列表很容易被绕过。拒绝 shell 操作符，以防止链式命令绕过允许列表：
    ```python
    import shlex

    ALLOWED_COMMANDS = {"ls", "cat", "echo", "pwd", "grep", "find", "wc", "head", "tail"}
    SHELL_OPERATORS = {"&&", "||", "|", ";", "&", ">", "<", ">>"}


    def validate_command(command):
        # 仅允许明确允许列表中的命令
        try:
            tokens = shlex.split(command)
        except ValueError:
            return False, "Could not parse command"

        if not tokens:
            return False, "Empty command"

        executable = tokens[0]
        if executable not in ALLOWED_COMMANDS:
            return False, f"Command '{executable}' is not in the allowlist"

        # 拒绝会串联额外命令的 shell 运算符
        for token in tokens[1:]:
            if token in SHELL_OPERATORS or token.startswith(("$", "`")):
                return False, f"Shell operator '{token}' is not allowed"

        return True, None
    ```
    此检查是第一道防线。为了实现更强的隔离，请使用 `shell=False` 运行已验证的命令，并将 `shlex.split(command)` 作为参数列表传递，这样 shell 就不会解释该字符串。
  </Step>
</Steps>

### 处理错误 \{#handle-errors}

在实现 bash 工具时，请处理各种错误场景：

<section title="命令执行超时">

如果命令执行时间过长：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "Error: Command timed out after 30 seconds",
      "is_error": true
    }
  ]
}
```

</section>

<section title="命令未找到">

如果命令不存在：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "bash: nonexistentcommand: command not found",
      "is_error": true
    }
  ]
}
```

</section>

<section title="权限被拒绝">

如果存在权限问题：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "bash: /root/sensitive-file: Permission denied",
      "is_error": true
    }
  ]
}
```

</section>

### 遵循实现最佳实践 \{#follow-implementation-best-practices}

<section title="使用命令超时">

实现超时机制以防止命令挂起：
```python hidelines={1..3}
import subprocess


def execute_with_timeout(command, timeout=30):
    try:
        result = subprocess.run(
            command, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return f"Command timed out after {timeout} seconds"
```

</section>

<section title="维护会话状态">

保持 bash 会话持久化，以维护环境变量和工作目录：
```python
# 在同一会话中运行的命令会保持状态
commands = [
    "cd /tmp",
    "echo 'Hello' > test.txt",
    "cat test.txt",  # This works because we're still in /tmp
]
```

</section>

<section title="处理大型输出">

截断非常大的输出以防止令牌限制问题：
```python
def truncate_output(output, max_lines=100):
    lines = output.split("\n")
    if len(lines) > max_lines:
        truncated = "\n".join(lines[:max_lines])
        return f"{truncated}\n\n... Output truncated ({len(lines)} total lines) ..."
    return output
```

</section>

<section title="记录所有命令">

保留已执行命令的审计记录：
```python
import logging


def log_command(command, output, user_id):
    logging.info(f"User {user_id} executed: {command}")
    logging.info(f"Output: {output[:200]}...")  # Log first 200 chars
```

</section>

<section title="清理输出">

从命令输出中移除敏感信息：
```python
def sanitize_output(output):
    # 移除潜在的密钥或凭证
    import re

    # 示例：移除 AWS 凭证
    output = re.sub(r"aws_access_key_id\s*=\s*\S+", "aws_access_key_id=***", output)
    output = re.sub(
        r"aws_secret_access_key\s*=\s*\S+", "aws_secret_access_key=***", output
    )
    return output
```

</section>

## 安全性 \{#security}

<Warning>
Bash 工具提供直接的系统访问权限。请实施以下基本安全措施：
- 在隔离环境（Docker/虚拟机）中运行
- 实施命令过滤和允许列表
- 设置资源限制（CPU、内存、磁盘）
- 记录所有已执行的命令
</Warning>

### 关键建议 \{#key-recommendations}
- 使用 `ulimit` 设置资源约束
- 过滤危险命令（`sudo`、`rm -rf` 等）
- 以最小用户权限运行
- 监控并记录所有命令执行

## 定价 \{#pricing}

bash 工具会为您的 API 调用增加 **245 个输入令牌**。

以下内容会消耗额外的令牌：
- 命令输出（stdout/stderr）
- 错误消息
- 大型文件内容

有关完整的定价详情，请参阅[工具使用定价](/docs/zh-CN/agents-and-tools/tool-use/overview#pricing)。

## 常见模式 \{#common-patterns}

### 开发工作流 \{#development-workflows}
- 运行测试：`pytest && coverage report`
- 构建项目：`npm install && npm run build`
- Git 操作：`git status && git add . && git commit -m "message"`

#### 基于 Git 的检查点 \{#git-based-checkpointing}

在长时间运行的智能体工作流中，Git 作为一种结构化的恢复机制，而不仅仅是保存更改的方式：

- **捕获基线：** 在任何智能体工作开始之前，提交当前状态。这是已知良好的起点。
- **按功能提交：** 每个完成的功能都有自己的提交。如果之后出现问题，这些提交可作为回滚点。
- **在会话开始时重建状态：** 结合进度文件读取 `git log`，以了解已完成的工作和接下来的任务。
- **失败时回退：** 如果工作出现问题，使用 `git checkout` 回退到最后一个良好的提交，而不是尝试调试损坏的状态。

### 文件操作 \{#file-operations}
- 处理数据：`wc -l *.csv && ls -lh *.csv`
- 搜索文件：`find . -name "*.py" | xargs grep "pattern"`
- 创建备份：`tar -czf backup.tar.gz ./data`

### 系统任务 \{#system-tasks}
- 检查资源：`df -h && free -m`
- 进程管理：`ps aux | grep python`
- 环境配置：`export PATH=$PATH:/new/path && echo $PATH`

## 限制 \{#limitations}

- **不支持交互式命令：** 无法处理 `vim`、`less` 或密码提示
- **不支持 GUI 应用程序：** 仅限命令行
- **会话范围：** Bash 会话状态位于客户端。API 是无状态的。您的应用程序负责在多轮对话之间维护 shell 会话。
- **输出限制：** 大型输出可能会被截断
- **不支持流式传输：** 结果在完成后返回

## 与其他工具结合使用 \{#combining-with-other-tools}

Bash 工具与[文本编辑器](/docs/zh-CN/agents-and-tools/tool-use/text-editor-tool)和其他工具结合使用时最为强大。

<Note>
如果您同时使用[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)，Claude 将可以访问两个独立的执行环境：您的本地 bash 会话和 Anthropic 的沙盒容器。这两个环境之间不共享状态。有关如何提示 Claude 区分不同环境的指导，请参阅[将代码执行与其他执行工具结合使用](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool#using-code-execution-with-other-execution-tools)。
</Note>

## 后续步骤 \{#next-steps}

<CardGroup cols={2}>
  <Card
    title="工具使用概述"
    icon="tool"
    href="/docs/zh-CN/agents-and-tools/tool-use/overview"
  >
    了解如何通过 Claude 进行工具使用
  </Card>

  <Card
    title="文本编辑器工具"
    icon="file"
    href="/docs/zh-CN/agents-and-tools/tool-use/text-editor-tool"
  >
    使用 Claude 查看和编辑文本文件
  </Card>
</CardGroup>