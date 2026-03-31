import {
  Bell,
  Bot,
  Braces,
  Folder,
  FolderOpen,
  Globe,
  HardDrive,
  TerminalSquare,
  Wrench
} from "lucide-react";

import type {
  NotificationCenterAppIconKey,
  WorkbenchNotificationSourceIconKey
} from "./types";

const wrapIcon = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

export const renderNotificationCenterAppIcon = (
  iconKey: NotificationCenterAppIconKey
): JSX.Element => {
  if (iconKey === "notification-center-default") {
    return wrapIcon(<Bell size={15} />);
  }
  return wrapIcon(<Bell size={15} />);
};

export const renderNotificationSourceIcon = (
  iconKey: WorkbenchNotificationSourceIconKey,
  size = 14
): JSX.Element => {
  if (iconKey === "ai") {
    return <Bot size={size} />;
  }
  if (iconKey === "file-manager") {
    return <FolderOpen size={size} />;
  }
  if (iconKey === "file-editor") {
    return <Braces size={size} />;
  }
  if (iconKey === "browser") {
    return <Globe size={size} />;
  }
  if (iconKey === "terminal") {
    return <TerminalSquare size={size} />;
  }
  if (iconKey === "mcp") {
    return <Wrench size={size} />;
  }
  if (iconKey === "skills") {
    return <Folder size={size} />;
  }
  if (iconKey === "system") {
    return <HardDrive size={size} />;
  }
  return <Bell size={size} />;
};
