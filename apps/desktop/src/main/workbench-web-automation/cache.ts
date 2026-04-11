import type { WorkbenchWebGraphSnapshot } from "./types";

type CacheEntry<T> = {
  readonly value: T;
  readonly expiresAt: number;
};

class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  public constructor(private readonly ttlMs: number) {}

  public read(key: string): T | null {
    const current = this.entries.get(key);
    if (current === undefined) {
      return null;
    }
    if (current.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return current.value;
  }

  public write(key: string, value: T): void {
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  public remove(key: string): void {
    this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }
}

export class WorkbenchWebAutomationCache {
  public readonly graphByTab = new TtlCache<WorkbenchWebGraphSnapshot>(1_200);
  public readonly graphById = new TtlCache<WorkbenchWebGraphSnapshot>(1_200);

  public clear(): void {
    this.graphByTab.clear();
    this.graphById.clear();
  }
}
