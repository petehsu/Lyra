import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import {
  resetWorkbenchStateStorageForTests,
  writeWorkbenchStateSync
} from "../../state-storage";
import { useTerminalDockModel } from "../service";

function RestoreHarness() {
  const model = useTerminalDockModel();
  return (
    <pre data-testid="restore-request">
      {JSON.stringify(model.restoreRequest, null, 2)}
    </pre>
  );
}

describe("terminal dock release gate", () => {
  afterEach(() => {
    resetWorkbenchStateStorageForTests();
  });

  test("restores terminal app tabs with cwd shell command metadata", () => {
    writeWorkbenchStateSync("terminal-dock", JSON.stringify({
      activeTabId: "tab-1",
      tabs: [
        {
          id: "tab-1",
          title: "Dev Server",
          orientation: "horizontal",
          paneIds: ["pane-1"],
          activePaneId: "pane-1",
          placement: "workspace",
          pinned: true,
          favorite: true
        }
      ],
      panes: {
        "pane-1": {
          id: "pane-1",
          sessionId: "session-dev",
          title: "Dev Server",
          cwd: "/workspace/lyra",
          shell: "/bin/zsh",
          mode: "command",
          command: "npm run dev",
          followMode: "observe"
        }
      }
    }));

    render(<RestoreHarness />);
    const restore = JSON.parse(screen.getByTestId("restore-request").textContent ?? "{}") as {
      readonly sessions: ReadonlyArray<Record<string, unknown>>;
    };

    expect(restore.sessions).toEqual([
      expect.objectContaining({
        sessionId: "session-dev",
        title: "Dev Server",
        cwd: "/workspace/lyra",
        shell: "/bin/zsh",
        mode: "command",
        command: "npm run dev",
        cols: 80,
        rows: 24,
        source: "user"
      })
    ]);
  });
});
