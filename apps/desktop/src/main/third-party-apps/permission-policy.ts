import { realpathSync, statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

const THIRD_PARTY_APP_PERMISSIONS = [
  "network",
  "clipboard-read",
  "clipboard-write",
  "file-read",
  "file-write"
] as const;

type ThirdPartyAppPermission = (typeof THIRD_PARTY_APP_PERMISSIONS)[number];

type ThirdPartyAppPermissionPolicyOptions = {
  readonly appRoot: string;
  readonly permissions?: readonly ThirdPartyAppPermission[];
  readonly networkOrigins?: readonly string[];
};

type ThirdPartyAppPermissionPolicy = {
  readonly appRoot: string;
  readonly permissions: ReadonlySet<ThirdPartyAppPermission>;
  readonly networkOrigins: ReadonlySet<string>;
  readonly allowsAppResource: (url: string) => boolean;
  readonly allowsElectronPermission: (permission: string) => boolean;
  readonly allowsNavigation: (url: string) => boolean;
  readonly allowsRequest: (url: string) => boolean;
  readonly allowsRpcPermission: (permission: ThirdPartyAppPermission | undefined) => boolean;
};

const permissionSet = new Set<string>(THIRD_PARTY_APP_PERMISSIONS);
const networkProtocols = new Set(["http:", "https:", "ws:", "wss:"]);
const localProtocols = new Set(["about:", "blob:", "data:"]);

const isPathWithin = (parent: string, candidate: string): boolean => {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (pathFromParent !== ".." &&
      !pathFromParent.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(pathFromParent))
  );
};

const normalizeOrigin = (rawOrigin: string): string => {
  const parsed = new URL(rawOrigin);
  if (!networkProtocols.has(parsed.protocol) || parsed.origin === "null") {
    throw new Error(`Unsupported third-party application network origin: ${rawOrigin}`);
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error(`Third-party application network allowlists must contain origins only: ${rawOrigin}`);
  }
  return parsed.origin;
};

const normalizePermissions = (
  values: readonly ThirdPartyAppPermission[]
): ReadonlySet<ThirdPartyAppPermission> => {
  const normalized = new Set<ThirdPartyAppPermission>();
  for (const value of values) {
    if (!permissionSet.has(value)) {
      throw new Error(`Unknown third-party application permission: ${String(value)}`);
    }
    normalized.add(value);
  }
  return normalized;
};

const createThirdPartyAppPermissionPolicy = (
  options: ThirdPartyAppPermissionPolicyOptions
): ThirdPartyAppPermissionPolicy => {
  const appRoot = realpathSync(options.appRoot);
  if (!statSync(appRoot).isDirectory()) {
    throw new Error("Third-party application package root must be a directory.");
  }
  const permissions = normalizePermissions(options.permissions ?? []);
  const networkOrigins = new Set((options.networkOrigins ?? []).map(normalizeOrigin));

  const allowsAppResource = (rawUrl: string): boolean => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "file:") {
        return false;
      }
      return isPathWithin(appRoot, realpathSync(fileURLToPath(parsed)));
    } catch {
      return false;
    }
  };

  const allowsElectronPermission = (permission: string): boolean => {
    switch (permission) {
      case "clipboard-read":
      case "deprecated-sync-clipboard-read":
        return permissions.has("clipboard-read");
      case "clipboard-sanitized-write":
        return permissions.has("clipboard-write");
      case "fileSystem":
        // Chromium's File System Access API cannot be scoped to the app's
        // declared roots. File access is exposed only through narrow host RPC.
        return false;
      default:
        return false;
    }
  };

  const allowsRequest = (rawUrl: string): boolean => {
    if (allowsAppResource(rawUrl)) {
      return true;
    }
    try {
      const parsed = new URL(rawUrl);
      if (localProtocols.has(parsed.protocol)) {
        return true;
      }
      return (
        permissions.has("network") &&
        networkProtocols.has(parsed.protocol) &&
        networkOrigins.has(parsed.origin)
      );
    } catch {
      return false;
    }
  };

  return {
    appRoot,
    permissions,
    networkOrigins,
    allowsAppResource,
    allowsElectronPermission,
    allowsNavigation: (url) => url === "about:blank" || allowsAppResource(url),
    allowsRequest,
    allowsRpcPermission: (permission) => permission === undefined || permissions.has(permission)
  };
};

export { THIRD_PARTY_APP_PERMISSIONS, createThirdPartyAppPermissionPolicy };
export type {
  ThirdPartyAppPermission,
  ThirdPartyAppPermissionPolicy,
  ThirdPartyAppPermissionPolicyOptions
};
