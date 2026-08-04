import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SyntheticEvent
} from "react";

import {
  optionalFirstPartyCodeEditorService,
  type FirstPartyCodeDiffHandleV1,
  type FirstPartyCodeEditorCompletionItemV1,
  type FirstPartyCodeEditorCompletionPositionV1,
  type FirstPartyCodeEditorHandleV1,
  type FirstPartyCodeEditorPresentationV1,
  type FirstPartyCodeEditorSelectionV1,
  type FirstPartyCodeEditorServiceV1
} from "@lyra/first-party-app-kit";

type RuntimeState = "loading" | "monaco" | "fallback";

const readCodeEditorService = (): FirstPartyCodeEditorServiceV1 | undefined =>
  optionalFirstPartyCodeEditorService();

export type EditorCodeSurfaceProps = {
  readonly resourceId: string;
  readonly value: string;
  readonly languageId: string;
  readonly readOnly: boolean;
  readonly selection: FirstPartyCodeEditorSelectionV1 | null;
  readonly presentation: FirstPartyCodeEditorPresentationV1;
  readonly style: CSSProperties;
  readonly onChange: (value: string) => void;
  readonly onSelectionChange: (selection: FirstPartyCodeEditorSelectionV1) => void;
  readonly onSave: () => void | Promise<void>;
  readonly onFocusChange: (focused: boolean) => void;
  readonly provideCompletions: (
    position: FirstPartyCodeEditorCompletionPositionV1
  ) => Promise<readonly FirstPartyCodeEditorCompletionItemV1[]>;
};

export const EditorCodeSurface = ({
  resourceId,
  value,
  languageId,
  readOnly,
  selection,
  presentation,
  style,
  onChange,
  onSelectionChange,
  onSave,
  onFocusChange,
  provideCompletions
}: EditorCodeSurfaceProps) => {
  const serviceRef = useRef<FirstPartyCodeEditorServiceV1 | undefined>(undefined);
  const serviceResolvedRef = useRef(false);
  if (!serviceResolvedRef.current) {
    serviceRef.current = readCodeEditorService();
    serviceResolvedRef.current = true;
  }
  const service = serviceRef.current;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const handleRef = useRef<FirstPartyCodeEditorHandleV1 | null>(null);
  const latestRef = useRef({
    value,
    languageId,
    readOnly,
    selection,
    presentation,
    onChange,
    onSelectionChange,
    onSave,
    onFocusChange,
    provideCompletions
  });
  latestRef.current = {
    value,
    languageId,
    readOnly,
    selection,
    presentation,
    onChange,
    onSelectionChange,
    onSave,
    onFocusChange,
    provideCompletions
  };
  const [runtimeState, setRuntimeState] = useState<RuntimeState>(
    service === undefined ? "fallback" : "loading"
  );

  useEffect(() => {
    if (service === undefined) {
      setRuntimeState("fallback");
      return;
    }
    const container = containerRef.current;
    if (container === null) return;
    let disposed = false;
    const initial = latestRef.current;
    void service.mountEditor({
      container,
      resourceId,
      value: initial.value,
      languageId: initial.languageId,
      readOnly: initial.readOnly,
      ...(initial.selection === null ? {} : { selection: initial.selection }),
      presentation: initial.presentation,
      onChange: (nextValue) => latestRef.current.onChange(nextValue),
      onSelectionChange: (nextSelection) =>
        latestRef.current.onSelectionChange(nextSelection),
      onSave: () => latestRef.current.onSave(),
      onFocusChange: (focused) => latestRef.current.onFocusChange(focused),
      provideCompletions: (position) => latestRef.current.provideCompletions(position)
    }).then((handle) => {
      if (disposed) {
        handle.dispose();
        return;
      }
      handleRef.current = handle;
      const latest = latestRef.current;
      handle.update({
        value: latest.value,
        languageId: latest.languageId,
        readOnly: latest.readOnly,
        ...(latest.selection === null ? {} : { selection: latest.selection }),
        presentation: latest.presentation
      });
      setRuntimeState("monaco");
    }).catch(() => {
      if (!disposed) setRuntimeState("fallback");
    });
    return () => {
      disposed = true;
      handleRef.current?.dispose();
      handleRef.current = null;
      latestRef.current.onFocusChange(false);
    };
  }, [resourceId, service]);

  useEffect(() => {
    const handle = handleRef.current;
    if (handle === null) return;
    handle.update({ value, languageId, readOnly, presentation });
  }, [languageId, presentation.themeId, presentation.themeTone, readOnly, runtimeState, value]);

  useEffect(() => {
    if (runtimeState !== "fallback" || selection === null || textareaRef.current === null) {
      return;
    }
    textareaRef.current.setSelectionRange(selection.start, selection.end);
  }, [runtimeState, selection?.end, selection?.start]);

  const updateFallbackSelection = (event: SyntheticEvent<HTMLTextAreaElement>): void => {
    onSelectionChange({
      start: event.currentTarget.selectionStart,
      end: event.currentTarget.selectionEnd
    });
  };
  const onFallbackKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void onSave();
    }
  };

  return (
    <>
      <div
        ref={containerRef}
        aria-label="editor-monaco-surface"
        data-lyra-editor-runtime={runtimeState}
        style={{ ...style, display: runtimeState === "fallback" ? "none" : "block" }}
      />
      {runtimeState === "fallback" ? (
        <textarea
          ref={textareaRef}
          aria-label="editor-text-surface"
          value={value}
          readOnly={readOnly}
          spellCheck={false}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onKeyDown={onFallbackKeyDown}
          onSelect={updateFallbackSelection}
          onChange={(event) => onChange(event.target.value)}
          style={style}
        />
      ) : null}
    </>
  );
};

export type EditorDiffSurfaceProps = {
  readonly resourceId: string;
  readonly original: string;
  readonly modified: string;
  readonly languageId: string;
  readonly presentation: FirstPartyCodeEditorPresentationV1;
  readonly style: CSSProperties;
  readonly fallback: ReactNode;
};

export const EditorDiffSurface = ({
  resourceId,
  original,
  modified,
  languageId,
  presentation,
  style,
  fallback
}: EditorDiffSurfaceProps) => {
  const serviceRef = useRef<FirstPartyCodeEditorServiceV1 | undefined>(undefined);
  const serviceResolvedRef = useRef(false);
  if (!serviceResolvedRef.current) {
    serviceRef.current = readCodeEditorService();
    serviceResolvedRef.current = true;
  }
  const service = serviceRef.current;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<FirstPartyCodeDiffHandleV1 | null>(null);
  const latestRef = useRef({ original, modified, languageId, presentation });
  latestRef.current = { original, modified, languageId, presentation };
  const [runtimeState, setRuntimeState] = useState<RuntimeState>(
    service === undefined ? "fallback" : "loading"
  );

  useEffect(() => {
    if (service === undefined) {
      setRuntimeState("fallback");
      return;
    }
    const container = containerRef.current;
    if (container === null) return;
    let disposed = false;
    const initial = latestRef.current;
    void service.mountDiff({
      container,
      resourceId,
      original: initial.original,
      modified: initial.modified,
      languageId: initial.languageId,
      presentation: initial.presentation
    }).then((handle) => {
      if (disposed) {
        handle.dispose();
        return;
      }
      handleRef.current = handle;
      handle.update(latestRef.current);
      setRuntimeState("monaco");
    }).catch(() => {
      if (!disposed) setRuntimeState("fallback");
    });
    return () => {
      disposed = true;
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [resourceId, service]);

  useEffect(() => {
    handleRef.current?.update({ original, modified, languageId, presentation });
  }, [languageId, modified, original, presentation.themeId, presentation.themeTone, runtimeState]);

  if (runtimeState === "fallback") return fallback;
  return (
    <div
      ref={containerRef}
      aria-label="editor-monaco-diff-surface"
      data-lyra-editor-diff-runtime={runtimeState}
      style={style}
    />
  );
};
