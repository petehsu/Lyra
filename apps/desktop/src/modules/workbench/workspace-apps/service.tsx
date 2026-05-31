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
  renderAgentGitAppIcon,
  type AgentGitAppIconKey,
  type AgentGitAppId
} from "../agent-git";
import {
  renderAgentSelfDevAppIcon,
  type AgentSelfDevAppIconKey,
  type AgentSelfDevAppId
} from "../agent-selfdev";
import {
  renderAgentOvernightAppIcon,
  type AgentOvernightAppIconKey,
  type AgentOvernightAppId
} from "../agent-overnight";
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
  "agent-git": (iconKey) =>
    renderAgentGitAppIcon(iconKey as AgentGitAppIconKey),
  "agent-selfdev": (iconKey) =>
    renderAgentSelfDevAppIcon(iconKey as AgentSelfDevAppIconKey),
  "agent-overnight": (iconKey) =>
    renderAgentOvernightAppIcon(iconKey as AgentOvernightAppIconKey),
  "agent-session-history": (iconKey) =>
    renderAgentSessionHistoryAppIcon(iconKey as AgentSessionHistoryAppIconKey),
  "login-manager": (iconKey) =>
    renderLoginManagerAppIcon(iconKey as LoginManagerAppIconKey),
  "notification-center": (iconKey) =>
    renderNotificationCenterAppIcon(iconKey as "notification-center-default"),
  "software-store": (iconKey) =>
    renderSoftwareStoreAppIcon(iconKey as SoftwareStoreAppIconKey)
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

export const isAgentProjectTreeAppId = (
  value: WorkbenchAppId
): value is AgentProjectTreeAppId =>
  value === "agent-project-tree";

export const isAgentGitAppId = (
  value: WorkbenchAppId
): value is AgentGitAppId =>
  value === "agent-git";

export const isAgentSelfDevAppId = (
  value: WorkbenchAppId
): value is AgentSelfDevAppId =>
  value === "agent-selfdev";

export const isAgentOvernightAppId = (
  value: WorkbenchAppId
): value is AgentOvernightAppId =>
  value === "agent-overnight";

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
