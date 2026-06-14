# 细粒度工具流式传输

为对延迟敏感的应用程序流式传输工具输入，无需服务器端 JSON 缓冲。

---

<Note>
此功能符合[零数据保留（ZDR）](/docs/zh-CN/build-with-claude/api-and-data-retention)的条件。当您的组织签订了 ZDR 协议时，通过此功能发送的数据在 API 响应返回后不会被存储。
</Note>

"Fine-grained tool streaming"（细粒度工具流式传输）在所有模型和所有平台上均可用。它支持对工具使用参数值进行[流式传输](/docs/zh-CN/build-with-claude/streaming)，无需缓冲或 JSON 验证，从而减少开始接收大型参数时的延迟。

<Warning>
使用细粒度工具流式传输时，您可能会收到无效或不完整的 JSON 输入。请确保在您的代码中处理这些边缘情况。
</Warning>

## 如何使用细粒度工具流式传输 \{#how-to-use-fine-grained-tool-streaming}
细粒度工具流式传输在 Claude API、[AWS 上的 Claude Platform](/docs/zh-CN/build-with-claude/claude-platform-on-aws)、[Amazon Bedrock](/docs/zh-CN/build-with-claude/claude-in-amazon-bedrock)、[Vertex AI](/docs/zh-CN/build-with-claude/claude-on-vertex-ai) 和 [Microsoft Foundry](/docs/zh-CN/build-with-claude/claude-in-microsoft-foundry) 上均受支持。要使用此功能，请在您希望启用细粒度流式传输的任何用户定义工具上将 `eager_input_streaming` 设置为 `true`，并在您的请求中启用流式传输。

以下是如何通过 API 使用细粒度工具流式传输的示例：

<CodeGroup>

  ```bash cURL
  curl https://api.anthropic.com/v1/messages \
    -H "content-type: application/json" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -d '{
      "model": "claude-opus-4-8",
      "max_tokens": 65536,
      "tools": [
        {
          "name": "make_file",
          "description": "Write text to a file",
          "eager_input_streaming": true,
          "input_schema": {
            "type": "object",
            "properties": {
              "filename": {
                "type": "string",
                "description": "The filename to write text to"
              },
              "lines_of_text": {
                "type": "array",
                "description": "An array of lines of text to write to the file"
              }
            },
            "required": ["filename", "lines_of_text"]
          }
        }
      ],
      "messages": [
        {
          "role": "user",
          "content": "Can you write a long poem and make a file called poem.txt?"
        }
      ],
      "stream": true
    }'
  ```

  ```bash CLI
  ant messages create --stream --format jsonl <<'YAML' |
  model: claude-opus-4-8
  max_tokens: 65536
  tools:
    - name: make_file
      description: Write text to a file
      eager_input_streaming: true
      input_schema:
        type: object
        properties:
          filename:
            type: string
            description: The filename to write text to
          lines_of_text:
            type: array
            description: An array of lines of text to write to the file
        required:
          - filename
          - lines_of_text
  messages:
    - role: user
      content: Can you write a long poem and make a file called poem.txt?
  YAML
    jq 'select(.type == "message_delta") | .usage'
  ```

  ```python Python hidelines={1..2}
  import anthropic

  client = anthropic.Anthropic()

  with client.messages.stream(
      max_tokens=65536,
      model="claude-opus-4-8",
      tools=[
          {
              "name": "make_file",
              "description": "Write text to a file",
              "eager_input_streaming": True,
              "input_schema": {
                  "type": "object",
                  "properties": {
                      "filename": {
                          "type": "string",
                          "description": "The filename to write text to",
                      },
                      "lines_of_text": {
                          "type": "array",
                          "description": "An array of lines of text to write to the file",
                      },
                  },
                  "required": ["filename", "lines_of_text"],
              },
          }
      ],
      messages=[
          {
              "role": "user",
              "content": "Can you write a long poem and make a file called poem.txt?",
          }
      ],
  ) as stream:
      final_message = stream.get_final_message()

  print(f"Input tokens: {final_message.usage.input_tokens}")
  print(f"Output tokens: {final_message.usage.output_tokens}")
  ```

  ```typescript TypeScript hidelines={1..2}
  import Anthropic from "@anthropic-ai/sdk";

  const anthropic = new Anthropic();

  const stream = anthropic.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 65536,
    tools: [
      {
        name: "make_file",
        description: "Write text to a file",
        eager_input_streaming: true,
        input_schema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "The filename to write text to"
            },
            lines_of_text: {
              type: "array",
              description: "An array of lines of text to write to the file"
            }
          },
          required: ["filename", "lines_of_text"]
        }
      }
    ],
    messages: [
      {
        role: "user",
        content: "Can you write a long poem and make a file called poem.txt?"
      }
    ]
  });

  const message = await stream.finalMessage();
  console.log(`Input tokens: ${message.usage.input_tokens}`);
  console.log(`Output tokens: ${message.usage.output_tokens}`);
  ```

  ```csharp C# hidelines={1..4}
  using System.Text.Json;
  using Anthropic;
  using Anthropic.Models.Messages;

  AnthropicClient client = new();

  MessageCreateParams parameters = new()
  {
      Model = Model.ClaudeOpus4_8,
      MaxTokens = 65536,
      Tools =
      [
          new Tool
          {
              Name = "make_file",
              Description = "Write text to a file",
              EagerInputStreaming = true,
              InputSchema = new InputSchema
              {
                  Properties = new Dictionary<string, JsonElement>
                  {
                      ["filename"] = JsonSerializer.SerializeToElement(
                          new { type = "string", description = "The filename to write text to" }
                      ),
                      ["lines_of_text"] = JsonSerializer.SerializeToElement(
                          new { type = "array", description = "An array of lines of text to write to the file" }
                      ),
                  },
                  Required = ["filename", "lines_of_text"],
              },
          },
      ],
      Messages =
      [
          new()
          {
              Role = Role.User,
              Content = "Can you write a long poem and make a file called poem.txt?",
          },
      ],
  };

  long inputTokens = 0;
  long outputTokens = 0;

  await foreach (var streamEvent in client.Messages.CreateStreaming(parameters))
  {
      switch (streamEvent.Value)
      {
          case RawMessageStartEvent startEvent:
              inputTokens = startEvent.Message.Usage.InputTokens;
              break;
          case RawMessageDeltaEvent deltaEvent:
              outputTokens = deltaEvent.Usage.OutputTokens;
              break;
      }
  }

  Console.WriteLine($"Input tokens: {inputTokens}");
  Console.WriteLine($"Output tokens: {outputTokens}");
  ```

  ```go Go hidelines={1..10,-1}
  package main

  import (
  	"context"
  	"fmt"

  	"github.com/anthropics/anthropic-sdk-go"
  )

  func main() {
  	client := anthropic.NewClient()

  	makeFileTool := anthropic.ToolParam{
  		Name:                "make_file",
  		Description:         anthropic.String("Write text to a file"),
  		EagerInputStreaming: anthropic.Bool(true),
  		InputSchema: anthropic.ToolInputSchemaParam{
  			Properties: map[string]any{
  				"filename": map[string]any{
  					"type":        "string",
  					"description": "The filename to write text to",
  				},
  				"lines_of_text": map[string]any{
  					"type":        "array",
  					"description": "An array of lines of text to write to the file",
  				},
  			},
  			Required: []string{"filename", "lines_of_text"},
  		},
  	}

  	stream := client.Messages.NewStreaming(context.Background(), anthropic.MessageNewParams{
  		Model:     anthropic.ModelClaudeOpus4_8,
  		MaxTokens: 65536,
  		Tools:     []anthropic.ToolUnionParam{{OfTool: &makeFileTool}},
  		Messages: []anthropic.MessageParam{
  			anthropic.NewUserMessage(anthropic.NewTextBlock(
  				"Can you write a long poem and make a file called poem.txt?",
  			)),
  		},
  	})

  	message := anthropic.Message{}
  	for stream.Next() {
  		event := stream.Current()
  		if err := message.Accumulate(event); err != nil {
  			panic(err)
  		}
  	}
  	if err := stream.Err(); err != nil {
  		panic(err)
  	}

  	fmt.Printf("Input tokens: %d\n", message.Usage.InputTokens)
  	fmt.Printf("Output tokens: %d\n", message.Usage.OutputTokens)
  }
  ```

  ```java Java hidelines={1..12,-1}
  import com.anthropic.client.AnthropicClient;
  import com.anthropic.client.okhttp.AnthropicOkHttpClient;
  import com.anthropic.core.JsonValue;
  import com.anthropic.core.http.StreamResponse;
  import com.anthropic.helpers.MessageAccumulator;
  import com.anthropic.models.messages.MessageCreateParams;
  import com.anthropic.models.messages.Model;
  import com.anthropic.models.messages.RawMessageStreamEvent;
  import com.anthropic.models.messages.Tool;
  import com.anthropic.models.messages.Usage;

  void main() {
      AnthropicClient client = AnthropicOkHttpClient.fromEnv();

      Tool makeFileTool = Tool.builder()
          .name("make_file")
          .description("Write text to a file")
          .eagerInputStreaming(true)
          .inputSchema(Tool.InputSchema.builder()
              .properties(Tool.InputSchema.Properties.builder()
                  .putAdditionalProperty("filename", JsonValue.from(Map.of(
                      "type", "string",
                      "description", "The filename to write text to")))
                  .putAdditionalProperty("lines_of_text", JsonValue.from(Map.of(
                      "type", "array",
                      "description", "An array of lines of text to write to the file")))
                  .build())
              .addRequired("filename")
              .addRequired("lines_of_text")
              .build())
          .build();

      MessageCreateParams params = MessageCreateParams.builder()
          .model(Model.CLAUDE_OPUS_4_8)
          .maxTokens(65536L)
          .addTool(makeFileTool)
          .addUserMessage("Can you write a long poem and make a file called poem.txt?")
          .build();

      MessageAccumulator accumulator = MessageAccumulator.create();

      try (StreamResponse<RawMessageStreamEvent> streamResponse =
              client.messages().createStreaming(params)) {
          streamResponse.stream().forEach(accumulator::accumulate);
      }

      Usage usage = accumulator.message().usage();
      IO.println("Input tokens: " + usage.inputTokens());
      IO.println("Output tokens: " + usage.outputTokens());
  }
  ```

  ```php PHP hidelines={1..2}
  <?php

  use Anthropic\Client;
  use Anthropic\Messages\Model;
  use Anthropic\Messages\RawMessageDeltaEvent;
  use Anthropic\Messages\RawMessageStartEvent;

  $client = new Client();

  $stream = $client->messages->createStream(
      maxTokens: 65536,
      model: Model::CLAUDE_OPUS_4_8,
      tools: [
          [
              'name' => 'make_file',
              'description' => 'Write text to a file',
              'eager_input_streaming' => true,
              'input_schema' => [
                  'type' => 'object',
                  'properties' => [
                      'filename' => [
                          'type' => 'string',
                          'description' => 'The filename to write text to',
                      ],
                      'lines_of_text' => [
                          'type' => 'array',
                          'description' => 'An array of lines of text to write to the file',
                      ],
                  ],
                  'required' => ['filename', 'lines_of_text'],
              ],
          ],
      ],
      messages: [
          [
              'role' => 'user',
              'content' => 'Can you write a long poem and make a file called poem.txt?',
          ],
      ],
  );

  $inputTokens = 0;
  $outputTokens = 0;

  foreach ($stream as $event) {
      if ($event instanceof RawMessageStartEvent) {
          $inputTokens = $event->message->usage->inputTokens;
      } elseif ($event instanceof RawMessageDeltaEvent) {
          $outputTokens = $event->usage->outputTokens;
      }
  }

  echo "Input tokens: {$inputTokens}\n";
  echo "Output tokens: {$outputTokens}\n";
  ```

  ```ruby Ruby hidelines={1..2}
  require "anthropic"

  anthropic = Anthropic::Client.new

  stream = anthropic.messages.stream(
    model: Anthropic::Models::Model::CLAUDE_OPUS_4_8,
    max_tokens: 65_536,
    tools: [
      {
        name: "make_file",
        description: "Write text to a file",
        eager_input_streaming: true,
        input_schema: {
          type: "object",
          properties: {
            filename: {
              type: "string",
              description: "The filename to write text to"
            },
            lines_of_text: {
              type: "array",
              description: "An array of lines of text to write to the file"
            }
          },
          required: ["filename", "lines_of_text"]
        }
      }
    ],
    messages: [
      {
        role: "user",
        content: "Can you write a long poem and make a file called poem.txt?"
      }
    ]
  )

  usage = stream.accumulated_message.usage
  puts "Input tokens: #{usage.input_tokens}"
  puts "Output tokens: #{usage.output_tokens}"
  ```

</CodeGroup>

在此示例中，细粒度工具流式传输使 Claude 能够将一首长诗的各行流式传输到工具调用 `make_file` 中，而无需缓冲以验证 `lines_of_text` 参数是否为有效的 JSON。这意味着您可以在参数到达时实时看到其流式传输，而无需等待整个参数完成缓冲和验证。

<Note>
使用细粒度工具流式传输时，工具输入数据块会更快开始到达，因为服务器跳过了 JSON 验证缓冲。作为副作用，数据块通常更长，且包含更少的令牌中间断点。
</Note>

<Warning>
由于细粒度流式传输在发送参数时不进行缓冲或 JSON 验证，因此无法保证生成的流会以有效的 JSON 字符串结束。
特别是，如果达到了[停止原因](/docs/zh-CN/build-with-claude/handling-stop-reasons) `max_tokens`，流可能会在参数中途结束，导致参数不完整。您通常需要编写特定的支持代码来处理达到 `max_tokens` 的情况。
</Warning>

## 累积工具输入增量 \{#accumulating-tool-input-deltas}

当 `tool_use` 内容块进行流式传输时，初始的 `content_block_start` 事件包含 `input: {}`（一个空对象）。这是一个占位符。实际输入以一系列 `input_json_delta` 事件的形式到达，每个事件携带一个 `partial_json` 字符串片段。要组装完整的输入，请拼接这些片段，并在块关闭时解析结果。

如果您的 SDK 提供了累加器辅助工具（如本页第一个示例中所使用的），它会为您处理这些操作。手动模式适用于没有辅助工具的 SDK，或者当您需要在块关闭之前对部分输入做出响应时。

累积约定如下：

1. 在收到 `type: "tool_use"` 的 `content_block_start` 时，初始化一个空字符串：`input_json = ""`
2. 对于每个 `type: "input_json_delta"` 的 `content_block_delta`，进行追加：`input_json += event.delta.partial_json`
3. 在收到 `content_block_stop` 时，解析累积的字符串：`json.loads(input_json)`

初始的 `input: {}`（对象）与 `partial_json`（字符串）之间的类型不匹配是有意设计的。空对象标记了内容数组中的位置；增量字符串则构建实际的值。

<CodeGroup>

  ```python Python hidelines={1..3}
  import json
  import anthropic

  client = anthropic.Anthropic()

  tool_inputs: dict[int, str] = {}  # index -> accumulated JSON string

  with client.messages.stream(
      model="claude-opus-4-8",
      max_tokens=1024,
      tools=[
          {
              "name": "get_weather",
              "description": "Get current weather for a city",
              "eager_input_streaming": True,
              "input_schema": {
                  "type": "object",
                  "properties": {"city": {"type": "string"}},
                  "required": ["city"],
              },
          }
      ],
      messages=[{"role": "user", "content": "Weather in Paris?"}],
  ) as stream:
      for event in stream:
          match event.type:
              case "content_block_start" if event.content_block.type == "tool_use":
                  tool_inputs[event.index] = ""
              case "content_block_delta" if event.delta.type == "input_json_delta":
                  tool_inputs[event.index] += event.delta.partial_json
              case "content_block_stop" if event.index in tool_inputs:
                  parsed = json.loads(tool_inputs[event.index])
                  print(f"Tool input: {parsed}")
  ```

  ```typescript TypeScript hidelines={1..2}
  import Anthropic from "@anthropic-ai/sdk";

  const anthropic = new Anthropic();

  const toolInputs = new Map<number, string>();

  const stream = anthropic.messages.stream({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    tools: [
      {
        name: "get_weather",
        description: "Get current weather for a city",
        eager_input_streaming: true,
        input_schema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"]
        }
      }
    ],
    messages: [{ role: "user", content: "Weather in Paris?" }]
  });

  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      toolInputs.set(event.index, "");
    } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      toolInputs.set(
        event.index,
        (toolInputs.get(event.index) ?? "") + event.delta.partial_json
      );
    } else if (event.type === "content_block_stop" && toolInputs.has(event.index)) {
      const parsed = JSON.parse(toolInputs.get(event.index)!);
      console.log("Tool input:", parsed);
    }
  }
  ```

  ```csharp C# hidelines={1..5}
  using System.Text;
  using System.Text.Json;
  using Anthropic;
  using Anthropic.Models.Messages;

  AnthropicClient client = new();

  MessageCreateParams parameters = new()
  {
      Model = Model.ClaudeOpus4_8,
      MaxTokens = 1024,
      Tools =
      [
          new Tool
          {
              Name = "get_weather",
              Description = "Get current weather for a city",
              EagerInputStreaming = true,
              InputSchema = new InputSchema
              {
                  Properties = new Dictionary<string, JsonElement>
                  {
                      ["city"] = JsonSerializer.SerializeToElement(new { type = "string" }),
                  },
                  Required = ["city"],
              },
          },
      ],
      Messages = [new() { Role = Role.User, Content = "Weather in Paris?" }],
  };

  // 块索引 -> 累积的 JSON 片段
  // 此示例手动累积增量以展示原始流；
  // SDK 的 MessageContentAggregator 也可以自动累积工具输入。
  var toolInputs = new Dictionary<long, StringBuilder>();

  await foreach (var streamEvent in client.Messages.CreateStreaming(parameters))
  {
      if (
          streamEvent.TryPickContentBlockStart(out var start)
          && start.ContentBlock.TryPickToolUse(out _)
      )
      {
          toolInputs[start.Index] = new StringBuilder();
      }
      else if (
          streamEvent.TryPickContentBlockDelta(out var delta)
          && delta.Delta.TryPickInputJson(out var inputJson)
      )
      {
          toolInputs[delta.Index].Append(inputJson.PartialJson);
      }
      else if (
          streamEvent.TryPickContentBlockStop(out var stop)
          && toolInputs.TryGetValue(stop.Index, out var accumulated)
      )
      {
          using var parsed = JsonDocument.Parse(accumulated.ToString());
          Console.WriteLine($"Tool input: {parsed.RootElement}");
      }
  }
  ```

  ```go Go hidelines={1..11,-1}
  package main

  import (
  	"context"
  	"encoding/json"
  	"fmt"

  	"github.com/anthropics/anthropic-sdk-go"
  )

  func main() {
  	client := anthropic.NewClient()

  	toolInputs := map[int64]string{} // content block index -> accumulated JSON

  	stream := client.Messages.NewStreaming(context.Background(), anthropic.MessageNewParams{
  		Model:     anthropic.ModelClaudeOpus4_8,
  		MaxTokens: 1024,
  		Tools: []anthropic.ToolUnionParam{{
  			OfTool: &anthropic.ToolParam{
  				Name:                "get_weather",
  				Description:         anthropic.String("Get current weather for a city"),
  				EagerInputStreaming: anthropic.Bool(true),
  				InputSchema: anthropic.ToolInputSchemaParam{
  					Properties: map[string]any{
  						"city": map[string]any{"type": "string"},
  					},
  					Required: []string{"city"},
  				},
  			},
  		}},
  		Messages: []anthropic.MessageParam{
  			anthropic.NewUserMessage(anthropic.NewTextBlock("Weather in Paris?")),
  		},
  	})

  	for stream.Next() {
  		switch event := stream.Current().AsAny().(type) {
  		case anthropic.ContentBlockStartEvent:
  			if _, ok := event.ContentBlock.AsAny().(anthropic.ToolUseBlock); ok {
  				toolInputs[event.Index] = ""
  			}
  		case anthropic.ContentBlockDeltaEvent:
  			if delta, ok := event.Delta.AsAny().(anthropic.InputJSONDelta); ok {
  				toolInputs[event.Index] += delta.PartialJSON
  			}
  		case anthropic.ContentBlockStopEvent:
  			if accumulated, ok := toolInputs[event.Index]; ok {
  				var parsed map[string]any
  				if err := json.Unmarshal([]byte(accumulated), &parsed); err != nil {
  					panic(err)
  				}
  				fmt.Println("Tool input:", parsed)
  			}
  		}
  	}
  	if err := stream.Err(); err != nil {
  		panic(err)
  	}
  }
  ```

  ```java Java hidelines={1..11,-1}
  import com.anthropic.client.AnthropicClient;
  import com.anthropic.client.okhttp.AnthropicOkHttpClient;
  import com.anthropic.core.JsonValue;
  import com.anthropic.core.http.StreamResponse;
  import com.anthropic.models.messages.MessageCreateParams;
  import com.anthropic.models.messages.Model;
  import com.anthropic.models.messages.RawMessageStreamEvent;
  import com.anthropic.models.messages.Tool;
  import com.fasterxml.jackson.databind.ObjectMapper;

  void main() throws Exception {
      AnthropicClient client = AnthropicOkHttpClient.fromEnv();
      ObjectMapper objectMapper = new ObjectMapper();

      Tool weatherTool = Tool.builder()
              .name("get_weather")
              .description("Get current weather for a city")
              .eagerInputStreaming(true)
              .inputSchema(Tool.InputSchema.builder()
                      .properties(Tool.InputSchema.Properties.builder()
                              .putAdditionalProperty("city", JsonValue.from(Map.of("type", "string")))
                              .build())
                      .addRequired("city")
                      .build())
              .build();

      MessageCreateParams createParams = MessageCreateParams.builder()
              .model(Model.CLAUDE_OPUS_4_8)
              .maxTokens(1024)
              .addTool(weatherTool)
              .addUserMessage("Weather in Paris?")
              .build();

      // 内容块索引 -> 累积的工具输入 JSON
      Map<Long, StringBuilder> toolInputs = new HashMap<>();

      try (StreamResponse<RawMessageStreamEvent> streamResponse = client.messages().createStreaming(createParams)) {
          var eventIterator = streamResponse.stream().iterator();
          while (eventIterator.hasNext()) {
              RawMessageStreamEvent event = eventIterator.next();
              if (event.isContentBlockStart()) {
                  var blockStart = event.asContentBlockStart();
                  if (blockStart.contentBlock().isToolUse()) {
                      toolInputs.put(blockStart.index(), new StringBuilder());
                  }
              } else if (event.isContentBlockDelta()) {
                  var blockDelta = event.asContentBlockDelta();
                  if (blockDelta.delta().isInputJson() && toolInputs.containsKey(blockDelta.index())) {
                      toolInputs.get(blockDelta.index()).append(blockDelta.delta().asInputJson().partialJson());
                  }
              } else if (event.isContentBlockStop()) {
                  var blockStop = event.asContentBlockStop();
                  if (toolInputs.containsKey(blockStop.index())) {
                      var parsedInput = objectMapper.readTree(toolInputs.get(blockStop.index()).toString());
                      IO.println("Tool input: " + parsedInput);
                  }
              }
          }
      }
  }
  ```

  ```php PHP hidelines={1..2}
  <?php

  use Anthropic\Client;
  use Anthropic\Messages\InputJSONDelta;
  use Anthropic\Messages\Model;
  use Anthropic\Messages\RawContentBlockDeltaEvent;
  use Anthropic\Messages\RawContentBlockStartEvent;
  use Anthropic\Messages\RawContentBlockStopEvent;
  use Anthropic\Messages\ToolUseBlock;

  $client = new Client();

  // PHP SDK 目前不提供用于工具输入的流累加器；
  // 此处展示的手动模式是受支持的方法。
  $toolInputs = []; // index => accumulated JSON string

  $stream = $client->messages->createStream(
      maxTokens: 1024,
      model: Model::CLAUDE_OPUS_4_8,
      tools: [
          [
              'name' => 'get_weather',
              'description' => 'Get current weather for a city',
              'eager_input_streaming' => true,
              'input_schema' => [
                  'type' => 'object',
                  'properties' => ['city' => ['type' => 'string']],
                  'required' => ['city'],
              ],
          ],
      ],
      messages: [['role' => 'user', 'content' => 'Weather in Paris?']],
  );

  foreach ($stream as $event) {
      if (
          $event instanceof RawContentBlockStartEvent
          && $event->contentBlock instanceof ToolUseBlock
      ) {
          $toolInputs[$event->index] = '';
      } elseif (
          $event instanceof RawContentBlockDeltaEvent
          && $event->delta instanceof InputJSONDelta
      ) {
          $toolInputs[$event->index] .= $event->delta->partialJSON;
      } elseif (
          $event instanceof RawContentBlockStopEvent
          && isset($toolInputs[$event->index])
      ) {
          $parsed = json_decode($toolInputs[$event->index], associative: true, flags: JSON_THROW_ON_ERROR);
          echo "Tool input: " . json_encode($parsed) . "\n";
      }
  }
  ```

  ```ruby Ruby hidelines={1..3}
  require "anthropic"
  require "json"

  client = Anthropic::Client.new

  tool_inputs = {} # index -> accumulated JSON string

  stream = client.messages.stream_raw(
    model: Anthropic::Models::Model::CLAUDE_OPUS_4_8,
    max_tokens: 1024,
    tools: [
      {
        name: "get_weather",
        description: "Get current weather for a city",
        eager_input_streaming: true,
        input_schema: {
          type: "object",
          properties: {city: {type: "string"}},
          required: ["city"]
        }
      }
    ],
    messages: [{role: "user", content: "Weather in Paris?"}]
  )

  stream.each do |event|
    case event
    when Anthropic::Models::RawContentBlockStartEvent
      tool_inputs[event.index] = +"" if event.content_block.type == :tool_use
    when Anthropic::Models::RawContentBlockDeltaEvent
      if event.delta.is_a?(Anthropic::Models::InputJSONDelta)
        tool_inputs[event.index] << event.delta.partial_json
      end
    when Anthropic::Models::RawContentBlockStopEvent
      if tool_inputs.key?(event.index)
        parsed = JSON.parse(tool_inputs[event.index])
        puts "Tool input: #{parsed}"
      end
    end
  end
  ```

</CodeGroup>

<Tip>
当您需要在块关闭之前对部分输入做出响应时（例如，渲染进度指示器），请使用手动模式。否则，请优先使用您的 SDK 的累加器辅助工具（本页第一个示例中使用了该工具）。
</Tip>

## 处理工具响应中的无效 JSON \{#handling-invalid-json-in-tool-responses}

使用细粒度工具流式传输时，您可能会从模型收到无效或不完整的 JSON。如果您需要在错误响应块中将此无效 JSON 传回给模型，可以将其包装在一个 JSON 对象中（使用合理的键名）以确保正确处理。例如：

```json
{
  "INVALID_JSON": "<your invalid json string>"
}
```

这种方法有助于模型理解该内容是无效的 JSON，同时保留原始的格式错误数据以供调试之用。

<Note>
包装无效 JSON 时，请确保正确转义无效 JSON 字符串中的任何引号或特殊字符，以保持包装对象中的 JSON 结构有效。
</Note>

## 后续步骤 \{#next-steps}

<CardGroup cols={3}>
  <Card title="流式传输消息" href="/docs/zh-CN/build-with-claude/streaming">
    服务器发送事件和流事件类型的完整参考。
  </Card>
  <Card title="处理工具调用" href="/docs/zh-CN/agents-and-tools/tool-use/handle-tool-calls">
    执行工具并以所需的消息格式返回结果。
  </Card>
  <Card title="工具参考" href="/docs/zh-CN/agents-and-tools/tool-use/tool-reference">
    Anthropic 架构工具及其版本字符串的完整目录。
  </Card>
</CardGroup>