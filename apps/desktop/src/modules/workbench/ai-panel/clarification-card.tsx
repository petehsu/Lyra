import { Check, Loader2, MessageSquareText } from "lucide-react";

import type { ClarificationOptionId, ClarificationRow } from "./clarification-model";

export type ClarificationCardState = "answering" | "answered" | "cancelled";

export type ClarificationAnswerDraft =
  | {
    readonly kind: "option";
    readonly selectedOptionId: ClarificationOptionId;
    readonly answerText: string;
  }
  | {
    readonly kind: "custom";
    readonly customAnswer: string;
    readonly answerText: string;
  };

type ClarificationCardProps = {
  readonly row: ClarificationRow;
  readonly stepIndex: number;
  readonly stepCount: number;
  readonly panelTitle: string;
  readonly panelDescription: string;
  readonly answer: ClarificationAnswerDraft | null;
  readonly state: ClarificationCardState | null;
  readonly disabled: boolean;
  readonly error: string | null;
  readonly onSelectOption: (optionId: ClarificationOptionId, answerText: string) => void;
  readonly onCustomAnswerChange: (value: string) => void;
};

export const ClarificationCard = ({
  row,
  stepIndex,
  stepCount,
  panelTitle,
  panelDescription,
  answer,
  state,
  disabled,
  error,
  onSelectOption,
  onCustomAnswerChange,
}: ClarificationCardProps) => {
  const isAnswering = state === "answering";
  const customAnswer = answer?.kind === "custom" ? answer.customAnswer : "";
  const showQuestionTitle = row.title.trim() !== panelTitle.trim();
  return (
    <div className="lyra-ai-clarification-row" data-state={state ?? "pending"}>
      <div className="lyra-ai-clarification-main">
        <div className="lyra-ai-clarification-panel-header">
          <span className="lyra-ai-clarification-panel-title">{panelTitle}</span>
          <span className="lyra-ai-clarification-progress">
            {stepIndex + 1}
            {" / "}
            {stepCount}
          </span>
          {panelDescription.length === 0 ? null : (
            <span className="lyra-ai-clarification-panel-description">
              {panelDescription}
            </span>
          )}
        </div>
        {showQuestionTitle ? (
          <span className="lyra-ai-clarification-title">
            <span>{row.title}</span>
          </span>
        ) : null}
        <span className="lyra-ai-clarification-question">{row.question}</span>
        <span className="lyra-ai-clarification-detail">
          {[row.why, row.targetSummary].filter(Boolean).join(" · ")}
        </span>
        <div className="lyra-ai-clarification-options">
          {row.options.map((option) => {
            const selected =
              answer?.kind === "option" && answer.selectedOptionId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className="lyra-ai-clarification-option"
                aria-label={`Select ${option.id}: ${option.label}`}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => {
                  onSelectOption(option.id as ClarificationOptionId, option.label);
                }}
              >
                <span className="lyra-ai-clarification-option-id">{option.id}</span>
                <span className="lyra-ai-clarification-option-copy">
                  <span className="lyra-ai-clarification-option-label">
                    {option.label}
                    {option.recommended === true ? (
                      <span className="lyra-ai-clarification-recommended">Recommended</span>
                    ) : null}
                  </span>
                  <span className="lyra-ai-clarification-option-description">
                    {option.description}
                  </span>
                </span>
                {selected ? <Check size={12} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
        {row.allowCustomAnswer ? (
          <span className="lyra-ai-clarification-custom">
            <MessageSquareText size={12} aria-hidden="true" />
            <input
              value={customAnswer}
              placeholder="Custom answer"
              disabled={disabled}
              onChange={(event) => {
                onCustomAnswerChange(event.currentTarget.value);
              }}
            />
          </span>
        ) : null}
        {error === null ? null : (
          <span className="lyra-ai-clarification-error" role="alert">{error}</span>
        )}
      </div>
      <div className="lyra-ai-clarification-actions">
        {state === "answered" ? (
          <span className="lyra-ai-clarification-state">Answered</span>
        ) : null}
        {isAnswering ? <Loader2 size={12} aria-hidden="true" /> : null}
      </div>
    </div>
  );
};
