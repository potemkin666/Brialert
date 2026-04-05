import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFeedItems } from '../scripts/build-live-feed/parsing.mjs';

test('parseFeedItems parses RSS 2.0 items', () => {
  const source = { kind: 'rss' };
  const xml = `<?xml version="1.0"?>
    <rss version="2.0">
      <channel>
        <item>
          <title>RSS title</title>
          <link>https://example.test/rss-1</link>
          <description>RSS summary</description>
          <pubDate>2026-04-04T09:00:00.000Z</pubDate>
        </item>
      </channel>
    </rss>`;

  const items = parseFeedItems(source, xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'RSS title');
  assert.equal(items[0].link, 'https://example.test/rss-1');
  assert.equal(items[0].summary, 'RSS summary');
  assert.equal(items[0].published, '2026-04-04T09:00:00.000Z');
});

test('parseFeedItems parses Atom feed items', () => {
  const source = { kind: 'atom' };
  const xml = `<?xml version="1.0" encoding="utf-8"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Atom title</title>
        <link rel="alternate" href="https://example.test/atom-1" />
        <summary>Atom summary</summary>
        <updated>2026-04-04T10:00:00.000Z</updated>
      </entry>
    </feed>`;

  const items = parseFeedItems(source, xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Atom title');
  assert.equal(items[0].link, 'https://example.test/atom-1');
  assert.equal(items[0].summary, 'Atom summary');
  assert.equal(items[0].published, '2026-04-04T10:00:00.000Z');
});

test('parseFeedItems parses JSON Feed items', () => {
  const source = { kind: 'json' };
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Example JSON Feed',
    items: [
      {
        id: 'json-1',
        title: 'JSON Feed title',
        url: 'https://example.test/json-1',
        content_text: 'JSON feed summary',
        date_published: '2026-04-04T11:00:00.000Z'
      }
    ]
  });

  const items = parseFeedItems(source, json);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'JSON Feed title');
  assert.equal(items[0].link, 'https://example.test/json-1');
  assert.equal(items[0].summary, 'JSON feed summary');
  assert.equal(items[0].published, '2026-04-04T11:00:00.000Z');
});

test('parseFeedItems adapts data.police.uk API payloads into synthetic items', () => {
  const source = {
    kind: 'json',
    endpoint: 'https://data.police.uk/api/crimes-street/all-crime?lat=52.629729&lng=-1.131592'
  };
  const json = JSON.stringify([
    {
      category: 'criminal-damage-arson',
      month: '2024-01',
      persistent_id: 'crime-1',
      location: {
        street: {
          name: 'On or near High Street'
        }
      },
      outcome_status: {
        category: 'Under investigation'
      }
    }
  ]);

  const items = parseFeedItems(source, json);
  assert.equal(items.length, 1);
  assert.match(items[0].title, /Police\.uk street crime/i);
  assert.match(items[0].summary, /Under investigation/i);
  assert.equal(items[0].published, '2024-01-01');
  assert.match(items[0].link, /crime-1/);
});

