import type { McpCenterState } from "./types";

export const createDraftId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Math.random().toString(16).slice(2, 10)}`;
};

export const createInitialState = (): McpCenterState => ({
  status: "idle",
  panelMode: "details",
  preferredScope: "global",
  statusFilter: "all",
  catalog: [],
  globalServers: [],
  projectServers: [],
  effectiveConfig: {
    servers: []
  },
  selectedServerId: null,
  selectedCatalogId: null,
  validationByServerId: {},
  introspectionByServerId: {},
  runtimeByServerId: {},
  draft: null,
  presetDraft: null,
  errorMessage: null
});
