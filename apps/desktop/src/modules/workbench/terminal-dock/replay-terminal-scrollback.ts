import type { Terminal } from "xterm";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

const CLEAR_ACTIVE_VIEWPORT = "\u001b[2J\u001b[H";

export type ReplayTerminalScrollbackOptions = {
  readonly raw?: boolean;
  readonly maxBytes?: number;
  readonly clearActiveViewportAfterReplay?: boolean;
};

export type ReplayTerminalScrollbackResult = {
  readonly replayedBytes: number;
  readonly skipped: boolean;
  readonly reason?: string;
};

const writeTerminalChunk = (terminal: Terminal, data: string): Promise<void> =>
  new Promise((resolve) => {
    try {
      terminal.write(data, resolve);
    } catch (_error) {
      resolve();
    }
  });

export const clearTerminalActiveViewport = (terminal: Terminal): Promise<void> =>
  writeTerminalChunk(terminal, CLEAR_ACTIVE_VIEWPORT);

// ponytail: session persistence was removed in the spawn-per-call refactoring;
// scrollback replay is now a no-op. Upgrade path: replay raw PTY bytes from
// live_output buffer via a future readRawBuffer IPC.
export const replayTerminalScrollback = async (
  _desktopApi: LyraDesktopApi,
  _sessionId: string,
  _terminal: Terminal,
  _options?: ReplayTerminalScrollbackOptions
): Promise<ReplayTerminalScrollbackResult> => ({
  replayedBytes: 0,
  skipped: true,
  reason: "session persistence removed"
});