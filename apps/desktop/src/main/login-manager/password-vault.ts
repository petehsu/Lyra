import { safeStorage } from "electron";

import type { LoginManagerCredential } from "../../shared/desktop-bridge";
import { createLoginManagerPasswordRef } from "../../shared/sensitive-value";
import type { StoredCredential } from "./store";

export type LoginManagerPasswordVault = {
  readonly isAvailable: () => boolean;
  readonly encryptPassword: (password: string) => string | null;
  readonly decryptPassword: (ciphertextBase64: string) => string;
  readonly toPublicCredential: (
    credential: StoredCredential,
    passwordsAvailable?: boolean
  ) => LoginManagerCredential;
};

export const createLoginManagerPasswordVault = (): LoginManagerPasswordVault => {
  const isAvailable = (): boolean => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch (_error) {
      return false;
    }
  };

  const encryptPassword = (password: string): string | null => {
    if (isAvailable() === false) {
      return null;
    }
    return safeStorage.encryptString(password).toString("base64");
  };

  const decryptPassword = (ciphertextBase64: string): string => {
    if (isAvailable() === false) {
      throw new Error("Password storage is unavailable on this system.");
    }
    return safeStorage.decryptString(Buffer.from(ciphertextBase64, "base64"));
  };

  const toPublicCredential = (
    credential: StoredCredential,
    passwordsAvailable = isAvailable()
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

  return {
    isAvailable,
    encryptPassword,
    decryptPassword,
    toPublicCredential
  };
};
