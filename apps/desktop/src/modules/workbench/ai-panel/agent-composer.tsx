import { ArrowRight, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { createTranslator, type WorkbenchLocale } from "../i18n";
import { LyraListPicker } from "../list-picker";

type AgentComposerProps = {
  readonly locale?: WorkbenchLocale;
  readonly modelNames?: readonly string[];
  readonly selectedModelName?: string | null;
  readonly modelAriaLabel?: string;
  readonly modelSwitchDisabled?: boolean;
  readonly onModelSelect?: (modelName: string) => void;
  readonly value: string;
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
  readonly onHeightChange?: (height: number) => void;
  readonly onValueChange: (value: string) => void;
  readonly onSend: () => void;
};

const MIN_HEIGHT = 44;
const MAX_HEIGHT = 184;

export const AgentComposer = ({
  locale = "en-US",
  modelNames = [],
  selectedModelName,
  modelAriaLabel,
  modelSwitchDisabled = false,
  onModelSelect,
  value,
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
  const resolvedPlanModeLabel =
    planModeLabel !== undefined && planModeLabel.trim().length > 0
      ? planModeLabel
      : t("ai.planMode");
  const resolvedModelAriaLabel =
    modelAriaLabel !== undefined && modelAriaLabel.trim().length > 0
      ? modelAriaLabel
      : t("ai.modelLabel");
  const resolvedModelNames = modelNames
    .map((entry) => entry.trim())
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);
  const resolvedSelectedModelName =
    selectedModelName !== undefined
      && selectedModelName !== null
      && resolvedModelNames.includes(selectedModelName.trim())
      ? selectedModelName.trim()
      : (resolvedModelNames[0] ?? null);
  const canOpenModelMenu =
    resolvedModelNames.length > 1 && !modelSwitchDisabled && onModelSelect !== undefined;
  const modelPickerOptions = resolvedModelNames.map((entry) => ({ value: entry, label: entry }));

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
        <div className="lyra-ai-agent-composer-toolbar-leading">
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
          {resolvedModelNames.length > 0 ? (
            <LyraListPicker
              className="lyra-ai-agent-composer-model-picker"
              variant="compact"
              shape="rounded"
              ariaLabel={resolvedModelAriaLabel}
              listAriaLabel={resolvedModelAriaLabel}
              value={resolvedSelectedModelName ?? resolvedModelNames[0] ?? ""}
              options={modelPickerOptions}
              disabled={!canOpenModelMenu}
              onChange={(nextModel) => {
                onModelSelect?.(nextModel);
              }}
            />
          ) : null}
        </div>
        <div className="lyra-ai-agent-composer-toolbar-trailing">
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
    </div>
  );
};
