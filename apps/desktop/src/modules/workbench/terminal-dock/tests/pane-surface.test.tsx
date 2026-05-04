import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { TerminalPaneSurface } from "../pane-surface";
import type { TerminalPaneSurfaceProps } from "../pane-surface";

const createProps = (): TerminalPaneSurfaceProps => ({
  pane: {
    id: "pane-1",
    sessionId: "session-1",
    title: "Terminal"
  },
  active: true,
  desktopApi: {
    terminal: {
      closeSession: vi.fn(async () => undefined),
      createSession: vi.fn(async () => undefined),
      onData: vi.fn(() => () => undefined),
      onError: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
      reloadPrompt: vi.fn(async () => ({ applied: true, deferred: false })),
      resize: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined)
    }
  } as unknown as TerminalPaneSurfaceProps["desktopApi"],
  labels: {
    newTab: "new",
    splitHorizontal: "split-horizontal",
    splitVertical: "split-vertical",
    moveTerminalToTop: "move-top",
    moveTerminalToBottom: "move-bottom",
    closeTab: "close",
    emptyDock: "empty",
    unavailable: "unavailable"
  },
  themeSignature: "lyra-dark:dark:follow-app",
  themePresetId: "follow-app",
  uiThemeId: "lyra-dark",
  onFocus: vi.fn()
});

const getTerminalInstances = async (): Promise<Array<{ options: Record<string, unknown> }>> => {
  const module = await import("xterm") as unknown as {
    __terminalInstances: Array<{ options: Record<string, unknown> }>;
  };
  return module.__terminalInstances;
};

describe("terminal pane surface", () => {
  afterEach(async () => {
    const terminalInstances = await getTerminalInstances();
    terminalInstances.length = 0;
  });

  test("uses a thin bar cursor for terminal panes", async () => {
    await act(async () => {
      render(<TerminalPaneSurface {...createProps()} />);
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    const terminalInstances = await getTerminalInstances();
    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1);
    });

    expect(terminalInstances[0]?.options.cursorStyle).toBe("bar");
    expect(terminalInstances[0]?.options.cursorInactiveStyle).toBe("bar");
    expect(terminalInstances[0]?.options.cursorWidth).toBe(1);
  });

});
