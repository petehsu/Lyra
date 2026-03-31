export type WorkbenchFeedbackLevel = "info" | "success" | "warning" | "error";

export type WorkbenchFeedbackCode =
  | "ai.runtime.approval.accepted"
  | "ai.runtime.approval.rejected"
  | "ai.runtime.approval.undo"
  | "ai.runtime.approval.accept_all"
  | "ai.runtime.error"
  | "ai.runtime.permission_denied"
  | "ai.runtime.timeout";

export type WorkbenchFeedbackEvent = {
  readonly id: string;
  readonly code: WorkbenchFeedbackCode;
  readonly level: WorkbenchFeedbackLevel;
  readonly createdAt: number;
  readonly sessionId?: string;
  readonly runtimeItemId?: string;
  readonly message?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
};

export type WorkbenchFeedbackPublishRequest = Omit<
  WorkbenchFeedbackEvent,
  "id" | "createdAt"
> & {
  readonly id?: string;
  readonly createdAt?: number;
};

export type WorkbenchFeedbackListener = (
  event: WorkbenchFeedbackEvent
) => void;

export type WorkbenchFeedbackModel = {
  readonly publishFeedback: (event: WorkbenchFeedbackPublishRequest) => void;
  readonly subscribe: (listener: WorkbenchFeedbackListener) => () => void;
};
