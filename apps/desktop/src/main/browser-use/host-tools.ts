import type { CapabilityInvocationContext } from "@lyra/capability-protocol";

import type { CapabilitiesIpcBridge } from "../capabilities/types";
import type { LyraRuntimeClient } from "../runtime-client";
import type { RuntimeHostRpcService } from "../runtime-host-rpc/types";

const BROWSER_USE_TOOL_SET_ID = "desktop.browser_use";

type HostToolSideEffectLevel =
  | "read_only"
  | "network_read"
  | "session_mutation"
  | "workspace_write"
  | "external_mutation";

const HOST_TOOL_CONFIGS = [
  {
    capabilityId: "browser_use.session.prepare",
    approvalMode: "auto" as const,
    sideEffects: {
      level: "session_mutation" as const,
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: true,
      opensInteractiveSession: true,
      readsNetwork: false,
    },
  },
  {
    capabilityId: "browser_use.page.state",
    approvalMode: "auto" as const,
    sideEffects: {
      level: "read_only" as const,
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: false,
      opensInteractiveSession: false,
      readsNetwork: false,
    },
  },
  {
    capabilityId: "browser_use.page.extract",
    approvalMode: "auto" as const,
    sideEffects: {
      level: "read_only" as const,
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: false,
      opensInteractiveSession: false,
      readsNetwork: false,
    },
  },
  {
    capabilityId: "browser_use.page.safe",
    approvalMode: "auto" as const,
    sideEffects: {
      level: "session_mutation" as const,
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: true,
      opensInteractiveSession: false,
      readsNetwork: false,
    },
  },
  {
    capabilityId: "browser_use.page.mutate",
    approvalMode: "ask" as const,
    sideEffects: {
      level: "external_mutation" as const,
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: true,
      mutatesSessionState: true,
      opensInteractiveSession: false,
      readsNetwork: false,
    },
  },
  {
    capabilityId: "browser_use.page.navigate",
    approvalMode: "ask" as const,
    sideEffects: {
      level: "network_read" as const,
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: true,
      opensInteractiveSession: false,
      readsNetwork: true,
    },
  },
  {
    capabilityId: "browser_use.page.wait",
    approvalMode: "auto" as const,
    sideEffects: {
      level: "read_only" as const,
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: false,
      opensInteractiveSession: false,
      readsNetwork: false,
    },
  },
  {
    capabilityId: "browser_use.agent.run",
    approvalMode: "ask" as const,
    sideEffects: {
      level: "external_mutation" as const,
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: true,
      mutatesSessionState: true,
      opensInteractiveSession: true,
      readsNetwork: true,
    },
  },
] as const;

type HostToolInvocationPayload = {
  readonly arguments?: unknown;
  readonly context?: unknown;
};

type HostToolSideEffects = {
  readonly level: HostToolSideEffectLevel;
  readonly mutatesWorkspace: boolean;
  readonly mutatesMemory: boolean;
  readonly mutatesExternalSystems: boolean;
  readonly mutatesSessionState: boolean;
  readonly opensInteractiveSession: boolean;
  readonly readsNetwork: boolean;
};

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
    ...(appInstanceId === undefined ? {} : { appInstanceId }),
  };
};

const buildPayload = (capabilitiesBridge: CapabilitiesIpcBridge) => {
  const byId = new Map(
    capabilitiesBridge
      .listCapabilities({ appId: "browser-use" })
      .map((descriptor) => [descriptor.id, descriptor] as const)
  );
  return {
    toolSetId: BROWSER_USE_TOOL_SET_ID,
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
        approvalMode: config.approvalMode,
        sideEffects: config.sideEffects as HostToolSideEffects,
        hostMethod: descriptor.id,
      }];
    }),
  };
};

export const createBrowserUseHostToolsBridge = ({
  capabilitiesBridge,
  runtimeClient,
  runtimeHostRpc,
}: {
  readonly capabilitiesBridge: CapabilitiesIpcBridge;
  readonly runtimeClient: LyraRuntimeClient;
  readonly runtimeHostRpc: RuntimeHostRpcService;
}) => {
  const disposers = HOST_TOOL_CONFIGS.map((config) =>
    runtimeHostRpc.registerHandler(config.capabilityId, async (payload: unknown) => {
      const request = asRecord(payload) as HostToolInvocationPayload;
      const response = await capabilitiesBridge.invokeCapability({
        capabilityId: config.capabilityId,
        payload: request.arguments ?? {},
        context: toCapabilityContext(request.context),
      });
      if (!response.ok) {
        throw Object.assign(new Error(response.error?.message ?? `${config.capabilityId} failed`), {
          code: response.error?.code ?? "CAPABILITY_INVOKE_FAILED",
          ...(response.error?.details === undefined ? {} : { details: response.error.details }),
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
      void runtimeClient.request("agent.host_tools.remove", {
        toolSetId: BROWSER_USE_TOOL_SET_ID,
      }).catch(() => undefined);
    },
    remove: async () => {
      await runtimeClient.request("agent.host_tools.remove", {
        toolSetId: BROWSER_USE_TOOL_SET_ID,
      });
    },
    sync: async () => {
      await runtimeClient.request("agent.host_tools.sync", buildPayload(capabilitiesBridge));
    },
  };
};
