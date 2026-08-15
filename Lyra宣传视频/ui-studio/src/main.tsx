import { createRoot } from "react-dom/client";

import { WorkbenchShell } from "@workbench/shell";
import { WorkbenchI18nProvider } from "@workbench/i18n";
import { AppErrorBoundary, AppStatusProvider } from "@renderer/ui/components";
import { installShotRuntime } from "./runtime/shot-runtime";
import { activeShot } from "./shots";

import "@fontsource/geist-sans/latin.css";
import "@fontsource/geist-mono/latin.css";
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource/zen-dots/latin.css";
import "@renderer/styles/index.scss";
import "./studio.css";

const rootElement = document.getElementById("app");

if (rootElement === null) {
  throw new Error("UI Studio root #app is missing");
}

const PromoStudio = () => {
  if (activeShot.Scene !== undefined) {
    const Scene = activeShot.Scene;
    return <Scene />;
  }

  return (
    <WorkbenchI18nProvider>
      <AppStatusProvider>
        <AppErrorBoundary
          className="lyra-app-root-error"
          title="Lyra UI Studio"
          description="The shared Lyra renderer could not be mounted."
        >
          <WorkbenchShell />
        </AppErrorBoundary>
      </AppStatusProvider>
    </WorkbenchI18nProvider>
  );
};

createRoot(rootElement).render(<PromoStudio />);
installShotRuntime(activeShot);
