import type { WorkbenchTheme } from "../types";
import { createThemeVars } from "./shared";

type LyraResolvedThemeId = "lyra-light" | "lyra-dark";

export const LYRA_RESOLVED_THEMES: Record<LyraResolvedThemeId, WorkbenchTheme> = {
  "lyra-light": {
    id: "lyra-light",
    vars: createThemeVars({
      "--lyra-app-bg": "#f6f5f6",
      "--lyra-app-sidebar-bg": "#ebebea",
      "--lyra-app-panel-bg": "#f6f5f6",
      "--lyra-app-surface-bg": "#edeced",
      "--lyra-app-surface-strong-bg": "#f3f2f3",
      "--lyra-app-muted-bg": "#ebebea",
      "--lyra-app-row-bg": "transparent",
      "--lyra-app-row-hover-bg": "#e4e3e4",
      "--lyra-app-row-active-bg": "#dcdbdc",
      "--lyra-app-row-active-border": "#c5c7c7",
      "--lyra-app-input-bg": "#f3f2f3",
      "--lyra-app-input-hover-bg": "#f6f5f6",
      "--lyra-app-input-focus-bg": "#f6f5f6",
      "--lyra-app-input-border": "#dedddd",
      "--lyra-app-input-focus-border": "#a9aaac",
      "--lyra-app-input-placeholder": "#6f7074",
      "--lyra-app-border": "#dedddd",
      "--lyra-app-border-strong": "#c5c7c7",
      "--lyra-app-focus": "rgba(24, 24, 27, 0.18)",
      "--lyra-app-primary-button": "#2f3033",
      "--lyra-app-primary-button-fg": "#ffffff",
      "--lyra-app-switch-on": "#52a66f",
      "--lyra-app-popover-bg": "#f6f5f6",
      "--lyra-app-overlay-bg": "rgba(16, 18, 24, 0.36)",
      "--lyra-text-primary": "#242529",
      "--lyra-text-secondary": "#4f5054",
      "--lyra-text-muted": "#6f7074",
      "--lyra-text-accent": "#2f3033",
      "--lyra-window-close-hover-bg": "#d36151",
      "--lyra-status-success": "#669f59",
      "--lyra-status-warning": "#a48819",
      "--lyra-status-error": "#d36151"
    })
  },
  "lyra-dark": {
    id: "lyra-dark",
    vars: createThemeVars({
      "--lyra-app-bg": "#191919",
      "--lyra-app-sidebar-bg": "#1c1c1c",
      "--lyra-app-panel-bg": "#191919",
      "--lyra-app-surface-bg": "#1c1c1c",
      "--lyra-app-surface-strong-bg": "#222221",
      "--lyra-app-muted-bg": "#202020",
      "--lyra-app-row-bg": "transparent",
      "--lyra-app-row-hover-bg": "#222221",
      "--lyra-app-row-active-bg": "#2b2b2a",
      "--lyra-app-row-active-border": "#424445",
      "--lyra-app-input-bg": "#1c1c1c",
      "--lyra-app-input-hover-bg": "#222221",
      "--lyra-app-input-focus-bg": "#232322",
      "--lyra-app-input-border": "#303031",
      "--lyra-app-input-focus-border": "#5b5d5e",
      "--lyra-app-input-placeholder": "#858687",
      "--lyra-app-border": "#303031",
      "--lyra-app-border-strong": "#424445",
      "--lyra-app-focus": "rgba(255, 255, 255, 0.16)",
      "--lyra-app-primary-button": "#d7d7d8",
      "--lyra-app-primary-button-fg": "#181818",
      "--lyra-app-switch-on": "#5aac75",
      "--lyra-app-popover-bg": "#1c1c1c",
      "--lyra-app-overlay-bg": "rgba(4, 6, 10, 0.55)",
      "--lyra-text-primary": "#dedede",
      "--lyra-text-secondary": "#b6b6b6",
      "--lyra-text-muted": "#8e8f90",
      "--lyra-text-accent": "#d7d7d8",
      "--lyra-window-close-hover-bg": "#d07277",
      "--lyra-status-success": "#a1c181",
      "--lyra-status-warning": "#dec184",
      "--lyra-status-error": "#d07277"
    })
  }
};
