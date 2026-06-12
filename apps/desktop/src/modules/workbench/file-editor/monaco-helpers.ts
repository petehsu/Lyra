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
  rules: [],
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
