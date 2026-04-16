import test from 'node:test';
import assert from 'node:assert/strict';

import { applyDomainCircuitBreakerEffects } from '../scripts/build-live-feed.mjs';

// ---------------------------------------------------------------------------
// applyDomainCircuitBreakerEffects()
// ---------------------------------------------------------------------------

function makeHealthEntry(overrides = {}) {
  return { healthScore: 60, provider: 'test', lane: 'context', kind: 'rss', ...overrides };
}

function makeSources(entries) {
  return entries.map(([id, endpoint]) => ({
    id,
    provider: id,
    lane: 'context',
    kind: 'rss',
    endpoint
  }));
}

test('applyDomainCircuitBreakerEffects – no domainState returns empty adjustments', () => {
  const health = { 'src-a': makeHealthEntry() };
  const result = applyDomainCircuitBreakerEffects(health, null, []);
  assert.deepEqual(result, { penalised: [], boosted: [] });
});

test('applyDomainCircuitBreakerEffects – empty domainState returns empty adjustments', () => {
  const health = { 'src-a': makeHealthEntry() };
  const result = applyDomainCircuitBreakerEffects(health, {}, []);
  assert.deepEqual(result, { penalised: [], boosted: [] });
});

test('applyDomainCircuitBreakerEffects – tripped circuit penalises sibling sources', () => {
  const sources = makeSources([
    ['src-a', 'https://example.com/feed-a'],
    ['src-b', 'https://example.com/feed-b'],
    ['src-c', 'https://other.com/feed']
  ]);
  const health = {
    'src-a': makeHealthEntry({ healthScore: 50 }),
    'src-b': makeHealthEntry({ healthScore: 70 }),
    'src-c': makeHealthEntry({ healthScore: 80 })
  };
  const domainState = {
    'example.com': {
      failures: 5,
      circuitOpenUntil: Date.now() + 600_000, // open for 10 min
      halfOpenProbes: 1
    }
  };

  const result = applyDomainCircuitBreakerEffects(health, domainState, sources);

  // Both example.com sources should be penalised (default penalty=10)
  assert.ok(result.penalised.includes('src-a'), 'src-a should be penalised');
  assert.ok(result.penalised.includes('src-b'), 'src-b should be penalised');
  assert.ok(!result.penalised.includes('src-c'), 'src-c on different domain should not be penalised');
  assert.equal(health['src-a'].healthScore, 40); // 50 - 10
  assert.equal(health['src-b'].healthScore, 60); // 70 - 10
  assert.equal(health['src-c'].healthScore, 80); // unchanged
});

test('applyDomainCircuitBreakerEffects – probe success boosts sibling sources', () => {
  const sources = makeSources([
    ['src-a', 'https://example.com/feed-a'],
    ['src-b', 'https://example.com/feed-b']
  ]);
  const health = {
    'src-a': makeHealthEntry({ healthScore: 50 }),
    'src-b': makeHealthEntry({ healthScore: 40 })
  };
  const domainState = {
    'example.com': {
      failures: 0,
      circuitOpenUntil: 0,
      halfOpenProbes: 0,
      probeSuccess: true
    }
  };

  const result = applyDomainCircuitBreakerEffects(health, domainState, sources);

  // Both should be boosted (default boost=5)
  assert.ok(result.boosted.includes('src-a'), 'src-a should be boosted');
  assert.ok(result.boosted.includes('src-b'), 'src-b should be boosted');
  assert.equal(health['src-a'].healthScore, 55); // 50 + 5
  assert.equal(health['src-b'].healthScore, 45); // 40 + 5
});

test('applyDomainCircuitBreakerEffects – boost caps at 100', () => {
  const sources = makeSources([['src-a', 'https://example.com/feed']]);
  const health = { 'src-a': makeHealthEntry({ healthScore: 98 }) };
  const domainState = {
    'example.com': { failures: 0, circuitOpenUntil: 0, probeSuccess: true }
  };

  applyDomainCircuitBreakerEffects(health, domainState, sources);
  assert.equal(health['src-a'].healthScore, 100);
});

test('applyDomainCircuitBreakerEffects – penalty floors at 0', () => {
  const sources = makeSources([['src-a', 'https://example.com/feed']]);
  const health = { 'src-a': makeHealthEntry({ healthScore: 3 }) };
  const domainState = {
    'example.com': { failures: 5, circuitOpenUntil: Date.now() + 600_000 }
  };

  applyDomainCircuitBreakerEffects(health, domainState, sources);
  assert.equal(health['src-a'].healthScore, 0);
});

test('applyDomainCircuitBreakerEffects – expired circuit breaker has no effect', () => {
  const sources = makeSources([['src-a', 'https://example.com/feed']]);
  const health = { 'src-a': makeHealthEntry({ healthScore: 60 }) };
  const domainState = {
    'example.com': { failures: 5, circuitOpenUntil: Date.now() - 1000 } // expired
  };

  const result = applyDomainCircuitBreakerEffects(health, domainState, sources);
  assert.deepEqual(result.penalised, []);
  assert.equal(health['src-a'].healthScore, 60);
});

test('applyDomainCircuitBreakerEffects – probe success takes priority over active circuit', () => {
  // If probeSuccess=true is set, it means the circuit already closed; boost applies.
  const sources = makeSources([['src-a', 'https://example.com/feed']]);
  const health = { 'src-a': makeHealthEntry({ healthScore: 50 }) };
  const domainState = {
    'example.com': { failures: 0, circuitOpenUntil: 0, probeSuccess: true }
  };

  const result = applyDomainCircuitBreakerEffects(health, domainState, sources);
  assert.ok(result.boosted.includes('src-a'));
  assert.equal(result.penalised.length, 0);
  assert.equal(health['src-a'].healthScore, 55);
});

test('applyDomainCircuitBreakerEffects – sources without endpoints are skipped', () => {
  const sources = [{ id: 'src-a', provider: 'test' }]; // no endpoint
  const health = { 'src-a': makeHealthEntry({ healthScore: 60 }) };
  const domainState = {
    'example.com': { failures: 5, circuitOpenUntil: Date.now() + 600_000 }
  };

  const result = applyDomainCircuitBreakerEffects(health, domainState, sources);
  assert.deepEqual(result.penalised, []);
  assert.equal(health['src-a'].healthScore, 60);
});

test('applyDomainCircuitBreakerEffects – multiple domains independent effects', () => {
  const sources = makeSources([
    ['src-a', 'https://alpha.com/feed'],
    ['src-b', 'https://beta.com/feed']
  ]);
  const health = {
    'src-a': makeHealthEntry({ healthScore: 60 }),
    'src-b': makeHealthEntry({ healthScore: 60 })
  };
  const domainState = {
    'alpha.com': { failures: 5, circuitOpenUntil: Date.now() + 600_000 },
    'beta.com': { failures: 0, circuitOpenUntil: 0, probeSuccess: true }
  };

  const result = applyDomainCircuitBreakerEffects(health, domainState, sources);
  assert.ok(result.penalised.includes('src-a'), 'src-a penalised from alpha.com trip');
  assert.ok(result.boosted.includes('src-b'), 'src-b boosted from beta.com probe');
  assert.equal(health['src-a'].healthScore, 50);
  assert.equal(health['src-b'].healthScore, 65);
});
