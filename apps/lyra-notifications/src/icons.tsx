import {
  Bell,
  Braces,
  FolderOpen,
  Globe,
  HardDrive,
  TerminalSquare
} from "@lyra/icons";
import type { ReactNode } from "react";

export type NotificationSourceIconKey =
  | "file-manager"
  | "file-editor"
  | "browser"
  | "terminal"
  | "system"
  | "notification";

export const renderNotificationSourceIcon = (
  iconKey: NotificationSourceIconKey,
  size = 14
): ReactNode => {
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
  if (iconKey === "system") {
    return <HardDrive size={size} />;
  }
  return <Bell size={size} />;
};
