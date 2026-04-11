export type McpServerId = string;

export type McpScope = "global" | "project";

export type McpTransport = "stdio" | "sse" | "http";

export type McpInstallKind = "npm" | "uv" | "docker" | "binary" | "manual";

export type McpRuntimePhase =
  | "stopped"
  | "starting"
  | "running"
  | "error"
  | "validating";

export type McpSecretFieldRef = {
  readonly secretRefId: string;
  readonly isSet: boolean;
  readonly lastUpdatedAt?: string;
};

export type McpEnvironmentEntry =
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
      readonly secretRef: McpSecretFieldRef;
    };

export type McpEnvironmentInput =
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
      readonly secretValue?: string;
      readonly secretRefId?: string;
    };

export type McpCapabilityHint = {
  readonly name: string;
  readonly description?: string;
};

export type McpToolExecutionMode = "parallel_readonly" | "serial";

export type McpToolApprovalMode = "auto" | "ask" | "deny";

export type McpToolSideEffectLevel =
  | "read_only"
  | "network_read"
  | "session_mutation"
  | "workspace_write"
  | "external_mutation";

export type McpToolSideEffects = {
  readonly level: McpToolSideEffectLevel;
  readonly mutatesWorkspace: boolean;
  readonly mutatesMemory: boolean;
  readonly mutatesExternalSystems: boolean;
  readonly mutatesSessionState: boolean;
  readonly opensInteractiveSession: boolean;
  readonly readsNetwork: boolean;
};

export type McpCatalogQuickSetupFieldKind = "path" | "text";

export type McpCatalogQuickSetupField = {
  readonly id: string;
  readonly kind: McpCatalogQuickSetupFieldKind;
  readonly required: boolean;
  readonly defaultValue?: string;
  readonly preferProjectRoot?: boolean;
};

export type McpCatalogQuickSetup = {
  readonly fields: readonly McpCatalogQuickSetupField[];
};

export type McpCatalogItem = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly description?: string;
  readonly iconKey: string;
  readonly official: boolean;
  readonly transports: readonly McpTransport[];
  readonly installKind: McpInstallKind;
  readonly recommendedScope: McpScope;
  readonly defaultCommand?: string;
  readonly defaultArgs: readonly string[];
  readonly defaultCwd?: string;
  readonly defaultUrl?: string;
  readonly defaultEnvironment: readonly McpEnvironmentEntry[];
  readonly permissions: readonly string[];
  readonly tools: readonly McpIntrospectionItem[];
  readonly resources: readonly McpCapabilityHint[];
  readonly prompts: readonly McpCapabilityHint[];
  readonly quickSetup?: McpCatalogQuickSetup;
};

export type McpRuntimeStatus = {
  readonly serverId: McpServerId;
  readonly phase: McpRuntimePhase;
  readonly transport: McpTransport;
  readonly updatedAt: string;
  readonly message?: string;
  readonly pid?: number;
};

export type McpServerConfig = {
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
  readonly environment: readonly McpEnvironmentEntry[];
  readonly permissions: readonly string[];
  readonly enabled: boolean;
  readonly autoStart: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastError?: string;
  readonly runtimeStatus: McpRuntimeStatus;
};

export type McpEffectiveServerConfig = McpServerConfig & {
  readonly effectiveScope: McpScope;
  readonly inheritedFromGlobal: boolean;
  readonly overriddenFields: readonly string[];
};

export type McpEffectiveConfig = {
  readonly resolvedProjectRoot?: string;
  readonly servers: readonly McpEffectiveServerConfig[];
};

export type McpValidationResult = {
  readonly serverId: McpServerId;
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly summary: string;
  readonly diagnostics: readonly string[];
};

export type McpIntrospectionItem = {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly executionMode?: McpToolExecutionMode;
  readonly approvalMode?: McpToolApprovalMode;
  readonly sideEffects?: McpToolSideEffects;
};

export type McpIntrospectionSnapshot = {
  readonly serverId: McpServerId;
  readonly fetchedAt: string;
  readonly source: "catalog" | "live" | "none";
  readonly note?: string;
  readonly tools: readonly McpIntrospectionItem[];
  readonly resources: readonly McpIntrospectionItem[];
  readonly prompts: readonly McpIntrospectionItem[];
};

export type McpCreateServerRequest = {
  readonly serverKey?: string;
  readonly scope: McpScope;
  readonly projectRoot?: string;
  readonly title: string;
  readonly summary: string;
  readonly description?: string;
  readonly iconKey: string;
  readonly transport: McpTransport;
  readonly installKind: McpInstallKind;
  readonly command?: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly url?: string;
  readonly environment: readonly McpEnvironmentInput[];
  readonly permissions: readonly string[];
  readonly enabled: boolean;
  readonly autoStart: boolean;
};

export type McpUpdateServerRequest = McpCreateServerRequest & {
  readonly serverId: McpServerId;
};

export type McpDeleteServerRequest = {
  readonly serverId: McpServerId;
  readonly scope: McpScope;
  readonly projectRoot?: string;
};

export type McpInstallTemplateRequest = {
  readonly templateId: string;
  readonly scope: McpScope;
  readonly projectRoot?: string;
  readonly title?: string;
  readonly serverKey?: string;
  readonly setupValues?: Readonly<Record<string, string>>;
  readonly enabled?: boolean;
  readonly autoStart?: boolean;
};

export type McpServerRequest = {
  readonly serverId: McpServerId;
  readonly scope: McpScope;
  readonly projectRoot?: string;
};

export type McpReadServersRequest = {
  readonly scope: McpScope;
  readonly projectRoot?: string;
};

export type McpReadEffectiveServersRequest = {
  readonly projectRoot?: string;
};

export type McpRuntimeEvent =
  | {
      readonly kind: "runtime-status";
      readonly status: McpRuntimeStatus;
    }
  | {
      readonly kind: "validation";
      readonly result: McpValidationResult;
    }
  | {
      readonly kind: "introspection";
      readonly snapshot: McpIntrospectionSnapshot;
    }
  | {
      readonly kind: "log";
      readonly serverId: McpServerId;
      readonly level: "info" | "error";
      readonly message: string;
      readonly timestamp: string;
    };
