import { useEffect, useMemo, useState } from "react";

import type { BrowserUseRuntimeStatus } from "../../../shared/browser-use";
import type {
  LyraDesktopApi,
  SearchIndexStatusResponse,
  UiuxListPacksResponse
} from "../../../shared/desktop-bridge";
import type { BrowserSettingsSurfaceProps } from "../browser-tabs/settings-surface";
import type { WorkbenchPreferencesModel } from "../preferences";
import type { SettingsAiModel } from "../settings-ai";
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
  readonly browserUseRuntimeStatus: BrowserUseRuntimeStatus;
  readonly jsReplEnabled: boolean;
  readonly searchIndexStatus: SearchIndexStatusResponse | null;
  readonly searchRebuildIndexPending: boolean;
  readonly onJsReplChange: (enabled: boolean) => void;
  readonly onSearchRebuildIndex: () => void;
};

const formatSearchIndexStatus = (status: SearchIndexStatusResponse | null): string => {
  if (status === null) {
    return "idle";
  }

  return `${status.state} · files ${status.indexedFiles} · dirs ${status.indexedDirs}${typeof status.progress === "number" ? ` · ${Math.round(status.progress * 100)}%` : ""}${typeof status.error === "string" ? ` · ${status.error}` : ""}`;
};

export const useWorkbenchSettingsSurfaceProps = ({
  labels,
  desktopApi,
  preferencesModel,
  settingsAiModel,
  browserUseRuntimeStatus,
  jsReplEnabled,
  searchIndexStatus,
  searchRebuildIndexPending,
  onJsReplChange,
  onSearchRebuildIndex
}: UseWorkbenchSettingsSurfacePropsParams): BrowserSettingsSurfaceProps => {
  const preferences = preferencesModel.preferences;
  const [uiuxPacks, setUiuxPacks] = useState<UiuxListPacksResponse | null>(null);
  const [pendingUiPackId, setPendingUiPackId] = useState<WorkbenchUiPackId | null>(null);

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

  return {
    ...labels.settingsSurface,
    localeValue: preferences.locale,
    themeValue: preferences.theme,
    uiStyleValue: pendingUiPackId ?? preferences.uiPackId,
    terminalThemeValue: preferences.terminalThemePreset,
    splitTriggerModeValue: preferences.splitTriggerMode,
    splitThreePaneLayoutValue: preferences.splitThreePaneLayout,
    splitOverflowPolicyValue: preferences.splitOverflowPolicy,
    aiRichRenderValue: preferences.aiRichRenderingEnabled,
    aiStopBehaviorValue: preferences.aiStopBehavior,
    preventSleepValue: preferences.preventSleepEnabled,
    jsReplValue: jsReplEnabled,
    forceWebPageThemingValue: preferences.forceWebPageThemingEnabled,
    searchScopeValue: preferences.searchScopePreset,
    searchCustomRootsValue: preferences.searchCustomRoots.join("\n"),
    searchWebEngineIds: preferences.searchWebEngineIds,
    searchSearxngEndpointValue: preferences.searchSearxngEndpoint ?? "",
    searchDeepBudgetValue: preferences.deepSearchDefaultBudget,
    deepSearchRestoreViewportValue: preferences.deepSearchRestoreViewport,
    deepSearchLocalOpenBehaviorValue: preferences.deepSearchLocalOpenBehavior,
    deepSearchSiteExpansionValue: preferences.deepSearchSiteExpansionEnabled,
    deepSearchProactiveGuessValue: preferences.deepSearchProactiveDomainGuessingEnabled,
    deepSearchCrawlPolicyValue: preferences.deepSearchCrawlPolicy,
    searchEnableFuzzyValue: preferences.searchEnableFuzzy,
    searchEnableContentValue: preferences.searchEnableContent,
    searchIncludeHiddenValue: preferences.searchIncludeHidden,
    searchAutoIndexValue: preferences.searchAutoIndexEnabled,
    searchIndexStatusValue: formatSearchIndexStatus(searchIndexStatus),
    searchRebuildIndexPending,
    omniboxNonBrowserSubmitTargetValue: preferences.omniboxNonBrowserSubmitTarget,
    localeOptions: labels.settingsOptions.locale,
    themeOptions: labels.settingsOptions.theme,
    uiStyleOptions,
    terminalThemeOptions: labels.settingsOptions.terminalTheme,
    splitTriggerModeOptions: labels.settingsOptions.splitTriggerMode,
    splitThreePaneLayoutOptions: labels.settingsOptions.splitThreePaneLayout,
    splitOverflowPolicyOptions: labels.settingsOptions.splitOverflowPolicy,
    searchScopeOptions: labels.settingsOptions.searchScope,
    searchDeepBudgetOptions: labels.settingsOptions.deepSearchBudget,
    deepSearchLocalOpenBehaviorOptions: labels.settingsOptions.deepSearchLocalOpenBehavior,
    deepSearchCrawlPolicyOptions: labels.settingsOptions.deepSearchCrawlPolicy,
    searchWebEngineOptions: labels.settingsOptions.searchWebEngine,
    omniboxNonBrowserSubmitTargetOptions: labels.settingsOptions.omniboxNonBrowserSubmitTarget,
    aiLabels: labels.settingsAi,
    aiModel: {
      ...settingsAiModel,
      browserAutomationEngine: preferences.browserAutomationEngine,
      lyraDirectMicroExecutorBudget: preferences.lyraDirectMicroExecutorBudget,
      browserUseRuntimeStatus,
      setBrowserAutomationEngine: preferencesModel.setBrowserAutomationEngine,
      setLyraDirectMicroExecutorBudget: preferencesModel.setLyraDirectMicroExecutorBudget
    },
    onLocaleChange: preferencesModel.setLocale,
    onThemeChange: preferencesModel.setTheme,
    onUiStyleChange: handleUiStyleChange,
    onTerminalThemeChange: preferencesModel.setTerminalThemePreset,
    onSplitTriggerModeChange: preferencesModel.setSplitTriggerMode,
    onSplitThreePaneLayoutChange: preferencesModel.setSplitThreePaneLayout,
    onSplitOverflowPolicyChange: preferencesModel.setSplitOverflowPolicy,
    onAiRichRenderChange: preferencesModel.setAiRichRenderingEnabled,
    onAiStopBehaviorChange: preferencesModel.setAiStopBehavior,
    onPreventSleepChange: preferencesModel.setPreventSleepEnabled,
    onJsReplChange,
    onForceWebPageThemingChange: preferencesModel.setForceWebPageThemingEnabled,
    onSearchScopeChange: preferencesModel.setSearchScopePreset,
    onSearchCustomRootsChange: (value: string) => {
      preferencesModel.setSearchCustomRoots(
        value
          .split(/\r?\n/g)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0)
      );
    },
    onSearchWebEnginesChange: preferencesModel.setSearchWebEngineIds,
    onSearchSearxngEndpointChange: (value: string) => {
      preferencesModel.setSearchSearxngEndpoint(value);
    },
    onSearchDeepBudgetChange: preferencesModel.setDeepSearchDefaultBudget,
    onDeepSearchRestoreViewportChange: preferencesModel.setDeepSearchRestoreViewport,
    onDeepSearchLocalOpenBehaviorChange: preferencesModel.setDeepSearchLocalOpenBehavior,
    onDeepSearchSiteExpansionChange: preferencesModel.setDeepSearchSiteExpansionEnabled,
    onDeepSearchProactiveGuessChange: preferencesModel.setDeepSearchProactiveDomainGuessingEnabled,
    onDeepSearchCrawlPolicyChange: preferencesModel.setDeepSearchCrawlPolicy,
    onSearchEnableFuzzyChange: preferencesModel.setSearchEnableFuzzy,
    onSearchEnableContentChange: preferencesModel.setSearchEnableContent,
    onSearchIncludeHiddenChange: preferencesModel.setSearchIncludeHidden,
    onSearchAutoIndexChange: preferencesModel.setSearchAutoIndexEnabled,
    onSearchRebuildIndex,
    onOmniboxNonBrowserSubmitTargetChange: preferencesModel.setOmniboxNonBrowserSubmitTarget
  };
};

export const formatWorkbenchSearchIndexStatusForTests = formatSearchIndexStatus;
