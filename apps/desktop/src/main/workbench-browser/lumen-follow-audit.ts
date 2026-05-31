import type {
  WorkbenchLumenActivityAction,
  WorkbenchLumenFollowAction,
  WorkbenchLumenFollowAudit
} from "../../shared/workbench-browser";

type CompactFollowSessionInput = {
  readonly actions: readonly WorkbenchLumenFollowAction[];
  readonly interruptedCount: number;
  readonly finalPageState?: WorkbenchLumenFollowAudit["finalPageState"];
};

type CompactFollowSessionResult = Pick<
  WorkbenchLumenFollowAudit,
  "actions" | "compactSummary" | "compactText" | "chunks"
>;

const DEFAULT_MAX_FOLLOW_ACTIONS = 80;
const MAX_COMPACT_FOLLOW_ACTIONS = 400;
const FOLLOW_ACTIONS_PER_CHUNK = 40;

const actionCount = (
  actions: readonly WorkbenchLumenFollowAction[],
  action: WorkbenchLumenActivityAction
): number => actions.filter((entry) => entry.action === action).length;

const formatFinalPageState = (
  finalPageState: WorkbenchLumenFollowAudit["finalPageState"] | undefined
): string | null => {
  if (finalPageState === undefined || finalPageState === null) {
    return null;
  }
  const title = finalPageState.title.trim();
  const label = title.length === 0 ? finalPageState.address : `${title} (${finalPageState.address})`;
  return `Final page: ${label}${finalPageState.isLoading ? " loading" : ""}.`;
};

export const compactFollowSession = (
  session: CompactFollowSessionInput | null,
  request?: {
    readonly maxActions?: number;
  }
): CompactFollowSessionResult => {
  const maxActions = Math.max(
    1,
    Math.min(MAX_COMPACT_FOLLOW_ACTIONS, Math.round(request?.maxActions ?? DEFAULT_MAX_FOLLOW_ACTIONS))
  );
  const allActions = session?.actions ?? [];
  const actions = allActions.slice(-maxActions);
  const chunks = actions.length === 0
    ? []
    : Array.from({ length: Math.ceil(actions.length / FOLLOW_ACTIONS_PER_CHUNK) }, (_value, index) => {
        const slice = actions.slice(
          index * FOLLOW_ACTIONS_PER_CHUNK,
          index * FOLLOW_ACTIONS_PER_CHUNK + FOLLOW_ACTIONS_PER_CHUNK
        );
        return {
          index,
          actionStart: index * FOLLOW_ACTIONS_PER_CHUNK + 1,
          actionEnd: index * FOLLOW_ACTIONS_PER_CHUNK + slice.length,
          summary: slice.map((entry) => entry.summary).join(" -> ")
        };
      });
  const actionText = actions.length === 0
    ? "No Follow actions recorded for this browser target."
    : chunks.map((chunk) => `#${chunk.index + 1} ${chunk.summary}`).join("\n");
  const finalPageText = formatFinalPageState(session?.finalPageState);
  const compactText = finalPageText === null ? actionText : `${actionText}\n${finalPageText}`;
  return {
    actions,
    compactSummary: {
      observeCount: actionCount(allActions, "observe"),
      readCount: actionCount(allActions, "read"),
      captureCount: actionCount(allActions, "capture"),
      waitCount: actionCount(allActions, "wait"),
      navigationCount: actionCount(allActions, "navigate"),
      focusCount: actionCount(allActions, "focus"),
      pointerCount: actionCount(allActions, "act"),
      typeCount: actionCount(allActions, "type"),
      keyCount: actionCount(allActions, "press"),
      revealCount: actionCount(allActions, "reveal"),
      elevateCount: actionCount(allActions, "elevate"),
      interruptedCount: session?.interruptedCount ?? 0
    },
    compactText,
    chunks
  };
};
