import { useEffect, useRef } from "react";

import type { LyraDesktopApi, LyraSensitiveStorageStatus } from "../../../shared/desktop-bridge";
import type { createTranslator } from "../i18n";
import type { WorkbenchNotificationModel } from "../notifications";

export const useWorkbenchCredentialStorageNotifications = ({
  desktopApi,
  publishNotification,
  t
}: {
  readonly desktopApi: LyraDesktopApi | null;
  readonly publishNotification: WorkbenchNotificationModel["publishNotification"];
  readonly t: ReturnType<typeof createTranslator>;
}): void => {
  const lastIssue = useRef<string | undefined>(undefined);
  useEffect(() => {
    const api = desktopApi?.sensitiveValues;
    if (api?.readStatus === undefined) return;
    let cancelled = false;
    let receivedEvent = false;
    const receive = (status: LyraSensitiveStorageStatus): void => {
      if (cancelled) return;
      const issue = status.issue ?? (status.available ? undefined : "unavailable");
      if (issue === lastIssue.current) return;
      const previousIssue = lastIssue.current;
      lastIssue.current = issue;
      // Opening another valid credential does not prove a failed credential
      // has recovered. Only report restoration of the storage service itself.
      if (issue === undefined && previousIssue !== "unavailable") return;
      const title = t(issue === undefined ? "notification.credentialStorageRestoredTitle"
        : issue === "decryption-failed" ? "notification.credentialStorageDecryptFailedTitle"
          : "notification.credentialStorageUnavailableTitle");
      const body = t(issue === undefined ? "notification.credentialStorageRestoredBody"
        : issue === "decryption-failed" ? "notification.credentialStorageDecryptFailedBody"
          : status.backend === "keychain" || status.backend === "dpapi"
            ? "notification.credentialStorageUnavailableBody"
            : "notification.credentialStorageUnavailableLinuxBody");
      publishNotification({
        id: "credential-storage-status",
        title, preview: body, body,
        level: issue === undefined ? "success" : "error",
        source: { id: "credential-storage", title: t("notification.credentialStorageSource"), iconKey: "system" },
        target: { kind: "none" }
      });
    };
    const unsubscribe = api.onStatusChanged?.((status) => {
      receivedEvent = true;
      receive(status);
    });
    void api.readStatus().then((status) => {
      if (!receivedEvent) receive(status);
    }).catch(() => {
      // An unavailable IPC bridge is not evidence of a keyring failure.
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [desktopApi?.sensitiveValues, publishNotification, t]);
};
