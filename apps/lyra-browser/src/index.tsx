import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent
} from "react";

import {
  createFirstPartyAppModule,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

const COMMANDS = {
  read: "lyra.core.browser.read",
  navigate: "lyra.core.browser.navigate",
  activateTab: "lyra.core.browser.activate-tab",
  openTab: "lyra.core.browser.open-tab",
  closeTab: "lyra.core.browser.close-tab",
  goBack: "lyra.core.browser.go-back",
  goForward: "lyra.core.browser.go-forward",
  reload: "lyra.core.browser.reload"
} as const;

const BROWSER_CHANGED_EVENT = "lyra.core.browser-changed";

type BrowserTabSummary = {
  readonly id: string;
  readonly title: string;
  readonly kind: "search" | "results" | "page";
  readonly address: string;
  readonly faviconUrl?: string;
  readonly active: boolean;
};

type BrowserPageSummary = {
  readonly tabId: string;
  readonly address: string;
  readonly title: string;
  readonly faviconUrl?: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly lifecycleState: string;
};

type BrowserProfileSummary = {
  readonly profileId: string;
  readonly profileMode: "live" | "isolated";
  readonly profilePartition: string;
  readonly persistence: "chromium-profile";
  readonly cookies: {
    readonly availability: "available" | "unavailable" | "unknown";
    readonly count?: number;
  };
};

type BrowserHistorySummary = {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly faviconUrl?: string;
  readonly visitedAt: string;
  readonly visitCount: number;
};

export type BrowserModuleSnapshot = {
  readonly instanceId: string;
  readonly tabId: string;
  readonly activeTabId: string;
  readonly runtimeAvailable: boolean;
  readonly tabs: readonly BrowserTabSummary[];
  readonly page: BrowserPageSummary | null;
  readonly profiles: readonly BrowserProfileSummary[];
  readonly history: readonly BrowserHistorySummary[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Core returned an invalid browser field: ${field}`);
  }
  return value;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value : undefined;

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const parseTab = (value: unknown): BrowserTabSummary | null => {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  if (kind !== "search" && kind !== "results" && kind !== "page") return null;
  try {
    const faviconUrl = optionalString(value.faviconUrl);
    return {
      id: requiredString(value.id, "tabs[].id"),
      title: requiredString(value.title, "tabs[].title"),
      kind,
      address: typeof value.address === "string" ? value.address : "",
      ...(faviconUrl === undefined ? {} : { faviconUrl }),
      active: value.active === true
    };
  } catch {
    return null;
  }
};

const parsePage = (value: unknown): BrowserPageSummary | null => {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error("Core returned an invalid browser page.");
  const faviconUrl = optionalString(value.faviconUrl);
  return {
    tabId: requiredString(value.tabId, "page.tabId"),
    address: requiredString(value.address, "page.address"),
    title: requiredString(value.title, "page.title"),
    ...(faviconUrl === undefined ? {} : { faviconUrl }),
    canGoBack: value.canGoBack === true,
    canGoForward: value.canGoForward === true,
    lifecycleState: optionalString(value.lifecycleState) ?? "visible"
  };
};

const parseProfile = (value: unknown): BrowserProfileSummary | null => {
  if (!isRecord(value) || !isRecord(value.cookies)) return null;
  const profileMode = value.profileMode;
  const availability = value.cookies.availability;
  if (
    (profileMode !== "live" && profileMode !== "isolated")
    || (availability !== "available"
      && availability !== "unavailable"
      && availability !== "unknown")
  ) {
    return null;
  }
  try {
    const count = typeof value.cookies.count === "number" && Number.isFinite(value.cookies.count)
      ? Math.max(0, Math.floor(value.cookies.count))
      : undefined;
    return {
      profileId: requiredString(value.profileId, "profiles[].profileId"),
      profileMode,
      profilePartition: requiredString(value.profilePartition, "profiles[].profilePartition"),
      persistence: "chromium-profile",
      cookies: {
        availability,
        ...(count === undefined ? {} : { count })
      }
    };
  } catch {
    return null;
  }
};

const parseHistory = (value: unknown): BrowserHistorySummary | null => {
  if (!isRecord(value)) return null;
  try {
    const faviconUrl = optionalString(value.faviconUrl);
    return {
      id: requiredString(value.id, "history[].id"),
      url: requiredString(value.url, "history[].url"),
      title: requiredString(value.title, "history[].title"),
      ...(faviconUrl === undefined ? {} : { faviconUrl }),
      visitedAt: requiredString(value.visitedAt, "history[].visitedAt"),
      visitCount: Math.max(1, Math.floor(finiteNumber(value.visitCount, 1)))
    };
  } catch {
    return null;
  }
};

export const parseBrowserModuleSnapshot = (value: unknown): BrowserModuleSnapshot => {
  if (
    !isRecord(value)
    || !Array.isArray(value.tabs)
    || !Array.isArray(value.profiles)
    || !Array.isArray(value.history)
  ) {
    throw new Error("Core returned an invalid browser snapshot.");
  }
  return {
    instanceId: requiredString(value.instanceId, "instanceId"),
    tabId: requiredString(value.tabId, "tabId"),
    activeTabId: requiredString(value.activeTabId, "activeTabId"),
    runtimeAvailable: value.runtimeAvailable === true,
    tabs: value.tabs.map(parseTab).filter((entry): entry is BrowserTabSummary => entry !== null),
    page: parsePage(value.page),
    profiles: value.profiles
      .map(parseProfile)
      .filter((entry): entry is BrowserProfileSummary => entry !== null),
    history: value.history
      .map(parseHistory)
      .filter((entry): entry is BrowserHistorySummary => entry !== null)
  };
};

const labels = (locale: string) => {
  const chinese = locale.toLowerCase().startsWith("zh");
  return chinese ? {
    title: "浏览器",
    address: "输入网址或搜索内容",
    back: "后退",
    forward: "前进",
    reload: "刷新",
    newTab: "新建标签",
    closeTab: "关闭标签",
    navigate: "前往",
    history: "历史记录",
    noHistory: "暂无浏览历史",
    profiles: "配置文件",
    unavailable: "浏览器运行时不可用",
    loading: "正在读取浏览器状态…",
    retry: "重试",
    corePage: "页面内容由 Lyra Core 的隔离 WebContents 托管。",
    visits: "次访问"
  } : {
    title: "Browser",
    address: "Enter an address or search",
    back: "Back",
    forward: "Forward",
    reload: "Reload",
    newTab: "New tab",
    closeTab: "Close tab",
    navigate: "Go",
    history: "History",
    noHistory: "No browser history",
    profiles: "Profiles",
    unavailable: "Browser runtime unavailable",
    loading: "Reading browser state…",
    retry: "Retry",
    corePage: "Page content is hosted by Lyra Core in its managed WebContents.",
    visits: "visits"
  };
};

const buttonStyle: CSSProperties = {
  border: "1px solid var(--lyra-border-subtle, #d5d8de)",
  borderRadius: 6,
  color: "inherit",
  background: "var(--lyra-surface-secondary, #f6f7f9)",
  padding: "6px 9px",
  cursor: "pointer"
};

const BrowserSurface = ({
  host,
  instanceId,
  route,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const copy = labels(presentation.locale);
  const restoredInput = isRecord(opaqueState) && typeof opaqueState.input === "string"
    ? opaqueState.input
    : route !== "/" ? route : "";
  const [snapshot, setSnapshot] = useState<BrowserModuleSnapshot | null>(null);
  const [input, setInput] = useState(restoredInput);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editingInput = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const next = parseBrowserModuleSnapshot(
        await host.executeCommand(COMMANDS.read, { instanceId })
      );
      setSnapshot(next);
      if (!editingInput.current) {
        const currentTab = next.tabs.find((tab) => tab.id === next.tabId);
        setInput(next.page?.address ?? currentTab?.address ?? "");
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [host, instanceId]);

  useEffect(() => {
    void refresh();
    try {
      const subscription = host.subscribeEvent(BROWSER_CHANGED_EVENT, async () => refresh());
      return () => subscription.dispose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }, [host, refresh]);

  useEffect(() => {
    updateOpaqueState({
      input,
      tabId: snapshot?.tabId ?? null,
      activeTabId: snapshot?.activeTabId ?? null
    });
  }, [input, snapshot?.activeTabId, snapshot?.tabId, updateOpaqueState]);

  const run = useCallback(async (
    command: string,
    values: Record<string, string | boolean> = {}
  ) => {
    setBusy(true);
    try {
      await host.executeCommand(command, { instanceId, ...values });
      await refresh();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [host, instanceId, refresh]);

  const submit = useCallback((event: FormEvent) => {
    event.preventDefault();
    const next = input.trim();
    if (next.length === 0) return;
    editingInput.current = false;
    void run(COMMANDS.navigate, { input: next });
  }, [input, run]);

  const activePage = snapshot?.page;
  const profiles = useMemo(
    () => snapshot?.profiles.map((profile) => {
      const count = profile.cookies.count;
      return `${profile.profileMode} · ${profile.profileId}`
        + (count === undefined ? "" : ` · ${count} cookies`);
    }) ?? [],
    [snapshot?.profiles]
  );

  return (
    <section
      data-lyra-component="lyra.browser"
      aria-label="browser-surface"
      style={{
        display: "grid",
        gridTemplateRows: "auto auto minmax(0, 1fr)",
        width: "100%",
        height: "100%",
        color: "var(--lyra-text-primary, #202124)",
        background: "var(--lyra-surface-primary, #fff)",
        fontFamily: "var(--lyra-font-sans, system-ui, sans-serif)"
      }}
    >
      <header style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 10px",
        borderBottom: "1px solid var(--lyra-border-subtle, #ddd)"
      }}>
        <strong style={{ marginRight: 4 }}>{copy.title}</strong>
        <button
          style={buttonStyle}
          disabled={busy || activePage?.canGoBack !== true}
          aria-label={copy.back}
          onClick={() => void run(COMMANDS.goBack)}
        >←</button>
        <button
          style={buttonStyle}
          disabled={busy || activePage?.canGoForward !== true}
          aria-label={copy.forward}
          onClick={() => void run(COMMANDS.goForward)}
        >→</button>
        <button
          style={buttonStyle}
          disabled={busy || snapshot?.runtimeAvailable !== true}
          aria-label={copy.reload}
          onClick={() => void run(COMMANDS.reload)}
        >↻</button>
        <form onSubmit={submit} style={{ display: "flex", flex: 1, minWidth: 120 }}>
          <input
            aria-label={copy.address}
            value={input}
            onFocus={() => { editingInput.current = true; }}
            onBlur={() => { editingInput.current = false; }}
            onChange={(event) => setInput(event.currentTarget.value)}
            placeholder={copy.address}
            style={{
              flex: 1,
              minWidth: 0,
              padding: "7px 10px",
              border: "1px solid var(--lyra-border-subtle, #d5d8de)",
              borderRadius: "7px 0 0 7px",
              color: "inherit",
              background: "var(--lyra-surface-primary, #fff)"
            }}
          />
          <button style={{ ...buttonStyle, borderRadius: "0 7px 7px 0" }} disabled={busy}>
            {copy.navigate}
          </button>
        </form>
        <button style={buttonStyle} disabled={busy} onClick={() => void run(COMMANDS.openTab)}>
          {copy.newTab}
        </button>
        <button style={buttonStyle} disabled={busy} onClick={() => void run(COMMANDS.closeTab)}>
          {copy.closeTab}
        </button>
      </header>

      <nav
        aria-label="browser-tabs"
        style={{
          display: "flex",
          gap: 4,
          padding: "6px 10px",
          overflowX: "auto",
          borderBottom: "1px solid var(--lyra-border-subtle, #ddd)"
        }}
      >
        {snapshot?.tabs.map((tab) => (
          <button
            key={tab.id}
            style={{
              ...buttonStyle,
              maxWidth: 220,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              background: tab.id === snapshot.activeTabId
                ? "var(--lyra-surface-selected, #e8eef8)"
                : buttonStyle.background
            }}
            title={tab.address || tab.title}
            onClick={() => void run(COMMANDS.activateTab, { tabId: tab.id })}
          >
            {tab.title}
          </button>
        ))}
      </nav>

      {error !== null ? (
        <div role="alert" style={{ margin: "auto", textAlign: "center", padding: 20 }}>
          <p>{error}</p>
          <button style={buttonStyle} onClick={() => void refresh()}>{copy.retry}</button>
        </div>
      ) : snapshot === null ? (
        <p style={{ margin: "auto" }}>{copy.loading}</p>
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(240px, 32%)",
          minHeight: 0
        }}>
          <main style={{ display: "grid", placeItems: "center", minWidth: 0, padding: 24 }}>
            <div style={{ maxWidth: 620, textAlign: "center" }}>
              <h1 style={{ margin: 0, fontSize: 20 }}>{activePage?.title ?? copy.title}</h1>
              <p style={{
                margin: "8px 0",
                color: "var(--lyra-text-secondary, #666)",
                overflowWrap: "anywhere"
              }}>
                {activePage?.address ?? input}
              </p>
              <p style={{ color: "var(--lyra-text-secondary, #666)" }}>
                {snapshot.runtimeAvailable ? copy.corePage : copy.unavailable}
              </p>
              <h2 style={{ marginTop: 24, fontSize: 14 }}>{copy.profiles}</h2>
              {profiles.map((profile) => (
                <div key={profile} style={{ marginTop: 5, fontSize: 12 }}>{profile}</div>
              ))}
            </div>
          </main>
          <aside style={{
            minWidth: 0,
            overflow: "auto",
            borderLeft: "1px solid var(--lyra-border-subtle, #ddd)",
            padding: 12
          }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 14 }}>{copy.history}</h2>
            {snapshot.history.length === 0 ? (
              <p style={{ color: "var(--lyra-text-secondary, #666)" }}>{copy.noHistory}</p>
            ) : snapshot.history.slice(0, 50).map((entry) => (
              <button
                key={entry.id}
                onClick={() => {
                  setInput(entry.url);
                  editingInput.current = false;
                  void run(COMMANDS.navigate, { input: entry.url });
                }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "8px 4px",
                  border: 0,
                  borderBottom: "1px solid var(--lyra-border-subtle, #eee)",
                  textAlign: "left",
                  color: "inherit",
                  background: "transparent",
                  cursor: "pointer"
                }}
              >
                <span style={{
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}>{entry.title}</span>
                <small style={{ color: "var(--lyra-text-secondary, #666)" }}>
                  {entry.visitCount} {copy.visits}
                </small>
              </button>
            ))}
          </aside>
        </div>
      )}
    </section>
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.browser",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.browser.new-tab", title: "Open browser tab" },
      { id: "lyra.browser.reload", title: "Reload browser tab" }
    ],
    status: [
      { id: "lyra.browser.status", title: "Browser" }
    ]
  },
  commandHandlers: {
    "lyra.browser.new-tab": (host, input) =>
      host.executeCommand(COMMANDS.openTab, input),
    "lyra.browser.reload": (host, input) =>
      host.executeCommand(COMMANDS.reload, input)
  },
  surfaces: {
    browser: {
      title: "Browser",
      description: "Lyra browser tabs, profiles, history, and automation.",
      component: BrowserSurface
    }
  }
});

export default lyraAppModule;
