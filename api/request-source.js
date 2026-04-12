import {
  ApiError,
  commitJsonFilesAtomically,
  loadJsonFile,
  normaliseEndpoint,
  validateAbsoluteHttpUrl
} from './_lib/github-persistence.js';
import { applyCorsHeaders } from './_lib/admin-session.js';

const REQUESTS_PATH = 'data/source-requests.json';
const SOURCES_PATH = 'data/sources.json';
const VALID_REGIONS = new Set(['uk', 'europe', 'london', 'eu', 'international', 'us']);
const VALID_LANES = new Set(['incidents', 'context', 'sanctions', 'oversight', 'border', 'prevention']);
const VALID_KINDS = new Set(['rss', 'atom', 'json', 'html', 'playwright_html']);
const REQUEST_HISTORY_LIMIT = 250;

function sendError(response, error) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : 'persistence-failure';
  const message = error instanceof Error ? error.message : String(error);
  response.status(status).json({
    ok: false,
    error: code,
    message
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

function clean(value) {
  return String(value || '').trim();
}

function titleCase(value) {
  return clean(value)
    .toLowerCase()
    .replace(/(^|\s|[-_])([a-z])/g, (match, prefix, letter) => `${prefix}${letter.toUpperCase()}`)
    .replace(/\s+/g, ' ')
    .trim();
}

function normaliseRegion(rawRegion) {
  const value = clean(rawRegion).toLowerCase();
  if (VALID_REGIONS.has(value)) return value;
  if (value === 'all') return 'uk';
  if (value.startsWith('eu')) return 'eu';
  if (value.startsWith('lon')) return 'london';
  if (value.startsWith('int')) return 'international';
  if (value.startsWith('us')) return 'us';
  return 'uk';
}

function inferKind(url) {
  const lower = clean(url).toLowerCase();
  if (lower.endsWith('.json') || lower.includes('feed.json')) return 'json';
  if (lower.includes('atom') || lower.endsWith('.atom')) return 'atom';
  if (lower.includes('rss') || lower.endsWith('.rss') || lower.endsWith('.xml') || lower.includes('/feed')) return 'rss';
  return 'html';
}

function officialHost(host) {
  const value = clean(host).toLowerCase();
  if (!value) return false;
  if (value.endsWith('.gov') || value.endsWith('.gov.uk') || value.endsWith('.gov.us')) return true;
  if (value.includes('.police.uk') || value.includes('police.')) return true;
  if (value.includes('mod.uk') || value.includes('homeoffice') || value.includes('interior')) return true;
  if (value.includes('europa.eu') || value.includes('consilium.europa.eu')) return true;
  if (value.includes('europol') || value.includes('interpol')) return true;
  if (value.includes('intelligence') || value.includes('security-service')) return true;
  return false;
}

function journalistHost(host) {
  const value = clean(host).toLowerCase();
  if (!value) return false;
  const matches = [
    'bbc',
    'reuters',
    'apnews',
    'associatedpress',
    'guardian',
    'telegraph',
    'ft.com',
    'economist',
    'cnn',
    'nytimes',
    'washingtonpost',
    'aljazeera',
    'skynews',
    'politico',
    'euractiv',
    'dw.com',
    'france24',
    'lemonde',
    'elpa',
    'elpais',
    'la-repubblica',
    'corriere',
    'times'
  ];
  return matches.some((needle) => value.includes(needle));
}

function inferLane({ host, path, isTrustedOfficial }) {
  const haystack = `${host} ${path}`.toLowerCase();
  if (/terror|counterterror|incident|alert|security|police|intelligence|ct|crime/.test(haystack)) {
    return 'incidents';
  }
  if (isTrustedOfficial) return 'incidents';
  return 'context';
}

function inferTags({ region, lane, isTrustedOfficial, host }) {
  const tags = new Set();
  if (isTrustedOfficial) tags.add('official');
  if (journalistHost(host)) tags.add('journalist');
  if (region === 'eu' || region === 'europe') tags.add('eu');
  if (region === 'uk' || region === 'london') tags.add('uk');
  if (region === 'us') tags.add('us');
  if (region === 'international') tags.add('international');
  if (lane) tags.add(lane);
  if (lane === 'context') tags.add('context');
  return [...tags];
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 54);
}

function hashString(value) {
  return Array.from(clean(value))
    .reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0)
    .toString(36);
}

function buildRequestId(endpoint, existingIds) {
  let baseId = 'source-request';
  try {
    const parsed = new URL(endpoint);
    const hostSlug = slugify(parsed.hostname.replace(/^www\./, ''));
    const pathSlug = slugify(parsed.pathname.split('/').filter(Boolean).slice(0, 2).join('-'));
    baseId = [hostSlug, pathSlug].filter(Boolean).join('-') || baseId;
  } catch {}
  let candidate = baseId;
  if (existingIds.has(candidate)) {
    candidate = `${baseId}-${hashString(endpoint).slice(0, 6)}`;
  }
  let counter = 1;
  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${hashString(endpoint)}-${counter++}`;
  }
  return candidate;
}

function providerLabel(host) {
  if (!host) return 'Requested source';
  const stripped = host.replace(/^www\./, '');
  const parts = stripped.split('.');
  const base = parts.length > 2 ? parts[parts.length - 2] : parts[0];
  return `${titleCase(base.replace(/[-_]/g, ' '))} (suggested)`;
}

function normaliseRequestsPayload(raw) {
  if (Array.isArray(raw)) {
    return { requests: raw };
  }
  if (raw && typeof raw === 'object' && Array.isArray(raw.requests)) {
    return raw;
  }
  return { requests: [] };
}

function findDuplicateEndpoint(existingSources, endpoint) {
  const candidate = normaliseEndpoint(endpoint);
  if (!candidate) return false;
  return (Array.isArray(existingSources) ? existingSources : []).some((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    return normaliseEndpoint(entry.endpoint) === candidate;
  });
}

function buildRequestPayload(endpoint, regionHint, existingIds) {
  const parsed = new URL(endpoint);
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname || '';
  const region = normaliseRegion(regionHint);
  const kind = inferKind(endpoint);
  const isTrustedOfficial = officialHost(host);
  const lane = inferLane({ host, path, isTrustedOfficial });
  const tags = inferTags({ region, lane, isTrustedOfficial, host });
  const requestedAt = new Date().toISOString();
  const id = buildRequestId(endpoint, existingIds);
  const provider = providerLabel(host);
  const requiresKeywordMatch = !isTrustedOfficial;
  const tagSummary = tags.length ? tags.join(', ') : '';
  const validationLabel = `${kind} | ${region} | pending`;

  return {
    id,
    provider,
    endpoint,
    kind: VALID_KINDS.has(kind) ? kind : 'html',
    lane: VALID_LANES.has(lane) ? lane : 'context',
    region,
    isTrustedOfficial,
    requiresKeywordMatch,
    requestedAt,
    status: 'pending',
    tags,
    tagSummary,
    validationLabel
  };
}

function sortNewestFirst(items) {
  return [...items].sort((left, right) => {
    const leftMs = new Date(left?.requestedAt || 0).getTime() || 0;
    const rightMs = new Date(right?.requestedAt || 0).getTime() || 0;
    return rightMs - leftMs;
  });
}

export default async function handler(request, response) {
  applyCorsHeaders(request, response, 'GET,POST,OPTIONS');
  if (request.method === 'OPTIONS') {
    response.setHeader('Allow', 'GET,POST,OPTIONS');
    return response.status(204).end();
  }

  if (request.method === 'GET') {
    try {
      const file = await loadJsonFile(REQUESTS_PATH);
      const payload = normaliseRequestsPayload(file.data);
      const requests = Array.isArray(payload.requests) ? payload.requests : [];
      return response.status(200).json({
        ok: true,
        generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString(),
        count: Number.isFinite(Number(payload.count)) ? Number(payload.count) : requests.length,
        requests
      });
    } catch (error) {
      return sendError(response, error);
    }
  }

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'GET,POST,OPTIONS');
    return response.status(405).json({
      ok: false,
      error: 'method-not-allowed',
      message: 'Only GET and POST are supported.'
    });
  }

  try {
    const body = parseRequestBody(request);
    const endpoint = validateAbsoluteHttpUrl(body.url || body.endpoint);
    const regionHint = body.regionHint;

    const [requestsFile, sourcesFile] = await Promise.all([
      loadJsonFile(REQUESTS_PATH),
      loadJsonFile(SOURCES_PATH)
    ]);

    const payload = normaliseRequestsPayload(requestsFile.data);
    const requests = Array.isArray(payload.requests) ? payload.requests : [];
    const activeSources = Array.isArray(sourcesFile.data?.sources) ? sourcesFile.data.sources : [];
    if (findDuplicateEndpoint(activeSources, endpoint)) {
      throw new ApiError('duplicate-source', 'That source already exists in the active catalog.', 409);
    }
    if (findDuplicateEndpoint(requests, endpoint)) {
      throw new ApiError('duplicate-request', 'That source link is already in the pending queue.', 409);
    }

    const existingIds = new Set([
      ...activeSources.map((entry) => entry?.id).filter(Boolean),
      ...requests.map((entry) => entry?.id).filter(Boolean)
    ]);
    const requestPayload = buildRequestPayload(endpoint, regionHint, existingIds);
    const nextRequests = sortNewestFirst([requestPayload, ...requests]).slice(0, REQUEST_HISTORY_LIMIT);
    const nextPayload = {
      generatedAt: new Date().toISOString(),
      count: nextRequests.length,
      requests: nextRequests
    };

    await commitJsonFilesAtomically(
      requestsFile.config,
      {
        [REQUESTS_PATH]: nextPayload
      },
      `Queue source request ${requestPayload.id}`
    );

    return response.status(200).json({
      ok: true,
      request: requestPayload,
      requests: nextRequests
    });
  } catch (error) {
    return sendError(response, error);
  }
}
