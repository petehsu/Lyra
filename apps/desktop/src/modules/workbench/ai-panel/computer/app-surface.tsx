import { useEffect, useMemo, useRef } from "react";

import type { AiComputerAppInstance, LyraDesktopApi } from "../../../../shared/desktop-bridge";
import { BrowserPageSurface, BrowserSearchSurface } from "../../browser-tabs";
import { FileEditorSurface, type FileEditorLabels, type FileEditorModel } from "../../file-editor";
import { FileManagerSurface, type FileManagerModel, type FileManagerSurfaceLabels } from "../../file-manager";
import { TerminalWorkspaceSurface, type TerminalDockLabels, type TerminalDockPane, type TerminalDockTab } from "../../terminal-dock";
import type { TerminalThemePresetId } from "../../terminal-theme";
import type { AiComputerLabels } from "./types";
import { useAiComputerBrowserViewState } from "./browser-view-state";

const LOGO_URL = new URL(
  "../../../../renderer/assets/logo.svg",
  import.meta.url
).toString();

type AiComputerAppSurfaceProps = {
  readonly app: AiComputerAppInstance | null;
  readonly variant: "workspace" | "timeline";
  readonly labels: AiComputerLabels;
  readonly desktopApi: LyraDesktopApi | null;
  readonly fileManagerModel: FileManagerModel;
  readonly fileManagerLabels: FileManagerSurfaceLabels;
  readonly fileEditorModel: FileEditorModel;
  readonly fileEditorLabels: FileEditorLabels;
  readonly terminalLabels: TerminalDockLabels;
  readonly terminalThemeSignature: string;
  readonly terminalThemePreset: TerminalThemePresetId;
  readonly uiThemeId: string;
  readonly onOpenApp?: (request: {
    readonly kind: "file-manager" | "file-editor" | "terminal" | "browser";
    readonly title?: string;
    readonly appInstanceId?: string;
    readonly filePath?: string;
    readonly directoryPath?: string;
    readonly address?: string;
  }) => void;
  readonly onFocusApp?: (appInstanceId: string) => void;
};

const normalizeBrowserAddress = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.includes(".") || trimmed.includes("/")) {
    return `https://${trimmed}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
};

export const AiComputerAppSurface = ({
  app,
  variant,
  labels,
  desktopApi,
  fileManagerModel,
  fileManagerLabels,
  fileEditorModel,
  fileEditorLabels,
  terminalLabels,
  terminalThemeSignature,
  terminalThemePreset,
  uiThemeId,
  onOpenApp,
  onFocusApp
}: AiComputerAppSurfaceProps) => {
  const shouldInitializeState = variant === "workspace";
  const initializedFileManagerTargetsRef = useRef<Set<string>>(new Set());
  const initializedFileEditorTargetsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (shouldInitializeState === false || app === null || app.kind !== "file-manager") {
      return;
    }

    const targetKey = `${app.id}:${app.directoryPath ?? "__home__"}`;
    if (initializedFileManagerTargetsRef.current.has(targetKey)) {
      return;
    }
    initializedFileManagerTargetsRef.current.add(targetKey);

    fileManagerModel.ensureInstance(app.id);
    void (app.directoryPath === undefined
      ? fileManagerModel.openHome(app.id)
      : fileManagerModel.openDirectory(app.id, app.directoryPath));
  }, [app, fileManagerModel, shouldInitializeState]);

  useEffect(() => {
    if (
      shouldInitializeState === false
      || app === null
      || app.kind !== "file-editor"
      || app.filePath === undefined
    ) {
      return;
    }

    const targetKey = `${app.id}:${app.filePath}`;
    if (initializedFileEditorTargetsRef.current.has(targetKey)) {
      return;
    }
    initializedFileEditorTargetsRef.current.add(targetKey);

    fileEditorModel.ensureInstance(app.id, {
      filePath: app.filePath
    });
    void fileEditorModel.openFile(app.id, app.filePath);
  }, [app, fileEditorModel, shouldInitializeState]);

  const browserViewState = useMemo(() => {
    if (app === null || app.kind !== "browser") {
      return null;
    }
    return {
      appId: app.id,
      externalAddress: app.address ?? null
    };
  }, [app]);

  const sharedBrowserState = useAiComputerBrowserViewState(
    browserViewState?.appId ?? "__lyra-ai-browser__",
    browserViewState?.externalAddress ?? null
  );

  if (app === null) {
    return null;
  }

  const shellClassName =
    variant === "timeline"
      ? "lyra-ai-computer-app-surface lyra-ai-computer-app-surface-preview"
      : "lyra-ai-computer-app-surface";

  if (app.kind === "file-manager") {
    const state = fileManagerModel.getState(app.id);
    return (
      <div className={shellClassName}>
        <FileManagerSurface
          state={state}
          labels={fileManagerLabels}
          model={fileManagerModel}
          onOpenFile={(filePath) => {
            onOpenApp?.({
              kind: "file-editor",
              filePath,
              title: filePath.split(/[\\/]/).pop() ?? filePath
            });
          }}
        />
      </div>
    );
  }

  if (app.kind === "file-editor" && app.filePath !== undefined) {
    const state = fileEditorModel.getState(app.id);
    return (
      <div className={shellClassName}>
        <FileEditorSurface
          state={state}
          labels={fileEditorLabels}
          model={fileEditorModel}
          themeSignature={uiThemeId}
          surfaceVariant={variant === "timeline" ? "ai-miniature" : "ai-workspace"}
          controlMode="ai_only"
        />
      </div>
    );
  }

  if (app.kind === "terminal") {
    const pane: TerminalDockPane = {
      id: `${app.id}-pane`,
      sessionId: app.id,
      title: app.title
    };
    const tab: TerminalDockTab = {
      id: `${app.id}-tab`,
      title: app.title,
      orientation: "horizontal",
      paneIds: [pane.id],
      activePaneId: pane.id,
      placement: "workspace"
    };

    return (
      <div className={shellClassName}>
        <TerminalWorkspaceSurface
          desktopApi={desktopApi}
          labels={terminalLabels}
          themeSignature={terminalThemeSignature}
          themePresetId={terminalThemePreset}
          uiThemeId={uiThemeId}
          tab={tab}
          panes={[pane]}
          onFocusPane={() => {
            onFocusApp?.(app.id);
          }}
        />
      </div>
    );
  }

  const currentBrowserState = sharedBrowserState.state;

  return (
    <div className={`${shellClassName} lyra-ai-computer-app-surface-browser`}>
      <section className="lyra-ai-computer-browser">
        <header className="lyra-ai-computer-browser-head">
          <input
            value={currentBrowserState.inputValue}
            placeholder={labels.browserSearchPlaceholder}
            onChange={(event) => {
              sharedBrowserState.setInputValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") {
                return;
              }
              const nextAddress = normalizeBrowserAddress(currentBrowserState.inputValue);
              sharedBrowserState.setAddress(nextAddress);
              if (nextAddress !== null) {
                onOpenApp?.({
                  kind: "browser",
                  appInstanceId: app.id,
                  address: nextAddress,
                  title: `${labels.desktopBrowser} · ${nextAddress}`
                });
              }
            }}
          />
        </header>
        {currentBrowserState.address === null ? (
          <BrowserSearchSurface
            logoUrl={LOGO_URL}
            inputValue={currentBrowserState.inputValue}
            placeholder={labels.browserSearchPlaceholder}
            searchActionLabel={labels.browserSearchAction}
            onInputChange={(value) => {
              sharedBrowserState.setInputValue(value);
            }}
            onSubmit={() => {
              const nextAddress = normalizeBrowserAddress(currentBrowserState.inputValue);
              sharedBrowserState.setAddress(nextAddress);
              if (nextAddress !== null) {
                onOpenApp?.({
                  kind: "browser",
                  appInstanceId: app.id,
                  address: nextAddress,
                  title: `${labels.desktopBrowser} · ${nextAddress}`
                });
              }
            }}
          />
        ) : (
          <BrowserPageSurface
            tabId={app.id}
            address={currentBrowserState.address}
          />
        )}
      </section>
    </div>
  );
};
