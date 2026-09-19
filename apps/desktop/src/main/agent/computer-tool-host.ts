import {
  loadAccessibilityNativeBindings,
  type AccessibilityNativeBindings
} from "../accessibility";
import {
  isLyraSensitiveValueRef,
  type LyraSensitiveValueRef
} from "../../shared/sensitive-value";
import {
  isLyraBrowserOsRef,
  isLyraFileManagerOsRef,
  isLyraTerminalOsRef
} from "./computer-internal-surface";
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

/**
 * Computer Use tool host.
 *
 * Bridges `lyraComputer.*` to the OS-native `lyra-computer-use-core` facade
 * (macOS AX, Windows UIA, Linux AT-SPI). Computer tools only operate native
 * desktop apps. Lyra browser / terminal / files stay on their own tools.
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

const LINUX_COMPUTER_ACTIONS = new Set([
  "press",
  "focus",
  "setText",
  "toggle",
  "select",
  "scroll"
]);

const FULL_COMPUTER_ACTIONS = new Set([
  "press",
  "focus",
  "setText",
  "typeText",
  "toggle",
  "select",
  "scroll",
  "pressKey",
  "secondaryAction",
  "drag"
]);

const computerActionsForPlatform = (): Set<string> =>
  process.platform === "linux" ? LINUX_COMPUTER_ACTIONS : FULL_COMPUTER_ACTIONS;

const COMPUTER_MODES = new Set(["shared", "background-semantic", "isolated-session"]);

const unavailableEnvelope = (errorMessage: string): Record<string, unknown> => ({
  ok: false,
  platform: process.platform,
  error: {
    kind: "nativeUnavailable",
    message: `Computer Use native bindings are unavailable: ${errorMessage}`
  }
});

const wrongToolFamily = (
  osRef: string,
  message: string,
  nextRecommendedAction: string
): Record<string, unknown> => ({
  ok: false,
  platform: process.platform,
  osRef,
  error: { kind: "wrongToolFamily", message },
  nextRecommendedAction
});

const redirectLyraOsRef = (osRef: string): Record<string, unknown> | null => {
  if (isLyraBrowserOsRef(osRef)) {
    return wrongToolFamily(
      osRef,
      "Lyra browser nodes are not computer tools. Use browser_ax / browser_* instead.",
      "browser_ax.map"
    );
  }
  if (isLyraTerminalOsRef(osRef)) {
    return wrongToolFamily(
      osRef,
      "Lyra terminal nodes are not computer tools. Use terminal / write_stdin instead.",
      "write_stdin"
    );
  }
  if (isLyraFileManagerOsRef(osRef)) {
    return wrongToolFamily(
      osRef,
      "Lyra file-manager nodes are not computer tools. Use workbench_read_tab or filesystem tools instead.",
      "workbench_read_tab"
    );
  }
  return null;
};

export const createComputerToolHost = ({
  resolveSensitiveValueForFill,
  visualFallback
}: {
  readonly resolveSensitiveValueForFill?: (ref: LyraSensitiveValueRef) => Promise<string>;
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
  const actions = computerActionsForPlatform();

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
      return isRecord(parsed)
        ? parsed
        : { ok: false, error: { kind: "internal", message: "Native returned a non-object result." } };
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

  const handlers: AgentHostCapabilityHandlers = {
    "lyraComputer.listApps": async (payload: unknown) => {
      const input = normalizePayload(payload);
      return invokeNative("computerListAppsJson", {
        maxApps: readClampedOptionalNumber(input, "maxApps", 50, 1, 100),
        includeBackground: input.includeBackground === true
      });
    },

    "lyraComputer.observe": async () => invokeNative("computerObserveJson", {}),

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

      const request: Record<string, unknown> = { mode: "shared" };
      const appRef = readOptionalStringField(input, "appRef");
      if (appRef !== undefined) {
        request.appRef = appRef;
      }
      const windowTitle = readOptionalStringField(input, "windowTitle");
      if (windowTitle !== undefined) {
        request.windowTitle = windowTitle;
      }
      const windowRef = readOptionalStringField(input, "windowRef");
      if (windowRef !== undefined) {
        request.windowRef = windowRef;
      }
      if (process.platform !== "linux") {
        const pid = input.pid;
        if (typeof pid === "number") {
          request.pid = pid;
        }
      }
      if (
        request.appRef === undefined
        && request.pid === undefined
        && request.windowTitle === undefined
        && request.windowRef === undefined
      ) {
        return {
          ok: false,
          error: {
            kind: "invalidArgument",
            message: process.platform === "linux"
              ? "computer.focus requires appRef, windowTitle, or windowRef."
              : "computer.focus requires appRef, pid, windowTitle, or windowRef."
          }
        };
      }
      return invokeNative("computerFocusJson", request);
    },

    "lyraComputer.map": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const strategy = readOptionalStringField(input, "strategy");
      return invokeNative("computerMapJson", {
        strategy: strategy === "document" ? "document" : "interactive",
        maxNodes: readClampedOptionalNumber(input, "maxNodes", 200, 1, 400)
      });
    },

    "lyraComputer.find": async (payload: unknown) => {
      const input = normalizePayload(payload);
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
      const redirected = redirectLyraOsRef(osRef);
      if (redirected !== null) {
        return redirected;
      }
      const actionValue = readOptionalStringField(input, "action") ?? "press";
      if (!actions.has(actionValue)) {
        return {
          ok: false,
          error: {
            kind: "unsupportedAction",
            message: process.platform === "linux"
              ? `Unknown or unsupported computer action "${actionValue}" on Linux AT-SPI.`
              : `Unknown computer action "${actionValue}".`
          }
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
      const key = readOptionalStringField(input, "key");
      if (key !== undefined) {
        request.key = key;
      }
      const actionName = readOptionalStringField(input, "actionName");
      if (actionName !== undefined) {
        request.actionName = actionName;
      }
      const direction = readOptionalStringField(input, "direction");
      if (direction !== undefined) {
        request.direction = direction;
      }
      const pages = readOptionalNumberField(input, "pages");
      if (pages !== undefined) {
        request.pages = pages;
      }
      const fromX = readOptionalNumberField(input, "fromX");
      if (fromX !== undefined) {
        request.fromX = fromX;
      }
      const fromY = readOptionalNumberField(input, "fromY");
      if (fromY !== undefined) {
        request.fromY = fromY;
      }
      const toX = readOptionalNumberField(input, "toX");
      if (toX !== undefined) {
        request.toX = toX;
      }
      const toY = readOptionalNumberField(input, "toY");
      if (toY !== undefined) {
        request.toY = toY;
      }
      return invokeNative("computerActJson", request);
    },

    "lyraComputer.diff": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const osRef = readOptionalStringField(input, "osRef");
      if (osRef !== undefined) {
        const redirected = redirectLyraOsRef(osRef);
        if (redirected !== null) {
          return redirected;
        }
      }
      const baselineSnapshotId = readOptionalStringField(input, "baselineSnapshotId");
      if (baselineSnapshotId !== undefined && baselineSnapshotId.startsWith("lyt-read-")) {
        return {
          ok: false,
          platform: process.platform,
          error: {
            kind: "wrongToolFamily",
            message: "Lyra terminal snapshots are not computer tools. Use terminal tools instead."
          },
          nextRecommendedAction: "write_stdin"
        };
      }
      if (baselineSnapshotId !== undefined) {
        const strategy = readOptionalStringField(input, "strategy");
        return invokeNative("computerDiffJson", {
          baselineSnapshotId,
          strategy: strategy === "document" ? "document" : "interactive",
          maxNodes: readClampedOptionalNumber(input, "maxNodes", 200, 1, 400)
        });
      }
      if (osRef === undefined) {
        return {
          ok: false,
          error: {
            kind: "invalidArgument",
            message: "computer.diff requires osRef or baselineSnapshotId."
          }
        };
      }
      return invokeNative("computerDiffJson", { osRef });
    },

    "lyraComputer.explain": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const osRef = readOptionalStringField(input, "osRef");
      if (osRef !== undefined) {
        const redirected = redirectLyraOsRef(osRef);
        if (redirected !== null) {
          return redirected;
        }
      }
      const request: Record<string, unknown> = {};
      if (osRef !== undefined) {
        request.osRef = osRef;
      }
      return invokeNative("computerExplainJson", request);
    },

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
