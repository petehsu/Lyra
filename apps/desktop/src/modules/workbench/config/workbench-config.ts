import type { WorkbenchLocale } from "../i18n";
import type { WorkbenchThemeId } from "../theme";
import type { WorkbenchUiPackId } from "../ui-platform";

// ponytail: 首次启动检测 OS locale；已保存的偏好通过 preferences/service.ts localStorage 优先覆盖
const detectInitialLocale = (): WorkbenchLocale => {
  if (typeof navigator === "undefined") return "zh-CN";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
};

const docsEntryAddress =
  import.meta.env.VITE_LYRA_DOCS_ENTRY_ADDRESS ?? "http://localhost:5174/docs";

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
        id: "google",
        label: "Google",
        accentColor: "#4285F4",
        searchUrlTemplate: "https://www.google.com/search?q={searchTerms}",
        enabledByDefault: true
      },
      {
        id: "bing",
        label: "Bing",
        accentColor: "#008373",
        searchUrlTemplate: "https://www.bing.com/search?q={searchTerms}",
        enabledByDefault: true
      },
      {
        id: "duckduckgo",
        label: "DuckDuckGo",
        accentColor: "#DE5833",
        searchUrlTemplate: "https://duckduckgo.com/?q={searchTerms}",
        probeUrlTemplate: "https://html.duckduckgo.com/html/?q={searchTerms}",
        enabledByDefault: true
      },
      {
        id: "brave",
        label: "Brave Search",
        accentColor: "#FB542B",
        searchUrlTemplate: "https://search.brave.com/search?q={searchTerms}&source=web",
        enabledByDefault: true
      },
      {
        id: "startpage",
        label: "Startpage",
        accentColor: "#6B6BEF",
        searchUrlTemplate: "https://www.startpage.com/sp/search?query={searchTerms}",
        enabledByDefault: true
      },
      {
        id: "qwant",
        label: "Qwant",
        accentColor: "#5C97FF",
        searchUrlTemplate: "https://www.qwant.com/?q={searchTerms}&t=web",
        enabledByDefault: true
      },
      {
        id: "mojeek",
        label: "Mojeek",
        accentColor: "#7BB92F",
        searchUrlTemplate: "https://www.mojeek.com/search?q={searchTerms}",
        enabledByDefault: true
      },
      {
        id: "yahoo",
        label: "Yahoo Search",
        accentColor: "#6001D2",
        searchUrlTemplate: "https://search.yahoo.com/search?p={searchTerms}",
        enabledByDefault: true
      },
      {
        id: "naver",
        label: "Naver",
        accentColor: "#03C75A",
        searchUrlTemplate: "https://search.naver.com/search.naver?query={searchTerms}",
        enabledByDefault: true
      }
    ]
  }
} as const;
