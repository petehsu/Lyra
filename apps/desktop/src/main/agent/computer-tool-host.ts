import {
  loadAccessibilityNativeBindings,
  type AccessibilityNativeBindings
} from "../accessibility";
import {
  isLyraSensitiveValueRef,
  type LyraSensitiveValueRef
} from "../../shared/sensitive-value";
import {
  adaptBrowserAxActToComputerAct,
  adaptBrowserAxExplainToComputerExplain,
  adaptBrowserAxMapToComputerMap,
  adaptBrowserAxQueryToComputerFind,
  adaptFileManagerObservationToComputerMap,
  adaptTerminalActToComputerAct,
  adaptTerminalMapToComputerMap,
  browserAxNodeToComputerNode,
  filterTerminalRegions,
  isBrowserAxActionResult,
  isBrowserAxMapResult,
  isBrowserAxQueryResult,
  isLyraBrowserOsRef,
  isLyraFileManagerOsRef,
  isLyraTerminalOsRef,
  mapComputerActionToAxInteraction,
  mapComputerActionToTerminalAction,
  parseLyraBrowserOsRef,
  parseLyraFileManagerOsRef,
  parseLyraTerminalOsRef,
  LYRA_BROWSER_SURFACE,
  LYRA_FILE_MANAGER_SURFACE,
  LYRA_TERMINAL_SURFACE
} from "./computer-internal-surface";
import {
  readComputerSurfaceRoute,
  resolveInternalSurface,
  type ResolvedInternalSurface
} from "./computer-surface-resolver";
import { materializeLumenCapture } from "./artifact-materializer";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import {
  isRecord,
  normalizePayload,
  readClampedOptionalNumber,
  readOptionalNumberField,
  readOptionalStringField,
  readStringField
} from "./host-payload";
import type { WorkbenchBrowserTabResolver } from "./workbench-observation-adapter";
import type { WorkbenchTabsListResult } from "../../shared/workbench-observation";

/**
 * Computer Use tool host.
 *
 * Bridges the runtime `lyraComputer.*` capability calls to the native
 * `lyra-computer-use-core` JSON facade, which is currently exposed through the
 * macOS `lyra-accessibility-napi` shim. The host stays a thin marshaller: it
 * validates Agent input, forwards a JSON string to native, and returns the
 * parsed native envelope unchanged (native already carries `ok`/`status`/`error`
 * and the act -> diff result). See `Desktop-Computer-Use-Architecture.md`.
 *
 * Level-1 Lyra surfaces (D1b): map/find/act can route to browser_ax,
 * terminal.map/act, or file-manager observation when `surface` names a Lyra
 * internal tab (or auto-routing picks the active workbench tab).
 */

type ComputerNativeMethod =
  | "computerMapJson"
  | "computerFindJson"
  | "computerActJson"
  | "computerDiffJson"
  | "computerExplainJson"
  | "computerListAppsJson"
  | "computerObserveJson"
  | "computerFocusJson";

const LYRA_TAB_APP_REF_PREFIX = "lytab:";

const parseLyraTabAppRef = (appRef: string): string | null => {
  if (!appRef.startsWith(LYRA_TAB_APP_REF_PREFIX)) {
    return null;
  }
  const tabId = appRef.slice(LYRA_TAB_APP_REF_PREFIX.length);
  return tabId.length > 0 ? tabId : null;
};

const surfaceForWorkbenchTab = (
  tab: WorkbenchTabsListResult["tabs"][number]
): ResolvedInternalSurface["kind"] | null => {
  if (tab.observationKind === "terminal" || tab.pageKind === "terminal") {
    return LYRA_TERMINAL_SURFACE;
  }
  if (tab.observationKind === "file-manager") {
    return LYRA_FILE_MANAGER_SURFACE;
  }
  if (
    tab.observationKind === "page"
    || tab.observationKind === "search-home"
    || tab.observationKind === "search-results"
    || tab.pageKind === "page"
    || tab.pageKind === "search"
    || tab.pageKind === "results"
  ) {
    return LYRA_BROWSER_SURFACE;
  }
  return null;
};

const workbenchTabToAppEntry = (
  tab: WorkbenchTabsListResult["tabs"][number],
  activeTabId: string | null
): Record<string, unknown> => {
  const surface = surfaceForWorkbenchTab(tab);
  return {
    appRef: `${LYRA_TAB_APP_REF_PREFIX}${tab.tabId}`,
    name: tab.title,
    isForeground: tab.tabId === activeTabId,
    source: "lyra-internal",
    ...(surface === null ? {} : { surface, capabilityLevel: 1 }),
    windows: [
      {
        windowRef: `${LYRA_TAB_APP_REF_PREFIX}${tab.tabId}`,
        title: tab.title,
        isFocused: tab.active
      }
    ]
  };
};

const COMPUTER_ACTIONS = new Set([
  "press",
  "focus",
  "setText",
  "typeText",
  "toggle",
  "select",
  "scroll",
  "pressKey",
  "secondaryAction",
  "drag",
]);

const COMPUTER_MODES = new Set(["shared", "background-semantic", "isolated-session"]);

const unavailableEnvelope = (errorMessage: string): Record<string, unknown> => ({
  ok: false,
  platform: process.platform,
  error: {
    kind: "nativeUnavailable",
    message: `Computer Use native bindings are unavailable: ${errorMessage}`
  }
});

/**
 * Invokes a capability handler by key. Handler maps are indexed records, so
 * under `noUncheckedIndexedAccess` a lookup is `Handler | undefined`; this
 * resolves the handler once and fails loudly if the expected internal-surface
 * capability is not registered, rather than calling `undefined`.
 */
const invokeHandler = async (
  handlers: AgentHostCapabilityHandlers,
  key: string,
  payload: Record<string, unknown>
): Promise<unknown> => {
  const handler = handlers[key];
  if (handler === undefined) {
    throw new Error(`Internal surface capability "${key}" is not registered.`);
  }
  return handler(payload);
};

export const createComputerToolHost = ({
  resolveSensitiveValueForFill,
  internalSurfaces,
  visualFallback
}: {
  readonly resolveSensitiveValueForFill?: (ref: LyraSensitiveValueRef) => Promise<string>;
  readonly internalSurfaces?: {
    readonly tabResolver: WorkbenchBrowserTabResolver;
    readonly axHandlers: AgentHostCapabilityHandlers;
    readonly terminalHandlers: AgentHostCapabilityHandlers;
    readonly listWorkbenchTabs: () => Promise<WorkbenchTabsListResult>;
    readonly activateWorkbenchTab?: (tabId: string) => Promise<Record<string, unknown>>;
  };
  /** Level-3 visual fallback (computer.see): desktop screen capture. */
  readonly visualFallback?: {
    readonly storageRoot: string;
    readonly captureScreen: (
      scope: "screen" | "focused-window"
    ) => Promise<{
      readonly imageBase64: string;
      readonly mimeType: string;
      readonly width: number;
      readonly height: number;
    } | null>;
  };
} = {}): {
  readonly handlers: AgentHostCapabilityHandlers;
} => {
  let cached: AccessibilityNativeBindings | null = null;
  let loadError: string | null = null;
  let attempted = false;

  const bindings = (): AccessibilityNativeBindings | null => {
    if (attempted) {
      return cached;
    }
    attempted = true;
    const result = loadAccessibilityNativeBindings();
    if (result.ok) {
      cached = result.bindings;
    } else {
      loadError = result.errorMessage;
    }
    return cached;
  };

  const invokeNative = (
    method: ComputerNativeMethod,
    request: Record<string, unknown>
  ): Record<string, unknown> => {
    const native = bindings();
    if (native === null) {
      return unavailableEnvelope(loadError ?? "addon not found");
    }
    const raw = native[method](JSON.stringify(request));
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? parsed : { ok: false, error: { kind: "internal", message: "Native returned a non-object result." } };
    } catch (error) {
      return {
        ok: false,
        error: {
          kind: "internal",
          message: `Failed to parse native Computer Use result: ${
            error instanceof Error ? error.message : String(error)
          }`
        }
      };
    }
  };

  const resolveSurface = async (
    input: Record<string, unknown>,
    route: ReturnType<typeof readComputerSurfaceRoute>
  ): Promise<ResolvedInternalSurface | null> => {
    if (internalSurfaces === undefined || route === "native") {
      return null;
    }
    try {
      return await resolveInternalSurface({
        payload: input,
        route,
        tabResolver: internalSurfaces.tabResolver,
        listTabs: internalSurfaces.listWorkbenchTabs
      });
    } catch (error) {
      if (route !== "auto") {
        throw error;
      }
      return null;
    }
  };

  const mapInternalSurface = async (
    input: Record<string, unknown>,
    surface: ResolvedInternalSurface
  ): Promise<Record<string, unknown>> => {
    if (internalSurfaces === undefined) {
      return {
        ok: false,
        error: { kind: "internalSurfaceUnavailable", message: "Internal surface routing is not configured." }
      };
    }
    if (surface.kind === LYRA_BROWSER_SURFACE) {
      const strategy = readOptionalStringField(input, "strategy");
      const maxNodes = readClampedOptionalNumber(input, "maxNodes", 200, 1, 400);
      const raw = await invokeHandler(internalSurfaces.axHandlers, "lyraAx.map", {
        ...input,
        tabId: surface.tabId,
        strategy: strategy === "document" ? "document" : "interactive",
        maxNodes
      });
      if (isBrowserAxMapResult(raw)) {
        return adaptBrowserAxMapToComputerMap(raw);
      }
      return isRecord(raw) ? raw : { ok: false, error: { kind: "internal", message: "browser_ax.map returned an invalid result." } };
    }
    if (surface.kind === LYRA_TERMINAL_SURFACE) {
      const raw = await invokeHandler(internalSurfaces.terminalHandlers, "terminal.map.read", {
        ...input,
        tabId: surface.tabId
      });
      if (!isRecord(raw) || !Array.isArray(raw.regions) || typeof raw.sessionId !== "string") {
        return isRecord(raw) ? raw : { ok: false, error: { kind: "internal", message: "terminal.map.read returned an invalid result." } };
      }
      const screen = isRecord(raw.screen) ? raw.screen : {};
      return adaptTerminalMapToComputerMap(surface.tabId, {
        sessionId: raw.sessionId,
        screen: { screenVersion: typeof screen.screenVersion === "number" ? screen.screenVersion : 0 },
        regions: raw.regions as Array<{
          regionId: string;
          kind: string;
          text: string;
          rowStart: number;
          rowEnd: number;
          colStart: number;
          colEnd: number;
          confidence: number;
          suggestedActions: readonly string[];
        }>,
        ...(typeof raw.stale === "boolean" ? { stale: raw.stale } : {}),
        ...(typeof raw.warning === "string" ? { warning: raw.warning } : {})
      });
    }
    const readResult = await internalSurfaces.tabResolver.readWorkbenchTabWithSummaryFallback({
      tabId: surface.tabId,
      detail: "full",
      maxEntries: readClampedOptionalNumber(input, "maxNodes", 200, 1, 400)
    });
    if (!isRecord(readResult) || !isRecord(readResult.observation)) {
      return { ok: false, error: { kind: "internal", message: "file manager tab read returned an invalid result." } };
    }
    const observation = readResult.observation;
    if (observation.kind !== "file-manager") {
      return {
        ok: false,
        error: {
          kind: "internalSurfaceUnavailable",
          message: `Tab ${surface.tabId} is not a file manager surface.`
        }
      };
    }
    return adaptFileManagerObservationToComputerMap(surface.tabId, {
      kind: "file-manager",
      ...(typeof observation.viewKind === "string" ? { viewKind: observation.viewKind } : {}),
      ...(observation.currentLocation === undefined ? {} : { currentLocation: observation.currentLocation as { readonly title?: string; readonly path?: string } | null }),
      ...(typeof observation.selectedEntryId === "string" ? { selectedEntryId: observation.selectedEntryId } : {}),
      ...(Array.isArray(observation.entries) ? { entries: observation.entries as Array<{ readonly id: string; readonly name: string; readonly path?: string; readonly kind?: string }> } : {})
    });
  };

  const findInternalSurface = async (
    input: Record<string, unknown>,
    surface: ResolvedInternalSurface
  ): Promise<Record<string, unknown>> => {
    const role = readOptionalStringField(input, "role");
    const nameIncludes = readOptionalStringField(input, "nameIncludes");
    const maxResults = readClampedOptionalNumber(input, "maxResults", 10, 1, 50);
    if (surface.kind === LYRA_BROWSER_SURFACE) {
      if (internalSurfaces === undefined) {
        return { ok: false, error: { kind: "internalSurfaceUnavailable", message: "Internal surface routing is not configured." } };
      }
      const strategy = readOptionalStringField(input, "strategy");
      const raw = await invokeHandler(internalSurfaces.axHandlers, "lyraAx.query", {
        ...input,
        tabId: surface.tabId,
        strategy: strategy === "document" ? "document" : "interactive",
        ...(role === undefined ? {} : { role }),
        ...(nameIncludes === undefined ? {} : { nameIncludes }),
        maxResults
      });
      if (isBrowserAxQueryResult(raw)) {
        return adaptBrowserAxQueryToComputerFind(surface.tabId, raw);
      }
      return isRecord(raw) ? raw : { ok: false, error: { kind: "internal", message: "browser_ax.query returned an invalid result." } };
    }
    const mapResult = await mapInternalSurface(input, surface);
    if (mapResult.ok !== true || !Array.isArray(mapResult.nodes)) {
      return mapResult;
    }
    const nodes = (mapResult.nodes as Record<string, unknown>[]).filter((node) => {
      const nodeRole = typeof node.role === "string" ? node.role.toLowerCase() : "";
      const nodeName = typeof node.name === "string" ? node.name.toLowerCase() : "";
      if (role !== undefined && nodeRole !== role.toLowerCase()) {
        return false;
      }
      if (nameIncludes !== undefined && !nodeName.includes(nameIncludes.toLowerCase())) {
        return false;
      }
      return true;
    }).slice(0, maxResults);
    return {
      ok: true,
      platform: mapResult.platform,
      surface: mapResult.surface,
      capabilityLevel: 1,
      snapshotId: mapResult.snapshotId,
      matchCount: nodes.length,
      nodes
    };
  };

  const mergeLyraTabsIntoListApps = async (
    result: Record<string, unknown>,
    maxApps: number
  ): Promise<Record<string, unknown>> => {
    if (internalSurfaces === undefined || result.ok !== true) {
      return result;
    }
    const tabsResult = await internalSurfaces.listWorkbenchTabs();
    const lyraApps = tabsResult.tabs
      .map((tab) => workbenchTabToAppEntry(tab, tabsResult.activeTabId))
      .filter((entry) => typeof entry.appRef === "string");
    const nativeApps = Array.isArray(result.apps) ? (result.apps as Record<string, unknown>[]) : [];
    const merged = [...lyraApps, ...nativeApps];
    return {
      ...result,
      apps: merged.slice(0, maxApps),
      lyraTabCount: lyraApps.length,
      status: isRecord(result.status)
        ? {
            ...result.status,
            appCount: Math.min(merged.length, maxApps)
          }
        : result.status
    };
  };

  const handlers: AgentHostCapabilityHandlers = {
    "lyraComputer.listApps": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const maxApps = readClampedOptionalNumber(input, "maxApps", 50, 1, 100);
      const request: Record<string, unknown> = {
        maxApps,
        includeBackground: input.includeBackground === true
      };
      const result = invokeNative("computerListAppsJson", request);
      return mergeLyraTabsIntoListApps(result, maxApps);
    },

    "lyraComputer.observe": async (payload: unknown) => {
      const input = normalizePayload(payload);
      if (internalSurfaces !== undefined) {
        const tabsResult = await internalSurfaces.listWorkbenchTabs();
        const activeTab = tabsResult.tabs.find((tab) => tab.tabId === tabsResult.activeTabId);
        if (activeTab !== undefined) {
          const surface = surfaceForWorkbenchTab(activeTab);
          const appEntry = workbenchTabToAppEntry(activeTab, tabsResult.activeTabId);
          return {
            ok: true,
            platform: process.platform,
            capabilityLevel: 1,
            ...(surface === null ? {} : { surface }),
            foregroundApp: appEntry,
            focusedWindow: Array.isArray(appEntry.windows) ? appEntry.windows[0] : undefined,
            status: {
              ok: true,
              state: "available",
              message: "Lyra workbench foreground tab was observed."
            }
          };
        }
      }
      void input;
      return invokeNative("computerObserveJson", {});
    },

    "lyraComputer.focus": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const mode = readOptionalStringField(input, "mode") ?? "shared";
      if (mode !== "shared" && COMPUTER_MODES.has(mode)) {
        return {
          ok: false,
          mode,
          error: {
            kind: "foregroundStealBlocked",
            message: `computer.focus would raise an app/window; not allowed in ${mode} mode. Use shared mode.`
          }
        };
      }

      const explicitTabId = readOptionalStringField(input, "lyraTabId");
      const appRef = readOptionalStringField(input, "appRef");
      const windowRef = readOptionalStringField(input, "windowRef");
      const lyraTabId =
        explicitTabId
        ?? (appRef === undefined ? undefined : parseLyraTabAppRef(appRef) ?? undefined)
        ?? (windowRef === undefined ? undefined : parseLyraTabAppRef(windowRef) ?? undefined);

      if (lyraTabId !== undefined) {
        if (internalSurfaces?.activateWorkbenchTab === undefined) {
          return {
            ok: false,
            error: {
              kind: "internalSurfaceUnavailable",
              message: "Lyra workbench tab activation is not configured."
            }
          };
        }
        const activation = await internalSurfaces.activateWorkbenchTab(lyraTabId);
        return {
          ok: true,
          platform: process.platform,
          mode: "shared",
          focused: true,
          lyraTabId,
          ...(isRecord(activation) ? activation : {}),
          message: `Lyra workbench tab ${lyraTabId} was activated.`
        };
      }

      const request: Record<string, unknown> = { mode: "shared" };
      if (appRef !== undefined) {
        request.appRef = appRef;
      }
      const pid = input.pid;
      if (typeof pid === "number") {
        request.pid = pid;
      }
      const bundleId = readOptionalStringField(input, "bundleId");
      if (bundleId !== undefined) {
        request.bundleId = bundleId;
      }
      const windowTitle = readOptionalStringField(input, "windowTitle");
      if (windowTitle !== undefined) {
        request.windowTitle = windowTitle;
      }
      if (windowRef !== undefined) {
        request.windowRef = windowRef;
      }
      if (
        request.appRef === undefined
        && request.pid === undefined
        && request.bundleId === undefined
        && request.windowTitle === undefined
        && request.windowRef === undefined
      ) {
        return {
          ok: false,
          error: {
            kind: "invalidArgument",
            message:
              "computer.focus requires appRef, pid, bundleId, windowTitle, windowRef, or lyraTabId."
          }
        };
      }
      return invokeNative("computerFocusJson", request);
    },

    "lyraComputer.map": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const route = readComputerSurfaceRoute(input);
      const surface = await resolveSurface(input, route);
      if (surface !== null) {
        return mapInternalSurface(input, surface);
      }
      if (route !== "auto" && route !== "native") {
        return {
          ok: false,
          error: {
            kind: "internalSurfaceUnavailable",
            message: `surface "${route}" requires an active Lyra ${route.replace("lyra-", "")} tab.`
          }
        };
      }

      const strategy = readOptionalStringField(input, "strategy");
      const request: Record<string, unknown> = {
        strategy: strategy === "document" ? "document" : "interactive",
        maxNodes: readClampedOptionalNumber(input, "maxNodes", 200, 1, 400)
      };
      return invokeNative("computerMapJson", request);
    },

    "lyraComputer.find": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const route = readComputerSurfaceRoute(input);
      const surface = await resolveSurface(input, route);
      if (surface !== null) {
        return findInternalSurface(input, surface);
      }
      if (route !== "auto" && route !== "native") {
        return {
          ok: false,
          error: {
            kind: "internalSurfaceUnavailable",
            message: `surface "${route}" requires an active Lyra ${route.replace("lyra-", "")} tab.`
          }
        };
      }

      const strategy = readOptionalStringField(input, "strategy");
      const request: Record<string, unknown> = {
        strategy: strategy === "document" ? "document" : "interactive",
        maxResults: readClampedOptionalNumber(input, "maxResults", 10, 1, 50)
      };
      const role = readOptionalStringField(input, "role");
      if (role !== undefined) {
        request.role = role;
      }
      const nameIncludes = readOptionalStringField(input, "nameIncludes");
      if (nameIncludes !== undefined) {
        request.nameIncludes = nameIncludes;
      }
      return invokeNative("computerFindJson", request);
    },

    "lyraComputer.act": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const osRef = readStringField(input, "osRef");
      const actionValue = readOptionalStringField(input, "action") ?? "press";
      if (!COMPUTER_ACTIONS.has(actionValue)) {
        return {
          ok: false,
          error: {
            kind: "unsupportedAction",
            message: `Unknown computer action "${actionValue}".`
          }
        };
      }

      if (isLyraBrowserOsRef(osRef)) {
        if (internalSurfaces === undefined) {
          return {
            ok: false,
            error: {
              kind: "internalSurfaceUnavailable",
              message: "Lyra browser internal osRef routing is not configured."
            }
          };
        }
        const parsed = parseLyraBrowserOsRef(osRef);
        if (parsed === null) {
          return { ok: false, error: { kind: "invalidArgument", message: "Malformed Lyra browser osRef." } };
        }
        if (actionValue === "setText" || actionValue === "scroll") {
          return {
            ok: false,
            osRef,
            action: actionValue,
            error: {
              kind: "unsupportedOnInternalSurface",
              message:
                actionValue === "setText"
                  ? "setText on Lyra browser tabs should use browser act/fill tools. Re-run computer.map with surface lyra-browser and act with press/focus/toggle/select, or use browser tools directly."
                  : "scroll on Lyra browser tabs should use browser scroll tools."
            },
            nextRecommendedAction: actionValue === "setText" ? "browser.act" : "browser.scroll"
          };
        }
        const interaction = mapComputerActionToAxInteraction(actionValue);
        if (interaction === null) {
          return {
            ok: false,
            error: { kind: "unsupportedAction", message: `Action "${actionValue}" is not supported on Lyra browser.` }
          };
        }
        const raw = await invokeHandler(internalSurfaces.axHandlers, "lyraAx.act", {
          tabId: parsed.tabId,
          axRef: parsed.axRef,
          interaction,
          verification: "fast"
        });
        if (!isBrowserAxActionResult(raw)) {
          return isRecord(raw) ? raw : { ok: false, error: { kind: "internal", message: "browser_ax.act returned an invalid result." } };
        }
        return adaptBrowserAxActToComputerAct(osRef, actionValue, raw);
      }

      if (isLyraTerminalOsRef(osRef)) {
        if (internalSurfaces === undefined) {
          return {
            ok: false,
            error: { kind: "internalSurfaceUnavailable", message: "Lyra terminal internal osRef routing is not configured." }
          };
        }
        const parsed = parseLyraTerminalOsRef(osRef);
        if (parsed === null) {
          return { ok: false, error: { kind: "invalidArgument", message: "Malformed Lyra terminal osRef." } };
        }
        const terminalAction = mapComputerActionToTerminalAction(actionValue);
        if (terminalAction === null) {
          return { ok: false, error: { kind: "unsupportedAction", message: `Action "${actionValue}" is not supported on Lyra terminal.` } };
        }
        const raw = await invokeHandler(internalSurfaces.terminalHandlers, "terminal.act.execute", {
          ...input,
          sessionId: parsed.sessionId,
          regionId: parsed.regionId,
          operation: terminalAction.action,
          ...(readOptionalStringField(input, "text") === undefined
            ? {}
            : { text: readOptionalStringField(input, "text") })
        });
        return adaptTerminalActToComputerAct(osRef, actionValue, isRecord(raw) ? raw : {});
      }

      if (isLyraFileManagerOsRef(osRef)) {
        return {
          ok: false,
          osRef,
          action: actionValue,
          error: {
            kind: "unsupportedOnInternalSurface",
            message: "File manager mutations should use filesystem/file-manager tools. computer.* on lyra-files is read-only (map/find) for now."
          },
          nextRecommendedAction: "filesystem.list_files"
        };
      }

      const request: Record<string, unknown> = { osRef, action: actionValue };
      const mode = readOptionalStringField(input, "mode");
      if (mode !== undefined && COMPUTER_MODES.has(mode)) {
        request.mode = mode;
      }

      const sensitiveRef = input.sensitiveValueRef;
      if (sensitiveRef !== undefined) {
        if (!isLyraSensitiveValueRef(sensitiveRef)) {
          return {
            ok: false,
            error: {
              kind: "invalidArgument",
              message: "sensitiveValueRef must be a valid lyra-sensitive-value-ref object."
            }
          };
        }
        if (resolveSensitiveValueForFill === undefined) {
          return {
            ok: false,
            error: {
              kind: "unavailable",
              message: "Sensitive value autofill is not available in this runtime."
            }
          };
        }
        const secret = await resolveSensitiveValueForFill(sensitiveRef);
        return invokeNative("computerActJson", {
          ...request,
          action: "setText",
          text: secret,
          credentialFill: true
        });
      }

      const text = readOptionalStringField(input, "text");
      if (text !== undefined) {
        request.text = text;
      }
      // New action parameters: pressKey / secondaryAction / scroll / drag
      const key = readOptionalStringField(input, "key");
      if (key !== undefined) request.key = key;
      const actionName = readOptionalStringField(input, "actionName");
      if (actionName !== undefined) request.actionName = actionName;
      const direction = readOptionalStringField(input, "direction");
      if (direction !== undefined) request.direction = direction;
      const pages = readOptionalNumberField(input, "pages");
      if (pages !== undefined) request.pages = pages;
      const fromX = readOptionalNumberField(input, "fromX");
      if (fromX !== undefined) request.fromX = fromX;
      const fromY = readOptionalNumberField(input, "fromY");
      if (fromY !== undefined) request.fromY = fromY;
      const toX = readOptionalNumberField(input, "toX");
      if (toX !== undefined) request.toX = toX;
      const toY = readOptionalNumberField(input, "toY");
      if (toY !== undefined) request.toY = toY;
      return invokeNative("computerActJson", request);
    },

    "lyraComputer.diff": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const baselineSnapshotId = readOptionalStringField(input, "baselineSnapshotId");
      if (baselineSnapshotId !== undefined) {
        const strategy = readOptionalStringField(input, "strategy");
        const request: Record<string, unknown> = {
          baselineSnapshotId,
          strategy: strategy === "document" ? "document" : "interactive",
          maxNodes: readClampedOptionalNumber(input, "maxNodes", 200, 1, 400)
        };
        return invokeNative("computerDiffJson", request);
      }

      const osRef = readStringField(input, "osRef");
      if (isLyraBrowserOsRef(osRef) && internalSurfaces !== undefined) {
        const parsed = parseLyraBrowserOsRef(osRef);
        if (parsed === null) {
          return { ok: false, error: { kind: "invalidArgument", message: "Malformed Lyra browser osRef." } };
        }
        const explanation = await invokeHandler(internalSurfaces.axHandlers, "lyraAx.explain", {
          tabId: parsed.tabId,
          axRef: parsed.axRef
        });
        if (!isRecord(explanation) || explanation.kind !== "browserAxExplanation") {
          return { ok: false, error: { kind: "internal", message: "browser_ax.explain returned an invalid result." } };
        }
        if (explanation.axAvailable !== true) {
          return {
            ok: true,
            platform: process.platform,
            surface: LYRA_BROWSER_SURFACE,
            capabilityLevel: 1,
            present: false,
            osRef,
            message: "Node is no longer present; the osRef is stale."
          };
        }
        const mapResult = await invokeHandler(internalSurfaces.axHandlers, "lyraAx.map", {
          tabId: parsed.tabId,
          strategy: "interactive",
          maxNodes: 400
        });
        if (!isBrowserAxMapResult(mapResult)) {
          return { ok: false, error: { kind: "internal", message: "browser_ax.map returned an invalid result." } };
        }
        const node = mapResult.nodes.find((candidate) => candidate.axRef === parsed.axRef);
        if (node === undefined) {
          return {
            ok: true,
            platform: process.platform,
            surface: LYRA_BROWSER_SURFACE,
            capabilityLevel: 1,
            present: false,
            osRef,
            message: "Node is no longer present; the osRef is stale."
          };
        }
        return {
          ok: true,
          platform: process.platform,
          surface: LYRA_BROWSER_SURFACE,
          capabilityLevel: 1,
          present: true,
          osRef,
          node: browserAxNodeToComputerNode(parsed.tabId, node)
        };
      }

      if (isLyraTerminalOsRef(osRef) && internalSurfaces !== undefined) {
        const parsed = parseLyraTerminalOsRef(osRef);
        if (parsed === null) {
          return { ok: false, error: { kind: "invalidArgument", message: "Malformed Lyra terminal osRef." } };
        }
        const raw = await invokeHandler(internalSurfaces.terminalHandlers, "terminal.map.read", {
          ...input,
          sessionId: parsed.sessionId
        });
        if (!isRecord(raw) || !Array.isArray(raw.regions)) {
          return { ok: false, error: { kind: "internal", message: "terminal.map.read returned an invalid result." } };
        }
        const region = (raw.regions as Array<{ regionId: string }>).find(
          (candidate) => candidate.regionId === parsed.regionId
        );
        if (region === undefined) {
          return {
            ok: true,
            platform: process.platform,
            surface: LYRA_TERMINAL_SURFACE,
            capabilityLevel: 1,
            present: false,
            osRef,
            message: "Terminal region is no longer present; the osRef is stale."
          };
        }
        return {
          ok: true,
          platform: process.platform,
          surface: LYRA_TERMINAL_SURFACE,
          capabilityLevel: 1,
          present: true,
          osRef,
          node: filterTerminalRegions(parsed.sessionId, raw.regions as Parameters<typeof filterTerminalRegions>[1], {
            maxResults: 1
          })[0]
        };
      }

      if (isLyraFileManagerOsRef(osRef)) {
        const parsed = parseLyraFileManagerOsRef(osRef);
        if (parsed === null) {
          return { ok: false, error: { kind: "invalidArgument", message: "Malformed Lyra file manager osRef." } };
        }
        const mapResult = await mapInternalSurface(input, {
          kind: LYRA_FILE_MANAGER_SURFACE,
          tabId: parsed.tabId
        });
        const node = Array.isArray(mapResult.nodes)
          ? (mapResult.nodes as Record<string, unknown>[]).find(
              (candidate) => candidate.osRef === osRef
            )
          : undefined;
        return {
          ok: true,
          platform: process.platform,
          surface: LYRA_FILE_MANAGER_SURFACE,
          capabilityLevel: 1,
          present: node !== undefined,
          osRef,
          ...(node === undefined ? { message: "File entry is no longer present; the osRef is stale." } : { node })
        };
      }

      return invokeNative("computerDiffJson", { osRef });
    },

    "lyraComputer.explain": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const osRef = readOptionalStringField(input, "osRef");
      if (osRef !== undefined && isLyraBrowserOsRef(osRef) && internalSurfaces !== undefined) {
        const parsed = parseLyraBrowserOsRef(osRef);
        if (parsed === null) {
          return { ok: false, error: { kind: "invalidArgument", message: "Malformed Lyra browser osRef." } };
        }
        const raw = await invokeHandler(internalSurfaces.axHandlers, "lyraAx.explain", {
          tabId: parsed.tabId,
          axRef: parsed.axRef
        });
        if (!isRecord(raw) || raw.kind !== "browserAxExplanation") {
          return { ok: false, error: { kind: "internal", message: "browser_ax.explain returned an invalid result." } };
        }
        return adaptBrowserAxExplainToComputerExplain(osRef, {
          summary: typeof raw.summary === "string" ? raw.summary : "",
          axAvailable: raw.axAvailable === true,
          visualFallbackRecommended: raw.visualFallbackRecommended === true,
          userActionRequired: raw.userActionRequired === true,
          ...(typeof raw.nextRecommendedAction === "string"
            ? { nextRecommendedAction: raw.nextRecommendedAction }
            : {})
        });
      }

      if (osRef !== undefined && isLyraTerminalOsRef(osRef)) {
        return adaptBrowserAxExplainToComputerExplain(osRef, {
          surface: LYRA_TERMINAL_SURFACE,
          summary: "Lyra terminal region osRef. Act with computer.act (routes to terminal.act) or use terminal tools directly.",
          axAvailable: true,
          visualFallbackRecommended: false,
          userActionRequired: false,
          nextRecommendedAction: "computer.act"
        });
      }
      if (osRef !== undefined && isLyraFileManagerOsRef(osRef)) {
        return adaptBrowserAxExplainToComputerExplain(osRef, {
          surface: LYRA_FILE_MANAGER_SURFACE,
          summary: "Lyra file manager entry osRef. computer.* map/find are read-only; use filesystem tools to mutate files.",
          axAvailable: true,
          visualFallbackRecommended: false,
          userActionRequired: false,
          nextRecommendedAction: "filesystem.list_files"
        });
      }

      const route = readComputerSurfaceRoute(input);
      if (osRef === undefined && route !== "native" && internalSurfaces !== undefined) {
        try {
          const surface = await resolveSurface(input, route);
          if (surface !== null) {
            const summaryBySurface: Record<ResolvedInternalSurface["kind"], string> = {
              [LYRA_BROWSER_SURFACE]: "Lyra browser tab is available. computer.map auto-routes to browser_ax (Level 1).",
              [LYRA_TERMINAL_SURFACE]: "Lyra terminal tab is available. computer.map auto-routes to terminal.map (Level 1).",
              [LYRA_FILE_MANAGER_SURFACE]: "Lyra file manager tab is available. computer.map auto-routes to file-manager observation (Level 1, read-only)."
            };
            return adaptBrowserAxExplainToComputerExplain(undefined, {
              surface: surface.kind,
              summary: summaryBySurface[surface.kind],
              axAvailable: true,
              visualFallbackRecommended: false,
              userActionRequired: false,
              nextRecommendedAction: "computer.map"
            });
          }
        } catch {
          // Fall through to native explain.
        }
      }

      const request: Record<string, unknown> = {};
      if (osRef !== undefined) {
        request.osRef = osRef;
      }
      return invokeNative("computerExplainJson", request);
    },

    // Level 3 visual fallback: screenshot the desktop so the vision model can
    // read native UI with no accessibility node. Pure observation — never acts.
    "lyraComputer.see": async (payload: unknown) => {
      const input = normalizePayload(payload);
      if (visualFallback === undefined) {
        return {
          ok: false,
          platform: process.platform,
          error: {
            kind: "visualFallbackUnavailable",
            message: "Desktop screen capture is not configured in this runtime."
          }
        };
      }
      const scope = readOptionalStringField(input, "scope") === "screen" ? "screen" : "focused-window";
      const capture = await visualFallback.captureScreen(scope);
      if (capture === null) {
        return {
          ok: false,
          platform: process.platform,
          error: {
            kind: "captureFailed",
            message: `Could not capture the ${scope}. Screen recording permission may be denied.`
          }
        };
      }
      const artifact = await materializeLumenCapture(visualFallback.storageRoot, `computer-${scope}`, {
        mimeType: capture.mimeType,
        imageBase64: capture.imageBase64,
        width: capture.width,
        height: capture.height,
        visibleOnly: true
      });
      return {
        ok: true,
        platform: process.platform,
        kind: "computerSee",
        scope,
        capabilityLevel: 3,
        fallback: "vision",
        mimeType: capture.mimeType,
        width: capture.width,
        height: capture.height,
        imageArtifact: artifact,
        evidenceRefs: [artifact.id],
        message: `Captured desktop ${scope} ${artifact.id} (${capture.width}x${capture.height}). Read it visually; computer.* cannot act on pixels — there is no coordinate-click tool yet.`
      };
    }
  };

  return { handlers };
};