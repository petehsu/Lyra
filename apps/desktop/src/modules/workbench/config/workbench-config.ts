import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchThemeId } from "../theme";
import type { TerminalThemeMode } from "../terminal-theme";
import type { WorkbenchUiPackId } from "../ui-platform";

const docsEntryAddress =
  import.meta.env.VITE_LYRA_DOCS_ENTRY_ADDRESS ?? "http://localhost:5174/docs";

export const WORKBENCH_CONFIG = {
  locale: "zh-CN" as WorkbenchLocale,
  theme: "lyra-system" as WorkbenchThemeId,
  terminalThemePreset: "follow-app" as TerminalThemeMode,
  uiPackId: "classic" as WorkbenchUiPackId,
  browser: {
    homeSearchAddress: "lyra://search",
    docsEntryAddress,
    maxSearchTitleLength: 18,
    resultsPerEngine: 5,
    searchEngines: [
      { id: "bing", label: "Bing", accentColor: "#008373" },
      { id: "brave", label: "Brave", accentColor: "#FB542B" },
      { id: "duckduckgo", label: "DuckDuckGo", accentColor: "#DE5833" }
    ]
  }
} as const;
