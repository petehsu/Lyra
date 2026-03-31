import type { WorkbenchLayoutPreset, WorkbenchPanelKey } from "../shell/types";

export type IntentBarProps = {
  readonly appVersion: string;
  readonly intentValue: string;
  readonly placeholder: string;
  readonly activePreset: WorkbenchLayoutPreset;
  readonly showFiles: boolean;
  readonly showAi: boolean;
  readonly showRuntime: boolean;
  readonly onIntentValueChange: (value: string) => void;
  readonly onRunIntent: () => void;
  readonly onPresetChange: (preset: WorkbenchLayoutPreset) => void;
  readonly onTogglePanel: (panel: WorkbenchPanelKey) => void;
  readonly onMinimizeWindow: () => void;
  readonly onToggleMaximizeWindow: () => void;
  readonly onCloseWindow: () => void;
};
