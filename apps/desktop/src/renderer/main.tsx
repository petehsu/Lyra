import { createRoot } from "react-dom/client";

import { WorkbenchShell } from "@workbench/shell";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/workbench/classic.css";

const rootElement = document.getElementById("app");
if (rootElement === null) {
  throw new Error("renderer root #app is missing");
}

createRoot(rootElement).render(
  <WorkbenchShell />
);
