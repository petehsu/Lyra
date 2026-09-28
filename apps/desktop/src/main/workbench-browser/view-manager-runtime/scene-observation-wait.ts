import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { VisualActRequest, VisualMark } from "./visual-scene-types";
import { browserAgentOperationContext } from "../agent-operation-context";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";
import { READ_RENDER_STATE } from "./visual-render-state";
import { READ_SURFACE_TEXT } from "./surface-text";
import { VISUAL_DOCUMENT } from "./visual-scene-dom";

type Host = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "resolveBrowserAgentTarget"
  | "findFrameInWebContents"
  | "assertSharedControlCanContinue"
>;
export const validateSceneCondition = (
  after: VisualActRequest["after"],
  marks: readonly VisualMark[],
) => {
  if (!after) return;
  if (
    ![
      "textContains",
      "textGone",
      "targetHidden",
      "targetEnabled",
      "stateChanged",
    ].includes(after.until)
  )
    throw new Error("Unknown after condition");
  if (after.until.startsWith("text") && !after.text?.trim())
    throw new Error("Text after condition requires non-empty text");
  if (after.until.startsWith("target") || after.until === "stateChanged") {
    if (!after.mark || !marks.some((m) => m.mark === after.mark?.toLowerCase()))
      throw new Error("After condition requires a current mark");
  } else if (
    after.mark &&
    !marks.some((m) => m.mark === after.mark?.toLowerCase())
  )
    throw new Error("Unknown after mark");
  if (
    after.timeoutMs !== undefined &&
    (!Number.isInteger(after.timeoutMs) ||
      after.timeoutMs < 0 ||
      after.timeoutMs > 30000)
  )
    throw new Error("after.timeoutMs must be 0..30000");
};

/** Read the baseline before input, then sample rendered facts without a new map. */
export const prepareSceneWait = async (
  host: Host,
  tabId: string,
  request: VisualActRequest,
  mark?: VisualMark,
) => {
  const target = await host.resolveBrowserAgentTarget(
    tabId,
    request,
    undefined,
  );
  const frame = mark
    ? host.findFrameInWebContents(target.webContents, mark.frameTreeNodeId)
    : target.webContents.mainFrame;
  if (!frame) throw new Error("Observation frame is unavailable");
  const read = async () =>
    frame.executeJavaScript(
      `(() => {
    ${SURFACE_TARGET_LOOKUP}
    const node=${mark ? `findSurfaceTarget(${JSON.stringify(mark.targetRef)})` : "document.body"};
    const doc=${VISUAL_DOCUMENT};
    if(!node?.isConnected)return {doc,hidden:true,enabled:false,state:'detached',text:'',textMatched:false};
    const b=node.getBoundingClientRect(),s=getComputedStyle(node);
    const hidden=!b.width||!b.height||s.display==='none'||s.visibility==='hidden';
    const text=hidden?'':(${READ_SURFACE_TEXT})(node);
    const textMatched=text.includes(${JSON.stringify(request.after?.text?.replace(/\s+/g, " ").trim() ?? "")});
    const busy=!!node.closest('[aria-busy=true]')||!!node.querySelector('[aria-busy=true]');
    const refs=${JSON.stringify(mark?.grid?.cells?.map((c) => c.targetRef) ?? [])};
    const render=${READ_RENDER_STATE};
    const state=JSON.stringify([render(node),refs.map(ref=>{const n=findSurfaceTarget(ref);return n?render(n):null})]);
    return {doc,hidden,busy,enabled:!hidden&&!node.matches(':disabled')&&!node.closest('[inert],[aria-disabled=true]'),state,text:text.slice(0,20000),textMatched};
  })()`,
      false,
    ) as Promise<{
      doc: string;
      hidden: boolean;
      busy?: boolean;
      enabled: boolean;
      state: string;
      text: string;
      textMatched: boolean;
    }>;
  const matches = (
    state: Awaited<ReturnType<typeof read>>,
    baseline: Awaited<ReturnType<typeof read>>,
  ) => {
    const after = request.after;
    if (!after) return false;
    switch (after.until) {
      case "textContains":
        return state.textMatched;
      case "textGone":
        return !state.textMatched;
      case "targetHidden":
        return state.hidden;
      case "targetEnabled":
        return state.enabled && !state.busy;
      case "stateChanged":
        return state.state !== baseline.state;
    }
  };
  const baseline = await read();
  const wasAlreadySatisfied = matches(baseline, baseline);
  return async () => {
    const started = Date.now(),
      after = request.after;
    const budget = Math.min(
      after ? (after.timeoutMs ?? 10000) : (request.settleTimeoutMs ?? 600),
      request.timeoutMs ?? 30000,
    );
    const deadline = started + budget;
    let previous = "",
      changedAt = started,
      changes = 0,
      samples = 0,
      state = baseline,
      sawUnmatched = !wasAlreadySatisfied;
    for (;;) {
      browserAgentOperationContext.getStore()?.signal?.throwIfAborted();
      host.assertSharedControlCanContinue(tabId);
      state = await read();
      samples++;
      if (state.doc !== baseline.doc)
        return {
          status: "navigation_changed",
          matched: false,
          completion: "unknown",
          elapsedMs: Date.now() - started,
        };
      const fingerprint = JSON.stringify([
        state.state,
        state.text,
        state.hidden,
        state.enabled,
        state.busy,
      ]);
      if (fingerprint !== previous) {
        if (previous) changes++;
        previous = fingerprint;
        changedAt = Date.now();
      }
      const currentMatch = matches(state, baseline);
      if (!currentMatch) sawUnmatched = true;
      const matched = currentMatch && sawUnmatched;
      const quiet =
        !state.busy &&
        Date.now() - started >= Math.min(250, budget) &&
        Date.now() - changedAt >= 120;
      if (
        (after && matched && quiet) ||
        (!after && quiet) ||
        Date.now() >= deadline
      )
        return {
          status: after
            ? matched && quiet
              ? "condition_met"
              : "budget_exhausted"
            : quiet
              ? "quiet"
              : "budget_exhausted",
          ...(after
            ? {
                until: after.until,
                wasAlreadySatisfied,
                matched: matched && quiet,
                completion: matched && quiet ? "conditionMet" : "unknown",
              }
            : {}),
          elapsedMs: Date.now() - started,
          samples,
          changes,
          busy: !!state.busy,
          basis:
            "Rendered DOM state and explicit condition; quiet is not proof of task completion",
          message: after
            ? "Only the requested condition is checked. Use the returned scene; do not repeat delivered input."
            : "Bounded observation of rendered changes. Inspect the returned state; quiet does not establish an opponent or task finished.",
        };
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(60, Math.max(0, deadline - Date.now()))),
      );
    }
  };
};
