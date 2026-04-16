import test from 'node:test';
import assert from 'node:assert/strict';

import { createMidRunGuardrail } from '../scripts/build-live-feed.mjs';

function makeGuardrail(overrides = {}) {
  return createMidRunGuardrail({
    runStartedAtMs: Date.now(),
    maxRuntimeMs: 720_000,       // 12 minutes
    maxFailedRate: 0.65,
    runtimeWarningRatio: 0.8,
    failureRateWarningRatio: 0.6,
    minSourcesForRateCheck: 6,
    baseConcurrency: 4,
    baseStaggerMs: 60,
    baseStaggerJitterMs: 90,
    fastFailTimeoutMs: 5000,
    ...overrides
  });
}

function successStat(id = 'src-1') {
  return { id, built: 2, errors: 0 };
}

function failStat(id = 'src-1') {
  return { id, built: 0, errors: 1 };
}

test('createMidRunGuardrail returns level 0 with no sources processed', () => {
  const g = makeGuardrail();
  const state = g.evaluate();
  assert.equal(state.concurrency, 4);
  assert.equal(state.staggerMs, 60);
  assert.equal(state.staggerJitterMs, 90);
  assert.equal(state.timeoutOverrideMs, null);
  assert.equal(state.skipPlaywright, false);
  assert.equal(state.criticalOnly, false);
  assert.equal(state.shouldAbort, false);
});

test('createMidRunGuardrail snapshot starts clean', () => {
  const g = makeGuardrail();
  const snap = g.snapshot();
  assert.equal(snap.throttleLevel, 0);
  assert.equal(snap.totalAttempted, 0);
  assert.equal(snap.totalFailed, 0);
  assert.equal(snap.totalSuccessful, 0);
  assert.equal(snap.failedRate, 0);
  assert.equal(snap.successRate, 0);
  assert.equal(snap.avgSourceDurationMs, 0);
  assert.deepEqual(snap.transitions, []);
});

test('recordBatch tracks successes and failures correctly', () => {
  const g = makeGuardrail();
  g.recordBatch([successStat('a'), successStat('b'), failStat('c')]);
  const snap = g.snapshot();
  assert.equal(snap.totalAttempted, 3);
  assert.equal(snap.totalFailed, 1);
  assert.equal(snap.totalSuccessful, 2);
  assert.ok(Math.abs(snap.failedRate - 0.333) < 0.01);
  assert.ok(Math.abs(snap.successRate - 0.667) < 0.01);
});

test('failure rate below warning ratio keeps level 0', () => {
  const g = makeGuardrail();
  // 6 sources, 2 failed = 33% < 60% of 65% = 39%
  g.recordBatch([
    successStat('a'), successStat('b'), successStat('c'),
    successStat('d'), failStat('e'), failStat('f')
  ]);
  const state = g.evaluate();
  assert.equal(state.concurrency, 4);
  assert.equal(state.timeoutOverrideMs, null);
  assert.equal(state.criticalOnly, false);
});

test('failure rate above warning ratio (60% of max) triggers level 1', () => {
  const g = makeGuardrail();
  // 6 sources, 3 failed = 50% > 39% (60% of 65%)
  g.recordBatch([
    successStat('a'), successStat('b'), successStat('c'),
    failStat('d'), failStat('e'), failStat('f')
  ]);
  const state = g.evaluate();
  assert.equal(state.concurrency, 3, 'concurrency reduced by 1');
  assert.equal(state.staggerMs, 90, 'stagger increased to 1.5x');
  assert.equal(state.timeoutOverrideMs, null, 'no timeout override at level 1');
  assert.equal(state.criticalOnly, false, 'not critical-only at level 1');
  assert.equal(state.skipPlaywright, false, 'playwright not skipped at level 1');
});

test('failure rate exceeding max triggers level 2 (fast-fail)', () => {
  const g = makeGuardrail();
  // 6 sources, 5 failed = 83% > 65%
  g.recordBatch([
    successStat('a'), failStat('b'), failStat('c'),
    failStat('d'), failStat('e'), failStat('f')
  ]);
  const state = g.evaluate();
  assert.equal(state.concurrency, 2, 'concurrency halved');
  assert.equal(state.staggerMs, 180, 'stagger tripled');
  assert.equal(state.staggerJitterMs, 180, 'jitter doubled');
  assert.equal(state.timeoutOverrideMs, 5000, 'fast-fail timeout applied');
  assert.equal(state.criticalOnly, true, 'critical-only mode');
  assert.equal(state.skipPlaywright, true, 'playwright skipped');
});

test('throttle level never de-escalates within a run', () => {
  const g = makeGuardrail();
  // Push to level 2
  g.recordBatch([
    successStat('a'), failStat('b'), failStat('c'),
    failStat('d'), failStat('e'), failStat('f')
  ]);
  g.evaluate();

  // Now add all successes — level should stay at 2
  g.recordBatch([
    successStat('g'), successStat('h'), successStat('i'),
    successStat('j'), successStat('k'), successStat('l')
  ]);
  const state = g.evaluate();
  assert.equal(state.concurrency, 2, 'stays at level 2');
  assert.equal(state.criticalOnly, true, 'stays critical-only');
  assert.equal(state.skipPlaywright, true, 'stays playwright-skipped');
});

test('runtime at 80%+ of guardrail triggers level 2', () => {
  // Start run 10 minutes ago, with 12-minute guardrail = 83% elapsed
  const g = makeGuardrail({ runStartedAtMs: Date.now() - 10 * 60_000 });
  g.recordBatch([successStat('a')]); // need some data
  const state = g.evaluate();
  assert.equal(state.criticalOnly, true, 'runtime pressure triggers fast-fail');
  assert.equal(state.timeoutOverrideMs, 5000);
});

test('runtime at 95%+ of guardrail sets shouldAbort', () => {
  // Start run 11.5 minutes ago, with 12-minute guardrail = 95.8%
  const g = makeGuardrail({ runStartedAtMs: Date.now() - 11.5 * 60_000 });
  const state = g.evaluate();
  assert.equal(state.shouldAbort, true, 'should abort at 95%');
});

test('failure rate check needs minSourcesForRateCheck', () => {
  const g = makeGuardrail({ minSourcesForRateCheck: 6 });
  // 3 out of 4 failed = 75% but only 4 attempted < 6 min
  g.recordBatch([successStat('a'), failStat('b'), failStat('c'), failStat('d')]);
  const state = g.evaluate();
  assert.equal(state.concurrency, 4, 'not throttled — too few samples');
  assert.equal(state.criticalOnly, false);
});

test('snapshot transitions log records escalations', () => {
  const g = makeGuardrail();
  // Trigger level 1
  g.recordBatch([
    successStat('a'), successStat('b'), successStat('c'),
    failStat('d'), failStat('e'), failStat('f')
  ]);
  g.evaluate();
  // Trigger level 2
  g.recordBatch([failStat('g'), failStat('h'), failStat('i')]);
  g.evaluate();

  const snap = g.snapshot();
  assert.equal(snap.transitions.length, 2);
  assert.equal(snap.transitions[0].level, 1);
  assert.equal(snap.transitions[1].level, 2);
});

test('elapsedMs returns positive value', () => {
  const g = makeGuardrail({ runStartedAtMs: Date.now() - 5000 });
  assert.ok(g.elapsedMs() >= 4900, 'elapsed should be >= ~5000ms');
});

test('baseConcurrency of 1 does not go below 1', () => {
  const g = makeGuardrail({ baseConcurrency: 1 });
  // Trigger level 2
  g.recordBatch([failStat('a'), failStat('b'), failStat('c'), failStat('d'), failStat('e'), failStat('f')]);
  const state = g.evaluate();
  assert.equal(state.concurrency, 1, 'cannot go below 1');
});

// ---------------------------------------------------------------------------
// successRate() / avgSourceDurationMs() / dynamic oversample support
// ---------------------------------------------------------------------------

test('successRate returns 0 with no data', () => {
  const g = makeGuardrail();
  assert.equal(g.successRate(), 0);
});

test('successRate reflects proportion of sources with built > 0', () => {
  const g = makeGuardrail();
  // 4 attempted, 3 successful (built > 0), 1 failed
  g.recordBatch([successStat('a'), successStat('b'), successStat('c'), failStat('d')]);
  assert.ok(Math.abs(g.successRate() - 0.75) < 0.01);
});

test('successRate accumulates across multiple recordBatch calls', () => {
  const g = makeGuardrail();
  g.recordBatch([successStat('a'), failStat('b')]);    // 1/2
  g.recordBatch([successStat('c'), successStat('d')]);  // now 3/4
  assert.ok(Math.abs(g.successRate() - 0.75) < 0.01);
});

test('avgSourceDurationMs returns 0 with no batch timing data', () => {
  const g = makeGuardrail();
  assert.equal(g.avgSourceDurationMs(), 0);
  // Recording without duration still returns 0
  g.recordBatch([successStat('a')]);
  assert.equal(g.avgSourceDurationMs(), 0);
});

test('avgSourceDurationMs computes average across batches', () => {
  const g = makeGuardrail();
  // Batch 1: 2 sources took 6000ms → 3000ms/source
  g.recordBatch([successStat('a'), failStat('b')], 6000);
  assert.equal(g.avgSourceDurationMs(), 3000);
  // Batch 2: 3 sources took 9000ms → total 15000ms / 5 sources = 3000ms
  g.recordBatch([successStat('c'), successStat('d'), failStat('e')], 9000);
  assert.equal(g.avgSourceDurationMs(), 3000);
  // Batch 3: 1 source took 500ms → total 15500ms / 6 sources ≈ 2583ms
  g.recordBatch([successStat('f')], 500);
  assert.ok(Math.abs(g.avgSourceDurationMs() - 2583) < 2);
});

test('avgSourceDurationMs ignores non-finite and non-positive durations', () => {
  const g = makeGuardrail();
  g.recordBatch([successStat('a')], NaN);
  assert.equal(g.avgSourceDurationMs(), 0);
  g.recordBatch([successStat('b')], -100);
  assert.equal(g.avgSourceDurationMs(), 0);
  g.recordBatch([successStat('c')], 0);
  assert.equal(g.avgSourceDurationMs(), 0);
  // Valid duration should now compute correctly over all 3 sources + 1 more
  g.recordBatch([successStat('d')], 4000);
  assert.equal(g.avgSourceDurationMs(), 1000); // 4000ms / 4 sources
});

test('snapshot includes successRate and avgSourceDurationMs', () => {
  const g = makeGuardrail();
  g.recordBatch([successStat('a'), failStat('b')], 2000);
  const snap = g.snapshot();
  assert.equal(snap.successRate, 0.5);
  assert.equal(snap.avgSourceDurationMs, 1000);
  assert.equal(snap.totalSuccessful, 1);
});
