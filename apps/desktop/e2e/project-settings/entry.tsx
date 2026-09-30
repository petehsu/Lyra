import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsProjectsView } from "../../src/modules/workbench/settings-projects";
import { ProjectDirChip } from "../../src/modules/workbench/ai-panel/lyra-agents/features/chat/ProjectDirChip";
import { WorkbenchI18nProvider } from "../../src/modules/workbench/i18n";
import { resolveThemeVars } from "../../src/modules/workbench/theme";
import { syncDocumentThemeTone } from "../../src/modules/workbench/shell/service";
import type { LyraDesktopApi } from "../../src/shared/desktop-bridge";
import "../../src/renderer/styles/index.scss";

const listeners = new Set<(event: any) => void>();
const rpc = async (method: string, payload: unknown = {}) => {
  const response = await fetch("/rpc", { method: "POST", body: JSON.stringify({ method, payload }) });
  const value = await response.json();
  if (value.error) throw new Error(value.error);
  return value.result;
};
const events = new EventSource("/events");
events.onmessage = ({ data }) => listeners.forEach((listener) => listener(JSON.parse(data)));
const agent = {
  listProjects: () => rpc("agent.projects.list"),
  registerProject: (payload: unknown) => rpc("agent.projects.register", payload),
  getProjectSettings: (payload: unknown) => rpc("agent.projects.settings", payload),
  setProjectOverride: (payload: unknown) => rpc("agent.projects.setOverride", payload),
  onEvent: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
};
const api = { agent } as unknown as LyraDesktopApi;
const theme = (tone: "light" | "dark") => {
  const id = tone === "light" ? "lyra-light" : "lyra-dark";
  syncDocumentThemeTone(id);
  for (const [name, value] of Object.entries(resolveThemeVars(id, false))) document.documentElement.style.setProperty(name, value);
};
theme("light");
function Fixture() {
  const [workingDir, setWorkingDir] = useState<string | null>(null);
  const select = async (workingDir: string) => { const result = await agent.registerProject({ workingDir }); setWorkingDir(result.project.path); };
  (window as any).projectsAudit = { rpc, theme };
  return <main className="lyra-root" style={{ display: "block", padding: 24, height: "100vh", overflow: "auto", background: "var(--background)", color: "var(--foreground)" }}>
    <div style={{ marginBottom: 24 }}><ProjectDirChip desktopApi={api} projectName={workingDir?.split("/").at(-1) ?? null} workingDir={workingDir} isHome={!workingDir} canOpenProjectTree={false} onChooseProject={async () => { const { path } = await (await fetch("/project")).json(); await select(path); }} onSelectProject={select} onOpenProjectTree={() => {}} onOpenInFileManager={() => {}} /></div>
    <SettingsProjectsView desktopApi={api} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<WorkbenchI18nProvider locale="en-US"><Fixture /></WorkbenchI18nProvider>);
