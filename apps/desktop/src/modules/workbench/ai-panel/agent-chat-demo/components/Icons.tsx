import {
  ChevronRight,
  FileText,
  Pencil,
  Search,
  Terminal,
  Globe,
  Clock,
  ListChecks,
  FilePlus,
  CheckCircle2,
  XCircle,
  Loader2,
  File,
} from "lucide-react";
import type { ToolCall } from "../types";

const ICON_SIZE = 15;
const ICON_STROKE = 1.7;

export const ChevronIcon = ({ open }: { open: boolean }) => (
  <ChevronRight
    size={14}
    strokeWidth={2}
    style={{
      transition: "transform 160ms ease",
      transform: open ? "rotate(90deg)" : "rotate(0deg)",
    }}
    aria-hidden
  />
);

export const ToolIcon = ({ kind }: { kind: ToolCall["kind"] }) => {
  const props = { size: ICON_SIZE, strokeWidth: ICON_STROKE, "aria-hidden": true as const };
  switch (kind) {
    case "read":
      return <FileText {...props} />;
    case "edit":
      return <Pencil {...props} />;
    case "search":
      return <Search {...props} />;
    case "shell":
      return <Terminal {...props} />;
    case "web":
      return <Globe {...props} />;
    case "thought":
      return <Clock {...props} />;
    case "task":
      return <ListChecks {...props} />;
    case "create":
      return <FilePlus {...props} />;
  }
};

export const FileIcon = () => (
  <File size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
);

export const ErrorCircleIcon = () => (
  <XCircle size={14} strokeWidth={1.8} aria-hidden />
);

export const SpinnerIcon = () => (
  <Loader2
    size={14}
    strokeWidth={2}
    className="spinner"
    aria-hidden
  />
);

export const CheckCircleIcon = () => (
  <CheckCircle2
    size={14}
    strokeWidth={1.8}
    aria-hidden
  />
);
