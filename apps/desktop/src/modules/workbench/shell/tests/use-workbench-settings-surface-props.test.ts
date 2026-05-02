import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type {
  LyraDesktopApi,
  SystemNotificationAccessRequestResult,
  SystemNotificationStatus
} from "../../../../shared/desktop-bridge";
import { createTranslator } from "../../i18n";
import type { WorkbenchPreferencesModel } from "../../preferences";
import { useWorkbenchLabels } from "../use-workbench-labels";
import {
  formatWorkbenchSearchIndexStatusForTests,
  useWorkbenchSettingsSurfaceProps
} from "../use-workbench-settings-surface-props";
import { createInitialWorkbenchPreferences } from "../workbench-shell-defaults";

const createSystemNotificationStatus = (
  canNotify: boolean
): SystemNotificationStatus => ({
  platform: "darwin",
  supported: true,
  permission: canNotify ? "granted" : "denied",
  canNotify,
  canOpenSettings: true,
  actionSupport: "native"
});

const createSystemNotificationAccessResult = (
  canNotify: boolean
): SystemNotificationAccessRequestResult => ({
  ...createSystemNotificationStatus(canNotify),
  openedSettings: canNotify === false
});

const createPreferencesModel = (
  setSystemNotificationMode = vi.fn()
): WorkbenchPreferencesModel => ({
  preferences: createInitialWorkbenchPreferences(),
  setUiPackId: vi.fn(),
  setSystemNotificationMode,
  setSystemNotificationClickBehavior: vi.fn(),
  setSystemNotificationActionsEnabled: vi.fn()
} as unknown as WorkbenchPreferencesModel);

const createDesktopApi = ({
  readStatus = vi.fn().mockResolvedValue(createSystemNotificationStatus(true)),
  requestAccess = vi.fn().mockResolvedValue(createSystemNotificationAccessResult(true))
}: {
  readonly readStatus?: NonNullable<LyraDesktopApi["systemNotifications"]>["readStatus"];
  readonly requestAccess?: NonNullable<LyraDesktopApi["systemNotifications"]>["requestAccess"];
} = {}): LyraDesktopApi => ({
  systemNotifications: {
    readStatus,
    requestAccess,
    openSettings: vi.fn(),
    show: vi.fn(),
    onActivated: vi.fn(() => vi.fn())
  }
} as unknown as LyraDesktopApi);

const renderSettingsProps = ({
  desktopApi = createDesktopApi(),
  preferencesModel = createPreferencesModel()
}: {
  readonly desktopApi?: LyraDesktopApi | null;
  readonly preferencesModel?: WorkbenchPreferencesModel;
} = {}) =>
  renderHook(() => {
    const t = createTranslator("en-US");
    const labels = useWorkbenchLabels(t);
    return useWorkbenchSettingsSurfaceProps({
      labels,
      desktopApi,
      preferencesModel,
      settingsAiModel: {} as never,
      jsReplEnabled: true,
      searchIndexStatus: null,
      searchRebuildIndexPending: false,
      onJsReplChange: vi.fn(),
      onSearchRebuildIndex: vi.fn()
    });
  });

describe("formatWorkbenchSearchIndexStatusForTests", () => {
  test("formats idle search index status", () => {
    expect(formatWorkbenchSearchIndexStatusForTests(null)).toBe("idle");
  });

  test("includes indexed counts, progress, and error details", () => {
    expect(
      formatWorkbenchSearchIndexStatusForTests({
        state: "failed",
        indexedFiles: 42,
        indexedDirs: 7,
        progress: 0.625,
        error: "permission denied"
      })
    ).toBe("failed · files 42 · dirs 7 · 63% · permission denied");
  });
});

describe("useWorkbenchSettingsSurfaceProps system notifications", () => {
  test("keeps the mode off when selecting off", async () => {
    const requestAccess = vi.fn().mockResolvedValue(createSystemNotificationAccessResult(true));
    const desktopApi = createDesktopApi({ requestAccess });
    const setSystemNotificationMode = vi.fn();
    const { result } = renderSettingsProps({
      desktopApi,
      preferencesModel: createPreferencesModel(setSystemNotificationMode)
    });

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.onSystemNotificationModeChange("off");
    });

    expect(setSystemNotificationMode).toHaveBeenCalledWith("off");
    expect(requestAccess).not.toHaveBeenCalled();
  });

  test("requests real notification access before enabling a system notification mode", async () => {
    const requestAccess = vi.fn().mockResolvedValue(createSystemNotificationAccessResult(true));
    const desktopApi = createDesktopApi({ requestAccess });
    const setSystemNotificationMode = vi.fn();
    const { result } = renderSettingsProps({
      desktopApi,
      preferencesModel: createPreferencesModel(setSystemNotificationMode)
    });

    act(() => {
      result.current.onSystemNotificationModeChange("all");
    });

    await waitFor(() => {
      expect(requestAccess).toHaveBeenCalled();
      expect(setSystemNotificationMode).toHaveBeenCalledWith("all");
    });
  });

  test("forces the setting off when notification access is missing", async () => {
    const requestAccess = vi.fn().mockResolvedValue(createSystemNotificationAccessResult(false));
    const desktopApi = createDesktopApi({ requestAccess });
    const setSystemNotificationMode = vi.fn();
    const { result } = renderSettingsProps({
      desktopApi,
      preferencesModel: createPreferencesModel(setSystemNotificationMode)
    });

    act(() => {
      result.current.onSystemNotificationModeChange("background");
    });

    await waitFor(() => {
      expect(requestAccess).toHaveBeenCalled();
      expect(setSystemNotificationMode).toHaveBeenCalledWith("off");
    });
  });

  test("renders stale enabled preferences as off when the permission status is blocked", async () => {
    const desktopApi = createDesktopApi({
      readStatus: vi.fn().mockResolvedValue(createSystemNotificationStatus(false))
    });
    const { result } = renderSettingsProps({ desktopApi });

    await waitFor(() => {
      expect(result.current.systemNotificationModeValue).toBe("off");
    });
  });
});
