import { ChevronDown, ChevronUp, Send, X } from "lucide-react";

import { aiTextLayoutService } from "../ai-panel/text-layout";
import type { SidebarQuestionPanelViewModel } from "./types";

type SidebarQuestionPanelProps = {
  readonly panel: SidebarQuestionPanelViewModel;
  readonly navigateUpLabel: string;
  readonly navigateDownLabel: string;
  readonly closeLabel: string;
  readonly customPlaceholder: string;
  readonly submitCustomLabel: string;
  readonly onNavigateUp?: () => void;
  readonly onNavigateDown?: () => void;
  readonly onClose?: () => void;
  readonly onSelectOption?: (questionId: string, optionId: string) => void;
  readonly onCustomDraftChange?: (questionId: string, value: string) => void;
  readonly onSubmitCustom?: (questionId: string) => void;
};

export const SidebarQuestionPanel = ({
  panel,
  navigateUpLabel,
  navigateDownLabel,
  closeLabel,
  customPlaceholder,
  submitCustomLabel,
  onNavigateUp,
  onNavigateDown,
  onClose,
  onSelectOption,
  onCustomDraftChange,
  onSubmitCustom
}: SidebarQuestionPanelProps) => {
  const customDraft = panel.customDraft;
  const canSubmitCustom = customDraft.trim().length > 0;
  const promptOverflow = aiTextLayoutService.isOverflowing({
    text: panel.prompt,
    font: "400 11px system-ui",
    lineHeightPx: 15.62,
    maxWidthPx: 420,
    maxLines: 2,
    whiteSpace: "normal"
  });

  return (
    <section className="lyra-sidebar-question-panel" aria-label="sidebar-question-panel">
      <header className="lyra-sidebar-question-panel-header">
        <span className="lyra-sidebar-question-panel-progress">
          {panel.currentIndex}/{panel.totalCount}
        </span>
        <div className="lyra-sidebar-question-panel-actions" role="toolbar" aria-label="question-panel-navigation">
          <button
            type="button"
            className="lyra-sidebar-question-panel-nav"
            aria-label={navigateUpLabel}
            disabled={panel.canNavigateUp === false}
            onClick={onNavigateUp}
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            className="lyra-sidebar-question-panel-nav"
            aria-label={navigateDownLabel}
            disabled={panel.canNavigateDown === false}
            onClick={onNavigateDown}
          >
            <ChevronDown size={13} />
          </button>
          {onClose !== undefined ? (
            <button
              type="button"
              className="lyra-sidebar-question-panel-close"
              aria-label={closeLabel}
              onClick={onClose}
            >
              <X size={13} />
            </button>
          ) : null}
        </div>
      </header>

      <p
        className="lyra-sidebar-question-panel-prompt"
        {...(promptOverflow ? { title: panel.prompt } : {})}
      >
        {panel.prompt}
      </p>

      <div className="lyra-sidebar-question-panel-options" role="listbox" aria-label="question-options">
        {panel.options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="lyra-sidebar-question-panel-option"
            onClick={() => {
              onSelectOption?.(panel.questionId, option.id);
            }}
          >
            <span>{option.label}</span>
          </button>
        ))}
      </div>

      <div className="lyra-sidebar-question-panel-custom">
        <input
          className="lyra-sidebar-question-panel-custom-input"
          type="text"
          value={customDraft}
          placeholder={customPlaceholder}
          onChange={(event) => {
            onCustomDraftChange?.(panel.questionId, event.target.value);
          }}
        />
        <button
          type="button"
          className="lyra-sidebar-question-panel-custom-submit"
          aria-label={submitCustomLabel}
          disabled={canSubmitCustom === false}
          onClick={() => {
            if (canSubmitCustom === false) {
              return;
            }
            onSubmitCustom?.(panel.questionId);
          }}
        >
          <Send size={13} />
        </button>
      </div>
    </section>
  );
};
