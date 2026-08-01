import { describe, expect, test, vi } from "vitest";

import { createFirstPartyCodeEditorService } from "../first-party-code-editor-service";

describe("Core-owned first-party code editor service", () => {
  test("mounts version-scoped editor and diff handles without exposing Monaco", async () => {
    const service = createFirstPartyCodeEditorService();
    const editorContainer = document.createElement("div");
    const focusChanges: boolean[] = [];
    const onChange = vi.fn();
    const handle = await service.mountEditor({
      container: editorContainer,
      resourceId: "lyra.editor@1.0.0:editor-1",
      value: "const answer = 1;",
      languageId: "typescript",
      readOnly: false,
      selection: { start: 6, end: 12 },
      presentation: { themeId: "classic-dark", themeTone: "dark" },
      onChange,
      onSelectionChange: vi.fn(),
      onSave: vi.fn(),
      onFocusChange: (focused) => focusChanges.push(focused),
      provideCompletions: async () => []
    });

    expect(editorContainer.dataset.lyraCodeEditorResource).toBe(
      "lyra.editor@1.0.0:editor-1"
    );
    expect(handle.getValue()).toBe("const answer = 1;");
    expect(handle.getSelection()).toEqual({ start: 6, end: 12 });
    handle.update({
      value: "const answer = 42;",
      languageId: "javascript",
      readOnly: true,
      selection: { start: 18, end: 18 },
      presentation: { themeId: "classic-light", themeTone: "light" }
    });
    expect(handle.getValue()).toBe("const answer = 42;");
    expect(handle.getSelection()).toEqual({ start: 18, end: 18 });
    expect(onChange).not.toHaveBeenCalled();
    handle.focus();
    expect(focusChanges).toContain(true);

    const diffContainer = document.createElement("div");
    const diff = await service.mountDiff({
      container: diffContainer,
      resourceId: "lyra.editor@1.0.0:editor-1:diff",
      original: "const answer = 1;",
      modified: "const answer = 42;",
      languageId: "typescript",
      presentation: { themeId: "classic-dark", themeTone: "dark" }
    });
    expect(diffContainer.dataset.lyraCodeDiffResource).toBe(
      "lyra.editor@1.0.0:editor-1:diff"
    );
    diff.update({
      original: "const answer = 2;",
      modified: "const answer = 43;",
      languageId: "javascript",
      presentation: { themeId: "classic-light", themeTone: "light" }
    });

    diff.dispose();
    diff.dispose();
    handle.dispose();
    handle.dispose();
    expect(editorContainer.dataset.lyraCodeEditorResource).toBeUndefined();
    expect(diffContainer.dataset.lyraCodeDiffResource).toBeUndefined();
    expect(focusChanges.at(-1)).toBe(false);
  });
});
