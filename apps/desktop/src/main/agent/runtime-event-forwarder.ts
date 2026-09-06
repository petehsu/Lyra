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
import {
  createBackpressuredEventSender,
  estimateSerializedBytes
} from "../events/backpressure";
import type { LyraRuntimeClient } from "../runtime-client";
import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";
import { isRecord } from "./host-payload";

const AGENT_RUNTIME_EVENT_NAME = "agent.runtime";
const TERMINAL_RUNTIME_EVENT_NAME = "terminal.runtime";
// Keep every agent event behind one frame-sized queue. Sending deltas directly
// lets a fast native producer monopolize Electron IPC and starve renderer
// paints; the queue still preserves ordering while merging adjacent chunks.
const AGENT_EVENT_THROTTLE_MS = 16;
const AGENT_EVENT_MAX_QUEUE_SIZE = 512;

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

export const agentRuntimeEventKey = (event: AgentRuntimeEvent): string | null => {
  if (event.kind === "sessionSnapshot") {
    return `sessionSnapshot:${event.snapshot.id}`;
  }
  if (event.kind === "messageDelta") {
    return [
      "messageDelta",
      event.sessionId,
      event.messageId,
      event.blockId ?? "",
      event.replace === true ? "replace" : "append"
    ].join(":");
  }
  if (event.kind === "messageReasoningDelta") {
    return [
      "messageReasoningDelta",
      event.sessionId,
      event.messageId,
      event.blockId ?? ""
    ].join(":");
  }
  // messageCommitted is emitted on placeholder creation and on every tool
  // start. Coalescing by sessionId:messageId collapses the intermediate
  // commits into the latest one — the final message object is what matters,
  // not the intermediate placeholders.
  if (event.kind === "messageCommitted") {
    return `messageCommitted:${event.sessionId}:${event.message.id}`;
  }
  if (event.kind === "toolUpdated") {
    return `toolUpdated:${event.sessionId}:${event.turnId}:${event.tool.id}`;
  }
  if (event.kind === "turnStateChanged") {
    return `turnStateChanged:${event.sessionId}:${event.turnId}`;
  }
  if (event.kind === "followStateChanged") {
    return `followStateChanged:${event.sessionId}`;
  }
  if (event.kind === "browserActivityChanged") {
    return `browserActivityChanged:${event.sessionId}:${event.turnId}`;
  }
  if (event.kind === "todoUpdated") {
    return `todoUpdated:${event.sessionId}`;
  }
  return null;
};

export const mergeAgentRuntimeEvent = (
  current: AgentRuntimeEvent,
  incoming: AgentRuntimeEvent
): AgentRuntimeEvent => {
  if (current.kind === "messageDelta" && incoming.kind === "messageDelta") {
    if (incoming.replace === true) {
      return incoming;
    }
    const firstEmittedAtMs =
      current.firstEmittedAtMs ?? current.emittedAtMs ?? incoming.firstEmittedAtMs ?? incoming.emittedAtMs;
    const emittedAtMs = incoming.emittedAtMs ?? current.emittedAtMs;
    return {
      ...current,
      delta: `${current.delta}${incoming.delta}`,
      ...(firstEmittedAtMs === undefined ? {} : { firstEmittedAtMs }),
      ...(emittedAtMs === undefined ? {} : { emittedAtMs }),
      sourceChunkCount: (current.sourceChunkCount ?? 1) + (incoming.sourceChunkCount ?? 1)
    };
  }
  if (
    current.kind === "messageReasoningDelta" &&
    incoming.kind === "messageReasoningDelta"
  ) {
    const firstEmittedAtMs =
      current.firstEmittedAtMs ?? current.emittedAtMs ?? incoming.firstEmittedAtMs ?? incoming.emittedAtMs;
    const emittedAtMs = incoming.emittedAtMs ?? current.emittedAtMs;
    return {
      ...current,
      delta: `${current.delta}${incoming.delta}`,
      ...(firstEmittedAtMs === undefined ? {} : { firstEmittedAtMs }),
      ...(emittedAtMs === undefined ? {} : { emittedAtMs }),
      sourceChunkCount: (current.sourceChunkCount ?? 1) + (incoming.sourceChunkCount ?? 1)
    };
  }
  return incoming;
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
  const sendToRenderer = (event: AgentRuntimeEvent): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed() || window.webContents.isDestroyed()) {
      return;
    }
    window.webContents.send(LYRA_CHANNELS.agentEvent, event);
  };

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

  const eventSender = createBackpressuredEventSender<AgentRuntimeEvent>({
    name: "agent.event",
    intervalMs: AGENT_EVENT_THROTTLE_MS,
    maxQueueSize: AGENT_EVENT_MAX_QUEUE_SIZE,
    leading: false,
    keyFor: agentRuntimeEventKey,
    merge: mergeAgentRuntimeEvent,
    // Merge only adjacent chunks. This preserves the true order when a stream
    // switches between reasoning, visible text and tool events within a frame.
    coalesceMode: "consecutive",
    estimateBytes: estimateSerializedBytes,
    send: sendToRenderer,
    onError: (error) => {
      console.warn(`[lyra-agent] failed to send throttled event: ${String(error)}`);
    }
  });

  const unsubscribe = runtimeClient.subscribe((eventName, payload) => {
    if (eventName === TERMINAL_RUNTIME_EVENT_NAME) {
      handleTerminalRuntimeEvent(payload);
      return;
    }
    if (eventName !== AGENT_RUNTIME_EVENT_NAME) {
      return;
    }
    const event = payload as AgentRuntimeEvent;
    if (
      event.kind === "sessionSnapshot"
      && event.snapshot.turnStatus === "running"
    ) {
      // Live state is already projected by deltas and focused structural
      // events. Forwarding a full, growing snapshot for every mutation was the
      // dominant Rust -> Electron traffic source and retained duplicate trees.
      return;
    }
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
    eventSender.enqueue(event);
  });

  return {
    dispose: () => {
      unsubscribe();
      eventSender.dispose();
    }
  };
};
