import { CheckCircle, ChevronDown, Folder, Loader2, CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  AppButton,
  AppMenu,
  AppMenuContent,
  AppMenuItem,
  AppMenuSeparator,
  AppMenuTrigger
} from "@renderer/ui/components";
import { LyraLogo } from "@renderer/ui/app";
import type { AgentCodegraphStatus, DetectedEditor, LyraDesktopApi } from "../../../../../../shared/desktop-bridge";
import { IdentityIconView, useSessionIdentityIcon } from "../../../../identity";
import { formatMessage, t } from "@workbench/i18n";

const ICON_SIZE = 13;
const ICON_STROKE_WIDTH = 2;

function CodegraphStatusRow({ status }: { status: AgentCodegraphStatus | null }) {
  if (!status || status.state === "idle") return null;
  const pct = status.progress != null ? Math.round(status.progress * 100) : 0;
  return (
    <div
      className="lyra-agents-codegraph-status-row"
      title={status.error ?? ""}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", fontSize: 12, opacity: 0.85 }}
    >
      {status.state === "indexing" ? (
        <>
          <Loader2 size={12} className="lyra-agents-codegraph-spinner" style={{ animation: "spin 1s linear infinite" }} aria-hidden="true" />
          <span>{formatMessage("header.codegraphIndexing", { progress: pct })}</span>
        </>
      ) : status.state === "ready" ? (
        <>
          <CheckCircle size={12} style={{ color: "var(--app-color-success, #22c55e)" }} aria-hidden="true" />
          <span>{formatMessage("header.codegraphReady", { fileCount: status.fileCount ?? 0 })}</span>
        </>
      ) : status.state === "failed" ? (
        <>
          <CircleAlert size={12} style={{ color: "var(--app-color-error, #ef4444)" }} aria-hidden="true" />
          <span>{t("header.codegraphFailed")}</span>
        </>
      ) : null}
    </div>
  );
}

export function ProjectDirChip({
  desktopApi,
  sessionId,
  projectName,
  workingDir,
  isHome,
  canOpenProjectTree,
  onChooseProject,
  onOpenProjectTree,
  onOpenInFileManager,
}: {
  desktopApi?: LyraDesktopApi | null;
  sessionId?: string | null | undefined;
  projectName: string | null;
  workingDir: string | null;
  isHome: boolean;
  canOpenProjectTree: boolean;
  onChooseProject: () => Promise<void> | void;
  onOpenProjectTree: () => Promise<void> | void;
  onOpenInFileManager: (path: string) => Promise<void> | void;
}) {
  const icon = useSessionIdentityIcon(desktopApi ?? null, workingDir);
  const label = isHome || projectName === null || projectName.trim().length === 0
    ? t("lyra-agents-composer.workingDirHome")
    : projectName.trim();
  const [editors, setEditors] = useState<DetectedEditor[]>([]);
  const [cgStatus, setCgStatus] = useState<AgentCodegraphStatus | null>(null);

  useEffect(() => {
    if (!canOpenProjectTree || !desktopApi?.detectEditors) return;
    void desktopApi.detectEditors().then(setEditors).catch(() => undefined);
  }, [canOpenProjectTree, desktopApi]);

  // ponytail: 轮询足够支撑当前菜单态；上限是 2s 延迟，升级路径是 runtime 事件推送。
  useEffect(() => {
    if (!canOpenProjectTree || !workingDir || !sessionId || !desktopApi?.agent?.codegraphStatus) return;
    let active = true;
    const poll = () => {
      void desktopApi.agent!.codegraphStatus!({ sessionId }).then((s) => {
        if (active) {
          setCgStatus(s);
          if (s.state === "ready" || s.state === "failed") {
            clearInterval(timer);
          }
        }
      }).catch(() => undefined);
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [canOpenProjectTree, workingDir, desktopApi, sessionId]);

  const chipContent = (
    <>
      <IdentityIconView
        className="lyra-agents-project-dir-chip-icon"
        imageClassName="lyra-agents-project-dir-chip-image"
        iconUrl={icon.url}
        label={icon.label}
        fallback={
          icon.renderHint === "lyra-logo"
            ? <LyraLogo className="lyra-agents-project-dir-chip-lyra-logo" alt="" />
            : <Folder size={ICON_SIZE} strokeWidth={ICON_STROKE_WIDTH} aria-hidden="true" />
        }
      />
      <span className="lyra-agents-project-dir-chip-label">{label}</span>
      {canOpenProjectTree ? (
        <ChevronDown size={12} strokeWidth={1.8} className="lyra-agents-project-dir-chip-chevron" aria-hidden="true" />
      ) : null}
    </>
  );

  if (!canOpenProjectTree) {
    return (
      <AppButton
        variant="ghost"
        size="sm"
        type="button"
        className="lyra-agents-project-dir-chip"
        aria-label={label}
        title={label}
        onClick={() => { void onChooseProject(); }}
      >
        {chipContent}
      </AppButton>
    );
  }

  const reveal = () => {
    if (workingDir) void desktopApi?.revealInFolder(workingDir).catch(() => undefined);
  };
  const openEditor = (editorId: string) => {
    if (workingDir) void desktopApi?.openInEditor({ editorId, path: workingDir }).catch(() => undefined);
  };

  return (
    <AppMenu>
      <AppMenuTrigger asChild>
        <AppButton
          variant="ghost"
          size="sm"
          type="button"
          className="lyra-agents-project-dir-chip"
          aria-label={label}
          title={t("header.openProjectTree")}
        >
          {chipContent}
        </AppButton>
      </AppMenuTrigger>
      <AppMenuContent align="start" sideOffset={4}>
        <CodegraphStatusRow status={cgStatus} />
        {cgStatus && cgStatus.state !== "idle" ? <AppMenuSeparator /> : null}
        <AppMenuItem onClick={() => { void onOpenProjectTree(); }}>
          {t("header.openProjectTree")}
        </AppMenuItem>
        <AppMenuItem onClick={() => { if (workingDir) void onOpenInFileManager(workingDir); }}>
          {t("header.openInFileManager")}
        </AppMenuItem>
        <AppMenuItem onClick={reveal}>
          {t("header.revealInFileManager")}
        </AppMenuItem>
        {editors.length > 0 ? <AppMenuSeparator /> : null}
        {editors.map((editor) => (
          <AppMenuItem key={editor.id} onClick={() => openEditor(editor.id)}>
            <span className="lyra-agents-editor-menu-row">
              {editor.icon ? <img src={editor.icon} alt="" className="lyra-agents-editor-menu-icon" /> : null}
              {formatMessage("header.openInEditor", { editor: editor.label })}
            </span>
          </AppMenuItem>
        ))}
      </AppMenuContent>
    </AppMenu>
  );
}