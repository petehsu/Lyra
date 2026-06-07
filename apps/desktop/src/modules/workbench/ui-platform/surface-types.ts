import type { ComponentType } from "react";

import type { AiPanelSurfaceProps } from "../ai-panel";
import type {
  BrowserPageSurfaceProps,
  BrowserSearchSurfaceProps,
  BrowserSettingsSurfaceProps
} from "../browser-tabs";
import type {
  BrowserResultSurfaceProps
} from "../browser-search";
import type { FileEditorSurfaceProps } from "../file-editor";
import type { FileManagerSurfaceProps } from "../file-manager";
import type { ImageViewerSurfaceProps } from "../image-viewer";
import type { NotificationCenterSurfaceProps } from "../notifications";
import type { AgentSessionHistorySurfaceProps } from "../agent-session-history";
import type { LoginManagerSurfaceProps } from "../login-manager";
import type { AgentProjectTreeSurfaceProps } from "../agent-project-tree";
import type { AgentGitSurfaceProps } from "../agent-git";
import type { AgentSelfDevSurfaceProps } from "../agent-selfdev";
import type { AgentOvernightSurfaceProps } from "../agent-overnight";
import type {
  TerminalDockProps,
  TerminalWorkspaceSurfaceProps
} from "../terminal-dock";

export type WorkbenchSurfaceAdapters = {
  readonly searchHome: ComponentType<BrowserSearchSurfaceProps>;
  readonly searchResults: ComponentType<BrowserResultSurfaceProps>;
  readonly browserPage: ComponentType<BrowserPageSurfaceProps>;
  readonly settings: ComponentType<BrowserSettingsSurfaceProps>;
  readonly terminalWorkspace: ComponentType<TerminalWorkspaceSurfaceProps>;
  readonly fileManager: ComponentType<FileManagerSurfaceProps>;
  readonly fileEditor: ComponentType<FileEditorSurfaceProps>;
  readonly imageViewer: ComponentType<ImageViewerSurfaceProps>;
  readonly agentProjectTree: ComponentType<AgentProjectTreeSurfaceProps>;
  readonly agentGit: ComponentType<AgentGitSurfaceProps>;
  readonly agentSelfDev: ComponentType<AgentSelfDevSurfaceProps>;
  readonly agentOvernight: ComponentType<AgentOvernightSurfaceProps>;
  readonly notificationCenter: ComponentType<NotificationCenterSurfaceProps>;
  readonly agentSessionHistory: ComponentType<AgentSessionHistorySurfaceProps>;
  readonly loginManager: ComponentType<LoginManagerSurfaceProps>;
};

export const WORKBENCH_SURFACE_ADAPTER_KEYS = [
  "searchHome",
  "searchResults",
  "browserPage",
  "settings",
  "terminalWorkspace",
  "fileManager",
  "fileEditor",
  "imageViewer",
  "agentProjectTree",
  "agentGit",
  "agentSelfDev",
  "agentOvernight",
  "notificationCenter",
  "agentSessionHistory",
  "loginManager"
] as const satisfies readonly (keyof WorkbenchSurfaceAdapters)[];

export type WorkbenchPanelAdapters = {
  readonly aiPanel: ComponentType<AiPanelSurfaceProps>;
  readonly terminalDock: ComponentType<TerminalDockProps>;
};

export const WORKBENCH_PANEL_ADAPTER_KEYS = [
  "aiPanel",
  "terminalDock"
] as const satisfies readonly (keyof WorkbenchPanelAdapters)[];
