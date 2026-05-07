import { CircleHelp, Loader2, MessageSquareText } from "lucide-react";
import { useMemo, useState } from "react";

import type {
  AgentResolveClarificationRequest,
  AgentResolveClarificationResult,
  AgentSessionDetail,
} from "./agent-ui-types";
import {
  type ClarificationOptionId,
  type ClarificationRow,
  extractClarificationRows,
} from "./clarification-model";

type ClarificationListProps = {
  readonly detail: AgentSessionDetail | null;
  readonly resolveClarification?:
    | ((request: AgentResolveClarificationRequest) => Promise<AgentResolveClarificationResult>)
    | undefined;
  readonly onResolved?: (() => Promise<void> | void) | undefined;
};

type RowState = "answering" | "answered" | "cancelled";

export const ClarificationList = ({
  detail,
  resolveClarification,
  onResolved,
}: ClarificationListProps) => {
  const rows = useMemo(() => extractClarificationRows(detail), [detail]);
  const [rowStateById, setRowStateById] = useState<Record<string, RowState>>({});
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [customOpenById, setCustomOpenById] = useState<Record<string, boolean>>({});
  const [customAnswerById, setCustomAnswerById] = useState<Record<string, string>>({});

  if (rows.length === 0) {
    return null;
  }

  const resolve = async (
    row: ClarificationRow,
    request: Pick<AgentResolveClarificationRequest, "selectedOptionId" | "customAnswer" | "answerText">
  ) => {
    if (resolveClarification === undefined) {
      return;
    }
    setRowStateById((current) => ({
      ...current,
      [row.questionTicketId]: "answering",
    }));
    setErrorById((current) => {
      const next = { ...current };
      delete next[row.questionTicketId];
      return next;
    });
    try {
      const result = await resolveClarification({
        sessionId: row.interaction.sessionId,
        questionTicketId: row.questionTicketId,
        ...request,
      });
      setRowStateById((current) => ({
        ...current,
        [row.questionTicketId]: result.status,
      }));
      await onResolved?.();
    } catch (error) {
      setRowStateById((current) => {
        const next = { ...current };
        delete next[row.questionTicketId];
        return next;
      });
      setErrorById((current) => ({
        ...current,
        [row.questionTicketId]: error instanceof Error ? error.message : String(error),
      }));
    }
  };

  return (
    <section className="lyra-ai-clarification-list" aria-label="Pending clarifications">
      {rows.map((row) => {
        const rowState = rowStateById[row.questionTicketId] ?? null;
        const isAnswering = rowState === "answering";
        const customOpen = customOpenById[row.questionTicketId] ?? false;
        const customAnswer = customAnswerById[row.questionTicketId] ?? "";
        const error = errorById[row.questionTicketId] ?? null;
        const disabled = resolveClarification === undefined || isAnswering || rowState === "answered";
        return (
          <div key={row.questionTicketId} className="lyra-ai-clarification-row">
            <span className="lyra-ai-clarification-icon" aria-hidden="true">
              <CircleHelp size={13} />
            </span>
            <span className="lyra-ai-clarification-main">
              <span className="lyra-ai-clarification-title">{row.title}</span>
              <span className="lyra-ai-clarification-question">{row.question}</span>
              <span className="lyra-ai-clarification-detail">
                {[row.why, row.targetSummary].filter(Boolean).join(" · ")}
              </span>
              {customOpen ? (
                <span className="lyra-ai-clarification-custom">
                  <input
                    value={customAnswer}
                    placeholder="Custom answer"
                    disabled={disabled}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;
                      setCustomAnswerById((current) => ({
                        ...current,
                        [row.questionTicketId]: nextValue,
                      }));
                    }}
                  />
                  <button
                    type="button"
                    disabled={disabled || customAnswer.trim().length === 0}
                    onClick={() => {
                      void resolve(row, {
                        customAnswer: customAnswer.trim(),
                        answerText: customAnswer.trim(),
                      });
                    }}
                  >
                    {isAnswering ? <Loader2 size={12} aria-hidden="true" /> : <MessageSquareText size={12} aria-hidden="true" />}
                    <span>{isAnswering ? "Answering" : "Send"}</span>
                  </button>
                </span>
              ) : null}
              {error === null ? null : (
                <span className="lyra-ai-clarification-error" role="alert">{error}</span>
              )}
            </span>
            <span className="lyra-ai-clarification-actions">
              {rowState === "answered" ? (
                <span className="lyra-ai-clarification-state">Answered</span>
              ) : null}
              {row.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="lyra-ai-clarification-option"
                  title={option.description}
                  disabled={disabled}
                  onClick={() => {
                    void resolve(row, { selectedOptionId: option.id as ClarificationOptionId });
                  }}
                >
                  {isAnswering ? <Loader2 size={12} aria-hidden="true" /> : null}
                  <span>{option.id}</span>
                </button>
              ))}
              {row.allowCustomAnswer ? (
                <button
                  type="button"
                  className="lyra-ai-clarification-custom-toggle"
                  disabled={disabled}
                  onClick={() => {
                    setCustomOpenById((current) => ({
                      ...current,
                      [row.questionTicketId]: !(current[row.questionTicketId] ?? false),
                    }));
                  }}
                >
                  Custom
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
    </section>
  );
};
