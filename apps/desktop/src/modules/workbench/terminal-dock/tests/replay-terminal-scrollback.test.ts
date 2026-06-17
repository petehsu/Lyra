import { describe, expect, test, vi } from "vitest";
import type { Terminal } from "xterm";

import type { LyraDesktopApi, TerminalMemoryMetadata } from "../../../../shared/desktop-bridge";
import { replayTerminalScrollback } from "../replay-terminal-scrollback";

const memory = {
  eventLogPath: "/tmp/events.jsonl",
  summaryPath: "/tmp/summary.json",
  uiTimelinePath: "/tmp/timeline.jsonl",
  outputTextPath: "/tmp/output.txt",
  rawOutputPath: "/tmp/output.raw",
  lineIndexPath: "/tmp/lines.jsonl",
  errorIndexPath: "/tmp/errors.jsonl",
  commandsPath: "/tmp/commands.jsonl",
  outputByteRange: { start: 0, end: 0 },
  estimatedTokens: 0,
  truncatedByProjection: false
} satisfies TerminalMemoryMetadata;

const createTerminal = (): Terminal & { readonly writes: string[] } => {
  const writes: string[] = [];
  return {
    writes,
    write: (data: string, callback?: () => void) => {
      writes.push(data);
      callback?.();
    }
  } as Terminal & { readonly writes: string[] };
};

describe("replayTerminalScrollback", () => {
  test("skips when persisted output is empty", async () => {
    const readOutputRange = vi.fn(async () => ({
      sessionId: "session-1",
      raw: true,
      encoding: "utf8-lossy",
      requestedRange: { start: 0, end: 1 },
      range: { start: 0, end: 0 },
      nextStart: 0,
      byteLength: 0,
      totalBytes: 0,
      output: "",
      truncated: false,
      memory
    }));
    const terminal = createTerminal();

    const result = await replayTerminalScrollback(
      { terminal: { readOutputRange } } as unknown as LyraDesktopApi,
      "session-1",
      terminal
    );

    expect(result).toEqual({
      replayedBytes: 0,
      skipped: true,
      reason: "no persisted output"
    });
    expect(terminal.writes).toEqual([]);
  });

  test("replays text output pages before live stream resumes", async () => {
    const readOutputRange = vi.fn(async (request: { readonly start: number; readonly end: number }) => {
      if (request.end <= 1) {
        return {
          sessionId: "session-1",
          raw: false,
          encoding: "utf8",
          requestedRange: { start: 0, end: 1 },
          range: { start: 0, end: 1 },
          nextStart: 1,
          byteLength: 1,
          totalBytes: 12,
          output: "",
          truncated: false,
          memory
        };
      }
      return {
        sessionId: "session-1",
        raw: false,
        encoding: "utf8",
        requestedRange: { start: request.start, end: request.end },
        range: { start: 0, end: 12 },
        nextStart: 12,
        byteLength: 12,
        totalBytes: 12,
        output: "prompt % ls\n",
        truncated: false,
        memory
      };
    });
    const terminal = createTerminal();

    const result = await replayTerminalScrollback(
      { terminal: { readOutputRange } } as unknown as LyraDesktopApi,
      "session-1",
      terminal
    );

    expect(result).toEqual({
      replayedBytes: 12,
      skipped: false
    });
    expect(terminal.writes[0]).toBe("prompt % ls\n");
    expect(terminal.writes.at(-1)).toBe("\u001b[2J\u001b[H");
    expect(readOutputRange).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      raw: false,
      start: 0,
      end: 1
    }));
    expect(readOutputRange).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      raw: false,
      start: 0,
      end: 12
    }));
    expect(terminal.writes.at(-1)).toBe("\u001b[2J\u001b[H");
  });

  test("replays only the tail when persisted output exceeds the replay budget", async () => {
    const readOutputRange = vi.fn(async (request: { readonly start: number; readonly end: number }) => {
      if (request.end <= 1) {
        return {
          sessionId: "session-1",
          raw: true,
          encoding: "utf8-lossy",
          requestedRange: { start: 0, end: 1 },
          range: { start: 0, end: 1 },
          nextStart: 1,
          byteLength: 1,
          totalBytes: 10,
          output: "",
          truncated: false,
          memory
        };
      }
      return {
        sessionId: "session-1",
        raw: false,
        encoding: "utf8",
        requestedRange: { start: request.start, end: request.end },
        range: { start: 4, end: 10 },
        nextStart: 10,
        byteLength: 6,
        totalBytes: 10,
        output: "tail\n",
        truncated: false,
        memory
      };
    });
    const terminal = createTerminal();

    const result = await replayTerminalScrollback(
      { terminal: { readOutputRange } } as unknown as LyraDesktopApi,
      "session-1",
      terminal,
      { maxBytes: 6 }
    );

    expect(result.replayedBytes).toBe(6);
    expect(terminal.writes[0]).toBe("tail\n");
    expect(terminal.writes.at(-1)).toBe("\u001b[2J\u001b[H");
    expect(readOutputRange).toHaveBeenLastCalledWith(expect.objectContaining({
      start: 4,
      end: 10,
      raw: false
    }));
  });
});