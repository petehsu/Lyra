import type {
  TerminalAttachmentAttachRequest,
  TerminalAttachmentAttachResponse,
  TerminalAttachmentMode,
  TerminalAttachmentSnapshot,
  TerminalMemoryActor,
  TerminalMemoryCorrelation
} from "../../shared/desktop-bridge";

export type TerminalAttachmentApprovalFields = {
  readonly permissionId?: string;
  readonly permissionScope?: string;
  readonly approved?: boolean;
};

export type NormalizedTerminalAttachmentAttachRequest =
  TerminalAttachmentAttachRequest & TerminalAttachmentApprovalFields;

export type TerminalAttachmentResultStatus =
  | "active"
  | "needsApproval"
  | "conflict"
  | "paused"
  | "detached"
  | "revoked"
  | string;

export type TerminalAttachmentResultSummary = {
  readonly status: TerminalAttachmentResultStatus;
  readonly needsApproval: boolean;
  readonly permissionId: string | null;
  readonly conflictWithAttachmentId: string | null;
  readonly message: string;
};

export type TerminalAttachmentControlSummary = {
  readonly controller: TerminalAttachmentSnapshot | null;
  readonly observers: readonly TerminalAttachmentSnapshot[];
  readonly childAgents: readonly TerminalAttachmentSnapshot[];
  readonly paused: readonly TerminalAttachmentSnapshot[];
  readonly detached: readonly TerminalAttachmentSnapshot[];
  readonly revoked: readonly TerminalAttachmentSnapshot[];
  readonly status: "idle" | "observed" | "controlled" | "paused" | "revoked";
  readonly label: string;
};

const WRITER_MODES = new Set(["control", "takeover", "delegated"]);
const KNOWN_MODES = new Set(["observe", "control", "takeover", "delegated"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const readString = (input: Record<string, unknown>, field: string): string | undefined => {
  const value = input[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
};

const readNumber = (input: Record<string, unknown>, field: string): number | undefined => {
  const value = input[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const readBoolean = (input: Record<string, unknown>, field: string): boolean | undefined =>
  typeof input[field] === "boolean" ? input[field] : undefined;

export const normalizeTerminalAttachmentMode = (
  value: unknown,
  fallback: TerminalAttachmentMode = "observe"
): TerminalAttachmentMode => {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return KNOWN_MODES.has(normalized) ? normalized : fallback;
};

export const isTerminalAttachmentWriterMode = (mode: TerminalAttachmentMode): boolean =>
  WRITER_MODES.has(mode.trim().toLowerCase());

export const normalizeTerminalAttachmentAttachPayload = (
  input: unknown,
  context: {
    readonly sessionId: string;
    readonly agentSessionId: string;
    readonly actor: TerminalMemoryActor;
    readonly correlation: TerminalMemoryCorrelation;
  }
): NormalizedTerminalAttachmentAttachRequest => {
  const payload = isRecord(input) ? input : {};
  const ttlMs = readNumber(payload, "ttlMs");
  const runtimeTurnId = readString(payload, "runtimeTurnId");
  const toolCallId = readString(payload, "toolCallId");
  const reason = readString(payload, "reason");
  const permissionId = readString(payload, "permissionId");
  const permissionScope = readString(payload, "permissionScope");
  const approved = readBoolean(payload, "approved");
  return {
    sessionId: readString(payload, "sessionId") ?? context.sessionId,
    agentSessionId: readString(payload, "agentSessionId") ?? context.agentSessionId,
    mode: normalizeTerminalAttachmentMode(payload.mode),
    actor: context.actor,
    correlation: context.correlation,
    ...(runtimeTurnId === undefined ? {} : { runtimeTurnId }),
    ...(toolCallId === undefined ? {} : { toolCallId }),
    ...(reason === undefined ? {} : { reason }),
    ...(ttlMs === undefined ? {} : { ttlMs: Math.max(1, Math.round(ttlMs)) }),
    ...(permissionId === undefined ? {} : { permissionId }),
    ...(permissionScope === undefined ? {} : { permissionScope }),
    ...(approved === undefined ? {} : { approved })
  };
};

export const summarizeTerminalAttachmentResult = (
  response: TerminalAttachmentAttachResponse
): TerminalAttachmentResultSummary => {
  const raw = response as TerminalAttachmentAttachResponse & {
    readonly status?: TerminalAttachmentResultStatus;
    readonly needsApproval?: boolean;
    readonly conflictWithAttachmentId?: string | null;
    readonly warning?: string | null;
  };
  const status = raw.status ?? response.attachment.status;
  const permissionId = response.permissionId ?? response.attachment.permissionId ?? null;
  const needsApproval = raw.needsApproval === true || status === "needsApproval";
  const conflictWithAttachmentId = raw.conflictWithAttachmentId ?? null;
  const message = needsApproval
    ? `Terminal control needs approval ${permissionId ?? ""}`.trim()
    : status === "conflict"
      ? `Terminal is already controlled by ${conflictWithAttachmentId ?? "another attachment"}`
      : raw.warning ?? `Attached Agent as ${response.attachment.mode}`;
  return {
    status,
    needsApproval,
    permissionId,
    conflictWithAttachmentId,
    message
  };
};

export const summarizeTerminalAttachments = (
  items: readonly TerminalAttachmentSnapshot[]
): TerminalAttachmentControlSummary => {
  const active = items.filter((item) => item.status === "active");
  const controller =
    active.find((item) => isTerminalAttachmentWriterMode(item.mode)) ?? null;
  const observers = active.filter((item) => item.mode === "observe");
  const childAgents = items.filter((item) =>
    item.mode === "delegated"
    || typeof (item as TerminalAttachmentSnapshot & {
      readonly childAgentSessionId?: string;
    }).childAgentSessionId === "string"
  );
  const paused = items.filter((item) => item.status === "paused");
  const detached = items.filter((item) => item.status === "detached");
  const revoked = items.filter((item) => item.status === "revoked");
  const status =
    controller !== null
      ? "controlled"
      : paused.some((item) => isTerminalAttachmentWriterMode(item.mode))
        ? "paused"
        : revoked.length > 0
          ? "revoked"
          : observers.length > 0
            ? "observed"
            : "idle";
  const label =
    controller !== null
      ? `${controller.mode}: ${controller.agentSessionId}`
      : observers.length > 0
        ? `${observers.length} observing`
        : paused.length > 0
          ? `${paused.length} paused`
          : "No Agent attached";
  return {
    controller,
    observers,
    childAgents,
    paused,
    detached,
    revoked,
    status,
    label
  };
};
