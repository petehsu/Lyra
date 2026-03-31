import { AlertTriangle, Check, GitCompareArrows, Lock, Save, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import { loadMonaco } from "./monaco";
import { useLoadingVisibility } from "../shell/use-loading-visibility";
import type {
  FileEditorAppState,
  FileEditorChangeReviewItem,
  FileEditorControlMode,
  FileEditorLabels,
  FileEditorModel,
  FileEditorSurfaceVariant
} from "./types";

const MONACO_THEME_ID = "lyra-workbench";
const AUTO_SAVE_DELAY_MS = 800;
const LSP_MARKER_OWNER = "lyra-lsp";

const COMPLETION_TRIGGER_CHARACTERS = [".", ":", "\"", "'", "/", "@", "<"];

const mapCompletionKind = (
  monaco: typeof Monaco,
  kind: number | undefined
): Monaco.languages.CompletionItemKind => {
  switch (kind) {
    case 2:
      return monaco.languages.CompletionItemKind.Method;
    case 3:
      return monaco.languages.CompletionItemKind.Function;
    case 4:
      return monaco.languages.CompletionItemKind.Constructor;
    case 5:
      return monaco.languages.CompletionItemKind.Field;
    case 6:
      return monaco.languages.CompletionItemKind.Variable;
    case 7:
      return monaco.languages.CompletionItemKind.Class;
    case 8:
      return monaco.languages.CompletionItemKind.Interface;
    case 9:
      return monaco.languages.CompletionItemKind.Module;
    case 10:
      return monaco.languages.CompletionItemKind.Property;
    case 11:
      return monaco.languages.CompletionItemKind.Unit;
    case 12:
      return monaco.languages.CompletionItemKind.Value;
    case 13:
      return monaco.languages.CompletionItemKind.Enum;
    case 14:
      return monaco.languages.CompletionItemKind.Keyword;
    case 15:
      return monaco.languages.CompletionItemKind.Snippet;
    case 16:
      return monaco.languages.CompletionItemKind.Color;
    case 17:
      return monaco.languages.CompletionItemKind.File;
    case 18:
      return monaco.languages.CompletionItemKind.Reference;
    case 19:
      return monaco.languages.CompletionItemKind.Folder;
    case 20:
      return monaco.languages.CompletionItemKind.EnumMember;
    case 21:
      return monaco.languages.CompletionItemKind.Constant;
    case 22:
      return monaco.languages.CompletionItemKind.Struct;
    case 23:
      return monaco.languages.CompletionItemKind.Event;
    case 24:
      return monaco.languages.CompletionItemKind.Operator;
    case 25:
      return monaco.languages.CompletionItemKind.TypeParameter;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
};

const mapDiagnosticSeverity = (
  monaco: typeof Monaco,
  severity: number | undefined
): Monaco.MarkerSeverity => {
  if (severity === 1) return monaco.MarkerSeverity.Error;
  if (severity === 2) return monaco.MarkerSeverity.Warning;
  if (severity === 3) return monaco.MarkerSeverity.Info;
  if (severity === 4) return monaco.MarkerSeverity.Hint;
  return monaco.MarkerSeverity.Info;
};

const renderToolbarScanText = (
  value: string,
  keyPrefix: string,
  tone: "title" | "path"
) =>
  Array.from(value).map((char, index) => (
    <span
      key={`${keyPrefix}-char-${index}`}
      className={`lyra-file-editor-toolbar-scan-char lyra-file-editor-toolbar-scan-char-${tone}`}
      style={{ animationDelay: `${index * 24}ms` }}
    >
      {char === " " ? "\u00A0" : char}
    </span>
  ));

type FileEditorSurfaceProps = {
  readonly state: FileEditorAppState | null;
  readonly labels: FileEditorLabels;
  readonly themeSignature: string;
  readonly model: FileEditorModel;
  readonly surfaceVariant?: FileEditorSurfaceVariant;
  readonly controlMode?: FileEditorControlMode;
  readonly editorWorkAcceptLabel?: string;
  readonly editorWorkRejectLabel?: string;
  readonly editorWorkUndoLabel?: string;
  readonly activeEditorWorkItem?: FileEditorChangeReviewItem;
  readonly onAcceptEditorWorkItem?: (item: FileEditorChangeReviewItem) => void;
  readonly onRejectEditorWorkItem?: (item: FileEditorChangeReviewItem) => void;
  readonly onUndoEditorWorkItem?: (item: FileEditorChangeReviewItem) => void;
};

const readRootCssVar = (name: string, fallback: string): string => {
  if (typeof window === "undefined") {
    return fallback;
  }
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value.length > 0 ? value : fallback;
};

const buildMonacoTheme = (): Monaco.editor.IStandaloneThemeData => ({
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": readRootCssVar("--lyra-bg-editor", "#0f1116"),
    "editor.foreground": readRootCssVar("--lyra-text-primary", "#d5d7de"),
    "editorLineNumber.foreground": readRootCssVar("--lyra-text-muted", "#757a86"),
    "editorLineNumber.activeForeground": readRootCssVar("--lyra-text-secondary", "#aeb4c3"),
    "editorCursor.foreground": readRootCssVar("--lyra-line-focused", "#4a8cf7"),
    "editor.selectionBackground": readRootCssVar("--lyra-terminal-selection-bg", "#325fa333"),
    "editor.inactiveSelectionBackground": readRootCssVar("--lyra-bg-hover", "#2b3241"),
    "editorLineNumber.dimmedForeground": readRootCssVar("--lyra-text-muted", "#697082"),
    "editorIndentGuide.background1": readRootCssVar("--lyra-line-variant", "#2f3341"),
    "editorIndentGuide.activeBackground1": readRootCssVar("--lyra-line-default", "#4a4f60"),
    "editorGutter.background": readRootCssVar("--lyra-bg-editor", "#0f1116")
  }
});

export const FileEditorSurface = ({
  state,
  labels,
  themeSignature,
  model,
  surfaceVariant = "full",
  controlMode = "human_takeover",
  editorWorkAcceptLabel,
  editorWorkRejectLabel,
  editorWorkUndoLabel,
  activeEditorWorkItem,
  onAcceptEditorWorkItem,
  onRejectEditorWorkItem,
  onUndoEditorWorkItem
}: FileEditorSurfaceProps) => {
  const hydrateIfNeeded = model.hydrateIfNeeded;
  const touchInstance = model.touchInstance;
  const setContent = model.setContent;
  const save = model.save;
  const requestCompletion = model.requestCompletion;
  const openFile = model.openFile;

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
    activeEditorWorkItem !== undefined &&
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
          fontSize: 13,
          lineHeight: 20,
          padding: {
            top: 12,
            bottom: 12
          },
          readOnly: latestState.isReadOnly || isAiOnly
        });
        editorRef.current = editor;
        setEditorReady(true);

        const onContentChange = textModel.onDidChangeContent(() => {
          const latestState = latestStateRef.current;
          if (applyingStateRef.current || latestState === null) {
            return;
          }
          setContent(latestState.instanceId, textModel.getValue());
        });

        const onBlur = editor.onDidBlurEditorWidget(() => {
          const latestState = latestStateRef.current;
          if (latestState === null) {
            return;
          }
          void save(latestState.instanceId, "blur");
        });

        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          const latestState = latestStateRef.current;
          if (latestState === null) {
            return;
          }
          void save(latestState.instanceId, "manual");
        });

        const completionProviders = [
          "typescript",
          "javascript",
          "rust",
          "python"
        ].map((languageId) =>
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
        );

        return () => {
          onContentChange.dispose();
          onBlur.dispose();
          for (const provider of completionProviders) {
            provider.dispose();
          }
        };
      })
      .catch((_error) => {
        setEditorReady(false);
      });

    return () => {
      disposed = true;
      setEditorReady(false);
      const editor = editorRef.current;
      const textModel = textModelRef.current;
      editorRef.current = null;
      textModelRef.current = null;
      if (editor !== null) {
        editor.dispose();
      }
      if (textModel !== null) {
        textModel.dispose();
      }
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
      fontSize: 13,
      lineHeight: 20
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

  if (state === null) {
    return null;
  }

  const hasEditorWorkActions =
    activeEditorWorkItem !== undefined &&
    activeEditorWorkItem.status === "completed" &&
    editorWorkAcceptLabel !== undefined &&
    editorWorkRejectLabel !== undefined &&
    editorWorkUndoLabel !== undefined;
  const isEditorWorkRunning = activeEditorWorkItem?.status === "running";
  const editorWorkIsAccepted = activeEditorWorkItem?.decision === "accepted";
  const editorWorkIsRejected = activeEditorWorkItem?.decision === "rejected";
  const diffToggleLabel = isDiffMode ? labels.closeDiff : labels.openDiff;

  return (
    <section
      className={`lyra-file-editor-surface lyra-file-editor-surface-${surfaceVariant} lyra-file-editor-control-${controlMode}`}
      aria-label="file-editor-surface"
    >
      <header className="lyra-file-editor-toolbar">
        <div
          className={
            isEditorWorkRunning
              ? "lyra-file-editor-toolbar-main lyra-file-editor-toolbar-main-running"
              : "lyra-file-editor-toolbar-main"
          }
        >
          <strong>
            {isEditorWorkRunning
              ? renderToolbarScanText(state.title, `${state.instanceId}-title`, "title")
              : state.title}
          </strong>
          <small>
            {isEditorWorkRunning
              ? renderToolbarScanText(state.filePath, `${state.instanceId}-path`, "path")
              : state.filePath}
          </small>
        </div>
        <div className="lyra-file-editor-toolbar-actions">
          {activeEditorWorkItem !== undefined ? (
            <span className="lyra-file-editor-ai-work-delta" aria-label={`+${activeEditorWorkItem.addedLines} -${activeEditorWorkItem.removedLines}`}>
              <span className="lyra-file-editor-ai-work-delta-added">
                +{activeEditorWorkItem.addedLines}
              </span>
              <span className="lyra-file-editor-ai-work-delta-removed">
                -{activeEditorWorkItem.removedLines}
              </span>
            </span>
          ) : null}
          {canToggleDiff ? (
            <button
              type="button"
              className={
                isDiffMode
                  ? "lyra-file-editor-diff-toggle lyra-file-editor-diff-toggle-active"
                  : "lyra-file-editor-diff-toggle"
              }
              aria-label={diffToggleLabel}
              aria-pressed={isDiffMode}
              onClick={() => {
                setIsDiffMode((current) => !current);
              }}
            >
              <GitCompareArrows size={13} />
            </button>
          ) : null}
          {hasEditorWorkActions ? (
            <span className="lyra-file-editor-ai-work-actions">
              {editorWorkIsAccepted ? (
                <button
                  type="button"
                  className="lyra-file-editor-ai-work-action lyra-file-editor-ai-work-action-undo"
                  aria-label={editorWorkUndoLabel}
                  onClick={() => {
                    if (activeEditorWorkItem !== undefined) {
                      onUndoEditorWorkItem?.(activeEditorWorkItem);
                    }
                  }}
                >
                  <Undo2 size={12} />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="lyra-file-editor-ai-work-action lyra-file-editor-ai-work-action-accept"
                    aria-label={editorWorkAcceptLabel}
                    onClick={() => {
                      if (activeEditorWorkItem !== undefined) {
                        onAcceptEditorWorkItem?.(activeEditorWorkItem);
                      }
                    }}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    className={
                      editorWorkIsRejected
                        ? "lyra-file-editor-ai-work-action lyra-file-editor-ai-work-action-reject lyra-file-editor-ai-work-action-rejected"
                        : "lyra-file-editor-ai-work-action lyra-file-editor-ai-work-action-reject"
                    }
                    aria-label={editorWorkRejectLabel}
                    onClick={() => {
                      if (activeEditorWorkItem !== undefined) {
                        onRejectEditorWorkItem?.(activeEditorWorkItem);
                      }
                    }}
                  >
                    <X size={12} />
                  </button>
                </>
              )}
            </span>
          ) : null}
          {state.isReadOnly ? (
            <span className="lyra-file-editor-chip">
              <Lock size={12} />
              {labels.readOnly}
            </span>
          ) : null}
          {state.status === "conflict" ? (
            <span className="lyra-file-editor-chip lyra-file-editor-chip-warning">
              <AlertTriangle size={12} />
              {labels.conflict}
            </span>
          ) : null}
          {isAiOnly ? null : (
            <button
              className="lyra-file-editor-save-button"
              aria-label={labels.save}
              disabled={state.isReadOnly || state.isDirty === false || state.status === "loading"}
              onClick={() => {
                void save(state.instanceId, "manual");
              }}
            >
              <Save size={14} />
            </button>
          )}
        </div>
      </header>

      {state.status === "unsupported" || state.status === "error" ? (
        <section className="lyra-file-editor-empty-state">
          <AlertTriangle size={16} />
          <p>{state.message ?? labels.unsupported}</p>
          <button
            className="lyra-file-editor-retry-button"
            onClick={() => {
              void openFile(state.instanceId, state.filePath);
            }}
          >
            {labels.retry}
          </button>
        </section>
          ) : (
        <section className="lyra-file-editor-body">
          {showLoadingSkeleton ? (
            <div className="lyra-file-editor-loading" aria-label="file-editor-loading-skeleton">
              <div className="lyra-file-editor-loading-skeleton">
                <span className="lyra-skeleton-block lyra-file-editor-skeleton-title" />
                <span className="lyra-skeleton-block lyra-file-editor-skeleton-line" />
                <span className="lyra-skeleton-block lyra-file-editor-skeleton-line lyra-file-editor-skeleton-line-short" />
                <span className="lyra-skeleton-block lyra-file-editor-skeleton-line" />
                <span className="lyra-skeleton-block lyra-file-editor-skeleton-line lyra-file-editor-skeleton-line-short" />
              </div>
            </div>
          ) : null}
          <div
            ref={hostRef}
            className={
              showLoadingSkeleton || isDiffMode
                ? "lyra-file-editor-host lyra-file-editor-host-hidden"
                : "lyra-file-editor-host"
            }
          />
          <div
            ref={diffHostRef}
            className={
              isDiffMode
                ? "lyra-file-editor-diff-host"
                : "lyra-file-editor-diff-host lyra-file-editor-diff-host-hidden"
            }
          />
        </section>
      )}
    </section>
  );
};
