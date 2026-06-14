# 在 API 中开始使用 Agent Skills

了解如何在 10 分钟内使用 Agent Skills 通过 Claude API 创建文档。

---

本教程将向您展示如何使用 Agent Skills 创建 PowerPoint 演示文稿。您将学习如何启用 Skills、发起简单请求以及访问生成的文件。

## 前提条件 \{#prerequisites}

- [Claude API 密钥](/settings/keys)
- 已安装 Python 3.7+ 或 curl
- 对发起 API 请求有基本了解

## Agent Skills 概述 \{#agent-skills-overview}

预构建的 Agent Skills 通过专业知识扩展 Claude 的能力，可用于创建文档、分析数据和处理文件等任务。Anthropic 在 API 中提供以下预构建的 Agent Skills：

- **PowerPoint (pptx)：** 创建和编辑演示文稿
- **Excel (xlsx)：** 创建和分析电子表格
- **Word (docx)：** 创建和编辑文档
- **PDF (pdf)：** 生成 PDF 文档

<Note>
**想要创建自定义 Skills？** 请参阅 [Agent Skills Cookbook](https://platform.claude.com/cookbook/skills-notebooks-01-skills-introduction)，了解如何构建具有特定领域专业知识的自定义 Skills 示例。
</Note>

## 步骤 1：列出可用的 Skills \{#step-1-list-available-skills}

首先，查看有哪些可用的 Skills。使用 Skills API 列出所有由 Anthropic 管理的 Skills：

<CodeGroup defaultLanguage="CLI">
  
````bash
# 列出 Anthropic 管理的 Skills
curl --fail-with-body -sS "https://api.anthropic.com/v1/skills?source=anthropic" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: skills-2025-10-02" |
  jq -r '.data[] | "\(.id): \(.display_title)"'
````

  
````bash
# 列出 Anthropic 托管的 Skills
ant beta:skills list --source anthropic
````

  
````python
# 列出 Anthropic 管理的 Skills
skills = client.beta.skills.list(source="anthropic")

for skill in skills.data:
    print(f"{skill.id}: {skill.display_title}")
````

  
````typescript
// 列出 Anthropic 管理的 Skills
const skills = await client.beta.skills.list({ source: "anthropic" });

for (const skill of skills.data) {
  console.log(`${skill.id}: ${skill.display_title}`);
}
````

  
````csharp
// 列出 Anthropic 管理的 Skills
var skills = await client.Beta.Skills.List(new SkillListParams { Source = "anthropic" });

foreach (var skill in skills.Items)
{
    Console.WriteLine($"{skill.ID}: {skill.DisplayTitle}");
}
````

  
````go
// 列出 Anthropic 管理的 Skills
skills, err := client.Beta.Skills.List(ctx, anthropic.BetaSkillListParams{
	Source: anthropic.String("anthropic"),
})
if err != nil {
	panic(err)
}

for _, skill := range skills.Data {
	fmt.Printf("%s: %s\n", skill.ID, skill.DisplayTitle)
}
````

  
````java
// 列出 Anthropic 管理的 Skills
SkillListPage skills = client.beta().skills().list(
    SkillListParams.builder().source("anthropic").build()
);

for (SkillListResponse skill : skills.data()) {
    IO.println(skill.id() + ": " + skill.displayTitle().orElse(""));
}
````

  
````php
// 列出 Anthropic 管理的 Skills
$skills = $client->beta->skills->list(source: 'anthropic');

foreach ($skills->data as $skill) {
    echo "{$skill->id}: {$skill->displayTitle}\n";
}
````

  
````ruby
# 列出 Anthropic 管理的 Skills
skills = client.beta.skills.list(source: "anthropic")

skills.data.each do |skill|
  puts "#{skill.id}: #{skill.display_title}"
end
````

</CodeGroup>

您将看到以下 Skills：`pptx`、`xlsx`、`docx` 和 `pdf`。

此 API 返回每个 Skill 的元数据：其名称和描述。Claude 在启动时加载这些元数据，以了解有哪些可用的 Skills。这是 **"progressive disclosure"（渐进式披露）** 的第一层级，Claude 在此阶段发现 Skills，但尚未加载其完整指令。

## 步骤 2：创建演示文稿 \{#step-2-create-a-presentation}

现在使用 PowerPoint Skill 创建一个关于可再生能源的演示文稿。在 Messages API 中使用 `container` 参数指定 Skills：

<CodeGroup>
  
````bash
# 使用 PowerPoint Skill 创建消息
response=$(
  curl --fail-with-body -sS https://api.anthropic.com/v1/messages \
    -H "content-type: application/json" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
    -d @- <<'EOF'
{
  "model": "claude-opus-4-8",
  "max_tokens": 16000,
  "container": {
    "skills": [{"type": "anthropic", "skill_id": "pptx", "version": "latest"}]
  },
  "messages": [
    {"role": "user", "content": "Create a presentation about renewable energy with 5 slides"}
  ],
  "tools": [{"type": "code_execution_20250825", "name": "code_execution"}]
}
EOF
)
jq -r '"stop_reason=\(.stop_reason), blocks=\(.content | length)"' <<<"$response"
````

  
````bash
# 使用 PowerPoint Skill 创建消息
response=$(ant beta:messages create --format json \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 <<'YAML'
model: claude-opus-4-8
max_tokens: 16000
container:
  skills:
    - type: anthropic
      skill_id: pptx
      version: latest
messages:
  - role: user
    content: Create a presentation about renewable energy with 5 slides
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
)

jq -r '"stop_reason=\(.stop_reason), blocks=\(.content | length)"' <<<"$response"
````

  
````python
# 使用 PowerPoint Skill 创建消息
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=16000,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [{"type": "anthropic", "skill_id": "pptx", "version": "latest"}]
    },
    messages=[
        {
            "role": "user",
            "content": "Create a presentation about renewable energy with 5 slides",
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)

print(f"stop_reason={response.stop_reason}, blocks={len(response.content)}")
````

  
````typescript
// 使用 PowerPoint Skill 创建消息
const response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 16000,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{ type: "anthropic", skill_id: "pptx", version: "latest" }],
  },
  messages: [
    {
      role: "user",
      content: "Create a presentation about renewable energy with 5 slides",
    },
  ],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }],
});

console.log(
  `stop_reason=${response.stop_reason}, blocks=${response.content.length}`,
);
````

  
````csharp
// 使用 PowerPoint Skill 创建消息
var response = await client.Beta.Messages.Create(new MessageCreateParams
{
    Model = Model.ClaudeOpus4_8,
    MaxTokens = 16000,
    Betas = ["code-execution-2025-08-25", "skills-2025-10-02"],
    Container = new BetaContainerParams
    {
        Skills =
        [
            new BetaSkillParams
            {
                Type = BetaSkillParamsType.Anthropic,
                SkillID = "pptx",
                Version = "latest",
            },
        ],
    },
    Messages =
    [
        new BetaMessageParam
        {
            Role = Role.User,
            Content = "Create a presentation about renewable energy with 5 slides",
        },
    ],
    Tools = [new BetaCodeExecutionTool20250825()],
});

Console.WriteLine($"stop_reason={response.StopReason?.Raw()}, blocks={response.Content.Count}");
````

  
````go
// 使用 PowerPoint Skill 创建消息
response, err := client.Beta.Messages.New(ctx, anthropic.BetaMessageNewParams{
	Model:     anthropic.ModelClaudeOpus4_8,
	MaxTokens: 16000,
	Betas: []anthropic.AnthropicBeta{
		"code-execution-2025-08-25",
		anthropic.AnthropicBetaSkills2025_10_02,
	},
	Container: anthropic.BetaMessageNewParamsContainerUnion{
		OfContainers: &anthropic.BetaContainerParams{
			Skills: []anthropic.BetaSkillParams{
				{
					Type:    anthropic.BetaSkillParamsTypeAnthropic,
					SkillID: "pptx",
					Version: anthropic.String("latest"),
				},
			},
		},
	},
	Messages: []anthropic.BetaMessageParam{
		anthropic.NewBetaUserMessage(
			anthropic.NewBetaTextBlock("Create a presentation about renewable energy with 5 slides"),
		),
	},
	Tools: []anthropic.BetaToolUnionParam{
		{OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{}},
	},
})
if err != nil {
	panic(err)
}

fmt.Printf("stop_reason=%s, blocks=%d\n", response.StopReason, len(response.Content))
````

  
````java
// 使用 PowerPoint Skill 创建消息
BetaMessage response = client.beta().messages().create(
    MessageCreateParams.builder()
        .model(Model.CLAUDE_OPUS_4_8)
        .maxTokens(16000)
        .addBeta("code-execution-2025-08-25")
        .addBeta(AnthropicBeta.SKILLS_2025_10_02)
        .container(
            BetaContainerParams.builder()
                .addSkill(
                    BetaSkillParams.builder()
                        .type(BetaSkillParams.Type.ANTHROPIC)
                        .skillId("pptx")
                        .version("latest")
                        .build()
                )
                .build()
        )
        .addUserMessage("Create a presentation about renewable energy with 5 slides")
        .addTool(BetaCodeExecutionTool20250825.builder().build())
        .build()
);

IO.println(
    "stop_reason=" + response.stopReason().orElse(null)
        + ", blocks=" + response.content().size()
);
````

  
````php
// 使用 PowerPoint Skill 创建消息
$response = $client->beta->messages->create(
    model: 'claude-opus-4-8',
    maxTokens: 16000,
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [['type' => 'anthropic', 'skill_id' => 'pptx', 'version' => 'latest']],
    ],
    messages: [
        [
            'role' => 'user',
            'content' => 'Create a presentation about renewable energy with 5 slides',
        ],
    ],
    tools: [['type' => 'code_execution_20250825', 'name' => 'code_execution']],
);

printf("stop_reason=%s, blocks=%d\n", $response->stopReason, count($response->content));
````

  
````ruby
# 使用 PowerPoint Skill 创建消息
response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 16_000,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{type: "anthropic", skill_id: "pptx", version: "latest"}]
  },
  messages: [
    {
      role: "user",
      content: "Create a presentation about renewable energy with 5 slides"
    }
  ],
  tools: [{type: "code_execution_20250825", name: "code_execution"}]
)

puts "stop_reason=#{response.stop_reason}, blocks=#{response.content.length}"
````

</CodeGroup>

让我们逐一解析每个部分的作用：

- **`container.skills`：** 指定 Claude 可以使用哪些 Skills
- **`type: "anthropic"`：** 表示这是由 Anthropic 管理的 Skill
- **`skill_id: "pptx"`：** PowerPoint Skill 的标识符
- **`version: "latest"`：** Skill 版本设置为最新发布的版本
- **`tools`：** 启用代码执行（Skills 必需）
- **Beta 标头：** `code-execution-2025-08-25` 和 `skills-2025-10-02`

<Note>
此处的示例使用 `code_execution_20250825` 工具版本及其对应的 `code-execution-2025-08-25` beta 标头。Skills 也适用于更新的[代码执行工具](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool)版本（`code_execution_20260120` 及更高版本）；任何代码执行工具版本都能满足 Skills 的要求。无论您使用哪个版本，请确保其工具 `type` 和 beta 标头与代码执行工具页面保持一致，并始终包含 `skills-2025-10-02`。
</Note>

当您发起此请求时，Claude 会自动将您的任务与相关的 Skill 进行匹配。由于您请求的是演示文稿，Claude 会判定 PowerPoint Skill 是相关的，并加载其完整指令：这是渐进式披露的第二层级。然后 Claude 执行该 Skill 的代码来创建您的演示文稿。

## 步骤 3：下载创建的文件 \{#step-3-download-the-created-file}

演示文稿已在代码执行容器中创建并保存为文件。响应中包含带有文件 ID 的文件引用。提取文件 ID 并使用 Files API 下载该文件：

<CodeGroup>
  
````bash
# 从代码执行工具结果中提取文件 ID。该 Skill 可能通过
# Python 或 bash 代码执行工具运行其任务，因此需检查
# 这两种结果类型。
file_id=$(jq -r '
  last(
    .content[]
    | select(.type == "code_execution_tool_result" or .type == "bash_code_execution_tool_result")
    | .content
    | select(.type == "code_execution_result" or .type == "bash_code_execution_result")
    | .content[].file_id
  ) // empty
' <<<"$response")

if [[ -n "$file_id" ]]; then
  # 下载文件并保存
  output_path="${TMPDIR:-/tmp}/renewable_energy.pptx"
  curl --fail-with-body -sS "https://api.anthropic.com/v1/files/$file_id/content" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -H "anthropic-beta: files-api-2025-04-14" \
    -o "$output_path"
  echo "Presentation saved to $output_path"
fi
````

  
````bash
# 从代码执行工具结果中提取文件 ID。该 Skill 可能通过
# Python 或 bash 代码执行工具来运行其任务，因此需检查
# 两种结果类型。
file_id=$(jq -r '
  last(
    .content[]
    | select(.type == "code_execution_tool_result"
          or .type == "bash_code_execution_tool_result")
    | .content
    | select(.type == "code_execution_result"
          or .type == "bash_code_execution_result")
    | .content[].file_id
  ) // empty
' <<<"$response")

if [[ -n "$file_id" ]]; then
  # 下载文件并保存
  output_path="${TMPDIR:-/tmp}/renewable_energy.pptx"
  ant beta:files download --file-id "$file_id" --output "$output_path"
  echo "Presentation saved to $output_path"
fi
````

  
````python
# 从代码执行工具结果中提取文件 ID。该 Skill 可能通过
# Python 或 bash 代码执行工具来运行其任务，因此需检查
# 这两种结果类型。
file_id = None
for block in response.content:
    if block.type == "code_execution_tool_result":
        if block.content.type == "code_execution_result":
            for output in block.content.content:
                file_id = output.file_id
    elif block.type == "bash_code_execution_tool_result":
        if block.content.type == "bash_code_execution_result":
            for output in block.content.content:
                file_id = output.file_id

if file_id:
    # 下载文件并保存
    output_path = Path(tempfile.gettempdir()) / "renewable_energy.pptx"
    file_content = client.beta.files.download(file_id=file_id)
    file_content.write_to_file(output_path)
    print(f"Presentation saved to {output_path}")
````

  
````typescript
// 从代码执行工具结果中提取文件 ID。该 Skill 可能通过
// Python 或 bash 代码执行工具来运行其任务，因此需检查
// 这两种结果类型。
let fileId: string | undefined;
for (const block of response.content) {
  if (block.type === "code_execution_tool_result") {
    if (block.content.type === "code_execution_result") {
      for (const output of block.content.content) {
        fileId = output.file_id;
      }
    }
  } else if (block.type === "bash_code_execution_tool_result") {
    if (block.content.type === "bash_code_execution_result") {
      for (const output of block.content.content) {
        fileId = output.file_id;
      }
    }
  }
}

if (fileId) {
  // 下载文件并以流式传输方式写入磁盘
  const outputPath = path.join(os.tmpdir(), "renewable_energy.pptx");
  const fileContent = await client.beta.files.download(fileId);
  await fs.writeFile(outputPath, fileContent.body!);
  console.log(`Presentation saved to ${outputPath}`);
}
````

  
````csharp
// 从代码执行工具结果中提取文件 ID。该 Skill 可能
// 通过 Python 或 bash 代码执行工具运行其任务，因此
// 需检查这两种结果类型。
string? fileId = null;
foreach (var block in response.Content)
{
    if (block.TryPickCodeExecutionToolResult(out var codeResult)
        && codeResult.Content.TryPickResultBlock(out var codeResultBlock))
    {
        foreach (var output in codeResultBlock.Content)
        {
            fileId = output.FileID;
        }
    }
    else if (block.TryPickBashCodeExecutionToolResult(out var bashResult)
        && bashResult.Content.TryPickBetaBashCodeExecutionResultBlock(out var bashResultBlock))
    {
        foreach (var output in bashResultBlock.Content)
        {
            fileId = output.FileID;
        }
    }
}

if (fileId is not null)
{
    // 下载文件并保存
    var outputPath = Path.Combine(Path.GetTempPath(), "renewable_energy.pptx");
    using var download = await client.Beta.Files.Download(fileId);
    await using var source = await download.ReadAsStream();
    await using var destination = File.Create(outputPath);
    await source.CopyToAsync(destination);
    Console.WriteLine($"Presentation saved to {outputPath}");
}
````

  
````go
// 从代码执行工具结果中提取文件 ID。该 Skill 可能通过
// Python 或 bash 代码执行工具来运行其任务，因此需检查
// 这两种结果类型。
var fileID string
for _, block := range response.Content {
	switch result := block.AsAny().(type) {
	case anthropic.BetaCodeExecutionToolResultBlock:
		if result.Content.Type == "code_execution_result" {
			for _, output := range result.Content.Content {
				fileID = output.FileID
			}
		}
	case anthropic.BetaBashCodeExecutionToolResultBlock:
		if result.Content.Type == "bash_code_execution_result" {
			for _, output := range result.Content.Content {
				fileID = output.FileID
			}
		}
	}
}

if fileID != "" {
	// 下载文件并保存
	outputPath := filepath.Join(os.TempDir(), "renewable_energy.pptx")
	fileContent, err := client.Beta.Files.Download(ctx, fileID, anthropic.BetaFileDownloadParams{})
	if err != nil {
		panic(err)
	}
	defer fileContent.Body.Close()
	outFile, err := os.Create(outputPath)
	if err != nil {
		panic(err)
	}
	defer outFile.Close()
	if _, err := io.Copy(outFile, fileContent.Body); err != nil {
		panic(err)
	}
	fmt.Printf("Presentation saved to %s\n", outputPath)
}
````

  
````java
// 从代码执行工具结果中提取文件 ID。该 Skill 可能通过
// Python 或 bash 代码执行工具运行其任务，因此需检查
// 这两种结果类型。
String fileId = null;
for (BetaContentBlock block : response.content()) {
    if (block.isCodeExecutionToolResult()) {
        var content = block.asCodeExecutionToolResult().content();
        if (content.isResultBlock()) {
            for (var output : content.asResultBlock().content()) {
                fileId = output.fileId();
            }
        }
    } else if (block.isBashCodeExecutionToolResult()) {
        var content = block.asBashCodeExecutionToolResult().content();
        if (content.isBetaBashCodeExecutionResultBlock()) {
            for (var output : content.asBetaBashCodeExecutionResultBlock().content()) {
                fileId = output.fileId();
            }
        }
    }
}

if (fileId != null) {
    // 下载文件并保存
    Path outputPath = Files.createTempFile("renewable_energy", ".pptx");
    try (HttpResponse fileContent = client.beta().files().download(fileId)) {
        Files.copy(fileContent.body(), outputPath, StandardCopyOption.REPLACE_EXISTING);
    }
    IO.println("Presentation saved to " + outputPath);
}
````

  
````php
// 从代码执行工具结果中提取文件 ID。该 Skill 可能通过
// Python 或 bash 代码执行工具来运行其任务，因此需检查
// 这两种结果类型。
$fileId = null;
foreach ($response->content as $block) {
    if ($block instanceof BetaCodeExecutionToolResultBlock) {
        if ($block->content instanceof BetaCodeExecutionResultBlock) {
            foreach ($block->content->content as $output) {
                $fileId = $output->fileID;
            }
        }
    } elseif ($block instanceof BetaBashCodeExecutionToolResultBlock) {
        if ($block->content instanceof BetaBashCodeExecutionResultBlock) {
            foreach ($block->content->content as $output) {
                $fileId = $output->fileID;
            }
        }
    }
}

if ($fileId !== null) {
    // 下载文件并保存
    $outputPath = sys_get_temp_dir() . '/renewable_energy.pptx';
    $fileContent = $client->beta->files->download($fileId);
    file_put_contents($outputPath, $fileContent);
    echo "Presentation saved to {$outputPath}\n";
}
````

  
````ruby
# 从代码执行工具结果中提取文件 ID。该 Skill 可能通过
# Python 或 bash 代码执行工具运行其任务，因此需检查
# 这两种结果类型。
file_id = nil
response.content.each do |block|
  case block.type
  when :code_execution_tool_result
    if block.content[:type] == "code_execution_result"
      block.content[:content].each { |output| file_id = output[:file_id] }
    end
  when :bash_code_execution_tool_result
    if block.content[:type] == "bash_code_execution_result"
      block.content[:content].each { |output| file_id = output[:file_id] }
    end
  end
end

if file_id
  # 下载文件并保存
  output_path = File.join(Dir.tmpdir, "renewable_energy.pptx")
  file_content = client.beta.files.download(file_id)
  File.binwrite(output_path, file_content.read)
  puts "Presentation saved to #{output_path}"
end
````

</CodeGroup>

<Note>
有关处理生成文件的完整详细信息，请参阅[代码执行工具文档](/docs/zh-CN/agents-and-tools/tool-use/code-execution-tool#retrieve-generated-files)。
</Note>

## 尝试更多示例 \{#try-more-examples}

现在您已经使用 Skills 创建了第一个文档，可以尝试以下变体：

### 创建电子表格 \{#create-a-spreadsheet}

<CodeGroup>
```bash cURL nocheck
curl --fail-with-body -sS https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 16000,
    "container": {
      "skills": [{"type": "anthropic", "skill_id": "xlsx", "version": "latest"}]
    },
    "messages": [
      {"role": "user", "content": "Create a quarterly sales tracking spreadsheet with sample data"}
    ],
    "tools": [{"type": "code_execution_20250825", "name": "code_execution"}]
  }' | jq -r '"stop_reason=\(.stop_reason)"'
```

```bash CLI nocheck
ant beta:messages create --format json \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 <<'YAML' | jq -r '"stop_reason=\(.stop_reason)"'
model: claude-opus-4-8
max_tokens: 16000
container:
  skills:
    - type: anthropic
      skill_id: xlsx
      version: latest
messages:
  - role: user
    content: Create a quarterly sales tracking spreadsheet with sample data
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
```

```python Python nocheck hidelines={1..3,-1}
import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=16000,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [{"type": "anthropic", "skill_id": "xlsx", "version": "latest"}]
    },
    messages=[
        {
            "role": "user",
            "content": "Create a quarterly sales tracking spreadsheet with sample data",
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)
print(f"stop_reason={response.stop_reason}")
```

```typescript TypeScript nocheck hidelines={1..3,-1}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 16000,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{ type: "anthropic", skill_id: "xlsx", version: "latest" }]
  },
  messages: [
    {
      role: "user",
      content: "Create a quarterly sales tracking spreadsheet with sample data"
    }
  ],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});
console.log(`stop_reason=${response.stop_reason}`);
```

```csharp C# nocheck hidelines={1..6,-2..}
using Anthropic;
using Anthropic.Models.Beta.Messages;
using Model = Anthropic.Models.Messages.Model;

var client = new AnthropicClient();

var response = await client.Beta.Messages.Create(
    new MessageCreateParams
    {
        Model = Model.ClaudeOpus4_8,
        MaxTokens = 16000,
        Betas = ["code-execution-2025-08-25", "skills-2025-10-02"],
        Container = new BetaContainerParams
        {
            Skills =
            [
                new BetaSkillParams
                {
                    Type = BetaSkillParamsType.Anthropic,
                    SkillID = "xlsx",
                    Version = "latest",
                },
            ],
        },
        Messages =
        [
            new BetaMessageParam
            {
                Role = Role.User,
                Content = "Create a quarterly sales tracking spreadsheet with sample data",
            },
        ],
        Tools = [new BetaCodeExecutionTool20250825()],
    }
);

Console.WriteLine($"stop_reason={response.StopReason?.Raw()}");
```

```go Go nocheck hidelines={1..12,-3..}
package main

import (
	"context"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, err := client.Beta.Messages.New(context.Background(), anthropic.BetaMessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 16000,
		Betas: []anthropic.AnthropicBeta{
			"code-execution-2025-08-25",
			anthropic.AnthropicBetaSkills2025_10_02,
		},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "xlsx",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Create a quarterly sales tracking spreadsheet with sample data")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{
				OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{},
			},
		},
	})
	if err != nil {
		panic(err)
	}

	fmt.Printf("stop_reason=%s\n", response.StopReason)
}
```

```java Java nocheck hidelines={1..13,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.AnthropicBeta;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.MessageCreateParams;
import static com.anthropic.models.beta.messages.BetaSkillParams.Type.ANTHROPIC;
import static com.anthropic.models.messages.Model.CLAUDE_OPUS_4_8;

AnthropicClient client = AnthropicOkHttpClient.fromEnv();

void main() {
    BetaMessage response = client.beta().messages().create(
        MessageCreateParams.builder()
            .model(CLAUDE_OPUS_4_8)
            .maxTokens(16000)
            .addBeta("code-execution-2025-08-25")
            .addBeta(AnthropicBeta.SKILLS_2025_10_02)
            .container(
                BetaContainerParams.builder()
                    .addSkill(
                        BetaSkillParams.builder()
                            .type(ANTHROPIC)
                            .skillId("xlsx")
                            .version("latest")
                            .build()
                    )
                    .build()
            )
            .addUserMessage("Create a quarterly sales tracking spreadsheet with sample data")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build()
    );

    IO.println("stop_reason=" + response.stopReason().orElse(null));
}
```

```php PHP nocheck hidelines={1..7,-2..}
<?php

use Anthropic\Client;
use Anthropic\Beta\Messages\BetaCodeExecutionTool20250825;

$client = new Client();

$response = $client->beta->messages->create(
    model: 'claude-opus-4-8',
    maxTokens: 16000,
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [
            ['type' => 'anthropic', 'skillID' => 'xlsx', 'version' => 'latest'],
        ],
    ],
    messages: [
        [
            'role' => 'user',
            'content' => 'Create a quarterly sales tracking spreadsheet with sample data',
        ],
    ],
    tools: [new BetaCodeExecutionTool20250825()],
);

printf("stop_reason=%s\n", $response->stopReason);
```

```ruby Ruby nocheck hidelines={1..4,-2..}
require "anthropic"

client = Anthropic::Client.new

response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 16_000,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{type: "anthropic", skill_id: "xlsx", version: "latest"}]
  },
  messages: [
    {
      role: "user",
      content: "Create a quarterly sales tracking spreadsheet with sample data"
    }
  ],
  tools: [{type: "code_execution_20250825", name: "code_execution"}]
)

puts "stop_reason=#{response.stop_reason}"
```
</CodeGroup>

### 创建 Word 文档 \{#create-a-word-document}

<CodeGroup>
```bash cURL nocheck
curl --fail-with-body -sS https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 16000,
    "container": {
      "skills": [{"type": "anthropic", "skill_id": "docx", "version": "latest"}]
    },
    "messages": [
      {"role": "user", "content": "Write a 2-page report on the benefits of renewable energy"}
    ],
    "tools": [{"type": "code_execution_20250825", "name": "code_execution"}]
  }' | jq -r '"stop_reason=\(.stop_reason)"'
```

```bash CLI nocheck
ant beta:messages create --format json \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 <<'YAML' | jq -r '"stop_reason=\(.stop_reason)"'
model: claude-opus-4-8
max_tokens: 16000
container:
  skills:
    - type: anthropic
      skill_id: docx
      version: latest
messages:
  - role: user
    content: Write a 2-page report on the benefits of renewable energy
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
```

```python Python nocheck hidelines={1..3,-1}
import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=16000,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [{"type": "anthropic", "skill_id": "docx", "version": "latest"}]
    },
    messages=[
        {
            "role": "user",
            "content": "Write a 2-page report on the benefits of renewable energy",
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)
print(f"stop_reason={response.stop_reason}")
```

```typescript TypeScript nocheck hidelines={1..3,-1}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 16000,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{ type: "anthropic", skill_id: "docx", version: "latest" }]
  },
  messages: [
    {
      role: "user",
      content: "Write a 2-page report on the benefits of renewable energy"
    }
  ],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});
console.log(`stop_reason=${response.stop_reason}`);
```

```csharp C# nocheck hidelines={1..6,-2..}
using Anthropic;
using Anthropic.Models.Beta.Messages;
using Model = Anthropic.Models.Messages.Model;

var client = new AnthropicClient();

var response = await client.Beta.Messages.Create(
    new MessageCreateParams
    {
        Model = Model.ClaudeOpus4_8,
        MaxTokens = 16000,
        Betas = ["code-execution-2025-08-25", "skills-2025-10-02"],
        Container = new BetaContainerParams
        {
            Skills =
            [
                new BetaSkillParams
                {
                    Type = BetaSkillParamsType.Anthropic,
                    SkillID = "docx",
                    Version = "latest",
                },
            ],
        },
        Messages =
        [
            new BetaMessageParam
            {
                Role = Role.User,
                Content = "Write a 2-page report on the benefits of renewable energy",
            },
        ],
        Tools = [new BetaCodeExecutionTool20250825()],
    }
);

Console.WriteLine($"stop_reason={response.StopReason?.Raw()}");
```

```go Go nocheck hidelines={1..12,-3..}
package main

import (
	"context"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, err := client.Beta.Messages.New(context.Background(), anthropic.BetaMessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 16000,
		Betas: []anthropic.AnthropicBeta{
			"code-execution-2025-08-25",
			anthropic.AnthropicBetaSkills2025_10_02,
		},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "docx",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Write a 2-page report on the benefits of renewable energy")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{
				OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{},
			},
		},
	})
	if err != nil {
		panic(err)
	}

	fmt.Printf("stop_reason=%s\n", response.StopReason)
}
```

```java Java nocheck hidelines={1..13,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.AnthropicBeta;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.MessageCreateParams;
import static com.anthropic.models.beta.messages.BetaSkillParams.Type.ANTHROPIC;
import static com.anthropic.models.messages.Model.CLAUDE_OPUS_4_8;

AnthropicClient client = AnthropicOkHttpClient.fromEnv();

void main() {
    BetaMessage response = client.beta().messages().create(
        MessageCreateParams.builder()
            .model(CLAUDE_OPUS_4_8)
            .maxTokens(16000)
            .addBeta("code-execution-2025-08-25")
            .addBeta(AnthropicBeta.SKILLS_2025_10_02)
            .container(
                BetaContainerParams.builder()
                    .addSkill(
                        BetaSkillParams.builder()
                            .type(ANTHROPIC)
                            .skillId("docx")
                            .version("latest")
                            .build()
                    )
                    .build()
            )
            .addUserMessage("Write a 2-page report on the benefits of renewable energy")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build()
    );

    IO.println("stop_reason=" + response.stopReason().orElse(null));
}
```

```php PHP nocheck hidelines={1..7,-2..}
<?php

use Anthropic\Client;
use Anthropic\Beta\Messages\BetaCodeExecutionTool20250825;

$client = new Client();

$response = $client->beta->messages->create(
    model: 'claude-opus-4-8',
    maxTokens: 16000,
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [
            ['type' => 'anthropic', 'skillID' => 'docx', 'version' => 'latest'],
        ],
    ],
    messages: [
        [
            'role' => 'user',
            'content' => 'Write a 2-page report on the benefits of renewable energy',
        ],
    ],
    tools: [new BetaCodeExecutionTool20250825()],
);

printf("stop_reason=%s\n", $response->stopReason);
```

```ruby Ruby nocheck hidelines={1..4,-2..}
require "anthropic"

client = Anthropic::Client.new

response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 16_000,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{type: "anthropic", skill_id: "docx", version: "latest"}]
  },
  messages: [
    {
      role: "user",
      content: "Write a 2-page report on the benefits of renewable energy"
    }
  ],
  tools: [{type: "code_execution_20250825", name: "code_execution"}]
)

puts "stop_reason=#{response.stop_reason}"
```
</CodeGroup>

### 生成 PDF \{#generate-a-pdf}

<CodeGroup>
```bash cURL nocheck
curl --fail-with-body -sS https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: code-execution-2025-08-25,skills-2025-10-02" \
  -d '{
    "model": "claude-opus-4-8",
    "max_tokens": 16000,
    "container": {
      "skills": [{"type": "anthropic", "skill_id": "pdf", "version": "latest"}]
    },
    "messages": [
      {"role": "user", "content": "Generate a PDF invoice template"}
    ],
    "tools": [{"type": "code_execution_20250825", "name": "code_execution"}]
  }' | jq -r '"stop_reason=\(.stop_reason)"'
```

```bash CLI nocheck
ant beta:messages create --format json \
  --beta code-execution-2025-08-25 \
  --beta skills-2025-10-02 <<'YAML' | jq -r '"stop_reason=\(.stop_reason)"'
model: claude-opus-4-8
max_tokens: 16000
container:
  skills:
    - type: anthropic
      skill_id: pdf
      version: latest
messages:
  - role: user
    content: Generate a PDF invoice template
tools:
  - type: code_execution_20250825
    name: code_execution
YAML
```

```python Python nocheck hidelines={1..3,-1}
import anthropic

client = anthropic.Anthropic()
response = client.beta.messages.create(
    model="claude-opus-4-8",
    max_tokens=16000,
    betas=["code-execution-2025-08-25", "skills-2025-10-02"],
    container={
        "skills": [{"type": "anthropic", "skill_id": "pdf", "version": "latest"}]
    },
    messages=[
        {
            "role": "user",
            "content": "Generate a PDF invoice template",
        }
    ],
    tools=[{"type": "code_execution_20250825", "name": "code_execution"}],
)
print(f"stop_reason={response.stop_reason}")
```

```typescript TypeScript nocheck hidelines={1..3,-1}
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const response = await client.beta.messages.create({
  model: "claude-opus-4-8",
  max_tokens: 16000,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{ type: "anthropic", skill_id: "pdf", version: "latest" }]
  },
  messages: [
    {
      role: "user",
      content: "Generate a PDF invoice template"
    }
  ],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});
console.log(`stop_reason=${response.stop_reason}`);
```

```csharp C# nocheck hidelines={1..6,-2..}
using Anthropic;
using Anthropic.Models.Beta.Messages;
using Model = Anthropic.Models.Messages.Model;

var client = new AnthropicClient();

var response = await client.Beta.Messages.Create(
    new MessageCreateParams
    {
        Model = Model.ClaudeOpus4_8,
        MaxTokens = 16000,
        Betas = ["code-execution-2025-08-25", "skills-2025-10-02"],
        Container = new BetaContainerParams
        {
            Skills =
            [
                new BetaSkillParams
                {
                    Type = BetaSkillParamsType.Anthropic,
                    SkillID = "pdf",
                    Version = "latest",
                },
            ],
        },
        Messages =
        [
            new BetaMessageParam
            {
                Role = Role.User,
                Content = "Generate a PDF invoice template",
            },
        ],
        Tools = [new BetaCodeExecutionTool20250825()],
    }
);

Console.WriteLine($"stop_reason={response.StopReason?.Raw()}");
```

```go Go nocheck hidelines={1..12,-3..}
package main

import (
	"context"
	"fmt"

	"github.com/anthropics/anthropic-sdk-go"
)

func main() {
	client := anthropic.NewClient()

	response, err := client.Beta.Messages.New(context.Background(), anthropic.BetaMessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_8,
		MaxTokens: 16000,
		Betas: []anthropic.AnthropicBeta{
			"code-execution-2025-08-25",
			anthropic.AnthropicBetaSkills2025_10_02,
		},
		Container: anthropic.BetaMessageNewParamsContainerUnion{
			OfContainers: &anthropic.BetaContainerParams{
				Skills: []anthropic.BetaSkillParams{
					{
						Type:    anthropic.BetaSkillParamsTypeAnthropic,
						SkillID: "pdf",
						Version: anthropic.String("latest"),
					},
				},
			},
		},
		Messages: []anthropic.BetaMessageParam{
			anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock("Generate a PDF invoice template")),
		},
		Tools: []anthropic.BetaToolUnionParam{
			{
				OfCodeExecutionTool20250825: &anthropic.BetaCodeExecutionTool20250825Param{},
			},
		},
	})
	if err != nil {
		panic(err)
	}

	fmt.Printf("stop_reason=%s\n", response.StopReason)
}
```

```java Java nocheck hidelines={1..13,-2..}
import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.beta.AnthropicBeta;
import com.anthropic.models.beta.messages.BetaCodeExecutionTool20250825;
import com.anthropic.models.beta.messages.BetaContainerParams;
import com.anthropic.models.beta.messages.BetaMessage;
import com.anthropic.models.beta.messages.BetaSkillParams;
import com.anthropic.models.beta.messages.MessageCreateParams;
import static com.anthropic.models.beta.messages.BetaSkillParams.Type.ANTHROPIC;
import static com.anthropic.models.messages.Model.CLAUDE_OPUS_4_8;

AnthropicClient client = AnthropicOkHttpClient.fromEnv();

void main() {
    BetaMessage response = client.beta().messages().create(
        MessageCreateParams.builder()
            .model(CLAUDE_OPUS_4_8)
            .maxTokens(16000)
            .addBeta("code-execution-2025-08-25")
            .addBeta(AnthropicBeta.SKILLS_2025_10_02)
            .container(
                BetaContainerParams.builder()
                    .addSkill(
                        BetaSkillParams.builder()
                            .type(ANTHROPIC)
                            .skillId("pdf")
                            .version("latest")
                            .build()
                    )
                    .build()
            )
            .addUserMessage("Generate a PDF invoice template")
            .addTool(BetaCodeExecutionTool20250825.builder().build())
            .build()
    );

    IO.println("stop_reason=" + response.stopReason().orElse(null));
}
```

```php PHP nocheck hidelines={1..7,-2..}
<?php

use Anthropic\Client;
use Anthropic\Beta\Messages\BetaCodeExecutionTool20250825;

$client = new Client();

$response = $client->beta->messages->create(
    model: 'claude-opus-4-8',
    maxTokens: 16000,
    betas: ['code-execution-2025-08-25', 'skills-2025-10-02'],
    container: [
        'skills' => [
            ['type' => 'anthropic', 'skillID' => 'pdf', 'version' => 'latest'],
        ],
    ],
    messages: [
        [
            'role' => 'user',
            'content' => 'Generate a PDF invoice template',
        ],
    ],
    tools: [new BetaCodeExecutionTool20250825()],
);

printf("stop_reason=%s\n", $response->stopReason);
```

```ruby Ruby nocheck hidelines={1..4,-2..}
require "anthropic"

client = Anthropic::Client.new

response = client.beta.messages.create(
  model: "claude-opus-4-8",
  max_tokens: 16_000,
  betas: ["code-execution-2025-08-25", "skills-2025-10-02"],
  container: {
    skills: [{type: "anthropic", skill_id: "pdf", version: "latest"}]
  },
  messages: [
    {
      role: "user",
      content: "Generate a PDF invoice template"
    }
  ],
  tools: [{type: "code_execution_20250825", name: "code_execution"}]
)

puts "stop_reason=#{response.stop_reason}"
```
</CodeGroup>

## 后续步骤 \{#next-steps}

现在您已经使用了预构建的 Agent Skills，接下来可以：

<CardGroup cols={2}>
  <Card
    title="API 指南"
    icon="book"
    href="/docs/zh-CN/build-with-claude/skills-guide"
  >
    通过 Claude API 使用 Skills
  </Card>
  <Card
    title="创建自定义 Skills"
    icon="code"
    href="/docs/zh-CN/api/skills/create-skill"
  >
    上传您自己的 Skills 以处理专业任务
  </Card>
  <Card
    title="编写指南"
    icon="edit"
    href="/docs/zh-CN/agents-and-tools/agent-skills/best-practices"
  >
    了解编写高效 Skills 的最佳实践
  </Card>
  <Card
    title="在 Claude Code 中使用 Skills"
    icon="terminal"
    href="https://code.claude.com/docs/en/skills"
  >
    了解 Claude Code 中的 Skills
  </Card>
  <Card
    title="Agent Skills Cookbook"
    icon="book"
    href="https://platform.claude.com/cookbook/skills-notebooks-01-skills-introduction"
  >
    探索 Skills 示例和实现模式
  </Card>
</CardGroup>