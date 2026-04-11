type CacheEntry<T> = {
  readonly value: T;
  readonly expiresAt: number;
};

export class ResultCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  public constructor(private readonly ttlMs: number) {}

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
    this.entries.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  clear(): void {
    this.entries.clear();
  }
}
