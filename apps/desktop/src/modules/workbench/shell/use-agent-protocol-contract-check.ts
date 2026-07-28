import { useEffect } from "react";

import { EXPECTED_PROTOCOL_VERSION } from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

export const useAgentProtocolContractCheck = (
  desktopApi: Pick<LyraDesktopApi, "agent"> | null
): void => {
  useEffect(() => {
    const api = desktopApi?.agent;
    if (api === undefined) {
      return;
    }
    void api.readProtocolContract().then(
      (contract) => {
        if (contract.protocolVersion !== EXPECTED_PROTOCOL_VERSION) {
          console.warn(
            `[lyra] protocol version mismatch: frontend=${EXPECTED_PROTOCOL_VERSION}, runtime=${contract.protocolVersion}. Please upgrade Lyra.`
          );
        }
      },
      (error: unknown) => {
        console.warn(`[lyra] failed to read protocol contract: ${error}`);
      }
    );
  }, [desktopApi]);
};
