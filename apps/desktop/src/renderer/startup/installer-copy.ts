import type { ComponentSummary, ComponentUpdateChannel, ComponentUpdateProgress } from "../../shared/desktop-bridge";

export const INSTALLER_COMPLETE_KEY = "lyra.installer.complete.v1";
export const PROMO_MANIFEST_URL =
  "https://jhpeihmmxfcwwodngybw.supabase.co/storage/v1/object/public/installer/manifest.json";

export const IDLE_STATUS = [
  "Catalog URL is pinned in this build",
  "Trust roots are already in the installer",
  "Component payloads stay on HTTPS",
  "Interrupted downloads can resume later"
] as const;

const CATALOG_STATUS = [
  "Fetching the signed release catalog",
  "Authenticating the catalog signature",
  "Reading the channel sequence number"
] as const;

const BOM_STATUS = [
  "Loading the bill of materials",
  "Verifying the BOM signature",
  "Selecting the exact component set"
] as const;

const DOWNLOAD_WAIT_STATUS = [
  "Opening the component download session",
  "Waiting for the first payload bytes",
  "Keeping the TLS session warm"
] as const;

const VERIFY_STATUS = [
  "Checking the SHA-256 digest",
  "Verifying the component signature",
  "Rejecting anything that does not match"
] as const;

const INSTALL_STATUS = [
  "Staging files into a temporary tree",
  "Activating the verified payload",
  "Keeping this running Core in place"
] as const;

const STOPPING_STATUS = [
  "Stopping the install process",
  "Waiting for open files to close",
  "Preparing to discard incomplete files"
] as const;

const CLEANUP_STATUS = [
  "Removing staged component files",
  "Deleting the download cache",
  "Clearing leftover receipts",
  "Discarding incomplete registry state",
  "Sweeping temporary staging trees"
] as const;

export const COMPLETE_STATUS = "Lyra is ready";
export const FAILED_STATUS = "Install did not finish";
export const ROTATE_MS = 1_200;

export const hasCompletedInstaller = (): boolean =>
  typeof window !== "undefined" && window.localStorage.getItem(INSTALLER_COMPLETE_KEY) === "1";

export const markInstallerComplete = (): void => {
  window.localStorage.setItem(INSTALLER_COMPLETE_KEY, "1");
};

export const shouldRunInstaller = (input: {
  readonly isPackaged: boolean;
  readonly force: boolean;
  readonly hasCompletedMarker: boolean;
  readonly hasInstalledRelease: boolean;
}): boolean => {
  if (input.force) {
    return true;
  }
  if (input.hasCompletedMarker || input.hasInstalledRelease) {
    return false;
  }
  return input.isPackaged;
};

export const hasInstalledRelease = (components: readonly ComponentSummary[]): boolean =>
  components.some((component) => typeof component.active === "string" && component.active.length > 0);

export const resolveInstallerChannel = (version: string): ComponentUpdateChannel =>
  version.toLowerCase().includes("preview") ? "preview" : "stable";

export const readInstallerForceFromSearch = (search: string): boolean =>
  new URLSearchParams(search).get("installer") === "1";

export const statusPoolForProgress = (
  progress: ComponentUpdateProgress | null,
  running: boolean,
  failed: boolean,
  finished: boolean,
  cancelling = false
): readonly string[] => {
  if (failed) {
    return [FAILED_STATUS];
  }
  if (finished) {
    return [COMPLETE_STATUS];
  }
  if (cancelling) {
    if (progress?.phase === "cleanup" && progress.completed > 0) {
      return CLEANUP_STATUS;
    }
    return STOPPING_STATUS;
  }
  if (!running || progress === null) {
    return IDLE_STATUS;
  }
  switch (progress.phase) {
    case "catalog":
      return CATALOG_STATUS;
    case "bom":
      return BOM_STATUS;
    case "download":
      return downloadPool(progress.componentId);
    case "verify":
      return VERIFY_STATUS;
    case "install":
      return INSTALL_STATUS;
    case "complete":
      return [COMPLETE_STATUS];
    case "cleanup":
      return CLEANUP_STATUS;
  }
};

export const progressFraction = (progress: ComponentUpdateProgress | null): number => {
  if (progress === null || progress.total <= 0) {
    return 0;
  }
  return Math.min(1, progress.completed / progress.total);
};

export const isIndeterminateProgress = (
  running: boolean,
  progress: ComponentUpdateProgress | null
): boolean => running && (progress === null || progress.total <= 0);

export const formatSpeedBps = (bps: number): string => {
  if (!Number.isFinite(bps) || bps < 1) {
    return "";
  }
  if (bps < 1024) {
    return `${Math.round(bps)} B/s`;
  }
  const kib = bps / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KB/s`;
  }
  return `${(kib / 1024).toFixed(1)} MB/s`;
};

export const formatPercent = (fraction: number): string => {
  if (!Number.isFinite(fraction)) {
    return "";
  }
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
};

export const elideInstallPath = (value: string, maxChars: number): string => {
  const chars = Array.from(value);
  if (chars.length <= maxChars) {
    return value;
  }
  if (maxChars <= 8) {
    return chars.slice(0, maxChars).join("");
  }
  const keepEnd = Math.max(4, Math.floor(maxChars / 2) - 1);
  const keepStart = Math.max(0, maxChars - keepEnd - 1);
  return `${chars.slice(0, keepStart).join("")}…${chars.slice(-keepEnd).join("")}`;
};

export const parsePromoVideoUrl = (value: unknown): string => {
  if (typeof value !== "object" || value === null) {
    throw new Error("promo manifest is invalid");
  }
  const videoUrl = "videoUrl" in value ? value.videoUrl : undefined;
  if (typeof videoUrl !== "string" || videoUrl.trim().length === 0) {
    throw new Error("promo videoUrl is empty");
  }
  const url = new URL(videoUrl);
  if (url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0) {
    throw new Error("promo videoUrl must be credential-free HTTPS");
  }
  return url.toString();
};

export class SpeedEstimator {
  private lastCompleted = 0;
  private lastMs: number | null = null;
  private ema = 0;

  update(completed: number, nowMs: number): number {
    if (this.lastMs === null) {
      this.lastCompleted = completed;
      this.lastMs = nowMs;
      return 0;
    }
    const dtMs = nowMs - this.lastMs;
    if (dtMs >= 80 && completed >= this.lastCompleted) {
      const inst = (completed - this.lastCompleted) / (dtMs / 1000);
      this.ema = this.ema <= 0 ? inst : this.ema * 0.72 + inst * 0.28;
      this.lastCompleted = completed;
      this.lastMs = nowMs;
    }
    return this.ema;
  }
}

const downloadPool = (componentId: string | undefined): readonly string[] => {
  const component = componentId?.trim();
  if (component === undefined || component.length === 0) {
    return DOWNLOAD_WAIT_STATUS;
  }
  return [
    `Downloading ${component}`,
    `Resuming ${component} from checkpoint`,
    `Writing ${component} into staging`
  ];
};
