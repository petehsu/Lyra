import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Check, MessageSquarePlus, Pencil, SendHorizontal, Trash2, X } from "lucide-react";

import { createTranslator } from "../i18n";
import type {
  AiPlanReviewAnnotation,
  AiPlanReviewModel,
} from "./plan-review-types";

export type AiPlanReviewSurfaceProps = {
  readonly instanceId: string;
  readonly model: AiPlanReviewModel;
};

type DraftComment = {
  readonly kind: "selection" | "line";
  readonly top: number;
  readonly left: number;
  readonly selectedText?: string;
  readonly lineNumber?: number;
  readonly lineText?: string;
};

const sanitizeMarkdownLine = (html: string): string =>
  DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "class"],
  });

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isNodeInside = (root: HTMLElement, node: Node): boolean => {
  if (node instanceof HTMLElement) {
    return root.contains(node);
  }
  return node.parentElement !== null && root.contains(node.parentElement);
};

const PlanReviewMarkdownLine = ({ line }: { readonly line: string }) => {
  const html = useMemo(() => {
    if (line.length === 0) {
      return "&nbsp;";
    }
    const parsed = marked.parse(line, {
      gfm: true,
      breaks: true,
    });
    return sanitizeMarkdownLine(typeof parsed === "string" ? parsed : line);
  }, [line]);

  return (
    <div
      className="lyra-ai-plan-review__line-rendered lyra-ai-rich-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export const AiPlanReviewSurface = ({
  instanceId,
  model,
}: AiPlanReviewSurfaceProps) => {
  const state = model.getState(instanceId);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const planBodyRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<DraftComment | null>(null);
  const [draftText, setDraftText] = useState("");
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const t = useMemo(
    () => createTranslator(state?.locale ?? "en-US"),
    [state?.locale]
  );

  const lines = useMemo(
    () => state?.request.proposedMarkdown.split(/\r?\n/u) ?? [],
    [state?.request.proposedMarkdown]
  );

  if (state === null) {
    return (
      <div className="lyra-ai-plan-review lyra-ai-plan-review-empty">
        {t("ai.planReviewNoPlan")}
      </div>
    );
  }

  const openDraftAt = (
    nextDraft: Omit<DraftComment, "top" | "left">,
    rect: DOMRect
  ): void => {
    const surface = surfaceRef.current;
    if (surface === null) {
      return;
    }
    const surfaceRect = surface.getBoundingClientRect();
    setDraft({
      ...nextDraft,
      top: clamp(rect.top - surfaceRect.top, 12, Math.max(12, surfaceRect.height - 160)),
      left: clamp(rect.right - surfaceRect.left + 8, 12, Math.max(12, surfaceRect.width - 300)),
    });
    setDraftText("");
  };

  const handleSelectionComment = (): void => {
    const body = planBodyRef.current;
    if (body === null || typeof window === "undefined") {
      return;
    }
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    if (!isNodeInside(body, range.commonAncestorContainer)) {
      return;
    }
    const selectedText = selection.toString().trim();
    if (selectedText.length === 0) {
      return;
    }
    const rangeRect = range.getBoundingClientRect();
    const firstRect = range.getClientRects()[0] ?? rangeRect;
    openDraftAt(
      {
        kind: "selection",
        selectedText,
      },
      firstRect
    );
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
      kind: draft.kind,
      note,
      ...(draft.selectedText === undefined ? {} : { selectedText: draft.selectedText }),
      ...(draft.lineNumber === undefined ? {} : { lineNumber: draft.lineNumber }),
      ...(draft.lineText === undefined ? {} : { lineText: draft.lineText }),
    });
    setDraft(null);
    setDraftText("");
  };

  const startEditing = (annotation: AiPlanReviewAnnotation): void => {
    setEditingAnnotationId(annotation.id);
    setEditingText(annotation.note);
  };

  const cancelEditing = (): void => {
    setEditingAnnotationId(null);
    setEditingText("");
  };

  const saveEditing = async (): Promise<void> => {
    if (editingAnnotationId === null) {
      return;
    }
    const note = editingText.trim();
    if (note.length === 0) {
      return;
    }
    await model.updateAnnotation(instanceId, editingAnnotationId, note);
    cancelEditing();
  };

  const annotationsByLine = new Map<number, readonly AiPlanReviewAnnotation[]>();
  for (const annotation of state.annotations) {
    if (annotation.lineNumber === undefined) {
      continue;
    }
    const current = annotationsByLine.get(annotation.lineNumber) ?? [];
    annotationsByLine.set(annotation.lineNumber, [...current, annotation]);
  }
  const selectionAnnotations = state.annotations.filter(
    (annotation) => annotation.lineNumber === undefined
  );

  const renderAnnotation = (annotation: AiPlanReviewAnnotation, index: number) => {
    const isEditing = editingAnnotationId === annotation.id;
    return (
      <div key={annotation.id} className="lyra-ai-plan-review__annotation">
        <span className="lyra-ai-plan-review__annotation-index">{String(index + 1)}</span>
        <span className="lyra-ai-plan-review__annotation-body">
          <span className="lyra-ai-plan-review__annotation-context">
            {annotation.kind === "line"
              ? `${t("ai.planReviewLineComment")} ${String(annotation.lineNumber ?? "")}`
              : t("ai.planReviewSelectionComment")}
          </span>
          {isEditing ? (
            <textarea
              className="lyra-ai-plan-review__annotation-edit"
              value={editingText}
              autoFocus
              onChange={(event) => {
                setEditingText(event.target.value);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void saveEditing();
                }
                if (event.key === "Escape") {
                  cancelEditing();
                }
              }}
            />
          ) : (
            <span className="lyra-ai-plan-review__annotation-note">{annotation.note}</span>
          )}
        </span>
        {!state.isActionable ? null : (
          <span className="lyra-ai-plan-review__annotation-actions">
            {isEditing ? (
              <>
                <button
                  type="button"
                  className="lyra-ai-plan-review__annotation-action"
                  aria-label={t("ai.planReviewSaveComment")}
                  title={t("ai.planReviewSaveComment")}
                  disabled={editingText.trim().length === 0 || state.isSubmitting}
                  onClick={() => {
                    void saveEditing();
                  }}
                >
                  <Check size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="lyra-ai-plan-review__annotation-action"
                  aria-label={t("ai.planReviewCancelEdit")}
                  title={t("ai.planReviewCancelEdit")}
                  onClick={cancelEditing}
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="lyra-ai-plan-review__annotation-action"
                  aria-label={t("ai.planReviewEditComment")}
                  title={t("ai.planReviewEditComment")}
                  disabled={state.isSubmitting}
                  onClick={() => {
                    startEditing(annotation);
                  }}
                >
                  <Pencil size={13} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="lyra-ai-plan-review__annotation-action lyra-ai-plan-review__annotation-action-danger"
                  aria-label={t("ai.planReviewDeleteComment")}
                  title={t("ai.planReviewDeleteComment")}
                  disabled={state.isSubmitting}
                  onClick={() => {
                    void model.deleteAnnotation(instanceId, annotation.id);
                    if (editingAnnotationId === annotation.id) {
                      cancelEditing();
                    }
                  }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </>
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <div ref={surfaceRef} className="lyra-ai-plan-review">
      <div className="lyra-ai-plan-review__toolbar">
        <div className="lyra-ai-plan-review__title">
          <span>{t("ai.planReviewTitle")}</span>
          <small>{state.request.summary}</small>
        </div>
        {!state.isActionable ? null : (
          <div className="lyra-ai-plan-review__actions">
            <button
              type="button"
              className="lyra-ai-plan-review__action lyra-ai-plan-review__action-primary"
              aria-label={t("ai.planReviewSendComments")}
              title={t("ai.planReviewSendComments")}
              disabled={state.annotations.length === 0 || state.isSubmitting}
              onClick={() => {
                void model.submitAnnotations(instanceId);
              }}
            >
              <SendHorizontal size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="lyra-ai-plan-review__action lyra-ai-plan-review__action-primary"
              aria-label={t("ai.planApprovalApproveAndImplement")}
              title={t("ai.planApprovalApproveAndImplement")}
              disabled={state.isSubmitting}
              onClick={() => {
                void model.decide(instanceId, {
                  requestId: state.request.id,
                  decision: "approve_and_implement",
                });
              }}
            >
              <Check size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="lyra-ai-plan-review__action lyra-ai-plan-review__action-danger"
              aria-label={t("ai.planApprovalReject")}
              title={t("ai.planApprovalReject")}
              disabled={state.isSubmitting}
              onClick={() => {
                void model.decide(instanceId, {
                  requestId: state.request.id,
                  decision: "reject",
                });
              }}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      <div
        ref={planBodyRef}
        className="lyra-ai-plan-review__body"
        onMouseUp={handleSelectionComment}
      >
        {selectionAnnotations.length === 0 ? null : (
          <div className="lyra-ai-plan-review__selection-comments">
            {selectionAnnotations.map(renderAnnotation)}
          </div>
        )}
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const lineAnnotations = annotationsByLine.get(lineNumber) ?? [];
          return (
            <div key={`${String(lineNumber)}-${line}`} className="lyra-ai-plan-review__line">
              <span className="lyra-ai-plan-review__line-number">{lineNumber}</span>
              <span className="lyra-ai-plan-review__line-content">
                <PlanReviewMarkdownLine line={line} />
                {state.isActionable ? (
                  <button
                    type="button"
                    className="lyra-ai-plan-review__line-comment"
                    aria-label={t("ai.planReviewLineComment")}
                    title={t("ai.planReviewLineComment")}
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                      openDraftAt(
                        {
                          kind: "line",
                          lineNumber,
                          lineText: line,
                        },
                        event.currentTarget.getBoundingClientRect()
                      );
                    }}
                  >
                    <MessageSquarePlus size={14} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
              {lineAnnotations.length === 0 ? null : (
                <span className="lyra-ai-plan-review__line-comments">
                  {lineAnnotations.map(renderAnnotation)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {draft === null ? null : (
        <div
          className="lyra-ai-plan-review__comment-popover"
          style={{ top: draft.top, left: draft.left }}
        >
          <div className="lyra-ai-plan-review__comment-context">
            {draft.kind === "selection"
              ? t("ai.planReviewSelectionComment")
              : `${t("ai.planReviewLineComment")} ${String(draft.lineNumber ?? "")}`}
          </div>
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
