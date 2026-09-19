import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import { LYRA_SYNTAX_DARK, syntaxHex } from "../syntax/palette";

export const MONACO_THEME_ID = "lyra-workbench";
export const AUTO_SAVE_DELAY_MS = 800;
export const MONACO_FONT_SIZE = 13;
export const MONACO_LINE_HEIGHT = 20;
export const MONACO_PADDING = 12;
export const COMPLETION_TRIGGER_CHARACTERS = [".", ":", "\"", "'", "/", "@", "<"];

export const mapCompletionKind = (
  monaco: typeof Monaco,
  kind: number | undefined
): Monaco.languages.CompletionItemKind => {
  switch (kind) {
    case 2:
      return monaco.languages.CompletionItemKind.Method;
    case 3:
      return monaco.languages.CompletionItemKind.Function;
    case 4:
      return monaco.languages.CompletionItemKind.Constructor;
    case 5:
      return monaco.languages.CompletionItemKind.Field;
    case 6:
      return monaco.languages.CompletionItemKind.Variable;
    case 7:
      return monaco.languages.CompletionItemKind.Class;
    case 8:
      return monaco.languages.CompletionItemKind.Interface;
    case 9:
      return monaco.languages.CompletionItemKind.Module;
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 11:
      return monaco.languages.CompletionItemKind.Unit;
    case 12:
      return monaco.languages.CompletionItemKind.Value;
    case 13:
      return monaco.languages.CompletionItemKind.Enum;
    case 14:
      return monaco.languages.CompletionItemKind.Keyword;
    case 15:
      return monaco.languages.CompletionItemKind.Snippet;
    case 16:
      return monaco.languages.CompletionItemKind.Color;
    case 17:
      return monaco.languages.CompletionItemKind.File;
    case 18:
      return monaco.languages.CompletionItemKind.Reference;
    case 19:
      return monaco.languages.CompletionItemKind.Folder;
    case 20:
      return monaco.languages.CompletionItemKind.EnumMember;
    case 21:
      return monaco.languages.CompletionItemKind.Constant;
    case 22:
      return monaco.languages.CompletionItemKind.Struct;
    case 23:
      return monaco.languages.CompletionItemKind.Event;
    case 24:
      return monaco.languages.CompletionItemKind.Operator;
    case 25:
      return monaco.languages.CompletionItemKind.TypeParameter;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
};

export const mapDiagnosticSeverity = (
  monaco: typeof Monaco,
  severity: number
): Monaco.MarkerSeverity => {
  if (severity <= 1) {
    return monaco.MarkerSeverity.Error;
  }
  if (severity === 2) {
    return monaco.MarkerSeverity.Warning;
  }
  if (severity === 3) {
    return monaco.MarkerSeverity.Info;
  }
  return monaco.MarkerSeverity.Hint;
};

export const comparableFilePath = (value: string): string =>
  value.replaceAll("\\", "/").toLowerCase();

const readRootCssVar = (name: string, fallback: string): string => {
  if (typeof window === "undefined") {
    return fallback;
  }
  const rootStyle = window.getComputedStyle(document.documentElement);
  const value = rootStyle.getPropertyValue(name).trim();
  // ponytail: material 模式下 theme/service.ts 把 --lyra-app-* 覆写为
  // color-mix(... var(--lyra-material-solid-*) N%, transparent)。Monaco 不认
  // color-mix()，读 --lyra-material-solid-* 别名拿到原始 hex。
  if (value.startsWith("color-mix(") && name.startsWith("--lyra-app-")) {
    const solidName = `--lyra-material-solid-${name.slice("--lyra-app-".length)}`;
    const solidValue = rootStyle.getPropertyValue(solidName).trim();
    return solidValue.length > 0 ? solidValue : fallback;
  }
  return value.length > 0 ? value : fallback;
};

const tokenForeground = (name: string, fallbackHex: string): string =>
  syntaxHex(readRootCssVar(name, fallbackHex));

const isDarkWorkbenchTone = (): boolean =>
  typeof document === "undefined" || document.documentElement.dataset.lyraThemeTone !== "light";

export const buildMonacoTheme = (): Monaco.editor.IStandaloneThemeData => ({
  base: isDarkWorkbenchTone() ? "vs-dark" : "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: tokenForeground("--lyra-syntax-comment", LYRA_SYNTAX_DARK.comment), fontStyle: "italic" },
    { token: "string", foreground: tokenForeground("--lyra-syntax-string", LYRA_SYNTAX_DARK.string) },
    { token: "number", foreground: tokenForeground("--lyra-syntax-number", LYRA_SYNTAX_DARK.number) },
    { token: "keyword", foreground: tokenForeground("--lyra-syntax-keyword", LYRA_SYNTAX_DARK.keyword) },
    { token: "keyword.control", foreground: tokenForeground("--lyra-syntax-keyword", LYRA_SYNTAX_DARK.keyword) },
    { token: "keyword.operator", foreground: tokenForeground("--lyra-syntax-operator", LYRA_SYNTAX_DARK.operator) },
    { token: "type", foreground: tokenForeground("--lyra-syntax-type", LYRA_SYNTAX_DARK.type) },
    { token: "type.class", foreground: tokenForeground("--lyra-syntax-type", LYRA_SYNTAX_DARK.type) },
    { token: "type.interface", foreground: tokenForeground("--lyra-syntax-type", LYRA_SYNTAX_DARK.type) },
    { token: "type.enum", foreground: tokenForeground("--lyra-syntax-type", LYRA_SYNTAX_DARK.type) },
    { token: "function", foreground: tokenForeground("--lyra-syntax-function", LYRA_SYNTAX_DARK.function) },
    { token: "variable", foreground: tokenForeground("--lyra-syntax-variable", LYRA_SYNTAX_DARK.variable) },
    { token: "variable.predefined", foreground: tokenForeground("--lyra-syntax-variable", LYRA_SYNTAX_DARK.variable) },
    { token: "variable.parameter", foreground: tokenForeground("--lyra-syntax-parameter", LYRA_SYNTAX_DARK.parameter) },
    { token: "constant", foreground: tokenForeground("--lyra-syntax-number", LYRA_SYNTAX_DARK.number) },
    { token: "constant.numeric", foreground: tokenForeground("--lyra-syntax-number", LYRA_SYNTAX_DARK.number) },
    { token: "constant.language", foreground: tokenForeground("--lyra-syntax-keyword", LYRA_SYNTAX_DARK.keyword) },
    { token: "operator", foreground: tokenForeground("--lyra-syntax-operator", LYRA_SYNTAX_DARK.operator) },
    { token: "delimiter", foreground: tokenForeground("--lyra-syntax-parameter", LYRA_SYNTAX_DARK.parameter) },
    { token: "delimiter.parenthesis", foreground: tokenForeground("--lyra-syntax-parameter", LYRA_SYNTAX_DARK.parameter) },
    { token: "delimiter.bracket", foreground: tokenForeground("--lyra-syntax-parameter", LYRA_SYNTAX_DARK.parameter) },
    { token: "delimiter.array", foreground: tokenForeground("--lyra-syntax-parameter", LYRA_SYNTAX_DARK.parameter) },
    { token: "attribute", foreground: tokenForeground("--lyra-syntax-number", LYRA_SYNTAX_DARK.number) },
    { token: "attribute.value", foreground: tokenForeground("--lyra-syntax-string", LYRA_SYNTAX_DARK.string) },
    { token: "tag", foreground: tokenForeground("--lyra-syntax-tag", LYRA_SYNTAX_DARK.tag) },
    { token: "tag.attribute", foreground: tokenForeground("--lyra-syntax-number", LYRA_SYNTAX_DARK.number) },
    { token: "meta", foreground: tokenForeground("--lyra-syntax-parameter", LYRA_SYNTAX_DARK.parameter) },
    { token: "regexp", foreground: tokenForeground("--lyra-syntax-string", LYRA_SYNTAX_DARK.string) },
    { token: "namespace", foreground: tokenForeground("--lyra-syntax-type", LYRA_SYNTAX_DARK.type) },
    { token: "annotation", foreground: tokenForeground("--lyra-syntax-number", LYRA_SYNTAX_DARK.number) },
    { token: "modifier", foreground: tokenForeground("--lyra-syntax-keyword", LYRA_SYNTAX_DARK.keyword) }
  ],
  colors: {
    "editor.background": readRootCssVar("--lyra-app-panel-bg", "#0f1116"),
    "editor.foreground": readRootCssVar("--lyra-text-primary", "#d5d7de"),
    "editorLineNumber.foreground": readRootCssVar("--lyra-text-muted", "#757a86"),
    "editorLineNumber.activeForeground": readRootCssVar("--lyra-text-secondary", "#aeb4c3"),
    "editorCursor.foreground": readRootCssVar("--lyra-text-primary", "#d5d7de"),
    "editor.selectionBackground": readRootCssVar("--lyra-app-row-hover-bg", "#2b3241"),
    "editor.inactiveSelectionBackground": readRootCssVar("--lyra-app-row-hover-bg", "#2b3241"),
    "editorLineNumber.dimmedForeground": readRootCssVar("--lyra-text-muted", "#697082"),
    "editorIndentGuide.background1": readRootCssVar("--lyra-app-border", "#2f3341"),
    "editorIndentGuide.activeBackground1": readRootCssVar("--lyra-app-border-strong", "#4a4f60"),
    "editorGutter.background": readRootCssVar("--lyra-app-panel-bg", "#0f1116")
  }
});
