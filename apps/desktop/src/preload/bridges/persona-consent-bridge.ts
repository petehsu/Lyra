import { ipcRenderer } from "electron";

import { LYRA_CHANNELS } from "../../shared/desktop-bridge";
import type { AgentApi, AgentPersonaConsent } from "../../shared/agent";

type PersonaConsentBridgeApi = Pick<
  AgentApi,
  "readPersonaConsent" | "updatePersonaConsent"
>;

export const createPersonaConsentBridgeApi = (): PersonaConsentBridgeApi => ({
  readPersonaConsent: () =>
    ipcRenderer.invoke(LYRA_CHANNELS.personaConsentRead) as Promise<AgentPersonaConsent>,
  updatePersonaConsent: (enabled) =>
    ipcRenderer.invoke(LYRA_CHANNELS.personaConsentWrite, {
      osintEnabled: enabled,
      grantedAt: enabled ? new Date().toISOString() : null
    }) as Promise<AgentPersonaConsent>
});
