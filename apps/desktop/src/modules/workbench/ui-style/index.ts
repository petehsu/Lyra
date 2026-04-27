export {
  DEFAULT_WORKBENCH_UI_STYLE_ID,
  WORKBENCH_UI_STYLE_IDS,
  createWorkbenchUiStyleOptions,
  isWorkbenchUiStyleId,
  resolveWorkbenchUiStyleId,
  resolveWorkbenchUiStylePack,
  syncWorkbenchUiStyleToDocument
} from "./service";
export type { WorkbenchUiStyleOption } from "./service";
export { useWorkbenchUiStyleRuntime } from "./use-workbench-ui-style-runtime";
export type { WorkbenchUiStyleRuntime } from "./use-workbench-ui-style-runtime";
export type {
  WorkbenchUiStyleCapabilities,
  WorkbenchUiStyleId,
  WorkbenchUiStylePack,
  WorkbenchUiStyleRootAttributes,
  WorkbenchUiStyleVars
} from "./types";
