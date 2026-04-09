import type {
  CapabilityApprovalPreview,
  CapabilityApprovalResolution,
  CapabilityCallRequest,
  CapabilityCallResult,
  CapabilityDescriptor,
  CapabilityEvent,
  CapabilityRegistrySnapshot,
  CapabilityResolveApprovalRequest,
  LyraAppManifest
} from "@lyra/capability-protocol";
import type { CapabilityListRequest } from "../../shared/capabilities";

export type CapabilityInvokeHandlerContext = {
  readonly callId: string;
  readonly descriptor: CapabilityDescriptor;
  readonly emit: (event: Omit<CapabilityEvent, "eventId" | "callId" | "capabilityId" | "timestamp">) => void;
};

export type CapabilityInvokeHandler = (
  request: CapabilityCallRequest,
  context: CapabilityInvokeHandlerContext
) => Promise<unknown>;

export type CapabilityApprovalPrepared = {
  readonly title?: string;
  readonly description?: string;
  readonly canAlwaysAllow?: boolean;
  readonly projectRoot?: string;
  readonly preview?: CapabilityApprovalPreview;
  readonly commit: () => Promise<unknown>;
};

export type CapabilityApprovalPrepareHandler = (
  request: CapabilityCallRequest,
  context: CapabilityInvokeHandlerContext
) => Promise<CapabilityApprovalPrepared>;

export type CapabilitiesIpcBridge = {
  readonly dispose: () => void;
  readonly readRegistry: () => CapabilityRegistrySnapshot;
  readonly listCapabilities: (request?: CapabilityListRequest) => readonly CapabilityDescriptor[];
  readonly invokeCapability: (request: CapabilityCallRequest) => Promise<CapabilityCallResult>;
  readonly resolveApproval: (
    request: CapabilityResolveApprovalRequest
  ) => Promise<CapabilityApprovalResolution>;
  readonly abortApprovalsForSession: (sessionId: string, reason?: string) => Promise<void>;
  readonly subscribeEvents: (listener: (event: CapabilityEvent) => void) => () => void;
};

export type RegisteredCapability = {
  readonly descriptor: CapabilityDescriptor;
  readonly invoke?: CapabilityInvokeHandler;
  readonly prepareApproval?: CapabilityApprovalPrepareHandler;
};

export type RegisteredApp = LyraAppManifest;
