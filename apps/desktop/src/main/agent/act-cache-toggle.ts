// Process-global ActCache toggle. Mirrors the in-memory browserFollowMode
// pattern (service.ts:60-66) but lives in its own module so both the browser
// bridge (created in index.ts) and the agent service (service.ts) can read it
// without re-threading constructor params. Not persisted across restarts —
// like follow mode, it defaults off and is controlled at runtime via the
// settings panel IPC.

let actCacheEnabled = false;

export const readActCacheEnabled = (): boolean => actCacheEnabled;

export const writeActCacheEnabled = (enabled: boolean): void => {
  actCacheEnabled = enabled === true;
};

export type AgentActCacheController = {
  readonly read: typeof readActCacheEnabled;
  readonly set: typeof writeActCacheEnabled;
};

export const actCacheController: AgentActCacheController = {
  read: readActCacheEnabled,
  set: writeActCacheEnabled
};