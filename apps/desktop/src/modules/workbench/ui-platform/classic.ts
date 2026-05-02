import { AiHistorySurface } from "../ai-history";
import { AiPanelSurface, AiPlanReviewSurface } from "../ai-panel";
import {
  BrowserPageSurface,
  BrowserSearchSurface,
  BrowserSettingsSurface,
  ClassicWorkspaceTabsAdapter
} from "../browser-tabs";
import { BrowserResultSurface, DeepSearchResultSurface } from "../browser-search";
import { FileEditorSurface } from "../file-editor";
import { FileManagerSurface } from "../file-manager";
import { ImageViewerSurface } from "../image-viewer";
import { CLASSIC_WORKBENCH_INTERACTION_POLICIES } from "../interaction-policy";
import { McpCenterSurface } from "../mcp-center";
import { NotificationCenterSurface } from "../notifications";
import { PluginsCenterSurface } from "../plugins-center";
import { ResourceMonitorSurface } from "../resource-monitor";
import { SkillsCenterSurface } from "../skills-center";
import { WorkbenchChrome } from "../shell/workbench-chrome";
import { WorkspaceSurfaceRouter } from "../shell/workspace-surface-router";
import { TerminalDock, TerminalWorkspaceSurface } from "../terminal-dock";
import { CLASSIC_WORKBENCH_UI_STYLE_PACK } from "../ui-style/classic";
import type { WorkbenchUiPack } from "./types";

export const CLASSIC_WORKBENCH_UI_PACK = {
  manifest: {
    id: "classic",
    labelKey: "settings.uiStyle.classic",
    descriptionKey: "settings.uiStyleDescription.classic",
    version: "1.0.0",
    compatibility: {
      workbenchUiApi: "1"
    },
    source: {
      type: "builtin"
    },
    capabilities: {
      supportsStyleTokens: true,
      supportsShellAdapter: true,
      supportsWorkspaceTabsAdapter: true,
      supportsPanelAdapters: true,
      supportsWorkspaceSurfaceAdapter: true,
      supportsWorkbenchSurfaceAdapters: true,
      supportsInteractionPolicy: true,
      supportsTrustedJsDistribution: false,
      supportsCommunityDistribution: false
    }
  },
  style: CLASSIC_WORKBENCH_UI_STYLE_PACK,
  adapters: {
    shell: WorkbenchChrome,
    workspaceTabs: ClassicWorkspaceTabsAdapter,
    aiPanel: AiPanelSurface,
    terminalDock: TerminalDock,
    workspaceSurface: WorkspaceSurfaceRouter,
    surfaces: {
      searchHome: BrowserSearchSurface,
      searchResults: BrowserResultSurface,
      deepSearchResults: DeepSearchResultSurface,
      browserPage: BrowserPageSurface,
      settings: BrowserSettingsSurface,
      terminalWorkspace: TerminalWorkspaceSurface,
      fileManager: FileManagerSurface,
      fileEditor: FileEditorSurface,
      imageViewer: ImageViewerSurface,
      resourceMonitor: ResourceMonitorSurface,
      notificationCenter: NotificationCenterSurface,
      mcpCenter: McpCenterSurface,
      skillsCenter: SkillsCenterSurface,
      pluginsCenter: PluginsCenterSurface,
      aiHistory: AiHistorySurface,
      planReview: AiPlanReviewSurface
    }
  },
  interactions: CLASSIC_WORKBENCH_INTERACTION_POLICIES
} satisfies WorkbenchUiPack;
