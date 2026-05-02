import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Check, MessageSquarePlus, SendHorizontal, Trash2, X } from "lucide-react";

import type { AgentPlanBlock, PlanApprovalDecision } from "../../../shared/desktop-bridge";
import { createTranslator } from "../i18n";
import type { AiPlanReviewModel } from "./plan-review-types";

export type AiPlanReviewSurfaceProps = {
  readonly instanceId: string;
  readonly model: AiPlanReviewModel;
};

type PlanSection = {
  readonly label: string;
  readonly blocks: readonly AgentPlanBlock[];
};

type DraftComment = {
  readonly top: number;
  readonly left: number;
  readonly anchor: string;
  readonly blockId?: string;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isNodeInside = (root: HTMLElement, node: Node): boolean => {
  if (node instanceof HTMLElement) {
    return root.contains(node);
  }
  return node.parentElement !== null && root.contains(node.parentElement);
};

const compactAnchor = (value: string): string => {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized;
};

const sectionEntries = (
  artifact: {
    readonly assumptions: readonly AgentPlanBlock[];
    readonly steps: readonly AgentPlanBlock[];
    readonly interfaces: readonly AgentPlanBlock[];
    readonly risks: readonly AgentPlanBlock[];
    readonly tests: readonly AgentPlanBlock[];
    readonly acceptanceCriteria: readonly AgentPlanBlock[];
  }
): readonly PlanSection[] => [
  { label: "Assumptions", blocks: artifact.assumptions },
  { label: "Steps", blocks: artifact.steps },
  { label: "Interfaces", blocks: artifact.interfaces },
  { label: "Risks", blocks: artifact.risks },
  { label: "Tests", blocks: artifact.tests },
  { label: "Acceptance Criteria", blocks: artifact.acceptanceCriteria },
];

const closestAnchor = (
  root: HTMLElement,
  node: Node,
  fallback: string
): { readonly anchor: string; readonly blockId?: string } => {
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const anchorElement = element?.closest<HTMLElement>("[data-plan-anchor]");
  if (anchorElement === undefined || anchorElement === null || !root.contains(anchorElement)) {
    return { anchor: fallback };
  }
  return {
    anchor: anchorElement.dataset.planAnchor ?? fallback,
    ...(anchorElement.dataset.planBlockId === undefined
      ? {}
      : { blockId: anchorElement.dataset.planBlockId }),
  };
};

export const AiPlanReviewSurface = ({
  instanceId,
  model,
}: AiPlanReviewSurfaceProps) => {
  const state = model.getState(instanceId);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLElement>(null);
  const [overallFeedback, setOverallFeedback] = useState("");
  const [draft, setDraft] = useState<DraftComment | null>(null);
  const [draftText, setDraftText] = useState("");
  const t = useMemo(
    () => createTranslator(state?.locale ?? "en-US"),
    [state?.locale]
  );

  if (state === null) {
    return (
      <div className="lyra-ai-plan-review lyra-ai-plan-review-empty">
        {t("ai.planReviewNoPlan")}
      </div>
    );
  }

  const openDraft = (
    anchor: string,
    blockId: string | undefined,
    rect: DOMRect
  ): void => {
    const surface = surfaceRef.current;
    if (surface === null) {
      return;
    }
    const surfaceRect = surface.getBoundingClientRect();
    setDraft({
      anchor,
      ...(blockId === undefined ? {} : { blockId }),
      top: clamp(rect.bottom - surfaceRect.top + 8, 12, Math.max(12, surfaceRect.height - 176)),
      left: clamp(rect.left - surfaceRect.left, 12, Math.max(12, surfaceRect.width - 324)),
    });
    setDraftText("");
  };

  const handleDocumentMouseUp = (): void => {
    const documentElement = documentRef.current;
    if (documentElement === null || typeof window === "undefined" || !state.isActionable) {
      return;
    }
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!isNodeInside(documentElement, range.commonAncestorContainer)) {
      return;
    }
    const selectedText = compactAnchor(selection.toString());
    if (selectedText.length === 0) {
      return;
    }
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    const anchor = closestAnchor(documentElement, range.commonAncestorContainer, selectedText);
    openDraft(`"${selectedText}"`, anchor.blockId, rect);
  };

  const handleAnchorComment = (
    anchor: string,
    blockId: string | undefined,
    event: ReactMouseEvent<HTMLButtonElement>
  ): void => {
    openDraft(anchor, blockId, event.currentTarget.getBoundingClientRect());
  };

  const addDraft = async (): Promise<void> => {
    if (draft === null) {
      return;
    }
    const note = draftText.trim();
    if (note.length === 0) {
      return;
    }
    await model.addAnnotation(instanceId, {
      ...(draft.blockId === undefined ? {} : { blockId: draft.blockId }),
      anchor: draft.anchor,
      note,
    });
    setDraft(null);
    setDraftText("");
    if (typeof window !== "undefined") {
      window.getSelection()?.removeAllRanges();
    }
  };

  const annotations = state.annotations.map((annotation) => ({
    ...(annotation.blockId === undefined ? {} : { blockId: annotation.blockId }),
    anchor: annotation.anchor,
    comment: annotation.note,
  }));
  const trimmedFeedback = overallFeedback.trim();
  const hasRevisionInput = annotations.length > 0 || trimmedFeedback.length > 0;

  const decide = (decision: PlanApprovalDecision): void => {
    void model.decide(instanceId, {
      planId: state.request.planId,
      decision,
      ...(trimmedFeedback.length === 0 ? {} : { feedback: trimmedFeedback }),
      annotations,
      artifactSnapshot: state.request.artifact,
    });
  };

  const renderCommentButton = (anchor: string, blockId?: string) =>
    state.isActionable ? (
      <button
        type="button"
        className="lyra-ai-plan-review__anchor-comment"
        aria-label={t("ai.planReviewAddComment")}
        title={t("ai.planReviewAddComment")}
        disabled={state.isSubmitting}
        onClick={(event) => {
          handleAnchorComment(anchor, blockId, event);
        }}
      >
        <MessageSquarePlus size={14} aria-hidden="true" />
      </button>
    ) : null;

  return (
    <div ref={surfaceRef} className="lyra-ai-plan-review">
      <header className="lyra-ai-plan-review__header">
        <div>
          <div className="lyra-ai-plan-review__eyebrow">{t("ai.planProposedTitle")}</div>
          <h2>{state.request.artifact.title}</h2>
          <p>{state.request.artifact.summary}</p>
        </div>
      </header>

      <div className="lyra-ai-plan-review__main">
        <article
          ref={documentRef}
          className="lyra-ai-plan-review__document"
          onMouseUp={handleDocumentMouseUp}
        >
          <section
            className="lyra-ai-plan-review__doc-section"
            data-plan-anchor="Summary"
          >
            <div className="lyra-ai-plan-review__doc-heading-row">
              <h3>Summary</h3>
              {renderCommentButton("Summary")}
            </div>
            <p>{state.request.artifact.summary}</p>
          </section>

          <section
            className="lyra-ai-plan-review__doc-section"
            data-plan-anchor="Objective"
          >
            <div className="lyra-ai-plan-review__doc-heading-row">
              <h3>Objective</h3>
              {renderCommentButton("Objective")}
            </div>
            <p>{state.request.artifact.objective}</p>
          </section>

          {sectionEntries(state.request.artifact).map((section) =>
            section.blocks.length === 0 ? null : (
              <section
                key={section.label}
                className="lyra-ai-plan-review__doc-section"
                data-plan-anchor={section.label}
              >
                <div className="lyra-ai-plan-review__doc-heading-row">
                  <h3>{section.label}</h3>
                  {renderCommentButton(section.label)}
                </div>
                <div className="lyra-ai-plan-review__doc-blocks">
                  {section.blocks.map((block) => (
                    <section
                      key={block.id}
                      className="lyra-ai-plan-review__doc-block"
                      data-plan-anchor={block.title}
                      data-plan-block-id={block.id}
                    >
                      <div className="lyra-ai-plan-review__doc-heading-row">
                        <h4>{block.title}</h4>
                        {renderCommentButton(block.title, block.id)}
                      </div>
                      <p>{block.body}</p>
                    </section>
                  ))}
                </div>
              </section>
            )
          )}
        </article>

        <aside className="lyra-ai-plan-review__comments" aria-label={t("ai.planReviewTitle")}>
          <div className="lyra-ai-plan-review__comments-header">
            <span>{t("ai.planReviewTitle")}</span>
            <small>{String(state.annotations.length)}</small>
          </div>
          {state.annotations.length === 0 ? (
            <p className="lyra-ai-plan-review__comments-empty">
              {t("ai.planReviewEmptyComments")}
            </p>
          ) : (
            <div className="lyra-ai-plan-review__comments-list">
              {state.annotations.map((annotation) => (
                <div key={annotation.id} className="lyra-ai-plan-review__annotation">
                  <div className="lyra-ai-plan-review__annotation-body">
                    <span className="lyra-ai-plan-review__annotation-context">
                      {annotation.anchor}
                    </span>
                    <span className="lyra-ai-plan-review__annotation-note">
                      {annotation.note}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="lyra-ai-plan-review__comment-cancel"
                    aria-label={t("ai.planReviewDeleteComment")}
                    title={t("ai.planReviewDeleteComment")}
                    disabled={state.isSubmitting}
                    onClick={() => {
                      void model.deleteAnnotation(instanceId, annotation.id);
                    }}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <footer className="lyra-ai-plan-review__footer">
        <textarea
          className="lyra-ai-plan-review__overall-feedback"
          value={overallFeedback}
          placeholder={t("ai.planApprovalOptionalFeedback")}
          onChange={(event) => {
            setOverallFeedback(event.target.value);
          }}
        />
        <div className="lyra-ai-plan-review__actions">
          <button
            type="button"
            className="lyra-ai-plan-review__approve"
            disabled={!state.isActionable || state.isSubmitting}
            onClick={() => {
              decide("approve_and_implement");
            }}
          >
            <Check size={15} aria-hidden="true" />
            {t("ai.planApprovalApproveAndImplement")}
          </button>
          <button
            type="button"
            className="lyra-ai-plan-review__secondary"
            disabled={!state.isActionable || state.isSubmitting || !hasRevisionInput}
            onClick={() => {
              decide("keep_planning");
            }}
          >
            <SendHorizontal size={15} aria-hidden="true" />
            {t("ai.planReviewSendComments")}
          </button>
          <button
            type="button"
            className="lyra-ai-plan-review__danger"
            disabled={!state.isActionable || state.isSubmitting}
            onClick={() => {
              decide("reject");
            }}
          >
            <X size={15} aria-hidden="true" />
            {t("ai.planApprovalReject")}
          </button>
        </div>
      </footer>

      {draft === null ? null : (
        <div
          className="lyra-ai-plan-review__comment-popover"
          style={{ top: draft.top, left: draft.left }}
        >
          <div className="lyra-ai-plan-review__comment-context">{draft.anchor}</div>
          <textarea
            className="lyra-ai-plan-review__comment-input"
            value={draftText}
            placeholder={t("ai.planReviewCommentPlaceholder")}
            autoFocus
            onChange={(event) => {
              setDraftText(event.target.value);
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                void addDraft();
              }
              if (event.key === "Escape") {
                setDraft(null);
                setDraftText("");
              }
            }}
          />
          <div className="lyra-ai-plan-review__comment-actions">
            <button
              type="button"
              className="lyra-ai-plan-review__comment-submit"
              aria-label={t("ai.planReviewAddComment")}
              title={t("ai.planReviewAddComment")}
              disabled={draftText.trim().length === 0 || state.isSubmitting}
              onClick={() => {
                void addDraft();
              }}
            >
              <MessageSquarePlus size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="lyra-ai-plan-review__comment-cancel"
              aria-label={t("ai.planApprovalReject")}
              title={t("ai.planApprovalReject")}
              onClick={() => {
                setDraft(null);
                setDraftText("");
              }}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
