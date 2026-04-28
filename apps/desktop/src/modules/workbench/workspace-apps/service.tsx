import type { ReactNode } from "react";

import {
  renderAiPanelAppIcon,
  type AiPanelAppIconKey
} from "../ai-panel";
import {
  renderFileEditorAppIcon,
  type FileEditorAppIconKey,
  type FileEditorAppId
} from "../file-editor";
import {
  renderFileManagerAppIcon,
  type FileManagerAppIconKey,
  type FileManagerAppId
} from "../file-manager";
import {
  renderNotificationCenterAppIcon
} from "../notifications/icon-registry";
import type { WorkbenchAppId, WorkspaceAppIconKey } from "./types";

const renderers: Record<WorkbenchAppId, (iconKey: WorkspaceAppIconKey) => ReactNode> = {
  "file-manager": (iconKey) => renderFileManagerAppIcon(iconKey as FileManagerAppIconKey),
  "file-editor": (iconKey) => renderFileEditorAppIcon(iconKey as FileEditorAppIconKey),
  "ai-history": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "ai-mcp": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "ai-skills": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "ai-plugins": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "notification-center": (iconKey) =>
    renderNotificationCenterAppIcon(iconKey as "notification-center-default")
};

const hasWorkspaceAppIconRenderer = (
  appId: string
): appId is keyof typeof renderers => appId in renderers;

export const renderWorkspaceAppIcon = (
  appId: WorkbenchAppId,
  iconKey: WorkspaceAppIconKey
): ReactNode =>
  hasWorkspaceAppIconRenderer(appId)
    ? renderers[appId](iconKey)
    : renderNotificationCenterAppIcon("notification-center-default");

export const isFileManagerAppId = (value: WorkbenchAppId): value is FileManagerAppId =>
  value === "file-manager";

export const isFileEditorAppId = (value: WorkbenchAppId): value is FileEditorAppId =>
  value === "file-editor";

export const isAiHistoryAppId = (value: WorkbenchAppId): value is "ai-history" =>
  value === "ai-history";

export const isAiMcpAppId = (value: WorkbenchAppId): value is "ai-mcp" =>
  value === "ai-mcp";

export const isAiSkillsAppId = (value: WorkbenchAppId): value is "ai-skills" =>
  value === "ai-skills";

export const isAiPluginsAppId = (value: WorkbenchAppId): value is "ai-plugins" =>
  value === "ai-plugins";

export const isNotificationCenterAppId = (value: WorkbenchAppId): value is "notification-center" =>
  value === "notification-center";
