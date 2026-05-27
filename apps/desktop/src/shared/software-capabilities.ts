export type LyraCapabilityRisk =
  | "read"
  | "navigate"
  | "write"
  | "external"
  | "destructive";

export type LyraSoftwareActionManifest = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly risk: LyraCapabilityRisk;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
};

export type LyraSoftwareManifest = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category?: string;
  readonly version?: string;
  readonly source: "builtin" | "uiux";
  readonly sourceId?: string;
  readonly actions: readonly LyraSoftwareActionManifest[];
};

export type SoftwareListCapabilitiesRequest = {
  readonly includeSchemas?: boolean;
};

export type SoftwareListCapabilitiesResponse = {
  readonly software: readonly LyraSoftwareManifest[];
};

export type SoftwareInspectCapabilityRequest = {
  readonly softwareId: string;
  readonly actionId?: string;
};

export type SoftwareInspectCapabilityResponse = {
  readonly software: LyraSoftwareManifest;
  readonly action?: LyraSoftwareActionManifest;
  readonly handlerRegistered: boolean;
};

export type SoftwareInvokeCapabilityRequest = {
  readonly softwareId: string;
  readonly actionId: string;
  readonly input?: unknown;
  readonly reason?: string;
};

export type SoftwareInvokeCapabilityResponse = {
  readonly softwareId: string;
  readonly actionId: string;
  readonly output?: unknown;
};

export type LyraSoftwareActionContext = {
  readonly softwareId: string;
  readonly actionId: string;
  readonly reason?: string;
};

export type LyraSoftwareActionHandler = (
  input: unknown,
  context: LyraSoftwareActionContext
) => unknown | Promise<unknown>;

export type LyraSoftwareCapabilitiesContext = {
  readonly software: readonly LyraSoftwareManifest[];
  readonly registerActionHandler: (
    actionId: string,
    handler: LyraSoftwareActionHandler
  ) => () => void;
};

export type SoftwareCapabilitiesQueryRequest =
  | {
      readonly requestId: string;
      readonly method: "software.listCapabilities";
      readonly payload: SoftwareListCapabilitiesRequest;
    }
  | {
      readonly requestId: string;
      readonly method: "software.inspectCapability";
      readonly payload: SoftwareInspectCapabilityRequest;
    }
  | {
      readonly requestId: string;
      readonly method: "software.invokeCapability";
      readonly payload: SoftwareInvokeCapabilityRequest;
    };

export type SoftwareCapabilitiesQueryResult =
  | {
      readonly requestId: string;
      readonly ok: true;
      readonly result:
        | SoftwareListCapabilitiesResponse
        | SoftwareInspectCapabilityResponse
        | SoftwareInvokeCapabilityResponse;
    }
  | {
      readonly requestId: string;
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };
