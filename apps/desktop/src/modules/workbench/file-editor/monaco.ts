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

    const model = {
      getValue: () => value,
      getLanguageId: () => languageId,
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
        operations: readonly { text: string }[]
      ) => {
        value = operations[0]?.text ?? "";
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
        const blurListeners = new Set<() => void>();
        const editor = {
          getSelection: () => null,
          setSelection: () => undefined,
          updateOptions: () => undefined,
          addCommand: () => undefined,
          onDidBlurEditorWidget: (listener: () => void) => {
            blurListeners.add(listener);
            return createDisposable(() => {
              blurListeners.delete(listener);
            });
          },
          dispose: () => {
            blurListeners.clear();
          },
          getModel: () => options.model
        };
        return editor as unknown as Monaco.editor.IStandaloneCodeEditor;
      }
    },
    languages: {
      registerCompletionItemProvider: () => createDisposable()
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
