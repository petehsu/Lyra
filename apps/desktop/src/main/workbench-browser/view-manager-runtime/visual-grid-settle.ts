import { createHash } from "node:crypto";
import { nativeImage } from "electron";
import { browserAgentOperationContext } from "../agent-operation-context";
import type { VisualMark } from "./visual-scene-types";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";
import { frameTransform } from "./visual-scene-capture";

type Host = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "resolveBrowserAgentTarget"
  | "captureTargetPage"
  | "findFrameInWebContents"
  | "assertSharedControlCanContinue"
>;

/** Bounded paint observation, not a claim that an opponent or business task is done. */
export const settleVisualGrid = async (
  host: Host,
  tabId: string,
  targetMode: "live" | "isolated",
  mark: VisualMark,
  timeoutMs = 900,
) => {
  const started = Date.now(),
    deadline = started + timeoutMs;
  let previous = "",
    changedAt = started,
    changes = 0,
    samples = 0,
    busy = false;
  const target = await host.resolveBrowserAgentTarget(
    tabId,
    { targetMode },
    undefined,
  );
  const frame = host.findFrameInWebContents(
    target.webContents,
    mark.frameTreeNodeId,
  );
  if (!frame) return { status: "unavailable", elapsedMs: 0 };
  while (Date.now() < deadline) {
    browserAgentOperationContext.getStore()?.signal?.throwIfAborted();
    host.assertSharedControlCanContinue(tabId);
    const state = (await frame.executeJavaScript(
      `(() => { ${SURFACE_TARGET_LOOKUP}
      const node=findSurfaceTarget(${JSON.stringify(mark.targetRef)}); if(!node) return null;
      const b=node.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height,
        busy:!!node.closest('[aria-busy=true]') || !!node.querySelector('[aria-busy=true]')}; })()`,
      false,
    )) as (VisualMark["bounds"] & { busy: boolean }) | null;
    if (!state) return { status: "detached", elapsedMs: Date.now() - started };
    const transform = await frameTransform(frame);
    const capture = await host.captureTargetPage(tabId, target);
    const viewport = await target.webContents.executeJavaScript(
      "({width:innerWidth,height:innerHeight})",
      false,
    );
    const pixels = nativeImage.createFromBuffer(
        Buffer.from(capture.imageBase64, "base64"),
      ),
      size = pixels.getSize();
    const sx = size.width / viewport.width,
      sy = size.height / viewport.height;
    const x = Math.max(
      0,
      Math.round((transform.x + state.x * transform.sx) * sx),
    );
    const y = Math.max(
      0,
      Math.round((transform.y + state.y * transform.sy) * sy),
    );
    const width = Math.min(
      size.width - x,
      Math.round(state.width * transform.sx * sx),
    );
    const height = Math.min(
      size.height - y,
      Math.round(state.height * transform.sy * sy),
    );
    if (width < 1 || height < 1)
      return { status: "offscreen", elapsedMs: Date.now() - started };
    const hash = createHash("sha256")
      .update(pixels.crop({ x, y, width, height }).toBitmap())
      .digest("hex");
    samples++;
    busy = state.busy;
    if (hash !== previous) {
      if (previous) changes++;
      previous = hash;
      changedAt = Date.now();
    }
    if (
      !busy &&
      Date.now() - started >= Math.min(500, timeoutMs) &&
      Date.now() - changedAt >= 160
    )
      return {
        status: "quiet",
        elapsedMs: Date.now() - started,
        samples,
        changes,
        message:
          "Grid pixels are quiet; this does not prove turn completion. Inspect the resulting image.",
      };
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(80, Math.max(0, deadline - Date.now()))),
    );
  }
  return {
    status: changes > 0 ? "changed" : "budget_exhausted",
    settled: false,
    elapsedMs: Date.now() - started,
    samples,
    changes,
    busy,
    message:
      "Observation sampling ended; this is not an input failure. Use the returned visual changes, page text and image to judge the result. Do not repeat the input because sampling did not settle.",
  };
};
