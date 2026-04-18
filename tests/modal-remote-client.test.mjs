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
      'https://albertalertbackend.vercel.app/api/generate-brief'
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

test('requestRemoteLongBrief reads SSE streaming responses and accumulates deltas', async () => {
  const previousFetch = globalThis.fetch;
  const chunks = [
    'data: {"delta":"Streaming "}\n\n',
    'data: {"delta":"brief "}\n\n',
    'data: {"delta":"output."}\n\n',
    'data: [DONE]\n\n'
  ];
  let chunkIndex = 0;

  globalThis.fetch = async () => ({
    ok: true,
    headers: {
      get(name) {
        if (name === 'content-type') return 'text/event-stream';
        return null;
      }
    },
    body: {
      getReader() {
        const encoder = new TextEncoder();
        return {
          async read() {
            if (chunkIndex >= chunks.length) return { done: true, value: undefined };
            const value = encoder.encode(chunks[chunkIndex]);
            chunkIndex += 1;
            return { done: false, value };
          },
          cancel() {}
        };
      }
    }
  });

  try {
    const result = await requestRemoteLongBrief([{ headline: 'one' }]);
    assert.equal(result, 'Streaming brief output.');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('requestRemoteLongBrief falls back to JSON extraction for non-streaming responses', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: {
      get(name) {
        if (name === 'content-type') return 'application/json';
        return null;
      }
    },
    text: async () => JSON.stringify({ brief: 'json brief' })
  });

  try {
    const result = await requestRemoteLongBrief([{ headline: 'one' }]);
    assert.equal(result, 'json brief');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('readStreamedBrief idle timer does not reject after stream resolves (settled guard)', async () => {
  const previousFetch = globalThis.fetch;
  const chunks = [
    'data: {"delta":"done"}\n\n'
  ];
  let chunkIndex = 0;
  let cancelCalls = 0;

  globalThis.fetch = async () => ({
    ok: true,
    headers: {
      get(name) {
        if (name === 'content-type') return 'text/event-stream';
        return null;
      }
    },
    body: {
      getReader() {
        const encoder = new TextEncoder();
        return {
          async read() {
            if (chunkIndex >= chunks.length) return { done: true, value: undefined };
            const value = encoder.encode(chunks[chunkIndex]);
            chunkIndex += 1;
            return { done: false, value };
          },
          cancel() { cancelCalls += 1; }
        };
      }
    }
  });

  try {
    const result = await requestRemoteLongBrief([{ headline: 'one' }]);
    assert.equal(result, 'done');
    assert.equal(cancelCalls, 0, 'reader.cancel should not be called after successful resolution');
  } finally {
    globalThis.fetch = previousFetch;
  }
});
