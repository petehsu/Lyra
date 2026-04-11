import { useCallback, useEffect, useMemo, useState } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { WorkspaceTab } from "../workspace-tabs";
import { readElementPickerAppearance } from "./element-picker-appearance";

type UseTitlebarElementPickerModelOptions = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly activeTab: WorkspaceTab | undefined;
  readonly enableLabel: string;
  readonly disableLabel: string;
  readonly activeLabel: string;
};

type TitlebarElementPickerModel = {
  readonly visible: boolean;
  readonly enabled: boolean;
  readonly ariaLabel: string;
  readonly activeDescription: string | undefined;
  readonly onToggle: () => void;
};

export const useTitlebarElementPickerModel = ({
  desktopApi,
  activeTab,
  enableLabel,
  disableLabel,
  activeLabel
}: UseTitlebarElementPickerModelOptions): TitlebarElementPickerModel => {
  const [enabledTabId, setEnabledTabId] = useState<string | null>(null);

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
          return event.state.tabId;
        }
        if (current === event.state.tabId) {
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
    void desktopApi.workbenchBrowser.setElementPickerMode({
      tabId: activeTab.id,
      enabled: !enabled,
      ...(!enabled ? { appearance: readElementPickerAppearance() } : {})
    });
  }, [activeTab, desktopApi, enabled]);

  return useMemo(
    () => ({
      visible,
      enabled,
      ariaLabel: enabled ? disableLabel : enableLabel,
      activeDescription: enabled ? activeLabel : undefined,
      onToggle
    }),
    [activeLabel, disableLabel, enableLabel, enabled, onToggle, visible]
  );
};
