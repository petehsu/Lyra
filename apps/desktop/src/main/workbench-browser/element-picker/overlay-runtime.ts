import type {
  WorkbenchBrowserAgentTargetInfo,
  WorkbenchBrowserElementPickerAppearance
} from "../../../shared/desktop-bridge";
import type { WorkbenchBrowserElementPickerMode } from "../../../shared/workbench-browser";
import type { WorkbenchBrowserFrameDescriptor } from "../types";
import {
  buildElementPickerClearAgentTargetScript,
  buildElementPickerDisableScript,
  buildElementPickerPrimeScript,
  buildElementPickerSetAgentTargetScript,
  buildElementPickerSetManualModeScript,
} from "./overlay-script";
import type {
  WorkbenchElementPickerOverlayHost,
  WorkbenchElementPickerOverlayRuntime
} from "./types";

const shouldInjectFrame = (
  frame: WorkbenchBrowserFrameDescriptor,
  mainOrigin: string | null
): boolean => frame.isMainFrame || (mainOrigin !== null && frame.origin === mainOrigin);

const listInjectableFrames = (
  frames: readonly WorkbenchBrowserFrameDescriptor[]
): {
  readonly injectableFrames: readonly WorkbenchBrowserFrameDescriptor[];
  readonly hadUnavailableFrame: boolean;
} => {
  const mainFrame = frames.find((frame) => frame.isMainFrame) ?? null;
  const mainOrigin = mainFrame?.origin ?? null;
  const injectableFrames = frames.filter((frame) => shouldInjectFrame(frame, mainOrigin));
  return {
    injectableFrames,
    hadUnavailableFrame: injectableFrames.length !== frames.length
  };
};

const runScriptAcrossFrames = async ({
  host,
  tabId,
  scriptBuilder,
  onlyFrameTreeNodeId
}: {
  readonly host: WorkbenchElementPickerOverlayHost;
  readonly tabId: string;
  readonly scriptBuilder: (frameTreeNodeId: number) => string;
  readonly onlyFrameTreeNodeId?: number;
}): Promise<{
  readonly mainFrameSucceeded: boolean;
  readonly hadUnavailableFrame: boolean;
}> => {
  const frames = host.listFrames(tabId);
  if (frames.length === 0) {
    return {
      mainFrameSucceeded: false,
      hadUnavailableFrame: false
    };
  }

  const { injectableFrames, hadUnavailableFrame } = listInjectableFrames(frames);
  const targetFrames = typeof onlyFrameTreeNodeId === "number"
    ? injectableFrames.filter((frame) => frame.frameTreeNodeId === onlyFrameTreeNodeId)
    : injectableFrames;
  let mainFrameSucceeded = false;

  for (const frame of targetFrames) {
    try {
      await host.executeFrameScript(tabId, {
        frameTreeNodeId: frame.frameTreeNodeId,
        script: scriptBuilder(frame.frameTreeNodeId),
        userGesture: false
      });
      if (frame.isMainFrame) {
        mainFrameSucceeded = true;
      }
    } catch (_error) {
      if (frame.isMainFrame) {
        return {
          mainFrameSucceeded: false,
          hadUnavailableFrame
        };
      }
    }
  }

  return {
    mainFrameSucceeded: targetFrames.some((frame) => frame.isMainFrame) ? mainFrameSucceeded : true,
    hadUnavailableFrame
  };
};

export const createWorkbenchElementPickerOverlayRuntime = ({
  host,
  tabId
}: {
  readonly host: WorkbenchElementPickerOverlayHost;
  readonly tabId: string;
}): WorkbenchElementPickerOverlayRuntime => ({
  prime: async (appearance: WorkbenchBrowserElementPickerAppearance) => {
    return await runScriptAcrossFrames({
      host,
      tabId,
      scriptBuilder: (frameTreeNodeId) => buildElementPickerPrimeScript(frameTreeNodeId, appearance)
    });
  },
  enableManualMode: async (
    appearance: WorkbenchBrowserElementPickerAppearance,
    mode: WorkbenchBrowserElementPickerMode
  ) => {
    const primed = await runScriptAcrossFrames({
      host,
      tabId,
      scriptBuilder: (frameTreeNodeId) => buildElementPickerPrimeScript(frameTreeNodeId, appearance)
    });
    if (primed.mainFrameSucceeded === false) {
      return primed;
    }
    await runScriptAcrossFrames({
      host,
      tabId,
      scriptBuilder: () => buildElementPickerSetManualModeScript(true, mode)
    });
    return primed;
  },
  setAgentTarget: async (
    target: WorkbenchBrowserAgentTargetInfo,
    appearance: WorkbenchBrowserElementPickerAppearance
  ) => {
    const primed = await runScriptAcrossFrames({
      host,
      tabId,
      scriptBuilder: (frameTreeNodeId) => buildElementPickerPrimeScript(frameTreeNodeId, appearance)
    });
    if (primed.mainFrameSucceeded === false) {
      return primed;
    }
    await runScriptAcrossFrames({
      host,
      tabId,
      scriptBuilder: () => buildElementPickerClearAgentTargetScript()
    });
    await runScriptAcrossFrames({
      host,
      tabId,
      onlyFrameTreeNodeId: target.frameTreeNodeId,
      scriptBuilder: () => buildElementPickerSetAgentTargetScript(target)
    });
    return primed;
  },
  clearAgentTarget: async () => {
    await runScriptAcrossFrames({
      host,
      tabId,
      scriptBuilder: () => buildElementPickerClearAgentTargetScript()
    });
  },
  disable: async () => {
    await runScriptAcrossFrames({
      host,
      tabId,
      scriptBuilder: () => buildElementPickerDisableScript()
    });
  }
});
