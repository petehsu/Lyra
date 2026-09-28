import { browserAgentOperationContext } from "../agent-operation-context";
import { discoverVisualShadowRoots } from "./visual-shadow-roots";
import { createHash } from "node:crypto";
import type { WebFrameMain } from "electron";
import type { WorkbenchBrowserAgentControllerHost } from "./agent-controller-types";
import type {
  WorkbenchBrowserViewManager,
  WorkbenchBrowserAgentElementBounds as Rect,
} from "../types";
import type {
  VisualMark,
  VisualScene,
  VisualSeeRequest,
  VisualStep,
} from "./visual-scene-types";
import type { VisualSceneStore } from "./visual-scene-store";
import { collectVisualNodes, VISUAL_DOCUMENT } from "./visual-scene-dom";
import { renderVisualScene } from "./visual-scene-render";
import { readSurfaceRevision } from "./agent-surface-revision";
import type { BrowserAgentStateStore } from "./agent-state-store";
import { detectImageGrid } from "./visual-grid-image";
import { summarizeRenderStates } from "./visual-render-state";
import { createVisualEvidenceTracker } from "./visual-scene-evidence";
import { rememberPointTargets } from "./visual-point-evidence";
import { randomUUID } from "node:crypto";
import { READ_SURFACE_TEXT } from "./surface-text";

class VisualFrameGeometryError extends Error {
  constructor(
    readonly reason: "not_visible" | "owner_unresolved" | "detached",
  ) {
    super("Visual frame " + reason);
  }
}
// Compute viewport geometry through actual frame owners, including CSS scale.
export const frameTransform = async (frame: WebFrameMain) => {
  let x = 0,
    y = 0,
    sx = 1,
    sy = 1;
  for (let child = frame; child.parent; child = child.parent) {
    const parent = child.parent,
      index = parent.frames.findIndex(
        (f) => f.frameTreeNodeId === child.frameTreeNodeId,
      );
    if (index < 0) throw new VisualFrameGeometryError("detached");
    const b = (await parent.executeJavaScript(
      `(() => {
      const find=root=>{for(const n of root.querySelectorAll('*')){if((n.tagName==='IFRAME'||n.tagName==='FRAME')&&n.contentWindow===window.frames[${index}])return n;if(n.shadowRoot){const f=find(n.shadowRoot);if(f)return f;}}};
      const n=find(document);if(!n)return {reason:'owner_unresolved'};if(!n.offsetWidth||!n.offsetHeight||getComputedStyle(n).visibility==='hidden'||Number(getComputedStyle(n).opacity)===0)return {reason:'not_visible'};
      const r=n.getBoundingClientRect();return {x:r.x+n.clientLeft*r.width/n.offsetWidth,y:r.y+n.clientTop*r.height/n.offsetHeight,sx:r.width/n.offsetWidth,sy:r.height/n.offsetHeight};
    })()`,
      false,
    )) as
      | { x: number; y: number; sx: number; sy: number }
      | { reason: "not_visible" | "owner_unresolved" };
    if ("reason" in b) throw new VisualFrameGeometryError(b.reason);
    x = b.x + x * b.sx;
    y = b.y + y * b.sy;
    sx *= b.sx;
    sy *= b.sy;
  }
  return { x, y, sx, sy };
};
export type VisualCaptureHost = Pick<
  WorkbenchBrowserAgentControllerHost,
  | "resolveBrowserAgentTarget"
  | "captureTargetPage"
  | "createVisualFrame"
  | "rememberVisualFrame"
  | "openDebuggerSessionForTarget"
> & {
  observe: WorkbenchBrowserViewManager["observeAgentPage"];
  stateStore: BrowserAgentStateStore;
  store: VisualSceneStore;
};
export const collectSceneNodes = async (
  host: Pick<VisualCaptureHost, "stateStore">,
  tabId: string,
  target: Awaited<ReturnType<VisualCaptureHost["resolveBrowserAgentTarget"]>>,
) => {
  const cache = host.stateStore.readBrowserAgentCacheEntry(
    tabId,
    target.targetMode,
  );
  const knownNames = new Map(
    (cache?.elements ?? [])
      .filter((e) => e.label && !/^(\(no label\)|unnamed\b)/i.test(e.label))
      .map((e) => [e.targetRef, e.label]),
  );
  const nameOf = (node: { targetRef: string; name?: string }) =>
    node.name || knownNames.get(node.targetRef) || "";
  const frames = target.webContents.mainFrame.framesInSubtree.filter(
    (f) => !f.isDestroyed(),
  );
  const skippedFrames: { frameTreeNodeId: number; reason: string }[] = [];
  const groups = await Promise.all(
    frames.map(async (frame) => {
      const refs = (cache?.elements ?? [])
        .filter(
          (e) =>
            e.frameTreeNodeId === frame.frameTreeNodeId &&
            e.discoveryScope !== "visual" &&
            e.discoveryScope !== "coordinate",
        )
        .map((e) => e.targetRef);
      let t: Awaited<ReturnType<typeof frameTransform>>;
      try {
        t = await frameTransform(frame);
      } catch (error) {
        skippedFrames.push({
          frameTreeNodeId: frame.frameTreeNodeId,
          reason:
            error instanceof VisualFrameGeometryError
              ? error.reason
              : "geometry_unavailable",
        });
        return [];
      }
      const nodes = await (
        frame.executeJavaScript(collectVisualNodes(refs), false) as Promise<
          Omit<VisualMark, "mark" | "frameTreeNodeId">[]
        >
      ).catch((error) => {
        if (!frame.parent) throw error;
        skippedFrames.push({
          frameTreeNodeId: frame.frameTreeNodeId,
          reason: "document_unavailable",
        });
        return [];
      });
      return nodes.map((node) => ({
        ...node,
        name: nameOf(node),
        ...(node.grid?.cells
          ? {
              grid: {
                ...node.grid,
                cells: node.grid.cells.map((cell) => ({
                  ...cell,
                  name: nameOf(cell),
                  frameTreeNodeId: frame.frameTreeNodeId,
                })),
              },
            }
          : {}),
        frameTreeNodeId: frame.frameTreeNodeId,
        bounds: {
          x: t.x + node.bounds.x * t.sx,
          y: t.y + node.bounds.y * t.sy,
          width: node.bounds.width * t.sx,
          height: node.bounds.height * t.sy,
        },
      }));
    }),
  );
  return { nodes: groups.flat(), skippedFrames };
};
const intersect = (a: Rect, b: Rect) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
export const createVisualSceneCapture = (host: VisualCaptureHost) => {
  const revisions = new Map<string, string>();
  const evidenceTracker = createVisualEvidenceTracker();
  const captureScene = async (
    tabId: string,
    request: VisualSeeRequest = {},
    lastAction?: VisualStep,
  ) => {
    if (request.region)
      request = { ...request, region: request.region.toLowerCase() };
    if (lastAction?.mark)
      lastAction = { ...lastAction, mark: lastAction.mark.toLowerCase() };
    if (
      request.zoom !== undefined &&
      (!Number.isFinite(request.zoom) || request.zoom < 1 || request.zoom > 4)
    )
      throw new Error("zoom must be between 1 and 4");
    if (
      request.cell !== undefined &&
      (!request.cell ||
        !request.region ||
        !Number.isInteger(request.cell.row) ||
        !Number.isInteger(request.cell.column) ||
        request.cell.row < 1 ||
        request.cell.column < 1)
    )
      throw new Error(
        "Detail cell needs a region and positive integer row/column",
      );
    const target = await host.resolveBrowserAgentTarget(
        tabId,
        request,
        undefined,
      ),
      scope = tabId + "\0" + target.targetMode;
    const revision = await readSurfaceRevision(target);
    if (
      !revision ||
      revisions.get(scope) !== revision ||
      !host.stateStore.readBrowserAgentCacheEntry(tabId, target.targetMode)
    ) {
      const session = await host.openDebuggerSessionForTarget(target);
      try {
        await discoverVisualShadowRoots(session);
      } finally {
        await session.close();
      }
      await host.observe(tabId, {
        targetMode: target.targetMode,
        strategy: "interactiveOnly",
        suppressActivity: true,
      });
      const next = await readSurfaceRevision(target);
      if (next) revisions.set(scope, next);
      if (revisions.size > 32) revisions.delete(revisions.keys().next().value!);
    }
    const collect = () => collectSceneNodes(host, tabId, target);
    // Sampling is bounded. Do not publish boxes from a different layout than the
    // captured pixels, and do not spin until an animated page becomes quiet.
    for (let attempt = 0; attempt < 2; attempt++) {
      const documentId = (await target.webContents.executeJavaScript(
        VISUAL_DOCUMENT,
        false,
      )) as string;
      const { nodes } = await collect();
      const pointEvidenceId = randomUUID();
      await rememberPointTargets(target.webContents, pointEvidenceId);
      const capture = await host.captureTargetPage(tabId, target);
      const frame = await host.createVisualFrame({
        tabId,
        target,
        imageWidth: capture.width,
        imageHeight: capture.height,
      });
      const { nodes: after, skippedFrames } = await collect();
      if (
        documentId !==
          (await target.webContents.executeJavaScript(
            VISUAL_DOCUMENT,
            false,
          )) ||
        JSON.stringify(nodes, (key, value) =>
          key === "renderState" || key === "name" ? undefined : value,
        ) !==
          JSON.stringify(after, (key, value) =>
            key === "renderState" || key === "name" ? undefined : value,
          )
      ) {
        if (attempt === 0) continue;
        throw new Error(
          "Visual targets moved during capture; no misleading numbered image was published.",
        );
      }
      const viewport = {
        x: 0,
        y: 0,
        width: frame.cssViewportWidth,
        height: frame.cssViewportHeight,
      };
      let imageRegions = 0;
      const withGrids = after.map((node) => {
        if (
          node.grid ||
          node.kind !== "region" ||
          !/^(canvas|svg)$/.test(node.role) ||
          imageRegions++ >= 8
        )
          return node;
        const grid = detectImageGrid(
          capture.imageBase64,
          viewport,
          node.bounds,
        );
        return grid ? { ...node, grid } : node;
      });
      const all = host.store.assign(scope, documentId, withGrids);
      const pageText = (await target.webContents.executeJavaScript(
        `(${READ_SURFACE_TEXT})().slice(0,1200)`,
        false,
      )) as string;
      let clip = viewport;
      if (request.region) {
        const region = host.store.region(scope, request.region);
        if (!region || !all.some((m) => m.mark === region.mark))
          throw new Error("Region is no longer visible; request an overview.");
        const b = region.bounds,
          x = Math.max(0, b.x - 18),
          y = Math.max(0, b.y - 24);
        clip = {
          x,
          y,
          width: Math.min(viewport.width, b.x + b.width + 18) - x,
          height: Math.min(viewport.height, b.y + b.height + 18) - y,
        };
        if (request.cell) {
          const g = region.grid,
            cell = request.cell;
          if (!g || cell.row > g.ys.length || cell.column > g.xs.length)
            throw new Error("Detail cell is outside the published grid");
          const cx = b.x + g.xs[cell.column - 1]! * b.width,
            cy = b.y + g.ys[cell.row - 1]! * b.height;
          const halfWidth = (g.xs[1]! - g.xs[0]!) * b.width * 2.5,
            halfHeight = (g.ys[1]! - g.ys[0]!) * b.height * 2.5;
          const x = Math.max(0, cx - halfWidth),
            y = Math.max(0, cy - halfHeight);
          clip = {
            x,
            y,
            width: Math.min(viewport.width, cx + halfWidth) - x,
            height: Math.min(viewport.height, cy + halfHeight) - y,
          };
        }
      }
      const evidence = evidenceTracker.observe(
        scope +
          "\0" +
          (browserAgentOperationContext.getStore()?.sessionId ?? "local"),
        documentId,
        frame.captureId,
        capture.imageBase64,
        viewport,
        all,
      );
      const actionChange = evidence.regions.find(
        (change) =>
          change.mark === lastAction?.mark &&
          ["changed", "unchanged"].includes(change.comparison),
      );
      const targetChanged =
        lastAction?.cell && actionChange
          ? actionChange.changedCells.some(
              (cell) =>
                cell.row === lastAction.cell!.row &&
                cell.column === lastAction.cell!.column,
            )
          : undefined;
      const visible = all
        .filter(
          (m) =>
            intersect(m.bounds, clip) &&
            (!request.highlightTargetRefs ||
              request.highlightTargetRefs.includes(m.targetRef)),
        )
        .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
      const offset = Math.max(0, Math.floor(request.offset ?? 0)),
        count = Math.max(1, Math.min(160, Math.floor(request.maxMarks ?? 80)));
      const selected =
        request.highlightTargets === false
          ? []
          : visible.slice(offset, offset + count);
      const rendered = renderVisualScene({
        imageBase64: capture.imageBase64,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        clip,
        marks: selected,
        ...(request.region ? { region: request.region } : {}),
        zoom:
          request.zoom ??
          (request.region
            ? Math.min(4, Math.max(1, 900 / Math.max(clip.width, clip.height)))
            : 1),
        changes: evidence.regions,
        ...(lastAction?.mark && lastAction.cell
          ? { focus: { mark: lastAction.mark, cell: lastAction.cell } }
          : {}),
        maxDimension:
          request.downsampleForVision === false
            ? Number.MAX_SAFE_INTEGER
            : 2000,
      });
      const visualFrame = {
        ...frame,
        imageWidth: rendered.width,
        imageHeight: rendered.height,
        imageScale: rendered.width / capture.width,
      };
      const previous = host.store.read(host.store.latest(scope), scope)?.scene;
      const scene: VisualScene = {
        lastInput:
          previous?.documentId === documentId ? previous.lastInput : undefined,
        captureId: frame.captureId,
        documentId,
        pixelHash: createHash("sha256")
          .update(capture.imageBase64)
          .digest("hex"),
        pointEvidence: {
          id: pointEvidenceId,
          png: capture.imageBase64,
          width: viewport.width,
          height: viewport.height,
        },
        marks: selected,
        clip: rendered.clip,
        imageWidth: rendered.width,
        imageHeight: rendered.height,
        totalVisible: visible.length,
        ...(offset + count < visible.length
          ? { nextOffset: offset + count }
          : {}),
      };
      host.rememberVisualFrame(tabId, target.targetMode, visualFrame);
      host.store.remember(scope, scene, visualFrame);
      return {
        ...capture,
        ...rendered,
        visualFrame,
        targetMode: target.targetMode,
        browserMode: target.browserMode,
        scene: {
          captureId: scene.captureId,
          documentKey: createHash("sha256")
            .update(documentId)
            .digest("hex")
            .slice(0, 16),
          evidence,
          coverage: {
            skippedFrames,
            meaning:
              "Skipped frames do not provide node marks. Hidden frames are not actionable; unresolved visible content can still be inspected in the image.",
          },
          lastInput: scene.lastInput,
          rendered: summarizeRenderStates(
            selected,
            request.region
              ? { region: request.region, cell: request.cell }
              : undefined,
            previous?.documentId === documentId ? previous.marks : [],
          ),
          pageText,
          view: {
            region: request.region ?? null,
            cell: request.cell ?? null,
            magnification: rendered.magnification,
          },
          ...(lastAction
            ? {
                lastAction: {
                  interaction: lastAction.interaction,
                  mark: lastAction.mark,
                  cell: lastAction.cell,
                  targetPixelsChanged:
                    targetChanged === false &&
                    actionChange &&
                    actionChange.changedCellCount >
                      actionChange.changedCells.length
                      ? undefined
                      : targetChanged,
                  meaning:
                    "Cyan outline is the last delivered input; pink outlines locate visual changes. These are observed pixels, not confirmation of task success.",
                },
              }
            : {}),
          marks: rendered.marks,
          totalVisible: visible.length,
          unmarkedCount: visible.length - selected.length,
          ...(scene.nextOffset === undefined
            ? {}
            : { nextOffset: scene.nextOffset }),
          ...(request.region ? { region: request.region } : {}),
          coordinates:
            "marks bind real nodes; grid cell={row,column} is 1-based, rows top to bottom, columns left to right. DOM grids address control centers; image-lines grids address visible line intersections (not cell centers or proof of clickability). position/path use 0..1 within a mark; point uses image pixels",
        },
      };
    }
    throw new Error("Visual capture unavailable");
  };
  return Object.assign(captureScene, {
    clear: (tabId: string) => {
      evidenceTracker.clear(tabId);
      for (const scope of revisions.keys())
        if (scope.startsWith(tabId + "\0")) revisions.delete(scope);
    },
    dispose: () => {
      evidenceTracker.dispose();
      revisions.clear();
    },
  });
};
