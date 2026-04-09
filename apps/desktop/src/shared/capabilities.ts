export type {
  CapabilityAiExposure,
  CapabilityApprovalDecision,
  CapabilityApprovalMode,
  CapabilityApprovalRequest,
  CapabilityApprovalResolution,
  CapabilityCallRequest,
  CapabilityCallResult,
  CapabilityDescriptor,
  CapabilityDomain,
  CapabilityEvent,
  CapabilityError,
  CapabilityResolveApprovalRequest,
  CapabilityRegistrySnapshot,
  LyraAppManifest
} from "@lyra/capability-protocol";

import type {
  CapabilityAiExposure,
  CapabilityCallRequest,
  CapabilityApprovalResolution,
  CapabilityDescriptor,
  CapabilityDomain,
  CapabilityEvent,
  CapabilityResolveApprovalRequest,
  CapabilityRegistrySnapshot,
  LyraAppManifest
} from "@lyra/capability-protocol";

export type CapabilityListRequest = {
  readonly appId?: string;
  readonly domain?: CapabilityDomain;
  readonly aiExposure?: CapabilityAiExposure;
};

export type CapabilityListResponse = {
  readonly updatedAt: string;
  readonly apps: readonly LyraAppManifest[];
  readonly capabilities: readonly CapabilityDescriptor[];
};

export type CapabilityInvokeRequest = CapabilityCallRequest;
export type CapabilityResolveApprovalResponse = CapabilityApprovalResolution;
export type CapabilityReadRegistryResponse = CapabilityRegistrySnapshot;
export type CapabilityRuntimeEvent = CapabilityEvent;
export type CapabilityApprovalResolveRequest = CapabilityResolveApprovalRequest;
