import { isPublicHttpsUrl } from "./https";
import type { NotificationSourceIconKey } from "./icons";
import type {
  NotificationBodyKind,
  NotificationItem,
  NotificationSnapshot,
  NotificationTarget
} from "./types";

export type { NotificationSnapshot };

const SOURCE_ICON_KEYS = new Set<NotificationSourceIconKey>([
  "file-manager",
  "file-editor",
  "browser",
  "terminal",
  "system",
  "notification"
]);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const parseTarget = (value: unknown): NotificationTarget => {
  if (!isRecord(value) || value.kind === "none") return { kind: "none" };
  if (value.kind === "page-tab") {
    const address = stringValue(value.address);
    if (address !== undefined) {
      const title = stringValue(value.title);
      return { kind: "page-tab", address, ...(title === undefined ? {} : { title }) };
    }
  }
  if (value.kind === "app-tab") {
    const appId = stringValue(value.appId);
    const appInstanceId = stringValue(value.appInstanceId);
    if (appId !== undefined && appInstanceId !== undefined) {
      const title = stringValue(value.title);
      const iconKey = stringValue(value.iconKey);
      const filePath = stringValue(value.filePath);
      return {
        kind: "app-tab", appId, appInstanceId,
        ...(title === undefined ? {} : { title }),
        ...(iconKey === undefined ? {} : { iconKey }),
        ...(filePath === undefined ? {} : { filePath })
      };
    }
  }
  return { kind: "none" };
};

const parseSourceIconKey = (value: unknown): NotificationSourceIconKey => {
  const iconKey = stringValue(value);
  return iconKey !== undefined && SOURCE_ICON_KEYS.has(iconKey as NotificationSourceIconKey)
    ? iconKey as NotificationSourceIconKey
    : "notification";
};

const parseBodyKind = (value: unknown): NotificationBodyKind | undefined => {
  const kind = stringValue(value);
  return kind === "plain" || kind === "markdown" || kind === "image" || kind === "page"
    ? kind
    : undefined;
};

export const parseNotificationSnapshot = (value: unknown): NotificationSnapshot => {
  if (!isRecord(value) || !Array.isArray(value.notifications)) {
    throw new Error("Core returned an invalid notification snapshot.");
  }
  const notifications = value.notifications.flatMap((entry): readonly NotificationItem[] => {
    if (!isRecord(entry)) return [];
    const id = stringValue(entry.id);
    const title = stringValue(entry.title);
    const preview = stringValue(entry.preview);
    const level = entry.level;
    const createdAt = entry.createdAt;
    if (
      id === undefined || title === undefined || preview === undefined
      || (level !== "info" && level !== "success" && level !== "warning" && level !== "error")
      || typeof createdAt !== "number" || !Number.isFinite(createdAt)
    ) return [];
    const source = isRecord(entry.source) ? entry.source : {};
    const body = stringValue(entry.body);
    const bodyKind = parseBodyKind(entry.bodyKind);
    const imageUrlRaw = stringValue(entry.imageUrl);
    const imageUrl = imageUrlRaw !== undefined && isPublicHttpsUrl(imageUrlRaw)
      ? imageUrlRaw
      : undefined;
    const readAt = typeof entry.readAt === "number" && Number.isFinite(entry.readAt)
      ? entry.readAt
      : undefined;
    return [{
      id, title, preview,
      ...(body === undefined ? {} : { body }),
      ...(bodyKind === undefined ? {} : { bodyKind }),
      ...(imageUrl === undefined ? {} : { imageUrl }),
      level,
      sourceTitle: stringValue(source.title) ?? "Lyra",
      sourceIconKey: parseSourceIconKey(source.iconKey),
      target: parseTarget(entry.target),
      createdAt,
      ...(readAt === undefined ? {} : { readAt })
    }];
  });
  return {
    notifications,
    selectedNotificationId: typeof value.selectedNotificationId === "string"
      ? value.selectedNotificationId : null,
    unreadCount: typeof value.unreadCount === "number"
      ? Math.max(0, Math.floor(value.unreadCount))
      : notifications.filter((item) => item.readAt === undefined).length
  };
};
