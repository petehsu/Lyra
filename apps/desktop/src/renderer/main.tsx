import { useState } from "react";
import { createRoot } from "react-dom/client";

import { WorkbenchShell } from "@workbench/shell";
import { WorkbenchI18nProvider, t } from "@workbench/i18n";
import { AppErrorBoundary, AppStatusProvider } from "@renderer/ui/components";
import { StartupGate } from "./startup/StartupGate";

import "@fontsource/geist-sans/latin.css";
import "@fontsource/geist-mono/latin.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource/zen-dots/latin.css";
import "./styles/index.scss";

const rootElement = document.getElementById("app");
if (rootElement === null) {
  throw new Error("renderer root #app is missing");
}

const RendererRoot = () => {
  const [startupComplete, setStartupComplete] = useState(false);
  return (
    <WorkbenchI18nProvider>
      <AppStatusProvider>
        <AppErrorBoundary
          className="lyra-app-root-error"
          title={t("appStatus.unexpectedErrorTitle")}
          description={t("appStatus.unexpectedErrorDescription")}
        >
          {startupComplete
            ? <WorkbenchShell />
            : <StartupGate onReady={() => setStartupComplete(true)} />}
        </AppErrorBoundary>
      </AppStatusProvider>
    </WorkbenchI18nProvider>
  );
};

createRoot(rootElement).render(<RendererRoot />);
