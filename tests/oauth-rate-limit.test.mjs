import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Callback rate limiter ────────────────────────────────────────────

// We can't import the handler directly (it has external deps), so we
// test the same rate-limiter pattern extracted here to verify the logic.

function createRateLimiter(windowMs, burst) {
  const recent = [];
  return {
    isLimited() {
      const now = Date.now();
      while (recent.length > 0 && now - recent[0] > windowMs) recent.shift();
      if (recent.length >= burst) return true;
      recent.push(now);
      return false;
    },
    _recent: recent
  };
}

describe('OAuth rate limiter logic', () => {
  it('allows requests under the burst limit', () => {
    const limiter = createRateLimiter(60_000, 10);
    for (let i = 0; i < 10; i++) {
      assert.equal(limiter.isLimited(), false, `request ${i + 1} should be allowed`);
    }
  });

  it('blocks the request that exceeds the burst limit', () => {
    const limiter = createRateLimiter(60_000, 10);
    for (let i = 0; i < 10; i++) limiter.isLimited();
    assert.equal(limiter.isLimited(), true, 'request 11 should be rate-limited');
  });

  it('allows requests again after the window expires', () => {
    const limiter = createRateLimiter(60_000, 3);
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
    const limiter = createRateLimiter(60_000, 2);
    limiter.isLimited(); // 1
    limiter.isLimited(); // 2
    const lengthBefore = limiter._recent.length;
    limiter.isLimited(); // blocked
    assert.equal(limiter._recent.length, lengthBefore, 'blocked request should not add a timestamp');
  });

  it('handles burst of 1', () => {
    const limiter = createRateLimiter(1_000, 1);
    assert.equal(limiter.isLimited(), false, 'first request allowed');
    assert.equal(limiter.isLimited(), true, 'second request blocked');
  });
});

// ── Callback handler constants match expectations ────────────────────

describe('OAuth callback rate limit constants', () => {
  it('callback.js has CALLBACK_RATE_LIMIT_MS and CALLBACK_RATE_LIMIT_BURST', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../api/auth/github/callback.js', import.meta.url), 'utf8');
    assert.ok(src.includes('CALLBACK_RATE_LIMIT_MS'), 'should define CALLBACK_RATE_LIMIT_MS');
    assert.ok(src.includes('CALLBACK_RATE_LIMIT_BURST'), 'should define CALLBACK_RATE_LIMIT_BURST');
    assert.ok(src.includes('isCallbackRateLimited'), 'should define isCallbackRateLimited');
    assert.ok(src.includes("'rate-limited'"), 'should use rate-limited error code');
  });
});

describe('OAuth start rate limit constants', () => {
  it('start.js has START_RATE_LIMIT_MS and START_RATE_LIMIT_BURST', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../api/auth/github/start.js', import.meta.url), 'utf8');
    assert.ok(src.includes('START_RATE_LIMIT_MS'), 'should define START_RATE_LIMIT_MS');
    assert.ok(src.includes('START_RATE_LIMIT_BURST'), 'should define START_RATE_LIMIT_BURST');
    assert.ok(src.includes('isStartRateLimited'), 'should define isStartRateLimited');
    assert.ok(src.includes("'rate-limited'"), 'should use rate-limited error code');
  });
});
