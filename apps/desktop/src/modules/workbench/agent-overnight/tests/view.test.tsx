import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  JcodeOvernightRunSnapshot,
  LyraDesktopApi
} from "../../../../shared/desktop-bridge";
import type { AgentOvernightLabels } from "../types";
import { AgentOvernightSurface } from "../view";

const labels: AgentOvernightLabels = {
  title: "Overnight Lab",
  open: "Open Overnight Lab",
  subtitle: "Run a supervised coordinator.",
  missionLabel: "Mission",
  missionPlaceholder: "Describe the work",
  durationLabel: "Duration",
  customMinutes: "Minutes",
  oneHour: "1h",
  fourHours: "4h",
  eightHours: "8h",
  inheritContext: "Bring current AI session context",
  start: "Start overnight run",
  starting: "Starting...",
  refresh: "Refresh",
  loading: "Loading overnight runs...",
  cancel: "Request cancellation",
  review: "Refresh review",
  running: "Running",
  idle: "Idle",
  latestRuns: "Latest runs",
  noRunsTitle: "No overnight runs yet",
  noRunsDescription: "Start a supervised run.",
  status: "Status",
  model: "Model",
  provider: "Provider",
  workingDir: "Working directory",
  targetWake: "Target wake",
  lastActivity: "Last activity",
  progress: "Progress",
  taskCards: "Task cards",
  events: "Events",
  log: "Log",
  reviewPreview: "Review preview",
  transcript: "Coordinator transcript",
  emptyTasks: "No task cards",
  emptyEvents: "No events",
  emptyTranscript: "No transcript",
  unavailable: "Agent runtime bridge is unavailable."
};

const run: JcodeOvernightRunSnapshot = {
  runId: "overnight-1",
  parentSessionId: "parent-1",
  coordinatorSessionId: "coord-1",
  coordinatorSessionName: "Overnight coordinator",
  status: "running",
  mission: "Stabilize tests",
  workingDir: "/Users/petehsu/Documents/Lyra",
  providerName: "openai",
  model: "gpt-5.4",
  startedAt: "2026-05-18T12:00:00.000Z",
  targetWakeAt: "2026-05-18T16:00:00.000Z",
  handoffReadyAt: "2026-05-18T15:30:00.000Z",
  postWakeGraceUntil: "2026-05-18T18:00:00.000Z",
  lastActivityAt: "2026-05-18T12:05:00.000Z",
  completedAt: null,
  cancelRequestedAt: null,
  runDir: "/tmp/overnight-1",
  logPath: "/tmp/overnight-1/run.log",
  reviewPath: "/tmp/overnight-1/review.html",
  manifest: {},
  progress: {
    phase: "running",
    timeRemainingLabel: "4h",
    taskSummary: { total: 1 }
  },
  events: [
    {
      kind: "run_started",
      summary: "Started overnight run",
      timestamp: "2026-05-18T12:00:00.000Z"
    }
  ],
  taskCards: [
    {
      id: "task-1",
      title: "Fix tests",
      status: "active"
    }
  ],
  statusMarkdown: "status markdown",
  logMarkdown: "log markdown",
  reviewHtml: "<html><body>review</body></html>",
  coordinatorSnapshot: null
};

const createDesktopApi = () => {
  const startOvernight = vi.fn().mockResolvedValue({
    run,
    inheritedContext: true
  });
  const desktopApi = {
    agent: {
      listOvernightRuns: vi.fn().mockResolvedValue({ runs: [], latestRunId: null }),
      startOvernight,
      readOvernightStatus: vi.fn().mockResolvedValue({ run }),
      readOvernightReview: vi.fn().mockResolvedValue({ run }),
      cancelOvernight: vi.fn().mockResolvedValue({ run })
    }
  } as unknown as LyraDesktopApi;
  return { desktopApi, startOvernight };
};

describe("AgentOvernightSurface", () => {
  test("starts a real overnight run through the agent bridge and renders dashboard data", async () => {
    const { desktopApi, startOvernight } = createDesktopApi();

    render(
      <AgentOvernightSurface
        desktopApi={desktopApi}
        labels={labels}
        parentSessionId="parent-1"
        locale="en-US"
      />
    );

    fireEvent.change(screen.getByLabelText("Mission"), {
      target: { value: "Stabilize tests" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Start overnight run" }));

    await waitFor(() => {
      expect(startOvernight).toHaveBeenCalledWith({
        sessionId: "parent-1",
        durationMinutes: 240,
        mission: "Stabilize tests",
        inheritContext: true
      });
    });
    expect((await screen.findAllByText("Stabilize tests")).length).toBeGreaterThan(0);
    expect(screen.getByText("Started overnight run")).toBeInTheDocument();
  });
});
