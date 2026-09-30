import { useEffect, useState } from "react";
import type { AgentProject } from "../../../shared/agent-projects";
import type { LyraDesktopApi } from "../../../shared/desktop-bridge";

// Both surfaces subscribe to the same persisted registry and notification.
export const useProjects = (desktopApi: LyraDesktopApi | null) => {
  const [projects, setProjects] = useState<readonly AgentProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const agent = desktopApi?.agent;
    if (!agent?.listProjects) { setLoading(false); return; }
    let generation = 0;
    let disposed = false;
    const refresh = async () => {
      const current = ++generation;
      try {
        const result = await agent.listProjects();
        if (disposed || current !== generation) return;
        setProjects(result.projects);
        setError(null);
      } catch (reason) {
        if (!disposed && current === generation) setError(String(reason));
      } finally {
        if (!disposed && current === generation) setLoading(false);
      }
    };
    void refresh();
    const unsubscribe = agent.onEvent?.((event) => {
      if (event.kind === "projectCapabilitiesChanged") void refresh();
    });
    return () => { disposed = true; unsubscribe?.(); };
  }, [desktopApi]);
  return { projects, loading, error };
};
