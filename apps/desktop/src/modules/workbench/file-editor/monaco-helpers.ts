import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

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

const readRootCssVar = (name: string, fallback: string): string => {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value.length > 0 ? value : fallback;
};

export const buildMonacoTheme = (): Monaco.editor.IStandaloneThemeData => ({
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "6b7280", fontStyle: "italic" },
    { token: "string", foreground: "a3d4a0" },
    { token: "number", foreground: "d19a66" },
    { token: "keyword", foreground: "c678dd" },
    { token: "keyword.control", foreground: "c678dd" },
    { token: "keyword.operator", foreground: "56b6c2" },
    { token: "type", foreground: "61afef" },
    { token: "type.class", foreground: "61afef" },
    { token: "type.interface", foreground: "61afef" },
    { token: "type.enum", foreground: "61afef" },
    { token: "function", foreground: "61afef" },
    { token: "variable", foreground: "e06c75" },
    { token: "variable.predefined", foreground: "e06c75" },
    { token: "variable.parameter", foreground: "d5d7de" },
    { token: "constant", foreground: "d19a66" },
    { token: "constant.numeric", foreground: "d19a66" },
    { token: "constant.language", foreground: "c678dd" },
    { token: "operator", foreground: "56b6c2" },
    { token: "delimiter", foreground: "d5d7de" },
    { token: "delimiter.parenthesis", foreground: "d5d7de" },
    { token: "delimiter.bracket", foreground: "d5d7de" },
    { token: "delimiter.array", foreground: "d5d7de" },
    { token: "attribute", foreground: "d19a66" },
    { token: "attribute.value", foreground: "a3d4a0" },
    { token: "tag", foreground: "e06c75" },
    { token: "tag.attribute", foreground: "d19a66" },
    { token: "meta", foreground: "d5d7de" },
    { token: "regexp", foreground: "a3d4a0" },
    { token: "namespace", foreground: "61afef" },
    { token: "annotation", foreground: "d19a66" },
    { token: "modifier", foreground: "c678dd" },
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
