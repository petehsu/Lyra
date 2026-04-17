import type {
  WorkbenchBrowserElementPickerMode,
  WorkbenchBrowserElementPickerDisableCause,
  WorkbenchBrowserElementPickerState,
  WorkbenchBrowserEvent,
  WorkbenchBrowserHoveredElementInfo
} from "../../../shared/desktop-bridge";
import { createWorkbenchElementPickerOverlayRuntime } from "./overlay-runtime";
import type {
  WorkbenchElementPickerConsoleMessage,
  WorkbenchElementPickerDisableOptions,
  WorkbenchElementPickerSessionDeps,
  WorkbenchManualElementPickerSession,
} from "./types";

const publishState = (
  publishEvent: (event: WorkbenchBrowserEvent) => void,
  tabId: string,
  enabled: boolean,
  mode: WorkbenchBrowserElementPickerMode,
  cause?: WorkbenchBrowserElementPickerDisableCause,
  errorCode?: WorkbenchBrowserElementPickerState["errorCode"]
): void => {
  publishEvent({
    kind: "element-picker-state",
    state: {
      tabId,
      enabled,
      ...(enabled ? { owner: "manual", phase: "idle" as const, mode } : { mode }),
      ...(cause === undefined ? {} : { cause }),
      ...(errorCode === undefined ? {} : { errorCode })
    }
  });
};

export const createWorkbenchManualElementPickerSession = ({
  host,
  tabId,
  appearance,
  mode,
  onDisableRequested
}: WorkbenchElementPickerSessionDeps): WorkbenchManualElementPickerSession => {
  let enabled = false;
  const runtime = createWorkbenchElementPickerOverlayRuntime({ host, tabId });

  const disable = async (
    cause: WorkbenchBrowserElementPickerDisableCause,
    options?: WorkbenchElementPickerDisableOptions
  ): Promise<void> => {
    const wasEnabled = enabled;
    enabled = false;
    await runtime.disable().catch(() => undefined);
    if (options?.publishState === false || wasEnabled === false) {
      return;
    }
    publishState(host.publishEvent, tabId, false, mode, cause, options?.errorCode);
  };

  return {
    tabId,
    enable: async () => {
      const result = await runtime.enableManualMode(appearance, mode);
      if (result.mainFrameSucceeded === false) {
        publishState(host.publishEvent, tabId, false, mode, "script_error", "script_injection_failed");
        return {
          ok: false,
          hadUnavailableFrame: result.hadUnavailableFrame
        };
      }
      enabled = true;
      publishState(host.publishEvent, tabId, true, mode);
      return {
        ok: true,
        hadUnavailableFrame: result.hadUnavailableFrame
      };
    },
    disable,
    handleConsoleMessage: (message: WorkbenchElementPickerConsoleMessage) => {
      if (enabled === false) {
        return { disableRequested: false };
      }
      if (message.kind === "hover") {
        const hover: WorkbenchBrowserHoveredElementInfo = {
          tabId,
          frameTreeNodeId: message.frameTreeNodeId,
          tagName: message.tagName,
          selectorPreview: message.selectorPreview,
          bounds: message.bounds,
          ...(message.role === undefined ? {} : { role: message.role }),
          ...(message.inputType === undefined ? {} : { inputType: message.inputType }),
          ...(message.ariaLabel === undefined ? {} : { ariaLabel: message.ariaLabel }),
          ...(message.placeholder === undefined ? {} : { placeholder: message.placeholder }),
          ...(message.textSnippet === undefined ? {} : { textSnippet: message.textSnippet }),
          ...(message.containerBounds === undefined ? {} : { containerBounds: message.containerBounds }),
          ...(message.widgetKind === undefined ? {} : { widgetKind: message.widgetKind }),
          ...(message.widgetLabel === undefined ? {} : { widgetLabel: message.widgetLabel }),
          ...(message.affordanceLabel === undefined ? {} : { affordanceLabel: message.affordanceLabel }),
          ...(message.affordanceAction === undefined ? {} : { affordanceAction: message.affordanceAction }),
          ...(message.cursorStyle === undefined ? {} : { cursorStyle: message.cursorStyle }),
          ...(message.tooltipText === undefined ? {} : { tooltipText: message.tooltipText }),
          ...(message.stateHint === undefined ? {} : { stateHint: message.stateHint }),
          ...(message.frameUrl === undefined ? {} : { frameUrl: message.frameUrl }),
          ...(message.crossOriginBoundary === true ? { crossOriginBoundary: true } : {})
        };
        host.publishEvent({ kind: "element-picker-hover", hover });
        return { disableRequested: false };
      }

      if (message.enabled === false) {
        const cause = message.cause ?? "script_error";
        onDisableRequested(cause);
        return { disableRequested: true, cause };
      }

      return { disableRequested: false };
    }
  };
};
