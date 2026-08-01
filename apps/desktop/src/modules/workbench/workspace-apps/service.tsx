import type { ReactNode } from "react";

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
  renderAgentSessionHistoryAppIcon,
  type AgentSessionHistoryAppIconKey,
  type AgentSessionHistoryAppId
} from "../agent-session-history";
import {
  renderAgentProjectTreeAppIcon,
  type AgentProjectTreeAppIconKey,
  type AgentProjectTreeAppId
} from "../agent-project-tree";
import {
  renderAgentPlanBoardAppIcon,
  type AgentPlanBoardAppIconKey,
  type AgentPlanBoardAppId
} from "../agent-plan-board";
import {
  renderAgentGitAppIcon,
  type AgentGitAppIconKey,
  type AgentGitAppId
} from "../agent-git";
import {
  renderSoftwareStoreAppIcon,
  type SoftwareStoreAppIconKey,
  type SoftwareStoreAppId
} from "../software-store";
import {
  renderLoginManagerAppIcon,
  type LoginManagerAppIconKey,
  type LoginManagerAppId
} from "../login-manager";
import type { WorkbenchAppId, WorkspaceAppIconKey } from "./types";

const renderers: Record<WorkbenchAppId, (iconKey: WorkspaceAppIconKey) => ReactNode> = {
  "file-manager": (iconKey) => renderFileManagerAppIcon(iconKey as FileManagerAppIconKey),
  "file-editor": (iconKey) => renderFileEditorAppIcon(iconKey as FileEditorAppIconKey),
  "image-viewer": (iconKey) => renderImageViewerAppIcon(iconKey as ImageViewerAppIconKey),
  "agent-project-tree": (iconKey) =>
    renderAgentProjectTreeAppIcon(iconKey as AgentProjectTreeAppIconKey),
  "agent-plan-board": (iconKey) =>
    renderAgentPlanBoardAppIcon(iconKey as AgentPlanBoardAppIconKey),
  "agent-git": (iconKey) =>
    renderAgentGitAppIcon(iconKey as AgentGitAppIconKey),
  "agent-session-history": (iconKey) =>
    renderAgentSessionHistoryAppIcon(iconKey as AgentSessionHistoryAppIconKey),
  "login-manager": (iconKey) =>
    renderLoginManagerAppIcon(iconKey as LoginManagerAppIconKey),
  "notification-center": (iconKey) =>
    renderNotificationCenterAppIcon(iconKey as "notification-center-default"),
  "software-store": (iconKey) =>
    renderSoftwareStoreAppIcon(iconKey as SoftwareStoreAppIconKey)
};

export const renderWorkspaceAppIcon = (
  appId: WorkbenchAppId,
  iconKey: WorkspaceAppIconKey
): ReactNode => {
  const renderer = renderers[appId];
  return renderer === undefined
    ? renderNotificationCenterAppIcon("notification-center-default")
    : renderer(iconKey);
};

export const isFileManagerAppId = (value: WorkbenchAppId): value is FileManagerAppId =>
  value === "file-manager";

export const isFileEditorAppId = (value: WorkbenchAppId): value is FileEditorAppId =>
  value === "file-editor";

export const isImageViewerAppId = (value: WorkbenchAppId): value is ImageViewerAppId =>
  value === "image-viewer";

export const isAgentProjectTreeAppId = (
  value: WorkbenchAppId
): value is AgentProjectTreeAppId =>
  value === "agent-project-tree";

export const isAgentPlanBoardAppId = (
  value: WorkbenchAppId
): value is AgentPlanBoardAppId =>
  value === "agent-plan-board";

export const isAgentGitAppId = (
  value: WorkbenchAppId
): value is AgentGitAppId =>
  value === "agent-git";

export const isAgentSessionHistoryAppId = (
  value: WorkbenchAppId
): value is AgentSessionHistoryAppId =>
  value === "agent-session-history";

export const isLoginManagerAppId = (
  value: WorkbenchAppId
): value is LoginManagerAppId =>
  value === "login-manager";

export const isNotificationCenterAppId = (value: WorkbenchAppId): value is "notification-center" =>
  value === "notification-center";

export const isSoftwareStoreAppId = (
  value: WorkbenchAppId
): value is SoftwareStoreAppId =>
  value === "software-store";
