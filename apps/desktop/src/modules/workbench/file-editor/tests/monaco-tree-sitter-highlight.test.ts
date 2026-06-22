import { describe, expect, test } from "vitest";

import {
  MONACO_TREE_SITTER_MAX_HIGHLIGHT_BYTES,
  monacoLanguageToTreeSitter,
  shouldSkipMonacoTreeSitterHighlight,
  supportsMonacoTreeSitterHighlight
} from "../monaco-tree-sitter-languages";
import {
  scopeToHighlightKind,
  scopeToInlineClassName
} from "../monaco-tree-sitter-theme";

describe("monaco tree-sitter highlight helpers", () => {
  test("maps Monaco language ids to tree-sitter languages", () => {
    expect(monacoLanguageToTreeSitter("rust", "main.rs")).toBe("rust");
    expect(monacoLanguageToTreeSitter("python", "app.py")).toBe("python");
    expect(monacoLanguageToTreeSitter("typescript", "index.ts")).toBe("typescript");
    expect(monacoLanguageToTreeSitter("typescript", "index.tsx")).toBe("tsx");
    expect(monacoLanguageToTreeSitter("javascript", "index.js")).toBe("javascript");
    expect(monacoLanguageToTreeSitter("json", "package.json")).toBe("json");
    expect(monacoLanguageToTreeSitter("go", "main.go")).toBeNull();
  });

  test("limits tree-sitter highlighting to supported Monaco languages", () => {
    expect(supportsMonacoTreeSitterHighlight("rust")).toBe(true);
    expect(supportsMonacoTreeSitterHighlight("python")).toBe(true);
    expect(supportsMonacoTreeSitterHighlight("typescript")).toBe(true);
    expect(supportsMonacoTreeSitterHighlight("go")).toBe(false);
    expect(supportsMonacoTreeSitterHighlight("plaintext")).toBe(false);
  });

  test("skips highlighting for files larger than 200KB", () => {
    const smallSource = "a".repeat(MONACO_TREE_SITTER_MAX_HIGHLIGHT_BYTES);
    const largeSource = `${smallSource}x`;

    expect(shouldSkipMonacoTreeSitterHighlight(smallSource)).toBe(false);
    expect(shouldSkipMonacoTreeSitterHighlight(largeSource)).toBe(true);
  });

  test("maps tree-sitter scopes to Monaco decoration classes", () => {
    expect(scopeToHighlightKind("line_comment")).toBe("comment");
    expect(scopeToHighlightKind("string_literal")).toBe("string");
    expect(scopeToHighlightKind("number_literal")).toBe("number");
    expect(scopeToHighlightKind("function_item")).toBe("function");
    expect(scopeToInlineClassName("type_identifier")).toBe("lyra-monaco-ts-type");
    expect(scopeToInlineClassName("source")).toBe("lyra-monaco-ts-default");
  });
});
