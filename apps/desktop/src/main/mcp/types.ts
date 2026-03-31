import type {
  McpInstallKind,
  McpIntrospectionSnapshot,
  McpRuntimeStatus,
  McpServerId,
  McpServerRequest,
  McpScope,
  McpTransport
} from "../../shared/mcp";

export type PersistedMcpEnvironmentEntry =
  | {
      readonly key: string;
      readonly mode: "plain";
      readonly value: string;
    }
  | {
      readonly key: string;
      readonly mode: "external";
      readonly externalKey: string;
    }
  | {
      readonly key: string;
      readonly mode: "secret";
      readonly secretRefId: string;
      readonly lastUpdatedAt?: string;
    };

export type PersistedMcpServerConfig = {
  readonly id: McpServerId;
  readonly serverKey: string;
  readonly source: "catalog" | "custom";
  readonly templateId?: string;
  readonly title: string;
  readonly summary: string;
  readonly description?: string;
  readonly iconKey: string;
  readonly scope: McpScope;
  readonly projectRoot?: string;
  readonly transport: McpTransport;
  readonly installKind: McpInstallKind;
  readonly command?: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly url?: string;
  readonly environment: readonly PersistedMcpEnvironmentEntry[];
  readonly permissions: readonly string[];
  readonly enabled: boolean;
  readonly autoStart: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastError?: string;
};

export type PersistedMcpScopeDocument = {
  readonly version: 1;
  readonly scope: McpScope;
  readonly projectRoot?: string;
  readonly servers: readonly PersistedMcpServerConfig[];
};

export type PersistedMcpSecretStore = {
  readonly version: 1;
  readonly secrets: Readonly<
    Record<
      string,
      {
        readonly updatedAt: string;
      }
    >
  >;
};

export type RuntimeSnapshot = {
  readonly status: McpRuntimeStatus;
  readonly introspection?: McpIntrospectionSnapshot;
};

export type McpIpcBridge = {
  readonly dispose: () => Promise<void>;
};

export type McpNativeBindings = {
  readonly registerMcpEventCallback: (listener: (eventJson: string) => void) => void;
  readonly readMcpScopeDocumentJson: (requestJson: string) => string;
  readonly writeMcpScopeDocumentJson: (requestJson: string) => void;
  readonly readMcpSecretStoreJson: (requestJson: string) => string;
  readonly writeMcpSecretStoreJson: (requestJson: string) => void;
  readonly sanitizeMcpEnvironmentJson: (requestJson: string) => string;
  readonly normalizeMcpEnvironmentInputJson: (requestJson: string) => string;
  readonly deleteMcpSecretRefsJson: (requestJson: string) => string;
  readonly mergeMcpEffectiveConfigJson: (requestJson: string) => string;
  readonly validateMcpServerJson: (requestJson: string) => string;
  readonly writeMcpManagedManifestJson: (requestJson: string) => void;
  readonly materializeMcpRuntimeEnvironmentJson: (requestJson: string) => string;
  readonly createMcpServerFromTemplateJson: (requestJson: string) => string;
  readonly readMcpRuntimeStatusesJson: () => string;
  readonly readMcpRuntimeIntrospectionJson: (requestJson: string) => string;
  readonly startMcpRuntimeJson: (requestJson: string) => string;
  readonly stopMcpRuntimeJson: (requestJson: string) => string;
  readonly restartMcpRuntimeJson: (requestJson: string) => string;
  readonly shutdownMcpRuntime: () => void;
};

export type McpNativeLoadResult =
  | {
      readonly ok: true;
      readonly bindings: McpNativeBindings;
      readonly loadedFrom: string;
    }
  | {
      readonly ok: false;
      readonly errorMessage: string;
      readonly triedPaths: readonly string[];
    };
