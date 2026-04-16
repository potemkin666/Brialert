import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergePayloads, sourceMap } from '../scripts/merge-quarantined-sources.mjs';

// ── helpers ──

function makePayload(sources, extras = {}) {
  return {
    generatedAt: '2026-04-16T08:00:00.000Z',
    count: sources.length,
    sources,
    schemaVersion: 1,
    ...extras
  };
}

function src(id, overrides = {}) {
  return {
    id,
    provider: id,
    endpoint: `https://example.com/${id}`,
    kind: 'rss',
    lane: 'context',
    region: 'uk',
    status: 'auto-quarantined',
    reason: 'test',
    quarantinedAt: '2026-04-16T08:00:00.000Z',
    consecutiveFailures: 6,
    ...overrides
  };
}

// ── sourceMap ──

describe('sourceMap', () => {
  it('builds a map keyed by source id', () => {
    const map = sourceMap({ sources: [src('a'), src('b')] });
    assert.equal(map.size, 2);
    assert.equal(map.get('a').id, 'a');
  });

  it('handles null/undefined payload', () => {
    assert.equal(sourceMap(null).size, 0);
    assert.equal(sourceMap(undefined).size, 0);
    assert.equal(sourceMap({}).size, 0);
  });
});

// ── mergePayloads ──

describe('mergePayloads', () => {
  it('keeps all sources when nothing changed', () => {
    const payload = makePayload([src('a'), src('b')]);
    const { result, stats } = mergePayloads(payload, payload, payload);
    assert.equal(result.count, 2);
    assert.equal(stats.adminRemoved, 0);
    assert.equal(stats.adminChanged, 0);
    assert.equal(stats.adminAdded, 0);
  });

  it('honours admin removal (source restored on main)', () => {
    const base = makePayload([src('a'), src('b')]);
    const ours = makePayload([src('a'), src('b')]);
    const theirs = makePayload([src('b')]); // admin removed 'a'
    const { result, stats } = mergePayloads(base, ours, theirs);
    assert.equal(result.count, 1);
    assert.equal(result.sources[0].id, 'b');
    assert.equal(stats.adminRemoved, 1);
  });

  it('preserves admin edits over workflow version', () => {
    const base = makePayload([src('a', { reason: 'original' })]);
    const ours = makePayload([src('a', { reason: 'workflow-updated' })]);
    const theirs = makePayload([src('a', { reason: 'admin-edited' })]);
    const { result, stats } = mergePayloads(base, ours, theirs);
    assert.equal(result.count, 1);
    assert.equal(result.sources[0].reason, 'admin-edited');
    assert.equal(stats.adminChanged, 1);
  });

  it('includes admin-added sources', () => {
    const base = makePayload([src('a')]);
    const ours = makePayload([src('a')]);
    const theirs = makePayload([src('a'), src('new-from-admin')]);
    const { result, stats } = mergePayloads(base, ours, theirs);
    assert.equal(result.count, 2);
    assert.ok(result.sources.some(s => s.id === 'new-from-admin'));
    assert.equal(stats.adminAdded, 1);
  });

  it('keeps workflow-only new quarantines', () => {
    const base = makePayload([src('a')]);
    const ours = makePayload([src('a'), src('new-from-workflow')]);
    const theirs = makePayload([src('a')]);
    const { result } = mergePayloads(base, ours, theirs);
    assert.equal(result.count, 2);
    assert.ok(result.sources.some(s => s.id === 'new-from-workflow'));
  });

  it('admin removal wins over workflow keeping the source', () => {
    const base = makePayload([src('a'), src('b')]);
    const ours = makePayload([src('a'), src('b', { consecutiveFailures: 8 })]);
    const theirs = makePayload([src('a')]); // admin removed 'b'
    const { result, stats } = mergePayloads(base, ours, theirs);
    assert.equal(result.count, 1);
    assert.equal(result.sources[0].id, 'a');
    assert.equal(stats.adminRemoved, 1);
  });

  it('handles null base (no common ancestor)', () => {
    const ours = makePayload([src('a')]);
    const theirs = makePayload([src('b')]);
    const { result } = mergePayloads(null, ours, theirs);
    // No base → no admin changes detected, ours + theirs additions
    assert.equal(result.count, 2);
  });

  it('preserves schemaVersion and metrics from ours', () => {
    const base = makePayload([src('a')]);
    const ours = makePayload([src('a')], { schemaVersion: 2, metrics: { newThisWeek: 5 } });
    const theirs = makePayload([src('a')], { schemaVersion: 1, metrics: { newThisWeek: 3 } });
    const { result } = mergePayloads(base, ours, theirs);
    assert.equal(result.schemaVersion, 2);
    assert.deepEqual(result.metrics, { newThisWeek: 5 });
  });

  it('combined: admin restore + workflow new quarantine', () => {
    const base = makePayload([src('a'), src('b'), src('c')]);
    const ours = makePayload([src('a'), src('b'), src('c'), src('d')]);
    const theirs = makePayload([src('b'), src('c')]); // admin removed 'a'
    const { result, stats } = mergePayloads(base, ours, theirs);
    // 'a' removed by admin, 'd' added by workflow, 'b' and 'c' kept
    assert.equal(result.count, 3);
    const ids = result.sources.map(s => s.id);
    assert.ok(!ids.includes('a'));
    assert.ok(ids.includes('b'));
    assert.ok(ids.includes('c'));
    assert.ok(ids.includes('d'));
    assert.equal(stats.adminRemoved, 1);
  });
});
