# Claude 入门

向 Claude 发起您的第一次 API 调用，并构建一个简单的网络搜索助手。

---

## 前提条件 \{#prerequisites}

- 一个 Anthropic [Console 账户](/)
- 一个 [API 密钥](/settings/keys)

## 调用 API \{#call-the-api}

<Tabs>
  <Tab title="cURL">
    <Steps>
      <Step title="设置您的 API 密钥">
        将您的 API 密钥导出为环境变量。下面的 cURL 命令会从 `$ANTHROPIC_API_KEY` 中读取该密钥。

        ```bash
        export ANTHROPIC_API_KEY="your-api-key-here"
        ```
      </Step>

      <Step title="发起您的第一次 API 调用">
        向 Messages API 发送一个 `POST` 请求：

        ```bash cURL
        curl https://api.anthropic.com/v1/messages \
          -H "content-type: application/json" \
          -H "x-api-key: $ANTHROPIC_API_KEY" \
          -H "anthropic-version: 2023-06-01" \
          -d '{
            "model": "claude-opus-4-8",
            "max_tokens": 1000,
            "messages": [
              {
                "role": "user",
                "content": "What should I search for to find the latest developments in renewable energy?"
              }
            ]
          }'
        ```

        Claude 会返回一个包含助手消息的 JSON 响应：

        ```json Output
        {
          "id": "msg_013mHbppMPd2PrVJzGMZPt2D",
          "type": "message",
          "role": "assistant",
          "model": "claude-opus-4-8",
          "content": [
            {
              "type": "text",
              "text": "Here are some effective search strategies to find the latest developments in renewable energy:\n\n## General Search Terms\n- \"Renewable energy news 2025\"\n- ..."
            }
          ],
          "stop_reason": "end_turn",
          "usage": {
            "input_tokens": 21,
            "output_tokens": 305
          }
        }
        ```
      </Step>
    </Steps>
  </Tab>

  <Tab title="CLI">
    <Steps>
      <Step title="安装 CLI">
        使用 Homebrew 安装 Anthropic CLI：

        ```bash
        brew install anthropics/tap/ant
        ```

        如需了解其他安装方法，请参阅 CLI 快速入门中的[安装](/docs/zh-CN/cli-sdks-libraries/cli/quickstart#installation)部分。
      </Step>

      <Step title="身份验证">
        使用您的 Anthropic 账户登录：

        ```bash
        ant auth login
        ```

        这会打开一个基于浏览器的 OAuth 流程。授权完成后，使用以下命令确认您的凭据：

        ```bash
        ant auth status
        ```

        如果您在没有浏览器的远程主机上操作，请传入 `--no-browser` 参数以获取一个可在其他设备上打开的 URL，然后将返回的代码粘贴回终端。如果您的环境中设置了 `ANTHROPIC_API_KEY`，它将优先于登录凭据。对于 CI 等非交互式环境，请参阅 [CLI 身份验证选项](/docs/zh-CN/cli-sdks-libraries/cli/authentication)。
      </Step>

      <Step title="发起您的第一次 API 调用">
        在终端中运行 `ant messages create`：

        ```bash CLI
        ant messages create \
          --model claude-opus-4-8 \
          --max-tokens 1000 \
          --message '{
            role: user,
            content: "What should I search for to find the latest developments in renewable energy?"
          }'
        ```

        CLI 会打印 JSON 响应：

        ```json Output
        {
          "id": "msg_01N1ycuCkM5Mzd7WhTU4fwST",
          "type": "message",
          "role": "assistant",
          "model": "claude-opus-4-8",
          "content": [
            {
              "type": "text",
              "text": "Here are some effective search strategies to find the latest developments in renewable energy:\n\n## General Search Terms\n- \"Renewable energy news 2025\"\n- ..."
            }
          ],
          "stop_reason": "end_turn",
          "usage": { "input_tokens": 21, "output_tokens": 305 }
        }
        ```
      </Step>
    </Steps>
  </Tab>

  <Tab title="Python">
    <Steps>
      <Step title="设置您的 API 密钥">
        将您的 API 密钥导出为环境变量。SDK 会自动读取 `ANTHROPIC_API_KEY`。

        ```bash
        export ANTHROPIC_API_KEY="your-api-key-here"
        ```
      </Step>

      <Step title="创建项目并安装 SDK">
        ```bash
        mkdir claude-quickstart && cd claude-quickstart
        python3 -m venv .venv && source .venv/bin/activate
        pip install anthropic
        ```
      </Step>

      <Step title="编写代码">
        创建一个名为 `quickstart.py` 的文件：

        ```python Python
        import anthropic

        client = anthropic.Anthropic()

        message = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1000,
            messages=[
                {
                    "role": "user",
                    "content": "What should I search for to find the latest developments in renewable energy?",
                }
            ],
        )
        print(message.content)
        ```
      </Step>

      <Step title="运行代码">
        ```bash
        python quickstart.py
        ```

        ```text Output
        [TextBlock(citations=None, text='Here are some effective search strategies to find the latest developments in renewable energy:\n\n## General Search Terms\n- "Renewable energy news 2025"\n- ...', type='text')]
        ```
      </Step>
    </Steps>
  </Tab>

  <Tab title="TypeScript">
    <Steps>
      <Step title="设置您的 API 密钥">
        将您的 API 密钥导出为环境变量。SDK 会自动读取 `ANTHROPIC_API_KEY`。

        ```bash
        export ANTHROPIC_API_KEY="your-api-key-here"
        ```
      </Step>

      <Step title="创建项目并安装 SDK">
        ```bash
        mkdir claude-quickstart && cd claude-quickstart
        npm init -y
        npm pkg set type=module
        npm install @anthropic-ai/sdk
        ```
      </Step>

      <Step title="编写代码">
        创建一个名为 `quickstart.ts` 的文件：

        ```typescript TypeScript
        import Anthropic from "@anthropic-ai/sdk";

        const client = new Anthropic();

        const message = await client.messages.create({
          model: "claude-opus-4-8",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: "What should I search for to find the latest developments in renewable energy?"
            }
          ]
        });
        console.log(message.content);
        ```
      </Step>

      <Step title="运行代码">
        ```bash
        npx tsx quickstart.ts
        ```

        ```text Output
        [
          {
            type: 'text',
            text: 'Here are some effective search strategies to find the latest developments in renewable energy:\n' +
              '\n' +
              '## General Search Terms\n' +
              '- "Renewable energy news 2025"\n' +
              '- ...'
          }
        ]
        ```
      </Step>
    </Steps>
  </Tab>

  <Tab title="C#">
    <Steps>
      <Step title="设置您的 API 密钥">
        将您的 API 密钥导出为环境变量。SDK 会自动读取 `ANTHROPIC_API_KEY`。

        ```bash
        export ANTHROPIC_API_KEY="your-api-key-here"
        ```
      </Step>

      <Step title="创建项目并安装 SDK">
        创建一个新的控制台项目并添加 Anthropic 包：

        ```bash
        dotnet new console -n ClaudeQuickstart
        cd ClaudeQuickstart
        dotnet add package Anthropic
        ```
      </Step>

      <Step title="编写代码">
        替换 `Program.cs` 的内容：

        ```csharp C#
        using Anthropic;
        using Anthropic.Models.Messages;

        var client = new AnthropicClient();

        var message = await client.Messages.Create(new MessageCreateParams
        {
            Model = Model.ClaudeOpus4_8,
            MaxTokens = 1000,
            Messages =
            [
                new()
                {
                    Role = Role.User,
                    Content = "What should I search for to find the latest developments in renewable energy?",
                },
            ],
        });

        foreach (var block in message.Content)
        {
            Console.WriteLine(block);
        }
        ```
      </Step>

      <Step title="运行代码">
        ```bash
        dotnet run
        ```

        ```text Output
        {
          "type": "text",
          "text": "Here are some effective search strategies to find the latest developments in renewable energy:\n\n## General Search Terms\n- \"Renewable energy news 2025\"\n- ..."
        }
        ```
      </Step>
    </Steps>
  </Tab>

  <Tab title="Go">
    <Steps>
      <Step title="设置您的 API 密钥">
        将您的 API 密钥导出为环境变量。SDK 会自动读取 `ANTHROPIC_API_KEY`。

        ```bash
        export ANTHROPIC_API_KEY="your-api-key-here"
        ```
      </Step>

      <Step title="创建项目并安装 SDK">
        创建一个新模块并添加 Anthropic SDK：

        ```bash
        mkdir claude-quickstart && cd claude-quickstart
        go mod init claude-quickstart
        go get github.com/anthropics/anthropic-sdk-go
        ```
      </Step>

      <Step title="编写代码">
        创建一个名为 `main.go` 的文件：

        ```go Go
        package main

        import (
        	"context"
        	"fmt"
        	"log"

        	"github.com/anthropics/anthropic-sdk-go"
        )

        func main() {
        	client := anthropic.NewClient()

        	message, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
        		Model:     anthropic.ModelClaudeOpus4_8,
        		MaxTokens: 1000,
        		Messages: []anthropic.MessageParam{
        			anthropic.NewUserMessage(anthropic.NewTextBlock("What should I search for to find the latest developments in renewable energy?")),
        		},
        	})
        	if err != nil {
        		log.Fatal(err)
        	}

        	fmt.Println(message.JSON.Content.Raw())
        }
        ```
      </Step>

      <Step title="运行代码">
        ```bash
        go run .
        ```

        ```text Output
        [{"type":"text","text":"Here are some effective search strategies to find the latest developments in renewable energy:\n\n## General Search Terms\n- \"Renewable energy news 2025\"\n- ..."}]
        ```
      </Step>
    </Steps>
  </Tab>

  <Tab title="Java">
    <Steps>
      <Step title="设置您的 API 密钥">
        将您的 API 密钥导出为环境变量。SDK 会自动读取 `ANTHROPIC_API_KEY`。

        ```bash
        export ANTHROPIC_API_KEY="your-api-key-here"
        ```
      </Step>

      <Step title="设置您的项目">
        您需要在 `PATH` 中配置 JDK（25 或更高版本）以及 [Gradle](https://gradle.org/install/) 或 [Maven](https://maven.apache.org/install.html)。为您的项目创建一个目录，并在其中创建一个 Java 源代码目录：

        ```bash
        mkdir -p claude-quickstart/src/main/java && cd claude-quickstart
        ```

        然后添加一个构建文件。您可以在 [Maven Central](https://central.sonatype.com/artifact/com.anthropic/anthropic-java) 上找到当前的 SDK 版本。

        <Tabs>
          <Tab title="Gradle">
            将以下内容保存为 `build.gradle.kts`：

            ```kotlin
            plugins {
                application
            }

            repositories {
                mavenCentral()
            }

            java {
                toolchain {
                    languageVersion = JavaLanguageVersion.of(25)
                }
            }

            dependencies {
                implementation("com.anthropic:anthropic-java:2.40.0")
            }

            application {
                mainClass = "QuickStart"
            }
            ```
          </Tab>
          <Tab title="Maven">
            将以下内容保存为 `pom.xml`：

            ```xml
            <project xmlns="http://maven.apache.org/POM/4.0.0">
              <modelVersion>4.0.0</modelVersion>
              <groupId>com.example</groupId>
              <artifactId>quickstart</artifactId>
              <version>1.0-SNAPSHOT</version>
              <properties>
                <maven.compiler.release>25</maven.compiler.release>
                <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
              </properties>
              <dependencies>
                <dependency>
                  <groupId>com.anthropic</groupId>
                  <artifactId>anthropic-java</artifactId>
                  <version>2.40.0</version>
                </dependency>
              </dependencies>
            </project>
            ```
          </Tab>
        </Tabs>
      </Step>

      <Step title="编写代码">
        将以下内容保存为 `QuickStart.java`，放在您项目的 Java 源代码目录中（通常是 `src/main/java/`）：

        ```java Java
        import com.anthropic.client.okhttp.AnthropicOkHttpClient;
        import com.anthropic.models.messages.Message;
        import com.anthropic.models.messages.MessageCreateParams;
        import com.anthropic.models.messages.Model;

        static void main() {
            var client = AnthropicOkHttpClient.fromEnv();

            var params = MessageCreateParams.builder()
                .model(Model.CLAUDE_OPUS_4_8)
                .maxTokens(1000)
                .addUserMessage(
                    "What should I search for to find the latest developments in renewable energy?"
                )
                .build();

            Message message = client.messages().create(params);
            IO.println(message.content());
        }
        ```
      </Step>

      <Step title="运行代码">
        <Tabs>
          <Tab title="Gradle">
            ```bash
            gradle run
            ```
          </Tab>
          <Tab title="Maven">
            ```bash
            mvn compile exec:java -Dexec.mainClass=QuickStart
            ```
          </Tab>
        </Tabs>

        ```text Output
        [ContentBlock{text=TextBlock{citations=, text=Here are some effective search strategies to find the latest developments in renewable energy:

        ## General Search Terms
        - "Renewable energy news 2025"
        - ..., type=text, additionalProperties={}}}]
        ```
      </Step>
    </Steps>
  </Tab>

  <Tab title="PHP">
    <Steps>
      <Step title="设置您的 API 密钥">
        将您的 API 密钥导出为环境变量。SDK 会自动读取 `ANTHROPIC_API_KEY`。

        ```bash
        export ANTHROPIC_API_KEY="your-api-key-here"
        ```
      </Step>

      <Step title="创建项目并安装 SDK">
        ```bash
        mkdir claude-quickstart && cd claude-quickstart
        composer require "anthropic-ai/sdk" "guzzlehttp/guzzle:^7"
        ```
      </Step>

      <Step title="编写代码">
        创建一个名为 `quickstart.php` 的文件：

        ```php PHP
        <?php
        require 'vendor/autoload.php';

        use Anthropic\Client;
        use Anthropic\Messages\Model;

        $client = new Client();

        $message = $client->messages->create(
            model: Model::CLAUDE_OPUS_4_8,
            maxTokens: 1000,
            messages: [
                [
                    'role' => 'user',
                    'content' => 'What should I search for to find the latest developments in renewable energy?',
                ],
            ],
        );

        print_r($message->content);
        ```
      </Step>

      <Step title="运行代码">
        ```bash
        php quickstart.php
        ```

        ```text Output
        Array
        (
            [0] => Anthropic\Messages\TextBlock Object
                (
                    [type] => text
                    [citations] =>
                    [text] => Here are some effective search strategies to find the latest developments in renewable energy:

        ## General Search Terms
        - "Renewable energy news 2025"
        - ...
                )

        )
        ```
      </Step>
    </Steps>
  </Tab>

  <Tab title="Ruby">
    <Steps>
      <Step title="设置您的 API 密钥">
        将您的 API 密钥导出为环境变量。SDK 会自动读取 `ANTHROPIC_API_KEY`。

        ```bash
        export ANTHROPIC_API_KEY="your-api-key-here"
        ```
      </Step>

      <Step title="创建项目并安装 SDK">
        ```bash
        mkdir claude-quickstart && cd claude-quickstart
        bundle init
        bundle add anthropic
        ```
      </Step>

      <Step title="编写代码">
        创建一个名为 `quickstart.rb` 的文件：

        ```ruby Ruby
        require "anthropic"

        client = Anthropic::Client.new

        message = client.messages.create(
          model: Anthropic::Model::CLAUDE_OPUS_4_8,
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: "What should I search for to find the latest developments in renewable energy?"
            }
          ]
        )

        pp message.content
        ```
      </Step>

      <Step title="运行代码">
        ```bash
        bundle exec ruby quickstart.rb
        ```

        ```text Output
        [#<Anthropic::Models::TextBlock:0xc8 {text: "Here are some effective search strategies to find the latest developments in renewable energy:\n\n## General Search Terms\n- \"Renewable energy news 2025\"\n- ...", type: :text}>]
        ```
      </Step>
    </Steps>
  </Tab>
</Tabs>

## 后续步骤 \{#next-steps}

您已经完成了第一次 API 调用。接下来，学习您将在每个 Claude 集成中使用的 Messages API 模式。

<Card title="使用 Messages API" icon="messages" href="/docs/zh-CN/build-with-claude/working-with-messages">
  学习多轮对话、系统提示、停止原因以及其他核心模式。
</Card>

熟悉基础知识后，可以进一步探索：

<CardGroup cols={3}>
  <Card title="模型概览" icon="brain" href="/docs/zh-CN/about-claude/models/overview">
    按能力和成本比较 Claude 模型。
  </Card>
  <Card title="功能概览" icon="list" href="/docs/zh-CN/build-with-claude/overview">
    浏览 Claude 的所有功能：工具、上下文管理、结构化输出等。
  </Card>
  <Card title="客户端 SDK" icon="code-brackets" href="/docs/zh-CN/cli-sdks-libraries/overview">
    Python、TypeScript、C# 及其他客户端库的参考文档。
  </Card>
</CardGroup>