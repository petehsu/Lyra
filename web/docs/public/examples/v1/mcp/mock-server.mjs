import readline from "node:readline";

const write = (value) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const methods = [];
const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
  terminal: false
});

input.on("line", (line) => {
  const message = JSON.parse(line);
  methods.push(message.method);

  if (message.method === "notifications/initialized") {
    return;
  }
  if (message.method === "initialize") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "lyra-docs-fixture", version: "1.0.0" }
      }
    });
    return;
  }
  if (message.method === "tools/list") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "fixture.echo",
            description: "Return the supplied text.",
            inputSchema: {
              type: "object",
              required: ["text"],
              properties: { text: { type: "string" } }
            }
          }
        ]
      }
    });
    return;
  }
  if (message.method === "tools/call") {
    write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [
          {
            type: "text",
            text: String(message.params?.arguments?.text ?? "")
          }
        ],
        fixtureMethods: methods
      }
    });
    return;
  }
  write({
    jsonrpc: "2.0",
    id: message.id ?? null,
    error: { code: -32601, message: "Method not found" }
  });
});
