import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { TerminalDockModel } from "../types";
import { clearBulkTerminalRestoreStateForTests } from "../bulk-terminal-restore";
import { useTerminalSessionRestore } from "../use-terminal-session-restore";

describe("useTerminalSessionRestore", () => {
  afterEach(() => {
    clearBulkTerminalRestoreStateForTests();
  });

  test("restores persisted sessions once on boot", async () => {
    const restoreSessions = vi.fn().mockResolvedValue([
      {
        sessionId: "session-pane-1",
        title: "Terminal 1",
        shell: "/bin/zsh",
        cols: 80,
        rows: 24,
        source: "user"
      }
    ]);
    const syncRestoredSessions = vi.fn();
    const terminalModel = {
      restoreRequest: {
        sessions: [
          {
            sessionId: "session-pane-1",
            title: "Terminal 1",
            cols: 80,
            rows: 24,
            source: "user" as const
          }
        ]
      },
      syncRestoredSessions
    } as unknown as TerminalDockModel;

    const desktopApi = {
      terminal: { restoreSessions }
    } as never;

    renderHook(() =>
      useTerminalSessionRestore({
        desktopApi,
        terminalModel
      })
    );

    await waitFor(() => {
      expect(restoreSessions).toHaveBeenCalledTimes(1);
      expect(syncRestoredSessions).toHaveBeenCalledTimes(1);
    });
  });
});