import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocket, type RawData } from "ws";

import { createAgentVmConsoleBridge } from "../agent-vm-console";

const VNC_TEST_PORT_START = 5999;
const VNC_TEST_PORT_END = 5900;

type TestVncServer = {
  readonly close: () => Promise<void>;
  readonly port: number;
  readonly server: Server;
  readonly sockets: Set<Socket>;
};

const openBridges: Array<ReturnType<typeof createAgentVmConsoleBridge>> = [];
const openServers: TestVncServer[] = [];

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      server.off("error", onError);
      server.off("listening", onListening);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onListening = (): void => {
      cleanup();
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });

const closeServer = async (server: TestVncServer): Promise<void> => {
  for (const socket of [...server.sockets]) {
    socket.destroy();
  }
  await new Promise<void>((resolve) => {
    server.server.close(() => {
      resolve();
    });
  });
};

const createTestVncServer = async (
  onConnection?: (socket: Socket) => void
): Promise<TestVncServer> => {
  for (let port = VNC_TEST_PORT_START; port >= VNC_TEST_PORT_END; port -= 1) {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
      });
      socket.on("error", () => {});
      socket.write("RFB 003.008\n");
      onConnection?.(socket);
    });
    try {
      await listen(server, port);
      let testServer: TestVncServer;
      testServer = {
        close: () => closeServer(testServer),
        port,
        server,
        sockets
      };
      openServers.push(testServer);
      return testServer;
    } catch (error) {
      server.removeAllListeners();
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") {
        throw error;
      }
    }
  }
  throw new Error("No VNC test port is available");
};

const waitForWebSocketMessage = (webSocket: WebSocket): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const cleanup = (): void => {
      webSocket.off("message", onMessage);
      webSocket.off("error", onError);
      webSocket.off("close", onClose);
    };
    const onMessage = (data: RawData): void => {
      cleanup();
      if (Buffer.isBuffer(data)) {
        resolve(data);
        return;
      }
      if (data instanceof ArrayBuffer) {
        resolve(Buffer.from(data));
        return;
      }
      resolve(Buffer.concat(data));
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error("WebSocket closed before receiving data"));
    };
    webSocket.once("message", onMessage);
    webSocket.once("error", onError);
    webSocket.once("close", onClose);
  });

const waitForWebSocketClose = (webSocket: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (
      webSocket.readyState === WebSocket.CLOSED ||
      webSocket.readyState === WebSocket.CLOSING
    ) {
      resolve();
      return;
    }
    webSocket.once("close", () => {
      resolve();
    });
  });

describe("Agent VM console bridge", () => {
  afterEach(async () => {
    for (const bridge of openBridges.splice(0)) {
      bridge.dispose();
    }
    await Promise.all(openServers.splice(0).map((server) => server.close()));
  });

  test("proxies WebSocket traffic to the VNC TCP socket", async () => {
    let receivedClientData: ((value: Buffer) => void) | null = null;
    const receivedClientDataPromise = new Promise<Buffer>((resolve) => {
      receivedClientData = resolve;
    });
    const vncServer = await createTestVncServer((socket) => {
      socket.on("data", (chunk) => {
        receivedClientData?.(chunk);
      });
    });
    const bridge = createAgentVmConsoleBridge();
    openBridges.push(bridge);

    const session = await bridge.open({ vmId: "vm-a", vncPort: vncServer.port });
    const webSocket = new WebSocket(session.url);
    webSocket.binaryType = "nodebuffer";

    const greeting = await waitForWebSocketMessage(webSocket);
    expect(greeting.toString("ascii")).toBe("RFB 003.008\n");

    webSocket.send(Buffer.from("client-hello"));
    await expect(receivedClientDataPromise).resolves.toEqual(Buffer.from("client-hello"));
    webSocket.close();
  });

  test("reuses one bridge URL for repeated opens of the same VM", async () => {
    const vncServer = await createTestVncServer();
    const bridge = createAgentVmConsoleBridge();
    openBridges.push(bridge);

    const first = await bridge.open({ vmId: "vm-a", vncPort: vncServer.port });
    const second = await bridge.open({ vmId: "vm-a", vncPort: vncServer.port });

    expect(second).toEqual(first);
  });

  test("closes the previous console client when a replacement connects", async () => {
    const vncServer = await createTestVncServer();
    const bridge = createAgentVmConsoleBridge();
    openBridges.push(bridge);
    const session = await bridge.open({ vmId: "vm-a", vncPort: vncServer.port });

    const first = new WebSocket(session.url);
    first.binaryType = "nodebuffer";
    await waitForWebSocketMessage(first);

    const firstClosed = waitForWebSocketClose(first);
    const second = new WebSocket(session.url);
    second.binaryType = "nodebuffer";
    await waitForWebSocketMessage(second);

    await firstClosed;
    second.close();
  });
});
