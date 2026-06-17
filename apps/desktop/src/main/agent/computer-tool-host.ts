import {
  loadAccessibilityNativeBindings,
  type AccessibilityNativeBindings
} from "../accessibility";
import {
  isLyraSensitiveValueRef,
  type LyraSensitiveValueRef
} from "../../shared/sensitive-value";
import type { AgentHostCapabilityHandlers } from "./host-payload";
import {
  isRecord,
  normalizePayload,
  readClampedOptionalNumber,
  readOptionalStringField,
  readStringField
} from "./host-payload";

/**
 * Computer Use tool host.
 *
 * Bridges the runtime `lyraComputer.*` capability calls to the native
 * `lyra-computer-use-core` JSON facade, which is currently exposed through the
 * macOS `lyra-accessibility-napi` shim. The host stays a thin marshaller: it
 * validates Agent input, forwards a JSON string to native, and returns the
 * parsed native envelope unchanged (native already carries `ok`/`status`/`error`
 * and the act -> diff result). See `Desktop-Computer-Use-Architecture.md`.
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
  resolveSensitiveValueForFill
}: {
  readonly resolveSensitiveValueForFill?: (ref: LyraSensitiveValueRef) => Promise<string>;
} = {}): {
  readonly handlers: AgentHostCapabilityHandlers;
} => {
  // Bindings are loaded once and cached. A failed load is also cached so we do
  // not retry dlopen on every call; the failure is surfaced per request.
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

  const handlers: AgentHostCapabilityHandlers = {
    "lyraComputer.map": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const strategy = readOptionalStringField(input, "strategy");
      const request: Record<string, unknown> = {
        strategy: strategy === "document" ? "document" : "interactive",
        maxNodes: readClampedOptionalNumber(input, "maxNodes", 200, 1, 400)
      };
      return invokeNative("computerMapJson", request);
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
      const request: Record<string, unknown> = { osRef, action: actionValue };
      const mode = readOptionalStringField(input, "mode");
      if (mode !== undefined && COMPUTER_MODES.has(mode)) {
        request.mode = mode;
      }

      // Credential autofill: resolve a sensitive-value-ref to plaintext here in
      // the main process and hand the native layer credentialFill: true. The
      // secret never enters the agent/model context, and this is the only path
      // allowed to setText into a secure (password) field.
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
      // Snapshot-diff mode: compare an earlier computer.map snapshot to a fresh
      // read. Single-node mode: re-read one node by osRef.
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
      return invokeNative("computerDiffJson", { osRef });
    },

    "lyraComputer.explain": async (payload: unknown) => {
      const input = normalizePayload(payload);
      const request: Record<string, unknown> = {};
      const osRef = readOptionalStringField(input, "osRef");
      if (osRef !== undefined) {
        request.osRef = osRef;
      }
      return invokeNative("computerExplainJson", request);
    }
  };

  return { handlers };
};
