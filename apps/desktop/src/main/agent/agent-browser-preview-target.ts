export type AgentBrowserPreviewTarget = {
  readonly tabId: string;
  readonly targetMode: "live" | "isolated";
};

const MAX_AGENT_BROWSER_PREVIEW_STACK = 4;

let stack: AgentBrowserPreviewTarget[] = [];

export const allocateLiveAgentBrowserPreviewTabId = (): string =>
  `browser-agent-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;

export const rememberAgentBrowserPreviewTarget = (
  target: AgentBrowserPreviewTarget
): void => {
  if (target.tabId.length === 0) {
    return;
  }
  stack = [target, ...stack.filter((item) => item.tabId !== target.tabId)].slice(
    0,
    MAX_AGENT_BROWSER_PREVIEW_STACK
  );
};

export const promoteAgentBrowserPreviewTarget = (tabId: string): void => {
  const found = stack.find((item) => item.tabId === tabId);
  if (found === undefined) {
    return;
  }
  rememberAgentBrowserPreviewTarget(found);
};

export const dismissAgentBrowserPreviewTargets = (
  tabId?: string
): readonly AgentBrowserPreviewTarget[] => {
  if (tabId === undefined || tabId.length === 0) {
    const removed = stack;
    stack = [];
    return removed;
  }
  const removed = stack.filter((item) => item.tabId === tabId);
  stack = stack.filter((item) => item.tabId !== tabId);
  return removed;
};

export const clearAgentBrowserPreviewTarget = (): void => {
  stack = [];
};

export const readAgentBrowserPreviewTargets = (): readonly AgentBrowserPreviewTarget[] =>
  stack;

export const readAgentBrowserPreviewTarget = (): AgentBrowserPreviewTarget | null =>
  stack[0] ?? null;

export const resetAgentBrowserPreviewTargetForTests = (): void => {
  stack = [];
};
