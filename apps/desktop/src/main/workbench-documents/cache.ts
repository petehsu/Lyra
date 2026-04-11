class TtlCache<T> {
  private readonly entries = new Map<string, { readonly value: T; readonly expiresAt: number }>();

  public constructor(private readonly ttlMs: number, private readonly maxEntries: number) {}

  read(key: string): T | null {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  write(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    if (this.entries.size <= this.maxEntries) {
      return;
    }
    const oldestKey = this.entries.keys().next().value;
    if (typeof oldestKey === "string") {
      this.entries.delete(oldestKey);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

export class WorkbenchDocumentsCache {
  readonly candidates = new TtlCache<readonly unknown[]>(750, 32);
  readonly bytes = new TtlCache<unknown>(30_000, 8);
  readonly parsed = new TtlCache<unknown>(5 * 60_000, 16);

  clear(): void {
    this.candidates.clear();
    this.bytes.clear();
    this.parsed.clear();
  }
}
