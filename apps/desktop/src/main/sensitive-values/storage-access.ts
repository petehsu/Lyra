import type { LyraSensitiveStorageStatus } from "../../shared/sensitive-value";

type SafeStorage = Pick<Electron.SafeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString">
  & Partial<Pick<Electron.SafeStorage, "getSelectedStorageBackend">>;

export const createSensitiveStorageAccess = (
  safeStorage: SafeStorage,
  onStatus: (status: LyraSensitiveStorageStatus) => void = () => undefined,
  platform: NodeJS.Platform = process.platform
) => {
  let lastPublishedStatus = "";
  const publish = (status: LyraSensitiveStorageStatus): void => {
    const key = JSON.stringify(status);
    if (key === lastPublishedStatus) return;
    lastPublishedStatus = key;
    try {
      onStatus(status);
    } catch {
      // A renderer closing during notification delivery must not turn a
      // successful credential operation into a host-capability failure.
    }
  };
  const readStatus = (): LyraSensitiveStorageStatus => {
    let backend = platform === "darwin" ? "keychain" : platform === "win32" ? "dpapi" : "unknown";
    try {
      const available = safeStorage.isEncryptionAvailable();
      if (platform === "linux") backend = safeStorage.getSelectedStorageBackend?.() ?? "unknown";
      // Never opt into Chromium's hardcoded-password fallback, even if another
      // caller has enabled it. Credentials must remain protected by the OS.
      if (available && backend !== "basic_text") return { available: true, backend };
    } catch {
      // Diagnostics expose capability state only, never native error payloads.
    }
    return { available: false, backend, issue: "unavailable" };
  };
  const requireEncryption = (): LyraSensitiveStorageStatus => {
    const status = readStatus();
    if (!status.available) {
      publish(status);
      throw new Error("System credential storage is unavailable. Unlock your system keyring and restart Lyra. On Linux, ensure a Secret Service or KWallet is running. Saved credentials have been kept.");
    }
    return status;
  };
  return {
    readStatus,
    encrypt: (value: string): string => {
      const status = requireEncryption();
      let encrypted: string;
      try {
        encrypted = safeStorage.encryptString(value).toString("base64");
      } catch {
        publish({ ...status, available: false, issue: "unavailable" });
        throw new Error("System credential storage could not encrypt this value. Unlock your system keyring and retry. The value was not saved.");
      }
      publish(status);
      return encrypted;
    },
    decrypt: (ciphertextBase64: string): string => {
      const status = requireEncryption();
      let value: string;
      try {
        value = safeStorage.decryptString(Buffer.from(ciphertextBase64, "base64"));
      } catch {
        publish({ ...status, issue: "decryption-failed" });
        throw new Error("This saved credential could not be decrypted with the current system keyring. Restore the original keyring or re-enter this credential in settings. The saved value has been kept.");
      }
      publish(status);
      return value;
    }
  };
};
