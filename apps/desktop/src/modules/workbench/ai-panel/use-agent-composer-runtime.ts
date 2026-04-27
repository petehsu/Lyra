import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject
} from "react";

import {
  measureTextAreaCaretRect,
  measureTextAreaTextRects,
  useCaretMotionState,
  useCaretPressState,
  type ModernCaretMotionTrail,
  type ModernCaretRect
} from "../caret/modern-caret";
import {
  AGENT_COMPOSER_MAX_HEIGHT,
  AGENT_COMPOSER_MAX_TEXT_EFFECT_SEGMENTS,
  AGENT_COMPOSER_MIN_HEIGHT,
  AGENT_COMPOSER_TEXT_EFFECT_LIFETIME_MS,
  diffComposerText
} from "./agent-composer-model";
import type {
  AgentComposerAppendRequest,
  AgentComposerSubmitAction,
  ComposerTextEffect,
  ComposerTextEffectDraft
} from "./agent-composer-types";

type UseAgentComposerRuntimeInput = {
  readonly currentThreadId: string | null;
  readonly initialValue: string;
  readonly appendRequest: AgentComposerAppendRequest | null;
  readonly inputDisabled: boolean;
  readonly sendDisabled: boolean;
  readonly sending: boolean;
  readonly onHeightChange?: ((height: number) => void) | undefined;
  readonly onSend: (value: string) => void | Promise<void>;
  readonly onSteer?: ((value: string) => void | Promise<void>) | undefined;
};

export type AgentComposerRuntime = {
  readonly containerRef: RefObject<HTMLDivElement>;
  readonly toolsMenuRef: RefObject<HTMLDivElement>;
  readonly inputRef: RefObject<HTMLTextAreaElement>;
  readonly draftValue: string;
  readonly hasContent: boolean;
  readonly inputFocused: boolean;
  readonly toolsMenuOpen: boolean;
  readonly modelSubmenuOpen: boolean;
  readonly caretRect: ModernCaretRect | null;
  readonly isCaretIdle: boolean;
  readonly isCaretPressed: boolean;
  readonly caretMotionToken: number;
  readonly caretMotionTrail: ModernCaretMotionTrail | null;
  readonly textEffects: readonly ComposerTextEffect[];
  readonly setDraftValue: (value: string) => void;
  readonly submit: (action: AgentComposerSubmitAction) => Promise<void>;
  readonly toggleToolsMenu: () => void;
  readonly toggleModelSubmenu: () => void;
  readonly closeMenus: () => void;
  readonly selectModel: (
    value: string,
    onModelSelect: ((modelName: string) => void) | undefined
  ) => void;
  readonly onTextareaCompositionStart: () => void;
  readonly onTextareaCompositionEnd: () => void;
  readonly onTextareaFocus: () => void;
  readonly onTextareaBlur: () => void;
  readonly onTextareaScroll: () => void;
  readonly onTextareaInput: () => void;
  readonly onTextareaKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onTextareaKeyUp: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
};

export const useAgentComposerRuntime = ({
  currentThreadId,
  initialValue,
  appendRequest,
  inputDisabled,
  sendDisabled,
  sending,
  onHeightChange,
  onSend,
  onSteer
}: UseAgentComposerRuntimeInput): AgentComposerRuntime => {
  const containerRef = useRef<HTMLDivElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const previousValueRef = useRef(initialValue);
  const previousExternalDraftRef = useRef({
    currentThreadId,
    initialValue
  });
  const lastAppendRequestIdRef = useRef<number | null>(null);
  const textEffectIdRef = useRef(0);
  const textEffectTimeoutsRef = useRef<number[]>([]);
  const composingRef = useRef(false);
  const [draftValue, setDraftValue] = useState(initialValue);
  const [inputFocused, setInputFocused] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [modelSubmenuOpen, setModelSubmenuOpen] = useState(false);
  const [caretRect, setCaretRect] = useState<ModernCaretRect | null>(null);
  const [caretActivityVersion, setCaretActivityVersion] = useState(0);
  const [textEffects, setTextEffects] = useState<readonly ComposerTextEffect[]>([]);
  const hasContent = draftValue.trim().length > 0;

  const markCaretActivity = useCallback((): void => {
    setCaretActivityVersion((current) => current + 1);
  }, []);

  const {
    pressed: isCaretPressed,
    pressKey: pressCaretKey,
    releaseKey: releaseCaretKey,
    resetPressed: resetCaretPressed
  } = useCaretPressState({
    enabled: inputFocused,
    onActivity: markCaretActivity
  });
  const {
    motionToken: caretMotionToken,
    isIdle: isCaretIdle,
    motionTrail: caretMotionTrail
  } = useCaretMotionState(caretRect, {
    enabled: inputFocused,
    activityKey: caretActivityVersion,
    suppressMotion: isCaretPressed
  });

  const smartResize = useCallback((): void => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }
    input.style.height = "auto";
    const nextHeight = Math.max(
      AGENT_COMPOSER_MIN_HEIGHT,
      Math.min(input.scrollHeight, AGENT_COMPOSER_MAX_HEIGHT)
    );
    input.style.height = `${String(nextHeight)}px`;
    input.style.overflowY = input.scrollHeight > AGENT_COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }, []);

  const syncCaret = useCallback((): void => {
    const input = inputRef.current;
    if (input === null || inputDisabled || input.ownerDocument.activeElement !== input) {
      setCaretRect(null);
      return;
    }
    setCaretRect(measureTextAreaCaretRect(input));
  }, [inputDisabled]);

  const pushTextEffects = useCallback((nextEffects: readonly ComposerTextEffectDraft[]): void => {
    if (nextEffects.length === 0) {
      return;
    }

    const createdEffects = nextEffects.map((effect) => ({
      ...effect,
      id: textEffectIdRef.current++
    }));
    setTextEffects((current) => [...current, ...createdEffects]);
    for (const effect of createdEffects) {
      const timeoutId = window.setTimeout(() => {
        setTextEffects((current) => current.filter((entry) => entry.id !== effect.id));
        textEffectTimeoutsRef.current = textEffectTimeoutsRef.current.filter((entry) => entry !== timeoutId);
      }, AGENT_COMPOSER_TEXT_EFFECT_LIFETIME_MS);
      textEffectTimeoutsRef.current.push(timeoutId);
    }
  }, []);

  useEffect(() => {
    smartResize();
  }, [draftValue, smartResize]);

  useLayoutEffect(() => {
    const previousExternalDraft = previousExternalDraftRef.current;
    if (
      previousExternalDraft.currentThreadId === currentThreadId &&
      previousExternalDraft.initialValue === initialValue
    ) {
      return;
    }

    previousExternalDraftRef.current = {
      currentThreadId,
      initialValue
    };
    previousValueRef.current = initialValue;
    for (const timeoutId of textEffectTimeoutsRef.current) {
      window.clearTimeout(timeoutId);
    }
    textEffectTimeoutsRef.current = [];
    setTextEffects([]);
    setDraftValue(initialValue);
    markCaretActivity();
  }, [currentThreadId, initialValue, markCaretActivity]);

  useLayoutEffect(() => {
    if (appendRequest === null || lastAppendRequestIdRef.current === appendRequest.id) {
      return;
    }
    const text = appendRequest.text.trim();
    lastAppendRequestIdRef.current = appendRequest.id;
    if (text.length === 0) {
      return;
    }
    setDraftValue((current) => (
      current.trim().length === 0
        ? text
        : `${current.trimEnd()}\n\n${text}`
    ));
    markCaretActivity();
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      smartResize();
      syncCaret();
    });
  }, [appendRequest, markCaretActivity, smartResize, syncCaret]);

  useLayoutEffect(() => {
    const previousValue = previousValueRef.current;
    const input = inputRef.current;
    if (
      previousValue !== draftValue &&
      input !== null &&
      input.ownerDocument.activeElement === input &&
      composingRef.current === false
    ) {
      const diff = diffComposerText(previousValue, draftValue);
      const nextEffects: ComposerTextEffectDraft[] = [];
      if (diff.removed.length > 0) {
        nextEffects.push(
          ...measureTextAreaTextRects(
            input,
            previousValue,
            diff.start,
            diff.start + diff.removed.length,
            AGENT_COMPOSER_MAX_TEXT_EFFECT_SEGMENTS
          ).map((entry) => ({
            kind: "delete" as const,
            text: entry.text,
            left: entry.left,
            top: entry.top
          }))
        );
      }
      if (diff.inserted.length > 0) {
        nextEffects.push(
          ...measureTextAreaTextRects(
            input,
            draftValue,
            diff.start,
            diff.start + diff.inserted.length,
            AGENT_COMPOSER_MAX_TEXT_EFFECT_SEGMENTS
          ).map((entry) => ({
            kind: "insert" as const,
            text: entry.text,
            left: entry.left,
            top: entry.top
          }))
        );
      }
      pushTextEffects(nextEffects);
    }

    previousValueRef.current = draftValue;
    syncCaret();
  }, [draftValue, pushTextEffects, syncCaret]);

  useEffect(() => {
    if (!inputFocused) {
      return;
    }

    const ownerDocument = inputRef.current?.ownerDocument ?? document;
    const handleSelectionChange = (): void => {
      if (ownerDocument.activeElement === inputRef.current) {
        markCaretActivity();
        syncCaret();
      }
    };

    ownerDocument.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      ownerDocument.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [inputFocused, markCaretActivity, syncCaret]);

  const submit = useCallback(async (
    action: AgentComposerSubmitAction
  ): Promise<void> => {
    const text = draftValue.trim();
    if (text.length === 0) {
      return;
    }
    setDraftValue("");
    previousValueRef.current = "";
    markCaretActivity();
    try {
      if (action === "steer") {
        await onSteer?.(text);
        return;
      }
      await onSend(text);
    } catch {
      setDraftValue(text);
      previousValueRef.current = text;
      markCaretActivity();
    }
  }, [draftValue, markCaretActivity, onSend, onSteer]);

  useEffect(() => {
    if (onHeightChange === undefined) {
      return;
    }
    const node = containerRef.current;
    if (node === null) {
      return;
    }

    const reportHeight = (): void => {
      onHeightChange(node.offsetHeight);
    };
    reportHeight();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      reportHeight();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [onHeightChange]);

  const closeMenus = useCallback((): void => {
    setToolsMenuOpen(false);
    setModelSubmenuOpen(false);
  }, []);

  useEffect(() => {
    if (!toolsMenuOpen) {
      return;
    }
    const ownerDocument = toolsMenuRef.current?.ownerDocument ?? document;
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && toolsMenuRef.current?.contains(target)) {
        return;
      }
      closeMenus();
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeMenus();
      }
    };
    ownerDocument.addEventListener("pointerdown", handlePointerDown);
    ownerDocument.addEventListener("keydown", handleKeyDown);
    return () => {
      ownerDocument.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeMenus, toolsMenuOpen]);

  useEffect(() => {
    return () => {
      for (const timeoutId of textEffectTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      textEffectTimeoutsRef.current = [];
    };
  }, []);

  const toggleToolsMenu = useCallback((): void => {
    setToolsMenuOpen((current) => !current);
    setModelSubmenuOpen(false);
  }, []);

  const toggleModelSubmenu = useCallback((): void => {
    setModelSubmenuOpen((current) => !current);
  }, []);

  const selectModel = useCallback((
    value: string,
    onModelSelect: ((modelName: string) => void) | undefined
  ): void => {
    onModelSelect?.(value);
    closeMenus();
  }, [closeMenus]);

  const onTextareaCompositionStart = useCallback((): void => {
    composingRef.current = true;
    markCaretActivity();
  }, [markCaretActivity]);

  const onTextareaCompositionEnd = useCallback((): void => {
    composingRef.current = false;
    markCaretActivity();
  }, [markCaretActivity]);

  const onTextareaFocus = useCallback((): void => {
    setInputFocused(true);
    markCaretActivity();
    syncCaret();
  }, [markCaretActivity, syncCaret]);

  const onTextareaBlur = useCallback((): void => {
    resetCaretPressed();
    setInputFocused(false);
    setCaretRect(null);
  }, [resetCaretPressed]);

  const onTextareaScroll = useCallback((): void => {
    markCaretActivity();
    syncCaret();
  }, [markCaretActivity, syncCaret]);

  const onTextareaInput = useCallback((): void => {
    smartResize();
    markCaretActivity();
    window.requestAnimationFrame(() => {
      syncCaret();
    });
  }, [markCaretActivity, smartResize, syncCaret]);

  const onTextareaKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    pressCaretKey(event.key, event.repeat);
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!sendDisabled && !sending && hasContent) {
        void submit("send");
      }
    }
  }, [hasContent, pressCaretKey, sendDisabled, sending, submit]);

  const onTextareaKeyUp = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    releaseCaretKey(event.key);
  }, [releaseCaretKey]);

  return {
    containerRef,
    toolsMenuRef,
    inputRef,
    draftValue,
    hasContent,
    inputFocused,
    toolsMenuOpen,
    modelSubmenuOpen,
    caretRect,
    isCaretIdle,
    isCaretPressed,
    caretMotionToken,
    caretMotionTrail,
    textEffects,
    setDraftValue,
    submit,
    toggleToolsMenu,
    toggleModelSubmenu,
    closeMenus,
    selectModel,
    onTextareaCompositionStart,
    onTextareaCompositionEnd,
    onTextareaFocus,
    onTextareaBlur,
    onTextareaScroll,
    onTextareaInput,
    onTextareaKeyDown,
    onTextareaKeyUp
  };
};
