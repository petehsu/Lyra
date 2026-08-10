import {
  AppBadge,
  AppButton,
  AppEmptyState,
  AppIconButton,
  AppInput,
  AppObjectRow,
  AppSearchField,
  AppSelect,
  AppStatusMessage,
  AppTabs,
  AppTextarea,
  reportWorkbenchError,
  type AppBadgeTone,
  type AppSelectOption,
  type AppTabOption
} from "@renderer/ui/components";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import {
  Building2,
  Check,
  Copy,
  Cookie,
  Database,
  ExternalLink,
  Eye,
  FileText,
  Fingerprint,
  Globe,
  HelpCircle,
  KeyRound,
  Link2,
  Mail,
  Shield,
  LogOut,
  Pencil,
  RefreshCw,
  Save,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Clock3,
  Trash2,
  X
} from "lucide-react";

import type {
  LoginManagerAuthMethodKind,
  LoginManagerCredential,
  LoginManagerFactSource,
  LoginManagerSession,
  LoginManagerSnapshot
} from "../../../shared/desktop-bridge";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import { formatMediumDateTime, t } from "@workbench/i18n";
import type { LoginManagerSurfaceProps } from "./types";

type TabMode = "sessions" | "credentials" | "review";

type SelectedItem =
  | {
      readonly kind: "session";
      readonly value: LoginManagerSession;
    }
  | {
      readonly kind: "credential";
      readonly value: LoginManagerCredential;
    };

const AUTH_METHOD_ORDER: readonly LoginManagerAuthMethodKind[] = [
  "site_session",
  "password",
  "passkey",
  "oauth",
  "sso",
  "magic_link",
  "unknown"
];

const methodIcon = (
  kind: LoginManagerAuthMethodKind,
  size = 15
): ReactNode => {
  if (kind === "password") return <KeyRound size={size} />;
  if (kind === "passkey") return <Fingerprint size={size} />;
  if (kind === "oauth") return <Link2 size={size} />;
  if (kind === "sso") return <Building2 size={size} />;
  if (kind === "magic_link") return <Mail size={size} />;
  if (kind === "site_session") return <Globe size={size} />;
  return <HelpCircle size={size} />;
};

const ModeIcon = ({
  mode
}: {
  readonly mode: TabMode;
}) => {
  if (mode === "credentials") return <KeyRound size={13} />;
  if (mode === "review") return <ShieldAlert size={13} />;
  return <ShieldCheck size={13} />;
};

const FactIcon = ({
  kind
}: {
  readonly kind:
    | "account"
    | "method"
    | "notes"
    | "cookies"
    | "storage"
    | "updated"
    | "password"
    | "lastUsed";
}) => {
  if (kind === "account") return <UserRound size={13} />;
  if (kind === "method") return <Shield size={13} />;
  if (kind === "notes") return <FileText size={13} />;
  if (kind === "cookies") return <Cookie size={13} />;
  if (kind === "storage") return <Database size={13} />;
  if (kind === "password") return <KeyRound size={13} />;
  if (kind === "lastUsed" || kind === "updated") return <Clock3 size={13} />;
  return <HelpCircle size={13} />;
};

const SiteIcon = ({
  faviconUrl,
  fallback,
  size = 15
}: {
  readonly faviconUrl: string | undefined;
  readonly fallback: ReactNode;
  readonly size?: number;
}) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [faviconUrl]);

  if (faviconUrl !== undefined && faviconUrl.trim().length > 0 && !failed) {
    return (
      <img
        src={faviconUrl}
        alt=""
        aria-hidden="true"
        className="lyra-login-manager-site-favicon"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }

  return <>{fallback}</>;
};

const normalize = (value: string): string => value.trim().toLocaleLowerCase();

const formatTime = (value?: string): string => {
  if (value === undefined || value.trim().length === 0) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return formatMediumDateTime(date.getTime());
};

const sourceLabel = (
  source: LoginManagerFactSource,
  labels: LoginManagerSurfaceProps["labels"]
): string => {
  if (source === "observed") return labels.sourceObserved;
  if (source === "inferred") return labels.sourceInferred;
  if (source === "manual") return labels.sourceManual;
  return labels.sourceUnknown;
};

const sessionSearchText = (session: LoginManagerSession): string =>
  normalize([
    session.hostname,
    session.origin,
    session.title,
    session.address,
    session.accountHint,
    session.authMethod.label,
    session.authMethod.providerDomain,
    session.notes
  ].filter(Boolean).join(" "));

const credentialSearchText = (credential: LoginManagerCredential): string =>
  normalize([
    credential.hostname,
    credential.origin,
    credential.username,
    credential.usernameLabel,
    credential.authMethod.label,
    credential.authMethod.providerDomain
  ].filter(Boolean).join(" "));

const StatusBadge = ({
  session,
  labels
}: {
  readonly session: LoginManagerSession;
  readonly labels: LoginManagerSurfaceProps["labels"];
}) => (
  <AppBadge tone={session.status === "observed" ? "success" : "neutral"}>
    {session.status === "observed"
      ? <ShieldCheck size={11} aria-hidden="true" />
      : <ShieldAlert size={11} aria-hidden="true" />}
    {session.status === "observed" ? labels.statusObserved : labels.statusPossible}
  </AppBadge>
);

const sourceBadgeTone = (source: LoginManagerFactSource): AppBadgeTone => {
  if (source === "manual") return "success";
  if (source === "unknown") return "warning";
  return "neutral";
};

const SourceBadge = ({
  source,
  labels
}: {
  readonly source: LoginManagerFactSource;
  readonly labels: LoginManagerSurfaceProps["labels"];
}) => (
  <AppBadge tone={sourceBadgeTone(source)}>
    {source === "manual"
      ? <Pencil size={11} aria-hidden="true" />
      : source === "unknown"
        ? <HelpCircle size={11} aria-hidden="true" />
        : <Shield size={11} aria-hidden="true" />}
    {sourceLabel(source, labels)}
  </AppBadge>
);

const EmptyState = ({
  title
}: {
  readonly title: string;
}) => (
  <AppEmptyState className="lyra-login-manager-empty" title={title} />
);

export const LoginManagerSurface = ({
  desktopApi,
  labels,
  onOpenSite,
  embedded = false
}: LoginManagerSurfaceProps) => {
  const [snapshot, setSnapshot] = useState<LoginManagerSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<TabMode>("sessions");
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [accountDraft, setAccountDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [authMethodDraft, setAuthMethodDraft] = useState<LoginManagerAuthMethodKind>("unknown");
  const [revealedPasswords, setRevealedPasswords] = useState<ReadonlyMap<string, string>>(
    () => new Map()
  );
  const [copiedCredentialId, setCopiedCredentialId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (desktopApi?.loginManager === undefined) {
      setError(labels.bridgeUnavailable);
      setSnapshot(null);
      return;
    }
    setLoading(true);
    try {
      setSnapshot(await desktopApi.loginManager.list());
      setError(null);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [desktopApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (desktopApi?.loginManager === undefined) {
      return undefined;
    }
    return desktopApi.loginManager.onEvent((event) => {
      setSnapshot(event.snapshot);
      setError(null);
    });
  }, [desktopApi]);

  const sessions = snapshot?.sessions ?? [];
  const credentials = snapshot?.credentials ?? [];
  const filteredSessions = useMemo(() => {
    const text = normalize(query);
    const candidates = mode === "review"
      ? sessions.filter((session) => session.authMethodSource !== "manual")
      : sessions;
    if (text.length === 0) {
      return candidates;
    }
    return candidates.filter((session) => sessionSearchText(session).includes(text));
  }, [mode, query, sessions]);
  const filteredCredentials = useMemo(() => {
    const text = normalize(query);
    if (text.length === 0) {
      return credentials;
    }
    return credentials.filter((credential) => credentialSearchText(credential).includes(text));
  }, [credentials, query]);
  const selectedItem = useMemo<SelectedItem | null>(() => {
    if (selectedKey !== null) {
      const selectedSession = sessions.find((session) => `session:${session.id}` === selectedKey);
      if (selectedSession !== undefined) {
        return { kind: "session", value: selectedSession };
      }
      const selectedCredential = credentials.find((credential) => `credential:${credential.id}` === selectedKey);
      if (selectedCredential !== undefined) {
        return { kind: "credential", value: selectedCredential };
      }
    }
    if (mode === "credentials") {
      const credential = filteredCredentials[0];
      return credential === undefined ? null : { kind: "credential", value: credential };
    }
    const session = filteredSessions[0];
    return session === undefined ? null : { kind: "session", value: session };
  }, [
    credentials,
    filteredCredentials,
    filteredSessions,
    mode,
    selectedKey,
    sessions
  ]);

  const titlebarContribution = useMemo(() => ({
    ariaLabel: labels.title,
    content: (
      <>
        <span className="lyra-titlebar-context-chip">
          {snapshot === null ? "0" : String(sessions.length)}
        </span>
        <span className="lyra-titlebar-context-chip">
          {snapshot === null ? "0" : String(credentials.length)}
        </span>
      </>
    )
  }), [
    credentials.length,
    labels.title,
    sessions.length,
    snapshot
  ]);
  useWorkbenchTitlebarContribution(embedded ? null : titlebarContribution);

  const tabOptions = useMemo<readonly AppTabOption<TabMode>[]>(() => [
    { value: "sessions", label: labels.sessionsTab, icon: <ModeIcon mode="sessions" /> },
    { value: "credentials", label: labels.credentialsTab, icon: <ModeIcon mode="credentials" /> },
    { value: "review", label: labels.reviewTab, icon: <ModeIcon mode="review" /> }
  ], [labels.credentialsTab, labels.reviewTab, labels.sessionsTab]);

  const authMethodOptions = useMemo<readonly AppSelectOption<LoginManagerAuthMethodKind>[]>(
    () => AUTH_METHOD_ORDER.map((kind) => ({
      value: kind,
      label: labels.methodLabels[kind]
    })),
    [labels.methodLabels]
  );

  const beginEdit = useCallback((session: LoginManagerSession): void => {
    setEditingSessionId(session.id);
    setAccountDraft(session.accountHint ?? "");
    setNotesDraft(session.notes ?? "");
    setAuthMethodDraft(session.authMethod.kind);
  }, []);

  const saveEdit = useCallback(async (session: LoginManagerSession): Promise<void> => {
    if (desktopApi?.loginManager === undefined) {
      return;
    }
    setBusyKey(`session:${session.id}`);
    try {
      const authLabel = labels.methodLabels[authMethodDraft] ?? labels.methodLabels.unknown;
      setSnapshot(await desktopApi.loginManager.updateSession({
        sessionId: session.id,
        accountHint: accountDraft.trim().length === 0 ? null : accountDraft,
        notes: notesDraft.trim().length === 0 ? null : notesDraft,
        authMethod: {
          kind: authMethodDraft,
          label: authLabel,
          source: "manual",
          confidence: 1
        }
      }));
      setEditingSessionId(null);
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusyKey(null);
    }
  }, [
    accountDraft,
    authMethodDraft,
    desktopApi,
    labels.methodLabels,
    notesDraft
  ]);

  const clearSite = useCallback(async (session: LoginManagerSession): Promise<void> => {
    if (desktopApi?.loginManager === undefined) {
      return;
    }
    setBusyKey(`session:${session.id}`);
    try {
      await desktopApi.loginManager.clearSite({ sessionId: session.id });
      await desktopApi.workbenchBrowser?.clearSiteData?.({ origin: session.origin }).catch((error: unknown) => {
        reportWorkbenchError(error, t("appStatus.clearSiteDataFailed"));
      });
      await refresh();
    } catch (clearError: unknown) {
      setError(clearError instanceof Error ? clearError.message : String(clearError));
    } finally {
      setBusyKey(null);
    }
  }, [desktopApi, refresh]);

  const deleteCredential = useCallback(async (credential: LoginManagerCredential): Promise<void> => {
    if (desktopApi?.loginManager === undefined) {
      return;
    }
    setBusyKey(`credential:${credential.id}`);
    try {
      setSnapshot(await desktopApi.loginManager.deleteCredential({
        credentialId: credential.id
      }));
      setRevealedPasswords((current) => {
        const next = new Map(current);
        next.delete(credential.id);
        return next;
      });
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setBusyKey(null);
    }
  }, [desktopApi]);

  const revealCredential = useCallback(async (credential: LoginManagerCredential): Promise<void> => {
    if (desktopApi?.loginManager === undefined) {
      return;
    }
    setBusyKey(`credential:${credential.id}`);
    try {
      const revealed = await desktopApi.loginManager.revealCredential({
        credentialId: credential.id,
        reason: "user-reveal"
      });
      setRevealedPasswords((current) => {
        const next = new Map(current);
        next.set(credential.id, revealed.password);
        return next;
      });
    } catch (revealError: unknown) {
      setError(revealError instanceof Error ? revealError.message : String(revealError));
    } finally {
      setBusyKey(null);
    }
  }, [desktopApi]);

  const copyCredential = useCallback(async (credential: LoginManagerCredential): Promise<void> => {
    const existing = revealedPasswords.get(credential.id);
    const password = existing
      ?? (await desktopApi?.loginManager?.revealCredential({
        credentialId: credential.id,
        reason: "user-copy"
      }).then((result) => result.password).catch(() => null));
    if (typeof password !== "string") {
      return;
    }
    await navigator.clipboard.writeText(password);
    setCopiedCredentialId(credential.id);
    window.setTimeout(() => setCopiedCredentialId(null), 1200);
  }, [desktopApi, revealedPasswords]);

  const fillCredential = useCallback(async (credential: LoginManagerCredential): Promise<void> => {
    if (desktopApi?.loginManager === undefined) {
      return;
    }
    setBusyKey(`credential:${credential.id}`);
    try {
      await desktopApi.loginManager.fillCredential({
        credentialId: credential.id,
        reason: "user-fill"
      });
    } catch (fillError: unknown) {
      setError(fillError instanceof Error ? fillError.message : String(fillError));
    } finally {
      setBusyKey(null);
    }
  }, [desktopApi]);

  const setCredentialCaptureEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    if (desktopApi?.loginManager === undefined) {
      return;
    }
    setBusyKey("credential-capture");
    try {
      setSnapshot(await desktopApi.loginManager.setCredentialCaptureEnabled(enabled));
      setError(null);
    } catch (captureError: unknown) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setBusyKey(null);
    }
  }, [desktopApi]);

  const onEditSubmit = useCallback((event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (selectedItem?.kind === "session") {
      void saveEdit(selectedItem.value);
    }
  }, [saveEdit, selectedItem]);

  const selectedSession =
    selectedItem?.kind === "session" ? selectedItem.value : null;
  const selectedCredential =
    selectedItem?.kind === "credential" ? selectedItem.value : null;

  const renderSessionActions = (session: LoginManagerSession): ReactNode => (
    <>
      <AppIconButton
        className="lyra-login-manager-row-action"
        aria-label={labels.openSite}
        title={labels.openSite}
        onClick={() => onOpenSite(session.address ?? session.origin, session.title ?? session.hostname)}
      >
        <ExternalLink size={14} aria-hidden="true" />
      </AppIconButton>
      <AppIconButton
        className="lyra-login-manager-row-action"
        aria-label={labels.logoutSite}
        title={labels.logoutSite}
        tone="danger"
        disabled={busyKey === `session:${session.id}`}
        onClick={() => void clearSite(session)}
      >
        <LogOut size={14} aria-hidden="true" />
      </AppIconButton>
    </>
  );

  const renderCredentialActions = (credential: LoginManagerCredential): ReactNode => (
    <>
      <AppIconButton
        className="lyra-login-manager-row-action"
        aria-label={labels.openSite}
        title={labels.openSite}
        onClick={() => onOpenSite(credential.origin, credential.hostname)}
      >
        <ExternalLink size={14} aria-hidden="true" />
      </AppIconButton>
      <AppIconButton
        className="lyra-login-manager-row-action"
        aria-label={labels.fill}
        title={labels.fill}
        disabled={!credential.passwordAvailable || busyKey === `credential:${credential.id}`}
        onClick={() => void fillCredential(credential)}
      >
        <Check size={14} aria-hidden="true" />
      </AppIconButton>
      <AppIconButton
        className="lyra-login-manager-row-action"
        aria-label={labels.copy}
        title={labels.copy}
        disabled={!credential.passwordAvailable}
        onClick={() => void copyCredential(credential)}
      >
        <Copy size={14} aria-hidden="true" />
      </AppIconButton>
      <AppIconButton
        className="lyra-login-manager-row-action"
        aria-label={labels.deleteCredential}
        title={labels.deleteCredential}
        tone="danger"
        disabled={busyKey === `credential:${credential.id}`}
        onClick={() => void deleteCredential(credential)}
      >
        <Trash2 size={14} aria-hidden="true" />
      </AppIconButton>
    </>
  );

  if (embedded) {
    return (
      <section className="lyra-login-manager lyra-login-manager-embedded">
        {error === null ? null : (
          <AppStatusMessage
            className="lyra-login-manager-error"
            tone="error"
            icon={<ShieldAlert size={14} aria-hidden="true" />}
          >
            {error}
          </AppStatusMessage>
        )}
        <div className="lyra-login-manager-embedded-toolbar">
          <AppSearchField
            className="lyra-login-manager-search"
            ariaLabel={labels.searchPlaceholder}
            placeholder={labels.searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <AppTabs
            className="lyra-login-manager-tabs"
            ariaLabel={labels.title}
            value={mode}
            options={tabOptions}
            onValueChange={(tab) => {
              setMode(tab);
              setSelectedKey(null);
            }}
          />
          <AppIconButton
            className="lyra-login-manager-refresh"
            aria-label={labels.refresh}
            title={labels.refresh}
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </AppIconButton>
        </div>
        <div className="lyra-login-manager-embedded-list">
          {mode === "credentials" ? (
            filteredCredentials.length === 0 ? (
              <EmptyState
                title={labels.emptyCredentialsTitle}
              />
            ) : filteredCredentials.map((credential) => (
              <AppObjectRow
                key={credential.id}
                as="div"
                className="lyra-login-manager-row lyra-login-manager-embedded-row"
                icon={(
                  <SiteIcon
                    faviconUrl={credential.faviconUrl}
                    fallback={methodIcon(credential.authMethod.kind)}
                  />
                )}
                title={credential.hostname}
                description={credential.username}
                meta={formatTime(credential.updatedAt)}
                actions={renderCredentialActions(credential)}
              />
            ))
          ) : filteredSessions.length === 0 ? (
            <EmptyState
              title={labels.emptySessionsTitle}
            />
          ) : filteredSessions.map((session) => (
            <AppObjectRow
              key={session.id}
              as="div"
              className="lyra-login-manager-row lyra-login-manager-embedded-row"
              icon={(
                <SiteIcon
                  faviconUrl={session.faviconUrl}
                  fallback={methodIcon(session.authMethod.kind)}
                />
              )}
              title={session.hostname}
              description={session.accountHint ?? session.authMethod.label}
              meta={formatTime(session.lastSeenAt)}
              actions={renderSessionActions(session)}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="lyra-login-manager">
      <header className="lyra-login-manager-header">
        <div className="lyra-login-manager-heading">
          <span className="lyra-login-manager-heading-icon" aria-hidden="true">
            <KeyRound size={18} />
          </span>
          <div>
            <h2>{labels.title}</h2>
            <p>
              {snapshot?.passwordsAvailable === false
                ? labels.passwordsUnavailable
                : `${sessions.length} ${labels.sessionsTab} · ${credentials.length} ${labels.credentialsTab}`}
            </p>
          </div>
        </div>
        <div className="lyra-login-manager-header-actions">
          <AppButton
            type="button"
            variant={snapshot?.credentialCaptureEnabled === true ? "secondary" : "default"}
            size="sm"
            title={labels.credentialCaptureDisclosure}
            disabled={snapshot === null || busyKey === "credential-capture"}
            onClick={() => void setCredentialCaptureEnabled(snapshot?.credentialCaptureEnabled !== true)}
          >
            {snapshot?.credentialCaptureEnabled === true
              ? labels.disableCredentialCapture
              : labels.enableCredentialCapture}
          </AppButton>
          <AppIconButton
            aria-label={labels.refresh}
            title={labels.refresh}
            disabled={loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </AppIconButton>
        </div>
      </header>

      <AppStatusMessage
        className="lyra-login-manager-capture-status"
        tone={snapshot?.credentialCaptureEnabled === true ? "warning" : "neutral"}
        icon={<Shield size={14} aria-hidden="true" />}
      >
        <strong>
          {snapshot?.credentialCaptureEnabled === true
            ? labels.credentialCaptureEnabled
            : labels.credentialCaptureDisabled}
        </strong>{" "}
        {labels.credentialCaptureDisclosure}
      </AppStatusMessage>

      {error === null ? null : (
        <AppStatusMessage
          className="lyra-login-manager-error"
          tone="error"
          icon={<ShieldAlert size={14} aria-hidden="true" />}
        >
          {error}
        </AppStatusMessage>
      )}

      <div className="lyra-login-manager-body">
        <aside className="lyra-login-manager-sidebar">
          <AppSearchField
            className="lyra-login-manager-search"
            ariaLabel={labels.searchPlaceholder}
            placeholder={labels.searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <AppTabs
            className="lyra-login-manager-tabs"
            ariaLabel={labels.title}
            value={mode}
            options={tabOptions}
            onValueChange={(tab) => {
              setMode(tab);
              setSelectedKey(null);
            }}
          />
          <div className="lyra-login-manager-list">
            {mode === "credentials" ? (
              filteredCredentials.length === 0 ? (
                <EmptyState
                  title={labels.emptyCredentialsTitle}
                />
              ) : filteredCredentials.map((credential) => (
                <AppObjectRow
                  key={credential.id}
                  className="lyra-login-manager-row"
                  active={selectedCredential?.id === credential.id}
                  icon={(
                    <SiteIcon
                      faviconUrl={credential.faviconUrl}
                      fallback={methodIcon(credential.authMethod.kind)}
                    />
                  )}
                  title={credential.hostname}
                  description={credential.username}
                  meta={formatTime(credential.updatedAt)}
                  onClick={() => setSelectedKey(`credential:${credential.id}`)}
                />
              ))
            ) : filteredSessions.length === 0 ? (
              <EmptyState
                title={labels.emptySessionsTitle}
              />
            ) : filteredSessions.map((session) => (
              <AppObjectRow
                key={session.id}
                className="lyra-login-manager-row"
                active={selectedSession?.id === session.id}
                icon={(
                  <SiteIcon
                    faviconUrl={session.faviconUrl}
                    fallback={methodIcon(session.authMethod.kind)}
                  />
                )}
                title={session.hostname}
                description={session.accountHint ?? session.authMethod.label}
                meta={formatTime(session.lastSeenAt)}
                onClick={() => setSelectedKey(`session:${session.id}`)}
              />
            ))}
          </div>
        </aside>

        <section className="lyra-login-manager-detail">
          {selectedItem === null ? (
            <EmptyState
              title={mode === "credentials" ? labels.emptyCredentialsTitle : labels.emptySessionsTitle}
            />
          ) : selectedItem.kind === "session" ? (
            <article className="lyra-login-manager-detail-panel">
              <div className="lyra-login-manager-detail-head">
                <span className="lyra-login-manager-detail-icon">
                  <SiteIcon
                    faviconUrl={selectedItem.value.faviconUrl}
                    fallback={methodIcon(selectedItem.value.authMethod.kind, 18)}
                    size={18}
                  />
                </span>
                <div>
                  <h3>{selectedItem.value.hostname}</h3>
                  <p>{selectedItem.value.origin}</p>
                </div>
                <div className="lyra-login-manager-detail-badges">
                  <StatusBadge session={selectedItem.value} labels={labels} />
                  <SourceBadge source={selectedItem.value.authMethodSource} labels={labels} />
                </div>
              </div>
              <div className="lyra-login-manager-actions">
                <AppButton
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenSite(selectedItem.value.address ?? selectedItem.value.origin, selectedItem.value.title ?? selectedItem.value.hostname)}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  <span>{labels.openSite}</span>
                </AppButton>
                <AppButton
                  variant="destructive"
                  size="sm"
                  disabled={busyKey === `session:${selectedItem.value.id}`}
                  onClick={() => void clearSite(selectedItem.value)}
                >
                  <LogOut size={14} aria-hidden="true" />
                  <span>{labels.logoutSite}</span>
                </AppButton>
                {editingSessionId === selectedItem.value.id ? (
                  <AppButton
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditingSessionId(null)}
                  >
                    <X size={14} aria-hidden="true" />
                    <span>{labels.cancel}</span>
                  </AppButton>
                ) : (
                  <AppButton
                    variant="secondary"
                    size="sm"
                    onClick={() => beginEdit(selectedItem.value)}
                  >
                    <Pencil size={14} aria-hidden="true" />
                    <span>{labels.edit}</span>
                  </AppButton>
                )}
              </div>
              {editingSessionId === selectedItem.value.id ? (
                <form className="lyra-login-manager-edit" onSubmit={onEditSubmit}>
                  <label>
                    <span>
                      <FactIcon kind="account" />
                      {labels.accountLabel}
                    </span>
                    <AppInput
                      aria-label={labels.accountLabel}
                      value={accountDraft}
                      onChange={(event) => setAccountDraft(event.target.value)}
                    />
                  </label>
                  <div className="lyra-login-manager-edit-field">
                    <span>
                      <FactIcon kind="method" />
                      {labels.authMethodLabel}
                    </span>
                    <AppSelect
                      ariaLabel={labels.authMethodLabel}
                      value={authMethodDraft}
                      options={authMethodOptions}
                      onValueChange={(value) => setAuthMethodDraft(value)}
                    />
                  </div>
                  <label>
                    <span>
                      <FactIcon kind="notes" />
                      {labels.notesLabel}
                    </span>
                    <AppTextarea
                      aria-label={labels.notesLabel}
                      value={notesDraft}
                      onChange={(event) => setNotesDraft(event.target.value)}
                    />
                  </label>
                  <AppButton
                    type="submit"
                    variant="default"
                    size="sm"
                    disabled={busyKey === `session:${selectedItem.value.id}`}
                  >
                    <Save size={14} aria-hidden="true" />
                    <span>{labels.save}</span>
                  </AppButton>
                </form>
              ) : (
                <dl className="lyra-login-manager-facts">
                  <div>
                    <dt>
                      <FactIcon kind="account" />
                      <span>{labels.accountLabel}</span>
                    </dt>
                    <dd>{selectedItem.value.accountHint ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>
                      <FactIcon kind="method" />
                      <span>{labels.authMethodLabel}</span>
                    </dt>
                    <dd>{selectedItem.value.authMethod.label}</dd>
                  </div>
                  <div>
                    <dt>
                      <FactIcon kind="notes" />
                      <span>{labels.notesLabel}</span>
                    </dt>
                    <dd>{selectedItem.value.notes ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>
                      <FactIcon kind="cookies" />
                      <span>{t("loginManager.cookiesLabel")}</span>
                    </dt>
                    <dd>{String(selectedItem.value.signals.cookieCount)}</dd>
                  </div>
                  <div>
                    <dt>
                      <FactIcon kind="storage" />
                      <span>{t("loginManager.storageLabel")}</span>
                    </dt>
                    <dd>
                      {selectedItem.value.signals.storageObserved
                        ? t("loginManager.yes")
                        : t("loginManager.no")}
                    </dd>
                  </div>
                  <div>
                    <dt>
                      <FactIcon kind="updated" />
                      <span>{t("loginManager.updatedLabel")}</span>
                    </dt>
                    <dd>{formatTime(selectedItem.value.updatedAt)}</dd>
                  </div>
                </dl>
              )}
            </article>
          ) : (
            <article className="lyra-login-manager-detail-panel">
              <div className="lyra-login-manager-detail-head">
                <span className="lyra-login-manager-detail-icon">
                  <SiteIcon
                    faviconUrl={selectedItem.value.faviconUrl}
                    fallback={methodIcon(selectedItem.value.authMethod.kind, 18)}
                    size={18}
                  />
                </span>
                <div>
                  <h3>{selectedItem.value.hostname}</h3>
                  <p>{selectedItem.value.username}</p>
                </div>
                <div className="lyra-login-manager-detail-badges">
                  <SourceBadge source={selectedItem.value.authMethod.source} labels={labels} />
                </div>
              </div>
              <div className="lyra-login-manager-actions">
                <AppButton
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenSite(selectedItem.value.origin, selectedItem.value.hostname)}
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  <span>{labels.openSite}</span>
                </AppButton>
                <AppButton
                  variant="outline"
                  size="sm"
                  disabled={!selectedItem.value.passwordAvailable || busyKey === `credential:${selectedItem.value.id}`}
                  onClick={() => void fillCredential(selectedItem.value)}
                >
                  <Check size={14} aria-hidden="true" />
                  <span>{labels.fill}</span>
                </AppButton>
                <AppButton
                  variant="outline"
                  size="sm"
                  disabled={!selectedItem.value.passwordAvailable || busyKey === `credential:${selectedItem.value.id}`}
                  onClick={() => void revealCredential(selectedItem.value)}
                >
                  <Eye size={14} aria-hidden="true" />
                  <span>{labels.reveal}</span>
                </AppButton>
                <AppButton
                  variant="outline"
                  size="sm"
                  disabled={!selectedItem.value.passwordAvailable}
                  onClick={() => void copyCredential(selectedItem.value)}
                >
                  <Copy size={14} aria-hidden="true" />
                  <span>{copiedCredentialId === selectedItem.value.id ? labels.copied : labels.copy}</span>
                </AppButton>
                <AppButton
                  variant="destructive"
                  size="sm"
                  disabled={busyKey === `credential:${selectedItem.value.id}`}
                  onClick={() => void deleteCredential(selectedItem.value)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  <span>{labels.deleteCredential}</span>
                </AppButton>
              </div>
              <dl className="lyra-login-manager-facts">
                <div>
                  <dt>
                    <FactIcon kind="account" />
                    <span>{labels.accountLabel}</span>
                  </dt>
                  <dd>{selectedItem.value.username}</dd>
                </div>
                <div>
                  <dt>
                    <FactIcon kind="method" />
                    <span>{labels.authMethodLabel}</span>
                  </dt>
                  <dd>{selectedItem.value.authMethod.label}</dd>
                </div>
                <div>
                  <dt>
                    <FactIcon kind="password" />
                      <span>{t("loginManager.passwordLabel")}</span>
                  </dt>
                  <dd>
                    {revealedPasswords.get(selectedItem.value.id) ?? (selectedItem.value.passwordAvailable ? "••••••••" : "—")}
                  </dd>
                </div>
                <div>
                  <dt>
                    <FactIcon kind="updated" />
                      <span>{t("loginManager.updatedLabel")}</span>
                  </dt>
                  <dd>{formatTime(selectedItem.value.updatedAt)}</dd>
                </div>
                <div>
                  <dt>
                    <FactIcon kind="lastUsed" />
                      <span>{t("loginManager.lastUsedLabel")}</span>
                  </dt>
                  <dd>{formatTime(selectedItem.value.lastUsedAt)}</dd>
                </div>
              </dl>
            </article>
          )}
        </section>
      </div>
    </section>
  );
};
