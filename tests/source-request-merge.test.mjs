import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeSourceCatalogs } from '../scripts/build-live-feed/io.mjs';

test('mergeSourceCatalogs appends pending requests while skipping duplicates', () => {
  const baseSources = [
    { id: 'base-1', endpoint: 'https://example.com/feed', kind: 'rss' },
    { id: 'base-2', endpoint: 'https://example.com/other', kind: 'rss' }
  ];
  const requestedSources = [
    { id: 'request-1', endpoint: 'https://example.com/new', kind: 'rss' },
    { id: 'base-2', endpoint: 'https://duplicate-id.example.com/feed', kind: 'rss' },
    { id: 'request-2', endpoint: 'https://example.com/feed#section', kind: 'rss' }
  ];

  const merged = mergeSourceCatalogs(baseSources, requestedSources);

  assert.deepEqual(
    merged.map((entry) => entry.id),
    ['base-1', 'base-2', 'request-1']
  );
});
