import { Store } from "lucide-react";

import type { BrowserSettingsCategoryId } from "../browser-tabs/settings-surface-types";
import type { WorkspaceAppTabOpenRequest } from "../workspace-tabs";
import type {
  SoftwareStoreAppIconKey
} from "./types";

export const SOFTWARE_STORE_APP_ID = "software-store" as const;
export const SOFTWARE_STORE_INSTANCE_ID = "software-store" as const;
export const SOFTWARE_STORE_ICON_KEY = "software-store-default" as const satisfies SoftwareStoreAppIconKey;

const SOFTWARE_STORE_SETTINGS_CATEGORIES = new Set<BrowserSettingsCategoryId>([
  "general",
  "appearance",
  "workspace",
  "notifications",
  "loginManager",
  "softwareStore",
  "linux",
  "search",
  "ai",
  "models",
  "skills",
  "mcp",
  "experimental"
]);

export type SoftwareStoreDetailRequest =
  | {
      readonly kind: "software";
      readonly id: string;
    }
  | {
      readonly kind: "uiux";
      readonly id: string;
    }
  | {
      readonly kind: "component";
      readonly id: string;
    };

const detailRequestListeners = new Set<(request: SoftwareStoreDetailRequest) => void>();
let pendingDetailRequest: SoftwareStoreDetailRequest | null = null;

export const softwareStoreDetailKey = (request: SoftwareStoreDetailRequest): string =>
  `${request.kind}:${request.id}`;

export const requestSoftwareStoreDetail = (request: SoftwareStoreDetailRequest): void => {
  pendingDetailRequest = request;
  for (const listener of detailRequestListeners) {
    listener(request);
  }
};

export const subscribeSoftwareStoreDetailRequests = (
  listener: (request: SoftwareStoreDetailRequest) => void
): (() => void) => {
  detailRequestListeners.add(listener);
  if (pendingDetailRequest !== null) {
    listener(pendingDetailRequest);
  }
  return () => {
    detailRequestListeners.delete(listener);
  };
};

export const createSoftwareStoreAppRequest = (
  title: string
): WorkspaceAppTabOpenRequest => ({
  appId: SOFTWARE_STORE_APP_ID,
  appInstanceId: SOFTWARE_STORE_INSTANCE_ID,
  title,
  iconKey: SOFTWARE_STORE_ICON_KEY
});

/**
 * Settings contribution routes are module data, so Core maps them through a
 * closed set of trusted destinations instead of treating them as URLs.
 */
export const resolveSoftwareStoreSettingsRouteTarget = (
  route: string
): BrowserSettingsCategoryId | null => {
  const normalized = route.trim().replace(/\/+$/u, "") || "/";
  if (
    !normalized.startsWith("/")
    || normalized.startsWith("//")
    || normalized.includes("//")
    || normalized.includes("\\")
    || normalized.includes("?")
    || normalized.includes("#")
    || normalized.includes("\0")
  ) {
    return null;
  }
  if (
    normalized === "/credentials"
    || normalized === "/login-manager"
    || normalized === "/settings/loginManager"
  ) {
    return "loginManager";
  }
  if (
    normalized === "/software-store"
    || normalized === "/components"
    || normalized === "/settings/softwareStore"
  ) {
    return "softwareStore";
  }
  const category = normalized === "/settings" || normalized === "/"
    ? "general"
    : normalized.startsWith("/settings/")
      ? normalized.slice("/settings/".length)
      : normalized.slice(1);
  if (category.length === 0 || category.includes("/")) {
    return null;
  }
  return SOFTWARE_STORE_SETTINGS_CATEGORIES.has(category as BrowserSettingsCategoryId)
    ? category as BrowserSettingsCategoryId
    : null;
};

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderSoftwareStoreAppIcon = (
  iconKey: SoftwareStoreAppIconKey
): JSX.Element => {
  if (iconKey === "software-store-default") {
    return wrapIcon(<Store size={15} />);
  }
  return wrapIcon(<Store size={15} />);
};
