export type WorkbenchUiPackId = string;

export const DEFAULT_WORKBENCH_UI_PACK_ID: WorkbenchUiPackId = "classic";

export const WORKBENCH_UI_PACK_IDS: readonly WorkbenchUiPackId[] = [
  "classic"
] as const;

export const EXTERNAL_WORKBENCH_UI_PACK_ID_PREFIX = "external:";

export const isBuiltinWorkbenchUiPackId = (value: unknown): value is WorkbenchUiPackId =>
  typeof value === "string" && WORKBENCH_UI_PACK_IDS.includes(value as WorkbenchUiPackId);

export const isExternalWorkbenchUiPackId = (value: unknown): value is WorkbenchUiPackId =>
  typeof value === "string"
  && value.startsWith(EXTERNAL_WORKBENCH_UI_PACK_ID_PREFIX)
  && value.length > EXTERNAL_WORKBENCH_UI_PACK_ID_PREFIX.length;

export const isWorkbenchUiPackId = (value: unknown): value is WorkbenchUiPackId =>
  isBuiltinWorkbenchUiPackId(value) || isExternalWorkbenchUiPackId(value);

export const resolveWorkbenchUiPackId = (value: unknown): WorkbenchUiPackId =>
  typeof value === "string" && isWorkbenchUiPackId(value.trim())
    ? value.trim()
    : DEFAULT_WORKBENCH_UI_PACK_ID;
