import { render, screen } from "@testing-library/react";
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
  workingDirIsHome: false,
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

const renderCard = (details: TerminalDetails) => {
  const data = createDataProviderValue({
    session,
    messages: [],
    openTerminalLiveSession: vi.fn(async () => undefined)
  });
  return render(
    <DataContextProvider value={data}>
      <TerminalToolCard details={details} />
    </DataContextProvider>
  );
};

describe("terminal tool card release gate", () => {
  test("renders command and screen output without metadata chrome", () => {
    const { container } = renderCard(baseDetails({
      action: "screen",
      target: "ui",
      terminalTabId: "terminal-tab-1",
      paneId: "pane-1",
      output: "npm test\nFAIL src/terminal.test.ts"
    }));

    expect(screen.queryByText("ui terminal")).not.toBeInTheDocument();
    expect(screen.queryByText("v7 - alternate - 80x24")).not.toBeInTheDocument();
    expect(screen.queryByText("lines 44 - errors 1")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Terminal" })).not.toBeInTheDocument();
    expect(container).toHaveTextContent("FAIL src/terminal.test.ts");
  });

  test("renders run, input, and other terminal summaries as command plus output", () => {
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
      expect(screen.getByText(details.command ?? details.wrote ?? details.output)).toBeInTheDocument();
      if (details.output.trim().length > 0 && details.output !== (details.command ?? details.wrote)) {
        expect(screen.getByText(details.output)).toBeInTheDocument();
      }
      if (!details.running && details.exitCode !== null && details.exitCode !== undefined) {
        expect(container.querySelector(".lyra-agents-shell-exit")).toHaveTextContent(`exit ${details.exitCode}`);
      }
      unmount();
    }
  });

  test("keeps terminal memory artifacts out of the human card", () => {
    const fullCommandsPath =
      "/tmp/lyra/terminal-memory/sessions/session-1/commands.jsonl";
    renderCard(baseDetails({
      artifacts: [
        {
          kind: "file",
          label: ".../commands.jsonl",
          value: fullCommandsPath
        }
      ]
    }));

    expect(screen.queryByRole("button", { name: ".../commands.jsonl" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "commands.jsonl" })).not.toBeInTheDocument();
    expect(screen.queryByText(fullCommandsPath)).not.toBeInTheDocument();
  });
});
