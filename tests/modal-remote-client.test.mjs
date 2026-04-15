import test from 'node:test';
import assert from 'node:assert/strict';

import { requestRemoteLongBrief } from '../app/render/modal-remote-client.mjs';
import { DEFAULT_API_BASE } from '../shared/api-base.mjs';

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
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('requestRemoteLongBrief uses Vercel backend URL as the primary endpoint', async () => {
  const previousFetch = globalThis.fetch;
  const calledUrls = [];
  globalThis.fetch = async (url) => {
    calledUrls.push(url);
    return {
      ok: true,
      json: async () => ({ brief: 'remote brief' })
    };
  };

  try {
    const result = await requestRemoteLongBrief([{ headline: 'one' }]);
    assert.equal(result, 'remote brief');
    assert.deepEqual(calledUrls, [
      `${DEFAULT_API_BASE}/api/generate-brief`
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
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('requestRemoteLongBrief accepts plain text success responses', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => 'plain text brief output'
  });

  try {
    const result = await requestRemoteLongBrief([{ headline: 'one' }]);
    assert.equal(result, 'plain text brief output');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('requestRemoteLongBrief extracts brief from OpenAI responses payload shape', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => JSON.stringify({
      output: [{ content: [{ text: 'structured output brief' }] }]
    })
  });

  try {
    const result = await requestRemoteLongBrief([{ headline: 'one' }]);
    assert.equal(result, 'structured output brief');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('requestRemoteLongBrief works when AbortController is unavailable', async () => {
  const previousFetch = globalThis.fetch;
  const previousAbortController = globalThis.AbortController;
  globalThis.AbortController = undefined;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ brief: 'legacy runtime brief' })
  });

  try {
    const result = await requestRemoteLongBrief([{ headline: 'one' }]);
    assert.equal(result, 'legacy runtime brief');
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.AbortController = previousAbortController;
  }
});
