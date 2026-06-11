import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  LoginManagerCredential,
  LoginManagerSession
} from "../../shared/desktop-bridge";

export const STORE_VERSION = 1 as const;
export const STORE_FILE_NAME = "login-manager.v1.json";

export type StoredCredential = Omit<
  LoginManagerCredential,
  "hasPassword" | "passwordAvailable" | "passwordRef"
> & {
  readonly passwordCiphertextBase64?: string;
};

export type LoginManagerStore = {
  readonly version: 1;
  readonly sessions: readonly LoginManagerSession[];
  readonly credentials: readonly StoredCredential[];
};

export const emptyLoginManagerStore = (): LoginManagerStore => ({
  version: STORE_VERSION,
  sessions: [],
  credentials: []
});

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

export const readLoginManagerStore = (storageRoot: string): LoginManagerStore => {
  const filePath = path.join(storageRoot, STORE_FILE_NAME);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<LoginManagerStore>;
    if (
      parsed.version !== STORE_VERSION
      || Array.isArray(parsed.sessions) === false
      || Array.isArray(parsed.credentials) === false
    ) {
      return emptyLoginManagerStore();
    }
    return {
      version: STORE_VERSION,
      sessions: parsed.sessions,
      credentials: parsed.credentials.map(sanitizeStoredCredential)
    };
  } catch (_error) {
    return emptyLoginManagerStore();
  }
};

export const writeLoginManagerStore = (
  storageRoot: string,
  store: LoginManagerStore
): void => {
  mkdirSync(storageRoot, { recursive: true });
  writeFileSync(
    path.join(storageRoot, STORE_FILE_NAME),
    JSON.stringify(store, null, 2),
    "utf8"
  );
};
