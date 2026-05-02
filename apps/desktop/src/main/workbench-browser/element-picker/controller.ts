import type {
  WorkbenchBrowserAgentTargetInfo,
  WorkbenchBrowserElementPickerAppearance,
  WorkbenchBrowserElementPickerMode,
  WorkbenchBrowserElementPickerDisableCause,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserSetElementPickerModeRequest
} from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserElementPickerController } from "../types";
import { createWorkbenchAgentElementPickerSession } from "./agent-session";
import { createWorkbenchManualElementPickerSession } from "./manual-session";
import { routeElementPickerConsoleMessage } from "./session";
import type {
  WorkbenchAgentElementPickerSession,
  WorkbenchElementPickerControllerDeps,
  WorkbenchElementPickerSessionHost,
  WorkbenchManualElementPickerSession
} from "./types";

const DEFAULT_APPEARANCE: WorkbenchBrowserElementPickerAppearance = {
  fontFamily: '"IBM Plex Sans", "Noto Sans SC", "PingFang SC", "Segoe UI", sans-serif',
  surfaceBackground:
    "linear-gradient(180deg, color-mix(in srgb, #ebebec 92%, transparent) 0%, color-mix(in srgb, #fafafa 88%, transparent) 100%)",
  surfaceBorder: "color-mix(in srgb, #c9c9ca 74%, transparent)",
  surfaceShadow: "0 7px 22px color-mix(in srgb, #dcdcdd 18%, transparent)",
  surfaceBackdropFilter: "blur(10px) saturate(1.08)",
  accentColor: "#7e8086",
  accentFill: "color-mix(in srgb, #7e8086 14%, transparent)",
  tagBackground: "color-mix(in srgb, #7e8086 12%, transparent)",
  tagText: "#58585a",
  textPrimary: "#242529",
  textSecondary: "#58585a",
  textMuted: "#7e8086",
  frameRadius: "8px",
  bubbleRadius: "10px",
  strokeWidth: "0.5px"
};

const normalizeAppearance = (
  appearance: WorkbenchBrowserElementPickerAppearance | undefined
): WorkbenchBrowserElementPickerAppearance => ({
  fontFamily: appearance?.fontFamily?.trim() || DEFAULT_APPEARANCE.fontFamily,
  surfaceBackground: appearance?.surfaceBackground?.trim() || DEFAULT_APPEARANCE.surfaceBackground,
  surfaceBorder: appearance?.surfaceBorder?.trim() || DEFAULT_APPEARANCE.surfaceBorder,
  surfaceShadow: appearance?.surfaceShadow?.trim() || DEFAULT_APPEARANCE.surfaceShadow,
  surfaceBackdropFilter:
    appearance?.surfaceBackdropFilter?.trim() || DEFAULT_APPEARANCE.surfaceBackdropFilter,
  accentColor: appearance?.accentColor?.trim() || DEFAULT_APPEARANCE.accentColor,
  accentFill: appearance?.accentFill?.trim() || DEFAULT_APPEARANCE.accentFill,
  tagBackground: appearance?.tagBackground?.trim() || DEFAULT_APPEARANCE.tagBackground,
  tagText: appearance?.tagText?.trim() || DEFAULT_APPEARANCE.tagText,
  textPrimary: appearance?.textPrimary?.trim() || DEFAULT_APPEARANCE.textPrimary,
  textSecondary: appearance?.textSecondary?.trim() || DEFAULT_APPEARANCE.textSecondary,
  textMuted: appearance?.textMuted?.trim() || DEFAULT_APPEARANCE.textMuted,
  frameRadius: appearance?.frameRadius?.trim() || DEFAULT_APPEARANCE.frameRadius,
  bubbleRadius: appearance?.bubbleRadius?.trim() || DEFAULT_APPEARANCE.bubbleRadius,
  strokeWidth: appearance?.strokeWidth?.trim() || DEFAULT_APPEARANCE.strokeWidth
});

type RestorableManualState = {
  readonly tabId: string;
  readonly appearance: WorkbenchBrowserElementPickerAppearance;
  readonly mode: WorkbenchBrowserElementPickerMode;
};

export const createWorkbenchBrowserElementPickerController = ({
  host
}: WorkbenchElementPickerControllerDeps): WorkbenchBrowserElementPickerController => {
  let queue = Promise.resolve<void>(undefined);
  let manualSession: WorkbenchManualElementPickerSession | null = null;
  let manualAppearance: WorkbenchBrowserElementPickerAppearance | null = null;
  let manualMode: WorkbenchBrowserElementPickerMode = "inspect";
  let agentSession: WorkbenchAgentElementPickerSession | null = null;
  let restoreManualState: RestorableManualState | null = null;
  let lastState: WorkbenchBrowserElementPickerState | null = null;

  const publishTrackingHost: WorkbenchElementPickerSessionHost = {
    ...host,
    publishEvent: (event) => {
      if (event.kind === "element-picker-state") {
        lastState = event.state;
      }
      host.publishEvent(event);
    }
  };

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.catch(() => undefined).then(task);
    return queue;
  };

  const createManualSession = (
    tabId: string,
    appearance: WorkbenchBrowserElementPickerAppearance,
    mode: WorkbenchBrowserElementPickerMode
  ) =>
    createWorkbenchManualElementPickerSession({
      host: publishTrackingHost,
      tabId,
      appearance,
      mode,
      onDisableRequested: (cause) => {
        void enqueue(async () => {
          if (manualSession?.tabId !== tabId) {
            return;
          }
          const current = manualSession;
          manualSession = null;
          manualAppearance = null;
          await current.disable(cause);
        });
      }
    });

  const createAgentSession = (tabId: string) => createWorkbenchAgentElementPickerSession({
    host: publishTrackingHost,
    tabId
  });

  const disableManual = async (
    cause: WorkbenchBrowserElementPickerDisableCause,
    tabId?: string,
    publishState = true
  ): Promise<void> => {
    if (manualSession === null) {
      return;
    }
    if (tabId !== undefined && manualSession.tabId !== tabId) {
      return;
    }
    const session = manualSession;
    manualSession = null;
    manualAppearance = null;
    await session.disable(cause, { publishState });
  };

  const disableAgent = async (
    cause: WorkbenchBrowserElementPickerDisableCause,
    tabId?: string,
    publishState = true
  ): Promise<void> => {
    if (agentSession === null) {
      return;
    }
    if (tabId !== undefined && agentSession.tabId !== tabId) {
      return;
    }
    const session = agentSession;
    agentSession = null;
    restoreManualState = null;
    await session.disable(cause, { publishState });
  };

  const restoreManualIfNeeded = async (tabId: string): Promise<void> => {
    if (restoreManualState === null || restoreManualState.tabId !== tabId) {
      return;
    }
    const next = restoreManualState;
    restoreManualState = null;
    manualAppearance = next.appearance;
    manualMode = next.mode;
    manualSession = createManualSession(tabId, next.appearance, next.mode);
    await manualSession.enable();
  };

  return {
    dispose: async () => {
      await enqueue(async () => {
        await disableAgent("user_toggle", undefined, false);
        await disableManual("user_toggle", undefined, false);
        lastState = null;
      });
    },
    setMode: async (request: WorkbenchBrowserSetElementPickerModeRequest) => {
      await enqueue(async () => {
        const appearance = normalizeAppearance(request.appearance);
        if (request.enabled !== true) {
          if (restoreManualState?.tabId === request.tabId) {
            restoreManualState = null;
          }
          await disableManual("user_toggle", request.tabId);
          return;
        }

        if (agentSession?.tabId === request.tabId) {
          restoreManualState = {
            tabId: request.tabId,
            appearance,
            mode: request.mode ?? "inspect"
          };
          return;
        }

        if (manualSession !== null && manualSession.tabId !== request.tabId) {
          await disableManual("tab_switched");
        }

        manualMode = request.mode ?? "inspect";
        if (manualSession?.tabId === request.tabId) {
          if (lastState?.enabled === true && lastState.mode === manualMode) {
            return;
          }
          await disableManual("user_toggle", request.tabId, false);
        }

        manualAppearance = appearance;
        manualSession = createManualSession(request.tabId, appearance, manualMode);
        await manualSession.enable();
      });
    },
    showAgentTarget: async (target: WorkbenchBrowserAgentTargetInfo) => {
      let shown = false;
      await enqueue(async () => {
        if (manualSession?.tabId === target.tabId) {
          restoreManualState = {
            tabId: target.tabId,
            appearance: manualAppearance ?? DEFAULT_APPEARANCE,
            mode: manualMode
          };
          await disableManual("user_toggle", target.tabId, false);
        }
        if (agentSession !== null && agentSession.tabId !== target.tabId) {
          await disableAgent("tab_switched", undefined, false);
        }
        if (agentSession === null || agentSession.tabId !== target.tabId) {
          agentSession = createAgentSession(target.tabId);
        }
        shown = await agentSession.showTarget(target, manualAppearance ?? DEFAULT_APPEARANCE);
      });
      return shown;
    },
    clearAgentTarget: async (tabId: string, options?: { readonly preserveManualMode?: boolean }) => {
      await enqueue(async () => {
        if (agentSession?.tabId !== tabId) {
          return;
        }
        const session = agentSession;
        agentSession = null;
        await session.clearTarget(options?.preserveManualMode !== true);
        if (options?.preserveManualMode !== false) {
          await restoreManualIfNeeded(tabId);
        } else {
          restoreManualState = null;
        }
      });
    },
    handleActiveTabChanged: (activeTabId) => {
      if (manualSession !== null && activeTabId !== manualSession.tabId) {
        void enqueue(async () => {
          await disableManual("tab_switched");
        });
      }
      if (agentSession !== null && activeTabId !== agentSession.tabId) {
        void enqueue(async () => {
          await disableAgent("tab_switched");
        });
      }
    },
    handlePageNavigated: (tabId) => {
      if (manualSession?.tabId === tabId || agentSession?.tabId === tabId) {
        void enqueue(async () => {
          await disableAgent("page_navigated", tabId);
          await disableManual("page_navigated", tabId);
        });
      }
    },
    handlePageClosed: (tabId) => {
      if (manualSession?.tabId === tabId || agentSession?.tabId === tabId) {
        void enqueue(async () => {
          await disableAgent("page_closed", tabId);
          await disableManual("page_closed", tabId);
        });
      }
    },
    handleConsoleMessage: (tabId, message) => {
      if (manualSession !== null && manualSession.tabId === tabId) {
        routeElementPickerConsoleMessage(manualSession, message);
      }
    },
    readState: () => lastState
  };
};
