import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

import {
  LYRA_CHANNELS
} from "../../shared/desktop-bridge";
import type {
  AuthLocalePreference,
  AuthLocalIdentity,
  AuthProfile,
  AuthProfileUpdate,
  AuthSnapshot,
  AuthUser
} from "../../shared/auth";
import { LYRA_AUTH_REDIRECT_URI, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";
import {
  resolveLocalIdentity,
  type CachedLocalIdentity
} from "./local-identity";

const AUTH_STORAGE_DIR = join(homedir(), ".lyra", "auth");
const AUTH_SESSION_PATH = join(AUTH_STORAGE_DIR, "session.json");
const AUTH_LOCAL_IDENTITY_PATH = join(AUTH_STORAGE_DIR, "local-identity.json");
const DEV_AUTH_REDIRECT_URI = "http://localhost:3000";

type StoredSession = {
  readonly ciphertextBase64: string;
};

type AuthIpcBridgeParams = {
  readonly getWindow: () => BrowserWindow | null;
};

export type AuthIpcBridge = {
  readonly dispose: () => void;
  readonly handleCallback: (url: string) => Promise<void>;
  readonly getSnapshot: () => Promise<AuthSnapshot>;
};

const isLocalePreference = (value: unknown): value is AuthLocalePreference => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as { readonly mode?: unknown; readonly locale?: unknown };
  return record.mode === "system"
    || (record.mode === "explicit" && typeof record.locale === "string");
};

const safeTrim = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readGitValue = (args: readonly string[]): string | undefined => {
  try {
    return safeTrim(execFileSync("git", [...args], {
      timeout: 3000,
      encoding: "utf-8"
    }));
  } catch {
    return undefined;
  }
};

const readLocalGitValue = (key: "user.name" | "user.email"): string | undefined =>
  readGitValue(["config", "--get", key])
  ?? readGitValue(["config", "--global", "--get", key]);

const readSystemUserName = (): string | undefined => {
  try {
    return safeTrim(userInfo().username)
      ?? safeTrim(process.env.USER)
      ?? safeTrim(process.env.USERNAME);
  } catch {
    return safeTrim(process.env.USER) ?? safeTrim(process.env.USERNAME);
  }
};

const readLocalDisplayName = (): string =>
  readLocalGitValue("user.name")
  ?? readSystemUserName()
  ?? "Lyra";

const readStoredSession = (): Session | null => {
  if (!existsSync(AUTH_SESSION_PATH) || !safeStorage.isEncryptionAvailable()) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(AUTH_SESSION_PATH, "utf8")) as Partial<StoredSession>;
    if (typeof parsed.ciphertextBase64 !== "string") {
      return null;
    }
    const json = safeStorage.decryptString(
      Buffer.from(parsed.ciphertextBase64, "base64")
    );
    const session = JSON.parse(json) as Session;
    return typeof session.access_token === "string"
      && typeof session.refresh_token === "string"
      ? session
      : null;
  } catch {
    return null;
  }
};

const writeStoredSession = (session: Session | null): void => {
  if (session === null) {
    try {
      unlinkSync(AUTH_SESSION_PATH);
    } catch {
      // The session is already absent.
    }
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure session storage is unavailable.");
  }
  mkdirSync(AUTH_STORAGE_DIR, { recursive: true });
  const ciphertextBase64 = safeStorage.encryptString(JSON.stringify(session)).toString("base64");
  writeFileSync(
    AUTH_SESSION_PATH,
    `${JSON.stringify({ ciphertextBase64 } satisfies StoredSession)}\n`,
    { mode: 0o600 }
  );
};

const readStoredLocalIdentity = (): CachedLocalIdentity | null => {
  if (!existsSync(AUTH_LOCAL_IDENTITY_PATH) || !safeStorage.isEncryptionAvailable()) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      readFileSync(AUTH_LOCAL_IDENTITY_PATH, "utf8")
    ) as Partial<StoredSession>;
    if (typeof parsed.ciphertextBase64 !== "string") {
      return null;
    }
    const decrypted = safeStorage.decryptString(
      Buffer.from(parsed.ciphertextBase64, "base64")
    );
    const value = JSON.parse(decrypted) as Partial<CachedLocalIdentity>;
    const email = safeTrim(value.email);
    if (email === undefined) {
      return null;
    }
    const displayName = safeTrim(value.displayName);
    const avatarUrl = safeTrim(value.avatarUrl);
    return {
      email,
      ...(displayName === undefined ? {} : { displayName }),
      ...(avatarUrl === undefined ? {} : { avatarUrl })
    };
  } catch {
    return null;
  }
};

const writeStoredLocalIdentity = (identity: CachedLocalIdentity): void => {
  const email = safeTrim(identity.email);
  if (email === undefined || !safeStorage.isEncryptionAvailable()) {
    return;
  }
  const displayName = safeTrim(identity.displayName);
  const avatarUrl = safeTrim(identity.avatarUrl);
  const plaintext = JSON.stringify({
    email,
    ...(displayName === undefined ? {} : { displayName }),
    ...(avatarUrl === undefined ? {} : { avatarUrl })
  } satisfies CachedLocalIdentity);
  mkdirSync(AUTH_STORAGE_DIR, { recursive: true });
  const ciphertextBase64 = safeStorage.encryptString(plaintext).toString("base64");
  writeFileSync(
    AUTH_LOCAL_IDENTITY_PATH,
    `${JSON.stringify({ ciphertextBase64 } satisfies StoredSession)}\n`,
    { mode: 0o600 }
  );
};

const writeStoredUserIdentity = (
  user: AuthUser,
  profile: AuthProfile | null
): void => {
  if (user.email === undefined) {
    return;
  }
  const displayName = profile?.displayName ?? user.displayName;
  const avatarUrl = profile?.avatarUrl ?? user.avatarUrl;
  writeStoredLocalIdentity({
    email: user.email,
    ...(displayName === undefined ? {} : { displayName }),
    ...(avatarUrl === undefined ? {} : { avatarUrl })
  });
};

const toAuthUser = (user: {
  readonly id: string;
  readonly email?: string | null;
  readonly user_metadata?: Record<string, unknown>;
}): AuthUser => {
  const email = safeTrim(user.email);
  const displayName = safeTrim(user.user_metadata?.full_name ?? user.user_metadata?.name);
  const avatarUrl = safeTrim(user.user_metadata?.avatar_url ?? user.user_metadata?.picture);
  return {
    id: user.id,
    ...(email === undefined ? {} : { email }),
    ...(displayName === undefined ? {} : { displayName }),
    ...(avatarUrl === undefined ? {} : { avatarUrl })
  };
};

const toAuthProfile = (value: unknown): AuthProfile | null => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string"
    || !isLocalePreference(record.locale_preference)
    || typeof record.theme_preference !== "string"
    || typeof record.onboarding_completed !== "boolean"
    || typeof record.onboarding_version !== "number"
  ) {
    return null;
  }
  const displayName = safeTrim(record.display_name);
  const avatarUrl = safeTrim(record.avatar_url);
  return {
    id: record.id,
    ...(displayName === undefined ? {} : { displayName }),
    ...(avatarUrl === undefined ? {} : { avatarUrl }),
    localePreference: record.locale_preference,
    themePreference: record.theme_preference,
    onboardingCompleted: record.onboarding_completed,
    onboardingVersion: record.onboarding_version
  };
};

const createPkceStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    clear: () => {
      values.clear();
    },
    get length() {
      return values.size;
    },
    key: (index) => Array.from(values.keys())[index] ?? null
  };
};

const validateAuthorizationRedirect = (
  authorizationUrl: string,
  expectedRedirectUri: string
): void => {
  const url = new URL(authorizationUrl);
  const redirectTo = url.searchParams.get("redirect_to");
  if (redirectTo === expectedRedirectUri) {
    return;
  }
  throw new Error(
    `Google authorization is using "${redirectTo ?? "an unknown callback"}" instead of "${expectedRedirectUri}".`
  );
};

export const createAuthIpcBridge = ({
  getWindow
}: AuthIpcBridgeParams): AuthIpcBridge => {
  const configured = SUPABASE_ANON_KEY.length > 0;
  const listeners = new Set<(snapshot: AuthSnapshot) => void>();
  const pkceStorage = createPkceStorage();
  const client: SupabaseClient | null = configured
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: "pkce",
          persistSession: false,
          storage: pkceStorage
        }
      })
    : null;

  let currentSession: Session | null = null;
  let currentProfile: AuthProfile | null = null;
  let currentError: string | undefined;
  let disposed = false;
  let hydrationPromise: Promise<void> = Promise.resolve();
  let devCallbackServer: Server | null = null;
  let devCallbackServerStart: Promise<void> | null = null;

  const readProfile = async (userId: string): Promise<AuthProfile | null> => {
    if (client === null) {
      return null;
    }
    const result = await client
      .from("profiles")
      .select("id,display_name,avatar_url,locale_preference,theme_preference,onboarding_completed,onboarding_version")
      .eq("id", userId)
      .maybeSingle();
    if (result.error) {
      console.warn(`[lyra-auth] profile read failed: ${result.error.message}`);
      return null;
    }
    return toAuthProfile(result.data);
  };

  const snapshot = (): AuthSnapshot => ({
    configured,
    user: currentSession?.user === undefined ? null : toAuthUser(currentSession.user),
    profile: currentProfile,
    ...(currentError === undefined ? {} : { error: currentError })
  });

  const publish = (): void => {
    if (disposed) {
      return;
    }
    const next = snapshot();
    const window = getWindow();
    if (window !== null && !window.isDestroyed()) {
      window.webContents.send(LYRA_CHANNELS.authEvent, next);
    }
    listeners.forEach((listener) => listener(next));
  };

  const hydrate = async (): Promise<void> => {
    if (client === null) {
      return;
    }
    const stored = readStoredSession();
    if (stored === null) {
      return;
    }
    const result = await client.auth.setSession({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token
    });
    if (result.error || result.data.session === null) {
      writeStoredSession(null);
      return;
    }
    currentSession = result.data.session;
    currentProfile = await readProfile(currentSession.user.id);
    writeStoredUserIdentity(toAuthUser(currentSession.user), currentProfile);
  };

  const persistSession = async (session: Session | null): Promise<void> => {
    currentError = undefined;
    currentSession = session;
    if (session === null) {
      currentProfile = null;
      writeStoredSession(null);
      publish();
      return;
    }
    writeStoredSession(session);
    currentProfile = await readProfile(session.user.id);
    writeStoredUserIdentity(toAuthUser(session.user), currentProfile);
    publish();
  };

  const ensureDevCallbackServer = async (
    onCallback: (url: string) => Promise<void>
  ): Promise<void> => {
    if (app.isPackaged || devCallbackServer?.listening === true) {
      return;
    }
    if (devCallbackServerStart !== null) {
      return devCallbackServerStart;
    }

    devCallbackServerStart = new Promise<void>((resolve, reject) => {
      const server = createServer((request, response) => {
        const requestUrl = new URL(request.url ?? "/", DEV_AUTH_REDIRECT_URI);
        if (request.method !== "GET" || requestUrl.pathname !== "/") {
          response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }
        const callbackUrl = `${DEV_AUTH_REDIRECT_URI}${requestUrl.search}`;
        void onCallback(callbackUrl).then(
          () => {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            response.end(
              "<!doctype html><meta charset=\"utf-8\"><title>Lyra</title>" +
              "<p>授权已完成，请返回 Lyra。</p>"
            );
          },
          (error: unknown) => {
            response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
            response.end(`Lyra authorization failed: ${String(error)}`);
          }
        );
      });
      server.once("error", reject);
      server.listen(3000, "localhost", () => {
        devCallbackServer = server;
        resolve();
      });
    });

    try {
      await devCallbackServerStart;
    } finally {
      devCallbackServerStart = null;
    }
  };

  const startGoogleLogin = async (): Promise<{
    readonly started: boolean;
    readonly authorizationUrl: string;
  }> => {
    if (client === null) {
      throw new Error("Account service is unavailable. Please try again later.");
    }
    const redirectTo = app.isPackaged ? LYRA_AUTH_REDIRECT_URI : DEV_AUTH_REDIRECT_URI;
    if (!app.isPackaged) {
      await ensureDevCallbackServer((callbackUrl) => handleCallback(callbackUrl));
    }
    const result = await client.auth.signInWithOAuth({
      options: {
        queryParams: {
          access_type: "offline",
          prompt: "select_account"
        },
        redirectTo,
        skipBrowserRedirect: true
      },
      provider: "google"
    });
    if (result.error || result.data.url === undefined) {
      throw new Error(result.error?.message ?? "Google login could not be started.");
    }
    validateAuthorizationRedirect(result.data.url, redirectTo);
    await shell.openExternal(result.data.url);
    return { started: true, authorizationUrl: result.data.url };
  };

  const handleCallback = async (rawUrl: string): Promise<void> => {
    try {
      if (client === null) {
        throw new Error("Account service is unavailable.");
      }
      const url = new URL(rawUrl);
      const isDeepLinkCallback =
        url.protocol === "lyra:"
        && url.hostname === "auth"
        && url.pathname === "/callback";
      const isDevHttpCallback =
        !app.isPackaged
        && url.origin === DEV_AUTH_REDIRECT_URI
        && url.pathname === "/";
      if (!isDeepLinkCallback && !isDevHttpCallback) {
        return;
      }
      const errorDescription = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      if (errorDescription !== null) {
        throw new Error(errorDescription);
      }
      const code = url.searchParams.get("code");
      if (code === null || code.trim().length === 0) {
        throw new Error("Google login callback did not include an authorization code.");
      }
      const result = await client.auth.exchangeCodeForSession(code);
      if (result.error || result.data.session === null) {
        throw new Error(result.error?.message ?? "Google login could not be completed.");
      }
      await persistSession(result.data.session);
    } catch (error) {
      currentError = error instanceof Error ? error.message : String(error);
      publish();
      throw error;
    }
  };

  const updateProfile = async (update: AuthProfileUpdate): Promise<AuthProfile> => {
    if (client === null || currentSession === null) {
      throw new Error("A signed-in Supabase session is required.");
    }
    const user = toAuthUser(currentSession.user);
    const payload = {
      id: currentSession.user.id,
      display_name: update.displayName ?? user.displayName ?? null,
      avatar_url: update.avatarUrl ?? user.avatarUrl ?? null,
      locale_preference: update.localePreference ?? currentProfile?.localePreference ?? { mode: "system" },
      theme_preference: update.themePreference ?? currentProfile?.themePreference ?? "lyra-system",
      onboarding_completed: update.onboardingCompleted ?? currentProfile?.onboardingCompleted ?? false,
      onboarding_version: update.onboardingVersion ?? currentProfile?.onboardingVersion ?? 1
    };
    const result = await client.from("profiles").upsert(payload).select(
      "id,display_name,avatar_url,locale_preference,theme_preference,onboarding_completed,onboarding_version"
    ).single();
    if (result.error) {
      throw new Error(result.error.message);
    }
    const profile = toAuthProfile(result.data);
    if (profile === null) {
      throw new Error("Supabase returned an invalid profile.");
    }
    currentProfile = profile;
    writeStoredUserIdentity(user, profile);
    publish();
    return profile;
  };

  const getSnapshot = async (): Promise<AuthSnapshot> => {
    await hydrationPromise;
    if (client !== null && currentSession !== null) {
      currentProfile = await readProfile(currentSession.user.id);
    }
    return snapshot();
  };

  const getLocalIdentity = async (): Promise<AuthLocalIdentity> => {
    const displayName = readLocalDisplayName();
    const gitEmail = readLocalGitValue("user.email");
    return resolveLocalIdentity({
      displayName,
      ...(gitEmail === undefined ? {} : { gitEmail }),
      cached: readStoredLocalIdentity()
    });
  };

  const handleAuthStateChange = async (
    event: string,
    session: Session | null
  ): Promise<void> => {
    if (event === "SIGNED_OUT") {
      await persistSession(null);
      return;
    }
    if (session !== null && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED")) {
      await persistSession(session);
    }
  };

  if (client !== null) {
    hydrationPromise = hydrate();
    void hydrationPromise.then(() => publish()).catch((error: unknown) => {
      console.warn(`[lyra-auth] session hydration failed: ${String(error)}`);
    });
    client.auth.onAuthStateChange((event, session) => {
      void handleAuthStateChange(event, session).catch((error: unknown) => {
        console.warn(`[lyra-auth] auth state update failed: ${String(error)}`);
      });
    });
  }

  ipcMain.handle(LYRA_CHANNELS.authGetSession, getSnapshot);
  ipcMain.handle(LYRA_CHANNELS.authGetLocalIdentity, getLocalIdentity);
  ipcMain.handle(LYRA_CHANNELS.authStartGoogleLogin, startGoogleLogin);
  ipcMain.handle(LYRA_CHANNELS.authUpdateProfile, (_event, update: AuthProfileUpdate) =>
    updateProfile(update)
  );
  ipcMain.handle(LYRA_CHANNELS.authDeleteAccount, async (_event, confirmation: unknown) => {
    if (client === null || currentSession === null) {
      throw new Error("A signed-in Supabase session is required.");
    }
    if (confirmation !== "DELETE") {
      throw new Error("Account deletion confirmation did not match DELETE.");
    }
    const expectedUserId = currentSession.user.id;
    const response = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${currentSession.access_token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ confirmUserId: expectedUserId }),
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { readonly error?: unknown } | null;
      const detail = typeof payload?.error === "string"
        ? payload.error
        : `Account deletion failed with HTTP ${response.status}.`;
      throw new Error(detail);
    }
    await client.auth.signOut({ scope: "local" });
    await persistSession(null);
  });
  ipcMain.handle(LYRA_CHANNELS.authLogout, async () => {
    if (client !== null) {
      const result = await client.auth.signOut();
      if (result.error) {
        throw new Error(result.error.message);
      }
    }
    await persistSession(null);
  });

  return {
    dispose: () => {
      disposed = true;
      devCallbackServer?.close();
      devCallbackServer = null;
      ipcMain.removeHandler(LYRA_CHANNELS.authGetSession);
      ipcMain.removeHandler(LYRA_CHANNELS.authGetLocalIdentity);
      ipcMain.removeHandler(LYRA_CHANNELS.authStartGoogleLogin);
      ipcMain.removeHandler(LYRA_CHANNELS.authUpdateProfile);
      ipcMain.removeHandler(LYRA_CHANNELS.authDeleteAccount);
      ipcMain.removeHandler(LYRA_CHANNELS.authLogout);
      listeners.clear();
    },
    getSnapshot,
    handleCallback
  };
};
