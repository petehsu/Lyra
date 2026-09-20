import type { WorkbenchTheme } from "../types";
import { createThemeVars } from "./shared";

type LyraResolvedThemeId = "lyra-light" | "lyra-dark";

export const LYRA_RESOLVED_THEMES: Record<LyraResolvedThemeId, WorkbenchTheme> = {
  "lyra-light": {
    id: "lyra-light",
    vars: createThemeVars({
      "--lyra-app-bg": "#f7f7f7",
      "--lyra-app-sidebar-bg": "#f7f7f7",
      "--lyra-app-panel-bg": "#f7f7f7",
      "--lyra-app-surface-bg": "#f7f7f7",
      "--lyra-app-surface-strong-bg": "#ececec",
      "--lyra-app-muted-bg": "#ececec",
      "--lyra-app-row-bg": "transparent",
      "--lyra-app-row-hover-bg": "#ebebeb",
      "--lyra-app-row-active-bg": "#e2e2e2",
      "--lyra-app-row-active-border": "#d0d0d0",
      "--lyra-app-input-bg": "#ffffff",
      "--lyra-app-input-hover-bg": "#ffffff",
      "--lyra-app-input-focus-bg": "#ffffff",
      "--lyra-app-input-border": "#d4d4d4",
      "--lyra-app-input-focus-border": "#8e8f91",
      "--lyra-app-input-placeholder": "#6a6b6f",
      "--lyra-app-border": "#e8e8e8",
      "--lyra-app-border-strong": "#d0d0d0",
      "--lyra-app-focus": "rgba(24, 24, 27, 0.22)",
      "--lyra-app-primary-button": "#1c1c1e",
      "--lyra-app-primary-button-fg": "#ffffff",
      "--lyra-app-switch-on": "#52a66f",
      "--lyra-app-popover-bg": "#ffffff",
      "--lyra-app-overlay-bg": "rgba(16, 18, 24, 0.36)",
      "--lyra-text-primary": "#1a1a1c",
      "--lyra-text-secondary": "#3f4043",
      "--lyra-text-muted": "#5c5d61",
      "--lyra-text-accent": "#1c1c1e",
      "--lyra-window-close-hover-bg": "#d36151",
      "--lyra-status-success": "#669f59",
      "--lyra-status-warning": "#a48819",
      "--lyra-status-error": "#d36151"
    })
  },
  "lyra-dark": {
    id: "lyra-dark",
    vars: createThemeVars({
      "--lyra-app-bg": "#181818",
      "--lyra-app-sidebar-bg": "#181818",
      "--lyra-app-panel-bg": "#181818",
      "--lyra-app-surface-bg": "#181818",
      "--lyra-app-surface-strong-bg": "#242424",
      "--lyra-app-muted-bg": "#141414",
      "--lyra-app-row-bg": "transparent",
      "--lyra-app-row-hover-bg": "#222222",
      "--lyra-app-row-active-bg": "#2e2e2e",
      "--lyra-app-row-active-border": "#3a3a3a",
      "--lyra-app-input-bg": "#141414",
      "--lyra-app-input-hover-bg": "#1c1c1c",
      "--lyra-app-input-focus-bg": "#1c1c1c",
      "--lyra-app-input-border": "#333333",
      "--lyra-app-input-focus-border": "#6a6b6c",
      "--lyra-app-input-placeholder": "#8a8b8c",
      "--lyra-app-border": "#2a2a2a",
      "--lyra-app-border-strong": "#3a3a3a",
      "--lyra-app-focus": "rgba(255, 255, 255, 0.20)",
      "--lyra-app-primary-button": "#ececec",
      "--lyra-app-primary-button-fg": "#111111",
      "--lyra-app-switch-on": "#5aac75",
      "--lyra-app-popover-bg": "#242424",
      "--lyra-app-overlay-bg": "rgba(4, 6, 10, 0.55)",
      "--lyra-text-primary": "#e8e8e8",
      "--lyra-text-secondary": "#a8a8a8",
      "--lyra-text-muted": "#8a8b8c",
      "--lyra-text-accent": "#ececec",
      "--lyra-window-close-hover-bg": "#d07277",
      "--lyra-status-success": "#a1c181",
      "--lyra-status-warning": "#dec184",
      "--lyra-status-error": "#d07277"
    })
  }
};
