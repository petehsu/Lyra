import { describe, expect, test } from "vitest";

import { loadMonaco } from "../monaco";
import { mapCompletionKind, mapDiagnosticSeverity } from "../monaco-helpers";

describe("file editor Monaco helpers", () => {
  test("keeps LSP completion kind mapping stable", async () => {
    const monaco = await loadMonaco();

    expect(mapCompletionKind(monaco, 2)).toBe(monaco.languages.CompletionItemKind.Method);
    expect(mapCompletionKind(monaco, 17)).toBe(monaco.languages.CompletionItemKind.File);
    expect(mapCompletionKind(monaco, undefined)).toBe(monaco.languages.CompletionItemKind.Text);
  });

  test("keeps LSP diagnostic severity mapping stable", async () => {
    const monaco = await loadMonaco();

    expect(mapDiagnosticSeverity(monaco, 1)).toBe(monaco.MarkerSeverity.Error);
    expect(mapDiagnosticSeverity(monaco, 2)).toBe(monaco.MarkerSeverity.Warning);
    expect(mapDiagnosticSeverity(monaco, 3)).toBe(monaco.MarkerSeverity.Info);
    expect(mapDiagnosticSeverity(monaco, 4)).toBe(monaco.MarkerSeverity.Hint);
    expect(mapDiagnosticSeverity(monaco, undefined)).toBe(monaco.MarkerSeverity.Info);
  });
});
