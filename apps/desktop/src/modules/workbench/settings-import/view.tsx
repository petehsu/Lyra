import { useEffect, useMemo, useState } from "react";
import { FolderOpen } from "lucide-react";

import type {
  AgentImportDetection,
  AgentImportPreferences,
  AgentImportSource,
  AgentImportSourceId
} from "../../../shared/agent";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";
import claudeIconUrl from "@renderer/assets/import-sources/claude.svg";
import codexIconUrl from "@renderer/assets/import-sources/codex.svg";
import cursorIconUrl from "@renderer/assets/import-sources/cursor.svg";
import openCodeIconUrl from "@renderer/assets/provider-icons/opencode.svg";
import zedIconUrl from "@renderer/assets/import-sources/zed.svg";
import {
  AppButton,
  AppSettingsRow,
  AppSettingsSection,
  AppSubPageBack,
  AppSwitch
} from "@renderer/ui/components";

export type SettingsImportLabels = {
  readonly title: string;
  readonly description: string;
  readonly project: string;
  readonly chooseProject: string;
  readonly clearProject: string;
  readonly detect: string;
  readonly sync: string;
  readonly synced: string;
  readonly needsAttention: string;
  readonly noContent: string;
  readonly skills: string;
  readonly mcp: string;
  readonly back: string;
  readonly loading: string;
  readonly unavailable: string;
};

type Props = {
  readonly desktopApi: LyraDesktopApi | null;
  readonly labels: SettingsImportLabels;
};

const sourceIconUrls: Readonly<Record<AgentImportSourceId, string>> = {
  claude: claudeIconUrl,
  cursor: cursorIconUrl,
  codex: codexIconUrl,
  opencode: openCodeIconUrl,
  zed: zedIconUrl
};

const SourceTitle = ({ source }: { readonly source: AgentImportSource }) => (
  <span className="lyra-settings-import-source-title">
    <img
      alt=""
      aria-hidden="true"
      className="lyra-settings-import-source-icon"
      data-monochrome={["cursor", "codex", "zed"].includes(source.id) ? "true" : undefined}
      src={sourceIconUrls[source.id]}
    />
    <span>{source.label}</span>
  </span>
);

const emptyPreferences = (): AgentImportPreferences => ({
  projectRoot: null,
  sources: {
    claude: { skills: true, mcp: true },
    cursor: { skills: true, mcp: true },
    codex: { skills: true, mcp: true },
    opencode: { skills: true, mcp: true },
    zed: { skills: true, mcp: true }
  }
});

const sourceDescription = (
  source: AgentImportSource,
  detection: AgentImportDetection | undefined,
  labels: SettingsImportLabels
): string => {
  if (detection === undefined) return source.configPath;
  const total = detection.candidates.length;
  const conflict = detection.counts.conflict ?? 0;
  const pending = (detection.counts.pending ?? 0) + (detection.counts.update ?? 0);
  if (total === 0 && detection.diagnostics.length > 0) return labels.needsAttention;
  if (total === 0) return labels.noContent;
  if (conflict > 0 && pending === 0) return labels.needsAttention;
  return `${detection.candidates.filter((item) => item.kind === "skill").length} ${labels.skills} · ${detection.candidates.filter((item) => item.kind === "mcp").length} ${labels.mcp}`;
};

const actionState = (
  detection: AgentImportDetection | undefined
): "detect" | "sync" | "synced" | "attention" | "empty" => {
  if (detection === undefined) return "detect";
  if (detection.candidates.length === 0 && detection.diagnostics.length > 0) return "attention";
  if (detection.candidates.length === 0) return "empty";
  if ((detection.counts.pending ?? 0) + (detection.counts.update ?? 0) > 0) return "sync";
  if ((detection.counts.conflict ?? 0) > 0 || detection.diagnostics.length > 0) return "attention";
  return "synced";
};

export const SettingsImportView = ({ desktopApi, labels }: Props) => {
  const agent = desktopApi?.agent;
  const [sources, setSources] = useState<readonly AgentImportSource[]>([]);
  const [preferences, setPreferences] = useState<AgentImportPreferences>(emptyPreferences);
  const [detections, setDetections] = useState<Partial<Record<AgentImportSourceId, AgentImportDetection>>>({});
  const [selectedSourceId, setSelectedSourceId] = useState<AgentImportSourceId | null>(null);
  const [pendingSourceId, setPendingSourceId] = useState<AgentImportSourceId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) ?? null,
    [selectedSourceId, sources]
  );

  useEffect(() => {
    if (agent === undefined) return;
    let cancelled = false;
    void Promise.all([agent.listImportSources(), agent.getImportPreferences()])
      .then(([sourceResponse, preferenceResponse]) => {
        if (cancelled) return;
        setSources(sourceResponse.sources);
        setPreferences(preferenceResponse);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, [agent]);

  const updatePreferences = async (request: Parameters<NonNullable<typeof agent>["setImportPreferences"]>[0]) => {
    if (agent === undefined) return;
    const next = await agent.setImportPreferences(request);
    setPreferences(next);
    setDetections({});
  };

  const handleAction = async (source: AgentImportSource): Promise<void> => {
    if (agent === undefined || pendingSourceId !== null) return;
    setPendingSourceId(source.id);
    setError(null);
    try {
      const current = detections[source.id];
      if (actionState(current) === "sync" && current !== undefined) {
        const result = await agent.syncImport({ detectionId: current.detectionId });
        const failures = result.results.filter((item) => item.status === "failed");
        if (failures.length > 0) {
          setError(failures.map((item) => `${item.targetId}: ${item.message ?? labels.needsAttention}`).join("\n"));
        }
      }
      const detection = await agent.detectImport({
        sourceId: source.id,
        ...(preferences.projectRoot === undefined ? {} : { projectRoot: preferences.projectRoot })
      });
      setDetections((value) => ({ ...value, [source.id]: detection }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingSourceId(null);
    }
  };

  const chooseProject = async (): Promise<void> => {
    const selected = await desktopApi?.files.selectDirectories();
    const path = selected?.[0]?.path;
    if (path !== undefined) await updatePreferences({ projectRoot: path });
  };

  if (agent === undefined) {
    return <AppSettingsSection label={labels.title}><AppSettingsRow title={labels.unavailable} /></AppSettingsSection>;
  }

  if (selectedSource !== null) {
    const preference = preferences.sources[selectedSource.id] ?? { skills: true, mcp: true };
    const detection = detections[selectedSource.id];
    return (
      <div className="lyra-settings-import-detail">
        <AppSubPageBack label={labels.back} onClick={() => setSelectedSourceId(null)} />
        <AppSettingsSection label={selectedSource.label}>
          <AppSettingsRow
            title={labels.skills}
            description={detection?.candidates.filter((item) => item.kind === "skill").map((item) => `${item.sourceItemId} · ${item.scope} · ${item.status}`).join("\n")}
            control={<AppSwitch aria-label={labels.skills} checked={preference.skills} onCheckedChange={(skills) => void updatePreferences({ sourceId: selectedSource.id, skills })} />}
          />
          <AppSettingsRow
            title={labels.mcp}
            description={detection?.candidates.filter((item) => item.kind === "mcp").map((item) => `${item.sourceItemId} · ${item.scope} · ${item.status}`).join("\n")}
            control={<AppSwitch aria-label={labels.mcp} checked={preference.mcp} onCheckedChange={(mcp) => void updatePreferences({ sourceId: selectedSource.id, mcp })} />}
          />
        </AppSettingsSection>
      </div>
    );
  }

  return (
    <div className="lyra-settings-import">
      <AppSettingsSection label={labels.title}>
        <AppSettingsRow
          title={labels.project}
          description={preferences.projectRoot ?? labels.description}
          control={(
            <span className="lyra-settings-import-project-actions">
              <AppButton type="button" variant="secondary" onClick={() => void chooseProject()}>
                <FolderOpen size={14} aria-hidden="true" />{labels.chooseProject}
              </AppButton>
              {preferences.projectRoot == null ? null : (
                <AppButton type="button" variant="ghost" onClick={() => void updatePreferences({ projectRoot: null })}>{labels.clearProject}</AppButton>
              )}
            </span>
          )}
        />
      </AppSettingsSection>
      <AppSettingsSection label={labels.title} titlePlacement="none">
        {sources.map((source) => {
          const state = actionState(detections[source.id]);
          const actionLabel = state === "detect" ? labels.detect : state === "sync" ? labels.sync : state === "synced" ? labels.synced : labels.needsAttention;
          return (
            <AppSettingsRow
              key={source.id}
              title={<SourceTitle source={source} />}
              className="lyra-settings-import-source"
              role="button"
              tabIndex={0}
              onClick={() => setSelectedSourceId(source.id)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setSelectedSourceId(source.id); }}
              description={sourceDescription(source, detections[source.id], labels)}
              control={state === "empty" ? undefined : (
                <AppButton type="button" variant={state === "sync" ? "default" : "secondary"} disabled={pendingSourceId !== null || state === "synced" || state === "attention"} onClick={(event) => { event.stopPropagation(); void handleAction(source); }}>
                  {pendingSourceId === source.id ? labels.loading : actionLabel}
                </AppButton>
              )}
            />
          );
        })}
        {error === null ? null : <AppSettingsRow title={labels.needsAttention} description={error} />}
      </AppSettingsSection>
    </div>
  );
};
