import { useMemo, useState } from "react";
import { Check, CheckCircle2, Clock3, HelpCircle, MessageSquare, Pencil, X, XCircle } from "lucide-react";

import type { AgentPlanAnnotation, AgentTodoItem } from "../../../shared/agent";
import { useWorkbenchTitlebarContribution } from "../shell/titlebar-context";
import type { AgentPlanBoardSurfaceProps } from "./types";

type MarkdownBlock =
  | {
      readonly kind: "heading";
      readonly level: number;
      readonly text: string;
      readonly key: string;
      readonly lineIndex: number;
      readonly prefix: string;
    }
  | {
      readonly kind: "list";
      readonly text: string;
      readonly taskState: "todo" | "done" | null;
      readonly key: string;
      readonly lineIndex: number;
      readonly prefix: string;
    }
  | {
      readonly kind: "code";
      readonly text: string;
      readonly key: string;
    }
  | {
      readonly kind: "paragraph";
      readonly text: string;
      readonly key: string;
      readonly lineIndex: number;
      readonly prefix: string;
    };

type EditableMarkdownBlock = Extract<MarkdownBlock, { readonly lineIndex: number }>;

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

const editableLineId = (lineIndex: number): string => `line-${lineIndex + 1}`;

const splitMarkdownLines = (markdown: string): string[] =>
  markdown.replace(/\r\n?/gu, "\n").split("\n");

const replaceMarkdownLine = (
  markdown: string,
  block: EditableMarkdownBlock,
  text: string
): string => {
  const lines = splitMarkdownLines(markdown);
  const nextText = text.trim();
  lines[block.lineIndex] = block.prefix.length > 0 ? `${block.prefix}${nextText}` : nextText;
  return lines.join("\n");
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

const parseMarkdownBlocks = (markdown: string): MarkdownBlock[] => {
  const lines = splitMarkdownLines(markdown);
  const blocks: MarkdownBlock[] = [];
  let codeLines: string[] = [];
  let codeStart = -1;
  let inCode = false;

  const flushCode = (index: number): void => {
    if (codeLines.length === 0) return;
    blocks.push({
      kind: "code",
      text: codeLines.join("\n"),
      key: `code-${codeStart}-${index}`
    });
    codeLines = [];
    codeStart = -1;
  };

  lines.forEach((line, index) => {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        flushCode(index);
        inCode = false;
      } else {
        inCode = true;
        codeStart = index;
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    const heading = line.match(/^(\s*#{1,4}\s+)(.+)$/u);
    if (heading !== null) {
      const prefix = heading[1] ?? "";
      blocks.push({
        kind: "heading",
        level: prefix.trim().length,
        text: (heading[2] ?? "").trim(),
        key: `heading-${index}`,
        lineIndex: index,
        prefix
      });
      return;
    }
    const task = line.match(/^(\s*[-*]\s+\[( |x|X)\]\s+)(.+)$/u);
    if (task !== null) {
      blocks.push({
        kind: "list",
        taskState: (task[2] ?? "").toLowerCase() === "x" ? "done" : "todo",
        text: (task[3] ?? "").trim(),
        key: `task-${index}`,
        lineIndex: index,
        prefix: task[1] ?? ""
      });
      return;
    }
    const list = line.match(/^(\s*(?:[-*]|\d+\.)\s+)(.+)$/u);
    if (list !== null) {
      blocks.push({
        kind: "list",
        taskState: null,
        text: (list[2] ?? "").trim(),
        key: `list-${index}`,
        lineIndex: index,
        prefix: list[1] ?? ""
      });
      return;
    }
    const paragraph = line.match(/^(\s*)(.+)$/u);
    blocks.push({
      kind: "paragraph",
      text: (paragraph?.[2] ?? trimmed).trim(),
      key: `paragraph-${index}`,
      lineIndex: index,
      prefix: paragraph?.[1] ?? ""
    });
  });

  flushCode(lines.length);
  return blocks;
};

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
          return renderEditableShell(block, <Heading>{block.text}</Heading>);
        }
        if (block.kind === "list") {
          return renderEditableShell(
            block,
            <div className="lyra-agent-plan-board-list-row">
              <span className="lyra-agent-plan-board-list-marker">
                {block.taskState === "done" ? "✓" : block.taskState === "todo" ? "□" : "•"}
              </span>
              <span>{block.text}</span>
            </div>
          );
        }
        if (block.kind === "code") {
          return <pre key={block.key}>{block.text}</pre>;
        }
        return renderEditableShell(block, <p>{block.text}</p>);
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

export const AgentPlanBoardSurface = ({
  labels,
  state,
  onRevisePlan
}: AgentPlanBoardSurfaceProps) => {
  const plan = state.plan;
  const todo = state.projectTodo;
  const current = todo === null ? 0 : Math.min(todo.currentIndex + 1, todo.todos.length);
  const total = todo?.todos.length ?? 0;
  const titlebarContent = useMemo(() => (
    <div className="lyra-agent-plan-board-titlebar">
      <span>{state.title}</span>
      <span className="lyra-agent-plan-board-titlebar-meta">{plan.phase}</span>
    </div>
  ), [plan.phase, state.title]);
  useWorkbenchTitlebarContribution({
    ariaLabel: state.title,
    content: titlebarContent
  });

  return (
    <div className="lyra-agent-plan-board">
      <header className="lyra-agent-plan-board-header">
        <div>
          <p className="lyra-agent-plan-board-eyebrow">{labels.title}</p>
          <h1>{plan.title}</h1>
        </div>
        <div className="lyra-agent-plan-board-meta">
          <span>{labels.phase}: {plan.phase}</span>
          <span>{labels.version}: {plan.activeVersionId}</span>
          {todo !== null ? <span>{labels.currentStep}: {current}/{total}</span> : null}
        </div>
      </header>

      <main className={todo === null ? "lyra-agent-plan-board-main" : "lyra-agent-plan-board-main has-todo"}>
        {todo !== null ? (
          <aside className="lyra-agent-plan-board-todo">
            <h2>{labels.todo}</h2>
            <TodoList todos={todo.todos} currentIndex={todo.currentIndex} labels={labels} />
          </aside>
        ) : null}
        <section className="lyra-agent-plan-board-plan">
          <h2>{labels.plan}</h2>
          <MarkdownPreview
            labels={labels}
            markdown={plan.markdown}
            annotations={plan.annotations}
            onRevise={onRevisePlan}
          />
        </section>
      </main>
    </div>
  );
};
