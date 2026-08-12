import { useEffect, useRef } from "react";

import type { AppUpdateStatus, LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { createTranslator } from "../i18n";
import type { WorkbenchNotificationModel } from "../notifications";

type UseWorkbenchAppUpdateNotificationsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly publishNotification: WorkbenchNotificationModel["publishNotification"];
  readonly t: ReturnType<typeof createTranslator>;
};

export const useWorkbenchAppUpdateNotifications = ({
  desktopApi,
  publishNotification,
  t
}: UseWorkbenchAppUpdateNotificationsParams): void => {
  const notifiedVersionRef = useRef<string | null>(null);
  useEffect(() => {
    const appUpdate = desktopApi?.appUpdate;
    if (appUpdate === undefined) return undefined;
    const notifyIfAvailable = (status: AppUpdateStatus): void => {
      if (status.state !== "available" || status.availableVersion === undefined || notifiedVersionRef.current === status.availableVersion) {
        return;
      }
      notifiedVersionRef.current = status.availableVersion;
      publishNotification({
        id: `lyra-update-${status.availableVersion}`,
        title: t("softwareStore.appUpdateAvailableVersion"),
        preview: `${t("softwareStore.appUpdateAvailableVersion")}: ${status.availableVersion}`,
        body: status.releaseNotes ?? t("softwareStore.appUpdateDescription"),
        level: "info",
        source: { id: "lyra-updater", title: "Lyra", iconKey: "system" },
        target: { kind: "app-tab", appId: "software-store", appInstanceId: "software-store", title: t("softwareStore.title"), iconKey: "software-store-default" }
      });
    };
    void appUpdate.readStatus().then(notifyIfAvailable).catch((error: unknown) => {
      console.warn(`[lyra-updater] failed to read initial update status: ${String(error)}`);
    });
    return appUpdate.onStatusChanged(notifyIfAvailable);
  }, [desktopApi?.appUpdate, publishNotification, t]);
};
