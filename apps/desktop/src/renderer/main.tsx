import { createRoot } from "react-dom/client";

import { WorkbenchShell } from "@workbench/shell";

import "@fontsource/geist-sans/latin.css";
import "@fontsource/geist-mono/latin.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "./styles/index.scss";

const rootElement = document.getElementById("app");
if (rootElement === null) {
  throw new Error("renderer root #app is missing");
}

createRoot(rootElement).render(
  <WorkbenchShell />
);
