# 文本编辑器工具

---

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

Claude 可以使用 Anthropic 定义模式的文本编辑器工具来查看和修改文本文件，帮助您调试、修复和改进代码或其他文本文档。这使 Claude 能够直接与您的文件交互，提供实际操作的协助，而不仅仅是建议更改。

有关模型支持信息，请参阅[工具参考](/docs/zh-CN/agents-and-tools/tool-use/tool-reference)。

## 何时使用文本编辑器工具 \{#when-to-use-the-text-editor-tool}

以下是一些使用文本编辑器工具的示例场景：
- **代码调试：** 让 Claude 识别并修复代码中的错误，从语法错误到逻辑问题。
- **代码重构：** 让 Claude 通过有针对性的编辑来改进代码结构、可读性和性能。
- **文档生成：** 让 Claude 为您的代码库添加文档字符串、注释或 README 文件。
- **测试创建：** 让 Claude 根据其对实现的理解为您的代码创建单元测试。

## 使用文本编辑器工具 \{#use-the-text-editor-tool}

使用 Messages API 向 Claude 提供文本编辑器工具（名为 `str_replace_based_edit_tool`）。

您可以选择指定 `max_characters` 参数，以在查看大文件时控制截断行为。

<Note>
`max_characters` 仅与 `text_editor_20250728` 及更高版本的文本编辑器工具兼容。
</Note>

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
        "type": "text_editor_20250728",
        "name": "str_replace_based_edit_tool",
        "max_characters": 10000
      }
    ],
    "messages": [
      {
        "role": "user",
        "content": "There'\''s a syntax error in my primes.py file. Can you help me fix it?"
      }
    ]
  }'
```

```bash CLI
ant messages create \
  --model claude-opus-4-8 \
  --max-tokens 1024 \
  --tool '{type: text_editor_20250728, name: str_replace_based_edit_tool, max_characters: 10000}' \
  --message '{role: user, content: There is a syntax error in my primes.py file. Can you help me fix it?}'
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=[
        {
            "type": "text_editor_20250728",
            "name": "str_replace_based_edit_tool",
            "max_characters": 10000,
        }
    ],
    messages=[
        {
            "role": "user",
            "content": "There's a syntax error in my primes.py file. Can you help me fix it?",
        }
    ],
)

print(response)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const response = await anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      type: "text_editor_20250728",
      name: "str_replace_based_edit_tool",
      max_characters: 10000
    }
  ],
  messages: [
    {
      role: "user",
      content: "There's a syntax error in my primes.py file. Can you help me fix it?"
    }
  ]
});

console.log(response);
```

```java Java hidelines={1..5,7..8,-1..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.ToolTextEditor20250728;

void main() {
  AnthropicClient client = AnthropicOkHttpClient.fromEnv();

  ToolTextEditor20250728 editorTool =
    ToolTextEditor20250728.builder()
      .maxCharacters(10000L)
      .build();

  MessageCreateParams params = MessageCreateParams.builder()
    .model(Model.CLAUDE_OPUS_4_8)
    .maxTokens(1024)
    .addTool(editorTool)
    .addUserMessage("There's a syntax error in my primes.py file. Can you help me fix it?")
    .build();

  Message message = client.messages().create(params);
  IO.println(message);
}
```
</CodeGroup>

文本编辑器工具可以按以下方式使用：

<Steps>
  <Step title="向 Claude 提供文本编辑器工具和用户提示">
    - 在您的 API 请求中包含文本编辑器工具
    - 提供可能需要检查或修改文件的用户提示，例如"您能修复我代码中的语法错误吗？"
  </Step>
  <Step title="Claude 使用该工具检查文件或目录">
    - Claude 评估需要查看的内容，并使用 `view` 命令检查文件内容或列出目录内容
    - API 响应将包含带有 `view` 命令的 `tool_use` 内容块
  </Step>
  <Step title="执行 view 命令并返回结果">
    - 从 Claude 的工具使用请求中提取文件或目录路径
    - 读取文件内容或列出目录内容
    - 如果在工具配置中指定了 `max_characters` 参数，则将文件内容截断至该长度
    - 通过继续对话并发送包含 `tool_result` 内容块的新 `user` 消息，将结果返回给 Claude
  </Step>
  <Step title="Claude 使用该工具修改文件">
    - 检查文件或目录后，Claude 可能会使用 `str_replace` 等命令进行更改，或使用 `insert` 在特定行号处添加文本。
    - 如果 Claude 使用 `str_replace` 命令，Claude 会构造一个格式正确的工具使用请求，其中包含旧文本和用于替换的新文本
  </Step>
  <Step title="执行编辑并返回结果">
    - 从 Claude 的工具使用请求中提取文件路径、旧文本和新文本
    - 在文件中执行文本替换
    - 将结果返回给 Claude
  </Step>
  <Step title="Claude 提供分析和解释">
    - 在检查并可能编辑文件后，Claude 会提供关于其发现的内容和所做更改的完整解释
  </Step>
</Steps>

### 文本编辑器工具命令 \{#text-editor-tool-commands}

文本编辑器工具支持多个用于查看和修改文件的命令：

#### view \{#view}

`view` 命令允许 Claude 检查文件内容或列出目录内容。它可以读取整个文件或特定范围的行。

参数：
- `command`：必须为 "view"
- `path`：要查看的文件或目录的路径
- `view_range`（可选）：由两个整数组成的数组，指定要查看的起始和结束行号。行号从 1 开始索引，结束行为 -1 表示读取到文件末尾。此参数仅在查看文件时适用，不适用于目录。

<section title="view 命令示例">

查看文件的示例：

```json
{
  "type": "tool_use",
  "id": "toolu_01A09q90qw90lq917835lq9",
  "name": "str_replace_based_edit_tool",
  "input": {
    "command": "view",
    "path": "primes.py"
  }
}
```

查看目录的示例：

```json
{
  "type": "tool_use",
  "id": "toolu_02B19r91rw91mr917835mr9",
  "name": "str_replace_based_edit_tool",
  "input": {
    "command": "view",
    "path": "src/"
  }
}
```

</section>

#### str_replace \{#str-replace}

`str_replace` 命令允许 Claude 将文件中的特定字符串替换为新字符串。这用于进行精确的编辑。

参数：
- `command`：必须为 "str_replace"
- `path`：要修改的文件的路径
- `old_str`：要替换的文本（必须完全匹配，包括空白字符和缩进）
- `new_str`：用于替换旧文本的新文本

<section title="str_replace 命令示例">

```json
{
  "type": "tool_use",
  "id": "toolu_01A09q90qw90lq917835lq9",
  "name": "str_replace_based_edit_tool",
  "input": {
    "command": "str_replace",
    "path": "primes.py",
    "old_str": "for num in range(2, limit + 1)",
    "new_str": "for num in range(2, limit + 1):"
  }
}
```

</section>

#### create \{#create}

`create` 命令允许 Claude 创建包含指定内容的新文件。

参数：
- `command`：必须为 "create"
- `path`：应创建新文件的路径
- `file_text`：要写入新文件的内容

<section title="create 命令示例">

```json
{
  "type": "tool_use",
  "id": "toolu_01A09q90qw90lq917835lq9",
  "name": "str_replace_based_edit_tool",
  "input": {
    "command": "create",
    "path": "test_primes.py",
    "file_text": "import unittest\nimport primes\n\nclass TestPrimes(unittest.TestCase):\n    def test_is_prime(self):\n        self.assertTrue(primes.is_prime(2))\n        self.assertTrue(primes.is_prime(3))\n        self.assertFalse(primes.is_prime(4))\n\nif __name__ == '__main__':\n    unittest.main()"
  }
}
```

</section>

#### insert \{#insert}

`insert` 命令允许 Claude 在文件的特定位置插入文本。

参数：
- `command`：必须为 "insert"
- `path`：要修改的文件的路径
- `insert_line`：在其后插入文本的行号（0 表示文件开头）
- `insert_text`：要插入的文本

<section title="insert 命令示例">

```json
{
  "type": "tool_use",
  "id": "toolu_01A09q90qw90lq917835lq9",
  "name": "str_replace_based_edit_tool",
  "input": {
    "command": "insert",
    "path": "primes.py",
    "insert_line": 0,
    "insert_text": "\"\"\"Module for working with prime numbers.\n\nThis module provides functions to check if a number is prime\nand to generate a list of prime numbers up to a given limit.\n\"\"\"\n"
  }
}
```

</section>

### 示例：使用文本编辑器工具修复语法错误 \{#example-fixing-a-syntax-error-with-the-text-editor-tool}

此示例演示 Claude 如何使用文本编辑器工具修复 Python 文件中的语法错误。

首先，您的应用程序向 Claude 提供文本编辑器工具和修复语法错误的提示：

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
        "type": "text_editor_20250728",
        "name": "str_replace_based_edit_tool"
      }
    ],
    "messages": [
      {
        "role": "user",
        "content": "There'\''s a syntax error in my primes.py file. Can you help me fix it?"
      }
    ]
  }'
```

```bash CLI
ant messages create \
  --model claude-opus-4-8 \
  --max-tokens 1024 \
  --tool '{type: text_editor_20250728, name: str_replace_based_edit_tool}' \
  --message '{role: user, content: There is a syntax error in my primes.py file. Can you help me fix it?}'
```

```python Python hidelines={1..2}
import anthropic

client = anthropic.Anthropic()

response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=[{"type": "text_editor_20250728", "name": "str_replace_based_edit_tool"}],
    messages=[
        {
            "role": "user",
            "content": "There's a syntax error in my primes.py file. Can you help me fix it?",
        }
    ],
)

print(response)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const response = await anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      type: "text_editor_20250728",
      name: "str_replace_based_edit_tool"
    }
  ],
  messages: [
    {
      role: "user",
      content: "There's a syntax error in my primes.py file. Can you help me fix it?"
    }
  ]
});

console.log(response);
```

```java Java hidelines={1..5,7..8,-1..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.ToolTextEditor20250728;

void main() {
  AnthropicClient client = AnthropicOkHttpClient.fromEnv();

  ToolTextEditor20250728 editorTool =
    ToolTextEditor20250728.builder().build();

  MessageCreateParams params = MessageCreateParams.builder()
    .model(Model.CLAUDE_OPUS_4_8)
    .maxTokens(1024)
    .addTool(editorTool)
    .addUserMessage("There's a syntax error in my primes.py file. Can you help me fix it?")
    .build();

  Message message = client.messages().create(params);
  IO.println(message);
}
```
</CodeGroup>

Claude 首先使用文本编辑器工具查看文件：

```json Output
{
  "id": "msg_01XAbCDeFgHiJkLmNoPQrStU",
  "model": "claude-opus-4-8",
  "stop_reason": "tool_use",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I'll help you fix the syntax error in your primes.py file. First, let me take a look at the file to identify the issue."
    },
    {
      "type": "tool_use",
      "id": "toolu_01AbCdEfGhIjKlMnOpQrStU",
      "name": "str_replace_based_edit_tool",
      "input": {
        "command": "view",
        "path": "primes.py"
      }
    }
  ]
}
```

然后，您的应用程序应读取该文件并将其内容返回给 Claude：

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
        "type": "text_editor_20250728",
        "name": "str_replace_based_edit_tool"
      }
    ],
    "messages": [
      {
        "role": "user",
        "content": "There'\''s a syntax error in my primes.py file. Can you help me fix it?"
      },
      {
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "I'\''ll help you fix the syntax error in your primes.py file. First, let me take a look at the file to identify the issue."
                },
                {
                    "type": "tool_use",
                    "id": "toolu_01AbCdEfGhIjKlMnOpQrStU",
                    "name": "str_replace_based_edit_tool",
                    "input": {
                        "command": "view",
                        "path": "primes.py"
                    }
                }
            ]
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_01AbCdEfGhIjKlMnOpQrStU",
                    "content": "1: def is_prime(n):\n2:     \"\"\"Check if a number is prime.\"\"\"\n3:     if n <= 1:\n4:         return False\n5:     if n <= 3:\n6:         return True\n7:     if n % 2 == 0 or n % 3 == 0:\n8:         return False\n9:     i = 5\n10:     while i * i <= n:\n11:         if n % i == 0 or n % (i + 2) == 0:\n12:             return False\n13:         i += 6\n14:     return True\n15: \n16: def get_primes(limit):\n17:     \"\"\"Generate a list of prime numbers up to the given limit.\"\"\"\n18:     primes = []\n19:     for num in range(2, limit + 1)\n20:         if is_prime(num):\n21:             primes.append(num)\n22:     return primes\n23: \n24: def main():\n25:     \"\"\"Main function to demonstrate prime number generation.\"\"\"\n26:     limit = 100\n27:     prime_list = get_primes(limit)\n28:     print(f\"Prime numbers up to {limit}:\")\n29:     print(prime_list)\n30:     print(f\"Found {len(prime_list)} prime numbers.\")\n31: \n32: if __name__ == \"__main__\":\n33:     main()"
                }
            ]
        }
    ]
  }'
```

```bash CLI
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
tools:
  - type: text_editor_20250728
    name: str_replace_based_edit_tool
messages:
  - role: user
    content: There's a syntax error in my primes.py file. Can you help me fix it?
  - role: assistant
    content:
      - type: text
        text: >-
          I'll help you fix the syntax error in your primes.py file. First,
          let me take a look at the file to identify the issue.
      - type: tool_use
        id: toolu_01AbCdEfGhIjKlMnOpQrStU
        name: str_replace_based_edit_tool
        input:
          command: view
          path: primes.py
  - role: user
    content:
      - type: tool_result
        tool_use_id: toolu_01AbCdEfGhIjKlMnOpQrStU
        content: |-
          1: def is_prime(n):
          2:     """Check if a number is prime."""
          3:     if n <= 1:
          4:         return False
          5:     if n <= 3:
          6:         return True
          7:     if n % 2 == 0 or n % 3 == 0:
          8:         return False
          9:     i = 5
          10:     while i * i <= n:
          11:         if n % i == 0 or n % (i + 2) == 0:
          12:             return False
          13:         i += 6
          14:     return True
          15:
          16: def get_primes(limit):
          17:     """Generate a list of prime numbers up to the given limit."""
          18:     primes = []
          19:     for num in range(2, limit + 1)
          20:         if is_prime(num):
          21:             primes.append(num)
          22:     return primes
          23:
          24: def main():
          25:     """Main function to demonstrate prime number generation."""
          26:     limit = 100
          27:     prime_list = get_primes(limit)
          28:     print(f"Prime numbers up to {limit}:")
          29:     print(prime_list)
          30:     print(f"Found {len(prime_list)} prime numbers.")
          31:
          32: if __name__ == "__main__":
          33:     main()
YAML
```

```python Python
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=[{"type": "text_editor_20250728", "name": "str_replace_based_edit_tool"}],
    messages=[
        {
            "role": "user",
            "content": "There's a syntax error in my primes.py file. Can you help me fix it?",
        },
        {
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "I'll help you fix the syntax error in your primes.py file. First, let me take a look at the file to identify the issue.",
                },
                {
                    "type": "tool_use",
                    "id": "toolu_01AbCdEfGhIjKlMnOpQrStU",
                    "name": "str_replace_based_edit_tool",
                    "input": {"command": "view", "path": "primes.py"},
                },
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_01AbCdEfGhIjKlMnOpQrStU",
                    "content": '1: def is_prime(n):\n2:     """Check if a number is prime."""\n3:     if n <= 1:\n4:         return False\n5:     if n <= 3:\n6:         return True\n7:     if n % 2 == 0 or n % 3 == 0:\n8:         return False\n9:     i = 5\n10:     while i * i <= n:\n11:         if n % i == 0 or n % (i + 2) == 0:\n12:             return False\n13:         i += 6\n14:     return True\n15: \n16: def get_primes(limit):\n17:     """Generate a list of prime numbers up to the given limit."""\n18:     primes = []\n19:     for num in range(2, limit + 1)\n20:         if is_prime(num):\n21:             primes.append(num)\n22:     return primes\n23: \n24: def main():\n25:     """Main function to demonstrate prime number generation."""\n26:     limit = 100\n27:     prime_list = get_primes(limit)\n28:     print(f"Prime numbers up to {limit}:")\n29:     print(prime_list)\n30:     print(f"Found {len(prime_list)} prime numbers.")\n31: \n32: if __name__ == "__main__":\n33:     main()',
                }
            ],
        },
    ],
)

print(response)
```

```typescript TypeScript hidelines={1..2}
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const response = await anthropic.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      type: "text_editor_20250728",
      name: "str_replace_based_edit_tool"
    }
  ],
  messages: [
    {
      role: "user",
      content: "There's a syntax error in my primes.py file. Can you help me fix it?"
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I'll help you fix the syntax error in your primes.py file. First, let me take a look at the file to identify the issue."
        },
        {
          type: "tool_use",
          id: "toolu_01AbCdEfGhIjKlMnOpQrStU",
          name: "str_replace_based_edit_tool",
          input: {
            command: "view",
            path: "primes.py"
          }
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_01AbCdEfGhIjKlMnOpQrStU",
          content:
            '1: def is_prime(n):\n2:     """Check if a number is prime."""\n3:     if n <= 1:\n4:         return False\n5:     if n <= 3:\n6:         return True\n7:     if n % 2 == 0 or n % 3 == 0:\n8:         return False\n9:     i = 5\n10:     while i * i <= n:\n11:         if n % i == 0 or n % (i + 2) == 0:\n12:             return False\n13:         i += 6\n14:     return True\n15: \n16: def get_primes(limit):\n17:     """Generate a list of prime numbers up to the given limit."""\n18:     primes = []\n19:     for num in range(2, limit + 1)\n20:         if is_prime(num):\n21:             primes.append(num)\n22:     return primes\n23: \n24: def main():\n25:     """Main function to demonstrate prime number generation."""\n26:     limit = 100\n27:     prime_list = get_primes(limit)\n28:     print(f"Prime numbers up to {limit}:")\n29:     print(prime_list)\n30:     print(f"Found {len(prime_list)} prime numbers.")\n31: \n32: if __name__ == "__main__":\n33:     main()'
        }
      ]
    }
  ]
});

console.log(response);
```

```java Java hidelines={1..9,11..16,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import com.anthropic.models.messages.ToolResultBlockParam;
import com.anthropic.models.messages.ToolTextEditor20250728;
import com.anthropic.models.messages.ToolUseBlockParam;
import java.util.List;

public class TextEditorToolResultExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .maxTokens(1024)
      .addTool(ToolTextEditor20250728.builder().build())
      .addUserMessage("There's a syntax error in my primes.py file. Can you help me fix it?")
      .addAssistantMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofText(
            TextBlockParam.builder()
              .text("I'll help you fix the syntax error in your primes.py file. First, let me take a look at the file to identify the issue.")
              .build()
          ),
          ContentBlockParam.ofToolUse(
            ToolUseBlockParam.builder()
              .id("toolu_01AbCdEfGhIjKlMnOpQrStU")
              .name("str_replace_based_edit_tool")
              .input(
                ToolUseBlockParam.Input.builder()
                  .putAdditionalProperty("command", JsonValue.from("view"))
                  .putAdditionalProperty("path", JsonValue.from("primes.py"))
                  .build()
              )
              .build()
          )
        )
      )
      .addUserMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofToolResult(
            ToolResultBlockParam.builder()
              .toolUseId("toolu_01AbCdEfGhIjKlMnOpQrStU")
              .content("1: def is_prime(n):\n2:     \"\"\"Check if a number is prime.\"\"\"\n3:     if n <= 1:\n4:         return False\n5:     if n <= 3:\n6:         return True\n7:     if n % 2 == 0 or n % 3 == 0:\n8:         return False\n9:     i = 5\n10:     while i * i <= n:\n11:         if n % i == 0 or n % (i + 2) == 0:\n12:             return False\n13:         i += 6\n14:     return True\n15: \n16: def get_primes(limit):\n17:     \"\"\"Generate a list of prime numbers up to the given limit.\"\"\"\n18:     primes = []\n19:     for num in range(2, limit + 1)\n20:         if is_prime(num):\n21:             primes.append(num)\n22:     return primes\n23: \n24: def main():\n25:     \"\"\"Main function to demonstrate prime number generation.\"\"\"\n26:     limit = 100\n27:     prime_list = get_primes(limit)\n28:     print(f\"Prime numbers up to {limit}:\")\n29:     print(prime_list)\n30:     print(f\"Found {len(prime_list)} prime numbers.\")\n31: \n32: if __name__ == \"__main__\":\n33:     main()")
              .build()
          )
        )
      )
      .build();

    Message message = client.messages().create(params);
    System.out.println(message);
  }
}
```
</CodeGroup>

<Tip>
**行号**

在上面的示例中，`view` 工具结果包含每行前面带有行号的文件内容（例如，"1: def is_prime(n):"）。行号不是必需的，但对于成功使用 `view_range` 参数检查文件的特定部分以及使用 `insert_line` 参数在精确位置添加内容至关重要。
</Tip>

Claude 识别出语法错误并使用 `str_replace` 命令修复它：

```json Output
{
  "id": "msg_01VwXyZAbCdEfGhIjKlMnO",
  "model": "claude-opus-4-8",
  "stop_reason": "tool_use",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I found the syntax error in your primes.py file. In the `get_primes` function, there is a missing colon (:) at the end of the for loop line. Let me fix that for you."
    },
    {
      "type": "tool_use",
      "id": "toolu_01PqRsTuVwXyZAbCdEfGh",
      "name": "str_replace_based_edit_tool",
      "input": {
        "command": "str_replace",
        "path": "primes.py",
        "old_str": "    for num in range(2, limit + 1)",
        "new_str": "    for num in range(2, limit + 1):"
      }
    }
  ]
}
```

然后，您的应用程序应执行编辑并返回结果：

<CodeGroup>

```bash CLI nocheck
ant messages create <<'YAML'
model: claude-opus-4-8
max_tokens: 1024
tools:
  - type: text_editor_20250728
    name: str_replace_based_edit_tool
messages:
  # 之前的消息...
  - role: assistant
    content:
      - type: text
        text: >-
          I found the syntax error in your primes.py file. In the `get_primes`
          function, there is a missing colon (:) at the end of the for loop
          line. Let me fix that for you.
      - type: tool_use
        id: toolu_01PqRsTuVwXyZAbCdEfGh
        name: str_replace_based_edit_tool
        input:
          command: str_replace
          path: primes.py
          old_str: "    for num in range(2, limit + 1)"
          new_str: "    for num in range(2, limit + 1):"
  - role: user
    content:
      - type: tool_result
        tool_use_id: toolu_01PqRsTuVwXyZAbCdEfGh
        content: Successfully replaced text at exactly one location.
YAML
```

```python Python
response = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=1024,
    tools=[{"type": "text_editor_20250728", "name": "str_replace_based_edit_tool"}],
    messages=[
        # 之前的消息...
        {
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "I found the syntax error in your primes.py file. In the `get_primes` function, there is a missing colon (:) at the end of the for loop line. Let me fix that for you.",
                },
                {
                    "type": "tool_use",
                    "id": "toolu_01PqRsTuVwXyZAbCdEfGh",
                    "name": "str_replace_based_edit_tool",
                    "input": {
                        "command": "str_replace",
                        "path": "primes.py",
                        "old_str": "    for num in range(2, limit + 1)",
                        "new_str": "    for num in range(2, limit + 1):",
                    },
                },
            ],
        },
        {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_01PqRsTuVwXyZAbCdEfGh",
                    "content": "Successfully replaced text at exactly one location.",
                }
            ],
        },
    ],
)

print(response)
```

```typescript TypeScript
const response = await client.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 1024,
  tools: [
    {
      type: "text_editor_20250728",
      name: "str_replace_based_edit_tool"
    }
  ],
  messages: [
    // 之前的消息...
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "I found the syntax error in your primes.py file. In the `get_primes` function, there is a missing colon (:) at the end of the for loop line. Let me fix that for you."
        },
        {
          type: "tool_use",
          id: "toolu_01PqRsTuVwXyZAbCdEfGh",
          name: "str_replace_based_edit_tool",
          input: {
            command: "str_replace",
            path: "primes.py",
            old_str: "    for num in range(2, limit + 1)",
            new_str: "    for num in range(2, limit + 1):"
          }
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_01PqRsTuVwXyZAbCdEfGh",
          content: "Successfully replaced text at exactly one location."
        }
      ]
    }
  ]
});

console.log(response);
```

```java Java hidelines={1..9,11..16,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.models.messages.ContentBlockParam;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.Model;
import com.anthropic.models.messages.TextBlockParam;
import com.anthropic.models.messages.ToolResultBlockParam;
import com.anthropic.models.messages.ToolTextEditor20250728;
import com.anthropic.models.messages.ToolUseBlockParam;
import java.util.List;

public class TextEditorConversationExample {

  public static void main(String[] args) {
    AnthropicClient client = AnthropicOkHttpClient.fromEnv();

    MessageCreateParams params = MessageCreateParams.builder()
      .model(Model.CLAUDE_OPUS_4_8)
      .maxTokens(1024)
      .addTool(ToolTextEditor20250728.builder().build())
      // 之前的消息将放在此处
      .addAssistantMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofText(
            TextBlockParam.builder()
              .text(
                "I found the syntax error in your primes.py file. In the `get_primes` function, there is a missing colon (:) at the end of the for loop line. Let me fix that for you."
              )
              .build()
          ),
          ContentBlockParam.ofToolUse(
            ToolUseBlockParam.builder()
              .id("toolu_01PqRsTuVwXyZAbCdEfGh")
              .name("str_replace_based_edit_tool")
              .input(
                ToolUseBlockParam.Input.builder()
                  .putAdditionalProperty("command", JsonValue.from("str_replace"))
                  .putAdditionalProperty("path", JsonValue.from("primes.py"))
                  .putAdditionalProperty(
                    "old_str",
                    JsonValue.from("    for num in range(2, limit + 1)")
                  )
                  .putAdditionalProperty(
                    "new_str",
                    JsonValue.from("    for num in range(2, limit + 1):")
                  )
                  .build()
              )
              .build()
          )
        )
      )
      .addUserMessageOfBlockParams(
        List.of(
          ContentBlockParam.ofToolResult(
            ToolResultBlockParam.builder()
              .toolUseId("toolu_01PqRsTuVwXyZAbCdEfGh")
              .content("Successfully replaced text at exactly one location.")
              .build()
          )
        )
      )
      .build();

    Message message = client.messages().create(params);
    System.out.println(message);
  }
}
```
</CodeGroup>

最后，Claude 提供关于修复的完整解释：

```json Output
{
  "id": "msg_01IjKlMnOpQrStUvWxYzAb",
  "model": "claude-opus-4-8",
  "stop_reason": "end_turn",
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I've fixed the syntax error in your primes.py file. The issue was in the `get_primes` function at line 19. There was a missing colon (:) at the end of the for loop line.\n\nHere's what I changed:\n\nFrom:\n```python\nfor num in range(2, limit + 1)\n```\n\nTo:\n```python\nfor num in range(2, limit + 1):\n```\n\nIn Python, a colon is required at the end of statements that start a new code block, such as for loops, if statements, function definitions, etc. Without the colon, Python raises a syntax error because it doesn't know where the code block begins.\n\nYour code should now run correctly. The function will properly generate a list of prime numbers up to the specified limit."
    }
  ]
}
```

## 实现文本编辑器工具 \{#implement-the-text-editor-tool}

文本编辑器工具是作为无模式（schema-less）工具实现的。使用此工具时，您不需要像其他工具那样提供输入模式；该模式已内置于 Claude 的模型中，无法修改。

对于 Claude 4 模型，工具类型为 `type: "text_editor_20250728"`。

<Steps>
  <Step title="初始化您的编辑器实现">
    创建辅助函数来处理文件操作，如读取、写入和修改文件。考虑实现备份功能以便从错误中恢复。
  </Step>
  <Step title="处理编辑器工具调用">
    创建一个函数，根据命令类型处理来自 Claude 的工具调用：
    ```python
    def handle_editor_tool(tool_call):
        input_params = tool_call.input
        command = input_params.get("command", "")
        file_path = input_params.get("path", "")

        if command == "view":
            # 读取并返回文件内容
            pass
        elif command == "str_replace":
            # 替换文件中的文本
            pass
        elif command == "create":
            # 创建新文件
            pass
        elif command == "insert":
            # 在指定位置插入文本
            pass
    ```
  </Step>
  <Step title="实施安全措施">
    添加验证和安全检查：
    - 验证文件路径以防止目录遍历
    - 在进行更改之前创建备份
    - 优雅地处理错误
    - 实施权限检查
  </Step>
  <Step title="处理 Claude 的响应">
    从 Claude 的响应中提取并处理工具调用：
    ```python hidelines={1..15}
    from types import SimpleNamespace as _SN

    response = _SN(
        content=[
            _SN(
                type="tool_use", name="str_replace_based_edit_tool", input={}, id="toolu_01"
            )
        ]
    )


    def handle_editor_tool(tc):
        return "ok"


    # 处理 Claude 响应中的工具使用
    for content in response.content:
        if content.type == "tool_use":
            # 根据命令执行工具
            result = handle_editor_tool(content)

            # 将结果返回给 Claude
            tool_result = {
                "type": "tool_result",
                "tool_use_id": content.id,
                "content": result,
            }
    ```
  </Step>
</Steps>

<Warning>
在实现文本编辑器工具时，请注意：

1. **安全性：** 该工具可以访问您的本地文件系统，因此请实施适当的安全措施。
2. **备份：** 在允许编辑重要文件之前，始终创建备份。
3. **验证：** 验证所有输入以防止意外更改。
4. **唯一匹配：** 确保替换操作仅匹配一个位置，以避免意外编辑。
</Warning>

### 处理错误 \{#handle-errors}

使用文本编辑器工具时，可能会发生各种错误。以下是处理这些错误的指导：

<section title="文件未找到">

如果 Claude 尝试查看或修改不存在的文件，请在 `tool_result` 中返回适当的错误消息：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "Error: File not found",
      "is_error": true
    }
  ]
}
```

</section>

<section title="替换时存在多个匹配项">

如果 Claude 的 `str_replace` 命令在文件中匹配到多个位置，请返回适当的错误消息：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "Error: Found 3 matches for replacement text. Please provide more context to make a unique match.",
      "is_error": true
    }
  ]
}
```

</section>

<section title="替换时没有匹配项">

如果 Claude 的 `str_replace` 命令在文件中没有匹配到任何文本，请返回适当的错误消息：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "Error: No match found for replacement. Please check your text and try again.",
      "is_error": true
    }
  ]
}
```

</section>

<section title="权限错误">

如果在创建、读取或修改文件时存在权限问题，请返回适当的错误消息：

```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A09q90qw90lq917835lq9",
      "content": "Error: Permission denied. Cannot write to file.",
      "is_error": true
    }
  ]
}
```

</section>

### 遵循实现最佳实践 \{#follow-implementation-best-practices}

<section title="提供清晰的上下文">

当要求 Claude 修复或修改代码时，请明确说明需要检查哪些文件或需要解决哪些问题。清晰的上下文有助于 Claude 识别正确的文件并进行适当的更改。

**不太有帮助的提示**："您能修复我的代码吗？"

**更好的提示**："我的 primes.py 文件中有一个语法错误导致它无法运行。您能修复它吗？"

</section>

<section title="明确指定文件路径">

在需要时清楚地指定文件路径，特别是当您处理多个文件或不同目录中的文件时。

**不太有帮助的提示**："检查一下我的辅助文件"

**更好的提示**："您能检查我的 utils/helpers.py 文件是否存在任何性能问题吗？"

</section>

<section title="编辑前创建备份">

在您的应用程序中实现备份系统，在允许 Claude 编辑文件之前创建文件副本，特别是对于重要文件或生产代码。

```python hidelines={1}
import os


def backup_file(file_path):
    """Create a backup of a file before editing."""
    backup_path = f"{file_path}.backup"
    if os.path.exists(file_path):
        with open(file_path, "r") as src, open(backup_path, "w") as dst:
            dst.write(src.read())
```

</section>

<section title="谨慎处理唯一文本替换">

`str_replace` 命令要求待替换文本完全匹配。您的应用程序应确保旧文本恰好有一个匹配项，否则提供适当的错误消息。
```python
def safe_replace(file_path, old_text, new_text):
    """Replace text only if there's exactly one match."""
    with open(file_path, "r") as f:
        content = f.read()

    count = content.count(old_text)
    if count == 0:
        return "Error: No match found"
    elif count > 1:
        return f"Error: Found {count} matches"
    else:
        new_content = content.replace(old_text, new_text)
        with open(file_path, "w") as f:
            f.write(new_content)
        return "Successfully replaced text"
```

</section>

<section title="验证更改">

在 Claude 对文件进行更改后，通过运行测试或检查代码是否仍按预期工作来验证更改。
```python
def verify_changes(file_path):
    """Run tests or checks after making changes."""
    try:
        # 对于 Python 文件，检查语法错误
        if file_path.endswith(".py"):
            import ast

            with open(file_path, "r") as f:
                ast.parse(f.read())
            return "Syntax check passed"
    except Exception as e:
        return f"Verification failed: {str(e)}"
```

</section>

---

## 定价和令牌使用 \{#pricing-and-token-usage}

文本编辑器工具采用与 Claude 使用的其他工具相同的定价结构。它遵循基于您所使用的 Claude 模型的标准输入和输出 "token"（令牌）定价。

除基础令牌外，文本编辑器工具还需要以下额外的输入令牌：

| 工具 | 额外输入令牌 |
| ----------------------------------------- | --------------------------------------- |
| `text_editor_20250429`（Claude 4.x） | 700 个令牌 |

有关工具定价的更多详细信息，请参阅[工具使用定价](/docs/zh-CN/agents-and-tools/tool-use/overview#pricing)。

## 将文本编辑器工具与其他工具集成 \{#integrate-the-text-editor-tool-with-other-tools}

文本编辑器工具可以与其他 Claude 工具一起使用。组合使用工具时，请确保：
- 工具版本与您使用的模型相匹配
- 考虑请求中包含的所有工具的额外令牌使用量

## 更新日志 \{#change-log}

| 日期 | 版本 | 更改 |
| ---- | ------- | ------- |
| 2025 年 7 月 28 日 | `text_editor_20250728` | 发布更新的文本编辑器工具，修复了一些问题并添加了可选的 `max_characters` 参数。其他方面与 `text_editor_20250429` 相同。 |
| 2025 年 4 月 29 日 | `text_editor_20250429` | 发布适用于 Claude 4 的文本编辑器工具。此版本移除了 `undo_edit` 命令，但保留了所有其他功能。工具名称已更新以反映其基于 str_replace 的架构。 |
| 2025 年 3 月 13 日 | `text_editor_20250124` | 引入独立的文本编辑器工具文档。此版本针对 Claude Sonnet 3.7 进行了优化，但功能与之前的版本相同。 |
| 2024 年 10 月 22 日 | `text_editor_20241022` | 随 Claude Sonnet 3.5（[已停用](/docs/zh-CN/about-claude/model-deprecations)）首次发布文本编辑器工具。通过 `view`、`create`、`str_replace`、`insert` 和 `undo_edit` 命令提供查看、创建和编辑文件的功能。 |

## 后续步骤 \{#next-steps}

以下是一些以更便捷、更强大的方式使用文本编辑器工具的想法：

- **集成到您的开发工作流程中**：将文本编辑器工具构建到您的开发工具或 IDE 中
- **创建代码审查系统**：让 Claude 审查您的代码并进行改进
- **构建调试助手**：创建一个系统，让 Claude 帮助您诊断和修复代码中的问题
- **实现文件格式转换**：让 Claude 帮助您将文件从一种格式转换为另一种格式
- **自动化文档编写**：设置工作流程，让 Claude 自动为您的代码编写文档

文本编辑器工具使 Claude 能够直接处理您的代码库，支持从调试到自动化文档编写的各种工作流程。

<CardGroup cols={3}>
  <Card
    title="工具使用概述"
    icon="wrench"
    href="/docs/zh-CN/agents-and-tools/tool-use/overview"
  >
    了解如何实现与 Claude 配合使用的工具工作流程。
  </Card>

  <Card
    title="Bash 工具"
    icon="terminal"
    href="/docs/zh-CN/agents-and-tools/tool-use/bash-tool"
  >
    使用 Claude 执行 shell 命令。
  </Card>
</CardGroup>