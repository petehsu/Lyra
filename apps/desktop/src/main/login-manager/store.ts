import path from "node:path";

import type {
  LoginManagerCredential,
  LoginManagerSession
} from "../../shared/desktop-bridge";
import {
  quarantineCorruptFileSync,
  readJsonFileSync,
  writeFileAtomicSync
} from "../persistence";

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
  const parsed = readJsonFileSync(filePath, "lyra-login-manager") as Partial<LoginManagerStore> | null;
  if (parsed === null) {
    return emptyLoginManagerStore();
  }
  if (
    parsed.version !== STORE_VERSION
    || Array.isArray(parsed.sessions) === false
    || Array.isArray(parsed.credentials) === false
  ) {
    quarantineCorruptFileSync(filePath, "invalid login manager store schema", "lyra-login-manager");
    return emptyLoginManagerStore();
  }
  return {
    version: STORE_VERSION,
    sessions: parsed.sessions,
    credentials: parsed.credentials.map(sanitizeStoredCredential)
  };
};

export const writeLoginManagerStore = (
  storageRoot: string,
  store: LoginManagerStore
): void => {
  writeFileAtomicSync(path.join(storageRoot, STORE_FILE_NAME), JSON.stringify(store, null, 2));
};
