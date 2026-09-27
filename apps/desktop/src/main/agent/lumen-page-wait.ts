import type { WorkbenchBrowserIpcBridge } from "../workbench-browser/service";

export const waitForLumenPage = async (
  browser: Pick<WorkbenchBrowserIpcBridge, "readAgentPage">,
  tabId: string,
  request: {
    readonly targetMode: "isolated" | "live";
    readonly visibleFollow?: boolean;
    readonly authState?: "none" | "borrowLiveLogin";
    readonly useLiveLoginState?: boolean;
    readonly until: "loadIdle" | "textChanged" | "textStable" | "textContains" | "targetHidden" | "targetEnabled" | "responseComplete";
    readonly operationId?: string;
    readonly navigationFromUrl?: string;
    readonly timeoutMs: number;
    readonly idleMs: number;
    readonly maxChars?: number;
    readonly scope?: "viewport" | "full";
    readonly text?: string;
    readonly targetRef?: string;
    readonly previousText?: string;
  }
) => {
  if (request.until === "textChanged" && typeof request.previousText !== "string") {
    throw new Error("textChanged requires the complete text read before the action. The page may already have changed; use textContains with the expected result, or targetEnabled/targetHidden. No wait was started.");
  }
  if (request.until === "responseComplete" && !request.operationId) throw new Error("responseComplete requires a response observation from this task's preceding send. No wait was started.");
  const startedAt = Date.now();
  const deadline = startedAt + request.timeoutMs;
  const pollDelayMs = Math.max(20, Math.min(250, request.idleMs));
  let firstContent: string | null = request.previousText ?? null;
  let previousContent: string | null = null;
  let stableSince = Date.now();
  let lastContent = "";
  let lastReadContent: Awaited<ReturnType<typeof browser.readAgentPage>> | null = null;

  while (Date.now() <= deadline - 320) {
    const remainingMs = deadline - Date.now();
    const readTimeoutMs = Math.max(250, Math.min(4_000, remainingMs - 60));
    let content: Awaited<ReturnType<typeof browser.readAgentPage>>;
    try { content = await browser.readAgentPage(tabId, {
      strategy: "focus",
      scope: request.scope ?? "full",
      textTail: request.until !== "textChanged",
      ...(request.until === "textContains" && request.text !== undefined ? { waitText: request.text } : {}),
      targetMode: request.targetMode,
      ...(request.visibleFollow === undefined ? {} : { visibleFollow: request.visibleFollow }),
      ...(request.authState === undefined ? {} : { authState: request.authState }),
      ...(request.useLiveLoginState === undefined ? {} : { useLiveLoginState: request.useLiveLoginState }),
      timeoutMs: readTimeoutMs,
      ...(request.targetRef === undefined ? {} : { waitTargetRef: request.targetRef }),
      ...(request.until === "responseComplete" ? { waitOperationId: request.operationId, responseStateOnly: true } : {}),
      ...(request.maxChars === undefined ? {} : { maxChars: request.maxChars })
    });
    } catch (error) {
      // Read-only retries stay inside the original budget; never retry mutations
      // or conceal a closed tab, permissions error, or control handoff.
      if (!/frame script timed out|execution context was destroyed|frame was detached/i.test(String(error))) throw error;
      if (Date.now() >= deadline - 320) throw error;
      await new Promise(resolve => setTimeout(resolve, pollDelayMs));
      continue;
    }
    lastReadContent = content;
    lastContent = content.content;
    const state = content.waitState;
    if (request.until === "responseComplete") {
      const response = state?.response;
      if (!response || response.operationId !== request.operationId || response.status === "unknown" || response.status === "superseded") break;
      if (response.status === "complete") return { content, matched: true, elapsedMs: Date.now() - startedAt };
      await new Promise(resolve => setTimeout(resolve, pollDelayMs));
      continue;
    }
    const observedText = state?.textFingerprint ?? lastContent;
    if (firstContent === null) {
      firstContent = lastContent;
    }

    if (
      request.until === "textContains"
      && request.text !== undefined
      && (state?.textMatch === true || lastContent.includes(request.text))
    ) {
      return { content, matched: true, elapsedMs: Date.now() - startedAt };
    }
    if (request.until === "textChanged" && content.truncated !== true && state?.coverage?.scanComplete !== false && firstContent !== lastContent) {
      return { content, matched: true, elapsedMs: Date.now() - startedAt };
    }

    if ((request.until === "targetHidden" && state?.target?.visible === false)
      || (request.until === "targetEnabled" && state?.target?.enabled === true)) {
      return { content, matched: true, elapsedMs: Date.now() - startedAt };
    }

    // A navigation result can supersede an anticipated intermediate screen
    // (for example SSO skipped an account picker). Return the new page, not a
    // fabricated text match, once it is ready and quiet.
    if (request.until === "textContains" && request.navigationFromUrl
      && "url" in content && content.url && content.url !== request.navigationFromUrl
      && state?.readyState === "complete" && state.busy !== true
      && previousContent === observedText && Date.now() - stableSince >= request.idleMs) {
      return { content, matched: false, elapsedMs: Date.now() - startedAt, stopReason: "navigationChanged" as const };
    }

    // Loading/busy time never counts as the quiet interval. An empty or
    // truncated read cannot prove that the page's text stopped changing.
    const eligible = state?.busy !== true && state?.readyState !== "loading"
      && (request.until === "loadIdle"
        ? state?.readyState === "complete"
        : lastContent.trim().length > 0 && (state?.coverage?.scanComplete !== false && (state?.textFingerprint !== undefined || content.truncated !== true)));
    if (previousContent !== observedText || !eligible) {
      previousContent = observedText;
      stableSince = Date.now();
    } else if (
      (request.until === "textStable" || request.until === "loadIdle")
      && Date.now() - stableSince >= request.idleMs
    ) {
      return { content, matched: true, elapsedMs: Date.now() - startedAt };
    }

    await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
  }

  const content = (request.until === "responseComplete" ? null : lastReadContent) ?? await browser.readAgentPage(tabId, {
    strategy: "focus",
      scope: request.scope ?? "full",
      textTail: request.until !== "textChanged",
      ...(request.until === "textContains" && request.text !== undefined ? { waitText: request.text } : {}),
    targetMode: request.targetMode,
    ...(request.visibleFollow === undefined ? {} : { visibleFollow: request.visibleFollow }),
    ...(request.authState === undefined ? {} : { authState: request.authState }),
    ...(request.useLiveLoginState === undefined ? {} : { useLiveLoginState: request.useLiveLoginState }),
    timeoutMs: 250,
    ...(request.targetRef === undefined ? {} : { waitTargetRef: request.targetRef }),
    ...(request.until === "responseComplete" ? { waitOperationId: request.operationId } : {}),
    ...(request.maxChars === undefined ? {} : { maxChars: request.maxChars })
  });
  if (request.until === "responseComplete" && content.waitState?.response?.status === "complete" && content.waitState.response.operationId === request.operationId) {
    return { content, matched: true, elapsedMs: Date.now() - startedAt };
  }
  if (
    request.until === "textContains"
    && request.text !== undefined
    && (content.waitState?.textMatch === true || content.content.includes(request.text))
  ) {
    return { content, matched: true, elapsedMs: Date.now() - startedAt };
  }
  return {
    content,
    matched: false,
    elapsedMs: Date.now() - startedAt,
    lastContent
  };
};
