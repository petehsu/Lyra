import type { Terminal } from "xterm";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

const OUTPUT_PROBE_END = 1;
const OUTPUT_CHUNK_BYTES = 512 * 1024;
const DEFAULT_MAX_REPLAY_BYTES = 2 * 1024 * 1024;
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
    if (data.length === 0) {
      resolve();
      return;
    }
    try {
      terminal.write(data, resolve);
    } catch (_error) {
      resolve();
    }
  });

const historyReadable = (
  memory: { readonly restoration?: { readonly historyReadable?: boolean } } | undefined
): boolean => memory?.restoration?.historyReadable !== false;

export const clearTerminalActiveViewport = (terminal: Terminal): Promise<void> =>
  writeTerminalChunk(terminal, CLEAR_ACTIVE_VIEWPORT);

export const replayTerminalScrollback = async (
  desktopApi: LyraDesktopApi,
  sessionId: string,
  terminal: Terminal,
  options?: ReplayTerminalScrollbackOptions
): Promise<ReplayTerminalScrollbackResult> => {
  const readOutputRange = desktopApi.terminal.readOutputRange;
  if (readOutputRange === undefined) {
    return { replayedBytes: 0, skipped: true, reason: "readOutputRange unavailable" };
  }

  const raw = options?.raw ?? false;
  const maxBytes = Math.max(0, options?.maxBytes ?? DEFAULT_MAX_REPLAY_BYTES);
  if (maxBytes === 0) {
    return { replayedBytes: 0, skipped: true, reason: "maxBytes is zero" };
  }

  const probe = await readOutputRange({
    sessionId,
    start: 0,
    end: OUTPUT_PROBE_END,
    raw
  });
  if (!historyReadable(probe.memory)) {
    return { replayedBytes: 0, skipped: true, reason: "history not readable" };
  }

  const totalBytes = Math.max(0, Math.floor(probe.totalBytes));
  if (totalBytes === 0) {
    return { replayedBytes: 0, skipped: true, reason: "no persisted output" };
  }

  let startOffset = 0;
  if (totalBytes > maxBytes) {
    startOffset = totalBytes - maxBytes;
  }

  let cursor = startOffset;
  let replayedBytes = 0;

  while (cursor < totalBytes) {
    const chunkEnd = Math.min(totalBytes, cursor + OUTPUT_CHUNK_BYTES);
    const page = await readOutputRange({
      sessionId,
      start: cursor,
      end: chunkEnd,
      raw
    });
    if (!historyReadable(page.memory)) {
      break;
    }

    const rangeStart = Math.max(0, Math.floor(page.range.start));
    const rangeEnd = Math.max(rangeStart, Math.floor(page.range.end));
    const chunkBytes = Math.max(0, rangeEnd - rangeStart);
    if (page.output.length > 0) {
      await writeTerminalChunk(terminal, page.output);
      replayedBytes += chunkBytes;
    }

    const nextStart = Math.max(cursor, Math.floor(page.nextStart));
    if (nextStart <= cursor) {
      break;
    }
    cursor = nextStart;
    if (!page.truncated && nextStart >= totalBytes) {
      break;
    }
  }

  if (replayedBytes > 0 && options?.clearActiveViewportAfterReplay !== false) {
    await clearTerminalActiveViewport(terminal);
  }

  return {
    replayedBytes,
    skipped: replayedBytes === 0,
    ...(replayedBytes === 0 ? { reason: "empty replay payload" } : {})
  };
};