import { contextBridge, ipcRenderer } from "electron";

import {
  THIRD_PARTY_APP_RPC_ARGUMENT_PREFIX,
  isThirdPartyAppRpcMethod,
  type ThirdPartyAppRpcRequest
} from "../shared/third-party-app-rpc";

const rpcArgument = process.argv.find((argument) =>
  argument.startsWith(THIRD_PARTY_APP_RPC_ARGUMENT_PREFIX)
);
const rpcChannel = rpcArgument?.slice(THIRD_PARTY_APP_RPC_ARGUMENT_PREFIX.length) ?? "";

if (/^lyra:third-party-app:[a-f0-9]{32}$/.test(rpcChannel)) {
  contextBridge.exposeInMainWorld("lyra", Object.freeze({
    invoke: (method: string, payload: unknown = null): Promise<unknown> => {
      if (!isThirdPartyAppRpcMethod(method)) {
        return Promise.reject(new Error("Invalid Lyra RPC method."));
      }
      const request: ThirdPartyAppRpcRequest = { method, payload };
      return ipcRenderer.invoke(rpcChannel, request);
    }
  }));
}
