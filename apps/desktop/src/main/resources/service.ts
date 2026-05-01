import { BrowserWindow, ipcMain } from "electron";

import {
  LYRA_CHANNELS,
  type LyraResourceEvent,
  type LyraResourceLifecycleRequest,
  type LyraResourceNode,
  type LyraResourceRegisterRequest,
  type LyraResourceSnapshot
} from "../../shared/desktop-bridge";
import { loadResourcesNativeBindings } from "./native-loader";
import type { ResourceRuntimeService } from "./types";

const VALID_LIFECYCLE_STATES = new Set([
  "foreground",
  "visible",
  "hot-hidden",
  "warm-suspended",
  "frozen",
  "tombstoned",
  "restoring",
  "archived"
]);

const normalizeString = (value: unknown, fallback = ""): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeLifecycleState = (value: unknown): LyraResourceNode["lifecycleState"] => {
  const normalized = normalizeString(value, "hot-hidden");
  return VALID_LIFECYCLE_STATES.has(normalized)
    ? normalized as LyraResourceNode["lifecycleState"]
    : "hot-hidden";
};

const normalizeResourceRequest = (
  request: LyraResourceRegisterRequest
): LyraResourceRegisterRequest => {
  const resourceId = normalizeString(request.resourceId);
  if (resourceId.length === 0) {
    throw new Error("resourceId is required");
  }
  const kind = normalizeString(request.kind, "resource");
  const label = normalizeString(request.label, resourceId);
  const viewId = normalizeString(request.viewId, resourceId);
  const stateKey = normalizeString(request.stateKey, viewId);
  const coreKey = normalizeString(request.coreKey, stateKey);
  const tabId = normalizeString(request.tabId);
  const address = normalizeString(request.address);
  return {
    resourceId,
    kind,
    label,
    viewId,
    stateKey,
    coreKey,
    lifecycleState: normalizeLifecycleState(request.lifecycleState),
    ...(tabId.length === 0 ? {} : { tabId }),
    ...(address.length === 0 ? {} : { address }),
    pid: typeof request.pid === "number" && Number.isFinite(request.pid)
      ? Math.round(request.pid)
      : 0,
    visible: request.visible === true
  };
};

const normalizeLifecycleRequest = (
  request: LyraResourceLifecycleRequest
): LyraResourceLifecycleRequest => {
  const resourceId = normalizeString(request.resourceId);
  if (resourceId.length === 0) {
    throw new Error("resourceId is required");
  }
  return {
    resourceId,
    targetState: normalizeLifecycleState(request.targetState)
  };
};

const toCoreGroups = (
  resources: readonly LyraResourceNode[]
): LyraResourceSnapshot["coreGroups"] => {
  const byCore = new Map<string, LyraResourceNode[]>();
  for (const resource of resources) {
    const coreResources = byCore.get(resource.coreKey) ?? [];
    coreResources.push(resource);
    byCore.set(resource.coreKey, coreResources);
  }
  return Array.from(byCore.entries())
    .map(([coreKey, groupResources]) => ({
      coreKey,
      resourceIds: groupResources.map((resource) => resource.resourceId),
      viewCount: groupResources.length,
      activeCount: groupResources.filter((resource) =>
        resource.lifecycleState === "foreground" || resource.lifecycleState === "visible"
      ).length,
      tombstonedCount: groupResources.filter((resource) =>
        resource.lifecycleState === "tombstoned"
      ).length
    }))
    .sort((left, right) => right.viewCount - left.viewCount || left.coreKey.localeCompare(right.coreKey));
};

const parseSnapshot = (json: string): LyraResourceSnapshot => {
  const parsed = JSON.parse(json) as Omit<LyraResourceSnapshot, "coreGroups"> & {
    readonly coreGroups?: LyraResourceSnapshot["coreGroups"];
  };
  const resources = Array.isArray(parsed.resources) ? parsed.resources : [];
  return {
    generation: typeof parsed.generation === "number" ? parsed.generation : 0,
    capturedAt: typeof parsed.capturedAt === "number" ? parsed.capturedAt : Date.now(),
    process: {
      pid: typeof parsed.process?.pid === "number" ? parsed.process.pid : process.pid,
      memoryBytes:
        typeof parsed.process?.memoryBytes === "number"
          ? parsed.process.memoryBytes
          : process.memoryUsage().rss
    },
    resources,
    coreGroups: toCoreGroups(resources)
  };
};

const publishResourceEvent = (event: LyraResourceEvent): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents.isDestroyed()) {
      continue;
    }
    window.webContents.send(LYRA_CHANNELS.resourcesEvent, event);
  }
};

export const createResourceRuntimeService = (): ResourceRuntimeService => {
  const loadResult = loadResourcesNativeBindings();
  if (loadResult.ok === false) {
    throw new Error(
      `resource native unavailable: ${loadResult.errorMessage}\ntried paths:\n${loadResult.triedPaths.join("\n")}`
    );
  }
  const bindings = loadResult.bindings;

  const readSnapshot = (): LyraResourceSnapshot =>
    parseSnapshot(bindings.readSnapshotJson());

  const publishSnapshot = (): void => {
    publishResourceEvent({
      kind: "snapshot",
      snapshot: readSnapshot()
    });
  };

  ipcMain.handle(LYRA_CHANNELS.resourcesReadSnapshot, () => readSnapshot());
  ipcMain.handle(
    LYRA_CHANNELS.resourcesRegisterOrUpdate,
    (_event, payload: LyraResourceRegisterRequest) => {
      const request = normalizeResourceRequest(payload);
      const generation = bindings.registerOrUpdateResourceJson(JSON.stringify(request));
      publishResourceEvent({
        kind: "resource-updated",
        resourceId: request.resourceId,
        generation
      });
      publishSnapshot();
    }
  );
  ipcMain.handle(LYRA_CHANNELS.resourcesRemove, (_event, resourceId: unknown) => {
    const normalized = normalizeString(resourceId);
    if (normalized.length === 0) {
      throw new Error("resourceId is required");
    }
    const generation = bindings.removeResource(normalized);
    publishResourceEvent({
      kind: "resource-removed",
      resourceId: normalized,
      generation
    });
    publishSnapshot();
  });
  ipcMain.handle(
    LYRA_CHANNELS.resourcesRequestLifecycle,
    (_event, payload: LyraResourceLifecycleRequest) => {
      const request = normalizeLifecycleRequest(payload);
      const generation = bindings.requestLifecycle(request.resourceId, request.targetState);
      publishResourceEvent({
        kind: "lifecycle-requested",
        resourceId: request.resourceId,
        targetState: request.targetState,
        generation
      });
      publishSnapshot();
    }
  );

  return {
    dispose: () => {
      ipcMain.removeHandler(LYRA_CHANNELS.resourcesReadSnapshot);
      ipcMain.removeHandler(LYRA_CHANNELS.resourcesRegisterOrUpdate);
      ipcMain.removeHandler(LYRA_CHANNELS.resourcesRemove);
      ipcMain.removeHandler(LYRA_CHANNELS.resourcesRequestLifecycle);
    },
    loadResult,
    readSnapshot,
    registerOrUpdate: (request) => {
      const normalized = normalizeResourceRequest(request);
      return bindings.registerOrUpdateResourceJson(JSON.stringify(normalized));
    },
    remove: (resourceId) => bindings.removeResource(resourceId),
    requestLifecycle: (request) => {
      const normalized = normalizeLifecycleRequest(request);
      return bindings.requestLifecycle(normalized.resourceId, normalized.targetState);
    }
  };
};
