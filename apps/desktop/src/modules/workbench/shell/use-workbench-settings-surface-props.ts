import { useEffect, useMemo, useState } from "react";

import type {
  LinuxCompatConfig,
  LinuxCompatProfile,
  LinuxCompatReadStatusResponse,
  LyraDesktopApi,
  SystemNotificationMode,
  SystemNotificationStatus,
  UiuxListPacksResponse
} from "../../../shared/desktop-bridge";
import type {
  BrowserSettingsCategoryFocusRequest,
  BrowserSettingsSurfaceProps
} from "../browser-tabs/settings-surface";
import type { GlobalDialogModel } from "../global-dialog";
import type { WorkbenchNotificationModel } from "../notifications";
import type { WorkbenchPreferencesModel } from "../preferences";
import type { SettingsAiModel } from "../settings-ai";
import type { SoftwareCapabilitiesRegistryModel } from "../software-capabilities";
import type { SoftwareStoreSurfaceProps } from "../software-store";
import {
  isBuiltinWorkbenchUiPackId,
  type WorkbenchUiPackId
} from "../ui-platform";
import type { WorkbenchLabels } from "./use-workbench-labels";

type UseWorkbenchSettingsSurfacePropsParams = {
  readonly labels: WorkbenchLabels;
  readonly desktopApi: LyraDesktopApi | null;
  readonly preferencesModel: WorkbenchPreferencesModel;
  readonly settingsAiModel: SettingsAiModel;
  readonly softwareCapabilities: SoftwareCapabilitiesRegistryModel;
  readonly jsReplEnabled: boolean;
  readonly focusCategoryRequest?: BrowserSettingsCategoryFocusRequest | null;
  readonly openDialog: GlobalDialogModel["openDialog"];
  readonly publishNotification: WorkbenchNotificationModel["publishNotification"];
  readonly onOpenSite: (url: string, title?: string) => void;
  readonly onOpenSoftwareStoreBuiltinApp: SoftwareStoreSurfaceProps["onOpenBuiltinApp"];
  readonly onOpenDocs: () => void;
  readonly onJsReplChange: (enabled: boolean) => void;
};

export const useWorkbenchSettingsSurfaceProps = ({
  labels,
  desktopApi,
  preferencesModel,
  settingsAiModel,
  softwareCapabilities,
  jsReplEnabled,
  focusCategoryRequest = null,
  openDialog,
  publishNotification,
  onOpenSite,
  onOpenSoftwareStoreBuiltinApp,
  onOpenDocs,
  onJsReplChange
}: UseWorkbenchSettingsSurfacePropsParams): BrowserSettingsSurfaceProps => {
  const preferences = preferencesModel.preferences;
  const [uiuxPacks, setUiuxPacks] = useState<UiuxListPacksResponse | null>(null);
  const [pendingUiPackId, setPendingUiPackId] = useState<WorkbenchUiPackId | null>(null);
  const [systemNotificationStatus, setSystemNotificationStatus] =
    useState<SystemNotificationStatus | null>(null);
  const [linuxCompatStatus, setLinuxCompatStatus] =
    useState<LinuxCompatReadStatusResponse | null>(null);
  const [linuxCompatConfig, setLinuxCompatConfig] =
    useState<LinuxCompatConfig | null>(null);
  const [actCacheValue, setActCacheValue] = useState(false);
  const [codeGraphEmbeddingValue, setCodeGraphEmbeddingValue] = useState(false);

  useEffect(() => {
    if (desktopApi?.uiux === undefined) {
      setUiuxPacks(null);
      return;
    }
    let cancelled = false;
    void desktopApi.uiux.listPacks()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setUiuxPacks(response);
        setPendingUiPackId(response.pendingExternalPackId ?? null);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        console.warn("[lyra-uiux] failed to list installed UIUX packs", error);
        setUiuxPacks(null);
      });
    return () => {
      cancelled = true;
    };
  }, [desktopApi]);

  useEffect(() => {
    const systemNotifications = desktopApi?.systemNotifications;
    if (systemNotifications === undefined) {
      return;
    }

    let cancelled = false;
    const readStatus = (): void => {
      void systemNotifications.readStatus()
        .then((status) => {
          if (cancelled) {
            return;
          }
          setSystemNotificationStatus(status.canNotify ? null : status);
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          console.warn(`[lyra-system-notifications] status read failed ${String(error)}`);
          setSystemNotificationStatus(null);
        });
    };

    readStatus();
    window.addEventListener("focus", readStatus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", readStatus);
    };
  }, [desktopApi?.systemNotifications]);

  useEffect(() => {
    const linuxCompat = desktopApi?.linuxCompat;
    if (linuxCompat === undefined) {
      setLinuxCompatStatus(null);
      setLinuxCompatConfig(null);
      return;
    }

    let cancelled = false;
    const readLinuxCompat = (): void => {
      void Promise.all([
        linuxCompat.readStatus(),
        linuxCompat.readConfig()
      ])
        .then(([status, config]) => {
          if (cancelled) {
            return;
          }
          setLinuxCompatStatus(status);
          setLinuxCompatConfig(config);
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          console.warn(`[lyra-linux] status read failed ${String(error)}`);
          setLinuxCompatStatus(null);
          setLinuxCompatConfig(null);
        });
    };

    readLinuxCompat();
    window.addEventListener("focus", readLinuxCompat);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", readLinuxCompat);
    };
  }, [desktopApi?.linuxCompat]);

  // Experimental toggles: read from agent IPC on mount, default off.
  useEffect(() => {
    const agent = desktopApi?.agent;
    if (agent === undefined) return;
    let cancelled = false;
    void Promise.all([
      agent.readActCache?.().catch(() => undefined),
      agent.readCodeGraphEmbedding?.().catch(() => undefined)
    ]).then(([actSnap, cgSnap]) => {
      if (cancelled) return;
      if (actSnap !== undefined) setActCacheValue(actSnap.enabled);
      if (cgSnap !== undefined) setCodeGraphEmbeddingValue(cgSnap.enabled);
    });
    return () => { cancelled = true; };
  }, [desktopApi?.agent]);

  const uiStyleOptions = useMemo(
    () => [
      ...labels.settingsOptions.uiStyle,
      ...(uiuxPacks?.installed
        .filter((pack) => pack.trustState === "trusted")
        .map((pack) => ({
          value: pack.id,
          label: pack.manifest.name,
          description: labels.settingsSurface.uiStyleExternalReloadRequired
        })) ?? [])
    ],
    [
      labels.settingsOptions.uiStyle,
      labels.settingsSurface.uiStyleExternalReloadRequired,
      uiuxPacks?.installed
    ]
  );

  const handleUiStyleChange = (value: WorkbenchUiPackId): void => {
    if (isBuiltinWorkbenchUiPackId(value)) {
      setPendingUiPackId(null);
      preferencesModel.setUiPackId(value);
      void desktopApi?.uiux.requestActivation({ packId: value }).catch((error: unknown) => {
        console.warn("[lyra-uiux] failed to clear external UIUX activation", error);
      });
      return;
    }

    if (desktopApi?.uiux === undefined) {
      return;
    }
    setPendingUiPackId(value);
    void desktopApi.uiux.requestActivation({ packId: value })
      .then((response) => {
        setPendingUiPackId(response.packId);
      })
      .catch((error: unknown) => {
        console.warn(`[lyra-uiux] failed to request UIUX pack activation: ${value}`, error);
        setPendingUiPackId(null);
      });
  };

  const handleSystemNotificationModeChange = (value: SystemNotificationMode): void => {
    if (value === "off") {
      preferencesModel.setSystemNotificationMode("off");
      return;
    }

    const systemNotifications = desktopApi?.systemNotifications;
    if (systemNotifications === undefined) {
      preferencesModel.setSystemNotificationMode("off");
      return;
    }

    void systemNotifications.requestAccess()
      .then((status) => {
        setSystemNotificationStatus(status.canNotify ? null : status);
        preferencesModel.setSystemNotificationMode(status.canNotify ? value : "off");
      })
      .catch((error: unknown) => {
        console.warn(`[lyra-system-notifications] access request failed ${String(error)}`);
        preferencesModel.setSystemNotificationMode("off");
      });
  };

  const publishLinuxCompatNotification = (
    title: string,
    preview: string,
    level: "info" | "success" | "warning" | "error" = "info"
  ): void => {
    publishNotification({
      title,
      preview,
      level,
      source: {
        id: "linux-compat",
        title: labels.settingsSurface.linuxCategoryLabel,
        iconKey: "system"
      },
      target: { kind: "none" }
    });
  };

  const requestLinuxCompatRestart = (reason: string): void => {
    const linuxCompat = desktopApi?.linuxCompat;
    if (linuxCompat === undefined) {
      return;
    }
    void linuxCompat.requestRestart({ reason })
      .then((response) => {
        if (response.ok) {
          return;
        }
        publishLinuxCompatNotification(
          labels.settingsSurface.linuxCompatRestartLabel,
          response.error ?? labels.settingsSurface.linuxCompatRequestFailed,
          "error"
        );
      })
      .catch((error: unknown) => {
        publishLinuxCompatNotification(
          labels.settingsSurface.linuxCompatRestartLabel,
          String(error),
          "error"
        );
      });
  };

  const openLinuxCompatRestartDialog = (reason: string): void => {
    openDialog({
      title: labels.settingsSurface.linuxCompatRestartDialogTitle,
      description: labels.settingsSurface.linuxCompatRestartDialogDescription,
      source: {
        title: labels.settingsSurface.linuxCategoryLabel,
        iconLabel: "L",
        ...(linuxCompatStatus === null
          ? {}
          : { subtitle: `${linuxCompatStatus.profile} · ${linuxCompatStatus.backend} · ${linuxCompatStatus.gpuMode}` })
      },
      actions: [
        {
          id: "cancel",
          label: labels.settingsSurface.linuxCompatRestartDialogCancel
        },
        {
          id: "restart",
          label: labels.settingsSurface.linuxCompatRestartNowLabel,
          tone: "primary",
          onSelect: () => {
            requestLinuxCompatRestart(reason);
          }
        }
      ]
    });
  };

  const handleLinuxCompatProfileChange = (profile: LinuxCompatProfile): void => {
    const linuxCompat = desktopApi?.linuxCompat;
    if (linuxCompat === undefined) {
      return;
    }
    void linuxCompat.updateConfig({ profile })
      .then((response) => {
        if (response.ok && response.config !== undefined) {
          setLinuxCompatConfig(response.config);
          publishLinuxCompatNotification(
            labels.settingsSurface.linuxCompatProfileLabel,
            labels.settingsSurface.linuxCompatRestartDescription,
            "info"
          );
          openLinuxCompatRestartDialog("linux-compat-profile-change");
          return;
        }
        publishLinuxCompatNotification(
          labels.settingsSurface.linuxCompatProfileLabel,
          response.error ?? labels.settingsSurface.linuxCompatRequestFailed,
          "error"
        );
      })
      .catch((error: unknown) => {
        publishLinuxCompatNotification(
          labels.settingsSurface.linuxCompatProfileLabel,
          String(error),
          "error"
        );
      });
  };

  const effectiveSystemNotificationMode =
    systemNotificationStatus?.canNotify === false ? "off" : preferences.systemNotificationMode;
  const linuxCompatVisible = linuxCompatStatus?.platform === "linux" && linuxCompatStatus.enabled;
  const linuxCompatProfileValue =
    linuxCompatConfig?.profile ?? linuxCompatStatus?.profile ?? "reliable";

  return {
    ...labels.settingsSurface,
    desktopApi,
    focusCategoryRequest,
    localeValue: preferences.locale,
    themeValue: preferences.theme,
    uiStyleValue: pendingUiPackId ?? preferences.uiPackId,
    splitTriggerModeValue: preferences.splitTriggerMode,
    splitThreePaneLayoutValue: preferences.splitThreePaneLayout,
    splitOverflowPolicyValue: preferences.splitOverflowPolicy,
    aiRichRenderValue: preferences.aiRichRenderingEnabled,
    aiStopBehaviorValue: preferences.aiStopBehavior,
    preventSleepValue: preferences.preventSleepEnabled,
    jsReplValue: jsReplEnabled,
    actCacheValue,
    codeGraphEmbeddingValue,
    searchWebEngineIds: preferences.searchWebEngineIds,
    searchSearxngEndpointValue: preferences.searchSearxngEndpoint ?? "",
    omniboxNonBrowserSubmitTargetValue: preferences.omniboxNonBrowserSubmitTarget,
    systemNotificationModeValue: effectiveSystemNotificationMode,
    systemNotificationClickBehaviorValue: preferences.systemNotificationClickBehavior,
    systemNotificationActionsValue: preferences.systemNotificationActionsEnabled,
    linuxCompatVisible,
    linuxCompatStatus,
    linuxCompatConfig,
    linuxCompatProfileValue,
    localeOptions: labels.settingsOptions.locale,
    themeOptions: labels.settingsOptions.theme,
    uiStyleOptions,
    splitTriggerModeOptions: labels.settingsOptions.splitTriggerMode,
    splitThreePaneLayoutOptions: labels.settingsOptions.splitThreePaneLayout,
    splitOverflowPolicyOptions: labels.settingsOptions.splitOverflowPolicy,
    searchWebEngineOptions: labels.settingsOptions.searchWebEngine,
    omniboxNonBrowserSubmitTargetOptions: labels.settingsOptions.omniboxNonBrowserSubmitTarget,
    systemNotificationModeOptions: labels.settingsOptions.systemNotificationMode,
    systemNotificationClickBehaviorOptions: labels.settingsOptions.systemNotificationClickBehavior,
    linuxCompatProfileOptions: labels.settingsOptions.linuxCompatProfile,
    aiLabels: labels.settingsAi,
    aiModel: settingsAiModel,
    openDialog,
    loginManagerCategoryLabel: labels.loginManager.title,
    loginManager: {
      desktopApi,
      labels: labels.loginManager,
      onOpenSite,
      embedded: true
    },
    softwareStoreCategoryLabel: labels.softwareStore.title,
    softwareStore: {
      desktopApi,
      embedded: true,
      labels: labels.softwareStore,
      softwareCapabilities,
      activeUiPackId: preferences.uiPackId,
      onUiPackIdChange: preferencesModel.setUiPackId,
      onOpenBuiltinApp: onOpenSoftwareStoreBuiltinApp
    },
    onLocaleChange: preferencesModel.setLocale,
    onThemeChange: preferencesModel.setTheme,
    onUiStyleChange: handleUiStyleChange,
    onSplitTriggerModeChange: preferencesModel.setSplitTriggerMode,
    onSplitThreePaneLayoutChange: preferencesModel.setSplitThreePaneLayout,
    onSplitOverflowPolicyChange: preferencesModel.setSplitOverflowPolicy,
    onAiRichRenderChange: preferencesModel.setAiRichRenderingEnabled,
    onAiStopBehaviorChange: preferencesModel.setAiStopBehavior,
    onPreventSleepChange: preferencesModel.setPreventSleepEnabled,
    onJsReplChange,
    onActCacheChange: (value: boolean) => {
      setActCacheValue(value);
      void desktopApi?.agent?.updateActCache?.({ enabled: value })
        .then((snap) => { if (snap !== undefined) setActCacheValue(snap.enabled); })
        .catch(() => undefined);
    },
    onCodeGraphEmbeddingChange: (value: boolean) => {
      setCodeGraphEmbeddingValue(value);
      void desktopApi?.agent?.updateCodeGraphEmbedding?.({ enabled: value })
        .then((snap) => { if (snap !== undefined) setCodeGraphEmbeddingValue(snap.enabled); })
        .catch(() => undefined);
    },
    onSearchWebEnginesChange: preferencesModel.setSearchWebEngineIds,
    onSearchSearxngEndpointChange: (value: string) => {
      preferencesModel.setSearchSearxngEndpoint(value);
    },
    onOmniboxNonBrowserSubmitTargetChange: preferencesModel.setOmniboxNonBrowserSubmitTarget,
    onSystemNotificationModeChange: handleSystemNotificationModeChange,
    onSystemNotificationClickBehaviorChange: preferencesModel.setSystemNotificationClickBehavior,
    onSystemNotificationActionsChange: preferencesModel.setSystemNotificationActionsEnabled,
    onLinuxCompatProfileChange: handleLinuxCompatProfileChange,
    onLinuxCompatRestart: () => {
      openLinuxCompatRestartDialog("linux-compat-settings");
    },
    onOpenDocs
  };
};
