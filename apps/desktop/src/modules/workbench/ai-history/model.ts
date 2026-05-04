import type {
  AgentMessage,
  AgentSessionDetail
} from "../ai-panel/agent-ui-types";
import type { StatusTone } from "../ai-panel/status-primitives";

export type JsonRecord = Record<string, unknown>;

export type LyraThreadSummary = {
  readonly id: string;
  readonly name: string | null;
  readonly preview: string;
  readonly updatedAt: number | null;
  readonly modelProvider: string | null;
  readonly boundProjectRoot: string | null;
};

export type HistoryScope = "global" | "project" | "archivedGlobal" | "archivedProject";

export type ProjectGroup = {
  readonly projectRoot: string;
  readonly displayName: string;
  readonly threads: readonly LyraThreadSummary[];
};

export type LivePreviewEntry = {
  readonly threadId: string;
  readonly turnId: string;
  readonly text: string;
  readonly updatedAt: number;
};

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const readPath = (value: unknown): string | null => {
  const direct = readString(value);
  if (direct !== null) {
    return direct;
  }
  if (isRecord(value)) {
    return readString(value.path) ?? readString(value.display);
  }
  return null;
};

export const normalizeProjectRoot = (value: string): string =>
  value.replace(/\\/g, "/").replace(/\/+$/g, "");

export const projectDisplayName = (projectRoot: string): string => {
  const normalized = normalizeProjectRoot(projectRoot);
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.at(-1) ?? normalized;
};

export const createAiHistoryRequestPayload = (
  method: string,
  params: JsonRecord
): Readonly<Record<string, unknown>> => ({
  method,
  params
});

export const toThreadSummary = (value: unknown): LyraThreadSummary | null => {
  if (!isRecord(value)) {
    return null;
  }
  const id = readString(value.id);
  if (id === null) {
    return null;
  }
  const rawUpdatedAt = readNumber(value.updatedAt);
  return {
    id,
    name: readString(value.name),
    preview: readString(value.preview) ?? "",
    updatedAt:
      rawUpdatedAt === null
        ? null
        : rawUpdatedAt < 10_000_000_000
          ? rawUpdatedAt * 1000
          : rawUpdatedAt,
    modelProvider: readString(value.modelProvider),
    boundProjectRoot: readPath(value.boundProjectRoot)
  };
};

export const formatSessionTime = (timestampMs: number, locale: string): string => {
  try {
    return new Date(timestampMs).toLocaleString(locale);
  } catch (_error) {
    return String(timestampMs);
  }
};

export const sortThreadsByRecency = (
  threads: readonly LyraThreadSummary[]
): readonly LyraThreadSummary[] =>
  [...threads].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));

export const groupThreadsByProject = (
  threads: readonly LyraThreadSummary[]
): readonly ProjectGroup[] => {
  const buckets = new Map<string, LyraThreadSummary[]>();
  for (const thread of threads) {
    if (thread.boundProjectRoot === null) {
      continue;
    }
    const key = normalizeProjectRoot(thread.boundProjectRoot);
    if (key.length === 0) {
      continue;
    }
    const existing = buckets.get(key);
    if (existing === undefined) {
      buckets.set(key, [thread]);
    } else {
      existing.push(thread);
    }
  }
  const groups: ProjectGroup[] = [];
  for (const [projectRoot, bucket] of buckets) {
    groups.push({
      projectRoot,
      displayName: projectDisplayName(projectRoot),
      threads: sortThreadsByRecency(bucket)
    });
  }
  return groups.sort((left, right) => {
    const leftLatest = left.threads[0]?.updatedAt ?? 0;
    const rightLatest = right.threads[0]?.updatedAt ?? 0;
    return rightLatest - leftLatest;
  });
};

export const isArchivedHistoryScope = (scope: HistoryScope): boolean =>
  scope === "archivedGlobal" || scope === "archivedProject";

export const isProjectHistoryScope = (scope: HistoryScope): boolean =>
  scope === "project" || scope === "archivedProject";

export const resolveThreadPreviewText = (
  thread: LyraThreadSummary,
  emptyLabel: string
): string =>
  thread.name?.trim() || thread.preview.trim() || emptyLabel;

export const resolveThreadRowTone = ({
  activeThreadId,
  firstThreadId,
  threadId
}: {
  readonly activeThreadId: string | null;
  readonly firstThreadId: string | null;
  readonly threadId: string;
}): StatusTone =>
  activeThreadId === threadId
    ? "success"
    : firstThreadId === threadId
      ? "info"
      : "muted";

export const buildPreviewDisplayMessages = (
  previewDetail: AgentSessionDetail,
  livePreview: LivePreviewEntry | null
): readonly AgentMessage[] => {
  const sortedMessages = [...previewDetail.messages].sort(
    (left, right) => left.createdAt - right.createdAt
  );
  const hasPersistedLivePreview =
    livePreview !== null
    && sortedMessages.some(
      (message) => message.role === "assistant" && message.turnId === livePreview.turnId
    );
  if (livePreview === null || livePreview.text.trim().length === 0 || hasPersistedLivePreview) {
    return sortedMessages;
  }
  return [
    ...sortedMessages,
    {
      id: `live-preview:${livePreview.threadId}:${livePreview.turnId}`,
      sessionId: livePreview.threadId,
      turnId: livePreview.turnId,
      role: "assistant",
      content: livePreview.text,
      displayContent: livePreview.text,
      createdAt: livePreview.updatedAt
    }
  ];
};

export const createPreviewThreadSummary = (
  previewDetail: AgentSessionDetail
): LyraThreadSummary => ({
  id: previewDetail.session.id,
  name: previewDetail.session.title,
  preview: "",
  updatedAt: previewDetail.session.updatedAt,
  modelProvider: null,
  boundProjectRoot: previewDetail.session.projectRoot ?? null
});
