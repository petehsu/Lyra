import { createHash } from "node:crypto";
import {
  collectSceneNodes,
  type VisualCaptureHost,
} from "./visual-scene-capture";
import { VISUAL_DOCUMENT } from "./visual-scene-dom";
import { READ_SURFACE_TEXT } from "./surface-text";
import { summarizeRenderStates } from "./visual-render-state";
import type { VisualScene, VisualSeeRequest } from "./visual-scene-types";

/** Same real-node scene as see, without capturing, encoding or sending pixels. */
export const createStructureScene =
  (host: VisualCaptureHost) =>
  async (tabId: string, request: VisualSeeRequest = {}) => {
    const target = await host.resolveBrowserAgentTarget(
      tabId,
      request,
      undefined,
    );
    const scope = tabId + "\0" + target.targetMode;
    if (!host.stateStore.readBrowserAgentCacheEntry(tabId, target.targetMode))
      await host.observe(tabId, {
        targetMode: target.targetMode,
        strategy: "interactiveOnly",
        suppressActivity: true,
      });
    const documentId = (await target.webContents.executeJavaScript(
      VISUAL_DOCUMENT,
      false,
    )) as string;
    const { nodes, skippedFrames } = await collectSceneNodes(
      host,
      tabId,
      target,
    );
    if (!nodes.some((n) => n.kind === "region")) return null;
    const dimensions = await target.webContents.executeJavaScript(
      "({width:innerWidth,height:innerHeight})",
      false,
    );
    const frame = await host.createVisualFrame({
      tabId,
      target,
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
    });
    if (
      documentId !==
      (await target.webContents.executeJavaScript(VISUAL_DOCUMENT, false))
    )
      throw new Error("Document changed while observing its structure");
    const all = host.store.assign(scope, documentId, nodes);
    const count = Math.max(
        1,
        Math.min(160, Math.floor(request.maxMarks ?? 80)),
      ),
      offset = Math.max(0, Math.floor(request.offset ?? 0));
    // Prefer complete structures; all other nodes remain in the ordinary map index.
    const ordered = [...all].sort(
      (a, b) =>
        Number(b.kind === "region") - Number(a.kind === "region") ||
        a.bounds.y - b.bounds.y ||
        a.bounds.x - b.bounds.x,
    );
    const selected = request.region
      ? ordered.filter((m) => m.mark === request.region!.toLowerCase())
      : ordered.slice(offset, offset + count);
    if (request.region && !selected.length)
      throw new Error("Region is no longer visible; request a scene overview");
    if (request.cell) {
      const grid = selected.find(
        (m) => m.mark === request.region?.toLowerCase(),
      )?.grid;
      if (
        !grid ||
        !Number.isInteger(request.cell.row) ||
        !Number.isInteger(request.cell.column) ||
        request.cell.row < 1 ||
        request.cell.column < 1 ||
        request.cell.row > grid.ys.length ||
        request.cell.column > grid.xs.length
      )
        throw new Error("Detail cell is outside an observed region");
    }
    const previous = host.store.read(host.store.latest(scope), scope)?.scene;
    const scene: VisualScene = {
      captureId: frame.captureId,
      documentId,
      marks: selected,
      clip: { x: 0, y: 0, ...dimensions },
      imageWidth: dimensions.width,
      imageHeight: dimensions.height,
      totalVisible: all.length,
      lastInput:
        previous?.documentId === documentId ? previous.lastInput : undefined,
      ...(offset + count < all.length ? { nextOffset: offset + count } : {}),
    };
    const pageText = await target.webContents.executeJavaScript(
      `(${READ_SURFACE_TEXT})().slice(0,1200)`,
      false,
    );
    host.store.remember(scope, scene, frame);
    return {
      targetMode: target.targetMode,
      // Internal presentation hints only. Never remove registry entries or query results.
      groupedTargetRefs: selected.flatMap(
        (m) =>
          m.grid?.cells?.filter((c) => !c.name).map((c) => c.targetRef) ?? [],
      ),
      scene: {
        captureId: scene.captureId,
        observationKind: "structure",
        view: { region: request.region ?? null, cell: request.cell ?? null },
        coverage: {
          skippedFrames,
          meaning:
            "Skipped frames are not represented by this structure; use an image for unresolved visible frame content.",
        },
        documentKey: createHash("sha256")
          .update(documentId)
          .digest("hex")
          .slice(0, 16),
        evidence: {
          basis: "rendered-dom-sample",
          fingerprint: createHash("sha256")
            .update(
              JSON.stringify([
                documentId,
                pageText,
                selected.map((m) => [
                  m.targetRef,
                  m.bounds,
                  m.renderState,
                  m.grid?.cells?.map((c) => [c.targetRef, c.renderState]),
                ]),
              ]),
            )
            .digest("hex"),
        },
        totalVisible: all.length,
        unmarkedCount: all.length - selected.length,
        ...(scene.nextOffset !== undefined
          ? { nextOffset: scene.nextOffset }
          : {}),
        marks: selected.map((m) => ({
          mark: m.mark,
          kind: m.kind,
          role: m.role,
          bounds: m.bounds,
          disabled: m.disabled,
          ...(m.interactionEvidence
            ? { interactionEvidence: m.interactionEvidence }
            : {}),
          ...(m.grid
            ? {
                grid: {
                  source: m.grid.source,
                  rows: m.grid.ys.length,
                  columns: m.grid.xs.length,
                  points: m.grid.xs.length * m.grid.ys.length,
                },
              }
            : {}),
        })),
        rendered: summarizeRenderStates(
          selected,
          request.region
            ? { region: request.region, cell: request.cell }
            : undefined,
          previous?.documentId === documentId ? previous.marks : [],
        ),
        pageText,
        lastInput: scene.lastInput,
        coordinates:
          "Structure observation, no screenshot coordinates. Use mark, cell or at (center, lastInput, or a cell + direction). No captureId needed for marked input in this task. Canvas internals are unknown; see returns pixels. All original targetRefs remain queryable in map.",
      },
    };
  };
