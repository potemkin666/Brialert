import { createHash } from 'node:crypto';
import {
  ApiError,
  commitJsonFilesAtomically,
  loadJsonFile,
  normaliseEndpoint
} from './_lib/github-persistence.js';

const VALID_REGIONS = new Set(['uk', 'europe', 'london', 'eu', 'international', 'us']);
const SOURCE_REQUEST_TIMEOUT_MS = 12_000;
const CONTENT_SAMPLE_SIZE = 2_000;
const REQUEST_ID_HASH_LENGTH = 16;

function resolveAllowedOrigin(request) {
  const configured = String(
    process.env.BRIALERT_ALLOWED_ORIGINS || process.env.BRIALERT_ALLOWED_ORIGIN || ''
  ).trim();
  if (!configured) return '*';

  const allowed = configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowed.length) return '*';

  const requestOrigin = String(request?.headers?.origin || '').trim();
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return allowed[0];
}

function setCorsHeaders(request, response) {
  response.setHeader('Access-Control-Allow-Origin', resolveAllowedOrigin(request));
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendError(response, error) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : 'persistence-failure';
  const detail = error instanceof Error ? error.message : String(error);
  response.status(status).json({
    ok: false,
    error: code,
    detail
  });
}

function parseRequestBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body === 'string' && request.body.trim()) {
    try {
      return JSON.parse(request.body);
    } catch {
      throw new ApiError('invalid-body', 'Request body must be valid JSON.', 400);
    }
  }
  throw new ApiError('invalid-body', 'Request body is required.', 400);
}

function toRequests(payload) {
  if (Array.isArray(payload)) {
    return { requests: payload, payloadType: 'array' };
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.requests)) {
    return { requests: payload.requests, payloadType: 'object' };
  }
  throw new ApiError('invalid-source-requests-format', 'Payload must contain an array or { requests: [] }.', 500);
}

function validateRequestUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) {
    throw new ApiError('invalid-url', 'Source URL is required.', 400);
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError('invalid-url', 'Source URL must be a valid absolute URL.', 400);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError('invalid-url', 'Source URL must use http or https.', 400);
  }
  parsed.hash = '';
  return parsed.toString();
}

function normaliseRegionHint(regionHint) {
  const candidate = String(regionHint || '').trim().toLowerCase();
  return VALID_REGIONS.has(candidate) ? candidate : 'uk';
}

function inferProvider(sourceUrl) {
  try {
    const hostname = new URL(sourceUrl).hostname.replace(/^www\./i, '');
    return hostname || 'Requested source';
  } catch {
    return 'Requested source';
  }
}

function inferKind(contentType, sample) {
  const type = String(contentType || '').toLowerCase();
  const text = String(sample || '').trim().toLowerCase();

  if (type.includes('json') || text.startsWith('{') || text.startsWith('[')) return 'json';
  if (type.includes('html') || text.startsWith('<!doctype html') || text.startsWith('<html')) return 'html';
  if (type.includes('atom') || text.includes('<feed')) return 'atom';
  if (type.includes('rss') || type.includes('xml') || text.includes('<rss')) return 'rss';
  if (text.startsWith('<')) return 'rss';
  return 'rss';
}

async function probeSource(sourceUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SOURCE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) {
      throw new ApiError('source-unreachable', `Source returned HTTP ${response.status}.`, 400);
    }
    const contentType = response.headers.get('content-type') || '';
    const body = await response.text().catch(() => '');
    return { kind: inferKind(contentType, body.slice(0, CONTENT_SAMPLE_SIZE)) };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error?.name === 'AbortError') {
      throw new ApiError('source-timeout', 'Source validation timed out. Please try again.', 408);
    }
    throw new ApiError('source-unreachable', 'Source could not be reached from the backend.', 400);
  } finally {
    clearTimeout(timeout);
  }
}

function buildRequestedSource(sourceUrl, regionHint, kind) {
  const endpointKey = normaliseEndpoint(sourceUrl) || sourceUrl;
  const hash = createHash('sha256').update(endpointKey).digest('hex').slice(0, REQUEST_ID_HASH_LENGTH);
  return {
    id: `requested-${hash}`,
    provider: inferProvider(sourceUrl),
    endpoint: sourceUrl,
    kind,
    lane: 'context',
    region: normaliseRegionHint(regionHint),
    isTrustedOfficial: false,
    requiresKeywordMatch: true,
    sourceTier: 'context',
    reliabilityProfile: 'general_media',
    requestedAt: new Date().toISOString()
  };
}

function hasDuplicateEndpoint(entries, sourceUrl) {
  const candidate = normaliseEndpoint(sourceUrl);
  if (!candidate) return false;
  return (Array.isArray(entries) ? entries : []).some((item) => {
    return normaliseEndpoint(item?.endpoint || '') === candidate;
  });
}

function normaliseRequestEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const endpoint = String(entry.endpoint || entry.url || entry.sourceUrl || '').trim();
  if (!endpoint) return null;
  return {
    ...entry,
    endpoint
  };
}

function normaliseRequestEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(normaliseRequestEntry)
    .filter(Boolean);
}

function buildNextRequestsPayload(originalPayload, payloadType, nextRequests) {
  if (payloadType === 'array') return nextRequests;
  // Preserve additional metadata keys on object payloads while replacing requests.
  return {
    ...originalPayload,
    requests: nextRequests
  };
}

export default async function handler(request, response) {
  setCorsHeaders(request, response);
  if (request.method === 'OPTIONS') {
    response.setHeader('Allow', 'GET,POST,OPTIONS');
    return response.status(204).end();
  }
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET,POST,OPTIONS');
    return response.status(405).json({
      ok: false,
      error: 'method-not-allowed',
      detail: 'Only GET and POST are supported.'
    });
  }

  try {
    const sourceRequestsFile = await loadJsonFile('data/source-requests.json');
    const { requests, payloadType } = toRequests(sourceRequestsFile.data);
    const normalisedRequests = normaliseRequestEntries(requests);

    if (request.method === 'GET') {
      return response.status(200).json({
        ok: true,
        requests: normalisedRequests,
        count: normalisedRequests.length
      });
    }

    const body = parseRequestBody(request);
    const sourceUrl = validateRequestUrl(body.url);

    const sourcesFile = await loadJsonFile('data/sources.json');
    const activeSources = Array.isArray(sourcesFile.data?.sources)
      ? sourcesFile.data.sources
      : (Array.isArray(sourcesFile.data) ? sourcesFile.data : []);

    if (hasDuplicateEndpoint(activeSources, sourceUrl)) {
      throw new ApiError('duplicate-source', 'That source link already exists in active sources.', 409);
    }
    if (hasDuplicateEndpoint(normalisedRequests, sourceUrl)) {
      throw new ApiError('duplicate-source', 'That source link has already been requested and is pending review.', 409);
    }

    const probe = await probeSource(sourceUrl);
    const requestEntry = buildRequestedSource(sourceUrl, body.regionHint, probe.kind);
    const nextRequests = [requestEntry, ...normalisedRequests];

    const nextPayload = buildNextRequestsPayload(sourceRequestsFile.data, payloadType, nextRequests);

    await commitJsonFilesAtomically(
      sourceRequestsFile.config,
      { 'data/source-requests.json': nextPayload },
      `Queue source request ${requestEntry.id}`
    );

    return response.status(201).json({
      ok: true,
      request: requestEntry,
      requests: nextRequests,
      detail: 'Source validated and queued for the next run.'
    });
  } catch (error) {
    return sendError(response, error);
  }
}
