import { randomUUID } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { createConnection, type Socket } from "node:net";
import { URL } from "node:url";
import { WebSocket, WebSocketServer, type RawData } from "ws";

const LOOPBACK_HOST = "127.0.0.1";
const MIN_VNC_PORT = 5900;
const MAX_VNC_PORT = 5999;
const VNC_CONNECT_TIMEOUT_MS = 30_000;
const VNC_CONNECT_RETRY_MS = 150;

export type AgentVmConsoleOpenRequest = {
  readonly vmId: string;
  readonly vncPort: number;
};

export type AgentVmConsoleOpenResult = {
  readonly vmId: string;
  readonly vncPort: number;
  readonly url: string;
};

type ConsoleSession = {
  readonly vmId: string;
  readonly vncPort: number;
  readonly url: string;
  readonly server: HttpServer;
  readonly wsServer: WebSocketServer;
  readonly clients: Set<ConsoleClient>;
};

type ConsoleClient = {
  readonly close: () => void;
};

const normalizeVmId = (value: string): string => {
  const vmId = value.trim();
  if (vmId.length === 0) {
    throw new Error("AgentVmConsoleInvalid: vmId is required");
  }
  return vmId;
};

const normalizeVncPort = (value: number): number => {
  if (!Number.isInteger(value) || value < MIN_VNC_PORT || value > MAX_VNC_PORT) {
    throw new Error("AgentVmConsoleInvalid: VNC port is unavailable");
  }
  return value;
};

const rawDataToBuffer = (data: RawData): Buffer => {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
};

const closeWebSocket = (socket: WebSocket): void => {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
};

const waitForListening = (server: HttpServer): Promise<number> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("AgentVmConsoleUnavailable: local console bridge did not bind"));
        return;
      }
      resolve(address.port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, LOOPBACK_HOST);
  });

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

const connectToVnc = (vncPort: number): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const socket = createConnection({ host: LOOPBACK_HOST, port: vncPort });
    const cleanup = (): void => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = (): void => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error): void => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    socket.once("connect", onConnect);
    socket.once("error", onError);
  });

const connectToVncWithRetry = async (
  vncPort: number,
  shouldContinue: () => boolean
): Promise<Socket> => {
  const deadline = Date.now() + VNC_CONNECT_TIMEOUT_MS;
  let lastError: unknown = null;
  while (shouldContinue()) {
    try {
      return await connectToVnc(vncPort);
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) {
        break;
      }
      await delay(VNC_CONNECT_RETRY_MS);
    }
  }
  const detail = lastError instanceof Error && lastError.message.length > 0
    ? `: ${lastError.message}`
    : "";
  throw new Error(`AgentVmConsoleUnavailable: VNC console is not listening on ${LOOPBACK_HOST}:${vncPort}${detail}`);
};

const waitForVncPort = async (vncPort: number): Promise<void> => {
  const socket = await connectToVncWithRetry(vncPort, () => true);
  socket.destroy();
};

export const createAgentVmConsoleBridge = (): {
  readonly open: (request: AgentVmConsoleOpenRequest) => Promise<AgentVmConsoleOpenResult>;
  readonly dispose: () => void;
} => {
  const sessions = new Map<string, ConsoleSession>();
  const tokenByVmId = new Map<string, string>();

  const closeSession = (token: string): void => {
    const session = sessions.get(token);
    if (session === undefined) {
      return;
    }
    sessions.delete(token);
    for (const [vmId, candidateToken] of tokenByVmId) {
      if (candidateToken === token) {
        tokenByVmId.delete(vmId);
      }
    }
    for (const client of [...session.clients]) {
      client.close();
    }
    session.wsServer.close();
    session.server.close();
  };

  const open = async (request: AgentVmConsoleOpenRequest): Promise<AgentVmConsoleOpenResult> => {
    const vmId = normalizeVmId(request.vmId);
    const vncPort = normalizeVncPort(request.vncPort);
    const previousToken = tokenByVmId.get(vmId);
    if (previousToken !== undefined) {
      const previousSession = sessions.get(previousToken);
      if (previousSession?.vncPort === vncPort) {
        return {
          vmId,
          vncPort,
          url: previousSession.url
        };
      }
      closeSession(previousToken);
    }
    await waitForVncPort(vncPort);
    const token = randomUUID();
    const path = `/agent-vm/${token}`;
    const server = createServer((_request, response) => {
      response.statusCode = 404;
      response.end();
    });
    const wsServer = new WebSocketServer({ noServer: true });
    const clients = new Set<ConsoleClient>();

    server.on("upgrade", (upgradeRequest, socket, head) => {
      const url = new URL(upgradeRequest.url ?? "/", `http://${LOOPBACK_HOST}`);
      if (url.pathname !== path) {
        socket.destroy();
        return;
      }
      wsServer.handleUpgrade(upgradeRequest, socket, head, (webSocket) => {
        wsServer.emit("connection", webSocket, upgradeRequest);
      });
    });

    const closeClients = (): void => {
      for (const client of [...clients]) {
        client.close();
      }
    };

    wsServer.on("connection", (webSocket) => {
      closeClients();
      let vncSocket: Socket | null = null;
      let closed = false;
      const pendingMessages: Buffer[] = [];
      const closeBoth = (): void => {
        if (closed) {
          return;
        }
        closed = true;
        clients.delete(client);
        vncSocket?.destroy();
        closeWebSocket(webSocket);
      };
      const client: ConsoleClient = {
        close: closeBoth
      };
      clients.add(client);

      webSocket.on("message", (data) => {
        const message = rawDataToBuffer(data);
        if (vncSocket === null) {
          pendingMessages.push(message);
          return;
        }
        if (vncSocket.destroyed) {
          return;
        }
        vncSocket.write(message);
      });
      webSocket.on("close", closeBoth);
      webSocket.on("error", closeBoth);
      void connectToVncWithRetry(vncPort, () => !closed)
        .then((socket) => {
          if (closed) {
            socket.destroy();
            return;
          }
          vncSocket = socket;
          for (const message of pendingMessages.splice(0)) {
            socket.write(message);
          }
          socket.on("data", (chunk) => {
            if (webSocket.readyState === WebSocket.OPEN) {
              webSocket.send(chunk);
            }
          });
          socket.on("error", closeBoth);
          socket.on("close", closeBoth);
        })
        .catch(() => {
          if (!closed) {
            closeBoth();
          }
        });
    });

    const port = await waitForListening(server);
    const url = `ws://${LOOPBACK_HOST}:${port}${path}`;
    sessions.set(token, {
      vmId,
      vncPort,
      url,
      server,
      wsServer,
      clients
    });
    tokenByVmId.set(vmId, token);
    return {
      vmId,
      vncPort,
      url
    };
  };

  const dispose = (): void => {
    for (const token of sessions.keys()) {
      closeSession(token);
    }
  };

  return {
    open,
    dispose
  };
};
