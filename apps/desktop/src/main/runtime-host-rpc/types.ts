export type RuntimeHostRpcHandler = (payload: unknown) => Promise<unknown> | unknown;

export type RuntimeHostRpcService = {
  readonly registerHandler: (method: string, handler: RuntimeHostRpcHandler) => () => void;
  readonly dispose: () => void;
};
