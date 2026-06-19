const TREE_SITTER_LANGUAGE_IDS = new Set([
  "rust",
  "python",
  "typescript",
  "javascript",
  "json"
]);

export const MONACO_TREE_SITTER_HIGHLIGHT_DEBOUNCE_MS = 80;
export const MONACO_TREE_SITTER_MAX_HIGHLIGHT_BYTES = 200 * 1024;

export const supportsMonacoTreeSitterHighlight = (monacoLanguageId: string): boolean =>
  TREE_SITTER_LANGUAGE_IDS.has(monacoLanguageId);

export const shouldSkipMonacoTreeSitterHighlight = (source: string): boolean =>
  new TextEncoder().encode(source).length > MONACO_TREE_SITTER_MAX_HIGHLIGHT_BYTES;

export const monacoLanguageToTreeSitter = (
  monacoLanguageId: string,
  filePath: string
): string | null => {
  switch (monacoLanguageId) {
    case "rust":
      return "rust";
    case "python":
      return "python";
    case "javascript":
      return "javascript";
    case "typescript": {
      const extension = filePath.split(".").pop()?.toLowerCase() ?? "";
      return extension === "tsx" ? "tsx" : "typescript";
    }
    case "json":
      return "json";
    default:
      return null;
  }
};