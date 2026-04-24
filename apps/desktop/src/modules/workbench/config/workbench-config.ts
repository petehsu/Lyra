import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchThemeId } from "../theme";
import type { TerminalThemeMode } from "../terminal-theme";

export const WORKBENCH_CONFIG = {
  locale: "zh-CN" as WorkbenchLocale,
  theme: "lyra-system" as WorkbenchThemeId,
  terminalThemePreset: "follow-app" as TerminalThemeMode,
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
