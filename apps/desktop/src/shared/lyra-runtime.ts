export type LyraRuntimeRequestId = string | number;

export type LyraClientRequestPayload = Readonly<Record<string, unknown>>;

export type LyraClientNotificationPayload = Readonly<Record<string, unknown>>;

export type LyraRuntimeErrorPayload = {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
};

export type LyraRuntimeHealth = {
  readonly backend: string;
  readonly transport: string;
  readonly version: string;
};

export type LyraResolveServerRequestPayload = {
  readonly requestId: LyraRuntimeRequestId;
  readonly result: unknown;
};

export type LyraRejectServerRequestPayload = {
  readonly requestId: LyraRuntimeRequestId;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
};

export type LyraRuntimeReadyEvent = {
  readonly kind: "ready";
  readonly backend: string;
  readonly transport: string;
  readonly version: string;
};

export type LyraRuntimeStartupFailedEvent = {
  readonly kind: "startup_failed";
  readonly error: LyraRuntimeErrorPayload;
};

export type LyraRuntimeNotificationEvent = {
  readonly kind: "notification";
  readonly notification: Readonly<Record<string, unknown>>;
};

export type LyraRuntimeRequestEvent = {
  readonly kind: "request";
  readonly request: Readonly<Record<string, unknown>>;
};

export type LyraRuntimeLaggedEvent = {
  readonly kind: "lagged";
  readonly skipped: number;
};

export type LyraRuntimeDisconnectedEvent = {
  readonly kind: "disconnected";
  readonly message?: string;
  readonly error?: LyraRuntimeErrorPayload;
};

export type LyraRuntimeEvent =
  | LyraRuntimeReadyEvent
  | LyraRuntimeStartupFailedEvent
  | LyraRuntimeNotificationEvent
  | LyraRuntimeRequestEvent
  | LyraRuntimeLaggedEvent
  | LyraRuntimeDisconnectedEvent;
