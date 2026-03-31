import type { ReactNode } from "react";

import {
  renderAiPanelAppIcon,
  type AiPanelAppIconKey,
  type AiPanelAppId
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
  "ai-panel": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "ai-mcp": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "ai-skills": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "notification-center": (iconKey) =>
    renderNotificationCenterAppIcon(iconKey as "notification-center-default")
};

export const renderWorkspaceAppIcon = (
  appId: WorkbenchAppId,
  iconKey: WorkspaceAppIconKey
): ReactNode => renderers[appId](iconKey);

export const isFileManagerAppId = (value: WorkbenchAppId): value is FileManagerAppId =>
  value === "file-manager";

export const isFileEditorAppId = (value: WorkbenchAppId): value is FileEditorAppId =>
  value === "file-editor";

export const isAiPanelAppId = (value: WorkbenchAppId): value is AiPanelAppId =>
  value === "ai-panel";

export const isAiMcpAppId = (value: WorkbenchAppId): value is AiPanelAppId =>
  value === "ai-mcp";

export const isAiSkillsAppId = (value: WorkbenchAppId): value is AiPanelAppId =>
  value === "ai-skills";

export const isNotificationCenterAppId = (value: WorkbenchAppId): value is "notification-center" =>
  value === "notification-center";
