import type { I18nKey } from "../i18n";
import { WORKBENCH_UI_PACK_IDS, type WorkbenchUiPackId } from "./ids";

export type WorkbenchUiPackOption = {
  readonly value: WorkbenchUiPackId;
  readonly label: string;
  readonly description: string;
};

const builtinPackCopy = {
  classic: {
    labelKey: "settings.uiStyle.classic",
    descriptionKey: "settings.uiStyleDescription.classic"
  }
} as const satisfies Record<string, {
  readonly labelKey: I18nKey;
  readonly descriptionKey: I18nKey;
}>;

export const createWorkbenchUiPackOptions = (
  t: (key: I18nKey) => string
): readonly WorkbenchUiPackOption[] =>
  WORKBENCH_UI_PACK_IDS.map((packId) => {
    const copy = builtinPackCopy[packId];
    if (copy === undefined) {
      throw new Error(`Missing UI pack copy for ${packId}`);
    }
    return {
      value: packId,
      label: t(copy.labelKey),
      description: t(copy.descriptionKey)
    };
  });
