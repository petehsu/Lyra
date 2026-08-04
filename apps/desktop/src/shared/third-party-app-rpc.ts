const THIRD_PARTY_APP_RPC_ARGUMENT_PREFIX = "--lyra-third-party-rpc-channel=";

const THIRD_PARTY_APP_RPC_METHOD_PATTERN =
  /^[a-z][a-z0-9]*(?:[._-][a-z][a-z0-9]*){1,7}$/;

const isThirdPartyAppRpcMethod = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 96 &&
  THIRD_PARTY_APP_RPC_METHOD_PATTERN.test(value);

type ThirdPartyAppRpcRequest = {
  readonly method: string;
  readonly payload: unknown;
};

export {
  THIRD_PARTY_APP_RPC_ARGUMENT_PREFIX,
  isThirdPartyAppRpcMethod
};
export type { ThirdPartyAppRpcRequest };
