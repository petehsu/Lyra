// ─── 脏行追踪 ───────────────────────────────────────────────────────────────
// 记录哪些行发生了内容变更，render strategy 据此做增量更新。
// FullFile 策略: dirty 行 → 重新光栅化 → 重新上传 atlas → 重新构建 instance buffer
// Viewport 策略: dirty 行 → 下一帧重新构建视口内 instance buffer

export type DirtyRange = {
  readonly startLine: number;
  readonly endLine: number; // inclusive
};

export type BufferDirtyTracker = {
  readonly markDirty: (startLine: number, endLine: number) => void;
  readonly markAllDirty: () => void;
  readonly consumeDirtyRanges: () => readonly DirtyRange[];
  readonly isFullyDirty: () => boolean;
  readonly clear: () => void;
};

export const createBufferDirtyTracker = (): BufferDirtyTracker => {
  let fullyDirty = true;
  let ranges: DirtyRange[] = [];

  const markDirty = (startLine: number, endLine: number): void => {
    if (startLine > endLine) {
      return;
    }
    // ponytail: 合并相邻 range 的 O(n) 扫描。
    // 升级路径: 如果 range 数量超过阈值，直接设 fullyDirty=true。
    if (ranges.length > 64) {
      fullyDirty = true;
      ranges = [];
      return;
    }
    ranges.push({ startLine, endLine });
  };

  const markAllDirty = (): void => {
    fullyDirty = true;
    ranges = [];
  };

  const consumeDirtyRanges = (): readonly DirtyRange[] => {
    if (fullyDirty) {
      return [];
    }
    const result = ranges;
    ranges = [];
    return result;
  };

  const isFullyDirty = (): boolean => fullyDirty;

  const clear = (): void => {
    fullyDirty = false;
    ranges = [];
  };

  return { markDirty, markAllDirty, consumeDirtyRanges, isFullyDirty, clear };
};