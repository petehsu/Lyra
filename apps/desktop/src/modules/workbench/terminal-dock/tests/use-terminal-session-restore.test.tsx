import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { TerminalDockModel } from "../types";
import { clearBulkTerminalRestoreStateForTests } from "../bulk-terminal-restore";
import { useTerminalSessionRestore } from "../use-terminal-session-restore";

describe("useTerminalSessionRestore", () => {
  afterEach(() => {
    clearBulkTerminalRestoreStateForTests();
  });

  test("is a no-op (session persistence removed)", () => {
    const terminalModel = {
      restoreRequest: { sessions: [] },
      syncRestoredSessions: vi.fn()
    } as unknown as TerminalDockModel;

    const desktopApi = { terminal: {} } as never;

    const { result } = renderHook(() =>
      useTerminalSessionRestore({
        desktopApi,
        terminalModel
      })
    );

    expect(result.current).toBeUndefined();
  });
});