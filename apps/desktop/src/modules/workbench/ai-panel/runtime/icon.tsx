import { AppWindow, Check, CircleAlert, FilePenLine, Globe, LoaderCircle } from "lucide-react";

import type { AiPanelRuntimeKind, AiPanelRuntimeStatus } from "./types";

export const renderRuntimeKindIcon = (kind: AiPanelRuntimeKind, size = 13) => {
  if (kind === "file") {
    return <FilePenLine size={size} />;
  }
  if (kind === "web") {
    return <Globe size={size} />;
  }
  return <AppWindow size={size} />;
};

export const renderRuntimeStatusIcon = (status: AiPanelRuntimeStatus, size = 12) => {
  if (status === "running" || status === "queued") {
    return <LoaderCircle size={size} />;
  }
  if (status === "error") {
    return <CircleAlert size={size} />;
  }
  return <Check size={size} />;
};
