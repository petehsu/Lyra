import { Bot } from "lucide-react";
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

export const renderAiPanelTopbarIcon = (kind: "mcp" | "skills") => {
  if (kind === "mcp") {
    return renderSvgMaskIcon(
      MCP_ICON_URL,
      "lyra-ai-panel-svg-icon-topbar lyra-ai-panel-svg-icon-topbar-mcp"
    );
  }
  return renderSvgMaskIcon(
    SKILLS_ICON_URL,
    "lyra-ai-panel-svg-icon-topbar lyra-ai-panel-svg-icon-topbar-skills"
  );
};

export const renderAiPanelAppIcon = (iconKey: AiPanelAppIconKey) => {
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
  return renderShell(<Bot size={SIZE} />);
};
