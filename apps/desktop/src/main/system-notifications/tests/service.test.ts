import { beforeEach, describe, expect, test, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class MockNotification {
    static instances: MockNotification[] = [];
    static supported = true;
    static isSupported = vi.fn(() => MockNotification.supported);

    readonly listeners = new Map<string, Listener[]>();
    readonly options: unknown;
    readonly show = vi.fn();
    readonly close = vi.fn();

    constructor(options: unknown) {
      this.options = options;
      MockNotification.instances.push(this);
    }

    on(event: string, listener: Listener): this {
      const current = this.listeners.get(event) ?? [];
      current.push(listener);
      this.listeners.set(event, current);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
  }

  return {
    MockNotification,
    ipcMain: {
      handle: vi.fn(),
      removeHandler: vi.fn()
    },
    shell: {
      openExternal: vi.fn()
    }
  };
});

vi.mock("electron", () => ({
  BrowserWindow: {},
  Notification: electronMock.MockNotification,
  ipcMain: electronMock.ipcMain,
  shell: electronMock.shell
}));

import { LYRA_CHANNELS } from "../../../shared/desktop-bridge";
import {
  buildWindowsToastXmlForTests,
  createSystemNotificationsIpcBridge,
  normalizeSystemNotificationRequestForTests,
  openSystemNotificationSettingsForTests,
  shouldShowSystemNotificationForMode
} from "../service";

const createWindow = () => ({
  isFocused: vi.fn(() => false),
  isMinimized: vi.fn(() => true),
  isVisible: vi.fn(() => false),
  isDestroyed: vi.fn(() => false),
  restore: vi.fn(),
  show: vi.fn(),
  focus: vi.fn(),
  webContents: {
    send: vi.fn()
  }
});

describe("system notifications service", () => {
  beforeEach(() => {
    electronMock.MockNotification.instances = [];
    electronMock.MockNotification.supported = true;
    electronMock.MockNotification.isSupported.mockClear();
    electronMock.ipcMain.handle.mockClear();
    electronMock.ipcMain.removeHandler.mockClear();
    electronMock.shell.openExternal.mockReset();
    electronMock.shell.openExternal.mockResolvedValue(undefined);
  });

  test("normalizes notification payloads and action buttons", () => {
    const request = normalizeSystemNotificationRequestForTests({
      id: " notification-1 ",
      title: "  Build   finished  ",
      body: " Done\nnow ",
      sourceTitle: " Agent ",
      level: "success",
      mode: "all",
      clickBehavior: "open_source",
      actionsEnabled: true,
      actions: [
        { id: "open-source", title: " Open " },
        { id: "unknown", title: "Ignore" },
        { id: "mark-read", title: "Read" }
      ]
    });

    expect(request).toEqual({
      id: "notification-1",
      title: "Build finished",
      body: "Done now",
      sourceTitle: "Agent",
      level: "success",
      mode: "all",
      clickBehavior: "open_source",
      actions: [
        { id: "open-source", title: "Open" },
        { id: "mark-read", title: "Read" }
      ]
    });
  });

  test("uses background mode only when Lyra is not active", () => {
    expect(shouldShowSystemNotificationForMode("off", null)).toBe(false);
    expect(shouldShowSystemNotificationForMode("all", null)).toBe(true);
    expect(
      shouldShowSystemNotificationForMode("background", {
        isFocused: () => true,
        isMinimized: () => false,
        isVisible: () => true
      })
    ).toBe(false);
    expect(
      shouldShowSystemNotificationForMode("background", {
        isFocused: () => false,
        isMinimized: () => false,
        isVisible: () => true
      })
    ).toBe(true);
  });

  test("escapes Windows toast XML", () => {
    const request = normalizeSystemNotificationRequestForTests({
      id: "notification-1",
      title: "A < B & C",
      body: "\"quoted\"",
      level: "warning",
      mode: "all",
      clickBehavior: "open_center",
      actionsEnabled: true,
      actions: [{ id: "open-center", title: "Open & See" }]
    });

    expect(request).not.toBeNull();
    expect(buildWindowsToastXmlForTests(request!)).toContain("A &lt; B &amp; C");
    expect(buildWindowsToastXmlForTests(request!)).toContain("&quot;quoted&quot;");
    expect(buildWindowsToastXmlForTests(request!)).toContain("Open &amp; See");
  });

  test("skips unsupported platforms without throwing", () => {
    electronMock.MockNotification.supported = false;
    const bridge = createSystemNotificationsIpcBridge({
      getWindow: () => null,
      iconPath: null,
      appUserModelId: "dev.lyra.desktop"
    });

    expect(bridge.show({
      id: "notification-1",
      title: "Skipped",
      level: "info",
      mode: "all",
      clickBehavior: "open_center",
      actionsEnabled: false
    })).toEqual({ status: "skipped", reason: "unsupported" });

    bridge.dispose();
  });

  test("opens the host notification settings entry point", async () => {
    await expect(openSystemNotificationSettingsForTests()).resolves.toEqual(
      expect.objectContaining({ opened: true })
    );

    expect(electronMock.shell.openExternal).toHaveBeenCalled();
  });

  test("focuses Lyra and publishes activation on click", () => {
    const window = createWindow();
    const bridge = createSystemNotificationsIpcBridge({
      getWindow: () => window as never,
      iconPath: "/tmp/icon.png",
      appUserModelId: "dev.lyra.desktop"
    });

    expect(bridge.show({
      id: "notification-1",
      title: "Ready",
      body: "Task complete",
      level: "success",
      mode: "all",
      clickBehavior: "open_center",
      actionsEnabled: true,
      actions: [{ id: "mark-read", title: "Read" }]
    })).toEqual({ status: "shown", notificationId: "notification-1" });

    const notification = electronMock.MockNotification.instances[0];
    notification?.emit("click", {});

    expect(window.restore).toHaveBeenCalled();
    expect(window.show).toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalled();
    expect(window.webContents.send).toHaveBeenCalledWith(
      LYRA_CHANNELS.systemNotificationsActivated,
      expect.objectContaining({
        notificationId: "notification-1",
        actionId: "open-center"
      })
    );

    bridge.dispose();
  });
});
