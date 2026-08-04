import type { FirstPartyUiRuntimeV1 } from "./runtime";
import { FIRST_PARTY_UI_RUNTIME_VERSION } from "./runtime";

export type { FirstPartyUiRuntimeV1 } from "./runtime";
export { FIRST_PARTY_UI_RUNTIME_VERSION } from "./runtime";

export const installFirstPartyUiRuntime = (
  runtime: Omit<FirstPartyUiRuntimeV1, "version">
): void => {
  const existing = globalThis.__LYRA_FIRST_PARTY_UI_RUNTIME_V1__;
  if (existing !== undefined) {
    if (existing.version !== FIRST_PARTY_UI_RUNTIME_VERSION) {
      throw new Error("A different Lyra first-party UI runtime is already installed.");
    }
    return;
  }
  globalThis.__LYRA_FIRST_PARTY_UI_RUNTIME_V1__ = Object.freeze({
    version: FIRST_PARTY_UI_RUNTIME_VERSION,
    ...runtime
  });
};
