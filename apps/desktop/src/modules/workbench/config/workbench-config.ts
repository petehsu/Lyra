import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchThemeId } from "../theme";
import type { WorkbenchUiPackId } from "../ui-platform";

// ponytail: 首次启动检测 OS locale；已保存的偏好通过 preferences/service.ts localStorage 优先覆盖
const detectInitialLocale = (): WorkbenchLocale => {
  if (typeof navigator === "undefined") return "en-US";
  try {
    return Intl.getCanonicalLocales(navigator.language)[0] ?? "en-US";
  } catch {
    return "en-US";
  }
};

const docsEntryAddress =
  import.meta.env.VITE_LYRA_DOCS_ENTRY_ADDRESS ?? "https://lyra-docs.x13102306563.workers.dev/docs";

export const WORKBENCH_CONFIG = {
  locale: detectInitialLocale() as WorkbenchLocale,
  theme: "lyra-system" as WorkbenchThemeId,
  uiPackId: "classic" as WorkbenchUiPackId,
  browser: {
    homeSearchAddress: "lyra://search",
    docsEntryAddress,
    maxSearchTitleLength: 18,
    resultsPerEngine: 5,
    searchEngines: [
      {
        id: "bing",
        label: "Bing",
        accentColor: "#008373",
        searchUrlTemplate: "https://www.bing.com/search?q={searchTerms}&ensearch=1",
        enabledByDefault: true
      },
      {
        id: "google",
        label: "Google",
        accentColor: "#4285F4",
        searchUrlTemplate: "https://www.google.com/search?q={searchTerms}",
        enabledByDefault: true
      }
    ]
  }
} as const;
