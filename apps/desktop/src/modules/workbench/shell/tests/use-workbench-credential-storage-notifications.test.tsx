import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { LyraSensitiveStorageStatus } from "../../../../shared/desktop-bridge";
import { useWorkbenchCredentialStorageNotifications } from "../use-workbench-credential-storage-notifications";

const healthy: LyraSensitiveStorageStatus = { available: true, backend: "gnome_libsecret" };
const unavailable: LyraSensitiveStorageStatus = { available: false, backend: "basic_text", issue: "unavailable" };
const setup = (initial: Promise<LyraSensitiveStorageStatus>) => {
  const publishNotification = vi.fn();
  let listener: ((status: LyraSensitiveStorageStatus) => void) | undefined;
  const unsubscribe = vi.fn(() => { listener = undefined; });
  const api = {
    readStatus: vi.fn(() => initial),
    onStatusChanged: (handler: (status: LyraSensitiveStorageStatus) => void) => {
      listener = handler;
      return unsubscribe;
    }
  };
  const hook = renderHook(() => useWorkbenchCredentialStorageNotifications({
    desktopApi: { sensitiveValues: api } as never,
    publishNotification,
    t: ((key: string) => key) as never
  }));
  return { ...hook, publishNotification, unsubscribe, emit: (status: LyraSensitiveStorageStatus) => act(() => listener?.(status)) };
};

describe("credential storage unified notifications", () => {
  test("stays quiet on a healthy startup", async () => {
    const testCase = setup(Promise.resolve(healthy));
    await act(async () => {});
    expect(testCase.publishNotification).not.toHaveBeenCalled();
  });

  test("publishes one actionable error and a recovery update through the existing publisher", async () => {
    const testCase = setup(Promise.resolve(unavailable));
    await waitFor(() => expect(testCase.publishNotification).toHaveBeenCalledTimes(1));
    expect(testCase.publishNotification).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "credential-storage-status", level: "error",
      body: "notification.credentialStorageUnavailableLinuxBody"
    }));
    testCase.emit(unavailable);
    expect(testCase.publishNotification).toHaveBeenCalledTimes(1);
    testCase.emit(healthy);
    expect(testCase.publishNotification).toHaveBeenLastCalledWith(expect.objectContaining({
      id: "credential-storage-status", level: "success"
    }));
  });

  test("distinguishes a missing original encryption key from an unavailable service", async () => {
    const testCase = setup(Promise.resolve(healthy));
    await act(async () => {});
    testCase.emit({ ...healthy, issue: "decryption-failed" });
    expect(testCase.publishNotification).toHaveBeenLastCalledWith(expect.objectContaining({
      body: "notification.credentialStorageDecryptFailedBody", level: "error"
    }));
    testCase.emit(healthy);
    expect(testCase.publishNotification).toHaveBeenCalledTimes(1);
  });

  test("does not let a stale startup read overwrite a runtime failure", async () => {
    let finish!: (status: LyraSensitiveStorageStatus) => void;
    const testCase = setup(new Promise(resolve => { finish = resolve; }));
    testCase.emit(unavailable);
    await act(async () => finish(healthy));
    expect(testCase.publishNotification).toHaveBeenCalledTimes(1);
  });

  test("unsubscribes and ignores late reads after unmount", async () => {
    let finish!: (status: LyraSensitiveStorageStatus) => void;
    const testCase = setup(new Promise(resolve => { finish = resolve; }));
    testCase.unmount();
    await act(async () => finish(unavailable));
    expect(testCase.unsubscribe).toHaveBeenCalledOnce();
    expect(testCase.publishNotification).not.toHaveBeenCalled();
  });

  test("does not misreport an IPC failure as a keyring failure", async () => {
    const testCase = setup(Promise.reject(new Error("bridge disconnected")));
    await act(async () => {});
    expect(testCase.publishNotification).not.toHaveBeenCalled();
  });
});
