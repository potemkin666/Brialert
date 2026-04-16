import test from 'node:test';
import assert from 'node:assert/strict';

import { analyseErrorPattern, nextSourceHealthEntry } from '../scripts/build-live-feed.mjs';

// ---------------------------------------------------------------------------
// analyseErrorPattern()
// ---------------------------------------------------------------------------

test('analyseErrorPattern – empty window returns generic message with healthScore', () => {
  const result = analyseErrorPattern([], { healthScore: 15 });
  assert.match(result, /degraded to 15/);
});

test('analyseErrorPattern – empty window without context returns "Needs review"', () => {
  assert.equal(analyseErrorPattern([], {}), 'Needs review');
  assert.equal(analyseErrorPattern(null, {}), 'Needs review');
});

test('analyseErrorPattern – all 404 errors', () => {
  const errors = Array.from({ length: 5 }, () => ({ category: 'not-found-404', at: '2026-01-01T00:00:00Z' }));
  const result = analyseErrorPattern(errors, {});
  assert.match(result, /removed.*404/i);
});

test('analyseErrorPattern – all dead-or-moved-url errors', () => {
  const errors = Array.from({ length: 3 }, () => ({ category: 'dead-or-moved-url', at: '2026-01-01T00:00:00Z' }));
  const result = analyseErrorPattern(errors, {});
  assert.match(result, /dead.*permanently/i);
});

test('analyseErrorPattern – all blocked-or-auth errors', () => {
  const errors = Array.from({ length: 4 }, () => ({ category: 'blocked-or-auth', at: '2026-01-01T00:00:00Z' }));
  const result = analyseErrorPattern(errors, {});
  assert.match(result, /access protection.*401\/403/i);
});

test('analyseErrorPattern – all anti-bot errors', () => {
  const errors = Array.from({ length: 3 }, () => ({ category: 'anti-bot-protection', at: '2026-01-01T00:00:00Z' }));
  const result = analyseErrorPattern(errors, {});
  assert.match(result, /anti-bot.*playwright/i);
});

test('analyseErrorPattern – all timeout errors', () => {
  const errors = Array.from({ length: 4 }, () => ({ category: 'timeout', at: '2026-01-01T00:00:00Z' }));
  const result = analyseErrorPattern(errors, {});
  assert.match(result, /persistent timeouts/i);
});

test('analyseErrorPattern – all network-failure errors', () => {
  const errors = Array.from({ length: 5 }, () => ({ category: 'network-failure', at: '2026-01-01T00:00:00Z' }));
  const result = analyseErrorPattern(errors, {});
  assert.match(result, /persistent network failures/i);
});

test('analyseErrorPattern – all brittle-selectors errors', () => {
  const errors = Array.from({ length: 3 }, () => ({ category: 'brittle-selectors-or-js-rendering', at: '2026-01-01T00:00:00Z' }));
  const result = analyseErrorPattern(errors, {});
  assert.match(result, /html structure changed/i);
});

test('analyseErrorPattern – mixed blocked + anti-bot (≥60%)', () => {
  const errors = [
    { category: 'blocked-or-auth', at: '2026-01-01T00:00:00Z' },
    { category: 'anti-bot-protection', at: '2026-01-02T00:00:00Z' },
    { category: 'blocked-or-auth', at: '2026-01-03T00:00:00Z' },
    { category: 'timeout', at: '2026-01-04T00:00:00Z' },
    { category: 'anti-bot-protection', at: '2026-01-05T00:00:00Z' }
  ];
  const result = analyseErrorPattern(errors, {});
  assert.match(result, /access protection.*alternate/i);
});

test('analyseErrorPattern – mixed network + timeout (≥60%)', () => {
  const errors = [
    { category: 'network-failure', at: '2026-01-01T00:00:00Z' },
    { category: 'timeout', at: '2026-01-02T00:00:00Z' },
    { category: 'network-failure', at: '2026-01-03T00:00:00Z' },
    { category: 'not-found-404', at: '2026-01-04T00:00:00Z' },
    { category: 'timeout', at: '2026-01-05T00:00:00Z' }
  ];
  const result = analyseErrorPattern(errors, {});
  assert.match(result, /infrastructure instability/i);
});

test('analyseErrorPattern – varied errors (≥3 categories)', () => {
  const errors = [
    { category: 'not-found-404', at: '2026-01-01T00:00:00Z' },
    { category: 'timeout', at: '2026-01-02T00:00:00Z' },
    { category: 'network-failure', at: '2026-01-03T00:00:00Z' },
    { category: 'blocked-or-auth', at: '2026-01-04T00:00:00Z' }
  ];
  const result = analyseErrorPattern(errors, {});
  assert.match(result, /varied error types/i);
});

test('analyseErrorPattern – two categories, no dominant pattern falls back to generic', () => {
  const errors = [
    { category: 'not-found-404', at: '2026-01-01T00:00:00Z' },
    { category: 'timeout', at: '2026-01-02T00:00:00Z' }
  ];
  const result = analyseErrorPattern(errors, { healthScore: 10 });
  assert.match(result, /degraded to 10/);
});

// ---------------------------------------------------------------------------
// nextSourceHealthEntry() – rolling window behaviour
// ---------------------------------------------------------------------------

function makeSource(overrides = {}) {
  return {
    id: 'test-source',
    provider: 'test-provider',
    lane: 'context',
    kind: 'rss',
    endpoint: 'https://example.com/feed',
    ...overrides
  };
}

function failStat(category = 'not-found-404', message = 'HTTP 404') {
  return { built: 0, errors: 1, lastErrorCategory: category, lastErrorMessage: message };
}

function successStat() {
  return { built: 3, errors: 0 };
}

function emptyStat() {
  return { built: 0, errors: 0 };
}

test('nextSourceHealthEntry – failure appends to empty recentErrors', () => {
  const source = makeSource();
  const result = nextSourceHealthEntry(source, failStat(), {}, '2026-01-01T00:00:00Z');
  assert.equal(result.recentErrors.length, 1);
  assert.equal(result.recentErrors[0].category, 'not-found-404');
  assert.equal(result.recentErrors[0].at, '2026-01-01T00:00:00Z');
});

test('nextSourceHealthEntry – failures accumulate in rolling window', () => {
  const source = makeSource();
  let prior = {};
  for (let i = 0; i < 3; i++) {
    prior = nextSourceHealthEntry(source, failStat('timeout', 'Timed out'), prior, `2026-01-0${i + 1}T00:00:00Z`);
  }
  assert.equal(prior.recentErrors.length, 3);
  assert.equal(prior.recentErrors[0].category, 'timeout');
  assert.equal(prior.recentErrors[2].at, '2026-01-03T00:00:00Z');
});

test('nextSourceHealthEntry – rolling window caps at configured size', () => {
  const source = makeSource();
  let prior = {};
  // Build up 8 consecutive failures — window should cap at ROLLING_ERROR_WINDOW_SIZE (default 5)
  const categories = ['timeout', 'network-failure', 'blocked-or-auth', 'not-found-404', 'timeout', 'timeout', 'network-failure', 'blocked-or-auth'];
  for (let i = 0; i < categories.length; i++) {
    prior = nextSourceHealthEntry(source, failStat(categories[i]), prior, `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`);
  }
  assert.ok(prior.recentErrors.length <= 5, `window should be capped at 5 but got ${prior.recentErrors.length}`);
  // The last 5 entries should be the most recent
  assert.equal(prior.recentErrors[0].category, 'not-found-404');
  assert.equal(prior.recentErrors[4].category, 'blocked-or-auth');
});

test('nextSourceHealthEntry – success clears recentErrors', () => {
  const source = makeSource();
  let prior = {};
  // Accumulate some errors
  prior = nextSourceHealthEntry(source, failStat('timeout'), prior, '2026-01-01T00:00:00Z');
  prior = nextSourceHealthEntry(source, failStat('network-failure'), prior, '2026-01-02T00:00:00Z');
  assert.equal(prior.recentErrors.length, 2);

  // Success should clear
  const result = nextSourceHealthEntry(source, successStat(), prior, '2026-01-03T00:00:00Z');
  assert.deepEqual(result.recentErrors, []);
  assert.equal(result.lastErrorCategory, null);
});

test('nextSourceHealthEntry – empty run preserves existing recentErrors', () => {
  const source = makeSource();
  let prior = {};
  prior = nextSourceHealthEntry(source, failStat('timeout'), prior, '2026-01-01T00:00:00Z');
  assert.equal(prior.recentErrors.length, 1);

  const result = nextSourceHealthEntry(source, emptyStat(), prior, '2026-01-02T00:00:00Z');
  assert.equal(result.recentErrors.length, 1);
  assert.equal(result.recentErrors[0].category, 'timeout');
});

test('nextSourceHealthEntry – quarantine reason uses pattern analysis', () => {
  const source = makeSource();
  // Drive health score to 0 with consistent 404 failures
  let prior = { healthScore: 30 };
  prior = nextSourceHealthEntry(source, failStat('not-found-404'), prior, '2026-01-01T00:00:00Z');
  prior = nextSourceHealthEntry(source, failStat('not-found-404'), prior, '2026-01-02T00:00:00Z');

  if (prior.quarantined) {
    assert.match(prior.quarantineReason, /removed.*404/i,
      'quarantine reason should use pattern analysis for consistent 404s');
  }
});

test('nextSourceHealthEntry – mixed errors produce pattern-based quarantine reason', () => {
  const source = makeSource();
  // Simulate varied failures driving health score down
  let prior = { healthScore: 30 };
  const cats = ['blocked-or-auth', 'anti-bot-protection', 'blocked-or-auth', 'anti-bot-protection'];
  for (let i = 0; i < cats.length; i++) {
    prior = nextSourceHealthEntry(source, failStat(cats[i], 'error'), prior, `2026-01-0${i + 1}T00:00:00Z`);
  }

  if (prior.quarantined) {
    assert.match(prior.quarantineReason, /access protection|alternate/i,
      'quarantine reason should reflect mixed blocked/anti-bot pattern');
  }
});

test('nextSourceHealthEntry – prior recentErrors carried through from previous entry', () => {
  const source = makeSource();
  const priorEntry = {
    healthScore: 50,
    recentErrors: [
      { category: 'timeout', message: 'Timed out', at: '2025-12-30T00:00:00Z' },
      { category: 'network-failure', message: 'DNS error', at: '2025-12-31T00:00:00Z' }
    ]
  };
  const result = nextSourceHealthEntry(source, failStat('blocked-or-auth', 'HTTP 403'), priorEntry, '2026-01-01T00:00:00Z');
  assert.equal(result.recentErrors.length, 3);
  assert.equal(result.recentErrors[0].category, 'timeout');
  assert.equal(result.recentErrors[2].category, 'blocked-or-auth');
});
