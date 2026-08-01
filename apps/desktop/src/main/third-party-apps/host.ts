import { createHash, randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  WebContentsView,
  ipcMain,
  session,
  type Event as ElectronEvent,
  type Rectangle
} from "electron";

import {
  THIRD_PARTY_APP_RPC_ARGUMENT_PREFIX,
  isThirdPartyAppRpcMethod,
  type ThirdPartyAppRpcRequest
} from "../../shared/third-party-app-rpc";
import {
  createThirdPartyAppPermissionPolicy,
  type ThirdPartyAppPermission
} from "./permission-policy";

const MAX_RPC_PAYLOAD_BYTES = 64 * 1024;
const MAX_RPC_PAYLOAD_DEPTH = 16;
const THIRD_PARTY_APP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

type ThirdPartyAppRpcContext = {
  readonly appId: string;
  readonly instanceId: string;
};

type ThirdPartyAppRpcRegistration = {
  readonly method: string;
  readonly permission?: ThirdPartyAppPermission;
  readonly handle: (
    payload: unknown,
    context: ThirdPartyAppRpcContext
  ) => unknown | Promise<unknown>;
};

type ThirdPartyAppHostOptions = {
  readonly appId: string;
  readonly instanceId: string;
  readonly appRoot: string;
  readonly entryFile: string;
  readonly permissions?: readonly ThirdPartyAppPermission[];
  readonly networkOrigins?: readonly string[];
  readonly rpc?: readonly ThirdPartyAppRpcRegistration[];
  readonly featureEnabled?: boolean;
  readonly preloadPath?: string;
};

type ThirdPartyAppHost = {
  readonly view: WebContentsView;
  readonly partition: string;
  readonly load: () => Promise<void>;
  readonly setBounds: (bounds: Rectangle) => void;
  readonly setVisible: (visible: boolean) => void;
  readonly dispose: () => void;
};

const isThirdPartyAppsEnabled = (
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean => env.LYRA_ENABLE_THIRD_PARTY_APPS === "1";

const resolveThirdPartyAppPreloadPath = (): string =>
  join(dirname(fileURLToPath(import.meta.url)), "../preload/third-party-app.cjs");

const isPathWithin = (parent: string, candidate: string): boolean => {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (pathFromParent !== ".." && !pathFromParent.startsWith("../") && !pathFromParent.startsWith("..\\") && !isAbsolute(pathFromParent))
  );
};

const resolveEntryFile = (appRoot: string, entryFile: string): string => {
  const candidate = realpathSync(isAbsolute(entryFile) ? entryFile : resolve(appRoot, entryFile));
  if (!isPathWithin(appRoot, candidate) || !statSync(candidate).isFile()) {
    throw new Error("Third-party application entry point must be inside its package directory.");
  }
  return candidate;
};

const assertIdentifier = (label: string, value: string): void => {
  if (!THIRD_PARTY_APP_ID_PATTERN.test(value)) {
    throw new Error(`Invalid third-party application ${label}.`);
  }
};

const assertRpcValue = (value: unknown): void => {
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > MAX_RPC_PAYLOAD_DEPTH) {
      throw new Error("Third-party application RPC payload is too deeply nested.");
    }
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) {
      return;
    }
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) {
        throw new Error("Third-party application RPC payload contains a non-finite number.");
      }
      return;
    }
    if (typeof candidate !== "object" || seen.has(candidate)) {
      throw new Error("Third-party application RPC payload must be acyclic JSON data.");
    }
    const prototype = Object.getPrototypeOf(candidate);
    if (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null) {
      throw new Error("Third-party application RPC payload must contain plain objects only.");
    }
    seen.add(candidate);
    for (const child of Array.isArray(candidate) ? candidate : Object.values(candidate)) {
      visit(child, depth + 1);
    }
    seen.delete(candidate);
  };

  visit(value, 0);
  const serialized = JSON.stringify(value);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > MAX_RPC_PAYLOAD_BYTES) {
    throw new Error("Third-party application RPC payload is too large.");
  }
};

const createThirdPartyAppHost = (options: ThirdPartyAppHostOptions): ThirdPartyAppHost => {
  if (!(options.featureEnabled ?? isThirdPartyAppsEnabled())) {
    throw new Error("Third-party applications are disabled.");
  }
  assertIdentifier("ID", options.appId);
  assertIdentifier("instance ID", options.instanceId);

  const policy = createThirdPartyAppPermissionPolicy({
    appRoot: options.appRoot,
    ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    ...(options.networkOrigins === undefined ? {} : { networkOrigins: options.networkOrigins })
  });
  const entryFile = resolveEntryFile(policy.appRoot, options.entryFile);
  const entryUrl = pathToFileURL(entryFile).toString();
  const nonce = randomUUID();
  const scope = createHash("sha256")
    .update(`${options.appId}\0${options.instanceId}\0${nonce}`)
    .digest("hex")
    .slice(0, 32);
  const partition = `lyra-third-party-${scope}`;
  const rpcChannel = `lyra:third-party-app:${scope}`;
  const isolatedSession = session.fromPartition(partition, { cache: false });
  const view = new WebContentsView({
    webPreferences: {
      additionalArguments: [`${THIRD_PARTY_APP_RPC_ARGUMENT_PREFIX}${rpcChannel}`],
      allowRunningInsecureContent: false,
      contextIsolation: true,
      devTools: false,
      enableDeprecatedPaste: false,
      javascript: true,
      navigateOnDragDrop: false,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      partition,
      preload: options.preloadPath ?? resolveThirdPartyAppPreloadPath(),
      safeDialogs: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });

  const rpcHandlers = new Map<string, ThirdPartyAppRpcRegistration>();
  rpcHandlers.set("host.context", {
    method: "host.context",
    handle: () => ({ appId: options.appId, instanceId: options.instanceId })
  });
  for (const registration of options.rpc ?? []) {
    if (!isThirdPartyAppRpcMethod(registration.method) || rpcHandlers.has(registration.method)) {
      throw new Error(`Invalid or duplicate third-party application RPC method: ${registration.method}`);
    }
    rpcHandlers.set(registration.method, registration);
  }

  const webContents = view.webContents;
  isolatedSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    callback({ cancel: !policy.allowsRequest(details.url) });
  });
  isolatedSession.setPermissionRequestHandler((requestingWebContents, permission, callback) => {
    callback(
      requestingWebContents.id === webContents.id && policy.allowsElectronPermission(permission)
    );
  });
  isolatedSession.setPermissionCheckHandler((requestingWebContents, permission) =>
    requestingWebContents?.id === webContents.id && policy.allowsElectronPermission(permission)
  );
  isolatedSession.setDevicePermissionHandler(() => false);
  isolatedSession.setDisplayMediaRequestHandler((_request, callback) => callback({}));

  const blockDownload = (event: ElectronEvent): void => event.preventDefault();
  isolatedSession.on("will-download", blockDownload);

  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const blockExternalNavigation = (event: ElectronEvent, url: string): void => {
    if (!policy.allowsNavigation(url)) {
      event.preventDefault();
    }
  };
  const blockWebView = (event: ElectronEvent): void => event.preventDefault();
  webContents.on("will-navigate", blockExternalNavigation);
  webContents.on("will-attach-webview", blockWebView);

  const rpcContext = Object.freeze({ appId: options.appId, instanceId: options.instanceId });
  ipcMain.handle(rpcChannel, async (event, rawRequest: unknown) => {
    if (event.sender.id !== webContents.id || typeof rawRequest !== "object" || rawRequest === null) {
      throw new Error("Third-party application RPC request was denied.");
    }
    const request = rawRequest as Partial<ThirdPartyAppRpcRequest>;
    if (!isThirdPartyAppRpcMethod(request.method)) {
      throw new Error("Third-party application RPC method is invalid.");
    }
    const registration = rpcHandlers.get(request.method);
    if (registration === undefined || !policy.allowsRpcPermission(registration.permission)) {
      throw new Error("Third-party application RPC method is not available.");
    }
    const payload = request.payload ?? null;
    assertRpcValue(payload);
    try {
      const response = (await registration.handle(payload, rpcContext)) ?? null;
      assertRpcValue(response);
      return response;
    } catch {
      throw new Error("Third-party application RPC failed.");
    }
  });

  let disposed = false;
  return {
    view,
    partition,
    load: async () => {
      if (disposed) {
        throw new Error("Third-party application host has been disposed.");
      }
      await webContents.loadURL(entryUrl);
    },
    setBounds: (bounds) => view.setBounds(bounds),
    setVisible: (visible) => view.setVisible(visible),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      ipcMain.removeHandler(rpcChannel);
      isolatedSession.webRequest.onBeforeRequest(null);
      isolatedSession.setPermissionRequestHandler(null);
      isolatedSession.setPermissionCheckHandler(null);
      isolatedSession.setDevicePermissionHandler(null);
      isolatedSession.setDisplayMediaRequestHandler(null);
      isolatedSession.off("will-download", blockDownload);
      webContents.off("will-navigate", blockExternalNavigation);
      webContents.off("will-attach-webview", blockWebView);
      webContents.close();
    }
  };
};

export {
  createThirdPartyAppHost,
  isThirdPartyAppsEnabled,
  resolveThirdPartyAppPreloadPath
};
export type {
  ThirdPartyAppHost,
  ThirdPartyAppHostOptions,
  ThirdPartyAppRpcContext,
  ThirdPartyAppRpcRegistration
};
