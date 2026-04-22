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
 * Resolve a stable client-identity string from a request for rate-limiter
 * bucketing. Mirrors the precedence used by `createDistributedRateLimiter`.
 *
 * Tries, in order: the first hop of `x-forwarded-for`, then `x-real-ip`,
 * then `socket.remoteAddress` / `connection.remoteAddress`, finally
 * `'global'` when nothing is available.
 */
export function resolveClientKey(request) {
  const headers = request?.headers || {};
  const forwarded = String(headers['x-forwarded-for'] || '').trim();
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  const real = String(headers['x-real-ip'] || '').trim();
  if (real) return real;
  const remote = request?.socket?.remoteAddress
    || request?.connection?.remoteAddress
    || '';
  if (remote) return String(remote);
  return 'global';
}

/**
 * Create a sliding-window rate limiter (in-memory, per-instance).
 *
 * Buckets are keyed by `clientKey` (IP, session, etc.), so one noisy caller
 * cannot starve every other user on the same warm instance. The number of
 * concurrently tracked keys is capped to prevent unbounded memory growth;
 * when the cap is reached the oldest-touched bucket is evicted (LRU).
 *
 * Callers that do not supply a key are lumped under the `'global'` bucket,
 * which preserves backwards compatibility with earlier single-bucket usage.
 *
 * @param {object} options
 * @param {number} options.windowMs  - Length of the sliding window in milliseconds.
 * @param {number} options.maxBurst  - Maximum number of requests allowed within the window per key.
 * @param {number} [options.maxKeys] - Max distinct keys tracked simultaneously (default 10_000).
 * @returns {{ isLimited: (clientKey?: string) => boolean, _recent: number[] }}
 */
export function createRateLimiter({ windowMs, maxBurst, maxKeys = 10_000 }) {
  // Map preserves insertion/update order, so we can evict the least-recently
  // touched key by grabbing the first entry.
  const buckets = new Map();

  function getBucket(clientKey) {
    const key = clientKey == null ? 'global' : String(clientKey);
    let recent = buckets.get(key);
    if (recent) {
      // Touch: move to end of insertion order so it becomes most-recent.
      buckets.delete(key);
      buckets.set(key, recent);
      return recent;
    }
    if (buckets.size >= maxKeys) {
      // Evict oldest (first key in insertion order).
      const oldest = buckets.keys().next().value;
      if (oldest !== undefined) buckets.delete(oldest);
    }
    recent = [];
    buckets.set(key, recent);
    return recent;
  }

  function isLimited(clientKey) {
    const recent = getBucket(clientKey);
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

  // Legacy backwards-compatible accessor: tests and older callers reach into
  // `limiter._recent` as a plain array. Expose the `'global'` bucket via a
  // getter so mutations such as `_recent.length = 0` still work.
  return {
    isLimited,
    get _recent() {
      return getBucket('global');
    }
  };
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
    return { isLimited: async (clientKey) => mem.isLimited(clientKey) };
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
