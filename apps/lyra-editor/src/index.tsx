import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties
} from "react";

import {
  createFirstPartyAppModule,
  LyraAppState,
  type FirstPartyCodeEditorCompletionItemV1,
  type FirstPartyCodeEditorCompletionPositionV1,
  type FirstPartyCodeEditorSelectionV1,
  type FirstPartySurfaceProps
} from "@lyra/first-party-app-kit";

import { EditorCodeSurface, EditorDiffSurface } from "./code-editor-surface";

const COMMANDS = {
  read: "lyra.core.editor.read",
  open: "lyra.core.editor.open",
  setContent: "lyra.core.editor.set-content",
  save: "lyra.core.editor.save",
  stat: "lyra.core.editor.stat",
  complete: "lyra.core.editor.complete"
} as const;

export type EditorModuleState = {
  readonly instanceId: string;
  readonly sessionId: string;
  readonly filePath: string;
  readonly title: string;
  readonly status:
    | "idle"
    | "loading"
    | "ready"
    | "saving"
    | "unsupported"
    | "conflict"
    | "error";
  readonly languageId: string;
  readonly encoding: "utf8" | "utf8-bom";
  readonly content: string;
  readonly lastSavedContent: string;
  readonly isDirty: boolean;
  readonly isReadOnly: boolean;
  readonly isHydrated: boolean;
  readonly sizeBytes: number;
  readonly unsupportedReason?: string;
  readonly message?: string;
  readonly lastSavedAt?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Core returned an invalid Editor field: ${field}`);
  }
  return value;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

export const parseEditorModuleState = (value: unknown): EditorModuleState | null => {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new Error("Core returned an invalid Editor state.");
  }
  const status = value.status;
  const encoding = value.encoding;
  if (
    status !== "idle"
    && status !== "loading"
    && status !== "ready"
    && status !== "saving"
    && status !== "unsupported"
    && status !== "conflict"
    && status !== "error"
  ) {
    throw new Error("Core returned an invalid Editor status.");
  }
  if (encoding !== "utf8" && encoding !== "utf8-bom") {
    throw new Error("Core returned an invalid Editor encoding.");
  }
  if (
    typeof value.content !== "string"
    || typeof value.lastSavedContent !== "string"
    || typeof value.isDirty !== "boolean"
    || typeof value.isReadOnly !== "boolean"
    || typeof value.isHydrated !== "boolean"
  ) {
    throw new Error("Core returned invalid Editor content metadata.");
  }
  const unsupportedReason = optionalString(value.unsupportedReason);
  const message = optionalString(value.message);
  const lastSavedAt = optionalString(value.lastSavedAt);
  return {
    instanceId: requiredString(value.instanceId, "instanceId"),
    sessionId: requiredString(value.sessionId, "sessionId"),
    filePath: requiredString(value.filePath, "filePath"),
    title: requiredString(value.title, "title"),
    status,
    languageId: requiredString(value.languageId, "languageId"),
    encoding,
    content: value.content,
    lastSavedContent: value.lastSavedContent,
    isDirty: value.isDirty,
    isReadOnly: value.isReadOnly,
    isHydrated: value.isHydrated,
    sizeBytes: typeof value.sizeBytes === "number" && Number.isFinite(value.sizeBytes)
      ? value.sizeBytes
      : 0,
    ...(unsupportedReason === undefined ? {} : { unsupportedReason }),
    ...(message === undefined ? {} : { message }),
    ...(lastSavedAt === undefined ? {} : { lastSavedAt })
  };
};

export const parseEditorCompletionItems = (
  value: unknown
): readonly FirstPartyCodeEditorCompletionItemV1[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.label !== "string" || entry.label.length === 0) {
      return [];
    }
    const optionalField = (field: string): string | undefined =>
      typeof entry[field] === "string" && entry[field].length > 0
        ? entry[field]
        : undefined;
    const insertText = optionalField("insertText");
    const detail = optionalField("detail");
    const documentation = optionalField("documentation");
    const sortText = optionalField("sortText");
    const filterText = optionalField("filterText");
    const kind = typeof entry.kind === "number" && Number.isFinite(entry.kind)
      ? Math.floor(entry.kind)
      : undefined;
    return [{
      label: entry.label,
      ...(insertText === undefined ? {} : { insertText }),
      ...(detail === undefined ? {} : { detail }),
      ...(documentation === undefined ? {} : { documentation }),
      ...(kind === undefined ? {} : { kind }),
      ...(sortText === undefined ? {} : { sortText }),
      ...(filterText === undefined ? {} : { filterText })
    }];
  });
};

const copy = (locale: string) => {
  const chinese = locale.toLowerCase().startsWith("zh");
  return chinese ? {
    loading: "正在读取文件…", unavailable: "文件不可用", unsupported: "无法以文本方式编辑此文件",
    conflict: "磁盘上的文件已更改，请重新打开后再编辑。", retry: "重新打开", save: "保存",
    saving: "正在保存…", saved: "已保存", unsaved: "未保存", readOnly: "只读",
    diff: "比较更改", closeDiff: "关闭比较", original: "已保存版本", current: "当前版本",
    editor: "编辑器"
  } : {
    loading: "Reading file…", unavailable: "File unavailable", unsupported: "This file cannot be edited as text",
    conflict: "The file changed on disk. Reopen it before editing again.", retry: "Reopen", save: "Save",
    saving: "Saving…", saved: "Saved", unsaved: "Unsaved", readOnly: "Read only",
    diff: "Compare changes", closeDiff: "Close comparison", original: "Saved version", current: "Current version",
    editor: "Editor"
  };
};

const codeStyle: CSSProperties = {
  margin: 0,
  padding: 14,
  minWidth: 0,
  minHeight: 0,
  overflow: "auto",
  whiteSpace: "pre",
  tabSize: 2,
  color: "var(--lyra-text-primary)",
  background: "var(--lyra-app-panel-bg)",
  fontFamily: "var(--lyra-font-mono)",
  fontSize: 13,
  lineHeight: "20px"
};

const EditorSurface = ({
  host,
  instanceId,
  opaqueState,
  presentation,
  updateOpaqueState
}: FirstPartySurfaceProps) => {
  const labels = copy(presentation.locale);
  const restoredSelection = isRecord(opaqueState) && isRecord(opaqueState.selection)
    ? {
        start: typeof opaqueState.selection.start === "number"
          && Number.isFinite(opaqueState.selection.start)
          ? opaqueState.selection.start
          : 0,
        end: typeof opaqueState.selection.end === "number"
          && Number.isFinite(opaqueState.selection.end)
          ? opaqueState.selection.end
          : 0
      }
    : null;
  const [state, setState] = useState<EditorModuleState | null>(null);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const latestContentRef = useRef("");
  const opaqueStateRef = useRef(opaqueState);
  const editorFocusedRef = useRef(false);
  opaqueStateRef.current = opaqueState;

  const acceptState = useCallback((value: unknown) => {
    const next = parseEditorModuleState(value);
    setState(next);
    if (next !== null) {
      latestContentRef.current = next.content;
      setContent(next.content);
      const persistedState = opaqueStateRef.current;
      updateOpaqueState({
        filePath: next.filePath,
        ...(isRecord(persistedState) && isRecord(persistedState.selection)
          ? { selection: persistedState.selection }
          : {})
      });
    }
    setError(null);
    return next;
  }, [updateOpaqueState]);

  const refresh = useCallback(async () => {
    try {
      const readValue = await host.executeCommand(COMMANDS.read, { instanceId });
      const readState = parseEditorModuleState(readValue);
      const persistedState = opaqueStateRef.current;
      if (
        readState === null
        && isRecord(persistedState)
        && typeof persistedState.filePath === "string"
        && persistedState.filePath.length > 0
      ) {
        // A nested editor can be restored before its Core-owned editor model
        // has been recreated. Re-open the persisted file once rather than
        // leaving the child surface blank.
        acceptState(await host.executeCommand(COMMANDS.open, {
          instanceId,
          path: persistedState.filePath
        }));
      } else {
        acceptState(readState);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [acceptState, host, instanceId]);

  const save = useCallback(async () => {
    try {
      await host.executeCommand(COMMANDS.setContent, {
        instanceId,
        content: latestContentRef.current
      });
      acceptState(await host.executeCommand(COMMANDS.save, { instanceId }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [acceptState, host, instanceId]);

  const reopen = useCallback(async () => {
    if (state === null) {
      await refresh();
      return;
    }
    try {
      acceptState(await host.executeCommand(COMMANDS.open, {
        instanceId,
        path: state.filePath
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [acceptState, host, instanceId, refresh, state]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (!editorFocusedRef.current) {
        void refresh();
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const updateSelection = useCallback((selection: FirstPartyCodeEditorSelectionV1) => {
    updateOpaqueState({
      ...(state === null ? {} : { filePath: state.filePath }),
      selection
    });
  }, [state, updateOpaqueState]);

  const updateContent = useCallback((next: string) => {
    latestContentRef.current = next;
    setContent(next);
    setState((current) => current === null ? null : {
      ...current,
      content: next,
      isDirty: next !== current.lastSavedContent
    });
    void host.executeCommand(COMMANDS.setContent, {
      instanceId,
      content: next
    }).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  }, [host, instanceId]);

  const provideCompletions = useCallback(async ({
    line,
    column
  }: FirstPartyCodeEditorCompletionPositionV1) =>
    parseEditorCompletionItems(await host.executeCommand(COMMANDS.complete, {
      instanceId,
      line,
      column
    })), [host, instanceId]);

  const statusMessage = state?.status === "saving"
    ? labels.saving
    : state?.isReadOnly
      ? labels.readOnly
      : state?.isDirty
        ? labels.unsaved
        : labels.saved;

  const body = () => {
    if (error !== null) {
      return (
        <LyraAppState
          kind="error"
          title={error}
          actionLabel={labels.retry}
          onAction={() => void refresh()}
        />
      );
    }
    if (state === null || state.status === "idle" || state.status === "loading") {
      return <LyraAppState kind="loading" title={labels.loading} />;
    }
    if (state.status === "unsupported" || state.status === "error" || state.status === "conflict") {
      const message = state.status === "unsupported"
        ? state.unsupportedReason ?? labels.unsupported
        : state.status === "conflict"
          ? state.message ?? labels.conflict
          : state.message ?? labels.unavailable;
      return (
        <LyraAppState
          kind="error"
          title={message}
          actionLabel={labels.retry}
          onAction={() => void reopen()}
        />
      );
    }
    if (showDiff) {
      const fallback = (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", minWidth: 0, minHeight: 0 }}>
          <section style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", minWidth: 0, minHeight: 0, borderRight: "var(--lyra-stroke-thin) solid var(--lyra-app-border)" }}>
            <strong style={{ padding: "7px 12px", fontSize: 12 }}>{labels.original}</strong>
            <pre style={codeStyle}>{state.lastSavedContent}</pre>
          </section>
          <section style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", minWidth: 0, minHeight: 0 }}>
            <strong style={{ padding: "7px 12px", fontSize: 12 }}>{labels.current}</strong>
            <pre style={codeStyle}>{content}</pre>
          </section>
        </div>
      );
      return (
        <EditorDiffSurface
          resourceId={`lyra.editor@${__LYRA_APP_VERSION__}:${instanceId}:diff`}
          original={state.lastSavedContent}
          modified={content}
          languageId={state.languageId}
          presentation={presentation}
          fallback={fallback}
          style={{ width: "100%", height: "100%", minWidth: 0, minHeight: 0 }}
        />
      );
    }
    return (
      <EditorCodeSurface
        resourceId={`lyra.editor@${__LYRA_APP_VERSION__}:${instanceId}`}
        value={content}
        readOnly={state.isReadOnly}
        languageId={state.languageId}
        selection={restoredSelection}
        presentation={presentation}
        onChange={updateContent}
        onSelectionChange={updateSelection}
        onSave={save}
        onFocusChange={(focused) => {
          editorFocusedRef.current = focused;
        }}
        provideCompletions={provideCompletions}
        style={{
          ...codeStyle,
          width: "100%",
          height: "100%",
          border: 0,
          resize: "none",
          outline: "none",
          boxSizing: "border-box"
        }}
      />
    );
  };

  return (
    <section
      className="lyra-app-module"
      data-lyra-component="lyra.editor"
      aria-label="file-editor-surface"
      style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr) auto" }}
    >
      <header className="lyra-app-module-toolbar">
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {state?.title ?? labels.editor}
        </strong>
        <small className="lyra-app-module-muted">{statusMessage}</small>
        <span style={{ flex: 1 }} />
        <button className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm" disabled={state === null || !state.isDirty} onClick={() => setShowDiff((current) => !current)}>
          {showDiff ? labels.closeDiff : labels.diff}
        </button>
        <button
          className="lyra-ui-button lyra-ui-button-secondary lyra-ui-button-size-sm"
          disabled={state === null || state.isReadOnly || !state.isDirty || state.status === "saving"}
          onClick={() => void save()}
        >
          {labels.save}
        </button>
      </header>
      {body()}
      <footer className="lyra-app-module-footer">
        <span>{state?.filePath ?? ""}</span>
        <span>{state === null ? "" : `${state.languageId} · ${state.encoding} · ${state.sizeBytes} B`}</span>
      </footer>
    </section>
  );
};

export const lyraAppModule = createFirstPartyAppModule({
  componentId: "lyra.editor",
  version: __LYRA_APP_VERSION__,
  contributions: {
    commands: [
      { id: "lyra.editor.save", title: "Save active editor" },
      { id: "lyra.editor.reload", title: "Reload active editor" }
    ],
    status: [
      { id: "lyra.editor.status", title: "Editor" }
    ]
  },
  commandHandlers: {
    "lyra.editor.save": (host, input) =>
      host.executeCommand(COMMANDS.save, input),
    "lyra.editor.reload": async (host, input) => {
      if (!isRecord(input) || typeof input.instanceId !== "string") {
        throw new Error("Editor reload requires an instanceId.");
      }
      const state = parseEditorModuleState(await host.executeCommand(COMMANDS.read, {
        instanceId: input.instanceId
      }));
      if (state === null) return null;
      return host.executeCommand(COMMANDS.open, {
        instanceId: input.instanceId,
        path: state.filePath
      });
    }
  },
  surfaces: {
    "file-editor": {
      title: "Editor",
      description: "Edit workspace files with persisted dirty state and change review.",
      component: EditorSurface
    }
  }
});

export default lyraAppModule;
