import { createRoot } from "react-dom/client";

import { WorkbenchShell } from "@workbench/shell";
import { t } from "@workbench/i18n";
import { AppErrorBoundary, AppStatusProvider } from "@renderer/ui/components";

import "@fontsource/geist-sans/latin.css";
import "@fontsource/geist-mono/latin.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "./styles/index.scss";

const rootElement = document.getElementById("app");
if (rootElement === null) {
  throw new Error("renderer root #app is missing");
}

createRoot(rootElement).render(
  <AppStatusProvider>
    <AppErrorBoundary
      className="lyra-app-root-error"
      title={t("appStatus.unexpectedErrorTitle")}
      description={t("appStatus.unexpectedErrorDescription")}
    >
      <WorkbenchShell />
    </AppErrorBoundary>
  </AppStatusProvider>
);
