import type { WorkbenchLayoutPreset, WorkbenchPanelKey } from "../shell/types";

export type LayoutState = {
  readonly preset: WorkbenchLayoutPreset;
  readonly showFiles: boolean;
  readonly showAi: boolean;
  readonly showRuntime: boolean;
};

export type LayoutActions = {
  readonly setPreset: (preset: WorkbenchLayoutPreset) => void;
  readonly togglePanel: (panel: WorkbenchPanelKey) => void;
  readonly setPanelVisibility: (panel: WorkbenchPanelKey, visible: boolean) => void;
  readonly applyPresetDefaults: (preset: WorkbenchLayoutPreset) => void;
};

export type LayoutStore = LayoutState & LayoutActions;
