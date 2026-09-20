import type {
  DeviceEntry,
  DiskEntry,
  DownloadTask,
  FavoriteEntry,
  FileEntry,
  FileLocation,
  FilesModuleState,
  HostInfo,
  TrashEntry
} from "./types";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const finiteNumber = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const parseLocation = (value: unknown): FileLocation | null => {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const title = stringValue(value.title);
  const kind = value.kind;
  if (
    id === undefined
    || title === undefined
    || (kind !== "home" && kind !== "directory" && kind !== "trash" && kind !== "special")
  ) {
    return null;
  }
  const path = stringValue(value.path);
  const specialId = stringValue(value.specialId);
  return {
    id,
    title,
    kind,
    ...(path === undefined ? {} : { path }),
    ...(specialId === undefined ? {} : { specialId })
  };
};

const parseLocations = (value: unknown): readonly FileLocation[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const location = parseLocation(item);
        return location === null ? [] : [location];
      })
    : [];

const parseEntries = (value: unknown): readonly FileEntry[] =>
  Array.isArray(value)
    ? value.flatMap((item): readonly FileEntry[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const name = stringValue(item.name);
        const path = stringValue(item.path);
        const kind = item.kind;
        if (
          id === undefined
          || name === undefined
          || path === undefined
          || (kind !== "file" && kind !== "directory")
        ) {
          return [];
        }
        const modifiedAt = stringValue(item.modifiedAt);
        return [{
          id,
          name,
          path,
          kind,
          ...(typeof item.sizeBytes === "number" ? { sizeBytes: finiteNumber(item.sizeBytes) } : {}),
          ...(modifiedAt === undefined ? {} : { modifiedAt })
        }];
      })
    : [];

const parseTrashEntries = (value: unknown): readonly TrashEntry[] =>
  Array.isArray(value)
    ? value.flatMap((item): readonly TrashEntry[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const name = stringValue(item.name);
        const kind = item.kind;
        if (id === undefined || name === undefined || (kind !== "file" && kind !== "directory")) {
          return [];
        }
        const originalPath = stringValue(item.originalPath);
        const deletedAt = stringValue(item.deletedAt);
        return [{
          id,
          name,
          kind,
          ...(originalPath === undefined ? {} : { originalPath }),
          ...(typeof item.sizeBytes === "number" ? { sizeBytes: finiteNumber(item.sizeBytes) } : {}),
          ...(deletedAt === undefined ? {} : { deletedAt })
        }];
      })
    : [];

const parseNamedPaths = (
  value: unknown
): readonly { readonly id: string; readonly title: string; readonly path: string }[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const title = stringValue(item.title);
        const path = stringValue(item.path);
        return id === undefined || title === undefined || path === undefined
          ? []
          : [{ id, title, path }];
      })
    : [];

const parseFavorites = (value: unknown): readonly FavoriteEntry[] =>
  Array.isArray(value)
    ? value.flatMap((item): readonly FavoriteEntry[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const title = stringValue(item.title);
        const path = stringValue(item.path);
        if (id === undefined || title === undefined || path === undefined) return [];
        const kind = item.kind === "web" || item.kind === "agent-session"
          ? item.kind
          : "path";
        const url = stringValue(item.url);
        const sessionId = stringValue(item.sessionId);
        const workingDir = stringValue(item.workingDir);
        return [{
          id,
          title,
          path,
          kind,
          ...(url === undefined ? {} : { url }),
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(workingDir === undefined ? {} : { workingDir })
        }];
      })
    : [];

const parseHostInfo = (value: unknown): HostInfo | undefined => {
  if (!isRecord(value)) return undefined;
  const name = stringValue(value.name);
  const osName = stringValue(value.osName);
  const architecture = stringValue(value.architecture);
  const cpuBrand = stringValue(value.cpuBrand);
  if (name === undefined || osName === undefined || architecture === undefined || cpuBrand === undefined) {
    return undefined;
  }
  return {
    name,
    osName,
    architecture,
    cpuBrand,
    memoryTotalBytes: finiteNumber(value.memoryTotalBytes),
    memoryUsedBytes: finiteNumber(value.memoryUsedBytes)
  };
};

const parseDisks = (value: unknown): readonly DiskEntry[] =>
  Array.isArray(value)
    ? value.flatMap((item): readonly DiskEntry[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const title = stringValue(item.title);
        const mountPath = stringValue(item.mountPath);
        if (id === undefined || title === undefined || mountPath === undefined) {
          return [];
        }
        const totalBytes = finiteNumber(item.totalBytes);
        const usedBytes = finiteNumber(item.usedBytes);
        const availableBytes = typeof item.availableBytes === "number"
          ? finiteNumber(item.availableBytes)
          : Math.max(0, totalBytes - usedBytes);
        return [{
          id,
          title,
          mountPath,
          kind: stringValue(item.kind) ?? "local",
          totalBytes,
          availableBytes,
          usedBytes,
          usageRatio: typeof item.usageRatio === "number"
            ? finiteNumber(item.usageRatio)
            : (totalBytes > 0 ? usedBytes / totalBytes : 0)
        }];
      })
    : [];

const parseDevices = (value: unknown): readonly DeviceEntry[] =>
  Array.isArray(value)
    ? value.flatMap((item): readonly DeviceEntry[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const title = stringValue(item.title);
        const devicePath = stringValue(item.devicePath);
        return id === undefined || title === undefined || devicePath === undefined
          ? []
          : [{ id, title, devicePath }];
      })
    : [];

const parseDownloadTasks = (value: unknown): readonly DownloadTask[] =>
  Array.isArray(value)
    ? value.flatMap((item): readonly DownloadTask[] => {
        if (!isRecord(item)) return [];
        const id = stringValue(item.id);
        const fileName = stringValue(item.fileName);
        const state = stringValue(item.state);
        if (id === undefined || fileName === undefined || state === undefined) return [];
        return [{
          id,
          fileName,
          state,
          receivedBytes: finiteNumber(item.receivedBytes),
          totalBytes: finiteNumber(item.totalBytes),
          speedBytesPerSecond: finiteNumber(item.speedBytesPerSecond)
        }];
      })
    : [];

export const parseFilesModuleState = (value: unknown): FilesModuleState | null => {
  if (value === null) return null;
  if (!isRecord(value)) {
    throw new Error("Core returned an invalid Files state.");
  }
  const instanceId = stringValue(value.instanceId);
  const title = stringValue(value.title);
  const status = value.status;
  const viewKind = value.viewKind;
  const presentationMode = value.presentationMode;
  if (
    instanceId === undefined
    || title === undefined
    || (status !== "idle" && status !== "loading" && status !== "ready" && status !== "error")
    || (viewKind !== "home" && viewKind !== "directory" && viewKind !== "trash" && viewKind !== "downloads")
    || (presentationMode !== "list" && presentationMode !== "large")
  ) {
    throw new Error("Core returned an invalid Files state.");
  }
  const parentPath = stringValue(value.parentPath);
  const selectedEntryId = stringValue(value.selectedEntryId);
  const selectedTrashEntryId = stringValue(value.selectedTrashEntryId);
  const errorMessage = stringValue(value.errorMessage);
  const hostInfo = parseHostInfo(value.hostInfo);
  return {
    instanceId,
    title,
    status,
    viewKind,
    presentationMode,
    currentLocation: parseLocation(value.currentLocation),
    ...(parentPath === undefined ? {} : { parentPath }),
    historyLength: Array.isArray(value.history) ? value.history.length : 0,
    historyIndex: finiteNumber(value.historyIndex, -1),
    systemLocations: parseLocations(value.systemLocations),
    favorites: parseFavorites(value.favorites),
    recentLocations: parseNamedPaths(value.recentLocations),
    ...(hostInfo === undefined ? {} : { hostInfo }),
    disks: parseDisks(value.disks),
    devices: parseDevices(value.devices),
    entries: parseEntries(value.entries),
    trashEntries: parseTrashEntries(value.trashEntries),
    downloadTasks: parseDownloadTasks(value.downloadTasks),
    ...(selectedEntryId === undefined ? {} : { selectedEntryId }),
    ...(selectedTrashEntryId === undefined ? {} : { selectedTrashEntryId }),
    ...(errorMessage === undefined ? {} : { errorMessage })
  };
};
