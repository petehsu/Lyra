import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

const isVitestRuntime = (): boolean =>
  typeof process !== "undefined" &&
  typeof process.env === "object" &&
  process.env.VITEST === "true";

const createDisposable = (dispose: () => void = () => undefined) => ({
  dispose
});

const createMonacoTestMock = (): typeof Monaco => {
  class MockRange {
    constructor(
      public readonly startLineNumber: number,
      public readonly startColumn: number,
      public readonly endLineNumber: number,
      public readonly endColumn: number
    ) {}
  }

  const createModel = (initialValue: string, initialLanguageId: string) => {
    let value = initialValue;
    let languageId = initialLanguageId;
    const listeners = new Set<() => void>();
    const readLines = () => value.split("\n");
    const getOffsetAt = (position: { readonly lineNumber: number; readonly column: number }) => {
      const lines = readLines();
      const lineIndex = Math.max(0, Math.min(lines.length - 1, position.lineNumber - 1));
      let offset = 0;
      for (let index = 0; index < lineIndex; index += 1) {
        offset += (lines[index]?.length ?? 0) + 1;
      }
      return Math.min(value.length, offset + Math.max(0, position.column - 1));
    };
    const getPositionAt = (rawOffset: number) => {
      let offset = Math.max(0, Math.min(value.length, rawOffset));
      const lines = readLines();
      for (let index = 0; index < lines.length; index += 1) {
        const lineLength = lines[index]?.length ?? 0;
        if (offset <= lineLength || index === lines.length - 1) {
          return { lineNumber: index + 1, column: offset + 1 };
        }
        offset -= lineLength + 1;
      }
      return { lineNumber: 1, column: 1 };
    };

    const model = {
      getValue: () => value,
      getValueLength: () => value.length,
      getLanguageId: () => languageId,
      getOffsetAt,
      getPositionAt,
      setValue: (nextValue: string) => {
        value = nextValue;
        listeners.forEach((listener) => listener());
      },
      getLineCount: () => readLines().length,
      getLineMaxColumn: (lineNumber: number) => {
        const line = readLines()[Math.max(0, lineNumber - 1)] ?? "";
        return line.length + 1;
      },
      getWordUntilPosition: (_position: {
        lineNumber: number;
        column: number;
      }) => ({
        word: "",
        startColumn: 1,
        endColumn: 1
      }),
      getFullModelRange: () => ({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: Math.max(1, value.length + 1)
      }),
      pushEditOperations: (
        _beforeCursorState: unknown,
        operations: readonly {
          readonly range?: {
            readonly startLineNumber: number;
            readonly startColumn: number;
            readonly endLineNumber: number;
            readonly endColumn: number;
          };
          readonly text: string;
        }[]
      ) => {
        const operation = operations[0];
        if (operation === undefined) {
          return null;
        }
        const fullRange = model.getFullModelRange();
        const isFullReplacement =
          operation.range === undefined ||
          (
            operation.range.startLineNumber === fullRange.startLineNumber &&
            operation.range.startColumn === fullRange.startColumn &&
            operation.range.endLineNumber === fullRange.endLineNumber &&
            operation.range.endColumn === fullRange.endColumn
          );
        value = isFullReplacement ? operation.text : `${value}${operation.text}`;
        listeners.forEach((listener) => listener());
        return null;
      },
      onDidChangeContent: (listener: () => void) => {
        listeners.add(listener);
        return createDisposable(() => {
          listeners.delete(listener);
        });
      },
      dispose: () => {
        listeners.clear();
      },
      __setLanguage: (nextLanguageId: string) => {
        languageId = nextLanguageId;
      }
    };

    return model;
  };

  const createEditor = (initialModel: Monaco.editor.ITextModel | null) => {
    let currentModel = initialModel;
    const blurListeners = new Set<() => void>();
    const focusListeners = new Set<() => void>();
    const cursorListeners = new Set<() => void>();
    let selection = {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
      getStartPosition: () => ({ lineNumber: selection.startLineNumber, column: selection.startColumn }),
      getEndPosition: () => ({ lineNumber: selection.endLineNumber, column: selection.endColumn })
    };
    const editor = {
      getSelection: () => selection,
      setSelection: (nextSelection: {
        readonly startLineNumber: number;
        readonly startColumn: number;
        readonly endLineNumber: number;
        readonly endColumn: number;
      }) => {
        selection = {
          ...nextSelection,
          getStartPosition: () => ({
            lineNumber: selection.startLineNumber,
            column: selection.startColumn
          }),
          getEndPosition: () => ({
            lineNumber: selection.endLineNumber,
            column: selection.endColumn
          })
        };
        cursorListeners.forEach((listener) => listener());
      },
      updateOptions: () => undefined,
      addCommand: () => undefined,
      layout: () => undefined,
      revealLine: () => undefined,
      revealLineInCenter: () => undefined,
      focus: () => focusListeners.forEach((listener) => listener()),
      onDidChangeCursorSelection: (listener: () => void) => {
        cursorListeners.add(listener);
        return createDisposable(() => cursorListeners.delete(listener));
      },
      onDidFocusEditorWidget: (listener: () => void) => {
        focusListeners.add(listener);
        return createDisposable(() => focusListeners.delete(listener));
      },
      onDidBlurEditorWidget: (listener: () => void) => {
        blurListeners.add(listener);
        return createDisposable(() => {
          blurListeners.delete(listener);
        });
      },
      dispose: () => {
        blurListeners.clear();
        focusListeners.clear();
        cursorListeners.clear();
      },
      setModel: (nextModel: Monaco.editor.ITextModel | null) => {
        currentModel = nextModel;
      },
      getModel: () => currentModel,
      __setModel: (nextModel: Monaco.editor.ITextModel | null) => {
        currentModel = nextModel;
      }
    };
    return editor;
  };

  const mock = {
    editor: {
      defineTheme: () => undefined,
      setTheme: () => undefined,
      setModelMarkers: () => undefined,
      setModelLanguage: (
        model: { __setLanguage?: (languageId: string) => void },
        languageId: string
      ) => {
        model.__setLanguage?.(languageId);
      },
      createModel: (value: string, languageId: string) =>
        createModel(value, languageId) as unknown as Monaco.editor.ITextModel,
      create: (_host: HTMLElement, options: { model: Monaco.editor.ITextModel }) => {
        return createEditor(options.model) as unknown as Monaco.editor.IStandaloneCodeEditor;
      },
      createDiffEditor: () => {
        const modifiedEditor = createEditor(null);
        return {
          setModel: (models: {
            readonly original: Monaco.editor.ITextModel;
            readonly modified: Monaco.editor.ITextModel;
          } | null) => {
            modifiedEditor.__setModel(models?.modified ?? null);
          },
          getModifiedEditor: () =>
            modifiedEditor as unknown as Monaco.editor.IStandaloneCodeEditor,
          layout: () => undefined,
          dispose: () => {
            modifiedEditor.dispose();
          }
        } as unknown as Monaco.editor.IStandaloneDiffEditor;
      }
    },
    languages: {
      registerCompletionItemProvider: () => createDisposable(),
      CompletionItemKind: {
        Method: 0,
        Function: 1,
        Constructor: 2,
        Field: 3,
        Variable: 4,
        Class: 5,
        Interface: 6,
        Module: 7,
        Property: 8,
        Unit: 9,
        Value: 10,
        Enum: 11,
        Keyword: 12,
        Snippet: 13,
        Color: 14,
        File: 15,
        Reference: 16,
        Folder: 17,
        EnumMember: 18,
        Constant: 19,
        Struct: 20,
        Event: 21,
        Operator: 22,
        TypeParameter: 23,
        Text: 24
      }
    },
    Range: MockRange,
    MarkerSeverity: {
      Hint: 1,
      Info: 2,
      Warning: 4,
      Error: 8
    },
    CompletionItemKind: {
      Method: 0,
      Function: 1,
      Constructor: 2,
      Field: 3,
      Variable: 4,
      Class: 5,
      Interface: 6,
      Module: 7,
      Property: 8,
      Unit: 9,
      Value: 10,
      Enum: 11,
      Keyword: 12,
      Snippet: 13,
      Color: 14,
      File: 15,
      Reference: 16,
      Folder: 17,
      EnumMember: 18,
      Constant: 19,
      Struct: 20,
      Event: 21,
      Operator: 22,
      TypeParameter: 23,
      Text: 24
    },
    KeyMod: {
      CtrlCmd: 0
    },
    KeyCode: {
      KeyS: 0
    }
  };

  return mock as unknown as typeof Monaco;
};

let runtimePromise: Promise<typeof Monaco> | null = null;

export const loadMonaco = async (): Promise<typeof Monaco> => {
  if (isVitestRuntime()) {
    return createMonacoTestMock();
  }
  if (runtimePromise === null) {
    runtimePromise = import("./monaco-runtime").then((runtime) =>
      runtime.loadMonacoRuntime()
    );
  }
  return runtimePromise;
};
