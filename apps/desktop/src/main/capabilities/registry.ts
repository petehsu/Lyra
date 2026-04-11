import { randomUUID } from "node:crypto";

import {
  validateCapabilityRegistrySnapshot,
  type CapabilityApprovalRequest,
  type CapabilityApprovalResolution,
  type CapabilityCallRequest,
  type CapabilityCallResult,
  type CapabilityDescriptor,
  type CapabilityError,
  type CapabilityEvent,
  type CapabilityResolveApprovalRequest,
  type CapabilityRegistrySnapshot,
  type LyraAppManifest
} from "../../../../../packages/capability-protocol/src";
import type { CapabilityListRequest } from "../../shared/capabilities";
import type {
  CapabilityApprovalPrepareHandler,
  CapabilityInvokeHandler,
  CapabilityInvokeHandlerContext,
  RegisteredCapability
} from "./types";

const nowIso = (): string => new Date().toISOString();

const createCapabilityError = (
  code: string,
  message: string,
  retryable?: boolean,
  details?: unknown
): CapabilityError => ({
  code,
  message,
  ...(retryable === undefined ? {} : { retryable }),
  ...(details === undefined ? {} : { details })
});

const toCapabilityError = (error: unknown): CapabilityError => {
  if (
    error !== null
    && typeof error === "object"
    && typeof (error as { code?: unknown }).code === "string"
    && typeof (error as { message?: unknown }).message === "string"
  ) {
    const candidate = error as {
      readonly code: string;
      readonly message: string;
      readonly retryable?: boolean;
      readonly details?: unknown;
    };
    return createCapabilityError(candidate.code, candidate.message, candidate.retryable, candidate.details);
  }
  if (error instanceof Error) {
    return createCapabilityError("CAPABILITY_INVOKE_FAILED", error.message);
  }
  return createCapabilityError("CAPABILITY_INVOKE_FAILED", String(error));
};

const stringifyPayload = (payload: unknown): string | null => {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined || serialized === "{}" || serialized === "null") {
      return null;
    }
    return serialized.length > 240 ? `${serialized.slice(0, 240)}...` : serialized;
  } catch {
    return null;
  }
};

const describeApprovalRequest = (
  descriptor: CapabilityDescriptor,
  request: CapabilityCallRequest,
  prepared?: { readonly description?: string }
): string => {
  if (typeof prepared?.description === "string" && prepared.description.trim().length > 0) {
    return prepared.description.trim();
  }

  const parts = [
    descriptor.description?.trim().length
      ? descriptor.description.trim()
      : `Capability ${descriptor.id} requires approval before execution.`
  ];
  const payload = stringifyPayload(request.payload);
  if (payload !== null) {
    parts.push(`Input: ${payload}`);
  }
  return parts.join("\n\n");
};

type PendingApprovalRecord = {
  readonly approval: CapabilityApprovalRequest;
  readonly aiSessionId: string | undefined;
  readonly canAlwaysAllow: boolean;
  readonly projectRoot: string | undefined;
  readonly emit: (
    event: Omit<CapabilityEvent, "eventId" | "callId" | "capabilityId" | "timestamp">
  ) => void;
  readonly resolve: (resolution: CapabilityApprovalResolution) => void;
  readonly reject: (error: CapabilityError) => void;
};

type CapabilityRegistration =
  | CapabilityInvokeHandler
  | {
      readonly invoke?: CapabilityInvokeHandler;
      readonly prepareApproval?: CapabilityApprovalPrepareHandler;
    };

const normalizeApprovalDecision = (
  decision: CapabilityResolveApprovalRequest["decision"]
): "approved_once" | "approved_always" | "rejected" => {
  if (decision === "approved_always") {
    return "approved_always";
  }
  if (decision === "approved_once") {
    return "approved_once";
  }
  return "rejected";
};

const normalizeProjectRoot = (value: string | undefined): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

export class AppRegistry {
  private readonly apps = new Map<string, LyraAppManifest>();

  register(app: LyraAppManifest): void {
    const existing = this.apps.get(app.id);
    if (existing === undefined) {
      this.apps.set(app.id, app);
      return;
    }
    this.apps.set(app.id, {
      ...existing,
      ...app,
      permissions: Array.from(new Set([...existing.permissions, ...app.permissions])),
      capabilities: Array.from(new Set([...existing.capabilities, ...app.capabilities])),
      contributes: {
        surfaces: Array.from(new Set([
          ...(existing.contributes?.surfaces ?? []),
          ...(app.contributes?.surfaces ?? [])
        ]))
      }
    });
  }

  list(): readonly LyraAppManifest[] {
    return Array.from(this.apps.values()).sort((left, right) => left.id.localeCompare(right.id));
  }
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, RegisteredCapability>();
  private readonly pendingApprovals = new Map<string, PendingApprovalRecord>();
  private readonly pendingApprovalByAiSession = new Map<string, string>();
  private readonly projectCapabilityAllowRules = new Set<string>();

  public constructor(private readonly publishEvent: (event: CapabilityEvent) => void) {}

  register(descriptor: CapabilityDescriptor, registration: CapabilityRegistration): void {
    if (typeof registration === "function") {
      this.capabilities.set(descriptor.id, { descriptor, invoke: registration });
      return;
    }
    this.capabilities.set(descriptor.id, { descriptor, ...registration });
  }

  private buildProjectCapabilityRuleKey(capabilityId: string, projectRoot: string): string {
    return `${capabilityId}::${projectRoot}`;
  }

  private isProjectCapabilityAlwaysAllowed(
    capabilityId: string,
    projectRoot: string | undefined
  ): boolean {
    const normalizedProjectRoot = normalizeProjectRoot(projectRoot);
    if (normalizedProjectRoot === undefined) {
      return false;
    }
    return this.projectCapabilityAllowRules.has(
      this.buildProjectCapabilityRuleKey(capabilityId, normalizedProjectRoot)
    );
  }

  list(request?: CapabilityListRequest): readonly CapabilityDescriptor[] {
    return Array.from(this.capabilities.values())
      .map((entry) => entry.descriptor)
      .filter((descriptor) => {
        if (request?.appId !== undefined && descriptor.appId !== request.appId) {
          return false;
        }
        if (request?.domain !== undefined && descriptor.domain !== request.domain) {
          return false;
        }
        if (request?.aiExposure !== undefined && descriptor.aiExposure !== request.aiExposure) {
          return false;
        }
        return true;
      })
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  snapshot(apps: readonly LyraAppManifest[]): CapabilityRegistrySnapshot {
    const snapshot: CapabilityRegistrySnapshot = {
      updatedAt: nowIso(),
      apps,
      capabilities: this.list()
    };
    const issues = validateCapabilityRegistrySnapshot(snapshot);
    if (issues.length > 0) {
      throw new Error(`invalid capability registry: ${issues.join("; ")}`);
    }
    return snapshot;
  }

  async resolveApproval(
    request: CapabilityResolveApprovalRequest
  ): Promise<CapabilityApprovalResolution> {
    const approvalId = request.approvalId.trim();
    if (approvalId.length === 0) {
      throw new Error("approvalId is required");
    }
    const pending = this.pendingApprovals.get(approvalId);
    if (pending === undefined) {
      throw new Error(`Unknown approval: ${approvalId}`);
    }
    const resolution: CapabilityApprovalResolution = {
      approvalId,
      callId: pending.approval.callId,
      capabilityId: pending.approval.capabilityId,
      decision: normalizeApprovalDecision(request.decision),
      resolvedAt: nowIso(),
      ...(pending.approval.context === undefined ? {} : { context: pending.approval.context })
    };
    this.pendingApprovals.delete(approvalId);
    if (pending.aiSessionId !== undefined) {
      this.pendingApprovalByAiSession.delete(pending.aiSessionId);
    }
    pending.emit({
      phase: "approval_resolved",
      payload: resolution
    });
    if (resolution.decision === "approved_always" && pending.canAlwaysAllow && pending.projectRoot !== undefined) {
      this.projectCapabilityAllowRules.add(
        this.buildProjectCapabilityRuleKey(
          pending.approval.capabilityId,
          pending.projectRoot
        )
      );
      pending.resolve(resolution);
      return resolution;
    }
    if (resolution.decision === "approved_once" || resolution.decision === "approved_always") {
      pending.resolve(resolution);
    } else {
      pending.reject(
        createCapabilityError(
          "CAPABILITY_APPROVAL_REJECTED",
          `Approval rejected for ${pending.approval.capabilityId}`
        )
      );
    }
    return resolution;
  }

  async abortApprovalsForSession(sessionId: string, reason = "chat turn cancelled"): Promise<void> {
    const approvalId = this.pendingApprovalByAiSession.get(sessionId);
    if (approvalId === undefined) {
      return;
    }
    const pending = this.pendingApprovals.get(approvalId);
    if (pending === undefined) {
      this.pendingApprovalByAiSession.delete(sessionId);
      return;
    }
    const resolution: CapabilityApprovalResolution = {
      approvalId,
      callId: pending.approval.callId,
      capabilityId: pending.approval.capabilityId,
      decision: "rejected",
      resolvedAt: nowIso(),
      ...(pending.approval.context === undefined ? {} : { context: pending.approval.context })
    };
    this.pendingApprovals.delete(approvalId);
    this.pendingApprovalByAiSession.delete(sessionId);
    pending.emit({
      phase: "approval_resolved",
      payload: resolution
    });
    pending.reject(
      createCapabilityError("CAPABILITY_APPROVAL_CANCELLED", reason)
    );
  }

  async invoke(request: CapabilityCallRequest): Promise<CapabilityCallResult> {
    const callId = request.callId?.trim().length ? request.callId : randomUUID();
    const registered = this.capabilities.get(request.capabilityId);
    if (registered === undefined) {
      const error = createCapabilityError(
        "CAPABILITY_NOT_FOUND",
        `Unknown capability: ${request.capabilityId}`
      );
      this.publishEvent({
        eventId: randomUUID(),
        callId,
        capabilityId: request.capabilityId,
        phase: "failed",
        timestamp: nowIso(),
        error
      });
      return {
        callId,
        capabilityId: request.capabilityId,
        ok: false,
        error,
        completedAt: nowIso()
      };
    }

    const { descriptor } = registered;
    const emit = (event: Omit<CapabilityEvent, "eventId" | "callId" | "capabilityId" | "timestamp">): void => {
      this.publishEvent({
        eventId: randomUUID(),
        callId,
        capabilityId: descriptor.id,
        timestamp: nowIso(),
        ...event
      });
    };

    const context: CapabilityInvokeHandlerContext = {
      callId,
      descriptor,
      emit
    };

    if (descriptor.approvalMode === "deny") {
      const error = createCapabilityError(
        "CAPABILITY_APPROVAL_DENIED",
        `Capability ${descriptor.id} is blocked by policy`
      );
      emit({ phase: "failed", error });
      return {
        callId,
        capabilityId: descriptor.id,
        ok: false,
        error,
        completedAt: nowIso()
      };
    }

    try {
      emit({ phase: "started" });

      if (descriptor.approvalMode === "ask") {
        const aiSessionId = request.context?.aiSessionId;
        if (
          aiSessionId !== undefined
          && this.pendingApprovalByAiSession.has(aiSessionId)
        ) {
          throw createCapabilityError(
            "CAPABILITY_APPROVAL_PENDING",
            `Another approval is already pending for session ${aiSessionId}`
          );
        }

        const prepared = await registered.prepareApproval?.(request, context);
        const projectRoot = normalizeProjectRoot(
          prepared?.projectRoot ?? request.context?.projectRoot
        );
        const canAlwaysAllow = prepared?.canAlwaysAllow === true && projectRoot !== undefined;

        if (prepared !== undefined) {
          if (canAlwaysAllow && this.isProjectCapabilityAlwaysAllowed(descriptor.id, projectRoot)) {
            const result = await prepared.commit();
            emit({ phase: "completed", payload: result });
            return {
              callId,
              capabilityId: descriptor.id,
              ok: true,
              result,
              completedAt: nowIso()
            };
          }

          const approval: CapabilityApprovalRequest = {
            approvalId: randomUUID(),
            callId,
            capabilityId: descriptor.id,
            title: prepared.title?.trim().length ? prepared.title.trim() : descriptor.title,
            description: describeApprovalRequest(descriptor, request, prepared),
            risk: descriptor.risk,
            requestedAt: nowIso(),
            ...(canAlwaysAllow ? { canAlwaysAllow: true } : {}),
            ...(projectRoot === undefined ? {} : { projectRoot }),
            decisionOptions: canAlwaysAllow
              ? ["approved_once", "approved_always", "rejected"]
              : ["approved_once", "rejected"],
            ...(prepared.preview === undefined ? {} : { preview: prepared.preview }),
            ...(request.context === undefined ? {} : { context: request.context })
          };
          await new Promise<CapabilityApprovalResolution>((resolve, reject) => {
            const record: PendingApprovalRecord = {
              approval,
              aiSessionId,
              canAlwaysAllow,
              projectRoot,
              emit,
              resolve,
              reject
            };
            this.pendingApprovals.set(approval.approvalId, record);
            if (aiSessionId !== undefined) {
              this.pendingApprovalByAiSession.set(aiSessionId, approval.approvalId);
            }
            emit({
              phase: "approval_requested",
              payload: approval
            });
          });

          const result = await prepared.commit();
          emit({ phase: "completed", payload: result });
          return {
            callId,
            capabilityId: descriptor.id,
            ok: true,
            result,
            completedAt: nowIso()
          };
        }

        const approval: CapabilityApprovalRequest = {
          approvalId: randomUUID(),
          callId,
          capabilityId: descriptor.id,
          title: descriptor.title,
          description: describeApprovalRequest(descriptor, request),
          risk: descriptor.risk,
          requestedAt: nowIso(),
          decisionOptions: ["approved_once", "rejected"],
          ...(request.context === undefined ? {} : { context: request.context })
        };
        await new Promise<CapabilityApprovalResolution>((resolve, reject) => {
          const record: PendingApprovalRecord = {
            approval,
            aiSessionId,
            canAlwaysAllow: false,
            projectRoot: undefined,
            emit,
            resolve,
            reject
          };
          this.pendingApprovals.set(approval.approvalId, record);
          if (aiSessionId !== undefined) {
            this.pendingApprovalByAiSession.set(aiSessionId, approval.approvalId);
          }
          emit({
            phase: "approval_requested",
            payload: approval
          });
        });
      }

      if (registered.invoke === undefined) {
        throw createCapabilityError(
          "CAPABILITY_NOT_IMPLEMENTED",
          `Capability ${descriptor.id} has no executable handler`
        );
      }
      const result = await registered.invoke(request, context);
      emit({ phase: "completed", payload: result });
      return {
        callId,
        capabilityId: descriptor.id,
        ok: true,
        result,
        completedAt: nowIso()
      };
    } catch (error) {
      const capabilityError = toCapabilityError(error);
      emit({ phase: "failed", error: capabilityError });
      return {
        callId,
        capabilityId: descriptor.id,
        ok: false,
        error: capabilityError,
        completedAt: nowIso()
      };
    }
  }
}
