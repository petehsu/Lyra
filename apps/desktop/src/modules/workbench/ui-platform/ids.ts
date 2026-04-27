export type WorkbenchUiPackId = "classic";

export const DEFAULT_WORKBENCH_UI_PACK_ID: WorkbenchUiPackId = "classic";

export const WORKBENCH_UI_PACK_IDS: readonly WorkbenchUiPackId[] = [
  "classic"
] as const;

export const isWorkbenchUiPackId = (value: unknown): value is WorkbenchUiPackId =>
  typeof value === "string" && WORKBENCH_UI_PACK_IDS.includes(value as WorkbenchUiPackId);

export const resolveWorkbenchUiPackId = (value: unknown): WorkbenchUiPackId =>
  isWorkbenchUiPackId(value) ? value : DEFAULT_WORKBENCH_UI_PACK_ID;
