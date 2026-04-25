import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyTrafficEvent,
  createVisitorHash,
  mergeTrafficIndex,
  publicTrafficSummary,
  sanitiseTrafficEvent
} from '../api/_lib/traffic-analytics.js';

test('sanitiseTrafficEvent strips raw URLs down to safe aggregate fields', () => {
  const event = sanitiseTrafficEvent({
    type: 'tab_view',
    path: 'https://potemkin666.github.io/AlbertAlert/index.html?search=secret#frag',
    tab: 'notes',
    mapMode: 'world',
    referrer: 'https://example.com/some/page?campaign=secret',
    language: 'en-GB',
    timezone: 'Europe/London',
    viewportWidth: 430,
    viewportHeight: 932,
    screenWidth: 1179,
    screenHeight: 2556
  });

  assert.deepEqual(event, {
    eventType: 'tab_view',
    path: '/AlbertAlert/index.html',
    tab: 'notes',
    mapMode: 'world',
    referrerHost: 'example.com',
    language: 'en-gb',
    timezone: 'Europe/London',
    viewportBucket: '≤480x769-1024',
    screenBucket: '1025-1440x1441+'
  });
});

test('applyTrafficEvent aggregates counts and unique visitors without storing raw identity', () => {
  const visitorA = createVisitorHash({ clientKey: '203.0.113.1', userAgent: 'UA-1', dayKey: '2026-04-25', salt: 'salt' });
  const visitorB = createVisitorHash({ clientKey: '198.51.100.2', userAgent: 'UA-2', dayKey: '2026-04-25', salt: 'salt' });
  const baseEvent = sanitiseTrafficEvent({ path: '/AlbertAlert/', tab: 'map', mapMode: 'world' });

  const once = applyTrafficEvent(null, baseEvent, visitorA, '2026-04-25T10:00:00.000Z');
  const twice = applyTrafficEvent(once, baseEvent, visitorA, '2026-04-25T10:05:00.000Z');
  const thrice = applyTrafficEvent(twice, { ...baseEvent, eventType: 'map_mode', mapMode: 'nearby' }, visitorB, '2026-04-25T10:10:00.000Z');

  assert.equal(thrice.totalEvents, 3);
  assert.equal(thrice.pageViews, 2);
  assert.equal(thrice.uniqueVisitors, 2);
  assert.equal(thrice.paths['/AlbertAlert/'], 3);
  assert.equal(thrice.tabs.map, 3);
  assert.equal(thrice.mapModes.world, 2);
  assert.equal(thrice.mapModes.nearby, 1);
  assert.ok(Array.isArray(thrice.visitorHashes));
  assert.equal(thrice.visitorHashes.length, 2);
});

test('publicTrafficSummary removes private visitor hashes', () => {
  const summary = publicTrafficSummary({
    day: '2026-04-25',
    totalEvents: 2,
    visitorHashes: ['abc123']
  });

  assert.deepEqual(summary, {
    day: '2026-04-25',
    totalEvents: 2
  });
});

test('mergeTrafficIndex keeps newest unique tracked days first', () => {
  const index = mergeTrafficIndex({ days: ['2026-04-24', '2026-04-23'] }, '2026-04-25');
  assert.deepEqual(index.days, ['2026-04-25', '2026-04-24', '2026-04-23']);
});
