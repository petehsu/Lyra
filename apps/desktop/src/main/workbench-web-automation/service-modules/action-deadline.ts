import type {
  WorkbenchWebActionRequest,
  WorkbenchWebActionResult,
} from "../../../shared/workbench-web-automation";

export type WorkbenchWebActionDeadlineRuntime = {
  readonly executeWebAction: (params: any) => Promise<WorkbenchWebActionResult>;
  readonly createWebAutomationError: (...args: any[]) => Error;
  readonly actionTimeoutHoverMs: number;
  readonly actionTimeoutSafeMs: number;
  readonly actionTimeoutMutateMs: number;
  readonly actionTimeoutNavigateMs: number;
};

const clampTimeoutMs = (value: unknown): number | undefined => {
  if (typeof value !== "number" || Number.isFinite(value) === false) {
    return undefined;
  }
  return Math.max(250, Math.min(45_000, Math.round(value)));
};

const readActionRequestTimeoutMs = (request: WorkbenchWebActionRequest): number | undefined =>
  clampTimeoutMs(request.constraints?.timeoutMs ?? request.timeoutMs);

const readActionRequestNavigationWaitMs = (
  request: WorkbenchWebActionRequest
): number | undefined =>
  clampTimeoutMs(request.constraints?.waitForNavigationMs ?? request.waitForNavigationMs);

export const createWorkbenchWebActionDeadlineExecutor = (
  runtime: WorkbenchWebActionDeadlineRuntime
): {
  readonly executeWebActionWithDeadline: (params: any) => Promise<WorkbenchWebActionResult>;
} => {
  const {
    executeWebAction,
    createWebAutomationError,
    actionTimeoutHoverMs,
    actionTimeoutSafeMs,
    actionTimeoutMutateMs,
    actionTimeoutNavigateMs,
  } = runtime;

  const resolveActionExecutionTimeoutMs = (request: WorkbenchWebActionRequest): number => {
    const action = request.action;
    const requested = readActionRequestTimeoutMs(request);
    switch (action.kind) {
      case "hover":
        return requested ?? actionTimeoutHoverMs;
      case "focus":
      case "scroll_into_view":
      case "expand_probe":
        return requested ?? actionTimeoutSafeMs;
      case "goto_url":
      case "history_back":
      case "history_forward":
      case "reload":
      case "open_link_node": {
        const navigationWaitMs = readActionRequestNavigationWaitMs(request);
        const timeout = requested ?? actionTimeoutNavigateMs;
        if (navigationWaitMs === undefined) {
          return timeout;
        }
        return Math.max(timeout, Math.min(45_000, navigationWaitMs + 1_200));
      }
      case "click":
      case "type":
      case "clear_and_type":
      case "select_option":
      case "set_checked":
      case "submit_form":
      case "press_key":
        return requested ?? actionTimeoutMutateMs;
      default:
        return requested ?? actionTimeoutSafeMs;
    }
  };

  const executeWebActionWithDeadline = async (
    params: any
  ): Promise<WorkbenchWebActionResult> => {
    const timeoutMs = resolveActionExecutionTimeoutMs(params.request);
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(createWebAutomationError(
          "script_execution_failed",
          `action ${params.request.action.kind} timed out after ${timeoutMs}ms`,
          "execute",
          true,
          {
            details: {
              timeoutMs,
              actionKind: params.request.action.kind
            }
          }
        ));
      }, timeoutMs);
    });
    try {
      return await Promise.race([executeWebAction(params), timeoutPromise]);
    } finally {
      if (timeoutHandle !== null) {
        clearTimeout(timeoutHandle);
      }
    }
  };

  return {
    executeWebActionWithDeadline,
  };
};
