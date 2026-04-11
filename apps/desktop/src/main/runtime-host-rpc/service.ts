import type { LyraRuntimeClient } from "../runtime-client";
import type { RuntimeHostRpcHandler, RuntimeHostRpcService } from "./types";

export const createRuntimeHostRpcService = ({
  runtimeClient
}: {
  readonly runtimeClient: LyraRuntimeClient;
}): RuntimeHostRpcService => {
  const registeredMethods = new Set<string>();

  return {
    registerHandler: (method: string, handler: RuntimeHostRpcHandler) => {
      runtimeClient.registerRequestHandler(method, handler);
      registeredMethods.add(method);
      return () => {
        runtimeClient.unregisterRequestHandler(method);
        registeredMethods.delete(method);
      };
    },
    dispose: () => {
      for (const method of registeredMethods) {
        runtimeClient.unregisterRequestHandler(method);
      }
      registeredMethods.clear();
    }
  };
};
