import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchThemeId } from "../theme";
import type { TerminalThemePresetId } from "../terminal-theme";

export const WORKBENCH_CONFIG = {
  locale: "zh-CN" as WorkbenchLocale,
  theme: "one-system" as WorkbenchThemeId,
  terminalThemePreset: "glacier-blocks" as TerminalThemePresetId,
  browser: {
    homeSearchAddress: "lyra://search",
    docsEntryAddress: "http://localhost:5174/docs",
    maxSearchTitleLength: 18,
    resultsPerEngine: 5,
    searchEngines: [
      { id: "bing", label: "Bing", accentColor: "#008373" },
      { id: "brave", label: "Brave", accentColor: "#FB542B" },
      { id: "duckduckgo", label: "DuckDuckGo", accentColor: "#DE5833" }
    ]
  }
} as const;
