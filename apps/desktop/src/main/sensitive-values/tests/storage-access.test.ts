import { describe, expect, test, vi } from "vitest";
import { createSensitiveStorageAccess } from "../storage-access";

const mockStorage = () => ({
  isEncryptionAvailable: vi.fn(() => true),
  getSelectedStorageBackend: vi.fn((): ReturnType<Electron.SafeStorage["getSelectedStorageBackend"]> => "gnome_libsecret"),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString().replace(/^encrypted:/u, ""))
});

describe("credential encryption failures", () => {
  test("reports capability metadata without credentials", () => {
    const storage = mockStorage();
    const access = createSensitiveStorageAccess(storage, undefined, "linux");
    expect(access.readStatus()).toEqual({ available: true, backend: "gnome_libsecret" });
    expect(storage.decryptString).not.toHaveBeenCalled();
    expect(storage.encryptString).not.toHaveBeenCalled();
  });

  test("notification delivery cannot break a successful credential operation", () => {
    const storage = mockStorage();
    const access = createSensitiveStorageAccess(storage, () => { throw new Error("window closed"); }, "linux");
    expect(access.decrypt(access.encrypt("fixture"))).toBe("fixture");
  });

  test.each([false, true])("refuses basic_text even when isEncryptionAvailable is %s", available => {
    const storage = mockStorage();
    storage.getSelectedStorageBackend.mockReturnValue("basic_text");
    storage.isEncryptionAvailable.mockReturnValue(available);
    const access = createSensitiveStorageAccess(storage, undefined, "linux");
    expect(() => access.encrypt("private-token")).toThrow("System credential storage is unavailable");
    expect(() => access.decrypt("ciphertext")).toThrow("System credential storage is unavailable");
    expect(storage.encryptString).not.toHaveBeenCalled();
    expect(storage.decryptString).not.toHaveBeenCalled();
  });

  test("deduplicates failure events and reports recovery after a successful operation", () => {
    const storage = mockStorage();
    const notify = vi.fn();
    const access = createSensitiveStorageAccess(storage, notify, "linux");
    storage.isEncryptionAvailable.mockReturnValue(false);
    for (let i = 0; i < 3; i++) expect(() => access.decrypt("ciphertext")).toThrow("keyring");
    expect(notify).toHaveBeenCalledTimes(1);
    storage.isEncryptionAvailable.mockReturnValue(true);
    expect(access.decrypt(Buffer.from("encrypted:secret").toString("base64"))).toBe("secret");
    expect(notify).toHaveBeenLastCalledWith({ available: true, backend: "gnome_libsecret" });
    expect(JSON.stringify(notify.mock.calls)).not.toContain('"secret"');
  });

  test("preserves ciphertext and hides native error contents when the original key is missing", () => {
    const storage = mockStorage();
    storage.decryptString.mockImplementation(() => { throw new Error("native error containing private-token"); });
    const notify = vi.fn();
    const access = createSensitiveStorageAccess(storage, notify, "linux");
    expect(() => access.decrypt("c2F2ZWQ=")).toThrow("Restore the original keyring");
    expect(() => access.decrypt("c2F2ZWQ=")).not.toThrow("private-token");
    expect(notify).toHaveBeenCalledWith({ available: true, backend: "gnome_libsecret", issue: "decryption-failed" });
    expect(storage.encryptString).not.toHaveBeenCalled();
  });

  test("handles a keyring disappearing between the availability check and encryption", () => {
    const storage = mockStorage();
    storage.encryptString.mockImplementation(() => { throw new Error("native secret detail"); });
    const notify = vi.fn();
    const access = createSensitiveStorageAccess(storage, notify, "linux");
    expect(() => access.encrypt("private-token")).toThrow("The value was not saved");
    expect(notify).toHaveBeenCalledWith({ available: false, backend: "gnome_libsecret", issue: "unavailable" });
  });

  test.each([["darwin", "keychain"], ["win32", "dpapi"]] as const)("keeps %s native encryption", (platform, backend) => {
    const storage = mockStorage();
    const access = createSensitiveStorageAccess(storage, undefined, platform);
    expect(access.readStatus()).toEqual({ available: true, backend });
    expect(storage.getSelectedStorageBackend).not.toHaveBeenCalled();
  });
});
