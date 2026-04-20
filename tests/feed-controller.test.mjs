import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coerceLiveFeedPayload,
  normaliseRenderState,
  filteredAlerts,
  matchesAlertSearch,
  deriveView,
  deriveFeedHealthStatus,
  loadGeoLookup,
  loadWatchGeography,
  loadLiveFeed
} from '../shared/feed-controller.mjs';

// ── coerceLiveFeedPayload ─────────────────────────────────────────────

test('coerceLiveFeedPayload extracts valid feed data', () => {
  const result = coerceLiveFeedPayload({
    alerts: [{ id: 'a1', title: 'Test' }],
    generatedAt: '2025-01-01T12:00:00Z',
    sourceCount: 5,
    alertCount: 1
  });
  assert.equal(result.alerts.length, 1);
  assert.equal(result.generatedAt, '2025-01-01T12:00:00Z');
  assert.equal(result.sourceCount, 5);
  assert.equal(result.fetchedAlertCount, 1);
});

test('coerceLiveFeedPayload throws for missing alerts array', () => {
  assert.throws(() => coerceLiveFeedPayload({ generatedAt: '2025-01-01T12:00:00Z', sourceCount: 1 }), /missing an alerts array/);
});

test('coerceLiveFeedPayload throws for missing generatedAt', () => {
  assert.throws(() => coerceLiveFeedPayload({ alerts: [], sourceCount: 1 }), /missing a valid generatedAt/);
});

test('coerceLiveFeedPayload defaults sourceCount to 0 when missing', () => {
  const result = coerceLiveFeedPayload({ alerts: [], generatedAt: '2025-01-01T12:00:00Z', alertCount: 0 });
  assert.equal(result.sourceCount, 0);
});

test('coerceLiveFeedPayload throws for malformed alert entries', () => {
  assert.throws(
    () => coerceLiveFeedPayload({ alerts: [null], generatedAt: '2025-01-01T12:00:00Z', sourceCount: 1, alertCount: 1 }),
    /malformed alert entries/
  );
});

test('coerceLiveFeedPayload throws if alertCount < alerts length', () => {
  assert.throws(
    () => coerceLiveFeedPayload({ alerts: [{}, {}], generatedAt: '2025-01-01T12:00:00Z', sourceCount: 1, alertCount: 1 }),
    /alertCount cannot be lower/
  );
});

// ── normaliseRenderState ──────────────────────────────────────────────

test('normaliseRenderState provides defaults for empty state', () => {
  const state = normaliseRenderState({});
  assert.ok(Array.isArray(state.alerts));
  assert.equal(state.alerts.length, 0);
  assert.equal(state.searchQuery, '');
  assert.equal(state.activeRegion, 'all');
  assert.ok(state.watched instanceof Set);
  assert.equal(state.liveFeedFetchState, 'idle');
});

test('normaliseRenderState preserves valid state fields', () => {
  const watched = new Set(['a1', 'a2']);
  const state = normaliseRenderState({
    alerts: [{ id: 'x' }],
    searchQuery: 'london',
    activeRegion: 'uk',
    watched,
    liveFeedFetchState: 'success'
  });
  assert.equal(state.alerts.length, 1);
  assert.equal(state.searchQuery, 'london');
  assert.equal(state.activeRegion, 'uk');
  assert.equal(state.watched, watched);
  assert.equal(state.liveFeedFetchState, 'success');
});

test('normaliseRenderState handles null input', () => {
  const state = normaliseRenderState(null);
  assert.ok(Array.isArray(state.alerts));
  assert.equal(state.searchQuery, '');
});

// ── matchesAlertSearch ────────────────────────────────────────────────

test('matchesAlertSearch returns true for empty query', () => {
  assert.ok(matchesAlertSearch({ title: 'Test' }, ''));
  assert.ok(matchesAlertSearch({ title: 'Test' }, null));
});

test('matchesAlertSearch matches against title', () => {
  const alert = { title: 'London Bridge Attack' };
  assert.ok(matchesAlertSearch(alert, 'london'));
  assert.ok(matchesAlertSearch(alert, 'bridge attack'));
  assert.ok(!matchesAlertSearch(alert, 'manchester'));
});

test('matchesAlertSearch matches against multiple fields', () => {
  const alert = { title: 'Incident', source: 'BBC News', location: 'Paris' };
  assert.ok(matchesAlertSearch(alert, 'bbc'));
  assert.ok(matchesAlertSearch(alert, 'paris'));
});

// ── filteredAlerts ────────────────────────────────────────────────────

test('filteredAlerts filters by region', () => {
  const state = normaliseRenderState({
    alerts: [
      { id: '1', region: 'uk' },
      { id: '2', region: 'europe' },
      { id: '3', region: 'uk' }
    ],
    activeRegion: 'uk'
  });
  const filtered = filteredAlerts(state);
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((a) => a.region === 'uk'));
});

test('filteredAlerts returns all when region is "all"', () => {
  const state = normaliseRenderState({
    alerts: [{ id: '1', region: 'uk' }, { id: '2', region: 'europe' }],
    activeRegion: 'all'
  });
  assert.equal(filteredAlerts(state).length, 2);
});

test('filteredAlerts filters by search query', () => {
  const state = normaliseRenderState({
    alerts: [
      { id: '1', title: 'London bombing', region: 'uk' },
      { id: '2', title: 'Paris stabbing', region: 'europe' }
    ],
    activeRegion: 'all',
    searchQuery: 'paris'
  });
  const filtered = filteredAlerts(state);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, '2');
});

// ── deriveView ────────────────────────────────────────────────────────

test('deriveView categorises alerts into responder/context/quarantine', () => {
  const state = {
    alerts: [
      { id: '1', queueBucket: 'responder', region: 'uk' },
      { id: '2', queueBucket: 'quarantine', region: 'uk' },
      { id: '3', queueBucket: '', region: 'uk' }
    ],
    activeRegion: 'all'
  };
  const view = deriveView(state, { sortAlertsByFreshness: (a) => a });
  assert.equal(view.responder.length, 1);
  assert.equal(view.quarantine.length, 1);
  assert.equal(view.context.length, 1);
  assert.equal(view.topPriority.id, '1');
});

test('deriveView topPriority falls back to context when no responder', () => {
  const state = {
    alerts: [{ id: '1', queueBucket: '', region: 'uk' }],
    activeRegion: 'all'
  };
  const view = deriveView(state, { sortAlertsByFreshness: (a) => a });
  assert.equal(view.topPriority.id, '1');
});

test('deriveView topPriority is null when no alerts', () => {
  const state = { alerts: [], activeRegion: 'all' };
  const view = deriveView(state, { sortAlertsByFreshness: (a) => a });
  assert.equal(view.topPriority, null);
});

// ── deriveFeedHealthStatus ────────────────────────────────────────────

test('deriveFeedHealthStatus detects stale feed', () => {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const status = deriveFeedHealthStatus({
    health: { lastSuccessfulRefreshTime: twoHoursAgo },
    defaultStaleAfterMinutes: 22
  });
  assert.equal(status.isStale, true);
});

test('deriveFeedHealthStatus detects fresh feed', () => {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const status = deriveFeedHealthStatus({
    health: { lastSuccessfulRefreshTime: fiveMinutesAgo },
    defaultStaleAfterMinutes: 22
  });
  assert.equal(status.isStale, false);
});

// ── loadLiveFeed ──────────────────────────────────────────────────────

test('loadLiveFeed populates state on successful fetch', async () => {
  const originalFetch = globalThis.fetch;
  const state = { alerts: [], geoLookup: [] };
  const mockPayload = {
    alerts: [{ id: 'a1', title: 'Test Alert' }],
    generatedAt: '2025-01-01T12:00:00Z',
    sourceCount: 3,
    alertCount: 1
  };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => mockPayload
  });

  try {
    await loadLiveFeed(state, {
      liveFeedUrl: 'https://example.com/feed.json',
      normaliseAlert: (alert) => alert,
      onAfterLoad: () => {}
    });
    assert.equal(state.liveFeedFetchState, 'success');
    assert.equal(state.alerts.length, 1);
    assert.equal(state.alerts[0].id, 'a1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadLiveFeed sets error state on failed fetch', async () => {
  const originalFetch = globalThis.fetch;
  const previousAlerts = [{ id: 'old' }];
  const state = { alerts: previousAlerts, geoLookup: [] };
  globalThis.fetch = async () => ({ ok: false, status: 500 });

  try {
    await loadLiveFeed(state, {
      liveFeedUrl: 'https://example.com/feed.json',
      normaliseAlert: (alert) => alert,
      onAfterLoad: () => {}
    });
    assert.equal(state.liveFeedFetchState, 'error');
    assert.equal(state.alerts, previousAlerts, 'should preserve previous alerts on failure');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadLiveFeed calls onAfterLoad callback', async () => {
  const originalFetch = globalThis.fetch;
  const state = { alerts: [], geoLookup: [] };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      alerts: [],
      generatedAt: '2025-01-01T12:00:00Z',
      sourceCount: 1,
      alertCount: 0
    })
  });
  let callbackCalled = false;

  try {
    await loadLiveFeed(state, {
      liveFeedUrl: 'https://example.com/feed.json',
      normaliseAlert: (a) => a,
      onAfterLoad: () => { callbackCalled = true; }
    });
    assert.ok(callbackCalled, 'onAfterLoad should be called');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── loadGeoLookup ─────────────────────────────────────────────────────

test('loadGeoLookup populates state.geoLookup', async () => {
  const originalFetch = globalThis.fetch;
  const state = {};
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => [{ id: 'geo1' }]
  });

  try {
    await loadGeoLookup(state, 'https://example.com/geo.json');
    assert.ok(Array.isArray(state.geoLookup));
    assert.equal(state.geoLookup.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadGeoLookup sets empty array on failure', async () => {
  const originalFetch = globalThis.fetch;
  const state = {};
  globalThis.fetch = async () => ({ ok: false, status: 404 });

  try {
    await loadGeoLookup(state, 'https://example.com/geo.json');
    assert.deepEqual(state.geoLookup, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
