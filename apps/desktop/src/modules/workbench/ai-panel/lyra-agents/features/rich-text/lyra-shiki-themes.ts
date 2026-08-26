/**
 * Lyra Shiki themes — maps the existing Monaco theme color palette (One Dark
 * style, from monaco-helpers.ts) to Shiki's TextMate-scope-based theme
 * format, so code highlighting in streamdown matches the previous Monaco
 * colorizeElement output.
 *
 * Color values mirror buildMonacoTheme() in file-editor/monaco-helpers.ts:
 *   comment:   #6b7280 (italic)
 *   string:    #a3d4a0
 *   number:    #d19a66
 *   keyword:   #c678dd
 *   operator:  #56b6c2
 *   type/fn:   #61afef
 *   variable:  #e06c75
 *   param/delim: #d5d7de
 *   tag:       #e06c75
 *   attribute: #d19a66
 *   bg:        --lyra-app-panel-bg (#0f1116)
 *   fg:        --lyra-text-primary (#d5d7de)
 */

import type { ThemeInput } from "@streamdown/code";

// ---- Dark theme (primary — Lyra's default dark UI) ----

export const lyraDarkTheme: ThemeInput = {
  name: "lyra-dark",
  type: "dark",
  displayName: "Lyra Dark",
  colors: {
    "editor.background": "#0f1116",
    "editor.foreground": "#d5d7de"
  },
  settings: [
    { scope: "comment", settings: { foreground: "#6b7280", fontStyle: "italic" } },
    { scope: ["string", "string.quoted", "string.regexp"], settings: { foreground: "#a3d4a0" } },
    { scope: ["constant.numeric", "constant.language", "constant"], settings: { foreground: "#d19a66" } },
    { scope: ["keyword", "keyword.control", "storage.type", "storage.modifier"], settings: { foreground: "#c678dd" } },
    { scope: ["keyword.operator", "operator"], settings: { foreground: "#56b6c2" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#61afef" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#61afef" } },
    { scope: ["entity.name.namespace"], settings: { foreground: "#61afef" } },
    { scope: ["variable", "variable.other", "variable.predefined"], settings: { foreground: "#e06c75" } },
    { scope: ["variable.parameter", "meta.definition.variable"], settings: { foreground: "#d5d7de" } },
    { scope: ["punctuation", "punctuation.definition", "meta.delimiter"], settings: { foreground: "#d5d7de" } },
    { scope: "meta", settings: { foreground: "#d5d7de" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#e06c75" } },
    { scope: ["entity.other.attribute-name", "attribute.name"], settings: { foreground: "#d19a66" } },
    { scope: ["markup.heading"], settings: { foreground: "#61afef" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } }
  ]
};

// ---- Light theme (for light UI mode) ----

// Light-mode palette: same One Dark token colors but on a light background.
// The token colors are adjusted for contrast: dark blue/purple on white.
export const lyraLightTheme: ThemeInput = {
  name: "lyra-light",
  type: "light",
  displayName: "Lyra Light",
  colors: {
    "editor.background": "#ffffff",
    "editor.foreground": "#24292e"
  },
  settings: [
    { scope: "comment", settings: { foreground: "#6a737d", fontStyle: "italic" } },
    { scope: ["string", "string.quoted", "string.regexp"], settings: { foreground: "#032f62" } },
    { scope: ["constant.numeric", "constant.language", "constant"], settings: { foreground: "#005cc5" } },
    { scope: ["keyword", "keyword.control", "storage.type", "storage.modifier"], settings: { foreground: "#d73a49" } },
    { scope: ["keyword.operator", "operator"], settings: { foreground: "#d73a49" } },
    { scope: ["entity.name.function", "support.function"], settings: { foreground: "#6f42c1" } },
    { scope: ["entity.name.type", "support.type", "support.class"], settings: { foreground: "#005cc5" } },
    { scope: ["entity.name.namespace"], settings: { foreground: "#005cc5" } },
    { scope: ["variable", "variable.other"], settings: { foreground: "#e36209" } },
    { scope: ["variable.parameter", "meta.definition.variable"], settings: { foreground: "#24292e" } },
    { scope: ["punctuation", "punctuation.definition", "meta.delimiter"], settings: { foreground: "#24292e" } },
    { scope: "meta", settings: { foreground: "#24292e" } },
    { scope: ["entity.name.tag"], settings: { foreground: "#22863a" } },
    { scope: ["entity.other.attribute-name"], settings: { foreground: "#005cc5" } },
    { scope: ["markup.heading"], settings: { foreground: "#005cc5" } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } }
  ]
};