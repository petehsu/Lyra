import { useEffect } from "react";

import type { AgentProviderFault, AgentRuntimeEvent } from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { createTranslator, I18nKey } from "../i18n";
import type {
  WorkbenchNotificationModel,
  WorkbenchNotificationPublishRequest
} from "../notifications";

type UseWorkbenchProviderFaultNotificationsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly notificationModel: WorkbenchNotificationModel;
  readonly publishNotification: WorkbenchNotificationModel["publishNotification"];
  readonly t: ReturnType<typeof createTranslator>;
};

const isProviderFaultTranslationKey = (value: string): value is I18nKey =>
  value.startsWith("notification.mimoFault");

const faultNotificationLevel = (
  fault: AgentProviderFault
): WorkbenchNotificationPublishRequest["level"] => {
  if (fault.category === "rate_limit") {
    return "warning";
  }
  if (fault.httpStatus === 402 || fault.httpStatus === 401 || fault.httpStatus === 403 || fault.httpStatus === 421) {
    return "error";
  }
  return "warning";
};

const buildProviderFaultNotification = (
  fault: AgentProviderFault,
  t: ReturnType<typeof createTranslator>
): WorkbenchNotificationPublishRequest => {
  const title = isProviderFaultTranslationKey(fault.titleKey)
    ? t(fault.titleKey)
    : fault.titleKey;
  const body = isProviderFaultTranslationKey(fault.bodyKey)
    ? t(fault.bodyKey)
    : fault.bodyKey;
  return {
    id: fault.dedupeKey,
    title,
    preview: body,
    body,
    level: faultNotificationLevel(fault),
    source: {
      id: "mimo-provider",
      title: "MiMo",
      iconKey: "system"
    },
    target: { kind: "none" }
  };
};

export const useWorkbenchProviderFaultNotifications = ({
  desktopApi,
  publishNotification,
  t
}: UseWorkbenchProviderFaultNotificationsParams): void => {
  useEffect(() => {
    const unsubscribe = desktopApi?.agent?.onEvent((event: AgentRuntimeEvent) => {
      if (event.kind !== "providerFault") {
        return;
      }
      publishNotification(buildProviderFaultNotification(event.fault, t));
    });
    return () => {
      unsubscribe?.();
    };
  }, [desktopApi?.agent, publishNotification, t]);
};