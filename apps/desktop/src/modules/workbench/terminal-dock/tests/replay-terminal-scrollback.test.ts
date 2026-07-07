import { describe, expect, test } from "vitest";
import type { Terminal } from "xterm";

import type { LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { replayTerminalScrollback } from "../replay-terminal-scrollback";

const createTerminal = (): Terminal =>
  ({ write: (_data: string, callback?: () => void) => callback?.() }) as Terminal;

describe("replayTerminalScrollback", () => {
  test("returns skipped result (session persistence removed)", async () => {
    const terminal = createTerminal();
    const result = await replayTerminalScrollback(
      {} as unknown as LyraDesktopApi,
      "session-1",
      terminal
    );
    expect(result).toEqual({
      replayedBytes: 0,
      skipped: true,
      reason: "session persistence removed"
    });
  });
});