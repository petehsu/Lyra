import type { Session } from "electron";

import type {
  LoginManagerAuthMethod,
  LoginManagerClearSiteRequest,
  LoginManagerCredential,
  LoginManagerDeleteCredentialRequest,
  LoginManagerFactSource,
  LoginManagerFillCredentialRequest,
  LoginManagerRevealCredentialRequest,
  LoginManagerRevealCredentialResponse,
  LoginManagerSession,
  LoginManagerSessionSignals,
  LoginManagerSnapshot,
  LoginManagerUpdateSessionRequest
} from "../../shared/desktop-bridge";
import {
  fallbackFaviconUrl,
  normalizeFaviconUrl,
  type LoginManagerFaviconCache
} from "./favicon-cache";
import type { LoginCapturePayload } from "./page-scripts";
import type { LoginManagerPasswordVault } from "./password-vault";
import {
  STORE_VERSION,
  type LoginManagerStore,
  type StoredCredential
} from "./store";

type SessionPatch = {
  readonly address?: string;
  readonly title?: string;
  readonly faviconUrl?: string;
  readonly accountHint?: string;
  readonly signals?: Partial<LoginManagerSessionSignals>;
  readonly authMethod?: LoginManagerAuthMethod;
};

export type LoginManagerSessionModel = {
  readonly snapshot: () => LoginManagerSnapshot;
  readonly isCredentialCaptureEnabled: () => boolean;
  readonly setCredentialCaptureEnabled: (enabled: boolean) => LoginManagerSnapshot;
  readonly upsertSession: (origin: string, patch: SessionPatch) => LoginManagerSession;
  readonly updateSession: (request: LoginManagerUpdateSessionRequest) => LoginManagerSnapshot;
  readonly deleteCredential: (request: LoginManagerDeleteCredentialRequest) => LoginManagerSnapshot;
  readonly revealCredential: (
    request: LoginManagerRevealCredentialRequest
  ) => LoginManagerRevealCredentialResponse;
  readonly recordCredentialSubmit: (
    payload: LoginCapturePayload,
    currentUrl: string,
    electronSession?: Session
  ) => boolean;
  readonly findCredentialForFill: (
    request: LoginManagerFillCredentialRequest
  ) => StoredCredential | null;
  readonly markCredentialUsed: (credentialId: string) => void;
  readonly resolveClearOrigin: (request: LoginManagerClearSiteRequest) => string;
  readonly markSiteCleared: (origin: string) => void;
  readonly setFaviconForOrigin: (origin: string, faviconUrl: string) => void;
  readonly updateCredentialFaviconsForOrigin: (origin: string, faviconUrl: string) => void;
  readonly fillSuggestionsForOrigin: (
    origin: string
  ) => readonly Pick<LoginManagerCredential, "id" | "username">[];
  readonly warmFavicons: () => void;
};

export const nowIso = (): string => new Date().toISOString();

export const defaultAuthMethod = (
  kind: LoginManagerAuthMethod["kind"] = "unknown",
  source: LoginManagerFactSource = "unknown",
  label?: string,
  providerDomain?: string
): LoginManagerAuthMethod => ({
  kind,
  label: label ?? (kind === "site_session" ? "Site session" : "Unknown"),
  source,
  confidence: source === "manual" || source === "observed" ? 1 : source === "inferred" ? 0.72 : 0,
  ...(providerDomain === undefined ? {} : { providerDomain })
});

export const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeOrigin = (value: unknown): string | null => {
  const raw = normalizeString(value);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch (_error) {
    return null;
  }
};

export const hostnameFromOrigin = (origin: string): string => {
  try {
    return new URL(origin).hostname;
  } catch (_error) {
    return origin;
  }
};

const credentialKey = (origin: string, username: string): string =>
  Buffer.from(`${origin}\n${username}`, "utf8")
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");

const credentialIdFor = (origin: string, username: string): string =>
  `credential:${credentialKey(origin, username)}`;

export const inferAuthProvider = (url: string): LoginManagerAuthMethod | null => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (_error) {
    return null;
  }
  const hostname = parsed.hostname.toLowerCase();
  const pathName = parsed.pathname.toLowerCase();
  if (hostname === "accounts.google.com") {
    return defaultAuthMethod("oauth", "inferred", "Google", hostname);
  }
  if (
    hostname === "github.com"
    && (pathName === "/login/oauth" || pathName.startsWith("/login/oauth/"))
  ) {
    return defaultAuthMethod("oauth", "inferred", "GitHub", hostname);
  }
  if (hostname === "login.microsoftonline.com" || hostname.endsWith(".microsoftonline.com")) {
    return defaultAuthMethod("oauth", "inferred", "Microsoft", hostname);
  }
  if (hostname === "appleid.apple.com") {
    return defaultAuthMethod("oauth", "inferred", "Apple ID", hostname);
  }
  if (hostname === "okta.com" || hostname.endsWith(".okta.com")) {
    return defaultAuthMethod("sso", "inferred", "Okta SSO", hostname);
  }
  if (hostname === "auth0.com" || hostname.endsWith(".auth0.com")) {
    return defaultAuthMethod("sso", "inferred", "Auth0 SSO", hostname);
  }
  return null;
};

const mergeSignals = (
  current: LoginManagerSessionSignals,
  patch: Partial<LoginManagerSessionSignals>
): LoginManagerSessionSignals => {
  const oauthHint = patch.oauthHint ?? current.oauthHint;
  return {
    cookieCount: Math.max(current.cookieCount, patch.cookieCount ?? 0),
    storageObserved: current.storageObserved || patch.storageObserved === true,
    formSubmitted: current.formSubmitted || patch.formSubmitted === true,
    ...(oauthHint === undefined ? {} : { oauthHint })
  };
};

const createEmptySignals = (): LoginManagerSessionSignals => ({
  cookieCount: 0,
  storageObserved: false,
  formSubmitted: false
});

const sanitizeManualAuthMethod = (
  current: LoginManagerAuthMethod,
  patch: Partial<LoginManagerAuthMethod> | undefined
): LoginManagerAuthMethod => {
  if (patch === undefined) {
    return current;
  }
  const kind = patch.kind ?? current.kind;
  const label = normalizeString(patch.label) ?? current.label;
  const source = patch.source ?? "manual";
  const confidence =
    typeof patch.confidence === "number" && Number.isFinite(patch.confidence)
      ? Math.max(0, Math.min(1, patch.confidence))
      : 1;
  return {
    kind,
    label,
    source,
    confidence,
    ...(normalizeString(patch.providerDomain) === null
      ? {}
      : { providerDomain: normalizeString(patch.providerDomain)! })
  };
};

export const createLoginManagerSessionModel = ({
  storageRoot,
  initialStore,
  saveStore,
  passwordVault,
  faviconCache
}: {
  readonly storageRoot: string;
  readonly initialStore: LoginManagerStore;
  readonly saveStore: (store: LoginManagerStore) => void;
  readonly passwordVault: LoginManagerPasswordVault;
  readonly faviconCache: LoginManagerFaviconCache;
}): LoginManagerSessionModel => {
  let store = initialStore;
  const faviconByOrigin = new Map<string, string>();

  const save = (): void => {
    saveStore(store);
  };

  const upsertSession = (
    origin: string,
    patch: SessionPatch
  ): LoginManagerSession => {
    const timestamp = nowIso();
    const existing = store.sessions.find((entry) => entry.origin === origin);
    const existingSignals = existing?.signals ?? createEmptySignals();
    const nextSignals = mergeSignals(existingSignals, patch.signals ?? {});
    const manualAuth = existing?.authMethodSource === "manual";
    const inferredAuth =
      manualAuth
        ? existing.authMethod
        : patch.authMethod
          ?? (nextSignals.formSubmitted
            ? defaultAuthMethod("password", "observed", "Password")
            : nextSignals.cookieCount > 0 || nextSignals.storageObserved
              ? defaultAuthMethod("site_session", "observed", "Site session")
              : existing?.authMethod ?? defaultAuthMethod());
    const hostname = hostnameFromOrigin(origin);
    const nextTitle = patch.title ?? existing?.title;
    const nextAddress = patch.address ?? existing?.address;
    const nextFaviconUrl = normalizeFaviconUrl(patch.faviconUrl, origin)
      ?? normalizeFaviconUrl(existing?.faviconUrl, origin)
      ?? undefined;
    const nextAccountHint = patch.accountHint ?? existing?.accountHint;
    const next: LoginManagerSession = {
      id: origin,
      origin,
      hostname,
      ...(nextFaviconUrl === undefined ? {} : { faviconUrl: nextFaviconUrl }),
      ...(nextTitle === undefined ? {} : { title: nextTitle }),
      ...(nextAddress === undefined ? {} : { address: nextAddress }),
      status:
        nextSignals.cookieCount > 0 || nextSignals.storageObserved || nextSignals.formSubmitted
          ? "observed"
          : "possible",
      ...(nextAccountHint === undefined ? {} : { accountHint: nextAccountHint }),
      ...(existing?.notes === undefined ? {} : { notes: existing.notes }),
      authMethod: inferredAuth,
      authMethodSource: manualAuth ? "manual" : inferredAuth.source,
      signals: nextSignals,
      credentialIds: store.credentials
        .filter((credential) => credential.origin === origin)
        .map((credential) => credential.id),
      firstSeenAt: existing?.firstSeenAt ?? timestamp,
      lastSeenAt: timestamp,
      updatedAt: timestamp
    };
    store = {
      ...store,
      sessions: [
        next,
        ...store.sessions.filter((entry) => entry.origin !== origin)
      ].sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))
    };
    save();
    return next;
  };

  const snapshot = (): LoginManagerSnapshot => {
    const passwordsAvailable = passwordVault.isAvailable();
    const faviconSourceByOrigin = new Map(
      store.sessions.map((session) => [
        session.origin,
        normalizeFaviconUrl(faviconByOrigin.get(session.origin), session.origin)
          ?? normalizeFaviconUrl(session.faviconUrl, session.origin)
          ?? fallbackFaviconUrl(session.origin)
      ] as const)
    );
    const credentials = store.credentials.map((credential) => {
      const publicCredential = passwordVault.toPublicCredential(credential, passwordsAvailable);
      const sourceUrl = normalizeFaviconUrl(publicCredential.faviconUrl, publicCredential.origin)
        ?? faviconSourceByOrigin.get(publicCredential.origin)
        ?? fallbackFaviconUrl(publicCredential.origin);
      const faviconUrl = faviconCache.urlForSnapshot(publicCredential.origin, sourceUrl);
      return faviconUrl === undefined
        ? publicCredential
        : { ...publicCredential, faviconUrl };
    });
    const sessions = store.sessions.map((session) => {
      const faviconUrl = faviconCache.urlForSnapshot(
        session.origin,
        faviconSourceByOrigin.get(session.origin)
      );
      return {
        ...session,
        ...(faviconUrl === undefined ? {} : { faviconUrl }),
        credentialIds: credentials
          .filter((credential) => credential.origin === session.origin)
          .map((credential) => credential.id)
      };
    });
    return {
      version: STORE_VERSION,
      generatedAt: nowIso(),
      storageRoot,
      credentialCaptureEnabled: store.credentialCaptureEnabled,
      passwordsAvailable,
      ...(passwordsAvailable
        ? {}
        : { passwordStorageReason: "electron_safe_storage_unavailable" }),
      sessions,
      credentials
    };
  };

  const setCredentialCaptureEnabled = (enabled: boolean): LoginManagerSnapshot => {
    store = {
      ...store,
      credentialCaptureEnabled: enabled
    };
    save();
    return snapshot();
  };

  const recordCredentialSubmit = (
    payload: LoginCapturePayload,
    currentUrl: string,
    electronSession?: Session
  ): boolean => {
    const origin = normalizeOrigin(payload.url);
    const currentOrigin = normalizeOrigin(currentUrl);
    const username = normalizeString(payload.username);
    if (origin === null || currentOrigin !== origin || username === null) {
      return false;
    }
    const passwordCiphertextBase64 = passwordVault.encryptPassword(payload.password);
    const id = credentialIdFor(origin, username);
    const timestamp = nowIso();
    const existing = store.credentials.find((entry) => entry.id === id);
    const faviconUrl = faviconByOrigin.get(origin)
      ?? store.sessions.find((entry) => entry.origin === origin)?.faviconUrl;
    faviconCache.queue(origin, faviconUrl, electronSession);
    const credential: StoredCredential = {
      id,
      origin,
      hostname: hostnameFromOrigin(origin),
      ...(faviconUrl === undefined ? {} : { faviconUrl }),
      username,
      authMethod: defaultAuthMethod("password", "observed", "Password"),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      lastUsedAt: timestamp,
      ...(passwordCiphertextBase64 === null
        ? existing?.passwordCiphertextBase64 === undefined
          ? {}
          : { passwordCiphertextBase64: existing.passwordCiphertextBase64 }
        : { passwordCiphertextBase64 })
    };
    store = {
      ...store,
      credentials: [
        credential,
        ...store.credentials.filter((entry) => entry.id !== id)
      ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    };
    const pageTitle = normalizeString(payload.title);
    upsertSession(origin, {
      address: payload.url,
      ...(faviconUrl === undefined ? {} : { faviconUrl }),
      ...(pageTitle === null ? {} : { title: pageTitle }),
      accountHint: username,
      authMethod: defaultAuthMethod("password", "observed", "Password"),
      signals: {
        formSubmitted: true
      }
    });
    save();
    return true;
  };

  const findCredentialForFill = (
    request: LoginManagerFillCredentialRequest
  ): StoredCredential | null => {
    const credentialId = normalizeString(request.credentialId);
    if (credentialId !== null) {
      return store.credentials.find((entry) => entry.id === credentialId) ?? null;
    }
    const origin = normalizeOrigin(request.origin);
    if (origin === null) {
      return null;
    }
    return store.credentials.find((entry) => entry.origin === origin) ?? null;
  };

  const markCredentialUsed = (credentialId: string): void => {
    const timestamp = nowIso();
    store = {
      ...store,
      credentials: store.credentials.map((entry) =>
        entry.id === credentialId
          ? { ...entry, lastUsedAt: timestamp, updatedAt: timestamp }
          : entry
      )
    };
    save();
  };

  const resolveClearOrigin = (request: LoginManagerClearSiteRequest): string => {
    const direct = normalizeOrigin(request.origin);
    if (direct !== null) {
      return direct;
    }
    const sessionId = normalizeString(request.sessionId);
    if (sessionId !== null) {
      const bySessionId = store.sessions.find((entry) => entry.id === sessionId);
      if (bySessionId !== undefined) {
        return bySessionId.origin;
      }
    }
    const hostname = normalizeString(request.hostname);
    if (hostname !== null) {
      const byHostname = store.sessions.find((entry) => entry.hostname === hostname);
      if (byHostname !== undefined) {
        return byHostname.origin;
      }
    }
    throw new Error("origin, sessionId, or hostname is required");
  };

  const markSiteCleared = (origin: string): void => {
    const timestamp = nowIso();
    store = {
      ...store,
      sessions: store.sessions.map((session) =>
        session.origin === origin
          ? {
              ...session,
              status: "possible",
              signals: {
                ...session.signals,
                cookieCount: 0,
                storageObserved: false
              },
              updatedAt: timestamp
            }
          : session
      )
    };
    save();
  };

  const updateSession = (
    request: LoginManagerUpdateSessionRequest
  ): LoginManagerSnapshot => {
    const origin =
      normalizeOrigin(request.origin)
      ?? (normalizeString(request.sessionId) === null
        ? null
        : store.sessions.find((entry) => entry.id === normalizeString(request.sessionId))?.origin ?? null);
    if (origin === null) {
      throw new Error("origin or sessionId is required");
    }
    const existing = store.sessions.find((entry) => entry.origin === origin)
      ?? upsertSession(origin, {});
    const nextAuth = sanitizeManualAuthMethod(existing.authMethod, request.authMethod);
    const timestamp = nowIso();
    const nextAccountHint = request.accountHint === null
      ? null
      : normalizeString(request.accountHint) ?? existing.accountHint;
    const nextNotes = request.notes === null
      ? null
      : normalizeString(request.notes) ?? existing.notes;
    const {
      accountHint: _oldAccountHint,
      notes: _oldNotes,
      ...sessionWithoutEditableText
    } = existing;
    store = {
      ...store,
      sessions: [
        {
          ...sessionWithoutEditableText,
          ...(nextAccountHint === null || nextAccountHint === undefined
            ? {}
            : { accountHint: nextAccountHint }),
          ...(nextNotes === null || nextNotes === undefined
            ? {}
            : { notes: nextNotes }),
          authMethod: nextAuth,
          authMethodSource: nextAuth.source,
          updatedAt: timestamp
        },
        ...store.sessions.filter((entry) => entry.origin !== origin)
      ]
    };
    save();
    return snapshot();
  };

  const deleteCredential = (
    request: LoginManagerDeleteCredentialRequest
  ): LoginManagerSnapshot => {
    const credentialId = normalizeString(request.credentialId);
    if (credentialId === null) {
      throw new Error("credentialId is required");
    }
    store = {
      ...store,
      credentials: store.credentials.filter((entry) => entry.id !== credentialId)
    };
    save();
    return snapshot();
  };

  const revealCredential = (
    request: LoginManagerRevealCredentialRequest
  ): LoginManagerRevealCredentialResponse => {
    const credentialId = normalizeString(request.credentialId);
    if (credentialId === null) {
      throw new Error("credentialId is required");
    }
    const credential = store.credentials.find((entry) => entry.id === credentialId);
    if (credential === undefined || credential.passwordCiphertextBase64 === undefined) {
      throw new Error("Saved password is unavailable.");
    }
    return {
      credentialId,
      username: credential.username,
      password: passwordVault.decryptPassword(credential.passwordCiphertextBase64)
    };
  };

  const setFaviconForOrigin = (origin: string, faviconUrl: string): void => {
    faviconByOrigin.set(origin, faviconUrl);
  };

  const updateCredentialFaviconsForOrigin = (origin: string, faviconUrl: string): void => {
    store = {
      ...store,
      credentials: store.credentials.map((credential) =>
        credential.origin === origin
          ? { ...credential, faviconUrl }
          : credential
      )
    };
    save();
  };

  const fillSuggestionsForOrigin = (
    origin: string
  ): readonly Pick<LoginManagerCredential, "id" | "username">[] =>
    snapshot().credentials
      .filter((credential) => credential.origin === origin && credential.passwordAvailable)
      .map((credential) => ({
        id: credential.id,
        username: credential.username
      }));

  const warmFavicons = (): void => {
    for (const session of store.sessions) {
      faviconCache.queue(
        session.origin,
        normalizeFaviconUrl(session.faviconUrl, session.origin) ?? fallbackFaviconUrl(session.origin)
      );
    }
    for (const credential of store.credentials) {
      faviconCache.queue(
        credential.origin,
        normalizeFaviconUrl(credential.faviconUrl, credential.origin)
          ?? store.sessions.find((session) => session.origin === credential.origin)?.faviconUrl
          ?? fallbackFaviconUrl(credential.origin)
      );
    }
  };

  return {
    snapshot,
    isCredentialCaptureEnabled: () => store.credentialCaptureEnabled,
    setCredentialCaptureEnabled,
    upsertSession,
    updateSession,
    deleteCredential,
    revealCredential,
    recordCredentialSubmit,
    findCredentialForFill,
    markCredentialUsed,
    resolveClearOrigin,
    markSiteCleared,
    setFaviconForOrigin,
    updateCredentialFaviconsForOrigin,
    fillSuggestionsForOrigin,
    warmFavicons
  };
};
