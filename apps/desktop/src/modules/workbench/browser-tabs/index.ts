export { BrowserTabStrip } from "./tab-strip";
export type { BrowserTabStripProps, BrowserTabDropRequest } from "./tab-strip";
export { ClassicWorkspaceTabsAdapter } from "./classic-workspace-tabs-adapter";
export {
  hasClassicCtrlLeftSplitIntent,
  hasMovedPastRightDragThreshold,
  isClassicRightDragSplitEnabled,
  resolveWorkspaceTabDropTarget
} from "./tab-interactions";
export type {
  ResolveWorkspaceTabDropTargetInput,
  WorkspaceTabDropRect,
  WorkspaceTabDropTarget
} from "./tab-interactions";
export { BrowserSearchSurface } from "./search-surface";
export type { BrowserSearchSurfaceProps } from "./search-surface";
export { BrowserPageSurface } from "./page-surface";
export type { BrowserPageSurfaceProps } from "./page-surface";
export { BrowserSettingsSurface } from "./settings-surface";
export type { BrowserSettingsSurfaceProps } from "./settings-surface";
export { createWorkbenchSettingsSchema } from "./settings-schema";
export {
  buildSettingsCategoryDomId,
  createSettingsSurfaceModel
} from "./settings-render-model";
export type {
  SettingsCategoryId,
  SettingsFieldId,
  SettingsFieldKind,
  WorkbenchSettingsCategory,
  WorkbenchSettingsField,
  WorkbenchSettingsSchema,
  WorkbenchSettingsSection
} from "./settings-schema";
export type {
  SettingsBooleanChoiceControlDescriptor,
  SettingsChoiceControlDescriptor,
  SettingsControlDescriptor,
  SettingsCustomControlDescriptor,
  SettingsInlineStatusActionControlDescriptor,
  SettingsMultiChoiceControlDescriptor,
  SettingsPreviewKind,
  SettingsRenderedCategory,
  SettingsRenderedSection,
  SettingsSurfaceModel,
  SettingsTextControlDescriptor,
  SettingsToggleDescriptor,
  SettingsToggleGroupControlDescriptor
} from "./settings-render-model";
export type { SettingsOption } from "./settings-surface-types";
