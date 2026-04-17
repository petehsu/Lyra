import type { WorkbenchWebFocusAtlas } from "../../../shared/workbench-web-automation";

type FocusAtlasEntry = {
  readonly atlas: WorkbenchWebFocusAtlas;
  readonly diagnostics: {
    readonly durationMs: number;
    readonly candidateCount: number;
    readonly widgetCount: number;
  };
  readonly preferredScanSessionId?: string;
  readonly updatedAt: number;
};

export class FocusAtlasRegistry {
  private readonly entries = new Map<string, FocusAtlasEntry>();

  public constructor(private readonly ttlMs: number = 2_500) {}

  public read(tabId: string): FocusAtlasEntry | null {
    const current = this.entries.get(tabId);
    if (current === undefined) {
      return null;
    }
    if (current.updatedAt + this.ttlMs <= Date.now()) {
      this.entries.delete(tabId);
      return null;
    }
    return current;
  }

  public write(tabId: string, entry: Omit<FocusAtlasEntry, "updatedAt">): FocusAtlasEntry {
    const next: FocusAtlasEntry = {
      ...entry,
      updatedAt: Date.now()
    };
    this.entries.set(tabId, next);
    return next;
  }

  public isFresh(tabId: string, maxAgeMs: number): boolean {
    const current = this.entries.get(tabId);
    if (current === undefined) {
      return false;
    }
    return Date.now() - current.updatedAt <= maxAgeMs;
  }

  public invalidate(tabId: string): void {
    this.entries.delete(tabId);
  }

  public clear(): void {
    this.entries.clear();
  }
}
