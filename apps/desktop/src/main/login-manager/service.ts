import {
  ipcMain,
  safeStorage,
  session as electronSessionApi,
  type BrowserWindow,
  type Session,
  type WebContents
} from "electron";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  LYRA_CHANNELS,
  type LoginManagerAuthMethod,
  type LoginManagerClearSiteRequest,
  type LoginManagerClearSiteResponse,
  type LoginManagerCredential,
  type LoginManagerDeleteCredentialRequest,
  type LoginManagerEvent,
  type LoginManagerFactSource,
  type LoginManagerFillCredentialRequest,
  type LoginManagerFillCredentialResponse,
  type LoginManagerRevealCredentialRequest,
  type LoginManagerRevealCredentialResponse,
  type LoginManagerSession,
  type LoginManagerSessionSignals,
  type LoginManagerSnapshot,
  type LoginManagerUpdateSessionRequest
} from "../../shared/desktop-bridge";
import { createLoginManagerPasswordRef } from "../../shared/sensitive-value";

const STORE_VERSION = 1 as const;
const STORE_FILE_NAME = "login-manager.v1.json";
const FAVICON_CACHE_VERSION = 1 as const;
const FAVICON_CACHE_DIR_NAME = "favicons";
const FAVICON_CACHE_INDEX_FILE_NAME = "index.v1.json";
const FAVICON_MAX_BYTES = 1024 * 1024;
const CONSOLE_BRIDGE_PREFIX = "__LYRA_LOGIN_MANAGER__:";

type StoredCredential = Omit<
  LoginManagerCredential,
  "hasPassword" | "passwordAvailable" | "passwordRef"
> & {
  readonly passwordCiphertextBase64?: string;
};

type LoginManagerStore = {
  readonly version: 1;
  readonly sessions: readonly LoginManagerSession[];
  readonly credentials: readonly StoredCredential[];
};

type FaviconCacheRecord = {
  readonly origin: string;
  readonly sourceUrl: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly updatedAt: string;
};

type FaviconCacheIndex = {
  readonly version: 1;
  readonly records: readonly FaviconCacheRecord[];
};

type LoginCapturePayload = {
  readonly type: "credential-submit";
  readonly url: string;
  readonly title?: string;
  readonly username: string;
  readonly password: string;
};

type FillRequestPayload = {
  readonly type: "fill-request";
  readonly credentialId: string;
};

type LoginBridgePayload = LoginCapturePayload | FillRequestPayload;

type AttachedTab = {
  readonly tabId: string;
  readonly webContents: WebContents;
};

export type LoginManagerIpcBridge = {
  readonly dispose: () => void;
  readonly attachWebContents: (tabId: string, webContents: WebContents) => () => void;
  readonly list: () => LoginManagerSnapshot;
  readonly updateSession: (request: LoginManagerUpdateSessionRequest) => LoginManagerSnapshot;
  readonly deleteCredential: (request: LoginManagerDeleteCredentialRequest) => LoginManagerSnapshot;
  readonly revealCredential: (
    request: LoginManagerRevealCredentialRequest
  ) => LoginManagerRevealCredentialResponse;
  readonly fillCredential: (
    request: LoginManagerFillCredentialRequest
  ) => Promise<LoginManagerFillCredentialResponse>;
  readonly clearSite: (
    request: LoginManagerClearSiteRequest
  ) => Promise<LoginManagerClearSiteResponse>;
};

const nowIso = (): string => new Date().toISOString();

const defaultAuthMethod = (
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

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeOrigin = (value: unknown): string | null => {
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

const hostnameFromOrigin = (origin: string): string => {
  try {
    return new URL(origin).hostname;
  } catch (_error) {
    return origin;
  }
};

const normalizeFaviconUrl = (
  value: unknown,
  origin?: string
): string | null => {
  const raw = normalizeString(value);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = new URL(raw, origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch (_error) {
    return null;
  }
};

const fallbackFaviconUrl = (origin: string): string | null => {
  try {
    const parsed = new URL(origin);
    parsed.pathname = "/favicon.ico";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch (_error) {
    return null;
  }
};

const faviconCacheDir = (storageRoot: string): string =>
  path.join(storageRoot, FAVICON_CACHE_DIR_NAME);

const faviconCacheIndexPath = (storageRoot: string): string =>
  path.join(faviconCacheDir(storageRoot), FAVICON_CACHE_INDEX_FILE_NAME);

const emptyFaviconCacheIndex = (): FaviconCacheIndex => ({
  version: FAVICON_CACHE_VERSION,
  records: []
});

const readFaviconCacheIndex = (storageRoot: string): FaviconCacheIndex => {
  try {
    const parsed = JSON.parse(
      readFileSync(faviconCacheIndexPath(storageRoot), "utf8")
    ) as Partial<FaviconCacheIndex>;
    if (parsed.version !== FAVICON_CACHE_VERSION || Array.isArray(parsed.records) === false) {
      return emptyFaviconCacheIndex();
    }
    return {
      version: FAVICON_CACHE_VERSION,
      records: parsed.records.filter((record): record is FaviconCacheRecord => (
        record !== null
        && typeof record === "object"
        && typeof record.origin === "string"
        && typeof record.sourceUrl === "string"
        && typeof record.fileName === "string"
        && typeof record.mimeType === "string"
        && typeof record.updatedAt === "string"
      ))
    };
  } catch (_error) {
    return emptyFaviconCacheIndex();
  }
};

const writeFaviconCacheIndex = (
  storageRoot: string,
  index: FaviconCacheIndex
): void => {
  mkdirSync(faviconCacheDir(storageRoot), { recursive: true });
  writeFileSync(
    faviconCacheIndexPath(storageRoot),
    JSON.stringify(index, null, 2),
    "utf8"
  );
};

const toFilePreviewUrl = (filePath: string, mimeType: string): string =>
  `lyra-file://preview?path=${encodeURIComponent(filePath)}&contentType=${encodeURIComponent(mimeType)}`;

const faviconFileNameFor = (origin: string): string =>
  `${createHash("sha256").update(origin).digest("hex").slice(0, 32)}.favicon`;

const cachedFaviconUrl = (
  storageRoot: string,
  index: FaviconCacheIndex,
  origin: string
): string | null => {
  const record = index.records.find((entry) => entry.origin === origin);
  if (record === undefined) {
    return null;
  }
  const filePath = path.join(faviconCacheDir(storageRoot), record.fileName);
  if (existsSync(filePath) === false) {
    return null;
  }
  return toFilePreviewUrl(filePath, record.mimeType);
};

const mimeTypeFromFaviconResponse = (
  sourceUrl: string,
  contentTypeHeader: string | null
): string | null => {
  const headerMimeType = contentTypeHeader
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (headerMimeType !== undefined && headerMimeType.startsWith("image/")) {
    return headerMimeType;
  }
  let extension = "";
  try {
    extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  } catch (_error) {
    extension = "";
  }
  if (extension === ".ico" || extension === ".cur") return "image/x-icon";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".avif") return "image/avif";
  return null;
};

const fetchFaviconResponse = async (
  sourceUrl: string,
  electronSession?: Session
): Promise<Response> => {
  const requestInit: RequestInit = {
    redirect: "follow",
    headers: {
      Accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8"
    }
  };
  const sessionForFetch = electronSession ?? electronSessionApi.defaultSession;
  const sessionFetch = (sessionForFetch as { readonly fetch?: typeof fetch } | undefined)?.fetch;
  if (typeof sessionFetch === "function") {
    return await sessionFetch.call(sessionForFetch, sourceUrl, requestInit);
  }
  return await fetch(sourceUrl, requestInit);
};

const credentialKey = (origin: string, username: string): string =>
  Buffer.from(`${origin}\n${username}`, "utf8")
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");

const credentialIdFor = (origin: string, username: string): string =>
  `credential:${credentialKey(origin, username)}`;

const toPublicCredential = (
  credential: StoredCredential,
  passwordsAvailable: boolean
): LoginManagerCredential => {
  const hasPassword = credential.passwordCiphertextBase64 !== undefined;
  const passwordAvailable = passwordsAvailable && hasPassword;
  return {
    ...credential,
    hasPassword,
    passwordAvailable,
    ...(hasPassword
      ? {
          passwordRef: createLoginManagerPasswordRef({
            credentialId: credential.id,
            origin: credential.origin,
            hostname: credential.hostname,
            username: credential.username
          })
        }
      : {})
  };
};

const sanitizeStoredCredential = (credential: unknown): StoredCredential => {
  const record =
    credential !== null && typeof credential === "object" && !Array.isArray(credential)
      ? credential as Record<string, unknown>
      : {};
  const {
    hasPassword: _hasPassword,
    passwordAvailable: _passwordAvailable,
    passwordRef: _passwordRef,
    ...stored
  } = record;
  return stored as StoredCredential;
};

const readStoreFile = (storageRoot: string): LoginManagerStore => {
  const filePath = path.join(storageRoot, STORE_FILE_NAME);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<LoginManagerStore>;
    if (
      parsed.version !== STORE_VERSION
      || Array.isArray(parsed.sessions) === false
      || Array.isArray(parsed.credentials) === false
    ) {
      return { version: STORE_VERSION, sessions: [], credentials: [] };
    }
    return {
      version: STORE_VERSION,
      sessions: parsed.sessions,
      credentials: parsed.credentials.map(sanitizeStoredCredential)
    };
  } catch (_error) {
    return { version: STORE_VERSION, sessions: [], credentials: [] };
  }
};

const writeStoreFile = (storageRoot: string, store: LoginManagerStore): void => {
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(
    path.join(storageRoot, STORE_FILE_NAME),
    JSON.stringify(store, null, 2),
    "utf8"
  );
};

const isSafeStorageAvailable = (): boolean => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch (_error) {
    return false;
  }
};

const encryptPassword = (password: string): string | null => {
  if (isSafeStorageAvailable() === false) {
    return null;
  }
  return safeStorage.encryptString(password).toString("base64");
};

const decryptPassword = (ciphertextBase64: string): string => {
  if (isSafeStorageAvailable() === false) {
    throw new Error("Password storage is unavailable on this system.");
  }
  return safeStorage.decryptString(Buffer.from(ciphertextBase64, "base64"));
};

const inferAuthProvider = (url: string): LoginManagerAuthMethod | null => {
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
  if (hostname === "github.com" && pathName.includes("/login/oauth")) {
    return defaultAuthMethod("oauth", "inferred", "GitHub", hostname);
  }
  if (hostname === "login.microsoftonline.com" || hostname.endsWith(".microsoftonline.com")) {
    return defaultAuthMethod("oauth", "inferred", "Microsoft", hostname);
  }
  if (hostname === "appleid.apple.com") {
    return defaultAuthMethod("oauth", "inferred", "Apple ID", hostname);
  }
  if (hostname.includes("okta.com")) {
    return defaultAuthMethod("sso", "inferred", "Okta SSO", hostname);
  }
  if (hostname.includes("auth0.com")) {
    return defaultAuthMethod("sso", "inferred", "Auth0 SSO", hostname);
  }
  if (pathName.includes("oauth") || pathName.includes("saml") || pathName.includes("sso")) {
    return defaultAuthMethod("sso", "inferred", "SSO", hostname);
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

const buildObserverScript = (
  suggestions: readonly Pick<LoginManagerCredential, "id" | "username">[]
): string => {
  const prefix = JSON.stringify(CONSOLE_BRIDGE_PREFIX);
  const suggestionJson = JSON.stringify(suggestions);
  return `
(() => {
  const prefix = ${prefix};
  const suggestions = ${suggestionJson};
  const state = window.__lyraLoginManager ?? { installed: false };
  window.__lyraLoginManager = state;

  const visible = (input) => {
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.type === "hidden" || input.disabled || input.readOnly) return false;
    const style = window.getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const findLoginForm = () => {
    const password = Array.from(document.querySelectorAll("input[type='password']")).find(visible);
    if (!password) return null;
    const form = password.form ?? password.closest("form") ?? document;
    const username = Array.from(form.querySelectorAll("input")).find((input) => {
      if (!visible(input) || input === password) return false;
      const type = (input.getAttribute("type") || "text").toLowerCase();
      const autocomplete = (input.getAttribute("autocomplete") || "").toLowerCase();
      const name = ((input.name || "") + " " + (input.id || "") + " " + (input.placeholder || "")).toLowerCase();
      return autocomplete.includes("username")
        || autocomplete.includes("email")
        || type === "email"
        || type === "text"
        || name.includes("user")
        || name.includes("email")
        || name.includes("account");
    });
    return { form, username, password };
  };

  const send = (payload) => {
    try {
      console.info(prefix + JSON.stringify(payload));
    } catch (_error) {
      // no-op
    }
  };

  const capture = () => {
    const login = findLoginForm();
    if (!login || !login.password.value) return;
    const username = login.username instanceof HTMLInputElement ? login.username.value : "";
    if (!username.trim()) return;
    send({
      type: "credential-submit",
      url: window.location.href,
      title: document.title,
      username,
      password: login.password.value
    });
  };

  if (!state.installed) {
    state.installed = true;
    document.addEventListener("submit", (event) => {
      const login = findLoginForm();
      if (!login) return;
      const target = event.target;
      if (target === login.form || (target instanceof Node && login.form instanceof Element && login.form.contains(target))) {
        capture();
      }
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        setTimeout(capture, 0);
      }
    }, true);
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button,input[type='submit'],input[type='button']");
      if (button) {
        setTimeout(capture, 0);
      }
    }, true);
  }

  const existing = document.getElementById("lyra-login-fill-suggestion");
  if (existing) existing.remove();
  const login = findLoginForm();
  if (login && suggestions.length > 0) {
    const root = document.createElement("div");
    root.id = "lyra-login-fill-suggestion";
    root.style.cssText = [
      "position:fixed",
      "right:14px",
      "bottom:14px",
      "z-index:2147483647",
      "display:flex",
      "gap:6px",
      "align-items:center",
      "padding:8px 10px",
      "border:1px solid rgba(120,120,130,.35)",
      "border-radius:8px",
      "background:Canvas",
      "color:CanvasText",
      "font:12px system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
      "box-shadow:0 10px 26px rgba(0,0,0,.18)"
    ].join(";");
    const label = document.createElement("span");
    label.textContent = suggestions[0].username;
    label.style.cssText = "max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Fill with Lyra";
    button.style.cssText = "border:0;border-radius:6px;padding:5px 8px;background:Highlight;color:HighlightText;font:inherit;cursor:pointer;";
    button.addEventListener("click", () => {
      send({ type: "fill-request", credentialId: suggestions[0].id });
    });
    root.append(label, button);
    document.documentElement.append(root);
  }
})()
`;
};

const buildFillScript = (username: string, password: string): string => `
(() => {
  const usernameValue = ${JSON.stringify(username)};
  const passwordValue = ${JSON.stringify(password)};
  const visible = (input) => {
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.type === "hidden" || input.disabled || input.readOnly) return false;
    const style = window.getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const passwordInput = Array.from(document.querySelectorAll("input[type='password']")).find(visible);
  if (!passwordInput) return { filled: false, reason: "password_field_missing" };
  const form = passwordInput.form ?? passwordInput.closest("form") ?? document;
  const usernameInput = Array.from(form.querySelectorAll("input")).find((input) => {
    if (!visible(input) || input === passwordInput) return false;
    const type = (input.getAttribute("type") || "text").toLowerCase();
    const autocomplete = (input.getAttribute("autocomplete") || "").toLowerCase();
    const name = \`\${input.name || ""} \${input.id || ""} \${input.placeholder || ""}\`.toLowerCase();
    return autocomplete.includes("username")
      || autocomplete.includes("email")
      || type === "email"
      || type === "text"
      || name.includes("user")
      || name.includes("email")
      || name.includes("account");
  });
  const setValue = (input, value) => {
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (usernameInput instanceof HTMLInputElement) {
    setValue(usernameInput, usernameValue);
  }
  setValue(passwordInput, passwordValue);
  passwordInput.focus();
  return {
    filled: true,
    usernameField: usernameInput instanceof HTMLInputElement,
    passwordField: true
  };
})()
`;

const readPageFaviconUrl = async (
  webContents: WebContents,
  origin: string
): Promise<string | null> => {
  const raw = await webContents.executeJavaScript(
    `(() => {
      const candidates = Array.from(document.querySelectorAll("link[rel][href]"))
        .map((link) => ({
          rel: String(link.getAttribute("rel") || "").toLowerCase(),
          href: String(link.getAttribute("href") || "")
        }))
        .filter((entry) =>
          entry.href.length > 0
          && (
            entry.rel.includes("icon")
            || entry.rel.includes("apple-touch-icon")
            || entry.rel.includes("mask-icon")
          )
        )
        .sort((left, right) => {
          const score = (entry) => {
            if (entry.rel.includes("shortcut icon")) return 0;
            if (entry.rel === "icon" || entry.rel.includes(" icon")) return 1;
            if (entry.rel.includes("apple-touch-icon")) return 2;
            return 3;
          };
          return score(left) - score(right);
        });
      const href = candidates[0]?.href || "/favicon.ico";
      try {
        return new URL(href, document.baseURI || window.location.href).toString();
      } catch (_error) {
        return href;
      }
    })()`,
    true
  ).catch(() => null);
  return normalizeFaviconUrl(raw, origin);
};

export const createLoginManagerIpcBridge = ({
  storageRoot,
  getWindow
}: {
  readonly storageRoot: string;
  readonly getWindow: () => BrowserWindow | null;
}): LoginManagerIpcBridge => {
  let store = readStoreFile(storageRoot);
  let faviconCacheIndex = readFaviconCacheIndex(storageRoot);
  const attachedTabs = new Map<string, AttachedTab>();
  const electronSessions = new Set<Session>();
  const activeOriginByTab = new Map<string, string>();
  const faviconByOrigin = new Map<string, string>();
  const faviconCacheInFlight = new Set<string>();

  const save = (): void => {
    writeStoreFile(storageRoot, store);
  };

  const saveFaviconCacheIndex = (): void => {
    writeFaviconCacheIndex(storageRoot, faviconCacheIndex);
  };

  const cacheFavicon = async (
    origin: string,
    sourceUrl: string,
    electronSession?: Session
  ): Promise<boolean> => {
    const response = await fetchFaviconResponse(sourceUrl, electronSession);
    if (response.ok === false) {
      return false;
    }
    const mimeType = mimeTypeFromFaviconResponse(
      response.url.trim().length > 0 ? response.url : sourceUrl,
      response.headers.get("content-type")
    );
    if (mimeType === null) {
      return false;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > FAVICON_MAX_BYTES) {
      return false;
    }
    const fileName = faviconFileNameFor(origin);
    mkdirSync(faviconCacheDir(storageRoot), { recursive: true });
    writeFileSync(path.join(faviconCacheDir(storageRoot), fileName), bytes);
    const record: FaviconCacheRecord = {
      origin,
      sourceUrl,
      fileName,
      mimeType,
      updatedAt: nowIso()
    };
    faviconCacheIndex = {
      version: FAVICON_CACHE_VERSION,
      records: [
        record,
        ...faviconCacheIndex.records.filter((entry) => entry.origin !== origin)
      ]
    };
    saveFaviconCacheIndex();
    return true;
  };

  const queueFaviconCache = (
    origin: string,
    sourceUrl: string | null | undefined,
    electronSession?: Session
  ): void => {
    const normalizedSourceUrl = normalizeFaviconUrl(sourceUrl, origin);
    if (normalizedSourceUrl === null) {
      return;
    }
    const existing = faviconCacheIndex.records.find((entry) => entry.origin === origin);
    if (
      existing !== undefined
      && existing.sourceUrl === normalizedSourceUrl
      && existsSync(path.join(faviconCacheDir(storageRoot), existing.fileName))
    ) {
      return;
    }
    const cacheKey = `${origin}\n${normalizedSourceUrl}`;
    if (faviconCacheInFlight.has(cacheKey)) {
      return;
    }
    faviconCacheInFlight.add(cacheKey);
    void cacheFavicon(origin, normalizedSourceUrl, electronSession)
      .then((cached) => {
        if (cached) {
          publishSnapshot();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        faviconCacheInFlight.delete(cacheKey);
      });
  };

  const faviconUrlForSnapshot = (
    origin: string,
    sourceUrl: string | null | undefined,
    electronSession?: Session
  ): string | undefined => {
    const cachedUrl = cachedFaviconUrl(storageRoot, faviconCacheIndex, origin);
    if (cachedUrl !== null) {
      return cachedUrl;
    }
    const normalizedSourceUrl = normalizeFaviconUrl(sourceUrl, origin)
      ?? fallbackFaviconUrl(origin);
    queueFaviconCache(origin, normalizedSourceUrl, electronSession);
    return normalizedSourceUrl ?? undefined;
  };

  const snapshot = (): LoginManagerSnapshot => {
    const passwordsAvailable = isSafeStorageAvailable();
    const faviconSourceByOrigin = new Map(
      store.sessions.map((session) => [
        session.origin,
        normalizeFaviconUrl(faviconByOrigin.get(session.origin), session.origin)
          ?? normalizeFaviconUrl(session.faviconUrl, session.origin)
          ?? fallbackFaviconUrl(session.origin)
      ] as const)
    );
    const credentials = store.credentials.map((credential) => {
      const publicCredential = toPublicCredential(credential, passwordsAvailable);
      const sourceUrl = normalizeFaviconUrl(publicCredential.faviconUrl, publicCredential.origin)
        ?? faviconSourceByOrigin.get(publicCredential.origin)
        ?? fallbackFaviconUrl(publicCredential.origin);
      const faviconUrl = faviconUrlForSnapshot(publicCredential.origin, sourceUrl);
      return faviconUrl === undefined
        ? publicCredential
        : { ...publicCredential, faviconUrl };
    });
    const sessions = store.sessions.map((session) => {
      const faviconUrl = faviconUrlForSnapshot(
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
      passwordsAvailable,
      ...(passwordsAvailable
        ? {}
        : { passwordStorageReason: "electron_safe_storage_unavailable" }),
      sessions,
      credentials
    };
  };

  const publishSnapshot = (): void => {
    const window = getWindow();
    if (window === null || window.isDestroyed()) {
      return;
    }
    const event: LoginManagerEvent = {
      kind: "snapshot",
      snapshot: snapshot()
    };
    window.webContents.send(LYRA_CHANNELS.loginManagerEvent, event);
  };

  const upsertSession = (
    origin: string,
    patch: {
      readonly address?: string;
      readonly title?: string;
      readonly faviconUrl?: string;
      readonly accountHint?: string;
      readonly signals?: Partial<LoginManagerSessionSignals>;
      readonly authMethod?: LoginManagerAuthMethod;
    }
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

  const observePage = async (
    tabId: string,
    webContents: WebContents,
    url = webContents.getURL()
  ): Promise<void> => {
    const origin = normalizeOrigin(url);
    if (origin === null || webContents.isDestroyed()) {
      return;
    }
    const previousOrigin = activeOriginByTab.get(tabId);
    const authHint = inferAuthProvider(url);
    if (authHint !== null && previousOrigin !== undefined && previousOrigin !== origin) {
      upsertSession(previousOrigin, {
        authMethod: authHint,
        signals: { oauthHint: authHint.label }
      });
    }
    activeOriginByTab.set(tabId, origin);

    const cookieCount = await webContents.session.cookies
      .get({ url: origin })
      .then((cookies) => cookies.length)
      .catch(() => 0);
    const storageObserved = await webContents.executeJavaScript(
      `(() => {
        try {
          return Boolean(
            (window.localStorage && window.localStorage.length > 0)
            || (window.sessionStorage && window.sessionStorage.length > 0)
          );
        } catch (_error) {
          return false;
        }
      })()`,
      true
    ).then((value) => value === true).catch(() => false);

    const pageFaviconUrl = await readPageFaviconUrl(webContents, origin);
    if (pageFaviconUrl !== null) {
      faviconByOrigin.set(origin, pageFaviconUrl);
      queueFaviconCache(origin, pageFaviconUrl, webContents.session);
    }
    const pageTitle = normalizeString(webContents.getTitle());
    const faviconUrl = faviconByOrigin.get(origin)
      ?? fallbackFaviconUrl(origin)
      ?? undefined;
    upsertSession(origin, {
      address: url,
      ...(faviconUrl === undefined ? {} : { faviconUrl }),
      ...(pageTitle === null ? {} : { title: pageTitle }),
      signals: {
        cookieCount,
        storageObserved
      }
    });
    publishSnapshot();
  };

  const injectObserver = (tabId: string, webContents: WebContents): void => {
    if (webContents.isDestroyed()) {
      return;
    }
    const origin = normalizeOrigin(webContents.getURL());
    if (origin === null) {
      return;
    }
    const credentials = snapshot().credentials
      .filter((credential) => credential.origin === origin && credential.passwordAvailable)
      .map((credential) => ({
        id: credential.id,
        username: credential.username
      }));
    void webContents.executeJavaScript(buildObserverScript(credentials), true)
      .catch(() => undefined);
  };

  const recordCredentialSubmit = (
    payload: LoginCapturePayload,
    webContents: WebContents
  ): void => {
    const origin = normalizeOrigin(payload.url);
    const currentOrigin = normalizeOrigin(webContents.getURL());
    const username = normalizeString(payload.username);
    if (origin === null || currentOrigin !== origin || username === null) {
      return;
    }
    const passwordCiphertextBase64 = encryptPassword(payload.password);
    const id = credentialIdFor(origin, username);
    const timestamp = nowIso();
    const existing = store.credentials.find((entry) => entry.id === id);
    const faviconUrl = faviconByOrigin.get(origin)
      ?? store.sessions.find((entry) => entry.origin === origin)?.faviconUrl;
    queueFaviconCache(origin, faviconUrl, webContents.session);
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
    injectObserver(
      [...attachedTabs.entries()].find(([, entry]) => entry.webContents === webContents)?.[0] ?? "",
      webContents
    );
    publishSnapshot();
  };

  const parseBridgePayload = (message: string): LoginBridgePayload | null => {
    if (message.startsWith(CONSOLE_BRIDGE_PREFIX) === false) {
      return null;
    }
    try {
      const parsed = JSON.parse(message.slice(CONSOLE_BRIDGE_PREFIX.length)) as Partial<LoginBridgePayload>;
      if (
        parsed.type === "credential-submit"
        && typeof parsed.url === "string"
        && typeof parsed.username === "string"
        && typeof parsed.password === "string"
      ) {
        return parsed as LoginCapturePayload;
      }
      if (parsed.type === "fill-request" && typeof parsed.credentialId === "string") {
        return parsed as FillRequestPayload;
      }
    } catch (_error) {
      return null;
    }
    return null;
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

  const findTabForFill = (
    request: LoginManagerFillCredentialRequest,
    credential: StoredCredential
  ): AttachedTab | null => {
    const tabId = normalizeString(request.tabId);
    if (tabId !== null) {
      return attachedTabs.get(tabId) ?? null;
    }
    for (const entry of attachedTabs.values()) {
      if (normalizeOrigin(entry.webContents.getURL()) === credential.origin) {
        return entry;
      }
    }
    return null;
  };

  const fillCredential = async (
    request: LoginManagerFillCredentialRequest
  ): Promise<LoginManagerFillCredentialResponse> => {
    const credential = findCredentialForFill(request);
    if (credential === null || credential.passwordCiphertextBase64 === undefined) {
      return {
        filled: false,
        message: "No available saved credential matched the request."
      };
    }
    const tab = findTabForFill(request, credential);
    if (tab === null || tab.webContents.isDestroyed()) {
      return {
        filled: false,
        origin: credential.origin,
        username: credential.username,
        message: "No matching Lyra browser tab is available for filling."
      };
    }
    const password = decryptPassword(credential.passwordCiphertextBase64);
    const result = await tab.webContents.executeJavaScript(
      buildFillScript(credential.username, password),
      true
    ).catch((error: unknown) => ({
      filled: false,
      reason: error instanceof Error ? error.message : String(error)
    }));
    const filled =
      result !== null
      && typeof result === "object"
      && (result as { readonly filled?: unknown }).filled === true;
    if (filled) {
      const timestamp = nowIso();
      store = {
        ...store,
        credentials: store.credentials.map((entry) =>
          entry.id === credential.id
            ? { ...entry, lastUsedAt: timestamp, updatedAt: timestamp }
            : entry
        )
      };
      save();
      publishSnapshot();
    }
    return {
      filled,
      tabId: tab.tabId,
      origin: credential.origin,
      username: credential.username,
      ...(filled ? {} : { message: "Login form was not found on the current page." })
    };
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

  const clearSite = async (
    request: LoginManagerClearSiteRequest
  ): Promise<LoginManagerClearSiteResponse> => {
    const origin = resolveClearOrigin(request);
    let cookiesRemoved = 0;
    let storageCleared = false;
    const sessions = electronSessions.size > 0 ? [...electronSessions] : [];
    for (const electronSession of sessions) {
      const cookies = await electronSession.cookies.get({ url: origin }).catch(() => []);
      for (const cookie of cookies) {
        await electronSession.cookies.remove(origin, cookie.name)
          .then(() => {
            cookiesRemoved += 1;
          })
          .catch(() => undefined);
      }
      await electronSession.clearStorageData({
        origin,
        storages: [
          "cookies",
          "localstorage",
          "indexdb",
          "cachestorage",
          "serviceworkers",
          "websql"
        ]
      }).then(() => {
        storageCleared = true;
      }).catch(() => undefined);
    }
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
    publishSnapshot();
    return {
      cleared: true,
      origin,
      hostname: hostnameFromOrigin(origin),
      cookiesRemoved,
      storageCleared
    };
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
    publishSnapshot();
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
    publishSnapshot();
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
      password: decryptPassword(credential.passwordCiphertextBase64)
    };
  };

  const attachWebContents = (tabId: string, webContents: WebContents): (() => void) => {
    attachedTabs.set(tabId, { tabId, webContents });
    electronSessions.add(webContents.session);

    const onNavigate = (_event: unknown, url: string): void => {
      void observePage(tabId, webContents, url).finally(() => {
        injectObserver(tabId, webContents);
      });
    };
    const onStopLoading = (): void => {
      void observePage(tabId, webContents).finally(() => {
        injectObserver(tabId, webContents);
      });
    };
    const onFaviconUpdated = (_event: unknown, favicons: readonly unknown[]): void => {
      const origin = normalizeOrigin(webContents.getURL());
      if (origin === null) {
        return;
      }
      const faviconUrl = favicons
        .map((candidate) => normalizeFaviconUrl(candidate, origin))
        .find((candidate): candidate is string => candidate !== null);
      if (faviconUrl === undefined) {
        return;
      }
      faviconByOrigin.set(origin, faviconUrl);
      queueFaviconCache(origin, faviconUrl, webContents.session);
      const pageTitle = normalizeString(webContents.getTitle());
      upsertSession(origin, {
        address: webContents.getURL(),
        faviconUrl,
        ...(pageTitle === null ? {} : { title: pageTitle })
      });
      store = {
        ...store,
        credentials: store.credentials.map((credential) =>
          credential.origin === origin
            ? { ...credential, faviconUrl }
            : credential
        )
      };
      save();
      publishSnapshot();
    };
    const onConsoleMessage = (_event: unknown, _level: unknown, message: string): void => {
      const payload = parseBridgePayload(message);
      if (payload === null) {
        return;
      }
      if (payload.type === "credential-submit") {
        recordCredentialSubmit(payload, webContents);
        return;
      }
      void fillCredential({
        credentialId: payload.credentialId,
        tabId
      }).catch(() => undefined);
    };

    webContents.on("did-navigate", onNavigate);
    webContents.on("did-navigate-in-page", onNavigate);
    webContents.on("did-stop-loading", onStopLoading);
    webContents.on("dom-ready", onStopLoading);
    webContents.on("page-favicon-updated", onFaviconUpdated);
    webContents.on("console-message", onConsoleMessage);

    return () => {
      attachedTabs.delete(tabId);
      activeOriginByTab.delete(tabId);
      if (webContents.isDestroyed() === false) {
        webContents.off("did-navigate", onNavigate);
        webContents.off("did-navigate-in-page", onNavigate);
        webContents.off("did-stop-loading", onStopLoading);
        webContents.off("dom-ready", onStopLoading);
        webContents.off("page-favicon-updated", onFaviconUpdated);
        webContents.off("console-message", onConsoleMessage);
      }
    };
  };

  ipcMain.handle(LYRA_CHANNELS.loginManagerList, () => snapshot());
  ipcMain.handle(LYRA_CHANNELS.loginManagerUpdateSession, (_event, request: unknown) =>
    updateSession(request as LoginManagerUpdateSessionRequest));
  ipcMain.handle(LYRA_CHANNELS.loginManagerDeleteCredential, (_event, request: unknown) =>
    deleteCredential(request as LoginManagerDeleteCredentialRequest));
  ipcMain.handle(LYRA_CHANNELS.loginManagerRevealCredential, (_event, request: unknown) =>
    revealCredential(request as LoginManagerRevealCredentialRequest));
  ipcMain.handle(LYRA_CHANNELS.loginManagerFillCredential, async (_event, request: unknown) =>
    await fillCredential(request as LoginManagerFillCredentialRequest));
  ipcMain.handle(LYRA_CHANNELS.loginManagerClearSite, async (_event, request: unknown) =>
    await clearSite(request as LoginManagerClearSiteRequest));

  for (const session of store.sessions) {
    queueFaviconCache(
      session.origin,
      normalizeFaviconUrl(session.faviconUrl, session.origin) ?? fallbackFaviconUrl(session.origin)
    );
  }
  for (const credential of store.credentials) {
    queueFaviconCache(
      credential.origin,
      normalizeFaviconUrl(credential.faviconUrl, credential.origin)
        ?? store.sessions.find((session) => session.origin === credential.origin)?.faviconUrl
        ?? fallbackFaviconUrl(credential.origin)
    );
  }

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerList);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerUpdateSession);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerDeleteCredential);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerRevealCredential);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerFillCredential);
      ipcMain.removeHandler(LYRA_CHANNELS.loginManagerClearSite);
      attachedTabs.clear();
      electronSessions.clear();
      activeOriginByTab.clear();
      faviconCacheInFlight.clear();
    },
    attachWebContents,
    list: snapshot,
    updateSession,
    deleteCredential,
    revealCredential,
    fillCredential,
    clearSite
  };
};
