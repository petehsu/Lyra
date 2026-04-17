import { useCallback, useEffect, useMemo, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserElementPickerMode } from "../../../shared/workbench-browser";
import type { WorkspaceTab } from "../workspace-tabs";
import { readElementPickerAppearance } from "./element-picker-appearance";

type UseTitlebarElementPickerModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly activeTab: WorkspaceTab | undefined;
  readonly enableLabel: string;
  readonly disableLabel: string;
  readonly activeLabel: string;
  readonly inspectLabel: string;
  readonly layoutLabel: string;
};

type TitlebarElementPickerModel = {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly mode: WorkbenchBrowserElementPickerMode;
  readonly ariaLabel: string;
  readonly activeDescription: string | undefined;
  readonly onToggle: () => void;
};

export const useTitlebarElementPickerModel = ({
  desktopApi,
  activeTab,
  enableLabel,
  disableLabel,
  activeLabel,
  inspectLabel,
  layoutLabel
}: UseTitlebarElementPickerModelOptions): TitlebarElementPickerModel => {
  const [enabledTabId, setEnabledTabId] = useState<string | null>(null);
  const [mode, setMode] = useState<WorkbenchBrowserElementPickerMode>("inspect");

  useEffect(() => {
    if (desktopApi === null) {
      setEnabledTabId(null);
      return;
    }
    return desktopApi.workbenchBrowser.onEvent((event) => {
      if (event.kind !== "element-picker-state") {
        return;
      }
      setEnabledTabId((current) => {
        if (event.state.enabled) {
          setMode(event.state.mode ?? "inspect");
          return event.state.tabId;
        }
        if (current === event.state.tabId) {
          setMode(event.state.mode ?? "inspect");
          return null;
        }
        return current;
      });
    });
  }, [desktopApi]);

  const visible = activeTab?.pageKind === "page";
  const enabled = visible && activeTab !== undefined && enabledTabId === activeTab.id;

  const onToggle = useCallback((): void => {
    if (desktopApi === null || activeTab?.pageKind !== "page") {
      return;
    }
    const nextMode: WorkbenchBrowserElementPickerMode = !enabled
      ? "inspect"
      : mode === "inspect"
        ? "layout"
        : "inspect";
    void desktopApi.workbenchBrowser.setElementPickerMode({
      tabId: activeTab.id,
      enabled: !enabled || mode === "inspect",
      ...(enabled && mode === "layout"
        ? {}
        : {
            appearance: readElementPickerAppearance(),
            mode: nextMode
          })
    });
  }, [activeTab, desktopApi, enabled, mode]);

  return useMemo(
    () => ({
      visible,
      enabled,
      mode,
      ariaLabel: !enabled
        ? `${enableLabel} (${inspectLabel})`
        : mode === "inspect"
          ? `${layoutLabel}`
          : disableLabel,
      activeDescription: enabled
        ? `${activeLabel} · ${mode === "inspect" ? inspectLabel : layoutLabel}`
        : undefined,
      onToggle
    }),
    [activeLabel, disableLabel, enableLabel, enabled, inspectLabel, layoutLabel, mode, onToggle, visible]
  );
};
