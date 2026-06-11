import type { BrowserWindow } from "electron";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type {
  AgentPokeResponse,
  AgentRuntimeEvent
} from "../../shared/agent";
import type {
  TerminalEvent,
  TerminalMemoryCorrelation
} from "../../shared/desktop-bridge";
import type { LyraRuntimeClient } from "../runtime-client";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { isRecord } from "./host-payload";

const AGENT_RUNTIME_EVENT_NAME = "agent.runtime";
const TERMINAL_RUNTIME_EVENT_NAME = "terminal.runtime";

type RequestRuntime = <T>(method: string, payload?: object) => Promise<T>;

const readTerminalRuntimeCorrelationString = (
  event: TerminalEvent,
  key: keyof TerminalMemoryCorrelation
): string | undefined => {
  if (event.kind !== "commandCompleted") {
    return undefined;
  }
  const correlation = event.command.correlation;
  if (!isRecord(correlation)) {
    return undefined;
  }
  const value = correlation[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
};

export const createRuntimeEventForwarder = ({
  runtimeClient,
  requestRuntime,
  getWindow,
  getBrowserBridge
}: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly requestRuntime: RequestRuntime;
  readonly getWindow: () => BrowserWindow | null;
  readonly getBrowserBridge: () => WorkbenchBrowserIpcBridge | null;
}): { readonly dispose: () => void } => {
  const handleTerminalRuntimeEvent = (payload: unknown): void => {
    const event = payload as TerminalEvent;
    if (event.kind !== "commandCompleted") {
      return;
    }
    const agentSessionId = readTerminalRuntimeCorrelationString(event, "agentSessionId");
    if (agentSessionId === undefined) {
      return;
    }
    void requestRuntime<AgentPokeResponse>("agent.action.poke", {
      sessionId: agentSessionId,
      reason: "terminal_command_completed",
      terminal: {
        sessionId: event.sessionId,
        commandId: event.commandId,
        status: event.command.status,
        exitCode: event.command.exitCode ?? null,
        commandSummaryPath: event.command.commandSummaryPath,
        commandOutputTextPath: event.command.commandOutputTextPath
      }
    }).catch((error) => {
      console.warn("[lyra-agent] terminal command completion poke failed:", error);
    });
  };

  const unsubscribe = runtimeClient.subscribe((eventName, payload) => {
    if (eventName === TERMINAL_RUNTIME_EVENT_NAME) {
      handleTerminalRuntimeEvent(payload);
      return;
    }
    if (eventName !== AGENT_RUNTIME_EVENT_NAME) {
      return;
    }
    const event = payload as AgentRuntimeEvent;
    const browser = getBrowserBridge();
    if (browser !== null) {
      if (event.kind === "turnFinished") {
        browser.finishAgentFollowSessions({
          turnId: event.turnId,
          status: event.status === "cancelled" ? "cancelled" : "completed",
          reason: event.status
        });
      } else if (event.kind === "turnFailed") {
        browser.finishAgentFollowSessions({
          turnId: event.turnId,
          status: "failed",
          reason: event.message
        });
      } else if (event.kind === "turnInterrupted") {
        browser.finishAgentFollowSessions({
          turnId: event.turnId,
          status: "interrupted",
          reason: event.reason
        });
      }
    }
    const window = getWindow();
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.agentEvent, event);
  });

  return {
    dispose: unsubscribe
  };
};
