import type { ComponentType } from "react";

import type { AiPanelSurfaceProps } from "../ai-panel";
import type {
  BrowserPageSurfaceProps,
  BrowserSearchSurfaceProps,
  BrowserSettingsSurfaceProps
} from "../browser-tabs";
import type {
  BrowserResultSurfaceProps,
  DeepSearchResultSurfaceProps
} from "../browser-search";
import type { FileEditorSurfaceProps } from "../file-editor";
import type { FileManagerSurfaceProps } from "../file-manager";
import type { ImageViewerSurfaceProps } from "../image-viewer";
import type { NotificationCenterSurfaceProps } from "../notifications";
import type { ResourceMonitorSurfaceProps } from "../resource-monitor";
import type {
  TerminalDockProps,
  TerminalWorkspaceSurfaceProps
} from "../terminal-dock";

export type WorkbenchSurfaceAdapters = {
  readonly searchHome: ComponentType<BrowserSearchSurfaceProps>;
  readonly searchResults: ComponentType<BrowserResultSurfaceProps>;
  readonly deepSearchResults: ComponentType<DeepSearchResultSurfaceProps>;
  readonly browserPage: ComponentType<BrowserPageSurfaceProps>;
  readonly settings: ComponentType<BrowserSettingsSurfaceProps>;
  readonly terminalWorkspace: ComponentType<TerminalWorkspaceSurfaceProps>;
  readonly fileManager: ComponentType<FileManagerSurfaceProps>;
  readonly fileEditor: ComponentType<FileEditorSurfaceProps>;
  readonly imageViewer: ComponentType<ImageViewerSurfaceProps>;
  readonly resourceMonitor: ComponentType<ResourceMonitorSurfaceProps>;
  readonly notificationCenter: ComponentType<NotificationCenterSurfaceProps>;
};

export const WORKBENCH_SURFACE_ADAPTER_KEYS = [
  "searchHome",
  "searchResults",
  "deepSearchResults",
  "browserPage",
  "settings",
  "terminalWorkspace",
  "fileManager",
  "fileEditor",
  "imageViewer",
  "resourceMonitor",
  "notificationCenter"
] as const satisfies readonly (keyof WorkbenchSurfaceAdapters)[];

export type WorkbenchPanelAdapters = {
  readonly aiPanel: ComponentType<AiPanelSurfaceProps>;
  readonly terminalDock: ComponentType<TerminalDockProps>;
};

export const WORKBENCH_PANEL_ADAPTER_KEYS = [
  "aiPanel",
  "terminalDock"
] as const satisfies readonly (keyof WorkbenchPanelAdapters)[];
