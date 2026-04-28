import type { WorkbenchThemeVars } from "../theme";
import type { I18nKey } from "../i18n";

export type WorkbenchUiStyleId = string;

export type WorkbenchUiStyleVars = Partial<WorkbenchThemeVars>;

export type WorkbenchUiStyleRootAttributes = {
  readonly "data-lyra-ui-style": WorkbenchUiStyleId;
};

export type WorkbenchUiStyleCapabilities = {
  readonly source: "builtin" | "external";
  readonly supportsCustomCss: boolean;
  readonly supportsSurfaceAdapters: boolean;
  readonly supportsCommunityDistribution: boolean;
};

export type WorkbenchUiStylePack = {
  readonly id: WorkbenchUiStyleId;
  readonly labelKey: I18nKey;
  readonly descriptionKey: I18nKey;
  readonly rootClassName: string;
  readonly documentClassName: string;
  readonly rootAttributes: WorkbenchUiStyleRootAttributes;
  readonly vars: WorkbenchUiStyleVars;
  readonly capabilities: WorkbenchUiStyleCapabilities;
};
