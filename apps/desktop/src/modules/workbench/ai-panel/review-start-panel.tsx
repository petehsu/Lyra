import { ClipboardCheck, GitBranch, GitCommit, MessageSquareText, X } from "lucide-react";
import { useMemo, useState } from "react";

import { createTranslator, type WorkbenchLocale } from "../i18n";
import type { ReviewTarget } from "./use-lyra-thread-runtime";

type ReviewTargetMode = ReviewTarget["type"];

type ReviewStartPanelProps = {
  readonly locale: WorkbenchLocale;
  readonly isStarting: boolean;
  readonly onClose: () => void;
  readonly onStart: (target: ReviewTarget) => Promise<void>;
};

const trimOrEmpty = (value: string): string => value.trim();

export const ReviewStartPanel = ({
  locale,
  isStarting,
  onClose,
  onStart,
}: ReviewStartPanelProps) => {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [mode, setMode] = useState<ReviewTargetMode>("uncommittedChanges");
  const [branch, setBranch] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [commitTitle, setCommitTitle] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const target = useMemo<ReviewTarget | null>(() => {
    if (mode === "uncommittedChanges") {
      return { type: "uncommittedChanges" };
    }
    if (mode === "baseBranch") {
      const value = trimOrEmpty(branch);
      return value.length === 0 ? null : { type: "baseBranch", branch: value };
    }
    if (mode === "commit") {
      const sha = trimOrEmpty(commitSha);
      if (sha.length === 0) {
        return null;
      }
      const title = trimOrEmpty(commitTitle);
      return { type: "commit", sha, title: title.length === 0 ? null : title };
    }
    const instructions = trimOrEmpty(customInstructions);
    return instructions.length === 0 ? null : { type: "custom", instructions };
  }, [branch, commitSha, commitTitle, customInstructions, mode]);

  const start = async (): Promise<void> => {
    if (target === null) {
      setErrorMessage(t("ai.reviewTargetRequired"));
      return;
    }
    setErrorMessage(null);
    try {
      await onStart(target);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const optionClassName = (value: ReviewTargetMode): string =>
    mode === value
      ? "lyra-ai-review-panel__option lyra-ai-review-panel__option-active"
      : "lyra-ai-review-panel__option";

  return (
    <section className="lyra-ai-review-panel" aria-label={t("ai.reviewPanelTitle")}>
      <header className="lyra-ai-review-panel__header">
        <span className="lyra-ai-review-panel__title">
          <ClipboardCheck size={15} aria-hidden="true" />
          <strong>{t("ai.reviewPanelTitle")}</strong>
        </span>
        <button
          type="button"
          className="lyra-ai-review-panel__icon"
          onClick={onClose}
          aria-label={t("dialog.cancel")}
          title={t("dialog.cancel")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>
      <p className="lyra-ai-review-panel__description">{t("ai.reviewPanelDescription")}</p>

      <div className="lyra-ai-review-panel__targets" role="radiogroup" aria-label={t("ai.reviewTargetLabel")}>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "uncommittedChanges"}
          className={optionClassName("uncommittedChanges")}
          onClick={() => {
            setMode("uncommittedChanges");
          }}
        >
          <ClipboardCheck size={14} aria-hidden="true" />
          <span>
            <strong>{t("ai.reviewTargetUncommitted")}</strong>
            <small>{t("ai.reviewTargetUncommittedDescription")}</small>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "baseBranch"}
          className={optionClassName("baseBranch")}
          onClick={() => {
            setMode("baseBranch");
          }}
        >
          <GitBranch size={14} aria-hidden="true" />
          <span>
            <strong>{t("ai.reviewTargetBaseBranch")}</strong>
            <small>{t("ai.reviewTargetBaseBranchDescription")}</small>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "commit"}
          className={optionClassName("commit")}
          onClick={() => {
            setMode("commit");
          }}
        >
          <GitCommit size={14} aria-hidden="true" />
          <span>
            <strong>{t("ai.reviewTargetCommit")}</strong>
            <small>{t("ai.reviewTargetCommitDescription")}</small>
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "custom"}
          className={optionClassName("custom")}
          onClick={() => {
            setMode("custom");
          }}
        >
          <MessageSquareText size={14} aria-hidden="true" />
          <span>
            <strong>{t("ai.reviewTargetCustom")}</strong>
            <small>{t("ai.reviewTargetCustomDescription")}</small>
          </span>
        </button>
      </div>

      {mode === "baseBranch" ? (
        <label className="lyra-ai-review-panel__field">
          <span>{t("ai.reviewBaseBranchLabel")}</span>
          <input
            type="text"
            value={branch}
            placeholder={t("ai.reviewBaseBranchPlaceholder")}
            onChange={(event) => {
              setBranch(event.target.value);
            }}
          />
        </label>
      ) : null}

      {mode === "commit" ? (
        <div className="lyra-ai-review-panel__field-grid">
          <label className="lyra-ai-review-panel__field">
            <span>{t("ai.reviewCommitShaLabel")}</span>
            <input
              type="text"
              value={commitSha}
              placeholder={t("ai.reviewCommitShaPlaceholder")}
              onChange={(event) => {
                setCommitSha(event.target.value);
              }}
            />
          </label>
          <label className="lyra-ai-review-panel__field">
            <span>{t("ai.reviewCommitTitleLabel")}</span>
            <input
              type="text"
              value={commitTitle}
              placeholder={t("ai.reviewCommitTitlePlaceholder")}
              onChange={(event) => {
                setCommitTitle(event.target.value);
              }}
            />
          </label>
        </div>
      ) : null}

      {mode === "custom" ? (
        <label className="lyra-ai-review-panel__field">
          <span>{t("ai.reviewCustomInstructionsLabel")}</span>
          <textarea
            value={customInstructions}
            placeholder={t("ai.reviewCustomInstructionsPlaceholder")}
            onChange={(event) => {
              setCustomInstructions(event.target.value);
            }}
          />
        </label>
      ) : null}

      {errorMessage === null ? null : (
        <div className="lyra-ai-review-panel__error">{errorMessage}</div>
      )}

      <footer className="lyra-ai-review-panel__footer">
        <button
          type="button"
          className="lyra-ai-review-panel__button"
          onClick={onClose}
        >
          {t("dialog.cancel")}
        </button>
        <button
          type="button"
          className="lyra-ai-review-panel__button lyra-ai-review-panel__button-primary"
          disabled={isStarting}
          onClick={() => {
            void start();
          }}
        >
          {isStarting ? t("dialog.savingAction") : t("ai.reviewStart")}
        </button>
      </footer>
    </section>
  );
};
