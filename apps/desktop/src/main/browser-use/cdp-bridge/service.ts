import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { WebSocketServer, type WebSocket } from "ws";

import type { WorkbenchBrowserIpcBridge } from "../../workbench-browser/service";
import type {
  WorkbenchBrowserDebuggerEvent,
  WorkbenchBrowserDebuggerSession,
} from "../../workbench-browser/types";
import type { BrowserUseCdpBridgeService, BrowserUseCdpBridgeSession } from "../types";

type BridgeClientMessage = {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string;
};

type BridgeTargetInfo = {
  readonly targetId: string;
  readonly type: "page";
  readonly title: string;
  readonly url: string;
  readonly attached: boolean;
  readonly canAccessOpener: boolean;
  readonly browserContextId: string;
};

type ActiveBridgeSession = {
  readonly sessionId: string;
  readonly tabId: string;
  readonly wsUrl: string;
  readonly debuggerSession: WorkbenchBrowserDebuggerSession;
  readonly wsClients: Set<WebSocket>;
  syntheticSessionId: string | null;
  pageAddress?: string;
  pageTitle?: string;
  autoAttach: boolean;
  closed: boolean;
  unsubscribeDebugger: () => void;
  close: () => Promise<void>;
};

const BRIDGE_CONTEXT_ID = "lyra-current-tab";

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const sendWsPayload = (socket: WebSocket, payload: unknown): void => {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
};

const sendWsResult = (socket: WebSocket, id: number | string | undefined, result: unknown): void => {
  sendWsPayload(socket, {
    ...(id === undefined ? {} : { id }),
    result,
  });
};

const sendWsError = (
  socket: WebSocket,
  id: number | string | undefined,
  message: string,
  code = -32000,
): void => {
  sendWsPayload(socket, {
    ...(id === undefined ? {} : { id }),
    error: {
      code,
      message,
    },
  });
};

const rawMessageToString = (raw: Buffer | ArrayBuffer | Buffer[] | string): string => {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(raw).toString("utf8");
  }
  return raw.toString("utf8");
};

const buildTargetInfo = (
  browserBridge: WorkbenchBrowserIpcBridge,
  session: ActiveBridgeSession,
): BridgeTargetInfo => {
  const page = browserBridge.readPageState({ tabId: session.tabId });
  if (page !== null) {
    session.pageAddress = page.address;
    session.pageTitle = page.title;
  }
  return {
    targetId: `lyra-tab-${session.tabId}`,
    type: "page",
    title: session.pageTitle ?? "Lyra Page",
    url: session.pageAddress ?? "about:blank",
    attached: session.syntheticSessionId !== null,
    canAccessOpener: false,
    browserContextId: BRIDGE_CONTEXT_ID,
  };
};

const notifyAllClients = (session: ActiveBridgeSession, payload: unknown): void => {
  for (const client of session.wsClients) {
    sendWsPayload(client, payload);
  }
};

export const createBrowserUseCdpBridgeService = ({
  browserBridge,
}: {
  readonly browserBridge: WorkbenchBrowserIpcBridge;
}): BrowserUseCdpBridgeService => {
  let wsServer: WebSocketServer | null = null;
  let serverPort: number | null = null;
  const sessions = new Map<string, ActiveBridgeSession>();

  const ensureServer = async (): Promise<void> => {
    if (wsServer !== null && serverPort !== null) {
      return;
    }
    wsServer = await new Promise<WebSocketServer>((resolve, reject) => {
      const server = new WebSocketServer({
        host: "127.0.0.1",
        port: 0,
      });
      server.once("listening", () => resolve(server));
      server.once("error", reject);
    });
    const address = wsServer.address();
    if (typeof address === "string" || address === null) {
      throw new Error("browser_use current_tab CDP bridge could not resolve a loopback port");
    }
    serverPort = address.port;

    wsServer.on("connection", (socket: WebSocket, request: IncomingMessage) => {
      const url = new URL(request.url ?? "/", "ws://127.0.0.1");
      const sessionId = url.pathname.replace(/^\/devtools\/browser\//u, "").trim();
      const session = sessions.get(sessionId);
      if (session === undefined || session.closed) {
        socket.close();
        return;
      }
      session.wsClients.add(socket);
      socket.once("close", () => {
        session.wsClients.delete(socket);
      });
      socket.on("message", (raw: Buffer | ArrayBuffer | Buffer[] | string) => {
        void handleClientMessage(session, socket, rawMessageToString(raw)).catch((error) => {
          sendWsError(socket, undefined, error instanceof Error ? error.message : String(error));
        });
      });
    });
  };

  const closeBridgeSession = async (session: ActiveBridgeSession): Promise<void> => {
    if (session.closed) {
      return;
    }
    session.closed = true;
    sessions.delete(session.sessionId);
    session.unsubscribeDebugger();
    for (const client of session.wsClients) {
      if (client.readyState === client.OPEN || client.readyState === client.CONNECTING) {
        client.close();
      }
    }
    session.wsClients.clear();
    await session.debuggerSession.close();
  };

  const emitTargetInfoChanged = (session: ActiveBridgeSession): void => {
    notifyAllClients(session, {
      method: "Target.targetInfoChanged",
      params: {
        targetInfo: buildTargetInfo(browserBridge, session),
      },
    });
  };

  const emitAttachedToTarget = (session: ActiveBridgeSession): void => {
    if (session.syntheticSessionId === null) {
      return;
    }
    notifyAllClients(session, {
      method: "Target.attachedToTarget",
      params: {
        sessionId: session.syntheticSessionId,
        targetInfo: buildTargetInfo(browserBridge, session),
        waitingForDebugger: false,
      },
    });
  };

  const emitDetachedFromTarget = (session: ActiveBridgeSession, detachedSessionId: string): void => {
    notifyAllClients(session, {
      method: "Target.detachedFromTarget",
      params: {
        sessionId: detachedSessionId,
        targetId: `lyra-tab-${session.tabId}`,
      },
    });
  };

  const handleDebuggerEvent = (session: ActiveBridgeSession) => (event: WorkbenchBrowserDebuggerEvent) => {
    if (session.closed) {
      return;
    }
    if (event.kind === "detached") {
      if (session.syntheticSessionId !== null) {
        emitDetachedFromTarget(session, session.syntheticSessionId);
      }
      void closeBridgeSession(session);
      return;
    }
    if (event.method === "Page.frameNavigated") {
      const params = asRecord(event.params);
      const frame = asRecord(params.frame);
      if (typeof frame.url === "string" && frame.url.trim().length > 0) {
        session.pageAddress = frame.url;
        emitTargetInfoChanged(session);
      }
    }
    if (session.syntheticSessionId === null) {
      return;
    }
    notifyAllClients(session, {
      method: event.method,
      params: event.params,
      sessionId: session.syntheticSessionId,
    });
  };

  const handleClientMessage = async (
    session: ActiveBridgeSession,
    socket: WebSocket,
    raw: string,
  ): Promise<void> => {
    let request: BridgeClientMessage;
    try {
      request = JSON.parse(raw) as BridgeClientMessage;
    } catch {
      sendWsError(socket, undefined, "Invalid JSON payload");
      return;
    }

    const method = typeof request.method === "string" ? request.method : "";
    if (method.length === 0) {
      sendWsError(socket, request.id, "CDP method is required");
      return;
    }
    const params = asRecord(request.params);

    if (method === "Browser.getVersion") {
      sendWsResult(socket, request.id, {
        protocolVersion: "1.3",
        product: "Lyra/current_tab",
        revision: "lyra-current-tab",
        userAgent: "Lyra browser-use current_tab bridge",
        jsVersion: process.versions.v8 ?? "unknown",
      });
      return;
    }

    if (method === "Target.getTargets") {
      sendWsResult(socket, request.id, {
        targetInfos: [buildTargetInfo(browserBridge, session)],
      });
      return;
    }

    if (method === "Target.setDiscoverTargets") {
      sendWsResult(socket, request.id, {});
      return;
    }

    if (method === "Target.setAutoAttach") {
      session.autoAttach = params.autoAttach === true;
      sendWsResult(socket, request.id, {});
      if (session.autoAttach && session.syntheticSessionId !== null) {
        emitAttachedToTarget(session);
      }
      return;
    }

    if (method === "Target.attachToTarget") {
      const targetId = typeof params.targetId === "string" ? params.targetId : "";
      const expectedTargetId = `lyra-tab-${session.tabId}`;
      if (targetId !== expectedTargetId) {
        sendWsError(socket, request.id, `Unknown current_tab target: ${targetId}`);
        return;
      }
      if (session.syntheticSessionId === null) {
        session.syntheticSessionId = randomUUID();
      }
      sendWsResult(socket, request.id, { sessionId: session.syntheticSessionId });
      emitAttachedToTarget(session);
      return;
    }

    if (method === "Target.detachFromTarget") {
      const currentSessionId = session.syntheticSessionId;
      if (currentSessionId !== null) {
        session.syntheticSessionId = null;
        emitDetachedFromTarget(session, currentSessionId);
      }
      sendWsResult(socket, request.id, {});
      return;
    }

    if (method === "Target.activateTarget") {
      session.debuggerSession.focus();
      sendWsResult(socket, request.id, {});
      return;
    }

    if (method === "Target.closeTarget") {
      sendWsResult(socket, request.id, { success: false });
      return;
    }

    if (
      typeof request.sessionId === "string"
      && request.sessionId.trim().length > 0
      && request.sessionId !== session.syntheticSessionId
    ) {
      sendWsError(socket, request.id, `Unknown current_tab session: ${request.sessionId}`);
      return;
    }

    try {
      const result = await session.debuggerSession.sendCommand(method, params);
      sendWsResult(socket, request.id, result);
    } catch (error) {
      sendWsError(socket, request.id, error instanceof Error ? error.message : String(error));
    }
  };

  return {
    dispose: async () => {
      for (const session of sessions.values()) {
        await closeBridgeSession(session);
      }
      sessions.clear();
      if (wsServer !== null) {
        await new Promise<void>((resolve, reject) => {
          wsServer!.close((error?: Error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }).catch(() => undefined);
      }
      wsServer = null;
      serverPort = null;
    },
    openForTab: async (tabId: string): Promise<BrowserUseCdpBridgeSession> => {
      await ensureServer();
      const debuggerSession = await browserBridge.openDebuggerSession(tabId);
      const sessionId = randomUUID();
      const wsUrl = `ws://127.0.0.1:${serverPort}/devtools/browser/${sessionId}`;
      const pageTitle = browserBridge.readPageState({ tabId })?.title;
      const bridgeSession: ActiveBridgeSession = {
        sessionId,
        tabId,
        wsUrl,
        debuggerSession,
        wsClients: new Set<WebSocket>(),
        syntheticSessionId: null,
        autoAttach: false,
        closed: false,
        unsubscribeDebugger: () => undefined,
        close: async () => undefined,
        ...(debuggerSession.pageAddress === undefined ? {} : { pageAddress: debuggerSession.pageAddress }),
        ...(pageTitle === undefined ? {} : { pageTitle }),
      };
      bridgeSession.unsubscribeDebugger = debuggerSession.subscribe(handleDebuggerEvent(bridgeSession));
      bridgeSession.close = async () => {
        await closeBridgeSession(bridgeSession);
      };
      sessions.set(sessionId, bridgeSession);
      return {
        sessionId,
        wsUrl,
        tabId,
        ...(bridgeSession.pageAddress === undefined ? {} : { pageAddress: bridgeSession.pageAddress }),
        close: async () => {
          await closeBridgeSession(bridgeSession);
        },
      };
    },
  };
};
