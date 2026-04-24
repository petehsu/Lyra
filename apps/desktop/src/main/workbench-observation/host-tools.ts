import type { CapabilityInvocationContext } from "@lyra/capability-protocol";

import type { CapabilitiesIpcBridge } from "../capabilities/types";
import type { LyraRuntimeClient } from "../runtime-client";
import type { RuntimeHostRpcService } from "../runtime-host-rpc/types";

const WORKBENCH_HOST_TOOL_SET_ID = "desktop.workbench";
type HostToolsSyncResult = {
  readonly acceptedCount: number;
  readonly droppedAsLyraOwnedCount: number;
  readonly droppedToolNames: readonly string[];
};

type HostToolInvocationPayload = {
  readonly toolName?: unknown;
  readonly arguments?: unknown;
  readonly context?: unknown;
};

type HostToolConfig = {
  readonly capabilityId: string;
};

type WorkbenchHostToolsBridge = {
  readonly dispose: () => void;
  readonly sync: () => Promise<void>;
};

const HOST_TOOL_CONFIGS: readonly HostToolConfig[] = [
  { capabilityId: "workbench.tabs.list" },
  { capabilityId: "workbench.document.inspect" },
  { capabilityId: "workbench.document.read" },
  { capabilityId: "workbench.workspace.read" },
  { capabilityId: "workbench.tab.read" },
  { capabilityId: "workbench.document.search" },
  { capabilityId: "workbench.tab.extract_text" },
  { capabilityId: "workbench.tab.capture_visual" }
];

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const toCapabilityContext = (value: unknown): CapabilityInvocationContext => {
  const record = asRecord(value);
  const aiSessionId = readString(record.agentSessionId);
  const aiTurnId = readString(record.agentTurnId);
  const projectRoot = readString(record.projectRoot);
  const workspaceRoot = readString(record.workspaceRoot);
  const appInstanceId = readString(record.appInstanceId);
  return {
    ...(aiSessionId === undefined ? {} : { aiSessionId }),
    ...(aiTurnId === undefined ? {} : { aiTurnId }),
    ...(projectRoot === undefined ? {} : { projectRoot }),
    ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
    ...(appInstanceId === undefined ? {} : { appInstanceId })
  };
};

const buildHostToolsPayload = (
  capabilitiesBridge: CapabilitiesIpcBridge
): {
  readonly toolSetId: string;
  readonly tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
    readonly outputSchema: Record<string, unknown>;
    readonly executionMode: "serial";
    readonly approvalMode: "auto";
    readonly sideEffects: {
      readonly level: "read_only";
      readonly mutatesWorkspace: false;
      readonly mutatesMemory: false;
      readonly mutatesExternalSystems: false;
      readonly mutatesSessionState: false;
      readonly opensInteractiveSession: false;
      readonly readsNetwork: false;
    };
    readonly hostMethod: string;
  }[];
} => {
  const byId = new Map(
    capabilitiesBridge
      .listCapabilities({ domain: "workbench" })
      .map((descriptor) => [descriptor.id, descriptor] as const)
  );

  return {
    toolSetId: WORKBENCH_HOST_TOOL_SET_ID,
    tools: HOST_TOOL_CONFIGS.flatMap((config) => {
      const descriptor = byId.get(config.capabilityId);
      if (descriptor === undefined) {
        return [];
      }
      return [{
        name: descriptor.id,
        description: descriptor.description ?? descriptor.title,
        inputSchema: descriptor.inputSchema as Record<string, unknown>,
        outputSchema: descriptor.outputSchema as Record<string, unknown>,
        executionMode: "serial" as const,
        approvalMode: "auto" as const,
        sideEffects: {
          level: "read_only" as const,
          mutatesWorkspace: false as const,
          mutatesMemory: false as const,
          mutatesExternalSystems: false as const,
          mutatesSessionState: false as const,
          opensInteractiveSession: false as const,
          readsNetwork: false as const
        },
        hostMethod: descriptor.id
      }];
    })
  };
};

export const createWorkbenchObservationHostToolsBridge = ({
  capabilitiesBridge,
  runtimeClient,
  runtimeHostRpc
}: {
  readonly capabilitiesBridge: CapabilitiesIpcBridge;
  readonly runtimeClient: LyraRuntimeClient;
  readonly runtimeHostRpc: RuntimeHostRpcService;
}): WorkbenchHostToolsBridge => {
  const requestLyraRuntime = async <T>(method: string, params: unknown): Promise<T> =>
    await runtimeClient.request<T>("lyra.runtime.request", { method, params });
  const disposers = HOST_TOOL_CONFIGS.map((config) =>
    runtimeHostRpc.registerHandler(config.capabilityId, async (payload: unknown) => {
      const request = asRecord(payload) as HostToolInvocationPayload;
      const response = await capabilitiesBridge.invokeCapability({
        capabilityId: config.capabilityId,
        payload: request.arguments ?? {},
        context: toCapabilityContext(request.context)
      });
      if (!response.ok) {
        throw Object.assign(new Error(response.error?.message ?? `${config.capabilityId} failed`), {
          code: response.error?.code ?? "CAPABILITY_INVOKE_FAILED",
          ...(response.error?.details === undefined ? {} : { details: response.error.details })
        });
      }
      return response.result ?? null;
    })
  );

  return {
    dispose: () => {
      for (const dispose of disposers) {
        dispose();
      }
      void requestLyraRuntime("lyra/runtime/hostTools/remove", {
        toolSetId: WORKBENCH_HOST_TOOL_SET_ID
      }).catch(() => undefined);
    },
    sync: async () => {
      await requestLyraRuntime<HostToolsSyncResult>(
        "lyra/runtime/hostTools/sync",
        buildHostToolsPayload(capabilitiesBridge)
      );
    }
  };
};
