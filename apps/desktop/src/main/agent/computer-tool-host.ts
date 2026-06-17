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
  browserAxNodeToComputerNode,
  isBrowserAxActionResult,
  isBrowserAxMapResult,
  isBrowserAxQueryResult,
  isLyraBrowserOsRef,
  mapComputerActionToAxInteraction,
  parseLyraBrowserOsRef,
  readComputerSurfaceRoute,
  LYRA_BROWSER_SURFACE
} from "./computer-internal-surface";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import {
  isRecord,
  normalizePayload,
  readClampedOptionalNumber,
  readOptionalStringField,
  readStringField
} from "./host-payload";
import type { WorkbenchBrowserTabResolver } from "./workbench-observation-adapter";

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
 * Level-1 Lyra surfaces (D1b): when `surface` is `lyra-browser`, or when
 * auto-routing finds an active browser tab, map/find/act route to browser_ax
 * and return Computer Tree-shaped envelopes with `source: internal-ipc`.
 */

type ComputerNativeMethod =
  | "computerMapJson"
  | "computerFindJson"
  | "computerActJson"
  | "computerDiffJson"
  | "computerExplainJson";

const COMPUTER_ACTIONS = new Set([
  "press",
  "focus",
  "setText",
  "toggle",
  "select",
  "scroll"
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

export const createComputerToolHost = ({
  resolveSensitiveValueForFill,
  internalSurfaces
}: {
  readonly resolveSensitiveValueForFill?: (ref: LyraSensitiveValueRef) => Promise<string>;
  readonly internalSurfaces?: {
    readonly tabResolver: WorkbenchBrowserTabResolver;
    readonly axHandlers: AgentHostCapabilityHandlers;
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

  const resolveLyraBrowserTab = async (
    input: Record<string, unknown>,
    route: ReturnType<typeof readComputerSurfaceRoute>
  ): Promise<string | null> => {
    if (internalSurfaces === undefined) {
      return route === "lyra-browser" ? null : null;
    }
    if (route === "native") {
      return null;
    }
    try {
      const targetMode = readOptionalStringField(input, "targetMode") === "isolated" ? "isolated" : "live";
      return await internalSurfaces.tabResolver.resolveBrowserAgentTabId(input, targetMode);
    } catch (error) {
      if (route === "lyra-browser") {
        throw error;
      }
      return null;
    }
  };

  const handlers: AgentHostCapabilityHandlers = {
    "lyraComputer.map": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const route = readComputerSurfaceRoute(input);
      const tabId = await resolveLyraBrowserTab(input, route);
      if (tabId !== null && internalSurfaces !== undefined) {
        const strategy = readOptionalStringField(input, "strategy");
        const maxNodes = readClampedOptionalNumber(input, "maxNodes", 200, 1, 400);
        const raw = await internalSurfaces.axHandlers["lyraAx.map"]({
          ...input,
          tabId,
          strategy: strategy === "document" ? "document" : "interactive",
          maxNodes
        });
        if (isBrowserAxMapResult(raw)) {
          return adaptBrowserAxMapToComputerMap(raw);
        }
        return isRecord(raw) ? raw : { ok: false, error: { kind: "internal", message: "browser_ax.map returned an invalid result." } };
      }
      if (route === "lyra-browser") {
        return {
          ok: false,
          error: {
            kind: "internalSurfaceUnavailable",
            message: `surface "${LYRA_BROWSER_SURFACE}" requires an active Lyra browser tab.`
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
      const tabId = await resolveLyraBrowserTab(input, route);
      if (tabId !== null && internalSurfaces !== undefined) {
        const strategy = readOptionalStringField(input, "strategy");
        const role = readOptionalStringField(input, "role");
        const nameIncludes = readOptionalStringField(input, "nameIncludes");
        const maxResults = readClampedOptionalNumber(input, "maxResults", 10, 1, 50);
        const raw = await internalSurfaces.axHandlers["lyraAx.query"]({
          ...input,
          tabId,
          strategy: strategy === "document" ? "document" : "interactive",
          ...(role === undefined ? {} : { role }),
          ...(nameIncludes === undefined ? {} : { nameIncludes }),
          maxResults
        });
        if (isBrowserAxQueryResult(raw)) {
          return adaptBrowserAxQueryToComputerFind(tabId, raw);
        }
        return isRecord(raw) ? raw : { ok: false, error: { kind: "internal", message: "browser_ax.query returned an invalid result." } };
      }
      if (route === "lyra-browser") {
        return {
          ok: false,
          error: {
            kind: "internalSurfaceUnavailable",
            message: `surface "${LYRA_BROWSER_SURFACE}" requires an active Lyra browser tab.`
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
        const raw = await internalSurfaces.axHandlers["lyraAx.act"]({
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
        const explanation = await internalSurfaces.axHandlers["lyraAx.explain"]({
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
        const mapResult = await internalSurfaces.axHandlers["lyraAx.map"]({
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
        const raw = await internalSurfaces.axHandlers["lyraAx.explain"]({
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

      const route = readComputerSurfaceRoute(input);
      if (osRef === undefined && route !== "native" && internalSurfaces !== undefined) {
        try {
          const tabId = await resolveLyraBrowserTab(input, route);
          if (tabId !== null) {
            const raw = await internalSurfaces.axHandlers["lyraAx.explain"]({ tabId });
            if (isRecord(raw) && raw.kind === "browserAxExplanation") {
              return adaptBrowserAxExplainToComputerExplain(undefined, {
                summary: typeof raw.summary === "string"
                  ? raw.summary
                  : "Lyra browser tab is available. Use computer.map (auto-routes to Level 1) or browser_ax.map.",
                axAvailable: true,
                visualFallbackRecommended: false,
                userActionRequired: false,
                nextRecommendedAction: "computer.map"
              });
            }
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
    }
  };

  return { handlers };
};