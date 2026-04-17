import type {
  BrowserUseAgentRunRequest,
  BrowserUseAgentRunResult,
  BrowserUseNavigateRequest,
  BrowserUseNavigateResult,
  BrowserUsePageActionRequest,
  BrowserUsePageActionResult,
  BrowserUsePageExtractRequest,
  BrowserUsePageExtractResult,
  BrowserUsePageState,
  BrowserUseSessionHandle,
  BrowserUseWaitRequest,
  BrowserUseWaitResult,
} from "../../../shared/browser-use";
import type { BrowserUseRuntimeManager } from "../types";
import { createBrowserUseError } from "../types";

type BrowserUseDaemonSessionLike = {
  readonly session: BrowserUseSessionHandle;
  readonly daemonSessionName: string;
};

const daemonActionFailed = (message: string, details?: Record<string, unknown>) =>
  createBrowserUseError("browser_use_command_failed", message, details);

const daemonActionTimedOut = (message: string, details?: Record<string, unknown>) =>
  createBrowserUseError("browser_use_command_timeout", message, details);

const isCommandTimeoutError = (error: unknown): boolean =>
  error instanceof Error && /timed out/i.test(error.message);

const readErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;

export const ensureBrowserUseDaemonCommandOk = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseDaemonSessionLike,
  action: string,
  params: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => {
  let result;
  try {
    result = await runtime.sendCommand(record.daemonSessionName, action, params);
  } catch (error) {
    if (isCommandTimeoutError(error)) {
      throw daemonActionTimedOut(readErrorMessage(error, `${action} timed out`), {
        action,
        sessionId: record.session.sessionId,
        params,
      });
    }
    throw daemonActionFailed(readErrorMessage(error, `${action} failed`), {
      action,
      sessionId: record.session.sessionId,
      params,
    });
  }
  if (!result.success) {
    throw daemonActionFailed(result.error ?? `${action} failed`, { action, sessionId: record.session.sessionId });
  }
  if (typeof result.data?.error === "string" && result.data.error.trim().length > 0) {
    throw daemonActionFailed(result.data.error.trim(), {
      action,
      sessionId: record.session.sessionId,
      params,
    });
  }
  return result.data ?? {};
};

export const readDaemonPageState = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseDaemonSessionLike,
): Promise<BrowserUsePageState> => {
  const state = await ensureBrowserUseDaemonCommandOk(runtime, record, "state", {});
  const titleResult = await ensureBrowserUseDaemonCommandOk(runtime, record, "get", { get_command: "title" }).catch(
    () => null,
  );
  const title = titleResult !== null && typeof titleResult.title === "string" ? titleResult.title : undefined;
  return {
    sessionId: record.session.sessionId,
    mode: record.session.mode,
    rawState: typeof state._raw_text === "string" ? state._raw_text : "",
    ...(title === undefined ? {} : { title }),
    ...(typeof state.url === "string" ? { url: state.url } : {}),
    ...(typeof state.live_url === "string" ? { liveUrl: state.live_url } : {}),
  };
};

export const extractDaemonPage = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseDaemonSessionLike,
  request: BrowserUsePageExtractRequest,
): Promise<BrowserUsePageExtractResult> => {
  if (request.kind === "title") {
    const result = await ensureBrowserUseDaemonCommandOk(runtime, record, "get", { get_command: "title" });
    return {
      sessionId: record.session.sessionId,
      kind: request.kind,
      ...(typeof result.title === "string" ? { title: result.title } : {}),
    };
  }
  if (request.kind === "html") {
    const result = await ensureBrowserUseDaemonCommandOk(runtime, record, "get", {
      get_command: "html",
      ...(typeof request.selector === "string" ? { selector: request.selector } : {}),
    });
    return {
      sessionId: record.session.sessionId,
      kind: request.kind,
      ...(typeof result.html === "string" ? { html: result.html } : {}),
    };
  }
  const result = await ensureBrowserUseDaemonCommandOk(runtime, record, "get", {
    get_command: request.kind,
    index: request.elementIndex,
  });
  return {
    sessionId: record.session.sessionId,
    kind: request.kind,
    ...(typeof result.text === "string" ? { text: result.text } : {}),
    ...(typeof result.value === "string" ? { value: result.value } : {}),
    ...(result.attributes && typeof result.attributes === "object"
      ? { attributes: result.attributes as Record<string, string> }
      : {}),
    ...(result.bbox && typeof result.bbox === "object"
      ? { bbox: result.bbox as { x: number; y: number; width: number; height: number } }
      : {}),
  };
};

export const runDaemonPageAction = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseDaemonSessionLike,
  request: BrowserUsePageActionRequest,
): Promise<BrowserUsePageActionResult> => {
  const params: Record<string, unknown> = {};
  if (request.kind === "hover" || request.kind === "dblclick" || request.kind === "rightclick") {
    params.index = request.elementIndex;
  } else if (request.kind === "click") {
    if (typeof request.elementIndex === "number") {
      params.args = [request.elementIndex];
    } else if (typeof request.x === "number" && typeof request.y === "number") {
      params.args = [request.x, request.y];
    }
  } else if (request.kind === "type") {
    params.text = request.text;
  } else if (request.kind === "input") {
    params.index = request.elementIndex;
    params.text = request.text;
  } else if (request.kind === "keys") {
    params.keys = request.keys;
  } else if (request.kind === "select") {
    params.index = request.elementIndex;
    params.value = request.value;
  } else if (request.kind === "scroll") {
    params.direction = request.direction ?? "down";
    params.amount = request.amount ?? 500;
  }
  const data = await ensureBrowserUseDaemonCommandOk(runtime, record, request.kind, params);
  return {
    sessionId: record.session.sessionId,
    kind: request.kind,
    ok: true,
    data,
  };
};

export const runDaemonNavigateAction = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseDaemonSessionLike,
  request: BrowserUseNavigateRequest,
): Promise<BrowserUseNavigateResult> => {
  const action = request.kind === "open"
    ? "open"
    : request.kind === "back"
      ? "back"
      : request.kind === "switch"
        ? "switch"
        : "close-tab";
  const params: Record<string, unknown> =
    request.kind === "open"
      ? { url: request.url }
      : request.kind === "switch" || request.kind === "close_tab"
        ? { tab: request.tabIndex }
        : {};
  const data = await ensureBrowserUseDaemonCommandOk(runtime, record, action, params);
  return {
    sessionId: record.session.sessionId,
    kind: request.kind,
    ok: true,
    data,
  };
};

export const waitOnDaemonPage = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseDaemonSessionLike,
  request: BrowserUseWaitRequest,
): Promise<BrowserUseWaitResult> => {
  const params =
    request.kind === "selector"
      ? {
          wait_command: "selector",
          selector: request.selector,
          timeout: request.timeoutMs ?? 5_000,
          state: request.state ?? "visible",
        }
      : {
          wait_command: "text",
          text: request.text,
          timeout: request.timeoutMs ?? 5_000,
        };
  const data = await ensureBrowserUseDaemonCommandOk(runtime, record, "wait", params);
  return {
    sessionId: record.session.sessionId,
    kind: request.kind,
    found: data.found === true,
  };
};

export const runDaemonAgentTask = async (
  runtime: BrowserUseRuntimeManager,
  record: BrowserUseDaemonSessionLike,
  request: BrowserUseAgentRunRequest,
): Promise<BrowserUseAgentRunResult> => {
  return await runtime.runAgentTask({
    daemonSessionName: record.daemonSessionName,
    task: request.task,
    maxSteps: Math.max(1, Math.min(24, Math.round(request.maxSteps ?? 8))),
    ...(typeof request.model === "string" && request.model.trim().length > 0
      ? { model: request.model.trim() }
      : {}),
    ...(typeof record.session.cdpUrl === "string" && record.session.cdpUrl.length > 0
      ? { cdpUrl: record.session.cdpUrl }
      : {}),
  });
};
