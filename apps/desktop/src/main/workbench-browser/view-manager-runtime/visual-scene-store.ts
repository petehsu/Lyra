import { browserAgentOperationContext } from "../agent-operation-context";
import type { VisualMark, VisualScene } from "./visual-scene-types";
import type { WorkbenchVisualFrame } from "../../../shared/workbench-observation";
import { visualMarkId } from "./visual-scene-render";

export const createVisualSceneStore = (now: () => number = Date.now) => {
  const scopes = new Map<
    string,
    {
      documentId: string;
      next: number;
      refs: Map<string, string>;
      marks: Map<string, VisualMark>;
    }
  >();
  const captures = new Map<
    string,
    {
      scope: string;
      audience: string;
      scene: VisualScene;
      frame: WorkbenchVisualFrame;
      at: number;
      coordinateUsed: boolean;
    }
  >();
  const clear = (tabId: string) => {
    for (const key of scopes.keys())
      if (key.startsWith(tabId + "\0")) scopes.delete(key);
    for (const [id, value] of captures)
      if (value.scope.startsWith(tabId + "\0")) captures.delete(id);
  };
  const assign = (
    scope: string,
    documentId: string,
    nodes: readonly Omit<VisualMark, "mark">[],
  ) => {
    let state = scopes.get(scope);
    if (!state || state.documentId !== documentId) {
      state = { documentId, next: 0, refs: new Map(), marks: new Map() };
      scopes.set(scope, state);
      for (const [id, value] of captures)
        if (value.scope === scope) captures.delete(id);
    }
    state.marks.clear();
    const marks = nodes.map((node) => {
      const key = node.documentId + "\0" + node.targetRef;
      let mark = state!.refs.get(key);
      if (!mark) {
        mark = visualMarkId(state!.next++);
        state!.refs.set(key, mark);
      }
      const value = { ...node, mark };
      state!.marks.set(mark, value);
      return value;
    });
    // Detached entries do not get reassigned to another object in this document.
    if (state.refs.size > 10000) {
      const live = new Set(nodes.map((n) => n.documentId + "\0" + n.targetRef));
      for (const key of state.refs.keys())
        if (!live.has(key)) state.refs.delete(key);
    }
    if (scopes.size > 32) clear(scopes.keys().next().value!.split("\0")[0]!);
    return marks;
  };
  const audience = () =>
    browserAgentOperationContext.getStore()?.sessionId ?? "local";
  const inspect = (captureId: string | undefined, scope: string) => {
    const record = captureId ? captures.get(captureId) : undefined;
    if (!record) return { reason: "capture_unknown_or_evicted" as const };
    if (record.scope !== scope)
      return { reason: "capture_wrong_page" as const };
    if (record.audience !== audience())
      return { reason: "capture_wrong_task" as const };
    const ageMs = now() - record.at;
    if (ageMs >= 300000)
      return { reason: "capture_expired" as const, ageMs, record };
    return { record, ageMs };
  };
  return {
    latest: (scope: string) =>
      [...captures.values()]
        .reverse()
        .find(
          (record) => record.scope === scope && record.audience === audience(),
        )?.scene.captureId,
    noteInput: (
      id: string,
      scope: string,
      lastInput: import("./visual-scene-types").VisualStep,
    ) => {
      const record = inspect(id, scope).record;
      if (record)
        for (const item of captures.values()) {
          if (
            item.scope === scope &&
            item.audience === record.audience &&
            item.scene.documentId === record.scene.documentId
          )
            item.scene = { ...item.scene, lastInput };
        }
    },
    assign,
    clear,
    region: (scope: string, mark: string) =>
      scopes.get(scope)?.marks.get(mark.toLowerCase()),
    remember: (
      scope: string,
      scene: VisualScene,
      frame: WorkbenchVisualFrame,
    ) => {
      captures.set(scene.captureId, {
        scope,
        audience: audience(),
        scene,
        frame,
        at: now(),
        coordinateUsed: false,
      });
      while (captures.size > 48) captures.delete(captures.keys().next().value!);
      // Raw coordinate proof is heavier than a structural mark. Retain recent
      // proof within a byte budget without expiring usable marked targets.
      let imageBytes = 0,
        images = 0;
      for (const record of [...captures.values()].reverse()) {
        const proof = record.scene.pointEvidence;
        if (!proof) continue;
        imageBytes += proof.png.length;
        images++;
        if (images > 8 || imageBytes > 32 * 1024 * 1024)
          record.scene = { ...record.scene, pointEvidence: undefined };
      }
    },
    read: (captureId: string | undefined, scope: string) => {
      const result = inspect(captureId, scope);
      return result.reason ? undefined : result.record;
    },
    inspect,
    dispose: () => {
      scopes.clear();
      captures.clear();
    },
  };
};
export type VisualSceneStore = ReturnType<typeof createVisualSceneStore>;
