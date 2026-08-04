import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { AuthApi, AuthSnapshot } from "../../../../shared/auth";
import type {
  LyraDesktopApi,
  SystemNotificationAccessRequestResult,
  SystemNotificationStatus
} from "../../../../shared/desktop-bridge";
import { createTranslator } from "../../i18n";
import type { WorkbenchPreferencesModel } from "../../preferences";
import type { SettingsAiModel } from "../../settings-ai";
import { useWorkbenchLabels } from "../use-workbench-labels";
import { useWorkbenchSettingsSurfaceProps } from "../use-workbench-settings-surface-props";
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
  requestAccess = vi.fn().mockResolvedValue(createSystemNotificationAccessResult(true)),
  auth
}: {
  readonly readStatus?: NonNullable<LyraDesktopApi["systemNotifications"]>["readStatus"];
  readonly requestAccess?: NonNullable<LyraDesktopApi["systemNotifications"]>["requestAccess"];
  readonly auth?: AuthApi;
} = {}): LyraDesktopApi => ({
  systemNotifications: {
    readStatus,
    requestAccess,
    openSettings: vi.fn(),
    show: vi.fn(),
    onActivated: vi.fn(() => vi.fn())
  },
  ...(auth === undefined ? {} : { auth })
} as unknown as LyraDesktopApi);

const renderSettingsProps = ({
  desktopApi = createDesktopApi(),
  preferencesModel = createPreferencesModel(),
  settingsAiModel = {} as SettingsAiModel,
  publishNotification = vi.fn(),
  openDialog = vi.fn(),
  onOpenSettingsSection = vi.fn(),
  onSignedOut = vi.fn()
}: {
  readonly desktopApi?: LyraDesktopApi | null;
  readonly preferencesModel?: WorkbenchPreferencesModel;
  readonly settingsAiModel?: SettingsAiModel;
  readonly publishNotification?: ReturnType<typeof vi.fn>;
  readonly openDialog?: ReturnType<typeof vi.fn>;
  readonly onOpenSettingsSection?: ReturnType<typeof vi.fn>;
  readonly onSignedOut?: ReturnType<typeof vi.fn>;
} = {}) =>
  renderHook(() => {
    const t = createTranslator("en-US");
    const labels = useWorkbenchLabels(t);
    return useWorkbenchSettingsSurfaceProps({
      labels,
      desktopApi,
      preferencesModel,
      settingsAiModel,
      softwareCapabilities: {
        software: [],
        loading: false,
        error: null,
        refresh: async () => undefined,
        handleBridgeQuery: () => ({}) as never,
        createUiPackCapabilities: () => ({}) as never
      },
      jsReplEnabled: true,
      openDialog,
      publishNotification,
      onOpenSite: vi.fn(),
      onOpenSoftwareStoreBuiltinApp: vi.fn(),
      onOpenSettingsSection,
      onOpenDocs: vi.fn(),
      onJsReplChange: vi.fn(),
      onSignedOut
    });
  });

const signedInSnapshot: AuthSnapshot = {
  configured: true,
  user: {
    id: "user-1",
    email: "fallback@example.com",
    displayName: "Google Name",
    avatarUrl: "https://example.com/google.png"
  },
  profile: {
    id: "user-1",
    displayName: "Profile Name",
    avatarUrl: "https://example.com/profile.png",
    localePreference: { mode: "system" },
    themePreference: "lyra-system",
    onboardingCompleted: true,
    onboardingVersion: 1
  }
};

const createAuthApi = (
  overrides: Partial<AuthApi> = {}
): AuthApi => ({
  getSession: vi.fn().mockResolvedValue(signedInSnapshot),
  getLocalIdentity: vi.fn().mockResolvedValue({
    displayName: "Local User",
    registered: false
  }),
  startGoogleLogin: vi.fn(),
  updateProfile: vi.fn(),
  deleteAccount: vi.fn().mockResolvedValue(undefined),
  logout: vi.fn().mockResolvedValue(undefined),
  onChanged: vi.fn(() => vi.fn()),
  ...overrides
});

describe("useWorkbenchSettingsSurfaceProps", () => {
  test("maps declared settings routes through Core and rejects ambiguous paths", () => {
    const onOpenSettingsSection = vi.fn();
    const { result } = renderSettingsProps({ onOpenSettingsSection });

    act(() => {
      result.current.softwareStore.onOpenSettingsRoute("/settings/models");
    });
    expect(onOpenSettingsSection).toHaveBeenCalledWith("models");

    expect(() => {
      result.current.softwareStore.onOpenSettingsRoute("/settings//models");
    }).toThrow("Unavailable");
    expect(() => {
      result.current.softwareStore.onOpenSettingsRoute("https://example.test/settings");
    }).toThrow("Unavailable");
    expect(onOpenSettingsSection).toHaveBeenCalledTimes(1);
  });

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

  test("derives and updates prompt delivery experiment settings", () => {
    const updateAgentConfig = vi.fn().mockResolvedValue(undefined);
    const { result } = renderSettingsProps({
      desktopApi: null,
      settingsAiModel: {
        agentConfig: {
          config: {
            promptDelivery: {
              mode: "lean-experimental",
              openaiResponsesStatefulPromptContract: true
            }
          },
          commands: []
        },
        updateAgentConfig
      } as unknown as SettingsAiModel
    });

    expect(result.current.leanPromptDeliveryValue).toBe(true);
    expect(result.current.statefulPromptContractValue).toBe(true);

    act(() => {
      result.current.onLeanPromptDeliveryChange(false);
      result.current.onStatefulPromptContractChange(false);
    });

    expect(updateAgentConfig).toHaveBeenCalledWith({
      promptDeliveryMode: "full"
    });
    expect(updateAgentConfig).toHaveBeenCalledWith({
      openaiResponsesStatefulPromptContract: false
    });
  });

  test("derives the settings account from the profile and completes logout once", async () => {
    let resolveLogout: (() => void) | undefined;
    const logout = vi.fn(() => new Promise<void>((resolve) => {
      resolveLogout = resolve;
    }));
    const onSignedOut = vi.fn();
    const { result } = renderSettingsProps({
      desktopApi: createDesktopApi({ auth: createAuthApi({ logout }) }),
      onSignedOut
    });

    await waitFor(() => {
      expect(result.current.account).toMatchObject({
        kind: "signed-in",
        displayName: "Profile Name",
        avatarUrl: "https://example.com/profile.png",
        actionPending: false
      });
    });

    act(() => {
      result.current.account?.onAction();
      result.current.account?.onAction();
    });

    expect(logout).toHaveBeenCalledTimes(1);
    expect(result.current.account?.actionPending).toBe(true);

    await act(async () => {
      resolveLogout?.();
      await Promise.resolve();
    });

    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  test("requires typed confirmation before deleting the signed-in cloud account", async () => {
    const deleteAccount = vi.fn().mockResolvedValue(undefined);
    const onSignedOut = vi.fn();
    const openDialog = vi.fn();
    const { result } = renderSettingsProps({
      desktopApi: createDesktopApi({ auth: createAuthApi({ deleteAccount }) }),
      onSignedOut,
      openDialog
    });

    await waitFor(() => {
      expect(result.current.account?.deleteAction).toBeDefined();
    });
    act(() => {
      result.current.account?.deleteAction?.onSelect();
    });

    const request = openDialog.mock.calls[0]?.[0] as {
      readonly actions?: readonly {
        readonly id: string;
        readonly onSelect?: (context: { readonly inputValue?: string }) => Promise<void>;
      }[];
    };
    const deleteAction = request.actions?.find((action) => action.id === "delete");
    await act(async () => {
      await deleteAction?.onSelect?.({ inputValue: "not-delete" });
    });
    expect(deleteAccount).not.toHaveBeenCalled();

    await act(async () => {
      await deleteAction?.onSelect?.({ inputValue: "DELETE" });
    });
    expect(deleteAccount).toHaveBeenCalledWith("DELETE");
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  test("does not let a stale initial session overwrite an auth change", async () => {
    let resolveInitialSession: ((snapshot: AuthSnapshot) => void) | undefined;
    let emitAuthChange: ((snapshot: AuthSnapshot) => void) | undefined;
    const changedSnapshot: AuthSnapshot = {
      ...signedInSnapshot,
      user: {
        ...signedInSnapshot.user!,
        displayName: "Changed User"
      },
      profile: {
        ...signedInSnapshot.profile!,
        displayName: "Changed Profile"
      }
    };
    const auth = createAuthApi({
      getSession: vi.fn(() => new Promise<AuthSnapshot>((resolve) => {
        resolveInitialSession = resolve;
      })),
      onChanged: vi.fn((listener) => {
        emitAuthChange = listener;
        return vi.fn();
      })
    });
    const { result } = renderSettingsProps({
      desktopApi: createDesktopApi({ auth })
    });

    act(() => {
      emitAuthChange?.(changedSnapshot);
    });
    expect(result.current.account).toMatchObject({
      displayName: "Changed Profile"
    });

    await act(async () => {
      resolveInitialSession?.(signedInSnapshot);
      await Promise.resolve();
    });
    expect(result.current.account).toMatchObject({
      displayName: "Changed Profile"
    });
  });

  test("falls back to the email name and user avatar when no profile is available", async () => {
    const { result } = renderSettingsProps({
      desktopApi: createDesktopApi({
        auth: createAuthApi({
          getSession: vi.fn().mockResolvedValue({
            configured: true,
            user: {
              id: "user-2",
              email: "fallback@example.com",
              avatarUrl: "https://example.com/user.png"
            },
            profile: null
          } satisfies AuthSnapshot)
        })
      })
    });

    await waitFor(() => {
      expect(result.current.account).toMatchObject({
        displayName: "fallback",
        avatarUrl: "https://example.com/user.png"
      });
    });
  });

  test("presents local mode as a local account whose action returns to login", async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    const onSignedOut = vi.fn();
    const { result } = renderSettingsProps({
      desktopApi: createDesktopApi({
        auth: createAuthApi({
          getSession: vi.fn().mockResolvedValue({
            configured: true,
            user: null,
            profile: null
          } satisfies AuthSnapshot),
          getLocalIdentity: vi.fn().mockResolvedValue({
            displayName: "petehsu",
            registered: true,
            registeredDisplayName: "Pete Hsu",
            registeredAvatarUrl: "https://example.com/local.png"
          }),
          logout
        })
      }),
      onSignedOut
    });

    await waitFor(() => {
      expect(result.current.account).toMatchObject({
        kind: "local",
        displayName: "Local account",
        avatarUrl: null,
        actionLabel: "Sign in",
        actionPending: false
      });
    });

    act(() => {
      result.current.account?.onAction();
    });

    expect(logout).not.toHaveBeenCalled();
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  test("keeps the account visible and reports a failed logout", async () => {
    const publishNotification = vi.fn();
    const onSignedOut = vi.fn();
    const { result } = renderSettingsProps({
      desktopApi: createDesktopApi({
        auth: createAuthApi({
          logout: vi.fn().mockRejectedValue(new Error("Network unavailable"))
        })
      }),
      publishNotification,
      onSignedOut
    });

    await waitFor(() => {
      expect(result.current.account).not.toBeNull();
    });

    await act(async () => {
      result.current.account?.onAction();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.account?.actionPending).toBe(false);
      expect(publishNotification).toHaveBeenCalledWith(expect.objectContaining({
        level: "error",
        preview: "Network unavailable"
      }));
    });
    expect(onSignedOut).not.toHaveBeenCalled();
  });
});
