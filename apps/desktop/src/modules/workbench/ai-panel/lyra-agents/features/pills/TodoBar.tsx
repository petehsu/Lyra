import { ListChecks } from "lucide-react";
import { AppButton } from "@renderer/ui/components";
import { t } from "@workbench/i18n";

export interface TodoItem {
  id: string;
  title: string;
  status: "pending" | "running" | "done";
}

/**
 * Fact-driven floating todo capsule, anchored top-left above the composer.
 *
 * It is purely a status + shortcut affordance: it shows `icon current|total`
 * (the current step number and the total) and opens the todo board on click.
 * Once every todo is done there is nothing left to track, so the capsule hides
 * itself — visibility is driven by the facts (incomplete work remaining), not
 * by a manual close. It is likewise hidden when there are no todos at all.
 */
export function TodoBar({
  tasks,
  onOpenBoard,
}: {
  tasks: TodoItem[];
  onOpenBoard?: () => void | Promise<void>;
}) {
  const total = tasks.length;
  const doneCount = tasks.filter((task) => task.status === "done").length;
  const hasIncomplete = doneCount < total;
  if (total === 0 || !hasIncomplete) return null;

  // Current step = the running task if one is active, otherwise the first
  // not-yet-done task (done count + 1), clamped to the total.
  const runningIndex = tasks.findIndex((task) => task.status === "running");
  const currentNumber = runningIndex >= 0 ? runningIndex + 1 : Math.min(total, doneCount + 1);

  const label = t("lyra-agents-composer.openTodoBoard");

  return (
    <AppButton
      type="button"
      variant="ghost"
      size="sm"
      className="lyra-agents-todo-capsule"
      onClick={() => { void onOpenBoard?.(); }}
      disabled={onOpenBoard === undefined}
      title={label}
      aria-label={label}
    >
      <ListChecks size={13} strokeWidth={2.2} />
      <span className="lyra-agents-todo-capsule-progress">
        {currentNumber}
        <span className="lyra-agents-todo-capsule-sep">|</span>
        {total}
      </span>
    </AppButton>
  );
}
