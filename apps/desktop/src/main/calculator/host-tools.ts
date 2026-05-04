import type { LyraRuntimeClient } from "../runtime-client";
import type { RuntimeHostRpcService } from "../runtime-host-rpc/types";
import { createCalculatorService } from "./service";

const CALCULATOR_TOOL_SET_ID = "desktop.calculator";
const CALCULATOR_TOOL_NAME = "calculator.evaluate";

type HostToolsSyncResult = {
  readonly acceptedCount: number;
  readonly droppedAsLyraOwnedCount: number;
  readonly droppedToolNames: readonly string[];
};

type HostToolSideEffects = {
  readonly level: "read_only";
  readonly mutatesWorkspace: false;
  readonly mutatesMemory: false;
  readonly mutatesExternalSystems: false;
  readonly mutatesSessionState: false;
  readonly opensInteractiveSession: false;
  readonly readsNetwork: false;
};

const READ_ONLY_SIDE_EFFECTS: HostToolSideEffects = {
  level: "read_only",
  mutatesWorkspace: false,
  mutatesMemory: false,
  mutatesExternalSystems: false,
  mutatesSessionState: false,
  opensInteractiveSession: false,
  readsNetwork: false
};

const INPUT_SCHEMA = {
  type: "object",
  required: ["expression"],
  properties: {
    expression: {
      type: "string",
      description: "Math expression or calculation request."
    },
    mode: {
      type: "string",
      enum: ["auto", "exact", "numeric", "symbolic", "matrix", "statistics", "unit"]
    },
    variables: {
      type: "object",
      additionalProperties: {
        anyOf: [
          { type: "number" },
          { type: "string" },
          {
            type: "object",
            required: ["real"],
            properties: {
              real: { type: "number" },
              imaginary: { type: "number" }
            },
            additionalProperties: false
          }
        ]
      }
    },
    precision: {
      type: "number",
      description: "Requested decimal precision. Defaults to 50 and is capped at 1000."
    },
    timeoutMs: {
      type: "number",
      description: "Maximum execution time in milliseconds. Defaults to 2000 and is capped at 10000."
    },
    wantSteps: {
      type: "boolean",
      description: "When true, advanced engines may include compact derivation details."
    }
  },
  additionalProperties: false
} as const;

const buildHostToolsPayload = () => ({
  toolSetId: CALCULATOR_TOOL_SET_ID,
  tools: [{
    name: CALCULATOR_TOOL_NAME,
    hostMethod: CALCULATOR_TOOL_NAME,
    description: [
      "Fast, accurate local calculator for Agent use.",
      "Use for arithmetic, high precision numeric work, symbolic math, equations, matrices, statistics, and unit conversions.",
      "Prefer this over mental calculation whenever a computed result matters."
    ].join(" "),
    inputSchema: INPUT_SCHEMA,
    outputSchema: { type: "object" },
    executionMode: "serial" as const,
    approvalMode: "auto" as const,
    sideEffects: READ_ONLY_SIDE_EFFECTS,
    risk: { level: "low" },
    modelInputCapabilities: ["text"]
  }]
});

export const createCalculatorHostToolsBridge = ({
  runtimeClient,
  runtimeHostRpc,
  storageRoot
}: {
  readonly runtimeClient: LyraRuntimeClient;
  readonly runtimeHostRpc: RuntimeHostRpcService;
  readonly storageRoot: string;
}) => {
  const calculatorService = createCalculatorService({ storageRoot });
  const requestLyraRuntime = async <T>(method: string, params: unknown): Promise<T> =>
    await runtimeClient.request<T>("lyra.runtime.request", { method, params });
  const disposeHandler = runtimeHostRpc.registerHandler(
    CALCULATOR_TOOL_NAME,
    async (payload: unknown) => await calculatorService.evaluate({ arguments: (payload as { arguments?: unknown })?.arguments })
  );

  return {
    nativeLoadResult: calculatorService.nativeLoadResult,
    dispose: () => {
      disposeHandler();
      void requestLyraRuntime("lyra/runtime/hostTools/remove", {
        toolSetId: CALCULATOR_TOOL_SET_ID
      }).catch(() => undefined);
    },
    sync: async () => {
      await requestLyraRuntime<HostToolsSyncResult>(
        "lyra/runtime/hostTools/sync",
        buildHostToolsPayload()
      );
    }
  };
};
