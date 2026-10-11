// Fixed-window counters. The interface (async consume) lets a Redis store replace this one
// without touching callers. Keys may contain client IPs: they live only in memory, never logged.

class MemoryRateLimitStore {
  constructor({ now = () => Date.now(), sweepEveryMs = 60_000 } = {}) {
    this.now = now;
    this.windows = new Map(); // key -> { count, resetAt }
    this.timer = setInterval(() => this.sweep(), sweepEveryMs);
    this.timer.unref();
  }

  sweep() {
    const now = this.now();
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
  }

  /**
   * Adds `cost` to every bucket only if all of them stay within their limit (all-or-nothing,
   * so a rejected request doesn't eat into the other buckets).
   * @param {{ key: string, limit: number, windowMs: number }[]} buckets
   * @returns {Promise<{ allowed: boolean, retryAfter: number }>} retryAfter in whole seconds
   */
  async consume(buckets, cost = 1) {
    const now = this.now();
    const current = buckets.map((b) => {
      let w = this.windows.get(b.key);
      if (!w || w.resetAt <= now) w = { count: 0, resetAt: now + b.windowMs };
      return { b, w };
    });
    const blocked = current.filter(({ b, w }) => w.count + cost > b.limit);
    if (blocked.length > 0) {
      const waitMs = Math.max(...blocked.map(({ w }) => w.resetAt - now));
      return { allowed: false, retryAfter: Math.max(1, Math.ceil(waitMs / 1000)) };
    }
    for (const { b, w } of current) {
      w.count += cost;
      this.windows.set(b.key, w);
    }
    return { allowed: true, retryAfter: 0 };
  }

  close() {
    clearInterval(this.timer);
  }
}

module.exports = { MemoryRateLimitStore };
