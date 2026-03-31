import type { FileManagerEntryIconKind } from "./entry-icon-classifier";

const FILE_MANAGER_ENTRY_DRAG_MIME = "application/x-lyra-file-manager-entry";

export type FileManagerEntryDragSource = "directory" | "trash";

export type FileManagerEntryDragPayload = {
  readonly name: string;
  readonly kind: "file" | "directory";
  readonly source: FileManagerEntryDragSource;
  readonly path?: string;
  readonly iconKind?: FileManagerEntryIconKind;
};

let activeFileManagerEntryDragPayload: FileManagerEntryDragPayload | null = null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizePath = (path: unknown): string | undefined => {
  if (typeof path !== "string") {
    return undefined;
  }
  const trimmed = path.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const normalizeIconKind = (iconKind: unknown): FileManagerEntryIconKind | undefined => {
  if (typeof iconKind !== "string") {
    return undefined;
  }
  const trimmed = iconKind.trim();
  return trimmed.length === 0 ? undefined : (trimmed as FileManagerEntryIconKind);
};

const isFileManagerEntryDragPayload = (
  value: unknown
): value is FileManagerEntryDragPayload => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const source = payload.source;
  const kind = payload.kind;

  if (source !== "directory" && source !== "trash") {
    return false;
  }

  if (kind !== "file" && kind !== "directory") {
    return false;
  }

  if (isNonEmptyString(payload.name) === false) {
    return false;
  }

  if (
    payload.path !== undefined &&
    (typeof payload.path !== "string" || payload.path.trim().length === 0)
  ) {
    return false;
  }

  if (
    payload.iconKind !== undefined &&
    (typeof payload.iconKind !== "string" || payload.iconKind.trim().length === 0)
  ) {
    return false;
  }

  return true;
};

const normalizePayload = (
  payload: FileManagerEntryDragPayload
): FileManagerEntryDragPayload | null => {
  const name = payload.name.trim();
  if (name.length === 0) {
    return null;
  }

  if (payload.kind !== "file" && payload.kind !== "directory") {
    return null;
  }

  if (payload.source !== "directory" && payload.source !== "trash") {
    return null;
  }

  const path = normalizePath(payload.path);
  const iconKind = normalizeIconKind(payload.iconKind);
  return {
    name,
    kind: payload.kind,
    source: payload.source,
    ...(path === undefined ? {} : { path }),
    ...(iconKind === undefined ? {} : { iconKind })
  };
};

export const writeFileManagerEntryDragPayload = (
  dataTransfer: DataTransfer,
  payload: FileManagerEntryDragPayload
): void => {
  const normalized = normalizePayload(payload);
  if (normalized === null) {
    return;
  }

  activeFileManagerEntryDragPayload = normalized;
  dataTransfer.setData(
    FILE_MANAGER_ENTRY_DRAG_MIME,
    JSON.stringify(normalized)
  );
  dataTransfer.setData("text/plain", normalized.path ?? normalized.name);
  dataTransfer.effectAllowed = "copy";
};

export const readFileManagerEntryDragPayload = (
  dataTransfer: DataTransfer
): FileManagerEntryDragPayload | null => {
  const raw = dataTransfer.getData(FILE_MANAGER_ENTRY_DRAG_MIME);
  if (raw.trim().length === 0) {
    return activeFileManagerEntryDragPayload;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isFileManagerEntryDragPayload(parsed) === false) {
      return null;
    }

    return normalizePayload(parsed);
  } catch (_error) {
    return null;
  }
};

export const hasFileManagerEntryDragPayload = (
  dataTransfer: DataTransfer
): boolean =>
  Array.from(dataTransfer.types).includes(FILE_MANAGER_ENTRY_DRAG_MIME) ||
  activeFileManagerEntryDragPayload !== null;

export const clearFileManagerEntryDragPayload = (): void => {
  activeFileManagerEntryDragPayload = null;
};
