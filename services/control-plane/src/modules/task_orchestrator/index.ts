import type { TaskIntent } from "../../contracts/task";

export const createTaskPlan = (intent: TaskIntent): string[] => {
  return [
    `collect-context:${intent.id}`,
    `execute-tools:${intent.id}`,
    `summarize:${intent.id}`
  ];
};
