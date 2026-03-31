import { ArrowRight, Pause } from "lucide-react";
import {
  forwardRef,
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState
} from "react";

import {
  hasFileManagerEntryDragPayload,
  readFileManagerEntryDragPayload,
  type FileManagerEntryDragPayload
} from "../file-manager/drag-transfer";
import { measureAiHotzone } from "../ai-panel/hotzone-profile";
import { aiTextLayoutService } from "../ai-panel/text-layout";
import { renderFileManagerEntryIconByKind } from "../file-manager/icon-registry";
import { LyraListPicker } from "../list-picker";
import {
  clearComposerEditorContent,
  insertFileChipAtComposerEditor,
  readComposerEditorSubmission
} from "./composer-editor";
import { SidebarChangeApprovalPanel } from "./change-approval-panel";
import { SidebarQuestionPanel } from "./question-panel";
import {
  SIDEBAR_FILE_CHIP_ICON_DEFS_ATTRIBUTE,
  SIDEBAR_FILE_CHIP_ICON_KIND_ATTRIBUTE,
  SIDEBAR_FILE_CHIP_ICON_KINDS
} from "./file-chip-icon-kind";
import type {
  SidebarChangeApprovalLabels,
  SidebarComposerMode,
  SidebarComposerModeOption,
  SidebarComposerProps
} from "./types";

const DEFAULT_MODE_OPTIONS: readonly SidebarComposerModeOption[] = [
  { id: "chat", label: "Chat" },
  { id: "agent", label: "Agent", disabled: true },
  { id: "oma", label: "Oma", disabled: true }
] as const;

const DEFAULT_CHANGE_APPROVAL_LABELS: SidebarChangeApprovalLabels = {
  tabQuestion: "Question",
  tabChange: "Changes",
  viewPending: "Pending",
  viewAll: "All Changes",
  filesUnit: "files",
  acceptAll: "Accept all changes",
  openFile: "Open changed file",
  emptyPending: "No pending changes to approve.",
  emptyAll: "No file changes yet."
};

const MIN_INPUT_HEIGHT_PX = 88;
const MAX_INPUT_HEIGHT_RATIO = 1 / 3;
const COMPOSER_LINE_HEIGHT_FALLBACK_RATIO = 1.45;

const parseCssPx = (value: string | null): number => {
  if (value === null || value.length === 0) {
    return 0;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const resolveComposerFont = (style: CSSStyleDeclaration): string => {
  if (style.font.length > 0) {
    return style.font;
  }
  const fontStyle = style.fontStyle || "normal";
  const fontVariant = style.fontVariant || "normal";
  const fontWeight = style.fontWeight || "400";
  const fontSize = style.fontSize || "12px";
  const fontFamily = style.fontFamily || "system-ui";
  return `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} / ${style.lineHeight || "normal"} ${fontFamily}`;
};

const resolveComposerLineHeightPx = (style: CSSStyleDeclaration): number => {
  const parsed = parseCssPx(style.lineHeight);
  if (parsed > 0) {
    return parsed;
  }
  const fontSize = parseCssPx(style.fontSize);
  if (fontSize > 0) {
    return fontSize * COMPOSER_LINE_HEIGHT_FALLBACK_RATIO;
  }
  return MIN_INPUT_HEIGHT_PX / 4;
};

const resolveComposerLayoutText = (input: HTMLElement): string => {
  const submission = readComposerEditorSubmission(input);
  if (submission.tokens.length === 0) {
    return "";
  }
  return submission.tokens
    .map((token) => (token.kind === "file" ? `[${token.name}]` : token.value))
    .join("");
};

const resolveLayoutHeight = (input: HTMLElement): number => {
  const layoutHost = input.closest<HTMLElement>(".lyra-ai-panel-surface");
  if (layoutHost !== null) {
    return layoutHost.clientHeight;
  }
  const fallbackHost = input.closest<HTMLElement>(".lyra-ai-panel-chat");
  if (fallbackHost !== null) {
    return fallbackHost.clientHeight;
  }
  return window.innerHeight;
};

export type SidebarComposerHandle = {
  readonly focus: () => void;
  readonly insertFileEntry: (
    entry: FileManagerEntryDragPayload,
    anchorPoint?: { readonly x: number; readonly y: number }
  ) => void;
};

export const SidebarComposer = forwardRef<SidebarComposerHandle, SidebarComposerProps>(({
  ariaLabel,
  placeholder,
  sendLabel,
  pauseLabel,
  questionPanel,
  changeApprovalPanel,
  changeApprovalLabels,
  upperPanelTab,
  questionNavigateUpLabel = "Previous question",
  questionNavigateDownLabel = "Next question",
  questionCloseLabel = "Close question panel",
  questionCustomPlaceholder = "Type your own answer",
  questionSubmitCustomLabel = "Submit custom answer",
  quotedMessage,
  modeOptions,
  defaultMode = "chat",
  isResponding = false,
  onQuestionNavigateUp,
  onQuestionNavigateDown,
  onQuestionClose,
  onQuestionSelectOption,
  onQuestionCustomDraftChange,
  onQuestionSubmitCustom,
  onUpperPanelTabChange,
  onChangeApprovalViewChange,
  onAcceptAllChanges,
  onOpenChangedFile,
  onModeChange,
  onRequestPause,
  onSend,
  onSendPayload
}, forwardedRef) => {
  const [mode, setMode] = useState<SidebarComposerMode>(defaultMode);
  const [inputRevision, setInputRevision] = useState(0);
  const [canSubmit, setCanSubmit] = useState(false);
  const [maxInputHeightPx, setMaxInputHeightPx] = useState(MIN_INPUT_HEIGHT_PX);
  const [activeUpperPanelTab, setActiveUpperPanelTab] = useState<"question" | "change">(
    upperPanelTab
      ?? (questionPanel !== undefined
        ? "question"
        : "change")
  );
  const inputRef = useRef<HTMLDivElement | null>(null);

  const resolvedModeOptions = modeOptions ?? DEFAULT_MODE_OPTIONS;
  const resolvedChangeApprovalLabels = changeApprovalLabels ?? DEFAULT_CHANGE_APPROVAL_LABELS;
  const modePickerOptions = resolvedModeOptions.map((option) => (
    option.disabled
      ? {
          value: option.id,
          label: option.label,
          disabled: true
        }
      : {
          value: option.id,
          label: option.label
        }
  ));
  const hasQuestionPanel = questionPanel !== undefined;
  const hasChangeApprovalPanel = changeApprovalPanel !== undefined;
  const hasUpperPanel = hasQuestionPanel || hasChangeApprovalPanel;
  const canSwitchUpperPanelTab = hasQuestionPanel && hasChangeApprovalPanel;
  const hadBothUpperPanelsRef = useRef(canSwitchUpperPanelTab);

  useEffect(() => {
    if (upperPanelTab !== undefined) {
      setActiveUpperPanelTab(upperPanelTab);
      hadBothUpperPanelsRef.current = canSwitchUpperPanelTab;
      return;
    }

    if (canSwitchUpperPanelTab) {
      setActiveUpperPanelTab((current) =>
        hadBothUpperPanelsRef.current
          ? current
          : "question"
      );
      hadBothUpperPanelsRef.current = true;
      return;
    }

    if (hasQuestionPanel) {
      setActiveUpperPanelTab("question");
      hadBothUpperPanelsRef.current = false;
      return;
    }

    if (hasChangeApprovalPanel) {
      setActiveUpperPanelTab("change");
      hadBothUpperPanelsRef.current = false;
    }
  }, [canSwitchUpperPanelTab, hasChangeApprovalPanel, hasQuestionPanel, upperPanelTab]);

  const selectMode = (nextMode: SidebarComposerMode): void => {
    if (resolvedModeOptions.some((option) => option.id === nextMode && option.disabled)) {
      return;
    }
    setMode(nextMode);
    onModeChange?.(nextMode);
  };
  const normalizedQuotedMessage = quotedMessage?.replace(/\s+/g, " ").trim() ?? "";

  const syncSubmitAvailability = useCallback((): void => {
    const input = inputRef.current;
    if (input === null) {
      setCanSubmit(false);
      return;
    }
    const submission = readComposerEditorSubmission(input);
    setCanSubmit(submission.text.trim().length > 0);
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }

    const updateMaxHeight = (): void => {
      const layoutHeight = resolveLayoutHeight(input);
      const nextMaxHeight = Math.max(
        MIN_INPUT_HEIGHT_PX,
        Math.floor(layoutHeight * MAX_INPUT_HEIGHT_RATIO)
      );
      setMaxInputHeightPx((current) =>
        current === nextMaxHeight ? current : nextMaxHeight
      );
    };

    updateMaxHeight();
    const layoutHost = input.closest<HTMLElement>(".lyra-ai-panel-surface");
    const resizeObserver = layoutHost === null ? null : new ResizeObserver(updateMaxHeight);
    if (layoutHost !== null) {
      resizeObserver?.observe(layoutHost);
    }
    window.addEventListener("resize", updateMaxHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateMaxHeight);
    };
  }, []);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }

    measureAiHotzone("input-composer", () => {
      const style = window.getComputedStyle(input);
      const paddingTopPx = parseCssPx(style.paddingTop);
      const paddingBottomPx = parseCssPx(style.paddingBottom);
      const paddingLeftPx = parseCssPx(style.paddingLeft);
      const paddingRightPx = parseCssPx(style.paddingRight);
      const contentWidthPx = Math.max(1, input.clientWidth - paddingLeftPx - paddingRightPx);
      const text = resolveComposerLayoutText(input);
      const lineHeightPx = resolveComposerLineHeightPx(style);
      const measured = aiTextLayoutService.measureParagraph({
        text,
        font: resolveComposerFont(style),
        lineHeightPx,
        maxWidthPx: contentWidthPx,
        whiteSpace: "pre-wrap"
      });
      const measuredContentHeightPx = text.length === 0
        ? 0
        : Math.ceil(measured.heightPx);
      const measuredTotalHeightPx = Math.max(
        MIN_INPUT_HEIGHT_PX,
        Math.ceil(measuredContentHeightPx + paddingTopPx + paddingBottomPx)
      );
      const nextHeight = Math.max(
        MIN_INPUT_HEIGHT_PX,
        Math.min(measuredTotalHeightPx, maxInputHeightPx)
      );
      input.style.height = `${nextHeight}px`;
      input.style.overflowY = measuredTotalHeightPx > maxInputHeightPx ? "auto" : "hidden";
    });
  }, [inputRevision, maxInputHeightPx]);

  const insertFileEntry = useCallback((
    droppedEntry: FileManagerEntryDragPayload,
    anchorPoint?: { readonly x: number; readonly y: number }
  ): void => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }

    input.focus();
    insertFileChipAtComposerEditor(input, droppedEntry, anchorPoint);
    setInputRevision((current) => current + 1);
    syncSubmitAvailability();
  }, [syncSubmitAvailability]);

  useImperativeHandle(forwardedRef, () => ({
    focus: () => {
      inputRef.current?.focus();
    },
    insertFileEntry
  }), [insertFileEntry]);

  const submit = (): void => {
    if (isResponding) {
      onRequestPause?.();
      return;
    }

    const input = inputRef.current;
    if (input === null) {
      return;
    }

    const submission = readComposerEditorSubmission(input);
    if (submission.text.length === 0) {
      return;
    }

    onSendPayload?.(submission, mode);
    onSend?.(submission.text, mode);
    clearComposerEditorContent(input);
    setInputRevision((current) => current + 1);
    setCanSubmit(false);
  };

  const sendState = isResponding
    ? "busy"
    : canSubmit
      ? "ready"
      : "idle";

  const onInputDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (hasFileManagerEntryDragPayload(event.dataTransfer) === false) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onInputDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const droppedEntry = readFileManagerEntryDragPayload(event.dataTransfer);
    if (droppedEntry === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    insertFileEntry(droppedEntry, {
      x: event.clientX,
      y: event.clientY
    });
  };

  return (
    <div className="lyra-sidebar-composer-shell">
      <div
        className="lyra-sidebar-composer-file-chip-icon-defs"
        aria-hidden="true"
        {...{ [SIDEBAR_FILE_CHIP_ICON_DEFS_ATTRIBUTE]: "true" }}
      >
        {SIDEBAR_FILE_CHIP_ICON_KINDS.map((iconKind) => (
          <span
            key={iconKind}
            {...{ [SIDEBAR_FILE_CHIP_ICON_KIND_ATTRIBUTE]: iconKind }}
          >
            {renderFileManagerEntryIconByKind(iconKind, {
              className: "lyra-sidebar-composer-file-chip-icon-glyph",
              size: 13
            })}
          </span>
        ))}
      </div>
      <div className="lyra-sidebar-composer-spacer" aria-hidden="true" />
      {normalizedQuotedMessage.length > 0 ? (
        <div className="lyra-sidebar-composer-quote" aria-label="composer-quoted-message">
          <span className="lyra-sidebar-composer-quote-content">{normalizedQuotedMessage}</span>
        </div>
      ) : null}
      {hasUpperPanel ? (
        <section className="lyra-sidebar-upper-panel" aria-label="sidebar-upper-panel">
          {canSwitchUpperPanelTab ? (
            <div className="lyra-sidebar-upper-panel-tabs" role="tablist" aria-label="sidebar-upper-panel-tabs">
              <button
                type="button"
                className={
                  activeUpperPanelTab === "question"
                    ? "lyra-sidebar-upper-panel-tab lyra-sidebar-upper-panel-tab-active"
                    : "lyra-sidebar-upper-panel-tab"
                }
                onClick={() => {
                  setActiveUpperPanelTab("question");
                  onUpperPanelTabChange?.("question");
                }}
              >
                {resolvedChangeApprovalLabels.tabQuestion}
              </button>
              <button
                type="button"
                className={
                  activeUpperPanelTab === "change"
                    ? "lyra-sidebar-upper-panel-tab lyra-sidebar-upper-panel-tab-active"
                    : "lyra-sidebar-upper-panel-tab"
                }
                onClick={() => {
                  setActiveUpperPanelTab("change");
                  onUpperPanelTabChange?.("change");
                }}
              >
                {resolvedChangeApprovalLabels.tabChange}
              </button>
            </div>
          ) : null}
          {activeUpperPanelTab === "question" && questionPanel !== undefined ? (
            <SidebarQuestionPanel
              panel={questionPanel}
              navigateUpLabel={questionNavigateUpLabel}
              navigateDownLabel={questionNavigateDownLabel}
              closeLabel={questionCloseLabel}
              customPlaceholder={questionCustomPlaceholder}
              submitCustomLabel={questionSubmitCustomLabel}
              {...(onQuestionNavigateUp === undefined ? {} : { onNavigateUp: onQuestionNavigateUp })}
              {...(onQuestionNavigateDown === undefined ? {} : { onNavigateDown: onQuestionNavigateDown })}
              {...(onQuestionClose === undefined ? {} : { onClose: onQuestionClose })}
              {...(onQuestionSelectOption === undefined ? {} : { onSelectOption: onQuestionSelectOption })}
              {...(
                onQuestionCustomDraftChange === undefined
                  ? {}
                  : { onCustomDraftChange: onQuestionCustomDraftChange }
              )}
              {...(onQuestionSubmitCustom === undefined ? {} : { onSubmitCustom: onQuestionSubmitCustom })}
            />
          ) : null}
          {activeUpperPanelTab === "change" && changeApprovalPanel !== undefined ? (
            <SidebarChangeApprovalPanel
              panel={changeApprovalPanel}
              labels={resolvedChangeApprovalLabels}
              {...(
                onAcceptAllChanges === undefined
                  ? {}
                  : { onAcceptAll: onAcceptAllChanges }
              )}
              {...(
                onOpenChangedFile === undefined
                  ? {}
                  : { onOpenChangedFile }
              )}
            />
          ) : null}
        </section>
      ) : null}
      <section
        className={
          hasUpperPanel
            ? "lyra-sidebar-composer lyra-sidebar-composer-with-upper-panel"
            : "lyra-sidebar-composer"
        }
        aria-label={ariaLabel}
      >
        <div
          ref={inputRef}
          className="lyra-sidebar-composer-input"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-label={placeholder}
          aria-multiline="true"
          data-placeholder={placeholder}
          onInput={() => {
            setInputRevision((current) => current + 1);
            syncSubmitAvailability();
          }}
          onDragOver={onInputDragOver}
          onDrop={onInputDrop}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="lyra-sidebar-composer-toolbar" role="toolbar" aria-label="composer-toolbar">
          <LyraListPicker
            className="lyra-sidebar-composer-mode-list"
            ariaLabel="composer-mode-list"
            listAriaLabel="composer-mode-options"
            value={mode}
            options={modePickerOptions}
            variant="compact"
            shape="pill"
            onChange={selectMode}
          />
          <button
            type="button"
            className={`lyra-sidebar-composer-send lyra-sidebar-composer-send-state-${sendState}`}
            aria-label={isResponding ? (pauseLabel ?? sendLabel) : sendLabel}
            disabled={isResponding === false && canSubmit === false}
            onClick={submit}
          >
            {isResponding ? (
              <Pause size={13} />
            ) : (
              <ArrowRight
                size={13}
                className="lyra-sidebar-composer-send-icon"
                aria-hidden="true"
              />
            )}
          </button>
        </div>
      </section>
    </div>
  );
});

SidebarComposer.displayName = "SidebarComposer";
