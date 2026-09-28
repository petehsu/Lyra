import { browserAgentOperationContext } from "../agent-operation-context";
import { frameTransform } from "./visual-scene-capture";
import { runFrameScriptWithTimeout } from "./normalizers";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";

/** Wait only for currently rendered finite DOM transitions, never game/business completion. */
export const settleSceneAnimations = async (
  host: Pick<WorkbenchBrowserAgentControllerHost, "resolveBrowserAgentTarget">,
  tabId: string,
  targetMode: "live" | "isolated",
  budgetMs: number,
) => {
  const started = Date.now();
  const target = await host.resolveBrowserAgentTarget(
    tabId,
    { targetMode },
    undefined,
  );
  const frames = target.webContents.mainFrame.framesInSubtree;
  const results = await Promise.all(
    frames.map(async (frame) => {
      try {
        await frameTransform(frame);
        return await runFrameScriptWithTimeout(
          () =>
            frame.executeJavaScript(
              `(async()=>{
        const started=performance.now(),budget=${budgetMs};
        const timeout=new Promise(resolve=>setTimeout(()=>resolve({status:'budget'}),budget));
        const settled=(async()=>{
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const active=document.getAnimations().filter(a=>{
            const n=a.effect?.target,t=a.effect?.getComputedTiming();
            if(a.playState!=='running'||!Number.isFinite(t?.endTime)||!n?.getBoundingClientRect)return false;
            const b=n.getBoundingClientRect(),s=getComputedStyle(n);
            return b.width>0&&b.height>0&&b.right>0&&b.bottom>0&&b.left<innerWidth&&b.top<innerHeight&&s.display!=='none'&&s.visibility!=='hidden';
          });
          await Promise.allSettled(active.map(a=>a.finished));
          return {status:'settled',animations:active.length};
        })();
        return {...await Promise.race([settled,timeout]),elapsedMs:performance.now()-started};
      })()`,
              false,
            ),
          budgetMs + 150,
        );
      } catch {
        return { status: "unavailable" };
      }
    }),
  );
  browserAgentOperationContext.getStore()?.signal?.throwIfAborted();
  return {
    basis:
      "Visible finite DOM animations only; not proof of game/response completion",
    elapsedMs: Date.now() - started,
    frames: results,
  };
};
