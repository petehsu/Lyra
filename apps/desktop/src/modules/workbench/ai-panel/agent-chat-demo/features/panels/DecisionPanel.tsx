import { useState, type CSSProperties } from "react";
import { ChevronLeft, ChevronRight, ArrowUp, HelpCircle } from "lucide-react";
import { t } from "../../core/i18n";

export interface DecisionQuestion {
  id: string;
  question: string;
  options: string[];
}

/**
 * Decision panel that sits above the composer.
 * `progress` (0–1) controls how much of the body is revealed:
 *   0 = collapsed (question only), 1 = fully expanded.
 */
export function DecisionPanel({
  questions,
  onSubmit,
  onDismiss,
  progress,
  onTap,
}: {
  questions: DecisionQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
  onDismiss: () => void;
  progress: number;
  onTap: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [customActive, setCustomActive] = useState<Record<string, boolean>>({});

  if (questions.length === 0) return null;

  const q = questions[currentIndex] ?? questions[0];
  if (q === undefined) return null;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex < questions.length - 1;

  const isCustom = customActive[q.id] ?? false;
  const customValue = customInputs[q.id] ?? "";
  const selectedOption = answers[q.id] ?? null;

  const allAnswered = questions.every((question) => {
    const ans = answers[question.id];
    return ans && ans.trim().length > 0;
  });

  const selectOption = (opt: string) => {
    setAnswers((a) => ({ ...a, [q.id]: opt }));
    setCustomActive((c) => ({ ...c, [q.id]: false }));
  };

  const activateCustom = () => {
    setCustomActive((c) => ({ ...c, [q.id]: true }));
    setAnswers((a) => ({ ...a, [q.id]: customValue }));
  };

  const updateCustom = (val: string) => {
    setCustomInputs((c) => ({ ...c, [q.id]: val }));
    setAnswers((a) => ({ ...a, [q.id]: val }));
  };

  const handleSubmit = () => {
    if (!allAnswered) return;
    onSubmit(answers);
    onDismiss();
  };

  const isCollapsed = progress < 0.1;

  return (
    <div
      className="decision-panel"
      onClick={isCollapsed ? onTap : undefined}
      style={{ cursor: isCollapsed ? "pointer" : undefined }}
    >
      {/* Header: always visible */}
      <div className="decision-header">
        <span className="decision-icon">
          <HelpCircle size={14} strokeWidth={2} />
        </span>
        <p className="decision-question">{q.question}</p>
        <div className="decision-nav">
          <button
            type="button"
            className="decision-nav-btn"
            disabled={!canPrev}
            onClick={(e) => { e.stopPropagation(); setCurrentIndex((i) => i - 1); }}
            aria-label={t("decision.prevQuestion")}
          >
            <ChevronLeft size={14} strokeWidth={2.2} />
          </button>
          <span className="decision-counter">
            {currentIndex + 1}/{questions.length}
          </span>
          <button
            type="button"
            className="decision-nav-btn"
            disabled={!canNext}
            onClick={(e) => { e.stopPropagation(); setCurrentIndex((i) => i + 1); }}
            aria-label={t("decision.nextQuestion")}
          >
            <ChevronRight size={14} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      {/* Body: height controlled by progress */}
      <div
        className="decision-body"
        style={{
          maxHeight: `${progress * 300}px`,
          opacity: progress,
          pointerEvents: progress < 0.3 ? "none" : "auto",
          "--panel-progress": progress,
        } as CSSProperties}
      >
        <div className="decision-body-content">
          <div className="decision-options">
            {q.options.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`decision-option ${selectedOption === opt && !isCustom ? "active" : ""}`}
                onClick={() => selectOption(opt)}
              >
                {opt}
              </button>
            ))}
            <button
              type="button"
              className={`decision-option decision-option-custom ${isCustom ? "active" : ""}`}
              onClick={activateCustom}
            >
              {t("decision.custom")}
            </button>
          </div>

          {isCustom && (
            <input
              className="decision-custom-input"
              type="text"
              placeholder={t("decision.customPlaceholder")}
              value={customValue}
              onChange={(e) => updateCustom(e.target.value)}
              autoFocus
            />
          )}

          <div className="decision-footer">
            {allAnswered && (
              <button
                type="button"
                className="decision-submit"
                onClick={handleSubmit}
                aria-label={t("decision.submit")}
              >
                <ArrowUp size={14} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
