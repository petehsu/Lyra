import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import type {
  FirstPartyCodeDiffHandleV1,
  FirstPartyCodeDiffMountOptionsV1,
  FirstPartyCodeEditorCompletionItemV1,
  FirstPartyCodeEditorHandleV1,
  FirstPartyCodeEditorMountOptionsV1,
  FirstPartyCodeEditorSelectionV1,
  FirstPartyCodeEditorServiceV1,
  FirstPartyCodeEditorUpdateV1
} from "@lyra/workbench-ui-runtime";

import { loadMonaco } from "../file-editor/monaco";
import {
  buildMonacoTheme,
  COMPLETION_TRIGGER_CHARACTERS,
  mapCompletionKind,
  MONACO_FONT_SIZE,
  MONACO_LINE_HEIGHT,
  MONACO_PADDING,
  MONACO_THEME_ID
} from "../file-editor/monaco-helpers";

type MonacoLoader = () => Promise<typeof Monaco>;

const COMPLETION_LANGUAGES = ["typescript", "javascript", "rust", "python"] as const;

const applyWorkbenchTheme = (monaco: typeof Monaco): void => {
  monaco.editor.defineTheme(MONACO_THEME_ID, buildMonacoTheme());
  monaco.editor.setTheme(MONACO_THEME_ID);
};

const clampOffset = (model: Monaco.editor.ITextModel, value: number): number =>
  Math.max(0, Math.min(model.getValueLength(), Math.floor(value)));

const readSelection = (
  model: Monaco.editor.ITextModel,
  editor: Monaco.editor.IStandaloneCodeEditor
): FirstPartyCodeEditorSelectionV1 | null => {
  const selection = editor.getSelection();
  if (selection === null) return null;
  return {
    start: model.getOffsetAt(selection.getStartPosition()),
    end: model.getOffsetAt(selection.getEndPosition())
  };
};

const applySelection = (
  model: Monaco.editor.ITextModel,
  editor: Monaco.editor.IStandaloneCodeEditor,
  selection: FirstPartyCodeEditorSelectionV1
): void => {
  const start = model.getPositionAt(clampOffset(model, selection.start));
  const end = model.getPositionAt(clampOffset(model, selection.end));
  editor.setSelection({
    startLineNumber: start.lineNumber,
    startColumn: start.column,
    endLineNumber: end.lineNumber,
    endColumn: end.column
  });
};

const replaceModelValue = (
  model: Monaco.editor.ITextModel,
  editor: Monaco.editor.IStandaloneCodeEditor,
  value: string
): void => {
  if (model.getValue() === value) return;
  const selection = readSelection(model, editor);
  model.pushEditOperations(
    [],
    [{ range: model.getFullModelRange(), text: value, forceMoveMarkers: true }],
    () => null
  );
  if (selection !== null) applySelection(model, editor, selection);
};

const attachLayoutObserver = (
  container: HTMLElement,
  layout: () => void
): (() => void) => {
  layout();
  if (typeof ResizeObserver === "undefined") {
    return () => undefined;
  }
  const observer = new ResizeObserver(() => layout());
  observer.observe(container);
  return () => observer.disconnect();
};

const toMonacoCompletion = (
  monaco: typeof Monaco,
  range: Monaco.IRange,
  entry: FirstPartyCodeEditorCompletionItemV1
): Monaco.languages.CompletionItem => ({
  label: entry.label,
  kind: mapCompletionKind(monaco, entry.kind),
  insertText: entry.insertText ?? entry.label,
  range,
  ...(entry.detail === undefined ? {} : { detail: entry.detail }),
  ...(entry.documentation === undefined ? {} : { documentation: entry.documentation }),
  ...(entry.sortText === undefined ? {} : { sortText: entry.sortText }),
  ...(entry.filterText === undefined ? {} : { filterText: entry.filterText })
});

const mountEditor = async (
  load: MonacoLoader,
  options: FirstPartyCodeEditorMountOptionsV1
): Promise<FirstPartyCodeEditorHandleV1> => {
  const monaco = await load();
  applyWorkbenchTheme(monaco);
  const model = monaco.editor.createModel(options.value, options.languageId);
  const editor = monaco.editor.create(options.container, {
    model,
    automaticLayout: false,
    readOnly: options.readOnly,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontFamily: "var(--lyra-font-mono)",
    fontSize: MONACO_FONT_SIZE,
    lineHeight: MONACO_LINE_HEIGHT,
    padding: { top: MONACO_PADDING, bottom: MONACO_PADDING }
  });
  editor.updateOptions({
    colorDecorators: false,
    "semanticHighlighting.enabled": false
  });
  options.container.dataset.lyraCodeEditorResource = options.resourceId;

  let disposed = false;
  let applyingUpdate = false;
  const disposables: Monaco.IDisposable[] = [];
  const disposeLayout = attachLayoutObserver(options.container, () => editor.layout());

  if (options.selection !== undefined) {
    applyingUpdate = true;
    applySelection(model, editor, options.selection);
    applyingUpdate = false;
  }

  disposables.push(
    model.onDidChangeContent(() => {
      if (!applyingUpdate && !disposed) options.onChange(model.getValue());
    }),
    editor.onDidChangeCursorSelection(() => {
      if (applyingUpdate || disposed) return;
      const selection = readSelection(model, editor);
      if (selection !== null) options.onSelectionChange(selection);
    }),
    editor.onDidFocusEditorWidget(() => options.onFocusChange?.(true)),
    editor.onDidBlurEditorWidget(() => options.onFocusChange?.(false)),
    ...COMPLETION_LANGUAGES.map((languageId) =>
      monaco.languages.registerCompletionItemProvider(languageId, {
        triggerCharacters: COMPLETION_TRIGGER_CHARACTERS,
        provideCompletionItems: async (targetModel, position) => {
          if (
            disposed
            || targetModel !== model
            || model.getLanguageId() !== languageId
          ) {
            return { suggestions: [] };
          }
          const word = model.getWordUntilPosition(position);
          const range = new monaco.Range(
            position.lineNumber,
            word.startColumn,
            position.lineNumber,
            word.endColumn
          );
          const entries = await options.provideCompletions({
            line: Math.max(0, position.lineNumber - 1),
            column: Math.max(0, position.column - 1)
          });
          return {
            suggestions: entries.map((entry) => toMonacoCompletion(monaco, range, entry))
          };
        }
      })
    )
  );
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    if (!disposed) void options.onSave();
  });

  const update = (next: FirstPartyCodeEditorUpdateV1): void => {
    if (disposed) return;
    applyingUpdate = true;
    try {
      if (next.value !== undefined) replaceModelValue(model, editor, next.value);
      if (next.languageId !== undefined && model.getLanguageId() !== next.languageId) {
        monaco.editor.setModelLanguage(model, next.languageId);
      }
      if (next.readOnly !== undefined) editor.updateOptions({ readOnly: next.readOnly });
      if (next.selection !== undefined) applySelection(model, editor, next.selection);
      if (next.presentation !== undefined) applyWorkbenchTheme(monaco);
    } finally {
      applyingUpdate = false;
    }
  };

  return {
    getValue: () => model.getValue(),
    getSelection: () => readSelection(model, editor),
    update,
    focus: () => editor.focus(),
    layout: () => editor.layout(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      options.onFocusChange?.(false);
      disposeLayout();
      for (const disposable of disposables) disposable.dispose();
      editor.setModel(null);
      editor.dispose();
      model.dispose();
      delete options.container.dataset.lyraCodeEditorResource;
    }
  };
};

const mountDiff = async (
  load: MonacoLoader,
  options: FirstPartyCodeDiffMountOptionsV1
): Promise<FirstPartyCodeDiffHandleV1> => {
  const monaco = await load();
  applyWorkbenchTheme(monaco);
  const originalModel = monaco.editor.createModel(options.original, options.languageId);
  const modifiedModel = monaco.editor.createModel(options.modified, options.languageId);
  const editor = monaco.editor.createDiffEditor(options.container, {
    automaticLayout: false,
    readOnly: true,
    originalEditable: false,
    renderSideBySide: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontFamily: "var(--lyra-font-mono)",
    fontSize: MONACO_FONT_SIZE,
    lineHeight: MONACO_LINE_HEIGHT
  });
  editor.getModifiedEditor().updateOptions({
    colorDecorators: false,
    "semanticHighlighting.enabled": false
  });
  editor.setModel({ original: originalModel, modified: modifiedModel });
  options.container.dataset.lyraCodeDiffResource = options.resourceId;
  let disposed = false;
  const disposeLayout = attachLayoutObserver(options.container, () => editor.layout());

  return {
    update: (next) => {
      if (disposed) return;
      if (next.original !== undefined && originalModel.getValue() !== next.original) {
        originalModel.setValue(next.original);
      }
      if (next.modified !== undefined && modifiedModel.getValue() !== next.modified) {
        modifiedModel.setValue(next.modified);
      }
      if (next.languageId !== undefined) {
        if (originalModel.getLanguageId() !== next.languageId) {
          monaco.editor.setModelLanguage(originalModel, next.languageId);
        }
        if (modifiedModel.getLanguageId() !== next.languageId) {
          monaco.editor.setModelLanguage(modifiedModel, next.languageId);
        }
      }
      if (next.presentation !== undefined) applyWorkbenchTheme(monaco);
    },
    layout: () => editor.layout(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disposeLayout();
      editor.setModel(null);
      editor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      delete options.container.dataset.lyraCodeDiffResource;
    }
  };
};

export const createFirstPartyCodeEditorService = (
  load: MonacoLoader = loadMonaco
): FirstPartyCodeEditorServiceV1 => ({
  mountEditor: (options) => mountEditor(load, options),
  mountDiff: (options) => mountDiff(load, options)
});
