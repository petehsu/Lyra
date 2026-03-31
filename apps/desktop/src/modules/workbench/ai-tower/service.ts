import type { AiActionEvent, AiPlanStep } from "../shell/types";

export const planStateLabel = (state: AiPlanStep["state"]): string => {
  if (state === "done") return "Done";
  if (state === "running") return "Running";
  return "Todo";
};

export const actionStatusLabel = (status: AiActionEvent["status"]): string => {
  if (status === "running") return "Running";
  if (status === "success") return "Success";
  if (status === "failed") return "Failed";
  return "Pending";
};
