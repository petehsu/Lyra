import type {
  WorkbenchBrowserElementPickerAppearance,
  WorkbenchBrowserElementPickerMode,
  WorkbenchBrowserElementPickerDisableCause,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserSetElementPickerModeRequest
} from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserElementPickerController } from "../types";
import { createWorkbenchManualElementPickerSession } from "./manual-session";
import { routeElementPickerConsoleMessage } from "./session";
import type {
  WorkbenchElementPickerControllerDeps,
  WorkbenchElementPickerSessionHost,
  WorkbenchManualElementPickerSession
} from "./types";

const DEFAULT_APPEARANCE: WorkbenchBrowserElementPickerAppearance = {
  fontFamily: '"Geist", "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", "Segoe UI", sans-serif',
  surfaceBackground:
    "linear-gradient(180deg, color-mix(in srgb, #ebebec 92%, transparent) 0%, color-mix(in srgb, #fafafa 88%, transparent) 100%)",
  surfaceBorder: "color-mix(in srgb, #d8d8da 42%, transparent)",
  surfaceShadow: "0 7px 22px color-mix(in srgb, #dcdcdd 18%, transparent)",
  surfaceBackdropFilter: "none",
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
  surfaceBackdropFilter: DEFAULT_APPEARANCE.surfaceBackdropFilter,
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

  return {
    dispose: async () => {
      await enqueue(async () => {
        await disableManual("user_toggle", undefined, false);
        lastState = null;
      });
    },
    setMode: async (request: WorkbenchBrowserSetElementPickerModeRequest) => {
      await enqueue(async () => {
        const appearance = normalizeAppearance(request.appearance);
        if (request.enabled !== true) {
          await disableManual("user_toggle", request.tabId);
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
    handleActiveTabChanged: (activeTabId) => {
      if (manualSession !== null && activeTabId !== manualSession.tabId) {
        void enqueue(async () => {
          await disableManual("tab_switched");
        });
      }
    },
    handlePageNavigated: (tabId) => {
      if (manualSession?.tabId === tabId) {
        void enqueue(async () => {
          await disableManual("page_navigated", tabId);
        });
      }
    },
    handlePageClosed: (tabId) => {
      if (manualSession?.tabId === tabId) {
        void enqueue(async () => {
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
