import type { WorkbenchUiStylePack } from "./types";

export const CLASSIC_WORKBENCH_UI_STYLE_PACK = {
  id: "classic",
  labelKey: "settings.uiStyle.classic",
  descriptionKey: "settings.uiStyleDescription.classic",
  rootClassName: "lyra-style-classic",
  documentClassName: "lyra-style-classic",
  rootAttributes: {
    "data-lyra-ui-style": "classic"
  },
  vars: {},
  capabilities: {
    source: "builtin",
    supportsCustomCss: false,
    supportsSurfaceAdapters: false,
    supportsCommunityDistribution: false
  }
} satisfies WorkbenchUiStylePack;
