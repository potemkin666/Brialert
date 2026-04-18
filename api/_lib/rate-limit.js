/**
 * Shared sliding-window rate limiter for Vercel serverless functions.
 *
 * IMPORTANT: This is a per-instance, best-effort rate limiter. On Vercel's
 * serverless model each cold start creates a new function instance with fresh
 * state, and multiple concurrent instances each maintain their own window.
 * This means the limiter only protects against burst abuse hitting the *same*
 * warm instance — it does NOT provide a global, distributed rate limit.
 *
 * For production-grade distributed rate limiting, consider Vercel KV, Upstash
 * Redis, or a similar external store.
 *
 * @module rate-limit
 */

/**
 * Create a sliding-window rate limiter.
 *
 * @param {object} options
 * @param {number} options.windowMs  - Length of the sliding window in milliseconds.
 * @param {number} options.maxBurst  - Maximum number of requests allowed within the window.
 * @returns {{ isLimited: () => boolean, _recent: number[] }}
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
