import { describe, expect, test } from "vitest";

import { loadMonaco } from "../monaco";
import { mapCompletionKind } from "../monaco-helpers";

describe("file editor Monaco helpers", () => {
  test("keeps LSP completion kind mapping stable", async () => {
    const monaco = await loadMonaco();

    expect(mapCompletionKind(monaco, 2)).toBe(monaco.languages.CompletionItemKind.Method);
    expect(mapCompletionKind(monaco, 17)).toBe(monaco.languages.CompletionItemKind.File);
    expect(mapCompletionKind(monaco, undefined)).toBe(monaco.languages.CompletionItemKind.Text);
  });

});
