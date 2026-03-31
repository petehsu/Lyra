import type { FileManagerSurfaceLabels } from "./types";

type FileManagerNamedLocation = {
  readonly title: string;
  readonly specialId?: string;
};

export const createLocationPathKey = (
  path: string,
  platform: NodeJS.Platform | null
): string => {
  const normalized = path.replace(/\\/g, "/");
  if (platform === "win32" || platform === "darwin") {
    return normalized.toLowerCase();
  }
  return normalized;
};

export const isSameLocationPath = (
  leftPath: string | undefined,
  rightPath: string | undefined,
  platform: NodeJS.Platform | null
): boolean => {
  if (leftPath === undefined || rightPath === undefined) {
    return false;
  }

  return createLocationPathKey(leftPath, platform) === createLocationPathKey(rightPath, platform);
};

export const resolveLocationTitle = (
  location: FileManagerNamedLocation,
  labels: Pick<
    FileManagerSurfaceLabels,
    | "locationHome"
    | "locationDesktop"
    | "locationDocuments"
    | "locationDownloads"
    | "locationTrash"
  >
): string => {
  switch (location.specialId) {
    case "home":
      return labels.locationHome;
    case "desktop":
      return labels.locationDesktop;
    case "documents":
      return labels.locationDocuments;
    case "downloads":
      return labels.locationDownloads;
    case "trash":
      return labels.locationTrash;
    default:
      return location.title;
  }
};

export const withResolvedLocationTitle = <T extends FileManagerNamedLocation>(
  location: T,
  labels: Pick<
    FileManagerSurfaceLabels,
    | "locationHome"
    | "locationDesktop"
    | "locationDocuments"
    | "locationDownloads"
    | "locationTrash"
  >
): T => ({
  ...location,
  title: resolveLocationTitle(location, labels)
});
