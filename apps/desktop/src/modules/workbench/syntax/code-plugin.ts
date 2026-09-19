import { createCodePlugin } from "@streamdown/code";

import { lyraDarkTheme, lyraLightTheme } from "../ai-panel/lyra-agents/features/rich-text/lyra-shiki-themes";

export const lyraCodePlugin = createCodePlugin({
  themes: [lyraLightTheme, lyraDarkTheme]
});
