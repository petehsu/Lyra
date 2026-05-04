import type {
  McpCatalogItem,
  McpEffectiveConfig,
  McpInstallKind,
  McpIntrospectionSnapshot,
  McpRuntimeStatus,
  McpServerId,
  McpServerConfig,
  McpServerRequest,
  McpReadEffectiveServersRequest,
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
  readonly readCatalog: () => readonly McpCatalogItem[];
  readonly readEffectiveServers: (
    request?: McpReadEffectiveServersRequest
  ) => Promise<McpEffectiveConfig>;
  readonly readServerIntrospection: (
    request: McpServerRequest
  ) => Promise<McpIntrospectionSnapshot>;
  readonly readServers: (
    scope: McpScope,
    projectRoot?: string
  ) => Promise<readonly McpServerConfig[]>;
};
