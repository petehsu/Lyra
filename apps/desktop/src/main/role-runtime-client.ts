import type {
  LyraRuntimeClient,
  RuntimeEventListener,
  RuntimeRequestHandler
} from "./runtime-client";
import {
  createSharedProcessClient,
  type SharedProcessClientOptions
} from "./shared-process/shared-process-client";

export const RUNTIME_HOST_ROLES = [
  "agent",
  "terminal",
  "files",
  "scheduler",
  "services"
] as const;

export type RuntimeHostRole = (typeof RUNTIME_HOST_ROLES)[number];

export const runtimeRoleForMethod = (method: string): RuntimeHostRole => {
  if (method.startsWith("terminal.")) return "terminal";
  if (method.startsWith("files.")) return "files";
  if (method.startsWith("agent.")) return "agent";
  if (method.startsWith("scheduler.")) return "scheduler";
  return "services";
};

type RoleClientOptions = Omit<SharedProcessClientOptions, "hostRole" | "serviceName" | "restartOnExit">;

export const createRoleRuntimeClient = (
  options: RoleClientOptions
): LyraRuntimeClient & { readonly shutdown: () => Promise<void> } => {
  const clients = new Map(
    RUNTIME_HOST_ROLES.map((role) => [
      role,
      createSharedProcessClient({
        ...options,
        hostRole: role,
        serviceName: `lyra-${role}`,
        restartOnExit: true
      })
    ])
  );
  for (const client of clients.values()) {
    void client.request("runtime.identity", {}).catch((error: unknown) => {
      console.warn(
        `[lyra-host] host did not start: ${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  const clientFor = (method: string) => {
    const client = clients.get(runtimeRoleForMethod(method));
    if (client === undefined) {
      throw new Error(`No runtime host for ${method}`);
    }
    return client;
  };

  return {
    request: <T>(method: string, payload: unknown): Promise<T> =>
      clientFor(method).request<T>(method, payload),
    registerRequestHandler: (method: string, handler: RuntimeRequestHandler) => {
      for (const client of clients.values()) {
        client.registerRequestHandler(method, handler);
      }
    },
    unregisterRequestHandler: (method: string) => {
      for (const client of clients.values()) {
        client.unregisterRequestHandler(method);
      }
    },
    subscribe: (listener: RuntimeEventListener) => {
      const unsubscribe = [...clients.values()].map((client) => client.subscribe(listener));
      return () => {
        for (const stop of unsubscribe) {
          stop();
        }
      };
    },
    dispose: () => {
      for (const client of clients.values()) {
        client.dispose();
      }
    },
    shutdown: async () => {
      await Promise.all([...clients.values()].map((client) => client.shutdown()));
    }
  };
};
