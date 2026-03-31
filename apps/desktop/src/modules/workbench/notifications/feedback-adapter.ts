import type { WorkbenchFeedbackEvent } from "../feedback";

import type { WorkbenchNotificationPublishRequest } from "./types";

const titleByCode: Partial<Record<WorkbenchFeedbackEvent["code"], string>> = {
  "ai.runtime.approval.accepted": "AI 修改已同意",
  "ai.runtime.approval.rejected": "AI 修改已拒绝",
  "ai.runtime.approval.undo": "AI 修改已撤销",
  "ai.runtime.approval.accept_all": "AI 批量修改已同意",
  "ai.runtime.error": "AI 运行错误",
  "ai.runtime.permission_denied": "AI 权限被拒绝",
  "ai.runtime.timeout": "AI 执行超时"
};

const previewByCode: Partial<Record<WorkbenchFeedbackEvent["code"], string>> = {
  "ai.runtime.approval.accepted": "你已同意本次 AI 变更。",
  "ai.runtime.approval.rejected": "你已拒绝本次 AI 变更。",
  "ai.runtime.approval.undo": "你已撤销本次审批决定。",
  "ai.runtime.approval.accept_all": "你已同意当前全部待审批更改。",
  "ai.runtime.error": "AI 运行流程发生错误。",
  "ai.runtime.permission_denied": "AI 请求的能力被拒绝。",
  "ai.runtime.timeout": "AI 执行超时，请稍后重试。"
};

const resolveNotificationTitle = (event: WorkbenchFeedbackEvent): string =>
  titleByCode[event.code] ?? "Lyra 通知";

const resolveNotificationPreview = (event: WorkbenchFeedbackEvent): string => {
  const trimmed = event.message?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed;
  }
  return previewByCode[event.code] ?? "收到新的工作台反馈事件。";
};

const resolveNotificationBody = (event: WorkbenchFeedbackEvent): string | undefined => {
  const base = event.message?.trim();
  const hasMeta = event.meta !== undefined && Object.keys(event.meta).length > 0;
  if (base === undefined || base.length === 0) {
    if (hasMeta === false) {
      return undefined;
    }
    return JSON.stringify(event.meta, null, 2);
  }
  if (hasMeta === false) {
    return base;
  }
  return `${base}\n\n${JSON.stringify(event.meta, null, 2)}`;
};

export const mapFeedbackEventToNotification = (
  event: WorkbenchFeedbackEvent
): WorkbenchNotificationPublishRequest => {
  const body = resolveNotificationBody(event);
  return {
    id: `feedback-${event.id}`,
    title: resolveNotificationTitle(event),
    preview: resolveNotificationPreview(event),
    ...(body === undefined ? {} : { body }),
    level: event.level,
    source: {
      id: "ai-runtime",
      title: "AI Runtime",
      iconKey: "ai"
    },
    target:
      event.sessionId === undefined
        ? { kind: "none" }
        : {
            kind: "app-tab",
            appId: "ai-panel",
            appInstanceId: event.sessionId,
            title: "AI 面板",
            iconKey: "ai-panel-default"
          },
    createdAt: event.createdAt
  };
};
