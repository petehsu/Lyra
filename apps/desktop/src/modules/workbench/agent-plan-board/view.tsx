import { useMemo, useState } from "react";
import { renderMarkdown } from "@lyra/markdown-render";
import {
  Check,
  CheckCircle2,
  Clock3,
  HelpCircle,
  MessageSquare,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
  XCircle
} from "lucide-react";

import type {
  AgentPlanAnnotation,
  AgentPlanSnapshot,
  AgentProjectPlanSummary,
  AgentProjectTodoSnapshot,
  AgentTodoItem
} from "../../../shared/agent";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import { PlanTempChat } from "./temp-chat";
import type { AgentPlanBoardSurfaceProps, AgentPlanBoardView } from "./types";
import {
  editableLineId,
  parseMarkdownBlocks,
  replaceMarkdownLine,
  type EditableMarkdownBlock
} from "./markdown-blocks";

const stripWrappingParagraph = (html: string): string => {
  const match = html.match(/^\s*<p>([\s\S]*?)<\/p>\s*$/u);
  return match !== null ? (match[1] ?? "") : html;
};

// Inline-level rich rendering for single-line blocks (headings, list items,
// paragraphs) — bold/italic/links/inline-code/math render instead of showing
// raw markdown. Output is DOMPurify-sanitized by the renderer.
const renderInlineHtml = (text: string): string =>
  stripWrappingParagraph(renderMarkdown(text, { mode: "final" }).html);

// Block-level rich rendering for multi-line constructs (tables, blockquotes).
const renderBlockHtml = (source: string): string =>
  renderMarkdown(source, { mode: "final" }).html;

const statusClassName = (status: string): string => {
  const normalized = status.toLowerCase();
  if (normalized.includes("complete") || normalized === "done") return "is-done";
  if (normalized.includes("progress") || normalized === "running") return "is-running";
  if (normalized.includes("fail") || normalized.includes("reject")) return "is-failed";
  if (normalized.includes("skip") || normalized.includes("cancel")) return "is-muted";
  return "is-pending";
};

const TodoStatusIcon = ({ status }: { readonly status: string }) => {
  const normalized = status.toLowerCase();
  if (normalized.includes("complete") || normalized === "done") return <CheckCircle2 size={14} />;
  if (normalized.includes("fail") || normalized.includes("reject")) return <XCircle size={14} />;
  if (normalized.includes("progress") || normalized === "running") return <Clock3 size={14} />;
  return <HelpCircle size={14} />;
};

const normalizeAnnotation = (
  block: EditableMarkdownBlock,
  text: string,
  kind: AgentPlanAnnotation["kind"]
): AgentPlanAnnotation => ({
  id: `plan-annotation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
  lineId: editableLineId(block.lineIndex),
  line: block.lineIndex + 1,
  kind,
  text: text.trim(),
  createdAt: new Date().toISOString()
});

const annotationsForBlock = (
  annotations: readonly AgentPlanAnnotation[],
  block: EditableMarkdownBlock
): readonly AgentPlanAnnotation[] =>
  annotations.filter((annotation) =>
    annotation.lineId === editableLineId(block.lineIndex)
    || annotation.line === block.lineIndex + 1
  );

const MarkdownPreview = ({
  labels,
  markdown,
  annotations,
  onRevise
}: {
  readonly labels: AgentPlanBoardSurfaceProps["labels"];
  readonly markdown: string;
  readonly annotations: readonly AgentPlanAnnotation[];
  readonly onRevise?: AgentPlanBoardSurfaceProps["onRevisePlan"];
}) => {
  const blocks = useMemo(() => parseMarkdownBlocks(markdown), [markdown]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [commentingKey, setCommentingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const startEdit = (block: EditableMarkdownBlock): void => {
    setCommentingKey(null);
    setEditingKey(block.key);
    setDraft(block.text);
  };
  const startComment = (block: EditableMarkdownBlock): void => {
    setEditingKey(null);
    setCommentingKey(block.key);
    setDraft("");
  };
  const cancel = (): void => {
    setEditingKey(null);
    setCommentingKey(null);
    setDraft("");
  };
  const saveEdit = async (block: EditableMarkdownBlock): Promise<void> => {
    const text = draft.trim();
    if (text.length === 0 || onRevise === undefined) {
      cancel();
      return;
    }
    setBusyKey(block.key);
    try {
      await onRevise({
        markdown: replaceMarkdownLine(markdown, block, text),
        annotations: [
          ...annotations,
          normalizeAnnotation(block, text, "edit")
        ],
        source: "user_edit",
        summary: labels.editLine
      });
      cancel();
    } finally {
      setBusyKey(null);
    }
  };
  const saveComment = async (block: EditableMarkdownBlock): Promise<void> => {
    const text = draft.trim();
    if (text.length === 0 || onRevise === undefined) {
      cancel();
      return;
    }
    setBusyKey(block.key);
    try {
      await onRevise({
        markdown,
        annotations: [
          ...annotations,
          normalizeAnnotation(block, text, "comment")
        ],
        source: "user_edit",
        summary: labels.commentLine
      });
      cancel();
    } finally {
      setBusyKey(null);
    }
  };

  const renderEditableShell = (
    block: EditableMarkdownBlock,
    content: JSX.Element
  ): JSX.Element => {
    const blockAnnotations = annotationsForBlock(annotations, block);
    const isEditing = editingKey === block.key;
    const isCommenting = commentingKey === block.key;
    const disabled = busyKey === block.key || onRevise === undefined;
    return (
      <div key={block.key} className="lyra-agent-plan-board-line">
        <div className="lyra-agent-plan-board-line-content">
          {isEditing || isCommenting ? (
            <div className="lyra-agent-plan-board-line-editor">
              {isEditing && block.kind === "rich" ? (
                <textarea
                  autoFocus
                  rows={Math.min(Math.max(draft.split("\n").length, 2), 12)}
                  className="lyra-agent-plan-board-line-input lyra-agent-plan-board-line-textarea"
                  placeholder={labels.editPlaceholder}
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      cancel();
                    }
                  }}
                />
              ) : (
                <input
                  autoFocus
                  className="lyra-agent-plan-board-line-input"
                  placeholder={isEditing ? labels.editPlaceholder : labels.commentPlaceholder}
                  value={draft}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      cancel();
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void (isEditing ? saveEdit(block) : saveComment(block));
                    }
                  }}
                />
              )}
              <button
                className="lyra-agent-plan-board-line-icon-btn"
                type="button"
                disabled={disabled}
                title={labels.save}
                onClick={() => { void (isEditing ? saveEdit(block) : saveComment(block)); }}
              >
                <Check size={13} />
              </button>
              <button
                className="lyra-agent-plan-board-line-icon-btn"
                type="button"
                title={labels.cancel}
                onClick={cancel}
              >
                <X size={13} />
              </button>
            </div>
          ) : content}
          {blockAnnotations.length > 0 ? (
            <div className="lyra-agent-plan-board-line-notes">
              {blockAnnotations.map((annotation) => (
                <div key={annotation.id} className={`lyra-agent-plan-board-line-note is-${annotation.kind}`}>
                  {annotation.text}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {onRevise !== undefined ? (
          <div className="lyra-agent-plan-board-line-actions">
            <button
              className="lyra-agent-plan-board-line-action"
              type="button"
              onClick={() => startEdit(block)}
            >
              <Pencil size={12} />
              {labels.editLine}
            </button>
            <button
              className="lyra-agent-plan-board-line-action"
              type="button"
              onClick={() => startComment(block)}
            >
              <MessageSquare size={12} />
              {labels.commentLine}
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="lyra-agent-plan-board-markdown">
      {blocks.map((block) => {
        if (block.kind === "heading") {
          const Heading = `h${Math.min(block.level + 1, 5)}` as keyof JSX.IntrinsicElements;
          return renderEditableShell(
            block,
            <Heading dangerouslySetInnerHTML={{ __html: renderInlineHtml(block.text) }} />
          );
        }
        if (block.kind === "list") {
          return renderEditableShell(
            block,
            <div className="lyra-agent-plan-board-list-row">
              <span className="lyra-agent-plan-board-list-marker">
                {block.taskState === "done" ? "✓" : block.taskState === "todo" ? "□" : "•"}
              </span>
              <span dangerouslySetInnerHTML={{ __html: renderInlineHtml(block.text) }} />
            </div>
          );
        }
        if (block.kind === "rich") {
          return renderEditableShell(
            block,
            <div
              className="lyra-agent-plan-board-rich lyra-agents-md"
              dangerouslySetInnerHTML={{ __html: renderBlockHtml(block.text) }}
            />
          );
        }
        if (block.kind === "code") {
          return <pre key={block.key}>{block.text}</pre>;
        }
        return renderEditableShell(
          block,
          <p dangerouslySetInnerHTML={{ __html: renderInlineHtml(block.text) }} />
        );
      })}
    </div>
  );
};

const TodoList = ({
  todos,
  currentIndex,
  labels
}: {
  readonly todos: readonly AgentTodoItem[];
  readonly currentIndex: number;
  readonly labels: AgentPlanBoardSurfaceProps["labels"];
}) => (
  <div className="lyra-agent-plan-board-todo-list">
    {todos.map((todo, index) => (
      <div
        key={todo.id}
        className={[
          "lyra-agent-plan-board-todo-item",
          statusClassName(todo.status),
          index === currentIndex ? "is-current" : ""
        ].join(" ")}
      >
        <span className="lyra-agent-plan-board-todo-index">{index + 1}</span>
        <span className="lyra-agent-plan-board-todo-icon">
          <TodoStatusIcon status={todo.status} />
        </span>
        <span className="lyra-agent-plan-board-todo-content">{todo.content}</span>
        <span className="lyra-agent-plan-board-todo-status">{todo.status}</span>
      </div>
    ))}
    {todos.length === 0 ? (
      <p className="lyra-agent-plan-board-empty">{labels.noTodo}</p>
    ) : null}
  </div>
);

const PlanTodoDetail = ({
  labels,
  plan,
  todo,
  view = "both",
  onRevisePlan,
  onResumePlan
}: {
  readonly labels: AgentPlanBoardSurfaceProps["labels"];
  readonly plan: AgentPlanSnapshot;
  readonly todo: AgentProjectTodoSnapshot | null;
  readonly view?: AgentPlanBoardView;
  readonly onRevisePlan?: AgentPlanBoardSurfaceProps["onRevisePlan"];
  readonly onResumePlan?: () => Promise<void>;
}) => {
  const showTodo = view !== "plan" && todo !== null;
  const showPlan = view !== "todo";
  const current = todo === null ? 0 : Math.min(todo.currentIndex + 1, todo.todos.length);
  const total = todo?.todos.length ?? 0;
  const isSetAside = plan.phase === "set_aside";
  const [resuming, setResuming] = useState(false);
  const handleResume = async (): Promise<void> => {
    if (onResumePlan === undefined || resuming) return;
    setResuming(true);
    try {
      await onResumePlan();
    } finally {
      setResuming(false);
    }
  };
  return (
    <>
      <header className="lyra-agent-plan-board-header">
        <div>
          <p className="lyra-agent-plan-board-eyebrow">{labels.title}</p>
          <h1>{plan.title}</h1>
        </div>
        <div className="lyra-agent-plan-board-meta">
          {isSetAside ? (
            <span className="lyra-agent-plan-board-badge is-set-aside">{labels.setAsideBadge}</span>
          ) : null}
          <span>{labels.phase}: {plan.phase}</span>
          <span>{labels.version}: {plan.activeVersionId}</span>
          {showTodo ? <span>{labels.currentStep}: {current}/{total}</span> : null}
          {isSetAside && onResumePlan !== undefined ? (
            <button
              type="button"
              className="lyra-agent-plan-board-resume-btn"
              disabled={resuming}
              onClick={() => { void handleResume(); }}
            >
              <RotateCcw size={13} />
              {labels.resumePlan}
            </button>
          ) : null}
        </div>
      </header>

      <main className={showTodo && showPlan ? "lyra-agent-plan-board-main has-todo" : "lyra-agent-plan-board-main"}>
        {showTodo ? (
          <aside className="lyra-agent-plan-board-todo">
            <h2>{labels.todo}</h2>
            <TodoList todos={todo.todos} currentIndex={todo.currentIndex} labels={labels} />
          </aside>
        ) : null}
        {showPlan ? (
          <section className="lyra-agent-plan-board-plan">
            <h2>{labels.plan}</h2>
            <MarkdownPreview
              labels={labels}
              markdown={plan.markdown}
              annotations={plan.annotations}
              onRevise={onRevisePlan}
            />
          </section>
        ) : null}
        {!showTodo && !showPlan ? (
          <p className="lyra-agent-plan-board-empty">{labels.noTodo}</p>
        ) : null}
      </main>
    </>
  );
};

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const PlanManagerList = ({
  labels,
  plans,
  selectedPlanId,
  loading,
  onOpenPlan,
  onDeletePlan
}: {
  readonly labels: AgentPlanBoardSurfaceProps["labels"];
  readonly plans: readonly AgentProjectPlanSummary[];
  readonly selectedPlanId: string | null;
  readonly loading: boolean;
  readonly onOpenPlan: ((planId: string) => Promise<void>) | undefined;
  readonly onDeletePlan: ((planId: string) => Promise<void>) | undefined;
}) => {
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const runPlanAction = async (
    planId: string,
    action: ((planId: string) => Promise<void>) | undefined
  ): Promise<void> => {
    if (action === undefined || busyPlanId !== null) return;
    setBusyPlanId(planId);
    try {
      await action(planId);
    } finally {
      setBusyPlanId(null);
    }
  };

  return (
    <div className="lyra-agent-plan-board-manager-list">
      {plans.map((plan) => {
        const busy = busyPlanId === plan.planId || loading;
        return (
          <article
            key={plan.planId}
            className={[
              "lyra-agent-plan-board-manager-item",
              selectedPlanId === plan.planId ? "is-selected" : ""
            ].join(" ")}
          >
            <button
              type="button"
              className="lyra-agent-plan-board-manager-open"
              disabled={busy || onOpenPlan === undefined}
              title={labels.openPlan}
              onClick={() => { void runPlanAction(plan.planId, onOpenPlan); }}
            >
              <span className="lyra-agent-plan-board-manager-title">{plan.title}</span>
              <span className="lyra-agent-plan-board-manager-meta">
                {labels.status}: {plan.status}
              </span>
              <span className="lyra-agent-plan-board-manager-meta">
                {labels.updated}: {formatDateTime(plan.updatedAtIso)}
              </span>
              {plan.todoStatus !== null && plan.todoStatus !== undefined ? (
                <span className="lyra-agent-plan-board-manager-meta">
                  {labels.todo}: {plan.todoStatus}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              className="lyra-agent-plan-board-manager-delete"
              disabled={busy || onDeletePlan === undefined}
              title={labels.deletePlan}
              aria-label={labels.deletePlan}
              onClick={() => { void runPlanAction(plan.planId, onDeletePlan); }}
            >
              <Trash2 size={13} />
            </button>
          </article>
        );
      })}
      {plans.length === 0 ? (
        <p className="lyra-agent-plan-board-empty">{loading ? labels.loading : labels.noPlans}</p>
      ) : null}
    </div>
  );
};

export const AgentPlanBoardSurface = ({
  labels,
  state,
  desktopApi,
  onOpenManagedPlan,
  onDeleteManagedPlan,
  onRefreshManager,
  onRevisePlan,
  openDialog
}: AgentPlanBoardSurfaceProps) => {
  const plan = state.mode === "detail" ? state.plan : state.selectedPlan;
  // Deleting a managed plan is destructive and irreversible, so route it through
  // the global confirmation dialog. Without a dialog host we fall back to the raw
  // delete so the action still works (e.g. in tests).
  const confirmDeleteManagedPlan = useMemo(() => {
    if (onDeleteManagedPlan === undefined) return undefined;
    if (openDialog === undefined) return onDeleteManagedPlan;
    const plans = state.mode === "manager" ? state.plans : [];
    return (planId: string): Promise<void> =>
      new Promise<void>((resolve) => {
        const target = plans.find((entry) => entry.planId === planId);
        openDialog({
          title: labels.deleteConfirmTitle,
          description: labels.deleteConfirmDescription,
          source: {
            title: labels.title,
            subtitle: target?.title ?? labels.manager,
            iconLabel: "AI",
            iconTone: "danger"
          },
          actions: [
            { id: "cancel", label: labels.cancel, onSelect: () => resolve() },
            {
              id: "delete",
              label: labels.deleteConfirmAction,
              tone: "danger",
              onSelect: () => {
                void onDeleteManagedPlan(planId).finally(() => resolve());
              }
            }
          ]
        });
      });
  }, [
    onDeleteManagedPlan,
    openDialog,
    state,
    labels.deleteConfirmTitle,
    labels.deleteConfirmDescription,
    labels.deleteConfirmAction,
    labels.title,
    labels.manager,
    labels.cancel
  ]);
  const resumePlan = useMemo(() => {
    const agent = desktopApi?.agent;
    if (agent?.respondPlanReview === undefined) return undefined;
    const sessionId = state.agentSessionId;
    return async (): Promise<void> => {
      await agent.respondPlanReview({ sessionId, action: "resume" });
      // Manager view reads from the persisted store, so refresh it explicitly;
      // the detail view updates from runtime session-snapshot events.
      if (state.mode === "manager") await onRefreshManager?.();
    };
  }, [desktopApi, state.agentSessionId, state.mode, onRefreshManager]);
  const titlebarContent = useMemo(() => (
    <div className="lyra-agent-plan-board-titlebar">
      <span>{state.title}</span>
      <span className="lyra-agent-plan-board-titlebar-meta">
        {state.mode === "detail" ? plan?.phase : labels.manager}
      </span>
    </div>
  ), [labels.manager, plan?.phase, state.mode, state.title]);
  useWorkbenchTitlebarContribution({
    ariaLabel: state.title,
    content: titlebarContent
  });

  if (state.mode === "manager") {
    const selectedPlan = state.selectedPlan;
    return (
      <div className="lyra-agent-plan-board">
        <header className="lyra-agent-plan-board-header">
          <div>
            <p className="lyra-agent-plan-board-eyebrow">{labels.manager}</p>
            <h1>{labels.title}</h1>
          </div>
          <div className="lyra-agent-plan-board-meta">
            <span>{state.workingDir}</span>
            {state.loading ? <span>{labels.loading}</span> : null}
          </div>
        </header>
        {state.error !== null ? (
          <div className="lyra-agent-plan-board-error">{state.error}</div>
        ) : null}
        <main className="lyra-agent-plan-board-manager">
          <aside className="lyra-agent-plan-board-manager-sidebar">
            <div className="lyra-agent-plan-board-manager-toolbar">
              <h2>{labels.manager}</h2>
              <button
                type="button"
                className="lyra-agent-plan-board-manager-icon-btn"
                disabled={state.loading || onRefreshManager === undefined}
                title={labels.refresh}
                aria-label={labels.refresh}
                onClick={() => { void onRefreshManager?.(); }}
              >
                <RefreshCw size={13} />
              </button>
            </div>
            <PlanManagerList
              labels={labels}
              plans={state.plans}
              selectedPlanId={selectedPlan?.activePlanId ?? null}
              loading={state.loading}
              onOpenPlan={onOpenManagedPlan}
              onDeletePlan={confirmDeleteManagedPlan}
            />
          </aside>
          <section className="lyra-agent-plan-board-manager-detail">
            {selectedPlan === null ? (
              <p className="lyra-agent-plan-board-empty">{labels.noPlans}</p>
            ) : (
              <div className="lyra-agent-plan-board-manager-detail-inner">
                <button
                  type="button"
                  className="lyra-agent-plan-board-manager-back"
                  disabled={state.loading || onRefreshManager === undefined}
                  onClick={() => { void onRefreshManager?.(); }}
                >
                  <RefreshCw size={13} />
                  {labels.refresh}
                </button>
                <PlanTodoDetail
                  labels={labels}
                  plan={selectedPlan}
                  todo={state.selectedProjectTodo}
                  view={state.view}
                  onRevisePlan={onRevisePlan}
                  onResumePlan={resumePlan}
                />
              </div>
            )}
          </section>
        </main>
        {selectedPlan === null || state.view === "todo" ? null : (
          <PlanTempChat
            labels={labels}
            parentSessionId={state.agentSessionId}
            plan={selectedPlan}
            desktopApi={desktopApi}
            onApplyRevision={onRevisePlan}
          />
        )}
      </div>
    );
  }

  return (
    <div className="lyra-agent-plan-board">
      <PlanTodoDetail
        labels={labels}
        plan={state.plan}
        todo={state.projectTodo}
        onRevisePlan={onRevisePlan}
        onResumePlan={resumePlan}
      />
      <PlanTempChat
        labels={labels}
        parentSessionId={state.agentSessionId}
        plan={state.plan}
        desktopApi={desktopApi}
        onApplyRevision={onRevisePlan}
      />
    </div>
  );
};
