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
  read: "lyra.core.credentials.read",
  deleteCredential: "lyra.core.credentials.delete",
  revealCredential: "lyra.core.credentials.reveal",
  copyCredential: "lyra.core.credentials.copy",
  fillCredential: "lyra.core.credentials.fill",
  clearSite: "lyra.core.credentials.clear-site",
  updateSession: "lyra.core.credentials.update-session",
  setCaptureEnabled: "lyra.core.credentials.set-capture-enabled",
  navigate: "lyra.core.navigate",
  openSettings: "lyra.core.open-settings"
} as const;
const CREDENTIALS_CHANGED_EVENT = "lyra.core.credentials-changed";

type CredentialMode = "sessions" | "review" | "credentials";

export type CredentialSession = {
  readonly id: string;
  readonly origin: string;
  readonly hostname: string;
  readonly faviconUrl?: string;
  readonly title?: string;
  readonly address?: string;
  readonly status: "observed" | "possible";
  readonly accountHint?: string;
  readonly notes?: string;
  readonly authMethodLabel: string;
  readonly authMethodKind: string;
  readonly authMethodSource: string;
  readonly cookieCount: number;
  readonly storageObserved: boolean;
  readonly lastSeenAt?: string;
  readonly updatedAt: string;
};

export type StoredCredential = {
  readonly id: string;
  readonly origin: string;
  readonly hostname: string;
  readonly faviconUrl?: string;
  readonly username: string;
  readonly usernameLabel?: string;
  readonly authMethodLabel: string;
  readonly hasPassword: boolean;
  readonly passwordAvailable: boolean;
  readonly updatedAt: string;
  readonly lastUsedAt?: string;
};

export type CredentialsSnapshot = {
  readonly generatedAt: string;
  readonly passwordsAvailable: boolean;
  readonly credentialCaptureEnabled: boolean;
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
    const notes = stringValue(entry.notes);
    const faviconUrl = stringValue(entry.faviconUrl);
    const lastSeenAt = stringValue(entry.lastSeenAt);
    return [{
      id, origin, hostname, status, updatedAt,
      authMethodLabel: stringValue(authMethod.label) ?? "Unknown",
      authMethodKind: stringValue(authMethod.kind) ?? "unknown",
      authMethodSource: stringValue(authMethod.source) ?? "unknown",
      cookieCount: typeof signals.cookieCount === "number"
        ? Math.max(0, Math.floor(signals.cookieCount))
        : 0,
      storageObserved: signals.storageObserved === true,
      ...(title === undefined ? {} : { title }),
      ...(address === undefined ? {} : { address }),
      ...(accountHint === undefined ? {} : { accountHint }),
      ...(notes === undefined ? {} : { notes }),
      ...(faviconUrl === undefined ? {} : { faviconUrl }),
      ...(lastSeenAt === undefined ? {} : { lastSeenAt })
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
    const faviconUrl = stringValue(entry.faviconUrl);
    const usernameLabel = stringValue(entry.usernameLabel);
    return [{
      id, origin, hostname, username, updatedAt,
      authMethodLabel: stringValue(authMethod.label) ?? "Password",
      hasPassword: entry.hasPassword === true,
      passwordAvailable: entry.passwordAvailable === true,
      ...(lastUsedAt === undefined ? {} : { lastUsedAt }),
      ...(faviconUrl === undefined ? {} : { faviconUrl }),
      ...(usernameLabel === undefined ? {} : { usernameLabel })
    }];
  });
  const passwordStorageReason = stringValue(value.passwordStorageReason);
  return {
    generatedAt: stringValue(value.generatedAt) ?? new Date(0).toISOString(),
    passwordsAvailable: value.passwordsAvailable,
    credentialCaptureEnabled: value.credentialCaptureEnabled === true,
    sessions,
    credentials,
    ...(passwordStorageReason === undefined ? {} : { passwordStorageReason })
  };
};

const text = (locale: string) => {
  const zh = locale.toLowerCase().startsWith("zh");
  return zh ? {
    title: "凭证", sessions: "登录会话", review: "待复核", credentials: "已保存凭证",
    refresh: "刷新", settings: "设置", search: "搜索网站或账户",
    emptySessions: "暂无登录会话", emptyReview: "暂无待复核会话", emptyCredentials: "暂无已保存凭证",
    loading: "正在读取凭证…", retry: "重试",
    openSite: "打开网站", clearSite: "清除网站登录数据", reveal: "显示密码",
    hide: "隐藏密码", copy: "复制密码", copied: "已复制", fill: "填充", remove: "删除凭证",
    removeConfirm: "确定删除这个已保存凭证吗？", account: "账户", method: "方式",
    status: "状态", observed: "已观察", possible: "可能", cookies: "Cookie",
    storage: "站点存储", available: "可用", unavailable: "密码存储不可用",
    updated: "更新时间", lastUsed: "上次使用", lastSeen: "最近活动", yes: "是", no: "否",
    captureOn: "关闭捕获", captureOff: "启用捕获",
    captureEnabled: "凭证捕获已开启", captureDisabled: "凭证捕获已关闭",
    captureDisclosure: "开启后，浏览器登录时自动捕获凭证并本地加密存储。",
    edit: "编辑", save: "保存", cancel: "取消", notes: "备注",
    authMethod: "认证方式", source: "来源",
    sourceObserved: "已观察", sourceInferred: "推断", sourceManual: "手动", sourceUnknown: "未知"
  } : {
    title: "Credentials", sessions: "Sign-in sessions", review: "Needs review", credentials: "Saved credentials",
    refresh: "Refresh", settings: "Settings", search: "Search sites or accounts",
    emptySessions: "No sign-in sessions", emptyReview: "No sessions need review", emptyCredentials: "No saved credentials",
    loading: "Loading credentials…", retry: "Retry",
    openSite: "Open site", clearSite: "Clear site sign-in data", reveal: "Reveal password",
    hide: "Hide password", copy: "Copy password", copied: "Copied", fill: "Fill", remove: "Delete credential",
    removeConfirm: "Delete this saved credential?", account: "Account", method: "Method",
    status: "Status", observed: "Observed", possible: "Possible", cookies: "Cookies",
    storage: "Site storage", available: "Available", unavailable: "Password storage unavailable",
    updated: "Updated", lastUsed: "Last used", lastSeen: "Last seen", yes: "Yes", no: "No",
    captureOn: "Disable capture", captureOff: "Enable capture",
    captureEnabled: "Credential capture is enabled", captureDisabled: "Credential capture is disabled",
    captureDisclosure: "When enabled, sign-in credentials are automatically captured and locally encrypted.",
    edit: "Edit", save: "Save", cancel: "Cancel", notes: "Notes",
    authMethod: "Authentication method", source: "Source",
    sourceObserved: "Observed", sourceInferred: "Inferred", sourceManual: "Manual", sourceUnknown: "Unknown"
  };
};

const buttonStyle: CSSProperties = {
  border: "1px solid var(--lyra-border-subtle, #d5d8de)", borderRadius: 6,
  color: "inherit", background: "var(--lyra-surface-secondary, #f6f7f9)",
  padding: "6px 10px", cursor: "pointer"
};
const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const AUTH_METHODS = [
  "site_session", "password", "passkey", "oauth", "sso", "magic_link", "unknown"
] as const;

const Favicon = ({ url, fallback, size = 15 }: {
  readonly url: string | undefined;
  readonly fallback: string;
  readonly size?: number;
}) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  if (url !== undefined && url.trim().length > 0 && !failed) {
    return (
      <img
        src={url}
        alt=""
        aria-hidden="true"
        style={{ width: size, height: size, borderRadius: 2, objectFit: "contain" }}
        onError={() => setFailed(true)}
      />
    );
  }
  return <span aria-hidden="true" style={{ width: size, height: size, display: "inline-block", textAlign: "center", fontSize: size - 2 }}>◎</span>;
};

const formatTime = (value?: string): string => {
  if (value === undefined || value.trim().length === 0) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const sourceLabel = (source: string, labels: ReturnType<typeof text>): string => {
  if (source === "observed") return labels.sourceObserved;
  if (source === "inferred") return labels.sourceInferred;
  if (source === "manual") return labels.sourceManual;
  return labels.sourceUnknown;
};

const CredentialsSurface = ({
  host,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const labels = text(presentation.locale);
  const restoredMode = isRecord(opaqueState) && opaqueState.mode === "credentials"
    ? "credentials"
    : isRecord(opaqueState) && opaqueState.mode === "review"
      ? "review"
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
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [accountDraft, setAccountDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [authMethodDraft, setAuthMethodDraft] = useState<string>("unknown");

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
    setRevealed(new Map());
    setCopiedCredentialId(null);
  }, [mode, selectedKey]);

  const reviewSessions = useMemo(
    () => (snapshot?.sessions ?? []).filter((s) => s.authMethodSource !== "manual"),
    [snapshot]
  );
  const filteredSessions = useMemo(() => {
    const needle = normalize(query);
    return (snapshot?.sessions ?? []).filter((session) =>
      needle.length === 0
      || normalize(`${session.hostname} ${session.accountHint ?? ""} ${session.authMethodLabel}`).includes(needle)
    );
  }, [query, snapshot]);
  const filteredReview = useMemo(() => {
    const needle = normalize(query);
    return reviewSessions.filter((session) =>
      needle.length === 0
      || normalize(`${session.hostname} ${session.accountHint ?? ""} ${session.authMethodLabel}`).includes(needle)
    );
  }, [query, reviewSessions]);
  const filteredCredentials = useMemo(() => {
    const needle = normalize(query);
    return (snapshot?.credentials ?? []).filter((credential) =>
      needle.length === 0
      || normalize(`${credential.hostname} ${credential.username} ${credential.authMethodLabel}`).includes(needle)
    );
  }, [query, snapshot]);

  const activeList = mode === "sessions" ? filteredSessions : mode === "review" ? filteredReview : filteredCredentials;

  useEffect(() => {
    if (mode === "sessions") {
      if (!filteredSessions.some((session) => `session:${session.id}` === selectedKey)) {
        setSelectedKey(filteredSessions[0] === undefined ? null : `session:${filteredSessions[0].id}`);
      }
      return;
    }
    if (mode === "review") {
      if (!filteredReview.some((session) => `session:${session.id}` === selectedKey)) {
        setSelectedKey(filteredReview[0] === undefined ? null : `session:${filteredReview[0].id}`);
      }
      return;
    }
    if (!filteredCredentials.some((credential) => `credential:${credential.id}` === selectedKey)) {
      setSelectedKey(
        filteredCredentials[0] === undefined ? null : `credential:${filteredCredentials[0].id}`
      );
    }
  }, [filteredCredentials, filteredReview, filteredSessions, mode, selectedKey]);

  const selectedSession = useMemo(() => {
    if (mode === "credentials") return null;
    const pool = mode === "review" ? filteredReview : filteredSessions;
    return pool.find((session) => `session:${session.id}` === selectedKey)
      ?? pool[0]
      ?? null;
  }, [filteredReview, filteredSessions, mode, selectedKey]);
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

  const toggleCapture = useCallback(async () => {
    if (snapshot === null) return;
    setBusy("capture-toggle");
    try {
      await host.executeCommand(COMMANDS.setCaptureEnabled, {
        enabled: !snapshot.credentialCaptureEnabled
      });
      await refresh();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [host, refresh, snapshot]);

  const beginEdit = useCallback((session: CredentialSession) => {
    setEditingSessionId(session.id);
    setAccountDraft(session.accountHint ?? "");
    setNotesDraft(session.notes ?? "");
    setAuthMethodDraft(session.authMethodKind);
  }, []);

  const saveEdit = useCallback(async (session: CredentialSession) => {
    setBusy(`session:${session.id}`);
    try {
      await host.executeCommand(COMMANDS.updateSession, {
        sessionId: session.id,
        accountHint: accountDraft,
        notes: notesDraft,
        authMethodKind: authMethodDraft
      });
      await refresh();
      setEditingSessionId(null);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }, [accountDraft, authMethodDraft, host, notesDraft, refresh]);

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

  const onEditSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedSession !== null) {
      void saveEdit(selectedSession);
    }
  }, [saveEdit, selectedSession]);

  const renderListItem = (key: string, title: string, subtitle: string, faviconUrl: string | undefined, meta: string) => (
    <button
      key={key}
      onClick={() => setSelectedKey(key)}
      style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "11px 13px",
        textAlign: "left", border: 0, borderBottom: "1px solid var(--lyra-border-subtle, #eee)",
        color: "inherit", cursor: "pointer",
        background: selectedKey === key ? "var(--lyra-surface-selected, #e8eef8)" : "transparent"
      }}
    >
      <Favicon url={faviconUrl} fallback={title} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</strong>
        <small style={{ display: "block", color: "var(--lyra-text-secondary, #666)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</small>
      </span>
      <small style={{ color: "var(--lyra-text-secondary, #999)", fontSize: 11, whiteSpace: "nowrap" }}>{meta}</small>
    </button>
  );

  return (
    <section data-lyra-component="lyra.credentials" aria-label="credentials-surface" style={{
      display: "grid", gridTemplateRows: "auto auto auto minmax(0, 1fr)", width: "100%", height: "100%",
      color: "var(--lyra-text-primary, #202124)", background: "var(--lyra-surface-primary, #fff)",
      fontFamily: "var(--lyra-font-sans, system-ui, sans-serif)"
    }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid var(--lyra-border-subtle, #ddd)" }}>
        <strong>{labels.title}</strong>
        <button style={buttonStyle} aria-pressed={mode === "sessions"} onClick={() => setMode("sessions")}>{labels.sessions}</button>
        <button style={buttonStyle} aria-pressed={mode === "review"} onClick={() => setMode("review")}>{labels.review}</button>
        <button style={buttonStyle} aria-pressed={mode === "credentials"} onClick={() => setMode("credentials")}>{labels.credentials}</button>
        <span style={{ flex: 1 }} />
        <button
          style={buttonStyle}
          disabled={snapshot === null || busy === "capture-toggle"}
          onClick={() => void toggleCapture()}
        >
          {snapshot?.credentialCaptureEnabled === true ? labels.captureOn : labels.captureOff}
        </button>
        <button style={buttonStyle} onClick={() => void refresh()}>{labels.refresh}</button>
        <button style={buttonStyle} onClick={() => void host.executeCommand(COMMANDS.openSettings, {})}>{labels.settings}</button>
      </header>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
        borderBottom: "1px solid var(--lyra-border-subtle, #ddd)",
        background: snapshot?.credentialCaptureEnabled === true
          ? "var(--lyra-surface-warning-subtle, #fff8e1)"
          : "var(--lyra-surface-secondary, #f6f7f9)",
        fontSize: 12, color: "var(--lyra-text-secondary, #666)"
      }}>
        <strong>{snapshot?.credentialCaptureEnabled === true ? labels.captureEnabled : labels.captureDisabled}</strong>
        <span>{labels.captureDisclosure}</span>
      </div>
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
      ) : activeList.length === 0 ? (
        <p style={{ margin: "auto", color: "var(--lyra-text-secondary, #666)" }}>
          {mode === "sessions" ? labels.emptySessions : mode === "review" ? labels.emptyReview : labels.emptyCredentials}
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 36%) minmax(0, 1fr)", minHeight: 0 }}>
          <nav aria-label={mode === "credentials" ? labels.credentials : mode === "review" ? labels.review : labels.sessions} style={{ overflow: "auto", borderRight: "1px solid var(--lyra-border-subtle, #ddd)" }}>
            {mode === "credentials"
              ? filteredCredentials.map((credential) =>
                  renderListItem(
                    `credential:${credential.id}`,
                    credential.hostname,
                    credential.username || credential.authMethodLabel,
                    credential.faviconUrl,
                    formatTime(credential.updatedAt)
                  )
                )
              : (mode === "review" ? filteredReview : filteredSessions).map((session) =>
                  renderListItem(
                    `session:${session.id}`,
                    session.hostname,
                    session.accountHint ?? session.authMethodLabel,
                    session.faviconUrl,
                    formatTime(session.lastSeenAt)
                  )
                )}
          </nav>
          {selectedSession !== null ? (
            <article style={{ overflow: "auto", padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <Favicon url={selectedSession.faviconUrl} fallback={selectedSession.hostname} size={20} />
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>{selectedSession.title ?? selectedSession.hostname}</h2>
                  <p style={{ margin: 0, color: "var(--lyra-text-secondary, #666)" }}>{selectedSession.origin}</p>
                </div>
              </div>
              {editingSessionId === selectedSession.id ? (
                <form onSubmit={onEditSubmit} style={{ display: "grid", gap: 10, marginTop: 18 }}>
                  <label>
                    <span style={{ fontSize: 12, color: "var(--lyra-text-secondary, #666)" }}>{labels.account}</span>
                    <input
                      aria-label={labels.account}
                      value={accountDraft}
                      onChange={(e) => setAccountDraft(e.target.value)}
                      style={{ display: "block", width: "100%", marginTop: 4, ...buttonStyle, cursor: "text" }}
                    />
                  </label>
                  <label>
                    <span style={{ fontSize: 12, color: "var(--lyra-text-secondary, #666)" }}>{labels.authMethod}</span>
                    <select
                      aria-label={labels.authMethod}
                      value={authMethodDraft}
                      onChange={(e) => setAuthMethodDraft(e.target.value)}
                      style={{ display: "block", width: "100%", marginTop: 4, ...buttonStyle }}
                    >
                      {AUTH_METHODS.map((kind) => (
                        <option key={kind} value={kind}>{kind}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span style={{ fontSize: 12, color: "var(--lyra-text-secondary, #666)" }}>{labels.notes}</span>
                    <textarea
                      aria-label={labels.notes}
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      rows={3}
                      style={{ display: "block", width: "100%", marginTop: 4, ...buttonStyle, cursor: "text", resize: "vertical" }}
                    />
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="submit" style={buttonStyle} disabled={busy === `session:${selectedSession.id}`}>
                      {labels.save}
                    </button>
                    <button type="button" style={buttonStyle} onClick={() => setEditingSessionId(null)}>
                      {labels.cancel}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
                    <button style={buttonStyle} onClick={() => void host.executeCommand(COMMANDS.navigate, {
                      address: selectedSession.address ?? selectedSession.origin,
                      title: selectedSession.title ?? selectedSession.hostname
                    })}>{labels.openSite}</button>
                    <button
                      style={buttonStyle}
                      disabled={busy === `session:${selectedSession.id}`}
                      onClick={() => void run(`session:${selectedSession.id}`, COMMANDS.clearSite, { sessionId: selectedSession.id })}
                    >{labels.clearSite}</button>
                    <button style={buttonStyle} onClick={() => beginEdit(selectedSession)}>{labels.edit}</button>
                  </div>
                  <dl style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "8px 12px", marginTop: 18 }}>
                    <dt>{labels.account}</dt><dd style={{ margin: 0 }}>{selectedSession.accountHint ?? "—"}</dd>
                    <dt>{labels.method}</dt><dd style={{ margin: 0 }}>{selectedSession.authMethodLabel}</dd>
                    <dt>{labels.source}</dt><dd style={{ margin: 0 }}>{sourceLabel(selectedSession.authMethodSource, labels)}</dd>
                    <dt>{labels.status}</dt><dd style={{ margin: 0 }}>{selectedSession.status === "observed" ? labels.observed : labels.possible}</dd>
                    <dt>{labels.cookies}</dt><dd style={{ margin: 0 }}>{selectedSession.cookieCount}</dd>
                    <dt>{labels.storage}</dt><dd style={{ margin: 0 }}>{selectedSession.storageObserved ? labels.yes : labels.no}</dd>
                    <dt>{labels.lastSeen}</dt><dd style={{ margin: 0 }}>{formatTime(selectedSession.lastSeenAt)}</dd>
                    <dt>{labels.updated}</dt><dd style={{ margin: 0 }}>{formatTime(selectedSession.updatedAt)}</dd>
                  </dl>
                  {selectedSession.notes !== undefined && selectedSession.notes.length > 0 ? (
                    <div style={{ marginTop: 16 }}>
                      <strong style={{ fontSize: 12, color: "var(--lyra-text-secondary, #666)" }}>{labels.notes}</strong>
                      <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{selectedSession.notes}</p>
                    </div>
                  ) : null}
                </>
              )}
            </article>
          ) : selectedCredential !== null ? (
            <article style={{ overflow: "auto", padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <Favicon url={selectedCredential.faviconUrl} fallback={selectedCredential.hostname} size={20} />
                <div>
                  <h2 style={{ margin: 0, fontSize: 18 }}>{selectedCredential.hostname}</h2>
                  <p style={{ margin: 0, color: "var(--lyra-text-secondary, #666)" }}>{selectedCredential.username}</p>
                </div>
              </div>
              <dl style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: "8px 12px", marginTop: 18 }}>
                <dt>{labels.account}</dt><dd style={{ margin: 0 }}>{selectedCredential.username || "—"}</dd>
                <dt>{labels.method}</dt><dd style={{ margin: 0 }}>{selectedCredential.authMethodLabel}</dd>
                <dt>{labels.status}</dt><dd style={{ margin: 0 }}>{selectedCredential.passwordAvailable ? labels.available : labels.unavailable}</dd>
                <dt>{labels.updated}</dt><dd style={{ margin: 0 }}>{formatTime(selectedCredential.updatedAt)}</dd>
                <dt>{labels.lastUsed}</dt><dd style={{ margin: 0 }}>{formatTime(selectedCredential.lastUsedAt)}</dd>
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