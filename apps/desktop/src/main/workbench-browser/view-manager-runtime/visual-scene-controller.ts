import { createVisualSceneStore } from "./visual-scene-store";
import { createVisualSceneCapture } from "./visual-scene-capture";
import { createStructureScene } from "./visual-structure-scene";
import {
  resolveVisualAnchors,
  visualInputEndpoint,
} from "./visual-scene-anchor";
import { createVisualSceneActions } from "./visual-scene-actions";
import type { VisualActRequest, VisualSeeRequest } from "./visual-scene-types";
import { settleSceneAnimations } from "./visual-animation-settle";
import { settleVisualGrid } from "./visual-grid-settle";
import {
  prepareSceneWait,
  validateSceneCondition,
} from "./scene-observation-wait";

type Host = Omit<
  Parameters<typeof createVisualSceneCapture>[0] &
    Parameters<typeof createVisualSceneActions>[0],
  "store"
>;
export const createVisualSceneController = (host: Host) => {
  const store = createVisualSceneStore();
  const capture = createVisualSceneCapture({ ...host, store });
  const act = createVisualSceneActions({ ...host, store });
  const describe = createStructureScene({ ...host, store });
  const busy = new Set<string>();
  const exclusive = async <T>(tabId: string, run: () => Promise<T>) => {
    if (busy.has(tabId))
      throw new Error(
        "A visual observation/action is already in flight for this tab. Wait for its result.",
      );
    busy.add(tabId);
    try {
      return await run();
    } finally {
      busy.delete(tabId);
    }
  };
  return {
    describe: (tabId: string, request?: VisualSeeRequest) =>
      exclusive(tabId, () => describe(tabId, request)),
    capture: (tabId: string, request?: VisualSeeRequest) =>
      exclusive(tabId, () => capture(tabId, request)),
    act: (tabId: string, request: VisualActRequest) =>
      exclusive(tabId, async () => {
        if (
          request.settleTimeoutMs !== undefined &&
          (!Number.isInteger(request.settleTimeoutMs) ||
            request.settleTimeoutMs < 0 ||
            request.settleTimeoutMs > 2000)
        )
          throw new Error("settleTimeoutMs must be an integer from 0 to 2000");
        const scope = tabId + "\0" + (request.targetMode ?? "live");
        const originalSteps = request.steps ?? [
          { ...request, interaction: request.interaction ?? "click" },
        ];
        if (!request.captureId) {
          if (originalSteps.some((s) => s.point || s.to || (!s.mark && s.path)))
            throw new Error(
              "Raw image coordinates require an explicit captureId",
            );
          request = { ...request, captureId: store.latest(scope) };
        }
        const record = store.read(request.captureId, scope);
        if (record)
          request = {
            ...request,
            steps: resolveVisualAnchors(
              originalSteps as import("./visual-scene-types").VisualStep[],
              record.scene,
            ),
          };
        const steps = request.steps ?? originalSteps;
        validateSceneCondition(request.after, record?.scene.marks ?? []);
        if (request.after && request.observe === "none")
          throw new Error("after requires an observation");
        const last = steps.at(-1);
        const region = last?.cell
          ? store
              .read(
                request.captureId,
                tabId + "\0" + (request.targetMode ?? "live"),
              )
              ?.scene.marks.find(
                (mark) => mark.mark === last.mark?.toLowerCase(),
              )
          : undefined;
        const structureMode =
          request.observe === "structure" ||
          ((request.observe === undefined || request.observe === "auto") &&
            record &&
            !record.scene.pixelHash);
        const waitMark = request.after?.mark
          ? record?.scene.marks.find(
              (m) => m.mark === request.after!.mark!.toLowerCase(),
            )
          : request.after
            ? undefined
            : region;
        const wait =
          record &&
          (request.after ||
            (structureMode && region && request.settleTimeoutMs !== 0))
            ? await prepareSceneWait(host, tabId, request, waitMark)
            : undefined;
        let result = await act(tabId, request);
        if (wait && result.ok === true) {
          try {
            result = { ...result, observationWait: await wait() };
          } catch (error) {
            result = {
              ...result,
              observationError: String(error),
              observationWait: { status: "unavailable", completion: "unknown" },
            };
          }
        }
        const deliveredCount =
          typeof result.completed === "number" ? result.completed : 0;
        const delivered = steps
          .slice(0, deliveredCount)
          .filter((s) =>
            ["click", "doubleClick", "rightClick", "drag"].includes(
              s.interaction ?? "click",
            ),
          )
          .at(-1);
        const lastInput = delivered
          ? visualInputEndpoint(
              delivered as import("./visual-scene-types").VisualStep,
            )
          : undefined;
        if (lastInput && record)
          store.noteInput(record.scene.captureId, scope, lastInput);
        if (structureMode) {
          try {
            const observation = await describe(tabId, {
              targetMode: request.targetMode ?? "live",
            });
            if (!observation) {
              const page = await host.observe(tabId, {
                targetMode: request.targetMode ?? "live",
                strategy: "interactiveOnly",
                suppressActivity: true,
              });
              return {
                ...result,
                mapAppendix: page.mapAppendix,
                nextRecommendedAction:
                  "The rendered region is gone. Use the returned semantic map; do not repeat delivered input.",
              };
            }
            return {
              ...result,
              observation,
              nextRecommendedAction:
                "Use the returned rendered state; call see only for facts that require pixels.",
            };
          } catch (error) {
            return {
              ...result,
              observationError: String(error),
              nextRecommendedAction:
                "Read current state without repeating delivered input.",
            };
          }
        }
        const autoImage =
          result.needsImage === true ||
          steps.some((s) =>
            [
              "hover",
              "scroll",
              "drag",
              "click",
              "doubleClick",
              "rightClick",
            ].includes(s.interaction ?? "click"),
          );
        if (
          request.observe === "image" ||
          (request.observe !== "none" && autoImage)
        ) {
          try {
            const observationWait =
              result.ok === true &&
              !wait &&
              region &&
              (request.settleTimeoutMs ?? 900) > 0
                ? await settleVisualGrid(
                    host,
                    tabId,
                    request.targetMode ?? "live",
                    region,
                    request.settleTimeoutMs ?? 900,
                  )
                : result.ok === true &&
                    !wait &&
                    (request.settleTimeoutMs ?? 250) > 0
                  ? await settleSceneAnimations(
                      host,
                      tabId,
                      request.targetMode ?? "live",
                      Math.min(request.settleTimeoutMs ?? 250, 250),
                    )
                  : undefined;
            const observation = await capture(
              tabId,
              {
                targetMode: request.targetMode ?? "live",
                ...(result.ok === true && region
                  ? { region: region.mark }
                  : {}),
              },
              result.ok === true
                ? {
                    ...last!,
                    interaction:
                      last?.interaction === "sequence" ||
                      last?.interaction === undefined
                        ? "click"
                        : last.interaction,
                  }
                : undefined,
            );
            return {
              ...result,
              observation,
              ...(observationWait ? { observationWait } : {}),
              nextRecommendedAction:
                "Use the attached current image and its captureId; no additional see call is needed.",
            };
          } catch (error) {
            // A capture failure must never turn a delivered click into a retryable transport error.
            return {
              ...result,
              observationError: String(error),
              nextRecommendedAction:
                "Observe the current page without repeating delivered input.",
            };
          }
        }
        return result;
      }),
    clear: (tabId: string) => {
      store.clear(tabId);
      capture.clear(tabId);
    },
    dispose: () => {
      store.dispose();
      capture.dispose();
    },
  };
};
