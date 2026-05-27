import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  AgentSessionSnapshot,
  LyraDesktopApi
} from "../../../../shared/desktop-bridge";
import type { AgentSelfDevLabels } from "../types";
import { AgentSelfDevSurface } from "../view";

const labels: AgentSelfDevLabels = {
  title: "Self-Dev Lab",
  open: "Open Self-Dev Lab",
  subtitle: "Improve Lyra Agent.",
  promptLabel: "Task prompt",
  promptPlaceholder: "Describe the task",
  targetLabel: "Scope",
  targetAgentCore: "Agent Core",
  targetDesktopGui: "Desktop GUI",
  targetValidation: "Validation",
  targetGeneral: "General",
  inheritContext: "Bring current AI session context",
  start: "Start self-dev session",
  starting: "Starting...",
  repo: "Repo",
  status: "Status",
  idle: "Idle",
  running: "Running",
  unavailable: "Self-dev is unavailable",
  emptyTitle: "Start a self-dev session",
  emptyDescription: "Creates a canary session.",
  restartRequired: "Restart or rebuild required"
};

const snapshot: AgentSessionSnapshot = {
  id: "selfdev-1",
  title: "Self-Dev Lab",
  sessionKind: "selfdev",
  workingDir: "/Users/petehsu/Documents/Lyra",
  projectBound: true,
  messages: [
    {
      id: "assistant-1",
      role: "assistant",
      text: "Self-dev reply",
      createdAt: "2026-05-17T12:00:00.000Z"
    }
  ],
  tools: [],
  todos: [],
  automation: {
    subagentModel: null,
    autoreviewEnabled: null,
    autojudgeEnabled: null
  },
  sidePanel: {
    focusedPageId: null,
    pages: []
  },
  turnStatus: "idle",
  activeTurnId: null,
  follow: { running: false, activity: null },
  updatedAt: "2026-05-17T12:00:00.000Z"
};

const createDesktopApi = () => {
  const startSelfDev = vi.fn().mockResolvedValue({
    sessionId: snapshot.id,
    repoDir: snapshot.workingDir,
    snapshot,
    turnId: null,
    status: "idle",
    inheritedContext: true
  });
  const desktopApi = {
    agent: {
      readSelfDevStatus: vi.fn().mockResolvedValue({
        available: true,
        repoDir: snapshot.workingDir,
        output: "",
        sessionId: null
      }),
      startSelfDev,
      sendSelfDevTurn: vi.fn(),
      cancelTurn: vi.fn(),
      onEvent: vi.fn(() => vi.fn())
    }
  } as unknown as LyraDesktopApi;
  return { desktopApi, startSelfDev };
};

describe("AgentSelfDevSurface", () => {
  test("starts a real self-dev session through the agent bridge and renders the transcript", async () => {
    const { desktopApi, startSelfDev } = createDesktopApi();

    render(
      <AgentSelfDevSurface
        desktopApi={desktopApi}
        labels={labels}
        parentSessionId="parent-1"
        locale="en-US"
      />
    );

    fireEvent.change(screen.getByLabelText("Task prompt"), {
      target: { value: "Improve rollback validation" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Start self-dev session" }));

    await waitFor(() => {
      expect(startSelfDev).toHaveBeenCalledWith({
        prompt: "Improve rollback validation",
        target: "agent-core",
        inheritContext: true,
        parentSessionId: "parent-1"
      });
    });
    expect(await screen.findByText("Self-dev reply")).toBeInTheDocument();
  });
});
