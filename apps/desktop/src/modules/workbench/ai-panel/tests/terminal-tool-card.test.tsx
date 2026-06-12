import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  SessionMeta,
  ToolDetails
} from "../lyra-agents/core/types";
import { createDataProviderValue } from "../lyra-agents/data/createDataProviderValue";
import { DataContextProvider } from "../lyra-agents/data/DataProvider";
import { TerminalToolCard } from "../lyra-agents/features/tools/TerminalToolCard";

type TerminalDetails = Extract<ToolDetails, { type: "terminal" }>;

const session: SessionMeta = {
  title: "New session",
  project: "Lyra",
  workingDir: "/Users/petehsu/Documents/Lyra",
  projectBound: true,
  totalAdditions: 0,
  totalDeletions: 0
};

const baseDetails = (overrides: Partial<TerminalDetails>): TerminalDetails => ({
  type: "terminal",
  action: "read",
  target: "private",
  output: "",
  sessionId: "terminal-session-1",
  running: false,
  exitCode: 0,
  truncated: false,
  ...overrides
});

const renderCard = (
  details: TerminalDetails,
  options: {
    readonly openLiveTerminal?: ReturnType<typeof vi.fn>;
  } = {}
) => {
  const openLiveTerminal = options.openLiveTerminal ?? vi.fn(async () => undefined);
  const data = createDataProviderValue({
    session,
    messages: [],
    openTerminalLiveSession: openLiveTerminal
  });
  return {
    openLiveTerminal,
    ...render(
      <DataContextProvider value={data}>
        <TerminalToolCard details={details} />
      </DataContextProvider>
    )
  };
};

describe("terminal tool card release gate", () => {
  test("renders screen snapshot metadata and opens only the live terminal", () => {
    const { container, openLiveTerminal } = renderCard(baseDetails({
      action: "screen",
      target: "ui",
      terminalTabId: "terminal-tab-1",
      paneId: "pane-1",
      screen: {
        cursor: "7",
        screenVersion: 7,
        rows: 24,
        cols: 80,
        mode: "alternate",
        visibleText: "npm test\nFAIL src/terminal.test.ts",
        visibleRows: [
          { row: 0, text: "npm test", wrapped: false },
          { row: 1, text: "FAIL src/terminal.test.ts", wrapped: false }
        ],
        cursorPosition: { row: 1, col: 28, visible: true },
        regions: [],
        truncated: false
      },
      memory: {
        outputByteRange: { start: 0, end: 2048 },
        estimatedTokens: 512,
        lineCount: 44,
        errorCount: 1,
        eventSeqRange: { start: 1, end: 9 }
      }
    }));

    expect(screen.getByText("ui terminal")).toBeInTheDocument();
    expect(screen.getByText("v7 - alternate - 80x24")).toBeInTheDocument();
    expect(container).toHaveTextContent("FAIL src/terminal.test.ts");
    expect(screen.getByText("lines 44 - errors 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Timeline$/u })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Timeline" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Terminal" }));
    expect(openLiveTerminal).toHaveBeenCalledWith({
      sessionId: "terminal-session-1",
      terminalTabId: "terminal-tab-1",
      paneId: "pane-1"
    });
  });

  test("renders events, run, input, signal, map, and act summaries without compact overflow text", () => {
    const variants: readonly TerminalDetails[] = [
      baseDetails({ action: "events", output: "Read 2 terminal events.", target: "private" }),
      baseDetails({ action: "read_until", output: "Matched terminal prompt.", reason: "output" }),
      baseDetails({ action: "run", command: "npm test", output: "running tests", running: true, exitCode: null }),
      baseDetails({ action: "input", wrote: "typed answer", output: "submitted" }),
      baseDetails({ action: "keys", wrote: "enter", output: "pressed keys" }),
      baseDetails({ action: "resize", wrote: "100x30", output: "resized" }),
      baseDetails({ action: "signal", wrote: "SIGTERM", output: "sent signal", exitCode: null }),
      baseDetails({ action: "processes", output: "Read 1 process." }),
      baseDetails({ action: "command_status", command: "npm test", output: "Command completed." }),
      baseDetails({ action: "map", output: "Found 3 terminal regions." }),
      baseDetails({ action: "act", output: "Terminal act act-1 status=executed." }),
      baseDetails({ action: "attach_agent", output: "Attached Agent to terminal." }),
      baseDetails({ action: "detach_agent", output: "Detached Agent from terminal." }),
      baseDetails({ action: "close", output: "Closed terminal." })
    ];

    for (const details of variants) {
      const { container, unmount } = renderCard(details);
      expect(screen.getByText("private terminal")).toBeInTheDocument();
      expect(screen.getByText(details.command ?? details.wrote ?? details.sessionId ?? details.action)).toBeInTheDocument();
      if (details.output.trim().length > 0) {
        expect(screen.getByText(details.output)).toBeInTheDocument();
      }
      expect(container.querySelector(".lyra-agents-shell-exit")).toHaveTextContent("running");
      unmount();
    }
  });

  test("keeps terminal memory artifacts and read hints out of the human card", () => {
    const fullCommandsPath =
      "/tmp/lyra/terminal-memory/sessions/session-1/commands.jsonl";
    renderCard(baseDetails({
      readHint: {
        message: "命令索引：.../commands.jsonl",
        commandsPath: fullCommandsPath
      },
      artifacts: [
        {
          kind: "file",
          label: ".../commands.jsonl",
          value: ".../commands.jsonl"
        }
      ]
    }));

    expect(screen.queryByText("命令索引：.../commands.jsonl")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ".../commands.jsonl" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "commands.jsonl" })).not.toBeInTheDocument();
    expect(screen.queryByText(fullCommandsPath)).not.toBeInTheDocument();
  });
});
