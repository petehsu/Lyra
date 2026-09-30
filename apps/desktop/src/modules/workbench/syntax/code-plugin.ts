import { bundledLanguages, createHighlighter, type Highlighter, type TokensResult } from "shiki";
import type { CodeHighlighterPlugin, HighlightOptions } from "streamdown";

import { lyraDarkTheme, lyraLightTheme } from "../ai-panel/lyra-agents/features/rich-text/lyra-shiki-themes";

const themes: HighlightOptions["themes"] = [lyraLightTheme, lyraDarkTheme];
let highlighter: Highlighter | undefined;
let load: Promise<Highlighter> | undefined;
const cache: Array<{ options: HighlightOptions; result: TokensResult }> = [];

const themeName = (theme: HighlightOptions["themes"][number]): string =>
  typeof theme === "string" ? theme : theme.name!;

const supportsLanguage = (language: string): boolean =>
  Object.hasOwn(bundledLanguages, language.trim().toLowerCase());

const tokenize = (options: HighlightOptions): TokensResult => {
  const index = cache.findIndex((entry) => entry.options.code === options.code
    && entry.options.language === options.language
    && entry.options.themes[0] === options.themes[0]
    && entry.options.themes[1] === options.themes[1]);
  if (index >= 0) {
    const entry = cache.splice(index, 1)[0]!;
    cache.unshift(entry);
    return entry.result;
  }
  const result = highlighter!.codeToTokens(options.code, {
    lang: options.language,
    themes: { light: themeName(options.themes[0]), dark: themeName(options.themes[1]) },
    tokenizeMaxLineLength: 20_000
  });
  cache.unshift({ options, result });
  let characters = 0;
  for (let index = 0; index < cache.length; index += 1) {
    characters += cache[index]!.options.code.length;
    if (index >= 16 || (index > 0 && characters > 1_000_000)) {
      cache.length = index;
      break;
    }
  }
  return result;
};

/**
 * ZCode also selects Shiki's Oniguruma WASM engine. Avoid permanently caching
 * translated JavaScript regexes and every intermediate version of a code fence.
 * Exact source keys also avoid @streamdown/code's first/last-100-char collisions.
 */
export const lyraCodePlugin: CodeHighlighterPlugin = {
  name: "shiki",
  type: "code-highlighter",
  getThemes: () => themes,
  getSupportedLanguages: () => Object.keys(bundledLanguages) as ReturnType<CodeHighlighterPlugin["getSupportedLanguages"]>,
  supportsLanguage,
  highlight(options, callback) {
    const normalized = options.language.trim().toLowerCase();
    const language = supportsLanguage(normalized) ? normalized : "text";
    const request = { ...options, language } as HighlightOptions;
    const ready = highlighter !== undefined
      && (language === "text" || highlighter.getLoadedLanguages().includes(language))
      && options.themes.every((theme) => highlighter!.getLoadedThemes().includes(themeName(theme)));
    if (ready) return tokenize(request);

    load ??= createHighlighter({
      langs: [],
      themes
    }).then((instance) => {
      highlighter = instance;
      return instance;
    });
    void load.then(async (instance) => {
      await Promise.all([
        language === "text" ? undefined : instance.loadLanguage(language as HighlightOptions["language"]),
        instance.loadTheme(...options.themes)
      ]);
      callback?.(tokenize(request));
    }).catch((error: unknown) => {
      console.error("[Lyra Code] Failed to highlight code:", error);
    });
    return null;
  }
};
