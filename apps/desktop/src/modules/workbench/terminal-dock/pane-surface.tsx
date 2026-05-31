import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { TerminalDockLabels, TerminalDockPane } from "./types";
import { resolveTerminalTheme } from "./theme";
import type { TerminalThemePresetId } from "../terminal-theme";

export type TerminalPaneSurfaceProps = {
  readonly pane: TerminalDockPane;
  readonly active: boolean;
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: TerminalDockLabels;
  readonly themeSignature: string;
  readonly themePresetId: TerminalThemePresetId;
  readonly uiThemeId: string;
  readonly onFocus: () => void;
};

const readCssNumber = (element: HTMLElement, name: `--${string}`, fallback: number): number => {
  const value = window.getComputedStyle(element).getPropertyValue(name).trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const TERMINAL_RESIZE_SETTLE_MS = 140;
const TERMINAL_MIN_FIT_COLS = 10;
const TERMINAL_MIN_FIT_ROWS = 3;
type TerminalResizeMode = "immediate" | "settled";

export const TerminalPaneSurface = ({
  pane,
  active,
  desktopApi,
  labels,
  themeSignature,
  themePresetId,
  uiThemeId,
  onFocus
}: TerminalPaneSurfaceProps) => {
  const paneBodyRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sessionReadyRef = useRef(false);
  const sessionDisposedRef = useRef(false);
  const initialThemePresetRef = useRef(themePresetId);
  const appliedPromptSignatureRef = useRef(`${themePresetId}:${uiThemeId}`);
  const unavailableMessageRef = useRef(labels.unavailable);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [readyToPaint, setReadyToPaint] = useState(false);
  const [promptSessionReady, setPromptSessionReady] = useState(false);

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
    setReadyToPaint(false);
    setPromptSessionReady(false);
    let frameId: number | null = null;
    let resizeFrameId: number | null = null;
    let resizeSettleTimerId: number | null = null;
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

    const terminal = new Terminal({
      allowTransparency: false,
      cursorBlink: true,
      cursorInactiveStyle: "bar",
      cursorStyle: "bar",
      cursorWidth: 1,
      convertEol: true,
      fontFamily: "var(--lyra-font-mono)",
      fontSize: terminalFontSize,
      lineHeight: terminalLineHeight,
      scrollback: 10_000,
      theme: resolveTerminalTheme(host)
    });
    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    const terminalWithElement = terminal as Terminal & { element?: HTMLElement };

    const fitToContainer = (): boolean => {
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
      try {
        fitAddon.fit();
        return true;
      } catch (_error) {
        // xterm can throw during very early/late lifecycle ticks; safe to ignore.
        return false;
      }
    };

    const resizeAndSync = (): void => {
      if (fitToContainer() === false) {
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

    const scheduleResizeFrame = (): void => {
      if (sessionDisposedRef.current) {
        return;
      }
      if (resizeFrameId !== null) {
        return;
      }
      resizeFrameId = requestAnimationFrame(() => {
        resizeFrameId = null;
        resizeAndSync();
      });
    };

    const scheduleResizeAndSync = (mode: TerminalResizeMode = "settled"): void => {
      if (sessionDisposedRef.current) {
        return;
      }
      // Panel animations produce transient terminal sizes; only user drag needs frame-level fitting.
      if (
        mode === "immediate" ||
        host.ownerDocument.body.classList.contains("lyra-layout-resizing")
      ) {
        cancelResizeSettleTimer();
        scheduleResizeFrame();
        return;
      }

      cancelResizeSettleTimer();
      resizeSettleTimerId = window.setTimeout(() => {
        resizeSettleTimerId = null;
        scheduleResizeFrame();
      }, TERMINAL_RESIZE_SETTLE_MS);
    };

    applyTheme();
    frameId = requestAnimationFrame(() => {
      if (sessionDisposedRef.current) {
        return;
      }
      resizeAndSync();
      setReadyToPaint(true);
    });

    const resizeObserver = new ResizeObserver(() => {
      if (sessionDisposedRef.current) {
        return;
      }
      scheduleResizeAndSync();
    });
    resizeObserver.observe(host);

    const disposeData = terminal.onData((data) => {
      if (sessionReadyRef.current === false) {
        return;
      }
      void desktopApi.terminal.write({
        sessionId: pane.sessionId,
        data,
        source: "user"
      }).catch((_error) => {
        // may happen during transient create/close races; ignored on purpose.
      });
    });

    const unlistenData =
      desktopApi.terminal.onData((event) => {
        if (sessionDisposedRef.current) {
          return;
        }
        if (event.sessionId !== pane.sessionId) {
          return;
        }
        try {
          terminal.write(event.data);
        } catch (_error) {
          // xterm may still emit late writes during teardown or hidden-layout transitions.
        }
      });

    const unlistenExit =
      desktopApi.terminal.onExit((event) => {
        if (sessionDisposedRef.current) {
          return;
        }
        if (event.sessionId !== pane.sessionId) {
          return;
        }
        try {
          terminal.writeln(`\r\n[process exited: ${event.exitCode}]`);
        } catch (_error) {
          // xterm may still flush a final repaint after disposal.
        }
      });

    const unlistenError =
      desktopApi.terminal.onError((event) => {
        if (sessionDisposedRef.current) {
          return;
        }
        if (event.sessionId !== pane.sessionId) {
          return;
        }
        setStatusMessage(event.error);
      });

    setStatusMessage(null);
    fitToContainer();
    void desktopApi.terminal
      .createSession({
        sessionId: pane.sessionId,
        title: pane.title,
        ...(pane.cwd !== undefined ? { cwd: pane.cwd } : {}),
        ...(pane.mode !== undefined ? { mode: pane.mode } : {}),
        ...(pane.command !== undefined ? { command: pane.command } : {}),
        terminalThemePreset: initialThemePresetRef.current,
        uiThemeId,
        cols: terminal.cols,
        rows: terminal.rows,
        source: "user"
      })
      .then(() => {
        if (sessionDisposedRef.current) {
          void desktopApi.terminal.closeSession({ sessionId: pane.sessionId }).catch((_error) => {
            // best effort cleanup for racey create-then-dispose
          });
          return;
        }
        sessionReadyRef.current = true;
        setPromptSessionReady(true);
        appliedPromptSignatureRef.current = `${initialThemePresetRef.current}:${uiThemeId}`;
        lastSyncedCols = -1;
        lastSyncedRows = -1;
        scheduleResizeAndSync("immediate");
      })
      .catch((error: unknown) => {
        sessionReadyRef.current = false;
        setPromptSessionReady(false);
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
      disposeData.dispose();
      unlistenData();
      unlistenExit();
      unlistenError();
      resizeObserver.disconnect();
      terminalRef.current = null;
      terminal.dispose();
      setReadyToPaint(false);
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

  useEffect(() => {
    const nextPromptSignature = `${themePresetId}:${uiThemeId}`;
    if (active === false) {
      return;
    }
    if (desktopApi === null || sessionReadyRef.current === false) {
      return;
    }
    if (appliedPromptSignatureRef.current === nextPromptSignature) {
      return;
    }

    appliedPromptSignatureRef.current = nextPromptSignature;
    void desktopApi.terminal.reloadPrompt({
      sessionId: pane.sessionId,
      terminalThemePreset: themePresetId,
      uiThemeId,
      source: "user"
    }).catch((_error) => {
      // prompt refresh is best-effort; xterm theme still updates locally.
    });
  }, [active, desktopApi, pane.sessionId, promptSessionReady, themePresetId, uiThemeId]);

  return (
    <section
      className={active ? "lyra-terminal-pane lyra-terminal-pane-active" : "lyra-terminal-pane"}
      onMouseDown={onFocus}
    >
      <div className="lyra-terminal-pane-body" ref={paneBodyRef}>
        <div className={readyToPaint ? "lyra-terminal-host lyra-terminal-host-ready" : "lyra-terminal-host"} ref={hostRef} />
        {statusMessage === null ? null : <div className="lyra-terminal-status">{statusMessage}</div>}
      </div>
    </section>
  );
};
