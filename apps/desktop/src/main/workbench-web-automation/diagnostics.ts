import type {
  WorkbenchWebAutomationError,
  WorkbenchWebAutomationErrorCategory,
  WorkbenchWebAutomationErrorCode,
  WorkbenchWebAutomationErrorStage
} from "../../shared/workbench-web-automation";

const categoryFromStage = (
  stage: WorkbenchWebAutomationErrorStage
): WorkbenchWebAutomationErrorCategory => {
  switch (stage) {
    case "scan":
      return "scan";
    case "resolve_node":
      return "target_resolution";
    case "precondition":
      return "precondition";
    case "execute":
      return "execution";
    case "wait_postcondition":
      return "postcondition";
    default:
      return "unknown";
  }
};

export const createWebAutomationError = (
  code: WorkbenchWebAutomationErrorCode,
  message: string,
  stage: WorkbenchWebAutomationErrorStage,
  retryable: boolean,
  diagnostics?: WorkbenchWebAutomationError["diagnostics"]
): Error & WorkbenchWebAutomationError => {
  const category = categoryFromStage(stage);
  return Object.assign(new Error(message), {
    code,
    category,
    stage,
    retryable,
    ...(diagnostics === undefined ? {} : { diagnostics }),
    details: {
      category,
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
      ...(typeof (error as { category?: unknown }).category === "string"
        ? { category: (error as { category: string }).category }
        : {}),
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
