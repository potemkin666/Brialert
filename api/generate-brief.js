import { applyCorsHeaders } from './_lib/admin-session.js';
import { createRateLimiter } from './_lib/rate-limit.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_MODEL = 'gpt-4.1-mini';
const GENERATE_BRIEF_TIMEOUT_MS = 55_000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_BURST = 10;

const briefLimiter = createRateLimiter({ windowMs: RATE_LIMIT_WINDOW_MS, maxBurst: RATE_LIMIT_BURST });

function parseBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string' && request.body.trim()) {
    try {
      return JSON.parse(request.body);
    } catch {
      return null;
    }
  }
  return null;
}

function buildUserMessage(payload) {
  const parts = [
    `Headline: ${payload.headline || 'Unknown'}`,
    `Source: ${payload.sourceName || 'Unknown'}`,
    `Geography: ${payload.geography || 'Unknown'}`,
    `Lane: ${payload.lane || 'Unknown'}`,
    `Confidence: ${payload.confidenceLabel || 'Unknown'}`,
    `Timestamp: ${payload.timestamp || 'Unknown'}`,
    `Original URL: ${payload.originalUrl || 'Unavailable'}`,
    payload.corroborationStatus ? `Corroboration: ${payload.corroborationStatus}` : '',
    payload.recencyText ? `Recency: ${payload.recencyText}` : '',
    payload.sourceExtract ? `\nSource extract:\n${payload.sourceExtract}` : ''
  ].filter(Boolean);
  return parts.join('\n');
}

function extractBrief(data) {
  if (typeof data === 'string') return data.trim();
  return String(
    data?.output_text
    ?? data?.output?.[0]?.content?.[0]?.text
    ?? data?.choices?.[0]?.message?.content
    ?? ''
  ).trim();
}

function extractStreamedText(line) {
  if (!line.startsWith('data: ')) return '';
  const payload = line.slice(6).trim();
  if (payload === '[DONE]') return '';
  try {
    const parsed = JSON.parse(payload);
    return String(parsed?.delta ?? parsed?.output_text ?? parsed?.choices?.[0]?.delta?.content ?? '');
  } catch {
    return '';
  }
}

export default async function handler(request, response) {
  applyCorsHeaders(request, response, 'POST,OPTIONS');
  if (request.method === 'OPTIONS') {
    response.setHeader('Allow', 'POST,OPTIONS');
    return response.status(204).end();
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST,OPTIONS');
    return response.status(405).json({
      ok: false,
      error: 'method-not-allowed',
      message: 'Only POST is supported.'
    });
  }

  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    return response.status(503).json({
      ok: false,
      error: 'misconfigured-backend',
      message: 'Backend is missing OPENAI_API_KEY configuration.'
    });
  }

  if (briefLimiter.isLimited()) {
    return response.status(429).json({
      ok: false,
      error: 'rate-limited',
      message: 'Too many brief requests. Please wait a few seconds before trying again.'
    });
  }

  const body = parseBody(request);
  if (!body || typeof body !== 'object') {
    return response.status(400).json({
      ok: false,
      error: 'invalid-body',
      message: 'Request body must be valid JSON.'
    });
  }

  const headline = String(body.headline || '').trim();
  const sourceExtract = String(body.sourceExtract || '').trim();
  if (!headline && !sourceExtract) {
    return response.status(400).json({
      ok: false,
      error: 'invalid-payload',
      message: 'Payload must include headline or source extract.'
    });
  }

  const instructions = String(body.instructions || '').trim();
  const userMessage = buildUserMessage(body);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    try { controller.abort(); } catch { /* ignore */ }
  }, GENERATE_BRIEF_TIMEOUT_MS);

  try {
    const openaiPayload = {
      model: OPENAI_MODEL,
      input: userMessage,
      stream: true,
      tools: [{ type: 'web_search_preview' }]
    };
    if (instructions) {
      openaiPayload.instructions = instructions;
    }

    const openaiResponse = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(openaiPayload),
      signal: controller.signal
    });

    if (!openaiResponse.ok) {
      const status = openaiResponse.status;
      const errorText = await openaiResponse.text().catch(() => '');
      let detail = `OpenAI API returned HTTP ${status}`;
      try {
        const parsed = JSON.parse(errorText);
        detail = parsed?.error?.message || detail;
      } catch { /* use default */ }
      return response.status(502).json({
        ok: false,
        error: 'upstream-error',
        message: detail
      });
    }

    const contentType = String(openaiResponse.headers.get('content-type') || '');
    const isStreaming = contentType.includes('text/event-stream') || contentType.includes('stream');

    if (!isStreaming) {
      const result = await openaiResponse.json();
      const brief = extractBrief(result);
      if (!brief) {
        return response.status(502).json({
          ok: false,
          error: 'empty-response',
          message: 'Upstream model returned an empty brief.'
        });
      }
      return response.status(200).json({ ok: true, brief });
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const upstreamBody = openaiResponse.body;
    if (!upstreamBody) {
      response.write(`data: ${JSON.stringify({ ok: false, error: 'empty-response' })}\n\n`);
      response.write('data: [DONE]\n\n');
      return response.end();
    }

    const reader = upstreamBody.getReader
      ? upstreamBody.getReader()
      : null;

    if (!reader) {
      const text = await openaiResponse.text();
      const brief = extractBrief(text);
      if (brief) {
        response.write(`data: ${JSON.stringify({ delta: brief })}\n\n`);
      }
      response.write('data: [DONE]\n\n');
      return response.end();
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let anyText = false;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;
        const delta = extractStreamedText(trimmedLine);
        if (delta) {
          anyText = true;
          response.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
      }
    }

    if (buffer.trim()) {
      const delta = extractStreamedText(buffer.trim());
      if (delta) {
        anyText = true;
        response.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
    }

    if (!anyText) {
      response.write(`data: ${JSON.stringify({ ok: false, error: 'empty-response' })}\n\n`);
    }
    response.write('data: [DONE]\n\n');
    return response.end();
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (!response.headersSent) {
        return response.status(504).json({
          ok: false,
          error: 'timeout',
          message: 'Brief generation timed out.'
        });
      }
      response.write(`data: ${JSON.stringify({ ok: false, error: 'timeout' })}\n\n`);
      response.write('data: [DONE]\n\n');
      return response.end();
    }
    if (!response.headersSent) {
      return response.status(500).json({
        ok: false,
        error: 'internal-error',
        message: 'An unexpected error occurred during brief generation.'
      });
    }
    response.write(`data: ${JSON.stringify({ ok: false, error: 'internal-error' })}\n\n`);
    response.write('data: [DONE]\n\n');
    return response.end();
  } finally {
    clearTimeout(timeout);
  }
}
