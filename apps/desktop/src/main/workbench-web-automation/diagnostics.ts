import type {
  WorkbenchWebAutomationError,
  WorkbenchWebAutomationErrorCode,
  WorkbenchWebAutomationErrorStage
} from "../../shared/workbench-web-automation";

export const createWebAutomationError = (
  code: WorkbenchWebAutomationErrorCode,
  message: string,
  stage: WorkbenchWebAutomationErrorStage,
  retryable: boolean,
  diagnostics?: WorkbenchWebAutomationError["diagnostics"]
): Error & WorkbenchWebAutomationError => {
  return Object.assign(new Error(message), {
    code,
    stage,
    retryable,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    details: {
      stage,
      retryable,
      ...(diagnostics === undefined ? {} : { diagnostics })
    }
  }) as Error & WorkbenchWebAutomationError;
};

export const toCapabilityError = (error: unknown): Error => {
  if (
    error !== null
    && typeof error === "object"
    && typeof (error as { code?: unknown }).code === "string"
    && typeof (error as { message?: unknown }).message === "string"
  ) {
    return Object.assign(new Error((error as { message: string }).message), {
      code: (error as { code: string }).code,
      message: (error as { message: string }).message,
      ...(typeof (error as { stage?: unknown }).stage === "string"
        ? { stage: (error as { stage: string }).stage }
        : {}),
      ...(typeof (error as { retryable?: unknown }).retryable === "boolean"
        ? { retryable: (error as { retryable: boolean }).retryable }
        : {}),
      ...(typeof (error as { diagnostics?: unknown }).diagnostics === "object"
        && (error as { diagnostics?: unknown }).diagnostics !== null
        ? { details: { diagnostics: (error as { diagnostics: unknown }).diagnostics } }
        : {})
    });
  }
  if (error instanceof Error) {
    return Object.assign(new Error(error.message), {
      code: "script_execution_failed"
    });
  }
  return Object.assign(new Error(String(error)), {
    code: "script_execution_failed"
  });
};
