import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(
  docsRoot,
  "public",
  "examples",
  "v1",
  "mcp",
  "mock-server.mjs"
);
const child = spawn(process.execPath, [serverPath], {
  stdio: ["pipe", "pipe", "inherit"]
});
const output = readline.createInterface({
  input: child.stdout,
  crlfDelay: Infinity,
  terminal: false
});
const pending = new Map();

output.on("line", (line) => {
  const message = JSON.parse(line);
  const resolve = pending.get(message.id);
  if (resolve !== undefined) {
    pending.delete(message.id);
    resolve(message);
  }
});

const send = (message) => {
  child.stdin.write(`${JSON.stringify(message)}\n`);
};

const request = (id, method, params) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, 5_000);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      if (message.error !== undefined) {
        reject(new Error(`${method}: ${message.error.message}`));
      } else {
        resolve(message.result);
      }
    });
    send({ jsonrpc: "2.0", id, method, params });
  });

try {
  const initialized = await request(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "lyra", version: "0.1.0" }
  });
  if (initialized.protocolVersion !== "2024-11-05") {
    throw new Error("fixture returned an unexpected protocol version");
  }
  send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {}
  });
  const listed = await request(2, "tools/list", {});
  if (listed.tools?.[0]?.name !== "fixture.echo") {
    throw new Error("tools/list did not return fixture.echo");
  }
  const called = await request(3, "tools/call", {
    name: "fixture.echo",
    arguments: { text: "Lyra MCP smoke" }
  });
  if (
    called.content?.[0]?.text !== "Lyra MCP smoke"
    || !called.fixtureMethods?.includes("notifications/initialized")
  ) {
    throw new Error("tools/call did not round-trip text after initialized notification");
  }
  console.log("[mcp] initialize, notifications/initialized, tools/list, and tools/call passed");
} finally {
  child.stdin.end();
  output.close();
  child.kill();
}
