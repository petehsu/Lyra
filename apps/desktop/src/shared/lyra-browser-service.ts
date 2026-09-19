import { LYRA_BROWSER_CDP_PROTOCOL_VERSION } from "./lyra-browser-api";

export const LYRA_BROWSER_SERVICE_NAME = "lyra-browser-service";
export const LYRA_BROWSER_SERVICE_SPAWN_POLICY = "onDemand";
export const LYRA_BROWSER_SERVICE_TRANSPORT = "cdp";
export const LYRA_BROWSER_SERVICE_CDP_PROTOCOL_VERSION = LYRA_BROWSER_CDP_PROTOCOL_VERSION;
export const LYRA_BROWSER_SERVICE_API = "LyraBrowserApi";
export const LYRA_BROWSER_SERVICE_CDP_INSPECTOR = "@lyra/browser-automation";
export const LYRA_BROWSER_SERVICE_ELECTRON_ADAPTER = "apps/desktop/src/main/workbench-browser";

export const LYRA_BROWSER_SERVICE_EXCLUDED_COMPONENT_IDS = [
  "lyra.runtime",
  "lyra.browser"
] as const;

export type LyraBrowserServiceSpawnPolicy = typeof LYRA_BROWSER_SERVICE_SPAWN_POLICY;
export type LyraBrowserServiceTransport = typeof LYRA_BROWSER_SERVICE_TRANSPORT;

export const isLyraBrowserServiceName = (value: string): boolean =>
  value === LYRA_BROWSER_SERVICE_NAME;

export const isLyraBrowserServiceComponentId = (value: string): boolean =>
  (LYRA_BROWSER_SERVICE_EXCLUDED_COMPONENT_IDS as readonly string[]).includes(value) === false
  && isLyraBrowserServiceName(value);
