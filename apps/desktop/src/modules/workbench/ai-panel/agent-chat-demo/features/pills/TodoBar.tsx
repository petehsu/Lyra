import { useState, type CSSProperties } from "react";
import { ListChecks } from "lucide-react";

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
export function TodoBar({ tasks }: { tasks: TodoItem[] }) {
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

  return (
    <div className={`todo-pill ${open ? "open" : ""}`}>
      <button
        type="button"
        className="todo-pill-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ListChecks size={14} strokeWidth={2} />
        <span className="todo-pill-progress">
          {doneCount}/{total}
        </span>
        <span className="todo-pill-current shimmer">{currentTask.title}</span>
      </button>

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
