import { createRoot } from "react-dom/client";

import { WorkbenchShell } from "@workbench/shell";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/workbench/core.css";
import "./styles/workbench/browser-search.css";
import "./styles/workbench/settings.css";
import "./styles/workbench/context-menu.css";
import "./styles/workbench/browser-tabs.css";
import "./styles/workbench/global-dialog.css";
import "./styles/workbench/file-manager.css";
import "./styles/workbench/ai-panel.css";
import "./styles/workbench/notification-center.css";
import "./styles/workbench/mcp-center-shell.css";
import "./styles/workbench/mcp-center-list.css";
import "./styles/workbench/mcp-center-panels.css";
import "./styles/workbench/mcp-center-forms.css";
import "./styles/workbench/skills-center.css";
import "./styles/workbench/terminal.css";
import "./styles/workbench/file-editor.css";

const rootElement = document.getElementById("app");
if (rootElement === null) {
  throw new Error("renderer root #app is missing");
}

createRoot(rootElement).render(
  <WorkbenchShell />
);
