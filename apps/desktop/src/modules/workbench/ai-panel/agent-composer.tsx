import { ArrowRight, Check, ChevronRight, Plus, Square } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import {
  ModernCaretOverlay,
  measureTextAreaCaretRect,
  measureTextAreaTextRects,
  useCaretPressState,
  useCaretMotionState
} from "../caret/modern-caret";
import { createTranslator, type WorkbenchLocale } from "../i18n";

export type AgentComposerModelOption = {
  readonly value: string;
  readonly label: string;
};

export type AgentPermissionMode = "default" | "auto_review" | "full_access";

type AgentComposerProps = {
  readonly locale?: WorkbenchLocale;
  readonly currentThreadId?: string | null;
  readonly modelNames?: readonly string[];
  readonly modelOptions?: readonly AgentComposerModelOption[];
  readonly selectedModelName?: string | null;
  readonly modelAriaLabel?: string;
  readonly modelSwitchDisabled?: boolean;
  readonly onModelSelect?: (modelName: string) => void;
  readonly initialValue?: string;
  readonly appendRequest?: {
    readonly id: number;
    readonly text: string;
  } | null;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly sendLabel: string;
  readonly inputDisabled: boolean;
  readonly sendDisabled: boolean;
  readonly sending: boolean;
  readonly surfaceDimmed?: boolean;
  readonly planModeEnabled?: boolean;
  readonly planModeLocked?: boolean;
  readonly planModeLabel?: string;
  readonly onPlanModeToggle?: () => void;
  readonly permissionMode?: AgentPermissionMode;
  readonly permissionModeDisabled?: boolean;
  readonly onPermissionModeSelect?: (mode: AgentPermissionMode) => void;
  readonly onHeightChange?: (height: number) => void;
  readonly onSend: (value: string) => void | Promise<void>;
  readonly onSteer?: (value: string) => void | Promise<void>;
  readonly steerLabel?: string;
  readonly steerDisabled?: boolean;
  readonly onStop?: () => void;
  readonly stopDisabled?: boolean;
};

const MIN_HEIGHT = 44;
const MAX_HEIGHT = 184;
const MAX_TEXT_EFFECT_SEGMENTS = 10;
const TEXT_EFFECT_LIFETIME_MS = 260;

type ComposerTextEffect = {
  readonly id: number;
  readonly kind: "insert" | "delete";
  readonly text: string;
  readonly left: number;
  readonly top: number;
};

const diffText = (
  previousValue: string,
  nextValue: string
): {
  readonly start: number;
  readonly removed: string;
  readonly inserted: string;
} => {
  let start = 0;
  while (
    start < previousValue.length &&
    start < nextValue.length &&
    previousValue[start] === nextValue[start]
  ) {
    start += 1;
  }

  let previousEnd = previousValue.length;
  let nextEnd = nextValue.length;
  while (
    previousEnd > start &&
    nextEnd > start &&
    previousValue[previousEnd - 1] === nextValue[nextEnd - 1]
  ) {
    previousEnd -= 1;
    nextEnd -= 1;
  }

  return {
    start,
    removed: previousValue.slice(start, previousEnd),
    inserted: nextValue.slice(start, nextEnd)
  };
};

export const AgentComposer = memo(({
  locale = "en-US",
  currentThreadId = null,
  modelNames = [],
  modelOptions,
  selectedModelName,
  modelAriaLabel,
  modelSwitchDisabled = false,
  onModelSelect,
  initialValue = "",
  appendRequest = null,
  ariaLabel,
  placeholder,
  sendLabel,
  inputDisabled,
  sendDisabled,
  sending,
  surfaceDimmed = false,
  planModeEnabled = false,
  planModeLocked = false,
  planModeLabel,
  onPlanModeToggle,
  permissionMode = "default",
  permissionModeDisabled = false,
  onPermissionModeSelect,
  onHeightChange,
  onSend,
  onSteer,
  steerLabel,
  steerDisabled = false,
  onStop,
  stopDisabled = false
}: AgentComposerProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
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
  const [caretRect, setCaretRect] = useState<ReturnType<typeof measureTextAreaCaretRect>>(null);
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
  const sendVisualState = sending
    ? "sending"
    : !sendDisabled && hasContent
      ? "ready"
      : "idle";
  const resolvedPlanModeLabel =
    planModeLabel !== undefined && planModeLabel.trim().length > 0
      ? planModeLabel
      : t("ai.planMode");
  const resolvedModelAriaLabel =
    modelAriaLabel !== undefined && modelAriaLabel.trim().length > 0
      ? modelAriaLabel
      : t("ai.modelLabel");
  const resolvedSteerLabel =
    steerLabel !== undefined && steerLabel.trim().length > 0
      ? steerLabel
      : t("ai.steerTurn");
  const resolvedModelOptions = (modelOptions ?? modelNames.map((entry) => ({ value: entry, label: entry })))
    .map((entry) => ({
      value: entry.value.trim(),
      label: entry.label.trim().length > 0 ? entry.label.trim() : entry.value.trim(),
    }))
    .filter((entry, index, entries) =>
      entry.value.length > 0 && entries.findIndex((candidate) => candidate.value === entry.value) === index
    );
  const resolvedSelectedModelName =
    selectedModelName !== undefined
      && selectedModelName !== null
      && resolvedModelOptions.some((option) => option.value === selectedModelName.trim())
      ? selectedModelName.trim()
      : (resolvedModelOptions[0]?.value ?? null);
  const canOpenModelMenu =
    resolvedModelOptions.length > 1 && !modelSwitchDisabled && onModelSelect !== undefined;
  const modelPickerOptions = resolvedModelOptions.map((entry) => ({
    value: entry.value,
    label: entry.label,
  }));
  const selectedModelLabel =
    resolvedModelOptions.find((option) => option.value === resolvedSelectedModelName)?.label
    ?? resolvedSelectedModelName
    ?? t("ai.modelLabel");
  const modelMenuStyle = useMemo(() => {
    const longestLabelLength = Math.max(
      0,
      ...modelPickerOptions.map((option) => option.label.length)
    );
    const safeCharacterWidth = Math.min(36, Math.max(12, longestLabelLength));
    return {
      "--lyra-ai-agent-model-menu-w": `clamp(var(--lyra-unit-160), calc(${String(safeCharacterWidth)}ch + var(--lyra-unit-52)), min(58cqw, var(--lyra-unit-320)))`,
    } as CSSProperties;
  }, [modelPickerOptions]);
  const permissionModeOptions = useMemo(
    () => [
      { value: "default" as const, label: t("ai.permissionModeDefault") },
      { value: "auto_review" as const, label: t("ai.permissionModeAutoReview") },
      { value: "full_access" as const, label: t("ai.permissionModeFullAccess") },
    ],
    [t]
  );

  // Adapted from OpenHands chat input auto-resize behavior.
  const smartResize = useCallback((): void => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }
    input.style.height = "auto";
    const nextHeight = Math.max(MIN_HEIGHT, Math.min(input.scrollHeight, MAX_HEIGHT));
    input.style.height = `${String(nextHeight)}px`;
    input.style.overflowY = input.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, []);

  const syncCaret = useCallback((): void => {
    const input = inputRef.current;
    if (input === null || inputDisabled || input.ownerDocument.activeElement !== input) {
      setCaretRect(null);
      return;
    }
    setCaretRect(measureTextAreaCaretRect(input));
  }, [inputDisabled]);

  const pushTextEffects = useCallback((nextEffects: readonly Omit<ComposerTextEffect, "id">[]): void => {
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
      }, TEXT_EFFECT_LIFETIME_MS);
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
      const diff = diffText(previousValue, draftValue);
      const nextEffects: Array<Omit<ComposerTextEffect, "id">> = [];
      if (diff.removed.length > 0) {
        nextEffects.push(
          ...measureTextAreaTextRects(
            input,
            previousValue,
            diff.start,
            diff.start + diff.removed.length,
            MAX_TEXT_EFFECT_SEGMENTS
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
            MAX_TEXT_EFFECT_SEGMENTS
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

  const handleSubmit = useCallback(async (
    action: "send" | "steer"
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
      setToolsMenuOpen(false);
      setModelSubmenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setToolsMenuOpen(false);
        setModelSubmenuOpen(false);
      }
    };
    ownerDocument.addEventListener("pointerdown", handlePointerDown);
    ownerDocument.addEventListener("keydown", handleKeyDown);
    return () => {
      ownerDocument.removeEventListener("pointerdown", handlePointerDown);
      ownerDocument.removeEventListener("keydown", handleKeyDown);
    };
  }, [toolsMenuOpen]);

  useEffect(() => {
    return () => {
      for (const timeoutId of textEffectTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }
      textEffectTimeoutsRef.current = [];
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={
        surfaceDimmed && !sending
          ? "lyra-ai-agent-composer lyra-ai-agent-composer-disabled"
          : "lyra-ai-agent-composer"
      }
    >
      <div className="lyra-ai-agent-composer-input-shell">
        <textarea
          ref={inputRef}
          className="lyra-ai-agent-composer-input"
          value={draftValue}
          aria-label={ariaLabel}
          disabled={inputDisabled}
          placeholder={placeholder}
          onCompositionStart={() => {
            composingRef.current = true;
            markCaretActivity();
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            markCaretActivity();
          }}
          onFocus={() => {
            setInputFocused(true);
            markCaretActivity();
            syncCaret();
          }}
          onBlur={() => {
            resetCaretPressed();
            setInputFocused(false);
            setCaretRect(null);
          }}
          onScroll={() => {
            markCaretActivity();
            syncCaret();
          }}
          onInput={() => {
            smartResize();
            markCaretActivity();
            window.requestAnimationFrame(() => {
              syncCaret();
            });
          }}
          onChange={(event) => {
            setDraftValue(event.target.value);
          }}
          onKeyDown={(event) => {
            pressCaretKey(event.key, event.repeat);
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!sendDisabled && !sending && hasContent) {
                void handleSubmit("send");
              }
            }
          }}
          onKeyUp={(event) => {
            releaseCaretKey(event.key);
          }}
        />
        <div className="lyra-ai-agent-composer-text-fx-layer">
          {textEffects.map((effect) => (
            <span
              key={effect.id}
              aria-hidden="true"
              className={`lyra-ai-agent-text-fx lyra-ai-agent-text-fx-${effect.kind}`}
              style={{
                left: `${String(effect.left)}px`,
                top: `${String(effect.top)}px`
              }}
            >
              {effect.text === " " ? "\u00a0" : effect.text}
            </span>
          ))}
        </div>
        <div className="lyra-modern-caret-layer lyra-ai-agent-composer-caret-layer">
          <ModernCaretOverlay
            rect={caretRect}
            focused={inputFocused}
            blinking={isCaretIdle && !isCaretPressed}
            pressed={isCaretPressed}
            motionToken={caretMotionToken}
            motionTrail={caretMotionTrail}
            className="lyra-modern-caret-composer"
          />
        </div>
      </div>
      <div className="lyra-ai-agent-composer-toolbar">
        <div className="lyra-ai-agent-composer-toolbar-leading">
          <div className="lyra-ai-agent-composer-tools" ref={toolsMenuRef}>
            <button
              type="button"
              className="lyra-ai-agent-composer-tools-trigger"
              aria-label={t("ai.composerMenuLabel")}
              title={t("ai.composerMenuLabel")}
              aria-haspopup="menu"
              aria-expanded={toolsMenuOpen}
              onClick={() => {
                setToolsMenuOpen((current) => !current);
                setModelSubmenuOpen(false);
              }}
            >
              <Plus size={15} aria-hidden="true" />
            </button>
            {toolsMenuOpen ? (
              <div className="lyra-ai-agent-composer-menu" role="menu">
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={planModeEnabled}
                  className={
                    planModeEnabled
                      ? "lyra-ai-agent-composer-menu-item lyra-ai-agent-composer-menu-item-active"
                      : "lyra-ai-agent-composer-menu-item"
                  }
                  disabled={onPlanModeToggle === undefined || planModeLocked}
                  onClick={() => {
                    onPlanModeToggle?.();
                  }}
                >
                  <span>{resolvedPlanModeLabel}</span>
                  {planModeEnabled ? <Check size={13} aria-hidden="true" /> : null}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={modelSubmenuOpen}
                  className="lyra-ai-agent-composer-menu-item lyra-ai-agent-composer-menu-item-nested"
                  disabled={!canOpenModelMenu}
                  onClick={() => {
                    setModelSubmenuOpen((current) => !current);
                  }}
                >
                  <span>{resolvedModelAriaLabel}</span>
                  <small>{selectedModelLabel}</small>
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
                {modelSubmenuOpen && canOpenModelMenu ? (
                  <div
                    className="lyra-ai-agent-composer-submenu"
                    role="menu"
                    style={modelMenuStyle}
                  >
                    {modelPickerOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={option.value === resolvedSelectedModelName}
                        className={
                          option.value === resolvedSelectedModelName
                            ? "lyra-ai-agent-composer-submenu-item lyra-ai-agent-composer-submenu-item-active"
                            : "lyra-ai-agent-composer-submenu-item"
                        }
                        onClick={() => {
                          onModelSelect?.(option.value);
                          setToolsMenuOpen(false);
                          setModelSubmenuOpen(false);
                        }}
                      >
                        <span>{option.label}</span>
                        {option.value === resolvedSelectedModelName ? <Check size={13} aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="lyra-ai-agent-permission-modes" aria-label={t("ai.permissionModeLabel")}>
            {permissionModeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={
                  permissionMode === option.value
                    ? "lyra-ai-agent-permission-mode lyra-ai-agent-permission-mode-active"
                    : "lyra-ai-agent-permission-mode"
                }
                disabled={permissionModeDisabled || onPermissionModeSelect === undefined}
                onClick={() => {
                  onPermissionModeSelect?.(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="lyra-ai-agent-composer-toolbar-trailing">
          {sending && hasContent && onSteer !== undefined ? (
            <button
              type="button"
              className="lyra-ai-agent-steer"
              disabled={steerDisabled}
              onClick={() => {
                if (!steerDisabled) {
                  void handleSubmit("steer");
                }
              }}
            >
              {resolvedSteerLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={`lyra-ai-agent-send lyra-ai-agent-send-${sendVisualState}`}
            disabled={sending ? stopDisabled : (sendDisabled || !hasContent)}
            aria-label={sendLabel}
            title={sendLabel}
            onClick={() => {
              if (sending) {
                if (!stopDisabled) {
                  onStop?.();
                }
                return;
              }
              if (sendDisabled || !hasContent) {
                return;
              }
              void handleSubmit("send");
            }}
          >
            {sending ? (
              <Square className="lyra-ai-agent-send-icon" size={12} />
            ) : (
              <ArrowRight className="lyra-ai-agent-send-icon" size={14} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
});

AgentComposer.displayName = "AgentComposer";
