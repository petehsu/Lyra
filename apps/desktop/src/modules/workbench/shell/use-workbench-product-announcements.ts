import { useEffect, useRef } from "react";

import type { LyraDesktopApi, ProductAnnouncement } from "../../../shared/desktop-bridge";
import type { createTranslator } from "../i18n";
import type {
  WorkbenchNotificationItem,
  WorkbenchNotificationModel,
  WorkbenchNotificationPublishRequest
} from "../notifications";

export const OFFICIAL_NOTIFICATION_ID_PREFIX = "lyra-official-";

export const officialNotificationId = (announcementId: string): string =>
  `${OFFICIAL_NOTIFICATION_ID_PREFIX}${announcementId}`;

const matchesWorkbenchLocale = (
  announcement: ProductAnnouncement,
  locale: string
): boolean => {
  if (announcement.locale === undefined) {
    return true;
  }
  const wanted = announcement.locale.trim().toLowerCase();
  const current = locale.trim().toLowerCase();
  if (wanted === current) {
    return true;
  }
  return wanted.split("-")[0] === current.split("-")[0];
};

export const announcementToPublishRequest = (
  announcement: ProductAnnouncement,
  existing: { readonly readAt?: number } | undefined,
  sourceTitle: string,
  alreadyKnown: boolean
): WorkbenchNotificationPublishRequest => {
  const pageUrl = announcement.pageUrl;
  return {
    id: officialNotificationId(announcement.id),
    title: announcement.title,
    preview: announcement.preview,
    ...(announcement.body === undefined ? {} : { body: announcement.body }),
    bodyKind: announcement.bodyKind,
    ...(announcement.imageUrl === undefined ? {} : { imageUrl: announcement.imageUrl }),
    level: announcement.level,
    source: {
      id: "lyra-official",
      title: sourceTitle,
      iconKey: "system"
    },
    target: pageUrl === undefined
      ? { kind: "none" }
      : {
          kind: "page-tab",
          address: pageUrl,
          title: announcement.title
        },
    createdAt: announcement.publishedAtMs,
    ...(existing?.readAt === undefined ? {} : { readAt: existing.readAt }),
    previewBehavior: alreadyKnown ? "silent" : "show"
  };
};

export const officialNotificationUnchanged = (
  existing: WorkbenchNotificationItem,
  next: WorkbenchNotificationPublishRequest
): boolean => {
  const existingTarget = existing.target;
  const nextTarget = next.target;
  const sameTarget = (
    existingTarget.kind === "none" && nextTarget.kind === "none"
  ) || (
    existingTarget.kind === "page-tab"
    && nextTarget.kind === "page-tab"
    && existingTarget.address === nextTarget.address
  );
  return existing.title === next.title
    && existing.preview === next.preview
    && existing.body === next.body
    && existing.bodyKind === next.bodyKind
    && existing.imageUrl === next.imageUrl
    && existing.level === next.level
    && existing.createdAt === next.createdAt
    && existing.source.id === next.source.id
    && sameTarget;
};

type UseWorkbenchProductAnnouncementsParams = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly notificationModel: WorkbenchNotificationModel;
  readonly locale: string;
  readonly t: ReturnType<typeof createTranslator>;
};

export const useWorkbenchProductAnnouncements = ({
  desktopApi,
  notificationModel,
  locale,
  t
}: UseWorkbenchProductAnnouncementsParams): void => {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const readAtRef = useRef<Map<string, number>>(new Map());
  const notificationModelRef = useRef(notificationModel);
  notificationModelRef.current = notificationModel;

  useEffect(() => {
    const api = desktopApi?.productAnnouncements;
    if (api === undefined) {
      return undefined;
    }

    const ingest = (items: readonly ProductAnnouncement[]): void => {
      const model = notificationModelRef.current;
      const sourceTitle = t("notification.officialSource");
      for (const item of model.notifications) {
        if (item.id.startsWith(OFFICIAL_NOTIFICATION_ID_PREFIX) === false) {
          continue;
        }
        seenIdsRef.current.add(item.id);
        if (item.readAt !== undefined) {
          readAtRef.current.set(item.id, item.readAt);
        }
      }
      for (const announcement of items) {
        if (matchesWorkbenchLocale(announcement, locale) === false) {
          continue;
        }
        const id = officialNotificationId(announcement.id);
        const storedReadAt = readAtRef.current.get(id);
        const existing = model.getNotification(id)
          ?? (storedReadAt === undefined ? undefined : { readAt: storedReadAt });
        const alreadyKnown = seenIdsRef.current.has(id);
        seenIdsRef.current.add(id);
        const request = announcementToPublishRequest(
          announcement,
          existing,
          sourceTitle,
          alreadyKnown
        );
        const current = model.getNotification(id);
        if (current !== null && officialNotificationUnchanged(current, request)) {
          continue;
        }
        if (request.readAt !== undefined) {
          readAtRef.current.set(id, request.readAt);
        }
        model.publishNotification(request);
      }
    };

    void api.read().then(ingest).catch((error: unknown) => {
      console.warn(`[lyra-announcements] failed to read product announcements: ${String(error)}`);
    });
    return api.onChanged(ingest);
  }, [desktopApi?.productAnnouncements, locale, t]);
};
