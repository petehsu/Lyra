import type {
  DownloadManagerPriority,
  DownloadManagerTask
} from "../../shared/download-manager";

const DOWNLOAD_PRIORITY_RANK: Readonly<Record<DownloadManagerPriority, number>> = {
  high: 0,
  normal: 1,
  low: 2
};

export const compareDownloadQueueTasks = (
  left: DownloadManagerTask,
  right: DownloadManagerTask
): number => {
  const priorityDelta =
    DOWNLOAD_PRIORITY_RANK[left.priority] - DOWNLOAD_PRIORITY_RANK[right.priority];
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  const createdAtDelta = left.createdAt.localeCompare(right.createdAt);
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }
  return left.id.localeCompare(right.id);
};

export const sortDownloadQueueTaskIds = (
  taskIds: readonly string[],
  tasks: ReadonlyMap<string, DownloadManagerTask>
): readonly string[] =>
  [...taskIds].sort((leftId, rightId) => {
    const left = tasks.get(leftId);
    const right = tasks.get(rightId);
    if (left === undefined && right === undefined) {
      return leftId.localeCompare(rightId);
    }
    if (left === undefined) {
      return 1;
    }
    if (right === undefined) {
      return -1;
    }
    return compareDownloadQueueTasks(left, right);
  });
