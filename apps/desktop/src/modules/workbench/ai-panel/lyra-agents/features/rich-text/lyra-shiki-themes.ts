/**
 * Shiki themes for Streamdown / HighlightedSource. Token hexes come from
 * syntax/palette.ts so they match Monaco's editor theme.
 */

import type { ThemeInput } from "@streamdown/code";

import { LYRA_SYNTAX_DARK, LYRA_SYNTAX_LIGHT, type SyntaxPalette } from "@workbench/syntax/palette";

const toShikiTheme = (
  name: string,
  type: "dark" | "light",
  displayName: string,
  palette: SyntaxPalette,
  background: string,
  foreground: string
): ThemeInput => ({
  name,
  type,
  displayName,
  colors: {
    "editor.background": background,
    "editor.foreground": foreground
  },
  settings: [
    { scope: "comment", settings: { foreground: palette.comment, fontStyle: "italic" } },
    { scope: ["string", "string.quoted", "string.regexp"], settings: { foreground: palette.string } },
    { scope: ["constant.numeric", "constant.language", "constant"], settings: { foreground: palette.number } },
    {
      scope: ["keyword", "keyword.control", "storage.type", "storage.modifier"],
      settings: { foreground: palette.keyword }
    },
    { scope: ["keyword.operator", "operator"], settings: { foreground: palette.operator } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: palette.function } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: palette.type } },
    { scope: ["entity.name.namespace"], settings: { foreground: palette.type } },
    { scope: ["variable", "variable.other", "variable.predefined"], settings: { foreground: palette.variable } },
    { scope: ["variable.parameter", "meta.definition.variable"], settings: { foreground: palette.parameter } },
    { scope: ["punctuation", "punctuation.definition", "meta.delimiter"], settings: { foreground: palette.parameter } },
    { scope: "meta", settings: { foreground: palette.parameter } },
    { scope: ["entity.name.tag"], settings: { foreground: palette.tag } },
    { scope: ["entity.other.attribute-name", "attribute.name"], settings: { foreground: palette.number } },
    { scope: ["markup.heading"], settings: { foreground: palette.function } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } }
  ]
});

export const lyraDarkTheme: ThemeInput = toShikiTheme(
  "lyra-dark",
  "dark",
  "Lyra Dark",
  LYRA_SYNTAX_DARK,
  "#191919",
  "#dedede"
);

export const lyraLightTheme: ThemeInput = toShikiTheme(
  "lyra-light",
  "light",
  "Lyra Light",
  LYRA_SYNTAX_LIGHT,
  "#ffffff",
  "#24292e"
);
