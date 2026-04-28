import { CLASSIC_WORKBENCH_UI_STYLE_PACK } from "./classic";
import type { createTranslator } from "../i18n";
import type { WorkbenchUiStyleId, WorkbenchUiStylePack } from "./types";

export const DEFAULT_WORKBENCH_UI_STYLE_ID: WorkbenchUiStyleId = "classic";

export const WORKBENCH_UI_STYLE_IDS: readonly WorkbenchUiStyleId[] = [
  "classic"
] as const;

const WORKBENCH_UI_STYLE_PACKS: Record<string, WorkbenchUiStylePack> = {
  classic: CLASSIC_WORKBENCH_UI_STYLE_PACK
};

export const isWorkbenchUiStyleId = (value: unknown): value is WorkbenchUiStyleId =>
  typeof value === "string" && WORKBENCH_UI_STYLE_IDS.includes(value as WorkbenchUiStyleId);

export const resolveWorkbenchUiStyleId = (value: unknown): WorkbenchUiStyleId =>
  isWorkbenchUiStyleId(value) ? value : DEFAULT_WORKBENCH_UI_STYLE_ID;

export const resolveWorkbenchUiStylePack = (
  styleId: unknown = DEFAULT_WORKBENCH_UI_STYLE_ID
): WorkbenchUiStylePack =>
  WORKBENCH_UI_STYLE_PACKS[resolveWorkbenchUiStyleId(styleId)] ?? CLASSIC_WORKBENCH_UI_STYLE_PACK;

export type WorkbenchUiStyleOption = {
  readonly value: WorkbenchUiStyleId;
  readonly label: string;
  readonly description: string;
};

export const createWorkbenchUiStyleOptions = (
  t: ReturnType<typeof createTranslator>
): readonly WorkbenchUiStyleOption[] =>
  WORKBENCH_UI_STYLE_IDS.map((styleId) => {
    const stylePack = WORKBENCH_UI_STYLE_PACKS[styleId] ?? CLASSIC_WORKBENCH_UI_STYLE_PACK;
    return {
      value: stylePack.id,
      label: t(stylePack.labelKey),
      description: t(stylePack.descriptionKey)
    };
  });

export const syncWorkbenchUiStyleToDocument = (stylePack: WorkbenchUiStylePack): void => {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  for (const id of WORKBENCH_UI_STYLE_IDS) {
    root.classList.remove((WORKBENCH_UI_STYLE_PACKS[id] ?? CLASSIC_WORKBENCH_UI_STYLE_PACK).documentClassName);
  }
  root.classList.add(stylePack.documentClassName);
  root.dataset.lyraUiStyle = stylePack.id;
};
