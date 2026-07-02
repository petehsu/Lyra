import type { TaskIntent } from "../../contracts/task.js";

export const createTaskPlan = (intent: TaskIntent): string[] => {
  return [
    `collect-context:${intent.id}`,
    `execute-tools:${intent.id}`,
    `summarize:${intent.id}`
  ];
};
