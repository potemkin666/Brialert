import test from 'node:test';
import assert from 'node:assert/strict';

import { createTrafficHandler } from '../api/traffic.js';

function createRequest(method, body = null, headers = {}) {
  return {
    method,
    body,
    headers
  };
}

function createResponse() {
  const res = {
    _status: null,
    _json: null,
    _headers: {},
    _ended: false,
    status(code) {
      res._status = code;
      return res;
    },
    json(payload) {
      res._json = payload;
      return res;
    },
    end() {
      res._ended = true;
      return res;
    },
    setHeader(key, value) {
      res._headers[key] = value;
    },
    getHeader(key) {
      return res._headers[key];
    }
  };
  return res;
}

function createMemoryStore() {
  const map = new Map();
  return {
    mode: 'memory',
    async getJson(key) {
      return map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : null;
    },
    async setJson(key, value) {
      map.set(key, JSON.parse(JSON.stringify(value)));
    }
  };
}

test('traffic API accepts anonymous page views and stores aggregated daily stats', async () => {
  const store = createMemoryStore();
  const handler = createTrafficHandler({
    store,
    limiter: { isLimited: async () => false },
    requireAdmin: () => ({ login: 'admin' })
  });

  const postResponse = createResponse();
  await handler(
    createRequest('POST', {
      eventType: 'page_view',
      path: 'https://potemkin666.github.io/AlbertAlert/?search=hidden',
      tab: 'firstalert',
      referrer: 'https://news.example.com/story',
      language: 'en-GB',
      timezone: 'Europe/London'
    }, {
      origin: 'https://potemkin666.github.io',
      'x-forwarded-for': '203.0.113.10',
      'user-agent': 'TrafficTest/1.0'
    }),
    postResponse
  );

  assert.equal(postResponse._status, 202);
  assert.equal(postResponse._json.ok, true);

  const getResponse = createResponse();
  await handler(
    createRequest('GET', null, { origin: 'https://potemkin666.github.io' }),
    getResponse
  );

  assert.equal(getResponse._status, 200);
  assert.equal(getResponse._json.ok, true);
  assert.equal(getResponse._json.days.length, 1);
  assert.equal(getResponse._json.days[0].pageViews, 1);
  assert.equal(getResponse._json.days[0].uniqueVisitors, 1);
  assert.equal(getResponse._json.days[0].paths['/AlbertAlert/'], 1);
  assert.equal(getResponse._json.days[0].referrers['news.example.com'], 1);
  assert.equal(getResponse._json.days[0].visitorHashes, undefined);
});

test('traffic API rate-limits noisy callers', async () => {
  const handler = createTrafficHandler({
    store: createMemoryStore(),
    limiter: { isLimited: async () => true },
    requireAdmin: () => ({ login: 'admin' })
  });
  const response = createResponse();
  await handler(createRequest('POST', { eventType: 'page_view' }), response);
  assert.equal(response._status, 429);
  assert.equal(response._json.error, 'rate-limited');
});
