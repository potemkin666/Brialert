/**
 * Shared sliding-window rate limiter for Vercel serverless functions.
 *
 * Two implementations are available:
 *
 * 1. **In-memory** (`createRateLimiter`) — per-instance, best-effort limiter.
 *    On Vercel each cold start creates a new function instance with fresh state
 *    so this only protects against burst abuse hitting the *same* warm instance.
 *
 * 2. **Distributed** (`createDistributedRateLimiter`) — uses an external
 *    key-value store (Vercel KV / Upstash Redis) for globally consistent
 *    sliding-window rate limiting across all instances.  Falls back to the
 *    in-memory limiter automatically when no KV store is configured.
 *
 * @module rate-limit
 */

/**
 * Create a sliding-window rate limiter (in-memory, per-instance).
 *
 * @param {object} options
 * @param {number} options.windowMs  - Length of the sliding window in milliseconds.
 * @param {number} options.maxBurst  - Maximum number of requests allowed within the window.
 * @returns {{ isLimited: () => boolean | Promise<boolean>, _recent: number[] }}
 */
export function createRateLimiter({ windowMs, maxBurst }) {
  const recent = [];

  function isLimited() {
    const now = Date.now();
    while (recent.length > 0 && now - recent[0] > windowMs) {
      recent.shift();
    }
    if (recent.length >= maxBurst) {
      return true;
    }
    recent.push(now);
    return false;
  }

  return { isLimited, _recent: recent };
}

/**
 * Resolve the KV / Redis store from the environment.
 *
 * Checks (in order):
 *  - `options.kvStore` (explicit injection for testing)
 *  - `globalThis.process.env.KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel KV / Upstash REST)
 *
 * @returns {{ get: Function, set: Function } | null}
 */
function resolveKvStore(options) {
  if (options?.kvStore) return options.kvStore;

  const kvUrl = (typeof process !== 'undefined' && process.env?.KV_REST_API_URL) || '';
  const kvToken = (typeof process !== 'undefined' && process.env?.KV_REST_API_TOKEN) || '';
  if (!kvUrl || !kvToken) return null;

  return {
    async get(key) {
      const response = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${kvToken}` }
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data?.result ?? null;
    },
    async set(key, value, opts) {
      const params = [`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`];
      const qs = opts?.ex ? `?EX=${opts.ex}` : '';
      await fetch(`${params[0]}${qs}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${kvToken}` }
      });
    }
  };
}

/**
 * Create a distributed sliding-window rate limiter backed by an external
 * key-value store.  Falls back to in-memory when no KV store is available.
 *
 * @param {object} options
 * @param {string}  options.keyPrefix  - Key prefix for the KV store.
 * @param {number}  options.windowMs   - Sliding window length in ms.
 * @param {number}  options.maxBurst   - Max requests per window.
 * @param {object} [options.kvStore]   - Optional injected KV store for testing.
 * @returns {{ isLimited: (clientKey?: string) => Promise<boolean> }}
 */
export function createDistributedRateLimiter({ keyPrefix, windowMs, maxBurst, kvStore: injectedKvStore } = {}) {
  const kv = resolveKvStore({ kvStore: injectedKvStore });

  // Fall back to in-memory when no KV store is configured.
  if (!kv) {
    const mem = createRateLimiter({ windowMs, maxBurst });
    return { isLimited: async () => mem.isLimited() };
  }

  async function isLimited(clientKey = 'global') {
    const key = `${keyPrefix || 'rl'}:${clientKey}`;
    const ttlSeconds = Math.ceil(windowMs / 1000) + 1;
    try {
      const raw = await kv.get(key);
      const timestamps = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : []);
      const now = Date.now();
      const recent = timestamps.filter((ts) => now - ts <= windowMs);
      if (recent.length >= maxBurst) return true;
      recent.push(now);
      await kv.set(key, recent, { ex: ttlSeconds });
      return false;
    } catch {
      // If KV is unavailable, fail open so legitimate traffic isn't blocked.
      return false;
    }
  }

  return { isLimited };
}

/**
 * Create a cooldown-style rate limiter that enforces a minimum interval
 * between successive allowed requests (e.g. one trigger per 60 s).
 *
 * @param {object} options
 * @param {number} options.intervalMs - Minimum milliseconds between allowed requests.
 * @returns {{ isLimited: () => { limited: boolean, retryAfterSeconds?: number } }}
 */
export function createCooldownLimiter({ intervalMs }) {
  let lastAllowedTime = 0;

  function isLimited() {
    const now = Date.now();
    const elapsed = now - lastAllowedTime;
    if (elapsed < intervalMs) {
      return {
        limited: true,
        retryAfterSeconds: Math.ceil((intervalMs - elapsed) / 1000)
      };
    }
    lastAllowedTime = now;
    return { limited: false };
  }

  return { isLimited };
}
