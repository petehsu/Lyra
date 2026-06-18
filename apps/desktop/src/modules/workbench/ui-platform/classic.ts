import { AiPanelSurface } from "../ai-panel";
import {
  BrowserPageSurface,
  BrowserSearchSurface,
  BrowserSettingsSurface,
  ClassicWorkspaceTabsAdapter
} from "../browser-tabs";
import { BrowserResultSurface } from "../browser-search";
import { FileEditorSurface } from "../file-editor";
import { FileManagerSurface } from "../file-manager";
import { ImageViewerSurface } from "../image-viewer";
import { AgentProjectTreeSurface } from "../agent-project-tree";
import { AgentGitSurface } from "../agent-git";
import { CLASSIC_WORKBENCH_INTERACTION_POLICIES } from "../interaction-policy";
import { NotificationCenterSurface } from "../notifications";
import { AgentSessionHistorySurface } from "../agent-session-history";
import { LoginManagerSurface } from "../login-manager";
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
      browserPage: BrowserPageSurface,
      settings: BrowserSettingsSurface,
      terminalWorkspace: TerminalWorkspaceSurface,
      fileManager: FileManagerSurface,
      fileEditor: FileEditorSurface,
      imageViewer: ImageViewerSurface,
      agentProjectTree: AgentProjectTreeSurface,
      agentGit: AgentGitSurface,
      notificationCenter: NotificationCenterSurface,
      agentSessionHistory: AgentSessionHistorySurface,
      loginManager: LoginManagerSurface
    }
  },
  interactions: CLASSIC_WORKBENCH_INTERACTION_POLICIES
} satisfies WorkbenchUiPack;