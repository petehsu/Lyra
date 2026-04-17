import { ArrowRight, FolderOpen, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createTranslator, type WorkbenchLocale } from "../i18n";

type AgentComposerProps = {
  readonly locale?: WorkbenchLocale;
  readonly modelLabel?: string;
  readonly modelNames?: readonly string[];
  readonly value: string;
  readonly ariaLabel: string;
  readonly placeholder: string;
  readonly sendLabel: string;
  readonly inputDisabled: boolean;
  readonly sendDisabled: boolean;
  readonly sending: boolean;
  readonly surfaceDimmed?: boolean;
  readonly bindProjectLabel?: string;
  readonly boundProjectName?: string | null;
  readonly planModeEnabled?: boolean;
  readonly planModeLocked?: boolean;
  readonly planModeLabel?: string;
  readonly onPlanModeToggle?: () => void;
  readonly bindDisabled?: boolean;
  readonly bindPending?: boolean;
  readonly onBindProject?: () => void;
  readonly onHeightChange?: (height: number) => void;
  readonly onValueChange: (value: string) => void;
  readonly onSend: () => void;
};

const MIN_HEIGHT = 44;
const MAX_HEIGHT = 184;

export const AgentComposer = ({
  locale = "en-US",
  modelLabel,
  modelNames = [],
  value,
  ariaLabel,
  placeholder,
  sendLabel,
  inputDisabled,
  sendDisabled,
  sending,
  surfaceDimmed = false,
  bindProjectLabel,
  boundProjectName,
  planModeEnabled = false,
  planModeLocked = false,
  planModeLabel,
  onPlanModeToggle,
  bindDisabled = false,
  bindPending = false,
  onBindProject,
  onHeightChange,
  onValueChange,
  onSend
}: AgentComposerProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasContent = value.trim().length > 0;
  const sendVisualState = sending
    ? "sending"
    : !sendDisabled && hasContent
      ? "ready"
      : "idle";
  const resolvedBindProjectLabel =
    bindProjectLabel !== undefined && bindProjectLabel.trim().length > 0
      ? bindProjectLabel
      : t("ai.bindProjectLabel");
  const resolvedPlanModeLabel =
    planModeLabel !== undefined && planModeLabel.trim().length > 0
      ? planModeLabel
      : t("ai.planMode");
  const resolvedModelNames = modelNames
    .map((entry) => entry.trim())
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);

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

  useEffect(() => {
    smartResize();
  }, [smartResize, value]);

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

  return (
    <div
      ref={containerRef}
      className={
        surfaceDimmed && !sending
          ? "lyra-ai-agent-composer lyra-ai-agent-composer-disabled"
          : "lyra-ai-agent-composer"
      }
    >
      {resolvedModelNames.length > 0 ? (
        <div className="lyra-ai-agent-composer-models">
          {modelLabel ? (
            <span className="lyra-ai-agent-composer-models-label">{modelLabel}</span>
          ) : null}
          <div className="lyra-ai-agent-composer-model-list">
            {resolvedModelNames.map((entry) => (
              <span key={entry} className="lyra-ai-agent-composer-model-chip">
                {entry}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <textarea
        ref={inputRef}
        className="lyra-ai-agent-composer-input"
        value={value}
        aria-label={ariaLabel}
        disabled={inputDisabled}
        placeholder={placeholder}
        onInput={() => {
          smartResize();
        }}
        onChange={(event) => {
          onValueChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!sendDisabled && !sending) {
              onSend();
            }
          }
        }}
      />
      <div className="lyra-ai-agent-composer-toolbar">
        <button
          type="button"
          role="switch"
          aria-checked={planModeEnabled}
          className={
            planModeEnabled
              ? (
                  planModeLocked
                    ? "lyra-ai-agent-plan-toggle lyra-ai-agent-plan-toggle-active lyra-ai-agent-plan-toggle-locked"
                    : "lyra-ai-agent-plan-toggle lyra-ai-agent-plan-toggle-active"
                )
              : "lyra-ai-agent-plan-toggle"
          }
          disabled={onPlanModeToggle === undefined || planModeLocked}
          aria-label={resolvedPlanModeLabel}
          title={resolvedPlanModeLabel}
          onClick={() => {
            onPlanModeToggle?.();
          }}
        >
          <span className="lyra-ai-agent-plan-toggle-track">
            <span className="lyra-ai-agent-plan-toggle-thumb" />
          </span>
          <span className="lyra-ai-agent-plan-toggle-copy">
            <span className="lyra-ai-agent-plan-pill">{t("ai.planLabel")}</span>
          </span>
        </button>
        <button
          type="button"
          className={
            boundProjectName === undefined || boundProjectName === null
              ? (
                  bindPending
                    ? "lyra-ai-agent-bind-project lyra-ai-agent-bind-project-pending"
                    : "lyra-ai-agent-bind-project"
                )
              : (
                  bindPending
                    ? "lyra-ai-agent-bind-project lyra-ai-agent-bind-project-active lyra-ai-agent-bind-project-pending"
                    : "lyra-ai-agent-bind-project lyra-ai-agent-bind-project-active"
                )
          }
          disabled={bindDisabled || onBindProject === undefined}
          aria-label={resolvedBindProjectLabel}
          title={resolvedBindProjectLabel}
          onClick={() => {
            if (bindDisabled || onBindProject === undefined) {
              return;
            }
            onBindProject();
          }}
        >
          <FolderOpen size={12} />
          {boundProjectName === undefined || boundProjectName === null ? null : (
            <span className="lyra-ai-agent-bind-project-name">{boundProjectName}</span>
          )}
        </button>
        <button
          type="button"
          className={`lyra-ai-agent-send lyra-ai-agent-send-${sendVisualState}`}
          disabled={sendDisabled && !sending}
          aria-label={sendLabel}
          title={sendLabel}
          onClick={() => {
            if (sendDisabled || sending) {
              return;
            }
            onSend();
          }}
        >
          {sending ? (
            <Square className="lyra-ai-agent-send-icon" size={10} />
          ) : (
            <ArrowRight className="lyra-ai-agent-send-icon" size={13} />
          )}
        </button>
      </div>
    </div>
  );
};
