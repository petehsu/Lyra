import { act, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  clearTerminalRendererStateForTests,
  TerminalPaneSurface
} from "../pane-surface";
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
      ackData: vi.fn(async () => undefined),
      attachRenderer: vi.fn(async () => ({
        sessionId: "session-1",
        attached: true
      })),
      closeSession: vi.fn(async () => undefined),
      createSession: vi.fn(async () => undefined),
      detachRenderer: vi.fn(async () => undefined),
      onData: vi.fn(() => () => undefined),
      onError: vi.fn(() => () => undefined),
      onExit: vi.fn(() => () => undefined),
      read: vi.fn(async () => ({
        sessionId: "session-1",
        cursor: "0",
        output: "",
        running: true,
        exitCode: null,
        truncated: false,
        source: "user",
        mode: "shell"
      })),
      readScreen: vi.fn(async () => ({
        sessionId: "session-1",
        cursor: "1",
        screenVersion: 1,
        rows: 24,
        cols: 80,
        mode: "normal",
        visibleText: "",
        visibleRows: [],
        scrollbackText: null,
        scrollbackCursor: "1:0",
        scrollbackRows: [],
        cursorPosition: { row: 0, col: 0, visible: true },
        cells: [],
        cellsTruncated: false,
        styles: [],
        links: [],
        inputModes: {
          applicationCursor: false,
          applicationKeypad: false,
          bracketedPaste: false,
          mouseReporting: "none",
          mouseEncoding: "default",
          lineWrap: true
        },
        selectedText: null,
        activeCommand: null,
        prompt: null,
        regions: [],
        running: true,
        exitCode: null,
        truncated: false
      })),
      reloadPrompt: vi.fn(async () => ({ applied: true, deferred: false })),
      resize: vi.fn(async () => undefined),
      signalProcess: vi.fn(async () => ({
        sessionId: "session-1",
        signal: "SIGINT",
        status: "sent"
      })),
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
    newTabWithProfile: "new-profile",
    profile: "profile",
    renameTab: "rename",
    pinTab: "pin",
    unpinTab: "unpin",
    favoriteTab: "favorite",
    unfavoriteTab: "unfavorite",
    exited: "Exited",
    emptyDock: "empty",
    unavailable: "unavailable"
  },
  themeSignature: "lyra-dark:dark",
  uiThemeId: "lyra-dark",
  onFocus: vi.fn()
});

const getTerminalInstances = async (): Promise<Array<{
  lines: string[];
  options: Record<string, unknown>;
  writeCalls: string[];
}>> => {
  const module = await import("xterm") as unknown as {
    __terminalInstances: Array<{
      lines: string[];
      options: Record<string, unknown>;
      writeCalls: string[];
    }>;
  };
  return module.__terminalInstances;
};

describe("terminal pane surface", () => {
  afterEach(async () => {
    clearTerminalRendererStateForTests();
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
    expect(terminalInstances[0]?.options.convertEol).toBe(false);
  });

  test("does not render kernel projection chrome in the human terminal renderer", async () => {
    const props = createProps();
    await act(async () => {
      render(<TerminalPaneSurface {...props} />);
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });

    expect(props.desktopApi?.terminal.read).not.toHaveBeenCalled();
    expect(document.querySelector(".lyra-terminal-kernel-projection")).toBeNull();
    expect(document.querySelector(".lyra-terminal-kernel-toolbar")).toBeNull();
    expect(document.querySelector(".lyra-terminal-pane-product-status")).toBeNull();
    expect(document.querySelector(".lyra-terminal-agent-status")).toBeNull();
    expect(document.querySelector(".lyra-terminal-renderer-diagnostics")).toBeNull();
  });

  test("restores the visible screen when an existing session attaches to a blank renderer", async () => {
    const props = createProps();
    const terminalApi = props.desktopApi?.terminal as unknown as {
      readScreen: ReturnType<typeof vi.fn>;
    };
    terminalApi.readScreen = vi.fn(async () => ({
      sessionId: "session-1",
      cursor: "7",
      screenVersion: 7,
      rows: 24,
      cols: 80,
      mode: "normal",
      visibleText: "╭─ /Users/petehsu/Documents/Lyra\n╰─ ❯ ",
      visibleRows: [
        { row: 0, text: "╭─ /Users/petehsu/Documents/Lyra", wrapped: false },
        { row: 1, text: "╰─ ❯ ", wrapped: false }
      ],
      scrollbackText: null,
      scrollbackCursor: "7:0",
      scrollbackRows: [],
      cursorPosition: { row: 1, col: 5, visible: true },
      cells: [],
      cellsTruncated: false,
      styles: [],
      links: [],
      inputModes: {
        applicationCursor: false,
        applicationKeypad: false,
        bracketedPaste: false,
        mouseReporting: "none",
        mouseEncoding: "default",
        lineWrap: true
      },
      selectedText: null,
      activeCommand: null,
      prompt: "╰─ ❯",
      regions: [],
      running: true,
      exitCode: null,
      truncated: false
    }));

    await act(async () => {
      render(<TerminalPaneSurface {...props} />);
      await new Promise((resolve) => window.setTimeout(resolve, 60));
    });

    const terminalInstances = await getTerminalInstances();
    expect(terminalApi.readScreen).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      maxBytes: 32_000
    }));
    expect(terminalInstances[0]?.lines.join("\n")).toContain(
      "╭─ /Users/petehsu/Documents/Lyra\n╰─ ❯"
    );
  });

  test("passes terminal runtime identifiers through create env", async () => {
    const baseProps = createProps();
    const props = {
      ...baseProps,
      terminalTabId: "tab-1",
      pane: {
        ...baseProps.pane,
        env: [
          { key: "EXISTING_ENV", value: "kept" },
          { key: "LYRA_TERMINAL_SESSION_ID", value: "stale" }
        ]
      }
    };
    const terminalApi = props.desktopApi?.terminal as unknown as {
      createSession: ReturnType<typeof vi.fn>;
    };

    await act(async () => {
      render(<TerminalPaneSurface {...props} />);
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    await waitFor(() => {
      expect(terminalApi.createSession).toHaveBeenCalledWith(expect.objectContaining({
        env: expect.arrayContaining([
          { key: "EXISTING_ENV", value: "kept" },
          { key: "LYRA_TERMINAL_SESSION_ID", value: "session-1" },
          { key: "LYRA_TERMINAL_PANE_ID", value: "pane-1" },
          { key: "LYRA_TERMINAL_TAB_ID", value: "tab-1" }
        ])
      }));
    });
  });

  test("acknowledges runtime data after xterm writes it", async () => {
    const dataListeners: Array<(event: {
      readonly sessionId: string;
      readonly data: string;
      readonly dataSeq?: number;
      readonly byteLength?: number;
    }) => void> = [];
    const props = createProps();
    const terminalApi = props.desktopApi?.terminal as unknown as {
      ackData: ReturnType<typeof vi.fn>;
      onData: ReturnType<typeof vi.fn>;
    };
    terminalApi.onData = vi.fn((listener) => {
      dataListeners.push(listener);
      return () => undefined;
    });

    await act(async () => {
      render(<TerminalPaneSurface {...props} />);
    });

    act(() => {
      dataListeners[0]?.({
        sessionId: "session-1",
        data: "echo ok\r\n",
        dataSeq: 7,
        byteLength: 9
      });
    });

    await waitFor(() => {
      expect(terminalApi.ackData).toHaveBeenCalledWith({
        sessionId: "session-1",
        dataSeq: 7,
        byteLength: 9
      });
    });
  });

  test("batches same-frame runtime chunks into one xterm write", async () => {
    const dataListeners: Array<(event: {
      readonly sessionId: string;
      readonly data: string;
      readonly dataSeq?: number;
      readonly byteLength?: number;
    }) => void> = [];
    const props = createProps();
    const terminalApi = props.desktopApi?.terminal as unknown as {
      ackData: ReturnType<typeof vi.fn>;
      onData: ReturnType<typeof vi.fn>;
    };
    terminalApi.onData = vi.fn((listener) => {
      dataListeners.push(listener);
      return () => undefined;
    });

    await act(async () => {
      render(<TerminalPaneSurface {...props} />);
    });

    act(() => {
      dataListeners[0]?.({
        sessionId: "session-1",
        data: "\u001b[Htop - 10:00:00\r\n",
        dataSeq: 1,
        byteLength: 19
      });
      dataListeners[0]?.({
        sessionId: "session-1",
        data: "PID USER CPU\r\n",
        dataSeq: 2,
        byteLength: 14
      });
    });

    await waitFor(async () => {
      const terminalInstances = await getTerminalInstances();
      expect(terminalInstances[0]?.writeCalls.at(-1)).toBe(
        "\u001b[Htop - 10:00:00\r\nPID USER CPU\r\n"
      );
    });
    expect(terminalApi.ackData).toHaveBeenCalledWith({
      sessionId: "session-1",
      dataSeq: 1,
      byteLength: 19
    });
    expect(terminalApi.ackData).toHaveBeenCalledWith({
      sessionId: "session-1",
      dataSeq: 2,
      byteLength: 14
    });
  });

  test("does not close a session when the pane unmounts during create", async () => {
    let resolveCreate: (() => void) | null = null;
    const props = createProps();
    const terminalApi = props.desktopApi?.terminal as unknown as {
      closeSession: ReturnType<typeof vi.fn>;
      createSession: ReturnType<typeof vi.fn>;
    };
    terminalApi.createSession = vi.fn(() => new Promise<void>((resolve) => {
      resolveCreate = resolve;
    }));

    const rendered = render(<TerminalPaneSurface {...props} />);
    rendered.unmount();

    await act(async () => {
      resolveCreate?.();
      await Promise.resolve();
    });

    expect(terminalApi.closeSession).not.toHaveBeenCalled();
  });

  test("keeps the same xterm renderer when a terminal pane moves between dock and workspace", async () => {
    const dataListeners: Array<(event: { readonly sessionId: string; readonly data: string }) => void> = [];
    const props = createProps();
    const terminalApi = props.desktopApi?.terminal as unknown as {
      onData: ReturnType<typeof vi.fn>;
    };
    terminalApi.onData = vi.fn((listener) => {
      dataListeners.push(listener);
      return () => undefined;
    });

    const firstRender = render(<TerminalPaneSurface {...props} />);
    await waitFor(() => {
      expect(dataListeners).toHaveLength(1);
    });

    act(() => {
      dataListeners[0]?.({
        sessionId: "session-1",
        data: "petehsu@PetedeMacBook-Air:~% ls\r\nApplications  Documents\r\npetehsu@PetedeMacBook-Air:~%"
      });
    });

    await waitFor(async () => {
      const terminalInstances = await getTerminalInstances();
      expect(terminalInstances[0]?.lines.join("\n")).toContain("Applications  Documents");
    });

    firstRender.unmount();

    await act(async () => {
      render(<TerminalPaneSurface {...props} />);
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    });

    const terminalInstances = await getTerminalInstances();
    expect(terminalInstances).toHaveLength(1);
    expect(terminalInstances[0]?.lines.join("\n")).toContain(
      "petehsu@PetedeMacBook-Air:~% ls\nApplications  Documents\npetehsu@PetedeMacBook-Air:~%"
    );
  });
});
