import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent
} from "react";

import {
  createFirstPartyAppModule,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

const COMMANDS = {
  read: "lyra.core.terminal.read",
  create: "lyra.core.terminal.create",
  focusPane: "lyra.core.terminal.focus-pane",
  closePane: "lyra.core.terminal.close-pane",
  readSession: "lyra.core.terminal.read-session",
  writeSession: "lyra.core.terminal.write-session"
} as const;
const TERMINAL_CHANGED_EVENT = "lyra.core.terminal-changed";

type TerminalTab = {
  readonly id: string;
  readonly title: string;
  readonly activePaneId: string;
  readonly placement: "dock" | "workspace";
};

type TerminalPane = {
  readonly id: string;
  readonly tabId: string;
  readonly sessionId: string;
  readonly title: string;
  readonly cwd?: string;
  readonly currentCwd?: string;
  readonly shell?: string;
  readonly mode?: "command" | "shell";
  readonly placement: "dock" | "workspace";
  readonly active: boolean;
};

export type TerminalTopology = {
  readonly activeTabId: string;
  readonly tabs: readonly TerminalTab[];
  readonly panes: readonly TerminalPane[];
};

export type TerminalSessionRead = {
  readonly sessionId: string;
  readonly cursor: string;
  readonly output: string;
  readonly running: boolean;
  readonly exitCode: number | null;
  readonly truncated: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

export const parseTerminalTopology = (value: unknown): TerminalTopology => {
  if (!isRecord(value) || !Array.isArray(value.tabs) || !Array.isArray(value.panes)) {
    throw new Error("Core returned an invalid terminal topology.");
  }
  const tabs = value.tabs.flatMap((entry): readonly TerminalTab[] => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const title = stringValue(entry.title);
    const activePaneId = stringValue(entry.activePaneId);
    const placement = entry.placement;
    return id === undefined || title === undefined || activePaneId === undefined
      || (placement !== "dock" && placement !== "workspace")
      ? []
      : [{ id, title, activePaneId, placement }];
  });
  const panes = value.panes.flatMap((entry): readonly TerminalPane[] => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const tabId = stringValue(entry.tabId);
    const sessionId = stringValue(entry.sessionId);
    const title = stringValue(entry.title);
    const placement = entry.placement;
    if (
      id === undefined || tabId === undefined || sessionId === undefined || title === undefined
      || (placement !== "dock" && placement !== "workspace")
    ) return [];
    const cwd = stringValue(entry.cwd);
    const currentCwd = stringValue(entry.currentCwd);
    const shell = stringValue(entry.shell);
    const mode = entry.mode === "command" || entry.mode === "shell" ? entry.mode : undefined;
    return [{
      id, tabId, sessionId, title, placement, active: entry.active === true,
      ...(cwd === undefined ? {} : { cwd }),
      ...(currentCwd === undefined ? {} : { currentCwd }),
      ...(shell === undefined ? {} : { shell }),
      ...(mode === undefined ? {} : { mode })
    }];
  });
  return {
    activeTabId: stringValue(value.activeTabId) ?? "",
    tabs,
    panes
  };
};

export const parseTerminalSessionRead = (value: unknown): TerminalSessionRead => {
  if (!isRecord(value)) throw new Error("Core returned an invalid terminal session.");
  const sessionId = stringValue(value.sessionId);
  if (
    sessionId === undefined || typeof value.cursor !== "string"
    || typeof value.output !== "string" || typeof value.running !== "boolean"
    || (value.exitCode !== null && typeof value.exitCode !== "number")
    || typeof value.truncated !== "boolean"
  ) {
    throw new Error("Core returned an invalid terminal session.");
  }
  return {
    sessionId,
    cursor: value.cursor,
    output: value.output,
    running: value.running,
    exitCode: value.exitCode,
    truncated: value.truncated
  };
};

const copy = (locale: string) => {
  const zh = locale.toLowerCase().startsWith("zh");
  return zh ? {
    title: "终端", newSession: "新建会话", refresh: "刷新", close: "关闭",
    loading: "正在读取终端…", empty: "暂无终端会话", send: "发送",
    input: "输入命令", running: "运行中", exited: "已退出", retry: "重试",
    outputEmpty: "暂无输出", truncated: "仅显示最近一部分输出"
  } : {
    title: "Terminal", newSession: "New session", refresh: "Refresh", close: "Close",
    loading: "Loading terminal…", empty: "No terminal sessions", send: "Send",
    input: "Enter a command", running: "Running", exited: "Exited", retry: "Retry",
    outputEmpty: "No output yet", truncated: "Only a recent portion of output is shown"
  };
};

const buttonStyle: CSSProperties = {
  border: "1px solid var(--lyra-border-subtle, #d5d8de)",
  borderRadius: 6,
  color: "inherit",
  background: "var(--lyra-surface-secondary, #f6f7f9)",
  padding: "6px 10px",
  cursor: "pointer"
};

const TerminalSurface = ({
  host,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const labels = copy(presentation.locale);
  const restoredSessionId = isRecord(opaqueState)
    ? stringValue(opaqueState.selectedSessionId)
    : undefined;
  const [topology, setTopology] = useState<TerminalTopology | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    restoredSessionId ?? null
  );
  const [session, setSession] = useState<TerminalSessionRead | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshTopology = useCallback(async () => {
    try {
      const next = parseTerminalTopology(await host.executeCommand(COMMANDS.read, {}));
      setTopology(next);
      setSelectedSessionId((current) => {
        if (current !== null && next.panes.some((pane) => pane.sessionId === current)) {
          return current;
        }
        const activeTab = next.tabs.find((tab) => tab.id === next.activeTabId);
        return next.panes.find((pane) => pane.id === activeTab?.activePaneId)?.sessionId
          ?? next.panes[0]?.sessionId
          ?? null;
      });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [host]);

  const readSession = useCallback(async (sessionId: string) => {
    try {
      const next = parseTerminalSessionRead(await host.executeCommand(COMMANDS.readSession, {
        sessionId,
        maxBytes: 65_536
      }));
      setSession(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [host]);

  useEffect(() => { void refreshTopology(); }, [refreshTopology]);
  useEffect(() => {
    if (selectedSessionId === null) {
      setSession(null);
      updateOpaqueState({});
      return;
    }
    updateOpaqueState({ selectedSessionId });
    void readSession(selectedSessionId);
  }, [readSession, selectedSessionId, updateOpaqueState]);
  useEffect(() => {
    try {
      const subscription = host.subscribeEvent(TERMINAL_CHANGED_EVENT, async (event) => {
        await refreshTopology();
        if (
          selectedSessionId !== null
          && isRecord(event)
          && (event.sessionId === undefined || event.sessionId === selectedSessionId)
        ) {
          await readSession(selectedSessionId);
        }
      });
      return () => subscription.dispose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }, [host, readSession, refreshTopology, selectedSessionId]);
  useEffect(() => {
    if (selectedSessionId === null || session?.running !== true) return undefined;
    const timer = window.setInterval(() => void readSession(selectedSessionId), 1500);
    return () => window.clearInterval(timer);
  }, [readSession, selectedSessionId, session?.running]);

  const selectedPane = useMemo(
    () => topology?.panes.find((pane) => pane.sessionId === selectedSessionId) ?? null,
    [selectedSessionId, topology]
  );
  const selectPane = useCallback(async (pane: TerminalPane) => {
    setSelectedSessionId(pane.sessionId);
    await host.executeCommand(COMMANDS.focusPane, {
      tabId: pane.tabId,
      paneId: pane.id
    });
  }, [host]);
  const createSession = useCallback(async () => {
    const created = await host.executeCommand(COMMANDS.create, {});
    await refreshTopology();
    if (isRecord(created)) {
      const sessionId = stringValue(created.sessionId);
      if (sessionId !== undefined) setSelectedSessionId(sessionId);
    }
  }, [host, refreshTopology]);
  const closeSelected = useCallback(async () => {
    if (selectedPane === null) return;
    await host.executeCommand(COMMANDS.closePane, {
      tabId: selectedPane.tabId,
      paneId: selectedPane.id
    });
    setSelectedSessionId(null);
    await refreshTopology();
  }, [host, refreshTopology, selectedPane]);
  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedSessionId === null || input.length === 0) return;
    await host.executeCommand(COMMANDS.writeSession, {
      sessionId: selectedSessionId,
      text: input,
      appendNewline: true
    });
    setInput("");
    await readSession(selectedSessionId);
  }, [host, input, readSession, selectedSessionId]);

  return (
    <section data-lyra-component="lyra.terminal" aria-label="terminal-surface" style={{
      display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", width: "100%", height: "100%",
      color: "var(--lyra-text-primary, #e7e9ed)", background: "var(--lyra-terminal-bg, #111318)",
      fontFamily: "var(--lyra-font-sans, system-ui, sans-serif)"
    }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid #2c3038" }}>
        <strong>{labels.title}</strong><span style={{ flex: 1 }} />
        <button style={buttonStyle} onClick={() => void createSession()}>{labels.newSession}</button>
        <button style={buttonStyle} onClick={() => void refreshTopology()}>{labels.refresh}</button>
        <button style={buttonStyle} disabled={selectedPane === null} onClick={() => void closeSelected()}>{labels.close}</button>
      </header>
      {error !== null ? (
        <div role="alert" style={{ margin: "auto", textAlign: "center" }}>
          <p>{error}</p><button style={buttonStyle} onClick={() => void refreshTopology()}>{labels.retry}</button>
        </div>
      ) : topology === null ? (
        <p style={{ margin: "auto" }}>{labels.loading}</p>
      ) : topology.panes.length === 0 ? (
        <p style={{ margin: "auto", color: "#a6abb5" }}>{labels.empty}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(190px, 28%) minmax(0, 1fr)", minHeight: 0 }}>
          <nav aria-label={labels.title} style={{ overflow: "auto", borderRight: "1px solid #2c3038" }}>
            {topology.panes.map((pane) => (
              <button key={pane.id} onClick={() => void selectPane(pane)} style={{
                display: "block", width: "100%", padding: "11px 13px", textAlign: "left",
                border: 0, borderBottom: "1px solid #252932", color: "inherit", cursor: "pointer",
                background: pane.sessionId === selectedSessionId ? "#252b36" : "transparent"
              }}>
                <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{pane.title}</strong>
                <small style={{ display: "block", color: "#9ba1ad", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {pane.currentCwd ?? pane.cwd ?? pane.shell ?? pane.placement}
                </small>
              </button>
            ))}
          </nav>
          <div style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto", minWidth: 0, minHeight: 0 }}>
            <div style={{ padding: "7px 12px", color: "#aeb4bf", fontSize: 12, borderBottom: "1px solid #252932" }}>
              {selectedPane?.title ?? labels.title} · {session?.running === true
                ? labels.running
                : `${labels.exited}${session?.exitCode === null || session?.exitCode === undefined ? "" : ` (${session.exitCode})`}`}
            </div>
            <pre aria-label="terminal-output" style={{
              margin: 0, padding: 14, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
              font: "12px/1.55 var(--lyra-font-mono, ui-monospace, monospace)"
            }}>
              {session?.output.length ? session.output : labels.outputEmpty}
              {session?.truncated === true ? `\n\n[${labels.truncated}]` : ""}
            </pre>
            <form onSubmit={(event) => void submit(event)} style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #2c3038" }}>
              <input
                aria-label={labels.input}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={labels.input}
                disabled={selectedSessionId === null || session?.running === false}
                style={{ flex: 1, minWidth: 0, border: "1px solid #383e49", borderRadius: 6, padding: "7px 9px", color: "inherit", background: "#171a20" }}
              />
              <button style={buttonStyle} disabled={input.length === 0 || selectedSessionId === null}>{labels.send}</button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.terminal",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.terminal.refresh", title: "Refresh terminal sessions", requiredCapability: "terminal:read" },
      { id: "lyra.terminal.new-session", title: "Create terminal session", requiredCapability: "terminal:write" }
    ],
    status: [
      { id: "lyra.terminal.status", title: "Terminal runtime" }
    ]
  },
  commandHandlers: {
    "lyra.terminal.refresh": (host) => host.executeCommand(COMMANDS.read, {}),
    "lyra.terminal.new-session": (host, input) => host.executeCommand(COMMANDS.create, input)
  },
  surfaces: {
    terminal: {
      title: "Terminal",
      description: "Run and resume terminal sessions through Lyra Runtime.",
      component: TerminalSurface
    }
  }
});
export default lyraAppModule;
