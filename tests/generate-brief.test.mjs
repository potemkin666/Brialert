import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic import to avoid top-level side effects
async function loadHandler() {
  const mod = await import('../api/generate-brief.js');
  return mod.default;
}

function createRequest(method, body) {
  return {
    method,
    headers: { origin: 'https://potemkin666.github.io' },
    body: body ?? null
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
    json(data) {
      res._json = data;
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

test('generate-brief: rejects non-POST methods', async () => {
  const handler = await loadHandler();
  const res = createResponse();
  await handler(createRequest('GET'), res);
  assert.equal(res._status, 405);
  assert.equal(res._json.error, 'method-not-allowed');
});

test('generate-brief: OPTIONS returns 204', async () => {
  const handler = await loadHandler();
  const res = createResponse();
  await handler(createRequest('OPTIONS'), res);
  assert.equal(res._status, 204);
  assert.equal(res._ended, true);
});

test('generate-brief: returns 503 when OPENAI_API_KEY is missing', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const handler = await loadHandler();
    const res = createResponse();
    await handler(createRequest('POST', { headline: 'Test' }), res);
    assert.equal(res._status, 503);
    assert.equal(res._json.error, 'misconfigured-backend');
  } finally {
    if (previousKey !== undefined) {
      process.env.OPENAI_API_KEY = previousKey;
    }
  }
});

test('generate-brief: returns 400 for invalid JSON body', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const handler = await loadHandler();
    const res = createResponse();
    await handler(createRequest('POST', 'not valid json{{{'), res);
    assert.equal(res._status, 400);
    assert.equal(res._json.error, 'invalid-body');
  } finally {
    if (previousKey !== undefined) {
      process.env.OPENAI_API_KEY = previousKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});

test('generate-brief: returns 400 for empty payload', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const handler = await loadHandler();
    const res = createResponse();
    await handler(createRequest('POST', {}), res);
    assert.equal(res._status, 400);
    assert.equal(res._json.error, 'invalid-payload');
  } finally {
    if (previousKey !== undefined) {
      process.env.OPENAI_API_KEY = previousKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});

test('generate-brief: returns brief on successful OpenAI response', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ output_text: 'Generated long brief content.' })
  });

  try {
    const handler = await loadHandler();
    const res = createResponse();
    await handler(createRequest('POST', {
      headline: 'Test Incident',
      sourceName: 'BBC News',
      sourceExtract: 'An incident occurred in central London today.'
    }), res);
    assert.equal(res._status, 200);
    assert.equal(res._json.ok, true);
    assert.equal(res._json.brief, 'Generated long brief content.');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey !== undefined) {
      process.env.OPENAI_API_KEY = previousKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});

test('generate-brief: returns 502 when OpenAI returns non-ok status', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: false,
    status: 500,
    text: async () => JSON.stringify({ error: { message: 'Internal server error' } })
  });

  try {
    const handler = await loadHandler();
    const res = createResponse();
    await handler(createRequest('POST', {
      headline: 'Test Incident',
      sourceExtract: 'Some content for the brief generation.'
    }), res);
    assert.equal(res._status, 502);
    assert.equal(res._json.error, 'upstream-error');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey !== undefined) {
      process.env.OPENAI_API_KEY = previousKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});

test('generate-brief: returns 502 when OpenAI returns empty brief', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ output_text: '' })
  });

  try {
    const handler = await loadHandler();
    const res = createResponse();
    await handler(createRequest('POST', {
      headline: 'Test Incident',
      sourceExtract: 'Some content for the brief generation.'
    }), res);
    assert.equal(res._status, 502);
    assert.equal(res._json.error, 'empty-response');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey !== undefined) {
      process.env.OPENAI_API_KEY = previousKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});

test('generate-brief: sends web_search_preview tool and stream flag in OpenAI request', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  let capturedBody = null;
  globalThis.fetch = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ output_text: 'Brief with web research.' })
    };
  };

  try {
    const handler = await loadHandler();
    const res = createResponse();
    await handler(createRequest('POST', {
      headline: 'Test Alert',
      sourceName: 'Reuters',
      instructions: 'Write a detailed brief.',
      sourceExtract: 'Details about the incident.'
    }), res);
    assert.equal(res._status, 200);
    assert.ok(capturedBody);
    assert.equal(capturedBody.model, 'gpt-4.1-mini');
    assert.equal(capturedBody.stream, true);
    assert.equal(capturedBody.instructions, 'Write a detailed brief.');
    assert.ok(capturedBody.input.includes('Test Alert'));
    assert.ok(capturedBody.input.includes('Reuters'));
    assert.deepEqual(capturedBody.tools, [{ type: 'web_search_preview' }]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey !== undefined) {
      process.env.OPENAI_API_KEY = previousKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});

test('generate-brief: streams SSE response when upstream returns event-stream', async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'test-key';

  const chunks = [
    'data: {"delta":"Hello "}\n\n',
    'data: {"delta":"world."}\n\n',
    'data: [DONE]\n\n'
  ];
  let chunkIndex = 0;

  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: () => 'text/event-stream' },
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
    const handler = await loadHandler();
    const written = [];
    const res = {
      ...createResponse(),
      headersSent: false,
      writeHead(status, headers) {
        res._status = status;
        Object.assign(res._headers, headers);
        res.headersSent = true;
      },
      write(chunk) {
        written.push(chunk);
      },
      end() {
        res._ended = true;
        return res;
      }
    };

    await handler(createRequest('POST', {
      headline: 'Test Incident',
      sourceExtract: 'Details here.'
    }), res);

    assert.equal(res._status, 200);
    assert.equal(res._headers['Content-Type'], 'text/event-stream');
    assert.equal(res._ended, true);

    const deltas = written
      .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
      .map((line) => JSON.parse(line.slice(6).trim()).delta);
    assert.deepEqual(deltas, ['Hello ', 'world.']);
    assert.ok(written.some((line) => line.includes('[DONE]')));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey !== undefined) {
      process.env.OPENAI_API_KEY = previousKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  }
});
