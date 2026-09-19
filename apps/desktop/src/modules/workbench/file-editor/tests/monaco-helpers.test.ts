import { describe, expect, test } from "vitest";

import { loadMonaco } from "../monaco";
import { buildMonacoTheme, mapCompletionKind, mapDiagnosticSeverity } from "../monaco-helpers";
import { LYRA_SYNTAX_DARK, syntaxHex } from "../../syntax/palette";
import {
  acquireFileEditorTextModel,
  disposeInactiveFileEditorTextModels,
  isFileEditorTextModelDisposed,
  readFileEditorTextModelCountForTests
} from "../monaco-model-store";
import { createFileEditorState } from "./test-helpers";

describe("file editor Monaco helpers", () => {
  test("token colors fall back to the shared syntax palette", () => {
    const theme = buildMonacoTheme();
    const keyword = theme.rules.find((rule) => rule.token === "keyword");
    expect(keyword?.foreground).toBe(syntaxHex(LYRA_SYNTAX_DARK.keyword));
  });

  test("keeps LSP completion kind mapping stable", async () => {
    const monaco = await loadMonaco();

    expect(mapCompletionKind(monaco, 2)).toBe(monaco.languages.CompletionItemKind.Method);
    expect(mapCompletionKind(monaco, 17)).toBe(monaco.languages.CompletionItemKind.File);
    expect(mapCompletionKind(monaco, undefined)).toBe(monaco.languages.CompletionItemKind.Text);
  });

  test("maps LSP diagnostic severity onto Monaco markers", async () => {
    const monaco = await loadMonaco();
    expect(mapDiagnosticSeverity(monaco, 1)).toBe(monaco.MarkerSeverity.Error);
    expect(mapDiagnosticSeverity(monaco, 2)).toBe(monaco.MarkerSeverity.Warning);
    expect(mapDiagnosticSeverity(monaco, 3)).toBe(monaco.MarkerSeverity.Info);
    expect(mapDiagnosticSeverity(monaco, 4)).toBe(monaco.MarkerSeverity.Hint);
  });

  test("reuses Monaco text models separately from editor views", async () => {
    const monaco = await loadMonaco();
    const state = createFileEditorState();

    const firstModel = acquireFileEditorTextModel(monaco, state);
    const secondModel = acquireFileEditorTextModel(monaco, {
      ...state,
      content: "const value = 2;\n"
    });

    expect(secondModel).toBe(firstModel);
    expect(secondModel.getValue()).toBe("const value = 2;\n");
    expect(readFileEditorTextModelCountForTests()).toBe(1);

    disposeInactiveFileEditorTextModels({});
    expect(readFileEditorTextModelCountForTests()).toBe(0);
  });

  test("replaces cached Monaco text models that were disposed externally", async () => {
    const monaco = await loadMonaco();
    const state = createFileEditorState();

    const firstModel = acquireFileEditorTextModel(monaco, state);
    firstModel.dispose();
    const secondModel = acquireFileEditorTextModel(monaco, {
      ...state,
      content: "const value = 3;\n"
    });

    expect(secondModel).not.toBe(firstModel);
    expect(isFileEditorTextModelDisposed(secondModel)).toBe(false);
    expect(secondModel.getValue()).toBe("const value = 3;\n");

    disposeInactiveFileEditorTextModels({});
  });

});
