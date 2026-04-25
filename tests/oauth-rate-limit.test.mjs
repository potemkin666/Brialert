import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRateLimiter,
  createCooldownLimiter,
  resolveClientKey
} from '../api/_lib/rate-limit.js';

// ── Sliding-window rate limiter ─────────────────────────────────────

describe('createRateLimiter', () => {
  it('allows requests under the burst limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxBurst: 10 });
    for (let i = 0; i < 10; i++) {
      assert.equal(limiter.isLimited(), false, `request ${i + 1} should be allowed`);
    }
  });

  it('blocks the request that exceeds the burst limit', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxBurst: 10 });
    for (let i = 0; i < 10; i++) limiter.isLimited();
    assert.equal(limiter.isLimited(), true, 'request 11 should be rate-limited');
  });

  it('allows requests again after the window expires', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxBurst: 3 });
    // Fill up the window
    for (let i = 0; i < 3; i++) limiter.isLimited();
    assert.equal(limiter.isLimited(), true, 'should be limited');

    // Simulate time passing by pushing old timestamps back
    const past = Date.now() - 61_000;
    limiter._recent.length = 0;
    limiter._recent.push(past, past, past);

    assert.equal(limiter.isLimited(), false, 'should allow after window expires');
  });

  it('does not record a timestamp when rate-limited', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxBurst: 2 });
    limiter.isLimited(); // 1
    limiter.isLimited(); // 2
    const lengthBefore = limiter._recent.length;
    limiter.isLimited(); // blocked
    assert.equal(limiter._recent.length, lengthBefore, 'blocked request should not add a timestamp');
  });

  it('handles burst of 1', () => {
    const limiter = createRateLimiter({ windowMs: 1_000, maxBurst: 1 });
    assert.equal(limiter.isLimited(), false, 'first request allowed');
    assert.equal(limiter.isLimited(), true, 'second request blocked');
  });

  it('each instance has independent state', () => {
    const a = createRateLimiter({ windowMs: 60_000, maxBurst: 1 });
    const b = createRateLimiter({ windowMs: 60_000, maxBurst: 1 });
    a.isLimited();
    assert.equal(a.isLimited(), true, 'a should be limited');
    assert.equal(b.isLimited(), false, 'b should still be allowed');
  });

  it('buckets requests by client key so one noisy caller does not starve others', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxBurst: 2 });
    // Noisy client 'a' saturates its own bucket.
    assert.equal(limiter.isLimited('a'), false);
    assert.equal(limiter.isLimited('a'), false);
    assert.equal(limiter.isLimited('a'), true, 'a should be blocked after burst');
    // Different client 'b' is unaffected.
    assert.equal(limiter.isLimited('b'), false, 'b should still be allowed');
    assert.equal(limiter.isLimited('b'), false, 'b should still be allowed');
    assert.equal(limiter.isLimited('b'), true, 'b now hits its own burst');
    // 'a' is still blocked — state per-key.
    assert.equal(limiter.isLimited('a'), true, 'a still blocked');
  });

  it('no-key callers share the "global" bucket (legacy backwards compat)', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxBurst: 1 });
    assert.equal(limiter.isLimited(), false);
    assert.equal(limiter.isLimited('global'), true, 'explicit "global" hits same bucket');
  });

  it('evicts oldest bucket when maxKeys is exceeded', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxBurst: 1, maxKeys: 2 });
    limiter.isLimited('a'); // bucket for 'a'
    limiter.isLimited('b'); // bucket for 'b'
    // Inserting a third key evicts 'a'.
    limiter.isLimited('c');
    // 'a' should have a fresh bucket — no timestamp history — and be allowed.
    assert.equal(limiter.isLimited('a'), false, 'a is fresh after eviction');
    // Whereas 'c' has one entry already and is now at burst limit.
    assert.equal(limiter.isLimited('c'), true, 'c is at burst');
  });
});

describe('resolveClientKey', () => {
  it('uses the first hop of x-forwarded-for', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } };
    assert.equal(resolveClientKey(req), '203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    const req = { headers: { 'x-real-ip': '198.51.100.42' } };
    assert.equal(resolveClientKey(req), '198.51.100.42');
  });

  it('falls back to socket.remoteAddress', () => {
    const req = { headers: {}, socket: { remoteAddress: '192.0.2.9' } };
    assert.equal(resolveClientKey(req), '192.0.2.9');
  });

  it('returns "global" when nothing is available', () => {
    assert.equal(resolveClientKey({ headers: {} }), 'global');
    assert.equal(resolveClientKey({}), 'global');
  });
});

// ── Cooldown limiter ────────────────────────────────────────────────

describe('createCooldownLimiter', () => {
  it('allows the first request', () => {
    const limiter = createCooldownLimiter({ intervalMs: 60_000 });
    const result = limiter.isLimited();
    assert.equal(result.limited, false);
    assert.equal(result.retryAfterSeconds, undefined);
  });

  it('blocks a second request within the interval', () => {
    const limiter = createCooldownLimiter({ intervalMs: 60_000 });
    limiter.isLimited(); // first — allowed
    const result = limiter.isLimited(); // second — blocked
    assert.equal(result.limited, true);
    assert.ok(result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 60);
  });

  it('returns retryAfterSeconds reflecting remaining wait', () => {
    const limiter = createCooldownLimiter({ intervalMs: 10_000 });
    limiter.isLimited();
    const result = limiter.isLimited();
    assert.equal(result.limited, true);
    assert.ok(result.retryAfterSeconds <= 10);
    assert.ok(result.retryAfterSeconds >= 1);
  });
});

// ── Source files use shared rate-limit module ───────────────────────

describe('API endpoints use shared rate-limit module', () => {
  it('callback.js imports from rate-limit.js and uses createRateLimiter', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../api/auth/github/callback.js', import.meta.url), 'utf8');
    assert.ok(src.includes('CALLBACK_RATE_LIMIT_MS'), 'should define CALLBACK_RATE_LIMIT_MS');
    assert.ok(src.includes('CALLBACK_RATE_LIMIT_BURST'), 'should define CALLBACK_RATE_LIMIT_BURST');
    assert.ok(src.includes("'rate-limited'"), 'should use rate-limited error code');
    assert.ok(src.includes('createRateLimiter'), 'should import createRateLimiter');
    assert.ok(src.includes('rate-limit.js'), 'should import from shared rate-limit module');
  });

  it('start.js imports from rate-limit.js and uses createRateLimiter', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../api/auth/github/start.js', import.meta.url), 'utf8');
    assert.ok(src.includes('START_RATE_LIMIT_MS'), 'should define START_RATE_LIMIT_MS');
    assert.ok(src.includes('START_RATE_LIMIT_BURST'), 'should define START_RATE_LIMIT_BURST');
    assert.ok(src.includes("'rate-limited'"), 'should use rate-limited error code');
    assert.ok(src.includes('createRateLimiter'), 'should import createRateLimiter');
    assert.ok(src.includes('rate-limit.js'), 'should import from shared rate-limit module');
  });

  it('generate-brief.js imports from rate-limit.js and uses createDistributedRateLimiter', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../api/generate-brief.js', import.meta.url), 'utf8');
    assert.ok(src.includes('RATE_LIMIT_WINDOW_MS'), 'should define RATE_LIMIT_WINDOW_MS');
    assert.ok(src.includes('RATE_LIMIT_BURST'), 'should define RATE_LIMIT_BURST');
    assert.ok(src.includes("'rate-limited'"), 'should use rate-limited error code');
    assert.ok(src.includes('createDistributedRateLimiter'), 'should import createDistributedRateLimiter');
    assert.ok(src.includes('rate-limit.js'), 'should import from shared rate-limit module');
  });

  it('request-source.js imports from rate-limit.js and uses createRateLimiter', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../api/request-source.js', import.meta.url), 'utf8');
    assert.ok(src.includes('REQUEST_RATE_LIMIT_MS'), 'should define REQUEST_RATE_LIMIT_MS');
    assert.ok(src.includes('REQUEST_RATE_LIMIT_BURST'), 'should define REQUEST_RATE_LIMIT_BURST');
    assert.ok(src.includes("'rate-limited'"), 'should use rate-limited error code');
    assert.ok(src.includes('createRateLimiter'), 'should import createRateLimiter');
    assert.ok(src.includes('rate-limit.js'), 'should import from shared rate-limit module');
  });

  it('traffic.js imports from rate-limit.js and uses createDistributedRateLimiter', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../api/traffic.js', import.meta.url), 'utf8');
    assert.ok(src.includes('RATE_LIMIT_WINDOW_MS'), 'should define RATE_LIMIT_WINDOW_MS');
    assert.ok(src.includes('RATE_LIMIT_BURST'), 'should define RATE_LIMIT_BURST');
    assert.ok(src.includes("'rate-limited'"), 'should use rate-limited error code');
    assert.ok(src.includes('createDistributedRateLimiter'), 'should import createDistributedRateLimiter');
    assert.ok(src.includes('rate-limit.js'), 'should import from shared rate-limit module');
  });

  it('trigger-live-feed.js imports from rate-limit.js and uses createCooldownLimiter', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../api/trigger-live-feed.js', import.meta.url), 'utf8');
    assert.ok(src.includes('MIN_TRIGGER_INTERVAL_MS'), 'should define MIN_TRIGGER_INTERVAL_MS');
    assert.ok(src.includes("'rate-limited'"), 'should use rate-limited error code');
    assert.ok(src.includes('createCooldownLimiter'), 'should import createCooldownLimiter');
    assert.ok(src.includes('rate-limit.js'), 'should import from shared rate-limit module');
  });

  it('no API endpoint still uses inline rate-limiter arrays', async () => {
    const { readFileSync } = await import('node:fs');
    const files = [
      '../api/generate-brief.js',
      '../api/traffic.js',
      '../api/request-source.js',
      '../api/auth/github/callback.js',
      '../api/auth/github/start.js',
      '../api/trigger-live-feed.js'
    ];
    for (const file of files) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      assert.ok(!src.includes('const recentRequests = []'), `${file} should not have inline recentRequests`);
      assert.ok(!src.includes('const recentCallbacks = []'), `${file} should not have inline recentCallbacks`);
      assert.ok(!src.includes('const recentStarts = []'), `${file} should not have inline recentStarts`);
      assert.ok(!src.includes('let lastTriggerTime = 0'), `${file} should not have inline lastTriggerTime`);
    }
  });
});
