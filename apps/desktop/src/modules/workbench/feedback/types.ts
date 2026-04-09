export type WorkbenchFeedbackLevel = "info" | "success" | "warning" | "error";

export type WorkbenchFeedbackCode =
  | "workbench.info"
  | "workbench.warning"
  | "workbench.error";

export type WorkbenchFeedbackEvent = {
  readonly id: string;
  readonly code: WorkbenchFeedbackCode;
  readonly level: WorkbenchFeedbackLevel;
  readonly createdAt: number;
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
