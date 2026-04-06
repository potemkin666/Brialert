import test from 'node:test';
import assert from 'node:assert/strict';

import { requestRemoteLongBrief } from '../app/render/modal-remote-client.mjs';

test('requestRemoteLongBrief stops retrying on terminal HTTP statuses like 501', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 501 };
  };

  try {
    await assert.rejects(
      requestRemoteLongBrief([{ headline: 'one' }, { headline: 'two' }]),
      /Long brief generation failed/
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('requestRemoteLongBrief falls back to backend URL when same-origin route is terminal', async () => {
  const previousFetch = globalThis.fetch;
  const calledUrls = [];
  globalThis.fetch = async (url) => {
    calledUrls.push(url);
    if (url === '/api/generate-brief') {
      return { ok: false, status: 404 };
    }
    return {
      ok: true,
      json: async () => ({ brief: 'fallback brief' })
    };
  };

  try {
    const result = await requestRemoteLongBrief([{ headline: 'one' }, { headline: 'two' }]);
    assert.equal(result, 'fallback brief');
    assert.deepEqual(calledUrls, [
      '/api/generate-brief',
      'https://brialertbackend.vercel.app/api/generate-brief'
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('requestRemoteLongBrief retries payload attempts for transient errors', async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('network down');
  };

  try {
    await assert.rejects(
      requestRemoteLongBrief([{ headline: 'one' }, { headline: 'two' }]),
      /Long brief generation failed/
    );
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
