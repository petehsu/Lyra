import { useEffect, useRef } from "react";

import type { LspRuntimeEvent, LyraDesktopApi } from "../../../shared/desktop-bridge";
import type { createTranslator } from "../i18n";
import type { WorkbenchNotificationModel } from "../notifications";

type UseLspNotificationsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly publishNotification: WorkbenchNotificationModel["publishNotification"];
  readonly t: ReturnType<typeof createTranslator>;
};

const LSP_SOURCE = {
  id: "lsp",
  iconKey: "file-editor" as const
};

export const useLspNotifications = ({
  desktopApi,
  publishNotification,
  t
}: UseLspNotificationsParams): void => {
  const previousStatusRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const lspApi = desktopApi?.lsp;
    if (lspApi === undefined) {
      return undefined;
    }

    const sourceTitle = t("lsp.notificationSource");

    const publishAcquire = (event: LspRuntimeEvent): void => {
      const serverId = event.serverId ?? event.acquireId ?? "language-server";
      const status = event.status ?? "";
      const previous = previousStatusRef.current.get(serverId);
      previousStatusRef.current.set(serverId, status);
      const label = event.message ?? serverId;

      if ((status === "downloading" || status === "updating") && previous !== status) {
        const updating = status === "updating";
        publishNotification({
          id: `lsp-${status}-${serverId}`,
          title: t(updating ? "lsp.updatingTitle" : "lsp.startedTitle"),
          preview: `${label} — ${t(updating ? "lsp.updatingPreview" : "lsp.startedPreview")}`,
          level: "info",
          source: { ...LSP_SOURCE, title: sourceTitle },
          target: { kind: "none" }
        });
        return;
      }

      if (status === "completed" && previous !== "completed") {
        const updated = previous === "updating";
        publishNotification({
          id: `lsp-completed-${serverId}`,
          title: t(updated ? "lsp.updatedTitle" : "lsp.completedTitle"),
          preview: `${label} — ${t(updated ? "lsp.updatedPreview" : "lsp.completedPreview")}`,
          level: "success",
          source: { ...LSP_SOURCE, title: sourceTitle },
          target: { kind: "none" }
        });
        return;
      }

      if (status === "failed" && previous !== "failed") {
        publishNotification({
          id: `lsp-failed-${serverId}`,
          title: t("lsp.failedTitle"),
          preview: `${label} — ${event.message ?? t("lsp.failedPreview")}`,
          level: "error",
          source: { ...LSP_SOURCE, title: sourceTitle },
          target: { kind: "none" }
        });
      }
    };

    const unsubscribe = lspApi.onEvent((event) => {
      if (event.kind === "acquire") {
        publishAcquire(event);
        return;
      }
      if (event.kind === "diagnostics") {
        return;
      }
      if (event.kind !== "error" && event.kind !== "server-status") {
        return;
      }
      const serverId = event.serverId ?? event.languageId ?? "language-server";
      const status = event.status ?? event.kind;
      const previous = previousStatusRef.current.get(serverId);
      previousStatusRef.current.set(serverId, status);
      if (event.kind === "error" || status === "unavailable") {
        if (previous === "unavailable" || previous === "failed") {
          return;
        }
        publishNotification({
          id: `lsp-failed-${serverId}`,
          title: t("lsp.failedTitle"),
          preview: event.message ?? t("lsp.failedPreview"),
          level: "error",
          source: { ...LSP_SOURCE, title: sourceTitle },
          target: { kind: "none" }
        });
        return;
      }
      if (status === "workspace") {
        if (previous === "workspace") {
          return;
        }
        publishNotification({
          id: `lsp-workspace-${serverId}`,
          title: t("lsp.notificationSource"),
          preview: event.message ?? serverId,
          level: "warning",
          source: { ...LSP_SOURCE, title: sourceTitle },
          target: { kind: "none" }
        });
        return;
      }
      if (status === "ready" && previous !== "ready" && previous !== "completed") {
        publishNotification({
          id: `lsp-ready-${serverId}`,
          title: t("lsp.completedTitle"),
          preview: `${event.message ?? serverId} — ${t("lsp.completedPreview")}`,
          level: "success",
          source: { ...LSP_SOURCE, title: sourceTitle },
          target: { kind: "none" }
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [desktopApi?.lsp, publishNotification, t]);
};
