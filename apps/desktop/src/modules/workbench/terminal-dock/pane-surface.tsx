import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { TerminalDockLabels, TerminalDockPane } from "./types";
import { resolveTerminalTheme } from "./theme";

export type TerminalPaneSurfaceProps = {
  readonly pane: TerminalDockPane;
  readonly terminalTabId?: string;
  readonly active: boolean;
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: TerminalDockLabels;
  readonly themeSignature: string;
  readonly uiThemeId: string;
  readonly onFocus: () => void;
};

const readCssNumber = (element: HTMLElement, name: `--${string}`, fallback: number): number => {
  const value = window.getComputedStyle(element).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

type TerminalRendererCallbacks = {
  readonly onError: (error: string) => void;
  readonly onExit: (exitCode: number | null) => void;
};

type TerminalDataAckPayload = {
  readonly sessionId: string;
  readonly dataSeq: number;
  readonly byteLength: number;
};

type TerminalRendererHandle = {
  readonly sessionId: string;
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  readonly disposeInput: { readonly dispose: () => void };
  readonly disposeRuntimeData: () => void;
  readonly disposeRuntimeExit: () => void;
  readonly disposeRuntimeError: () => void;
  activeToken: symbol | null;
  callbacks: TerminalRendererCallbacks | null;
  inputHandler: ((data: string) => void) | null;
  outputBuffer: string;
  outputAcks: TerminalDataAckPayload[];
  outputFlushFrameId: number | null;
  outputWriteInFlight: boolean;
  readonly acknowledgeOutput: (acks: readonly TerminalDataAckPayload[]) => void;
  readonly disposeRendererAttachment: () => void;
};

const terminalRenderersBySession = new Map<string, TerminalRendererHandle>();

const withTerminalRuntimeEnv = (
  pane: TerminalDockPane,
  terminalTabId?: string
): NonNullable<TerminalDockPane["env"]> => {
  const byKey = new Map<string, string>();
  for (const entry of pane.env ?? []) {
    byKey.set(entry.key, entry.value);
  }
  byKey.set("LYRA_TERMINAL_SESSION_ID", pane.sessionId);
  byKey.set("LYRA_TERMINAL_PANE_ID", pane.id);
  if (terminalTabId !== undefined && terminalTabId.trim().length > 0) {
    byKey.set("LYRA_TERMINAL_TAB_ID", terminalTabId);
  }
  return [...byKey.entries()].map(([key, value]) => ({ key, value }));
};

export const clearTerminalRendererStateForTests = (): void => {
  for (const renderer of terminalRenderersBySession.values()) {
    disposeTerminalRenderer(renderer);
  }
  terminalRenderersBySession.clear();
};

export const disposeTerminalRendererForSession = (sessionId: string): void => {
  const renderer = terminalRenderersBySession.get(sessionId);
  if (renderer === undefined) {
    return;
  }
  terminalRenderersBySession.delete(sessionId);
  disposeTerminalRenderer(renderer);
};

const scheduleTerminalOutputFlush = (handle: TerminalRendererHandle): void => {
  if (handle.outputFlushFrameId !== null || handle.outputWriteInFlight) {
    return;
  }
  handle.outputFlushFrameId = window.requestAnimationFrame(() => {
    handle.outputFlushFrameId = null;
    flushTerminalOutput(handle);
  });
};

const flushTerminalOutput = (handle: TerminalRendererHandle): void => {
  if (handle.outputWriteInFlight || handle.outputBuffer.length === 0) {
    return;
  }
  const data = handle.outputBuffer;
  const acks = handle.outputAcks;
  handle.outputBuffer = "";
  handle.outputAcks = [];
  handle.outputWriteInFlight = true;
  const finish = (): void => {
    handle.outputWriteInFlight = false;
    handle.acknowledgeOutput(acks);
    if (handle.outputBuffer.length > 0) {
      scheduleTerminalOutputFlush(handle);
    }
  };
  try {
    handle.terminal.write(data, finish);
  } catch (_error) {
    // xterm may be between DOM hosts during a dock/workspace move.
    finish();
  }
};

const queueTerminalOutput = (
  handle: TerminalRendererHandle,
  event: {
    readonly sessionId: string;
    readonly data: string;
    readonly dataSeq?: number;
    readonly byteLength?: number;
  }
): void => {
  handle.outputBuffer += event.data;
  if (typeof event.dataSeq === "number" && typeof event.byteLength === "number") {
    handle.outputAcks.push({
      sessionId: event.sessionId,
      dataSeq: event.dataSeq,
      byteLength: event.byteLength
    });
  }
  scheduleTerminalOutputFlush(handle);
};

const getOrCreateTerminalRenderer = ({
  desktopApi,
  host,
  sessionId,
  terminalFontSize,
  terminalLineHeight
}: {
  readonly desktopApi: LyraDesktopApi;
  readonly host: HTMLElement;
  readonly sessionId: string;
  readonly terminalFontSize: number;
  readonly terminalLineHeight: number;
}): TerminalRendererHandle => {
  const existing = terminalRenderersBySession.get(sessionId);
  if (existing !== undefined) {
    attachTerminalToHost(existing.terminal, host);
    applyTerminalRendererOptions(existing.terminal, host, terminalFontSize, terminalLineHeight);
    return existing;
  }

  const terminal = new Terminal({
    allowTransparency: false,
    cursorBlink: true,
    cursorInactiveStyle: "bar",
    cursorStyle: "bar",
    cursorWidth: 1,
    convertEol: false,
    fontFamily: "var(--lyra-font-mono)",
    fontSize: terminalFontSize,
    lineHeight: terminalLineHeight,
    scrollback: 10_000,
    theme: resolveTerminalTheme(host)
  });
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(host);
  const handle: TerminalRendererHandle = {
    sessionId,
    terminal,
    fitAddon,
    activeToken: null,
    callbacks: null,
    inputHandler: null,
    outputBuffer: "",
    outputAcks: [],
    outputFlushFrameId: null,
    outputWriteInFlight: false,
    acknowledgeOutput: (acks) => {
      for (const ack of acks) {
        void desktopApi.terminal.ackData?.(ack).catch((_error) => {
          // Runtime may already be gone while xterm drains queued writes.
        });
      }
    },
    disposeRendererAttachment: () => {
      void desktopApi.terminal.detachRenderer?.({ sessionId }).catch((_error) => {
        // The renderer can outlive the bridge during app shutdown.
      });
    },
    disposeInput: terminal.onData((data) => {
      handle.inputHandler?.(data);
    }),
    disposeRuntimeData: desktopApi.terminal.onData((event) => {
      if (event.sessionId !== handle.sessionId) {
        return;
      }
      queueTerminalOutput(handle, event);
    }),
    disposeRuntimeExit: desktopApi.terminal.onExit((event) => {
      if (event.sessionId !== handle.sessionId) {
        return;
      }
      try {
        handle.terminal.writeln(`\r\n[process exited: ${event.exitCode}]`);
        handle.callbacks?.onExit(event.exitCode);
      } catch (_error) {
        // xterm may still flush a final repaint after a host move.
      }
    }),
    disposeRuntimeError: desktopApi.terminal.onError((event) => {
      if (event.sessionId !== handle.sessionId) {
        return;
      }
      handle.callbacks?.onError(event.error);
    })
  };
  terminalRenderersBySession.set(sessionId, handle);
  void desktopApi.terminal.attachRenderer?.({ sessionId }).catch((_error) => undefined);
  return handle;
};

const disposeTerminalRenderer = (renderer: TerminalRendererHandle): void => {
  renderer.callbacks = null;
  renderer.inputHandler = null;
  if (renderer.outputFlushFrameId !== null) {
    window.cancelAnimationFrame(renderer.outputFlushFrameId);
    renderer.outputFlushFrameId = null;
  }
  if (renderer.outputAcks.length > 0) {
    renderer.acknowledgeOutput(renderer.outputAcks);
    renderer.outputAcks = [];
  }
  renderer.outputBuffer = "";
  renderer.disposeInput.dispose();
  renderer.disposeRuntimeData();
  renderer.disposeRuntimeExit();
  renderer.disposeRuntimeError();
  renderer.disposeRendererAttachment();
  renderer.terminal.dispose();
};

const attachTerminalToHost = (terminal: Terminal, host: HTMLElement): void => {
  const terminalElement = (terminal as Terminal & { element?: HTMLElement }).element;
  if (terminalElement === undefined) {
    terminal.open(host);
    return;
  }
  if (terminalElement.parentElement !== host) {
    host.append(terminalElement);
  }
};

const applyTerminalRendererOptions = (
  terminal: Terminal,
  host: HTMLElement,
  terminalFontSize: number,
  terminalLineHeight: number
): void => {
  terminal.options.fontFamily = "var(--lyra-font-mono)";
  terminal.options.fontSize = terminalFontSize;
  terminal.options.lineHeight = terminalLineHeight;
  terminal.options.theme = resolveTerminalTheme(host);
};

const TERMINAL_RESIZE_SETTLE_MS = 140;
const TERMINAL_HORIZONTAL_RESIZE_DEBOUNCE_MS = 100;
const TERMINAL_HORIZONTAL_RESIZE_BUFFER_THRESHOLD = 200;
const TERMINAL_INITIAL_RESIZE_RETRY_MS: readonly number[] = [32, 120, 320];
const TERMINAL_MIN_FIT_COLS = 10;
const TERMINAL_MIN_FIT_ROWS = 3;
type TerminalResizeMode = "immediate" | "settled";

const readTerminalBufferLength = (terminal: Terminal): number => {
  const candidate = terminal as Terminal & {
    readonly buffer?: {
      readonly normal?: { readonly length?: number };
      readonly active?: { readonly length?: number };
    };
  };
  const normalLength = candidate.buffer?.normal?.length;
  if (typeof normalLength === "number" && Number.isFinite(normalLength)) {
    return normalLength;
  }
  const activeLength = candidate.buffer?.active?.length;
  if (typeof activeLength === "number" && Number.isFinite(activeLength)) {
    return activeLength;
  }
  return 0;
};

const terminalHasVisibleContent = (terminal: Terminal): boolean => {
  const candidate = terminal as Terminal & {
    readonly buffer?: {
      readonly active?: {
        readonly baseY?: number;
        readonly viewportY?: number;
        readonly length?: number;
        readonly getLine?: (index: number) => {
          readonly translateToString?: (trimRight?: boolean) => string;
        } | undefined;
      };
    };
  };
  const active = candidate.buffer?.active;
  const getLine = active?.getLine;
  if (getLine === undefined) {
    return readTerminalBufferLength(terminal) > 1;
  }
  const viewportY = typeof active.viewportY === "number"
    ? active.viewportY
    : (typeof active.baseY === "number" ? active.baseY : 0);
  const maxRows = Math.max(terminal.rows, 1);
  for (let row = 0; row < maxRows; row += 1) {
    const line = getLine(viewportY + row) ?? getLine(row);
    const text = line?.translateToString?.(true) ?? "";
    if (text.trim().length > 0) {
      return true;
    }
  }
  return false;
};

const textFromScreenRows = (
  rows: readonly { readonly text: string }[],
  fallback: string
): string => {
  const rowText = rows
    .map((row) => row.text)
    .join("\r\n")
    .replace(/[ \t\r\n]+$/u, "");
  if (rowText.trim().length > 0) {
    return rowText;
  }
  return fallback.replace(/[ \t\r\n]+$/u, "");
};

export const TerminalPaneSurface = ({
  pane,
  terminalTabId,
  active,
  desktopApi,
  labels,
  themeSignature,
  uiThemeId,
  onFocus
}: TerminalPaneSurfaceProps) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sessionReadyRef = useRef(false);
  const sessionDisposedRef = useRef(false);
  const unavailableMessageRef = useRef(labels.unavailable);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const applyTheme = useCallback((): void => {
    if (sessionDisposedRef.current) {
      return;
    }
    const host = hostRef.current;
    const terminal = terminalRef.current;
    if (host === null || terminal === null) {
      return;
    }

    try {
      terminal.options.theme = resolveTerminalTheme(host);
    } catch (_error) {
      // xterm may throw during teardown ticks
    }
  }, []);

  useEffect(() => {
    unavailableMessageRef.current = labels.unavailable;
  }, [labels.unavailable]);

  useEffect(() => {
    sessionReadyRef.current = false;
    sessionDisposedRef.current = false;
    let frameId: number | null = null;
    let resizeFrameId: number | null = null;
    let resizeSettleTimerId: number | null = null;
    const initialResizeTimerIds: number[] = [];
    let lastSyncedCols = -1;
    let lastSyncedRows = -1;

    if (desktopApi === null) {
      setStatusMessage(unavailableMessageRef.current);
      return;
    }

    const host = hostRef.current;
    if (host === null) {
      return;
    }

    const terminalFontSize = readCssNumber(host, "--lyra-text-size-meta", 12);
    const terminalLineHeight =
      readCssNumber(host, "--lyra-text-line-body", 20) / Math.max(terminalFontSize, 1);
    const renderer = getOrCreateTerminalRenderer({
      desktopApi,
      host,
      sessionId: pane.sessionId,
      terminalFontSize,
      terminalLineHeight
    });
    const rendererToken = Symbol(pane.sessionId);
    renderer.activeToken = rendererToken;
    const terminal = renderer.terminal;
    const fitAddon = renderer.fitAddon;
    terminalRef.current = terminal;
    const terminalWithElement = terminal as Terminal & { element?: HTMLElement };

    const fitToContainer = (options?: { readonly deferColumns?: boolean }): boolean => {
      if (sessionDisposedRef.current) {
        return false;
      }
      if (!host.isConnected) {
        return false;
      }
      if (host.clientWidth <= 0 || host.clientHeight <= 0) {
        return false;
      }
      if (terminalWithElement.element === undefined || !terminalWithElement.element.isConnected) {
        return false;
      }
      let dimensions: ReturnType<FitAddon["proposeDimensions"]>;
      try {
        dimensions = fitAddon.proposeDimensions();
      } catch (_error) {
        return false;
      }
      if (
        dimensions === undefined ||
        Number.isFinite(dimensions.cols) === false ||
        Number.isFinite(dimensions.rows) === false ||
        dimensions.cols < TERMINAL_MIN_FIT_COLS ||
        dimensions.rows < TERMINAL_MIN_FIT_ROWS
      ) {
        return false;
      }
      if (terminal.cols === dimensions.cols && terminal.rows === dimensions.rows) {
        return true;
      }
      const shouldDeferColumns =
        options?.deferColumns === true &&
        terminal.cols !== dimensions.cols &&
        readTerminalBufferLength(terminal) >= TERMINAL_HORIZONTAL_RESIZE_BUFFER_THRESHOLD;
      const nextCols = shouldDeferColumns ? terminal.cols : dimensions.cols;
      const nextRows = dimensions.rows;
      if (terminal.cols === nextCols && terminal.rows === nextRows) {
        return true;
      }
      try {
        terminal.resize(nextCols, nextRows);
        return true;
      } catch (_error) {
        // xterm can throw during very early/late lifecycle ticks; safe to ignore.
        return false;
      }
    };

    const resizeAndSync = (options?: { readonly deferColumns?: boolean }): void => {
      if (fitToContainer(options) === false) {
        return;
      }
      if (sessionReadyRef.current === false) {
        return;
      }
      if (terminal.cols === lastSyncedCols && terminal.rows === lastSyncedRows) {
        return;
      }
      lastSyncedCols = terminal.cols;
      lastSyncedRows = terminal.rows;
      void desktopApi.terminal.resize({
        sessionId: pane.sessionId,
        cols: terminal.cols,
        rows: terminal.rows
      }).catch((_error) => {
        // may happen during transient create/close races; ignored on purpose.
      });
    };

    const cancelResizeSettleTimer = (): void => {
      if (resizeSettleTimerId === null) {
        return;
      }
      window.clearTimeout(resizeSettleTimerId);
      resizeSettleTimerId = null;
    };

    const cancelInitialResizeTimers = (): void => {
      while (initialResizeTimerIds.length > 0) {
        const timerId = initialResizeTimerIds.pop();
        if (timerId !== undefined) {
          window.clearTimeout(timerId);
        }
      }
    };

    const scheduleResizeFrame = (options?: { readonly deferColumns?: boolean }): void => {
      if (sessionDisposedRef.current) {
        return;
      }
      if (resizeFrameId !== null) {
        return;
      }
      resizeFrameId = requestAnimationFrame(() => {
        resizeFrameId = null;
        resizeAndSync(options);
      });
    };

    const scheduleResizeAndSync = (mode: TerminalResizeMode = "settled"): void => {
      if (sessionDisposedRef.current) {
        return;
      }
      // Panel animations produce transient terminal sizes; only user drag needs frame-level fitting.
      const isLayoutResizing = host.ownerDocument.body.classList.contains("lyra-layout-resizing");
      if (mode === "immediate" || isLayoutResizing) {
        cancelResizeSettleTimer();
        scheduleResizeFrame({ deferColumns: isLayoutResizing });
        if (isLayoutResizing) {
          resizeSettleTimerId = window.setTimeout(() => {
            resizeSettleTimerId = null;
            scheduleResizeFrame();
          }, TERMINAL_HORIZONTAL_RESIZE_DEBOUNCE_MS);
        }
        return;
      }

      cancelResizeSettleTimer();
      resizeSettleTimerId = window.setTimeout(() => {
        resizeSettleTimerId = null;
        scheduleResizeFrame();
      }, TERMINAL_RESIZE_SETTLE_MS);
    };

    const scheduleInitialResizeRetries = (): void => {
      cancelInitialResizeTimers();
      for (const delayMs of TERMINAL_INITIAL_RESIZE_RETRY_MS) {
        const timerId = window.setTimeout(() => {
          const index = initialResizeTimerIds.indexOf(timerId);
          if (index >= 0) {
            initialResizeTimerIds.splice(index, 1);
          }
          scheduleResizeAndSync("immediate");
        }, delayMs);
        initialResizeTimerIds.push(timerId);
      }
    };

    applyTheme();
    frameId = requestAnimationFrame(() => {
      if (sessionDisposedRef.current) {
        return;
      }
      resizeAndSync();
    });

    const resizeObserver = new ResizeObserver(() => {
      if (sessionDisposedRef.current) {
        return;
      }
      scheduleResizeAndSync();
    });
    resizeObserver.observe(host);

    renderer.inputHandler = (data) => {
      if (sessionReadyRef.current === false) {
        return;
      }
      const request = {
        sessionId: pane.sessionId,
        data,
        source: "user"
      } as const;
      if (desktopApi.terminal.writeFast?.(request) === true) {
        return;
      }
      void desktopApi.terminal.write(request)
        .catch((_error) => {
          // may happen during transient create/close races; ignored on purpose.
        });
    };
    renderer.callbacks = {
      onError: (error) => {
        setStatusMessage(error);
      },
      onExit: () => undefined
    };

    setStatusMessage(null);
    fitToContainer();
    void desktopApi.terminal
      .createSession({
        sessionId: pane.sessionId,
        title: pane.title,
        ...(pane.cwd !== undefined ? { cwd: pane.cwd } : {}),
        ...(pane.shell !== undefined ? { shell: pane.shell } : {}),
        env: withTerminalRuntimeEnv(pane, terminalTabId),
        ...(pane.mode !== undefined ? { mode: pane.mode } : {}),
        ...(pane.command !== undefined ? { command: pane.command } : {}),
        uiThemeId,
        cols: terminal.cols,
        rows: terminal.rows,
        source: "user"
      })
      .then(() => {
        if (sessionDisposedRef.current) {
          return;
        }
        sessionReadyRef.current = true;
        lastSyncedCols = -1;
        lastSyncedRows = -1;
        scheduleResizeAndSync("immediate");
        scheduleInitialResizeRetries();
        if (terminalHasVisibleContent(terminal) || renderer.outputBuffer.length > 0) {
          return;
        }
        void desktopApi.terminal.readScreen({
          sessionId: pane.sessionId,
          maxRows: Math.max(terminal.rows, 1),
          maxBytes: 32_000
        }).then((screen) => {
          if (
            sessionDisposedRef.current ||
            terminalHasVisibleContent(terminal) ||
            renderer.outputBuffer.length > 0
          ) {
            return;
          }
          const text = textFromScreenRows(screen.visibleRows, screen.visibleText);
          if (text.trim().length === 0) {
            return;
          }
          terminal.write(text);
        }).catch((_error: unknown) => {
          // Restoring the visible buffer is best-effort; live runtime data remains authoritative.
        });
      })
      .catch((error: unknown) => {
        sessionReadyRef.current = false;
        setStatusMessage(error instanceof Error ? error.message : unavailableMessageRef.current);
      });

    return () => {
      sessionDisposedRef.current = true;
      sessionReadyRef.current = false;
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      if (resizeFrameId !== null) {
        cancelAnimationFrame(resizeFrameId);
      }
      cancelResizeSettleTimer();
      cancelInitialResizeTimers();
      resizeObserver.disconnect();
      if (renderer.activeToken === rendererToken) {
        renderer.activeToken = null;
        renderer.callbacks = null;
        renderer.inputHandler = null;
      }
      terminalRef.current = null;
    };
  }, [
    applyTheme,
    desktopApi,
    pane.sessionId
  ]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => {
      applyTheme();
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [applyTheme, themeSignature]);

  return (
    <section
      className={active ? "lyra-terminal-pane lyra-terminal-pane-active" : "lyra-terminal-pane"}
      onMouseDown={onFocus}
    >
      <div className="lyra-terminal-pane-body">
        <div className="lyra-terminal-host" ref={hostRef} />
        {statusMessage === null ? null : <div className="lyra-terminal-status">{statusMessage}</div>}
      </div>
    </section>
  );
};
