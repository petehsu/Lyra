import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties
} from "react";

import {
  createFirstPartyAppModule,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

const COMMANDS = {
  read: "lyra.core.credentials.read",
  deleteCredential: "lyra.core.credentials.delete",
  revealCredential: "lyra.core.credentials.reveal",
  copyCredential: "lyra.core.credentials.copy",
  fillCredential: "lyra.core.credentials.fill",
  clearSite: "lyra.core.credentials.clear-site",
  navigate: "lyra.core.navigate",
  openSettings: "lyra.core.open-settings"
} as const;
const CREDENTIALS_CHANGED_EVENT = "lyra.core.credentials-changed";

type CredentialMode = "sessions" | "credentials";

export type CredentialSession = {
  readonly id: string;
  readonly origin: string;
  readonly hostname: string;
  readonly title?: string;
  readonly address?: string;
  readonly status: "observed" | "possible";
  readonly accountHint?: string;
  readonly authMethodLabel: string;
  readonly cookieCount: number;
  readonly storageObserved: boolean;
  readonly updatedAt: string;
};

export type StoredCredential = {
  readonly id: string;
  readonly origin: string;
  readonly hostname: string;
  readonly username: string;
  readonly authMethodLabel: string;
  readonly hasPassword: boolean;
  readonly passwordAvailable: boolean;
  readonly updatedAt: string;
  readonly lastUsedAt?: string;
};

export type CredentialsSnapshot = {
  readonly generatedAt: string;
  readonly passwordsAvailable: boolean;
  readonly passwordStorageReason?: string;
  readonly sessions: readonly CredentialSession[];
  readonly credentials: readonly StoredCredential[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

export const parseCredentialsSnapshot = (value: unknown): CredentialsSnapshot => {
  if (
    !isRecord(value) || !Array.isArray(value.sessions) || !Array.isArray(value.credentials)
    || typeof value.passwordsAvailable !== "boolean"
  ) {
    throw new Error("Core returned an invalid credential snapshot.");
  }
  const sessions = value.sessions.flatMap((entry): readonly CredentialSession[] => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const origin = stringValue(entry.origin);
    const hostname = stringValue(entry.hostname);
    const status = entry.status;
    const updatedAt = stringValue(entry.updatedAt);
    if (
      id === undefined || origin === undefined || hostname === undefined || updatedAt === undefined
      || (status !== "observed" && status !== "possible")
    ) return [];
    const authMethod = isRecord(entry.authMethod) ? entry.authMethod : {};
    const signals = isRecord(entry.signals) ? entry.signals : {};
    const title = stringValue(entry.title);
    const address = stringValue(entry.address);
    const accountHint = stringValue(entry.accountHint);
    return [{
      id, origin, hostname, status, updatedAt,
      authMethodLabel: stringValue(authMethod.label) ?? "Unknown",
      cookieCount: typeof signals.cookieCount === "number"
        ? Math.max(0, Math.floor(signals.cookieCount))
        : 0,
      storageObserved: signals.storageObserved === true,
      ...(title === undefined ? {} : { title }),
      ...(address === undefined ? {} : { address }),
      ...(accountHint === undefined ? {} : { accountHint })
    }];
  });
  const credentials = value.credentials.flatMap((entry): readonly StoredCredential[] => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const origin = stringValue(entry.origin);
    const hostname = stringValue(entry.hostname);
    const username = typeof entry.username === "string" ? entry.username : undefined;
    const updatedAt = stringValue(entry.updatedAt);
    if (
      id === undefined || origin === undefined || hostname === undefined
      || username === undefined || updatedAt === undefined
    ) return [];
    const authMethod = isRecord(entry.authMethod) ? entry.authMethod : {};
    const lastUsedAt = stringValue(entry.lastUsedAt);
    return [{
      id, origin, hostname, username, updatedAt,
      authMethodLabel: stringValue(authMethod.label) ?? "Password",
      hasPassword: entry.hasPassword === true,
      passwordAvailable: entry.passwordAvailable === true,
      ...(lastUsedAt === undefined ? {} : { lastUsedAt })
    }];
  });
  const passwordStorageReason = stringValue(value.passwordStorageReason);
  return {
    generatedAt: stringValue(value.generatedAt) ?? new Date(0).toISOString(),
    passwordsAvailable: value.passwordsAvailable,
    sessions,
    credentials,
    ...(passwordStorageReason === undefined ? {} : { passwordStorageReason })
  };
};

const text = (locale: string) => {
  const zh = locale.toLowerCase().startsWith("zh");
  return zh ? {
    title: "凭证", sessions: "登录会话", credentials: "已保存凭证", refresh: "刷新",
    settings: "设置", search: "搜索网站或账户", emptySessions: "暂无登录会话",
    emptyCredentials: "暂无已保存凭证", loading: "正在读取凭证…", retry: "重试",
    openSite: "打开网站", clearSite: "清除网站登录数据", reveal: "显示密码",
    hide: "隐藏密码", copy: "复制密码", copied: "已复制", fill: "填充", remove: "删除凭证",
    removeConfirm: "确定删除这个已保存凭证吗？", account: "账户", method: "方式",
    status: "状态", observed: "已观察", possible: "可能", cookies: "Cookie",
    storage: "站点存储", available: "可用", unavailable: "密码存储不可用",
    updated: "更新时间", yes: "是", no: "否"
  } : {
    title: "Credentials", sessions: "Sign-in sessions", credentials: "Saved credentials",
    refresh: "Refresh", settings: "Settings", search: "Search sites or accounts",
    emptySessions: "No sign-in sessions", emptyCredentials: "No saved credentials",
    loading: "Loading credentials…", retry: "Retry", openSite: "Open site",
    clearSite: "Clear site sign-in data", reveal: "Reveal password", hide: "Hide password",
    copy: "Copy password", copied: "Copied", fill: "Fill", remove: "Delete credential",
    removeConfirm: "Delete this saved credential?", account: "Account", method: "Method",
    status: "Status", observed: "Observed", possible: "Possible", cookies: "Cookies",
    storage: "Site storage", available: "Available", unavailable: "Password storage unavailable",
    updated: "Updated", yes: "Yes", no: "No"
  };
};

const buttonStyle: CSSProperties = {
  border: "1px solid var(--lyra-border-subtle, #d5d8de)", borderRadius: 6,
  color: "inherit", background: "var(--lyra-surface-secondary, #f6f7f9)",
  padding: "6px 10px", cursor: "pointer"
};
const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const CredentialsSurface = ({
  host,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const labels = text(presentation.locale);
  const restoredMode = isRecord(opaqueState) && opaqueState.mode === "credentials"
    ? "credentials"
    : "sessions";
  const restoredSelection = isRecord(opaqueState) ? stringValue(opaqueState.selectedKey) : undefined;
  const restoredQuery = isRecord(opaqueState) && typeof opaqueState.query === "string"
    ? opaqueState.query
    : "";
  const [snapshot, setSnapshot] = useState<CredentialsSnapshot | null>(null);
  const [mode, setMode] = useState<CredentialMode>(restoredMode);
  const [selectedKey, setSelectedKey] = useState<string | null>(restoredSelection ?? null);
  const [query, setQuery] = useState(restoredQuery);
  const [revealed, setRevealed] = useState<ReadonlyMap<string, string>>(() => new Map());
  const [copiedCredentialId, setCopiedCredentialId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = parseCredentialsSnapshot(await host.executeCommand(COMMANDS.read, {}));
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [host]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    updateOpaqueState({
      mode,
      query,
      ...(selectedKey === null ? {} : { selectedKey })
    });
  }, [mode, query, selectedKey, updateOpaqueState]);
  useEffect(() => {
    try {
      const subscription = host.subscribeEvent(CREDENTIALS_CHANGED_EVENT, async () => {
        setRevealed(new Map());
        setCopiedCredentialId(null);
        await refresh();
      });
      return () => subscription.dispose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return undefined;
    }
  }, [host, refresh]);
  useEffect(() => {
    // Do not retain a secret after the user leaves the selected credential.
    setRevealed(new Map());
    setCopiedCredentialId(null);
  }, [mode, selectedKey]);

  const filteredSessions = useMemo(() => {
    const needle = normalize(query);
    return (snapshot?.sessions ?? []).filter((session) =>
      needle.length === 0
      || normalize(`${session.hostname} ${session.accountHint ?? ""} ${session.authMethodLabel}`).includes(needle)
    );
  }, [query, snapshot]);
  const filteredCredentials = useMemo(() => {
    const needle = normalize(query);
    return (snapshot?.credentials ?? []).filter((credential) =>
      needle.length === 0
      || normalize(`${credential.hostname} ${credential.username} ${credential.authMethodLabel}`).includes(needle)
    );
  }, [query, snapshot]);
  useEffect(() => {
    if (mode === "sessions") {
      if (!filteredSessions.some((session) => `session:${session.id}` === selectedKey)) {
        setSelectedKey(filteredSessions[0] === undefined ? null : `session:${filteredSessions[0].id}`);
      }
      return;
    }
    if (!filteredCredentials.some((credential) => `credential:${credential.id}` === selectedKey)) {
      setSelectedKey(
        filteredCredentials[0] === undefined ? null : `credential:${filteredCredentials[0].id}`
      );
    }
  }, [filteredCredentials, filteredSessions, mode, selectedKey]);
  const selectedSession = useMemo(() => {
    if (mode !== "sessions") return null;
    return filteredSessions.find((session) => `session:${session.id}` === selectedKey)
      ?? filteredSessions[0]
      ?? null;
  }, [filteredSessions, mode, selectedKey]);
  const selectedCredential = useMemo(() => {
    if (mode !== "credentials") return null;
    return filteredCredentials.find((credential) => `credential:${credential.id}` === selectedKey)
      ?? filteredCredentials[0]
      ?? null;
  }, [filteredCredentials, mode, selectedKey]);

  const run = useCallback(async (
    key: string,
    command: string,
    input: Record<string, string>
  ) => {
    setBusy(key);
    try {
      await host.executeCommand(command, input);
      await refresh();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [host, refresh]);
  const reveal = useCallback(async (credential: StoredCredential) => {
    const existing = revealed.get(credential.id);
    if (existing !== undefined) {
      setRevealed((current) => {
        const next = new Map(current);
        next.delete(credential.id);
        return next;
      });
      return;
    }
    setBusy(`credential:${credential.id}`);
    try {
      const result = await host.executeCommand(COMMANDS.revealCredential, {
        credentialId: credential.id,
        reason: "user-reveal"
      });
      if (!isRecord(result) || typeof result.password !== "string") {
        throw new Error("Core returned an invalid revealed credential.");
      }
      setRevealed((current) => new Map(current).set(credential.id, result.password as string));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [host, revealed]);
  const copyPassword = useCallback(async (credential: StoredCredential) => {
    setBusy(`credential:${credential.id}`);
    try {
      await host.executeCommand(COMMANDS.copyCredential, {
        credentialId: credential.id,
        reason: "user-copy"
      });
      setCopiedCredentialId(credential.id);
      window.setTimeout(() => {
        setCopiedCredentialId((current) => current === credential.id ? null : current);
      }, 1_200);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [host]);
  const removeCredential = useCallback(async (credential: StoredCredential) => {
    if (!window.confirm(labels.removeConfirm)) return;
    await run(
      `credential:${credential.id}`,
      COMMANDS.deleteCredential,
      { credentialId: credential.id }
    );
    setRevealed((current) => {
      const next = new Map(current);
      next.delete(credential.id);
      return next;
    });
  }, [labels.removeConfirm, run]);

  const list = mode === "sessions" ? filteredSessions : filteredCredentials;

  return (
    <section data-lyra-component="lyra.credentials" aria-label="credentials-surface" style={{
      display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)", width: "100%", height: "100%",
      color: "var(--lyra-text-primary, #202124)", background: "var(--lyra-surface-primary, #fff)",
      fontFamily: "var(--lyra-font-sans, system-ui, sans-serif)"
    }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--lyra-border-subtle, #ddd)" }}>
        <strong>{labels.title}</strong>
        <button style={buttonStyle} aria-pressed={mode === "sessions"} onClick={() => setMode("sessions")}>{labels.sessions}</button>
        <button style={buttonStyle} aria-pressed={mode === "credentials"} onClick={() => setMode("credentials")}>{labels.credentials}</button>
        <span style={{ flex: 1 }} />
        <button style={buttonStyle} onClick={() => void refresh()}>{labels.refresh}</button>
        <button style={buttonStyle} onClick={() => void host.executeCommand(COMMANDS.openSettings, {})}>{labels.settings}</button>
      </header>
      <div style={{ display: "flex", gap: 10, alignItems: "center", padding: 10, borderBottom: "1px solid var(--lyra-border-subtle, #ddd)" }}>
        <input
          aria-label={labels.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.search}
          style={{ flex: 1, minWidth: 0, border: "1px solid var(--lyra-border-subtle, #ccc)", borderRadius: 6, padding: "7px 9px", color: "inherit", background: "inherit" }}
        />
        {snapshot?.passwordsAvailable === false
          ? <small role="status" style={{ color: "var(--lyra-text-secondary, #666)" }}>{snapshot.passwordStorageReason ?? labels.unavailable}</small>
          : null}
      </div>
      {error !== null ? (
        <div role="alert" style={{ margin: "auto", textAlign: "center" }}>
          <p>{error}</p><button style={buttonStyle} onClick={() => void refresh()}>{labels.retry}</button>
        </div>
      ) : snapshot === null ? (
        <p style={{ margin: "auto" }}>{labels.loading}</p>
      ) : list.length === 0 ? (
        <p style={{ margin: "auto", color: "var(--lyra-text-secondary, #666)" }}>
          {mode === "sessions" ? labels.emptySessions : labels.emptyCredentials}
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 36%) minmax(0, 1fr)", minHeight: 0 }}>
          <nav aria-label={mode === "sessions" ? labels.sessions : labels.credentials} style={{ overflow: "auto", borderRight: "1px solid var(--lyra-border-subtle, #ddd)" }}>
            {mode === "sessions"
              ? filteredSessions.map((session) => (
                  <button key={session.id} onClick={() => setSelectedKey(`session:${session.id}`)} style={{
                    display: "block", width: "100%", padding: "11px 13px", textAlign: "left", border: 0,
                    borderBottom: "1px solid var(--lyra-border-subtle, #eee)", color: "inherit", cursor: "pointer",
                    background: selectedSession?.id === session.id ? "var(--lyra-surface-selected, #e8eef8)" : "transparent"
                  }}>
                    <strong style={{ display: "block" }}>{session.hostname}</strong>
                    <small style={{ color: "var(--lyra-text-secondary, #666)" }}>{session.accountHint ?? session.authMethodLabel}</small>
                  </button>
                ))
              : filteredCredentials.map((credential) => (
                  <button key={credential.id} onClick={() => setSelectedKey(`credential:${credential.id}`)} style={{
                    display: "block", width: "100%", padding: "11px 13px", textAlign: "left", border: 0,
                    borderBottom: "1px solid var(--lyra-border-subtle, #eee)", color: "inherit", cursor: "pointer",
                    background: selectedCredential?.id === credential.id ? "var(--lyra-surface-selected, #e8eef8)" : "transparent"
                  }}>
                    <strong style={{ display: "block" }}>{credential.hostname}</strong>
                    <small style={{ color: "var(--lyra-text-secondary, #666)" }}>{credential.username || credential.authMethodLabel}</small>
                  </button>
                ))}
          </nav>
          {selectedSession !== null ? (
            <article style={{ overflow: "auto", padding: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{selectedSession.title ?? selectedSession.hostname}</h2>
              <p style={{ color: "var(--lyra-text-secondary, #666)" }}>{selectedSession.origin}</p>
              <dl style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "8px 12px" }}>
                <dt>{labels.account}</dt><dd style={{ margin: 0 }}>{selectedSession.accountHint ?? "—"}</dd>
                <dt>{labels.method}</dt><dd style={{ margin: 0 }}>{selectedSession.authMethodLabel}</dd>
                <dt>{labels.status}</dt><dd style={{ margin: 0 }}>{selectedSession.status === "observed" ? labels.observed : labels.possible}</dd>
                <dt>{labels.cookies}</dt><dd style={{ margin: 0 }}>{selectedSession.cookieCount}</dd>
                <dt>{labels.storage}</dt><dd style={{ margin: 0 }}>{selectedSession.storageObserved ? labels.yes : labels.no}</dd>
                <dt>{labels.updated}</dt><dd style={{ margin: 0 }}>{new Date(selectedSession.updatedAt).toLocaleString()}</dd>
              </dl>
              <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                <button style={buttonStyle} onClick={() => void host.executeCommand(COMMANDS.navigate, {
                  address: selectedSession.address ?? selectedSession.origin,
                  title: selectedSession.title ?? selectedSession.hostname
                })}>{labels.openSite}</button>
                <button
                  style={buttonStyle}
                  disabled={busy === `session:${selectedSession.id}`}
                  onClick={() => void run(`session:${selectedSession.id}`, COMMANDS.clearSite, { sessionId: selectedSession.id })}
                >{labels.clearSite}</button>
              </div>
            </article>
          ) : selectedCredential !== null ? (
            <article style={{ overflow: "auto", padding: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18 }}>{selectedCredential.hostname}</h2>
              <p style={{ color: "var(--lyra-text-secondary, #666)" }}>{selectedCredential.origin}</p>
              <dl style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "8px 12px" }}>
                <dt>{labels.account}</dt><dd style={{ margin: 0 }}>{selectedCredential.username || "—"}</dd>
                <dt>{labels.method}</dt><dd style={{ margin: 0 }}>{selectedCredential.authMethodLabel}</dd>
                <dt>{labels.status}</dt><dd style={{ margin: 0 }}>{selectedCredential.passwordAvailable ? labels.available : labels.unavailable}</dd>
                <dt>{labels.updated}</dt><dd style={{ margin: 0 }}>{new Date(selectedCredential.updatedAt).toLocaleString()}</dd>
              </dl>
              {revealed.has(selectedCredential.id)
                ? <code aria-label="revealed-password" style={{ display: "block", marginTop: 16, padding: 10, borderRadius: 6, background: "var(--lyra-surface-secondary, #f6f7f9)", wordBreak: "break-all" }}>{revealed.get(selectedCredential.id)}</code>
                : null}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
                <button
                  style={buttonStyle}
                  disabled={!selectedCredential.passwordAvailable || busy === `credential:${selectedCredential.id}`}
                  onClick={() => void reveal(selectedCredential)}
                >{revealed.has(selectedCredential.id) ? labels.hide : labels.reveal}</button>
                <button
                  style={buttonStyle}
                  disabled={!selectedCredential.passwordAvailable || busy === `credential:${selectedCredential.id}`}
                  onClick={() => void copyPassword(selectedCredential)}
                >{copiedCredentialId === selectedCredential.id ? labels.copied : labels.copy}</button>
                <button
                  style={buttonStyle}
                  disabled={busy === `credential:${selectedCredential.id}`}
                  onClick={() => void run(`credential:${selectedCredential.id}`, COMMANDS.fillCredential, {
                    credentialId: selectedCredential.id,
                    reason: "user-fill"
                  })}
                >{labels.fill}</button>
                <button style={buttonStyle} onClick={() => void removeCredential(selectedCredential)}>{labels.remove}</button>
              </div>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.credentials",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.credentials.refresh", title: "Refresh credential manager", requiredCapability: "credentials:read" },
      { id: "lyra.credentials.open-settings", title: "Open credential settings", requiredCapability: "settings:open" }
    ],
    settings: [
      { id: "lyra.credentials.settings", title: "Credentials", route: "/credentials" }
    ],
    status: [
      { id: "lyra.credentials.status", title: "Credential manager" }
    ]
  },
  commandHandlers: {
    "lyra.credentials.refresh": (host) => host.executeCommand(COMMANDS.read, {}),
    "lyra.credentials.open-settings": (host) => host.executeCommand(COMMANDS.openSettings, {})
  },
  surfaces: {
    "login-manager": {
      title: "Credentials",
      description: "Review locally encrypted captured sign-in data.",
      component: CredentialsSurface
    }
  }
});
export default lyraAppModule;
