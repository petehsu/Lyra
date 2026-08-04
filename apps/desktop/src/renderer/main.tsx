import * as React from "react";
import { useState } from "react";
import * as ReactDomClient from "react-dom/client";
import { createRoot } from "react-dom/client";
import * as ReactJsxRuntime from "react/jsx-runtime";

import { installFirstPartyUiRuntime } from "@lyra/workbench-ui-runtime/host";

import { WorkbenchShell } from "@workbench/shell";
import {
  createFirstPartyCodeEditorService,
  synchronizeInstalledWorkspaceAppModules
} from "@workbench/workspace-apps";
import { WorkbenchI18nProvider, t } from "@workbench/i18n";
import { AppErrorBoundary, AppStatusProvider } from "@renderer/ui/components";
import { StartupGate } from "./startup/StartupGate";
import { clearLocalStartupComplete } from "./startup/startup-preferences";

import "@fontsource/geist-sans/latin.css";
import "@fontsource/geist-mono/latin.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource/zen-dots/latin.css";
import "./styles/index.scss";

const rootElement = document.getElementById("app");
if (rootElement === null) {
  throw new Error("renderer root #app is missing");
}

installFirstPartyUiRuntime({
  react: React,
  reactDomClient: ReactDomClient,
  jsxRuntime: ReactJsxRuntime,
  services: {
    codeEditor: createFirstPartyCodeEditorService()
  }
});

const workspaceAppModulesReady = synchronizeInstalledWorkspaceAppModules({
  components: window.lyraDesktop.components
});

const RendererRoot = () => {
  const [startupComplete, setStartupComplete] = useState(false);
  const handleStartupReady = (): void => {
    void workspaceAppModulesReady
      .then((issues) => {
        for (const issue of issues) {
          console.error(
            `[lyra-workspace-apps] ${issue.componentId} could not be restored: ${issue.message}`
          );
        }
      })
      .catch((error: unknown) => {
        console.error("[lyra-workspace-apps] component registry synchronization failed", error);
      })
      .finally(() => setStartupComplete(true));
  };
  const handleSignedOut = (): void => {
    clearLocalStartupComplete();
    setStartupComplete(false);
  };
  return (
    <WorkbenchI18nProvider>
      <AppStatusProvider>
        <AppErrorBoundary
          className="lyra-app-root-error"
          title={t("appStatus.unexpectedErrorTitle")}
          description={t("appStatus.unexpectedErrorDescription")}
        >
          {startupComplete
            ? <WorkbenchShell onSignedOut={handleSignedOut} />
            : <StartupGate onReady={handleStartupReady} />}
        </AppErrorBoundary>
      </AppStatusProvider>
    </WorkbenchI18nProvider>
  );
};

createRoot(rootElement).render(<RendererRoot />);
