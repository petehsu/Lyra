import { useEffect, useMemo, useState } from "react";

import type {
  AgentResolveClarificationRequest,
  AgentResolveClarificationResult,
  AgentSessionDetail,
} from "./agent-ui-types";
import {
  ClarificationCard,
  type ClarificationAnswerDraft,
  type ClarificationCardState
} from "./clarification-card";
import {
  type ClarificationPanel,
  type ClarificationOptionId,
  type ClarificationRow,
  extractClarificationPanels,
} from "./clarification-model";

type ClarificationListProps = {
  readonly detail: AgentSessionDetail | null;
  readonly resolveClarification?:
    | ((request: AgentResolveClarificationRequest) => Promise<AgentResolveClarificationResult>)
    | undefined;
  readonly onResolved?: (() => Promise<void> | void) | undefined;
};

type ClarificationStep = {
  readonly panel: ClarificationPanel;
  readonly row: ClarificationRow;
};

const isDraftComplete = (draft: ClarificationAnswerDraft | null): boolean => {
  if (draft === null) {
    return false;
  }
  if (draft.kind === "option") {
    return draft.answerText.trim().length > 0;
  }
  return draft.customAnswer.trim().length > 0;
};

const requestFromDraft = (
  draft: ClarificationAnswerDraft
): Pick<AgentResolveClarificationRequest, "selectedOptionId" | "customAnswer" | "answerText"> =>
  draft.kind === "option"
    ? {
        selectedOptionId: draft.selectedOptionId,
        answerText: draft.answerText,
      }
    : {
        customAnswer: draft.customAnswer.trim(),
        answerText: draft.customAnswer.trim(),
      };

export const ClarificationList = ({
  detail,
  resolveClarification,
  onResolved,
}: ClarificationListProps) => {
  const panels = useMemo(() => extractClarificationPanels(detail), [detail]);
  const steps = useMemo<readonly ClarificationStep[]>(() =>
    panels.flatMap((panel) =>
      panel.questions.map((question) => ({
        panel,
        row: { ...question, interaction: panel.interaction },
      }))
    ), [panels]);
  const stepIds = useMemo(
    () => steps.map((step) => step.row.questionTicketId).join("\n"),
    [steps]
  );
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [answerById, setAnswerById] = useState<Record<string, ClarificationAnswerDraft>>({});
  const [rowStateById, setRowStateById] = useState<Record<string, ClarificationCardState>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittingTicketId, setSubmittingTicketId] = useState<string | null>(null);

  useEffect(() => {
    setActiveStepIndex((current) => Math.min(current, Math.max(steps.length - 1, 0)));
    setAnswerById((current) => {
      const allowedIds = new Set(steps.map((step) => step.row.questionTicketId));
      const next = Object.fromEntries(
        Object.entries(current).filter(([id]) => allowedIds.has(id))
      );
      return next;
    });
    setSubmitError(null);
    setSubmittingTicketId(null);
  }, [stepIds, steps]);

  if (steps.length === 0) {
    return null;
  }

  const activeStep = steps[Math.min(activeStepIndex, steps.length - 1)];
  const activeRow = activeStep?.row;
  const activeAnswer = activeRow === undefined
    ? null
    : answerById[activeRow.questionTicketId] ?? null;
  const submitting = submittingTicketId !== null;
  const allAnswered = steps.every((step) =>
    isDraftComplete(answerById[step.row.questionTicketId] ?? null)
  );
  const currentAnswered = isDraftComplete(activeAnswer);
  const canGoPrevious = activeStepIndex > 0 && !submitting;
  const canGoNext = activeStepIndex < steps.length - 1 && currentAnswered && !submitting;
  const canSubmit = resolveClarification !== undefined && allAnswered && !submitting;

  const submit = async () => {
    if (resolveClarification === undefined) {
      return;
    }
    if (!allAnswered) {
      setSubmitError("Answer each question before submitting.");
      return;
    }
    setSubmitError(null);
    try {
      for (const [index, step] of steps.entries()) {
        const draft = answerById[step.row.questionTicketId];
        if (draft === undefined) {
          throw new Error("Missing clarification answer");
        }
        setActiveStepIndex(index);
        setSubmittingTicketId(step.row.questionTicketId);
        setRowStateById((current) => ({
          ...current,
          [step.row.questionTicketId]: "answering",
        }));
        const result = await resolveClarification({
          sessionId: step.row.interaction.sessionId,
          questionTicketId: step.row.questionTicketId,
          ...requestFromDraft(draft),
        });
        setRowStateById((current) => ({
          ...current,
          [step.row.questionTicketId]: result.status,
        }));
      }
      setSubmittingTicketId(null);
      await onResolved?.();
    } catch (error) {
      setSubmittingTicketId(null);
      setRowStateById((current) => Object.fromEntries(
        Object.entries(current).filter(([, state]) => state !== "answering")
      ));
      setSubmitError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="lyra-ai-clarification-list" aria-label="Pending clarifications">
      {activeStep === undefined ? null : (
        <div
          className="lyra-ai-clarification-panel"
          data-presentation={activeStep.panel.presentation}
          data-blocks-execution={activeStep.panel.blocksExecution ? "true" : "false"}
        >
          <ClarificationCard
            row={activeStep.row}
            stepIndex={activeStepIndex}
            stepCount={steps.length}
            panelTitle={activeStep.panel.title}
            panelDescription={activeStep.panel.description}
            answer={activeAnswer}
            state={rowStateById[activeStep.row.questionTicketId] ?? null}
            disabled={resolveClarification === undefined || submitting}
            error={submitError}
            onSelectOption={(optionId: ClarificationOptionId, answerText) => {
              setSubmitError(null);
              setAnswerById((current) => ({
                ...current,
                [activeStep.row.questionTicketId]: {
                  kind: "option",
                  selectedOptionId: optionId,
                  answerText,
                },
              }));
            }}
            onCustomAnswerChange={(nextValue) => {
              setSubmitError(null);
              setAnswerById((current) => ({
                ...current,
                [activeStep.row.questionTicketId]: {
                  kind: "custom",
                  customAnswer: nextValue,
                  answerText: nextValue,
                },
              }));
            }}
          />
          <div className="lyra-ai-clarification-navigation">
            <button
              type="button"
              className="lyra-ai-clarification-nav-button"
              disabled={!canGoPrevious}
              onClick={() => {
                setActiveStepIndex((current) => Math.max(current - 1, 0));
              }}
            >
              Previous
            </button>
            <span className="lyra-ai-clarification-navigation-state">
              {steps.filter((step) => isDraftComplete(answerById[step.row.questionTicketId] ?? null)).length}
              {" answered"}
            </span>
            {activeStepIndex < steps.length - 1 ? (
              <button
                type="button"
                className="lyra-ai-clarification-nav-button lyra-ai-clarification-nav-button-primary"
                disabled={!canGoNext}
                onClick={() => {
                  setActiveStepIndex((current) => Math.min(current + 1, steps.length - 1));
                }}
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                className="lyra-ai-clarification-nav-button lyra-ai-clarification-nav-button-primary"
                disabled={!canSubmit}
                onClick={() => {
                  void submit();
                }}
              >
                {submitting ? "Submitting" : "Submit"}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
