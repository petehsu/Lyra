import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import { useLoadingVisibility } from "../shell/use-loading-visibility";
import { loadMonaco } from "./monaco";
import {
  AUTO_SAVE_DELAY_MS,
  buildMonacoTheme,
  COMPLETION_TRIGGER_CHARACTERS,
  LSP_MARKER_OWNER,
  mapCompletionKind,
  mapDiagnosticSeverity,
  MONACO_FONT_SIZE,
  MONACO_LINE_HEIGHT,
  MONACO_PADDING,
  MONACO_THEME_ID
} from "./monaco-helpers";
import type {
  FileEditorAppState,
  FileEditorChangeReviewItem,
  FileEditorControlMode,
  FileEditorModel
} from "./types";

export type FileEditorRuntimeState = {
  readonly hostRef: RefObject<HTMLDivElement>;
  readonly diffHostRef: RefObject<HTMLDivElement>;
  readonly editorReady: boolean;
  readonly isDiffMode: boolean;
  readonly setIsDiffMode: Dispatch<SetStateAction<boolean>>;
  readonly canToggleDiff: boolean;
  readonly showLoadingSkeleton: boolean;
  readonly canShowEditor: boolean;
};

type UseFileEditorRuntimeInput = {
  readonly state: FileEditorAppState | null;
  readonly themeSignature: string;
  readonly model: FileEditorModel;
  readonly controlMode: FileEditorControlMode;
  readonly activeEditorWorkItem?: FileEditorChangeReviewItem | undefined;
};

export const useFileEditorRuntime = ({
  state,
  themeSignature,
  model,
  controlMode,
  activeEditorWorkItem
}: UseFileEditorRuntimeInput): FileEditorRuntimeState => {
  const hydrateIfNeeded = model.hydrateIfNeeded;
  const touchInstance = model.touchInstance;
  const setContent = model.setContent;
  const save = model.save;
  const requestCompletion = model.requestCompletion;

  const hostRef = useRef<HTMLDivElement | null>(null);
  const diffHostRef = useRef<HTMLDivElement | null>(null);
  const monacoRef = useRef<typeof Monaco | null>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const diffEditorRef = useRef<Monaco.editor.IStandaloneDiffEditor | null>(null);
  const textModelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const diffOriginalModelRef = useRef<Monaco.editor.ITextModel | null>(null);
  const applyingStateRef = useRef(false);
  const latestStateRef = useRef<FileEditorAppState | null>(state);
  const [editorReady, setEditorReady] = useState(false);
  const [isDiffMode, setIsDiffMode] = useState(false);
  const [diffBaseline, setDiffBaseline] = useState<{
    readonly workItemId: string;
    readonly content: string;
  } | null>(null);

  const isAiOnly = controlMode === "ai_only";
  const stateId = state?.instanceId ?? "";
  const canShowEditor =
    state !== null &&
    state.status !== "unsupported" &&
    state.status !== "error";
  const showLoadingSkeleton = useLoadingVisibility(
    state === null ? false : state.status === "loading" || editorReady === false,
    {
      showDelayMs: 120,
      minVisibleMs: 180
    }
  );
  const diffOriginalContent =
    activeEditorWorkItem?.baselineContent !== undefined
      ? activeEditorWorkItem.baselineContent
      : activeEditorWorkItem !== undefined &&
          diffBaseline !== null &&
          diffBaseline.workItemId === activeEditorWorkItem.id
        ? diffBaseline.content
        : (state?.lastSavedContent ?? "");
  const canToggleDiff =
    state !== null &&
    activeEditorWorkItem !== undefined &&
    state.content !== diffOriginalContent;

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  useEffect(() => {
    setIsDiffMode(false);
  }, [stateId]);

  useEffect(() => {
    if (activeEditorWorkItem === undefined || state === null) {
      setDiffBaseline(null);
      return;
    }
    if (activeEditorWorkItem.baselineContent !== undefined) {
      setDiffBaseline(null);
      return;
    }
    setDiffBaseline((current) => {
      if (current?.workItemId === activeEditorWorkItem.id) {
        return current;
      }
      return {
        workItemId: activeEditorWorkItem.id,
        content: state.lastSavedContent
      };
    });
  }, [activeEditorWorkItem, state?.instanceId, state?.lastSavedContent]);

  useEffect(() => {
    if (activeEditorWorkItem?.baselineContent === undefined || state === null) {
      return;
    }
    if (state.content === activeEditorWorkItem.baselineContent) {
      return;
    }
    setIsDiffMode(true);
  }, [activeEditorWorkItem?.baselineContent, activeEditorWorkItem?.id, state?.content, state?.instanceId]);

  useEffect(() => {
    if (state === null) {
      return;
    }
    if (state.isHydrated) {
      return;
    }
    if (state.status === "loading" || state.status === "unsupported") {
      return;
    }
    void hydrateIfNeeded(state.instanceId);
  }, [hydrateIfNeeded, state?.instanceId, state?.isHydrated, state?.status]);

  useEffect(() => {
    if (state === null || canShowEditor === false) {
      return;
    }
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    let disposed = false;
    const disposables: Array<{ dispose: () => void }> = [];

    void loadMonaco()
      .then((monaco) => {
        if (disposed) {
          return;
        }
        monacoRef.current = monaco;
        monaco.editor.defineTheme(MONACO_THEME_ID, buildMonacoTheme());
        monaco.editor.setTheme(MONACO_THEME_ID);
        const latestState = latestStateRef.current;
        if (latestState === null) {
          return;
        }
        const textModel = monaco.editor.createModel(
          latestState.content,
          latestState.languageId
        );
        textModelRef.current = textModel;
        const editor = monaco.editor.create(host, {
          model: textModel,
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          tabSize: 2,
          fontFamily: "var(--lyra-font-mono)",
          fontSize: MONACO_FONT_SIZE,
          lineHeight: MONACO_LINE_HEIGHT,
          padding: {
            top: MONACO_PADDING,
            bottom: MONACO_PADDING
          },
          readOnly: latestState.isReadOnly || isAiOnly
        });
        editorRef.current = editor;
        setEditorReady(true);

        disposables.push(
          textModel.onDidChangeContent(() => {
            const latestState = latestStateRef.current;
            if (applyingStateRef.current || latestState === null) {
              return;
            }
            setContent(latestState.instanceId, textModel.getValue());
          }),
          editor.onDidBlurEditorWidget(() => {
            const latestState = latestStateRef.current;
            if (latestState === null) {
              return;
            }
            void save(latestState.instanceId, "blur");
          }),
          ...["typescript", "javascript", "rust", "python"].map((languageId) =>
            monaco.languages.registerCompletionItemProvider(languageId, {
              triggerCharacters: COMPLETION_TRIGGER_CHARACTERS,
              provideCompletionItems: async (targetModel, position, _context, _token) => {
                const latestState = latestStateRef.current;
                const currentModel = textModelRef.current;
                if (
                  latestState === null ||
                  currentModel === null ||
                  targetModel !== currentModel ||
                  latestState.languageId !== languageId
                ) {
                  return { suggestions: [] };
                }

                const word = targetModel.getWordUntilPosition(position);
                const range = new monaco.Range(
                  position.lineNumber,
                  word.startColumn,
                  position.lineNumber,
                  word.endColumn
                );

                const entries = await requestCompletion(
                  latestState.instanceId,
                  Math.max(0, position.lineNumber - 1),
                  Math.max(0, position.column - 1)
                );

                return {
                  suggestions: entries.map((entry) => {
                    const suggestion: Monaco.languages.CompletionItem = {
                      label: entry.label,
                      kind: mapCompletionKind(monaco, entry.kind),
                      insertText: entry.insertText ?? entry.label,
                      range
                    };

                    if (entry.detail !== undefined) {
                      suggestion.detail = entry.detail;
                    }
                    if (entry.documentation !== undefined) {
                      suggestion.documentation = entry.documentation;
                    }
                    if (entry.sortText !== undefined) {
                      suggestion.sortText = entry.sortText;
                    }
                    if (entry.filterText !== undefined) {
                      suggestion.filterText = entry.filterText;
                    }

                    return suggestion;
                  })
                };
              }
            })
          )
        );

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          const latestState = latestStateRef.current;
          if (latestState === null) {
            return;
          }
          void save(latestState.instanceId, "manual");
        });
      })
      .catch((_error) => {
        setEditorReady(false);
      });

    return () => {
      disposed = true;
      setEditorReady(false);
      for (const disposable of disposables) {
        disposable.dispose();
      }
      const editor = editorRef.current;
      const textModel = textModelRef.current;
      editorRef.current = null;
      textModelRef.current = null;
      editor?.dispose();
      textModel?.dispose();
    };
  }, [canShowEditor, isAiOnly, requestCompletion, save, setContent, stateId]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (monaco === null) {
      return;
    }
    monaco.editor.defineTheme(MONACO_THEME_ID, buildMonacoTheme());
    monaco.editor.setTheme(MONACO_THEME_ID);
    editorRef.current?.updateOptions({
      readOnly: (state?.isReadOnly ?? true) || isAiOnly
    });
  }, [isAiOnly, state?.isReadOnly, themeSignature]);

  useEffect(() => {
    if (state === null) {
      return;
    }
    touchInstance(state.instanceId);
    const editor = editorRef.current;
    const textModel = textModelRef.current;
    const monaco = monacoRef.current;
    if (editor === null || textModel === null || monaco === null) {
      return;
    }

    if (textModel.getLanguageId() !== state.languageId) {
      monaco.editor.setModelLanguage(textModel, state.languageId);
    }

    if (textModel.getValue() !== state.content) {
      applyingStateRef.current = true;
      const currentValue = textModel.getValue();
      const currentLength = currentValue.length;

      if (currentLength > 0 && state.content.startsWith(currentValue)) {
        const appendedText = state.content.slice(currentLength);
        const lastLine = textModel.getLineCount();
        const lastCol = textModel.getLineMaxColumn(lastLine);
        textModel.pushEditOperations(
          [],
          [
            {
              range: new monaco.Range(lastLine, lastCol, lastLine, lastCol),
              text: appendedText
            }
          ],
          () => null
        );
        editor.revealLine(lastLine);
      } else {
        const selection = editor.getSelection();
        textModel.pushEditOperations(
          [],
          [
            {
              range: textModel.getFullModelRange(),
              text: state.content
            }
          ],
          () => null
        );
        if (selection !== null) {
          editor.setSelection(selection);
        }
      }
      applyingStateRef.current = false;
    }
  }, [state?.content, state?.instanceId, state?.languageId, touchInstance]);

  useEffect(() => {
    const stateEntry = state;
    const monaco = monacoRef.current;
    const textModel = textModelRef.current;
    if (stateEntry === null || monaco === null || textModel === null) {
      return;
    }

    const markers = stateEntry.diagnostics.map((diagnostic) => {
      const marker: Monaco.editor.IMarkerData = {
        startLineNumber: Math.max(1, diagnostic.startLine + 1),
        startColumn: Math.max(1, diagnostic.startCharacter + 1),
        endLineNumber: Math.max(1, diagnostic.endLine + 1),
        endColumn: Math.max(1, diagnostic.endCharacter + 1),
        severity: mapDiagnosticSeverity(monaco, diagnostic.severity),
        message: diagnostic.message
      };

      if (diagnostic.source !== undefined) {
        marker.source = diagnostic.source;
      }
      if (diagnostic.code !== undefined) {
        marker.code = diagnostic.code;
      }

      return marker;
    });

    monaco.editor.setModelMarkers(textModel, LSP_MARKER_OWNER, markers);

    return () => {
      monaco.editor.setModelMarkers(textModel, LSP_MARKER_OWNER, []);
    };
  }, [state, state?.diagnostics]);

  useEffect(() => {
    if (state === null) {
      return;
    }
    if (state.isDirty === false || state.isReadOnly || state.status === "saving") {
      return;
    }

    const timer = window.setTimeout(() => {
      void save(state.instanceId, "idle");
    }, AUTO_SAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [save, state?.content, state?.instanceId, state?.isDirty, state?.isReadOnly, state?.status]);

  useEffect(() => {
    if (isDiffMode === false) {
      return;
    }
    if (state === null || canShowEditor === false || editorReady === false) {
      return;
    }
    const monaco = monacoRef.current;
    const modifiedModel = textModelRef.current;
    const host = diffHostRef.current;
    if (monaco === null || modifiedModel === null || host === null) {
      return;
    }

    const originalModel = monaco.editor.createModel(diffOriginalContent, state.languageId);
    diffOriginalModelRef.current = originalModel;
    const diffEditor = monaco.editor.createDiffEditor(host, {
      automaticLayout: true,
      readOnly: true,
      renderSideBySide: true,
      originalEditable: false,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: "var(--lyra-font-mono)",
      fontSize: MONACO_FONT_SIZE,
      lineHeight: MONACO_LINE_HEIGHT
    });
    diffEditorRef.current = diffEditor;
    diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel
    });

    return () => {
      const activeDiffEditor = diffEditorRef.current;
      const activeOriginalModel = diffOriginalModelRef.current;
      diffEditorRef.current = null;
      diffOriginalModelRef.current = null;
      activeDiffEditor?.dispose();
      activeOriginalModel?.dispose();
    };
  }, [
    canShowEditor,
    editorReady,
    isDiffMode,
    state?.instanceId,
    diffOriginalContent
  ]);

  useEffect(() => {
    if (isDiffMode === false) {
      return;
    }
    const monaco = monacoRef.current;
    const originalModel = diffOriginalModelRef.current;
    if (state === null || monaco === null || originalModel === null) {
      return;
    }
    if (originalModel.getLanguageId() !== state.languageId) {
      monaco.editor.setModelLanguage(originalModel, state.languageId);
    }
    if (originalModel.getValue() !== diffOriginalContent) {
      originalModel.setValue(diffOriginalContent);
    }
  }, [isDiffMode, state?.languageId, diffOriginalContent]);

  useEffect(() => {
    if (canToggleDiff) {
      return;
    }
    setIsDiffMode(false);
  }, [canToggleDiff]);

  useEffect(() => {
    const revealLocation = state?.pendingRevealLocation;
    if (state === null || revealLocation === undefined) {
      return;
    }

    const targetEditor = isDiffMode
      ? diffEditorRef.current?.getModifiedEditor() ?? editorRef.current
      : editorRef.current;
    if (targetEditor === null) {
      return;
    }

    const textModel = targetEditor.getModel();
    const startLine = Math.max(1, revealLocation.line);
    const endLine = textModel === null
      ? Math.max(startLine, revealLocation.endLine ?? startLine)
      : Math.min(
          textModel.getLineCount(),
          Math.max(startLine, revealLocation.endLine ?? startLine)
        );
    const startColumn = Math.max(1, revealLocation.column ?? 1);
    const endColumn = textModel === null
      ? startColumn
      : Math.max(
          startColumn,
          textModel.getLineMaxColumn(Math.min(endLine, textModel.getLineCount()))
        );

    targetEditor.revealLineInCenter(startLine);
    targetEditor.setSelection({
      startLineNumber: startLine,
      startColumn,
      endLineNumber: endLine,
      endColumn
    });
    targetEditor.focus();
    void model.clearRevealLocation(state.instanceId);
  }, [
    isDiffMode,
    model,
    state?.content,
    state?.instanceId,
    state?.pendingRevealLocation
  ]);

  return {
    hostRef,
    diffHostRef,
    editorReady,
    isDiffMode,
    setIsDiffMode,
    canToggleDiff,
    showLoadingSkeleton,
    canShowEditor
  };
};
