export type ProductAnnouncementBodyKind = "plain" | "markdown" | "image" | "page";
export type ProductAnnouncementLevel = "info" | "success" | "warning" | "error";

export type ProductAnnouncement = {
  readonly id: string;
  readonly title: string;
  readonly preview: string;
  readonly body?: string;
  readonly bodyKind: ProductAnnouncementBodyKind;
  readonly pageUrl?: string;
  readonly imageUrl?: string;
  readonly level: ProductAnnouncementLevel;
  readonly locale?: string;
  readonly publishedAtMs: number;
};

const BODY_KINDS = new Set<ProductAnnouncementBodyKind>([
  "plain",
  "markdown",
  "image",
  "page"
]);

const LEVELS = new Set<ProductAnnouncementLevel>([
  "info",
  "success",
  "warning",
  "error"
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

const readString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const isPublicHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

const readHttpsUrl = (value: unknown): string | undefined => {
  const raw = readString(value);
  return raw !== undefined && isPublicHttpsUrl(raw) ? raw : undefined;
};

const readTimestampMs = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

export const parseProductAnnouncement = (value: unknown): ProductAnnouncement | null => {
  if (isRecord(value) === false) {
    return null;
  }

  const id = readString(value.id);
  const title = readString(value.title);
  const preview = readString(value.preview);
  const publishedAtMs = readTimestampMs(value.publishedAtMs)
    ?? readTimestampMs(value.published_at)
    ?? readTimestampMs(value.publishedAt);
  if (id === undefined || title === undefined || preview === undefined || publishedAtMs === undefined) {
    return null;
  }

  const bodyKindRaw = readString(value.bodyKind) ?? readString(value.body_kind) ?? "plain";
  const bodyKind = BODY_KINDS.has(bodyKindRaw as ProductAnnouncementBodyKind)
    ? bodyKindRaw as ProductAnnouncementBodyKind
    : "plain";
  const levelRaw = readString(value.level) ?? "info";
  const level = LEVELS.has(levelRaw as ProductAnnouncementLevel)
    ? levelRaw as ProductAnnouncementLevel
    : "info";
  const body = readString(value.body);
  const pageUrl = readHttpsUrl(value.pageUrl) ?? readHttpsUrl(value.page_url);
  const imageUrl = readHttpsUrl(value.imageUrl) ?? readHttpsUrl(value.image_url);
  const locale = readString(value.locale);

  return {
    id,
    title,
    preview,
    ...(body === undefined ? {} : { body }),
    bodyKind,
    ...(pageUrl === undefined ? {} : { pageUrl }),
    ...(imageUrl === undefined ? {} : { imageUrl }),
    level,
    ...(locale === undefined ? {} : { locale }),
    publishedAtMs
  };
};

export const parseProductAnnouncementList = (
  value: unknown
): readonly ProductAnnouncement[] => {
  if (Array.isArray(value) === false) {
    return [];
  }
  return value.flatMap((entry) => {
    const parsed = parseProductAnnouncement(entry);
    return parsed === null ? [] : [parsed];
  });
};
