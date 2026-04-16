import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  deriveQuarantineIds,
  patchSources,
  run
} from '../scripts/ci/seed-quarantine-from-health.mjs';

// ── deriveQuarantineIds ──────────────────────────────────────────────

test('deriveQuarantineIds returns empty set for null/undefined input', () => {
  assert.equal(deriveQuarantineIds(null).size, 0);
  assert.equal(deriveQuarantineIds(undefined).size, 0);
  assert.equal(deriveQuarantineIds({}).size, 0);
});

test('deriveQuarantineIds flags source below health threshold', () => {
  const ids = deriveQuarantineIds(
    { 'src-a': { healthScore: 20, quarantined: false, consecutiveFailures: 0 } },
    { healthScoreThreshold: 25, failureThreshold: 6 }
  );
  assert.ok(ids.has('src-a'));
});

test('deriveQuarantineIds flags source already quarantined', () => {
  const ids = deriveQuarantineIds(
    { 'src-b': { healthScore: 80, quarantined: true, consecutiveFailures: 0 } },
    { healthScoreThreshold: 25, failureThreshold: 6 }
  );
  assert.ok(ids.has('src-b'));
});

test('deriveQuarantineIds flags source at or above failure threshold', () => {
  const ids = deriveQuarantineIds(
    { 'src-c': { healthScore: 50, quarantined: false, consecutiveFailures: 6 } },
    { healthScoreThreshold: 25, failureThreshold: 6 }
  );
  assert.ok(ids.has('src-c'));
});

test('deriveQuarantineIds does not flag healthy source', () => {
  const ids = deriveQuarantineIds(
    { 'src-d': { healthScore: 80, quarantined: false, consecutiveFailures: 1 } },
    { healthScoreThreshold: 25, failureThreshold: 6 }
  );
  assert.equal(ids.size, 0);
});

test('deriveQuarantineIds handles multiple sources', () => {
  const health = {
    good: { healthScore: 90, quarantined: false, consecutiveFailures: 0 },
    bad1: { healthScore: 10, quarantined: false, consecutiveFailures: 2 },
    bad2: { healthScore: 50, quarantined: true, consecutiveFailures: 0 },
    bad3: { healthScore: 40, quarantined: false, consecutiveFailures: 8 }
  };
  const ids = deriveQuarantineIds(health, { healthScoreThreshold: 25, failureThreshold: 6 });
  assert.equal(ids.size, 3);
  assert.ok(ids.has('bad1'));
  assert.ok(ids.has('bad2'));
  assert.ok(ids.has('bad3'));
  assert.ok(!ids.has('good'));
});

test('deriveQuarantineIds skips malformed entries', () => {
  const health = {
    ok: { healthScore: 90, quarantined: false, consecutiveFailures: 0 },
    garbage: 'not-an-object',
    empty: null
  };
  const ids = deriveQuarantineIds(health, { healthScoreThreshold: 25, failureThreshold: 6 });
  assert.equal(ids.size, 0);
});

// ── patchSources ─────────────────────────────────────────────────────

test('patchSources sets quarantined flag on matching sources', () => {
  const sources = [
    { id: 'a', provider: 'A' },
    { id: 'b', provider: 'B' }
  ];
  const ids = new Set(['b']);
  const patched = patchSources(sources, ids);
  assert.equal(patched.length, 2);
  assert.equal(patched[0].quarantined, undefined);
  assert.equal(patched[1].quarantined, true);
});

test('patchSources does not mutate the original array', () => {
  const sources = [{ id: 'x', provider: 'X' }];
  const ids = new Set(['x']);
  const patched = patchSources(sources, ids);
  assert.equal(sources[0].quarantined, undefined);
  assert.equal(patched[0].quarantined, true);
});

test('patchSources returns original array when quarantineIds is empty', () => {
  const sources = [{ id: 'x' }];
  assert.deepEqual(patchSources(sources, new Set()), sources);
  assert.deepEqual(patchSources(sources, null), sources);
});

test('patchSources handles empty/null sources', () => {
  assert.deepEqual(patchSources(null, new Set(['x'])), []);
  assert.deepEqual(patchSources([], new Set(['x'])), []);
});

// ── run() integration ────────────────────────────────────────────────

test('run() patches sources.json based on health data', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-quarantine-'));
  const alertsFile = path.join(tmpDir, 'live-alerts.json');
  const sourcesFile = path.join(tmpDir, 'sources.json');

  const alerts = {
    health: {
      sourceHealth: {
        healthy: { healthScore: 90, quarantined: false, consecutiveFailures: 0 },
        sick: { healthScore: 10, quarantined: false, consecutiveFailures: 3 },
        quarantined: { healthScore: 20, quarantined: true, consecutiveFailures: 1 }
      }
    }
  };

  const catalog = {
    sources: [
      { id: 'healthy', provider: 'Good' },
      { id: 'sick', provider: 'Sick' },
      { id: 'quarantined', provider: 'Q' },
      { id: 'unknown', provider: 'Unknown' }
    ]
  };

  fs.writeFileSync(alertsFile, JSON.stringify(alerts));
  fs.writeFileSync(sourcesFile, JSON.stringify(catalog));

  const result = await run(alertsFile, sourcesFile);
  assert.equal(result.seeded, 2);
  assert.equal(result.total, 4);

  const updated = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'));
  const byId = Object.fromEntries(updated.sources.map((s) => [s.id, s]));
  assert.equal(byId.healthy.quarantined, undefined);
  assert.equal(byId.sick.quarantined, true);
  assert.equal(byId.quarantined.quarantined, true);
  assert.equal(byId.unknown.quarantined, undefined);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('run() is idempotent — running twice produces same result', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-quarantine-'));
  const alertsFile = path.join(tmpDir, 'live-alerts.json');
  const sourcesFile = path.join(tmpDir, 'sources.json');

  const alerts = {
    health: {
      sourceHealth: {
        bad: { healthScore: 5, quarantined: true, consecutiveFailures: 10 }
      }
    }
  };

  const catalog = { sources: [{ id: 'bad', provider: 'Bad' }] };

  fs.writeFileSync(alertsFile, JSON.stringify(alerts));
  fs.writeFileSync(sourcesFile, JSON.stringify(catalog));

  await run(alertsFile, sourcesFile);
  const first = fs.readFileSync(sourcesFile, 'utf8');

  await run(alertsFile, sourcesFile);
  const second = fs.readFileSync(sourcesFile, 'utf8');

  assert.equal(first, second);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('run() gracefully handles missing live-alerts.json', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-quarantine-'));
  const result = await run(
    path.join(tmpDir, 'missing.json'),
    path.join(tmpDir, 'sources.json')
  );
  assert.equal(result.seeded, 0);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('run() gracefully handles empty health block', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-quarantine-'));
  const alertsFile = path.join(tmpDir, 'live-alerts.json');
  const sourcesFile = path.join(tmpDir, 'sources.json');

  fs.writeFileSync(alertsFile, JSON.stringify({ health: {} }));
  fs.writeFileSync(sourcesFile, JSON.stringify({ sources: [{ id: 'a' }] }));

  const result = await run(alertsFile, sourcesFile);
  assert.equal(result.seeded, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('run() gracefully handles missing sources.json', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-quarantine-'));
  const alertsFile = path.join(tmpDir, 'live-alerts.json');

  fs.writeFileSync(alertsFile, JSON.stringify({
    health: { sourceHealth: { x: { healthScore: 5 } } }
  }));

  const result = await run(alertsFile, path.join(tmpDir, 'missing-sources.json'));
  assert.equal(result.seeded, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
