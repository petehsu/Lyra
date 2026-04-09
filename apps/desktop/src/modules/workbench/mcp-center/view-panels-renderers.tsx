import {
  Bot,
  Clock3,
  FileCode2,
  Folder,
  GitBranch,
  Globe,
  SquareTerminal
} from "lucide-react";

import type {
  McpEnvironmentEntry,
  McpInstallKind,
  McpRuntimePhase,
  McpTransport
} from "../../../shared/mcp";
import type { McpCenterLabels, McpCenterPresetFieldDisplay } from "./types";

export const renderCatalogIcon = (iconKey: string) => {
  const size = 15;
  switch (iconKey) {
    case "filesystem":
      return <Folder size={size} />;
    case "fetch":
      return <Globe size={size} />;
    case "git":
      return <GitBranch size={size} />;
    case "clock":
      return <Clock3 size={size} />;
    case "python":
      return <FileCode2 size={size} />;
    case "custom-command":
      return <SquareTerminal size={size} />;
    default:
      return <Bot size={size} />;
  }
};

export const resolvePresetFieldDisplay = (
  templateId: string,
  fieldId: string,
  labels: McpCenterLabels
): McpCenterPresetFieldDisplay => {
  if (templateId === "filesystem" && fieldId === "rootPath") {
    return {
      label: labels.presetFieldRootPath,
      description: labels.presetHintProjectDefault,
      placeholder: labels.presetPlaceholderPath,
      kind: "path"
    };
  }
  if (templateId === "git" && fieldId === "repoPath") {
    return {
      label: labels.presetFieldRepoPath,
      description: labels.presetHintProjectDefault,
      placeholder: labels.presetPlaceholderPath,
      kind: "path"
    };
  }
  if (templateId === "time" && fieldId === "timezone") {
    return {
      label: labels.presetFieldTimezone,
      placeholder: labels.presetPlaceholderTimezone,
      kind: "text"
    };
  }
  return {
    label: fieldId,
    kind: "text"
  };
};

export const renderTransportLabel = (
  transport: McpTransport,
  labels: McpCenterLabels
): string => {
  if (transport === "http") {
    return labels.transportHttp;
  }
  if (transport === "sse") {
    return labels.transportSse;
  }
  return labels.transportStdio;
};

export const renderInstallKindLabel = (
  kind: McpInstallKind,
  labels: McpCenterLabels
): string => {
  if (kind === "npm") {
    return labels.installKindNpm;
  }
  if (kind === "uv") {
    return labels.installKindUv;
  }
  if (kind === "docker") {
    return labels.installKindDocker;
  }
  if (kind === "binary") {
    return labels.installKindBinary;
  }
  return labels.installKindManual;
};

export const renderRuntimeLabel = (
  phase: McpRuntimePhase,
  labels: McpCenterLabels
): string => {
  if (phase === "running") {
    return labels.runtimeRunning;
  }
  if (phase === "starting") {
    return labels.runtimeStarting;
  }
  if (phase === "error") {
    return labels.runtimeError;
  }
  if (phase === "validating") {
    return labels.runtimeValidating;
  }
  return labels.runtimeStopped;
};

export const describeEnvironmentEntry = (
  entry: McpEnvironmentEntry,
  labels: McpCenterLabels
): string => {
  if (entry.mode === "plain") {
    return entry.value;
  }
  if (entry.mode === "external") {
    return `$${entry.externalKey}`;
  }
  return entry.secretRef.isSet ? `•••••• (${labels.modeSecret})` : labels.modeSecret;
};

export const Field = ({
  label,
  value
}: {
  readonly label: string;
  readonly value: string;
}) => (
  <div className="lyra-mcp-center-field">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

export const CapabilityList = ({
  title,
  items,
  emptyLabel
}: {
  readonly title: string;
  readonly items: readonly { readonly name: string; readonly description?: string }[];
  readonly emptyLabel: string;
}) => (
  <section className="lyra-mcp-center-capability-group">
    <header>
      <h4>{title}</h4>
    </header>
    {items.length === 0 ? (
      <p className="lyra-mcp-center-muted">{emptyLabel}</p>
    ) : (
      <ul className="lyra-mcp-center-capability-list">
        {items.map((item) => (
          <li key={`${title}-${item.name}`}>
            <strong>{item.name}</strong>
            {item.description === undefined ? null : <small>{item.description}</small>}
          </li>
        ))}
      </ul>
    )}
  </section>
);
