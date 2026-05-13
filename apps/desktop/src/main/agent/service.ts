import { ipcMain, type BrowserWindow } from "electron";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type {
  AgentDecisionSubmitRequest,
  AgentPermissionRespondRequest,
  AgentRuntimeEvent,
  AgentSessionCreateRequest,
  AgentSessionReadRequest,
  AgentSessionSnapshot,
  AgentTurnCancelRequest,
  AgentTurnCancelResponse,
  AgentTurnSendRequest,
  AgentTurnSendResponse
} from "../../shared/agent";
import type { LyraRuntimeClient } from "../runtime-client";

export type AgentIpcBridge = {
  readonly dispose: () => void;
};

const AGENT_RUNTIME_EVENT_NAME = "agent.runtime";

export const createAgentIpcBridge = ({
  runtimeClient,
  getWindow
}: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly getWindow: () => BrowserWindow | null;
}): AgentIpcBridge => {
  const requestRuntime = async <T>(method: string, payload: object = {}): Promise<T> =>
    runtimeClient.request<T>(method, payload);

  const unsubscribeRuntimeEvents = runtimeClient.subscribe((eventName, payload) => {
    if (eventName !== AGENT_RUNTIME_EVENT_NAME) {
      return;
    }
    const window = getWindow();
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.agentEvent, payload as AgentRuntimeEvent);
  });

  const handlers: Array<readonly [string, (_event: Electron.IpcMainInvokeEvent, payload?: unknown) => unknown]> = [
    [
      LYRA_CHANNELS.agentSessionCreate,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.create",
          (payload as AgentSessionCreateRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentSessionRead,
      (_event, payload) =>
        requestRuntime<AgentSessionSnapshot>(
          "agent.session.read",
          (payload as AgentSessionReadRequest | undefined) ?? {}
        )
    ],
    [
      LYRA_CHANNELS.agentTurnSend,
      (_event, payload) =>
        requestRuntime<AgentTurnSendResponse>(
          "agent.turn.send",
          payload as AgentTurnSendRequest
        )
    ],
    [
      LYRA_CHANNELS.agentTurnCancel,
      (_event, payload) =>
        requestRuntime<AgentTurnCancelResponse>(
          "agent.turn.cancel",
          payload as AgentTurnCancelRequest
        )
    ],
    [
      LYRA_CHANNELS.agentDecisionSubmit,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.decision.submit",
          payload as AgentDecisionSubmitRequest
        )
    ],
    [
      LYRA_CHANNELS.agentPermissionRespond,
      (_event, payload) =>
        requestRuntime<unknown>(
          "agent.permission.respond",
          payload as AgentPermissionRespondRequest
        )
    ]
  ];

  for (const [channel, handler] of handlers) {
    ipcMain.handle(channel, handler);
  }

  return {
    dispose: () => {
      unsubscribeRuntimeEvents();
      for (const [channel] of handlers) {
        ipcMain.removeHandler(channel);
      }
    }
  };
};
