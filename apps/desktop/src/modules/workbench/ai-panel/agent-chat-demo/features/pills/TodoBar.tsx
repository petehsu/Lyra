import { useState, type CSSProperties } from "react";
import { ListChecks, Play } from "lucide-react";
import { t } from "../../core/i18n";

export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "running" | "done";
}

/**
 * Floating Todo pill that expands in-place using CSS grid animation.
 * Collapsed: icon + "3/12" + current task name (shimmer).
 * Expanded: same pill morphs taller to show the full scrollable list.
 */
export function TodoBar({
  tasks,
  onPoke,
  disabled = false,
}: {
  tasks: TodoItem[];
  onPoke?: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (tasks.length === 0) return null;

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const total = tasks.length;
  const currentIndex = tasks.findIndex((t) => t.status === "running");
  const currentTask =
    currentIndex >= 0
      ? tasks[currentIndex]
      : tasks.find((t) => t.status !== "done") ?? tasks[tasks.length - 1];
  if (currentTask === undefined) return null;
  const hasIncomplete = tasks.some((task) => task.status !== "done");

  return (
    <div className={`todo-pill ${open ? "open" : ""}`}>
      <div className="todo-pill-head">
        <button
          type="button"
          className="todo-pill-toggle"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ListChecks size={14} strokeWidth={2} />
          <span className="todo-pill-progress">
            {doneCount}/{total}
          </span>
          <span className="todo-pill-current shimmer">{currentTask.title}</span>
        </button>
        <button
          type="button"
          className="todo-pill-poke"
          disabled={disabled || !hasIncomplete || onPoke === undefined}
          title={t("composer.poke")}
          aria-label={t("composer.poke")}
          onClick={() => onPoke?.()}
        >
          <Play size={12} strokeWidth={2.2} />
        </button>
      </div>

      <div className="todo-pill-collapse" data-open={open}>
        <div className="todo-pill-collapse-inner">
          <div className="todo-pill-body">
            <ul className="todo-pill-list">
              {tasks.map((t, i) => {
                const isCurrent = t.status === "running";
                const isPending = t.status === "pending";
                const isDone = t.status === "done";
                return (
                  <li
                    key={t.id}
                    className={`todo-pill-item ${isDone ? "done" : ""} ${isCurrent ? "current" : ""} ${isPending ? "pending" : ""}`}
                    style={{ "--stagger-index": i } as CSSProperties}
                  >
                    <span className="todo-pill-index">{i + 1}</span>
                    <span className={`todo-pill-title ${isCurrent ? "shimmer" : ""}`}>
                      {t.title}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
