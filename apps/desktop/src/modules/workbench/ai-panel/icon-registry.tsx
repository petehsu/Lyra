import { Bot, Boxes, ClipboardList, History, Server } from "lucide-react";
import type { CSSProperties } from "react";

import type { AiPanelAppIconKey } from "./types";

const SIZE = 15;
const MCP_ICON_URL = new URL("./assets/icons/mcp.svg", import.meta.url).toString();
const SKILLS_ICON_URL = new URL("./assets/icons/skills.svg", import.meta.url).toString();

const renderShell = (node: JSX.Element) => (
  <span className="lyra-file-manager-icon-shell" aria-hidden="true">
    {node}
  </span>
);

const renderSvgMaskIcon = (iconUrl: string, className?: string) => (
  <span
    className={
      className === undefined
        ? "lyra-ai-panel-svg-icon"
        : `lyra-ai-panel-svg-icon ${className}`
    }
    style={
      {
        "--lyra-ai-panel-svg-icon-url": `url("${iconUrl}")`
      } as CSSProperties
    }
    aria-hidden="true"
  />
);

export const renderAiPanelTopbarIcon = (kind: "history" | "mcp" | "skills" | "plugins") => {
  if (kind === "history") {
    return <History size={13} aria-hidden="true" />;
  }
  if (kind === "mcp") {
    return renderSvgMaskIcon(
      MCP_ICON_URL,
      "lyra-ai-panel-svg-icon-topbar lyra-ai-panel-svg-icon-topbar-mcp"
    );
  }
  if (kind === "plugins") {
    return <Boxes size={13} aria-hidden="true" />;
  }
  return renderSvgMaskIcon(
    SKILLS_ICON_URL,
    "lyra-ai-panel-svg-icon-topbar lyra-ai-panel-svg-icon-topbar-skills"
  );
};

export const renderAiPanelAppIcon = (iconKey: AiPanelAppIconKey) => {
  if (iconKey === "ai-panel-history") {
    return renderShell(<History size={SIZE} />);
  }
  if (iconKey === "ai-panel-agent-vm") {
    return renderShell(<Server size={SIZE} />);
  }
  if (iconKey === "ai-panel-mcp") {
    return renderShell(
      renderSvgMaskIcon(MCP_ICON_URL, "lyra-ai-panel-svg-icon-app lyra-ai-panel-svg-icon-app-mcp")
    );
  }
  if (iconKey === "ai-panel-skills") {
    return renderShell(
      renderSvgMaskIcon(
        SKILLS_ICON_URL,
        "lyra-ai-panel-svg-icon-app lyra-ai-panel-svg-icon-app-skills"
      )
    );
  }
  if (iconKey === "ai-panel-plugins") {
    return renderShell(<Boxes size={SIZE} />);
  }
  if (iconKey === "ai-panel-plan") {
    return renderShell(<ClipboardList size={SIZE} />);
  }
  return renderShell(<Bot size={SIZE} />);
};
