import type { WorkbenchFeedbackEvent } from "../feedback";

import type { WorkbenchNotificationPublishRequest } from "./types";

const titleByCode: Partial<Record<WorkbenchFeedbackEvent["code"], string>> = {
  "workbench.info": "工作台通知",
  "workbench.warning": "工作台警告",
  "workbench.error": "工作台错误"
};

const previewByCode: Partial<Record<WorkbenchFeedbackEvent["code"], string>> = {
  "workbench.info": "收到新的工作台信息。",
  "workbench.warning": "收到新的工作台警告。",
  "workbench.error": "收到新的工作台错误。"
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
      id: "workbench",
      title: "Workbench",
      iconKey: "notification"
    },
    target: { kind: "none" },
    createdAt: event.createdAt
  };
};
