export const CAPABILITY_DOMAINS = ["filesystem", "terminal", "browser", "mcp", "workbench"] as const;
export const CAPABILITY_KINDS = ["action", "resource", "event"] as const;
export const CAPABILITY_RISKS = ["read", "write", "command", "network"] as const;
export const CAPABILITY_APPROVAL_MODES = ["auto", "ask", "deny"] as const;
export const CAPABILITY_APPROVAL_DECISIONS = [
  "approved_once",
  "approved_always",
  "rejected"
] as const;
export const CAPABILITY_AI_EXPOSURES = ["hidden", "read", "full"] as const;
export const COMMAND_RISK_LEVELS = ["safe", "low", "medium", "high", "critical"] as const;
export const PERMISSION_DECISIONS = ["allow_once", "allow_always", "deny"] as const;
export const LYRA_APP_SOURCES = ["builtin", "local-package"] as const;
export const LYRA_APP_SURFACES = ["workspace", "ai-computer", "settings", "background"] as const;
export const LYRA_APP_PLATFORMS = ["macos", "windows", "linux"] as const;

export type CapabilityDomain = (typeof CAPABILITY_DOMAINS)[number];
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export type CapabilityRisk = (typeof CAPABILITY_RISKS)[number];
export type CapabilityApprovalMode = (typeof CAPABILITY_APPROVAL_MODES)[number];
export type CapabilityApprovalDecision = (typeof CAPABILITY_APPROVAL_DECISIONS)[number];
export type CapabilityAiExposure = (typeof CAPABILITY_AI_EXPOSURES)[number];
export type LyraAppSource = (typeof LYRA_APP_SOURCES)[number];
export type LyraAppSurface = (typeof LYRA_APP_SURFACES)[number];
export type LyraAppPlatform = (typeof LYRA_APP_PLATFORMS)[number];

export type JsonSchema = Readonly<Record<string, unknown>>;

export type LyraAppCompatibility = {
  readonly minApiVersion?: string;
  readonly platforms?: readonly LyraAppPlatform[];
};

export type LyraAppContributions = {
  readonly surfaces: readonly LyraAppSurface[];
};

export type LyraAppManifest = {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly source: LyraAppSource;
  readonly entry?: string;
  readonly description?: string;
  readonly permissions: readonly string[];
  readonly capabilities: readonly string[];
  readonly compatibility: LyraAppCompatibility;
  readonly contributes: LyraAppContributions;
};

export type CapabilityDescriptor = {
  readonly id: string;
  readonly domain: CapabilityDomain;
  readonly kind: CapabilityKind;
  readonly title: string;
  readonly appId: string;
  readonly operation: string;
  readonly description?: string;
  readonly permissions: readonly string[];
  readonly risk: CapabilityRisk;
  readonly approvalMode: CapabilityApprovalMode;
  readonly aiExposure: CapabilityAiExposure;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  readonly eventSchema?: JsonSchema;
};

export type CapabilityInvocationContext = {
  readonly aiSessionId?: string;
  readonly aiTurnId?: string;
  readonly computerSessionId?: string;
  readonly projectRoot?: string;
  readonly workspaceRoot?: string;
  readonly appInstanceId?: string;
};

export type CapabilityCallRequest = {
  readonly callId?: string;
  readonly capabilityId: string;
  readonly payload: unknown;
  readonly context?: CapabilityInvocationContext;
};

export type CapabilityError = {
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly details?: unknown;
};

export type CapabilityApprovalPreview =
  | {
      readonly kind: "file-edit";
      readonly filePath: string;
      readonly baselineContent?: string;
      readonly draftPreview?: string;
      readonly patchSummary?: string;
      readonly firstChangedLine?: number;
      readonly addedLines?: number;
      readonly removedLines?: number;
      readonly expectedRevision?: string;
    }
  | {
      readonly kind: "file-create";
      readonly filePath: string;
      readonly draftPreview?: string;
    }
  | {
      readonly kind: "folder-create";
      readonly path: string;
    }
  | {
      readonly kind: "terminal-command";
      readonly command: string;
      readonly cwd?: string;
    }
  | {
      readonly kind: "generic";
      readonly summary: string;
      readonly target?: string;
    };

export type CapabilityApprovalRequest = {
  readonly approvalId: string;
  readonly callId: string;
  readonly capabilityId: string;
  readonly title: string;
  readonly description: string;
  readonly risk: CapabilityRisk;
  readonly requestedAt: string;
  readonly canAlwaysAllow?: boolean;
  readonly projectRoot?: string;
  readonly decisionOptions?: readonly CapabilityApprovalDecision[];
  readonly preview?: CapabilityApprovalPreview;
  readonly context?: CapabilityInvocationContext;
};

export type CapabilityApprovalResolution = {
  readonly approvalId: string;
  readonly callId: string;
  readonly capabilityId: string;
  readonly decision: CapabilityApprovalDecision;
  readonly resolvedAt: string;
  readonly context?: CapabilityInvocationContext;
};

export type CapabilityResolveApprovalRequest = {
  readonly approvalId: string;
  readonly decision: CapabilityApprovalDecision;
};

export type CapabilityCallResult = {
  readonly callId: string;
  readonly capabilityId: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: CapabilityError;
  readonly completedAt: string;
};

export type CapabilityEventPhase =
  | "started"
  | "progress"
  | "approval_requested"
  | "approval_resolved"
  | "completed"
  | "failed"
  | "reasoning";

export type CapabilityEvent = {
  readonly eventId: string;
  readonly callId: string;
  readonly capabilityId: string;
  readonly phase: CapabilityEventPhase;
  readonly timestamp: string;
  readonly payload?: unknown;
  readonly error?: CapabilityError;
};

export type CapabilityRegistrySnapshot = {
  readonly updatedAt: string;
  readonly apps: readonly LyraAppManifest[];
  readonly capabilities: readonly CapabilityDescriptor[];
};

export type CapabilityListRequest = {
  readonly appId?: string;
  readonly domain?: CapabilityDomain;
  readonly aiExposure?: CapabilityAiExposure;
};
