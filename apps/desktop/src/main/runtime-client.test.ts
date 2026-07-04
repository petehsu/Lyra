import path from "node:path";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test } from "vitest";

import { createLyraRuntimeClient, runtimeClientInternalsForTests } from "./runtime-client";

type JsonRecord = Record<string, unknown>;

const tempRoots: string[] = [];
const servers: net.Server[] = [];
const originalRuntimeBin = process.env.LYRA_RUNTIME_BIN;

const makeTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), "lyra-runtime-client-test-"));
  tempRoots.push(root);
  return root;
};

const closeServer = async (server: net.Server): Promise<void> => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
};

const readEnvelope = async (socket: net.Socket): Promise<JsonRecord> => {
  socket.setEncoding("utf8");
  let buffer = "";
  return await new Promise((resolve, reject) => {
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const index = buffer.indexOf("\n");
      if (index < 0) {
        return;
      }
      const line = buffer.slice(0, index);
      try {
        resolve(JSON.parse(line) as JsonRecord);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("error", reject);
    socket.once("close", () => reject(new Error("socket closed")));
  });
};

const writeEnvelope = (socket: net.Socket, envelope: JsonRecord): void => {
  socket.write(`${JSON.stringify(envelope)}\n`);
};

const listenRuntimeServer = async (
  socketPath: string,
  handler: (socket: net.Socket) => void | Promise<void>
): Promise<net.Server> => {
  if (process.platform !== "win32") {
    await mkdir(path.dirname(socketPath), { recursive: true });
    await rm(socketPath, { force: true });
  }
  const server = net.createServer((socket) => {
    void Promise.resolve(handler(socket)).catch((error) => {
      socket.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  server.removeAllListeners("error");
  return server;
};

const startHandshakeServer = async (
  socketPath: string,
  onRequest: (socket: net.Socket, envelope: JsonRecord) => void | Promise<void>
): Promise<net.Server> => listenRuntimeServer(socketPath, async (socket) => {
  const handshake = await readEnvelope(socket);
  writeEnvelope(socket, {
    kind: "response",
    id: handshake.id,
    ok: true,
    result: {
      protocolVersion: 1,
      serverName: "fake-lyrad",
      capabilities: ["agent.codegraph.status"]
    }
  });
  const request = await readEnvelope(socket);
  await onRequest(socket, request);
});

afterEach(async () => {
  if (originalRuntimeBin === undefined) {
    delete process.env.LYRA_RUNTIME_BIN;
  } else {
    process.env.LYRA_RUNTIME_BIN = originalRuntimeBin;
  }
  await Promise.all(servers.splice(0).map((server) => closeServer(server).catch(() => undefined)));
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Lyra runtime client", () => {
  test("starts lyrad with Lyra Agent storage aliases under the Agent module root", () => {
    const env = runtimeClientInternalsForTests.buildRuntimeDaemonEnv(
      {
        PATH: "/bin",
        LYRA_AGENT_HOME: "/legacy/.lyra-agent",
        LYRA_AGENT_RUNTIME_DIR: "/legacy/lyra-agent-runtime",
        JCODE_HOME: "/legacy/.agent",
        JCODE_RUNTIME_DIR: "/legacy/runtime"
      },
      {
        storageRoot: "/Users/tester/.lyra/modules/runtime",
        agentStorageRoot: "/Users/tester/.lyra/modules/agent"
      },
      "/Applications/Lyra.app/Contents/MacOS/Lyra"
    );

    expect(env.PATH).toBe("/bin");
    expect(env.ELECTRON_RUN_AS_NODE).toBe("");
    expect(env.LYRA_AGENT_HOME).toBe("/Users/tester/.lyra/modules/agent");
    expect(env.LYRA_AGENT_RUNTIME_DIR).toBe(
      path.join("/Users/tester/.lyra/modules/agent", "runtime")
    );
    expect(env.JCODE_HOME).toBe("/Users/tester/.lyra/modules/agent");
    expect(env.JCODE_RUNTIME_DIR).toBe(
      path.join("/Users/tester/.lyra/modules/agent", "runtime")
    );
    expect(env.LYRA_JS_REPL_NODE_PATH).toBe(
      "/Applications/Lyra.app/Contents/MacOS/Lyra"
    );
    expect(env.LYRA_JS_REPL_NODE_RUN_AS_NODE).toBe("1");
    expect(env.LYRA_DESIGN_NODE_PATH).toBe(
      "/Applications/Lyra.app/Contents/MacOS/Lyra"
    );
    expect(env.LYRA_DESIGN_NODE_RUN_AS_NODE).toBe("1");
    expect(env.LYRA_DESIGN_NODE_PATHS).toContain("node_modules");
    expect(env.PLAYWRIGHT_BROWSERS_PATH).toContain("playwright-browsers");
  });

  test("preserves explicit Playwright browser bundle override", () => {
    const env = runtimeClientInternalsForTests.buildRuntimeDaemonEnv(
      {
        PLAYWRIGHT_BROWSERS_PATH: "/custom/ms-playwright"
      },
      {
        storageRoot: "/Users/tester/.lyra/modules/runtime",
        agentStorageRoot: "/Users/tester/.lyra/modules/agent"
      },
      "/Applications/Lyra.app/Contents/MacOS/Lyra"
    );

    expect(env.PLAYWRIGHT_BROWSERS_PATH).toBe("/custom/ms-playwright");
  });

  test("resolves runtime host request timeout from tool payload", () => {
    expect(
      runtimeClientInternalsForTests.resolveRuntimeHostRequestTimeoutMs({ timeoutMs: 8_000 })
    ).toBe(8_000);
    expect(
      runtimeClientInternalsForTests.resolveRuntimeHostRequestTimeoutMs({
        runtimeCancellation: { timeoutMs: 12_000 }
      })
    ).toBe(12_000);
    expect(
      runtimeClientInternalsForTests.resolveRuntimeHostRequestTimeoutMs({ timeoutMs: 1 })
    ).toBe(250);
    expect(
      runtimeClientInternalsForTests.resolveRuntimeHostRequestTimeoutMs({ timeoutMs: 999_999 })
    ).toBe(120_000);
  });

  test("rejects protocol mismatch during handshake without daemon fallback", async () => {
    process.env.LYRA_RUNTIME_BIN = process.execPath;
    const storageRoot = await makeTempRoot();
    const socketPath = runtimeClientInternalsForTests.resolveSocketPath(storageRoot);
    await listenRuntimeServer(socketPath, async (socket) => {
      const handshake = await readEnvelope(socket);
      writeEnvelope(socket, {
        kind: "response",
        id: handshake.id,
        ok: true,
        result: { protocolVersion: 99, serverName: "old-lyrad" }
      });
    });

    const client = createLyraRuntimeClient({
      storageRoot,
      agentStorageRoot: path.join(storageRoot, "agent")
    });

    await expect(client.request("runtime.reload", {}))
      .rejects.toThrow("Lyra runtime protocol mismatch");
    client.dispose();
  });

  test("rejects pending requests when the runtime socket closes", async () => {
    process.env.LYRA_RUNTIME_BIN = process.execPath;
    const storageRoot = await makeTempRoot();
    const socketPath = runtimeClientInternalsForTests.resolveSocketPath(storageRoot);
    await startHandshakeServer(socketPath, (socket) => {
      socket.destroy();
    });

    const client = createLyraRuntimeClient({
      storageRoot,
      agentStorageRoot: path.join(storageRoot, "agent")
    });

    await expect(client.request("runtime.reload", {})).rejects.toThrow(/socket closed|daemon exited/u);
    client.dispose();
  });

  test("reconnects after a socket disconnect", async () => {
    process.env.LYRA_RUNTIME_BIN = process.execPath;
    const storageRoot = await makeTempRoot();
    const socketPath = runtimeClientInternalsForTests.resolveSocketPath(storageRoot);
    const firstServer = await startHandshakeServer(socketPath, (socket) => {
      socket.destroy();
    });

    const client = createLyraRuntimeClient({
      storageRoot,
      agentStorageRoot: path.join(storageRoot, "agent")
    });
    await expect(client.request("runtime.reload", {})).rejects.toThrow();
    await closeServer(firstServer);

    await startHandshakeServer(socketPath, (socket, request) => {
      writeEnvelope(socket, {
        kind: "response",
        id: request.id,
        ok: true,
        result: { status: "reloaded" }
      });
    });

    await expect(client.request("runtime.reload", {})).resolves.toEqual({ status: "reloaded" });
    client.dispose();
  });

  test("rejects oversized runtime frames instead of buffering forever", async () => {
    process.env.LYRA_RUNTIME_BIN = process.execPath;
    const storageRoot = await makeTempRoot();
    const socketPath = runtimeClientInternalsForTests.resolveSocketPath(storageRoot);
    const maxRuntimeFrameBytes = 1024;
    await startHandshakeServer(socketPath, (socket) => {
      socket.write("x".repeat(maxRuntimeFrameBytes + 1));
    });

    const client = createLyraRuntimeClient({
      storageRoot,
      agentStorageRoot: path.join(storageRoot, "agent"),
      maxRuntimeFrameBytes
    });

    await expect(client.request("runtime.reload", {})).rejects.toThrow("frame too large");
    client.dispose();
  });

  test("rejects pending requests on malformed runtime frames", async () => {
    process.env.LYRA_RUNTIME_BIN = process.execPath;
    const storageRoot = await makeTempRoot();
    const socketPath = runtimeClientInternalsForTests.resolveSocketPath(storageRoot);
    await startHandshakeServer(socketPath, (socket) => {
      socket.write("{not-json}\n");
    });

    const client = createLyraRuntimeClient({
      storageRoot,
      agentStorageRoot: path.join(storageRoot, "agent")
    });

    await expect(client.request("runtime.reload", {})).rejects.toThrow("decode failed");
    client.dispose();
  });
});
