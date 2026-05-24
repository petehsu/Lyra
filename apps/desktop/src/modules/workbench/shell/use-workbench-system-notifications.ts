import { useCallback, useEffect } from "react";

import type {
  LyraDesktopApi,
  SystemNotificationAction
} from "../../../shared/desktop-bridge";
import type { createTranslator } from "../i18n";
import type {
  WorkbenchNotificationItem,
  WorkbenchNotificationModel,
  WorkbenchNotificationPublishRequest
} from "../notifications";
import type { WorkbenchPreferences } from "../preferences";
import type { WorkbenchPreferencesModel } from "../preferences";

type UseWorkbenchSystemNotificationPublisherParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly notificationModel: WorkbenchNotificationModel;
  readonly preferences: Pick<
    WorkbenchPreferences,
    | "systemNotificationActionsEnabled"
    | "systemNotificationClickBehavior"
    | "systemNotificationMode"
  >;
  readonly t: ReturnType<typeof createTranslator>;
};

type UseWorkbenchSystemNotificationActivationParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly notificationModel: WorkbenchNotificationModel;
  readonly onOpenNotificationCenter: () => void;
  readonly onOpenNotificationSource: (notificationId: string) => void;
};

type UseWorkbenchSystemNotificationPermissionGuardParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly preferencesModel: WorkbenchPreferencesModel;
};

const createSystemNotificationActions = (
  notification: WorkbenchNotificationItem,
  t: ReturnType<typeof createTranslator>
): readonly SystemNotificationAction[] => {
  const actions: SystemNotificationAction[] = [];
  if (notification.target.kind !== "none") {
    actions.push({
      id: "open-source",
      title: t("settings.systemNotificationActionOpenSource")
    });
  }
  actions.push({
    id: "open-center",
    title: t("settings.systemNotificationActionOpenCenter")
  });
  actions.push({
    id: "mark-read",
    title: t("settings.systemNotificationActionMarkRead")
  });
  return actions;
};

export const useWorkbenchSystemNotificationPublisher = ({
  desktopApi,
  notificationModel,
  preferences,
  t
}: UseWorkbenchSystemNotificationPublisherParams): WorkbenchNotificationModel["publishNotification"] =>
  useCallback((request: WorkbenchNotificationPublishRequest) => {
    const notification = notificationModel.publishNotification(request);
    if (request.previewBehavior === "silent") {
      return notification;
    }

    const systemNotifications = desktopApi?.systemNotifications;
    if (systemNotifications === undefined) {
      return notification;
    }

    void systemNotifications.show({
      id: notification.id,
      title: notification.title,
      body: notification.body ?? notification.preview,
      sourceTitle: notification.source.title,
      level: notification.level,
      mode: preferences.systemNotificationMode,
      clickBehavior: preferences.systemNotificationClickBehavior,
      actionsEnabled: preferences.systemNotificationActionsEnabled,
      actions: createSystemNotificationActions(notification, t)
    }).catch((error: unknown) => {
      console.warn(`[lyra-system-notifications] show failed ${String(error)}`);
    });

    return notification;
  }, [
    desktopApi?.systemNotifications,
    notificationModel.publishNotification,
    preferences.systemNotificationActionsEnabled,
    preferences.systemNotificationClickBehavior,
    preferences.systemNotificationMode,
    t
  ]);

export const useWorkbenchSystemNotificationActivation = ({
  desktopApi,
  notificationModel,
  onOpenNotificationCenter,
  onOpenNotificationSource
}: UseWorkbenchSystemNotificationActivationParams): void => {
  useEffect(() => {
    const unsubscribe = desktopApi?.systemNotifications?.onActivated((event) => {
      if (notificationModel.getNotification(event.notificationId) === null) {
        return;
      }
      if (event.actionId === "mark-read") {
        notificationModel.markNotificationRead(event.notificationId);
        return;
      }
      if (event.actionId === "open-source") {
        onOpenNotificationSource(event.notificationId);
        return;
      }
      notificationModel.selectNotification(event.notificationId);
      onOpenNotificationCenter();
    });
    return () => {
      unsubscribe?.();
    };
  }, [
    desktopApi?.systemNotifications,
    notificationModel.getNotification,
    notificationModel.markNotificationRead,
    notificationModel.selectNotification,
    onOpenNotificationCenter,
    onOpenNotificationSource
  ]);
};

export const useWorkbenchSystemNotificationPermissionGuard = ({
  desktopApi,
  preferencesModel
}: UseWorkbenchSystemNotificationPermissionGuardParams): void => {
  useEffect(() => {
    if (desktopApi?.systemNotifications === undefined) {
      return;
    }

    let cancelled = false;
    const syncPermissionState = (): void => {
      void desktopApi.systemNotifications?.readStatus()
        .then((status) => {
          if (cancelled || status.canNotify) {
            return;
          }
          if (preferencesModel.preferences.systemNotificationMode !== "off") {
            preferencesModel.setSystemNotificationMode("off");
          }
        })
        .catch((error: unknown) => {
          console.warn(`[lyra-system-notifications] status read failed ${String(error)}`);
        });
    };

    syncPermissionState();
    window.addEventListener("focus", syncPermissionState);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncPermissionState);
    };
  }, [
    desktopApi,
    preferencesModel,
    preferencesModel.preferences.systemNotificationMode
  ]);
};
