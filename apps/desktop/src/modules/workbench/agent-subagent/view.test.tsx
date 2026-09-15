import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AgentRuntimeEvent, AgentSessionSnapshot } from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import {
  WorkbenchTitlebarContextProvider,
  WorkbenchTitlebarContextSlot,
  WorkbenchTitlebarScopeProvider
} from "../shell/titlebar-context";
import { AgentSubagentSurface } from "./view";

const labels = {
  title: "Agent",
  loading: "Loading worker...",
  unavailable: "This worker is unavailable.",
  readOnly: "Read only"
};

const emptySnapshot = (overrides: Partial<AgentSessionSnapshot> = {}): AgentSessionSnapshot => ({
  id: "worker-1",
  title: "Explore docs",
  sessionKind: "subagent",
  workingDir: "/tmp",
  projectBound: false,
  messages: [],
  tools: [],
  todos: [],
  turnStatus: "idle",
  activeTurnId: null,
  follow: { running: false, activity: null },
  updatedAt: "2026-09-13T00:00:00.000Z",
  ...overrides
});

const renderInspector = (desktopApi: LyraDesktopApi) =>
  render(
    <WorkbenchTitlebarContextProvider activeScopeId="agent-subagent-scope">
      <WorkbenchTitlebarScopeProvider scopeId="agent-subagent-scope">
        <AgentSubagentSurface
          desktopApi={desktopApi}
          labels={labels}
          state={{
            instanceId: "agent-subagent-worker-1",
            parentSessionId: "session-1",
            subagentId: "worker-1",
            planId: null,
            title: "Explore docs"
          }}
        />
      </WorkbenchTitlebarScopeProvider>
      <WorkbenchTitlebarContextSlot />
    </WorkbenchTitlebarContextProvider>
  );

describe("AgentSubagentSurface", () => {
  test("does not let a stale empty read clobber live worker output", async () => {
    let sendEvent: ((event: AgentRuntimeEvent) => void) | null = null;
    let resolveRead: ((snapshot: AgentSessionSnapshot) => void) | undefined;
    const desktopApi = {
      agent: {
        readSession: vi.fn(() => new Promise<AgentSessionSnapshot>((resolve) => {
          resolveRead = resolve;
        })),
        onEvent: (listener: (event: AgentRuntimeEvent) => void) => {
          sendEvent = listener;
          return () => undefined;
        }
      }
    } as unknown as LyraDesktopApi;

    renderInspector(desktopApi);

    const live = emptySnapshot({
      messages: [{
        id: "message-1",
        role: "assistant",
        text: "Live output",
        createdAt: "2026-09-13T00:00:01.000Z"
      }],
      turnStatus: "running",
      activeTurnId: "turn-1",
      follow: { running: true, activity: "streaming_model" }
    });

    act(() => {
      sendEvent?.({ kind: "sessionSnapshot", snapshot: live });
    });

    expect(await screen.findByText("Live output")).toBeInTheDocument();

    act(() => {
      resolveRead?.(emptySnapshot());
    });

    await waitFor(() => {
      expect(screen.getByText("Live output")).toBeInTheDocument();
    });
  });
});
