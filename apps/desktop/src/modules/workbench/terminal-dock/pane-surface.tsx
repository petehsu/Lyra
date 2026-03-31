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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sessionReadyRef = useRef(false);
  const sessionDisposedRef = useRef(false);
  const initialThemePresetRef = useRef(themePresetId);
  const unavailableMessageRef = useRef(labels.unavailable);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [readyToPaint, setReadyToPaint] = useState(false);

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
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
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
    let frameId: number | null = null;
    let resizeFrameId: number | null = null;
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

    const terminal = new Terminal({
      allowTransparency: false,
      cursorBlink: true,
      convertEol: true,
      fontFamily: "var(--lyra-font-mono)",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: resolveTerminalTheme(host)
    });
    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    const terminalWithElement = terminal as Terminal & { element?: HTMLElement };

    const fitToContainer = (): void => {
      if (sessionDisposedRef.current) {
        return;
      }
      if (host.clientWidth <= 0 || host.clientHeight <= 0) {
        return;
      }
      if (terminalWithElement.element === undefined) {
        return;
      }
      try {
        fitAddon.fit();
      } catch (_error) {
        // xterm can throw during very early/late lifecycle ticks; safe to ignore.
      }
    };

    const resizeAndSync = (): void => {
      fitToContainer();
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

    const scheduleResizeAndSync = (): void => {
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
        terminal.write(event.data);
      });

    const unlistenExit =
      desktopApi.terminal.onExit((event) => {
        if (sessionDisposedRef.current) {
          return;
        }
        if (event.sessionId !== pane.sessionId) {
          return;
        }
        terminal.writeln(`\r\n[process exited: ${event.exitCode}]`);
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
        lastSyncedCols = -1;
        lastSyncedRows = -1;
        scheduleResizeAndSync();
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
      disposeData.dispose();
      unlistenData();
      unlistenExit();
      unlistenError();
      resizeObserver.disconnect();
      terminalRef.current = null;
      terminal.dispose();
      setReadyToPaint(false);
    };
  }, [applyTheme, desktopApi, pane.sessionId]);

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
        <div className={readyToPaint ? "lyra-terminal-host lyra-terminal-host-ready" : "lyra-terminal-host"} ref={hostRef} />
        {statusMessage === null ? null : <div className="lyra-terminal-status">{statusMessage}</div>}
      </div>
    </section>
  );
};
