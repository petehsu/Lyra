import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, SendHorizontal } from "lucide-react";

import type { PlanQuestionOption, PlanQuestionRequest } from "../../../shared/desktop-bridge";
import { createTranslator, type WorkbenchLocale } from "../i18n";

type PlanQuestionBarProps = {
  readonly locale?: WorkbenchLocale;
  readonly request: PlanQuestionRequest;
  readonly onSubmit: (payload: { readonly answers: Record<string, unknown>; readonly note?: string }) => void;
};

type SelectedAnswer =
  | { readonly kind: "option"; readonly option: PlanQuestionOption }
  | { readonly kind: "other"; readonly value: string };

const isSelectedAnswerReady = (answer: SelectedAnswer | undefined): boolean => {
  if (answer === undefined) {
    return false;
  }
  if (answer.kind === "option") {
    return true;
  }
  return answer.value.trim().length > 0;
};

const serializeAnswer = (answer: SelectedAnswer, otherLabel: string): unknown => {
  if (answer.kind === "option") {
    return answer.option;
  }
  return {
    label: otherLabel,
    value: answer.value.trim(),
  };
};

export const PlanQuestionBar = ({
  locale = "en-US",
  request,
  onSubmit
}: PlanQuestionBarProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [selected, setSelected] = useState<Record<string, SelectedAnswer>>({});
  const [note, setNote] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const activeQuestion = request.questions[activeIndex] ?? request.questions[0];
  const activeSelection = activeQuestion === undefined ? undefined : selected[activeQuestion.id];

  const isReady = useMemo(
    () => request.questions.every((question) => isSelectedAnswerReady(selected[question.id])),
    [request.questions, selected]
  );

  const answers = useMemo<Record<string, unknown>>(
    () =>
      Object.fromEntries(
        Object.entries(selected)
          .filter(([, answer]) => isSelectedAnswerReady(answer))
          .map(([id, answer]) => [id, serializeAnswer(answer, t("ai.planQuestionCustomReply"))])
      ),
    [selected, t]
  );

  const preview =
    activeSelection?.kind === "option" && typeof activeSelection.option.preview === "string"
      ? activeSelection.option.preview
      : null;
  const showOptionalNote = request.allowNote && activeSelection?.kind !== "other";

  if (activeQuestion === undefined) {
    return null;
  }

  return (
    <div className="lyra-ai-plan-bar">
      {request.questions.length > 1 ? (
        <div className="lyra-ai-plan-bar__progress" aria-label={t("ai.planQuestionNavigation")}>
          {request.questions.map((question, index) => {
            const answered = isSelectedAnswerReady(selected[question.id]);
            const active = index === activeIndex;
            return (
              <button
                key={question.id}
                type="button"
                className={[
                  "lyra-ai-plan-bar__progress-dot",
                  active ? "lyra-ai-plan-bar__progress-dot-active" : "",
                  answered ? "lyra-ai-plan-bar__progress-dot-answered" : "",
                ].filter(Boolean).join(" ")}
                aria-label={question.header}
                onClick={() => {
                  setActiveIndex(index);
                }}
              />
            );
          })}
        </div>
      ) : null}
      <div className="lyra-ai-plan-bar__body">
        <div className="lyra-ai-plan-bar__question">
          <div className="lyra-ai-plan-bar__question-header">{activeQuestion.header}</div>
          <div className="lyra-ai-plan-bar__question-text">{activeQuestion.question}</div>
          <div className="lyra-ai-plan-bar__options">
            {activeQuestion.options.map((option) => {
              const active =
                activeSelection?.kind === "option" && activeSelection.option.label === option.label;
              return (
                <button
                  key={`${activeQuestion.id}-${option.label}`}
                  type="button"
                  className={
                    active
                      ? "lyra-ai-plan-bar__option lyra-ai-plan-bar__option-active"
                      : "lyra-ai-plan-bar__option"
                  }
                  onClick={() => {
                    setSelected((current) => ({
                      ...current,
                      [activeQuestion.id]: { kind: "option", option },
                    }));
                  }}
                >
                  <span className="lyra-ai-plan-bar__option-label">{option.label}</span>
                  <span className="lyra-ai-plan-bar__option-description">{option.description}</span>
                </button>
              );
            })}
            <button
              type="button"
              className={
                activeSelection?.kind === "other"
                  ? "lyra-ai-plan-bar__option lyra-ai-plan-bar__option-active"
                  : "lyra-ai-plan-bar__option"
              }
              onClick={() => {
                setSelected((current) => ({
                  ...current,
                  [activeQuestion.id]: {
                    kind: "other",
                    value: current[activeQuestion.id]?.kind === "other"
                      ? (current[activeQuestion.id] as Extract<SelectedAnswer, { kind: "other" }>).value
                      : "",
                  },
                }));
              }}
            >
              <span className="lyra-ai-plan-bar__option-label">{t("ai.planQuestionCustomReply")}</span>
              <span className="lyra-ai-plan-bar__option-description">
                {t("ai.planQuestionCustomReplyDescription")}
              </span>
            </button>
          </div>
          {activeSelection?.kind === "other" ? (
            <textarea
              className="lyra-ai-plan-bar__note"
              placeholder={t("ai.planQuestionCustomReplyPlaceholder")}
              value={activeSelection.value}
              onChange={(event) => {
                const value = event.target.value;
                setSelected((current) => ({
                  ...current,
                  [activeQuestion.id]: { kind: "other", value },
                }));
              }}
            />
          ) : null}
          {preview === null ? null : (
            <pre className="lyra-ai-plan-bar__preview">{preview}</pre>
          )}
        </div>
        {showOptionalNote ? (
          <textarea
            className="lyra-ai-plan-bar__note"
            placeholder={t("ai.planQuestionOptionalNote")}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        ) : null}
      </div>
      <div className="lyra-ai-plan-bar__actions">
        {request.questions.length > 1 ? (
          <>
            <button
              type="button"
              className="lyra-ai-plan-bar__icon-action"
              disabled={activeIndex === 0}
              aria-label={t("ai.navPrevious")}
              title={t("ai.navPrevious")}
              onClick={() => {
                setActiveIndex((current) => Math.max(0, current - 1));
              }}
            >
              <ChevronLeft size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="lyra-ai-plan-bar__icon-action"
              disabled={activeIndex >= request.questions.length - 1}
              aria-label={t("ai.navNext")}
              title={t("ai.navNext")}
              onClick={() => {
                setActiveIndex((current) => Math.min(request.questions.length - 1, current + 1));
              }}
            >
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </>
        ) : null}
        {isReady ? (
          <button
            type="button"
            className="lyra-ai-plan-bar__submit lyra-ai-plan-bar__icon-action lyra-ai-plan-bar__icon-action-submit"
            aria-label={t("ai.planQuestionContinue")}
            title={t("ai.planQuestionContinue")}
            onClick={() => {
              onSubmit({
                answers,
                ...(note.trim().length === 0 ? {} : { note: note.trim() }),
              });
            }}
          >
            <SendHorizontal size={15} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
};
