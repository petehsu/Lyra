import { browserAgentOperationContext } from "../agent-operation-context";
import { randomUUID } from "node:crypto";
import { validatePointPixels, validatePointTarget } from "./visual-point-evidence";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type { WorkbenchBrowserViewManager } from "../types";
import type {
  VisualActRequest,
  VisualMark,
  VisualPoint,
  VisualStep,
  VisualCell,
} from "./visual-scene-types";
import type { VisualSceneStore } from "./visual-scene-store";
import { validatePointerOptions, type PointerReceipt } from "./bound-pointer";
import { validateVisualNode, VISUAL_DOCUMENT } from "./visual-scene-dom";
import {
  activateStampedSurfaceScript,
  armStampedPointerScript,
  finishStampedPointerScript,
  type StampedSurfacePoint,
} from "./surface-control-names";
import { createSurfaceFrameInput } from "./surface-frame-input";
import { dispatchVisualGesture } from "./visual-gesture";
import { browserKeyEvents } from "./agent-keyboard";
import { SURFACE_TARGET_LOOKUP } from "./surface-target";
import { validateDomGrid } from "./visual-grid-dom";
import { detectImageGrid, sameGridGeometry } from "./visual-grid-image";
import { frameTransform } from "./visual-scene-capture";
import {
  prepareBrowserKeyTargetScript,
  type BrowserEditorPreparation,
} from "./agent-editor-state";

type Host = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "resolveBrowserAgentTarget"
  | "findFrameInWebContents"
  | "openDebuggerSessionForTarget"
  | "sendAgentInputEvent"
  | "assertSharedControlCanContinue"
  | "markSyntheticInput"
  | "createVisualFrame"
  | "captureTargetPage"
> & {
  store: VisualSceneStore;
  act: WorkbenchBrowserViewManager["actOnAgentElement"];
  type: WorkbenchBrowserViewManager["typeIntoAgentElement"];
  press: WorkbenchBrowserViewManager["pressAgentKey"];
  drag: WorkbenchBrowserViewManager["dragAgentElement"];
};
const interactions = new Set([
  "click",
  "doubleClick",
  "rightClick",
  "hover",
  "drag",
  "scroll",
  "type",
  "press",
]);
export const validateVisualStep = (s: VisualStep) => {
  if (!s || !interactions.has(s.interaction))
    throw new Error("Unknown visual interaction");
  validatePointerOptions(s);
  for (const name of ["mark", "toMark"] as const)
    if (
      s[name] !== undefined &&
      (typeof s[name] !== "string" || !s[name]!.trim())
    )
      throw new Error("Invalid visual mark");
  const point = (p: VisualPoint, relative = false) => {
    if (
      !p ||
      !Number.isFinite(p.x) ||
      !Number.isFinite(p.y) ||
      p.x < 0 ||
      p.y < 0 ||
      (relative && (p.x > 1 || p.y > 1))
    )
      throw new Error("Invalid visual position");
  };
  if (s.position) point(s.position, true);
  for (const cell of [s.cell, s.toCell])
    if (
      cell !== undefined &&
      (!cell ||
        !Number.isInteger(cell.row) ||
        !Number.isInteger(cell.column) ||
        cell.row < 1 ||
        cell.column < 1)
    )
      throw new Error("Grid row/column must be positive integers");
  if (s.cell && (!s.mark || s.position || s.point || s.path))
    throw new Error("Use mark + cell without position, point or path");
  if (s.toCell && (!(s.toMark || s.mark) || s.toPosition || s.to || s.path))
    throw new Error(
      "Use a destination mark + toCell without other drag coordinates",
    );
  if (s.toPosition) point(s.toPosition, true);
  if (s.point) point(s.point);
  if (s.to) point(s.to);
  if (s.mark && s.point)
    throw new Error("Choose mark + position or image point, not both");
  if (s.path !== undefined) {
    if (!Array.isArray(s.path) || s.path.length < 2 || s.path.length > 128)
      throw new Error("Drag path needs 2..128 points");
    for (const p of s.path) point(p, !!s.mark);
  }
  for (const name of ["durationMs", "holdMs"] as const)
    if (
      s[name] !== undefined &&
      (!Number.isFinite(s[name]) || s[name]! < 0 || s[name]! > 3000)
    )
      throw new Error(name + " must be 0..3000");
  for (const value of [s.scrollDx, s.scrollDy])
    if (
      value !== undefined &&
      (!Number.isFinite(value) || Math.abs(value) > 10000)
    )
      throw new Error("Invalid scroll delta");
  if (s.interaction === "type" && (!s.mark || typeof s.text !== "string"))
    throw new Error("type requires mark and text");
  if (s.interaction === "press") browserKeyEvents(s.key ?? "");
  else if (!s.mark && !s.point)
    throw new Error("Visual action needs a mark or image point");
  if (
    s.interaction === "drag" &&
    !s.path &&
    !s.to &&
    !s.toMark &&
    !s.toPosition &&
    !s.toCell
  )
    throw new Error("Drag requires an endpoint or path");
  if (
    s.interaction !== "drag" &&
    (s.path || s.toMark || s.to || s.toPosition || s.toCell)
  )
    throw new Error("Drag fields require interaction=drag");
};

export const createVisualSceneActions =
  (host: Host) =>
  async (
    tabId: string,
    request: VisualActRequest,
  ): Promise<Record<string, unknown>> => {
    const steps = request.steps ?? [
      { ...request, interaction: request.interaction ?? "click" } as VisualStep,
    ];
    if (!Array.isArray(steps) || !steps.length || steps.length > 16)
      throw new Error("A visual sequence needs 1..16 explicit steps");
    steps.forEach(validateVisualStep);
    if (
      request.observe !== undefined &&
      !["auto", "image", "structure", "none"].includes(request.observe)
    )
      throw new Error("Invalid observation mode");
    if (
      !request.effect ||
      request.effect === "unknown" ||
      (request.effect === "observe" &&
        steps.some((s) => !["hover", "scroll"].includes(s.interaction)))
    )
      throw new Error("Declare the effect of the complete action sequence");
    if (
      steps.reduce(
        (total, s) =>
          total +
          (s.holdMs ?? 0) +
          (s.interaction === "drag" ? (s.durationMs ?? 300) : 0),
        0,
      ) > 8000
    )
      throw new Error("Continuous input budget exceeds 8 seconds");
    const target = await host.resolveBrowserAgentTarget(
        tabId,
        request,
        request.timeoutMs,
      ),
      scope = tabId + "\0" + target.targetMode;
    const record = host.store.read(request.captureId, scope);
    const fail = (
      reason: string,
      completed: number,
      results: unknown[],
      dispatched = false,
    ) => ({
      ok: false,
      kind: "lyraLumenVactStale",
      tabId,
      targetMode: target.targetMode,
      captureId: request.captureId,
      reason,
      completed,
      results,
      dispatched,
      message:
        "Visual sequence stopped: " +
        reason +
        ". Inspect the returned/current state; do not replay completed actions.",
      nextRecommendedAction: "lyra_lumen.see",
    });
    if (!record) {
      const unavailable = host.store.inspect(request.captureId, scope);
      return {
        ...fail(unavailable.reason ?? "capture_unknown_or_evicted", 0, []),
        captureAgeMs: unavailable.ageMs,
        needsImage: true,
        message:
          unavailable.reason === "capture_expired"
            ? "The observation reference expired after five minutes. No input was sent; this does not imply the page or layout changed. Use the replacement observation returned with this result."
            : "The observation does not belong to an available capture on this page. No input was sent; use the replacement observation.",
      };
    }
    const { scene } = record;
    const lookup = (id: string) => {
      const mark = scene.marks.find((m) => m.mark === id.toLowerCase());
      if (!mark)
        throw new Error("Mark " + id + " was not present in this capture");
      return mark;
    };
    const cellPosition = (mark: VisualMark, cell: VisualCell) => {
      if (
        !mark.grid ||
        cell.row > mark.grid.ys.length ||
        cell.column > mark.grid.xs.length
      )
        throw new Error(
          "Cell is outside a published grid; observe the region instead of guessing its dimensions",
        );
      return {
        x: mark.grid.xs[cell.column - 1]!,
        y: mark.grid.ys[cell.row - 1]!,
      };
    };
    // Validate all references and syntax before the first mutation.
    for (const s of steps) {
      if (s.mark) lookup(s.mark);
      if (s.toMark) lookup(s.toMark);
      if (s.cell) cellPosition(lookup(s.mark!), s.cell);
      if (s.toCell) cellPosition(lookup(s.toMark ?? s.mark!), s.toCell);
    }
    const raw = steps.some((s) => s.point !== undefined || s.to !== undefined || (!s.mark && s.path !== undefined));
    if (raw && (record.coordinateUsed || steps.length > 1))
      return fail(
        "image_coordinates_require_a_fresh_capture_and_single_step",
        0,
        [],
      );
    const deadline = Date.now() + Math.min(request.timeoutMs ?? 30000, 120000);
    const checkDocument = async () => {
      browserAgentOperationContext.getStore()?.signal?.throwIfAborted();
      if (Date.now() > deadline) throw new Error("Visual action timed out");
      host.assertSharedControlCanContinue(tabId);
      if (
        (await target.webContents.executeJavaScript(VISUAL_DOCUMENT, false)) !==
        scene.documentId
      )
        throw new Error("document_changed");
    };
    const frameFor = (mark: VisualMark) => {
      const frame = host.findFrameInWebContents(
        target.webContents,
        mark.frameTreeNodeId,
      );
      if (!frame || frame.isDestroyed()) throw new Error("frame_detached");
      return frame;
    };
    const checkMark = async (mark: VisualMark) => {
      if (
        !(await frameFor(mark).executeJavaScript(
          validateVisualNode(
            mark.targetRef,
            mark.signature,
            mark.documentId,
            mark.grid?.source === "dom" ? true : mark.gridCell ? "cell" : false,
          ),
          false,
        ))
      )
        throw new Error("target_changed_or_detached");
    };
    const checkGrid = async (mark: VisualMark) => {
      await checkMark(mark);
      const grid = mark.grid!;
      if (grid.source === "dom") {
        const valid = await frameFor(mark).executeJavaScript(
          `(() => { ${SURFACE_TARGET_LOOKUP}
          return ${validateDomGrid(mark.targetRef, grid.cells!, grid.xs, grid.ys)}; })()`,
          false,
        );
        if (!valid)
          throw new Error("grid_geometry_changed; observe the region again");
      } else {
        const frame = frameFor(mark),
          t = await frameTransform(frame);
        const local = (await frame.executeJavaScript(
          `(() => { ${SURFACE_TARGET_LOOKUP} const node=findSurfaceTarget(${JSON.stringify(mark.targetRef)});
          if(!node) return null; const b=node.getBoundingClientRect(); return {x:b.x,y:b.y,width:b.width,height:b.height}; })()`,
          false,
        )) as VisualMark["bounds"] | null;
        if (!local) throw new Error("grid_detached");
        const pixels = await host.captureTargetPage(tabId, target);
        const viewport = await target.webContents.executeJavaScript(
          "({width:innerWidth,height:innerHeight})",
          false,
        );
        const current = detectImageGrid(pixels.imageBase64, viewport, {
          x: t.x + local.x * t.sx,
          y: t.y + local.y * t.sy,
          width: local.width * t.sx,
          height: local.height * t.sy,
        });
        if (!sameGridGeometry(grid, current))
          throw new Error(
            "grid_geometry_unconfirmed; observe the region or use an explicit visual position",
          );
      }
    };
    const resolveCell = (mark: VisualMark, cell?: VisualCell) => {
      if (!cell) return { mark, position: undefined };
      const position = cellPosition(mark, cell);
      const member =
        mark.grid!.cells?.[
          (cell.row - 1) * mark.grid!.xs.length + cell.column - 1
        ];
      return member
        ? {
            mark: { ...member, mark: mark.mark } as VisualMark,
            position: undefined,
          }
        : { mark, position };
    };
    const imagePoint = (p: VisualPoint) => {
      if (p.x >= scene.imageWidth || p.y >= scene.imageHeight)
        throw new Error("Point is outside the returned image");
      const point = {
        x: scene.clip.x + (p.x * scene.clip.width) / scene.imageWidth,
        y: scene.clip.y + (p.y * scene.clip.height) / scene.imageHeight,
      };
      if (
        point.x < 0 ||
        point.y < 0 ||
        point.x >= record.frame.cssViewportWidth ||
        point.y >= record.frame.cssViewportHeight
      )
        throw new Error("Annotation gutter is outside the browser viewport");
      return point;
    };
    const boundPoint = async (
      mark: VisualMark,
      p: VisualPoint = { x: 0.5, y: 0.5 },
    ) => {
      await checkMark(mark);
      const frame = frameFor(mark);
      const state = (await frame.executeJavaScript(
        activateStampedSurfaceScript(mark.targetRef, 100, false, p, true),
        true,
      )) as StampedSurfacePoint | null;
      if (!state?.trusted)
        throw new Error("Target is " + (state?.reason ?? "detached"));
      const translated = await createSurfaceFrameInput(frame).translate({
        x: state.clickX,
        y: state.clickY,
      });
      if (!translated) throw new Error("Frame is covered or detached");
      return translated;
    };
    const results: unknown[] = [];
    let dispatched = false,
      needsImage = raw;
    try {
      await checkDocument();
      if (raw) {
        const current = await host.createVisualFrame({
          tabId,
          target,
          imageWidth: record.frame.imageWidth,
          imageHeight: record.frame.imageHeight,
        });
        if (
          current.cssViewportWidth !== record.frame.cssViewportWidth ||
          current.cssViewportHeight !== record.frame.cssViewportHeight ||
          current.scrollX !== record.frame.scrollX ||
          current.scrollY !== record.frame.scrollY ||
          current.dpr !== record.frame.dpr
        )
          throw new Error("viewport_changed");
        const path = steps.flatMap(s => s.path ?? [s.point, s.to].filter((p): p is VisualPoint => !!p)).map(imagePoint);
        const corridor: VisualPoint[] = [];
        for (const [i, p] of path.entries()) {
          const previous = path[i-1] ?? p;
          const count = Math.max(1, Math.ceil(Math.hypot(p.x-previous.x,p.y-previous.y)/24));
          if (corridor.length + count > 1024) throw new Error("image_path_too_long");
          for(let j=1;j<=count;j++) corridor.push({x:previous.x+(p.x-previous.x)*j/count,y:previous.y+(p.y-previous.y)*j/count});
        }
        if (!scene.pointEvidence) throw new Error("image_evidence_unavailable");
        for (const p of path) await validatePointTarget(target.webContents, scene.pointEvidence.id, p);
        const pixels = await host.captureTargetPage(tabId, target);
        validatePointPixels(scene, pixels.imageBase64, corridor);
        // Recheck hit identity after capture to close the compositor wait window.
        for (const p of path) await validatePointTarget(target.webContents, scene.pointEvidence.id, p);
      }
      for (const originalStep of steps) {
        await checkDocument();
        const grid = originalStep.cell ? lookup(originalStep.mark!) : undefined;
        const toGrid = originalStep.toCell
          ? lookup(originalStep.toMark ?? originalStep.mark!)
          : undefined;
        if (grid) await checkGrid(grid);
        if (toGrid && toGrid !== grid) await checkGrid(toGrid);
        const start = originalStep.mark
          ? resolveCell(lookup(originalStep.mark), originalStep.cell)
          : undefined;
        const end = originalStep.toCell
          ? resolveCell(toGrid!, originalStep.toCell)
          : originalStep.toMark
            ? resolveCell(lookup(originalStep.toMark))
            : undefined;
        const step = {
          ...originalStep,
          ...(start?.position ? { position: start.position } : {}),
          ...(end?.position ? { toPosition: end.position } : {}),
        };
        const mark = start?.mark;
        if (mark) await checkMark(mark);
        needsImage ||= mark?.kind === "region";
        const common = {
          targetMode: target.targetMode,
          effect: request.effect,
          verification: "fast" as const,
          ...(mark ? { targetRef: mark.targetRef } : {}),
          ...(request.timeoutMs === undefined
            ? {}
            : { timeoutMs: request.timeoutMs }),
        };
        let result: Record<string, unknown>;
        // Once a dispatch starts its receipt may be lost. Never automatically replay.
        dispatched = true;
        if (raw) record.coordinateUsed = true;
        if (step.interaction === "type") {
          if (mark?.kind !== "control")
            throw new Error("Text input needs an actual editable control");
          result = (await host.type(tabId, {
            ...common,
            text: step.text!,
            ...(step.clear === undefined ? {} : { clear: step.clear }),
          })) as unknown as Record<string, unknown>;
        } else if (
          step.interaction === "press" &&
          !step.holdMs &&
          mark?.kind !== "region"
        ) {
          result = (await host.press(tabId, {
            ...common,
            key: step.key!,
          })) as unknown as Record<string, unknown>;
        } else if (
          mark?.kind === "control" &&
          !originalStep.cell &&
          !step.holdMs &&
          ["click", "doubleClick", "rightClick", "hover"].includes(
            step.interaction,
          )
        ) {
          result = (await host.act(tabId, {
            ...common,
            ...step,
            interaction: step.interaction as "click",
            settle: false,
          } as Parameters<Host["act"]>[1])) as unknown as Record<
            string,
            unknown
          >;
        } else if (
          step.interaction === "drag" &&
          !originalStep.cell &&
          !originalStep.toCell &&
          mark?.kind === "control" &&
          end?.mark &&
          !step.path &&
          step.durationMs === undefined &&
          !step.holdMs &&
          step.button === undefined
        ) {
          const to = end.mark;
          await checkMark(to);
          result = await host.drag(tabId, {
            targetMode: target.targetMode,
            effect: request.effect,
            targetRef: mark.targetRef,
            toTargetRef: to.targetRef,
            ...(step.position ? { fromPosition: step.position } : {}),
            ...(step.toPosition ? { toPosition: step.toPosition } : {}),
            ...(step.modifiers ? { modifiers: step.modifiers } : {}),
          });
        } else {
          if (step.interaction === "press" && mark) {
            const prepared = (await frameFor(mark).executeJavaScript(
              prepareBrowserKeyTargetScript(mark.targetRef),
              true,
            )) as BrowserEditorPreparation;
            if (!prepared?.ok)
              throw new Error(prepared?.errorKind ?? "target_not_focusable");
          }
          const points =
            step.interaction === "press"
              ? []
              : step.path
                ? await Promise.all(
                    step.path.map((p: VisualPoint) =>
                      mark
                        ? boundPoint(mark, p)
                        : Promise.resolve(imagePoint(p)),
                    ),
                  )
                : [
                    mark
                      ? await boundPoint(mark, step.position)
                      : imagePoint(step.point!),
                  ];
          if (step.interaction === "drag" && !step.path)
            points.push(
              end?.mark
                ? await boundPoint(end.mark, step.toPosition)
                : mark && step.toPosition
                  ? await boundPoint(mark, step.toPosition)
                  : imagePoint(step.to!),
            );
          const token = randomUUID(),
            frame = mark ? frameFor(mark) : undefined;
          const input = frame ? createSurfaceFrameInput(frame) : undefined;
          try {
            await dispatchVisualGesture(host, {
              tabId,
              target,
              step,
              points,
              check: async () => {
                await checkDocument();
                if (mark) await checkMark(mark);
              },
              ...(mark && frame
                ? {
                    arm: async () => {
                      if (grid?.grid?.source === "dom") await checkGrid(grid);
                      if (toGrid?.grid?.source === "dom" && toGrid !== grid)
                        await checkGrid(toGrid);
                      // Revalidate after hover before pressing; do not chase a moving region during a gesture.
                      if (points[0]) {
                        const now = await boundPoint(
                          mark,
                          step.path?.[0] ?? step.position,
                        );
                        if (
                          Math.abs(now.x - points[0].x) > 1 ||
                          Math.abs(now.y - points[0].y) > 1
                        )
                          throw new Error("target_moved_before_press");
                      }
                      await frame.executeJavaScript(
                        armStampedPointerScript(mark.targetRef, token),
                        true,
                      );
                      if (points[0]) {
                        const local = (await frame.executeJavaScript(
                          activateStampedSurfaceScript(
                            mark.targetRef,
                            100,
                            false,
                            step.path?.[0] ?? step.position,
                            true,
                          ),
                          true,
                        )) as StampedSurfacePoint | null;
                        if (
                          !local?.trusted ||
                          !(await input!.translate(
                            { x: local.clickX, y: local.clickY },
                            token,
                          ))
                        )
                          throw new Error("Frame stopped receiving input");
                      }
                    },
                    accepted: async () => {
                      const receipt = (await frame.executeJavaScript(
                        finishStampedPointerScript(token),
                        false,
                      )) as PointerReceipt | null;
                      if (
                        !receipt?.accepted ||
                        receipt.blocked ||
                        (await input!.finish(token))
                      )
                        throw new Error(
                          "Pointer did not reach the marked object",
                        );
                    },
                  }
                : {}),
            });
          } finally {
            if (frame)
              await frame
                .executeJavaScript(finishStampedPointerScript(token), false)
                .catch(() => {});
            await input?.finish(token).catch(() => {});
          }
          result = {
            ok: true,
            dispatched: true,
            interaction: step.interaction,
            mark: step.mark,
            ...(originalStep.cell ? { cell: originalStep.cell } : {}),
            message:
              "Input delivered; use the resulting page/visual state to establish the outcome.",
          };
        }
        results.push(result);
        if (result.ok !== true)
          return {
            ...fail("action_unconfirmed", results.length - 1, results, true),
            needsImage: true,
          };
      }
      return {
        ok: true,
        kind: "lyraLumenVisualActionResult",
        tabId,
        captureId: request.captureId,
        targetMode: target.targetMode,
        completed: results.length,
        results,
        dispatched,
        needsImage,
        message:
          "Requested inputs delivered. Reuse unchanged marks; do not repeat completed steps.",
        nextRecommendedAction: needsImage ? "lyra_lumen.see" : "continue",
      };
    } catch (error) {
      return {
        ...fail(
          error instanceof Error ? error.message : String(error),
          results.length,
          results,
          dispatched,
        ),
        needsImage: true,
      };
    }
  };
