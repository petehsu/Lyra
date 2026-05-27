import type {
  LyraSoftwareCapabilitiesContext,
  LyraSoftwareManifest,
  SoftwareCapabilitiesQueryRequest,
  SoftwareCapabilitiesQueryResult
} from "../../../shared/desktop-bridge";

export type SoftwareCapabilitiesRegistryModel = {
  readonly software: readonly LyraSoftwareManifest[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly handleBridgeQuery: (
    request: SoftwareCapabilitiesQueryRequest
  ) => Promise<SoftwareCapabilitiesQueryResult> | SoftwareCapabilitiesQueryResult;
  readonly createUiPackCapabilities: (
    packId: string,
    software: readonly LyraSoftwareManifest[]
  ) => LyraSoftwareCapabilitiesContext;
};
