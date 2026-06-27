import { useEffect, useRef } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { DownloadManagerTask, DownloadManagerTaskState } from "../../../shared/download-manager";
import type { createTranslator } from "../i18n";
import type { WorkbenchNotificationModel } from "../notifications";

type UseDownloadNotificationsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly publishNotification: WorkbenchNotificationModel["publishNotification"];
  readonly t: ReturnType<typeof createTranslator>;
};

const DOWNLOAD_SOURCE = {
  id: "download-manager",
  iconKey: "file-manager" as const
};

export const useDownloadNotifications = ({
  desktopApi,
  publishNotification,
  t
}: UseDownloadNotificationsParams): void => {
  const previousStatesRef = useRef<Map<string, DownloadManagerTaskState>>(new Map());

  useEffect(() => {
    const downloadsApi = desktopApi?.downloads;
    if (downloadsApi === undefined) {
      return undefined;
    }

    const sourceTitle = t("downloads.notificationSource");

    const handleTask = (task: DownloadManagerTask): void => {
      const prev = previousStatesRef.current.get(task.id);

      if (task.state === "downloading" && prev !== "downloading") {
        publishNotification({
          id: `download-started-${task.id}`,
          title: t("downloads.startedTitle"),
          preview: `${task.fileName} — ${t("downloads.startedPreview")}`,
          level: "info",
          source: { ...DOWNLOAD_SOURCE, title: sourceTitle },
          target: { kind: "none" }
        });
      }

      if (task.state === "completed" && prev !== "completed") {
        publishNotification({
          id: `download-completed-${task.id}`,
          title: t("downloads.completedTitle"),
          preview: `${task.fileName} — ${t("downloads.completedPreview")}`,
          level: "success",
          source: { ...DOWNLOAD_SOURCE, title: sourceTitle },
          target: { kind: "none" }
        });
      }

      if (task.state === "failed" && prev !== "failed") {
        publishNotification({
          id: `download-failed-${task.id}`,
          title: t("downloads.failedTitle"),
          preview: `${task.fileName} — ${task.errorMessage ?? t("downloads.failedPreview")}`,
          level: "error",
          source: { ...DOWNLOAD_SOURCE, title: sourceTitle },
          target: { kind: "none" }
        });
      }

      previousStatesRef.current.set(task.id, task.state);
    };

    const unsubscribe = downloadsApi.onEvent((event) => {
      if (event.kind === "task-updated") {
        handleTask(event.task);
      }
      if (event.kind === "task-removed") {
        previousStatesRef.current.delete(event.taskId);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [desktopApi?.downloads, publishNotification, t]);
};