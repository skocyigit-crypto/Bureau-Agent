export type TenantIdentity = {
  organisationId: number | null;
  role: string;
  actif: boolean;
};

type Entry = { value: TenantIdentity | null; expiresAt: number };

/**
 * Small, bounded authorization cache. Concurrent requests for the same user
 * share one database lookup instead of exhausting the connection pool during
 * dashboard startup.
 */
export class TenantIdentityCache {
  private readonly entries = new Map<number, Entry>();
  private readonly pending = new Map<number, Promise<TenantIdentity | null>>();
  private readonly generations = new Map<number, number>();

  constructor(
    private readonly ttlMs = 5_000,
    private readonly maxEntries = 2_000,
  ) {}

  async get(userId: number, loader: () => Promise<TenantIdentity | null>): Promise<TenantIdentity | null> {
    const now = Date.now();
    const cached = this.entries.get(userId);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) this.entries.delete(userId);

    const inFlight = this.pending.get(userId);
    if (inFlight) return inFlight;

    const promise = loader()
      .then((value) => {
        if (this.entries.size >= this.maxEntries) {
          const oldestKey = this.entries.keys().next().value;
          if (oldestKey !== undefined) this.entries.delete(oldestKey);
        }
        this.entries.set(userId, { value, expiresAt: Date.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.pending.delete(userId));

    this.pending.set(userId, promise);
    return promise;
  }

  invalidate(userId: number): void {
    this.entries.delete(userId);
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }
}