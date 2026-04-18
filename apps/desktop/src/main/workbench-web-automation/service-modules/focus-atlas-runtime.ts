import type {
  WorkbenchWebFocusReadResult,
  WorkbenchWebTargetIntent,
} from "../../../shared/workbench-web-automation";
import type { WorkbenchAgentWebSession } from "../agent-session/types";
import { buildFocusAtlas } from "../focus-atlas/build";
import type { FocusAtlasRegistry } from "../focus-atlas/registry";
import type { LiveSelectorScanRegistry } from "../live-selector/scan-session";
import { scanLayoutIntelligenceAcrossFrames } from "../layout-intelligence/service";
import type { WorkbenchWebAutomationServiceDeps } from "../types";

export type WorkbenchWebFocusAtlasRuntime = {
  readonly deps: WorkbenchWebAutomationServiceDeps;
  readonly focusAtlasRegistry: FocusAtlasRegistry;
  readonly scanRegistry: LiveSelectorScanRegistry;
  readonly focusAtlasIntent: WorkbenchWebTargetIntent;
  readonly sharedFocusScanMaxAgeMs: number;
};

export const createWorkbenchWebFocusAtlasRuntime = (
  runtime: WorkbenchWebFocusAtlasRuntime
): {
  readonly rebuildFocusAtlasForTab: (args: {
    readonly tabId: string;
    readonly refresh: boolean;
    readonly session?: WorkbenchAgentWebSession | null;
  }) => Promise<WorkbenchWebFocusReadResult>;
  readonly readSharedFocusAtlasScan: (args: {
    readonly tabId: string;
    readonly minCandidates: number;
  }) => {
    readonly atlasEntry: NonNullable<ReturnType<FocusAtlasRegistry["read"]>>;
    readonly scanSession: NonNullable<ReturnType<LiveSelectorScanRegistry["read"]>>;
  } | null;
  readonly startBackgroundAtlasRefresh: () => () => void;
} => {
  const {
    deps,
    focusAtlasRegistry,
    scanRegistry,
    focusAtlasIntent,
    sharedFocusScanMaxAgeMs,
  } = runtime;

  let backgroundAtlasRefreshInFlight = false;

  const rebuildFocusAtlasForTab = async ({
    tabId,
    refresh,
    session,
  }: {
    readonly tabId: string;
    readonly refresh: boolean;
    readonly session?: WorkbenchAgentWebSession | null;
  }): Promise<WorkbenchWebFocusReadResult> => {
    const cached = refresh ? null : focusAtlasRegistry.read(tabId);
    if (cached !== null) {
      return {
        tabId,
        refreshed: false,
        cached: true,
        atlas: cached.atlas,
        diagnostics: cached.diagnostics
      };
    }

    const { snapshot } = await scanLayoutIntelligenceAcrossFrames({
      deps,
      tabId,
      scope: "visible",
      intent: focusAtlasIntent,
      maxNodes: 256
    });
    const built = buildFocusAtlas({
      tabId,
      snapshot,
      ...(session === undefined ? {} : { session })
    });
    focusAtlasRegistry.write(tabId, {
      atlas: built.atlas,
      diagnostics: built.diagnostics
    });
    return {
      tabId,
      refreshed: true,
      cached: false,
      atlas: built.atlas,
      diagnostics: built.diagnostics
    };
  };

  const readSharedFocusAtlasScan = ({
    tabId,
    minCandidates
  }: {
    readonly tabId: string;
    readonly minCandidates: number;
  }): {
    readonly atlasEntry: NonNullable<ReturnType<FocusAtlasRegistry["read"]>>;
    readonly scanSession: NonNullable<ReturnType<LiveSelectorScanRegistry["read"]>>;
  } | null => {
    const atlasEntry = focusAtlasRegistry.read(tabId);
    if (atlasEntry === null) {
      return null;
    }
    if (
      atlasEntry.preferredScanSessionId === undefined
      || Date.now() - atlasEntry.updatedAt > sharedFocusScanMaxAgeMs
    ) {
      return null;
    }
    const scanSession = scanRegistry.read(atlasEntry.preferredScanSessionId);
    if (scanSession === null) {
      return null;
    }
    if (
      scanSession.tabId !== tabId
      || scanSession.scope !== "visible"
      || scanSession.intent !== focusAtlasIntent
      || scanSession.candidates.length < minCandidates
    ) {
      return null;
    }
    return {
      atlasEntry,
      scanSession
    };
  };

  const startBackgroundAtlasRefresh = (): (() => void) => {
    const timer = setInterval(() => {
      if (backgroundAtlasRefreshInFlight) {
        return;
      }
      const activeTabId = deps.browserBridge.readActiveTabId();
      if (activeTabId === null || activeTabId.length === 0) {
        return;
      }
      const pageState = deps.browserBridge.readPageState({ tabId: activeTabId });
      if (pageState === null || pageState.isVisible !== true) {
        return;
      }
      if (focusAtlasRegistry.isFresh(activeTabId, 1_200)) {
        return;
      }
      backgroundAtlasRefreshInFlight = true;
      void rebuildFocusAtlasForTab({
        tabId: activeTabId,
        refresh: true
      }).catch(() => undefined).finally(() => {
        backgroundAtlasRefreshInFlight = false;
      });
    }, 1_500);

    return () => {
      clearInterval(timer);
    };
  };

  return {
    rebuildFocusAtlasForTab,
    readSharedFocusAtlasScan,
    startBackgroundAtlasRefresh,
  };
};
