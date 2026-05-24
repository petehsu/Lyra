import { useEffect, useRef } from "react";

import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { GlobalDialogModel } from "../global-dialog";
import type { WorkbenchNotificationModel } from "../notifications";
import type { WorkbenchLabels } from "./use-workbench-labels";

type UseWorkbenchLinuxCompatNoticeParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: WorkbenchLabels;
  readonly openDialog: GlobalDialogModel["openDialog"];
  readonly publishNotification: WorkbenchNotificationModel["publishNotification"];
};

export const useWorkbenchLinuxCompatNotice = ({
  desktopApi,
  labels,
  openDialog,
  publishNotification
}: UseWorkbenchLinuxCompatNoticeParams): void => {
  const shownNoticeKeys = useRef(new Set<string>());

  useEffect(() => {
    const linuxCompat = desktopApi?.linuxCompat;
    if (linuxCompat === undefined) {
      return;
    }
    let cancelled = false;
    void linuxCompat.readStatus()
      .then((status) => {
        if (
          cancelled ||
          status.platform !== "linux" ||
          status.enabled === false ||
          (status.recovery.active === false && status.recovery.previousFailureReason === null)
        ) {
          return;
        }
        const noticeKey = `${status.recovery.launchId}-${status.recovery.previousFailureReason ?? "recovery"}`;
        if (shownNoticeKeys.current.has(noticeKey)) {
          return;
        }
        shownNoticeKeys.current.add(noticeKey);
        const preview = status.recovery.previousFailureReason ?? `${status.profile} · ${status.backend} · ${status.gpuMode}`;
        publishNotification({
          title: labels.settingsSurface.linuxCompatRecoveryTitle,
          preview,
          body: labels.settingsSurface.linuxCompatRecoveryDescription,
          level: "warning",
          source: {
            id: "linux-compat",
            title: labels.settingsSurface.linuxCategoryLabel,
            iconKey: "system"
          },
          target: { kind: "none" }
        });
        openDialog({
          title: labels.settingsSurface.linuxCompatRecoveryTitle,
          description: labels.settingsSurface.linuxCompatRecoveryDescription,
          source: {
            title: labels.settingsSurface.linuxCategoryLabel,
            subtitle: preview,
            iconLabel: "L"
          },
          actions: [
            {
              id: "close",
              label: labels.settingsSurface.linuxCompatRestartDialogCancel
            }
          ]
        });
      })
      .catch((error: unknown) => {
        console.warn(`[lyra-linux] recovery notice read failed ${String(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [
    desktopApi?.linuxCompat,
    labels.settingsSurface,
    openDialog,
    publishNotification
  ]);
};
