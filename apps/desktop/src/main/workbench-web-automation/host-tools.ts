import type { CapabilityInvocationContext } from "@lyra/capability-protocol";

import type { CapabilitiesIpcBridge } from "../capabilities/types";
import type { LyraRuntimeClient } from "../runtime-client";
import type { RuntimeHostRpcService } from "../runtime-host-rpc/types";

const WEB_AUTOMATION_TOOL_SET_ID = "desktop.web_automation";

type HostToolInvocationPayload = {
  readonly toolName?: unknown;
  readonly arguments?: unknown;
  readonly context?: unknown;
};

type HostToolConfig = {
  readonly capabilityId: string;
  readonly approvalMode: "auto" | "ask";
  readonly sideEffects: {
    readonly level: "read_only" | "network_read" | "session_mutation";
    readonly mutatesWorkspace: boolean;
    readonly mutatesMemory: boolean;
    readonly mutatesExternalSystems: boolean;
    readonly mutatesSessionState: boolean;
    readonly opensInteractiveSession: boolean;
    readonly readsNetwork: boolean;
  };
};

type WorkbenchWebAutomationHostToolsBridge = {
  readonly dispose: () => void;
  readonly sync: () => Promise<void>;
};

const HOST_TOOL_CONFIGS: readonly HostToolConfig[] = [
  {
    capabilityId: "lyra.web.skeleton.read",
    approvalMode: "auto",
    sideEffects: {
      level: "read_only",
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: false,
      opensInteractiveSession: false,
      readsNetwork: false
    }
  },
  {
    capabilityId: "lyra.web.query.find",
    approvalMode: "auto",
    sideEffects: {
      level: "read_only",
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: false,
      opensInteractiveSession: false,
      readsNetwork: false
    }
  },
  {
    capabilityId: "lyra.web.context.read",
    approvalMode: "auto",
    sideEffects: {
      level: "read_only",
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: false,
      opensInteractiveSession: false,
      readsNetwork: false
    }
  },
  {
    capabilityId: "lyra.web.focus.probe",
    approvalMode: "auto",
    sideEffects: {
      level: "read_only",
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: false,
      opensInteractiveSession: false,
      readsNetwork: false
    }
  },
  {
    capabilityId: "lyra.web.scan.act",
    approvalMode: "auto",
    sideEffects: {
      level: "session_mutation",
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: true,
      opensInteractiveSession: false,
      readsNetwork: true
    }
  },
  {
    capabilityId: "lyra.web.action.safe",
    approvalMode: "auto",
    sideEffects: {
      level: "read_only",
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: false,
      opensInteractiveSession: false,
      readsNetwork: false
    }
  },
  {
    capabilityId: "lyra.web.action.mutate",
    approvalMode: "auto",
    sideEffects: {
      level: "session_mutation",
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: true,
      opensInteractiveSession: false,
      readsNetwork: false
    }
  },
  {
    capabilityId: "lyra.web.action.navigate",
    approvalMode: "auto",
    sideEffects: {
      level: "network_read",
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: true,
      opensInteractiveSession: false,
      readsNetwork: true
    }
  },
  {
    capabilityId: "lyra.web.action.wait",
    approvalMode: "auto",
    sideEffects: {
      level: "read_only",
      mutatesWorkspace: false,
      mutatesMemory: false,
      mutatesExternalSystems: false,
      mutatesSessionState: false,
      opensInteractiveSession: false,
      readsNetwork: false
    }
  }
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
    readonly approvalMode: "auto" | "ask";
    readonly sideEffects: HostToolConfig["sideEffects"];
    readonly hostMethod: string;
  }[];
} => {
  const byId = new Map(
    capabilitiesBridge
      .listCapabilities({ domain: "workbench" })
      .map((descriptor) => [descriptor.id, descriptor] as const)
  );

  return {
    toolSetId: WEB_AUTOMATION_TOOL_SET_ID,
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
        sideEffects: config.sideEffects,
        hostMethod: descriptor.id
      }];
    })
  };
};

export const createWorkbenchWebAutomationHostToolsBridge = ({
  capabilitiesBridge,
  runtimeClient,
  runtimeHostRpc
}: {
  readonly capabilitiesBridge: CapabilitiesIpcBridge;
  readonly runtimeClient: LyraRuntimeClient;
  readonly runtimeHostRpc: RuntimeHostRpcService;
}): WorkbenchWebAutomationHostToolsBridge => {
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
      void runtimeClient.request("agent.host_tools.remove", {
        toolSetId: WEB_AUTOMATION_TOOL_SET_ID
      }).catch(() => undefined);
    },
    sync: async () => {
      await runtimeClient.request("agent.host_tools.sync", buildHostToolsPayload(capabilitiesBridge));
    }
  };
};
