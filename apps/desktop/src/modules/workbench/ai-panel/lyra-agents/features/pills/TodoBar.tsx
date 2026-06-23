import { useState, type CSSProperties } from "react";
import { ListChecks, Play } from "lucide-react";
import { t } from "../../core/i18n";
import { AppButton } from "@renderer/ui/components";

export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "running" | "done";
}

/**
 * Floating Todo pill that expands in-place using CSS grid animation.
 * Collapsed: icon + "3/12" + current task name (lyra-agents-shimmer).
 * Expanded: same pill morphs taller to show the full scrollable list.
 */
export function TodoBar({
  tasks,
  onPoke,
  onOpenBoard,
  disabled = false,
}: {
  tasks: TodoItem[];
  onPoke?: () => void;
  onOpenBoard?: () => void | Promise<void>;
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
  const currentNumber = currentIndex >= 0
    ? currentIndex + 1
    : Math.min(total, doneCount + (hasIncomplete ? 1 : 0));

  return (
    <div className={`lyra-agents-todo-pill ${open ? "open" : ""}`}>
      <div className="lyra-agents-todo-pill-head">
        <AppButton variant="ghost" size="sm"
          type="button"
          className="lyra-agents-todo-pill-toggle"
          onClick={() => {
            if (onOpenBoard !== undefined) {
              void onOpenBoard();
              return;
            }
            setOpen((v) => !v);
          }}
          aria-expanded={open}
        >
          <ListChecks size={14} strokeWidth={2} />
          <span className="lyra-agents-todo-pill-progress">
            {currentNumber}/{total}
          </span>
          <span className="lyra-agents-todo-pill-current lyra-agents-shimmer">{currentTask.title}</span>
        </AppButton>
        <AppButton variant="ghost" size="sm"
          type="button"
          className="lyra-agents-todo-pill-poke"
          disabled={disabled || !hasIncomplete || onPoke === undefined}
          title={t("lyra-agents-composer.poke")}
          aria-label={t("lyra-agents-composer.poke")}
          onClick={() => onPoke?.()}
        >
          <Play size={12} strokeWidth={2.2} />
        </AppButton>
      </div>

      <div className="lyra-agents-todo-pill-collapse" data-open={open}>
        <div className="lyra-agents-todo-pill-collapse-inner">
          <div className="lyra-agents-todo-pill-body">
            <ul className="lyra-agents-todo-pill-list">
              {tasks.map((t, i) => {
                const isCurrent = t.status === "running";
                const isPending = t.status === "pending";
                const isDone = t.status === "done";
                return (
                  <li
                    key={t.id}
                    className={`lyra-agents-todo-pill-item ${isDone ? "done" : ""} ${isCurrent ? "current" : ""} ${isPending ? "pending" : ""}`}
                    style={{ "--stagger-index": i } as CSSProperties}
                  >
                    <span className="lyra-agents-todo-pill-index">{i + 1}</span>
                    <span className={`lyra-agents-todo-pill-title ${isCurrent ? "lyra-agents-shimmer" : ""}`}>
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
