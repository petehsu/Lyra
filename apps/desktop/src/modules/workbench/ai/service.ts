import { create } from "zustand";

import type {
  AiActionEvent,
  AiPlanStep,
  AiThreadMessage,
  ApprovalItem,
  WorkbenchCommand
} from "../shell/types";
import type { AiStore } from "./types";

const createId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const createPlanFromCommand = (command: WorkbenchCommand): readonly AiPlanStep[] => [
  { id: createId("plan"), label: `理解目标：${command.kind}`, state: "done" },
  { id: createId("plan"), label: "采集上下文与依赖", state: "running" },
  { id: createId("plan"), label: "执行修改与验证", state: "todo" },
  { id: createId("plan"), label: "产出总结与回放", state: "todo" }
];

const now = (): string => new Date().toLocaleTimeString("zh-CN", { hour12: false });

const seedPlan: readonly AiPlanStep[] = [
  { id: "plan-1", label: "复现 checkout 500", state: "done" },
  { id: "plan-2", label: "定位错误映射", state: "running" },
  { id: "plan-3", label: "补测试并验证", state: "todo" },
  { id: "plan-4", label: "生成任务总结", state: "todo" }
];

const seedActions: readonly AiActionEvent[] = [
  { id: "action-1", action: "read_file src/checkout/service.ts", status: "success", timestamp: "09:41:12" },
  { id: "action-2", action: "run_command pnpm test:checkout", status: "running", timestamp: "09:41:17" },
  { id: "action-3", action: "browser_trace /checkout", status: "pending", timestamp: "09:41:20" }
];

const seedApprovals: readonly ApprovalItem[] = [
  { id: "approval-1", summary: "修改 v2ray 配置（高风险）", status: "pending" }
];

const seedThread: readonly AiThreadMessage[] = [
  { id: "msg-1", role: "assistant", content: "我已加载工作区上下文，可以直接给我目标。" },
  { id: "msg-2", role: "user", content: "先复现 checkout 500，再修复并补测试。" }
];

export const useAiStore = create<AiStore>()((set, get) => ({
  mode: "agent",
  plan: seedPlan,
  actions: seedActions,
  approvals: seedApprovals,
  thread: seedThread,
  setMode: (mode) => {
    set({ mode });
  },
  setPlan: (steps) => {
    set({ plan: steps });
  },
  pushAction: (event) => {
    const current = get();
    set({ actions: [event, ...current.actions].slice(0, 20) });
  },
  addThreadMessage: (message) => {
    const current = get();
    set({ thread: [...current.thread, message] });
  },
  requestApproval: (item) => {
    const current = get();
    set({ approvals: [item, ...current.approvals] });
  },
  setApprovalStatus: (approvalId, status) => {
    const current = get();
    const next = current.approvals.map((item) => {
      if (item.id === approvalId) {
        return { ...item, status };
      }
      return item;
    });
    set({ approvals: next });
  },
  clearActions: () => {
    set({ actions: [] });
  }
}));

export const createActionEvent = (action: string, status: AiActionEvent["status"]): AiActionEvent => ({
  id: createId("action"),
  action,
  status,
  timestamp: now()
});

export const createApprovalRequest = (summary: string): ApprovalItem => ({
  id: createId("approval"),
  summary,
  status: "pending"
});

export const createThreadMessage = (
  role: AiThreadMessage["role"],
  content: string
): AiThreadMessage => ({
  id: createId("msg"),
  role,
  content
});

export const createPlanStepsForCommand = (command: WorkbenchCommand): readonly AiPlanStep[] =>
  createPlanFromCommand(command);
