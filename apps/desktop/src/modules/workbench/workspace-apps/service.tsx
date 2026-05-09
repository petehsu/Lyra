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
  renderImageViewerAppIcon,
  type ImageViewerAppIconKey,
  type ImageViewerAppId
} from "../image-viewer";
import {
  renderNotificationCenterAppIcon
} from "../notifications/icon-registry";
import {
  renderResourceMonitorAppIcon,
  type ResourceMonitorAppIconKey,
  type ResourceMonitorAppId
} from "../resource-monitor";
import type { WorkbenchAppId, WorkspaceAppIconKey } from "./types";

const renderers: Record<WorkbenchAppId, (iconKey: WorkspaceAppIconKey) => ReactNode> = {
  "file-manager": (iconKey) => renderFileManagerAppIcon(iconKey as FileManagerAppIconKey),
  "file-editor": (iconKey) => renderFileEditorAppIcon(iconKey as FileEditorAppIconKey),
  "image-viewer": (iconKey) => renderImageViewerAppIcon(iconKey as ImageViewerAppIconKey),
  "resource-monitor": (iconKey) =>
    renderResourceMonitorAppIcon(iconKey as ResourceMonitorAppIconKey),
  "ai-history": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "ai-plan-review": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "ai-mcp": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "ai-skills": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "ai-plugins": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
  "agent-vm": (iconKey) => renderAiPanelAppIcon(iconKey as AiPanelAppIconKey),
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

export const isImageViewerAppId = (value: WorkbenchAppId): value is ImageViewerAppId =>
  value === "image-viewer";

export const isResourceMonitorAppId = (value: WorkbenchAppId): value is ResourceMonitorAppId =>
  value === "resource-monitor";

export const isAiHistoryAppId = (value: WorkbenchAppId): value is "ai-history" =>
  value === "ai-history";

export const isAiPlanReviewAppId = (value: WorkbenchAppId): value is "ai-plan-review" =>
  value === "ai-plan-review";

export const isAiMcpAppId = (value: WorkbenchAppId): value is "ai-mcp" =>
  value === "ai-mcp";

export const isAiSkillsAppId = (value: WorkbenchAppId): value is "ai-skills" =>
  value === "ai-skills";

export const isAiPluginsAppId = (value: WorkbenchAppId): value is "ai-plugins" =>
  value === "ai-plugins";

export const isAgentVmAppId = (value: WorkbenchAppId): value is "agent-vm" =>
  value === "agent-vm";

export const isNotificationCenterAppId = (value: WorkbenchAppId): value is "notification-center" =>
  value === "notification-center";
